import assert from 'node:assert/strict';
import fs, { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { KilnClient, type ClientOptions } from '../src/client.js';
import type { LoadedConfig } from '../src/config.js';
import { ExternalTools } from '../src/external.js';
import type { Config, KilnEvent, PermissionGate, PermissionRequest } from '../src/types.js';
import { hash } from '../src/util.js';
import { localModel, offlineEnv } from './fixtures/fake-provider.js';
import { fixture as rpcFixture, messages } from './integration-helpers.js';

interface ClientInternals {
  active?: Promise<void>;
  external: ExternalTools[];
  inputController: AbortController;
  listeners: Set<(event: KilnEvent) => void>;
  permissions: PermissionGate;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: TestContext, config: Partial<Config> = {}, prompt?: ClientOptions['prompt']) {
  const root = await mkdtemp(join(tmpdir(), 'kiln-client-'));
  const cwd = await realpath(root);
  const configDir = join(cwd, 'config');
  const stateDir = join(cwd, 'state');
  const home = join(cwd, 'home');
  await Promise.all([configDir, stateDir, home].map(path => mkdir(path, { mode: 0o700 })));
  const savedEnv = process.env;
  process.env = offlineEnv(home);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Client unit tests must not contact a provider'); });
  const loaded: LoadedConfig = {
    cwd, configDir, stateDir, trusted: false, sources: [], instructions: '', userExtensions: [], projectExtensions: [], rules: [], redact: value => value,
    config: { model: 'local/fixture', models: [localModel], aliases: {}, providers: { local: { type: 'openai', baseURL: 'http://127.0.0.1:1/v1' } },
      mode: 'build', thinking: 'off', maxTurns: 2, retries: 0, steering: 'steer', templates: {}, extensions: [], servers: [], lsp: [], secrets: [], ...config },
  };
  const events: KilnEvent[] = [];
  const client = new KilnClient({ loaded, prompt, sink: event => events.push(event) });
  t.after(async () => {
    try {
      await client.close();
      assert.equal(fetch.mock.callCount(), 0, 'all model work must be mocked');
      assert.deepEqual(await readdir(home), [], 'tests must not write home configuration');
    } finally { process.env = savedEnv; await rm(root, { recursive: true, force: true }); }
  });
  return { client, internal: client as unknown as ClientInternals, loaded, cwd, events };
}

function provider(t: TestContext, client: KilnClient) {
  return t.mock.method(client.agent.options.provider, 'stream', async function* () {
    yield { type: 'text', text: 'Offline completion.' } as const;
    yield { type: 'stop', reason: 'stop' } as const;
  });
}

test('/resume holds the state-operation lock across realpath and releases it on success or rejection', { timeout: 10_000 }, async t => {
  for (const mismatch of [false, true]) await t.test(mismatch ? 'workspace rejected' : 'workspace accepted', async t => {
    const { client, cwd, events } = await fixture(t);
    await client.initialize();
    const original = client.session;
    const originalId = original.meta.id;
    const agent = client.agent;
    const run = t.mock.method(agent, 'run', async () => ({ outcome: 'success', reason: 'stop', turns: 0 } as const));
    const next = client.store.create(cwd, 'Resume target');
    const nextId = next.meta.id;
    next.close();
    const entered = deferred(); const release = deferred();
    const originalRealpath = fs.realpath;
    let held = false;
    const resolving = t.mock.method(fs, 'realpath', async (...args: Parameters<typeof fs.realpath>) => {
      if (args[0] === cwd && !held) {
        held = true; entered.resolve(); await release.promise;
        if (mismatch) return join(cwd, 'different-workspace');
      }
      return originalRealpath(...args);
    });
    syncBuiltinESMExports();
    const resume = client.command(`/resume ${nextId}`);
    const settled = mismatch ? assert.rejects(resume, /safely switch workspace/) : resume;
    try {
      await entered.promise;
      assert.equal(client.status().running, true);
      assert.equal(client.session, original);
      assert.equal(client.agent, agent);
      await assert.rejects(client.submit('Do not start under a suspended resume.'), /state-changing command is in progress/);
      for (const command of ['/new', '/fork', `/resume ${nextId}`, '/mode plan', '/model local/fixture', '/branch root', '/compact']) {
        await assert.rejects(client.command(command), /changes active state/);
      }
      assert.match(await client.command('/help'), /\/resume/);
      assert.equal(run.mock.callCount(), 0);
      assert.deepEqual(original.records(), []);
      assert.equal(events.some(event => event.type === 'session.changed' || event.type === 'configuration'), false);
    } finally {
      release.resolve();
      try { await settled; } finally { resolving.mock.restore(); syncBuiltinESMExports(); }
    }
    assert.equal(client.session.meta.id, mismatch ? originalId : nextId);
    assert.equal(client.status().running, false);
    if (!mismatch) assert.notEqual(client.agent, agent);
    run.mock.restore();
    provider(t, client);
    await client.submit('The state operation has settled.');
    assert.equal(client.lastResult?.outcome, 'success');
    assert.equal(client.session.history()[0]!.content, 'The state operation has settled.');
  });
});

test('attachment preparation excludes concurrent inputs and state changes until the input is ready', { timeout: 10_000 }, async t => {
  const { client, internal, cwd } = await fixture(t);
  await client.initialize();
  const stream = provider(t, client);
  await writeFile(join(cwd, 'input.txt'), 'Attached fixture.');
  const entered = deferred(); const release = deferred();
  const path = internal.permissions.path.bind(internal.permissions);
  t.mock.method(internal.permissions, 'path', async (...args: Parameters<PermissionGate['path']>) => {
    entered.resolve(); await release.promise; return path(...args);
  });
  const submitting = client.submit('Read @input.txt');
  try {
    await entered.promise;
    assert.equal(client.status().running, true);
    assert.equal(client.agent.running, false);
    await assert.rejects(client.submit('Overlapping input'), /preparing the previous input/);
    await assert.rejects(client.command('/new'), /changes active state/);
    assert.equal(stream.mock.callCount(), 0);
  } finally { release.resolve(); await submitting; }
  assert.equal(stream.mock.callCount(), 1);
  assert.equal(client.session.history()[0]!.attachments?.[0]!.data, 'Attached fixture.');
  assert.equal(client.status().running, false);
});

test('a live agent keeps state commands locked while steering and follow-up inputs join the same run', { timeout: 10_000 }, async t => {
  const { client, internal, events } = await fixture(t);
  await client.initialize();
  const entered = deferred(); const release = deferred();
  const stream = t.mock.method(client.agent.options.provider, 'stream', async function* () {
    entered.resolve(); await release.promise;
    yield { type: 'text', text: 'Offline completion.' } as const;
    yield { type: 'stop', reason: 'stop' } as const;
  });
  const session = client.session;
  const submitting = client.submit('Initial input');
  try {
    await entered.promise;
    const active = internal.active;
    assert.ok(active);
    assert.equal(client.agent.running, true);
    await assert.rejects(client.command('/new'), /changes active state/);
    await assert.rejects(client.command('/mode plan'), /changes active state/);
    await client.submit('Steering input', 'steer');
    assert.equal(await client.command('/follow Follow-up input'), 'Message queued');
    assert.equal(client.status().queued, 2);
    assert.equal(internal.active, active, 'queued input must not replace the active run');
    assert.equal(client.session, session);
    assert.equal(stream.mock.callCount(), 1);
  } finally { release.resolve(); await submitting; }
  assert.equal(client.lastResult?.outcome, 'success');
  assert.equal(stream.mock.callCount(), 2);
  assert.equal(events.filter(event => event.type === 'agent.start').length, 1);
  assert.deepEqual(session.history().filter(message => message.role === 'user').map(message => message.content),
    ['Initial input', 'Steering input', 'Follow-up input']);
  assert.equal(client.status().running, false);
  assert.equal(internal.active, undefined);
});

test('post-agent Git and extension finalization retain active without allowing a new run to overwrite it', { timeout: 10_000 }, async t => {
  for (const gitFails of [false, true]) await t.test(gitFails ? 'Git refresh rejects' : 'Git refresh succeeds', async t => {
    const { client, internal, events } = await fixture(t);
    await client.initialize();
    const stream = provider(t, client);
    const gitEntered = deferred(); const gitRelease = deferred();
    const statusEntered = deferred(); const statusRelease = deferred();
    const git = client.agent.options.tools.find(tool => tool.name === 'git_status')!;
    t.mock.method(git, 'execute', async () => {
      gitEntered.resolve(); await gitRelease.promise;
      if (gitFails) throw new Error('fixture Git refresh failed');
      return { content: 'fixture clean worktree' };
    });
    t.mock.method(client.extensions, 'statuses', async () => {
      statusEntered.resolve(); await statusRelease.promise; return ['fixture extension ready'];
    });
    const submitting = client.submit('First run');
    try {
      await gitEntered.promise;
      assert.equal(client.agent.running, false);
      assert.equal(client.lastResult?.outcome, 'success');
      assert.equal(events.filter(event => event.type === 'agent.end').length, 1);
      const active = internal.active;
      assert.ok(active);
      for (const phase of ['Git', 'extensions']) {
        assert.equal(client.status().running, true, phase);
        assert.equal(internal.active, active, phase);
        await assert.rejects(client.submit(`Overlapping ${phase} run`), /Finishing the previous run/);
        await assert.rejects(client.command('/new'), /changes active state/);
        assert.equal(stream.mock.callCount(), 1);
        assert.equal(internal.active, active, 'a rejected submit must not replace or clear active');
        if (phase === 'Git') { gitRelease.resolve(); await statusEntered.promise; }
      }
    } finally { gitRelease.resolve(); statusRelease.resolve(); await submitting; }
    assert.equal(internal.active, undefined);
    assert.equal(client.status().running, false);
    assert.deepEqual(client.status().extensions, ['fixture extension ready']);
    assert.equal(events.some(event => event.type === 'warning' && String(event.message).includes('fixture Git refresh failed')), gitFails);
    await client.submit('Next run after finalization');
    assert.equal(stream.mock.callCount(), 2);
    assert.deepEqual(client.session.history().filter(message => message.role === 'user').map(message => message.content),
      ['First run', 'Next run after finalization']);
  });
});

test('agent checkpoint callbacks capture their session instead of following the mutable client session', { timeout: 10_000 }, async t => {
  const { client, cwd } = await fixture(t);
  await client.initialize();
  const original = client.session;
  const context = client.agent.options.context;
  const next = client.store.create(cwd, 'Unrelated session');
  // Bypass the public lock to test callback ownership independently of its protection.
  client.session = next;
  try {
    const first = { path: join(cwd, 'first.txt'), before: null, after: 'first', beforeHash: null, afterHash: hash('first') };
    await writeFile(first.path, first.after);
    context.checkpoint(first);
    const second = { path: join(cwd, 'second.txt'), before: null, after: 'second', beforeHash: null, afterHash: hash('second') };
    const finish = context.prepareCheckpoint!(second);
    await writeFile(second.path, second.after);
    finish();
    assert.deepEqual(original.records().map(record => ({ type: record.type, data: record.data })),
      [first, second].map(data => ({ type: 'checkpoint', data })));
    assert.deepEqual(next.records(), [], 'neither checkpoint path may persist into the replacement session');
    await original.undo();
    await assert.rejects(readFile(second.path), { code: 'ENOENT' });
    assert.equal(await readFile(first.path, 'utf8'), 'first');
  } finally { original.close(); }
});

test('close caches one Promise and all-settles resource cleanup even when the active run and cleanups reject', { timeout: 10_000 }, async t => {
  t.mock.method(ExternalTools.prototype, 'discover', async () => []);
  const { client, internal, events } = await fixture(t, { servers: [
    { name: 'first', command: 'must-not-launch' }, { name: 'second', command: 'must-not-launch' },
  ] }, async () => ({ decision: 'once' }));
  await client.initialize();
  const runEntered = deferred(); const runRelease = deferred();
  const lspEntered = deferred(); const lspRelease = deferred();
  const externalRelease = deferred();
  t.mock.method(client.agent, 'run', async () => {
    runEntered.resolve(); await runRelease.promise; throw new Error('fixture active rejection');
  });
  const extensionClose = t.mock.method(client.extensions, 'close', async () => { throw new Error('fixture extension cleanup'); });
  const lspClose = t.mock.method(client.lsp, 'close', async () => {
    lspEntered.resolve(); await lspRelease.promise; throw new Error('fixture LSP cleanup');
  });
  const externalClose = t.mock.method(internal.external[0]!, 'close', async () => { throw new Error('fixture external cleanup'); });
  const lastClose = t.mock.method(internal.external[1]!, 'close', async () => { await externalRelease.promise; });
  const sessionClose = t.mock.method(client.session, 'close');
  const storeClose = t.mock.method(client.store, 'close');
  let notifications = 0;
  client.subscribe(() => { notifications++; });
  const rejected = assert.rejects(client.submit('Reject during close'), /fixture active rejection/);
  await runEntered.promise;
  const closing = client.close();
  let closed = false;
  void closing.then(() => { closed = true; });
  try {
    assert.equal(client.close(), closing, 'concurrent close calls must return the identical Promise');
    await nextTurn();
    assert.equal(extensionClose.mock.callCount(), 0, 'cleanup must wait for the active operation');
    assert.equal(sessionClose.mock.callCount(), 0);
    runRelease.resolve();
    await rejected;
    await lspEntered.promise;
    await nextTurn();
    for (const close of [extensionClose, lspClose, externalClose, lastClose]) assert.equal(close.mock.callCount(), 1);
    assert.equal(closed, false, 'a rejected cleanup must not short-circuit pending peers');
    lspRelease.resolve();
    await nextTurn();
    assert.equal(closed, false, 'the last external cleanup is also awaited');
    assert.equal(sessionClose.mock.callCount(), 0);
    assert.equal(storeClose.mock.callCount(), 0);
    assert.equal(events.some(event => event.type === 'session.end'), false);
  } finally { runRelease.resolve(); lspRelease.resolve(); externalRelease.resolve(); await closing; }
  assert.equal(client.close(), closing, 'settled close calls reuse the cached Promise too');
  assert.equal(sessionClose.mock.callCount(), 1);
  assert.equal(storeClose.mock.callCount(), 1);
  assert.deepEqual(events.filter(event => event.type === 'warning').map(event => event.message),
    ['Resource cleanup failed: fixture extension cleanup', 'Resource cleanup failed: fixture LSP cleanup', 'Resource cleanup failed: fixture external cleanup']);
  assert.equal(events.filter(event => event.type === 'session.end').length, 1);
  assert.ok(notifications > 0);
  assert.equal(internal.listeners.size, 0, 'close removes subscribers');
  await assert.rejects(client.initialize(), /Client is closed/);
  await assert.rejects(client.submit('After close'), /Client is closed/);
  await assert.rejects(client.command('/new'), /Client is closed/);
});

test('close waits for a rejecting async state command before closing the session', { timeout: 10_000 }, async t => {
  const { client } = await fixture(t);
  await client.initialize();
  const entered = deferred(); const release = deferred();
  client.extensions.commands.set('fixture-wait', async () => {
    entered.resolve(); await release.promise; throw new Error('fixture command rejection');
  });
  const rejected = assert.rejects(client.command('/fixture-wait'), /fixture command rejection/);
  await entered.promise;
  const sessionClose = t.mock.method(client.session, 'close');
  const closing = client.close();
  try {
    await nextTurn();
    assert.equal(sessionClose.mock.callCount(), 0);
    assert.equal(client.close(), closing);
  } finally { release.resolve(); await rejected; await closing; }
  assert.equal(sessionClose.mock.callCount(), 1);
});

test('initialization keeps its original canceled signal and never advances to later servers after abort', { timeout: 15_000 }, async t => {
  for (const phase of ['user', 'project', 'discovery'] as const) await t.test(phase, async t => {
    const { client, internal, events } = await fixture(t, { servers: [
      { name: 'first', command: 'must-not-launch' }, { name: 'second', command: 'must-not-launch' },
    ] }, async () => ({ decision: 'once' }));
    const entered = deferred(); const release = deferred();
    const signal = internal.inputController.signal;
    const load = t.mock.method(client.extensions, 'load', async (_paths: string[], source: 'user' | 'project') => {
      if (source === phase) { entered.resolve(); await release.promise; }
    });
    const discover = t.mock.method(ExternalTools.prototype, 'discover', async (received: AbortSignal) => {
      assert.equal(received, signal);
      entered.resolve(); await release.promise;
      received.throwIfAborted();
      return [];
    });
    const extensionClose = t.mock.method(client.extensions, 'close');
    const externalClose = t.mock.method(ExternalTools.prototype, 'close');
    const initializing = client.initialize();
    const rejected = assert.rejects(initializing, { name: 'AbortError' });
    assert.equal(client.initialize(), initializing);
    await entered.promise;
    client.abort();
    assert.equal(signal.aborted, true);
    assert.notEqual(internal.inputController.signal, signal);
    assert.equal(internal.inputController.signal.aborted, false, 'abort rotates the controller for future input, not this initialization');
    const closing = phase === 'user' ? client.close() : undefined;
    try {
      await nextTurn();
      assert.equal(extensionClose.mock.callCount(), 0, 'close must await initialization settlement');
    } finally { release.resolve(); await rejected; await closing; }
    if (!closing) {
      assert.equal(client.initialize(), initializing, 'canceled initialization stays cached despite the new input controller');
      await assert.rejects(client.submit('Must not start'), /still initializing/);
      await client.close();
    }
    assert.deepEqual(load.mock.calls.map(call => call.arguments[1]), phase === 'user' ? ['user'] : ['user', 'project']);
    assert.equal(discover.mock.callCount(), phase === 'discovery' ? 1 : 0);
    assert.equal(externalClose.mock.callCount(), phase === 'discovery' ? 1 : 0);
    assert.equal(extensionClose.mock.callCount(), 1);
    assert.equal(events.some(event => ['session.start', 'project.context', 'model.start', 'warning'].includes(event.type)), false);
    assert.equal(events.filter(event => event.type === 'session.end').length, 1);
  });
});

test('canonical LSP paths authorize and update only Python with case-insensitive shared language matching', { timeout: 15_000 }, async t => {
  for (const [filename, extension, deny] of [['actual.py', '.PY', false], ['actual.PY', 'py', false], ['actual.py', '.PY', true]] as const) {
    await t.test(`${filename} / ${extension} / ${deny ? 'denied' : 'allowed'}`, async t => {
      const approvals: PermissionRequest[] = [];
      const { client, cwd } = await fixture(t, { lsp: [
        { ...rpcFixture({ framing: 'lsp', log: 'typescript.jsonl' }), name: 'typescript', extensions: ['.ts'] },
        { ...rpcFixture({ framing: 'lsp', log: 'python.jsonl' }), name: 'python', extensions: [extension] },
      ] }, async request => {
        approvals.push(request); return { decision: deny ? 'deny' : 'once' };
      });
      const pythonLog = join(cwd, 'python.jsonl');
      const typescriptLog = join(cwd, 'typescript.jsonl');
      try {
        await client.initialize();
        const path = join(cwd, filename);
        const text = 'answer = 42\n';
        await writeFile(path, text);
        await symlink(filename, join(cwd, 'alias.ts'));
        const update = t.mock.method(client.lsp, 'update');
        const format = t.mock.method(client.lsp, 'format');
        if (deny) {
          await assert.rejects(client.command('/diagnostics alias.ts'), /Permission denied: python/);
          assert.equal(update.mock.callCount(), 0);
          assert.deepEqual(await messages(pythonLog), []);
        } else {
          await client.command('/diagnostics alias.ts');
          assert.match(await client.command('/format alias.ts'), /Formatting preview only/);
          assert.deepEqual(update.mock.calls.map(call => call.arguments.slice(0, 2)), [[path, text], [path, text]]);
          assert.equal(format.mock.calls[0]!.arguments[0], path);
          const opened = (await messages(pythonLog)).filter(message => message.method === 'textDocument/didOpen');
          assert.equal(opened.length, 1);
          assert.deepEqual((opened[0]!.params as { textDocument: unknown }).textDocument,
            { uri: pathToFileURL(path).href, text, version: 1, languageId: 'python' });
          assert.equal(await readFile(path, 'utf8'), text, 'formatting remains a preview');
          assert.deepEqual(client.lsp.diagnostics().map(server => [server.server, server.status]),
            [['typescript', 'unavailable'], ['python', 'ready']]);
        }
        assert.deepEqual(approvals.map(request => [request.tool, request.action, request.resource]),
          Array.from({ length: deny ? 1 : 2 }, () => ['language_server', 'extension', 'python']));
        assert.deepEqual(await messages(typescriptLog), [], 'the alias extension must never authorize or launch TypeScript');
      } finally { await client.close(); }
    });
  }
});
