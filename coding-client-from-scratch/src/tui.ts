import blessed from 'blessed';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, open, lstat, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { EditorModel, SelectorModel, TerminalInputDecoder, cellWidth, displayText, type InputPart, type SelectorItem } from './editor.js';
import type { InteractiveClient, TerminalUI } from './ui-contract.js';
import type { KilnEvent, PermissionAnswer, PermissionRequest } from './types.js';
import { errorMessage } from './util.js';

const palette = { amber: '#d7af5f', copper: '#af875f', cyan: '#87afaf', muted: '#808080', text: '#d7d7d7', error: '#d7875f', bg: '#1c1c1c' };
const ROW_LIMIT = 240;
const TEXT_LIMIT = 24 * 1024;
const TOTAL_LIMIT = 384 * 1024;
type Tone = keyof typeof palette;
const escaped = (text: string): string => blessed.escape(displayText(text));
const paint = (text: string, tone: Tone, color: boolean): string => color ? `{${palette[tone]}-fg}${text}{/${palette[tone]}-fg}` : text;
const valueText = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value) ?? String(value);

function singleLine(text: string, width: number): string {
  const clean = displayText(text).replace(/[\n\t]/g, ' ');
  if (cellWidth(clean) <= width) return escaped(clean);
  let clipped = '';
  let used = 0;
  for (const char of clean) {
    used += cellWidth(char);
    if (used > Math.max(0, width - 3)) break;
    clipped += char;
  }
  return escaped(clipped + '.'.repeat(Math.max(0, Math.min(3, width))));
}

export function renderMarkdown(text: string, color = true): string {
  let fence = false;
  return displayText(text).split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return paint(escaped(line), 'copper', color); }
    if (fence) {
      if (/^[+-]/.test(line)) return paint(escaped(line), line[0] === '+' ? 'cyan' : 'error', color);
      return line.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/.*$|#.*$|\b(?:const|let|var|function|return|async|await|if|else|class|import|from|export|true|false|null|def|for|in|None|True|False)\b|\b\d+(?:\.\d+)?\b)/g)
        .map((part, index) => index % 2 ? paint(escaped(part), /^(?:\/\/|#)/.test(part) ? 'muted' : /^["']/.test(part) ? 'cyan' : 'amber', color) : escaped(part)).join('');
    }
    if (/^#{1,6}\s/.test(line)) return paint(`{bold}${escaped(line)}{/bold}`, 'amber', color);
    if (/^(?:diff --git |@@)/.test(line)) return paint(escaped(line), 'cyan', color);
    if (/^[+-](?!\s)/.test(line)) return paint(escaped(line), line[0] === '+' ? 'cyan' : 'error', color);
    return line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => !index || index % 2 === 0 ? escaped(part) :
      part.startsWith('`') ? paint(escaped(part), 'copper', color) : `{bold}${escaped(part.slice(2, -2))}{/bold}`).join('');
  }).join('\n');
}

export interface TranscriptRow {
  role: string;
  text: string;
  id?: string;
  name?: string;
  arguments?: string;
  provenance?: string;
  state?: string;
  clipped?: boolean;
}

