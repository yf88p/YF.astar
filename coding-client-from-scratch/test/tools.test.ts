import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { fstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, writeFile, type FileHandle } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PermissionManager } from '../src/permissions.js';
import { SessionStore } from '../src/sessions.js';
import { createBuiltinTools, runProcess } from '../src/tools.js';
import type { Checkpoint, PermissionRequest, ToolContext } from '../src/types.js';
import { hash, redactor } from '../src/util.js';

const tools = createBuiltinTools();
const signal = () => new AbortController().signal;

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'kiln-tools-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'project');
  const stateDir = join(root, 'state');
  const outside = join(root, 'outside');
  await mkdir(cwd); await mkdir(stateDir); await mkdir(outside);
  const checkpoints: Checkpoint[] = [];
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const requests: PermissionRequest[] = [];
  const context: ToolContext = {
    cwd, stateDir, signal: signal(), mode: 'build', secrets: ['synthetic-private-token'], redact: redactor(['synthetic-private-token']),
    checkpoint: change => { checkpoints.push(change); },
    emit: (type, data) => { events.push({ type, data }); },
    permissions: new PermissionManager({ cwd, stateDir, mode: 'build', emit: () => {}, prompt: async request => {
      requests.push(request); return { decision: 'once' };
    } }),
  };
  const execute = (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find(tool => tool.name === name);
    assert.ok(tool, `Missing tool ${name}`);
    return tool.execute(args, context);
  };
  return { root, cwd, stateDir, outside, context, checkpoints, events, requests, execute };
}

test('builtins expose strict object schemas and technical readonly flags', () => {
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.readonly, !['create_file', 'edit_file', 'shell'].includes(tool.name));
  }
});

test('read_file uses inclusive line ranges, validates types and rejects binary/oversized/non-files', async t => {
  const { cwd, execute, requests } = await fixture(t);
  await writeFile(join(cwd, 'lines.txt'), 'one\r\ntwo\r\nthree\r\n');
  assert.equal((await execute('read_file', { path: 'lines.txt', start_line: 2, end_line: 3 })).content, '2: two\n3: three');
  assert.equal((await execute('read_file', { path: 'lines.txt', start_line: 10 })).content, '');
  assert.equal(requests.length, 0);
  for (const args of [{ path: 3 }, { path: 'lines.txt', start_line: '2' }, { path: 'lines.txt', start_line: null },
    { path: 'lines.txt', start_line: 0 }, { path: 'lines.txt', start_line: 1.5 }, { path: 'lines.txt', start_line: 3, end_line: 2 }]) {
    assert.equal((await execute('read_file', args)).isError, true, JSON.stringify(args));
  }
  await writeFile(join(cwd, 'binary'), Buffer.from([65, 0, 66]));
  await writeFile(join(cwd, 'invalid'), Buffer.from([0xff, 0xfe]));
  await writeFile(join(cwd, 'large'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  assert.match((await execute('read_file', { path: 'binary' })).content, /Binary/);
  assert.match((await execute('read_file', { path: 'invalid' })).content, /Binary/);
  assert.match((await execute('read_file', { path: 'large' })).content, /exceeds/);
  assert.match((await execute('read_file', { path: '.' })).content, /regular file/);
});

test('read_file and formatted diffs redact multiline secrets before inserting line prefixes', async t => {
  const { cwd, context, execute, checkpoints } = await fixture(t);
  context.redact = redactor(['synthetic-private-token', 'private-first\nprivate-second']);
  await writeFile(join(cwd, 'text'), 'private-first\nprivate-second\nsynthetic-private-token\n');
  const read = await execute('read_file', { path: 'text' });
  assert.doesNotMatch(read.content, /private-first|private-second|synthetic-private-token/);
  assert.match(read.content, /REDACTED/);
  const edit = await execute('edit_file', { path: 'text', old_string: 'private-first\nprivate-second', new_string: 'safe' });
  assert.doesNotMatch(edit.content, /private-first|private-second|synthetic-private-token/);
  assert.ok(checkpoints[0]!.before!.includes('private-first'));
});

test('metadata redacts string values before JSON escaping, including quotes, backslashes and newlines', async t => {
  const { cwd, context, execute } = await fixture(t);
  const secret = 'quoted"back\\line\nsynthetic';
  context.redact = redactor([secret]);
  await writeFile(join(cwd, secret), 'ordinary content');
  const result = await execute('read_file', { path: secret });
  assert.equal(result.isError, undefined, result.content);
  assert.equal(result.metadata!.path, join(cwd, '[REDACTED]'));
  assert.doesNotMatch(JSON.stringify(result), /quoted|synthetic/);
});

test('model output has byte/line limits and complete redacted recovery files', async t => {
  const { cwd, stateDir, execute } = await fixture(t);
  await writeFile(join(cwd, 'long.txt'), Array.from({ length: 400 }, (_, i) => `${i} synthetic-private-token ${'x'.repeat(100)}`).join('\n'));
  const result = await execute('read_file', { path: 'long.txt' });
  assert.match(result.content, /Truncated by lines\/bytes/);
  assert.doesNotMatch(result.content, /synthetic-private-token/);
  assert.ok(Buffer.byteLength(result.content) < 25_000);
  const outputs = await readdir(join(stateDir, 'outputs'));
  assert.equal(outputs.length, 1);
  const full = await readFile(join(stateDir, 'outputs', outputs[0]!), 'utf8');
  assert.ok(full.includes('400: 399 [REDACTED]'));
  assert.ok(full.split('\n').length === 400);
  assert.doesNotMatch(full, /synthetic-private-token/);
  assert.equal((await stat(join(stateDir, 'outputs', outputs[0]!))).mode & 0o777, 0o600);
});

test('read authorization blocks protected paths, traversal and symlink escapes without exposing content', async t => {
  const { cwd, outside, context, execute } = await fixture(t);
  await writeFile(join(outside, 'data'), 'outside-should-not-leak');
  await writeFile(join(cwd, '.env'), 'synthetic-env-should-not-leak');
  await symlink(join(outside, 'data'), join(cwd, 'alias'));
  await symlink(join(cwd, '.env'), join(cwd, 'env-alias'));
  context.permissions = new PermissionManager({ cwd, mode: 'build', emit: () => {} });
  for (const path of ['../outside/data', 'alias', '.env', 'env-alias']) {
    const result = await execute('read_file', { path });
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content, /should-not-leak/);
  }
});

test('read_file cannot expose in-workspace user config or state while read_output retains its narrow exception', async t => {
  const { cwd, context, execute } = await fixture(t);
  context.stateDir = join(cwd, 'runtime-state');
  await mkdir(join(context.stateDir, 'outputs'), { recursive: true });
  const userConfig = join(cwd, 'custom-user-settings.data');
  await writeFile(userConfig, 'unknown-private-config');
  await symlink(userConfig, join(cwd, 'settings-alias'));
  await writeFile(join(context.stateDir, 'session-export.txt'), 'unknown-private-state');
  const output = join(context.stateDir, 'outputs', 'result.txt');
  await writeFile(output, 'already redacted output');
  context.permissions = new PermissionManager({ cwd, stateDir: context.stateDir, protectedPaths: [userConfig], mode: 'build', emit: () => {} });
  for (const path of [userConfig, 'settings-alias', 'runtime-state/session-export.txt', output]) {
    const result = await execute('read_file', { path });
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content, /unknown-private-config|unknown-private-state|already redacted output/);
  }
  assert.equal((await execute('read_output', { path: output })).content, 'already redacted output');
});

