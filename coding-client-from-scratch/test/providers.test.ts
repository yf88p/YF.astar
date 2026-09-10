import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { createProvider, estimateCost, ProviderError } from '../src/providers.js';
import type { Model, ModelRequest, ProviderChunk, ProviderConfig } from '../src/types.js';

const model: Model = {
  id: 'test-model', provider: 'local', name: 'Test', contextWindow: 100_000, maxOutput: 8192,
  capabilities: { tools: true, images: true, reasoning: true },
  pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return { model, system: 'Be helpful.', messages: [{ role: 'user', content: 'Hello' }], tools: [],
    signal: new AbortController().signal, ...overrides };
}

async function server(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): Promise<string> {
  const server = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(error => res.destroy(error as Error)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buffers: Buffer[] = [];
  for await (const chunk of req) buffers.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}

function sse(value: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ''}data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
}

function anthropic(type: string, fields: Record<string, unknown> = {}): string {
  return sse({ type, ...fields }, type);
}

function openai(delta: Record<string, unknown> = {}, finish: string | null = null): string {
  return sse({ choices: [{ index: 0, delta, finish_reason: finish }] });
}

function complete(type: ProviderConfig['type']): string {
  return type === 'openai' ? openai({ content: 'OK' }) + openai({}, 'stop') + sse('[DONE]')
    : anthropic('message_start', { message: { usage: { input_tokens: 1, output_tokens: 0 } } })
      + anthropic('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })
      + anthropic('message_stop');
}

async function collect(config: ProviderConfig, input = request()): Promise<ProviderChunk[]> {
  const result: ProviderChunk[] = [];
  for await (const chunk of createProvider(config).stream(input)) result.push(chunk);
  return result;
}

async function fragmented(res: ServerResponse, value: string): Promise<void> {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const bytes = Buffer.from(value);
  // Single-byte writes exercise split UTF-8 code points and every SSE delimiter.
  for (const byte of bytes) {
    if (res.destroyed) return;
    res.write(Buffer.from([byte]));
    await nextTurn();
  }
  res.end();
}

test('estimateCost counts cache subsets once and does not double-charge reasoning', () => {
  const usage = { input: 1000, output: 200, reasoning: 100, cacheRead: 400, cacheWrite: 100 };
  assert.equal(estimateCost(model, usage), (500 * 3 + 400 * 0.3 + 100 * 3.75 + 200 * 15) / 1_000_000);
  assert.equal(estimateCost({ ...model, pricing: undefined }, usage), 0);
  assert.equal(estimateCost({ ...model, pricing: { input: 2, output: 4 } }, usage), 0.0028);
  assert.equal(estimateCost(model, { input: 0, output: 0, cacheRead: 10 }), 0);
});

const history: ModelRequest['messages'] = [
  { role: 'user', content: 'Look at these', attachments: [
    { kind: 'text', path: 'notes.txt', mediaType: 'text/plain', data: 'actual file text' },
    { kind: 'image', path: 'pixel.png', mediaType: 'image/png', data: image },
  ] },
  { role: 'assistant', content: 'Checking', reasoning: 'Think first', reasoningSignature: 'signed-thinking', toolCalls: [
    { id: 'call-a', name: 'read', arguments: '{"path":"a"}' },
    { id: 'call-b', name: 'read', arguments: '{"path":"b"}' },
  ] },
  { role: 'tool', content: 'contents a', toolCallId: 'call-a', toolName: 'read' },
  { role: 'tool', content: 'missing b', toolCallId: 'call-b', toolName: 'read', isError: true },
];
const tools = [{ name: 'read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }];

test('Anthropic serializes signed thinking, attachments and multiple tool results with IDs', async t => {
  let received: Record<string, unknown> | undefined;
  let incoming: IncomingMessage | undefined;
  const baseURL = await server(t, async (req, res) => {
    incoming = req; received = await body(req);
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(complete('anthropic'));
  });
  const env = 'KILN_TEST_ANTHROPIC_KEY';
  const previous = process.env[env]; process.env[env] = 'private-test-key';
  t.after(() => { if (previous === undefined) delete process.env[env]; else process.env[env] = previous; });
  await collect({ type: 'anthropic', baseURL, apiKeyEnv: env, headers: { 'x-test': 'custom' } },
    request({ messages: history, tools, thinking: 'medium', maxOutput: 6000 }));
  assert.equal(incoming?.url, '/v1/messages');
  assert.equal(incoming?.headers['x-api-key'], 'private-test-key');
  assert.equal(incoming?.headers['anthropic-version'], '2023-06-01');
  assert.equal(incoming?.headers['x-test'], 'custom');
  assert.equal(received?.system, 'Be helpful.');
  assert.equal(received?.max_tokens, 6000);
  assert.deepEqual(received?.thinking, { type: 'enabled', budget_tokens: 4096 });
  assert.deepEqual(received?.tools, [{ name: 'read', description: 'Read a file', input_schema: tools[0]!.inputSchema }]);
  assert.deepEqual(received?.messages, [
    { role: 'user', content: [
      { type: 'text', text: 'Look at these' },
      { type: 'text', text: '[Attachment: notes.txt]\nactual file text' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
    ] },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: 'Think first', signature: 'signed-thinking' },
      { type: 'text', text: 'Checking' },
      { type: 'tool_use', id: 'call-a', name: 'read', input: { path: 'a' } },
      { type: 'tool_use', id: 'call-b', name: 'read', input: { path: 'b' } },
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'call-a', content: [{ type: 'text', text: 'contents a' }] },
      { type: 'tool_result', tool_use_id: 'call-b', content: [{ type: 'text', text: 'missing b' }], is_error: true },
    ] },
  ]);
});

