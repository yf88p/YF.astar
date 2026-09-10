import test from "node:test";
import assert from "node:assert/strict";
import { Euler, Vector3 } from "three";
import { AIRCRAFT, FlightPhysics } from "../src/physics.js";

const DT = 1 / 120;
const DEG = Math.PI / 180;

function fly(plane, seconds, controls = {}, weather = {}) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    plane.update(
      DT,
      typeof controls === "function" ? controls(plane, i * DT) : controls,
      weather,
    );
  }
  return plane.telemetry;
}

function finite(plane) {
  for (const value of [
    ...plane.position,
    ...plane.velocity,
    ...plane.angularVelocity,
    ...plane.quaternion,
  ])
    assert.ok(Number.isFinite(value));
  assert.ok(Math.abs(plane.quaternion.length() - 1) < 1e-10);
  for (const [key, value] of Object.entries(plane.telemetry)) {
    if (typeof value === "number")
      assert.ok(Number.isFinite(value), `${key} is finite`);
  }
}

test("aircraft presets expose SI configuration and independent state", () => {
  assert.deepEqual(Object.keys(AIRCRAFT), ["trainer", "tourer", "sport"]);
  for (const a of Object.values(AIRCRAFT)) {
    assert.ok(a.mass > 500 && a.wingArea > 8 && a.maxPower > 100000);
    assert.ok(a.label && a.name && a.pitchDamping > 0);
  }
  const position = new Vector3(4, 300, 2000);
  const first = new FlightPhysics({ position });
  const second = new FlightPhysics();
  first.position.x = 100;
  assert.equal(position.x, 4);
  assert.equal(second.position.x, 0);
});

test("reset initializes settled engine, flaps, descent velocity and lift-balanced attitude immediately", () => {
  const speed = 36.7;
  const verticalSpeed = -speed * Math.sin(3 * DEG);
  const plane = new FlightPhysics({
    position: new Vector3(0, 170, 3300),
    heading: Math.PI / 2,
    speed,
    verticalSpeed,
    throttle: 0.506,
    flaps: 2 / 3,
  });
  const t = plane.telemetry;
  assert.equal(plane.throttle, 0.506);
  assert.equal(plane.flaps, 2 / 3);
  assert.equal(t.flaps, 2 / 3);
  assert.equal(t.engineRPM, plane.aircraft.maxEngineRPM * Math.sqrt(0.506));
  assert.equal(t.verticalSpeed, verticalSpeed);
  assert.equal(plane.velocity.y, verticalSpeed);
  assert.ok(Math.abs(t.airspeed - speed) < 1e-10);
  assert.ok(Math.abs(t.groundspeed - speed * Math.cos(3 * DEG)) < 1e-10);
  assert.ok(Math.abs(plane.velocity.x - t.groundspeed) < 1e-10);
  assert.ok(Math.abs(plane.velocity.z) < 1e-10);
  assert.equal(t.heading, 90);
  const a = plane.aircraft;
  const alpha =
    ((a.mass * 9.80665 * Math.cos(3 * DEG)) / (t.dynamicPressure * a.wingArea) -
      a.zeroLift -
      a.flapLift * plane.flaps) /
    a.liftSlope /
    DEG;
  assert.ok(Math.abs(t.aoa - alpha) < 1e-10);
  assert.ok(Math.abs(t.pitch - (alpha - 3)) < 1e-10);
  const rpm = t.engineRPM;
  plane.update(DT);
  assert.equal(t.flaps, 2 / 3);
  assert.equal(t.engineRPM, rpm);
  finite(plane);

  plane.reset({
    onGround: true,
    speed: 0,
    throttle: 0,
    verticalSpeed: -10,
    position: new Vector3(0, 18, 500),
  });
  assert.equal(plane.telemetry.engineRPM, 0);
  assert.equal(plane.telemetry.flaps, 0);
  assert.equal(plane.velocity.y, 0);
  const position = plane.position.clone();
  fly(plane, 5);
  assert.deepEqual(plane.position, position);
  assert.equal(plane.telemetry.thrust, 0);
  plane.reset();
  assert.equal(plane.throttle, 0.65);
  assert.equal(plane.flaps, 0);
  assert.equal(plane.velocity.y, 0);
  plane.reset({ speed: 20, verticalSpeed: -100, throttle: 5, flaps: -1 });
  assert.equal(plane.throttle, 1);
  assert.equal(plane.flaps, 0);
  assert.equal(plane.velocity.y, -20);
  finite(plane);
  plane.reset({ throttle: NaN, flaps: Infinity, verticalSpeed: NaN });
  assert.equal(plane.throttle, 0.65);
  assert.equal(plane.flaps, 0);
  assert.equal(plane.velocity.y, 0);
  finite(plane);
});

