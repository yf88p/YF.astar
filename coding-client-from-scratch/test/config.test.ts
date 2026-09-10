import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { KilnClient } from '../src/client.js';
import { credentials, inspectConfig, loadConfig, selectModel } from '../src/config.js';
import type { KilnEvent, PermissionRequest } from '../src/types.js';
import { fakeProvider, localConfig, localModel, workspace } from './fixtures/fake-provider.js';

type Workspace = Awaited<ReturnType<typeof workspace>>;
const signal = () => new AbortController().signal;
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';

function isolate(t: TestContext, w: Workspace): void {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, w.env);
  t.after(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1', 'tests must never contact a public provider');
    return fetch(input, init);
  });
}

test('protected user configuration accepts 0600 and rejects group/world access, symlinks and malformed JSON', async t => {
  const w = await workspace(t);
  isolate(t, w);
  const options = { cwd: w.cwd, configDir: w.configDir, stateDir: w.stateDir, signal: signal() };
  await w.configure({ mode: 'plan' });
  const path = join(w.configDir, 'config.json');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await loadConfig(options)).config.mode, 'plan');
  for (const mode of [0o644, 0o640, 0o660, 0o604]) {
    await chmod(path, mode);
    await assert.rejects(loadConfig(options), /owned by you with mode 0600/);
    assert.equal((await stat(path)).mode & 0o777, mode, 'loading must not silently chmod an insecure user file');
  }
  await chmod(path, 0o600);
  await writeFile(path, '{not-json');
  await assert.rejects(loadConfig(options), /Invalid JSON configuration/);
  const linkedDir = join(w.root, 'linked-config');
  await mkdir(linkedDir);
  await symlink(path, join(linkedDir, 'config.json'));
  await assert.rejects(loadConfig({ ...options, configDir: linkedDir }), { code: 'ELOOP' });
  assert.deepEqual(await readdir(w.home), []);
  assert.deepEqual(await readdir(w.stateDir), []);
});

test('config schema rejects unknown fields, wrong types, invalid enums and unsafe permission actions', async t => {
  const w = await workspace(t);
  isolate(t, w);
  const invalid = [
    { surprise: true }, { mode: 'auto' }, { thinking: 'maximum' }, { retries: -1 }, { retries: 11 },
    { maxTurns: 0 }, { maxTurns: 1.5 }, { maxTurns: 1001 }, { aliases: { broken: 42 } }, { enabledModels: 'local/*' },
    { providers: { local: { type: 'unsupported' } } }, { providers: { local: { type: 'openai', extra: true } } },
    { models: [{ ...localModel, capabilities: { tools: true, images: 'yes', reasoning: false } }] },
    { models: [{ ...localModel, contextWindow: 100 }] },
    { permissions: [{ tool: 'read_file', action: 'secret', pattern: '.env' }] },
    { servers: [{ name: '../bad', command: 'never-run' }] },
  ];
  for (const value of invalid) {
    await w.configure(value);
    await assert.rejects(loadConfig({ ...w, signal: signal() }), /Invalid configuration/, JSON.stringify(value));
  }
});

