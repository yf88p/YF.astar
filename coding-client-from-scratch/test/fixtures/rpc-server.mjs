import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const config = JSON.parse(process.argv[2] || '{}');
const framing = config.framing || 'jsonl';
const first = !config.marker || !existsSync(config.marker);
if (config.marker) writeFileSync(config.marker, String(process.pid));
const log = message => { if (config.log) appendFileSync(config.log, JSON.stringify(message) + '\n'); };
log({ event: 'spawn', pid: process.pid });
let buffer = Buffer.alloc(0);
let initialized = false;
let output = Promise.resolve();
const write = chunk => new Promise(resolve => process.stdout.write(chunk, resolve));
function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  const frame = framing === 'lsp' ? Buffer.concat([Buffer.from(`content-length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`), body]) : Buffer.concat([body, Buffer.from('\n')]);
  output = output.then(async () => {
    if (config.fragment) {
      for (let offset = 0; offset < frame.length; offset++) {
        await write(frame.subarray(offset, offset + 1));
        await new Promise(resolve => setImmediate(resolve));
      }
    } else await write(frame);
  });
  return output;
}
const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });
const error = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
function diagnostics(document, text = document.text) {
  const values = text.includes('bad') ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, message: `bad text: ${text}` }] : [];
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: document.uri, version: document.version, diagnostics: values } });
}
async function message(request) {
  log(request);
  const { id, method, params } = request;
  if (method === 'initialize') {
    for (const fragment of config.stderrFragments ?? []) {
      await new Promise(resolve => process.stderr.write(fragment, resolve));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (config.stderrCrash) process.exit(7);
    if (config.mode === 'crash-init' && first) { process.exit(7); }
    if (config.mode === 'bad-json') { process.stdout.write('not json\n'); return; }
    if (config.mode === 'invalid-utf8') { process.stdout.write(Buffer.from([0xff, 10])); return; }
    if (config.mode === 'oversized') { process.stdout.write('Content-Length: 8388609\r\n\r\n'); return; }
    if (config.mode === 'duplicate-length') { process.stdout.write('Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}'); return; }
    if (config.mode === 'bad-header') { process.stdout.write('Content-Length: nope\r\n\r\n'); return; }
    if (config.mode === 'huge-header') { process.stdout.write('X'.repeat(9000)); return; }
    if (config.mode === 'huge-jsonl') { process.stdout.write('X'.repeat(8388609)); return; }
    if (config.mode === 'hang-init') return;
    if (config.delay) await new Promise(resolve => setTimeout(resolve, config.delay));
    initialized = true;
    if (framing === 'lsp') {
      await result(id, { capabilities: { textDocumentSync: 2, documentFormattingProvider: true }, serverInfo: { name: 'local fixture' } });
      if (config.mode === 'client-request') send({ jsonrpc: '2.0', id: 'edit-1', method: 'workspace/applyEdit', params: { edit: { changes: {} } } });
    } else await result(id, { protocolVersion: config.mode === 'bad-version' ? 'other/1' : 'kiln-tools/1' });
  } else if (method === 'tools/list') {
    if (!initialized) return error(id, 'Initialize first');
    const spec = { name: 'echo', description: 'Echo validated text', readonly: true, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } };
    if (config.mode === 'bad-schema') spec.inputSchema.properties.text.type = 'nonsense';
    if (config.mode === 'async-schema') spec.inputSchema.$async = true;
    if (config.mode === 'invalid-name') spec.name = '../bad';
    if (config.mode === 'list-error' && first) return error(id, 'Discovery failed');
    if (config.mode === 'changed-schema' && !first) spec.inputSchema.properties.text = { type: 'string', minLength: 8 };
    return result(id, { tools: config.mode === 'duplicate-tools' ? [spec, spec] : [spec] });
  } else if (method === 'tools/call') {
    if (params.arguments.text === 'crash') { process.exit(9); }
    if (params.arguments.text === 'hang') return;
    if (params.arguments.text === 'error') return error(id, 'Tool execution failed');
    if (params.arguments.text === 'bad-result') return result(id, { content: 9 });
    send({ jsonrpc: '2.0', method: 'progress', params: { requestId: id, message: 'Working', progress: 1, total: 1 } });
    return result(id, { content: params.arguments.text, metadata: { pid: process.pid } });
  } else if (method === 'cancel' || method === '$/cancelRequest') {
    if (config.mode !== 'ignore-cancel') return error(params.id, 'Cancelled');
  } else if (method === 'textDocument/didOpen') {
    if (config.mode === 'clean-exit' && first) { process.exit(0); }
    if (params.textDocument.text === 'crash') { process.exit(9); }
    diagnostics(params.textDocument);
  } else if (method === 'textDocument/didChange') {
    if (params.contentChanges[0].text === 'crash') { process.exit(9); }
    if (config.mode === 'stale-diagnostics') {
      diagnostics({ ...params.textDocument, version: params.textDocument.version - 1 }, 'bad stale');
    } else diagnostics(params.textDocument, params.contentChanges[0].text);
  } else if (method === 'textDocument/formatting') {
    if (config.mode === 'ignore-cancel') return;
    if (config.mode === 'bad-edits') return result(id, [{ newText: 'bad', range: {} }]);
    return result(id, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '// formatted\n' }]);
  } else if (method === 'shutdown') {
    return result(id, null);
  } else if (method === 'exit') {
    await output;
    process.exit(0);
  } else if (id !== undefined && method) {
    return error(id, 'Unknown method');
  }
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length) {
    let body;
    if (framing === 'lsp') {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
      if (buffer.length < end + 4 + length) return;
      body = buffer.subarray(end + 4, end + 4 + length);
      buffer = buffer.subarray(end + 4 + length);
    } else {
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      body = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
    }
    void message(JSON.parse(body.toString())).catch(error => { console.error(error); process.exit(10); });
  }
});
