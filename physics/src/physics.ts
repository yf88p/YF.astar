import * as THREE from 'three';

export interface MarbleBody {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  radius: number;
  mass: number;
  colorIndex: number;
}

export type PhysicsImpact = {
  speed: number;
  x: number;
  kind: 'shell' | 'marble';
};

const MAX_STEP = 1 / 180;
const MAX_FRAME = 1 / 15;
const CONTACT_EPSILON = 1e-5;
const BOUNCE_THRESHOLD = 0.45;

const finiteVector = (v: THREE.Vector3): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

export class MarbleWorld {
  public bodies: MarbleBody[] = [];
  public center = new THREE.Vector3();
  public shellRadius: number;
  public gravity = 6;
  public bounciness = 0.66;
  public onImpact?: (impact: PhysicsImpact) => void;

  private spins: THREE.Vector3[] = [];
  private seed = 0x7a31b249;
  private readonly startCenter = new THREE.Vector3();
  private readonly targetCenter = new THREE.Vector3();
  private readonly wallVelocity = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly relative = new THREE.Vector3();
  private readonly torque = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private shellImpact?: PhysicsImpact;
  private marbleImpact?: PhysicsImpact;

  constructor(count = 18, shellRadius = 2.05) {
    this.shellRadius = Number.isFinite(shellRadius) && shellRadius > 0.31
      ? shellRadius
      : 2.05;
    this.reset(count);
  }

  private random(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 0x100000000;
  }

