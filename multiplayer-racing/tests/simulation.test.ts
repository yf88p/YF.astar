import { describe, expect, it } from "vitest";
import {
  carSchema,
  NEUTRAL,
  TICK_RATE,
  type CarState,
  type Controls,
} from "../shared/protocol";
import {
  botControls,
  createCar,
  raceResults,
  rankCars,
  stepCar,
  stepRace,
} from "../shared/simulation";
import { nearestTrack, TRACKS, type Track } from "../shared/tracks";

const gas: Controls = { ...NEUTRAL, throttle: 1 };
const reset: Controls = { ...NEUTRAL, reset: true };

function atGate(
  track: Track,
  gateIndex: number,
  offset = -0.3,
  speed = 40,
): CarState {
  const gate = track.checkpoints[gateIndex];
  const x = gate.x + Math.sin(gate.yaw) * offset;
  const z = gate.z + Math.cos(gate.yaw) * offset;
  const progress = nearestTrack(track, x, z).progress;
  return {
    ...createCar("test", track, 0, 0),
    x,
    z,
    yaw: gate.yaw,
    vx: Math.sin(gate.yaw) * speed,
    vz: Math.cos(gate.yaw) * speed,
    speed,
    progress: gateIndex === 0 && offset > 0 ? progress + 1 : progress,
    checkpoint: gateIndex,
  };
}

function runBots(track: Track, count = 1, laps = 1, limit = 120 * TICK_RATE) {
  let cars = Array.from({ length: count }, (_, i) =>
    createCar(`bot-${i}`, track, i, 0),
  );
  for (let tick = 0; tick < limit; tick++) {
    const inputs = Object.fromEntries(
      cars.map((car) => [car.id, botControls(car, track, tick)]),
    );
    cars = stepRace(cars, inputs, track, tick, 0, laps);
    if (cars.every((car) => car.finishTick !== null)) break;
  }
  return cars;
}

describe("circuits", () => {
  it.each(Object.values(TRACKS))(
    "$name is a smooth, accurately measured closed circuit with sampled directed gates",
    (track) => {
      expect(track.points.length).toBeGreaterThan(200);
      expect(track.points[0]).not.toEqual(track.points.at(-1));
      expect(track.width).toBeGreaterThanOrEqual(16);
      expect(track.width).toBeLessThanOrEqual(22);
      expect(track.checkpoints.length).toBeGreaterThanOrEqual(10);
      expect(track.checkpoints.length).toBeLessThanOrEqual(16);
      let length = 0;
      for (let i = 0; i < track.points.length; i++) {
        const a = track.points[i];
        const b = track.points[(i + 1) % track.points.length];
        const c = track.points[(i + 2) % track.points.length];
        const ab = Math.hypot(b.x - a.x, b.z - a.z);
        const bc = Math.hypot(c.x - b.x, c.z - b.z);
        length += ab;
        expect(ab).toBeGreaterThan(2);
        expect(ab).toBeLessThan(5);
        expect(
          ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / (ab * bc),
        ).toBeGreaterThan(0.85);
      }
      expect(length).toBeCloseTo(track.length, 6);
      for (const [i, gate] of track.checkpoints.entries()) {
        expect(track.points).toContainEqual({ x: gate.x, z: gate.z });
        const road = nearestTrack(track, gate.x, gate.z);
        expect(road.distance).toBeCloseTo(0, 8);
        expect(road.progress).toBeGreaterThanOrEqual(0);
        expect(road.progress).toBeLessThan(1);
        expect(road.progress).toBeCloseTo(i / track.checkpoints.length, 2);
        expect(Math.cos(gate.yaw - road.yaw)).toBeGreaterThan(0.98);
      }
    },
  );

  it("projects onto segments rather than snapping to vertices", () => {
    const track = TRACKS.canyon;
    const a = track.points[10];
    const b = track.points[11];
    const x = (a.x + b.x) / 2;
    const z = (a.z + b.z) / 2;
    expect(nearestTrack(track, x, z)).toMatchObject({ x, z, index: 10 });
    expect(nearestTrack(track, x, z).distance).toBeCloseTo(0, 10);
  });

  it.each(Object.values(TRACKS))(
    "$name has an eight-car grid behind the start, inside the barriers",
    (track) => {
      const gate = track.checkpoints[0];
      for (let i = 0; i < 8; i++) {
        const car = createCar(`grid-${i}`, track, i, 300);
        expect(carSchema.safeParse(car).success).toBe(true);
        expect(car).toMatchObject({
          checkpoint: 1,
          lap: 1,
          lapStartTick: 300,
          finishTick: null,
          yaw: gate.yaw,
        });
        expect(
          (car.x - gate.x) * Math.sin(gate.yaw) +
            (car.z - gate.z) * Math.cos(gate.yaw),
        ).toBeLessThan(0);
        expect(nearestTrack(track, car.x, car.z).distance).toBeLessThan(
          track.width / 2 - 1.35,
        );
        expect(car.progress).toBeLessThan(0);
      }
    },
  );
});

