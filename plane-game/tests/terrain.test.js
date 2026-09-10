import test from "node:test";
import assert from "node:assert/strict";
import { Raycaster, Vector3 } from "three";
import { createTerrain, terrainHeight } from "../src/terrain.js";

function buildTerrain(t, mobile = false) {
  const mesh = createTerrain({ mobile });
  mesh.updateMatrixWorld(true);
  t.after(() => {
    mesh.geometry.dispose();
    mesh.material.userData.detailTexture.dispose();
    mesh.material.dispose();
  });
  return mesh;
}

test("terrain height has an analytic fallback before a mesh is created", () => {
  assert.equal(terrainHeight(0, 0), 18);
  assert.ok(
    Math.abs(terrainHeight(7195.63, -6652.86) - 2760.199887453564) < 1e-6,
  );
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} collision heights match rendered triangles, including ridges and the airfield`, (t) => {
    const mesh = buildTerrain(t, mobile);
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 20000);
    const points = [
      [7195.63, -6652.86],
      [0, 0],
      [0, -850],
      [0, 850],
      [-180, -1050],
      [180, 1050],
      [-180, 1050],
      [180, -1050],
      [-18000, -18000],
      [18000, 18000],
      [-18000, 18000],
      [18000, -18000],
      [18000, 0],
      [0, -18000],
    ];
    let seed = 17236;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 64; i++)
      points.push([(random() - 0.5) * 35998, (random() - 0.5) * 35998]);

    const positions = mesh.geometry.attributes.position;
    const stride = Math.sqrt(positions.count);
    for (const [ix, iz] of [
      [1, 2],
      [Math.floor(stride * 0.85), Math.floor(stride * 0.27)],
      [Math.floor(stride * 0.41), Math.floor(stride * 0.14)],
      [stride - 3, stride - 4],
    ]) {
      const a = iz * stride + ix;
      const x = positions.getX(a);
      const z = positions.getZ(a);
      const dx = positions.getX(a + 1) - x;
      const dz = positions.getZ(a + stride) - z;
      // Both triangles, their shared diagonal, cell edges, and exact vertices.
      for (const [u, v] of [
        [0.2, 0.3],
        [0.7, 0.6],
        [0.3, 0.7],
        [0, 0],
        [1, 1],
        [0, 0.5],
        [1, 0.5],
      ]) {
        points.push([x + dx * u, z + dz * v]);
      }
    }
    for (const [x, z] of points) {
      ray.ray.origin.set(x, 10000, z);
      const [hit] = ray.intersectObject(mesh, false);
      assert.ok(hit, `terrain ray hits at (${x}, ${z})`);
      const sampled = terrainHeight(x, z);
      assert.ok(
        Math.abs(sampled - hit.point.y) < 1e-6,
        `at (${x}, ${z}): collision ${sampled}, rendered ${hit.point.y}`,
      );
    }
    if (!mobile) {
      assert.ok(
        Math.abs(terrainHeight(7195.63, -6652.86) - 2530.1415815841337) < 1e-6,
      );
      assert.ok(
        terrainHeight(7195.63, -6652.86) + 1.65 < 2650,
        "the reported aircraft is above the ridge",
      );
    }
    for (let x = -180; x <= 180; x += 15) {
      for (let z = -1050; z <= 1050; z += 75) {
        assert.ok(
          Math.abs(terrainHeight(x, z) - 18) < 1e-6,
          `airport plateau at (${x}, ${z})`,
        );
      }
    }
    for (const [x, z] of [
      [-18000.01, 0],
      [18000.01, 0],
      [0, -18000.01],
      [0, 18000.01],
      [100000, -100000],
    ]) {
      assert.equal(
        terrainHeight(x, z),
        -90,
        "outside the rendered mesh is seabed",
      );
    }
  });
}

test("rebuilding at different resolutions does not resample a previous terrain mesh", (t) => {
  const desktop = buildTerrain(t);
  const mobile = buildTerrain(t, true);
  const rebuiltDesktop = buildTerrain(t);
  assert.deepEqual(
    rebuiltDesktop.geometry.attributes.position.array,
    desktop.geometry.attributes.position.array,
  );
  const rebuiltMobile = buildTerrain(t, true);
  assert.deepEqual(
    rebuiltMobile.geometry.attributes.position.array,
    mobile.geometry.attributes.position.array,
  );
  const ray = new Raycaster(
    new Vector3(7195.63, 10000, -6652.86),
    new Vector3(0, -1, 0),
  );
  const [hit] = ray.intersectObject(rebuiltMobile, false);
  assert.ok(
    Math.abs(terrainHeight(7195.63, -6652.86) - hit.point.y) < 1e-6,
    "the most recent grid is active",
  );
});
