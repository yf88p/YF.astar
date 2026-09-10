import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Emit, KilnEvent } from './types.js';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function abortError(): Error { return new DOMException('Operation aborted', 'AbortError'); }
export function checkAbort(signal: AbortSignal): void { if (signal.aborted) throw abortError(); }
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    signal.addEventListener('abort', cancel, { once: true });
  });
}
export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function redactor(secrets: string[]): (text: string) => string {
  const values = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  return text => values.reduce((out, value) => out.split(value).join('[REDACTED]'), text)
    .replace(/\b(sk-(?:ant-)?[A-Za-z0-9_-]{16,})\b/g, '[REDACTED]');
}
export function safeText(text: string): string {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}
export function eventEmitter(sessionId: string, sink: (event: KilnEvent) => void, redact = (s: string) => s): Emit {
  return (type, data = {}) => {
    const clean = redactValue(data, redact);
    sink({ ...clean, version: 1, type, time: new Date().toISOString(), sessionId });
  };
}
export function redactValue<T>(value: T, redact: (s: string) => string): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(item => redactValue(item, redact)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key))
    .map(([key, item]) => [redact(key), redactValue(item, redact)])) as T;
  return value;
}
// Keep a suffix until its potential secret prefix is resolved, including across transport chunks.
export class StreamRedactor {
  private pending = '';
  private genericPending = '';
  private continuation = false;
  private previousWord = false;
  private readonly keep: number;
  constructor(private secrets: string[]) {
    this.secrets = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
    this.keep = Math.max(0, ...this.secrets.map(value => value.length - 1));
  }
  push(chunk: string, final = false): string {
    this.pending += chunk;
    const end = final ? this.pending.length : Math.max(0, this.pending.length - this.keep);
    let consumed = 0;
    let known = '';
    if (!this.secrets.length) { known = this.pending; consumed = this.pending.length; }
    else while (consumed < end) {
      // Consume whole matches, rather than retaining an unbounded chain of overlapping matches.
      const secret = this.secrets.find(value => this.pending.startsWith(value, consumed));
      if (secret) { known += '[REDACTED]'; consumed += secret.length; }
      else known += this.pending[consumed++];
    }
    const text = this.genericPending + known;
    this.pending = this.pending.slice(consumed);
    this.genericPending = '';
    let output = '';
    let index = 0;
    // Hold at most 18 generic-prefix characters. Once recognized, discard the
    // entire token continuation instead of buffering an arbitrarily long key.
    while (index < text.length) {
      if (this.continuation) {
        const length = /^[A-Za-z0-9_-]*/.exec(text.slice(index))![0].length;
        index += length;
        if (length) this.previousWord = /\w/.test(text[index - 1]!);
        if (index === text.length) break;
        this.continuation = false;
      }
      if (!this.previousWord && text[index] === 's') {
        const rest = text.slice(index);
        if (!final && 'sk-'.startsWith(rest)) { this.genericPending = rest; break; }
        if (rest.startsWith('sk-')) {
          const token = /^sk-[A-Za-z0-9_-]*/.exec(rest)![0];
          if (token.length >= 19) {
            output += '[REDACTED]'; index += token.length;
            this.previousWord = /\w/.test(token.at(-1)!);
            this.continuation = true;
            continue;
          }
          if (!final && index + token.length === text.length) { this.genericPending = token; break; }
          output += token; index += token.length;
          this.previousWord = /\w/.test(token.at(-1)!);
          continue;
        }
      }
      output += text[index];
      this.previousWord = /\w/.test(text[index++]!);
    }
    return output;
  }
}
export function jsonLine(event: unknown): string {
  return JSON.stringify(event).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '\n';
}
export async function atomicWrite(path: string, content: string | Buffer, mode = 0o600): Promise<void> {
  const temp = join(dirname(path), `.kiln-${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temp, 'wx', mode);
    await file.writeFile(content);
    await file.sync();
    await file.close(); file = undefined;
    await rename(temp, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await file?.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
export function truncate(text: string, maxLines = 250, maxBytes = 24000): { text: string; truncated: boolean } {
  const lines = text.split('\n');
  let cut = lines.slice(0, maxLines).join('\n');
  if (Buffer.byteLength(cut) > maxBytes) {
    const buffer = Buffer.from(cut);
    let end = maxBytes;
    while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
    cut = buffer.subarray(0, end).toString('utf8');
  }
  return { text: cut, truncated: cut !== text };
}
export async function modelOutput(text: string, context: { stateDir: string; redact: (s: string) => string }): Promise<string> {
  const clean = context.redact(text);
  const result = truncate(clean);
  if (!result.truncated) return result.text;
  const dir = join(context.stateDir, 'outputs');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${randomUUID()}.txt`);
  await atomicWrite(path, clean);
  return `${result.text}\n\n[Truncated by lines/bytes. Complete redacted output: ${path}]`;
}
export class KeyedQueue {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.tails.set(key, next);
    try { return await next; } finally { if (this.tails.get(key) === next) this.tails.delete(key); }
  }
}
