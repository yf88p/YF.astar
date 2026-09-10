import type {
  CircuitDocument,
  Component,
  ComponentType,
  Endpoint,
  Point,
} from "./types";

const componentTypes: ComponentType[] = [
  "resistor",
  "capacitor",
  "inductor",
  "diode",
  "voltage",
  "current",
  "switch",
  "ground",
];
const prefixes: Record<string, number> = {
  y: 1e-24,
  z: 1e-21,
  a: 1e-18,
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  "\u00b5": 1e-6,
  "\u03bc": 1e-6,
  m: 1e-3,
  "": 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Z: 1e21,
  Y: 1e24,
};

export function parseEngineering(text: string, unit?: string): number {
  const match =
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([yzafpnu\u00b5\u03bcmkKMGTPEZY]?)\s*(ohms?|\u03a9|Hz|V|A|F|H|s|deg)?\s*$/.exec(
      text,
    );
  if (!match)
    throw new Error(
      "Enter a finite number with an optional SI prefix, such as 4.7k or 2.2u.",
    );
  const suffix = match[3]?.replace(/^(?:ohms?|\u03a9)$/, "ohm");
  if (unit !== undefined && suffix && suffix !== unit)
    throw new Error(
      `Expected ${unit || "a dimensionless number"}, not ${match[3]}. The value was not applied.`,
    );
  const value = Number(match[1]) * prefixes[match[2]];
  if (
    !Number.isFinite(value) ||
    (value === 0 && /[1-9]/.test(match[1].split(/[eE]/)[0]))
  )
    throw new Error("The value is outside the finite numeric range.");
  return value;
}

export function formatEngineering(value: number, unit = ""): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value === 0) return unit ? `0 ${unit}` : "0";
  let exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  if (exponent < -24 || exponent > 24)
    return `${value.toExponential(3)}${unit ? ` ${unit}` : ""}`;
  let scaled = Number((value / 10 ** exponent).toPrecision(4));
  if (Math.abs(scaled) >= 1000 && exponent < 24) {
    exponent += 3;
    scaled /= 1000;
  }
  const prefix = [
    "y",
    "z",
    "a",
    "f",
    "p",
    "n",
    "u",
    "m",
    "",
    "k",
    "M",
    "G",
    "T",
    "P",
    "E",
    "Z",
    "Y",
  ][(exponent + 24) / 3];
  return `${scaled}${unit ? " " : ""}${prefix}${unit}`;
}

export function createComponent(
  type: ComponentType,
  id: string,
  x: number,
  y: number,
): Component {
  if (!componentTypes.includes(type))
    throw new Error(`Unknown component type: ${type}`);
  const values: Record<ComponentType, number> = {
    resistor: 1000,
    capacitor: 1e-6,
    inductor: 0.01,
    diode: 0.7,
    voltage: 5,
    current: 0.001,
    switch: 1,
    ground: 0,
  };
  return {
    id,
    type,
    x,
    y,
    rotation: 0,
    value: values[type],
    initial: 0,
    waveform: {
      type: "dc",
      offset: 0,
      amplitude: 5,
      frequency: 1000,
      phase: 0,
      delay: 0,
      rise: 1e-6,
      fall: 1e-6,
      width: 0.0005,
      period: 0.001,
    },
    diode: { is: 1e-12, n: 1 },
    switch: { ron: 0.1, roff: 1e9, closed: false, toggles: [] },
  };
}

export function emptyDocument(): CircuitDocument {
  return {
    version: 1,
    title: "Untitled circuit",
    components: [],
    wires: [],
    junctions: [],
    labels: [],
    probes: [],
    settings: {
      duration: 0.01,
      timestep: 0.00001,
      tolerance: 1e-7,
      initialization: "explicit",
    },
  };
}

export function componentPins(component: Component): Point[] {
  if (component.type === "ground") return [{ x: component.x, y: component.y }];
  const angle = (component.rotation * Math.PI) / 180;
  return [-40, 40].map((x) => ({
    x: component.x + x * Math.cos(angle),
    y: component.y + x * Math.sin(angle),
  }));
}

