import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { ExternalTools } from '../src/external.js';
import { capture, context, fixture, messages, until, workspace } from './integration-helpers.js';

test('external JSONL handshake, fragmented UTF-8, progress and exact execution authorization', async t => {
  const cwd = await workspace(t);
  const events = capture();
  const log = join(cwd, 'rpc.jsonl');
  const host = new ExternalTools(fixture({ fragment: true, log }), cwd, events.emit);
  t.after(() => host.close());
  const [tool] = await host.discover(new AbortController().signal);
  assert.equal(tool!.name, 'external__fixture__echo');
  assert.equal(tool!.readonly, false, 'servers cannot self-declare plan-safe tools');
  const ctx = context(cwd);
  const text = 'UTF-8: \u03bb \u65e5\u672c \ud83d\ude80';
  assert.equal((await tool!.execute({ text }, ctx)).content, text);
  assert.equal(ctx.authorized.length, 1);
  assert.equal(ctx.authorized[0]!.action, 'extension');
  assert.equal(ctx.authorized[0]!.resource, 'fixture/echo');
  assert.equal(ctx.authorized[0]!.tool, tool!.name);
  assert.ok(events.events.some(event => event.type === 'external.progress' && event.data.server === 'fixture' && event.data.requestId === 3));
  const requests = (await messages(log)).filter(message => message.method);
  assert.deepEqual(requests.map(message => message.method), ['initialize', 'tools/list', 'tools/call']);
  assert.equal((requests[0]!.params as Record<string, unknown>).protocolVersion, 'kiln-tools/1');
  assert.deepEqual(requests.map(message => message.id), [1, 2, 3]);
});

test('plan, denied permissions, invalid arguments and abort cannot execute a process tool', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'rpc.jsonl');
  const host = new ExternalTools(fixture({ log }), cwd, () => {});
  t.after(() => host.close());
  const [tool] = await host.discover(new AbortController().signal);
  const ctx = context(cwd);
  ctx.mode = 'plan';
  await assert.rejects(tool!.execute({ text: 'hello' }, ctx), /plan mode/);
  assert.equal(ctx.authorized.length, 0);
  ctx.mode = 'build';
  ctx.permissions.authorize = async () => { throw new Error('Denied'); };
  await assert.rejects(tool!.execute({ text: 'hello' }, ctx), /Denied/);
  const invalid = context(cwd);
  await assert.rejects(tool!.execute({ text: 7 }, invalid), /Invalid tool arguments/);
  await assert.rejects(tool!.execute({ text: 'hello', extra: true }, invalid), /Invalid tool arguments/);
  assert.deepEqual(invalid.authorized, [], 'validate before requesting execution permission');
  await assert.rejects(tool!.execute({ text: 'hello' }, context(cwd, AbortSignal.abort())), { name: 'AbortError' });
  assert.ok(!(await messages(log)).some(message => message.method === 'tools/call'));
});

test('discovery failure rejects and the next discovery starts a new process', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'rpc.jsonl');
  const host = new ExternalTools(fixture({ mode: 'list-error', marker: join(cwd, 'generation'), log }), cwd, () => {});
  t.after(() => host.close());
  await assert.rejects(host.discover(new AbortController().signal), /Discovery failed/);
  const [tool] = await host.discover(new AbortController().signal);
  assert.equal((await tool!.execute({ text: 'recovered' }, context(cwd))).content, 'recovered');
  assert.equal((await messages(log)).filter(message => message.event === 'spawn').length, 2);
});

test('crashes reject all pending calls and an existing tool wrapper restarts on execute', async t => {
  const cwd = await workspace(t);
  const host = new ExternalTools(fixture(), cwd, () => {});
  t.after(() => host.close());
  const [tool] = await host.discover(new AbortController().signal);
  const hanging = tool!.execute({ text: 'hang' }, context(cwd));
  const crashing = tool!.execute({ text: 'crash' }, context(cwd));
  const results = await Promise.allSettled([hanging, crashing]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal((await tool!.execute({ text: 'after restart' }, context(cwd))).content, 'after restart');
});

test('restart refreshes the schema instead of trusting a stale tool wrapper', async t => {
  const cwd = await workspace(t);
  const host = new ExternalTools(fixture({ mode: 'changed-schema', marker: join(cwd, 'generation') }), cwd, () => {});
  t.after(() => host.close());
  const [tool] = await host.discover(new AbortController().signal);
  await assert.rejects(tool!.execute({ text: 'crash' }, context(cwd)));
  const invalid = context(cwd);
  await assert.rejects(tool!.execute({ text: 'short' }, invalid), /Invalid tool arguments/);
  assert.deepEqual(invalid.authorized, [], 'the current generation schema must be checked before permission');
  assert.equal((await tool!.execute({ text: 'long enough' }, context(cwd))).content, 'long enough');
});

test('cooperative cancellation sends the request ID and keeps the server usable', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'rpc.jsonl');
  const host = new ExternalTools(fixture({ log }), cwd, () => {});
  t.after(() => host.close());
  const [tool] = await host.discover(new AbortController().signal);
  const controller = new AbortController();
  const running = tool!.execute({ text: 'hang' }, context(cwd, controller.signal));
  const rejected = assert.rejects(running, { name: 'AbortError' });
  await until(async () => (await messages(log)).some(message => message.method === 'tools/call'));
  controller.abort();
  await rejected;
  await until(async () => (await messages(log)).some(message => message.method === 'cancel'));
  assert.equal((await tool!.execute({ text: 'still usable' }, context(cwd))).content, 'still usable');
  const requests = await messages(log);
  assert.deepEqual(requests.find(message => message.method === 'cancel')!.params, { id: 3 });
  assert.equal(requests.filter(message => message.event === 'spawn').length, 1);
});

