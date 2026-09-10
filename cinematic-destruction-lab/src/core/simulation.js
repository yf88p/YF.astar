import RAPIER from '@dimforge/rapier3d-compat';
import { LIMITS, validateProject } from './model.js';
import { partitionObject } from './geometry.js';
import { add, sub, scale, dot, cross, length, normalize, vec, arr, quat, qarr, rotate, multiply, conjugate, eulerQuaternion, clone } from './math.js';

let ready = false, initialization;
export async function initPhysics() {
  initialization ??= RAPIER.init().then(() => { ready = true; return RAPIER; }).catch(error => { initialization = undefined; throw error; });
  return initialization;
}

export class Simulation {
  constructor(project) {
    this.project = validateProject(project);
    if (!ready) throw new Error('Call and await initPhysics() before constructing Simulation.');
    this.tick = 0; this.dt = LIMITS.dt; this.disposed = false;
    this.fragments = []; this.bonds = []; this.projectiles = []; this.events = []; this.pendingEvents = [];
    this.impacts = this.project.impacts.map(i => ({ ...i, fired: false }));
    this.supports = []; this.components = []; this.fragmentMap = new Map(); this.colliderMap = new Map();
    this.contactCount = 0; this.totalContactImpulse = 0; this.topologyDirty = false;
    const objects = new Map(this.project.objects.map(o => [o.id, o]));
    for (const object of this.project.objects) {
      const geometry = partitionObject(object, this.project.materials), rotation = eulerQuaternion(object.rotation);
      for (const f of geometry.fragments) {
        f.initialPosition = add(object.position, rotate(f.center, rotation)); f.initialRotation = [...rotation];
        f.radius = Math.max(...Array.from({ length: f.vertices.length / 3 }, (_, i) => length(f.vertices.slice(i * 3, i * 3 + 3))));
        this.fragments.push(f); this.fragmentMap.set(f.id, f);
      }
      this.bonds.push(...geometry.bonds.map(b => ({ ...b, damage: 0, broken: false, yielded: false,
        localPoint: sub(b.center, this.fragmentMap.get(b.a).center) })));
      if (object.fixed) {
        const attachment = geometry.fragments.reduce((a, b) => a.initialPosition[1] <= b.initialPosition[1] ? a : b);
        this.supports.push({ objectId: object.id, fragmentId: attachment.id, active: true });
      }
    }
    for (const connection of this.project.connections) {
      const aa = this.fragments.filter(f => f.objectId === connection.a), bb = this.fragments.filter(f => f.objectId === connection.b);
      let best, distance = Infinity;
      for (const a of aa) for (const b of bb) {
        const ds = length(sub(a.initialPosition, b.initialPosition));
        if (ds < distance) { distance = ds; best = [a, b]; }
      }
      const [a, b] = best, ma = this.project.materials[a.material], mb = this.project.materials[b.material];
      const center = scale(add(a.initialPosition, b.initialPosition), 0.5);
      const crossSection = o => [...o.size].sort((x, y) => x - y).slice(0, 2).reduce((s, v) => s * v, 1);
      this.bonds.push({ id: `connection:${connection.id}`, a: a.id, b: b.id, area: Math.min(crossSection(objects.get(a.objectId)), crossSection(objects.get(b.objectId))),
        center, centerSpace: 'world', localPoint: rotate(sub(center, a.initialPosition), conjugate(a.initialRotation)),
        threshold: connection.threshold ?? Math.min(ma.threshold, mb.threshold), toughness: Math.min(ma.toughness, mb.toughness),
        material: ma.toughness <= mb.toughness ? a.material : b.material, damage: 0, broken: false, yielded: false, connectionId: connection.id });
    }
    this.adjacency = new Map(this.fragments.map(f => [f.id, []]));
    for (const b of this.bonds) { this.adjacency.get(b.a).push(b); this.adjacency.get(b.b).push(b); }
    this.world = new RAPIER.World({ x: 0, y: -this.project.settings.gravity, z: 0 });
    this.queue = new RAPIER.EventQueue(true);
    this.world.timestep = this.dt; this.world.numSolverIterations = this.project.settings.solverIterations; this.world.maxCcdSubsteps = 1;
    try {
      // An actual fixed floor, covering the entire editable workspace.
      this.ground = this.world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0)
        .setFriction(0.7).setRestitution(0).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS));
      this._rebuildComponents();
    } catch (error) { this.dispose(); throw error; }
  }

  _assertLive() { if (this.disposed) throw new Error('Simulation has been disposed.'); }

  _pose(f) {
    if (!f.body) return { position: [...f.initialPosition], rotation: [...f.initialRotation], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
    const rotation = qarr(f.body.rotation()), position = add(arr(f.body.translation()), rotate(f.localPosition, rotation));
    return { position, rotation: multiply(rotation, f.localRotation), velocity: arr(f.body.velocityAtPoint(vec(position))), angularVelocity: arr(f.body.angvel()) };
  }

  _bondPoint(b) { const pose = this._pose(this.fragmentMap.get(b.a)); return add(pose.position, rotate(b.localPoint, pose.rotation)); }

  _rebuildComponents() {
    const anchored = new Set(this.supports.filter(s => s.active).map(s => s.fragmentId));
    const visited = new Set(), groups = [];
    for (const f of this.fragments) if (!visited.has(f.id)) {
      const group = [f]; visited.add(f.id);
      for (let i = 0; i < group.length; i++) for (const b of this.adjacency.get(group[i].id)) if (!b.broken) {
        const id = b.a === group[i].id ? b.b : b.a;
        if (!visited.has(id)) { visited.add(id); group.push(this.fragmentMap.get(id)); }
      }
      groups.push(group);
    }
    const states = new Map(this.fragments.map(f => [f.id, this._pose(f)]));
    const oldComponents = this.components, reused = new Set(), next = [];
    for (const group of groups) {
      const fixed = group.some(f => anchored.has(f.id)), parent = group[0].component;
      if (parent && group.every(f => f.component === parent) && parent.fragments.length === group.length && parent.fixed === fixed) {
        reused.add(parent); next.push(parent); continue;
      }
      const mass = group.reduce((sum, f) => sum + f.mass, 0);
      const center = scale(group.reduce((sum, f) => add(sum, scale(states.get(f.id).position, f.mass)), [0, 0, 0]), 1 / mass);
      const descriptor = (fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()).setTranslation(...center).setCcdEnabled(true);
      const body = this.world.createRigidBody(descriptor), component = { body, fragments: group, fixed, mass };
      for (const f of group) {
        const state = states.get(f.id), material = this.project.materials[f.material];
        const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(f.vertices));
        if (!desc) throw new Error(`Unable to build convex collider for ${f.id}; increase object dimensions or reduce density.`);
        f.localPosition = sub(state.position, center); f.localRotation = state.rotation;
        desc.setTranslation(...f.localPosition).setRotation(quat(f.localRotation)).setMass(f.mass)
          .setFriction(material.friction).setRestitution(material.restitution).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setContactForceEventThreshold(0).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
        f.collider = this.world.createCollider(desc, body); f.body = body; f.component = component;
      }
      body.recomputeMassPropertiesFromColliders();
      if (!fixed && parent) {
        // Sample the old rigid velocity field at the new COM; never add separation speed.
        body.setLinvel(parent.body.velocityAtPoint(body.worldCom()), true);
        body.setAngvel(parent.body.angvel(), true);
      }
      next.push(component);
    }
    for (const c of oldComponents) if (!reused.has(c)) this.world.removeRigidBody(c.body);
    this.components = next; this.colliderMap.clear();
    for (const f of this.fragments) this.colliderMap.set(f.collider.handle, { fragment: f });
    for (const p of this.projectiles) this.colliderMap.set(p.collider.handle, { projectile: p });
    this.world.propagateModifiedBodyPositionsToColliders(); this.topologyDirty = false; this.loadPaths = undefined; this.queryDirty = true;
  }

  _damageBond(b, increment, source) {
    if (b.broken || !(increment > 0)) return;
    b.damage = Math.min(1, b.damage + increment);
    const yieldFraction = this.project.materials.steel.yieldFraction ?? 0.22;
    if (b.material === 'steel' && b.damage >= yieldFraction && !b.yielded) {
      b.yielded = true; this.events.push({ type: 'yield', tick: this.tick, bondId: b.id, source });
    }
    if (b.damage >= 1) {
      b.broken = true; this.topologyDirty = true;
      this.events.push({ type: 'break', tick: this.tick, bondId: b.id, source });
    }
  }

  _damageAt(f, point, impulse, energy, speed, radius = 0, options = {}) {
    const result = { work: 0, bondIds: [] };
    if (!(energy > 0) || speed < 0.1) return result;
    const reach = Math.max(0.15, f.radius * 1.5, radius * 3), candidates = [];
    const zone = new Set([f.id]);
    if (options.predictive) for (const b of this.adjacency.get(f.id)) if (!b.broken && !b.connectionId) {
      const other = b.a === f.id ? b.b : b.a;
      if (['glass', 'concrete'].includes(this.fragmentMap.get(other).material)) zone.add(other);
    }
    let totalWeight = 0, zoneWork = 0;
    for (const b of this.bonds) if (!b.broken && !options.exclude?.has(b.id) && this.fragmentMap.get(b.a).component === f.component
      && (!options.predictive || ['glass', 'concrete'].includes(b.material))) {
      const distance = length(sub(this._bondPoint(b), point)), incident = zone.has(b.a) || zone.has(b.b);
      const weight = Math.max(incident ? 0.08 : 0, 1 - distance / reach);
      if (weight > 0) { candidates.push([b, weight]); totalWeight += weight; zoneWork += (1 - b.damage) * b.area * b.toughness; }
    }
    const available = Math.max(0, Math.min(0.35 * energy, options.budget ?? Infinity));
    // A predictor must fund the local cohesive process zone, not chip away every tick.
    if (options.predictive && available < zoneWork) return result;
    const object = this.project.objects.find(o => o.id === f.objectId);
    const pulse = Math.max(1e-5, Math.min(this.dt, Math.min(...object.size) / speed));
    for (const [b, weight] of candidates) {
      const share = weight / totalWeight, stress = impulse * share / (pulse * b.area);
      const initiation = b.material === 'steel' ? (this.project.materials.steel.yieldFraction ?? 0.22) : 1;
      if (stress >= b.threshold * initiation || energy * share >= b.area * b.toughness || b.damage > 0) {
        const before = b.damage;
        this._damageBond(b, available * share / (b.area * b.toughness), options.source ?? 'contact');
        result.work += (b.damage - before) * b.area * b.toughness; result.bondIds.push(b.id);
      }
    }
    return result;
  }

  _sweptImpacts() {
    this.world.propagateModifiedBodyPositionsToColliders();
    for (const p of this.projectiles) {
      const velocity = p.body.linvel(), position = p.body.translation(), rotation = p.body.rotation();
      let hit;
      if (!this.queryDirty) hit = this.world.castShape(position, rotation, velocity, p.collider.shape, 0, this.dt, true, undefined, undefined, p.collider, p.body);
      else {
        // Rapier 0.19 has no query-only broadphase refresh. Direct shape casts are
        // exact on newly created/rebuilt convex colliders and need no extra step.
        this.world.forEachCollider(c => {
          if (c.handle === p.collider.handle) return;
          const cast = c.castShape({ x: 0, y: 0, z: 0 }, p.collider.shape, position, rotation, velocity, 0, this.dt, true);
          if (!cast || (hit && cast.time_of_impact >= hit.time_of_impact)) return;
          const q = qarr(c.rotation());
          hit = { collider: c, time_of_impact: cast.time_of_impact,
            witness1: vec(add(arr(c.translation()), rotate(arr(cast.witness1), q))), normal1: vec(rotate(arr(cast.normal1), q)) };
        });
      }
      const f = hit && this.colliderMap.get(hit.collider.handle)?.fragment;
      if (!f?.component.fixed || !['glass', 'concrete'].includes(f.material) || p.sweptContacts.has(f.id)) continue;
      const normal = normalize(arr(hit.normal1)), speed = Math.max(0, -dot(arr(velocity), normal));
      if (speed < 0.1) continue;
      p.sweptContacts.add(f.id);
      const energy = 0.5 * p.mass * speed ** 2, impulse = p.mass * speed * (1 + Math.max(0.15, this.project.materials[f.material].restitution));
      const event = { type: 'swept-impact', source: 'swept-impact', tick: this.tick, projectileId: p.id, fragmentId: f.id,
        point: arr(hit.witness1), normal, timeOfImpact: hit.time_of_impact, speed, energy, estimatedImpulse: impulse,
        damageWork: 0, released: false };
      this.events.push(event);
      const result = this._damageAt(f, event.point, impulse, energy, speed, p.radius,
        { predictive: true, source: 'swept-impact', budget: p.damageBudget - p.damageSpent, exclude: p.predictedBonds });
      p.damageSpent += result.work; event.damageWork = result.work;
      for (const id of result.bondIds) p.predictedBonds.add(id);
      if (this.topologyDirty) this._rebuildComponents();
      event.released = !f.component.fixed;
    }
  }

  _gravityDamage() {
    const g = this.project.settings.gravity;
    if (g === 0) return;
    // Capacity-weighted multi-root paths avoid sending frame loads through weak glazing.
    if (!this.loadPaths || this.topologyDirty) {
      const parents = new Map(), order = [], distances = new Map(), visited = new Set();
      for (const s of this.supports) if (s.active) { parents.set(s.fragmentId, null); distances.set(s.fragmentId, 0); }
      while (true) {
        let id, shortest = Infinity;
        for (const [candidate, distance] of distances) if (!visited.has(candidate) && distance < shortest) { id = candidate; shortest = distance; }
        if (id === undefined) break;
        visited.add(id); order.push(id);
        for (const b of this.adjacency.get(id)) if (!b.broken) {
          const other = b.a === id ? b.b : b.a;
          const distance = length(sub(this.fragmentMap.get(id).initialPosition, this.fragmentMap.get(other).initialPosition));
          const cost = shortest + Math.max(0.001, distance) / (b.area * b.threshold);
          if (cost < (distances.get(other) ?? Infinity)) { parents.set(other, { id, bond: b }); distances.set(other, cost); }
        }
      }
      this.loadPaths = { parents, order };
    }
    const { parents, order } = this.loadPaths, loads = new Map();
    for (const id of order) { const f = this.fragmentMap.get(id); loads.set(id, { mass: f.mass, moment: scale(this._pose(f).position, f.mass) }); }
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i], parent = parents.get(id), load = loads.get(id);
      if (!parent) continue;
      const b = parent.bond, center = scale(load.moment, 1 / load.mass), offset = sub(center, this._bondPoint(b));
      const force = load.mass * g, bending = force * Math.hypot(offset[0], offset[2]);
      const stress = force / b.area + 6 * bending / (b.area * (b.sectionLength ?? Math.sqrt(b.area)));
      const onset = b.material === 'steel' ? (this.project.materials.steel.yieldFraction ?? 0.22) : 1;
      if (stress > b.threshold * onset) this._damageBond(b, this.dt * (stress / (b.threshold * onset) - 1), 'gravity');
      const p = loads.get(parent.id); p.mass += load.mass; p.moment = add(p.moment, load.moment);
    }
  }

  removeSupport(objectId) {
    this._assertLive();
    if (!this.project.objects.some(o => o.id === objectId)) throw new Error(`Unknown support object "${objectId}".`);
    const support = this.supports.find(s => s.objectId === objectId);
    if (!support?.active) return false;
    support.active = false; this.pendingEvents.push({ type: 'support-removed', tick: this.tick, objectId });
    this._rebuildComponents(); return true;
  }

  applyImpulse(point, direction, magnitude) {
    this._assertLive();
    for (const [name, value] of [['point', point], ['direction', direction]]) if (!Array.isArray(value) || value.length !== 3 || ![...value].every(Number.isFinite)) throw new Error(`Impulse ${name} must be three finite numbers.`);
    if (length(direction) < 1e-8 || !Number.isFinite(magnitude) || magnitude < 0 || magnitude > LIMITS.maxImpulse) throw new Error(`Impulse requires a nonzero direction and magnitude in [0, ${LIMITS.maxImpulse}].`);
    this.world.propagateModifiedBodyPositionsToColliders();
    let target, closest = Infinity, contact;
    for (const f of this.fragments) {
      const projection = f.collider.projectPoint(vec(point), true);
      if (!projection) continue;
      const p = arr(projection.point), distance = length(sub(p, point));
      if (distance < closest) { closest = distance; target = f; contact = p; }
    }
    // A localized poke must touch geometry; never select an arbitrarily distant object.
    if (!target || closest > 0.05 || magnitude === 0) return false;
    const impulse = scale(normalize(direction), magnitude);
    target.body.applyImpulseAtPoint(vec(impulse), vec(contact), true);
    this._damageAt(target, contact, magnitude, magnitude ** 2 / (2 * target.mass), magnitude / target.mass);
    this.pendingEvents.push({ type: 'impulse', tick: this.tick, fragmentId: target.id, point: contact, impulse: magnitude });
    if (this.topologyDirty) this._rebuildComponents();
    return true;
  }

  _spawn(impact) {
    if (impact.type === 'impulse') { this.applyImpulse(impact.position, impact.direction, impact.magnitude); return; }
    const velocity = scale(normalize(impact.direction), impact.speed);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...impact.position).setLinvel(...velocity).setCcdEnabled(true));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.ball(impact.radius).setMass(impact.mass).setFriction(0.35).setRestitution(0.15)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
    body.recomputeMassPropertiesFromColliders();
    const projectile = { ...impact, body, collider, damageBudget: 0.35 * 0.5 * impact.mass * impact.speed ** 2, damageSpent: 0,
      sweptContacts: new Set(), predictedBonds: new Set() };
    this.projectiles.push(projectile); this.colliderMap.set(collider.handle, { projectile }); this.queryDirty = true;
    this.events.push({ type: 'projectile-spawn', tick: this.tick, projectileId: impact.id });
  }

  step() {
    this._assertLive();
    if (this.tick >= LIMITS.maxTicks) return this.snapshot();
    this.events = this.pendingEvents.splice(0);
    for (const impact of this.impacts) if (!impact.fired && this.tick >= Math.ceil(impact.time / this.dt - 1e-9)) { impact.fired = true; this._spawn(impact); }
    this._sweptImpacts();
    const before = new Map();
    this.world.forEachRigidBody(body => before.set(body.handle, { velocity: arr(body.linvel()), angularVelocity: arr(body.angvel()), center: arr(body.worldCom()), mass: body.isFixed() ? Infinity : body.mass() }));
    this.world.timestep = this.dt; this.world.step(this.queue); this.tick++; this.queryDirty = false;
    this.queue.drainContactForceEvents(event => {
      let impulse = 0;
      const a = this.world.getCollider(event.collider1()), b = this.world.getCollider(event.collider2());
      if (!a || !b) return;
      let point, normal = arr(event.maxForceDirection());
      this.world.contactPair(a, b, manifold => {
        for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
        if (!point && manifold.numSolverContacts()) { point = arr(manifold.solverContactPoint(0)); normal = arr(manifold.normal()); }
      });
      if (!(impulse > 1e-7)) return;
      if (!point) { const contact = a.contactCollider(b, 0.01); if (contact) point = arr(contact.point1); }
      if (!point) return;
      const stateA = before.get(a.parent()?.handle), stateB = before.get(b.parent()?.handle);
      const velocityAt = s => s ? add(s.velocity, cross(s.angularVelocity, sub(point, s.center))) : [0, 0, 0];
      const speed = Math.abs(dot(sub(velocityAt(stateA), velocityAt(stateB)), normal));
      const invMass = (stateA ? 1 / stateA.mass : 0) + (stateB ? 1 / stateB.mass : 0);
      // Cap each pair's work by its pre-contact relative kinetic energy.
      const energy = invMass > 0 ? Math.min(0.5 * impulse * speed, 0.5 * speed ** 2 / invMass) : 0;
      const entryA = this.colliderMap.get(a.handle), entryB = this.colliderMap.get(b.handle);
      const recipients = [entryA?.fragment, entryB?.fragment].filter(Boolean);
      const radius = entryA?.projectile?.radius ?? entryB?.projectile?.radius ?? 0;
      const projectile = entryA?.projectile ?? entryB?.projectile;
      this.contactCount++; this.totalContactImpulse += impulse;
      const contactEvent = { type: 'contact', source: 'rapier-contact', tick: this.tick, a: entryA?.fragment?.id ?? entryA?.projectile?.id ?? 'ground',
        b: entryB?.fragment?.id ?? entryB?.projectile?.id ?? 'ground', point, impulse, energy, speed, damageWork: 0,
        predicted: recipients.some(f => projectile?.sweptContacts.has(f.id)) };
      this.events.push(contactEvent);
      for (const f of recipients) if (!projectile?.sweptContacts.has(f.id)) {
        const result = this._damageAt(f, point, impulse / recipients.length, energy / recipients.length, speed, radius,
          { budget: projectile ? projectile.damageBudget - projectile.damageSpent : Infinity, exclude: projectile?.predictedBonds });
        contactEvent.damageWork += result.work;
        if (projectile) projectile.damageSpent += result.work;
      }
    });
    this._gravityDamage();
    if (this.topologyDirty) this._rebuildComponents();
    return this.snapshot();
  }

  snapshot() {
    this._assertLive();
    const fragments = this.fragments.map(f => ({ id: f.id, ...this._pose(f), sleeping: f.body.isSleeping() || f.component.fixed, released: !f.component.fixed, bodyId: f.body.handle }));
    const bonds = this.bonds.map(({ id, damage, broken, yielded }) => ({ id, damage, broken, yielded }));
    return { tick: this.tick, time: this.tick * this.dt, fragments, bonds,
      projectiles: this.projectiles.map(p => ({ id: p.id, position: arr(p.body.translation()), rotation: qarr(p.body.rotation()), velocity: arr(p.body.linvel()),
        angularVelocity: arr(p.body.angvel()), radius: p.radius, mass: p.mass, damageBudget: p.damageBudget, damageSpent: p.damageSpent,
        sweptContacts: [...p.sweptContacts], predictedBonds: [...p.predictedBonds] })),
      impacts: this.impacts.map(({ id, fired }) => ({ id, fired })), events: clone([...this.events, ...this.pendingEvents]), supports: this.supports.map(s => ({ ...s })),
      stats: { active: fragments.filter(f => f.released && !f.sleeping).length, sleeping: fragments.filter(f => f.sleeping).length,
        released: fragments.filter(f => f.released).length, broken: bonds.filter(b => b.broken).length, yielded: bonds.filter(b => b.yielded).length,
        total: fragments.length, components: this.components.length, contacts: this.contactCount, contactImpulse: this.totalContactImpulse,
        mass: this.fragments.reduce((s, f) => s + f.mass, 0), complete: this.tick === LIMITS.maxTicks } };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.queue?.free(); this.world?.free(); this.colliderMap?.clear();
  }
}
