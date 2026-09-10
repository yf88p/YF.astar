import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { DEFAULT_CONFIG, FIXED_DT, FlightPhysics } from './physics';
import type { ControlInput, FlightConfig } from './physics';

const neutral: ControlInput = { throttle: 0, pitch: 0, roll: 0, yaw: 0 };
const up = new Vector3(0, 1, 0);
const forward = new Vector3(0, 0, -1);

function run(sim: FlightPhysics, seconds: number, input: Partial<ControlInput> = {}) {
  const controls = { ...neutral, ...input };
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) sim.step(controls);
}

function airborne(overrides: Partial<FlightConfig> = {}) {
  const sim = new FlightPhysics(overrides);
  sim.reset(new Vector3(0, 100, 0));
  return sim;
}

function hover(sim: FlightPhysics) {
  return sim.config.mass * sim.config.gravity / (4 * sim.config.maxThrustPerMotor);
}

describe('FlightPhysics translational dynamics', () => {
  it('starts disarmed with the documented axes, position, and independent config', () => {
    const sim = new FlightPhysics();
    expect(FIXED_DT).toBe(1 / 240);
    expect(sim.position.toArray()).toEqual([0, 0.2, 24]);
    expect(sim.orientation.toArray()).toEqual([0, 0, 0, 1]);
    expect(sim.mode).toBe('angle');
    expect(sim.armed).toBe(false);
    expect(sim.motors).toEqual([0, 0, 0, 0]);
    expect(sim.config.inertia).not.toBe(DEFAULT_CONFIG.inertia);
  });

  it('free-falls under gravity while disarmed, regardless of throttle', () => {
    const sim = airborne({ linearDrag: 0, quadraticDrag: 0 });
    run(sim, 1, { throttle: 1 });
    expect(sim.velocity.y).toBeCloseTo(-9.81, 10);
    // Semi-implicit Euler has a known half-step position bias.
    expect(sim.position.y).toBeCloseTo(100 - 0.5 * 9.81 * (1 + FIXED_DT), 9);
    expect(sim.motors).toEqual([0, 0, 0, 0]);
    expect(sim.flightTime).toBe(0);
  });

  it('balances mg with four level, settled motors at the analytical hover throttle', () => {
    const sim = airborne();
    const throttle = hover(sim);
    sim.arm();
    sim.motors.fill(throttle);
    run(sim, 3, { throttle });
    expect(sim.position.y).toBeCloseTo(100, 9);
    expect(sim.velocity.length()).toBeLessThan(1e-10);
    expect(sim.angularVelocity.length()).toBeLessThan(1e-10);
    expect(sim.motors.reduce((a, b) => a + b) * sim.config.maxThrustPerMotor)
      .toBeCloseTo(sim.config.mass * sim.config.gravity, 10);
  });

  it('accelerates at F/m - g and takes off from the ground above hover', () => {
    const ideal = airborne({ motorTimeConstant: 0, linearDrag: 0, quadraticDrag: 0 });
    ideal.arm();
    run(ideal, 0.5, { throttle: 0.6 });
    expect(ideal.velocity.y).toBeCloseTo((4 * 0.6 * ideal.config.maxThrustPerMotor / ideal.config.mass - 9.81) * 0.5, 9);
    const sim = new FlightPhysics();
    sim.arm();
    run(sim, 1, { throttle: 0.6 });
    expect(sim.position.y).toBeGreaterThan(3);
    expect(sim.velocity.y).toBeGreaterThan(5);
    expect(sim.crashed).toBe(false);
  });

  it('applies the exact first-order motor response independently on spin-up and spin-down', () => {
    const sim = airborne({ gravity: 0 });
    sim.arm();
    sim.step({ ...neutral, throttle: 0.6 });
    const first = 0.6 * (1 - Math.exp(-FIXED_DT / sim.config.motorTimeConstant));
    for (const motor of sim.motors) expect(motor).toBeCloseTo(first, 12);
    sim.motors.splice(0, 4, 0.1, 0.3, 0.6, 0.9);
    const before = [...sim.motors];
    sim.step(neutral);
    sim.motors.forEach((motor, i) => expect(motor).toBeCloseTo(before[i] * Math.exp(-FIXED_DT / sim.config.motorTimeConstant), 12));
  });

  it('uses air-relative drag, including wind advection and stable high-drag decay', () => {
    const sim = airborne({ gravity: 0 });
    sim.wind.set(5, 0, 0);
    sim.velocity.copy(sim.wind);
    run(sim, 1);
    expect(sim.velocity.x).toBeCloseTo(5, 12);
    expect(sim.position.x).toBeCloseTo(5, 10);
    sim.velocity.set(0, 0, 0);
    run(sim, 1);
    expect(sim.velocity.x).toBeGreaterThan(0);
    expect(sim.velocity.x).toBeLessThan(5);
    const drag = airborne({ gravity: 0, linearDrag: 100, quadraticDrag: 100 });
    drag.velocity.set(20, 0, 0);
    run(drag, 0.1);
    expect(drag.velocity.x).toBeGreaterThan(0);
    expect(drag.velocity.x).toBeLessThan(0.01);
  });

  it('cuts thrust on disarm but preserves momentum and gravity', () => {
    const sim = airborne();
    sim.arm();
    run(sim, 0.2, { throttle: 0.8 });
    sim.disarm();
    const vy = sim.velocity.y;
    sim.step({ ...neutral, throttle: 1 });
    expect(sim.motors).toEqual([0, 0, 0, 0]);
    expect(sim.velocity.y).toBeLessThan(vy);
    expect(sim.velocity.y).toBeGreaterThan(0);
  });
});

