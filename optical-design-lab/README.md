# Lumen Optical Design Laboratory

A local, browser-based geometric optics workbench. Build finite optical systems, trace actual 3D rays, inspect the physics at each surface, and measure image formation. The opening seven-point arrow image is made from detected rays, not a transformed picture.

## Start Locally

Requires Node.js **20.19+ or 22.12+** and npm. From this directory, one command installs the pinned dependencies and starts the complete application:

```sh
npm ci && npm start
```

Open the local URL printed by Vite, normally **http://localhost:5173**. If that port is occupied, Vite prints another available port. There is no backend, account, API key, paid service, remote computation, CDN, external font, or runtime network dependency. Initial npm installation needs access to the package registry unless dependencies are cached. After installation, `npm start` is sufficient.

React 19 provides the interface, SVG provides the editable meridional bench, Three.js provides the lazily loaded 3D renderer, and native module Web Workers run the independent JavaScript optical solver. Mesh tessellation is **visual only**; optical intersections and normals are analytic.

## Verification

```sh
npm run verify
npm run build
npx playwright install chromium
npm run test:browser
```

The Chromium installation is only needed once for browser verification, not to use Lumen in your own browser. On a minimal Linux image, Playwright may also require its documented browser system dependencies. All automation launches **headless Chromium**, with no X server. `npm run test:browser` starts and stops its own production preview at `127.0.0.1:5399`; set `LUMEN_TEST_PORT` if needed. Build first. The build emits a size advisory for the optional Three.js chunk, not an error; this chunk is not fetched until opening 3D.

Current results:

| Verification                                 | Result                                                              |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Independent numerical checks                 | **13/13 groups pass; 27,891 traced rays checked**                   |
| Production build                             | **Pass**                                                            |
| Production headless browser workflow         | **17/17 groups pass**                                               |
| Snell residual, normalized                   | Maximum **2.96e-16**, required <= 1e-6                              |
| Slab displacement error                      | Maximum **2.13e-14 mm**                                             |
| Paraxial focal/image/magnification errors    | All below **0.00104%**; independent approximation envelope below 1% |
| Browser errors / remote application requests | **0 / 0** in the workflow                                           |

See [VERIFICATION.md](VERIFICATION.md) for independent formulas, published paraxial error bounds, exact sampling, tolerances, and regression fixtures. See [BENCHMARK.md](BENCHMARK.md) for the real browser workload and hardware. Browser runs regenerate screenshots and `test-results/browser-report.json`; generated artifacts are not required to run the app.

## Controls

| Action                          | Control                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Add a source or optical element | Click a library palette entry                                                          |
| Select                          | Click an element on the bench or in the element list                                   |
| Multiselect                     | Shift-click elements; Shift-drag empty bench space for a marquee                       |
| Position selected elements      | Drag on the 2D bench; a completed drag is one undo operation                           |
| Exact position / orientation    | Inspector XYZ fields; Enter or blur commits                                            |
| Pan 2D                          | Pan toolbar tool, Space-drag, right-drag, or middle-drag                               |
| Zoom 2D                         | Wheel, centered on the cursor                                                          |
| Fit system                      | Toolbar fit button or F                                                                |
| Navigate 3D                     | Drag to orbit, right-drag to pan, scroll/pinch to zoom; Fit view                       |
| Nudge selected elements         | Arrow keys, 1 mm; Shift for 10 mm                                                      |
| Select all                      | Ctrl/Cmd+A                                                                             |
| Duplicate selected              | Ctrl/Cmd+D or inspector button                                                         |
| Delete selected                 | Delete/Backspace or inspector trash button                                             |
| Undo / redo                     | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z; Ctrl+Y also redoes                                      |
| Clear selection / close guide   | Escape                                                                                 |
| Inspect a ray                   | Click a representative path, a blocked endpoint, a detector spot, or use Ray inspector |
| Compare wavelengths             | Toggle wavelength chips; choose wavelength or object-point coloring                    |
| Focus detector                  | Focus scan tab, choose screen and absolute X interval, then Scan focus                 |
| Apply focus                     | Click a plotted sample or Apply sampled minimum                                        |
| Empty workspace                 | New bench; this operation can be undone                                                |

