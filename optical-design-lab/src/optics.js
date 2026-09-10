/**
 * Independent geometric optics, in millimeters. Local +X is the optical axis.
 * Euler XYZ means active Rx, then Ry, then Rz; positions are element centers.
 * Lens/slab vertices are x = +/- thickness/2. A signed spherical radius R has
 * its center at vertex + R; R=0 is planar. All apertures are DIAMETERS.
 * Lens/slab cylindrical rims and prism Z end caps absorb. Mirrors are two-sided.
 * Stops clip on their annulus, not outside their outer diameter. Finite detector
 * misses are not hits. Detector coordinates are u=local Y, v=local Z.
 * Hit media are solid ELEMENT ids, or null for ambient. n2 is the attempted
 * transmitted index even on TIR, while mediumAfter remains mediumBefore.
 * Events are refract, tir, reflect, absorb, clip, detect; terminal hits have
 * outgoing=null. At coincident surfaces, absorption/clipping/detection win.
 * Ray origin/direction remain the launch state; points/hits describe propagation.
 * No launch or hit positions are nudged. Only roundoff-scale roots are excluded
 * after a hit; the first hit may be at t=0 (launch exactly on a surface).
 */

const DEG = Math.PI / 180;
const EPS = Number.EPSILON;
const MAX_COORD = 1e9;
const MAX_RAYS = 1000000;
const TYPES = new Set([
  "source",
  "lens",
  "slab",
  "prism",
  "mirror",
  "stop",
  "detector",
]);
const SOLIDS = new Set(["lens", "slab", "prism"]);
const TERMINATIONS = [
  "escaped",
  "absorbed",
  "detected",
  "clipped",
  "interaction-limited",
  "path-limited",
];
const HIT_PRIORITY = { absorb: 3, clip: 2, detect: 1, refract: 0, reflect: 0 };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const mul = (a, s) => a.map((x) => x * s);
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const vec3 = (v) =>
  Array.isArray(v) && v.length === 3 && [0, 1, 2].every((i) => finite(v[i]));
const tolerance = (...values) => 8 * EPS * Math.max(1, ...values.map(Math.abs));

function unit(v, name = "vector") {
  if (!vec3(v)) throw new Error(`${name} must be a finite vec3`);
  const scale = Math.max(...v.map(Math.abs));
  if (!scale) throw new Error(`${name} must be nonzero`);
  const scaled = v.map((x) => x / scale);
  const length = Math.hypot(...scaled);
  return scaled.map((x) => x / length);
}

function matrix(element) {
  if (!vec3(element?.rotation))
    throw new Error("Element rotation must be a finite vec3");
  const [x, y, z] = element.rotation.map((a) => (a % 360) * DEG);
  const cx = Math.cos(x),
    sx = Math.sin(x);
  const cy = Math.cos(y),
    sy = Math.sin(y);
  const cz = Math.cos(z),
    sz = Math.sin(z);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

const rotate = (v, m) => m.map((row) => dot(row, v));
const unrotate = (v, m) =>
  [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2]);

export function directionToWorld(local, element) {
  if (!vec3(local)) throw new Error("Direction must be a finite vec3");
  return rotate(local, matrix(element));
}

export function toWorld(local, element) {
  if (!vec3(element?.position))
    throw new Error("Element position must be a finite vec3");
  return add(directionToWorld(local, element), element.position);
}

export function toLocal(world, element) {
  if (!vec3(world) || !vec3(element?.position))
    throw new Error("Positions must be finite vec3s");
  return unrotate(sub(world, element.position), matrix(element));
}

/** Cauchy B is in um^2; wavelength is supplied in nm. */
export function refractiveIndex(material, wavelengthNm) {
  if (!finite(wavelengthNm) || wavelengthNm <= 0)
    throw new Error("Wavelength must be positive and finite");
  if (!material || !finite(material.A) || !finite(material.B))
    throw new Error("Material requires finite A and B");
  const um = wavelengthNm / 1000;
  const n = material.A + (material.B === 0 ? 0 : material.B / (um * um));
  if (!finite(n) || n <= 0)
    throw new Error("Refractive index must be positive and finite");
  return n;
}

export function reflect(direction, normal) {
  const d = unit(direction, "Direction"),
    n = unit(normal, "Normal");
  return unit(sub(d, mul(n, 2 * dot(d, n))));
}