test('list_directory marks dirs and links and does not read linked content', async t => {
  const { cwd, outside, execute } = await fixture(t);
  await mkdir(join(cwd, 'dir'));
  await writeFile(join(cwd, 'file'), 'text');
  await symlink(outside, join(cwd, 'alias'));
  assert.equal((await execute('list_directory')).content, 'alias@\ndir/\nfile');
});

test('find_files respects hard ignores, nested gitignore negation, inherited rules and symlinks', async t => {
  const { cwd, outside, execute } = await fixture(t);
  await mkdir(join(cwd, 'src')); await mkdir(join(cwd, 'node_modules')); await mkdir(join(cwd, '.git'));
  await writeFile(join(cwd, '.gitignore'), '*.log\nignored.txt\n');
  await writeFile(join(cwd, 'src/.gitignore'), '!keep.log\nnested.txt\n');
  for (const path of ['visible.txt', 'ignored.txt', 'drop.log', 'src/drop.log', 'src/keep.log', 'src/nested.txt', 'src/code.ts', 'node_modules/no.txt', '.git/no.txt', '.env']) {
    await writeFile(join(cwd, path), 'needle');
  }
  await writeFile(join(outside, 'no.txt'), 'needle');
  await symlink(outside, join(cwd, 'link'));
  const result = await execute('find_files', { pattern: '**' });
  assert.equal(result.isError, undefined, result.content);
  assert.match(result.content, /visible.txt/);
  assert.match(result.content, /src\/keep.log/);
  assert.doesNotMatch(result.content, /ignored.txt|drop.log|nested.txt|no.txt|\.env|node_modules|link/);
  const nested = await execute('find_files', { path: 'src', pattern: '*.log' });
  assert.equal(nested.content, 'keep.log');
  const limited = await execute('find_files', { pattern: '**', limit: 1 });
  assert.match(limited.content, /Result limit/);
  assert.equal((await execute('find_files', { pattern: '../*' })).isError, true);
});

test('search is literal, case-aware, limited, and does not search binary or secret contents', async t => {
  const { cwd, execute } = await fixture(t);
  await writeFile(join(cwd, 'a.txt'), 'literal a+b\nLITERAL A+B\nsynthetic-private-token a+b\n');
  await writeFile(join(cwd, 'b.bin'), Buffer.from('a+b\0'));
  await writeFile(join(cwd, '.env'), 'a+b must-not-leak');
  const sensitive = await execute('search', { query: 'a+b' });
  assert.match(sensitive.content, /a.txt:1:literal a\+b/);
  assert.doesNotMatch(sensitive.content, /A\+B|b.bin|must-not-leak|synthetic-private-token/);
  assert.match(sensitive.content, /REDACTED/);
  const insensitive = await execute('search', { query: 'A+B', case_sensitive: false, include: '*.txt', limit: 1 });
  assert.match(insensitive.content, /a.txt:1:/);
  assert.match(insensitive.content, /limit reached/);
  assert.equal((await execute('search', { query: '(a+)+$' })).content, '');
  assert.equal((await execute('search', { query: '' })).isError, true);
});

test('create_file publishes atomically, never overwrites, and checkpoints exact content and hashes', async t => {
  const { cwd, execute, checkpoints } = await fixture(t);
  const result = await execute('create_file', { path: 'new.txt', content: 'hello\n' });
  assert.equal(result.isError, undefined, result.content);
  assert.equal(await readFile(join(cwd, 'new.txt'), 'utf8'), 'hello\n');
  assert.match(result.content, /\+hello/);
  assert.deepEqual(checkpoints, [{ path: join(cwd, 'new.txt'), before: null, after: 'hello\n', beforeHash: null, afterHash: hash('hello\n') }]);
  const conflict = await execute('create_file', { path: 'new.txt', content: 'changed' });
  assert.equal(conflict.isError, true);
  assert.equal(await readFile(join(cwd, 'new.txt'), 'utf8'), 'hello\n');
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(await readdir(cwd), ['new.txt']);
});

test('create_file treats a dangling symlink as an existing destination', async t => {
  const { cwd, execute, checkpoints } = await fixture(t);
  await symlink('missing', join(cwd, 'alias'));
  const result = await execute('create_file', { path: 'alias', content: 'must not publish' });
  assert.equal(result.isError, true);
  assert.match(result.content, /already exists/);
  assert.equal((await lstat(join(cwd, 'alias'))).isSymbolicLink(), true);
  await assert.rejects(stat(join(cwd, 'missing')), /ENOENT/);
  assert.equal(checkpoints.length, 0);
});

test('edit_file is exact, rejects ambiguous/overlapping matches and preserves CRLF and mode', async t => {
  const { cwd, execute, checkpoints } = await fixture(t);
  const before = 'one\r\ntwo\r\nthree\r\n';
  await writeFile(join(cwd, 'text'), before); await chmod(join(cwd, 'text'), 0o764);
  const result = await execute('edit_file', { path: 'text', old_string: 'one\ntwo', new_string: 'ONE\nTWO' });
  const after = 'ONE\r\nTWO\r\nthree\r\n';
  assert.equal(result.isError, undefined, result.content);
  assert.equal(await readFile(join(cwd, 'text'), 'utf8'), after);
  assert.equal((await stat(join(cwd, 'text'))).mode & 0o777, 0o764);
  assert.equal(checkpoints[0]!.beforeHash, hash(before));
  assert.equal(checkpoints[0]!.afterHash, hash(after));
  await writeFile(join(cwd, 'ambiguous'), 'aaa');
  for (const old_string of ['a', 'aa', '', 'missing']) {
    assert.equal((await execute('edit_file', { path: 'ambiguous', old_string, new_string: 'b' })).isError, true);
    assert.equal(await readFile(join(cwd, 'ambiguous'), 'utf8'), 'aaa');
  }
  assert.equal(checkpoints.length, 1);
});

test('canonical keyed queue covers the entire read-modify-write across tool instances and aliases', async t => {
  const { cwd, context, execute, checkpoints } = await fixture(t);
  await writeFile(join(cwd, 'text'), 'a b c');
  await symlink('text', join(cwd, 'alias'));
  const otherEdit = createBuiltinTools().find(tool => tool.name === 'edit_file')!;
  const results = await Promise.all([
    execute('edit_file', { path: 'text', old_string: 'a', new_string: 'A' }),
    otherEdit.execute({ path: 'alias', old_string: 'b', new_string: 'B' }, context),
    execute('edit_file', { path: 'text', old_string: 'c', new_string: 'C' }),
  ]);
  for (const result of results) assert.equal(result.isError, undefined, result.content);
  assert.equal(await readFile(join(cwd, 'text'), 'utf8'), 'A B C');
  assert.equal(checkpoints.length, 3);
  for (let i = 1; i < checkpoints.length; i++) assert.equal(checkpoints[i]!.beforeHash, checkpoints[i - 1]!.afterHash);
  assert.equal((await lstat(join(cwd, 'alias'))).isSymbolicLink(), true);
});

