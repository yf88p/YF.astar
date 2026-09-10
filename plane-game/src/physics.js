import { Euler, Quaternion, Vector3 } from "three";

const G = 9.80665;
const DEG = Math.PI / 180;
const CLEARANCE = 1.65;
const STEP = 1 / 120;
const EMPTY = Object.freeze({});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteVector = (v) =>
  v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const finiteQuaternion = (q) =>
  finiteVector(q) && Number.isFinite(q.w) && q.lengthSq() > 1e-12;
const defaultTerrain = () => 18;

// ISA troposphere and lower stratosphere, continued exponentially above 20 km.
// The continuation keeps density positive without imposing an altitude ceiling.
function airDensity(altitude) {
  const h = Math.max(-2000, altitude);
  if (h < 11000) return 1.225 * Math.pow(1 - (0.0065 * h) / 288.15, 4.25588);
  return 0.363918 * Math.exp(-(h - 11000) / 6341.62);
}

const common = {
  propEfficiency: 0.78,
  engineResponse: 1.1,
  maxEngineRPM: 2700,
  liftSlope: 5,
  zeroLift: 0.25,
  stallAngle: 15 * DEG,
  flapLift: 0.65,
  flapDrag: 0.065,
  oswaldEfficiency: 0.8,
  pitchStability: 1.05,
  pitchAuthority: 0.36,
  pitchDamping: 18,
  rollAuthority: 0.05,
  rollDamping: 0.55,
  dihedral: 0.055,
  yawAuthority: 0.035,
  yawStability: 0.16,
  yawDamping: 0.24,
  sideForceSlope: 0.7,
  controlResponse: 0.16,
  gearOffset: 0.14,
};

// SI throughout; inertias are about body X (pitch), Y (yaw), Z (roll).
export const AIRCRAFT = Object.freeze({
  trainer: Object.freeze({
    ...common,
    name: "Trainer",
    label: "Trainer 172",
    mass: 1050,
    wingArea: 16.2,
    wingSpan: 10.9,
    maxPower: 134000,
    inertia: Object.freeze({ x: 1750, y: 2400, z: 1350 }),
    propDiskArea: 2.6,
    dragCoefficient: 0.0335,
    trimSpeed: 48,
  }),
  tourer: Object.freeze({
    ...common,
    name: "Tourer",
    label: "Tourer GT",
    mass: 1350,
    wingArea: 15.8,
    wingSpan: 11.6,
    maxPower: 230000,
    inertia: Object.freeze({ x: 2350, y: 3400, z: 2100 }),
    propDiskArea: 3.1,
    dragCoefficient: 0.0365,
    trimSpeed: 58,
    pitchAuthority: 0.33,
    rollAuthority: 0.045,
    controlResponse: 0.19,
  }),
  sport: Object.freeze({
    ...common,
    name: "Sport",
    label: "Sport S2",
    mass: 760,
    wingArea: 11,
    wingSpan: 8.2,
    maxPower: 194000,
    inertia: Object.freeze({ x: 1000, y: 1350, z: 700 }),
    propDiskArea: 2.4,
    dragCoefficient: 0.037,
    trimSpeed: 65,
    pitchStability: 0.85,
    pitchAuthority: 0.42,
    pitchDamping: 14,
    rollAuthority: 0.065,
    rollDamping: 0.45,
    dihedral: 0.028,
    controlResponse: 0.1,
    stallAngle: 16 * DEG,
  }),
});

/**
 * Fixed-wing rigid-body simulation. Body forward -Z, right +X, up +Y.
 * Quaternion maps body to world. Angular velocity uses right-hand body axes:
 * +X nose up, +Y nose left, +Z right wing up. Pilot roll/yaw inputs invert Z/Y.
 * update() accepts seconds, substeps at 120 Hz, and discards time above 0.1 s.
 */
