export type ComponentType =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "diode"
  | "voltage"
  | "current"
  | "switch"
  | "ground";
export type Point = { x: number; y: number };
export type Endpoint =
  | { kind: "pin"; componentId: string; pin: 0 | 1 }
  | { kind: "junction"; junctionId: string };
export type Waveform = {
  type: "dc" | "sine" | "pulse";
  offset: number;
  amplitude: number;
  frequency: number;
  phase: number;
  delay: number;
  rise: number;
  fall: number;
  width: number;
  period: number;
};
export type Component = Point & {
  id: string;
  type: ComponentType;
  rotation: number;
  value: number;
  initial: number;
  waveform: Waveform;
  diode: { is: number; n: number };
  switch: { ron: number; roff: number; closed: boolean; toggles: number[] };
};
export type Wire = { id: string; a: Endpoint; b: Endpoint; bends: Point[] };
export type Junction = Point & { id: string };
export type NetLabel = { id: string; name: string; anchor: Endpoint };
export type Probe =
  | {
      id: string;
      name: string;
      color: string;
      kind: "voltage";
      anchor: Endpoint;
    }
  | {
      id: string;
      name: string;
      color: string;
      kind: "current";
      componentId: string;
    };
export type Settings = {
  duration: number;
  timestep: number;
  tolerance: number;
  initialization: "dc" | "explicit";
};
export type CircuitDocument = {
  version: 1;
  title: string;
  components: Component[];
  wires: Wire[];
  junctions: Junction[];
  labels: NetLabel[];
  probes: Probe[];
  settings: Settings;
};
export type Net = { id: string; name: string; endpoints: Endpoint[] };
export type Branch = { component: Component; nodeA: string; nodeB: string };
export type Netlist = {
  nets: Net[];
  branches: Branch[];
  endpointNets: Record<string, string>;
  ground: string;
};
export type Solution = {
  time: number;
  voltages: Record<string, number>;
  currents: Record<string, number>;
  iterations: number;
};
export type TransientResult = {
  samples: Solution[];
  steps: number;
  elapsedMs: number;
};
export const endpointKey = (e: Endpoint) =>
  e.kind === "pin" ? `${e.componentId}:${e.pin}` : `j:${e.junctionId}`;
export const pin = (componentId: string, p: 0 | 1): Endpoint => ({
  kind: "pin",
  componentId,
  pin: p,
});
export const junction = (junctionId: string): Endpoint => ({
  kind: "junction",
  junctionId,
});