test('OpenAI serializes tools, actual attachments, reasoning and configurable full endpoint', async t => {
  let received: Record<string, unknown> | undefined;
  let incoming: IncomingMessage | undefined;
  const baseURL = await server(t, async (req, res) => {
    incoming = req; received = await body(req);
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(complete('openai'));
  });
  await collect({ type: 'openai', baseURL: `${baseURL}/proxy/chat/completions?version=1`, apiKey: 'explicit-key' },
    request({ messages: history, tools, thinking: 'low', maxOutput: 3000 }));
  assert.equal(incoming?.url, '/proxy/chat/completions?version=1');
  assert.equal(incoming?.headers.authorization, 'Bearer explicit-key');
  assert.equal(received?.max_completion_tokens, 3000);
  assert.equal(received?.reasoning_effort, 'low');
  assert.deepEqual(received?.stream_options, { include_usage: true });
  assert.deepEqual(received?.tools, [{ type: 'function', function: {
    name: 'read', description: 'Read a file', parameters: tools[0]!.inputSchema,
  } }]);
  assert.deepEqual(received?.messages, [
    { role: 'system', content: 'Be helpful.' },
    { role: 'user', content: [
      { type: 'text', text: 'Look at these' },
      { type: 'text', text: '[Attachment: notes.txt]\nactual file text' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
    ] },
    { role: 'assistant', content: 'Checking', reasoning_content: 'Think first', tool_calls: [
      { id: 'call-a', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } },
      { id: 'call-b', type: 'function', function: { name: 'read', arguments: '{"path":"b"}' } },
    ] },
    { role: 'tool', tool_call_id: 'call-a', content: 'contents a' },
    { role: 'tool', tool_call_id: 'call-b', content: 'missing b' },
  ]);
});

