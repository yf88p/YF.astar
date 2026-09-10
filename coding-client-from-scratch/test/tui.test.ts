import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import type blessed from 'blessed';
import { EditorModel, MAX_DRAFT, SelectorModel, TerminalInputDecoder, cellWidth, displayText } from '../src/editor.js';
import { createTerminalUI, renderMarkdown, TranscriptModel } from '../src/tui.js';
import type { ClientStatus, InteractiveClient, TerminalUI } from '../src/ui-contract.js';
import type { KilnEvent, PermissionRequest } from '../src/types.js';

test('editor selects in both directions, replaces, cuts and restores its internal buffer', () => {
  const editor = new EditorModel();
  editor.set('one two');
  editor.move('left', true); editor.move('left', true); editor.move('left', true);
  assert.deepEqual(editor.selection, [4, 7]);
  assert.equal(editor.cut(), 'two');
  assert.equal(editor.text, 'one ');
  editor.paste(editor.clipboard);
  assert.equal(editor.text, 'one two');
  editor.move('home'); editor.move('right', true); editor.move('right', true);
  assert.deepEqual(editor.selection, [0, 2]);
  editor.insert('ONE');
  assert.equal(editor.text, 'ONEe two');
  editor.move('end');
  assert.equal(editor.cut(), 'two');
  assert.equal(editor.text, 'ONEe ');
  editor.move('home', true);
  editor.delete();
  assert.equal(editor.text, '');
  editor.backspace();
  assert.equal(editor.cursor, 0);
});

test('editor horizontal and vertical navigation maintains columns and selection across lines', () => {
  const editor = new EditorModel();
  editor.set('abcdef\nx\nabcdef');
  editor.move('up');
  assert.equal(editor.cursor, 8);
  editor.move('up', true);
  assert.equal(editor.cursor, 6);
  assert.deepEqual(editor.selection, [6, 8]);
  editor.move('left');
  assert.equal(editor.cursor, 6);
  assert.deepEqual(editor.selection, [6, 6]);
  editor.set('\nabc');
  editor.move('home'); editor.move('up'); editor.move('home');
  assert.equal(editor.cursor, 0);
  editor.move('end');
  assert.equal(editor.cursor, 0);
});

test('editor handles grapheme deletion, wide cells and horizontal/vertical viewport scrolling', () => {
  const editor = new EditorModel();
  editor.set('a\u{1f525}e\u0301');
  editor.backspace();
  assert.equal(editor.text, 'a\u{1f525}');
  editor.move('left', true);
  assert.equal(editor.cut(), '\u{1f525}');
  assert.equal(editor.text, 'a');
  assert.equal(cellWidth('\u4e2d\u6587'), 4);
  editor.set('first\nsecond\n0123456789');
  const view = editor.view(5, 2);
  assert.equal(view.top, 1);
  assert.equal(view.left, 6);
  assert.equal(view.lines.at(-1)!.map(cell => cell.text).join(''), '6789 ');
  assert.equal(view.lines.at(-1)!.at(-1)!.cursor, true);
  editor.move('home', true);
  assert.equal(editor.view(5, 2).left, 0);
  assert.equal(editor.view(5, 2).lines.at(-1)!.every(cell => cell.selected), true);
});

test('history preserves an unfinished multiline draft and its cursor/selection', () => {
  const editor = new EditorModel();
  editor.remember('first'); editor.remember('second\nline'); editor.remember('second\nline');
  editor.set('unfinished\ndraft'); editor.move('left', true);
  const draft = editor.snapshot();
  assert.equal(editor.recall(-1), true);
  assert.equal(editor.text, 'second\nline');
  editor.recall(-1);
  assert.equal(editor.text, 'first');
  assert.equal(editor.recall(-1), false);
  editor.recall(1); editor.recall(1);
  assert.deepEqual(editor.snapshot(), draft);
  assert.equal(editor.recall(1), false);
});

test('paste normalizes line endings, strips terminal controls, replaces selection and caps memory', () => {
  const editor = new EditorModel();
  editor.set('replace'); editor.move('home', true);
  editor.paste('hello\r\nworld\r!\x1b[31m\x1b]52;c;bad\x07\u009b\u202e');
  assert.equal(editor.text, 'hello\nworld\n!');
  editor.paste('x'.repeat(MAX_DRAFT + 10));
  assert.equal(editor.text.length, MAX_DRAFT);
});

test('bracketed paste decoder handles every byte split and never turns payload into keys', () => {
  const source = 'before\x1b[200~/new\r\n\x03\x1b[31mhello\x1b[201~after';
  for (let split = 0; split <= source.length; split++) {
    const decoder = new TerminalInputDecoder();
    const parts = [...decoder.feed(source.slice(0, split)), ...decoder.feed(source.slice(split)), ...decoder.flush()];
    assert.equal(parts.filter(part => part.kind === 'keys').map(part => part.text).join(''), 'beforeafter');
    assert.deepEqual(parts.filter(part => part.kind === 'paste'), [{ kind: 'paste', text: '/new\r\n\x03\x1b[31mhello' }]);
  }
  const decoder = new TerminalInputDecoder();
  const parts = [...source].flatMap(char => decoder.feed(char));
  assert.equal(parts.filter(part => part.kind === 'paste').length, 1);
  assert.deepEqual(decoder.feed('\x1b'), []);
  assert.deepEqual(decoder.flush(), [{ kind: 'keys', text: '\x1b' }]);
  decoder.feed('\x1b[200~partial');
  assert.deepEqual(decoder.flush(), []);
  decoder.reset();
  assert.deepEqual(decoder.feed('\x1b\r'), [{ kind: 'keys', text: '\x1b\r' }]);
});

