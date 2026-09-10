import { Ajv, type ValidateFunction } from 'ajv';
import type { Emit, ProcessServerConfig, Tool, ToolContext, ToolResult } from './types.js';
import { isRecord, ProcessRpc, validResourceName, waitFor } from './rpc.js';
import { checkAbort, errorMessage } from './util.js';

export const EXTERNAL_PROTOCOL = 'kiln-tools/1';

export class ExternalTools {
  private rpc: ProcessRpc | undefined;
  private starting: Promise<Tool[]> | undefined;
  private tools: Tool[] | undefined;
  private validators = new Map<string, ValidateFunction>();
  private closed = false;

  constructor(private config: ProcessServerConfig, private cwd: string, private emit: Emit) {}

  async discover(signal: AbortSignal): Promise<Tool[]> {
    checkAbort(signal);
    if (this.closed) throw new Error('External tool server is closed');
    if (this.starting) return waitFor(this.starting, signal);
    if (this.rpc?.alive && this.tools) return [...this.tools];
    const starting = this.start(signal);
    this.starting = starting;
    try { return [...await starting]; }
    finally { if (this.starting === starting) this.starting = undefined; }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.rpc?.close();
    await this.starting?.catch(() => {});
  }

  private async start(signal: AbortSignal): Promise<Tool[]> {
    let rpc: ProcessRpc | undefined;
    try {
      rpc = new ProcessRpc(this.config, this.cwd, {
        framing: 'jsonl',
        notification: (method, params) => {
          if (method !== 'progress') return;
          if (!isRecord(params) || (typeof params.requestId !== 'number' && typeof params.requestId !== 'string')) {
            throw new Error('Invalid progress notification');
          }
          this.emit('external.progress', { ...params, server: this.config.name });
        },
        stderr: bytes => this.emit('external.stderr', { server: this.config.name, bytes }),
        failure: error => {
          if (this.rpc !== rpc) return;
          this.tools = undefined;
          this.validators.clear();
          if (!this.closed) this.emit('external.error', { server: this.config.name, error: error.message });
        },
      });
      this.rpc = rpc;
      const initialized = await rpc.request('initialize', { protocolVersion: EXTERNAL_PROTOCOL, client: { name: 'kiln', apiVersion: 1 } }, signal);
      if (!isRecord(initialized) || initialized.protocolVersion !== EXTERNAL_PROTOCOL) throw new Error(`Server must negotiate ${EXTERNAL_PROTOCOL}`);
      const listed = await rpc.request('tools/list', {}, signal);
      if (!isRecord(listed) || !Array.isArray(listed.tools) || listed.tools.length > 256) throw new Error('Invalid tools/list result');
      const validators = new Map<string, ValidateFunction>();
      const tools: Tool[] = listed.tools.map((spec: unknown) => {
        if (!isRecord(spec) || !validResourceName(spec.name) || typeof spec.description !== 'string' ||
            !isRecord(spec.inputSchema) || spec.inputSchema.type !== 'object' ||
            (spec.readonly !== undefined && typeof spec.readonly !== 'boolean')) throw new Error('Invalid external tool descriptor');
        if (validators.has(spec.name)) throw new Error(`Duplicate external tool: ${spec.name}`);
        const localName = spec.name;
        const validate = new Ajv({ allErrors: true }).compile(spec.inputSchema);
        if ('$async' in validate && validate.$async) throw new Error('Async tool schemas are not supported');
        validators.set(localName, validate);
        return {
          name: `external__${this.config.name}__${localName}`, description: spec.description, inputSchema: spec.inputSchema,
          readonly: false,
          execute: (args, context) => this.execute(localName, args, context),
        };
      });
      if (!rpc.alive || this.closed) throw new Error('Server became unavailable during discovery');
      this.validators = validators;
      this.tools = tools;
      return tools;
    } catch (error) {
      rpc?.fail(new Error(errorMessage(error)));
      throw error;
    }
  }

  private async execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    checkAbort(context.signal);
    if (context.mode === 'plan') throw new Error('External tools are mutating and unavailable in plan mode');
    await this.discover(context.signal);
    const validate = this.validators.get(name);
    if (!validate) throw new Error(`External tool is no longer available: ${this.config.name}/${name}`);
    if (!isRecord(args) || !validate(args)) throw new Error(`Invalid tool arguments: ${JSON.stringify(validate.errors)}`);
    const rpc = this.rpc!;
    await waitFor(Promise.resolve().then(() => {
      checkAbort(context.signal);
      return context.permissions.authorize({
        action: 'extension', resource: `${this.config.name}/${name}`, tool: `external__${this.config.name}__${name}`,
        reason: `Execute trusted external server tool ${this.config.name}/${name}`, cwd: this.cwd,
      }, context.signal);
    }), context.signal);
    checkAbort(context.signal);
    const result = await rpc.request('tools/call', { name, arguments: args }, context.signal);
    checkAbort(context.signal);
    if (!isRecord(result) || typeof result.content !== 'string' ||
        (result.isError !== undefined && typeof result.isError !== 'boolean') ||
        (result.metadata !== undefined && !isRecord(result.metadata))) {
      const error = new Error('Invalid tools/call result');
      rpc.fail(error);
      throw error;
    }
    return { content: result.content, ...(result.isError === undefined ? {} : { isError: result.isError as boolean }),
      ...(result.metadata === undefined ? {} : { metadata: result.metadata as Record<string, unknown> }) };
  }
}
