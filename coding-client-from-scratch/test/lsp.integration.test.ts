import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { LspManager } from '../src/lsp.js';
import { capture, fixture, messages, until, workspace } from './integration-helpers.js';

test('LSP lazily initializes, handles fragmented UTF-8 diagnostics and changes, and shuts down cleanly', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'lsp.jsonl');
  const events = capture();
  const host = new LspManager([{ ...fixture({ framing: 'lsp', fragment: true, log, delay: 40 }), extensions: ['.ts'] }], cwd, events.emit);
  t.after(() => host.close());
  assert.deepEqual(host.diagnostics(), [{ server: 'fixture', status: 'unavailable', diagnostics: [] }]);
  await host.update('ignored.txt', 'bad');
  assert.deepEqual(await messages(log), []);
  const updating = host.update('file with space.ts', 'bad \u03bb \ud83d\ude80');
  await until(() => host.diagnostics()[0]!.status === 'starting');
  await updating;
  await until(() => host.diagnostics()[0]!.diagnostics.length === 1);
  const diagnostic = host.diagnostics()[0]!.diagnostics[0] as Record<string, unknown>;
  assert.equal(diagnostic.message, 'bad text: bad \u03bb \ud83d\ude80');
  assert.match(String(diagnostic.uri), /file%20with%20space\.ts$/);
  await host.update('file with space.ts', 'clean');
  await until(() => events.events.filter(event => event.type === 'lsp.diagnostics').length === 2);
  assert.deepEqual(host.diagnostics(), [{ server: 'fixture', status: 'ready', diagnostics: [] }]);
  await host.close();
  const requests = (await messages(log)).filter(message => message.method);
  assert.deepEqual(requests.map(message => message.method), ['initialize', 'initialized', 'textDocument/didOpen', 'textDocument/didChange', 'shutdown', 'exit']);
  const opened = (requests[2]!.params as { textDocument: Record<string, unknown> }).textDocument;
  assert.equal(opened.version, 1);
  assert.equal(opened.languageId, 'typescript');
  const changed = requests[3]!.params as { textDocument: Record<string, unknown>; contentChanges: unknown[] };
  assert.equal(changed.textDocument.version, 2);
  assert.deepEqual(changed.contentChanges, [{ text: 'clean' }]);
});

test('a crashed LSP clears stale diagnostics, reports unavailable, then reopens documents on update', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'lsp.jsonl');
  const host = new LspManager([{ ...fixture({ framing: 'lsp', log }), extensions: ['ts'] }], cwd, () => {});
  t.after(() => host.close());
  await host.update('first.ts', 'bad before');
  await until(() => host.diagnostics()[0]!.diagnostics.length === 1);
  await host.update('second.ts', 'clean');
  await host.update('first.ts', 'crash');
  await until(() => host.diagnostics()[0]!.status === 'unavailable');
  assert.deepEqual(host.diagnostics()[0]!.diagnostics, []);
  await host.update('first.ts', 'bad after');
  await until(() => host.diagnostics()[0]!.diagnostics.some(value => (value as Record<string, unknown>).message === 'bad text: bad after'));
  assert.equal(host.diagnostics()[0]!.status, 'ready');
  const requests = await messages(log);
  assert.equal(requests.filter(message => message.event === 'spawn').length, 2);
  assert.equal(requests.filter(message => message.method === 'textDocument/didOpen').length, 4);
});

test('unexpected clean exit is unavailable, not a clean diagnostic result', async t => {
  const cwd = await workspace(t);
  const host = new LspManager([{ ...fixture({ framing: 'lsp', mode: 'clean-exit', marker: join(cwd, 'generation') }), extensions: ['ts'] }], cwd, () => {});
  t.after(() => host.close());
  await host.update('file.ts', 'clean');
  await until(() => host.diagnostics()[0]!.status === 'unavailable');
  await host.update('file.ts', 'clean');
  assert.equal(host.diagnostics()[0]!.status, 'ready');
});

