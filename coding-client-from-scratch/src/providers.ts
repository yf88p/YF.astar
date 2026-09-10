import type { Message, Model, ModelRequest, Provider, ProviderChunk, ProviderConfig, Usage } from './types.js';
import { abortError, checkAbort, redactor } from './util.js';

const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_ARGUMENT_BYTES = 8 * 1024 * 1024;
const IDLE_TIMEOUT_MS = 120_000;
type ObjectValue = Record<string, unknown>;

export class ProviderError extends Error {
  status?: number;
  retryAfterMs?: number;
  contextOverflow: boolean;
  transient: boolean;

  constructor(message: string, options: {
    status?: number; retryAfterMs?: number; contextOverflow?: boolean; transient?: boolean;
  } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.contextOverflow = options.contextOverflow ?? false;
    this.transient = options.transient ?? false;
  }
}

// Prices are dollars per million tokens. Input/output include their cache/reasoning subsets.
export function estimateCost(model: Model, usage: Usage): number {
  if (!model.pricing) return 0;
  const count = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value!) : 0;
  const read = Math.min(count(usage.input), count(usage.cacheRead));
  const write = Math.min(count(usage.input) - read, count(usage.cacheWrite));
  const prices = model.pricing;
  return ((count(usage.input) - read - write) * prices.input
    + read * (prices.cacheRead ?? prices.input)
    + write * (prices.cacheWrite ?? prices.input)
    + count(usage.output) * prices.output) / 1_000_000;
}

function malformed(detail: string): ProviderError {
  return new ProviderError(`Malformed provider stream: ${detail}`);
}

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw malformed('expected an object');
  return value as ObjectValue;
}

function parseJSON(value: string): ObjectValue {
  try { return object(JSON.parse(value)); } catch { throw malformed('invalid JSON object'); }
}

function index(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw malformed('invalid index');
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw malformed('expected a string');
  return value;
}

function endpoint(config: ProviderConfig): string {
  const route = config.type === 'anthropic' ? '/messages' : '/chat/completions';
  const url = new URL(config.baseURL ?? (config.type === 'anthropic'
    ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ProviderError('Provider endpoint must be an HTTP(S) URL without embedded credentials');
  }
  for (const key of url.searchParams.keys()) {
    if (/^(?:(?:x?api|access|secret)?key|(?:api|access|refresh|auth|id|bearer|security)?token|auth(?:orization)?|(?:client)?secret|password|sig(?:nature)?)$/i.test(key.replace(/[-_]/g, ''))) {
      throw new ProviderError('Provider endpoint must not contain credential query parameters; use apiKeyEnv or headers');
    }
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith(route) ? path : `${path || '/v1'}${route}`;
  return url.toString();
}

function content(message: Message, type: ProviderConfig['type']): ObjectValue[] {
  const parts: ObjectValue[] = [];
  if (message.content) parts.push({ type: 'text', text: message.content });
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === 'text') {
      parts.push({ type: 'text', text: `[Attachment: ${attachment.path}]\n${attachment.data}` });
    } else {
      const data = attachment.data.replace(/^data:[^,]*;base64,/, '');
      parts.push(type === 'anthropic'
        ? { type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data } }
        : { type: 'image_url', image_url: { url: `data:${attachment.mediaType};base64,${data}` } });
    }
  }
  return parts;
}

