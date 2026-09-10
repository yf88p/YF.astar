import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { KilnEvent, Message, SessionMeta, SessionRecord } from '../src/types.js';
import { call, fakeProvider, localConfig, workspace, type WireRequest } from './fixtures/fake-provider.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const original = 'export const add = (a, b) => a - b;\n';
const wrong = 'export const add = (a, b) => a + b + 1;\n';
const corrected = 'export const add = (a, b) => a + b;\n';
const checks = `import assert from 'node:assert/strict';
import test from 'node:test';
import { add } from './math.mjs';
test('addition regression', () => {
  console.log('RAW_STDOUT_MARKER');
  console.error('RAW_STDERR_MARKER');
  assert.equal(add(2, 3), 5);
  assert.equal(add(-2, 2), 0);
});
`;
type Workspace = Awaited<ReturnType<typeof workspace>>;

async function launch(t: TestContext, w: Workspace, args: string[], options: {
  input?: string; keepStdinOpen?: boolean; cwd?: string; executable?: string; nodeArgs?: string[];
  onEvent?: (event: KilnEvent, child: ChildProcessWithoutNullStreams) => void;
} = {}) {
  const child = spawn(options.executable ?? process.execPath,
    [...(options.executable ? [] : [...options.nodeArgs ?? [], cli]), '--config-dir', w.configDir, '--state-dir', w.stateDir, '--json', ...args],
    { cwd: options.cwd ?? w.cwd, env: w.env, stdio: 'pipe' });
  let stdout = ''; let stderr = ''; let pending = ''; let failure: unknown;
  const events: KilnEvent[] = [];
  const timer = setTimeout(() => { failure = new Error(`CLI timed out: ${args.join(' ')}`); child.kill('SIGKILL'); }, 15_000);
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('error', error => { failure = error; });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk; pending += chunk;
    try {
      for (let end; (end = pending.indexOf('\n')) >= 0;) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        assert.notEqual(line, '', 'JSONL must not contain blank lines');
        const event = JSON.parse(line) as KilnEvent;
        assert.equal(event.version, 1);
        assert.equal(typeof event.type, 'string');
        assert.ok(event.type.length > 0);
        assert.equal(typeof event.sessionId, 'string');
        assert.equal(new Date(event.time).toISOString(), event.time);
        events.push(event);
        options.onEvent?.(event, child);
      }
    } catch (error) { failure = error; child.kill('SIGKILL'); }
  });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') failure = error; });
  if (options.keepStdinOpen) { if (options.input) child.stdin.write(options.input); }
  else child.stdin.end(options.input ?? '');
  const result = await closed;
  if (failure) throw failure;
  assert.equal(result.signal, null, stderr);
  assert.equal(pending, '', 'every JSONL frame must end with LF');
  assert.ok(events.length, `CLI emitted no JSONL: ${stderr}`);
  assert.doesNotMatch(stdout, /[\x00-\x08\x0b-\x1f\x7f\u2028\u2029]/, 'no raw terminal controls or line separators');
  return { ...result, stdout, stderr, events };
}

function terminal(result: Awaited<ReturnType<typeof launch>>, outcome: 'success' | 'failure' | 'aborted', turns?: number) {
  assert.equal(result.code, outcome === 'success' ? 0 : outcome === 'aborted' ? 130 : 1, result.stderr + result.stdout);
  const ends = result.events.filter(event => event.type === 'agent.end');
  assert.equal(ends.length, 1, 'exactly one terminal agent event');
  assert.equal(ends[0]!.outcome, outcome);
  if (turns !== undefined) assert.equal(ends[0]!.turns, turns);
  if (outcome === 'success') assert.equal(ends[0]!.reason, 'stop');
  assert.ok(!result.events.slice(result.events.indexOf(ends[0]!) + 1).some(event => /^(model|assistant|tool|agent)\./.test(event.type)),
    'no more agent work after agent.end');
  if (result.events.some(event => event.type === 'session.start')) {
    assert.equal(result.events.at(-1)!.type, 'session.end');
    const id = result.events.find(event => event.type === 'session.start')!.sessionId;
    assert.ok(id);
    for (const event of result.events) assert.equal(event.sessionId, id);
  }
  return ends[0]!;
}

