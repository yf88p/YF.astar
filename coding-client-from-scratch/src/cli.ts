#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, inspectConfig, selectModel, type LoadedConfig } from './config.js';
import { KilnClient } from './client.js';
import type { PermissionRule } from './permissions.js';
import { SessionStore } from './sessions.js';
import type { KilnEvent, Mode, PermissionPrompt } from './types.js';
import type { TerminalUI } from './ui-contract.js';
import { abortError, checkAbort, errorMessage, eventEmitter, jsonLine, safeText } from './util.js';

const help = `KILN  /  a deliberate coding workbench

Usage
  kiln                         Interactive terminal workbench
  kiln run "your request"      One shot; exits when the agent settles
  kiln run --json "request"    Strict versioned JSONL on stdout
  kiln resume [ID]             Resume ID or most recent in its original cwd
  kiln sessions [search]       List/search sessions
  kiln sessions fork ID        Fork a session (prints new ID)
  kiln sessions export ID      Export versioned JSON to stdout
  kiln sessions import FILE    Import inert history with a new ID
  kiln sessions delete ID      Delete a session
  kiln models [search]         List enabled models
  kiln inspect                Inspect config/context without credentials
  kiln extensions             Inspect loaded extension resources

Options
  -p, --prompt TEXT            One-shot prompt (or pipe text into kiln run)
  -m, --model PROVIDER/MODEL   Select model or alias
  --provider NAME             Scope unqualified model name
  --mode plan|build           Plan technically disables mutation tools
  --thinking off|low|medium|high
  --resume ID|latest          Resume with an optional new prompt
  --ephemeral                No session database; temporary output is deleted on exit
  --cwd DIRECTORY            Project directory (not the installation directory)
  --config-dir DIRECTORY     Protected user configuration directory
  --state-dir DIRECTORY      Session database and redacted output artifacts
  --trust-project            Trust project config/instructions/executable resources
  --allow 'TOOL:PATTERN'      Narrow rule; repeatable. Noninteractive default is deny.
  --max-turns NUMBER         Runaway-turn limit (default 40)
  --json                     Machine events only on stdout; diagnostics on stderr
  -h, --help                 This help
  --version                  Print version

Examples
  kiln run --mode plan 'Explain the architecture'
  kiln run --allow 'edit_file:src/*.ts' --allow 'shell:npm test' 'Fix the failing test'
  kiln run --model local/qwen --json 'Review @src/main.ts'

Development: npm install && npm run dev
Verification: npm run verify
Configuration: ~/.config/kiln/config.json (mode 0600). See README.md.
`;

