import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { World } from "../src/core.js";
import { LEVELS } from "../src/levels.js";
import { SolutionReplay, runSolution } from "../src/replay.js";

const DT = 1 / 120;
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
const vectorNear = (actual, expected, tolerance) =>
  actual.forEach((value, axis) => near(value, expected[axis], tolerance));

// The controller sees live read-only state and only the allowed input/physics
// methods. World.step itself retains the real receiver, including its solver.
function observe(world) {
  const proxies = new WeakMap();
  const denyWrite = () => assert.fail("Replay world state is read-only");
  const readonly = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (proxies.has(value)) return proxies.get(value);
    const proxy = new Proxy(value, {
      get(target, key) {
        if (target instanceof Map && key === "get")
          return (id) => readonly(target.get(id));
        if (target instanceof Map && key === "values")
          return function* () {
            for (const item of target.values()) yield readonly(item);
          };
        const result = Reflect.get(target, key, target);
        assert.notEqual(
          typeof result,
          "function",
          `Replay must not invoke state method ${String(key)}`,
        );
        return readonly(result);
      },
      set: denyWrite,
      defineProperty: denyWrite,
      deleteProperty: denyWrite,
      setPrototypeOf: denyWrite,
    });
    proxies.set(value, proxy);
    return proxy;
  };
  const inputs = [],
    mappings = [],
    interactions = [],
    samples = [];
  const allowed = new Set([
    "setInput",
    "look",
    "interact",
    "throwHeld",
    "step",
    "advance",
  ]);
  const controller = new Proxy(world, {
    get(target, key) {
      assert.ok(
        !String(key).startsWith("_"),
        `Replay must not use private world API ${String(key)}`,
      );
      if (!allowed.has(key)) {
        assert.notEqual(
          typeof target[key],
          "function",
          `Replay must not call world.${String(key)}`,
        );
        return readonly(target[key]);
      }
      return (...args) => {
        if (key === "step")
          assert.equal(args[0], DT, "physics always runs at 120 Hz");
        assert.notEqual(
          key,
          "advance",
          "the fixed-tick controller must not double-advance physics",
        );
        const previousMapping = world.lastMapping;
        const beforeView =
          key === "step"
            ? new Vector3(0, 0, -1)
                .applyQuaternion(world.player.quaternion)
                .toArray()
            : null;
        const result = target[key](...args);
        if (key === "interact" || key === "throwHeld")
          interactions.push({
            action: key,
            result,
            held: world.held?.id || null,
          });
        if (key === "step") {
          inputs.push({ ...world.input });
          samples.push({
            room: world.player.room,
            position: world.player.position.toArray(),
            velocity: world.player.velocity.toArray(),
            grounded: world.player.grounded,
          });
          if (world.lastMapping !== previousMapping) {
            const mapping = world.lastMapping;
            mappings.push({
              id: mapping.id,
              from: mapping.from,
              to: mapping.to,
              positionBefore: mapping.positionBefore.toArray(),
              positionAfter: mapping.positionAfter.toArray(),
              velocityBefore: mapping.velocityBefore.toArray(),
              velocityAfter: mapping.velocityAfter.toArray(),
              rotation: mapping.rotation.toArray(),
              speedBefore: mapping.speedBefore,
              speedAfter: mapping.speedAfter,
              held: world.held?.id || null,
              forwardBefore: beforeView,
              forwardAfter: new Vector3(0, 0, -1)
                .applyQuaternion(world.player.quaternion)
                .toArray(),
            });
          }
          for (const plate of world.doc.plates)
            if (world.plates.get(plate.id).active) {
              const cube = [...world.cubes.values()][0];
              assert.equal(
                world.held,
                null,
                "the replay must release its weight",
              );
              assert.equal(cube.room, plate.room);
              assert.equal(
                cube.grounded,
                true,
                "the cube, not the walking player, supports the plate",
              );
              near(
                cube.position.y - cube.size / 2,
                plate.position[1] + plate.size[1] / 2,
                0.003,
              );
            }
        }
        return result;
      };
    },
    set: denyWrite,
    defineProperty: denyWrite,
    deleteProperty: denyWrite,
    setPrototypeOf: denyWrite,
  });
  return { controller, inputs, mappings, interactions, samples };
}

function snapshot(world) {
  const body = (item) => ({
    id: item.id,
    room: item.room,
    position: item.position.toArray(),
    velocity: item.velocity.toArray(),
    quaternion: item.quaternion.toArray(),
    grounded: item.grounded,
  });
  return {
    completed: world.completed,
    time: world.time,
    input: { ...world.input },
    held: world.held,
    player: body(world.player),
    cubes: [...world.cubes.values()].map(body),
    plates: structuredClone([...world.plates]),
    doors: structuredClone([...world.doors]),
    crossings: world.crossings,
    events: structuredClone(world.events),
  };
}

