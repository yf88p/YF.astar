import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';
import { canonicalPath, isProtectedPath, PermissionManager } from '../src/permissions.js';
import type { PermissionAnswer, PermissionRequest } from '../src/types.js';

const signal = () => new AbortController().signal;

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'kiln-permissions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'project');
  const outside = join(root, 'project-other');
  await mkdir(cwd); await mkdir(outside); await mkdir(join(cwd, 'src'));
  const requests: PermissionRequest[] = [];
  const events: Array<{ type: string; data: unknown }> = [];
  const options = {
    cwd, mode: 'build' as const,
    emit: (type: string, data?: Record<string, unknown>) => { events.push({ type, data }); },
    prompt: async (request: PermissionRequest): Promise<PermissionAnswer> => { requests.push(request); return { decision: 'once' }; },
  };
  return { root, cwd, outside, requests, events, options };
}

test('canonicalPath resolves existing, new, aliased and dangling-link paths', async t => {
  const { cwd, outside } = await fixture(t);
  await writeFile(join(outside, 'file.txt'), 'outside');
  await symlink(outside, join(cwd, 'alias'));
  await symlink(join(outside, 'future'), join(cwd, 'dangling'));
  assert.equal(await canonicalPath('alias/file.txt', cwd), await realpath(join(outside, 'file.txt')));
  assert.equal(await canonicalPath('alias/new/deep.txt', cwd), join(outside, 'new/deep.txt'));
  assert.equal(await canonicalPath('dangling/deep.txt', cwd), join(outside, 'future/deep.txt'));
  assert.equal(await canonicalPath('../project-other/file.txt', cwd), join(outside, 'file.txt'));
  await assert.rejects(canonicalPath('alias/file.txt/child', cwd), /ENOTDIR/);
  await assert.rejects(canonicalPath('', cwd), /Invalid path/);
  await assert.rejects(canonicalPath('bad\0path', cwd), /Invalid path/);
  await symlink('loop', join(cwd, 'loop'));
  await assert.rejects(canonicalPath('loop', cwd), /ELOOP|symbolic links/);
});

test('in-scope reads are automatic; traversal, sibling-prefix and symlink escapes ask', async t => {
  const { cwd, outside, requests, options } = await fixture(t);
  const gate = new PermissionManager(options);
  await gate.path('src/new.txt', 'read', 'read_file', signal());
  assert.equal(requests.length, 0);
  await gate.path('../project-other/new.txt', 'read', 'read_file', signal());
  await symlink(outside, join(cwd, 'alias'));
  await gate.path('alias/new.txt', 'read', 'read_file', signal());
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.resource, join(outside, 'new.txt'));
  assert.equal(requests[1]!.resource, join(outside, 'new.txt'));
});

test('workspace scope stays bound to its initial canonical directory when an alias moves', async t => {
  const { root, cwd, outside, options } = await fixture(t);
  const alias = join(root, 'workspace');
  await symlink(cwd, alias);
  const gate = new PermissionManager({ ...options, cwd: alias, prompt: undefined });
  await gate.path('file', 'read', 'read_file', signal());
  await rm(alias); await symlink(outside, alias);
  await assert.rejects(gate.path('file', 'read', 'read_file', signal()), /Permission denied/);
});

test('relative constructor cwd is resolved once against the process directory', async t => {
  const { cwd, options } = await fixture(t);
  const gate = new PermissionManager({ ...options, cwd: relative(process.cwd(), cwd), prompt: undefined });
  assert.equal(await gate.path('file', 'read', 'read_file', signal()), join(cwd, 'file'));
});

