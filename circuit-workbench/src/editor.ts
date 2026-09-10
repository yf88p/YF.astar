import { endpointPosition } from "./model";
import { endpointKey, junction } from "./types";
import type { CircuitDocument, Endpoint, Point, Wire } from "./types";

export function nextId(doc: CircuitDocument, prefix: string) {
  const ids = new Set(
    [
      ...doc.components,
      ...doc.wires,
      ...doc.junctions,
      ...doc.labels,
      ...doc.probes,
    ].map((c) => c.id),
  );
  let i = 1;
  while (ids.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}
export function wirePoints(doc: CircuitDocument, wire: Wire): Point[] {
  return [
    endpointPosition(doc, wire.a),
    ...wire.bends,
    endpointPosition(doc, wire.b),
  ];
}
export function pointOnSegment(p: Point, a: Point, b: Point, tolerance = 0.01) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= tolerance;
}
export function removeSelection(
  doc: CircuitDocument,
  id: string,
): CircuitDocument {
  const next = structuredClone(doc);
  const affected = (e: Endpoint) =>
    e.kind === "pin" ? e.componentId === id : e.junctionId === id;
  next.components = next.components.filter((c) => c.id !== id);
  next.junctions = next.junctions.filter((j) => j.id !== id);
  next.wires = next.wires.filter(
    (w) => w.id !== id && !affected(w.a) && !affected(w.b),
  );
  next.labels = next.labels.filter((l) => l.id !== id && !affected(l.anchor));
  next.probes = next.probes.filter(
    (p) =>
      p.id !== id &&
      (p.kind === "current" ? p.componentId !== id : !affected(p.anchor)),
  );
  return next;
}

/** An explicit junction splits every segment under the dot; coordinates alone never union nets. */
export function addJunction(
  doc: CircuitDocument,
  point: Point,
): { doc: CircuitDocument; anchor: Endpoint } {
  const next = structuredClone(doc);
  const existing = next.junctions.find(
    (j) => Math.hypot(j.x - point.x, j.y - point.y) < 0.01,
  );
  const id = existing?.id ?? nextId(next, "J");
  if (!existing) next.junctions.push({ id, ...point });
  const anchor = junction(id);
  for (const wire of [...next.wires]) {
    if (
      endpointKey(wire.a) === endpointKey(anchor) ||
      endpointKey(wire.b) === endpointKey(anchor)
    )
      continue;
    const points = wirePoints(doc, wire);
    const segment = points.findIndex(
      (p, i) =>
        i < points.length - 1 && pointOnSegment(point, p, points[i + 1]),
    );
    if (segment < 0) continue;
    const originalB = wire.b;
    wire.b = anchor;
    wire.bends = points.slice(1, segment + 1);
    next.wires.push({
      id: nextId(next, "W"),
      a: anchor,
      b: originalB,
      bends: points.slice(segment + 1, -1),
    });
  }
  return { doc: next, anchor };
}

export function crossings(doc: CircuitDocument): Point[] {
  const points: Point[] = [];
  const segments = doc.wires.flatMap((w) => {
    const p = wirePoints(doc, w);
    return p.slice(1).map((b, i) => ({ a: p[i], b, id: w.id }));
  });
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i],
        b = segments[j];
      if (a.id === b.id) continue;
      const rx = a.b.x - a.a.x,
        ry = a.b.y - a.a.y,
        sx = b.b.x - b.a.x,
        sy = b.b.y - b.a.y;
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) < 1e-9) continue;
      const qx = b.a.x - a.a.x,
        qy = b.a.y - a.a.y;
      const t = (qx * sy - qy * sx) / denom,
        u = (qx * ry - qy * rx) / denom;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
        const p = { x: a.a.x + t * rx, y: a.a.y + t * ry };
        if (
          !doc.junctions.some((n) => Math.hypot(n.x - p.x, n.y - p.y) < 0.01) &&
          !points.some((n) => Math.hypot(n.x - p.x, n.y - p.y) < 0.01)
        )
          points.push(p);
      }
    }
  return points;
}
