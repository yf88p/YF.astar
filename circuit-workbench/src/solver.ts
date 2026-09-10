import type {
  Branch,
  Component,
  Netlist,
  Settings,
  Solution,
  TransientResult,
} from "./types";

/** Fixed, public numerical policy. Settings.tolerance is the Newton relative tolerance.
 * No gmin, leakage, source resistance, or other unrequested circuit elements are added.
 * Transient uses fixed-maximum-step trapezoidal integration with a backward-Euler
 * retry on Newton failure, not an LTE controller.
 */
export const NUMERICS = Object.freeze({
  thermalVoltage: 0.025851999786, // kT/q at 300 K, volts
  defaultRelativeTolerance: 1e-8,
  voltageAbsoluteTolerance: 1e-9,
  currentAbsoluteTolerance: 1e-12,
  pivotTolerance: 1e-14,
  maxNewtonIterations: 160,
  maxLineSearchIterations: 32,
  maxDiodeVoltageStep: 0.2, // forward Newton increment in volts, multiplied by n
  maxUnknowns: 150, // includes auxiliary capacitor currents during initialization
  maxSteps: 100_000,
  maxStoredScalars: 2_000_000, // time + iterations + all net voltages/branch currents
});

type Side = "left" | "right";
type Mode = "dc" | "initial" | "step";
type State = { voltage: number; current: number };
type Element = {
  branch: Branch;
  a: number;
  b: number;
  index: number;
  toggles: number[];
};
type Circuit = {
  netlist: Netlist;
  nodes: string[];
  elements: Element[];
  size: number;
};
type Context = {
  mode: Mode;
  time: number;
  side: Side;
  tolerance: number;
  transientSources: boolean;
  states?: Map<string, State>;
  dt?: number;
  backwardEuler?: boolean;
  cuts?: { row: number; members: Set<number> }[];
};
type Evaluation = {
  matrix: Float64Array;
  residual: Float64Array;
  scale: Float64Array;
  absolute: Float64Array;
};

const finite = (value: number, name: string) => {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
};
const positive = (value: number, name: string) => {
  if (!(Number.isFinite(value) && value > 0))
    throw new Error(`${name} must be finite and positive.`);
};
const timeEpsilon = (a: number, b: number) =>
  16 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);

function pulsePosition(component: Component, time: number, side: Side): number {
  const w = component.waveform;
  const elapsed = time - w.delay;
  const cycle = Math.floor(elapsed / w.period);
  let position = elapsed - cycle * w.period;
  // Snap only at roundoff distance, so evaluation agrees with generated event times.
  for (const edge of [
    0,
    w.rise,
    w.rise + w.width,
    w.rise + w.width + w.fall,
    w.period,
  ]) {
    const target = w.delay + cycle * w.period + edge;
    if (Math.abs(time - target) <= timeEpsilon(time, target)) {
      position = edge;
      break;
    }
  }
  if (position === w.period && side === "right") position = 0;
  if (position === 0 && side === "left") position = w.period;
  return position;
}

/** Sources are positive from pin 0 to pin 1 (voltage V0-V1, current I0->1).
 * DC always uses component.value. Transient dc waveforms also use value.
 * Sine: offset + amplitude*sin(2*pi*f*(t-delay) + phase*pi/180), offset before delay.
 * Pulse: offset -> offset+amplitude; width is the HIGH plateau, excluding rise/fall.
 * Waveforms and switch toggles are right-continuous at events.
 */
export function waveformValue(component: Component, time: number): number {
  return sourceValue(component, time, "right");
}

function sourceValue(component: Component, time: number, side: Side): number {
  const w = component.waveform;
  if (w.type === "dc") return component.value;
  if (time < w.delay || (time === w.delay && side === "left")) return w.offset;
  if (w.type === "sine") {
    return (
      w.offset +
      w.amplitude *
        Math.sin(
          2 * Math.PI * w.frequency * (time - w.delay) +
            (w.phase * Math.PI) / 180,
        )
    );
  }
  const position = pulsePosition(component, time, side);
  if (w.rise > 0 && position < w.rise)
    return w.offset + (w.amplitude * position) / w.rise;
  if (
    position < w.rise + w.width ||
    (side === "left" && position === w.rise + w.width)
  )
    return w.offset + w.amplitude;
  if (w.fall > 0 && position < w.rise + w.width + w.fall) {
    return (
      w.offset + w.amplitude * (1 - (position - w.rise - w.width) / w.fall)
    );
  }
  return w.offset;
}

function sourceDerivative(
  component: Component,
  time: number,
  side: Side,
): number {
  const w = component.waveform;
  if (
    w.type === "dc" ||
    time < w.delay ||
    (time === w.delay && side === "left")
  )
    return 0;
  if (w.type === "sine") {
    return (
      2 *
      Math.PI *
      w.frequency *
      w.amplitude *
      Math.cos(
        2 * Math.PI * w.frequency * (time - w.delay) +
          (w.phase * Math.PI) / 180,
      )
    );
  }
  const p = pulsePosition(component, time, side);
  if (w.rise > 0 && (p < w.rise || (side === "left" && p === w.rise)))
    return w.amplitude / w.rise;
  const start = w.rise + w.width;
  const end = start + w.fall;
  if (
    w.fall > 0 &&
    (p > start || (side === "right" && p === start)) &&
    (p < end || (side === "left" && p === end))
  )
    return -w.amplitude / w.fall;
  return 0;
}