/** Normal orientation is immaterial; n1/n2 always describe incident/next media. */
export function refract(direction, normal, n1, n2) {
  if (![n1, n2].every((n) => finite(n) && n > 0))
    throw new Error("Indices must be positive and finite");
  const d = unit(direction, "Direction");
  let n = unit(normal, "Normal");
  if (dot(d, n) > 0) n = mul(n, -1);
  if (n1 === n2) return { direction: d, tir: false };
  const cosI = Math.max(0, Math.min(1, -dot(d, n)));
  const tangent = add(d, mul(n, cosI));
  const sinI = Math.hypot(...tangent);
  if (sinI === 0) return { direction: mul(n, -1), tir: false };
  const sinT = (n1 * sinI) / n2;
  if (sinT > 1 + 8 * EPS) return { direction: reflect(d, n), tir: true };
  const s = Math.min(1, sinT);
  return {
    direction: unit(
      sub(mul(tangent, s / sinI), mul(n, Math.sqrt(Math.max(0, 1 - s * s)))),
    ),
    tir: false,
  };
}

// Rationalized sag avoids cancellation for nearly planar spherical surfaces.
function sag(radius, radial) {
  if (radius === 0) return 0;
  const r = Math.abs(radius);
  return (
    Math.sign(radius) *
    radial *
    (radial / (r + Math.sqrt(Math.max(0, (r - radial) * (r + radial)))))
  );
}

/**
 * Local XY triangle, counterclockwise. `size` is its full X extent; the apex
 * points along +X, has interior angle `apex` degrees, and the base lies at
 * -size/2. Half base height = size*tan(apex/2). Z extent is +/- depth/2.
 * The three extruded triangle edges refract; the finite-depth end caps absorb.
 */
export function prismVertices(e) {
  const h = e.size * Math.tan((e.apex * DEG) / 2);
  return [
    [-e.size / 2, -h],
    [e.size / 2, 0],
    [-e.size / 2, h],
  ];
}

/** Seven independent emitters forming an arrow in YZ; ids are their indices. */
export function objectPoints(source) {
  if (source.kind !== "extended") return [[0, 0, 0]];
  const h = source.objectHeight;
  return [
    [0, -h / 2, 0],
    [0, -h / 4, 0],
    [0, 0, 0],
    [0, h / 4, 0],
    [0, h / 2, 0],
    [0, h / 4, -h / 4],
    [0, h / 4, h / 4],
  ];
}

export function elementBounds(e) {
  let min, max;
  if (e.type === "lens" || e.type === "slab") {
    const a = e.aperture / 2,
      t = e.thickness / 2;
    const s1 = e.type === "lens" ? sag(e.radius1, a) : 0;
    const s2 = e.type === "lens" ? sag(e.radius2, a) : 0;
    min = [Math.min(-t, -t + s1, t, t + s2), -a, -a];
    max = [Math.max(-t, -t + s1, t, t + s2), a, a];
  } else if (e.type === "prism") {
    const vertices = prismVertices(e).flatMap(([x, y]) => [
      [x, y, -e.depth / 2],
      [x, y, e.depth / 2],
    ]);
    const world = vertices.map((p) => toWorld(p, e));
    return {
      min: [0, 1, 2].map((i) => Math.min(...world.map((p) => p[i]))),
      max: [0, 1, 2].map((i) => Math.max(...world.map((p) => p[i]))),
    };
  } else if (e.type === "mirror") {
    const a = e.aperture / 2,
      s = sag(e.radius, a);
    min = [Math.min(0, s), -a, -a];
    max = [Math.max(0, s), a, a];
  } else if (e.type === "stop") {
    min = [0, -e.diameter / 2, -e.diameter / 2];
    max = [0, e.diameter / 2, e.diameter / 2];
  } else if (e.type === "detector") {
    min = [0, -e.width / 2, -e.height / 2];
    max = [0, e.width / 2, e.height / 2];
  } else if (e.type === "source") {
    const points = objectPoints(e);
    const r = e.kind === "collimated" ? e.beamRadius : 0;
    min = [
      0,
      Math.min(-r, ...points.map((p) => p[1])),
      Math.min(-r, ...points.map((p) => p[2])),
    ];
    max = [
      0,
      Math.max(r, ...points.map((p) => p[1])),
      Math.max(r, ...points.map((p) => p[2])),
    ];
  } else {
    throw new Error(`Unknown element type: ${e.type}`);
  }
  const m = matrix(e),
    corners = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]])
        corners.push(add(rotate([x, y, z], m), e.position));
  return {
    min: [0, 1, 2].map((i) => Math.min(...corners.map((p) => p[i]))),
    max: [0, 1, 2].map((i) => Math.max(...corners.map((p) => p[i]))),
  };
}

/** Strict import validation. Overlapping/touching solid world AABBs are rejected
 * conservatively (even if the actual rotated solids might not intersect).
 * Coordinates/dimensions are bounded to 1e9 mm, sources to 1e6 total rays.
 * Nonzero dimensions must exceed roundoff resolution at the element position.
 */
