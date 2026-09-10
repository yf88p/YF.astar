import { randomUUID } from 'node:crypto';
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Checkpoint, Message, Session, SessionMeta, SessionRecord } from './types.js';
import { hash } from './util.js';

const MAX_DOCUMENT = 32 * 1024 * 1024;
const MAX_RECORD = 4 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const unsafeConfigKey = /^(?:api[-_]?key|authorization|password|secret|secrets|token|access[-_]?token|headers|env|command|commands|executable|extensions|servers|mcp|lsp)$/i;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function text(value: unknown, max = MAX_RECORD): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) <= max;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && identifier.test(value);
}

function validDate(value: unknown): value is string {
  return text(value, 32) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

// Walk values, not serialized JSON: a secret containing quotes or newlines must
// still be redacted, without allowing a redactor to corrupt JSON syntax.
function cleanJson(value: unknown, redact: (s: string) => string, importing = false): unknown {
  let nodes = 0;
  const walk = (item: unknown, depth: number): unknown => {
    requireValue(++nodes <= 200_000 && depth <= 40, 'Session data is too complex');
    if (typeof item === 'string') {
      requireValue(text(item), 'Session string is too large');
      const clean = redact(item);
      requireValue(text(clean), 'Redacted session string is too large');
      return clean;
    }
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(entry => walk(entry, depth + 1));
    requireValue(object(item) && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null), 'Session data must be plain JSON');
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, entry] of Object.entries(item)) {
      if (entry === undefined) continue;
      requireValue(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe session data key');
      // Imported configuration is inert and cannot carry credentials or launch instructions.
      if (importing && unsafeConfigKey.test(key)) continue;
      const cleanKey = redact(key);
      requireValue(text(cleanKey, 1024) && !['__proto__', 'prototype', 'constructor'].includes(cleanKey), 'Invalid session data key');
      requireValue(!Object.hasOwn(result, cleanKey), 'Redaction produced duplicate keys');
      result[cleanKey] = walk(entry, depth + 1);
    }
    return result;
  };
  return walk(value, 0);
}

function validateData(type: string, data: Record<string, unknown>): void {
  if (type === 'message') {
    const message = data.message;
    requireValue(object(message) && typeof message.role === 'string' && ['user', 'assistant', 'tool'].includes(message.role) && text(message.content), 'Invalid session message');
    for (const field of ['reasoning', 'reasoningSignature', 'toolCallId', 'toolName']) {
      requireValue(message[field] === undefined || text(message[field]), `Invalid message ${field}`);
    }
    requireValue(message.isError === undefined || typeof message.isError === 'boolean', 'Invalid message isError');
    if (message.toolCalls !== undefined) {
      requireValue(Array.isArray(message.toolCalls) && message.toolCalls.every(call => object(call) && text(call.id, 1024) && text(call.name, 1024) && text(call.arguments)), 'Invalid message tool calls');
    }
    if (message.attachments !== undefined) {
      requireValue(Array.isArray(message.attachments) && message.attachments.every(attachment => object(attachment) && text(attachment.path) && text(attachment.mediaType, 1024) && text(attachment.data) && typeof attachment.kind === 'string' && ['text', 'image'].includes(attachment.kind)), 'Invalid message attachments');
    }
  } else if (type === 'compaction') {
    requireValue(text(data.summary), 'Invalid compaction summary');
  } else if (type === 'checkpoint') {
    requireValue(text(data.path, 16_384) && data.path.length > 0 && !data.path.includes('\0'), 'Invalid checkpoint path');
    for (const field of ['before', 'after'] as const) {
      const content = data[field];
      requireValue(content === null || text(content), `Invalid checkpoint ${field}`);
      requireValue(data[`${field}Hash`] === (content === null ? null : hash(content)), `Invalid checkpoint ${field} hash`);
    }
  } else if (type === 'undo' || type === 'redo') {
    requireValue(validId(data.checkpointId), 'Invalid checkpoint action');
  }
}

function ancestry(records: SessionRecord[], leaf: string | null): SessionRecord[] {
  const byId = new Map(records.map(record => [record.id, record]));
  const result: SessionRecord[] = [];
  const visited = new Set<string>();
  while (leaf !== null) {
    const record = byId.get(leaf);
    requireValue(record && !visited.has(leaf), 'Invalid session ancestry');
    visited.add(leaf);
    result.push(record);
    leaf = record.parentId;
  }
  return result.reverse();
}