export class FlightPhysics {
  constructor(options = {}) {
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.quaternion = new Quaternion();
    this.angularVelocity = new Vector3();
    this.controls = { pitch: 0, roll: 0, yaw: 0 };
    this.telemetry = {};
    this._wind = new Vector3();
    this._baseWind = new Vector3();
    this._air = new Vector3();
    this._bodyAir = new Vector3();
    this._force = new Vector3();
    this._right = new Vector3();
    this._up = new Vector3();
    this._forward = new Vector3();
    this._inverse = new Quaternion();
    this._rotation = new Quaternion();
    this._euler = new Euler(0, 0, 0, "YXZ");
    this._lastPosition = new Vector3();
    this._lastQuaternion = new Quaternion();
    this.reset(options);
  }

  reset({
    aircraft = "trainer",
    position = new Vector3(0, 300, 2000),
    heading = 0,
    speed = 48,
    onGround = false,
    terrainHeight = defaultTerrain,
    throttle = 0.65,
    flaps = 0,
    verticalSpeed = 0,
  } = {}) {
    this.aircraftId = Object.hasOwn(AIRCRAFT, aircraft) ? aircraft : "trainer";
    this.aircraft = AIRCRAFT[this.aircraftId];
    this.terrainHeight =
      typeof terrainHeight === "function" ? terrainHeight : defaultTerrain;
    this.position.copy(
      finiteVector(position) ? position : { x: 0, y: 300, z: 2000 },
    );
    heading = Number.isFinite(heading) ? heading % (2 * Math.PI) : 0;
    speed = Number.isFinite(speed) ? clamp(speed, 0, 350) : 48;
    this.onGround = Boolean(onGround);
    if (this.onGround) this.position.y = this._groundHeight() + CLEARANCE;
    this.throttle = this._spool = Number.isFinite(throttle)
      ? clamp(throttle, 0, 1)
      : 0.65;
    this.flaps = this._flapPosition = Number.isFinite(flaps)
      ? clamp(flaps, 0, 1)
      : 0;
    // Reset speed is total still-air speed; verticalSpeed is its world-Y component.
    // Start with settled engine/flaps and a lift-balanced attitude, not an autopilot.
    verticalSpeed =
      !this.onGround && Number.isFinite(verticalSpeed)
        ? clamp(verticalSpeed, -speed, speed)
        : 0;
    const horizontalSpeed = Math.sqrt(
      Math.max(0, speed * speed - verticalSpeed * verticalSpeed),
    );
    const flightPath = Math.atan2(verticalSpeed, horizontalSpeed);
    const a = this.aircraft;
    this._chord = a.wingArea / a.wingSpan;
    this._inducedDrag =
      1 / (Math.PI * (a.wingSpan ** 2 / a.wingArea) * a.oswaldEfficiency);
    this._trimAlpha =
      ((a.mass * G) / (0.5 * airDensity(300) * a.trimSpeed ** 2 * a.wingArea) -
        a.zeroLift) /
      a.liftSlope;
    const startAlpha = this.onGround
      ? 0
      : clamp(
          ((a.mass * G * Math.cos(flightPath)) /
            Math.max(
              1,
              0.5 * airDensity(this.position.y) * speed ** 2 * a.wingArea,
            ) -
            a.zeroLift -
            a.flapLift * this.flaps) /
            a.liftSlope,
          -4 * DEG,
          12 * DEG,
        );
    this.quaternion.setFromEuler(
      this._euler.set(startAlpha + flightPath, -heading, 0, "YXZ"),
    );
    this.velocity.set(
      Math.sin(heading) * horizontalSpeed,
      verticalSpeed,
      -Math.cos(heading) * horizontalSpeed,
    );
    this.angularVelocity.set(0, 0, 0);
    this.controls.pitch = this.controls.roll = this.controls.yaw = 0;
    this.brakes = false;
    this.crashed = false;
    this.crashReason = "";
    this._time = 0;
    this._gForce = this.onGround ? 1 : 0;
    this._thrust =
      this._lift =
      this._drag =
      this._liftCoefficient =
      this._separation =
        0;
    this._wind.set(0, 0, 0);
    this._baseWind.set(0, 0, 0);
    this._lastPosition.copy(this.position);
    this._lastQuaternion.copy(this.quaternion);
    this._updateTelemetry(airDensity(this.position.y));
    return this;
  }