  reset(count = this.bodies.length || 18): void {
    const requested = Number.isFinite(count)
      ? Math.max(0, Math.min(256, Math.floor(count)))
      : 18;
    this.seed = 0x7a31b249;
    this.bodies = [];
    this.spins = [];
    this.shellImpact = undefined;
    this.marbleImpact = undefined;

    for (let i = 0; i < requested; i++) {
      const radius = 0.21 + this.random() * 0.09;
      const available = this.shellRadius - radius - 0.015;
      const position = new THREE.Vector3();
      let placed = false;
      for (let attempt = 0; attempt < 2400; attempt++) {
        position.set(
          (this.random() * 2 - 1) * available,
          (this.random() * (attempt < 1200 ? 1.3 : 2) - 1) * available,
          (this.random() * 2 - 1) * available,
        );
        if (position.lengthSq() > available * available) continue;
        position.add(this.center);
        if (this.bodies.every((other) =>
          position.distanceToSquared(other.position) >
          (radius + other.radius + 0.008) ** 2,
        )) {
          placed = true;
          break;
        }
      }
      // An overfilled or unusually small shell must not start with overlaps.
      if (!placed) break;
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        this.random() * Math.PI * 2,
        this.random() * Math.PI * 2,
        this.random() * Math.PI * 2,
      ));
      this.bodies.push({
        position,
        velocity: new THREE.Vector3(),
        rotation,
        radius,
        mass: (radius / 0.25) ** 3,
        colorIndex: i % 6,
      });
      this.spins.push(new THREE.Vector3());
    }
  }

  step(deltaSeconds: number, center: THREE.Vector3): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || !finiteVector(center)) return;
    const dt = Math.min(deltaSeconds, MAX_FRAME);
    this.startCenter.copy(this.center);
    this.targetCenter.copy(center);
    this.wallVelocity.subVectors(this.targetCenter, this.startCenter).divideScalar(dt);
    if (!finiteVector(this.wallVelocity)) return;

    const wallSpeed = this.wallVelocity.length();
    const speedLimit = Math.min(120, Math.max(24, wallSpeed * 1.5 + 12));
    const gravity = Number.isFinite(this.gravity) ? THREE.MathUtils.clamp(this.gravity, -50, 50) : 6;
    const restitution = Number.isFinite(this.bounciness)
      ? THREE.MathUtils.clamp(this.bounciness, 0, 1)
      : 0.66;
    let maxSpeed = 0;
    let minRadius = 0.21;
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      const spin = this.spins[i] ?? (this.spins[i] = new THREE.Vector3());
      if (!finiteVector(body.position)) body.position.copy(this.center);
      if (!finiteVector(body.velocity)) body.velocity.set(0, 0, 0);
      if (!finiteVector(spin)) spin.set(0, 0, 0);
      if (!Number.isFinite(body.radius) || body.radius <= 0 || body.radius >= this.shellRadius) {
        body.radius = Math.min(0.25, this.shellRadius * 0.5);
      }
      if (!Number.isFinite(body.mass) || body.mass <= 0) body.mass = (body.radius / 0.25) ** 3;
      if (!Number.isFinite(body.rotation.lengthSq()) || body.rotation.lengthSq() < 1e-12) {
        body.rotation.identity();
      }
      body.velocity.clampLength(0, speedLimit);
      spin.clampLength(0, 160);
      maxSpeed = Math.max(maxSpeed, body.velocity.length());
      minRadius = Math.min(minRadius, body.radius);
    }

    // Semi-fixed steps consume the entire frame. Wall velocity uses exactly the
    // same duration as the interpolated motion, including shortened frames.
    // Extra subdivisions prevent fast marbles from passing through each other.
    const substeps = Math.min(96, Math.max(
      1,
      Math.ceil(dt / MAX_STEP),
      Math.ceil((2 * maxSpeed + 2 * wallSpeed + Math.abs(gravity) * dt) * dt / (minRadius * 0.45)),
    ));
    const h = dt / substeps;
    const damping = Math.exp(-0.10 * h);
    const spinDamping = Math.exp(-0.12 * h);
    this.shellImpact = undefined;
    this.marbleImpact = undefined;

    for (let step = 0; step < substeps; step++) {
      this.center.lerpVectors(this.startCenter, this.targetCenter, (step + 1) / substeps);
      for (const body of this.bodies) {
        body.velocity.y -= gravity * h;
        body.velocity.multiplyScalar(damping);
        body.position.addScaledVector(body.velocity, h);
      }

      // Alternating traversal avoids consistently favouring the same bodies in
      // a resting pile. Shell contacts run last to guarantee containment.
      for (let iteration = 0; iteration < 7; iteration++) {
        const reverse = iteration % 2 !== 0;
        for (let index = 0; index < this.bodies.length; index++) {
          const i = reverse ? this.bodies.length - 1 - index : index;
          for (let j = i + 1; j < this.bodies.length; j++) {
            this.solvePair(i, j, restitution);
          }
        }
        for (let i = 0; i < this.bodies.length; i++) this.solveShell(i, restitution);
      }

      for (let i = 0; i < this.bodies.length; i++) {
        const body = this.bodies[i];
        const spin = this.spins[i];
        body.velocity.clampLength(0, speedLimit);
        spin.multiplyScalar(spinDamping).clampLength(0, 160);
        const angularSpeed = spin.length();
        if (angularSpeed > 1e-8) {
          this.torque.copy(spin).divideScalar(angularSpeed);
          this.turn.setFromAxisAngle(this.torque, angularSpeed * h);
          body.rotation.premultiply(this.turn).normalize();
        }
      }
    }

    // At most two notifications per rendered frame, not one per solver pass.
    const shellImpact = this.shellImpact;
    const marbleImpact = this.marbleImpact;
    if (shellImpact) this.onImpact?.(shellImpact);
    if (marbleImpact) this.onImpact?.(marbleImpact);
  }

  private solveShell(index: number, restitution: number): void {
    const body = this.bodies[index];
    const spin = this.spins[index];
    const limit = this.shellRadius - body.radius;
    const n = this.normal.subVectors(body.position, this.center);
    const distance = n.length();
    if (distance < limit - CONTACT_EPSILON || distance < 1e-12) return;
    n.divideScalar(distance);
    if (distance > limit) body.position.copy(this.center).addScaledVector(n, limit);

    const relative = this.relative.subVectors(body.velocity, this.wallVelocity);
    const outwardSpeed = relative.dot(n);
    if (outwardSpeed <= 0) return;
    const bounce = outwardSpeed > BOUNCE_THRESHOLD ? restitution : 0;
    const normalDelta = (1 + bounce) * outwardSpeed;
    body.velocity.addScaledVector(n, -normalDelta);

    // Contact-point velocity includes spin. A solid sphere has I = 2mr^2/5,
    // hence tangential inverse effective mass is 3.5 times inverse mass.
    this.torque.crossVectors(spin, n).multiplyScalar(body.radius);
    const tangent = this.tangent.copy(relative).add(this.torque);
    tangent.addScaledVector(n, -tangent.dot(n));
    const tangentSpeed = tangent.length();
    if (tangentSpeed > 1e-9) {
      tangent.multiplyScalar(-Math.min(1 / 3.5, 0.22 * normalDelta / tangentSpeed));
      body.velocity.add(tangent);
      this.torque.crossVectors(n, tangent).multiplyScalar(2.5 / body.radius);
      spin.add(this.torque);
    }
    if (outwardSpeed > 0.65 && (!this.shellImpact || outwardSpeed > this.shellImpact.speed)) {
      this.shellImpact = { speed: outwardSpeed, x: body.position.x, kind: 'shell' };
    }
  }

  private solvePair(i: number, j: number, restitution: number): void {
    const a = this.bodies[i];
    const b = this.bodies[j];
    const n = this.normal.subVectors(b.position, a.position);
    const radii = a.radius + b.radius;
    const distanceSquared = n.lengthSq();
    if (distanceSquared > (radii + CONTACT_EPSILON) ** 2) return;
    const distance = Math.sqrt(distanceSquared);
    if (distance > 1e-10) n.divideScalar(distance);
    else n.set((i + j) % 3 === 0 ? 1 : 0, (i + j) % 3 === 1 ? 1 : 0, (i + j) % 3 === 2 ? 1 : 0);

    const invA = 1 / a.mass;
    const invB = 1 / b.mass;
    const inverseMass = invA + invB;
    const penetration = radii - distance;
    if (penetration > 0) {
      const correction = (penetration + CONTACT_EPSILON) * 0.85 / inverseMass;
      a.position.addScaledVector(n, -correction * invA);
      b.position.addScaledVector(n, correction * invB);
    }

    const relative = this.relative.subVectors(b.velocity, a.velocity);
    const normalSpeed = relative.dot(n);
    if (normalSpeed >= 0) return;
    const speed = -normalSpeed;
    const bounce = speed > BOUNCE_THRESHOLD ? restitution : 0;
    const impulse = (1 + bounce) * speed / inverseMass;
    a.velocity.addScaledVector(n, -impulse * invA);
    b.velocity.addScaledVector(n, impulse * invB);

    this.torque.crossVectors(this.spins[i], n).multiplyScalar(a.radius);
    relative.sub(this.torque);
    this.torque.crossVectors(this.spins[j], n).multiplyScalar(b.radius);
    relative.sub(this.torque);
    const tangent = this.tangent.copy(relative).addScaledVector(n, -relative.dot(n));
    const tangentSpeed = tangent.length();
    if (tangentSpeed > 1e-9) {
      tangent.multiplyScalar(-Math.min(1 / (3.5 * inverseMass), 0.16 * impulse / tangentSpeed));
      a.velocity.addScaledVector(tangent, -invA);
      b.velocity.addScaledVector(tangent, invB);
      this.torque.crossVectors(n, tangent);
      this.spins[i].addScaledVector(this.torque, -2.5 * invA / a.radius);
      this.spins[j].addScaledVector(this.torque, -2.5 * invB / b.radius);
    }
    if (speed > 0.65 && (!this.marbleImpact || speed > this.marbleImpact.speed)) {
      this.marbleImpact = { speed, x: (a.position.x + b.position.x) * 0.5, kind: 'marble' };
    }
  }

  stir(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      const x = body.position.x - this.center.x;
      const z = body.position.z - this.center.z;
      body.velocity.x += (this.random() - 0.5) * 3.8 - z * 0.8;
      body.velocity.y += 3.2 + this.random() * 2.5;
      body.velocity.z += (this.random() - 0.5) * 3.8 + x * 0.8;
      body.velocity.clampLength(0, 14);
      const spin = this.spins[i] ?? (this.spins[i] = new THREE.Vector3());
      spin.x += (this.random() - 0.5) * 8;
      spin.z += (this.random() - 0.5) * 8;
    }
  }

  /** Total translational and rotational kinetic energy (unit-density scale). */
  get energy(): number {
    let total = 0;
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      total += 0.5 * body.mass * body.velocity.lengthSq();
      total += 0.2 * body.mass * body.radius ** 2 * (this.spins[i]?.lengthSq() ?? 0);
    }
    return Number.isFinite(total) ? total : 0;
  }
}
