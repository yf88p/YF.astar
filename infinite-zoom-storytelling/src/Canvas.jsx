import React, { useId } from "react";
import { multiply } from "./core.js";

const indexes = new WeakMap();
export function sceneIndex(project) {
  if (indexes.has(project)) return indexes.get(project);
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  const children = new Map();
  const matrices = new Map([[null, [1, 0, 0, 1, 0, 0]]]);
  for (const n of project.nodes) {
    const p = n.parentId ?? null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n);
  }
  function matrix(id) {
    if (matrices.has(id)) return matrices.get(id);
    const n = byId.get(id),
      a = (n.rotation * Math.PI) / 180;
    const c = Math.cos(a) * n.scale,
      s = Math.sin(a) * n.scale;
    const m = multiply(matrix(n.parentId ?? null), [c, s, -s, c, n.x, n.y]);
    matrices.set(id, m);
    return m;
  }
  project.nodes.forEach((n) => matrix(n.id));
  const result = { byId, children, matrices };
  indexes.set(project, result);
  return result;
}

export function screenMatrix(m, camera, viewport) {
  return [
    m[0] * camera.scale,
    m[1] * camera.scale,
    m[2] * camera.scale,
    m[3] * camera.scale,
    (m[4] - camera.x) * camera.scale + viewport.width / 2,
    (m[5] - camera.y) * camera.scale + viewport.height / 2,
  ];
}

export function visibleNodes(project, camera, viewport, override = false) {
  const index = sceneIndex(project),
    result = [];
  function visit(id, clips = [], locked = false) {
    for (const n of index.children.get(id) || []) {
      if (n.hidden) continue;
      const m = screenMatrix(index.matrices.get(n.id), camera, viewport);
      const effective = Math.hypot(m[0], m[1]);
      if (
        !override &&
        (effective < (n.minZoom ?? 0) || effective > (n.maxZoom ?? Infinity))
      )
        continue;
      const points = [
        [0, 0],
        [n.w, 0],
        [n.w, n.h],
        [0, n.h],
      ].map(([x, y]) => [
        m[0] * x + m[2] * y + m[4],
        m[1] * x + m[3] * y + m[5],
      ]);
      const xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
      const bounds = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      };
      let visible =
        bounds.right >= -4 &&
        bounds.bottom >= -4 &&
        bounds.x <= viewport.width + 4 &&
        bounds.y <= viewport.height + 4;
      visible &&= !clips.some(
        (c) =>
          bounds.right < c.bounds.x ||
          bounds.bottom < c.bounds.y ||
          bounds.x > c.bounds.right ||
          bounds.y > c.bounds.bottom,
      );
      const tiny = Math.max(n.w, n.h) * effective < 0.5;
      if (
        visible &&
        !tiny &&
        !(n.type === "text" && (n.fontSize || 16) * effective < 3)
      )
        result.push({
          n,
          m,
          clips,
          points,
          bounds,
          locked: locked || n.locked,
        });
      if ((!n.clip || visible) && !tiny)
        visit(
          n.id,
          n.clip ? [...clips, { id: n.id, points, bounds }] : clips,
          locked || n.locked,
        );
    }
  }
  visit(null);
  return result;
}

