/** Fresh, independent project factories. See optics.js for geometric conventions. */
const GLASS = { id: "glass", name: "Crown glass", A: 1.5046, B: 0.0042 };
const FLINT = { id: "flint", name: "Dispersive flint", A: 1.62, B: 0.015 };

export function createElement(type, index = 0) {
  if (typeof type !== "string")
    throw new Error("Element type must be a string");
  if (!Number.isInteger(index) || index < 0)
    throw new Error("Element index must be a nonnegative integer");
  const common = {
    id: `${type}-${index}`,
    type,
    name: `${type[0]?.toUpperCase() ?? ""}${type.slice(1)} ${index + 1}`,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
  const defaults = {
    source: {
      position: [-110, 0, 0],
      kind: "point",
      spread: 10,
      beamRadius: 10,
      samples: 81,
      wavelengths: [450, 550, 650],
      objectHeight: 12,
    },
    lens: {
      thickness: 6,
      radius1: 50,
      radius2: -50,
      aperture: 30,
      materialId: "glass",
    },
    slab: { thickness: 20, aperture: 60, materialId: "glass" },
    prism: { size: 25, apex: 60, depth: 40, materialId: "flint" },
    mirror: { radius: 0, aperture: 50 },
    stop: { position: [-10, 0, 0], aperture: 24, diameter: 48 },
    detector: { position: [90, 0, 0], width: 60, height: 50 },
  };
  if (!Object.hasOwn(defaults, type))
    throw new Error(`Unknown element type: ${type}`);
  return { ...common, ...defaults[type] };
}

const element = (type, overrides = {}, index = 0) => ({
  ...createElement(type, index),
  ...overrides,
});
const project = (elements) => ({
  version: 1,
  units: "mm",
  ambient: 1,
  materials: [{ ...GLASS }, { ...FLINT }],
  elements,
});

/** Main extended-object spherical singlet. It is dispersive, not an achromat.
 * R=+/-50, center thickness 6, and aperture 30 keep positive edge thickness.
 * A 24 mm stop limits aberration; the image is near global X=90 mm.
 */
export function createProject() {
  return project([
    element("source", { name: "Seven-point arrow", kind: "extended" }),
    element("stop", { name: "24 mm entrance stop" }),
    element("lens", { name: "Crown imaging lens" }),
    element("detector", { name: "Image plane" }),
  ]);
}

export const EXAMPLES = [
  {
    id: "showcase",
    name: "Color Imaging Lab",
    description:
      "A seven-point arrow imaged by a finite thick spherical lens. Compare wavelengths and scan best focus.",
    project: createProject(),
  },
  {
    id: "interface",
    name: "Single Interface",
    description:
      "A finite glass slab has its front interface at X=0. A measurement plane inside the glass intercepts transmitted rays before the exit at X=200. Rotate the slab to explore Snell's law.",
    project: project([
      element("source", {
        name: "Oblique pencil",
        position: [-70, -25, 0],
        rotation: [0, 0, 25],
        kind: "collimated",
        beamRadius: 8,
        wavelengths: [550],
        samples: 41,
      }),
      element("slab", {
        name: "Interface (front face X=0)",
        position: [100, 0, 0],
        thickness: 200,
        aperture: 300,
      }),
      element("detector", {
        name: "Screen inside glass",
        position: [140, 55, 0],
        width: 140,
        height: 80,
      }),
    ]),
  },
  {
    id: "mirror",
    name: "Folded Reflection",
    description:
      "A finite 45-degree planar mirror folds a collimated beam onto a rotated detector. Reflection is fully three-dimensional.",
    project: project([
      element("source", {
        kind: "collimated",
        position: [-90, 0, 0],
        beamRadius: 12,
        samples: 81,
        wavelengths: [550],
      }),
      element("mirror", {
        name: "45 degree fold mirror",
        rotation: [0, 0, -45],
        aperture: 60,
      }),
      element("detector", {
        name: "Folded screen",
        position: [0, 90, 0],
        rotation: [0, 0, 90],
        width: 50,
        height: 50,
      }),
    ]),
  },
  {
    id: "tir",
    name: "Total Internal Reflection",
    description:
      "The source starts inside glass. Above-critical rays bounce at the slab faces without changing medium, then terminate on the absorbing cylindrical rim.",
    project: project([
      element("source", {
        name: "Emitter inside glass",
        position: [0, -30, 0],
        rotation: [0, 0, 60],
        spread: 4,
        samples: 61,
        wavelengths: [550],
      }),
      element("slab", {
        name: "TIR glass block",
        thickness: 20,
        aperture: 180,
      }),
      element("detector", { position: [55, 0, 0], width: 200, height: 80 }),
    ]),
  },
  {
    id: "slab",
    name: "Plane-Parallel Slab",
    description:
      "Two real finite interfaces restore the original propagation angle while shifting the beam laterally. The curved edge absorbs.",
    project: project([
      element("source", {
        kind: "collimated",
        position: [-70, -30, 0],
        rotation: [0, 0, 25],
        beamRadius: 8,
        samples: 81,
      }),
      element("slab", { thickness: 30, aperture: 100 }),
      element("detector", { position: [95, 35, 0], width: 100, height: 80 }),
    ]),
  },
  {
    id: "paraxial",
    name: "Paraxial Focus",
    description:
      "Reference n=1.5, R=+/-100 mm, thickness 0.5 mm, pupil radius 0.25 mm. EFL 100.083403 mm; rear-vertex focus 99.916597 mm. See the independent <1% error envelope in VERIFICATION.md.",
    project: {
      ...project([
        element("source", {
          position: [-5, 0, 0],
          kind: "collimated",
          beamRadius: 0.25,
          samples: 121,
          wavelengths: [550],
        }),
        element("lens", {
          name: "Paraxial reference singlet",
          thickness: 0.5,
          radius1: 100,
          radius2: -100,
          aperture: 10,
        }),
        element("detector", {
          position: [100.16659716, 0, 0],
          width: 2,
          height: 2,
        }),
      ]),
      materials: [{ id: "glass", name: "Reference glass n=1.5", A: 1.5, B: 0 }],
    },
  },
  {
    id: "spherical-aberration",
    name: "Aperture & Aberration",
    description:
      "A wide pupil reveals spherical aberration. Reduce the entrance-stop opening and compare grouped RMS near focus.",
    project: project([
      element("source", {
        kind: "collimated",
        beamRadius: 19,
        samples: 301,
        wavelengths: [550],
      }),
      element("stop", { aperture: 38, diameter: 48 }),
      element("lens", {
        name: "Wide-aperture spherical lens",
        thickness: 10,
        aperture: 40,
      }),
      element("detector", { position: [44, 0, 0], width: 50, height: 50 }),
    ]),
  },
  {
    id: "prism",
    name: "Prism Dispersion",
    description:
      "A finite 60-degree flint prism splits a shared white-light pupil. All wavelengths have identical launch geometry.",
    project: project([
      element("source", {
        kind: "collimated",
        position: [-80, 0, 0],
        beamRadius: 1,
        samples: 61,
        wavelengths: [430, 480, 530, 580, 630, 680],
      }),
      element("prism", {
        name: "Dispersive triangular prism",
        rotation: [0, 0, 64],
        size: 30,
        depth: 35,
      }),
      element("detector", {
        name: "Spectrum screen",
        position: [100, -135, 0],
        width: 180,
        height: 80,
      }),
    ]),
  },
  {
    id: "extended-imaging",
    name: "Extended Object",
    description:
      "Seven independently emitting arrow points retain their identity on the detector. Focus uses within-point blur, not the arrow's overall extent.",
    project: project([
      element("source", { kind: "extended", samples: 121, wavelengths: [550] }),
      element("stop", { aperture: 16, diameter: 48 }),
      element("lens"),
      element("detector"),
    ]),
  },
  {
    id: "clipping",
    name: "Finite-Aperture Torture",
    description:
      "A broad 3D cone meets an opaque annulus, a finite absorbing lens rim, and a small detector. Rays outside physical apertures really miss.",
    project: project([
      element("source", {
        position: [-55, 8, 3],
        spread: 32,
        samples: 401,
        wavelengths: [550],
      }),
      element("stop", { position: [-20, 0, 0], aperture: 18, diameter: 50 }),
      element("lens", {
        position: [0, 0, 0],
        rotation: [0, 8, 0],
        thickness: 8,
        aperture: 32,
      }),
      element("detector", { position: [100, -15, -6], width: 14, height: 12 }),
    ]),
  },
];
