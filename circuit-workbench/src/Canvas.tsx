import { useEffect, useRef, useState } from "react";
import { Crosshair, Minus, Plus, Scan, MousePointer2 } from "lucide-react";
import {
  componentPins,
  createComponent,
  endpointPosition,
  formatEngineering,
} from "./model";
import { addJunction, crossings, nextId, wirePoints } from "./editor";
import { Symbol } from "./Symbol";
import { endpointKey, junction, pin } from "./types";
import type {
  CircuitDocument,
  ComponentType,
  Endpoint,
  Netlist,
  Point,
  Solution,
} from "./types";

export type Tool =
  | "select"
  | "wire"
  | "junction"
  | "voltageProbe"
  | "currentProbe"
  | "label"
  | "pan"
  | `place:${ComponentType}`;
export const units: Record<ComponentType, string> = {
  resistor: "ohm",
  capacitor: "F",
  inductor: "H",
  diode: "",
  voltage: "V",
  current: "A",
  switch: "ohm",
  ground: "",
};
const prefixes: Record<ComponentType, string> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  diode: "D",
  voltage: "V",
  current: "I",
  switch: "S",
  ground: "G",
};
const colors = [
  "#e28058",
  "#75a4ae",
  "#b3a275",
  "#99ad79",
  "#b497c5",
  "#d57e91",
];
type Props = {
  doc: CircuitDocument;
  onChange: (d: CircuitDocument) => boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  tool: Tool;
  onTool: (t: Tool) => void;
  netlist: Netlist | null;
  highlighted: string | null;
  onHighlight: (id: string | null) => void;
  solution: Solution | null;
  fitKey: number;
};
const snap = (p: Point): Point => ({
  x: Math.round(p.x / 20) * 20,
  y: Math.round(p.y / 20) * 20,
});