  update(dt, controls = EMPTY, weather = EMPTY) {
    if (this.crashed) return this.telemetry;
    if (!this._validState()) {
      this.position.copy(this._lastPosition);
      this.quaternion.copy(this._lastQuaternion);
      this._crash("Invalid flight state");
      this._updateTelemetry(airDensity(this.position.y));
      return this.telemetry;
    }
    if (!Number.isFinite(dt) || dt <= 0) return this.telemetry;
    controls = controls || EMPTY;
    weather = weather || EMPTY;
    const pitch = Number.isFinite(controls.pitch)
      ? clamp(controls.pitch, -1, 1)
      : 0;
    const roll = Number.isFinite(controls.roll)
      ? clamp(controls.roll, -1, 1)
      : 0;
    const yaw = Number.isFinite(controls.yaw) ? clamp(controls.yaw, -1, 1) : 0;
    this.throttle = clamp(
      Number.isFinite(controls.throttle)
        ? controls.throttle
        : Number.isFinite(this.throttle)
          ? this.throttle
          : 0,
      0,
      1,
    );
    this.flaps = clamp(
      Number.isFinite(controls.flaps)
        ? controls.flaps
        : Number.isFinite(this.flaps)
          ? this.flaps
          : 0,
      0,
      1,
    );
    if (typeof controls.brakes === "boolean") this.brakes = controls.brakes;
    if (finiteVector(weather.wind)) this._baseWind.copy(weather.wind);
    else this._baseWind.set(0, 0, 0);
    this._baseWind.clampLength(0, 300);
    const turbulence = Number.isFinite(weather.turbulence)
      ? clamp(weather.turbulence, 0, 1)
      : 0;
    const density = Number.isFinite(weather.density)
      ? clamp(weather.density, 0, 10)
      : null;
    const duration = Math.min(dt, 0.1);
    const steps = Math.ceil(duration / STEP);
    const h = duration / steps;
    this.quaternion.normalize();
    for (let i = 0; i < steps && !this.crashed; i++) {
      this._lastPosition.copy(this.position);
      this._lastQuaternion.copy(this.quaternion);
      this._time += h;
      // Smooth deterministic gusts, not frame-rate-dependent white-noise forces.
      const t = this._time;
      this._wind.copy(this._baseWind);
      this._wind.x +=
        turbulence * (2.2 * Math.sin(t * 0.73) + 0.7 * Math.sin(t * 2.31));
      this._wind.y +=
        turbulence * (1.5 * Math.sin(t * 1.13) + 0.6 * Math.sin(t * 3.17));
      this._wind.z +=
        turbulence * (1.8 * Math.sin(t * 0.91) + 0.5 * Math.sin(t * 2.73));
      const response = 1 - Math.exp(-h / this.aircraft.controlResponse);
      this.controls.pitch += (pitch - this.controls.pitch) * response;
      this.controls.roll += (roll - this.controls.roll) * response;
      this.controls.yaw += (yaw - this.controls.yaw) * response;
      this._spool +=
        (this.throttle - this._spool) *
        (1 - Math.exp(-h / this.aircraft.engineResponse));
      this._flapPosition +=
        (this.flaps - this._flapPosition) * (1 - Math.exp(-h / 0.8));
      this._step(h, density ?? airDensity(this.position.y));
      if (!this._validState()) {
        this.position.copy(this._lastPosition);
        this.quaternion.copy(this._lastQuaternion);
        this._crash("Invalid flight state");
      }
    }
    this._updateTelemetry(density ?? airDensity(this.position.y));
    return this.telemetry;
  }

  _groundHeight() {
    const height = this.terrainHeight(this.position.x, this.position.z);
    return Number.isFinite(height) ? height : 18;
  }

  _onRunway(height) {
    return (
      Math.abs(this.position.x) <= 30 &&
      Math.abs(this.position.z) <= 850 &&
      Math.abs(height - 18) < 0.5
    );
  }

