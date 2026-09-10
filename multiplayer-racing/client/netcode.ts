import {
  MAX_PLAYERS,
  TICK_RATE,
  type CarState,
  type Controls,
  type InputCommand,
  type Snapshot,
} from "../shared/protocol";
import { stepCar } from "../shared/simulation";
import type { Track } from "../shared/tracks";

const TICK_MS = 1000 / TICK_RATE;
const INTERPOLATION_MS = 100;
const EXTRAPOLATION_MS = 100;
const CORRECTION_SECONDS = 0.12;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const copyCar = (car: CarState): CarState => ({
  ...car,
  lapTimes: [...car.lapTimes],
});

// Only the pose is interpolated; collision, velocity, and race data stay authoritative.
export function interpolateCar(
  a: CarState,
  b: CarState,
  alpha: number,
): CarState {
  const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
  return {
    ...copyCar(b),
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: wrap(a.yaw + wrap(b.yaw - a.yaw) * t),
  };
}

export class Prediction {
  car: CarState | null = null;
  pending: InputCommand[] = [];
  nextSeq = 0;

  private ack = -1;
  private correction = { x: 0, z: 0, yaw: 0 };
  private correctionTime = 0;

  reset(car: CarState | null, ack = -1): void {
    this.car = car ? copyCar(car) : null;
    this.pending = [];
    this.ack = ack;
    this.nextSeq = ack + 1;
    this.correctionTime = 0;
  }

  // Call once per fixed simulation tick, including countdown ticks.
  predict(
    controls: Controls,
    track: Track,
    clientTime: number,
    active: boolean,
  ): InputCommand {
    const command: InputCommand = {
      seq: this.nextSeq++,
      clientTime,
      controls: { ...controls },
    };
    this.pending.push(command);
    if (this.pending.length > 120)
      this.pending.splice(0, this.pending.length - 120);
    if (active && this.car)
      this.car = stepCar(this.car, command.controls, track, 1 / TICK_RATE);
    return command;
  }

  reconcile(
    authoritative: CarState,
    ack: number,
    track: Track,
    active: boolean,
  ): void {
    if (ack < this.ack) return;
    const previous = this.render(0);
    this.ack = ack;
    this.nextSeq = Math.max(this.nextSeq, ack + 1);
    this.pending = this.pending.filter((command) => command.seq > ack);
    this.car = copyCar(authoritative);
    if (active) {
      for (const command of this.pending)
        this.car = stepCar(this.car, command.controls, track, 1 / TICK_RATE);
    }

    this.correctionTime = 0;
    if (
      active &&
      previous &&
      previous.id === authoritative.id &&
      previous.resets === authoritative.resets &&
      previous.lastResetTick === authoritative.lastResetTick &&
      previous.finishTick === authoritative.finishTick &&
      Math.hypot(previous.x - this.car.x, previous.z - this.car.z) < 8
    ) {
      this.correction = {
        x: previous.x - this.car.x,
        z: previous.z - this.car.z,
        yaw: wrap(previous.yaw - this.car.yaw),
      };
      this.correctionTime = CORRECTION_SECONDS;
    }
  }

  // dt is seconds. The visual correction never feeds back into physics or replay.
  render(dt: number): CarState | null {
    if (!this.car) return null;
    if (Number.isFinite(dt) && dt > 0)
      this.correctionTime = Math.max(0, this.correctionTime - dt);
    const weight = this.correctionTime / CORRECTION_SECONDS;
    return {
      ...copyCar(this.car),
      x: this.car.x + this.correction.x * weight,
      z: this.car.z + this.correction.z * weight,
      yaw: wrap(this.car.yaw + this.correction.yaw * weight),
    };
  }
}

export class SnapshotBuffer {
  latest: Snapshot | null = null;

  private frames: { snapshot: Snapshot; time: number; receivedAt: number }[] =
    [];
  private clockOffset = 0;
  private sampleTime = -Infinity;

  // receivedAt and sample(now) use the same monotonic millisecond clock, not serverTime.
  push(snapshot: Snapshot, receivedAt: number): boolean {
    const previous = this.frames.at(-1);
    if (
      !Number.isSafeInteger(snapshot.tick) ||
      snapshot.tick < 0 ||
      !Number.isFinite(receivedAt) ||
      snapshot.cars.length > MAX_PLAYERS ||
      (this.latest && snapshot.tick <= this.latest.tick) ||
      (previous && receivedAt < previous.receivedAt)
    )
      return false;

    const time = snapshot.tick * TICK_MS;
    const offset = receivedAt - time;
    // A paused server drops wall-clock backlog. Re-anchor instead of extrapolating forever.
    if (
      !previous ||
      receivedAt - previous.receivedAt - (time - previous.time) > 250
    ) {
      this.frames = [];
      this.clockOffset = offset;
    }
    this.latest = {
      ...snapshot,
      cars: snapshot.cars.map(copyCar),
      ack: { ...snapshot.ack },
      results: snapshot.results.map((result) => ({ ...result })),
    };
    this.frames.push({ snapshot: this.latest, time, receivedAt });
    if (this.frames.length > 8) this.frames.shift();

    // A rolling low-delay estimate rejects jitter and gradually adapts to clock drift.
    const bestOffset = Math.min(
      ...this.frames.map((frame) => frame.receivedAt - frame.time),
    );
    this.clockOffset +=
      (bestOffset - this.clockOffset) *
      (bestOffset < this.clockOffset ? 1 : 0.1);
    return true;
  }

  sample(now: number): CarState[] {
    const first = this.frames[0];
    const last = this.frames.at(-1);
    if (!first || !last || !Number.isFinite(now)) return [];
    this.sampleTime = Math.max(
      first.time,
      this.sampleTime,
      Math.min(
        now - this.clockOffset - INTERPOLATION_MS,
        last.time + EXTRAPOLATION_MS,
      ),
    );

    for (let i = 1; i < this.frames.length; i++) {
      const a = this.frames[i - 1];
      const b = this.frames[i];
      if (this.sampleTime >= b.time) continue;
      const alpha = (this.sampleTime - a.time) / (b.time - a.time);
      return a.snapshot.cars.map((car) => {
        const next = b.snapshot.cars.find(
          (candidate) => candidate.id === car.id,
        );
        // Hold the old pose until a reset/teleport tick; never draw a path across the circuit.
        if (
          !next ||
          car.resets !== next.resets ||
          car.lastResetTick !== next.lastResetTick ||
          Math.hypot(next.x - car.x, next.z - car.z) >
            (70 * (b.time - a.time)) / 1000 + 8 ||
          (a.snapshot.state === "countdown" &&
            this.sampleTime < b.snapshot.startTick * TICK_MS)
        ) {
          return copyCar(car);
        }
        return interpolateCar(car, next, alpha);
      });
    }

    const dt =
      Math.max(0, Math.min(EXTRAPOLATION_MS, this.sampleTime - last.time)) /
      1000;
    return last.snapshot.cars.map((car) => {
      const result = copyCar(car);
      if (
        last.snapshot.state === "racing" &&
        last.snapshot.tick >= last.snapshot.startTick &&
        car.finishTick === null
      ) {
        result.x += car.vx * dt;
        result.z += car.vz * dt;
      }
      return result;
    });
  }

  clear(): void {
    this.latest = null;
    this.frames = [];
    this.clockOffset = 0;
    this.sampleTime = -Infinity;
  }
}
