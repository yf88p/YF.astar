import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Atom,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Compass,
  Copy,
  Droplets,
  Expand,
  FlaskConical,
  Gauge,
  Grid2X2,
  Hand,
  HelpCircle,
  Keyboard,
  Layers3,
  Menu,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Square,
  StepForward,
  Tag,
  Trash2,
  Wind,
  X,
  Zap,
} from "lucide-react";
import { PhysicsEngine, validateScene } from "./physics";
import { PRESETS } from "./presets";
import SimulationCanvas from "./SimulationCanvas";
import type {
  BodySnapshot,
  BodySpec,
  DisplayOptions,
  Environment,
  Metrics,
  SceneConfig,
  Tool,
  Vec2,
} from "./types";

const COLORS = ["#b8ef77", "#bba5f5", "#8dbdf3", "#efaa92", "#ead28a"];
const EMPTY_METRICS: Metrics = {
  time: 0,
  bodies: 12,
  dynamicBodies: 9,
  kineticEnergy: 0,
  potentialEnergy: 0,
  totalEnergy: 0,
  momentum: { x: 0, y: 0 },
  maxSpeed: 0,
};
const SCENE_DETAILS = [
  [
    "Motion, meet possibility.",
    "THE EVERYDAY EXTRAORDINARY",
    "Fall. Bounce. Roll. Repeat.",
  ],
  [
    "One push. A chain reaction.",
    "MOMENTUM & COLLISIONS",
    "Energy is better shared.",
  ],
  ["A universe in miniature.", "GRAVITATION & ORBITS", "Find your own orbit."],
  [
    "Everything finds a rhythm.",
    "ELASTICITY & OSCILLATION",
    "A study in give and take.",
  ],
  [
    "A different kind of balance.",
    "DENSITY & BUOYANCY",
    "Some float. Some sink.",
  ],
  [
    "Opposites have an attraction.",
    "ELECTRICITY & MAGNETISM",
    "A little positive energy.",
  ],
];

function format(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "0.00";
  return Math.abs(value) >= 100_000
    ? value.toExponential(2)
    : value.toFixed(digits);
}

