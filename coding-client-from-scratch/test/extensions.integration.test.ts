import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { ExtensionHost } from '../src/extensions.js';
import { capture, context, workspace } from './integration-helpers.js';

async function extension(cwd: string, name: string, code: string, manifest: Record<string, unknown> = {}): Promise<string> {
  const directory = join(cwd, name);
  await mkdir(directory);
  await writeFile(join(directory, 'extension.json'), JSON.stringify({ apiVersion: 1, name, entry: './index.mjs', ...manifest }));
  await writeFile(join(directory, 'index.mjs'), code);
  return directory;
}

test('example extensions expose namespaced resources and audit without mutation', async t => {
  const cwd = await workspace(t);
  const host = new ExtensionHost({ cwd, emit: () => {}, trusted: true });
  t.after(() => host.close());
  await host.load([resolve('examples/extensions/whitespace'), resolve('examples/extensions/review/extension.json')], 'project');
  assert.ok(host.inspect().every(record => record.loaded && record.errors.length === 0));
  const content = 'first  \r\n\tsecond';
  await writeFile(join(cwd, 'sample.txt'), content);
  const tool = host.tools[0]!;
  assert.equal(tool.name, 'ext__whitespace__audit');
  assert.equal(tool.readonly, true);
  const ctx = context(cwd);
  ctx.mode = 'plan';
  const result = await tool.execute({ path: 'sample.txt' }, ctx);
  assert.equal(ctx.authorized.length, 1);
  assert.equal(ctx.authorized[0]!.action, 'extension');
  assert.equal(ctx.authorized[0]!.resource, 'whitespace/audit');
  assert.equal(ctx.authorized[0]!.tool, tool.name);
  assert.deepEqual(JSON.parse(result.content), { path: 'sample.txt', trailingWhitespaceLines: [1], tabLines: [2], crlfLines: [1], missingFinalNewline: true });
  assert.equal(await readFile(join(cwd, 'sample.txt'), 'utf8'), content);
  assert.match(host.templates.ext__review__changes!, /Do not edit/);
  assert.match(await host.commands.get('ext__review__checklist')!('transport'), /for transport/);
  assert.deepEqual(await host.statuses(), ['Review checklist available']);
  const inspection = host.inspect();
  inspection[0]!.resources.tools.length = 0;
  assert.equal(host.inspect()[0]!.resources.tools.length, 1);
});

test('project trust is checked before imports; user extensions are an explicit trusted-code source', async t => {
  const cwd = await workspace(t);
  const events = capture();
  const path = await extension(cwd, 'trust', `import { writeFileSync } from 'node:fs';
    writeFileSync(new URL('./imported', import.meta.url), 'executed');
    export default api => { api.registerTemplate('prompt', 'Trusted code'); };`);
  const host = new ExtensionHost({ cwd, emit: events.emit, trusted: false });
  t.after(() => host.close());
  await host.load([path], 'project');
  assert.match(host.inspect()[0]!.errors[0]!, /trust/);
  await assert.rejects(readFile(join(path, 'imported')), { code: 'ENOENT' });
  await host.load([path], 'user');
  assert.equal(await readFile(join(path, 'imported'), 'utf8'), 'executed');
  assert.equal(host.inspect()[1]!.loaded, true);
  assert.equal(events.events[0]!.type, 'extension.error');
});