describe('FlightPhysics attitude and rate control', () => {
  it.each(['angle', 'acro'] as const)('has forward-pitch, right-roll and right-yaw signs in %s mode', (mode) => {
    const pitch = airborne();
    pitch.mode = mode;
    pitch.arm();
    run(pitch, 0.2, { throttle: 0.5, pitch: 0.4 });
    expect(pitch.angularVelocity.x).toBeLessThan(0);
    expect(forward.clone().applyQuaternion(pitch.orientation).y).toBeLessThan(-0.02);
    expect(pitch.velocity.z).toBeLessThan(0);
    const roll = airborne();
    roll.mode = mode;
    roll.arm();
    run(roll, 0.2, { throttle: 0.5, roll: 0.4 });
    expect(roll.angularVelocity.z).toBeLessThan(0);
    expect(up.clone().applyQuaternion(roll.orientation).x).toBeGreaterThan(0.02);
    expect(roll.velocity.x).toBeGreaterThan(0);
    const yaw = airborne();
    yaw.mode = mode;
    yaw.arm();
    run(yaw, 0.2, { throttle: 0.5, yaw: 0.4 });
    expect(yaw.angularVelocity.y).toBeLessThan(0);
    expect(forward.clone().applyQuaternion(yaw.orientation).x).toBeGreaterThan(0.02);
  });

  it('mixes yaw on counter-rotating diagonals without introducing tilt or collective error', () => {
    const sim = airborne();
    sim.arm();
    sim.motors.fill(0.5);
    sim.step({ ...neutral, throttle: 0.5, yaw: 1 });
    const [fl, fr, rr, rl] = sim.motors;
    expect(fr).toBeGreaterThan(fl);
    expect(rl).toBeGreaterThan(rr);
    expect(fl).toBeCloseTo(rr, 12);
    expect(fr).toBeCloseTo(rl, 12);
    expect(fl + fr + rr + rl).toBeCloseTo(2, 12);
    expect(sim.angularVelocity.y).toBeLessThan(0);
    expect(Math.abs(sim.angularVelocity.x) + Math.abs(sim.angularVelocity.z)).toBeLessThan(1e-10);
  });

  it('tracks an acro body rate and stops rotating without self-leveling at neutral sticks', () => {
    const sim = airborne({ gravity: 0 });
    sim.mode = 'acro';
    sim.arm();
    run(sim, 0.5, { throttle: 0.5, roll: 0.2 });
    // PD intentionally allows a small steady-state rate error against angular drag.
    const target = -0.2 * sim.config.maxRate;
    expect(Math.abs((sim.angularVelocity.z - target) / target)).toBeLessThan(0.05);
    run(sim, 1, { throttle: 0.5 });
    expect(sim.angularVelocity.length()).toBeLessThan(0.015);
    expect(up.clone().applyQuaternion(sim.orientation).angleTo(up)).toBeGreaterThan(0.6);
  });

  it.each([0.7, Math.PI / 2, Math.PI])('self-levels from a %s rad tilt without requiring a yaw reference', (tilt) => {
    const sim = airborne({ gravity: 0 });
    sim.orientation.setFromAxisAngle(new Vector3(0, 0, 1), tilt);
    sim.arm();
    run(sim, 3, { throttle: 0.5 });
    expect(up.clone().applyQuaternion(sim.orientation).angleTo(up)).toBeLessThan(0.02);
    expect(sim.angularVelocity.length()).toBeLessThan(0.05);
  });

  it('commands a bounded heading-relative lean instead of position hold', () => {
    const sim = airborne({ gravity: 0 });
    sim.orientation.setFromAxisAngle(up, -Math.PI / 2);
    sim.arm();
    run(sim, 2, { throttle: 0.5, pitch: 0.5 });
    const bodyUp = up.clone().applyQuaternion(sim.orientation);
    expect(bodyUp.angleTo(up)).toBeCloseTo(sim.config.maxTilt * 0.5, 2);
    expect(bodyUp.x).toBeGreaterThan(0.3);
    expect(Math.abs(bodyUp.z)).toBeLessThan(0.02);
    expect(sim.velocity.x).toBeGreaterThan(1);
  });

  it('bounds motor mixing and recovers from sustained saturation without windup', () => {
    const sim = airborne({ gravity: 0 });
    sim.mode = 'acro';
    sim.arm();
    run(sim, 1, { throttle: 0, pitch: 1, roll: 1, yaw: 1 });
    expect(sim.motors.every((m) => m >= 0 && m <= 1)).toBe(true);
    expect(sim.angularVelocity.length()).toBeLessThan(1e-10);
    run(sim, 0.25, { throttle: 0.5, roll: 1 });
    expect(sim.angularVelocity.z).toBeLessThan(-2);
    run(sim, 1, { throttle: 0.5 });
    expect(sim.angularVelocity.length()).toBeLessThan(0.05);
  });

  it('retains steering at full throttle by reducing collective instead of clipping torque axes', () => {
    const sim = airborne();
    sim.mode = 'acro';
    sim.arm();
    sim.motors.fill(1);
    run(sim, 0.1, { throttle: 1, roll: 0.5 });
    expect(sim.angularVelocity.z).toBeLessThan(-0.5);
    expect(Math.abs(sim.angularVelocity.x) + Math.abs(sim.angularVelocity.y)).toBeLessThan(1e-10);
    expect(sim.motors.every((m) => m >= 0 && m <= 1)).toBe(true);
    expect(sim.motors.reduce((a, b) => a + b)).toBeLessThan(4);
  });

  it('uses principal-axis inertia and conserves torque-free angular momentum approximately', () => {
    const sim = airborne({ gravity: 0, angularDrag: 0, angularQuadraticDrag: 0 });
    sim.angularVelocity.set(2, 3, 1);
    const momentum = sim.angularVelocity.clone().multiply(sim.config.inertia).applyQuaternion(sim.orientation);
    const energy = sim.angularVelocity.clone().multiply(sim.config.inertia).dot(sim.angularVelocity) / 2;
    run(sim, 2);
    const after = sim.angularVelocity.clone().multiply(sim.config.inertia).applyQuaternion(sim.orientation);
    expect(after.distanceTo(momentum) / momentum.length()).toBeLessThan(0.002);
    expect(Math.abs(sim.angularVelocity.clone().multiply(sim.config.inertia).dot(sim.angularVelocity) / 2 - energy) / energy).toBeLessThan(0.001);
    expect(Math.abs(sim.angularVelocity.x - 2)).toBeGreaterThan(0.1);
  });

  it('dissipates body rotation through angular drag even while disarmed', () => {
    const sim = airborne({ gravity: 0 });
    sim.angularVelocity.set(0, 4, 0);
    run(sim, 2);
    expect(sim.angularVelocity.y).toBeGreaterThan(0);
    expect(sim.angularVelocity.y).toBeLessThan(3);
  });
});

