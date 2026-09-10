import { safeText } from './util.js';

export const MAX_DRAFT = 128 * 1024;
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Terminal controls are never executable, including C1 controls and bidi overrides. */
export function displayText(text: string): string {
  return safeText(text.replace(/\r\n?/g, '\n'))
    .replace(/[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
}

export function cellWidth(text: string): number {
  let width = 0;
  for (const { segment } of segments.segment(text)) {
    const cp = segment.codePointAt(0)!;
    width += /^\p{Mark}/u.test(segment) ? 0 : segment === '\t' ? 4 :
      /\p{Extended_Pictographic}/u.test(segment) || cp >= 0x1100 && (
        cp <= 0x115f || cp >= 0x2329 && cp <= 0x232a || cp >= 0x2e80 && cp <= 0xa4cf ||
        cp >= 0xac00 && cp <= 0xd7a3 || cp >= 0xf900 && cp <= 0xfaff ||
        cp >= 0xfe10 && cp <= 0xfe6f || cp >= 0xff01 && cp <= 0xff60 || cp >= 0x20000
      ) ? 2 : 1;
  }
  return width;
}

export interface EditorState { text: string; cursor: number; anchor: number | null }
export interface EditorCell { text: string; selected: boolean; cursor: boolean }
export interface EditorView {
  lines: EditorCell[][];
  top: number;
  left: number;
  row: number;
  column: number;
}

export class EditorModel {
  text = '';
  cursor = 0;
  anchor: number | null = null;
  clipboard = '';
  private history: string[] = [];
  private historyIndex = 0;
  private draft: EditorState | undefined;
  private preferredColumn: number | undefined;
  private top = 0;
  private left = 0;

  get selection(): [number, number] {
    return [Math.min(this.anchor ?? this.cursor, this.cursor), Math.max(this.anchor ?? this.cursor, this.cursor)];
  }
  snapshot(): EditorState { return { text: this.text, cursor: this.cursor, anchor: this.anchor }; }
  restore(state: EditorState): void {
    this.text = state.text;
    this.cursor = Math.min(state.cursor, this.text.length);
    this.anchor = state.anchor === null ? null : Math.min(state.anchor, this.text.length);
    this.preferredColumn = undefined;
  }
  set(text: string): void {
    this.text = displayText(text).slice(0, MAX_DRAFT);
    this.cursor = this.text.length;
    this.anchor = null;
    this.preferredColumn = undefined;
    this.historyIndex = this.history.length;
    this.draft = undefined;
  }
  replace(start: number, end: number, text: string): void {
    const clean = displayText(text);
    const available = Math.max(0, MAX_DRAFT - (this.text.length - (end - start)));
    const value = clean.slice(0, available);
    this.text = this.text.slice(0, start) + value + this.text.slice(end);
    this.cursor = start + value.length;
    this.anchor = null;
    this.preferredColumn = undefined;
  }
  insert(text: string): void { this.replace(...this.selection, text); }
  paste(text: string): void { this.insert(text); }
  private boundary(direction: -1 | 1): number {
    let previous = 0;
    for (const { index, segment } of segments.segment(this.text)) {
      if (direction < 0 && index >= this.cursor) return previous;
      if (direction > 0 && index + segment.length > this.cursor) return index + segment.length;
      previous = index;
    }
    return direction < 0 ? previous : this.text.length;
  }
  private go(position: number, select: boolean): void {
    if (select) this.anchor ??= this.cursor;
    else this.anchor = null;
    this.cursor = Math.max(0, Math.min(this.text.length, position));
  }
  move(direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'end', select = false): void {
    const [start, end] = this.selection;
    if (direction === 'left' || direction === 'right') {
      this.go(!select && start !== end ? direction === 'left' ? start : end : this.boundary(direction === 'left' ? -1 : 1), select);
      this.preferredColumn = undefined;
      return;
    }
    const lineStart = this.text.slice(0, this.cursor).lastIndexOf('\n') + 1;
    const nextBreak = this.text.indexOf('\n', this.cursor);
    const lineEnd = nextBreak < 0 ? this.text.length : nextBreak;
    if (direction === 'home' || direction === 'end') {
      this.go(direction === 'home' ? lineStart : lineEnd, select);
      this.preferredColumn = undefined;
      return;
    }
    this.preferredColumn ??= cellWidth(this.text.slice(lineStart, this.cursor));
    if (direction === 'up' && lineStart === 0 || direction === 'down' && lineEnd === this.text.length) return;
    const targetStart = direction === 'up' ? this.text.slice(0, lineStart - 1).lastIndexOf('\n') + 1 : lineEnd + 1;
    const targetBreak = this.text.indexOf('\n', targetStart);
    const targetEnd = targetBreak < 0 ? this.text.length : targetBreak;
    let position = targetStart;
    let column = 0;
    for (const { segment } of segments.segment(this.text.slice(targetStart, targetEnd))) {
      const width = cellWidth(segment);
      if (column + width > this.preferredColumn) break;
      column += width;
      position += segment.length;
    }
    this.go(position, select);
  }
  backspace(): void {
    const [start, end] = this.selection;
    this.replace(start === end ? this.boundary(-1) : start, end, '');
  }
  delete(): void {
    const [start, end] = this.selection;
    this.replace(start, start === end ? this.boundary(1) : end, '');
  }
  cut(): string {
    let [start, end] = this.selection;
    if (start === end) start = this.text.slice(0, start).replace(/\S+\s*$|\s+$/u, '').length;
    this.clipboard = this.text.slice(start, end);
    this.replace(start, end, '');
    return this.clipboard;
  }
  remember(text = this.text): void {
    text = displayText(text).slice(0, MAX_DRAFT);
    if (text.trim() && this.history.at(-1) !== text) this.history.push(text);
    while (this.history.length > 100 || this.history.reduce((size, value) => size + value.length, 0) > 1024 * 1024) this.history.shift();
    this.historyIndex = this.history.length;
    this.draft = undefined;
  }
  recall(direction: -1 | 1): boolean {
    const index = Math.max(0, Math.min(this.history.length, this.historyIndex + direction));
    if (index === this.historyIndex) return false;
    if (this.historyIndex === this.history.length) this.draft = this.snapshot();
    this.historyIndex = index;
    if (index === this.history.length) this.restore(this.draft ?? { text: '', cursor: 0, anchor: null });
    else { const text = this.history[index]!; this.restore({ text, cursor: text.length, anchor: null }); }
    return true;
  }
  get firstLine(): boolean { return !this.text.slice(0, this.cursor).includes('\n'); }
  get lastLine(): boolean { return !this.text.slice(this.cursor).includes('\n'); }
  completion(): { start: number; end: number; query: string } {
    const prefix = this.text.slice(0, this.cursor);
    const match = /(?:^|\s)@([^\s]*)$/.exec(prefix);
    const suffix = /^\S*/.exec(this.text.slice(this.cursor))![0];
    return match ? { start: this.cursor - match[1]!.length - 1, end: this.cursor + suffix.length, query: match[1]! } :
      { start: this.cursor, end: this.cursor, query: '' };
  }
  view(width: number, height: number): EditorView {
    width = Math.max(1, width); height = Math.max(1, height);
    const before = this.text.slice(0, this.cursor).split('\n');
    const row = before.length - 1;
    const column = cellWidth(before.at(-1)!);
    this.top = Math.max(0, Math.min(this.top, row));
    if (row >= this.top + height) this.top = row - height + 1;
    this.left = Math.max(0, Math.min(this.left, column));
    if (column >= this.left + width) this.left = column - width + 1;
    const [start, end] = this.selection;
    let offset = 0;
    const lines: EditorCell[][] = [];
    const logical = this.text.split('\n');
    for (let y = 0; y < logical.length; y++) {
      const line = logical[y]!;
      if (y >= this.top && y < this.top + height) {
        let x = 0;
        const cells: EditorCell[] = [];
        for (const { index, segment } of segments.segment(line + ' ')) {
          const size = cellWidth(segment);
          if (x >= this.left && x + size <= this.left + width) {
            cells.push({ text: segment === '\t' ? '    ' : segment, selected: offset + index >= start && offset + index < end,
              cursor: offset + index === this.cursor });
          } else if (x < this.left && x + size > this.left) {
            cells.push({ text: ' '.repeat(x + size - this.left), selected: false, cursor: false });
          }
          x += size;
        }
        lines.push(cells);
      }
      offset += line.length + 1;
    }
    return { lines, top: this.top, left: this.left, row, column };
  }
}

export interface SelectorItem { id: string; label: string; detail?: string; search?: string }
export class SelectorModel {
  readonly query = new EditorModel();
  selected = 0;
  constructor(public items: SelectorItem[], public fuzzy = false) {}
  filtered(): SelectorItem[] {
    const query = this.query.text.trim().toLowerCase();
    if (!query) return this.items;
    const words = query.split(/\s+/);
    return this.items.map((item, order) => {
      const text = `${item.label} ${item.detail ?? ''} ${item.search ?? ''}`.toLowerCase();
      let score = 0;
      for (const word of words) {
        const exact = text.indexOf(word);
        if (exact >= 0) { score += exact; continue; }
        if (!this.fuzzy) return { item, order, score: Infinity };
        let last = -1;
        for (const char of word) {
          const next = text.indexOf(char, last + 1);
          if (next < 0) return { item, order, score: Infinity };
          score += next - last + 100;
          last = next;
        }
      }
      return { item, order, score };
    }).filter(match => Number.isFinite(match.score)).sort((a, b) => a.score - b.score || a.order - b.order).map(match => match.item);
  }
  move(delta: number): void { this.selected = Math.max(0, Math.min(this.filtered().length - 1, this.selected + delta)); }
  current(): SelectorItem | undefined { const items = this.filtered(); return items[Math.min(this.selected, items.length - 1)]; }
}

export interface InputPart { kind: 'keys' | 'paste'; text: string }

/** Keep paste payloads out of the terminal key decoder, even when delimiters are split. */
export class TerminalInputDecoder {
  private pending = '';
  private paste: string | undefined;
  feed(text: string): InputPart[] {
    this.pending += text;
    const result: InputPart[] = [];
    while (this.pending) {
      if (this.paste !== undefined) {
        const end = this.pending.indexOf('\x1b[201~');
        if (end >= 0) {
          result.push({ kind: 'paste', text: (this.paste + this.pending.slice(0, end)).slice(0, MAX_DRAFT) });
          this.paste = undefined;
          this.pending = this.pending.slice(end + 6);
          continue;
        }
        let keep = 0;
        for (let n = 1; n < 6; n++) if (this.pending.endsWith('\x1b[201~'.slice(0, n))) keep = n;
        this.paste = (this.paste + this.pending.slice(0, this.pending.length - keep)).slice(0, MAX_DRAFT);
        this.pending = this.pending.slice(this.pending.length - keep);
        break;
      }
      const escape = this.pending.indexOf('\x1b');
      if (escape < 0) { result.push({ kind: 'keys', text: this.pending }); this.pending = ''; break; }
      if (escape > 0) { result.push({ kind: 'keys', text: this.pending.slice(0, escape) }); this.pending = this.pending.slice(escape); }
      if ('\x1b[200~'.startsWith(this.pending)) break;
      if (this.pending.startsWith('\x1b[200~')) { this.paste = ''; this.pending = this.pending.slice(6); continue; }
      const sequence = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|O.|[^\[O])/s.exec(this.pending);
      if (!sequence && this.pending.length < 64) break;
      const length = sequence?.[0].length ?? 1;
      result.push({ kind: 'keys', text: this.pending.slice(0, length) });
      this.pending = this.pending.slice(length);
    }
    // An exact start delimiter must enter paste mode without waiting for its payload.
    if (this.paste === undefined && this.pending === '\x1b[200~') { this.paste = ''; this.pending = ''; }
    return result;
  }
  flush(): InputPart[] {
    if (this.paste !== undefined) return [];
    const text = this.pending; this.pending = '';
    return text ? [{ kind: 'keys', text }] : [];
  }
  reset(): void { this.pending = ''; this.paste = undefined; }
}
