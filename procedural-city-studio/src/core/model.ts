/**
 * Renderer-independent, metre-based city model. All editing operations are atomic.
 * Roads are straight segments, at least 2m long, with >=25 degree junction angles.
 * Levels are discrete; elevated nodes start 12m above terrain per level. Crossings
 * without connectivity require 5m vertical separation. Simple, hole-free ground
 * faces produce axis-aligned lots targeting a 28m subdivision with 2m setbacks.
 * Density/traffic are 0..1; day is an hour in 0..24. Terrain samples are row-major.
 */
export interface Point { x: number; z: number }
export interface Node { id: string; x: number; z: number; y: number; level: number }
export interface Road { id: string; a: string; b: string; width: number; profile: 'local' | 'boulevard'; level: number; clearance: number }
export interface Terrain { size: number; resolution: number; heights: number[] }
export interface Water { id: string; points: Point[]; width: number; level: number }
export interface Parcel { id: string; blockId: string; polygon: Point[]; zone: 'residential' | 'commercial' | 'mixed' | 'park'; buildingId?: string }
export interface Building { id: string; parcelId: string; x: number; z: number; width: number; depth: number; floors: number; palette: number; roof: 'flat' | 'gable' | 'terrace'; edited: boolean }
/** Generated, persistent placement; rebuild replaces props, there are no prop overrides.
 * Rotation is radians about +Y (local +X maps to cos(r), -sin(r) in X/Z).
 * Size is nominal tree height (canopy radius <= .55 size), bench width (depth .3 size),
 * path width, or streetlight height (pole radius .12m). Paths have a centered length
 * along local X. Heights follow terrain, except lights follow their host road deck.
 * Hosts are parcel/road IDs or the reserved "terrain" host. Terrain paths are timber
 * bank walks; parcel paths are stone. Tree form/tint uses seed + ID + ":appearance".
 */
export interface Prop { id: string; kind: 'tree' | 'bench' | 'path' | 'streetlight'; x: number; z: number; size: number; rotation: number; hostId: string; length?: number }
export interface City {
  version: 1; name: string; seed: number; nextId: number; terrain: Terrain;
  water: Water[]; nodes: Node[]; roads: Road[]; parcels: Parcel[]; buildings: Building[]; props: Prop[];
  settings: { density: number; traffic: number; day: number };
  views: { name: string; position: number[]; target: number[] }[];
}
export interface Block { id: string; polygon: Point[]; nodeIds: string[]; area: number }
export interface Alignment { points: { x: number; y: number; z: number }[]; bridge: boolean; maxGrade: number; waterStart?: number; waterEnd?: number }

const EPS = 1e-6;
const MAX_GRADE = 0.12;
const APPROACH_GRADE = 0.10;
const SNAP = 8;
const MIN_EDGE = 2;
const VERTICAL_CLEARANCE = 5;
const SETBACK = 2;
const fail = (message: string): never => { throw new Error(message); };
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const cross = (a: Point, b: Point) => a.x * b.z - a.z * b.x;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const rounded = (x: number) => Math.round(x * 1000) / 1000;

export function clone<T>(x: T): T { return structuredClone(x); }