function switchResistance(element: Element, context: Context): number {
  const s = element.branch.component.switch;
  let count = 0;
  if (context.transientSources) {
    let low = 0;
    let high = element.toggles.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const event = element.toggles[middle];
      if (
        event < context.time ||
        (context.side === "right" && event === context.time)
      )
        low = middle + 1;
      else high = middle;
    }
    count = low;
  }
  return s.closed !== (count % 2 === 1) ? s.ron : s.roff;
}

function diode(component: Component, voltage: number): [number, number] {
  const vt = component.diode.n * NUMERICS.thermalVoltage;
  const exponent = voltage / vt;
  const saturation = component.diode.is;
  // Avoid intermediate exp overflow when Is*exp(v/nVt) is still representable.
  const exponential =
    exponent > 40
      ? Math.exp(Math.log(saturation) + exponent)
      : saturation * Math.exp(exponent);
  const current =
    exponent > 40
      ? exponential - saturation
      : saturation * Math.expm1(exponent);
  return [current, exponential / vt];
}

function prepare(netlist: Netlist, transient: boolean): Circuit {
  if (!netlist.ground || !netlist.nets.some((n) => n.id === netlist.ground)) {
    throw new Error(
      "Missing ground: add a ground component connected to the circuit.",
    );
  }
  const unknowns =
    netlist.nets.length -
    1 +
    netlist.branches.reduce(
      (count, b) =>
        count +
        Number(
          b.component.type === "voltage" || b.component.type === "inductor",
        ),
      0,
    );
  if (unknowns > NUMERICS.maxUnknowns)
    throw new Error(
      `MNA size ${unknowns} exceeds the ${NUMERICS.maxUnknowns}-unknown limit.`,
    );
  const ids = new Set<string>();
  for (const net of netlist.nets) {
    if (ids.has(net.id)) throw new Error(`Duplicate net ID: ${net.id}`);
    ids.add(net.id);
  }
  const nodes = netlist.nets
    .filter((n) => n.id !== netlist.ground)
    .map((n) => n.id);
  const indices = new Map(nodes.map((id, index) => [id, index]));
  indices.set(netlist.ground, -1);
  let size = nodes.length;
  const componentIds = new Set<string>();
  const elements = netlist.branches.map((branch) => {
    const c = branch.component;
    if (componentIds.has(c.id))
      throw new Error(`Duplicate component ID: ${c.id}`);
    componentIds.add(c.id);
    if (!ids.has(branch.nodeA) || !ids.has(branch.nodeB))
      throw new Error(`Component ${c.id} references a missing net.`);
    if (c.type === "ground")
      throw new Error("Ground must be a net, not an MNA branch.");
    finite(c.value, `${c.id} value`);
    if (
      c.type === "resistor" ||
      c.type === "capacitor" ||
      c.type === "inductor"
    )
      positive(c.value, `${c.id} value`);
    if (c.type === "capacitor" || c.type === "inductor")
      finite(c.initial, `${c.id} initial condition`);
    if (c.type === "diode") {
      positive(c.diode.is, `${c.id} diode Is`);
      positive(c.diode.n, `${c.id} diode n`);
    }
    let toggles: number[] = [];
    if (c.type === "switch") {
      positive(c.switch.ron, `${c.id} switch Ron`);
      positive(c.switch.roff, `${c.id} switch Roff`);
      if (c.switch.ron >= c.switch.roff)
        throw new Error(`${c.id} switch Ron must be less than Roff.`);
      if (typeof c.switch.closed !== "boolean")
        throw new Error(`${c.id} switch initial state must be a boolean.`);
      let previous = -1;
      for (const time of c.switch.toggles) {
        if (!Number.isFinite(time) || time < 0 || time <= previous)
          throw new Error(
            `${c.id} switch toggle times must be finite, nonnegative, distinct, and sorted.`,
          );
        previous = time;
      }
      if (transient) {
        toggles = [...c.switch.toggles];
      }
    }
    if (transient && (c.type === "voltage" || c.type === "current")) {
      const w = c.waveform;
      if (!["dc", "sine", "pulse"].includes(w.type))
        throw new Error(`${c.id} has an unknown waveform.`);
      if (w.type !== "dc") {
        finite(w.offset, `${c.id} waveform offset`);
        finite(w.amplitude, `${c.id} waveform amplitude`);
        if (!Number.isFinite(w.delay) || w.delay < 0)
          throw new Error(
            `${c.id} waveform delay must be finite and nonnegative.`,
          );
      }
      if (w.type === "sine") {
        finite(w.phase, `${c.id} sine phase`);
        if (!Number.isFinite(w.frequency) || w.frequency < 0)
          throw new Error(
            `${c.id} sine frequency must be finite and nonnegative.`,
          );
      }
      if (w.type === "pulse") {
        positive(w.period, `${c.id} pulse period`);
        for (const key of ["rise", "fall", "width"] as const) {
          if (!Number.isFinite(w[key]) || w[key] < 0)
            throw new Error(
              `${c.id} pulse ${key} must be finite and nonnegative.`,
            );
        }
        if (w.rise + w.width + w.fall > w.period)
          throw new Error(
            `${c.id} pulse rise + width + fall must not exceed period.`,
          );
      }
    }
    return {
      branch,
      a: indices.get(branch.nodeA)!,
      b: indices.get(branch.nodeB)!,
      index: c.type === "voltage" || c.type === "inductor" ? size++ : -1,
      toggles,
    };
  });
  return { netlist, nodes, elements, size };
}