test('project config and ancestor instructions are ignored until explicitly trusted; layers retain provenance and order', async t => {
  const w = await workspace(t);
  isolate(t, w);
  const marker = 'synthetic-private-instruction';
  const userRule = { tool: 'edit_file', action: 'write', pattern: 'src/*.ts' };
  await w.configure({ mode: 'plan', thinking: 'low', model: 'user-choice', aliases: { 'user-choice': 'local/fixture', shared: 'local/fixture' },
    providers: { local: { type: 'openai', baseURL: 'http://127.0.0.1:1/v1' } }, models: [localModel],
    templates: { retained: 'user retained', shared: 'user template' }, extensions: ['user-extension.mjs'], permissions: [userRule],
    instructions: `user-config-marker ${marker}`, secrets: [marker] });
  await writeFile(join(w.configDir, 'instructions.md'), 'user-file-marker\n');
  const instructionFiles = [
    [join(w.root, 'AGENTS.md'), 'ancestor-agents-marker'], [join(w.root, 'CLAUDE.md'), 'ancestor-claude-marker'],
    [join(w.cwd, 'AGENTS.md'), 'nearest-agents-marker'], [join(w.cwd, 'CLAUDE.md'), 'nearest-claude-marker'],
  ] as const;
  for (const [path, text] of instructionFiles) await writeFile(path, text);
  await mkdir(join(w.cwd, '.kiln'));
  const projectPath = join(w.cwd, '.kiln', 'config.json');
  await writeFile(projectPath, JSON.stringify({ mode: 'build', thinking: 'high', model: 'project-choice', aliases: { 'project-choice': 'local/fixture', shared: 'openai/gpt-4.1' },
    providers: { local: { type: 'openai', baseURL: 'http://127.0.0.1:2/v1' } },
    models: [{ ...localModel, name: 'Project override' }], templates: { shared: 'project template', project: 'project only' },
    extensions: ['project-extension.mjs'], instructions: 'project-config-marker' }), { mode: 0o644 });
  const untrusted = await loadConfig({ ...w, signal: signal() });
  assert.equal(untrusted.trusted, false);
  assert.equal(untrusted.config.mode, 'plan'); assert.equal(untrusted.config.thinking, 'low');
  assert.equal(untrusted.config.model, 'user-choice');
  assert.equal(untrusted.config.aliases.shared, 'local/fixture');
  assert.equal(untrusted.config.providers.local!.baseURL, 'http://127.0.0.1:1/v1');
  assert.equal(selectModel(untrusted.config).name, localModel.name);
  assert.deepEqual(untrusted.projectExtensions, []);
  assert.deepEqual(untrusted.userExtensions, [resolve(w.configDir, 'user-extension.mjs')]);
  assert.deepEqual(untrusted.rules, [userRule]);
  assert.match(untrusted.instructions, /USER INSTRUCTIONS.*instructions\.md/);
  assert.match(untrusted.instructions, /USER CONFIG INSTRUCTIONS:\nuser-config-marker \[REDACTED\]/);
  assert.doesNotMatch(untrusted.instructions, /ancestor-|nearest-|project-config-marker|synthetic-private-instruction/);
  for (const [path] of instructionFiles) assert.deepEqual(untrusted.sources.find(source => source.path === path), { path, kind: 'instructions', loaded: false });
  assert.deepEqual(untrusted.sources.find(source => source.path === projectPath), { path: projectPath, kind: 'config', loaded: false });
  const trusted = await loadConfig({ ...w, trust: true, signal: signal() });
  assert.equal(trusted.trusted, true);
  assert.equal(trusted.config.mode, 'build'); assert.equal(trusted.config.thinking, 'high');
  assert.equal(trusted.config.model, 'project-choice');
  assert.equal(selectModel(trusted.config).name, 'Project override');
  assert.equal(trusted.config.models.filter(model => model.provider === 'local' && model.id === 'fixture').length, 1);
  assert.ok(trusted.config.models.some(model => model.provider === 'openai'), 'unrelated builtins are retained');
  assert.equal(trusted.config.aliases['user-choice'], 'local/fixture');
  assert.equal(trusted.config.aliases.shared, 'openai/gpt-4.1');
  assert.equal(trusted.config.providers.local!.baseURL, 'http://127.0.0.1:2/v1');
  assert.deepEqual(trusted.config.templates, { retained: 'user retained', shared: 'project template', project: 'project only' });
  assert.deepEqual(trusted.userExtensions, untrusted.userExtensions);
  assert.deepEqual(trusted.projectExtensions, [resolve(w.cwd, 'project-extension.mjs')]);
  assert.deepEqual(trusted.rules, [userRule]);
  const markers = ['user-file-marker', 'user-config-marker', ...instructionFiles.map(([, text]) => text), 'project-config-marker'];
  let previous = -1;
  for (const marker of markers) {
    const index = trusted.instructions.indexOf(marker);
    assert.ok(index > previous, `${marker} must follow earlier instruction sources`); previous = index;
  }
  assert.ok(trusted.sources.every(source => source.loaded));
  assert.doesNotMatch(trusted.instructions, /synthetic-private-instruction/);
  const visible = inspectConfig(trusted);
  assert.deepEqual(visible.sources, trusted.sources);
  assert.equal(visible.trusted, true);
  await assert.rejects(stat(join(w.configDir, 'trust.json')), { code: 'ENOENT' });
});

test('untrusted invalid project config is inert; trust validates schema and forbids project credentials and permission grants', async t => {
  const w = await workspace(t);
  isolate(t, w);
  await w.configure({ mode: 'plan' });
  await mkdir(join(w.cwd, '.kiln'));
  const project = join(w.cwd, '.kiln', 'config.json');
  for (const [text, error] of [
    ['{invalid-json', /Invalid JSON configuration/],
    [JSON.stringify({ unexpected: true }), /Invalid configuration/],
    [JSON.stringify({ providers: { local: { type: 'openai', apiKey: 'synthetic-project-key' } } }), /may not contain apiKey/],
    [JSON.stringify({ permissions: [{ tool: 'edit_file', action: 'write', pattern: 'src/*.ts' }] }), /protected user configuration/],
  ] as const) {
    await writeFile(project, text);
    const loaded = await loadConfig({ ...w, signal: signal() });
    assert.equal(loaded.trusted, false); assert.equal(loaded.config.mode, 'plan');
    await assert.rejects(loadConfig({ ...w, trust: true, signal: signal() }), error);
  }
});

