import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { SessionStore } from '../src/sessions.js';
import type { Checkpoint, Session, SessionMeta, SessionRecord } from '../src/types.js';
import { atomicWrite, hash, redactor } from '../src/util.js';

interface ExportFixture { version: number; meta: SessionMeta; records: SessionRecord[]; config?: unknown }
interface PendingWriteFixture { kind: string; record: SessionRecord; authority: Record<string, unknown> }

function fixture(t: TestContext, redact?: (text: string) => string): { root: string; state: string; cwd: string; store: SessionStore } {
  const root = mkdtempSync(join(tmpdir(), 'kiln-sessions-'));
  const state = join(root, 'state');
  const cwd = join(root, 'workspace');
  mkdirSync(cwd);
  const store = new SessionStore(state, { redact });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, state, cwd, store };
}

function checkpointChange(path: string, before: string | null, after: string | null): Checkpoint {
  return { path, before, after, beforeHash: before === null ? null : hash(before), afterHash: after === null ? null : hash(after) };
}

function checkpoint(session: Session, path: string, before: string | null, after: string | null): string {
  return session.append('checkpoint', { ...checkpointChange(path, before, after) }).id;
}

test('durable resume, metadata, arbitrary configuration, isolated returned values and recent selection', t => {
  const { store, state, cwd } = fixture(t);
  const first = store.create(cwd, 'First');
  const firstId = first.meta.id;
  const message = first.append('message', { message: { role: 'user', content: 'hello' } });
  first.append('configuration', { provider: 'local', model: 'test-model', thinking: 'high', custom: { value: 2 } });
  const other = store.create(cwd, 'Second');
  other.close();
  first.rename('Renamed');
  first.label('Important');
  first.label('Important');
  assert.deepEqual(store.list('IMPORTANT').map(meta => meta.id), [firstId]);
  assert.equal(store.list()[0]?.id, firstId);
  message.data.message = { role: 'user', content: 'mutated' };
  first.meta.labels.push('not persisted');
  assert.deepEqual(first.history(), [{ role: 'user', content: 'hello' }]);
  store.close();
  const resumed = new SessionStore(state);
  t.after(() => resumed.close());
  const session = resumed.open();
  assert.equal(session.meta.id, firstId);
  assert.equal(session.meta.name, 'Renamed');
  assert.deepEqual(session.meta.labels, ['Important']);
  assert.deepEqual(session.records()[1]?.data, { provider: 'local', model: 'test-model', thinking: 'high', custom: { value: 2 } });
  assert.equal(session.meta.activeLeaf, session.records()[1]?.id);
  const db = new DatabaseSync(join(state, 'sessions.sqlite'));
  assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  db.close();
});

test('branches retain the whole tree, history uses the latest active compaction, fork copies ancestry atomically', t => {
  const { store, cwd } = fixture(t);
  const session = store.create(cwd);
  const root = session.append('message', { message: { role: 'user', content: 'root' } });
  session.append('compaction', { summary: 'old summary' });
  session.append('message', { message: { role: 'assistant', content: 'middle' } });
  session.append('compaction', { summary: 'latest summary' });
  const tip = session.append('message', { message: { role: 'user', content: 'latest' } });
  assert.deepEqual(session.history().map(message => message.content), ['latest summary', 'latest']);
  session.branch(root.id);
  const branch = session.append('message', { message: { role: 'assistant', content: 'alternative' } });
  assert.equal(branch.parentId, root.id);
  assert.equal(session.records().length, 6);
  assert.deepEqual(session.history().map(message => message.content), ['root', 'alternative']);
  const fork = store.fork(session.meta.id, tip.id);
  assert.equal(fork.meta.parentSession, session.meta.id);
  assert.notEqual(fork.meta.id, session.meta.id);
  assert.equal(fork.records().length, 5);
  assert.equal(fork.meta.activeLeaf, tip.id);
  assert.deepEqual(fork.history().map(message => message.content), ['latest summary', 'latest']);
  assert.equal(fork.append('message', { message: { role: 'user', content: 'fork only' } }).parentId, tip.id);
  assert.equal(session.records().length, 6);
  const count = store.list().length;
  assert.throws(() => store.fork(session.meta.id, 'missing'), /ancestry/);
  assert.equal(store.list().length, count);
  assert.throws(() => session.branch('missing'), /Unknown branch/);
  session.branch(null);
  assert.deepEqual(session.history(), []);
  assert.equal(session.records().length, 6);
  const empty = store.fork(session.meta.id);
  assert.deepEqual(empty.records(), []);
});

test('exclusive owners reject duplicate opens, including another process, and release on close', t => {
  const { store, cwd, state } = fixture(t);
  const session = store.create(cwd);
  const id = session.meta.id;
  const second = new SessionStore(state);
  t.after(() => second.close());
  assert.throws(() => store.open(id), /already open.*process/);
  assert.throws(() => second.open(id), /already open.*process/);
  assert.throws(() => second.delete(id), /already open/);
  assert.throws(() => second.fork(id), /already open/);
  const child = spawnSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', `
    import { SessionStore } from ${JSON.stringify(new URL('../src/sessions.js', import.meta.url).href)};
    const store = new SessionStore(${JSON.stringify(state)});
    try { store.open(${JSON.stringify(id)}); process.exitCode = 2; }
    catch (error) { if (!/already open.*process/.test(error.message)) throw error; }
    finally { store.close(); }
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 0, child.stderr);
  session.close();
  session.close();
  assert.throws(() => session.append('event', {}), /closed/);
  const reopened = second.open(id);
  reopened.append('event', { durable: true });
  reopened.close();
  assert.equal(store.open(id).records().length, 1);
});

