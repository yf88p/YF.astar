import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getDashboard, parseDashboardQuery, QueryError, resolveDatabasePath } from './dashboard.mjs';
import { fixture, ms, NOW } from './test-fixture.mjs';

const get = (f, query = '', now = NOW) => getDashboard({ dbPath: f.path, params: new URLSearchParams(query), now });
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('30d uses UTC inclusive calendar days and message totals, with reasoning included in output', (t) => {
  const f = fixture(t);
  const data = get(f);
  assert.deepEqual(data.range, { key: '30d', start: '2026-08-11T00:00:00.000Z', end: '2026-09-10T00:00:00.000Z', bucket: 'day', timezone: 'UTC' });
  assert.equal(data.source.status, 'connected');
  assert.equal(data.source.lastUpdated, NOW.toISOString());
  assert.deepEqual(data.summary.tokens, { input: 232, output: 103, reasoning: 27, cacheRead: 60, cacheWrite: 15, total: 410 });
  assert.equal(data.summary.messages, 6);
  assert.equal(data.summary.sessions, 6);
  assert.equal(data.summary.activeDays, 10);
  closeTo(data.summary.cost, 0.85);
  closeTo(data.summary.cacheHitRate, 60 / (232 + 60 + 15));
  assert.equal(data.timeline.length, 30);
  assert.equal(data.timeline[0].date, '2026-08-11');
  assert.equal(data.timeline.at(-1).date, '2026-09-09');
  assert.equal(data.timeline[0].total, 175);
  assert.equal(data.timeline.at(-1).total, 40);
  assert.equal(data.timeline.reduce((sum, point) => sum + point.total, 0), 410);
  assert.equal(data.models.reduce((sum, model) => sum + model.tokens.total, 0), 410);
  assert.equal(data.sessions.reduce((sum, session) => sum + session.tokens.total, 0), 410);
  assert.ok(!JSON.stringify(data).includes('PRIVATE_'));
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM session_message').get().count, 0);
});

test('previous period is adjacent, equal in length, and uses the same filters', (t) => {
  const f = fixture(t);
  const data = get(f);
  assert.deepEqual(data.summary.previous.tokens, { input: 260, output: 65, reasoning: 20, cacheRead: 110, cacheWrite: 10, total: 445 });
  assert.equal(data.summary.previous.messages, 3);
  assert.equal(data.summary.previous.sessions, 3);
  assert.equal(data.summary.previous.activeDays, 4);
  closeTo(data.summary.previous.cost, 0.65);
  const filtered = get(f, 'project=p1&model=provider%2Fa');
  assert.equal(filtered.summary.tokens.total, 215);
  assert.equal(filtered.summary.previous.tokens.total, 385);
  assert.equal(filtered.summary.previous.sessions, 1);
  assert.equal(filtered.summary.previous.messages, 2);
});

test('multi-model sessions aggregate exactly once; model and project filters intersect', (t) => {
  const f = fixture(t);
  const data = get(f);
  const main = data.sessions.find((session) => session.id === 'main');
  assert.equal(main.messages, 3);
  assert.equal(main.tokens.total, 325);
  assert.equal(main.models.length, 2);
  assert.equal(data.models.find((model) => model.id === 'provider/a').sessions, 1);
  assert.equal(data.models.find((model) => model.id === 'other/b').sessions, 2);
  assert.equal(data.sessions.find((session) => session.id === 'unknown').parentId, 'main');
  const filtered = get(f, 'model=other%2Fb&project=p1');
  assert.equal(filtered.summary.tokens.total, 110);
  assert.equal(filtered.summary.sessions, 1);
  assert.equal(filtered.summary.activeDays, 1);
  assert.equal(filtered.sessions[0].messages, 1);
  assert.equal(filtered.sessions[0].models.length, 1);
  assert.equal(filtered.models.length, 1);
  assert.deepEqual(filtered.filters, data.filters);
  assert.equal(get(f, 'project=p1').summary.tokens.total, 330);
  assert.equal(get(f, 'project=p1').summary.sessions, 4);
  const noMatch = get(f, 'project=p3&model=other%2Fb');
  assert.equal(noMatch.summary.messages, 0);
  assert.equal(noMatch.sessions.length, 0);
  assert.equal(noMatch.timeline.length, 30);
  assert.deepEqual(noMatch.filters, data.filters);
});