function requestBody(config: ProviderConfig, request: ModelRequest): ObjectValue {
  const maxOutput = request.maxOutput ?? request.model.maxOutput;
  if (!Number.isSafeInteger(maxOutput) || maxOutput <= 0) throw new ProviderError('maxOutput must be a positive integer');
  const thinking = request.model.capabilities.reasoning && request.thinking && request.thinking !== 'off'
    ? request.thinking : undefined;
  const messages: ObjectValue[] = [];
  if (config.type === 'anthropic') {
    for (const message of request.messages) {
      let parts = content(message, config.type);
      if (message.role === 'tool') {
        if (!message.toolCallId) throw new ProviderError('Tool result is missing its toolCallId');
        parts = [{ type: 'tool_result', tool_use_id: message.toolCallId,
          content: parts.length ? parts : '', ...(message.isError ? { is_error: true } : {}) }];
      } else if (message.role === 'assistant') {
        if (message.reasoning && message.reasoningSignature) {
          parts.unshift({ type: 'thinking', thinking: message.reasoning, signature: message.reasoningSignature });
        }
        for (const call of message.toolCalls ?? []) {
          if (!call.id || !call.name) throw new ProviderError('Tool call is missing its id or name');
          parts.push({ type: 'tool_use', id: call.id, name: call.name, input: parseJSON(call.arguments) });
        }
      }
      const role = message.role === 'tool' ? 'user' : message.role;
      const previous = messages.at(-1);
      if (previous?.role === role) (previous.content as ObjectValue[]).push(...parts);
      else messages.push({ role, content: parts });
    }
    const body: ObjectValue = { model: request.model.id, system: request.system, messages,
      max_tokens: maxOutput, stream: true };
    if (request.tools.length) body.tools = request.tools.map(tool => ({
      name: tool.name, description: tool.description, input_schema: tool.inputSchema,
    }));
    if (thinking) {
      if (maxOutput <= 1024) throw new ProviderError('Anthropic thinking requires maxOutput greater than 1024');
      body.thinking = { type: 'enabled', budget_tokens: Math.min(
        { low: 1024, medium: 4096, high: 8192 }[thinking], maxOutput - 1,
      ) };
    }
    return body;
  }

  if (request.system) messages.push({ role: 'system', content: request.system });
  let toolImages: ObjectValue[] = [];
  for (const message of request.messages) {
    // Chat Completions permits images in user messages, not in tool-result content.
    if (message.role !== 'tool' && toolImages.length) {
      messages.push({ role: 'user', content: toolImages });
      toolImages = [];
    }
    const parts = content(message, config.type);
    if (message.role === 'tool') {
      if (!message.toolCallId) throw new ProviderError('Tool result is missing its toolCallId');
      messages.push({ role: 'tool', tool_call_id: message.toolCallId,
        content: parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n') });
      const images = parts.filter(part => part.type === 'image_url');
      if (images.length) toolImages.push({ type: 'text', text: `Images from tool result ${message.toolCallId}:` }, ...images);
      continue;
    }
    if (message.role === 'assistant' && parts.some(part => part.type === 'image_url')) {
      throw new ProviderError('OpenAI assistant messages cannot contain image attachments');
    }
    const wire: ObjectValue = { role: message.role, content: message.attachments?.length
      ? parts : message.content || (message.role === 'assistant' ? null : '') };
    if (message.role === 'assistant' && message.reasoning) wire.reasoning_content = message.reasoning;
    if (message.role === 'assistant' && message.toolCalls?.length) wire.tool_calls = message.toolCalls.map(call => {
      if (!call.id || !call.name) throw new ProviderError('Tool call is missing its id or name');
      parseJSON(call.arguments);
      return { id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } };
    });
    messages.push(wire);
  }
  if (toolImages.length) messages.push({ role: 'user', content: toolImages });
  const body: ObjectValue = { model: request.model.id, messages, stream: true,
    stream_options: { include_usage: true }, max_completion_tokens: maxOutput };
  if (request.tools.length) body.tools = request.tools.map(tool => ({ type: 'function', function: {
    name: tool.name, description: tool.description, parameters: tool.inputSchema,
  } }));
  if (thinking) body.reasoning_effort = thinking;
  return body;
}

type Read = () => Promise<ReadableStreamReadResult<Uint8Array>>;

async function* events(read: Read): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '';
  let data: string[] = [];
  let event = '';
  let bytes = 0;
  let carriageReturn = false;
  while (true) {
    const next = await read();
    let decoded: string;
    try { decoded = decoder.decode(next.value, { stream: !next.done }); }
    catch { throw malformed('invalid UTF-8'); }
    for (const character of decoded) {
      if (carriageReturn && character === '\n') { carriageReturn = false; continue; }
      carriageReturn = character === '\r';
      bytes += Buffer.byteLength(character);
      if (bytes > MAX_EVENT_BYTES) throw malformed('SSE event exceeds size limit');
      if (character !== '\n' && character !== '\r') { line += character; continue; }
      if (line === '') {
        const result = data.length ? { event, data: data.join('\n') } : undefined;
        data = []; event = ''; bytes = 0;
        if (result) yield result;
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') data.push(value);
        if (field === 'event') event = value;
      }
      line = '';
    }
    if (next.done) {
      if (line || data.length || event) throw malformed('unterminated SSE event');
      return;
    }
  }
}