On mobile, use **Library / Workspace / Inspector** to switch panels. The bench remains draggable and the numeric inspector supports full 3D pose editing. For 3D, use one-finger orbit and two-finger pan/zoom. Small screens scroll vertically; no desktop-only inspector is required.

The bench displays up to about 180 representative ray paths, 3D displays up to 300, and spot plots display up to 8,000 representative hits. **Every measurement and CSV export uses the complete computed population.** Selecting a ray displays its complete path, including hit numbers and normals. The ray selector lists the first 1,500 rays; any rendered spot/path can select its own ray regardless of that list. Display colors indicate wavelength or identity only, not power.

## Geometry and Units

- All positions, lengths, radii, apertures, detector coordinates, path lengths and RMS radii are in **millimeters**. Source wavelengths are **nanometers**. UI rotations and cone half-angles are **degrees**.
- The local optical axis is **+X**. Pose applies active rotations around local X, then world Y, then world Z, followed by translation; equivalently `Rz * Ry * Rx`. Positive rotations follow the right-hand rule. The 2D bench projects world X/Y without modifying world Z in the solver.
- Detector coordinates are **u = local Y, v = local Z**, with their origin at the detector center. Both front and back sides detect and terminate rays.
- Thick lenses have surface vertices at `x = -thickness/2` and `+thickness/2`. A signed radius R places the sphere center at `vertex + R`. **R=0 is planar**, not an infinite number. Biconvex is positive R1/negative R2; biconcave is negative R1/positive R2. The preset also provides plano-convex geometry. Custom signed radii are editable.
- Lens/slab clear apertures are **diameters**. Two sphere caps, or plane caps where R=0, bound a lens. Their circular cylindrical rim is a real **absorbing** boundary. A lens must have positive thickness everywhere inside the aperture. For example, thickness 6 mm and R=+50/-50 cannot support a 40 mm diameter; the opening example correctly uses 30 mm.
- Slabs are finite circular cylinders with two plane optical faces and an absorbing cylindrical rim. Their thickness is along local X.
- Mirrors are finite circular, two-sided planar or spherical surfaces. Their vertex is local X=0. Mirror R=0 is planar; nonzero signed R uses the same sphere-center convention as a lens.
- A prism is a finite triangular solid extruded along local Z. `size` is its full X extent. The triangular apex points along +X, the base is at -size/2, and half the base height is `size*tan(apex/2)`. `depth` is the Z extent. All three triangular edge faces refract; the two Z end caps absorb.
- Stops are finite opaque circular annuli in local Y/Z. `aperture` is the circular opening diameter and `diameter` is the outer physical diameter. Opening-edge and outer-edge contact clip; rays outside the physical outer edge pass around the stop. A zero opening blocks the axis.
- A detector is a finite local Y/Z rectangle with `width` along u and `height` along v. Missing the finite detector does not create a hit or a spot.
- Solids with overlapping or touching **world axis-aligned bounding boxes** are rejected conservatively. This deliberately rejects some nonintersecting rotated solids too. Move their bounding boxes apart. Cemented doublets, nested refractive solids, and ambiguous overlapping media are not supported. Sources, stops, mirrors and ideal measurement planes can be inside a single unambiguous solid.

The original double-precision geometry is retained; input display/plot rounding is not written back to the project. Numeric edits and imports are validated before commit. Coordinates and dimensions are bounded to 1e9 mm and nonzero dimensions must exceed roundoff resolution at their location. The solver excludes only scale-dependent roundoff-level forward roots, not an arbitrary fixed position nudge. At a prior spherical hit, its known zero root is enforced while retaining the other sphere root. Tests include distinct surfaces only 1e-9 mm apart and very weakly curved surfaces.

## Materials and Sources

Ambient air is a constant **n=1** by default; edit it in the Materials palette. Material dispersion is the documented Cauchy model:

```text
n(lambda) = A + B / lambda_um^2
lambda_um = wavelength_nm / 1000
```

A is dimensionless and B is in micrometer squared. Set **B=0** for wavelength-independent index. Materials have IDs and are shared: changing A/B affects every element assigned to that material. Every configured wavelength and a 550 nm reference are validated for a positive, finite index. For positive wavelengths this Cauchy expression is monotonic, so valid interval endpoints also validate the interval between them. This is a simple chosen model, not a certified catalog glass specification outside a measured range.

