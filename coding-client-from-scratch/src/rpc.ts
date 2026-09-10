import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ProcessServerConfig } from './types.js';
import { abortError, checkAbort, errorMessage } from './util.js';

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_HEADER_BYTES = 8192;
const CANCEL_TIMEOUT_MS = 250;
const REQUEST_TIMEOUT_MS = 30_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validResourceName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 24 && /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(value);
}

export function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(abortError()); };
    // Observe the original promise even when already aborted or after the wait ends.
    promise.then(value => { if (signal.aborted) cancel(); else resolve(value); }, reject)
      .finally(() => signal.removeEventListener('abort', cancel));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}

export class RpcError extends Error {
  constructor(message: string, readonly code: number, readonly data?: unknown) { super(message); }
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  cleanup(): void;
  cancelled: boolean;
}

interface RpcOptions {
  framing: 'jsonl' | 'lsp';
  notification?(method: string, params: unknown): void;
  request?(method: string, params: unknown): unknown | Promise<unknown>;
  failure?(error: Error): void;
  stderr?(bytes: number): void;
}

/** One process generation. A failed connection is never reused. */
export class ProcessRpc {
  private child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private contentLength: number | undefined;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private failure: Error | undefined;
  private stopping: Promise<void> | undefined;

  constructor(config: ProcessServerConfig, cwd: string, private options: RpcOptions) {
    if (!validResourceName(config.name) || typeof config.command !== 'string' || !config.command ||
        (config.args !== undefined && (!Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string'))) ||
        (config.env !== undefined && (!isRecord(config.env) || Object.values(config.env).some(value => typeof value !== 'string')))) {
      throw new Error('Invalid process server configuration');
    }
    this.child = spawn(config.command, config.args ?? [], {
      cwd, env: { ...process.env, ...config.env }, stdio: 'pipe', shell: false,
      detached: process.platform !== 'win32', windowsHide: true,
    });
    this.child.on('error', error => this.fail(error));
    this.child.on('close', (code, signal) => this.fail(new Error(`Server ${config.name} exited (${signal ?? code})`)));
    this.child.stdin.on('error', error => this.fail(error));
    this.child.stdout.on('error', error => this.fail(error));
    this.child.stderr.on('error', error => this.fail(error));
    this.child.stdout.on('end', () => this.fail(new Error(`Server ${config.name} closed its output`)));
    this.child.stdout.on('data', (chunk: Buffer) => {
      try { this.receive(chunk); } catch (error) { this.fail(new Error(`Invalid RPC stream: ${errorMessage(error)}`)); }
    });
    this.child.stderr.on('data', (chunk: Buffer) => {
      // No secret set is available here; even partial text can expose split credentials.
      try { options.stderr?.(chunk.length); } catch { /* A reporting sink must not crash a child event handler. */ }
    });
  }

  get alive(): boolean { return !this.failure; }

  request(method: string, params: unknown, signal: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    checkAbort(signal);
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 128) return Promise.reject(new Error('Too many pending RPC requests'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const pending = this.pending.get(id);
        if (!pending || pending.cancelled) return;
        pending.cancelled = true;
        clearTimeout(pending.timer);
        pending.cleanup();
        reject(abortError());
        pending.timer = setTimeout(() => this.fail(new Error(`Server ignored cancellation of ${method}`)), CANCEL_TIMEOUT_MS);
        try { this.notify(this.options.framing === 'lsp' ? '$/cancelRequest' : 'cancel', { id }); }
        catch (error) { this.fail(new Error(errorMessage(error))); }
      };
      const timer = setTimeout(() => this.fail(new Error(`RPC request timed out: ${method}`)), timeoutMs);
      this.pending.set(id, { resolve, reject, timer, cancelled: false, cleanup: () => signal.removeEventListener('abort', cancel) });
      signal.addEventListener('abort', cancel, { once: true });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { this.fail(new Error(errorMessage(error))); }
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.buffer = Buffer.alloc(0);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    this.child.stdin.destroy();
    this.stopping = new Promise(resolve => {
      this.kill('SIGTERM');
      // Kill the group even if its leader exits first, so descendants cannot leak.
      setTimeout(() => { this.kill('SIGKILL'); resolve(); }, CANCEL_TIMEOUT_MS);
    });
    try { this.options.failure?.(error); } catch { /* Isolate reporting failures. */ }
  }

  async close(graceMs = 0): Promise<void> {
    if (graceMs > 0 && this.alive) {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); this.child.removeListener('close', done); resolve(); };
        const timer = setTimeout(done, graceMs);
        this.child.once('close', done);
      });
    }
    this.fail(new Error('RPC connection closed'));
    await this.stopping;
  }

  private kill(signal: NodeJS.Signals): void {
    if (!this.child.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        try { this.child.kill(signal); } catch { /* The process may already have exited. */ }
      }
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.failure) throw this.failure;
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (body.length > MAX_FRAME_BYTES) throw new Error('RPC frame exceeds maximum size');
    const frame = this.options.framing === 'jsonl'
      ? Buffer.concat([body, Buffer.from('\n')])
      : Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
    this.child.stdin.write(frame, error => { if (error) this.fail(error); });
  }

  private receive(chunk: Buffer): void {
    if (this.failure) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length && !this.failure) {
      let body: Buffer;
      if (this.options.framing === 'jsonl') {
        const newline = this.buffer.indexOf(10);
        if (newline < 0) {
          if (this.buffer.length > MAX_FRAME_BYTES) throw new Error('RPC frame exceeds maximum size');
          return;
        }
        if (newline > MAX_FRAME_BYTES) throw new Error('RPC frame exceeds maximum size');
        body = this.buffer.subarray(0, newline);
        this.buffer = this.buffer.subarray(newline + 1);
        if (body.length === 0) throw new Error('Empty JSONL frame');
      } else {
        if (this.contentLength === undefined) {
          const end = this.buffer.indexOf('\r\n\r\n');
          if (end < 0) {
            if (this.buffer.length > MAX_HEADER_BYTES) throw new Error('LSP header exceeds maximum size');
            return;
          }
          if (end > MAX_HEADER_BYTES) throw new Error('LSP header exceeds maximum size');
          const headers = this.buffer.subarray(0, end).toString('ascii').split('\r\n');
          let length: number | undefined;
          for (const header of headers) {
            const match = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(header);
            if (!match) throw new Error('Malformed LSP header');
            if (match[1]!.toLowerCase() === 'content-length') {
              if (length !== undefined || !/^(0|[1-9][0-9]*)$/.test(match[2]!)) throw new Error('Invalid Content-Length');
              length = Number(match[2]);
            }
          }
          if (length === undefined || !Number.isSafeInteger(length) || length < 1 || length > MAX_FRAME_BYTES) {
            throw new Error('Invalid or oversized Content-Length');
          }
          this.contentLength = length;
          this.buffer = this.buffer.subarray(end + 4);
        }
        if (this.buffer.length < this.contentLength) return;
        body = this.buffer.subarray(0, this.contentLength);
        this.buffer = this.buffer.subarray(this.contentLength);
        this.contentLength = undefined;
      }
      this.message(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)));
    }
  }

  private message(message: unknown): void {
    if (!isRecord(message) || message.jsonrpc !== '2.0') throw new Error('Expected a JSON-RPC 2.0 object');
    if ('method' in message) {
      if (typeof message.method !== 'string' || 'result' in message || 'error' in message) throw new Error('Invalid RPC method');
      if ('id' in message) {
        if (typeof message.id !== 'number' && typeof message.id !== 'string') throw new Error('Invalid request ID');
        const { id, method, params } = message;
        void Promise.resolve().then(() => {
          if (!this.options.request) throw new RpcError(`Unsupported method: ${method}`, -32601);
          return this.options.request(method, params);
        }).then(
          result => { if (this.alive) this.send({ jsonrpc: '2.0', id, result: result ?? null }); },
          error => { if (this.alive) this.send({ jsonrpc: '2.0', id, error: { code: error instanceof RpcError ? error.code : -32603, message: errorMessage(error) } }); },
        ).catch(error => this.fail(new Error(errorMessage(error))));
      } else {
        this.options.notification?.(message.method, message.params);
      }
      return;
    }
    if (typeof message.id !== 'number' || ('result' in message) === ('error' in message)) throw new Error('Invalid RPC response');
    if ('error' in message && (!isRecord(message.error) || typeof message.error.code !== 'number' || typeof message.error.message !== 'string')) {
      throw new Error('Invalid RPC error');
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.cleanup();
    if (pending.cancelled) return;
    if (isRecord(message.error)) pending.reject(new RpcError(message.error.message as string, message.error.code as number, message.error.data));
    else pending.resolve(message.result);
  }
}
