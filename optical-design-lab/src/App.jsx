import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import Bench, { spectralColor } from "./Bench.jsx";
import { FocusPlot, RayInspector, SpotDiagram, fmt } from "./Measurements.jsx";
import { createElement, createProject, EXAMPLES } from "./examples.js";
import { refractiveIndex, validateProject } from "./optics.js";

const Scene3D = lazy(() => import("./Scene3D.jsx"));
const clone = (p) => structuredClone(p);
const TYPE_LABEL = {
  source: "Light source",
  lens: "Spherical lens",
  slab: "Glass slab",
  prism: "Prism",
  mirror: "Mirror",
  stop: "Aperture stop",
  detector: "Detector",
};

function Icon({ name, size = 18, ...props }) {
  const paths = {
    lens: (
      <>
        <path d="M12 3C5 7 5 17 12 21C19 17 19 7 12 3Z" />
        <path d="M2 12H22" opacity=".35" />
      </>
    ),
    source: (
      <>
        <circle cx="9" cy="12" r="2" />
        <path d="M13 12H22M12 8L21 3M12 16L21 21M3 12H1M6 7L4 4M6 17L4 20" />
      </>
    ),
    mirror: (
      <>
        <path d="M13 3V21M13 3L18 7M13 8L18 12M13 13L18 17M13 18L16 21M2 5L12 12L2 19" />
      </>
    ),
    slab: (
      <>
        <rect x="8" y="3" width="8" height="18" rx="1" />
        <path d="M2 12H22" opacity=".35" />
      </>
    ),
    prism: (
      <>
        <path d="M12 3L22 20H2Z" />
        <path d="M2 12H8L19 16" opacity=".5" />
      </>
    ),
    stop: (
      <>
        <path d="M8 2V8H16V2M8 22V16H16V22M3 12H21" />
      </>
    ),
    detector: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="1" />
        <path d="M9 3V21M5 8H19M5 16H19" opacity=".5" />
      </>
    ),
    undo: (
      <>
        <path d="M8 5L3 10L8 15M3 10H14A6 6 0 010 12" />
      </>
    ),
    redo: (
      <>
        <path d="M16 5L21 10L16 15M21 10H10A6 6 0 000 12" />
      </>
    ),
    arrow: <path d="M5 3L6 19L10 14L14 21L17 19L13 12L20 11Z" />,
    pan: (
      <>
        <path d="M5 11V8A2 2 0 019 8V4A2 2 0 0113 4V8A2 2 0 0117 8V10A2 2 0 0121 10V15C21 22 10 24 6 18L2 13A2 2 0 015 11Z" />
      </>
    ),
    fit: (
      <>
        <path d="M3 9V3H9M15 3H21V9M21 15V21H15M9 21H3V15" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    plus: <path d="M12 5V19M5 12H19" />,
    chevron: <path d="M6 9L12 15L18 9" />,
    download: (
      <>
        <path d="M12 3V15M7 10L12 15L17 10M4 16V21H20V16" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4M7 9L12 4L17 9M4 16V21H20V16" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6H21M9 6V3H15V6M5 6L6 21H18L19 6M10 10V17M14 10V17" />
      </>
    ),
    play: <path d="M7 4L21 12L7 20Z" />,
    eye: (
      <>
        <path d="M2 12Q12 -2 22 12Q12 26 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    cube: (
      <>
        <path d="M12 2L22 7V17L12 22L2 17V7ZM2 7L12 12L22 7M12 12V22M12 2V12" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9H21M3 15H21M9 3V21M15 3V21" />
      </>
    ),
    spot: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="10" cy="10" r="1" />
        <path d="M14 8H14.1M8 14H8.1M15 14H15.1M12 16H12.1" />
      </>
    ),
    chart: (
      <>
        <path d="M3 3V21H22M5 5Q13 28 21 5" />
      </>
    ),
    close: <path d="M6 6L18 18M18 6L6 18" />,
    book: (
      <>
        <path d="M12 5C8 2 4 3 2 4V20C6 18 9 19 12 21C15 19 18 18 22 20V4C18 2 15 3 12 5ZM12 5V21" />
      </>
    ),
    check: <path d="M4 12L9 17L20 6" />,
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V3H3V16H8" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.lens}
    </svg>
  );
}

function NumberField({
  label,
  value,
  onChange,
  unit = "mm",
  step = "any",
  testId,
}) {
  const [raw, setRaw] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setRaw(String(value)), [value]);
  const finish = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setRaw(String(value));
      return;
    }
    const n = Number(raw);
    if (raw.trim() && Number.isFinite(n) && n !== value) onChange(n);
    setRaw(String(value));
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          data-testid={testId}
          type="number"
          step={step}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}