test('concurrent creates have exactly one winner and failed writes leave no checkpoints or temps', async t => {
  const { cwd, execute, checkpoints } = await fixture(t);
  const results = await Promise.all(['first', 'second'].map(content => execute('create_file', { path: 'same', content })));
  assert.equal(results.filter(result => !result.isError).length, 1);
  assert.equal(checkpoints.length, 1);
  const failed = await execute('create_file', { path: 'missing/child', content: 'no' });
  assert.equal(failed.isError, true);
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(await readdir(cwd), ['same']);
  await execute('edit_file', { path: 'same', old_string: 'not-present', new_string: 'no' });
  const retry = await execute('edit_file', { path: 'same', old_string: await readFile(join(cwd, 'same'), 'utf8'), new_string: 'yes' });
  assert.equal(retry.isError, undefined, retry.content);
});

test('a symlink swapped during write approval cannot redirect the mutation', async t => {
  const { cwd, outside, context, execute, checkpoints } = await fixture(t);
  await mkdir(join(cwd, 'safe')); await symlink(join(cwd, 'safe'), join(cwd, 'alias'));
  context.permissions = new PermissionManager({ cwd, mode: 'build', emit: () => {}, prompt: async () => {
    await rm(join(cwd, 'alias')); await symlink(outside, join(cwd, 'alias')); return { decision: 'once' };
  } });
  const result = await execute('create_file', { path: 'alias/file', content: 'do not escape' });
  assert.equal(result.isError, true);
  assert.match(result.content, /Path changed/);
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readdir(join(cwd, 'safe')), []);
  assert.equal(checkpoints.length, 0);
});

test('atomic write failure preserves original bytes and does not record a checkpoint', async t => {
  if (process.getuid?.() === 0) { t.skip('Root bypasses directory write permissions'); return; }
  const { cwd, execute, checkpoints } = await fixture(t);
  const dir = join(cwd, 'readonly');
  await mkdir(dir); await writeFile(join(dir, 'text'), 'before'); await chmod(dir, 0o500);
  try {
    const result = await execute('edit_file', { path: 'readonly/text', old_string: 'before', new_string: 'after' });
    assert.equal(result.isError, true);
    assert.equal(await readFile(join(dir, 'text'), 'utf8'), 'before');
    assert.deepEqual(await readdir(dir), ['text']);
    assert.equal(checkpoints.length, 0);
  } finally { await chmod(dir, 0o700); }
});

test('checkpoint preparation rejects ineligible creates and edits before any publication', async t => {
  const { cwd, context, execute, checkpoints } = await fixture(t);
  await writeFile(join(cwd, 'text'), 'before');
  context.prepareCheckpoint = change => {
    assert.equal(change.afterHash, hash(change.after!));
    throw new Error('Checkpoint content is ineligible');
  };
  for (const [name, args] of [
    ['create_file', { path: 'new', content: 'after' }],
    ['edit_file', { path: 'text', old_string: 'before', new_string: 'after' }],
  ] as const) {
    const result = await execute(name, args);
    assert.equal(result.isError, true);
    assert.match(result.content, /ineligible/);
  }
  assert.equal(await readFile(join(cwd, 'text'), 'utf8'), 'before');
  assert.deepEqual(await readdir(cwd), ['text']);
  assert.equal(checkpoints.length, 0);
});

test('prepared checkpoints finalize once, after atomic publication and directory fsync, without fallback', async t => {
  const { cwd, context, execute, checkpoints } = await fixture(t);
  const probe = await open(join(cwd, 'probe'), 'wx');
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  const originalSync = prototype.sync;
  let directorySynced = false;
  t.mock.method(prototype, 'sync', async function(this: FileHandle) {
    await originalSync.call(this);
    if (fstatSync(this.fd).isDirectory()) directorySynced = true;
  });
  await probe.close(); await rm(join(cwd, 'probe'));
  const prepared: Checkpoint[] = [];
  let finalized = 0;
  context.prepareCheckpoint = change => {
    directorySynced = false;
    if (change.before === null) assert.throws(() => readFileSync(change.path), /ENOENT/);
    else assert.equal(readFileSync(change.path, 'utf8'), change.before);
    prepared.push(change);
    return () => {
      assert.equal(directorySynced, true);
      assert.equal(readFileSync(change.path, 'utf8'), change.after);
      finalized++;
    };
  };
  assert.equal((await execute('create_file', { path: 'text', content: 'before' })).isError, undefined);
  assert.equal((await execute('edit_file', { path: 'text', old_string: 'before', new_string: 'after' })).isError, undefined);
  assert.equal(prepared.length, 2); assert.equal(finalized, 2); assert.equal(checkpoints.length, 0);
  assert.equal(prepared[1]!.beforeHash, prepared[0]!.afterHash);
});

test('publication conflict settles its prepared intent without overwriting a concurrent create or poisoning the session', async t => {
  const { cwd, stateDir, context, execute, checkpoints } = await fixture(t);
  const store = new SessionStore(stateDir, { redact: context.redact });
  t.after(() => store.close());
  const session = store.create(cwd);
  let pending: Checkpoint | undefined;
  let finalized = 0;
  context.prepareCheckpoint = change => {
    const finish = session.prepareCheckpoint!(change);
    pending = change;
    writeFileSync(change.path, 'concurrent writer');
    return () => { finalized++; assert.deepEqual(readdirSync(cwd), ['race']); finish(); };
  };
  const result = await execute('create_file', { path: 'race', content: 'intended contents' });
  assert.equal(result.isError, true);
  assert.match(result.content, /^EEXIST/);
  assert.match(result.content, /Checkpoint finalization failed:.*intent cleared/);
  assert.equal(await readFile(join(cwd, 'race'), 'utf8'), 'concurrent writer');
  assert.equal(finalized, 1); assert.equal(checkpoints.length, 0);
  assert.equal(pending!.beforeHash, null);
  assert.notEqual(hash(await readFile(join(cwd, 'race'), 'utf8')), pending!.afterHash);
  assert.deepEqual(await readdir(cwd), ['race']);
  session.append('message', { message: { role: 'tool', toolCallId: 'race-call', toolName: 'create_file', content: result.content, isError: true } });
  assert.equal(session.records().length, 1);
  assert.equal(session.records()[0]!.type, 'message');
  session.close();
});

