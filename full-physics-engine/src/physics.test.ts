import { afterEach, describe, expect, it } from "vitest";
import { PhysicsEngine, validateScene } from "./physics";
import { DEFAULT_ENVIRONMENT, PRESETS } from "./presets";
import type {
  BodySpec,
  Environment,
  JointSpec,
  SceneConfig,
  Vec2,
} from "./types";

const engines: PhysicsEngine[] = [];
const zero = { x: 0, y: 0 };
const h = 1 / 120;

function ball(
  id: string,
  position: Vec2 = zero,
  patch: Partial<BodySpec> = {},
): BodySpec {
  return {
    id,
    label: id,
    shape: "circle",
    position: { ...position },
    radius: 0.5,
    density: 4 / Math.PI,
    friction: 0,
    restitution: 0,
    color: "#bba5f5",
    ...patch,
  };
}

function box(
  id: string,
  position: Vec2,
  patch: Partial<BodySpec> = {},
): BodySpec {
  return {
    id,
    label: id,
    shape: "box",
    position,
    width: 1,
    height: 1,
    density: 1,
    friction: 0,
    restitution: 0,
    color: "#8dbdf3",
    ...patch,
  };
}

function scene(
  bodies: BodySpec[] = [],
  environment: Partial<Environment> = {},
  joints: JointSpec[] = [],
): SceneConfig {
  return {
    id: "test",
    name: "Test scene",
    description: "",
    bodies,
    joints,
    environment: {
      ...structuredClone(DEFAULT_ENVIRONMENT),
      gravity: { ...zero },
      airDrag: 0,
      ...environment,
    },
    camera: { center: { x: 0, y: 5 }, scale: 48 },
  };
}

async function create(config: SceneConfig): Promise<PhysicsEngine> {
  const engine = await PhysicsEngine.create(config);
  engines.push(engine);
  return engine;
}

function advance(engine: PhysicsEngine, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / h); i++) engine.step();
}