describe("physics", () => {
  it("accelerates, coasts, brakes to rest, and reverses with inverted steering", () => {
    const track = TRACKS.harbor;
    let car = createCar("driver", track, 0, 0);
    for (let i = 0; i < 90; i++) car = stepCar(car, gas, track);
    expect(car.speed).toBeGreaterThan(20);
    const coast = stepCar(car, NEUTRAL, track);
    const brake = stepCar(car, { ...NEUTRAL, brake: true }, track);
    expect(coast.speed).toBeLessThan(car.speed);
    expect(brake.speed).toBeLessThan(coast.speed);
    for (let i = 0; i < 120; i++)
      car = stepCar(car, { ...NEUTRAL, brake: true }, track);
    expect(Math.abs(car.speed)).toBeLessThan(0.01);
    for (let i = 0; i < 50; i++)
      car = stepCar(car, { ...NEUTRAL, throttle: -1 }, track);
    expect(car.speed).toBeLessThan(-5);
    expect(car.speed).toBeGreaterThanOrEqual(-14);
    const turned = stepCar(car, { ...NEUTRAL, throttle: -1, steer: 1 }, track);
    expect(Math.sin(turned.yaw - car.yaw)).toBeLessThan(0);
  });

  it("drifting preserves more lateral slip; wet harbor has less lateral grip", () => {
    const track = TRACKS.canyon;
    const car = createCar("driver", track, 0, 0);
    car.vx = Math.sin(car.yaw) * 25 + Math.cos(car.yaw) * 8;
    car.vz = Math.cos(car.yaw) * 25 - Math.sin(car.yaw) * 8;
    const grip = stepCar(car, NEUTRAL, track);
    const drift = stepCar(car, { ...NEUTRAL, drift: true }, track);
    const wet = stepCar(car, NEUTRAL, { ...track, id: "harbor" });
    const slip = (state: CarState) =>
      Math.abs(state.vx * Math.cos(state.yaw) - state.vz * Math.sin(state.yaw));
    expect(slip(drift)).toBeGreaterThan(slip(wet));
    expect(slip(wet)).toBeGreaterThan(slip(grip));
    expect(drift.drift).toBe(true);
    expect(Math.hypot(drift.vx, drift.vz)).toBeLessThan(
      Math.hypot(car.vx, car.vz),
    );
  });

  it("bounds malformed controls, extreme velocities and large dt without mutating state", () => {
    const track = TRACKS.canyon;
    const car = Object.freeze({ ...atGate(track, 1, -5), vx: 1e12, vz: -1e12 });
    const next = stepCar(
      car,
      { ...NEUTRAL, throttle: Infinity, steer: NaN },
      track,
      1000,
    );
    expect(carSchema.safeParse(next).success).toBe(true);
    expect(Math.hypot(next.x - car.x, next.z - car.z)).toBeLessThanOrEqual(
      7.00001,
    );
    expect(Math.hypot(next.vx, next.vz)).toBeLessThanOrEqual(70.00001);
    expect(stepCar(car, gas, track, -1)).toEqual(car);
    expect(stepCar(car, gas, track, NaN)).toEqual(car);
  });

  it("sweeps into barriers without tunneling, even at impossible incoming speed", () => {
    const track = TRACKS.harbor;
    const car = atGate(track, 1, -5, 0);
    const road = nearestTrack(track, car.x, car.z);
    car.x = road.x + Math.cos(road.yaw) * (track.width / 2 - 0.1);
    car.z = road.z - Math.sin(road.yaw) * (track.width / 2 - 0.1);
    car.yaw = road.yaw + Math.PI / 2;
    car.vx = Math.sin(car.yaw) * 1e6;
    car.vz = Math.cos(car.yaw) * 1e6;
    const next = stepCar(car, gas, track);
    expect(next.collision).toBe(1);
    expect(nearestTrack(track, next.x, next.z).distance).toBeLessThanOrEqual(
      track.width / 2 + 0.15 + 1e-6,
    );
    expect(Math.hypot(next.x - car.x, next.z - car.z)).toBeLessThanOrEqual(
      70 / 60,
    );
    expect(
      next.vx * Math.sin(car.yaw) + next.vz * Math.cos(car.yaw),
    ).toBeLessThan(0);
  });
});