test("configured approach presets begin close to a three-degree descent without control assists", () => {
  for (const [aircraft, speed, throttle] of [
    ["trainer", 36.7, 0.506],
    ["tourer", 43.4, 0.47],
    ["sport", 43.8, 0.443],
  ]) {
    const plane = new FlightPhysics({
      aircraft,
      speed,
      throttle,
      flaps: 2 / 3,
      verticalSpeed: -speed * Math.sin(3 * DEG),
      position: new Vector3(0, 170, 3300),
    });
    for (let i = 0; i < 30 / DT; i++) {
      plane.update(DT);
      const path =
        Math.atan2(plane.velocity.y, plane.telemetry.groundspeed) / DEG;
      assert.ok(Math.abs(path + 3) < 0.4, `${aircraft}: flight path ${path}`);
      assert.ok(
        Math.abs(plane.telemetry.airspeed - speed) < 0.6,
        `${aircraft}: airspeed ${plane.telemetry.airspeed}`,
      );
      assert.equal(plane.crashed, false);
      assert.equal(plane.telemetry.stallWarning, false);
    }
    finite(plane);
  }
});

test("trainer holds a stable hands-off cruise for 60 seconds", () => {
  const plane = new FlightPhysics();
  for (let i = 0; i < 60 / DT; i++) {
    plane.update(DT);
    finite(plane);
    assert.equal(plane.crashed, false);
  }
  const t = plane.telemetry;
  assert.ok(t.altitude > 150 && t.altitude < 550, `altitude ${t.altitude}`);
  assert.ok(t.airspeed > 35 && t.airspeed < 65, `airspeed ${t.airspeed}`);
  assert.ok(Math.abs(t.verticalSpeed) < 5, `vertical speed ${t.verticalSpeed}`);
  assert.ok(Math.abs(t.roll) < 0.01);
  assert.ok(Math.abs(t.pitch) < 15);
});

test("every preset remains finite in 60 seconds of gusty flight", () => {
  const weather = { wind: new Vector3(4, 0, -2), turbulence: 0.5 };
  for (const [aircraft, a] of Object.entries(AIRCRAFT)) {
    const plane = new FlightPhysics({
      aircraft,
      speed: a.trimSpeed,
      position: new Vector3(0, 1000, 2000),
    });
    for (let i = 0; i < 60 / DT; i++) {
      plane.update(DT, {}, weather);
      if (i % 120 === 0) finite(plane);
    }
    assert.equal(plane.crashed, false, aircraft);
    assert.ok(
      plane.telemetry.airspeed > 20 && plane.telemetry.airspeed < 110,
      aircraft,
    );
  }
});

test("an unpowered slow airplane falls; zero-density flight is ballistic", () => {
  const plane = new FlightPhysics({
    speed: 0,
    position: new Vector3(0, 1000, 2000),
  });
  plane.throttle = 0;
  fly(plane, 3, { throttle: 0 });
  assert.ok(plane.velocity.y < -12, `${plane.velocity.y}`);
  assert.ok(plane.position.y < 980);
  const vacuum = new FlightPhysics({ speed: 0 });
  fly(vacuum, 1, { throttle: 0 }, { density: 0 });
  assert.ok(Math.abs(vacuum.velocity.y + 9.80665) < 1e-9);
  assert.ok(vacuum.velocity.x === 0 && vacuum.velocity.z === 0);
  assert.equal(vacuum.telemetry.gForce, 0);
});