The bundled crown model is A=1.5046, B=0.0042; the dispersive flint is A=1.62, B=0.015. The paraxial reference uses constant n=1.5.

Point sources and each extended-object point emit a genuinely **3D cone**, not a sheet. `spread` is its half-angle. Collimated sources instead sample a circular pupil of `beamRadius` and launch parallel to local +X; their spread setting is unused. The extended object is a seven-point arrow in local Y/Z with editable overall height. Its points independently emit and include nonzero Z positions.

Sampling is deterministic: one central ray plus a golden-angle sunflower pattern, uniform in disk area for a collimated pupil and uniform in solid angle for a cone. At sample k>0, `u=(k-0.5)/(samples-1)`, azimuth is `k*pi*(3-sqrt(5))`; disk radius is `beamRadius*sqrt(u)` and cone `cos(theta)=1-u*(1-cos(spread))`. All wavelengths use identical launch geometry. Count is **samples per point per wavelength**, not total count. A source supports 1-100,000 samples and up to 32 distinct wavelengths, with a project cap of 1,000,000 rays. Large exports and returning very large hit histories can still require significant browser memory; the cap is a safety bound, not a performance guarantee.

## Optical Contract

The tracer searches all elements for the **nearest valid forward analytic intersection**. Sphere roots are restricted to the intended cap and clear aperture, planes to their finite boundaries, and cylinder intersections to the actual rim between the two cap edges. Each hit carries the outward physical normal, incoming/outgoing unit directions, current/attempted transmitted indices, before/after medium IDs, and event.

Vector reflection reverses the normal direction component. Vector Snell refraction preserves tangential direction with index scaling and correctly orients the normal against incidence. At an ordinary interface only the transmitted geometric ray is followed. At TIR the reflected ray is followed and its medium does not change. The initial medium is derived from finite-solid containment, including surface launches. Grazing tangencies are not false medium transitions. No Fresnel splitting is attempted.

Default bounds are **64 interactions and 5,000 mm total path length**. Once no future surface exists, an additional segment of at most 150 mm is drawn to show escape; this is an explicit display extent, not a hidden optical surface. Every ray terminates as:

| Termination           | Meaning                                                        |
| --------------------- | -------------------------------------------------------------- |
| `detected`            | Hit a finite detector; UV coordinates recorded                 |
| `clipped`             | Hit an opaque stop annulus                                     |
| `absorbed`            | Hit a finite lens/slab rim or prism depth cap                  |
| `escaped`             | No valid forward intersection remains                          |
| `interaction-limited` | Reached the interaction budget, including repeated reflections |
| `path-limited`        | Reached the finite travel budget                               |

At coincident events, absorption, then clipping, then detection take precedence over transmission/reflection. Invalid projects or input rays throw before tracing. No NaN or infinite point is intentionally returned; finite-segment and unit-direction assertions exercise every regression ray.

**Not modeled:** diffraction, interference, polarization, scattering, surface roughness, Fresnel splitting, calibrated irradiance, realistic radiometry, wavefront phase or diffraction-limited resolution. There are no Airy disks or wave-optics substitutes for actual lens-surface tracing.

## Measurements and Focus

Each detector reports total hit count, centroid, and population RMS radius about that centroid in physical UV coordinates. Its table separately reports each `(sourceId, objectPointId, wavelength)` group. Empty results have `count=0`, `centroid=null`, `rms=null`, and no invented point at the origin. Overall statistics always include all wavelengths; color-chip filtering only changes what is displayed in the plot/table.

```text
centroid = sum(hit_uv) / N
RMS = sqrt(sum(|hit_uv - centroid|^2) / N)
focus_objective = sqrt(sum(group_count * group_RMS^2) / detected_count)
throughput = selected_detector_hits / total_launched_rays
```

Focus moves only the selected detector's **absolute global X coordinate**, not its local normal; Y/Z and rotation remain fixed. The finite interval includes both endpoints, with 2-101 samples in the UI. The same generated source/ray population is reused at every position. Within-point and within-wavelength centering removes object extent and inter-wavelength centroid separation from the objective, but preserves chromatic defocus. Use wavelength spot centroids to inspect prism separation; this grouped focus objective intentionally does not measure that separation.