test('OpenAI interleaves fragmented text, reasoning and indexed calls, then reports cached/reasoning usage', async t => {
  const wire = ': heartbeat\r\n\r\n' + openai({ role: 'assistant' })
    + openai({ content: 'Hi \u{1f30d}', reasoning_content: 'Consider ' })
    + openai({ tool_calls: [
      { index: 1, id: 'b', type: 'function', function: { name: 'second', arguments: '{"b":' } },
      { index: 0, id: 'a', type: 'function', function: { name: 'first', arguments: '{"a"' } },
    ] })
    + openai({ reasoning: 'carefully', tool_calls: [{ index: 0, function: { arguments: ':1}' } }] })
    + openai({ content: '!', tool_calls: [{ index: 1, function: { arguments: '2}' } }] })
    + openai({}, 'tool_calls')
    + sse({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 30,
      prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 20 } } })
    + sse('[DONE]');
  const baseURL = await server(t, (_req, res) => fragmented(res, wire.replace(/(?<!\r)\n/g, '\r\n')));
  const result = await collect({ type: 'openai', baseURL });
  assert.equal(result.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join(''), 'Hi \u{1f30d}!');
  assert.equal(result.filter(chunk => chunk.type === 'reasoning').map(chunk => chunk.text).join(''), 'Consider carefully');
  assert.deepEqual(result.filter(chunk => chunk.type === 'tool'), [
    { type: 'tool', index: 1, id: 'b', name: 'second', arguments: '{"b":' },
    { type: 'tool', index: 0, id: 'a', name: 'first', arguments: '{"a"' },
    { type: 'tool', index: 0, arguments: ':1}' },
    { type: 'tool', index: 1, arguments: '2}' },
  ]);
  const usage = { input: 100, output: 30, cacheRead: 40, reasoning: 20 };
  assert.deepEqual(result.at(-2), { type: 'usage', usage: { ...usage, cost: estimateCost(model, usage) } });
  assert.deepEqual(result.at(-1), { type: 'stop', reason: 'tool-use' });
});

