import { Ajv } from 'ajv';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Emit, Tool, ToolResult } from './types.js';
import { isRecord, validResourceName, waitFor } from './rpc.js';
import { checkAbort, errorMessage, KeyedQueue } from './util.js';

const ACTIVATION_TIMEOUT_MS = 5000;
const CALLBACK_TIMEOUT_MS = 2000;

type Hook = (payload: Record<string, unknown> & { signal: AbortSignal }) => void | Promise<void>;
type Command = (args: string) => Promise<string>;
type Status = (signal: AbortSignal) => string | Promise<string>;

async function bounded<T>(callback: (signal: AbortSignal) => T | Promise<T>, timeoutMs: number, parent: AbortSignal): Promise<T> {
  const deadline = new AbortController();
  const signal = AbortSignal.any([parent, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(new Error(`Extension callback timed out after ${timeoutMs} ms`)), timeoutMs);
  try {
    const result = await waitFor(Promise.resolve().then(() => { signal.throwIfAborted(); return callback(signal); }), signal);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error;
  } finally { clearTimeout(timer); }
}

export interface ExtensionAPI {
  cwd: string;
  emit: Emit;
  readonly signal: AbortSignal;
  registerTool(tool: Tool): void;
  registerCommand(name: string, handler: (args: string, signal: AbortSignal) => string | Promise<string>): void;
  registerTemplate(name: string, prompt: string): void;
  on(name: string, callback: Hook): void;
  registerStatus(callback: Status): void;
}

export interface ExtensionInspection {
  path: string;
  name?: string;
  source: 'user' | 'project';
  loaded: boolean;
  errors: string[];
  resources: { tools: string[]; commands: string[]; templates: string[]; hooks: string[]; statuses: number };
}

export class ExtensionHost {
  readonly tools: Tool[] = [];
  readonly commands = new Map<string, Command>();
  readonly templates: Record<string, string> = Object.create(null) as Record<string, string>;
  private records: ExtensionInspection[] = [];
  private names = new Set<string>();
  private hooks = new Map<string, { record: ExtensionInspection; callback: Hook }[]>();
  private statusCallbacks: { record: ExtensionInspection; callback: Status }[] = [];
  private cleanups: { record: ExtensionInspection; callback: (signal: AbortSignal) => unknown }[] = [];
  private queue = new KeyedQueue();
  private lifetime = new AbortController();
  private closing: Promise<void> | undefined;
  private closed = false;

  constructor(private options: { cwd: string; emit: Emit; trusted: boolean }) {}

  async load(paths: string[], source: 'user' | 'project'): Promise<void> {
    await this.queue.run('load', async () => {
      if (this.closed) throw new Error('Extension host is closed');
      for (const path of paths) {
        if (this.closed) break;
        await this.loadOne(path, source);
      }
    });
  }

  inspect(): ExtensionInspection[] { return structuredClone(this.records); }

  async hook(name: string, payload: Record<string, unknown>): Promise<void> {
    if (this.closed) return;
    const parent = payload.signal instanceof AbortSignal ? AbortSignal.any([payload.signal, this.lifetime.signal]) : this.lifetime.signal;
    for (const { record, callback } of this.hooks.get(name) ?? []) {
      if (parent.aborted) break;
      try { await bounded(signal => callback({ ...payload, signal }), CALLBACK_TIMEOUT_MS, parent); }
      catch (error) { this.report(record, `hook ${name}`, error); }
    }
  }

  async statuses(): Promise<string[]> {
    if (this.closed) return [];
    const statuses: string[] = [];
    for (const { record, callback } of this.statusCallbacks) {
      if (this.closed) break;
      try {
        const status = await bounded(callback, CALLBACK_TIMEOUT_MS, this.lifetime.signal);
        if (typeof status !== 'string') throw new Error('Status callback must return a string');
        statuses.push(status);
      } catch (error) { this.report(record, 'status', error); }
    }
    return statuses;
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.lifetime.abort(new Error('Extension host is closed'));
    this.closing = (async () => {
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new Error('Extension close timed out after 2000 ms')), CALLBACK_TIMEOUT_MS);
      try {
        for (const { record, callback } of this.hooks.get('shutdown') ?? []) {
          try { await bounded(signal => callback({ signal }), CALLBACK_TIMEOUT_MS, deadline.signal); }
          catch (error) { this.report(record, 'hook shutdown', error); }
        }
        for (const { record, callback } of [...this.cleanups].reverse()) {
          try { await bounded(callback, CALLBACK_TIMEOUT_MS, deadline.signal); }
          catch (error) { this.report(record, 'cleanup', error); }
        }
      } finally { clearTimeout(timer); }
    })();
    return this.closing;
  }

  private report(record: ExtensionInspection, stage: string, error: unknown): string {
    const message = `${stage}: ${errorMessage(error)}`;
    record.errors.push(message);
    if (record.errors.length > 100) record.errors.shift();
    try { this.options.emit('extension.error', { extension: record.name, path: record.path, source: record.source, error: message }); } catch { /* Isolate reporting failures. */ }
    return message;
  }

  private async loadOne(path: string, source: 'user' | 'project'): Promise<void> {
    const record: ExtensionInspection = {
      path: resolve(this.options.cwd, path), source, loaded: false, errors: [],
      resources: { tools: [], commands: [], templates: [], hooks: [], statuses: 0 },
    };
    this.records.push(record);
    try {
      if (source !== 'user' && source !== 'project') throw new Error('Invalid extension source');
      if (source === 'project' && !this.options.trusted) throw new Error('Project extensions require explicit project trust before import');
      const manifestPath = await realpath((await stat(record.path)).isDirectory() ? resolve(record.path, 'extension.json') : record.path);
      const manifestStat = await stat(manifestPath);
      if (!manifestStat.isFile() || manifestStat.size > 65536) throw new Error('Manifest must be a JSON file of at most 64 KiB');
      const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (!isRecord(manifest) || Object.keys(manifest).some(key => !['apiVersion', 'name', 'entry'].includes(key)) ||
          manifest.apiVersion !== 1 || !validResourceName(manifest.name) || typeof manifest.entry !== 'string' || !manifest.entry || isAbsolute(manifest.entry)) {
        throw new Error('Expected manifest {apiVersion:1,name,entry} with a valid name and relative JavaScript entry');
      }
      record.name = manifest.name;
      if (this.names.has(manifest.name)) throw new Error(`Extension namespace already registered: ${manifest.name}`);
      const root = dirname(manifestPath);
      const entry = await realpath(resolve(root, manifest.entry));
      const local = relative(root, entry);
      if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local) || !['.js', '.mjs', '.cjs'].includes(extname(entry))) {
        throw new Error('Entry must be a JavaScript file inside the manifest directory (including symlink resolution)');
      }
      const entryStat = await stat(entry);
      if (!entryStat.isFile()) throw new Error('Extension entry must be a regular file');
      const tools: Tool[] = [];
      const commands = new Map<string, Command>();
      const templates: Record<string, string> = Object.create(null) as Record<string, string>;
      const hooks: { name: string; callback: Hook }[] = [];
      const statuses: Status[] = [];
      const resources = new Set<string>();
      let registering = true;
      let registrationSignal = this.lifetime.signal;
      const active = () => {
        if (!registering || registrationSignal.aborted || this.closed) throw new Error('Resources may only be registered during activation');
      };
      const nameFor = (name: string): string => {
        active();
        if (!validResourceName(name)) throw new Error(`Invalid resource name: ${name}`);
        const fullName = `ext__${manifest.name}__${name}`;
        if (resources.has(fullName)) throw new Error(`Resource already registered: ${fullName}`);
        resources.add(fullName);
        return fullName;
      };
      const api: ExtensionAPI = {
        cwd: resolve(this.options.cwd), emit: this.options.emit,
        get signal() { return registrationSignal; },
        registerTool: tool => {
          active();
          if (!isRecord(tool) || typeof tool.description !== 'string' || typeof tool.readonly !== 'boolean' ||
              typeof tool.execute !== 'function' || !isRecord(tool.inputSchema) || tool.inputSchema.type !== 'object') {
            throw new Error('Invalid tool: description, readonly, execute and an object inputSchema are required');
          }
          const inputSchema = structuredClone(tool.inputSchema);
          const validate = new Ajv({ allErrors: true }).compile(inputSchema);
          if ('$async' in validate && validate.$async) throw new Error('Async tool schemas are not supported');
          const localName = tool.name;
          const name = nameFor(localName);
          const execute = tool.execute.bind(tool);
          const readonly = tool.readonly;
          tools.push({ name, description: tool.description, inputSchema, readonly, execute: async (args, context): Promise<ToolResult> => {
            checkAbort(context.signal);
            try {
              if (this.closed || !record.loaded) throw new Error('Extension is not active');
              if (!readonly && context.mode === 'plan') throw new Error('Mutating extension tools are unavailable in plan mode');
              if (!isRecord(args) || !validate(args)) throw new Error(`Invalid arguments: ${JSON.stringify(validate.errors)}`);
              await waitFor(Promise.resolve().then(() => {
                checkAbort(context.signal);
                return context.permissions.authorize({
                  action: 'extension', resource: `${manifest.name}/${localName}`, tool: name,
                  reason: `Execute trusted JavaScript extension tool ${manifest.name}/${localName}`, cwd: context.cwd,
                }, context.signal);
              }), context.signal);
              checkAbort(context.signal);
              const result: unknown = await waitFor(Promise.resolve().then(() => {
                checkAbort(context.signal);
                if (this.closed) throw new Error('Extension is not active');
                return execute(args, context);
              }), context.signal);
              checkAbort(context.signal);
              if (!isRecord(result) || typeof result.content !== 'string' ||
                  (result.isError !== undefined && typeof result.isError !== 'boolean') ||
                  (result.metadata !== undefined && !isRecord(result.metadata))) throw new Error('Tool returned an invalid result');
              return { content: result.content, ...(result.isError === undefined ? {} : { isError: result.isError as boolean }),
                ...(result.metadata === undefined ? {} : { metadata: result.metadata as Record<string, unknown> }) };
            } catch (error) {
              checkAbort(context.signal);
              return { content: this.report(record, `tool ${name}`, error), isError: true };
            }
          } });
        },
        registerCommand: (name, handler) => {
          if (typeof handler !== 'function') throw new Error('Command handler must be a function');
          const fullName = nameFor(name);
          commands.set(fullName, async args => {
            try {
              if (this.closed || !record.loaded) throw new Error('Extension is not active');
              if (typeof args !== 'string') throw new Error('Command arguments must be a string');
              const result = await bounded(signal => handler(args, signal), CALLBACK_TIMEOUT_MS, this.lifetime.signal);
              if (typeof result !== 'string') throw new Error('Command must return a string');
              return result;
            } catch (error) { return this.report(record, `command ${fullName}`, error); }
          });
        },
        registerTemplate: (name, prompt) => {
          if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Template prompt must be a nonempty string');
          templates[nameFor(name)] = prompt;
        },
        on: (name, callback) => {
          active();
          if (typeof name !== 'string' || name.length > 64 || !/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(name) || typeof callback !== 'function') {
            throw new Error('Invalid lifecycle hook or callback');
          }
          hooks.push({ name, callback });
        },
        registerStatus: callback => {
          active();
          if (typeof callback !== 'function') throw new Error('Status callback must be a function');
          statuses.push(callback);
        },
      };
      let cleanup: unknown;
      try {
        cleanup = await bounded(async signal => {
          registrationSignal = signal;
          const module = await import(pathToFileURL(entry).href) as { default?: unknown };
          signal.throwIfAborted();
          if (typeof module.default !== 'function') throw new Error('Extension must default-export an activation function');
          return module.default(api) as unknown;
        }, ACTIVATION_TIMEOUT_MS, this.lifetime.signal);
        if (cleanup !== undefined && typeof cleanup !== 'function') throw new Error('Activation may only return a cleanup function or undefined');
      } finally { registering = false; }
      if (this.closed) throw new Error('Extension host is closed');
      // Publish atomically: a failed activation cannot leave a partial namespace behind.
      this.names.add(manifest.name);
      this.tools.push(...tools);
      for (const [name, handler] of commands) this.commands.set(name, handler);
      Object.assign(this.templates, templates);
      for (const { name, callback } of hooks) {
        const callbacks = this.hooks.get(name) ?? [];
        callbacks.push({ record, callback });
        this.hooks.set(name, callbacks);
      }
      this.statusCallbacks.push(...statuses.map(callback => ({ record, callback })));
      if (typeof cleanup === 'function') this.cleanups.push({ record, callback: cleanup as (signal: AbortSignal) => unknown });
      record.loaded = true;
      record.resources = { tools: tools.map(tool => tool.name), commands: [...commands.keys()], templates: Object.keys(templates),
        hooks: [...new Set(hooks.map(hook => hook.name))], statuses: statuses.length };
    } catch (error) { this.report(record, 'startup', error); }
  }
}
