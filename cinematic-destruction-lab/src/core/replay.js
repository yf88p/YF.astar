import { LIMITS, validateProject } from './model.js';
import { partitionObject } from './geometry.js';
import { clone, slerp } from './math.js';

const error = message => { throw new Error(`Recording: ${message}`); };
const FRAME_BYTE_LIMIT = LIMITS.maxRecordingBytes - LIMITS.recordingMetadataBytes;
function checkByteLimit(requiredBytes, limitBytes, section) {
  if (requiredBytes <= limitBytes) return;
  const action = section === 'metadata' ? 'Reduce project/camera metadata.' : 'Stop recording or reduce fragment count/duration; the last stored frame is unchanged.';
  const cause = new RangeError(`Recording: ${section} needs ${requiredBytes} UTF-8 bytes, exceeding the ${limitBytes}-byte budget. ${action}`);
  Object.assign(cause, { code: 'RECORDING_BYTE_LIMIT', requiredBytes, limitBytes, section }); throw cause;
}

// Exact UTF-8 size, without allocating a take-sized encoded buffer. JSON strings
// escape lone surrogates, whereas raw UTF-8 encoding replaces them with U+FFFD.
function stringBytes(text, json = false) {
  let bytes = json ? 2 : 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (json && (c === 34 || c === 92)) bytes += 2;
    else if (json && c < 32) bytes += [8, 9, 10, 12, 13].includes(c) ? 2 : 6;
    else if (c < 128) bytes++;
    else if (c < 2048) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else if (json && c >= 0xd800 && c <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
}

function jsonBytes(value) {
  const ancestors = new Set(); let nodes = 0;
  const measure = (v, depth) => {
    if (++nodes > 1000000 || depth > 32) error('JSON exceeds the node/depth safety budget.');
    if (v === null) return 4;
    if (typeof v === 'string') return stringBytes(v, true);
    if (typeof v === 'boolean') return v ? 4 : 5;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) error('all JSON numbers must be finite.');
      return String(v).length;
    }
    if (typeof v !== 'object' || (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))) error('expected finite, plain JSON data.');
    if ('toJSON' in v) error('JSON conversion hooks are not supported.');
    if (ancestors.has(v)) error('circular JSON references are not supported.');
    ancestors.add(v);
    const keys = Object.keys(v); let size = 2;
    if (Object.getOwnPropertySymbols(v).length || (Array.isArray(v) && keys.length !== v.length)) error('JSON arrays/objects cannot have symbol keys, sparse entries or extra array properties.');
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i], descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (Array.isArray(v) && key !== String(i)) error('JSON arrays must contain consecutive indexed entries.');
      if (descriptor.get || descriptor.set) error('JSON accessors are not supported.');
      size += (i ? 1 : 0) + (Array.isArray(v) ? 0 : stringBytes(key, true) + 1) + measure(descriptor.value, depth + 1);
    }
    ancestors.delete(v); return size;
  };
  return measure(value, 0);
}

