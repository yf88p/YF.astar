import assert from 'node:assert/strict';
import test from 'node:test';
import { addRoad, clone, createCity, deleteRoad, extractBlocks, getAlignment, hash, heightAt, History, isWater, moveNode, quantities, random, rebuildCity, sculpt, setRiver, splitRoad, validateCity, type City, type Point } from '../src/core/model.ts';

const local = { profile: 'local' as const, width: 10, level: 0, clearance: 5 };
const len = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const rectangleCity = () => addRoad(createCity('empty'), [{ x: -90, z: -90 }, { x: 90, z: -90 }, { x: 90, z: 90 }, { x: -90, z: 90 }, { x: -90, z: -90 }], local);
const degree = (city: City, id: string) => city.roads.filter(r => r.a === id || r.b === id).length;

// Independent winding test, rather than relying on the core's containment flags.
function inside(p: Point, polygon: Point[]): boolean {
  let winding = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const side = (b.x - a.x) * (p.z - a.z) - (p.x - a.x) * (b.z - a.z);
    if (a.z <= p.z && b.z > p.z && side > 0) winding++;
    if (a.z > p.z && b.z <= p.z && side < 0) winding--;
  }
  return winding !== 0;
}

test('bounded rectangle face, contained lots, setbacks and nonoverlapping buildings', () => {
  const city = rectangleCity(), blocks = extractBlocks(city);
  assert.equal(blocks.length, 1); assert.equal(blocks[0].area, 180 * 180);
  assert.ok(city.buildings.length > 20);
  for (const parcel of city.parcels) for (const p of parcel.polygon) {
    assert.ok(inside(p, blocks[0].polygon));
    assert.ok(Math.abs(p.x) <= 83 && Math.abs(p.z) <= 83);
  }
  for (const b of city.buildings) {
    const parcel = city.parcels.find(p => p.id === b.parcelId)!;
    for (const x of [b.x - b.width / 2, b.x + b.width / 2]) for (const z of [b.z - b.depth / 2, b.z + b.depth / 2]) assert.ok(inside({ x, z }, parcel.polygon));
    for (const other of city.buildings) if (other.id !== b.id) assert.ok(Math.abs(b.x - other.x) >= (b.width + other.width) / 2 || Math.abs(b.z - other.z) >= (b.depth + other.depth) / 2);
  }
  assert.deepEqual(validateCity(city), city);
});

test('T, four-way, diagonal intersections and endpoint snapping form shared nodes', () => {
  let city = addRoad(createCity('empty'), [{ x: -120, z: 0 }, { x: 120, z: 0 }], local);
  const originalRoad = city.roads[0].id;
  city = addRoad(city, [{ x: 0, z: -100 }, { x: 0, z: -5 }], local);
  let junction = city.nodes.find(n => n.x === 0 && n.z === 0)!;
  assert.ok(junction); assert.equal(degree(city, junction.id), 3);
  assert.equal(city.roads.length, 3); assert.ok(city.roads.some(r => r.id === originalRoad));
  city = addRoad(city, [{ x: 0, z: 4 }, { x: 0, z: 100 }], local);
  junction = city.nodes.find(n => n.x === 0 && n.z === 0)!;
  assert.equal(degree(city, junction.id), 4);
  city = addRoad(city, [{ x: -100, z: -100 }, { x: 100, z: 100 }], local);
  assert.equal(degree(city, junction.id), 6);
  assert.equal(city.nodes.filter(n => len(n, { x: 0, z: 0 }) < 0.01).length, 1);
  assert.deepEqual(validateCity(city), city);
});

test('interior crossings split both roads and preserve untouched IDs', () => {
  let city = addRoad(createCity('empty'), [{ x: -100, z: 0 }, { x: 100, z: 0 }], local);
  city = addRoad(city, [{ x: -200, z: -100 }, { x: -200, z: 100 }], local);
  const untouched = clone(city.roads.find(r => city.nodes.find(n => n.id === r.a)!.x === -200)!);
  city = addRoad(city, [{ x: -50, z: -80 }, { x: 50, z: 80 }], local);
  const junction = city.nodes.find(n => len(n, { x: 0, z: 0 }) < 0.01)!;
  assert.equal(degree(city, junction.id), 4);
  assert.deepEqual(city.roads.find(r => r.id === untouched.id), untouched);
});