function correlated(body: WireRequest) {
  const pending = new Set<string>();
  const results = new Map<string, string>();
  for (const message of body.messages) {
    for (const tool of message.tool_calls ?? []) {
      assert.ok(!pending.has(tool.id) && !results.has(tool.id), `duplicate call ${tool.id}`);
      pending.add(tool.id);
    }
    if (message.role === 'tool') {
      assert.ok(message.tool_call_id && pending.delete(message.tool_call_id), 'tool result must follow its own call exactly once');
      assert.equal(typeof message.content, 'string');
      results.set(message.tool_call_id, message.content as string);
    }
  }
  assert.equal(pending.size, 0, 'all prior calls must have a correlated result before the next model request');
  return results;
}

async function command<T>(t: TestContext, w: Workspace, args: string[]): Promise<T> {
  const result = await launch(t, w, args);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.deepEqual(result.events.map(event => event.type), ['command.result']);
  assert.equal(result.events[0]!.command, args[0]);
  return result.events[0]!.value as T;
}

test('compiled CLI reads, makes a wrong edit, sees real failing tests, corrects and stops only after passing tests', { timeout: 30_000 }, async t => {
  const w = await workspace(t);
  await writeFile(join(w.cwd, 'math.mjs'), original);
  await writeFile(join(w.cwd, 'test.mjs'), checks);
  const script = [
    [call('read-source', 'read_file', { path: 'math.mjs' }), call('read-tests', 'read_file', { path: 'test.mjs' })],
    [call('wrong-edit', 'edit_file', { path: 'math.mjs', old_string: original, new_string: wrong })],
    [call('failing-tests', 'shell', { command: 'node --test test.mjs' })],
    [call('correct-edit', 'edit_file', { path: 'math.mjs', old_string: wrong, new_string: corrected })],
    [call('passing-tests', 'shell', { command: 'node --test test.mjs' })],
  ];
  const provider = await fakeProvider(t, async (body, index) => {
    assert.equal(body.model, 'fixture');
    const results = correlated(body);
    if (index === 1) {
      assert.match(results.get('read-source')!, /1: export const add = \(a, b\) => a - b;/);
      assert.match(results.get('read-tests')!, /assert.equal\(add\(2, 3\), 5\)/);
    }
    if (index === 2 || index === 3) assert.equal(await readFile(join(w.cwd, 'math.mjs'), 'utf8'), wrong);
    if (index === 3) {
      assert.match(results.get('failing-tests')!, /Exit code: 1/);
      assert.match(results.get('failing-tests')!, /ERR_ASSERTION|AssertionError/);
    }
    if (index === 4 || index === 5) assert.equal(await readFile(join(w.cwd, 'math.mjs'), 'utf8'), corrected);
    if (index === 5) {
      assert.match(results.get('passing-tests')!, /Exit code: 0/);
      assert.match(results.get('passing-tests')!, /(?:#|\u2139) pass 1/);
      return { text: 'Verified correction.\nBoth assertions pass.\u2028Final stop.' };
    }
    assert.ok(script[index], 'unexpected extra model turn');
    return { calls: script[index] };
  });
  await w.configure(localConfig(provider.baseURL));
  assert.equal((await stat(join(w.configDir, 'config.json'))).mode & 0o777, 0o600);
  assert.equal(Object.keys(w.env).some(key => /ANTHROPIC|OPENAI|KEY|TOKEN|CREDENTIAL|PROXY|NODE_OPTIONS/.test(key)), false);
  const result = await launch(t, w, ['--allow', 'edit_file:math.mjs', '--allow', 'shell:node --test test.mjs', 'run', 'Fix addition and verify it.']);
  terminal(result, 'success', 6);
  assert.equal(provider.requests.length, 6);
  assert.equal(await readFile(join(w.cwd, 'math.mjs'), 'utf8'), corrected);
  assert.equal(await readFile(join(w.cwd, 'test.mjs'), 'utf8'), checks);
  assert.deepEqual(result.events.slice(0, 6).map(event => event.type),
    ['session.start', 'project.context', 'project.git', 'configuration', 'agent.start', 'message.user']);
  const starts = result.events.filter(event => event.type === 'tool.start');
  const ends = result.events.filter(event => event.type === 'tool.end');
  assert.deepEqual(starts.map(event => event.id), script.flat().map(tool => tool.id));
  assert.deepEqual(new Set(ends.map(event => event.id)), new Set(starts.map(event => event.id)));
  assert.equal(ends.length, starts.length);
  for (const start of starts) {
    const end = ends.find(event => event.id === start.id)!;
    assert.equal(end.name, start.name);
    assert.ok(result.events.indexOf(start) < result.events.indexOf(end));
    assert.equal(end.isError, start.id === 'failing-tests');
  }
  for (const [id, code] of [['failing-tests', 1], ['passing-tests', 0]] as const) {
    const end = ends.find(event => event.id === id)!;
    assert.equal((end.metadata as { code: number }).code, code);
    const saved = result.events.find(event => event.type === 'tool.output_saved' && event.id === id)!;
    assert.equal(saved.complete, true);
    assert.equal(saved.status, code ? 'error' : 'success');
    const paths = saved.outputPaths as { stdout: string; stderr: string };
    assert.match(await readFile(paths.stdout, 'utf8'), /RAW_STDOUT_MARKER/);
    assert.match(await readFile(paths.stdout, 'utf8') + await readFile(paths.stderr, 'utf8'), /RAW_STDERR_MARKER/);
  }
  assert.ok(result.events.some(event => event.type === 'tool.progress' && String(event.text).includes('RAW_STDOUT_MARKER')));
  assert.doesNotMatch(result.stderr, /RAW_STDOUT_MARKER|RAW_STDERR_MARKER|Verified correction|\[shell\]/);
  assert.equal(result.events.filter(event => event.type === 'model.start').length, 6);
  assert.deepEqual(result.events.filter(event => event.type === 'assistant.end').map(event => event.reason),
    ['tool-use', 'tool-use', 'tool-use', 'tool-use', 'tool-use', 'stop']);
  assert.equal(result.events.filter(event => event.type === 'usage').length, 6);
  const modelStarts = result.events.flatMap((event, index) => event.type === 'model.start' ? [index] : []);
  for (const [turn, start] of modelStarts.entries()) {
    const events = result.events.slice(start, modelStarts[turn + 1] ?? result.events.findIndex(event => event.type === 'agent.end'));
    const assistantEnd = events.findIndex(event => event.type === 'assistant.end');
    assert.ok(assistantEnd > 0);
    assert.ok(events.findIndex(event => event.type === 'usage') < assistantEnd);
    assert.deepEqual(events.filter(event => event.type === 'tool.start').map(event => event.id), (script[turn] ?? []).map(tool => tool.id));
    assert.equal(events.filter(event => event.type === 'tool.end').length, script[turn]?.length ?? 0,
      'a tool batch must settle before the next model turn');
    for (const [index, event] of events.entries()) {
      if (event.type === 'tool.start') assert.ok(index > assistantEnd, 'calls execute only after the complete assistant turn');
      if (event.type === 'tool.progress' || event.type === 'tool.output_saved') {
        assert.equal(typeof event.id, 'string');
        assert.ok(index > events.findIndex(other => other.type === 'tool.start' && other.id === event.id));
        assert.ok(index < events.findIndex(other => other.type === 'tool.end' && other.id === event.id));
      }
    }
  }
  const lastResults = correlated(provider.requests.at(-1)!.body);
  for (const end of ends) assert.equal(lastResults.get(end.id as string), end.content);
  const verified = await promisify(execFile)(process.execPath, ['--test', 'test.mjs'], { cwd: w.cwd, env: w.env, timeout: 5000 });
  assert.match(verified.stdout, /(?:#|\u2139) pass 1/);
  assert.deepEqual(await readdir(w.home), [], 'explicit dirs must not create home configuration');
});

test('noninteractive writes and shell are denied by default and every denial reaches the provider', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  await writeFile(join(w.cwd, 'math.mjs'), original);
  const calls = [call('denied-edit', 'edit_file', { path: 'math.mjs', old_string: original, new_string: corrected }),
    call('denied-create', 'create_file', { path: 'created.txt', content: 'must not exist' }),
    call('denied-shell', 'shell', { command: 'node --test test.mjs' })];
  const provider = await fakeProvider(t, (body, index) => {
    if (index === 0) return { calls };
    assert.equal(index, 1);
    const results = correlated(body);
    for (const tool of calls) assert.match(results.get(tool.id)!, /Permission denied/);
    return { text: 'No changes made: permission was denied.' };
  });
  await w.configure(localConfig(provider.baseURL));
  const result = await launch(t, w, ['run', 'Try to change files.']);
  terminal(result, 'success', 2);
  assert.equal(await readFile(join(w.cwd, 'math.mjs'), 'utf8'), original);
  await assert.rejects(stat(join(w.cwd, 'created.txt')), { code: 'ENOENT' });
  await assert.rejects(stat(join(w.stateDir, 'outputs')), { code: 'ENOENT' });
  const requests = result.events.filter(event => event.type === 'permission.request');
  const decisions = result.events.filter(event => event.type === 'permission.decision');
  assert.equal(requests.length, 3); assert.equal(decisions.length, 3);
  for (const event of requests) {
    const request = event.request as { id: string; tool: string };
    const decision = decisions.find(event => event.requestId === request.id)!;
    assert.equal(decision.decision, 'deny');
    assert.ok(result.events.indexOf(event) < result.events.indexOf(decision));
  }
  assert.ok(result.events.filter(event => event.type === 'tool.end').every(event => event.isError === true));
  assert.equal(provider.requests.length, 2);
});

test('plan omits mutation schemas and rejects unsolicited mutation calls even with explicit allow rules', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  await writeFile(join(w.cwd, 'math.mjs'), original);
  const provider = await fakeProvider(t, (body, index) => {
    const names = body.tools!.map(tool => tool.function.name);
    assert.ok(names.includes('read_file') && names.includes('git_status'));
    for (const name of ['edit_file', 'create_file', 'shell']) assert.ok(!names.includes(name));
    if (index === 0) return { calls: [
      call('plan-read', 'read_file', { path: 'math.mjs' }),
      call('plan-edit', 'edit_file', { path: 'math.mjs', old_string: original, new_string: corrected }),
      call('plan-create', 'create_file', { path: 'created.txt', content: 'no' }),
      call('plan-shell', 'shell', { command: 'node --test test.mjs' }),
    ] };
    assert.equal(index, 1);
    const results = correlated(body);
    assert.match(results.get('plan-read')!, /a - b/);
    for (const id of ['plan-edit', 'plan-create', 'plan-shell']) assert.match(results.get(id)!, /disabled.*plan mode/);
    return { text: 'Read-only plan; no mutations executed.' };
  });
  await w.configure(localConfig(provider.baseURL));
  const result = await launch(t, w, ['--mode', 'plan', '--allow', 'edit_file:math.mjs', '--allow', 'create_file:created.txt',
    '--allow', 'shell:node --test test.mjs', 'run', 'Plan a correction.']);
  terminal(result, 'success', 2);
  assert.equal(await readFile(join(w.cwd, 'math.mjs'), 'utf8'), original);
  await assert.rejects(stat(join(w.cwd, 'created.txt')), { code: 'ENOENT' });
  assert.equal(result.events.some(event => event.type === 'permission.request' || event.type === 'tool.output_saved'), false);
});

test('real provider tool schemas reject invalid arguments before permissions or execution', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  await writeFile(join(w.cwd, 'math.mjs'), original);
  const provider = await fakeProvider(t, (body, index) => {
    const schema = body.tools!.find(tool => tool.function.name === 'edit_file')!.function.parameters;
    assert.equal(schema.type, 'object'); assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['path', 'old_string', 'new_string']);
    if (index === 0) return { calls: [call('bad-schema', 'edit_file', { path: 'math.mjs', old_string: original, new_string: corrected, unexpected: true })] };
    assert.equal(index, 1);
    assert.match(correlated(body).get('bad-schema')!, /Tool schema rejected arguments/);
    return { text: 'Invalid arguments were not executed.' };
  });
  await w.configure(localConfig(provider.baseURL));
  const result = await launch(t, w, ['--allow', 'edit_file:math.mjs', 'run', 'Try an invalid edit.']);
  terminal(result, 'success', 2);
  assert.equal(await readFile(join(w.cwd, 'math.mjs'), 'utf8'), original);
  assert.equal(result.events.some(event => event.type === 'permission.request'), false);
  assert.equal(result.events.find(event => event.type === 'tool.end')!.isError, true);
});