function failure(payload: unknown, redact: (value: string) => string, status?: number, retryAfter?: string | null): ProviderError {
  const root = payload && typeof payload === 'object' ? payload as ObjectValue : {};
  const error = root.error && typeof root.error === 'object' ? root.error as ObjectValue : root;
  const code = [error.type, error.code].filter(value => typeof value === 'string').join(' ');
  const message = typeof error.message === 'string' ? error.message : typeof payload === 'string' ? payload : '';
  const contextOverflow = /context[_ -]?(length|window|limit)|maximum context|prompt (?:is )?too long|input (?:is )?too long|too many (?:input )?tokens|exceeds?.*(?:context|token limit)/i.test(`${code} ${message}`);
  const inferredStatus = /rate_limit/.test(code) ? 429 : /overloaded/.test(code) ? 529 : /api_error|server_error/.test(code) ? 500 : undefined;
  status ??= inferredStatus;
  let retryAfterMs: number | undefined;
  if (retryAfter?.trim()) {
    const seconds = Number(retryAfter);
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(milliseconds)) retryAfterMs = Math.max(0, milliseconds);
  }
  const detail = redact(message || code).slice(0, 1000);
  return new ProviderError(`Provider error${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`, {
    status, retryAfterMs, contextOverflow,
    transient: !contextOverflow && (status === 408 || status === 409 || status === 425 || status === 429 || (status !== undefined && status >= 500)),
  });
}