test('Anthropic interleaves indexed blocks, thinking signatures, fragmented arguments and cumulative cache usage', async t => {
  let wire = anthropic('message_start', { message: { usage: {
    input_tokens: 60, output_tokens: 1, cache_read_input_tokens: 30, cache_creation_input_tokens: 10,
  } } });
  const starts = [
    { type: 'thinking', thinking: '' }, { type: 'text', text: 'Hello ' },
    { type: 'tool_use', id: 'a', name: 'first', input: {} },
    { type: 'tool_use', id: 'b', name: 'second', input: {} },
  ];
  starts.forEach((content_block, index) => { wire += anthropic('content_block_start', { index, content_block }); });
  for (const [index, delta] of [
    [2, { type: 'input_json_delta', partial_json: '{"x":' }],
    [0, { type: 'thinking_delta', thinking: 'Think \u{1f30d}' }],
    [3, { type: 'input_json_delta', partial_json: '{"y"' }],
    [1, { type: 'text_delta', text: '\u{1f30d}' }],
    [2, { type: 'input_json_delta', partial_json: '1}' }],
    [0, { type: 'signature_delta', signature: 'sig-' }],
    [3, { type: 'input_json_delta', partial_json: ':2}' }],
    [0, { type: 'signature_delta', signature: 'end' }],
  ]) wire += anthropic('content_block_delta', { index, delta });
  for (const index of [3, 1, 0, 2]) wire += anthropic('content_block_stop', { index });
  wire += anthropic('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 25 } })
    + anthropic('message_stop');
  const baseURL = await server(t, (_req, res) => fragmented(res, wire));
  const result = await collect({ type: 'anthropic', baseURL });
  assert.equal(result.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join(''), 'Hello \u{1f30d}');
  assert.equal(result.filter(chunk => chunk.type === 'reasoning').map(chunk => chunk.text).join(''), 'Think \u{1f30d}');
  assert.equal(result.filter(chunk => chunk.type === 'reasoning').map(chunk => chunk.signature ?? '').join(''), 'sig-end');
  assert.deepEqual(result.filter(chunk => chunk.type === 'tool'), [
    { type: 'tool', index: 2, id: 'a', name: 'first' },
    { type: 'tool', index: 3, id: 'b', name: 'second' },
    { type: 'tool', index: 2, arguments: '{"x":' },
    { type: 'tool', index: 3, arguments: '{"y"' },
    { type: 'tool', index: 2, arguments: '1}' },
    { type: 'tool', index: 3, arguments: ':2}' },
  ]);
  const usages = result.filter(chunk => chunk.type === 'usage').map(chunk => chunk.usage);
  assert.deepEqual(usages.map(({ cost: _cost, ...usage }) => usage), [
    { input: 100, output: 1, cacheRead: 30, cacheWrite: 10 },
    { input: 100, output: 25, cacheRead: 30, cacheWrite: 10 },
  ]);
  assert.deepEqual(result.at(-1), { type: 'stop', reason: 'tool-use' });
});

test('SSE supports BOM, comments, multiline data and bare carriage returns', async t => {
  const wire = '\ufeff: comment\rid: ignored\r\rdata: {"choices": [\rdata: {"index":0,"delta":{"content":"yes"},"finish_reason":"stop"}]}\r\rdata: [DONE]\r\r';
  const baseURL = await server(t, (_req, res) => fragmented(res, wire));
  assert.deepEqual(await collect({ type: 'openai', baseURL }), [
    { type: 'text', text: 'yes' }, { type: 'stop', reason: 'stop' },
  ]);
});

for (const type of ['openai', 'anthropic'] as const) {
  test(`${type} rejects malformed JSON and unterminated/disconnected streams without reporting stop`, async t => {
    for (const [name, wire] of [
      ['malformed JSON', 'data: {bad}\n\n'],
      ['unterminated frame', 'data: {"choices":[] }'],
      ['missing terminal event', type === 'openai' ? openai({ content: 'partial' }) : anthropic('message_start', { message: {} })],
      ['missing finish reason', type === 'openai' ? sse('[DONE]') : anthropic('message_start', { message: {} }) + anthropic('message_stop')],
    ]) {
      await t.test(name!, async t => {
        const baseURL = await server(t, (_req, res) => {
          res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(wire);
        });
        const seen: ProviderChunk[] = [];
        await assert.rejects(async () => {
          for await (const chunk of createProvider({ type, baseURL }).stream(request())) seen.push(chunk);
        }, ProviderError);
        assert.equal(seen.some(chunk => chunk.type === 'stop'), false);
      });
    }
  });

  test(`${type} marks a broken HTTP stream transient`, async t => {
    const baseURL = await server(t, async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(type === 'openai' ? openai({ content: 'partial' }) : anthropic('message_start', { message: {} }));
      await nextTurn(); res.destroy();
    });
    await assert.rejects(collect({ type, baseURL }), (error: unknown) => error instanceof ProviderError && error.transient);
  });

  test(`${type} returns rate-limit metadata without retrying or exposing credentials`, async t => {
    let requests = 0;
    const baseURL = await server(t, async (req, res) => {
      await body(req); requests++;
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1.5' });
      res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down private-key custom-secret' } }));
    });
    await assert.rejects(collect({ type, baseURL, apiKey: 'private-key', headers: { 'x-secret': 'custom-secret' } }), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 429); assert.equal(error.retryAfterMs, 1500);
      assert.equal(error.transient, true); assert.equal(error.contextOverflow, false);
      assert.doesNotMatch(error.message, /private-key|custom-secret/);
      return true;
    });
    assert.equal(requests, 1);
  });

  test(`${type} cancellation interrupts a pending stream read and closes the connection`, async t => {
    const controller = new AbortController();
    let markClosed!: () => void;
    const closed = new Promise<void>(resolve => { markClosed = resolve; });
    const baseURL = await server(t, (_req, res) => {
      res.on('close', markClosed);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(type === 'openai' ? openai({ content: 'first' }) : anthropic('message_start', { message: { usage: { input_tokens: 1 } } }));
    });
    const iterator = createProvider({ type, baseURL }).stream(request({ signal: controller.signal }))[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).done, false);
    const pending = iterator.next();
    controller.abort('user cancelled');
    await assert.rejects(pending, { name: 'AbortError' });
    await closed;
  });
}

