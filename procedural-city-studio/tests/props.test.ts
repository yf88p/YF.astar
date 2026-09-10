import assert from 'node:assert/strict';
import test from 'node:test';
import { Color, Group, InstancedMesh, Matrix4 } from 'three';
import { addRoad, clone, createCity, deleteRoad, History, rebuildCity, setRiver, splitRoad, validateCity, type City, type Point, type Prop } from '../src/core/model.ts';
import { CityScene } from '../src/scene.ts';

const local = { profile: 'local' as const, width: 10, level: 0, clearance: 5 };
const riverfront = createCity('riverfront');

// Independent oriented footprints and segment distances, not generator acceptance flags.
function footprint(p: Prop): Point[] {
  const width = p.kind === 'path' ? p.length! : p.kind === 'tree' ? p.size * 1.1 : p.kind === 'bench' ? p.size : 0.24;
  const depth = p.kind === 'path' ? p.size : p.kind === 'bench' ? p.size * 0.3 : width;
  const rotation = p.kind === 'tree' ? 0 : p.rotation;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: p.x + a * width / 2 * Math.cos(rotation) + b * depth / 2 * Math.sin(rotation), z: p.z - a * width / 2 * Math.sin(rotation) + b * depth / 2 * Math.cos(rotation) }));
}

function pointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

function inside(p: Point, polygon: Point[]): boolean {
  let winding = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (pointSegment(p, a, b) < 1e-7) return true;
    const side = (b.x - a.x) * (p.z - a.z) - (p.x - a.x) * (b.z - a.z);
    if (a.z <= p.z && b.z > p.z && side > 0) winding++;
    if (a.z > p.z && b.z <= p.z && side < 0) winding--;
  }
  return winding !== 0;
}

function segmentPolygon(a: Point, b: Point, polygon: Point[]): number {
  if (inside(a, polygon) || inside(b, polygon)) return 0;
  let result = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i], d = polygon[(i + 1) % polygon.length];
    const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return 0;
    result = Math.min(result, pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
  }
  return result;
}

// Separating-axis test for generated rectangular lots and prop bounds.
function overlap(a: Point[], b: Point[]): boolean {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], nx = q.z - p.z, nz = p.x - q.x;
    const aa = a.map(p => p.x * nx + p.z * nz), bb = b.map(p => p.x * nx + p.z * nz);
    if (Math.max(...aa) <= Math.min(...bb) + 1e-7 || Math.max(...bb) <= Math.min(...aa) + 1e-7) return false;
  }
  return true;
}

function checkClearance(city: City): void {
  const nodes = new Map(city.nodes.map(n => [n.id, n])), paths = city.props.filter(p => p.kind === 'path'), benches = city.props.filter(p => p.kind === 'bench');
  for (const prop of city.props) {
    const polygon = footprint(prop);
    for (const p of polygon) assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) <= city.terrain.size / 2 + 1e-7, prop.id);
    if (prop.kind === 'streetlight') {
      const road = city.roads.find(r => r.id === prop.hostId)!;
      assert.ok(road, prop.id);
      const d = pointSegment(prop, nodes.get(road.a)!, nodes.get(road.b)!), walk = Math.min(1.7, road.width * 0.14);
      assert.ok(d >= road.width / 2 - walk + 0.12 - 1e-7 && d <= road.width / 2 - 0.12 + 1e-7, `${prop.id} pole outside sidewalk`);
      for (const r of city.roads) if (r.id !== road.id && r.level === road.level) assert.ok(segmentPolygon(nodes.get(r.a)!, nodes.get(r.b)!, polygon) >= r.width / 2 + 0.2 - 1e-7, `${prop.id} blocks another road`);
      continue; // Bridge lights are intentionally over water, on their road deck.
    }
    for (const road of city.roads) assert.ok(segmentPolygon(nodes.get(road.a)!, nodes.get(road.b)!, polygon) >= road.width / 2 + 2 - 1e-7, `${prop.id} road clearance`);
    for (const water of city.water) for (let i = 1; i < water.points.length; i++) assert.ok(segmentPolygon(water.points[i - 1], water.points[i], polygon) >= water.width / 2 + 2 - 1e-7, `${prop.id} water clearance`);
    for (const building of city.buildings) {
      const box = [{ x: building.x - building.width / 2, z: building.z - building.depth / 2 }, { x: building.x + building.width / 2, z: building.z - building.depth / 2 }, { x: building.x + building.width / 2, z: building.z + building.depth / 2 }, { x: building.x - building.width / 2, z: building.z + building.depth / 2 }];
      assert.ok(!overlap(polygon, box), `${prop.id} building overlap`);
    }
    if (prop.hostId !== 'terrain') {
      const parcel = city.parcels.find(p => p.id === prop.hostId)!;
      assert.ok(parcel && polygon.every(p => inside(p, parcel.polygon)), `${prop.id} host containment`);
    } else if (prop.kind === 'tree') for (const parcel of city.parcels) assert.ok(!overlap(polygon, parcel.polygon), `${prop.id} meadow invades parcel`);
    if (prop.kind !== 'path') for (const path of paths) assert.ok(!overlap(polygon, footprint(path)), `${prop.id} blocks path ${path.id}`);
    if (prop.kind === 'tree') for (const bench of benches) assert.ok(!overlap(polygon, footprint(bench)), `${prop.id} blocks bench ${bench.id}`);
  }
}