async function* chunks(type: ProviderConfig['type'], read: Read, model: Model, redact: (value: string) => string): AsyncGenerator<ProviderChunk> {
  const usage: Usage = { input: 0, output: 0 };
  let uncachedInput = 0;
  let argumentBytes = 0;
  let started = false;
  let reason: 'stop' | 'length' | 'tool-use' | undefined;
  const blocks = new Map<number, { type: string; stopped: boolean }>();
  const calls = new Map<number, { id?: string; name?: string; arguments: string; initial?: ObjectValue }>();
  const updateUsage = (value: unknown): ProviderChunk => {
    const raw = object(value);
    const assign = (key: keyof Usage, value: unknown) => {
      if (value === undefined || value === null) return;
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw malformed('invalid usage');
      usage[key] = value;
    };
    if (type === 'anthropic') {
      if (raw.input_tokens !== undefined) {
        assign('input', raw.input_tokens);
        uncachedInput = usage.input;
      }
      assign('cacheRead', raw.cache_read_input_tokens);
      assign('cacheWrite', raw.cache_creation_input_tokens);
      assign('output', raw.output_tokens);
      assign('reasoning', raw.reasoning_tokens);
      usage.input = uncachedInput + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    } else {
      assign('input', raw.prompt_tokens);
      assign('output', raw.completion_tokens);
      if (raw.prompt_tokens_details) assign('cacheRead', object(raw.prompt_tokens_details).cached_tokens);
      if (raw.completion_tokens_details) assign('reasoning', object(raw.completion_tokens_details).reasoning_tokens);
    }
    if (model.pricing) usage.cost = estimateCost(model, usage);
    return { type: 'usage', usage: { ...usage } };
  };
  const appendArguments = (call: { arguments: string }, value: unknown): string => {
    const fragment = text(value);
    argumentBytes += Buffer.byteLength(fragment);
    if (argumentBytes > MAX_ARGUMENT_BYTES) throw malformed('tool arguments exceed size limit');
    call.arguments += fragment;
    return fragment;
  };
  const validateCalls = () => {
    if (reason === 'tool-use' && calls.size === 0) throw malformed('tool-use stop without tool calls');
    const ids = new Set<string>();
    for (const call of calls.values()) {
      if (!call.id || !call.name || ids.has(call.id)) throw malformed('missing or duplicate tool identity');
      ids.add(call.id);
      parseJSON(call.arguments);
    }
  };
  const stopReason = (value: unknown): typeof reason => {
    if (value === 'tool_use' || value === 'tool_calls') return 'tool-use';
    if (value === 'max_tokens' || value === 'length' || value === 'model_context_window_exceeded') return 'length';
    if (['end_turn', 'stop_sequence', 'stop', 'pause_turn', 'refusal'].includes(String(value))) return 'stop';
    throw malformed('missing or unsupported stop reason');
  };

  for await (const event of events(read)) {
    if (type === 'openai' && event.data === '[DONE]') {
      if (!reason) throw malformed('stream ended without a finish reason');
      validateCalls();
      yield { type: 'stop', reason };
      return;
    }
    const raw = parseJSON(event.data);
    if (event.event === 'error' || raw.type === 'error' || raw.error) throw failure(raw, redact);
    if (type === 'openai') {
      if (raw.usage !== undefined && raw.usage !== null) yield updateUsage(raw.usage);
      if (!Array.isArray(raw.choices)) throw malformed('missing choices');
      for (const value of raw.choices) {
        const choice = object(value);
        if (index(choice.index) !== 0) throw malformed('unexpected choice index');
        const delta = object(choice.delta);
        if (reason && (delta.content || delta.refusal || delta.reasoning_content || delta.reasoning || delta.tool_calls || choice.finish_reason)) {
          throw malformed('content after finish reason');
        }
        if (delta.content !== undefined && delta.content !== null) yield { type: 'text', text: text(delta.content) };
        if (delta.refusal !== undefined && delta.refusal !== null) yield { type: 'text', text: text(delta.refusal) };
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (reasoning !== undefined && reasoning !== null) yield { type: 'reasoning', text: text(reasoning) };
        if (delta.tool_calls !== undefined) {
          if (!Array.isArray(delta.tool_calls)) throw malformed('invalid tool calls');
          for (const value of delta.tool_calls) {
            const tool = object(value);
            const i = index(tool.index);
            if (tool.type !== undefined && tool.type !== 'function') throw malformed('unsupported tool type');
            let call = calls.get(i);
            if (!call) {
              if (calls.size >= 128) throw malformed('too many tool calls');
              call = { arguments: '' }; calls.set(i, call);
            }
            const chunk: Extract<ProviderChunk, { type: 'tool' }> = { type: 'tool', index: i };
            if (tool.id !== undefined) {
              const id = text(tool.id);
              if (call.id !== undefined && call.id !== id) throw malformed('tool id changed');
              if (call.id === undefined) chunk.id = id;
              call.id = id;
            }
            if (tool.function !== undefined) {
              const fn = object(tool.function);
              if (fn.name !== undefined) {
                const name = text(fn.name);
                if (call.name !== undefined && call.name !== name) throw malformed('tool name changed');
                if (call.name === undefined) chunk.name = name;
                call.name = name;
              }
              if (fn.arguments !== undefined) chunk.arguments = appendArguments(call, fn.arguments);
            }
            yield chunk;
          }
        }
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) reason = stopReason(choice.finish_reason);
      }
      continue;
    }

    if (event.event && event.event !== raw.type) throw malformed('SSE event type mismatch');
    switch (raw.type) {
      case 'ping': break;
      case 'message_start': {
        if (started) throw malformed('duplicate message start');
        started = true;
        const message = object(raw.message);
        if (message.usage) yield updateUsage(message.usage);
        break;
      }
      case 'content_block_start': {
        if (!started || reason) throw malformed('unexpected content block');
        const i = index(raw.index);
        if (blocks.has(i) || blocks.size >= 1024) throw malformed('duplicate or excessive content blocks');
        const block = object(raw.content_block);
        const kind = text(block.type);
        blocks.set(i, { type: kind, stopped: false });
        if (kind === 'text' && block.text) yield { type: 'text', text: text(block.text) };
        else if (kind === 'thinking' && (block.thinking || block.signature)) yield {
          type: 'reasoning', text: text(block.thinking ?? ''),
          ...(block.signature ? { signature: text(block.signature) } : {}),
        };
        else if (kind === 'tool_use') {
          if (calls.size >= 128) throw malformed('too many tool calls');
          const call = { id: text(block.id), name: text(block.name), arguments: '', initial: object(block.input) };
          calls.set(i, call);
          yield { type: 'tool', index: i, id: call.id, name: call.name };
        } else if (!['text', 'thinking', 'redacted_thinking'].includes(kind)) throw malformed('unsupported content block');
        break;
      }
      case 'content_block_delta': {
        const i = index(raw.index);
        const block = blocks.get(i);
        if (!block || block.stopped || reason) throw malformed('delta for inactive block');
        const delta = object(raw.delta);
        if (delta.type === 'text_delta' && block.type === 'text') yield { type: 'text', text: text(delta.text) };
        else if (delta.type === 'thinking_delta' && block.type === 'thinking') yield { type: 'reasoning', text: text(delta.thinking) };
        else if (delta.type === 'signature_delta' && block.type === 'thinking') yield { type: 'reasoning', text: '', signature: text(delta.signature) };
        else if (delta.type === 'input_json_delta' && block.type === 'tool_use') {
          yield { type: 'tool', index: i, arguments: appendArguments(calls.get(i)!, delta.partial_json) };
        } else throw malformed('unexpected content delta');
        break;
      }
      case 'content_block_stop': {
        const i = index(raw.index);
        const block = blocks.get(i);
        if (!block || block.stopped) throw malformed('stop for inactive block');
        block.stopped = true;
        const call = calls.get(i);
        if (call) {
          if (!call.arguments) yield { type: 'tool', index: i, arguments: appendArguments(call, JSON.stringify(call.initial)) };
          parseJSON(call.arguments);
          delete call.initial;
        }
        break;
      }
      case 'message_delta': {
        if (!started || reason || [...blocks.values()].some(block => !block.stopped)) throw malformed('unexpected message delta');
        const delta = object(raw.delta);
        if (delta.stop_reason !== undefined && delta.stop_reason !== null) reason = stopReason(delta.stop_reason);
        if (raw.usage) yield updateUsage(raw.usage);
        break;
      }
      case 'message_stop':
        if (!started || !reason || [...blocks.values()].some(block => !block.stopped)) throw malformed('stream ended without complete message');
        validateCalls();
        yield { type: 'stop', reason };
        return;
      default: throw malformed('unsupported event');
    }
  }
  throw new ProviderError('Provider stream disconnected before its terminal event', { transient: true });
}