function Artwork({ node: n, project }) {
  const common = {
    fill: n.fill || "none",
    stroke: n.stroke || "none",
    strokeWidth: n.strokeWidth ?? 1,
  };
  if (n.type === "text")
    return (
      <foreignObject width={n.w} height={n.h} style={{ overflow: "visible" }}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          className="canvas-text"
          style={{
            fontFamily: n.fontFamily || "Arial, sans-serif",
            fontSize: n.fontSize || 16,
            fontWeight: n.fontWeight || 400,
            color: n.color || n.fill || "#263d33",
            textAlign: n.align || "left",
          }}
        >
          {n.runs
            ? n.runs.map((r, i) => (
                <span
                  key={i}
                  style={{
                    fontWeight: r.bold ? 700 : undefined,
                    fontStyle: r.italic ? "italic" : undefined,
                  }}
                >
                  {r.text}
                </span>
              ))
            : n.text}
        </div>
      </foreignObject>
    );
  if (n.type === "image") {
    const asset = project.assets[n.assetId];
    if (!asset) return <rect width={n.w} height={n.h} fill="#d8dfd0" />;
    const crop = n.crop || { x: 0, y: 0, zoom: 1 };
    return (
      <svg width={n.w} height={n.h} overflow="hidden">
        <image
          href={asset.dataUrl}
          x={crop.x}
          y={crop.y}
          width={n.w * crop.zoom}
          height={n.h * crop.zoom}
          preserveAspectRatio={
            n.fit === "fill"
              ? "none"
              : `xMidYMid ${n.fit === "contain" ? "meet" : "slice"}`
          }
        />
      </svg>
    );
  }
  if (n.type === "path")
    return (
      <path
        d={n.path}
        {...common}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  if (n.type === "ellipse")
    return (
      <ellipse
        cx={n.w / 2}
        cy={n.h / 2}
        rx={n.w / 2}
        ry={n.h / 2}
        {...common}
      />
    );
  if (n.type === "line")
    return (
      <line
        x1="0"
        y1="0"
        x2={n.w}
        y2={n.h}
        {...common}
        stroke={n.stroke || n.fill || "#294c3d"}
      />
    );
  if (n.type === "group") return null;
  return <rect width={n.w} height={n.h} {...common} />;
}

export default function Canvas({
  project,
  camera,
  viewport,
  selected = [],
  override = false,
  viewer = false,
  onNodeDown,
  onNodeDoubleClick,
  onBranch,
  onHandleDown,
  onBackgroundDown,
  svgRef,
  miniature = false,
  editingId = null,
}) {
  const prefix = useId().replaceAll(":", "");
  const visible = visibleNodes(project, camera, viewport, override);
  const clipMap = new Map();
  visible.forEach((item) => item.clips.forEach((c) => clipMap.set(c.id, c)));
  const linkMap = new Map(project.links.map((l) => [l.sourceId, l]));
  return (
    <svg
      ref={svgRef}
      className={`spatial-canvas ${viewer ? "is-viewer" : ""}`}
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      width="100%"
      height="100%"
      onPointerDown={onBackgroundDown}
      data-visible-count={visible.length}
      data-total-count={project.nodes.length}
      aria-label={miniature ? undefined : "Spatial storytelling canvas"}
    >
      <defs>
        {[...clipMap.values()].map((c) => (
          <clipPath
            key={c.id}
            id={`${prefix}-${c.id}`}
            clipPathUnits="userSpaceOnUse"
          >
            <polygon points={c.points.map((p) => p.join(",")).join(" ")} />
          </clipPath>
        ))}
      </defs>
      {visible.map(({ n, m, clips, locked }) => {
        const link = linkMap.get(n.id);
        let content = (
          <g
            transform={`matrix(${m.join(" ")})`}
            opacity={n.opacity ?? 1}
            data-node-id={miniature ? undefined : n.id}
            style={{
              cursor: viewer
                ? link
                  ? "pointer"
                  : n.type === "text"
                    ? "text"
                    : undefined
                : locked
                  ? "not-allowed"
                  : "default",
              visibility: editingId === n.id ? "hidden" : undefined,
            }}
            onPointerDown={
              miniature
                ? undefined
                : (e) => {
                    if (viewer && link) e.stopPropagation();
                    else onNodeDown?.(e, n, locked);
                  }
            }
            onDoubleClick={
              miniature
                ? undefined
                : (e) => {
                    if (!viewer) {
                      e.stopPropagation();
                      onNodeDoubleClick?.(n);
                    }
                  }
            }
            onClick={
              viewer && link && !miniature
                ? (e) => {
                    e.stopPropagation();
                    onBranch?.(link.targetStopId);
                  }
                : undefined
            }
            role={viewer && link && !miniature ? "button" : undefined}
            tabIndex={viewer && link && !miniature ? 0 : undefined}
            aria-label={viewer && link ? link.label : undefined}
            onKeyDown={
              viewer && link
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onBranch?.(link.targetStopId);
                    }
                  }
                : undefined
            }
          >
            <Artwork node={n} project={project} />
            {!viewer &&
              !miniature &&
              (n.type === "group" ||
                n.type === "path" ||
                n.type === "line") && (
                <rect
                  width={n.w}
                  height={n.h}
                  fill="transparent"
                  stroke="none"
                />
              )}
          </g>
        );
        for (const c of clips)
          content = <g clipPath={`url(#${prefix}-${c.id})`}>{content}</g>;
        return <React.Fragment key={n.id}>{content}</React.Fragment>;
      })}
      {!viewer &&
        !miniature &&
        visible
          .filter((i) => selected.includes(i.n.id))
          .map(({ n, m, points }) => (
            <g key={`selection-${n.id}`} className="selection-outline">
              <polygon
                points={points.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke="#427b68"
                strokeWidth="1.5"
                pointerEvents="none"
              />
              {points.map(([x, y], i) => (
                <rect
                  key={i}
                  x={x - 4}
                  y={y - 4}
                  width="8"
                  height="8"
                  fill="#fff"
                  stroke="#427b68"
                  strokeWidth="1.5"
                  style={{ cursor: i % 2 ? "nesw-resize" : "nwse-resize" }}
                  onPointerDown={(e) => onHandleDown?.(e, n, "resize", i)}
                />
              ))}
              <line
                x1={(points[0][0] + points[1][0]) / 2}
                y1={(points[0][1] + points[1][1]) / 2}
                x2={
                  (points[0][0] + points[1][0]) / 2 +
                  (m[2] / Math.hypot(m[2], m[3])) * -22
                }
                y2={
                  (points[0][1] + points[1][1]) / 2 +
                  (m[3] / Math.hypot(m[2], m[3])) * -22
                }
                stroke="#427b68"
              />
              <circle
                cx={
                  (points[0][0] + points[1][0]) / 2 +
                  (m[2] / Math.hypot(m[2], m[3])) * -22
                }
                cy={
                  (points[0][1] + points[1][1]) / 2 +
                  (m[3] / Math.hypot(m[2], m[3])) * -22
                }
                r="4"
                fill="#fff"
                stroke="#427b68"
                style={{ cursor: "grab" }}
                onPointerDown={(e) => onHandleDown?.(e, n, "rotate")}
              />
            </g>
          ))}
    </svg>
  );
}
