import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALS, LIMITS, createObject, createProject, validateProject } from '../src/core/model.js';
import { partitionObject } from '../src/core/geometry.js';
import { initPhysics, Simulation } from '../src/core/simulation.js';
import { Recorder, validateTake } from '../src/core/replay.js';

before(async () => { await initPhysics(); });
const copy = x => structuredClone(x);
const plus = (a, b) => a.map((v, i) => v + b[i]);
const minus = (a, b) => a.map((v, i) => v - b[i]);
const times = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const array = v => [v.x, v.y, v.z];
function near(actual, expected, tolerance = 1e-5) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`); }
function nearVector(actual, expected, tolerance = 1e-5) { actual.forEach((v, i) => near(v, expected[i], tolerance)); }
function projectWith(...objects) { const p = createProject('blank'); p.objects = objects; p.settings.gravity = 0; return p; }
function projectile(overrides = {}) { return { id: 'shot', type: 'projectile', position: [0, 2, 2], direction: [0, 0, -1], radius: 0.05, mass: 2, speed: 100, time: 0, magnitude: 0, ...overrides }; }
function run(sim, ticks) { for (let i = 0; i < ticks; i++) sim.step(); return sim.snapshot(); }

// Independent signed tetrahedra, not the polygon shoelace routine used by geometry.
function meshIntegral(fragment) {
  const v = fragment.vertices, indices = fragment.indices;
  let volume = 0, moment = [0, 0, 0];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(index => v.slice(index * 3, index * 3 + 3));
    const tetra = dot(a, cross(b, c)) / 6;
    volume += tetra; moment = plus(moment, times(plus(plus(a, b), c), tetra / 4));
  }
  return { volume, center: times(moment, 1 / volume) };
}

test('seeded partitions fill exact dimensions, COM, mass and count for all materials', () => {
  for (const material of Object.keys(MATERIALS)) for (const density of [1, 7, 48, 600]) {
    const object = createObject(material, { id: 'specimen', size: [2.7, 1.3, 0.42], density, seed: 8910 });
    const geometry = partitionObject(object);
    assert.deepEqual(geometry, partitionObject(copy(object)));
    assert.equal(geometry.fragments.length, density);
    let volume = 0, mass = 0, firstMoment = [0, 0, 0];
    for (const f of geometry.fragments) {
      const independent = meshIntegral(f);
      assert.ok(f.volume > 0); near(independent.volume, f.volume, 1e-9); nearVector(independent.center, [0, 0, 0], 1e-8);
      near(f.mass, independent.volume * MATERIALS[material].density, 1e-6);
      assert.equal(f.exterior.length, f.indices.length / 3);
      for (let i = 0; i < f.vertices.length; i++) assert.ok(Math.abs(f.vertices[i] + f.center[i % 3]) <= object.size[i % 3] / 2 + 1e-9);
      volume += independent.volume; mass += f.mass; firstMoment = plus(firstMoment, times(f.center, f.volume));
    }
    const expected = object.size.reduce((a, b) => a * b);
    near(volume, expected, 1e-8); near(mass, expected * MATERIALS[material].density, 1e-5); nearVector(firstMoment, [0, 0, 0], 1e-8);
    assert.ok(Math.abs(mass - expected * MATERIALS[material].density) / (expected * MATERIALS[material].density) <= 1e-5, 'generated fragment mass relative error <= 0.00001');
    const visited = new Set([geometry.fragments[0].id]);
    for (let i = 0; i < density; i++) for (const b of geometry.bonds) {
      assert.ok(b.area > 0 && b.threshold > 0 && b.toughness > 0);
      if (visited.has(b.a)) visited.add(b.b); if (visited.has(b.b)) visited.add(b.a);
    }
    assert.equal(visited.size, density, 'all adjacent fragments form one intact component');
  }
});

test('Voronoi cells have independent single coverage and seeds change the partition', () => {
  const object = createObject('concrete', { id: 'coverage', size: [2.3, 1.7, 0.65], density: 36 });
  const { fragments } = partitionObject(object);
  assert.notDeepEqual(fragments, partitionObject({ ...object, seed: 987 }).fragments);
  for (let ix = 0; ix < 17; ix++) for (let iy = 0; iy < 13; iy++) for (let iz = 0; iz < 7; iz++) {
    const point = [(ix + 0.371) / 17 * 2.3 - 1.15, (iy + 0.219) / 13 * 1.7 - 0.85, (iz + 0.411) / 7 * 0.65 - 0.325];
    let count = 0;
    for (const f of fragments) {
      const p = minus(point, f.center), n = f.vertices.length / 6;
      if (Math.abs(p[2]) > Math.abs(f.vertices[2])) continue;
      let inside = true;
      for (let i = 0; i < n; i++) {
        const a = f.vertices.slice(i * 3, i * 3 + 3), b = f.vertices.slice(((i + 1) % n) * 3, ((i + 1) % n) * 3 + 3);
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < -1e-10) { inside = false; break; }
      }
      if (inside) count++;
    }
    assert.equal(count, 1, `single coverage at ${point}`);
  }
});

test('default placements clear the floor and the storefront is a physical editable frame', () => {
  const rotated = createObject('timber', { rotation: [0.3, 0.6, 0.8] });
  assert.ok(rotated.position[1] > 0.5);
  for (const example of ['blank', 'range', 'structure', 'storefront']) assert.doesNotThrow(() => validateProject(createProject(example)));
  const p = createProject('storefront'); p.impacts = [];
  assert.equal(p.objects.filter(o => o.material === 'steel' && o.fixed).length, 4);
  const sim = new Simulation(p);
  try { const state = run(sim, 120); assert.equal(state.stats.broken, 0, 'unstruck storefront must not spontaneously collapse'); assert.equal(state.stats.components, 1); }
  finally { sim.dispose(); }
});

test('validation rejects invalid entire projects before mutation or Rapier allocation', () => {
  const base = createProject();
  const changes = [
    p => { p.version = 2; }, p => { p.objects[0].position[0] = NaN; }, p => { p.objects[0].density = 1.5; },
    p => { p.objects[0].density = 600; }, p => { p.objects[0].size[1] = -1; }, p => { p.objects[0].fixed = 'yes'; },
    p => { p.objects[0].seed = Infinity; }, p => { p.objects[1].id = p.objects[0].id; },
    p => { p.connections[0].a = 'missing'; }, p => { p.connections[0].b = p.connections[0].a; },
    p => { p.connections[0].id = 'bond:0:1'; },
    p => { p.materials.steel.friction = NaN; }, p => { p.materials.glass.toughness = 0; },
    p => { delete p.materials.timber; }, p => { p.materials.glass.color = 'not-a-color'; },
    p => { p.impacts[0].direction = [0, 0, 0]; }, p => { p.impacts[0].speed = 101; },
    p => { p.impacts[0].radius = 0.01; }, p => { p.impacts[0].time = 12; }, p => { p.settings.solverIterations = 0; },
    p => { p.materials.steel.extra = { hidden: NaN }; }, p => { p.self = p; },
    p => { p.objects[0].position = new Array(3); },
  ];
  for (const change of changes) {
    const invalid = copy(base); change(invalid); const before = copy(invalid);
    assert.throws(() => validateProject(invalid), /\S+: /); assert.deepEqual(invalid, before);
    assert.throws(() => new Simulation(invalid)); assert.deepEqual(invalid, before);
  }
  const normalized = validateProject(base); normalized.objects[0].position[0] = 99;
  assert.notEqual(base.objects[0].position[0], 99);
});

test('local support removal preserves remote support and graph bonds, then free bodies fall', () => {
  const left = createObject('steel', { id: 'left', density: 2, size: [0.2, 2, 0.2], position: [-2, 3, 0], fixed: true });
  const right = createObject('steel', { id: 'right', density: 2, size: [0.2, 2, 0.2], position: [2, 1, 0], fixed: true });
  const sim = new Simulation({ ...projectWith(left, right), settings: { gravity: 9.81, solverIterations: 6 } });
  try {
    const before = sim.snapshot(); assert.equal(sim.removeSupport('left'), true); assert.equal(sim.removeSupport('left'), false);
    assert.deepEqual(sim.snapshot().bonds, before.bonds); assert.equal(sim.snapshot().stats.released, 2);
    const next = run(sim, 4); assert.ok(next.fragments.find(f => f.id === 'left:1').velocity[1] < 0);
    nearVector(next.fragments.find(f => f.id === 'right:1').position, before.fragments.find(f => f.id === 'right:1').position);
    assert.equal(next.supports.find(s => s.objectId === 'right').active, true);
    assert.throws(() => sim.removeSupport('unknown'), /Unknown/);
  } finally { sim.dispose(); }
});

test('explicit connections keep a beam attached to the remaining local support', () => {
  const p = projectWith(
    createObject('steel', { id: 'left', density: 1, position: [-2, 2, 0], size: [0.2, 4, 0.2], fixed: true }),
    createObject('steel', { id: 'right', density: 1, position: [2, 2, 0], size: [0.2, 4, 0.2], fixed: true }),
    createObject('timber', { id: 'beam', density: 8, position: [0, 4.15, 0], size: [4, 0.3, 0.3] }),
  );
  p.connections = [{ id: 'left-beam', a: 'left', b: 'beam' }, { id: 'right-beam', a: 'right', b: 'beam' }];
  const sim = new Simulation(p);
  try {
    assert.equal(sim.snapshot().stats.components, 1); sim.removeSupport('left');
    assert.equal(sim.snapshot().stats.released, 0); assert.equal(sim.snapshot().stats.broken, 0);
    sim.removeSupport('right'); assert.equal(sim.snapshot().stats.released, 10); assert.equal(sim.snapshot().stats.components, 1);
  } finally { sim.dispose(); }
});

test('gravity fatigue loads an unsupported span without arbitrary remote failure', () => {
  const p = projectWith(
    createObject('timber', { id: 'cantilever', density: 8, size: [4, 0.2, 0.2], position: [0, 3, 0], fixed: true }),
    createObject('steel', { id: 'remote', density: 4, size: [0.4, 2, 0.4], position: [6, 1, 0], fixed: true }),
  );
  p.settings.gravity = 9.81; p.materials.timber.threshold = 1e5;
  const sim = new Simulation(p);
  try {
    const snapshot = run(sim, 30);
    assert.ok(snapshot.bonds.some(b => b.id.startsWith('cantilever:') && b.broken));
    assert.ok(snapshot.bonds.filter(b => b.id.startsWith('remote:')).every(b => !b.broken && b.damage === 0));
    assert.ok(snapshot.stats.released > 0);
  } finally { sim.dispose(); }
});

test('removing one pier changes the gravity path and only subsequently fails the overloaded span', () => {
  const p = projectWith(
    createObject('steel', { id: 'left', density: 1, size: [0.2, 2, 0.2], position: [-2, 1, 0], fixed: true }),
    createObject('steel', { id: 'right', density: 1, size: [0.2, 2, 0.2], position: [2, 1, 0], fixed: true }),
    createObject('timber', { id: 'span', density: 8, size: [4, 0.3, 0.3], position: [0, 2.15, 0] }),
  );
  p.connections = [{ id: 'left', a: 'left', b: 'span' }, { id: 'right', a: 'right', b: 'span' }]; p.settings.gravity = 9.81;
  const sim = new Simulation(p);
  try {
    assert.equal(run(sim, 120).stats.broken, 0); sim.removeSupport('left');
    assert.equal(sim.snapshot().stats.broken, 0); assert.equal(sim.snapshot().stats.released, 0);
    const after = run(sim, 120); assert.ok(after.stats.broken > 0); assert.ok(after.stats.released > 0);
    assert.equal(after.fragments.find(f => f.id === 'right:0').released, false);
  } finally { sim.dispose(); }
});

test('timber has directional bond capacity; steel accumulates visible yield before failure', () => {
  const timber = partitionObject(createObject('timber', { size: [2, 1, 0.4], density: 32 }));
  assert.ok(timber.bonds.some(b => b.grainFactor === 1)); assert.ok(timber.bonds.some(b => b.grainFactor === MATERIALS.timber.grainStrength));
  for (const material of ['steel', 'glass']) {
    const sim = new Simulation(projectWith(createObject(material, { id: 'bar', size: [1, 0.1, 0.1], density: 2, position: [0, 2, 0], fixed: true })));
    try {
      const point = sim.snapshot().fragments[1].position;
      const initial = sim.snapshot(); assert.throws(() => sim.applyImpulse(new Array(3), [0, 0, 1], 180), /finite/); assert.deepEqual(sim.snapshot(), initial);
      assert.equal(sim.applyImpulse([99, 99, 99], [0, 0, 1], 180), false);
      assert.equal(sim.applyImpulse(point, [0, 0, 1], 180), true);
      if (material === 'steel') {
        assert.equal(sim.bonds[0].broken, false); assert.equal(sim.bonds[0].yielded, true);
        const damage = sim.bonds[0].damage; sim.applyImpulse(point, [0, 0, 1], 180);
        assert.ok(sim.bonds[0].damage > damage); assert.equal(sim.bonds[0].broken, false);
        sim.applyImpulse(point, [0, 0, 1], 180); assert.equal(sim.bonds[0].broken, true);
      } else assert.equal(sim.bonds[0].broken, true);
    } finally { sim.dispose(); }
  }
});

test('split inherits v + omega cross r and conserves linear/angular momentum about one origin', () => {
  const sim = new Simulation(projectWith(createObject('timber', { id: 'moving', size: [2, 0.4, 0.6], density: 2, position: [1, 5, 2] })));
  try {
    const body = sim.components[0].body, v = [2, -1, 3], w = [0.4, 0.5, 0.6], center = array(body.worldCom()), mass = body.mass();
    body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true); body.setAngvel({ x: w[0], y: w[1], z: w[2] }, true);
    const size = [2, 0.4, 0.6];
    const inertia = size.map((_, i) => mass * (size[(i + 1) % 3] ** 2 + size[(i + 2) % 3] ** 2) / 12);
    const linearBefore = times(v, mass), angularBefore = plus(inertia.map((n, i) => n * w[i]), cross(center, linearBefore));
    // Isolate only graph rebuilding, without gravity/contact or an extra fracture impulse.
    sim.bonds[0].broken = true; sim.bonds[0].damage = 1; sim._rebuildComponents();
    let linear = [0, 0, 0], angular = [0, 0, 0];
    for (const component of sim.components) {
      const c = array(component.body.worldCom()), velocity = array(component.body.linvel()), m = component.body.mass();
      nearVector(velocity, plus(v, cross(w, minus(c, center))), 1e-5); nearVector(array(component.body.angvel()), w, 1e-6);
      const p = times(velocity, m), dimensions = [1, 0.4, 0.6];
      const localInertia = dimensions.map((_, i) => m * (dimensions[(i + 1) % 3] ** 2 + dimensions[(i + 2) % 3] ** 2) / 12);
      linear = plus(linear, p); angular = plus(angular, plus(localInertia.map((n, i) => n * w[i]), cross(c, p)));
    }
    nearVector(linear, linearBefore, 2e-4); nearVector(angular, angularBefore, 2e-3);
    linear.forEach((v, i) => near(v, linearBefore[i], 2e-4 + 1e-6 * Math.abs(linearBefore[i])));
    angular.forEach((v, i) => near(v, angularBefore[i], 2e-3 + 1e-6 * Math.abs(angularBefore[i])));
  } finally { sim.dispose(); }
});

test('independent analytic sphere/wall restitution and impulse use actual Rapier contact', () => {
  const p = projectWith(createObject('steel', { id: 'wall', size: [2, 2, 0.01], position: [0, 2, 0], density: 1, fixed: true }));
  p.materials.steel.restitution = 0.65; p.impacts = [projectile({ speed: 20, mass: 3 })];
  const sim = new Simulation(p);
  try {
    const events = []; for (let i = 0; i < 30; i++) events.push(...sim.step().events);
    const contact = events.find(e => e.type === 'contact' && (e.a === 'shot' || e.b === 'shot'));
    assert.ok(contact, 'a real contact impulse is recorded');
    near(sim.snapshot().projectiles[0].velocity[2], 0.65 * 20, 0.05);
    near(contact.impulse, 3 * (1 + 0.65) * 20, 0.05);
    near(contact.point[2], 0.005, 0.002);
  } finally { sim.dispose(); }
});

test('a dynamic contact is solved before fracture and the split retains collision momentum', () => {
  const p = projectWith(createObject('steel', { id: 'target', size: [2, 2, 0.02], position: [0, 2, 0], density: 2 }));
  p.materials.steel.threshold = 1; p.materials.steel.toughness = 0.001;
  p.impacts = [projectile({ position: [0.3, 2.2, 2], mass: 3 })];
  const sim = new Simulation(p);
  try {
    let state;
    for (let i = 0; i < 12; i++) { state = sim.step(); if (state.stats.broken) break; }
    assert.equal(state.stats.broken, 1); assert.equal(state.stats.components, 2);
    const contactIndex = state.events.findIndex(e => e.type === 'contact'), breakIndex = state.events.findIndex(e => e.type === 'break');
    assert.ok(contactIndex >= 0 && breakIndex > contactIndex);
    let momentum = times(state.projectiles[0].velocity, 3);
    for (const f of state.fragments) momentum = plus(momentum, times(f.velocity, sim.fragmentMap.get(f.id).mass));
    nearVector(momentum, [0, 0, -300], 0.01);
    const [a, b] = state.fragments;
    nearVector(minus(b.velocity, a.velocity), cross(a.angularVelocity, minus(b.position, a.position)), 1e-5);
    nearVector(a.angularVelocity, b.angularVelocity, 1e-6);
  } finally { sim.dispose(); }
});

test('CCD detects thin-panel contacts and local damage across the allowed speed/radius range, not beyond it', () => {
  for (const speed of [10, 50, 100]) for (const radius of [0.05, 0.5]) for (const miss of [false, true]) {
    const p = projectWith(createObject('glass', { id: 'pane', density: 24, size: [2, 2, 0.005], position: [0, 2, 0], fixed: true }));
    p.impacts = [projectile({ position: [miss ? 1 + radius + 0.1 : 0, 2, 2], speed, radius })];
    const sim = new Simulation(p);
    try {
      const events = []; for (let i = 0; i < Math.ceil(3 / speed / LIMITS.dt) + 6; i++) events.push(...sim.step().events);
      const hits = events.filter(e => e.type === 'contact' && (e.a === 'shot' || e.b === 'shot'));
      if (miss) { assert.equal(hits.length, 0); assert.equal(sim.snapshot().stats.broken, 0); }
      else { assert.ok(hits.length > 0, `contact at ${speed} m/s, radius ${radius}`); assert.ok(sim.snapshot().stats.broken > 0); assert.ok(hits.every(e => Math.abs(e.point[0]) < 1.01)); }
    } finally { sim.dispose(); }
  }
});

test('fresh swept convex queries release supported brittle components without injecting motion or removing volume', () => {
  for (const material of ['glass', 'concrete']) {
    const p = projectWith(createObject(material, { id: 'pane', size: [1.35, 2.4, 0.04], position: [0, 3, 0], density: 24, fixed: true }));
    p.impacts = [projectile({ position: [0, 3, 0.2], speed: 28, mass: 8, radius: 0.16 })];
    const sim = new Simulation(p);
    try {
      // Neither initial collider creation nor spawning has had a broadphase update.
      sim._spawn(p.impacts[0]); const before = sim.snapshot(); sim._sweptImpacts(); const after = sim.snapshot();
      assert.equal(after.tick, 0); assert.ok(after.stats.released > 0); assert.ok(after.stats.broken > 0);
      assert.deepEqual(after.projectiles[0].position, before.projectiles[0].position);
      assert.deepEqual(after.projectiles[0].velocity, before.projectiles[0].velocity);
      near(after.stats.mass, before.stats.mass); assert.equal(sim.world.colliders.len(), sim.fragments.length + 2);
      after.fragments.forEach((f, i) => { nearVector(f.position, before.fragments[i].position, 1e-6); nearVector(f.velocity, [0, 0, 0]); nearVector(f.angularVelocity, [0, 0, 0]); });
      assert.ok(sim.fragments.every(f => f.mass > 0 && f.volume > 0 && f.collider.isValid()));
      const predicted = after.events.find(e => e.type === 'swept-impact');
      assert.ok(predicted.released && predicted.damageWork > 0); assert.ok(predicted.timeOfImpact <= LIMITS.dt);
      near(predicted.point[2], 0.02, 0.001); assert.ok(predicted.damageWork <= 0.35 * predicted.energy);
      const state = copy(after.bonds); sim._sweptImpacts(); assert.deepEqual(sim.snapshot().bonds, state);
      assert.equal(sim.snapshot().events.filter(e => e.type === 'swept-impact').length, 1);
    } finally { sim.dispose(); }
  }
});

test('the unchanged default storefront shot exits behind glass with actual contacts and moving volumetric shards', () => {
  const p = createProject('storefront'), sim = new Simulation(p), recorder = new Recorder(sim);
  try {
    const shot = p.impacts[0]; assert.equal(shot.speed, 28); assert.equal(shot.mass, 8); assert.equal(shot.radius, 0.16); assert.equal(shot.position[2], 5);
    const events = []; let crossed;
    for (let i = 0; i < 120; i++) {
      const state = sim.step(); recorder.capture(state); events.push(...state.events);
      if (!crossed && state.projectiles[0]?.position[2] + shot.radius < -0.012 / 2) crossed = state;
    }
    assert.ok(crossed, 'the complete sphere passes the back glass face'); assert.ok(crossed.projectiles[0].velocity[2] < -1);
    const prediction = events.find(e => e.type === 'swept-impact');
    const contact = events.find(e => e.type === 'contact' && (e.a === shot.id || e.b === shot.id));
    assert.ok(prediction?.released); assert.ok(contact?.impulse > 0); assert.ok(prediction.tick < contact.tick);
    assert.equal(contact.predicted, true); assert.equal(contact.damageWork, 0);
    assert.ok(crossed.fragments.filter(f => f.released && f.velocity[2] < -1).length >= 2);
    assert.ok(sim.fragments.every(f => f.mass > 0 && f.vertices.length >= 18 && f.collider.isValid()));
    const pairs = events.filter(e => e.type === 'swept-impact').map(e => `${e.projectileId}/${e.fragmentId}`);
    assert.equal(new Set(pairs).size, pairs.length);
    const work = events.filter(e => e.projectileId === shot.id || e.a === shot.id || e.b === shot.id).reduce((sum, e) => sum + (e.damageWork ?? 0), 0);
    const final = sim.snapshot().projectiles[0]; near(final.damageSpent, work, 1e-6); assert.ok(work > 0 && work <= 0.35 * 0.5 * shot.mass * shot.speed ** 2);
    const loaded = Recorder.fromJSON(recorder.serialize(p));
    assert.deepEqual(loaded.sample(crossed.time).projectiles, crossed.projectiles);
    const bad = recorder.serialize(p); bad.frames.at(-1).projectiles[0].damageSpent = final.damageBudget + 1;
    assert.throws(() => Recorder.fromJSON(bad), /damageSpent/);
  } finally { sim.dispose(); }
});

test('rotated arbitrary hit points select actual convex surfaces, while near misses and nearer steel block prediction', () => {
  const angle = 0.41, c = Math.cos(angle), s = Math.sin(angle), normal = [s, 0, c], hits = [];
  for (const [x, y, miss] of [[-0.45, -0.28, false], [0.42, 0.31, false], [1.2, 0, true]]) {
    const target = plus([0.4, 3, -0.6], [c * x + s * 0.02, y, -s * x + c * 0.02]);
    const p = projectWith(createObject('glass', { id: 'rotated', size: [2, 2, 0.04], density: 24, rotation: [0, angle, 0], position: [0.4, 3, -0.6], fixed: true }));
    p.impacts = [projectile({ position: plus(target, normal), direction: times(normal, -1), speed: 28, radius: 0.16, mass: 8 })];
    const sim = new Simulation(p);
    try {
      const events = []; for (let i = 0; i < 18; i++) events.push(...sim.step().events);
      const event = events.find(e => e.type === 'swept-impact');
      if (miss) { assert.equal(event, undefined); assert.equal(sim.snapshot().stats.broken, 0); assert.equal(sim.snapshot().stats.contacts, 0); }
      else { assert.ok(event?.damageWork > 0); nearVector(event.point, target, 0.004); nearVector(event.normal, normal, 0.003); hits.push(event.fragmentId); }
    } finally { sim.dispose(); }
  }
  assert.notEqual(hits[0], hits[1]);
  const p = projectWith(
    createObject('glass', { id: 'glass', size: [2, 2, 0.04], density: 24, position: [0, 3, 0], fixed: true }),
    createObject('steel', { id: 'shield', size: [2, 2, 0.04], density: 1, position: [0, 3, 0.3], fixed: true }),
  );
  p.impacts = [projectile({ position: [0, 3, 0.6], speed: 100, radius: 0.16, mass: 8 })];
  const sim = new Simulation(p);
  try {
    const events = []; for (let i = 0; i < 12; i++) events.push(...sim.step().events);
    assert.ok(events.some(e => e.type === 'contact')); assert.ok(!events.some(e => e.type === 'swept-impact'));
    assert.ok(sim.bonds.every(b => b.damage === 0));
  } finally { sim.dispose(); }
});

test('subcritical slow brittle contacts neither fracture nor repeatedly consume an incident energy budget', () => {
  for (const material of ['glass', 'concrete']) for (const speed of [0.25, 1]) {
    const p = projectWith(createObject(material, { id: 'pane', size: [1.35, 2.4, 0.04], position: [0, 2, 0], density: 24, fixed: true }));
    p.impacts = [projectile({ position: [0, 2, 0.3], speed, radius: 0.16, mass: 8 })];
    const sim = new Simulation(p);
    try {
      const events = []; for (let i = 0; i < 200; i++) events.push(...sim.step().events);
      assert.ok(events.some(e => e.type === 'contact')); assert.equal(events.filter(e => e.type === 'swept-impact').length, 1);
      assert.ok(sim.bonds.every(b => b.damage === 0)); assert.equal(sim.snapshot().projectiles[0].damageSpent, 0);
    } finally { sim.dispose(); }
  }
});

test('range compares all four materials with identical dimensions, segmentation count and simultaneous identical shots', () => {
  const p = createProject('range'); assert.equal(p.impacts.length, 4);
  p.objects.forEach(o => { assert.deepEqual(o.size, [1.35, 2.4, 0.04]); assert.equal(o.density, 24); });
  const { id: ignoredId, position: ignoredPosition, ...settings } = p.impacts[0];
  p.impacts.forEach((impact, i) => {
    const { id, position, ...rest } = impact; assert.deepEqual(rest, settings);
    assert.equal(position[0], p.objects[i].position[0]); assert.equal(position[1], 1.8); assert.equal(position[2], 5);
  });
  const sim = new Simulation(p);
  try {
    const events = []; for (let i = 0; i < 100; i++) events.push(...sim.step().events);
    for (const impact of p.impacts) assert.ok(events.some(e => e.type === 'contact' && (e.a === impact.id || e.b === impact.id)));
    const state = sim.snapshot();
    assert.ok(state.projectiles.find(p => p.id === 'impact-glass').position[2] < -0.18);
    assert.ok(state.projectiles.find(p => p.id === 'impact-concrete').position[2] < -0.18);
    assert.ok(state.projectiles.find(p => p.id === 'impact-steel').velocity[2] > 0);
    assert.ok(!events.some(e => e.type === 'swept-impact' && /timber|steel/.test(e.fragmentId)));
    assert.ok(sim.bonds.some(b => b.material === 'timber' && b.broken));
    assert.ok(sim.bonds.filter(b => b.material === 'steel').every(b => !b.broken));
    assert.ok(sim.bonds.some(b => b.material === 'steel' && b.yielded));
  } finally { sim.dispose(); }
});

test('identical free fixtures conserve independent mass and momentum for every material without a support reaction', () => {
  for (const material of Object.keys(MATERIALS)) {
    const p = projectWith(createObject(material, { id: 'free', size: [1.35, 2.4, 0.04], position: [0, 10, 0], density: 24 }));
    p.impacts = [projectile({ position: [0.12, 10.15, 2], speed: 28, radius: 0.16, mass: 8 })];
    const sim = new Simulation(p);
    try {
      const events = []; for (let i = 0; i < 100; i++) events.push(...sim.step().events);
      const state = sim.snapshot(); near(state.stats.mass, 1.35 * 2.4 * 0.04 * MATERIALS[material].density, 1e-5);
      assert.equal(state.supports.length, 0); assert.ok(state.fragments.every(f => f.released));
      assert.ok(events.some(e => e.type === 'contact')); assert.ok(!events.some(e => e.type === 'swept-impact'));
      let momentum = times(state.projectiles[0].velocity, 8);
      for (const f of state.fragments) momentum = plus(momentum, times(f.velocity, sim.fragmentMap.get(f.id).mass));
      nearVector(momentum, [0, 0, -224], 0.015);
    } finally { sim.dispose(); }
  }
});

test('the default weak-jointed structure stays intact, then actually falls after either local support is removed', () => {
  for (const removed of ['pier-left', 'pier-right']) {
    const p = createProject('structure'), sim = new Simulation(p);
    try {
      assert.equal(p.materials.timber.threshold, 3e5); assert.equal(MATERIALS.timber.threshold, 9e6);
      const before = run(sim, 240); assert.equal(before.stats.broken, 0);
      sim.removeSupport(removed); const immediate = sim.snapshot(); assert.equal(immediate.stats.broken, 0);
      immediate.fragments.forEach((f, i) => nearVector(f.position, before.fragments[i].position, 1e-6));
      let drop = 0; const events = [];
      for (let i = 0; i < 600; i++) {
        const f = sim.step(); events.push(...f.events);
        f.fragments.forEach((piece, j) => { if (piece.id.startsWith('lintel:')) drop = Math.max(drop, before.fragments[j].position[1] - piece.position[1]); });
      }
      assert.ok(drop > 2, `physical lintel fall after removing ${removed}, not just released flags`);
      assert.ok(events.some(e => e.type === 'break' && e.source === 'gravity' && e.bondId.startsWith('lintel:')));
      assert.equal(sim.snapshot().supports.find(s => s.objectId !== removed).active, true);
    } finally { sim.dispose(); }
  }
});

test('a settled fragment wakes on a new impulse and independently on a new projectile contact', () => {
  for (const trigger of ['impulse', 'contact']) {
    const p = projectWith(createObject('concrete', { id: 'sleeping', size: [0.4, 0.4, 0.4], density: 1, position: [0, 2, 0] }));
    p.settings.gravity = 9.81;
    if (trigger === 'contact') p.impacts = [projectile({ position: [0, 0.22, 0.65], time: 5.1, speed: 12, mass: 8, radius: 0.16 })];
    const sim = new Simulation(p);
    try {
      const resting = run(sim, 600); assert.equal(resting.fragments[0].sleeping, true);
      if (trigger === 'impulse') assert.equal(sim.applyImpulse(resting.fragments[0].position, [1, 1, 0], 150), true);
      let woke = false, contact = false, displaced = false;
      for (let i = 0; i < 60; i++) {
        const state = sim.step();
        woke ||= !state.fragments[0].sleeping && Math.hypot(...state.fragments[0].velocity) > 0.05;
        displaced ||= Math.hypot(...minus(state.fragments[0].position, resting.fragments[0].position)) > 0.005;
        contact ||= state.events.some(e => e.type === 'contact' && (e.a === 'shot' || e.b === 'shot'));
      }
      assert.ok(woke && displaced, `${trigger} wakes and moves a settled fragment`);
      if (trigger === 'contact') assert.ok(contact);
    } finally { sim.dispose(); }
  }
});

test('actual dynamic fragments collide with ground and come to rest above its surface', () => {
  const p = projectWith(createObject('concrete', { id: 'drop', size: [0.4, 0.4, 0.4], density: 1, position: [0, 2, 0] })); p.settings.gravity = 9.81;
  const sim = new Simulation(p);
  try { const state = run(sim, 600); assert.ok(state.stats.contacts > 0); near(state.fragments[0].position[1], 0.2, 0.015); near(Math.hypot(...state.fragments[0].velocity), 0, 0.05); }
  finally { sim.dispose(); }
});

test('fixed ticks give identical fracture histories under independent render cadences', () => {
  const p = projectWith(createObject('glass', { id: 'pane', density: 16, size: [2, 2, 0.02], position: [0, 2, 0], fixed: true })); p.impacts = [projectile({ speed: 28 })];
  const simulate = cadence => {
    const sim = new Simulation(p), history = []; let renderTime = 0, render = 0;
    try {
      while (sim.tick < 120) {
        renderTime += cadence[render++ % cadence.length];
        const target = Math.min(120, Math.floor(renderTime / LIMITS.dt + 1e-9));
        while (sim.tick < target) history.push(sim.step());
      }
      return history;
    } finally { sim.dispose(); }
  };
  assert.deepEqual(simulate([1 / 30]), simulate([1 / 144, 1 / 57, 1 / 23, 1 / 90]));
});

test('recording is isolated, bounded, reversible, quaternion interpolated, exact at every tick', () => {
  const p = projectWith(createObject('timber', { id: 'replay', density: 2, size: [2, 0.2, 0.2], position: [0, 4, 0] }));
  const sim = new Simulation(p);
  try {
    sim.components[0].body.setLinvel({ x: 1, y: 2, z: 3 }, true); sim.components[0].body.setAngvel({ x: 0, y: 1, z: 0 }, true);
    const recorder = new Recorder(sim);
    for (let i = 0; i < 120; i++) recorder.capture(sim.step());
    near(recorder.duration, 1); const take = recorder.serialize(p, [{ position: [5, 4, 8], target: [0, 2, 0], fov: 45 }]);
    const loaded = Recorder.fromJSON(JSON.stringify(take));
    for (let i = 120; i >= 0; i--) assert.deepEqual(loaded.sample(i / 120), recorder.frames[i]);
    for (const t of [0.7123, 0.01, 0.999, 0.316, 0.2, 0.002]) {
      const frame = loaded.sample(t), index = Math.floor(t * 120), alpha = t * 120 - index;
      nearVector(frame.fragments[0].position, recorder.frames[index].fragments[0].position.map((x, j) => x + alpha * (recorder.frames[index + 1].fragments[0].position[j] - x)));
      near(Math.hypot(...frame.fragments[0].rotation), 1, 1e-6); assert.deepEqual(frame.bonds, recorder.frames[index].bonds);
    }
    const sample = loaded.sample(0.5); sample.fragments[0].position[0] = 999; assert.notEqual(loaded.sample(0.5).fragments[0].position[0], 999);
    take.frames[0].fragments[0].position[0] = 99; assert.notEqual(recorder.frames[0].fragments[0].position[0], 99);
    assert.throws(() => recorder.capture({ ...sim.snapshot(), tick: 124, time: 124 / 120 }), /every fixed tick/);
    assert.throws(() => loaded.sample(NaN), /finite/);
    const invalid = recorder.serialize(p); invalid.frames[1].fragments[0].velocity[0] = NaN;
    const original = copy(invalid); assert.throws(() => Recorder.fromJSON(invalid), /finite/); assert.deepEqual(invalid, original);
    const oversize = recorder.serialize(p); oversize.frames = Array(1442).fill(oversize.frames[0]); assert.throws(() => validateTake(oversize), /frames/);
  } finally { sim.dispose(); }
});

test('replay holds bond/support/projectile transitions at preceding tick and rejects tampering', () => {
  const p = projectWith(createObject('glass', { id: 'pane', density: 12, size: [2, 2, 0.01], position: [0, 2, 0], fixed: true })); p.impacts = [projectile()];
  const sim = new Simulation(p);
  try {
    const r = new Recorder(sim); for (let i = 0; i < 12; i++) r.capture(sim.step());
    const index = r.frames.findIndex(f => f.stats.broken > 0); assert.ok(index > 0);
    assert.deepEqual(r.sample((index - 0.25) * LIMITS.dt).bonds, r.frames[index - 1].bonds);
    assert.deepEqual(r.sample(index * LIMITS.dt).bonds, r.frames[index].bonds);
    assert.equal(r.sample(LIMITS.dt / 2).projectiles.length, 0);
    const take = r.serialize(p); const damaged = copy(take); damaged.frames[0].fragments[0].id = 'fake'; assert.throws(() => validateTake(damaged), /ids/);
    const reversed = copy(take); reversed.frames.reverse(); assert.throws(() => validateTake(reversed), /consecutive/);
    const invalidQ = copy(take); invalidQ.frames[0].fragments[0].rotation = [0, 0, 0, 0]; assert.throws(() => validateTake(invalidQ), /quaternion/);
  } finally { sim.dispose(); }
});

test('tick/frame budgets are enforced and disposal is idempotent', () => {
  const sim = new Simulation(createProject('blank')), recorder = new Recorder(sim);
  for (let i = 0; i < LIMITS.maxTicks; i++) recorder.capture(sim.step());
  assert.equal(sim.step().tick, LIMITS.maxTicks); assert.equal(recorder.frames.length, LIMITS.maxFrames); near(recorder.duration, 12);
  sim.dispose(); sim.dispose(); assert.throws(() => sim.step(), /disposed/);
});

test('recording byte accounting exactly matches independent UTF-8 JSON encoding and survives import', () => {
  const sim = new Simulation(createProject('blank')), encoder = new TextEncoder();
  const bytes = value => encoder.encode(JSON.stringify(value)).length;
  try {
    const initial = sim.snapshot();
    initial.notes = { '\u4e2d\u6587': ['\u00e9', '\u4e16\u754c', '\ud83d\ude80', '\ud800', '\udfff', '\u2028\u2029', '\\"\n\t',
      String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i)), -0, 1e-7, 1e21, true, false, null] };
    const recorder = new Recorder({ snapshot: () => initial });
    assert.equal(recorder.byteSize, bytes(initial)); assert.deepEqual(recorder.frameSizes, [bytes(initial)]);
    for (let i = 0; i < 3; i++) { const f = sim.step(); f.notes = `frame ${i}: \ud83d\ude80\u00e9\u4e16\u754c`; recorder.capture(f); }
    assert.deepEqual(recorder.frameSizes, recorder.frames.map(bytes));
    assert.equal(recorder.byteSize, recorder.frameSizes.reduce((sum, size) => sum + size, 0));
    assert.equal(bytes(recorder.frames), recorder.byteSize + 2 + recorder.frames.length - 1, 'array framing is outside byteSize');
    assert.equal(LIMITS.maxRecordingBytes, 128 * 1024 * 1024); assert.equal(LIMITS.recordingMetadataBytes, 1024 * 1024);
    assert.equal(recorder.maxBytes + LIMITS.recordingMetadataBytes, LIMITS.maxRecordingBytes);
    const p = createProject('blank'); p.metadata = { title: '\u5b9f\u9a13' };
    const take = recorder.serialize(p, [{ name: '\u00e9\ud83d\ude80', position: [0, 2, 5], target: [0, 1, 0] }]);
    const envelopeBytes = bytes({ ...take, frames: [] }) + take.frames.length - 1;
    assert.equal(bytes(take), recorder.byteSize + envelopeBytes); assert.ok(envelopeBytes < LIMITS.recordingMetadataBytes);
    const loaded = Recorder.fromJSON(JSON.stringify(take, null, 2));
    assert.equal(loaded.byteSize, recorder.byteSize); assert.deepEqual(loaded.frameSizes, recorder.frameSizes);
    loaded.capture(sim.step()); assert.equal(loaded.byteSize, loaded.frames.reduce((sum, f) => sum + bytes(f), 0));
  } finally { sim.dispose(); }
});

test('small recorder byte budgets reject append/replacement atomically and reclaim replaced frame bytes', () => {
  const sim = new Simulation(createProject('blank')), encoder = new TextEncoder();
  const bytes = value => encoder.encode(JSON.stringify(value)).length;
  try {
    const first = sim.snapshot(), second = sim.step(); second.notes = 'replaceable payload';
    const maxBytes = bytes(first) + bytes(second), fake = { snapshot: () => first };
    assert.throws(() => new Recorder(fake, { maxBytes: 1 }), e => e.code === 'RECORDING_BYTE_LIMIT' && e.limitBytes === 1 && e.requiredBytes === bytes(first));
    for (const limit of [0, 1.5, NaN, LIMITS.maxRecordingBytes + 1]) assert.throws(() => new Recorder(fake, { maxBytes: limit }), /maxBytes/);
    const recorder = new Recorder(fake, { maxBytes }); recorder.capture(second);
    assert.equal(recorder.byteSize, maxBytes);
    const checkAtomic = candidate => {
      const frames = copy(recorder.frames), sizes = [...recorder.frameSizes], size = recorder.byteSize;
      const arrayIdentity = recorder.frames, sizeIdentity = recorder.frameSizes, last = recorder.frames.at(-1);
      assert.throws(() => recorder.capture(candidate), e => e.code === 'RECORDING_BYTE_LIMIT' && e.section === 'frames'
        && e.limitBytes === maxBytes && e.requiredBytes > maxBytes && /last stored frame is unchanged/.test(e.message));
      assert.equal(recorder.frames, arrayIdentity); assert.equal(recorder.frameSizes, sizeIdentity); assert.equal(recorder.frames.at(-1), last);
      assert.deepEqual(recorder.frames, frames); assert.deepEqual(recorder.frameSizes, sizes); assert.equal(recorder.byteSize, size);
    };
    checkAtomic({ ...second, notes: second.notes + '\ud83d\ude80' }); checkAtomic(sim.step());
    const smaller = { ...second, notes: '' }; recorder.capture(smaller);
    assert.equal(recorder.frames.length, 2); assert.equal(recorder.byteSize, bytes(first) + bytes(smaller));
    assert.deepEqual(recorder.frameSizes, [bytes(first), bytes(smaller)]);
    recorder.capture(second); assert.equal(recorder.byteSize, maxBytes, 'replacement refunds exactly the old frame size');
    const before = copy(recorder.frames); assert.throws(() => recorder.capture({ ...second, notes: { hidden: Infinity } }), /finite/);
    assert.deepEqual(recorder.frames, before); assert.equal(recorder.byteSize, maxBytes);
    const bypass = { ...second }; Object.defineProperty(bypass, 'toJSON', { value: () => 'bypass' });
    assert.throws(() => recorder.capture(bypass), /conversion hooks/); assert.deepEqual(recorder.frames, before);
  } finally { sim.dispose(); }
});

test('take metadata has a separate UTF-8 byte cap and rejects non-finite/non-plain JSON before cloning', () => {
  const p = createProject('blank'), sim = new Simulation(p), recorder = new Recorder(sim);
  try {
    const camera = { position: [0, 2, 5], target: [0, 1, 0] }, before = copy(recorder.frames), size = recorder.byteSize;
    assert.doesNotThrow(() => recorder.serialize(p, [camera]), 'camera time remains optional');
    const oversized = { ...camera, note: '\ud83d\ude80'.repeat(LIMITS.recordingMetadataBytes / 4) };
    assert.throws(() => recorder.serialize(p, [oversized]), e => e.code === 'RECORDING_BYTE_LIMIT' && e.section === 'metadata'
      && e.limitBytes === LIMITS.recordingMetadataBytes && e.requiredBytes > e.limitBytes);
    assert.deepEqual(recorder.frames, before); assert.equal(recorder.byteSize, size);
    const take = recorder.serialize(p); take.cameras = [oversized];
    assert.throws(() => validateTake(take), e => e.code === 'RECORDING_BYTE_LIMIT' && e.section === 'metadata');
    assert.equal(take.cameras[0], oversized, 'invalid import leaves caller state untouched');
    const bigProject = copy(p); bigProject.metadata = 'a'.repeat(LIMITS.recordingMetadataBytes);
    assert.throws(() => recorder.serialize(bigProject), e => e.code === 'RECORDING_BYTE_LIMIT' && e.section === 'metadata');
    for (const note of [{ hidden: NaN }, new Date(0), () => 1, { nested: undefined }]) {
      assert.throws(() => recorder.serialize(p, [{ ...camera, note }]), /finite|plain JSON/);
    }
    const cycle = {}; cycle.self = cycle; assert.throws(() => recorder.serialize(p, [{ ...camera, note: cycle }]), /circular/);
    let getterCalled = false; const accessor = { ...camera };
    Object.defineProperty(accessor, 'note', { enumerable: true, get() { getterCalled = true; return 'unsafe'; } });
    assert.throws(() => recorder.serialize(p, [accessor]), /accessors/); assert.equal(getterCalled, false);
  } finally { sim.dispose(); }
});

test('object take imports enforce the global frame byte cap without materializing a huge JSON string', () => {
  const p = createProject('blank'), sim = new Simulation(p);
  try {
    // Only one MiB of unique text is allocated. References model a large wire
    // recording; validation must count each occurrence before any JSON cloning.
    const sharedText = 'x'.repeat(1024 * 1024), first = sim.snapshot();
    const frames = Array.from({ length: 128 }, (_, tick) => ({ ...first, tick, time: tick * LIMITS.dt, notes: sharedText }));
    const take = { format: 'fracture-take', version: 1, project: p, cameras: [], dt: LIMITS.dt, frames };
    for (const validate of [validateTake, Recorder.fromJSON]) {
      assert.throws(() => validate(take), e => e.code === 'RECORDING_BYTE_LIMIT' && e.section === 'frames'
        && e.limitBytes === LIMITS.maxRecordingBytes - LIMITS.recordingMetadataBytes && e.requiredBytes > e.limitBytes);
    }
    assert.equal(take.frames, frames); assert.equal(frames.length, 128); assert.equal(frames[0].notes, sharedText);
  } finally { sim.dispose(); }
});