export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function random(seed: number | string): () => number {
  let state = typeof seed === 'string' ? hash(seed) : seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nextId(city: City, prefix: string): string {
  const used = new Set([...city.nodes, ...city.roads, ...city.water, ...city.parcels, ...city.buildings, ...city.props].map(x => x.id));
  let id: string;
  do { id = `${prefix}-${city.nextId++}`; } while (used.has(id));
  return id;
}

function checkPoint(city: City, p: Point): void {
  if (!p || !finite(p.x) || !finite(p.z) || Math.abs(p.x) > city.terrain.size / 2 || Math.abs(p.z) > city.terrain.size / 2) fail('Point lies outside the terrain bounds.');
}

/** Heights are row-major, starting at (-size/2, -size/2); sampling clamps to the edge. */
export function heightAt(city: City, x: number, z: number): number {
  if (!finite(x) || !finite(z)) fail('Height coordinates must be finite.');
  const { size, resolution: n, heights } = city.terrain;
  const gx = clamp((x / size + 0.5) * (n - 1), 0, n - 1);
  const gz = clamp((z / size + 0.5) * (n - 1), 0, n - 1);
  const ix = Math.min(n - 2, Math.floor(gx)), iz = Math.min(n - 2, Math.floor(gz));
  const u = gx - ix, v = gz - iz;
  return (heights[iz * n + ix] * (1 - u) + heights[iz * n + ix + 1] * u) * (1 - v)
    + (heights[(iz + 1) * n + ix] * (1 - u) + heights[(iz + 1) * n + ix + 1] * u) * v;
}

function projection(p: Point, a: Point, b: Point): { t: number; point: Point; distance: number } {
  const d = subtract(b, a), len2 = d.x * d.x + d.z * d.z;
  const t = len2 ? clamp(((p.x - a.x) * d.x + (p.z - a.z) * d.z) / len2, 0, 1) : 0;
  const point = lerp(a, b, t);
  return { t, point, distance: distance(p, point) };
}

export function isWater(city: City, x: number, z: number): boolean {
  if (!finite(x) || !finite(z)) fail('Water coordinates must be finite.');
  return city.water.some(w => w.points.slice(1).some((b, i) => projection({ x, z }, w.points[i], b).distance <= w.width / 2 + EPS));
}

type Intersection = { t: number; u: number; point: Point; overlap: boolean };
function intersection(a: Point, b: Point, c: Point, d: Point): Intersection | undefined {
  const r = subtract(b, a), s = subtract(d, c), q = subtract(c, a);
  const det = cross(r, s), rr = r.x * r.x + r.z * r.z;
  if (Math.abs(det) < EPS) {
    if (Math.abs(cross(q, r)) > EPS * Math.max(1, Math.sqrt(rr)) || rr < EPS) return;
    const t0 = (q.x * r.x + q.z * r.z) / rr;
    const t1 = t0 + (s.x * r.x + s.z * r.z) / rr;
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
    if (hi < lo - EPS) return;
    const t = clamp((lo + hi) / 2, 0, 1), point = lerp(a, b, t);
    return { t, u: projection(point, c, d).t, point, overlap: (hi - lo) * Math.sqrt(rr) > EPS };
  }
  const t = cross(q, s) / det, u = cross(q, r) / det;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return;
  return { t: clamp(t, 0, 1), u: clamp(u, 0, 1), point: lerp(a, b, clamp(t, 0, 1)), overlap: false };
}

/** Exact line/capsule intervals, including round river ends and bends. */
function waterIntervals(city: City, a: Point, b: Point): { start: number; end: number; level: number }[] {
  const result: { start: number; end: number; level: number }[] = [];
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  for (const water of city.water) {
    const intervals: [number, number][] = [];
    for (let i = 1; i < water.points.length; i++) {
      const c = water.points[i - 1], d = water.points[i], length = distance(c, d), radius = water.width / 2;
      if (length < EPS) continue;
      const ux = (d.x - c.x) / length, uz = (d.z - c.z) / length;
      let lo = 0, hi = 1;
      const clip = (start: number, delta: number, min: number, max: number) => {
        if (Math.abs(delta) < EPS) { if (start < min || start > max) hi = -1; return; }
        const t0 = (min - start) / delta, t1 = (max - start) / delta;
        lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      };
      clip((a.x - c.x) * ux + (a.z - c.z) * uz, dx * ux + dz * uz, 0, length);
      clip(-(a.x - c.x) * uz + (a.z - c.z) * ux, -dx * uz + dz * ux, -radius, radius);
      if (hi >= lo) intervals.push([lo, hi]);
      for (const p of [c, d]) {
        const qx = a.x - p.x, qz = a.z - p.z;
        const bb = 2 * (qx * dx + qz * dz), cc = qx * qx + qz * qz - radius * radius;
        const discriminant = bb * bb - 4 * length2 * cc;
        if (discriminant < 0) continue;
        const root = Math.sqrt(discriminant);
        const start = Math.max(0, (-bb - root) / (2 * length2)), end = Math.min(1, (-bb + root) / (2 * length2));
        if (end >= start) intervals.push([start, end]);
      }
    }
    intervals.sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (last && interval[0] <= last[1] + EPS) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    for (const [start, end] of merged) result.push({ start, end, level: water.level });
  }
  return result.sort((x, y) => x.start - y.start);
}

/** Bridges use flat decks and 10% land approaches; all emitted segments must stay <=12%. */
export function getAlignment(city: City, road: Road): Alignment {
  const a = city.nodes.find(n => n.id === road.a), b = city.nodes.find(n => n.id === road.b);
  if (!a || !b) return fail(`Road ${road.id} has a missing endpoint.`);
  const length = distance(a, b);
  if (length < MIN_EDGE - EPS) fail('Road segments must be at least 2 metres long.');
  const water = waterIntervals(city, a, b);
  const baseline = (t: number) => {
    const p = lerp(a, b, t);
    return heightAt(city, p.x, p.z) + road.level * 12;
  };
  const raisedA = a.y > baseline(0) + 0.01, raisedB = b.y > baseline(1) + 0.01;
  const ts = new Set<number>([0, 1]);
  const count = Math.ceil(length / 4);
  for (let i = 1; i < count; i++) ts.add(i / count);
  const grid = city.terrain.size / (city.terrain.resolution - 1);
  for (let i = 0; i < city.terrain.resolution; i++) {
    const coordinate = -city.terrain.size / 2 + i * grid;
    for (const t of [(coordinate - a.x) / (b.x - a.x), (coordinate - a.z) / (b.z - a.z)]) if (finite(t) && t > 0 && t < 1) ts.add(t);
  }
  const decks = water.map(w => {
    // Include the bank grid cell, so elevated decks do not dip into the carved river bed.
    const bank = road.level > 0 ? grid / length : 0;
    let y = Math.max(w.level + road.clearance, baseline(clamp(w.start - bank, 0, 1)), baseline(clamp(w.end + bank, 0, 1)), baseline(w.start), baseline(w.end));
    for (const t of ts) if (t >= w.start && t <= w.end) y = Math.max(y, baseline(t));
    return { ...w, start: clamp(w.start - bank, 0, 1), end: clamp(w.end + bank, 0, 1), y };
  });
  // A nearby higher deck's approach must not introduce a step inside a lower crossing.
  for (let pass = 0; pass < decks.length; pass++) for (let i = 0; i < decks.length; i++) for (let j = i + 1; j < decks.length; j++) {
    const gap = Math.max(decks[i].start - decks[j].end, decks[j].start - decks[i].end, 0) * length;
    decks[i].y = Math.max(decks[i].y, decks[j].y - APPROACH_GRADE * gap);
    decks[j].y = Math.max(decks[j].y, decks[i].y - APPROACH_GRADE * gap);
  }
  for (const w of decks) {
    ts.add(w.start); ts.add(w.end);
    for (const t of [w.start - (w.y - baseline(w.start)) / (APPROACH_GRADE * length), w.end + (w.y - baseline(w.end)) / (APPROACH_GRADE * length)]) if (t > 0 && t < 1) ts.add(t);
  }
  const points = [...ts].sort((x, y) => x - y).filter((t, i, values) => !i || (t - values[i - 1]) * length > EPS).map(t => {
    const p = lerp(a, b, t);
    let y = baseline(t);
    // A split bridge approach retains its lifted endpoint; ordinary roads follow terrain.
    if (raisedA) y = Math.max(y, a.y - APPROACH_GRADE * t * length);
    if (raisedB) y = Math.max(y, b.y - APPROACH_GRADE * (1 - t) * length);
    for (const w of decks) {
      const away = Math.max(w.start - t, t - w.end, 0) * length;
      y = Math.max(y, w.y - APPROACH_GRADE * away);
    }
    return { ...p, y };
  });
  if (Math.abs(points[0].y - a.y) > 0.01 || Math.abs(points[points.length - 1].y - b.y) > 0.01) fail(`Road ${road.id}: insufficient land for a bridge approach, or endpoint below terrain.`);
  points[0].y = a.y; points[points.length - 1].y = b.y;
  let maxGrade = 0;
  for (let i = 1; i < points.length; i++) maxGrade = Math.max(maxGrade, Math.abs(points[i].y - points[i - 1].y) / distance(points[i], points[i - 1]));
  if (maxGrade > MAX_GRADE + EPS) fail(`Road ${road.id} exceeds the maximum 12% grade.`);
  const result: Alignment = { points, bridge: water.length > 0, maxGrade };
  // Distances in metres along the road, not normalized parameters.
  if (water.length) { result.waterStart = Math.min(...water.map(w => w.start)) * length; result.waterEnd = Math.max(...water.map(w => w.end)) * length; }
  return result;
}

function alignmentHeight(alignment: Alignment, t: number): number {
  const points = alignment.points, length = distance(points[0], points[points.length - 1]), target = t * length;
  for (let i = 1; i < points.length; i++) {
    const end = distance(points[0], points[i]);
    if (end >= target - EPS) {
      const start = distance(points[0], points[i - 1]);
      const f = clamp((target - start) / (end - start), 0, 1);
      return points[i - 1].y * (1 - f) + points[i].y * f;
    }
  }
  return points[points.length - 1].y;
}

/** Shared trimmed road span for junction surfaces, markings and persistent lights. */
export function roadSpan(city: City, road: Road): { start: number; end: number } {
  const a = city.nodes.find(n => n.id === road.a)!, b = city.nodes.find(n => n.id === road.b)!, length = distance(a, b);
  const radius = (node: Node, end: Node) => {
    const links = city.roads.filter(r => r.a === node.id || r.b === node.id);
    if (links.length === 1) return 0;
    let result = Math.max(...links.map(r => r.width)) / 2 + 1.2;
    for (const other of links) {
      if (other.id === road.id) continue;
      const next = city.nodes.find(n => n.id === (other.a === node.id ? other.b : other.a))!;
      const angle = Math.acos(clamp(((next.x - node.x) * (end.x - node.x) + (next.z - node.z) * (end.z - node.z)) / (distance(node, next) * length), -1, 1));
      if (angle < Math.PI - 0.05) result = Math.max(result, (road.width + other.width) * 0.25 / Math.tan(angle / 2));
    }
    return Math.min(length * 0.43, result);
  };
  return { start: radius(a, b), end: length - radius(b, a) };
}

function signedArea(polygon: Point[]): number {
  return polygon.reduce((sum, p, i) => sum + cross(p, polygon[(i + 1) % polygon.length]), 0) / 2;
}

function simplePolygon(polygon: Point[]): boolean {
  if (polygon.length < 3 || Math.abs(signedArea(polygon)) < EPS) return false;
  for (let i = 0; i < polygon.length; i++) {
    if (distance(polygon[i], polygon[(i + 1) % polygon.length]) < EPS) return false;
    for (let j = i + 1; j < polygon.length; j++) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      if (intersection(polygon[i], polygon[(i + 1) % polygon.length], polygon[j], polygon[(j + 1) % polygon.length])) return false;
    }
  }
  return true;
}

function simplifyPolygon(points: Point[]): Point[] {
  let polygon = points.map(p => ({ x: p.x, z: p.z }));
  let changed = true;
  while (changed && polygon.length > 3) {
    changed = false;
    polygon = polygon.filter((p, i, all) => {
      const previous = all[(i + all.length - 1) % all.length], next = all[(i + 1) % all.length];
      if (projection(p, previous, next).distance < EPS) { changed = true; return false; }
      return true;
    });
  }
  return polygon;
}

