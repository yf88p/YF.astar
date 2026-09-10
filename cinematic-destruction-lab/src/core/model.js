import { clone, eulerQuaternion, rotate } from './math.js';

export const MATERIALS = {
  glass: { name: 'Architectural glass', density: 2500, threshold: 5e6, toughness: 18, friction: 0.45, restitution: 0.12, color: '#92dfec', description: 'Brittle, low-energy bonds; thin irregular through-thickness shards.' },
  concrete: { name: 'Cast concrete', density: 2400, threshold: 2e6, toughness: 140, friction: 0.75, restitution: 0.08, color: '#b8b3a9', description: 'Heavy irregular prisms with depth layers; no reinforcement.' },
  timber: { name: 'Structural timber', density: 650, threshold: 9e6, toughness: 900, friction: 0.6, restitution: 0.18, color: '#bd8855', description: 'Rectangular grain-aligned pieces; weak splitting across the grain.', grainStrength: 0.16 },
  steel: { name: 'Mild steel', density: 7850, threshold: 250e6, toughness: 40000, friction: 0.5, restitution: 0.22, color: '#708796', description: 'Rigid segments with accumulated yielding damage, not deformable metal.', yieldFraction: 0.22 },
};

export const LIMITS = Object.freeze({ maxFragments: 600, maxTicks: 1440, dt: 1 / 120, maxSpeed: 100,
  maxObjects: 60, maxConnections: 1800, maxImpacts: 64, maxFrames: 1441, maxStates: 600 * 1441,
  maxRecordingBytes: 128 * 1024 * 1024, recordingMetadataBytes: 1024 * 1024,
  minRadius: 0.05, maxRadius: 0.5, maxDimension: 30, maxPosition: 100, maxImpulse: 1e6 });

let nextId = 1;
export function createObject(material = 'glass', overrides = {}) {
  if (!MATERIALS[material]) throw new Error(`Unknown material "${material}".`);
  const defaults = {
    glass: { shape: 'panel', size: [2.2, 3.4, 0.035], density: 40 },
    concrete: { shape: 'box', size: [1.8, 2.4, 0.6], density: 36 },
    timber: { shape: 'beam', size: [3.2, 0.24, 0.24], density: 12 },
    steel: { shape: 'beam', size: [0.16, 4, 0.18], density: 4 },
  }[material];
  const object = { id: `object-${nextId++}`, name: MATERIALS[material].name, material,
    ...defaults, rotation: [0, 0, 0], seed: 12345, fixed: false, ...clone(overrides) };
  if (!overrides.position) {
    const q = eulerQuaternion(object.rotation);
    const y = [0, 1, 2].reduce((sum, axis) => {
      const v = [0, 0, 0]; v[axis] = object.size[axis] / 2;
      return sum + Math.abs(rotate(v, q)[1]);
    }, 0);
    object.position = [0, y, 0];
  }
  return object;
}