function checkGroundPaths(circuit: Circuit, dc: boolean): void {
  const adjacent = Array.from(
    { length: circuit.nodes.length + 1 },
    () => [] as number[],
  );
  for (const e of circuit.elements) {
    const type = e.branch.component.type;
    if (type === "current" || (dc && type === "capacitor")) continue;
    adjacent[e.a + 1].push(e.b + 1);
    adjacent[e.b + 1].push(e.a + 1);
  }
  const reached = new Set([0]);
  const queue = [0];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adjacent[queue[i]])
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
  }
  const floating = circuit.nodes.filter((_, index) => !reached.has(index + 1));
  if (floating.length) {
    const names = floating
      .slice(0, 8)
      .map((id) => circuit.netlist.nets.find((n) => n.id === id)!.name)
      .join(", ");
    throw new Error(
      `Floating net(s): ${names}. No ${dc ? "DC " : ""}path to ground; current sources${dc ? " and open DC capacitors" : ""} do not establish a voltage reference.`,
    );
  }
}

function constraintCheck(circuit: Circuit, context: Context): void {
  const count = circuit.nodes.length + 1;
  const parent = Array.from({ length: count }, (_, i) => i);
  const potential = new Float64Array(count);
  const root = (index: number): number => {
    if (parent[index] !== index) {
      const previous = parent[index];
      parent[index] = root(previous);
      potential[index] += potential[previous];
    }
    return parent[index];
  };
  // Sources first: a redundant source-only loop has undefined branch currents.
  const ordered = [...circuit.elements].sort(
    (a, b) =>
      Number(a.branch.component.type === "capacitor") -
      Number(b.branch.component.type === "capacitor"),
  );
  for (const e of ordered) {
    const c = e.branch.component;
    let value: number;
    if (c.type === "voltage")
      value = context.transientSources
        ? sourceValue(c, context.time, context.side)
        : c.value;
    else if (c.type === "inductor" && context.mode === "dc") value = 0;
    else if (c.type === "capacitor" && context.mode === "initial")
      value = context.states!.get(c.id)!.voltage;
    else continue;
    finite(value, `${c.id} source/initial voltage`);
    const a = e.a + 1;
    const b = e.b + 1;
    const ra = root(a);
    const rb = root(b);
    if (ra === rb) {
      const error = potential[a] - potential[b] - value;
      const roundoff =
        64 *
        Number.EPSILON *
        Math.max(
          1,
          Math.abs(potential[a]),
          Math.abs(potential[b]),
          Math.abs(value),
        );
      if (Math.abs(error) > roundoff)
        throw new Error(
          `Conflicting voltage sources or capacitor initial conditions at ${c.id} (mismatch ${error} V, t=${context.time} s).`,
        );
      if (c.type !== "capacitor")
        throw new Error(
          `Singular circuit: redundant ideal voltage-source/inductor loop at ${c.id}; branch currents are not uniquely determined.`,
        );
    } else {
      parent[ra] = rb;
      potential[ra] = value - potential[a] + potential[b];
    }
  }
}

/** Equilibrated full-pivot Gaussian elimination. Rank deficiency is allowed only
 * for explicitly designated auxiliary variables, never for a floating voltage.
 */