test('grade separation does not create connectivity or ground blocks', () => {
  let city = addRoad(createCity('empty'), [{ x: -100, z: 0 }, { x: 100, z: 0 }], local);
  city = addRoad(city, [{ x: 0, z: -100 }, { x: 0, z: 100 }], { ...local, level: 1 });
  assert.equal(city.roads.length, 2); assert.equal(city.nodes.length, 4);
  assert.equal(city.nodes.filter(n => n.x === 0 && n.z === 0).length, 0);
  const ground = getAlignment(city, city.roads.find(r => r.level === 0)!).points;
  const upper = getAlignment(city, city.roads.find(r => r.level === 1)!).points;
  assert.equal(upper[0].y - ground[0].y, 12);
  assert.equal(extractBlocks(city).length, 0);
});

test('collinear extension is supported; overlap and acute corners fail atomically', () => {
  const city = addRoad(createCity('empty'), [{ x: -100, z: 0 }, { x: 0, z: 0 }], local), before = clone(city);
  const extended = addRoad(city, [{ x: 0, z: 0 }, { x: 100, z: 0 }], local);
  assert.equal(extended.roads.length, 2);
  assert.throws(() => addRoad(city, [{ x: -80, z: 0 }, { x: 60, z: 0 }], local), /overlap|duplicate/);
  assert.throws(() => addRoad(city, [{ x: 0, z: 0 }, { x: -100, z: 20 }], local), /25 degrees/);
  assert.deepEqual(city, before);
});

test('bridge decks clear water and every geometric segment respects grade', () => {
  const city = createCity('riverfront');
  const bridges = city.roads.filter(r => getAlignment(city, r).bridge);
  assert.equal(bridges.length, 2);
  for (const road of bridges) {
    const alignment = getAlignment(city, road);
    const a = city.nodes.find(n => n.id === road.a)!, b = city.nodes.find(n => n.id === road.b)!;
    assert.equal(alignment.points[0].y, a.y); assert.equal(alignment.points.at(-1)!.y, b.y);
    let deck: number | undefined, approach = false;
    for (let i = 0; i < alignment.points.length; i++) {
      const p = alignment.points[i];
      if (Math.abs(p.z) <= 40 + 1e-6) {
        assert.ok(p.y >= city.water[0].level + 5 - 1e-6);
        deck ??= p.y; assert.ok(Math.abs(p.y - deck) < 1e-6);
      }
      if (Math.abs(p.z) > 40 && p.y > heightAt(city, p.x, p.z) + 0.1) approach = true;
      if (i) assert.ok(Math.abs(p.y - alignment.points[i - 1].y) / len(p, alignment.points[i - 1]) <= 0.120001);
    }
    assert.ok(approach);
  }
  const emptyRiver = setRiver(createCity('empty'), [{ x: -480, z: 0 }, { x: 480, z: 0 }], 80, -1);
  const before = clone(emptyRiver);
  assert.throws(() => addRoad(emptyRiver, [{ x: 0, z: -45 }, { x: 0, z: 45 }], local), /approach|grade/);
  assert.deepEqual(emptyRiver, before);
});

test('splitting a bridge preserves its continuous profile', () => {
  const city = createCity('riverfront'), bridge = city.roads.find(r => getAlignment(city, r).bridge)!;
  const a = city.nodes.find(n => n.id === bridge.a)!;
  const divided = splitRoad(city, bridge.id, { x: a.x, z: -55 });
  const junction = divided.nodes.find(n => n.x === a.x && n.z === -55)!;
  assert.ok(junction.y > heightAt(divided, junction.x, junction.z));
  for (const road of divided.roads.filter(r => r.a === junction.id || r.b === junction.id)) {
    const points = getAlignment(divided, road).points;
    for (let i = 1; i < points.length; i++) assert.ok(Math.abs(points[i].y - points[i - 1].y) / len(points[i], points[i - 1]) <= 0.120001);
    assert.equal((road.a === junction.id ? points[0] : points.at(-1))!.y, junction.y);
  }
});