test('state access is limited to read_output regular .txt artifacts, not configuration or other tools', async t => {
  const { root, options } = await fixture(t);
  const stateDir = join(root, 'state');
  await mkdir(join(stateDir, 'outputs'), { recursive: true });
  const output = join(stateDir, 'outputs', 'result.txt');
  const config = join(stateDir, 'config.txt');
  await writeFile(output, 'redacted result'); await writeFile(config, 'synthetic private configuration');
  const gate = new PermissionManager({ ...options, stateDir, prompt: undefined });
  assert.equal(await gate.path(output, 'read', 'read_output', signal()), output);
  await assert.rejects(gate.path(config, 'read', 'read_output', signal()), /read_output/);
  await assert.rejects(gate.path(output, 'read', 'read_file', signal()), /Permission denied/);
  await assert.rejects(gate.path(output, 'write', 'read_output', signal()), /read-only/);
  await symlink(config, join(stateDir, 'outputs', 'alias.txt'));
  await assert.rejects(gate.path(join(stateDir, 'outputs', 'alias.txt'), 'read', 'read_output', signal()), /read_output/);
  await mkdir(join(stateDir, 'outputs', 'directory.txt'));
  await assert.rejects(gate.path(join(stateDir, 'outputs', 'directory.txt'), 'read', 'read_output', signal()), /regular file/);
});

test('state files inside the workspace remain protected despite read/write rules, except validated read_output', async t => {
  const { cwd, options, requests } = await fixture(t);
  const stateDir = join(cwd, 'runtime-state');
  await mkdir(join(stateDir, 'outputs'), { recursive: true });
  for (const path of ['config.json', 'session-export.txt', 'sessions.sqlite', 'outputs/result.txt']) {
    await writeFile(join(stateDir, path), 'synthetic private state');
  }
  await symlink(join(stateDir, 'session-export.txt'), join(cwd, 'export-alias'));
  const rules = [
    { action: 'read' as const, tool: 'read_file', pattern: 'runtime-state/**' },
    { action: 'write' as const, tool: 'edit_file', pattern: 'runtime-state/**' },
  ];
  const gate = new PermissionManager({ ...options, stateDir, rules, prompt: undefined });
  for (const path of ['config.json', 'session-export.txt', 'sessions.sqlite', 'outputs/result.txt']) {
    await assert.rejects(gate.path(join(stateDir, path), 'read', 'read_file', signal()), /Permission denied.*protected/);
    await assert.rejects(gate.path(join(stateDir, path), 'write', 'edit_file', signal()), /Permission denied.*protected/);
  }
  await assert.rejects(gate.path(stateDir, 'read', 'list_directory', signal()), /Permission denied.*protected/);
  await assert.rejects(gate.path('export-alias', 'read', 'read_file', signal()), /Permission denied.*protected/);
  const output = join(stateDir, 'outputs', 'result.txt');
  assert.equal(await gate.path(output, 'read', 'read_output', signal()), output);
  assert.equal(await gate.path('src/code.ts', 'read', 'read_file', signal()), join(cwd, 'src/code.ts'));
  let decision: PermissionAnswer['decision'] = 'session';
  const interactive = new PermissionManager({ ...options, stateDir, rules, prompt: async request => { requests.push(request); return { decision }; } });
  await assert.rejects(interactive.path('runtime-state/session-export.txt', 'read', 'read_file', signal()), /one-time/);
  decision = 'once';
  await interactive.path('runtime-state/session-export.txt', 'read', 'read_file', signal());
  await interactive.path('runtime-state/session-export.txt', 'read', 'read_file', signal());
  assert.equal(requests.length, 3);
});