test("power spools smoothly, accelerates on wheels, and brakes dissipate energy", () => {
  const plane = new FlightPhysics({
    onGround: true,
    speed: 0,
    position: new Vector3(0, 18, 700),
  });
  const initialRPM = plane.telemetry.engineRPM;
  plane.update(DT, { throttle: 1 });
  assert.ok(
    plane.telemetry.engineRPM > initialRPM && plane.telemetry.engineRPM < 2700,
  );
  fly(plane, 8, { throttle: 1 });
  assert.ok(plane.telemetry.groundspeed > 15, `${plane.telemetry.groundspeed}`);
  assert.equal(plane.crashed, false);
  assert.equal(plane.onGround, true);
  const coasting = new FlightPhysics({
    onGround: true,
    speed: 15,
    position: new Vector3(0, 18, 500),
  });
  const braking = new FlightPhysics({
    onGround: true,
    speed: 15,
    position: new Vector3(0, 18, 500),
  });
  fly(coasting, 5, { throttle: 0 });
  fly(braking, 5, { throttle: 0, brakes: true });
  assert.ok(braking.telemetry.groundspeed < coasting.telemetry.groundspeed - 5);
  assert.ok(braking.telemetry.groundspeed < 1);
  assert.equal(braking.crashed, false);
  const held = new FlightPhysics({
    onGround: true,
    speed: 0,
    position: new Vector3(0, 18, 500),
  });
  fly(held, 5, { throttle: 1, brakes: true });
  assert.ok(held.telemetry.groundspeed < 1e-8);
  assert.ok(Math.abs(held.position.z - 500) < 1e-8);
});

test("full power and a progressive rotation achieve a runway takeoff", () => {
  const plane = new FlightPhysics({
    onGround: true,
    speed: 0,
    position: new Vector3(0, 18, 700),
  });
  let lifted = false;
  fly(plane, 28, (p) => {
    if (p.telemetry.agl > 3) lifted = true;
    return {
      throttle: 1,
      pitch: p.onGround && p.telemetry.airspeed > 22 ? 0.7 : 0.08,
      flaps: 0.25,
    };
  });
  assert.equal(plane.crashed, false, plane.crashReason);
  assert.ok(lifted, `never lifted: ${JSON.stringify(plane.telemetry)}`);
  assert.equal(plane.onGround, false);
  assert.ok(plane.telemetry.agl > 20, `agl ${plane.telemetry.agl}`);
});

test("a gentle aligned runway touchdown is supported without bouncing or crashing", () => {
  const plane = new FlightPhysics({
    position: new Vector3(0, 20, 100),
    speed: 28,
  });
  plane.quaternion.setFromEuler(new Euler(3 * DEG, 0, 0, "YXZ"));
  plane.velocity.y = -1;
  fly(plane, 1, { throttle: 0, brakes: true });
  assert.equal(plane.crashed, false, plane.crashReason);
  assert.equal(plane.onGround, true);
  assert.ok(Math.abs(plane.position.y - 19.65) < 0.03);
  assert.ok(Math.abs(plane.velocity.y) < 0.1);
});

test("hard, sideways and rough-terrain impacts crash and freeze the state", () => {
  const cases = [
    {
      position: new Vector3(0, 20, 100),
      velocity: new Vector3(0, -9, -30),
      reason: /Hard landing/,
    },
    {
      position: new Vector3(0, 19.7, 100),
      velocity: new Vector3(12, -1, -25),
      reason: /Sideways/,
    },
    {
      position: new Vector3(100, 19.7, 100),
      velocity: new Vector3(0, -1, -32),
      reason: /rough terrain/,
    },
  ];
  for (const scenario of cases) {
    const plane = new FlightPhysics({ position: scenario.position, speed: 30 });
    plane.quaternion.identity();
    plane.velocity.copy(scenario.velocity);
    fly(plane, 1, { throttle: 0 });
    assert.equal(plane.crashed, true);
    assert.match(plane.crashReason, scenario.reason);
    const position = plane.position.clone();
    const quaternion = plane.quaternion.clone();
    fly(plane, 2, { throttle: 1, pitch: 1 });
    assert.deepEqual(plane.position, position);
    assert.deepEqual(plane.quaternion, quaternion);
    assert.equal(plane.velocity.length(), 0);
  }
});