export function validateProject(project) {
  const errors = [];
  if (!project || typeof project !== "object" || Array.isArray(project))
    return { valid: false, errors: ["Project must be an object"] };
  if (project.version !== 1) errors.push("Project version must be 1");
  if (project.units !== "mm") errors.push("Project units must be mm");
  if (!finite(project.ambient) || project.ambient <= 0)
    errors.push("Ambient index must be positive and finite");
  if (!Array.isArray(project.materials))
    errors.push("Materials must be an array");
  if (!Array.isArray(project.elements))
    errors.push("Elements must be an array");
  const materials = new Map(),
    ids = new Set(),
    solids = [],
    wavelengths = new Set([550]);
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  const length = (e, key, label, zero = false) => {
    if (
      !finite(e[key]) ||
      (zero ? e[key] < 0 : e[key] <= 0) ||
      e[key] > MAX_COORD
    )
      errors.push(
        `${label}.${key} must be ${zero ? "nonnegative" : "positive"}, finite, and <= ${MAX_COORD} mm`,
      );
    else if (
      e[key] > 0 &&
      e[key] <= 4 * tolerance(...(vec3(e.position) ? e.position : [0]))
    )
      errors.push(
        `${label}.${key} is below numerical resolution at this position`,
      );
  };
  for (const [i, m] of (Array.isArray(project.materials)
    ? project.materials
    : []
  ).entries()) {
    const label = `Material ${i}`;
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!text(m.id)) errors.push(`${label} requires a nonempty string id`);
    else if (materials.has(m.id)) errors.push(`Duplicate material id: ${m.id}`);
    else materials.set(m.id, m);
    if (!text(m.name)) errors.push(`${label} requires a name`);
    if (!finite(m.A) || m.A <= 0)
      errors.push(`${label}.A must be positive and finite`);
    if (!finite(m.B)) errors.push(`${label}.B must be finite (um^2)`);
  }
  let population = 0;
  for (const [i, e] of (Array.isArray(project.elements)
    ? project.elements
    : []
  ).entries()) {
    const before = errors.length,
      label = `Element ${i}${e?.id ? ` (${e.id})` : ""}`;
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!text(e.id)) errors.push(`${label} requires a nonempty string id`);
    else if (ids.has(e.id)) errors.push(`Duplicate element id: ${e.id}`);
    else ids.add(e.id);
    if (!text(e.name)) errors.push(`${label} requires a name`);
    if (!TYPES.has(e.type)) errors.push(`${label} has unknown type: ${e.type}`);
    for (const key of ["position", "rotation"])
      if (!vec3(e[key]) || e[key].some((v) => Math.abs(v) > MAX_COORD))
        errors.push(
          `${label}.${key} must contain exactly three finite numbers with magnitude <= ${MAX_COORD}`,
        );
    if (
      SOLIDS.has(e.type) &&
      (!text(e.materialId) || !materials.has(e.materialId))
    )
      errors.push(`${label} references an unknown materialId`);
    if (e.type === "lens" || e.type === "slab") {
      length(e, "thickness", label);
      length(e, "aperture", label);
    }
    if (e.type === "lens" || e.type === "mirror") {
      if (e.type === "mirror") length(e, "aperture", label);
      for (const key of e.type === "lens"
        ? ["radius1", "radius2"]
        : ["radius"]) {
        if (
          !finite(e[key]) ||
          Math.abs(e[key]) > MAX_COORD ||
          (e[key] !== 0 && Math.abs(e[key]) < e.aperture / 2)
        )
          errors.push(
            `${label}.${key} must be 0 (plane) or a finite signed radius with aperture/2 <= |radius| <= ${MAX_COORD}`,
          );
      }
      if (e.type === "lens" && errors.length === before) {
        const edge =
          e.thickness +
          sag(e.radius2, e.aperture / 2) -
          sag(e.radius1, e.aperture / 2);
        if (edge <= tolerance(e.thickness, e.aperture))
          errors.push(
            `${label} lens surfaces intersect or touch within the clear aperture; increase thickness or reduce aperture`,
          );
      }
    }
    if (e.type === "prism") {
      length(e, "size", label);
      length(e, "depth", label);
      if (!finite(e.apex) || e.apex <= 0 || e.apex >= 180)
        errors.push(`${label}.apex must be strictly between 0 and 180 degrees`);
      else {
        const h = e.size * Math.tan((e.apex * DEG) / 2);
        if (
          !finite(h) ||
          h > MAX_COORD ||
          h <=
            4 *
              tolerance(
                finite(e.size) ? e.size : 0,
                ...(vec3(e.position) ? e.position : [0]),
              )
        )
          errors.push(
            `${label} prism base half-height must exceed numerical resolution and be <= ${MAX_COORD} mm`,
          );
      }
    }
    if (e.type === "stop") {
      length(e, "aperture", label, true);
      length(e, "diameter", label);
      if (e.aperture > e.diameter)
        errors.push(`${label}.aperture cannot exceed its outer diameter`);
    }
    if (e.type === "detector") {
      length(e, "width", label);
      length(e, "height", label);
    }
    if (e.type === "source") {
      if (!["point", "collimated", "extended"].includes(e.kind))
        errors.push(`${label}.kind must be point, collimated, or extended`);
      if (!finite(e.spread) || e.spread < 0 || e.spread > 180)
        errors.push(
          `${label}.spread must be a finite cone half-angle in [0, 180] degrees`,
        );
      length(e, "beamRadius", label, true);
      length(e, "objectHeight", label, e.kind !== "extended");
      if (!Number.isInteger(e.samples) || e.samples < 1 || e.samples > 100000)
        errors.push(
          `${label}.samples must be an integer in [1, 100000] per point per wavelength`,
        );
      if (
        !Array.isArray(e.wavelengths) ||
        !e.wavelengths.length ||
        e.wavelengths.length > 32 ||
        !Array.from(e.wavelengths).every(
          (w) => finite(w) && w > 0 && w <= MAX_COORD,
        )
      )
        errors.push(
          `${label}.wavelengths must be a nonempty array of at most 32 positive finite wavelengths in nm, <= ${MAX_COORD}`,
        );
      else {
        if (new Set(e.wavelengths).size !== e.wavelengths.length)
          errors.push(`${label}.wavelengths must not contain duplicates`);
        e.wavelengths.forEach((w) => wavelengths.add(w));
        population +=
          e.samples * e.wavelengths.length * (e.kind === "extended" ? 7 : 1);
      }
    }
    if (errors.length === before && SOLIDS.has(e.type))
      solids.push({ e, bounds: elementBounds(e) });
  }
  if (population > MAX_RAYS)
    errors.push(`Source population exceeds ${MAX_RAYS} rays`);
  for (const m of materials.values()) {
    if (!finite(m.A) || !finite(m.B)) continue;
    for (const w of wavelengths) {
      try {
        refractiveIndex(m, w);
      } catch {
        errors.push(
          `Material ${m.id} has an invalid refractive index at ${w} nm`,
        );
      }
    }
  }
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i],
        b = solids[j];
      if (
        [0, 1, 2].every(
          (k) =>
            a.bounds.max[k] >=
              b.bounds.min[k] - tolerance(a.bounds.max[k], b.bounds.min[k]) &&
            b.bounds.max[k] >=
              a.bounds.min[k] - tolerance(b.bounds.max[k], a.bounds.min[k]),
        )
      )
        errors.push(
          `Solids ${a.e.id} and ${b.e.id} have overlapping/touching conservative world AABBs. This conservative rejection can include disjoint rotated solids; separate their bounding boxes.`,
        );
    }
  return { valid: errors.length === 0, errors };
}

