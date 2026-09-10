import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import type { Emit, PermissionRequest, ProcessServerConfig, ToolContext } from '../src/types.js';

export async function workspace(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'kiln-hosts-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

export function fixture(config: Record<string, unknown> = {}): ProcessServerConfig {
  return { name: 'fixture', command: process.execPath, args: [resolve('test/fixtures/rpc-server.mjs'), JSON.stringify(config)] };
}

export function capture(): { emit: Emit; events: { type: string; data: Record<string, unknown> }[] } {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  return { events, emit: (type, data = {}) => { events.push({ type, data }); } };
}

export function context(cwd: string, signal: AbortSignal = new AbortController().signal): ToolContext & { authorized: Omit<PermissionRequest, 'id'>[] } {
  const authorized: Omit<PermissionRequest, 'id'>[] = [];
  return { cwd, stateDir: cwd, mode: 'build', signal, emit: () => {}, checkpoint: () => {}, redact: value => value, authorized,
    permissions: { authorize: async request => { authorized.push(request); }, path: async path => resolve(cwd, path) } };
}

export async function until(predicate: () => boolean | Promise<boolean>, message = 'condition did not become true'): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

export async function messages(path: string): Promise<Record<string, unknown>[]> {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
