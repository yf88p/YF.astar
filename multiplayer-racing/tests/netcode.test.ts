import { describe, expect, it } from "vitest";
import { interpolateCar, Prediction, SnapshotBuffer } from "../client/netcode";
import {
  NEUTRAL,
  TICK_RATE,
  type CarState,
  type Controls,
  type Snapshot,
} from "../shared/protocol";
import { createCar, stepCar, stepRace } from "../shared/simulation";
import { TRACKS } from "../shared/tracks";

const track = TRACKS.canyon;
const gas: Controls = { ...NEUTRAL, throttle: 1 };
const car = (overrides: Partial<CarState> = {}): CarState => ({
  ...createCar("driver", track, 0, 0),
  ...overrides,
});
const snapshot = (
  tick: number,
  overrides: Partial<Snapshot> = {},
): Snapshot => ({
  type: "snapshot",
  tick,
  serverTime: 1_800_000_000_000 + (tick * 1000) / TICK_RATE,
  code: "TEST",
  state: "racing",
  startTick: 0,
  cars: [
    car({
      x: (tick / TICK_RATE) * 10,
      z: 0,
      yaw: Math.PI / 2,
      vx: 10,
      vz: 0,
      speed: 10,
    }),
  ],
  ack: { driver: tick - 1 },
  results: [],
  ...overrides,
});