function linearSolve(
  matrix: Float64Array,
  rhs: Float64Array,
  size: number,
  allowFree?: boolean[],
  rowTolerance?: Float64Array,
): Float64Array {
  const a = matrix.slice();
  const b = rhs.slice();
  const columns = Array.from({ length: size }, (_, i) => i);
  const columnScale = new Float64Array(size).fill(1);
  for (let row = 0; row < size; row++) {
    let maximum = 0;
    for (let col = 0; col < size; col++)
      maximum = Math.max(maximum, Math.abs(a[row * size + col]));
    if (maximum) {
      for (let col = 0; col < size; col++) a[row * size + col] /= maximum;
      b[row] /= maximum;
    }
  }
  for (let col = 0; col < size; col++) {
    let maximum = 0;
    for (let row = 0; row < size; row++)
      maximum = Math.max(maximum, Math.abs(a[row * size + col]));
    if (maximum) {
      columnScale[col] = 1 / maximum;
      for (let row = 0; row < size; row++)
        a[row * size + col] *= columnScale[col];
    }
  }
  let rank = size;
  for (let k = 0; k < size; k++) {
    let maximum = 0;
    let pr = k;
    let pc = k;
    for (let row = k; row < size; row++)
      for (let col = k; col < size; col++) {
        const value = Math.abs(a[row * size + col]);
        if (value > maximum) {
          maximum = value;
          pr = row;
          pc = col;
        }
      }
    if (maximum < NUMERICS.pivotTolerance) {
      rank = k;
      break;
    }
    if (pr !== k) {
      for (let col = 0; col < size; col++) {
        const temp = a[k * size + col];
        a[k * size + col] = a[pr * size + col];
        a[pr * size + col] = temp;
      }
      [b[k], b[pr]] = [b[pr], b[k]];
    }
    if (pc !== k) {
      for (let row = 0; row < size; row++) {
        const temp = a[row * size + k];
        a[row * size + k] = a[row * size + pc];
        a[row * size + pc] = temp;
      }
      [columns[k], columns[pc]] = [columns[pc], columns[k]];
    }
    for (let row = k + 1; row < size; row++) {
      const factor = a[row * size + k] / a[k * size + k];
      a[row * size + k] = 0;
      if (!factor) continue;
      for (let col = k + 1; col < size; col++)
        a[row * size + col] -= factor * a[k * size + col];
      b[row] -= factor * b[k];
    }
  }
  const backSubstitute = (values: Float64Array, homogeneous: boolean) => {
    for (let row = rank - 1; row >= 0; row--) {
      let value = homogeneous ? 0 : b[row];
      for (let col = row + 1; col < size; col++)
        value -= a[row * size + col] * values[col];
      values[row] = value / a[row * size + row];
    }
    const result = new Float64Array(size);
    for (let col = 0; col < size; col++)
      result[columns[col]] = values[col] * columnScale[columns[col]];
    return result;
  };
  const result = backSubstitute(new Float64Array(size), false);
  if (!result.every(Number.isFinite))
    throw new Error(
      "Numerical overflow or ill-conditioned MNA matrix; check component magnitudes.",
    );
  if (rank < size) {
    for (let row = 0; row < size; row++) {
      let residual = -rhs[row];
      let scale = Math.abs(rhs[row]);
      for (let col = 0; col < size; col++) {
        const term = matrix[row * size + col] * result[col];
        residual += term;
        scale += Math.abs(term);
      }
      if (
        Math.abs(residual) >
        (rowTolerance?.[row] ?? NUMERICS.currentAbsoluteTolerance) +
          1e-12 * scale
      ) {
        throw new Error(
          "Conflicting sources or initial conditions: the MNA equations are inconsistent.",
        );
      }
    }
    if (!allowFree)
      throw new Error(
        "Singular MNA matrix: floating voltage, redundant ideal sources, or badly conditioned component values.",
      );
    for (let free = rank; free < size; free++) {
      const vector = new Float64Array(size);
      vector[free] = 1;
      const nullVector = backSubstitute(vector, true);
      for (let i = 0; i < size; i++)
        if (!allowFree[i] && Math.abs(nullVector[i]) > 1e-10 * columnScale[i]) {
          throw new Error(
            "Singular MNA matrix: an initial voltage or branch current is not uniquely determined.",
          );
        }
    }
  }
  return result;
}

function evaluate(
  circuit: Circuit,
  x: Float64Array,
  context: Context,
): Evaluation {
  const size = x.length;
  const matrix = new Float64Array(size * size);
  const residual = new Float64Array(size);
  const scale = new Float64Array(size);
  const absolute = new Float64Array(size).fill(
    NUMERICS.currentAbsoluteTolerance,
  );
  const add = (row: number, col: number, value: number) => {
    if (row >= 0 && col >= 0) matrix[row * size + col] += value;
  };
  const value = (index: number) => (index < 0 ? 0 : x[index]);
  const kcl = (e: Element, current: number, conductance: number) => {
    if (e.a >= 0) {
      residual[e.a] += current;
      scale[e.a] += Math.abs(current);
    }
    if (e.b >= 0) {
      residual[e.b] -= current;
      scale[e.b] += Math.abs(current);
    }
    add(e.a, e.a, conductance);
    add(e.b, e.b, conductance);
    add(e.a, e.b, -conductance);
    add(e.b, e.a, -conductance);
  };
  for (const e of circuit.elements) {
    const c = e.branch.component;
    const voltage = value(e.a) - value(e.b);
    const source = () =>
      context.transientSources
        ? sourceValue(c, context.time, context.side)
        : c.value;
    if (c.type === "resistor" || c.type === "switch") {
      const g =
        1 / (c.type === "resistor" ? c.value : switchResistance(e, context));
      kcl(e, g * voltage, g);
    } else if (c.type === "diode") {
      const [current, g] = diode(c, voltage);
      kcl(e, current, g);
    } else if (c.type === "current") kcl(e, source(), 0);
    else if (c.type === "capacitor" && context.mode === "dc") continue;
    else if (c.type === "capacitor" && context.mode === "step") {
      const previous = context.states!.get(c.id)!;
      const g = ((context.backwardEuler ? 1 : 2) * c.value) / context.dt!;
      kcl(
        e,
        g * (voltage - previous.voltage) -
          (context.backwardEuler ? 0 : previous.current),
        g,
      );
    } else {
      const index = e.index;
      kcl(e, x[index], 0);
      add(e.a, index, 1);
      add(e.b, index, -1);
      if (context.mode === "initial" && c.type === "inductor") {
        residual[index] = x[index] - context.states!.get(c.id)!.current;
        scale[index] =
          Math.abs(x[index]) + Math.abs(context.states!.get(c.id)!.current);
        add(index, index, 1);
      } else {
        add(index, e.a, 1);
        add(index, e.b, -1);
        absolute[index] = NUMERICS.voltageAbsoluteTolerance;
        residual[index] = voltage;
        scale[index] = Math.abs(value(e.a)) + Math.abs(value(e.b));
        if (c.type === "voltage" || c.type === "capacitor") {
          const target =
            c.type === "voltage"
              ? source()
              : context.states!.get(c.id)!.voltage;
          residual[index] -= target;
          scale[index] += Math.abs(target);
        } else if (context.mode === "step") {
          const previous = context.states!.get(c.id)!;
          const r = ((context.backwardEuler ? 1 : 2) * c.value) / context.dt!;
          const historyVoltage = context.backwardEuler ? 0 : previous.voltage;
          residual[index] += historyVoltage - r * (x[index] - previous.current);
          scale[index] +=
            Math.abs(historyVoltage) +
            Math.abs(r * (x[index] - previous.current));
          add(index, index, -r);
        }
      }
    }
  }
  // Inductor/current-source cutsets need differentiated KCL at initialization.
  // Their original total KCL is checked separately before replacing one row.
  for (const cut of context.cuts ?? []) {
    matrix.fill(0, cut.row * size, (cut.row + 1) * size);
    residual[cut.row] = 0;
    scale[cut.row] = 0;
    for (const e of circuit.elements) {
      const sign = Number(cut.members.has(e.a)) - Number(cut.members.has(e.b));
      if (!sign) continue;
      const c = e.branch.component;
      let term = 0;
      if (c.type === "inductor") {
        term = (sign * (value(e.a) - value(e.b))) / c.value;
        add(cut.row, e.a, sign / c.value);
        add(cut.row, e.b, -sign / c.value);
      } else if (c.type === "current")
        term = sign * sourceDerivative(c, context.time, context.side);
      residual[cut.row] += term;
      scale[cut.row] += Math.abs(term);
    }
  }
  return { matrix, residual, scale, absolute };
}