describe('FlightPhysics contacts', () => {
  it('settles on the ground without jitter, removes lateral motion, and permits takeoff', () => {
    const sim = new FlightPhysics();
    sim.position.y = 0.5;
    sim.velocity.set(2, -1, 0);
    run(sim, 3);
    expect(sim.position.y).toBeCloseTo(sim.config.radius, 10);
    expect(sim.velocity.length()).toBeLessThan(1e-8);
    expect(sim.crashed).toBe(false);
    expect(sim.maxImpact).toBeGreaterThan(1);
    const stoppedDistance = sim.telemetry.distance;
    run(sim, 2);
    expect(sim.telemetry.distance).toBeCloseTo(stoppedDistance, 10);
    sim.arm();
    run(sim, 1, { throttle: 0.6 });
    expect(sim.position.y).toBeGreaterThan(2);
  });

  it('crashes and refuses re-arming above 6 m/s normal impact speed', () => {
    const sim = new FlightPhysics({ linearDrag: 0, quadraticDrag: 0 });
    sim.reset(new Vector3(0, 0.21, 0));
    sim.velocity.y = -7;
    sim.arm();
    run(sim, 0.1);
    expect(sim.crashed).toBe(true);
    expect(sim.armed).toBe(false);
    expect(sim.maxImpact).toBeGreaterThan(7);
    expect(sim.motors).toEqual([0, 0, 0, 0]);
    expect(sim.arm()).toBe(false);
    expect(sim.position.y).toBeGreaterThanOrEqual(sim.config.radius);
  });

  it.each([5.9, 6, 6.1])('uses a strict 6 m/s normal-impact crash threshold at %s m/s', (speed) => {
    const sim = airborne({ gravity: 0, linearDrag: 0, quadraticDrag: 0 });
    sim.position.y = sim.config.radius;
    sim.velocity.set(10, -speed, 0);
    sim.arm();
    sim.step(neutral);
    expect(sim.crashed).toBe(speed > 6);
    expect(sim.maxImpact).toBeCloseTo(speed, 10);
  });

  it('supports a landing on the top of an AABB for many steps', () => {
    const sim = new FlightPhysics();
    sim.reset(new Vector3(0, 2.5, 0));
    sim.setObstacles([{ min: new Vector3(-2, 0, -2), max: new Vector3(2, 2, 2) }]);
    run(sim, 5);
    expect(sim.position.y).toBeCloseTo(2 + sim.config.radius, 10);
    expect(sim.velocity.length()).toBeLessThan(1e-8);
    expect(sim.crashed).toBe(false);
    sim.arm();
    run(sim, 1, { throttle: 0.6 });
    expect(sim.position.y).toBeGreaterThan(4);
  });

  it('responds to walls, ceilings, and spherical corner overlaps', () => {
    const wall = airborne({ gravity: 0, linearDrag: 0, quadraticDrag: 0 });
    wall.position.set(-0.3, 2, 0);
    wall.velocity.set(3, 0, 0);
    wall.setObstacles([{ min: new Vector3(0, 0, -2), max: new Vector3(1, 4, 2) }]);
    run(wall, 0.2);
    expect(wall.position.x).toBeLessThanOrEqual(-wall.config.radius);
    expect(wall.velocity.x).toBeLessThanOrEqual(0);
    expect(wall.maxImpact).toBeCloseTo(3, 10);
    expect(wall.crashed).toBe(false);

    const ceiling = airborne({ gravity: 0 });
    ceiling.position.set(0, 1.7, 0);
    ceiling.velocity.y = 3;
    ceiling.setObstacles([{ min: new Vector3(-2, 2, -2), max: new Vector3(2, 3, 2) }]);
    run(ceiling, 0.2);
    expect(ceiling.position.y).toBeLessThanOrEqual(2 - ceiling.config.radius);
    expect(ceiling.velocity.y).toBeLessThanOrEqual(0);

    const corner = airborne({ gravity: 0 });
    corner.position.set(-0.1, 2.1, -0.1);
    corner.setObstacles([{ min: new Vector3(0, 0, 0), max: new Vector3(2, 2, 2) }]);
    corner.step(neutral);
    expect(corner.position.distanceTo(new Vector3(0, 2, 0))).toBeCloseTo(corner.config.radius, 10);
  });

  it.each([new Vector3(0, 1, 0), new Vector3(0, 0.18, 0), new Vector3(1, 1, 0)])(
    'resolves zero-distance box penetration at %s without NaNs or a below-ground exit', (position) => {
      const sim = new FlightPhysics();
      sim.reset(position);
      sim.setObstacles([{ min: new Vector3(-1, 0, -1), max: new Vector3(1, 2, 1) }]);
      run(sim, 1);
      expect(sim.position.toArray().every(Number.isFinite)).toBe(true);
      expect(sim.position.y).toBeGreaterThanOrEqual(sim.config.radius);
      const closest = sim.position.clone().clamp(new Vector3(-1, 0, -1), new Vector3(1, 2, 1));
      expect(sim.position.distanceTo(closest)).toBeGreaterThanOrEqual(sim.config.radius - 1e-9);
    },
  );

  it('does not tunnel through a thin wall even at unusually high speed', () => {
    const sim = airborne({ gravity: 0, linearDrag: 0, quadraticDrag: 0 });
    sim.position.set(-1, 2, 0);
    sim.velocity.x = 500;
    sim.setObstacles([{ min: new Vector3(0, 0, -2), max: new Vector3(0.01, 4, 2) }]);
    sim.arm();
    sim.step(neutral);
    expect(sim.position.x).toBeLessThanOrEqual(-sim.config.radius);
    expect(sim.crashed).toBe(true);
    expect(sim.maxImpact).toBeCloseTo(500, 9);
  });

  it('escapes an impossible box/ground gap instead of alternating penetration corrections', () => {
    const sim = new FlightPhysics();
    sim.reset(new Vector3(0, 0.18, 0));
    const min = new Vector3(-1, 0.2, -1);
    const max = new Vector3(1, 2, 1);
    sim.setObstacles([{ min, max }]);
    run(sim, 1);
    expect(sim.position.y).toBeGreaterThanOrEqual(sim.config.radius);
    expect(sim.position.distanceTo(sim.position.clone().clamp(min, max)))
      .toBeGreaterThanOrEqual(sim.config.radius - 1e-9);
  });
});

