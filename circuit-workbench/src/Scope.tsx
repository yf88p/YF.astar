import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";
import { formatEngineering } from "./model";
import {
  endpointKey,
  type CircuitDocument,
  type Netlist,
  type Probe,
  type Solution,
} from "./types";
import "./scope.css";

export type ScopeProps = {
  doc: CircuitDocument;
  netlist: Netlist | null;
  samples: Solution[] | null;
  stale: boolean;
  onExport: () => void;
};

/** Missing or nonfinite measurements are NaN, never an invented zero.
 * Voltage is relative to ground; current is positive from component pin 0 to 1.
 */
export function probeValue(
  probe: Probe,
  net: Netlist | null,
  solution: Solution,
): number {
  const node =
    probe.kind === "voltage" && net
      ? net.endpointNets[endpointKey(probe.anchor)]
      : undefined;
  const value =
    probe.kind === "current"
      ? solution.currents[probe.componentId]
      : node === undefined
        ? NaN
        : solution.voltages[node];
  return Number.isFinite(value) ? value : NaN;
}

type Statistics = {
  count: number;
  min: number;
  max: number;
  mean: number;
  rms: number;
  peakToPeak: number;
};
type Channel = {
  probe: Probe;
  values: Float64Array;
  stats: Statistics;
  unit: "V" | "A";
};
type Cursor = "A" | "B";
type Window = { start: number; end: number };
type Axis = { min: number; max: number; ticks: number[] };
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const exact = (value: number, unit: string) =>
  Number.isFinite(value) ? `${value} ${unit}` : "Unavailable";

function lowerBound(samples: Solution[], time: number, after = false): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle].time < time || (after && samples[middle].time === time))
      low = middle + 1;
    else high = middle;
  }
  return low;
}

function nearestSample(samples: Solution[], time: number): number {
  if (!samples.length) return -1;
  const right = lowerBound(samples, time, true);
  if (right === 0) return 0;
  if (right === samples.length) return right - 1;
  // Exact duplicate timestamps select the last (right-continuous) sample.
  return time - samples[right - 1].time < samples[right].time - time
    ? right - 1
    : right;
}

function calibratedAxis(channels: Channel[], kind: Probe["kind"]): Axis | null {
  let min = Infinity;
  let max = -Infinity;
  for (const channel of channels)
    if (channel.probe.kind === kind && channel.stats.count) {
      min = Math.min(min, channel.stats.min);
      max = Math.max(max, channel.stats.max);
    }
  if (!Number.isFinite(min)) return null;
  const padding = (max - min) * 0.07 || Math.abs(min) * 0.1 || 1;
  const low = min - padding;
  const high = max + padding;
  const roughStep = (high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step =
    (normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10) * magnitude;
  // Very large or subnormal measurements may not admit padded, rounded ticks.
  if (
    !(step > 0) ||
    !Number.isFinite(step) ||
    !Number.isFinite(low) ||
    !Number.isFinite(high)
  ) {
    return {
      min,
      max: max === min ? min + Math.abs(min) * Number.EPSILON : max,
      ticks: min === max ? [min] : [min, max],
    };
  }
  min = Math.floor(low / step) * step;
  max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  const divisions = Math.round((max - min) / step);
  for (let i = 0; i <= divisions; i++)
    ticks.push(Number((min + step * i).toPrecision(12)));
  return { min, max, ticks };
}

/** At most four original samples per horizontal bucket: first, min, max, last.
 * Preserve their temporal order and gap identities, not a smoothed waveform.
 */
function envelopePath(
  samples: Solution[],
  values: Float64Array,
  view: Window,
  axis: Axis,
  plot: { x: number; y: number; width: number; height: number },
): string {
  type Vertex = { index: number; segment: number };
  type Bucket = { first: Vertex; last: Vertex; min: Vertex; max: Vertex };
  const count = Math.max(1, Math.min(1200, Math.ceil(plot.width)));
  const buckets: (Bucket | undefined)[] = new Array(count);
  const start = Math.max(0, lowerBound(samples, view.start) - 1);
  const end = Math.min(samples.length, lowerBound(samples, view.end, true) + 1);
  const span = view.end - view.start;
  let segment = 0;
  for (let index = start; index < end; index++) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      segment++;
      continue;
    }
    const column = clamp(
      Math.floor(((samples[index].time - view.start) / span) * count),
      0,
      count - 1,
    );
    const vertex = { index, segment };
    const bucket = buckets[column];
    if (!bucket)
      buckets[column] = {
        first: vertex,
        last: vertex,
        min: vertex,
        max: vertex,
      };
    else {
      bucket.last = vertex;
      if (value < values[bucket.min.index]) bucket.min = vertex;
      if (value > values[bucket.max.index]) bucket.max = vertex;
    }
  }
  const commands: string[] = [];
  let previousIndex = -1;
  let previousSegment = -1;
  const magnitude = Math.max(Math.abs(axis.min), Math.abs(axis.max)) || 1;
  const ySpan = axis.max / magnitude - axis.min / magnitude || 1;
  for (const bucket of buckets)
    if (bucket) {
      const vertices = [bucket.first, bucket.min, bucket.max, bucket.last].sort(
        (a, b) => a.index - b.index,
      );
      for (const vertex of vertices) {
        if (vertex.index === previousIndex) continue;
        const x =
          plot.x +
          ((samples[vertex.index].time - view.start) / span) * plot.width;
        const y =
          plot.y +
          ((axis.max / magnitude - values[vertex.index] / magnitude) / ySpan) *
            plot.height;
        const point = `${x.toFixed(2)},${y.toFixed(2)}`;
        // A zero-length round-capped segment also makes isolated/DC samples visible.
        commands.push(
          vertex.segment === previousSegment
            ? `L${point}`
            : `M${point}L${point}`,
        );
        previousIndex = vertex.index;
        previousSegment = vertex.segment;
      }
    }
  return commands.join("");
}