function finite(value, path, min = -1e12, max = 1e12) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) error(`${path} must be finite in [${min}, ${max}].`);
}
function vector(value, count, path) {
  if (!Array.isArray(value) || value.length !== count) error(`${path} must contain ${count} numbers.`);
  for (const [i, v] of value.entries()) finite(v, `${path}[${i}]`);
  if (count === 4 && Math.abs(Math.hypot(...value) - 1) > 1e-3) error(`${path} must be a unit quaternion.`);
}
const boolean = (v, path) => { if (typeof v !== 'boolean') error(`${path} must be boolean.`); };
function entries(value, path, max) {
  if (!Array.isArray(value) || value.length > max) error(`${path} must be an array of at most ${max} entries.`);
  const seen = new Set();
  for (const v of value) {
    if (!v || typeof v.id !== 'string' || !v.id || seen.has(v.id)) error(`${path} requires unique nonempty ids.`);
    seen.add(v.id);
  }
  return seen;
}
function frameCheck(frame, reference) {
  if (!frame || typeof frame !== 'object') error('each frame must be an object.');
  finite(frame.tick, 'tick', 0, LIMITS.maxTicks); if (!Number.isInteger(frame.tick)) error('tick must be an integer.');
  finite(frame.time, 'time', 0, LIMITS.maxTicks * LIMITS.dt);
  if (Math.abs(frame.time - frame.tick * LIMITS.dt) > 1e-9) error('frame time must equal tick * dt.');
  entries(frame.fragments, 'fragments', LIMITS.maxFragments); entries(frame.bonds, 'bonds', LIMITS.maxFragments * 4 + LIMITS.maxConnections);
  entries(frame.projectiles, 'projectiles', LIMITS.maxImpacts);
  if (reference) for (const key of ['fragments', 'bonds']) {
    if (frame[key].length !== reference[key].length || frame[key].some((v, i) => v.id !== reference[key][i].id)) error(`${key} ids/order must remain constant throughout a take.`);
  }
  for (const f of frame.fragments) {
    vector(f.position, 3, `${f.id}.position`); vector(f.rotation, 4, `${f.id}.rotation`);
    vector(f.velocity, 3, `${f.id}.velocity`); vector(f.angularVelocity, 3, `${f.id}.angularVelocity`);
    boolean(f.sleeping, `${f.id}.sleeping`); boolean(f.released, `${f.id}.released`);
    if (f.bodyId !== undefined) finite(f.bodyId, `${f.id}.bodyId`, 0);
  }
  for (const b of frame.bonds) {
    finite(b.damage, `${b.id}.damage`, 0, 1); boolean(b.broken, `${b.id}.broken`);
    if (b.broken !== (b.damage === 1)) error(`${b.id} broken must agree with damage = 1.`);
    if (b.yielded !== undefined) boolean(b.yielded, `${b.id}.yielded`);
  }
  for (const p of frame.projectiles) {
    vector(p.position, 3, `${p.id}.position`); vector(p.rotation, 4, `${p.id}.rotation`); vector(p.velocity, 3, `${p.id}.velocity`);
    if (p.angularVelocity !== undefined) vector(p.angularVelocity, 3, `${p.id}.angularVelocity`);
    finite(p.radius, `${p.id}.radius`, LIMITS.minRadius, LIMITS.maxRadius); finite(p.mass, `${p.id}.mass`, 0.01, 1000);
    if (p.damageBudget !== undefined || p.damageSpent !== undefined) {
      finite(p.damageBudget, `${p.id}.damageBudget`, 0); finite(p.damageSpent, `${p.id}.damageSpent`, 0, p.damageBudget + 1e-8);
    }
    for (const [key, reference] of [['sweptContacts', frame.fragments], ['predictedBonds', frame.bonds]]) if (p[key] !== undefined) {
      const ids = new Set(reference.map(v => v.id));
      if (!Array.isArray(p[key]) || p[key].length > ids.size || new Set(p[key]).size !== p[key].length || p[key].some(id => !ids.has(id))) error(`${p.id}.${key} must contain unique existing ids.`);
    }
  }
  if (!Array.isArray(frame.supports) || frame.supports.length > LIMITS.maxObjects) error('supports must be a bounded array.');
  const supports = new Set();
  for (const s of frame.supports) {
    if (!s || typeof s.objectId !== 'string' || supports.has(s.objectId)) error('supports require unique objectIds.');
    boolean(s.active, 'support.active'); supports.add(s.objectId);
  }
  if (frame.impacts !== undefined) { entries(frame.impacts, 'impacts', LIMITS.maxImpacts); frame.impacts.forEach(i => boolean(i.fired, 'impact.fired')); }
  if (frame.events !== undefined) {
    if (!Array.isArray(frame.events) || frame.events.length > 10000) error('events exceed the per-frame bound.');
    for (const e of frame.events) {
      if (!e || typeof e.type !== 'string') error('events must have a type.');
      if (e.tick !== undefined) { finite(e.tick, 'event.tick', 0, frame.tick); if (!Number.isInteger(e.tick)) error('event tick must be integer.'); }
      for (const key of ['impulse', 'estimatedImpulse', 'energy', 'speed', 'damageWork']) if (e[key] !== undefined) finite(e[key], `event.${key}`, 0);
      if (e.point !== undefined) vector(e.point, 3, 'event.point');
      if (e.normal !== undefined) vector(e.normal, 3, 'event.normal');
      if (e.timeOfImpact !== undefined) finite(e.timeOfImpact, 'event.timeOfImpact', 0, LIMITS.dt + 1e-8);
    }
  }
  if (!frame.stats || typeof frame.stats !== 'object' || Array.isArray(frame.stats)) error('stats must be an object.');
  for (const [key, value] of Object.entries(frame.stats)) if (typeof value !== 'boolean') finite(value, `stats.${key}`, 0, 1e18);
  for (const key of ['active', 'sleeping', 'released', 'broken']) finite(frame.stats[key], `stats.${key}`, 0, key === 'broken' ? frame.bonds.length : frame.fragments.length);
  const expected = { active: frame.fragments.filter(f => f.released && !f.sleeping).length, sleeping: frame.fragments.filter(f => f.sleeping).length,
    released: frame.fragments.filter(f => f.released).length, broken: frame.bonds.filter(b => b.broken).length };
  for (const [key, value] of Object.entries(expected)) if (frame.stats[key] !== value) error(`stats.${key} disagrees with the fragment/bond states.`);
}

