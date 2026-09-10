import {
  NEUTRAL,
  TICK_RATE,
  type CarState,
  type Controls,
  type Player,
  type RaceResult,
} from "./protocol";
import { nearestTrack, type Track } from "./tracks";

const MAX_SPEED = 70;
const CAR_RADIUS = 1.35;
const RESET_COOLDOWN = 3 * TICK_RATE;
const RESET_PENALTY = 3 * TICK_RATE;
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));
const angle = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
const finiteControl = (n: number) => (Number.isFinite(n) ? clamp(n, -1, 1) : 0);
const corridor = (track: Track) => track.width / 2 + 1.5 - CAR_RADIUS;
const wheelAngle = (speed: number) => 0.5 / (1 + Math.abs(speed) * 0.018);

export function createCar(
  id: string,
  track: Track,
  gridIndex: number,
  startTick: number,
): CarState {
  const gate = track.checkpoints[0];
  const back = 7 + Math.floor(gridIndex / 2) * 6;
  const side = gridIndex % 2 === 0 ? -2.5 : 2.5;
  const x = gate.x - Math.sin(gate.yaw) * back + Math.cos(gate.yaw) * side;
  const z = gate.z - Math.cos(gate.yaw) * back - Math.sin(gate.yaw) * side;
  const projected = nearestTrack(track, x, z).progress;
  return {
    id,
    x,
    z,
    yaw: gate.yaw,
    vx: 0,
    vz: 0,
    speed: 0,
    steer: 0,
    drift: false,
    offTrack: false,
    checkpoint: 1,
    lap: 1,
    lapStartTick: startTick,
    bestLapTicks: null,
    lastLapTicks: null,
    lapTimes: [],
    finishTick: null,
    penaltyTicks: 0,
    // Total validated laps, slightly negative on the grid; never raw minimap projection.
    progress: projected > 0.5 ? projected - 1 : projected,
    resets: 0,
    collision: 0,
    lastResetTick: startTick - RESET_COOLDOWN,
  };
}

// Sweep the car's center, not just its endpoint. The corridor already includes
// the car radius, so even high-speed glancing impacts cannot tunnel through walls.
function sweepCar(
  before: CarState,
  after: CarState,
  track: Track,
  maxDistance: number,
): CarState {
  let dx = after.x - before.x;
  let dz = after.z - before.z;
  const distance = Math.hypot(dx, dz);
  if (distance > maxDistance) {
    dx *= maxDistance / distance;
    dz *= maxDistance / distance;
  }
  const samples = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.5));
  let x = before.x;
  let z = before.z;
  let previousDistance = nearestTrack(track, x, z).distance;
  let result = { ...after };
  for (let i = 1; i <= samples; i++) {
    const px = before.x + (dx * i) / samples;
    const pz = before.z + (dz * i) / samples;
    const road = nearestTrack(track, px, pz);
    if (
      road.distance > corridor(track) &&
      road.distance >= previousDistance - 1e-6
    ) {
      const nx = (px - road.x) / road.distance;
      const nz = (pz - road.z) / road.distance;
      const outward = Math.max(0, result.vx * nx + result.vz * nz);
      result.vx = (result.vx - 1.15 * outward * nx) * 0.82;
      result.vz = (result.vz - 1.15 * outward * nz) * 0.82;
      result.collision = 1;
      break;
    }
    x = px;
    z = pz;
    previousDistance = road.distance;
  }
  result = { ...result, x, z };
  result.speed =
    result.vx * Math.sin(result.yaw) + result.vz * Math.cos(result.yaw);
  result.offTrack =
    nearestTrack(track, x, z).distance > track.width / 2 - CAR_RADIUS;
  return result;
}

