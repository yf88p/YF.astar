import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BoxSelect,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  CircleHelp,
  Command,
  Copy,
  Crosshair,
  FilePlus2,
  FolderOpen,
  Grip,
  Hand,
  Layers2,
  Link2,
  LockKeyhole,
  Magnet,
  Minus,
  MousePointer2,
  PanelLeftClose,
  PanelRight,
  Plus,
  Redo2,
  Ruler,
  Settings2,
  Slash,
  Square,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import {
  clone,
  emptyDocument,
  keyOf,
  references,
  removeEntities,
  targetPosition,
  targets,
  uid,
  type Constraint,
  type Document,
  type Entity,
  type Target,
  type Vec,
} from '../core/model';
import { examples, performanceSketch, rectangle } from '../core/examples';
import { SketchStore } from '../core/store';
import { solve } from '../core/solver';
import { SketchCanvas, fmt, type CanvasHandle, type Selection, type Tool } from './Canvas';

type ConstraintType = Constraint['type'];
const labels: Record<ConstraintType, string> = {
  coincident: 'Coincident',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  distance: 'Distance',
  radius: 'Radius',
  fixed: 'Fixed',
};
function ConstraintIcon({ type, size = 16 }: { type: ConstraintType; size?: number }) {
  if (type === 'fixed') return <LockKeyhole size={size} />;
  if (type === 'coincident') return <Link2 size={size} />;
  if (type === 'distance') return <Ruler size={size} />;
  if (type === 'radius') return <CircleDot size={size} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      {type === 'horizontal' ? (
        <>
          <path d="M 3 10 H 17" />
          <path d="M 3 7 V 13 M 17 7 V 13" />
        </>
      ) : type === 'vertical' ? (
        <>
          <path d="M 10 3 V 17" />
          <path d="M 7 3 H 13 M 7 17 H 13" />
        </>
      ) : type === 'parallel' ? (
        <path d="M 3 16 L 9 4 M 11 16 L 17 4" />
      ) : (
        <>
          <path d="M 4 4 V 16 H 17" />
          <path d="M 4 11 H 9 V 16" />
        </>
      )}
    </svg>
  );
}
function EntityIcon({ entity, size = 15 }: { entity: Entity; size?: number }) {
  return entity.type === 'line' ? (
    <Slash size={size} />
  ) : entity.type === 'circle' ? (
    <Circle size={size} />
  ) : (
    <Crosshair size={size} />
  );
}
function NumberField({
  value,
  label,
  onCommit,
  unit = 'mm',
  autoFocus = false,
}: {
  value: number;
  label: string;
  onCommit: (v: number) => void;
  unit?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setText(String(value));
  }, [value]);
  function commit() {
    if (!dirty.current) return;
    dirty.current = false;
    const n = text.trim() === '' ? NaN : Number(text);
    onCommit(n);
    setText(String(value));
  }
  return (
    <div className="number-field">
      <input
        aria-label={label}
        autoFocus={autoFocus}
        inputMode="decimal"
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setText(e.target.value);
          dirty.current = true;
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            dirty.current = false;
            setText(String(value));
            e.currentTarget.blur();
          }
        }}
      />
      <span>{unit}</span>
    </div>
  );
}
function MiniSketch({ doc }: { doc: Document }) {
  const all = doc.entities.flatMap((e) =>
    e.type === 'circle'
      ? [
          { x: e.center.x - e.radius, y: e.center.y - e.radius },
          { x: e.center.x + e.radius, y: e.center.y + e.radius },
        ]
      : targets(e).map((t) => targetPosition(doc, t)),
  );
  const minX = Math.min(...all.map((p) => p.x)),
    maxX = Math.max(...all.map((p) => p.x)),
    minY = Math.min(...all.map((p) => p.y)),
    maxY = Math.max(...all.map((p) => p.y));
  const scale = Math.min(155 / Math.max(20, maxX - minX), 64 / Math.max(20, maxY - minY));
  const p = (v: Vec) => ({
    x: 110 + (v.x - (minX + maxX) / 2) * scale,
    y: 53 - (v.y - (minY + maxY) / 2) * scale,
  });
  return (
    <svg viewBox="0 0 220 106" className="mini-sketch">
      {doc.entities.map((e) => (
        <g key={e.id} strokeDasharray={e.construction ? '4 4' : undefined}>
          {e.type === 'line' && <line x1={p(e.a).x} y1={p(e.a).y} x2={p(e.b).x} y2={p(e.b).y} />}
          {e.type === 'circle' && <circle cx={p(e.center).x} cy={p(e.center).y} r={e.radius * scale} />}
          {targets(e).map((t) => {
            const q = p(targetPosition(doc, t));
            return <circle key={t.point} className="mini-point" cx={q.x} cy={q.y} r="2.5" />;
          })}
        </g>
      ))}
    </svg>
  );
}

