import assert from 'node:assert/strict';
import test from 'node:test';
import { addRoad, clone, createCity, deleteRoad, getAlignment, heightAt, splitRoad, type City } from '../src/core/model.ts';
import { buildLaneGraph, Traffic, type Connector, type Lane, type LaneGraph, type Vehicle } from '../src/core/traffic.ts';

const H = 1 / 60;
const local = { profile: 'local' as const, width: 10, level: 0, clearance: 5 };
type Point = Vehicle['position'];
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function network(nodes: [string, number, number, number?, number?][], edges: [string, string, string, number?][]): City {
  const city = createCity('empty', 317);
  city.nodes = nodes.map(([id, x, z, level = 0, y = 1 + level * 12]) => ({ id, x, z, y, level }));
  city.roads = edges.map(([id, a, b, width = 10]) => ({ ...local, id, a, b, width, level: city.nodes.find(n => n.id === a)!.level }));
  return city;
}

const cross = () => network(
  [['c', 0, 0], ['n', 0, -60], ['s', 0, 60], ['w', -60, 0], ['e', 60, 0]],
  [['north', 'n', 'c'], ['south', 'c', 's'], ['west', 'w', 'c'], ['east', 'c', 'e']],
);

// Independent linear arclength interpolation, including elevation.
function positionAt(section: Lane | Connector, target: number): Point {
  let travelled = 0;
  for (let i = 1; i < section.points.length; i++) {
    const a = section.points[i - 1], b = section.points[i], length = distance(a, b);
    if (travelled + length >= target - 1e-10) {
      const t = Math.max(0, Math.min(1, (target - travelled) / length));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    travelled += length;
  }
  return { ...section.points.at(-1)! };
}

function checkRoute(graph: LaneGraph, route: string[], from?: string, to?: string): void {
  assert.ok(route.length);
  const lanes = route.map(id => {
    const lane = graph.lanes.find(l => l.id === id);
    assert.ok(lane, `unknown lane ${id}`);
    return lane;
  });
  if (from !== undefined) assert.equal(lanes[0].from, from);
  if (to !== undefined) assert.equal(lanes.at(-1)!.to, to);
  for (let i = 1; i < lanes.length; i++) {
    assert.equal(lanes[i - 1].to, lanes[i].from);
    assert.ok(lanes[i - 1].next.includes(lanes[i].id));
    assert.equal(graph.connectors.filter(c => c.from === lanes[i - 1].id && c.to === lanes[i].id).length, 1);
  }
}

function checkGaps(traffic: Traffic): void {
  const lanes = new Map(traffic.graph.lanes.map(l => [l.id, l]));
  const connectors = new Map(traffic.graph.connectors.map(c => [c.id, c]));
  const occupied = new Map<string, Vehicle[]>();
  const nodes = new Set<string>();
  for (const v of traffic.vehicles) if (!v.connectorId) {
    if (!occupied.has(v.laneId)) occupied.set(v.laneId, []);
    occupied.get(v.laneId)!.push(v);
  }
  for (const cars of occupied.values()) {
    cars.sort((a, b) => a.distance - b.distance);
    for (let i = 1; i < cars.length; i++) assert.ok(cars[i].distance - cars[i - 1].distance >= 6 - 1e-7, `queue gap ${cars[i].distance - cars[i - 1].distance}`);
  }
  for (const v of traffic.vehicles) if (v.connectorId) {
    const connector = connectors.get(v.connectorId)!;
    assert.ok(!nodes.has(connector.nodeId), `conflicting connectors at ${connector.nodeId}`);
    nodes.add(connector.nodeId);
    const incoming = occupied.get(connector.from)?.at(-1);
    if (incoming) assert.ok(lanes.get(connector.from)!.length - incoming.distance + v.distance >= 6 - 1e-7, 'gap behind connector');
    const outgoing = occupied.get(connector.to)?.[0];
    if (outgoing) assert.ok(connector.length - v.distance + outgoing.distance >= 6 - 1e-7, 'gap ahead of connector');
  }
}

function tickChecked(traffic: Traffic): void {
  const previous = new Map(traffic.vehicles.map(v => [v.id, { ...v, position: { ...v.position } }]));
  const phases = new Map(traffic.graph.lanes.map(l => [l.id, traffic.signal(l.to, l.id)]));
  traffic.step();
  for (const v of traffic.vehicles) {
    const before = previous.get(v.id)!;
    assert.ok(v.speed >= 0 && v.speed <= 11 + 1e-9);
    assert.ok(v.speed - before.speed <= 2 * H + 1e-9, 'bounded acceleration');
    assert.ok(before.speed - v.speed <= 4 * H + 1e-9, 'bounded braking');
    assert.ok(distance(before.position, v.position) <= v.speed * H + 1e-8, 'no teleport');
    assert.equal(v.laneId, v.route[v.routeIndex]);
    const section = v.connectorId ? traffic.graph.connectors.find(c => c.id === v.connectorId)! : traffic.graph.lanes.find(l => l.id === v.laneId)!;
    assert.ok(v.distance >= 0 && v.distance <= section.length + 1e-9);
    assert.ok(distance(v.position, positionAt(section, v.distance)) < 1e-8);
    assert.ok(Number.isFinite(v.heading));
    if (v.connectorId) {
      const connector = section as Connector;
      assert.equal(connector.from, v.laneId);
      assert.equal(connector.to, v.route[v.routeIndex + 1]);
      if (before.connectorId !== v.connectorId) {
        assert.equal(phases.get(connector.from), 'green', 'entry must be green');
        assert.equal(traffic.signal(connector.nodeId, connector.from), 'green');
      }
    }
  }
  checkGaps(traffic);
}

test('directed right-hand lanes, incident-only cuts, exact sampled connectors and legal turns', () => {
  const city = cross();
  city.roads.find(r => r.id === 'east')!.width = 18;
  city.roads.find(r => r.id === 'east')!.profile = 'boulevard';
  const before = clone(city), graph = buildLaneGraph(city);
  assert.equal(graph.lanes.length, city.roads.length * 2, 'supported one-lane-per-direction layout');
  assert.equal(graph.connectors.length, 16, '12 crossing turns plus four dead-end turnarounds');
  for (const lane of graph.lanes) {
    const road = city.roads.find(r => r.id === lane.roadId)!;
    const a = city.nodes.find(n => n.id === lane.from)!, b = city.nodes.find(n => n.id === lane.to)!;
    const length = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
    for (const p of lane.points) assert.ok(Math.abs((p.x - a.x) * -uz + (p.z - a.z) * ux - road.width * 0.19) < 1e-8);
    const cutStart = (lane.points[0].x - a.x) * ux + (lane.points[0].z - a.z) * uz;
    const cutEnd = (b.x - lane.points.at(-1)!.x) * ux + (b.z - lane.points.at(-1)!.z) * uz;
    assert.ok(Math.abs(cutStart - (lane.from === 'c' ? 10 : 0)) < 1e-8);
    assert.ok(Math.abs(cutEnd - (lane.to === 'c' ? 10 : 0)) < 1e-8);
    for (const id of lane.next) {
      const next = graph.lanes.find(l => l.id === id)!;
      assert.equal(next.from, lane.to);
      if (lane.to === 'c') assert.notEqual(next.to, lane.from, 'no intersection U-turn');
      else assert.equal(next.to, lane.from, 'dead-end U-turn');
    }
  }
  for (const connector of graph.connectors) {
    const from = graph.lanes.find(l => l.id === connector.from)!, to = graph.lanes.find(l => l.id === connector.to)!;
    assert.deepEqual(connector.points[0], from.points.at(-1));
    assert.deepEqual(connector.points.at(-1), to.points[0]);
    assert.equal(connector.nodeId, from.to);
    assert.ok(connector.points.length > 10);
    const measured = connector.points.slice(1).reduce((sum, p, i) => sum + distance(p, connector.points[i]), 0);
    assert.ok(Math.abs(measured - connector.length) < 1e-9);
    for (let i = 1; i < connector.points.length; i++) assert.ok(distance(connector.points[i - 1], connector.points[i]) < 1);
  }
  assert.deepEqual(city, before, 'graph construction is read-only');
  const unrelated = clone(city);
  unrelated.nodes.push({ id: 'over-a', x: 0, z: -100, y: 13, level: 1 }, { id: 'over-b', x: 0, z: 100, y: 13, level: 1 });
  unrelated.roads.push({ ...local, id: 'over', a: 'over-a', b: 'over-b', level: 1, width: 40 });
  assert.deepEqual(buildLaneGraph(unrelated).lanes.filter(l => l.roadId !== 'over'), graph.lanes);
});

test('BFS routes agree with an independent node graph, including unreachable destinations', () => {
  const city = network(
    [['a', -120, 0], ['b', 0, 0], ['c', 120, 0], ['d', 0, 120], ['e', -120, 120], ['island-a', 300, 0], ['island-b', 300, 120]],
    [['ab', 'a', 'b'], ['bc', 'b', 'c'], ['bd', 'b', 'd'], ['de', 'd', 'e'], ['ea', 'e', 'a'], ['island', 'island-a', 'island-b']],
  );
  const traffic = new Traffic(city, 0);
  for (const from of city.nodes) for (const to of city.nodes) {
    const queue = [from.id], depths = new Map([[from.id, 0]]);
    for (let i = 0; i < queue.length; i++) for (const road of city.roads) {
      const next = road.a === queue[i] ? road.b : road.b === queue[i] ? road.a : undefined;
      if (next !== undefined && !depths.has(next)) { depths.set(next, depths.get(queue[i])! + 1); queue.push(next); }
    }
    const route = traffic.routeBetween(from.id, to.id);
    assert.equal(route.length, depths.get(to.id) ?? 0);
    if (route.length) checkRoute(traffic.graph, route, from.id, to.id);
  }
  assert.deepEqual(traffic.routeBetween('unknown', 'a'), []);
  assert.deepEqual(traffic.routeBetween('a', 'unknown'), []);
  assert.equal(traffic.spawnRoute('a', 'island-b'), undefined);
  assert.equal(traffic.spawnRoute('a', 'a'), undefined);
  const v = traffic.spawnRoute('a', 'c')!;
  checkRoute(traffic.graph, v.route, 'a', 'c');
  assert.equal(v.speed, 0);
  assert.equal(traffic.spawnRoute('a', 'c'), undefined, 'occupied spawn is refused');
});

test('grade-separated crossings and coincident nodes at different levels stay disconnected', () => {
  const city = network(
    [['w', -100, 0], ['ground', 0, 0], ['e', 100, 0], ['n', 0, -100, 1], ['upper', 0, 0, 1], ['s', 0, 100, 1]],
    [['wg', 'w', 'ground'], ['ge', 'ground', 'e'], ['nu', 'n', 'upper'], ['us', 'upper', 's']],
  );
  const traffic = new Traffic(city, 0);
  assert.equal(traffic.routeBetween('w', 'e').length, 2);
  assert.equal(traffic.routeBetween('n', 's').length, 2);
  assert.deepEqual(traffic.routeBetween('w', 's'), []);
  assert.deepEqual(traffic.routeBetween('upper', 'ground'), []);
  for (const connector of traffic.graph.connectors) {
    const node = city.nodes.find(n => n.id === connector.nodeId)!;
    for (const p of connector.points) assert.ok(Math.abs(p.y - node.y) < 1e-9);
  }
  const unsplit = network([['w', -100, 0], ['e', 100, 0], ['n', 0, -100, 1], ['s', 0, 100, 1]], [['ground', 'w', 'e'], ['over', 'n', 's']]);
  assert.deepEqual(new Traffic(unsplit, 0).routeBetween('w', 's'), []);
  assert.equal(buildLaneGraph(unsplit).connectors.length, 4, 'only dead-end connectors, no geometric crossing');
});

test('real river bridges are reachable and use alignment heights continuously through a split approach', () => {
  const original = createCity('riverfront'), bridge = original.roads.find(r => getAlignment(original, r).bridge)!;
  const a = original.nodes.find(n => n.id === bridge.a)!, b = original.nodes.find(n => n.id === bridge.b)!;
  const city = splitRoad(original, bridge.id, { x: a.x, z: -55 });
  const traffic = new Traffic(city, 0), route = traffic.routeBetween(a.id, b.id);
  assert.equal(route.length, 2);
  checkRoute(traffic.graph, route, a.id, b.id);
  for (const id of route) {
    const lane = traffic.graph.lanes.find(l => l.id === id)!, road = city.roads.find(r => r.id === lane.roadId)!;
    const alignment = getAlignment(city, road).points;
    for (const p of lane.points) {
      let expected = alignment.at(-1)!.y;
      for (let i = 1; i < alignment.length; i++) if (alignment[i].z >= p.z - 1e-9) {
        const t = (p.z - alignment[i - 1].z) / (alignment[i].z - alignment[i - 1].z);
        expected = alignment[i - 1].y + t * (alignment[i].y - alignment[i - 1].y); break;
      }
      assert.ok(Math.abs(p.y - expected) < 1e-8, 'sampled deck/approach, not terrain height');
    }
  }
  const v = traffic.spawnRoute(a.id, b.id)!;
  let deck = false, slope = false, connector = false, completed = false;
  for (let i = 0; i < 60 * 65; i++) {
    tickChecked(traffic);
    if (Math.abs(v.position.z) <= 39 && v.laneId === route[1]) {
      deck = true; assert.ok(v.position.y >= city.water[0].level + bridge.clearance - 1e-7);
    }
    if (v.position.y > heightAt(city, v.position.x, v.position.z) + 0.5 && Math.abs(v.position.z) > 40) slope = true;
    if (v.connectorId && v.laneId === route[0]) connector = true;
    if (v.laneId === route[1] && v.position.z > 75) { completed = true; break; }
  }
  assert.ok(deck && slope && connector && completed);
});

test('an 11% terrain slope retains height and true 3D travel distance', () => {
  const terrain = createCity('empty');
  terrain.terrain.heights = terrain.terrain.heights.map((_, i) => 1 + 0.11 * (i % 33) * 30);
  const city = addRoad(terrain, [{ x: -120, z: 0 }, { x: 0, z: 0 }, { x: 120, z: 0 }], local);
  const traffic = new Traffic(city, 0), from = city.nodes.find(n => n.x === -120)!, to = city.nodes.find(n => n.x === 120)!;
  const v = traffic.spawnRoute(from.id, to.id)!;
  for (const lane of traffic.graph.lanes) for (const p of lane.points) assert.ok(Math.abs(p.y - heightAt(city, p.x, p.z)) < 1e-8);
  let connectorSeen = false, highSpeed = false;
  for (let i = 0; i < 60 * 35; i++) {
    tickChecked(traffic);
    connectorSeen ||= !!v.connectorId;
    highSpeed ||= v.speed > 10.99;
  }
  assert.ok(connectorSeen && highSpeed);
});

test('signals have exact 12/2/12/2 phases; degree one/two nodes are unsignalized', () => {
  const traffic = new Traffic(cross(), 0);
  const ns = traffic.graph.lanes.find(l => l.from === 'n')!, ew = traffic.graph.lanes.find(l => l.from === 'w')!;
  for (const [time, n, e] of [[0, 'green', 'red'], [11.99, 'green', 'red'], [12, 'red', 'red'], [13.99, 'red', 'red'], [14, 'red', 'green'], [25.99, 'red', 'green'], [26, 'red', 'red'], [27.99, 'red', 'red'], [28, 'green', 'red']] as const) {
    traffic.time = time;
    assert.equal(traffic.signal('c', ns.id), n);
    assert.equal(traffic.signal('c', ew.id), e);
    const deadEnd = traffic.graph.lanes.find(l => l.to === 'n')!;
    assert.equal(traffic.signal('n', deadEnd.id), 'green');
  }
  assert.equal(traffic.signal('missing', ns.id), 'red');
  assert.equal(traffic.signal('n', ns.id), 'red', 'must be an incoming lane');
  assert.equal(traffic.signal('c', 'missing'), 'red');
  const line = new Traffic(network([['a', -60, 0], ['b', 0, 0], ['c', 60, 0]], [['ab', 'a', 'b'], ['bc', 'b', 'c']]), 0);
  line.time = 13;
  for (const lane of line.graph.lanes) assert.equal(line.signal(lane.to, lane.id), 'green');
});

test('red traffic brakes to rest with its front behind the stop line and resumes on green', () => {
  const traffic = new Traffic(cross(), 0), v = traffic.spawnRoute('w', 'e')!;
  const lane = traffic.graph.lanes.find(l => l.id === v.laneId)!;
  let waited = false, braked = false;
  for (let i = 0; i < 14 * 60; i++) {
    const speed = v.speed;
    tickChecked(traffic);
    assert.equal(v.connectorId, undefined);
    assert.equal(v.laneId, lane.id);
    assert.ok(v.distance + 2 <= lane.length + 1e-8, 'front stays behind stop line');
    waited ||= v.waiting && v.speed < 0.01;
    braked ||= v.speed < speed;
  }
  assert.ok(waited && braked);
  assert.ok(lane.length - 2 - v.distance < 0.02);
  let entered = false, exited = false;
  for (let i = 0; i < 8 * 60; i++) {
    tickChecked(traffic);
    entered ||= !!v.connectorId;
    exited ||= v.laneId !== lane.id;
  }
  assert.ok(entered && exited);
});

test('late-green arrivals wait through all-red instead of entering a connector on red', () => {
  const traffic = new Traffic(cross(), 0), v = traffic.spawnRoute('n', 's')!;
  // Arrival is near the end of this NS green, too late to clear the admission gap.
  traffic.time = 3;
  let waitedDuringRed = false, entered = false;
  for (let i = 0; i < 35 * 60; i++) {
    tickChecked(traffic);
    if (traffic.time > 12 && traffic.time < 28 && v.laneId === v.route[0]) {
      assert.equal(v.connectorId, undefined);
      waitedDuringRed ||= v.waiting;
    }
    entered ||= !!v.connectorId;
  }
  assert.ok(waitedDuringRed && entered);
});

test('queues maintain a 4m car plus 2m gap across lanes and connectors with bounded dynamics', () => {
  const traffic = new Traffic(cross(), 0);
  let spawned = 0, queued = 0, moved = false;
  for (let i = 0; i < 95 * 60; i++) {
    if (spawned < 7 && traffic.spawnRoute('w', 'e')) spawned++;
    tickChecked(traffic);
    queued = Math.max(queued, traffic.vehicles.filter(v => v.waiting && v.laneId === 'west:ab').length);
    moved ||= traffic.vehicles.some(v => v.laneId === 'east:ab');
  }
  assert.equal(spawned, 7);
  assert.ok(queued >= 3, `${queued} waiting cars`);
  assert.ok(moved);
});

test('blocked exits deny admission and an admitted connector protects its exit from new spawns', () => {
  const city = cross();
  city.nodes.find(n => n.id === 'e')!.x = 30;
  city.nodes.push({ id: 'ee', x: 60, z: 0, y: 1, level: 0 }, { id: 'en', x: 30, z: -40, y: 1, level: 0 });
  city.roads.push({ ...local, id: 'ee-road', a: 'e', b: 'ee' }, { ...local, id: 'en-road', a: 'e', b: 'en' });
  const traffic = new Traffic(city, 0), exit = traffic.graph.lanes.find(l => l.from === 'c' && l.to === 'e')!;
  // A physically valid stationary queue filling the next, red-light approach.
  for (let i = 0; i < 3; i++) {
    const queued = traffic.spawnRoute('c', 'ee')!;
    assert.ok(queued);
    queued.distance = exit.length - 2 - i * 6;
    queued.position = positionAt(exit, queued.distance);
  }
  const v = traffic.spawnRoute('n', 'e')!;
  let blocked = false, entered = false, spawnProtected = false;
  for (let i = 0; i < 65 * 60; i++) {
    tickChecked(traffic);
    if (traffic.time < 14) {
      assert.equal(v.connectorId, undefined, 'no admission into a full exit lane');
      blocked ||= v.waiting;
    }
    if (v.connectorId && traffic.graph.connectors.find(c => c.id === v.connectorId)!.to === exit.id) {
      entered = true;
      assert.equal(traffic.spawnRoute('c', 'e'), undefined);
      spawnProtected = true;
    }
  }
  assert.ok(blocked && entered && spawnProtected);
});

test('one global node reservation prevents conflicting turns and retains rear-clearance space', () => {
  const traffic = new Traffic(cross(), 0);
  for (const [from, to] of [['n', 'e'], ['s', 'w'], ['w', 'n'], ['e', 's']]) assert.ok(traffic.spawnRoute(from, to));
  const exits = new Map<string, { id: string; travelled: number }>();
  const entrants = new Set<string>();
  for (let i = 0; i < 110 * 60; i++) {
    const before = new Map(traffic.vehicles.map(v => [v.id, v.connectorId]));
    tickChecked(traffic);
    for (const exit of exits.values()) exit.travelled += traffic.vehicles.find(v => v.id === exit.id)!.speed * H;
    for (const v of traffic.vehicles) {
      const old = before.get(v.id);
      if (old && !v.connectorId) {
        const c = traffic.graph.connectors.find(c => c.id === old)!;
        exits.set(c.nodeId, { id: v.id, travelled: v.distance });
      }
      if (!old && v.connectorId) {
        const c = traffic.graph.connectors.find(c => c.id === v.connectorId)!, last = exits.get(c.nodeId);
        if (last && last.id !== v.id) assert.ok(last.travelled >= 6 - 1e-7, `released ${c.nodeId} before rear clearance`);
        if (c.nodeId === 'c') entrants.add(v.id);
      }
    }
  }
  assert.equal(entrants.size, 4, 'every conflicting approach eventually gets a reservation');
});

test('unsignalized degree-two bends yield to the same global reservation', () => {
  const city = network([['a', -50, 0], ['b', 0, 0], ['c', 0, 50]], [['ab', 'a', 'b'], ['bc', 'b', 'c']]);
  const traffic = new Traffic(city, 0);
  traffic.spawnRoute('a', 'c'); traffic.spawnRoute('c', 'a');
  const crossed = new Set<string>();
  for (let i = 0; i < 35 * 60; i++) {
    tickChecked(traffic);
    for (const v of traffic.vehicles) if (v.connectorId && traffic.graph.connectors.find(c => c.id === v.connectorId)!.nodeId === 'b') crossed.add(v.id);
  }
  assert.equal(crossed.size, 2);
});

test('destinations replan reachable legal routes without despawning or jumping', () => {
  const traffic = new Traffic(cross(), 0), v = traffic.spawnRoute('n', 'c')!;
  const original = v.route;
  let replanned = false, returned = false;
  for (let i = 0; i < 100 * 60; i++) {
    tickChecked(traffic);
    if (v.route !== original) replanned = true;
    returned ||= !!v.connectorId && traffic.graph.connectors.find(c => c.id === v.connectorId)!.nodeId !== 'c';
    checkRoute(traffic.graph, v.route);
  }
  assert.ok(replanned && returned);
  assert.equal(traffic.vehicles[0], v);
  assert.equal(traffic.removed, 0);
});

test('100 active cars on the 120-segment city have staggered, seeded, nonoverlapping starts', () => {
  const city = createCity('riverfront'), traffic = new Traffic(city, 100);
  assert.equal(city.roads.length, 120);
  assert.equal(traffic.vehicles.length, 100);
  assert.equal(traffic.excluded, 0);
  assert.ok(new Set(traffic.vehicles.map(v => v.laneId)).size > 90);
  assert.ok(new Set(traffic.vehicles.map(v => v.distance)).size > 8);
  checkGaps(traffic);
  for (const v of traffic.vehicles) {
    checkRoute(traffic.graph, v.route);
    for (const other of traffic.vehicles) if (other.id !== v.id) assert.ok(distance(v.position, other.position) >= 4 - 1e-8);
  }
  const initial = clone(traffic.vehicles);
  for (let i = 0; i < 60 * 3; i++) traffic.step();
  traffic.reset();
  assert.deepEqual(traffic.vehicles, initial);
  assert.equal(traffic.time, 0);
  const reordered = clone(city);
  reordered.nodes.reverse(); reordered.roads.reverse();
  assert.deepEqual(new Traffic(reordered, 100).vehicles, initial, 'input array order does not affect seed');
  const otherSeed = clone(city); otherSeed.seed++;
  assert.notDeepEqual(new Traffic(otherSeed, 100).vehicles, initial);
});

test('30, 60 and 144 rendering FPS produce exactly equal simulated time, positions and paths', () => {
  const city = createCity('riverfront');
  const runs = [30, 60, 144].map(fps => {
    const traffic = new Traffic(city, 100);
    const initial = clone(traffic.vehicles);
    for (let frame = 0; frame < fps * 48; frame++) traffic.advance(1 / fps);
    assert.equal(traffic.vehicles.length, 100);
    assert.ok(traffic.vehicles.filter((v, i) => distance(v.position, initial[i].position) > 5).length > 90);
    checkGaps(traffic);
    return traffic;
  });
  assert.ok(Math.abs(runs[0].time - 48) < 1e-8);
  for (const traffic of runs.slice(1)) {
    assert.equal(traffic.time, runs[0].time);
    assert.deepEqual(traffic.vehicles, runs[0].vehicles);
  }
  for (const fps of [30, 60, 144]) {
    const faster = new Traffic(city, 100);
    for (let frame = 0; frame < fps * 12; frame++) faster.advance(1 / fps, 4);
    assert.equal(faster.time, runs[0].time);
    assert.deepEqual(faster.vehicles, runs[0].vehicles);
  }
});

test('100-car traffic preserves per-tick dynamics and queue safety over complete signal cycles', () => {
  const traffic = new Traffic(createCity('riverfront'), 100);
  const crossed = new Set<string>();
  for (let i = 0; i < 56 * 60; i++) {
    tickChecked(traffic);
    for (const v of traffic.vehicles) if (v.connectorId) crossed.add(v.id);
  }
  assert.equal(traffic.vehicles.length, 100);
  assert.ok(crossed.size > 90);
});

test('elapsed-time guards, fractional steps, pause and stall clamps remain bounded and deterministic', () => {
  const city = cross(), traffic = new Traffic(city, 4), baseline = clone(traffic.vehicles);
  for (const invalid of [NaN, Infinity, -Infinity, -1, 0]) { traffic.step(invalid); traffic.advance(invalid); }
  for (const invalid of [NaN, Infinity, -1, 0]) traffic.advance(1, invalid);
  assert.equal(traffic.time, 0); assert.deepEqual(traffic.vehicles, baseline);
  traffic.step(H / 2); assert.equal(traffic.time, 0);
  traffic.step(H / 2); assert.equal(traffic.time, H);
  traffic.reset(); traffic.advance(100, 100);
  const reference = new Traffic(city, 4);
  for (let i = 0; i < 60; i++) reference.step();
  assert.equal(traffic.time, reference.time); assert.deepEqual(traffic.vehicles, reference.vehicles);
  traffic.reset(); traffic.step(1e9);
  assert.deepEqual(traffic.vehicles, reference.vehicles);
  traffic.reset(); traffic.advance(100);
  assert.ok(Math.abs(traffic.time - 0.25) < 1e-9);
  traffic.advance(0); assert.ok(Math.abs(traffic.time - 0.25) < 1e-9, 'discarded stall does not leave backlog');
  traffic.step(H / 2); traffic.reset(); traffic.step(H / 2);
  assert.equal(traffic.time, 0, 'reset discards fractional accumulator');
});

test('structural edits deterministically reset every route/car and report old active removals', () => {
  const city = cross(), traffic = new Traffic(city, 16);
  for (let i = 0; i < 60 * 10; i++) traffic.step();
  const oldCars = [...traffic.vehicles], edited = deleteRoad(city, 'east');
  traffic.updateCity(edited);
  assert.equal(traffic.removed, oldCars.length);
  assert.equal(traffic.time, 0);
  assert.ok(traffic.vehicles.every(v => !oldCars.includes(v)));
  assert.ok(traffic.graph.lanes.every(l => l.roadId !== 'east'));
  const fresh = new Traffic(edited, 16);
  assert.deepEqual(traffic.graph, fresh.graph);
  assert.deepEqual(traffic.vehicles, fresh.vehicles);
  assert.equal(traffic.excluded, fresh.excluded);
  assert.deepEqual(traffic.routeBetween('w', 'e'), []);
  for (const v of traffic.vehicles) checkRoute(traffic.graph, v.route);
  for (let i = 0; i < 60 * 3; i++) { traffic.step(); fresh.step(); }
  assert.deepEqual(traffic.vehicles, fresh.vehicles, 'no stale reservations or RNG after edit');
  const before = clone(traffic.vehicles), invalid = clone(edited); invalid.roads[0].a = 'missing';
  assert.throws(() => traffic.updateCity(invalid));
  assert.deepEqual(traffic.vehicles, before, 'failed graph build is atomic');
  traffic.updateCity(createCity('empty'));
  assert.equal(traffic.removed, before.length); assert.equal(traffic.excluded, 16);
  assert.deepEqual(traffic.vehicles, []);
  traffic.reset(); assert.equal(traffic.removed, 0);
});

test('empty networks, capacity exclusions and 2m road geometry are finite and terminate', () => {
  const empty = new Traffic(createCity('empty'), 100);
  assert.deepEqual(empty.graph, { lanes: [], connectors: [] });
  assert.equal(empty.excluded, 100); assert.equal(empty.spawnRoute('a', 'b'), undefined);
  empty.advance(1); assert.ok(empty.time > 0);
  const city = network([['a', -2, 0], ['b', 0, 0], ['c', 2, 0]], [['ab', 'a', 'b'], ['bc', 'b', 'c']]);
  const tiny = new Traffic(city, 100);
  assert.equal(tiny.vehicles.length, 0); assert.equal(tiny.excluded, 100);
  assert.equal(tiny.routeBetween('a', 'c').length, 2, 'short geometry is still in the legal graph');
  for (const section of [...tiny.graph.lanes, ...tiny.graph.connectors]) {
    assert.ok(section.length > 0 && Number.isFinite(section.length));
    for (const p of section.points) assert.ok([p.x, p.y, p.z].every(Number.isFinite));
  }
  const small = new Traffic(network([['a', 0, 0], ['b', 12, 0]], [['ab', 'a', 'b']]), 100);
  assert.ok(small.vehicles.length > 0 && small.vehicles.length < 100);
  assert.equal(small.excluded, 100 - small.vehicles.length);
  checkGaps(small);
  for (let i = 0; i < 60 * 3; i++) tickChecked(small);
  small.reset(-2); assert.equal(small.vehicles.length, 0); assert.equal(small.excluded, 0);
  small.reset(NaN); assert.equal(small.vehicles.length, 0);
});

test('a short intermediate link remains traversable without jumps or unbounded braking', () => {
  const city = network([['a', -90, 0], ['b', 0, 0], ['c', 2, 0], ['d', 90, 0]], [['ab', 'a', 'b'], ['bc', 'b', 'c'], ['cd', 'c', 'd']]);
  const traffic = new Traffic(city, 0), v = traffic.spawnRoute('a', 'd')!;
  assert.equal(v.route.length, 3);
  let shortLink = false, completed = false;
  for (let i = 0; i < 55 * 60; i++) {
    tickChecked(traffic);
    shortLink ||= v.laneId === 'bc:ab';
    completed ||= v.laneId === 'cd:ab' && v.distance > 60;
  }
  assert.ok(shortLink && completed);
});