export function stepCar(
  car: CarState,
  controls: Controls,
  track: Track,
  dt = 1 / TICK_RATE,
): CarState {
  if (!Number.isFinite(dt) || dt <= 0 || car.finishTick !== null)
    return { ...car };
  // Prediction may replay variable intervals, but no call can simulate an unbounded jump.
  const duration = Math.min(dt, 0.1);
  const steps = Math.ceil(duration * TICK_RATE);
  const h = duration / steps;
  const throttle = finiteControl(controls.throttle);
  const steering = finiteControl(controls.steer);
  let result = { ...car };
  for (let i = 0; i < steps; i++) {
    const before = result;
    let vx = Number.isFinite(before.vx) ? before.vx : 0;
    let vz = Number.isFinite(before.vz) ? before.vz : 0;
    const magnitude = Math.hypot(vx, vz);
    if (magnitude > MAX_SPEED) {
      vx *= MAX_SPEED / magnitude;
      vz *= MAX_SPEED / magnitude;
    }
    const longitudinal = vx * Math.sin(before.yaw) + vz * Math.cos(before.yaw);
    const steer =
      before.steer + (steering - before.steer) * (1 - Math.exp(-10 * h));
    const drifting = controls.drift && Math.abs(longitudinal) > 8;
    const yawRate = clamp(
      (longitudinal / 3.1) *
        Math.tan(steer * wheelAngle(longitudinal)) *
        (drifting ? 1.2 : 1),
      -1.8,
      1.8,
    );
    const yaw = angle(before.yaw + yawRate * h);
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    let forward = vx * sx + vz * sz;
    let lateral = vx * sz - vz * sx;
    const wet = track.id === "harbor";
    const grip = drifting ? (wet ? 1.8 : 2.7) : wet ? 7.5 : 11;
    const traction = drifting ? (wet ? 8.5 : 12) : wet ? 23 : 34;
    lateral -= clamp(
      lateral * (1 - Math.exp(-grip * h)),
      -traction * h,
      traction * h,
    );
    const drag =
      0.8 +
      0.13 * Math.abs(forward) +
      0.003 * forward * forward +
      (drifting ? 2 : 0) +
      (before.offTrack ? 8 : 0);
    const resistance = (controls.brake ? 36 : 0) + drag;
    forward =
      Math.sign(forward) * Math.max(0, Math.abs(forward) - resistance * h);
    if (!controls.brake) {
      const power = throttle * forward < 0 ? 32 : throttle < 0 ? 12 : 22;
      forward += throttle * power * h;
    }
    forward = clamp(forward, -14, MAX_SPEED);
    vx = forward * sx + lateral * sz;
    vz = forward * sz - lateral * sx;
    const speed = Math.hypot(vx, vz);
    if (speed > MAX_SPEED) {
      vx *= MAX_SPEED / speed;
      vz *= MAX_SPEED / speed;
    }
    result = sweepCar(
      before,
      {
        ...before,
        x: before.x + vx * h,
        z: before.z + vz * h,
        yaw,
        vx,
        vz,
        speed: forward,
        steer,
        drift: drifting,
        collision: Math.max(0, before.collision - 3 * h),
      },
      track,
      MAX_SPEED * h,
    );
  }
  return result;
}