There is **no hidden throughput penalty** in the objective. Counts and throughput are displayed at each sample, alongside a dashed throughput curve. A warning marks a minimum that loses more than 5% of the maximum detected population; always compare throughput, including when an entire group vanishes. With no valid hits, `best=null` and the UI explains the empty interval. The minimum is a sampled minimum, not a continuous optimizer. Applying it is a normal undoable detector edit and invalidates the old scan.

Extended-object magnification in the UI is the signed difference of the top and bottom arrow endpoint centroids in u, divided by the object height. This is useful for the centered imaging example and displays inversion. It is not a universal magnification estimate for arbitrarily rotated or decentered systems. The full detected UV coordinates remain authoritative.

Every committed edit immediately invalidates rays, selected-ray details and measurements. During dragging, rays are invalidated and a preview is shown; an invalid release restores the prior geometry. Jobs run in isolated module workers. Cancel terminates the worker and any pending launch timer. Project-generation IDs and focus-request IDs prevent stale results, including edits during a focus scan, from replacing current results. Reported ray count, trace duration, hit count and terminations are computed values, never a claimed frame rate.

## Selectable Experiments

Use **Start with a system** in the library. Each item loads a fresh editable project and loading an example can be undone.

| Example                   | What to inspect                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color Imaging Lab         | 7 emitting arrow points, 81 samples each at 450/550/650 nm: 1,701 rays; actual inversion through a thick crown singlet                                            |
| Single Interface          | Front of a finite slab at X=0; a screen inside the slab detects transmitted rays before the back at X=200. Rotate it and change index; inspect the real first hit |
| Folded Reflection         | Finite 45-degree planar mirror and rotated detector. Change curvature or pose; rays outside the mirror miss                                                       |
| Total Internal Reflection | Source originates inside glass; its above-critical cone reflects internally and eventually hits the absorbing rim                                                 |
| Plane-Parallel Slab       | Parallel emerging beam with a real 3D lateral shift; rotate the source about multiple axes                                                                        |
| Paraxial Focus            | R=+100/-100, thickness 0.5 mm, pupil radius 0.25 mm, n=1.5. The UI uses 121 sunflower rays; numerical checks use independent 65-ray concentric-ring pupils        |
| Aperture & Aberration     | Real spherical surfaces and a wide collimated pupil. Change the stop opening from 38 to 10 mm, scan X around 40-50 mm and compare blur/throughput                 |
| Prism Dispersion          | 60-degree finite flint prism, 61 launch samples at each of six wavelengths. B=0 removes geometric wavelength separation                                           |
| Extended Object           | Seven independently emitting arrow points at 550 nm with a smaller stop; screen pixels are actual detected rays                                                   |
| Finite-Aperture Torture   | Stop clipping, small-screen misses and absorbing rim encounters; inspect each explicit termination                                                                |

For the paraxial independent reference, EFL is **100.0834028 mm**, BFL is **99.91659716 mm** from the rear vertex, and a 300 mm object distance gives image distance **149.9791580 mm** and magnification **-0.5002084202**. The published conservative approximation envelope is at most **0.63965%**; observed errors are much smaller. These are independently derived ray-transfer/lensmaker predictions, not values hard-coded into the tracer or focus control. See VERIFICATION.md for the full derivation.

## Project and CSV Formats

Export project creates **version 1 editable JSON**. Import first parses and validates the entire file; unsupported versions/units, nonfinite values, impossible geometry, duplicate IDs, bad source settings, invalid indices or dangling material references leave the current project intact. The UI limits imported files to 10 MB. Valid imports retrace deterministically and remain fully editable. JSON number serialization round-trips JavaScript doubles without deliberately rounding them.

```json
{
  "version": 1,
  "units": "mm",
  "ambient": 1,
  "materials": [{ "id": "glass", "name": "Crown", "A": 1.5046, "B": 0.0042 }],
  "elements": [
    {
      "id": "lens-0",
      "type": "lens",
      "name": "Imaging lens",
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "thickness": 6,
      "radius1": 50,
      "radius2": -50,
      "aperture": 30,
      "materialId": "glass"
    }
  ]
}
```