function residualNorm(e: Evaluation, tolerance: number): number {
  let result = 0;
  for (let i = 0; i < e.residual.length; i++)
    result = Math.max(
      result,
      Math.abs(e.residual[i]) / (e.absolute[i] + tolerance * e.scale[i]),
    );
  return result;
}

function merit(e: Evaluation, x: Float64Array): number {
  let result = 0;
  for (let row = 0; row < x.length; row++) {
    let scale = e.absolute[row];
    for (let col = 0; col < x.length; col++)
      scale +=
        Math.abs(e.matrix[row * x.length + col]) *
        Math.max(1, Math.abs(x[col]));
    result = Math.max(result, Math.abs(e.residual[row]) / scale);
  }
  return result;
}

function newton(
  circuit: Circuit,
  context: Context,
  initial?: Float64Array,
  allowFree?: boolean[],
): { x: Float64Array; iterations: number } {
  let x = initial?.slice() ?? new Float64Array(circuit.size);
  for (
    let iteration = 1;
    iteration <= NUMERICS.maxNewtonIterations;
    iteration++
  ) {
    const evaluation = evaluate(circuit, x, context);
    if (
      !evaluation.residual.every(Number.isFinite) ||
      !evaluation.matrix.every(Number.isFinite)
    ) {
      throw new Error(
        `Newton nonconvergence at t=${context.time} s: diode exponential or component arithmetic overflow.`,
      );
    }
    const rowTolerance = evaluation.absolute.map(
      (absolute, i) => absolute + context.tolerance * evaluation.scale[i],
    );
    const correction = linearSolve(
      evaluation.matrix,
      evaluation.residual.map((v) => -v),
      x.length,
      allowFree,
      rowTolerance,
    );
    let correctionNorm = 0;
    for (let i = 0; i < x.length; i++) {
      const absolute =
        i < circuit.nodes.length
          ? NUMERICS.voltageAbsoluteTolerance
          : NUMERICS.currentAbsoluteTolerance;
      correctionNorm = Math.max(
        correctionNorm,
        Math.abs(correction[i]) /
          (absolute +
            context.tolerance *
              Math.max(Math.abs(x[i]), Math.abs(x[i] + correction[i]))),
      );
    }
    if (
      residualNorm(evaluation, context.tolerance) <= 1 &&
      correctionNorm <= 1
    ) {
      // One undamped polish preserves linear IC/source constraints to roundoff.
      const polished = x.map((value, i) => value + correction[i]);
      if (
        residualNorm(evaluate(circuit, polished, context), context.tolerance) <=
        1
      )
        return { x: polished, iterations: iteration };
    }
    let damping = 1;
    for (const e of circuit.elements)
      if (e.branch.component.type === "diode") {
        const voltage = (e.a < 0 ? 0 : x[e.a]) - (e.b < 0 ? 0 : x[e.b]);
        const change =
          (e.a < 0 ? 0 : correction[e.a]) - (e.b < 0 ? 0 : correction[e.b]);
        const limit =
          NUMERICS.maxDiodeVoltageStep * e.branch.component.diode.n +
          Math.max(0, -voltage);
        if (change > limit) damping = Math.min(damping, limit / change);
      }
    const before = merit(evaluation, x);
    let accepted = false;
    for (let search = 0; search < NUMERICS.maxLineSearchIterations; search++) {
      const trial = x.map((value, i) => value + damping * correction[i]);
      const next = evaluate(circuit, trial, context);
      const after = merit(next, trial);
      if (
        Number.isFinite(after) &&
        (after < before * (1 - 1e-4 * damping) ||
          residualNorm(next, context.tolerance) <= 1)
      ) {
        x = trial;
        accepted = true;
        break;
      }
      damping *= 0.5;
    }
    if (!accepted)
      throw new Error(
        `Newton nonconvergence at t=${context.time} s: damping could not reduce the residual. Check source constraints and component values, or reduce timestep.`,
      );
  }
  throw new Error(
    `Newton nonconvergence at t=${context.time} s after ${NUMERICS.maxNewtonIterations} iterations; residual and correction tolerances were not both satisfied. Reduce timestep or check the circuit.`,
  );
}