test('local IDs and edited overrides survive road splits and disconnected additions', () => {
  let city = rectangleCity();
  const selected = city.buildings[0]; selected.floors = 17; selected.palette = 6; selected.roof = 'terrace'; selected.edited = true;
  city.parcels.find(p => p.id === selected.parcelId)!.zone = 'mixed';
  const original = clone(city), road = city.roads[0];
  city = splitRoad(city, road.id, { x: 0, z: -90 });
  assert.deepEqual(city.parcels, original.parcels); assert.deepEqual(city.buildings, original.buildings);
  city = addRoad(city, [{ x: 250, z: 250 }, { x: 350, z: 250 }], local);
  assert.deepEqual(city.parcels, original.parcels); assert.deepEqual(city.buildings, original.buildings);
  const before = clone(city);
  assert.throws(() => deleteRoad(city, city.roads.find(r => city.nodes.find(n => n.id === r.a)!.x === 90 && city.nodes.find(n => n.id === r.b)!.x === 90)!.id), /override/);
  assert.deepEqual(city, before);
  assert.deepEqual(rebuildCity(city), city);
});

test('zoning changes regenerate unedited buildings and protect edited hosts', () => {
  const city = rectangleCity(), building = city.buildings[0], parcel = city.parcels.find(p => p.id === building.parcelId)!;
  parcel.zone = 'park';
  const park = rebuildCity(city);
  assert.ok(!park.buildings.some(b => b.id === building.id)); assert.equal(park.parcels.find(p => p.id === parcel.id)!.buildingId, undefined);
  building.edited = true;
  assert.throws(() => rebuildCity(city), /override/);
  building.edited = false;
  assert.doesNotThrow(() => rebuildCity(city));
});

test('concave faces never generate lots across the missing notch', () => {
  const polygon = [{ x: -120, z: -120 }, { x: 120, z: -120 }, { x: 120, z: -30 }, { x: -30, z: -30 }, { x: -30, z: 120 }, { x: -120, z: 120 }];
  const city = addRoad(createCity('empty'), [...polygon, polygon[0]], local);
  assert.equal(extractBlocks(city).length, 1); assert.ok(city.parcels.length > 10);
  for (const parcel of city.parcels) {
    for (const p of parcel.polygon) assert.ok(inside(p, polygon));
    assert.ok(parcel.polygon.every(p => p.x < -30) || parcel.polygon.every(p => p.z < -30));
  }
});

test('dead-end roads inside a block do not erase the face or overlap lots', () => {
  const city = addRoad(rectangleCity(), [{ x: 0, z: -90 }, { x: 0, z: 30 }], local);
  assert.equal(extractBlocks(city).length, 1);
  assert.ok(city.parcels.length > 10);
  for (const p of city.parcels) if (p.polygon.some(v => v.z < 30)) assert.ok(p.polygon.every(v => v.x <= -7) || p.polygon.every(v => v.x >= 7) || p.polygon.every(v => v.z > 30));
});

test('moving nodes integrates new crossings and rejects impossible terrain edits', () => {
  let city = addRoad(createCity('empty'), [{ x: -100, z: -100 }, { x: 100, z: -100 }], local);
  city = addRoad(city, [{ x: 0, z: 0 }, { x: 0, z: 120 }], local);
  const node = city.nodes.find(n => n.x === 100 && n.z === -100)!;
  city = moveNode(city, node.id, { x: 100, z: 160 });
  assert.equal(city.nodes.find(n => n.id === node.id)!.z, 160);
  const junction = city.nodes.find(n => Math.abs(n.x) < 1e-6 && Math.abs(n.z - 30) < 1e-6)!;
  assert.equal(degree(city, junction.id), 4);
  const before = clone(city);
  assert.throws(() => sculpt(city, { x: 0, z: 30 }, 40, 60, 'raise'), /grade|approach/);
  assert.deepEqual(city, before);
});

test('terrain interpolation, brush modes and river capsules are deterministic and bounded', () => {
  const empty = createCity('empty'), raised = sculpt(empty, { x: 0, z: 0 }, 120, 4, 'raise');
  assert.equal(heightAt(empty, 0, 0), 1); assert.equal(heightAt(raised, 0, 0), 5); assert.equal(heightAt(raised, 300, 300), 1);
  assert.equal(heightAt(raised, 15, 0), (heightAt(raised, 0, 0) + heightAt(raised, 30, 0)) / 2);
  const lowered = sculpt(raised, { x: 0, z: 0 }, 120, 4, 'lower');
  for (let i = 0; i < empty.terrain.heights.length; i++) assert.ok(Math.abs(lowered.terrain.heights[i] - empty.terrain.heights[i]) < 1e-12);
  assert.equal(heightAt(sculpt(raised, { x: 0, z: 0 }, 120, 1, 'flatten', 3), 0, 0), 3);
  assert.ok(heightAt(sculpt(raised, { x: 0, z: 0 }, 120, 1, 'smooth'), 0, 0) < 5);
  const river = setRiver(empty, [{ x: -100, z: -100 }, { x: 100, z: 100 }], 40, -1);
  assert.equal(isWater(river, 0, 0), true); assert.equal(isWater(river, 0, 40), false); assert.equal(isWater(river, 110, 110), true);
  assert.equal(river.water.length, 1); assert.equal(setRiver(river, [{ x: -200, z: 0 }, { x: 200, z: 0 }], 40, -1).water[0].id, river.water[0].id);
});

