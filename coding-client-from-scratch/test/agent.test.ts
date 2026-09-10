import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Agent, contextSize, type AgentOptions } from '../src/agent.js';
import { PermissionManager } from '../src/permissions.js';
import { estimateCost, ProviderError } from '../src/providers.js';
import { SessionStore } from '../src/sessions.js';
import { createBuiltinTools } from '../src/tools.js';
import type {
  KilnEvent, Message, Mode, Model, ModelRequest, PermissionPrompt, PermissionRequest,
  ProviderChunk, SessionRecord, StopReason, Tool, ToolCall, ToolContext,
} from '../src/types.js';
import { abortError, eventEmitter, hash, jsonLine, redactor, StreamRedactor } from '../src/util.js';

const model: Model = {
  id: 'history-driven', provider: 'offline', name: 'Offline test model',
  contextWindow: 128_000, maxOutput: 8192,
  capabilities: { tools: true, images: false, reasoning: true },
  pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};
const prompt: Message = { role: 'user', content: 'Complete the requested work and verify the result.' };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function assertSettled(history: Message[]): void {
  const pending = new Map<string, ToolCall>();
  const seen = new Set<string>();
  for (const message of history) {
    if (message.role === 'tool') {
      const call = pending.get(message.toolCallId ?? '');
      assert.ok(call, `orphan or duplicate result: ${message.toolCallId}`);
      assert.equal(message.toolName, call.name);
      pending.delete(call.id);
    } else {
      assert.equal(pending.size, 0, 'a model/user message must not split an unsettled tool batch');
      for (const call of message.toolCalls ?? []) {
        assert.ok(!seen.has(call.id), `reused tool-call id: ${call.id}`);
        seen.add(call.id);
        pending.set(call.id, call);
      }
    }
  }
  assert.equal(pending.size, 0, 'every call must settle before the next model request');
}

// Responses inspect the actual durable history, never an application-supplied turn script.
function fakeProvider(respond: (request: ModelRequest) => AsyncIterable<ProviderChunk>) {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async *stream(request: ModelRequest): AsyncGenerator<ProviderChunk> {
      assert.ok(request.model.contextWindow >= 32_000, 'use a realistic model context window');
      assert.ok(request.model.maxOutput >= 1024 && request.model.maxOutput < request.model.contextWindow);
      assertSettled(request.messages);
      const tools = request.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
      const inputTokens = Math.ceil(Buffer.byteLength(request.system + JSON.stringify(request.messages) + JSON.stringify(tools)) / 3);
      requests.push({ ...request, model: structuredClone(request.model), messages: structuredClone(request.messages), tools: structuredClone(tools) });
      if (inputTokens + request.model.maxOutput > request.model.contextWindow) {
        throw new ProviderError('Offline model context capacity exceeded', { contextOverflow: true });
      }
      yield* respond(request);
    },
  };
}

function call(name: string, args: Record<string, unknown>, id = name): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function* batch(...calls: ToolCall[]): Generator<ProviderChunk> {
  for (const [index, item] of calls.entries()) yield { type: 'tool', index, ...item };
  yield { type: 'stop', reason: 'tool-use' };
}

function* finish(text = 'Work verified.'): Generator<ProviderChunk> {
  yield { type: 'text', text };
  yield { type: 'stop', reason: 'stop' };
}

function results(history: Message[]): Message[] {
  return history.filter(message => message.role === 'tool');
}

function argsFor(history: Message[], result: Message): Record<string, unknown> {
  const item = history.flatMap(message => message.toolCalls ?? []).find(call => call.id === result.toolCallId);
  assert.ok(item, `missing call for ${result.toolCallId}`);
  return JSON.parse(item.arguments) as Record<string, unknown>;
}

function probe(name: string, readonly: boolean, execute: Tool['execute']): Tool {
  return { name, readonly, description: `Offline ${name} probe`,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, execute };
}