export function createProvider(config: ProviderConfig): Provider {
  if (config.type !== 'anthropic' && config.type !== 'openai') throw new ProviderError('Unsupported provider type');
  let url: string;
  try { url = endpoint(config); } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('Invalid provider endpoint URL');
  }
  const env = config.apiKeyEnv ?? (config.baseURL === undefined
    ? (config.type === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY') : undefined);
  return {
    async *stream(request) {
      checkAbort(request.signal);
      const key = config.apiKey ?? (env === undefined ? undefined : process.env[env]);
      const headers = new Headers({ 'content-type': 'application/json', accept: 'text/event-stream' });
      try {
        if (config.type === 'anthropic') {
          headers.set('anthropic-version', '2023-06-01');
          if (key) headers.set('x-api-key', key);
        } else if (key) headers.set('authorization', `Bearer ${key}`);
        for (const [name, value] of Object.entries(config.headers ?? {})) headers.set(name, value);
      } catch {
        throw new ProviderError('Invalid provider credential or request header');
      }
      if (!headers.has('authorization') && !headers.has('x-api-key') && env !== undefined) {
        throw new ProviderError(`Missing provider credential; set ${env} or configure apiKey`);
      }
      const redact = redactor([key ?? '', ...Object.values(config.headers ?? {}).flatMap(value => [value, value.replace(/^Bearer\s+/i, '')])]);
      const body = JSON.stringify(requestBody(config, request));
      const controller = new AbortController();
      const cancel = () => controller.abort();
      request.signal.addEventListener('abort', cancel, { once: true });
      let timedOut = false;
      let httpError: ProviderError | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const network = async <T>(operation: () => Promise<T>): Promise<T> => {
        checkAbort(request.signal);
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, IDLE_TIMEOUT_MS);
        timer.unref();
        try { return await operation(); } finally { clearTimeout(timer); }
      };
      try {
        const response = await network(() => fetch(url, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error' }));
        if (response.body) reader = response.body.getReader();
        const read: Read = () => network(() => reader ? reader.read() : Promise.resolve({ done: true, value: undefined }));
        if (!response.ok) {
          httpError = failure(undefined, redact, response.status, response.headers.get('retry-after'));
          const buffers: Uint8Array[] = [];
          let size = 0;
          while (size < 65_536) {
            const next = await read();
            if (next.done) break;
            buffers.push(next.value.subarray(0, 65_536 - size));
            size += next.value.byteLength;
          }
          const responseText = Buffer.concat(buffers).toString('utf8');
          let payload: unknown = responseText;
          try { payload = JSON.parse(responseText); } catch { /* HTTP errors need not contain JSON. */ }
          throw failure(payload, redact, response.status, response.headers.get('retry-after'));
        }
        if (response.headers.get('content-type')?.toLowerCase().split(';')[0]?.trim() !== 'text/event-stream') {
          throw malformed('expected text/event-stream response');
        }
        if (!reader) throw malformed('missing response body');
        for await (const chunk of chunks(config.type, read, request.model, redact)) {
          checkAbort(request.signal);
          yield chunk;
        }
      } catch (error) {
        if (request.signal.aborted) throw abortError();
        if (error instanceof ProviderError) throw error;
        if (httpError) throw httpError;
        if (timedOut) throw new ProviderError('Provider request timed out waiting for network data', { transient: true });
        throw new ProviderError('Provider connection failed or stream disconnected', { transient: true });
      } finally {
        request.signal.removeEventListener('abort', cancel);
        controller.abort();
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
      }
    },
  };
}
