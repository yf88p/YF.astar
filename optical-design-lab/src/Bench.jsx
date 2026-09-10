import React, { useEffect, useRef, useState } from "react";
import {
  elementBounds,
  objectPoints,
  prismVertices,
  toWorld,
} from "./optics.js";

export function spectralColor(nm) {
  if (nm < 460) return "#8b92ff";
  if (nm < 510) return "#59bafa";
  if (nm < 570) return "#78d9a9";
  if (nm < 610) return "#ebd17c";
  if (nm < 650) return "#eea26e";
  return "#ec7c8b";
}
const sag = (r, y) =>
  r === 0
    ? 0
    : (Math.sign(r) * y * y) /
      (Math.abs(r) + Math.sqrt(Math.max(0, r * r - y * y)));
export function outline(e) {
  const a = (e.aperture || e.diameter || 30) / 2;
  if (e.type === "lens" || e.type === "slab") {
    const front = Array.from({ length: 49 }, (_, i) => {
      const y = -a + (2 * a * i) / 48;
      return [-e.thickness / 2 + sag(e.radius1 || 0, y), y, 0];
    });
    const back = Array.from({ length: 49 }, (_, i) => {
      const y = a - (2 * a * i) / 48;
      return [e.thickness / 2 + sag(e.radius2 || 0, y), y, 0];
    });
    return [...front, ...back];
  }
  if (e.type === "prism") return prismVertices(e).map(([x, y]) => [x, y, 0]);
  if (e.type === "mirror")
    return Array.from({ length: 49 }, (_, i) => {
      const y = -a + (2 * a * i) / 48;
      return [sag(e.radius, y), y, 0];
    });
  if (e.type === "detector")
    return [
      [0, -e.width / 2, 0],
      [0, e.width / 2, 0],
    ];
  return [
    [0, -a, 0],
    [0, a, 0],
  ];
}