test('explicit protected paths are copied and canonical, overriding workspace scope and narrow rules', async t => {
  const { cwd, options, requests } = await fixture(t);
  await mkdir(join(cwd, 'preferences'));
  const target = join(cwd, 'preferences', 'custom-settings.data');
  await writeFile(target, 'synthetic inline credentials');
  await writeFile(join(cwd, 'config.json'), '{}');
  await symlink(target, join(cwd, 'settings-alias'));
  const protectedPaths = ['preferences/custom-settings.data'];
  const rules = [
    { action: 'read' as const, tool: 'read_file', pattern: 'preferences/*' },
    { action: 'write' as const, tool: 'edit_file', pattern: 'preferences/*' },
  ];
  const gate = new PermissionManager({ ...options, protectedPaths, rules, prompt: undefined });
  protectedPaths[0] = 'config.json';
  protectedPaths.push('src/code.ts');
  for (const path of [target, 'settings-alias']) {
    await assert.rejects(gate.path(path, 'read', 'read_file', signal()), /Permission denied.*protected/);
    await assert.rejects(gate.path(path, 'write', 'edit_file', signal()), /Permission denied.*protected/);
  }
  assert.equal(await gate.path('config.json', 'read', 'read_file', signal()), join(cwd, 'config.json'));
  assert.equal(await gate.path('src/code.ts', 'read', 'read_file', signal()), join(cwd, 'src/code.ts'));
  let decision: PermissionAnswer['decision'] = 'session';
  const interactive = new PermissionManager({ ...options, protectedPaths: [target], rules, prompt: async request => {
    requests.push(request); return { decision, pattern: 'preferences/*' };
  } });
  await assert.rejects(interactive.path(target, 'read', 'read_file', signal()), /one-time/);
  decision = 'pattern';
  await assert.rejects(interactive.path('settings-alias', 'write', 'edit_file', signal()), /one-time/);
  decision = 'once';
  await interactive.path(target, 'read', 'read_file', signal());
  await interactive.path('settings-alias', 'read', 'read_file', signal());
  assert.equal(requests.length, 4);
  assert.ok(requests.every(request => request.resource === target));
});

test('registered config aliases keep initial targets protected and protect replacement targets and future paths', async t => {
  const { cwd, options } = await fixture(t);
  await writeFile(join(cwd, 'src', 'initial.data'), 'synthetic');
  await writeFile(join(cwd, 'src', 'replacement.data'), 'synthetic');
  await symlink('src/initial.data', join(cwd, 'user-settings'));
  const gate = new PermissionManager({ ...options, prompt: undefined, protectedPaths: ['user-settings', 'future/config.json'],
    rules: [{ action: 'write', tool: 'create_file', pattern: 'future/*.json' }] });
  await assert.rejects(gate.path('src/initial.data', 'read', 'read_file', signal()), /Permission denied/);
  await rm(join(cwd, 'user-settings')); await symlink('src/replacement.data', join(cwd, 'user-settings'));
  await symlink('src/replacement.data', join(cwd, 'another-alias'));
  for (const path of ['src/initial.data', 'src/replacement.data', 'user-settings', 'another-alias']) {
    await assert.rejects(gate.path(path, 'read', 'read_file', signal()), /Permission denied.*protected/);
  }
  await assert.rejects(gate.path('future/config.json', 'write', 'create_file', signal()), /Permission denied.*protected/);
  assert.equal(await gate.path('future/ordinary.json', 'write', 'create_file', signal()), join(cwd, 'future/ordinary.json'));
});

test('explicit config protection takes precedence over the read_output state exception', async t => {
  const { cwd, options, requests } = await fixture(t);
  const stateDir = join(cwd, 'state');
  await mkdir(join(stateDir, 'outputs'), { recursive: true });
  const path = join(stateDir, 'outputs', 'user-config.txt');
  await writeFile(path, 'synthetic config values');
  const gate = new PermissionManager({ ...options, stateDir, protectedPaths: [path], prompt: undefined });
  await assert.rejects(gate.path(path, 'read', 'read_output', signal()), /Permission denied.*protected/);
  const interactive = new PermissionManager({ ...options, stateDir, protectedPaths: [path] });
  await interactive.path(path, 'read', 'read_output', signal());
  await interactive.path(path, 'read', 'read_output', signal());
  assert.equal(requests.length, 2);
});

test('all writes ask and one-time approvals are never reused', async t => {
  const { options, requests, events } = await fixture(t);
  const gate = new PermissionManager(options);
  await gate.path('src/file.txt', 'write', 'create_file', signal());
  await gate.path('src/file.txt', 'write', 'create_file', signal());
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0]!.id, requests[1]!.id);
  assert.deepEqual(events.map(event => event.type), ['permission.request', 'permission.decision', 'permission.request', 'permission.decision']);
});