function solution(
  circuit: Circuit,
  x: Float64Array,
  context: Context,
  iterations: number,
): Solution {
  const voltages: Record<string, number> = Object.create(null);
  const currents: Record<string, number> = Object.create(null);
  voltages[circuit.netlist.ground] = 0;
  circuit.nodes.forEach((id, i) => {
    voltages[id] = x[i];
  });
  for (const e of circuit.elements) {
    const c = e.branch.component;
    const voltage = voltages[e.branch.nodeA] - voltages[e.branch.nodeB];
    let current: number;
    if (c.type === "resistor") current = voltage / c.value;
    else if (c.type === "switch")
      current = voltage / switchResistance(e, context);
    else if (c.type === "diode") current = diode(c, voltage)[0];
    else if (c.type === "current")
      current = context.transientSources
        ? sourceValue(c, context.time, context.side)
        : c.value;
    else if (c.type === "capacitor") {
      if (context.mode === "dc") current = 0;
      else if (context.mode === "initial") current = x[e.index];
      else {
        const previous = context.states!.get(c.id)!;
        current =
          (((context.backwardEuler ? 1 : 2) * c.value) / context.dt!) *
            (voltage - previous.voltage) -
          (context.backwardEuler ? 0 : previous.current);
      }
    } else current = x[e.index];
    if (!Number.isFinite(voltage) || !Number.isFinite(current))
      throw new Error(`Numerical overflow in ${c.id} at t=${context.time} s.`);
    currents[c.id] = current;
  }
  return { time: context.time, voltages, currents, iterations };
}

function statesFrom(circuit: Circuit, sample: Solution): Map<string, State> {
  const states = new Map<string, State>();
  for (const { branch: b } of circuit.elements)
    if (b.component.type === "capacitor" || b.component.type === "inductor") {
      states.set(b.component.id, {
        voltage: sample.voltages[b.nodeA] - sample.voltages[b.nodeB],
        current: sample.currents[b.component.id],
      });
    }
  return states;
}

function guessFrom(circuit: Circuit, sample?: Solution): Float64Array {
  const x = new Float64Array(circuit.size);
  if (sample) {
    circuit.nodes.forEach((id, i) => {
      x[i] = sample.voltages[id];
    });
    for (const e of circuit.elements)
      if (e.index >= 0) x[e.index] = sample.currents[e.branch.component.id];
  }
  return x;
}