function geometryId(prefix: string, polygon: Point[], parent = ''): string {
  const key = parent + ':' + polygon.map(p => `${rounded(p.x)},${rounded(p.z)}`).sort().join(';');
  return `${prefix}-${hash(key).toString(36)}-${hash(prefix + key).toString(36)}`;
}

export function extractBlocks(city: City): Block[] {
  const nodes = new Map(city.nodes.map(n => [n.id, n]));
  const adjacent = new Map<string, string[]>();
  for (const road of city.roads) {
    if (road.level !== 0) continue;
    if (!nodes.has(road.a) || !nodes.has(road.b)) fail('Cannot extract blocks from dangling roads.');
    if (!adjacent.has(road.a)) adjacent.set(road.a, []);
    if (!adjacent.has(road.b)) adjacent.set(road.b, []);
    adjacent.get(road.a)!.push(road.b); adjacent.get(road.b)!.push(road.a);
  }
  for (const [id, neighbors] of adjacent) {
    const a = nodes.get(id)!;
    neighbors.sort((left, right) => {
      const b = nodes.get(left)!, c = nodes.get(right)!;
      return Math.atan2(b.z - a.z, b.x - a.x) - Math.atan2(c.z - a.z, c.x - a.x) || left.localeCompare(right);
    });
  }
  const visited = new Set<string>(), blocks: Block[] = [];
  for (const [startA, neighbors] of adjacent) for (const startB of neighbors) {
    const nodeIds: string[] = [];
    let a = startA, b = startB, closed = false;
    for (let steps = 0; steps <= city.roads.length * 2; steps++) {
      const key = JSON.stringify([a, b]);
      if (visited.has(key)) { closed = a === startA && b === startB; break; }
      visited.add(key); nodeIds.push(a);
      const outgoing = adjacent.get(b)!;
      const next = outgoing[(outgoing.indexOf(a) + outgoing.length - 1) % outgoing.length];
      a = b; b = next;
    }
    if (!closed || nodeIds.length < 3) continue;
    // A dangling street traverses out and back; remove that spur from the face boundary.
    let reduced = [...nodeIds], changed = true;
    while (changed && reduced.length > 3) {
      changed = false;
      for (let i = 0; i < reduced.length; i++) if (reduced[i] === reduced[(i + 2) % reduced.length]) {
        reduced = [...reduced.slice(i + 2), ...reduced.slice(0, i)]; changed = true; break;
      }
    }
    const polygon = simplifyPolygon(reduced.map(id => nodes.get(id)!)), area = signedArea(polygon);
    if (area > 25) {
      if (!simplePolygon(polygon)) fail('A block has a hole or a self-touching boundary. Divide it into simple faces before rebuilding.');
      blocks.push({ id: geometryId('block', polygon), polygon, nodeIds: reduced, area });
    }
  }
  for (let i = 0; i < blocks.length; i++) for (let j = 0; j < blocks.length; j++) {
    if (i === j || blocks[i].area >= blocks[j].area) continue;
    const inner = blocks[i].polygon, outer = blocks[j].polygon;
    if (inner.every(p => pointInPolygon(p, outer)) && inner.some(p => outer.every((a, k) => projection(p, a, outer[(k + 1) % outer.length]).distance > EPS))) fail('Nested road loops create a block with a hole. Divide it into simple faces before rebuilding.');
  }
  return blocks.sort((a, b) => a.id.localeCompare(b.id));
}

function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (projection(p, a, b).distance < EPS) return true;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function bounds(polygon: Point[]) {
  return { minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)), minZ: Math.min(...polygon.map(p => p.z)), maxZ: Math.max(...polygon.map(p => p.z)) };
}

function boundsOverlap(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>): boolean {
  return a.maxX > b.minX + EPS && b.maxX > a.minX + EPS && a.maxZ > b.minZ + EPS && b.maxZ > a.minZ + EPS;
}

function rectangle(minX: number, minZ: number, maxX: number, maxZ: number): Point[] {
  return [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }];
}

function footprint(b: Building): Point[] { return rectangle(b.x - b.width / 2, b.z - b.depth / 2, b.x + b.width / 2, b.z + b.depth / 2); }

function containsPolygon(outer: Point[], inner: Point[], setback = 0): boolean {
  if (!inner.every(p => pointInPolygon(p, outer))) return false;
  for (let i = 0; i < outer.length; i++) for (let j = 0; j < inner.length; j++) {
    const a = outer[i], b = outer[(i + 1) % outer.length], c = inner[j], d = inner[(j + 1) % inner.length];
    const hit = intersection(a, b, c, d);
    if (hit && (setback > 0 || (hit.t > EPS && hit.t < 1 - EPS && hit.u > EPS && hit.u < 1 - EPS))) return false;
    if (segmentDistance(a, b, c, d) < setback - EPS) return false;
  }
  // Corners alone do not detect a concave boundary that enters a rectangle through a vertex.
  const box = bounds(inner);
  if (outer.some(p => p.x > box.minX + EPS && p.x < box.maxX - EPS && p.z > box.minZ + EPS && p.z < box.maxZ - EPS)) return false;
  return true;
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (intersection(a, b, c, d)) return 0;
  return Math.min(projection(a, c, d).distance, projection(b, c, d).distance, projection(c, a, b).distance, projection(d, a, b).distance);
}

function segmentPolygonDistance(a: Point, b: Point, polygon: Point[]): number {
  if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return 0;
  return Math.min(...polygon.map((p, i) => segmentDistance(a, b, p, polygon[(i + 1) % polygon.length])));
}