test('directory fsync failure settles the published checkpoint before appending the failed tool result', async t => {
  const { cwd, stateDir, context, execute, checkpoints } = await fixture(t);
  const store = new SessionStore(stateDir, { redact: context.redact });
  t.after(() => store.close());
  const session = store.create(cwd);
  await writeFile(join(cwd, 'text'), 'before');
  const probe = await open(join(cwd, 'probe'), 'wx');
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  const originalSync = prototype.sync;
  t.mock.method(prototype, 'sync', async function(this: FileHandle) {
    if (fstatSync(this.fd).isDirectory()) throw new Error('Synthetic directory fsync failure');
    await originalSync.call(this);
  });
  await probe.close(); await rm(join(cwd, 'probe'));
  let intent: Checkpoint | undefined;
  let finalized = 0;
  context.prepareCheckpoint = change => {
    intent = change;
    const finish = session.prepareCheckpoint!(change);
    return () => { finalized++; assert.deepEqual(readdirSync(cwd), ['text']); finish(); };
  };
  const result = await execute('edit_file', { path: 'text', old_string: 'before', new_string: 'published' });
  assert.equal(result.isError, true);
  assert.equal(result.content, 'Synthetic directory fsync failure');
  assert.equal(finalized, 1);
  assert.equal(hash(await readFile(join(cwd, 'text'), 'utf8')), intent!.afterHash);
  const checkpoint = session.records()[0]!;
  assert.equal(checkpoint.type, 'checkpoint');
  assert.deepEqual(checkpoint.data, intent);
  const toolResult = session.append('message', { message: { role: 'tool', toolCallId: 'fsync-call', toolName: 'edit_file', content: result.content, isError: true } });
  assert.equal(toolResult.parentId, checkpoint.id);
  await session.undo(); assert.equal(await readFile(join(cwd, 'text'), 'utf8'), 'before');
  await session.redo(); assert.equal(await readFile(join(cwd, 'text'), 'utf8'), 'published');
  context.prepareCheckpoint = undefined;
  const legacy = await execute('create_file', { path: 'legacy', content: 'legacy publication' });
  assert.equal(legacy.isError, true);
  assert.equal(await readFile(join(cwd, 'legacy'), 'utf8'), 'legacy publication');
  assert.equal(checkpoints.length, 0);
  assert.equal(finalized, 1);
  session.close();
});

test('temporary open failure and cancellation discard prepared writes so the live session can append results', async t => {
  const { cwd, stateDir, context, execute, checkpoints } = await fixture(t);
  const store = new SessionStore(stateDir, { redact: context.redact });
  t.after(() => store.close());
  const session = store.create(cwd);
  await writeFile(join(cwd, 'text'), 'before');
  const originalOpen = fs.open;
  let failOpen = false;
  let failedOpens = 0;
  const mockedOpen = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (failOpen && typeof args[0] === 'string' && /\/\.kiln-[^/]+\.tmp$/.test(args[0])) {
      failedOpens++;
      throw Object.assign(new Error('EACCES: synthetic temporary open failure'), { code: 'EACCES' });
    }
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  let prepared = 0;
  let finalized = 0;
  try {
    for (const failure of ['open', 'abort'] as const) for (const create of [true, false]) {
      const controller = new AbortController();
      context.signal = controller.signal;
      failOpen = failure === 'open';
      context.prepareCheckpoint = change => {
        const finish = session.prepareCheckpoint!(change);
        prepared++;
        if (failure === 'abort') controller.abort();
        return () => {
          finalized++;
          assert.deepEqual(readdirSync(cwd), ['text']);
          finish();
        };
      };
      const name = create ? 'create_file' : 'edit_file';
      const args = create ? { path: 'new', content: 'after' } : { path: 'text', old_string: 'before', new_string: 'after' };
      if (failure === 'abort') await assert.rejects(execute(name, args), { name: 'AbortError' });
      else {
        const result = await execute(name, args);
        assert.equal(result.isError, true);
        assert.equal(result.content, 'EACCES: synthetic temporary open failure');
      }
      assert.equal(finalized, prepared);
      assert.equal(await readFile(join(cwd, 'text'), 'utf8'), 'before');
      await assert.rejects(stat(join(cwd, 'new')), /ENOENT/);
      session.append('message', { message: { role: 'tool', toolCallId: `${name}-${failure}`, toolName: name, content: failure, isError: true } });
    }
    assert.equal(prepared, 4); assert.equal(finalized, 4); assert.equal(failedOpens, 2);
    assert.equal(checkpoints.length, 0);
    assert.equal(session.records().length, 4);
    assert.ok(session.records().every(record => record.type === 'message'));
  } finally {
    mockedOpen.mock.restore(); syncBuiltinESMExports(); session.close();
  }
});

test('abort preserves the operation error and explains a failed finalization without retrying it', async t => {
  const { cwd, stateDir, context, execute, checkpoints } = await fixture(t);
  const store = new SessionStore(stateDir, { redact: context.redact });
  t.after(() => store.close());
  const session = store.create(cwd);
  const id = session.meta.id;
  const controller = new AbortController();
  context.signal = controller.signal;
  let finalized = 0;
  context.prepareCheckpoint = change => {
    session.prepareCheckpoint!(change);
    controller.abort();
    return () => { finalized++; throw new Error('synthetic-private-token database unavailable'); };
  };
  await assert.rejects(execute('create_file', { path: 'new', content: 'after' }), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'AbortError');
    assert.match(error.message, /^Operation aborted\nCheckpoint finalization failed:/);
    assert.match(error.message, /\[REDACTED\] database unavailable/);
    assert.match(error.message, /reopen/);
    return true;
  });
  assert.equal(finalized, 1); assert.equal(checkpoints.length, 0);
  assert.deepEqual(await readdir(cwd), []);
  assert.throws(() => session.append('message', { message: { role: 'user', content: 'blocked until recovery' } }), /pending/);
  session.close();
  const resumed = store.open(id);
  resumed.append('message', { message: { role: 'tool', toolCallId: 'cancel-call', toolName: 'create_file', content: 'aborted', isError: true } });
  assert.equal(resumed.records().length, 1);
  resumed.close();
});

test('tools integrate with durable prepared checkpoints and reject secret content before mutation', async t => {
  const { cwd, stateDir, context, execute, checkpoints } = await fixture(t);
  const store = new SessionStore(stateDir, { redact: context.redact });
  t.after(() => store.close());
  const session = store.create(cwd);
  const id = session.meta.id;
  assert.ok(session.prepareCheckpoint);
  context.prepareCheckpoint = change => session.prepareCheckpoint!(change);
  const ineligible = await execute('create_file', { path: 'secret-bearing.txt', content: 'synthetic-private-token' });
  assert.equal(ineligible.isError, true);
  await assert.rejects(stat(join(cwd, 'secret-bearing.txt')), /ENOENT/);
  assert.equal((await execute('create_file', { path: 'text', content: 'before' })).isError, undefined);
  assert.equal((await execute('edit_file', { path: 'text', old_string: 'before', new_string: 'after' })).isError, undefined);
  assert.equal(checkpoints.length, 0);
  assert.equal(session.records().filter(record => record.type === 'checkpoint').length, 2);
  session.close();
  const resumed = store.open(id);
  await resumed.undo(); assert.equal(await readFile(join(cwd, 'text'), 'utf8'), 'before');
  await resumed.redo(); assert.equal(await readFile(join(cwd, 'text'), 'utf8'), 'after');
  resumed.close();
});

