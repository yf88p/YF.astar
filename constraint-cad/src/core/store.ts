import { clone, emptyDocument, keyOf, LIMITS, validateDocument, type Document } from './model';
import { solve, type DragTarget, type SolveResult } from './solver';

export class SketchStore {
  document: Document;
  result: SolveResult;
  past: Document[] = [];
  future: Document[] = [];
  lastError: { message: string; conflicts: string[]; status: string } | null = null;
  private dragStart: Document | null = null;
  constructor(doc = emptyDocument()) {
    this.result = solve(doc);
    if (!this.result.ok) throw new Error(this.result.message);
    this.document = this.result.document;
  }
  clearError() {
    this.lastError = null;
  }
  private reject(message: string, conflicts: string[] = [], status = 'invalid') {
    this.lastError = { message, conflicts, status };
    return false;
  }
  private commit(input: unknown): boolean {
    try {
      const d = validateDocument(input),
        result = solve(d);
      if (!result.ok) return this.reject(result.message, result.conflicts, result.status);
      if (JSON.stringify(this.document) !== JSON.stringify(result.document)) {
        this.past.push(clone(this.document));
        if (this.past.length > 100) this.past.shift();
        this.future = [];
      }
      this.document = result.document;
      this.result = result;
      this.clearError();
      return true;
    } catch (e) {
      return this.reject((e as Error).message);
    }
  }
  transact(mutator: (draft: Document) => void): boolean {
    if (this.dragStart) this.endDrag();
    const d = clone(this.document);
    try {
      mutator(d);
    } catch (e) {
      return this.reject((e as Error).message);
    }
    return this.commit(d);
  }
  replace(input: unknown): boolean {
    if (this.dragStart) this.endDrag();
    return this.commit(input);
  }
  undo(): boolean {
    if (this.dragStart) {
      this.cancelDrag();
      return true;
    }
    // A rejected operation is a visible, dismissible undo barrier, not a history entry.
    if (this.lastError) {
      this.clearError();
      return true;
    }
    const d = this.past.pop();
    if (!d) return false;
    this.future.push(clone(this.document));
    this.document = d;
    this.result = solve(d);
    return true;
  }
  redo(): boolean {
    if (this.dragStart) {
      this.cancelDrag();
      return true;
    }
    this.clearError();
    const d = this.future.pop();
    if (!d) return false;
    this.past.push(clone(this.document));
    this.document = d;
    this.result = solve(d);
    return true;
  }
  beginDrag() {
    if (!this.dragStart) this.dragStart = clone(this.document);
    this.clearError();
  }
  drag(targets: DragTarget[]): boolean {
    if (!this.dragStart) this.beginDrag();
    if (
      targets.every(
        (p) =>
          p?.target &&
          this.result.immovableTargets.includes(keyOf(p.target)) &&
          [p.x, p.y].every((v) => Number.isFinite(v) && Math.abs(v) <= LIMITS.coordinate),
      )
    ) {
      this.clearError();
      return true;
    }
    const result = solve(this.document, { drag: targets, timeBudgetMs: 100 });
    if (!result.ok) return this.reject(result.message, result.conflicts, result.status);
    this.document = result.document;
    this.result = result;
    this.clearError();
    return true;
  }
  endDrag() {
    if (this.dragStart && JSON.stringify(this.dragStart) !== JSON.stringify(this.document)) {
      this.past.push(this.dragStart);
      if (this.past.length > 100) this.past.shift();
      this.future = [];
    }
    this.dragStart = null;
  }
  cancelDrag() {
    if (this.dragStart) {
      this.document = this.dragStart;
      this.result = solve(this.document);
      this.dragStart = null;
    }
    this.clearError();
  }
}