test("compass heading and pilot pitch, roll, yaw signs match the public convention", () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const plane = new FlightPhysics({ heading });
    assert.ok(
      Math.abs(plane.telemetry.heading - ((heading / DEG + 360) % 360)) < 1e-8,
    );
    assert.ok(Math.abs(plane.velocity.x - Math.sin(heading) * 48) < 1e-8);
    assert.ok(Math.abs(plane.velocity.z + Math.cos(heading) * 48) < 1e-8);
  }
  for (const sign of [-1, 1]) {
    const pitch = new FlightPhysics();
    fly(pitch, 0.3, { pitch: sign });
    assert.ok(pitch.angularVelocity.x * sign > 0.05);
    const roll = new FlightPhysics();
    fly(roll, 0.5, { roll: sign });
    assert.ok(roll.angularVelocity.z * sign < -0.1);
    assert.ok(roll.telemetry.roll * sign > 3);
    const yaw = new FlightPhysics();
    fly(yaw, 0.3, { yaw: sign });
    assert.ok(yaw.angularVelocity.y * sign < -0.01);
  }
});

test("a right bank turns the trajectory and nose right through aerodynamic forces", () => {
  const plane = new FlightPhysics({ position: new Vector3(0, 600, 2000) });
  fly(plane, 12, (p) => ({
    roll: Math.max(-0.4, Math.min(0.4, (25 - p.telemetry.roll) * 0.04)),
    pitch: 0.025,
  }));
  assert.equal(plane.crashed, false);
  assert.ok(plane.telemetry.roll > 15 && plane.telemetry.roll < 35);
  assert.ok(
    plane.telemetry.heading > 15 && plane.telemetry.heading < 120,
    `heading ${plane.telemetry.heading}`,
  );
  assert.ok(plane.velocity.x > 10, `rightward velocity ${plane.velocity.x}`);
  assert.ok(plane.position.x > 50);
});

test("signed AoA has a soft stall, lift loss, added drag, and flap effects", () => {
  function sample(alpha, flap = 0) {
    const plane = new FlightPhysics({
      position: new Vector3(0, 1000, 2000),
      speed: 45,
    });
    if (flap) fly(plane, 5, { flaps: flap });
    plane.position.set(0, 1000, 2000);
    plane.velocity.set(0, 0, -45);
    plane.angularVelocity.set(0, 0, 0);
    plane.quaternion.setFromEuler(new Euler(alpha * DEG, 0, 0, "YXZ"));
    plane.update(DT, { flaps: flap });
    return plane.telemetry;
  }
  const low = sample(4),
    peak = sample(14),
    stalled = sample(27),
    negative = sample(-10);
  assert.ok(peak.liftCoefficient > low.liftCoefficient * 2);
  assert.ok(stalled.liftCoefficient < peak.liftCoefficient * 0.8);
  assert.ok(stalled.drag > peak.drag * 1.5);
  assert.equal(stalled.stallWarning, true);
  assert.equal(low.stallWarning, false);
  assert.ok(negative.aoa < 0 && negative.liftCoefficient < 0);
  assert.ok(
    Math.abs(sample(15.01).liftCoefficient - sample(14.99).liftCoefficient) <
      0.01,
  );
  const flapped = sample(4, 1);
  assert.ok(flapped.liftCoefficient > low.liftCoefficient + 0.5);
  assert.ok(flapped.drag > low.drag * 1.5);
});

test("a sustained pull stalls and unloading the wing recovers attached flow", () => {
  const plane = new FlightPhysics({ position: new Vector3(0, 1500, 2000) });
  fly(plane, 10, { pitch: 0.9, throttle: 0.2 });
  assert.equal(plane.telemetry.stallWarning, true);
  assert.ok(plane.telemetry.airspeed < 35);
  assert.ok(plane.telemetry.verticalSpeed < -8);
  fly(plane, 2, { pitch: -0.25, throttle: 1 });
  fly(plane, 5, { pitch: 0, throttle: 1 });
  assert.equal(plane.telemetry.stallWarning, false);
  assert.ok(Math.abs(plane.telemetry.aoa) < 10);
  assert.ok(plane.telemetry.airspeed > 35);
  assert.equal(plane.crashed, false);
  finite(plane);
});