/** This is a bounded display cache only. The client owns the complete session. */
export class TranscriptModel {
  rows: TranscriptRow[] = [];
  omitted = false;
  verboseTools = false;
  verboseReasoning = false;
  private assistant: TranscriptRow | undefined;
  private reasoning: TranscriptRow | undefined;
  private bound(row: TranscriptRow): void {
    row.role = row.role.slice(0, 80);
    if (row.name) row.name = row.name.slice(0, 200);
    if (row.id) row.id = row.id.slice(0, 200);
    if (row.text.length > TEXT_LIMIT) { row.text = row.text.slice(-TEXT_LIMIT); row.clipped = true; }
    if (row.arguments && row.arguments.length > TEXT_LIMIT) { row.arguments = row.arguments.slice(0, TEXT_LIMIT); row.clipped = true; }
    if (row.provenance && row.provenance.length > TEXT_LIMIT) { row.provenance = row.provenance.slice(0, TEXT_LIMIT); row.clipped = true; }
    let size = this.rows.reduce((total, item) => total + item.text.length + (item.arguments?.length ?? 0) + (item.provenance?.length ?? 0), 0);
    while (this.rows.length > ROW_LIMIT || size > TOTAL_LIMIT) {
      const first = this.rows.shift()!;
      size -= first.text.length + (first.arguments?.length ?? 0) + (first.provenance?.length ?? 0);
      if (this.assistant === first) this.assistant = undefined;
      if (this.reasoning === first) this.reasoning = undefined;
      this.omitted = true;
    }
  }
  add(row: TranscriptRow): void { this.rows.push(row); this.bound(row); }
  load(messages: { role: string; content: string }[]): void {
    this.rows = []; this.omitted = messages.length > ROW_LIMIT;
    this.assistant = undefined; this.reasoning = undefined;
    for (const message of messages.slice(-ROW_LIMIT)) this.add({ role: message.role, text: message.content });
  }
  event(event: KilnEvent): void {
    const text = (name: string) => valueText(event[name]);
    switch (event.type) {
      case 'agent.start': this.assistant = undefined; this.reasoning = undefined; break;
      case 'agent.end':
        this.assistant = undefined; this.reasoning = undefined;
        if (event.outcome !== 'stop' && event.outcome !== 'completed' || event.reason) this.add({ role: 'status', text: `${text('outcome')}${event.reason ? ': ' + text('reason') : ''}` });
        break;
      case 'assistant.delta':
      case 'reasoning.delta': {
        const kind = event.type === 'assistant.delta' ? 'assistant' : 'reasoning';
        if (!this[kind]) { this[kind] = { role: kind, text: '' }; this.add(this[kind]!); }
        this[kind]!.text += text('text'); this.bound(this[kind]!); break;
      }
      case 'message.user': {
        this.assistant = undefined; this.reasoning = undefined;
        const attachments = Array.isArray(event.attachments) ? event.attachments : [];
        const refs = attachments.slice(0, 8).flatMap(attachment => {
          if (!attachment || typeof attachment.path !== 'string') return [];
          const kind = attachment.kind === 'image' ? 'image' : attachment.kind === 'text' ? 'text' : 'file';
          return [`${kind}: ${attachment.path}${typeof attachment.mediaType === 'string' ? ` (${attachment.mediaType})` : ''}`];
        });
        if (attachments.length > 8) refs.push('[More attachment references omitted]');
        this.add({ role: 'user', text: text('text'), provenance: refs.length ? 'ATTACHMENTS\n' + refs.join('\n') : undefined }); break;
      }
      case 'tool.start':
        this.assistant = undefined; this.reasoning = undefined;
        this.add({ role: 'tool', id: text('id'), name: text('name'), arguments: text('arguments'), text: '', state: 'running' }); break;
      case 'tool.progress':
      case 'tool.output_saved':
      case 'tool.end': {
        let row = this.rows.find(item => item.role === 'tool' && item.id === text('id').slice(0, 200));
        if (!row) { row = { role: 'tool', id: text('id'), name: text('name'), text: '' }; this.add(row); }
        if (event.type === 'tool.end') { row.text = text('content'); row.state = event.isError ? 'error' : 'done'; }
        else if (event.type === 'tool.progress') { row.text += text('text'); row.state = 'running'; }
        const metadata = event.metadata as Record<string, unknown> | undefined;
        // Completion metadata must not erase capture completeness or abort recovery paths.
        const paths = event.type === 'tool.output_saved' ? event.outputPaths : !row.provenance ? metadata?.outputPaths : undefined;
        if (paths && typeof paths === 'object') {
          const bytes = event.bytes as Record<string, unknown> | undefined;
          const refs = Object.entries(paths).slice(0, 8).flatMap(([stream, path]) => typeof path === 'string' ?
            [`${stream}: ${path}${typeof bytes?.[stream] === 'number' ? ` (${bytes[stream]} bytes)` : ''}`] : []);
          if (refs.length) row.provenance = `SAVED OUTPUT${event.complete === false ? ' / INCOMPLETE capture' : event.complete === true ? ' / capture complete' : ''}` +
            `${event.type === 'tool.output_saved' && event.status ? ' / ' + text('status') : ''}\n${refs.join('\n')}\nUse read_output to inspect saved output.`;
        }
        this.bound(row); break;
      }
      case 'notice': case 'warning': case 'error': this.add({ role: event.type, text: text('message') }); break;
      case 'retry': this.add({ role: 'warning', text: `Retry ${text('attempt')} in ${text('delayMs')}ms: ${text('error')}` }); break;
      case 'message.queued': this.add({ role: 'status', text: `Queued ${text('delivery')} (${text('queued')} pending)` }); break;
      case 'compaction.start': this.add({ role: 'status', text: 'Compacting context; session history is retained.' }); break;
      case 'compaction.end': this.add({ role: 'status', text: 'Context compaction complete.' }); break;
      case 'permission.decision': this.add({ role: 'permission', text: `Permission: ${text('decision')}${event.pattern ? ' ' + text('pattern') : ''}` }); break;
    }
  }
  render(color: boolean): string {
    const content = this.rows.map(row => {
      const tone: Tone = row.role === 'user' ? 'amber' : row.role === 'assistant' ? 'text' : row.role === 'error' || row.state === 'error' ? 'error' :
        row.role === 'warning' || row.role === 'permission' ? 'copper' : row.role === 'reasoning' ? 'muted' : 'cyan';
      const title = row.role === 'assistant' ? 'KILN' : row.role.toUpperCase();
      const collapsed = row.role === 'reasoning' && !this.verboseReasoning || row.role === 'tool' && !this.verboseTools;
      const heading = `${title}${row.name ? ' / ' + row.name : ''}${row.state ? ' / ' + row.state : ''}${collapsed ? row.role === 'tool' ? ' [+ Alt+t]' : ' [+ Alt+r]' : ''}`;
      let body = row.text;
      if (collapsed) body = displayText(body).split('\n').filter(Boolean).slice(0, row.role === 'tool' ? 3 : 1).join('\n').slice(0, 350) + (body.length > 350 || body.split('\n').length > 3 ? '\n[collapsed]' : '');
      const args = row.arguments ? `args: ${collapsed ? row.arguments.slice(0, 240) : row.arguments}${collapsed && row.arguments.length > 240 ? ' ...' : ''}\n` : '';
      const markdown = row.role === 'assistant' || row.role === 'tool';
      return paint(`{bold}${escaped(heading)}{/bold}`, tone, color) + '\n' +
        (row.clipped ? paint('[Display excerpt; full content remains in session]\n', 'muted', color) : '') +
        paint(escaped(args), 'muted', color) + (markdown ? renderMarkdown(body, color) : paint(escaped(body), tone, color)) +
        (row.provenance ? '\n' + paint(escaped(row.provenance), 'muted', color) : '');
    }).join('\n\n');
    return (this.omitted ? paint('[Earlier display rows omitted; full session is retained]\n\n', 'muted', color) : '') + content;
  }
}