export function createProject(example = 'storefront') {
  if (!['storefront', 'structure', 'range', 'blank'].includes(example)) throw new Error(`Unknown example "${example}".`);
  const project = { version: 1, name: { storefront: 'Glasshouse / 01', structure: 'Load path / 02', range: 'Material range / 03', blank: 'Untitled experiment' }[example],
    objects: [], connections: [], impacts: [], settings: { gravity: 9.81, solverIterations: 6 }, materials: clone(MATERIALS) };
  const add = (material, data) => { const o = createObject(material, data); project.objects.push(o); return o.id; };
  const connect = (a, b) => project.connections.push({ id: `connection-${project.connections.length}`, a, b });
  if (example === 'storefront') {
    for (let i = 0; i < 4; i++) add('steel', { id: `post-${i}`, name: `Steel upright ${i + 1}`, position: [-3.45 + i * 2.3, 2, 0], size: [0.13, 4, 0.16], density: 4, fixed: true });
    add('steel', { id: 'header', name: 'Steel header', position: [0, 4.08, 0], size: [7.04, 0.16, 0.18], density: 7 });
    for (let i = 0; i < 3; i++) {
      const id = add('glass', { id: `pane-${i}`, name: `Glazing ${i + 1}`, position: [-2.3 + i * 2.3, 2, 0], size: [2.17, 3.92, 0.012], density: 48, seed: 831 + i * 211 });
      connect(id, `post-${i}`); connect(id, `post-${i + 1}`); connect(id, 'header');
    }
    for (let i = 0; i < 4; i++) connect(`post-${i}`, 'header');
  } else if (example === 'structure') {
    project.materials.timber = { ...project.materials.timber, name: 'Weak-jointed timber assembly', threshold: 3e5,
      description: 'Effective 0.30 MPa segment-joint strength for the load-path demonstration; not a certified bulk timber property.' };
    add('concrete', { id: 'pier-left', name: 'West pier', position: [-2.6, 1.5, 0], size: [0.65, 3, 0.8], density: 20, fixed: true });
    add('concrete', { id: 'pier-right', name: 'East pier', position: [2.6, 1.5, 0], size: [0.65, 3, 0.8], density: 20, fixed: true });
    add('timber', { id: 'lintel', name: 'Segment-jointed lintel', position: [0, 3.2, 0], size: [6, 0.4, 0.6], density: 24 });
    connect('pier-left', 'lintel'); connect('pier-right', 'lintel');
    for (const connection of project.connections) connection.threshold = project.materials.concrete.threshold;
  } else if (example === 'range') {
    ['glass', 'concrete', 'timber', 'steel'].forEach((material, i) => {
      const x = (i - 1.5) * 2;
      add(material, { id: `sample-${material}`, name: MATERIALS[material].name, shape: 'panel', size: [1.35, 2.4, 0.04], position: [x, 1.2, 0], density: 24, fixed: true });
      project.impacts.push({ id: `impact-${material}`, type: 'projectile', position: [x, 1.8, 5], direction: [0, 0, -1], radius: 0.16, mass: 8, speed: 28, time: 0.4, magnitude: 200 });
    });
  }
  if (example === 'storefront' || example === 'structure') project.impacts.push({ id: 'impact-1', type: 'projectile', position: [0, 1.8, 5], direction: [0, 0, -1], radius: 0.16, mass: 8, speed: 28, time: 0.4, magnitude: 200 });
  return project;
}

const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
const record = (value, path) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object'); };
const number = (value, path, min, max, integer = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(path, `expected ${integer ? 'an integer' : 'a finite number'} from ${min} to ${max}`);
};
const text = (value, path) => { if (typeof value !== 'string' || !value.trim() || value.length > 160) fail(path, 'expected a nonempty string of at most 160 characters'); };
const vector = (value, path, min, max) => { if (!Array.isArray(value) || value.length !== 3) fail(path, 'expected [x, y, z]'); for (const [i, v] of value.entries()) number(v, `${path}[${i}]`, min, max); };
const array = (value, path, max) => { if (!Array.isArray(value) || value.length > max) fail(path, `expected an array of at most ${max} entries`); };