function parse(argv: string[]) {
  return parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }, json: { type: 'boolean' },
    prompt: { type: 'string', short: 'p' }, model: { type: 'string', short: 'm' }, provider: { type: 'string' }, mode: { type: 'string' }, thinking: { type: 'string' },
    resume: { type: 'string' }, ephemeral: { type: 'boolean' }, cwd: { type: 'string' }, 'config-dir': { type: 'string' }, 'state-dir': { type: 'string' },
    'trust-project': { type: 'boolean' }, allow: { type: 'string', multiple: true }, 'max-turns': { type: 'string' },
  } });
}
function permissionRules(values: string[]): PermissionRule[] {
  return values.map(value => {
    const index = value.indexOf(':');
    if (index < 1 || !value.slice(index + 1)) throw new Error("--allow expects 'tool:pattern', for example 'edit_file:src/*.ts'");
    const tool = value.slice(0, index);
    const action = ['create_file', 'edit_file', 'session_export'].includes(tool) ? 'write' : tool === 'shell' ? 'shell'
      : tool.startsWith('ext__') || tool.startsWith('external__') || ['language_server', 'external_server'].includes(tool) ? 'extension' : 'read';
    return { tool, action, pattern: value.slice(index + 1) };
  });
}
async function stdinPrompt(signal: AbortSignal): Promise<string> {
  checkAbort(signal);
  if (process.stdin.isTTY) return '';
  return new Promise((resolvePrompt, reject) => {
    let text = '';
    const cleanup = () => { process.stdin.off('data', data); process.stdin.off('end', end); process.stdin.off('error', fail); signal.removeEventListener('abort', abort); process.stdin.pause(); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const data = (chunk: Buffer | string) => { text += String(chunk); if (Buffer.byteLength(text) > 128 * 1024) fail(new Error('Piped prompt exceeds 128 KiB')); };
    const end = () => { cleanup(); resolvePrompt(text.trim()); };
    const abort = () => fail(abortError());
    process.stdin.on('data', data); process.stdin.once('end', end); process.stdin.once('error', fail);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else process.stdin.resume();
  });
}
function consoleSink(json: boolean): (event: KilnEvent) => void {
  return event => {
    if (json) { process.stdout.write(jsonLine(event)); return; }
    const text = (key: string) => safeText(String(event[key] ?? ''));
    if (event.type === 'assistant.delta') process.stdout.write(text('text'));
    else if (event.type === 'assistant.end') process.stdout.write('\n');
    else if (event.type === 'tool.start') process.stderr.write(`\n[${text('name')}] ${text('arguments')}\n`);
    else if (event.type === 'tool.output' || event.type === 'tool.progress') process.stderr.write(text('text'));
    else if (event.type === 'tool.end') process.stderr.write(`[${text('name')}: ${event.isError ? 'failed' : 'complete'}]\n${text('content')}\n`);
    else if (event.type === 'warning' || event.type === 'error') process.stderr.write(`${event.type}: ${text('message')}\n`);
    else if (event.type === 'retry') process.stderr.write(`Retry ${text('attempt')} in ${text('delayMs')}ms: ${text('error')}\n`);
    else if (event.type === 'agent.end') process.stderr.write(`\n${text('outcome')} (${text('reason')}, ${text('turns')} turns)\n`);
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let client: KilnClient | undefined;
  let ui: TerminalUI | undefined;
  let temporary: string | undefined;
  let loaded: LoadedConfig | undefined;
  const controller = new AbortController();
  let json = argv.includes('--json');
  let signalCount = 0;
  const onSignal = () => {
    signalCount++; controller.abort(); client?.abort();
    // Blessed also observes signals; do not remove its listeners during their dispatch snapshot.
    queueMicrotask(() => ui?.destroy());
  };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal); process.on('SIGHUP', onSignal);
  try {
    const { values, positionals } = parse(argv);
    json = values.json ?? false;
    if (values.help) { process.stdout.write(json ? jsonLine({ version: 1, type: 'help', text: help }) : help); return 0; }
    if (values.version) { process.stdout.write(json ? jsonLine({ version: 1, type: 'version', value: '0.1.0' }) : 'kiln 0.1.0\n'); return 0; }
    const command = positionals[0];
    const known = ['run', 'resume', 'sessions', 'models', 'inspect', 'extensions'];
    if (command && !known.includes(command)) throw new Error(`Unknown command: ${command}. Use kiln run "prompt" or kiln --help.`);
    if (values.mode && !['plan', 'build'].includes(values.mode)) throw new Error('--mode must be plan or build');
    if (values.thinking && !['off', 'low', 'medium', 'high'].includes(values.thinking)) throw new Error('--thinking must be off, low, medium, or high');
    if (values.ephemeral && (values.resume || command === 'resume' || command === 'sessions')) throw new Error('--ephemeral cannot resume or manage persistent sessions');
    const stateDir = resolve(values['state-dir'] ?? process.env.KILN_STATE_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'kiln'));
    let cwd = values.cwd;
    let sessionId = values.resume ?? (command === 'resume' ? positionals[1] ?? 'latest' : undefined);
    if (sessionId) {
      const store = new SessionStore(stateDir);
      try {
        const session = store.list().find(session => sessionId === 'latest' || session.id === sessionId);
        if (!session) throw new Error('Session not found');
        sessionId = session.id;
        if (cwd && await realpath(resolve(cwd)) !== await realpath(session.cwd)) throw new Error(`Resumed session belongs to ${session.cwd}; omit --cwd`);
        cwd = session.cwd;
      } finally { store.close(); }
    }
    const oneShot = command === 'run' || values.prompt !== undefined || json;
    const interactive = !oneShot && (!command || command === 'resume');
    if (interactive) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive mode requires a terminal. Use kiln run "prompt" or kiln run --json.');
      const { createTerminalUI } = await import('./tui.js');
      ui = createTerminalUI();
    }
    const sink = consoleSink(json);
    const bootstrapEmit = eventEmitter('', sink);
    const deny: PermissionPrompt = async () => ({ decision: 'deny' });
    const trustPrompt: PermissionPrompt | undefined = ui ? async (request, signal) => {
      bootstrapEmit('permission.request', { request });
      const answer = await ui!.prompt(request, signal);
      bootstrapEmit('permission.decision', { requestId: request.id, ...answer }); return answer;
    } : undefined;
    if (values.ephemeral) temporary = await mkdtemp(join(tmpdir(), 'kiln-ephemeral-'));
    loaded = await loadConfig({ cwd, configDir: values['config-dir'], stateDir: temporary ?? stateDir, trust: values['trust-project'], prompt: trustPrompt, signal: controller.signal });
    checkAbort(controller.signal);
    if (values['max-turns']) {
      const max = Number(values['max-turns']);
      if (!Number.isSafeInteger(max) || max < 1 || max > 1000) throw new Error('--max-turns must be an integer from 1 to 1000');
      loaded.config.maxTurns = max;
    }
    const output = (value: unknown) => process.stdout.write(json ? jsonLine({ version: 1, type: 'command.result', time: new Date().toISOString(), sessionId: '', command, value: redactValueForOutput(value) })
      : (typeof value === 'string' ? loaded!.redact(value) : JSON.stringify(redactValueForOutput(value), null, 2)) + '\n');
    const redactValueForOutput = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'string' ? loaded!.redact(item) : item));
    if (command === 'sessions') {
      const store = new SessionStore(stateDir, { redact: loaded.redact });
      try {
        const sub = positionals[1]; const id = positionals[2];
        if (sub === 'export') { if (!id) throw new Error('Usage: kiln sessions export ID'); output(store.export(id)); }
        else if (sub === 'import') {
          if (!id) throw new Error('Usage: kiln sessions import FILE');
          const data = await readFile(resolve(id));
          if (data.byteLength > 32 * 1024 * 1024) throw new Error('Session export exceeds 32 MiB');
          const session = store.import(data.toString('utf8')); output(session.meta); session.close();
        } else if (sub === 'fork') { if (!id) throw new Error('Usage: kiln sessions fork ID'); const session = store.fork(id); output(session.meta); session.close(); }
        else if (sub === 'delete') { if (!id) throw new Error('Usage: kiln sessions delete ID'); store.delete(id); output(`Deleted ${id}`); }
        else output(store.list(positionals.slice(1).join(' ')));
      } finally { store.close(); }
      return 0;
    }
    if (command === 'models') {
      const query = positionals.slice(1).join(' ').toLowerCase();
      output(loaded.config.models.filter(model => `${model.provider}/${model.id} ${model.name}`.toLowerCase().includes(query)).flatMap(model => {
        try { selectModel(loaded!.config, `${model.provider}/${model.id}`); return [model]; } catch { return []; }
      })); return 0;
    }
    if (command === 'inspect') { output(inspectConfig(loaded)); return 0; }
    client = new KilnClient({ loaded, ephemeral: values.ephemeral, sessionId, model: values.model, provider: values.provider,
      mode: values.mode as Mode | undefined, thinking: values.thinking as 'off' | 'low' | 'medium' | 'high' | undefined,
      prompt: ui?.prompt ?? deny, rules: permissionRules(values.allow ?? []), sink: ui ? undefined : sink });
    ui?.attach(client);
    await client.initialize();
    checkAbort(controller.signal);
    if (command === 'extensions') { output(await client.command('/extensions')); return 0; }
    if (interactive) {
      await ui!.run(); return signalCount ? 130 : 0;
    }
    const prompt = (values.prompt ?? (command === 'run' ? positionals.slice(1).join(' ') : '')) || await stdinPrompt(controller.signal);
    checkAbort(controller.signal);
    if (!prompt) throw new Error('A prompt is required. Use kiln run "your request" or pipe a prompt into kiln run.');
    await client.submit(prompt, undefined, true);
    return client.lastResult?.outcome === 'success' ? 0 : client.lastResult?.outcome === 'aborted' ? 130 : 1;
  } catch (error) {
    ui?.destroy();
    const message = loaded?.redact(errorMessage(error)) ?? errorMessage(error);
    process.stderr.write(`kiln: ${safeText(message)}\n`);
    if (json) process.stdout.write(jsonLine({ version: 1, type: 'agent.end', time: new Date().toISOString(), sessionId: client?.session.meta.id ?? '', outcome: controller.signal.aborted ? 'aborted' : 'failure', reason: 'error', error: message, turns: 0 }));
    return controller.signal.aborted ? 130 : 1;
  } finally {
    ui?.destroy();
    try { await client?.close(); } catch (error) { process.stderr.write(`kiln cleanup: ${safeText(loaded?.redact(errorMessage(error)) ?? errorMessage(error))}\n`); }
    if (temporary) await rm(temporary, { recursive: true, force: true });
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); process.off('SIGHUP', onSignal);
  }
}

if (process.argv[1] && await realpath(resolve(process.argv[1])).catch(() => '') === await realpath(fileURLToPath(import.meta.url))) process.exitCode = await main();