test('HTTP Retry-After date and context overflow classifications', async t => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  for (const [status, error, retryAfter, expected] of [
    [503, { message: 'unavailable' }, 'Thu, 01 Jan 2026 00:00:07 GMT', { retryAfterMs: 7000, transient: true, contextOverflow: false }],
    [429, { message: 'limit' }, 'nonsense', { retryAfterMs: undefined, transient: true, contextOverflow: false }],
    [400, { code: 'context_length_exceeded', message: 'too large' }, '', { retryAfterMs: undefined, transient: false, contextOverflow: true }],
    [400, { type: 'invalid_request_error', message: 'prompt is too long: 200001 tokens > 200000 maximum' }, '', { retryAfterMs: undefined, transient: false, contextOverflow: true }],
    [401, { message: 'invalid authentication' }, '', { retryAfterMs: undefined, transient: false, contextOverflow: false }],
  ] as const) {
    const baseURL = await server(t, (_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json', 'retry-after': retryAfter });
      res.end(JSON.stringify({ error }));
    });
    await assert.rejects(collect({ type: 'openai', baseURL }), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, status);
      assert.deepEqual({ retryAfterMs: error.retryAfterMs, transient: error.transient, contextOverflow: error.contextOverflow }, expected);
      return true;
    });
  }
});

test('streamed API errors carry retry/context classifications', async t => {
  for (const [type, error, expected] of [
    ['anthropic', { type: 'overloaded_error', message: 'busy' }, { transient: true, contextOverflow: false, status: 529 }],
    ['openai', { code: 'context_length_exceeded', message: 'context too big' }, { transient: false, contextOverflow: true, status: undefined }],
  ] as const) {
    const baseURL = await server(t, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse({ type: 'error', error }, 'error'));
    });
    await assert.rejects(collect({ type, baseURL }), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.deepEqual({ transient: error.transient, contextOverflow: error.contextOverflow, status: error.status }, expected);
      return true;
    });
  }
});

test('rejects oversized SSE framing, invalid UTF-8 and malformed final tool arguments', async t => {
  for (const wire of [
    `data: ${'x'.repeat(1024 * 1024)}\n\n`,
    Buffer.from([100, 97, 116, 97, 58, 32, 0xff, 10, 10]),
    openai({ tool_calls: [{ index: 0, id: 'bad', function: { name: 'read', arguments: '{bad}' } }] }) + openai({}, 'tool_calls') + sse('[DONE]'),
    openai({ tool_calls: [{ index: -1, id: 'bad', function: { name: 'read', arguments: '{}' } }] }) + openai({}, 'tool_calls') + sse('[DONE]'),
  ]) {
    const baseURL = await server(t, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(wire);
    });
    await assert.rejects(collect({ type: 'openai', baseURL }), (error: unknown) => error instanceof ProviderError && !error.transient);
  }
});

test('abort before fetch makes no request', async t => {
  let requests = 0;
  const baseURL = await server(t, (_req, res) => { requests++; res.end(); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collect({ type: 'openai', baseURL }, request({ signal: controller.signal })), { name: 'AbortError' });
  assert.equal(requests, 0);
});

test('AbortSignal.timeout interrupts waiting for response headers', async t => {
  const baseURL = await server(t, () => {});
  await assert.rejects(collect({ type: 'openai', baseURL }, request({ signal: AbortSignal.timeout(50) })), { name: 'AbortError' });
});

test('early iterator return cancels the response body', async t => {
  let markClosed!: () => void;
  const closed = new Promise<void>(resolve => { markClosed = resolve; });
  const baseURL = await server(t, (_req, res) => {
    res.on('close', markClosed);
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(openai({ content: 'one' }));
  });
  for await (const chunk of createProvider({ type: 'openai', baseURL }).stream(request())) {
    assert.equal(chunk.type, 'text'); break;
  }
  await closed;
});

test('provider idle timeout aborts a stalled stream without retrying', async t => {
  let requests = 0;
  const baseURL = await server(t, (_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(openai({ content: 'one' }));
  });
  const iterator = createProvider({ type: 'openai', baseURL }).stream(request())[Symbol.asyncIterator]();
  await iterator.next();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = iterator.next();
  // Let the nested generators reach their pending network read before advancing time.
  await nextTurn();
  t.mock.timers.tick(120_000);
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.match(error.message, /timed out/); assert.equal(error.transient, true);
    return true;
  });
  assert.equal(requests, 1);
  t.mock.timers.reset();
});