export function validateTake(input) {
  if (typeof input === 'string') {
    checkByteLimit(stringBytes(input), LIMITS.maxRecordingBytes, 'take');
    try { input = JSON.parse(input); } catch { error('invalid JSON.'); }
  }
  if (input && typeof input === 'object') {
    if (Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || 'toJSON' in input) error('expected a plain JSON take.');
    if (Object.getOwnPropertySymbols(input).length || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => d.get || d.set)) error('take accessors/symbol keys are not supported.');
  }
  if (!input || input.format !== 'fracture-take' || input.version !== 1) error('expected fracture-take version 1.');
  if (input.dt !== LIMITS.dt) error(`dt must be ${LIMITS.dt}.`);
  if (!Array.isArray(input.frames) || !input.frames.length || input.frames.length > LIMITS.maxFrames) error(`expected 1..${LIMITS.maxFrames} frames.`);
  let states = 0, byteSize = 0;
  for (const frame of input.frames) {
    if (!frame || !Array.isArray(frame.fragments) || frame.fragments.length > LIMITS.maxFragments) error('fragment state budget exceeded.');
    states += frame.fragments.length;
    byteSize += jsonBytes(frame); checkByteLimit(byteSize, FRAME_BYTE_LIMIT, 'frames');
  }
  if (states > LIMITS.maxStates) error(`fragment state budget exceeds ${LIMITS.maxStates}.`);
  // Include the actual envelope and all array commas in the metadata reservation.
  const metadataBytes = jsonBytes({ ...input, frames: [] }) + input.frames.length - 1;
  checkByteLimit(metadataBytes, LIMITS.recordingMetadataBytes, 'metadata');
  checkByteLimit(byteSize + metadataBytes, LIMITS.maxRecordingBytes, 'take');
  const project = validateProject(input.project);
  if (!Array.isArray(input.cameras) || input.cameras.length > 64) error('cameras must be an array of at most 64 poses.');
  for (const [i, camera] of input.cameras.entries()) {
    if (!camera || typeof camera !== 'object') error(`cameras[${i}] must be an object.`);
    vector(camera.position, 3, `cameras[${i}].position`); vector(camera.target, 3, `cameras[${i}].target`);
    if (camera.fov !== undefined) finite(camera.fov, 'camera.fov', 1, 179);
    if (camera.time !== undefined) finite(camera.time, 'camera.time', 0, LIMITS.maxTicks * LIMITS.dt);
  }
  const expectedFragments = [], expectedBonds = [];
  for (const object of project.objects) { const g = partitionObject(object, project.materials); expectedFragments.push(...g.fragments); expectedBonds.push(...g.bonds); }
  expectedBonds.push(...project.connections.map(c => ({ id: `connection:${c.id}` })));
  const reference = { fragments: expectedFragments, bonds: expectedBonds };
  const supports = new Set(project.objects.filter(o => o.fixed).map(o => o.id)), impacts = new Map(project.impacts.map(i => [i.id, i]));
  for (let i = 0; i < input.frames.length; i++) {
    const frame = input.frames[i]; frameCheck(frame, reference);
    if (i > 0 && frame.tick !== input.frames[i - 1].tick + 1) error('frames must be consecutive, increasing fixed ticks.');
    if (frame.supports.length !== supports.size || frame.supports.some(s => !supports.has(s.objectId))) error('support ids must match fixed project objects.');
    for (const p of frame.projectiles) {
      const impact = impacts.get(p.id);
      if (impact?.type !== 'projectile' || impact.radius !== p.radius || impact.mass !== p.mass) error('projectiles must match project impacts.');
      if (p.damageBudget !== undefined && Math.abs(p.damageBudget - 0.35 * 0.5 * impact.mass * impact.speed ** 2) > 1e-8) error('projectile damage budget must match its launch energy.');
      const previous = i > 0 && input.frames[i - 1].projectiles.find(v => v.id === p.id);
      if (previous?.damageSpent !== undefined && (p.damageSpent === undefined || p.damageSpent < previous.damageSpent)) error('projectile fracture work cannot reverse.');
      if (previous) for (const key of ['sweptContacts', 'predictedBonds']) if (previous[key]?.some(id => !p[key]?.includes(id))) error(`projectile ${key} cannot forget previous impacts.`);
    }
    if (frame.impacts && (frame.impacts.length !== impacts.size || frame.impacts.some(v => !impacts.has(v.id)))) error('impact state ids must match project impacts.');
    if (i > 0) {
      const previous = input.frames[i - 1];
      if (frame.bonds.some((b, j) => b.damage < previous.bonds[j].damage || (previous.bonds[j].yielded && !b.yielded))) error('bond damage/yield cannot reverse in a recorded forward take.');
      if (frame.supports.some(s => s.active && !previous.supports.find(p => p.objectId === s.objectId).active)) error('removed supports cannot reactivate.');
      if (previous.projectiles.some(p => !frame.projectiles.some(next => next.id === p.id))) error('projectile state cannot disappear during a take.');
      if (previous.impacts && (!frame.impacts || previous.impacts.some(p => p.fired && !frame.impacts.find(next => next.id === p.id)?.fired))) error('fired impacts cannot become unfired.');
    }
  }
  return { format: 'fracture-take', version: 1, project, cameras: clone(input.cameras), dt: LIMITS.dt, frames: input.frames.map(frame => clone(frame)) };
}

