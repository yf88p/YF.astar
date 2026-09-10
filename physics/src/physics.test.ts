import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { MarbleWorld } from './physics';

test('initial marbles do not overlap and are contained', () => {
  for (const count of [6, 18, 36]) {
    const world = new MarbleWorld(count);
    assert.equal(world.bodies.length, count);
    for (const [i, body] of world.bodies.entries()) {
      assert.ok(body.position.distanceTo(world.center) + body.radius <= world.shellRadius);
      for (const other of world.bodies.slice(i + 1)) {
        assert.ok(body.position.distanceTo(other.position) >= body.radius + other.radius);
      }
    }
  }
});

test('a moving sphere preserves marble inertia before wall contact', () => {
  const world = new MarbleWorld(1);
  world.gravity = 0;
  world.bodies[0].position.set(0, 0, 0);
  world.step(1 / 60, new Vector3(0.3, 0, 0));
  assert.ok(world.bodies[0].position.length() < 1e-8);
  assert.equal(world.center.x, 0.3);
});

test('a translating wall transfers momentum and contains every marble', () => {
  const world = new MarbleWorld(36);
  const center = new Vector3();
  let maxEnergy = 0;
  for (let frame = 0; frame < 600; frame++) {
    const time = frame / 60;
    center.set(Math.sin(time * 4) * 1.8, Math.cos(time * 3) * 0.7, Math.sin(time) * 0.4);
    world.step(1 / 60, center);
    maxEnergy = Math.max(maxEnergy, world.energy);
    for (const body of world.bodies) {
      assert.ok(Number.isFinite(body.velocity.length()));
      assert.ok(body.position.distanceTo(center) + body.radius <= world.shellRadius + 1e-7);
      assert.ok(Math.abs(body.rotation.length() - 1) < 1e-6);
    }
  }
  assert.ok(maxEnergy > 20);
});

test('gravity settles the collection into a stable pile', () => {
  const world = new MarbleWorld();
  for (let frame = 0; frame < 1800; frame++) world.step(1 / 60, world.center);
  assert.ok(world.energy < 0.01, `Resting energy was ${world.energy}`);
  assert.ok(world.bodies.every((body) => body.position.y < 0));
  for (const [i, body] of world.bodies.entries()) {
    for (const other of world.bodies.slice(i + 1)) {
      assert.ok(body.position.distanceTo(other.position) >= body.radius + other.radius - 0.002);
    }
  }
});

test('unequal marble masses exchange momentum in pair collisions', () => {
  const world = new MarbleWorld(2);
  world.gravity = 0;
  world.bounciness = 1;
  const [a, b] = world.bodies;
  a.position.set(-a.radius + 0.001, 0, 0);
  b.position.set(b.radius - 0.001, 0, 0);
  a.velocity.set(2, 0, 0);
  b.velocity.set(-1, 0, 0);
  const initialMomentum = a.velocity.x * a.mass + b.velocity.x * b.mass;
  world.step(1 / 180, world.center);
  const momentum = a.velocity.x * a.mass + b.velocity.x * b.mass;
  assert.ok(Math.abs(momentum - initialMomentum * Math.exp(-0.1 / 180)) < 1e-6);
  assert.ok(b.velocity.x > a.velocity.x);
});

test('zero gravity, stirring, reset and invalid timesteps remain stable', () => {
  const world = new MarbleWorld();
  world.gravity = 0;
  world.step(1 / 60, world.center);
  assert.equal(world.energy, 0);
  world.stir();
  assert.ok(world.energy > 10);
  world.step(NaN, world.center);
  world.step(-1, world.center);
  world.step(10, new Vector3(1, 0, 0));
  assert.ok(Number.isFinite(world.energy));
  world.reset(12);
  assert.equal(world.bodies.length, 12);
  assert.equal(world.energy, 0);
  assert.ok(world.bodies.every((body) => body.position.distanceTo(world.center) + body.radius <= world.shellRadius));
});