export default function App() {
  const [store] = useState(() => {
    try {
      const saved = localStorage.getItem('datum-document-v1');
      if (saved) return new SketchStore(JSON.parse(saved));
    } catch {
      /* A corrupt local recovery copy must not block startup. */
    }
    return new SketchStore(rectangle());
  });
  const [, setRevision] = useState(0),
    [name, setName] = useState(() => {
      try {
        return (
          localStorage.getItem('datum-title-v1') ??
          (localStorage.getItem('datum-document-v1') ? 'Recovered sketch' : 'Driven rectangle')
        );
      } catch {
        return 'Driven rectangle';
      }
    }),
    [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection[]>([]),
    [constraintId, setConstraintId] = useState<string | null>(null);
  const [construction, setConstruction] = useState(false),
    [snapping, setSnapping] = useState(true),
    [coords, setCoords] = useState<Vec>({ x: 0, y: 0 }),
    [grid, setGrid] = useState(10);
  const [dialog, setDialog] = useState<'examples' | 'import' | 'help' | null>(null),
    [json, setJson] = useState('');
  const [dimensionDialog, setDimensionDialog] = useState<{ constraint: Constraint; value: string } | null>(
    null,
  );
  const [toast, setToast] = useState(''),
    [sidebarTab, setSidebarTab] = useState<'entities' | 'constraints'>('entities'),
    [mobileInspector, setMobileInspector] = useState(false);
  const canvas = useRef<CanvasHandle>(null),
    file = useRef<HTMLInputElement>(null),
    selectedField = useRef<HTMLDivElement>(null);
  const doc = store.document,
    result = store.result;
  function refresh() {
    setRevision((n) => n + 1);
    try {
      localStorage.setItem('datum-document-v1', JSON.stringify(store.document));
    } catch {
      /* JSON export remains available when browser storage is full. */
    }
  }
  function select(s: Selection[]) {
    setSelection(s);
    setConstraintId(null);
  }
  function notice(message: string) {
    store.lastError = { message, conflicts: [], status: 'selection' };
    refresh();
  }
  function commit(fn: (d: Document) => void) {
    const ok = store.transact(fn);
    refresh();
    return ok;
  }
  function fitSoon() {
    requestAnimationFrame(() => requestAnimationFrame(() => canvas.current?.fit()));
  }
  function replace(d: unknown, title?: string) {
    const ok = store.replace(d);
    refresh();
    if (ok) {
      select([]);
      setTool('select');
      if (title) setName(title);
      fitSoon();
    }
    return ok;
  }
  function removeSelection() {
    if (constraintId) {
      commit((d) => {
        d.constraints = d.constraints.filter((c) => c.id !== constraintId);
      });
      setConstraintId(null);
    } else if (selection.length) {
      const ids = selection.map((s) => s.entity);
      commit((d) => Object.assign(d, removeEntities(d, ids)));
      select([]);
    }
  }
  function history(direction: 'undo' | 'redo') {
    store[direction]();
    select([]);
    refresh();
  }
  function setConstructionFlag() {
    if (selection.length) {
      const ids = selection.map((s) => s.entity);
      const all = doc.entities.filter((e) => ids.includes(e.id)).every((e) => e.construction);
      commit((d) => {
        for (const e of d.entities) if (ids.includes(e.id)) e.construction = !all;
      });
    } else setConstruction((v) => !v);
  }
  const selectedEntities = doc.entities.filter((e) => selection.some((s) => s.entity === e.id));
  function pointSelection(): Target[] {
    return selection.flatMap((s) => {
      const e = doc.entities.find((e) => e.id === s.entity);
      return !e ? [] : s.point ? [s as Target] : e.type !== 'line' ? targets(e) : [];
    });
  }
  function addConstraint(type: ConstraintType) {
    const lines = selectedEntities.filter((e) => e.type === 'line'),
      points = pointSelection(),
      circles = selectedEntities.filter((e) => e.type === 'circle');
    const id = uid('c');
    let c: Constraint;
    if (type === 'horizontal' || type === 'vertical') {
      if (lines.length !== 1)
        return notice(`Select one line, then choose ${labels[type]}. Click its body or an endpoint.`);
      c = { id, type, line: lines[0].id };
    } else if (type === 'parallel' || type === 'perpendicular') {
      if (lines.length !== 2)
        return notice(
          `Select two lines with Shift-click, then choose ${labels[type]}. Their lengths must be nonzero.`,
        );
      c = { id, type, a: lines[0].id, b: lines[1].id };
    } else if (type === 'coincident' || type === 'distance') {
      const pp =
        points.length === 2 ? points : lines.length === 1 && selection.length === 1 ? targets(lines[0]) : [];
      if (pp.length !== 2)
        return notice(
          `Select two point targets with Shift-click (endpoints, centers, or standalone points)${type === 'distance' ? ', or select one line' : ''}, then choose ${labels[type]}.`,
        );
      const a = targetPosition(doc, pp[0]),
        b = targetPosition(doc, pp[1]);
      c =
        type === 'coincident'
          ? { id, type, a: pp[0], b: pp[1] }
          : { id, type, a: pp[0], b: pp[1], value: Math.hypot(a.x - b.x, a.y - b.y) };
    } else if (type === 'radius') {
      if (circles.length !== 1) return notice('Select one circle, then choose Radius.');
      c = { id, type, circle: circles[0].id, value: circles[0].radius };
    } else {
      const pp = points.length ? points : selectedEntities.flatMap(targets);
      if (!pp.length)
        return notice(
          'Select a point target to fix its coordinates. Selecting a whole line fixes both endpoints.',
        );
      commit((d) => {
        pp.forEach((target) => {
          const p = targetPosition(d, target);
          d.constraints.push({ id: uid('c'), type: 'fixed', target, x: p.x, y: p.y });
        });
      });
      return;
    }
    if (c.type === 'distance' || c.type === 'radius')
      setDimensionDialog({ constraint: c, value: String(c.value) });
    else commit((d) => d.constraints.push(c));
  }
  function editDimension(id: string, value: number) {
    commit((d) => {
      const c = d.constraints.find((c) => c.id === id);
      if (c && (c.type === 'distance' || c.type === 'radius')) c.value = value;
    });
  }
  function exportDocument() {
    const blob = new Blob([JSON.stringify(store.document, null, 2)], { type: 'application/json' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'sketch'}.datum.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast('Editable sketch exported. Geometry and constraints included.');
  }
  function importText(text: string, title = 'Imported sketch') {
    try {
      if (text.length > 2_000_000) throw new Error('File exceeds the 2 MB document limit.');
      const parsed = JSON.parse(text);
      if (replace(parsed, title)) {
        setDialog(null);
        setJson('');
        setToast('Sketch opened. All constraints are active.');
      }
    } catch (e) {
      notice(`Cannot open sketch: ${(e as Error).message}`);
    }
  }
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    try {
      localStorage.setItem('datum-title-v1', name);
    } catch {
      /* Naming is still available for JSON export. */
    }
  }, [name]);
  useEffect(() => {
    if (!dialog && !dimensionDialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const focusable = () => [
      ...modal.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([type="file"]),textarea'),
    ];
    const timer = requestAnimationFrame(() =>
      (modal.querySelector<HTMLElement>('input:not([type="file"]),textarea') ?? focusable()[0])?.focus(),
    );
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDialog(null);
        setDimensionDialog(null);
      }
      if (event.key !== 'Tab') return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener('keydown', keyboard);
      if (previous?.isConnected) previous.focus();
    };
  }, [dialog, !!dimensionDialog]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea,select') || dialog || dimensionDialog) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        history(e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history('redo');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportDocument();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        select(doc.entities.map((e) => ({ entity: e.id })));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        setTool('select');
        select([]);
      }
      if (k === 'v') setTool('select');
      if (k === 'l') setTool('line');
      if (k === 'c') setTool('circle');
      if (k === 'p') setTool('point');
      if (k === 'h') addConstraint('horizontal');
      if (k === 'd') addConstraint('distance');
      if (k === 'r') addConstraint('radius');
      if (k === 'f') canvas.current?.fit();
      if (k === 'x') setConstructionFlag();
      if (k === 's') setSnapping((v) => !v);
      if (k === 'delete' || k === 'backspace') {
        e.preventDefault();
        removeSelection();
      }
      if (k === '?') setDialog('help');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  // Public local inspection API also supports headless, reproducible browser checks.
  useEffect(() => {
    const api = {
      store,
      getDocument: () => clone(store.document),
      getResult: () => ({ ...store.result, document: clone(store.document) }),
      getView: () => canvas.current?.getView(),
      load: (d: unknown) => replace(d),
      fit: () => canvas.current?.fit(),
      solve,
      performanceSketch,
    };
    (window as unknown as { __datum: typeof api }).__datum = api;
  });
  useEffect(() => {
    setSelection((s) => s.filter((q) => doc.entities.some((e) => e.id === q.entity)));
    if (constraintId && !doc.constraints.some((c) => c.id === constraintId)) setConstraintId(null);
  }, [doc]);
  function inspectConstraint(id: string) {
    setConstraintId(id);
    setSelection([]);
    setMobileInspector(true);
    setTimeout(() => selectedField.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
  }
  const selectedConstraint = doc.constraints.find((c) => c.id === constraintId),
    dimensions = doc.constraints.filter((c) => c.type === 'distance' || c.type === 'radius');
  const solverLabel =
    result.status === 'singular'
      ? 'Rank uncertain'
      : result.dof === 0
        ? 'Fully constrained'
        : 'Underconstrained';
  const single = selectedEntities.length === 1 ? selectedEntities[0] : null;
  const selectedPoints = pointSelection();
  const description = (c: Constraint) =>
    c.type === 'distance' || c.type === 'radius'
      ? `${fmt(c.value)} mm`
      : c.type === 'fixed'
        ? `${fmt(c.x)}, ${fmt(c.y)}`
        : references(c).join(' + ');
  const titleOf = (e: Entity) =>
    `${e.type[0].toUpperCase()}${e.type.slice(1)} ${String(doc.entities.filter((q) => q.type === e.type).findIndex((q) => q.id === e.id) + 1).padStart(2, '0')}`;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setDialog('examples');
          }}
          aria-label="Datum sketcher home"
        >
          <span className="brand-symbol">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M 5 19 V 5 H 11 C 20 5 20 19 11 19 Z" stroke="currentColor" strokeWidth="2" />
              <path d="M 2 12 H 22 M 12 2 V 22" stroke="currentColor" strokeWidth="1" opacity=".5" />
            </svg>
          </span>
          <span>
            datum<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="top-divider" />
        <div className="document-title">
          <span className="document-name">
            {name}
            <span className="document-extension">.sketch</span>
          </span>
          <span className="local-state">
            <span />
            Local recovery enabled
          </span>
        </div>
        <div className="top-actions">
          <button className="quiet-button examples-trigger" onClick={() => setDialog('examples')}>
            <Layers2 size={16} />
            Examples
            <ChevronDown size={13} />
          </button>
          <button
            className="icon-button"
            aria-label="New sketch"
            title="New empty sketch (undoable)"
            onClick={() => replace(emptyDocument(), 'Untitled sketch')}
          >
            <FilePlus2 size={18} />
          </button>
          <button className="secondary-button" aria-label="Open" onClick={() => setDialog('import')}>
            <FolderOpen size={16} />
            <span>Open</span>
          </button>
          <button className="primary-button" onClick={exportDocument}>
            <ArrowDownToLine size={16} />
            <span>Export sketch</span>
          </button>
          <button
            className="icon-button help-button"
            aria-label="Help and shortcuts"
            title="Help and shortcuts (?)"
            onClick={() => setDialog('help')}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      <nav className="tool-ribbon" aria-label="Sketch tools">
        <div className="tool-group history-tools">
          <div className="tool-row">
            <button
              className="icon-button"
              disabled={!store.past.length && !store.lastError}
              aria-label="Undo"
              title="Undo (Ctrl+Z). First undo after rejection dismisses the rejected operation."
              onClick={() => history('undo')}
            >
              <Undo2 size={19} />
            </button>
            <button
              className="icon-button"
              disabled={!store.future.length}
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              onClick={() => history('redo')}
            >
              <Redo2 size={19} />
            </button>
          </div>
          <span className="group-label">HISTORY</span>
        </div>
        <div className="tool-group draw-tools">
          <div className="tool-row">
            {(
              [
                { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
                { id: 'line', label: 'Line', key: 'L', icon: Slash },
                { id: 'circle', label: 'Circle', key: 'C', icon: Circle },
                { id: 'point', label: 'Point', key: 'P', icon: Crosshair },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                className={`tool-button ${tool === t.id ? 'active' : ''}`}
                aria-label={`${t.label} tool`}
                aria-pressed={tool === t.id}
                title={`${t.label} (${t.key})`}
                onClick={() => setTool(t.id)}
              >
                <t.icon size={19} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <span className="group-label">SKETCH</span>
        </div>
        <div className="tool-group constraint-tools">
          <div className="tool-row">
            {(['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'fixed'] as const).map(
              (t) => (
                <button
                  key={t}
                  className="tool-button"
                  aria-label={`Add ${labels[t]}`}
                  title={`${labels[t]}${t === 'horizontal' ? ' (H)' : ''}`}
                  onClick={() => addConstraint(t)}
                >
                  <ConstraintIcon type={t} size={19} />
                  <span>{t === 'perpendicular' ? 'Perpend.' : labels[t]}</span>
                </button>
              ),
            )}
          </div>
          <span className="group-label">CONSTRAIN</span>
        </div>
        <div className="tool-group dimension-tools">
          <div className="tool-row">
            {(['distance', 'radius'] as const).map((t) => (
              <button
                key={t}
                className="tool-button"
                aria-label={`Add ${labels[t]}`}
                title={`${labels[t]} (${t === 'distance' ? 'D' : 'R'})`}
                onClick={() => addConstraint(t)}
              >
                <ConstraintIcon type={t} size={19} />
                <span>{labels[t]}</span>
              </button>
            ))}
          </div>
          <span className="group-label">DIMENSION</span>
        </div>
        <div className="tool-group options-tools">
          <div className="tool-row">
            <button
              className={`tool-button ${selection.length ? (selectedEntities.every((e) => e.construction) ? 'active' : '') : construction ? 'active' : ''}`}
              aria-label="Toggle construction"
              title="Toggle construction for selected geometry, or new geometry (X)"
              onClick={setConstructionFlag}
            >
              <BoxSelect size={19} />
              <span>Construct</span>
            </button>
            <button
              className={`tool-button ${snapping ? 'sub-active' : ''}`}
              aria-label="Toggle snapping"
              aria-pressed={snapping}
              title="Point/origin snapping (S). Every snap constraint is visible and removable."
              onClick={() => setSnapping((v) => !v)}
            >
              <Magnet size={19} />
              <span>Snap</span>
            </button>
            <button
              className={`tool-button ${tool === 'pan' ? 'active' : ''}`}
              aria-label="Pan tool"
              title="Pan (hold Space or middle mouse)"
              onClick={() => setTool('pan')}
            >
              <Hand size={19} />
              <span>Pan</span>
            </button>
          </div>
          <span className="group-label">OPTIONS</span>
        </div>
      </nav>
      <main className="workspace">
        <aside className="sketch-browser" aria-label="Sketch browser">
          <div className="panel-heading">
            <span>Sketch browser</span>
            <PanelLeftClose size={15} />
          </div>
          <div className="tree-root">
            <ChevronDown size={14} />
            <span className="tree-icon">
              <Layers2 size={16} />
            </span>
            <span>Sketch 01</span>
            <span className="tree-count">{doc.entities.length}</span>
          </div>
          <div className="tree-plane">
            <ChevronRight size={13} />
            <Square size={13} />
            <span>XY plane</span>
            <span>mm</span>
          </div>
          <div className="browser-tabs">
            <button
              className={sidebarTab === 'entities' ? 'active' : ''}
              onClick={() => setSidebarTab('entities')}
            >
              Geometry <span>{doc.entities.length}</span>
            </button>
            <button
              className={sidebarTab === 'constraints' ? 'active' : ''}
              onClick={() => setSidebarTab('constraints')}
            >
              Relations <span>{doc.constraints.length}</span>
            </button>
          </div>
          <div className="entity-list">
            {sidebarTab === 'entities'
              ? doc.entities.map((e) => (
                  <button
                    key={e.id}
                    title={`${e.id}${e.construction ? ' (construction)' : ''}. Shift-click to multiselect.`}
                    className={`entity-row ${selection.some((s) => s.entity === e.id) ? 'selected' : ''}`}
                    onClick={(event) =>
                      select(
                        event.shiftKey
                          ? selection.some((s) => s.entity === e.id)
                            ? selection.filter((s) => s.entity !== e.id)
                            : [...selection, { entity: e.id }]
                          : [{ entity: e.id }],
                      )
                    }
                  >
                    <span className={e.construction ? 'construction-icon' : ''}>
                      <EntityIcon entity={e} />
                    </span>
                    <span>
                      {titleOf(e)}
                      <small>
                        {e.type === 'line'
                          ? `${fmt(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y))} mm`
                          : e.type === 'circle'
                            ? `R ${fmt(e.radius)} mm`
                            : `${fmt(e.x)}, ${fmt(e.y)}`}
                      </small>
                    </span>
                    {e.construction ? (
                      <BoxSelect size={12} />
                    ) : result.dof === 0 ? (
                      <LockKeyhole size={12} />
                    ) : (
                      <span className="free-indicator" />
                    )}
                  </button>
                ))
              : doc.constraints.map((c) => (
                  <button
                    key={c.id}
                    className={`entity-row ${constraintId === c.id ? 'selected' : ''}`}
                    onClick={() => inspectConstraint(c.id)}
                  >
                    <ConstraintIcon type={c.type} />
                    <span>
                      {labels[c.type]}
                      <small>{description(c)}</small>
                    </span>
                    <Check size={12} />
                  </button>
                ))}
            {!doc.entities.length && <p className="browser-empty">Your geometry will appear here.</p>}
          </div>
          <div className="browser-footer">
            <div>
              <div className="small-cross">
                <Plus size={16} />
              </div>
              <span>
                A little structure.
                <br />
                <strong>Infinite possibilities.</strong>
              </span>
            </div>
            <button onClick={() => setDialog('examples')}>
              Explore example sketches <ChevronRight size={14} />
            </button>
          </div>
        </aside>
        <SketchCanvas
          ref={canvas}
          store={store}
          document={doc}
          tool={tool}
          construction={construction}
          snapping={snapping}
          selection={selection}
          onSelect={select}
          onChange={refresh}
          onConstraint={inspectConstraint}
          constraintId={constraintId}
          onCoords={(p, step) => {
            setCoords(p);
            setGrid(step);
          }}
        />
        <button
          className="mobile-inspector-toggle"
          aria-label="Toggle inspector"
          onClick={() => setMobileInspector((v) => !v)}
        >
          <PanelRight size={16} />
          Inspector
        </button>
        <aside className={`inspector ${mobileInspector ? 'mobile-open' : ''}`} aria-label="Sketch inspector">
          <div className="panel-heading">
            <span>Inspector</span>
            <Settings2 size={15} />
            <button
              className="mobile-close icon-button"
              aria-label="Close inspector"
              onClick={() => setMobileInspector(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="inspector-scroll">
            <section
              className={`solver-card ${result.dof === 0 ? 'solved' : result.status === 'singular' ? 'uncertain' : 'free'}`}
              aria-label="Solver status"
              data-testid="solver-status"
            >
              <div className="solver-title">
                <span className="solver-status-icon">
                  {result.dof === 0 ? (
                    <Check size={15} />
                  ) : result.status === 'singular' ? (
                    <TriangleAlert size={15} />
                  ) : (
                    <Grip size={15} />
                  )}
                </span>
                <strong>{solverLabel}</strong>
              </div>
              <div className="dof-row">
                <span>
                  <b>{result.dof ?? '?'}</b> degrees of freedom
                </span>
                <span className="solver-tag">{result.status === 'singular' ? 'UNCERTAIN' : 'SOLVED'}</span>
              </div>
              <p>
                {result.status === 'singular'
                  ? 'Singular or time-limited rank. Geometry is valid; mobility is not reliably classified.'
                  : result.dof === 0
                    ? 'Every position is defined by your constraints.'
                    : 'Geometry can move within its constraints.'}
              </p>
              {result.redundant > 0 && (
                <div className="redundancy-note">
                  <Copy size={12} />
                  {result.redundant} redundant equation{result.redundant === 1 ? '' : 's'}, consistent
                </div>
              )}
              <div className="solver-metrics">
                <span>
                  Residual <b>{result.residual < 1e-12 ? '< 1e-12' : result.residual.toExponential(1)} mm</b>
                </span>
                <span title="Actual duration of the most recent solve, including rank analysis">
                  {result.elapsedMs.toFixed(1)} ms
                </span>
              </div>
            </section>
            {selectedConstraint && (
              <section className="inspector-section selected-relation" ref={selectedField}>
                <div className="section-label">
                  SELECTED RELATION
                  <button
                    className="icon-button"
                    aria-label="Deselect constraint"
                    onClick={() => setConstraintId(null)}
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="selected-title">
                  <ConstraintIcon type={selectedConstraint.type} />
                  <strong>{labels[selectedConstraint.type]}</strong>
                  <button
                    className="icon-button danger"
                    aria-label="Delete selected constraint"
                    title="Remove this permanent constraint"
                    onClick={removeSelection}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <code className="identity-label">{selectedConstraint.id}</code>
                <p className="relation-targets">{references(selectedConstraint).join(' + ')}</p>
                {(selectedConstraint.type === 'distance' || selectedConstraint.type === 'radius') && (
                  <NumberField
                    key={selectedConstraint.id}
                    label="Selected dimension value"
                    value={selectedConstraint.value}
                    onCommit={(v) => editDimension(selectedConstraint.id, v)}
                  />
                )}
                {selectedConstraint.type === 'fixed' && (
                  <p className="selection-help">
                    Stored position: {fmt(selectedConstraint.x)}, {fmt(selectedConstraint.y)} mm. Remove this
                    relation to release the point.
                  </p>
                )}
                <span className="relation-state">
                  <Check size={12} />
                  Satisfied in the current document
                </span>
              </section>
            )}
            {selection.length > 0 && (
              <section className="inspector-section selection-section">
                <div className="section-label">
                  SELECTION<span>{selection.length} selected</span>
                </div>
                <div className="selected-title">
                  {single ? <EntityIcon entity={single} size={18} /> : <Layers2 size={18} />}
                  <strong>
                    {single
                      ? `${titleOf(single)}${selection[0]?.point ? ` / ${selection[0].point}` : ''}`
                      : `${selectedEntities.length} entities`}
                  </strong>
                  <button
                    className="icon-button danger"
                    aria-label="Delete selected geometry"
                    title="Delete geometry and all its references (Delete)"
                    onClick={removeSelection}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                {single && <code className="identity-label">{single.id}</code>}
                {selectedPoints.length === 1 &&
                  ['x', 'y'].map((axis) => {
                    const p = targetPosition(doc, selectedPoints[0]);
                    return (
                      <div className="coordinate-field" key={axis}>
                        <label>{axis.toUpperCase()}</label>
                        <NumberField
                          label={`Point ${axis.toUpperCase()}`}
                          value={p[axis as 'x' | 'y']}
                          onCommit={(v) => {
                            store.beginDrag();
                            store.drag([{ target: selectedPoints[0], ...p, [axis]: v }]);
                            store.endDrag();
                            refresh();
                          }}
                        />
                      </div>
                    );
                  })}
                {single?.type === 'circle' && (
                  <div className="coordinate-field">
                    <label>R</label>
                    <NumberField
                      label="Circle geometry radius"
                      value={single.radius}
                      onCommit={(v) => {
                        const c = doc.constraints.find((c) => c.type === 'radius' && c.circle === single.id);
                        if (c) editDimension(c.id, v);
                        else
                          commit((d) => {
                            const e = d.entities.find((e) => e.id === single.id)!;
                            if (e.type === 'circle') e.radius = v;
                          });
                      }}
                    />
                  </div>
                )}
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedEntities.every((e) => e.construction)}
                    onChange={setConstructionFlag}
                  />
                  <span>Construction geometry</span>
                  <kbd>X</kbd>
                </label>
                <p className="selection-help">
                  Shift-click to add to selection. Select endpoint markers for point-to-point constraints.
                </p>
              </section>
            )}
            <section className="inspector-section dimensions-section">
              <div className="section-label">
                DRIVING DIMENSIONS<span className="count-badge">{dimensions.length}</span>
              </div>
              {dimensions.length ? (
                dimensions.map((c, i) =>
                  c.type === 'distance' || c.type === 'radius' ? (
                    <div
                      className={`dimension-card ${constraintId === c.id ? 'highlighted' : ''}`}
                      key={c.id}
                    >
                      <div className="dimension-card-title">
                        <span className="dimension-symbol">
                          <ConstraintIcon type={c.type} size={14} />
                        </span>
                        <button title={`Inspect ${c.id}`} onClick={() => inspectConstraint(c.id)}>
                          {c.id === 'width'
                            ? 'Width'
                            : c.id === 'height'
                              ? 'Height'
                              : c.type === 'radius'
                                ? 'Radius'
                                : `Distance ${i + 1}`}
                        </button>
                        <span className="driving-dot" title="Driving dimension" />
                      </div>
                      <NumberField
                        label={`Dimension ${c.id}`}
                        value={c.value}
                        onCommit={(v) => editDimension(c.id, v)}
                      />
                      <div className="dimension-foot">
                        <span>{c.type === 'radius' ? 'Circle radius' : 'Point-to-point distance'}</span>
                        <span>DRIVING</span>
                      </div>
                    </div>
                  ) : null,
                )
              ) : (
                <div className="empty-dimensions">
                  <Ruler size={22} />
                  <p>
                    Select a line or two points,
                    <br />
                    then add a driving distance.
                  </p>
                  <button onClick={() => addConstraint('distance')}>
                    Add dimension <kbd>D</kbd>
                  </button>
                </div>
              )}
            </section>
            <section className="inspector-section all-constraints">
              <div className="section-label">
                CONSTRAINTS<span className="count-badge">{doc.constraints.length}</span>
              </div>
              <div className="constraint-list">
                {doc.constraints.map((c) => (
                  <div
                    key={c.id}
                    className={`constraint-row ${constraintId === c.id ? 'selected' : ''} ${store.lastError?.conflicts.includes(c.id) ? 'conflict' : ''}`}
                  >
                    <button onClick={() => inspectConstraint(c.id)} title={`${c.id}: ${description(c)}`}>
                      <ConstraintIcon type={c.type} size={14} />
                      <span>{labels[c.type]}</span>
                      {store.lastError?.conflicts.includes(c.id) ? (
                        <TriangleAlert size={12} />
                      ) : (
                        <Check size={12} />
                      )}
                    </button>
                    <button
                      aria-label={`Remove constraint ${c.id}`}
                      title="Remove constraint"
                      onClick={() =>
                        commit((d) => {
                          d.constraints = d.constraints.filter((q) => q.id !== c.id);
                        })
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              {!doc.constraints.length && (
                <p className="selection-help">
                  No permanent constraints. Snapped relations also appear here and can be removed.
                </p>
              )}
            </section>
            <section className="inspector-tip">
              <span>
                <CircleHelp size={15} />
              </span>
              <p>
                <strong>Dimensions drive the design.</strong> Change a value and the solver adjusts all
                connected geometry together.
              </p>
            </section>
          </div>
          <div className="inspector-footer">
            <span className="live-dot" />
            Live constraint solver<span>mm</span>
          </div>
        </aside>
      </main>
      <footer className="statusbar">
        <span className="status-ready">
          <span className="live-dot" />
          {store.lastError ? 'Edit rejected; sketch unchanged' : 'All changes solved'}
        </span>
        <span className="status-separator" />
        <span className="status-tool">
          {tool === 'select' ? 'Select' : tool[0].toUpperCase() + tool.slice(1)}
          <kbd>
            {tool === 'select'
              ? 'V'
              : tool === 'line'
                ? 'L'
                : tool === 'circle'
                  ? 'C'
                  : tool === 'point'
                    ? 'P'
                    : 'Space'}
          </kbd>
        </span>
        <div className="status-right">
          <span className="coordinate-readout">
            X <b>{fmt(coords.x)}</b>
            <span>
              Y <b>{fmt(coords.y)}</b>
            </span>{' '}
            mm
          </span>
          <span className="status-separator" />
          <span>Grid {fmt(grid)} mm</span>
          <span className="status-separator" />
          <button onClick={() => setDialog('help')}>
            <Command size={12} />
            Shortcuts
          </button>
        </div>
      </footer>
      {store.lastError && (
        <div className="error-toast" role="alert">
          <TriangleAlert size={21} />
          <div>
            <strong>
              {store.lastError.status === 'conflicting'
                ? 'Conflicting constraints'
                : store.lastError.status === 'nonconvergent'
                  ? 'Solver did not converge'
                  : 'Operation not applied'}
            </strong>
            <p>{store.lastError.message}</p>
            {store.lastError.conflicts.length > 0 && (
              <span>Relevant constraints: {store.lastError.conflicts.join(', ')}</span>
            )}
            <small>Last valid geometry is preserved. Undo dismisses this rejected operation first.</small>
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => {
              store.clearError();
              refresh();
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {toast && (
        <div className="success-toast" role="status">
          <Check size={16} />
          {toast}
          <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <section
            className={`modal ${dialog === 'examples' ? 'examples-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              dialog === 'examples'
                ? 'Example sketches'
                : dialog === 'import'
                  ? 'Open sketch'
                  : 'Help and shortcuts'
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">DATUM WORKBENCH</span>
                <h2>
                  {dialog === 'examples'
                    ? 'A starting point for your next idea.'
                    : dialog === 'import'
                      ? 'Open an editable sketch.'
                      : 'Precision, at your fingertips.'}
                </h2>
              </div>
              <button className="icon-button" aria-label="Close dialog" onClick={() => setDialog(null)}>
                <X size={20} />
              </button>
            </div>
            {dialog === 'examples' && (
              <>
                <p className="modal-intro">
                  Real geometry. Live constraints. Every example is yours to take apart.
                </p>
                <div className="example-grid">
                  {examples.map((ex, i) => (
                    <button
                      key={ex.id}
                      className="example-card"
                      data-testid={`example-${ex.id}`}
                      onClick={() => {
                        if (replace(ex.create(), ex.name)) setDialog(null);
                      }}
                    >
                      <div className="example-art">
                        <span>0{i + 1}</span>
                        <MiniSketch doc={ex.create()} />
                      </div>
                      <div className="example-info">
                        <h3>
                          {ex.name}
                          <ChevronRight size={16} />
                        </h3>
                        <p>{ex.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="modal-bottom">
                  <span>Opening a sketch is undoable. Your current work stays in history.</span>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      replace(emptyDocument(), 'Untitled sketch');
                      setDialog(null);
                    }}
                  >
                    <Plus size={15} />
                    Start blank
                  </button>
                </div>
              </>
            )}
            {dialog === 'import' && (
              <>
                <p className="modal-intro">
                  Load a version 1 Datum JSON document. References and constraints are validated before your
                  current sketch is replaced.
                </p>
                <input
                  ref={file}
                  type="file"
                  accept=".json,application/json"
                  aria-label="Sketch JSON file"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      if (f.size > 2_000_000) notice('File exceeds the 2 MB document limit.');
                      else importText(await f.text(), f.name.replace(/\.datum\.json$|\.json$/i, ''));
                    }
                    e.target.value = '';
                  }}
                />
                <button className="file-drop" onClick={() => file.current?.click()}>
                  <ArrowUpFromLine size={26} />
                  <strong>Choose a sketch file</strong>
                  <span>.datum.json or .json, up to 2 MB</span>
                </button>
                <div className="or-divider">
                  <span>or paste document JSON</span>
                </div>
                <textarea
                  aria-label="Document JSON"
                  placeholder={'{ "version": 1, "units": "mm", "entities": [...], "constraints": [...] }'}
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                  spellCheck={false}
                />
                <div className="modal-bottom">
                  <span>Everything runs locally in your browser.</span>
                  <button className="primary-button" disabled={!json.trim()} onClick={() => importText(json)}>
                    Validate & open <ChevronRight size={15} />
                  </button>
                </div>
              </>
            )}
            {dialog === 'help' && (
              <>
                <p className="modal-intro">
                  Build geometry, select its targets, then add relations. The solver preserves all permanent
                  constraints during every edit.
                </p>
                <div className="shortcut-grid">
                  {[
                    ['Select', 'V'],
                    ['Line / circle / point', 'L / C / P'],
                    ['Horizontal / distance / radius', 'H / D / R'],
                    ['Fit to sketch', 'F'],
                    ['Construction / snapping', 'X / S'],
                    ['Multiselect', 'Shift + click'],
                    ['Pan', 'Space + drag / middle drag'],
                    ['Cursor-centered zoom', 'Scroll'],
                    ['Undo / redo', 'Ctrl+Z / Ctrl+Shift+Z'],
                    ['Export JSON', 'Ctrl+S'],
                    ['Select all / delete', 'Ctrl+A / Delete'],
                    ['Cancel tool or drag', 'Escape'],
                  ].map(([label, key]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
                <div className="help-note">
                  <Magnet size={18} />
                  <p>
                    <strong>Snapping is explicit.</strong> A point snap adds Coincident. An origin snap adds
                    Fixed. Both are labeled in the preview and removable in the inspector. Drags do not add
                    constraints.
                  </p>
                </div>
                <div className="help-note">
                  <LockKeyhole size={18} />
                  <p>
                    <strong>One document, no hidden locks.</strong> Squares mark defined points, circles mark
                    free targets, dashed lines mark construction. Display values are rounded to 3 decimals;
                    inputs and exports retain full precision.
                  </p>
                </div>
                <div className="modal-bottom">
                  <span>Local-first. No account. No remote computation.</span>
                  <button className="primary-button" onClick={() => setDialog(null)}>
                    Back to sketch
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {dimensionDialog && (
        <div className="modal-backdrop" onClick={() => setDimensionDialog(null)}>
          <form
            className="modal dimension-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Add driving dimension"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const c = dimensionDialog.constraint;
              if (c.type === 'radius' || c.type === 'distance') {
                c.value = dimensionDialog.value.trim() === '' ? NaN : Number(dimensionDialog.value);
                if (commit((d) => d.constraints.push(c))) setDimensionDialog(null);
              }
            }}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">DRIVING DIMENSION</span>
                <h2>
                  {dimensionDialog.constraint.type === 'radius' ? 'Set the radius.' : 'Set the distance.'}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close dimension dialog"
                onClick={() => setDimensionDialog(null)}
              >
                <X size={19} />
              </button>
            </div>
            <p className="modal-intro">
              This value becomes a permanent constraint. Change it any time in the inspector.
            </p>
            <label className="dialog-value-label">
              {dimensionDialog.constraint.type === 'radius' ? 'Radius' : 'Distance'}
              <div className="number-field">
                <input
                  autoFocus
                  aria-label="New dimension value"
                  value={dimensionDialog.value}
                  inputMode="decimal"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setDimensionDialog({ ...dimensionDialog, value: e.target.value })}
                />
                <span>mm</span>
              </div>
            </label>
            <div className="modal-bottom">
              <span>
                {dimensionDialog.constraint.type === 'radius'
                  ? 'Must be strictly positive.'
                  : 'Zero is valid and acts as coincidence.'}
              </span>
              <button type="submit" className="primary-button">
                <Plus size={15} />
                Add constraint
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
