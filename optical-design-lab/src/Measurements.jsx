import React from "react";
import { spectralColor } from "./Bench.jsx";

export const fmt = (v, digits = 3) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : Math.abs(v) > 0 && Math.abs(v) < 0.001
      ? v.toExponential(2)
      : v.toFixed(digits);

export function SpotDiagram({
  spots,
  metric,
  detector,
  wavelengths,
  onRaySelect,
  selectedRayId,
  large = false,
  groupMode = "wavelength",
}) {
  const points = spots.filter(
    (p) =>
      p.detectorId === detector?.id &&
      (!wavelengths || wavelengths.includes(p.wavelength)),
  );
  const limit =
    points.reduce(
      (max, p) => Math.max(max, Math.abs(p.u), Math.abs(p.v)),
      0.01,
    ) * 1.2;
  const w = 430,
    h = large ? 420 : 202,
    pad = 30,
    scale = (h - pad * 2) / (2 * limit),
    cx = w / 2,
    cy = h / 2;
  const colors = [
    "#8b92ff",
    "#78d9a9",
    "#ebd17c",
    "#ec7c8b",
    "#59bafa",
    "#c599e1",
    "#eea26e",
  ];
  return (
    <div className={`spot-diagram ${large ? "large" : ""}`}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Detector-plane sampled geometric ray distribution"
      >
        {[-1, -0.5, 0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={cx + t * limit * scale}
              x2={cx + t * limit * scale}
              y1={pad}
              y2={h - pad}
              stroke="#2b3941"
              strokeDasharray={t === 0 ? "4 3" : "1 3"}
            />
            <line
              x1={cx - limit * scale}
              x2={cx + limit * scale}
              y1={cy + t * limit * scale}
              y2={cy + t * limit * scale}
              stroke="#2b3941"
              strokeDasharray={t === 0 ? "4 3" : "1 3"}
            />
            {t !== 0 && (
              <text
                x={cx + t * limit * scale}
                y={h - 12}
                textAnchor="middle"
                className="axis-text"
              >
                {fmt(t * limit, 2)}
              </text>
            )}
          </g>
        ))}
        <text x={cx + limit * scale + 12} y={cy + 4} className="axis-text">
          u
        </text>
        <text x={cx + 5} y="18" className="axis-text">
          v (mm)
        </text>
        {points
          .filter(
            (_, i) => i % Math.max(1, Math.ceil(points.length / 8000)) === 0,
          )
          .map((p) => (
            <circle
              key={p.rayId}
              cx={cx + p.u * scale}
              cy={cy - p.v * scale}
              r={p.rayId === selectedRayId ? 4 : large ? 1.8 : 1.3}
              fill={
                p.rayId === selectedRayId
                  ? "#fff4c0"
                  : groupMode === "object"
                    ? colors[Number(p.objectPointId) % colors.length] ||
                      "#8bdbc3"
                    : spectralColor(p.wavelength)
              }
              opacity=".75"
              className="spot-hit"
              onClick={() => onRaySelect(p.rayId)}
            >
              <title>
                {p.rayId} · {p.wavelength} nm · ({fmt(p.u)}, {fmt(p.v)}) mm
              </title>
            </circle>
          ))}
        {metric?.count > 0 && (
          <g stroke="#e8eff0" opacity=".7">
            <line
              x1={cx + metric.centroid[0] * scale - 4}
              x2={cx + metric.centroid[0] * scale + 4}
              y1={cy - metric.centroid[1] * scale}
              y2={cy - metric.centroid[1] * scale}
            />
            <line
              x1={cx + metric.centroid[0] * scale}
              x2={cx + metric.centroid[0] * scale}
              y1={cy - metric.centroid[1] * scale - 4}
              y2={cy - metric.centroid[1] * scale + 4}
            />
          </g>
        )}
        {!points.length && (
          <text x={cx} y={cy} textAnchor="middle" fill="#8e9fa8" fontSize="12">
            No detected rays in this selection
          </text>
        )}
      </svg>
      <span className="plot-caption">
        Sampled geometric rays · not calibrated irradiance
      </span>
    </div>
  );
}