function polygonsOverlap(a: Point[], b: Point[]): boolean {
  if (!boundsOverlap(bounds(a), bounds(b))) return false;
  if (a.some(p => pointInPolygon(p, b)) || b.some(p => pointInPolygon(p, a))) return true;
  return a.some((p, i) => b.some((q, j) => !!intersection(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));
}

function clearOfInfrastructure(city: City, polygon: Point[], nodes: Map<string, Node>): boolean {
  const box = bounds(polygon);
  for (const road of city.roads) {
    const a = nodes.get(road.a)!, b = nodes.get(road.b)!, margin = road.width / 2 + SETBACK;
    if (Math.max(a.x, b.x) + margin < box.minX || Math.min(a.x, b.x) - margin > box.maxX || Math.max(a.z, b.z) + margin < box.minZ || Math.min(a.z, b.z) - margin > box.maxZ) continue;
    if (segmentPolygonDistance(a, b, polygon) < margin - EPS) return false;
  }
  for (const water of city.water) for (let i = 1; i < water.points.length; i++) if (segmentPolygonDistance(water.points[i - 1], water.points[i], polygon) < water.width / 2 + SETBACK - EPS) return false;
  return true;
}

function propFootprint(p: Prop): Point[] {
  const halfX = p.kind === 'path' ? p.length! / 2 : p.kind === 'tree' ? p.size * 0.55 : p.kind === 'bench' ? p.size / 2 : 0.12;
  const halfZ = p.kind === 'path' ? p.size / 2 : p.kind === 'bench' ? p.size * 0.15 : halfX;
  // A tree's radial canopy envelope does not grow when the tree rotates.
  const c = p.kind === 'tree' ? 1 : Math.cos(p.rotation), s = p.kind === 'tree' ? 0 : Math.sin(p.rotation);
  return rectangle(-halfX, -halfZ, halfX, halfZ).map(q => ({ x: p.x + q.x * c + q.z * s, z: p.z - q.x * s + q.z * c }));
}

function generateProps(city: City): void {
  const props: Prop[] = [], nodes = new Map(city.nodes.map(n => [n.id, n]));
  const buildingBoxes = city.buildings.map(b => ({ minX: b.x - b.width / 2 - 1.5, maxX: b.x + b.width / 2 + 1.5, minZ: b.z - b.depth / 2 - 1.5, maxZ: b.z + b.depth / 2 + 1.5 }));
  const walks: Point[][] = [], furniture: Point[][] = [];
  const clear = (prop: Prop) => {
    const polygon = propFootprint(prop), box = bounds(polygon), limit = city.terrain.size / 2;
    if (box.minX < -limit || box.maxX > limit || box.minZ < -limit || box.maxZ > limit || !clearOfInfrastructure(city, polygon, nodes)) return false;
    if (buildingBoxes.some(b => boundsOverlap(box, b))) return false;
    return ![...walks, ...furniture].some(p => polygonsOverlap(polygon, p));
  };
  // Preserve the original 7m bank-walk sampling, now as individually documented paths.
  for (const water of city.water) {
    const points: Point[] = [];
    for (let i = 1; i < water.points.length; i++) {
      const a = water.points[i - 1], b = water.points[i], count = Math.ceil(distance(a, b) / 7);
      for (let j = i === 1 ? 0 : 1; j <= count; j++) points.push(lerp(a, b, j / count));
    }
    for (let i = 2; i < points.length - 2; i++) {
      const p = points[i], a = points[i - 1], b = points[i + 1], len = distance(a, b);
      if (len < EPS) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      for (const side of [-1, 1]) {
        const x = p.x - uz * (water.width / 2 + 7) * side, z = p.z + ux * (water.width / 2 + 7) * side;
        const id = `prop-terrain-bank-${water.id}-${i}-${side}`;
        const path: Prop = { id, hostId: 'terrain', kind: 'path', x, z, size: 3.2, length: distance(a, p) * 0.96, rotation: -Math.atan2(uz, ux) || 0 };
        if (!clear(path)) continue;
        props.push(path); walks.push(propFootprint(path));
        if (i % 5 === 0) {
          const bench: Prop = { id: `${id}-bench`, hostId: 'terrain', kind: 'bench', x: x - uz * 2.2 * side, z: z + ux * 2.2 * side, size: 2.6, rotation: path.rotation };
          if (clear(bench)) { props.push(bench); furniture.push(propFootprint(bench)); }
        }
      }
    }
  }
  // One central walk and adjacent bench per unoccupied lot; six local tree candidates.
  for (const parcel of city.parcels) {
    if (parcel.buildingId) continue;
    const box = bounds(parcel.polygon), x = (box.minX + box.maxX) / 2, z = (box.minZ + box.maxZ) / 2;
    const path: Prop = { id: `prop-${parcel.id}-path`, hostId: parcel.id, kind: 'path', x, z, size: 1.8, length: box.maxX - box.minX - 2, rotation: 0 };
    if (containsPolygon(parcel.polygon, propFootprint(path)) && clear(path)) { props.push(path); walks.push(propFootprint(path)); }
    const bench: Prop = { id: `prop-${parcel.id}-bench`, hostId: parcel.id, kind: 'bench', x, z: z + 2.1, size: 3.4, rotation: 0 };
    if (containsPolygon(parcel.polygon, propFootprint(bench)) && clear(bench)) { props.push(bench); furniture.push(propFootprint(bench)); }
  }
  for (const parcel of city.parcels) {
    const box = bounds(parcel.polygon), park = !parcel.buildingId;
    for (let i = 0; i < (park ? 6 : 1); i++) {
      const id = `prop-${parcel.id}-tree-${i}`, rng = random(`${city.seed}:${id}`);
      if (!park && rng() <= 0.35) continue;
      const size = park ? 6 + rng() * 4 : 4 + rng() * 2, margin = size * 0.55 + 0.1;
      const x = park ? box.minX + margin + rng() * Math.max(0, box.maxX - box.minX - margin * 2) : box.minX + 2;
      const z = park ? box.minZ + margin + rng() * Math.max(0, box.maxZ - box.minZ - margin * 2) : box.minZ + 2;
      const prop: Prop = { id, hostId: parcel.id, kind: 'tree', x, z, size, rotation: rng() * Math.PI * 2 };
      if (containsPolygon(parcel.polygon, propFootprint(prop)) && clear(prop)) props.push(prop);
    }
  }
  // Same 660 meadow candidates and edge bias. Randomness never depends on acceptance.
  if (city.roads.length || city.water.length) for (let i = 0; i < 660; i++) {
    const rng = random(`${city.seed}:meadow:${i}`), limit = city.terrain.size / 2;
    const x = (rng() * 2 - 1) * (limit - 9), z = (rng() * 2 - 1) * (limit - 9);
    if (Math.max(Math.abs(x), Math.abs(z)) <= limit * 0.78 && rng() < 0.88) continue;
    const prop: Prop = { id: `prop-terrain-meadow-${i}`, hostId: 'terrain', kind: 'tree', x, z, size: 5 + rng() * 8, rotation: rng() * Math.PI * 2 };
    if (clear(prop) && !city.parcels.some(p => polygonsOverlap(propFootprint(prop), p.polygon))) props.push(prop);
  }
  for (const road of city.roads) {
    const a = nodes.get(road.a)!, b = nodes.get(road.b)!, length = distance(a, b), ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
    const span = roadSpan(city, road), half = road.width / 2, walk = Math.min(1.7, road.width * 0.14);
    for (let d = span.start + 12, i = 0; d < span.end - 5; d += road.profile === 'boulevard' ? 30 : 43, i++) {
      const p = lerp(a, b, d / length), sign = Math.floor(d / 30) % 2 ? 1 : -1, offset = half - walk * 0.55;
      const prop: Prop = { id: `prop-${road.id}-streetlight-${i}`, hostId: road.id, kind: 'streetlight', x: p.x - uz * offset * sign, z: p.z + ux * offset * sign, size: road.profile === 'boulevard' ? 7.2 : 5.8, rotation: Math.atan2(ux * sign, uz * sign) || 0 };
      const polygon = propFootprint(prop), box = bounds(polygon), limit = city.terrain.size / 2;
      if (box.minX < -limit || box.maxX > limit || box.minZ < -limit || box.maxZ > limit) continue;
      if (city.roads.some(r => r.id !== road.id && r.level === road.level && segmentPolygonDistance(nodes.get(r.a)!, nodes.get(r.b)!, polygon) < r.width / 2 + 0.2)) continue;
      props.push(prop);
    }
  }
  city.props = props.sort((a, b) => a.id.localeCompare(b.id));
}

function generate(city: City): void {
  const oldParcels = new Map(city.parcels.map(p => [p.id, p]));
  const oldBuildings = new Map(city.buildings.map(b => [b.parcelId, b]));
  const nodes = new Map(city.nodes.map(n => [n.id, n]));
  const parcels: Parcel[] = [], buildings: Building[] = [];
  const occupiedBounds: ReturnType<typeof bounds>[] = [];
  for (const block of extractBlocks(city)) {
    const box = bounds(block.polygon);
    let left = 7, right = 7, bottom = 7, top = 7;
    for (const road of city.roads) {
      if (road.level !== 0) continue;
      const a = nodes.get(road.a)!, b = nodes.get(road.b)!, margin = road.width / 2 + SETBACK;
      if (Math.abs(a.x - box.minX) < EPS && Math.abs(b.x - box.minX) < EPS && Math.max(a.z, b.z) > box.minZ && Math.min(a.z, b.z) < box.maxZ) left = Math.max(left, margin);
      if (Math.abs(a.x - box.maxX) < EPS && Math.abs(b.x - box.maxX) < EPS && Math.max(a.z, b.z) > box.minZ && Math.min(a.z, b.z) < box.maxZ) right = Math.max(right, margin);
      if (Math.abs(a.z - box.minZ) < EPS && Math.abs(b.z - box.minZ) < EPS && Math.max(a.x, b.x) > box.minX && Math.min(a.x, b.x) < box.maxX) bottom = Math.max(bottom, margin);
      if (Math.abs(a.z - box.maxZ) < EPS && Math.abs(b.z - box.maxZ) < EPS && Math.max(a.x, b.x) > box.minX && Math.min(a.x, b.x) < box.maxX) top = Math.max(top, margin);
    }
    const width = box.maxX - box.minX - left - right, depth = box.maxZ - box.minZ - bottom - top;
    if (width < 16 || depth < 16) continue;
    const nx = Math.max(1, Math.round(width / 28)), nz = Math.max(1, Math.round(depth / 28));
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const polygon = rectangle(rounded(box.minX + left + ix * width / nx + 0.5), rounded(box.minZ + bottom + iz * depth / nz + 0.5), rounded(box.minX + left + (ix + 1) * width / nx - 0.5), rounded(box.minZ + bottom + (iz + 1) * depth / nz - 0.5));
      const cell = bounds(polygon);
      if (!containsPolygon(block.polygon, polygon) || !clearOfInfrastructure(city, polygon, nodes) || occupiedBounds.some(box => boundsOverlap(box, cell))) continue;
      const id = geometryId('parcel', polygon, block.id), rng = random(`${city.seed}:${id}`);
      const x = (cell.minX + cell.maxX) / 2, z = (cell.minZ + cell.maxZ) / 2;
      const centrality = Math.exp(-Math.hypot(x, z) / 230), zoneRoll = rng();
      const defaultZone: Parcel['zone'] = zoneRoll < 0.055 ? 'park' : centrality > 0.4 && zoneRoll > 0.5 ? 'commercial' : zoneRoll > 0.63 ? 'mixed' : 'residential';
      const parcel: Parcel = { id, blockId: block.id, polygon, zone: oldParcels.get(id)?.zone ?? defaultZone };
      const old = oldBuildings.get(id), occupied = rng() < city.settings.density;
      if (parcel.zone !== 'park' && (occupied || old?.edited)) {
        let building: Building;
        if (old?.edited) building = clone(old);
        else {
          const setbackX = 2.5 + rng() * 1.5, setbackZ = 2.5 + rng() * 1.5;
          const floors = Math.max(1, Math.round((parcel.zone === 'commercial' ? 4 + centrality * 18 + rng() * 5 : parcel.zone === 'mixed' ? 3 + centrality * 11 + rng() * 4 : 1 + centrality * 5 + rng() * 3) * (0.6 + city.settings.density * 0.6)));
          building = { id: `building-${id}`, parcelId: id, x, z, width: rounded(cell.maxX - cell.minX - setbackX * 2), depth: rounded(cell.maxZ - cell.minZ - setbackZ * 2), floors, palette: Math.floor(rng() * 8), roof: floors > 8 ? (rng() > 0.5 ? 'terrace' : 'flat') : (['flat', 'gable', 'terrace'] as const)[Math.floor(rng() * 3)], edited: false };
        }
        parcel.buildingId = building.id; buildings.push(building);
      }
      parcels.push(parcel); occupiedBounds.push(cell);
    }
  }
  const surviving = new Set(buildings.map(b => b.id));
  for (const building of city.buildings) if (building.edited && !surviving.has(building.id)) fail(`Edited building ${building.id} would lose its host parcel. Delete its override first.`);
  city.parcels = parcels; city.buildings = buildings;
  generateProps(city);
}