test('file completion range and generic selectors filter, rank and clamp empty matches', () => {
  const editor = new EditorModel();
  editor.set('look at @src/tu');
  const range = editor.completion();
  assert.deepEqual(range, { start: 8, end: 15, query: 'src/tu' });
  editor.replace(range.start, range.end, '@src/tui.ts ');
  assert.equal(editor.text, 'look at @src/tui.ts ');
  const selector = new SelectorModel([
    { id: '1', label: 'src/tui.ts', detail: 'terminal screen' },
    { id: '2', label: 'test/tui.test.ts', detail: 'terminal tests' },
    { id: '3', label: 'src/editor.ts', detail: 'editor' },
  ], true);
  selector.query.set('stui');
  assert.equal(selector.current()?.id, '1');
  editor.set('review @src/other.ts later');
  for (let index = 0; index < 11; index++) editor.move('left');
  const middle = editor.completion();
  assert.equal(middle.end, 20);
  editor.replace(middle.start, middle.end, '@src/tui.ts');
  assert.equal(editor.text, 'review @src/tui.ts later');
  selector.query.set('terminal tests');
  assert.equal(selector.current()?.id, '2');
  selector.query.set('no such file'); selector.move(10);
  assert.equal(selector.current(), undefined);
  selector.query.set(''); selector.move(-10);
  assert.equal(selector.current()?.id, '1');
});

const event = (type: string, fields: Record<string, unknown> = {}): KilnEvent => ({ version: 1, type, time: '', sessionId: 'session', ...fields });

test('stream model assembles deltas and tool lifecycle, collapses independently and bounds display only', () => {
  const model = new TranscriptModel();
  model.event(event('agent.start'));
  model.event(event('reasoning.delta', { text: 'consider\ncarefully' }));
  model.event(event('assistant.delta', { text: 'Hello ' }));
  model.event(event('assistant.delta', { text: 'world' }));
  model.event(event('tool.start', { id: 'one', name: 'shell', arguments: '{"command":"git diff"}' }));
  model.event(event('tool.progress', { id: 'one', name: 'shell', text: 'working' }));
  model.event(event('tool.end', { id: 'one', name: 'shell', content: 'result\n1\n2\n3\nlast', isError: true }));
  assert.equal(model.rows.length, 3);
  assert.equal(model.rows[1]!.text, 'Hello world');
  assert.match(model.render(false), /Alt\+t/);
  assert.doesNotMatch(model.render(false), /last/);
  model.verboseTools = true;
  assert.match(model.render(false), /last/);
  assert.match(model.render(false), /shell \/ error/);
  model.verboseReasoning = true;
  assert.match(model.render(false), /carefully/);
  const full = [{ role: 'assistant', content: 'x'.repeat(100_000) }];
  model.load(full);
  assert.equal(full[0]!.content.length, 100_000);
  assert.ok(model.rows[0]!.text.length <= 24 * 1024);
  for (let index = 0; index < 300; index++) model.add({ role: 'status', text: 'x'.repeat(4096) });
  assert.ok(model.rows.length <= 240);
  assert.ok(model.rows.reduce((size, row) => size + row.text.length, 0) <= 384 * 1024);
  assert.equal(model.omitted, true);
});

test('user attachment provenance is explicit, sanitized and bounded without retaining attachment data', () => {
  const model = new TranscriptModel();
  const attachments = [
    { path: '/project/source.ts', kind: 'text', mediaType: 'text/plain', data: 'PRIVATE ATTACHMENT CONTENT' },
    { path: '/project/{red-bg}diagram.png\x1b]52;c;bad\x07', kind: 'image', mediaType: 'image/png', data: 'BASE64 IMAGE DATA' },
  ];
  model.event(event('message.user', { text: 'Inspect these inputs.', attachments }));
  const rendered = model.render(false);
  assert.match(rendered, /ATTACHMENTS\ntext: \/project\/source.ts \(text\/plain\)/);
  assert.match(rendered, /image: \/project\/\{open\}red-bg\{close\}diagram.png \(image\/png\)/);
  assert.doesNotMatch(rendered, /\x1b|PRIVATE ATTACHMENT CONTENT|BASE64 IMAGE DATA/);
  assert.doesNotMatch(JSON.stringify(model.rows), /PRIVATE ATTACHMENT CONTENT|BASE64 IMAGE DATA/);
  assert.equal(attachments[0]!.data, 'PRIVATE ATTACHMENT CONTENT');
  model.event(event('notice', { message: 'Template submitted.' }));
  assert.match(model.render(false), /Template submitted/);
  for (let index = 0; index < 30; index++) model.event(event('message.user', {
    text: 'Long provenance', attachments: [{ path: 'x'.repeat(30_000), kind: 'text', mediaType: 'text/plain' }],
  }));
  assert.ok(model.rows.every(row => (row.provenance?.length ?? 0) <= 24 * 1024));
  assert.ok(model.rows.reduce((size, row) => size + row.text.length + (row.arguments?.length ?? 0) + (row.provenance?.length ?? 0), 0) <= 384 * 1024);
  assert.equal(model.omitted, true);
});