function play(world, index, rates = [DT]) {
  const observation = observe(world);
  const replay = new SolutionReplay(observation.controller, index);
  let supplied = 0,
    updates = 0;
  while (!replay.done && supplied < 90) {
    const dt = rates[updates++ % rates.length];
    replay.update(dt);
    supplied += dt;
  }
  assert.equal(replay.error, null, `${LEVELS[index].name}: ${replay.error}`);
  assert.equal(
    replay.done,
    true,
    `${replay.label}: ${world.player.position.toArray()}`,
  );
  assert.equal(world.completed, true);
  assert.ok(replay.elapsed < 90);
  assert.equal(observation.inputs.length, Math.round(replay.elapsed * 120));
  near(world.time, replay.elapsed);
  assert.ok(
    observation.inputs.some(
      (input) => Math.abs(input.forward) + Math.abs(input.strafe) > 0,
    ),
  );
  assert.ok(observation.inputs.every((input) => !input.jump));
  assert.equal(world.input.forward, 0);
  assert.equal(world.input.strafe, 0);
  const state = snapshot(world);
  replay.update(10);
  assert.deepEqual(
    snapshot(world),
    state,
    "completed replay must never step again",
  );
  return { replay, state, ...observation };
}

for (const index of [0, 1, 2]) {
  test(`public gameplay input replay completes ${LEVELS[index].name}`, () => {
    const world = new World(LEVELS[index]);
    const { mappings, interactions, samples } = play(world, index);
    assert.equal(mappings.length, world.crossings);
    assert.equal(
      world.events.filter((event) => event.type === "complete").length,
      1,
    );
    assert.equal(world.events.at(-1).id, world.doc.goals[0].id);
    for (const mapping of mappings) {
      near(mapping.speedBefore, mapping.speedAfter);
      if (index !== 1) {
        vectorNear(mapping.velocityAfter, mapping.velocityBefore);
        near(Math.abs(mapping.rotation[3]), 1);
        const translation = index === 0 ? [24.7, 0, 13] : [22, 0, 12];
        // The recorded endpoint includes up to one 8 cm swept segment and skin.
        vectorNear(
          mapping.positionAfter,
          mapping.positionBefore.map(
            (value, axis) => value + translation[axis],
          ),
          0.083,
        );
        if (mapping.id === "player")
          vectorNear(mapping.forwardAfter, mapping.forwardBefore);
      }
    }
    if (index === 1) {
      assert.deepEqual(interactions, []);
      assert.deepEqual(
        world.events.map((event) => event.type),
        ["crossing", "complete"],
      );
      assert.equal(mappings.length, 1);
      const mapping = mappings[0];
      assert.equal(mapping.from, "momentum-floor");
      assert.equal(mapping.to, "momentum-wall");
      near(mapping.positionBefore[1], 0);
      assert.ok(
        Math.abs(mapping.positionBefore[0]) < 0.04 &&
          Math.abs(mapping.positionBefore[2]) < 0.04,
      );
      assert.ok(
        mapping.velocityBefore[1] < -12,
        "momentum comes from the full balcony fall",
      );
      assert.ok(
        Math.abs(mapping.velocityBefore[2]) < 0.1,
        "horizontal motion is braked over the floor aperture",
      );
      const [vx, vy, vz] = mapping.velocityBefore;
      vectorNear(mapping.velocityAfter, [vx, -vz, vy]);
      const [fx, fy, fz] = mapping.forwardBefore;
      vectorNear(mapping.forwardAfter, [fx, -fz, fy]);
      const [x, y, z] = mapping.positionBefore;
      vectorNear(mapping.positionAfter, [22 + x, 4.5 - z, 7 + y], 0.083);
      assert.ok(
        samples.some(
          (sample) =>
            sample.room === "drop-shaft" &&
            sample.grounded &&
            sample.position[1] > 8.8,
        ),
      );
      const flight = samples.filter((sample) => sample.room === "landing-hall");
      assert.ok(flight.length > 40);
      for (const sample of flight)
        near(sample.velocity[2], mapping.velocityAfter[2]);
      // Goal overlap occurs just above the island. The unassisted trajectory
      // must actually settle on it, rather than merely brush the goal in flight.
      for (let tick = 0; tick < 24; tick++) world.step(DT);
      assert.equal(world.player.grounded, true);
      near(world.player.position.y, 2.2 + world.player.halfHeight, 0.003);
      return;
    }
    const cubeId = index === 0 ? "delivery-cube" : "loop-cube";
    assert.deepEqual(interactions, [
      { action: "interact", result: cubeId, held: cubeId },
      { action: "interact", result: cubeId, held: null },
    ]);
    assert.deepEqual(
      world.events.map((event) => event.type),
      index === 0
        ? [
            "pickup",
            "crossing",
            "crossing",
            "drop",
            "plate",
            "door",
            "complete",
          ]
        : [
            "pickup",
            "crossing",
            "crossing",
            "drop",
            "plate",
            "door",
            "crossing",
            "complete",
          ],
    );
    assert.deepEqual(
      mappings.map(({ id, from, to }) => [id, from, to]),
      index === 0
        ? [
            [cubeId, "delivery-teal", "delivery-amber"],
            ["player", "delivery-teal", "delivery-amber"],
          ]
        : [
            [cubeId, "loop-a-north", "loop-b-south"],
            ["player", "loop-a-north", "loop-b-south"],
            ["player", "loop-b-north", "loop-c-south"],
          ],
    );
    assert.equal(mappings[0].held, cubeId);
    assert.equal(mappings[1].held, cubeId);
    assert.equal(world.cubes.get(cubeId).room, world.doc.plates[0].room);
    assert.equal(world.plates.get(world.doc.plates[0].id).active, true);
    assert.equal(world.doors.get(world.doc.doors[0].id).active, true);
    near(world.doors.get(world.doc.doors[0].id).open, 1);
    if (index === 0)
      assert.ok(
        world.player.position.z < -4,
        "walked past the full-width door",
      );
    else
      assert.ok(
        world.player.position.x > 46.2,
        "walked through the side partition door",
      );
  });

  test(`${LEVELS[index].name} replay resets and reproduces every tick at varying update rates`, () => {
    const world = new World(LEVELS[index]);
    const baseline = play(world, index);
    for (const rates of [
      [1 / 30],
      [1 / 60],
      [1 / 144],
      [1 / 240, 1 / 24, 1 / 75, 1 / 48, 0.19],
    ]) {
      world.reset();
      const actual = play(world, index, rates);
      assert.deepEqual(actual.state, baseline.state);
      assert.deepEqual(actual.inputs, baseline.inputs);
      assert.deepEqual(actual.mappings, baseline.mappings);
      assert.deepEqual(actual.samples, baseline.samples);
      assert.equal(actual.replay.elapsed, baseline.replay.elapsed);
      assert.equal(actual.replay.stepIndex, baseline.replay.stepIndex);
    }
    world.reset();
    const summary = runSolution(observe(world).controller, index, 90);
    assert.equal(summary.completed, true);
    assert.equal(summary.done, true);
    assert.equal(summary.error, null);
    assert.equal(summary.elapsed, baseline.replay.elapsed);
    assert.deepEqual(snapshot(world), baseline.state);
  });
}

