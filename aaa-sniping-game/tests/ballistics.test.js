import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { zeroedVelocity, integrateBullet, scoreHit, MUZZLE_VELOCITY } from '../src/ballistics.js';

test('a 100 metre zero cancels gravitational drop at the zero distance', () => {
  const position = new Vector3();
  const velocity = zeroedVelocity(new Vector3(0, 0, -1));
  integrateBullet(position, velocity, 100 / MUZZLE_VELOCITY, 0);
  assert.ok(Math.abs(position.y) < 1e-10);
  assert.equal(position.z, -100);
});

test('integration remains consistent across different frame rates', () => {
  const a = new Vector3();
  const b = new Vector3();
  const av = zeroedVelocity(new Vector3(0, 0, -1));
  const bv = av.clone();
  integrateBullet(a, av, 0.5, 0.4);
  for (let i = 0; i < 30; i++) integrateBullet(b, bv, 1 / 60, 0.4);
  assert.ok(a.distanceTo(b) < 1e-8);
  assert.ok(av.distanceTo(bv) < 1e-8);
});

test('wind drifts shots and gravity produces drop beyond the zero range', () => {
  const position = new Vector3();
  const velocity = zeroedVelocity(new Vector3(0, 0, -1));
  integrateBullet(position, velocity, 0.5, 1);
  assert.ok(position.x > 0);
  assert.ok(position.y < 0);
});

test('precision and breath control increase the score', () => {
  assert.equal(scoreHit(false, 100, false), 150);
  assert.equal(scoreHit(true, 100, true), 325);
});