test('saved-output references survive collapsed previews and tool completion without overstating capture completeness', () => {
  const model = new TranscriptModel();
  model.event(event('tool.start', { id: 'a', name: 'shell', arguments: '{"command":"inspect"}' }));
  model.event(event('tool.start', { id: 'b', name: 'shell', arguments: '{"command":"other"}' }));
  model.event(event('tool.progress', { id: 'a', name: 'shell', text: 'preview\n'.repeat(100) }));
  const outputPaths = { stdout: '/state/a-stdout.txt', stderr: '/state/a-stderr.txt' };
  model.event(event('tool.output_saved', { id: 'a', name: 'shell', outputPaths, bytes: { stdout: 12000, stderr: 0 }, complete: false, status: 'aborted' }));
  assert.match(model.render(false), /SAVED OUTPUT \/ INCOMPLETE capture \/ aborted/);
  assert.match(model.render(false), /stdout: \/state\/a-stdout.txt \(12000 bytes\)/);
  assert.match(model.render(false), /stderr: \/state\/a-stderr.txt \(0 bytes\)/);
  model.event(event('tool.end', { id: 'a', name: 'shell', content: 'Operation aborted', isError: true, metadata: { outputPaths } }));
  assert.match(model.render(false), /INCOMPLETE capture \/ aborted/);
  assert.match(model.render(false), /Operation aborted/);
  assert.equal(model.rows.find(row => row.id === 'b')!.provenance, undefined);
  model.event(event('tool.end', { id: 'b', name: 'shell', content: 'Exit code: 0\npreview\n'.repeat(30), isError: false,
    metadata: { outputPaths: { stdout: '/state/b-stdout.txt' } } }));
  assert.match(model.render(false), /stdout: \/state\/b-stdout.txt/);
  assert.doesNotMatch(model.rows.find(row => row.id === 'b')!.provenance!, /capture complete/);
  model.event(event('tool.output_saved', { id: 'c', name: 'shell', outputPaths: { stdout: '/state/{red-fg}c.txt\x1b[2J' }, complete: true, status: 'success' }));
  assert.match(model.render(false), /SAVED OUTPUT \/ capture complete \/ success/);
  assert.doesNotMatch(model.render(false), /\x1b|\{red-fg\}/);
  model.verboseTools = true;
  assert.match(model.render(false), /read_output/);
});