function prepare(project) {
  const validation = validateProject(project);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const materials = new Map(project.materials.map((m) => [m.id, m]));
  const elements = project.elements
    .filter((e) => e.type !== "source")
    .map((e) => ({ e, m: matrix(e) }));
  return {
    project,
    materials,
    elements,
    solids: elements.filter(({ e }) => SOLIDS.has(e.type)),
    byId: new Map(elements.map((entry) => [entry.e.id, entry])),
  };
}

function population(project) {
  const rays = [],
    golden = Math.PI * (3 - Math.sqrt(5));
  for (const source of project.elements.filter((e) => e.type === "source")) {
    const m = matrix(source),
      points = objectPoints(source);
    for (let p = 0; p < points.length; p++)
      for (let w = 0; w < source.wavelengths.length; w++)
        for (let k = 0; k < source.samples; k++) {
          // The on-axis ray plus equal-solid-angle sunflower samples. Geometry is
          // deliberately wavelength-independent, including the collimated pupil.
          const u = k === 0 ? 0 : (k - 0.5) / (source.samples - 1);
          const phi = k * golden,
            c = Math.cos(phi),
            s = Math.sin(phi);
          let origin = points[p],
            direction = [1, 0, 0];
          if (source.kind === "collimated") {
            const r = source.beamRadius * Math.sqrt(u);
            origin = add(origin, [0, r * c, r * s]);
          } else {
            const sinHalf = Math.sin((source.spread * DEG) / 2),
              radial = Math.sqrt(u) * sinHalf;
            const cosTheta = 1 - 2 * radial * radial;
            const sinTheta =
              2 * radial * Math.sqrt(Math.max(0, 1 - radial * radial));
            direction = [cosTheta, sinTheta * c, sinTheta * s];
          }
          rays.push({
            id: `${source.id}:${p}:${w}:${k}`,
            sourceId: source.id,
            objectPointId: p,
            wavelength: source.wavelengths[w],
            origin: add(rotate(origin, m), source.position),
            direction: unit(rotate(direction, m)),
          });
        }
  }
  return rays;
}

