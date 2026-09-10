import { getAlignment, random, type City } from './model.ts';

type Point = { x: number; y: number; z: number };
export type Lane = { id: string; roadId: string; from: string; to: string; points: Point[]; length: number; next: string[] };
export type Connector = { id: string; from: string; to: string; nodeId: string; points: Point[]; length: number };
export type LaneGraph = { lanes: Lane[]; connectors: Connector[] };
/** Position is the car centre; distance measures the current lane OR connector.
 * While on a connector, laneId/routeIndex still identify its incoming lane.
 * Heading is radians, atan2(dx, dz), with zero pointing along +z. */
export type Vehicle = {
  id: string; laneId: string; route: string[]; routeIndex: number; distance: number;
  speed: number; color: number; position: Point; heading: number; waiting: boolean; connectorId?: string;
};

const STEP = 1 / 60;
const MAX_SPEED = 11, ACCELERATION = 2, BRAKING = 4;
const CAR_LENGTH = 4, GAP = CAR_LENGTH + 2;
const EPS = 1e-9;
const colors = [0xe6b566, 0xd66c57, 0x65a6ad, 0xe5e6da, 0x556b85, 0x9275a3];
const separation = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const stopAt = (lane: Lane) => Math.max(0, lane.length - CAR_LENGTH / 2);
const connectorId = (from: string, to: string) => `connector:${JSON.stringify([from, to])}`;

function lengths(points: Point[]): number[] {
  const result = [0];
  for (let i = 1; i < points.length; i++) result.push(result[i - 1] + separation(points[i - 1], points[i]));
  return result;
}

function sample(points: Point[], distances: number[], distance: number): { position: Point; heading: number } {
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const middle = (lo + hi) >>> 1;
    if (distances[middle] <= distance) lo = middle;
    else hi = middle;
  }
  const a = points[lo], b = points[hi];
  const t = Math.max(0, Math.min(1, (distance - distances[lo]) / (distances[hi] - distances[lo])));
  return {
    position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
    heading: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

/** Supported layout: one lane in each direction for both profiles, offset by
 * width * .19 to the driver's right. Only incident roads affect junction cuts;
 * geometric crossings, sidewalks and different levels never imply connections.
 * Very short roads retain at least 10% of their centreline instead of inverting. */
export function buildLaneGraph(city: City): LaneGraph {
  const nodes = new Map(city.nodes.map(node => [node.id, node]));
  const incident = new Map<string, { degree: number; margin: number }>();
  const roads = [...city.roads].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const road of roads) for (const id of [road.a, road.b]) {
    if (nodes.get(id)?.level !== road.level) throw new Error(`Road ${road.id} has incompatible traffic endpoints.`);
    const entry = incident.get(id) ?? { degree: 0, margin: 0 };
    entry.degree++;
    entry.margin = Math.max(entry.margin, road.width / 2 + 1);
    incident.set(id, entry);
  }
  const lanes: Lane[] = [], connectors: Connector[] = [];
  const outgoing = new Map<string, Lane[]>();
  for (const road of roads) {
    const a = nodes.get(road.a)!, b = nodes.get(road.b)!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
    const alignment = getAlignment(city, road).points;
    const horizontal = alignment.map(p => (p.x - a.x) * ux + (p.z - a.z) * uz);
    const start = incident.get(a.id)!, end = incident.get(b.id)!;
    const cutA = start.degree > 1 ? Math.min(start.margin, length * 0.45) : 0;
    const cutB = end.degree > 1 ? Math.min(end.margin, length * 0.45) : 0;
    const centre = [
      sample(alignment, horizontal, cutA).position,
      ...alignment.filter((_, i) => horizontal[i] > cutA + EPS && horizontal[i] < length - cutB - EPS),
      sample(alignment, horizontal, length - cutB).position,
    ];
    for (const forward of [true, false]) {
      const offset = road.width * 0.19 * (forward ? 1 : -1);
      const points = (forward ? centre : [...centre].reverse()).map(p => ({ x: p.x - uz * offset, y: p.y, z: p.z + ux * offset }));
      const lane: Lane = {
        id: `${road.id}:${forward ? 'ab' : 'ba'}`, roadId: road.id,
        from: forward ? a.id : b.id, to: forward ? b.id : a.id,
        points, length: lengths(points).at(-1)!, next: [],
      };
      lanes.push(lane);
      if (!outgoing.has(lane.from)) outgoing.set(lane.from, []);
      outgoing.get(lane.from)!.push(lane);
    }
  }
  for (const lane of lanes) for (const next of outgoing.get(lane.to) ?? []) {
    if (next.to === lane.from && incident.get(lane.to)!.degree !== 1) continue;
    const node = nodes.get(lane.to)!;
    const a = lane.points.at(-1)!, b = next.points[0];
    const before = lane.points[0], after = next.points.at(-1)!;
    const inLength = Math.hypot(a.x - before.x, a.z - before.z);
    const outLength = Math.hypot(after.x - b.x, after.z - b.z);
    // Endpoint tangents also make a continuous, round turnaround at a dead end.
    const reachA = Math.max(3, Math.hypot(a.x - node.x, a.z - node.z));
    const reachB = Math.max(3, Math.hypot(b.x - node.x, b.z - node.z));
    const c = { x: a.x + (a.x - before.x) / inLength * reachA, y: node.y, z: a.z + (a.z - before.z) / inLength * reachA };
    const d = { x: b.x - (after.x - b.x) / outLength * reachB, y: node.y, z: b.z - (after.z - b.z) / outLength * reachB };
    const count = Math.max(12, Math.ceil((separation(a, c) + separation(c, d) + separation(d, b)) * 2));
    const points: Point[] = [{ ...a }];
    for (let i = 1; i < count; i++) {
      const t = i / count, s = 1 - t;
      points.push({
        x: s ** 3 * a.x + 3 * s * s * t * c.x + 3 * s * t * t * d.x + t ** 3 * b.x,
        y: s ** 3 * a.y + 3 * s * s * t * c.y + 3 * s * t * t * d.y + t ** 3 * b.y,
        z: s ** 3 * a.z + 3 * s * s * t * c.z + 3 * s * t * t * d.z + t ** 3 * b.z,
      });
    }
    points.push({ ...b });
    lane.next.push(next.id);
    connectors.push({ id: connectorId(lane.id, next.id), from: lane.id, to: next.id, nodeId: lane.to, points, length: lengths(points).at(-1)! });
  }
  return { lanes, connectors };
}

