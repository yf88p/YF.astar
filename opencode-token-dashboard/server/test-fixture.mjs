import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NOW = new Date('2026-09-09T12:34:56.000Z');
export const ms = (value) => Date.parse(value.includes('T') ? value : `${value}T00:00:00.000Z`);

export function fixture(t, { seed = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'opencode-dashboard-test-'));
  const path = join(directory, 'opencode.db');
  const db = new DatabaseSync(path);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT, name TEXT);
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, title TEXT,
      time_created INTEGER, time_updated INTEGER, total_tokens INTEGER DEFAULT 999999999
    );
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE session_message (id TEXT, data TEXT);
    CREATE TABLE part (id TEXT, message_id TEXT, data TEXT);
    INSERT INTO part VALUES ('duplicate-part', 'a-start', '{"tokens":{"input":99999999}}');
  `);
  const project = (id, name, worktree = `/work/${id}`) => db.prepare('INSERT INTO project VALUES (?, ?, ?)').run(id, worktree, name);
  const session = (id, projectId, created, updated = created, parentId = null) => db.prepare('INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, parentId, `/work/${projectId}`, `Session ${id}`, typeof created === 'string' ? ms(created) : created, typeof updated === 'string' ? ms(updated) : updated);
  const message = (id, sessionId, time, data) => db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)')
    .run(id, sessionId, typeof time === 'string' ? ms(time) : time, typeof time === 'string' ? ms(time) : time, typeof data === 'string' ? data : JSON.stringify(data));
  const assistant = (id, sessionId, time, model, input = 0, output = 0, reasoning = 0, read = 0, write = 0, cost = 0) => message(id, sessionId, time, {
    role: 'assistant', providerID: model?.split('/')[0], modelID: model?.split('/').slice(1).join('/'),
    tokens: { input, output, reasoning, cache: { read, write } }, cost,
    text: 'PRIVATE_PROMPT_SENTINEL', system: 'PRIVATE_SYSTEM_SENTINEL',
  });
  if (seed) {
    project('p1', 'Alpha');
    project('p2', 'Beta');
    project('p3', null, '/work/quiet');
    session('main', 'p1', '2026-07-01', '2026-09-09');
    session('beta', 'p2', '2026-09-01', '2026-09-02');
    session('zero', 'p1', '2026-09-03');
    session('user', 'p1', '2026-08-01', '2026-09-04');
    session('empty', 'p2', '2026-09-06');
    session('unknown', 'p1', '2026-09-05', '2026-09-05', 'main');
    session('outside', 'p3', '2026-06-01');
    session('previous', 'p2', '2026-07-20');
    assistant('a-start', 'main', '2026-08-11', 'provider/a', 100, 40, 10, 30, 5, 0.25);
    assistant('a-end', 'main', '2026-09-09T23:59:59.999Z', 'provider/a', 10, 20, 5, 10, 0, 0.1);
    assistant('b-main', 'main', '2026-09-08', 'other/b', 50, 30, 9, 20, 10, 0.2);
    assistant('a-previous', 'main', '2026-08-10T23:59:59.999Z', 'provider/a', 200, 50, 20, 100, 10, 0.5);
    assistant('a-previous-start', 'main', '2026-07-12', 'provider/a', 20, 5, 0, 0, 0, 0.05);
    assistant('a-too-old', 'main', '2026-07-11T23:59:59.999Z', 'provider/a', 999);
    assistant('a-tomorrow', 'main', '2026-09-10', 'provider/a', 999);
    assistant('b-beta', 'beta', '2026-09-02', 'other/b', 70, 10, 2, 0, 0, 0.3);
    assistant('zero', 'zero', '2026-09-03', 'zero/idle');
    assistant('unknown', 'unknown', '2026-09-05', undefined, 2, 3, 1);
    assistant('old-model', 'outside', '2026-06-01', 'archive/old');
    assistant('previous', 'previous', '2026-07-20', 'provider/a', 40, 10, 0, 10, 0, 0.1);
    message('user-current', 'user', '2026-09-04', { role: 'user', tokens: { input: 888888 }, cost: 12345, content: 'PRIVATE_USER_SENTINEL' });
    message('user-earlier', 'user', '2026-08-15', { role: 'user' });
  }
  return { db, path, directory, project, session, message, assistant };
}