test("replay clock ignores invalid updates, accumulates fractional ticks, and exposes stage progress", () => {
  const world = new World(LEVELS[0]);
  const replay = new SolutionReplay(observe(world).controller, 0);
  assert.equal(replay.done, false);
  assert.equal(replay.error, null);
  assert.equal(replay.stepIndex, 0);
  assert.equal(replay.elapsed, 0);
  assert.match(replay.label, /cube/);
  for (const dt of [0, -1, NaN, Infinity, undefined]) replay.update(dt);
  assert.equal(world.time, 0);
  replay.update(DT / 2);
  assert.equal(world.time, 0);
  replay.update(DT / 2);
  assert.equal(world.time, DT);
  assert.equal(replay.elapsed, DT);
  replay.update(2);
  assert.ok(replay.stepIndex > 0);
});

test("unsupported, obstructed, and time-limited replays stop honestly without success flags", () => {
  for (const index of [-1, 3, 0.5, 1]) {
    const world = new World(LEVELS[0]);
    const replay = new SolutionReplay(observe(world).controller, index);
    assert.equal(replay.done, true);
    assert.match(replay.error, /No input solution/);
    replay.update(1000);
    assert.equal(world.time, 0);
    assert.equal(world.completed, false);
  }
  const blocked = new World(LEVELS[0]);
  blocked.setPortalEnabled("delivery-teal", false);
  const replay = new SolutionReplay(observe(blocked).controller, 0);
  replay.update(1e6);
  assert.equal(replay.done, true);
  assert.match(replay.error, /stalled/);
  assert.ok(replay.elapsed <= 120);
  assert.equal(blocked.completed, false);
  assert.equal(blocked.input.forward, 0);
  assert.equal(blocked.input.strafe, 0);
  const limited = new World(LEVELS[2]);
  const summary = runSolution(observe(limited).controller, 2, 0.1);
  assert.equal(summary.done, true);
  assert.equal(summary.completed, false);
  assert.match(summary.error, /exceeded/);
  assert.equal(summary.elapsed, 0.1);
  near(limited.time, 0.1);
});
