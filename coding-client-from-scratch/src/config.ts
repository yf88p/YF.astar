import { Ajv } from 'ajv';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Config, Model, PermissionPrompt } from './types.js';
import type { PermissionRule } from './permissions.js';
import { atomicWrite, hash, redactValue, redactor } from './util.js';

const capabilities = { tools: true, images: true, reasoning: false };
export const builtinModels: Model[] = [
  { id: 'claude-sonnet-4-5', provider: 'anthropic', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxOutput: 16384,
    capabilities: { ...capabilities, reasoning: true }, pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { id: 'gpt-4.1', provider: 'openai', name: 'GPT-4.1', contextWindow: 1047576, maxOutput: 16384,
    capabilities, pricing: { input: 2, output: 8, cacheRead: 0.5 } },
  { id: 'o4-mini', provider: 'openai', name: 'o4-mini', contextWindow: 200000, maxOutput: 16384,
    capabilities: { ...capabilities, reasoning: true }, pricing: { input: 1.1, output: 4.4, cacheRead: 0.275 } },
];
const defaults: Config = {
  model: process.env.ANTHROPIC_API_KEY ? 'anthropic/claude-sonnet-4-5' : 'openai/gpt-4.1',
  models: builtinModels, aliases: { sonnet: 'anthropic/claude-sonnet-4-5', gpt: 'openai/gpt-4.1', mini: 'openai/o4-mini' },
  providers: { anthropic: { type: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' }, openai: { type: 'openai', apiKeyEnv: 'OPENAI_API_KEY' } },
  mode: 'build', thinking: 'off', maxTurns: 40, retries: 3, steering: 'steer', templates: {}, extensions: [], servers: [], lsp: [], secrets: [],
};
const str = { type: 'string' };
const strings = { type: 'array', items: str, maxItems: 1000 };
const stringMap = { type: 'object', additionalProperties: str };
const processProperties = { name: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]*$', maxLength: 32 }, command: { type: 'string', minLength: 1 }, args: strings, env: stringMap };
const schema = {
  type: 'object', additionalProperties: false, properties: {
    model: str, models: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: false,
      required: ['id', 'provider', 'name', 'contextWindow', 'maxOutput', 'capabilities'], properties: {
        id: { type: 'string', minLength: 1 }, provider: { type: 'string', minLength: 1 }, name: str,
        contextWindow: { type: 'integer', minimum: 1024 }, maxOutput: { type: 'integer', minimum: 1 },
        capabilities: { type: 'object', additionalProperties: false, required: ['tools', 'images', 'reasoning'], properties: { tools: { type: 'boolean' }, images: { type: 'boolean' }, reasoning: { type: 'boolean' } } },
        pricing: { type: 'object', additionalProperties: false, required: ['input', 'output'], properties: Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].map(k => [k, { type: 'number', minimum: 0 }])) },
      } } },
    aliases: stringMap, enabledModels: strings,
    providers: { type: 'object', additionalProperties: { type: 'object', additionalProperties: false, required: ['type'], properties: {
      type: { enum: ['openai', 'anthropic'] }, baseURL: str, apiKey: str, apiKeyEnv: str, headers: stringMap,
    } } },
    mode: { enum: ['plan', 'build'] }, thinking: { enum: ['off', 'low', 'medium', 'high'] },
    maxTurns: { type: 'integer', minimum: 1, maximum: 1000 }, retries: { type: 'integer', minimum: 0, maximum: 10 },
    steering: { enum: ['steer', 'follow-up'] }, instructions: str, templates: stringMap, extensions: strings,
    servers: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, required: ['name', 'command'], properties: processProperties } },
    lsp: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, required: ['name', 'command', 'extensions'], properties: { ...processProperties, extensions: strings } } },
    secrets: strings,
    permissions: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: false, required: ['tool', 'action', 'pattern'], properties: { tool: str, action: { enum: ['read', 'write', 'shell', 'network', 'extension'] }, pattern: str } } },
  },
};
const validate = new Ajv({ allErrors: true }).compile(schema);
type DiskConfig = Partial<Config> & { permissions?: PermissionRule[] };
export interface LoadedConfig {
  config: Config;
  configDir: string;
  stateDir: string;
  cwd: string;
  trusted: boolean;
  sources: { path: string; loaded: boolean; kind: string }[];
  instructions: string;
  userExtensions: string[];
  projectExtensions: string[];
  rules: PermissionRule[];
  redact: (s: string) => string;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function boundedRead(path: string, protectedConfig = false): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error(`Expected a regular file of at most 256 KiB: ${path}`);
    if (protectedConfig && ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))) {
      throw new Error(`Config must be owned by you with mode 0600: ${path}`);
    }
    return await file.readFile('utf8');
  } finally { await file.close(); }
}
function parseConfig(text: string, path: string): DiskConfig {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) throw new Error(`Invalid JSON configuration: ${path}`); throw error; }
  // Instance paths can contain secret map keys; report only schema-defined messages.
  if (!validate(value)) throw new Error(`Invalid configuration ${path}: ${validate.errors?.map(e => e.message).join('; ')}`);
  const config = value as DiskConfig;
  for (const provider of Object.values(config.providers ?? {})) {
    if (provider.baseURL === undefined) continue;
    let url: URL;
    try { url = new URL(provider.baseURL); } catch { throw new Error(`Invalid provider endpoint URL: ${path}`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`Provider endpoint must be an HTTP(S) URL without embedded credentials: ${path}`);
    }
    for (const key of url.searchParams.keys()) {
      if (/^(?:(?:x?api|access|secret)?key|(?:api|access|refresh|auth|id|bearer|security)?token|auth(?:orization)?|(?:client)?secret|password|sig(?:nature)?)$/i.test(key.replace(/[-_]/g, ''))) {
        throw new Error(`Provider endpoint must not contain credential query parameters; use apiKeyEnv or protected headers: ${path}`);
      }
    }
  }
  return config;
}
async function disk(path: string, protectedConfig: boolean): Promise<DiskConfig> {
  return await exists(path) ? parseConfig(await boundedRead(path, protectedConfig), path) : {};
}
function merge(base: Config, layer: DiskConfig): Config {
  const result = { ...base, ...layer, providers: { ...base.providers, ...layer.providers }, aliases: { ...base.aliases, ...layer.aliases }, templates: { ...base.templates, ...layer.templates } };
  const models = new Map(base.models.map(model => [`${model.provider}/${model.id}`, model]));
  for (const model of layer.models ?? []) models.set(`${model.provider}/${model.id}`, model);
  result.models = [...models.values()];
  return result;
}
export function selectModel(config: Config, key = config.model, provider?: string): Model {
  key = config.aliases[key] ?? key;
  const model = config.models.find(model => `${model.provider}/${model.id}` === key || (model.id === key && (!provider || provider === model.provider)));
  if (!model || (provider && model.provider !== provider)) throw new Error(`Unknown model: ${key}. Use kiln models or /model.`);
  if (config.enabledModels && !config.enabledModels.some(scope => (config.aliases[scope] ?? scope) === `${model.provider}/${model.id}` || scope === model.id || scope === `${model.provider}/*`)) {
    throw new Error(`Model is outside enabledModels: ${model.provider}/${model.id}`);
  }
  if (!config.providers[model.provider]) throw new Error(`Provider is not configured: ${model.provider}`);
  if (model.maxOutput >= model.contextWindow) throw new Error('Model maxOutput must be smaller than contextWindow');
  return model;
}
export function credentials(config: Config): string[] {
  return [...config.secrets, ...Object.values(config.providers).flatMap(provider => [provider.apiKey ?? '',
    process.env[provider.apiKeyEnv ?? (provider.type === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY')] ?? '',
    ...Object.values(provider.headers ?? {}).flatMap(value => {
      const token = /^\s*Bearer\s+(.+?)\s*$/i.exec(value)?.[1];
      return token ? [value, token] : [value];
    })]), ...config.servers.flatMap(server => Object.values(server.env ?? {})), ...config.lsp.flatMap(server => Object.values(server.env ?? {}))].filter(Boolean);
}
export async function loadConfig(options: { cwd?: string; configDir?: string; stateDir?: string; trust?: boolean; prompt?: PermissionPrompt; signal: AbortSignal }): Promise<LoadedConfig> {
  const cwd = await realpath(resolve(options.cwd ?? process.cwd()));
  const configDir = resolve(options.configDir ?? process.env.KILN_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'kiln'));
  const stateDir = resolve(options.stateDir ?? process.env.KILN_STATE_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'kiln'));
  const user = await disk(join(configDir, 'config.json'), true);
  const paths: string[] = [];
  let current = cwd;
  while (true) {
    paths.unshift(current);
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  const candidates: { path: string; kind: string; content: string }[] = [];
  for (const dir of paths) for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const path = join(dir, name); if (await exists(path)) candidates.push({ path, kind: 'instructions', content: await boundedRead(path) });
  }
  const projectConfig = join(cwd, '.kiln', 'config.json');
  if (await exists(projectConfig)) candidates.push({ path: projectConfig, kind: 'config', content: await boundedRead(projectConfig) });
  const trustFile = join(configDir, 'trust.json');
  const trustRecords: Record<string, string> = Object.create(null) as Record<string, string>;
  if (await exists(trustFile)) {
    let data: unknown;
    try { data = JSON.parse(await boundedRead(trustFile, true)); }
    catch (error) { if (error instanceof SyntaxError) throw new Error(`Invalid JSON trust records: ${trustFile}`); throw error; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid project trust records: ${trustFile}`);
    for (const [root, fingerprint] of Object.entries(data)) {
      if (!isAbsolute(root) || resolve(root) !== root || root.includes('\0') || typeof fingerprint !== 'string') {
        throw new Error(`Invalid project trust records: ${trustFile}`);
      }
      trustRecords[root] = fingerprint;
    }
  }
  // Fingerprint and load the same snapshots, even if files change during approval.
  // Extension modules themselves remain trusted executable code, not sandboxed snapshots.
  const fingerprint = hash(candidates.map(item => `${item.path}\n${item.content}`).join('\n'));
  let trusted = options.trust === true || trustRecords[cwd] === fingerprint;
  if (!trusted && candidates.length && options.prompt) {
    const answer = await options.prompt({ id: 'project-trust', tool: 'project_trust', action: 'extension', resource: cwd, cwd,
      reason: `Trust this project's instructions, configuration, extensions, and configured processes? Trusted extensions execute arbitrary code, not in a sandbox.\n${candidates.map(item => item.path).join('\n')}` }, options.signal);
    trusted = answer.decision !== 'deny';
    if (answer.decision === 'session' || answer.decision === 'pattern') {
      await mkdir(configDir, { recursive: true, mode: 0o700 });
      trustRecords[cwd] = fingerprint;
      await atomicWrite(trustFile, JSON.stringify(trustRecords, null, 2) + '\n');
    }
  }
  const projectSnapshot = candidates.find(item => item.path === projectConfig);
  const project = trusted && projectSnapshot ? parseConfig(projectSnapshot.content, projectConfig) : {};
  if (project.providers && Object.values(project.providers).some(p => p.apiKey)) throw new Error('Project configuration may not contain apiKey values; use apiKeyEnv');
  if (project.permissions?.length) throw new Error('Remembered permission rules belong in protected user configuration, not project configuration');
  const config = merge(merge(structuredClone(defaults), user), project);
  config.secrets = [...(user.secrets ?? []), ...(project.secrets ?? [])];
  const redact = redactor(credentials(config));
  const sources = candidates.map(({ path, kind }) => ({ path, kind, loaded: trusted }));
  const instructions: string[] = [];
  const userInstructions = join(configDir, 'instructions.md');
  if (await exists(userInstructions)) {
    instructions.push(`USER INSTRUCTIONS (${userInstructions}):\n${await boundedRead(userInstructions)}`);
    sources.unshift({ path: userInstructions, kind: 'user instructions', loaded: true });
  }
  if (user.instructions) instructions.push(`USER CONFIG INSTRUCTIONS:\n${user.instructions}`);
  if (trusted) for (const item of candidates.filter(item => item.kind === 'instructions')) instructions.push(`PROJECT INSTRUCTIONS (${item.path}):\n${item.content}`);
  if (trusted && project.instructions) instructions.push(`PROJECT CONFIG INSTRUCTIONS:\n${project.instructions}`);
  const instructionText = redact(instructions.join('\n\n'));
  if (Buffer.byteLength(instructionText) > 256 * 1024) throw new Error('Combined instructions exceed 256 KiB; reduce instruction files');
  return { config, configDir, stateDir, cwd, trusted, sources, instructions: instructionText,
    userExtensions: (user.extensions ?? []).map(path => resolve(configDir, path)), projectExtensions: (project.extensions ?? []).map(path => resolve(cwd, path)),
    rules: user.permissions ?? [], redact };
}
export function inspectConfig(loaded: LoadedConfig): Record<string, unknown> {
  const config = structuredClone(loaded.config);
  for (const provider of Object.values(config.providers)) { delete provider.apiKey; delete provider.headers; }
  config.secrets = [];
  return redactValue({ config, cwd: loaded.cwd, trusted: loaded.trusted, sources: loaded.sources, configDir: loaded.configDir, stateDir: loaded.stateDir }, loaded.redact);
}
