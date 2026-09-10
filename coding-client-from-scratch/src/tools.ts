import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import ignore, { type Ignore } from 'ignore';
import { minimatch } from 'minimatch';
import { canonicalOutputPath, canonicalPath, isProtectedPath } from './permissions.js';
import type { JsonSchema, Tool, ToolContext, ToolResult } from './types.js';
import { abortError, checkAbort, errorMessage, hash, KeyedQueue, modelOutput, redactValue, StreamRedactor, truncate } from './util.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PROCESS_BYTES = 4 * 1024 * 1024;
const writes = new KeyedQueue();
const hardIgnored = new Set(['.git', '.hg', '.svn', '.kiln', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'coverage', '.next', '.cache']);

export async function runProcess(command: string, args: string[], options: {
  cwd: string; signal: AbortSignal; onOutput?: (text: string, stream: 'stdout' | 'stderr') => void | Promise<void>;
  env?: NodeJS.ProcessEnv; timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; code: number; signal: string | null }> {
  checkAbort(options.signal);
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error('timeoutMs must be positive');
  }
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: '', stderr: '' };
    const bytes = { stdout: 0, stderr: 0 };
    const consuming = { stdout: false, stderr: false };
    let closed = false;
    let settled = false;
    let streamsDone = 0;
    let escalated = false;
    let failure: Error | undefined;
    let exitCode = 1;
    let exitSignal: string | null = null;
    let timeout: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (settled || !closed || streamsDone !== 2 || (failure && !escalated)) return;
      settled = true;
      clearTimeout(timeout); clearTimeout(killTimer); clearTimeout(drainTimer);
      options.signal.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else resolveProcess({ ...output, code: exitCode, signal: exitSignal });
    };
    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
      }
    };
    const stop = (error: Error) => {
      if (failure || settled) return;
      failure = error;
      killGroup('SIGTERM');
      // Do not cancel escalation on parent exit: descendants may ignore TERM or have closed their pipes.
      killTimer = setTimeout(() => {
        killGroup('SIGKILL');
        escalated = true;
        finish();
        const drain = () => {
          // Bound inherited idle pipes, but never discard buffered output while a sink applies backpressure.
          for (const name of ['stdout', 'stderr'] as const) {
            if (!consuming[name] && child[name].readableLength === 0) child[name].destroy();
          }
          if (child.stdout.destroyed && child.stderr.destroyed) { closed = true; finish(); }
          if (!settled) drainTimer = setTimeout(drain, 50);
        };
        if (!settled) drainTimer = setTimeout(drain, 500);
      }, 200);
    };
    const cancel = () => stop(abortError());
    options.signal.addEventListener('abort', cancel, { once: true });
    if (options.signal.aborted) cancel();
    if (options.timeoutMs !== undefined) timeout = setTimeout(() => stop(new Error(`Process timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
    for (const name of ['stdout', 'stderr'] as const) {
      child[name].setEncoding('utf8');
      // Await each consumer before reading again: at most one chunk per stream is in flight.
      void (async () => {
        try {
          for await (const chunk of child[name]) {
            const text = String(chunk);
            bytes[name] += Buffer.byteLength(text);
            output[name] = bytes[name] <= MAX_PROCESS_BYTES ? output[name] + text : `[${name} exceeded ${MAX_PROCESS_BYTES} bytes; capture omitted]\n`;
            consuming[name] = true;
            try { await options.onOutput?.(text, name); } finally { consuming[name] = false; }
          }
        } catch (error) { stop(new Error(errorMessage(error))); }
        finally { streamsDone++; finish(); }
      })();
    }
    child.on('error', error => stop(error));
    child.on('close', (code, signal) => {
      closed = true; exitCode = code ?? 1; exitSignal = signal;
      finish();
    });
  });
}

function stringArg(args: Record<string, unknown>, name: string, fallback?: string): string {
  const value = args[name] === undefined ? fallback : args[name];
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value;
}

function numberArg(args: Record<string, unknown>, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = args[name] === undefined ? fallback : args[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`);
  return value;
}

function outputRedactor(context: ToolContext): (chunk: string, final?: boolean) => string {
  const redact = new StreamRedactor(context.secrets ?? []);
  let pending = '';
  let continuation = false;
  return (chunk, final = false) => {
    const text = pending + context.redact(redact.push(chunk, final));
    pending = '';
    let output = '';
    let index = 0;
    // The shared regex can mask only the first chunk of a generic key. Never release its token continuation.
    while (index < text.length) {
      if (continuation) {
        const length = /^[A-Za-z0-9_-]*/.exec(text.slice(index))![0].length;
        index += length;
        if (index === text.length) break;
        continuation = false;
      }
      const rest = text.slice(index);
      const match = /sk-|\[REDACTED\]/.exec(rest);
      if (!match) {
        let keep = 0;
        if (!final) for (const prefix of ['sk-', '[REDACTED]']) {
          for (let length = 1; length < prefix.length; length++) {
            if (rest.endsWith(prefix.slice(0, length))) keep = Math.max(keep, length);
          }
        }
        if (!final && /[\ud800-\udbff]$/.test(rest)) keep = Math.max(keep, 1);
        output += rest.slice(0, rest.length - keep);
        pending = rest.slice(rest.length - keep);
        break;
      }
      output += rest.slice(0, match.index);
      index += match.index;
      if (match[0] === '[REDACTED]') {
        output += '[REDACTED]'; index += match[0].length; continuation = true;
      } else {
        const token = /^sk-[A-Za-z0-9_-]*/.exec(text.slice(index))![0];
        if (token.length >= 19) { output += '[REDACTED]'; index += token.length; continuation = true; }
        else if (!final && index + token.length === text.length) { pending = token; break; }
        else { output += token; index += token.length; }
      }
    }
    return output;
  };
}

async function revalidate(raw: string, canonical: string, context: ToolContext): Promise<void> {
  checkAbort(context.signal);
  if (await canonicalPath(raw, context.cwd) !== canonical || await canonicalPath(canonical, context.cwd) !== canonical) {
    throw new Error('Path changed after authorization; retry the operation');
  }
  checkAbort(context.signal);
}

async function readText(path: string, context: ToolContext): Promise<{ text: string; mode: number; ino: number; dev: number }> {
  await revalidate(path, path, context);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Path is not a regular file');
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} byte limit`);
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      checkAbort(context.signal);
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} byte limit`);
    const data = buffer.subarray(0, length);
    if (data.includes(0)) throw new Error('Binary files are not supported');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
    catch { throw new Error('Binary or non-UTF-8 files are not supported'); }
    return { text, mode: stat.mode & 0o777, ino: stat.ino, dev: stat.dev };
  } finally { await file.close(); }
}