test('activation is transactional; hook, tool, command, status and cleanup failures are isolated', async t => {
  const cwd = await workspace(t);
  const events = capture();
  const broken = await extension(cwd, 'broken', `export default api => {
    api.registerTemplate('partial', 'Must not leak'); throw new Error('activation failed');
  };`);
  const healthy = await extension(cwd, 'healthy', `export default api => {
    api.registerTool({ name: 'boom', description: 'Throws', readonly: true, inputSchema: { type: 'object' }, execute: async () => { throw new Error('tool failed'); } });
    api.registerCommand('boom-command', async () => { throw new Error('command failed'); });
    api.on('turn.start', async () => { throw new Error('hook failed'); });
    api.on('turn.start', async payload => { api.emit('survived', payload); });
    api.on('shutdown', async () => { api.emit('shutdown-seen'); });
    api.registerStatus(async () => { throw new Error('status failed'); });
    api.registerStatus(() => 'healthy');
    return () => { api.emit('cleanup-seen'); throw new Error('cleanup failed'); };
  };`);
  const host = new ExtensionHost({ cwd, emit: events.emit, trusted: true });
  t.after(() => host.close());
  await host.load([broken, healthy], 'user');
  assert.equal(host.templates.ext__broken__partial, undefined);
  assert.equal(host.inspect()[0]!.loaded, false);
  assert.equal(host.inspect()[1]!.loaded, true);
  assert.equal((await host.tools[0]!.execute({}, context(cwd))).isError, true);
  assert.match(await host.commands.get('ext__healthy__boom-command')!(''), /command failed/);
  await host.hook('turn.start', { turn: 2 });
  assert.ok(events.events.some(event => event.type === 'survived' && event.data.turn === 2));
  assert.deepEqual(await host.statuses(), ['healthy']);
  await host.close();
  await host.close();
  assert.equal(events.events.filter(event => event.type === 'cleanup-seen').length, 1);
  assert.equal(events.events.filter(event => event.type === 'shutdown-seen').length, 1);
  assert.ok(host.inspect()[1]!.errors.some(error => error.includes('cleanup failed')));
  assert.deepEqual(await host.statuses(), []);
  assert.equal((await host.tools[0]!.execute({}, context(cwd))).isError, true);
});

test('manifest, resource, namespace and schema validation prevent partial registration', async t => {
  const cwd = await workspace(t);
  const cases: [string, string, Record<string, unknown>?][] = [
    ['version', 'export default () => {};', { apiVersion: 2 }],
    ['unknown', 'export default () => {};', { surprise: true }],
    ['name', 'export default () => {};', { name: 'bad__name' }],
    ['entry', 'export default () => {};', { entry: '../outside.mjs' }],
    ['export', 'export const activate = () => {};'],
    ['resource', `export default api => api.registerTemplate('../bad', 'bad');`],
    ['collision', `export default api => { api.registerTemplate('same', 'one'); api.registerCommand('same', async () => 'two'); };`],
    ['schema', `export default api => api.registerTool({ name: 'bad', description: '', readonly: true, inputSchema: {type:'object',properties:{n:{type:'nonsense'}}}, execute:async()=>({content:''}) });`],
    ['async', `export default api => api.registerTool({ name: 'bad', description: '', readonly: true, inputSchema: {type:'object',$async:true}, execute:async()=>({content:''}) });`],
  ];
  await writeFile(join(cwd, 'outside.mjs'), 'throw new Error("must not import outside entry");');
  const paths: string[] = [];
  for (const [name, code, manifest] of cases) paths.push(await extension(cwd, name, code, manifest));
  const link = await extension(cwd, 'symlink', 'export default () => {};', { entry: './outside.mjs' });
  await symlink(join(cwd, 'outside.mjs'), join(link, 'outside.mjs'));
  paths.push(link);
  const host = new ExtensionHost({ cwd, emit: () => {}, trusted: true });
  t.after(() => host.close());
  await host.load(paths, 'user');
  assert.ok(host.inspect().every(record => !record.loaded && record.errors.length === 1));
  assert.deepEqual(host.tools, []);
  assert.equal(host.commands.size, 0);
  assert.deepEqual(Object.keys(host.templates), []);
  const good = await extension(cwd, 'good', `export default api => { api.registerTemplate('prompt', 'one'); };`);
  await Promise.all([host.load([good], 'user'), host.load([good], 'project')]);
  assert.equal(host.inspect().filter(record => record.loaded).length, 1);
  assert.match(host.inspect().at(-1)!.errors[0]!, /namespace already registered/);
});