test('every mutation enforces plan mode even when a permissive gate is supplied', async t => {
  const { cwd, context, execute, checkpoints, requests } = await fixture(t);
  context.mode = 'plan';
  await writeFile(join(cwd, 'text'), 'before');
  for (const [name, args] of [
    ['create_file', { path: 'new', content: 'no' }],
    ['edit_file', { path: 'text', old_string: 'before', new_string: 'no' }],
    ['shell', { command: 'printf no' }],
  ] as const) assert.match((await execute(name, args)).content, /plan mode/);
  assert.equal(await readFile(join(cwd, 'text'), 'utf8'), 'before');
  assert.equal(checkpoints.length, 0); assert.equal(requests.length, 0);
});

test('runProcess streams stdout/stderr before exit and reports nonzero exits', async t => {
  const { cwd } = await fixture(t);
  const chunks: string[] = [];
  let observed!: () => void;
  const ready = new Promise<void>(resolve => { observed = resolve; });
  let finished = false;
  const pending = runProcess(process.execPath, ['-e', 'process.stdout.write("first"); setTimeout(() => { process.stderr.write("failure"); process.exitCode = 7; }, 150)'], {
    cwd, signal: signal(), onOutput: text => { chunks.push(text); observed(); },
  }).then(result => { finished = true; return result; });
  await ready;
  assert.equal(finished, false);
  const result = await pending;
  assert.equal(result.stdout, 'first'); assert.equal(result.stderr, 'failure'); assert.equal(result.code, 7); assert.equal(result.signal, null);
  assert.ok(chunks.join('').includes('first'));
});

test('runProcess bounds capture, validates timeout and reports spawn errors', async t => {
  const { cwd } = await fixture(t);
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(5 * 1024 * 1024))'], { cwd, signal: signal() });
  assert.match(result.stdout, /capture omitted/);
  assert.ok(result.stdout.length < 1000);
  await assert.rejects(runProcess('/no-such-kiln-executable', [], { cwd, signal: signal() }), /ENOENT/);
  await assert.rejects(runProcess(process.execPath, [], { cwd, signal: signal(), timeoutMs: -1 }), /positive/);
});

test('runProcess awaits asynchronous stream consumers, bounds in-flight chunks, and propagates sink failure', async t => {
  const { cwd } = await fixture(t);
  const active = { stdout: 0, stderr: 0 };
  const received = { stdout: 0, stderr: 0 };
  let maxActive = 0;
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("a".repeat(1024 * 1024)); process.stderr.write("b".repeat(1024 * 1024));'], {
    cwd, signal: signal(), onOutput: async (text, stream) => {
      active[stream]++; maxActive = Math.max(maxActive, active[stream]);
      await delay(2); received[stream] += Buffer.byteLength(text); active[stream]--;
    },
  });
  assert.equal(result.code, 0);
  assert.equal(maxActive, 1);
  assert.deepEqual(active, { stdout: 0, stderr: 0 });
  assert.deepEqual(received, { stdout: 1024 * 1024, stderr: 1024 * 1024 });
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000);'], {
    cwd, signal: signal(), onOutput: async () => { await delay(5); throw new Error('Synthetic disk failure'); },
  }), /disk failure/);
});

test('abort drains already-written output even when an asynchronous sink is slow', { timeout: 5000 }, async t => {
  const { cwd } = await fixture(t);
  const controller = new AbortController();
  let stdoutBytes = 0;
  const code = 'process.stdout.write("x".repeat(128 * 1024), () => process.stderr.write("written")); setInterval(() => {}, 1000);';
  await assert.rejects(runProcess(process.execPath, ['-e', code], {
    cwd, signal: controller.signal, onOutput: async (text, stream) => {
      if (stream === 'stdout') { if (!stdoutBytes) await delay(1000); stdoutBytes += Buffer.byteLength(text); }
      else if (text.includes('written')) controller.abort();
    },
  }), { name: 'AbortError' });
  assert.equal(stdoutBytes, 128 * 1024);
});

test('runProcess handles pre-abort, timeout, callback failure and abort listener cleanup', async t => {
  const { cwd } = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runProcess(process.execPath, ['-e', '0'], { cwd, signal: controller.signal }), { name: 'AbortError' });
  const live = signal();
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd, signal: live, timeoutMs: 50 }), /timed out/);
  assert.equal(getEventListeners(live, 'abort').length, 0);
  await assert.rejects(runProcess(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], {
    cwd, signal: live, onOutput: () => { throw new Error('output consumer failed'); },
  }), /consumer failed/);
  assert.equal(getEventListeners(live, 'abort').length, 0);
});

test('abort kills TERM-resistant descendants even after the parent exits and closes its pipes', { timeout: 5000 }, async t => {
  const { cwd } = await fixture(t);
  const controller = new AbortController();
  let pid = 0;
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const descendant = 'process.on("SIGTERM", () => {}); process.send("ready"); setInterval(() => {}, 1000)';
  const parent = `const { fork } = require('node:child_process'); const child = fork('-e', [${JSON.stringify(descendant)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); child.on('message', () => { console.log(child.pid); child.disconnect(); }); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);`;
  const pending = runProcess(process.execPath, ['-e', parent], { cwd, signal: controller.signal, onOutput: text => { pid = Number(text.trim()); ready(); } });
  t.after(() => { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} } });
  await started;
  assert.ok(pid > 0);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  // Linux may retain an orphan zombie until PID 1 reaps it; a zombie is no longer executing.
  let alive = true;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { alive = !/^\d+ \(.+\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; alive = false; }
    if (!alive) break;
    await delay(10);
  }
  assert.equal(alive, false, `Descendant ${pid} survived group cancellation`);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('shell labels obvious destructive and network risks without changing exact requests or approving harmless commands', async t => {
  const { cwd, stateDir, context, execute, requests } = await fixture(t);
  context.permissions = new PermissionManager({ cwd, stateDir, mode: 'build', emit: () => {}, prompt: async request => {
    requests.push(request); return { decision: 'deny' };
  } });
  const cases: Array<[string, boolean, boolean]> = [
    ['rm -rf ./scratch', true, false],
    ['sudo -n /bin/rm ./scratch', true, false],
    ['truncate -s 0 ./scratch', true, false],
    ['git clean -fd', true, false],
    ['git -C . reset --hard HEAD', true, false],
    ['git restore --worktree -- ./scratch', true, false],
    ['git push --force-with-lease origin HEAD', true, true],
    ['printf data > ./scratch', true, false],
    ['curl https://example.invalid/file', false, true],
    ['/usr/bin/wget --quiet https://example.invalid/file', false, true],
    ['ssh example.invalid true', false, true],
    ['scp ./scratch example.invalid:destination', false, true],
    ['env FLAG=1 curl https://example.invalid/file', false, true],
    ['npm install example-package', false, true],
    ['npm --prefix . install example-package', false, true],
    ['pip install example-package', false, true],
    ['python3 -m pip install example-package', false, true],
    ['git push origin HEAD', false, true],
    ['git -C . fetch origin', false, true],
    ['git --git-dir=.git fetch origin', false, true],
    ['curl https://example.invalid/file > ./download', true, true],
    ['printf "hello"', false, false],
    ['printf "%s" "curl rm -rf"', false, false],
    ['git status --short', false, false],
    ['npm test', false, false],
  ];
  for (const [command, destructive, network] of cases) {
    const result = await execute('shell', { command, cwd });
    assert.equal(result.isError, true, command);
    const request = requests.at(-1)!;
    assert.equal(request.action, 'shell'); assert.equal(request.tool, 'shell');
    assert.equal(request.command, command); assert.equal(request.resource, command); assert.equal(request.cwd, cwd);
    const exactReason = `Run exact command in ${cwd}: ${command}`;
    assert.ok(request.reason.endsWith(exactReason));
    assert.equal(request.reason.includes('potentially destructive operation'), destructive, command);
    assert.equal(request.reason.includes('network-sensitive operation'), network, command);
    if (destructive || network) assert.match(request.reason, /^Warning:.*not a sandbox\.\n/);
    else assert.equal(request.reason, exactReason);
  }
  assert.equal(requests.length, cases.length);
  await assert.rejects(stat(join(stateDir, 'outputs')), /ENOENT/);
});