function initialize(
  circuit: Circuit,
  context: Context,
  states: Map<string, State>,
  previous?: Solution,
): Solution {
  let size = circuit.size;
  const elements = circuit.elements.map((e) =>
    e.branch.component.type === "capacitor" ? { ...e, index: size++ } : e,
  );
  if (size > NUMERICS.maxUnknowns)
    throw new Error(
      `Initialization MNA size ${size} exceeds the ${NUMERICS.maxUnknowns}-unknown limit (including capacitor IC constraints).`,
    );
  const initialCircuit = { ...circuit, elements, size };
  const initialContext: Context = {
    ...context,
    mode: "initial",
    states,
    cuts: [],
  };
  constraintCheck(initialCircuit, initialContext);

  const adjacent = Array.from(
    { length: circuit.nodes.length + 1 },
    () => [] as number[],
  );
  for (const e of elements)
    if (
      e.branch.component.type !== "inductor" &&
      e.branch.component.type !== "current"
    ) {
      adjacent[e.a + 1].push(e.b + 1);
      adjacent[e.b + 1].push(e.a + 1);
    }
  const visited = new Set<number>();
  for (let start = 0; start < adjacent.length; start++)
    if (!visited.has(start)) {
      const group = [start];
      visited.add(start);
      for (let i = 0; i < group.length; i++)
        for (const next of adjacent[group[i]])
          if (!visited.has(next)) {
            visited.add(next);
            group.push(next);
          }
      if (group.includes(0)) continue;
      const members = new Set(group.map((i) => i - 1));
      let imbalance = 0;
      let magnitude = 0;
      for (const e of elements) {
        const sign = Number(members.has(e.a)) - Number(members.has(e.b));
        if (!sign) continue;
        const c = e.branch.component;
        const current =
          c.type === "inductor"
            ? states.get(c.id)!.current
            : sourceValue(c, context.time, context.side);
        imbalance += sign * current;
        magnitude += Math.abs(current);
      }
      if (
        Math.abs(imbalance) >
        NUMERICS.currentAbsoluteTolerance + 64 * Number.EPSILON * magnitude
      ) {
        throw new Error(
          `Conflicting inductor initial conditions/current sources: KCL imbalance ${imbalance} A at t=${context.time} s.`,
        );
      }
      initialContext.cuts!.push({ row: start - 1, members });
    }
  const allowFree = Array.from(
    { length: size },
    (_, i) => i >= circuit.nodes.length,
  );
  for (const e of elements)
    if (e.branch.component.type === "inductor") allowFree[e.index] = false;
  const solved = newton(
    initialCircuit,
    initialContext,
    guessFrom(initialCircuit, previous),
    allowFree,
  );
  const sample = solution(
    initialCircuit,
    solved.x,
    initialContext,
    solved.iterations,
  );

  // Recover physical capacitor and voltage-source currents using differentiated
  // source constraints and C*dV/dt. This also resolves consistent parallel ICs.
  const sources = elements.filter((e) => e.branch.component.type === "voltage");
  const derivativeSize = circuit.nodes.length + sources.length;
  const matrix = new Float64Array(derivativeSize * derivativeSize);
  const rhs = new Float64Array(derivativeSize);
  const rowTolerance = new Float64Array(derivativeSize).fill(
    NUMERICS.currentAbsoluteTolerance,
  );
  const add = (row: number, col: number, value: number) => {
    if (row >= 0 && col >= 0) matrix[row * derivativeSize + col] += value;
  };
  for (const e of elements) {
    const c = e.branch.component;
    if (c.type === "capacitor") {
      add(e.a, e.a, c.value);
      add(e.b, e.b, c.value);
      add(e.a, e.b, -c.value);
      add(e.b, e.a, -c.value);
    } else if (c.type !== "voltage") {
      const current = sample.currents[c.id];
      if (e.a >= 0) {
        rhs[e.a] -= current;
        rowTolerance[e.a] += context.tolerance * Math.abs(current);
      }
      if (e.b >= 0) {
        rhs[e.b] += current;
        rowTolerance[e.b] += context.tolerance * Math.abs(current);
      }
    }
  }
  sources.forEach((e, i) => {
    const index = circuit.nodes.length + i;
    add(e.a, index, 1);
    add(e.b, index, -1);
    add(index, e.a, 1);
    add(index, e.b, -1);
    rhs[index] = sourceDerivative(
      e.branch.component,
      context.time,
      context.side,
    );
    rowTolerance[index] = NUMERICS.voltageAbsoluteTolerance;
  });
  const derivatives = linearSolve(
    matrix,
    rhs,
    derivativeSize,
    Array.from({ length: derivativeSize }, (_, i) => i < circuit.nodes.length),
    rowTolerance,
  );
  for (const e of elements)
    if (e.branch.component.type === "capacitor") {
      sample.currents[e.branch.component.id] =
        e.branch.component.value *
        ((e.a < 0 ? 0 : derivatives[e.a]) - (e.b < 0 ? 0 : derivatives[e.b]));
    }
  sources.forEach((e, i) => {
    sample.currents[e.branch.component.id] =
      derivatives[circuit.nodes.length + i];
  });
  return sample;
}

/** Operating point: independent sources use value, switches use closed,
 * capacitors are open and inductors are ideal shorts. Throws rather than
 * returning a regularized, inconsistent, singular, or unconverged solution.
 */
export function solveDC(netlist: Netlist): Solution {
  const circuit = prepare(netlist, false);
  checkGroundPaths(circuit, true);
  const context: Context = {
    mode: "dc",
    time: 0,
    side: "right",
    tolerance: NUMERICS.defaultRelativeTolerance,
    transientSources: false,
  };
  constraintCheck(circuit, context);
  const solved = newton(circuit, context);
  return solution(circuit, solved.x, context, solved.iterations);
}

function eventTimes(
  circuit: Circuit,
  settings: Settings,
  maximum: number,
): number[] {
  const events = new Set<number>();
  const add = (time: number) => {
    if (time > 0 && time <= settings.duration) events.add(time);
    if (events.size > maximum)
      throw new Error(
        `Transient event count exceeds the step/storage limit (${maximum} steps). Increase waveform periods or shorten duration.`,
      );
  };
  for (const e of circuit.elements) {
    const c = e.branch.component;
    if (c.type === "switch") for (const time of e.toggles) add(time);
    if (c.type !== "voltage" && c.type !== "current") continue;
    const w = c.waveform;
    if (w.type === "sine") add(w.delay);
    if (w.type !== "pulse" || w.delay > settings.duration) continue;
    const cycles = Math.floor((settings.duration - w.delay) / w.period);
    if (cycles > maximum)
      throw new Error(
        `Pulse ${c.id} would require more than ${maximum} event-aligned steps. Increase period or shorten duration.`,
      );
    const edges = [
      ...new Set([0, w.rise, w.rise + w.width, w.rise + w.width + w.fall]),
    ].filter((edge) => edge < w.period);
    for (let cycle = 0; cycle <= cycles; cycle++)
      for (const edge of edges) add(w.delay + cycle * w.period + edge);
  }
  add(settings.duration);
  return [...events].sort((a, b) => a - b);
}

/** All samples, including t=0, contain every net voltage and branch current.
 * Explicit ICs constrain every capacitor voltage and inductor current together.
 * DC initialization first finds the operating point using TRANSIENT sources at 0.
 * Event samples are right-continuous; energy-storage states remain continuous.
 * An ideal-source jump requiring an instantaneous C voltage/L current jump is
 * inconsistent (an impulse), and is reported instead of silently changing ICs.
 * The caller can cancel synchronous work by terminating its worker.
 */