test('tool wrappers validate inputs/results and preserve abort and plan boundaries', async t => {
  const cwd = await workspace(t);
  const path = await extension(cwd, 'validation', `export default api => {
    api.registerTool({ name:'run', description:'Validated', readonly:false, inputSchema:{type:'object',properties:{n:{type:'integer'}},required:['n'],additionalProperties:false},
      execute: async args => args.n === 0 ? {content:42} : {content:'ran'} });
  };`);
  const host = new ExtensionHost({ cwd, emit: () => {}, trusted: true });
  t.after(() => host.close());
  await host.load([path], 'user');
  const tool = host.tools[0]!;
  const invalid = context(cwd);
  assert.equal((await tool.execute({ n: '1' }, invalid)).isError, true);
  assert.deepEqual(invalid.authorized, [], 'invalid arguments must not prompt for permission');
  assert.equal((await tool.execute({ n: 0 }, context(cwd))).isError, true);
  assert.deepEqual(await tool.execute({ n: 1 }, context(cwd)), { content: 'ran' });
  const ctx = context(cwd);
  ctx.mode = 'plan';
  assert.match((await tool.execute({ n: 1 }, ctx)).content, /plan mode/);
  await assert.rejects(tool.execute({ n: 1 }, context(cwd, AbortSignal.abort())), { name: 'AbortError' });
});

test('readonly extension tools require exact execution approval even in plan mode', async t => {
  const cwd = await workspace(t);
  const events = capture();
  const path = await extension(cwd, 'gated', `export default api => {
    api.registerTool({ name:'read', description:'Reads', readonly:true, inputSchema:{type:'object'},
      execute: async () => { api.emit('executed'); return {content:'approved'}; } });
  };`);
  const host = new ExtensionHost({ cwd, emit: events.emit, trusted: true });
  t.after(() => host.close());
  await host.load([path], 'user');
  const tool = host.tools[0]!;
  const denied = context(cwd);
  denied.mode = 'plan';
  denied.permissions.authorize = async request => {
    assert.equal(request.action, 'extension');
    assert.equal(request.resource, 'gated/read');
    assert.equal(request.tool, 'ext__gated__read');
    assert.equal(request.cwd, cwd);
    throw new Error('Execution denied');
  };
  assert.match((await tool.execute({}, denied)).content, /Execution denied/);
  assert.ok(!events.events.some(event => event.type === 'executed'));
  const allowed = context(cwd);
  allowed.mode = 'plan';
  assert.deepEqual(await tool.execute({}, allowed), { content: 'approved' });
  assert.equal(allowed.authorized.length, 1);
  assert.equal(events.events.filter(event => event.type === 'executed').length, 1);
  const controller = new AbortController();
  const cancelled = context(cwd, controller.signal);
  cancelled.permissions.authorize = async () => { controller.abort(); };
  await assert.rejects(tool.execute({}, cancelled), { name: 'AbortError' });
  assert.equal(events.events.filter(event => event.type === 'executed').length, 1);
});