/** Collimated sources sample a disk and remain parallel; beamRadius applies
 * only to collimated sources. Point/extended emitters sample a true 3D cone. */
export function generateRays(project) {
  prepare(project);
  return population(project);
}

function quadratic(a, b, c) {
  if (a === 0) return b === 0 ? [] : [-c / b];
  let discriminant = b * b - 4 * a * c;
  const error = 8 * EPS * (b * b + Math.abs(4 * a * c));
  if (discriminant < -error) return [];
  discriminant = Math.max(0, discriminant);
  const root = Math.sqrt(discriminant);
  const q = -0.5 * (b + (b < 0 ? -root : root));
  if (q === 0) return [-b / (2 * a)];
  const r1 = q / a,
    r2 = c / q;
  return r1 <= r2 ? [r1, r2] : [r2, r1];
}

function triangleContains(p, vertices, tol) {
  return vertices.every((a, i) => {
    const b = vertices[(i + 1) % 3];
    return (
      ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) /
        Math.hypot(b[0] - a[0], b[1] - a[1]) >=
      -tol
    );
  });
}

function contains(p, e, tol) {
  if (e.type === "prism")
    return (
      Math.abs(p[2]) <= e.depth / 2 + tol &&
      triangleContains(p, prismVertices(e), tol)
    );
  const r = Math.hypot(p[1], p[2]);
  if (r > e.aperture / 2 + tol) return false;
  const r1 = e.type === "lens" ? e.radius1 : 0,
    r2 = e.type === "lens" ? e.radius2 : 0;
  return (
    p[0] >= -e.thickness / 2 + sag(r1, r) - tol &&
    p[0] <= e.thickness / 2 + sag(r2, r) + tol
  );
}

/** Analytic local-space plane/sphere/cylinder intersections, finite trimming. */
function intersections(
  entry,
  origin,
  direction,
  first = false,
  previous = null,
) {
  const { e, m } = entry,
    o = unrotate(sub(origin, e.position), m),
    d = unrotate(direction, m);
  const tol = tolerance(...origin, ...o, ...e.position),
    result = [];
  const addHit = (t, surface, normal, action, test = () => true) => {
    if (!finite(t) || (first ? t < -tol : t <= tol)) return;
    t = Math.max(0, t);
    const p = add(o, mul(d, t));
    if (!test(p)) return;
    result.push({
      t,
      entry,
      surface,
      localPosition: p,
      position: add(origin, mul(direction, t)),
      normal: unit(
        rotate(typeof normal === "function" ? normal(p) : normal, m),
      ),
      action,
    });
  };
  const plane = (point, n, surface, action, test) => {
    if (previous?.entry === entry && previous.surface === surface) return;
    const denominator = dot(d, n);
    if (Math.abs(denominator) <= 4 * EPS) return;
    addHit(dot(sub(point, o), n) / denominator, surface, n, action, test);
  };
  const opticalSurface = (vertex, radius, aperture, side, surface, action) => {
    const inAperture = (p) => Math.hypot(p[1], p[2]) <= aperture / 2 + tol;
    if (radius === 0) {
      plane([vertex, 0, 0], [side, 0, 0], surface, action, inAperture);
      return;
    }
    // Expanded about the vertex rather than the sphere center, to retain the
    // small near-surface root when radius is much larger than the aperture.
    const q = [o[0] - vertex, o[1], o[2]];
    const b = 2 * (dot(q, d) - radius * d[0]);
    // The previous hit is exactly on this surface. Enforcing its known zero
    // root prevents a roundoff self-hit without moving the ray or suppressing
    // nearby DIFFERENT surfaces. The other sphere root remains available.
    const c =
      previous?.entry === entry && previous.surface === surface
        ? 0
        : dot(q, q) - 2 * radius * q[0];
    for (const t of quadratic(dot(d, d), b, c))
      addHit(
        t,
        surface,
        (p) =>
          mul([p[0] - vertex - radius, p[1], p[2]], -side * Math.sign(radius)),
        action,
        (p) =>
          inAperture(p) && Math.sign(radius) * (p[0] - vertex - radius) <= tol,
      );
  };
  if (e.type === "lens" || e.type === "slab") {
    const r1 = e.type === "lens" ? e.radius1 : 0,
      r2 = e.type === "lens" ? e.radius2 : 0;
    opticalSurface(-e.thickness / 2, r1, e.aperture, -1, "front", "refract");
    opticalSurface(e.thickness / 2, r2, e.aperture, 1, "back", "refract");
    const a = e.aperture / 2,
      front = -e.thickness / 2 + sag(r1, a),
      back = e.thickness / 2 + sag(r2, a);
    for (const t of quadratic(
      d[1] * d[1] + d[2] * d[2],
      2 * (o[1] * d[1] + o[2] * d[2]),
      o[1] * o[1] + o[2] * o[2] - a * a,
    ))
      addHit(
        t,
        "rim",
        (p) => [0, p[1], p[2]],
        "absorb",
        (p) => p[0] >= front - tol && p[0] <= back + tol,
      );
  } else if (e.type === "prism") {
    const vertices = prismVertices(e);
    vertices.forEach((a, i) => {
      const b = vertices[(i + 1) % 3],
        edge = [b[0] - a[0], b[1] - a[1], 0],
        length2 = dot(edge, edge);
      plane(
        [a[0], a[1], 0],
        unit([edge[1], -edge[0], 0]),
        `face-${i}`,
        "refract",
        (p) => {
          const along = dot(sub(p, [a[0], a[1], 0]), edge) / Math.sqrt(length2);
          return (
            along >= -tol &&
            along <= Math.sqrt(length2) + tol &&
            Math.abs(p[2]) <= e.depth / 2 + tol
          );
        },
      );
    });
    for (const side of [-1, 1])
      plane(
        [0, 0, (side * e.depth) / 2],
        [0, 0, side],
        side < 0 ? "cap-minus" : "cap-plus",
        "absorb",
        (p) => triangleContains(p, vertices, tol),
      );
  } else if (e.type === "mirror")
    opticalSurface(0, e.radius, e.aperture, -1, "mirror", "reflect");
  else if (e.type === "stop")
    plane([0, 0, 0], [-1, 0, 0], "annulus", "clip", (p) => {
      const r = Math.hypot(p[1], p[2]);
      return (
        r <= e.diameter / 2 + tol &&
        (e.aperture === 0 || r >= e.aperture / 2 - tol)
      );
    });
  else if (e.type === "detector")
    plane(
      [0, 0, 0],
      [-1, 0, 0],
      "screen",
      "detect",
      (p) =>
        Math.abs(p[1]) <= e.width / 2 + tol &&
        Math.abs(p[2]) <= e.height / 2 + tol,
    );
  return result;
}