test('remembered project trust is protected and content-bound, while denied trust stays unloaded', async t => {
  const w = await workspace(t);
  isolate(t, w);
  await w.configure({});
  const path = join(w.cwd, 'AGENTS.md');
  await writeFile(path, 'original project instructions');
  const requests: PermissionRequest[] = [];
  const denied = await loadConfig({ ...w, signal: signal(), prompt: async request => { requests.push(request); return { decision: 'deny' }; } });
  assert.equal(denied.trusted, false);
  assert.equal(requests[0]!.tool, 'project_trust');
  assert.equal(requests[0]!.resource, w.cwd);
  assert.ok(requests[0]!.reason.includes(path));
  const trustPath = join(w.configDir, 'trust.json');
  await assert.rejects(stat(trustPath), { code: 'ENOENT' });
  const accepted = await loadConfig({ ...w, signal: signal(), prompt: async () => ({ decision: 'session' }) });
  assert.equal(accepted.trusted, true);
  assert.equal((await stat(trustPath)).mode & 0o777, 0o600);
  assert.equal(typeof (JSON.parse(await readFile(trustPath, 'utf8')) as Record<string, unknown>)[w.cwd], 'string');
  const remembered = await loadConfig({ ...w, signal: signal(), prompt: async () => { assert.fail('unchanged trusted content must not reprompt'); } });
  assert.equal(remembered.trusted, true);
  await writeFile(path, 'changed project instructions');
  const changed = await loadConfig({ ...w, signal: signal() });
  assert.equal(changed.trusted, false);
  assert.doesNotMatch(changed.instructions, /changed project instructions/);
  await chmod(trustPath, 0o644);
  await assert.rejects(loadConfig({ ...w, signal: signal() }), /mode 0600/);
});

test('project approval loads only the config and instruction snapshots fingerprinted before the prompt', async t => {
  const w = await workspace(t);
  isolate(t, w);
  await w.configure({ mode: 'plan' });
  await mkdir(join(w.cwd, '.kiln'));
  const project = join(w.cwd, '.kiln', 'config.json');
  const approved = { instructions: 'approved-config', extensions: ['approved-extension.mjs'],
    servers: [{ name: 'approved', command: process.execPath, args: ['approved-server.mjs'] }] };
  await writeFile(project, JSON.stringify(approved));
  const paths = [join(w.root, 'AGENTS.md'), join(w.root, 'CLAUDE.md'), join(w.cwd, 'AGENTS.md'), join(w.cwd, 'CLAUDE.md')];
  for (const [index, path] of paths.entries()) await writeFile(path, `approved-instruction-${index}`);
  let prompted = false;
  const loaded = await loadConfig({ ...w, signal: signal(), prompt: async request => {
    prompted = true;
    for (const path of [...paths, project]) assert.ok(request.reason.includes(path));
    await writeFile(project, JSON.stringify({ instructions: 'unapproved-config', mode: 'build', extensions: ['unapproved-extension.mjs'],
      servers: [{ name: 'unapproved', command: process.execPath, args: ['unapproved-server.mjs'] }] }));
    for (const path of paths) await writeFile(path, 'unapproved-instruction');
    return { decision: 'session' };
  } });
  assert.equal(prompted, true);
  assert.equal(loaded.trusted, true);
  assert.equal(loaded.config.mode, 'plan');
  assert.equal(loaded.config.instructions, approved.instructions);
  assert.deepEqual(loaded.config.servers, approved.servers);
  assert.deepEqual(loaded.projectExtensions, [join(w.cwd, 'approved-extension.mjs')]);
  for (const [index, path] of paths.entries()) {
    assert.ok(loaded.instructions.includes(`PROJECT INSTRUCTIONS (${path}):\napproved-instruction-${index}`));
    assert.equal(await readFile(path, 'utf8'), 'unapproved-instruction');
  }
  assert.ok(loaded.instructions.includes('PROJECT CONFIG INSTRUCTIONS:\napproved-config'));
  assert.ok(!JSON.stringify(inspectConfig(loaded)).includes('unapproved'));
  assert.doesNotMatch(loaded.instructions, /unapproved/);
  assert.ok(loaded.sources.every(source => source.loaded));
  assert.ok(loaded.sources.every(source => Object.keys(source).sort().join(',') === 'kind,loaded,path'), 'snapshots must not leak through provenance');
  assert.equal((await stat(join(w.configDir, 'trust.json'))).mode & 0o777, 0o600);
  const changed = await loadConfig({ ...w, signal: signal() });
  assert.equal(changed.trusted, false, 'remembered trust must describe the old snapshot, not the replacement');
  assert.deepEqual(changed.projectExtensions, []);
  assert.doesNotMatch(changed.instructions, /unapproved/);
});