function clock(time: number) {
  const minutes = Math.floor(time / 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${(time % 60).toFixed(2).padStart(5, "0")}`;
}

function IconButton({
  label,
  children,
  active,
  onClick,
  disabled,
  className = "",
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  icon,
  detail,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  icon?: ReactNode;
  detail?: string;
}) {
  return (
    <button
      className="toggle-row"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-label">
        {icon}
        <span>
          {label}
          {detail && <small>{detail}</small>}
        </span>
      </span>
      <span className={`switch ${checked ? "on" : ""}`}>
        <span />
      </span>
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = -1000,
  max = 1000,
  step = 0.1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const fieldFormat = (v: number) =>
    format(v, Math.abs(v) < 0.1 && v !== 0 ? 3 : 2);
  const [draft, setDraft] = useState(fieldFormat(value));
  const focused = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(fieldFormat(value));
  }, [value]);
  function commit() {
    focused.current = false;
    if (!edited.current) {
      setDraft(fieldFormat(value));
      return;
    }
    edited.current = false;
    const number = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(number)) {
      const next = Math.max(min, Math.min(max, number));
      onChange(next);
      setDraft(fieldFormat(next));
    } else setDraft(fieldFormat(value));
  }
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          aria-label={label}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(event) => {
            edited.current = true;
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {unit && <span className="input-unit">{unit}</span>}
      </div>
    </label>
  );
}

function PresetArt({ id }: { id: string }) {
  return (
    <svg
      className={`preset-art art-${id}`}
      viewBox="0 0 52 52"
      fill="none"
      aria-hidden="true"
    >
      {id === "playground" && (
        <>
          <path d="m7 34 22 7M35 11v14" stroke="#7e8588" strokeWidth="1.5" />
          <circle cx="17" cy="26" r="6" fill="#bba5f5" />
          <rect x="30" y="29" width="12" height="12" rx="2" fill="#8dbdf3" />
          <circle cx="35" cy="24" r="5" fill="#b8ef77" />
        </>
      )}
      {id === "cradle" && (
        <>
          <path
            d="M10 12h31M16 13 9 31m15-18v22m8-22v22m8-22v22"
            stroke="#8f9598"
          />
          <circle cx="9" cy="32" r="4" fill="#bba5f5" />
          <circle cx="24" cy="35" r="4" fill="#8dbdf3" />
          <circle cx="32" cy="35" r="4" fill="#b8ef77" />
          <circle cx="40" cy="35" r="4" fill="#ead28a" />
        </>
      )}
      {id === "orbits" && (
        <>
          <ellipse
            cx="26"
            cy="26"
            rx="20"
            ry="12"
            transform="rotate(-30 26 26)"
            stroke="#666354"
          />
          <circle cx="26" cy="26" r="6" fill="#ead28a" />
          <circle cx="9" cy="31" r="3" fill="#8dbdf3" />
          <circle cx="39" cy="15" r="3" fill="#efaa92" />
        </>
      )}
      {id === "springs" && (
        <>
          <path
            d="M12 10h27M25 10v6l-5 3 10 4-10 4 10 4-5 3v5"
            stroke="#939098"
            strokeLinejoin="round"
          />
          <rect x="19" y="36" width="13" height="11" rx="2" fill="#bba5f5" />
        </>
      )}
      {id === "buoyancy" && (
        <>
          <path d="M8 16v28h36V16" stroke="#6a869a" />
          <path
            d="M9 27q4-3 9 0t9 0 9 0 8 0v16H9Z"
            fill="#8dbdf3"
            fillOpacity=".18"
          />
          <path
            d="M9 27q4-3 9 0t9 0 9 0 8 0"
            stroke="#8dbdf3"
            strokeOpacity=".6"
          />
          <rect
            x="15"
            y="19"
            width="12"
            height="11"
            rx="2"
            transform="rotate(-12 15 19)"
            fill="#ead28a"
          />
          <circle cx="36" cy="36" r="4" fill="#efaa92" />
        </>
      )}
      {id === "charges" && (
        <>
          <path d="m18 20 17 13" stroke="#6f6e7f" strokeDasharray="2 3" />
          <circle cx="16" cy="18" r="8" fill="#efaa92" />
          <path d="M12 18h8m-4-4v8" stroke="#765346" />
          <circle cx="36" cy="35" r="8" fill="#8dbdf3" />
          <path d="M32 35h8" stroke="#415f7c" />
        </>
      )}
    </svg>
  );
}

function EnergyChart({
  history,
  metrics,
  mode,
}: {
  history: Metrics[];
  metrics: Metrics;
  mode: "energy" | "momentum";
}) {
  const width = 800,
    height = 95,
    pad = 4;
  const data = history.length > 0 ? history : [metrics];
  const values = data.flatMap((m) =>
    mode === "energy"
      ? [m.kineticEnergy, m.potentialEnergy]
      : [m.momentum.x, m.momentum.y],
  );
  const low = Math.min(0, ...values),
    high = Math.max(1, ...values);
  const range = high - low || 1;
  const end = Math.max(20, metrics.time),
    start = end - 20;
  const x = (m: Metrics) => Math.max(0, (m.time - start) / 20) * width;
  const y = (value: number) =>
    height - pad - ((value - low) / range) * (height - pad * 2);
  const path = (line: number) =>
    data
      .filter((m) => m.time >= start)
      .map((m, i) => {
        const value =
          mode === "energy"
            ? line === 0
              ? m.kineticEnergy
              : m.potentialEnergy
            : line === 0
              ? m.momentum.x
              : m.momentum.y;
        return `${i === 0 ? "M" : "L"}${x(m).toFixed(2)},${y(value).toFixed(2)}`;
      })
      .join(" ");
  return (
    <div
      className="chart"
      role="img"
      aria-label={
        mode === "energy"
          ? `Energy chart. Kinetic ${format(metrics.kineticEnergy)} joules, potential ${format(metrics.potentialEnergy)} joules.`
          : `Momentum chart. X ${format(metrics.momentum.x)}, Y ${format(metrics.momentum.y)} kilogram meters per second.`
      }
    >
      <div className="chart-y">
        <span>{format(high, 0)}</span>
        <span>{format((high + low) / 2, 0)}</span>
        <span>{format(low, 0)}</span>
      </div>
      <div className="chart-plot">
        {metrics.time === 0 && (
          <span className="chart-empty">
            Press play. Watch the energy change.
          </span>
        )}
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="energy-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#b8ef77" stopOpacity=".10" />
              <stop offset="100%" stopColor="#b8ef77" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[pad, height / 2, height - pad].map((y) => (
            <line
              key={y}
              x1="0"
              x2={width}
              y1={y}
              y2={y}
              stroke="#34383a"
              strokeDasharray="2 5"
            />
          ))}
          {data.length > 1 && (
            <path
              d={`${path(0)} L${x(data[data.length - 1])},${height} L${x(data.find((m) => m.time >= start) ?? data[0])},${height} Z`}
              fill="url(#energy-fill)"
            />
          )}
          <path
            d={path(1)}
            fill="none"
            stroke="#bba5f5"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={path(0)}
            fill="none"
            stroke="#b8ef77"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="chart-x">
          {[0, 5, 10, 15, 20].map((t) => (
            <span key={t}>{format(start + t, 0)}s</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Guide({
  initialTab,
  onClose,
}: {
  initialTab: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="guide-modal"
      aria-labelledby="guide-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-top">
        <span className="modal-icon">
          <Atom size={23} />
        </span>
        <IconButton label="Close guide" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      <p className="eyebrow">THE NEWTON FIELD GUIDE</p>
      <h2 id="guide-title">
        A little understanding.
        <br />A lot of possibility.
      </h2>
      <div className="guide-tabs">
        {[
          ["start", "Get started"],
          ["models", "Physical models"],
          ["keys", "Shortcuts"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "start" && (
        <div className="guide-content">
          <p>
            Newton is your hands-on, two-dimensional physics lab. There is no
            right answer. Pick an experiment, change something, and follow your
            curiosity.
          </p>
          <div className="guide-step">
            <span>01</span>
            <div>
              <h3>Start with an experiment</h3>
              <p>
                Explore six ready-to-run worlds, from everyday collisions to a
                miniature orbital system.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>02</span>
            <div>
              <h3>Give the world a nudge</h3>
              <p>
                Drag a body to apply a spring-like pulling force. Pause to
                reposition it precisely. Add circles, boxes, or a fixed
                platform.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>03</span>
            <div>
              <h3>Make it your own</h3>
              <p>
                Select a body to edit its density, material, velocity, and
                charge. Adjust the environment and watch the energy monitor.
                Export your scene to keep or share it.
              </p>
            </div>
          </div>
          <div className="model-notice">
            <Sparkles size={18} />
            <p>
              Tip: turn on velocity vectors to see not just where things are,
              but where they are going.
            </p>
          </div>
        </div>
      )}
      {tab === "models" && (
        <div className="guide-content models-content">
          <div className="model-notice">
            <Compass size={20} />
            <p>
              <strong>A useful model, not the entire universe.</strong> Newton
              models classical 2D mechanics. No finite engine can apply every
              law of physics at every scale.
            </p>
          </div>
          {[
            [
              "Rigid-body dynamics",
              "F = ma",
              "Rapier WebAssembly solver, fixed 120 Hz steps, rotational inertia, continuous collision detection, Coulomb contact friction, and restitution. Shapes remain rigid.",
            ],
            [
              "Gravity & charged particles",
              "F ~ 1 / r^2",
              "Uniform gravity, pairwise Newtonian gravity and Coulomb forces with 0.12 m softening. A perpendicular magnetic field bends moving charges. Field constants in the orbit and charge experiments are educational, not real-world G or k.",
            ],
            [
              "Joints & springs",
              "F = -kx",
              "Ropes, revolute joints, and damped Hookean springs. A rope limits maximum distance; it is not a rigid rod. The cradle approximates real contact and string behavior.",
            ],
            [
              "Drag & buoyancy",
              "Fb = -rho V g",
              "Linear air drag with wind and a flat, stationary fluid reservoir. Submerged area determines buoyancy and righting torque. Surface ripples are visual only, not simulated waves.",
            ],
            [
              "Units & energy",
              "m / kg / s",
              "SI-style units with 1 m out-of-plane thickness. Density is kg/m3. Energy includes rigid-body kinetic, uniform gravity, pair fields, and springs. Fluid energy, work by external supports, and drag heat are not tracked. Energy need not be conserved in an open or dissipative scene.",
            ],
          ].map(([title, formula, description]) => (
            <div className="model-row" key={title}>
              <div>
                <h3>{title}</h3>
                <code>{formula}</code>
              </div>
              <p>{description}</p>
            </div>
          ))}
          <p className="muted">
            Not modeled: relativity, quantum mechanics, thermodynamics,
            deformable solids, full fluid dynamics, radiation, or chemical
            reactions. Discrete integration, safety limits, and the collision
            solver introduce numerical error.
          </p>
        </div>
      )}
      {tab === "keys" && (
        <div className="guide-content shortcut-grid">
          {[
            ["Play / pause", "Space"],
            ["Reset experiment", "R"],
            ["Select & drag", "V"],
            ["Pan the view", "H"],
            ["Add a circle", "C"],
            ["Add a box", "B"],
            ["Fit the view", "F"],
            ["Toggle grid", "G"],
            ["Toggle motion trails", "T"],
            ["Delete selected body", "Del"],
            ["Open this guide", "?"],
            ["Exit a tool / close menu", "Esc"],
            ["Zoom at cursor", "Scroll"],
            ["Pan with any tool", "Middle drag"],
          ].map(([label, key]) => (
            <div className="shortcut" key={label}>
              <span>{label}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
      )}
      <div className="modal-bottom">
        <span>
          <span className="tiny-dot" /> Built on Rapier. Powered by curiosity.
        </span>
        <button className="primary-button" onClick={onClose}>
          Back to the lab <ArrowRight size={16} />
        </button>
      </div>
    </dialog>
  );
}

function WorldPanel({
  environment,
  onChange,
  display,
  onDisplayChange,
  onReset,
  onGuide,
}: {
  environment: Environment;
  onChange: (patch: Partial<Environment>) => void;
  display: DisplayOptions;
  onDisplayChange: (key: keyof DisplayOptions, value: boolean) => void;
  onReset: () => void;
  onGuide: () => void;
}) {
  const env = environment;
  return (
    <>
      <div className="panel-heading">
        <h2>World settings</h2>
        <IconButton label="Reset world settings" onClick={onReset}>
          <RotateCcw size={14} />
        </IconButton>
      </div>
      <section className="settings-section gravity-section">
        <div className="section-label">
          <span>
            <ArrowDown size={15} /> Gravity
          </span>
          <span className="unit-label">
            m/s<sup>2</sup>
          </span>
        </div>
        <div className="planet-selector">
          {[
            ["Earth", 9.81],
            ["Moon", 1.62],
            ["Zero-g", 0],
          ].map(([label, gravity]) => (
            <button
              key={label}
              className={
                Math.abs(env.gravity.y + Number(gravity)) < 0.001 &&
                env.gravity.x === 0
                  ? "active"
                  : ""
              }
              onClick={() =>
                onChange({ gravity: { x: 0, y: -Number(gravity) } })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="gravity-readout">
          <span>{format(-env.gravity.y)}</span>
          <span>
            m/s<sup>2</sup>
            <ArrowDown size={18} />
          </span>
        </div>
        <input
          className="range-input"
          type="range"
          min="-20"
          max="30"
          step="0.01"
          aria-label="Vertical gravity"
          value={-env.gravity.y}
          onChange={(e) =>
            onChange({
              gravity: { ...env.gravity, y: -Number(e.target.value) },
            })
          }
          style={
            {
              "--range-progress": `${((-env.gravity.y + 20) / 50) * 100}%`,
            } as React.CSSProperties
          }
        />
        <div className="range-labels">
          <span>-20</span>
          <span>0</span>
          <span>30</span>
        </div>
      </section>
      <section className="settings-section">
        <Toggle
          label="Air resistance"
          icon={<Wind size={15} />}
          checked={env.airDrag > 0}
          onChange={(value) => onChange({ airDrag: value ? 0.15 : 0 })}
        />
        {env.airDrag > 0 && (
          <div className="drag-control">
            <span>Drag coefficient</span>
            <NumberField
              label="Air drag"
              value={env.airDrag}
              onChange={(airDrag) => onChange({ airDrag })}
              min={0}
              max={10}
              step={0.01}
              unit="s-1"
            />
          </div>
        )}
        <p className="field-description">
          A little resistance. A more familiar world.
        </p>
      </section>
      <details className="advanced-settings">
        <summary>
          <span>
            <SlidersHorizontal size={15} /> Advanced forces
          </span>
          <ChevronDown size={14} />
        </summary>
        <div className="advanced-content">
          <div className="input-grid">
            <NumberField
              label="Gravity X"
              value={env.gravity.x}
              onChange={(x) => onChange({ gravity: { ...env.gravity, x } })}
              min={-30}
              max={30}
              unit="m/s2"
            />
            <NumberField
              label="Wind X"
              value={env.wind.x}
              onChange={(x) => onChange({ wind: { ...env.wind, x } })}
              min={-100}
              max={100}
              unit="m/s"
            />
          </div>
          <NumberField
            label="Mutual gravity (G)"
            value={env.nbodyGravity}
            onChange={(nbodyGravity) => onChange({ nbodyGravity })}
            min={0}
            max={1000}
            step={0.01}
          />
          <NumberField
            label="Electric constant (k)"
            value={env.electrostaticConstant}
            onChange={(electrostaticConstant) =>
              onChange({ electrostaticConstant })
            }
            min={0}
            max={10000}
          />
          <NumberField
            label="Magnetic field (B)"
            value={env.magneticField}
            onChange={(magneticField) => onChange({ magneticField })}
            min={-100}
            max={100}
            unit="T"
          />
          <Toggle
            label="Fluid reservoir"
            icon={<Droplets size={15} />}
            checked={!!env.fluid}
            onChange={(value) =>
              onChange({
                fluid: value ? { level: 4.5, density: 1, drag: 2 } : null,
              })
            }
          />
          {env.fluid && (
            <>
              <NumberField
                label="Fluid level"
                value={env.fluid.level}
                onChange={(level) =>
                  onChange({ fluid: { ...env.fluid!, level } })
                }
                min={-100}
                max={100}
                unit="m"
              />
              <NumberField
                label="Fluid density"
                value={env.fluid.density}
                onChange={(density) =>
                  onChange({ fluid: { ...env.fluid!, density } })
                }
                min={0}
                max={10000}
                unit="kg/m3"
              />
            </>
          )}
          <p className="field-description">
            Pairwise fields use softened forces. Constants can be normalized for
            experiments.
          </p>
        </div>
      </details>
      <section className="settings-section viewport-settings">
        <div className="section-label">
          <span>Make the invisible visible</span>
        </div>
        <Toggle
          label="Grid"
          icon={<Grid2X2 size={15} />}
          checked={display.grid}
          onChange={(v) => onDisplayChange("grid", v)}
        />
        <Toggle
          label="Motion trails"
          icon={<Spline size={15} />}
          checked={display.trails}
          onChange={(v) => onDisplayChange("trails", v)}
        />
        <Toggle
          label="Velocity vectors"
          icon={<MoveUpRight size={15} />}
          checked={display.vectors}
          onChange={(v) => onDisplayChange("vectors", v)}
        />
        <Toggle
          label="Body labels"
          icon={<Tag size={15} />}
          checked={display.labels}
          onChange={(v) => onDisplayChange("labels", v)}
        />
      </section>
      <div className="solver-card">
        <div>
          <span className="solver-symbol">
            <Atom size={19} />
          </span>
          <span>
            <strong>Real physics. In real time.</strong>
            <small>Rapier engine / WebAssembly</small>
          </span>
        </div>
        <p>
          <span className="tiny-dot" /> 120 Hz fixed timestep <span>2D</span>
        </p>
      </div>
      <button className="text-button model-link" onClick={onGuide}>
        Understand the physical models <MoveUpRight size={13} />
      </button>
    </>
  );
}

function BodyPanel({
  body,
  onChange,
  onDelete,
  onDuplicate,
}: {
  body: BodySnapshot | null;
  onChange: (patch: Partial<BodySpec>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  if (!body)
    return (
      <div className="empty-inspector">
        <div className="selection-art">
          <MousePointer2 size={25} />
          <span />
          <span />
          <span />
          <span />
        </div>
        <h3>Every body has a story.</h3>
        <p>
          Select an object in the simulation to explore its properties and make
          it your own.
        </p>
        <span className="keyboard-hint">
          <kbd>V</kbd> Select & drag
        </span>
      </div>
    );
  return (
    <>
      <div className="panel-heading">
        <h2>Body properties</h2>
        <span className="body-type">{body.shape}</span>
      </div>
      <div className="body-preview">
        <div
          className={`preview-shape ${body.shape}`}
          style={{ background: body.color }}
        />
        <div>
          <strong>{body.label}</strong>
          <small>
            {body.fixed ? "Static body" : "Dynamic body"}
            <span />
            {format(body.mass)} kg
          </small>
        </div>
      </div>
      <label className="text-field">
        Name
        <input
          key={body.id}
          defaultValue={body.label}
          maxLength={100}
          onBlur={(e) => {
            if (e.target.value.trim())
              onChange({ label: e.target.value.trim() });
            else e.target.value = body.label;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>
      <section className="settings-section">
        <div className="section-label">
          <span>Geometry</span>
          <Square size={14} />
        </div>
        {body.shape === "circle" ? (
          <NumberField
            label="Radius"
            value={body.radius!}
            onChange={(radius) => onChange({ radius })}
            min={0.01}
            max={50}
            unit="m"
          />
        ) : (
          <div className="input-grid">
            <NumberField
              label="Width"
              value={body.width!}
              onChange={(width) => onChange({ width })}
              min={0.02}
              max={100}
              unit="m"
            />
            <NumberField
              label="Height"
              value={body.height!}
              onChange={(height) => onChange({ height })}
              min={0.02}
              max={100}
              unit="m"
            />
          </div>
        )}
        <NumberField
          label="Rotation"
          value={((body.rotation * 180) / Math.PI) % 360}
          onChange={(degrees) =>
            onChange({ rotation: (degrees * Math.PI) / 180 })
          }
          min={-360}
          max={360}
          unit="deg"
        />
      </section>
      <section className="settings-section">
        <div className="section-label">
          <span>Material</span>
          <Box size={14} />
        </div>
        <select
          aria-label="Body material"
          value="custom"
          onChange={(e) => {
            const materials: Record<
              string,
              { density: number; restitution: number; friction: number }
            > = {
              rubber: { density: 1.1, restitution: 0.85, friction: 0.65 },
              wood: { density: 0.65, restitution: 0.25, friction: 0.65 },
              steel: { density: 7.8, restitution: 0.25, friction: 0.35 },
              ice: { density: 0.9, restitution: 0.1, friction: 0.04 },
            };
            if (materials[e.target.value]) onChange(materials[e.target.value]);
          }}
        >
          <option value="custom">Custom properties</option>
          <option value="rubber">Rubber</option>
          <option value="wood">Wood</option>
          <option value="steel">Steel</option>
          <option value="ice">Ice</option>
        </select>
        <NumberField
          label="Density"
          value={body.density}
          onChange={(density) => onChange({ density })}
          min={0.01}
          max={10000}
          unit="kg/m3"
        />
        <div className="input-grid">
          <NumberField
            label="Restitution"
            value={body.restitution}
            onChange={(restitution) => onChange({ restitution })}
            min={0}
            max={1}
            step={0.05}
          />
          <NumberField
            label="Friction"
            value={body.friction}
            onChange={(friction) => onChange({ friction })}
            min={0}
            max={2}
            step={0.05}
          />
        </div>
        <div className="color-options">
          {COLORS.map((color, i) => (
            <button
              key={color}
              aria-label={`Set body color to ${["lime", "lavender", "blue", "coral", "sand"][i]}`}
              aria-pressed={body.color === color}
              style={{ background: color }}
              onClick={() => onChange({ color })}
            >
              {body.color === color && <Check size={13} />}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <div className="section-label">
          <span>Position & motion</span>
          <MoveUpRight size={14} />
        </div>
        <div className="input-grid">
          <NumberField
            label="Position X"
            value={body.position.x}
            onChange={(x) => onChange({ position: { ...body.position, x } })}
            min={-1000}
            max={1000}
            unit="m"
          />
          <NumberField
            label="Position Y"
            value={body.position.y}
            onChange={(y) => onChange({ position: { ...body.position, y } })}
            min={-1000}
            max={1000}
            unit="m"
          />
        </div>
        {!body.fixed && (
          <>
            <div className="input-grid">
              <NumberField
                label="Velocity X"
                value={body.velocity.x}
                onChange={(x) =>
                  onChange({ velocity: { ...body.velocity, x } })
                }
                min={-100}
                max={100}
                unit="m/s"
              />
              <NumberField
                label="Velocity Y"
                value={body.velocity.y}
                onChange={(y) =>
                  onChange({ velocity: { ...body.velocity, y } })
                }
                min={-100}
                max={100}
                unit="m/s"
              />
            </div>
            <NumberField
              label="Angular velocity"
              value={body.angularVelocity}
              onChange={(angularVelocity) => onChange({ angularVelocity })}
              min={-200}
              max={200}
              unit="rad/s"
            />
          </>
        )}
        <Toggle
          label="Fixed in place"
          checked={!!body.fixed}
          onChange={(fixed) => onChange({ fixed })}
        />
        <Toggle
          label="Trace this body"
          checked={!!body.trail}
          onChange={(trail) => onChange({ trail })}
        />
        <NumberField
          label="Electric charge"
          value={body.charge ?? 0}
          onChange={(charge) => onChange({ charge })}
          min={-1000}
          max={1000}
          unit="C"
        />
      </section>
      <div className="body-actions">
        <button className="secondary-button" onClick={onDuplicate}>
          <Copy size={14} /> Duplicate
        </button>
        <button className="danger-button" onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </>
  );
}

export default function App() {
  const [engine, setEngine] = useState<PhysicsEngine | null>(null);
  const [scene, setScene] = useState<SceneConfig>(PRESETS[0]);
  const [revision, setRevision] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [display, setDisplay] = useState<DisplayOptions>({
    grid: true,
    trails: true,
    vectors: false,
    labels: false,
  });
  const [environment, setEnvironment] = useState<Environment>(
    PRESETS[0].environment,
  );
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [bodies, setBodies] = useState<BodySnapshot[]>([]);
  const [history, setHistory] = useState<Metrics[]>([]);
  const [fps, setFps] = useState(60);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"world" | "body">("world");
  const [graphMode, setGraphMode] = useState<"energy" | "momentum">("energy");
  const [guide, setGuide] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"library" | "settings" | null>(
    null,
  );
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [cameraCommand, setCameraCommand] = useState<{
    id: number;
    type: "fit" | "in" | "out";
  }>({ id: 0, type: "fit" });
  const [savedScene, setSavedScene] = useState<SceneConfig | null>(() => {
    try {
      const saved = localStorage.getItem("newton-saved-scene");
      return saved ? validateScene(JSON.parse(saved)) : null;
    } catch {
      return null;
    }
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const lastHistoryTime = useRef(-1);
  const selected = bodies.find((body) => body.id === selectedId) ?? null;
  const presetIndex = PRESETS.findIndex((preset) => preset.id === scene.id);
  const detail = SCENE_DETAILS[presetIndex] ?? [
    "Your world. Your rules.",
    "A CUSTOM EXPERIMENT",
    "Make something unexpected.",
  ];

  useEffect(() => {
    let disposed = false;
    let instance: PhysicsEngine | null = null;
    PhysicsEngine.create(PRESETS[0])
      .then((value) => {
        if (disposed) {
          value.dispose();
          return;
        }
        instance = value;
        setEngine(value);
        setBodies(value.snapshots());
        setMetrics(value.metrics());
      })
      .catch((error) => {
        if (!disposed)
          setError(`The physics engine could not start: ${String(error)}`);
      });
    return () => {
      disposed = true;
      instance?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 3600);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!addMenu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".add-object-wrap")) setAddMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [addMenu]);

  function refresh() {
    if (!engine) return;
    setBodies(engine.snapshots());
    setMetrics(engine.metrics());
  }

  function togglePlayback() {
    setRunning((value) => !value);
    refresh();
  }

  function loadScene(config: SceneConfig) {
    if (!engine) return;
    try {
      engine.loadScene(config);
      setScene(config);
      setEnvironment(engine.environment);
      setRevision((v) => v + 1);
      setHistory([]);
      lastHistoryTime.current = -1;
      setSelectedId(null);
      setTool("select");
      setPanel("world");
      setRunning(false);
      setError("");
      setMobilePanel(null);
      setAddMenu(false);
      refresh();
    } catch (error) {
      setToast(
        `Could not load scene: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function reset() {
    loadScene(scene);
    setToast("Back to the beginning. Try something different.");
  }
  function camera(type: "fit" | "in" | "out") {
    setCameraCommand((v) => ({ id: v.id + 1, type }));
  }
  function changeDisplay(key: keyof DisplayOptions, value: boolean) {
    setDisplay((current) => ({ ...current, [key]: value }));
  }
  function changeEnvironment(patch: Partial<Environment>) {
    if (!engine) return;
    try {
      engine.setEnvironment(patch);
      setEnvironment(engine.environment);
      refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }
  function changeBody(patch: Partial<BodySpec>) {
    if (!engine || !selectedId) return;
    try {
      engine.updateBody(selectedId, patch);
      refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }
  function selectBody(id: string | null) {
    setSelectedId(id);
    if (id) setPanel("body");
  }
  function addBody(shape: "circle" | "box", position: Vec2, fixed = false) {
    if (!engine) return;
    if (bodies.length >= 250) {
      setToast(
        "This world is full. Remove a body before adding another (250 max).",
      );
      return;
    }
    const id = `body-${crypto.randomUUID()}`;
    const color = COLORS[bodies.filter((b) => !b.fixed).length % COLORS.length];
    try {
      engine.addBody({
        id,
        label: fixed
          ? "Platform"
          : shape === "circle"
            ? "New circle"
            : "New box",
        shape,
        position,
        radius: 0.5,
        width: fixed ? 4 : 1,
        height: fixed ? 0.24 : 1,
        density: 1,
        restitution: 0.6,
        friction: 0.45,
        color: fixed ? "#94999b" : color,
        fixed,
        trail: false,
      });
      selectBody(id);
      refresh();
      setTool("select");
      setAddMenu(false);
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }
  function removeBody() {
    if (!engine || !selectedId) return;
    engine.removeBody(selectedId);
    setSelectedId(null);
    refresh();
    setToast("Body removed. Reset the experiment to start over.");
  }
  function duplicateBody() {
    if (!engine || !selected) return;
    try {
      const id = `body-${crypto.randomUUID()}`;
      engine.addBody({
        ...selected,
        id,
        label: `${selected.label.slice(0, 90)} copy`,
        position: { x: selected.position.x + 1, y: selected.position.y + 1 },
      });
      selectBody(id);
      refresh();
      setToast("Body duplicated. Joints are not copied.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }
  function download(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportScene() {
    if (!engine) return;
    const config = engine.exportScene();
    download(
      JSON.stringify(config, null, 2),
      `newton-${scene.id.replace(/[^a-z0-9-]/gi, "-").slice(0, 60)}.json`,
      "application/json",
    );
    try {
      localStorage.setItem("newton-saved-scene", JSON.stringify(config));
      setSavedScene(config);
    } catch {
      /* Export remains available if browser storage is full. */
    }
    setToast(
      "Scene exported. Your positions, velocities, and settings are included.",
    );
  }
  async function importScene(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000)
        throw new Error("Choose a scene smaller than 2 MB.");
      const config = validateScene(JSON.parse(await file.text()));
      loadScene(config);
      setToast(`Imported ${config.name}. Press play when you are ready.`);
    } catch (error) {
      setToast(
        `Import failed: ${error instanceof Error ? error.message : "Invalid JSON file."}`,
      );
    }
    if (fileInput.current) fileInput.current.value = "";
  }
  function exportData() {
    const rows = history.length ? history : [metrics];
    download(
      "time_s,kinetic_J,potential_J,total_J,momentum_x_kg_m_s,momentum_y_kg_m_s\n" +
        rows
          .map((m) =>
            [
              m.time,
              m.kineticEnergy,
              m.potentialEnergy,
              m.totalEnergy,
              m.momentum.x,
              m.momentum.y,
            ].join(","),
          )
          .join("\n"),
      "newton-measurements.csv",
      "text/csv",
    );
    setToast("Measurements exported as CSV.");
  }
  function chooseTool(next: Tool) {
    setTool(next);
    setAddMenu(false);
    if (next === "circle" || next === "box")
      setToast(`Click the canvas to place a ${next}.`);
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.matches("input, select, textarea") ||
        target.isContentEditable ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.key === " " && target.closest("button")) return;
      if (guide) return;
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        if (engine && !error) togglePlayback();
      } else if (key === "r") reset();
      else if (key === "v") chooseTool("select");
      else if (key === "h") chooseTool("hand");
      else if (key === "c") chooseTool("circle");
      else if (key === "b") chooseTool("box");
      else if (key === "f") camera("fit");
      else if (key === "g") changeDisplay("grid", !display.grid);
      else if (key === "t") changeDisplay("trails", !display.trails);
      else if (key === "delete" || key === "backspace") {
        event.preventDefault();
        removeBody();
      } else if (key === "?") setGuide("keys");
      else if (key === "escape") {
        setTool("select");
        setAddMenu(false);
        setMobilePanel(null);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            loadScene(PRESETS[0]);
          }}
          aria-label="Newton home"
        >
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" fill="none">
              <path
                d="M8 24V8l16 16V8"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="24" cy="8" r="2.8" fill="currentColor" />
            </svg>
          </span>
          <span>
            newton<span className="brand-period">.</span>
          </span>
          <span className="lab-badge">PHYSICS LAB</span>
        </a>
        <div className="header-location">
          <span>Workspace</span>
          <ChevronRight size={13} />
          <span>Untitled exploration</span>
          <span className="local-badge">LOCAL</span>
        </div>
        <div className="header-actions">
          <button
            className="guide-button"
            aria-label="Field guide"
            onClick={() => setGuide("start")}
          >
            <HelpCircle size={16} />
            <span>Field guide</span>
          </button>
          <span className="header-divider" />
          <button
            className="secondary-button import-button"
            aria-label="Import scene"
            onClick={() => fileInput.current?.click()}
            disabled={!engine}
          >
            <ArrowUpFromLine size={15} />
            <span>Import</span>
          </button>
          <button
            className="primary-button export-button"
            onClick={exportScene}
            disabled={!engine}
          >
            <ArrowDownToLine size={15} />
            <span>Export scene</span>
          </button>
        </div>
        <input
          className="visually-hidden"
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="Import scene file"
          onChange={(e) => void importScene(e.target.files?.[0])}
        />
      </header>
      <nav className="mobile-toolbar" aria-label="Mobile workspace controls">
        <button
          onClick={() =>
            setMobilePanel(mobilePanel === "library" ? null : "library")
          }
        >
          <Menu size={16} /> Experiments
        </button>
        <span>
          <span className="tiny-dot" /> YOUR LITTLE UNIVERSE
        </span>
        <button
          onClick={() =>
            setMobilePanel(mobilePanel === "settings" ? null : "settings")
          }
        >
          <Settings2 size={16} /> Settings
        </button>
      </nav>
      <div className="lab-layout">
        {mobilePanel && (
          <button
            className="panel-backdrop"
            aria-label="Close side panel"
            onClick={() => setMobilePanel(null)}
          />
        )}
        <aside
          className={`library-panel ${mobilePanel === "library" ? "mobile-open" : ""}`}
          aria-label="Experiment library"
        >
          <div className="library-top">
            <span className="eyebrow">A SPACE FOR CURIOSITY</span>
            <h2>
              Small experiments.
              <br />
              Big discoveries.
            </h2>
            <p>The world is your playground.</p>
          </div>
          <div className="library-label">
            <span>EXPERIMENTS</span>
            <span>06</span>
          </div>
          <nav className="experiment-list">
            {PRESETS.map((preset, i) => (
              <button
                key={preset.id}
                className={`experiment ${scene.id === preset.id ? "selected" : ""}`}
                onClick={() => loadScene(preset)}
                disabled={!engine}
                aria-current={scene.id === preset.id ? "page" : undefined}
              >
                <PresetArt id={preset.id} />
                <span className="experiment-text">
                  <strong>{preset.name}</strong>
                  <small>
                    {
                      [
                        "A bit of everything",
                        "Momentum in motion",
                        "A cosmic balancing act",
                        "Find the natural rhythm",
                        "Go with the float",
                        "Feel the attraction",
                      ][i]
                    }
                  </small>
                </span>
                {scene.id === preset.id && <span className="experiment-dot" />}
              </button>
            ))}
          </nav>
          <button
            className="new-scene-button"
            disabled={!engine}
            onClick={() => {
              loadScene({
                ...structuredClone(PRESETS[0]),
                id: "custom",
                name: "Untitled experiment",
                description: "A blank canvas for your next discovery.",
                bodies: [structuredClone(PRESETS[0].bodies[0])],
                joints: [],
              });
              setToast("A fresh world. Add a body to get things moving.");
            }}
          >
            <Plus size={15} /> Create an empty world <ArrowRight size={14} />
          </button>
          {savedScene && (
            <button
              className="saved-scene-button"
              onClick={() => loadScene(savedScene)}
            >
              <Layers3 size={15} />
              <span>
                Last exported scene<small>{savedScene.name}</small>
              </span>
              <ChevronRight size={13} />
            </button>
          )}
          <div className="library-bottom">
            <div className="curiosity-card">
              <span className="curiosity-icon">
                <Sparkles size={18} />
              </span>
              <h3>What happens if...?</h3>
              <p>
                Change one thing.
                <br />
                Discover something new.
              </p>
              <button onClick={() => setGuide("start")}>
                Meet your physics lab <ArrowUpFromLine size={13} />
              </button>
              <span className="decorative-orbit" />
            </div>
            <button
              className="shortcuts-button"
              onClick={() => setGuide("keys")}
            >
              <Keyboard size={16} /> Keyboard shortcuts <kbd>?</kbd>
            </button>
          </div>
          <div className="library-version">
            <span>NEWTON / V1.0</span>
            <span>MADE TO EXPLORE</span>
          </div>
        </aside>

        <main className="workspace">
          <div className="workspace-heading">
            <div>
              <div className="workspace-breadcrumb">
                <FlaskConical size={12} />
                <span>THE EXPERIMENT LAB</span>
                <span>/</span>
                <span>
                  {String(presetIndex >= 0 ? presetIndex + 1 : 7).padStart(
                    2,
                    "0",
                  )}
                </span>
              </div>
              <h1>
                {scene.name}
                <span className="scene-status-dot" />
              </h1>
              <p>{detail[2]}</p>
            </div>
            <div className="add-object-wrap">
              <button
                className={`secondary-button add-object-button ${addMenu ? "active" : ""}`}
                disabled={!engine}
                onClick={() => setAddMenu((v) => !v)}
                aria-expanded={addMenu}
              >
                <Plus size={16} />
                <span>Add object</span>
                <ChevronDown size={13} />
              </button>
              {addMenu && (
                <div className="add-menu">
                  <p>BRING SOMETHING INTO THE WORLD</p>
                  <button onClick={() => chooseTool("circle")}>
                    <Circle size={19} />
                    <span>
                      Circle<small>Made for rolling & bouncing</small>
                    </span>
                    <kbd>C</kbd>
                  </button>
                  <button onClick={() => chooseTool("box")}>
                    <Square size={19} />
                    <span>
                      Box<small>A building block of possibility</small>
                    </span>
                    <kbd>B</kbd>
                  </button>
                  <button onClick={() => addBody("box", { x: 0, y: 4 }, true)}>
                    <Minus size={21} />
                    <span>
                      Platform<small>A fixed surface to land on</small>
                    </span>
                    <Plus size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className={`viewport tool-${tool}`}>
            <SimulationCanvas
              engine={engine}
              scene={scene}
              revision={revision}
              running={running}
              speed={speed}
              tool={tool}
              display={display}
              selectedId={selectedId}
              onSelect={selectBody}
              onAdd={addBody}
              cameraCommand={cameraCommand}
              onZoomChange={setZoom}
              onError={(message) => {
                setRunning(false);
                setError(message);
              }}
              onFrame={(next, snapshots, frameRate) => {
                setMetrics(next);
                setBodies(snapshots);
                setFps(frameRate);
                if (Math.abs(next.time - lastHistoryTime.current) > 0.07) {
                  lastHistoryTime.current = next.time;
                  setHistory((current) =>
                    [
                      ...current.filter((m) => m.time >= next.time - 25),
                      next,
                    ].slice(-500),
                  );
                }
              }}
            />
            <div className="viewport-top">
              <span className="dimension-badge">
                <span /> 2D SIMULATION
              </span>
              <span className={`live-badge ${running ? "is-live" : ""}`}>
                <span />
                {running ? "LIVE" : "PAUSED"}
              </span>
            </div>
            <div className="scene-intro">
              <span>{detail[1]}</span>
              <h2>{detail[0]}</h2>
            </div>
            <div className="world-note">
              <span className="world-note-dot" />
              {environment.nbodyGravity > 0
                ? "Mutual gravitation"
                : environment.fluid
                  ? "Fluid reservoir"
                  : environment.electrostaticConstant > 0
                    ? "Electrostatic field"
                    : Math.abs(environment.gravity.y + 9.81) < 0.001
                      ? "A little slice of Earth"
                      : environment.gravity.y === 0
                        ? "Life without gravity"
                        : "Your kind of gravity"}
            </div>
            {!engine && !error && (
              <div className="canvas-loading">
                <Atom size={30} />
                <strong>Setting a little world in motion...</strong>
                <span>Initializing the WebAssembly physics engine</span>
              </div>
            )}
            {error && (
              <div className="canvas-error">
                <Zap size={24} />
                <h3>The simulation needs a reset.</h3>
                <p>{error}</p>
                <button
                  className="primary-button"
                  onClick={() => (engine ? reset() : window.location.reload())}
                >
                  Restart the engine
                </button>
              </div>
            )}
            <div className="canvas-bottom">
              <span className="interaction-hint">
                <MousePointer2 size={13} />
                {tool === "hand"
                  ? "Drag to pan"
                  : tool === "circle" || tool === "box"
                    ? "Click to place"
                    : "Grab a body. Give it a nudge."}
              </span>
              <div
                className="tool-dock"
                role="toolbar"
                aria-label="Simulation tools"
              >
                <IconButton
                  label="Select and drag (V)"
                  active={tool === "select"}
                  onClick={() => chooseTool("select")}
                >
                  <MousePointer2 size={17} />
                </IconButton>
                <IconButton
                  label="Pan the view (H)"
                  active={tool === "hand"}
                  onClick={() => chooseTool("hand")}
                >
                  <Hand size={17} />
                </IconButton>
                <span className="dock-divider" />
                <IconButton
                  label="Add a circle (C)"
                  active={tool === "circle"}
                  onClick={() => chooseTool("circle")}
                >
                  <Circle size={18} />
                </IconButton>
                <IconButton
                  label="Add a box (B)"
                  active={tool === "box"}
                  onClick={() => chooseTool("box")}
                >
                  <Square size={17} />
                </IconButton>
                <span className="dock-divider" />
                <IconButton
                  label="Toggle velocity vectors"
                  active={display.vectors}
                  onClick={() => changeDisplay("vectors", !display.vectors)}
                >
                  <MoveUpRight size={18} />
                </IconButton>
                <IconButton label="Fit view (F)" onClick={() => camera("fit")}>
                  <Expand size={17} />
                </IconButton>
              </div>
              <div className="zoom-control">
                <IconButton label="Zoom out" onClick={() => camera("out")}>
                  <Minus size={13} />
                </IconButton>
                <button
                  className="zoom-value"
                  onClick={() => camera("fit")}
                  title="Reset zoom"
                >
                  {zoom}%
                </button>
                <IconButton label="Zoom in" onClick={() => camera("in")}>
                  <Plus size={13} />
                </IconButton>
              </div>
            </div>
          </div>
          <div className="playback-bar">
            <div className="playback-actions">
              <button
                className={`play-button ${running ? "playing" : ""}`}
                onClick={togglePlayback}
                disabled={!engine || !!error}
                aria-label={running ? "Pause simulation" : "Play simulation"}
              >
                {running ? (
                  <Pause size={16} fill="currentColor" />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
                <span>{running ? "Pause" : "Play"}</span>
                <kbd>Space</kbd>
              </button>
              <IconButton
                label="Reset simulation (R)"
                disabled={!engine}
                onClick={reset}
              >
                <RotateCcw size={17} />
              </IconButton>
              <IconButton
                label="Advance one frame"
                disabled={!engine || running || !!error}
                onClick={() => {
                  engine?.step(1 / 60);
                  refresh();
                }}
              >
                <StepForward size={17} />
              </IconButton>
            </div>
            <div className="elapsed-time">
              <span>SIMULATION TIME</span>
              <strong>
                {clock(metrics.time)}
                <small>s</small>
              </strong>
            </div>
            <div className="speed-control">
              <span>Speed</span>
              <select
                aria-label="Simulation speed"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value={0.25}>0.25x</option>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
              </select>
            </div>
          </div>
          <section className="monitor-panel" aria-label="Live measurements">
            <div className="monitor-heading">
              <div className="monitor-tabs">
                <button
                  className={graphMode === "energy" ? "active" : ""}
                  onClick={() => setGraphMode("energy")}
                >
                  <Activity size={14} />
                  Energy monitor
                </button>
                <button
                  className={graphMode === "momentum" ? "active" : ""}
                  onClick={() => setGraphMode("momentum")}
                >
                  Momentum
                </button>
              </div>
              <button
                className="data-export"
                onClick={exportData}
                aria-label="Export measurement data as CSV"
              >
                <ArrowDownToLine size={13} />
                <span>Export data</span>
              </button>
            </div>
            <div className="monitor-readouts">
              <span>
                <i className="kinetic-dot" />
                {graphMode === "energy" ? "Kinetic" : "X momentum"}
                <strong>
                  {format(
                    graphMode === "energy"
                      ? metrics.kineticEnergy
                      : metrics.momentum.x,
                  )}
                  <small>{graphMode === "energy" ? "J" : "kg m/s"}</small>
                </strong>
              </span>
              <span>
                <i className="potential-dot" />
                {graphMode === "energy" ? "Potential" : "Y momentum"}
                <strong>
                  {format(
                    graphMode === "energy"
                      ? metrics.potentialEnergy
                      : metrics.momentum.y,
                  )}
                  <small>{graphMode === "energy" ? "J" : "kg m/s"}</small>
                </strong>
              </span>
              <span className="total-energy">
                {graphMode === "energy" ? "Total energy" : "Max speed"}
                <strong>
                  {format(
                    graphMode === "energy"
                      ? metrics.totalEnergy
                      : metrics.maxSpeed,
                  )}
                  <small>{graphMode === "energy" ? "J" : "m/s"}</small>
                </strong>
              </span>
            </div>
            <EnergyChart history={history} metrics={metrics} mode={graphMode} />
          </section>
          <footer className="workspace-status">
            <span>
              <span className="tiny-dot" />
              {engine ? "All systems ready" : "Initializing engine"}
              <span className="status-divider">/</span>
              <span>{metrics.bodies} bodies</span>
              <span className="status-divider">/</span>
              <span>{fps} fps</span>
            </span>
            <span>
              METERS · KILOGRAMS · SECONDS{" "}
              <span className="status-divider">/</span>
              <Gauge size={12} /> 120 Hz
            </span>
          </footer>
        </main>

        <aside
          className={`inspector-panel ${mobilePanel === "settings" ? "mobile-open" : ""}`}
          aria-label="Simulation settings"
        >
          <div className="inspector-tabs">
            <button
              className={panel === "world" ? "active" : ""}
              onClick={() => setPanel("world")}
            >
              <Settings2 size={14} />
              Environment
            </button>
            <button
              className={panel === "body" ? "active" : ""}
              onClick={() => setPanel("body")}
            >
              <Box size={14} />
              Inspector{selected && <span className="inspector-dot" />}
            </button>
          </div>
          <div className="inspector-scroll">
            {panel === "world" ? (
              <WorldPanel
                environment={environment}
                onChange={changeEnvironment}
                display={display}
                onDisplayChange={changeDisplay}
                onReset={() => {
                  changeEnvironment(scene.environment);
                  setToast("World settings restored for this experiment.");
                }}
                onGuide={() => setGuide("models")}
              />
            ) : (
              <>
                <label className="body-picker">
                  Selected object
                  <select
                    aria-label="Select body"
                    value={selectedId ?? ""}
                    onChange={(e) => selectBody(e.target.value || null)}
                  >
                    <option value="">Choose a body...</option>
                    {bodies.map((body) => (
                      <option key={body.id} value={body.id}>
                        {body.label}
                        {body.fixed ? " (fixed)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <BodyPanel
                  key={selectedId}
                  body={selected}
                  onChange={changeBody}
                  onDelete={removeBody}
                  onDuplicate={duplicateBody}
                />
              </>
            )}
          </div>
          <div className="inspector-footer">
            <span className="tiny-dot" />
            <span>Classical mechanics. Endless curiosity.</span>
          </div>
        </aside>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span className="toast-icon">
            <Check size={15} />
          </span>
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {guide && <Guide initialTab={guide} onClose={() => setGuide(null)} />}
    </div>
  );
}