function startingMedium(context, origin, direction) {
  for (const entry of context.solids) {
    const p = unrotate(sub(origin, entry.e.position), entry.m);
    const tol = tolerance(...origin, ...p, ...entry.e.position);
    if (!contains(p, entry.e, tol)) continue;
    const boundary = intersections(entry, origin, direction, true).filter(
      (hit) => hit.t <= tol,
    );
    // At a launch boundary use the incident side, so a t=0 event still applies.
    if (
      !boundary.length ||
      boundary.every((hit) => dot(direction, hit.normal) > 0)
    )
      return entry.e.id;
  }
  return null;
}

function settings(options) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new Error("Trace options must be an object");
  const maxInteractions = options.maxInteractions ?? 64,
    maxPath = options.maxPath ?? 5000,
    escapeDistance = options.escapeDistance ?? 150;
  if (
    !Number.isInteger(maxInteractions) ||
    maxInteractions < 0 ||
    maxInteractions > 100000
  )
    throw new Error("maxInteractions must be an integer in [0, 100000]");
  if (!finite(maxPath) || maxPath <= 0 || maxPath > MAX_COORD)
    throw new Error(`maxPath must be positive, finite, and <= ${MAX_COORD}`);
  if (
    !finite(escapeDistance) ||
    escapeDistance <= 0 ||
    escapeDistance > MAX_COORD
  )
    throw new Error(
      `escapeDistance must be positive, finite, and <= ${MAX_COORD}`,
    );
  return { maxInteractions, maxPath, escapeDistance };
}

function inputRay(ray, index, context) {
  if (
    !ray ||
    !vec3(ray.origin) ||
    ray.origin.some((x) => Math.abs(x) > MAX_COORD)
  )
    throw new Error(
      `Ray ${index} requires a finite origin within +/- ${MAX_COORD} mm`,
    );
  const direction = unit(ray.direction, `Ray ${index} direction`),
    wavelength = ray.wavelength ?? 550;
  if (!finite(wavelength) || wavelength <= 0 || wavelength > MAX_COORD)
    throw new Error(`Ray ${index} wavelength must be positive and finite`);
  for (const material of context.materials.values())
    refractiveIndex(material, wavelength);
  const id = ray.id ?? `ray-${index}`,
    sourceId = ray.sourceId ?? "manual",
    objectPointId = ray.objectPointId ?? 0;
  if (
    !(typeof id === "string" || finite(id)) ||
    typeof sourceId !== "string" ||
    !(typeof objectPointId === "string" || Number.isInteger(objectPointId))
  )
    throw new Error(`Ray ${index} has invalid identity fields`);
  return {
    id,
    sourceId,
    objectPointId,
    wavelength,
    origin: [...ray.origin],
    direction,
  };
}