test('CLI reports provider failure, length truncation and runaway turns with exit 1, not a successful stop', { timeout: 30_000 }, async t => {
  for (const kind of ['http', 'length', 'runaway'] as const) await t.test(kind, async t => {
    const w = await workspace(t);
    const provider = await fakeProvider(t, () => kind === 'http' ? { status: 400, error: 'offline fixture refused request' }
      : kind === 'length' ? { text: 'Incomplete response', finish: 'length' }
        : { calls: [call('keep-going', 'read_file', { path: 'absent.txt' })] });
    await w.configure(localConfig(provider.baseURL));
    const result = await launch(t, w, ['--max-turns', '1', 'run', 'Exercise terminal failure.']);
    const end = terminal(result, 'failure', kind === 'http' ? 0 : 1);
    assert.equal(end.reason, 'error');
    assert.match(String(end.error), kind === 'http' ? /HTTP 400.*offline fixture refused/ : kind === 'length' ? /output limit/ : /Runaway safeguard/);
    assert.equal(provider.requests.length, 1);
    assert.equal(result.events.some(event => event.type === 'assistant.end' && event.reason === 'stop'), false);
  });
});

test('SIGINT during a live provider stream emits aborted once, closes HTTP and exits 130', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  const provider = await fakeProvider(t, () => ({ text: 'Waiting for cancellation', hold: true }));
  await w.configure(localConfig(provider.baseURL));
  let signalled = false;
  const result = await launch(t, w, ['run', 'Wait until interrupted.'], { onEvent: (event, child) => {
    if (event.type === 'assistant.delta' && !signalled) { signalled = true; assert.equal(child.kill('SIGINT'), true); }
  } });
  assert.equal(signalled, true);
  const end = terminal(result, 'aborted', 0);
  assert.equal(end.reason, 'aborted');
  assert.equal(provider.requests.length, 1);
  await provider.requests[0]!.closed;
  assert.equal(result.events.some(event => event.type === 'assistant.end' && event.reason === 'stop'), false);
});