export function solveTransient(
  netlist: Netlist,
  settings: Settings,
  onProgress?: (fraction: number) => void,
): TransientResult {
  const started = performance.now();
  if (!Number.isFinite(settings.duration) || settings.duration < 0)
    throw new Error("Transient duration must be finite and nonnegative.");
  positive(settings.timestep, "Maximum timestep");
  positive(settings.tolerance, "Newton relative tolerance");
  if (settings.tolerance >= 1)
    throw new Error("Newton relative tolerance must be less than 1.");
  if (
    settings.initialization !== "dc" &&
    settings.initialization !== "explicit"
  )
    throw new Error("Unknown transient initialization mode.");
  const scalarsPerSample = netlist.nets.length + netlist.branches.length + 2;
  const maximum = Math.min(
    NUMERICS.maxSteps,
    Math.floor(NUMERICS.maxStoredScalars / scalarsPerSample) - 1,
  );
  const limitMessage = `Transient exceeds ${NUMERICS.maxSteps} steps or ${NUMERICS.maxStoredScalars} stored scalar values. Increase timestep, shorten duration, or reduce circuit size.`;
  const nominalSteps = settings.duration / settings.timestep;
  if (
    !Number.isFinite(nominalSteps) ||
    nominalSteps > maximum + timeEpsilon(nominalSteps, maximum) ||
    maximum < 0
  )
    throw new Error(limitMessage);
  const circuit = prepare(netlist, true);
  const initialSize =
    circuit.size +
    circuit.elements.filter((e) => e.branch.component.type === "capacitor")
      .length;
  if (initialSize > NUMERICS.maxUnknowns)
    throw new Error(
      `Initialization MNA size ${initialSize} exceeds the ${NUMERICS.maxUnknowns}-unknown limit (including capacitor IC constraints).`,
    );
  const events = eventTimes(circuit, settings, maximum);
  function* grid() {
    let anchor = 0;
    for (const event of events) {
      let previous = anchor;
      for (let step = 1; ; step++) {
        // Multiplication from an event anchor avoids accumulated time error and
        // spurious femtosecond steps at the end of an otherwise uniform grid.
        const next = anchor + step * settings.timestep;
        const atEvent = next >= event - timeEpsilon(next, event);
        const time = atEvent ? event : next;
        if (!(time > previous))
          throw new Error(
            "Timestep/event separation is below floating-point time resolution. Rescale simulation times.",
          );
        yield { time, atEvent };
        if (atEvent) break;
        previous = time;
      }
      anchor = event;
    }
  }
  // Count the actual event-aligned grid before allocating any result samples.
  let planned = 0;
  for (const _point of grid()) {
    if (++planned > maximum) throw new Error(limitMessage);
  }
  onProgress?.(0);
  checkGroundPaths(circuit, false);
  const context: Context = {
    mode: "initial",
    time: 0,
    side: "right",
    tolerance: settings.tolerance,
    transientSources: true,
  };
  let initial: Solution | undefined;
  let states: Map<string, State>;
  if (settings.initialization === "dc") {
    checkGroundPaths(circuit, true);
    const dcContext: Context = { ...context, mode: "dc" };
    constraintCheck(circuit, dcContext);
    const dc = newton(circuit, dcContext);
    initial = solution(circuit, dc.x, dcContext, dc.iterations);
    states = statesFrom(circuit, initial);
  } else {
    states = new Map(
      circuit.elements
        .filter(
          (e) =>
            e.branch.component.type === "capacitor" ||
            e.branch.component.type === "inductor",
        )
        .map((e) => [
          e.branch.component.id,
          {
            voltage:
              e.branch.component.type === "capacitor"
                ? e.branch.component.initial
                : 0,
            current:
              e.branch.component.type === "inductor"
                ? e.branch.component.initial
                : 0,
          },
        ]),
    );
  }
  initial = initialize(circuit, context, states, initial);
  const samples: Solution[] = [initial];
  let last = initial;
  let steps = 0;
  let lastProgress = 0;
  for (const { time: next, atEvent } of grid()) {
    const stepContext: Context = {
      ...context,
      mode: "step",
      time: next,
      side: atEvent ? "left" : "right",
      dt: next - last.time,
      states: statesFrom(circuit, last),
    };
    let solved: ReturnType<typeof newton>;
    try {
      solved = newton(circuit, stepContext, guessFrom(circuit, last));
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith("Newton nonconvergence")
      )
        throw error;
      // A stiff initial derivative can make the trapezoidal history unusable.
      // Retry from the same accepted state, without its potentially extreme guess.
      stepContext.backwardEuler = true;
      solved = newton(circuit, stepContext);
    }
    let sample = solution(circuit, solved.x, stepContext, solved.iterations);
    if (atEvent) {
      sample = initialize(
        circuit,
        { ...context, time: next },
        statesFrom(circuit, sample),
        sample,
      );
      sample.iterations += solved.iterations;
    }
    samples.push(sample);
    last = sample;
    steps++;
    const fraction = steps / planned;
    if (fraction - lastProgress >= 0.01 && fraction < 1) {
      onProgress?.(fraction);
      lastProgress = fraction;
    }
  }
  onProgress?.(1);
  return { samples, steps, elapsedMs: performance.now() - started };
}