function traceOne(context, input, options) {
  const ray = {
    ...input,
    origin: [...input.origin],
    direction: [...input.direction],
    points: [[...input.origin]],
    hits: [],
    termination: "interaction-limited",
  };
  let origin = ray.origin,
    direction = ray.direction,
    path = 0,
    previous = null;
  let medium = startingMedium(context, origin, direction);
  const index = (id) =>
    id === null
      ? context.project.ambient
      : refractiveIndex(
          context.materials.get(context.byId.get(id).e.materialId),
          ray.wavelength,
        );
  for (
    let interaction = 0;
    interaction < options.maxInteractions;
    interaction++
  ) {
    let nearest = null;
    for (const entry of context.elements)
      for (const hit of intersections(
        entry,
        origin,
        direction,
        interaction === 0,
        previous,
      )) {
        if (hit.action === "refract") {
          const incidence = dot(direction, hit.normal);
          // A tangency is not a medium crossing. Outward normals also distinguish
          // entry/exit without blindly toggling media on numerical self contacts.
          if (
            medium === entry.e.id ? incidence <= 8 * EPS : incidence >= -8 * EPS
          )
            continue;
        }
        if (
          !nearest ||
          hit.t < nearest.t - tolerance(hit.t, nearest.t) ||
          (Math.abs(hit.t - nearest.t) <= tolerance(hit.t, nearest.t) &&
            HIT_PRIORITY[hit.action] > HIT_PRIORITY[nearest.action])
        )
          nearest = hit;
      }
    const remaining = Math.max(0, options.maxPath - path);
    if (!nearest || nearest.t > remaining) {
      const distance = nearest
        ? remaining
        : Math.min(options.escapeDistance, remaining);
      if (distance > 0) ray.points.push(add(origin, mul(direction, distance)));
      ray.termination =
        nearest || remaining < options.escapeDistance
          ? "path-limited"
          : "escaped";
      path += distance;
      break;
    }
    path += nearest.t;
    const { e } = nearest.entry,
      before = medium,
      n1 = index(medium);
    let after = medium,
      n2 = n1,
      outgoing = null,
      event = nearest.action;
    if (event === "refract") {
      after = medium === e.id ? null : e.id;
      n2 = index(after);
      const result = refract(direction, nearest.normal, n1, n2);
      outgoing = result.direction;
      if (result.tir) {
        event = "tir";
        after = medium;
      }
    } else if (event === "reflect")
      outgoing = reflect(direction, nearest.normal);
    ray.points.push([...nearest.position]);
    ray.hits.push({
      elementId: e.id,
      surface: nearest.surface,
      position: [...nearest.position],
      normal: [...nearest.normal],
      incoming: [...direction],
      outgoing: outgoing ? [...outgoing] : null,
      n1,
      n2,
      mediumBefore: before,
      mediumAfter: after,
      event,
    });
    if (event === "detect") {
      ray.termination = "detected";
      ray.detectorId = e.id;
      ray.detectorUV = [nearest.localPosition[1], nearest.localPosition[2]];
      break;
    }
    if (event === "absorb" || event === "clip") {
      ray.termination = event === "absorb" ? "absorbed" : "clipped";
      break;
    }
    origin = nearest.position;
    direction = outgoing;
    medium = after;
    previous = nearest;
    if (path >= options.maxPath) {
      ray.termination = "path-limited";
      break;
    }
  }
  ray.pathLength = path;
  return ray;
}

export function traceRay(project, ray, options = {}) {
  const context = prepare(project);
  return traceOne(context, inputRay(ray, 0, context), settings(options));
}

function addMoment(moment, u, v) {
  moment.count++;
  const du = u - moment.centroid[0],
    dv = v - moment.centroid[1];
  moment.centroid[0] += du / moment.count;
  moment.centroid[1] += dv / moment.count;
  moment.m2 += du * (u - moment.centroid[0]) + dv * (v - moment.centroid[1]);
}

function detectorMetrics(context, spots) {
  const results = new Map(
    context.elements
      .filter(({ e }) => e.type === "detector")
      .map(({ e }) => [
        e.id,
        {
          detectorId: e.id,
          count: 0,
          centroid: [0, 0],
          m2: 0,
          groups: new Map(),
        },
      ]),
  );
  for (const spot of spots) {
    const metric = results.get(spot.detectorId),
      key = JSON.stringify([
        spot.sourceId,
        spot.objectPointId,
        spot.wavelength,
      ]);
    if (!metric.groups.has(key))
      metric.groups.set(key, {
        sourceId: spot.sourceId,
        objectPointId: spot.objectPointId,
        wavelength: spot.wavelength,
        count: 0,
        centroid: [0, 0],
        m2: 0,
      });
    addMoment(metric, spot.u, spot.v);
    addMoment(metric.groups.get(key), spot.u, spot.v);
  }
  const finish = ({ m2, ...m }) => ({
    ...m,
    centroid: m.count ? m.centroid : null,
    rms: m.count ? Math.sqrt(Math.max(0, m2 / m.count)) : null,
  });
  return [...results.values()].map(({ groups, ...m }) => ({
    ...finish(m),
    groups: [...groups.values()].map(finish),
  }));
}