test('startup failure is isolated and retried on the next matching update', async t => {
  const cwd = await workspace(t);
  const host = new LspManager([
    { ...fixture({ framing: 'lsp', mode: 'crash-init', marker: join(cwd, 'generation') }), extensions: ['ts'] },
    { name: 'missing', command: join(cwd, 'missing'), extensions: ['.ts'] },
  ], cwd, () => {});
  t.after(() => host.close());
  await host.update('file.ts', 'bad');
  assert.ok(host.diagnostics().every(server => server.status === 'unavailable'));
  await host.update('file.ts', 'bad after startup');
  await until(() => host.diagnostics()[0]!.diagnostics.length === 1);
  assert.equal(host.diagnostics()[0]!.status, 'ready');
  assert.equal(host.diagnostics()[1]!.status, 'unavailable');
});

test('invalid and oversized LSP framing is contained as unavailable', async t => {
  const cwd = await workspace(t);
  for (const mode of ['oversized', 'duplicate-length', 'bad-header', 'huge-header']) {
    await t.test(mode, async () => {
      const host = new LspManager([{ ...fixture({ framing: 'lsp', mode }), extensions: ['ts'] }], cwd, () => {});
      try {
        await host.update('file.ts', 'clean');
        assert.deepEqual(host.diagnostics(), [{ server: 'fixture', status: 'unavailable', diagnostics: [] }]);
      } finally { await host.close(); }
    });
  }
});

test('diagnostics from an older document version are ignored', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'lsp.jsonl');
  const host = new LspManager([{ ...fixture({ framing: 'lsp', mode: 'stale-diagnostics', log }), extensions: ['ts'] }], cwd, () => {});
  t.after(() => host.close());
  await host.update('file.ts', 'bad original');
  await until(() => host.diagnostics()[0]!.diagnostics.length === 1);
  await host.update('file.ts', 'clean');
  await host.format('file.ts');
  assert.deepEqual(host.diagnostics()[0]!.diagnostics, []);
});

test('formatting returns edits only, and server-initiated edits are refused', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'lsp.jsonl');
  const host = new LspManager([{ ...fixture({ framing: 'lsp', mode: 'client-request', log }), extensions: ['ts'] }], cwd, () => {});
  t.after(() => host.close());
  const path = join(cwd, 'file.ts');
  await writeFile(path, 'const n=1;\n');
  await host.update(path, 'const n=1;\n');
  const edits = await host.format(path);
  assert.deepEqual(edits, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '// formatted\n' }]);
  assert.equal(await readFile(path, 'utf8'), 'const n=1;\n');
  await until(async () => (await messages(log)).some(message => message.id === 'edit-1'));
  const response = (await messages(log)).find(message => message.id === 'edit-1')!;
  assert.equal((response.result as Record<string, unknown>).applied, false);
});

test('format cancellation uses LSP cancellation and terminates an unresponsive server', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'lsp.jsonl');
  const host = new LspManager([{ ...fixture({ framing: 'lsp', mode: 'ignore-cancel', log }), extensions: ['ts'] }], cwd, () => {});
  t.after(() => host.close());
  await host.update('file.ts', 'clean');
  const controller = new AbortController();
  const rejected = assert.rejects(host.format('file.ts', controller.signal), { name: 'AbortError' });
  await until(async () => (await messages(log)).some(message => message.method === 'textDocument/formatting'));
  controller.abort();
  await rejected;
  await until(() => host.diagnostics()[0]!.status === 'unavailable');
  assert.ok((await messages(log)).some(message => message.method === '$/cancelRequest'));
  await host.update('file.ts', 'clean again');
  assert.equal(host.diagnostics()[0]!.status, 'ready');
});

test('pre-aborted updates do not launch and invalid edits reject without touching files', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'lsp.jsonl');
  const host = new LspManager([{ ...fixture({ framing: 'lsp', mode: 'bad-edits', log }), extensions: ['ts'] }], cwd, () => {});
  t.after(() => host.close());
  await assert.rejects(host.update('file.ts', 'clean', AbortSignal.abort()), { name: 'AbortError' });
  assert.deepEqual(await messages(log), []);
  await host.update('file.ts', 'clean');
  await assert.rejects(host.format('file.ts'), /Invalid LSP formatting edits/);
  assert.equal(host.diagnostics()[0]!.status, 'unavailable');
});

