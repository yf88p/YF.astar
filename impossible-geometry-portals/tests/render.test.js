import test from "node:test";
import assert from "node:assert/strict";
import {
  Euler,
  Matrix4,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Vector3,
  Vector4,
} from "three";
import { clipProjection, portalPlane } from "../src/render.js";
import { mapPoint, World } from "../src/core.js";
import { LEVELS } from "../src/levels.js";

const near = (a, b, message) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} != ${b}`);
const project = (point, camera) =>
  new Vector4(...point.toArray(), 1)
    .applyMatrix4(camera.matrixWorldInverse)
    .applyMatrix4(camera.projectionMatrix);

for (const aspect of [1440 / 1000, 390 / 844, 320 / 844]) {
  test(`oblique clipping agrees with signed world halfspace and preserves XY/UV at aspect ${aspect}`, () => {
    const camera = new PerspectiveCamera(65, aspect, 0.025, 180);
    camera.position.set(3, 2, 7);
    camera.quaternion.setFromEuler(new Euler(-0.12, 0.37, 0.08));
    camera.updateMatrixWorld(true);
    const original = camera.clone();
    // The expected halfspace is scalar dot(n, point) + d, not a second
    // implementation of Lengyel's projection-matrix modification.
    const n = new Vector3(0.15, -0.1, -1)
      .normalize()
      .applyQuaternion(camera.quaternion);
    const pointOnPlane = new Vector3(0, 0, -4).applyMatrix4(camera.matrixWorld);
    const d = -n.dot(pointOnPlane);
    clipProjection(camera, new Plane(n, d));
    near(camera.aspect, aspect, "camera aspect");
    for (const x of [-0.3, 0, 0.3])
      for (const y of [-0.2, 0, 0.2])
        for (const z of [-2, -3.8, -4.2, -8]) {
          const point = new Vector3(x, y, z).applyMatrix4(camera.matrixWorld);
          const before = project(point, original),
            after = project(point, camera);
          const signedDistance =
            n.x * point.x + n.y * point.y + n.z * point.z + d;
          assert.equal(
            after.z + after.w >= 0,
            signedDistance >= 0,
            `halfspace at ${point.toArray()}`,
          );
          near(after.x / after.w, before.x / before.w, "NDC X");
          near(after.y / after.w, before.y / before.w, "NDC Y");
          near(
            (after.x / after.w) * 0.5 + 0.5,
            (before.x / before.w) * 0.5 + 0.5,
            "screen-space U",
          );
          near(
            (after.y / after.w) * 0.5 + 0.5,
            (before.y / before.w) * 0.5 + 0.5,
            "screen-space V",
          );
        }
    const identity = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.projectionMatrixInverse,
    ).elements;
    identity.forEach((value, i) =>
      near(value, i % 5 === 0 ? 1 : 0, "projection inverse"),
    );
  });
}

test("source and destination straddle planes keep complementary samples of one physical cube", () => {
  const world = new World(LEVELS[0]),
    body = world.cubes.get("delivery-cube");
  world.moveBody(body, new Vector3(-2.7, 1.6, -6.9).sub(body.position));
  const { portal, destination } = world.getStraddle(body);
  const source = portalPlane(portal),
    remote = portalPlane(destination);
  assert.equal(world.cubes.size, 1);
  for (const offset of [-0.34, -0.2, 0.2, 0.34]) {
    const point = body.position.clone().add(new Vector3(0, 0, offset));
    const mapped = mapPoint(point, portal, destination);
    near(
      source.distanceToPoint(point),
      -remote.distanceToPoint(mapped),
      "complementary signed distance",
    );
    assert.notEqual(
      source.distanceToPoint(point) >= 0,
      remote.distanceToPoint(mapped) >= 0,
    );
  }
});

test("portalPlane uses inward normal and metric offset for floor and rotated wall planes", () => {
  for (const quaternion of [
    [0, 0, 0, 1],
    [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    [0, Math.SQRT1_2, 0, Math.SQRT1_2],
  ]) {
    const portal = { position: [4, 3, -2], quaternion };
    const normal = new Vector3(0, 0, 1).applyQuaternion(
      new Quaternion(...quaternion),
    );
    const plane = portalPlane(portal, 0.125);
    near(
      plane.distanceToPoint(new Vector3(...portal.position)),
      -0.125,
      "offset",
    );
    near(
      plane.distanceToPoint(new Vector3(...portal.position).add(normal)),
      0.875,
      "inward side",
    );
  }
});

test("floor-to-wall virtual eye stays in the source until the transported eye crosses the exit", () => {
  const world = new World(LEVELS[1]);
  world.moveBody(world.player, new Vector3(0, 0, -3.1));
  world.moveBody(world.player, new Vector3(0, -9.36, 0));
  assert.equal(world.player.room, "landing-hall");
  near(world.player.position.z, 6.498, "body beyond destination plane z=7");
  const forward = new Vector3(0, 0, -1).applyQuaternion(
    world.player.quaternion,
  );
  world.look(world.input.yaw, world.input.pitch);
  near(
    new Vector3(0, 0, -1)
      .applyQuaternion(world.player.quaternion)
      .distanceTo(forward),
    0,
    "look preserves transported body frame",
  );
  // The rigid eye offset points back through the wall: 6.498 + 0.67 > 7.
  // Comparing this camera against a destination-room forward vector is invalid.
  const sourceEye = world.cameraFrame();
  assert.equal(sourceEye.room, "drop-shaft");
  near(sourceEye.position.y, 0.168, "source-side eye height");
  world.moveBody(world.player, new Vector3(0, 0, -0.3));
  assert.equal(world.cameraFrame().room, "landing-hall");
});