test('global filters include old/zero/unknown models and inactive projects', (t) => {
  const f = fixture(t);
  const data = get(f, 'range=7d&project=p1');
  assert.deepEqual(data.filters.models.map((model) => model.id), ['archive/old', 'other/b', 'provider/a', 'unknown/unknown', 'zero/idle']);
  assert.equal(data.filters.projects.find((project) => project.id === 'p3').name, 'quiet');
  assert.equal(get(f, 'model=archive%2Fold').summary.messages, 0);
  const idle = get(f, 'model=zero%2Fidle');
  assert.equal(idle.models[0].tokens.total, 0);
  assert.equal(idle.models[0].messages, 1);
  assert.equal(idle.summary.sessions, 1);
  assert.equal(idle.summary.activeDays, 1);
  assert.equal(idle.summary.cacheHitRate, 0);
  assert.equal(idle.timeline.find((point) => point.date === '2026-09-03').models['zero/idle'], 0);
  assert.equal(get(f, 'model=unknown%2Funknown').summary.tokens.total, 5);
});

test('user-only and metadata-only sessions remain visible at zero, never under a model filter', (t) => {
  const f = fixture(t);
  const data = get(f);
  for (const id of ['user', 'empty']) {
    const session = data.sessions.find((item) => item.id === id);
    assert.equal(session.messages, 0);
    assert.equal(session.tokens.total, 0);
    assert.equal(session.cost, 0);
    assert.deepEqual(session.models, []);
  }
  assert.ok(get(f, 'model=provider%2Fa').sessions.every((session) => !['user', 'empty'].includes(session.id)));
  assert.ok(get(f, 'range=7d').sessions.some((session) => session.id === 'user'));
  const historicUserActivity = get(f, 'range=7d', '2026-08-18T12:00:00Z');
  assert.deepEqual(historicUserActivity.sessions.map((session) => session.id), ['user']);
  assert.equal(historicUserActivity.summary.tokens.total, 0);
});

test('7d, 90d, UTC midnight, non-UTC clock offsets, and leap days have exact boundaries', (t) => {
  const f = fixture(t);
  const seven = get(f, 'range=7d');
  assert.equal(seven.range.start, '2026-09-03T00:00:00.000Z');
  assert.equal(seven.summary.tokens.total, 155);
  assert.equal(seven.summary.previous.tokens.total, 80);
  assert.equal(seven.summary.sessions, 5);
  assert.equal(get(f, 'range=90d').range.start, '2026-06-12T00:00:00.000Z');
  const beforeMidnight = get(f, 'range=7d', '2026-09-09T23:59:59.999Z');
  const midnight = get(f, 'range=7d', '2026-09-10T00:00:00.000Z');
  assert.equal(beforeMidnight.range.end, '2026-09-10T00:00:00.000Z');
  assert.equal(midnight.range.end, '2026-09-11T00:00:00.000Z');
  assert.equal(midnight.summary.tokens.total, 1154);
  assert.deepEqual(get(f, 'range=7d', '2026-09-10T02:00:00+05:00').range, beforeMidnight.range);
  const leap = get(f, 'range=7d', '2024-03-01T05:00:00Z');
  assert.equal(leap.range.start, '2024-02-24T00:00:00.000Z');
  assert.ok(leap.timeline.some((point) => point.date === '2024-02-29'));
});

test('all starts at earliest assistant/session timestamp, is global, and switches to months over 120 days', (t) => {
  const f = fixture(t);
  const short = get(f, 'range=all&project=p1');
  assert.equal(short.range.start, '2026-06-01T00:00:00.000Z');
  assert.equal(short.range.bucket, 'day');
  assert.equal(short.summary.previous, null);
  f.session('old-empty', 'p2', '2026-01-15');
  const long = get(f, 'range=all');
  assert.equal(long.range.start, '2026-01-15T00:00:00.000Z');
  assert.equal(long.range.bucket, 'month');
  assert.equal(long.timeline.length, 9);
  assert.equal(long.timeline[0].date, '2026-01-01');
  assert.equal(long.timeline[0].total, 0);
  assert.equal(long.timeline.at(-1).date, '2026-09-01');
  assert.equal(long.timeline.reduce((sum, point) => sum + point.total, 0), long.summary.tokens.total);
  f.assistant('older-than-session', 'main', '2025-12-31', 'provider/a', 3);
  assert.equal(get(f, 'range=all').range.start, '2025-12-31T00:00:00.000Z');
});

test('120-day all range is daily; 121 days is monthly', (t) => {
  const f = fixture(t, { seed: false });
  f.project('p', 'Project');
  const end = ms('2026-09-10');
  f.session('s', 'p', end - 120 * 86400000);
  assert.equal(get(f, 'range=all').timeline.length, 120);
  assert.equal(get(f, 'range=all').range.bucket, 'day');
  f.db.prepare('UPDATE session SET time_created = ?').run(end - 121 * 86400000);
  assert.equal(get(f, 'range=all').range.bucket, 'month');
});