function tool(name: string, description: string, readonly: boolean, properties: Record<string, JsonSchema>, required: string[],
  execute: Tool['execute']): Tool {
  return {
    name, description, readonly, inputSchema: { type: 'object', properties, required, additionalProperties: false },
    async execute(args, context) {
      try {
        checkAbort(context.signal);
        if (!readonly && context.mode === 'plan') throw new Error(`${name} is unavailable in plan mode`);
        const result = await execute(args, context);
        return { ...result, content: await modelOutput(result.content, context),
          ...(result.metadata ? { metadata: redactValue(result.metadata, context.redact) } : {}) };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          const message = context.redact(error.message);
          if (message !== error.message) throw new DOMException(message, 'AbortError');
          throw error;
        }
        if (context.signal.aborted) throw abortError();
        return { isError: true, content: await modelOutput(errorMessage(error), context) };
      }
    },
  };
}

async function mutate(args: Record<string, unknown>, context: ToolContext, create: boolean): Promise<ToolResult> {
  const raw = stringArg(args, 'path');
  const name = create ? 'create_file' : 'edit_file';
  const path = await canonicalPath(raw, context.cwd);
  return writes.run(path, async () => {
    checkAbort(context.signal);
    if (context.mode === 'plan') throw new Error('Writes are unavailable in plan mode');
    if (await context.permissions.path(raw, 'write', name, context.signal) !== path) throw new Error('Path changed during authorization');
    await revalidate(raw, path, context);
    let before: string | null = null;
    let after: string;
    let original: Awaited<ReturnType<typeof readText>> | undefined;
    if (create) {
      after = stringArg(args, 'content');
      try { await lstat(resolve(context.cwd, raw)); throw new Error('File already exists; create_file never overwrites'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    } else {
      if (await context.permissions.path(raw, 'read', name, context.signal) !== path) throw new Error('Path changed during authorization');
      await revalidate(raw, path, context);
      original = await readText(path, context);
      before = original.text;
      let oldText = stringArg(args, 'old_string');
      let newText = stringArg(args, 'new_string');
      if (!oldText) throw new Error('old_string must not be empty');
      if (before.includes('\r\n') && !/(?<!\r)\n/.test(before)) {
        oldText = oldText.replace(/\r?\n/g, '\r\n'); newText = newText.replace(/\r?\n/g, '\r\n');
      }
      const index = before.indexOf(oldText);
      if (index < 0) throw new Error('old_string was not found exactly');
      if (before.indexOf(oldText, index + 1) >= 0) throw new Error('Ambiguous edit: old_string occurs more than once');
      after = before.slice(0, index) + newText + before.slice(index + oldText.length);
      if (after === before) throw new Error('Edit makes no change');
    }
    if (Buffer.byteLength(after) > MAX_FILE_BYTES || after.includes('\0') || Buffer.from(after).toString('utf8') !== after) {
      throw new Error('New content is binary, invalid UTF-8, or exceeds the file size limit');
    }
    const change = { path, before, after, beforeHash: before === null ? null : hash(before), afterHash: hash(after) };
    const temp = join(dirname(path), `.kiln-${randomUUID()}.tmp`);
    const finishPrepared = context.prepareCheckpoint?.(change);
    if (context.prepareCheckpoint && typeof finishPrepared !== 'function') throw new Error('Checkpoint preparation must return a finalizer');
    let file;
    let failed = false;
    let failure: unknown;
    try {
      checkAbort(context.signal);
      file = await open(temp, 'wx', original?.mode ?? 0o600);
      await file.writeFile(after);
      if (original) await file.chmod(original.mode);
      await file.sync(); await file.close(); file = undefined;
      // Best effort TOCTOU defense, not a sandbox: portable Node APIs cannot pin every ancestor during rename.
      await revalidate(raw, path, context);
      if (original) {
        const current = await readText(path, context);
        if (current.ino !== original.ino || current.dev !== original.dev || hash(current.text) !== hash(original.text)) {
          throw new Error('File changed during edit; retry the operation');
        }
        await revalidate(raw, path, context);
        await rename(temp, path);
      } else {
        // A hard link publishes complete contents atomically and fails if any destination already exists.
        await link(temp, path);
      }
    } catch (error) { failed = true; failure = error; }
    finally {
      try { await file?.close(); } catch (error) { if (!failed) { failed = true; failure = error; } }
      try { await rm(temp, { force: true }); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
    if (!failed) {
      let directory;
      try {
        directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        await directory.sync();
      } catch (error) { failed = true; failure = error; }
      finally {
        try { await directory?.close(); } catch (error) { if (!failed) { failed = true; failure = error; } }
      }
    }
    // Publication and cleanup have stopped. Settle both applied and unapplied intents, even after cancellation.
    try { finishPrepared?.(); } catch (error) {
      const detail = new Error(`${failed ? `${errorMessage(failure)}\n` : 'File published. '}Checkpoint finalization failed: ${errorMessage(error)}\nIf the session remains blocked, reopen it to recover the pending checkpoint.`, { cause: failed ? failure : error });
      if (context.signal.aborted || (failure instanceof Error && failure.name === 'AbortError')) detail.name = 'AbortError';
      failed = true; failure = detail;
    }
    if (failed) throw failure;
    if (!finishPrepared) context.checkpoint(change);
    return { content: createTwoFilesPatch(path, path, context.redact(before ?? ''), context.redact(after), '', '', { context: 3 }),
      metadata: { path, beforeHash: change.beforeHash, afterHash: change.afterHash } };
  });
}

async function* walk(root: string, name: string, context: ToolContext): AsyncGenerator<string> {
  let visited = 0;
  async function loadIgnore(dir: string): Promise<Array<{ base: string; rules: Ignore }>> {
    const ignorePath = join(dir, '.gitignore');
    try {
      if ((await lstat(ignorePath)).isFile()) {
        const permitted = await context.permissions.path(ignorePath, 'read', name, context.signal);
        await revalidate(ignorePath, permitted, context);
        return [{ base: dir, rules: ignore().add((await readText(permitted, context)).text) }];
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return [];
  }
  async function* visit(dir: string, inherited: Array<{ base: string; rules: Ignore }>): AsyncGenerator<string> {
    checkAbort(context.signal);
    const permitted = await context.permissions.path(dir, 'read', name, context.signal);
    await revalidate(dir, permitted, context);
    const rules = [...inherited, ...await loadIgnore(dir)];
    await revalidate(dir, permitted, context);
    const entries = (await readdir(permitted, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      checkAbort(context.signal);
      if (++visited > 20_000) throw new Error('Traversal exceeded 20000 entries; choose a narrower path');
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink() || isProtectedPath(path) || (entry.isDirectory() && hardIgnored.has(entry.name))) continue;
      let ignored = false;
      for (const rule of rules) {
        const match = rule.rules.test(relative(rule.base, path).replaceAll('\\', '/') + (entry.isDirectory() ? '/' : ''));
        if (match.ignored) ignored = true;
        else if (match.unignored) ignored = false;
      }
      if (ignored) continue;
      if (entry.isDirectory()) yield* visit(path, rules);
      else if (entry.isFile()) yield path;
    }
  }
  const base = await canonicalPath(context.cwd, context.cwd);
  const rel = relative(base, root);
  const inherited: Array<{ base: string; rules: Ignore }> = [];
  if (rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../')) {
    let ancestor = base;
    for (const part of rel.split('/')) {
      inherited.push(...await loadIgnore(ancestor));
      ancestor = join(ancestor, part);
    }
  }
  yield* visit(root, inherited);
}

const str = { type: 'string' };
const pathSchema = { type: 'string', minLength: 1 };
const positive = { type: 'integer', minimum: 1 };
const limitSchema = { type: 'integer', minimum: 1, maximum: 1000 };

async function git(args: string[], cwd: string, context: ToolContext): ReturnType<typeof runProcess> {
  // Git's readonly operations do not need provider credentials, loader hooks, or inherited Git overrides.
  const options = {
    cwd, signal: context.signal, timeoutMs: 30_000,
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1', GIT_NO_LAZY_FETCH: '1' },
  };
  const flags = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.attributesFile=/dev/null', '-c', 'diff.external=', '-c', 'credential.helper=', '-c', 'protocol.allow=never'];
  if (args[0] === 'status' || args[0] === 'diff') {
    // Includes and conditional includes must be enumerated too. Never cache drivers between operations.
    const config = await runProcess('git', [...flags, 'config', '--includes', '--null', '--name-only', '--get-regexp', '^filter\\.'], options);
    if (config.code !== 0 && config.code !== 1) throw new Error(`Cannot inspect Git filters: ${config.stderr}`);
    if (config.stdout && !config.stdout.endsWith('\0')) throw new Error('Git filter enumeration was truncated or malformed');
    const drivers = new Set<string>();
    for (const key of config.stdout.split('\0').filter(Boolean)) {
      const match = /^filter\.(.+)\.[a-zA-Z][a-zA-Z0-9-]*$/.exec(key);
      if (!match || /[=\r\n\0]/.test(match[1]!)) throw new Error('Cannot safely override Git filter configuration');
      drivers.add(match[1]!);
    }
    if (drivers.size > 1000) throw new Error('Too many Git filter drivers to safely override');
    for (const driver of drivers) for (const setting of ['clean=', 'process=', 'smudge=', 'required=false']) {
      flags.push('-c', `filter.${driver}.${setting}`);
    }
  }
  return runProcess('git', [...flags, ...args], options);
}

async function gitCwd(raw: string, name: string, context: ToolContext): Promise<{ cwd: string; root: string }> {
  const cwd = await context.permissions.path(raw, 'read', name, context.signal);
  await revalidate(raw, cwd, context);
  const info = await git(['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'], cwd, context);
  if (info.code !== 0) throw new Error(info.stderr || 'Not a Git worktree');
  const paths = info.stdout.replace(/\n$/, '').split('\n');
  if (paths.length !== 3 || paths.some(path => !isAbsolute(path))) throw new Error('Cannot safely determine Git worktree paths');
  const root = await canonicalPath(paths[0]!, cwd);
  const rel = relative(root, cwd);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('Git worktree does not contain the requested cwd; use its actual directory');
  // Linked worktrees and gitdir symlinks can put the index and historical content outside the workspace.
  for (const rawPath of new Set(paths.slice(1))) {
    const path = await context.permissions.path(rawPath, 'read', name, context.signal);
    await revalidate(rawPath, path, context);
  }
  await revalidate(raw, cwd, context);
  return { cwd, root };
}

export function createBuiltinTools(): Tool[] {
  return [
    tool('read_file', 'Read a UTF-8 text file, with optional inclusive 1-based start_line/end_line. Binary files and files over 2 MiB are rejected.', true,
      { path: pathSchema, start_line: positive, end_line: positive }, ['path'], async (args, context) => {
        const start = numberArg(args, 'start_line', 1);
        const end = numberArg(args, 'end_line', Number.MAX_SAFE_INTEGER);
        if (end < start) throw new Error('end_line must be at least start_line');
        const raw = stringArg(args, 'path');
        const path = await context.permissions.path(raw, 'read', 'read_file', context.signal);
        await revalidate(raw, path, context);
        const { text } = await readText(path, context);
        const lines = context.redact(text).split('\n');
        if (lines.at(-1) === '') lines.pop();
        return { content: lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line.replace(/\r$/, '')}`).join('\n'), metadata: { path, totalLines: lines.length } };
      }),
    tool('read_output', 'Read a UTF-8-aligned byte range from a redacted .txt artifact directly in the trusted state output directory, including files over 2 MiB. offset is zero-based in the redacted stream; use nextOffset to continue.', true,
      { path: pathSchema, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 24000 } }, ['path'], async (args, context) => {
        const offset = args.offset === undefined ? 0 : args.offset;
        if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a nonnegative integer');
        const limit = numberArg(args, 'limit', 24000, 24000);
        if (!Number.isSafeInteger(offset + limit)) throw new Error('Requested byte range is too large');
        const path = await canonicalOutputPath(stringArg(args, 'path'), context.cwd, context.stateDir);
        if (await context.permissions.path(path, 'read', 'read_output', context.signal) !== path) throw new Error('Output path changed during authorization');
        await canonicalOutputPath(path, context.cwd, context.stateDir);
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.nlink !== 1) throw new Error('Output must be a regular file with one link');
          const decoder = new TextDecoder('utf-8', { fatal: true });
          const redact = outputRedactor(context);
          const buffer = Buffer.alloc(64 * 1024);
          const selected: Buffer[] = [];
          let seen = 0;
          let bytes = 0;
          let hasMore = false;
          while (!hasMore) {
            checkAbort(context.signal);
            const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
            const decoded = decoder.decode(buffer.subarray(0, bytesRead), { stream: bytesRead !== 0 });
            const clean = Buffer.from(redact(decoded, bytesRead === 0));
            const start = Math.max(0, offset - seen);
            const end = Math.min(clean.length, offset + limit - seen);
            if (end > start) { selected.push(clean.subarray(start, end)); bytes += end - start; }
            seen += clean.length;
            hasMore = seen > offset + limit;
            if (!bytesRead) break;
          }
          const data = Buffer.concat(selected);
          let start = 0;
          let end = bytes;
          while (start < end && (data[start]! & 0xc0) === 0x80) start++;
          if (hasMore && end > start) {
            let lead = end - 1;
            while (lead > start && (data[lead]! & 0xc0) === 0x80) lead--;
            const byte = data[lead]!;
            const width = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
            if (lead + width > end) end = lead;
          }
          if (bytes && end <= start && hasMore) throw new Error('limit is too small for a complete UTF-8 character; increase it');
          return { content: data.subarray(start, end).toString('utf8'), metadata: { path, offset: offset + start, nextOffset: offset + end, hasMore } };
        } finally { await file.close(); }
      }),
    tool('list_directory', 'List directory entries without following symbolic links. At most 1000 entries.', true,
      { path: pathSchema }, [], async (args, context) => {
        const raw = stringArg(args, 'path', '.');
        const path = await context.permissions.path(raw, 'read', 'list_directory', context.signal);
        await revalidate(raw, path, context);
        const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
        return { content: entries.slice(0, 1000).map(entry => `${entry.name}${entry.isDirectory() ? '/' : entry.isSymbolicLink() ? '@' : ''}`).join('\n') +
          (entries.length > 1000 ? '\n[Entry limit reached; narrow the directory]' : '') };
      }),
    tool('find_files', 'Find files by a relative glob. Respects nested .gitignore files, skips secret paths, symlinks and generated/dependency directories.', true,
      { pattern: pathSchema, path: pathSchema, limit: limitSchema }, ['pattern'], async (args, context) => {
        const pattern = stringArg(args, 'pattern');
        if (pattern.length > 512 || isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) throw new Error('pattern must be a relative glob without traversal, at most 512 characters');
        const root = await context.permissions.path(stringArg(args, 'path', '.'), 'read', 'find_files', context.signal);
        const limit = numberArg(args, 'limit', 100, 1000);
        const found: string[] = [];
        for await (const path of walk(root, 'find_files', context)) {
          const rel = relative(root, path).replaceAll('\\', '/');
          if (!minimatch(rel, pattern, { dot: true, matchBase: true, noext: true, nobrace: true, nonegate: true, nocomment: true })) continue;
          await context.permissions.path(path, 'read', 'find_files', context.signal);
          found.push(rel);
          if (found.length >= limit) break;
        }
        return { content: found.join('\n') + (found.length >= limit ? '\n[Result limit reached]' : '') };
      }),
    tool('search', 'Search text literally (not regex). Returns path:line:excerpt, with at most 1000 matches; respects .gitignore and skips protected/binary/large files.', true,
      { query: pathSchema, path: pathSchema, include: pathSchema, case_sensitive: { type: 'boolean' }, limit: limitSchema }, ['query'], async (args, context) => {
        const query = stringArg(args, 'query');
        if (!query || query.length > 4096 || /[\r\n]/.test(query)) throw new Error('query must be a nonempty single line, at most 4096 characters');
        if (args.case_sensitive !== undefined && typeof args.case_sensitive !== 'boolean') throw new Error('case_sensitive must be a boolean');
        const sensitive = args.case_sensitive !== false;
        const needle = sensitive ? query : query.toLowerCase();
        const include = stringArg(args, 'include', '**');
        if (include.length > 512) throw new Error('include is too long');
        const root = await context.permissions.path(stringArg(args, 'path', '.'), 'read', 'search', context.signal);
        const limit = numberArg(args, 'limit', 100, 1000);
        const found: string[] = [];
        let foundBytes = 0;
        let limited = false;
        search: for await (const path of walk(root, 'search', context)) {
          const rel = relative(root, path).replaceAll('\\', '/');
          if (!minimatch(rel, include, { dot: true, matchBase: true, noext: true, nobrace: true, nonegate: true, nocomment: true })) continue;
          const permitted = await context.permissions.path(path, 'read', 'search', context.signal);
          let text: string;
          try { text = (await readText(permitted, context)).text; } catch (error) {
            if (/^(?:Binary|File exceeds)/.test(errorMessage(error))) continue;
            throw error;
          }
          for (const [index, line] of context.redact(text).split('\n').entries()) {
            if ((sensitive ? line : line.toLowerCase()).includes(needle)) {
              const match = `${rel}:${index + 1}:${line}`;
              foundBytes += Buffer.byteLength(match);
              if (foundBytes > MAX_PROCESS_BYTES) { limited = true; break search; }
              found.push(match);
            }
            if (found.length >= limit) break;
          }
          if (found.length >= limit) break;
        }
        return { content: found.join('\n') + (limited || found.length >= limit ? '\n[Result/byte limit reached]' : '') };
      }),
    tool('create_file', 'Atomically create a UTF-8 file without overwriting an existing destination. Parent directory must exist.', false,
      { path: pathSchema, content: str }, ['path', 'content'], (args, context) => mutate(args, context, true)),
    tool('edit_file', 'Replace exactly one occurrence of old_string with new_string. Rejects ambiguous edits, preserves CRLF and emits a checkpoint and diff.', false,
      { path: pathSchema, old_string: { type: 'string', minLength: 1 }, new_string: str }, ['path', 'old_string', 'new_string'], (args, context) => mutate(args, context, false)),
    tool('shell', 'Run an explicitly approved command using $SHELL -c (no login shell). Streams redacted output and saves complete stdout/stderr artifacts, including on abort or failure. Returns bounded previews; use read_output for recovery.', false,
      { command: pathSchema, cwd: pathSchema, timeout_ms: { ...positive, maximum: 600_000 } }, ['command'], async (args, context) => {
        const command = stringArg(args, 'command');
        if (!command.trim() || command.includes('\0')) throw new Error('command must not be empty or contain NUL');
        const rawCwd = stringArg(args, 'cwd', context.cwd);
        const cwd = await context.permissions.path(rawCwd, 'read', 'shell', context.signal);
        // Advisory recognition only, not a shell parser or sandbox. Every command still goes through authorization.
        const start = String.raw`(?:^|[;&|\n])\s*(?:(?:sudo|doas|command|exec|env)(?:\s+-\S+)*\s+|[A-Za-z_]\w*=\S+\s+)*(?:[^\s;&|]*\/)?`;
        const git = String.raw`${start}git\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+|--(?!git-dir\s|work-tree\s)\S+\s+)*`;
        const warnings: string[] = [];
        if (new RegExp(String.raw`${start}(?:rm|rmdir|unlink|shred|truncate|wipefs|mkfs(?:\.[\w-]+)?|dd)(?=\s|$)|${git}(?:clean\b|restore\b|reset\b[^;&|\n]*--hard\b|checkout\b[^;&|\n]*(?:--force\b|\s-f\b|\s--\s)|push\b[^;&|\n]*(?:--force(?:-with-lease)?\b|\s-f\b))`).test(command) || /(^|[^>])>(?![>&])/.test(command)) {
          warnings.push('potentially destructive operation (data deletion or overwrite)');
        }
        if (new RegExp(String.raw`${start}(?:curl|wget|ssh|scp|sftp|rsync)(?=\s|$)|${start}(?:npm|pnpm|yarn)\s+[^;&|\n]*\b(?:install|i|ci|add)\b|${start}(?:python[\d.]*\s+-m\s+)?pip[\d.]*\s+[^;&|\n]*\binstall\b|${git}(?:push|fetch|pull|clone|ls-remote)\b`).test(command)) {
          warnings.push('network-sensitive operation (network access, remote changes, or downloaded code)');
        }
        const reason = `${warnings.length ? `Warning: ${warnings.join('; ')}. Advisory risk labels are not a sandbox.\n` : ''}Run exact command in ${cwd}: ${command}`;
        await context.permissions.authorize({ action: 'shell', tool: 'shell', resource: command, command, cwd, reason }, context.signal);
        await revalidate(rawCwd, cwd, context);
        const timeoutMs = numberArg(args, 'timeout_ms', 120_000, 600_000);
        const directory = join(await canonicalPath(context.stateDir, context.cwd), 'outputs');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await revalidate(directory, directory, context);
        const id = randomUUID();
        const paths = { stdout: join(directory, `${id}-stdout.txt`), stderr: join(directory, `${id}-stderr.txt`) };
        const files: Partial<Record<'stdout' | 'stderr', Awaited<ReturnType<typeof open>>>> = {};
        const redactors = { stdout: outputRedactor(context), stderr: outputRedactor(context) };
        const preview = { stdout: '', stderr: '' };
        const truncated = { stdout: false, stderr: false };
        const bytes = { stdout: 0, stderr: 0 };
        let result: Awaited<ReturnType<typeof runProcess>> | undefined;
        let failure: unknown;
        let complete = true;
        const consume = async (text: string, stream: 'stdout' | 'stderr', final = false) => {
          const clean = redactors[stream](text, final);
          if (!clean) return;
          try { await files[stream]!.writeFile(clean); }
          catch (error) { complete = false; throw error; }
          bytes[stream] += Buffer.byteLength(clean);
          const cut = truncate(preview[stream] + clean, 100, 8000);
          preview[stream] = cut.text;
          truncated[stream] ||= cut.truncated;
          try { context.emit('tool.output', redactValue({ tool: 'shell', stream, text: clean, bytes: bytes[stream] }, context.redact)); }
          catch (error) { complete = false; throw error; }
        };
        try {
          for (const stream of ['stdout', 'stderr'] as const) files[stream] = await open(paths[stream], 'wx', 0o600);
          result = await runProcess(process.env.SHELL || '/bin/sh', ['-c', command], { cwd, signal: context.signal, timeoutMs, onOutput: consume });
        } catch (error) { failure = error; }
        finally {
          for (const stream of ['stdout', 'stderr'] as const) {
            const file = files[stream];
            if (!file) { complete = false; continue; }
            try { await consume('', stream, true); await file.sync(); }
            catch (error) { failure ??= error; complete = false; }
            finally { await file.close().catch(error => { failure ??= error; complete = false; }); }
          }
          try {
            const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            try { await dir.sync(); } finally { await dir.close(); }
          } catch (error) { failure ??= error; complete = false; }
          const savedPaths = Object.fromEntries(Object.keys(files).map(stream => [stream, paths[stream as keyof typeof paths]]));
          context.emit('tool.output_saved', redactValue({ tool: 'shell', outputPaths: savedPaths, bytes, complete,
            status: context.signal.aborted ? 'aborted' : failure || result?.code !== 0 ? 'error' : 'success' }, context.redact));
        }
        if (context.signal.aborted) throw abortError();
        if (failure || !result) {
          if (context.signal.aborted || (failure instanceof Error && failure.name === 'AbortError')) throw abortError();
          throw new Error(`${errorMessage(failure)}\nRedacted output artifacts: ${paths.stdout}, ${paths.stderr}`);
        }
        return { content: `Exit code: ${result.code}${result.signal ? ` (${result.signal})` : ''}\nstdout:\n${preview.stdout}${truncated.stdout ? '\n[Preview truncated]' : ''}\nstderr:\n${preview.stderr}${truncated.stderr ? '\n[Preview truncated]' : ''}\n\nComplete redacted stdout: ${paths.stdout}\nComplete redacted stderr: ${paths.stderr}`,
          isError: result.code !== 0, metadata: { code: result.code, signal: result.signal, outputPaths: paths } };
      }),
    tool('git_status', 'Read Git status, branch and repository root using structured argv, without executable filters, optional index locks, hooks or fsmonitor.', true,
      { path: pathSchema }, [], async (args, context) => {
        const { cwd, root } = await gitCwd(stringArg(args, 'path', '.'), 'git_status', context);
        const head = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, context);
        if (head.code !== 0 && head.code !== 1) throw new Error(head.stderr || 'Cannot determine Git branch');
        const branch = head.code === 0 ? head.stdout.replace(/\n$/, '') : null;
        await revalidate(cwd, cwd, context);
        const result = await git(['status', '--branch', '--porcelain=v1', '--untracked-files=normal', '--ignore-submodules=all', '--', '.'], cwd, context);
        return { content: `Repository root: ${root}\n${result.stdout}${result.stderr}`, isError: result.code !== 0, metadata: { code: result.code, root, branch } };
      }),
    tool('git_diff', 'Read working-tree or staged diff after authorizing each changed path. Executable filters, external diff, textconv, submodule diff and fsmonitor are disabled.', true,
      { path: pathSchema, staged: { type: 'boolean' } }, [], async (args, context) => {
        if (args.staged !== undefined && typeof args.staged !== 'boolean') throw new Error('staged must be a boolean');
        const { cwd } = await gitCwd(stringArg(args, 'path', '.'), 'git_diff', context);
        const flags = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=all', '--relative', ...(args.staged ? ['--cached'] : [])];
        const names = await git([...flags, '--name-only', '-z', '--', '.'], cwd, context);
        if (names.code !== 0) return { content: names.stderr, isError: true };
        if (names.stdout && !names.stdout.endsWith('\0')) throw new Error('Too many changed paths; narrow the diff path');
        const paths = names.stdout.split('\0').filter(Boolean);
        if (!paths.length) return { content: '' };
        const approved: Array<{ raw: string; path: string }> = [];
        for (const name of paths) {
          const raw = resolve(cwd, name);
          const path = await context.permissions.path(raw, 'read', 'git_diff', context.signal);
          approved.push({ raw, path });
        }
        for (const { raw, path } of approved) await revalidate(raw, path, context);
        await revalidate(cwd, cwd, context);
        const result = await git([...flags, '--', ...paths], cwd, context);
        return { content: result.stdout + result.stderr, isError: result.code !== 0, metadata: { code: result.code } };
      }),
  ];
}