export default function Scope({
  doc,
  netlist,
  samples,
  stale,
  onExport,
}: ScopeProps) {
  const id = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ cursor: Cursor; pointerId: number } | null>(null);
  const [size, setSize] = useState({ width: 800, height: 160 });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [activeCursor, setActiveCursor] = useState<Cursor>("A");
  const [navigation, setNavigation] = useState<
    (Window & { source: Solution[] | null }) | null
  >(null);
  const [positions, setPositions] = useState<{
    source: Solution[] | null;
    A: number;
    B: number;
  } | null>(null);

  // Cache full-resolution extraction/statistics so cursor motion never rescans a run.
  const { timeline, channels } = useMemo(() => {
    const timeline = (samples ?? []).filter((sample) =>
      Number.isFinite(sample.time),
    );
    if (
      timeline.some(
        (sample, index) => index > 0 && sample.time < timeline[index - 1].time,
      )
    ) {
      timeline.sort((a, b) => a.time - b.time);
    }
    const channels: Channel[] = doc.probes.map((probe) => {
      const values = new Float64Array(timeline.length);
      let count = 0;
      let min = Infinity;
      let max = -Infinity;
      let mean = 0;
      let scale = 0;
      let squares = 0;
      timeline.forEach((sample, index) => {
        const value = probeValue(probe, netlist, sample);
        values[index] = value;
        if (!Number.isFinite(value)) return;
        count++;
        min = Math.min(min, value);
        max = Math.max(max, value);
        mean = mean * ((count - 1) / count) + value / count;
        // Scaled sum of squares avoids overflowing before taking the RMS root.
        const absolute = Math.abs(value);
        if (absolute > scale) {
          squares = squares * (scale / absolute) ** 2 + 1;
          scale = absolute;
        } else if (scale) squares += (absolute / scale) ** 2;
      });
      return {
        probe,
        values,
        unit: probe.kind === "voltage" ? "V" : "A",
        stats: {
          count,
          min,
          max,
          mean: count ? mean : NaN,
          rms: count ? scale * Math.sqrt(squares / count) : NaN,
          peakToPeak: count ? max - min : NaN,
        },
      };
    });
    return { timeline, channels };
  }, [samples, netlist, doc.probes]);

  const firstTime = timeline[0]?.time ?? 0;
  const lastTime = timeline[timeline.length - 1]?.time ?? firstTime;
  const fullSpan = lastTime - firstTime;
  const hasSamples = timeline.length > 0;
  const canNavigate = hasSamples && fullSpan > 0;
  const singleSpan = Math.max(
    Math.abs(firstTime) * 0.1,
    Number.isFinite(doc.settings.timestep) && doc.settings.timestep > 0
      ? doc.settings.timestep
      : 1e-3,
  );
  const fullView = {
    start: firstTime,
    end: canNavigate ? lastTime : firstTime + singleSpan,
  };
  const view =
    navigation?.source === samples && canNavigate ? navigation : fullView;
  const span = view.end - view.start;
  const minimumSpan = Math.min(
    fullSpan,
    Math.max(
      fullSpan / 1e6,
      Math.max(Math.abs(firstTime), Math.abs(lastTime)) * Number.EPSILON * 32,
    ),
  );
  const indices = {
    A: nearestSample(
      timeline,
      positions?.source === samples ? positions.A : firstTime + fullSpan * 0.25,
    ),
    B: nearestSample(
      timeline,
      positions?.source === samples ? positions.B : firstTime + fullSpan * 0.75,
    ),
  };
  const times = {
    A: timeline[indices.A]?.time ?? firstTime,
    B: timeline[indices.B]?.time ?? firstTime,
  };
  const delta = times.B - times.A;
  const frequency = delta === 0 ? NaN : 1 / Math.abs(delta);
  const enabled = channels.filter((channel) => !hidden.has(channel.probe.id));
  const voltageAxis = calibratedAxis(enabled, "voltage");
  const currentAxis = calibratedAxis(enabled, "current");
  const hasTraces = enabled.some((channel) => channel.stats.count > 0);
  const compact = size.width < 480;
  const plot = {
    x: compact ? 53 : 65,
    y: 22,
    width: Math.max(1, size.width - (compact ? 106 : 130)),
    height: Math.max(1, size.height - 48),
  };
  const timeDivisions = compact ? 4 : 8;
  const gridAxis = voltageAxis ?? currentAxis;
  const yPosition = (value: number, axis: Axis) => {
    const magnitude = Math.max(Math.abs(axis.min), Math.abs(axis.max)) || 1;
    return (
      plot.y +
      ((axis.max / magnitude - value / magnitude) /
        (axis.max / magnitude - axis.min / magnitude || 1)) *
        plot.height
    );
  };
  const paths = useMemo(() => {
    const enabled = channels.filter((channel) => !hidden.has(channel.probe.id));
    const voltage = calibratedAxis(enabled, "voltage");
    const current = calibratedAxis(enabled, "current");
    return enabled.map((channel) => {
      const axis = channel.probe.kind === "voltage" ? voltage : current;
      return {
        channel,
        path:
          axis && channel.stats.count
            ? envelopePath(
                timeline,
                channel.values,
                { start: view.start, end: view.end },
                axis,
                plot,
              )
            : "",
      };
    });
  }, [
    channels,
    hidden,
    timeline,
    view.start,
    view.end,
    plot.x,
    plot.y,
    plot.width,
    plot.height,
  ]);

  function changeWindow(start: number, nextSpan: number) {
    if (!canNavigate) return;
    const width = clamp(nextSpan, minimumSpan, fullSpan);
    const left = clamp(start, firstTime, lastTime - width);
    setNavigation({
      source: samples,
      start: left,
      end: Math.min(lastTime, left + width),
    });
  }

  function zoom(factor: number, ratio = 0.5) {
    const nextSpan = clamp(span * factor, minimumSpan, fullSpan);
    changeWindow(view.start + span * ratio - nextSpan * ratio, nextSpan);
  }

  function placeCursor(cursor: Cursor, time: number) {
    const index = nearestSample(timeline, time);
    if (index < 0) return;
    setPositions({ source: samples, ...times, [cursor]: timeline[index].time });
  }

  function pointerTime(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * size.width;
    return view.start + clamp((x - plot.x) / plot.width, 0, 1) * span;
  }

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setSize((previous) =>
        bounds.width === previous.width && bounds.height === previous.height
          ? previous
          : {
              width: Math.max(1, bounds.width),
              height: Math.max(1, bounds.height),
            },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!canNavigate) return;
      event.preventDefault();
      const multiplier =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const distance = event.deltaX || event.deltaY;
        changeWindow(
          view.start + ((distance * multiplier) / plot.width) * span,
          span,
        );
      } else {
        const ratio = clamp(
          (event.clientX - element.getBoundingClientRect().left - plot.x) /
            plot.width,
          0,
          1,
        );
        zoom(
          Math.exp(clamp(event.deltaY * multiplier, -200, 200) * 0.004),
          ratio,
        );
      }
    };
    // React's delegated wheel listener is passive; the instrument owns this gesture.
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [
    canNavigate,
    samples,
    firstTime,
    lastTime,
    fullSpan,
    minimumSpan,
    view.start,
    span,
    plot.x,
    plot.width,
    size.height,
  ]);

  const emptyTitle = !hasSamples
    ? "A quiet bench. Ready to measure."
    : !channels.length
      ? "Choose a point of view."
      : !enabled.length
        ? "All channels are hidden."
        : "No matching measurements.";
  const emptyDescription = !hasSamples
    ? "Add probes to your circuit and run a simulation."
    : !channels.length
      ? "Add a voltage or current probe to inspect these results."
      : !enabled.length
        ? "Switch on a channel above to bring its trace back."
        : "These probes are not present in this result. Run the circuit again.";

  return (
    <section
      className={`scope${stale ? " scope--stale" : ""}`}
      aria-labelledby={`${id}-heading`}
      data-testid="scope"
    >
      <header className="scope-header">
        <div className="scope-heading">
          <span className="scope-mark" aria-hidden="true">
            <Activity size={19} strokeWidth={1.6} />
          </span>
          <h2 id={`${id}-heading`}>Oscilloscope</h2>
          <span
            className={`scope-status${stale ? " scope-status--stale" : ""}`}
            role="status"
            data-testid="scope-status"
          >
            <span aria-hidden="true" />
            {stale ? "Stale results" : hasSamples ? "Captured" : "Awaiting run"}
          </span>
        </div>
        <div
          className="scope-controls"
          role="group"
          aria-label="Time navigation and export"
        >
          <div className="scope-button-group">
            <button
              type="button"
              aria-label="Pan time left"
              title="Pan left by 20% of the window"
              data-testid="scope-pan-left"
              disabled={!canNavigate || view.start <= firstTime}
              onClick={() => changeWindow(view.start - span * 0.2, span)}
            >
              <ArrowLeft size={15} />
            </button>
            <button
              type="button"
              aria-label="Pan time right"
              title="Pan right by 20% of the window"
              data-testid="scope-pan-right"
              disabled={!canNavigate || view.end >= lastTime}
              onClick={() => changeWindow(view.start + span * 0.2, span)}
            >
              <ArrowRight size={15} />
            </button>
            <span className="scope-control-divider" />
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out 2x"
              data-testid="scope-zoom-out"
              disabled={!canNavigate || span >= fullSpan}
              onClick={() => zoom(2)}
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in 2x"
              data-testid="scope-zoom-in"
              disabled={!canNavigate || span <= minimumSpan}
              onClick={() => zoom(0.5)}
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              aria-label="Fit full time range"
              title="Fit the complete capture (0)"
              data-testid="scope-fit"
              disabled={!canNavigate}
              onClick={() => setNavigation(null)}
            >
              <Maximize2 size={14} />
              <span>Fit</span>
            </button>
          </div>
          <button
            type="button"
            className="scope-export"
            title={
              stale
                ? "Run the circuit again before exporting"
                : !hasSamples
                  ? "Run a simulation before exporting"
                  : "Export the full-resolution capture, not just visible traces"
            }
            disabled={stale || !hasSamples}
            onClick={onExport}
            data-testid="scope-export"
          >
            <ArrowDownToLine size={15} />
            CSV
          </button>
        </div>
      </header>

      <div className="scope-instrument">
        <div className="scope-channel-bar">
          <div
            className="scope-channels"
            role="group"
            aria-label="Visible probe channels"
          >
            {channels.length === 0 && (
              <span className="scope-no-probes">NO PROBES CONNECTED</span>
            )}
            {channels.map(({ probe, unit, stats }, index) => (
              <button
                key={probe.id}
                type="button"
                className="scope-channel"
                style={{ "--channel-color": probe.color } as CSSProperties}
                aria-pressed={!hidden.has(probe.id)}
                aria-label={`${probe.name}, ${probe.kind} channel`}
                title={`${hidden.has(probe.id) ? "Show" : "Hide"} ${probe.name} (${unit})${stats.count ? "" : " - no matching data"}`}
                data-testid={`scope-channel-${probe.id}`}
                onClick={() =>
                  setHidden((previous) => {
                    const next = new Set(previous);
                    if (next.has(probe.id)) next.delete(probe.id);
                    else next.add(probe.id);
                    return next;
                  })
                }
              >
                <span className="scope-channel-dot" aria-hidden="true" />
                <span className="scope-channel-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="scope-channel-name">{probe.name}</span>
                <span className="scope-channel-unit">{unit}</span>
              </button>
            ))}
          </div>
          <span
            className="scope-capture-info"
            title="Vertical axes auto-fit enabled channels over the full record. Statistics use every finite sample, with equal sample weighting."
          >
            <span className="scope-gesture-hint">
              Wheel: zoom / Shift + wheel: pan
            </span>
            {timeline.length.toLocaleString()} samples
            <span aria-hidden="true"> / </span>Full-record stats
          </span>
        </div>

        <div className="scope-display">
          <div className="scope-plot" ref={plotRef}>
            <svg
              className="scope-svg"
              width="100%"
              height="100%"
              viewBox={`0 0 ${size.width} ${size.height}`}
              tabIndex={hasSamples ? 0 : -1}
              role="group"
              aria-label="Oscilloscope plot: voltage on the left, current on the right, time in seconds"
              aria-describedby={`${id}-help`}
              data-testid="scope-plot"
              data-view-start={view.start}
              data-view-end={view.end}
              onKeyDown={(event) => {
                if (!canNavigate || event.target !== event.currentTarget)
                  return;
                if (event.key === "ArrowLeft")
                  changeWindow(view.start - span * 0.2, span);
                else if (event.key === "ArrowRight")
                  changeWindow(view.start + span * 0.2, span);
                else if (event.key === "+" || event.key === "=") zoom(0.5);
                else if (event.key === "-") zoom(2);
                else if (event.key === "0" || event.key === "Home")
                  setNavigation(null);
                else return;
                event.preventDefault();
              }}
              onPointerDown={(event) => {
                if (!hasSamples || event.button !== 0) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const x =
                  ((event.clientX - bounds.left) / bounds.width) * size.width;
                const y =
                  ((event.clientY - bounds.top) / bounds.height) * size.height;
                if (
                  x < plot.x ||
                  x > plot.x + plot.width ||
                  y < 3 ||
                  y > plot.y + plot.height
                )
                  return;
                const target = (event.target as Element)
                  .closest("[data-cursor]")
                  ?.getAttribute("data-cursor");
                const cursor =
                  target === "A" || target === "B"
                    ? target
                    : event.shiftKey
                      ? "B"
                      : activeCursor;
                setActiveCursor(cursor);
                dragging.current = { cursor, pointerId: event.pointerId };
                event.currentTarget.setPointerCapture(event.pointerId);
                placeCursor(cursor, pointerTime(event));
              }}
              onPointerMove={(event) => {
                if (dragging.current?.pointerId === event.pointerId)
                  placeCursor(dragging.current.cursor, pointerTime(event));
              }}
              onPointerUp={(event) => {
                if (dragging.current?.pointerId !== event.pointerId) return;
                dragging.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                dragging.current = null;
              }}
              onLostPointerCapture={() => {
                dragging.current = null;
              }}
            >
              <title>
                Full-resolution circuit measurements, min/max reduced for
                display
              </title>
              <defs>
                <clipPath id={`${id}-clip`}>
                  <rect
                    x={plot.x}
                    y={plot.y}
                    width={plot.width}
                    height={plot.height}
                  />
                </clipPath>
                <pattern
                  id={`${id}-grid`}
                  x={plot.x}
                  y={plot.y}
                  width={plot.width / timeDivisions / 5}
                  height={plot.height / 20}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M ${plot.width / timeDivisions / 5} 0 H 0 V ${plot.height / 20}`}
                    className="scope-grid-minor"
                    fill="none"
                  />
                </pattern>
              </defs>
              <rect
                x={plot.x}
                y={plot.y}
                width={plot.width}
                height={plot.height}
                fill={`url(#${id}-grid)`}
              />
              {Array.from({ length: timeDivisions + 1 }, (_, index) => {
                const x = plot.x + (index / timeDivisions) * plot.width;
                const time = view.start + (index / timeDivisions) * span;
                return (
                  <g key={index} className="scope-axis">
                    <line
                      x1={x}
                      x2={x}
                      y1={plot.y}
                      y2={plot.y + plot.height}
                      className="scope-grid-major"
                    />
                    <text x={x} y={size.height - 9} textAnchor="middle">
                      {hasSamples ? formatEngineering(time, "s") : ""}
                    </text>
                  </g>
                );
              })}
              {(gridAxis?.ticks ?? [0, 0.25, 0.5, 0.75, 1]).map(
                (value, index) => {
                  const y = gridAxis
                    ? yPosition(value, gridAxis)
                    : plot.y + value * plot.height;
                  return (
                    <line
                      key={index}
                      x1={plot.x}
                      x2={plot.x + plot.width}
                      y1={y}
                      y2={y}
                      className={
                        gridAxis && value === 0
                          ? "scope-grid-zero"
                          : "scope-grid-major"
                      }
                    />
                  );
                },
              )}
              {(
                [
                  ["voltage", voltageAxis],
                  ["current", currentAxis],
                ] as const
              ).map(([kind, axis]) => (
                <g
                  className={`scope-axis scope-axis--${kind}`}
                  key={kind}
                  data-testid={`scope-axis-${kind}`}
                >
                  <text
                    x={
                      kind === "voltage" ? plot.x - 9 : plot.x + plot.width + 9
                    }
                    y={12}
                    textAnchor={kind === "voltage" ? "end" : "start"}
                    className="scope-axis-title"
                  >
                    {kind === "voltage" ? "VOLTAGE" : "CURRENT"}
                  </text>
                  {axis?.ticks.map((value, index) => {
                    const y = yPosition(value, axis);
                    const x = kind === "voltage" ? plot.x : plot.x + plot.width;
                    return (
                      <g key={index}>
                        <line
                          x1={x}
                          x2={x + (kind === "voltage" ? -4 : 4)}
                          y1={y}
                          y2={y}
                        />
                        <text
                          x={x + (kind === "voltage" ? -9 : 9)}
                          y={y + 3}
                          textAnchor={kind === "voltage" ? "end" : "start"}
                        >
                          {formatEngineering(
                            value,
                            kind === "voltage" ? "V" : "A",
                          )}
                        </text>
                      </g>
                    );
                  })}
                </g>
              ))}
              <g clipPath={`url(#${id}-clip)`}>
                {paths.map(({ channel, path }) => (
                  <path
                    key={channel.probe.id}
                    d={path}
                    className="scope-trace"
                    stroke={channel.probe.color}
                    data-testid={`scope-trace-${channel.probe.id}`}
                  >
                    <title>
                      {channel.probe.name} ({channel.unit})
                    </title>
                  </path>
                ))}
              </g>
              {hasSamples &&
                (["A", "B"] as const).map((cursor) => {
                  const time = times[cursor];
                  if (time < view.start || time > view.end) return null;
                  const x = plot.x + ((time - view.start) / span) * plot.width;
                  return (
                    <g
                      key={cursor}
                      className={`scope-cursor scope-cursor--${cursor.toLowerCase()}${activeCursor === cursor ? " scope-cursor--active" : ""}`}
                      data-cursor={cursor}
                      data-testid={`scope-cursor-${cursor}`}
                      role="slider"
                      tabIndex={0}
                      aria-label={`Cursor ${cursor}`}
                      aria-valuemin={firstTime}
                      aria-valuemax={lastTime}
                      aria-valuenow={time}
                      aria-valuetext={exact(time, "seconds")}
                      aria-orientation="horizontal"
                      aria-describedby={`${id}-help`}
                      onFocus={() => setActiveCursor(cursor)}
                      onKeyDown={(event) => {
                        let index = indices[cursor];
                        if (
                          event.key === "ArrowLeft" ||
                          event.key === "ArrowDown"
                        )
                          index -= event.shiftKey ? 10 : 1;
                        else if (
                          event.key === "ArrowRight" ||
                          event.key === "ArrowUp"
                        )
                          index += event.shiftKey ? 10 : 1;
                        else if (event.key === "Home") index = 0;
                        else if (event.key === "End")
                          index = timeline.length - 1;
                        else return;
                        event.preventDefault();
                        event.stopPropagation();
                        placeCursor(
                          cursor,
                          timeline[clamp(index, 0, timeline.length - 1)].time,
                        );
                      }}
                    >
                      <rect
                        className="scope-cursor-hit"
                        x={x - 10}
                        y={3}
                        width={20}
                        height={plot.height + plot.y - 3}
                      />
                      <line
                        x1={x}
                        x2={x}
                        y1={plot.y}
                        y2={plot.y + plot.height}
                      />
                      <rect
                        className="scope-cursor-label"
                        x={x - 9}
                        y={3}
                        width={18}
                        height={16}
                        rx={3}
                      />
                      <text x={x} y={14} textAnchor="middle">
                        {cursor}
                      </text>
                      {enabled.map((channel) => {
                        const axis =
                          channel.probe.kind === "voltage"
                            ? voltageAxis
                            : currentAxis;
                        const value = channel.values[indices[cursor]];
                        return axis && Number.isFinite(value) ? (
                          <circle
                            key={channel.probe.id}
                            cx={x}
                            cy={yPosition(value, axis)}
                            r={2.8}
                            fill={channel.probe.color}
                            className="scope-cursor-point"
                          />
                        ) : null;
                      })}
                    </g>
                  );
                })}
            </svg>
            {!hasTraces && (
              <div className="scope-empty" data-testid="scope-empty">
                <Crosshair size={23} strokeWidth={1.2} aria-hidden="true" />
                <strong>{emptyTitle}</strong>
                <span>{emptyDescription}</span>
              </div>
            )}
            {stale && hasTraces && (
              <span className="scope-stale-overlay">
                PREVIOUS CAPTURE / RUN TO UPDATE
              </span>
            )}
          </div>

          <aside className="scope-readouts" aria-label="Cursor measurements">
            <div className="scope-readout-heading">
              <span>TIME CURSORS</span>
              <span title="Cursor positions snap to the nearest original sample, never to downsampled points. No interpolation across switching discontinuities; ties select the later sample.">
                Nearest sample
              </span>
            </div>
            <div className="scope-cursor-inputs">
              {(["A", "B"] as const).map((cursor) => (
                <div
                  className={`scope-cursor-row scope-cursor-row--${cursor.toLowerCase()}`}
                  key={cursor}
                >
                  <button
                    type="button"
                    aria-label={`Select cursor ${cursor} for plot clicks`}
                    aria-pressed={activeCursor === cursor}
                    title={`Select ${cursor}, then click or drag on the plot`}
                    disabled={!hasSamples}
                    data-testid={`scope-select-${cursor}`}
                    onClick={() => setActiveCursor(cursor)}
                  >
                    {cursor}
                  </button>
                  <label className="scope-time-input">
                    <span className="scope-sr-only">
                      Cursor {cursor} time in seconds
                    </span>
                    <input
                      key={`${cursor}-${times[cursor]}`}
                      type="number"
                      step="any"
                      min={firstTime}
                      max={lastTime}
                      defaultValue={hasSamples ? times[cursor] : ""}
                      placeholder="No sample"
                      disabled={!hasSamples}
                      title={`${exact(times[cursor], "s")}. Edit and press Enter to snap to a sample.`}
                      data-testid={`scope-time-${cursor}`}
                      onBlur={(event) => {
                        const value = event.currentTarget.valueAsNumber;
                        if (Number.isFinite(value)) placeCursor(cursor, value);
                        event.currentTarget.value = String(
                          Number.isFinite(value)
                            ? (timeline[nearestSample(timeline, value)]?.time ??
                                times[cursor])
                            : times[cursor],
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                    <span>s</span>
                  </label>
                  <span
                    className="scope-outside"
                    title="Cursor lies outside the current time window"
                  >
                    {hasSamples &&
                    (times[cursor] < view.start || times[cursor] > view.end)
                      ? "offscreen"
                      : ""}
                  </span>
                </div>
              ))}
            </div>
            <div className="scope-delta">
              <span>
                dt <small>B - A</small>
                <output
                  data-testid="scope-delta-time"
                  title={hasSamples ? exact(delta, "s") : "No samples"}
                >
                  {hasSamples ? formatEngineering(delta, "s") : "n/a"}
                </output>
              </span>
              <span>
                1 / |dt|
                <output
                  data-testid="scope-frequency"
                  title={
                    delta === 0
                      ? "Undefined when cursors coincide; this is interval frequency, not a signal-frequency estimate"
                      : exact(frequency, "Hz")
                  }
                >
                  {hasSamples ? formatEngineering(frequency, "Hz") : "n/a"}
                </output>
              </span>
            </div>
            <p id={`${id}-help`} className="scope-sr-only">
              Wheel to zoom at pointer. Shift + wheel to pan. Select A/B, then
              click or drag. Cursor arrows step samples; Shift steps 10. Plot
              arrows pan, +/- zoom, 0 fits. Cursor values snap to original
              samples without interpolation. Ties select the later sample.
            </p>
          </aside>
        </div>

        <div
          className="scope-measurements"
          tabIndex={0}
          role="region"
          aria-label="Full-record channel statistics and nearest-sample cursor readings"
          data-testid="scope-measurements"
        >
          <table>
            <caption className="scope-sr-only">
              Full-record statistics, equally weighted finite samples. Cursor
              readings use the nearest original sample without interpolation.
              Voltage relative to ground; current positive from pin 0 to pin 1.
              Hidden channels remain in this table.
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  Channel{" "}
                  <span className="scope-table-note">/ full record</span>
                </th>
                <th scope="col" className="scope-a-heading">
                  A
                </th>
                <th scope="col" className="scope-b-heading">
                  B
                </th>
                <th scope="col">Min</th>
                <th scope="col">Max</th>
                <th scope="col">Mean</th>
                <th scope="col">RMS</th>
                <th scope="col">Pk-pk</th>
              </tr>
            </thead>
            <tbody>
              {channels.length ? (
                channels.map((channel) => (
                  <tr
                    key={channel.probe.id}
                    data-testid={`scope-stats-${channel.probe.id}`}
                    className={
                      hidden.has(channel.probe.id)
                        ? "scope-measurement--hidden"
                        : ""
                    }
                  >
                    <th
                      scope="row"
                      title={`${channel.probe.name}: ${channel.stats.count.toLocaleString()} finite samples; ${channel.probe.kind === "voltage" ? "voltage relative to ground" : "current positive pin 0 to pin 1"}${hidden.has(channel.probe.id) ? "; trace hidden" : ""}`}
                    >
                      <span
                        className="scope-table-dot"
                        style={{ backgroundColor: channel.probe.color }}
                      />
                      <span>{channel.probe.name}</span>
                      {hidden.has(channel.probe.id) && (
                        <span className="scope-table-note">off</span>
                      )}
                    </th>
                    {[
                      channel.values[indices.A],
                      channel.values[indices.B],
                      channel.stats.min,
                      channel.stats.max,
                      channel.stats.mean,
                      channel.stats.rms,
                      channel.stats.peakToPeak,
                    ].map((value, index) => (
                      <td
                        key={index}
                        data-stat={
                          [
                            "cursor-a",
                            "cursor-b",
                            "min",
                            "max",
                            "mean",
                            "rms",
                            "peak-to-peak",
                          ][index]
                        }
                        title={exact(value, channel.unit)}
                      >
                        {formatEngineering(value, channel.unit)}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="scope-table-empty">
                    Probe readings will appear here. No generated or preview
                    signals.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
