import { randomUUID } from 'node:crypto';
import { lstat, readlink, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { minimatch } from 'minimatch';
import type { Emit, Mode, PermissionAnswer, PermissionGate, PermissionPrompt, PermissionRequest } from './types.js';
import { abortError, checkAbort } from './util.js';

export interface PermissionRule {
  action: PermissionRequest['action'];
  tool: string;
  pattern: string;
}

/** Resolve existing paths, or the nearest existing ancestor of a new path, including dangling links. */
export async function canonicalPath(path: string, cwd: string): Promise<string> {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error('Invalid path');
  async function canonical(candidate: string, links = 0): Promise<string> {
    if (links > 40) throw new Error('Too many symbolic links');
    try { return await realpath(candidate); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      if ((await lstat(candidate)).isSymbolicLink()) {
        return canonical(resolve(dirname(candidate), await readlink(candidate)), links + 1);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error(`Cannot resolve path: ${candidate}`);
    return resolve(await canonical(parent, links), basename(candidate));
  }
  return canonical(resolve(cwd, path));
}

export function isProtectedPath(path: string): boolean {
  const parts = path.replaceAll('\\', '/').toLowerCase().split('/');
  return parts.some((part, index) =>
    (part === 'config.json' && parts[index - 1] === '.kiln') ||
    /^\.env(?:$|[.\-])/.test(part) ||
    ['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.netrc', '.npmrc', '.pypirc', '.git-credentials',
      '.envrc', '.vault-token', '.bash_history', '.zsh_history', 'kubeconfig'].includes(part) ||
    /^(?:credentials?|secrets?)(?:$|[._-])/.test(part) ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)(?:$|\.)/.test(part) ||
    /\.(?:pem|key|p12|pfx|keystore)$/.test(part));
}

function within(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

export async function canonicalOutputPath(path: string, cwd: string, stateDir: string): Promise<string> {
  const directory = join(await canonicalPath(stateDir, cwd), 'outputs');
  const raw = resolve(cwd, path);
  const canonical = await canonicalPath(raw, cwd);
  if (await canonicalPath(directory, cwd) !== directory || raw !== canonical || dirname(canonical) !== directory ||
      !canonical.endsWith('.txt') || isProtectedPath(basename(canonical))) {
    throw new Error('read_output only accepts non-symlink .txt files directly in stateDir/outputs');
  }
  const stat = await lstat(canonical);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Output must be a regular file with one link');
  return canonical;
}

export class PermissionManager implements PermissionGate {
  private readonly options: {
    cwd: string; mode: Mode; prompt?: PermissionPrompt; emit: Emit; rules?: PermissionRule[]; stateDir?: string; protectedPaths?: string[];
  };
  private readonly sessions = new Set<string>();
  private readonly remembered: Array<PermissionRule & { cwd: string }> = [];
  private readonly root: Promise<string>;
  private readonly stateRoot?: Promise<string>;
  private readonly protectedRefs: Promise<Array<{ path: string; canonical: string }>>;

  constructor(options: {
    cwd: string; mode: Mode; prompt?: PermissionPrompt; emit: Emit; rules?: PermissionRule[]; stateDir?: string; protectedPaths?: string[];
  }) {
    this.options = { ...options, cwd: resolve(options.cwd), rules: options.rules?.map(rule => ({ ...rule })), protectedPaths: options.protectedPaths?.slice() };
    this.root = canonicalPath(this.options.cwd, this.options.cwd);
    // Initialization errors still propagate from authorize, without an unhandled rejection before first use.
    void this.root.catch(() => {});
    this.protectedRefs = Promise.all((this.options.protectedPaths ?? []).map(async path => ({
      path: resolve(this.options.cwd, path), canonical: await canonicalPath(path, this.options.cwd),
    })));
    void this.protectedRefs.catch(() => {});
    if (options.stateDir) {
      this.stateRoot = canonicalPath(options.stateDir, this.options.cwd);
      void this.stateRoot.catch(() => {});
    }
  }

  private async protectedPath(raw: string, canonical: string, includeState = true): Promise<boolean> {
    if (isProtectedPath(raw) || isProtectedPath(canonical)) return true;
    for (const ref of await this.protectedRefs) {
      // Keep the initial target protected, and also protect replacements at the registered config location.
      if (raw === ref.path || canonical === ref.canonical || canonical === await canonicalPath(ref.path, this.options.cwd)) return true;
    }
    if (includeState && this.stateRoot) {
      const state = await this.stateRoot;
      const rawState = resolve(this.options.cwd, this.options.stateDir!);
      return within(raw, rawState) || within(canonical, state) || within(canonical, await canonicalPath(rawState, this.options.cwd));
    }
    return false;
  }

  async path(path: string, action: 'read' | 'write', tool: string, signal: AbortSignal): Promise<string> {
    checkAbort(signal);
    if (action === 'write' && this.options.mode === 'plan') throw new Error('Writes are unavailable in plan mode');
    const canonical = await canonicalPath(path, this.options.cwd);
    if (tool === 'read_output' && this.stateRoot) {
      await canonicalOutputPath(path, this.options.cwd, await this.stateRoot);
    }
    const raw = resolve(this.options.cwd, path);
    const protectedAlias = tool !== 'read_output' && (isProtectedPath(raw) || (raw !== canonical && await this.protectedPath(raw, canonical)));
    await this.authorize({
      tool, action: protectedAlias ? 'secret' : action,
      resource: canonical, cwd: this.options.cwd, reason: `${action} ${canonical}`,
    }, signal);
    return canonical;
  }

  // Patterns are scoped to one tool, action, and canonical cwd. No global or executable-wide grants.
  private async pattern(rule: PermissionRule, cwd: string): Promise<string | undefined> {
    if (!rule.tool || /[*?\[\]{}!]/.test(rule.tool) || !rule.pattern || rule.action === 'secret') return;
    if (rule.action === 'shell') {
      if (!/[*?\[\]{}]/.test(rule.pattern)) return rule.pattern;
      if (!/^[^*?\[\]{};&|`$<>\r\n]+ \*$/.test(rule.pattern)) return;
      if (rule.pattern.slice(0, -2).trim().split(/\s+/).length < 2) return;
      return rule.pattern;
    }
    if (rule.action !== 'read' && rule.action !== 'write') {
      return /[*?\[\]{}!\\\r\n]/.test(rule.pattern) ? undefined : rule.pattern;
    }
    if (/[?\[\]{}!\\\r\n]/.test(rule.pattern)) return;
    const firstStar = rule.pattern.indexOf('*');
    if (firstStar < 0) {
      const path = await canonicalPath(rule.pattern, cwd);
      return /[*?\[\]{}!\\]/.test(path) ? undefined : path;
    }
    const slash = rule.pattern.lastIndexOf('/', firstStar);
    const base = await canonicalPath(slash < 0 ? '.' : rule.pattern.slice(0, slash) || '/', cwd);
    if (/[*?\[\]{}!\\]/.test(base)) return;
    const suffix = rule.pattern.slice(slash + 1);
    if (suffix.split('/').includes('..') || suffix.split('/').includes('.')) return;
    if ((base === cwd || dirname(base) === base) && /^(?:\*\*?\/?)+$/.test(suffix)) return;
    if (!within(base, cwd)) return;
    return `${base}/${suffix}`;
  }

  async authorize(input: Omit<PermissionRequest, 'id'>, signal: AbortSignal): Promise<void> {
    checkAbort(signal);
    if (this.options.mode === 'plan' && (input.action === 'write' || input.action === 'shell')) {
      throw new Error(`${input.action === 'shell' ? 'Shell' : 'Writes'} are unavailable in plan mode`);
    }
    const root = await this.root;
    const cwd = await canonicalPath(input.cwd, root);
    const pathAction = input.action === 'read' || input.action === 'write' || input.action === 'secret';
    const resource = pathAction ? await canonicalPath(input.resource, cwd) : input.command ?? input.resource;
    const secret = input.action === 'secret' || (pathAction && await this.protectedPath(resolve(cwd, input.resource), resource, input.tool !== 'read_output'));
    const request: PermissionRequest = { ...input, id: randomUUID(), cwd, resource };
    if (input.action === 'shell') request.command = resource;
    const key = JSON.stringify([request.action, request.tool, cwd, resource]);
    checkAbort(signal);
    if (request.tool === 'read_output' && this.stateRoot) {
      if (request.action !== 'read') throw new Error('read_output is read-only');
      const state = await this.stateRoot;
      if (await canonicalPath(state, cwd) !== state) throw new Error('State directory changed after initialization');
      await canonicalOutputPath(input.resource, cwd, state);
      checkAbort(signal);
      if (!secret) return;
    }
    if (!secret) {
      if (request.action === 'read' && within(resource, root)) return;
      if (this.sessions.has(key)) return;
      const rules = [...(this.options.rules ?? []).map(rule => ({ ...rule, cwd: root })), ...this.remembered];
      for (const rule of rules) {
        if (rule.action !== request.action || rule.tool !== request.tool || rule.cwd !== cwd) continue;
        const pattern = await this.pattern(rule, rule.cwd);
        if (!pattern) continue;
        checkAbort(signal);
        if (pattern === resource) return;
        if (request.action === 'shell') {
          if (pattern.endsWith(' *') && !/[;&|`$<>\r\n]/.test(resource) && resource.startsWith(pattern.slice(0, -1))) return;
        } else if (minimatch(resource, pattern, { dot: true, noext: true, nobrace: true, nonegate: true, nocomment: true })) {
          return;
        }
      }
    }
    checkAbort(signal);
    if (!this.options.prompt) throw new Error(`Permission denied${secret ? ' for protected path' : ''}: ${resource}`);
    this.options.emit('permission.request', { request, secret });
    let cancel = () => {};
    const answer = await new Promise<PermissionAnswer>((resolveAnswer, reject) => {
      cancel = () => reject(abortError());
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      else Promise.resolve().then(() => {
        checkAbort(signal);
        return this.options.prompt!(request, signal);
      }).then(resolveAnswer, reject);
    }).finally(() => signal.removeEventListener('abort', cancel));
    checkAbort(signal);
    this.options.emit('permission.decision', { requestId: request.id, ...answer });
    if (secret && answer.decision !== 'once') throw new Error('Protected paths require explicit one-time approval');
    if (answer.decision === 'once') return;
    if (answer.decision === 'session') { this.sessions.add(key); return; }
    if (answer.decision === 'pattern') {
      const rule = { action: request.action, tool: request.tool, pattern: answer.pattern ?? '', cwd };
      const pattern = await this.pattern(rule, cwd);
      checkAbort(signal);
      const matches = pattern === resource || (pattern && (request.action === 'shell'
        ? pattern.endsWith(' *') && !/[;&|`$<>\r\n]/.test(resource) && resource.startsWith(pattern.slice(0, -1))
        : minimatch(resource, pattern, { dot: true, noext: true, nobrace: true, nonegate: true, nocomment: true })));
      if (!matches) throw new Error('Permission denied: pattern must be narrow and match this request');
      this.remembered.push({ ...rule, pattern: pattern! });
      return;
    }
    throw new Error(`Permission denied: ${resource}`);
  }
}