function validateShape(value: unknown): asserts value is City {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const number = (v: unknown, min: number, max: number, integer = false) => finite(v) && v >= min && v <= max && (!integer || Number.isSafeInteger(v));
  const string = (v: unknown, max = 160) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const array = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
  const point = (v: unknown) => object(v) && number(v.x, -5000, 5000) && number(v.z, -5000, 5000);
  const assert = (condition: unknown, message: string) => { if (!condition) fail(`Invalid city: ${message}`); };
  assert(object(value), 'expected an object.');
  const c = value as Record<string, any>;
  assert(c.version === 1 && string(c.name, 120) && number(c.seed, 0, 4294967295, true) && number(c.nextId, 1, Number.MAX_SAFE_INTEGER - 100000, true), 'version, name, seed or nextId.');
  assert(object(c.terrain), 'terrain.');
  const t = c.terrain;
  assert(number(t.size, 60, 4096) && number(t.resolution, 3, 129, true) && array(t.heights, 16641) && t.heights.length === t.resolution ** 2 && Array.from(t.heights).every((h: unknown) => number(h, -500, 1000)), 'terrain dimensions or heights.');
  assert(array(c.nodes, 10000) && array(c.roads, 20000) && array(c.water, 32) && array(c.parcels, 20000) && array(c.buildings, 20000) && array(c.props, 200000), 'entity arrays or size limits.');
  const ids = new Set<string>();
  for (const entities of [c.nodes, c.roads, c.water, c.parcels, c.buildings, c.props]) for (const entity of entities) {
    assert(object(entity) && string(entity.id, entities === c.props ? 320 : 160), 'entity ID.');
    assert(!ids.has(entity.id), `duplicate ID ${entity.id}.`); ids.add(entity.id);
  }
  for (const n of c.nodes) assert(point(n) && number(n.y, -500, 1100) && number(n.level, 0, 8, true), `node ${n.id}.`);
  for (const r of c.roads) assert(string(r.a) && string(r.b) && r.a !== r.b && number(r.width, 4, 40) && ['local', 'boulevard'].includes(r.profile) && number(r.level, 0, 8, true) && number(r.clearance, 5, 30), `road ${r.id}.`);
  for (const w of c.water) assert(array(w.points, 256) && w.points.length >= 2 && w.points.every(point) && number(w.width, 4, t.size / 2) && number(w.level, -500, 1000), `water ${w.id}.`);
  for (const p of c.parcels) assert(string(p.blockId) && array(p.polygon, 256) && p.polygon.length >= 3 && p.polygon.every(point) && ['residential', 'commercial', 'mixed', 'park'].includes(p.zone) && (p.buildingId === undefined || string(p.buildingId)), `parcel ${p.id}.`);
  for (const b of c.buildings) assert(string(b.parcelId) && point(b) && number(b.width, 3, 1000) && number(b.depth, 3, 1000) && number(b.floors, 1, 80, true) && number(b.palette, 0, 31, true) && ['flat', 'gable', 'terrace'].includes(b.roof) && typeof b.edited === 'boolean', `building ${b.id}.`);
  for (const p of c.props) assert(string(p.hostId) && point(p) && ['tree', 'bench', 'path', 'streetlight'].includes(p.kind) && number(p.size, 0.1, 100) && number(p.rotation, -Math.PI * 2, Math.PI * 2) && (p.kind === 'path' ? number(p.length, 0.1, t.size * 2) : p.length === undefined), `prop ${p.id}.`);
  assert(object(c.settings) && number(c.settings.density, 0, 1) && number(c.settings.traffic, 0, 1) && number(c.settings.day, 0, 24), 'settings (density/traffic 0..1, day 0..24).');
  assert(array(c.views, 100), 'views.');
  for (const v of c.views) assert(object(v) && string(v.name, 120) && array(v.position, 3) && v.position.length === 3 && Array.from(v.position).every((n: unknown) => number(n, -100000, 100000)) && array(v.target, 3) && v.target.length === 3 && Array.from(v.target).every((n: unknown) => number(n, -100000, 100000)), 'view.');
}

