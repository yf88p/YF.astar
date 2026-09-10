const IDENTITY = [0, 0, 0, 1];
const REVERSE = [0, 1, 0, 0];
const FLOOR = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const PHYSICS = {
  gravity: 9.81,
  fixedDt: 1 / 120,
  maxSubsteps: 12,
  maxSpeed: 28,
};
const portal = (
  id,
  room,
  position,
  quaternion,
  linkedTo,
  color = "#65ebcb",
) => ({
  id,
  room,
  position,
  quaternion: [...quaternion],
  width: 2.4,
  height: 3.2,
  linkedTo,
  enabled: true,
  color,
});
const cube = (id, room, position) => ({
  id,
  room,
  position,
  size: 0.7,
  quaternion: [...IDENTITY],
});

export const LEVELS = [
  {
    version: 1,
    id: "01-the-delivery",
    name: "The Delivery",
    description:
      "A quiet teal atrium, an amber annex, and a doorway that refuses to stay open. Bring something with weight.",
    lesson:
      "Walk up to the cube and look down to pick it up. Carry it through the teal aperture. In the amber annex, set it on the illuminated plate, then walk around it and through the raised door to the far goal. A held or airborne cube does not press a plate. All plates wired to a door are required.",
    accent: "#65ebcb",
    rooms: [
      {
        id: "atrium",
        name: "The Atrium",
        center: [0, 2.5, 0],
        size: [12, 5, 14],
        color: "#153b42",
      },
      {
        id: "annex",
        name: "Amber Annex",
        center: [22, 2.5, 0],
        size: [10, 5, 12],
        color: "#493526",
      },
    ],
    blocks: [
      {
        id: "atrium-bench",
        room: "atrium",
        position: [4.8, 0.3, -2.6],
        size: [1.5, 0.6, 3.6],
      },
      {
        id: "annex-bench",
        room: "annex",
        position: [18, 0.3, 2.5],
        size: [1.2, 0.6, 2.6],
      },
    ],
    portals: [
      portal(
        "delivery-teal",
        "atrium",
        [-2.7, 1.6, -7],
        IDENTITY,
        "delivery-amber",
      ),
      portal(
        "delivery-amber",
        "annex",
        [22, 1.6, 6],
        REVERSE,
        "delivery-teal",
        "#ffbd72",
      ),
    ],
    cubes: [cube("delivery-cube", "atrium", [-0.8, 0.4, 1])],
    plates: [
      {
        id: "delivery-plate",
        room: "annex",
        position: [22, 0.07, 0],
        size: [1.3, 0.14, 1.3],
        doorIds: ["delivery-door"],
      },
    ],
    doors: [
      {
        id: "delivery-door",
        room: "annex",
        position: [22, 2.5, -3.7],
        size: [10, 5, 0.35],
      },
    ],
    goals: [
      {
        id: "delivery-goal",
        room: "annex",
        position: [22, 0.9, -5.1],
        size: [2, 1.8, 1.5],
        requires: ["delivery-door"],
      },
    ],
    spawn: { room: "atrium", position: [1.7, 0.86, 4.8], yaw: 0.17, pitch: 0 },
    physics: { ...PHYSICS },
  },
  {
    version: 1,
    id: "02-falling-sideways",
    name: "Falling Sideways",
    description:
      "Height becomes distance. Drop into a floor aperture and leave a wall with the same speed, on a different axis.",
    lesson:
      "The starting balcony is eight meters high. Step off toward the center of the floor aperture, then brake your horizontal motion to fall straight through it. The amber exit launches you across the landing hall. Release movement during the flight to preserve momentum. Land on the raised island; its 2.2-meter face is higher than a normal jump. Missing the island is safe, but reset to try the high drop again.",
    accent: "#ffbd72",
    rooms: [
      {
        id: "drop-shaft",
        name: "The Drop",
        center: [0, 5, 0],
        size: [10, 10, 10],
        color: "#183e48",
      },
      {
        id: "landing-hall",
        name: "Momentum Hall",
        center: [22, 4, 0],
        size: [10, 8, 14],
        color: "#443129",
      },
    ],
    blocks: [
      {
        id: "drop-balcony",
        room: "drop-shaft",
        position: [0, 7.7, 3.3],
        size: [4, 0.6, 3.2],
      },
      {
        id: "landing-island",
        room: "landing-hall",
        position: [22, 1.1, -0.5],
        size: [3.6, 2.2, 3],
      },
    ],
    portals: [
      portal("momentum-floor", "drop-shaft", [0, 0, 0], FLOOR, "momentum-wall"),
      portal(
        "momentum-wall",
        "landing-hall",
        [22, 4.5, 7],
        REVERSE,
        "momentum-floor",
        "#ffbd72",
      ),
    ],
    cubes: [],
    plates: [],
    doors: [],
    goals: [
      {
        id: "momentum-goal",
        room: "landing-hall",
        position: [22, 2.8, -0.6],
        size: [1.6, 1.2, 1.4],
        requires: [],
      },
    ],
    spawn: {
      room: "drop-shaft",
      position: [0, 8.86, 3.1],
      yaw: 0,
      pitch: -0.28,
    },
    physics: { ...PHYSICS },
  },
  {
    version: 1,
    id: "03-the-long-way-home",
    name: "The Long Way Home",
    description:
      "Three galleries form a loop in space. A sightline can visit every room and still arrive behind you.",
    lesson:
      "Take the cube through the north teal portal into the violet relay. Set it on the plate to your left. Continue north through the violet pair into the gold gallery, then turn right through the now-open side door. The third portal pair returns from the gallery to the original room. Looking down the central axis reveals all three links recursively. The side vault cannot be entered around its full-height partition.",
    accent: "#ba9bff",
    rooms: [
      {
        id: "loop-origin",
        name: "Origin Gallery",
        center: [0, 2.5, 0],
        size: [12, 5, 12],
        color: "#143b42",
      },
      {
        id: "loop-relay",
        name: "Violet Relay",
        center: [22, 2.5, 0],
        size: [10, 5, 12],
        color: "#342a50",
      },
      {
        id: "loop-vault",
        name: "The Gold Gallery",
        center: [44, 2.5, 0],
        size: [10, 5, 12],
        color: "#493b24",
      },
    ],
    blocks: [
      {
        id: "vault-partition-north",
        room: "loop-vault",
        position: [46, 2.5, -3.55],
        size: [0.4, 5, 4.9],
      },
      {
        id: "vault-partition-south",
        room: "loop-vault",
        position: [46, 2.5, 3.55],
        size: [0.4, 5, 4.9],
      },
    ],
    portals: [
      portal(
        "loop-a-north",
        "loop-origin",
        [0, 1.6, -6],
        IDENTITY,
        "loop-b-south",
      ),
      portal(
        "loop-b-south",
        "loop-relay",
        [22, 1.6, 6],
        REVERSE,
        "loop-a-north",
        "#ba9bff",
      ),
      portal(
        "loop-b-north",
        "loop-relay",
        [22, 1.6, -6],
        IDENTITY,
        "loop-c-south",
        "#ba9bff",
      ),
      portal(
        "loop-c-south",
        "loop-vault",
        [44, 1.6, 6],
        REVERSE,
        "loop-b-north",
        "#ffbd72",
      ),
      portal(
        "loop-c-north",
        "loop-vault",
        [44, 1.6, -6],
        IDENTITY,
        "loop-a-south",
        "#ffbd72",
      ),
      portal(
        "loop-a-south",
        "loop-origin",
        [0, 1.6, 6],
        REVERSE,
        "loop-c-north",
      ),
    ],
    cubes: [cube("loop-cube", "loop-origin", [2, 0.4, 1.5])],
    plates: [
      {
        id: "loop-plate",
        room: "loop-relay",
        position: [19, 0.07, -1.8],
        size: [1.3, 0.14, 1.3],
        doorIds: ["vault-door"],
      },
    ],
    doors: [
      {
        id: "vault-door",
        room: "loop-vault",
        position: [46, 2.5, 0],
        size: [0.4, 5, 2.2],
      },
    ],
    goals: [
      {
        id: "loop-goal",
        room: "loop-vault",
        position: [47.6, 0.9, 0],
        size: [1.4, 1.8, 1.6],
        requires: ["vault-door"],
      },
    ],
    spawn: { room: "loop-origin", position: [0, 0.86, 4], yaw: 0, pitch: 0 },
    physics: { ...PHYSICS },
  },
];