describe("Prediction", () => {
  it("starts empty and resets sequence, history, and rendering against the consumed ack", () => {
    const prediction = new Prediction();
    expect(prediction.car).toBeNull();
    expect(prediction.render(1)).toBeNull();
    expect(prediction.pending).toEqual([]);
    expect(prediction.nextSeq).toBe(0);
    prediction.predict(gas, track, 1000, true);
    expect(prediction.car).toBeNull();
    prediction.reset(car(), 200);
    expect(prediction.nextSeq).toBe(201);
    expect(prediction.pending).toEqual([]);
    expect(prediction.predict(gas, track, 1200, true).seq).toBe(201);
    prediction.reset(null);
    expect(prediction.render(0)).toBeNull();
    expect(prediction.pending).toEqual([]);
    expect(prediction.nextSeq).toBe(0);
  });

  it.each(Object.values(TRACKS))(
    "predicts exactly one 60Hz step on $id, regardless of timestamps",
    (circuit) => {
      const prediction = new Prediction();
      let expected = createCar("driver", circuit, 0, 0);
      prediction.reset(expected);
      const timestamps = [
        0,
        100,
        99,
        100_000,
        100_000,
        Number.MAX_SAFE_INTEGER,
      ];
      for (const [seq, clientTime] of timestamps.entries()) {
        const controls = { ...gas, steer: seq / 10 };
        expect(prediction.predict(controls, circuit, clientTime, true)).toEqual(
          { seq, clientTime, controls },
        );
        expected = stepCar(expected, controls, circuit, 1 / TICK_RATE);
        expect(prediction.car).toEqual(expected);
      }
    },
  );

  it("copies held controls and keeps only the latest 120 commands without reusing sequences", () => {
    const prediction = new Prediction();
    const controls = { ...gas };
    prediction.reset(car());
    prediction.predict(controls, track, 0, false);
    controls.throttle = -1;
    expect(prediction.pending[0].controls.throttle).toBe(1);
    for (let i = 1; i < 1000; i++) prediction.predict(gas, track, i, false);
    expect(prediction.pending).toHaveLength(120);
    expect(prediction.pending.map((command) => command.seq)).toEqual(
      Array.from({ length: 120 }, (_, i) => i + 880),
    );
    expect(prediction.nextSeq).toBe(1000);
    prediction.reconcile(car(), 900, track, true);
    let expected = car();
    for (let i = 901; i < 1000; i++) expected = stepCar(expected, gas, track);
    expect(prediction.car).toEqual(expected);
    expect(prediction.nextSeq).toBe(1000);
    expect(prediction.pending).toHaveLength(99);
  });

  it("rebases on the full authoritative state and replays only unacknowledged commands", () => {
    const prediction = new Prediction();
    prediction.reset(car());
    for (let i = 0; i < 12; i++)
      prediction.predict({ ...gas, steer: i / 20 }, track, i * 999, true);
    const authoritative = car({
      vx: -2,
      vz: 6,
      speed: 5,
      collision: 1,
      checkpoint: 4,
      lap: 2,
      lapStartTick: 500,
      bestLapTicks: 500,
      lastLapTicks: 500,
      lapTimes: [500],
      penaltyTicks: 180,
      progress: 1.3,
    });
    let expected = authoritative;
    for (const command of prediction.pending.slice(5))
      expected = stepCar(expected, command.controls, track);
    prediction.reconcile(authoritative, 4, track, true);
    expect(prediction.pending.map((command) => command.seq)).toEqual([
      5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(prediction.car).toEqual(expected);
    expect(prediction.render(0)).toMatchObject({
      vx: expected.vx,
      vz: expected.vz,
      collision: expected.collision,
      finishTick: null,
      checkpoint: 4,
      lap: 2,
      lapStartTick: 500,
      lapTimes: [500],
      penaltyTicks: 180,
      progress: 1.3,
    });
    prediction.reconcile(authoritative, 4, track, true);
    expect(prediction.car).toEqual(expected);
    expect(authoritative).toEqual(
      car({
        vx: -2,
        vz: 6,
        speed: 5,
        collision: 1,
        checkpoint: 4,
        lap: 2,
        lapStartTick: 500,
        bestLapTicks: 500,
        lastLapTicks: 500,
        lapTimes: [500],
        penaltyTicks: 180,
        progress: 1.3,
      }),
    );
  });

  it("ignores backwards acks but accepts equal acks with newer held-input or collision state", () => {
    const prediction = new Prediction();
    prediction.reset(car(), 10);
    prediction.predict(gas, track, 0, true);
    const authoritative = car({ collision: 1 });
    prediction.reconcile(authoritative, 11, track, true);
    const visible = prediction.render(0.03);
    prediction.reconcile(car({ x: 1000 }), 10, track, true);
    expect(prediction.car).toEqual(authoritative);
    expect(prediction.render(0)).toEqual(visible);
    expect(prediction.pending).toEqual([]);
    expect(prediction.nextSeq).toBe(12);
    const held = stepCar(authoritative, gas, track);
    prediction.reconcile(held, 11, track, true);
    expect(prediction.car).toEqual(held);
    prediction.reconcile(held, 100, track, true);
    expect(prediction.predict(gas, track, 0, true).seq).toBe(101);
  });

  it("consumes countdown commands without physics and accepts authoritative finishing/reset rules", () => {
    const prediction = new Prediction();
    const start = car({ lapStartTick: 180 });
    prediction.reset(start);
    for (let i = 0; i < 6; i++)
      prediction.predict({ ...gas, reset: true }, track, i, false);
    expect(prediction.car).toEqual(start);
    prediction.reconcile(start, 2, track, false);
    expect(prediction.car).toEqual(start);
    expect(prediction.pending.map((command) => command.seq)).toEqual([3, 4, 5]);
    const reset = stepRace(
      [start],
      { driver: { ...gas, reset: true } },
      track,
      300,
      180,
      1,
    )[0];
    prediction.reconcile(reset, 5, track, true);
    expect(prediction.car).toEqual(reset);
    expect(prediction.render(0)).toMatchObject({
      x: reset.x,
      z: reset.z,
      resets: 1,
      penaltyTicks: 180,
    });
    prediction.predict(gas, track, 7, true);
    const finished = {
      ...reset,
      finishTick: 400,
      speed: 0,
      vx: 0,
      vz: 0,
      drift: false,
      lap: 2,
      lapTimes: [400],
    };
    prediction.reconcile(finished, 5, track, true);
    expect(prediction.car).toEqual(finished);
    expect(prediction.render(0)).toMatchObject(finished);
    prediction.predict(gas, track, 8, true);
    expect(prediction.car).toEqual(finished);
  });

  it("smooths only small pose errors over 120ms without affecting the physics state", () => {
    const prediction = new Prediction();
    const before = car({ yaw: Math.PI - 0.1 });
    prediction.reset(before);
    const authoritative = {
      ...before,
      x: before.x + 4,
      yaw: -Math.PI + 0.1,
      vx: 7,
      collision: 1,
    };
    prediction.reconcile(authoritative, -1, track, true);
    expect(prediction.car).toEqual(authoritative);
    expect(prediction.render(0)).toMatchObject({
      x: before.x,
      vx: 7,
      collision: 1,
    });
    const middle = prediction.render(0.06)!;
    expect(middle.x).toBeCloseTo(before.x + 2);
    expect(Math.abs(middle.yaw)).toBeCloseTo(Math.PI);
    expect(prediction.render(0.06)).toMatchObject(authoritative);
    expect(prediction.car).toEqual(authoritative);
    expect(prediction.render(-1)).toEqual(prediction.render(NaN));
  });

  it("preserves visual continuity through repeated corrections and frame-rate-independent decay", () => {
    const a = new Prediction();
    const b = new Prediction();
    a.reset(car());
    b.reset(car());
    const authoritative = car({ x: car().x + 6 });
    a.reconcile(authoritative, -1, track, true);
    b.reconcile(authoritative, -1, track, true);
    for (let i = 0; i < 6; i++) a.render(0.01);
    expect(a.render(0)!.x).toBeCloseTo(b.render(0.06)!.x, 10);
    const visible = a.render(0)!;
    a.reconcile({ ...authoritative, x: authoritative.x - 1 }, -1, track, true);
    expect(a.render(0)!.x).toBeCloseTo(visible.x);
    a.predict(gas, track, 0, true);
    expect(a.render(0.12)).toMatchObject(a.car!);
  });

  it.each(["distance", "reset", "resetTick", "identity", "inactive"] as const)(
    "hard-snaps %s corrections",
    (kind) => {
      const prediction = new Prediction();
      const initial = car();
      prediction.reset(initial);
      const authoritative = { ...initial, x: initial.x + 2 };
      if (kind === "distance") authoritative.x = initial.x + 8;
      if (kind === "reset") authoritative.resets++;
      if (kind === "resetTick") authoritative.lastResetTick++;
      if (kind === "identity") authoritative.id = "replacement";
      prediction.reconcile(authoritative, -1, track, kind !== "inactive");
      expect(prediction.render(0)).toMatchObject(authoritative);
      prediction.reconcile(
        { ...authoritative, x: authoritative.x + 1 },
        -1,
        track,
        true,
      );
      prediction.reset(initial, 50);
      expect(prediction.render(0)).toMatchObject(initial);
      expect(prediction.nextSeq).toBe(51);
    },
  );

  it("does not let mutable input or render data change stored race metadata", () => {
    const original = car({ lapTimes: [123] });
    const prediction = new Prediction();
    prediction.reset(original);
    original.lapTimes.push(456);
    prediction.render(0)!.lapTimes.push(789);
    expect(prediction.car!.lapTimes).toEqual([123]);
  });

  it("converges under 20Hz acknowledgements with jitter, loss, duplicates, and reordered delivery", () => {
    const prediction = new Prediction();
    let authoritative = car();
    prediction.reset(authoritative);
    const deliveries: {
      tick: number;
      due: number;
      car: CarState;
      ack: number;
    }[] = [];
    const jitter = [1, 9, 3, 0, 5, 2];
    let acceptedAck = -1;
    for (let tick = 1; tick <= 240; tick++) {
      const controls = { ...gas, steer: Math.sin(tick / 60) * 0.1 };
      const command = prediction.predict(
        controls,
        track,
        (tick * 1000) / TICK_RATE,
        true,
      );
      authoritative = stepCar(authoritative, controls, track);
      if (tick % 3 === 0 && tick % 21 !== 0) {
        const delivery = {
          tick,
          due: tick + jitter[(tick / 3) % jitter.length],
          car: authoritative,
          ack: command.seq,
        };
        deliveries.push(delivery);
        if (tick % 15 === 0)
          deliveries.push({ ...delivery, due: delivery.due + 7 });
      }
      for (const delivery of deliveries.filter((item) => item.due === tick)) {
        const before = prediction.car;
        prediction.reconcile(delivery.car, delivery.ack, track, true);
        if (delivery.ack < acceptedAck) expect(prediction.car).toBe(before);
        else acceptedAck = delivery.ack;
      }
      expect(prediction.car).toEqual(authoritative);
      expect(prediction.pending.length).toBeLessThanOrEqual(120);
    }
    prediction.reconcile(authoritative, 239, track, true);
    expect(prediction.car).toEqual(authoritative);
    expect(prediction.pending).toEqual([]);
    expect(prediction.nextSeq).toBe(240);
  });
});

describe("interpolateCar", () => {
  it("takes the shortest heading path and preserves newer authoritative physics and race fields", () => {
    const a = car({ x: 0, z: 10, yaw: Math.PI - 0.1 });
    const b = car({
      x: 4,
      z: 20,
      yaw: -Math.PI + 0.1,
      vx: 7,
      collision: 1,
      lap: 2,
      finishTick: 123,
      lapTimes: [123],
    });
    const middle = interpolateCar(a, b, 0.5);
    expect(middle).toMatchObject({ ...b, x: 2, z: 15, yaw: middle.yaw });
    expect(Math.abs(middle.yaw)).toBeCloseTo(Math.PI);
    expect(interpolateCar(b, a, 0.5).yaw).toBeCloseTo(-Math.PI);
    expect(interpolateCar(a, b, -1)).toMatchObject({ x: a.x, z: a.z });
    expect(interpolateCar(a, b, 2)).toMatchObject({ x: b.x, z: b.z });
    expect(interpolateCar(a, b, NaN).x).toBe(a.x);
    middle.lapTimes.push(456);
    expect(b.lapTimes).toEqual([123]);
  });
});

describe("SnapshotBuffer", () => {
  it("is empty before data and rejects duplicate, backwards, or invalid ticks without changing latest", () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.latest).toBeNull();
    expect(buffer.sample(0)).toEqual([]);
    const first = snapshot(6);
    expect(buffer.push(first, 100)).toBe(true);
    for (const tick of [
      6,
      3,
      -1,
      6.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        buffer.push(snapshot(tick, { cars: [car({ x: -1000 })] }), 150),
      ).toBe(false);
      expect(buffer.latest).toEqual(first);
    }
    expect(buffer.push(snapshot(9), NaN)).toBe(false);
    expect(buffer.push(snapshot(9), 99)).toBe(false);
    expect(buffer.push(snapshot(9), 100)).toBe(true);
  });

  it.each([0, 9_000_000_000, -9_000_000_000])(
    "interpolates 20Hz snapshots on 60Hz tick time with local clock offset %i",
    (offset) => {
      const buffer = new SnapshotBuffer();
      for (let tick = 0; tick <= 12; tick += 3) {
        expect(
          buffer.push(
            snapshot(tick, { serverTime: tick % 2 ? -1e12 : 1e12 }),
            offset + (tick * 1000) / TICK_RATE,
          ),
        ).toBe(true);
      }
      expect(buffer.sample(offset + 200)[0].x).toBeCloseTo(1);
      expect(buffer.sample(offset + 225)[0].x).toBeCloseTo(1.25);
      expect(buffer.sample(offset + 250)[0].x).toBeCloseTo(1.5);
      expect(buffer.sample(offset + 300)[0].x).toBeCloseTo(2);
    },
  );

  it("interpolates using actual tick gaps, including off-cadence event snapshots and packet loss", () => {
    const buffer = new SnapshotBuffer();
    for (const tick of [0, 1, 9, 12])
      buffer.push(snapshot(tick), (tick * 1000) / TICK_RATE);
    expect(buffer.sample(200)[0].x).toBeCloseTo(1);
    expect(buffer.sample(200 + 1000 / TICK_RATE)[0].x).toBeCloseTo(7 / 6);
    expect(buffer.sample(250)[0].x).toBeCloseTo(1.5);
  });

  it("extrapolates velocities for at most 100ms and then freezes through a long outage", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(0), 0);
    expect(buffer.sample(0)[0].x).toBe(0);
    expect(buffer.sample(100)[0].x).toBe(0);
    expect(buffer.sample(150)[0].x).toBeCloseTo(0.5);
    const frozen = buffer.sample(200);
    expect(frozen[0].x).toBe(1);
    expect(buffer.sample(60_000)).toEqual(frozen);
    expect(buffer.sample(1e12)).toEqual(frozen);
    expect(buffer.sample(-1000)).toEqual(frozen);
    expect(buffer.latest!.cars[0].x).toBe(0);
  });

  it.each(["lobby", "countdown", "finished", "cancelled"] as const)(
    "never extrapolates %s physics",
    (state) => {
      const buffer = new SnapshotBuffer();
      buffer.push(snapshot(0, { state }), 0);
      expect(buffer.sample(10_000)).toEqual(buffer.latest!.cars);
    },
  );

  it("freezes finished cars and countdown poses until the shared absolute start tick", () => {
    const buffer = new SnapshotBuffer();
    const finished = car({ vx: 50, vz: 20, finishTick: 10 });
    buffer.push(snapshot(12, { cars: [finished] }), 0);
    expect(buffer.sample(500)).toEqual([finished]);
    buffer.clear();
    const grid = car();
    buffer.push(
      snapshot(177, { state: "countdown", startTick: 180, cars: [grid] }),
      2950,
    );
    const moved = stepCar(grid, gas, track);
    buffer.push(snapshot(180, { startTick: 180, cars: [moved] }), 3000);
    expect(buffer.sample(3075)).toEqual([grid]);
    expect(buffer.sample(3100)[0].x).toBeCloseTo(moved.x);
  });

  it("matches by car ID, supports full eight-car snapshots, and applies membership at tick boundaries", () => {
    const buffer = new SnapshotBuffer();
    const before = Array.from({ length: 8 }, (_, i) =>
      car({ id: `driver-${i}`, x: i * 10, z: 0, vx: 0, vz: 0 }),
    );
    const after = before
      .slice(1)
      .reverse()
      .map((value) => ({ ...value, x: value.x + 4 }));
    after.push(car({ id: "new", x: 100 }));
    expect(buffer.push(snapshot(0, { cars: before }), 0)).toBe(true);
    expect(buffer.push(snapshot(3, { cars: after }), 50)).toBe(true);
    const middle = buffer.sample(125);
    expect(middle.map((value) => value.id)).toEqual(
      before.map((value) => value.id),
    );
    expect(middle[0].x).toBe(0);
    expect(middle[1].x).toBe(12);
    expect(buffer.sample(150)).toEqual(after);
    expect(buffer.push(snapshot(6, { cars: [...after, car()] }), 100)).toBe(
      false,
    );
    expect(buffer.push(snapshot(6, { cars: [] }), 100)).toBe(true);
    expect(buffer.sample(200)).toEqual([]);
  });

  it.each(["reset", "teleport"] as const)(
    "holds the old pose and hard-snaps at a remote %s tick",
    (kind) => {
      const buffer = new SnapshotBuffer();
      const a = car({ x: 0, z: 0, vx: 0, vz: 0 });
      const b = {
        ...a,
        x: kind === "reset" ? 2 : 500,
        resets: kind === "reset" ? 1 : 0,
      };
      buffer.push(snapshot(0, { cars: [a] }), 0);
      buffer.push(snapshot(3, { cars: [b] }), 50);
      expect(buffer.sample(125)).toEqual([a]);
      expect(buffer.sample(150)).toEqual([b]);
      expect(buffer.sample(125)).toEqual([b]);
    },
  );

  it("does not mistake valid fast motion across a lost packet interval for a teleport", () => {
    const buffer = new SnapshotBuffer();
    const a = car({ x: 0, z: 0, vx: 70, vz: 0 });
    buffer.push(snapshot(0, { cars: [a] }), 0);
    buffer.push(snapshot(12, { cars: [{ ...a, x: 14 }] }), 200);
    expect(buffer.sample(200)[0].x).toBeCloseTo(7);
  });

  it("re-anchors after a server stall without rolling back already extrapolated time", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(0), 0);
    expect(buffer.sample(5000)[0].x).toBe(1);
    buffer.push(snapshot(3), 5000);
    expect(buffer.sample(5000)[0].x).toBeCloseTo(1);
    for (let tick = 6; tick <= 60; tick += 3) {
      const now = 5000 + ((tick - 3) * 1000) / TICK_RATE;
      buffer.push(snapshot(tick), now);
      const value = buffer.sample(now)[0].x;
      expect(value).toBeCloseTo(Math.max(1, (tick / TICK_RATE - 0.1) * 10));
    }
  });

  it("recovers from a network outage and queued deliveries without accepting stale snapshots", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(0), 0);
    buffer.sample(5000);
    for (let tick = 3; tick <= 300; tick += 3)
      buffer.push(snapshot(tick), 5000);
    expect(buffer.sample(5000)[0].x).toBeCloseTo(49);
    expect(buffer.push(snapshot(297), 5001)).toBe(false);
    expect(buffer.sample(5010)[0].x).toBeCloseTo(49.1);
    expect(buffer.latest!.tick).toBe(300);
  });

  it("adapts to sustained receipt-clock drift and a higher latency floor without stale rollbacks", () => {
    const buffer = new SnapshotBuffer();
    let previous = -Infinity;
    let finalLag = 0;
    for (let tick = 0; tick <= 600; tick += 3) {
      const now = ((tick * 1000) / TICK_RATE) * 1.01 + (tick >= 120 ? 40 : 0);
      buffer.push(snapshot(tick), now);
      const x = buffer.sample(now)[0].x;
      expect(x).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = x;
      finalLag = (tick / TICK_RATE) * 10 - x;
    }
    expect(finalLag).toBeGreaterThan(0.85);
    expect(finalLag).toBeLessThan(1.1);
  });

  it("survives deterministic jitter, loss, duplication, reordering, and long stalls at render cadence", () => {
    const buffer = new SnapshotBuffer();
    const events: { tick: number; at: number }[] = [];
    const delays = [25, 90, 35, 20, 65, 30, 40];
    for (let tick = 0; tick <= 360; tick += 3) {
      if (tick % 27 === 24 || (tick > 120 && tick < 210)) continue;
      const at = (tick * 1000) / TICK_RATE + delays[(tick / 3) % delays.length];
      events.push({ tick, at });
      if (tick % 15 === 0) events.push({ tick, at: at + 130 });
    }
    events.sort((a, b) => a.at - b.at);
    let index = 0;
    let latestTick = -1;
    let previousX = -Infinity;
    let rejected = 0;
    for (let frame = 0; frame < 500; frame++) {
      const now = (frame * 1000) / 60;
      while (index < events.length && events[index].at <= now) {
        const event = events[index++];
        const accepted = buffer.push(
          snapshot(event.tick, { serverTime: event.tick % 2 ? -1e12 : 1e12 }),
          event.at,
        );
        expect(accepted).toBe(event.tick > latestTick);
        if (accepted) latestTick = event.tick;
        else rejected++;
      }
      const sampled = buffer.sample(now);
      if (!sampled.length) continue;
      expect(sampled[0].x).toBeGreaterThanOrEqual(previousX - 1e-8);
      expect(sampled[0].x).toBeLessThanOrEqual(
        (latestTick / TICK_RATE) * 10 + 1 + 1e-8,
      );
      previousX = sampled[0].x;
    }
    expect(rejected).toBeGreaterThan(20);
    expect(buffer.latest!.tick).toBe(360);
    expect(previousX).toBeCloseTo(61);
  });

  it("owns stored/rendered car arrays and clear drops old ticks, clock estimates, and race identities", () => {
    const buffer = new SnapshotBuffer();
    const old = snapshot(600, { cars: [car({ lapTimes: [123] })] });
    buffer.push(old, 1e9);
    old.cars[0].x = 1e9;
    old.cars[0].lapTimes.push(456);
    buffer.sample(1e9)[0].lapTimes.push(789);
    expect(buffer.latest!.cars[0].x).not.toBe(1e9);
    expect(buffer.latest!.cars[0].lapTimes).toEqual([123]);
    buffer.sample(1e12);
    buffer.clear();
    expect(buffer.latest).toBeNull();
    expect(buffer.sample(0)).toEqual([]);
    const fresh = snapshot(0, {
      code: "NEW",
      startTick: 180,
      state: "countdown",
      cars: [car({ id: "new" })],
    });
    expect(buffer.push(fresh, 0)).toBe(true);
    expect(buffer.sample(0)).toEqual(fresh.cars);
    expect(buffer.latest).toEqual(fresh);
  });
});
