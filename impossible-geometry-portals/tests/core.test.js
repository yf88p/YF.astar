import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  cloneDocument,
  validateDocument,
  portalRotation,
  mapPoint,
  mapDirection,
  portalLocal,
  roomBounds,
  World,
} from "../src/core.js";
import {
  LEVELS,
  DEMOS,
  createBlankLevel,
  createStressLevel,
} from "../src/levels.js";

const v = (a) => new Vector3(...a);
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected} (tolerance ${tolerance})`,
  );
const vectorNear = (actual, expected, tolerance = 1e-8) =>
  actual.toArray().forEach((n, i) => near(n, expected[i], tolerance));
const tick = (world, seconds) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) world.step();
};

// Independent scalar matrix oracle. Expected values never use core transforms,
// Quaternion.multiply/invert, Vector3.applyQuaternion, or THREE.Matrix classes.
function matrix([x, y, z, w]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}
function mv(m, a) {
  return m.map((row) => row.reduce((sum, n, i) => sum + n * a[i], 0));
}
function oracleDirection(direction, a, b) {
  const ma = matrix(a.quaternion),
    transpose = ma.map((_, i) => ma.map((row) => row[i]));
  const [x, y, z] = mv(transpose, direction);
  return mv(matrix(b.quaternion), [-x, y, -z]);
}
function oraclePoint(point, a, b) {
  return oracleDirection(
    point.map((n, i) => n - a.position[i]),
    a,
    b,
  ).map((n, i) => n + b.position[i]);
}
function fixture({ floor = false, cubes = [], gravity = 0 } = {}) {
  const doc = createBlankLevel();
  doc.id = "test-world";
  doc.rooms = [
    {
      id: "a",
      name: "A",
      center: [0, 2.5, 0],
      size: [10, 5, 10],
      color: "#123456",
    },
    {
      id: "b",
      name: "B",
      center: [20, 2.5, 0],
      size: [10, 5, 10],
      color: "#654321",
    },
  ];
  doc.portals = [
    {
      id: "pa",
      room: "a",
      position: floor ? [0, 0, 0] : [0, 1.6, -5],
      quaternion: floor ? [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] : [0, 0, 0, 1],
      width: 2.4,
      height: 3.2,
      linkedTo: "pb",
      enabled: true,
      color: "#65ebcb",
    },
    {
      id: "pb",
      room: "b",
      position: [20, floor ? 3 : 1.6, 5],
      quaternion: [0, 1, 0, 0],
      width: 2.4,
      height: 3.2,
      linkedTo: "pa",
      enabled: true,
      color: "#ffbd72",
    },
  ];
  doc.spawn = {
    room: "a",
    position: floor ? [0, 2.5, 0] : [0, 0.86, 3],
    yaw: 0,
    pitch: 0,
  };
  doc.cubes = cubes;
  doc.physics.gravity = gravity;
  return doc;
}
const cube = (id, room, position, size = 0.7) => ({
  id,
  room,
  position,
  size,
  quaternion: [0, 0, 0, 1],
});

test("room centers are geometric centers, and cloning is deeply isolated", () => {
  const doc = LEVELS[0],
    clone = cloneDocument(doc),
    bounds = roomBounds(doc.rooms[0]);
  vectorNear(bounds.min, [-6, 0, -7]);
  vectorNear(bounds.max, [6, 5, 7]);
  clone.rooms[0].center[0] = 100;
  assert.equal(doc.rooms[0].center[0], 0);
  const world = new World(doc);
  world.doc.cubes[0].position[0] = 999;
  assert.equal(doc.cubes[0].position[0], -0.8);
  world.reset();
  assert.equal(world.doc.cubes[0].position[0], -0.8);
});

test("wall-to-wall mapping has independently specified numeric translation and orientation", () => {
  const [a, b] = LEVELS[0].portals;
  vectorNear(mapPoint(v([-2.4, 2, -7.8]), a, b), [22.3, 2, 5.2]);
  vectorNear(mapDirection(v([2, -3, -11]), a, b), [2, -3, -11]);
  vectorNear(portalLocal(v([-2.4, 2, -7.8]), a), [0.3, 0.4, -0.8]);
  assert.ok(portalRotation(a, b).isQuaternion);
});

test("wall-to-floor transform redirects normal momentum, not merely position", () => {
  const a = { position: [2, 3, 4], quaternion: [0, 0, 0, 1] };
  const b = {
    position: [20, 0, 0],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  };
  vectorNear(mapPoint(v([2.4, 3.7, 3.8]), a, b), [19.6, 0.2, -0.7]);
  vectorNear(mapDirection(v([2, 3, -12]), a, b), [-2, 12, -3]);
});

test("oblique frames match an independent scalar oracle; roundtrips conserve speed", () => {
  const a = {
    position: [-3, 2, -5],
    quaternion: [0, 0, Math.sin(Math.PI / 12), Math.cos(Math.PI / 12)],
  };
  const b = {
    position: [15, 2.5, 0],
    quaternion: [
      -0.12278780396897282, -0.696364240320019, -0.12278780396897282,
      0.696364240320019,
    ],
  };
  for (let i = 0; i < 60; i++) {
    const point = [Math.sin(i) * 7, i / 9, Math.cos(i) * 11],
      direction = [i / 3 - 8, Math.sin(i * 3) * 9, 12 - i / 4];
    const input = v(point),
      output = mapPoint(input, a, b),
      mappedDirection = mapDirection(v(direction), a, b);
    vectorNear(output, oraclePoint(point, a, b));
    vectorNear(mappedDirection, oracleDirection(direction, a, b));
    vectorNear(mapPoint(output, b, a), point);
    vectorNear(mapDirection(mappedDirection, b, a), direction);
    near(mappedDirection.length(), Math.hypot(...direction));
    vectorNear(input, point);
  }
});

test("published roundtrip, normalized direction, and near-zero speed tolerances hold for all frame classes", () => {
  const pairs = [
    LEVELS[0].portals,
    [
      { position: [2, 3, 4], quaternion: [0, 0, 0, 1] },
      { position: [20, 0, 0], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] },
    ],
    [
      {
        position: [-3, 2, -5],
        quaternion: [0, 0, Math.sin(Math.PI / 12), Math.cos(Math.PI / 12)],
      },
      {
        position: [15, 2.5, 0],
        quaternion: [
          -0.12278780396897282, -0.696364240320019, -0.12278780396897282,
          0.696364240320019,
        ],
      },
    ],
  ];
  for (const [a, b] of pairs) {
    const point = [2.45, -1.15, 9.9],
      unit = [2 / 3, -1 / 3, 2 / 3];
    vectorNear(mapPoint(mapPoint(v(point), a, b), b, a), point, 1e-5);
    const expected = oracleDirection(unit, a, b),
      actual = mapDirection(v(unit), a, b).normalize();
    assert.ok(
      Math.hypot(...actual.toArray().map((n, i) => n - expected[i])) <= 1e-6,
    );
    for (const speed of [0, 1e-12, 1e-7, 1, 28]) {
      const mapped = mapDirection(v(unit.map((n) => n * speed)), a, b);
      near(mapped.length(), speed, 1e-6 * speed + 1e-10);
    }
  }
});

test("all shipped, blank, and stress documents satisfy stringent validation", () => {
  for (const doc of [...LEVELS, createBlankLevel(), createStressLevel()])
    assert.deepEqual(
      validateDocument(doc),
      { valid: true, errors: [] },
      doc.id,
    );
  assert.equal(createStressLevel().cubes.length, LEVELS[2].cubes.length + 20);
  const a = createBlankLevel(),
    b = createBlankLevel();
  a.rooms[0].size[0] = 20;
  assert.equal(b.rooms[0].size[0], 12);
});

test("malformed documents and references are rejected without throwing or mutation", () => {
  const changes = [
    (d) => {
      d.version = 2;
    },
    (d) => {
      d.rooms = null;
    },
    (d) => {
      d.rooms[0] = null;
    },
    (d) => {
      d.rooms = new Array(1);
    },
    (d) => {
      d.spawn.position = new Array(3);
    },
    (d) => {
      d.portals[0].position[0] = NaN;
    },
    (d) => {
      d.portals[0].quaternion = [0, 0, 0, 2];
    },
    (d) => {
      d.spawn.position[0] = Infinity;
    },
    (d) => {
      d.spawn.room = "missing";
    },
    (d) => {
      d.portals[0].linkedTo = "missing";
    },
    (d) => {
      d.portals[1].linkedTo = "pb";
    },
    (d) => {
      d.portals[1].width = 3;
    },
    (d) => {
      d.portals[0].enabled = "true";
    },
    (d) => {
      d.portals[0].id = d.rooms[0].id;
    },
    (d) => {
      d.physics.maxSpeed = 29;
    },
    (d) => {
      d.physics.fixedDt = 1 / 30;
    },
    (d) => {
      d.physics.maxSubsteps = 13;
    },
    (d) => {
      d.portals[0].position[2] = -4.9;
    },
    (d) => {
      d.portals[0].quaternion = [0, 1, 0, 0];
    },
    (d) => {
      d.portals[0].position[0] = 4.5;
    },
    (d) => {
      d.spawn.position[1] = 0.1;
    },
    (d) => {
      d.cubes.push(cube("bad-cube", "a", [0, 0, 0]));
    },
    (d) => {
      d.blocks.push({
        id: "bad-block",
        room: "a",
        position: [0, 1.6, -4.7],
        size: [2, 2, 0.4],
      });
    },
    (d) => {
      d.plates.push({
        id: "bad-plate",
        room: "a",
        position: [2, 0.07, 0],
        size: [1.3, 0.14, 1.3],
        doorIds: ["missing"],
      });
    },
  ];
  assert.equal(validateDocument(null).valid, false);
  for (const change of changes) {
    const doc = fixture();
    change(doc);
    const before = cloneDocument(doc);
    assert.equal(validateDocument(doc).valid, false, String(change));
    assert.deepEqual(doc, before);
    assert.throws(() => new World(doc), /Invalid world document/);
  }
});

test("coplanar aperture overlaps are rejected; valid rolled wall frames are accepted", () => {
  const doc = fixture();
  doc.portals[0].position[1] = 2.5;
  doc.portals[1].position[1] = 2.5;
  doc.portals[0].quaternion = [0, 0, Math.sin(0.2), Math.cos(0.2)];
  assert.equal(validateDocument(doc).valid, true);
  const a = cloneDocument(doc.portals[0]),
    b = cloneDocument(doc.portals[1]);
  a.id = "pc";
  a.linkedTo = "pd";
  b.id = "pd";
  b.linkedTo = "pc";
  doc.portals.push(a, b);
  assert.ok(validateDocument(doc).errors.some((e) => e.includes("overlap")));
});

test("swept wall crossing transfers identity, room, velocity, orientation, and spin exactly once", () => {
  const world = new World(fixture({ cubes: [cube("box", "a", [0, 1.6, -3])] }));
  const body = world.cubes.get("box"),
    q = new Quaternion().setFromAxisAngle(v([1, 0, 0]), 0.12);
  body.quaternion.copy(q);
  body.velocity.set(2, -1, -12);
  body.angularVelocity.set(1, 2, 3);
  world.moveBody(body, v([0, 0, -3]));
  assert.equal(world.cubes.get("box"), body);
  assert.equal(body.room, "b");
  assert.equal(world.crossings, 1);
  vectorNear(body.velocity, [2, -1, -12]);
  vectorNear(body.angularVelocity, [1, 2, 3]);
  near(Math.abs(body.quaternion.dot(q)), 1);
  assert.ok(body.position.z < 4.1 && body.position.z > 3.9);
  near(world.lastMapping.speedBefore, world.lastMapping.speedAfter);
});

test("floor-to-wall crossing has numeric velocity/spin oracle and does not reset mapped look", () => {
  const world = new World(fixture({ floor: true })),
    body = world.player;
  body.velocity.set(0.3, -12, 0.4);
  body.angularVelocity.set(1, 2, 3);
  const [a, b] = world.doc.portals;
  const oldForward = new Vector3(0, 0, -1)
    .applyQuaternion(body.quaternion)
    .toArray();
  world.moveBody(body, v([0, -3, 0]));
  assert.equal(body.room, "b");
  assert.equal(world.crossings, 1);
  vectorNear(body.velocity, [0.3, -0.4, -12]);
  vectorNear(body.angularVelocity, [1, -3, 2]);
  const expectedForward = oracleDirection(oldForward, a, b);
  vectorNear(
    new Vector3(0, 0, -1).applyQuaternion(body.quaternion),
    expectedForward,
  );
  world.look(0, 0);
  vectorNear(
    new Vector3(0, 0, -1).applyQuaternion(body.quaternion),
    expectedForward,
  );
  // The body has crossed, but its rigidly transported eye is still in A.
  assert.equal(world.cameraFrame().room, "a");
  vectorNear(
    new Vector3(0, 0, -1).applyQuaternion(world.cameraFrame().quaternion),
    oldForward,
  );
  world.moveBody(body, v([0, 0, -0.3]));
  assert.equal(world.cameraFrame().room, "b");
  vectorNear(
    new Vector3(0, 0, -1).applyQuaternion(world.cameraFrame().quaternion),
    expectedForward,
  );
  world.setInput({ forward: 0, yaw: 0, pitch: 0 });
  vectorNear(
    new Vector3(0, 0, -1).applyQuaternion(body.quaternion),
    expectedForward,
  );
});

test("ceiling-to-sidewall apertures transport the eye and body independently", () => {
  const doc = fixture();
  doc.spawn.position = [0, 2.5, 0];
  doc.portals[0].position = [0, 5, 0];
  doc.portals[0].quaternion = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  doc.portals[1].position = [15, 2.5, 0];
  doc.portals[1].quaternion = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  const world = new World(doc);
  world.moveBody(world.player, v([0, 2, 0]));
  assert.equal(world.player.room, "a");
  assert.equal(world.cameraFrame().room, "b");
  near(world.cameraFrame().position.x, 15.17, 1e-6);
  world.player.velocity.set(0, 10, 0);
  world.moveBody(world.player, v([0, 1, 0]));
  assert.equal(world.player.room, "b");
  vectorNear(world.player.velocity, [10, 0, 0]);
});

test("rolled wall apertures use body extents and transport orientation at runtime", () => {
  const doc = fixture({ cubes: [cube("rolled-box", "a", [0, 2.5, -3])] });
  doc.portals[0].position[1] = 2.5;
  doc.portals[1].position[1] = 2.5;
  doc.portals[0].quaternion = [0, 0, Math.sin(0.2), Math.cos(0.2)];
  const world = new World(doc),
    body = world.cubes.get("rolled-box");
  body.velocity.set(1, 2, -8);
  body.angularVelocity.set(2, -1, 3);
  world.moveBody(body, v([0, 0, -3]));
  assert.equal(body.room, "b");
  vectorNear(body.velocity, oracleDirection([1, 2, -8], ...doc.portals));
  vectorNear(body.angularVelocity, oracleDirection([2, -1, 3], ...doc.portals));
});

test("finite aperture margins pass an interior body and reject edge clips and frame tunneling", () => {
  for (const [x, accepted] of [
    [0.915, true],
    [0.925, false],
    [1.21, false],
    [3, false],
  ]) {
    const doc = fixture();
    doc.spawn.position[0] = x;
    const world = new World(doc);
    world.moveBody(world.player, v([0, 0, -10]));
    assert.equal(world.player.room, accepted ? "b" : "a", `x=${x}`);
    if (!accepted) assert.ok(world.player.position.z >= -4.72001);
  }
  const world = new World(fixture());
  world.moveBody(world.player, v([4, 0, -4]));
  world.moveBody(world.player, v([0, 0, -100]));
  assert.equal(world.player.room, "a");
  assert.ok(world.player.position.z >= -4.72001);
  assert.ok(world.events.some((e) => e.type === "movement-clamped"));
});

test("closed portals and occupied destinations stay solid without corrupting bodies", () => {
  const blocked = new World(
    fixture({ cubes: [cube("exit-blocker", "b", [20, 1.6, 4.65])] }),
  );
  blocked.moveBody(blocked.player, v([0, 0.74, -3]));
  blocked.moveBody(blocked.player, v([0, 0, -7]));
  assert.equal(blocked.player.room, "a");
  assert.equal(blocked.crossings, 0);
  assert.ok(blocked.player.position.z >= -4.721);
  const closed = new World(fixture());
  closed.setPortalEnabled("pb", false);
  closed.moveBody(closed.player, v([0, 0, -9]));
  assert.equal(closed.player.room, "a");
});

test("straddling has one physical identity, a destination ghost, and safe disable recovery", () => {
  const world = new World(fixture({ cubes: [cube("box", "a", [0, 1.6, -4])] })),
    body = world.cubes.get("box");
  world.moveBody(body, v([0, 0, -0.85]));
  const straddle = world.getStraddle(body);
  assert.equal(straddle.portal.id, "pa");
  assert.equal(straddle.destination.id, "pb");
  assert.equal(world.cubes.size, 1);
  const hit = world.raycast(v([20, 1.6, 3]), v([0, 0, 1]), 4, 6, "b");
  assert.equal(hit.id, "box");
  assert.equal(hit.room, "b");
  assert.ok(hit.distance < 2);
  assert.equal(world.setPortalEnabled("pa", false), true);
  assert.equal(world.getStraddle(body), null);
  assert.ok(body.position.z >= -4.64801);
  vectorNear(body.velocity, [0, 0, 0]);
  assert.equal(world.setPortalEnabled("missing", true), false);
});

test("destination bodies collide against the protruding ghost of a source cube", () => {
  const world = new World(
    fixture({
      cubes: [
        cube("source", "a", [0, 1.6, -4]),
        cube("destination", "b", [20, 1.6, 3.8]),
      ],
    }),
  );
  const source = world.cubes.get("source"),
    destination = world.cubes.get("destination");
  world.moveBody(source, v([0, 0, -0.85]));
  assert.ok(world.getStraddle(source));
  world.moveBody(destination, v([0, 0, 0.9]));
  assert.ok(destination.position.z <= 4.451);
  assert.equal(destination.room, "b");
  assert.equal(source.room, "a");
});

test("portal closure is refused when both safe recovery poses have become occupied", () => {
  const world = new World(
    fixture({
      cubes: [
        cube("source", "a", [0, 1.6, -4]),
        cube("blocker", "a", [2, 1.6, -4]),
      ],
    }),
  );
  const source = world.cubes.get("source"),
    blocker = world.cubes.get("blocker");
  world.moveBody(source, v([0, 0, -0.85]));
  world.moveBody(blocker, v([-2, 0, 0]));
  assert.equal(world.setPortalEnabled("pa", false), false);
  assert.equal(world.portals.get("pa").enabled, true);
  assert.ok(source.position.distanceTo(blocker.position) >= 0.7);
});

test("crossing exit cooldown prevents immediate chatter and permits deliberate return", () => {
  const world = new World(fixture());
  world.moveBody(world.player, v([0, 0, -8.01]));
  assert.equal(world.crossings, 1);
  assert.equal(world.player.room, "b");
  for (let i = 0; i < 10; i++) world.moveBody(world.player, v([0, 0, 0.02]));
  assert.equal(world.crossings, 1);
  tick(world, 0.05);
  world.moveBody(world.player, v([0, 0, 1]));
  assert.equal(world.player.room, "a");
  assert.equal(world.crossings, 2);
});

test("all six room boundaries support finite swept collision and thin rotated blocks occlude", () => {
  const doc = createBlankLevel();
  doc.physics.gravity = 0;
  doc.blocks.push({
    id: "thin",
    room: "blank-room",
    position: [0, 1, 0],
    size: [3, 2, 0.04],
    rotation: [0, Math.sin(0.12), 0, Math.cos(0.12)],
  });
  const world = new World(doc);
  world.moveBody(world.player, v([0, 0, -10]));
  assert.ok(world.player.position.z > 0);
  world.moveBody(world.player, v([20, 0, 0]));
  near(world.player.position.x, 5.72, 1e-5);
  world.moveBody(world.player, v([0, 20, 0]));
  near(world.player.position.y, 4.15, 1e-5);
  world.moveBody(world.player, v([0, 0, 20]));
  near(world.player.position.z, 6.72, 1e-5);
  world.moveBody(world.player, v([-20, 0, 0]));
  near(world.player.position.x, -5.72, 1e-5);
  world.moveBody(world.player, v([0, -20, 0]));
  near(world.player.position.y, 0.85, 1e-5);
  world.moveBody(world.player, v([0, 0, -20]));
  near(world.player.position.z, -6.72, 1e-5);
});

test("analytic rays accumulate metric distance through a portal and obey occlusion and budgets", () => {
  const world = new World(
    fixture({ cubes: [cube("target", "b", [20, 1.6, 3])] }),
  );
  const origin = v([0, 1.6, -3]),
    direction = v([0, 0, -7]);
  const hit = world.raycast(origin, direction, 5);
  assert.equal(hit.id, "target");
  assert.equal(hit.type, "cube");
  assert.equal(hit.room, "b");
  assert.deepEqual(hit.path, ["pa"]);
  near(hit.distance, 3.65);
  vectorNear(hit.point, [20, 1.6, 3.35]);
  assert.equal(world.raycast(origin, direction, 3), null);
  assert.equal(world.raycast(origin, direction, 5, 0).type, "portal");
  assert.equal(world.raycast(v([1.3, 1.6, -3]), direction, 5).type, "wall");
  world.setPortalEnabled("pa", false);
  assert.equal(world.raycast(origin, direction, 5).type, "wall");
  assert.equal(world.raycast(v([0, 1.6, 20]), direction, 100), null);
  vectorNear(origin, [0, 1.6, -3]);
  vectorNear(direction, [0, 0, -7]);
});

test("recursive rays terminate at the exact traversal budget and expose a depth-three path", () => {
  const world = new World(LEVELS[2]);
  const hit = world.raycast(
    v([0, 1.6, 0]),
    v([0, 0, -1]),
    100,
    3,
    "loop-origin",
  );
  assert.equal(hit.type, "portal");
  assert.deepEqual(hit.path, ["loop-a-north", "loop-b-north", "loop-c-north"]);
  near(hit.distance, 42);
  assert.equal(hit.room, "loop-origin");
  const bounded = world.raycast(
    v([0, 1.6, 0]),
    v([0, 0, -1]),
    1000,
    100,
    "loop-origin",
  );
  assert.equal(bounded.path.length, 6);
});

test("rays intersect rotated cubes, doors, and blocks analytically rather than through walls", () => {
  const doc = fixture({ cubes: [cube("rotated", "a", [0, 1, 0])] });
  doc.cubes[0].quaternion = [
    0,
    Math.sin(Math.PI / 8),
    0,
    Math.cos(Math.PI / 8),
  ];
  doc.blocks.push({
    id: "screen",
    room: "a",
    position: [2, 1, 0],
    size: [0.2, 2, 2],
  });
  doc.doors.push({
    id: "gate",
    room: "a",
    position: [-2, 1, 0],
    size: [0.2, 2, 2],
  });
  const world = new World(doc);
  near(
    world.raycast(v([0, 1, 2]), v([0, 0, -1]), 4).distance,
    2 - Math.SQRT2 * 0.35,
  );
  assert.equal(world.raycast(v([4, 1, 0]), v([-1, 0, 0]), 5).id, "screen");
  assert.equal(world.raycast(v([-4, 1, 0]), v([1, 0, 0]), 5).id, "gate");
  assert.equal(world.raycast(v([0.45, 1, 0.45]), v([1, 0, 0]), 0.5), null);
});

test("pickup, hold, drop, and throwing operate through a portal in the actual cube room", () => {
  const doc = fixture({ cubes: [cube("remote", "b", [20, 1.53, 3.8])] });
  doc.spawn.position = [0, 0.86, -3];
  const world = new World(doc),
    body = world.cubes.get("remote");
  world.look(0, 0);
  assert.equal(world.interact(), "remote");
  assert.deepEqual(world.held.path, ["pa"]);
  tick(world, 0.1);
  assert.equal(world.held.id, "remote");
  assert.equal(body.room, "b");
  assert.equal(world.throwHeld(), true);
  assert.equal(world.held, null);
  vectorNear(body.velocity, [0, 0, -13]);
  assert.equal(body.room, "b");
  assert.equal(world.throwHeld(), false);
});

test("held cubes cannot pass through solid walls and remote pickup obeys total reach", () => {
  const doc = fixture({
    cubes: [
      cube("local", "a", [0, 1.53, 1.3]),
      cube("far", "b", [20, 1.53, 0]),
    ],
  });
  const world = new World(doc);
  assert.equal(world.interact(), "local");
  world.look(Math.PI / 2, 0);
  tick(world, 0.5);
  const body = world.cubes.get("local");
  assert.ok(body.position.x >= -4.65);
  assert.equal(world.interact(), "local");
  assert.equal(world.held, null);
  world.moveBody(world.player, v([0, 0, -6]));
  world.look(0, 0);
  assert.equal(world.interact(), null);
});

test("a picked-up cube can be carried through the delivery portal and released onto its plate", () => {
  const world = new World(LEVELS[0]);
  const walk = (target, through = false) => {
    const room = world.player.room;
    for (let i = 0; i < 1200; i++) {
      const delta = v(target).sub(world.player.position);
      if (delta.length() < 0.03 || (through && world.player.room !== room))
        return;
      if (delta.length() > 3 / 120) delta.setLength(3 / 120);
      world.moveBody(world.player, delta);
      world.step();
    }
    assert.fail(`walk stalled at ${world.player.position.toArray()}`);
  };
  walk([-0.8, 0.85, 2.6]);
  world.look(0, -0.6);
  assert.equal(world.interact(), "delivery-cube");
  world.look(0, 0);
  tick(world, 0.25);
  walk([-2.7, 0.85, -4.8]);
  walk([-2.7, 0.85, -7.5], true);
  assert.equal(world.player.room, "annex");
  assert.equal(world.held.id, "delivery-cube");
  assert.equal(world.cubes.get("delivery-cube").room, "annex");
  walk([22, 0.85, 1.9]);
  world.look(0, -0.5);
  tick(world, 0.5);
  assert.equal(world.interact(), "delivery-cube");
  tick(world, 0.8);
  assert.equal(world.plates.get("delivery-plate").active, true);
  assert.equal(world.doors.get("delivery-door").active, true);
  assert.equal(world.cubes.get("delivery-cube").room, "annex");
});

test("a supported plate weight stops activating the plate immediately when held", () => {
  const doc = createBlankLevel();
  doc.spawn.position = [0, 0.86, 2];
  doc.cubes = [cube("weight", "blank-room", [0, 0.49, 0])];
  doc.plates = [
    {
      id: "plate",
      room: "blank-room",
      position: [0, 0.07, 0],
      size: [1.3, 0.14, 1.3],
      doorIds: [],
    },
  ];
  const world = new World(doc);
  world.step();
  assert.equal(world.plates.get("plate").active, true);
  world.look(0, -0.475);
  assert.equal(world.interact(), "weight");
  world.step();
  assert.equal(world.plates.get("plate").active, false);
});

test("stacked cubes settle on one another and player support is stable", () => {
  const doc = createBlankLevel();
  doc.cubes = [
    cube("bottom", "blank-room", [0, 0.4, 0]),
    cube("top", "blank-room", [0, 1.3, 0]),
  ];
  const world = new World(doc);
  tick(world, 2);
  near(world.cubes.get("bottom").position.y, 0.35, 0.003);
  near(world.cubes.get("top").position.y, 1.05, 0.003);
  assert.equal(world.cubes.get("top").grounded, true);
  assert.equal(world.player.grounded, true);
  near(world.player.position.y, 0.85, 0.003);
});

test("plates require supported occupancy; door wiring is AND and goals require spatial entry", () => {
  const doc = createBlankLevel();
  doc.cubes = [
    cube("weight-a", "blank-room", [-2, 2, 0]),
    cube("weight-b", "blank-room", [2, 2, 0]),
  ];
  doc.plates = [-2, 2].map((x, i) => ({
    id: `plate-${i}`,
    room: "blank-room",
    position: [x, 0.07, 0],
    size: [1.3, 0.14, 1.3],
    doorIds: ["gate"],
  }));
  doc.doors = [
    {
      id: "gate",
      room: "blank-room",
      position: [0, 2.5, -3],
      size: [12, 5, 0.3],
    },
  ];
  doc.goals = [
    {
      id: "goal",
      room: "blank-room",
      position: [0, 0.9, -5],
      size: [2, 1.8, 1],
      requires: ["gate"],
    },
  ];
  const world = new World(doc);
  world.step();
  assert.equal(world.plates.get("plate-0").active, false);
  assert.equal(world.doors.get("gate").active, false);
  world.moveBody(world.cubes.get("weight-b"), v([1.5, 0, 0]));
  tick(world, 0.8);
  assert.equal(world.plates.get("plate-0").active, true);
  assert.equal(world.plates.get("plate-1").active, false);
  assert.equal(world.doors.get("gate").active, false);
  world.moveBody(world.player, v([0, 0, -12]));
  assert.ok(world.player.position.z >= -2.57001);
  world.moveBody(world.cubes.get("weight-b"), v([0, 0.25, 0]));
  world.moveBody(world.cubes.get("weight-b"), v([-1.5, 0, 0]));
  tick(world, 0.8);
  assert.equal(world.doors.get("gate").active, true);
  near(world.doors.get("gate").open, 1);
  assert.equal(world.completed, false);
  world.moveBody(world.player, v([0, 0, -3]));
  world.step();
  assert.equal(world.completed, true);
  world.reset();
  assert.equal(world.completed, false);
  assert.equal(world.time, 0);
  assert.equal(world.crossings, 0);
});

test("fixed-step results agree at 30/60/144 Hz, and overload is discarded", () => {
  const worlds = [30, 60, 144].map((hz) => {
    const world = new World(createBlankLevel());
    world.setInput({ forward: 0.4, strafe: 0.2 });
    for (let i = 0; i < hz * 2; i++) world.advance(1 / hz);
    near(world.time, 2);
    return world;
  });
  for (const world of worlds.slice(1)) {
    vectorNear(
      world.player.position,
      worlds[0].player.position.toArray(),
      1e-9,
    );
    vectorNear(
      world.player.velocity,
      worlds[0].player.velocity.toArray(),
      1e-9,
    );
  }
  const world = new World(createBlankLevel());
  assert.equal(world.advance(10), 12);
  near(world.time, 0.1);
  assert.equal(world.advance(1 / 120), 1);
  near(world.time, 0.1 + 1 / 120);
  assert.equal(world.advance(NaN), 0);
  assert.equal(world.advance(-1), 0);
});

test("public input and advance alone move a walking player through a wall portal", () => {
  const world = new World(fixture({ gravity: 9.81 }));
  world.setInput({ forward: 1, yaw: 0, pitch: 0 });
  for (let i = 0; i < 120; i++) world.advance(1 / 60);
  assert.equal(world.player.room, "b");
  assert.equal(world.crossings, 1);
  assert.ok(world.player.velocity.z < -5);
  assert.equal(world.player.grounded, true);
});

test("a gravity-driven cube crosses a floor portal once and settles without rest loops", () => {
  const doc = cloneDocument(LEVELS[1]);
  doc.cubes.push(cube("falling", "drop-shaft", [0, 3, 0]));
  const world = new World(doc);
  tick(world, 4);
  assert.equal(world.cubes.get("falling").room, "landing-hall");
  assert.equal(world.crossings, 1);
  assert.equal(world.cubes.get("falling").grounded, true);
});

test("speed is bounded, jumping is edge-triggered, and camera uses body center plus eye offset", () => {
  const world = new World(createBlankLevel());
  tick(world, 0.2);
  vectorNear(world.cameraFrame().position, [0, 1.52, 4.7], 1e-5);
  world.look(Math.PI / 2, 0);
  vectorNear(
    new Vector3(0, 0, -1).applyQuaternion(world.player.quaternion),
    [-1, 0, 0],
  );
  world.setInput({ jump: true });
  world.step();
  assert.ok(world.player.velocity.y > 5);
  tick(world, 2);
  near(world.player.position.y, 0.85, 0.003);
  world.player.velocity.set(100, 100, 100);
  world.step();
  assert.ok(world.player.velocity.length() <= 28 + EPSILON);
});
const EPSILON = 1e-8;

for (const [index, demo] of DEMOS.entries())
  test(`physical solution commands complete level ${index + 1} without success flags`, () => {
    const world = new World(LEVELS[index]);
    for (const command of demo.steps) {
      if (command.action === "move") {
        const body = command.body
          ? world.cubes.get(command.body)
          : world.player;
        world.moveBody(body, v(command.target).sub(body.position));
        if (command.roomAfter) assert.equal(body.room, command.roomAfter);
      } else if (command.action === "wait") tick(world, command.seconds);
    }
    assert.equal(
      world.completed,
      true,
      `player at ${world.player.position.toArray()} in ${world.player.room}`,
    );
    assert.ok(world.crossings >= (index === 2 ? 3 : 1));
  });

test("stress simulation remains finite with 21 cubes and bounded event history", () => {
  const world = new World(createStressLevel());
  tick(world, 0.5);
  for (const body of [world.player, ...world.cubes.values()]) {
    assert.ok(body.position.toArray().every(Number.isFinite));
    assert.ok(body.velocity.length() <= 28 + EPSILON);
  }
  assert.ok(world.events.length <= 256);
  assert.equal(world.cubes.size, 21);
});

test("a closing door waits for an occupying body instead of crushing it into a boundary", () => {
  const doc = createBlankLevel();
  doc.spawn.position = [0, 0.86, 2];
  doc.cubes = [cube("weight", "blank-room", [-2, 0.49, 0])];
  doc.plates = [
    {
      id: "sensor",
      room: "blank-room",
      position: [-2, 0.07, 0],
      size: [1.3, 0.14, 1.3],
      doorIds: ["gate"],
    },
  ];
  doc.doors = [
    {
      id: "gate",
      room: "blank-room",
      position: [0, 2.5, -3],
      size: [12, 5, 0.3],
    },
  ];
  const world = new World(doc);
  tick(world, 0.7);
  assert.equal(world.doors.get("gate").open, 1);
  world.moveBody(world.player, v([0, 0, -5]));
  world.moveBody(world.cubes.get("weight"), v([3, 0, 0]));
  tick(world, 1);
  assert.equal(world.doors.get("gate").active, false);
  assert.ok(world.doors.get("gate").open > 0.32);
  near(world.player.position.y, 0.85, 0.003);
  world.moveBody(world.player, v([0, 0, -1]));
  tick(world, 1);
  assert.equal(world.doors.get("gate").open, 0);
});
