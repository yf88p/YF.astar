import { Euler, Quaternion, Vector3 } from "three";

const EPS = 1e-6;
const SKIN = 0.002;
const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const HALF_TURN = new Quaternion().setFromAxisAngle(AXES[1], Math.PI);
const V = (value) =>
  value?.isVector3 ? value.clone() : new Vector3().fromArray(value);
const Q = (value) =>
  value?.isQuaternion ? value.clone() : new Quaternion().fromArray(value);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finiteVector = (v) =>
  v?.isVector3 && [v.x, v.y, v.z].every(Number.isFinite);
const cap = (v, maximum) => {
  if (v.lengthSq() > maximum * maximum) v.setLength(maximum);
  return v;
};

export function cloneDocument(doc) {
  return structuredClone(doc);
}

export function portalRotation(a, b) {
  return Q(b.quaternion)
    .multiply(HALF_TURN)
    .multiply(Q(a.quaternion).invert())
    .normalize();
}

export function mapPoint(point, a, b) {
  return V(point)
    .sub(V(a.position))
    .applyQuaternion(portalRotation(a, b))
    .add(V(b.position));
}

export function mapDirection(direction, a, b) {
  return V(direction).applyQuaternion(portalRotation(a, b));
}

export function portalLocal(point, portal) {
  return V(point)
    .sub(V(portal.position))
    .applyQuaternion(Q(portal.quaternion).invert());
}

export function roomBounds(room) {
  const center = V(room.center),
    half = V(room.size).multiplyScalar(0.5);
  return { min: center.clone().sub(half), max: center.add(half) };
}

function axesOf(quaternion) {
  return AXES.map((axis) => axis.clone().applyQuaternion(quaternion));
}

function projectedHalf(half, axes) {
  return new Vector3(
    ...axes.map(
      (axis) =>
        Math.abs(axis.x) * half.x +
        Math.abs(axis.y) * half.y +
        Math.abs(axis.z) * half.z,
    ),
  );
}

function box(position, size, quaternion = [0, 0, 0, 1]) {
  return {
    center: V(position),
    half: V(size).multiplyScalar(0.5),
    axes: axesOf(Q(quaternion)),
  };
}

function boxesOverlap(a, b, margin = 0) {
  const delta = b.center.clone().sub(a.center);
  const axes = [
    ...a.axes,
    ...b.axes,
    ...a.axes.flatMap((x) =>
      b.axes.map((y) => new Vector3().crossVectors(x, y)),
    ),
  ];
  for (const axis of axes) {
    if (axis.lengthSq() < EPS) continue;
    axis.normalize();
    const extent = (o) =>
      o.axes.reduce(
        (sum, v, i) => sum + Math.abs(v.dot(axis)) * o.half.getComponent(i),
        0,
      );
    if (Math.abs(delta.dot(axis)) >= extent(a) + extent(b) - margin)
      return false;
  }
  return true;
}

function bodyHalf(body) {
  if (body.id === "player")
    return new Vector3(body.radius, body.halfHeight, body.radius);
  const axes = axesOf(body.quaternion),
    h = body.size / 2;
  return new Vector3(
    ...AXES.map((axis) =>
      axes.reduce((s, a) => s + Math.abs(a.dot(axis)) * h, 0),
    ),
  );
}

function portalHost(portal, room) {
  const normal = AXES[2].clone().applyQuaternion(Q(portal.quaternion));
  const axis = [0, 1, 2].find(
    (i) => Math.abs(normal.getComponent(i)) > 1 - 1e-5,
  );
  if (axis === undefined) return null;
  const bounds = roomBounds(room),
    sign = Math.sign(normal.getComponent(axis));
  const plane = (sign > 0 ? bounds.min : bounds.max).getComponent(axis);
  if (Math.abs(V(portal.position).getComponent(axis) - plane) > 1e-4)
    return null;
  return { axis, sign, normal, plane };
}

