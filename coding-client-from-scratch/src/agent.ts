import { Ajv, type ValidateFunction } from 'ajv';
import type { Emit, Message, Model, Provider, Session, StopReason, Tool, ToolCall, ToolContext, Usage } from './types.js';
import { estimateCost, ProviderError } from './providers.js';
import { abortError, checkAbort, errorMessage, modelOutput, redactValue, sleep, StreamRedactor, truncate } from './util.js';

export interface RunResult { outcome: 'success' | 'failure' | 'aborted'; reason: string; turns: number; error?: string }
export interface AgentOptions {
  session: Session;
  provider: Provider;
  model: Model;
  system: string;
  tools: Tool[];
  context: Omit<ToolContext, 'signal'>;
  emit: Emit;
  thinking?: 'off' | 'low' | 'medium' | 'high';
  maxTurns?: number;
  retries?: number;
  retryBaseMs?: number;
  hook?: (name: string, payload: Record<string, unknown>) => Promise<void>;
}

export function contextSize(system: string, messages: Message[], tools: Tool[]): number {
  // Deliberately conservative for non-English source; providers remain the authority.
  return Math.ceil(Buffer.byteLength(system + JSON.stringify(messages) + JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))) / 3);
}
export class Agent {
  running = false;
  usage: Usage = { input: 0, output: 0, cost: 0 };
  contextTokens = 0;
  private controller?: AbortController;
  private finalizing = false;
  private sessionHooks: Promise<void> = Promise.resolve();
  private queue: { message: Message; delivery: 'steer' | 'follow-up' }[] = [];
  private validators = new Map<string, ValidateFunction>();
  private toolMap = new Map<string, Tool>();

