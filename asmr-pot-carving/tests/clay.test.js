import test from "node:test";
import assert from "node:assert/strict";
import { Clay, SEGMENTS, ROWS, BASE_Y, HEIGHT } from "../src/clay.js";

const options = {
  tool: "loop",
  pressure: 0.7,
  wetness: 0.6,
  dt: 1 / 60,
  motion: 1,
};

test("a stroke removes real volume and respects the inner wall", () => {
  const clay = new Clay();
  for (let i = 0; i < 1600; i++) clay.carve(0, 1.8, options);
  assert.ok(clay.removed > 0);
  for (let i = 0; i < clay.radii.length; i++) {
    assert.ok(clay.radii[i] <= clay.original[i]);
    assert.ok(clay.radii[i] >= clay.original[i] - 0.205001);
    assert.ok(Number.isFinite(clay.radii[i]));
  }
});

test("pressure and moisture change material removal", () => {
  const light = new Clay(),
    firm = new Clay(),
    wet = new Clay(),
    dry = new Clay();
  light.carve(1, 1.8, { ...options, pressure: 0.2 });
  firm.carve(1, 1.8, { ...options, pressure: 0.9 });
  wet.carve(1, 1.8, { ...options, wetness: 1 });
  dry.carve(1, 1.8, { ...options, wetness: 0.1 });
  assert.ok(firm.removed > light.removed * 2);
  assert.ok(wet.removed > dry.removed);
});

test("carving crosses the cylindrical seam continuously", () => {
  const clay = new Clay();
  clay.carve(0, 1.8, options);
  const row = Math.round(((1.8 - BASE_Y) / HEIGHT) * ROWS);
  const a = row * SEGMENTS + 1,
    b = row * SEGMENTS + SEGMENTS - 1;
  assert.ok(clay.original[a] > clay.radii[a]);
  assert.ok(clay.original[b] > clay.radii[b]);
  assert.ok(
    Math.abs(
      clay.original[a] - clay.radii[a] - (clay.original[b] - clay.radii[b]),
    ) < 0.00001,
  );
});

test("all tools have distinct footprints and smoothing never adds clay", () => {
  const counts = {};
  for (const tool of ["loop", "rib", "needle", "sponge"]) {
    const clay = new Clay();
    clay.carve(1, 1.8, { ...options, tool });
    counts[tool] = clay.radii.filter((v, i) => v < clay.original[i]).length;
    assert.ok(counts[tool] > 0);
    assert.ok(clay.radii.every((v, i) => v <= clay.original[i]));
  }
  assert.ok(counts.needle < counts.loop);
  assert.ok(counts.loop < counts.rib);
});

test("snapshots undo exactly; resetting restores all clay", () => {
  const clay = new Clay();
  clay.carve(0.2, 2, options);
  const before = clay.snapshot();
  clay.carve(0.2, 2, options);
  assert.ok(clay.removed > before.removed);
  clay.restore(before);
  assert.deepEqual(clay.radii, before.radii);
  assert.equal(clay.removed, before.removed);
  clay.reset();
  assert.deepEqual(clay.radii, clay.original);
  assert.equal(clay.removed, 0);
});

test("the rim and foot are protected and invalid tools are inert", () => {
  const clay = new Clay();
  for (const y of [-1, BASE_Y, BASE_Y + HEIGHT, 20])
    assert.equal(clay.carve(0, y, options), 0);
  assert.equal(clay.carve(0, 1, { ...options, tool: "unknown" }), 0);
  assert.equal(clay.removed, 0);
});