test('empty connected databases produce real empty stats and zero-filled timelines', (t) => {
  const f = fixture(t, { seed: false });
  const data = get(f);
  assert.equal(data.source.status, 'connected');
  assert.equal(data.summary.messages, 0);
  assert.equal(data.summary.cacheHitRate, 0);
  assert.deepEqual(data.filters, { models: [], projects: [] });
  assert.equal(data.timeline.length, 30);
  assert.ok(data.timeline.every((point) => point.total === 0 && point.cost === 0));
  const all = get(f, 'range=all');
  assert.equal(all.range.start, '2026-09-09T00:00:00.000Z');
  assert.equal(all.timeline.length, 1);
  assert.equal(all.summary.previous, null);
});

test('missing databases are not created and return structured empty data', (t) => {
  const f = fixture(t, { seed: false });
  const path = join(f.directory, 'absent', 'missing.db');
  const data = getDashboard({ dbPath: path, now: NOW });
  assert.equal(data.source.status, 'missing');
  assert.equal(data.source.path, path);
  assert.match(data.source.message, /OPENCODE_DB/);
  assert.equal(data.summary.tokens.total, 0);
  assert.deepEqual(data.timeline, []);
  assert.deepEqual(data.sessions, []);
  assert.deepEqual(data.models, []);
  assert.equal(existsSync(join(f.directory, 'absent')), false);
  assert.equal(getDashboard({ dbPath: path, now: NOW, params: new URLSearchParams('range=all') }).summary.previous, null);
});

test('database path expands home and resolves overrides without opening the default database', () => {
  assert.equal(resolveDatabasePath('~/test.db'), join(homedir(), 'test.db'));
  assert.equal(resolveDatabasePath('~'), homedir());
  assert.equal(resolveDatabasePath('relative.db'), resolve('relative.db'));
  assert.equal(resolveDatabasePath(''), join(homedir(), '.local/share/opencode/opencode.db'));
});

test('unsupported schema and corrupt files return actionable sanitized source errors', (t) => {
  const f = fixture(t, { seed: false });
  f.db.exec('ALTER TABLE message RENAME COLUMN data TO old_data');
  const missingColumn = get(f);
  assert.equal(missingColumn.source.status, 'error');
  assert.match(missingColumn.source.message, /message.*data.*OPENCODE_DB/);
  assert.deepEqual(missingColumn.timeline, []);
  f.db.exec('DROP TABLE message');
  assert.match(get(f).source.message, /missing table message/);
  const path = join(f.directory, 'corrupt.db');
  writeFileSync(path, 'PRIVATE_DATABASE_SENTINEL: not sqlite');
  const corrupt = getDashboard({ dbPath: path, now: NOW });
  assert.equal(corrupt.source.status, 'error');
  assert.match(corrupt.source.message, /valid.*SQLite/);
  assert.ok(!JSON.stringify(corrupt).includes('PRIVATE_DATABASE_SENTINEL'));
  assert.ok(!JSON.stringify(corrupt).includes('stack'));
  assert.equal(getDashboard({ dbPath: f.directory, now: NOW }).source.status, 'error');
});

test('malformed JSON/numeric types never leak content or produce negative, NaN, or infinite usage', (t) => {
  const f = fixture(t, { seed: false });
  f.project('p', 'Project');
  f.session('s', 'p', '2026-09-09');
  f.message('broken', 's', '2026-09-09', '{"role":"assistant", PRIVATE_BROKEN_SENTINEL');
  f.message('null', 's', '2026-09-09', 'null');
  f.message('scalar', 's', '2026-09-09', '"assistant"');
  f.message('system', 's', '2026-09-09', { role: 'system', cost: 100, tokens: { input: 1000 } });
  f.message('malformed', 's', '2026-09-09', {
    role: 'assistant', modelID: {}, providerID: 7, cost: '2',
    tokens: { input: -5, output: '30', reasoning: true, cache: { read: [9], write: {} } },
  });
  f.message('infinity', 's', '2026-09-09', '{"role":"assistant","modelID":"huge","providerID":"p","cost":1e999,"tokens":{"input":1e999,"output":-1,"reasoning":-2,"cache":{"read":"10","write":true}}}');
  f.message('bad-tokens', 's', '2026-09-09', { role: 'assistant', providerID: '', modelID: ' ', tokens: 'broken' });
  f.assistant('valid', 's', '2026-09-09', 'p/good', 2, 3, 1, 4, 5, 0.5);
  f.message('big-timestamp', 's', 9223372036854775807n, { role: 'assistant', modelID: 'invalid-date', providerID: 'p', tokens: { input: 100 } });
  const data = get(f);
  assert.equal(data.source.status, 'connected');
  assert.equal(data.summary.messages, 4);
  assert.deepEqual(data.summary.tokens, { input: 2, output: 3, reasoning: 1, cacheRead: 4, cacheWrite: 5, total: 14 });
  assert.equal(data.summary.cost, 0.5);
  assert.ok(data.filters.models.some((model) => model.id === 'unknown/unknown'));
  assert.ok(data.filters.models.some((model) => model.id === 'p/invalid-date'));
  assert.ok(!JSON.stringify(data).includes('PRIVATE_'));
});