interface CheckpointAuthority { directory: string; device: string; inode: string; mode: number }
interface PendingAction { record: SessionRecord }
interface PendingWrite { kind: 'write'; record: SessionRecord; authority: CheckpointAuthority }
interface CheckpointStack { record: SessionRecord; previous?: CheckpointStack }

function checkpointStates(records: SessionRecord[]): Map<string, { applied?: CheckpointStack; undone?: CheckpointStack }> {
  const states = new Map<string, { applied?: CheckpointStack; undone?: CheckpointStack }>();
  for (const record of records) {
    const state = (record.parentId === null ? undefined : states.get(record.parentId)) ?? {};
    if (record.type === 'checkpoint') states.set(record.id, { applied: { record, previous: state.applied } });
    else if (record.type === 'undo' || record.type === 'redo') {
      const from = record.type === 'undo' ? 'applied' : 'undone';
      const to = record.type === 'undo' ? 'undone' : 'applied';
      const target = state[from];
      requireValue(target && target.record.id === record.data.checkpointId, 'Invalid checkpoint action history');
      states.set(record.id, { [from]: target.previous, [to]: { record: target.record, previous: state[to] } });
    } else states.set(record.id, state);
  }
  return states;
}

export class SessionStore {
  private readonly db: DatabaseSync;
  private readonly redact: (s: string) => string;
  private readonly owners = new Map<string, string>();
  private closed = false;