test("an unpowered glide dissipates mechanical energy rather than maintaining speed magically", () => {
  const plane = new FlightPhysics({ position: new Vector3(0, 2000, 2000) });
  fly(plane, 15, { throttle: 0 });
  const energy = () =>
    plane.aircraft.mass *
    (9.80665 * plane.position.y + 0.5 * plane.velocity.lengthSq());
  const initial = energy();
  let previous = initial;
  for (let i = 0; i < 5 / DT; i++) {
    plane.update(DT, { throttle: 0 });
    const current = energy();
    assert.ok(
      current <= previous + 0.01,
      `energy grew by ${current - previous} J`,
    );
    previous = current;
  }
  assert.ok(previous < initial - 100000);
  assert.ok(plane.telemetry.verticalSpeed < 0);
});

test("wind-relative airspeed, ground speed and ISA density are independent", () => {
  const plane = new FlightPhysics({ speed: 48 });
  const wind = new Vector3(0, 0, 12);
  plane.update(DT, {}, { wind });
  const expected = plane.velocity.clone().sub(wind).length();
  assert.ok(Math.abs(plane.telemetry.airspeed - expected) < 1e-10);
  assert.ok(plane.telemetry.airspeed - plane.telemetry.groundspeed > 11.5);
  assert.equal(plane.telemetry.windSpeed, 12);
  assert.deepEqual(wind, new Vector3(0, 0, 12));
  const high = new FlightPhysics({ position: new Vector3(0, 12000, 2000) });
  assert.ok(high.telemetry.density < plane.telemetry.density * 0.35);
  high.update(DT, {}, { density: 0.8 });
  assert.equal(high.telemetry.density, 0.8);
  const veryHigh = new FlightPhysics({
    position: new Vector3(0, 100000, 2000),
  });
  fly(veryHigh, 1);
  finite(veryHigh);
  assert.ok(veryHigh.position.y > 99000);
});

test("adding the same wind and world velocity leaves airborne forces unchanged", () => {
  const still = new FlightPhysics();
  const moving = new FlightPhysics();
  const wind = new Vector3(12, 2, 8);
  moving.velocity.add(wind);
  still.update(DT, { pitch: 0.1, roll: 0.2 });
  moving.update(DT, { pitch: 0.1, roll: 0.2 }, { wind });
  assert.ok(
    moving.velocity.clone().sub(wind).distanceTo(still.velocity) < 1e-10,
  );
  assert.ok(moving.angularVelocity.distanceTo(still.angularVelocity) < 1e-10);
  assert.ok(Math.abs(moving.telemetry.lift - still.telemetry.lift) < 1e-8);
  assert.ok(Math.abs(moving.telemetry.thrust - still.telemetry.thrust) < 1e-8);
});

test("ground effect reduces induced drag and terrain callbacks set the wheel support height", () => {
  const low = new FlightPhysics({
    position: new Vector3(0, 20.5, 100),
    speed: 40,
  });
  const high = new FlightPhysics({
    position: new Vector3(0, 300, 100),
    speed: 40,
  });
  high.quaternion.copy(low.quaternion);
  low.update(DT, {}, { density: 1.2 });
  high.update(DT, {}, { density: 1.2 });
  assert.ok(low.telemetry.drag < high.telemetry.drag);
  assert.ok(low.telemetry.lift > high.telemetry.lift);
  const terrainHeight = (x, z) => 80 + x * 0.02 + z * 0.01;
  const plane = new FlightPhysics({
    position: new Vector3(1000, 400, 100),
    onGround: true,
    speed: 0,
    terrainHeight,
  });
  assert.ok(Math.abs(plane.position.y - 102.65) < 1e-10);
  fly(plane, 3, { throttle: 0, brakes: true });
  assert.ok(Math.abs(plane.telemetry.agl - 1.65) < 1e-10);
  assert.equal(plane.onGround, true);
  assert.equal(plane.crashed, false);
});