function validateGeometry(city: City, derived: boolean): void {
  const nodes = new Map(city.nodes.map(n => [n.id, n]));
  const alignments = new Map<string, Alignment>(), adjacent = new Map<string, Road[]>();
  for (const n of city.nodes) checkPoint(city, n);
  for (const w of city.water) for (let i = 0; i < w.points.length; i++) {
    checkPoint(city, w.points[i]);
    if (i && distance(w.points[i], w.points[i - 1]) < MIN_EDGE) fail('Water segments must be at least 2 metres long.');
  }
  for (const road of city.roads) {
    if (road.width < 8) fail('Two-way roads require at least 8 metres for two vehicle lanes and sidewalks.');
    const a = nodes.get(road.a), b = nodes.get(road.b);
    if (!a || !b || a.level !== road.level || b.level !== road.level) fail(`Road ${road.id} has incompatible endpoints.`);
    alignments.set(road.id, getAlignment(city, road));
    for (const id of [road.a, road.b]) { if (!adjacent.has(id)) adjacent.set(id, []); adjacent.get(id)!.push(road); }
  }
  for (const [id, roads] of adjacent) {
    const node = nodes.get(id)!;
    for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
      const a = nodes.get(roads[i].a === id ? roads[i].b : roads[i].a)!, b = nodes.get(roads[j].a === id ? roads[j].b : roads[j].a)!;
      const u = subtract(a, node), v = subtract(b, node);
      const angle = Math.acos(clamp((u.x * v.x + u.z * v.z) / (distance(a, node) * distance(b, node)), -1, 1)) * 180 / Math.PI;
      if (angle < 25 - EPS) fail(`Junction ${id} has a corner below 25 degrees.`);
    }
  }
  for (let i = 0; i < city.roads.length; i++) for (let j = i + 1; j < city.roads.length; j++) {
    const r = city.roads[i], s = city.roads[j], a = nodes.get(r.a)!, b = nodes.get(r.b)!, c = nodes.get(s.a)!, d = nodes.get(s.b)!;
    if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPS || Math.max(a.z, b.z) < Math.min(c.z, d.z) - EPS || Math.max(c.z, d.z) < Math.min(a.z, b.z) - EPS) continue;
    const hit = intersection(a, b, c, d);
    if (!hit) continue;
    const ra = alignments.get(r.id)!, sa = alignments.get(s.id)!;
    const gap = Math.abs(alignmentHeight(ra, hit.t) - alignmentHeight(sa, hit.u));
    const shared = [r.a, r.b].some(id => id === s.a || id === s.b);
    if (hit.overlap && r.level === s.level) fail('Collinear overlapping or duplicate roads are not supported.');
    if (!hit.overlap && shared) continue;
    if (r.level === s.level && gap <= 1) fail('Same-level road crossings must share an intersection node.');
    if (gap < VERTICAL_CLEARANCE - EPS) fail('Grade-separated crossings need at least 5 metres of vertical clearance.');
    if (hit.overlap) {
      for (const p of [...ra.points, ...sa.points]) {
        const rp = projection(p, a, b), sp = projection(p, c, d);
        if (rp.distance < EPS && sp.distance < EPS && Math.abs(alignmentHeight(ra, rp.t) - alignmentHeight(sa, sp.t)) < VERTICAL_CLEARANCE - EPS) fail('Overlapping elevated roads have insufficient vertical clearance.');
      }
    }
  }
  if (!derived) return;
  const blocks = new Map(extractBlocks(city).map(b => [b.id, b]));
  const parcels = new Map(city.parcels.map(p => [p.id, p]));
  const buildings = new Map(city.buildings.map(b => [b.id, b]));
  for (const parcel of city.parcels) {
    parcel.polygon.forEach(p => checkPoint(city, p));
    const block = blocks.get(parcel.blockId);
    if (!simplePolygon(parcel.polygon) || !block || !containsPolygon(block.polygon, parcel.polygon) || !clearOfInfrastructure(city, parcel.polygon, nodes)) fail(`Parcel ${parcel.id} is outside its block or overlaps roads/water.`);
    if (parcel.buildingId && (buildings.get(parcel.buildingId)?.parcelId !== parcel.id || parcel.zone === 'park')) fail(`Parcel ${parcel.id} has an invalid building reference.`);
  }
  const parcelBounds = city.parcels.map(p => bounds(p.polygon));
  for (let i = 0; i < city.parcels.length; i++) for (let j = i + 1; j < city.parcels.length; j++) if (boundsOverlap(parcelBounds[i], parcelBounds[j]) && polygonsOverlap(city.parcels[i].polygon, city.parcels[j].polygon)) fail('Parcels overlap.');
  for (const building of city.buildings) {
    const parcel = parcels.get(building.parcelId), polygon = footprint(building);
    if (!parcel || parcel.buildingId !== building.id || parcel.zone === 'park' || !containsPolygon(parcel.polygon, polygon, SETBACK)) fail(`Building ${building.id} does not fit its host parcel with 2 metre setbacks.`);
  }
  // Each building is contained in its own disjoint, infrastructure-free parcel.
  const roads = new Map(city.roads.map(r => [r.id, r]));
  for (const prop of city.props) {
    propFootprint(prop).forEach(p => checkPoint(city, p));
    const parcel = parcels.get(prop.hostId), road = roads.get(prop.hostId);
    if (prop.kind === 'streetlight') {
      if (!road) fail(`Prop ${prop.id} has an invalid road host.`);
      const r = road!, a = nodes.get(r.a)!, b = nodes.get(r.b)!;
      const hit = projection(prop, a, b), walk = Math.min(1.7, r.width * 0.14), span = roadSpan(city, r), d = hit.t * distance(a, b);
      if (hit.distance < r.width / 2 - walk + 0.12 - EPS || hit.distance > r.width / 2 - 0.12 + EPS || d < span.start || d > span.end) fail(`Prop ${prop.id} is not on its host sidewalk.`);
    } else if (prop.hostId !== 'terrain' && (!parcel || !containsPolygon(parcel.polygon, propFootprint(prop)))) fail(`Prop ${prop.id} has an invalid parcel host or footprint.`);
  }
  // Placement clearance is enforced on generation, not revalidated against stale
  // derived props during nonstructural History commits. Imports still check shape,
  // bounds, host references and sidewalk/parcel attachment; rebuild replaces props.
}

/** Validate the complete import before returning a detached snapshot. Never repairs invalid data. */
export function validateCity(value: unknown): City {
  validateShape(value); validateGeometry(value, true);
  return clone(value);
}

export function rebuildCity(city: City): City {
  validateShape(city);
  const result = clone(city);
  validateGeometry(result, false); generate(result); validateGeometry(result, true);
  return result;
}

function splitEdge(city: City, road: Road, cuts: { t: number; node: Node }[]): void {
  const a = city.nodes.find(n => n.id === road.a)!, b = city.nodes.find(n => n.id === road.b)!;
  const ordered = [{ t: 0, node: a }, ...cuts.filter(c => c.t > EPS && c.t < 1 - EPS), { t: 1, node: b }].sort((x, y) => x.t - y.t);
  const unique = ordered.filter((cut, i) => !i || cut.node.id !== ordered[i - 1].node.id);
  if (unique.length === 2) return;
  const parts: Road[] = [];
  for (let i = 1; i < unique.length; i++) parts.push({ ...road, id: i === 1 ? road.id : nextId(city, 'road'), a: unique[i - 1].node.id, b: unique[i].node.id });
  const index = city.roads.findIndex(r => r.id === road.id);
  city.roads.splice(index, 1, ...parts);
}