test('large finite historical values cannot overflow serialized totals or cache ratios', (t) => {
  const f = fixture(t, { seed: false });
  f.project('p', 'Project');
  f.session('s', 'p', '2026-09-09');
  for (let index = 0; index < 3; index++) f.assistant(`large-${index}`, 's', '2026-09-09', 'p/large', 1e308, 1e308, 1e308, 1e308, 1e308, 1e308);
  const data = get(f);
  for (const value of Object.values(data.summary.tokens)) assert.ok(Number.isFinite(value) && value >= 0);
  assert.ok(Number.isFinite(data.summary.cost));
  closeTo(data.summary.cacheHitRate, 1 / 3);
  assert.ok(!JSON.stringify(data.summary.tokens).includes('null'));
});

test('each read is fresh and leaves the fixture database byte-for-byte unchanged', (t) => {
  const f = fixture(t);
  const hash = () => createHash('sha256').update(readFileSync(f.path)).digest('hex');
  const before = hash();
  const files = readdirSync(f.directory);
  chmodSync(f.path, 0o444);
  try {
    assert.equal(get(f).summary.tokens.total, 410);
    assert.equal(hash(), before);
    assert.deepEqual(readdirSync(f.directory), files);
  } finally {
    chmodSync(f.path, 0o644);
  }
  f.assistant('new-message', 'main', '2026-09-09', 'provider/a', 1);
  assert.equal(get(f).summary.tokens.total, 411);
});

test('read-only WAL snapshots see committed data without dirty reads or writes', (t) => {
  const f = fixture(t);
  f.db.exec('PRAGMA journal_mode = WAL; BEGIN IMMEDIATE');
  try {
    f.assistant('uncommitted', 'main', '2026-09-09', 'provider/a', 7);
    assert.equal(get(f).summary.tokens.total, 410);
    f.db.exec('COMMIT');
  } catch (error) {
    f.db.exec('ROLLBACK');
    throw error;
  }
  assert.equal(get(f).summary.tokens.total, 417);
  const before = createHash('sha256').update(readFileSync(`${f.path}-wal`)).digest('hex');
  get(f, 'range=all');
  assert.equal(createHash('sha256').update(readFileSync(`${f.path}-wal`)).digest('hex'), before);
});

test('message is the sole usage source even if duplicate session_message rows exist', (t) => {
  const f = fixture(t);
  f.db.exec("INSERT INTO session_message VALUES ('a-start', '{\"role\":\"assistant\",\"tokens\":{\"input\":999999}}')");
  assert.equal(get(f).summary.tokens.total, 410);
});

test('query validation rejects unsupported, duplicate, empty and unknown filters', (t) => {
  const f = fixture(t);
  for (const query of ['range=1d', 'range=', 'range=__proto__', 'range=7d&range=30d', 'model=provider%2Fa&model=other%2Fb', 'extra=x', 'model=', 'project=', 'model=missing', 'project=missing']) {
    assert.throws(() => get(f, query), QueryError, query);
  }
  assert.deepEqual(parseDashboardQuery(), { range: '30d', model: null, project: null });
});

test('a production-sized fixture reconciles message, session, model, and timeline totals', (t) => {
  const f = fixture(t, { seed: false });
  f.db.exec('BEGIN');
  f.project('p', 'Project');
  for (let index = 0; index < 274; index++) f.session(`s-${index}`, 'p', '2026-09-09');
  for (let index = 0; index < 4188; index++) f.assistant(`m-${index}`, `s-${index % 274}`, '2026-09-09', `provider/model-${index % 4}`, 1, 2, 1, 3, 4);
  f.db.exec('COMMIT');
  const data = get(f);
  assert.equal(data.summary.messages, 4188);
  assert.equal(data.summary.sessions, 274);
  assert.equal(data.summary.activeDays, 1);
  assert.equal(data.summary.tokens.total, 41880);
  assert.equal(data.summary.tokens.reasoning, 4188);
  assert.equal(data.summary.cacheHitRate, 3 / 8);
  assert.equal(data.models.reduce((sum, model) => sum + model.tokens.total, 0), 41880);
  assert.equal(data.sessions.reduce((sum, session) => sum + session.tokens.total, 0), 41880);
  assert.equal(data.timeline.reduce((sum, point) => sum + point.total, 0), 41880);
});
