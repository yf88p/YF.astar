import type {
  BodySpec,
  Environment,
  JointSpec,
  SceneConfig,
  Vec2,
} from "./types";

export const DEFAULT_ENVIRONMENT: Environment = {
  gravity: { x: 0, y: -9.81 },
  airDrag: 0.015,
  wind: { x: 0, y: 0 },
  nbodyGravity: 0,
  electrostaticConstant: 0,
  magneticField: 0,
  fluid: null,
};

const colors = {
  green: "#b8ef77",
  purple: "#bba5f5",
  blue: "#8dbdf3",
  coral: "#efaa92",
  yellow: "#ead28a",
  gray: "#94999b",
};
const origin = { x: 0, y: 0 };

function ball(
  id: string,
  position: Vec2,
  radius: number,
  color: string,
  extra: Partial<BodySpec> = {},
): BodySpec {
  return {
    id,
    label: id,
    shape: "circle",
    position,
    radius,
    density: 1,
    restitution: 0.65,
    friction: 0.35,
    color,
    ...extra,
  };
}

function box(
  id: string,
  position: Vec2,
  width: number,
  height: number,
  color: string,
  extra: Partial<BodySpec> = {},
): BodySpec {
  return {
    id,
    label: id,
    shape: "box",
    position,
    width,
    height,
    density: 1,
    restitution: 0.15,
    friction: 0.6,
    color,
    ...extra,
  };
}

function scene(
  id: string,
  name: string,
  description: string,
  bodies: BodySpec[],
  joints: JointSpec[] = [],
  environment: Partial<Environment> = {},
): SceneConfig {
  return {
    id,
    name,
    description,
    bodies,
    joints,
    environment: structuredClone({ ...DEFAULT_ENVIRONMENT, ...environment }),
    camera: { center: { x: 0, y: 5 }, scale: 48 },
  };
}

const playground = scene(
  "playground",
  "Gravity playground",
  "A little world of falling, rolling, bouncing, and swinging. Grab an object and see what happens.",
  [
    box("ground", { x: 0, y: -0.4 }, 32, 0.8, colors.gray, {
      label: "Ground",
      fixed: true,
      restitution: 0.2,
    }),
    box("ramp", { x: -4, y: 3 }, 5, 0.25, colors.gray, {
      label: "Ramp",
      fixed: true,
      rotation: -0.28,
      friction: 0.45,
    }),
    ball("lilac-1", { x: -5.8, y: 4.05 }, 0.3, colors.purple, {
      label: "Lilac marble",
    }),
    ball("lilac-2", { x: -4.8, y: 4.5 }, 0.32, colors.purple, {
      label: "Lilac marble",
    }),
    ball("lilac-3", { x: -3.65, y: 3.65 }, 0.28, colors.purple, {
      label: "Lilac marble",
    }),
    ball("coral-ball", { x: -1.7, y: 6.5 }, 0.68, colors.coral, {
      label: "Bouncing ball",
      restitution: 0.85,
    }),
    box("blue-1", { x: 1, y: 0.55 }, 1.1, 1.1, colors.blue, {
      label: "Stack / 01",
    }),
    box("blue-2", { x: 1, y: 1.65 }, 1.1, 1.1, colors.blue, {
      label: "Stack / 02",
    }),
    box("blue-3", { x: 1, y: 2.75 }, 1.1, 1.1, colors.blue, {
      label: "Stack / 03",
    }),
    ball("pivot", { x: 3.8, y: 8.5 }, 0.11, colors.gray, {
      label: "Pivot",
      fixed: true,
    }),
    ball("pendulum", { x: 5.8, y: 5.5 }, 0.55, colors.green, {
      label: "Pendulum",
      trail: true,
    }),
    box("yellow-box", { x: -4.5, y: 0.5 }, 1, 1, colors.yellow, {
      label: "Little block",
    }),
  ],
  [
    {
      id: "pendulum-rope",
      type: "rope",
      bodyA: "pivot",
      bodyB: "pendulum",
      anchorA: { ...origin },
      anchorB: { ...origin },
      length: Math.sqrt(13),
    },
  ],
);

