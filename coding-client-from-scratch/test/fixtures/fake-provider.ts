import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import type { Config, Model, ToolCall } from '../../src/types.js';

export const localModel: Model = {
  id: 'fixture', provider: 'local', name: 'Offline fixture', contextWindow: 200_000, maxOutput: 4096,
  capabilities: { tools: true, images: true, reasoning: true },
};

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}
export interface WireRequest {
  model: string;
  stream: boolean;
  messages: WireMessage[];
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  reasoning_effort?: string;
}
interface Reply {
  text?: string;
  calls?: ToolCall[];
  finish?: 'stop' | 'tool_calls' | 'length';
  status?: number;
  error?: string;
  hold?: boolean;
}

export function call(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

export async function fakeProvider(t: TestContext, respond: (body: WireRequest, index: number) => Reply | Promise<Reply>) {
  const requests: Array<{ body: WireRequest; headers: IncomingHttpHeaders; closed: Promise<void> }> = [];
  const errors: unknown[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(req.headers.authorization, undefined, 'fixture must not receive credentials');
      assert.equal(req.headers['x-api-key'], undefined, 'fixture must not receive credentials');
      const buffers: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        assert.ok(bytes <= 8 * 1024 * 1024, 'unexpectedly large provider request');
        buffers.push(buffer);
      }
      const body = JSON.parse(Buffer.concat(buffers).toString('utf8')) as WireRequest;
      assert.equal(body.stream, true);
      assert.ok(Array.isArray(body.messages));
      const closed = new Promise<void>(resolve => res.once('close', resolve));
      const index = requests.push({ body, headers: req.headers, closed }) - 1;
      const reply = await respond(body, index);
      if (reply.status) {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: reply.error ?? 'fixture failure' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = (delta: Record<string, unknown>, finish: string | null = null) => {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      };
      if (reply.text) frame({ content: reply.text });
      for (const [index, tool] of (reply.calls ?? []).entries()) {
        const split = Math.floor(tool.arguments.length / 2);
        frame({ tool_calls: [{ index, id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments.slice(0, split) } }] });
        frame({ tool_calls: [{ index, function: { arguments: tool.arguments.slice(split) } }] });
      }
      if (reply.hold) { res.flushHeaders(); return; }
      frame({}, reply.finish ?? (reply.calls?.length ? 'tool_calls' : 'stop'));
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    })().catch(error => {
      errors.push(error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Fake provider assertion failed; see test teardown' } }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.deepEqual(errors, [], 'fake provider handler failed');
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { baseURL: `http://127.0.0.1:${address.port}/v1`, requests };
}

export function localConfig(baseURL: string): Partial<Config> {
  return { model: 'local/fixture', models: [localModel], providers: { local: { type: 'openai', baseURL } },
    enabledModels: ['local/*'], retries: 0, maxTurns: 10 };
}

// An allowlist also drops NODE_OPTIONS, NODE_TEST_CONTEXT, proxy settings and Git overrides.
export function offlineEnv(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg-config'), XDG_STATE_HOME: join(home, 'xdg-state'),
    TMPDIR: home, LANG: 'C.UTF-8', LC_ALL: 'C', SHELL: '/bin/sh', NO_COLOR: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' };
}

export async function workspace(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'kiln-cli-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'project');
  const configDir = join(root, 'config');
  const stateDir = join(root, 'state');
  const home = join(root, 'home');
  await Promise.all([cwd, configDir, stateDir, home].map(path => mkdir(path, { mode: 0o700 })));
  const env = offlineEnv(home);
  let git: string | undefined;
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = resolve(directory, 'git');
    try { await access(candidate, constants.X_OK); git = await realpath(candidate); break; } catch { /* Try the next PATH entry. */ }
  }
  assert.ok(git, 'git must be installed');
  await promisify(execFile)(git, ['-c', 'core.hooksPath=/dev/null', '-c', 'init.templateDir=', 'init', '--quiet', cwd], { env, timeout: 10_000 });
  const configure = async (value: unknown) => writeFile(join(configDir, 'config.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  return { root, cwd, configDir, stateDir, home, env, git, configure };
}