test('props are required persistent entities with all four kinds and deterministic regeneration', () => {
  assert.deepEqual(createCity('empty').props, []);
  assert.deepEqual(rebuildCity(createCity('empty')).props, []);
  assert.deepEqual(riverfront.props, createCity('riverfront').props);
  assert.deepEqual(riverfront.props, rebuildCity(riverfront).props);
  assert.deepEqual(validateCity(JSON.parse(JSON.stringify(riverfront))).props, riverfront.props);
  assert.equal(new Set(riverfront.props.map(p => p.id)).size, riverfront.props.length);
  for (const kind of ['tree', 'bench', 'path', 'streetlight']) assert.ok(riverfront.props.filter(p => p.kind === kind).length > 30, kind);
  assert.ok(riverfront.props.some(p => p.kind === 'streetlight' && Math.abs(p.z) < 40), 'bridge deck has persistent lights');
  const changed = clone(riverfront); changed.props[0].rotation = 1; changed.props.pop();
  assert.deepEqual(rebuildCity(changed).props, riverfront.props, 'generated props are replaced, not edited overrides');
});

test('all examples independently clear infrastructure, buildings, garden paths and bench footprints', () => {
  for (const city of [riverfront, createCity('hillside'), createCity('garden')]) checkClearance(city);
});

test('diagonal roads, bent river banks and boundary roads also clear prop footprints', () => {
  let city = setRiver(createCity('empty', 7), [{ x: -430, z: -110 }, { x: 0, z: -30 }, { x: 430, z: 120 }], 45, -1);
  city = addRoad(city, [{ x: -320, z: 140 }, { x: -120, z: 310 }, { x: 180, z: 290 }], local);
  city = addRoad(city, [{ x: 480, z: 250 }, { x: 480, z: 400 }], local);
  checkClearance(city);
  const retraced = setRiver(createCity('empty'), [{ x: -100, z: 0 }, { x: 100, z: 0 }, { x: -100, z: 0 }], 20, -1);
  assert.doesNotThrow(() => validateCity(retraced)); checkClearance(retraced);
});

test('unrelated edits and array reordering preserve local placements; seed changes tree choices', () => {
  const original = addRoad(createCity('empty'), [{ x: -90, z: -90 }, { x: 90, z: -90 }, { x: 90, z: 90 }, { x: -90, z: 90 }, { x: -90, z: -90 }], local);
  const added = addRoad(original, [{ x: 250, z: 250 }, { x: 350, z: 250 }], local);
  const localProps = (c: City) => c.props.filter(p => p.hostId !== 'terrain' && original.props.some(q => q.id === p.id));
  assert.deepEqual(localProps(added), localProps(original));
  const reordered = clone(original); reordered.roads.reverse(); reordered.nodes.reverse(); reordered.parcels.reverse(); reordered.buildings.reverse(); reordered.props.reverse();
  assert.deepEqual(rebuildCity(reordered).props, original.props);
  const reseeded = clone(original); reseeded.seed++;
  assert.notDeepEqual(rebuildCity(reseeded).props.filter(p => p.kind === 'tree'), original.props.filter(p => p.kind === 'tree'));
  const longId = clone(original); longId.roads[0].id = 'r'.repeat(160);
  assert.doesNotThrow(() => validateCity(rebuildCity(longId)), 'full-length host IDs still produce valid prop IDs');
});

test('road splits/deletions and zoning refresh derived hosts before validation, and History restores props', () => {
  let city = addRoad(createCity('empty'), [{ x: -90, z: -90 }, { x: 90, z: -90 }, { x: 90, z: 90 }, { x: -90, z: 90 }, { x: -90, z: -90 }], local);
  const history = new History(city), initial = clone(city);
  const road = city.roads[0];
  city = splitRoad(city, road.id, { x: 0, z: -90 });
  history.commit(city);
  assert.deepEqual(history.undo(), initial); assert.deepEqual(history.redo(), city);
  city = deleteRoad(city, city.roads.find(r => r.id !== road.id)!.id);
  assert.doesNotThrow(() => validateCity(city));
  assert.ok(!city.props.some(p => p.hostId.startsWith('parcel-')));
  const zoned = clone(initial), parcel = zoned.parcels.find(p => p.buildingId)!;
  parcel.zone = 'park';
  const park = rebuildCity(zoned);
  assert.ok(park.props.some(p => p.hostId === parcel.id && p.kind === 'path'));
  assert.ok(!park.buildings.some(b => b.parcelId === parcel.id));
  assert.doesNotThrow(() => rebuildCity({ ...initial, props: [{ ...initial.props[0], hostId: 'removed-host' }] }));
});