function resolveEndpoint(city: City, p: Point, level: number, exclude?: string): Node {
  checkPoint(city, p);
  const y = heightAt(city, p.x, p.z) + level * 12;
  const nearby = city.nodes.filter(n => n.id !== exclude && n.level === level && distance(n, p) <= SNAP && Math.abs(n.y - y) <= 1).sort((a, b) => distance(a, p) - distance(b, p) || a.id.localeCompare(b.id));
  if (nearby.length) return nearby[0];
  let best: { road: Road; t: number; point: Point; y: number; distance: number } | undefined;
  for (const road of city.roads) {
    if (road.level !== level) continue;
    const a = city.nodes.find(n => n.id === road.a)!, b = city.nodes.find(n => n.id === road.b)!;
    const projected = projection(p, a, b);
    if (projected.t <= EPS || projected.t >= 1 - EPS || projected.distance > SNAP) continue;
    const roadY = alignmentHeight(getAlignment(city, road), projected.t);
    if (Math.abs(roadY - (heightAt(city, projected.point.x, projected.point.z) + level * 12)) > 1) continue;
    if (!best || projected.distance < best.distance) best = { ...projected, road, y: roadY };
  }
  const node: Node = { id: nextId(city, 'node'), ...(best?.point ?? p), y: best?.y ?? y, level };
  city.nodes.push(node);
  if (best) splitEdge(city, best.road, [{ t: best.t, node }]);
  return node;
}

function integrateRoad(city: City, road: Road): void {
  const a = city.nodes.find(n => n.id === road.a)!, b = city.nodes.find(n => n.id === road.b)!;
  const alignment = getAlignment(city, road), newCuts: { t: number; node: Node }[] = [];
  const oldCuts = new Map<Road, { t: number; node: Node }[]>();
  for (const existing of city.roads) {
    const c = city.nodes.find(n => n.id === existing.a)!, d = city.nodes.find(n => n.id === existing.b)!;
    const hit = intersection(a, b, c, d);
    if (!hit) continue;
    const existingAlignment = getAlignment(city, existing);
    const y = alignmentHeight(alignment, hit.t), oldY = alignmentHeight(existingAlignment, hit.u), gap = Math.abs(y - oldY);
    if (hit.overlap && road.level === existing.level) fail('Collinear overlapping or duplicate roads are not supported.');
    if (road.level !== existing.level || gap > 1) {
      if (gap < VERTICAL_CLEARANCE - EPS) fail('Crossing roads have insufficient vertical clearance.');
      continue;
    }
    const endpoint = hit.t < EPS ? a : hit.t > 1 - EPS ? b : hit.u < EPS ? c : hit.u > 1 - EPS ? d : undefined;
    let node = endpoint ?? city.nodes.find(n => n.level === road.level && distance(n, hit.point) < EPS && Math.abs(n.y - y) <= 1);
    if (!node) { node = { id: nextId(city, 'node'), ...hit.point, y: Math.max(y, oldY), level: road.level }; city.nodes.push(node); }
    if (hit.t < EPS && a.id !== node.id || hit.t > 1 - EPS && b.id !== node.id || hit.u < EPS && c.id !== node.id || hit.u > 1 - EPS && d.id !== node.id) fail('Coincident road endpoints must use the same node.');
    newCuts.push({ t: hit.t, node });
    if (!oldCuts.has(existing)) oldCuts.set(existing, []);
    oldCuts.get(existing)!.push({ t: hit.u, node });
  }
  for (const [existing, cuts] of oldCuts) splitEdge(city, existing, cuts);
  city.roads.push(road); splitEdge(city, road, newCuts);
}

function cleanNodes(city: City): void {
  const used = new Set(city.roads.flatMap(r => [r.a, r.b]));
  city.nodes = city.nodes.filter(n => used.has(n.id));
}

/** maxGrade optionally imposes a stricter acceptance limit; it does not change the grading algorithm. */
export function addRoad(city: City, points: Point[], options: { profile: 'local' | 'boulevard'; width: number; level: number; clearance: number; maxGrade?: number }): City {
  validateShape(city);
  if (!Array.isArray(points) || points.length < 2 || points.length > 256) fail('A road needs 2 to 256 points.');
  if (!options || !['local', 'boulevard'].includes(options.profile) || !finite(options.width) || options.width < 4 || options.width > 40 || !Number.isInteger(options.level) || options.level < 0 || options.level > 8 || !finite(options.clearance) || options.clearance < 5 || options.clearance > 30) fail('Invalid road options.');
  if (options.maxGrade !== undefined && (!finite(options.maxGrade) || options.maxGrade <= 0 || options.maxGrade > MAX_GRADE)) fail('maxGrade must be greater than zero and no more than 0.12.');
  if (options.width < 8) fail('Two-way roads require at least 8 metres for two vehicle lanes and sidewalks.');
  points.forEach(p => checkPoint(city, p));
  const result = clone(city), added = new Set<string>();
  let a = resolveEndpoint(result, points[0], options.level);
  for (let i = 1; i < points.length; i++) {
    const b = resolveEndpoint(result, points[i], options.level);
    if (a.id === b.id) fail('Road points collapse after 8 metre snapping.');
    const road: Road = { id: nextId(result, 'road'), a: a.id, b: b.id, profile: options.profile, width: options.width, level: options.level, clearance: options.clearance };
    const before = new Set(result.roads.map(r => r.id));
    integrateRoad(result, road);
    for (const r of result.roads) if (!before.has(r.id)) added.add(r.id);
    a = b;
  }
  cleanNodes(result);
  if (options.maxGrade !== undefined) for (const road of result.roads) if (added.has(road.id) && getAlignment(result, road).maxGrade > options.maxGrade + EPS) fail('Road exceeds the requested maximum grade.');
  return rebuildCity(result);
}

export function moveNode(city: City, nodeId: string, point: Point): City {
  validateShape(city); checkPoint(city, point);
  const result = clone(city), node = result.nodes.find(n => n.id === nodeId);
  if (!node) return fail(`Unknown node ${nodeId}.`);
  const incident = result.roads.filter(r => r.a === nodeId || r.b === nodeId);
  result.roads = result.roads.filter(r => r.a !== nodeId && r.b !== nodeId);
  const replacement = resolveEndpoint(result, point, node.level, node.id);
  const isNew = !city.nodes.some(n => n.id === replacement.id);
  if (isNew) {
    result.nodes = result.nodes.filter(n => n.id !== replacement.id);
    for (const road of result.roads) { if (road.a === replacement.id) road.a = nodeId; if (road.b === replacement.id) road.b = nodeId; }
    Object.assign(node, { x: replacement.x, z: replacement.z, y: replacement.y });
  }
  const target = isNew ? node : replacement;
  for (const road of incident) integrateRoad(result, { ...road, a: road.a === nodeId ? target.id : road.a, b: road.b === nodeId ? target.id : road.b });
  cleanNodes(result);
  return rebuildCity(result);
}

export function deleteRoad(city: City, id: string): City {
  validateShape(city);
  if (!city.roads.some(r => r.id === id)) fail(`Unknown road ${id}.`);
  const result = clone(city);
  result.roads = result.roads.filter(r => r.id !== id); cleanNodes(result);
  return rebuildCity(result);
}

export function splitRoad(city: City, id: string, point: Point): City {
  validateShape(city); checkPoint(city, point);
  const result = clone(city), road = result.roads.find(r => r.id === id);
  if (!road) return fail(`Unknown road ${id}.`);
  const a = result.nodes.find(n => n.id === road.a)!, b = result.nodes.find(n => n.id === road.b)!;
  const p = projection(point, a, b);
  if (p.distance > SNAP || distance(p.point, a) < MIN_EDGE || distance(p.point, b) < MIN_EDGE) fail('Split must be within 8 metres of the road and 2 metres from its ends.');
  const node: Node = { id: nextId(result, 'node'), ...p.point, y: alignmentHeight(getAlignment(result, road), p.t), level: road.level };
  result.nodes.push(node); splitEdge(result, road, [{ t: p.t, node }]);
  return rebuildCity(result);
}

