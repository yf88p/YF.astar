import {
  endpointKey,
  type CircuitDocument,
  type Endpoint,
  type Netlist,
} from "./types";

/**
 * Connectivity is exclusively explicit: wires join their referenced endpoints.
 * Coordinates, bends, crossings, and equal label names never make connections.
 * All ground pins share net "0". In a groundless document that ID is reserved,
 * but absent from nets, so the netlist remains inspectable until solve time.
 */
export function buildNetlist(doc: CircuitDocument): Netlist {
  const endpoints = new Map<string, Endpoint>();
  const parents = new Map<string, string>();
  const add = (endpoint: Endpoint) => {
    const key = endpointKey(endpoint);
    if (endpoints.has(key))
      throw new Error(`Duplicate endpoint identifier: ${key}`);
    endpoints.set(key, { ...endpoint });
    parents.set(key, key);
    return key;
  };
  const root = (key: string): string => {
    if (!parents.has(key))
      throw new Error(`Unknown endpoint reference: ${key}`);
    let result = key;
    while (parents.get(result) !== result) result = parents.get(result)!;
    while (key !== result) {
      const next = parents.get(key)!;
      parents.set(key, result);
      key = next;
    }
    return result;
  };
  const join = (a: string, b: string) => {
    const ra = root(a);
    const rb = root(b);
    // Canonical representatives make IDs independent of array/wire ordering.
    if (ra < rb) parents.set(rb, ra);
    else parents.set(ra, rb);
  };

  const grounds: string[] = [];
  for (const component of doc.components) {
    for (const pin of component.type === "ground"
      ? ([0] as const)
      : ([0, 1] as const)) {
      const key = add({ kind: "pin", componentId: component.id, pin });
      if (component.type === "ground") grounds.push(key);
    }
  }
  for (const junction of doc.junctions)
    add({ kind: "junction", junctionId: junction.id });
  for (const wire of doc.wires) join(endpointKey(wire.a), endpointKey(wire.b));
  for (const key of grounds) join(grounds[0], key);

  const groups = new Map<string, Endpoint[]>();
  for (const key of [...endpoints.keys()].sort()) {
    const representative = root(key);
    if (!groups.has(representative)) groups.set(representative, []);
    groups.get(representative)!.push(endpoints.get(key)!);
  }
  const names = new Map<string, Set<string>>();
  for (const label of doc.labels) {
    const representative = root(endpointKey(label.anchor));
    if (!names.has(representative)) names.set(representative, new Set());
    if (label.name.trim()) names.get(representative)!.add(label.name.trim());
  }

  const groundRoot = grounds.length ? root(grounds[0]) : undefined;
  const endpointNets: Record<string, string> = Object.create(null);
  let number = 0;
  const nets = [...groups.keys()].sort().map((representative) => {
    const grounded = representative === groundRoot;
    const id = grounded ? "0" : `n:${encodeURIComponent(representative)}`;
    const members = groups.get(representative)!;
    for (const endpoint of members) endpointNets[endpointKey(endpoint)] = id;
    const labels = [...(names.get(representative) ?? [])].sort();
    const fallback = grounded ? "GND" : `N${++number}`;
    return {
      id,
      name: labels.length ? labels.join(" / ") : fallback,
      endpoints: members,
    };
  });
  const branches = doc.components
    .filter((c) => c.type !== "ground")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((component) => ({
      // Snapshot parameters too: editing the document must not alter an existing netlist.
      component: {
        ...component,
        waveform: { ...component.waveform },
        diode: { ...component.diode },
        switch: { ...component.switch, toggles: [...component.switch.toggles] },
      },
      nodeA:
        endpointNets[
          endpointKey({ kind: "pin", componentId: component.id, pin: 0 })
        ],
      nodeB:
        endpointNets[
          endpointKey({ kind: "pin", componentId: component.id, pin: 1 })
        ],
    }));
  return { nets, branches, endpointNets, ground: "0" };
}