test('examples are deterministic, dense, varied and geometrically valid', () => {
  const city = createCity('riverfront');
  assert.ok(city.roads.length >= 100, `${city.roads.length} roads`);
  assert.ok(city.buildings.length >= 300, `${city.buildings.length} buildings`);
  assert.throws(() => addRoad(createCity('empty'), [{ x: -50, z: 0 }, { x: 50, z: 0 }], { ...local, width: 4 }), /at least 8 metres/);
  assert.deepEqual(city, createCity('riverfront')); assert.deepEqual(city, rebuildCity(city));
  assert.ok(new Set(city.buildings.map(b => b.floors)).size >= 8);
  const other = createCity('riverfront', 7);
  assert.deepEqual(city.parcels.map(p => p.id), other.parcels.map(p => p.id));
  assert.notDeepEqual(city.buildings, other.buildings);
  for (const building of city.buildings) assert.ok(Math.abs(building.z) - building.depth / 2 >= 42);
  for (const example of ['hillside', 'garden'] as const) {
    const exampleCity = createCity(example); assert.deepEqual(validateCity(exampleCity), exampleCity);
    assert.ok(Math.max(...exampleCity.terrain.heights) - Math.min(...exampleCity.terrain.heights) > 2);
    assert.ok(exampleCity.parcels.some(p => p.zone === 'park'));
    if (example === 'hillside') {
      assert.ok(exampleCity.parcels.every(p => p.zone === 'residential' || p.zone === 'park'));
      assert.ok(Math.max(...exampleCity.buildings.map(b => b.floors)) <= 10);
      assert.deepEqual(rebuildCity(exampleCity), exampleCity);
    }
  }
  const q = quantities(city), nodes = new Map(city.nodes.map(n => [n.id, n]));
  assert.equal(q.area, 960 ** 2); assert.equal(q.segments, city.roads.length);
  assert.equal(q.roadLength, city.roads.reduce((s, r) => s + len(nodes.get(r.a)!, nodes.get(r.b)!), 0));
  assert.equal(q.floorArea, city.buildings.reduce((s, b) => s + b.width * b.depth * b.floors, 0));
});

test('History snapshots cover terrain, zoning, buildings, river, settings and views', () => {
  const initial = rectangleCity(), history = new History(initial), original = clone(initial);
  initial.name = 'external mutation'; assert.equal(history.current.name, original.name);
  const changed = clone(history.current);
  changed.name = 'Edited'; changed.settings.day = 19; changed.settings.traffic = 0.2;
  changed.views.push({ name: 'Overview', position: [10, 200, 30], target: [0, 1, 0] });
  changed.terrain.heights[0] = 4; changed.water.push({ id: 'remote-water', points: [{ x: 300, z: 300 }, { x: 400, z: 300 }], width: 20, level: -1 });
  const building = changed.buildings[0]; building.edited = true; building.floors = 15;
  changed.parcels.find(p => p.id === building.parcelId)!.zone = 'commercial';
  const expected = clone(changed); history.commit(changed); changed.buildings[0].floors = 70;
  assert.deepEqual(history.current, expected); assert.deepEqual(history.undo(), original);
  const undone = history.undo(); undone.name = 'mutate return'; assert.deepEqual(history.current, original);
  assert.deepEqual(history.redo(), expected); assert.deepEqual(history.redo(), expected);
  history.undo(); history.commit(sculpt(history.current, { x: 300, z: 300 }, 100, 1, 'raise'));
  assert.equal(history.redoStack.length, 0);
  const before = clone(history.current), depth = history.undoStack.length;
  const bad = clone(before); bad.roads[0].a = 'missing';
  assert.throws(() => history.commit(bad)); assert.deepEqual(history.current, before); assert.equal(history.undoStack.length, depth);
});