test('custom endpoints require explicit credential opt-in, with keys and headers taking precedence', async t => {
  for (const type of ['anthropic', 'openai'] as const) {
    const env = type === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    const previous = process.env[env];
    process.env[env] = 'default-env-secret';
    t.after(() => { if (previous === undefined) delete process.env[env]; else process.env[env] = previous; });
    const auth: IncomingMessage['headers'][] = [];
    const bodies: Record<string, unknown>[] = [];
    const baseURL = await server(t, async (req, res) => {
      auth.push(req.headers);
      bodies.push(await body(req));
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' }); res.end(complete(type));
    });
    await collect({ type, baseURL: `${baseURL}/v1/` }, request({ thinking: 'off' }));
    assert.equal(auth[0]?.authorization, undefined);
    assert.equal(auth[0]?.['x-api-key'], undefined);
    await collect({ type, baseURL, apiKeyEnv: env });
    await collect({ type, baseURL, apiKey: 'explicit', apiKeyEnv: env });
    await collect({ type, baseURL, apiKey: 'explicit', headers: type === 'anthropic'
      ? { 'X-Api-Key': 'header' } : { Authorization: 'Bearer header' } });
    await collect({ type, baseURL, headers: type === 'anthropic'
      ? { 'X-Api-Key': 'header-only' } : { Authorization: 'Bearer header-only' } });
    assert.deepEqual(auth.map(headers => headers[type === 'anthropic' ? 'x-api-key' : 'authorization']), type === 'anthropic'
      ? [undefined, 'default-env-secret', 'explicit', 'header', 'header-only']
      : [undefined, 'Bearer default-env-secret', 'Bearer explicit', 'Bearer header', 'Bearer header-only']);
    for (const body of bodies) {
      assert.equal(body.thinking, undefined); assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.tools, undefined);
    }
    const missingEnv = 'KILN_TEST_MISSING_PROVIDER_SECRET';
    const missingPrevious = process.env[missingEnv]; delete process.env[missingEnv];
    t.after(() => { if (missingPrevious !== undefined) process.env[missingEnv] = missingPrevious; });
    await assert.rejects(collect({ type, baseURL, apiKeyEnv: missingEnv }), (error: unknown) => {
      assert.ok(error instanceof ProviderError); assert.match(error.message, /Missing provider credential/);
      return true;
    });
    assert.equal(auth.length, 5);
  }
});

test('only implicit built-in endpoints automatically resolve default environment credentials', async t => {
  for (const type of ['anthropic', 'openai'] as const) {
    const env = type === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    const previous = process.env[env]; process.env[env] = 'synthetic-default-secret';
    t.after(() => { if (previous === undefined) delete process.env[env]; else process.env[env] = previous; });
    const baseURL = type === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
    const auth: (string | null)[] = [];
    const fetch = t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      assert.equal(input, `${baseURL}${type === 'anthropic' ? '/messages' : '/chat/completions'}`);
      auth.push(new Headers(init?.headers).get(type === 'anthropic' ? 'x-api-key' : 'authorization'));
      return new Response(complete(type), { headers: { 'content-type': 'text/event-stream' } });
    });
    await collect({ type });
    await collect({ type, baseURL });
    assert.deepEqual(auth, [type === 'anthropic' ? 'synthetic-default-secret' : 'Bearer synthetic-default-secret', null]);
    delete process.env[env];
    await assert.rejects(collect({ type }), /Missing provider credential/);
    assert.equal(fetch.mock.callCount(), 2);
    fetch.mock.restore();
  }
});

