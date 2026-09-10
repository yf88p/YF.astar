import { Quaternion, Vector3 } from 'three';

export interface ControlInput {
  throttle: number;
  pitch: number;
  roll: number;
  yaw: number;
}

export type FlightMode = 'angle' | 'acro';

export interface Obstacle {
  min: Vector3;
  max: Vector3;
}

export interface FlightConfig {
  mass: number;
  gravity: number;
  radius: number;
  armLength: number;
  inertia: Vector3;
  maxThrustPerMotor: number;
  motorTimeConstant: number;
  yawTorqueCoefficient: number;
  linearDrag: number;
  quadraticDrag: number;
  angularDrag: number;
  angularQuadraticDrag: number;
  maxRate: number;
  maxYawRate: number;
  maxTilt: number;
  angleGain: number;
  rateKp: number;
  rateKd: number;
  derivativeFilterTime: number;
  maxAngularAcceleration: number;
  restitution: number;
  friction: number;
  contactAngularDamping: number;
  crashSpeed: number;
  batteryCells: number;
  batteryCapacityMah: number;
  batteryResistance: number;
  motorMaxCurrent: number;
  idleCurrent: number;
  armedIdleCurrent: number;
}

export interface FlightTelemetry {
  speed: number;
  altitude: number;
  verticalSpeed: number;
  batteryVoltage: number;
  flightTime: number;
  distance: number;
  current: number;
  motorOutputs: number[];
}

export const FIXED_DT = 1 / 240;