const cradleBodies: BodySpec[] = [];
const cradleJoints: JointSpec[] = [];
for (let i = 0; i < 5; i++) {
  // A 4 cm clearance resolves impacts sequentially instead of treating all five
  // balls as one resting contact manifold at the instant of the first impact.
  const x = (i - 2) * 1.08;
  const angle = i === 0 ? -0.7 : 0;
  cradleBodies.push(
    ball(`pivot-${i}`, { x, y: 8.5 }, 0.09, colors.gray, {
      label: "Fixed pivot",
      fixed: true,
    }),
  );
  cradleBodies.push(
    ball(
      `bob-${i}`,
      { x: x + 3.8 * Math.sin(angle), y: 8.5 - 3.8 * Math.cos(angle) },
      0.52,
      [colors.purple, colors.blue, colors.green, colors.yellow, colors.coral][
        i
      ],
      { label: `Pendulum ${i + 1}`, density: 2, restitution: 1, friction: 0 },
    ),
  );
  // Rapier 2D has no bilateral distance joint. Gravity keeps these center-attached
  // ropes taut in the normal cradle motion, without adding artificial bob inertia.
  cradleJoints.push({
    id: `string-${i}`,
    type: "rope",
    bodyA: `pivot-${i}`,
    bodyB: `bob-${i}`,
    anchorA: { ...origin },
    anchorB: { ...origin },
    length: 3.8,
  });
}
const cradle = scene(
  "cradle",
  "Newton's cradle",
  "Five equal masses, elastic collisions, and taut pendulum strings. Momentum travels through the row.",
  cradleBodies,
  cradleJoints,
  { airDrag: 0 },
);

const starRadius = 0.65;
const starDensity = 100 / (Math.PI * starRadius ** 2);
const orbitBodies = [
  ball("star", { x: 0, y: 5 }, starRadius, colors.yellow, {
    label: "Central star",
    fixed: true,
    density: starDensity,
  }),
];
for (const [i, radius] of [2, 3.5, 5].entries()) {
  const angle = [0.4, 2.8, -1.15][i];
  // Educational normalized G = 0.35, M = 100, not astronomical SI scales.
  // Match the engine's softened circular-orbit speed. Planets have small but
  // nonzero mass, so their mutual perturbations are included too.
  const speed = Math.sqrt(
    (0.35 * 100 * radius ** 2) / (radius ** 2 + 0.12 ** 2) ** 1.5,
  );
  orbitBodies.push(
    ball(
      `planet-${i + 1}`,
      { x: radius * Math.cos(angle), y: 5 + radius * Math.sin(angle) },
      [0.19, 0.25, 0.31][i],
      [colors.coral, colors.blue, colors.purple][i],
      {
        label: `Planet ${i + 1}`,
        density: 0.15,
        trail: true,
        velocity: { x: -speed * Math.sin(angle), y: speed * Math.cos(angle) },
        restitution: 0.5,
      },
    ),
  );
}
const orbits = scene(
  "orbits",
  "Orbital mechanics",
  "A normalized educational solar system: G = 0.35, central mass = 100 kg. Try changing a planet's velocity.",
  orbitBodies,
  [],
  { gravity: { ...origin }, airDrag: 0, nbodyGravity: 0.35 },
);

const springs = scene(
  "springs",
  "Spring oscillator",
  "Hooke's law in motion. Stretched springs exchange potential and kinetic energy; damping gradually settles the motion.",
  [
    ball("spring-pivot", { x: -3, y: 8.5 }, 0.13, colors.gray, {
      label: "Fixed support",
      fixed: true,
    }),
    box("spring-mass", { x: -2.1, y: 3.7 }, 1.1, 1.1, colors.purple, {
      label: "Spring mass",
      density: 2,
      trail: true,
    }),
    ball("second-pivot", { x: 3, y: 8.5 }, 0.13, colors.gray, {
      label: "Fixed support",
      fixed: true,
    }),
    ball("second-mass", { x: 3.6, y: 4.3 }, 0.6, colors.green, {
      label: "Lighter oscillator",
      trail: true,
    }),
    box("ground", { x: 0, y: -0.4 }, 24, 0.8, colors.gray, {
      label: "Ground",
      fixed: true,
    }),
  ],
  [
    {
      id: "spring-left",
      type: "spring",
      bodyA: "spring-pivot",
      bodyB: "spring-mass",
      anchorA: { ...origin },
      anchorB: { x: 0, y: 0.55 },
      length: 2.5,
      stiffness: 22,
      damping: 0.12,
    },
    {
      id: "spring-right",
      type: "spring",
      bodyA: "second-pivot",
      bodyB: "second-mass",
      anchorA: { ...origin },
      anchorB: { ...origin },
      length: 2.8,
      stiffness: 16,
      damping: 0.08,
    },
  ],
  { airDrag: 0 },
);