test('a project config created during approval is not loaded, and replacing an invalid snapshot cannot bypass validation', async t => {
  const w = await workspace(t);
  isolate(t, w);
  await w.configure({ mode: 'plan' });
  await writeFile(join(w.cwd, 'AGENTS.md'), 'approved instructions');
  await mkdir(join(w.cwd, '.kiln'));
  const project = join(w.cwd, '.kiln', 'config.json');
  const loaded = await loadConfig({ ...w, signal: signal(), prompt: async request => {
    assert.ok(!request.reason.includes(project));
    await writeFile(project, JSON.stringify({ mode: 'build', extensions: ['new-unapproved.mjs'] }));
    return { decision: 'once' };
  } });
  assert.equal(loaded.config.mode, 'plan');
  assert.deepEqual(loaded.projectExtensions, []);
  assert.ok(!loaded.sources.some(source => source.path === project));
  await writeFile(project, '{invalid snapshot');
  await assert.rejects(loadConfig({ ...w, signal: signal(), prompt: async () => {
    await writeFile(project, '{}');
    return { decision: 'once' };
  } }), /Invalid JSON configuration/);
});

test('trust records reject non-string values, noncanonical root keys and prototype keys without echoing data', async t => {
  const w = await workspace(t);
  isolate(t, w);
  await w.configure({});
  await writeFile(join(w.cwd, 'AGENTS.md'), 'project instructions');
  const path = join(w.configDir, 'trust.json');
  const secret = String.raw`private-trust"value\suffix`;
  const invalid: unknown[] = [null, [], true, 1, secret,
    ...[null, 42, true, [], { value: secret }].map(value => ({ [w.cwd]: value })),
    { [secret]: 'fingerprint' }, { [`${w.cwd}/../project`]: secret }, { [`${w.cwd}/`]: secret }, { [`${w.cwd}\0`]: secret },
    { ['__proto__']: secret }, { constructor: secret }, { prototype: secret }];
  for (const value of invalid) {
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    await assert.rejects(loadConfig({ ...w, signal: signal() }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid .*trust/i);
      assert.ok(!error.message.includes(secret) && !error.message.includes(JSON.stringify(secret).slice(1, -1)));
      return true;
    });
  }
  await writeFile(path, `{"${secret}`);
  await assert.rejects(loadConfig({ ...w, signal: signal() }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Invalid .*trust/i);
    assert.ok(!error.message.includes('private-trust'));
    return true;
  });
  const previous = { [join(w.root, 'old-project')]: 'old-fingerprint' };
  await writeFile(path, JSON.stringify(previous));
  const loaded = await loadConfig({ ...w, signal: signal(), prompt: async () => ({ decision: 'session' }) });
  assert.equal(loaded.trusted, true);
  const stored = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>;
  assert.equal(stored[join(w.root, 'old-project')], 'old-fingerprint', 'records for removed workspaces remain inert and preserved');
  assert.match(stored[w.cwd]!, /^[a-f0-9]{64}$/);
});

test('configuration parse errors never echo malformed JSON, secret values or secret map keys', async t => {
  const w = await workspace(t);
  isolate(t, w);
  const secret = String.raw`synthetic-parse"token\suffix`;
  const path = join(w.configDir, 'config.json');
  for (const input of [JSON.stringify({ instructions: secret }).slice(0, -1),
    JSON.stringify({ mode: secret }), JSON.stringify({ providers: { [secret]: { type: 'invalid', apiKey: secret } } })]) {
    await writeFile(path, input, { mode: 0o600 });
    await assert.rejects(loadConfig({ ...w, signal: signal() }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid (?:JSON )?configuration/);
      assert.ok(!error.message.includes('synthetic-parse'), 'validation paths and native JSON exceptions may contain secrets');
      return true;
    });
  }
});

test('provider URL credential queries and userinfo are rejected without disclosing values; api-version remains supported', async t => {
  const w = await workspace(t);
  isolate(t, w);
  const token = String.raw`private-query"token\suffix`;
  const baseURL = 'http://127.0.0.1:1/v1?api-version=2026-01-01';
  const urls = ['api_key', 'API-KEY', 'apiKey', 'x-api-key', 'key', 'secret_key', 'access_key', 'token', 'api_token', 'security_token', 'access_token', 'refresh-token', 'authToken',
    'id_token', 'bearer_token', 'authorization', 'auth', 'secret', 'client_secret', 'password', 'signature', 'sig', 'api%5Fkey']
    .map(key => `${baseURL}&${key}=${encodeURIComponent(token)}`);
  urls.push(`http://${encodeURIComponent(token)}:password@127.0.0.1:1/v1`);
  for (const url of urls) {
    await w.configure(localConfig(url));
    await assert.rejects(loadConfig({ ...w, signal: signal() }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Provider endpoint.*credential/i);
      assert.ok(!error.message.includes('private-query') && !error.message.includes('password@'));
      return true;
    });
  }
  await w.configure(localConfig(baseURL));
  const loaded = await loadConfig({ ...w, signal: signal() });
  assert.equal(loaded.config.providers.local!.baseURL, baseURL);
  assert.equal((inspectConfig(loaded).config as typeof loaded.config).providers.local!.baseURL, baseURL);
  await mkdir(join(w.cwd, '.kiln'));
  await writeFile(join(w.cwd, '.kiln', 'config.json'), JSON.stringify(localConfig(urls[0]!)));
  assert.equal((await loadConfig({ ...w, signal: signal() })).trusted, false);
  await assert.rejects(loadConfig({ ...w, trust: true, signal: signal() }), /Provider endpoint.*credential/i);
});