test('standalone providers reject credential query parameters without leaking URLs and allow api-version', async t => {
  for (const type of ['anthropic', 'openai'] as const) {
    const urls: (string | undefined)[] = [];
    const baseURL = await server(t, (req, res) => {
      urls.push(req.url);
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(complete(type));
    });
    for (const key of ['api_key', 'token', 'API-KEY', 'x-api-key', 'access_token', 'refresh_token', 'auth_token',
      'id_token', 'bearer_token', 'security_token', 'authorization', 'auth', 'client_secret', 'secret',
      'secret_key', 'access_key', 'key', 'password', 'sig', 'signature', '%61pi%5fkey']) {
      await assert.rejects(collect({ type, baseURL: `${baseURL}/v1?api-version=2026-01-01&${key}=inline-secret` }), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.message, 'Provider endpoint must not contain credential query parameters; use apiKeyEnv or headers');
        assert.equal(error.transient, false);
        assert.ok(!String(error.stack).includes('inline-secret'));
        assert.ok(!String(error.stack).includes(baseURL));
        return true;
      });
    }
    assert.equal(urls.length, 0);
    await collect({ type, baseURL: `${baseURL}/v1?api-version=2026-01-01` });
    assert.deepEqual(urls, [`/v1${type === 'anthropic' ? '/messages' : '/chat/completions'}?api-version=2026-01-01`]);
  }
});

test('image tool results preserve all result IDs before OpenAI user image content', async t => {
  let received: Record<string, unknown> | undefined;
  const baseURL = await server(t, async (req, res) => {
    received = await body(req);
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(complete('openai'));
  });
  await collect({ type: 'openai', baseURL }, request({ messages: [
    history[1]!,
    { role: 'tool', content: 'Image found', toolCallId: 'call-a', attachments: [
      { kind: 'image', path: 'a.png', mediaType: 'image/png', data: `data:image/png;base64,${image}` },
    ] },
    history[3]!,
  ] }));
  const messages = received?.messages as Record<string, unknown>[];
  assert.deepEqual(messages.map(message => message.role), ['system', 'assistant', 'tool', 'tool', 'user']);
  assert.equal(messages[2]?.tool_call_id, 'call-a'); assert.equal(messages[3]?.tool_call_id, 'call-b');
  assert.deepEqual(messages[4]?.content, [
    { type: 'text', text: 'Images from tool result call-a:' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
  ]);
});

test('Anthropic handles empty and initially populated tool inputs without duplicating placeholder JSON', async t => {
  let wire = anthropic('message_start', { message: {} });
  for (const [index, input] of [[0, {}], [1, { path: 'a' }]] as const) {
    wire += anthropic('content_block_start', { index, content_block: { type: 'tool_use', id: `call-${index}`, name: 'read', input } })
      + anthropic('content_block_stop', { index });
  }
  wire += anthropic('message_delta', { delta: { stop_reason: 'tool_use' } }) + anthropic('message_stop');
  const baseURL = await server(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(wire);
  });
  assert.deepEqual((await collect({ type: 'anthropic', baseURL })).filter(chunk => chunk.type === 'tool'), [
    { type: 'tool', index: 0, id: 'call-0', name: 'read' }, { type: 'tool', index: 0, arguments: '{}' },
    { type: 'tool', index: 1, id: 'call-1', name: 'read' }, { type: 'tool', index: 1, arguments: '{"path":"a"}' },
  ]);
});