test('extension execution and permission waits abort without unhandled late rejections', async t => {
  const cwd = await workspace(t);
  let entered!: (data: Record<string, unknown>) => void;
  const pending = new Promise<Record<string, unknown>>(resolve => { entered = resolve; });
  const path = await extension(cwd, 'abortable', `export default api => {
    api.registerTool({ name:'wait', description:'Waits', readonly:true, inputSchema:{type:'object'},
      execute: async () => new Promise((resolve, reject) => { api.emit('pending', {resolve, reject}); }) });
  };`);
  const host = new ExtensionHost({ cwd, emit: (_type, data) => entered(data!), trusted: true });
  t.after(() => host.close());
  await host.load([path], 'user');
  const tool = host.tools[0]!;
  const controller = new AbortController();
  const rejected = assert.rejects(tool.execute({}, context(cwd, controller.signal)), { name: 'AbortError' });
  const handles = await pending;
  controller.abort();
  await rejected;
  (handles.reject as (error: Error) => void)(new Error('Late tool failure'));
  await new Promise<void>(resolve => setImmediate(resolve));

  const permissionAbort = new AbortController();
  const ctx = context(cwd, permissionAbort.signal);
  let started!: () => void;
  const permissionStarted = new Promise<void>(resolve => { started = resolve; });
  let rejectPermission!: (error: Error) => void;
  ctx.permissions.authorize = () => new Promise<void>((_resolve, reject) => { rejectPermission = reject; started(); });
  const denied = assert.rejects(tool.execute({}, ctx), { name: 'AbortError' });
  await permissionStarted;
  permissionAbort.abort();
  await denied;
  rejectPermission(new Error('Late permission failure'));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test('activation times out transactionally and prevents late registration', async t => {
  const cwd = await workspace(t);
  let entered!: (data: Record<string, unknown>) => void;
  const pending = new Promise<Record<string, unknown>>(resolve => { entered = resolve; });
  let finished!: () => void;
  const lateFinished = new Promise<void>(resolve => { finished = resolve; });
  const stalled = await extension(cwd, 'stalled', `export default async api => {
    api.registerTemplate('partial', 'Must not leak');
    try {
      await new Promise(resolve => api.emit('pending', {resume:resolve, signal:api.signal}));
      api.registerTemplate('late', 'Must not register after timeout');
    } finally { api.emit('finished'); }
  };`);
  const good = await extension(cwd, 'after', `export default api => { api.registerTemplate('prompt', 'Still available'); };`);
  const host = new ExtensionHost({ cwd, trusted: true, emit: (type, data) => {
    if (type === 'pending') entered(data!);
    if (type === 'finished') finished();
  } });
  t.after(() => host.close());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const loading = host.load([stalled, good], 'user');
  const handles = await pending;
  t.mock.timers.tick(5000);
  await loading;
  assert.equal((handles.signal as AbortSignal).aborted, true);
  assert.equal(host.inspect()[0]!.loaded, false);
  assert.match(host.inspect()[0]!.errors[0]!, /timed out after 5000 ms/);
  assert.equal(host.inspect()[1]!.loaded, true);
  assert.deepEqual(Object.keys(host.templates), ['ext__after__prompt']);
  (handles.resume as () => void)();
  await lateFinished;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(Object.keys(host.templates), ['ext__after__prompt']);
});

test('top-level await has the activation deadline and cannot activate after timing out', async t => {
  const cwd = await workspace(t);
  const events = capture();
  const path = await extension(cwd, 'importing', `
    await new Promise(resolve => process.emit('kiln-fixture-importing', resolve));
    export default api => { api.emit('activated'); api.registerTemplate('late', 'Too late'); };
  `);
  const imported = new Promise<() => void>(resolve => { process.once('kiln-fixture-importing', resolve); });
  const host = new ExtensionHost({ cwd, emit: events.emit, trusted: true });
  t.after(() => host.close());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const loading = host.load([path], 'user');
  const resume = await imported;
  t.mock.timers.tick(5000);
  await loading;
  assert.match(host.inspect()[0]!.errors[0]!, /timed out/);
  resume();
  await import(pathToFileURL(join(path, 'index.mjs')).href);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(!events.events.some(event => event.type === 'activated'));
  assert.deepEqual(Object.keys(host.templates), []);
});

test('hook, status, command and cleanup waits have cooperative signals and bounded deadlines', async t => {
  const cwd = await workspace(t);
  const events = capture();
  const waiters = new Map<string, (data: Record<string, unknown>) => void>();
  const waiting = (name: string) => new Promise<Record<string, unknown>>(resolve => { waiters.set(name, resolve); });
  const path = await extension(cwd, 'deadlines', `export default api => {
    const hang = (name, signal) => new Promise((_resolve, reject) => api.emit(name, {signal, reject}));
    api.on('turn.start', ({signal}) => hang('hook-pending', signal));
    api.on('turn.start', () => { api.emit('hook-survived'); });
    api.registerStatus(signal => hang('status-pending', signal));
    api.registerStatus(() => 'survived');
    api.registerCommand('wait', (_args, signal) => hang('command-pending', signal));
    return signal => hang('cleanup-pending', signal);
  };`);
  const host = new ExtensionHost({ cwd, trusted: true, emit: (type, data) => {
    events.emit(type, data);
    waiters.get(type)?.(data!);
  } });
  t.after(() => host.close());
  await host.load([path], 'user');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hookReady = waiting('hook-pending');
  const hook = host.hook('turn.start', { turn: 1 });
  const hookData = await hookReady;
  t.mock.timers.tick(2000);
  await hook;
  assert.equal((hookData.signal as AbortSignal).aborted, true);
  assert.ok(events.events.some(event => event.type === 'hook-survived'));
  (hookData.reject as (error: Error) => void)(new Error('Late hook failure'));

  const statusReady = waiting('status-pending');
  const statuses = host.statuses();
  const statusData = await statusReady;
  t.mock.timers.tick(2000);
  assert.deepEqual(await statuses, ['survived']);
  assert.equal((statusData.signal as AbortSignal).aborted, true);

  const commandReady = waiting('command-pending');
  const command = host.commands.get('ext__deadlines__wait')!('');
  const commandData = await commandReady;
  t.mock.timers.tick(2000);
  assert.match(await command, /timed out after 2000 ms/);
  assert.equal((commandData.signal as AbortSignal).aborted, true);

  const cleanupReady = waiting('cleanup-pending');
  const closing = host.close();
  const cleanupData = await cleanupReady;
  const secondClose = host.close();
  t.mock.timers.tick(2000);
  await Promise.all([closing, secondClose]);
  assert.equal((cleanupData.signal as AbortSignal).aborted, true);
  assert.equal(events.events.filter(event => event.type === 'cleanup-pending').length, 1);
  assert.equal(host.inspect()[0]!.errors.filter(error => error.includes('timed out')).length, 4);
  (cleanupData.reject as (error: Error) => void)(new Error('Late cleanup failure'));
  (statusData.reject as (error: Error) => void)(new Error('Late status failure'));
  (commandData.reject as (error: Error) => void)(new Error('Late command failure'));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test('hook payload cancellation interrupts a pending handler and stops further dispatch', async t => {
  const cwd = await workspace(t);
  let entered!: (signal: AbortSignal) => void;
  const ready = new Promise<AbortSignal>(resolve => { entered = resolve; });
  const events = capture();
  const path = await extension(cwd, 'hook-abort', `export default api => {
    api.on('turn.start', ({signal}) => new Promise(() => api.emit('pending', {signal})));
    api.on('turn.start', () => { api.emit('must-not-run'); });
  };`);
  const host = new ExtensionHost({ cwd, trusted: true, emit: (type, data) => {
    events.emit(type, data);
    if (type === 'pending') entered(data!.signal as AbortSignal);
  } });
  t.after(() => host.close());
  await host.load([path], 'user');
  const controller = new AbortController();
  const hook = host.hook('turn.start', { signal: controller.signal });
  const signal = await ready;
  controller.abort();
  await hook;
  assert.equal(signal.aborted, true);
  assert.ok(!events.events.some(event => event.type === 'must-not-run'));
});

test('shutdown has one two-second budget and does not wait for an in-flight activation', async t => {
  const cwd = await workspace(t);
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let shutdownEntered!: () => void;
  const shutdownReady = new Promise<void>(resolve => { shutdownEntered = resolve; });
  const events = capture();
  const active = await extension(cwd, 'shutdown', `export default api => {
    api.on('shutdown', () => new Promise(() => api.emit('shutdown-pending')));
    return () => { api.emit('cleanup-skipped'); };
  };`);
  const stalled = await extension(cwd, 'loading', `export default api => new Promise(() => api.emit('activation-pending'));`);
  const host = new ExtensionHost({ cwd, trusted: true, emit: (type, data) => {
    events.emit(type, data);
    if (type === 'activation-pending') entered();
    if (type === 'shutdown-pending') shutdownEntered();
  } });
  t.after(() => host.close());
  await host.load([active], 'user');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const loading = host.load([stalled], 'user');
  await ready;
  const closing = host.close();
  await shutdownReady;
  await loading;
  assert.match(host.inspect()[1]!.errors[0]!, /host is closed/);
  t.mock.timers.tick(2000);
  await closing;
  assert.ok(!events.events.some(event => event.type === 'cleanup-skipped'));
  assert.equal(host.inspect()[0]!.errors.filter(error => error.includes('close timed out')).length, 2);
  await assert.rejects(host.load([active], 'user'), /closed/);
});
