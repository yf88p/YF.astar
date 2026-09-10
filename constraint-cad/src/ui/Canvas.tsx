import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Crosshair, Maximize, Minus, Plus, MousePointer2 } from 'lucide-react';
import {
  keyOf,
  references,
  targetPosition,
  targets,
  uid,
  type Constraint,
  type Document,
  type Entity,
  type Target,
  type Vec,
} from '../core/model';
import type { SketchStore } from '../core/store';

export type Tool = 'select' | 'line' | 'circle' | 'point' | 'pan';
export type Selection = { entity: string; point?: Target['point'] };
export type View = { x: number; y: number; scale: number; width: number; height: number };
export type CanvasHandle = { fit: () => void; getView: () => View };
type Snap = Vec & { target?: Target; origin?: boolean };
type Props = {
  store: SketchStore;
  document: Document;
  tool: Tool;
  construction: boolean;
  snapping: boolean;
  selection: Selection[];
  onSelect: (s: Selection[]) => void;
  onChange: () => void;
  onConstraint: (id: string) => void;
  constraintId: string | null;
  onCoords: (p: Vec, grid: number) => void;
};
const selectionKey = (s: Selection) => `${s.entity}/${s.point ?? 'body'}`;
export const fmt = (n: number) => Number(n.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
const distanceSegment = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

export const SketchCanvas = forwardRef<CanvasHandle, Props>(function SketchCanvas(
  {
    store,
    document: doc,
    tool,
    construction,
    snapping,
    selection,
    onSelect,
    onChange,
    onConstraint,
    constraintId,
    onCoords,
  },
  ref,
) {
  const svg = useRef<SVGSVGElement>(null),
    wrapper = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 170, y: 400, scale: 5, width: 800, height: 650 });
  const [cursor, setCursor] = useState<Snap | null>(null),
    [start, setStart] = useState<Snap | null>(null);
  const [marquee, setMarquee] = useState<{ a: Vec; b: Vec } | null>(null);
  const gesture = useRef<{
    type: 'pan' | 'drag' | 'marquee';
    start: Vec;
    view: View;
    targets?: { target: Target; x: number; y: number }[];
    moved: boolean;
    additive?: boolean;
  } | null>(null);
  const pending = useRef<{ target: Target; x: number; y: number }[] | null>(null),
    frame = useRef(0),
    space = useRef(false);
  const screen = (p: Vec): Vec => ({ x: view.x + p.x * view.scale, y: view.y - p.y * view.scale });
  const world = (p: Vec): Vec => ({ x: (p.x - view.x) / view.scale, y: (view.y - p.y) / view.scale });
  const local = (e: { clientX: number; clientY: number }): Vec => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const rawStep = 50 / view.scale,
    power = 10 ** Math.floor(Math.log10(rawStep)),
    ratio = rawStep / power;
  const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power;
  function fit() {
    const w = wrapper.current?.clientWidth ?? 800,
      h = wrapper.current?.clientHeight ?? 600;
    const points = doc.entities.flatMap((e) =>
      e.type === 'circle'
        ? [
            { x: e.center.x - e.radius, y: e.center.y - e.radius },
            { x: e.center.x + e.radius, y: e.center.y + e.radius },
          ]
        : targets(e).map((t) => targetPosition(doc, t)),
    );
    if (!points.length) {
      setView({ width: w, height: h, x: w * 0.35, y: h * 0.65, scale: 4 });
      return;
    }
    const minX = Math.min(...points.map((p) => p.x)),
      maxX = Math.max(...points.map((p) => p.x)),
      minY = Math.min(...points.map((p) => p.y)),
      maxY = Math.max(...points.map((p) => p.y));
    const scale = Math.max(
      0.02,
      Math.min(10, (w - 180) / Math.max(20, maxX - minX), (h - 200) / Math.max(20, maxY - minY)),
    );
    setView({
      width: w,
      height: h,
      scale,
      x: w / 2 - ((minX + maxX) * scale) / 2,
      y: h / 2 + ((minY + maxY) * scale) / 2 + 8,
    });
  }
  useImperativeHandle(ref, () => ({ fit, getView: () => view }));
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setView((v) => ({
        ...v,
        x: v.x + (width - v.width) / 2,
        y: v.y + (height - v.height) / 2,
        width,
        height,
      }));
    });
    if (wrapper.current) ro.observe(wrapper.current);
    fit();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);
  useEffect(() => {
    setStart(null);
    setCursor(null);
  }, [tool]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea,select')) return;
      if (e.code === 'Space') {
        space.current = true;
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        setStart(null);
        setMarquee(null);
        pending.current = null;
        if (gesture.current?.type === 'drag') {
          store.cancelDrag();
          onChange();
        }
        gesture.current = null;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [store, onChange]);
  useEffect(() => {
    const el = svg.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect(),
        p = { x: e.clientX - box.left, y: e.clientY - box.top };
      setView((v) => {
        const scale = Math.max(0.005, Math.min(2000, v.scale * Math.exp(-e.deltaY * 0.0015))),
          f = scale / v.scale;
        return { ...v, scale, x: p.x + (v.x - p.x) * f, y: p.y + (v.y - p.y) * f };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  function snap(p: Vec): Snap {
    const w = world(p);
    if (!snapping) return w;
    let best: Snap | null = null,
      dist = 11;
    for (const e of doc.entities)
      for (const t of targets(e)) {
        const q = targetPosition(doc, t),
          sp = screen(q),
          d = Math.hypot(sp.x - p.x, sp.y - p.y);
        if (d < dist) {
          best = { ...q, target: t };
          dist = d;
        }
      }
    if (best) return best;
    if (Math.hypot(view.x - p.x, view.y - p.y) < 10) return { x: 0, y: 0, origin: true };
    return w;
  }
  function hit(p: Vec): Selection | null {
    let best: Selection | null = null,
      dist = 8;
    for (const e of [...doc.entities].reverse())
      for (const t of targets(e)) {
        const q = screen(targetPosition(doc, t)),
          d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < dist) {
          best = { ...t };
          dist = d;
        }
      }
    if (best) return best;
    for (const e of [...doc.entities].reverse()) {
      const d =
        e.type === 'line'
          ? distanceSegment(p, screen(e.a), screen(e.b))
          : e.type === 'circle'
            ? Math.abs(Math.hypot(p.x - screen(e.center).x, p.y - screen(e.center).y) - e.radius * view.scale)
            : Infinity;
      if (d < 7) return { entity: e.id };
    }
    return null;
  }
  function addSnap(d: Document, s: Snap, target: Target) {
    if (s.target) d.constraints.push({ id: uid('c'), type: 'coincident', a: target, b: s.target });
    // Origin snapping is a visible Fixed constraint, never an implicit lock.
    else if (s.origin) d.constraints.push({ id: uid('c'), type: 'fixed', target, x: 0, y: 0 });
  }
  function create(p: Snap) {
    const id = uid();
    if (tool === 'point') {
      if (
        store.transact((d) => {
          d.entities.push({ id, type: 'point', x: p.x, y: p.y, construction });
          addSnap(d, p, { entity: id, point: 'point' });
        })
      )
        onSelect([{ entity: id }]);
    } else if (!start) {
      setStart(p);
      return;
    } else {
      if (Math.hypot(p.x - start.x, p.y - start.y) < 1e-8) return;
      const a = { x: start.x, y: start.y },
        b = { x: p.x, y: p.y };
      const ok = store.transact((d) => {
        if (tool === 'line') {
          d.entities.push({ id, type: 'line', a, b, construction });
          addSnap(d, start, { entity: id, point: 'a' });
          addSnap(d, p, { entity: id, point: 'b' });
        } else {
          d.entities.push({
            id,
            type: 'circle',
            center: a,
            radius: Math.hypot(b.x - a.x, b.y - a.y),
            construction,
          });
          addSnap(d, start, { entity: id, point: 'center' });
        }
      });
      if (ok) {
        onSelect([{ entity: id }]);
        setStart(null);
      }
    }
    onChange();
  }
  function pointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button === 2) return;
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    if (e.button === 1 || tool === 'pan' || space.current) {
      gesture.current = { type: 'pan', start: p, view, moved: false };
      return;
    }
    if (tool !== 'select') {
      create(snap(p));
      return;
    }
    const picked = hit(p);
    if (picked) {
      let next = selection;
      if (e.shiftKey) {
        const exists = selection.some((s) => selectionKey(s) === selectionKey(picked));
        next = exists
          ? selection.filter((s) => selectionKey(s) !== selectionKey(picked))
          : [...selection, picked];
        onSelect(next);
        return;
      }
      if (!selection.some((s) => selectionKey(s) === selectionKey(picked))) {
        next = [picked];
        onSelect(next);
      }
      const ts = new Map<string, Target>();
      for (const s of next) {
        const entity = doc.entities.find((e) => e.id === s.entity)!;
        for (const t of s.point ? [s as Target] : targets(entity)) ts.set(keyOf(t), t);
      }
      gesture.current = {
        type: 'drag',
        start: p,
        view,
        moved: false,
        targets: [...ts.values()].map((t) => ({ target: t, ...targetPosition(doc, t) })),
      };
    } else {
      if (!e.shiftKey) onSelect([]);
      gesture.current = { type: 'marquee', start: p, view, moved: false, additive: e.shiftKey };
    }
  }
  function flushDrag() {
    if (pending.current) {
      const p = pending.current;
      pending.current = null;
      store.drag(p);
      onChange();
    }
    frame.current = 0;
  }
  function pointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const p = local(e),
      w = world(p),
      g = gesture.current;
    onCoords(w, step);
    if (!g) {
      setCursor(snap(p));
      return;
    }
    const dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) < 3) return;
    if (!g.moved && g.type === 'drag') store.beginDrag();
    g.moved = true;
    if (g.type === 'pan') setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    if (g.type === 'marquee') setMarquee({ a: g.start, b: p });
    if (g.type === 'drag') {
      pending.current = g.targets!.map((t) => ({
        target: t.target,
        x: t.x + dx / g.view.scale,
        y: t.y - dy / g.view.scale,
      }));
      if (!frame.current) frame.current = requestAnimationFrame(flushDrag);
    }
  }
  function pointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (g?.type === 'drag' && g.moved) {
      cancelAnimationFrame(frame.current);
      flushDrag();
      store.endDrag();
      onChange();
    }
    if (g?.type === 'marquee' && g.moved) {
      const p = local(e),
        minX = Math.min(g.start.x, p.x),
        maxX = Math.max(g.start.x, p.x),
        minY = Math.min(g.start.y, p.y),
        maxY = Math.max(g.start.y, p.y);
      const picked = doc.entities
        .filter((e) =>
          targets(e).some((t) => {
            const p = screen(targetPosition(doc, t));
            return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
          }),
        )
        .map((e) => ({ entity: e.id }));
      onSelect(
        g.additive
          ? [...selection, ...picked.filter((s) => !selection.some((q) => q.entity === s.entity))]
          : picked,
      );
    }
    gesture.current = null;
    setMarquee(null);
  }
  function zoom(f: number) {
    setView((v) => {
      const scale = Math.max(0.005, Math.min(2000, v.scale * f)),
        ratio = scale / v.scale;
      return {
        ...v,
        scale,
        x: v.width / 2 + (v.x - v.width / 2) * ratio,
        y: v.height / 2 + (v.y - v.height / 2) * ratio,
      };
    });
  }
  const isSelected = (id: string) => selection.some((s) => s.entity === id);
  const conflicted = new Set(
    doc.constraints.filter((c) => store.lastError?.conflicts.includes(c.id)).flatMap(references),
  );
  const constrained = store.result.dof === 0;
  const immovable = new Set(store.result.immovableTargets);
  function constraint(c: Constraint, index: number) {
    if (c.type === 'distance' || c.type === 'radius') {
      let a: Vec, b: Vec;
      if (c.type === 'distance') {
        a = screen(targetPosition(doc, c.a));
        b = screen(targetPosition(doc, c.b));
      } else {
        const e = doc.entities.find((e) => e.id === c.circle)! as Extract<Entity, { type: 'circle' }>;
        a = screen(e.center);
        b = screen({ x: e.center.x + e.radius * 0.70710678, y: e.center.y + e.radius * 0.70710678 });
      }
      const len = Math.hypot(b.x - a.x, b.y - a.y),
        nx = len ? -(b.y - a.y) / len : 0,
        ny = len ? (b.x - a.x) / len : 1;
      const offset =
        c.type === 'radius'
          ? 0
          : 30 +
            (doc.constraints
              .slice(0, index)
              .some(
                (o) =>
                  o.type === 'distance' &&
                  c.type === 'distance' &&
                  keyOf(o.a) === keyOf(c.a) &&
                  keyOf(o.b) === keyOf(c.b),
              )
              ? 25
              : 0);
      const aa = { x: a.x + nx * offset, y: a.y + ny * offset },
        bb = { x: b.x + nx * offset, y: b.y + ny * offset },
        mid = { x: (aa.x + bb.x) / 2, y: (aa.y + bb.y) / 2 };
      const label = `${c.type === 'radius' ? 'R ' : ''}${fmt(c.value)}`,
        width = Math.max(44, label.length * 7.5 + 14);
      return (
        <g
          key={c.id}
          className={`dimension ${constraintId === c.id ? 'active' : ''}`}
          data-constraint={c.id}
          role="button"
          tabIndex={0}
          aria-label={`Edit ${c.type} ${c.id}: ${c.value} mm`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onConstraint(c.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConstraint(c.id);
          }}
        >
          <title>
            Driving {c.type}: {c.value} mm. Click to edit.
          </title>
          <path
            className="extension"
            d={`M ${a.x + nx * 8} ${a.y + ny * 8} L ${aa.x + nx * 7} ${aa.y + ny * 7} M ${b.x + nx * 8} ${b.y + ny * 8} L ${bb.x + nx * 7} ${bb.y + ny * 7}`}
          />
          <path
            d={`M ${aa.x} ${aa.y} L ${bb.x} ${bb.y}`}
            markerStart="url(#arrow-start)"
            markerEnd="url(#arrow-end)"
          />
          <rect x={mid.x - width / 2} y={mid.y - 11} width={width} height={22} rx={5} />
          <text x={mid.x} y={mid.y + 4} textAnchor="middle">
            {label}
          </text>
        </g>
      );
    }
    let p: Vec, label: string;
    if (c.type === 'fixed') {
      p = screen(targetPosition(doc, c.target));
      p = { x: p.x - 17, y: p.y + 16 };
      label = 'F';
    } else if (c.type === 'coincident') {
      p = screen(targetPosition(doc, c.a));
      p = { x: p.x + 13, y: p.y - 13 };
      label = '=';
    } else {
      const id = 'line' in c ? c.line : c.a;
      const e = doc.entities.find((e) => e.id === id)! as Extract<Entity, { type: 'line' }>;
      p = screen({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
      p = { x: p.x + (c.type === 'vertical' ? -17 : 0), y: p.y + (c.type === 'vertical' ? 0 : -17) };
      label =
        c.type === 'horizontal' ? 'H' : c.type === 'vertical' ? 'V' : c.type === 'parallel' ? '//' : 'T';
    }
    return (
      <g
        key={c.id}
        className={`constraint-glyph ${constraintId === c.id ? 'active' : ''} ${store.lastError?.conflicts.includes(c.id) ? 'conflict' : ''}`}
        data-constraint={c.id}
        role="button"
        tabIndex={0}
        aria-label={`${c.type} constraint ${c.id}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onConstraint(c.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConstraint(c.id);
        }}
      >
        <title>
          {c.type} ({c.id}). Click to inspect or remove.
        </title>
        <rect x={p.x - 8} y={p.y - 8} width={16} height={16} rx={3} />
        <text x={p.x} y={p.y + 3.5} textAnchor="middle">
          {label}
        </text>
      </g>
    );
  }
  const origin = screen({ x: 0, y: 0 });
  const ticksX: number[] = [],
    ticksY: number[] = [];
  for (
    let x = Math.ceil(-view.x / (step * view.scale)) * step;
    screen({ x, y: 0 }).x < view.width;
    x += step
  ) {
    if (ticksX.length > 100) break;
    ticksX.push(x);
  }
  for (
    let y = Math.ceil((view.y - view.height) / (step * view.scale)) * step;
    screen({ x: 0, y }).y > 0;
    y += step
  ) {
    if (ticksY.length > 100) break;
    ticksY.push(y);
  }
  return (
    <div ref={wrapper} className={`canvas-wrap tool-${tool}`}>
      <div className="canvas-heading">
        <span className="plane-mark">XY</span>
        <span>Sketch plane</span>
        <span className="canvas-heading-divider" /> <span className="subtle">Top view</span>
      </div>
      <div className="canvas-hint">
        <MousePointer2 size={13} />
        {tool === 'select'
          ? 'Drag geometry to explore its freedom'
          : tool === 'pan'
            ? 'Drag to pan the sketch plane'
            : start
              ? tool === 'line'
                ? 'Click to place the endpoint'
                : 'Click to set the radius'
              : `Click to place ${tool === 'circle' ? 'the center' : tool === 'line' ? 'the first endpoint' : 'a point'}`}
      </div>
      <svg
        ref={svg}
        className="sketch-canvas"
        data-testid="sketch-canvas"
        aria-label="Interactive XY sketch canvas"
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => {
          pending.current = null;
          store.cancelDrag();
          gesture.current = null;
          setMarquee(null);
          onChange();
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerLeave={() => {
          if (!gesture.current) setCursor(null);
        }}
      >
        <defs>
          <pattern
            id="minor-grid"
            width={(step * view.scale) / 5}
            height={(step * view.scale) / 5}
            patternUnits="userSpaceOnUse"
            x={view.x}
            y={view.y}
          >
            <circle cx={0} cy={0} r={0.65} fill="#d8dcd9" />
          </pattern>
          <pattern
            id="major-grid"
            width={step * view.scale}
            height={step * view.scale}
            patternUnits="userSpaceOnUse"
            x={view.x}
            y={view.y}
          >
            <rect width={step * view.scale} height={step * view.scale} fill="url(#minor-grid)" />
            <path
              d={`M ${step * view.scale} 0 H 0 V ${step * view.scale}`}
              fill="none"
              stroke="#e7e9e6"
              strokeWidth={0.7}
            />
          </pattern>
          <marker
            id="arrow-end"
            viewBox="0 0 8 8"
            refX={7}
            refY={4}
            markerWidth={7}
            markerHeight={7}
            orient="auto"
          >
            <path d="M 0 1 L 7 4 L 0 7" fill="none" stroke="currentColor" strokeWidth={1.1} />
          </marker>
          <marker
            id="arrow-start"
            viewBox="0 0 8 8"
            refX={1}
            refY={4}
            markerWidth={7}
            markerHeight={7}
            orient="auto"
          >
            <path d="M 8 1 L 1 4 L 8 7" fill="none" stroke="currentColor" strokeWidth={1.1} />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#major-grid)" />
        <path d={`M 0 ${view.y} H ${view.width}`} className="axis axis-x" />
        <path d={`M ${view.x} 0 V ${view.height}`} className="axis axis-y" />
        {ticksX.map((x) => (
          <text
            key={`x${x}`}
            x={screen({ x, y: 0 }).x + 4}
            y={Math.min(view.height - 12, Math.max(22, view.y + 17))}
            className="grid-label"
          >
            {fmt(x)}
          </text>
        ))}
        {ticksY
          .filter((y) => y !== 0)
          .map((y) => (
            <text
              key={`y${y}`}
              x={Math.min(view.width - 35, Math.max(8, view.x + 7))}
              y={screen({ x: 0, y }).y - 5}
              className="grid-label"
            >
              {fmt(y)}
            </text>
          ))}
        <circle cx={origin.x} cy={origin.y} r={5} className="origin-circle" />
        <path
          d={`M ${origin.x - 9} ${origin.y} H ${origin.x + 9} M ${origin.x} ${origin.y - 9} V ${origin.y + 9}`}
          className="origin-cross"
        />
        {doc.entities.map((e) => {
          const selected = isSelected(e.id),
            conflict = conflicted.has(e.id);
          const defined =
            constrained ||
            (targets(e).every((t) => immovable.has(keyOf(t))) &&
              (e.type !== 'circle' || doc.constraints.some((c) => c.type === 'radius' && c.circle === e.id)));
          const classes = `entity ${e.construction ? 'construction' : ''} ${selected ? 'selected' : ''} ${conflict ? 'conflict' : ''} ${defined ? 'constrained' : ''}`;
          return (
            <g key={e.id} className={classes} data-entity={e.id}>
              {e.type === 'line' && (
                <>
                  <line
                    className="selection-halo"
                    x1={screen(e.a).x}
                    y1={screen(e.a).y}
                    x2={screen(e.b).x}
                    y2={screen(e.b).y}
                  />
                  <line
                    className="geometry"
                    x1={screen(e.a).x}
                    y1={screen(e.a).y}
                    x2={screen(e.b).x}
                    y2={screen(e.b).y}
                  />
                </>
              )}
              {e.type === 'circle' && (
                <>
                  <circle
                    className="selection-halo"
                    cx={screen(e.center).x}
                    cy={screen(e.center).y}
                    r={e.radius * view.scale}
                  />
                  <circle
                    className="geometry"
                    cx={screen(e.center).x}
                    cy={screen(e.center).y}
                    r={e.radius * view.scale}
                  />
                  <path
                    className="center-cross"
                    d={`M ${screen(e.center).x - 8} ${screen(e.center).y} h 16 M ${screen(e.center).x} ${screen(e.center).y - 8} v 16`}
                  />
                </>
              )}
              {targets(e).map((t) => {
                const p = screen(targetPosition(doc, t)),
                  fixed =
                    immovable.has(keyOf(t)) ||
                    doc.constraints.some((c) => c.type === 'fixed' && keyOf(c.target) === keyOf(t)),
                  picked = selection.some((s) => s.point && keyOf(s as Target) === keyOf(t));
                return (
                  <g key={t.point} data-target={keyOf(t)} className={`target ${picked ? 'picked' : ''}`}>
                    <title>
                      {e.id} / {t.point}
                      {fixed ? ' (fixed)' : ''}
                    </title>
                    {picked && <circle cx={p.x} cy={p.y} r={9} className="target-ring" />}
                    {fixed || constrained ? (
                      <rect className="endpoint fixed-point" x={p.x - 3} y={p.y - 3} width={6} height={6} />
                    ) : (
                      <circle className="endpoint" cx={p.x} cy={p.y} r={e.type === 'point' ? 4 : 3.5} />
                    )}
                  </g>
                );
              })}
              {conflict && (
                <text
                  className="conflict-label"
                  x={screen(targetPosition(doc, targets(e)[0])).x - 23}
                  y={screen(targetPosition(doc, targets(e)[0])).y - 10}
                >
                  !
                </text>
              )}
            </g>
          );
        })}
        {doc.constraints.map(constraint)}
        {start && cursor && (
          <g className="preview">
            {tool === 'line' ? (
              <line x1={screen(start).x} y1={screen(start).y} x2={screen(cursor).x} y2={screen(cursor).y} />
            ) : (
              <circle
                cx={screen(start).x}
                cy={screen(start).y}
                r={Math.hypot(cursor.x - start.x, cursor.y - start.y) * view.scale}
              />
            )}
            <circle cx={screen(start).x} cy={screen(start).y} r={4} />
            <text x={screen(cursor).x + 16} y={screen(cursor).y - 17}>
              {tool === 'circle' ? 'R ' : ''}
              {fmt(Math.hypot(cursor.x - start.x, cursor.y - start.y))} mm
            </text>
          </g>
        )}
        {cursor && tool !== 'pan' && tool !== 'select' && (
          <g className="cursor-cross">
            <path
              d={`M ${screen(cursor).x - 10} ${screen(cursor).y} h 20 M ${screen(cursor).x} ${screen(cursor).y - 10} v 20`}
            />
            {(cursor.target || cursor.origin) && (
              <>
                <rect x={screen(cursor).x - 7} y={screen(cursor).y - 7} width={14} height={14} />
                <rect
                  className="snap-label-bg"
                  x={screen(cursor).x + 15}
                  y={screen(cursor).y + 13}
                  width={cursor.origin ? 140 : 162}
                  height={23}
                  rx={4}
                />
                <text x={screen(cursor).x + 22} y={screen(cursor).y + 28}>
                  {cursor.origin ? 'Origin snap + Fixed' : 'Point snap + Coincident'}
                </text>
              </>
            )}
          </g>
        )}
        {marquee && (
          <rect
            className="marquee"
            x={Math.min(marquee.a.x, marquee.b.x)}
            y={Math.min(marquee.a.y, marquee.b.y)}
            width={Math.abs(marquee.b.x - marquee.a.x)}
            height={Math.abs(marquee.b.y - marquee.a.y)}
          />
        )}
      </svg>
      {!doc.entities.length && (
        <div className="empty-canvas">
          <div className="empty-icon">
            <Crosshair size={28} />
          </div>
          <h2>Every idea starts with a line.</h2>
          <p>
            Choose a tool above and click on the sketch plane.
            <br />
            Add constraints to turn geometry into a design.
          </p>
          <span>
            Press <kbd>L</kbd> to draw your first line
          </span>
        </div>
      )}
      <div className="canvas-legend">
        <span>
          <i className="legend-free" />
          Free
        </span>
        <span>
          <i className="legend-fixed" />
          Defined
        </span>
        <span>
          <i className="legend-construction" />
          Construction
        </span>
      </div>
      <div className="view-controls">
        <button aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1 / 1.25)}>
          <Minus size={15} />
        </button>
        <span>{fmt(view.scale * 25)}%</span>
        <button aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.25)}>
          <Plus size={15} />
        </button>
        <i />
        <button aria-label="Fit sketch" title="Fit sketch (F)" onClick={fit}>
          <Maximize size={15} />
        </button>
      </div>
      <div className="orientation">
        <span>Y</span>
        <svg width="44" height="44">
          <path d="M 12 33 V 5 M 12 33 H 40" fill="none" stroke="#9aa69e" />
          <path d="M 9 9 L 12 4 L 15 9 M 35 30 L 41 33 L 35 36" fill="none" stroke="#9aa69e" />
          <circle cx="12" cy="33" r="2.5" fill="#8d9991" />
        </svg>
        <b>X</b>
      </div>
    </div>
  );
});