  _validState() {
    return (
      finiteVector(this.position) &&
      finiteVector(this.velocity) &&
      finiteVector(this.angularVelocity) &&
      finiteQuaternion(this.quaternion) &&
      this.velocity.lengthSq() < 1e8 &&
      this.angularVelocity.lengthSq() < 1e6
    );
  }

  _crash(reason) {
    this.crashed = true;
    this.crashReason = reason;
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this._gForce = 0;
  }

  _step(h, rho) {
    const a = this.aircraft;
    const ground = this._groundHeight();
    const height = Math.max(0, this.position.y - ground);
    const supported = this.onGround && height <= CLEARANCE + 0.06;
    const runway = this._onRunway(ground);
    this._inverse.copy(this.quaternion).conjugate();
    this._air.copy(this.velocity).sub(this._wind);
    this._bodyAir.copy(this._air).applyQuaternion(this._inverse);
    const vx = this._bodyAir.x;
    const vy = this._bodyAir.y;
    const forwardSpeed = -this._bodyAir.z;
    const speed = this._air.length();
    const wingSpeed = Math.hypot(vy, forwardSpeed);
    const alpha = wingSpeed > 0.1 ? Math.atan2(-vy, forwardSpeed) : 0;
    const beta = speed > 0.1 ? Math.atan2(vx, Math.max(0.1, wingSpeed)) : 0;
    const q = 0.5 * rho * speed * speed;
    const qWing = 0.5 * rho * wingSpeed * wingSpeed;
    const flap = this._flapPosition;
    const stallAngle = a.stallAngle - 2 * DEG * flap;
    const blend = clamp(
      (Math.abs(alpha) - (stallAngle - 3 * DEG)) / (11 * DEG),
      0,
      1,
    );
    const separation = blend * blend * (3 - 2 * blend);
    const attachedLift = a.zeroLift + a.liftSlope * alpha + a.flapLift * flap;
    const cl =
      attachedLift * (1 - separation) + 1.1 * Math.sin(2 * alpha) * separation;
    const groundEffect = Math.exp((-4 * height) / a.wingSpan);
    const lift = qWing * a.wingArea * cl * (1 + 0.06 * groundEffect);
    const cd =
      a.dragCoefficient +
      a.flapDrag * flap +
      this._inducedDrag * cl * cl * (1 - 0.42 * groundEffect) +
      separation * (0.08 + 1.1 * Math.sin(alpha) ** 2) +
      0.8 * Math.max(0, -Math.cos(alpha));
    const drag = q * a.wingArea * cd;

    // Actuator-disk static thrust limit joins P/V at cruise, without a V=0 singularity.
    const power =
      a.maxPower *
      this._spool ** 1.5 *
      a.propEfficiency *
      Math.min(1.1, rho / 1.225) ** 0.85;
    const inducedSpeed =
      rho > 0 ? Math.cbrt(power / (2 * rho * a.propDiskArea)) : 0;
    const thrust =
      power / Math.max(1, Math.hypot(Math.max(0, forwardSpeed), inducedSpeed));
    const propwash = thrust / a.propDiskArea;
    const controlQ = Math.min(q, 0.5 * rho * (a.trimSpeed * 1.5) ** 2);
    const elevatorQ = controlQ + 0.1 * propwash;
    const rudderQ = controlQ + 0.28 * propwash;
    const authority = 1 - 0.65 * separation;
    const sideForce =
      -q * a.wingArea * a.sideForceSlope * beta -
      rudderQ * a.wingArea * 0.07 * this.controls.yaw;
    this._force
      .copy(this._bodyAir)
      .multiplyScalar(speed > 0.01 ? -drag / speed : 0);
    this._force.x += sideForce;
    if (wingSpeed > 0.01) {
      // Lift is exactly perpendicular to airflow; banking redirects it, not heading.
      this._force.y += (lift * forwardSpeed) / wingSpeed;
      this._force.z += (lift * vy) / wingSpeed;
    }
    this._force.z -= thrust;
    this._force.applyQuaternion(this.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this._forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this._euler.setFromQuaternion(this.quaternion, "YXZ");

    const rates = this.angularVelocity;
    const rateSpeed = Math.max(12, speed);
    // At high incidence the tail still restores attitude, but does not generate
    // unbounded moments from the +/-pi discontinuity of reverse-flow AoA.
    const pitchError = clamp(this._trimAlpha - alpha - flap * 0.035, -0.7, 0.7);
    let mx =
      qWing *
        a.wingArea *
        this._chord *
        (a.pitchStability * pitchError * (1 - 0.45 * separation) -
          (a.pitchDamping * rates.x * this._chord) / (2 * rateSpeed)) +
      elevatorQ *
        a.wingArea *
        this._chord *
        a.pitchAuthority *
        this.controls.pitch *
        authority;
    let my =
      q *
        a.wingArea *
        a.wingSpan *
        (-a.yawStability * beta -
          (a.yawDamping * rates.y * a.wingSpan) / (2 * rateSpeed) +
          0.004 * this.controls.roll * authority) -
      rudderQ * a.wingArea * a.wingSpan * a.yawAuthority * this.controls.yaw;
    let mz =
      q *
        a.wingArea *
        a.wingSpan *
        (a.dihedral * beta -
          (a.rollDamping * rates.z * a.wingSpan) / (2 * rateSpeed)) -
      controlQ *
        a.wingArea *
        a.wingSpan *
        a.rollAuthority *
        this.controls.roll *
        authority;

    const normal = supported ? Math.max(0, a.mass * G - this._force.y) : 0;
    if (supported) {
      const support = normal / (a.mass * G);
      mx -= normal * a.gearOffset;
      mz -= a.inertia.z * (65 * this._euler.z + 12 * rates.z) * support;
      my -= a.inertia.y * rates.y * 2.5 * support;
      // Oppose the predicted wheel velocity, including thrust, so held brakes
      // resist starting from rest without creeping or reversing the wheel motion.
      const horizontal = Math.hypot(this._forward.x, this._forward.z);
      const fx = horizontal > 1e-6 ? this._forward.x / horizontal : 0;
      const fz = horizontal > 1e-6 ? this._forward.z / horizontal : -1;
      const nextVX = this.velocity.x + (this._force.x * h) / a.mass;
      const nextVZ = this.velocity.z + (this._force.z * h) / a.mass;
      const along = nextVX * fx + nextVZ * fz;
      const across = -nextVX * fz + nextVZ * fx;
      const rolling = (runway ? 0.022 : 0.075) + (this.brakes ? 0.48 : 0);
      const longitudinal =
        Math.sign(along) *
        Math.min(rolling * normal, (Math.abs(along) * a.mass) / h);
      const lateral =
        Math.sign(across) *
        Math.min(0.65 * normal, (Math.abs(across) * a.mass) / h);
      this._force.x += -longitudinal * fx + lateral * fz;
      this._force.z += -longitudinal * fz - lateral * fx;
      this._force.y += normal;
    }
    this._gForce = this._force.dot(this._up) / (a.mass * G);
    this._force.y -= a.mass * G;
    this.velocity.addScaledVector(this._force, h / a.mass);
    this.position.addScaledVector(this.velocity, h);

    // Euler's rigid-body equation, including gyroscopic coupling of unequal inertias.
    const { x: ix, y: iy, z: iz } = a.inertia;
    const wx = rates.x,
      wy = rates.y,
      wz = rates.z;
    rates.x += ((mx + (iy - iz) * wy * wz) * h) / ix;
    rates.y += ((my + (iz - ix) * wz * wx) * h) / iy;
    rates.z += ((mz + (ix - iy) * wx * wy) * h) / iz;
    // Numerical safety guard, well above normal handling rates (not an attitude limit).
    rates.clampLength(0, 6);
    const rate = rates.length();
    const halfAngle = 0.5 * rate * h;
    const scale = rate > 1e-9 ? Math.sin(halfAngle) / rate : 0.5 * h;
    this._rotation.set(
      rates.x * scale,
      rates.y * scale,
      rates.z * scale,
      Math.cos(halfAngle),
    );
    this.quaternion.multiply(this._rotation).normalize();
    if (supported) {
      this._euler.setFromQuaternion(this.quaternion, "YXZ");
      const groundPitch = clamp(this._euler.x, 0, 16 * DEG);
      if (groundPitch !== this._euler.x) {
        this._euler.x = groundPitch;
        this.quaternion.setFromEuler(this._euler);
        rates.x = 0;
      }
    }

    const nextGround = this._groundHeight();
    const floor = nextGround + CLEARANCE;
    const wasGrounded = this.onGround;
    this.onGround = false;
    if (this.position.y <= floor) {
      this.position.y = floor;
      this.onGround = true;
      this._euler.setFromQuaternion(this.quaternion, "YXZ");
      this._right.set(1, 0, 0).applyQuaternion(this.quaternion);
      const lateralSpeed = Math.abs(
        this.velocity.x * this._right.x + this.velocity.z * this._right.z,
      );
      const sink = -this.velocity.y;
      const rough = !this._onRunway(nextGround);
      if (sink > (rough ? 2.6 : 5.5)) this._crash("Hard landing");
      else if (lateralSpeed > (rough ? 5 : 8))
        this._crash("Sideways ground impact");
      else if (
        Math.abs(this._euler.z) > 21 * DEG ||
        this._euler.x < -8 * DEG ||
        this._euler.x > 24 * DEG
      )
        this._crash("Wing or fuselage ground strike");
      else if (rough && Math.hypot(this.velocity.x, this.velocity.z) > 24)
        this._crash("High-speed rough terrain impact");
      else this.velocity.y = Math.max(0, this.velocity.y);
    } else if (
      wasGrounded &&
      this.position.y < floor + 0.025 &&
      this.velocity.y < 0.2
    ) {
      this.onGround = true;
    }
    this._thrust = thrust;
    this._lift = lift;
    this._drag = drag;
    this._liftCoefficient = cl;
    this._separation = separation;
  }

  _updateTelemetry(density) {
    this._inverse.copy(this.quaternion).conjugate();
    this._air.copy(this.velocity).sub(this._wind);
    this._bodyAir.copy(this._air).applyQuaternion(this._inverse);
    this._forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.quaternion);
    const alpha =
      Math.hypot(this._bodyAir.y, this._bodyAir.z) > 0.1
        ? Math.atan2(-this._bodyAir.y, -this._bodyAir.z)
        : 0;
    const t = this.telemetry;
    t.airspeed = this._air.length();
    t.groundspeed = Math.hypot(this.velocity.x, this.velocity.z);
    t.altitude = this.position.y;
    t.agl = this.position.y - this._groundHeight();
    t.verticalSpeed = this.velocity.y;
    t.heading =
      (((Math.atan2(this._forward.x, -this._forward.z) / DEG) % 360) + 360) %
      360;
    t.pitch =
      Math.atan2(
        this._forward.y,
        Math.hypot(this._forward.x, this._forward.z),
      ) / DEG;
    t.roll = -Math.atan2(this._right.y, this._up.y) / DEG;
    t.aoa = alpha / DEG;
    t.gForce = this._gForce;
    t.stallWarning =
      !this.crashed &&
      t.airspeed > 10 &&
      Math.abs(alpha) >
        this.aircraft.stallAngle - (2 + 2 * this._flapPosition) * DEG;
    t.engineRPM = this.crashed
      ? 0
      : this.aircraft.maxEngineRPM * Math.sqrt(Math.max(0, this._spool));
    t.windSpeed = this._wind.length();
    t.density = density;
    t.dynamicPressure = 0.5 * density * t.airspeed ** 2;
    t.liftCoefficient = this._liftCoefficient;
    t.lift = this._lift;
    t.drag = this._drag;
    t.thrust = this._thrust;
    t.flaps = this._flapPosition;
    t.sideslip =
      Math.atan2(
        this._bodyAir.x,
        Math.max(0.1, Math.hypot(this._bodyAir.y, this._bodyAir.z)),
      ) / DEG;
    t.onGround = this.onGround;
    t.crashed = this.crashed;
    t.crashReason = this.crashReason;
  }
}