export function stepRace(
  cars: CarState[],
  inputs: Record<string, Controls>,
  track: Track,
  tick: number,
  startTick: number,
  laps: number,
): CarState[] {
  if (tick < startTick) return cars.map((car) => ({ ...car }));
  const resetIds = new Set<string>();
  let next = cars.map((car) => {
    if (car.finishTick !== null) return { ...car };
    const input = inputs[car.id] ?? NEUTRAL;
    if (input.reset && tick - car.lastResetTick >= RESET_COOLDOWN) {
      const previous =
        (car.checkpoint + track.checkpoints.length - 1) %
        track.checkpoints.length;
      const gate = track.checkpoints[previous];
      const x = gate.x - Math.sin(gate.yaw) * 4;
      const z = gate.z - Math.cos(gate.yaw) * 4;
      let progress = nearestTrack(track, x, z).progress;
      if (previous === 0 && progress > 0.5) progress--;
      resetIds.add(car.id);
      return {
        ...car,
        x,
        z,
        yaw: gate.yaw,
        vx: 0,
        vz: 0,
        speed: 0,
        steer: 0,
        drift: false,
        offTrack: false,
        collision: 0,
        progress: car.lap - 1 + progress,
        penaltyTicks: car.penaltyTicks + RESET_PENALTY,
        resets: car.resets + 1,
        lastResetTick: tick,
      };
    }
    return stepCar(car, input, track);
  });
  const physical = next.map((car) => ({ ...car }));
  // Stable pair order makes collisions independent of room/player array order.
  const order = next
    .map((_, i) => i)
    .sort((a, b) => compareIds(next[a].id, next[b].id));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = next[order[i]];
        const b = next[order[j]];
        if (
          a.finishTick !== null ||
          b.finishTick !== null ||
          resetIds.has(a.id) ||
          resetIds.has(b.id)
        )
          continue;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let distance = Math.hypot(dx, dz);
        let swept = false;
        if (pass === 0) {
          // Relative-motion circle sweep also catches glancing contacts whose
          // endpoints do not overlap. Stop at contact before applying impulse.
          const oldA = cars[order[i]];
          const oldB = cars[order[j]];
          const ox = oldB.x - oldA.x;
          const oz = oldB.z - oldA.z;
          const rx = dx - ox;
          const rz = dz - oz;
          const aa = rx * rx + rz * rz;
          const bb = 2 * (ox * rx + oz * rz);
          const cc = ox * ox + oz * oz - (CAR_RADIUS * 2) ** 2;
          const discriminant = bb * bb - 4 * aa * cc;
          if (cc > 0 && aa > 1e-12 && bb < 0 && discriminant >= 0) {
            const t = (-bb - Math.sqrt(discriminant)) / (2 * aa);
            if (t >= 0 && t <= 1) {
              a.x = oldA.x + (a.x - oldA.x) * t;
              a.z = oldA.z + (a.z - oldA.z) * t;
              b.x = oldB.x + (b.x - oldB.x) * t;
              b.z = oldB.z + (b.z - oldB.z) * t;
              dx = b.x - a.x;
              dz = b.z - a.z;
              distance = Math.hypot(dx, dz);
              swept = true;
            }
          }
        }
        if (distance >= CAR_RADIUS * 2 && !swept) continue;
        const nx = distance > 1e-6 ? dx / distance : 1;
        const nz = distance > 1e-6 ? dz / distance : 0;
        const correction = clamp(
          (CAR_RADIUS * 2 - distance) / 2 + 0.001,
          0,
          0.3,
        );
        a.x -= nx * correction;
        a.z -= nz * correction;
        b.x += nx * correction;
        b.z += nz * correction;
        const closing = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (closing < 0) {
          const impulse = -closing * 0.55;
          a.vx -= impulse * nx;
          a.vz -= impulse * nz;
          b.vx += impulse * nx;
          b.vz += impulse * nz;
        }
        a.collision = 1;
        b.collision = 1;
      }
    }
  }
  next = next.map((car, i) => {
    const before = cars[i];
    if (car.finishTick !== null || resetIds.has(car.id)) return car;
    const magnitude = Math.hypot(car.vx, car.vz);
    if (magnitude > MAX_SPEED) {
      car.vx *= MAX_SPEED / magnitude;
      car.vz *= MAX_SPEED / magnitude;
    }
    car = sweepCar(physical[i], car, track, 1.2);
    car = sweepCar(before, car, track, MAX_SPEED / TICK_RATE + 0.65);
    const distance = Math.hypot(car.x - before.x, car.z - before.z);
    const samples = Math.max(1, Math.ceil(distance / 0.5));
    let progress = before.progress;
    let px = before.x;
    let pz = before.z;
    const origin = nearestTrack(track, px, pz);
    const originProgress =
      origin.progress + Math.round(progress - origin.progress);
    let valid =
      origin.distance <= corridor(track) + 1e-6 &&
      Math.abs(originProgress - progress) * track.length < 0.5;
    let previousRoad = origin;
    for (let s = 1; valid && s <= samples; s++) {
      const x = before.x + ((car.x - before.x) * s) / samples;
      const z = before.z + ((car.z - before.z) * s) / samples;
      const road = nearestTrack(track, x, z);
      const projected = road.progress + Math.round(progress - road.progress);
      const movement = Math.hypot(x - px, z - pz);
      // Inside a sampled bend, the nearest projection can switch between its
      // adjacent segments. Allow that local geometric jump, not a distant branch.
      const cornerAllowance = Math.min(
        2,
        Math.max(road.distance, previousRoad.distance) *
          Math.abs(angle(road.yaw - previousRoad.yaw)) *
          1.2,
      );
      if (
        road.distance > corridor(track) + 1e-6 ||
        Math.abs(projected - progress) * track.length >
          movement * 1.8 + cornerAllowance + 0.08
      ) {
        valid = false;
        break;
      }
      progress = projected;
      px = x;
      pz = z;
      previousRoad = road;
    }
    let checkpoint = before.checkpoint;
    const gate = track.checkpoints[checkpoint];
    const gx = Math.sin(gate.yaw);
    const gz = Math.cos(gate.yaw);
    const from = (before.x - gate.x) * gx + (before.z - gate.z) * gz;
    const to = (car.x - gate.x) * gx + (car.z - gate.z) * gz;
    const gateProgress =
      checkpoint === 0
        ? car.lap
        : car.lap - 1 + nearestTrack(track, gate.x, gate.z).progress;
    const t = from <= 0 && to > 0 ? -from / (to - from) : -1;
    const lateral =
      (before.x + (car.x - before.x) * t - gate.x) * gz -
      (before.z + (car.z - before.z) * t - gate.z) * gx;
    const crossed =
      t >= 0 &&
      Math.abs(lateral) <= corridor(track) &&
      Math.abs(progress - gateProgress) * track.length < 3;
    if (!crossed && progress > gateProgress + 1 / track.length) valid = false;
    // Invalid moves never bank gates or timing. Reset is the only relocation,
    // and goes back to the last accepted gate without restarting the lap clock.
    if (!valid) return { ...before, vx: 0, vz: 0, speed: 0, collision: 1 };
    if (crossed) {
      if (checkpoint === 0) {
        // Lap times include only penalties earned in this lap; total race
        // results add cumulative penalties once, to the raw finish tick.
        const bookedPenalties =
          car.lapTimes.reduce((sum, time) => sum + time, 0) -
          (car.lapStartTick - startTick);
        const lapTicks = Math.max(
          1,
          tick - car.lapStartTick + car.penaltyTicks - bookedPenalties,
        );
        car = {
          ...car,
          lap: car.lap + 1,
          lapStartTick: tick,
          lastLapTicks: lapTicks,
          bestLapTicks:
            car.bestLapTicks === null
              ? lapTicks
              : Math.min(car.bestLapTicks, lapTicks),
          lapTimes: [...car.lapTimes, lapTicks],
        };
        if (car.lap > laps) {
          return {
            ...car,
            checkpoint: 1,
            progress: laps,
            finishTick: tick,
            vx: 0,
            vz: 0,
            speed: 0,
            drift: false,
          };
        }
      }
      checkpoint = (checkpoint + 1) % track.checkpoints.length;
    }
    return { ...car, progress, checkpoint };
  });
  return next;
}