test('the postbuild executable works through a symlink and its shebang for version, help, and a compiled run', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  const executable = join(w.root, 'kiln executable');
  await symlink(cli, executable);
  assert.ok((await stat(cli)).mode & 0o111, 'postbuild must make the compiled entry executable; the test must not chmod it');
  assert.equal((await readFile(cli, 'utf8')).split('\n')[0], '#!/usr/bin/env node');
  for (const [arg, expected] of [['--version', /^kiln 0\.1\.0\n$/], ['--help', /Usage\n\s+kiln/]] as const) {
    const result = await promisify(execFile)(executable, [arg], { cwd: w.home, env: w.env, timeout: 5000 });
    assert.match(result.stdout, expected);
    assert.doesNotMatch(result.stderr, /kiln:|Error:/);
  }
  const provider = await fakeProvider(t, body => {
    assert.equal(body.messages.at(-1)!.content, 'Run through the executable symlink.');
    return { text: 'The symlink entry ran.' };
  });
  await w.configure(localConfig(provider.baseURL));
  const result = await launch(t, w, ['run', 'Run through the executable symlink.'], { executable });
  terminal(result, 'success', 1);
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(await readdir(w.home), []);
});

test('SIGINT while waiting for idle piped stdin exits 130 and closes without receiving EOF', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  const provider = await fakeProvider(t, () => { assert.fail('idle stdin must not launch a provider request'); });
  await w.configure(localConfig(provider.baseURL));
  const preload = join(w.root, 'stdin-ready.mjs');
  await writeFile(preload, `
import { mock } from 'node:test';
const resume = process.stdin.resume;
let reported = false;
mock.method(process.stdin, 'resume', function (...args) {
  const result = resume.apply(this, args);
  if (!reported && this.listenerCount('data')) {
    reported = true;
    process.stdout.write(JSON.stringify({ version: 1, type: 'fixture.stdin.waiting', time: new Date().toISOString(), sessionId: '' }) + '\\n');
  }
  return result;
});
`);
  let signalled = false;
  let sessionId = '';
  const result = await launch(t, w, ['run'], { keepStdinOpen: true, nodeArgs: ['--import', preload], onEvent: (event, child) => {
    if (event.type === 'session.start') sessionId = event.sessionId;
    if (event.type === 'fixture.stdin.waiting') {
      assert.ok(sessionId, 'wait for session.start and the real stdin reader before signaling');
      assert.equal(child.stdin.writableEnded, false, 'stdin must still be open with no EOF');
      signalled = child.kill('SIGINT');
    }
  } });
  assert.equal(signalled, true);
  assert.equal(result.events.filter(event => event.type === 'fixture.stdin.waiting').length, 1);
  terminal({ ...result, events: result.events.filter(event => event.type !== 'fixture.stdin.waiting') }, 'aborted', 0);
  assert.equal(provider.requests.length, 0);
  assert.ok(result.events.some(event => event.type === 'project.git'));
  assert.equal(result.events.some(event => /^(configuration|agent\.start|model\.|tool\.|message\.user)/.test(event.type)), false);
  assert.deepEqual(await readdir(w.home), []);
});