describe("authoritative rules", () => {
  const track = TRACKS.canyon;

  it("freezes the countdown, consumes only controls, and agrees with prediction on open road", () => {
    const car = createCar("driver", track, 0, 300);
    expect(
      stepRace([car], { driver: { ...gas, reset: true } }, track, 299, 300, 1),
    ).toEqual([car]);
    const predicted = stepCar(car, gas, track);
    const [server] = stepRace([car], { driver: gas }, track, 300, 300, 1);
    expect(server.x).toBe(predicted.x);
    expect(server.z).toBe(predicted.z);
    expect(server.speed).toBe(predicted.speed);
    expect(server.progress).toBeGreaterThan(car.progress);
  });

  it("requires the next gate, a finite gate span, and forward passage", () => {
    const car = atGate(track, 1);
    expect(stepRace([car], {}, track, 100, 0, 1)[0].checkpoint).toBe(2);
    const skipped = { ...atGate(track, 2), checkpoint: 1 };
    expect(stepRace([skipped], {}, track, 100, 0, 1)[0].checkpoint).toBe(1);
    const backwards = atGate(track, 1, 0.3, -40);
    const reversed = stepRace([backwards], {}, track, 100, 0, 1)[0];
    expect(reversed.checkpoint).toBe(1);
    expect(reversed.progress).toBeLessThan(backwards.progress);
    const wide = atGate(track, 1);
    wide.x += Math.cos(wide.yaw) * (track.width / 2 + 5);
    wide.z -= Math.sin(wide.yaw) * (track.width / 2 + 5);
    expect(stepRace([wide], {}, track, 100, 0, 1)[0].checkpoint).toBe(1);
  });

  it("rejects displaced states and shortcuts instead of granting projected progress", () => {
    const original = createCar("test", track, 0, 0);
    const relocated = {
      ...original,
      x: track.checkpoints[5].x,
      z: track.checkpoints[5].z,
    };
    const rejected = stepRace([relocated], { test: gas }, track, 100, 0, 1)[0];
    expect(rejected.progress).toBe(original.progress);
    expect(rejected.checkpoint).toBe(1);
    expect(rejected.lap).toBe(1);
    expect(rejected.collision).toBe(1);
    const launched = { ...original, vx: 1e9, vz: 1e9 };
    const bounded = stepRace([launched], { test: gas }, track, 100, 0, 1)[0];
    expect(
      Math.hypot(bounded.x - launched.x, bounded.z - launched.z),
    ).toBeLessThanOrEqual(70 / 60 + 0.65);
    expect(
      Math.abs(bounded.progress - launched.progress) * track.length,
    ).toBeLessThan(4);
    expect(bounded.checkpoint).toBe(1);
  });

  it.each([17, 19])(
    "rejects a shortcut between nearby branches %im apart, even with a valid endpoint",
    (spacing) => {
      // A deliberately adversarial hairpin: either the swept gap is outside the
      // corridor, or the corridors overlap but their arc positions are far apart.
      const hairpin: Track = {
        ...TRACKS.harbor,
        length: 400 + 2 * spacing,
        points: [
          { x: 0, z: 0 },
          { x: 0, z: 100 },
          { x: 0, z: 200 },
          { x: spacing, z: 200 },
          { x: spacing, z: 100 },
          { x: spacing, z: 0 },
        ],
        checkpoints: [
          { x: 0, z: 0, yaw: 0 },
          { x: 0, z: 100, yaw: 0 },
          { x: spacing, z: 200, yaw: Math.PI },
          { x: spacing, z: 100, yaw: Math.PI },
        ],
      };
      const car = {
        ...createCar("test", hairpin, 0, 0),
        x: spacing / 2 - 0.5,
        z: 80,
        yaw: Math.PI / 2,
        vx: 65,
        vz: 0,
        speed: 65,
        progress: 80 / hairpin.length,
      };
      expect(nearestTrack(hairpin, car.x + 1, car.z).distance).toBeLessThan(
        hairpin.width / 2 + 0.15,
      );
      const next = stepRace([car], { test: gas }, hairpin, 100, 0, 1)[0];
      expect(next.x).toBe(car.x);
      expect(next.progress).toBe(car.progress);
      expect(next.checkpoint).toBe(1);
      expect(next.collision).toBe(1);
    },
  );

  it("cannot farm laps by crossing the start or reversing a circuit", () => {
    const start = {
      ...atGate(track, 0),
      progress: -0.3 / track.length,
      checkpoint: 1,
    };
    const crossed = stepRace([start], {}, track, 100, 0, 1)[0];
    expect(crossed.lap).toBe(1);
    expect(crossed.finishTick).toBeNull();
    const wrongWinding = {
      ...atGate(track, 0),
      progress: atGate(track, 0).progress - 1,
    };
    expect(stepRace([wrongWinding], {}, track, 100, 0, 1)[0].lap).toBe(1);
  });

  it("resets to the last accepted gate, preserves lap clocks/order, and enforces cooldown", () => {
    const car = { ...atGate(track, 5, -20), checkpoint: 5 };
    const first = stepRace([car], { test: reset }, track, 300, 0, 2)[0];
    expect(first).toMatchObject({
      checkpoint: 5,
      lap: 1,
      lapStartTick: 0,
      penaltyTicks: 180,
      resets: 1,
      lastResetTick: 300,
      speed: 0,
    });
    expect(first.progress).toBeLessThan(
      nearestTrack(track, track.checkpoints[4].x, track.checkpoints[4].z)
        .progress,
    );
    const cooldown = stepRace([first], { test: reset }, track, 479, 0, 2)[0];
    expect(cooldown.resets).toBe(1);
    expect(
      stepRace([cooldown], { test: reset }, track, 480, 0, 2)[0].penaltyTicks,
    ).toBe(360);
    const awaitingFinish = atGate(track, 0);
    const restored = stepRace(
      [awaitingFinish],
      { test: reset },
      track,
      300,
      0,
      1,
    )[0];
    expect(restored).toMatchObject({
      checkpoint: 0,
      lap: 1,
      finishTick: null,
      lapTimes: [],
    });
    expect(restored.progress).toBeLessThan(0.95);
  });

  it("books lap penalties once, finishes the requested lap count, and freezes finishers", () => {
    const car = { ...atGate(track, 0), penaltyTicks: 180 };
    const first = stepRace([car], {}, track, 1200, 0, 2)[0];
    expect(first).toMatchObject({
      lap: 2,
      checkpoint: 1,
      lapStartTick: 1200,
      lastLapTicks: 1380,
      bestLapTicks: 1380,
      lapTimes: [1380],
      finishTick: null,
    });
    const finish = {
      ...atGate(track, 0),
      ...first,
      x: car.x,
      z: car.z,
      vx: car.vx,
      vz: car.vz,
      yaw: car.yaw,
      checkpoint: 0,
      progress: car.progress + 1,
    };
    const done = stepRace([finish], {}, track, 2300, 0, 2)[0];
    expect(done).toMatchObject({
      lap: 3,
      finishTick: 2300,
      lapTimes: [1380, 1100],
      bestLapTicks: 1100,
      lastLapTicks: 1100,
      progress: 2,
      speed: 0,
    });
    expect(
      stepRace([done], { test: { ...gas, reset: true } }, track, 3000, 0, 2)[0],
    ).toEqual(done);
    expect(raceResults([done], [], 0)[0]).toMatchObject({
      timeTicks: 2480,
      penaltyTicks: 180,
      dnf: false,
    });
  });

  it("ranks penalized finish times, then validated progress, without mutating the input", () => {
    const car = createCar("base", track, 0, 0);
    const cars = [
      { ...car, id: "late", finishTick: 1100 },
      { ...car, id: "penalized", finishTick: 1000, penaltyTicks: 180 },
      { ...car, id: "behind", progress: 0.3 },
      { ...car, id: "ahead", progress: 0.8 },
    ];
    expect(rankCars(cars).map((car) => car.id)).toEqual([
      "late",
      "penalized",
      "ahead",
      "behind",
    ]);
    expect(cars[2].id).toBe("behind");
    expect(raceResults(cars, [], 100)[0].timeTicks).toBe(1000);
    expect(raceResults(cars, [], 100)[2]).toMatchObject({
      timeTicks: null,
      dnf: true,
      position: 3,
    });
  });

  it("resolves car collisions with bounded separation and stable ID-based ordering", () => {
    const a = { ...atGate(track, 1, -20, 10), id: "a" };
    const b = {
      ...a,
      id: "b",
      x: a.x + Math.cos(a.yaw),
      z: a.z - Math.sin(a.yaw),
    };
    b.progress = nearestTrack(track, b.x, b.z).progress;
    const result = stepRace([a, b], {}, track, 100, 0, 1);
    expect(result.every((car) => car.collision === 1)).toBe(true);
    expect(
      Math.hypot(result[0].x - result[1].x, result[0].z - result[1].z),
    ).toBeGreaterThan(1);
    expect(stepRace([b, a], {}, track, 100, 0, 1).reverse()).toEqual(result);
    for (let i = 0; i < 2; i++) {
      expect(
        Math.hypot(result[i].x - [a, b][i].x, result[i].z - [a, b][i].z),
      ).toBeLessThan(70 / 60 + 0.65);
      expect(result[i].checkpoint).toBe(1);
    }
  });

  it("detects swept glancing car collisions even when neither endpoint overlaps", () => {
    const a = { ...atGate(track, 1, -20, 64), id: "a" };
    const b = { ...atGate(track, 1, -18.95, -64), id: "b" };
    a.x -= Math.cos(a.yaw) * 1.3;
    a.z += Math.sin(a.yaw) * 1.3;
    b.x += Math.cos(b.yaw) * 1.3;
    b.z -= Math.sin(b.yaw) * 1.3;
    b.yaw += Math.PI;
    b.speed = 64;
    for (const car of [a, b])
      car.progress = nearestTrack(track, car.x, car.z).progress;
    const freeA = stepCar(a, NEUTRAL, track);
    const freeB = stepCar(b, NEUTRAL, track);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2.7);
    expect(Math.hypot(freeA.x - freeB.x, freeA.z - freeB.z)).toBeGreaterThan(
      2.7,
    );
    const result = stepRace([a, b], {}, track, 100, 0, 1);
    expect(result.every((car) => car.collision === 1)).toBe(true);
    expect(
      Math.hypot(result[0].x - result[1].x, result[0].z - result[1].z),
    ).toBeGreaterThanOrEqual(2.699);
    expect(result[0].speed).toBeLessThan(freeA.speed);
    expect(result[1].speed).toBeLessThan(freeB.speed);
    expect(stepRace([b, a], {}, track, 100, 0, 1).reverse()).toEqual(result);
  });
});