test('a destructive shell warning is advisory and does not block an explicitly approved operation', async t => {
  const { cwd, execute, requests } = await fixture(t);
  await writeFile(join(cwd, 'test-owned-victim'), 'synthetic fixture');
  const command = 'rm -- ./test-owned-victim';
  const result = await execute('shell', { command });
  assert.equal(result.isError, false, result.content);
  await assert.rejects(stat(join(cwd, 'test-owned-victim')), /ENOENT/);
  assert.equal(requests.length, 1);
  assert.match(requests[0]!.reason, /potentially destructive operation/);
  assert.equal(requests[0]!.command, command);
});

test('shell uses preferred shell with -c, exact command/cwd approval, progress and redacted nonzero output', async t => {
  const { cwd, context, execute, requests, events } = await fixture(t);
  const preferred = join(cwd, 'preferred-shell');
  await writeFile(preferred, '#!/bin/sh\nprintf "preferred:%s\\n" "$1"\nexec /bin/sh "$@"\n', { mode: 0o700 });
  const previous = process.env.SHELL;
  process.env.SHELL = preferred;
  t.after(() => { if (previous === undefined) delete process.env.SHELL; else process.env.SHELL = previous; });
  const command = 'printf synthetic-private-token; printf err >&2; exit 3';
  const result = await execute('shell', { command });
  assert.equal(result.isError, true);
  assert.match(result.content, /preferred:-c/);
  assert.match(result.content, /Exit code: 3/);
  assert.match(result.content, /\[REDACTED\]/);
  assert.doesNotMatch(result.content, /synthetic-private-token/);
  assert.equal(requests.at(-1)!.command, command);
  assert.equal(requests.at(-1)!.cwd, cwd);
  assert.ok(events.some(event => event.type === 'tool.output'));
  assert.doesNotMatch(JSON.stringify(events), /synthetic-private-token/);
  assert.equal(context.mode, 'build');
});

test('shell chunk-split secrets never appear in progress events or recovery output', async t => {
  const { cwd, execute, events } = await fixture(t);
  const code = 'process.stdout.write("synthetic-private-"); setTimeout(() => process.stdout.write("token"), 50)';
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`;
  const result = await execute('shell', { command, cwd });
  assert.equal(result.isError, false, result.content);
  assert.match(result.content, /REDACTED/);
  assert.doesNotMatch(JSON.stringify(events), /synthetic-private-|token/);
  assert.doesNotMatch(result.content, /synthetic-private-token/);
});

test('shell saves complete output beyond the capture cap with independent stream redaction and live text', async t => {
  const { cwd, context, execute, events } = await fixture(t);
  const script = join(cwd, 'produce.cjs');
  await writeFile(script, `const { once } = require('node:events');
    const write = async (stream, text) => { if (!stream.write(text)) await once(stream, 'drain'); };
    (async () => {
      await write(process.stdout, 'BEGIN\\n');
      for (let i = 0; i < 5000; i++) await write(process.stdout, 'row-' + i + ' ' + 'x'.repeat(1024) + '\\n');
      await write(process.stdout, 'synthetic-private-');
      await write(process.stderr, 'synthetic-private-');
      await new Promise(resolve => setTimeout(resolve, 20));
      await write(process.stdout, 'token\\nEND\\n');
      await write(process.stderr, 'token\\nERROR-END\\n');
    })();`);
  const result = await execute('shell', { command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}` });
  assert.equal(result.isError, false, result.content);
  assert.ok(Buffer.byteLength(result.content) < 24000);
  assert.match(result.content, /Preview truncated/);
  const paths = result.metadata!.outputPaths as { stdout: string; stderr: string };
  const stdout = await readFile(paths.stdout, 'utf8');
  const stderr = await readFile(paths.stderr, 'utf8');
  assert.ok(Buffer.byteLength(stdout) > 4 * 1024 * 1024);
  assert.ok(stdout.startsWith('BEGIN\n')); assert.ok(stdout.endsWith('[REDACTED]\nEND\n'));
  assert.equal(stderr, '[REDACTED]\nERROR-END\n');
  assert.doesNotMatch(stdout + stderr + JSON.stringify(events), /synthetic-private-|token/);
  assert.ok(events.some(event => event.type === 'tool.output' && String(event.data?.text).includes('BEGIN')));
  assert.equal((await stat(paths.stdout)).mode & 0o777, 0o600);
  const saved = events.find(event => event.type === 'tool.output_saved')!;
  assert.equal(saved.data!.complete, true);
  assert.deepEqual(saved.data!.outputPaths, paths);
  context.mode = 'plan';
  const offset = Buffer.byteLength(stdout) - 50;
  const recovered = await execute('read_output', { path: paths.stdout, offset, limit: 50 });
  assert.equal(recovered.isError, undefined, recovered.content);
  assert.equal(recovered.content, stdout.slice(-50));
  assert.equal(recovered.metadata!.nextOffset, Buffer.byteLength(stdout));
  assert.equal(recovered.metadata!.hasMore, false);
  const first = await execute('read_output', { path: paths.stdout, limit: 6 });
  assert.equal(first.content, 'BEGIN\n'); assert.equal(first.metadata!.hasMore, true);
});