test('SIGINT during initial config bootstrap aborts before creating a client or launching configured tools', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  const marker = join(w.cwd, 'external-launched');
  const provider = await fakeProvider(t, () => { assert.fail('bootstrap cancellation must not reach the provider'); });
  await w.configure({ ...localConfig(provider.baseURL), servers: [{ name: 'must-not-start', command: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched')`] }] });
  const preload = join(w.root, 'bootstrap.mjs');
  await writeFile(preload, `
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
const open = fs.open;
const blocked = mock.method(fs, 'open', async (...args) => {
  if (args[0] === ${JSON.stringify(join(w.configDir, 'config.json'))}) {
    const keepAlive = setTimeout(() => {}, 5000);
    const interrupted = new Promise(resolve => process.once('SIGINT', resolve));
    process.stdout.write(JSON.stringify({ version: 1, type: 'fixture.bootstrap', time: new Date().toISOString(), sessionId: '' }) + '\\n');
    try { await interrupted; } finally { clearTimeout(keepAlive); }
    blocked.mock.restore();
    syncBuiltinESMExports();
  }
  return open(...args);
});
syncBuiltinESMExports();
`);
  let signalled = false;
  const result = await launch(t, w, ['--allow', 'external_server:must-not-start', 'run', 'Must not start.'], {
    nodeArgs: ['--import', preload], onEvent: (event, child) => {
      if (event.type === 'fixture.bootstrap') signalled = child.kill('SIGINT');
    },
  });
  assert.equal(signalled, true);
  terminal(result, 'aborted', 0);
  assert.deepEqual(result.events.map(event => event.type), ['fixture.bootstrap', 'agent.end']);
  assert.equal(provider.requests.length, 0);
  await assert.rejects(stat(marker), { code: 'ENOENT' });
  assert.deepEqual(await readdir(w.stateDir), [], 'aborted bootstrap must not create a session database');
  assert.deepEqual(await readdir(w.home), []);
});

test('sessions list/search, resume original cwd, export/import inert history, fork and delete through compiled CLI', { timeout: 60_000 }, async t => {
  const w = await workspace(t);
  await writeFile(join(w.cwd, 'math.mjs'), original);
  const provider = await fakeProvider(t, (_body, index) => index === 0
    ? { calls: [call('session-edit', 'edit_file', { path: 'math.mjs', old_string: original, new_string: corrected })] }
    : { text: `Saved answer ${index}.` });
  await w.configure(localConfig(provider.baseURL));
  const first = await launch(t, w, ['--allow', 'edit_file:math.mjs', 'run', 'Remember the addition correction.']);
  const id = terminal(first, 'success', 2).sessionId;
  const listed = await command<SessionMeta[]>(t, w, ['sessions']);
  assert.deepEqual(listed.map(session => session.id), [id]);
  assert.equal(listed[0]!.cwd, w.cwd);
  assert.deepEqual((await command<SessionMeta[]>(t, w, ['sessions', id])).map(session => session.id), [id]);
  assert.deepEqual(await command(t, w, ['sessions', 'no-such-session']), []);
  const resumed = await launch(t, w, ['resume', id, '--prompt', 'What did you change?'], { cwd: w.home });
  assert.equal(terminal(resumed, 'success', 1).sessionId, id);
  const resumedBody = provider.requests[2]!.body;
  assert.match(String(resumedBody.messages[0]!.content), new RegExp(`Workspace: ${w.cwd}`));
  assert.ok(resumedBody.messages.some(message => message.content === 'Remember the addition correction.'));
  assert.ok(resumedBody.messages.some(message => message.content === 'Saved answer 1.'));
  assert.equal(resumedBody.messages.at(-1)!.content, 'What did you change?');
  assert.match(correlated(resumedBody).get('session-edit')!, /a \+ b/);
  const mismatch = await launch(t, w, ['--cwd', w.home, 'resume', id, '--prompt', 'Wrong workspace.']);
  assert.match(String(terminal(mismatch, 'failure').error), /belongs to/);
  assert.equal(provider.requests.length, 3);
  const latest = await launch(t, w, ['--resume', 'latest', 'run', 'Continue the latest session.'], { cwd: w.home });
  assert.equal(terminal(latest, 'success', 1).sessionId, id);
  const exported = await command<string>(t, w, ['sessions', 'export', id]);
  const document = JSON.parse(exported) as { version: number; meta: SessionMeta; records: SessionRecord[] };
  assert.equal(document.version, 1); assert.equal(document.meta.id, id);
  assert.ok(document.records.some(record => record.type === 'checkpoint'));
  const history = document.records.filter(record => record.type === 'message').map(record => record.data.message as Message);
  assert.ok(history.some(message => message.toolCallId === 'session-edit' && !message.isError));
  const exportPath = join(w.root, 'export.json');
  await writeFile(exportPath, exported, { mode: 0o600 });
  // Neither importing nor forking documentary edits may replay them on disk.
  const sentinel = 'User changed this after the run.\n';
  await writeFile(join(w.cwd, 'math.mjs'), sentinel);
  const imported = await command<SessionMeta>(t, w, ['sessions', 'import', exportPath]);
  const fork = await command<SessionMeta>(t, w, ['sessions', 'fork', id]);
  assert.equal(new Set([id, imported.id, fork.id]).size, 3);
  assert.equal(imported.parentSession, id); assert.equal(fork.parentSession, id);
  assert.equal(await readFile(join(w.cwd, 'math.mjs'), 'utf8'), sentinel);
  const importedDocument = JSON.parse(await command<string>(t, w, ['sessions', 'export', imported.id])) as typeof document;
  assert.deepEqual(importedDocument.records, document.records);
  const forkDocument = JSON.parse(await command<string>(t, w, ['sessions', 'export', fork.id])) as typeof document;
  assert.deepEqual(forkDocument.records, document.records);
  assert.deepEqual(new Set((await command<SessionMeta[]>(t, w, ['sessions'])).map(session => session.id)), new Set([id, imported.id, fork.id]));
  assert.equal(provider.requests.length, 4, 'session administration never calls a model');
  for (const sessionId of [id, imported.id, fork.id]) assert.equal(await command(t, w, ['sessions', 'delete', sessionId]), `Deleted ${sessionId}`);
  assert.deepEqual(await command(t, w, ['sessions']), []);
  const missing = await launch(t, w, ['resume', id, '--prompt', 'Deleted session.']);
  assert.match(String(terminal(missing, 'failure').error), /Session not found/);
  assert.equal(await readFile(join(w.cwd, 'math.mjs'), 'utf8'), sentinel);
});

test('ephemeral run accepts piped input and removes temporary artifacts without writing a session database', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  await writeFile(join(w.cwd, 'math.mjs'), corrected);
  await writeFile(join(w.cwd, 'test.mjs'), checks);
  let outputs: { stdout: string; stderr: string } | undefined;
  const provider = await fakeProvider(t, async (body, index) => {
    if (index === 0) {
      assert.equal(body.messages.at(-1)!.content, 'Run ephemeral checks.');
      return { calls: [call('ephemeral-tests', 'shell', { command: 'node --test test.mjs' })] };
    }
    assert.equal(index, 1);
    assert.match(correlated(body).get('ephemeral-tests')!, /Exit code: 0/);
    const text = String(body.messages.at(-1)!.content);
    const stdout = /Complete redacted stdout: (.+)/.exec(text)![1]!;
    const stderr = /Complete redacted stderr: (.+)/.exec(text)![1]!;
    outputs = { stdout, stderr };
    assert.match(await readFile(stdout, 'utf8'), /RAW_STDOUT_MARKER/);
    assert.ok(dirname(dirname(stdout)).startsWith(join(w.home, 'kiln-ephemeral-')));
    await assert.rejects(stat(join(dirname(dirname(stdout)), 'sessions.sqlite')), { code: 'ENOENT' });
    return { text: 'Ephemeral checks passed.' };
  });
  await w.configure(localConfig(provider.baseURL));
  const result = await launch(t, w, ['--ephemeral', '--allow', 'shell:node --test test.mjs', 'run'], { input: 'Run ephemeral checks.\n' });
  terminal(result, 'success', 2);
  assert.equal(result.events.find(event => event.type === 'session.start')!.ephemeral, true);
  assert.ok(outputs);
  await assert.rejects(stat(dirname(dirname(outputs.stdout))), { code: 'ENOENT' });
  assert.deepEqual(await readdir(w.stateDir), []);
  assert.deepEqual(await readdir(w.home), []);
  for (const args of [['--ephemeral', 'sessions'], ['--ephemeral', '--resume', 'latest', 'run', 'no']]) {
    const invalid = await launch(t, w, args);
    assert.match(String(terminal(invalid, 'failure').error), /ephemeral cannot resume or manage/);
  }
  assert.equal(provider.requests.length, 2);
});