const buoyancy = scene(
  "buoyancy",
  "Buoyancy tank",
  "Same fluid, different densities. Light objects float, dense objects sink, and tilted blocks feel a righting torque. Density is kg/m\u00b3 with unit thickness.",
  [
    box("tank-floor", { x: 0, y: -0.4 }, 16.4, 0.8, colors.gray, {
      label: "Tank floor",
      fixed: true,
    }),
    box("tank-left", { x: -8, y: 2.8 }, 0.4, 6.4, colors.gray, {
      label: "Tank wall",
      fixed: true,
    }),
    box("tank-right", { x: 8, y: 2.8 }, 0.4, 6.4, colors.gray, {
      label: "Tank wall",
      fixed: true,
    }),
    box("cork", { x: -4.5, y: 5.7 }, 1.8, 1.2, colors.yellow, {
      label: "Cork / 0.35",
      density: 0.35,
      rotation: 0.3,
    }),
    ball("floating-ball", { x: -1.6, y: 6.5 }, 0.7, colors.green, {
      label: "Light ball / 0.55",
      density: 0.55,
    }),
    box("neutral", { x: 1.5, y: 2.7 }, 1.2, 1.2, colors.blue, {
      label: "Neutral / 1.0",
      density: 1,
      rotation: -0.2,
    }),
    ball("sinking-ball", { x: 4.3, y: 5.7 }, 0.65, colors.coral, {
      label: "Dense ball / 2.2",
      density: 2.2,
    }),
  ],
  [],
  { airDrag: 0.02, fluid: { level: 4.5, density: 1, drag: 2 } },
);

const charges = scene(
  "charges",
  "Charged particles",
  "Like charges repel; opposites attract. Softened Coulomb forces stay finite at close range. Add a magnetic field to bend moving charges.",
  [
    ball("positive-left", { x: -2.5, y: 6.8 }, 0.42, colors.coral, {
      label: "+1 C",
      charge: 1,
      density: 2,
      trail: true,
    }),
    ball("positive-right", { x: 2.5, y: 6.8 }, 0.42, colors.coral, {
      label: "+1 C",
      charge: 1,
      density: 2,
      trail: true,
    }),
    ball("negative-left", { x: -2.5, y: 3.2 }, 0.42, colors.blue, {
      label: "-1 C",
      charge: -1,
      density: 2,
      trail: true,
      velocity: { x: 0.7, y: 0 },
    }),
    ball("negative-right", { x: 2.5, y: 3.2 }, 0.42, colors.purple, {
      label: "-1 C",
      charge: -1,
      density: 2,
      trail: true,
      velocity: { x: -0.7, y: 0 },
    }),
    box("bottom", { x: 0, y: -0.35 }, 19, 0.3, colors.gray, {
      label: "Boundary",
      fixed: true,
      restitution: 0.9,
    }),
    box("top", { x: 0, y: 10.35 }, 19, 0.3, colors.gray, {
      label: "Boundary",
      fixed: true,
      restitution: 0.9,
    }),
    box("left", { x: -9.35, y: 5 }, 0.3, 10.4, colors.gray, {
      label: "Boundary",
      fixed: true,
      restitution: 0.9,
    }),
    box("right", { x: 9.35, y: 5 }, 0.3, 10.4, colors.gray, {
      label: "Boundary",
      fixed: true,
      restitution: 0.9,
    }),
  ],
  [],
  { gravity: { ...origin }, airDrag: 0, electrostaticConstant: 3 },
);

export const PRESETS: SceneConfig[] = [
  playground,
  cradle,
  orbits,
  springs,
  buoyancy,
  charges,
];