export class Recorder {
  constructor(sim, { maxBytes = LIMITS.maxRecordingBytes } = {}) {
    finite(maxBytes, 'maxBytes', 1, LIMITS.maxRecordingBytes);
    if (!Number.isInteger(maxBytes)) error('maxBytes must be an integer.');
    const initial = sim.snapshot(); frameCheck(initial);
    const byteSize = jsonBytes(initial), budget = Math.min(maxBytes, FRAME_BYTE_LIMIT);
    checkByteLimit(byteSize, budget, 'frames');
    this.frames = [clone(initial)]; this.dt = LIMITS.dt;
    this.byteSize = byteSize; this.frameSizes = [byteSize]; this.maxBytes = budget;
  }

  capture(snapshot) {
    const last = this.frames.at(-1);
    if (snapshot?.tick !== last.tick && snapshot?.tick !== last.tick + 1) error('capture every fixed tick in order, not once per render.');
    const replace = snapshot.tick === last.tick;
    if (!replace && this.frames.length >= LIMITS.maxFrames) error(`maximum ${LIMITS.maxFrames} frames reached.`);
    frameCheck(snapshot, this.frames[0]);
    const size = jsonBytes(snapshot), byteSize = this.byteSize - (replace ? this.frameSizes.at(-1) : 0) + size;
    checkByteLimit(byteSize, this.maxBytes, 'frames');
    const copy = clone(snapshot);
    if (replace) { this.frames[this.frames.length - 1] = copy; this.frameSizes[this.frameSizes.length - 1] = size; }
    else { this.frames.push(copy); this.frameSizes.push(size); }
    this.byteSize = byteSize;
    return copy;
  }

  get duration() { return this.frames.at(-1).time; }

  sample(time) {
    if (!Number.isFinite(time)) error('sample time must be finite.');
    time = Math.max(this.frames[0].time, Math.min(this.duration, time));
    const grid = time / this.dt, rounded = Math.round(grid);
    const tick = Math.abs(grid - rounded) < 1e-9 ? rounded : Math.floor(grid);
    const index = Math.max(0, Math.min(this.frames.length - 1, tick - this.frames[0].tick));
    const a = this.frames[index], b = this.frames[Math.min(index + 1, this.frames.length - 1)];
    if (a === b || Math.abs(time - a.time) < 1e-11) return clone(a);
    const alpha = (time - a.time) / this.dt, result = clone(a); result.time = time;
    const interpolate = (left, right) => {
      const lookup = new Map(right.map(v => [v.id, v]));
      return left.map(v => {
        const end = lookup.get(v.id), out = clone(v); if (!end) return out;
        for (const key of ['position', 'velocity', 'angularVelocity']) if (v[key] && end[key]) out[key] = v[key].map((x, j) => x + alpha * (end[key][j] - x));
        out.rotation = slerp(v.rotation, end.rotation, alpha); return out;
      });
    };
    result.fragments = interpolate(a.fragments, b.fragments); result.projectiles = interpolate(a.projectiles, b.projectiles);
    return result;
  }

  serialize(project, cameras = []) { return validateTake({ format: 'fracture-take', version: 1, project, cameras, dt: this.dt, frames: this.frames }); }

  static fromJSON(data) {
    const take = validateTake(data), recorder = Object.create(Recorder.prototype);
    const frameSizes = take.frames.map(frame => jsonBytes(frame));
    Object.assign(recorder, { frames: take.frames, dt: take.dt, project: take.project, cameras: take.cameras,
      frameSizes, byteSize: frameSizes.reduce((sum, size) => sum + size, 0), maxBytes: FRAME_BYTE_LIMIT }); return recorder;
  }
}