type Reservation = { vehicleId: string; connector: Connector; clearance?: number };

/** Fixed 60 Hz, conservative stop-and-reserve traffic (even on green).
 * All connectors at a node share one lock, retained until the car has travelled
 * 6m beyond its connector. Short links can retain locks at multiple nodes.
 * Signals: NS 12s, all-red 2s, EW 12s, all-red 2s; degree <= 2 yields without lights.
 * reset() repeats the seed/count; excluded counts requested cars without safe
 * spawn space (lanes shorter than a car are traversable but not spawn locations).
 * updateCity() discards ALL old cars/routes, resets time/RNG, and respawns the
 * requested count. removed reports the old active count, not a cumulative total.
 * Call updateCity after structural edits; mutating City alone does not edit traffic. */
export class Traffic {
  graph: LaneGraph;
  vehicles: Vehicle[] = [];
  time = 0;
  removed = 0;
  excluded = 0;
  private lanes = new Map<string, Lane>();
  private connectors = new Map<string, Connector>();
  private distances = new Map<string, number[]>();
  private outgoing = new Map<string, string[]>();
  private reservations = new Map<string, Reservation>();
  private waitingSince = new Map<string, number>();
  private rng: () => number;
  private requested = 0;
  private nextId = 0;
  private accumulator = 0;

  constructor(private city: City, count = Math.round(city.settings.traffic * 180)) {
    this.graph = buildLaneGraph(city);
    this.rng = random(city.seed);
    this.indexGraph();
    this.reset(count);
  }