  constructor(stateDir: string, { ephemeral = false, redact = (s: string) => s }: { ephemeral?: boolean; redact?: (s: string) => string } = {}) {
    this.redact = redact;
    let database = ':memory:';
    if (!ephemeral) {
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      database = join(resolve(stateDir), 'sessions.sqlite');
      const file = openSync(database, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      try { fchmodSync(file, 0o600); } finally { closeSync(file); }
    }
    this.db = new DatabaseSync(database, { timeout: 5000, allowExtension: false });
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;');
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      requireValue(version === 0 || version === 1, 'Unsupported session database version');
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, cwd TEXT NOT NULL, name TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            parent_session TEXT, active_leaf TEXT, labels TEXT NOT NULL, ancestry TEXT NOT NULL
          ) STRICT;
          CREATE TABLE IF NOT EXISTS records (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
            id TEXT NOT NULL, parent_id TEXT, type TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL,
            UNIQUE (session_id, id),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id, parent_id) REFERENCES records(session_id, id) DEFERRABLE INITIALLY DEFERRED
          ) STRICT;
          CREATE TABLE IF NOT EXISTS owners (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            pid INTEGER NOT NULL, token TEXT NOT NULL
          ) STRICT;
          CREATE TABLE IF NOT EXISTS checkpoints (
            session_id TEXT NOT NULL, record_id TEXT NOT NULL, authority TEXT NOT NULL,
            PRIMARY KEY (session_id, record_id),
            FOREIGN KEY (session_id, record_id) REFERENCES records(session_id, id) ON DELETE CASCADE
          ) STRICT;
          CREATE TABLE IF NOT EXISTS pending_actions (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, data TEXT NOT NULL
          ) STRICT;
          PRAGMA user_version = 1;
        `);
      });
      if (!ephemeral) {
        const directory = openSync(resolve(stateDir), constants.O_RDONLY | constants.O_DIRECTORY);
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  create(cwd: string, name?: string): Session {
    this.assertOpen();
    requireValue(text(cwd, 16_384) && cwd.length > 0 && !cwd.includes('\0'), 'Invalid session workspace');
    requireValue(name === undefined || text(name, 1024), 'Invalid session name');
    const time = this.now();
    const meta: SessionMeta = {
      id: randomUUID(), cwd: this.redact(resolve(cwd)), name: this.redact(name ?? basename(resolve(cwd))),
      createdAt: time, updatedAt: time, activeLeaf: null, labels: [],
    };
    const token = this.transaction(() => this.insertSession(meta, []));
    return this.attach(meta.id, token);
  }

  open(id?: string): Session {
    this.assertOpen();
    const selected = id ?? this.list()[0]?.id;
    requireValue(selected !== undefined, 'No sessions found');
    const token = this.transaction(() => {
      this.metadata(selected);
      return this.acquire(selected);
    });
    const session = this.attach(selected, token);
    try { this.recover(selected, 'resume'); } catch (error) { session.close(); throw error; }
    return session;
  }

  list(search?: string): SessionMeta[] {
    this.assertOpen();
    requireValue(search === undefined || text(search, 4096), 'Invalid session search');
    const needle = (search ?? '').toLocaleLowerCase();
    return this.transaction(() => this.db.prepare('SELECT id FROM sessions ORDER BY updated_at DESC, rowid DESC').all()
      .map(row => this.metadata(String(row.id)))
      .filter(meta => [meta.id, meta.name, meta.cwd, ...meta.labels].some(value => value.toLocaleLowerCase().includes(needle))));
  }

  fork(id: string, leaf?: string): Session {
    this.assertOpen();
    const temporary = this.owners.has(id) ? undefined : this.open(id);
    try {
      this.recover(id);
      const source = this.metadata(id);
      const selected = leaf === undefined ? source.activeLeaf : leaf;
      const records = ancestry(this.readRecords(id), selected);
      const sources = [id, ...this.sourceAncestry(id)];
      const snapshot = { source, records, sources };
      requireValue(JSON.stringify(cleanJson(snapshot, this.redact)) === JSON.stringify(snapshot), 'Source session contains secrets; refusing to fork unredacted history');
      const time = this.now();
      const meta: SessionMeta = { ...source, id: randomUUID(), parentSession: id, activeLeaf: selected, createdAt: time, updatedAt: time, labels: [...source.labels] };
      const token = this.transaction(() => {
        const owner = this.insertSession(meta, sources);
        for (const record of records) {
          this.insertRecord(meta.id, record);
          this.db.prepare('INSERT INTO checkpoints SELECT ?, record_id, authority FROM checkpoints WHERE session_id = ? AND record_id = ?').run(meta.id, id, record.id);
        }
        return owner;
      });
      return this.attach(meta.id, token);
    } finally { temporary?.close(); }
  }

  delete(id: string): void {
    this.assertOpen();
    this.transaction(() => {
      this.metadata(id);
      if (!this.owners.has(id)) this.acquire(id);
      else this.assertOwned(id, this.owners.get(id)!);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    });
    this.owners.delete(id);
  }

  export(id: string): string {
    this.assertOpen();
    const result = this.transaction(() => JSON.stringify({
      version: 1, meta: this.metadata(id), ancestry: this.sourceAncestry(id), records: this.readRecords(id),
    }, null, 2));
    requireValue(Buffer.byteLength(result) <= MAX_DOCUMENT, 'Session export is too large');
    return result;
  }

  import(json: string): Session {
    this.assertOpen();
    requireValue(text(json, MAX_DOCUMENT), 'Session import is too large');
    let input: unknown;
    try { input = JSON.parse(json) as unknown; } catch { throw new Error('Invalid session JSON'); }
    requireValue(object(input) && input.version === 1, 'Unsupported session export version');
    requireValue(Object.keys(input).every(key => ['version', 'meta', 'records', 'ancestry'].includes(key)), 'Invalid session export fields');
    const source = input.meta;
    requireValue(object(source) && validId(source.id) && text(source.cwd, 16_384) && source.cwd.length > 0 && !source.cwd.includes('\0') && text(source.name, 1024), 'Invalid session metadata');
    requireValue(Object.keys(source).every(key => ['id', 'cwd', 'name', 'createdAt', 'updatedAt', 'parentSession', 'activeLeaf', 'labels'].includes(key)), 'Invalid session metadata fields');
    requireValue(validDate(source.createdAt) && validDate(source.updatedAt), 'Invalid session dates');
    requireValue(source.parentSession === undefined || validId(source.parentSession), 'Invalid parent session');
    requireValue(source.activeLeaf === null || validId(source.activeLeaf), 'Invalid active leaf');
    requireValue(Array.isArray(source.labels) && source.labels.length <= 1000 && source.labels.every(label => text(label, 1024)), 'Invalid session labels');
    requireValue(input.ancestry === undefined || (Array.isArray(input.ancestry) && input.ancestry.length <= 1000 && input.ancestry.every(validId)), 'Invalid source ancestry');
    requireValue(input.ancestry === undefined || (input.ancestry as string[])[0] === source.parentSession, 'Inconsistent source ancestry');
    requireValue(Array.isArray(input.records) && input.records.length <= MAX_RECORDS, 'Invalid session records or too many records');
    for (const value of [source.id, source.parentSession, source.activeLeaf, ...((input.ancestry as string[] | undefined) ?? [])]) {
      requireValue(typeof value !== 'string' || this.redact(value) === value, 'Session identifiers contain secrets');
    }
    const records: SessionRecord[] = [];
    const seen = new Map<string, SessionRecord>();
    for (const item of input.records) {
      requireValue(object(item) && validId(item.id) && (item.parentId === null || validId(item.parentId)) && text(item.type, 128) && item.type.length > 0 && validDate(item.createdAt) && object(item.data), 'Invalid session record');
      requireValue(Object.keys(item).every(key => ['id', 'parentId', 'type', 'data', 'createdAt'].includes(key)), 'Invalid session record fields');
      requireValue(!seen.has(item.id) && (item.parentId === null || seen.has(item.parentId)), 'Duplicate record or invalid parent ancestry');
      requireValue(this.redact(item.id) === item.id && this.redact(item.createdAt) === item.createdAt, 'Session record identifiers or dates contain secrets');
      // Validate checkpoint hashes before redacting them. They remain documentary,
      // never gaining an entry in the private checkpoint-authority table.
      validateData(item.type, item.data);
      const data = cleanJson(item.data, this.redact, true) as Record<string, unknown>;
      const record: SessionRecord = { id: item.id, parentId: item.parentId, type: this.redact(item.type), data, createdAt: item.createdAt };
      requireValue(text(record.type, 128) && record.type.length > 0, 'Invalid redacted event type');
      requireValue(Buffer.byteLength(JSON.stringify(record)) <= MAX_RECORD, 'Session record is too large');
      if (record.type === 'checkpoint') {
        for (const field of ['before', 'after'] as const) data[`${field}Hash`] = data[field] === null ? null : hash(data[field] as string);
      }
      validateData(record.type, data);
      records.push(record);
      seen.set(record.id, record);
    }
    requireValue(source.activeLeaf === null || seen.has(source.activeLeaf), 'Unknown active leaf');
    checkpointStates(records);
    const time = this.now();
    const meta: SessionMeta = {
      id: randomUUID(), parentSession: source.id, cwd: this.redact(source.cwd), name: this.redact(source.name),
      createdAt: time, updatedAt: time, activeLeaf: source.activeLeaf, labels: [...new Set((source.labels as string[]).map(label => this.redact(label)))],
    };
    const sources = input.ancestry as string[] | undefined;
    const token = this.transaction(() => {
      const owner = this.insertSession(meta, [source.id as string, ...(sources ?? (source.parentSession ? [source.parentSession as string] : []))]);
      for (const record of records) this.insertRecord(meta.id, record);
      return owner;
    });
    return this.attach(meta.id, token);
  }

  close(): void {
    if (this.closed) return;
    this.transaction(() => {
      for (const [id, token] of this.owners) this.db.prepare('DELETE FROM owners WHERE session_id = ? AND token = ?').run(id, token);
    });
    this.owners.clear();
    this.db.close();
    this.closed = true;
  }

  private assertOpen(): void { requireValue(!this.closed, 'Session store is closed'); }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private now(): string {
    const latest = this.db.prepare('SELECT MAX(updated_at) AS time FROM sessions').get()?.time;
    return new Date(Math.max(Date.now(), typeof latest === 'string' ? Date.parse(latest) + 1 : 0)).toISOString();
  }

  private metadata(id: string): SessionMeta {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    requireValue(row, `Session not found: ${id}`);
    return {
      id: String(row.id), cwd: String(row.cwd), name: String(row.name), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      ...(row.parent_session === null ? {} : { parentSession: String(row.parent_session) }),
      activeLeaf: row.active_leaf === null ? null : String(row.active_leaf), labels: JSON.parse(String(row.labels)) as string[],
    };
  }

  private sourceAncestry(id: string): string[] {
    return JSON.parse(String(this.db.prepare('SELECT ancestry FROM sessions WHERE id = ?').get(id)!.ancestry)) as string[];
  }

  private acquire(id: string): string {
    const owner = this.db.prepare('SELECT pid FROM owners WHERE session_id = ?').get(id);
    if (owner) {
      let alive = true;
      try { process.kill(Number(owner.pid), 0); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
      requireValue(!alive, `Session ${id} is already open (locked by process ${owner.pid})`);
      this.db.prepare('DELETE FROM owners WHERE session_id = ?').run(id);
    }
    const token = randomUUID();
    this.db.prepare('INSERT INTO owners (session_id, pid, token) VALUES (?, ?, ?)').run(id, process.pid, token);
    return token;
  }

  private assertOwned(id: string, token: string): void {
    this.assertOpen();
    requireValue(this.owners.get(id) === token && this.db.prepare('SELECT token FROM owners WHERE session_id = ?').get(id)?.token === token, 'Session is closed or no longer owned by this process');
  }

  private insertSession(meta: SessionMeta, sources: string[]): string {
    requireValue(sources.length <= 1000, 'Session ancestry is too large');
    this.db.prepare('INSERT INTO sessions (id, cwd, name, created_at, updated_at, parent_session, active_leaf, labels, ancestry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(meta.id, meta.cwd, meta.name, meta.createdAt, meta.updatedAt, meta.parentSession ?? null, meta.activeLeaf, JSON.stringify(meta.labels), JSON.stringify(sources));
    return this.acquire(meta.id);
  }

  private readRecords(id: string): SessionRecord[] {
    return this.db.prepare('SELECT id, parent_id, type, data, created_at FROM records WHERE session_id = ? ORDER BY seq').all(id).map(row => ({
      id: String(row.id), parentId: row.parent_id === null ? null : String(row.parent_id), type: String(row.type),
      data: JSON.parse(String(row.data)) as Record<string, unknown>, createdAt: String(row.created_at),
    }));
  }

  private insertRecord(id: string, record: SessionRecord): void {
    this.db.prepare('INSERT INTO records (session_id, id, parent_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, record.id, record.parentId, record.type, JSON.stringify(record.data), record.createdAt);
  }

  private commitRecord(id: string, record: SessionRecord): void {
    this.insertRecord(id, record);
    this.db.prepare('UPDATE sessions SET active_leaf = ?, updated_at = ? WHERE id = ?').run(record.id, this.now(), id);
  }

  private prepareRecord(id: string, type: string, data: Record<string, unknown>): { record: SessionRecord; authority?: CheckpointAuthority } {
    requireValue(text(type, 128) && type.length > 0 && type !== 'undo' && type !== 'redo', 'Invalid or reserved session event type');
    requireValue(object(data), 'Session event data must be an object');
    const clean = cleanJson(data, this.redact) as Record<string, unknown>;
    const originalType = type;
    type = this.redact(type);
    requireValue(text(type, 128) && type.length > 0 && type !== 'undo' && type !== 'redo', 'Invalid or reserved redacted event type');
    if (type === 'checkpoint' || originalType === 'checkpoint') {
      requireValue(type === originalType && JSON.stringify(clean) === JSON.stringify(cleanJson(data, value => value)), 'Checkpoint contains secrets; refusing to persist an undoable copy');
    }
    validateData(type, clean);
    const meta = this.metadata(id);
    let authority: CheckpointAuthority | undefined;
    if (type === 'checkpoint') {
      const path = resolve(meta.cwd, clean.path as string);
      const directory = realpathSync(dirname(path));
      clean.path = join(directory, basename(path));
      requireValue(this.redact(clean.path as string) === clean.path, 'Checkpoint path contains secrets');
      const parent = lstatSync(directory, { bigint: true });
      const file = lstatSync(clean.path as string, { throwIfNoEntry: false });
      requireValue(!file || (file.isFile() && !file.isSymbolicLink() && file.nlink === 1), 'Checkpoint path must be a regular, non-linked file');
      authority = { directory, device: String(parent.dev), inode: String(parent.ino), mode: file ? file.mode & 0o777 : 0o600 };
    }
    const record: SessionRecord = { id: randomUUID(), parentId: meta.activeLeaf, type, data: clean, createdAt: this.now() };
    requireValue(Buffer.byteLength(JSON.stringify(record)) <= MAX_RECORD, 'Session record is too large');
    return { record, authority };
  }

  private attach(id: string, token: string): Session {
    this.owners.set(id, token);
    const store = this;
    const ready = (): void => { this.assertOwned(id, token); this.recover(id); };
    return {
      get meta() { store.assertOwned(id, token); return store.metadata(id); },
      append(type, data) {
        ready();
        const { record, authority } = store.prepareRecord(id, type, data);
        store.transaction(() => {
          store.commitRecord(id, record);
          if (authority) store.db.prepare('INSERT INTO checkpoints (session_id, record_id, authority) VALUES (?, ?, ?)').run(id, record.id, JSON.stringify(authority));
        });
        return structuredClone(record);
      },
      prepareCheckpoint(change) {
        ready();
        const { record, authority } = store.prepareRecord(id, 'checkpoint', { ...change });
        requireValue(authority, 'Missing checkpoint authority');
        requireValue(record.data.beforeHash !== record.data.afterHash, 'Prepared checkpoint must describe a change');
        for (const field of ['before', 'after']) {
          const content = record.data[field];
          requireValue(content === null || Buffer.from(content as string).toString('utf8') === content, 'Checkpoint content must be valid UTF-8');
        }
        store.checkpointFile(id, record, path => {
          requireValue(store.fileState(path).hash === record.data.beforeHash, 'Checkpoint conflict: file changed before preparation');
          store.transaction(() => store.db.prepare('INSERT INTO pending_actions (session_id, data) VALUES (?, ?)')
            .run(id, JSON.stringify({ kind: 'write', record, authority } satisfies PendingWrite)));
        }, authority);
        let settled = false;
        return () => {
          store.assertOwned(id, token);
          if (settled) return;
          // Also usable in abort cleanup, once publication has definitively stopped.
          store.recover(id, 'finalize', record.id);
          settled = true;
        };
      },
      records() { store.assertOwned(id, token); return store.readRecords(id); },
      branch(leaf) {
        ready();
        requireValue(leaf === null || store.db.prepare('SELECT 1 FROM records WHERE session_id = ? AND id = ?').get(id, leaf), 'Unknown branch leaf');
        store.transaction(() => store.db.prepare('UPDATE sessions SET active_leaf = ?, updated_at = ? WHERE id = ?').run(leaf, store.now(), id));
      },
      history() {
        store.assertOwned(id, token);
        let messages: Message[] = [];
        for (const record of ancestry(store.readRecords(id), store.metadata(id).activeLeaf)) {
          if (record.type === 'compaction') messages = [{ role: 'user', content: record.data.summary as string }];
          else if (record.type === 'message') messages.push(record.data.message as unknown as Message);
        }
        return messages;
      },
      rename(name) {
        ready();
        requireValue(text(name, 1024), 'Invalid session name');
        store.transaction(() => store.db.prepare('UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?').run(store.redact(name), store.now(), id));
      },
      label(label) {
        ready();
        requireValue(text(label, 1024) && label.trim().length > 0, 'Invalid session label');
        const labels = [...new Set([...store.metadata(id).labels, store.redact(label)])];
        requireValue(labels.length <= 1000, 'Too many session labels');
        store.transaction(() => store.db.prepare('UPDATE sessions SET labels = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(labels), store.now(), id));
      },
      async undo() { ready(); return store.changeFile(id, 'undo'); },
      async redo() { ready(); return store.changeFile(id, 'redo'); },
      close() {
        if (store.closed || store.owners.get(id) !== token) return;
        store.transaction(() => store.db.prepare('DELETE FROM owners WHERE session_id = ? AND token = ?').run(id, token));
        store.owners.delete(id);
      },
    };
  }

  private actionCheckpoint(id: string, direction: 'undo' | 'redo'): SessionRecord {
    const state = checkpointStates(this.readRecords(id)).get(this.metadata(id).activeLeaf ?? '');
    const checkpoint = state?.[direction === 'undo' ? 'applied' : 'undone']?.record;
    requireValue(checkpoint, `Nothing to ${direction}`);
    return checkpoint;
  }

  // Pin the recorded directory, and address files through that descriptor on
  // Linux. A replaced parent symlink cannot redirect a restore to another tree.
  private checkpointFile<T>(id: string, checkpoint: SessionRecord, work: (path: string, directory: number, authority: CheckpointAuthority) => T, authority?: CheckpointAuthority): T {
    if (!authority) {
      const row = this.db.prepare('SELECT authority FROM checkpoints WHERE session_id = ? AND record_id = ?').get(id, checkpoint.id);
      requireValue(row, 'Imported checkpoint is disabled: file writes are not authorized');
      authority = JSON.parse(String(row.authority)) as CheckpointAuthority;
    }
    requireValue(process.platform === 'linux', 'Safe checkpoint restore requires Linux descriptor-relative file operations');
    requireValue(realpathSync(authority.directory) === authority.directory, 'Checkpoint conflict: directory path changed');
    const directory = openSync(authority.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(directory, { bigint: true });
      requireValue(String(stat.dev) === authority.device && String(stat.ino) === authority.inode, 'Checkpoint conflict: directory identity changed');
      const path = `/proc/self/fd/${directory}/${basename(checkpoint.data.path as string)}`;
      return work(path, directory, authority);
    } finally { closeSync(directory); }
  }

  private fileState(path: string, allowLinks = false): { hash: string | null; mode?: number } {
    let file: number;
    try { file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hash: null };
      throw new Error('Checkpoint conflict: file cannot be safely opened', { cause: error });
    }
    try {
      const stat = fstatSync(file);
      requireValue(stat.isFile() && (allowLinks || stat.nlink === 1) && stat.size <= MAX_RECORD, 'Checkpoint conflict: file is not a bounded, non-linked regular file');
      const bytes = readFileSync(file);
      const content = bytes.toString('utf8');
      requireValue(Buffer.from(content).equals(bytes), 'Checkpoint conflict: file is not UTF-8');
      return { hash: hash(content), mode: stat.mode & 0o777 };
    } finally { closeSync(file); }
  }

  private changeFile(id: string, direction: 'undo' | 'redo'): string {
    const checkpoint = this.actionCheckpoint(id, direction);
    const change = checkpoint.data as unknown as Checkpoint;
    const expected = direction === 'undo' ? change.afterHash : change.beforeHash;
    const target = direction === 'undo' ? change.before : change.after;
    const record: SessionRecord = {
      id: randomUUID(), parentId: this.metadata(id).activeLeaf, type: direction,
      data: { checkpointId: checkpoint.id }, createdAt: this.now(),
    };
    this.checkpointFile(id, checkpoint, (path, directory, authority) => {
      const current = this.fileState(path);
      requireValue(current.hash === expected, 'Checkpoint conflict: file has external edits');
      const mode = current.mode ?? authority.mode;
      this.transaction(() => {
        this.db.prepare('UPDATE checkpoints SET authority = ? WHERE session_id = ? AND record_id = ?').run(JSON.stringify({ ...authority, mode }), id, checkpoint.id);
        this.db.prepare('INSERT INTO pending_actions (session_id, data) VALUES (?, ?)').run(id, JSON.stringify({ record } satisfies PendingAction));
      });
      const temp = `/proc/self/fd/${directory}/.kiln-${randomUUID()}.tmp`;
      let tempExists = false;
      try {
        if (target !== null) {
          const file = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
          tempExists = true;
          try { writeFileSync(file, target); fchmodSync(file, mode); fsyncSync(file); } finally { closeSync(file); }
        }
        requireValue(realpathSync(authority.directory) === authority.directory, 'Checkpoint conflict: directory path changed');
        const parent = lstatSync(authority.directory, { bigint: true });
        requireValue(String(parent.dev) === authority.device && String(parent.ino) === authority.inode, 'Checkpoint conflict: directory identity changed');
        requireValue(this.fileState(path).hash === expected, 'Checkpoint conflict: file has external edits');
        if (target === null) {
          if (current.hash !== null) unlinkSync(path);
        } else { renameSync(temp, path); tempExists = false; }
        fsyncSync(directory);
        this.transaction(() => {
          this.commitRecord(id, record);
          this.db.prepare('DELETE FROM pending_actions WHERE session_id = ?').run(id);
        });
      } finally { if (tempExists) unlinkSync(temp); }
    });
    return change.path;
  }

  private recover(id: string, mode: 'wait' | 'resume' | 'finalize' = 'wait', writeId?: string): void {
    const row = this.db.prepare('SELECT data FROM pending_actions WHERE session_id = ?').get(id);
    if (!row) {
      requireValue(writeId === undefined, 'Prepared checkpoint is no longer pending');
      return;
    }
    let pending: PendingAction | PendingWrite;
    try {
      const serialized = String(row.data);
      requireValue(Buffer.byteLength(serialized) <= MAX_RECORD + 32_768, 'Pending checkpoint is too large');
      const input: unknown = JSON.parse(serialized);
      requireValue(object(input) && object(input.record), 'Invalid pending checkpoint');
      const record = input.record;
      requireValue(validId(record.id) && (record.parentId === null || validId(record.parentId)) && validDate(record.createdAt) && object(record.data), 'Invalid pending checkpoint record');
      requireValue(input.kind === 'write' ? record.type === 'checkpoint' : input.kind === undefined && (record.type === 'undo' || record.type === 'redo'), 'Invalid pending checkpoint kind');
      validateData(record.type as string, record.data);
      if (input.kind === 'write') {
        const authority = input.authority;
        requireValue(object(authority) && text(authority.directory, 16_384) && authority.directory === dirname(record.data.path as string) && resolve(record.data.path as string) === record.data.path, 'Invalid pending checkpoint directory');
        requireValue(text(authority.device, 32) && /^\d+$/.test(authority.device) && text(authority.inode, 32) && /^\d+$/.test(authority.inode) && typeof authority.mode === 'number' && Number.isInteger(authority.mode) && authority.mode >= 0 && authority.mode <= 0o777, 'Invalid pending checkpoint authority');
        requireValue(record.data.beforeHash !== record.data.afterHash && Buffer.byteLength(JSON.stringify(record)) <= MAX_RECORD, 'Invalid pending checkpoint snapshot');
      }
      pending = input as unknown as PendingAction | PendingWrite;
    } catch {
      this.transaction(() => this.db.prepare('DELETE FROM pending_actions WHERE session_id = ?').run(id));
      throw new Error('Invalid pending checkpoint intent; intent cleared, file and prior history left unchanged');
    }
    const { record } = pending;
    requireValue(writeId === undefined || ('kind' in pending && pending.kind === 'write' && record.id === writeId), 'Prepared checkpoint is no longer pending');
    if ('kind' in pending) {
      requireValue(mode !== 'wait', 'Checkpoint write is pending; settle its callback or close and reopen the session');
      let checked = false;
      // Only validation and filesystem conflicts discard an original-write intent.
      // A database/fsync failure below leaves the valid intent durable for retry.
      try {
        requireValue(record.parentId === this.metadata(id).activeLeaf && !this.db.prepare('SELECT 1 FROM records WHERE session_id = ? AND id = ?').get(id, record.id), 'Checkpoint branch changed');
        this.checkpointFile(id, record, (path, directory) => {
          // create_file publishes with link(), so a crash may leave its temp link.
          // Recovery only reads; undo/redo still refuse multiply-linked files.
          const current = this.fileState(path, true).hash;
          requireValue(current === record.data.beforeHash || current === record.data.afterHash, 'File has external edits');
          const applied = current === record.data.afterHash;
          checked = true;
          if (applied) fsyncSync(directory);
          this.transaction(() => {
            if (applied) {
              this.commitRecord(id, record);
              this.db.prepare('INSERT INTO checkpoints (session_id, record_id, authority) VALUES (?, ?, ?)').run(id, record.id, JSON.stringify(pending.authority));
            }
            this.db.prepare('DELETE FROM pending_actions WHERE session_id = ?').run(id);
          });
        }, pending.authority);
      } catch (error) {
        if (checked) throw error;
        this.transaction(() => this.db.prepare('DELETE FROM pending_actions WHERE session_id = ?').run(id));
        throw new Error('Pending write recovery conflict: file, path, or branch changed; intent cleared, file and prior history left unchanged');
      }
      return;
    }
    requireValue(record.parentId === this.metadata(id).activeLeaf, 'Checkpoint recovery conflict: active branch changed');
    const checkpoint = this.readRecords(id).find(item => item.id === record.data.checkpointId);
    requireValue(checkpoint?.type === 'checkpoint', 'Invalid pending checkpoint');
    const change = checkpoint.data as unknown as Checkpoint;
    const expected = record.type === 'undo' ? change.afterHash : change.beforeHash;
    const target = record.type === 'undo' ? change.beforeHash : change.afterHash;
    this.checkpointFile(id, checkpoint, (path, directory) => {
      const current = this.fileState(path).hash;
      requireValue(current === expected || current === target, 'Checkpoint recovery conflict: file has external edits');
      // A filesystem mutation and SQLite commit cannot be one transaction. A
      // durable intent lets recovery finalize an applied action without writing.
      if (current === target) fsyncSync(directory);
      this.transaction(() => {
        if (current === target) this.commitRecord(id, record);
        this.db.prepare('DELETE FROM pending_actions WHERE session_id = ?').run(id);
      });
    });
  }
}