test('session approvals match exact canonical resource, tool, action and cwd', async t => {
  const { cwd, outside, options, requests } = await fixture(t);
  const gate = new PermissionManager({ ...options, prompt: async request => { requests.push(request); return { decision: 'session' }; } });
  const request = { tool: 'shell', action: 'shell' as const, resource: 'ignored', command: 'printf hello', reason: 'test', cwd };
  await gate.authorize(request, signal());
  await gate.authorize({ ...request, cwd: join(cwd, '.') }, signal());
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.command, 'printf hello');
  assert.equal(requests[0]!.resource, 'printf hello');
  assert.equal(requests[0]!.cwd, cwd);
  await gate.authorize({ ...request, command: 'printf goodbye' }, signal());
  await gate.authorize({ ...request, cwd: outside }, signal());
  await gate.authorize({ ...request, tool: 'extension.shell' }, signal());
  assert.equal(requests.length, 4);
  await gate.path(join(outside, 'file.txt'), 'read', 'read_file', signal());
  await gate.path(join(outside, 'file.txt'), 'read', 'read_file', signal());
  await gate.path(join(outside, 'other.txt'), 'read', 'read_file', signal());
  await gate.path(join(outside, 'file.txt'), 'write', 'read_file', signal());
  assert.equal(requests.length, 7);
});

test('narrow configured path rules canonicalize their base and retain tool/action/cwd scope', async t => {
  const { cwd, options, requests } = await fixture(t);
  await symlink(join(cwd, 'src'), join(cwd, 'alias'));
  const gate = new PermissionManager({ ...options, rules: [{ action: 'write', tool: 'edit_file', pattern: 'alias/*.ts' }] });
  await gate.path('src/a.ts', 'write', 'edit_file', signal());
  assert.equal(requests.length, 0);
  await gate.path('src/a.js', 'write', 'edit_file', signal());
  await gate.path('other.ts', 'write', 'edit_file', signal());
  await gate.path('src/a.ts', 'write', 'create_file', signal());
  await gate.authorize({ action: 'write', tool: 'edit_file', resource: join(cwd, 'src/a.ts'), cwd: join(cwd, 'src'), reason: 'other cwd' }, signal());
  assert.equal(requests.length, 4);
});

test('interactive patterns must be narrow and match the current request', async t => {
  const { options, requests } = await fixture(t);
  let pattern = 'src/*.txt';
  const gate = new PermissionManager({ ...options, prompt: async request => { requests.push(request); return { decision: 'pattern', pattern }; } });
  await gate.path('src/a.txt', 'write', 'create_file', signal());
  await gate.path('src/b.txt', 'write', 'create_file', signal());
  assert.equal(requests.length, 1);
  pattern = '*';
  await assert.rejects(gate.path('other.txt', 'write', 'create_file', signal()), /narrow/);
  pattern = '**/*';
  await assert.rejects(gate.path('other.txt', 'write', 'create_file', signal()), /narrow/);
  pattern = 'elsewhere/*.txt';
  await assert.rejects(gate.path('other.txt', 'write', 'create_file', signal()), /match/);
  pattern = 'src/../*.txt';
  await assert.rejects(gate.path('other.bin', 'write', 'create_file', signal()), /match/);
});

test('remembered path patterns bind canonical paths rather than mutable aliases', async t => {
  const { cwd, options, requests } = await fixture(t);
  await mkdir(join(cwd, 'other'));
  await symlink(join(cwd, 'src'), join(cwd, 'alias'));
  const gate = new PermissionManager({ ...options, prompt: async request => {
    requests.push(request); return { decision: 'pattern', pattern: 'alias/*.txt' };
  } });
  await gate.path('alias/a.txt', 'write', 'create_file', signal());
  await rm(join(cwd, 'alias')); await symlink(join(cwd, 'other'), join(cwd, 'alias'));
  await gate.path('src/b.txt', 'write', 'create_file', signal());
  assert.equal(requests.length, 1);
  await gate.path('alias/a.txt', 'write', 'create_file', signal());
  assert.equal(requests.length, 2);
});