  private indexGraph(): void {
    this.lanes = new Map(this.graph.lanes.map(lane => [lane.id, lane]));
    this.connectors = new Map(this.graph.connectors.map(connector => [connector.id, connector]));
    this.distances.clear();
    this.outgoing.clear();
    for (const section of [...this.graph.lanes, ...this.graph.connectors]) this.distances.set(section.id, lengths(section.points));
    for (const lane of this.graph.lanes) {
      if (!this.outgoing.has(lane.from)) this.outgoing.set(lane.from, []);
      this.outgoing.get(lane.from)!.push(lane.id);
    }
  }

  // BFS is on directed lanes, not just nodes: every returned turn is legal.
  // Without a target, choose a seeded reachable destination, then its BFS path.
  private search(starts: string[], target?: string): string[] {
    const parents = new Map<string, string | undefined>(starts.map(id => [id, undefined]));
    const queue = [...starts], destinations = new Map<string, string>();
    let last: string | undefined;
    for (let i = 0; i < queue.length; i++) {
      const lane = this.lanes.get(queue[i])!;
      if (lane.to === target) { last = lane.id; break; }
      if (lane.to !== this.lanes.get(starts[0])?.to && !destinations.has(lane.to)) destinations.set(lane.to, lane.id);
      for (const id of lane.next) if (!parents.has(id)) { parents.set(id, lane.id); queue.push(id); }
    }
    if (target === undefined && destinations.size) last = [...destinations.values()][Math.floor(this.rng() * destinations.size)];
    const route: string[] = [];
    while (last !== undefined) { route.push(last); last = parents.get(last); }
    return route.reverse();
  }

  /** Fewest lanes via legal connectors; [] for the same node or unreachable nodes. */
  routeBetween(fromNode: string, toNode: string): string[] {
    return fromNode === toNode ? [] : this.search(this.outgoing.get(fromNode) ?? [], toNode);
  }

  private canSpawn(lane: Lane, distance: number): boolean {
    if (lane.length < CAR_LENGTH || distance < CAR_LENGTH / 2 || distance > stopAt(lane) + EPS) return false;
    // Never insert a new obstacle into an already admitted car's exit space.
    for (const lock of this.reservations.values()) if (lock.connector.to === lane.id) return false;
    const { position } = sample(lane.points, this.distances.get(lane.id)!, distance);
    return this.vehicles.every(v => (v.connectorId || v.laneId !== lane.id || Math.abs(v.distance - distance) >= GAP - EPS)
      && separation(v.position, position) >= CAR_LENGTH - EPS);
  }

  private createVehicle(route: string[], distance: number): Vehicle {
    const lane = this.lanes.get(route[0])!;
    const vehicle: Vehicle = {
      id: `vehicle-${this.nextId++}`, laneId: lane.id, route, routeIndex: 0, distance,
      speed: 0, color: colors[Math.floor(this.rng() * colors.length)], waiting: false,
      ...sample(lane.points, this.distances.get(lane.id)!, distance),
    };
    this.vehicles.push(vehicle);
    return vehicle;
  }

  /** Spawn at rest, 2m into the first lane; occupied/unreachable starts fail. */
  spawnRoute(fromNode: string, toNode: string): Vehicle | undefined {
    const route = this.routeBetween(fromNode, toNode), lane = this.lanes.get(route[0]);
    if (lane && this.canSpawn(lane, CAR_LENGTH / 2)) return this.createVehicle(route, CAR_LENGTH / 2);
  }

  reset(count = this.requested): void {
    this.requested = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    this.time = 0; this.removed = 0; this.excluded = 0; this.accumulator = 0; this.nextId = 0;
    this.vehicles = []; this.reservations.clear(); this.waitingSince.clear();
    this.rng = random(`${this.city.seed}:traffic`);
    const slots = this.graph.lanes.filter(lane => lane.length >= CAR_LENGTH).map(lane => {
      const count = Math.floor((lane.length - CAR_LENGTH) / GAP) + 1;
      return { lane, count, start: Math.floor(this.rng() * count) };
    });
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    // Round-robin shuffled lanes before filling another slot on the same lane.
    for (let round = 0; this.vehicles.length < this.requested; round++) {
      let available = false;
      for (const slot of slots) {
        if (round >= slot.count) continue;
        available = true;
        const distance = CAR_LENGTH / 2 + ((slot.start + round) % slot.count) * GAP;
        if (this.canSpawn(slot.lane, distance)) {
          const route = this.search([slot.lane.id]);
          if (route.length) this.createVehicle(route, distance);
        }
        if (this.vehicles.length === this.requested) break;
      }
      if (!available) break;
    }
    this.excluded = this.requested - this.vehicles.length;
  }