export function endpointPosition(
  doc: CircuitDocument,
  endpoint: Endpoint,
): Point {
  if (endpoint.kind === "junction") {
    const found = doc.junctions.find((j) => j.id === endpoint.junctionId);
    if (!found) throw new Error(`Unknown junction: ${endpoint.junctionId}`);
    return { x: found.x, y: found.y };
  }
  const component = doc.components.find((c) => c.id === endpoint.componentId);
  if (!component) throw new Error(`Unknown component: ${endpoint.componentId}`);
  const point = componentPins(component)[endpoint.pin];
  if (!point) throw new Error(`Invalid pin ${endpoint.pin} on ${component.id}`);
  return point;
}

/** Validate the whole import before handing an independent copy to the editor. */
export function validateDocument(input: unknown): CircuitDocument {
  function fail(path: string, message: string): never {
    throw new Error(`${path}: ${message}`);
  }
  function object(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      fail(path, "expected an object");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      fail(path, "expected a plain JSON object");
    return value as Record<string, unknown>;
  }
  function number(
    value: unknown,
    path: string,
    min = -Number.MAX_VALUE,
    max = Number.MAX_VALUE,
  ): number {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      fail(path, `expected a finite number between ${min} and ${max}`);
    return value;
  }
  function positive(value: unknown, path: string): number {
    const result = number(value, path);
    if (result <= 0) fail(path, "must be positive");
    return result;
  }
  function text(value: unknown, path: string, max = 160): string {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > max ||
      /[\u0000-\u001f]/.test(value)
    )
      fail(path, `expected nonempty text of at most ${max} characters`);
    return value;
  }
  function list(value: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max)
      fail(path, `expected an array of at most ${max} items`);
    return value;
  }
  function point(value: Record<string, unknown>, path: string): void {
    number(value.x, `${path}.x`, -100000, 100000);
    number(value.y, `${path}.y`, -100000, 100000);
  }
  const ids = new Set<string>();
  function id(value: unknown, path: string): string {
    const result = text(value, path, 80);
    if (
      !/^[A-Za-z0-9_-]+$/.test(result) ||
      ["__proto__", "prototype", "constructor"].includes(result)
    )
      fail(path, "use letters, numbers, underscores or hyphens for IDs");
    if (ids.has(result)) fail(path, `duplicate ID ${result}`);
    ids.add(result);
    return result;
  }
  const doc = object(input, "document");
  if (doc.version !== 1)
    fail("version", "only circuit document version 1 is supported");
  text(doc.title, "title");
  const components = list(doc.components, "components", 200);
  const wires = list(doc.wires, "wires", 1000);
  const junctions = list(doc.junctions, "junctions", 1000);
  const labels = list(doc.labels, "labels", 1000);
  const probes = list(doc.probes, "probes", 200);
  const componentMap = new Map<string, Record<string, unknown>>();
  for (const [index, value] of components.entries()) {
    const path = `components[${index}]`;
    const c = object(value, path);
    const key = id(c.id, `${path}.id`);
    if (!componentTypes.includes(c.type as ComponentType))
      fail(`${path}.type`, "unknown component type");
    point(c, path);
    number(c.rotation, `${path}.rotation`, -360000, 360000);
    number(c.value, `${path}.value`);
    if (["resistor", "capacitor", "inductor"].includes(c.type as string))
      positive(c.value, `${path}.value`);
    number(c.initial, `${path}.initial`);
    const waveform = object(c.waveform, `${path}.waveform`);
    if (!["dc", "sine", "pulse"].includes(waveform.type as string))
      fail(`${path}.waveform.type`, "unknown waveform");
    for (const name of ["offset", "amplitude", "phase"])
      number(waveform[name], `${path}.waveform.${name}`);
    number(waveform.frequency, `${path}.waveform.frequency`, 0);
    for (const name of ["delay", "rise", "fall", "width"])
      number(waveform[name], `${path}.waveform.${name}`, 0);
    const period = positive(waveform.period, `${path}.waveform.period`);
    if (
      waveform.type === "pulse" &&
      (waveform.rise as number) +
        (waveform.width as number) +
        (waveform.fall as number) >
        period
    )
      fail(
        `${path}.waveform`,
        "pulse rise + width + fall must not exceed its period",
      );
    const diode = object(c.diode, `${path}.diode`);
    positive(diode.is, `${path}.diode.is`);
    positive(diode.n, `${path}.diode.n`);
    const sw = object(c.switch, `${path}.switch`);
    const ron = positive(sw.ron, `${path}.switch.ron`);
    const roff = positive(sw.roff, `${path}.switch.roff`);
    if (ron >= roff) fail(`${path}.switch`, "ron must be less than roff");
    if (typeof sw.closed !== "boolean")
      fail(`${path}.switch.closed`, "expected a boolean");
    let previous = -1;
    for (const [i, time] of list(
      sw.toggles,
      `${path}.switch.toggles`,
      1000,
    ).entries()) {
      const t = number(time, `${path}.switch.toggles[${i}]`, 0);
      if (t <= previous)
        fail(
          `${path}.switch.toggles`,
          "times must be distinct and sorted ascending",
        );
      previous = t;
    }
    componentMap.set(key, c);
  }
  const junctionIds = new Set<string>();
  for (const [index, value] of junctions.entries()) {
    const path = `junctions[${index}]`;
    const j = object(value, path);
    junctionIds.add(id(j.id, `${path}.id`));
    point(j, path);
  }
  function endpoint(value: unknown, path: string): void {
    const e = object(value, path);
    if (e.kind === "junction") {
      if (typeof e.junctionId !== "string" || !junctionIds.has(e.junctionId))
        fail(path, "junction does not exist");
    } else if (e.kind === "pin") {
      const c =
        typeof e.componentId === "string"
          ? componentMap.get(e.componentId)
          : undefined;
      if (!c) fail(path, "component does not exist");
      if (e.pin !== 0 && (e.pin !== 1 || c.type === "ground"))
        fail(path, "invalid component pin");
    } else fail(path, "expected a pin or junction endpoint");
  }
  let totalBends = 0;
  for (const [index, value] of wires.entries()) {
    const path = `wires[${index}]`;
    const w = object(value, path);
    id(w.id, `${path}.id`);
    endpoint(w.a, `${path}.a`);
    endpoint(w.b, `${path}.b`);
    const bends = list(w.bends, `${path}.bends`, 100);
    totalBends += bends.length;
    if (totalBends > 10000)
      fail("wires", "at most 10000 total bend points are supported");
    for (const [i, bend] of bends.entries())
      point(object(bend, `${path}.bends[${i}]`), `${path}.bends[${i}]`);
  }
  for (const [index, value] of labels.entries()) {
    const path = `labels[${index}]`;
    const label = object(value, path);
    id(label.id, `${path}.id`);
    text(label.name, `${path}.name`, 80);
    endpoint(label.anchor, `${path}.anchor`);
  }
  for (const [index, value] of probes.entries()) {
    const path = `probes[${index}]`;
    const probe = object(value, path);
    id(probe.id, `${path}.id`);
    text(probe.name, `${path}.name`, 80);
    text(probe.color, `${path}.color`, 80);
    if (!/^#[0-9a-fA-F]{6}$/.test(probe.color as string))
      fail(
        `${path}.color`,
        "expected a six-digit hexadecimal color such as #df704b",
      );
    if (probe.kind === "voltage") endpoint(probe.anchor, `${path}.anchor`);
    else if (probe.kind === "current") {
      const c =
        typeof probe.componentId === "string"
          ? componentMap.get(probe.componentId)
          : undefined;
      if (!c || c.type === "ground")
        fail(path, "current probe must reference a two-pin component");
    } else fail(`${path}.kind`, "expected voltage or current");
  }
  const settings = object(doc.settings, "settings");
  const duration = positive(settings.duration, "settings.duration");
  const timestep = positive(settings.timestep, "settings.timestep");
  if (timestep > duration)
    fail("settings.timestep", "must not exceed duration");
  if (duration / timestep > 100000)
    fail("settings", "at most 100000 nominal timesteps are supported");
  const tolerance = positive(settings.tolerance, "settings.tolerance");
  if (tolerance >= 1) fail("settings.tolerance", "must be less than 1");
  if (
    settings.initialization !== "dc" &&
    settings.initialization !== "explicit"
  )
    fail("settings.initialization", "expected dc or explicit");
  // Do not rebuild just the fields the simulator uses: retain routing, probes and metadata.
  try {
    return structuredClone(input) as CircuitDocument;
  } catch {
    return fail("document", "must contain cloneable JSON data");
  }
}