export function createBlankLevel() {
  return {
    version: 1,
    id: "blank-observatory",
    name: "Untitled Observatory",
    description: "An empty room for a new spatial experiment.",
    lesson:
      "Place paired portals on inward-facing room boundaries. Connect plates to doors, and place a goal beyond a meaningful obstacle.",
    accent: "#65ebcb",
    rooms: [
      {
        id: "blank-room",
        name: "New Room",
        center: [0, 2.5, 0],
        size: [12, 5, 14],
        color: "#183b43",
      },
    ],
    blocks: [],
    portals: [],
    cubes: [],
    plates: [],
    doors: [],
    goals: [],
    spawn: { room: "blank-room", position: [0, 0.9, 4.7], yaw: 0, pitch: 0 },
    physics: { ...PHYSICS },
  };
}

export function createStressLevel() {
  const doc = structuredClone(LEVELS[2]);
  doc.id = "stress-recursive-gallery";
  doc.name = "Recursive Gallery / Stress";
  doc.description =
    "The complete three-link loop, plus twenty physical cubes. Look straight north from the spawn for a depth-three recursive sightline.";
  let index = 0;
  for (const [room, center] of [
    ["loop-origin", 0],
    ["loop-relay", 22],
  ]) {
    for (const x of [-3.7, 3.7])
      for (const z of [-3.8, -0.4, 2.2, 4])
        doc.cubes.push(
          cube(`stress-cube-${++index}`, room, [center + x, 0.36, z]),
        );
  }
  for (const z of [-3.8, -1, 1.8, 4])
    doc.cubes.push(cube(`stress-cube-${++index}`, "loop-vault", [41, 0.36, z]));
  return doc;
}

