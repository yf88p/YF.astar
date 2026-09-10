import { useEffect, useRef, useState } from "react";
import { Focus, Minus, Plus } from "lucide-react";
import { CATALOG } from "./catalog";
import {
  addWall,
  checked,
  clone,
  detectRooms,
  distance,
  furnitureSize,
  openingPose,
  projectPoint,
  uid,
  wallLength,
  wallPoints,
  type Design,
  type Vec2,
  type Warning,
} from "./model";

export type Tool =
  "select" | "wall" | "door" | "window" | "furniture" | "light" | "pan";
type Props = {
  design: Design;
  selectedIds: string[];
  onSelect: (id: string, add?: boolean) => void;
  onChange: (d: Design, commit?: boolean) => void;
  onError: (message: string) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  placeId: string;
  warnings: Warning[];
  fitKey: number;
};
export function ItemGlyph({
  id,
  color = "#b89c75",
}: {
  id: string;
  color?: string;
}) {
  const common = { fill: color, stroke: "#6d715e", strokeWidth: 1.5 };
  return (
    <svg
      viewBox="0 0 100 74"
      aria-hidden="true"
      className={`item-glyph glyph-${id}`}
    >
      <ellipse cx="51" cy="61" rx="29" ry="5" fill="#373e2b" opacity=".07" />
      {id === "bistro" ? (
        <>
          <path
            d="M49 31v27m-14 5 15-7 15 7"
            fill="none"
            stroke="#575b4b"
            strokeWidth="3"
          />
          <ellipse cx="50" cy="29" rx="29" ry="12" {...common} />
          <ellipse
            cx="50"
            cy="27"
            rx="29"
            ry="11"
            fill="#c3a57e"
            stroke="#8b785c"
          />
        </>
      ) : ["chair", "lounge", "banquette"].includes(id) ? (
        <>
          <path
            d="m29 43-3 20m42-20 4 20M39 36v21m20-21v21"
            stroke="#7d674b"
            strokeWidth="3"
          />
          <path d="M29 39V19q22-10 40 0v21l-8 7H37Z" {...common} />
          <path d="m29 40 16-7 25 6-17 12Z" fill="#ccb794" stroke="#8c785c" />
          <path d="M29 19v17m40-17v17" stroke="#f8f4e9" opacity=".6" />
        </>
      ) : id === "plant" ? (
        <>
          <path d="m38 46 5 17h17l5-17" fill="#bc8668" />
          <ellipse cx="51" cy="46" rx="14" ry="4" fill="#9c7359" />
          <path d="M51 48V14" stroke="#77825b" strokeWidth="2" />
          {[
            [-11, 13, 25],
            [10, 22, -30],
            [-12, 30, 35],
            [13, 9, -40],
            [0, 0, 5],
          ].map(([x, y, r], i) => (
            <ellipse
              key={i}
              cx={51 + x}
              cy={14 + y}
              rx="11"
              ry="5"
              fill={i % 2 ? "#8c9a72" : "#6f825a"}
              transform={`rotate(${r} ${51 + x} ${14 + y})`}
            />
          ))}
        </>
      ) : id === "lamp" ? (
        <>
          <ellipse cx="50" cy="61" rx="13" ry="4" fill="#a79a79" />
          <path d="M50 23v38" stroke="#a79a79" strokeWidth="3" />
          <circle cx="50" cy="21" r="13" fill="#eee8cf" stroke="#bfb59a" />
        </>
      ) : id === "rack" ? (
        <>
          <path
            d="M25 61V14h50v47M22 61h9m39 0h10"
            stroke="#656e5c"
            strokeWidth="3"
            fill="none"
          />
          {[33, 43, 53, 63].map((x, i) => (
            <path
              key={x}
              d={`m${x} 19 -6 8 3 4v19h12V30l3-3-7-8Z`}
              fill={["#c5ba9f", "#8c967e", "#b7a287", "#e0d7c4"][i]}
              stroke="#6f755f"
              strokeWidth=".6"
            />
          ))}
        </>
      ) : id === "shelf" || id === "partition" ? (
        <>
          <path
            d="M23 61V12h54v49"
            fill="none"
            stroke="#857354"
            strokeWidth="3"
          />
          {(id === "shelf" ? [22, 35, 48, 61] : [31, 41, 51, 61, 71]).map(
            (n) =>
              id === "shelf" ? (
                <path
                  key={n}
                  d={`M23 ${n}h54`}
                  stroke="#b49870"
                  strokeWidth="4"
                />
              ) : (
                <path
                  key={n}
                  d={`M${n} 12v49`}
                  stroke="#b49870"
                  strokeWidth="5"
                />
              ),
          )}
          {id === "shelf" && (
            <>
              <path
                d="M30 20v-6m5 6v-7m5 7v-6M57 33v-6m6 6v-8M38 46v-7m8 7v-5"
                stroke="#7c896b"
                strokeWidth="5"
              />
            </>
          )}
        </>
      ) : id === "rug" ? (
        <path
          d="m14 45 42-21 32 18-42 22Z"
          fill="#cbbb9d"
          stroke="#a99474"
          strokeWidth="2"
        />
      ) : id === "stool" ? (
        <>
          <path
            d="m37 27-5 35m30-35 6 35M34 49h32"
            stroke="#626951"
            strokeWidth="3"
          />
          <ellipse cx="50" cy="26" rx="19" ry="8" {...common} />
        </>
      ) : (
        <>
          <path d="m21 30 37-15 24 12v29L45 67 21 52Z" {...common} />
          <path d="m21 30 24 12 37-15M45 42v25" stroke="#766d59" fill="none" />
          {["counter", "communal", "bench"].includes(id) && (
            <path
              d="m21 29 37-15 25 11-38 16Z"
              fill="#ded6bf"
              stroke="#a5987d"
            />
          )}
          {id === "counter" &&
            [27, 32, 37, 42].map((x) => (
              <path
                key={x}
                d={`M${x} ${34 + (x - 27) * 0.5}v18`}
                stroke="#dfc09a"
              />
            ))}
        </>
      )}
    </svg>
  );
}