describe("bots and replay", () => {
  it.each(Object.values(TRACKS))(
    "$name bots complete a full eight-car race in under two minutes",
    (track) => {
      const cars = runBots(track, 8);
      expect(
        cars.map((car) => ({
          id: car.id,
          lap: car.lap,
          checkpoint: car.checkpoint,
          progress: car.progress,
          resets: car.resets,
        })),
      ).toEqual(
        cars.map((car) => ({
          id: car.id,
          lap: 2,
          checkpoint: 1,
          progress: 1,
          resets: car.resets,
        })),
      );
      for (const car of cars) {
        expect(car.finishTick).not.toBeNull();
        expect(car.finishTick).toBeLessThan(120 * TICK_RATE);
        expect(car.lapTimes).toHaveLength(1);
        expect(car.resets).toBe(0);
        expect(carSchema.safeParse(car).success).toBe(true);
      }
    },
    30_000,
  );

  it("replays complete multi-lap races identically, without mutation or wall-clock state", () => {
    const first = runBots(TRACKS.harbor, 2, 2, 180 * TICK_RATE);
    expect(
      first.every(
        (car) => car.finishTick !== null && car.lapTimes.length === 2,
      ),
    ).toBe(true);
    expect(runBots(TRACKS.harbor, 2, 2, 180 * TICK_RATE)).toEqual(first);
    const original = Object.freeze(createCar("frozen", TRACKS.canyon, 0, 0));
    const inputs = Object.freeze({ frozen: Object.freeze(gas) });
    expect(() =>
      stepRace([original], inputs, TRACKS.canyon, 0, 0, 1),
    ).not.toThrow();
    expect(original.progress).toBeLessThan(0);
  }, 30_000);

  it.each(Object.values(TRACKS))(
    "$name bots recover from facing backwards and still finish with the reset penalty",
    (track) => {
      let car = createCar("recovery", track, 0, 0);
      car.yaw += Math.PI;
      for (
        let tick = 0;
        tick < 120 * TICK_RATE && car.finishTick === null;
        tick++
      ) {
        car = stepRace(
          [car],
          { recovery: botControls(car, track, tick) },
          track,
          tick,
          0,
          1,
        )[0];
      }
      expect(car.finishTick).not.toBeNull();
      expect(car.resets).toBe(1);
      expect(car.penaltyTicks).toBe(180);
      expect(car.lapTimes).toEqual([car.finishTick! + car.penaltyTicks]);
      expect(raceResults([car], [], 0)[0].timeTicks).toBe(car.lapTimes[0]);
    },
    30_000,
  );
});