test('invalid tool identity, arguments and block state fail before stop', async t => {
  const tool = (index: number, id: string, args = '{}') => ({ index, id, function: { name: 'read', arguments: args } });
  for (const [type, wire] of [
    ['openai', openai({}, 'tool_calls') + sse('[DONE]')],
    ['openai', openai({ tool_calls: [tool(0, 'same'), tool(1, 'same')] }) + openai({}, 'tool_calls') + sse('[DONE]')],
    ['openai', openai({ tool_calls: [tool(0, 'first')] }) + openai({ tool_calls: [tool(0, 'changed')] })],
    ['openai', openai({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }) + openai({}, 'tool_calls') + sse('[DONE]')],
    ['anthropic', anthropic('message_start', { message: {} }) + anthropic('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'no start' } })],
    ['anthropic', anthropic('message_start', { message: {} })
      + anthropic('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'bad', name: 'read', input: {} } })
      + anthropic('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{' } })
      + anthropic('content_block_stop', { index: 0 })],
  ] as const) {
    const baseURL = await server(t, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(wire);
    });
    await assert.rejects(collect({ type, baseURL }), (error: unknown) => error instanceof ProviderError && !error.transient);
  }
});

test('terminal markers are required after finish reasons, and length stops are preserved', async t => {
  for (const type of ['openai', 'anthropic'] as const) {
    const finished = type === 'openai' ? openai({}, 'length')
      : anthropic('message_start', { message: {} }) + anthropic('message_delta', { delta: { stop_reason: 'max_tokens' } });
    const terminal = type === 'openai' ? sse('[DONE]') : anthropic('message_stop');
    let withTerminal = false;
    const baseURL = await server(t, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(finished + (withTerminal ? terminal : ''));
    });
    await assert.rejects(collect({ type, baseURL }), (error: unknown) => error instanceof ProviderError && error.transient);
    withTerminal = true;
    assert.deepEqual((await collect({ type, baseURL })).at(-1), { type: 'stop', reason: 'length' });
  }
});

test('rejects non-SSE success responses and invalid history before making a request', async t => {
  let requests = 0;
  const baseURL = await server(t, (_req, res) => {
    requests++; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
  await assert.rejects(collect({ type: 'openai', baseURL }), /expected text\/event-stream/);
  for (const type of ['anthropic', 'openai'] as const) {
    await assert.rejects(collect({ type, baseURL }, request({ messages: [{ role: 'tool', content: 'missing id' }] })), /toolCallId/);
    await assert.rejects(collect({ type, baseURL }, request({ messages: [{ role: 'assistant', content: '',
      toolCalls: [{ id: 'bad', name: 'read', arguments: '[]' }],
    }] })), ProviderError);
  }
  assert.equal(requests, 1);
});

test('OpenAI refusal deltas are visible text rather than an empty successful response', async t => {
  const baseURL = await server(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(openai({ refusal: 'Cannot help with that.' }) + openai({}, 'stop') + sse('[DONE]'));
  });
  assert.deepEqual(await collect({ type: 'openai', baseURL }), [
    { type: 'text', text: 'Cannot help with that.' }, { type: 'stop', reason: 'stop' },
  ]);
});

test('invalid header credentials never leak through native Headers exceptions', async t => {
  let requests = 0;
  const baseURL = await server(t, (_req, res) => { requests++; res.end(); });
  for (const type of ['anthropic', 'openai'] as const) {
    for (const credentials of [{ apiKey: 'private\nsecret' }, { headers: { 'x-secret': 'private\nsecret' } }]) {
      await assert.rejects(collect({ type, baseURL, ...credentials }), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.match(error.message, /Invalid provider credential/);
        assert.doesNotMatch(error.message, /private|secret/);
        assert.equal(error.transient, false);
        return true;
      });
    }
  }
  assert.equal(requests, 0);
});

test('HTTP status and Retry-After survive a disconnected error body', async t => {
  const baseURL = await server(t, async (_req, res) => {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' });
    res.write('{"error":');
    await nextTurn(); res.destroy();
  });
  await assert.rejects(collect({ type: 'openai', baseURL }), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.status, 429); assert.equal(error.retryAfterMs, 2000); assert.equal(error.transient, true);
    return true;
  });
});