test('shell abort and timeout preserve full observed redacted output and emit recovery references', async t => {
  const { cwd, context, execute, events } = await fixture(t);
  const script = join(cwd, 'wait.cjs');
  await writeFile(script, 'process.stdout.write("ready synthetic-private-token " + "x".repeat(128)); setInterval(() => {}, 1000);');
  const controller = new AbortController();
  context.signal = controller.signal;
  const emit = context.emit;
  context.emit = (type, data) => {
    emit(type, data);
    if (type === 'tool.output' && String(data?.text).includes('ready')) controller.abort();
  };
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
  await assert.rejects(execute('shell', { command }), { name: 'AbortError' });
  const aborted = events.find(event => event.type === 'tool.output_saved')!;
  assert.equal(aborted.data!.status, 'aborted'); assert.equal(aborted.data!.complete, true);
  const path = (aborted.data!.outputPaths as { stdout: string }).stdout;
  assert.equal(await readFile(path, 'utf8'), `ready [REDACTED] ${'x'.repeat(128)}`);
  assert.doesNotMatch(JSON.stringify(events), /synthetic-private-token/);
  context.signal = signal(); context.emit = emit;
  const timedOut = await execute('shell', { command, timeout_ms: 200 });
  assert.equal(timedOut.isError, true); assert.match(timedOut.content, /timed out/);
  const saved = events.filter(event => event.type === 'tool.output_saved').at(-1)!;
  assert.equal(saved.data!.status, 'error');
  const timedPath = (saved.data!.outputPaths as { stdout: string }).stdout;
  assert.ok(timedOut.content.includes(timedPath));
  assert.match(await readFile(timedPath, 'utf8'), /ready \[REDACTED\]/);
  assert.match((await execute('read_output', { path })).content, /ready \[REDACTED\]/);
});