type Input = Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (raw: boolean) => unknown };
type Output = Writable & { isTTY?: boolean; columns?: number; rows?: number };
interface ScreenRuntime extends blessed.Widgets.Screen { destroyed: boolean; leave(): void; enter(): void }
export interface TerminalUIOptions {
  input?: Input;
  output?: Output;
  env?: NodeJS.ProcessEnv;
  /** Observe the actual screen without substituting its input handling. */
  onScreen?: (screen: blessed.Widgets.Screen) => void;
}
interface PermissionEntry {
  request: PermissionRequest;
  finish: (answer: PermissionAnswer) => void;
}
interface ListDialog { title: string; selector: SelectorModel; choose: (item: SelectorItem) => void; loading?: boolean }

export function createTerminalUI(options: TerminalUIOptions = {}): TerminalUI {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const env = options.env ?? process.env;
  const ascii = env.TERM === 'dumb' || !!env.KILN_ASCII || env.NO_COLOR !== undefined;
  const color = env.NO_COLOR === undefined && env.TERM !== 'dumb';
  const rawBefore = input.isRaw ?? false;
  const flowingBefore = input.readableFlowing === true;
  const editor = new EditorModel();
  const transcript = new TranscriptModel();
  const decoder = new TerminalInputDecoder();
  let utf8 = new StringDecoder('utf8');
  const keys = new PassThrough() as PassThrough & { isTTY: boolean; isRaw: boolean; setRawMode: (raw: boolean) => void };
  keys.isTTY = input.isTTY ?? false;
  keys.isRaw = rawBefore;
  keys.setRawMode = raw => { keys.isRaw = raw; input.setRawMode?.(raw); };
  let screen: ScreenRuntime | undefined;
  let header: blessed.Widgets.BoxElement;
  let body: blessed.Widgets.BoxElement;
  let composer: blessed.Widgets.BoxElement;
  let footer: blessed.Widgets.BoxElement;
  let overlay: blessed.Widgets.BoxElement;
  let dialogBody: blessed.Widgets.BoxElement;
  let dialogFooter: blessed.Widgets.BoxElement;
  let client: InteractiveClient | undefined;
  let unsubscribe: (() => void) | undefined;
  let destroyed = false;
  let suspended = false;
  let child: ChildProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  let dirtyTranscript = true;
  let following = true;
  let list: ListDialog | undefined;
  const permissions: PermissionEntry[] = [];
  const pattern = new EditorModel();
  let patternMode = false;
  let permissionChoice = 0;
  let dialogIdentity: unknown;
  let footerMessage = '';
  let running = false;
  let displayedSession = '';
  let resolveQuit!: () => void;
  const quit = new Promise<void>(resolve => { resolveQuit = resolve; });

  function schedule(): void {
    if (destroyed || suspended || timer) return;
    timer = setTimeout(() => { timer = undefined; try { render(); } catch (error) { destroy(); console.error(`KILN: ${displayText(errorMessage(error))}`); } }, 33);
  }
  function notice(text: string, role = 'status'): void { if (destroyed) return; transcript.add({ role, text }); dirtyTranscript = true; schedule(); }
  function fail(error: unknown): void { notice(errorMessage(error), 'error'); }
  function parts(parts: InputPart[]): void {
    for (const part of parts) {
      if (destroyed || suspended) return;
      if (part.kind === 'paste') {
        if (permissions.length) { if (patternMode) pattern.paste(part.text.replace(/[\r\n]/g, '')); }
        else if (list) { list.selector.query.paste(part.text.replace(/[\r\n]/g, ' ')); list.selector.selected = 0; }
        else editor.paste(part.text);
        schedule();
      } else if (part.text === '\x1b\r' || part.text === '\x1b\n') {
        screen?.emit('keypress', '', { name: 'enter', meta: true, sequence: part.text });
      } else keys.write(part.text);
    }
  }
  function onData(chunk: Buffer | string): void {
    if (destroyed || suspended) return;
    clearTimeout(escapeTimer);
    parts(decoder.feed(typeof chunk === 'string' ? chunk : utf8.write(chunk)));
    if (destroyed || suspended) return;
    escapeTimer = setTimeout(() => { escapeTimer = undefined; parts(decoder.flush()); }, 80);
  }
  function onEnd(): void { destroy(); }
  function ensureScreen(): void {
    if (screen || destroyed) return;
    try {
      screen = blessed.screen({ input: keys, output: output as unknown as Readable, terminal: env.TERM === 'dumb' ? 'vt100' : env.TERM || 'xterm-256color',
        smartCSR: true, fullUnicode: !ascii, forceUnicode: !ascii, autoPadding: true, warnings: false, resizeTimeout: 40, title: 'KILN' }) as ScreenRuntime;
      // Blessed's resize handler clears the terminal even when no render was requested.
      // Gate it while an external editor owns the terminal; enter() reallocates on return.
      for (const listener of screen.program.listeners('resize')) {
        screen.program.removeListener('resize', listener as () => void);
        screen.program.on('resize', () => { if (!suspended && !destroyed) listener.call(screen!.program); });
      }
      const style = { fg: color ? palette.text : 'default', bg: color ? palette.bg : 'default' };
      const box = (extra: blessed.Widgets.BoxOptions) => blessed.box({ parent: screen, tags: true, style, ...extra });
      header = box({ top: 0, left: 0, width: '100%', height: 4, padding: { left: 1, right: 1 } });
      body = box({ top: 4, left: 0, width: '100%', bottom: 6, padding: { left: 1, right: 1 }, scrollable: true, alwaysScroll: true, keys: false });
      composer = box({ bottom: 2, left: 0, width: '100%', height: 4, padding: { left: 1, right: 1 }, keys: false });
      footer = box({ bottom: 0, left: 0, width: '100%', height: 2, padding: { left: 1, right: 1 } });
      overlay = box({ top: 1, left: 1, width: '100%-2', height: '100%-2', hidden: true,
        border: { type: ascii ? 'bg' : 'line', ch: ascii ? '#' : undefined }, style: { ...style, border: { fg: color ? palette.copper : 'default' } } });
      dialogBody = blessed.box({ parent: overlay, top: 0, left: 1, right: 1, bottom: 4, tags: true, scrollable: true, alwaysScroll: true, keys: false, style });
      dialogFooter = blessed.box({ parent: overlay, bottom: 0, left: 1, right: 1, height: 4, tags: true, style });
      screen.on('keypress', (ch, key) => { try { onKey(ch, key); } catch (error) { fail(error); } });
      screen.on('resize', () => { dirtyTranscript = true; schedule(); });
      screen.on('destroy', destroy);
      input.on('data', onData);
      input.on('end', onEnd);
      input.on('error', onEnd);
      output.on('error', onEnd);
      input.resume();
      if (env.TERM !== 'dumb') output.write('\x1b[?2004h');
      options.onScreen?.(screen);
      schedule();
    } catch (error) { destroy(); throw error; }
  }

  function renderEditor(model: EditorModel, width: number, height: number, active = true): string {
    return model.view(width, height).lines.map(line => line.map(cell => {
      const text = escaped(cell.text);
      return cell.selected ? `{inverse}${text}{/inverse}` : cell.cursor && active ? `{underline}${text}{/underline}` : text;
    }).join('')).join('\n');
  }
  function render(): void {
    if (!screen || destroyed || suspended) return;
    const width = Number(screen.width);
    const height = Number(screen.height);
    const narrow = width < 76;
    const compact = height < 18;
    const headerHeight = compact ? 2 : narrow ? 5 : 4;
    const footerHeight = compact ? 1 : 2;
    const editorHeight = Math.max(1, Math.min(editor.text.split('\n').length, compact ? 2 : 6, Math.floor(height / 3)));
    const composerHeight = editorHeight + 1;
    header.height = headerHeight;
    body.top = headerHeight;
    body.bottom = composerHeight + footerHeight;
    composer.height = composerHeight; composer.bottom = footerHeight;
    footer.height = footerHeight;
    const status = client?.status();
    if (status) {
      const mode = status.mode.toUpperCase();
      const context = status.model.contextWindow > 0 ? Math.max(0, Math.min(1, status.contextTokens / status.model.contextWindow)) : 0;
      const gauge = '[' + '#'.repeat(Math.round(context * 10)) + '.'.repeat(10 - Math.round(context * 10)) + ']';
      const usage = `${status.usage.input.toLocaleString()} in / ${status.usage.output.toLocaleString()} out  $${(status.usage.cost ?? 0).toFixed(4)}`;
      const state = `${running || status.running ? 'WORKING' : 'READY'}${status.queued ? ` +${status.queued} queued` : ''}`;
      const product = paint('{bold}KILN{/bold}', 'amber', color);
      const session = singleLine(status.session.name || status.session.id.slice(0, 12), width - state.length - 12);
      const model = singleLine(status.model.name || status.model.id, narrow ? width - 11 : width - status.thinking.length - 24);
      const smallUsage = `${status.usage.input >= 1000 ? (status.usage.input / 1000).toFixed(1) + 'k' : status.usage.input}/${status.usage.output >= 1000 ? (status.usage.output / 1000).toFixed(1) + 'k' : status.usage.output} $${(status.usage.cost ?? 0).toFixed(4)}`;
      header.setContent(compact ? `${product}  ${paint(mode, 'copper', color)}  ${paint(state, 'cyan', color)}\n${singleLine(`${status.model.name}  ${Math.round(context * 100)}% ctx  ${smallUsage}`, width - 2)}` :
        `${product}  ${session}  ${paint(state, 'cyan', color)}\n` +
        paint(singleLine(`${status.cwd}${status.git ? '  git:' + status.git : ''}`, width - 2), 'muted', color) + '\n' +
        `${model}  ${paint(mode, 'copper', color)}${narrow ? '\n' : '  '}thinking:${singleLine(status.thinking, width - 12)}\n` +
        paint(singleLine(`${gauge} ${Math.round(context * 100)}% ctx  ${narrow ? smallUsage : usage}`, width - 2), 'muted', color));
    } else header.setContent(`${paint('{bold}KILN{/bold}', 'amber', color)}  ${paint('A deliberate coding workbench', 'copper', color)}\n${paint('Review workspace trust before starting.', 'muted', color)}`);
    if (dirtyTranscript) {
      const scroll = body.getScroll();
      body.setContent(transcript.rows.length ? transcript.render(color) :
        `\n${paint('{bold}Make something worth keeping.{/bold}', 'amber', color)}\n\n` +
        'Describe a change, ask about this codebase, or start with a plan.\n' +
        'KILN will show its work and ask before sensitive actions.\n\n' +
        `${paint('FIRST RUN', 'copper', color)}\n` +
        '  1. Ctrl+p  Choose a configured model.\n  2. Alt+p   Switch PLAN / BUILD.\n  3. Tab     Attach an @file reference.\n  4. Enter   Send your request.\n\n' +
        'Ctrl+j adds a line. Keep typing while KILN works.\nEnter steers the run; Alt+Enter queues a follow-up.\n' +
        'Ctrl+k opens commands. Ctrl+o resumes a session.\nPgUp/PgDn scroll output; Ctrl+End returns to live output.');
      if (following) body.setScrollPerc(transcript.rows.length ? 100 : 0); else body.setScroll(scroll);
      dirtyTranscript = false;
    }
    const label = `${running ? 'STEER' : 'MESSAGE'}  ${narrow ? 'Ctrl+j newline' : 'Enter send  |  Ctrl+j newline  |  Alt+Enter follow-up'}${!following ? '  [scroll paused]' : ''}`;
    composer.setContent(paint(label, 'copper', color) + '\n' + renderEditor(editor, width - 2, editorHeight, !permissions.length && !list));
    footer.setContent(paint(footerMessage || (narrow ? '^p model  ^k commands  Tab @file  Esc abort  ^d quit' : '^p model  ^o sessions  ^k commands  ^g tree  Tab @file  Alt+p plan/build'), 'muted', color) +
      (footerHeight > 1 ? '\n' + paint(narrow ? '^e editor  ^y copy  Alt+t tools  Alt+r reasoning' : '^e external editor  ^y copy  Alt+t tools  Alt+r reasoning  PgUp/PgDn scroll  Esc abort  ^d quit', 'muted', color) : ''));
    renderDialog(width, height);
    screen.render();
  }

  function renderDialog(width: number, height: number): void {
    const permission = permissions[0];
    const identity = permission ?? list;
    if (!identity) { overlay.hide(); dialogIdentity = undefined; return; }
    overlay.show(); overlay.setFront();
    overlay.width = Math.max(10, Math.min(width - 2, 100));
    overlay.left = Math.max(0, Math.floor((width - Number(overlay.width)) / 2));
    overlay.top = height < 18 ? 0 : 1;
    overlay.height = Math.max(6, height - (height < 18 ? 0 : 2));
    const narrow = width < 80;
    const compact = height < 16 || width < 40;
    const footerHeight = permission ? compact ? 3 : narrow ? 6 : 5 : 3;
    dialogFooter.height = footerHeight;
    dialogBody.bottom = footerHeight;
    const changed = dialogIdentity !== identity;
    dialogIdentity = identity;
    if (permission) {
      const request = permission.request;
      overlay.setLabel(paint(' PERMISSION / REVIEW REQUIRED ', 'amber', color));
      const scope = request.action === 'secret' ? 'Protected resource: only one-time approval is available.' :
        'Session grants cover ONLY this exact resource/command in this cwd.\nPattern grants are scoped to this tool + action + cwd, never global.';
      const exact = (text: string) => escaped(text.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
        char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')));
      dialogBody.setContent(`${paint('{bold}Review the complete request before allowing it.{/bold}', 'amber', color)}\n\n` +
        `Tool: ${exact(request.tool)}\nAction: ${exact(request.action)}\nCwd: ${exact(request.cwd)}\n\n` +
        `EXACT COMMAND\n${exact(request.command ?? '(no command)')}\n\nRESOURCE\n${exact(request.resource)}\n\nREASON\n${exact(request.reason)}\n\n` + escaped(scope) +
        '\nControl characters are shown as \\uXXXX.');
      if (changed) dialogBody.setScroll(0);
      const choices = request.action === 'secret' ? ['Deny', 'Allow once'] : ['Deny', 'Allow once', 'Allow session (exact)', 'Pattern...'];
      dialogFooter.setContent(patternMode ? compact ?
        'Explicit narrow pattern:\n' + renderEditor(pattern, Number(overlay.width) - 4, 1) + '\nEnter confirm / Esc cancel' :
        paint('Type a narrow, explicit pattern; Enter confirms it.', 'amber', color) + '\n' + renderEditor(pattern, Number(overlay.width) - 4, 1) +
        '\nNo default wildcard. Esc cancels pattern.\nPgUp/PgDn scroll the complete request.' :
        (compact ? `{inverse}${choices[permissionChoice]}{/inverse}` : choices.map((choice, index) => index === permissionChoice ? `{inverse} ${choice} {/inverse}` : ` ${choice} `).join(narrow ? '\n' : ' ')) +
        (narrow ? '\nTab choose / Enter confirm\nEsc deny / PgUp/PgDn view' :
          `\nLeft/Right or Tab choose; Enter confirms. Esc denies.\nPgUp/PgDn scroll. ${permissions.length > 1 ? `${permissions.length - 1} more waiting.` : ''}`));
    } else if (list) {
      overlay.setLabel(paint(` ${escaped(list.title)} `, 'amber', color));
      const items = list.selector.filtered();
      list.selector.selected = Math.max(0, Math.min(list.selector.selected, items.length - 1));
      const visible = Math.max(1, Number(overlay.height) - footerHeight - 2);
      const start = Math.max(0, list.selector.selected - Math.floor(visible / 2));
      dialogBody.setContent(items.length ? items.slice(start, start + visible).map((item, index) => {
        const text = `${start + index === list!.selector.selected ? '> ' : '  '}${item.label}${item.detail ? '  ' + item.detail : ''}`;
        return start + index === list!.selector.selected ? paint(`{bold}${singleLine(text, Number(overlay.width) - 4)}{/bold}`, 'amber', color) : singleLine(text, Number(overlay.width) - 4);
      }).join('\n') : list.loading ? 'Loading files...' : 'No matches. Try another query.');
      dialogBody.setScroll(0);
      dialogFooter.setContent('Search: ' + renderEditor(list.selector.query, Number(overlay.width) - 12, 1) +
        `\nUp/Down choose  Enter select  Esc close\n${items.length} match${items.length === 1 ? '' : 'es'}${list.loading ? ' / loading' : ''}`);
    }
  }

  function editKey(model: EditorModel, ch: string, key: blessed.Widgets.Events.IKeyEventArg): boolean {
    const name = key.name;
    if (key.ctrl && name === 'w') model.cut();
    else if (key.ctrl && name === 'a') model.move('home', key.shift);
    else if (key.ctrl && name === 'v') model.paste(model.clipboard);
    else if (name === 'backspace') model.backspace();
    else if (name === 'delete') model.delete();
    else if (['left', 'right', 'up', 'down', 'home', 'end'].includes(name) && !key.ctrl && !key.meta) model.move(name as 'left', key.shift);
    else if (!key.ctrl && !key.meta && ch && !/[\x00-\x1f\x7f]/.test(ch)) model.insert(ch);
    else return false;
    return true;
  }
  function closePermissions(): void { for (const entry of [...permissions]) entry.finish({ decision: 'deny' }); }
  function onKey(ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    if (destroyed || suspended || !key) return;
    // Blessed emits both "enter" and "return" for CR; only handle the first.
    if (key.name === 'return') return;
    footerMessage = '';
    if (key.ctrl && key.name === 'd') { destroy(); return; }
    if (key.ctrl && key.name === 'c') {
      if (running || client?.status().running) { closePermissions(); list = undefined; client?.abort(); }
      else destroy();
      schedule(); return;
    }
    if (permissions[0]) {
      const permission = permissions[0];
      if (key.name === 'escape') { if (patternMode) patternMode = false; else permission.finish({ decision: 'deny' }); }
      else if (key.name === 'pageup' || key.name === 'pagedown') dialogBody.scroll(key.name === 'pageup' ? -Math.max(1, Number(dialogBody.height) - 1) : Math.max(1, Number(dialogBody.height) - 1));
      else if (patternMode) {
        if (key.name === 'enter' && pattern.text.trim()) permission.finish({ decision: 'pattern', pattern: pattern.text.trim() });
        else editKey(pattern, ch, key);
      } else if (key.name === 'enter') {
        if (permissionChoice === 3) { patternMode = true; pattern.set(''); }
        else permission.finish({ decision: (['deny', 'once', 'session'] as const)[permissionChoice]! });
      } else if (['left', 'right', 'tab', 'up', 'down'].includes(key.name)) {
        const count = permission.request.action === 'secret' ? 2 : 4;
        permissionChoice = (permissionChoice + (key.name === 'left' || key.name === 'up' || key.shift ? count - 1 : 1)) % count;
      }
      schedule(); return;
    }
    if (list) {
      if (key.name === 'escape') list = undefined;
      else if (key.name === 'enter') { const current = list.selector.current(); if (current) { const choose = list.choose; list = undefined; choose(current); } }
      else if (key.name === 'up' || key.name === 'down') list.selector.move(key.name === 'up' ? -1 : 1);
      else if (key.name === 'pageup' || key.name === 'pagedown') list.selector.move(key.name === 'pageup' ? -10 : 10);
      else { const previous = list.selector.query.text; editKey(list.selector.query, ch, key); if (previous !== list.selector.query.text) list.selector.selected = 0; }
      schedule(); return;
    }
    if (key.name === 'escape') { if (running || client?.status().running) client?.abort(); else editor.anchor = null; }
    else if (key.ctrl && key.name === 'p') openList('models');
    else if (key.ctrl && key.name === 'o') openList('sessions');
    else if (key.ctrl && key.name === 'k') openList('commands');
    else if (key.ctrl && key.name === 'g') openList('tree');
    else if (key.ctrl && key.name === 'e') void externalEditor();
    else if (key.ctrl && key.name === 'y') copyOutput();
    else if (key.meta && key.name === 'p') { if (client) void command(`/mode ${client.status().mode === 'plan' ? 'build' : 'plan'}`); }
    else if (key.meta && key.name === 't') { transcript.verboseTools = !transcript.verboseTools; dirtyTranscript = true; }
    else if (key.meta && key.name === 'r') { transcript.verboseReasoning = !transcript.verboseReasoning; dirtyTranscript = true; }
    else if (key.name === 'tab') openList('files');
    else if (key.name === 'pageup' || key.name === 'pagedown') {
      following = false; body.scroll((key.name === 'pageup' ? -1 : 1) * Math.max(1, Number(body.height) - 2));
      if (key.name === 'pagedown' && body.getScrollPerc() >= 100) following = true;
    } else if (key.ctrl && key.name === 'end') { following = true; body.setScrollPerc(100); }
    else if (key.name === 'linefeed' || key.ctrl && key.name === 'j' || key.shift && key.name === 'enter') editor.insert('\n');
    else if (key.name === 'enter') submit(key.meta ? 'follow-up' : 'steer');
    else if (key.name === 'up' && !key.shift && (key.meta || editor.firstLine)) editor.recall(-1);
    else if (key.name === 'down' && !key.shift && (key.meta || editor.lastLine)) editor.recall(1);
    else editKey(editor, ch, key);
    schedule();
  }

  async function command(line: string): Promise<void> {
    if (!client) return;
    try { const result = await client.command(line); if (result) notice(result); }
    catch (error) { fail(error); }
    schedule();
  }
  function submit(delivery: 'steer' | 'follow-up'): void {
    if (!client || !editor.text.trim()) return;
    const text = editor.text;
    editor.remember(); editor.set(''); following = true;
    if (text.startsWith('/')) { void command(text); return; }
    // Do not await a run: the composer remains available for steering and follow-ups.
    void client.submit(text, delivery).catch(error => {
      if (!editor.text) editor.set(text);
      fail(error);
    });
  }
  function openList(kind: 'models' | 'sessions' | 'commands' | 'files' | 'tree'): void {
    if (!client) return;
    try {
      let items: SelectorItem[] = [];
      let choose: (item: SelectorItem) => void;
      if (kind === 'models') {
        items = client.models().map(({ key, model }) => ({ id: key, label: key, detail: `${model.name} / ${model.provider} / ${model.contextWindow.toLocaleString()} ctx` }));
        choose = item => { void command(`/model ${item.id}`); };
      } else if (kind === 'sessions') {
        items = client.sessions().map(session => ({ id: session.id, label: session.name || session.id, detail: `${session.id}  ${session.cwd}  ${session.updatedAt}`, search: session.labels.join(' ') }));
        choose = item => { void command(`/resume ${item.id}`); };
      } else if (kind === 'commands') {
        items = client.commands().map(item => ({ id: item.name.startsWith('/') ? item.name : '/' + item.name, label: item.name, detail: item.description }));
        choose = item => { editor.set(item.id + ' '); };
      } else if (kind === 'tree') {
        const records = client.tree();
        const depths = new Map<string, number>();
        items = records.map(record => {
          const depth = record.parentId ? (depths.get(record.parentId) ?? 0) + 1 : 0;
          depths.set(record.id, depth);
          return { id: record.id, label: `${'  '.repeat(Math.min(depth, 8))}${record.parentId ? '+- ' : ''}${record.type}`, detail: `${record.id} ${valueText(record.data.text ?? record.data.content ?? record.data.name ?? record.data.message).slice(0, 160)}` };
        });
        choose = item => { void command(`/branch ${item.id}`); };
      } else {
        const completion = editor.completion();
        choose = item => {
          let path = item.id;
          if (/\s|^['"]/.test(path)) {
            const quote = !path.includes('"') ? '"' : !path.includes("'") ? "'" : undefined;
            if (!quote) throw new Error('This filename cannot be represented as an @file reference: it needs quoting but contains both quote styles. Ask KILN to read it by path instead.');
            path = quote + path + quote;
          }
          const separator = completion.start > 0 && !/\s/.test(editor.text[completion.start - 1]!) ? ' ' : '';
          editor.replace(completion.start, completion.end, separator + '@' + path + ' ');
        };
      }
      const current: ListDialog = { title: kind.toUpperCase(), selector: new SelectorModel(items, kind === 'files'), choose, loading: kind === 'files' };
      list = current;
      if (kind === 'files') {
        current.selector.query.set(editor.completion().query);
        void client.files().then(files => { if (list !== current || destroyed) return; current.selector.items = files.map(file => ({ id: file, label: file })); current.loading = false; schedule(); }, error => {
          if (list === current) { current.loading = false; fail(error); schedule(); }
        });
      }
    } catch (error) { fail(error); }
    schedule();
  }
  function copyOutput(): void {
    const text = displayText([...transcript.rows].reverse().find(row => row.role === 'assistant')?.text ?? '');
    if (!text) { footerMessage = 'No assistant output to copy yet.'; return; }
    editor.clipboard = text;
    if (env.KILN_CLIPBOARD === '1' && env.TERM !== 'dumb') {
      output.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
      footerMessage = 'Copied latest assistant display text via opt-in OSC52.';
    } else footerMessage = 'Copied internally. Ctrl+v inserts it; KILN_CLIPBOARD=1 enables OSC52.';
  }

  async function externalEditor(): Promise<void> {
    if (suspended || destroyed || !screen) return;
    const visual = env.VISUAL || env.EDITOR || 'vi';
    const shell = env.SHELL || '/bin/sh';
    let directory: string | undefined;
    suspended = true;
    clearTimeout(timer); timer = undefined;
    clearTimeout(escapeTimer); escapeTimer = undefined;
    decoder.reset(); utf8 = new StringDecoder('utf8');
    try {
      directory = await mkdtemp(join(tmpdir(), 'kiln-editor-'));
      const path = join(directory, 'message.txt');
      const file = await open(path, 'wx', 0o600);
      try { await file.writeFile(editor.text); } finally { await file.close(); }
      if (destroyed) return;
      if (env.TERM !== 'dumb') output.write('\x1b[?2004l');
      screen.leave();
      input.pause(); input.setRawMode?.(false);
      // The editor command is trusted local configuration; the generated path is a shell argument.
      await new Promise<void>((resolve, reject) => {
        const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
        child = spawn(shell, ['-c', `exec ${visual} ${quote(path)}`], { stdio: 'inherit', env });
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`External editor exited ${signal ?? code}; draft unchanged.`)));
      });
      child = undefined;
      if (destroyed) return;
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw new Error('External editor result must be a regular file under 128 KiB; draft unchanged.');
      const result = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (!(await result.stat()).isFile()) throw new Error('External editor result is not a regular file; draft unchanged.');
        const buffer = Buffer.alloc(128 * 1024 + 1);
        let size = 0;
        while (size < buffer.length) {
          const { bytesRead } = await result.read(buffer, size, buffer.length - size, size);
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (size > 128 * 1024) throw new Error('External editor result is too large; draft unchanged.');
        editor.set(buffer.subarray(0, size).toString('utf8'));
      } finally { await result.close(); }
    } catch (error) { fail(error); }
    finally {
      child = undefined;
      if (directory) await rm(directory, { recursive: true, force: true }).catch(error => fail(error));
      suspended = false;
      if (!destroyed) {
        try {
          input.setRawMode?.(true); input.resume(); screen.enter();
          if (env.TERM !== 'dumb') output.write('\x1b[?2004h');
          dirtyTranscript = true; schedule();
        } catch (error) { destroy(); console.error(`KILN: ${displayText(errorMessage(error))}`); }
      }
    }
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(timer); clearTimeout(escapeTimer);
    try { unsubscribe?.(); } catch { /* Client cleanup cannot prevent terminal restoration. */ }
    unsubscribe = undefined;
    closePermissions(); list = undefined;
    child?.kill('SIGTERM');
    input.removeListener('data', onData); input.removeListener('end', onEnd); input.removeListener('error', onEnd);
    output.removeListener('error', onEnd);
    try { if (screen && env.TERM !== 'dumb') output.write('\x1b[?2004l'); } catch { /* Terminal may have disconnected. */ }
    try { if (screen && !screen.destroyed) screen.destroy(); } catch { /* Still restore raw mode below. */ }
    try {
      if (screen) { input.setRawMode?.(rawBefore); if (flowingBefore) input.resume(); else input.pause(); }
    } catch { /* Closed input. */ }
    keys.destroy(); decoder.reset();
    resolveQuit();
  }
  return {
    prompt(request, signal) {
      if (destroyed || signal.aborted) return Promise.resolve({ decision: 'deny' });
      ensureScreen();
      if (destroyed || signal.aborted) return Promise.resolve({ decision: 'deny' });
      return new Promise<PermissionAnswer>(resolve => {
        let finished = false;
        const entry: PermissionEntry = { request: { ...request }, finish(answer) {
          if (finished) return;
          finished = true;
          signal.removeEventListener('abort', cancel);
          const index = permissions.indexOf(entry);
          if (index >= 0) permissions.splice(index, 1);
          if (index === 0) { permissionChoice = 0; patternMode = false; pattern.set(''); }
          resolve(answer); schedule();
        } };
        const cancel = () => entry.finish({ decision: 'deny' });
        permissions.push(entry);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        schedule();
      });
    },
    attach(attached) {
      if (destroyed) return;
      const startupNotices = client ? [] : transcript.rows;
      unsubscribe?.(); client = attached; running = attached.status().running;
      displayedSession = attached.status().session.id;
      const messages = attached.transcript();
      transcript.load(messages);
      for (const row of startupNotices) transcript.add(row);
      for (const message of messages.slice(-100)) if (message.role === 'user') editor.remember(message.content);
      unsubscribe = attached.subscribe(event => {
        if (destroyed) return;
        if (event.type === 'agent.start') running = true;
        if (event.type === 'agent.end') { running = false; closePermissions(); }
        if (event.type.startsWith('session.') && (!running || displayedSession !== attached.status().session.id)) {
          transcript.load(attached.transcript()); displayedSession = attached.status().session.id; following = true;
        }
        transcript.event(event);
        if (event.type !== 'usage') dirtyTranscript = true;
        schedule();
      });
      dirtyTranscript = true; ensureScreen(); schedule();
    },
    notice,
    run() { if (!destroyed) ensureScreen(); return quit; },
    destroy,
  };
}