Each element's type-specific fields are documented above and are visible in `src/examples.js`. Source fields are `kind`, `spread`, `beamRadius`, `samples`, `wavelengths`, `objectHeight`; detector fields are `width`, `height`, position and rotation. IDs and material references are retained exactly. Rays, undo stacks, camera state, selected measurement screen, color filters and transient focus-scan ranges/results are derived session state and are not embedded in the editable file. **Export before reloading** if you want to keep your project; there is no invisible autosave or remote storage.

Undo/redo retains up to 100 committed project operations, covering creation, deletion, duplication, geometry, poses, source settings, materials, ambient index, detector dimensions/pose, clear, example load, and successful import. Completed drags coalesce into one operation. Rejected changes add no history. Pan/zoom, selections, filters and temporary focus ranges are view/measurement controls, not document edits.

Export CSV creates quoted RFC-style comma-separated records with CRLF lines. The header identifies units: `wavelength_nm`, `x_mm`, `y_mm`, `z_mm`, `u_mm`, `v_mm`. One row is emitted for every surface hit and a standalone `ray` row for rays with no hits. Rows retain ray/source/object-point IDs, final termination, element/surface/hit index, normal, incoming/outgoing directions, indices, media and event. Detector-hit rows have physical u/v values; other rows leave them empty. This single CSV contains the spot population and its full upstream surface histories. All fields are escaped/quoted; downstream software should treat identifiers as text.

## Independent Core API

No DOM or rendering dependency is needed for generated fixtures or numerical work:

```js
import { createProject } from "./src/examples.js";
import {
  validateProject,
  generateRays,
  traceProject,
  focusScan,
} from "./src/optics.js";

const project = createProject();
const check = validateProject(project); // {valid, errors}
if (!check.valid) throw new Error(check.errors.join("\n"));
const rays = generateRays(project);
const result = traceProject(project, {
  rays,
  maxInteractions: 64,
  maxPath: 5000,
});
const scan = focusScan(project, "detector-0", {
  start: 65,
  end: 110,
  steps: 21,
  rays,
});
console.log(result.metrics, scan.best);
```

`traceRay(project, {id, sourceId, objectPointId, wavelength, origin, direction}, options)` accepts explicit 3D fixtures and preserves identities. Manual fixture source IDs need not refer to a source element; they represent externally generated emitters. The core normalizes nonzero finite directions and determines the starting medium itself. Public helper exports include `reflect`, `refract`, `refractiveIndex`, `toWorld`, `toLocal`, `directionToWorld`, `elementBounds`, `prismVertices` and `objectPoints`.

`traceProject` returns `{rays, count, duration, terminations, spots, metrics}`. `duration` measures the trace plus aggregation in milliseconds, excluding initial validation, source generation, worker startup and result transfer. `focusScan` returns `{samples, best}`; each sample has `{position, rms, count, throughput}`. Core scans permit 1-1001 positions, including reversed intervals; the interactive UI deliberately limits intervals to ascending, finite 2-101-position scans. The core functions are synchronous; the UI runs them in workers so they can be cancelled by terminating the worker.

## Files

| Path                   | Responsibility                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `src/optics.js`        | Validation, transforms, analytic geometry, medium tracking, sampling, tracing, moments and focus |
| `src/examples.js`      | Element/project factories and independent selectable experiments                                 |
| `src/trace.worker.js`  | Request-ID-preserving worker entry point                                                         |
| `src/App.jsx`          | Document/history, validated edits/imports, worker lifecycle, inspector and controls              |
| `src/Bench.jsx`        | Editable XY projection with 3D ray data and hit inspection                                       |
| `src/Scene3D.jsx`      | Finite visual meshes, orbit controls, ray/spot rendering and GPU cleanup                         |
| `src/Measurements.jsx` | UV distributions, grouped tables, focus plot and ray-hit inspector                               |
| `tests/verify.mjs`     | Independent numerical references and regression fixtures                                         |
| `tests/browser.mjs`    | Actual production browser workflows and 10,000-ray benchmark                                     |