export function FocusPlot({ scan, onPosition }) {
  const samples = scan?.samples || [],
    valid = samples.filter((s) => s.rms != null),
    w = 540,
    h = 183,
    x0 = 45,
    y0 = 20,
    pw = w - 75,
    ph = h - 53;
  if (!samples.length)
    return (
      <div className="empty-chart">
        <svg viewBox="0 0 120 45">
          <path
            d="M5 5Q60 80 115 5"
            fill="none"
            stroke="#567e77"
            strokeWidth="1.5"
          />
          <path d="M60 0V45" stroke="#46575c" strokeDasharray="3 3" />
        </svg>
        <strong>Find the plane of best focus</strong>
        <span>Trace the same ray population at every screen position.</span>
      </div>
    );
  const lo = samples[0].position,
    hi = samples.at(-1).position,
    max = Math.max(0.001, ...valid.map((s) => s.rms));
  const x = (p) => x0 + ((p - lo) / (hi - lo || 1)) * pw,
    y = (r) => y0 + ph * (1 - r / max);
  return (
    <div className="focus-plot">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Focus objective and throughput versus detector X position"
      >
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={x0}
              x2={x0 + pw}
              y1={y(t * max)}
              y2={y(t * max)}
              stroke="#2c3b42"
            />
            <text
              x={x0 - 8}
              y={y(t * max) + 3}
              textAnchor="end"
              className="axis-text"
            >
              {fmt(t * max, 2)}
            </text>
          </g>
        ))}
        <path
          d={samples
            .map(
              (s, i) =>
                `${i ? "L" : "M"}${x(s.position)},${y0 + ph * (1 - s.throughput)}`,
            )
            .join(" ")}
          stroke="#718391"
          strokeWidth="1"
          fill="none"
          strokeDasharray="4 4"
        />
        {samples.map((s, i) =>
          i > 0 && s.rms != null && samples[i - 1].rms != null ? (
            <line
              key={`l${i}`}
              x1={x(samples[i - 1].position)}
              y1={y(samples[i - 1].rms)}
              x2={x(s.position)}
              y2={y(s.rms)}
              stroke="#87d7bb"
              strokeWidth="2"
            />
          ) : null,
        )}
        {valid.map((s) => (
          <circle
            key={s.position}
            cx={x(s.position)}
            cy={y(s.rms)}
            r="3"
            fill={scan.best?.position === s.position ? "#e9d290" : "#8cd8bf"}
            className="spot-hit"
            onClick={() => onPosition(s.position)}
          >
            <title>
              X {fmt(s.position)} mm, RMS {fmt(s.rms)} mm, throughput{" "}
              {fmt(s.throughput * 100, 1)}%
            </title>
          </circle>
        ))}
        {[lo, (hi + lo) / 2, hi].map((p) => (
          <text
            key={p}
            x={x(p)}
            y={h - 10}
            textAnchor="middle"
            className="axis-text"
          >
            {fmt(p, 1)} mm
          </text>
        ))}
        <text x={x0} y="11" className="axis-text">
          RMS (mm)
        </text>
        <text x={x0 + pw} y="11" textAnchor="end" className="axis-text">
          throughput 0–100% - -
        </text>
        {!valid.length && (
          <text x={w / 2} y={h / 2} textAnchor="middle" fill="#acbbc0">
            No valid detector hits in this interval
          </text>
        )}
      </svg>
    </div>
  );
}

export function RayInspector({ ray, project, onChoose, rays }) {
  const vec = (v) => (v ? v.map((n) => fmt(n, 5)).join(", ") : "terminated");
  const medium = (id) =>
    id
      ? project.elements.find((e) => e.id === id)?.name || id
      : "Air / ambient";
  return (
    <div className="ray-inspector">
      <div className="ray-picker">
        <select
          aria-label="Inspect ray"
          value={ray?.id || ""}
          onChange={(e) => onChoose(e.target.value)}
        >
          <option value="">Select a computed ray</option>
          {rays.slice(0, 1500).map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} · {r.wavelength} nm · {r.termination}
            </option>
          ))}
        </select>
        {ray && (
          <>
            <span>{ray.wavelength} nm</span>
            <span>Object point {ray.objectPointId}</span>
            <b className={`termination ${ray.termination}`}>
              {ray.termination}
            </b>
          </>
        )}
      </div>
      {ray ? (
        <div className="hit-table-wrap">
          <table className="hit-table">
            <thead>
              <tr>
                <th>Hit / surface</th>
                <th>Position XYZ · mm</th>
                <th>Normal / incoming → outgoing</th>
                <th>Medium transition</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {ray.hits.map((h, i) => (
                <tr key={i}>
                  <td>
                    <b>{String(i + 1).padStart(2, "0")}</b>{" "}
                    {project.elements.find((e) => e.id === h.elementId)?.name}
                    <small>{h.surface}</small>
                  </td>
                  <td className="mono">{vec(h.position)}</td>
                  <td className="mono">
                    <small>N [{vec(h.normal)}]</small>
                    <small>in [{vec(h.incoming)}]</small>
                    <small>out [{vec(h.outgoing)}]</small>
                  </td>
                  <td>
                    {medium(h.mediumBefore)} → {medium(h.mediumAfter)}
                    <small className="mono">
                      n₁ {fmt(h.n1, 6)} / n₂ {fmt(h.n2, 6)}
                    </small>
                  </td>
                  <td>
                    <span className="event-badge">{h.event}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ray.hits.length && (
            <p className="empty-note">
              No forward surface intersections. The ray escaped the finite
              system.
            </p>
          )}
        </div>
      ) : (
        <div className="empty-note">
          Click a ray on the bench or a detector hit to inspect its complete
          optical path, surface normals, and media.
        </div>
      )}
    </div>
  );
}