test('shell rules do not authorize other commands, cwd, tools or shell metacharacters', async t => {
  const { cwd, outside, options, requests } = await fixture(t);
  const gate = new PermissionManager({ ...options, rules: [
    { action: 'shell', tool: 'shell', pattern: '*' },
    { action: 'shell', tool: 'shell', pattern: 'git *' },
    { action: 'shell', tool: 'shell', pattern: 'git status *' },
  ] });
  const request = { action: 'shell' as const, tool: 'shell', cwd, resource: 'git status --short', reason: 'test' };
  await gate.authorize(request, signal());
  assert.equal(requests.length, 0);
  for (const resource of ['git push', 'git status --short; printf bad', 'git status $(printf bad)', 'git status --short\nprintf bad']) {
    await gate.authorize({ ...request, resource }, signal());
  }
  await gate.authorize({ ...request, cwd: outside }, signal());
  await gate.authorize({ ...request, tool: 'other' }, signal());
  assert.equal(requests.length, 6);
});

test('explicit narrow shell prefixes remain available for potentially destructive commands', async t => {
  const { cwd, options, requests } = await fixture(t);
  const gate = new PermissionManager({ ...options, rules: [{ action: 'shell', tool: 'shell', pattern: 'git clean *' }] });
  await gate.authorize({ action: 'shell', tool: 'shell', resource: 'git clean -fd', command: 'git clean -fd', cwd, reason: 'Advisory warning' }, signal());
  assert.equal(requests.length, 0);
  await gate.authorize({ action: 'shell', tool: 'shell', resource: 'git reset --hard', command: 'git reset --hard', cwd, reason: 'Advisory warning' }, signal());
  assert.equal(requests.length, 1);
});

test('non-filesystem rules require exact resource, action, tool and cwd', async t => {
  const { cwd, outside, options, requests } = await fixture(t);
  const gate = new PermissionManager({ ...options, rules: [{ action: 'extension', tool: 'external__test__run', pattern: 'test/run' }] });
  const request = { action: 'extension' as const, tool: 'external__test__run', resource: 'test/run', cwd, reason: 'test' };
  await gate.authorize(request, signal());
  assert.equal(requests.length, 0);
  await gate.authorize({ ...request, resource: 'test/other' }, signal());
  await gate.authorize({ ...request, action: 'network' }, signal());
  await gate.authorize({ ...request, cwd: outside }, signal());
  assert.equal(requests.length, 3);
});

test('canonical glob metacharacters cannot broaden an exact alias rule', async t => {
  const { cwd, options, requests } = await fixture(t);
  await writeFile(join(cwd, 'literal?.txt'), 'synthetic');
  await symlink('literal?.txt', join(cwd, 'alias'));
  const gate = new PermissionManager({ ...options, rules: [{ action: 'write', tool: 'edit_file', pattern: 'alias' }] });
  await gate.path('literalX.txt', 'write', 'edit_file', signal());
  assert.equal(requests.length, 1);
});

test('protected path detection covers environment, credential directories and private keys', () => {
  for (const path of ['.env', '.env.local', '/project/.ssh/config', '/project/.aws/config', '.npmrc', '.netrc', 'id_ed25519', 'private.pem', 'credentials.json', 'secrets.yaml', '.kiln/config.json']) {
    assert.equal(isProtectedPath(path), true, path);
  }
  for (const path of ['src/environment.ts', 'src/key.ts', '.gitignore', 'README.md', 'config.json', 'src/config.json']) assert.equal(isProtectedPath(path), false, path);
});

test('project Kiln config requires explicit one-time reading in plan mode without banning ordinary config', async t => {
  const { cwd, options, requests } = await fixture(t);
  await mkdir(join(cwd, '.kiln'));
  await writeFile(join(cwd, '.kiln', 'config.json'), '{"instructions":"untrusted project instructions"}');
  await writeFile(join(cwd, 'config.json'), '{}');
  await symlink('.kiln/config.json', join(cwd, 'config-alias'));
  const offline = new PermissionManager({ ...options, mode: 'plan', prompt: undefined });
  await assert.rejects(offline.path('config-alias', 'read', 'read_file', signal()), /Permission denied.*protected/);
  await offline.path('config.json', 'read', 'read_file', signal());
  const interactive = new PermissionManager({ ...options, mode: 'plan' });
  await interactive.path('.kiln/config.json', 'read', 'read_file', signal());
  await interactive.path('config-alias', 'read', 'read_file', signal());
  await assert.rejects(interactive.path('.kiln/config.json', 'write', 'edit_file', signal()), /plan mode/);
  assert.equal(requests.length, 2);
});