export default function Bench({
  project,
  result,
  selectedIds,
  selectedRayId,
  onSelect,
  onRaySelect,
  onMove,
  onPreview,
  fitKey,
  tool,
  wavelengths,
  showRays,
}) {
  const root = useRef(null),
    gesture = useRef(null),
    viewRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 430 });
  const [view, setView] = useState({ x: -12, y: 0, scale: 2.9 });
  const [marquee, setMarquee] = useState(null);
  viewRef.current = view;
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const bounds = projectRef.current.elements
      .filter((e) => e.type !== "slab" || e.thickness < 1000)
      .map(elementBounds);
    if (!bounds.length) return setView({ x: 0, y: 0, scale: 2 });
    const minX = Math.min(...bounds.map((b) => b.min[0])),
      maxX = Math.max(...bounds.map((b) => b.max[0]));
    const minY = Math.min(-24, ...bounds.map((b) => b.min[1])),
      maxY = Math.max(24, ...bounds.map((b) => b.max[1]));
    setView({
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      scale: Math.min(
        (size.w - 150) / Math.max(60, maxX - minX),
        (size.h - 140) / Math.max(55, maxY - minY),
        8,
      ),
    });
  }, [fitKey, size.w, size.h]);
  const screen = (p) => [
    (p[0] - view.x) * view.scale + size.w / 2,
    size.h / 2 - (p[1] - view.y) * view.scale,
  ];
  const world = (p) => [
    (p[0] - size.w / 2) / view.scale + view.x,
    (size.h / 2 - p[1]) / view.scale + view.y,
  ];
  const localPoint = (ev) => {
    const r = root.current.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const path = (points) =>
    points.map((p, i) => `${i ? "L" : "M"}${screen(p).join(",")}`).join(" ");
  const start = (ev, id) => {
    if (ev.button !== 0 && ev.button !== 1 && ev.button !== 2) return;
    ev.preventDefault();
    ev.stopPropagation();
    root.current.setPointerCapture(ev.pointerId);
    const p = localPoint(ev),
      pan = tool === "pan" || ev.button > 0 || ev.getModifierState?.("Space");
    if (id && !pan) {
      let ids = selectedIds.includes(id) ? selectedIds : [id];
      if (ev.shiftKey)
        ids = selectedIds.includes(id)
          ? selectedIds.filter((i) => i !== id)
          : [...selectedIds, id];
      onSelect(ids);
      gesture.current = {
        mode: "move",
        start: p,
        ids,
        original: project,
        moved: false,
      };
    } else {
      gesture.current = {
        mode: ev.shiftKey && !pan ? "select" : "pan",
        start: p,
        view,
        moved: false,
      };
      if (!pan && !ev.shiftKey) onSelect([]);
    }
  };
  const move = (ev) => {
    const g = gesture.current;
    if (!g) return;
    const p = localPoint(ev),
      dx = p[0] - g.start[0],
      dy = p[1] - g.start[1];
    if (Math.hypot(dx, dy) > 2) g.moved = true;
    if (g.mode === "pan")
      setView({
        ...g.view,
        x: g.view.x - dx / view.scale,
        y: g.view.y + dy / view.scale,
      });
    if (g.mode === "select") setMarquee({ start: g.start, end: p });
    if (g.mode === "move" && g.moved) {
      const next = structuredClone(g.original);
      for (const e of next.elements)
        if (g.ids.includes(e.id)) {
          e.position[0] += dx / view.scale;
          e.position[1] -= dy / view.scale;
        }
      g.next = next;
      onPreview(next);
    }
  };
  const finish = (ev) => {
    const g = gesture.current;
    if (!g) return;
    if (ev.type === "pointercancel") {
      if (g.mode === "move" && g.moved) onMove(g.original);
      gesture.current = null;
      setMarquee(null);
      return;
    }
    if (g.mode === "move" && g.moved) onMove(g.next, g.original);
    if (g.mode === "select") {
      const p = localPoint(ev),
        low = [Math.min(p[0], g.start[0]), Math.min(p[1], g.start[1])],
        high = [Math.max(p[0], g.start[0]), Math.max(p[1], g.start[1])];
      onSelect(
        project.elements
          .filter((e) => {
            const q = screen(e.position);
            return (
              q[0] >= low[0] &&
              q[0] <= high[0] &&
              q[1] >= low[1] &&
              q[1] <= high[1]
            );
          })
          .map((e) => e.id),
      );
    }
    gesture.current = null;
    setMarquee(null);
  };
  useEffect(() => {
    const el = root.current;
    const wheel = (ev) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect(),
        px = ev.clientX - rect.left - rect.width / 2,
        py = rect.height / 2 - (ev.clientY - rect.top);
      const v = viewRef.current,
        scale = Math.max(
          0.03,
          Math.min(80, v.scale * Math.exp(-ev.deltaY * 0.0015)),
        );
      setView({
        x: v.x + px / v.scale - px / scale,
        y: v.y + py / v.scale - py / scale,
        scale,
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const step =
    10 ** Math.floor(Math.log10(65 / view.scale)) *
    (65 / view.scale / 10 ** Math.floor(Math.log10(65 / view.scale)) > 5
      ? 5
      : 2);
  const [left, top] = world([0, 0]),
    [right, bottom] = world([size.w, size.h]);
  const xticks = [],
    yticks = [];
  for (let x = Math.ceil(left / step) * step; x <= right; x += step)
    xticks.push(x);
  for (let y = Math.ceil(bottom / step) * step; y <= top; y += step)
    yticks.push(y);
  const matching = (result?.rays || []).filter(
    (r) => !wavelengths || wavelengths.includes(r.wavelength),
  );
  const stride = Math.max(1, Math.ceil(matching.length / 180));
  const rays = matching.filter(
    (r, i) => i % stride === 0 && r.id !== selectedRayId,
  );
  const chosen = result?.rays.find((r) => r.id === selectedRayId);
  return (
    <div
      className={`bench-canvas ${tool === "pan" ? "panning" : ""}`}
      ref={root}
      data-testid="bench"
      onPointerDown={(ev) => start(ev)}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={(ev) => ev.preventDefault()}
    >
      <svg
        width="100%"
        height="100%"
        aria-label="Editable optical bench, X Y projection"
        role="img"
      >
        <defs>
          <pattern
            id="minor-grid"
            width={(step * view.scale) / 5}
            height={(step * view.scale) / 5}
            patternUnits="userSpaceOnUse"
            x={screen([0, 0, 0])[0]}
            y={screen([0, 0, 0])[1]}
          >
            <circle cx="0.5" cy="0.5" r="0.6" fill="#31414a" />
          </pattern>
          <filter id="source-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="url(#minor-grid)" />
        {xticks.map((x) => (
          <g key={x}>
            <line
              x1={screen([x, 0, 0])[0]}
              x2={screen([x, 0, 0])[0]}
              y1="0"
              y2={size.h}
              stroke="#27363e"
              strokeOpacity=".48"
            />
            <text
              x={screen([x, 0, 0])[0] + 5}
              y={size.h - 13}
              className="axis-text"
            >
              {Math.round(x * 100) / 100}
            </text>
          </g>
        ))}
        {yticks.map((y) => (
          <g key={y}>
            <line
              x1="0"
              x2={size.w}
              y1={screen([0, y, 0])[1]}
              y2={screen([0, y, 0])[1]}
              stroke="#27363e"
              strokeOpacity=".48"
            />
            <text x="9" y={screen([0, y, 0])[1] - 6} className="axis-text">
              {Math.round(y * 100) / 100}
            </text>
          </g>
        ))}
        <line
          x1="0"
          x2={size.w}
          y1={screen([0, 0, 0])[1]}
          y2={screen([0, 0, 0])[1]}
          stroke="#617681"
          strokeOpacity=".55"
          strokeDasharray="5 7"
        />
        {showRays &&
          rays.map((r) => (
            <path
              key={r.id}
              d={path(r.points)}
              fill="none"
              stroke={spectralColor(r.wavelength)}
              strokeWidth="1"
              opacity={r.termination === "clipped" ? 0.15 : 0.31}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                onRaySelect(r.id);
              }}
              className="ray-path"
            />
          ))}
        {showRays &&
          rays
            .filter(
              (r) =>
                r.termination === "clipped" || r.termination === "absorbed",
            )
            .map((r) => {
              const p = screen(r.points.at(-1));
              return (
                <circle
                  key={`end-${r.id}`}
                  cx={p[0]}
                  cy={p[1]}
                  r="2"
                  fill={r.termination === "clipped" ? "#d6ac72" : "#e28b84"}
                  opacity=".6"
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    onRaySelect(r.id);
                  }}
                >
                  <title>
                    {r.termination} · {r.id}
                  </title>
                </circle>
              );
            })}
        {project.elements.map((e, i) => {
          const selected = selectedIds.includes(e.id),
            col =
              e.type === "source"
                ? "#e9bd77"
                : e.type === "detector"
                  ? "#ae9be5"
                  : "#80cbbb";
          const points = outline(e).map((p) => toWorld(p, e)),
            [cx, cy] = screen(e.position);
          const shape =
            path(points) +
            (["lens", "slab", "prism"].includes(e.type) ? " Z" : "");
          const anchorY = Math.max(...points.map((p) => screen(p)[1]));
          return (
            <g
              key={e.id}
              data-testid={`element-${e.id}`}
              onPointerDown={(ev) => start(ev, e.id)}
              className="optical-element"
              aria-label={`${e.name}, ${e.type}`}
            >
              {selected && (
                <path
                  d={shape}
                  fill="none"
                  stroke={col}
                  strokeWidth="9"
                  opacity=".11"
                />
              )}
              {e.type === "source" ? (
                <g>
                  <circle cx={cx} cy={cy} r="12" fill={col} opacity=".13" />
                  <path
                    d={`M${cx - 5},${cy + 12}L${cx - 5},${cy - 12}L${cx + 1},${cy - 5}M${cx - 5},${cy - 12}L${cx - 11},${cy - 5}`}
                    fill="none"
                    stroke={col}
                    strokeWidth="2"
                  />
                  {objectPoints(e).map((p, j) => {
                    const q = screen(toWorld(p, e));
                    return (
                      <circle key={j} cx={q[0]} cy={q[1]} r="2.8" fill={col} />
                    );
                  })}
                </g>
              ) : e.type === "stop" ? (
                <g>
                  {[
                    [-e.diameter / 2, -e.aperture / 2],
                    [e.aperture / 2, e.diameter / 2],
                  ].map(([a, b], j) => (
                    <path
                      key={j}
                      d={path(
                        [
                          [0, a, 0],
                          [0, b, 0],
                        ].map((p) => toWorld(p, e)),
                      )}
                      stroke="#9baab0"
                      strokeWidth="5"
                    />
                  ))}
                  <path
                    d={shape}
                    stroke="transparent"
                    strokeWidth="17"
                    fill="none"
                  />
                </g>
              ) : (
                <>
                  <path
                    d={shape}
                    fill={
                      ["lens", "slab", "prism"].includes(e.type)
                        ? "#639f9b25"
                        : "none"
                    }
                    stroke={col}
                    strokeWidth={e.type === "detector" ? 3 : 1.8}
                  />
                  <path
                    d={shape}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="16"
                  />
                </>
              )}
              {e.type === "detector" && (
                <path
                  d={path(points.map((p) => [p[0] + 2, p[1], p[2]]))}
                  stroke={col}
                  strokeWidth="1"
                  opacity=".25"
                />
              )}
              <line
                x1={cx}
                x2={cx}
                y1={anchorY + 7}
                y2={Math.min(size.h - 56, anchorY + 30)}
                stroke={selected ? col : "#4b6169"}
                strokeWidth="1"
              />
              <rect
                x={cx - 10}
                y={Math.min(size.h - 52, anchorY + 34)}
                width="20"
                height="18"
                rx="4"
                fill={selected ? "#31514d" : "#243139"}
                stroke={selected ? col : "#405159"}
                strokeWidth=".7"
              />
              <text
                x={cx}
                y={Math.min(size.h - 39, anchorY + 47)}
                fill={selected ? "#c2eee1" : "#a4b5bc"}
                fontSize="10"
                textAnchor="middle"
                fontFamily="monospace"
              >
                {String(i + 1).padStart(2, "0")}
              </text>
              {selected && (
                <g>
                  <rect
                    x={cx - 66}
                    y={Math.min(...points.map((p) => screen(p)[1])) - 34}
                    width="132"
                    height="23"
                    rx="4"
                    fill="#273d3e"
                  />
                  <text
                    x={cx}
                    y={Math.min(...points.map((p) => screen(p)[1])) - 19}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#b8e5d8"
                  >
                    {e.name.length > 21 ? `${e.name.slice(0, 20)}...` : e.name}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {chosen && (
          <g pointerEvents="none">
            <path
              d={path(chosen.points)}
              stroke="#fff4c0"
              strokeWidth="2"
              fill="none"
            />
            {chosen.hits.map((hit, i) => {
              const p = screen(hit.position),
                end = screen(hit.position.map((v, j) => v + hit.normal[j] * 9));
              return (
                <g key={i}>
                  <line
                    x1={p[0]}
                    y1={p[1]}
                    x2={end[0]}
                    y2={end[1]}
                    stroke="#fcba75"
                    strokeDasharray="3 2"
                  />
                  <circle
                    cx={p[0]}
                    cy={p[1]}
                    r="4"
                    fill="#111c21"
                    stroke="#fff4c0"
                  />
                  <text x={p[0] + 6} y={p[1] - 6} fill="#fff4c0" fontSize="10">
                    {i + 1}
                  </text>
                </g>
              );
            })}
          </g>
        )}
        {marquee && (
          <rect
            x={Math.min(marquee.start[0], marquee.end[0])}
            y={Math.min(marquee.start[1], marquee.end[1])}
            width={Math.abs(marquee.start[0] - marquee.end[0])}
            height={Math.abs(marquee.start[1] - marquee.end[1])}
            fill="#8bdbc315"
            stroke="#8bdbc3"
            strokeDasharray="4 3"
          />
        )}
      </svg>
      <div className="canvas-caption">
        <span className="live-dot" /> MERIDIONAL VIEW{" "}
        <span>XY projection · 3D physics</span>
      </div>
      <div className="canvas-scale">
        <span style={{ width: Math.min(100, step * view.scale) }} />
        {step} mm <b>X →</b>
      </div>
      <div className="canvas-rays">
        {showRays
          ? `${rays.length + (chosen ? 1 : 0)} representative paths`
          : "Ray paths hidden"}{" "}
        · scroll to zoom
      </div>
    </div>
  );
}