  updateCity(city: City): void {
    const graph = buildLaneGraph(city), oldCount = this.vehicles.length;
    this.city = city; this.graph = graph;
    this.indexGraph();
    this.reset();
    this.removed = oldCount;
  }

  private greenRemaining(nodeId: string, laneId: string): number {
    const lane = this.lanes.get(laneId);
    if (!lane || lane.to !== nodeId) return 0;
    if ((this.outgoing.get(nodeId)?.length ?? 0) <= 2) return Infinity;
    const a = lane.points[0], b = lane.points.at(-1)!;
    const ns = Math.abs(b.z - a.z) >= Math.abs(b.x - a.x);
    const phase = ((this.time + EPS) % 28 + 28) % 28;
    if (ns && phase < 12) return 12 - phase;
    if (!ns && phase >= 14 && phase < 26) return 26 - phase;
    return 0;
  }

  signal(nodeId: string, laneId: string): 'red' | 'green' {
    return this.greenRemaining(nodeId, laneId) > 0 ? 'green' : 'red';
  }

  /** dt is simulated elapsed time, accumulated into 1/60s ticks. At most 1s
   * per call is accepted; invalid/negative values are ignored, not propagated. */
  step(dt = STEP): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 1);
    const ticks = Math.floor((this.accumulator + EPS) / STEP);
    this.accumulator = Math.max(0, this.accumulator - ticks * STEP);
    for (let i = 0; i < ticks; i++) this.tick();
  }

  /** Clamp wall-time stalls to .25s and playback to [0,4]; no catch-up backlog.
   * Ordinary 30/60/144 Hz frames produce identical state at equal tick counts. */
  advance(realSeconds: number, speed = 1): void {
    if (!Number.isFinite(realSeconds) || !Number.isFinite(speed) || realSeconds <= 0 || speed <= 0) return;
    this.step(Math.min(realSeconds, 0.25) * Math.min(speed, 4));
  }

  private tick(): void {
    // Immutable occupancy for this tick prevents array update order from changing
    // leaders when they cross from lane-distance to connector-distance.
    const occupied = new Map<string, { id: string; distance: number }[]>();
    const tails = new Map<string, number>();
    for (const v of this.vehicles) {
      if (v.connectorId) {
        const connector = this.connectors.get(v.connectorId)!;
        tails.set(v.laneId, this.lanes.get(v.laneId)!.length + v.distance);
        if (!this.reservations.has(connector.nodeId)) throw new Error('A connector requires a node reservation.');
      } else {
        if (!occupied.has(v.laneId)) occupied.set(v.laneId, []);
        occupied.get(v.laneId)!.push({ id: v.id, distance: v.distance });
      }
    }
    for (const cars of occupied.values()) cars.sort((a, b) => a.distance - b.distance);
    for (const lock of this.reservations.values()) if (lock.clearance !== undefined) {
      const from = this.lanes.get(lock.connector.from)!;
      tails.set(from.id, from.length + lock.connector.length + GAP - lock.clearance);
    }

    const candidates: Vehicle[] = [];
    for (const v of this.vehicles) {
      if (v.connectorId) continue;
      const lane = this.lanes.get(v.laneId)!;
      if (this.reservations.get(lane.to)?.vehicleId === v.id) continue;
      if (stopAt(lane) - v.distance > 0.02 || v.speed > 0.1) continue;
      if (v.routeIndex === v.route.length - 1) {
        // Destination reached: retain the incoming lane so replanning cannot
        // introduce a forbidden U-turn or reset the physical position.
        const route = this.search([lane.id]);
        if (route.length) { v.route = route; v.routeIndex = 0; }
      }
      if (!this.waitingSince.has(v.id)) this.waitingSince.set(v.id, this.time);
      candidates.push(v);
    }
    candidates.sort((a, b) => this.waitingSince.get(a.id)! - this.waitingSince.get(b.id)! || (a.id < b.id ? -1 : 1));
    for (const v of candidates) {
      const lane = this.lanes.get(v.laneId)!;
      const connector = this.connectors.get(connectorId(lane.id, v.route[v.routeIndex + 1]));
      if (!connector || this.reservations.has(lane.to) || this.signal(lane.to, lane.id) !== 'green') continue;
      // Starting from rest is the slowest admission. Do not commit a car that
      // would still be behind the connector boundary when green expires.
      const entryTime = Math.sqrt(2 * (lane.length - v.distance) / ACCELERATION) + 2 * STEP;
      if (this.greenRemaining(lane.to, lane.id) <= entryTime) continue;
      const first = occupied.get(connector.to)?.[0];
      if (first && first.distance < GAP + CAR_LENGTH / 2) continue;
      this.reservations.set(lane.to, { vehicleId: v.id, connector });
      this.waitingSince.delete(v.id);
    }

    for (const v of this.vehicles) {
      const lane = this.lanes.get(v.laneId)!;
      const active = v.connectorId ? this.connectors.get(v.connectorId)! : undefined;
      const lock = this.reservations.get(lane.to);
      const admitted = lock?.vehicleId === v.id && lock.clearance === undefined;
      const connector = active ?? (admitted ? lock.connector : undefined);
      let room = stopAt(lane) - v.distance;
      if (connector) {
        const next = this.lanes.get(connector.to)!;
        const toExit = (active ? 0 : lane.length) + connector.length - v.distance;
        room = toExit + stopAt(next);
        const first = occupied.get(next.id)?.find(car => car.id !== v.id);
        if (first) room = Math.min(room, toExit + first.distance - GAP);
        const tail = tails.get(next.id);
        if (tail !== undefined) room = Math.min(room, toExit + tail - GAP);
      }
      if (!active) {
        const leader = occupied.get(lane.id)?.find(car => car.id !== v.id && car.distance >= v.distance);
        if (leader) room = Math.min(room, leader.distance - v.distance - GAP);
        if (!admitted && tails.has(lane.id)) room = Math.min(room, tails.get(lane.id)! - v.distance - GAP);
      }
      // Treat leaders as stationary: this conservative stopping envelope leaves
      // one reaction tick and never needs a position snap or emergency braking.
      const safe = Math.sqrt((BRAKING * STEP) ** 2 + 2 * BRAKING * Math.max(0, room)) - BRAKING * STEP;
      const target = Math.min(MAX_SPEED, safe);
      v.speed = Math.max(0, v.speed + Math.max(-BRAKING * STEP, Math.min(ACCELERATION * STEP, target - v.speed)));
      v.waiting = v.speed < 0.1 && room < 0.1;
      this.move(v, v.speed * STEP);
    }
    this.time += STEP;
  }

  private move(v: Vehicle, travel: number): void {
    while (travel > 0) {
      const lane = this.lanes.get(v.laneId)!;
      const active = v.connectorId ? this.connectors.get(v.connectorId)! : undefined;
      const section = active ?? lane;
      const amount = Math.min(travel, section.length - v.distance);
      v.distance += amount; travel -= amount;
      for (const [node, lock] of this.reservations) if (lock.vehicleId === v.id && lock.clearance !== undefined) {
        lock.clearance -= amount;
        if (lock.clearance <= EPS) this.reservations.delete(node);
      }
      if (v.distance < section.length) break;
      if (active) {
        this.reservations.get(active.nodeId)!.clearance = GAP;
        v.laneId = active.to; v.routeIndex++; v.distance = 0;
        delete v.connectorId;
      } else {
        const lock = this.reservations.get(lane.to);
        if (!lock || lock.vehicleId !== v.id || lock.clearance !== undefined) break;
        v.connectorId = lock.connector.id; v.distance = 0;
      }
    }
    const section = v.connectorId ? this.connectors.get(v.connectorId)! : this.lanes.get(v.laneId)!;
    Object.assign(v, sample(section.points, this.distances.get(section.id)!, v.distance));
  }
}