test('secrets deny by default, bypass configured grants and require once on every request', async t => {
  const { cwd, options, requests } = await fixture(t);
  await writeFile(join(cwd, '.env'), 'SYNTHETIC=not-a-real-secret');
  await symlink(join(cwd, '.env'), join(cwd, 'innocent.txt'));
  const rules = [{ action: 'read' as const, tool: 'read_file', pattern: join(cwd, '.env') }];
  const noninteractive = new PermissionManager({ ...options, prompt: undefined, rules });
  await assert.rejects(noninteractive.path('.env', 'read', 'read_file', signal()), /Permission denied/);
  await assert.rejects(noninteractive.path('innocent.txt', 'read', 'read_file', signal()), /Permission denied/);
  let decision: PermissionAnswer['decision'] = 'session';
  const gate = new PermissionManager({ ...options, rules, prompt: async request => { requests.push(request); return { decision, pattern: '.env' }; } });
  await assert.rejects(gate.path('.env', 'read', 'read_file', signal()), /one-time/);
  decision = 'pattern';
  await assert.rejects(gate.path('.env', 'read', 'read_file', signal()), /one-time/);
  decision = 'once';
  await gate.path('innocent.txt', 'read', 'read_file', signal());
  await gate.path('innocent.txt', 'read', 'read_file', signal());
  assert.equal(requests.length, 4);
});

test('a protected alias is still protected when its target has an ordinary name', async t => {
  const { cwd, options } = await fixture(t);
  await writeFile(join(cwd, 'ordinary.txt'), 'synthetic');
  await symlink('ordinary.txt', join(cwd, '.env'));
  const gate = new PermissionManager({ ...options, prompt: undefined });
  await assert.rejects(gate.path('.env', 'read', 'read_file', signal()), /Permission denied/);
});

test('plan mode technically denies every shell and write, including protected writes', async t => {
  const { cwd, options, requests } = await fixture(t);
  const gate = new PermissionManager({ ...options, mode: 'plan', rules: [{ action: 'shell', tool: 'shell', pattern: 'git status' }] });
  await gate.path('src/file.txt', 'read', 'read_file', signal());
  await assert.rejects(gate.path('src/file.txt', 'write', 'create_file', signal()), /plan mode/);
  await assert.rejects(gate.path('.env', 'write', 'edit_file', signal()), /plan mode/);
  await assert.rejects(gate.authorize({ action: 'shell', tool: 'shell', resource: 'git status', cwd, reason: 'readonly shell' }, signal()), /plan mode/);
  assert.equal(requests.length, 0);
});

test('denied/noninteractive requests fail closed and an uncooperative prompt can be aborted', async t => {
  const { options, requests } = await fixture(t);
  const denied = new PermissionManager({ ...options, prompt: async () => ({ decision: 'deny' }) });
  await assert.rejects(denied.path('file', 'write', 'create_file', signal()), /Permission denied/);
  const offline = new PermissionManager({ ...options, prompt: undefined });
  await assert.rejects(offline.path('file', 'write', 'create_file', signal()), /Permission denied/);
  const controller = new AbortController();
  let release!: (answer: PermissionAnswer) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new PermissionManager({ ...options, prompt: request => {
    requests.push(request); started(); return new Promise(resolve => { release = resolve; });
  } });
  const pending = gate.path('file', 'write', 'create_file', controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  release({ decision: 'session' });
  await assert.rejects(gate.path('file', 'write', 'create_file', controller.signal), { name: 'AbortError' });
  assert.equal(requests.length, 1);
  const cleanSignal = signal();
  await new PermissionManager(options).path('file', 'write', 'create_file', cleanSignal);
  assert.equal(getEventListeners(cleanSignal, 'abort').length, 0);
});