test('invalid prop shape, dimensions, IDs and derived references reject atomically', () => {
  const source = addRoad(createCity('empty'), [{ x: -90, z: -90 }, { x: 90, z: -90 }, { x: 90, z: 90 }, { x: -90, z: 90 }, { x: -90, z: -90 }], local);
  const mutations: ((c: any) => void)[] = [
    c => { delete c.props; }, c => { c.props = {}; }, c => { c.props[0] = null; }, c => { delete c.props[0]; },
    c => { c.props[0].id = c.roads[0].id; }, c => { c.props.push(clone(c.props[0])); },
    c => { c.props[0].kind = 'car'; }, c => { c.props[0].hostId = ''; }, c => { c.props[0].hostId = 'missing'; },
    c => { c.props[0].x = NaN; }, c => { c.props[0].z = Infinity; }, c => { c.props[0].x = 480; },
    c => { c.props[0].size = -1; }, c => { c.props[0].size = Infinity; }, c => { c.props[0].rotation = NaN; },
    c => { c.props.find((p: Prop) => p.kind === 'path').length = 0; }, c => { delete c.props.find((p: Prop) => p.kind === 'path').length; },
    c => { c.props.find((p: Prop) => p.kind === 'tree').length = 10; },
    c => { c.props.find((p: Prop) => p.kind === 'streetlight').hostId = 'terrain'; },
    c => { const p = c.props.find((p: Prop) => p.kind === 'streetlight'); p.x = 0; p.z = -90; },
  ];
  for (const mutate of mutations) {
    const invalid = clone(source); mutate(invalid); const before = clone(invalid);
    assert.throws(() => validateCity(invalid)); assert.deepEqual(invalid, before);
  }
  const malformed = clone(source); malformed.props[0].size = NaN;
  assert.throws(() => rebuildCity(malformed), /prop/);
});

test('live signal snapshots reuse buffers, update colors/positions, clear and dispose on growth', () => {
  // These public scene controls need no WebGL context; inspect their actual Three meshes.
  const scene = Object.create(CityScene.prototype) as CityScene;
  const signals = new Group(); signals.visible = false;
  const editor = new Group(); editor.add(signals);
  Object.assign(scene, { editor, overlays: { signals }, localMatrix: new Matrix4(), color: new Color() });
  scene.setSignals([]); assert.equal(signals.children.length, 0);
  scene.setSignals([{ x: 1, y: 12.5, z: 3, state: 'red' }, { x: 4, y: 1, z: 6, state: 'green' }]);
  const mesh = signals.children[0] as InstancedMesh, matrix = new Matrix4(), color = new Color();
  assert.equal(mesh.count, 2); assert.equal(signals.visible, false);
  mesh.getMatrixAt(0, matrix); assert.deepEqual(matrix.elements.slice(12, 15), [1, 12.5, 3]);
  mesh.getColorAt(0, color); assert.equal(color.getHex(), 0xf16f61);
  mesh.getColorAt(1, color); assert.equal(color.getHex(), 0x75e9ac);
  const attribute = mesh.instanceMatrix, colors = mesh.instanceColor;
  scene.setSignals([{ x: 8, y: 2, z: -3, state: 'green' }]);
  assert.equal(signals.children[0], mesh); assert.equal(mesh.instanceMatrix, attribute); assert.equal(mesh.instanceColor, colors);
  assert.equal(mesh.count, 1); mesh.getColorAt(0, color); assert.equal(color.getHex(), 0x75e9ac);
  assert.throws(() => scene.setSignals([{ x: NaN, y: 1, z: 0, state: 'red' }])); assert.equal(mesh.count, 1);
  scene.setOverlay('signals', true); scene.setPresentation(true);
  assert.equal(editor.visible, false); assert.equal(signals.visible, true);
  scene.setSignals([]); assert.equal(mesh.count, 0); assert.equal(signals.children[0], mesh);
  scene.setPresentation(false); assert.equal(editor.visible, true); assert.equal(signals.visible, true);
  let disposed = 0;
  mesh.addEventListener('dispose', () => disposed++); mesh.geometry.addEventListener('dispose', () => disposed++);
  scene.setSignals(Array.from({ length: 65 }, (_, x) => ({ x, y: 1, z: 0, state: 'red' as const })));
  assert.equal(disposed, 2); assert.equal(signals.children.length, 1); assert.notEqual(signals.children[0], mesh);
  const replacement = signals.children[0] as InstancedMesh;
  replacement.dispose(); replacement.geometry.dispose(); (replacement.material as { dispose(): void }).dispose();
});