test('invalid imports reject malformed fields, topology, geometry and references', () => {
  const original = rectangleCity();
  const mutations: ((c: any) => void)[] = [
    c => { c.version = 2; }, c => { c.seed = NaN; }, c => { c.nextId = -1; }, c => { c.terrain.heights.pop(); },
    c => { c.terrain.heights[0] = Infinity; }, c => { delete c.terrain.heights[0]; }, c => { c.nodes[0].x = 5000; }, c => { c.roads[0].b = 'unknown'; },
    c => { c.roads[0].level = 1; }, c => { c.roads[0].width = -1; }, c => { c.roads.push({ ...c.roads[0], id: 'duplicate-edge' }); },
    c => { c.nodes[1].id = c.nodes[0].id; }, c => { c.settings.density = 3; }, c => { c.settings.day = NaN; },
    c => { c.buildings[0].parcelId = 'unknown'; }, c => { c.buildings[0].floors = 1.5; }, c => { c.buildings[0].width = 100; },
    c => { c.parcels[0].polygon[0].x = 300; }, c => { c.parcels[0].blockId = 'missing'; },
    c => { c.views = [{ name: 'bad', position: [1, 2], target: [0, 0, 0] }]; }, c => { c.views = [{ name: 'bad', position: Array(3), target: [0, 0, 0] }]; }, c => { c.water = [{ id: 'water', points: [], width: 20, level: -1 }]; },
  ];
  for (const mutation of mutations) { const invalid = clone(original); mutation(invalid); const before = clone(invalid); assert.throws(() => validateCity(invalid)); assert.deepEqual(invalid, before); }
  for (const invalid of [null, [], {}, 'city', undefined]) assert.throws(() => validateCity(invalid));
  const city = addRoad(createCity('empty'), [{ x: -100, z: 0 }, { x: 100, z: 0 }], local);
  city.nodes.push({ id: 'a', x: 0, z: -100, y: 1, level: 0 }, { id: 'b', x: 0, z: 100, y: 1, level: 0 });
  city.roads.push({ id: 'unconnected', a: 'a', b: 'b', ...local });
  assert.throws(() => validateCity(city), /intersection/);
});

test('hash and random are deterministic and entity-local', () => {
  assert.equal(hash('city'), hash('city')); assert.notEqual(hash('city'), hash('cities'));
  const a = random('parcel-A'), b = random('parcel-A'), unrelated = random('parcel-B');
  for (let i = 0; i < 100; i++) { unrelated(); const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test('elevated river bridges stay level over the water instead of following the bed', () => {
  let city = setRiver(createCity('empty'), [{ x: -480, z: 0 }, { x: 480, z: 0 }], 80, -1);
  city = addRoad(city, [{ x: 0, z: -120 }, { x: 0, z: 120 }], { ...local, level: 1 });
  const points = getAlignment(city, city.roads[0]).points;
  const overWater = points.filter(p => Math.abs(p.z) <= 40);
  assert.ok(overWater.length > 10);
  for (const p of overWater) assert.ok(Math.abs(p.y - 13) < 1e-6);
  for (let i = 1; i < points.length; i++) assert.ok(Math.abs(points[i].y - points[i - 1].y) / len(points[i], points[i - 1]) <= 0.120001);
});

test('unsupported nested faces are rejected atomically rather than filling across holes', () => {
  const city = rectangleCity(), before = clone(city);
  assert.throws(() => addRoad(city, [{ x: -40, z: -40 }, { x: 40, z: -40 }, { x: 40, z: 40 }, { x: -40, z: 40 }, { x: -40, z: -40 }], local), /hole/);
  assert.deepEqual(city, before);
});

test('ordinary ground roads follow an 11% slope and honor stricter acceptance limits', () => {
  const terrain = createCity('empty');
  terrain.terrain.heights = terrain.terrain.heights.map((_, i) => 1 + 0.11 * (i % 33) * 30);
  const points = [{ x: -120, z: 0 }, { x: 120, z: 0 }];
  const city = addRoad(terrain, points, local);
  for (const p of getAlignment(city, city.roads[0]).points) assert.ok(Math.abs(p.y - heightAt(city, p.x, p.z)) < 1e-9);
  assert.throws(() => addRoad(terrain, points, { ...local, maxGrade: 0.105 }), /requested maximum grade/);
  assert.deepEqual(validateCity(JSON.parse(JSON.stringify(city))), city);
  terrain.terrain.heights = terrain.terrain.heights.map((_, i) => 1 + 0.13 * (i % 33) * 30);
  assert.throws(() => addRoad(terrain, points, local), /12% grade/);
});