test('credentials include full Bearer headers and bare quoted/backslash tokens alongside configured env and API keys', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  isolate(t, w);
  const bearer = String.raw`opaque-header"value\suffix`;
  const envToken = String.raw`opaque-env"value\suffix`;
  const apiKey = String.raw`opaque-config"value\suffix`;
  const header = `bEaReR \t${bearer}  `;
  process.env.KILN_TEST_CONFIG_KEY = envToken;
  const provider = await fakeProvider(t, () => ({ text: `Echo ${bearer} ${envToken} ${apiKey}` }));
  await w.configure({ ...localConfig(provider.baseURL), providers: {
    local: { type: 'openai', baseURL: provider.baseURL },
    unused: { type: 'openai', baseURL: provider.baseURL, apiKey, apiKeyEnv: 'KILN_TEST_CONFIG_KEY', headers: { Authorization: header } },
  }, instructions: `Configured ${header} ${bearer} ${envToken} ${apiKey}`, templates: { quoted: `${bearer} ${envToken} ${apiKey}` } });
  const loaded = await loadConfig({ ...w, signal: signal() });
  const values = credentials(loaded.config);
  for (const value of [header, bearer, envToken, apiKey]) {
    assert.ok(values.includes(value), 'credential extraction must preserve the exact decoded value');
    assert.equal(loaded.redact(value), '[REDACTED]');
  }
  const events: KilnEvent[] = [];
  const client = new KilnClient({ loaded, ephemeral: true, sink: event => events.push(event) });
  t.after(() => client.close());
  await client.initialize(); await client.submit(`Inspect ${bearer} ${envToken} ${apiKey}`);
  assert.equal(client.lastResult?.outcome, 'success');
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0]!.body.messages.at(-1)!.content, 'Inspect [REDACTED] [REDACTED] [REDACTED]');
  const visible = JSON.parse(await client.command('/config')) as ReturnType<typeof inspectConfig>;
  assert.equal((visible.config as typeof loaded.config).templates.quoted, '[REDACTED] [REDACTED] [REDACTED]');
  for (const output of [loaded.instructions, JSON.stringify(visible), JSON.stringify(events), client.store.export(client.session.meta.id), JSON.stringify(provider.requests[0]!.body)]) {
    assert.doesNotMatch(output, /opaque-(?:header|env|config)/);
  }
});

test('config/state directory precedence is explicit option, KILN environment, then XDG with no real-home writes', async t => {
  const w = await workspace(t);
  isolate(t, w);
  const envConfig = join(w.root, 'env-config');
  const xdgConfig = join(w.env.XDG_CONFIG_HOME!, 'kiln');
  await mkdir(envConfig); await mkdir(xdgConfig, { recursive: true });
  await w.configure({ maxTurns: 11 });
  await writeFile(join(envConfig, 'config.json'), JSON.stringify({ maxTurns: 22 }), { mode: 0o600 });
  await writeFile(join(xdgConfig, 'config.json'), JSON.stringify({ maxTurns: 33 }), { mode: 0o600 });
  process.env.KILN_CONFIG_DIR = envConfig; process.env.KILN_STATE_DIR = join(w.root, 'env-state');
  const explicit = await loadConfig({ ...w, signal: signal() });
  assert.equal(explicit.config.maxTurns, 11); assert.equal(explicit.stateDir, w.stateDir);
  const environment = await loadConfig({ cwd: w.cwd, signal: signal() });
  assert.equal(environment.config.maxTurns, 22); assert.equal(environment.configDir, envConfig);
  assert.equal(environment.stateDir, process.env.KILN_STATE_DIR);
  delete process.env.KILN_CONFIG_DIR; delete process.env.KILN_STATE_DIR;
  const xdg = await loadConfig({ cwd: w.cwd, signal: signal() });
  assert.equal(xdg.config.maxTurns, 33); assert.equal(xdg.configDir, xdgConfig);
  assert.equal(xdg.stateDir, join(w.env.XDG_STATE_HOME!, 'kiln'));
  delete process.env.XDG_CONFIG_HOME; delete process.env.XDG_STATE_HOME;
  const home = await loadConfig({ cwd: w.cwd, signal: signal() });
  assert.equal(home.configDir, join(w.home, '.config', 'kiln'));
  assert.equal(home.stateDir, join(w.home, '.local', 'state', 'kiln'));
  await assert.rejects(stat(home.configDir), { code: 'ENOENT' });
  await assert.rejects(stat(home.stateDir), { code: 'ENOENT' });
});