function joint(
  type: JointSpec["type"],
  patch: Partial<JointSpec> = {},
): JointSpec {
  return {
    id: "joint",
    type,
    bodyA: "a",
    bodyB: "b",
    anchorA: { ...zero },
    anchorB: { ...zero },
    length: 2,
    ...patch,
  };
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

describe("rigid bodies and time integration", () => {
  it("matches freefall acceleration and displacement in SI units", async () => {
    const engine = await create(
      scene([ball("ball", { x: 0, y: 20 })], { gravity: { x: 0, y: -9.81 } }),
    );
    advance(engine, 1);
    const body = engine.snapshots()[0];
    expect(body.velocity.y).toBeCloseTo(-9.81, 4);
    expect(Math.abs(body.position.y - (20 - 9.81 / 2))).toBeLessThan(0.025);
    expect(engine.metrics().time).toBeCloseTo(1, 12);
  });

  it("uses an accumulator with identical fixed steps across render cadences", async () => {
    const config = scene([ball("ball", { x: 0, y: 20 })], {
      gravity: { x: 1, y: -9.81 },
    });
    const a = await create(config);
    const b = await create(config);
    a.step(0);
    a.step(h / 2);
    expect(a.metrics().time).toBe(0);
    a.step(h / 2);
    for (let i = 1; i < 120; i++) a.step(h);
    for (let i = 0; i < 60; i++) b.step(1 / 60);
    expect(a.snapshots()).toEqual(b.snapshots());
    b.step(60);
    expect(b.metrics().time).toBeCloseTo(1.25, 10);
    for (const dt of [-1, NaN, Infinity])
      expect(() => b.step(dt)).toThrow(/finite, nonnegative/);
  });

  it.each([0, 0.5, 1])(
    "collides with a fixed floor with restitution %s",
    async (restitution) => {
      const engine = await create(
        scene([
          box("floor", { x: 0, y: -0.5 }, { width: 20, fixed: true }),
          ball(
            "ball",
            { x: 0, y: 2 },
            { velocity: { x: 0, y: -4 }, restitution },
          ),
        ]),
      );
      advance(engine, 0.6);
      const body = engine.snapshots()[1];
      expect(body.position.y).toBeGreaterThan(0.49);
      expect(body.velocity.y).toBeCloseTo(4 * restitution, 2);
      expect(engine.snapshots()[0].position.y).toBe(-0.5);
    },
  );

  it("uses CCD to stop a fast small body tunneling through a thin floor", async () => {
    const engine = await create(
      scene([
        box(
          "floor",
          { x: 0, y: -0.05 },
          { width: 20, height: 0.1, fixed: true },
        ),
        ball(
          "ball",
          { x: 0, y: 3 },
          { radius: 0.05, velocity: { x: 0, y: -800 } },
        ),
      ]),
    );
    engine.step();
    expect(engine.snapshots()[1].position.y).toBeGreaterThan(0.035);
  });

  it("applies contact friction to sliding boxes", async () => {
    const engine = await create(
      scene(
        [
          box(
            "floor",
            { x: 0, y: -0.5 },
            { width: 30, fixed: true, friction: 1 },
          ),
          box(
            "slider",
            { x: 0, y: 0.5 },
            { velocity: { x: 5, y: 0 }, friction: 1 },
          ),
        ],
        { gravity: { x: 0, y: -9.81 } },
      ),
    );
    advance(engine, 0.5);
    expect(Math.abs(engine.snapshots()[1].velocity.x)).toBeLessThan(2);
  });

  it("accounts for area-density mass and translational and rotational energy", async () => {
    const engine = await create(
      scene([
        ball(
          "ball",
          { x: -3, y: 0 },
          { velocity: { x: 3, y: 4 }, angularVelocity: 2 },
        ),
        box(
          "box",
          { x: 3, y: 0 },
          { width: 2, height: 3, density: 2, angularVelocity: 3 },
        ),
        ball("fixed", { x: 10, y: 0 }, { fixed: true, density: 20 }),
      ]),
    );
    const metrics = engine.metrics();
    expect(engine.snapshots()[0].mass).toBeCloseTo(1, 10);
    expect(engine.snapshots()[1].mass).toBe(12);
    expect(engine.snapshots()[2].mass).toBeCloseTo(5 * Math.PI, 10);
    expect(metrics.kineticEnergy).toBeCloseTo(12.5 + 0.25 + 0.5 * 13 * 9, 6);
    expect(metrics.momentum).toEqual({ x: 3, y: 4 });
    expect(metrics.dynamicBodies).toBe(2);
    expect(metrics.maxSpeed).toBe(5);
  });

  it("approximately conserves mechanical energy during freefall", async () => {
    const engine = await create(
      scene([ball("ball", { x: 0, y: 20 })], { gravity: { x: 0, y: -9.81 } }),
    );
    const initial = engine.metrics().totalEnergy;
    advance(engine, 1.5);
    expect(
      Math.abs(engine.metrics().totalEnergy - initial) / initial,
    ).toBeLessThan(0.005);
  });
});

describe("external fields and drag", () => {
  it("damps motion at a linear rate without accumulating old forces", async () => {
    const engine = await create(
      scene([ball("ball", zero, { velocity: { x: 10, y: 0 } })], {
        airDrag: 1,
      }),
    );
    advance(engine, 1);
    expect(engine.snapshots()[0].velocity.x).toBeCloseTo(10 / Math.E, 1);
    expect(engine.metrics().kineticEnergy).toBeLessThan(8);
    engine.setEnvironment({ airDrag: 0 });
    const velocity = engine.snapshots()[0].velocity.x;
    advance(engine, 1);
    expect(engine.snapshots()[0].velocity.x).toBeCloseTo(velocity, 6);
  });

  it("drives objects toward the wind velocity", async () => {
    const engine = await create(
      scene([ball("ball")], { airDrag: 1, wind: { x: 4, y: 0 } }),
    );
    advance(engine, 2);
    expect(engine.snapshots()[0].velocity.x).toBeCloseTo(
      4 * (1 - Math.exp(-2)),
      1,
    );
    engine.setEnvironment({
      gravity: { x: 0, y: -10 },
      wind: { ...zero },
      airDrag: 0,
    });
    engine.step();
    expect(engine.snapshots()[0].velocity.y).toBeCloseTo(-10 * h, 6);
  });

  it("uses positive analytical fixed-body mass as a gravitational source", async () => {
    const engine = await create(
      scene(
        [
          ball("star", zero, { fixed: true, density: 400 / Math.PI }),
          ball("planet", { x: 3, y: 0 }),
        ],
        { nbodyGravity: 0.5 },
      ),
    );
    expect(engine.snapshots()[0].mass).toBeCloseTo(100, 10);
    expect(engine.metrics().potentialEnergy).toBeCloseTo(
      -50 / Math.sqrt(9 + 0.12 ** 2),
      8,
    );
    engine.step();
    expect(engine.snapshots()[1].velocity.x).toBeCloseTo(
      ((-50 * 3) / (9 + 0.12 ** 2) ** 1.5) * h,
      4,
    );
    expect(engine.snapshots()[0].position).toEqual(zero);
  });

  it.each([
    { charge: -1, direction: 1 },
    { charge: 1, direction: -1 },
  ])(
    "Coulomb interaction has the right sign for charge $charge",
    async ({ charge, direction }) => {
      const engine = await create(
        scene(
          [
            ball("a", { x: -2, y: 0 }, { charge: 1 }),
            ball("b", { x: 2, y: 0 }, { charge }),
          ],
          { electrostaticConstant: 5 },
        ),
      );
      expect(Math.sign(engine.metrics().potentialEnergy)).toBe(charge);
      advance(engine, 0.2);
      const [a, b] = engine.snapshots();
      expect(a.velocity.x * direction).toBeGreaterThan(0);
      expect(b.velocity.x * direction).toBeLessThan(0);
      expect(engine.metrics().momentum.x).toBeCloseTo(0, 7);
    },
  );

  it("applies equal-and-opposite pair forces with unequal masses and both fields enabled", async () => {
    const engine = await create(
      scene(
        [
          ball("a", { x: -2, y: 0 }, { charge: 2 }),
          ball("b", { x: 2, y: 0 }, { charge: -1, density: 12 / Math.PI }),
        ],
        { electrostaticConstant: 2, nbodyGravity: 1 },
      ),
    );
    const initial = engine.metrics().totalEnergy;
    advance(engine, 0.5);
    expect(engine.metrics().momentum.x).toBeCloseTo(0, 5);
    expect(
      Math.abs((engine.metrics().totalEnergy - initial) / initial),
    ).toBeLessThan(0.01);
  });

  it("keeps coincident, extreme fields finite and caps speeds", async () => {
    const engine = await create(
      scene(
        [
          ball("a", zero, { charge: 1_000, radius: 0.01, density: 0.01 }),
          ball("b", zero, { charge: -1_000, radius: 0.01, density: 10_000 }),
        ],
        { nbodyGravity: 1_000, electrostaticConstant: 10_000 },
      ),
    );
    advance(engine, 0.5);
    for (const b of engine.snapshots()) {
      expect(
        [
          b.position.x,
          b.position.y,
          b.velocity.x,
          b.velocity.y,
          b.angularVelocity,
        ].every(Number.isFinite),
      ).toBe(true);
      expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeLessThanOrEqual(
        1_000.001,
      );
    }
    expect(Number.isFinite(engine.metrics().totalEnergy)).toBe(true);
  });

  it("bends charged motion with a perpendicular magnetic field without doing work", async () => {
    const engine = await create(
      scene([ball("charge", zero, { charge: 2, velocity: { x: 3, y: 0 } })], {
        magneticField: 1,
      }),
    );
    const initial = engine.metrics().kineticEnergy;
    advance(engine, 1);
    const velocity = engine.snapshots()[0].velocity;
    expect(velocity.x).toBeCloseTo(3 * Math.cos(2), 4);
    expect(velocity.y).toBeCloseTo(-3 * Math.sin(2), 4);
    expect(engine.metrics().kineticEnergy).toBeCloseTo(initial, 4);
  });
});

describe("joints and interaction", () => {
  it("oscillates about a spring rest length and reports its stored energy", async () => {
    const engine = await create(
      scene(
        [
          ball("a", zero, { radius: 0.1, fixed: true }),
          ball("b", { x: 4, y: 0 }),
        ],
        {},
        [joint("spring", { stiffness: 10, damping: 0 })],
      ),
    );
    const initial = engine.metrics().totalEnergy;
    expect(initial).toBeCloseTo(20, 8);
    advance(engine, 0.3);
    const body = engine.snapshots()[1];
    expect(body.position.x).toBeLessThan(3.5);
    expect(body.velocity.x).toBeLessThan(-3);
    expect(
      Math.abs(engine.metrics().totalEnergy - initial) / initial,
    ).toBeLessThan(0.06);
  });

  it("keeps a swinging rope taut under gravity", async () => {
    const engine = await create(
      scene(
        [ball("a", zero, { fixed: true }), ball("b", { x: 3, y: 0 })],
        { gravity: { x: 0, y: -9.81 } },
        [joint("rope", { length: 3 })],
      ),
    );
    advance(engine, 1);
    const p = engine.snapshots()[1].position;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(3, 2);
    expect(p.y).toBeLessThan(-1);
  });

  it("keeps revolute anchors coincident while allowing rotation", async () => {
    const engine = await create(
      scene(
        [ball("a", zero, { fixed: true }), box("b", { x: 0.5, y: 0 })],
        { gravity: { x: 0, y: -9.81 } },
        [joint("revolute", { length: 0, anchorB: { x: -0.5, y: 0 } })],
      ),
    );
    advance(engine, 0.5);
    const b = engine.snapshots()[1];
    expect(
      Math.hypot(
        b.position.x - 0.5 * Math.cos(b.rotation),
        b.position.y - 0.5 * Math.sin(b.rotation),
      ),
    ).toBeLessThan(0.01);
    expect(Math.abs(b.rotation)).toBeGreaterThan(0.1);
  });

  it("drags at the local hit point, generating torque, and releases cleanly", async () => {
    const engine = await create(scene([box("box", zero, { width: 2 })]));
    engine.beginDrag("box", { x: 1, y: 0 });
    engine.moveDrag({ x: 1, y: 1 });
    advance(engine, 0.1);
    expect(engine.snapshots()[0].position.y).toBeGreaterThan(0.05);
    expect(engine.snapshots()[0].angularVelocity).toBeGreaterThan(0.1);
    engine.endDrag();
    const before = engine.snapshots()[0];
    advance(engine, 0.1);
    expect(engine.snapshots()[0].velocity.y).toBeCloseTo(before.velocity.y, 5);
    expect(engine.snapshots()[0].angularVelocity).toBeCloseTo(
      before.angularVelocity,
      5,
    );
  });

  it("never applies drag or environmental forces to fixed bodies", async () => {
    const engine = await create(
      scene([ball("fixed", zero, { fixed: true, charge: 1 })], {
        gravity: { x: 0, y: -10 },
        airDrag: 10,
        wind: { x: 100, y: 100 },
        magneticField: 100,
        fluid: { level: 10, density: 1, drag: 10 },
      }),
    );
    engine.beginDrag("fixed", zero);
    engine.moveDrag({ x: 5, y: 5 });
    advance(engine, 1);
    expect(engine.snapshots()[0].position).toEqual(zero);
    expect(engine.snapshots()[0].velocity).toEqual(zero);
  });
});

describe("fluid buoyancy and drag", () => {
  it.each([
    { density: 0.5, acceleration: 10 },
    { density: 1, acceleration: 0 },
    { density: 2, acceleration: -5 },
  ])(
    "obeys Archimedes' principle for a fully submerged circle of density $density",
    async ({ density, acceleration }) => {
      const engine = await create(
        scene([ball("ball", zero, { density })], {
          gravity: { x: 0, y: -10 },
          fluid: { level: 2, density: 1, drag: 0 },
        }),
      );
      engine.step();
      expect(engine.snapshots()[0].velocity.y).toBeCloseTo(acceleration * h, 6);
    },
  );

  it("uses the exact circular-segment area for partial submersion", async () => {
    const engine = await create(
      scene([ball("ball", zero, { radius: 1, density: 1 })], {
        gravity: { x: 0, y: -10 },
        fluid: { level: 0.3, density: 1, drag: 0 },
      }),
    );
    const area = Math.asin(0.3) + Math.PI / 2 + 0.3 * Math.sqrt(1 - 0.3 ** 2);
    engine.step();
    expect(engine.snapshots()[0].velocity.y).toBeCloseTo(
      (-10 + (10 * area) / Math.PI) * h,
      6,
    );
  });

  it("clips a rotated square rather than approximating with its AABB", async () => {
    const engine = await create(
      scene(
        [box("box", zero, { width: 2, height: 2, rotation: Math.PI / 4 })],
        {
          gravity: { x: 0, y: -10 },
          fluid: { level: 0.5, density: 1, drag: 0 },
        },
      ),
    );
    const area = 4 - (Math.SQRT2 - 0.5) ** 2;
    engine.step();
    expect(engine.snapshots()[0].velocity.y).toBeCloseTo(
      (-10 + (10 * area) / 4) * h,
      6,
    );
  });

  it("applies buoyancy at the clipped centroid, producing a righting torque", async () => {
    const engine = await create(
      scene([box("box", zero, { width: 2, density: 0.5, rotation: 0.4 })], {
        gravity: { x: 0, y: -10 },
        fluid: { level: 0, density: 1, drag: 0 },
      }),
    );
    engine.step();
    expect(engine.snapshots()[0].velocity.y).toBeCloseTo(0, 6);
    expect(engine.snapshots()[0].angularVelocity).toBeLessThan(-0.001);
  });

  it("does not buoy objects above the fluid and damps submerged translation and spin", async () => {
    const engine = await create(
      scene(
        [
          ball("wet", zero, {
            density: 1,
            velocity: { x: 4, y: 0 },
            angularVelocity: 2,
          }),
          ball(
            "dry",
            { x: 5, y: 4 },
            { density: 1, velocity: { x: 4, y: 0 }, angularVelocity: 2 },
          ),
        ],
        { fluid: { level: 2, density: 1, drag: 2 } },
      ),
    );
    advance(engine, 0.5);
    expect(engine.snapshots()[0].velocity.x).toBeLessThan(2);
    expect(engine.snapshots()[0].angularVelocity).toBeLessThan(1);
    expect(engine.snapshots()[1].velocity.x).toBe(4);
    expect(engine.snapshots()[1].angularVelocity).toBe(2);
  });
});

describe("editing, serialization, and lifecycle", () => {
  it("updates position, velocity, geometry, density, and fixed state immediately without advancing time", async () => {
    const engine = await create(scene([ball("ball")]));
    engine.updateBody("ball", {
      position: { x: 2, y: 3 },
      velocity: { x: 4, y: 5 },
      angularVelocity: 2,
      density: 2,
    });
    expect(engine.snapshots()[0].velocity).toEqual({ x: 4, y: 5 });
    expect(engine.metrics().time).toBe(0);
    engine.updateBody("ball", { shape: "box", width: 2, height: 3 });
    expect(engine.snapshots()[0].mass).toBe(12);
    expect(engine.snapshots()[0].velocity).toEqual({ x: 4, y: 5 });
    engine.updateBody("ball", { fixed: true });
    advance(engine, 0.1);
    expect(engine.snapshots()[0].position).toEqual({ x: 2, y: 3 });
    engine.updateBody("ball", { fixed: false, velocity: { x: 1, y: 0 } });
    advance(engine, 0.1);
    expect(engine.snapshots()[0].position.x).toBeCloseTo(2.1, 4);
    expect(() => engine.updateBody("ball", { id: "renamed" })).toThrow(
      /id cannot/,
    );
    expect(() => engine.updateBody("ball", { density: -1 })).toThrow(/density/);
    expect(engine.snapshots()[0].mass).toBe(12);
  });

  it("exports current motion and joints and round-trips JSON without shared references", async () => {
    const config = scene(
      [
        ball("a", zero, { fixed: true }),
        ball("b", { x: 3, y: 0 }, { velocity: { x: 0, y: 1 } }),
      ],
      {},
      [joint("rope", { length: 3 })],
    );
    const engine = await create(config);
    config.environment.gravity.y = -100;
    config.bodies[1].position.x = 99;
    advance(engine, 0.1);
    const exported = engine.exportScene();
    expect(exported.bodies[1].position).toEqual(engine.snapshots()[1].position);
    expect(exported.bodies[1].velocity).toEqual(engine.snapshots()[1].velocity);
    expect(exported.joints).toHaveLength(1);
    const restored = await create(
      validateScene(JSON.parse(JSON.stringify(exported))),
    );
    expect(restored.exportScene()).toEqual(exported);
    exported.environment.gravity.x = 100;
    exported.joints[0].anchorA.x = 99;
    exported.bodies[0].position.x = 99;
    const snapshots = engine.snapshots();
    snapshots[0].position.x = 99;
    const environment = engine.environment;
    environment.gravity.x = 99;
    expect(engine.environment.gravity).toEqual(zero);
    expect(engine.exportScene().joints[0].anchorA).toEqual(zero);
    expect(engine.snapshots()[0].position).toEqual(zero);
  });

  it("cleans deleted joints, supports adding bodies, and resets time, accumulation, and dragging", async () => {
    const config = scene(
      [ball("a", zero, { fixed: true }), ball("b", { x: 2, y: 0 })],
      {},
      [joint("spring")],
    );
    const engine = await create(config);
    engine.beginDrag("b", { x: 2, y: 0 });
    engine.moveDrag({ x: 8, y: 0 });
    advance(engine, 0.1);
    engine.removeBody("b");
    engine.removeBody("missing");
    expect(engine.exportScene().joints).toEqual([]);
    engine.addBody(ball("new", { x: 5, y: 0 }));
    expect(() => engine.addBody(ball("new"))).toThrow(/Duplicate/);
    expect(engine.metrics().bodies).toBe(2);
    engine.step(h / 2);
    engine.loadScene(config);
    expect(engine.metrics().time).toBe(0);
    engine.step(h / 2);
    expect(engine.metrics().time).toBe(0);
    engine.step(h / 2);
    expect(engine.snapshots()[1].position.x).toBeCloseTo(2, 6);
    expect(engine.exportScene().joints).toHaveLength(1);
  });

  it("rejects invalid load and environment changes without destroying the live scene", async () => {
    const engine = await create(scene([ball("ball")]));
    advance(engine, 0.1);
    const previous = engine.exportScene();
    const invalid = structuredClone(previous);
    invalid.bodies[0].radius = -1;
    expect(() => engine.loadScene(invalid)).toThrow(/radius/);
    expect(() => engine.setEnvironment({ airDrag: -1 })).toThrow(/airDrag/);
    expect(engine.exportScene()).toEqual(previous);
    expect(engine.metrics().time).toBeCloseTo(0.1, 10);
    engine.step();
  });

  it("allows repeated disposal and reports use-after-dispose without touching WASM", async () => {
    const engine = await create(scene([ball("ball")]));
    engine.dispose();
    expect(() => engine.dispose()).not.toThrow();
    for (const operation of [
      () => engine.step(),
      () => engine.snapshots(),
      () => engine.metrics(),
      () => engine.exportScene(),
      () => engine.loadScene(scene()),
      () => engine.addBody(ball("new")),
      () => engine.updateBody("ball", {}),
      () => engine.removeBody("ball"),
      () => engine.environment,
      () => engine.setEnvironment({}),
      () => engine.beginDrag("ball", zero),
      () => engine.moveDrag(zero),
      () => engine.endDrag(),
    ]) {
      expect(operation).toThrow(/disposed/);
    }
    const replacement = await create(scene([ball("new")]));
    replacement.step();
    expect(replacement.metrics().time).toBe(h);
  });
});

describe("scene validation and presets", () => {
  it.each<[string, () => unknown, RegExp]>([
    ["non-object", () => null, /plain object/],
    [
      "too many bodies",
      () => scene(Array.from({ length: 251 }, (_, i) => ball(String(i)))),
      /250 bodies/,
    ],
    ["duplicate ids", () => scene([ball("a"), ball("a")]), /Duplicate body/],
    [
      "infinite radius",
      () => scene([ball("a", zero, { radius: Infinity })]),
      /radius/,
    ],
    ["zero density", () => scene([ball("a", zero, { density: 0 })]), /density/],
    ["negative width", () => scene([box("a", zero, { width: -1 })]), /width/],
    [
      "huge dimensions",
      () => scene([box("a", zero, { height: 1e20 })]),
      /height/,
    ],
    [
      "nonfinite velocity",
      () => scene([ball("a", zero, { velocity: { x: NaN, y: 0 } })]),
      /velocity.x/,
    ],
    ["far position", () => scene([ball("a", { x: 1e20, y: 0 })]), /position.x/],
    [
      "invalid restitution",
      () => scene([ball("a", zero, { restitution: 2 })]),
      /restitution/,
    ],
    ["long name", () => ({ ...scene(), name: "x".repeat(121) }), /name/],
    [
      "missing reference",
      () => scene([ball("a")], {}, [joint("rope")]),
      /missing body/,
    ],
    [
      "self reference",
      () => scene([ball("a")], {}, [joint("rope", { bodyB: "a" })]),
      /different bodies/,
    ],
    [
      "huge anchor",
      () =>
        scene([ball("a"), ball("b")], {}, [
          joint("rope", { anchorA: { x: 1e20, y: 0 } }),
        ]),
      /anchorA.x/,
    ],
    [
      "huge spring",
      () =>
        scene([ball("a"), ball("b")], {}, [
          joint("spring", { stiffness: 1e20 }),
        ]),
      /stiffness/,
    ],
    [
      "duplicate joints",
      () => scene([ball("a"), ball("b")], {}, [joint("rope"), joint("rope")]),
      /Duplicate joint/,
    ],
    [
      "too many joints",
      () =>
        scene(
          [],
          {},
          Array.from({ length: 501 }, () => joint("rope")),
        ),
      /500 joints/,
    ],
    [
      "invalid fluid",
      () => scene([], { fluid: { level: 0, density: -1, drag: 0 } }),
      /fluid.density/,
    ],
    [
      "prototype property",
      () => JSON.parse('{"__proto__":{"polluted":true}}'),
      /unsafe property/,
    ],
    ["custom prototype", () => Object.create({ bodies: [] }), /plain object/],
    [
      "nested prototype",
      () => ({ ...scene(), environment: JSON.parse('{"constructor":{}}') }),
      /unsafe property/,
    ],
  ])("rejects %s with a useful error", (_name, input, error) => {
    expect(() => validateScene(input())).toThrow(error);
  });

  it("accepts the maximum body count, sanitizes unknown properties, and rejects accessors", () => {
    expect(
      validateScene(
        scene(Array.from({ length: 250 }, (_, i) => ball(String(i)))),
      ).bodies,
    ).toHaveLength(250);
    expect(
      validateScene({ ...scene(), unused: "discard me" }),
    ).not.toHaveProperty("unused");
    const input = scene();
    Object.defineProperty(input, "name", {
      get() {
        throw new Error("Accessor executed");
      },
      enumerable: true,
    });
    expect(() => validateScene(input)).toThrow(/plain value/);
  });

  it("has the requested preset order and a composed default scene", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "playground",
      "cradle",
      "orbits",
      "springs",
      "buoyancy",
      "charges",
    ]);
    expect(PRESETS[0].name).toBe("Gravity playground");
    expect(PRESETS[0].bodies.length).toBeGreaterThanOrEqual(10);
    expect(PRESETS[0].bodies.length).toBeLessThanOrEqual(15);
  });

  it("transfers the released cradle bob motion through the row to the far bob", async () => {
    const engine = await create(PRESETS[1]);
    const pivotX = engine.snapshots().find((b) => b.id === "pivot-4")!.position
      .x;
    let excursion = 0;
    for (let i = 0; i < 240; i++) {
      engine.step();
      const body = engine.snapshots().find((b) => b.id === "bob-4")!;
      excursion = Math.max(excursion, body.position.x - pivotX);
    }
    expect(excursion).toBeGreaterThan(1.5);
  });

  it("keeps orbital mechanical energy approximately constant across multiple revolutions", async () => {
    const engine = await create(PRESETS[2]);
    const initial = engine.metrics().totalEnergy;
    advance(engine, 30);
    expect(
      Math.abs((engine.metrics().totalEnergy - initial) / initial),
    ).toBeLessThan(0.01);
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))(
    "validates and simulates the %s preset",
    async (_id, preset) => {
      const engine = await create(
        validateScene(JSON.parse(JSON.stringify(preset))),
      );
      advance(engine, 5);
      expect(Number.isFinite(engine.metrics().totalEnergy)).toBe(true);
      expect(engine.metrics().time).toBeCloseTo(5, 8);
      for (const b of engine.snapshots()) {
        expect(
          [
            b.position.x,
            b.position.y,
            b.velocity.x,
            b.velocity.y,
            b.rotation,
          ].every(Number.isFinite),
        ).toBe(true);
        if (preset.id === "orbits" && !b.fixed)
          expect(Math.hypot(b.position.x, b.position.y - 5)).toBeLessThan(5.15);
      }
      expect(() => validateScene(engine.exportScene())).not.toThrow();
    },
  );
});