  constructor(readonly options: AgentOptions) {
    if (!Number.isSafeInteger(options.maxTurns ?? 40) || (options.maxTurns ?? 40) < 1) throw new Error('maxTurns must be positive');
    const ajv = new Ajv({ allErrors: true, strict: true });
    for (const tool of options.tools) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) || this.toolMap.has(tool.name)) throw new Error(`Invalid or duplicate tool: ${tool.name}`);
      const validate = ajv.compile(tool.inputSchema);
      if ('$async' in validate && validate.$async) throw new Error('Async tool schemas are not supported');
      this.validators.set(tool.name, validate); this.toolMap.set(tool.name, tool);
    }
    for (const record of options.session.records().filter(record => record.type === 'usage')) {
      const usage = record.data.usage as Usage | undefined;
      if (usage) this.addUsage(usage);
    }
  }
  get queued(): number { return this.queue.length; }
  abort(): void { this.controller?.abort(); }
  enqueue(message: Message, delivery: 'steer' | 'follow-up' = 'steer'): void {
    if (!this.running || this.finalizing) throw new Error('No active run to queue a message into');
    if (this.queue.length >= 100) throw new Error('Message queue is full (100)');
    this.queue.push({ message, delivery });
    this.options.emit('message.queued', { delivery, queued: this.queue.length, text: message.content });
  }
  private sanitize<T>(value: T): T {
    const { redact } = this.options.context;
    const walk = (item: unknown): unknown => {
      if (typeof item === 'string') return redact(item);
      if (Array.isArray(item)) return item.map(walk);
      if (!item || typeof item !== 'object') return item;
      return Object.fromEntries(Object.entries(item)
        .filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key))
        .map(([key, entry]) => {
          // Tool arguments are opaque JSON strings, including in interrupted/queued records.
          // Only copies are sanitized: approved tools still receive their original arguments.
          if (key === 'arguments' && typeof entry === 'string') {
            try { return [redact(key), JSON.stringify(redactValue(JSON.parse(entry), redact))]; }
            catch { return [redact(key), '{"_omitted":"Incomplete or invalid tool arguments"}']; }
          }
          return [redact(key), walk(entry)];
        }));
    };
    return walk(value) as T;
  }
  private save(type: string, data: Record<string, unknown>): void {
    const record = this.options.session.append(type, this.sanitize(data));
    const hook = this.options.hook;
    if (hook) {
      // Commit order is hook order; observer failures cannot undo a successful append.
      const snapshot = structuredClone(record);
      this.sessionHooks = this.sessionHooks.then(() => hook('session.event', { record: snapshot })).catch(error => {
        try { this.options.emit('warning', { message: `Session hook: ${this.options.context.redact(errorMessage(error))}` }); }
        catch { /* A broken observer sink must not prevent final cleanup. */ }
      });
    }
  }
  private async user(message: Message, committed?: () => void): Promise<void> {
    await this.options.hook?.('prompt.before', { message: structuredClone(message), signal: this.controller?.signal });
    this.save('message', { message });
    committed?.();
    this.options.emit('message.user', { text: message.content, attachments: message.attachments?.map(({ path, kind, mediaType }) => ({ path, kind, mediaType })) });
    await this.options.hook?.('prompt.after', { message: structuredClone(message), signal: this.controller?.signal });
  }
  private async deliver(settled: boolean): Promise<number> {
    const messages = this.queue.filter(entry => settled || entry.delivery === 'steer');
    for (const entry of messages) await this.user(entry.message, () => {
      this.queue.splice(this.queue.indexOf(entry), 1);
    });
    if (messages.length) this.options.emit('message.delivered', { count: messages.length, queued: this.queue.length, boundary: settled ? 'settled' : 'tool-batch' });
    return messages.length;
  }
  private addUsage(usage: Usage): void {
    for (const key of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'cost'] as const) {
      if (usage[key] !== undefined) this.usage[key] = (this.usage[key] ?? 0) + usage[key];
    }
  }
  private available(): Tool[] { return this.options.model.capabilities.tools ? this.options.tools.filter(tool => this.options.context.mode !== 'plan' || tool.readonly) : []; }

  async compact(automatic = false): Promise<void> {
    const history = this.sanitize(this.options.session.history());
    if (!history.length) return;
    this.options.emit('compaction.start', { automatic, beforeTokens: contextSize(this.options.system, history, this.available()) });
    // Extractive compaction does not ask the model to reinterpret facts or spend another request.
    // Keep intent, recent results, and failures with explicit provenance; the full tree remains in SQLite.
    const first = history.find(message => message.role === 'user');
    const selected = [first, ...history.slice(-16)].filter((message, index, all): message is Message => !!message && all.indexOf(message) === index);
    const budget = Math.max(512, Math.min(18000, Math.floor((this.options.model.contextWindow - this.options.model.maxOutput) * 0.5)));
    const perMessage = Math.max(100, Math.floor(budget / (selected.length || 1)));
    const summary = `EXTRACTIVE CONTEXT CHECKPOINT. Excerpts, not verified new facts. Earlier details are omitted; read files again before editing. Full original history remains in this session.\n${selected.map(message => {
      const calls = message.toolCalls?.map(call => `${call.id}: ${call.name}(${truncate(call.arguments, 8, 400).text})`).join('\n') ?? '';
      return `[${message.role}${message.toolName ? ` ${message.toolName}` : ''}${message.isError ? ' FAILED' : ''}]\n${truncate(message.content + (calls ? '\n' + calls : ''), 24, perMessage).text}`;
    }).join('\n\n')}`;
    this.save('compaction', { summary, automatic });
    this.contextTokens = contextSize(this.options.system, this.options.session.history(), this.available());
    this.options.emit('compaction.end', { automatic, afterTokens: this.contextTokens, summary });
  }

  private repairInterruptedBatch(): void {
    const history = this.sanitize(this.options.session.history());
    const pending = new Map<string, ToolCall>();
    for (const message of history) {
      for (const call of message.toolCalls ?? []) pending.set(call.id, call);
      if (message.role === 'tool' && message.toolCallId) pending.delete(message.toolCallId);
    }
    for (const call of pending.values()) this.save('message', { message: { role: 'tool', toolCallId: call.id, toolName: call.name, isError: true,
      content: 'The previous run ended before recording this tool result. Execution is unknown; inspect the current state before retrying.' } satisfies Message });
    if (pending.size) this.options.emit('warning', { message: `Recovered ${pending.size} interrupted tool result(s); no action was replayed.` });
  }

  async run(message: Message): Promise<RunResult> {
    if (this.running) throw new Error('Agent is already running');
    this.running = true; this.controller = new AbortController();
    const signal = this.controller.signal;
    const { emit, model } = this.options;
    let turns = 0;
    let result: RunResult = { outcome: 'failure', reason: 'error', turns };
    try {
      this.repairInterruptedBatch();
      this.save('agent.start', { model: `${model.provider}/${model.id}`, mode: this.options.context.mode });
      emit('agent.start', { model: `${model.provider}/${model.id}`, mode: this.options.context.mode });
      await this.user(message);
      while (true) {
        checkAbort(signal);
        if (turns >= (this.options.maxTurns ?? 40)) throw new Error(`Runaway safeguard: stopped after ${turns} model turns. Review the transcript before continuing or increasing maxTurns.`);
        const tools = this.available();
        this.contextTokens = contextSize(this.options.system, this.options.session.history(), tools);
        emit('context', { tokens: this.contextTokens, window: model.contextWindow });
        if (this.contextTokens > (model.contextWindow - model.maxOutput) * 0.85) await this.compact(true);
        let response: { message: Message; reason: StopReason };
        let overflowRetried = false;
        while (true) {
          try { response = await this.turn(signal, tools); break; }
          catch (error) {
            if (error instanceof ProviderError && error.contextOverflow && !overflowRetried) {
              overflowRetried = true; await this.compact(true);
              emit('retry', { attempt: 1, delayMs: 0, error: 'Context overflow; one safe retry after compaction', contextOverflow: true });
              continue;
            }
            throw error;
          }
        }
        turns++;
        const assistant = response.message;
        if (response.reason === 'length' || response.reason === 'error' || response.reason === 'aborted') {
          this.save('turn.interrupted', { message: assistant, reason: response.reason });
          if (assistant.content || assistant.reasoning) this.save('message', { message: { ...assistant, toolCalls: undefined } });
          if (response.reason === 'aborted') throw abortError();
          throw new Error(response.reason === 'length' ? 'Model output limit reached. Incomplete tool calls were not executed; increase maxOutput or narrow the request.' : 'Model reported an error stop');
        }
        const calls = assistant.toolCalls ?? [];
        if (response.reason === 'tool-use' && !calls.length) throw new Error('Model reported tool use without any tool calls');
        if (calls.length && response.reason !== 'tool-use') throw new Error('Model returned tool calls without a tool-use stop; refusing uncertain execution');
        this.save('message', { message: assistant });
        emit('assistant.end', { reason: response.reason, text: assistant.content });
        if (calls.length) {
          await this.batch(calls, signal);
          await this.deliver(false);
          continue;
        }
        if (await this.deliver(true)) continue;
        result = { outcome: 'success', reason: 'stop', turns };
        break;
      }
    } catch (error) {
      const aborted = signal.aborted || (error instanceof Error && error.name === 'AbortError');
      result = { outcome: aborted ? 'aborted' : 'failure', reason: aborted ? 'aborted' : 'error', turns, error: this.options.context.redact(errorMessage(error)) };
    } finally {
      this.finalizing = true;
      try {
        // One record per entry avoids overflowing the durable store's per-record limit.
        // A failed entry must not prevent later entries or the terminal record from being attempted.
        let unsaved = 0;
        let persistenceError = '';
        for (const entry of this.queue) {
          try { this.save('queue.pending', { messages: [entry] }); }
          catch (error) { unsaved++; persistenceError ||= this.options.context.redact(errorMessage(error)); }
        }
        if (unsaved) result = { outcome: 'failure', reason: 'error', turns,
          error: `Session persistence failed: ${unsaved} queued message(s) could not be saved. ${persistenceError}` };
        try { this.save('agent.end', { ...result }); }
        catch (error) {
          result = { outcome: 'failure', reason: 'error', turns,
            error: `Session persistence failed: could not save agent.end. ${this.options.context.redact(errorMessage(error))}${unsaved ? ` ${unsaved} queued message(s) could not be saved.` : ''}` };
          persistenceError = result.error!;
        }
        await this.sessionHooks;
        if (this.queue.length && !unsaved && !persistenceError) {
          emit('warning', { message: `${this.queue.length} queued message(s) were not delivered; preserved in session records.` });
        }
        if (result.error) emit(result.outcome === 'aborted' ? 'warning' : 'error', { message: result.error });
      } finally {
        this.queue = [];
        this.running = false; this.controller = undefined; this.finalizing = false;
        emit('agent.end', { ...result });
      }
    }
    return result;
  }

  private async turn(signal: AbortSignal, tools: Tool[]): Promise<{ message: Message; reason: StopReason }> {
    const { emit, provider, model } = this.options;
    let attempt = 0;
    while (true) {
      checkAbort(signal);
      let text = ''; let reasoning = ''; let signature = ''; let reason: StopReason | undefined;
      let usage: Usage | undefined;
      let streamed = false;
      const calls = new Map<number, ToolCall>();
      const redactText = new StreamRedactor(this.options.context.secrets ?? []);
      const redactReasoning = new StreamRedactor(this.options.context.secrets ?? []);
      const request = { model, system: this.options.system, messages: this.sanitize(this.options.session.history()), tools,
        thinking: this.options.thinking, signal };
      try {
        await this.options.hook?.('model.before', { model: `${model.provider}/${model.id}`, signal });
        emit('model.start', { model: `${model.provider}/${model.id}`, attempt });
        for await (const chunk of provider.stream(request)) {
          checkAbort(signal);
          if (chunk.type === 'text') { text += chunk.text; streamed ||= !!chunk.text; const part = redactText.push(chunk.text); if (part) emit('assistant.delta', { text: part }); }
          else if (chunk.type === 'reasoning') { reasoning += chunk.text; signature += chunk.signature ?? ''; streamed ||= !!chunk.text || !!chunk.signature; const part = redactReasoning.push(chunk.text); if (part) emit('reasoning.delta', { text: part }); }
          else if (chunk.type === 'tool') {
            streamed = true;
            if (!Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index > 127) throw new Error('Invalid tool-call index or too many calls');
            const call = calls.get(chunk.index) ?? { id: '', name: '', arguments: '' };
            if (chunk.id) { if (call.id && call.id !== chunk.id) throw new Error('Tool-call identity changed mid-stream'); call.id = chunk.id; }
            if (chunk.name) { if (call.name && call.name !== chunk.name) throw new Error('Tool-call name changed mid-stream'); call.name = chunk.name; }
            call.arguments += chunk.arguments ?? '';
            if (Buffer.byteLength(call.arguments) > 2 * 1024 * 1024) throw new Error('Tool arguments exceed 2 MiB');
            calls.set(chunk.index, call);
            // Structured arguments are rendered only after completion to avoid leaking split secrets.
            emit('tool.arguments', { index: chunk.index, id: call.id, name: call.name, bytes: Buffer.byteLength(call.arguments) });
          } else if (chunk.type === 'usage') usage = chunk.usage;
          else {
            if (chunk.type !== 'stop' || !['stop', 'length', 'tool-use', 'error', 'aborted'].includes(chunk.reason)) throw new Error('Unknown model stop reason');
            if (reason) throw new Error('Duplicate model stop');
            reason = chunk.reason;
          }
          if (Buffer.byteLength(text) + Buffer.byteLength(reasoning) > 4 * 1024 * 1024) throw new Error('Assistant output exceeds 4 MiB');
        }
        if (!reason) throw new ProviderError('Provider disconnected before a stop event', { transient: true });
        const ids = new Set<string>();
        for (const call of calls.values()) {
          if (!call.id || !call.name || ids.has(call.id)) throw new Error('Missing or duplicate tool-call identity');
          ids.add(call.id);
          if (!call.arguments) call.arguments = '{}';
        }
        await this.options.hook?.('model.after', { model: `${model.provider}/${model.id}`, reason, signal });
        return { message: { role: 'assistant', content: text, ...(reasoning ? { reasoning } : {}), ...(signature ? { reasoningSignature: signature } : {}),
          ...(calls.size ? { toolCalls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) } : {}) }, reason };
      } catch (error) {
        if (!signal.aborted && error instanceof ProviderError && error.transient && !streamed && attempt < (this.options.retries ?? 3)) {
          const delayMs = Math.max(error.retryAfterMs ?? 0, (this.options.retryBaseMs ?? 500) * 2 ** attempt);
          attempt++;
          emit('retry', { attempt, delayMs, error: error.message });
          await sleep(delayMs, signal);
          continue;
        }
        if (streamed) this.save('turn.interrupted', { text, reasoning, reasoningSignature: signature, toolCalls: [...calls.values()], error: errorMessage(error) });
        if (signal.aborted) throw abortError();
        // The outer context-overflow handler must not replay a partially consumed stream.
        if (streamed && error instanceof ProviderError && error.contextOverflow) throw new Error(error.message, { cause: error });
        throw error;
      } finally {
        const remainingText = redactText.push('', true); if (remainingText) emit('assistant.delta', { text: remainingText });
        const remainingReasoning = redactReasoning.push('', true); if (remainingReasoning) emit('reasoning.delta', { text: remainingReasoning });
        if (usage) {
          usage = { ...usage, cost: usage.cost ?? estimateCost(model, usage) };
          this.addUsage(usage); this.save('usage', { usage, model: `${model.provider}/${model.id}`, estimated: usage.cost !== undefined });
          emit('usage', { usage, total: this.usage });
        }
      }
    }
  }

  private async batch(calls: ToolCall[], signal: AbortSignal): Promise<void> {
    const results = new Map<string, Message>();
    const execute = async (call: ToolCall) => {
      const { emit, context } = this.options;
      const tool = this.toolMap.get(call.name);
      const toolEmit: Emit = (type, data = {}) => emit(type === 'tool.output' ? 'tool.progress' : type, { ...data, id: call.id, name: call.name });
      emit('tool.start', this.sanitize({ id: call.id, name: call.name, arguments: call.arguments }));
      let content: string; let isError = false; let metadata: Record<string, unknown> | undefined;
      try {
        checkAbort(signal);
        let args: unknown;
        try { args = JSON.parse(call.arguments); }
        catch { throw new Error('Tool arguments must be valid JSON'); }
        const validate = this.validators.get(call.name);
        if (!tool || !validate) throw new Error(`Unknown tool: ${call.name}`);
        if (!this.options.model.capabilities.tools) throw new Error('Tool execution is disabled for this model');
        if (!validate(args)) throw new Error(`Tool schema rejected arguments: ${JSON.stringify(redactValue(validate.errors, context.redact))}`);
        if (context.mode === 'plan' && !tool.readonly) throw new Error(`${call.name} is disabled in read-only plan mode`);
        await this.options.hook?.('tool.before', { id: call.id, name: call.name, arguments: structuredClone(args), signal });
        const result = await tool.execute(args as Record<string, unknown>, { ...context, signal, emit: toolEmit });
        if (!result || typeof result.content !== 'string') throw new Error('Tool returned an invalid result');
        content = await modelOutput(result.content, context); isError = result.isError === true;
        metadata = result.metadata ? redactValue(result.metadata, context.redact) : undefined;
        await this.options.hook?.('tool.after', { id: call.id, name: call.name, isError, signal });
      } catch (error) { content = context.redact(errorMessage(error)); isError = true; }
      const message: Message = { role: 'tool', toolCallId: call.id, toolName: call.name, content, isError };
      results.set(call.id, message);
      this.save('message', { message });
      emit('tool.end', { id: call.id, name: call.name, content, isError, metadata });
    };
    // Read-only runs are concurrent, but mutation barriers preserve the model's declared order.
    for (let index = 0; index < calls.length;) {
      const call = calls[index]!;
      if (!this.toolMap.get(call.name)?.readonly) { await execute(call); index++; }
      else {
        const reads: ToolCall[] = [];
        while (index < calls.length && this.toolMap.get(calls[index]!.name)?.readonly) reads.push(calls[index++]!);
        for (let offset = 0; offset < reads.length; offset += 8) {
          const settled = await Promise.allSettled(reads.slice(offset, offset + 8).map(execute));
          const failure = settled.find(result => result.status === 'rejected');
          if (failure) throw failure.reason;
        }
      }
    }
    if (results.size !== calls.length) throw new Error('Tool batch did not settle every call');
    checkAbort(signal);
  }
}