function ahead(
  track: Track,
  road: ReturnType<typeof nearestTrack>,
  distance: number,
) {
  let x = road.x;
  let z = road.z;
  let index = (road.index + 1) % track.points.length;
  for (let i = 0; i <= track.points.length; i++) {
    const point = track.points[index];
    const length = Math.hypot(point.x - x, point.z - z);
    if (length >= distance && length > 0) {
      return {
        x: x + ((point.x - x) * distance) / length,
        z: z + ((point.z - z) * distance) / length,
      };
    }
    distance -= length;
    x = point.x;
    z = point.z;
    index = (index + 1) % track.points.length;
  }
  return { x, z };
}

export function botControls(
  car: CarState,
  track: Track,
  tick: number,
): Controls {
  if (car.finishTick !== null) return { ...NEUTRAL };
  const road = nearestTrack(track, car.x, car.z);
  const speed = Math.max(0, car.speed);
  const lookahead = 8 + speed * 0.48;
  const target = ahead(track, road, lookahead);
  const heading = angle(
    Math.atan2(target.x - car.x, target.z - car.z) - car.yaw,
  );
  const steering =
    Math.atan2(
      2 * 3.1 * Math.sin(heading),
      Math.max(3, Math.hypot(target.x - car.x, target.z - car.z)),
    ) / wheelAngle(speed);
  const wet = track.id === "harbor";
  let targetSpeed = wet ? 51 : 59;
  let a = { x: road.x, z: road.z };
  let b = ahead(track, road, 10);
  // Brake before the bend, accounting for the distance left to shed speed.
  for (let distance = 20; distance <= 40 + speed * 0.8; distance += 10) {
    const c = ahead(track, road, distance);
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const turn = Math.abs(
      angle(
        Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z),
      ),
    );
    const curvature = turn / Math.max(1, (ab + bc) / 2);
    const cornerSpeed = Math.sqrt(
      (wet ? 7.5 : 11) / Math.max(0.001, curvature),
    );
    targetSpeed = Math.min(
      targetSpeed,
      Math.sqrt(cornerSpeed ** 2 + 2 * 20 * Math.max(0, distance - 20)),
    );
    a = b;
    b = c;
  }
  targetSpeed *= clamp(1 - Math.abs(heading) * 0.45, 0.3, 1);
  if (road.distance > track.width * 0.32)
    targetSpeed = Math.min(targetSpeed, 22);
  const feedforward = (0.8 + 0.13 * speed + 0.003 * speed * speed) / 22;
  const stuck =
    Math.abs(car.speed) < 1 && tick - car.lapStartTick > 240 && tick % 240 < 2;
  return {
    throttle: clamp(feedforward + (targetSpeed - speed) * 0.25, 0, 1),
    steer: clamp(steering, -1, 1),
    brake: speed > targetSpeed + 2,
    drift: false,
    reset:
      (stuck ||
        road.distance > corridor(track) + 1 ||
        (Math.abs(heading) > 2 && speed < 4)) &&
      tick - car.lastResetTick >= RESET_COOLDOWN,
  };
}

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function rankCars(cars: CarState[]): CarState[] {
  return [...cars].sort((a, b) => {
    if (a.finishTick !== null && b.finishTick !== null) {
      return (
        a.finishTick + a.penaltyTicks - (b.finishTick + b.penaltyTicks) ||
        a.finishTick - b.finishTick ||
        compareIds(a.id, b.id)
      );
    }
    if (a.finishTick !== null) return -1;
    if (b.finishTick !== null) return 1;
    return (
      b.progress - a.progress ||
      a.penaltyTicks - b.penaltyTicks ||
      compareIds(a.id, b.id)
    );
  });
}

export function raceResults(
  cars: CarState[],
  players: Player[],
  startTick: number,
): RaceResult[] {
  return rankCars(cars).map((car, i) => ({
    id: car.id,
    name: players.find((player) => player.id === car.id)?.name ?? car.id,
    position: i + 1,
    timeTicks:
      car.finishTick === null
        ? null
        : car.finishTick - startTick + car.penaltyTicks,
    bestLapTicks: car.bestLapTicks,
    penaltyTicks: car.penaltyTicks,
    dnf: car.finishTick === null,
  }));
}