async function fixture(t: TestContext, options: {
  secrets?: string[]; mode?: Mode; prompt?: PermissionPrompt; onEvent?: (event: KilnEvent) => void;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kiln-agent-'));
  const cwd = join(root, 'project');
  const stateDir = join(root, 'state');
  await mkdir(cwd);
  await mkdir(stateDir);
  const redact = redactor(options.secrets ?? []);
  let store = new SessionStore(stateDir, { redact });
  let session = store.create(cwd);
  const events: KilnEvent[] = [];
  const lines: string[] = [];
  const approvals: PermissionRequest[] = [];
  const emit = eventEmitter(session.meta.id, event => {
    events.push(event);
    lines.push(jsonLine(event));
    options.onEvent?.(event);
  }, redact);
  const context: Omit<ToolContext, 'signal'> = {
    cwd, stateDir, mode: options.mode ?? 'build', emit, secrets: options.secrets ?? [], redact,
    checkpoint: change => { session.append('checkpoint', { ...change }); },
    prepareCheckpoint: change => session.prepareCheckpoint!(change),
    permissions: new PermissionManager({ cwd, stateDir, mode: options.mode ?? 'build', emit, prompt: async (request, signal) => {
      approvals.push(request);
      return options.prompt ? options.prompt(request, signal) : { decision: 'deny' };
    } }),
  };
  const agents: Agent[] = [];
  t.after(async () => {
    for (const agent of agents) agent.abort();
    session.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    cwd, stateDir, context, events, lines, approvals,
    get session() { return session; },
    get store() { return store; },
    reopen() {
      const id = session.meta.id;
      session.close();
      store.close();
      store = new SessionStore(stateDir, { redact });
      session = store.open(id);
      return session;
    },
    agent(provider: AgentOptions['provider'], tools: Tool[] = [], overrides: Partial<Pick<AgentOptions,
      'maxTurns' | 'retries' | 'retryBaseMs' | 'hook' | 'model' | 'thinking'>> = {}) {
      const agent = new Agent({ session, provider, model, tools, system: 'Use observed tool results. Never invent success.',
        context, emit, maxTurns: 12, retries: 0, ...overrides });
      agents.push(agent);
      return agent;
    },
  };
}

test('history-driven agent reads fixtures, edits, observes real node --test failure, corrects and verifies with approved durable checkpoints', { timeout: 15_000 }, async t => {
  const h = await fixture(t, { prompt: async () => ({ decision: 'once' }) });
  const original = 'module.exports = (a, b) => a - b;\n';
  await writeFile(join(h.cwd, 'sum.cjs'), original);
  await writeFile(join(h.cwd, 'sum.test.cjs'), [
    "const test = require('node:test');", "const assert = require('node:assert/strict');", "const sum = require('./sum.cjs');",
    "test('positive operands', () => assert.equal(sum(2, 3), 5));",
    "test('zero operands', () => assert.equal(sum(0, 0), 0));", '',
  ].join('\n'));
  const provider = fakeProvider(async function* ({ messages, tools }) {
    assert.ok(['read_file', 'edit_file', 'shell'].every(name => tools.some(tool => tool.name === name)));
    const observed = results(messages);
    const last = observed.at(-1);
    if (!last) {
      assert.match(messages.at(-1)!.content, /sum\.cjs/);
      yield* batch(call('read_file', { path: 'sum.cjs' }, 'source'), call('read_file', { path: 'sum.test.cjs' }, 'tests'));
    } else if (last.toolName === 'edit_file') {
      assert.equal(last.isError, false, last.content);
      // A child node --test must not inherit the parent runner's recursion marker or loader hooks.
      yield* batch(call('shell', { command: `env -u NODE_TEST_CONTEXT -u NODE_OPTIONS "${process.execPath}" --test --test-reporter=tap sum.test.cjs`, timeout_ms: 5000 }, `verify-${observed.length}`));
    } else if (last.toolName === 'shell') {
      if (last.isError) {
        assert.match(last.content, /Exit code: 1/);
        assert.match(last.content, /ERR_ASSERTION|AssertionError/);
        yield* batch(call('read_file', { path: 'sum.cjs' }, 'reread-after-failure'));
      } else {
        assert.match(last.content, /Exit code: 0/);
        assert.match(last.content, /# pass 2/);
        assert.match(last.content, /# fail 0/);
        yield* finish('Both observed sum tests pass after correcting the off-by-one.');
      }
    } else {
      const source = observed.findLast(result => result.toolName === 'read_file' && argsFor(messages, result).path === 'sum.cjs');
      const tests = observed.find(result => result.toolCallId === 'tests');
      assert.ok(source && tests);
      assert.equal(source.isError, false, source.content);
      assert.match(tests.content, /sum\(2, 3\), 5/);
      const old = source.content.replace(/^\d+: /gm, '');
      const failed = observed.some(result => result.toolName === 'shell' && result.isError);
      assert.match(old, failed ? /a \+ b \+ 1/ : /a - b/);
      // The first hypothesis is deliberately wrong; only the received failure enables correction.
      const replacement = failed ? old.replace('a + b + 1', 'a + b') : old.replace('a - b', 'a + b + 1');
      yield* batch(call('edit_file', { path: String(argsFor(messages, source).path), old_string: old, new_string: replacement }, failed ? 'correction' : 'hypothesis'));
    }
  });
  const agent = h.agent(provider, createBuiltinTools());
  assert.deepEqual(await agent.run({ role: 'user', content: 'Fix sum.cjs using sum.test.cjs and run the tests.' }), { outcome: 'success', reason: 'stop', turns: 7 });
  assert.equal(await readFile(join(h.cwd, 'sum.cjs'), 'utf8'), original.replace('a - b', 'a + b'));
  assert.equal(provider.requests.length, 7);
  assert.equal(h.events.filter(event => event.type === 'compaction.start').length, 0);
  assert.deepEqual(h.approvals.map(request => request.action), ['write', 'shell', 'write', 'shell']);
  assert.ok(h.approvals.every(request => request.cwd === h.cwd));
  for (const request of h.approvals) {
    const requested = h.events.findIndex(event => event.type === 'permission.request' && (event.request as PermissionRequest).id === request.id);
    const decided = h.events.findIndex(event => event.type === 'permission.decision' && event.requestId === request.id);
    assert.ok(requested >= 0 && decided > requested);
    assert.equal(h.events[decided]!.decision, 'once');
  }
  const checkpoints = h.session.records().filter(record => record.type === 'checkpoint');
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0]!.data.before, original);
  assert.equal(checkpoints[1]!.data.before, checkpoints[0]!.data.after);
  assert.equal(checkpoints[1]!.data.after, original.replace('a - b', 'a + b'));
  for (const { data } of checkpoints) {
    assert.equal(data.path, join(h.cwd, 'sum.cjs'));
    assert.equal(data.beforeHash, hash(data.before as string));
    assert.equal(data.afterHash, hash(data.after as string));
  }
  const shellEnds = h.events.filter(event => event.type === 'tool.end' && event.name === 'shell');
  assert.deepEqual(shellEnds.map(event => event.isError), [true, false]);
  for (const event of shellEnds) {
    const metadata = event.metadata as { code: number; outputPaths: { stdout: string; stderr: string } };
    const output = await readFile(metadata.outputPaths.stdout, 'utf8');
    assert.match(output, metadata.code ? /not ok/ : /# fail 0/);
    assert.ok(h.events.some(progress => progress.type === 'tool.progress' && progress.id === event.id && progress.name === 'shell'));
  }
  assertSettled(h.session.history());
  const history = h.session.history();
  assert.deepEqual(h.reopen().history(), history);
  await h.session.undo();
  assert.equal(await readFile(join(h.cwd, 'sum.cjs'), 'utf8'), checkpoints[1]!.data.before);
  await h.session.redo();
  assert.equal(await readFile(join(h.cwd, 'sum.cjs'), 'utf8'), checkpoints[1]!.data.after);
});

test('parallel real reads settle before mutation barriers; same-file edits serialize and subsequent reads see both edits', { timeout: 10_000 }, async t => {
  const h = await fixture(t, { prompt: async () => ({ decision: 'once' }) });
  await writeFile(join(h.cwd, 'a.txt'), 'one\n');
  await writeFile(join(h.cwd, 'b.txt'), 'other\n');
  const bothStarted = deferred();
  const releaseA = deferred();
  const releaseB = deferred();
  const tools = createBuiltinTools().map(tool => tool.name !== 'read_file' ? tool : {
    ...tool, async execute(args: Record<string, unknown>, context: ToolContext) {
      if (!h.session.records().some(record => record.type === 'checkpoint')) {
        started.push(String(args.path));
        if (started.length === 2) bothStarted.resolve();
        await (args.path === 'a.txt' ? releaseA.promise : releaseB.promise);
      }
      return tool.execute(args, context);
    },
  });
  const started: string[] = [];
  const provider = fakeProvider(async function* ({ messages }) {
    if (!results(messages).length) yield* batch(
      call('read_file', { path: 'a.txt' }, 'read-a'), call('read_file', { path: 'b.txt' }, 'read-b'),
      call('edit_file', { path: 'a.txt', old_string: 'one', new_string: 'two' }, 'edit-one'),
      call('edit_file', { path: './a.txt', old_string: 'two', new_string: 'three' }, 'edit-two'),
      call('read_file', { path: 'a.txt' }, 'read-after'),
    );
    else {
      assert.equal(results(messages).length, 5);
      assert.ok(results(messages).every(result => !result.isError));
      assert.equal(results(messages).find(result => result.toolCallId === 'read-after')!.content, '1: three');
      yield* finish();
    }
  });
  const agent = h.agent(provider, tools);
  const run = agent.run(prompt);
  try {
    await bothStarted.promise;
    assert.deepEqual(started, ['a.txt', 'b.txt']);
    assert.equal(await readFile(join(h.cwd, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(h.approvals.length, 0, 'no write approval before reads finish');
    releaseB.resolve();
    await nextTurn();
    assert.ok(!h.events.some(event => event.type === 'tool.start' && event.id === 'edit-one'));
    releaseA.resolve();
    assert.equal((await run).outcome, 'success');
  } finally {
    releaseA.resolve(); releaseB.resolve(); agent.abort(); await run;
  }
  const position = (type: string, id: string) => {
    const index = h.events.findIndex(event => event.type === type && event.id === id);
    assert.ok(index >= 0, `${type} ${id} missing`);
    return index;
  };
  for (const id of ['read-a', 'read-b']) assert.ok(position('tool.end', id) < position('tool.start', 'edit-one'));
  assert.ok(position('tool.end', 'edit-one') < position('tool.start', 'edit-two'));
  assert.ok(position('tool.end', 'edit-two') < position('tool.start', 'read-after'));
  assert.equal(await readFile(join(h.cwd, 'a.txt'), 'utf8'), 'three\n');
  assert.deepEqual(h.session.records().filter(record => record.type === 'checkpoint').map(record => [record.data.before, record.data.after]),
    [['one\n', 'two\n'], ['two\n', 'three\n']]);
});

test('read concurrency is bounded to eight and all results reach the next model', { timeout: 10_000 }, async t => {
  const h = await fixture(t);
  const ready = deferred();
  const release = deferred();
  let active = 0;
  let peak = 0;
  const read = probe('read_probe', true, async args => {
    peak = Math.max(peak, ++active);
    if (active === 8) ready.resolve();
    try { await release.promise; return { content: String(args.value) }; }
    finally { active--; }
  });
  const provider = fakeProvider(async function* ({ messages }) {
    if (!results(messages).length) yield* batch(...Array.from({ length: 19 }, (_, i) => call(read.name, { value: String(i) }, `read-${i}`)));
    else {
      assert.deepEqual(results(messages).map(result => Number(result.content)).sort((a, b) => a - b), Array.from({ length: 19 }, (_, i) => i));
      yield* finish();
    }
  });
  const agent = h.agent(provider, [read]);
  const run = agent.run(prompt);
  try {
    await ready.promise;
    await nextTurn();
    assert.equal(active, 8);
    release.resolve();
    assert.equal((await run).outcome, 'success');
    assert.equal(peak, 8);
    assert.equal(active, 0);
  } finally { release.resolve(); agent.abort(); await run; }
});

test('schema rejection, malformed JSON, unknown tools and thrown tools each produce one correlated error without blocking siblings', async t => {
  const h = await fixture(t);
  const executed: string[] = [];
  const read = probe('read_probe', true, async args => { executed.push(String(args.value)); return { content: String(args.value) }; });
  const broken = probe('broken_probe', false, async () => { throw new Error('controlled tool failure'); });
  const calls = [
    call(read.name, { value: 'before' }, 'valid-before'),
    call(read.name, { value: 42 }, 'wrong-type'), call(read.name, { value: 'x', extra: true }, 'extra-property'),
    call(read.name, {}, 'missing-property'), { id: 'malformed', name: read.name, arguments: '{"value":' },
    call('unregistered_tool', { value: 'x' }, 'unknown'), call(broken.name, { value: 'x' }, 'throws'),
    call(read.name, { value: 'after' }, 'valid-after'),
  ];
  const provider = fakeProvider(async function* ({ messages }) {
    if (!results(messages).length) yield* batch(...calls);
    else {
      const observed = results(messages);
      assert.equal(observed.length, calls.length);
      for (const item of calls) {
        const result = observed.find(result => result.toolCallId === item.id)!;
        assert.equal(result.toolName, item.name);
        assert.equal(result.isError, !item.id.startsWith('valid'));
      }
      for (const id of ['wrong-type', 'extra-property', 'missing-property']) {
        assert.match(observed.find(result => result.toolCallId === id)!.content, /Tool schema rejected arguments/);
      }
      assert.match(observed.find(result => result.toolCallId === 'unknown')!.content, /Unknown tool: unregistered_tool/);
      assert.match(observed.find(result => result.toolCallId === 'throws')!.content, /controlled tool failure/);
      yield* finish('Errors observed and reported.');
    }
  });
  assert.equal((await h.agent(provider, [read, broken]).run(prompt)).outcome, 'success');
  assert.deepEqual(executed, ['before', 'after']);
  assert.equal(h.events.filter(event => event.type === 'tool.end').length, calls.length);
  assertSettled(h.reopen().history());
});

test('fragmented interleaved arguments, text, reasoning signatures and usage are assembled without early tool execution', async t => {
  const h = await fixture(t);
  const executed: Record<string, unknown>[] = [];
  const read = probe('read_probe', true, async args => { executed.push(args); return { content: String(args.value) }; });
  const usage = { input: 1000, output: 200, reasoning: 80, cacheRead: 400, cacheWrite: 100 };
  const provider = fakeProvider(async function* ({ messages, thinking }) {
    assert.equal(thinking, 'high');
    if (!results(messages).length) {
      yield { type: 'tool', index: 7, id: 'second', name: read.name, arguments: '{"val' };
      yield { type: 'text', text: 'Checking ' };
      yield { type: 'reasoning', text: 'Compare ', signature: 'sig-' };
      yield { type: 'tool', index: 2, id: 'first', name: read.name, arguments: '{"value":"a\\' };
      yield { type: 'tool', index: 7, arguments: 'ue":"b"}' };
      yield { type: 'reasoning', text: 'both.' };
      yield { type: 'reasoning', text: '', signature: 'complete' };
      yield { type: 'tool', index: 2, arguments: '"quoted\\nline"}' };
      yield { type: 'text', text: 'both.' };
      yield { type: 'usage', usage: { input: 1000, output: 0 } };
      yield { type: 'usage', usage };
      assert.equal(executed.length, 0, 'tools must wait for the complete stream and terminal event');
      yield { type: 'stop', reason: 'tool-use' };
    } else {
      const assistant = messages.find(message => message.role === 'assistant')!;
      assert.equal(assistant.content, 'Checking both.');
      assert.equal(assistant.reasoning, 'Compare both.');
      assert.equal(assistant.reasoningSignature, 'sig-complete');
      assert.deepEqual(assistant.toolCalls!.map(call => call.id), ['first', 'second']);
      assert.deepEqual(results(messages).map(result => result.content), ['a"quoted\nline', 'b']);
      yield* finish();
    }
  });
  const agent = h.agent(provider, [read], { thinking: 'high' });
  assert.equal((await agent.run(prompt)).outcome, 'success');
  assert.deepEqual(executed, [{ value: 'a"quoted\nline' }, { value: 'b' }]);
  assert.deepEqual(agent.usage, { ...usage, cost: estimateCost(model, usage) });
  assert.equal(h.session.records().filter(record => record.type === 'usage').length, 1, 'cumulative usage chunks are not double counted');
  assert.ok(h.events.filter(event => event.type === 'tool.arguments').every(event => !Object.hasOwn(event, 'arguments')));
  const savedUsage = { ...agent.usage };
  h.reopen();
  assert.deepEqual(h.agent(provider, [read]).usage, savedUsage);
});

test('abort settles all active, queued read and mutation calls as correlated errors before agent.end', { timeout: 10_000 }, async t => {
  const h = await fixture(t);
  const ready = deferred();
  const started: string[] = [];
  const signals: AbortSignal[] = [];
  const read = probe('read_probe', true, async (args, { signal }) => {
    started.push(String(args.value));
    signals.push(signal);
    if (started.length === 8) ready.resolve();
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) reject(abortError());
      else signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
    return { content: 'must not complete' };
  });
  let mutations = 0;
  const write = probe('write_probe', false, async () => { mutations++; return { content: 'must not execute' }; });
  const calls = [
    ...Array.from({ length: 10 }, (_, i) => call(read.name, { value: String(i) }, `read-${i}`)),
    call(write.name, { value: 'mutation' }, 'mutation'), call(read.name, { value: 'after' }, 'after-mutation'),
  ];
  const provider = fakeProvider(async function* ({ messages }) {
    assert.equal(results(messages).length, 0, 'aborted batches must not request another model turn');
    yield* batch(...calls);
  });
  const agent = h.agent(provider, [read, write]);
  const run = agent.run(prompt);
  try {
    await ready.promise;
    assert.equal(agent.running, true);
    agent.abort();
    const result = await run;
    assert.equal(result.outcome, 'aborted');
    assert.equal(result.turns, 1);
    assert.equal(started.length, 8);
    assert.equal(mutations, 0);
    assert.equal(provider.requests.length, 1);
    assert.ok(signals.every(signal => signal.aborted && getEventListeners(signal, 'abort').length === 0));
    assert.equal(agent.running, false);
    assert.equal(agent.queued, 0);
    const observed = results(h.session.history());
    assert.equal(observed.length, calls.length);
    for (const item of calls) {
      const result = observed.find(result => result.toolCallId === item.id)!;
      assert.equal(result.toolName, item.name);
      assert.equal(result.isError, true);
      assert.match(result.content, /aborted/i);
    }
    assertSettled(h.session.history());
    assert.equal(h.events.at(-1)!.type, 'agent.end');
    assert.equal(h.events.filter(event => event.type === 'tool.end').length, calls.length);
    assertSettled(h.reopen().history());
  } finally { agent.abort(); await run; }
});

test('abort during a real approval request leaves the file untouched and settles later tools', { timeout: 10_000 }, async t => {
  const requested = deferred();
  const release = deferred();
  const h = await fixture(t, { prompt: async () => { requested.resolve(); await release.promise; return { decision: 'once' }; } });
  await writeFile(join(h.cwd, 'target.txt'), 'before');
  const provider = fakeProvider(async function* ({ messages }) {
    assert.equal(results(messages).length, 0);
    yield* batch(call('edit_file', { path: 'target.txt', old_string: 'before', new_string: 'after' }, 'blocked-write'),
      call('read_file', { path: 'target.txt' }, 'later-read'));
  });
  const agent = h.agent(provider, createBuiltinTools());
  const run = agent.run(prompt);
  try {
    await requested.promise;
    agent.abort();
    assert.equal((await run).outcome, 'aborted');
    assert.equal(await readFile(join(h.cwd, 'target.txt'), 'utf8'), 'before');
    assert.equal(h.session.records().filter(record => record.type === 'checkpoint').length, 0);
    assert.equal(results(h.session.history()).length, 2);
    assert.ok(results(h.session.history()).every(result => result.isError));
    assert.ok(!h.events.some(event => event.type === 'permission.decision'));
  } finally { release.resolve(); agent.abort(); await run; }
});

test('transient failures after partial text, reasoning or tool arguments never retry or execute tools', async t => {
  const partials: ProviderChunk[] = [
    { type: 'text', text: 'An incomplete answer' },
    { type: 'reasoning', text: 'An incomplete thought', signature: 'partial-signature' },
    { type: 'tool', index: 0, id: 'partial-call', name: 'write_probe', arguments: '{"value":' },
  ];
  for (const chunk of partials) await t.test(chunk.type, async t => {
    const h = await fixture(t);
    let executions = 0;
    const write = probe('write_probe', false, async () => { executions++; return { content: 'unexpected' }; });
    const provider = fakeProvider(async function* ({ messages }) {
      assert.deepEqual(messages, [prompt]);
      yield chunk;
      yield { type: 'usage', usage: { input: 20, output: 4 } };
      throw new ProviderError('Disconnected after partial output', { transient: true, status: 503 });
    });
    const result = await h.agent(provider, [write], { retries: 3, retryBaseMs: 0 }).run(prompt);
    assert.equal(result.outcome, 'failure');
    assert.match(result.error!, /Disconnected after partial output/);
    assert.equal(result.turns, 0);
    assert.equal(provider.requests.length, 1);
    assert.equal(executions, 0);
    assert.equal(h.events.filter(event => event.type === 'retry').length, 0);
    assert.equal(h.session.records().filter(record => record.type === 'turn.interrupted').length, 1);
    assert.equal(h.session.records().filter(record => record.type === 'usage').length, 1);
    assert.deepEqual(h.session.history(), [prompt], 'partial calls stay documentary and cannot be replayed');
  });
});

test('transient retries honor RetryAfter and exponential backoff using virtual time and unchanged history', { timeout: 10_000 }, async t => {
  const retried = [deferred(), deferred()];
  const h = await fixture(t, { onEvent: event => {
    if (event.type === 'retry') retried[Number(event.attempt) - 1]?.resolve();
  } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let faults = 0;
  const provider = fakeProvider(async function* ({ messages }) {
    assert.deepEqual(messages, [prompt]);
    if (faults++ < 2) throw new ProviderError('Temporary rate limit', { transient: true, status: 429, retryAfterMs: faults === 1 ? 80 : 5 });
    yield* finish(`Received: ${messages.at(-1)!.content}`);
  });
  const agent = h.agent(provider, [], { retries: 2, retryBaseMs: 50 });
  const run = agent.run(prompt);
  try {
    await retried[0]!.promise;
    t.mock.timers.tick(79);
    await nextTurn();
    assert.equal(provider.requests.length, 1);
    t.mock.timers.tick(1);
    await retried[1]!.promise;
    t.mock.timers.tick(99);
    await nextTurn();
    assert.equal(provider.requests.length, 2);
    t.mock.timers.tick(1);
    assert.deepEqual(await run, { outcome: 'success', reason: 'stop', turns: 1 });
    assert.equal(provider.requests.length, 3);
    assert.deepEqual(h.events.filter(event => event.type === 'retry').map(event => [event.attempt, event.delayMs]), [[1, 80], [2, 100]]);
    assert.deepEqual(h.events.filter(event => event.type === 'model.start').map(event => event.attempt), [0, 1, 2]);
    assert.equal(h.session.records().filter(record => record.type === 'turn.interrupted').length, 0);
  } finally { agent.abort(); await run; }
});

test('cancellation during RetryAfter sleep clears the listener and prevents another provider request', { timeout: 10_000 }, async t => {
  const sleeping = deferred();
  const h = await fixture(t, { onEvent: event => { if (event.type === 'retry') sleeping.resolve(); } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const provider = fakeProvider(async function* ({ messages }) {
    assert.deepEqual(messages, [prompt]);
    throw new ProviderError('Wait one minute', { transient: true, retryAfterMs: 60_000 });
  });
  const agent = h.agent(provider, [], { retries: 3, retryBaseMs: 10 });
  const run = agent.run(prompt);
  try {
    await sleeping.promise;
    const signal = provider.requests[0]!.signal;
    assert.equal(getEventListeners(signal, 'abort').length, 1, 'the retry sleep is active');
    t.mock.timers.tick(59_999);
    await nextTurn();
    assert.equal(provider.requests.length, 1);
    agent.abort();
    assert.equal((await run).outcome, 'aborted');
    assert.equal(getEventListeners(signal, 'abort').length, 0);
    t.mock.timers.tick(120_000);
    await nextTurn();
    assert.equal(provider.requests.length, 1);
    assert.equal(h.events.at(-1)!.type, 'agent.end');
  } finally { agent.abort(); await run; }
});

test('empty disconnects exhaust the configured retry budget without inventing a successful stop', async t => {
  const h = await fixture(t);
  const provider = fakeProvider(async function* ({ messages }) { assert.deepEqual(messages, [prompt]); });
  const result = await h.agent(provider, [], { retries: 2, retryBaseMs: 0 }).run(prompt);
  assert.equal(result.outcome, 'failure');
  assert.match(result.error!, /before a stop event/);
  assert.equal(provider.requests.length, 3);
  assert.equal(h.events.filter(event => event.type === 'retry').length, 2);
  assert.deepEqual(h.session.history(), [prompt]);
});

test('context overflow compacts once and safely retries with provenance and no replayed tool actions', async t => {
  const h = await fixture(t);
  h.session.append('message', { message: { role: 'user', content: 'Preserve the original goal: fix the parser.\n' + 'old detail '.repeat(3000) } });
  h.session.append('message', { message: { role: 'assistant', content: '', toolCalls: [call('write_probe', { value: 'already applied' }, 'historical-write')] } });
  h.session.append('message', { message: { role: 'tool', toolCallId: 'historical-write', toolName: 'write_probe', content: 'Failed verification: parser still rejects quotes', isError: true } });
  let executions = 0;
  const write = probe('write_probe', false, async () => { executions++; return { content: 'must not replay' }; });
  const originalHistory = h.session.history();
  const provider = fakeProvider(async function* ({ messages }) {
    if (!messages[0]!.content.startsWith('EXTRACTIVE CONTEXT CHECKPOINT.')) {
      assert.equal(messages.length, 4);
      throw new ProviderError('Server tokenizer reports context overflow', { contextOverflow: true });
    }
    assert.equal(messages.length, 1);
    assert.match(messages[0]!.content, /Excerpts, not verified new facts/);
    assert.match(messages[0]!.content, /Preserve the original goal: fix the parser/);
    assert.match(messages[0]!.content, /\[tool write_probe FAILED\]/);
    assert.match(messages[0]!.content, /parser still rejects quotes/);
    assert.match(messages[0]!.content, /Complete the requested work/);
    yield* finish('Checkpoint observed; no historical action was replayed.');
  });
  const agent = h.agent(provider, [write], { retries: 3 });
  assert.deepEqual(await agent.run(prompt), { outcome: 'success', reason: 'stop', turns: 1 });
  assert.equal(provider.requests.length, 2);
  assert.equal(executions, 0);
  const compactions = h.events.filter(event => event.type === 'compaction.end');
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0]!.automatic, true);
  assert.ok(Number(compactions[0]!.afterTokens) < contextSize(agent.options.system, [...originalHistory, prompt], [write]));
  assert.equal(h.events.filter(event => event.type === 'retry' && event.contextOverflow === true).length, 1);
  assert.equal(h.session.records().filter(record => record.type === 'message').length, 5, 'full history remains durable');
});

test('a second context overflow fails after exactly one compaction and one safe retry', async t => {
  const h = await fixture(t);
  const provider = fakeProvider(async function* ({ messages }) {
    assert.ok(messages.some(message => message.content.includes(prompt.content)));
    throw new ProviderError('Still exceeds context capacity', { contextOverflow: true });
  });
  const result = await h.agent(provider, [], { retries: 5, retryBaseMs: 0 }).run(prompt);
  assert.equal(result.outcome, 'failure');
  assert.equal(result.turns, 0);
  assert.match(result.error!, /Still exceeds context capacity/);
  assert.equal(provider.requests.length, 2);
  assert.equal(h.session.records().filter(record => record.type === 'compaction').length, 1);
  assert.equal(h.events.filter(event => event.type === 'retry').length, 1);
});

test('oversized durable history is proactively compacted before the realistic model capacity is exceeded', async t => {
  const h = await fixture(t);
  h.session.append('message', { message: { role: 'user', content: 'Original requirement.\n' + 'x'.repeat(400_000) } });
  const provider = fakeProvider(async function* ({ messages }) {
    assert.match(messages[0]!.content, /^EXTRACTIVE CONTEXT CHECKPOINT/);
    assert.match(messages[0]!.content, /Original requirement/);
    yield* finish();
  });
  assert.equal((await h.agent(provider).run(prompt)).outcome, 'success');
  assert.equal(provider.requests.length, 1);
  assert.equal(h.events.filter(event => event.type === 'compaction.end').length, 1);
  assert.equal(h.events.filter(event => event.type === 'retry').length, 0);
});

test('context overflow after partial output must not retry, even through the outer compaction path', async t => {
  const chunks: ProviderChunk[] = [
    { type: 'text', text: 'Already exposed partial output.' },
    { type: 'reasoning', text: 'Partial thinking.' },
    { type: 'reasoning', text: '', signature: 'partial-signature' },
    { type: 'tool', index: 0, id: 'partial-call', name: 'read_file', arguments: '{"path":' },
  ];
  for (const [index, chunk] of chunks.entries()) await t.test(`${chunk.type}-${index}`, async t => {
    const h = await fixture(t);
    const provider = fakeProvider(async function* ({ messages }) {
      assert.ok(messages[0]!.content.includes(prompt.content));
      yield chunk;
      throw new ProviderError('Overflow after a partial stream', { contextOverflow: true });
    });
    const result = await h.agent(provider).run(prompt);
    assert.equal(result.outcome, 'failure');
    assert.match(result.error!, /Overflow after a partial stream/);
    assert.equal(provider.requests.length, 1, 'a partially consumed request is never safe to retry');
    assert.equal(h.events.filter(event => event.type === 'retry').length, 0);
    assert.equal(h.session.records().filter(record => record.type === 'compaction').length, 0);
    assert.equal(h.session.records().filter(record => record.type === 'turn.interrupted').length, 1);
  });
});

test('length, error and aborted model stops preserve partial prose but never execute attached calls', async t => {
  for (const reason of ['length', 'error', 'aborted'] as const) await t.test(reason, async t => {
    const h = await fixture(t);
    let executions = 0;
    const write = probe('write_probe', false, async () => { executions++; return { content: 'unexpected' }; });
    const provider = fakeProvider(async function* ({ messages }) {
      assert.deepEqual(messages, [prompt]);
      yield { type: 'text', text: 'Partial prose.' };
      yield { type: 'reasoning', text: 'Partial reasoning.' };
      yield { type: 'tool', index: 0, ...call(write.name, { value: 'do not execute' }) };
      yield { type: 'stop', reason };
    });
    const result = await h.agent(provider, [write], { retries: 3 }).run(prompt);
    assert.equal(result.outcome, reason === 'aborted' ? 'aborted' : 'failure');
    assert.equal(result.turns, 1);
    assert.match(result.error!, reason === 'length' ? /output limit reached/ : reason === 'error' ? /error stop/ : /aborted/i);
    assert.equal(executions, 0);
    assert.equal(provider.requests.length, 1);
    assert.equal(h.events.filter(event => event.type === 'tool.start').length, 0);
    assert.deepEqual(h.session.history().at(-1), { role: 'assistant', content: 'Partial prose.', reasoning: 'Partial reasoning.' });
    assert.equal(h.session.records().filter(record => record.type === 'turn.interrupted').length, 1);
    assertSettled(h.reopen().history());
  });
});

test('unknown model stop reasons fail closed rather than reporting success', async t => {
  const h = await fixture(t);
  const provider = fakeProvider(async function* ({ messages }) {
    assert.deepEqual(messages, [prompt]);
    yield { type: 'text', text: 'Untrusted terminal response.' };
    yield { type: 'stop', reason: 'not-a-supported-stop' as StopReason };
  });
  const result = await h.agent(provider).run(prompt);
  assert.equal(result.outcome, 'failure', 'runtime provider data must not bypass terminal-state validation');
  assert.equal(provider.requests.length, 1);
  assert.equal(h.events.at(-1)!.outcome, 'failure');
});

test('missing stops, duplicate stops and inconsistent tool-use stops fail without executing tools', async t => {
  const scenarios: Array<{ name: string; chunks: ProviderChunk[]; error: RegExp }> = [
    { name: 'missing stop', chunks: [{ type: 'text', text: 'Not finished' }], error: /before a stop event/ },
    { name: 'duplicate stop', chunks: [{ type: 'stop', reason: 'stop' }, { type: 'stop', reason: 'stop' }], error: /Duplicate model stop/ },
    { name: 'tool-use without calls', chunks: [{ type: 'stop', reason: 'tool-use' }], error: /without any tool calls/ },
    { name: 'calls without tool-use', chunks: [
      { type: 'tool', index: 0, ...call('write_probe', { value: 'unsafe' }) }, { type: 'stop', reason: 'stop' },
    ], error: /without a tool-use stop/ },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async t => {
    const h = await fixture(t);
    let executions = 0;
    const write = probe('write_probe', false, async () => { executions++; return { content: 'unexpected' }; });
    const provider = fakeProvider(async function* ({ messages }) { assert.deepEqual(messages, [prompt]); yield* scenario.chunks; });
    const result = await h.agent(provider, [write], { retries: 2, retryBaseMs: 0 }).run(prompt);
    assert.equal(result.outcome, 'failure');
    assert.match(result.error!, scenario.error);
    assert.equal(executions, 0);
    assert.equal(provider.requests.length, 1);
    assert.deepEqual(h.session.history(), [prompt]);
  });
});

test('history-driven tool loop hits maxTurns only after the final batch has durably settled', async t => {
  const h = await fixture(t);
  const read = probe('read_probe', true, async args => ({ content: String(Number(args.value) + 1) }));
  const provider = fakeProvider(async function* ({ messages }) {
    const previous = results(messages).at(-1)?.content ?? '0';
    yield* batch(call(read.name, { value: previous }, `step-${previous}`));
  });
  const result = await h.agent(provider, [read], { maxTurns: 3 }).run(prompt);
  assert.equal(result.outcome, 'failure');
  assert.equal(result.turns, 3);
  assert.match(result.error!, /Runaway safeguard: stopped after 3 model turns/);
  assert.equal(provider.requests.length, 3);
  assert.deepEqual(results(h.session.history()).map(result => result.content), ['1', '2', '3']);
  assertSettled(h.reopen().history());
  assert.equal(h.events.at(-1)!.outcome, 'failure');
});

test('steering waits for the active batch, while follow-ups wait for assistant settlement before the next model', { timeout: 10_000 }, async t => {
  const h = await fixture(t);
  const active = deferred();
  const release = deferred();
  const read = probe('read_probe', true, async () => { active.resolve(); await release.promise; return { content: 'observed read' }; });
  const write = probe('write_probe', false, async () => ({ content: 'observed mutation' }));
  const steer = { role: 'user', content: 'Steer the current work.' } satisfies Message;
  const follow = { role: 'user', content: 'Only after settlement, do this follow-up.' } satisfies Message;
  const provider = fakeProvider(async function* ({ messages }) {
    const observed = results(messages);
    if (!observed.length) yield* batch(call(read.name, { value: 'read' }), call(write.name, { value: 'write' }));
    else if (!messages.some(message => message.role === 'user' && message.content === follow.content)) {
      assert.deepEqual(observed.map(result => result.content), ['observed read', 'observed mutation']);
      assert.deepEqual(messages.filter(message => message.role === 'user'), [prompt, steer]);
      yield* finish('Steering completed; current work settled.');
    } else {
      assert.equal(messages.at(-1)!.content, follow.content);
      assert.equal(messages.at(-2)!.content, 'Steering completed; current work settled.');
      assert.deepEqual(messages.filter(message => message.role === 'user'), [prompt, steer, follow]);
      yield* finish('Follow-up completed.');
    }
  });
  const agent = h.agent(provider, [read, write]);
  assert.throws(() => agent.enqueue(steer), /No active run/);
  const run = agent.run(prompt);
  try {
    await active.promise;
    await assert.rejects(agent.run(prompt), /already running/);
    agent.enqueue(follow, 'follow-up');
    agent.enqueue(steer, 'steer');
    assert.equal(agent.queued, 2);
    assert.deepEqual(h.session.history().filter(message => message.role === 'user'), [prompt]);
    assert.equal(provider.requests.length, 1);
    release.resolve();
    assert.deepEqual(await run, { outcome: 'success', reason: 'stop', turns: 3 });
    assert.equal(provider.requests.length, 3);
    assert.equal(agent.queued, 0);
    assert.equal(agent.running, false);
  } finally { release.resolve(); agent.abort(); await run; }
  assert.deepEqual(h.events.filter(event => event.type === 'message.delivered').map(event => [event.boundary, event.count, event.queued]),
    [['tool-batch', 1, 1], ['settled', 1, 0]]);
  const steerIndex = h.events.findIndex(event => event.type === 'message.user' && event.text === steer.content);
  const followIndex = h.events.findIndex(event => event.type === 'message.user' && event.text === follow.content);
  const lastTool = h.events.findLastIndex(event => event.type === 'tool.end');
  const settled = h.events.findIndex(event => event.type === 'assistant.end' && event.text === 'Steering completed; current work settled.');
  assert.ok(lastTool < steerIndex && steerIndex < settled && settled < followIndex);
  assert.equal(h.session.records().filter(record => record.type === 'queue.pending').length, 0);
  assertSettled(h.reopen().history());
});

test('undelivered steering and follow-up input is durably preserved on provider failure, not inserted into model history', { timeout: 10_000 }, async t => {
  const h = await fixture(t);
  const active = deferred();
  const release = deferred();
  const provider = fakeProvider(async function* ({ messages }) {
    assert.deepEqual(messages, [prompt]);
    active.resolve();
    await release.promise;
    throw new ProviderError('Permanent offline fixture failure');
  });
  const agent = h.agent(provider);
  const queued = [
    { message: { role: 'user', content: 'Do not lose this steering.' } satisfies Message, delivery: 'steer' as const },
    { message: { role: 'user', content: 'Do not lose this follow-up.' } satisfies Message, delivery: 'follow-up' as const },
  ];
  const run = agent.run(prompt);
  try {
    await active.promise;
    for (const entry of queued) agent.enqueue(entry.message, entry.delivery);
    release.resolve();
    assert.equal((await run).outcome, 'failure');
  } finally { release.resolve(); agent.abort(); await run; }
  assert.equal(agent.queued, 0);
  assert.equal(agent.running, false);
  assert.equal(provider.requests.length, 1);
  assert.ok(!h.events.some(event => event.type === 'message.delivered'));
  const session = h.reopen();
  assert.deepEqual(session.history(), [prompt]);
  const pending = session.records().filter(record => record.type === 'queue.pending');
  assert.equal(pending.length, queued.length);
  assert.deepEqual(pending.map(record => record.data.messages), queued.map(entry => [entry]));
  const records = session.records();
  assert.equal(records.at(-2)!.type, 'queue.pending');
  assert.equal(records.at(-1)!.type, 'agent.end');
  assert.equal(records.at(-1)!.data.outcome, 'failure');
});

test('a prompt.before failure while delivering steering must preserve every not-yet-delivered queued message', { timeout: 10_000 }, async t => {
  const h = await fixture(t);
  const active = deferred();
  const release = deferred();
  const read = probe('read_probe', true, async () => { active.resolve(); await release.promise; return { content: 'read completed' }; });
  const queued = [
    { message: { role: 'user', content: 'First pending instruction.' } satisfies Message, delivery: 'steer' as const },
    { message: { role: 'user', content: 'Second pending instruction.' } satisfies Message, delivery: 'steer' as const },
  ];
  const provider = fakeProvider(async function* ({ messages }) {
    assert.equal(results(messages).length, 0);
    yield* batch(call(read.name, { value: 'read' }));
  });
  const agent = h.agent(provider, [read], { hook: async (name, payload) => {
    if (name === 'prompt.before' && (payload.message as Message).content === queued[0]!.message.content) throw new Error('Delivery hook failed');
  } });
  const run = agent.run(prompt);
  try {
    await active.promise;
    for (const entry of queued) agent.enqueue(entry.message, entry.delivery);
    release.resolve();
    const result = await run;
    assert.equal(result.outcome, 'failure');
    assert.match(result.error!, /Delivery hook failed/);
  } finally { release.resolve(); agent.abort(); await run; }
  const session = h.reopen();
  assert.deepEqual(session.history().filter(message => message.role === 'user'), [prompt]);
  const pending = session.records().filter(record => record.type === 'queue.pending');
  assert.equal(pending.length, queued.length, 'removing a delivery batch before its hooks complete loses user input');
  assert.deepEqual(pending.map(record => record.data.messages), queued.map(entry => [entry]));
});

test('reopened crash state repairs only dangling tool results without replaying an already-applied real edit', async t => {
  const h = await fixture(t, { prompt: async () => ({ decision: 'once' }) });
  await writeFile(join(h.cwd, 'crash.txt'), 'before');
  h.session.append('message', { message: { role: 'user', content: 'Edit crash.txt and inspect it.' } });
  const calls = [call('read_file', { path: 'crash.txt' }, 'known-result'),
    call('edit_file', { path: 'crash.txt', old_string: 'before', new_string: 'after' }, 'applied-no-result'),
    call('read_file', { path: 'crash.txt' }, 'never-started')];
  h.session.append('message', { message: { role: 'assistant', content: '', toolCalls: calls } });
  h.session.append('message', { message: { role: 'tool', toolCallId: 'known-result', toolName: 'read_file', content: '1: before', isError: false } });
  const tools = createBuiltinTools();
  const edit = tools.find(tool => tool.name === 'edit_file')!;
  const applied = await edit.execute(JSON.parse(calls[1]!.arguments) as Record<string, unknown>, { ...h.context, signal: new AbortController().signal });
  assert.ok(!applied.isError, applied.content);
  assert.equal(await readFile(join(h.cwd, 'crash.txt'), 'utf8'), 'after');
  // This is the durable crash boundary: the checkpoint committed, but no tool result or agent.end did.
  assert.equal(h.session.records().at(-1)!.type, 'checkpoint');
  h.reopen();
  const provider = fakeProvider(async function* ({ messages }) {
    assert.equal(messages.at(-1)!.content, prompt.content);
    const observed = results(messages);
    assert.equal(observed.length, 3);
    assert.equal(observed[0]!.content, '1: before');
    assert.equal(observed[0]!.isError, false);
    assert.deepEqual(observed.slice(1).map(result => result.toolCallId), ['applied-no-result', 'never-started']);
    for (const result of observed.slice(1)) {
      assert.equal(result.isError, true);
      assert.match(result.content, /Execution is unknown; inspect the current state before retrying/);
    }
    yield* finish('Recovered execution uncertainty without replaying actions.');
  });
  assert.equal((await h.agent(provider, tools).run(prompt)).outcome, 'success');
  assert.equal(await readFile(join(h.cwd, 'crash.txt'), 'utf8'), 'after');
  assert.equal(h.approvals.length, 1, 'only the pre-crash write was authorized');
  assert.equal(h.events.filter(event => event.type === 'tool.start').length, 0);
  assert.equal(h.session.records().filter(record => record.type === 'checkpoint').length, 1);
  const warning = h.events.find(event => event.type === 'warning' && String(event.message).includes('Recovered 2'));
  assert.ok(warning);
  assert.match(String(warning.message), /no action was replayed/);
  h.reopen();
  assert.equal((await h.agent(provider, tools).run(prompt)).outcome, 'success');
  assert.equal(results(h.session.history()).length, 3, 'repair is idempotent across restarts');
});

test('JSONL events have authoritative version/session fields, causal ordering, escaped separators and cross-chunk quoted-secret redaction', async t => {
  const secret = 'synthetic-quoted"back\\line\ncredential';
  const text = `Visible "quote"\nline\u2028paragraph\u2029 ${secret} suffix`;
  const thought = `Think about ${secret} safely.`;
  const h = await fixture(t, { secrets: [secret] });
  const provider = fakeProvider(async function* ({ messages }) {
    assert.deepEqual(messages, [prompt]);
    for (const character of text) yield { type: 'text', text: character };
    for (const character of thought) yield { type: 'reasoning', text: character };
    yield { type: 'stop', reason: 'stop' };
  });
  assert.equal((await h.agent(provider).run(prompt)).outcome, 'success');
  const events = h.lines.map(line => {
    assert.equal(line.split('\n').length, 2, 'exactly one physical JSONL record per event');
    assert.equal(line.at(-1), '\n');
    assert.doesNotMatch(line, /[\u2028\u2029]/);
    return JSON.parse(line) as KilnEvent;
  });
  assert.deepEqual(events, JSON.parse(JSON.stringify(h.events)));
  for (const [index, event] of events.entries()) {
    assert.equal(event.version, 1);
    assert.equal(event.sessionId, h.session.meta.id);
    assert.equal(new Date(event.time).toISOString(), event.time);
    if (index) assert.ok(Date.parse(event.time) >= Date.parse(events[index - 1]!.time));
  }
  assert.equal(events[0]!.type, 'agent.start');
  assert.equal(events[1]!.type, 'message.user');
  assert.equal(events.at(-1)!.type, 'agent.end');
  const start = events.findIndex(event => event.type === 'model.start');
  const end = events.findIndex(event => event.type === 'assistant.end');
  assert.ok(start > 1 && end > start);
  for (const [index, event] of events.entries()) {
    if (event.type === 'assistant.delta' || event.type === 'reasoning.delta') assert.ok(index > start && index < end);
  }
  const clean = redactor([secret]);
  assert.equal(events.filter(event => event.type === 'assistant.delta').map(event => event.text).join(''), clean(text));
  assert.equal(events.filter(event => event.type === 'reasoning.delta').map(event => event.text).join(''), clean(thought));
  assert.equal(events[end]!.text, clean(text));
  assert.ok(h.lines.join('').includes('\\u2028'));
  assert.ok(h.lines.join('').includes('\\u2029'));
  assert.ok(h.lines.join('').includes('\\"quote\\"'));
  assert.doesNotMatch(h.lines.join(''), /synthetic-quoted|credential/);
  assert.equal(h.session.history().at(-1)!.content, clean(text));
  assert.equal(h.session.history().at(-1)!.reasoning, clean(thought));
  assert.doesNotMatch(h.store.export(h.session.meta.id), /synthetic-quoted|credential/);
  const authoritative: KilnEvent[] = [];
  eventEmitter('real-session', event => authoritative.push(event), clean)('actual.type', {
    version: 99, type: 'spoofed.type', sessionId: 'spoofed-session', time: 'not-a-date', nested: { [secret]: [text] },
  });
  assert.equal(authoritative[0]!.version, 1);
  assert.equal(authoritative[0]!.type, 'actual.type');
  assert.equal(authoritative[0]!.sessionId, 'real-session');
  assert.deepEqual(authoritative[0]!.nested, { '[REDACTED]': [clean(text)] });
  assert.equal(new Date(authoritative[0]!.time).toISOString(), authoritative[0]!.time);
});

test('JSON-encoded tool arguments containing quoted secrets must be redacted in events and durable history, not in execution', async t => {
  const secret = 'synthetic-argument"back\\line\ncredential';
  const h = await fixture(t, { secrets: [secret] });
  const executed: unknown[] = [];
  const read = probe('read_probe', true, async args => {
    executed.push(args.value);
    return { content: String(args.value), metadata: { [secret]: [secret] } };
  });
  const provider = fakeProvider(async function* ({ messages }) {
    if (!results(messages).length) {
      const encoded = JSON.stringify({ value: secret });
      yield { type: 'tool', index: 0, id: 'quoted-secret', name: read.name };
      for (const character of encoded) yield { type: 'tool', index: 0, arguments: character };
      yield { type: 'stop', reason: 'tool-use' };
    } else {
      assert.equal(results(messages)[0]!.content, '[REDACTED]');
      yield* finish();
    }
  });
  assert.equal((await h.agent(provider, [read]).run(prompt)).outcome, 'success');
  assert.deepEqual(executed, [secret]);
  const toolEnd = h.events.find(event => event.type === 'tool.end')!;
  assert.deepEqual(toolEnd.metadata, { '[REDACTED]': ['[REDACTED]'] });
  const toolStart = h.events.find(event => event.type === 'tool.start')!;
  const persistedCall = h.reopen().history().flatMap(message => message.toolCalls ?? [])[0]!;
  const receivedCall = provider.requests[1]!.messages.flatMap(message => message.toolCalls ?? [])[0]!;
  assert.deepEqual({ event: JSON.parse(String(toolStart.arguments)), durable: JSON.parse(persistedCall.arguments), nextRequest: JSON.parse(receivedCall.arguments) },
    { event: { value: '[REDACTED]' }, durable: { value: '[REDACTED]' }, nextRequest: { value: '[REDACTED]' } });
  assert.doesNotMatch(h.lines.join(''), /synthetic-argument|credential/);
  assert.doesNotMatch(h.store.export(h.session.meta.id), /synthetic-argument|credential/);
});

for (const type of ['text', 'reasoning'] as const) {
  test(`generic credential-shaped secrets split across model chunks must not leak in ${type} deltas`, async t => {
    const h = await fixture(t);
    const secret = 'sk-ant-abcdefghijklmnopqrstuvwxyz0123456789';
    const provider = fakeProvider(async function* ({ messages }) {
      assert.deepEqual(messages, [prompt]);
      for (const character of `prefix ${secret} suffix`) yield { type, text: character };
      yield { type: 'stop', reason: 'stop' };
    });
    assert.equal((await h.agent(provider).run(prompt)).outcome, 'success');
    const streamed = h.events.filter(event => event.type === (type === 'text' ? 'assistant.delta' : 'reasoning.delta')).map(event => event.text).join('');
    assert.equal(streamed, 'prefix [REDACTED] suffix');
    assert.doesNotMatch(h.store.export(h.session.meta.id), /abcdefghijklmnopqrstuvwxyz/);
  });
}

test('StreamRedactor handles every split, ordinary prefixes, word boundaries and mixed explicit/generic secrets', () => {
  const explicit = 'synthetic-quoted"back\\line\ncredential';
  const generic = 'sk-ant-abcdefghijklmnopqrstuvwxyz0123456789';
  const samples = [
    generic, `prefix ${generic} suffix`, `${generic}:${generic}`,
    'sk-abcdefghijklmnop', 'sk-abcdefghijklmno', 's', 'sk', 'sk-', 'sk-short',
    `task-abcdefghijklmnopqrstuvwxyz word${generic} _${generic}`,
    `"${generic}"\n${explicit}\u2028${generic}!`,
    `${explicit}${explicit} normal`, 'ordinary text without credentials',
  ];
  for (const secrets of [[], [explicit], [explicit, 'credential']]) {
    for (const input of samples) {
      const expected = redactor(secrets)(input);
      for (let split = 0; split <= input.length; split++) {
        const stream = new StreamRedactor(secrets);
        assert.equal(stream.push(input.slice(0, split)) + stream.push(input.slice(split)) + stream.push('', true), expected,
          `split ${split} of ${JSON.stringify(input)}, explicit secrets: ${secrets.length}`);
      }
      const stream = new StreamRedactor(secrets);
      assert.equal([...input].map(character => stream.push(character)).join('') + stream.push('', true), expected);
    }
  }
  const stream = new StreamRedactor([]);
  assert.equal(stream.push('sk-' + 'a'.repeat(16)), '[REDACTED]', 'recognition does not wait for an unbounded token to end');
  for (let i = 0; i < 1024; i++) assert.equal(stream.push('a_0-'.repeat(1024)), '');
  assert.equal(stream.push(' ordinary text', true), ' ordinary text');
  const overlapping = new StreamRedactor(['aa']);
  assert.equal(overlapping.push('a'.repeat(4096)), '[REDACTED]'.repeat(2048));
  assert.equal(overlapping.push('', true), '');
});

test('interrupted arguments are sanitized for valid JSON and omitted for incomplete JSON, including abort cleanup', async t => {
  for (const scenario of ['length', 'disconnect', 'incomplete', 'aborted'] as const) await t.test(scenario, async t => {
    const secret = 'synthetic-interrupted"back\\line\ncredential';
    const h = await fixture(t, { secrets: [secret] });
    const raw = JSON.stringify({ value: secret, nested: { [secret]: [secret] } });
    const provider = fakeProvider(async function* ({ messages }) {
      assert.deepEqual(messages, [prompt]);
      yield { type: 'tool', index: 0, id: 'interrupted', name: 'write_probe', arguments: scenario === 'incomplete' ? raw.slice(0, -1) : raw };
      if (scenario === 'length') yield { type: 'stop', reason: 'length' };
      else if (scenario === 'aborted') { agent.abort(); throw abortError(); }
      else throw new ProviderError('Disconnected with tool arguments', { transient: true });
    });
    let executions = 0;
    const write = probe('write_probe', false, async () => { executions++; return { content: 'unexpected' }; });
    const agent = h.agent(provider, [write], { retries: 2, retryBaseMs: 0 });
    const result = await agent.run(prompt);
    assert.equal(result.outcome, scenario === 'aborted' ? 'aborted' : 'failure');
    assert.equal(provider.requests.length, 1);
    assert.equal(executions, 0);
    const records = h.reopen().records().filter(record => record.type === 'turn.interrupted');
    assert.equal(records.length, 1);
    const record = records[0]!;
    const calls = scenario === 'length' ? (record.data.message as Message).toolCalls! : record.data.toolCalls as ToolCall[];
    assert.equal(calls.length, 1);
    const sanitized = JSON.parse(calls[0]!.arguments) as Record<string, unknown>;
    if (scenario === 'incomplete') assert.match(JSON.stringify(sanitized), /omitted|incomplete/i);
    else assert.deepEqual(sanitized, { value: '[REDACTED]', nested: { '[REDACTED]': ['[REDACTED]'] } });
    assert.doesNotMatch(h.store.export(h.session.meta.id), /synthetic-interrupted|credential/);
    assert.doesNotMatch(h.lines.join(''), /synthetic-interrupted|credential/);
    assert.deepEqual(h.session.history(), [prompt]);
  });
});

test('invalid argument parse errors never echo raw secret-bearing JSON into tool results', async t => {
  const secret = 'synthetic-broken"credential';
  const h = await fixture(t, { secrets: [secret] });
  const raw = JSON.stringify({ value: secret }) + ' trailing-invalid-json';
  const write = probe('write_probe', false, async () => assert.fail('invalid arguments must not execute'));
  const provider = fakeProvider(async function* ({ messages }) {
    if (!results(messages).length) yield* batch({ id: 'invalid', name: write.name, arguments: raw });
    else {
      assert.equal(results(messages)[0]!.isError, true);
      assert.match(results(messages)[0]!.content, /valid JSON/);
      yield* finish();
    }
  });
  assert.equal((await h.agent(provider, [write]).run(prompt)).outcome, 'success');
  assert.doesNotMatch(h.lines.join(''), /synthetic-broken|credential|trailing-invalid-json/);
  assert.doesNotMatch(h.store.export(h.session.meta.id), /synthetic-broken|credential|trailing-invalid-json/);
});

test('legacy opaque arguments are sanitized before model requests and compaction without replaying tools', async t => {
  const secret = 'synthetic-legacy"credential';
  const h = await fixture(t, { secrets: [secret] });
  h.session.append('message', { message: { role: 'user', content: 'Previous work.' } });
  h.session.append('message', { message: { role: 'assistant', content: '', toolCalls: [call('read_probe', { value: secret }, 'old-call')] } });
  h.session.append('message', { message: { role: 'tool', content: 'Previous observation.', toolCallId: 'old-call', toolName: 'read_probe' } });
  const provider = fakeProvider(async function* ({ messages }) {
    const old = messages.flatMap(message => message.toolCalls ?? [])[0]!;
    assert.deepEqual(JSON.parse(old.arguments), { value: '[REDACTED]' });
    assert.doesNotMatch(JSON.stringify(messages), /synthetic-legacy|credential/);
    yield* finish();
  });
  const agent = h.agent(provider);
  assert.equal((await agent.run(prompt)).outcome, 'success');
  await agent.compact();
  assert.doesNotMatch(h.session.history()[0]!.content, /synthetic-legacy|credential/);
  assert.doesNotMatch(h.lines.join(''), /synthetic-legacy|credential/);
});

test('100 pending messages exceeding 4 MiB in aggregate are each durably saved before final settlement', { timeout: 15_000 }, async t => {
  const h = await fixture(t);
  const queued = Array.from({ length: 100 }, (_, index) => ({
    message: { role: 'user', content: `${index}: ${'x'.repeat(50_000)}` } satisfies Message,
    delivery: index % 2 ? 'follow-up' as const : 'steer' as const,
  }));
  assert.ok(Buffer.byteLength(JSON.stringify({ messages: queued })) > 4 * 1024 * 1024);
  const provider = fakeProvider(async function* ({ messages }) {
    assert.deepEqual(messages, [prompt]);
    for (const entry of queued) agent.enqueue(entry.message, entry.delivery);
    assert.throws(() => agent.enqueue(prompt), /queue is full/i);
    throw new ProviderError('Controlled failure with a full queue');
  });
  const agent = h.agent(provider);
  const result = await agent.run(prompt);
  assert.equal(result.outcome, 'failure');
  assert.match(result.error!, /Controlled failure with a full queue/);
  assert.equal(agent.running, false);
  assert.equal(agent.queued, 0);
  agent.abort();
  assert.equal(provider.requests[0]!.signal.aborted, false, 'the completed run no longer owns an abort controller');
  const records = h.reopen().records();
  const pending = records.filter(record => record.type === 'queue.pending');
  assert.equal(pending.length, 100);
  assert.deepEqual(pending.map(record => record.data.messages), queued.map(entry => [entry]));
  assert.ok(pending.every(record => Buffer.byteLength(JSON.stringify(record)) < 4 * 1024 * 1024));
  assert.deepEqual(h.session.history(), [prompt]);
  assert.equal(records.at(-1)!.type, 'agent.end');
  assert.equal(h.events.filter(event => event.type === 'error').length, 1);
  assert.equal(h.events.filter(event => event.type === 'agent.end').length, 1);
  assert.match(String(h.events.find(event => event.type === 'warning')!.message), /100 queued.*preserved/);
});

test('pending-entry, terminal-record and total durable failures return one honest failure and always reset run state', async t => {
  for (const scenario of ['queue.pending', 'agent.end', 'all'] as const) await t.test(scenario, async t => {
    const h = await fixture(t, { secrets: ['synthetic-storage-secret'] });
    const attempted: string[] = [];
    const append = h.session.append.bind(h.session);
    const mock = t.mock.method(h.session, 'append', (type: string, data: Record<string, unknown>) => {
      attempted.push(type);
      const pending = data.messages as Array<{ message: Message }> | undefined;
      if (scenario === 'all' || type === scenario && (type !== 'queue.pending' || pending?.[0]?.message.content === 'first')) {
        throw new Error('Synthetic durable failure: synthetic-storage-secret');
      }
      return append(type, data);
    });
    const recovery: Message = { role: 'user', content: 'Run again after storage recovery.' };
    const provider = fakeProvider(async function* ({ messages }) {
      if (messages.at(-1)!.content === recovery.content || scenario === 'agent.end') yield* finish();
      else {
        assert.deepEqual(messages, [prompt]);
        agent.enqueue({ role: 'user', content: 'first' });
        agent.enqueue({ role: 'user', content: 'second' }, 'follow-up');
        throw new ProviderError('Original provider failure');
      }
    });
    const agent = h.agent(provider);
    const result = await agent.run(prompt);
    assert.equal(result.outcome, 'failure');
    assert.match(result.error!, /Session persistence failed/);
    assert.match(result.error!, /Synthetic durable failure/);
    assert.doesNotMatch(result.error!, /synthetic-storage-secret/);
    assert.equal(agent.running, false);
    assert.equal(agent.queued, 0);
    assert.throws(() => agent.enqueue(prompt), /No active run/);
    agent.abort();
    assert.ok(provider.requests.every(request => !request.signal.aborted));
    assert.equal(attempted.filter(type => type === 'agent.end').length, 1);
    assert.equal(h.events.filter(event => event.type === 'error').length, 1, 'do not emit both the original and final persistence error');
    assert.equal(h.events.filter(event => event.type === 'agent.end').length, 1);
    assert.equal(h.events.at(-1)!.outcome, 'failure');
    assert.equal(h.events.at(-1)!.error, result.error);
    assert.ok(!h.events.some(event => /preserved in session records/.test(String(event.message))));
    if (scenario === 'queue.pending') {
      assert.equal(attempted.filter(type => type === 'queue.pending').length, 2, 'later entries still get a persistence attempt');
      assert.deepEqual(h.session.records().filter(record => record.type === 'queue.pending').map(record => record.data.messages),
        [[{ message: { role: 'user', content: 'second' }, delivery: 'follow-up' }]]);
      assert.deepEqual(h.session.records().at(-1)!.data, result);
    }
    mock.mock.restore();
    assert.equal((await agent.run(recovery)).outcome, 'success', 'the same agent can run after storage recovers');
    assert.equal(agent.running, false);
    assert.equal(h.events.filter(event => event.type === 'agent.end').length, 2);
  });
});

test('an individually oversized pending message does not prevent a later valid message or agent.end from being saved', { timeout: 10_000 }, async t => {
  const h = await fixture(t);
  const provider = fakeProvider(async function* ({ messages }) {
    assert.deepEqual(messages, [prompt]);
    agent.enqueue({ role: 'user', content: 'x'.repeat(4 * 1024 * 1024) });
    agent.enqueue({ role: 'user', content: 'Small recoverable follow-up.' }, 'follow-up');
    throw new ProviderError('Original provider failure');
  });
  const agent = h.agent(provider);
  const result = await agent.run(prompt);
  assert.equal(result.outcome, 'failure');
  assert.match(result.error!, /1 queued message\(s\) could not be saved/);
  assert.match(result.error!, /record is too large/i);
  assert.equal(agent.running, false);
  assert.equal(agent.queued, 0);
  const records = h.reopen().records();
  assert.deepEqual(records.filter(record => record.type === 'queue.pending').map(record => record.data.messages),
    [[{ message: { role: 'user', content: 'Small recoverable follow-up.' }, delivery: 'follow-up' }]]);
  assert.equal(records.at(-1)!.type, 'agent.end');
  assert.equal(records.at(-1)!.data.outcome, 'failure');
  assert.equal(h.events.filter(event => event.type === 'error').length, 1);
  assert.equal(h.events.at(-1)!.outcome, 'failure');
  assert.ok(!h.events.some(event => /preserved in session records/.test(String(event.message))));
});

test('steering is removed only at commit, including append failure and prompt.after failure', async t => {
  for (const scenario of ['append', 'prompt.after'] as const) await t.test(scenario, async t => {
    const h = await fixture(t);
    const first: Message = { role: 'user', content: 'First queued message.' };
    const second: Message = { role: 'user', content: 'Second queued message.' };
    if (scenario === 'append') {
      const append = h.session.append.bind(h.session);
      t.mock.method(h.session, 'append', (type: string, data: Record<string, unknown>) => {
        if (type === 'message' && (data.message as Message).content === first.content) throw new Error('Message append failed');
        return append(type, data);
      });
    }
    const read = probe('read_probe', true, async () => {
      agent.enqueue(first); agent.enqueue(second);
      return { content: 'Read settled.' };
    });
    const provider = fakeProvider(async function* ({ messages }) {
      assert.deepEqual(messages, [prompt]);
      yield* batch(call(read.name, { value: 'read' }));
    });
    const agent = h.agent(provider, [read], { hook: async (name, payload) => {
      if (scenario === 'prompt.after' && name === 'prompt.after' && (payload.message as Message).content === first.content) throw new Error('Post-commit hook failed');
    } });
    assert.equal((await agent.run(prompt)).outcome, 'failure');
    const session = h.reopen();
    assert.deepEqual(session.history().filter(message => message.role === 'user'), scenario === 'append' ? [prompt] : [prompt, first]);
    assert.deepEqual(session.records().filter(record => record.type === 'queue.pending').flatMap(record => record.data.messages),
      (scenario === 'append' ? [first, second] : [second]).map(message => ({ message, delivery: 'steer' })));
    assert.equal(h.events.filter(event => event.type === 'error').length, 1);
  });
});

test('session hooks drain in commit order, isolate failures and reject new input during finalization', { timeout: 10_000 }, async t => {
  const h = await fixture(t, { secrets: ['synthetic-hook-secret'] });
  const started = deferred();
  const release = deferred();
  const visited: string[] = [];
  const provider = fakeProvider(async function* ({ messages }) { assert.deepEqual(messages, [prompt]); yield* finish(); });
  const agent = h.agent(provider, [], { hook: async (name, payload) => {
    if (name !== 'session.event') return;
    const record = payload.record as SessionRecord;
    visited.push(record.id);
    if (record.type === 'agent.start') {
      started.resolve();
      await release.promise;
      record.data.model = 'observer mutation';
      throw new Error('Observer failed: synthetic-hook-secret');
    }
  } });
  let settled = false;
  const run = agent.run(prompt).then(result => { settled = true; return result; });
  try {
    await started.promise;
    await nextTurn();
    assert.equal(h.session.records().at(-1)!.type, 'agent.end');
    assert.equal(visited.length, 1, 'later observers must wait for earlier commits to finish');
    assert.equal(settled, false);
    assert.equal(agent.running, true);
    assert.throws(() => agent.enqueue(prompt), /No active run/);
    await assert.rejects(agent.run(prompt), /already running/);
    assert.ok(!h.events.some(event => event.type === 'agent.end'));
    release.resolve();
    assert.equal((await run).outcome, 'success');
  } finally { release.resolve(); agent.abort(); await run; }
  assert.deepEqual(visited, h.session.records().map(record => record.id));
  assert.equal(h.session.records()[0]!.data.model, `${model.provider}/${model.id}`);
  assert.equal(h.events.at(-1)!.type, 'agent.end');
  assert.match(String(h.events.find(event => event.type === 'warning')!.message), /Session hook: Observer failed: \[REDACTED\]/);
  assert.equal(h.events.filter(event => event.type === 'error').length, 0);
  assert.equal(agent.running, false);
});

test('a read-result persistence failure waits for active siblings before emitting agent.end', { timeout: 10_000 }, async t => {
  const h = await fixture(t);
  const failed = deferred();
  const release = deferred();
  const append = h.session.append.bind(h.session);
  t.mock.method(h.session, 'append', (type: string, data: Record<string, unknown>) => {
    if (type === 'message' && (data.message as Message).toolCallId === 'first') {
      failed.resolve();
      throw new Error('First read result could not be persisted');
    }
    return append(type, data);
  });
  const read = probe('read_probe', true, async args => {
    if (args.value === 'second') await release.promise;
    return { content: String(args.value) };
  });
  const provider = fakeProvider(async function* ({ messages }) {
    assert.deepEqual(messages, [prompt]);
    yield* batch(call(read.name, { value: 'first' }, 'first'), call(read.name, { value: 'second' }, 'second'));
  });
  const agent = h.agent(provider, [read]);
  let settled = false;
  const run = agent.run(prompt).then(result => { settled = true; return result; });
  try {
    await failed.promise;
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(agent.running, true);
    assert.ok(!h.events.some(event => event.type === 'agent.end'));
    release.resolve();
    const result = await run;
    assert.equal(result.outcome, 'failure');
    assert.match(result.error!, /First read result could not be persisted/);
  } finally { release.resolve(); agent.abort(); await run; }
  assert.equal(h.events.at(-1)!.type, 'agent.end');
  assert.equal(h.session.records().at(-1)!.type, 'agent.end');
  assert.equal(h.events.filter(event => event.type === 'error').length, 1);
  assert.equal(results(h.session.history())[0]!.toolCallId, 'second');
  assert.equal(agent.running, false);
});