export default function Plan(p: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: -1.5, y: -1.5, w: 13, h: 11 });
  const [cursor, setCursor] = useState<Vec2 | null>(null),
    [start, setStart] = useState<Vec2 | null>(null),
    [snapLabel, setSnapLabel] = useState("");
  const drag = useRef<{
    type: "entity" | "vertex" | "pan";
    id: string;
    point: Vec2;
    client: Vec2;
    base: Design;
    view: typeof view;
    ids: string[];
    moved: boolean;
    last: Design;
    error?: string;
  } | null>(null);
  function fit() {
    const vs = p.design.vertices,
      el = svg.current;
    if (!el) return;
    const minX = vs.length ? Math.min(...vs.map((v) => v.x)) : 0,
      maxX = vs.length ? Math.max(...vs.map((v) => v.x)) : 10,
      minY = vs.length ? Math.min(...vs.map((v) => v.y)) : 0,
      maxY = vs.length ? Math.max(...vs.map((v) => v.y)) : 8;
    const ratio = el.clientWidth / Math.max(1, el.clientHeight),
      w = Math.max(maxX - minX + 2.6, (maxY - minY + 2.6) * ratio),
      h = w / ratio;
    setView({ x: (minX + maxX - w) / 2, y: (minY + maxY - h) / 2, w, h });
  }
  useEffect(() => {
    fit();
  }, [p.fitKey, p.design.id]);
  useEffect(() => {
    const observer = new ResizeObserver(fit);
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, [p.design.id]);
  useEffect(() => {
    setStart(null);
  }, [p.tool]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStart(null);
        p.setTool("select");
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [p.setTool]);
  const coordinate = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return {
      x: view.x + ((e.clientX - r.left) / r.width) * view.w,
      y: view.y + ((e.clientY - r.top) / r.height) * view.h,
    };
  };
  function snap(point: Vec2) {
    const threshold = view.w * 0.018;
    const v = p.design.vertices.find((v) => distance(v, point) < threshold);
    if (v) {
      setSnapLabel("Endpoint");
      return { x: v.x, y: v.y };
    }
    for (const w of p.design.walls) {
      const q = projectPoint(point, ...wallPoints(p.design, w));
      if (distance(point, q) < threshold * 0.6) {
        setSnapLabel("Wall junction");
        return { x: q.x, y: q.y };
      }
    }
    let s = {
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10,
    };
    setSnapLabel("100 mm grid");
    if (start) {
      const angle = Math.atan2(s.y - start.y, s.x - start.x),
        target = (Math.round(angle / (Math.PI / 4)) * Math.PI) / 4;
      if (Math.abs(angle - target) < 0.08) {
        const l = distance(start, s);
        s = {
          x: start.x + Math.cos(target) * l,
          y: start.y + Math.sin(target) * l,
        };
        setSnapLabel(`${Math.round((target * 180) / Math.PI)}° angle`);
      }
    }
    return s;
  }
  const apply = (d: Design, commit = true) => {
    try {
      p.onChange(checked(d), commit);
      return true;
    } catch (e) {
      if (commit) p.onError((e as Error).message);
      return false;
    }
  };
  function down(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.button !== 1) return;
    const point = coordinate(e),
      target = e.target as SVGElement,
      id = target.closest("[data-entity]")?.getAttribute("data-entity") || "",
      vertex = target.getAttribute("data-vertex");
    if (p.tool === "pan" || e.button === 1 || e.altKey) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        type: "pan",
        id: "",
        point,
        client: { x: e.clientX, y: e.clientY },
        base: p.design,
        view,
        ids: [],
        moved: false,
        last: p.design,
      };
      return;
    }
    if (p.tool === "wall") {
      const q = snap(point);
      if (!start) setStart(q);
      else {
        try {
          const d = addWall(p.design, start, q);
          p.onChange(d, true);
          setStart(q);
        } catch (err) {
          p.onError((err as Error).message);
        }
      }
      return;
    }
    if (p.tool === "furniture") {
      const d = clone(p.design),
        q = snap(point),
        f = { id: uid("f"), catalogId: p.placeId, x: q.x, y: q.y, rotation: 0 };
      d.furniture.push(f);
      if (apply(d)) {
        p.onSelect(f.id);
        p.setTool("select");
      }
      return;
    }
    if (p.tool === "light") {
      const d = clone(p.design),
        q = snap(point),
        l = {
          id: uid("light"),
          x: q.x,
          y: q.y,
          height: 2.6,
          intensity: 40,
          color: "#ffe4b8",
        };
      d.lights.push(l);
      if (apply(d)) {
        p.onSelect(l.id);
        p.setTool("select");
      }
      return;
    }
    if (p.tool === "door" || p.tool === "window") {
      const w =
        p.design.walls.find((w) => w.id === id) ||
        p.design.walls.find(
          (w) =>
            distance(point, projectPoint(point, ...wallPoints(p.design, w))) <
            0.3,
        );
      if (!w) {
        p.onError("Click a wall to host the opening.");
        return;
      }
      const q = projectPoint(point, ...wallPoints(p.design, w)),
        length = wallLength(p.design, w),
        d = clone(p.design),
        width = p.tool === "door" ? 1 : 1.4,
        o = {
          id: uid(p.tool),
          wallId: w.id,
          type: p.tool,
          offset: Math.max(
            0.05,
            Math.min(length - width - 0.05, q.t * length - width / 2),
          ),
          width,
          height:
            p.tool === "door"
              ? Math.min(2.2, w.height)
              : Math.min(1.3, w.height - 0.9),
          sill: p.tool === "door" ? 0 : 0.9,
          angle: p.tool === "door" ? 85 : 0,
        };
      d.openings.push(o);
      if (apply(d)) {
        p.onSelect(o.id);
        p.setTool("select");
      }
      return;
    }
    const ids = id
      ? e.shiftKey
        ? p.selectedIds.includes(id)
          ? p.selectedIds.filter((v) => v !== id)
          : [...p.selectedIds, id]
        : p.selectedIds.includes(id)
          ? p.selectedIds
          : [id]
      : [];
    if ((id && !p.selectedIds.includes(id)) || e.shiftKey || !id)
      p.onSelect(id, e.shiftKey);
    if (
      vertex ||
      (id &&
        (p.design.walls.some((w) => w.id === id) ||
          p.design.furniture.some((f) => f.id === id) ||
          p.design.openings.some((o) => o.id === id) ||
          p.design.lights.some((l) => l.id === id)))
    ) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        type: vertex ? "vertex" : "entity",
        id: vertex || id,
        point,
        client: { x: e.clientX, y: e.clientY },
        base: clone(p.design),
        view,
        ids,
        moved: false,
        last: p.design,
      };
    }
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const raw = coordinate(e);
    if (!drag.current) {
      if (p.tool !== "select" && p.tool !== "pan") setCursor(snap(raw));
      return;
    }
    const t = drag.current;
    if (
      Math.hypot(e.clientX - t.client.x, e.clientY - t.client.y) < 3 &&
      !t.moved
    )
      return;
    t.moved = true;
    if (t.type === "pan") {
      setView({
        ...t.view,
        x:
          t.view.x -
          ((e.clientX - t.client.x) / svg.current!.clientWidth) * t.view.w,
        y:
          t.view.y -
          ((e.clientY - t.client.y) / svg.current!.clientHeight) * t.view.h,
      });
      return;
    }
    const d = clone(t.base),
      dx = Math.round((raw.x - t.point.x) * 10) / 10,
      dy = Math.round((raw.y - t.point.y) * 10) / 10;
    if (t.type === "vertex") {
      const v = d.vertices.find((v) => v.id === t.id)!;
      v.x += dx;
      v.y += dy;
    } else {
      const vs = new Set<string>();
      for (const id of t.ids) {
        const f =
          d.furniture.find((f) => f.id === id) ||
          d.lights.find((l) => l.id === id);
        if (f) {
          f.x += dx;
          f.y += dy;
        }
        const w = d.walls.find((w) => w.id === id);
        if (w) {
          vs.add(w.a);
          vs.add(w.b);
        }
        const o = d.openings.find((o) => o.id === id);
        if (o && !t.ids.includes(o.wallId)) {
          const host = d.walls.find((w) => w.id === o.wallId)!,
            [a, b] = wallPoints(d, host),
            len = distance(a, b);
          o.offset += (dx * (b.x - a.x)) / len + (dy * (b.y - a.y)) / len;
        }
      }
      for (const v of d.vertices)
        if (vs.has(v.id)) {
          v.x += dx;
          v.y += dy;
        }
    }
    try {
      checked(d);
      p.onChange(d, false);
      t.last = d;
      t.error = undefined;
    } catch (e) {
      t.error = (e as Error).message;
    }
  }
  function up() {
    const t = drag.current;
    drag.current = null;
    if (t?.moved && t.type !== "pan") {
      apply(t.last, true);
      if (t.error) p.onError(t.error + " Kept the last valid position.");
    }
  }
  function zoom(factor: number, point?: Vec2) {
    setView((v) => {
      const w = Math.max(2, Math.min(100, v.w * factor)),
        h = (w / v.w) * v.h,
        c = point || { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      return {
        x: c.x - ((c.x - v.x) * w) / v.w,
        y: c.y - ((c.y - v.y) * h) / v.h,
        w,
        h,
      };
    });
  }
  const rooms = detectRooms(p.design),
    textSize = Math.max(0.22, view.w * 0.023);
  return (
    <div className={`plan-host tool-${p.tool}`}>
      <svg
        ref={svg}
        data-testid="plan-canvas"
        aria-label="Measured floor plan"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => {
          zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08, coordinate(e));
        }}
      >
        <defs>
          <pattern
            id="plan-grid"
            width=".5"
            height=".5"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0" cy="0" r=".014" fill="#c8cbbf" />
          </pattern>
          <pattern
            id="floor-grid"
            width=".6"
            height=".6"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M.6 0H0V.6"
              fill="none"
              stroke="#c3c4b5"
              strokeWidth=".01"
            />
          </pattern>
          <pattern
            id="counter-lines"
            width=".1"
            height=".1"
            patternUnits="userSpaceOnUse"
          >
            <path d="M0 0V.1" stroke="#ac9471" strokeWidth=".015" />
          </pattern>
        </defs>
        <rect
          x={view.x}
          y={view.y}
          width={view.w}
          height={view.h}
          fill="url(#plan-grid)"
        />
        {rooms.map((r) => (
          <g key={r.id}>
            <polygon
              data-entity={r.id}
              points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={
                p.design.floorMaterial === "oak"
                  ? "#e5dbc7"
                  : p.design.floorMaterial === "clay"
                    ? "#e3c0ab"
                    : "#eeede3"
              }
            />
            <polygon
              points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="url(#floor-grid)"
              pointerEvents="none"
            />
          </g>
        ))}
        {p.design.walls.map((w) => {
          const [a, b] = wallPoints(p.design, w),
            l = wallLength(p.design, w),
            selected = p.selectedIds.includes(w.id),
            dx = ((b.y - a.y) / l) * 0.52,
            dy = (-(b.x - a.x) / l) * 0.52;
          return (
            <g key={w.id}>
              <line
                data-entity={w.id}
                data-testid={w.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={selected ? "#cc8352" : "#66705d"}
                strokeWidth={w.thickness}
                strokeLinecap="square"
              />
              <line
                data-entity={w.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={Math.max(0.25, w.thickness)}
              />
              <g className="dimensions" pointerEvents="none">
                <path
                  d={`M${a.x + dx * 0.6} ${a.y + dy * 0.6} L${a.x + dx * 1.35} ${a.y + dy * 1.35} M${b.x + dx * 0.6} ${b.y + dy * 0.6} L${b.x + dx * 1.35} ${b.y + dy * 1.35} M${a.x + dx} ${a.y + dy} L${b.x + dx} ${b.y + dy}`}
                  stroke="#9aa08f"
                  strokeWidth=".012"
                />
                <text
                  x={(a.x + b.x) / 2 + dx}
                  y={(a.y + b.y) / 2 + dy}
                  dy="-.07"
                  textAnchor="middle"
                  fontSize={textSize}
                  fill="#727b69"
                  paintOrder="stroke"
                  stroke="#f8f8f2"
                  strokeWidth=".07"
                >
                  {l.toFixed(2)} m
                </text>
              </g>
              {selected &&
                [a, b].map((v) => (
                  <circle
                    key={v.id}
                    data-entity={w.id}
                    data-vertex={v.id}
                    cx={v.x}
                    cy={v.y}
                    r=".11"
                    fill="#fff9ed"
                    stroke="#cb8556"
                    strokeWidth=".035"
                    className="vertex-handle"
                  />
                ))}
            </g>
          );
        })}
        {p.design.openings.map((o) => {
          const pose = openingPose(p.design, o),
            selected = p.selectedIds.includes(o.id),
            w = p.design.walls.find((w) => w.id === o.wallId)!,
            r = o.width,
            angle = (o.angle * Math.PI) / 180;
          return (
            <g
              key={o.id}
              data-entity={o.id}
              data-testid={o.id}
              transform={`translate(${pose.x} ${pose.y}) rotate(${(pose.rotation * 180) / Math.PI})`}
            >
              <rect
                x="0"
                y={-w.thickness / 2 - 0.015}
                width={r}
                height={w.thickness + 0.03}
                fill="#f4f3ea"
                stroke={selected ? "#d68a53" : "#9aab9c"}
                strokeWidth=".02"
              />
              {o.type === "door" ? (
                <>
                  <path
                    d={`M${r} 0 A${r} ${r} 0 0 1 0 ${r}`}
                    fill="none"
                    stroke="#9ca58e"
                    strokeWidth=".018"
                    strokeDasharray=".05 .03"
                  />
                  <path
                    d={`M0 0 L${Math.cos(angle) * r} ${Math.sin(angle) * r}`}
                    stroke={selected ? "#d68a53" : "#789075"}
                    strokeWidth=".045"
                  />
                  <path
                    d={`M0 0 L${r} 0 A${r} ${r} 0 0 1 0 ${r} Z`}
                    fill="#9aab73"
                    opacity=".07"
                  />
                </>
              ) : (
                <>
                  <line
                    x1="0"
                    x2={r}
                    y1="-.045"
                    y2="-.045"
                    stroke="#87a4a4"
                    strokeWidth=".025"
                  />
                  <line
                    x1="0"
                    x2={r}
                    y1=".045"
                    y2=".045"
                    stroke="#87a4a4"
                    strokeWidth=".025"
                  />
                  <line
                    x1={r / 2}
                    x2={r / 2}
                    y1="-.09"
                    y2=".09"
                    stroke="#87a4a4"
                    strokeWidth=".025"
                  />
                </>
              )}
            </g>
          );
        })}
        {p.design.furniture.map((f) => {
          const c = CATALOG.find((c) => c.id === f.catalogId)!,
            s = furnitureSize(f),
            selected = p.selectedIds.includes(f.id),
            warning = p.warnings.find(
              (w) => w.ids.includes(f.id) && w.kind !== "contact",
            ),
            stroke = warning ? "#d28c48" : selected ? "#dc925b" : "#96957c",
            id = f.catalogId;
          return (
            <g
              key={f.id}
              data-entity={f.id}
              data-testid={f.id}
              transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`}
              className="plan-furniture"
            >
              <rect
                x={-s.width / 2 - 0.06}
                y={-s.depth / 2 - 0.06}
                width={s.width + 0.12}
                height={s.depth + 0.12}
                rx=".035"
                fill="transparent"
                stroke={selected ? "#de925c" : warning ? "#d2a060" : "none"}
                strokeWidth=".025"
                strokeDasharray={warning ? ".08 .04" : undefined}
              />
              {["bistro", "stool", "plant", "lamp"].includes(id) ? (
                <>
                  <circle
                    r={s.width / 2}
                    fill={id === "plant" ? "#9aa886" : c.color}
                    fillOpacity=".45"
                    stroke={stroke}
                    strokeWidth=".024"
                  />
                  {id === "plant" ? (
                    Array.from({ length: 6 }, (_, i) => (
                      <ellipse
                        key={i}
                        cx=".1"
                        cy="0"
                        rx=".15"
                        ry=".06"
                        fill={i % 2 ? "#91a17d" : "#a2b08d"}
                        transform={`rotate(${i * 60})`}
                      />
                    ))
                  ) : (
                    <circle
                      r={s.width * 0.12}
                      fill="#efe7d2"
                      stroke={stroke}
                      strokeWidth=".018"
                    />
                  )}
                </>
              ) : (
                <>
                  <rect
                    x={-s.width / 2}
                    y={-s.depth / 2}
                    width={s.width}
                    height={s.depth}
                    rx={["chair", "lounge"].includes(id) ? ".09" : ".025"}
                    fill={c.color}
                    fillOpacity=".5"
                    stroke={stroke}
                    strokeWidth=".024"
                  />
                  {["chair", "lounge", "banquette"].includes(id) && (
                    <rect
                      x={-s.width / 2 + 0.015}
                      y={-s.depth / 2}
                      width={s.width - 0.03}
                      height={s.depth * 0.18}
                      rx=".03"
                      fill={c.color}
                      stroke={stroke}
                      strokeWidth=".015"
                    />
                  )}
                  {["counter", "shelf", "partition"].includes(id) && (
                    <rect
                      x={-s.width / 2 + 0.04}
                      y={-s.depth / 2 + 0.04}
                      width={s.width - 0.08}
                      height={s.depth - 0.08}
                      fill="url(#counter-lines)"
                    />
                  )}
                </>
              )}
            </g>
          );
        })}
        {p.design.lights.map((l) => (
          <g
            key={l.id}
            data-entity={l.id}
            transform={`translate(${l.x} ${l.y})`}
          >
            <circle
              r=".11"
              fill="#f5e6b9"
              stroke={p.selectedIds.includes(l.id) ? "#d88b50" : "#bfac75"}
              strokeWidth=".02"
            />
            <path
              d="M-.07-.07 .07 .07M-.07 .07 .07-.07"
              stroke="#bfac75"
              strokeWidth=".012"
            />
          </g>
        ))}
        {rooms.map((r) => {
          const x = r.points.reduce((s, p) => s + p.x, 0) / r.points.length,
            y = r.points.reduce((s, p) => s + p.y, 0) / r.points.length;
          return (
            <g
              key={r.id}
              data-entity={r.id}
              transform={`translate(${x} ${y - 1.35})`}
            >
              <rect
                x="-1.18"
                y="-.25"
                width="2.36"
                height=".6"
                rx=".1"
                fill="#f4f3ea"
                fillOpacity=".9"
              />
              <text
                textAnchor="middle"
                fontSize=".20"
                fill="#505e48"
                fontWeight="500"
              >
                {r.name}
              </text>
              <text textAnchor="middle" y=".26" fontSize=".16" fill="#969985">
                {r.area.toFixed(2)} m²
              </text>
            </g>
          );
        })}
        {cursor && p.tool !== "select" && p.tool !== "pan" && (
          <g pointerEvents="none">
            {start && (
              <>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={cursor.x}
                  y2={cursor.y}
                  stroke="#cf8351"
                  strokeWidth=".16"
                  opacity=".6"
                />
                <text
                  x={(start.x + cursor.x) / 2}
                  y={(start.y + cursor.y) / 2 - 0.3}
                  fontSize=".22"
                  fill="#b77142"
                >
                  {distance(start, cursor).toFixed(3)} m
                </text>
              </>
            )}
            <circle
              cx={cursor.x}
              cy={cursor.y}
              r=".1"
              fill="#fff4df"
              stroke="#ce8452"
              strokeWidth=".03"
            />
            <text
              x={cursor.x + 0.2}
              y={cursor.y - 0.2}
              fontSize=".16"
              fill="#b4784f"
            >
              {snapLabel}
            </text>
            {p.tool === "furniture" && (
              <rect
                x={
                  cursor.x -
                  (CATALOG.find((c) => c.id === p.placeId)?.width || 1) / 2
                }
                y={
                  cursor.y -
                  (CATALOG.find((c) => c.id === p.placeId)?.depth || 1) / 2
                }
                width={CATALOG.find((c) => c.id === p.placeId)?.width || 1}
                height={CATALOG.find((c) => c.id === p.placeId)?.depth || 1}
                fill="#cf9a61"
                opacity=".3"
              />
            )}
          </g>
        )}
        {!p.design.walls.length && (
          <text x="5" y="4" textAnchor="middle" fontSize=".28" fill="#919b86">
            Every great space starts with a line.
          </text>
        )}
      </svg>
      <div className="plan-north">
        <span>N</span>
        <svg viewBox="0 0 22 28">
          <path d="M11 2 18 25 11 20 4 25Z" fill="none" stroke="currentColor" />
          <path d="M11 2v18l7 5Z" fill="currentColor" />
        </svg>
      </div>
      <div className="plan-bottom">
        <span
          className="scale-line"
          style={{ width: (svg.current?.clientWidth || 400) / view.w }}
        >
          1 m
        </span>
        <div className="zoom-controls">
          <button title="Zoom out" onClick={() => zoom(1.2)}>
            <Minus size={14} />
          </button>
          <span>{Math.round((13 / view.w) * 100)}%</span>
          <button title="Zoom in" onClick={() => zoom(1 / 1.2)}>
            <Plus size={14} />
          </button>
          <button title="Fit plan (F)" onClick={fit}>
            <Focus size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
