import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';

const DAY = 86_400_000;
const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const TOKEN_FIELDS = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total'];

export class QueryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueryError';
  }
}

class SchemaError extends Error {}

export function resolveDatabasePath(value = process.env.OPENCODE_DB) {
  const path = value || '~/.local/share/opencode/opencode.db';
  return resolve(path === '~' ? homedir() : path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path);
}

export function parseDashboardQuery(params = new URLSearchParams()) {
  for (const key of params.keys()) {
    if (!['range', 'model', 'project'].includes(key)) {
      throw new QueryError('Supported query parameters are range, model, and project.');
    }
    if (params.getAll(key).length !== 1) {
      throw new QueryError('Each query parameter may appear only once.');
    }
  }
  const range = params.get('range') ?? '30d';
  if (!Object.hasOwn(RANGE_DAYS, range) && range !== 'all') {
    throw new QueryError('Invalid range. Use 7d, 30d, 90d, or all.');
  }
  return { range, model: params.get('model'), project: params.get('project') };
}

function tokens() {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function stats() {
  return { tokens: tokens(), sessions: 0, messages: 0, activeDays: 0, cost: 0, cacheHitRate: 0 };
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

// Saturation keeps hostile historical values from overflowing JSON numbers.
function add(a, b) {
  return Math.min(Number.MAX_VALUE, a + b);
}

function addTokens(target, usage) {
  for (const key of TOKEN_FIELDS) target[key] = add(target[key], usage[key]);
}

function timestamp(value) {
  if (typeof value === 'bigint') value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15
    ? Math.trunc(value)
    : null;
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function modelInfo(row) {
  const name = text(row.model_name, 'unknown').trim();
  const provider = text(row.provider, 'unknown').trim();
  return { id: `${provider}/${name}`, name, provider };
}

function iso(value) {
  return new Date(value).toISOString();
}

function date(value) {
  return iso(value).slice(0, 10);
}

function readSource(path) {
  let db;
  try {
    if (!statSync(path).isFile()) throw new SchemaError('OPENCODE_DB must point to an OpenCode SQLite database file.');
    db = new DatabaseSync(path, { readOnly: true, timeout: 1000 });
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; BEGIN');

    const required = {
      session: ['id', 'project_id', 'parent_id', 'directory', 'title', 'time_created', 'time_updated'],
      project: ['id', 'worktree', 'name'],
      message: ['id', 'session_id', 'time_created', 'data'],
    };
    const tables = new Set(db.prepare("SELECT name FROM main.sqlite_schema WHERE type = 'table' AND name IN ('session', 'project', 'message')").all().map((row) => row.name));
    for (const [table, columns] of Object.entries(required)) {
      if (!tables.has(table)) {
        throw new SchemaError(`Unsupported OpenCode database schema: missing table ${table}. Check OPENCODE_DB and update OpenCode to a version using the session/project/message schema.`);
      }
      const actual = new Set(db.prepare(`PRAGMA main.table_info("${table}")`).all().map((row) => row.name));
      const missing = columns.filter((column) => !actual.has(column));
      if (missing.length) {
        throw new SchemaError(`Unsupported OpenCode database schema: ${table} is missing columns ${missing.join(', ')}. Check OPENCODE_DB and update OpenCode.`);
      }
    }

    const projects = db.prepare('SELECT id, name, worktree FROM main.project').all();
    const sessionStatement = db.prepare('SELECT id, project_id, parent_id, directory, title, time_created, time_updated FROM main.session');
    sessionStatement.setReadBigInts(true);
    const sessions = sessionStatement.all();

    // Never transfer raw message JSON (or prompt/part/auth data) into the server.
    // CASE protects JSON functions even if SQLite reorders predicate evaluation.
    const numeric = (path, alias) => `CASE WHEN json_type(data, '${path}') IN ('integer', 'real') THEN CAST(json_extract(data, '${path}') AS REAL) ELSE 0 END AS ${alias}`;
    const statement = db.prepare(`
      WITH valid AS (
        SELECT id, session_id, time_created,
          CASE WHEN json_valid(data) THEN data ELSE '{}' END AS data
        FROM main.message
      )
      SELECT id, session_id, time_created,
        CASE WHEN json_type(data, '$.modelID') = 'text' THEN json_extract(data, '$.modelID') END AS model_name,
        CASE WHEN json_type(data, '$.providerID') = 'text' THEN json_extract(data, '$.providerID') END AS provider,
        ${numeric('$.cost', 'cost')},
        ${numeric('$.tokens.input', 'input')},
        ${numeric('$.tokens.output', 'output')},
        ${numeric('$.tokens.reasoning', 'reasoning')},
        ${numeric('$.tokens.cache.read', 'cacheRead')},
        ${numeric('$.tokens.cache.write', 'cacheWrite')}
      FROM valid WHERE json_extract(data, '$.role') = 'assistant'
    `);
    statement.setReadBigInts(true);
    const messages = statement.all();
    const userStatement = db.prepare(`
      SELECT session_id, time_created FROM main.message
      WHERE CASE WHEN json_valid(data) THEN json_extract(data, '$.role') END = 'user'
    `);
    userStatement.setReadBigInts(true);
    const userActivity = userStatement.all();
    db.exec('COMMIT');
    return { status: 'connected', projects, sessions, messages, userActivity };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return { status: 'missing', message: 'OpenCode database not found. Run OpenCode to create it, or set OPENCODE_DB to an existing database. No file was created.' };
    }
    return {
      status: 'error',
      message: error instanceof SchemaError
        ? error.message
        : 'Unable to read the OpenCode database. Check OPENCODE_DB, file permissions, and that it is a valid, unlocked SQLite database. No changes were made.',
    };
  } finally {
    // Closing also rolls back a failed read transaction.
    db?.close();
  }
}

function makeRange(key, now, earliest) {
  const today = Math.floor(now / DAY) * DAY;
  const end = today + DAY;
  const start = key === 'all' ? Math.floor(Math.min(earliest ?? today, today) / DAY) * DAY : end - RANGE_DAYS[key] * DAY;
  return { key, start: iso(start), end: iso(end), bucket: key === 'all' && (end - start) / DAY > 120 ? 'month' : 'day', timezone: 'UTC' };
}

function bucketDate(time, bucket) {
  return bucket === 'month' ? `${date(time).slice(0, 7)}-01` : date(time);
}

function makeTimeline(range) {
  const end = Date.parse(range.end);
  const result = new Map();
  const cursor = new Date(range.start);
  if (range.bucket === 'month') cursor.setUTCDate(1);
  while (cursor.getTime() < end) {
    const key = date(cursor.getTime());
    result.set(key, { date: key, total: 0, cost: 0, models: Object.create(null) });
    if (range.bucket === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function modelStats(model) {
  return { ...model, tokens: tokens(), cost: 0, messages: 0 };
}

/**
 * A fresh, consistent, read-only snapshot. No cache: filter options and midnight
 * boundaries cannot go stale. `now` is injectable for deterministic UTC tests.
 */
export function getDashboard({ dbPath = resolveDatabasePath(), params = new URLSearchParams(), now = new Date() } = {}) {
  const query = parseDashboardQuery(params);
  const path = resolveDatabasePath(dbPath);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError('Invalid dashboard clock.');
  const source = readSource(path);
  let range = makeRange(query.range, nowMs, null);
  const result = {
    source: { path, status: source.status, ...(source.message ? { message: source.message } : {}), lastUpdated: iso(nowMs) },
    range,
    filters: { models: [], projects: [] },
    summary: { ...stats(), previous: query.range === 'all' ? null : stats() },
    timeline: [],
    models: [],
    sessions: [],
  };
  if (source.status !== 'connected') {
    if (source.status === 'missing' && (query.model !== null || query.project !== null)) {
      throw new QueryError('Unknown filter. No models or projects are available because the OpenCode database is missing. Clear the filters and check OPENCODE_DB.');
    }
    return result;
  }

  const projects = new Map();
  for (const row of source.projects) {
    const id = text(row.id);
    const directory = text(row.worktree);
    projects.set(id, { id, name: text(row.name, basename(directory) || id || 'Unknown project'), directory });
  }
  const sessions = new Map();
  let earliest = null;
  const rememberTime = (time) => {
    if (time !== null) earliest = earliest === null ? time : Math.min(time, earliest);
  };
  for (const row of source.sessions) {
    const created = timestamp(row.time_created);
    const updated = timestamp(row.time_updated);
    rememberTime(created);
    rememberTime(updated);
    const projectId = text(row.project_id, 'unknown');
    if (!projects.has(projectId)) {
      const directory = text(row.directory);
      projects.set(projectId, { id: projectId, name: basename(directory) || projectId, directory });
    }
    sessions.set(text(row.id), {
      id: text(row.id), title: text(row.title, 'Untitled session'), projectId,
      project: projects.get(projectId).name, directory: text(row.directory, projects.get(projectId).directory),
      parentId: text(row.parent_id) || null,
      createdAt: created === null ? '' : iso(created), updatedAt: updated === null ? '' : iso(updated),
      activity: [created, updated].filter((time) => time !== null),
    });
  }

  const availableModels = new Map();
  const messages = [];
  for (const row of source.messages) {
    const model = modelInfo(row);
    availableModels.set(model.id, model);
    const time = timestamp(row.time_created);
    rememberTime(time);
    const usage = tokens();
    for (const field of TOKEN_FIELDS) if (field !== 'total') usage[field] = number(row[field]);
    usage.total = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].reduce(add, 0);
    messages.push({ sessionId: text(row.session_id), time, model, tokens: usage, cost: number(row.cost) });
  }
  for (const row of source.userActivity) {
    const time = timestamp(row.time_created);
    if (time !== null) sessions.get(text(row.session_id))?.activity.push(time);
  }
  result.filters.models = [...availableModels.values()].sort((a, b) => a.id.localeCompare(b.id));
  result.filters.projects = [...projects.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (query.model !== null && !availableModels.has(query.model)) throw new QueryError('Unknown model filter. Choose an id from filters.models.');
  if (query.project !== null && !projects.has(query.project)) throw new QueryError('Unknown project filter. Choose an id from filters.projects.');

  range = makeRange(query.range, nowMs, earliest);
  result.range = range;
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  const previousStart = start - (end - start);
  const timeline = makeTimeline(range);
  const current = { stats: stats(), sessions: new Map(), days: new Set(), models: new Map() };
  const previous = { stats: stats(), sessions: new Map(), days: new Set(), models: new Map() };

  const ensureSession = (period, session) => {
    if (!period.sessions.has(session.id)) {
      const { activity, ...metadata } = session;
      period.sessions.set(session.id, { ...metadata, tokens: tokens(), cost: 0, messages: 0, models: new Map() });
    }
    return period.sessions.get(session.id);
  };
  const periodAt = (time) => time >= start && time < end ? current : query.range !== 'all' && time >= previousStart && time < start ? previous : null;

  // A model filter requires a matching assistant message in the interval. Never
  // attribute user-only or metadata-only activity to an unrelated model.
  if (query.model === null) {
    for (const session of sessions.values()) {
      if (query.project !== null && query.project !== session.projectId) continue;
      for (const time of session.activity) {
        const period = periodAt(time);
        if (period) {
          ensureSession(period, session);
          period.days.add(date(time));
        }
      }
    }
  }
  for (const message of messages) {
    const session = sessions.get(message.sessionId);
    if (query.model !== null && message.model.id !== query.model) continue;
    if (query.project !== null && session?.projectId !== query.project) continue;
    if (message.time === null) continue;
    const period = periodAt(message.time);
    if (!period) continue;
    period.days.add(date(message.time));
    addTokens(period.stats.tokens, message.tokens);
    period.stats.cost = add(period.stats.cost, message.cost);
    period.stats.messages++;
    if (!period.models.has(message.model.id)) period.models.set(message.model.id, { ...modelStats(message.model), sessions: new Set() });
    const model = period.models.get(message.model.id);
    addTokens(model.tokens, message.tokens);
    model.cost = add(model.cost, message.cost);
    model.messages++;
    if (session) {
      model.sessions.add(session.id);
      const sessionResult = ensureSession(period, session);
      addTokens(sessionResult.tokens, message.tokens);
      sessionResult.cost = add(sessionResult.cost, message.cost);
      sessionResult.messages++;
      if (!sessionResult.models.has(model.id)) sessionResult.models.set(model.id, modelStats(message.model));
      const sessionModel = sessionResult.models.get(model.id);
      addTokens(sessionModel.tokens, message.tokens);
      sessionModel.cost = add(sessionModel.cost, message.cost);
      sessionModel.messages++;
    }
    if (period === current) {
      const point = timeline.get(bucketDate(message.time, range.bucket));
      point.total = add(point.total, message.tokens.total);
      point.cost = add(point.cost, message.cost);
      point.models[model.id] = add(point.models[model.id] ?? 0, message.tokens.total);
    }
  }
  for (const period of [current, previous]) {
    period.stats.sessions = period.sessions.size;
    period.stats.activeDays = period.days.size;
    const usage = period.stats.tokens;
    // Scale before division to keep the denominator finite for extreme values.
    const scale = Math.max(usage.input, usage.cacheRead, usage.cacheWrite);
    period.stats.cacheHitRate = scale === 0 ? 0 : (usage.cacheRead / scale) / (usage.input / scale + usage.cacheRead / scale + usage.cacheWrite / scale);
  }
  const byUsage = (a, b) => b.tokens.total - a.tokens.total || a.id.localeCompare(b.id);
  result.summary = { ...current.stats, previous: query.range === 'all' ? null : previous.stats };
  result.timeline = [...timeline.values()];
  result.models = [...current.models.values()].map((model) => ({ ...model, sessions: model.sessions.size })).sort(byUsage);
  result.sessions = [...current.sessions.values()].map((session) => ({ ...session, models: [...session.models.values()].sort(byUsage) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return result;
}
