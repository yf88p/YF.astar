import type * as Rapier from "@dimforge/rapier2d-compat";
import type {
  BodySnapshot,
  BodySpec,
  Environment,
  JointSpec,
  Metrics,
  SceneConfig,
  Vec2,
} from "./types";

// Metres, seconds, kilograms, with unit out-of-plane thickness. Drag coefficients
// are linear rates (s^-1); fluid drag acts on displaced fluid mass. Field potentials
// use the same Plummer softening as their forces, including inside colliders.
const TIMESTEP = 1 / 120;
const SOFTENING = 0.12;
const MAX_POSITION = 10_000;
const MAX_SPEED = 1_000;
const MAX_ANGULAR_SPEED = 200;
const MAX_ACCELERATION = 10_000;
let initialization: Promise<void> | undefined;
let RAPIER: typeof import("@dimforge/rapier2d-compat").default;

function record(value: unknown, path: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`${path} must be a plain object.`);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) {
      throw new Error(`${path} contains an unsafe property: ${key}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.get || descriptor?.set)
      throw new Error(`${path}.${key} must be a plain value.`);
  }
  return value as Record<string, unknown>;
}

function number(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `${path} must be a finite number between ${min} and ${max}.`,
    );
  }
  return value;
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(
      `${path} must be a nonempty string of at most ${max} characters.`,
    );
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean")
    throw new Error(`${path} must be true or false.`);
  return value;
}

function vector(value: unknown, path: string, limit = MAX_POSITION): Vec2 {
  const v = record(value, path);
  return {
    x: number(v.x, `${path}.x`, -limit, limit),
    y: number(v.y, `${path}.y`, -limit, limit),
  };
}

function validateBody(value: unknown, path: string): BodySpec {
  const b = record(value, path);
  if (b.shape !== "circle" && b.shape !== "box")
    throw new Error(`${path}.shape must be circle or box.`);
  return {
    id: text(b.id, `${path}.id`, 100),
    label: text(b.label, `${path}.label`, 100),
    shape: b.shape,
    position: vector(b.position, `${path}.position`),
    rotation: number(
      b.rotation === undefined ? 0 : b.rotation,
      `${path}.rotation`,
      -1_000_000,
      1_000_000,
    ),
    velocity: vector(
      b.velocity === undefined ? { x: 0, y: 0 } : b.velocity,
      `${path}.velocity`,
      MAX_SPEED,
    ),
    angularVelocity: number(
      b.angularVelocity === undefined ? 0 : b.angularVelocity,
      `${path}.angularVelocity`,
      -MAX_ANGULAR_SPEED,
      MAX_ANGULAR_SPEED,
    ),
    fixed: boolean(b.fixed, `${path}.fixed`),
    ...(b.shape === "circle"
      ? { radius: number(b.radius, `${path}.radius`, 0.01, 50) }
      : {
          width: number(b.width, `${path}.width`, 0.02, 100),
          height: number(b.height, `${path}.height`, 0.02, 100),
        }),
    density: number(b.density, `${path}.density`, 0.01, 10_000),
    restitution: number(b.restitution, `${path}.restitution`, 0, 1),
    friction: number(b.friction, `${path}.friction`, 0, 2),
    color: text(b.color, `${path}.color`, 64),
    charge: number(
      b.charge === undefined ? 0 : b.charge,
      `${path}.charge`,
      -1_000,
      1_000,
    ),
    trail: boolean(b.trail, `${path}.trail`),
  };
}

function validateEnvironment(value: unknown): Environment {
  const e = record(value, "environment");
  let fluid: Environment["fluid"] = null;
  if (e.fluid !== null) {
    const f = record(e.fluid, "environment.fluid");
    fluid = {
      level: number(
        f.level,
        "environment.fluid.level",
        -MAX_POSITION,
        MAX_POSITION,
      ),
      density: number(f.density, "environment.fluid.density", 0, 10_000),
      drag: number(f.drag, "environment.fluid.drag", 0, 100),
    };
  }
  return {
    gravity: vector(e.gravity, "environment.gravity", 1_000),
    airDrag: number(e.airDrag, "environment.airDrag", 0, 100),
    wind: vector(e.wind, "environment.wind", MAX_SPEED),
    nbodyGravity: number(e.nbodyGravity, "environment.nbodyGravity", 0, 1_000),
    electrostaticConstant: number(
      e.electrostaticConstant,
      "environment.electrostaticConstant",
      0,
      10_000,
    ),
    magneticField: number(
      e.magneticField,
      "environment.magneticField",
      -1_000,
      1_000,
    ),
    fluid,
  };
}

/** Validate and copy untrusted scene JSON before allocating any WASM resources. */
export function validateScene(value: unknown): SceneConfig {
  const s = record(value, "Scene");
  if (!Array.isArray(s.bodies) || s.bodies.length > 250)
    throw new Error("Scene.bodies must be an array with at most 250 bodies.");
  if (!Array.isArray(s.joints) || s.joints.length > 500)
    throw new Error("Scene.joints must be an array with at most 500 joints.");
  const bodies = Array.from(s.bodies, (b, i) =>
    validateBody(b, `bodies[${i}]`),
  );
  const ids = new Set<string>();
  for (const body of bodies) {
    if (ids.has(body.id)) throw new Error(`Duplicate body id: ${body.id}.`);
    ids.add(body.id);
  }
  const jointIds = new Set<string>();
  const joints: JointSpec[] = Array.from(s.joints, (value, i) => {
    const path = `joints[${i}]`;
    const j = record(value, path);
    const id = text(j.id, `${path}.id`, 100);
    if (jointIds.has(id)) throw new Error(`Duplicate joint id: ${id}.`);
    jointIds.add(id);
    if (j.type !== "rope" && j.type !== "spring" && j.type !== "revolute")
      throw new Error(`${path}.type must be rope, spring, or revolute.`);
    const bodyA = text(j.bodyA, `${path}.bodyA`, 100);
    const bodyB = text(j.bodyB, `${path}.bodyB`, 100);
    if (!ids.has(bodyA) || !ids.has(bodyB))
      throw new Error(`${path} references a missing body.`);
    if (bodyA === bodyB)
      throw new Error(`${path} must connect two different bodies.`);
    return {
      id,
      type: j.type,
      bodyA,
      bodyB,
      anchorA: vector(j.anchorA, `${path}.anchorA`, 100),
      anchorB: vector(j.anchorB, `${path}.anchorB`, 100),
      length: number(j.length, `${path}.length`, 0, 200),
      stiffness: number(
        j.stiffness === undefined ? 30 : j.stiffness,
        `${path}.stiffness`,
        0,
        100_000,
      ),
      damping: number(
        j.damping === undefined ? 0 : j.damping,
        `${path}.damping`,
        0,
        10_000,
      ),
    };
  });
  const camera = record(s.camera, "camera");
  if (typeof s.description !== "string" || s.description.length > 2_000)
    throw new Error(
      "Scene.description must be a string of at most 2000 characters.",
    );
  return {
    id: text(s.id, "Scene.id", 100),
    name: text(s.name, "Scene.name", 120),
    description: s.description,
    bodies,
    joints,
    environment: validateEnvironment(s.environment),
    camera: {
      center: vector(camera.center, "camera.center"),
      scale: number(camera.scale, "camera.scale", 5, 500),
    },
  };
}

interface Body {
  spec: BodySpec;
  rigid: Rapier.RigidBody;
  collider: Rapier.Collider;
  mass: number;
  inertia: number;
  fx: number;
  fy: number;
  torque: number;
}

function massProperties(spec: BodySpec): { mass: number; inertia: number } {
  const mass =
    spec.density *
    (spec.shape === "circle"
      ? Math.PI * spec.radius! ** 2
      : spec.width! * spec.height!);
  return {
    mass,
    inertia:
      mass *
      (spec.shape === "circle"
        ? spec.radius! ** 2 / 2
        : (spec.width! ** 2 + spec.height! ** 2) / 12),
  };
}

function createBody(world: Rapier.World, spec: BodySpec): Body {
  const desc = spec.fixed
    ? RAPIER.RigidBodyDesc.fixed()
    : RAPIER.RigidBodyDesc.dynamic();
  desc
    .setTranslation(spec.position.x, spec.position.y)
    .setRotation(spec.rotation ?? 0)
    .setLinvel(
      spec.fixed ? 0 : (spec.velocity?.x ?? 0),
      spec.fixed ? 0 : (spec.velocity?.y ?? 0),
    )
    .setAngvel(spec.fixed ? 0 : (spec.angularVelocity ?? 0))
    .setCcdEnabled(true);
  const rigid = world.createRigidBody(desc);
  try {
    const shape =
      spec.shape === "circle"
        ? RAPIER.ColliderDesc.ball(spec.radius!)
        : RAPIER.ColliderDesc.cuboid(spec.width! / 2, spec.height! / 2);
    const collider = world.createCollider(
      shape
        .setDensity(spec.density)
        .setFriction(spec.friction)
        .setRestitution(spec.restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
      rigid,
    );
    rigid.recomputeMassPropertiesFromColliders();
    // Rapier gives fixed bodies zero inertial mass, but they still source fields.
    return {
      spec,
      rigid,
      collider,
      ...massProperties(spec),
      fx: 0,
      fy: 0,
      torque: 0,
    };
  } catch (error) {
    world.removeRigidBody(rigid);
    throw error;
  }
}

function worldPoint(body: Body, local: Vec2): Vec2 {
  const p = body.rigid.translation();
  const a = body.rigid.rotation();
  return {
    x: p.x + Math.cos(a) * local.x - Math.sin(a) * local.y,
    y: p.y + Math.sin(a) * local.x + Math.cos(a) * local.y,
  };
}

function force(body: Body, x: number, y: number, point?: Vec2): void {
  if (body.spec.fixed) return;
  body.fx += x;
  body.fy += y;
  if (point) {
    const p = body.rigid.translation();
    body.torque += (point.x - p.x) * y - (point.y - p.y) * x;
  }
}

function submerged(body: Body, level: number): { area: number; center: Vec2 } {
  const { spec } = body;
  const p = body.rigid.translation();
  if (spec.shape === "circle") {
    const r = spec.radius!;
    const h = level - p.y;
    if (h <= -r) return { area: 0, center: p };
    if (h >= r) return { area: Math.PI * r * r, center: p };
    const chord = Math.sqrt(Math.max(0, r * r - h * h));
    const area = r * r * (Math.asin(h / r) + Math.PI / 2) + h * chord;
    return {
      area,
      center: {
        x: p.x,
        y: p.y - ((2 / 3) * chord ** 3) / Math.max(area, 1e-12),
      },
    };
  }
  // Clip a CCW rotated rectangle against the horizontal fluid surface, then use
  // its signed area and first moments for the actual center of buoyancy.
  const x = spec.width! / 2;
  const y = spec.height! / 2;
  const vertices = [
    { x: -x, y: -y },
    { x, y: -y },
    { x, y },
    { x: -x, y },
  ].map((v) => worldPoint(body, v));
  const clipped: Vec2[] = [];
  let previous = vertices[vertices.length - 1];
  for (const current of vertices) {
    if (previous.y <= level !== current.y <= level) {
      const t = (level - previous.y) / (current.y - previous.y);
      clipped.push({ x: previous.x + t * (current.x - previous.x), y: level });
    }
    if (current.y <= level) clipped.push(current);
    previous = current;
  }
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < clipped.length; i++) {
    // Work relative to the body center to avoid cancellation far from the origin.
    const a = { x: clipped[i].x - p.x, y: clipped[i].y - p.y };
    const next = clipped[(i + 1) % clipped.length];
    const b = { x: next.x - p.x, y: next.y - p.y };
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return twiceArea > 1e-12
    ? {
        area: twiceArea / 2,
        center: {
          x: p.x + cx / (3 * twiceArea),
          y: p.y + cy / (3 * twiceArea),
        },
      }
    : { area: 0, center: p };
}

export class PhysicsEngine {
  private world!: Rapier.World;
  private scene!: SceneConfig;
  private bodies = new Map<string, Body>();
  private elapsed = 0;
  private accumulator = 0;
  private disposed = false;
  private drag: { id: string; local: Vec2; target: Vec2 } | null = null;

  static async create(scene: SceneConfig): Promise<PhysicsEngine> {
    const validated = validateScene(scene);
    // Keep the embedded WASM binary out of the initial interface bundle.
    initialization ??= import("@dimforge/rapier2d-compat")
      .then(async (module) => {
        RAPIER = module.default;
        await RAPIER.init();
      })
      .catch((error) => {
        initialization = undefined;
        throw error;
      });
    await initialization;
    return new PhysicsEngine(validated);
  }

  private constructor(scene: SceneConfig) {
    this.loadScene(scene);
  }

  private assertAlive(): void {
    if (this.disposed)
      throw new Error(
        "PhysicsEngine has been disposed. Create a new engine to continue.",
      );
  }

  loadScene(scene: SceneConfig): void {
    this.assertAlive();
    const validated = validateScene(scene);
    const world = new RAPIER.World(validated.environment.gravity);
    const bodies = new Map<string, Body>();
    try {
      world.timestep = TIMESTEP;
      world.integrationParameters.numSolverIterations = 12;
      world.integrationParameters.maxCcdSubsteps = 4;
      for (const spec of validated.bodies)
        bodies.set(spec.id, createBody(world, spec));
      for (const j of validated.joints) {
        const data =
          j.type === "spring"
            ? RAPIER.JointData.spring(
                j.length,
                j.stiffness!,
                j.damping!,
                j.anchorA,
                j.anchorB,
              )
            : j.type === "rope"
              ? RAPIER.JointData.rope(j.length, j.anchorA, j.anchorB)
              : RAPIER.JointData.revolute(j.anchorA, j.anchorB);
        world
          .createImpulseJoint(
            data,
            bodies.get(j.bodyA)!.rigid,
            bodies.get(j.bodyB)!.rigid,
            true,
          )
          .setContactsEnabled(false);
      }
    } catch (error) {
      world.free();
      throw error;
    }
    this.world?.free();
    this.world = world;
    this.bodies = bodies;
    this.scene = validated;
    this.elapsed = 0;
    this.accumulator = 0;
    this.drag = null;
  }

  get environment(): Environment {
    this.assertAlive();
    return structuredClone(this.scene.environment);
  }

  setEnvironment(patch: Partial<Environment>): void {
    this.assertAlive();
    record(patch, "Environment patch");
    const environment = validateEnvironment({
      ...this.scene.environment,
      ...patch,
    });
    this.scene.environment = environment;
    this.world.gravity = { ...environment.gravity };
    for (const body of this.bodies.values())
      if (!body.spec.fixed) body.rigid.wakeUp();
  }

  /** Accumulate real elapsed time, with a 0.25 s catch-up budget per call. */
  step(dt = TIMESTEP): void {
    this.assertAlive();
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("Step duration must be a finite, nonnegative number.");
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator + 1e-12 >= TIMESTEP) {
      this.substep();
      this.accumulator = Math.max(0, this.accumulator - TIMESTEP);
      this.elapsed += TIMESTEP;
    }
  }

  private rotateMagneticVelocity(body: Body): void {
    const field = this.scene.environment.magneticField;
    if (!field || !body.spec.charge || body.spec.fixed) return;
    // Exact half-step Lorentz rotation (B points out of the screen). Unlike an
    // explicit Euler force this does no work, even in strong magnetic fields.
    const angle = (((-body.spec.charge * field) / body.mass) * TIMESTEP) / 2;
    const v = body.rigid.linvel();
    body.rigid.setLinvel(
      {
        x: v.x * Math.cos(angle) - v.y * Math.sin(angle),
        y: v.x * Math.sin(angle) + v.y * Math.cos(angle),
      },
      true,
    );
  }

  private kickFields(entries: Body[]): void {
    const e = this.scene.environment;
    if (!e.nbodyGravity && !e.electrostaticConstant) return;
    for (const b of entries) b.fx = b.fy = 0;
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      const pa = a.rigid.translation();
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j];
        if (a.spec.fixed && b.spec.fixed) continue;
        const pb = b.rigid.translation();
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const r2 = dx * dx + dy * dy + SOFTENING ** 2;
        const strength =
          (e.nbodyGravity * a.mass * b.mass -
            e.electrostaticConstant * a.spec.charge! * b.spec.charge!) /
          (r2 * Math.sqrt(r2));
        force(a, strength * dx, strength * dy);
        force(b, -strength * dx, -strength * dy);
      }
    }
    // Symmetric kick-drift-kick avoids secular orbital energy drift from freezing
    // a position-dependent force across Rapier's internal solver substeps. A
    // common emergency scale retains equal-and-opposite impulses at the cap.
    let scale = 1;
    for (const b of entries) {
      if (!b.spec.fixed)
        scale = Math.min(
          scale,
          (b.mass * MAX_ACCELERATION) / Math.max(Math.hypot(b.fx, b.fy), 1e-30),
        );
    }
    for (const b of entries) {
      if (!b.spec.fixed && (b.fx || b.fy))
        b.rigid.applyImpulse(
          {
            x: (b.fx * scale * TIMESTEP) / 2,
            y: (b.fy * scale * TIMESTEP) / 2,
          },
          true,
        );
      b.fx = b.fy = 0;
    }
  }

  private substep(): void {
    const entries = [...this.bodies.values()];
    const e = this.scene.environment;
    for (const body of entries) {
      body.rigid.resetForces(false);
      body.rigid.resetTorques(false);
      body.fx = body.fy = body.torque = 0;
      this.rotateMagneticVelocity(body);
    }
    this.kickFields(entries);
    for (const body of entries) {
      if (body.spec.fixed) continue;
      const v = body.rigid.linvel();
      const omega = body.rigid.angvel();
      const drag = Math.min(e.airDrag, 0.5 / TIMESTEP);
      force(
        body,
        drag * body.mass * (e.wind.x - v.x),
        drag * body.mass * (e.wind.y - v.y),
      );
      body.torque -= drag * body.inertia * omega;
      if (e.fluid && e.fluid.density > 0) {
        const { area, center } = submerged(body, e.fluid.level);
        if (area > 1e-10) {
          const displaced = e.fluid.density * area;
          force(
            body,
            -e.gravity.x * displaced,
            -e.gravity.y * displaced,
            center,
          );
          const p = body.rigid.translation();
          // Limit the damping rate to avoid explicit drag reversing velocity.
          const damping = Math.min(
            e.fluid.drag * displaced,
            (body.mass * 0.25) / TIMESTEP,
          );
          force(
            body,
            -damping * (v.x - omega * (center.y - p.y)),
            -damping * (v.y + omega * (center.x - p.x)),
            center,
          );
          body.torque -=
            Math.min((e.fluid.drag * displaced) / body.mass, 0.25 / TIMESTEP) *
            body.inertia *
            omega;
        }
      }
    }
    if (this.drag) {
      const body = this.bodies.get(this.drag.id);
      if (body && !body.spec.fixed) {
        const point = worldPoint(body, this.drag.local);
        const p = body.rigid.translation();
        const v = body.rigid.linvel();
        const omega = body.rigid.angvel();
        const k = body.mass * 120;
        const d = body.mass * 20;
        force(
          body,
          k * (this.drag.target.x - point.x) -
            d * (v.x - omega * (point.y - p.y)),
          k * (this.drag.target.y - point.y) -
            d * (v.y + omega * (point.x - p.x)),
          point,
        );
      }
    }
    // These limits and speed/world bounds are safety guards, not physical behavior.
    let scale = 1;
    for (const b of entries) {
      if (b.spec.fixed) continue;
      scale = Math.min(
        scale,
        (b.mass * MAX_ACCELERATION) / Math.max(Math.hypot(b.fx, b.fy), 1e-30),
        (b.inertia * MAX_ACCELERATION) / Math.max(Math.abs(b.torque), 1e-30),
      );
    }
    for (const b of entries) {
      if (b.spec.fixed) continue;
      if (b.fx || b.fy)
        b.rigid.addForce({ x: b.fx * scale, y: b.fy * scale }, true);
      if (b.torque) b.rigid.addTorque(b.torque * scale, true);
    }
    this.world.step();
    this.kickFields(entries);
    for (const b of entries) {
      if (b.spec.fixed) continue;
      this.rotateMagneticVelocity(b);
      const p = b.rigid.translation();
      const v = b.rigid.linvel();
      const w = b.rigid.angvel();
      if (![p.x, p.y, v.x, v.y, w, b.rigid.rotation()].every(Number.isFinite)) {
        b.rigid.setTranslation(b.spec.position, true);
        b.rigid.setRotation(0, true);
        b.rigid.setLinvel({ x: 0, y: 0 }, true);
        b.rigid.setAngvel(0, true);
        continue;
      }
      if (Math.abs(p.x) > MAX_POSITION || Math.abs(p.y) > MAX_POSITION) {
        b.rigid.setTranslation(
          {
            x: Math.max(-MAX_POSITION, Math.min(MAX_POSITION, p.x)),
            y: Math.max(-MAX_POSITION, Math.min(MAX_POSITION, p.y)),
          },
          true,
        );
        b.rigid.setLinvel({ x: 0, y: 0 }, true);
      } else {
        const speed = Math.hypot(v.x, v.y);
        if (speed > MAX_SPEED)
          b.rigid.setLinvel(
            { x: (v.x * MAX_SPEED) / speed, y: (v.y * MAX_SPEED) / speed },
            true,
          );
      }
      if (Math.abs(w) > MAX_ANGULAR_SPEED)
        b.rigid.setAngvel(Math.sign(w) * MAX_ANGULAR_SPEED, true);
    }
  }

  private state(body: Body): BodySpec {
    return {
      ...body.spec,
      position: { ...body.rigid.translation() },
      rotation: body.rigid.rotation(),
      velocity: body.spec.fixed ? { x: 0, y: 0 } : { ...body.rigid.linvel() },
      angularVelocity: body.spec.fixed ? 0 : body.rigid.angvel(),
    };
  }

  snapshots(): BodySnapshot[] {
    this.assertAlive();
    return [...this.bodies.values()].map(
      (body) =>
        ({
          ...this.state(body),
          mass: body.mass,
          sleeping: body.rigid.isSleeping(),
        }) as BodySnapshot,
    );
  }

  metrics(): Metrics {
    this.assertAlive();
    const e = this.scene.environment;
    const entries = [...this.bodies.values()];
    let kineticEnergy = 0;
    let potentialEnergy = 0;
    let dynamicBodies = 0;
    let maxSpeed = 0;
    const momentum = { x: 0, y: 0 };
    for (let i = 0; i < entries.length; i++) {
      const b = entries[i];
      const p = b.rigid.translation();
      if (!b.spec.fixed) {
        dynamicBodies++;
        const v = b.rigid.linvel();
        const speed = Math.hypot(v.x, v.y);
        maxSpeed = Math.max(maxSpeed, speed);
        kineticEnergy +=
          0.5 * (b.mass * speed ** 2 + b.inertia * b.rigid.angvel() ** 2);
        potentialEnergy -= b.mass * (e.gravity.x * p.x + e.gravity.y * p.y);
        momentum.x += b.mass * v.x;
        momentum.y += b.mass * v.y;
      }
      if (e.nbodyGravity || e.electrostaticConstant) {
        for (let j = i + 1; j < entries.length; j++) {
          const other = entries[j];
          const q = other.rigid.translation();
          potentialEnergy +=
            (e.electrostaticConstant * b.spec.charge! * other.spec.charge! -
              e.nbodyGravity * b.mass * other.mass) /
            Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + SOFTENING ** 2);
        }
      }
    }
    for (const j of this.scene.joints) {
      if (j.type !== "spring") continue;
      const a = worldPoint(this.bodies.get(j.bodyA)!, j.anchorA);
      const b = worldPoint(this.bodies.get(j.bodyB)!, j.anchorB);
      potentialEnergy +=
        0.5 * j.stiffness! * (Math.hypot(a.x - b.x, a.y - b.y) - j.length) ** 2;
    }
    // This is body mechanical energy, not the fluid's energy or work supplied by
    // the mouse/wind. Buoyancy, drag, impacts and solver stabilization can change it.
    return {
      time: this.elapsed,
      bodies: entries.length,
      dynamicBodies,
      kineticEnergy,
      potentialEnergy,
      totalEnergy: kineticEnergy + potentialEnergy,
      momentum,
      maxSpeed,
    };
  }

  exportScene(): SceneConfig {
    this.assertAlive();
    return {
      ...structuredClone(this.scene),
      bodies: [...this.bodies.values()].map((body) => this.state(body)),
    };
  }

  addBody(spec: BodySpec): void {
    this.assertAlive();
    const validated = validateBody(spec, "Body");
    if (this.bodies.size >= 250)
      throw new Error("A scene can contain at most 250 bodies.");
    if (this.bodies.has(validated.id))
      throw new Error(`Duplicate body id: ${validated.id}.`);
    this.bodies.set(validated.id, createBody(this.world, validated));
  }

  updateBody(id: string, patch: Partial<BodySpec>): void {
    this.assertAlive();
    const body = this.bodies.get(id);
    if (!body) throw new Error(`Unknown body id: ${id}.`);
    record(patch, "Body patch");
    if (patch.id !== undefined && patch.id !== id)
      throw new Error("A body id cannot be changed.");
    const spec = validateBody({ ...this.state(body), ...patch }, `Body ${id}`);
    if (spec.fixed !== body.spec.fixed) {
      body.rigid.setBodyType(
        spec.fixed ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic,
        true,
      );
    }
    if (
      spec.shape !== body.spec.shape ||
      spec.radius !== body.spec.radius ||
      spec.width !== body.spec.width ||
      spec.height !== body.spec.height
    ) {
      body.collider.setShape(
        spec.shape === "circle"
          ? new RAPIER.Ball(spec.radius!)
          : new RAPIER.Cuboid(spec.width! / 2, spec.height! / 2),
      );
    }
    body.collider.setDensity(spec.density);
    body.collider.setFriction(spec.friction);
    body.collider.setRestitution(spec.restitution);
    body.rigid.recomputeMassPropertiesFromColliders();
    body.rigid.setTranslation(spec.position, true);
    body.rigid.setRotation(spec.rotation!, true);
    body.rigid.setLinvel(spec.fixed ? { x: 0, y: 0 } : spec.velocity!, true);
    body.rigid.setAngvel(spec.fixed ? 0 : spec.angularVelocity!, true);
    body.rigid.resetForces(false);
    body.rigid.resetTorques(false);
    Object.assign(body, { spec, ...massProperties(spec) });
    if (spec.fixed && this.drag?.id === id) this.drag = null;
  }

  removeBody(id: string): void {
    this.assertAlive();
    const body = this.bodies.get(id);
    if (!body) return;
    if (this.drag?.id === id) this.drag = null;
    this.world.removeRigidBody(body.rigid);
    this.bodies.delete(id);
    this.scene.joints = this.scene.joints.filter(
      (j) => j.bodyA !== id && j.bodyB !== id,
    );
  }

  beginDrag(id: string, point: Vec2): void {
    this.assertAlive();
    const target = vector(point, "Drag point");
    const body = this.bodies.get(id);
    this.drag = null;
    if (!body || body.spec.fixed) return;
    const p = body.rigid.translation();
    const angle = body.rigid.rotation();
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    this.drag = {
      id,
      target,
      local: {
        x: Math.cos(angle) * dx + Math.sin(angle) * dy,
        y: -Math.sin(angle) * dx + Math.cos(angle) * dy,
      },
    };
    body.rigid.wakeUp();
  }

  moveDrag(point: Vec2): void {
    this.assertAlive();
    const target = vector(point, "Drag point");
    if (this.drag) this.drag.target = target;
  }

  endDrag(): void {
    this.assertAlive();
    this.drag = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.drag = null;
    this.bodies.clear();
    this.world.free();
  }
}