// Deterministic physical verification routes, not input recordings. Each move uses
// World.moveBody(body, target - body.position); waits use World.step(). No flags,
// room assignments, plate toggles, or teleports are needed. Cube waypoints stand
// in for carrying so a renderer can animate these or show the prose walkthrough.
export const DEMOS = [
  {
    levelId: LEVELS[0].id,
    walkthrough: [
      "Pick up the cube in front of the atrium spawn.",
      "Carry it through delivery-teal at the left side of the far wall.",
      "Set the cube on delivery-plate in the center of the amber annex.",
      "Walk around the cube and through the raised full-width door to the far goal.",
    ],
    steps: [
      { action: "move", body: "delivery-cube", target: [-2.7, 0.4, -5.7] },
      {
        action: "move",
        body: "delivery-cube",
        target: [-2.7, 0.4, -7.5],
        roomAfter: "annex",
      },
      { action: "move", body: "delivery-cube", target: [22, 0.6, 1.5] },
      { action: "move", body: "delivery-cube", target: [22, 0.6, 0] },
      { action: "wait", seconds: 0.8 },
      { action: "move", target: [-2.7, 0.86, -5.7] },
      { action: "move", target: [-2.7, 0.86, -7.5], roomAfter: "annex" },
      { action: "move", target: [23.6, 0.86, 1.5] },
      { action: "move", target: [23.6, 0.86, -5.1] },
      { action: "move", target: [22, 0.86, -5.1] },
      { action: "wait", seconds: 0.2 },
    ],
  },
  {
    levelId: LEVELS[1].id,
    walkthrough: [
      "Leave the balcony above momentum-floor.",
      "Brake sideways movement and fall through the center of the floor aperture.",
      "Let the redirected fall speed carry you from the elevated wall exit to the island.",
      "Touch the goal on the island. A ground-level jump cannot reach this platform.",
    ],
    steps: [
      { action: "move", target: [0, 8.86, 0] },
      { action: "wait", seconds: 2.2 },
    ],
  },
  {
    levelId: LEVELS[2].id,
    walkthrough: [
      "Carry loop-cube north through loop-a-north into the violet relay.",
      "Leave it on the plate at [19, 0.07, -1.8].",
      "Continue through loop-b-north into the gold gallery.",
      "Turn right at its midpoint and enter the open side vault.",
      "The remaining portal pair closes the three-room visibility loop, rather than providing a shortcut past the vault door.",
    ],
    steps: [
      { action: "move", body: "loop-cube", target: [0, 0.4, -4.8] },
      {
        action: "move",
        body: "loop-cube",
        target: [0, 0.4, -6.5],
        roomAfter: "loop-relay",
      },
      { action: "move", body: "loop-cube", target: [19, 0.6, 0] },
      { action: "move", body: "loop-cube", target: [19, 0.6, -1.8] },
      { action: "wait", seconds: 0.8 },
      { action: "move", target: [0, 0.86, -4.8] },
      { action: "move", target: [0, 0.86, -6.5], roomAfter: "loop-relay" },
      { action: "move", target: [22, 0.86, -4.8] },
      { action: "move", target: [22, 0.86, -6.5], roomAfter: "loop-vault" },
      { action: "move", target: [44, 0.86, 0] },
      { action: "move", target: [47.6, 0.86, 0] },
      { action: "wait", seconds: 0.2 },
    ],
  },
];