test('model aliases, provider disambiguation and enabled scopes apply to selection and client-visible models', async t => {
  const w = await workspace(t);
  isolate(t, w);
  await w.configure({ ...localConfig('http://127.0.0.1:1/v1'), model: 'chosen', aliases: { chosen: 'local/fixture' },
    models: [localModel, { ...localModel, provider: 'other' }, { ...localModel, id: 'second' }],
    providers: { local: { type: 'openai', baseURL: 'http://127.0.0.1:1/v1' }, other: { type: 'openai', baseURL: 'http://127.0.0.1:1/v1' } } });
  const loaded = await loadConfig({ ...w, signal: signal() });
  const config = loaded.config;
  assert.equal(selectModel(config).provider, 'local');
  assert.equal(selectModel(config, 'fixture', 'local').provider, 'local');
  assert.throws(() => selectModel(config, 'fixture', 'other'), /outside enabledModels/);
  assert.throws(() => selectModel(config, 'chosen', 'other'), /Unknown model/);
  assert.throws(() => selectModel(config, 'missing'), /Unknown model/);
  for (const scope of ['local/*', 'local/fixture', 'chosen', 'fixture']) {
    assert.equal(selectModel({ ...config, enabledModels: [scope] }, 'chosen').id, 'fixture');
  }
  assert.equal(selectModel({ ...config, enabledModels: ['fixture'] }, 'fixture', 'other').provider, 'other');
  assert.throws(() => selectModel({ ...config, enabledModels: [] }, 'chosen'), /outside enabledModels/);
  assert.throws(() => selectModel({ ...config, enabledModels: ['local/fixture'] }, 'local/second'), /outside enabledModels/);
  assert.throws(() => selectModel({ ...config, enabledModels: undefined, providers: { local: config.providers.local! } }, 'other/fixture'), /Provider is not configured/);
  assert.throws(() => selectModel({ ...config, models: [{ ...localModel, maxOutput: localModel.contextWindow }] }), /maxOutput must be smaller/);
  const client = new KilnClient({ loaded, ephemeral: true });
  t.after(() => client.close());
  assert.deepEqual(client.models().map(model => model.key), ['local/fixture', 'local/second']);
});

test('KilnClient explicit choices override saved session configuration, which overrides disk defaults', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  isolate(t, w);
  const provider = await fakeProvider(t, () => ({ text: 'Configuration recorded.' }));
  await w.configure({ ...localConfig(provider.baseURL), models: [localModel, { ...localModel, id: 'second' }],
    aliases: { chosen: 'local/second' }, mode: 'plan', thinking: 'low' });
  const loaded = await loadConfig({ ...w, signal: signal() });
  const client = new KilnClient({ loaded, model: 'chosen', mode: 'build', thinking: 'high' });
  t.after(() => client.close());
  await client.initialize(); await client.submit('Persist the explicit choices.');
  assert.equal(client.lastResult?.outcome, 'success');
  const id = client.session.meta.id;
  assert.equal(provider.requests[0]!.body.model, 'second');
  assert.equal(provider.requests[0]!.body.reasoning_effort, 'high');
  assert.ok(provider.requests[0]!.body.tools!.some(tool => tool.function.name === 'edit_file'));
  await client.close();
  const resumed = new KilnClient({ loaded, sessionId: id });
  t.after(() => resumed.close());
  assert.equal(resumed.model.id, 'second'); assert.equal(resumed.mode, 'build'); assert.equal(resumed.thinking, 'high');
  await resumed.initialize(); await resumed.submit('Use saved choices.');
  assert.equal(resumed.lastResult?.outcome, 'success');
  assert.equal(provider.requests[1]!.body.model, 'second');
  await resumed.close();
  const overridden = new KilnClient({ loaded, sessionId: id, model: 'local/fixture', mode: 'plan', thinking: 'off' });
  t.after(() => overridden.close());
  await overridden.initialize(); await overridden.submit('Override saved choices.');
  assert.equal(overridden.lastResult?.outcome, 'success');
  assert.equal(provider.requests[2]!.body.model, 'fixture');
  assert.equal(provider.requests[2]!.body.reasoning_effort, undefined);
  assert.ok(provider.requests[2]!.body.tools!.every(tool => !['edit_file', 'create_file', 'shell'].includes(tool.function.name)));
});

