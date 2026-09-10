import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { ProcessRpc, waitFor } from '../src/rpc.js';
import { fixture, messages, until, workspace } from './integration-helpers.js';

test('RPC timeout terminates a process generation and rejects every pending request', async t => {
  const cwd = await workspace(t);
  const rpc = new ProcessRpc(fixture({ mode: 'hang-init' }), cwd, { framing: 'jsonl' });
  t.after(() => rpc.close());
  const signal = new AbortController().signal;
  const first = rpc.request('initialize', {}, signal, 100);
  const second = rpc.request('initialize', {}, signal, 5000);
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every(result => result.status === 'rejected' && /timed out/.test(String(result.reason))));
  assert.equal(rpc.alive, false);
  await assert.rejects(rpc.request('initialize', {}, signal), /timed out/);
});

test('structured argv and environment are passed literally without a shell', async t => {
  const cwd = await workspace(t);
  const rpc = new ProcessRpc({ name: 'argv', command: process.execPath, args: ['-e', `
    process.stdin.once('data', data => {
      const request = JSON.parse(data.toString());
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{arg:process.argv[1],env:process.env.KILN_FIXTURE}})+'\\n');
    });
  `, '$(touch forbidden); spaces'], env: { KILN_FIXTURE: 'literal value' } }, cwd, { framing: 'jsonl' });
  t.after(() => rpc.close());
  assert.deepEqual(await rpc.request('initialize', {}, new AbortController().signal), { arg: '$(touch forbidden); spaces', env: 'literal value' });
});

test('closing rejects pending requests and waits for process-group termination', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'rpc.jsonl');
  const rpc = new ProcessRpc(fixture({ mode: 'hang-init', log }), cwd, { framing: 'jsonl' });
  t.after(() => rpc.close());
  const rejected = assert.rejects(rpc.request('initialize', {}, new AbortController().signal), /closed/);
  await until(async () => (await messages(log)).some(message => message.event === 'spawn'));
  const pid = (await messages(log))[0]!.pid as number;
  await rpc.close();
  await rejected;
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('aborted promise waits still observe immediate and late rejections', async () => {
  await assert.rejects(waitFor(Promise.reject(new Error('Already rejected')), AbortSignal.abort()), { name: 'AbortError' });
  let reject!: (error: Error) => void;
  const promise = new Promise<never>((_resolve, fail) => { reject = fail; });
  const controller = new AbortController();
  const rejected = assert.rejects(waitFor(promise, controller.signal), { name: 'AbortError' });
  controller.abort();
  await rejected;
  reject(new Error('Rejected after cancellation'));
  await new Promise<void>(resolve => setImmediate(resolve));
});