test('ignored cancellation terminates the server and rejects other pending calls', async t => {
  const cwd = await workspace(t);
  const events = capture();
  const log = join(cwd, 'rpc.jsonl');
  const host = new ExternalTools(fixture({ mode: 'ignore-cancel', log }), cwd, events.emit);
  t.after(() => host.close());
  const [tool] = await host.discover(new AbortController().signal);
  const controller = new AbortController();
  const running = tool!.execute({ text: 'hang' }, context(cwd, controller.signal));
  const rejected = assert.rejects(running, { name: 'AbortError' });
  const other = assert.rejects(tool!.execute({ text: 'hang' }, context(cwd)), /ignored cancellation/);
  await until(async () => (await messages(log)).filter(message => message.method === 'tools/call').length === 2);
  controller.abort();
  await rejected;
  await other;
  assert.ok(events.events.some(event => event.type === 'external.error' && String(event.data.error).includes('ignored cancellation')));
  assert.equal((await tool!.execute({ text: 'restarted' }, context(cwd))).content, 'restarted');
  assert.equal((await messages(log)).filter(message => message.event === 'spawn').length, 2);
});

test('protocol errors, bad schemas and duplicate names fail discovery honestly', async t => {
  const cwd = await workspace(t);
  for (const mode of ['bad-version', 'bad-json', 'invalid-utf8', 'bad-schema', 'async-schema', 'invalid-name', 'duplicate-tools', 'huge-jsonl']) {
    await t.test(mode, async () => {
      const host = new ExternalTools(fixture({ mode }), cwd, () => {});
      try { await assert.rejects(host.discover(new AbortController().signal)); }
      finally { await host.close(); }
    });
  }
});

test('tool RPC errors reject without losing the connection; malformed results force restart', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'rpc.jsonl');
  const host = new ExternalTools(fixture({ log }), cwd, () => {});
  t.after(() => host.close());
  const [tool] = await host.discover(new AbortController().signal);
  await assert.rejects(tool!.execute({ text: 'error' }, context(cwd)), /Tool execution failed/);
  assert.equal((await tool!.execute({ text: 'still alive' }, context(cwd))).content, 'still alive');
  assert.equal((await messages(log)).filter(message => message.event === 'spawn').length, 1);
  await assert.rejects(tool!.execute({ text: 'bad-result' }, context(cwd)), /Invalid tools\/call result/);
  assert.equal((await tool!.execute({ text: 'restarted' }, context(cwd))).content, 'restarted');
  assert.equal((await messages(log)).filter(message => message.event === 'spawn').length, 2);
  await host.close();
  await assert.rejects(host.discover(new AbortController().signal), /closed/);
});

test('spawn failures do not crash the application', async t => {
  const cwd = await workspace(t);
  const host = new ExternalTools({ name: 'missing', command: join(cwd, 'does-not-exist') }, cwd, () => {});
  t.after(() => host.close());
  await assert.rejects(host.discover(new AbortController().signal), /ENOENT/);
  await assert.rejects(host.discover(new AbortController().signal), /ENOENT/);
});

test('external stderr emits byte counts only, including split credentials before failure', async t => {
  const cwd = await workspace(t);
  for (const stderrCrash of [false, true]) {
    const events = capture();
    const stderrFragments = ['Bearer split-', 'credential-value', '\u03bb\n'];
    const host = new ExternalTools(fixture({ stderrFragments, stderrCrash }), cwd, events.emit);
    try {
      if (stderrCrash) await assert.rejects(host.discover(new AbortController().signal));
      else await host.discover(new AbortController().signal);
      const bytes = Buffer.byteLength(stderrFragments.join(''));
      await until(() => events.events.filter(event => event.type === 'external.stderr').reduce((sum, event) => sum + Number(event.data.bytes), 0) === bytes);
      for (const event of events.events.filter(event => event.type === 'external.stderr')) {
        assert.deepEqual(Object.keys(event.data).sort(), ['bytes', 'server']);
        assert.ok(Number.isInteger(event.data.bytes) && Number(event.data.bytes) > 0);
      }
      for (const fragment of stderrFragments) assert.ok(!JSON.stringify(events.events).includes(fragment));
    } finally { await host.close(); }
  }
});
