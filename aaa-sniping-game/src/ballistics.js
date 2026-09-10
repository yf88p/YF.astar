export const MUZZLE_VELOCITY = 800;
export const GRAVITY = 9.81;
export const ZERO_DISTANCE = 100;

// A 100 m zero raises the bore just enough to cancel gravity at the zero range.
export function zeroedVelocity(direction) {
  return direction.clone().multiplyScalar(MUZZLE_VELOCITY)
    .add({ x: 0, y: GRAVITY * ZERO_DISTANCE / (2 * MUZZLE_VELOCITY), z: 0 });
}

export function integrateBullet(position, velocity, dt, wind) {
  position.x += velocity.x * dt + wind * 0.5 * dt * dt;
  position.y += velocity.y * dt - GRAVITY * 0.5 * dt * dt;
  position.z += velocity.z * dt;
  velocity.x += wind * dt;
  velocity.y -= GRAVITY * dt;
}

export function scoreHit(headshot, distance, steady) {
  return 100 + (headshot ? 150 : 0) + Math.floor(distance / 10) * 5 + (steady ? 25 : 0);
}