// SI throughout (radians, kg, N, N*m, kg*m^2), except charge in mAh.
// Motor outputs are normalized THRUST, not RPM; hover = mg / (4 * maxThrustPerMotor).
export const DEFAULT_CONFIG: Readonly<FlightConfig> = Object.freeze({
  mass: 0.65,
  gravity: 9.81,
  radius: 0.18,
  armLength: 0.17,
  inertia: Object.freeze(new Vector3(0.003, 0.005, 0.003)),
  maxThrustPerMotor: 5.5,
  motorTimeConstant: 0.035,
  yawTorqueCoefficient: 0.018, // Reaction torque / thrust, in metres.
  linearDrag: 0.08, // kg/s, relative to wind.
  quadraticDrag: 0.025, // kg/m, relative to wind.
  angularDrag: 0.0015, // N*m*s, body frame.
  angularQuadraticDrag: 0.0001,
  maxRate: 9,
  maxYawRate: 5,
  maxTilt: 0.85,
  angleGain: 5,
  rateKp: 18,
  rateKd: 0.12,
  derivativeFilterTime: 0.02,
  maxAngularAcceleration: 160,
  restitution: 0.12,
  friction: 0.65,
  contactAngularDamping: 8,
  crashSpeed: 6,
  batteryCells: 4,
  batteryCapacityMah: 1500,
  batteryResistance: 0.035,
  motorMaxCurrent: 18,
  idleCurrent: 0.3,
  armedIdleCurrent: 1.2,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const stick = (value: number, min = -1) => Number.isFinite(value) ? clamp(value, min, 1) : 0;
const UP = new Vector3(0, 1, 0);

export class FlightPhysics {
  public readonly position = new Vector3(0, 0.2, 24);
  public readonly velocity = new Vector3();
  // Body: +x right, +y up, -z forward. Quaternion maps body to world.
  public readonly orientation = new Quaternion();
  public readonly angularVelocity = new Vector3(); // BODY rad/s.
  // X layout: front-left, front-right, rear-right, rear-left. Yaw signs +,-,+,-.
  public readonly motors: number[] = [0, 0, 0, 0];
  public armed = false;
  public crashed = false;
  public mode: FlightMode = 'angle';
  public readonly wind = new Vector3();
  public maxImpact = 0;
  public batteryVoltage: number;
  public consumedMah = 0;
  public flightTime = 0; // Accumulated armed time, not wall-clock time.
  public readonly config: FlightConfig;

  private obstacles: Obstacle[] = [];
  private distance = 0;
  private current: number;
  private readonly previousRate = new Vector3();
  private readonly rateDerivative = new Vector3();
  private readonly desiredRate = new Vector3();
  private readonly torque = new Vector3();
  private readonly acceleration = new Vector3();
  private readonly midpointRate = new Vector3();
  private readonly bodyUp = new Vector3();
  private readonly targetUp = new Vector3();
  private readonly forward = new Vector3();
  private readonly relativeVelocity = new Vector3();
  private readonly normal = new Vector3();
  private readonly closest = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly inverseOrientation = new Quaternion();
  private readonly motorTargets = [0, 0, 0, 0];

  constructor(overrides: Partial<FlightConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...overrides, inertia: (overrides.inertia ?? DEFAULT_CONFIG.inertia).clone() };
    const c = this.config;
    for (const [key, value] of Object.entries(c)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
        throw new RangeError(`Invalid physics config: ${key}`);
      }
    }
    for (const value of [c.mass, c.radius, c.armLength, c.maxThrustPerMotor,
      c.yawTorqueCoefficient, c.derivativeFilterTime, c.batteryCells, c.batteryCapacityMah,
      c.inertia.x, c.inertia.y, c.inertia.z]) {
      if (!Number.isFinite(value) || value <= 0) throw new RangeError('Physical scales must be positive');
    }
    if (c.restitution > 1 || c.maxTilt >= Math.PI / 2) throw new RangeError('Invalid restitution or maxTilt');
    this.current = c.idleCurrent;
    this.batteryVoltage = c.batteryCells * 4.2;
  }

  public arm(): boolean {
    if (this.crashed) return false;
    this.armed = true;
    this.previousRate.copy(this.angularVelocity);
    this.rateDerivative.set(0, 0, 0);
    return true;
  }

  public disarm(): void {
    this.armed = false;
    // Immediate safety cutoff; motor lag applies while armed, not after a crash.
    this.motors.fill(0);
    this.rateDerivative.set(0, 0, 0);
    this.previousRate.copy(this.angularVelocity);
  }

  public reset(position?: Vector3): void {
    this.position.copy(position ?? new Vector3(0, 0.2, 24));
    this.velocity.set(0, 0, 0);
    this.orientation.identity();
    this.angularVelocity.set(0, 0, 0);
    this.crashed = false;
    this.disarm();
    this.maxImpact = 0;
    this.consumedMah = 0;
    this.flightTime = 0;
    this.distance = 0;
    this.current = this.config.idleCurrent;
    this.batteryVoltage = this.config.batteryCells * 4.2;
    // Keep the selected mode, world wind, obstacles, and vehicle configuration.
  }

  public setObstacles(obstacles: Obstacle[]): void {
    this.obstacles = obstacles.map(({ min, max }) => {
      if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)
        || min.x > max.x || min.y > max.y || min.z > max.z) {
        throw new RangeError('Invalid obstacle bounds');
      }
      return { min: min.clone(), max: max.clone() };
    });
  }

  public get telemetry(): FlightTelemetry {
    return {
      speed: this.velocity.length(),
      altitude: this.position.y, // Centre height above y=0; resting altitude is radius.
      verticalSpeed: this.velocity.y,
      batteryVoltage: this.batteryVoltage,
      flightTime: this.flightTime,
      distance: this.distance,
      current: this.current,
      motorOutputs: [...this.motors],
    };
  }

  public step(input: ControlInput, dt = FIXED_DT): void {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
    if (dt === 0) return;
    const controls = { throttle: stick(input.throttle, 0), pitch: stick(input.pitch), roll: stick(input.roll), yaw: stick(input.yaw) };
    // Never integrate a large render delta directly. No elapsed time is discarded.
    const steps = Math.ceil(dt / FIXED_DT);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.integrate(controls, h);
  }

  private integrate(input: ControlInput, dt: number): void {
    const c = this.config;
    this.orientation.normalize();
    if (this.crashed && this.armed) this.disarm();
    if (this.armed) {
      this.control(input, dt);
      this.flightTime += dt;
    } else {
      this.motorTargets.fill(0);
    }
    const motorAlpha = c.motorTimeConstant === 0 ? 1 : -Math.expm1(-dt / c.motorTimeConstant);
    for (let i = 0; i < 4; i++) this.motors[i] += (this.motorTargets[i] - this.motors[i]) * motorAlpha;

    const [fl, fr, rr, rl] = this.motors;
    const lever = c.armLength / Math.SQRT2;
    this.torque.set(
      lever * c.maxThrustPerMotor * (fl + fr - rr - rl),
      c.yawTorqueCoefficient * c.maxThrustPerMotor * (fl - fr + rr - rl),
      lever * c.maxThrustPerMotor * (-fl + fr + rr - rl),
    );
    // Euler's rigid-body equation in principal body axes, integrated at midpoint.
    this.angularAcceleration(this.angularVelocity, this.acceleration);
    this.midpointRate.copy(this.angularVelocity).addScaledVector(this.acceleration, dt / 2);
    this.angularAcceleration(this.midpointRate, this.acceleration);
    this.angularVelocity.addScaledVector(this.acceleration, dt);
    const rate = this.midpointRate.length();
    if (rate > 1e-12) {
      this.rotation.setFromAxisAngle(this.normal.copy(this.midpointRate).divideScalar(rate), rate * dt);
      this.orientation.multiply(this.rotation).normalize();
    }

    const thrust = (fl + fr + rr + rl) * c.maxThrustPerMotor;
    this.bodyUp.copy(UP).applyQuaternion(this.orientation);
    this.velocity.addScaledVector(this.bodyUp, thrust / c.mass * dt);
    this.velocity.y -= c.gravity * dt;
    // Exact isolated linear + quadratic drag decay avoids drag-induced sign flips.
    this.relativeVelocity.copy(this.velocity).sub(this.wind);
    const speed = this.relativeVelocity.length();
    const a = c.linearDrag / c.mass;
    const b = c.quadraticDrag / c.mass;
    const decay = Math.exp(-a * dt);
    const factor = a > 0 ? decay / (1 + b / a * speed * -Math.expm1(-a * dt)) : 1 / (1 + b * speed * dt);
    this.velocity.copy(this.wind).addScaledVector(this.relativeVelocity, factor);

    // Collision-only movement subdivisions reduce tunneling through thin AABBs.
    const moves = Math.max(1, Math.ceil(this.velocity.length() * dt / (c.radius * 0.5)));
    for (let i = 0; i < moves; i++) {
      const moveDt = dt / moves;
      this.position.addScaledVector(this.velocity, moveDt);
      this.collide(moveDt);
      // Integrate resolved speed, not the attempted penetration of a resting contact.
      this.distance += this.velocity.length() * moveDt;
    }

    // Illustrative LiPo model: current ~ thrust^1.5, linear state-of-charge OCV,
    // and pack I*R sag. Not a calibrated fuel gauge; voltage does not limit thrust.
    this.current = this.armed ? c.armedIdleCurrent : c.idleCurrent;
    for (const motor of this.motors) this.current += c.motorMaxCurrent * motor ** 1.5;
    this.consumedMah += this.current * dt / 3.6;
    const charge = clamp(1 - this.consumedMah / c.batteryCapacityMah, 0, 1);
    this.batteryVoltage = Math.max(c.batteryCells * 3, c.batteryCells * (3.3 + 0.9 * charge) - this.current * c.batteryResistance);
  }

  private control(input: ControlInput, dt: number): void {
    const c = this.config;
    // Positive sticks: nose down (-x), nose right (-y), right lean (-z).
    this.desiredRate.set(-input.pitch * c.maxRate, -input.yaw * c.maxYawRate, -input.roll * c.maxRate);
    if (this.mode === 'angle') {
      this.forward.set(0, 0, -1).applyQuaternion(this.orientation);
      let heading = Math.atan2(-this.forward.x, -this.forward.z);
      if (Math.hypot(this.forward.x, this.forward.z) < 1e-6) {
        this.forward.set(1, 0, 0).applyQuaternion(this.orientation);
        heading = Math.atan2(-this.forward.z, this.forward.x);
      }
      const amount = Math.hypot(input.pitch, input.roll);
      const tilt = Math.min(1, amount) * c.maxTilt;
      const scale = amount > 0 ? Math.sin(tilt) / amount : 0;
      this.targetUp.set(input.roll * scale, Math.cos(tilt), -input.pitch * scale)
        .applyAxisAngle(UP, heading);
      this.bodyUp.copy(UP).applyQuaternion(this.orientation);
      this.normal.crossVectors(this.bodyUp, this.targetUp);
      const sine = this.normal.length();
      const cosine = clamp(this.bodyUp.dot(this.targetUp), -1, 1);
      if (sine > 1e-8) this.normal.multiplyScalar(Math.atan2(sine, cosine) / sine);
      else if (cosine < 0) this.normal.set(Math.PI, 0, 0).applyQuaternion(this.orientation);
      else this.normal.set(0, 0, 0);
      this.inverseOrientation.copy(this.orientation).invert();
      this.normal.applyQuaternion(this.inverseOrientation);
      this.desiredRate.x = clamp(c.angleGain * this.normal.x, -c.maxRate, c.maxRate);
      this.desiredRate.z = clamp(c.angleGain * this.normal.z, -c.maxRate, c.maxRate);
    }

    this.acceleration.copy(this.angularVelocity).sub(this.previousRate).divideScalar(dt);
    this.rateDerivative.lerp(this.acceleration, -Math.expm1(-dt / c.derivativeFilterTime));
    this.previousRate.copy(this.angularVelocity);
    // PD on rates (D on measurement). No integral state means no saturation windup.
    this.torque.copy(this.desiredRate).sub(this.angularVelocity).multiplyScalar(c.rateKp)
      .addScaledVector(this.rateDerivative, -c.rateKd);
    this.torque.set(
      clamp(this.torque.x, -c.maxAngularAcceleration, c.maxAngularAcceleration) * c.inertia.x,
      clamp(this.torque.y, -c.maxAngularAcceleration, c.maxAngularAcceleration) * c.inertia.y,
      clamp(this.torque.z, -c.maxAngularAcceleration, c.maxAngularAcceleration) * c.inertia.z,
    );
    const pitch = this.torque.x / (4 * c.armLength / Math.SQRT2 * c.maxThrustPerMotor);
    const yaw = this.torque.y / (4 * c.yawTorqueCoefficient * c.maxThrustPerMotor);
    const roll = this.torque.z / (4 * c.armLength / Math.SQRT2 * c.maxThrustPerMotor);
    this.motorTargets[0] = pitch + yaw - roll;
    this.motorTargets[1] = pitch - yaw + roll;
    this.motorTargets[2] = -pitch + yaw + roll;
    this.motorTargets[3] = -pitch - yaw - roll;
    // Scale the whole differential to preserve torque direction. Reduce collective
    // at the upper rail to retain steering, but never add hidden lift at low throttle.
    const low = Math.min(...this.motorTargets);
    const high = Math.max(...this.motorTargets);
    const scale = high > low ? Math.min(1, 1 / (high - low), input.throttle / -low) : 1;
    const collective = Math.min(input.throttle, 1 - high * scale);
    for (let i = 0; i < 4; i++) this.motorTargets[i] = clamp(collective + this.motorTargets[i] * scale, 0, 1);
  }

  private angularAcceleration(rate: Vector3, result: Vector3): void {
    const c = this.config;
    const i = c.inertia;
    const drag = c.angularDrag + c.angularQuadraticDrag * rate.length();
    result.set(
      (this.torque.x - (i.z - i.y) * rate.y * rate.z - drag * rate.x) / i.x,
      (this.torque.y - (i.x - i.z) * rate.z * rate.x - drag * rate.y) / i.y,
      (this.torque.z - (i.y - i.x) * rate.x * rate.y - drag * rate.z) / i.z,
    );
  }

  private collide(dt: number): void {
    const r = this.config.radius;
    // Multiple passes handle adjacent surfaces, with a deterministic obstacle order.
    for (let pass = 0; pass < 4; pass++) {
      if (this.position.y <= r) this.contact(UP, r - this.position.y, dt);
      for (const { min, max } of this.obstacles) {
        this.closest.copy(this.position).clamp(min, max);
        this.normal.copy(this.position).sub(this.closest);
        const distance = this.normal.length();
        if (distance >= r) continue;
        const correctedY = distance > 1e-9 ? this.position.y + this.normal.y * (r - distance) / distance : -Infinity;
        if (distance > 1e-9 && correctedY >= r - 1e-9) {
          this.normal.divideScalar(distance);
          this.contact(this.normal, r - distance, dt);
        } else {
          // Inside/on the box, or wedged against ground: choose the shortest valid
          // exit, preferring the top on ties. Never depenetrate below the ground.
          let depth = max.y + r - this.position.y;
          this.normal.set(0, 1, 0);
          const exits = [
            [this.position.x - min.x + r, -1, 0, 0],
            [max.x - this.position.x + r, 1, 0, 0],
            [this.position.z - min.z + r, 0, 0, -1],
            [max.z - this.position.z + r, 0, 0, 1],
            [min.y >= 2 * r ? this.position.y - min.y + r : Infinity, 0, -1, 0],
          ];
          for (const [candidate, x, y, z] of exits) {
            if (candidate < depth) {
              depth = candidate;
              this.normal.set(x, y, z);
            }
          }
          this.contact(this.normal, depth, dt);
        }
      }
    }
    if (this.position.y < r) this.contact(UP, r - this.position.y, dt);
  }

  private contact(normal: Vector3, penetration: number, dt: number): void {
    const c = this.config;
    this.position.addScaledVector(normal, penetration);
    const normalSpeed = this.velocity.dot(normal);
    if (normalSpeed >= 0) return;
    const impact = -normalSpeed;
    this.maxImpact = Math.max(this.maxImpact, impact);
    if (impact > c.crashSpeed) {
      this.crashed = true;
      this.disarm();
    }
    const bounce = impact > 0.5 ? c.restitution : 0;
    const impulse = (1 + bounce) * impact; // Impulse / mass, in m/s.
    this.velocity.addScaledVector(normal, impulse);
    this.relativeVelocity.copy(this.velocity).addScaledVector(normal, -this.velocity.dot(normal));
    const tangentSpeed = this.relativeVelocity.length();
    if (tangentSpeed > 0) this.velocity.addScaledVector(this.relativeVelocity, -Math.min(1, c.friction * impulse / tangentSpeed));
    // Spherical contact has no normal torque; approximate surface rotational loss.
    this.angularVelocity.multiplyScalar(Math.exp(-c.contactAngularDamping * dt));
  }
}
