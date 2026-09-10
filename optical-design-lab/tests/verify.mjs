import assert from "node:assert/strict";
import {
  validateProject,
  traceRay,
  traceProject,
  generateRays,
  focusScan,
  refract,
  reflect,
  refractiveIndex,
  toWorld,
  toLocal,
  directionToWorld,
} from "../src/optics.js";
import { createElement, createProject, EXAMPLES } from "../src/examples.js";

// Reference calculations below do not use tracer geometry/refraction helpers.
const rad = Math.PI / 180;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const scale = (a, s) => a.map((x) => x * s);
const norm = (a) => Math.hypot(...a);
const unit = (a) => scale(a, 1 / norm(a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const clone = (value) => structuredClone(value);
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const angleDirection = (theta, phi) => [
  Math.cos(theta * rad),
  Math.sin(theta * rad) * Math.cos(phi * rad),
  Math.sin(theta * rad) * Math.sin(phi * rad),
];
const relative = (actual, expected) =>
  Math.abs(actual - expected) / Math.abs(expected);
const fmt = (n) => Number(n.toPrecision(10));
function near(actual, expected, tolerance, label = "") {
  assert.ok(
    Number.isFinite(actual) && Number.isFinite(expected),
    `${label}: nonfinite comparison`,
  );
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected}, tolerance ${tolerance}`,
  );
}
function vectorNear(actual, expected, tolerance, label = "") {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((x, i) => near(x, expected[i], tolerance, `${label}[${i}]`));
}

// Sequential axis rotations, independent of the production rotation matrix.
function rotate(v, rotation, inverse = false) {
  let [x, y, z] = v;
  for (const axis of inverse ? [2, 1, 0] : [0, 1, 2]) {
    const a = rotation[axis] * rad * (inverse ? -1 : 1),
      c = Math.cos(a),
      s = Math.sin(a);
    if (axis === 0) [y, z] = [c * y - s * z, s * y + c * z];
    if (axis === 1) [x, z] = [c * x + s * z, -s * x + c * z];
    if (axis === 2) [x, y] = [c * x - s * y, s * x + c * y];
  }
  return [x, y, z];
}
const world = (v, e) => add(rotate(v, e.rotation), e.position);
const local = (v, e) => rotate(sub(v, e.position), e.rotation, true);
const element = (type, values = {}) => ({ ...createElement(type), ...values });
const scene = (elements) => ({
  version: 1,
  units: "mm",
  ambient: 1,
  materials: [{ id: "glass", name: "Nondispersive 1.5", A: 1.5, B: 0 }],
  elements,
});
const input = (origin, direction, extra = {}) => ({
  origin,
  direction,
  wavelength: 550,
  ...extra,
});
const TERMINATIONS = [
  "escaped",
  "absorbed",
  "detected",
  "clipped",
  "interaction-limited",
  "path-limited",
];
let checkedRays = 0;

function finiteRay(ray) {
  checkedRays++;
  const finiteVector = (v) => {
    assert.ok(
      Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
      `nonfinite vector: ${v}`,
    );
  };
  finiteVector(ray.origin);
  finiteVector(ray.direction);
  near(norm(ray.direction), 1, 2e-12, "launch direction norm");
  assert.ok(
    TERMINATIONS.includes(ray.termination),
    `missing/unknown termination: ${ray.termination}`,
  );
  assert.ok(Number.isFinite(ray.pathLength) && ray.pathLength >= 0);
  assert.ok(Number.isFinite(ray.wavelength) && ray.wavelength > 0);
  ray.points.forEach(finiteVector);
  vectorNear(ray.points[0], ray.origin, 0, "unmodified launch");
  assert.ok(
    ray.points.length === ray.hits.length + 1 ||
      ray.points.length === ray.hits.length + 2,
  );
  let length = 0;
  for (let i = 1; i < ray.points.length; i++)
    length += norm(sub(ray.points[i], ray.points[i - 1]));
  near(ray.pathLength, length, 2e-9 + 2e-12 * length, "geometric path length");
  for (const [i, hit] of ray.hits.entries()) {
    assert.ok(
      ["refract", "tir", "reflect", "absorb", "clip", "detect"].includes(
        hit.event,
      ),
    );
    finiteVector(hit.position);
    finiteVector(hit.incoming);
    finiteVector(hit.normal);
    near(norm(hit.incoming), 1, 2e-12);
    near(norm(hit.normal), 1, 2e-12);
    vectorNear(hit.position, ray.points[i + 1], 0);
    vectorNear(
      hit.incoming,
      i ? ray.hits[i - 1].outgoing : ray.direction,
      2e-12,
    );
    const segment = sub(hit.position, ray.points[i]);
    near(
      norm(cross(segment, hit.incoming)),
      0,
      2e-9 + 2e-12 * norm(segment),
      "segment follows incoming",
    );
    assert.ok(dot(segment, hit.incoming) >= -2e-9);
    assert.ok(
      Number.isFinite(hit.n1) &&
        hit.n1 > 0 &&
        Number.isFinite(hit.n2) &&
        hit.n2 > 0,
    );
    for (const medium of [hit.mediumBefore, hit.mediumAfter])
      assert.ok(medium === null || typeof medium === "string");
    if (i)
      assert.equal(
        hit.mediumBefore,
        ray.hits[i - 1].mediumAfter,
        "medium continuity",
      );
    if (["refract", "tir", "reflect"].includes(hit.event)) {
      finiteVector(hit.outgoing);
      near(norm(hit.outgoing), 1, 2e-12);
      if (hit.event !== "refract")
        assert.equal(hit.mediumAfter, hit.mediumBefore);
    } else {
      assert.equal(hit.outgoing, null);
      assert.equal(i, ray.hits.length - 1);
      assert.equal(
        ray.termination,
        { absorb: "absorbed", clip: "clipped", detect: "detected" }[hit.event],
      );
    }
  }
  if (ray.termination === "detected") {
    assert.equal(ray.hits.at(-1).event, "detect");
    assert.ok(
      ray.detectorUV.length === 2 && ray.detectorUV.every(Number.isFinite),
    );
    assert.equal(ray.detectorId, ray.hits.at(-1).elementId);
  } else {
    assert.equal(ray.detectorUV, undefined);
    assert.equal(ray.detectorId, undefined);
  }
  return ray;
}
const trace = (p, ray, options) => finiteRay(traceRay(p, ray, options));
function run(p, options) {
  const result = traceProject(p, options);
  result.rays.forEach(finiteRay);
  assert.equal(result.count, result.rays.length);
  assert.equal(
    result.spots.length,
    result.rays.filter((r) => r.termination === "detected").length,
  );
  assert.ok(Number.isFinite(result.duration) && result.duration >= 0);
  for (const termination of TERMINATIONS)
    assert.equal(
      result.terminations[termination],
      result.rays.filter((r) => r.termination === termination).length,
    );
  return result;
}

const tests = [];
const test = (name, body) => tests.push({ name, body });
const report = (values) => console.log(`  ${JSON.stringify(values)}`);

test("Snell: finite interfaces, both directions, zero incidence, 3D azimuths", () => {
  let maximumResidual = 0,
    maximumAngleError = 0,
    cases = 0;
  const rotations = [
    [0, 0, 0],
    [13, -27, 41],
    [-38, 64, 19],
  ];
  const indexPairs = [
    [1, 1.2],
    [1, 1.5],
    [1, 1.9],
    [1.33, 1.5],
    [1.5, 1.5],
  ];
  for (const [ambient, glass] of indexPairs)
    for (const rotation of rotations)
      for (const exiting of [false, true]) {
        const slab = element("slab", {
          position: [7, -11, 5],
          rotation,
          thickness: 20,
          aperture: 100,
        });
        const p = scene([slab]),
          n1 = exiting ? glass : ambient,
          n2 = exiting ? ambient : glass;
        p.ambient = ambient;
        p.materials[0].A = glass;
        for (const theta of exiting
          ? [0, 0.00001, 5, 20, 35, 40]
          : [0, 0.00001, 5, 20, 40, 60, 80]) {
          if ((n1 / n2) * Math.sin(theta * rad) >= 1) continue;
          for (const phi of [0, 29, 90, 177, 251, 315]) {
            const d = angleDirection(theta, phi),
              target = [exiting ? 10 : -10, 0, 0];
            const ray = trace(
              p,
              input(world(sub(target, scale(d, 3)), slab), rotate(d, rotation)),
              { maxInteractions: 1 },
            );
            assert.equal(ray.hits.length, 1);
            assert.equal(ray.termination, "interaction-limited");
            const h = ray.hits[0];
            assert.equal(h.event, "refract");
            assert.equal(h.surface, exiting ? "back" : "front");
            assert.equal(h.elementId, slab.id);
            near(h.n1, n1, 0);
            near(h.n2, n2, 0);
            assert.equal(h.mediumBefore, exiting ? slab.id : null);
            assert.equal(h.mediumAfter, exiting ? null : slab.id);
            vectorNear(
              h.position,
              world(target, slab),
              2e-12,
              "actual finite interface hit",
            );
            vectorNear(
              h.normal,
              rotate([exiting ? 1 : -1, 0, 0], rotation),
              2e-12,
            );
            const residual =
              Math.abs(
                n1 * norm(cross(h.incoming, h.normal)) -
                  n2 * norm(cross(h.outgoing, h.normal)),
              ) / Math.max(n1, n2);
            assert.ok(
              residual <= 1e-6,
              `Snell normalized residual ${residual}`,
            );
            maximumResidual = Math.max(maximumResidual, residual);
            const transmitted = Math.asin((n1 / n2) * Math.sin(theta * rad));
            const expected = rotate(
              angleDirection(transmitted / rad, phi),
              rotation,
            );
            vectorNear(h.outgoing, expected, 2e-12, "scalar Snell direction");
            maximumAngleError = Math.max(
              maximumAngleError,
              Math.abs(
                Math.atan2(
                  norm(cross(h.outgoing, h.normal)),
                  Math.abs(dot(h.outgoing, h.normal)),
                ) - transmitted,
              ),
            );
            for (const normalSign of [-1, 1]) {
              const helper = refract(
                scale(h.incoming, 7),
                scale(h.normal, normalSign * 3),
                n1,
                n2,
              );
              assert.equal(helper.tir, false);
              vectorNear(helper.direction, expected, 2e-12);
            }
            if (theta === 0)
              vectorNear(h.outgoing, h.incoming, 2e-12, "zero incidence");
            cases++;
          }
        }
      }
  report({
    cases,
    indexPairs,
    maximumNormalizedResidual: fmt(maximumResidual),
    maximumAngleErrorRad: fmt(maximumAngleError),
  });
});

test("Mirrors: orientations, equal angles, coplanarity, finite miss, spherical normals", () => {
  let cases = 0,
    angleResidual = 0,
    planeResidual = 0;
  for (const rotation of [
    [0, 0, 0],
    [0, 0, -45],
    [21, -36, 57],
    [-70, 19, 112],
  ]) {
    const mirror = element("mirror", {
      position: [3, -7, 11],
      rotation,
      aperture: 30,
    });
    for (const side of [-1, 1])
      for (const theta of [0, 12, 45, 79])
        for (const phi of [0, 37, 90, 213]) {
          const d = scale(angleDirection(theta, phi), side),
            target = [0, 2, -1];
          const ray = trace(
            scene([mirror]),
            input(world(sub(target, scale(d, 6)), mirror), rotate(d, rotation)),
            { maxInteractions: 1 },
          );
          assert.equal(ray.hits.length, 1);
          const h = ray.hits[0];
          assert.equal(h.event, "reflect");
          vectorNear(h.position, world(target, mirror), 3e-12);
          const a = Math.abs(
            Math.abs(dot(h.incoming, h.normal)) -
              Math.abs(dot(h.outgoing, h.normal)),
          );
          const c = Math.abs(dot(h.outgoing, cross(h.incoming, h.normal)));
          angleResidual = Math.max(a, angleResidual);
          planeResidual = Math.max(c, planeResidual);
          assert.ok(a <= 1e-12 && c <= 1e-12);
          vectorNear(h.outgoing, rotate([-d[0], d[1], d[2]], rotation), 3e-12);
          assert.ok(dot(h.incoming, h.normal) * dot(h.outgoing, h.normal) < 0);
          vectorNear(
            reflect(scale(h.incoming, 9), scale(h.normal, -4)),
            h.outgoing,
            2e-12,
          );
          cases++;
        }
    const miss = trace(
      scene([mirror]),
      input(world([-5, 16, 0], mirror), rotate([1, 0, 0], rotation)),
    );
    assert.equal(miss.hits.length, 0);
    assert.equal(miss.termination, "escaped");
  }
  for (const radius of [-50, 50])
    for (const phi of [0, 47, 90, 219]) {
      const mirror = element("mirror", {
        radius,
        aperture: 20,
        rotation: [14, -21, 38],
      });
      const h = 6,
        x = radius - Math.sign(radius) * Math.sqrt(radius * radius - h * h);
      const target = [x, h * Math.cos(phi * rad), h * Math.sin(phi * rad)];
      const incident = [1, 0, 0],
        n = unit(sub(target, [radius, 0, 0]));
      const expected = sub(incident, scale(n, 2 * dot(incident, n)));
      const ray = trace(
        scene([mirror]),
        input(
          world(sub(target, [5, 0, 0]), mirror),
          rotate(incident, mirror.rotation),
        ),
        { maxInteractions: 1 },
      );
      assert.equal(ray.hits.length, 1);
      assert.equal(ray.hits[0].event, "reflect");
      vectorNear(ray.hits[0].position, world(target, mirror), 3e-12);
      vectorNear(
        ray.hits[0].outgoing,
        rotate(expected, mirror.rotation),
        3e-12,
      );
      cases++;
    }
  report({
    cases,
    maximumEqualAngleCosineResidual: fmt(angleResidual),
    maximumCoplanarityResidual: fmt(planeResidual),
    misses: 4,
  });
});

test("TIR: generated source inside finite n=1.5 slab, critical-angle neighborhood", () => {
  const critical = Math.asin(1 / 1.5) / rad;
  let cases = 0,
    tirHits = 0;
  for (const offset of [-10, -1, -1e-3, -1e-6, -1e-9, 1e-9, 1e-6, 1e-3, 1, 10])
    for (const phi of [0, 37, 90, 231]) {
      const d = angleDirection(critical + offset, phi);
      const source = element("source", {
        kind: "collimated",
        position: [0, 0, 0],
        beamRadius: 0,
        samples: 1,
        wavelengths: [550],
        rotation: [0, -Math.asin(d[2]) / rad, Math.atan2(d[1], d[0]) / rad],
      });
      const slab = element("slab", { thickness: 20, aperture: 200 });
      const result = run(scene([source, slab])),
        ray = result.rays[0],
        hit = ray.hits[0];
      assert.equal(result.count, 1);
      vectorNear(ray.direction, d, 1e-12);
      assert.equal(hit.mediumBefore, slab.id);
      near(hit.n1, 1.5, 0);
      near(hit.n2, 1, 0);
      assert.equal(hit.surface, "back");
      near(hit.position[0], 10, 1e-12);
      if (offset < 0) {
        assert.equal(hit.event, "refract");
        assert.equal(hit.mediumAfter, null);
        assert.equal(ray.termination, "escaped");
        assert.equal(ray.hits.length, 1);
        near(
          norm(cross(hit.outgoing, hit.normal)),
          1.5 * Math.sin((critical + offset) * rad),
          2e-12,
        );
      } else {
        assert.equal(ray.termination, "absorbed");
        assert.equal(ray.hits.at(-1).surface, "rim");
        for (const bounce of ray.hits.slice(0, -1)) {
          assert.equal(bounce.event, "tir");
          assert.equal(bounce.mediumBefore, slab.id);
          assert.equal(bounce.mediumAfter, slab.id);
          near(bounce.n1, 1.5, 0);
          near(bounce.n2, 1, 0);
          vectorNear(
            bounce.outgoing,
            [-bounce.incoming[0], bounce.incoming[1], bounce.incoming[2]],
            2e-12,
          );
          tirHits++;
        }
        assert.equal(ray.hits.at(-1).mediumBefore, slab.id);
      }
      cases++;
    }
  const tangent = trace(
    scene([element("slab", { thickness: 20, aperture: 200 })]),
    input([0, 0, 0], angleDirection(critical, 0)),
    { maxInteractions: 1 },
  );
  assert.equal(tangent.hits[0].event, "refract");
  near(tangent.hits[0].outgoing[0], 0, 3e-8);
  report({
    criticalDegrees: fmt(critical),
    nearestOffsetsDegrees: [-1e-9, 1e-9],
    cases,
    tirHits,
  });
});

test("Plane-parallel slab: independent displacement in several azimuths and frames", () => {
  let cases = 0,
    maximumAbsoluteError = 0,
    maximumNormalizedError = 0,
    maximumParallelError = 0;
  for (const thickness of [3, 20, 73])
    for (const theta of [0, 10, 35, 60, 75])
      for (const phi of [0, 37, 90, 203, 317])
        for (const rotation of [
          [0, 0, 0],
          [17, -23, 39],
        ]) {
          const slab = element("slab", {
            thickness,
            aperture: 1000,
            position: [4, -3, 7],
            rotation,
          });
          const d = angleDirection(theta, phi),
            entry = [-thickness / 2, 0, 0];
          const ray = trace(
            scene([slab]),
            input(world(sub(entry, scale(d, 5)), slab), rotate(d, rotation)),
          );
          assert.equal(ray.hits.length, 2);
          assert.equal(ray.termination, "escaped");
          assert.deepEqual(
            ray.hits.map((h) => h.event),
            ["refract", "refract"],
          );
          assert.deepEqual(
            ray.hits.map((h) => h.surface),
            ["front", "back"],
          );
          const refracted = Math.asin(Math.sin(theta * rad) / 1.5);
          const expectedExit = [
            thickness / 2,
            thickness * Math.tan(refracted) * Math.cos(phi * rad),
            thickness * Math.tan(refracted) * Math.sin(phi * rad),
          ];
          vectorNear(ray.hits[1].position, world(expectedExit, slab), 3e-10);
          const displacement = norm(
            cross(
              sub(ray.hits[1].position, ray.hits[0].position),
              ray.direction,
            ),
          );
          const expected =
            (thickness * Math.sin(theta * rad - refracted)) /
            Math.cos(refracted);
          const error = Math.abs(displacement - expected),
            normalized = error / Math.max(1, Math.abs(expected));
          assert.ok(error <= 1e-5 + 1e-6 * Math.abs(expected));
          assert.ok(normalized <= 1e-6);
          const parallelError = norm(sub(ray.hits[1].outgoing, ray.direction));
          assert.ok(parallelError <= 3e-12);
          maximumAbsoluteError = Math.max(maximumAbsoluteError, error);
          maximumNormalizedError = Math.max(maximumNormalizedError, normalized);
          maximumParallelError = Math.max(maximumParallelError, parallelError);
          cases++;
        }
  report({
    cases,
    maximumDisplacementErrorMm: fmt(maximumAbsoluteError),
    maximumNormalizedError: fmt(maximumNormalizedError),
    maximumParallelError: fmt(maximumParallelError),
  });
});

// Ray-transfer matrices act on [height, n*angle]. Lengths are vertex-referenced.
function multiply(a, b) {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1],
    ],
  ];
}
function lensReference(n, thickness, r1, r2, objectDistance) {
  const power1 = (n - 1) / r1,
    power2 = (1 - n) / r2;
  const m = multiply(
    [
      [1, 0],
      [-power2, 1],
    ],
    multiply(
      [
        [1, thickness / n],
        [0, 1],
      ],
      [
        [1, 0],
        [-power1, 1],
      ],
    ),
  );
  const [[a, b], [c, d]] = m;
  const efl =
    1 / ((n - 1) * (1 / r1 - 1 / r2 + ((n - 1) * thickness) / (n * r1 * r2)));
  near(-1 / c, efl, 1e-12, "independent lensmaker and matrix agree");
  near(a * d - b * c, 1, 1e-12, "matrix determinant");
  const image = -(a * objectDistance + b) / (c * objectDistance + d);
  return { efl, bfl: -a / c, image, magnification: a + image * c, matrix: m };
}
function pupil(radius) {
  const points = [[0, 0]];
  for (const fraction of [0.25, 0.5, 0.75, 1])
    for (let k = 0; k < 16; k++)
      points.push([
        radius * fraction * Math.cos((2 * Math.PI * k) / 16),
        radius * fraction * Math.sin((2 * Math.PI * k) / 16),
      ]);
  return points;
}

test("Genuinely paraxial thin singlet: thick EFL, measured BFL, matrix image and magnification <1%", () => {
  const n = 1.5,
    thickness = 0.5,
    r1 = 100,
    r2 = -100,
    radius = 0.25,
    objectDistance = 300;
  const reference = lensReference(n, thickness, r1, r2, objectDistance);
  // See VERIFICATION.md: Taylor bounds plus spherical sag conservatively allow
  // 1e-6 slope error and 1e-5 mm vertex-height error, independently of traced data.
  const incidenceBound = 0.006;
  const snellRemainder = (eta) =>
    (eta * incidenceBound ** 3) / 6 +
    (eta * incidenceBound) ** 3 /
      (6 * (1 - (eta * incidenceBound) ** 2) ** 1.5);
  assert.ok(1.5 * snellRemainder(1 / 1.5) + snellRemainder(1.5) < 2.3e-7);
  const slopeBudget = 1e-6,
    heightBudget = 1e-5,
    minimumPupilHeight = radius / 4;
  const spotBudget = heightBudget + reference.image * slopeBudget;
  const envelope = {
    efl:
      (reference.efl * slopeBudget) /
      (minimumPupilHeight - reference.efl * slopeBudget),
    bfl:
      (heightBudget + reference.bfl * slopeBudget) /
      (0.998 * minimumPupilHeight - reference.bfl * slopeBudget),
    image: (2 * spotBudget) / minimumPupilHeight,
    magnification: (2 * spotBudget) / (Math.abs(reference.magnification) * 0.1),
  };
  for (const bound of Object.values(envelope))
    assert.ok(bound < 0.01, "independently budgeted relative envelope <1%");
  const lens = element("lens", {
    thickness,
    radius1: r1,
    radius2: r2,
    aperture: 10,
  });
  const rays = pupil(radius).map(([y, z], i) =>
    input([-5, y, z], [1, 0, 0], { id: `parallel-${i}` }),
  );
  const result = run(scene([lens]), { rays });
  const bfls = [],
    efls = [];
  let maxIncidence = 0;
  for (const ray of result.rays) {
    assert.deepEqual(
      ray.hits.map((h) => h.event),
      ["refract", "refract"],
    );
    for (const h of ray.hits)
      maxIncidence = Math.max(
        maxIncidence,
        Math.atan2(
          norm(cross(h.incoming, h.normal)),
          Math.abs(dot(h.incoming, h.normal)),
        ),
      );
    if (norm(ray.origin.slice(1)) === 0) continue;
    const h = ray.hits[1],
      slope = h.outgoing.slice(1).map((v) => v / h.outgoing[0]);
    bfls.push(
      h.position[0] -
        thickness / 2 -
        dot(h.position.slice(1), slope) / dot(slope, slope),
    );
    efls.push(-dot(ray.origin.slice(1), slope) / dot(slope, slope));
  }
  const bflError = Math.max(...bfls.map((v) => relative(v, reference.bfl)));
  const eflError = Math.max(...efls.map((v) => relative(v, reference.efl)));
  assert.ok(bflError < 0.01);
  assert.ok(eflError < 0.01);
  const imagingRays = [-0.05, 0, 0.05].flatMap((height, group) =>
    pupil(radius).map(([y, z], i) => {
      const origin = [-thickness / 2 - objectDistance, height, 0];
      return input(origin, sub([-thickness / 2, y, z], origin), {
        id: `object-${group}-${i}`,
        objectPointId: group,
      });
    }),
  );
  const imaging = run(scene([lens]), { rays: imagingRays });
  const groups = [0, 1, 2].map((group) =>
    imaging.rays
      .filter((r) => r.objectPointId === group)
      .map((ray) => {
        assert.equal(ray.hits.length, 2);
        for (const h of ray.hits)
          maxIncidence = Math.max(
            maxIncidence,
            Math.atan2(
              norm(cross(h.incoming, h.normal)),
              Math.abs(dot(h.incoming, h.normal)),
            ),
          );
        const h = ray.hits[1],
          slope = h.outgoing.slice(1).map((v) => v / h.outgoing[0]);
        return {
          slope,
          intercept: h.position
            .slice(1)
            .map((v, i) => v + (thickness / 2 - h.position[0]) * slope[i]),
        };
      }),
  );
  // Minimize total within-object transverse variance of exit lines, not a helper's focus result.
  let numerator = 0,
    denominator = 0;
  for (const group of groups)
    for (const axis of [0, 1]) {
      const center = mean(group.map((r) => r.intercept[axis])),
        slope = mean(group.map((r) => r.slope[axis]));
      for (const ray of group) {
        numerator += (ray.intercept[axis] - center) * (ray.slope[axis] - slope);
        denominator += (ray.slope[axis] - slope) ** 2;
      }
    }
  const measuredImage = -numerator / denominator;
  const screen = element("detector", {
    position: [thickness / 2 + measuredImage, 0, 0],
    width: 2,
    height: 2,
  });
  const detected = run(scene([lens, screen]), { rays: imagingRays });
  assert.equal(detected.spots.length, imagingRays.length);
  const imageHeights = [0, 1, 2].map((group) =>
    mean(
      detected.rays
        .filter((r) => r.objectPointId === group)
        .map((r) => r.detectorUV[0]),
    ),
  );
  const measuredMagnification = (imageHeights[2] - imageHeights[0]) / 0.1;
  const imageError = relative(measuredImage, reference.image),
    magnificationError = relative(
      measuredMagnification,
      reference.magnification,
    );
  assert.ok(imageError < 0.01);
  assert.ok(magnificationError < 0.01);
  assert.ok(maxIncidence < 0.006, "independently chosen small-angle envelope");
  assert.ok(
    thickness / reference.efl < 0.0051 && radius / Math.abs(r1) <= 0.0025,
  );
  // Thin-lens approximations also remain below 1%, rather than disguising a thick test as thin.
  const thinF = 1 / ((n - 1) * (1 / r1 - 1 / r2)),
    thinImage = 1 / (1 / thinF - 1 / objectDistance);
  assert.ok(
    relative(reference.efl, thinF) < 0.01 &&
      relative(reference.bfl, thinF) < 0.01,
  );
  assert.ok(
    relative(reference.image, thinImage) < 0.01 &&
      relative(reference.magnification, -thinImage / objectDistance) < 0.01,
  );
  const scan = focusScan(scene([lens, screen]), screen.id, {
    start: thickness / 2 + reference.image - 0.04,
    end: thickness / 2 + reference.image + 0.04,
    steps: 17,
    rays: imagingRays,
  });
  assert.ok(scan.best);
  near(
    scan.best.position - thickness / 2,
    measuredImage,
    0.00250001,
    "focus grid half-step",
  );
  let maximumMatrixSpotError = 0;
  for (const sample of scan.samples) {
    assert.equal(sample.count, imagingRays.length);
    const moved = { ...screen, position: [sample.position, 0, 0] };
    const replay = run(scene([lens, moved]), { rays: imagingRays });
    const expected = independentMetrics(replay.rays, moved);
    near(sample.rms, expected.objective, 2e-11);
    near(sample.throughput, expected.count / imagingRays.length, 0);
    if (sample === scan.samples[8])
      for (const ray of replay.rays) {
        const error = norm(
          sub(ray.detectorUV, [reference.magnification * ray.origin[1], 0]),
        );
        maximumMatrixSpotError = Math.max(maximumMatrixSpotError, error);
        assert.ok(
          error < spotBudget,
          "independent conservative paraxial spot envelope",
        );
      }
  }
  report({
    parameters: {
      n,
      thickness,
      r1,
      r2,
      pupilRadius: radius,
      objectDistance,
      objectHeights: [-0.05, 0, 0.05],
      pupilRays: rays.length,
    },
    reference: Object.fromEntries(
      Object.entries(reference)
        .filter(([key]) => key !== "matrix")
        .map(([key, value]) => [key, fmt(value)]),
    ),
    measured: {
      meanEfl: fmt(mean(efls)),
      meanBfl: fmt(mean(bfls)),
      image: fmt(measuredImage),
      magnification: fmt(measuredMagnification),
      scanImage: fmt(scan.best.position - thickness / 2),
    },
    relativeErrors: {
      maxEfl: fmt(eflError),
      maxBfl: fmt(bflError),
      image: fmt(imageError),
      magnification: fmt(magnificationError),
    },
    independentRelativeEnvelope: Object.fromEntries(
      Object.entries(envelope).map(([key, value]) => [key, fmt(value)]),
    ),
    maximumIncidenceRad: fmt(maxIncidence),
    maximumMatrixSpotErrorMm: fmt(maximumMatrixSpotError),
    scanStepMm: 0.005,
  });
});

test("Increased aperture produces spherical aberration with no throughput selection", () => {
  const lens = element("lens", {
    thickness: 0.5,
    radius1: 100,
    radius2: -100,
    aperture: 10,
  });
  const reference = lensReference(1.5, 0.5, 100, -100, 300),
    results = [];
  for (const radius of [0.25, 4.8]) {
    const rays = pupil(radius).map(([y, z], i) =>
      input([-5, y, z], [1, 0, 0], { id: `pupil-${i}` }),
    );
    const detector = element("detector", {
      position: [0.25 + reference.bfl, 0, 0],
      width: 4,
      height: 4,
    });
    const p = scene([lens, detector]),
      traced = run(p, { rays });
    assert.equal(traced.spots.length, rays.length);
    const radii = traced.rays.map((r) => norm(r.detectorUV));
    const rms = Math.sqrt(mean(radii.map((r) => r * r)));
    const marginal = traced.rays.slice(-16).map((ray) => {
      const h = ray.hits[1],
        v = h.outgoing.slice(1).map((x) => x / h.outgoing[0]);
      return h.position[0] - 0.25 - dot(h.position.slice(1), v) / dot(v, v);
    });
    const scan = focusScan(p, detector.id, {
      start: 0.25 + reference.bfl - 0.7,
      end: 0.25 + reference.bfl + 0.02,
      steps: 73,
      rays,
    });
    assert.ok(scan.best);
    assert.ok(
      scan.samples.every((s) => s.count === rays.length && s.throughput === 1),
    );
    for (const sample of scan.samples) {
      const moved = { ...detector, position: [sample.position, 0, 0] };
      const replay = run(scene([lens, moved]), { rays });
      near(sample.rms, independentMetrics(replay.rays, moved).objective, 2e-11);
    }
    results.push({
      radius,
      count: rays.length,
      rmsAtParaxialMm: rms,
      marginalBflMm: mean(marginal),
      bestBflMm: scan.best.position - 0.25,
      bestRmsMm: scan.best.rms,
    });
  }
  assert.ok(results[1].rmsAtParaxialMm > 100 * results[0].rmsAtParaxialMm);
  assert.ok(results[1].bestRmsMm > 10 * results[0].bestRmsMm);
  assert.ok(results[1].marginalBflMm < results[0].marginalBflMm - 0.1);
  assert.ok(results[1].bestBflMm < results[0].bestBflMm - 0.1);
  report({
    sampling: "4 rings x 16 azimuths + axis; 0.01 mm focus grid",
    apertures: results.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fmt(v)])),
    ),
  });
});

// Deliberately two-pass moments, unlike the tracer's incremental accumulator.
function independentMetrics(rays, detector) {
  const hits = rays.filter(
      (r) => r.termination === "detected" && r.detectorId === detector.id,
    ),
    groups = new Map();
  const points = hits.map((ray) => {
    const p = local(ray.hits.at(-1).position, detector);
    near(p[0], 0, 2e-11);
    vectorNear(ray.detectorUV, p.slice(1), 2e-11, "independent detector UV");
    const key = JSON.stringify([
      ray.sourceId,
      ray.objectPointId,
      ray.wavelength,
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p.slice(1));
    return p.slice(1);
  });
  const moments = (values) => {
    if (!values.length) return { count: 0, centroid: null, rms: null };
    const centroid = [0, 1].map((i) => mean(values.map((v) => v[i])));
    return {
      count: values.length,
      centroid,
      rms: Math.sqrt(
        mean(
          values.map(
            (v) => (v[0] - centroid[0]) ** 2 + (v[1] - centroid[1]) ** 2,
          ),
        ),
      ),
    };
  };
  const grouped = new Map(
    [...groups].map(([key, values]) => [key, moments(values)]),
  );
  return {
    ...moments(points),
    groups: grouped,
    objective: points.length
      ? Math.sqrt(
          [...grouped.values()].reduce(
            (sum, g) => sum + g.count * g.rms ** 2,
            0,
          ) / points.length,
        )
      : null,
  };
}
function checkMetric(actual, expected) {
  assert.equal(actual.count, expected.count);
  if (expected.count) {
    vectorNear(actual.centroid, expected.centroid, 2e-11);
    near(actual.rms, expected.rms, 2e-11);
  } else {
    assert.equal(actual.centroid, null);
    assert.equal(actual.rms, null);
  }
}

test("Focus and detector metrics: independent UV, grouping, fixed population, throughput, empty hits", () => {
  const detector = element("detector", {
    position: [10, 0.2, -0.3],
    rotation: [17, 9, -13],
    width: 2,
    height: 1.4,
  });
  const other = element("detector", {
    id: "other",
    position: [5, 10, 0],
    width: 1,
    height: 1,
  });
  const stop = element("stop", {
    position: [2, 0, 0],
    aperture: 0.6,
    diameter: 2,
  });
  const identities = [
    ["a", 0, 450],
    ["a", 0, 650],
    ["a", 1, 450],
    ["b", 0, 450],
  ];
  const rays = identities.flatMap(([sourceId, objectPointId, wavelength], g) =>
    Array.from({ length: 12 }, (_, k) =>
      input(
        [0, -1.4 + 0.23 * k, -0.2 + g * 0.12],
        [1, 0.012 * (k - 4), -0.006 * (k + g)],
        { id: `${g}-${k}`, sourceId, objectPointId, wavelength },
      ),
    ),
  );
  rays.push(
    input([0, 10, 0], [1, 0, 0], { id: "other-hit" }),
    input([0, 20, 20], [1, 0, 0], { id: "miss" }),
  );
  const p = scene([detector, other, stop]),
    before = clone(p),
    inputsBefore = clone(rays);
  const range = { start: 6, end: 18, steps: 7, rays },
    scan = focusScan(p, detector.id, range);
  let best = null,
    maxRmsError = 0,
    sawSeparatedExtent = false;
  const counts = [],
    observedGroups = new Set();
  for (const [i, sample] of scan.samples.entries()) {
    const position = 6 + 2 * i;
    near(sample.position, position, 0);
    const moved = {
      ...detector,
      position: [position, detector.position[1], detector.position[2]],
    };
    const result = run(scene([moved, other, stop]), { rays });
    assert.equal(result.count, 50);
    assert.ok(result.terminations.clipped > 0);
    assert.ok(result.rays.some((r) => r.detectorId === other.id));
    for (const spot of result.spots) {
      const ray = result.rays.find((r) => r.id === spot.rayId);
      assert.ok(ray);
      assert.equal(spot.detectorId, ray.detectorId);
      assert.equal(spot.sourceId, ray.sourceId);
      assert.equal(spot.objectPointId, ray.objectPointId);
      assert.equal(spot.wavelength, ray.wavelength);
      vectorNear([spot.u, spot.v], ray.detectorUV, 0);
    }
    const expected = independentMetrics(result.rays, moved),
      actual = result.metrics.find((m) => m.detectorId === detector.id);
    checkMetric(actual, expected);
    assert.equal(actual.groups.length, expected.groups.size);
    for (const group of actual.groups) {
      const key = JSON.stringify([
        group.sourceId,
        group.objectPointId,
        group.wavelength,
      ]);
      observedGroups.add(key);
      checkMetric(group, expected.groups.get(key));
    }
    assert.equal(sample.count, expected.count);
    near(sample.throughput, expected.count / rays.length, 0);
    near(sample.rms, expected.objective, 2e-11);
    maxRmsError = Math.max(
      maxRmsError,
      Math.abs(sample.rms - expected.objective),
    );
    if (expected.rms > expected.objective + 0.01) sawSeparatedExtent = true;
    counts.push(expected.count);
    const independent = {
      position,
      count: expected.count,
      throughput: expected.count / rays.length,
      rms: expected.objective,
    };
    if (
      independent.rms !== null &&
      (!best ||
        independent.rms < best.rms ||
        (independent.rms === best.rms && independent.count > best.count))
    )
      best = independent;
  }
  assert.ok(
    sawSeparatedExtent,
    "grouped objective must differ from overall object extent",
  );
  assert.equal(
    observedGroups.size,
    4,
    "exercise every component of the grouping key",
  );
  assert.ok(new Set(counts).size > 1, "test must exercise changing throughput");
  near(scan.best.position, best.position, 0);
  near(scan.best.rms, best.rms, 2e-11);
  assert.deepEqual(p, before);
  assert.deepEqual(rays, inputsBefore);
  for (const emptyRays of [
    [],
    [input([0, 20, 20], [1, 0, 0], { id: "empty-miss" })],
  ]) {
    const empty = focusScan(p, detector.id, {
      start: 6,
      end: 18,
      steps: 3,
      rays: emptyRays,
    });
    assert.equal(empty.best, null);
    for (const s of empty.samples) {
      assert.equal(s.count, 0);
      assert.equal(s.rms, null);
      assert.equal(s.throughput, 0);
    }
    for (const m of run(p, { rays: emptyRays }).metrics) {
      checkMetric(m, { count: 0, centroid: null, rms: null });
      assert.deepEqual(m.groups, []);
    }
  }
  const tieRays = [
    input([0, 0, 0], [1, 0, 0], { id: "one", objectPointId: 0 }),
    input([0, 2, 0], [1, -0.2, 0], { id: "two", objectPointId: 1 }),
  ];
  const tieDetector = element("detector", { width: 1, height: 1 });
  const tie = focusScan(scene([tieDetector]), tieDetector.id, {
    start: 5,
    end: 10,
    steps: 3,
    rays: tieRays,
  });
  assert.deepEqual(
    tie.samples.map((s) => s.count),
    [1, 2, 2],
  );
  near(tie.best.position, 7.5, 0, "ties prefer more hits, then first");
  const one = focusScan(scene([tieDetector]), tieDetector.id, {
    start: 8,
    end: 100,
    steps: 1,
    rays: tieRays,
  });
  assert.equal(one.samples.length, 1);
  near(one.samples[0].position, 8, 0);
  const source = element("source", {
    kind: "extended",
    objectHeight: 0.2,
    position: [0, 0, 0],
    spread: 5,
    samples: 17,
    wavelengths: [450, 650],
  });
  const generatedProject = scene([
    source,
    { ...tieDetector, width: 1.5, height: 1.5 },
  ]);
  const generated = generateRays(generatedProject),
    generatedRange = { start: 5, end: 15, steps: 3 };
  const generatedScan = focusScan(
    generatedProject,
    tieDetector.id,
    generatedRange,
  );
  assert.equal(generated.length, 238);
  assert.deepEqual(
    generatedScan,
    focusScan(generatedProject, tieDetector.id, {
      ...generatedRange,
      rays: generated,
    }),
  );
  for (const sample of generatedScan.samples) {
    const moved = {
      ...generatedProject.elements[1],
      position: [sample.position, 0, 0],
    };
    const replay = run(scene([source, moved]));
    const expected = independentMetrics(replay.rays, moved);
    near(sample.rms, expected.objective, 2e-11);
    near(sample.throughput, expected.count / 238, 0);
  }
  report({
    population: rays.length,
    positionsMm: scan.samples.map((s) => s.position),
    selectedHits: counts,
    throughputs: scan.samples.map((s) => s.throughput),
    maximumIndependentRmsErrorMm: fmt(maxRmsError),
    bestPositionMm: best.position,
    emptyBest: null,
  });
});

test("Prism: independent scalar Snell deviation, dispersion, B=0 identical wavelengths", () => {
  const prism = element("prism", {
    materialId: "glass",
    rotation: [0, 0, 64],
    size: 30,
    depth: 35,
    apex: 60,
  });
  const source = element("source", {
    kind: "collimated",
    beamRadius: 0.5,
    position: [-80, 0, 0],
    wavelengths: [430, 480, 530, 580, 630, 680],
    samples: 17,
  });
  const p = scene([source, prism]);
  p.materials[0] = { id: "glass", name: "Flint reference", A: 1.62, B: 0.015 };
  const deviations = [],
    inputs = generateRays(p),
    result = run(p);
  let maximumError = 0;
  for (const wavelength of source.wavelengths) {
    const n = 1.62 + 0.015 / (wavelength / 1000) ** 2;
    near(refractiveIndex(p.materials[0], wavelength), n, 1e-14);
    const incidence = 56 * rad,
      internal1 = Math.asin(Math.sin(incidence) / n),
      internal2 = 60 * rad - internal1;
    assert.ok(n * Math.sin(internal2) < 1, "reference must transmit");
    const emergence = Math.asin(n * Math.sin(internal2)),
      expected = incidence + emergence - 60 * rad;
    for (const ray of result.rays.filter((r) => r.wavelength === wavelength)) {
      assert.equal(ray.termination, "escaped");
      assert.deepEqual(
        ray.hits.map((h) => h.surface),
        ["face-1", "face-0"],
      );
      assert.deepEqual(
        ray.hits.map((h) => h.event),
        ["refract", "refract"],
      );
      const outgoing = ray.hits[1].outgoing,
        measured = -Math.atan2(outgoing[1], outgoing[0]);
      near(measured, expected, 1e-10, "scalar prism deviation");
      near(outgoing[2], 0, 2e-12);
      near(ray.hits[0].n2, n, 1e-14);
      near(ray.hits[1].n1, n, 1e-14);
      maximumError = Math.max(maximumError, Math.abs(measured - expected));
    }
    deviations.push({
      wavelengthNm: wavelength,
      index: fmt(n),
      expectedDeviationDegrees: fmt(expected / rad),
    });
  }
  assert.ok(
    deviations.every(
      (v, i) =>
        i === 0 ||
        v.expectedDeviationDegrees < deviations[i - 1].expectedDeviationDegrees,
    ),
  );
  for (let k = 0; k < source.samples; k++)
    for (let w = 1; w < source.wavelengths.length; w++) {
      assert.deepEqual(inputs[k].origin, inputs[w * source.samples + k].origin);
      assert.deepEqual(
        inputs[k].direction,
        inputs[w * source.samples + k].direction,
      );
    }
  const nondispersive = clone(p);
  nondispersive.materials[0].B = 0;
  const flat = run(nondispersive);
  for (let k = 0; k < source.samples; k++)
    for (let w = 1; w < source.wavelengths.length; w++) {
      const a = flat.rays[k],
        b = flat.rays[w * source.samples + k];
      assert.deepEqual(a.origin, b.origin);
      assert.deepEqual(a.direction, b.direction);
      assert.deepEqual(a.points, b.points);
      assert.deepEqual(a.hits, b.hits);
      near(a.pathLength, b.pathLength, 0);
      assert.equal(a.termination, b.termination);
    }
  report({
    raysPerMaterial: result.count,
    deviations,
    maximumDeviationErrorRad: fmt(maximumError),
    nondispersiveTrajectoryComparison: "bit-identical",
  });
});

test("Finite stops, detector misses/edges, cylindrical rims and prism end caps", () => {
  const stop = element("stop", {
    position: [0, 0, 0],
    aperture: 4,
    diameter: 10,
  });
  const detector = element("detector", {
    position: [5, 0, 0],
    width: 30,
    height: 30,
  });
  for (const [radius, expected] of [
    [0, "detected"],
    [1.999, "detected"],
    [2, "clipped"],
    [3, "clipped"],
    [5, "clipped"],
    [5.001, "detected"],
    [6, "detected"],
  ]) {
    const ray = trace(
      scene([stop, detector]),
      input([-5, radius, 0], [1, 0, 0]),
    );
    assert.equal(ray.termination, expected);
    assert.equal(ray.hits.length, 1);
    assert.equal(
      ray.hits[0].elementId,
      expected === "clipped" ? stop.id : detector.id,
    );
  }
  const closed = { ...stop, aperture: 0 };
  assert.equal(
    trace(scene([closed]), input([-5, 0, 0], [1, 0, 0])).termination,
    "clipped",
  );
  const small = { ...detector, width: 2, height: 4 };
  for (const [y, z, expected] of [
    [0, 0, "detected"],
    [1, 2, "detected"],
    [1.0001, 0, "escaped"],
    [0, 2.0001, "escaped"],
  ]) {
    const ray = trace(scene([small]), input([0, y, z], [1, 0, 0]));
    assert.equal(ray.termination, expected);
    assert.equal(ray.hits.length, expected === "detected" ? 1 : 0);
  }
  assert.equal(
    trace(scene([small]), input([0, 0, 0], [0, 1, 0])).termination,
    "escaped",
  );
  assert.equal(
    trace(scene([small]), input([0, 0, 0], [-1, 0, 0])).termination,
    "escaped",
  );
  for (const type of ["slab", "lens"]) {
    const solid = element(type, {
      thickness: 6,
      aperture: 20,
      radius1: 50,
      radius2: -50,
    });
    for (const [origin, direction, before] of [
      [[0, 12, 0], [0, -1, 0], null],
      [[0, 0, 0], [0, 1, 0], solid.id],
    ]) {
      const ray = trace(scene([solid]), input(origin, direction));
      assert.equal(ray.termination, "absorbed");
      assert.equal(ray.hits.length, 1);
      assert.equal(ray.hits[0].surface, "rim");
      assert.equal(ray.hits[0].mediumBefore, before);
      near(norm(ray.hits[0].position.slice(1)), 10, 1e-12);
    }
    const miss = trace(scene([solid]), input([-10, 11, 0], [1, 0, 0]));
    assert.equal(miss.hits.length, 0);
  }
  const prism = element("prism", { materialId: "glass", size: 20, depth: 10 });
  for (const side of [-1, 1]) {
    const ray = trace(scene([prism]), input([0, 0, 0], [0, 0, side]));
    assert.equal(ray.termination, "absorbed");
    assert.equal(ray.hits[0].surface, side < 0 ? "cap-minus" : "cap-plus");
    vectorNear(ray.hits[0].position, [0, 0, side * 5], 1e-12);
  }
  // Coincident non-solids are legal; absorbing/clipping events must win even if listed last.
  const coincident = { ...detector, position: [0, 0, 0] };
  for (const elements of [
    [coincident, closed],
    [closed, coincident],
  ]) {
    assert.equal(
      trace(scene(elements), input([-5, 0, 0], [1, 0, 0])).termination,
      "clipped",
    );
  }
  const slab = element("slab", { thickness: 6, aperture: 20 });
  const rimDetector = {
    ...detector,
    position: [0, 10, 0],
    rotation: [0, 0, 90],
  };
  assert.equal(
    trace(scene([rimDetector, slab]), input([0, 12, 0], [0, -1, 0]))
      .termination,
    "absorbed",
  );
  report({
    stopCases: 8,
    detectorCases: 6,
    rimCases: 4,
    solidMisses: 2,
    prismCaps: 2,
    coincidentPriorityCases: 3,
  });
});

test("Termination limits, repeated internal reflections, boundary launches, very close surfaces", () => {
  const slab = element("slab", { thickness: 1, aperture: 200 });
  const launch = input([0, 0, 0], angleDirection(60, 37));
  const limited = trace(scene([slab]), launch, { maxInteractions: 12 });
  assert.equal(limited.termination, "interaction-limited");
  assert.equal(limited.hits.length, 12);
  const complete = trace(scene([slab]), launch, { maxInteractions: 200 });
  assert.equal(complete.termination, "absorbed");
  assert.equal(complete.hits.at(-1).surface, "rim");
  const bounces = complete.hits.slice(0, -1);
  assert.ok(bounces.length > 50);
  for (const [i, hit] of bounces.entries()) {
    assert.equal(hit.event, "tir");
    assert.equal(hit.surface, i % 2 ? "front" : "back");
    assert.equal(hit.mediumBefore, slab.id);
    assert.equal(hit.mediumAfter, slab.id);
    near(hit.position[0], i % 2 ? -0.5 : 0.5, 2e-12);
  }
  const mirrors = [
    element("mirror", { id: "left", position: [0, 0, 0] }),
    element("mirror", { id: "right", position: [1, 0, 0] }),
  ];
  const trapped = trace(scene(mirrors), input([0.5, 0, 0], [1, 0, 0]), {
    maxInteractions: 101,
  });
  assert.equal(trapped.hits.length, 101);
  assert.equal(trapped.termination, "interaction-limited");
  near(trapped.pathLength, 100.5, 1e-12);
  for (const [i, hit] of trapped.hits.entries())
    assert.equal(hit.elementId, i % 2 ? "left" : "right");
  const zero = trace(scene(mirrors), input([0.5, 0, 0], [1, 0, 0]), {
    maxInteractions: 0,
  });
  assert.equal(zero.termination, "interaction-limited");
  assert.equal(zero.hits.length, 0);
  near(zero.pathLength, 0, 0);
  const path = trace(scene(mirrors), input([0.5, 0, 0], [1, 0, 0]), {
    maxPath: 3.2,
  });
  assert.equal(path.termination, "path-limited");
  near(path.pathLength, 3.2, 1e-12);
  const free = trace(scene([]), input([0, 0, 0], [1, 0, 0]), {
    maxPath: 2,
    escapeDistance: 3,
  });
  assert.equal(free.termination, "path-limited");
  near(free.pathLength, 2, 0);
  const far = element("detector", { position: [10, 0, 0] });
  const notReached = trace(scene([far]), input([0, 0, 0], [1, 0, 0]), {
    maxPath: 2,
  });
  assert.equal(notReached.termination, "path-limited");
  assert.equal(notReached.hits.length, 0);
  for (const [origin, direction, before, after] of [
    [[-0.5, 0, 0], [1, 0, 0], null, slab.id],
    [[0.5, 0, 0], [1, 0, 0], slab.id, null],
    [[-0.5, 0, 0], [-1, 0, 0], slab.id, null],
  ]) {
    const ray = trace(scene([slab]), input(origin, direction), {
      maxInteractions: 1,
    });
    assert.equal(ray.hits.length, 1);
    near(ray.pathLength, 0, 0);
    vectorNear(ray.hits[0].position, origin, 0);
    assert.equal(ray.hits[0].mediumBefore, before);
    assert.equal(ray.hits[0].mediumAfter, after);
  }
  const gap = 1e-9,
    closeA = element("slab", { id: "a", thickness: 1, aperture: 10 }),
    closeB = element("slab", {
      id: "b",
      thickness: 1,
      aperture: 10,
      position: [1 + gap, 0, 0],
    });
  const detector = element("detector", { position: [1.5 + 2 * gap, 0, 0] });
  const close = trace(
    scene([closeA, closeB, detector]),
    input([-2, 0, 0], [1, 0, 0]),
  );
  assert.equal(close.termination, "detected");
  assert.deepEqual(
    close.hits.map((h) => h.elementId),
    ["a", "a", "b", "b", detector.id],
  );
  vectorNear(
    close.hits.map((h) => h.position[0]),
    [-0.5, 0.5, 0.5 + gap, 1.5 + gap, 1.5 + 2 * gap],
    1e-15,
  );
  near(close.hits[2].position[0] - close.hits[1].position[0], gap, 1e-15);
  near(close.hits[4].position[0] - close.hits[3].position[0], gap, 1e-15);
  const tiny = element("slab", { thickness: 1e-9, aperture: 1 });
  const thin = trace(scene([tiny]), input([-1, 0, 0], [1, 0, 0]));
  assert.equal(thin.hits.length, 2);
  near(thin.hits[1].position[0] - thin.hits[0].position[0], 1e-9, 1e-15);
  const nearlyPlane = element("lens", {
    thickness: 1e-6,
    radius1: 1e8,
    radius2: -1e8,
    aperture: 1,
  });
  const flat = trace(scene([nearlyPlane]), input([-1, 0.2, 0], [1, 0, 0]));
  assert.deepEqual(
    flat.hits.map((h) => h.surface),
    ["front", "back"],
  );
  assert.equal(flat.termination, "escaped");
  vectorNear(flat.hits[1].outgoing, [1, -2e-9, 0], 1e-14);
  trace(scene([]), input([0, 0, 0], [1e308, -1e308, 1e308]));
  report({
    internalTirBounces: bounces.length,
    internalTermination: complete.termination,
    mirrorReflections: trapped.hits.length,
    closeSurfaceGapMm: gap,
    thinSlabMm: 1e-9,
    nearPlanarLensRadiiMm: [1e8, -1e8],
    nearPlanarLensThicknessMm: 1e-6,
  });
});

test("Validation/import boundary: geometry errors, dangling refs, versions, Infinity, JSON round trips", () => {
  let rejected = 0;
  const bad = (label, mutate, pattern) => {
    const p = createProject();
    mutate(p);
    const validation = validateProject(p);
    assert.equal(validation.valid, false, `${label} accepted`);
    assert.ok(validation.errors.length > 0);
    if (pattern) assert.match(validation.errors.join("\n"), pattern, label);
    assert.throws(() => traceProject(p), undefined, label);
    rejected++;
  };
  for (const value of [0, 2, "1", null, undefined])
    bad(
      `version ${value}`,
      (p) => {
        p.version = value;
      },
      /version/,
    );
  bad(
    "units",
    (p) => {
      p.units = "cm";
    },
    /units/,
  );
  bad(
    "dangling material",
    (p) => {
      p.elements.find((e) => e.type === "lens").materialId = "missing";
    },
    /materialId/,
  );
  bad(
    "deleted referenced material",
    (p) => {
      p.materials = [];
    },
    /materialId/,
  );
  bad(
    "duplicate material",
    (p) => {
      p.materials.push(clone(p.materials[0]));
    },
    /Duplicate material/,
  );
  bad(
    "duplicate element",
    (p) => {
      p.elements.push(clone(p.elements[0]));
    },
    /Duplicate element/,
  );
  bad(
    "unknown type",
    (p) => {
      p.elements[0].type = "banana";
    },
    /unknown type/,
  );
  bad(
    "missing name",
    (p) => {
      p.elements[0].name = "";
    },
    /name/,
  );
  for (const field of ["position", "rotation"])
    for (const value of [Infinity, -Infinity, NaN])
      bad(
        `${field} ${value}`,
        (p) => {
          p.elements[0][field][1] = value;
        },
        /finite/,
      );
  bad(
    "short vector",
    (p) => {
      p.elements[0].position = [0, 0];
    },
    /three finite/,
  );
  bad(
    "oversized coordinate",
    (p) => {
      p.elements[0].position[0] = 1e10;
    },
    /magnitude/,
  );
  for (const value of [0, -1, Infinity, NaN])
    bad(
      `ambient ${value}`,
      (p) => {
        p.ambient = value;
      },
      /Ambient/,
    );
  for (const field of ["A", "B"])
    bad(
      `material ${field}`,
      (p) => {
        p.materials[0][field] = Infinity;
      },
      /finite/,
    );
  bad(
    "nonpositive Cauchy index",
    (p) => {
      p.materials[0].B = -1;
    },
    /invalid refractive index/,
  );
  for (const [field, value] of [
    ["thickness", 0],
    ["thickness", -1],
    ["thickness", Infinity],
    ["aperture", -1],
    ["radius1", Infinity],
    ["radius2", NaN],
    ["radius1", 1],
    ["thickness", 1],
  ])
    bad(
      `lens ${field} ${value}`,
      (p) => {
        p.elements.find((e) => e.type === "lens")[field] = value;
      },
      /finite|positive|radius|intersect/,
    );
  bad(
    "unresolved dimension",
    (p) => {
      p.elements.find((e) => e.type === "lens").thickness = 1e-16;
    },
    /resolution/,
  );
  bad(
    "overlap",
    (p) => {
      p.elements.push(element("slab", { id: "overlap" }));
    },
    /overlapping/,
  );
  bad(
    "touching solids",
    (p) => {
      p.elements = [
        element("slab", { id: "a", thickness: 2 }),
        element("slab", { id: "b", thickness: 2, position: [2, 0, 0] }),
      ];
    },
    /touching/,
  );
  bad(
    "conservative rotated overlap",
    (p) => {
      p.elements = [
        element("slab", {
          id: "a",
          thickness: 1,
          aperture: 20,
          rotation: [0, 0, 45],
        }),
        element("slab", {
          id: "b",
          thickness: 1,
          aperture: 20,
          rotation: [0, 0, 45],
          position: [2, 0, 0],
        }),
      ];
    },
    /conservative/,
  );
  for (const apex of [0, 180, Infinity, 1e-15])
    bad(
      `prism apex ${apex}`,
      (p) => {
        p.elements = [element("prism", { apex })];
      },
      /apex|resolution/,
    );
  bad(
    "stop aperture",
    (p) => {
      p.elements = [element("stop", { aperture: 10, diameter: 5 })];
    },
    /outer diameter/,
  );
  bad(
    "detector width",
    (p) => {
      p.elements = [element("detector", { width: 0 })];
    },
    /positive/,
  );
  for (const samples of [0, 1.5, 100001])
    bad(
      `samples ${samples}`,
      (p) => {
        p.elements[0].samples = samples;
      },
      /samples/,
    );
  for (const wavelengths of [
    [],
    [0],
    [NaN],
    [Infinity],
    [550, 550],
    Array(33).fill(550),
  ])
    bad(
      "wavelengths",
      (p) => {
        p.elements[0].wavelengths = wavelengths;
      },
      /wavelength/,
    );
  bad(
    "population cap",
    (p) => {
      p.elements[0].samples = 100000;
    },
    /population/,
  );
  bad(
    "source spread",
    (p) => {
      p.elements[0].spread = 181;
    },
    /spread/,
  );
  bad(
    "source kind",
    (p) => {
      p.elements[0].kind = "laser";
    },
    /kind/,
  );
  bad(
    "extended object height",
    (p) => {
      p.elements[0].objectHeight = 0;
    },
    /objectHeight/,
  );
  for (const p of [
    null,
    [],
    "text",
    {},
    { version: 1, units: "mm", ambient: 1, materials: null, elements: null },
  ]) {
    assert.equal(validateProject(p).valid, false);
    rejected++;
  }
  assert.throws(() => JSON.parse("{not JSON}"), SyntaxError);
  const infinity = createProject();
  infinity.elements[0].position[0] = Infinity;
  assert.equal(
    validateProject(JSON.parse(JSON.stringify(infinity))).valid,
    false,
    "JSON maps Infinity to null, not a valid coordinate",
  );
  assert.throws(() => JSON.parse('{"version":Infinity}'), SyntaxError);
  const overflow = JSON.parse(
    '{"version":1,"units":"mm","ambient":1e400,"materials":[],"elements":[]}',
  );
  assert.equal(validateProject(overflow).valid, false);
  const p = scene([element("detector")]),
    ray = input([0, 0, 0], [1, 0, 0], { id: "duplicate" });
  for (const options of [
    { maxInteractions: -1 },
    { maxInteractions: 1.5 },
    { maxInteractions: Infinity },
    { maxPath: 0 },
    { maxPath: Infinity },
    { escapeDistance: NaN },
    { rays: {} },
    { rays: [ray, ray] },
  ])
    assert.throws(
      () => traceProject(p, options),
      undefined,
      `invalid options ${JSON.stringify(options)}`,
    );
  for (const invalid of [
    input([Infinity, 0, 0], [1, 0, 0]),
    input([0, 0, 0], [0, 0, 0]),
    input([0, 0, 0], [NaN, 0, 0]),
    input([0, 0, 0], [1, 0, 0], { wavelength: 0 }),
    input([0, 0, 0], [1, 0, 0], { wavelength: Infinity }),
  ])
    assert.throws(() => traceRay(p, invalid));
  for (const args of [
    [[1, 0, 0], [0, 0, 0], 1, 1.5],
    [[1, 0, 0], [1, 0, 0], 0, 1.5],
    [[Infinity, 0, 0], [1, 0, 0], 1, 1.5],
  ])
    assert.throws(() => refract(...args));
  for (const range of [
    { start: NaN, end: 1, steps: 3 },
    { start: 0, end: Infinity, steps: 3 },
    { start: 0, end: 1, steps: 0 },
    { start: 0, end: 1, steps: 1002 },
  ])
    assert.throws(() => focusScan(p, p.elements[0].id, range));
  assert.throws(
    () => focusScan(p, "missing-detector", { start: 0, end: 1, steps: 3 }),
    /Unknown detector/,
  );
  assert.throws(
    () =>
      focusScan(scene([element("mirror")]), "mirror-0", {
        start: 0,
        end: 1,
        steps: 3,
      }),
    /Unknown detector/,
  );
  report({
    rejectedProjectFixtures: rejected,
    extraChecks:
      "malformed/overflow JSON, nonfinite rays/indices/options, dangling detector IDs",
  });
});

test("Factories, every example, JSON round-trip behavior, immutable deterministic populations", () => {
  const summary = [];
  const fresh = createProject(),
    untouched = createProject();
  fresh.materials[0].A = 7;
  fresh.elements[0].position[0] = 999;
  fresh.elements[0].wavelengths.push(700);
  assert.deepEqual(
    createProject(),
    untouched,
    "factory must return independent nested state",
  );
  for (const type of [
    "source",
    "lens",
    "slab",
    "prism",
    "mirror",
    "stop",
    "detector",
  ]) {
    const e = createElement(type, 7),
      p = createProject();
    p.elements = [e];
    assert.equal(validateProject(p).valid, true, `default ${type}`);
    assert.equal(e.id, `${type}-7`);
  }
  for (const args of [["unknown"], [null], ["lens", -1], ["lens", 1.5]])
    assert.throws(() => createElement(...args));
  assert.equal(new Set(EXAMPLES.map((e) => e.id)).size, EXAMPLES.length);
  for (const { id, project: p } of [
    { id: "createProject()", project: createProject() },
    ...EXAMPLES,
  ]) {
    const snapshot = clone(p),
      validation = validateProject(p);
    assert.equal(
      validation.valid,
      true,
      `${id}: ${validation.errors.join("; ")}`,
    );
    const imported = JSON.parse(JSON.stringify(p));
    assert.deepEqual(imported, p);
    assert.equal(validateProject(imported).valid, true);
    const generated = generateRays(p);
    assert.deepEqual(generateRays(p), generated);
    assert.equal(new Set(generated.map((r) => r.id)).size, generated.length);
    const expectedCount = p.elements
      .filter((e) => e.type === "source")
      .reduce(
        (sum, e) =>
          sum +
          e.samples * e.wavelengths.length * (e.kind === "extended" ? 7 : 1),
        0,
      );
    assert.equal(generated.length, expectedCount);
    for (const ray of generated) {
      assert.ok(
        ray.origin.every(Number.isFinite) &&
          ray.direction.every(Number.isFinite),
      );
      near(norm(ray.direction), 1, 2e-12);
      const source = p.elements.find((e) => e.id === ray.sourceId),
        o = local(ray.origin, source),
        d = rotate(ray.direction, source.rotation, true);
      if (source.kind === "collimated") {
        near(o[0], 0, 2e-11);
        assert.ok(norm(o.slice(1)) <= source.beamRadius + 2e-11);
        vectorNear(d, [1, 0, 0], 2e-12);
      } else {
        assert.ok(
          Math.atan2(norm(d.slice(1)), d[0]) <= source.spread * rad + 2e-12,
        );
        const h = source.objectHeight;
        const points =
          source.kind === "point"
            ? [[0, 0, 0]]
            : [
                [0, -h / 2, 0],
                [0, -h / 4, 0],
                [0, 0, 0],
                [0, h / 4, 0],
                [0, h / 2, 0],
                [0, h / 4, -h / 4],
                [0, h / 4, h / 4],
              ];
        vectorNear(
          o,
          points[ray.objectPointId],
          2e-11,
          "independent object emitter position",
        );
      }
    }
    const first = run(p),
      second = run(imported);
    assert.equal(first.count, expectedCount);
    assert.deepEqual(first.rays, second.rays);
    assert.deepEqual(first.spots, second.spots);
    assert.deepEqual(first.metrics, second.metrics);
    assert.deepEqual(
      p,
      snapshot,
      "trace/generation/validation must not mutate project",
    );
    for (const detector of p.elements.filter((e) => e.type === "detector")) {
      const expected = independentMetrics(first.rays, detector),
        actual = first.metrics.find((m) => m.detectorId === detector.id);
      checkMetric(actual, expected);
      assert.equal(actual.groups.length, expected.groups.size);
      for (const group of actual.groups)
        checkMetric(
          group,
          expected.groups.get(
            JSON.stringify([
              group.sourceId,
              group.objectPointId,
              group.wavelength,
            ]),
          ),
        );
    }
    summary.push({
      id,
      rays: first.count,
      detected: first.terminations.detected,
      clipped: first.terminations.clipped,
      absorbed: first.terminations.absorbed,
      escaped: first.terminations.escaped,
      interactionLimited: first.terminations["interaction-limited"],
      pathLimited: first.terminations["path-limited"],
    });
  }
  for (const rotation of [
    [0, 0, 0],
    [21, -33, 72],
    [90, 90, 90],
    [-180, 270, -450],
  ]) {
    const e = element("detector", { position: [3, -5, 8], rotation });
    for (const v of [
      [0, 0, 0],
      [1, 2, 3],
      [-5, 0.25, 9],
    ]) {
      vectorNear(toWorld(v, e), world(v, e), 2e-12);
      vectorNear(directionToWorld(v, e), rotate(v, rotation), 2e-12);
      vectorNear(toLocal(world(v, e), e), v, 2e-12);
    }
  }
  report({ examples: summary });
});

test("Factory rejects unknown types inherited from Object.prototype", () => {
  const accepted = [];
  for (const type of ["__proto__", "constructor", "toString"]) {
    try {
      createElement(type);
      accepted.push(type);
    } catch (error) {
      assert.match(error.message, /Unknown element type/);
    }
  }
  report({ incorrectlyAcceptedTypes: accepted });
  assert.deepEqual(
    accepted,
    [],
    "src/examples.js:18 must reject inherited names as unknown element types",
  );
});

let failed = 0;
const started = performance.now();
console.log(
  "Independent optical numerical regression (mm, nm, radians unless labeled)",
);
for (const { name, body } of tests) {
  try {
    body();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
}
console.log(
  `${tests.length - failed}/${tests.length} groups passed; ${checkedRays} traced rays checked for finite data and explicit termination; ${(performance.now() - started).toFixed(0)} ms`,
);
if (failed) process.exitCode = 1;