test('duplicate file updates preserve diagnostics and versions without affecting other files', async t => {
  const cwd = await workspace(t);
  const log = join(cwd, 'lsp.jsonl');
  const host = new LspManager([{ ...fixture({ framing: 'lsp', log }), extensions: ['ts'] }], cwd, () => {});
  t.after(() => host.close());
  await Promise.all([host.update('first.ts', 'bad first'), host.update('./first.ts', 'bad first')]);
  await host.update('second.ts', 'bad second');
  await until(() => host.diagnostics()[0]!.diagnostics.length === 2);
  const before = host.diagnostics();
  await host.update(join(cwd, 'first.ts'), 'bad first');
  await host.format('first.ts');
  assert.deepEqual(host.diagnostics(), before);
  await host.update('first.ts', 'clean');
  await host.format('first.ts');
  assert.equal(host.diagnostics()[0]!.diagnostics.length, 1);
  assert.equal((host.diagnostics()[0]!.diagnostics[0] as Record<string, unknown>).message, 'bad text: bad second');
  const requests = await messages(log);
  assert.equal(requests.filter(message => message.method === 'textDocument/didOpen').length, 2);
  const changes = requests.filter(message => message.method === 'textDocument/didChange');
  assert.equal(changes.length, 1);
  assert.equal((changes[0]!.params as { textDocument: { version: number } }).textDocument.version, 2);
});

test('unconfigured documents are distinct from unavailable configured servers', async t => {
  const cwd = await workspace(t);
  const events = capture();
  const empty = new LspManager([], cwd, events.emit);
  t.after(() => empty.close());
  await empty.update('file.ts', 'clean');
  assert.deepEqual(empty.diagnostics(), []);
  await assert.rejects(empty.format('file.ts'), /No LSP server configured/);
  const host = new LspManager([{ ...fixture({ framing: 'lsp' }), extensions: ['ts'] }], cwd, events.emit);
  t.after(() => host.close());
  await host.update('file.txt', 'clean');
  assert.deepEqual(events.events, []);
  assert.equal(host.diagnostics()[0]!.status, 'unavailable');
  await assert.rejects(host.format('file.ts'), /LSP is unavailable/);
  await assert.rejects(host.format('file.txt'), /No LSP server configured/);
  await host.update('file.ts', 'bad');
  await until(() => host.diagnostics()[0]!.diagnostics.length === 1);
  const before = host.diagnostics();
  await host.update('file.txt', 'anything');
  assert.deepEqual(host.diagnostics(), before);
});

test('LSP stderr reports only byte counts and cannot leak split credentials on failure', async t => {
  const cwd = await workspace(t);
  for (const stderrCrash of [false, true]) {
    const events = capture();
    const stderrFragments = ['Bearer split-', 'credential-value', '\u03bb\n'];
    const host = new LspManager([{ ...fixture({ framing: 'lsp', stderrFragments, stderrCrash }), extensions: ['ts'] }], cwd, events.emit);
    try {
      await host.update('file.ts', 'clean');
      assert.equal(host.diagnostics()[0]!.status, stderrCrash ? 'unavailable' : 'ready');
      const bytes = Buffer.byteLength(stderrFragments.join(''));
      await until(() => events.events.filter(event => event.type === 'lsp.stderr').reduce((sum, event) => sum + Number(event.data.bytes), 0) === bytes);
      for (const event of events.events.filter(event => event.type === 'lsp.stderr')) {
        assert.deepEqual(Object.keys(event.data).sort(), ['bytes', 'server']);
        assert.ok(Number.isInteger(event.data.bytes) && Number(event.data.bytes) > 0);
      }
      for (const fragment of stderrFragments) assert.ok(!JSON.stringify(events.events).includes(fragment));
    } finally { await host.close(); }
  }
});