function TextField({ label, value, onChange }) {
  const [raw, setRaw] = useState(value);
  useEffect(() => setRaw(value), [value]);
  return (
    <label className="text-field">
      <span>{label}</span>
      <input
        aria-label={label}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          if (raw !== value) onChange(raw);
          setRaw(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

function Inspector({
  selected,
  project,
  editElement,
  editMaterial,
  onDelete,
  onDuplicate,
  selectedCount,
}) {
  const e = selected,
    set = (key, value) => editElement(e.id, { [key]: value });
  if (!e)
    return (
      <aside className="inspector">
        <div className="panel-heading">
          INSPECTOR <span>↗</span>
        </div>
        <div className="inspector-empty">
          <Icon name="arrow" size={34} />
          <h3>A place for precision.</h3>
          <p>
            Select an optical element to adjust its geometry, pose, and
            material.
          </p>
          <small>Shift + click to select multiple elements</small>
        </div>
        <div className="model-card">
          <span className="section-label">THE MODEL</span>
          <h4>Geometry, not guesswork.</h4>
          <p>
            Analytic surface intersections. Vector Snell refraction. Actual
            three-dimensional rays.
          </p>
          <span className="tiny-tag">AIR n = {project.ambient}</span>
        </div>
      </aside>
    );
  const material = project.materials.find((m) => m.id === e.materialId);
  const geometry =
    e.type === "lens"
      ? [
          ["thickness", "Center thickness"],
          ["radius1", "Front radius R1"],
          ["radius2", "Rear radius R2"],
          ["aperture", "Clear aperture"],
        ]
      : e.type === "slab"
        ? [
            ["thickness", "Thickness"],
            ["aperture", "Clear aperture"],
          ]
        : e.type === "prism"
          ? [
              ["size", "Prism length"],
              ["apex", "Apex angle", "°"],
              ["depth", "Prism depth"],
            ]
          : e.type === "mirror"
            ? [
                ["radius", "Signed radius"],
                ["aperture", "Clear aperture"],
              ]
            : e.type === "stop"
              ? [
                  ["aperture", "Opening diameter"],
                  ["diameter", "Outer diameter"],
                ]
              : e.type === "detector"
                ? [
                    ["width", "Detector width (u)"],
                    ["height", "Detector height (v)"],
                  ]
                : [];
  return (
    <aside className="inspector">
      <div className="panel-heading">
        INSPECTOR{" "}
        <span className="tiny-tag">
          {selectedCount > 1 ? `${selectedCount} selected` : "ELEMENT"}
        </span>
      </div>
      <div className="inspector-title">
        <div className={`element-icon ${e.type}`}>
          <Icon name={e.type} size={24} />
        </div>
        <div>
          <h3>{TYPE_LABEL[e.type]}</h3>
          <span>{e.id}</span>
        </div>
        <button
          className="icon-button danger"
          title="Delete selected (Delete)"
          aria-label="Delete selected"
          onClick={onDelete}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
      <div className="inspector-scroll">
        {selectedCount > 1 && (
          <p className="field-hint">
            Editing {e.name}. Dragging, nudging, duplication and deletion apply
            to all {selectedCount} selected elements.
          </p>
        )}
        <TextField
          label="Element name"
          value={e.name}
          onChange={(v) => set("name", v)}
        />
        <section className="inspector-section">
          <div className="section-title">
            TRANSFORM <span>WORLD SPACE</span>
          </div>
          <div className="triple-fields">
            {["X", "Y", "Z"].map((axis, i) => (
              <NumberField
                key={axis}
                label={`Position ${axis}`}
                value={e.position[i]}
                testId={`position-${axis}`}
                onChange={(v) =>
                  set(
                    "position",
                    e.position.map((n, j) => (i === j ? v : n)),
                  )
                }
              />
            ))}
          </div>
          <div className="triple-fields">
            {["X", "Y", "Z"].map((axis, i) => (
              <NumberField
                key={axis}
                label={`Rotation ${axis}`}
                value={e.rotation[i]}
                unit="°"
                onChange={(v) =>
                  set(
                    "rotation",
                    e.rotation.map((n, j) => (i === j ? v : n)),
                  )
                }
              />
            ))}
          </div>
        </section>
        {geometry.length > 0 && (
          <section className="inspector-section">
            <div className="section-title">
              GEOMETRY <Icon name={e.type} size={14} />
            </div>
            {e.type === "lens" && (
              <label className="select-field">
                <span>Lens configuration</span>
                <select
                  aria-label="Lens configuration"
                  value={
                    e.radius1 === 0 || e.radius2 === 0
                      ? "plano"
                      : e.radius1 > 0 && e.radius2 < 0
                        ? "convex"
                        : e.radius1 < 0 && e.radius2 > 0
                          ? "concave"
                          : "custom"
                  }
                  onChange={(ev) => {
                    const r = Math.max(
                      Math.abs(e.radius1),
                      Math.abs(e.radius2),
                      e.aperture,
                    );
                    const t = Math.max(
                      e.thickness,
                      2 *
                        (r - Math.sqrt(r * r - (e.aperture * e.aperture) / 4)) +
                        1,
                    );
                    editElement(
                      e.id,
                      ev.target.value === "convex"
                        ? { radius1: r, radius2: -r, thickness: t }
                        : ev.target.value === "concave"
                          ? { radius1: -r, radius2: r }
                          : ev.target.value === "plano"
                            ? { radius1: 0, radius2: -r, thickness: t }
                            : {},
                    );
                  }}
                >
                  <option value="convex">Biconvex</option>
                  <option value="concave">Biconcave</option>
                  <option value="plano">Plano-convex</option>
                  <option value="custom">Custom radii</option>
                </select>
              </label>
            )}
            {geometry.map(([key, label, unit]) => (
              <NumberField
                key={key}
                label={label}
                value={e[key]}
                unit={unit || "mm"}
                testId={`geometry-${key}`}
                onChange={(v) => set(key, v)}
              />
            ))}
            {(e.type === "lens" || e.type === "mirror") && (
              <p className="field-hint">
                R &gt; 0: center toward +X. R = 0: planar.
                <br />
                Apertures are diameters, not radii.
              </p>
            )}
            {e.type === "stop" && (
              <p className="field-hint">
                The opaque annulus blocks rays. Rays outside the finite outer
                edge pass around it.
              </p>
            )}
            {e.type === "detector" && (
              <p className="field-hint">
                Local u = Y, v = Z. Detected rays terminate on this finite
                plane.
              </p>
            )}
          </section>
        )}
        {e.type === "source" && (
          <section className="inspector-section">
            <div className="section-title">
              EMISSION <span>DETERMINISTIC</span>
            </div>
            <label className="select-field">
              <span>Source type</span>
              <select
                aria-label="Source type"
                value={e.kind}
                onChange={(ev) => set("kind", ev.target.value)}
              >
                <option value="point">Point source</option>
                <option value="collimated">Collimated beam</option>
                <option value="extended">Extended object · arrow</option>
              </select>
            </label>
            <NumberField
              label={
                e.kind === "collimated" ? "Beam radius" : "Angular half-spread"
              }
              value={e.kind === "collimated" ? e.beamRadius : e.spread}
              unit={e.kind === "collimated" ? "mm" : "°"}
              onChange={(v) =>
                set(e.kind === "collimated" ? "beamRadius" : "spread", v)
              }
            />
            {e.kind === "extended" && (
              <NumberField
                label="Object height"
                value={e.objectHeight}
                onChange={(v) => set("objectHeight", v)}
              />
            )}
            <NumberField
              label="Samples / point / wavelength"
              value={e.samples}
              unit="rays"
              step="1"
              testId="source-samples"
              onChange={(v) => set("samples", v)}
            />
            <TextField
              label="Wavelengths (nm, comma separated)"
              value={e.wavelengths.join(", ")}
              onChange={(v) =>
                set(
                  "wavelengths",
                  v.split(",").map((n) => Number(n.trim())),
                )
              }
            />
            <p className="field-hint">
              {e.samples *
                e.wavelengths.length *
                (e.kind === "extended" ? 7 : 1)}{" "}
              emitted rays. Identical geometry across wavelengths. Extended
              objects use 7 independent emitters.
            </p>
          </section>
        )}
        {material && (
          <section className="inspector-section">
            <div className="section-title">
              MATERIAL <span>CAUCHY MODEL</span>
            </div>
            <label className="select-field">
              <span>Optical glass</span>
              <select
                aria-label="Optical glass"
                value={e.materialId}
                onChange={(ev) => set("materialId", ev.target.value)}
              >
                {project.materials.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="material-index">
              <span>n at 550 nm</span>
              <strong>{fmt(refractiveIndex(material, 550), 5)}</strong>
            </div>
            <NumberField
              label="Cauchy A"
              value={material.A}
              unit=""
              onChange={(v) => editMaterial(material.id, { A: v })}
            />
            <NumberField
              label="Cauchy B"
              value={material.B}
              unit="µm²"
              testId="cauchy-B"
              onChange={(v) => editMaterial(material.id, { B: v })}
            />
            <p className="field-hint">
              n(λ) = A + B / λ², λ in µm.
              <br />
              Set B = 0 for a constant index. Changes affect every element using
              this material.
            </p>
          </section>
        )}
        <button className="outline-button full-width" onClick={onDuplicate}>
          <Icon name="copy" size={14} /> Duplicate selected <kbd>⌘D</kbd>
        </button>
        <div className="inspector-footnote">
          <Icon name="check" size={12} /> Geometry validated before tracing
        </div>
      </div>
    </aside>
  );
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
function measurementCSV(result) {
  const rows = [
    [
      "record",
      "ray_id",
      "source_id",
      "object_point_id",
      "wavelength_nm",
      "termination",
      "element_id",
      "surface",
      "hit_index",
      "x_mm",
      "y_mm",
      "z_mm",
      "u_mm",
      "v_mm",
      "normal_x",
      "normal_y",
      "normal_z",
      "incoming_x",
      "incoming_y",
      "incoming_z",
      "outgoing_x",
      "outgoing_y",
      "outgoing_z",
      "n_incident",
      "n_transmitted",
      "medium_before",
      "medium_after",
      "event",
    ],
  ];
  for (const r of result.rays) {
    if (!r.hits.length)
      rows.push([
        "ray",
        r.id,
        r.sourceId,
        r.objectPointId,
        r.wavelength,
        r.termination,
      ]);
    r.hits.forEach((h, i) =>
      rows.push([
        "hit",
        r.id,
        r.sourceId,
        r.objectPointId,
        r.wavelength,
        r.termination,
        h.elementId,
        h.surface,
        i + 1,
        ...h.position,
        ...(h.event === "detect" ? r.detectorUV : ["", ""]),
        ...h.normal,
        ...h.incoming,
        ...(h.outgoing || ["", "", ""]),
        h.n1,
        h.n2,
        h.mediumBefore || "ambient",
        h.mediumAfter || "ambient",
        h.event,
      ]),
    );
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export default function App() {
  const [history, setHistory] = useState({
    past: [],
    present: createProject(),
    future: [],
  });
  const [preview, setPreview] = useState(null),
    project = preview || history.present;
  const [selectedIds, setSelectedIds] = useState(["lens-0"]);
  const [selectedRayId, setSelectedRayId] = useState(null);
  const [result, setResult] = useState(null),
    [scan, setScan] = useState(null),
    [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null),
    [view, setView] = useState("bench"),
    [analysis, setAnalysis] = useState("spot");
  const [tool, setTool] = useState("select"),
    [fitKey, setFitKey] = useState(0),
    [showRays, setShowRays] = useState(true);
  const [palette, setPalette] = useState("elements"),
    [examplesOpen, setExamplesOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false);
  const [exampleId, setExampleId] = useState("showcase"),
    [mobilePanel, setMobilePanel] = useState("bench");
  const [activeWaves, setActiveWaves] = useState(null),
    [groupMode, setGroupMode] = useState("wavelength");
  const [detectorId, writeDetectorId] = useState("detector-0");
  const [range, writeRange] = useState({ start: 65, end: 110, steps: 21 });
  const [traceKey, setTraceKey] = useState(0);
  const workerRef = useRef(null),
    focusRef = useRef(null),
    traceTimerRef = useRef(null),
    generation = useRef(0),
    focusGeneration = useRef(0),
    fileRef = useRef(null),
    idCounter = useRef(100);
  const selected = project.elements.find((e) => e.id === selectedIds[0]);
  const detectors = project.elements.filter((e) => e.type === "detector"),
    detector = detectors.find((e) => e.id === detectorId) || detectors[0];
  const metric = result?.metrics.find((m) => m.detectorId === detector?.id);
  const ray = result?.rays.find((r) => r.id === selectedRayId);
  const waves = [
    ...new Set(
      project.elements
        .filter((e) => e.type === "source")
        .flatMap((e) => e.wavelengths),
    ),
  ].sort((a, b) => a - b);
  const valid = validateProject(project);
  const invalidate = () => {
    generation.current++;
    clearTimeout(traceTimerRef.current);
    workerRef.current?.terminate();
    focusRef.current?.terminate();
    setResult(null);
    setScan(null);
    setBusy(null);
  };
  const invalidateFocus = () => {
    focusGeneration.current++;
    focusRef.current?.terminate();
    setScan(null);
    setBusy((value) => (value === "focus" ? null : value));
  };
  const setRange = (value) => {
    invalidateFocus();
    writeRange(value);
  };
  const setDetectorId = (value) => {
    invalidateFocus();
    writeDetectorId(value);
  };
  const commit = (next) => {
    const check = validateProject(next);
    if (!check.valid) {
      setNotice({
        kind: "error",
        text: `Edit rejected. ${check.errors.join(" ")}`,
      });
      setPreview(null);
      return false;
    }
    if (JSON.stringify(next) === JSON.stringify(history.present)) {
      if (preview) setTraceKey((k) => k + 1);
      setPreview(null);
      return true;
    }
    invalidate();
    setPreview(null);
    setSelectedRayId(null);
    setHistory((h) => ({
      past: [...h.past.slice(-99), h.present],
      present: next,
      future: [],
    }));
    return true;
  };
  const undo = () => {
    if (!history.past.length) return;
    invalidate();
    setPreview(null);
    setSelectedRayId(null);
    setHistory((h) => ({
      past: h.past.slice(0, -1),
      present: h.past.at(-1),
      future: [h.present, ...h.future],
    }));
  };
  const redo = () => {
    if (!history.future.length) return;
    invalidate();
    setPreview(null);
    setSelectedRayId(null);
    setHistory((h) => ({
      past: [...h.past, h.present],
      present: h.future[0],
      future: h.future.slice(1),
    }));
  };
  const editElement = (id, changes) => {
    const next = clone(history.present);
    Object.assign(
      next.elements.find((e) => e.id === id),
      changes,
    );
    commit(next);
  };
  const editMaterial = (id, changes) => {
    const next = clone(history.present);
    Object.assign(
      next.materials.find((m) => m.id === id),
      changes,
    );
    commit(next);
  };
  const remove = () => {
    if (!selectedIds.length) return;
    const next = clone(history.present);
    next.elements = next.elements.filter((e) => !selectedIds.includes(e.id));
    if (commit(next)) setSelectedIds([]);
  };
  const duplicate = () => {
    const next = clone(history.present),
      ids = [];
    for (const e of next.elements.filter((e) => selectedIds.includes(e.id))) {
      const copy = clone(e);
      copy.id = `${e.type}-${Date.now()}-${idCounter.current++}`;
      copy.name += " copy";
      copy.position[1] += (e.aperture || e.depth || e.width || 30) + 10;
      ids.push(copy.id);
      next.elements.push(copy);
    }
    if (ids.length && commit(next)) setSelectedIds(ids);
  };
  const addElement = (type) => {
    const next = clone(history.present),
      e = createElement(type, idCounter.current++);
    e.id += `-${Date.now()}`;
    if (["lens", "slab", "prism"].includes(type)) {
      const solids = next.elements.filter((n) =>
        ["lens", "slab", "prism"].includes(n.type),
      );
      if (solids.length)
        e.position[0] =
          Math.max(
            ...solids.map(
              (n) => n.position[0] + (n.thickness || n.size || 20) / 2,
            ),
          ) +
          (e.thickness || e.size || 20) / 2 +
          20;
    }
    if (
      ["lens", "slab", "prism"].includes(type) &&
      !next.materials.find((m) => m.id === e.materialId)
    )
      e.materialId = next.materials[0]?.id;
    next.elements.push(e);
    if (commit(next)) {
      setSelectedIds([e.id]);
      setFitKey((k) => k + 1);
      setNotice({
        kind: "success",
        text: `${TYPE_LABEL[type]} added to the bench.`,
      });
    }
  };
  const selectRay = (id) => {
    setSelectedRayId(id);
    setAnalysis("ray");
  };
  const loadExample = (example) => {
    if (commit(clone(example.project))) {
      setExampleId(example.id);
      setSelectedIds(
        [
          example.project.elements.find(
            (e) =>
              e.type === "lens" ||
              e.type === "prism" ||
              e.type === "slab" ||
              e.type === "mirror",
          )?.id,
        ].filter(Boolean),
      );
      setActiveWaves(null);
      setFitKey((k) => k + 1);
      setExamplesOpen(false);
      const d = example.project.elements.find((e) => e.type === "detector");
      if (d) {
        setDetectorId(d.id);
        setRange({
          start: d.position[0] - 20,
          end: d.position[0] + 20,
          steps: 21,
        });
      }
    }
  };
  useEffect(() => {
    const current = ++generation.current;
    workerRef.current?.terminate();
    focusRef.current?.terminate();
    setResult(null);
    setScan(null);
    setBusy("trace");
    const timer = (traceTimerRef.current = setTimeout(() => {
      const worker = new Worker(new URL("./trace.worker.js", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      worker.onmessage = ({ data }) => {
        if (data.id !== generation.current) return;
        setBusy(null);
        if (data.error) setNotice({ kind: "error", text: data.error });
        else setResult(data.result);
        worker.terminate();
      };
      worker.onerror = (e) => {
        if (current === generation.current) {
          setBusy(null);
          setNotice({ kind: "error", text: `Trace failed: ${e.message}` });
        }
        worker.terminate();
      };
      worker.postMessage({
        id: current,
        type: "trace",
        project: history.present,
      });
    }, 100));
    return () => {
      clearTimeout(timer);
      workerRef.current?.terminate();
      focusRef.current?.terminate();
    };
  }, [history.present, traceKey]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => setNotice(null),
      notice.kind === "error" ? 16000 : 4500,
    );
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const keydown = (e) => {
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
        e.target.isContentEditable
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(project.elements.map((e) => e.id));
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key.toLowerCase() === "f") setFitKey((k) => k + 1);
      else if (e.key === " ") {
        e.preventDefault();
        setTool("pan");
      } else if (e.key === "Escape") {
        setSelectedIds([]);
        setSelectedRayId(null);
        setHelpOpen(false);
        setExamplesOpen(false);
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
        selectedIds.length
      ) {
        e.preventDefault();
        const next = clone(history.present),
          amount = e.shiftKey ? 10 : 1;
        next.elements.forEach((el) => {
          if (selectedIds.includes(el.id))
            el.position[e.key === "ArrowUp" || e.key === "ArrowDown" ? 1 : 0] +=
              amount *
              (e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 1);
        });
        commit(next);
      }
    };
    const keyup = (e) => {
      if (e.key === " ") setTool("select");
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  });
  const scanFocus = () => {
    if (!detector || !result) return;
    if (
      !(range.end > range.start) ||
      !Number.isInteger(range.steps) ||
      range.steps < 2 ||
      range.steps > 101
    )
      return setNotice({
        kind: "error",
        text: "Focus scan requires end > start and 2–101 positions.",
      });
    focusRef.current?.terminate();
    const worker = new Worker(new URL("./trace.worker.js", import.meta.url), {
      type: "module",
    });
    focusRef.current = worker;
    const id = generation.current,
      focusId = ++focusGeneration.current;
    setBusy("focus");
    setScan(null);
    worker.onmessage = ({ data }) => {
      if (id !== generation.current || focusId !== focusGeneration.current)
        return;
      setBusy(null);
      if (data.error) setNotice({ kind: "error", text: data.error });
      else setScan(data.result);
      worker.terminate();
    };
    worker.onerror = (e) => {
      if (id === generation.current && focusId === focusGeneration.current) {
        setBusy(null);
        setNotice({ kind: "error", text: e.message });
      }
      worker.terminate();
    };
    worker.postMessage({
      id,
      type: "focus",
      project: history.present,
      detectorId: detector.id,
      range,
    });
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Project file exceeds 10 MB.");
      const next = JSON.parse(await file.text()),
        check = validateProject(next);
      if (!check.valid) throw new Error(check.errors.join(" "));
      if (commit(next)) {
        setSelectedIds([]);
        setActiveWaves(null);
        setFitKey((k) => k + 1);
        setNotice({
          kind: "success",
          text: "Project imported and retraced. Import can be undone.",
        });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Import rejected. Current project unchanged. ${error.message}`,
      });
    }
  };
  const cancel = () => {
    generation.current++;
    clearTimeout(traceTimerRef.current);
    workerRef.current?.terminate();
    focusRef.current?.terminate();
    setBusy(null);
    setNotice({
      kind: "success",
      text: "Calculation cancelled. Retrace to compute current measurements.",
    });
  };
  const throughput =
    result && metric ? metric.count / (result.count || 1) : null;
  const groups = metric?.groups || [];
  const extended = project.elements.find(
    (e) => e.type === "source" && e.kind === "extended",
  );
  const endGroups = extended
    ? [0, 4].map((index) =>
        groups.filter(
          (g) =>
            g.sourceId === extended.id &&
            String(g.objectPointId) === String(index),
        ),
      )
    : [];
  const meanU = (gs) =>
    gs.reduce((s, g) => s + g.centroid[0] * g.count, 0) /
    gs.reduce((s, g) => s + g.count, 0);
  const magnification =
    endGroups.length && endGroups.every((g) => g.length)
      ? (meanU(endGroups[1]) - meanU(endGroups[0])) / extended.objectHeight
      : null;
  const example = EXAMPLES.find((e) => e.id === exampleId);
  return (
    <div className={`app mobile-${mobilePanel}`}>
      <header className="app-header">
        <a className="brand" href="./" aria-label="Lumen home">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <strong>
            lumen<span>®</span>
          </strong>
          <div className="brand-divider" />
          <span className="brand-subtitle">
            OPTICAL DESIGN
            <br />
            LABORATORY
          </span>
        </a>
        <div className="header-center">
          <span className="live-dot" /> LOCAL WORKSPACE{" "}
          <span className="header-slash">/</span>{" "}
          <span>Untitled optical system</span>
        </div>
        <div className="header-actions">
          <button className="help-button" onClick={() => setHelpOpen(true)}>
            <Icon name="book" size={16} />
            <span>Field guide</span>
          </button>
          <button
            className="outline-button import-button"
            onClick={() => fileRef.current.click()}
          >
            <Icon name="upload" size={14} />
            <span>Import</span>
          </button>
          <button
            className="primary-button export-project"
            onClick={() =>
              download(
                "lumen-project.json",
                JSON.stringify(history.present, null, 2),
                "application/json",
              )
            }
          >
            <Icon name="download" size={14} />
            <span>Export project</span>
          </button>
        </div>
      </header>
      <div className="mobile-tabs">
        <button
          className={mobilePanel === "library" ? "active" : ""}
          onClick={() => setMobilePanel("library")}
        >
          Library
        </button>
        <button
          className={mobilePanel === "bench" ? "active" : ""}
          onClick={() => setMobilePanel("bench")}
        >
          Workspace
        </button>
        <button
          className={mobilePanel === "inspector" ? "active" : ""}
          onClick={() => setMobilePanel("inspector")}
        >
          Inspector
        </button>
      </div>
      <main className="workspace">
        <aside className="library">
          <div className="panel-heading">
            OPTICAL WORKSPACE <span className="version">v1.0</span>
          </div>
          <div className="library-intro">
            <h1>Light, understood.</h1>
            <p>Build. Trace. Discover.</p>
          </div>
          <div className="example-control">
            <span className="section-label">START WITH A SYSTEM</span>
            <button
              className="example-trigger"
              onClick={() => setExamplesOpen(!examplesOpen)}
              aria-expanded={examplesOpen}
            >
              <Icon name="lens" />
              <span>{example?.name || "Custom system"}</span>
              <Icon name="chevron" size={14} />
            </button>
            {examplesOpen && (
              <div className="examples-menu">
                {EXAMPLES.map((e, i) => (
                  <button
                    key={e.id}
                    data-testid={`example-${e.id}`}
                    className={exampleId === e.id ? "active" : ""}
                    onClick={() => loadExample(e)}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{e.name}</strong>
                      <small>{e.description}</small>
                    </div>
                    {exampleId === e.id && <Icon name="check" size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="palette-tabs">
            <button
              className={palette === "elements" ? "active" : ""}
              onClick={() => setPalette("elements")}
            >
              Elements
            </button>
            <button
              className={palette === "materials" ? "active" : ""}
              onClick={() => setPalette("materials")}
            >
              Materials
            </button>
          </div>
          {palette === "elements" ? (
            <div className="element-palette">
              <div className="section-label">
                ADD TO BENCH <span>+</span>
              </div>
              {Object.entries(TYPE_LABEL).map(([type, label]) => (
                <button
                  className="palette-item"
                  key={type}
                  onClick={() => addElement(type)}
                  data-testid={`add-${type}`}
                >
                  <span className={`palette-icon ${type}`}>
                    <Icon name={type} />
                  </span>
                  <span>
                    {label}
                    <small>
                      {type === "source"
                        ? "Point · beam · extended"
                        : type === "lens"
                          ? "Thick · spherical · planar"
                          : type === "mirror"
                            ? "Planar · spherical"
                            : type === "detector"
                              ? "Image & spot measurement"
                              : type === "stop"
                                ? "Finite circular opening"
                                : type === "prism"
                                  ? "Triangular · dispersive"
                                  : "Plane-parallel glass"}
                    </small>
                  </span>
                  <Icon name="plus" size={13} />
                </button>
              ))}
            </div>
          ) : (
            <div className="material-palette">
              <p className="field-hint">
                Select a refractive element to assign a glass and edit its
                dispersion model.
              </p>
              {project.materials.map((m) => (
                <div className="material-card" key={m.id}>
                  <span className="glass-swatch" />
                  <div>
                    <strong>{m.name}</strong>
                    <small>n₅₅₀ = {fmt(refractiveIndex(m, 550), 5)}</small>
                    <small>
                      A {m.A} · B {m.B} µm²
                    </small>
                  </div>
                </div>
              ))}
              <NumberField
                label="Ambient index"
                unit=""
                value={project.ambient}
                onChange={(v) =>
                  commit({ ...clone(history.present), ambient: v })
                }
              />
              <button
                className="outline-button full-width"
                onClick={() => {
                  const next = clone(history.present);
                  next.materials.push({
                    id: `material-${Date.now()}`,
                    name: `Custom glass ${next.materials.length - 1}`,
                    A: 1.5,
                    B: 0,
                  });
                  commit(next);
                }}
              >
                + Add constant-index glass
              </button>
            </div>
          )}
          <div className="system-list">
            <div className="section-label">
              ON THE BENCH{" "}
              <span>{project.elements.length.toString().padStart(2, "0")}</span>
            </div>
            {project.elements.map((e, i) => (
              <button
                key={e.id}
                className={`system-item ${selectedIds.includes(e.id) ? "selected" : ""}`}
                onClick={(ev) =>
                  setSelectedIds(
                    ev.shiftKey
                      ? selectedIds.includes(e.id)
                        ? selectedIds.filter((id) => id !== e.id)
                        : [...selectedIds, e.id]
                      : [e.id],
                  )
                }
                data-testid={`select-${e.id}`}
              >
                <span className="element-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Icon name={e.type} size={15} />
                <span>{e.name}</span>
                <span className="element-state" />
              </button>
            ))}
            {!project.elements.length && (
              <p className="field-hint">
                Your bench is empty. Add a source and an optical element to
                begin.
              </p>
            )}
          </div>
          <div className="library-footer">
            <span className="live-dot" />
            <div>
              All computation stays here.
              <small>No cloud. No credentials.</small>
            </div>
            <Icon name="cube" size={20} />
          </div>
        </aside>
        <section className="center-workspace">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">
                EXPERIMENT{" "}
                {String(
                  EXAMPLES.findIndex((e) => e.id === exampleId) + 1,
                ).padStart(2, "0")}{" "}
                <span>/ GEOMETRIC OPTICS</span>
              </div>
              <h2>{example?.name || "Optical workbench"}</h2>
            </div>
            <div className="workspace-heading-actions">
              <button
                className="icon-button"
                title="Undo (Ctrl/Cmd Z)"
                aria-label="Undo"
                disabled={!history.past.length}
                onClick={undo}
              >
                <Icon name="undo" />
              </button>
              <button
                className="icon-button"
                title="Redo (Ctrl/Cmd Shift Z)"
                aria-label="Redo"
                disabled={!history.future.length}
                onClick={redo}
              >
                <Icon name="redo" />
              </button>
              <div className="vertical-divider" />
              <button
                className="outline-button compact"
                onClick={() => {
                  if (commit({ ...clone(history.present), elements: [] }))
                    setSelectedIds([]);
                }}
                aria-label="Clear bench"
              >
                New bench <Icon name="plus" size={14} />
              </button>
            </div>
          </div>
          <div className="bench-toolbar">
            <div className="view-tabs">
              {[
                ["bench", "grid", "2D bench"],
                ["3d", "cube", "3D scene"],
                ["spot", "spot", "Detector"],
              ].map(([key, icon, label]) => (
                <button
                  key={key}
                  className={view === key ? "active" : ""}
                  onClick={() => setView(key)}
                >
                  <Icon name={icon} size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="bench-tools">
              <button
                className={`icon-button ${tool === "select" ? "active" : ""}`}
                title="Select and drag"
                aria-label="Select tool"
                onClick={() => setTool("select")}
              >
                <Icon name="arrow" size={15} />
              </button>
              <button
                className={`icon-button ${tool === "pan" ? "active" : ""}`}
                title="Pan (hold Space)"
                aria-label="Pan tool"
                onClick={() => setTool("pan")}
              >
                <Icon name="pan" size={15} />
              </button>
              <div className="vertical-divider" />
              <button
                className="icon-button"
                title="Fit system (F)"
                aria-label="Fit system"
                onClick={() => setFitKey((k) => k + 1)}
              >
                <Icon name="fit" size={16} />
              </button>
              <button
                className={`icon-button ${showRays ? "active subtle" : ""}`}
                title="Toggle ray paths"
                aria-label="Toggle ray paths"
                aria-pressed={showRays}
                onClick={() => setShowRays(!showRays)}
              >
                <Icon name="eye" size={16} />
              </button>
            </div>
          </div>
          <div className={`view-container ${preview ? "preview" : ""}`}>
            {view === "bench" && (
              <Bench
                project={project}
                result={preview ? null : result}
                selectedIds={selectedIds}
                selectedRayId={selectedRayId}
                onSelect={setSelectedIds}
                onRaySelect={selectRay}
                onPreview={(next) => {
                  if (!preview) invalidate();
                  setPreview(next);
                }}
                onMove={(next) => {
                  if (!commit(next)) setTraceKey((k) => k + 1);
                }}
                fitKey={fitKey}
                tool={tool}
                wavelengths={activeWaves}
                showRays={showRays}
              />
            )}
            {view === "3d" && (
              <Suspense
                fallback={
                  <div className="loading-scene">
                    Loading local 3D renderer…
                  </div>
                }
              >
                <Scene3D
                  project={project}
                  result={result}
                  selectedIds={selectedIds}
                  selectedRayId={selectedRayId}
                  onSelect={(id, ev) =>
                    setSelectedIds(
                      ev?.shiftKey
                        ? selectedIds.includes(id)
                          ? selectedIds.filter((value) => value !== id)
                          : [...selectedIds, id]
                        : [id],
                    )
                  }
                  onRaySelect={selectRay}
                  wavelengths={activeWaves}
                  showRays={showRays}
                  fitKey={fitKey}
                />
              </Suspense>
            )}
            {view === "spot" && (
              <>
                <div className="detector-view-heading">
                  <span className="section-label">
                    DETECTOR PLANE / LOCAL UV
                  </span>
                  <span>{detector?.name || "No detector"}</span>
                </div>
                <SpotDiagram
                  spots={result?.spots || []}
                  metric={metric}
                  detector={detector}
                  wavelengths={activeWaves}
                  selectedRayId={selectedRayId}
                  onRaySelect={selectRay}
                  large
                  groupMode={groupMode}
                />
              </>
            )}
            {preview && (
              <div className={`preview-label ${!valid.valid ? "invalid" : ""}`}>
                {valid.valid
                  ? "Position preview · release to trace"
                  : "Invalid geometry · release to reject"}
              </div>
            )}
            {!result && !busy && !preview && (
              <button
                className="retrace-overlay outline-button"
                onClick={() => setTraceKey((k) => k + 1)}
              >
                <Icon name="play" size={14} /> Measurements invalid · retrace
              </button>
            )}
          </div>
          <div className="spectrum-bar">
            <div className="spectrum-label">
              <span className="section-label">WAVELENGTHS</span>
              <span className="spectrum-divider" />
              {waves.map((w) => (
                <button
                  key={w}
                  aria-label={`Toggle ${w} nm`}
                  aria-pressed={!activeWaves || activeWaves.includes(w)}
                  className={`wave-chip ${activeWaves && !activeWaves.includes(w) ? "muted" : ""}`}
                  onClick={() => {
                    const current = activeWaves || waves;
                    setActiveWaves(
                      current.includes(w)
                        ? current.filter((n) => n !== w)
                        : [...current, w],
                    );
                  }}
                >
                  <span style={{ background: spectralColor(w) }} />
                  {w}
                  <small>nm</small>
                </button>
              ))}
            </div>
            <span className="spectrum-note">
              Same rays. Different refraction.
            </span>
          </div>
          <section className="analysis-panel">
            <div className="analysis-toolbar">
              <div className="analysis-tabs">
                {[
                  ["spot", "spot", "Spot diagram"],
                  ["focus", "chart", "Focus scan"],
                  ["ray", "source", "Ray inspector"],
                ].map(([key, icon, label]) => (
                  <button
                    key={key}
                    className={analysis === key ? "active" : ""}
                    onClick={() => setAnalysis(key)}
                  >
                    <Icon name={icon} size={14} />
                    <span>{label}</span>
                    {key === "ray" && selectedRayId && (
                      <span className="tab-dot" />
                    )}
                  </button>
                ))}
              </div>
              <button
                className="csv-button"
                disabled={!result}
                onClick={() =>
                  download(
                    "lumen-ray-hits.csv",
                    measurementCSV(result),
                    "text/csv",
                  )
                }
              >
                <Icon name="download" size={13} />
                <span>Export CSV</span>
              </button>
            </div>
            {analysis !== "ray" && (
              <div className="measurement-selector">
                <label>
                  SCREEN{" "}
                  <select
                    aria-label="Measurement detector"
                    value={detector?.id || ""}
                    onChange={(e) => {
                      setDetectorId(e.target.value);
                      setScan(null);
                    }}
                  >
                    {!detectors.length && <option value="">No detector</option>}
                    {detectors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                {analysis === "spot" ? (
                  <label>
                    COLOR BY{" "}
                    <select
                      aria-label="Spot grouping"
                      value={groupMode}
                      onChange={(e) => setGroupMode(e.target.value)}
                    >
                      <option value="wavelength">Wavelength</option>
                      <option value="object">Object point</option>
                    </select>
                  </label>
                ) : (
                  <span>Scan axis: global +X · fixed input population</span>
                )}
              </div>
            )}
            {analysis === "spot" && (
              <div className="spot-content">
                <SpotDiagram
                  spots={result?.spots || []}
                  metric={metric}
                  detector={detector}
                  wavelengths={activeWaves}
                  onRaySelect={selectRay}
                  selectedRayId={selectedRayId}
                  groupMode={groupMode}
                />
                <div className="spot-summary">
                  <div className="metric-grid">
                    <div>
                      <span>DETECTED RAYS</span>
                      <strong data-testid="hit-count">
                        {metric?.count.toLocaleString() ?? "—"}
                        <small>/ {result?.count.toLocaleString() ?? "—"}</small>
                      </strong>
                    </div>
                    <div>
                      <span>RMS SPOT RADIUS</span>
                      <strong data-testid="rms-value">
                        {fmt(metric?.rms)}
                        <small>mm</small>
                      </strong>
                    </div>
                    <div>
                      <span>CENTROID (u, v)</span>
                      <b className="mono">
                        {metric?.centroid
                          ? `${fmt(metric.centroid[0])}, ${fmt(metric.centroid[1])}`
                          : "No hits"}{" "}
                        <small>mm</small>
                      </b>
                    </div>
                    <div>
                      <span>THROUGHPUT</span>
                      <b className="mono">
                        {fmt(throughput == null ? null : throughput * 100, 1)}
                        <small>%</small>
                      </b>
                    </div>
                  </div>
                  <div className="image-note">
                    {magnification != null ? (
                      <>
                        <span className="live-dot" />
                        <strong>
                          {magnification < 0
                            ? "Inverted image"
                            : "Upright image"}
                        </strong>
                        <span>mᵤ = {fmt(magnification)}×</span>
                      </>
                    ) : (
                      <>
                        <span className="live-dot" />
                        {metric?.count
                          ? "Actual detector intersections"
                          : "No detected image"}
                      </>
                    )}
                  </div>
                  <div className="group-table-wrap">
                    <table className="group-table">
                      <thead>
                        <tr>
                          <th>Source / point</th>
                          <th>λ nm</th>
                          <th>Hits</th>
                          <th>Centroid u,v mm</th>
                          <th>RMS mm</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups
                          .filter(
                            (g) =>
                              !activeWaves ||
                              activeWaves.includes(g.wavelength),
                          )
                          .map((g, i) => (
                            <tr key={i}>
                              <td title={g.sourceId}>
                                {g.sourceId.split("-").slice(0, 2).join("-")} /{" "}
                                {g.objectPointId}
                              </td>
                              <td>
                                <span
                                  className="wavelength-dot"
                                  style={{
                                    background: spectralColor(g.wavelength),
                                  }}
                                />
                                {g.wavelength}
                              </td>
                              <td>{g.count}</td>
                              <td>
                                {fmt(g.centroid[0], 2)}, {fmt(g.centroid[1], 2)}
                              </td>
                              <td>{fmt(g.rms)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="summary-note">
                    Overall statistics include all wavelengths. RMS includes
                    object extent; focus uses within-point blur.
                  </p>
                </div>
              </div>
            )}
            {analysis === "focus" && (
              <div className="focus-content">
                <div className="focus-controls">
                  <div className="focus-inputs">
                    <NumberField
                      label="Start X"
                      value={range.start}
                      onChange={(v) => {
                        setScan(null);
                        setRange((r) => ({ ...r, start: v }));
                      }}
                    />
                    <NumberField
                      label="End X"
                      value={range.end}
                      onChange={(v) => {
                        setScan(null);
                        setRange((r) => ({ ...r, end: v }));
                      }}
                    />
                    <NumberField
                      label="Positions"
                      value={range.steps}
                      unit=""
                      step="1"
                      onChange={(v) => {
                        setScan(null);
                        setRange((r) => ({ ...r, steps: v }));
                      }}
                    />
                  </div>
                  <button
                    className="primary-button full-width"
                    disabled={!!busy || !detector || !result}
                    onClick={scanFocus}
                  >
                    <Icon name="play" size={13} />
                    {busy === "focus" ? "Scanning…" : "Scan focus"}
                  </button>
                  <p className="field-hint">
                    Minimize count-weighted within-point, within-wavelength RMS.
                    No throughput penalty: always compare hit counts.
                  </p>
                  {scan?.best && (
                    <button
                      className="best-focus"
                      onClick={() =>
                        editElement(detector.id, {
                          position: [
                            scan.best.position,
                            detector.position[1],
                            detector.position[2],
                          ],
                        })
                      }
                    >
                      <span>
                        APPLY SAMPLED MINIMUM <Icon name="arrow" size={12} />
                      </span>
                      <strong>
                        {fmt(scan.best.position, 2)} <small>mm</small>
                      </strong>
                      <small>
                        RMS {fmt(scan.best.rms)} mm · {scan.best.count} hits ·{" "}
                        {fmt(scan.best.throughput * 100, 1)}%
                      </small>
                    </button>
                  )}
                </div>
                <div className="focus-chart-area">
                  <FocusPlot
                    scan={scan}
                    onPosition={(x) =>
                      editElement(detector.id, {
                        position: [
                          x,
                          detector.position[1],
                          detector.position[2],
                        ],
                      })
                    }
                  />
                  {scan && (
                    <p className="summary-note">
                      {scan.best
                        ? `${scan.samples.length} positions · throughput ${fmt(Math.min(...scan.samples.map((s) => s.throughput)) * 100, 1)}–${fmt(Math.max(...scan.samples.map((s) => s.throughput)) * 100, 1)}%. ${scan.best.throughput < Math.max(...scan.samples.map((s) => s.throughput)) * 0.95 ? "Warning: minimum loses rays; do not interpret it as unqualified best focus." : "Compare both curves before choosing focus."}`
                        : "No valid hits. Expand the interval, resize the detector, or check its pose."}
                    </p>
                  )}
                  {scan && (
                    <details className="scan-data">
                      <summary>
                        Inspect {scan.samples.length} computed positions
                      </summary>
                      <table className="group-table">
                        <thead>
                          <tr>
                            <th>X mm</th>
                            <th>RMS mm</th>
                            <th>Hits</th>
                            <th>Throughput</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scan.samples.map((s) => (
                            <tr key={s.position}>
                              <td>{fmt(s.position)}</td>
                              <td>{fmt(s.rms, 6)}</td>
                              <td>{s.count}</td>
                              <td>{fmt(s.throughput * 100, 2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </div>
              </div>
            )}
            {analysis === "ray" && (
              <RayInspector
                ray={ray}
                project={project}
                onChoose={setSelectedRayId}
                rays={result?.rays || []}
              />
            )}
          </section>
          <div className="model-disclaimer">
            GEOMETRIC OPTICS ONLY{" "}
            <span>
              No diffraction, interference, polarization, scattering, or
              calibrated radiometry.
            </span>
            <button onClick={() => setHelpOpen(true)}>Model notes ↗</button>
          </div>
        </section>
        <Inspector
          selected={selected}
          selectedCount={selectedIds.length}
          project={project}
          editElement={editElement}
          editMaterial={editMaterial}
          onDelete={remove}
          onDuplicate={duplicate}
        />
      </main>
      <footer className="status-bar">
        <div className="trace-status">
          <span className={`live-dot ${busy ? "working" : ""}`} />
          {busy ? (
            <>
              <span>
                {busy === "focus"
                  ? "Scanning detector positions"
                  : "Tracing geometric rays"}
                …
              </span>
              <button onClick={cancel}>Cancel</button>
            </>
          ) : result ? (
            <>
              <strong>Trace complete</strong>
              <span className="status-separator">/</span>
              <span data-testid="ray-count">
                {result.count.toLocaleString()} rays
              </span>
              <span className="status-separator">/</span>
              <span data-testid="trace-duration">
                {fmt(result.duration, 1)} ms
              </span>
            </>
          ) : (
            <span>Measurements invalid</span>
          )}
        </div>
        <div className="termination-counts">
          {result &&
            Object.entries(result.terminations)
              .filter(([, n]) => n > 0)
              .map(([name, n]) => (
                <span key={name}>
                  <i className={name} />
                  {n.toLocaleString()} {name}
                </span>
              ))}
        </div>
        <div className="status-units">
          mm <span>·</span> degrees <span>·</span> nm <b>3D SOLVER</b>
        </div>
      </footer>
      {notice && (
        <div
          className={`toast ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <Icon name={notice.kind === "error" ? "close" : "check"} size={17} />
          <span>{notice.text}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        aria-label="Import project file"
        data-testid="import-file"
        className="file-input"
        onChange={importFile}
      />
      {helpOpen && (
        <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
          <section
            className="guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="guide-heading">
              <div>
                <span className="eyebrow">THE LUMEN FIELD GUIDE</span>
                <h2 id="guide-title">An honest model of light.</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close field guide"
                onClick={() => setHelpOpen(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="guide-body">
              <p>
                Lumen follows sampled geometric rays through actual finite
                optical surfaces. The 2D bench is an XY projection of a 3D
                calculation. Open the 3D scene to inspect off-axis paths.
              </p>
              <h3>Build & navigate</h3>
              <p>
                Click the palette to create elements. Select and drag to
                position; Shift-click or Shift-drag empty space to multiselect.
                Use the inspector for unrounded XYZ positions, XYZ rotations,
                dimensions, indices, and source sampling. Invalid edits are
                rejected without changing your system.
              </p>
              <div className="shortcut-grid">
                {[
                  ["Space + drag", "Pan bench"],
                  ["Scroll", "Zoom at cursor"],
                  ["F", "Fit system"],
                  ["Arrow keys", "Nudge 1 mm (Shift: 10)"],
                  ["Ctrl/Cmd Z", "Undo"],
                  ["Ctrl/Cmd Shift Z", "Redo"],
                  ["Ctrl/Cmd A", "Select all"],
                  ["Ctrl/Cmd D", "Duplicate"],
                  ["Delete", "Remove selected"],
                  ["Escape", "Clear selection"],
                ].map(([key, label]) => (
                  <div key={key}>
                    <kbd>{key}</kbd>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <h3>Geometry & materials</h3>
              <p>
                Positions and lengths are millimeters. Local +X is the optical
                axis. Rotations are degrees, applied X then Y then Z. Lens
                surface vertices are ± thickness/2. A positive radius has its
                center toward +X; zero means a plane. Clear apertures are
                diameters. Lens and slab cylindrical rims absorb. Prism
                triangular sides refract; its depth end caps absorb. Mirrors are
                finite and two-sided.
              </p>
              <p>
                Cauchy n(λ) = A + B / λ² with λ in micrometers and B in µm². Air
                defaults to n = 1. Set B = 0 for constant index. Transparent
                interfaces transmit; total internal reflection reflects and
                retains the current medium. Rays may start inside glass.
                Overlapping or touching refractive world bounding boxes are
                conservatively rejected, including some physically disjoint
                rotated configurations.
              </p>
              <h3>Measurements you can audit</h3>
              <p>
                Detector u = local Y; v = local Z. Every plotted hit comes from
                a traced ray, retaining source, object-point and wavelength
                identity. RMS is measured about the hit centroid. Focus moves
                the chosen detector along global X over an inclusive interval
                with identical input rays. It minimizes within-object-point,
                within-wavelength RMS, excluding object extent and centroid
                color separation. Compare throughput alongside blur; a smaller
                surviving population is not necessarily a better image. The
                reported arrow magnification is a signed u-axis estimate from
                endpoint centroids, not a general rotated-system magnification.
              </p>
              <p>
                Bench and 3D plots display representative paths for readability;
                measurements use the entire population. Click a path or spot for
                hit positions, outward surface normals, incoming/outgoing unit
                directions, indices and termination. Paths are bounded at 5,000
                mm and 64 interactions. Every edit invalidates results. Tracing
                runs in a cancellable local worker; stale jobs cannot replace a
                newer system.
              </p>
              <h3>Projects & verification</h3>
              <p>
                Export/import uses version 1 editable JSON, with mm units,
                stable IDs, materials, geometry and source sampling. Imports are
                fully validated before replacing the current project and can be
                undone. CSV exports every ray-hit record, physical coordinates
                and identities. Run <code>npm run verify</code> for independent
                numerical checks; see <code>VERIFICATION.md</code> for formulas
                and tolerances.
              </p>
              <div className="guide-warning">
                This is not wave optics. Diffraction, interference,
                polarization, scattering, Fresnel splitting and realistic
                radiometry are not modeled. Spot plots are sampled geometric
                distributions, never physically calibrated irradiance.
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