test('FULL transactions roll back event/leaf updates and partial fork/import copies together', t => {
  const { store, cwd, state } = fixture(t);
  const connection = (store as unknown as { db: DatabaseSync }).db;
  assert.equal(connection.prepare('PRAGMA synchronous').get()?.synchronous, 2);
  const session = store.create(cwd);
  const id = session.meta.id;
  session.append('message', { message: { role: 'user', content: 'root', reasoning: undefined } });
  session.append('copy-fail', { content: 'second record' });
  const before = store.export(id);
  const db = new DatabaseSync(join(state, 'sessions.sqlite'));
  t.after(() => db.close());
  db.exec(`CREATE TRIGGER fail_leaf BEFORE UPDATE OF active_leaf ON sessions
    WHEN NEW.id = '${id}' BEGIN SELECT RAISE(ABORT, 'injected leaf failure'); END`);
  assert.throws(() => session.append('message', { message: { role: 'assistant', content: 'must roll back' } }), /injected leaf failure/);
  assert.equal(store.export(id), before);
  db.exec('DROP TRIGGER fail_leaf');
  db.exec(`CREATE TRIGGER fail_copy BEFORE INSERT ON records
    WHEN NEW.session_id <> '${id}' AND NEW.type = 'copy-fail'
    BEGIN SELECT RAISE(ABORT, 'injected copy failure'); END`);
  assert.throws(() => store.fork(id), /injected copy failure/);
  assert.throws(() => store.import(before), /injected copy failure/);
  assert.equal(store.list().length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM owners').get()?.count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM records').get()?.count, 2);
  assert.equal(store.export(id), before);
  db.exec('DROP TRIGGER fail_copy');
  assert.deepEqual(store.fork(id).records(), session.records());
});