export function validateDocument(doc) {
  const errors = [];
  const error = (where, text) => errors.push(`${where}: ${text}`);
  const object = (x) =>
    x !== null && typeof x === "object" && !Array.isArray(x);
  const string = (x) =>
    typeof x === "string" && x.trim().length > 0 && x.length <= 500;
  const vector = (x, n = 3) =>
    Array.isArray(x) &&
    x.length === n &&
    Array.from(x).every(
      (v) =>
        typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 10000,
    );
  const size = (x) => vector(x) && x.every((n) => n >= 0.02 && n <= 500);
  const quaternion = (x) =>
    vector(x, 4) && Math.abs(x.reduce((s, n) => s + n * n, 0) - 1) < 1e-4;
  const color = (x) => typeof x === "string" && /^#[\da-f]{6}$/i.test(x);
  if (!object(doc))
    return { valid: false, errors: ["document: expected an object"] };
  if (doc.version !== 1) error("version", "only version 1 is supported");
  for (const key of ["id", "name", "description", "lesson"])
    if (!string(doc[key])) error(key, "expected a nonempty string");
  if (!color(doc.accent)) error("accent", "expected a six-digit hex color");
  const collections = [
    "rooms",
    "blocks",
    "portals",
    "cubes",
    "plates",
    "doors",
    "goals",
  ];
  for (const key of collections)
    if (!Array.isArray(doc[key])) error(key, "expected an array");
  if (errors.some((e) => e.endsWith("expected an array")))
    return { valid: false, errors };
  if (!doc.rooms.length) error("rooms", "at least one room is required");
  const ids = new Set(["player"]);
  for (const key of collections) {
    if (doc[key].length > 1000)
      error(key, "at most 1000 entities are supported");
    Array.from(doc[key]).forEach((entity, i) => {
      const where = `${key}[${i}]`;
      if (!object(entity)) {
        error(where, "expected an object");
        return;
      }
      if (!string(entity.id) || ids.has(entity.id))
        error(where, "id must be unique, nonempty, and not player");
      ids.add(entity.id);
      if (key === "rooms") {
        if (
          !string(entity.name) ||
          !color(entity.color) ||
          !vector(entity.center) ||
          !size(entity.size)
        )
          error(where, "invalid room name, color, center, or size");
        if (size(entity.size) && entity.size.some((n) => n < 2))
          error(where, "rooms must be at least 2 meters on each axis");
      } else {
        if (!string(entity.room) || !vector(entity.position))
          error(where, "invalid room or position");
        if (
          ["blocks", "plates", "doors", "goals"].includes(key) &&
          !size(entity.size)
        )
          error(where, "invalid size");
        if (
          key === "blocks" &&
          entity.rotation !== undefined &&
          !quaternion(entity.rotation)
        )
          error(where, "rotation must be a unit quaternion");
        if (
          key === "cubes" &&
          (!(entity.size >= 0.1 && entity.size <= 2) ||
            typeof entity.size !== "number" ||
            !quaternion(entity.quaternion))
        )
          error(where, "invalid cube size or unit quaternion");
        if (key === "portals") {
          if (!quaternion(entity.quaternion))
            error(where, "quaternion must be finite and unit length");
          if (
            ![entity.width, entity.height].every(
              (n) =>
                typeof n === "number" &&
                Number.isFinite(n) &&
                n >= 1 &&
                n <= 20,
            )
          )
            error(where, "portal dimensions must be between 1 and 20 meters");
          if (
            !string(entity.linkedTo) ||
            typeof entity.enabled !== "boolean" ||
            !color(entity.color)
          )
            error(where, "invalid linkedTo, enabled, or color");
        }
        for (const field of key === "plates"
          ? ["doorIds"]
          : key === "goals"
            ? ["requires"]
            : []) {
          if (
            !Array.isArray(entity[field]) ||
            !Array.from(entity[field]).every(string) ||
            new Set(entity[field]).size !== entity[field].length
          )
            error(where, `${field} must contain unique door ids`);
        }
      }
    });
  }
  const physics = doc.physics;
  if (
    !object(physics) ||
    !Number.isFinite(physics.gravity) ||
    physics.gravity < 0 ||
    physics.gravity > 50 ||
    !Number.isFinite(physics.fixedDt) ||
    Math.abs(physics.fixedDt - 1 / 120) > 1e-10 ||
    !Number.isInteger(physics.maxSubsteps) ||
    physics.maxSubsteps < 1 ||
    physics.maxSubsteps > 12 ||
    !Number.isFinite(physics.maxSpeed) ||
    physics.maxSpeed <= 0 ||
    physics.maxSpeed > 28
  ) {
    error(
      "physics",
      "use gravity 0..50, fixedDt 1/120, maxSubsteps 1..12, and maxSpeed (0,28]",
    );
  }
  if (
    !object(doc.spawn) ||
    !string(doc.spawn.room) ||
    !vector(doc.spawn.position) ||
    !Number.isFinite(doc.spawn.yaw) ||
    !Number.isFinite(doc.spawn.pitch) ||
    Math.abs(doc.spawn.pitch) > Math.PI / 2
  )
    error("spawn", "invalid spawn transform");
  if (errors.length) return { valid: false, errors };
  const rooms = new Map(doc.rooms.map((r) => [r.id, r]));
  const portals = new Map(doc.portals.map((p) => [p.id, p]));
  const doors = new Set(doc.doors.map((d) => d.id));
  const fits = (position, half, room, tolerance = 1e-4) => {
    const { min, max } = roomBounds(room);
    return AXES.every(
      (_, i) =>
        position.getComponent(i) - half.getComponent(i) >=
          min.getComponent(i) - tolerance &&
        position.getComponent(i) + half.getComponent(i) <=
          max.getComponent(i) + tolerance,
    );
  };
  for (let i = 0; i < doc.rooms.length; i++)
    for (let j = i + 1; j < doc.rooms.length; j++) {
      if (
        boxesOverlap(
          box(doc.rooms[i].center, doc.rooms[i].size),
          box(doc.rooms[j].center, doc.rooms[j].size),
          0.001,
        )
      )
        error(doc.rooms[j].id, "room interiors must not overlap");
    }
  for (const key of collections.slice(1))
    for (const entity of doc[key]) {
      const room = rooms.get(entity.room);
      if (!room) {
        error(entity.id, `unknown room ${entity.room}`);
        continue;
      }
      if (key !== "portals") {
        const half =
          key === "cubes"
            ? bodyHalf({ ...entity, quaternion: Q(entity.quaternion) })
            : V(entity.size).multiplyScalar(0.5);
        const worldHalf =
          key === "blocks" && entity.rotation
            ? projectedHalf(half, axesOf(Q(entity.rotation).invert()))
            : half;
        if (!fits(V(entity.position), worldHalf, room))
          error(entity.id, "entity must fit inside its room");
      }
      for (const id of entity.doorIds || entity.requires || [])
        if (!doors.has(id)) error(entity.id, `unknown required door ${id}`);
    }
  if (!rooms.has(doc.spawn.room)) error("spawn", "unknown room");
  else if (
    !fits(
      V(doc.spawn.position),
      new Vector3(0.28, 0.85, 0.28),
      rooms.get(doc.spawn.room),
    )
  )
    error("spawn", "player body must fit inside its room");
  for (const portal of doc.portals) {
    const room = rooms.get(portal.room),
      pair = portals.get(portal.linkedTo);
    if (!pair || pair.id === portal.id || pair.linkedTo !== portal.id)
      error(portal.id, "portal links must be mutual, distinct, and exist");
    else if (
      Math.abs(pair.width - portal.width) > EPS ||
      Math.abs(pair.height - portal.height) > EPS
    )
      error(portal.id, "paired portal dimensions must match");
    if (!room) continue;
    const host = portalHost(portal, room);
    if (!host) {
      error(
        portal.id,
        "portal must lie on a room boundary with an inward, axis-aligned normal",
      );
      continue;
    }
    const axes = axesOf(Q(portal.quaternion));
    const half = axes[0]
      .clone()
      .set(Math.abs(axes[0].x), Math.abs(axes[0].y), Math.abs(axes[0].z))
      .multiplyScalar(portal.width / 2)
      .add(
        axes[1]
          .clone()
          .set(Math.abs(axes[1].x), Math.abs(axes[1].y), Math.abs(axes[1].z))
          .multiplyScalar(portal.height / 2),
      );
    if (!fits(V(portal.position), half, room))
      error(portal.id, "portal aperture must fit inside its host surface");
    const throat = {
      center: V(portal.position).addScaledVector(host.normal, 0.5),
      half: new Vector3(portal.width / 2, portal.height / 2, 0.5),
      axes,
    };
    for (const obstacle of [...doc.blocks, ...doc.doors].filter(
      (o) => o.room === portal.room,
    )) {
      if (
        boxesOverlap(
          throat,
          box(obstacle.position, obstacle.size, obstacle.rotation),
          0.001,
        )
      )
        error(
          portal.id,
          `portal needs one meter of destination clearance from ${obstacle.id}`,
        );
    }
    for (const other of doc.portals) {
      if (other.id <= portal.id || other.room !== portal.room) continue;
      const otherHost = portalHost(other, room);
      if (
        !otherHost ||
        host.axis !== otherHost.axis ||
        host.sign !== otherHost.sign
      )
        continue;
      const aperture = {
        center: V(portal.position),
        half: new Vector3(portal.width / 2, portal.height / 2, 0.01),
        axes,
      };
      if (
        boxesOverlap(aperture, {
          center: V(other.position),
          half: new Vector3(other.width / 2, other.height / 2, 0.01),
          axes: axesOf(Q(other.quaternion)),
        })
      )
        error(portal.id, `aperture overlaps ${other.id}`);
    }
  }
  for (const entity of [
    {
      id: "spawn",
      room: doc.spawn.room,
      position: doc.spawn.position,
      size: [0.56, 1.7, 0.56],
    },
    ...doc.cubes.map((c) => ({
      ...c,
      size: [c.size, c.size, c.size],
      rotation: c.quaternion,
    })),
  ]) {
    for (const obstacle of [...doc.blocks, ...doc.doors, ...doc.plates].filter(
      (o) => o.room === entity.room,
    )) {
      if (
        boxesOverlap(
          box(entity.position, entity.size, entity.rotation),
          box(obstacle.position, obstacle.size, obstacle.rotation),
          0.005,
        )
      )
        error(entity.id, `initial body overlaps ${obstacle.id}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function rayBox(origin, direction, obstacle, maximum) {
  const relative = origin.clone().sub(obstacle.center);
  let near = 0,
    far = maximum;
  for (let i = 0; i < 3; i++) {
    const p = relative.dot(obstacle.axes[i]),
      d = direction.dot(obstacle.axes[i]),
      h = obstacle.half.getComponent(i);
    if (Math.abs(d) < EPS) {
      if (Math.abs(p) > h) return null;
      continue;
    }
    let a = (-h - p) / d,
      b = (h - p) / d;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return null;
  }
  return far >= 0 && near <= maximum ? near : null;
}

export class World {
  constructor(doc) {
    const result = validateDocument(doc);
    if (!result.valid)
      throw new Error(`Invalid world document:\n${result.errors.join("\n")}`);
    this._initial = cloneDocument(doc);
    this.reset();
  }

  reset() {
    this.doc = cloneDocument(this._initial);
    this.rooms = new Map(this.doc.rooms.map((r) => [r.id, r]));
    this.portals = new Map(this.doc.portals.map((p) => [p.id, p]));
    this.player = {
      id: "player",
      room: this.doc.spawn.room,
      position: V(this.doc.spawn.position),
      velocity: new Vector3(),
      quaternion: new Quaternion(),
      angularVelocity: new Vector3(),
      grounded: false,
      radius: 0.28,
      halfHeight: 0.85,
    };
    this.cubes = new Map(
      this.doc.cubes.map((c) => [
        c.id,
        {
          id: c.id,
          room: c.room,
          position: V(c.position),
          velocity: new Vector3(),
          quaternion: Q(c.quaternion),
          angularVelocity: new Vector3(),
          size: c.size,
          mass: c.size ** 3,
          grounded: false,
        },
      ]),
    );
    this.plates = new Map(
      this.doc.plates.map((p) => [p.id, { active: false }]),
    );
    this.doors = new Map(
      this.doc.doors.map((d) => [d.id, { open: 0, active: false }]),
    );
    this.completed = false;
    this.time = 0;
    this.events = [];
    this.held = null;
    this.crossings = 0;
    this.lastMapping = null;
    this._accumulator = 0;
    this._jumpBuffer = 0;
    this._viewFrame = new Quaternion();
    this._eyeOffset = new Vector3(0, 0.67, 0);
    this.input = {
      forward: 0,
      strafe: 0,
      jump: false,
      yaw: this.doc.spawn.yaw,
      pitch: this.doc.spawn.pitch,
    };
    this.look(this.input.yaw, this.input.pitch);
    for (const body of this._bodies())
      body._safe = {
        room: body.room,
        position: body.position.clone(),
        quaternion: body.quaternion.clone(),
        viewFrame: this._viewFrame.clone(),
        eyeOffset: this._eyeOffset.clone(),
      };
    return this;
  }

  _bodies() {
    return [this.player, ...this.cubes.values()];
  }

  _event(type, detail = {}) {
    this.events.push({ type, time: this.time, ...detail });
    if (this.events.length > 256)
      this.events.splice(0, this.events.length - 256);
  }

  setInput(input = {}) {
    if (!input || typeof input !== "object") return;
    for (const key of ["forward", "strafe"])
      if (Number.isFinite(input[key]))
        this.input[key] = clamp(input[key], -1, 1);
    if (input.jump !== undefined) {
      if (input.jump && !this.input.jump) this._jumpBuffer = 0.12;
      this.input.jump = Boolean(input.jump);
    }
    this.look(
      Number.isFinite(input.yaw) ? input.yaw : this.input.yaw,
      Number.isFinite(input.pitch) ? input.pitch : this.input.pitch,
    );
  }

  look(yaw, pitch) {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    this.input.yaw = yaw;
    this.input.pitch = clamp(pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.player.quaternion
      .copy(this._viewFrame)
      .multiply(
        new Quaternion().setFromEuler(
          new Euler(this.input.pitch, yaw, 0, "YXZ"),
        ),
      )
      .normalize();
  }

  cameraFrame() {
    let position = this.player.position.clone().add(this._eyeOffset);
    let quaternion = this.player.quaternion.clone(),
      room = this.player.room;
    for (const portal of this.doc.portals) {
      if (portal.room !== room || !this._pair(portal)) continue;
      const local = portalLocal(position, portal),
        bodyLocal = portalLocal(this.player.position, portal);
      if (
        local.z < 0 &&
        bodyLocal.z >= -EPS &&
        Math.abs(local.x) < portal.width / 2 &&
        Math.abs(local.y) < portal.height / 2
      ) {
        const destination = this._pair(portal);
        position = mapPoint(position, portal, destination);
        quaternion.premultiply(portalRotation(portal, destination));
        room = destination.room;
        break;
      }
    }
    return { position, quaternion, room };
  }

  advance(realDt) {
    if (!Number.isFinite(realDt) || realDt <= 0) return 0;
    const { fixedDt, maxSubsteps } = this.doc.physics;
    this._accumulator += Math.min(realDt, fixedDt * maxSubsteps);
    let steps = 0;
    while (this._accumulator + 1e-10 >= fixedDt && steps < maxSubsteps) {
      this.step(fixedDt);
      this._accumulator -= fixedDt;
      steps++;
    }
    this._accumulator = Math.max(0, this._accumulator % fixedDt);
    return steps;
  }

  step(dt = this.doc.physics.fixedDt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Public larger steps are also bounded; elapsed overload is intentionally discarded.
    if (dt > this.doc.physics.fixedDt + EPS) {
      const ticks = Math.min(
        this.doc.physics.maxSubsteps,
        Math.ceil(dt / this.doc.physics.fixedDt),
      );
      for (let i = 0; i < ticks; i++)
        this.step(
          Math.min(this.doc.physics.fixedDt, dt - i * this.doc.physics.fixedDt),
        );
      return;
    }
    this.time += dt;
    // The eye rig maps rigidly at crossing. Its later comfort recovery never
    // rotates physical velocity or applies the portal rotation a second time.
    this._eyeOffset.lerp(new Vector3(0, 0.67, 0), 1 - Math.exp(-5 * dt));
    const p = this.player,
      wasGrounded = p.grounded;
    const forward = new Vector3(0, 0, -1).applyQuaternion(p.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < EPS)
      forward.set(-Math.sin(this.input.yaw), 0, -Math.cos(this.input.yaw));
    forward.normalize();
    const right = new Vector3().crossVectors(forward, AXES[1]);
    const wish = forward
      .multiplyScalar(this.input.forward)
      .addScaledVector(right, this.input.strafe);
    cap(wish, 1).multiplyScalar(5.8);
    const acceleration = wasGrounded ? 38 : 6;
    const horizontal = new Vector3(
      wish.x - p.velocity.x,
      0,
      wish.z - p.velocity.z,
    );
    // Air input adds steering without erasing redirected portal momentum.
    if (wasGrounded || wish.lengthSq() > 0)
      p.velocity.add(cap(horizontal, acceleration * dt));
    if (this._jumpBuffer > 0 && wasGrounded) {
      p.velocity.y = 5.6;
      this._jumpBuffer = 0;
      p.grounded = false;
    }
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    const holdTarget = this.held ? this._heldTarget() : null;
    for (const body of this._bodies()) {
      body.grounded = false;
      if (body._exit) {
        body._exit.time -= dt;
        if (body._exit.time <= 0) body._exit = null;
      }
      if (this.held?.id === body.id && holdTarget) {
        body.velocity.copy(
          holdTarget.clone().sub(body.position).multiplyScalar(14),
        );
        cap(body.velocity, 14);
        body.angularVelocity.multiplyScalar(Math.exp(-10 * dt));
      } else body.velocity.y -= this.doc.physics.gravity * dt;
      cap(body.velocity, this.doc.physics.maxSpeed);
      const oldQuaternion = body.quaternion.clone();
      if (body.id !== "player" && body.angularVelocity.lengthSq() > EPS) {
        body.quaternion
          .premultiply(
            new Quaternion().setFromAxisAngle(
              body.angularVelocity.clone().normalize(),
              body.angularVelocity.length() * dt,
            ),
          )
          .normalize();
        if (!this._positionClear(body, body.position, body.room))
          body.quaternion.copy(oldQuaternion);
      }
      this.moveBody(body, body.velocity.clone().multiplyScalar(dt));
      if (body.id !== "player" && body.grounded && this.held?.id !== body.id) {
        body.velocity.x *= Math.exp(-7 * dt);
        body.velocity.z *= Math.exp(-7 * dt);
        body.angularVelocity.multiplyScalar(Math.exp(-6 * dt));
      }
    }
    this._updateMechanisms(dt);
  }

  _pair(portal) {
    const pair = this.portals.get(portal.linkedTo);
    return portal.enabled && pair?.enabled && pair.linkedTo === portal.id
      ? pair
      : null;
  }

  _aperture(body, point, portal, checkDestination = true) {
    if (!this._pair(portal)) return false;
    const local = portalLocal(point, portal),
      extents = projectedHalf(bodyHalf(body), axesOf(Q(portal.quaternion)));
    if (
      Math.abs(local.x) + extents.x > portal.width / 2 - SKIN ||
      Math.abs(local.y) + extents.y > portal.height / 2 + EPS
    )
      return false;
    if (checkDestination) {
      const destination = this._pair(portal),
        mapped = {
          ...body,
          quaternion: portalRotation(portal, destination).multiply(
            body.quaternion,
          ),
        };
      return this._aperture(
        mapped,
        mapPoint(point, portal, destination),
        destination,
        false,
      );
    }
    return true;
  }

  _opening(body, point, room, axis, sign, ghost = false) {
    return this.doc.portals.find((portal) => {
      if (portal.room !== room || !this._pair(portal)) return false;
      const host = portalHost(portal, this.rooms.get(room));
      const depth = projectedHalf(
        bodyHalf(body),
        axesOf(Q(portal.quaternion)),
      ).z;
      return (
        host.axis === axis &&
        host.sign === sign &&
        (ghost || portalLocal(point, portal).z >= -depth - SKIN) &&
        this._aperture(body, point, portal)
      );
    });
  }

  _obstacles(room, exceptId) {
    const obstacles = [];
    for (const type of ["blocks", "plates", "doors"])
      for (const entity of this.doc[type]) {
        if (entity.room !== room) continue;
        let position = V(entity.position);
        if (type === "doors") {
          const state = this.doors.get(entity.id);
          if (state.open >= 0.995) continue;
          position.y += state.open * (entity.size[1] + 0.2);
        }
        obstacles.push({
          ...box(position, entity.size, entity.rotation),
          id: entity.id,
          type: type.slice(0, -1),
        });
      }
    for (const body of this._bodies()) {
      if (body.id === exceptId) continue;
      const type = body.id === "player" ? "player" : "cube";
      if (body.room === room)
        obstacles.push({
          ...box(body.position, bodyHalf(body).multiplyScalar(2)),
          id: body.id,
          type,
          body,
        });
      const straddle = this.getStraddle(body);
      if (straddle?.destination.room === room) {
        const { portal, destination } = straddle;
        const mapped = {
          ...body,
          quaternion: portalRotation(portal, destination).multiply(
            body.quaternion,
          ),
        };
        obstacles.push({
          ...box(
            mapPoint(body.position, portal, destination),
            bodyHalf(mapped).multiplyScalar(2),
          ),
          id: body.id,
          type,
          body,
          ghost: straddle,
        });
      }
    }
    return obstacles;
  }

  _positionClear(body, position, room, ghost = false) {
    const bounds = roomBounds(this.rooms.get(room)),
      half = bodyHalf(body);
    for (let axis = 0; axis < 3; axis++)
      for (const sign of [1, -1]) {
        const limit = (sign > 0 ? bounds.min : bounds.max).getComponent(axis);
        if (
          sign * (position.getComponent(axis) - limit) <
            half.getComponent(axis) - SKIN &&
          !this._opening(body, position, room, axis, sign, ghost)
        )
          return false;
      }
    const own = box(position, half.clone().multiplyScalar(2));
    if (this._obstacles(room, body.id).some((o) => boxesOverlap(own, o, SKIN)))
      return false;
    if (!ghost) {
      const portal = this.doc.portals.find(
        (p) =>
          p.room === room &&
          Math.abs(portalLocal(position, p).z) <
            projectedHalf(half, axesOf(Q(p.quaternion))).z &&
          this._aperture(body, position, p),
      );
      if (portal) {
        const destination = this._pair(portal);
        const mapped = {
          ...body,
          quaternion: portalRotation(portal, destination).multiply(
            body.quaternion,
          ),
        };
        if (
          !this._positionClear(
            mapped,
            mapPoint(position, portal, destination),
            destination.room,
            true,
          )
        )
          return false;
      }
    }
    return true;
  }

  _contact(body, normal, obstacle) {
    const into = body.velocity.dot(normal);
    if (into < 0) {
      body.velocity.addScaledVector(normal, -into);
      if (
        obstacle?.body &&
        normal.y < 0.5 &&
        normal.y > -0.5 &&
        this.held?.id !== obstacle.id
      ) {
        const push = obstacle.ghost
          ? mapDirection(
              normal,
              obstacle.ghost.destination,
              obstacle.ghost.portal,
            )
          : normal;
        obstacle.body.velocity.addScaledVector(push, into * 0.4);
        cap(obstacle.body.velocity, this.doc.physics.maxSpeed);
      }
    }
    if (normal.y > 0.6) body.grounded = true;
  }

  _resolve(body, desired, previous) {
    const room = this.rooms.get(body.room),
      bounds = roomBounds(room),
      half = bodyHalf(body);
    const obstacles = this._obstacles(body.room, body.id);
    for (let pass = 0; pass < 4; pass++) {
      let corrected = false;
      for (const axis of [1, 0, 2])
        for (const sign of [1, -1]) {
          const limit = (sign > 0 ? bounds.min : bounds.max).getComponent(axis);
          if (
            sign * (desired.getComponent(axis) - limit) >=
            half.getComponent(axis)
          )
            continue;
          const portal = this._opening(body, desired, body.room, axis, sign);
          if (portal) {
            const destination = this._pair(portal),
              mapped = {
                ...body,
                quaternion: portalRotation(portal, destination).multiply(
                  body.quaternion,
                ),
              };
            if (
              this._positionClear(
                mapped,
                mapPoint(desired, portal, destination),
                destination.room,
                true,
              )
            )
              continue;
          }
          desired.setComponent(axis, limit + sign * half.getComponent(axis));
          this._contact(body, AXES[axis].clone().multiplyScalar(sign));
          corrected = true;
        }
      for (const obstacle of obstacles) {
        const relative = desired.clone().sub(obstacle.center),
          old = previous.clone().sub(obstacle.center);
        const extents = projectedHalf(half, obstacle.axes).add(obstacle.half);
        const local = obstacle.axes.map((axis) => relative.dot(axis));
        const depths = local.map(
          (value, axis) => extents.getComponent(axis) - Math.abs(value),
        );
        if (depths.some((depth) => depth <= EPS)) continue;
        const separated = obstacle.axes
          .map((axis, i) =>
            Math.abs(old.dot(axis)) >= extents.getComponent(i) - SKIN ? i : -1,
          )
          .filter((i) => i >= 0);
        const choices = separated.length ? separated : [0, 1, 2];
        const axis = choices.reduce(
          (best, i) => (depths[i] < depths[best] ? i : best),
          choices[0],
        );
        const sign =
          Math.sign(local[axis]) ||
          Math.sign(old.dot(obstacle.axes[axis])) ||
          1;
        const normal = obstacle.axes[axis].clone().multiplyScalar(sign);
        desired.addScaledVector(normal, depths[axis] + EPS);
        this._contact(body, normal, obstacle);
        corrected = true;
      }
      if (!corrected) break;
    }
    return desired;
  }

  moveBody(body, delta) {
    if (
      !body ||
      !finiteVector(body.position) ||
      !finiteVector(delta) ||
      !this.rooms.has(body.room)
    )
      return body;
    const displacement = delta.clone();
    // Every segment is at most 8 cm, including public scripted moves. Cap work explicitly.
    if (displacement.length() > 40.96) {
      displacement.setLength(40.96);
      this._event("movement-clamped", { id: body.id });
    }
    const count = Math.min(
      512,
      Math.max(1, Math.ceil(displacement.length() / 0.08)),
    );
    const segment = displacement.divideScalar(count);
    for (let index = 0; index < count; index++) {
      const previous = body.position.clone();
      // Resolve support first: gravity must not invalidate a floor-flush aperture
      // before the swept center-plane test has a chance to see the crossing.
      const desired = this._resolve(
        body,
        previous.clone().add(segment),
        previous,
      );
      let crossing = null;
      for (const portal of this.doc.portals) {
        if (portal.room !== body.room || !this._pair(portal)) continue;
        const a = portalLocal(previous, portal),
          b = portalLocal(desired, portal);
        if (a.z < -EPS || b.z >= 0 || a.z - b.z <= EPS) continue;
        const fraction = clamp(a.z / (a.z - b.z), 0, 1),
          point = previous.clone().lerp(desired, fraction);
        if (!this._aperture(body, point, portal)) continue;
        if (!crossing || fraction < crossing.fraction)
          crossing = { portal, fraction, point };
      }
      if (crossing) {
        const { portal, point } = crossing,
          destination = this._pair(portal),
          rotation = portalRotation(portal, destination);
        const normal = AXES[2]
          .clone()
          .applyQuaternion(Q(destination.quaternion));
        const mappedPoint = mapPoint(
          point,
          portal,
          destination,
        ).addScaledVector(normal, SKIN);
        const mappedEnd = mapPoint(
          desired,
          portal,
          destination,
        ).addScaledVector(normal, SKIN);
        const mappedBody = {
          ...body,
          quaternion: rotation.clone().multiply(body.quaternion),
        };
        if (
          body._exit?.id !== portal.id &&
          this._positionClear(
            mappedBody,
            mappedPoint,
            destination.room,
            true,
          ) &&
          this._positionClear(mappedBody, mappedEnd, destination.room, true)
        ) {
          const before = body.velocity.clone();
          body.room = destination.room;
          body.position.copy(mappedEnd);
          body.velocity.applyQuaternion(rotation);
          body.quaternion.premultiply(rotation).normalize();
          body.angularVelocity.applyQuaternion(rotation);
          body.grounded = false;
          body._exit = { id: destination.id, time: 0.035 };
          if (body.id === "player") {
            this._viewFrame.premultiply(rotation).normalize();
            this._eyeOffset.applyQuaternion(rotation);
          }
          segment.applyQuaternion(rotation);
          this.crossings++;
          this.lastMapping = {
            id: body.id,
            from: portal.id,
            to: destination.id,
            source: portal.id,
            destination: destination.id,
            time: this.time,
            rotation: rotation.clone(),
            positionBefore: point.clone(),
            positionAfter: body.position.clone(),
            velocityBefore: before,
            velocityAfter: body.velocity.clone(),
            speedBefore: before.length(),
            speedAfter: body.velocity.length(),
          };
          this._event("crossing", {
            id: body.id,
            from: portal.id,
            to: destination.id,
          });
          continue;
        }
        // A blocked destination or a just-crossed exit behaves as a solid plane.
        const sourceNormal = AXES[2]
          .clone()
          .applyQuaternion(Q(portal.quaternion));
        const extent = projectedHalf(
          bodyHalf(body),
          axesOf(Q(portal.quaternion)),
        ).z;
        desired
          .copy(point)
          .addScaledVector(
            sourceNormal,
            body._exit?.id === portal.id ? SKIN : extent + SKIN,
          );
        this._contact(body, sourceNormal);
        this._resolve(body, desired, previous);
      }
      body.position.copy(desired);
      const straddle = this.getStraddle(body);
      if (!straddle && this._positionClear(body, body.position, body.room))
        body._safe = {
          room: body.room,
          position: body.position.clone(),
          quaternion: body.quaternion.clone(),
          viewFrame: this._viewFrame.clone(),
          eyeOffset: this._eyeOffset.clone(),
        };
    }
    return body;
  }

  getStraddle(body) {
    const half = bodyHalf(body);
    for (const portal of this.doc.portals) {
      if (portal.room !== body.room || !this._pair(portal)) continue;
      const local = portalLocal(body.position, portal),
        extent = projectedHalf(half, axesOf(Q(portal.quaternion))).z;
      if (
        local.z >= -SKIN &&
        local.z < extent + SKIN &&
        this._aperture(body, body.position, portal)
      )
        return { portal, destination: this._pair(portal) };
    }
    return null;
  }

  setPortalEnabled(id, enabled) {
    const portal = this.portals.get(id);
    if (!portal || typeof enabled !== "boolean") return false;
    if (portal.enabled === enabled) return true;
    const affected = [portal, this.portals.get(portal.linkedTo)].filter(
      Boolean,
    );
    portal.enabled = enabled;
    if (!enabled)
      for (const body of this._bodies())
        for (const surface of affected) {
          if (body.room !== surface.room) continue;
          const local = portalLocal(body.position, surface),
            axes = axesOf(Q(surface.quaternion)),
            extent = projectedHalf(bodyHalf(body), axes);
          if (
            Math.abs(local.z) > extent.z + 0.03 ||
            Math.abs(local.x) > surface.width / 2 + extent.x ||
            Math.abs(local.y) > surface.height / 2 + extent.y
          )
            continue;
          const candidate = body.position
            .clone()
            .addScaledVector(axes[2], extent.z + SKIN - local.z);
          if (this._positionClear(body, candidate, body.room))
            body.position.copy(candidate);
          else if (
            body._safe &&
            this._positionClear(
              { ...body, quaternion: body._safe.quaternion },
              body._safe.position,
              body._safe.room,
            )
          ) {
            body.room = body._safe.room;
            body.position.copy(body._safe.position);
            body.quaternion.copy(body._safe.quaternion);
            if (body.id === "player") {
              this._viewFrame.copy(body._safe.viewFrame);
              this._eyeOffset.copy(body._safe.eyeOffset);
            }
          } else {
            // Refuse closure if both recovery poses are occupied, rather than embed a body.
            portal.enabled = true;
            return false;
          }
          body.velocity.set(0, 0, 0);
          body.angularVelocity.set(0, 0, 0);
          body._exit = null;
          if (this.held?.id === body.id) this.held = null;
        }
    this._event("portal-enabled", { id, enabled });
    return true;
  }

  _trace(origin, direction, maximum, budget, room, ignore = new Set()) {
    let position = origin.clone(),
      ray = direction.clone().normalize(),
      remaining = maximum,
      distance = 0;
    const path = [],
      segments = [];
    for (let traversal = 0; traversal <= budget; traversal++) {
      const bounds = roomBounds(this.rooms.get(room));
      let wallDistance = Infinity;
      for (let axis = 0; axis < 3; axis++) {
        const d = ray.getComponent(axis);
        if (Math.abs(d) < EPS) continue;
        const t =
          ((d > 0 ? bounds.max : bounds.min).getComponent(axis) -
            position.getComponent(axis)) /
          d;
        if (t >= -SKIN) wallDistance = Math.min(wallDistance, Math.max(0, t));
      }
      let nearest = Math.min(remaining, wallDistance),
        hit = wallDistance <= remaining ? { id: room, type: "wall" } : null;
      for (const obstacle of this._obstacles(room, "player")) {
        if (ignore.has(obstacle.id)) continue;
        let rayShape = obstacle;
        if (obstacle.type === "cube") {
          const body = obstacle.body;
          const quaternion = obstacle.ghost
            ? portalRotation(
                obstacle.ghost.portal,
                obstacle.ghost.destination,
              ).multiply(body.quaternion)
            : body.quaternion;
          rayShape = box(
            obstacle.center,
            [body.size, body.size, body.size],
            quaternion,
          );
        }
        const t = rayBox(position, ray, rayShape, nearest);
        if (t !== null && t <= nearest) {
          nearest = t;
          hit = { id: obstacle.id, type: obstacle.type };
        }
      }
      let portalHit = null;
      for (const portal of this.doc.portals) {
        if (portal.room !== room || !this._pair(portal)) continue;
        const local = portalLocal(position, portal),
          localRay = ray.clone().applyQuaternion(Q(portal.quaternion).invert());
        if (localRay.z >= -EPS || local.z < -SKIN) continue;
        const t = -local.z / localRay.z;
        if (t < -EPS || t > nearest + EPS) continue;
        const at = local.clone().addScaledVector(localRay, Math.max(0, t));
        if (
          Math.abs(at.x) >= portal.width / 2 ||
          Math.abs(at.y) >= portal.height / 2
        )
          continue;
        if (hit && hit.type !== "wall" && t >= nearest - EPS) continue;
        portalHit = portal;
        nearest = Math.max(0, t);
      }
      const point = position.clone().addScaledVector(ray, nearest);
      segments.push({
        room,
        start: position.clone(),
        end: point.clone(),
        direction: ray.clone(),
        exitPortal: portalHit?.id || null,
      });
      if (!portalHit || traversal === budget) {
        if (portalHit) hit = { id: portalHit.id, type: "portal" };
        return {
          hit: hit
            ? {
                ...hit,
                point,
                distance: distance + nearest,
                path: [...path],
                room,
              }
            : null,
          end: point,
          direction: ray,
          room,
          path,
          segments,
        };
      }
      const destination = this._pair(portalHit);
      distance += nearest;
      remaining -= nearest;
      path.push(portalHit.id);
      position = mapPoint(point, portalHit, destination);
      ray = mapDirection(ray, portalHit, destination);
      room = destination.room;
      if (remaining <= EPS)
        return {
          hit: null,
          end: position,
          direction: ray,
          room,
          path,
          segments,
        };
    }
    return null;
  }

  raycast(
    origin,
    direction,
    maxDistance = 5,
    maxTraversals = 6,
    room = this.player.room,
  ) {
    if (
      !finiteVector(origin) ||
      !finiteVector(direction) ||
      direction.lengthSq() < EPS ||
      !Number.isFinite(maxDistance) ||
      maxDistance <= 0 ||
      !this.rooms.has(room)
    )
      return null;
    const bounds = roomBounds(this.rooms.get(room));
    if (
      AXES.some(
        (_, axis) =>
          origin.getComponent(axis) < bounds.min.getComponent(axis) - SKIN ||
          origin.getComponent(axis) > bounds.max.getComponent(axis) + SKIN,
      )
    )
      return null;
    const budget = Number.isFinite(maxTraversals)
      ? clamp(Math.floor(maxTraversals), 0, 6)
      : 6;
    return this._trace(
      origin,
      direction,
      Math.min(maxDistance, 1000),
      budget,
      room,
    ).hit;
  }

  interact() {
    if (this.held) {
      const id = this.held.id;
      this.held = null;
      this._event("drop", { id });
      return id;
    }
    const camera = this.cameraFrame(),
      direction = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const hit = this.raycast(camera.position, direction, 4, 6, camera.room);
    if (hit?.type !== "cube") return null;
    this.held = {
      id: hit.id,
      distance: clamp(hit.distance + this.cubes.get(hit.id).size / 2, 1.2, 4),
      path: hit.path,
      room: hit.room,
    };
    this._event("pickup", { id: hit.id });
    return hit.id;
  }

  _heldTarget() {
    const body = this.cubes.get(this.held.id);
    if (!body) {
      this.held = null;
      return null;
    }
    const camera = this.cameraFrame(),
      direction = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const trace = this._trace(
      camera.position,
      direction,
      Math.min(this.held.distance, 4),
      6,
      camera.room,
      new Set([body.id]),
    );
    this.held.path = [...trace.path];
    this.held.room = body.room;
    const segment = trace.segments.find((s) => s.room === body.room);
    if (!segment) {
      this.held = null;
      this._event("drop", { id: body.id, reason: "occluded" });
      return null;
    }
    let target;
    if (body.room === trace.room) {
      target = trace.end.clone();
      if (trace.hit)
        target.addScaledVector(trace.direction, -(body.size * 0.87 + 0.03));
    } else if (segment.exitPortal)
      target = segment.end
        .clone()
        .addScaledVector(segment.direction, body.size * 0.6);
    else {
      this.held = null;
      return null;
    }
    if (body.position.distanceTo(segment.start) > 5) {
      this.held = null;
      this._event("drop", { id: body.id, reason: "out-of-reach" });
      return null;
    }
    return target;
  }

  throwHeld() {
    if (!this.held) return false;
    const body = this.cubes.get(this.held.id),
      camera = this.cameraFrame();
    const trace = this._trace(
      camera.position,
      new Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
      4,
      6,
      camera.room,
      new Set([body.id]),
    );
    const segment = trace.segments.find((s) => s.room === body.room);
    if (segment) {
      body.velocity.copy(segment.direction).multiplyScalar(13);
      body.angularVelocity.set(1.3, 2.1, 0.7);
      cap(body.velocity, this.doc.physics.maxSpeed);
    }
    this.held = null;
    this._event("throw", { id: body.id });
    return true;
  }

  _updateMechanisms(dt) {
    for (const plate of this.doc.plates) {
      const top = plate.position[1] + plate.size[1] / 2;
      const active = this._bodies().some((body) => {
        if (
          body.room !== plate.room ||
          !body.grounded ||
          this.held?.id === body.id ||
          body.velocity.y > 0.3
        )
          return false;
        const half = bodyHalf(body);
        return (
          Math.abs(body.position.y - half.y - top) <= 0.025 &&
          Math.abs(body.position.x - plate.position[0]) <
            plate.size[0] / 2 + half.x - 0.08 &&
          Math.abs(body.position.z - plate.position[2]) <
            plate.size[2] / 2 + half.z - 0.08
        );
      });
      if (active !== this.plates.get(plate.id).active)
        this._event("plate", { id: plate.id, active });
      this.plates.get(plate.id).active = active;
    }
    for (const door of this.doc.doors) {
      const controls = this.doc.plates.filter((p) =>
        p.doorIds.includes(door.id),
      );
      const state = this.doors.get(door.id);
      const active =
        controls.length > 0 &&
        controls.every((p) => this.plates.get(p.id).active);
      if (state.active !== active) this._event("door", { id: door.id, active });
      state.active = active;
      const nextOpen = clamp(state.open + (active ? 1 : -1) * dt * 2.5, 0, 1);
      const nextPosition = V(door.position).add(
        new Vector3(0, nextOpen * (door.size[1] + 0.2), 0),
      );
      const occupied =
        !active &&
        this._bodies().some(
          (body) =>
            body.room === door.room &&
            boxesOverlap(
              box(body.position, bodyHalf(body).multiplyScalar(2)),
              box(nextPosition, door.size),
            ),
        );
      if (!occupied) state.open = nextOpen;
    }
    if (!this.completed)
      for (const goal of this.doc.goals) {
        if (
          this.player.room !== goal.room ||
          !goal.requires.every((id) => this.doors.get(id).active)
        )
          continue;
        if (
          boxesOverlap(
            box(this.player.position, bodyHalf(this.player).multiplyScalar(2)),
            box(goal.position, goal.size),
          )
        ) {
          this.completed = true;
          this._event("complete", { id: goal.id });
          break;
        }
      }
  }
}