export default function Canvas({
  doc,
  onChange,
  selected,
  onSelect,
  tool,
  onTool,
  netlist,
  highlighted,
  onHighlight,
  solution,
  fitKey,
}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 450 });
  const [camera, setCamera] = useState({ x: 30, y: 80, scale: 1 });
  const [preview, setPreview] = useState<CircuitDocument | null>(null);
  const [wiring, setWiring] = useState<{ a: Endpoint; bends: Point[] } | null>(
    null,
  );
  const [pointer, setPointer] = useState<Point>({ x: 0, y: 0 });
  const drag = useRef<{
    kind: "component" | "junction" | "bend" | "pan";
    id: string;
    index?: number;
    start: Point;
    doc: CircuitDocument;
    camera: typeof camera;
    moved: boolean;
  } | null>(null);
  const shown = preview ?? doc;
  function fit() {
    const points = [
      ...doc.components,
      ...doc.junctions,
      ...doc.wires.flatMap((w) => w.bends),
    ];
    if (!points.length) {
      setCamera({ x: 0, y: 0, scale: 1 });
      return;
    }
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity;
    points.forEach((p) => {
      x1 = Math.min(x1, p.x);
      y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x);
      y2 = Math.max(y2, p.y);
    });
    const scale = Math.min(
      1.35,
      (size.width - 100) / (x2 - x1 + 140),
      (size.height - 105) / (y2 - y1 + 100),
    );
    setCamera({
      x: (x1 + x2) / 2 - size.width / scale / 2,
      y: (y1 + y2) / 2 - size.height / scale / 2,
      scale,
    });
  }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    fit();
    setWiring(null);
    setPreview(null);
  }, [fitKey, size.width, size.height]);
  useEffect(() => {
    if (tool !== "wire") setWiring(null);
  }, [tool]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        drag.current = null;
        setPreview(null);
        setWiring(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = el.getBoundingClientRect(),
        px = event.clientX - bounds.left,
        py = event.clientY - bounds.top;
      setCamera((c) => {
        if (event.shiftKey)
          return { ...c, x: c.x + (event.deltaY + event.deltaX) / c.scale };
        const scale = Math.max(
          0.2,
          Math.min(3.5, c.scale * Math.exp(-event.deltaY * 0.0015)),
        );
        return {
          x: c.x + px / c.scale - px / scale,
          y: c.y + py / c.scale - py / scale,
          scale,
        };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  function world(event: { clientX: number; clientY: number }) {
    const bounds = svg.current!.getBoundingClientRect();
    return {
      x: camera.x + (event.clientX - bounds.left) / camera.scale,
      y: camera.y + (event.clientY - bounds.top) / camera.scale,
    };
  }
  function startDrag(
    event: React.PointerEvent,
    kind: "component" | "junction" | "bend",
    id: string,
    index?: number,
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    drag.current = {
      kind,
      id,
      index,
      start: world(event),
      doc,
      camera,
      moved: false,
    };
    svg.current!.setPointerCapture(event.pointerId);
    onSelect(id);
  }
  function probe(anchor?: Endpoint, componentId?: string) {
    const next = structuredClone(doc),
      id = nextId(next, "P"),
      color = colors[next.probes.length % colors.length];
    if (anchor)
      next.probes.push({
        id,
        name: `V(${endpointKey(anchor)})`,
        kind: "voltage",
        anchor,
        color,
      });
    else if (componentId)
      next.probes.push({
        id,
        name: `I(${componentId})`,
        kind: "current",
        componentId,
        color,
      });
    if (onChange(next)) onSelect(id);
  }
  function endpointClick(event: React.PointerEvent, anchor: Endpoint) {
    if (event.button !== 0 || tool === "pan") return;
    event.stopPropagation();
    if (tool === "wire") {
      if (!wiring) setWiring({ a: anchor, bends: [] });
      else if (endpointKey(wiring.a) !== endpointKey(anchor)) {
        const next = structuredClone(doc);
        next.wires.push({
          id: nextId(next, "W"),
          a: wiring.a,
          b: anchor,
          bends: wiring.bends,
        });
        if (onChange(next)) setWiring(null);
      } else setWiring(null);
    } else if (tool === "voltageProbe") probe(anchor);
    else if (tool === "label") {
      const next = structuredClone(doc),
        id = nextId(next, "NET");
      next.labels.push({ id, name: id, anchor });
      if (onChange(next)) {
        onSelect(id);
        onTool("select");
      }
    } else {
      onHighlight(netlist?.endpointNets[endpointKey(anchor)] ?? null);
      if (anchor.kind === "junction")
        startDrag(event, "junction", anchor.junctionId);
      else onSelect(anchor.componentId);
    }
  }
  function background(event: React.PointerEvent) {
    if (event.button === 1 || (event.button === 0 && tool === "pan")) {
      event.preventDefault();
      drag.current = {
        kind: "pan",
        id: "",
        start: { x: event.clientX, y: event.clientY },
        doc,
        camera,
        moved: false,
      };
      svg.current!.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const p = snap(world(event));
    if (tool.startsWith("place:")) {
      const type = tool.slice(6) as ComponentType,
        next = structuredClone(doc),
        id = nextId(next, prefixes[type]);
      next.components.push(createComponent(type, id, p.x, p.y));
      if (onChange(next)) {
        onSelect(id);
        onTool("select");
      }
    } else if (tool === "junction") {
      const result = addJunction(doc, p);
      if (onChange(result.doc))
        onSelect(
          result.anchor.kind === "junction" ? result.anchor.junctionId : null,
        );
    } else if (tool === "wire" && wiring)
      setWiring({ ...wiring, bends: [...wiring.bends, p] });
    else {
      onSelect(null);
      onHighlight(null);
    }
  }
  function move(event: React.PointerEvent) {
    const p = world(event);
    setPointer(snap(p));
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      setCamera({
        ...d.camera,
        x: d.camera.x - (event.clientX - d.start.x) / d.camera.scale,
        y: d.camera.y - (event.clientY - d.start.y) / d.camera.scale,
      });
      return;
    }
    const delta = snap({ x: p.x - d.start.x, y: p.y - d.start.y });
    d.moved = delta.x !== 0 || delta.y !== 0;
    const next = structuredClone(d.doc);
    const target =
      d.kind === "component"
        ? next.components.find((c) => c.id === d.id)
        : d.kind === "junction"
          ? next.junctions.find((j) => j.id === d.id)
          : next.wires.find((w) => w.id === d.id)?.bends[d.index!];
    if (target) {
      target.x += delta.x;
      target.y += delta.y;
    }
    setPreview(next);
  }
  function finish(event: React.PointerEvent) {
    if (drag.current?.moved && preview) onChange(preview);
    drag.current = null;
    setPreview(null);
    if (svg.current?.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId);
  }
  const crossingPoints = crossings(shown);
  const hint = tool.startsWith("place:")
    ? `Click the grid to place a ${tool.slice(6)}`
    : (
        {
          select: "Select a part to inspect. Drag to move.",
          wire: wiring
            ? "Click to bend. Finish on a pin or junction. Esc cancels."
            : "Click a pin or junction to start a wire.",
          junction:
            "Click a wire or crossing to join all segments under the dot.",
          voltageProbe: "Click a pin or junction to measure voltage.",
          currentProbe: "Click a component to measure signed current.",
          label: "Click a pin or junction, then name the net in the inspector.",
          pan: "Drag to pan. Scroll to zoom at the cursor.",
        } as Record<string, string>
      )[tool];
  return (
    <div className={`canvas-wrap tool-${tool.replace(":", "-")}`}>
      <div className="canvas-heading">
        <span className="eyebrow">SCHEMATIC / 01</span>
        <span className="canvas-chip">
          <span className="status-dot" /> Editable topology
        </span>
      </div>
      <svg
        ref={svg}
        className="schematic"
        aria-label="Circuit schematic editor"
        data-testid="schematic"
        viewBox={`${camera.x} ${camera.y} ${size.width / camera.scale} ${size.height / camera.scale}`}
        onPointerDown={background}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={() => {
          drag.current = null;
          setPreview(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern
            id="grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0" cy="0" r="0.85" fill="#c8cec7" />
          </pattern>
        </defs>
        <rect
          x={camera.x}
          y={camera.y}
          width={size.width / camera.scale}
          height={size.height / camera.scale}
          fill="url(#grid)"
        />
        {shown.wires.map((w) => {
          const active =
            highlighted &&
            netlist?.endpointNets[endpointKey(w.a)] === highlighted;
          const points = wirePoints(shown, w)
            .map((p) => `${p.x},${p.y}`)
            .join(" ");
          return (
            <g
              key={w.id}
              data-testid={`wire-${w.id}`}
              className={`wire ${selected === w.id ? "selected" : ""} ${active ? "highlighted" : ""}`}
            >
              <polyline
                points={points}
                className="wire-hit"
                onPointerDown={(e) => {
                  if (tool === "select" && e.button === 0) {
                    e.stopPropagation();
                    onSelect(w.id);
                    onHighlight(
                      netlist?.endpointNets[endpointKey(w.a)] ?? null,
                    );
                  }
                }}
                onDoubleClick={(e) => {
                  if (tool !== "select") return;
                  e.stopPropagation();
                  const next = structuredClone(doc),
                    p = snap(world(e)),
                    list = wirePoints(doc, w);
                  let best = 0,
                    distance = Infinity;
                  for (let i = 0; i < list.length - 1; i++) {
                    const a = list[i],
                      b = list[i + 1],
                      dx = b.x - a.x,
                      dy = b.y - a.y,
                      t = Math.max(
                        0,
                        Math.min(
                          1,
                          ((p.x - a.x) * dx + (p.y - a.y) * dy) /
                            (dx * dx + dy * dy || 1),
                        ),
                      );
                    const dist = Math.hypot(
                      p.x - a.x - t * dx,
                      p.y - a.y - t * dy,
                    );
                    if (dist < distance) {
                      best = i;
                      distance = dist;
                    }
                  }
                  next.wires
                    .find((q) => q.id === w.id)!
                    .bends.splice(best, 0, p);
                  onChange(next);
                }}
              />
              <polyline points={points} className="wire-line" />
              {selected === w.id &&
                w.bends.map((p, index) => (
                  <rect
                    key={index}
                    x={p.x - 5}
                    y={p.y - 5}
                    width="10"
                    height="10"
                    className="bend-handle"
                    onPointerDown={(e) => startDrag(e, "bend", w.id, index)}
                  />
                ))}
            </g>
          );
        })}
        {crossingPoints.map((p, i) => (
          <g
            key={i}
            transform={`translate(${p.x} ${p.y})`}
            pointerEvents="none"
          >
            <circle r="6" fill="#f6f7f2" />
            <path
              d="M-7 0 Q0 -11 7 0"
              fill="none"
              stroke="#6c827b"
              strokeWidth="2"
            />
          </g>
        ))}
        {shown.components.map((c) => {
          const source = c.type === "voltage" || c.type === "current";
          const value =
            c.type === "ground"
              ? ""
              : c.type === "diode"
                ? `Is ${formatEngineering(c.diode.is, "A")}`
                : c.type === "switch"
                  ? c.switch.closed
                    ? "CLOSED"
                    : "OPEN"
                  : source && c.waveform.type !== "dc"
                    ? `${c.waveform.type.toUpperCase()} ${formatEngineering(c.waveform.type === "pulse" ? c.waveform.period : c.waveform.frequency, c.waveform.type === "pulse" ? "s" : "Hz")}`
                    : formatEngineering(c.value, units[c.type]);
          const vertical =
            Math.abs(Math.sin((c.rotation * Math.PI) / 180)) > 0.5;
          return (
            <g key={c.id} data-testid={`component-${c.id}`}>
              <g
                transform={`translate(${c.x} ${c.y}) rotate(${c.rotation})`}
                className={`component ${selected === c.id ? "selected" : ""}`}
                onPointerDown={(e) => {
                  if (tool === "currentProbe" && c.type !== "ground") {
                    e.stopPropagation();
                    probe(undefined, c.id);
                  } else if (tool === "select") startDrag(e, "component", c.id);
                }}
              >
                <rect
                  x="-31"
                  y="-29"
                  width="62"
                  height="58"
                  rx="7"
                  className="component-hit"
                  style={
                    c.type === "ground" ? { fill: "transparent" } : undefined
                  }
                />
                <Symbol
                  type={c.type}
                  closed={c.switch.closed}
                  rotation={c.rotation}
                />
                {c.type !== "ground" && (
                  <g className="reference-arrow">
                    <path d="M-12 34H12 M7 30L12 34 7 38" />
                    <text x="-3" y="46">
                      i
                    </text>
                  </g>
                )}
              </g>
              <g
                className="component-label"
                transform={`translate(${c.x + (c.type === "ground" ? 27 : vertical ? 42 : 0)} ${c.y + (c.type === "ground" ? 21 : vertical ? -4 : -43)})`}
                textAnchor={
                  vertical || c.type === "ground" ? "start" : "middle"
                }
                pointerEvents="none"
              >
                <text className="component-id">{c.id}</text>
                <text y="17" className="component-value">
                  {value}
                </text>
              </g>
              {componentPins(c).map((p, index) => {
                const anchor = pin(c.id, index as 0 | 1),
                  key = endpointKey(anchor),
                  connected = doc.wires.some(
                    (w) => endpointKey(w.a) === key || endpointKey(w.b) === key,
                  );
                return (
                  <g
                    key={index}
                    data-testid={`pin-${c.id}-${index}`}
                    className={`pin ${connected ? "connected" : "unconnected"} ${wiring && endpointKey(wiring.a) === key ? "wiring" : ""}`}
                    onPointerDown={(e) => endpointClick(e, anchor)}
                  >
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="10"
                      fill="transparent"
                      stroke="none"
                    />
                    <circle cx={p.x} cy={p.y} r="3.6" className="pin-dot" />
                    <title>
                      {c.id} pin {index}
                      {source ? (index === 0 ? " (+)" : " (-)") : ""},{" "}
                      {connected ? "wired" : "unconnected"}
                    </title>
                  </g>
                );
              })}
            </g>
          );
        })}
        {shown.junctions.map((j) => (
          <g
            key={j.id}
            data-testid={`junction-${j.id}`}
            className={`junction ${selected === j.id ? "selected" : ""}`}
            onPointerDown={(e) => endpointClick(e, junction(j.id))}
          >
            <circle cx={j.x} cy={j.y} r="11" fill="transparent" />
            <circle cx={j.x} cy={j.y} r="5" className="junction-dot" />
            <title>{j.id}: explicit electrical junction</title>
          </g>
        ))}
        {shown.labels.map((l) => {
          const p = endpointPosition(shown, l.anchor);
          return (
            <g
              key={l.id}
              transform={`translate(${p.x + 10} ${p.y - 18})`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(l.id);
                onHighlight(
                  netlist?.endpointNets[endpointKey(l.anchor)] ?? null,
                );
              }}
              className="net-label"
            >
              <rect
                x="-4"
                y="-13"
                width={l.name.length * 7 + 10}
                height="18"
                rx="3"
              />
              <text>{l.name}</text>
            </g>
          );
        })}
        {shown.probes.map((p, index) => {
          const position =
            p.kind === "voltage"
              ? endpointPosition(shown, p.anchor)
              : shown.components.find((c) => c.id === p.componentId)!;
          const v = solution
            ? p.kind === "voltage"
              ? solution.voltages[netlist!.endpointNets[endpointKey(p.anchor)]]
              : solution.currents[p.componentId]
            : null;
          return (
            <g
              key={p.id}
              className="probe-overlay"
              style={{ color: p.color }}
              transform={`translate(${position.x + (p.kind === "voltage" ? -20 : -32)} ${position.y + (p.kind === "voltage" ? -20 : 58)})`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(p.id);
              }}
            >
              <circle r="9" />
              <text textAnchor="middle" y="3">
                {index + 1}
              </text>
              <text
                className="probe-reading"
                x={p.kind === "voltage" ? -15 : 15}
                textAnchor={p.kind === "voltage" ? "end" : "start"}
                y="4"
              >
                {v != null && Number.isFinite(v)
                  ? formatEngineering(v, p.kind === "voltage" ? "V" : "A")
                  : p.kind === "voltage"
                    ? "V"
                    : "A"}
              </text>
            </g>
          );
        })}
        {wiring && (
          <polyline
            points={[
              endpointPosition(shown, wiring.a),
              ...wiring.bends,
              pointer,
            ]
              .map((p) => `${p.x},${p.y}`)
              .join(" ")}
            className="wire-preview"
          />
        )}
        {tool.startsWith("place:") && (
          <g
            pointerEvents="none"
            opacity="0.4"
            transform={`translate(${pointer.x} ${pointer.y})`}
          >
            <Symbol type={tool.slice(6) as ComponentType} />
          </g>
        )}
      </svg>
      {!doc.components.length && (
        <div className="empty-canvas">
          <MousePointer2 size={26} />
          <h2>Make your first connection.</h2>
          <p>
            Choose a component from the library,
            <br />
            then click anywhere on the grid.
          </p>
        </div>
      )}
      <div className="canvas-bottom">
        <span className="canvas-hint">
          <Crosshair size={13} />
          {hint}
        </span>
        <div className="canvas-zoom">
          <button
            title="Zoom out"
            onClick={() =>
              setCamera((c) => ({ ...c, scale: Math.max(0.2, c.scale / 1.2) }))
            }
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(camera.scale * 100)}%</span>
          <button
            title="Zoom in"
            onClick={() =>
              setCamera((c) => ({ ...c, scale: Math.min(3.5, c.scale * 1.2) }))
            }
          >
            <Plus size={14} />
          </button>
          <button title="Fit circuit" onClick={fit}>
            <Scan size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