describe('FlightPhysics determinism, telemetry, and lifecycle', () => {
  it('matches fixed steps when given a larger frame dt', () => {
    const fixed = airborne();
    const batched = airborne();
    fixed.arm();
    batched.arm();
    for (let frame = 0; frame < 180; frame++) {
      const input = { throttle: 0.4, pitch: 0.2 * Math.sin(frame / 20), roll: 0.1, yaw: -0.15 };
      for (let i = 0; i < 4; i++) fixed.step(input);
      batched.step(input, 1 / 60);
    }
    expect(batched.position.toArray()).toEqual(fixed.position.toArray());
    expect(batched.orientation.toArray()).toEqual(fixed.orientation.toArray());
    expect(batched.telemetry).toEqual(fixed.telemetry);
  });

  it('converges at half dt and rejects invalid time without modifying state', () => {
    const fixed = airborne();
    const half = airborne();
    fixed.arm();
    half.arm();
    const input = { throttle: 0.4, pitch: 0.3, roll: -0.2, yaw: 0.1 };
    for (let i = 0; i < 480; i++) {
      fixed.step(input);
      half.step(input, FIXED_DT / 2);
      half.step(input, FIXED_DT / 2);
    }
    expect(fixed.position.distanceTo(half.position)).toBeLessThan(0.12);
    expect(fixed.orientation.angleTo(half.orientation)).toBeLessThan(0.02);
    const before = fixed.position.clone();
    fixed.step(input, 0);
    for (const dt of [-1, NaN, Infinity]) expect(() => fixed.step(input, dt)).toThrow(RangeError);
    expect(fixed.position.equals(before)).toBe(true);
  });

  it('integrates distance, armed time and estimated current, with load-dependent voltage sag', () => {
    const sim = airborne({ gravity: 0, linearDrag: 0, quadraticDrag: 0 });
    sim.velocity.x = 2;
    run(sim, 1);
    expect(sim.telemetry.distance).toBeCloseTo(2, 10);
    expect(sim.telemetry.speed).toBe(2);
    expect(sim.telemetry.altitude).toBe(100);
    expect(sim.telemetry.verticalSpeed).toBe(0);
    expect(sim.consumedMah).toBeCloseTo(sim.config.idleCurrent / 3.6, 10);
    const chargeBefore = sim.consumedMah;
    const restingVoltage = sim.batteryVoltage;
    sim.arm();
    run(sim, 1, { throttle: 0.5 });
    expect(sim.flightTime).toBeCloseTo(1, 10);
    expect(sim.consumedMah).toBeGreaterThan(chargeBefore);
    expect(sim.telemetry.current).toBeGreaterThan(20);
    expect(sim.telemetry.current).toBeLessThan(30);
    expect(sim.batteryVoltage).toBeLessThan(restingVoltage - 0.5);
    const loadedVoltage = sim.batteryVoltage;
    sim.disarm();
    run(sim, 0.1);
    expect(sim.batteryVoltage).toBeGreaterThan(loadedVoltage);
    expect(sim.flightTime).toBeCloseTo(1, 10);
    const telemetry = sim.telemetry;
    telemetry.motorOutputs[0] = 10;
    expect(sim.motors[0]).toBe(0);
  });

  it('integrates the documented constant-load current in amperes into mAh', () => {
    const sim = airborne({ motorTimeConstant: 0 });
    sim.arm();
    run(sim, 1, { throttle: 0.5 });
    const current = sim.config.armedIdleCurrent + 4 * sim.config.motorMaxCurrent * 0.5 ** 1.5;
    expect(sim.telemetry.current).toBeCloseTo(current, 10);
    expect(sim.consumedMah).toBeCloseTo(current / 3.6, 10);
  });

  it('resets flight state and battery while preserving world settings and object identities', () => {
    const sim = new FlightPhysics();
    const identities = [sim.position, sim.velocity, sim.orientation, sim.angularVelocity, sim.motors];
    sim.mode = 'acro';
    sim.wind.set(2, 0, 0);
    sim.setObstacles([{ min: new Vector3(-1, 0, -1), max: new Vector3(1, 2, 1) }]);
    sim.arm();
    run(sim, 1, { throttle: 0.7, roll: 0.2 });
    sim.crashed = true;
    sim.maxImpact = 10;
    const spawn = new Vector3(0, 2.2, 0);
    sim.reset(spawn);
    spawn.x = 20;
    expect(sim.position.toArray()).toEqual([0, 2.2, 0]);
    expect(sim.velocity.length() + sim.angularVelocity.length()).toBe(0);
    expect(sim.orientation.equals(new Quaternion())).toBe(true);
    expect(sim.motors).toEqual([0, 0, 0, 0]);
    expect(sim.armed).toBe(false);
    expect(sim.crashed).toBe(false);
    expect(sim.maxImpact + sim.consumedMah + sim.flightTime + sim.telemetry.distance).toBe(0);
    expect(sim.batteryVoltage).toBe(sim.config.batteryCells * 4.2);
    expect(sim.mode).toBe('acro');
    expect(sim.wind.x).toBe(2);
    [sim.position, sim.velocity, sim.orientation, sim.angularVelocity, sim.motors]
      .forEach((value, i) => expect(value).toBe(identities[i]));
    sim.wind.set(0, 0, 0);
    run(sim, 1);
    expect(sim.position.y).toBeCloseTo(2.18, 10);
    expect(sim.arm()).toBe(true);
    sim.reset();
    expect(sim.position.toArray()).toEqual([0, 0.2, 24]);
  });

  it('validates physical scales and sanitizes nonfinite or out-of-range controls', () => {
    expect(() => new FlightPhysics({ mass: 0 })).toThrow(RangeError);
    expect(() => new FlightPhysics({ inertia: new Vector3(1, -1, 1) })).toThrow(RangeError);
    expect(() => new FlightPhysics({ motorTimeConstant: -1 })).toThrow(RangeError);
    const sim = airborne();
    expect(() => sim.setObstacles([{ min: new Vector3(2, 0, 0), max: new Vector3(1, 1, 1) }])).toThrow(RangeError);
    sim.arm();
    sim.step({ throttle: 3, pitch: NaN, roll: Infinity, yaw: -Infinity });
    expect(sim.motors.every((m) => Number.isFinite(m) && m >= 0 && m <= 1)).toBe(true);
    expect(sim.angularVelocity.length()).toBe(0);
  });

  it('stays finite and deterministic over a long mixed-mode flight and repeated contacts', () => {
    const a = airborne();
    const b = airborne();
    for (const sim of [a, b]) {
      sim.wind.set(3, 0, -2);
      sim.setObstacles([{ min: new Vector3(-10, 0, -10), max: new Vector3(10, 3, 10) }]);
      sim.arm();
    }
    for (let i = 0; i < 240 * 90; i++) {
      const input = {
        throttle: 0.45 + 0.2 * Math.sin(i * 0.003),
        pitch: 0.7 * Math.sin(i * 0.007),
        roll: 0.6 * Math.cos(i * 0.011),
        yaw: 0.5 * Math.sin(i * 0.013),
      };
      for (const sim of [a, b]) {
        sim.mode = i % 2400 < 1200 ? 'angle' : 'acro';
        if (sim.crashed) {
          sim.reset(new Vector3(0, 100, 0));
          sim.arm();
        }
        sim.step(input);
      }
      if (i % 240 === 0) {
        expect([...a.position.toArray(), ...a.velocity.toArray(), ...a.angularVelocity.toArray(),
          ...a.orientation.toArray(), a.batteryVoltage, a.consumedMah].every(Number.isFinite)).toBe(true);
        expect(a.orientation.length()).toBeCloseTo(1, 12);
        expect(a.motors.every((m) => m >= 0 && m <= 1)).toBe(true);
        expect(a.position.y).toBeGreaterThanOrEqual(a.config.radius);
      }
    }
    expect(a.position.toArray()).toEqual(b.position.toArray());
    expect(a.orientation.toArray()).toEqual(b.orientation.toArray());
    expect(a.telemetry).toEqual(b.telemetry);
  });
});
