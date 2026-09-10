import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTargets, createRifle } from '../src/arsenal.js';

test('patrols stay within their supported platforms for every phase', () => {
  const patrols = createTargets(new THREE.Scene(), Array.from({ length: 5 }, (_, i) => ({
    position: new THREE.Vector3(i * 10, 0, -30), patrol: 2, name: `Target ${i}`,
  })));
  for (let step = 0; step < 500; step++) {
    patrols.update(step * 0.1, 0.1);
    for (const target of patrols.targets) {
      assert.ok(Math.abs(target.position.x - target.basePosition.x) <= 2);
      assert.equal(target.position.y, target.basePosition.y);
    }
  }
  patrols.dispose();
});

test('headshots disable collision and reset restores the complete target', () => {
  const scene = new THREE.Scene();
  const patrols = createTargets(scene, [{ position: new THREE.Vector3(), patrol: 0, name: 'Sentry' }]);
  const target = patrols.targets[0];
  const originalMeshes = target.hitMeshes.length;
  const origin = target.headPosition.clone().add(new THREE.Vector3(0, 0, 10));
  const ray = new THREE.Raycaster(origin, target.headPosition.clone().sub(origin).normalize());
  const intersection = ray.intersectObjects(target.hitMeshes, false)[0];
  assert.ok(intersection);
  const result = patrols.hit(intersection.object, intersection.point);
  assert.equal(result.headshot, true);
  assert.equal(target.alive, false);
  assert.equal(target.hitMeshes.length, 0);
  assert.equal(patrols.hit(intersection.object, intersection.point), null);
  for (let i = 0; i < 10; i++) patrols.update(i * 0.1, 0.1);
  assert.ok(target.rig.rotation.x > 1);
  patrols.reset();
  assert.equal(target.alive, true);
  assert.equal(target.hitMeshes.length, originalMeshes);
  assert.equal(target.rig.rotation.x, 0);
  patrols.dispose();
});

test('zero simulation time freezes a reload pose', () => {
  const camera = new THREE.PerspectiveCamera();
  const rifle = createRifle(camera);
  rifle.update(0.5, 0.5, { reloading: true });
  const before = [];
  rifle.group.traverse(object => before.push(object.matrixWorld.toArray()));
  rifle.update(0.5, 0, { reloading: true });
  const after = [];
  rifle.group.traverse(object => after.push(object.matrixWorld.toArray()));
  assert.deepEqual(after, before);
  rifle.dispose();
});