test('SIGKILL discards a spilled partial WAL transaction, preserves committed events, and recovers dead ownership', async t => {
  const { store, cwd, state } = fixture(t);
  const session = store.create(cwd);
  const id = session.meta.id;
  session.close();
  const child = spawn(process.execPath, [...process.execArgv, '--input-type=module', '-e', `
    import { SessionStore } from ${JSON.stringify(new URL('../src/sessions.js', import.meta.url).href)};
    import { DatabaseSync } from 'node:sqlite';
    const store = new SessionStore(${JSON.stringify(state)});
    const session = store.open(${JSON.stringify(id)});
    session.append('message', { message: { role: 'user', content: 'committed before crash' } });
    const db = new DatabaseSync(${JSON.stringify(join(state, 'sessions.sqlite'))});
    db.exec('PRAGMA cache_size = 5; PRAGMA synchronous = FULL; BEGIN IMMEDIATE');
    db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run('not committed', ${JSON.stringify(id)});
    const insert = db.prepare('INSERT INTO records (session_id, id, parent_id, type, data, created_at) VALUES (?, ?, NULL, ?, ?, ?)');
    for (let i = 0; i < 200; i++) insert.run(${JSON.stringify(id)}, 'partial-' + i, 'partial', JSON.stringify({ text: 'x'.repeat(16000) }), new Date().toISOString());
    process.stdout.write('ready');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { child.kill('SIGKILL'); });
  const output: string[] = [];
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Crash child timed out: ${output.join('')}`)), 10_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Crash child exited ${code}: ${output.join('')}`)); });
    child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
  });
  assert.ok(lstatSync(join(state, 'sessions.sqlite-wal')).size > 100_000);
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const resumed = store.open(id);
  assert.equal(resumed.meta.name, 'workspace');
  assert.deepEqual(resumed.history(), [{ role: 'user', content: 'committed before crash' }]);
  assert.equal(resumed.records().length, 1);
  resumed.append('message', { message: { role: 'assistant', content: 'after recovery' } });
  const db = new DatabaseSync(join(state, 'sessions.sqlite'));
  assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  db.close();
});

test('versioned export/import retains record references and source ancestry without touching workspaces', async t => {
  const { store, cwd, root } = fixture(t);
  const session = store.create(cwd, 'Source');
  session.label('saved');
  session.append('message', { message: { role: 'user', content: 'history' } });
  const file = join(cwd, 'file.txt');
  writeFileSync(file, 'after');
  checkpoint(session, file, 'before', 'after');
  const snapshot = store.export(session.meta.id);
  const parsed = JSON.parse(snapshot) as { version: number; meta: { cwd: string }; records: unknown[] };
  assert.equal(parsed.version, 1);
  parsed.meta.cwd = join(root, 'must-not-be-created');
  const imported = store.import(JSON.stringify(parsed));
  assert.notEqual(imported.meta.id, session.meta.id);
  assert.equal(imported.meta.parentSession, session.meta.id);
  assert.deepEqual(imported.records(), session.records());
  assert.deepEqual(imported.history(), session.history());
  assert.equal(existsSync(parsed.meta.cwd), false);
  await assert.rejects(imported.undo(), /Imported checkpoint is disabled/);
  assert.equal(readFileSync(file, 'utf8'), 'after');
  const fork = store.fork(imported.meta.id);
  await assert.rejects(fork.undo(), /Imported checkpoint is disabled/);
  const twice = store.import(store.export(imported.meta.id));
  const exported = JSON.parse(store.export(twice.meta.id)) as { ancestry: string[] };
  assert.deepEqual(exported.ancestry, [imported.meta.id, session.meta.id]);
});

test('import validation is bounded, atomic, rejects malformed trees and strips executable configuration and secrets', t => {
  const { store, cwd } = fixture(t, redactor(['private-value']));
  const session = store.create(cwd);
  session.append('message', { message: { role: 'user', content: 'message' } });
  const original = store.export(session.meta.id);
  const count = store.list().length;
  const mutations: ((value: ExportFixture) => void)[] = [
    value => { value.version = 2; },
    value => { value.meta.activeLeaf = 'missing'; },
    value => { value.meta.createdAt = 'not a date'; },
    value => { value.records.push(value.records[0]!); },
    value => { value.records[0]!.parentId = value.records[0]!.id; },
    value => { (value.records[0]!.data.message as Record<string, unknown>).role = 'system'; },
    value => { (value.records[0]!.data.message as Record<string, unknown>).role = ['user']; },
    value => { (value.records[0]!.data.message as Record<string, unknown>).toolCalls = [{}]; },
    value => { (value.records[0]!.data.message as Record<string, unknown>).attachments = [{}]; },
    value => { value.records[0]!.data = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>; },
    value => { value.records[0]!.data = { nested: JSON.parse('['.repeat(45) + '0' + ']'.repeat(45)) as unknown }; },
    value => { (value.records[0]!.data.message as Record<string, unknown>).content = 'x'.repeat(4 * 1024 * 1024 + 1); },
    value => { value.records = Array<SessionRecord>(10_001).fill(value.records[0]!); },
    value => { value.config = { command: 'touch bad' }; },
    value => { value.meta.id = 'private-value'; },
  ];
  for (const modify of mutations) {
    const value = JSON.parse(original) as ExportFixture;
    modify(value);
    assert.throws(() => store.import(JSON.stringify(value)));
    assert.equal(store.list().length, count);
  }
  assert.throws(() => store.import('{'), /Invalid session JSON/);
  assert.throws(() => store.import(' '.repeat(32 * 1024 * 1024 + 1)), /too large/);
  const config = JSON.parse(original) as { records: { type: string; data: Record<string, unknown> }[] };
  config.records[0] = { ...config.records[0]!, type: 'configuration', data: { model: 'test', thinking: 'high', apiKey: 'unknown-secret', command: 'touch bad', servers: [{ command: 'touch bad' }], nested: { token: 'unknown', display: 'private-value' } } };
  const imported = store.import(JSON.stringify(config));
  assert.deepEqual(imported.records()[0]?.data, { model: 'test', thinking: 'high', nested: { display: '[REDACTED]' } });
});

test('append redacts all nested strings and metadata, and refuses secret-bearing checkpoints before persistence', t => {
  const secret = 'secret "quoted"\nvalue';
  const { store, cwd, state } = fixture(t, redactor([secret]));
  const session = store.create(cwd, secret);
  session.label(secret);
  session.rename(`name ${secret}`);
  session.append('custom', { [secret]: [secret, { content: secret }] });
  const file = join(cwd, 'secret.txt');
  writeFileSync(file, secret);
  assert.throws(() => checkpoint(session, file, null, secret), /contains secrets/);
  assert.equal(session.records().length, 1);
  assert.ok(!store.export(session.meta.id).includes('quoted'));
  assert.equal(session.records()[0]?.data['[REDACTED]'] instanceof Array, true);
  for (const name of readdirSync(state)) {
    if (lstatSync(join(state, name)).isFile()) assert.equal(readFileSync(join(state, name)).includes(Buffer.from(secret)), false);
  }
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => session.append('custom', circular), /too complex/);
  assert.throws(() => session.append('custom', { value: NaN }), /plain JSON/);
  assert.throws(() => session.append('undo', { checkpointId: 'fake' }), /reserved/);
});

test('imports reject non-latest checkpoint actions and cannot forge checkpoint write authority', async t => {
  const { store, cwd } = fixture(t);
  const session = store.create(cwd);
  const file = join(cwd, 'file');
  writeFileSync(file, 'two');
  const first = checkpoint(session, file, 'one', 'two');
  writeFileSync(file, 'three');
  checkpoint(session, file, 'two', 'three');
  const invalid = JSON.parse(store.export(session.meta.id)) as ExportFixture;
  invalid.records.push({ id: 'invalid-undo', parentId: invalid.meta.activeLeaf, type: 'undo', data: { checkpointId: first }, createdAt: new Date().toISOString() });
  invalid.meta.activeLeaf = 'invalid-undo';
  assert.throws(() => store.import(JSON.stringify(invalid)), /action history/);
  await session.undo();
  const valid = JSON.parse(store.export(session.meta.id)) as ExportFixture;
  for (const record of valid.records) {
    if (record.type === 'checkpoint') Object.assign(record.data, { trusted: true, imported: false, authority: { directory: cwd, mode: 0o777 } });
  }
  const imported = store.import(JSON.stringify(valid));
  await assert.rejects(imported.redo(), /Imported checkpoint is disabled/);
  await assert.rejects(imported.undo(), /Imported checkpoint is disabled/);
  assert.equal(readFileSync(file, 'utf8'), 'two');
  const source = new SessionStore('unused', { ephemeral: true });
  t.after(() => source.close());
  const secretSession = source.create(cwd);
  checkpoint(secretSession, file, 'unconfigured-private-value', 'two');
  const redactedStore = new SessionStore('unused', { ephemeral: true, redact: redactor(['unconfigured-private-value']) });
  t.after(() => redactedStore.close());
  const redacted = redactedStore.import(source.export(secretSession.meta.id));
  assert.equal(redacted.records()[0]?.data.before, '[REDACTED]');
  assert.equal(redacted.records()[0]?.data.beforeHash, hash('[REDACTED]'));
  await assert.rejects(redacted.undo(), /Imported checkpoint is disabled/);
});

test('fork cannot persist previously recorded values that are now configured as secrets', t => {
  const { store, cwd, state } = fixture(t);
  const session = store.create(cwd);
  const id = session.meta.id;
  session.append('message', { message: { role: 'user', content: 'newly-configured-secret' } });
  session.close();
  const protectedStore = new SessionStore(state, { redact: redactor(['newly-configured-secret']) });
  t.after(() => protectedStore.close());
  assert.throws(() => protectedStore.fork(id), /contains secrets/);
  assert.equal(protectedStore.list().length, 1);
  const sanitized = protectedStore.import(protectedStore.export(id));
  assert.deepEqual(protectedStore.fork(sanitized.meta.id).history(), [{ role: 'user', content: '[REDACTED]' }]);
});

test('undo/redo is durable, latest-first, branch-aware, hash-safe, and preserves executable mode', async t => {
  const { store, cwd, state } = fixture(t);
  const session = store.create(cwd);
  const id = session.meta.id;
  const file = join(cwd, 'script.sh');
  writeFileSync(file, 'two', { mode: 0o751 });
  const first = checkpoint(session, file, 'one', 'two');
  writeFileSync(file, 'three');
  const second = checkpoint(session, file, 'two', 'three');
  session.append('message', { message: { role: 'assistant', content: 'changed file' } });
  assert.equal(await session.undo(), file);
  assert.equal(readFileSync(file, 'utf8'), 'two');
  assert.equal(lstatSync(file).mode & 0o777, 0o751);
  const action = session.records().at(-1)!;
  assert.equal(action.type, 'undo');
  assert.equal(action.data.checkpointId, second);
  store.close();
  const resumedStore = new SessionStore(state);
  t.after(() => resumedStore.close());
  const resumed = resumedStore.open(id);
  await resumed.redo();
  assert.equal(readFileSync(file, 'utf8'), 'three');
  await resumed.undo();
  await resumed.undo();
  assert.equal(readFileSync(file, 'utf8'), 'one');
  assert.equal(resumed.records().at(-1)?.data.checkpointId, first);
  await assert.rejects(resumed.undo(), /Nothing to undo/);
  await resumed.redo();
  await resumed.redo();
  await assert.rejects(resumed.redo(), /Nothing to redo/);
  writeFileSync(file, 'external');
  const length = resumed.records().length;
  await assert.rejects(resumed.undo(), /external edits/);
  assert.equal(readFileSync(file, 'utf8'), 'external');
  assert.equal(resumed.records().length, length);
  writeFileSync(file, 'three');
  await resumed.undo();
  writeFileSync(file, 'new branch');
  checkpoint(resumed, file, 'two', 'new branch');
  await assert.rejects(resumed.redo(), /Nothing to redo/);
  resumed.branch(first);
  await assert.rejects(resumed.undo(), /external edits/);
});

test('creation/deletion checkpoints restore absence and modes; redo refuses external changes', async t => {
  const { store, cwd } = fixture(t);
  const session = store.create(cwd);
  const file = join(cwd, 'created');
  writeFileSync(file, 'created', { mode: 0o740 });
  checkpoint(session, file, null, 'created');
  await session.undo();
  assert.equal(existsSync(file), false);
  writeFileSync(file, 'external');
  await assert.rejects(session.redo(), /external edits/);
  unlinkSync(file);
  await session.redo();
  assert.equal(readFileSync(file, 'utf8'), 'created');
  assert.equal(lstatSync(file).mode & 0o777, 0o740);
  // A tool may journal before deletion, allowing the original mode to be captured.
  checkpoint(session, file, 'created', null);
  unlinkSync(file);
  await session.undo();
  assert.equal(readFileSync(file, 'utf8'), 'created');
  assert.equal(lstatSync(file).mode & 0o777, 0o740);
  chmodSync(file, 0o750);
  await session.redo();
  assert.equal(existsSync(file), false);
  await session.undo();
  assert.equal(lstatSync(file).mode & 0o777, 0o750);
});

test('checkpoint restore refuses symlink targets, replaced directories, and invalid hashes', async t => {
  const { store, cwd, root } = fixture(t);
  const session = store.create(cwd);
  const directory = join(cwd, 'sub');
  mkdirSync(directory);
  const file = join(directory, 'file');
  writeFileSync(file, 'after');
  checkpoint(session, file, 'before', 'after');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'file'), 'after');
  unlinkSync(file);
  symlinkSync(join(outside, 'file'), file);
  await assert.rejects(session.undo(), /conflict/);
  assert.equal(readFileSync(join(outside, 'file'), 'utf8'), 'after');
  unlinkSync(file);
  writeFileSync(file, 'after');
  renameSync(directory, `${directory}-original`);
  symlinkSync(outside, directory);
  await assert.rejects(session.undo(), /directory path changed/);
  unlinkSync(directory);
  mkdirSync(directory);
  writeFileSync(file, 'after');
  await assert.rejects(session.undo(), /directory identity changed/);
  assert.equal(readFileSync(file, 'utf8'), 'after');
  assert.throws(() => session.append('checkpoint', { path: file, before: 'before', after: 'after', beforeHash: 'invalid', afterHash: hash('after') }), /hash/);
});

test('checkpoints record canonical paths and never follow subsequently changed aliases or hard links', async t => {
  const { store, cwd, root } = fixture(t);
  const session = store.create(cwd);
  const directory = join(cwd, 'real');
  const alias = join(cwd, 'alias');
  const outside = join(root, 'outside');
  mkdirSync(directory);
  mkdirSync(outside);
  symlinkSync(directory, alias);
  const file = join(directory, 'file');
  writeFileSync(file, 'after');
  writeFileSync(join(outside, 'file'), 'after');
  checkpoint(session, join(alias, 'file'), 'before', 'after');
  assert.equal(session.records()[0]?.data.path, file);
  unlinkSync(alias);
  symlinkSync(outside, alias);
  await session.undo();
  assert.equal(readFileSync(file, 'utf8'), 'before');
  assert.equal(readFileSync(join(outside, 'file'), 'utf8'), 'after');
  linkSync(file, join(outside, 'hard-link'));
  await assert.rejects(session.redo(), /non-linked regular file/);
  assert.throws(() => checkpoint(session, file, 'before', 'after'), /non-linked file/);
});

test('checkpoint intent recovery finalizes applied actions and discards unapplied ones without file writes', async t => {
  const { store, cwd, state } = fixture(t);
  const session = store.create(cwd);
  const id = session.meta.id;
  const file = join(cwd, 'file');
  writeFileSync(file, 'after');
  const checkpointId = checkpoint(session, file, 'before', 'after');
  session.close();
  const db = new DatabaseSync(join(state, 'sessions.sqlite'));
  const pending = { record: { id: 'interrupted-undo', parentId: checkpointId, type: 'undo', data: { checkpointId }, createdAt: new Date().toISOString() } };
  db.prepare('INSERT INTO pending_actions (session_id, data) VALUES (?, ?)').run(id, JSON.stringify(pending));
  const unapplied = store.open(id);
  assert.equal(unapplied.records().length, 1);
  assert.equal(readFileSync(file, 'utf8'), 'after');
  unapplied.close();
  db.prepare('INSERT INTO pending_actions (session_id, data) VALUES (?, ?)').run(id, JSON.stringify(pending));
  writeFileSync(file, 'before');
  const applied = store.open(id);
  assert.equal(applied.records().at(-1)?.id, 'interrupted-undo');
  assert.equal(readFileSync(file, 'utf8'), 'before');
  await applied.redo();
  assert.equal(readFileSync(file, 'utf8'), 'after');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get()?.count, 0);
  pending.record.parentId = applied.meta.activeLeaf!;
  pending.record.id = 'conflicted-undo';
  applied.close();
  db.prepare('INSERT INTO pending_actions (session_id, data) VALUES (?, ?)').run(id, JSON.stringify(pending));
  writeFileSync(file, 'external');
  assert.throws(() => store.open(id), /recovery conflict/);
  assert.equal(readFileSync(file, 'utf8'), 'external');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get()?.count, 1);
  writeFileSync(file, 'after');
  assert.equal(store.open(id).records().at(-1)?.type, 'redo');
  db.close();
});

test('prepared writes are durable before publication, block intervening mutations, and can settle an abort', async t => {
  const { store, cwd, state } = fixture(t);
  const session = store.create(cwd);
  const id = session.meta.id;
  const root = session.append('message', { message: { role: 'user', content: 'earlier history' } });
  const file = join(cwd, 'file');
  writeFileSync(file, 'before');
  assert.equal(typeof session.prepareCheckpoint, 'function');
  const change = checkpointChange(file, 'before', 'after');
  const settle = session.prepareCheckpoint!(change);
  const db = new DatabaseSync(join(state, 'sessions.sqlite'));
  t.after(() => db.close());
  const pending = JSON.parse(String(db.prepare('SELECT data FROM pending_actions WHERE session_id = ?').get(id)?.data)) as PendingWriteFixture;
  assert.equal(pending.kind, 'write');
  assert.equal(pending.record.type, 'checkpoint');
  assert.deepEqual(pending.record.data, change);
  assert.equal(pending.record.parentId, root.id);
  assert.equal(pending.authority.directory, cwd);
  assert.equal(readFileSync(file, 'utf8'), 'before');
  assert.equal(session.meta.activeLeaf, root.id);
  assert.equal(session.records().length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM checkpoints').get()?.count, 0);
  assert.throws(() => session.append('message', { message: { role: 'assistant', content: 'intervening' } }), /write is pending/);
  assert.throws(() => session.branch(null), /write is pending/);
  assert.throws(() => session.rename('intervening'), /write is pending/);
  assert.throws(() => store.fork(id), /write is pending/);
  assert.throws(() => session.prepareCheckpoint!(change), /write is pending/);
  await assert.rejects(session.undo(), /write is pending/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get()?.count, 1);
  // Publication was aborted. Explicit cleanup discards the intent, not history.
  settle();
  settle();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get()?.count, 0);
  assert.deepEqual(session.records(), [root]);
  const finalize = session.prepareCheckpoint!(change);
  settle(); // A settled callback cannot accidentally settle a subsequent intent.
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get()?.count, 1);
  await atomicWrite(file, 'after');
  finalize();
  finalize();
  assert.equal(session.records().length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get()?.count, 0);
  await session.undo();
  assert.equal(readFileSync(file, 'utf8'), 'before');
});

test('preparation rejects secret, oversized, invalid-hash and invalid-UTF-8 snapshots before modification', async t => {
  const secret = 'secret "quoted"\noriginal-write';
  const { store, cwd, state } = fixture(t, redactor([secret]));
  const session = store.create(cwd);
  const file = join(cwd, 'file');
  writeFileSync(file, 'before');
  const publish = async (change: Checkpoint): Promise<void> => {
    const finalize = session.prepareCheckpoint!(change);
    await atomicWrite(file, change.after!);
    finalize();
  };
  await assert.rejects(publish(checkpointChange(file, 'before', secret)), /contains secrets/);
  await assert.rejects(publish(checkpointChange(file, secret, 'after')), /contains secrets/);
  // Both raw strings fit, but the complete serialized record does not.
  await assert.rejects(publish(checkpointChange(file, 'before', 'x'.repeat(4 * 1024 * 1024))), /too large/);
  await assert.rejects(publish(checkpointChange(file, 'before', '\n'.repeat(2 * 1024 * 1024))), /too large/);
  await assert.rejects(publish({ ...checkpointChange(file, 'before', 'after'), beforeHash: 'invalid' }), /hash/);
  await assert.rejects(publish(checkpointChange(file, 'not current', 'after')), /changed before preparation/);
  await assert.rejects(publish(checkpointChange(file, 'before', '\ud800')), /valid UTF-8/);
  await assert.rejects(publish(checkpointChange(file, 'before', 'before')), /must describe a change/);
  assert.equal(readFileSync(file, 'utf8'), 'before');
  assert.deepEqual(session.records(), []);
  const db = new DatabaseSync(join(state, 'sessions.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get()?.count, 0);
  db.close();
  for (const name of readdirSync(state)) {
    if (lstatSync(join(state, name)).isFile()) assert.equal(readFileSync(join(state, name)).includes(Buffer.from('original-write')), false);
  }
});

test('finalization uses the prevalidated snapshot, not mutable caller data or a later redactor', async t => {
  let rejectRedaction = false;
  const { store, cwd } = fixture(t, value => {
    if (rejectRedaction) throw new Error('redaction must not run after publication');
    return value;
  });
  const session = store.create(cwd);
  const file = join(cwd, 'executable');
  writeFileSync(file, 'before', { mode: 0o751 });
  const change = checkpointChange(file, 'before', 'after');
  const finalize = session.prepareCheckpoint!(change);
  change.after = 'unrelated';
  change.path = join(cwd, 'wrong-path');
  rejectRedaction = true;
  await atomicWrite(file, 'after', 0o751);
  finalize();
  assert.deepEqual(session.records()[0]?.data, checkpointChange(file, 'before', 'after'));
  await session.undo();
  assert.equal(readFileSync(file, 'utf8'), 'before');
  assert.equal(lstatSync(file).mode & 0o777, 0o751);
  await session.redo();
  assert.equal(readFileSync(file, 'utf8'), 'after');
});

test('original write intents cover creation and deletion, including the original deletion mode', async t => {
  const { store, cwd } = fixture(t);
  const session = store.create(cwd);
  const file = join(cwd, 'created');
  const create = session.prepareCheckpoint!(checkpointChange(file, null, 'created'));
  await atomicWrite(file, 'created', 0o750);
  create();
  await session.undo();
  assert.equal(existsSync(file), false);
  await session.redo();
  assert.equal(lstatSync(file).mode & 0o777, 0o750);
  const remove = session.prepareCheckpoint!(checkpointChange(file, 'created', null));
  unlinkSync(file);
  remove(); // Settlement also syncs the parent directory before its SQLite commit.
  await session.undo();
  assert.equal(readFileSync(file, 'utf8'), 'created');
  assert.equal(lstatSync(file).mode & 0o777, 0o750);
});

test('injected write-intent and finalization failures are atomic and preserve a recoverable intent', async t => {
  const { store, cwd, state } = fixture(t);
  const session = store.create(cwd);
  const id = session.meta.id;
  const root = session.append('message', { message: { role: 'user', content: 'keep this' } });
  const file = join(cwd, 'file');
  writeFileSync(file, 'before');
  const db = new DatabaseSync(join(state, 'sessions.sqlite'));
  t.after(() => db.close());
  db.exec("CREATE TRIGGER fail_intent BEFORE INSERT ON pending_actions BEGIN SELECT RAISE(ABORT, 'injected prepare failure'); END");
  assert.throws(() => session.prepareCheckpoint!(checkpointChange(file, 'before', 'after')), /injected prepare failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get()?.count, 0);
  assert.equal(readFileSync(file, 'utf8'), 'before');
  assert.deepEqual(session.records(), [root]);
  db.exec('DROP TRIGGER fail_intent');
  const finalize = session.prepareCheckpoint!(checkpointChange(file, 'before', 'after'));
  const intent = String(db.prepare('SELECT data FROM pending_actions WHERE session_id = ?').get(id)?.data);
  await atomicWrite(file, 'after');
  db.exec("CREATE TRIGGER fail_finalize BEFORE DELETE ON pending_actions BEGIN SELECT RAISE(ABORT, 'injected finalize failure'); END");
  assert.throws(finalize, /injected finalize failure/);
  assert.deepEqual(session.records(), [root]);
  assert.equal(session.meta.activeLeaf, root.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM checkpoints').get()?.count, 0);
  assert.equal(db.prepare('SELECT data FROM pending_actions WHERE session_id = ?').get(id)?.data, intent);
  assert.equal(readFileSync(file, 'utf8'), 'after');
  session.close();
  assert.throws(() => store.open(id), /injected finalize failure/);
  assert.equal(db.prepare('SELECT data FROM pending_actions WHERE session_id = ?').get(id)?.data, intent);
  db.exec('DROP TRIGGER fail_finalize');
  const resumed = store.open(id);
  const pending = JSON.parse(intent) as PendingWriteFixture;
  assert.equal(resumed.records().at(-1)?.id, pending.record.id);
  assert.equal(resumed.records().at(-1)?.parentId, root.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get()?.count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM checkpoints').get()?.count, 1);
  await resumed.undo();
  assert.equal(readFileSync(file, 'utf8'), 'before');
  assert.throws(finalize, /closed/);
});

test('SIGKILL before and after original publication recovers exactly one checkpoint only for applied writes', async t => {
  const { store, cwd, state } = fixture(t);
  const db = new DatabaseSync(join(state, 'sessions.sqlite'));
  t.after(() => db.close());
  for (const stage of ['prepared', 'published', 'linked', 'synced', 'finalized']) {
    const session = store.create(cwd, stage);
    const id = session.meta.id;
    const root = session.append('message', { message: { role: 'user', content: `history ${stage}` } });
    const file = join(cwd, stage);
    const before = stage === 'linked' ? null : 'before';
    if (before !== null) writeFileSync(file, before, { mode: 0o751 });
    session.close();
    const child = spawnSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', `
      import { SessionStore } from ${JSON.stringify(new URL('../src/sessions.js', import.meta.url).href)};
      import { closeSync, fsyncSync, linkSync, openSync, renameSync, writeFileSync } from 'node:fs';
      const store = new SessionStore(${JSON.stringify(state)});
      const session = store.open(${JSON.stringify(id)});
      const finalize = session.prepareCheckpoint(${JSON.stringify(checkpointChange(file, before, 'after'))});
      const crash = () => process.kill(process.pid, 'SIGKILL');
      if (${JSON.stringify(stage)} === 'prepared') crash();
      const file = openSync(${JSON.stringify(`${file}.tmp`)}, 'wx', 0o751);
      writeFileSync(file, 'after'); fsyncSync(file); closeSync(file);
      if (${JSON.stringify(stage)} === 'linked') {
        linkSync(${JSON.stringify(`${file}.tmp`)}, ${JSON.stringify(file)});
        crash();
      }
      renameSync(${JSON.stringify(`${file}.tmp`)}, ${JSON.stringify(file)});
      if (${JSON.stringify(stage)} === 'published') crash();
      const directory = openSync(${JSON.stringify(cwd)}, 'r');
      fsyncSync(directory); closeSync(directory);
      if (${JSON.stringify(stage)} === 'synced') crash();
      finalize();
      crash();
    `], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.signal, 'SIGKILL', `${stage}: ${child.stderr}`);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions WHERE session_id = ?').get(id)?.count, stage === 'finalized' ? 0 : 1);
    const resumed = store.open(id);
    assert.deepEqual(resumed.history(), [{ role: 'user', content: `history ${stage}` }]);
    assert.deepEqual(resumed.records()[0], root);
    assert.equal(resumed.records().length, stage === 'prepared' ? 1 : 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions WHERE session_id = ?').get(id)?.count, 0);
    assert.equal(readFileSync(file, 'utf8'), stage === 'prepared' ? 'before' : 'after');
    if (stage !== 'prepared') {
      assert.equal(resumed.records()[1]?.type, 'checkpoint');
      assert.equal(resumed.meta.activeLeaf, resumed.records()[1]?.id);
      if (stage === 'linked') {
        await assert.rejects(resumed.undo(), /non-linked regular file/);
        unlinkSync(`${file}.tmp`);
      }
      await resumed.undo();
      if (before === null) assert.equal(existsSync(file), false);
      else {
        assert.equal(readFileSync(file, 'utf8'), before);
        assert.equal(lstatSync(file).mode & 0o777, 0o751);
      }
      await resumed.redo();
      assert.equal(readFileSync(file, 'utf8'), 'after');
      assert.equal(lstatSync(file).mode & 0o777, 0o751);
    }
    resumed.close();
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
});

test('malformed original-write intents are cleared with an error, never poisoning prior session history', t => {
  const { store, cwd, state } = fixture(t);
  const db = new DatabaseSync(join(state, 'sessions.sqlite'));
  t.after(() => db.close());
  const corruptions: (((pending: PendingWriteFixture) => void) | null)[] = [
    null,
    pending => { pending.kind = 'unknown'; },
    pending => { pending.record.data.afterHash = hash('wrong'); },
    pending => { pending.record.parentId = 'missing-parent'; },
    pending => { pending.authority.inode = 'not-an-inode'; },
    pending => { pending.authority.directory = 'relative/path'; },
  ];
  for (const corrupt of corruptions) {
    const session = store.create(cwd);
    const id = session.meta.id;
    session.append('message', { message: { role: 'user', content: 'keep history' } });
    const file = join(cwd, id);
    writeFileSync(file, 'before');
    session.prepareCheckpoint!(checkpointChange(file, 'before', 'after'));
    const snapshot = store.export(id);
    const pending = JSON.parse(String(db.prepare('SELECT data FROM pending_actions WHERE session_id = ?').get(id)?.data)) as PendingWriteFixture;
    corrupt?.(pending);
    session.close();
    db.prepare('UPDATE pending_actions SET data = ? WHERE session_id = ?').run(corrupt ? JSON.stringify(pending) : '{', id);
    assert.throws(() => store.open(id), /intent cleared, file and prior history left unchanged/);
    assert.equal(store.export(id), snapshot);
    assert.equal(readFileSync(file, 'utf8'), 'before');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pending_actions WHERE session_id = ?').get(id)?.count, 0);
    const reopened = store.open(id);
    reopened.append('message', { message: { role: 'assistant', content: 'still usable' } });
    assert.equal(reopened.history().length, 2);
    reopened.close();
  }
});

test('original-write recovery conflicts do not overwrite edits or follow replaced symlinks', t => {
  const { store, cwd, root } = fixture(t);
  const session = store.create(cwd);
  const id = session.meta.id;
  const history = session.append('message', { message: { role: 'user', content: 'history' } });
  const file = join(cwd, 'file');
  writeFileSync(file, 'before');
  session.prepareCheckpoint!(checkpointChange(file, 'before', 'after'));
  writeFileSync(file, 'external edit');
  session.close();
  assert.throws(() => store.open(id), /recovery conflict.*intent cleared/);
  assert.equal(readFileSync(file, 'utf8'), 'external edit');
  const reopened = store.open(id);
  assert.deepEqual(reopened.records(), [history]);
  const finalize = reopened.prepareCheckpoint!(checkpointChange(file, 'external edit', 'after'));
  const outside = join(root, 'outside');
  writeFileSync(outside, 'after');
  unlinkSync(file);
  symlinkSync(outside, file);
  assert.throws(finalize, /recovery conflict.*intent cleared/);
  assert.equal(lstatSync(file).isSymbolicLink(), true);
  assert.equal(readFileSync(outside, 'utf8'), 'after');
  assert.deepEqual(reopened.records(), [history]);
  unlinkSync(file);
  writeFileSync(file, 'before');
  const next = reopened.prepareCheckpoint!(checkpointChange(file, 'before', 'after'));
  assert.throws(finalize, /no longer pending/);
  assert.throws(() => reopened.branch(null), /write is pending/);
  next();
  reopened.append('message', { message: { role: 'assistant', content: 'history is intact' } });
});

test('delete removes only stored state and invalidates handles; ephemeral stores leave no state directory', t => {
  const { store, cwd, root } = fixture(t);
  const session = store.create(cwd);
  const id = session.meta.id;
  const file = join(cwd, 'retained');
  writeFileSync(file, 'after');
  checkpoint(session, file, 'before', 'after');
  const fork = store.fork(id);
  store.delete(id);
  assert.throws(() => store.open(id), /not found/);
  assert.throws(() => session.records(), /closed/);
  assert.equal(fork.records().length, 1);
  assert.equal(readFileSync(file, 'utf8'), 'after');
  assert.equal(store.list().length, 1);
  store.delete(fork.meta.id);
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.open(), /No sessions/);
  const state = join(root, 'ephemeral-state');
  const ephemeral = new SessionStore(state, { ephemeral: true });
  ephemeral.create(cwd).append('event', { data: true });
  assert.equal(ephemeral.list().length, 1);
  ephemeral.close();
  ephemeral.close();
  assert.equal(existsSync(state), false);
  assert.throws(() => ephemeral.list(), /closed/);
});