test('KilnClient sends actual quoted text/image references, redacts secrets and exposes attachment and instruction provenance', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  isolate(t, w);
  const secret = 'synthetic-private-reference';
  const text = `Actual referenced file contents.\n${secret}\nsk-abcdefghijklmnopqrstuvwx\n`;
  await writeFile(join(w.cwd, 'notes with spaces.txt'), text);
  await writeFile(join(w.cwd, 'pixel.png'), Buffer.from(pixel, 'base64'));
  await writeFile(join(w.cwd, 'AGENTS.md'), 'untrusted-project-marker');
  await writeFile(join(w.configDir, 'instructions.md'), `user-instruction-marker ${secret}`);
  const provider = await fakeProvider(t, () => ({ text: `Reviewed real references without revealing ${secret}.` }));
  await w.configure({ ...localConfig(provider.baseURL), secrets: [secret] });
  const loaded = await loadConfig({ ...w, signal: signal() });
  const events: KilnEvent[] = [];
  const client = new KilnClient({ loaded, ephemeral: true, sink: event => events.push(event),
    prompt: async () => { assert.fail('ordinary in-workspace references require no approval'); } });
  t.after(() => client.close());
  await client.initialize();
  await client.submit(`Review @"notes with spaces.txt" @pixel.png @'notes with spaces.txt' ${secret}`);
  assert.equal(client.lastResult?.outcome, 'success');
  assert.equal(provider.requests.length, 1);
  const body = provider.requests[0]!.body;
  const system = String(body.messages[0]!.content);
  assert.match(system, /user-instruction-marker \[REDACTED\]/);
  assert.doesNotMatch(system, /untrusted-project-marker/);
  const parts = body.messages.at(-1)!.content;
  assert.ok(Array.isArray(parts));
  assert.deepEqual(parts, [
    { type: 'text', text: 'Review @"notes with spaces.txt" @pixel.png @\'notes with spaces.txt\' [REDACTED]' },
    { type: 'text', text: `[Attachment: ${join(w.cwd, 'notes with spaces.txt')}]\nActual referenced file contents.\n[REDACTED]\n[REDACTED]\n` },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${pixel}` } },
  ]);
  const message = events.find(event => event.type === 'message.user')!;
  assert.deepEqual(message.attachments, [
    { path: join(w.cwd, 'notes with spaces.txt'), kind: 'text', mediaType: 'text/plain' },
    { path: join(w.cwd, 'pixel.png'), kind: 'image', mediaType: 'image/png' },
  ]);
  assert.ok(!JSON.stringify(message).includes(pixel), 'visible attachment metadata does not dump base64');
  const context = JSON.parse(await client.command('/context')) as { sources: unknown; trusted: boolean };
  assert.deepEqual(context.sources, loaded.sources); assert.equal(context.trusted, false);
  assert.deepEqual(events.find(event => event.type === 'project.context')!.sources, loaded.sources);
  assert.ok(events.some(event => event.type === 'warning' && /Untrusted project/.test(String(event.message))));
  const history = client.session.history();
  assert.equal(history[0]!.attachments!.length, 2);
  assert.equal(history[0]!.attachments![1]!.data, pixel);
  for (const value of [JSON.stringify(body), JSON.stringify(events), JSON.stringify(history), await client.command('/config'), await client.command('/context')]) {
    assert.doesNotMatch(value, /synthetic-private-reference|sk-abcdefghijklmnopqrstuvwx/);
  }
  assert.equal(await readFile(join(w.cwd, 'notes with spaces.txt'), 'utf8'), text, 'redaction never rewrites the source');
  assert.equal((await readFile(join(w.cwd, 'pixel.png'))).toString('base64'), pixel);
  await client.close();
  const trusted = await loadConfig({ ...w, trust: true, signal: signal() });
  const trustedEvents: KilnEvent[] = [];
  const trustedClient = new KilnClient({ loaded: trusted, ephemeral: true, sink: event => trustedEvents.push(event) });
  t.after(() => trustedClient.close());
  await trustedClient.initialize(); await trustedClient.submit('Use reviewed project instructions.');
  assert.equal(trustedClient.lastResult?.outcome, 'success');
  assert.equal(provider.requests.length, 2);
  const trustedSystem = String(provider.requests[1]!.body.messages[0]!.content);
  assert.ok(trustedSystem.includes(`PROJECT INSTRUCTIONS (${join(w.cwd, 'AGENTS.md')}):\nuntrusted-project-marker`));
  assert.ok(trustedSystem.indexOf('user-instruction-marker') < trustedSystem.indexOf('untrusted-project-marker'));
  const trustedContext = JSON.parse(await trustedClient.command('/context')) as { trusted: boolean; sources: typeof trusted.sources };
  assert.equal(trustedContext.trusted, true);
  assert.deepEqual(trustedContext.sources.find(source => source.path === join(w.cwd, 'AGENTS.md')),
    { path: join(w.cwd, 'AGENTS.md'), kind: 'instructions', loaded: true });
  assert.equal(trustedEvents.some(event => event.type === 'warning' && /Untrusted project/.test(String(event.message))), false);
});

test('KilnClient rejects missing, binary, invalid/unsupported images, oversized and denied references before any model request', { timeout: 20_000 }, async t => {
  const w = await workspace(t);
  isolate(t, w);
  const provider = await fakeProvider(t, () => { assert.fail('rejected attachments must never reach the provider'); });
  await w.configure(localConfig(provider.baseURL));
  await writeFile(join(w.cwd, 'binary.txt'), Buffer.from([65, 0, 66]));
  await writeFile(join(w.cwd, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
  await writeFile(join(w.cwd, 'fake.png'), 'not a PNG');
  await writeFile(join(w.cwd, 'large.txt'), 'x'.repeat(128 * 1024 + 1));
  await writeFile(join(w.cwd, 'huge.png'), Buffer.alloc(2 * 1024 * 1024 + 1));
  await writeFile(join(w.cwd, 'pixel.png'), Buffer.from(pixel, 'base64'));
  await writeFile(join(w.cwd, '.env'), 'fixture-only protected contents');
  const outside = join(w.root, 'outside.txt');
  await writeFile(outside, 'outside reference');
  await symlink(outside, join(w.cwd, 'outside-link.txt'));
  const loaded = await loadConfig({ ...w, signal: signal() });
  const approvals: PermissionRequest[] = [];
  const events: KilnEvent[] = [];
  const client = new KilnClient({ loaded, ephemeral: true, sink: event => events.push(event),
    prompt: async request => { approvals.push(request); return { decision: 'deny' }; } });
  t.after(() => client.close());
  await client.initialize();
  for (const [prompt, error] of [
    ['@missing.txt', /ENOENT/], ['@binary.txt', /Binary attachment/], ['@invalid.txt', /not UTF-8/],
    ['@fake.png', /signature does not match/], ['@large.txt', /exceeds 128 KiB/], ['@huge.png', /at most 2 MiB/],
    ['@.', /regular file/], ['@.env', /Protected paths/], ['@outside-link.txt', /Permission denied/],
    [Array(9).fill('@pixel.png').join(' '), /At most eight file references/],
  ] as const) await assert.rejects(client.submit(prompt), error, prompt);
  client.model.capabilities.images = false;
  await assert.rejects(client.submit('@pixel.png'), /does not support images/);
  assert.equal(approvals.length, 2);
  assert.equal(approvals[0]!.action, 'secret'); assert.equal(approvals[1]!.resource, outside);
  assert.equal(client.session.history().length, 0);
  assert.equal(events.some(event => event.type === 'model.start' || event.type === 'message.user'), false);
  assert.equal(provider.requests.length, 0);
});

test('inspectConfig and client-visible config remove credential fields and redact nested configured values', async t => {
  const w = await workspace(t);
  isolate(t, w);
  const secret = 'synthetic-inspection-value';
  await w.configure({ ...localConfig('http://127.0.0.1:1/v1'), secrets: [secret], instructions: `instruction ${secret}`,
    providers: { local: { type: 'openai', baseURL: 'http://127.0.0.1:1/v1', apiKey: 'synthetic-api-value', headers: { 'x-test': 'synthetic-header-value' } } },
    servers: [{ name: 'unused', command: process.execPath, env: { PRIVATE: 'synthetic-server-value' } }],
    lsp: [{ name: 'unused', command: process.execPath, extensions: ['ts'], env: { PRIVATE: 'synthetic-lsp-value' } }] });
  const loaded = await loadConfig({ ...w, signal: signal() });
  const before = structuredClone(loaded.config);
  const visible = inspectConfig(loaded);
  const client = new KilnClient({ loaded, ephemeral: true });
  t.after(() => client.close());
  // No initialization: inspecting configuration must not launch configured processes.
  assert.deepEqual(JSON.parse(await client.command('/config')), visible);
  const config = visible.config as typeof loaded.config;
  assert.equal(config.providers.local!.apiKey, undefined); assert.equal(config.providers.local!.headers, undefined);
  assert.deepEqual(config.secrets, []);
  assert.equal(config.servers[0]!.env!.PRIVATE, '[REDACTED]');
  assert.equal(config.lsp[0]!.env!.PRIVATE, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(visible), /synthetic-(?:inspection|api|header|server|lsp)-value/);
  assert.deepEqual(loaded.config, before, 'inspection must not destroy live provider configuration');
});
