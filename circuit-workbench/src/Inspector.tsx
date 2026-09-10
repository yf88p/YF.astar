import { useState } from "react";
import {
  ArrowDownToLine,
  ChevronRight,
  Copy,
  RotateCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { endpointKey } from "./types";
import type {
  CircuitDocument,
  Component,
  Endpoint,
  Netlist,
  Solution,
} from "./types";
import { formatEngineering, parseEngineering } from "./model";
import { Symbol } from "./Symbol";
import { units } from "./Canvas";

function Numeric({
  name,
  label,
  value,
  unit = "",
}: {
  name: string;
  label: string;
  value: number;
  unit?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-unit">
        <input
          name={name}
          aria-label={label}
          defaultValue={String(value)}
          autoComplete="off"
          spellCheck="false"
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}
const number = (data: FormData, key: string, unit?: string) =>
  parseEngineering(String(data.get(key)), unit);
function endpoints(
  doc: CircuitDocument,
): { value: string; label: string; anchor: Endpoint }[] {
  return [
    ...doc.components.flatMap((c) =>
      (c.type === "ground" ? [0] : [0, 1]).map((p) => ({
        value: `${c.id}:${p}`,
        label: `${c.id} / pin ${p}${c.type === "voltage" ? (p === 0 ? " (+)" : " (-)") : ""}`,
        anchor: { kind: "pin", componentId: c.id, pin: p } as Endpoint,
      })),
    ),
    ...doc.junctions.map((j) => ({
      value: `j:${j.id}`,
      label: `${j.id} / junction`,
      anchor: { kind: "junction", junctionId: j.id } as Endpoint,
    })),
  ];
}
type Props = {
  doc: CircuitDocument;
  selected: string | null;
  revision: number;
  onChange: (doc: CircuitDocument) => boolean;
  onError: (error: string) => void;
  onDelete: () => void;
  onRotate: () => void;
  onDuplicate: () => void;
  tab: "inspect" | "analysis" | "readings";
  setTab: (tab: "inspect" | "analysis" | "readings") => void;
  solution: Solution | null;
  netlist: Netlist | null;
  onHighlight: (id: string) => void;
  onNetlist: () => void;
};

export default function Inspector(props: Props) {
  const {
    doc,
    selected,
    revision,
    onChange,
    onError,
    onDelete,
    onRotate,
    onDuplicate,
    tab,
    setTab,
    solution,
    netlist,
    onHighlight,
    onNetlist,
  } = props;
  const component = doc.components.find((c) => c.id === selected);
  const wire = doc.wires.find((w) => w.id === selected);
  const label = doc.labels.find((l) => l.id === selected);
  const probe = doc.probes.find((p) => p.id === selected);
  const junct = doc.junctions.find((j) => j.id === selected);
  const [waveType, setWaveType] = useState<string | null>(null);
  const effectiveWave =
    waveType?.split(":")[0] === `${selected}-${revision}`
      ? waveType.split(":")[1]
      : component?.waveform.type;
  function guarded(fn: () => void) {
    try {
      fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }
  function submitComponent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    guarded(() => {
      const next = structuredClone(doc),
        c = next.components.find((c) => c.id === selected)!;
      if (c.type !== "ground" && c.type !== "diode" && c.type !== "switch")
        c.value = number(data, "value", units[c.type]);
      if (c.type === "capacitor" || c.type === "inductor")
        c.initial = number(data, "initial", c.type === "capacitor" ? "V" : "A");
      if (c.type === "diode") {
        c.diode.is = number(data, "is", "A");
        c.diode.n = number(data, "n", "");
      }
      if (c.type === "switch") {
        c.switch.ron = number(data, "ron", "ohm");
        c.switch.roff = number(data, "roff", "ohm");
        c.switch.closed = data.get("closed") === "on";
        const times = String(data.get("toggles")).trim();
        c.switch.toggles = times
          ? times.split(",").map((time) => parseEngineering(time, "s"))
          : [];
      }
      if (c.type === "voltage" || c.type === "current") {
        c.waveform.type = data.get("waveform") as Component["waveform"]["type"];
        for (const key of [
          "offset",
          "amplitude",
          "frequency",
          "phase",
          "delay",
          "rise",
          "fall",
          "width",
          "period",
        ] as const)
          if (data.has(key))
            c.waveform[key] = number(
              data,
              key,
              key === "offset" || key === "amplitude"
                ? units[c.type]
                : key === "frequency"
                  ? "Hz"
                  : key === "phase"
                    ? "deg"
                    : "s",
            );
      }
      onChange(next);
    });
  }
  const refs = endpoints(doc);
  return (
    <aside className="inspector">
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Inspector panels"
      >
        {(["inspect", "analysis", "readings"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "inspect"
              ? "Inspect"
              : t === "analysis"
                ? "Analysis"
                : "Readings"}
          </button>
        ))}
      </div>
      <div className="inspector-content">
        {tab === "inspect" && (
          <>
            <div className="section-caption">
              PROPERTIES <SlidersHorizontal size={13} />
            </div>
            {component ? (
              <>
                <div className="part-summary">
                  <div className="part-symbol">
                    <svg viewBox="-48 -32 96 64">
                      <Symbol
                        type={component.type}
                        closed={component.switch.closed}
                      />
                    </svg>
                  </div>
                  <div>
                    <h2>{component.id}</h2>
                    <span>
                      {component.type[0].toUpperCase() +
                        component.type.slice(1)}
                    </span>
                  </div>
                  <span className="small-badge">
                    {component.rotation % 360}°
                  </span>
                </div>
                <form
                  key={`${selected}-${revision}`}
                  onSubmit={submitComponent}
                  className="property-form"
                >
                  {component.type !== "ground" &&
                    component.type !== "diode" &&
                    component.type !== "switch" && (
                      <Numeric
                        name="value"
                        label={
                          component.type === "voltage" ||
                          component.type === "current"
                            ? "DC value"
                            : component.type === "resistor"
                              ? "Resistance"
                              : component.type === "capacitor"
                                ? "Capacitance"
                                : "Inductance"
                        }
                        value={component.value}
                        unit={units[component.type]}
                      />
                    )}
                  {(component.type === "capacitor" ||
                    component.type === "inductor") && (
                    <>
                      <Numeric
                        name="initial"
                        label={
                          component.type === "capacitor"
                            ? "Initial voltage"
                            : "Initial current"
                        }
                        value={component.initial}
                        unit={component.type === "capacitor" ? "V" : "A"}
                      />
                      <p className="field-note">
                        Used in explicit-state initialization. Positive from pin
                        0 to pin 1.
                      </p>
                    </>
                  )}
                  {component.type === "diode" && (
                    <>
                      <Numeric
                        name="is"
                        label="Saturation current"
                        value={component.diode.is}
                        unit="A"
                      />
                      <Numeric
                        name="n"
                        label="Emission coefficient"
                        value={component.diode.n}
                      />
                      <div className="model-note">
                        Shockley model at 300 K<br />
                        <code>I = Is · (exp(V/nVT) - 1)</code>
                        <br />
                        No reverse breakdown or parasitic capacitance. Rotate to
                        change physical orientation; reconnect pins to reverse
                        electrical orientation.
                      </div>
                    </>
                  )}
                  {component.type === "switch" && (
                    <>
                      <Numeric
                        name="ron"
                        label="On resistance"
                        value={component.switch.ron}
                        unit="ohm"
                      />
                      <Numeric
                        name="roff"
                        label="Off resistance"
                        value={component.switch.roff}
                        unit="ohm"
                      />
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          name="closed"
                          defaultChecked={component.switch.closed}
                        />{" "}
                        Initially closed
                      </label>
                      <label className="field">
                        <span>Toggle times (seconds, comma separated)</span>
                        <input
                          name="toggles"
                          defaultValue={component.switch.toggles.join(", ")}
                          placeholder="1m, 3m, 4m"
                        />
                      </label>
                      <p className="field-note">
                        Distinct, increasing, nonnegative times. Finite
                        resistance in both states; Ron &lt; Roff.
                      </p>
                    </>
                  )}
                  {(component.type === "voltage" ||
                    component.type === "current") && (
                    <>
                      <label className="field">
                        <span>Transient waveform</span>
                        <select
                          name="waveform"
                          aria-label="Transient waveform"
                          defaultValue={component.waveform.type}
                          onChange={(e) =>
                            setWaveType(
                              `${selected}-${revision}:${e.target.value}`,
                            )
                          }
                        >
                          <option value="dc">Constant DC</option>
                          <option value="sine">Sine</option>
                          <option value="pulse">Pulse</option>
                        </select>
                      </label>
                      {effectiveWave !== "dc" && (
                        <>
                          <Numeric
                            name="offset"
                            label="Offset / low level"
                            value={component.waveform.offset}
                            unit={units[component.type]}
                          />
                          <Numeric
                            name="amplitude"
                            label="Amplitude / high minus low"
                            value={component.waveform.amplitude}
                            unit={units[component.type]}
                          />
                          <Numeric
                            name="delay"
                            label="Delay"
                            value={component.waveform.delay}
                            unit="s"
                          />
                          {effectiveWave === "sine" ? (
                            <>
                              <Numeric
                                name="frequency"
                                label="Frequency"
                                value={component.waveform.frequency}
                                unit="Hz"
                              />
                              <Numeric
                                name="phase"
                                label="Phase"
                                value={component.waveform.phase}
                                unit="deg"
                              />
                            </>
                          ) : (
                            <>
                              <Numeric
                                name="period"
                                label="Period"
                                value={component.waveform.period}
                                unit="s"
                              />
                              <Numeric
                                name="rise"
                                label="Rise time"
                                value={component.waveform.rise}
                                unit="s"
                              />
                              <Numeric
                                name="width"
                                label="High plateau width"
                                value={component.waveform.width}
                                unit="s"
                              />
                              <Numeric
                                name="fall"
                                label="Fall time"
                                value={component.waveform.fall}
                                unit="s"
                              />
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {component.type !== "ground" && (
                    <>
                      <p className="field-note">
                        SI prefixes accepted: <code>k M m u n p</code>. Case
                        matters. All fields apply together.
                      </p>
                      <button className="button apply-button" type="submit">
                        Apply component <ChevronRight size={14} />
                      </button>
                    </>
                  )}
                </form>
                <div className="part-actions">
                  <button title="Rotate selected (R)" onClick={onRotate}>
                    <RotateCw size={15} />
                    Rotate
                  </button>
                  <button
                    title="Duplicate selected (Ctrl+D)"
                    onClick={onDuplicate}
                  >
                    <Copy size={15} />
                    Copy
                  </button>
                  <button title="Delete selected (Delete)" onClick={onDelete}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="section-caption separated">
                  CONNECTIONS <span>PIN → NET</span>
                </div>
                {(component.type === "ground" ? [0] : [0, 1]).map((p) => {
                  const netId = netlist?.endpointNets[`${component.id}:${p}`],
                    net = netlist?.nets.find((n) => n.id === netId);
                  return (
                    <button
                      key={p}
                      className="connection-row"
                      onClick={() => netId && onHighlight(netId)}
                    >
                      <span className="pin-number">{p}</span>
                      <span>
                        {p === 0 && component.type === "diode"
                          ? "Anode"
                          : p === 1 && component.type === "diode"
                            ? "Cathode"
                            : component.type === "voltage"
                              ? p === 0
                                ? "Positive (+)"
                                : "Negative (-)"
                              : `Pin ${p}`}
                      </span>
                      <code>{net?.name ?? "Unresolved"}</code>
                    </button>
                  );
                })}
                {solution && component.type !== "ground" && (
                  <div className="current-readout">
                    <span>Signed branch current · 0 → 1</span>
                    <strong data-testid="selected-current">
                      {formatEngineering(solution.currents[component.id], "A")}
                    </strong>
                  </div>
                )}
              </>
            ) : wire ? (
              <>
                <h2 className="entity-title">Wire {wire.id}</h2>
                <p className="field-note">
                  Endpoints reference real pins or junctions. Reconnect here
                  without changing the route. Double-click a segment to add a
                  draggable bend.
                </p>
                <form
                  key={`${selected}-${revision}`}
                  className="property-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget),
                      next = structuredClone(doc),
                      w = next.wires.find((q) => q.id === selected)!;
                    w.a = refs.find((r) => r.value === data.get("a"))!.anchor;
                    w.b = refs.find((r) => r.value === data.get("b"))!.anchor;
                    onChange(next);
                  }}
                >
                  {(["a", "b"] as const).map((key) => (
                    <label className="field" key={key}>
                      <span>Endpoint {key.toUpperCase()}</span>
                      <select
                        name={key}
                        aria-label={`Endpoint ${key.toUpperCase()}`}
                        defaultValue={endpointKey(wire[key])}
                      >
                        {refs.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <button className="button apply-button">
                    Reconnect wire <ChevronRight size={14} />
                  </button>
                </form>
                <button
                  className="text-button"
                  onClick={() => {
                    const next = structuredClone(doc);
                    next.wires.find((w) => w.id === selected)!.bends = [];
                    onChange(next);
                  }}
                >
                  Clear route bends
                </button>
                <button className="text-button danger" onClick={onDelete}>
                  <Trash2 size={14} />
                  Delete wire
                </button>
              </>
            ) : label || probe ? (
              <>
                <h2 className="entity-title">
                  {label
                    ? "Net label"
                    : `${probe!.kind === "voltage" ? "Voltage" : "Current"} probe`}
                </h2>
                <form
                  key={`${selected}-${revision}`}
                  className="property-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget),
                      next = structuredClone(doc),
                      target = [...next.labels, ...next.probes].find(
                        (p) => p.id === selected,
                      )!;
                    target.name = String(data.get("name"));
                    if ("color" in target)
                      target.color = String(data.get("color"));
                    onChange(next);
                  }}
                >
                  <label className="field">
                    <span>Name</span>
                    <input
                      name="name"
                      aria-label="Name"
                      defaultValue={(label ?? probe)!.name}
                    />
                  </label>
                  {probe && (
                    <label className="field">
                      <span>Channel color</span>
                      <input
                        name="color"
                        type="color"
                        aria-label="Channel color"
                        defaultValue={probe.color}
                      />
                    </label>
                  )}
                  <button className="button apply-button">Apply changes</button>
                </form>
                <p className="field-note">
                  {label
                    ? "Labels name a net; identical names do not electrically connect different nets."
                    : "Probe readings are taken directly from the shared circuit solution. Add or change a probe, then rerun."}
                </p>
                <button className="text-button danger" onClick={onDelete}>
                  <Trash2 size={14} />
                  Remove {label ? "label" : "probe"}
                </button>
              </>
            ) : junct ? (
              <>
                <h2 className="entity-title">Junction {junct.id}</h2>
                <p className="field-note">
                  A solid dot is an explicit electrical connection. All wires
                  attached to this junction belong to one net. Drag the dot to
                  reroute attached wires.
                </p>
                <button className="text-button danger" onClick={onDelete}>
                  <Trash2 size={14} />
                  Delete junction & attached wires
                </button>
              </>
            ) : (
              <div className="inspector-empty">
                <SlidersHorizontal size={28} />
                <h3>A closer look.</h3>
                <p>
                  Select a component, wire, probe, or net label to edit its
                  properties.
                </p>
              </div>
            )}
          </>
        )}
        {tab === "analysis" && (
          <>
            <div className="section-caption">
              SIMULATION SETUP <span>LOCAL</span>
            </div>
            <h2 className="entity-title">Time & initial state</h2>
            <form
              className="property-form"
              key={`settings-${revision}`}
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                guarded(() => {
                  const next = structuredClone(doc);
                  next.settings = {
                    duration: number(data, "duration", "s"),
                    timestep: number(data, "timestep", "s"),
                    tolerance: number(data, "tolerance", ""),
                    initialization: data.get("initialization") as
                      | "dc"
                      | "explicit",
                  };
                  onChange(next);
                });
              }}
            >
              <Numeric
                name="duration"
                label="Duration"
                value={doc.settings.duration}
                unit="s"
              />
              <Numeric
                name="timestep"
                label="Maximum timestep"
                value={doc.settings.timestep}
                unit="s"
              />
              <Numeric
                name="tolerance"
                label="Nonlinear relative tolerance"
                value={doc.settings.tolerance}
              />
              <label className="field">
                <span>Initialization</span>
                <select
                  name="initialization"
                  aria-label="Initialization"
                  defaultValue={doc.settings.initialization}
                >
                  <option value="dc">Consistent DC operating point</option>
                  <option value="explicit">
                    Explicit capacitor / inductor states
                  </option>
                </select>
              </label>
              <p className="field-note">
                Explicit mode uses each capacitor's initial voltage and each
                inductor's initial current. Contradictory states are reported,
                never overwritten.
              </p>
              <button className="button apply-button">
                Apply settings <ChevronRight size={14} />
              </button>
            </form>
            <div className="model-note">
              <strong>Trapezoidal integration</strong>
              <p>
                Steps land on source edges and switch events. Tolerance controls
                Newton convergence, not waveform accuracy. Reduce the maximum
                timestep to check accuracy.
              </p>
              <p>
                DC analysis opens capacitors and shorts inductors. Transient DC
                initialization uses source values at t = 0.
              </p>
            </div>
            <div className="resource-note">
              <span>Requested nominal steps</span>
              <strong>
                {Math.ceil(
                  doc.settings.duration / doc.settings.timestep,
                ).toLocaleString()}
              </strong>
              <span>
                100,000 steps · 150 unknowns · 2M stored scalars maximum
              </span>
            </div>
          </>
        )}
        {tab === "readings" && (
          <>
            <div className="section-caption">
              SOLVED CIRCUIT{" "}
              <span>
                {solution
                  ? solution.time === 0
                    ? "DC / t=0"
                    : `t=${formatEngineering(solution.time, "s")}`
                  : "NO CAPTURE"}
              </span>
            </div>
            {!solution ? (
              <div className="inspector-empty">
                <ArrowDownToLine size={28} />
                <h3>Measure, don't guess.</h3>
                <p>
                  Run an analysis to inspect computed node potentials and signed
                  component currents.
                </p>
              </div>
            ) : (
              <>
                <h2 className="entity-title">Node potentials</h2>
                <p className="field-note">
                  Relative to ground. Click a net to highlight its wires.
                </p>
                <div className="readings-table">
                  {netlist?.nets.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => onHighlight(n.id)}
                      data-testid={`reading-${n.name}`}
                    >
                      <span>{n.name}</span>
                      <code>
                        {formatEngineering(solution.voltages[n.id], "V")}
                      </code>
                    </button>
                  ))}
                </div>
                <h2 className="entity-title separated">Branch currents</h2>
                <p className="field-note">
                  Signed positive from pin 0 to pin 1.
                </p>
                <div className="readings-table">
                  {netlist?.branches.map((b) => (
                    <div key={b.component.id}>
                      <span>{b.component.id}</span>
                      <code>
                        {formatEngineering(
                          solution.currents[b.component.id],
                          "A",
                        )}
                      </code>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <button className="netlist-link" onClick={onNetlist}>
        <span>
          <code>&gt;_</code> Inspect shared netlist
        </span>
        <ChevronRight size={15} />
      </button>
    </aside>
  );
}