// Validate before cloning, allocation of physics resources, or mutation of caller data.
export function validateProject(project) {
  let nodes = 0;
  const visiting = new WeakSet();
  const checkJSON = (value, path, depth) => {
    if (++nodes > 50000 || depth > 20) fail(path, 'project metadata exceeds the size/depth budget');
    if (typeof value === 'number' && !Number.isFinite(value)) fail(path, 'numbers must be finite (no NaN or Infinity)');
    if (value === null || ['number', 'string', 'boolean'].includes(typeof value)) return;
    if (typeof value !== 'object') fail(path, 'expected JSON-serializable data');
    if (visiting.has(value)) fail(path, 'circular references are not supported');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'expected a plain JSON object');
    visiting.add(value);
    for (const [key, child] of Object.entries(value)) checkJSON(child, `${path}.${key}`, depth + 1);
    visiting.delete(value);
  };
  checkJSON(project, 'project', 0);
  record(project, 'project');
  if (project.version !== 1) fail('project.version', 'only version 1 is supported');
  text(project.name, 'project.name');
  record(project.materials, 'materials');
  if (Object.keys(project.materials).some(k => !Object.hasOwn(MATERIALS, k))) fail('materials', 'only glass, concrete, timber and steel are supported');
  for (const key of Object.keys(MATERIALS)) {
    const m = project.materials[key], path = `materials.${key}`;
    record(m, path); text(m.name, `${path}.name`); text(m.description, `${path}.description`);
    number(m.density, `${path}.density`, 1, 30000); number(m.threshold, `${path}.threshold`, 1, 1e10);
    number(m.toughness, `${path}.toughness`, 0.001, 1e8); number(m.friction, `${path}.friction`, 0, 2); number(m.restitution, `${path}.restitution`, 0, 1);
    if (typeof m.color !== 'string' || !/^#[\da-f]{6}$/i.test(m.color)) fail(`${path}.color`, 'expected #RRGGBB');
    if (m.grainStrength !== undefined) number(m.grainStrength, `${path}.grainStrength`, 0.001, 1);
    if (m.yieldFraction !== undefined) number(m.yieldFraction, `${path}.yieldFraction`, 0.001, 0.99);
  }
  record(project.settings, 'settings'); number(project.settings.gravity, 'settings.gravity', 0, 30);
  number(project.settings.solverIterations, 'settings.solverIterations', 1, 32, true);
  array(project.objects, 'objects', LIMITS.maxObjects); array(project.connections, 'connections', LIMITS.maxConnections); array(project.impacts, 'impacts', LIMITS.maxImpacts);
  const ids = new Set(); let fragments = 0;
  for (const [i, o] of project.objects.entries()) {
    const p = `objects[${i}]`; record(o, p); text(o.id, `${p}.id`); text(o.name, `${p}.name`);
    if (o.id.includes(':') || ids.has(o.id)) fail(`${p}.id`, 'must be unique and must not contain ":"'); ids.add(o.id);
    if (!Object.hasOwn(MATERIALS, o.material)) fail(`${p}.material`, 'unknown material');
    if (!['panel', 'box', 'beam'].includes(o.shape)) fail(`${p}.shape`, 'expected panel, box or beam');
    vector(o.position, `${p}.position`, -LIMITS.maxPosition, LIMITS.maxPosition); vector(o.rotation, `${p}.rotation`, -Math.PI * 100, Math.PI * 100); vector(o.size, `${p}.size`, 0.005, LIMITS.maxDimension);
    number(o.density, `${p}.density (fragment count)`, 1, LIMITS.maxFragments, true); fragments += o.density;
    number(o.seed, `${p}.seed`, 0, 4294967295, true);
    if (typeof o.fixed !== 'boolean') fail(`${p}.fixed`, 'expected a boolean');
  }
  if (fragments > LIMITS.maxFragments) fail('objects', `fragment budget ${fragments} exceeds ${LIMITS.maxFragments}; reduce fragmentation density`);
  const connectionIds = new Set(), pairs = new Set();
  for (const [i, c] of project.connections.entries()) {
    const p = `connections[${i}]`; record(c, p); text(c.id, `${p}.id`);
    if (c.id.includes(':') || connectionIds.has(c.id)) fail(`${p}.id`, 'must be unique and must not contain ":"'); connectionIds.add(c.id);
    if (!ids.has(c.a) || !ids.has(c.b) || c.a === c.b) fail(p, 'a and b must reference two distinct existing object ids');
    const pair = JSON.stringify([c.a, c.b].sort()); if (pairs.has(pair)) fail(p, 'duplicate object connection'); pairs.add(pair);
    if (c.threshold !== undefined) number(c.threshold, `${p}.threshold`, 1, 1e10);
  }
  const impactIds = new Set();
  for (const [i, impact] of project.impacts.entries()) {
    const p = `impacts[${i}]`; record(impact, p); text(impact.id, `${p}.id`);
    if (impactIds.has(impact.id)) fail(`${p}.id`, 'duplicate impact id'); impactIds.add(impact.id);
    if (!['projectile', 'impulse'].includes(impact.type)) fail(`${p}.type`, 'expected projectile or impulse');
    vector(impact.position, `${p}.position`, -LIMITS.maxPosition, LIMITS.maxPosition); vector(impact.direction, `${p}.direction`, -1e6, 1e6);
    if (Math.hypot(...impact.direction) < 1e-8) fail(`${p}.direction`, 'must be nonzero');
    number(impact.radius, `${p}.radius`, LIMITS.minRadius, LIMITS.maxRadius); number(impact.mass, `${p}.mass`, 0.01, 1000);
    number(impact.speed, `${p}.speed`, 0, LIMITS.maxSpeed); number(impact.time, `${p}.time`, 0, (LIMITS.maxTicks - 1) * LIMITS.dt);
    number(impact.magnitude, `${p}.magnitude`, 0, LIMITS.maxImpulse);
  }
  return clone(project);
}