test('markdown preserves readable open fences, highlights code and neutralizes escape/tag injection', () => {
  const text = '# Heading\n**strong** and `code`\n```ts\nconst x = "hello";\n+added\n-removed\n{red-bg}attack{/red-bg}\x1b[2J\x1b]52;c;bad\x07';
  const output = renderMarkdown(text);
  assert.match(output, /```ts/);
  assert.match(output, /#d7af5f-fg/);
  assert.doesNotMatch(output, /\x1b/);
  assert.doesNotMatch(output, /\{red-bg\}/);
  assert.match(output, /\{open\}red-bg\{close\}/);
  assert.doesNotMatch(renderMarkdown(text, false), /#[0-9a-f]{6}-fg/);
});

class FakeInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  setRawMode(raw: boolean): this { this.isRaw = raw; return this; }
}
class FakeOutput extends PassThrough {
  isTTY = true;
  columns = 100;
  rows = 30;
}
function mockClient() {
  const events = new EventEmitter();
  const state: ClientStatus = {
    cwd: '/workspace/kiln', git: 'main', mode: 'build', thinking: 'medium', running: false, queued: 0,
    extensions: [], usage: { input: 1000, output: 200, cost: 0.0123 }, contextTokens: 25000,
    session: { id: 'session-1', cwd: '/workspace/kiln', name: 'Copper work', createdAt: '', updatedAt: '', activeLeaf: null, labels: [] },
    model: { id: 'model-1', provider: 'test', name: 'Test Model', contextWindow: 100000, maxOutput: 1000, capabilities: { tools: true, images: false, reasoning: true } },
  };
  const submitted: { text: string; delivery?: string }[] = [];
  const commands: string[] = [];
  let aborted = 0;
  const client: InteractiveClient = {
    status: () => state,
    subscribe(listener) { events.on('event', listener); return () => { events.off('event', listener); }; },
    async submit(text, delivery) { submitted.push({ text, delivery }); },
    abort() { aborted++; },
    async command(line) { commands.push(line); return `Applied ${line}`; },
    commands: () => [{ name: 'compact', description: 'Compact context' }, { name: 'name', description: 'Rename session' }],
    models: () => [{ key: 'test/model-1', model: state.model }, { key: 'test/deep-model', model: { ...state.model, id: 'deep-model', name: 'Deep Model' } }],
    sessions: () => [state.session],
    tree: () => [{ id: 'leaf-1', parentId: null, type: 'message', data: { message: { role: 'user', content: 'first message' } }, createdAt: '' }],
    files: async () => ['src/tui.ts', 'src/editor.ts', 'docs/keys.md'],
    transcript: () => [],
    close: async () => {},
  };
  return { client, state, submitted, commands, events, get aborted() { return aborted; },
    emit(type: string, fields: Record<string, unknown> = {}) { events.emit('event', event(type, fields)); } };
}
async function until(predicate: () => boolean, message = 'UI did not settle'): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (predicate()) return; await delay(10); }
  assert.fail(message);
}
function harness(t: TestContext, env: NodeJS.ProcessEnv = { TERM: 'xterm-256color', NO_COLOR: '1' }) {
  const input = new FakeInput();
  const output = new FakeOutput();
  let bytes = '';
  output.on('data', data => { bytes = (bytes + String(data)).slice(-1024 * 1024); });
  let screen!: blessed.Widgets.Screen;
  let renders = 0;
  const ui = createTerminalUI({ input, output, env, onScreen(value) { screen = value; screen.on('render', () => { renders++; }); } });
  t.after(() => { ui.destroy(); input.destroy(); output.destroy(); });
  return { ui, input, output, get screen() { return screen; }, get renders() { return renders; }, get bytes() { return bytes; },
    send(text: string) { input.write(text); },
    text() { return displayText((screen as unknown as { screenshot(): string }).screenshot()); },
    contents() { return screen.children.map(child => (child as blessed.Widgets.BoxElement).getContent()).join('\n'); },
  };
}
const request = (id: string, overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id, tool: 'shell', action: 'shell', cwd: '/workspace/kiln', resource: 'git diff --stat', command: 'git diff --stat', reason: 'Inspect changes', ...overrides,
});

test('real Blessed screen input submits once, Ctrl+j inserts newline, paste is atomic, Alt+Enter follows up', async t => {
  const h = harness(t); const mock = mockClient(); h.ui.attach(mock.client);
  await until(() => h.renders > 0);
  assert.match(h.text(), /KILN/);
  assert.match(h.text(), /FIRST RUN/);
  assert.match(h.contents(), /25% ctx/);
  h.send('first\nsecond\r');
  await until(() => mock.submitted.length === 1);
  assert.deepEqual(mock.submitted[0], { text: 'first\nsecond', delivery: 'steer' });
  h.send('\x1b[200~/new\r\nnot a command\x03\x1b[201~');
  await delay(50);
  assert.equal(mock.submitted.length, 1);
  assert.equal(mock.commands.length, 0);
  h.send('\x1b\r');
  await until(() => mock.commands.length === 1);
  assert.equal(mock.commands[0], '/new\nnot a command');
  h.send('next\x1b\r');
  await until(() => mock.submitted.length === 2);
  assert.equal(mock.submitted[1]!.delivery, 'follow-up');
});

test('screen-level selection keys and history work without a textbox grabbing input', async t => {
  const h = harness(t); const mock = mockClient(); h.ui.attach(mock.client);
  h.send('one two\x1b[1;2D\x1b[1;2D\x1b[1;2D\x17three\r');
  await until(() => mock.submitted.length === 1);
  assert.equal(mock.submitted[0]!.text, 'one three');
  h.send('draft\x1b[A');
  await delay(40);
  h.send('\x1b[B\r');
  await until(() => mock.submitted.length === 2);
  assert.equal(mock.submitted[1]!.text, 'draft');
});

test('model, session, command, tree and fuzzy @file selectors dispatch contract commands and restore drafts', async t => {
  const h = harness(t); const mock = mockClient(); h.ui.attach(mock.client);
  h.send('draft\x10deep\r');
  await until(() => mock.commands.includes('/model test/deep-model'));
  h.send('\x0fsession-1\r');
  await until(() => mock.commands.includes('/resume session-1'));
  h.send('\x07first\r');
  await until(() => mock.commands.includes('/branch leaf-1'));
  h.send('\x10no matches');
  await until(() => h.text().includes('No matches'));
  h.send('\x1b'); await delay(100);
  h.send('\r');
  await until(() => mock.submitted.length === 1);
  assert.equal(mock.submitted[0]!.text, 'draft');
  h.send('review @stui\t');
  await until(() => h.text().includes('src/tui.ts'));
  h.send('\r\r');
  await until(() => mock.submitted.length === 2);
  assert.equal(mock.submitted[1]!.text, 'review @src/tui.ts ');
  h.send('\x0bcompact\r\r');
  await until(() => mock.commands.includes('/compact '));
  h.send('\x1bp');
  await until(() => mock.commands.includes('/mode plan'));
  h.send('\x0bname\rCopper branch\r');
  await until(() => mock.commands.includes('/name Copper branch'));
});

test('streaming is throttled while input stays responsive, output can scroll and resize keeps composer visible', async t => {
  const h = harness(t); const mock = mockClient(); h.ui.attach(mock.client);
  await until(() => h.renders > 0);
  mock.emit('agent.start'); mock.state.running = true;
  const renders = h.renders;
  for (let index = 0; index < 500; index++) mock.emit('assistant.delta', { text: 'line ' + index + '\n' });
  assert.equal(h.renders, renders);
  h.send('steering\r');
  await until(() => mock.submitted.length === 1);
  assert.equal(mock.submitted[0]!.delivery, 'steer');
  await delay(60);
  assert.ok(h.renders - renders <= 3);
  assert.match(h.text(), /line 499/);
  h.send('\x1b[5~');
  await until(() => h.contents().includes('scroll paused'));
  h.send('\x1b[1;5F');
  await until(() => !h.contents().includes('scroll paused'));
  h.output.columns = 46; h.output.rows = 18; h.output.emit('resize');
  await until(() => Number(h.screen.width) === 46 && h.text().includes('Ctrl+j'));
  assert.match(h.text(), /KILN/);
  assert.match(h.text(), /STEER/);
  h.send('\x03');
  await until(() => mock.aborted === 1);
  mock.state.running = false; mock.emit('agent.end', { outcome: 'aborted' });
  let quit = false; void h.ui.run().then(() => { quit = true; });
  await delay(40); assert.equal(quit, false);
  h.send('\x04');
  await until(() => quit);
  assert.equal(h.input.isRaw, false);
  assert.equal(h.input.readableFlowing, false);
  assert.equal(mock.events.listenerCount('event'), 0);
  assert.match(h.bytes, /\x1b\[\?2004l/);
  h.ui.destroy(); h.ui.destroy();
});

test('pre-attach permission prompts serialize, show the complete request, default deny, and abort cleanly', async t => {
  const h = harness(t);
  const first = new AbortController(); const second = new AbortController();
  const firstAnswer = h.ui.prompt(request('first', { command: 'printf first\n' + 'long command\n'.repeat(100) + 'THE END' }), first.signal);
  const secondAnswer = h.ui.prompt(request('second', { command: 'second command' }), second.signal);
  await until(() => h.text().includes('EXACT COMMAND'));
  assert.match(h.text(), /printf first/);
  assert.doesNotMatch(h.text(), /second command/);
  const overlay = h.screen.children.at(-1) as blessed.Widgets.BoxElement;
  const full = overlay.children[0] as blessed.Widgets.BoxElement;
  assert.match(full.getContent(), /THE END/);
  h.send('\x1b[6~');
  await until(() => full.getScroll() > 0);
  h.send('\x1b[C\r');
  assert.deepEqual(await firstAnswer, { decision: 'once' });
  await until(() => h.text().includes('second command'));
  second.abort();
  assert.deepEqual(await secondAnswer, { decision: 'deny' });
  await until(() => overlay.hidden);
  const denied = h.ui.prompt(request('third'), new AbortController().signal);
  h.send('\r');
  assert.deepEqual(await denied, { decision: 'deny' });
});

test('permission session scope and explicit typed patterns are distinct; pasted choices cannot approve', async t => {
  const h = harness(t);
  const answer = h.ui.prompt(request('session'), new AbortController().signal);
  await until(() => h.text().includes('PERMISSION'));
  h.send('\x1b[200~\t\t\r\x1b[201~');
  h.send('\t\t\r');
  assert.deepEqual(await answer, { decision: 'session' });
  const pattern = h.ui.prompt(request('pattern'), new AbortController().signal);
  await delay(40);
  h.send('\t\t\t\r');
  await until(() => h.text().includes('narrow, explicit pattern'));
  h.send('\r');
  await delay(40);
  assert.match(h.text(), /No default wildcard/);
  h.send('git diff *\r');
  assert.deepEqual(await pattern, { decision: 'pattern', pattern: 'git diff *' });
  const secret = h.ui.prompt(request('secret', { action: 'secret' }), new AbortController().signal);
  await delay(40);
  h.send('\t\r');
  assert.deepEqual(await secret, { decision: 'once' });
});

test('aborting a run closes all permission requests and restores an underlying selector and draft', async t => {
  const h = harness(t); const mock = mockClient(); h.ui.attach(mock.client);
  h.send('retained\x10');
  const first = h.ui.prompt(request('one'), new AbortController().signal);
  const second = h.ui.prompt(request('two'), new AbortController().signal);
  mock.emit('agent.end', { outcome: 'aborted' });
  assert.deepEqual(await first, { decision: 'deny' });
  assert.deepEqual(await second, { decision: 'deny' });
  await until(() => h.text().includes('MODELS'));
  h.send('\x1b'); await delay(100); h.send('\r');
  await until(() => mock.submitted.length === 1);
  assert.equal(mock.submitted[0]!.text, 'retained');
});

test('OSC52 is opt-in only; disabled copying uses the internal editor buffer and sanitizes output', async t => {
  const h = harness(t); const mock = mockClient(); h.ui.attach(mock.client);
  mock.emit('assistant.delta', { text: 'copy me\x1b]52;c;hostile\x07{red-bg}' });
  h.send('\x19\x16\r');
  await until(() => mock.submitted.length === 1);
  assert.equal(mock.submitted[0]!.text, 'copy me{red-bg}');
  assert.doesNotMatch(h.bytes, /\x1b\]52;/);
  h.ui.destroy();
  const enabled = harness(t, { TERM: 'xterm-256color', KILN_CLIPBOARD: '1' });
  enabled.ui.attach(mock.client);
  mock.emit('assistant.delta', { text: 'safe copy' });
  enabled.send('\x19');
  await until(() => enabled.bytes.includes('\x1b]52;c;'));
  assert.match(enabled.bytes, new RegExp(Buffer.from('safe copy').toString('base64')));
});

test('ASCII and NO_COLOR modes avoid Unicode chrome and chromatic SGR', async t => {
  const h = harness(t, { TERM: 'dumb', KILN_ASCII: '1', NO_COLOR: '' });
  h.ui.attach(mockClient().client);
  await until(() => h.renders > 0);
  assert.doesNotMatch(h.bytes, /\x1b\[[\d;]*(?:38;|48;)/);
  assert.doesNotMatch(h.bytes, /[\u2500-\u257f]/);
  assert.doesNotMatch(h.bytes, /\?2004h/);
  assert.match(h.text(), /KILN/);
});

test('external editor honors preferred shell, uses a private temporary file, cleans up and restores screen on failure', async t => {
  const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('kiln-editor-')));
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const script = "const fs=require('node:fs'); const p=process.argv[1]; if((fs.statSync(p).mode&511)!==384)process.exit(3); fs.writeFileSync(p,'edited\\nmessage');";
  const h = harness(t, { ...process.env, TERM: 'xterm-256color', NO_COLOR: '1', SHELL: '/bin/sh', VISUAL: `${quote(process.execPath)} -e ${quote(script)}` });
  const mock = mockClient(); h.ui.attach(mock.client);
  h.send('original\x05');
  await until(() => h.text().includes('edited') && h.input.isRaw);
  h.send('\r');
  await until(() => mock.submitted.length === 1);
  assert.equal(mock.submitted[0]!.text, 'edited\nmessage');
  assert.deepEqual(new Set((await readdir(tmpdir())).filter(name => name.startsWith('kiln-editor-'))), before);
  h.ui.destroy();
  const failed = harness(t, { TERM: 'xterm-256color', NO_COLOR: '1', SHELL: '/nonexistent-kiln-shell', EDITOR: 'vi' });
  failed.ui.attach(mock.client);
  failed.send('unchanged\x05');
  await until(() => failed.text().includes('ENOENT') && failed.input.isRaw);
  failed.send('\r');
  await until(() => mock.submitted.length === 2);
  assert.equal(mock.submitted[1]!.text, 'unchanged');
  assert.deepEqual(new Set((await readdir(tmpdir())).filter(name => name.startsWith('kiln-editor-'))), before);
});

test('destroy before run is idempotent, settles prompts and never reopens the terminal', async t => {
  const h = harness(t);
  const answer = h.ui.prompt(request('pending'), new AbortController().signal);
  h.ui.destroy();
  assert.deepEqual(await answer, { decision: 'deny' });
  const bytes = h.bytes;
  h.ui.destroy(); await h.ui.run();
  h.ui.attach(mockClient().client);
  assert.deepEqual(await h.ui.prompt(request('late'), new AbortController().signal), { decision: 'deny' });
  assert.equal(h.bytes, bytes);
  assert.equal(h.input.isRaw, false);
});

test('narrow screens keep bounded header rows, selected list items and explicit permission decisions visible', async t => {
  const h = harness(t); const mock = mockClient();
  h.output.columns = 38; h.output.rows = 12;
  mock.state.session.name = 'a long session name '.repeat(20);
  mock.state.cwd = '/a/very/long/path/'.repeat(20);
  h.ui.attach(mock.client);
  await until(() => h.renders > 0);
  assert.match(h.text(), /KILN/);
  assert.match(h.text(), /BUILD/);
  assert.match(h.text(), /MESSAGE/);
  h.send('\x10\x1b[B');
  await until(() => h.text().includes('deep'));
  assert.match(h.text(), /Search:/);
  const answer = h.ui.prompt(request('small'), new AbortController().signal);
  await until(() => h.text().includes('Deny'));
  h.send('\t\t');
  await until(() => h.text().includes('Allow session (exact)'));
  assert.match(h.text(), /Enter confirm/);
  h.send('\r');
  assert.deepEqual(await answer, { decision: 'session' });
});

test('permission control characters are visible, never executed, and queued abort does not close the active request', async t => {
  const h = harness(t);
  const controller = new AbortController();
  const active = h.ui.prompt(request('safe', { command: 'printf ok\x1b[2J\r\t\u202e{red-bg}' }), new AbortController().signal);
  const queued = h.ui.prompt(request('cancel'), controller.signal);
  controller.abort();
  assert.deepEqual(await queued, { decision: 'deny' });
  await until(() => h.renders > 0);
  const overlay = h.screen.children.at(-1) as blessed.Widgets.BoxElement;
  const content = (overlay.children[0] as blessed.Widgets.BoxElement).getText();
  assert.match(content, /printf ok\\u001b\[2J\\u000d\\u0009\\u202e\{red-bg\}/);
  h.send('\r');
  assert.deepEqual(await active, { decision: 'deny' });
});

test('late file-search results cannot reopen a closed selector or replace another dialog', async t => {
  const h = harness(t); const mock = mockClient();
  let files!: (values: string[]) => void;
  mock.client.files = () => new Promise(resolve => { files = resolve; });
  h.ui.attach(mock.client);
  h.send('keep\t');
  await until(() => h.text().includes('Loading files'));
  h.send('\x1b'); await delay(100);
  h.send('\x10');
  files(['late-file']);
  await until(() => h.text().includes('MODELS'));
  assert.doesNotMatch(h.text(), /late-file/);
  h.send('\x1b'); await delay(100); h.send('\r');
  await until(() => mock.submitted.length === 1);
  assert.equal(mock.submitted[0]!.text, 'keep');
});

test('file completion uses the client literal-quote grammar, not JSON escaping', async t => {
  const h = harness(t); const mock = mockClient(); h.ui.attach(mock.client);
  const paths = ['src/space name.ts', 'src/back\\slash.ts', 'src/space "quote".ts', '"quoted".ts'];
  for (const path of paths) {
    mock.client.files = async () => [path];
    h.send('\t');
    await until(() => h.text().includes(path));
    h.send('\r\r');
    await until(() => mock.submitted.length === paths.indexOf(path) + 1);
    const refs = [...mock.submitted.at(-1)!.text.matchAll(/(?:^|\s)@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g)]
      .map(match => match[1] ?? match[2] ?? match[3]);
    assert.deepEqual(refs, [path]);
  }
  mock.client.files = async () => ['src/both "and\' quotes.ts'];
  h.send('preserve draft\t');
  await until(() => h.text().includes('both'));
  h.send('\r');
  await until(() => h.text().includes('cannot be represented'));
  h.send('\r');
  await until(() => mock.submitted.length === paths.length + 1);
  assert.equal(mock.submitted.at(-1)!.text, 'preserve draft');
});

test('external editor exclusively owns terminal output during resize and model events', async t => {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const script = "setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'restored draft'),250)";
  const h = harness(t, { ...process.env, TERM: 'xterm-256color', NO_COLOR: '1', SHELL: '/bin/sh', VISUAL: `${quote(process.execPath)} -e ${quote(script)}` });
  const mock = mockClient(); h.ui.attach(mock.client);
  await until(() => h.renders > 0);
  h.send('\x05');
  await until(() => !h.input.isRaw);
  const before = h.bytes; const renders = h.renders;
  h.output.columns = 50; h.output.rows = 20; h.output.emit('resize');
  mock.emit('assistant.delta', { text: 'arrived during editing' });
  await delay(90);
  assert.equal(h.bytes, before);
  assert.equal(h.renders, renders);
  await until(() => h.input.isRaw && h.text().includes('restored draft'));
  assert.equal(Number(h.screen.width), 50);
  assert.match(h.text(), /arrived during editing/);
});

test('failed submission restores a draft, live session metadata preserves streamed content, errors restore the terminal', async t => {
  const h = harness(t); const mock = mockClient();
  mock.client.submit = async () => { throw new Error('Submission failed'); };
  h.ui.attach(mock.client);
  h.send('recover me\r');
  await until(() => h.text().includes('Submission failed'));
  assert.match(h.text(), /recover me/);
  mock.emit('agent.start');
  mock.emit('assistant.delta', { text: 'retained stream' });
  mock.emit('session.renamed');
  await until(() => h.text().includes('retained stream'));
  h.input.emit('error', new Error('Disconnected'));
  await h.ui.run();
  assert.equal(h.input.isRaw, false);
  assert.equal(mock.events.listenerCount('event'), 0);
});

test('bootstrap notices survive attachment and an unused UI does not change input mode', async t => {
  const unused = harness(t);
  assert.equal(unused.input.readableFlowing, null);
  unused.ui.destroy(); await unused.ui.run();
  assert.equal(unused.input.readableFlowing, null);
  assert.equal(unused.bytes, '');
  const h = harness(t);
  h.ui.notice('Bootstrap warning: configure your model.');
  h.ui.attach(mockClient().client);
  await until(() => h.text().includes('Bootstrap warning'));
});

test('real agent events render attachment provenance and saved output before and after a tool result', async t => {
  const { Agent } = await import('../src/agent.js');
  const { SessionStore } = await import('../src/sessions.js');
  const store = new SessionStore(tmpdir(), { ephemeral: true });
  const session = store.create('/workspace/kiln');
  const h = harness(t); const mock = mockClient();
  h.ui.attach(mock.client);
  let finishTool!: () => void;
  const toolReady = new Promise<void>(resolve => { finishTool = resolve; });
  const outputPaths = { stdout: '/state/stdout.txt', stderr: '/state/stderr.txt' };
  const seen: string[] = [];
  const agent = new Agent({
    session, model: mock.state.model, system: 'Inspect supplied inputs.',
    emit(type, data) { seen.push(type); mock.emit(type, data); },
    context: { cwd: mock.state.cwd, stateDir: tmpdir(), mode: 'build', emit: () => {}, redact: value => value,
      checkpoint: () => {}, permissions: { authorize: async () => {}, path: async path => path } },
    provider: { async *stream({ messages }) {
      if (!messages.some(message => message.role === 'tool')) {
        yield { type: 'tool', index: 0, id: 'call-1', name: 'shell', arguments: '{"command":"inspect"}' };
        yield { type: 'stop', reason: 'tool-use' };
      } else {
        yield { type: 'text', text: 'Inspection finished with a tool error.' };
        yield { type: 'stop', reason: 'stop' };
      }
    } },
    tools: [{ name: 'shell', description: 'Offline shell probe', readonly: false,
      inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
      async execute(_args, context) {
        context.emit('tool.output', { stream: 'stdout', text: 'live preview\n' });
        context.emit('tool.output_saved', { outputPaths, bytes: { stdout: 13, stderr: 0 }, complete: true, status: 'error' });
        await toolReady;
        return { content: 'Exit code: 1\n' + 'preview\n'.repeat(20), isError: true, metadata: { outputPaths } };
      } }],
  });
  const run = agent.run({ role: 'user', content: 'Inspect inputs.', attachments: [
    { path: '/workspace/kiln/source.ts', kind: 'text', mediaType: 'text/plain', data: 'HIDDEN FILE CONTENTS' },
    { path: '/workspace/kiln/image.png', kind: 'image', mediaType: 'image/png', data: 'HIDDEN IMAGE DATA' },
  ] });
  try {
    await until(() => h.text().includes('SAVED OUTPUT'));
    assert.match(h.text(), /ATTACHMENTS/);
    assert.match(h.text(), /text: \/workspace\/kiln\/source.ts \(text\/plain\)/);
    assert.match(h.text(), /image: \/workspace\/kiln\/image.png \(image\/png\)/);
    assert.match(h.text(), /live preview/);
    assert.match(h.text(), /stdout: \/state\/stdout.txt \(13 bytes\)/);
    assert.doesNotMatch(h.contents(), /HIDDEN FILE CONTENTS|HIDDEN IMAGE DATA/);
    assert.ok(seen.includes('tool.progress'));
    assert.ok(!seen.includes('tool.output'));
    finishTool();
    assert.equal((await run).outcome, 'success');
    await until(() => h.text().includes('Inspection finished'));
    assert.match(h.text(), /TOOL \/ shell \/ error/);
    assert.match(h.text(), /SAVED OUTPUT \/ capture complete \/ error/);
    assert.match(h.text(), /stderr: \/state\/stderr.txt/);
  } finally {
    finishTool(); agent.abort(); await run;
    session.close(); store.close();
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`${signal}: app cleanup deferred to a microtask preserves Blessed signal ordering without process.exit`, async t => {
    const events = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP', 'exit', 'uncaughtException'] as const;
    const original = events.map(event => process.rawListeners(event));
    let ui: TerminalUI | undefined;
    const controller = new AbortController();
    const onSignal = () => { controller.abort(); queueMicrotask(() => ui?.destroy()); };
    const unrelated = () => {};
    // Register the application's handler before Blessed, matching CLI startup ordering.
    process.on(signal, onSignal);
    process.on('SIGHUP', unrelated);
    const exit = t.mock.method(process, 'exit', (() => undefined) as typeof process.exit);
    try {
      const h = harness(t); ui = h.ui;
      const answer = ui.prompt(request('startup'), controller.signal);
      const quit = ui.run();
      await until(() => h.renders > 0);
      assert.ok(process.listeners(signal).length >= original[events.indexOf(signal)]!.length + 2);
      process.emit(signal, signal);
      assert.equal(h.input.isRaw, true, 'screen teardown must wait until every synchronous signal handler has run');
      await nextTurn();
      assert.deepEqual(await answer, { decision: 'deny' });
      await quit;
      assert.equal(exit.mock.callCount(), 0);
      assert.equal(h.input.isRaw, false);
      assert.equal(h.input.readableFlowing, false);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      assert.ok(process.listeners(signal).includes(onSignal));
      assert.ok(process.listeners('SIGHUP').includes(unrelated));
    } finally {
      ui?.destroy();
      process.off(signal, onSignal); process.off('SIGHUP', unrelated);
      await nextTurn();
      exit.mock.restore();
    }
    for (const [index, event] of events.entries()) assert.deepEqual(process.rawListeners(event), original[index], `${event} listeners were not restored`);
  });
}

for (const key of ['\x03', '\x04']) {
  test(`initialization quit (${key === '\x03' ? 'Ctrl+c' : 'Ctrl+d'}) denies queued prompts before attachment and restores input`, async t => {
    const h = harness(t);
    const controllers = [new AbortController(), new AbortController()];
    const answers = controllers.map((controller, index) => h.ui.prompt(request(`init-${index}`, {
      tool: 'external_server', action: 'extension', resource: `server-${index}`, reason: 'Launch configured server',
    }), controller.signal));
    const quit = h.ui.run();
    await until(() => h.text().includes('PERMISSION'));
    h.send(key);
    assert.deepEqual(await Promise.all(answers), [{ decision: 'deny' }, { decision: 'deny' }]);
    await quit;
    for (const controller of controllers) assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal(h.input.isRaw, false);
    assert.equal(h.input.readableFlowing, false);
    assert.equal(h.input.listenerCount('data'), 0);
    const mock = mockClient();
    mock.client.status = () => { throw new Error('A late client must not be attached after quit'); };
    const bytes = h.bytes;
    h.ui.attach(mock.client); h.ui.notice('late initialization notice');
    assert.deepEqual(await h.ui.prompt(request('late'), new AbortController().signal), { decision: 'deny' });
    await nextTurn();
    assert.equal(h.bytes, bytes);
  });
}

test('NO_COLOR on a color-capable terminal keeps all UI foregrounds and backgrounds at terminal defaults', async t => {
  const h = harness(t, { TERM: 'xterm-256color', NO_COLOR: '' });
  h.ui.attach(mockClient().client);
  const answer = h.ui.prompt(request('no-color'), new AbortController().signal);
  await until(() => h.renders > 0);
  const inspect = (node: blessed.Widgets.Node) => {
    const box = node as blessed.Widgets.BoxElement;
    if (box.style) { assert.equal(box.style.fg ?? 'default', 'default'); assert.equal(box.style.bg ?? 'default', 'default'); }
    for (const child of node.children) inspect(child);
  };
  for (const child of h.screen.children) inspect(child);
  for (const match of h.bytes.matchAll(/\x1b\[([\d;]*)m/g)) {
    assert.ok(!match[1]!.split(';').map(Number).some(code => code >= 30 && code <= 38 || code >= 40 && code <= 48 || code >= 90 && code <= 107));
  }
  h.send('\r'); await answer;
});