test("prop slipstream gives the rudder authority even before the takeoff roll", () => {
  const powered = new FlightPhysics({
    onGround: true,
    speed: 0,
    position: new Vector3(0, 18, 500),
  });
  const stopped = new FlightPhysics({
    onGround: true,
    speed: 0,
    position: new Vector3(0, 18, 500),
  });
  fly(powered, 10, { throttle: 1, brakes: true });
  fly(stopped, 10, { throttle: 0, brakes: true });
  fly(powered, 0.3, { throttle: 1, yaw: 1, brakes: true });
  fly(stopped, 0.3, { throttle: 0, yaw: 1, brakes: true });
  assert.ok(powered.angularVelocity.y < -0.03);
  assert.ok(
    Math.abs(stopped.angularVelocity.y) <
      Math.abs(powered.angularVelocity.y) * 0.02,
  );
});

test("rate damping and dynamic-pressure-limited controls prevent low-speed magic", () => {
  const slow = new FlightPhysics({
    speed: 1,
    position: new Vector3(0, 1000, 2000),
  });
  const fast = new FlightPhysics({
    speed: 48,
    position: new Vector3(0, 1000, 2000),
  });
  fly(slow, 0.4, { throttle: 0, roll: 1 });
  fly(fast, 0.4, { throttle: 0, roll: 1 });
  assert.ok(
    Math.abs(slow.angularVelocity.z) < Math.abs(fast.angularVelocity.z) * 0.1,
  );
  const plane = new FlightPhysics();
  plane.angularVelocity.set(0.4, -0.3, 1.2);
  fly(plane, 2);
  assert.ok(
    plane.angularVelocity.length() < 0.35,
    `rates ${plane.angularVelocity.length()}`,
  );
  finite(plane);
});

test("dt substeps, invalid input guards, reset and state identity are robust", () => {
  const fine = new FlightPhysics(),
    coarse = new FlightPhysics();
  fly(fine, 2, { roll: 0.2 });
  for (let i = 0; i < 20; i++) coarse.update(0.1, { roll: 0.2 });
  assert.ok(fine.position.distanceTo(coarse.position) < 1e-8);
  assert.ok(fine.quaternion.angleTo(coarse.quaternion) < 1e-6);
  const giant = new FlightPhysics(),
    capped = new FlightPhysics();
  giant.update(1000);
  capped.update(0.1);
  assert.ok(giant.position.distanceTo(capped.position) < 1e-10);
  const position = giant.position.clone();
  for (const dt of [0, -1, NaN, Infinity]) giant.update(dt);
  assert.deepEqual(giant.position, position);
  giant.update(
    DT,
    { pitch: NaN, roll: Infinity, yaw: 100, throttle: -5, flaps: 5 },
    { wind: new Vector3(NaN, 0, 0), density: NaN },
  );
  finite(giant);
  assert.equal(giant.throttle, 0);
  assert.equal(giant.flaps, 1);
  const refs = [
    giant.position,
    giant.velocity,
    giant.quaternion,
    giant.angularVelocity,
    giant.telemetry,
  ];
  giant.velocity.x = NaN;
  giant.update(DT);
  assert.equal(giant.crashed, true);
  finite(giant);
  giant.reset({
    aircraft: "sport",
    heading: Math.PI / 2,
    onGround: true,
    speed: 0,
    position: new Vector3(0, 99, 500),
  });
  assert.equal(giant.crashed, false);
  assert.equal(giant.crashReason, "");
  assert.equal(giant.aircraft, AIRCRAFT.sport);
  assert.equal(giant.position.y, 19.65);
  assert.equal(giant.telemetry.heading, 90);
  for (const [i, value] of [
    giant.position,
    giant.velocity,
    giant.quaternion,
    giant.angularVelocity,
    giant.telemetry,
  ].entries())
    assert.equal(value, refs[i]);
});