test('shell masks generic API keys split across chunks without retaining an unbounded token', async t => {
  const { cwd, context, execute, events } = await fixture(t);
  context.secrets = [];
  context.redact = redactor([]);
  const script = join(cwd, 'generic.cjs');
  await writeFile(script, `const { once } = require('node:events');
    const write = async text => { if (!process.stdout.write(text)) await once(process.stdout, 'drain'); };
    (async () => {
      for (const text of ['s', 'k-', 'generic-', '0123456789ABCDEF', 'TAIL']) {
        await write(text); await new Promise(resolve => setTimeout(resolve, 10));
      }
      await write('\\nsk-' + 'x'.repeat(5 * 1024 * 1024) + '\\nordinary\\n');
    })();`);
  const result = await execute('shell', { command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}` });
  assert.equal(result.isError, false, result.content);
  const path = (result.metadata!.outputPaths as { stdout: string }).stdout;
  assert.equal(await readFile(path, 'utf8'), '[REDACTED]\n[REDACTED]\nordinary\n');
  assert.doesNotMatch(JSON.stringify(events), /generic-|0123456789ABCDEF|TAIL|xxx/);
});

test('read_output rejects state configuration, traversal, symlinks, hard links and non-regular artifacts', async t => {
  const { stateDir, outside, execute } = await fixture(t);
  await mkdir(join(stateDir, 'outputs'));
  await writeFile(join(stateDir, 'config.txt'), 'state-config-must-not-leak');
  await writeFile(join(outside, 'outside.txt'), 'outside-must-not-leak');
  await writeFile(join(stateDir, 'outputs', 'good.txt'), 'allowed');
  await writeFile(join(stateDir, 'outputs', 'wrong.json'), 'wrong-extension-must-not-leak');
  await mkdir(join(stateDir, 'outputs', 'directory.txt'));
  await symlink(join(outside, 'outside.txt'), join(stateDir, 'outputs', 'alias.txt'));
  await link(join(outside, 'outside.txt'), join(stateDir, 'outputs', 'hard.txt'));
  for (const path of [join(stateDir, 'config.txt'), join(stateDir, 'outputs/../config.txt'), join(outside, 'outside.txt'),
    join(stateDir, 'outputs', 'wrong.json'), join(stateDir, 'outputs', 'directory.txt'), join(stateDir, 'outputs', 'alias.txt'), join(stateDir, 'outputs', 'hard.txt')]) {
    const result = await execute('read_output', { path });
    assert.equal(result.isError, true, path); assert.doesNotMatch(result.content, /must-not-leak/);
  }
  assert.equal((await execute('read_output', { path: join(stateDir, 'outputs', 'good.txt') })).content, 'allowed');
  for (const args of [{ offset: -1 }, { offset: '1' }, { limit: 24001 }, { limit: null }]) {
    assert.equal((await execute('read_output', { path: join(stateDir, 'outputs', 'good.txt'), ...args })).isError, true);
  }
  await rm(join(stateDir, 'outputs'), { recursive: true });
  await symlink(outside, join(stateDir, 'outputs'));
  assert.equal((await execute('read_output', { path: join(stateDir, 'outputs', 'outside.txt') })).isError, true);
});

test('read_output byte windows preserve UTF-8 and re-redact secrets across file-read boundaries', async t => {
  const { stateDir, context, execute } = await fixture(t);
  await mkdir(join(stateDir, 'outputs'));
  const path = join(stateDir, 'outputs', 'unicode.txt');
  const text = '\u20ac\ud83d\ude00\u00e9'.repeat(10);
  await writeFile(path, text);
  let content = '';
  let offset = 0;
  for (;;) {
    const result = await execute('read_output', { path, offset, limit: 11 });
    assert.equal(result.isError, undefined, result.content);
    assert.doesNotMatch(result.content, /\ufffd/);
    content += result.content;
    offset = result.metadata!.nextOffset as number;
    if (!result.metadata!.hasMore) break;
  }
  assert.equal(content, text);
  assert.equal(offset, Buffer.byteLength(text));
  context.secrets = ['newly-configured\nmultiline-secret'];
  context.redact = redactor(context.secrets);
  const prefix = 'x'.repeat(65530);
  await writeFile(path, `${prefix}newly-configured\nmultiline-secret\nend`);
  const result = await execute('read_output', { path, offset: prefix.length, limit: 100 });
  assert.equal(result.content, '[REDACTED]\nend');
});

test('git tools are readonly in plan, disable external diff/textconv/fsmonitor and authorize protected diffs', async t => {
  const { cwd, context, execute } = await fixture(t);
  const runGit = async (...args: string[]) => {
    const result = await runProcess('git', args, { cwd, signal: signal(), env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.code, 0, result.stderr);
  };
  await runGit('init', '-q');
  await writeFile(join(cwd, 'file.txt'), 'before\n');
  await writeFile(join(cwd, '.env'), 'synthetic-before\n');
  await runGit('add', '-f', 'file.txt', '.env');
  await runGit('-c', 'user.name=Kiln Test', '-c', 'user.email=kiln@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  await writeFile(join(cwd, 'file.txt'), 'synthetic-private-token\n');
  await writeFile(join(cwd, 'evil'), '#!/bin/sh\nprintf executed > external-executed\n', { mode: 0o700 });
  await writeFile(join(cwd, '.gitattributes'), '*.txt diff=evil\n');
  await runGit('config', 'diff.external', './evil');
  await runGit('config', 'diff.evil.textconv', './evil');
  await runGit('config', 'core.fsmonitor', './evil');
  context.mode = 'plan';
  context.permissions = new PermissionManager({ cwd, mode: 'plan', emit: () => {} });
  const status = await execute('git_status');
  assert.equal(status.isError, false, status.content);
  assert.match(status.content, /file.txt/);
  const diff = await execute('git_diff');
  assert.equal(diff.isError, false, diff.content);
  assert.match(diff.content, /\+\[REDACTED\]/);
  assert.doesNotMatch(diff.content, /synthetic-private-token/);
  await assert.rejects(stat(join(cwd, 'external-executed')), /ENOENT/);
  await writeFile(join(cwd, '.env'), 'synthetic-env-must-not-leak\n');
  const protectedDiff = await execute('git_diff');
  assert.equal(protectedDiff.isError, true);
  assert.doesNotMatch(protectedDiff.content, /synthetic-env-must-not-leak/);
});

test('git_diff only includes approved literal filenames and rejects redirected worktrees', async t => {
  const { cwd, outside, context, execute } = await fixture(t);
  const runGit = async (...args: string[]) => {
    const result = await runProcess('git', args, { cwd, signal: signal(), env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.code, 0, result.stderr);
  };
  await runGit('init', '-q');
  await writeFile(join(cwd, '*.txt'), 'before\n');
  await writeFile(join(cwd, '.env'), 'before\n');
  await runGit('add', '-f', '--', '*.txt', '.env');
  await runGit('-c', 'user.name=Kiln Test', '-c', 'user.email=kiln@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  await writeFile(join(cwd, '*.txt'), 'approved-change\n');
  const gate = new PermissionManager({ cwd, mode: 'build', emit: () => {} });
  context.permissions = {
    authorize: (request, signal) => gate.authorize(request, signal),
    path: async (path, action, tool, signal) => {
      if (path === join(cwd, '*.txt')) await writeFile(join(cwd, '.env'), 'newly-changed-secret\n');
      return gate.path(path, action, tool, signal);
    },
  };
  const diff = await execute('git_diff');
  assert.equal(diff.isError, false, diff.content);
  assert.match(diff.content, /approved-change/);
  assert.doesNotMatch(diff.content, /newly-changed-secret|\.env/);
  await runGit('config', 'core.worktree', outside);
  const redirected = await execute('git_diff');
  assert.equal(redirected.isError, true);
  assert.match(redirected.content, /worktree/);
});

test('git_status reports root and branch for clean, unborn and detached worktrees without remote URLs', async t => {
  const { cwd, context, execute } = await fixture(t);
  const runGit = async (...args: string[]) => {
    const result = await runProcess('git', args, { cwd, signal: signal(), env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.code, 0, result.stderr);
  };
  await runGit('init', '-q', '--initial-branch=audit-main');
  await runGit('config', 'remote.origin.url', 'https://audit-user:unconfigured-remote-secret@example.invalid/private-repo.git');
  await runGit('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  await runGit('config', 'branch.audit-main.remote', 'origin');
  await runGit('config', 'branch.audit-main.merge', 'refs/heads/audit-main');
  context.mode = 'plan';
  const unborn = await execute('git_status');
  assert.equal(unborn.isError, false, unborn.content);
  assert.match(unborn.content, /## No commits yet on audit-main/);
  assert.deepEqual(unborn.metadata, { code: 0, root: cwd, branch: 'audit-main' });
  await mkdir(join(cwd, 'src')); await writeFile(join(cwd, 'src', 'file'), 'tracked\n');
  await runGit('add', 'src/file');
  await runGit('-c', 'user.name=Kiln Test', '-c', 'user.email=kiln@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  await runGit('update-ref', 'refs/remotes/origin/audit-main', 'HEAD');
  const clean = await execute('git_status', { path: 'src' });
  assert.equal(clean.isError, false, clean.content);
  assert.equal(clean.content, `Repository root: ${cwd}\n## audit-main...origin/audit-main\n`);
  assert.deepEqual(clean.metadata, { code: 0, root: cwd, branch: 'audit-main' });
  await runGit('-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', 'HEAD');
  const detached = await execute('git_status');
  assert.equal(detached.isError, false, detached.content);
  assert.match(detached.content, /## HEAD \(no branch\)/);
  assert.deepEqual(detached.metadata, { code: 0, root: cwd, branch: null });
  assert.doesNotMatch(JSON.stringify([unborn, clean, detached]), /https:\/\/|audit-user|unconfigured-remote-secret|private-repo/);
});

test('readonly Git neutralizes clean/process/smudge/required filters, included config and credential environment', async t => {
  const { cwd, context, execute, events } = await fixture(t);
  const runGit = async (...args: string[]) => {
    const result = await runProcess('git', args, { cwd, signal: signal(), env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.code, 0, result.stderr);
  };
  await runGit('init', '-q');
  for (const path of ['a.clean', 'b.process', 'c.include']) await writeFile(join(cwd, path), 'before\n');
  await runGit('add', '.');
  await runGit('-c', 'user.name=Kiln Test', '-c', 'user.email=kiln@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  await writeFile(join(cwd, 'evil'), '#!/bin/sh\nprintf executed > filter-executed\nprintf "%s" "$OPENAI_API_KEY" > credential-leaked\nprintf "%s" "$OPENAI_API_KEY"\n', { mode: 0o700 });
  await writeFile(join(cwd, '.gitattributes'), '*.clean filter=direct\n*.process filter=long-running\n*.include filter=Included.Name\n');
  for (const [driver, setting] of [['direct', 'clean'], ['direct', 'smudge'], ['long-running', 'process']]) {
    await runGit('config', `filter.${driver}.${setting}`, './evil');
    await runGit('config', `filter.${driver}.required`, 'true');
  }
  await writeFile(join(cwd, '.git', 'filter-config'), '[filter "Included.Name"]\nclean = ./evil\nsmudge = ./evil\nprocess = ./evil\nrequired = true\n');
  await runGit('config', 'include.path', 'filter-config');
  for (const path of ['a.clean', 'b.process', 'c.include']) await writeFile(join(cwd, path), 'after\n');
  const previousPath = process.env.PATH;
  const previousKey = process.env.OPENAI_API_KEY;
  let realGit = '';
  for (const dir of (previousPath ?? '').split(':')) {
    const candidate = join(dir, 'git');
    try { if ((await stat(candidate)).isFile()) { realGit = candidate; break; } } catch {}
  }
  assert.ok(realGit);
  const bin = join(cwd, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'git'), `#!/bin/sh\nprintf '%s' "\${OPENAI_API_KEY-unset}" > git-env-seen\nexec ${JSON.stringify(realGit)} "$@"\n`, { mode: 0o700 });
  process.env.PATH = `${bin}:${previousPath}`;
  process.env.OPENAI_API_KEY = 'synthetic-environment-credential';
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  });
  context.mode = 'plan';
  context.permissions = new PermissionManager({ cwd, mode: 'plan', emit: () => {} });
  for (const name of ['git_status', 'git_diff']) {
    const result = await execute(name);
    assert.equal(result.isError, false, result.content);
    assert.match(result.content, /a.clean|after/);
    assert.doesNotMatch(result.content + JSON.stringify(events), /synthetic-environment-credential/);
  }
  assert.equal(await readFile(join(cwd, 'git-env-seen'), 'utf8'), 'unset');
  await assert.rejects(stat(join(cwd, 'filter-executed')), /ENOENT/);
  await assert.rejects(stat(join(cwd, 'credential-leaked')), /ENOENT/);
});