export function sculpt(city: City, center: Point, radius: number, strength: number, mode: 'raise' | 'lower' | 'smooth' | 'flatten', flattenHeight?: number): City {
  validateShape(city); checkPoint(city, center);
  if (!finite(radius) || radius <= 0 || radius > city.terrain.size || !finite(strength) || Math.abs(strength) > 100 || !['raise', 'lower', 'smooth', 'flatten'].includes(mode) || (flattenHeight !== undefined && !finite(flattenHeight))) fail('Invalid terrain brush.');
  const result = clone(city), { size, resolution: n } = result.terrain, before = city.terrain.heights;
  const target = flattenHeight ?? heightAt(city, center.x, center.z);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const d = distance(center, { x: (ix / (n - 1) - 0.5) * size, z: (iz / (n - 1) - 0.5) * size });
    if (d >= radius) continue;
    const index = iz * n + ix, weight = (1 - (d / radius) ** 2) ** 2, amount = Math.abs(strength);
    if (mode === 'raise' || mode === 'lower') result.terrain.heights[index] = before[index] + (mode === 'raise' ? 1 : -1) * amount * weight;
    else {
      let average = target;
      if (mode === 'smooth') {
        let sum = 0, count = 0;
        for (let z = Math.max(0, iz - 1); z <= Math.min(n - 1, iz + 1); z++) for (let x = Math.max(0, ix - 1); x <= Math.min(n - 1, ix + 1); x++) { sum += before[z * n + x]; count++; }
        average = sum / count;
      }
      result.terrain.heights[index] = before[index] + (average - before[index]) * Math.min(1, amount) * weight;
    }
  }
  for (const node of result.nodes) node.y += heightAt(result, node.x, node.z) - heightAt(city, node.x, node.z);
  return rebuildCity(result);
}

/** Replaces the river centerline. Carves the new bed; old terrain edits are not restored. */
export function setRiver(city: City, points: Point[], width: number, level: number): City {
  validateShape(city);
  if (!Array.isArray(points) || points.length < 2 || points.length > 256 || !finite(width) || width < 4 || width > city.terrain.size / 2 || !finite(level) || level < -498 || level > 998) fail('Invalid river.');
  points.forEach(p => checkPoint(city, p));
  const result = clone(city);
  result.water = [{ id: city.water[0]?.id ?? nextId(result, 'water'), points: clone(points), width, level }];
  const { size, resolution: n } = result.terrain;
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const p = { x: (ix / (n - 1) - 0.5) * size, z: (iz / (n - 1) - 0.5) * size };
    const d = Math.min(...points.slice(1).map((b, i) => projection(p, points[i], b).distance));
    const bed = level - 2 + Math.max(0, d - width / 2) * 0.2;
    if (d < width / 2 + 30) result.terrain.heights[iz * n + ix] = Math.min(result.terrain.heights[iz * n + ix], bed);
  }
  for (const node of result.nodes) node.y += heightAt(result, node.x, node.z) - heightAt(city, node.x, node.z);
  return rebuildCity(result);
}

export function quantities(city: City): { area: number; roadLength: number; parcels: number; buildings: number; floorArea: number; segments: number } {
  const nodes = new Map(city.nodes.map(n => [n.id, n]));
  return { area: city.terrain.size ** 2, roadLength: city.roads.reduce((sum, r) => sum + distance(nodes.get(r.a)!, nodes.get(r.b)!), 0), parcels: city.parcels.length, buildings: city.buildings.length, floorArea: city.buildings.reduce((sum, b) => sum + b.width * b.depth * b.floors, 0), segments: city.roads.length };
}

export function createCity(example: 'riverfront' | 'hillside' | 'garden' | 'empty', seed = 42): City {
  if (!['riverfront', 'hillside', 'garden', 'empty'].includes(example) || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) fail('Unknown example or invalid seed.');
  const city: City = { version: 1, name: { riverfront: 'Riverfront', hillside: 'Hillside', garden: 'Garden City', empty: 'Untitled City' }[example], seed, nextId: 1, terrain: { size: 960, resolution: 33, heights: Array(33 * 33).fill(1) }, water: [], nodes: [], roads: [], parcels: [], buildings: [], props: [], settings: { density: example === 'garden' ? 0.78 : 0.94, traffic: 0.55, day: 14 }, views: [] };
  if (example === 'empty') return city;
  for (let iz = 0; iz < 33; iz++) for (let ix = 0; ix < 33; ix++) {
    const x = ix * 30 - 480, z = iz * 30 - 480;
    if (example === 'riverfront') city.terrain.heights[iz * 33 + ix] = Math.abs(z) <= 30 ? -3 : 1;
    if (example === 'hillside') city.terrain.heights[iz * 33 + ix] = 18 + 7 * Math.sin(x / 160) * Math.cos(z / 220) + 5 * Math.sin(z / 190) + x * 0.025;
    if (example === 'garden') city.terrain.heights[iz * 33 + ix] = 2 + 1.5 * Math.sin(x / 200) * Math.sin(z / 180);
  }
  if (example === 'riverfront') city.water.push({ id: nextId(city, 'water'), points: [{ x: -480, z: 0 }, { x: 480, z: 0 }], width: 80, level: -1 });
  const xs = example === 'riverfront' ? [-360, -270, -180, -90, 0, 90, 180, 270, 360] : [-300, -200, -100, 0, 100, 200, 300];
  const zs = example === 'riverfront' ? [-360, -270, -180, -90, 90, 180, 270, 360] : [-300, -200, -100, 0, 100, 200, 300];
  const grid = zs.map(z => xs.map(x => {
    const node: Node = { id: nextId(city, 'node'), x, z, y: heightAt(city, x, z), level: 0 };
    city.nodes.push(node); return node;
  }));
  const edge = (a: Node, b: Node, boulevard: boolean) => city.roads.push({ id: nextId(city, 'road'), a: a.id, b: b.id, width: boulevard ? 18 : 10, profile: boulevard ? 'boulevard' : 'local', level: 0, clearance: 5 });
  for (let iz = 0; iz < zs.length; iz++) for (let ix = 0; ix < xs.length; ix++) {
    if (ix + 1 < xs.length) edge(grid[iz][ix], grid[iz][ix + 1], example === 'riverfront' ? Math.abs(zs[iz]) === 90 : zs[iz] === 0);
    if (iz + 1 < zs.length && !(example === 'riverfront' && zs[iz] === -90 && Math.abs(xs[ix]) !== 180)) edge(grid[iz][ix], grid[iz + 1][ix], xs[ix] === 0 || example === 'riverfront' && Math.abs(xs[ix]) === 180);
  }
  let result = rebuildCity(city);
  if (example === 'hillside') {
    result.settings.density = 0.76;
    for (const parcel of result.parcels) parcel.zone = hash(parcel.blockId + seed) % 11 === 0 ? 'park' : 'residential';
    result = rebuildCity(result);
  }
  if (example === 'garden') {
    for (const parcel of result.parcels) if (hash(parcel.blockId + seed) % 7 === 0 || hash(parcel.id + seed) % 9 === 0) parcel.zone = 'park';
    result = rebuildCity(result);
  }
  return result;
}

export class History {
  current: City;
  undoStack: City[] = [];
  redoStack: City[] = [];
  constructor(initial: City) { this.current = validateCity(initial); }
  commit(city: City): void {
    const snapshot = validateCity(city);
    this.undoStack.push(clone(this.current)); this.current = snapshot; this.redoStack = [];
  }
  undo(): City {
    if (this.undoStack.length) { this.redoStack.push(clone(this.current)); this.current = clone(this.undoStack.pop()!); }
    return clone(this.current);
  }
  redo(): City {
    if (this.redoStack.length) { this.undoStack.push(clone(this.current)); this.current = clone(this.redoStack.pop()!); }
    return clone(this.current);
  }
}