function run(context, inputs, options) {
  const now = () => globalThis.performance?.now() ?? Date.now(),
    start = now();
  const rays = [],
    spots = [],
    terminations = Object.fromEntries(TERMINATIONS.map((t) => [t, 0]));
  for (const input of inputs) {
    const ray = traceOne(context, input, options);
    rays.push(ray);
    terminations[ray.termination]++;
    if (ray.termination === "detected")
      spots.push({
        rayId: ray.id,
        detectorId: ray.detectorId,
        sourceId: ray.sourceId,
        objectPointId: ray.objectPointId,
        wavelength: ray.wavelength,
        u: ray.detectorUV[0],
        v: ray.detectorUV[1],
      });
  }
  const metrics = detectorMetrics(context, spots);
  return {
    rays,
    count: rays.length,
    duration: now() - start,
    terminations,
    spots,
    metrics,
  };
}

function inputsFor(context, options) {
  if (options.rays === undefined) return population(context.project);
  if (!Array.isArray(options.rays) || options.rays.length > MAX_RAYS)
    throw new Error(
      `options.rays must be an array of at most ${MAX_RAYS} input rays`,
    );
  const inputs = Array.from(options.rays, (ray, i) =>
    inputRay(ray, i, context),
  );
  if (new Set(inputs.map((ray) => ray.id)).size !== inputs.length)
    throw new Error("Input ray ids must be unique");
  return inputs;
}

/** duration is tracing/aggregation wall time in milliseconds. */
export function traceProject(project, options = {}) {
  const context = prepare(project),
    limits = settings(options);
  return run(context, inputsFor(context, options), limits);
}

/**
 * Inclusive scan of ABSOLUTE GLOBAL X, not detector-normal displacement:
 * detector.position[0] = position; Y/Z and rotation stay fixed. No mutation.
 * Objective = sqrt(sum(group.count * group.rms^2) / detected count), grouping
 * by (sourceId, objectPointId, wavelength). This excludes object extent and
 * inter-wavelength centroid separation, but retains chromatic defocus blur.
 * Throughput = selected-detector hits / fixed total input population. No
 * throughput penalty is added; ties prefer more hits, then the first sample.
 * best is a sample or null if no sample detects rays. range also accepts rays,
 * maxInteractions, maxPath, escapeDistance, just like traceProject options.
 */
export function focusScan(project, detectorId, range) {
  const context = prepare(project),
    detector = context.byId.get(detectorId);
  if (!detector || detector.e.type !== "detector")
    throw new Error(`Unknown detector: ${detectorId}`);
  if (
    !range ||
    !finite(range.start) ||
    !finite(range.end) ||
    Math.abs(range.start) > MAX_COORD ||
    Math.abs(range.end) > MAX_COORD ||
    !Number.isInteger(range.steps) ||
    range.steps < 1 ||
    range.steps > 1001
  )
    throw new Error(
      "Focus range requires finite start/end within +/- 1e9 mm and integer steps in [1, 1001]",
    );
  const limits = settings(range),
    inputs = inputsFor(context, range),
    samples = [];
  let best = null;
  for (let i = 0; i < range.steps; i++) {
    const position =
      range.steps === 1
        ? range.start
        : range.start + (range.end - range.start) * (i / (range.steps - 1));
    const moved = {
      ...detector,
      e: {
        ...detector.e,
        position: [position, detector.e.position[1], detector.e.position[2]],
      },
    };
    const scene = {
      ...context,
      elements: context.elements.map((entry) =>
        entry === detector ? moved : entry,
      ),
    };
    const metric = run(scene, inputs, limits).metrics.find(
      (m) => m.detectorId === detectorId,
    );
    const rms = metric.count
      ? Math.sqrt(
          metric.groups.reduce((sum, g) => sum + g.count * g.rms * g.rms, 0) /
            metric.count,
        )
      : null;
    const sample = {
      position,
      rms,
      count: metric.count,
      throughput: inputs.length ? metric.count / inputs.length : 0,
    };
    samples.push(sample);
    if (
      rms !== null &&
      (!best ||
        rms < best.rms ||
        (rms === best.rms && sample.count > best.count))
    )
      best = sample;
  }
  return { samples, best };
}
