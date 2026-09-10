# Independent Numerical Verification

## Command and Result

```sh
node tests/verify.mjs
```

Recorded on 2026-09-06 with Node v24.19.0, Linux. No numerical dependencies, browser, or test framework are required. The `.mjs` runner imports the ESM core directly; the project declares `type: module`.

**Current result: 13/13 groups pass; exit status 0.** All numerical, propagation, detector/focus, geometry-validation, factory, and example checks pass. The runner continues after a failed group, prints measured quantities and assertion stacks, and fails the process if any group fails.

```text
13/13 groups passed; 27891 traced rays checked for finite data and explicit termination; 1631 ms
```

Runtime is informational, not a performance threshold. The ray count includes independent scan replays and example JSON-round-trip replays, not just unique launches.

## Regression Caught and Fixed

The independent suite caught an inherited-property lookup in the element factory. `src/examples.js` now uses `Object.hasOwn(defaults, type)`, rejecting `__proto__`, `constructor`, and `toString` as unsupported types.

Minimal reproduction:

```sh
node --input-type=module -e 'import {createElement} from "./src/examples.js"; console.log(createElement("toString"));'
```

This now throws `Unknown element type: toString`. Project validation also rejects these unsupported types. The final regression group requires all three names to throw and passes.

## Independence and Tolerances

Expected results never come from `refract`, `reflect`, `refractiveIndex`, `toWorld`, `toLocal`, `directionToWorld`, `prismVertices`, `objectPoints`, or a tracer-provided focus/metric value. Public helpers are tested as subjects, not used as reference implementations. Independent calculations use scalar trigonometry, sequential Euler-axis rotations, vector invariants, 2x2 ray-transfer matrices, line-intersection least squares, and two-pass statistics. Detector positions/hit UV values are observations used to recompute metrics, not an independent verification of all ray geometry.

All lengths are millimeters, wavelengths nanometers, and internal angle calculations radians. Euler fixtures use degrees; azimuth is measured from local +Y toward +Z around the local +X optical axis. Lens radii are signed and apertures are diameters.

| Check                                              | Acceptance tolerance                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Snell normalized residual                          | `abs(n1*sin(i) - n2*sin(r))/max(n1,n2) <= 1e-6`                                                       |
| Scalar Snell outgoing direction                    | Each component within `2e-12`                                                                         |
| Mirror equal-angle cosine and coplanarity          | Each residual `<= 1e-12`                                                                              |
| Slab displacement                                  | Absolute error `<= 1e-5 + 1e-6*abs(expected)` mm, additionally error / `max(1,abs(expected)) <= 1e-6` |
| Slab emergent parallelism                          | Direction-vector difference norm `<= 3e-12`                                                           |
| Lens EFL, BFL, image distance, magnification       | Each relative error strictly `< 0.01`                                                                 |
| Imaging focus-grid location                        | Within `0.00250001` mm of independently fitted focus, half of a `0.005` mm step plus roundoff         |
| Prism deviation                                    | Absolute error `<= 1e-10` rad                                                                         |
| Independently recomputed detector/focus statistics | Absolute error `<= 2e-11` mm                                                                          |
| Fixed-population throughput                        | Exact division by the complete launch count                                                           |
| B=0 cross-wavelength trajectories                  | Bit-identical points, hits, directions, lengths, and terminations                                     |
| 1e-9 mm surface gaps and slab thickness            | Absolute position/distance error `<= 1e-15` mm                                                        |
| Direction/normal unit norm                         | Absolute error `<= 2e-12`                                                                             |
| Geometric path length                              | `2e-9 + 2e-12*length` mm                                                                              |

Ordinary hit-position/transform checks use `2e-12` to `3e-10` mm, depending on geometry size. The exactly critical TIR case separately permits `3e-8` in the normal direction cosine because recovering a zero cosine from a rounded sine is square-root-conditioned. Both sides of the critical-angle neighborhood are tested much more strictly for the correct event and medium.

## Refraction and Reflection

**Snell.** For unit directions and interface normal, `sin(i) = |incoming x normal|` and `sin(r) = |outgoing x normal|`. Independently predict `r = asin((n1/n2)*sin(i))`, retain the tangential azimuth, and rotate into the world frame using successive X, Y, Z rotations. Each case must actually hit the finite slab at the independently selected point, record the expected front/back surface and medium transition, and produce one refractive event. A one-interaction limit isolates the interface; the helper alone is not sufficient to pass.

Sampling: 20 mm thick, 100 mm diameter slab centered at `[7,-11,5]`; orientations `[0,0,0]`, `[13,-27,41]`, `[-38,64,19]`; azimuths `0,29,90,177,251,315` degrees. Ambient/glass index pairs are `(1,1.2)`, `(1,1.5)`, `(1,1.9)`, `(1.33,1.5)`, and `(1.5,1.5)`, each traced in both directions. Entry incidence angles: `0,0.00001,5,20,40,60,80` degrees. Exit angles: `0,0.00001,5,20,35,40` degrees, excluding angles that exceed a pair's critical angle; TIR is tested separately below. Launches are 3 mm from the selected interface. The direct helper is additionally tested with scaled input directions and both normal signs. Equal-index cases verify that an explicit medium boundary does not cause false deflection.

**Mirror.** The independent plane reference reverses the local X direction component and retains local Y/Z. Equal incidence/reflection angles require `abs(d_in dot n) = abs(d_out dot n)`; coplanarity requires `d_out dot (d_in x n) = 0`. Also require opposite normal-component signs. Four orientations, both incident sides, four incidence angles (`0,12,45,79` degrees), and four azimuths exercise real finite hits. Four rays outside the 30 mm mirror aperture must miss. Eight spherical-mirror cases use radii `-50,+50` mm and a 6 mm hit radius; positions and normals are independently obtained from the sphere equation, not a production sag helper.

| Measurement                                | Result                |
| ------------------------------------------ | --------------------- |
| Snell finite-interface cases               | 1134                  |
| Maximum normalized Snell residual          | `2.960594732e-16`     |
| Maximum scalar transmission-angle error    | `1.332267630e-15` rad |
| Mirror hit cases                           | 136, plus 4 misses    |
| Maximum mirror equal-angle cosine residual | `2.220446049e-16`     |
| Maximum mirror coplanarity residual        | `1.110223025e-16`     |

## TIR and Slab

**Critical angle:** `theta_c = asin(1/1.5) = 41.8103148958` degrees. An actual generated one-ray collimated source starts at the center of a finite 20 mm thick, 200 mm diameter slab. Test offsets `-10,-1,-1e-3,-1e-6,-1e-9,+1e-9,+1e-6,+1e-3,+1,+10` degrees, at azimuths `0,37,90,231` degrees. All 40 cases must start in the slab medium with `n1=1.5,n2=1`. Below critical, the first hit transmits and the ray escapes; above critical, every optical hit is TIR, the solid ID remains unchanged, and the eventual finite rim absorbs. These cases produce 108 TIR events. The exactly critical case is also checked separately.

**Plane-parallel displacement:** with thickness `t`, incidence `i`, and `r=asin(sin(i)/1.5)`, the independent exit point is

```text
(t/2, t*tan(r)*cos(phi), t*tan(r)*sin(phi))
```

The perpendicular separation of incident and emergent lines is

```text
delta = t*sin(i-r)/cos(r)
measured_delta = |(exit-entry) x incident_unit_direction|
```

This is perpendicular line displacement, not the larger transverse difference measured on a constant-X plane. The emergent direction must equal the incident direction. Sample thicknesses `3,20,73` mm, incidences `0,10,35,60,75` degrees, azimuths `0,37,90,203,317` degrees, and rotations `[0,0,0]`, `[17,-23,39]`: 150 cases. The 1000 mm diameter remains finite but prevents unintended rim selection.

| Measurement                                | Result               |
| ------------------------------------------ | -------------------- |
| Maximum slab displacement error            | `2.131628207e-14` mm |
| Maximum normalized slab displacement error | `6.153480596e-15`    |
| Maximum emergent direction error           | `1.217454593e-15`    |

## Paraxial Lens

### Parameters and Sampling

This is a separate numerical fixture, not a claim that the wider showcase lens is thin/paraxial. The selectable Paraxial Focus example uses these same geometric/index/pupil parameters with 121 built-in sunflower rays rather than the independent 65-ray concentric-ring sampling used here.

| Parameter                         | Value                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| Glass / ambient index             | 1.5 / 1, nondispersive                                                               |
| Wavelength                        | 550 nm                                                                               |
| Front / rear radius               | +100 / -100 mm                                                                       |
| Center thickness                  | 0.5 mm                                                                               |
| Clear physical diameter           | 10 mm                                                                                |
| Illuminated pupil radius          | 0.25 mm                                                                              |
| Pupil sampling                    | Axis plus 16 equal azimuths on each of radii 0.0625, 0.125, 0.1875, 0.25 mm: 65 rays |
| Collimated launch plane           | X=-5 mm                                                                              |
| Object distance from front vertex | 300 mm, object plane X=-300.25 mm                                                    |
| Object heights                    | -0.05, 0, +0.05 mm, Z=0                                                              |
| Imaging population                | Same 65-point pupil per object: 195 rays; no clipping or detector misses             |
| Detector                          | 2 x 2 mm                                                                             |
| Imaging focus grid                | Predicted global image X +/-0.04 mm, 17 samples, 0.005 mm steps                      |

### Independent Envelope

The geometry is thin because `t/EFL = 0.004996`, and low-aperture because `pupilRadius/|R| = 0.0025`, with image-side numerical aperture approximately 0.0025. The thin-lens value is 100 mm; the thick EFL correction is only 0.083403%. The entrance slope is at most `(0.25+0.05)/300 = 0.001`. The front normal angle is about 0.0025 rad. The first refracted angle is bounded by approximately `(1-1/n)*0.00251 + (1/n)*0.00101 < 0.001511` rad, plus a small Snell remainder. Propagation over 0.5 mm keeps the ray height below 0.251 mm. The next normal angle is below 0.002511 rad, so both incidences are safely below the deliberately loose 0.006 rad bound, independently of the tracer's measured angles.

For an index ratio `eta` and `|i| <= u`, use the elementary bounds

```text
|sin(i)-i| <= |i|^3/6
|asin(x)-x| <= |x|^3 / (6*(1-x^2)^(3/2))
|asin(eta*sin(i)) - eta*i|
  <= eta*u^3/6 + (eta*u)^3/(6*(1-(eta*u)^2)^(3/2))
```

At `u=0.006`, the two surface remainders, including the 1.5 amplification of the first surface's angular error at the second, sum to less than `2.3e-7` rad. Spherical-normal linearization is below `3e-9` rad per surface at a conservative 0.26 mm height. Each sag is below `0.000339` mm; replacing curved surfaces by vertex planes perturbs heights by only a few `1e-6` mm at these angles. The exiting angle is below 0.004 rad, where slope-versus-angle error is below `2.14e-8`. Conservative engineering budgets of `e_s=1e-6` slope and `e_h=1e-5` mm vertex-height error therefore leave substantial margin over these remainders. These budgets are selected from geometry and Taylor bounds, not fitted to observed tracer errors.

Let `h_min=0.0625` mm and `e_spot=e_h+b*e_s=0.000159979158` mm. With the paraxial pupil-height transfer `A>0.998` and measured quantities defined below, the suite computes these conservative relative envelopes and asserts each is below 1%:

| Quantity       | Envelope calculation                                             | Relative envelope |
| -------------- | ---------------------------------------------------------------- | ----------------- |
| EFL            | `f*e_s/(h_min-f*e_s)`                                            | 0.160390283%      |
| BFL            | `(e_h+BFL*e_s)/(0.998*h_min-BFL*e_s)`                            | 0.176501726%      |
| Image distance | `2*e_spot/h_min`, allowing centering error in the fitted pencils | 0.511933306%      |
| Magnification  | `2*e_spot/(abs(m)*0.1)` for the two outer objects                | 0.639650000%      |

The separate measured error assertions still require `<1%`, including the **worst individual off-axis collimated ray** for EFL/BFL, not merely an average. All imaging rays are also checked against the independent matrix image point within `e_spot`. The maximum actual incidence is `0.003500005396` rad; maximum matrix image-point error is `2.896778119e-6` mm.

### Reference Formulas

For a lens in air, the independent thick-lens equation is

```text
1/f = (n-1)*(1/R1 - 1/R2 + (n-1)*t/(n*R1*R2))
```

Use ray coordinates `[height, n*angle]` and independently multiply

```text
S1 = [[1,0],[-(n-1)/R1,1]]
T  = [[1,t/n],[0,1]]
S2 = [[1,0],[-(1-n)/R2,1]]
M = S2*T*S1 = [[A,B],[C,D]]

EFL = -1/C
BFL = -A/C
b = -(A*s+B)/(C*s+D)       # rear-vertex image distance for object distance s
m = A+b*C                 # transverse magnification
```

The independent matrix and thick-lens equation must agree and `det(M)` must be 1. BFL is not substituted for EFL, and global X is not mistaken for distance from the rear vertex at X=0.25 mm.

From each collimated exit hit, let `q=outgoing_YZ/outgoing_X`, `h0=launch_YZ`, and `h=exit_YZ`. Measure `EFL=-dot(h0,q)/dot(q,q)` and `BFL=exit_X-0.25-dot(h,q)/dot(q,q)`. Skip the exactly axial ray, which cannot determine a focal distance.

For imaging, write the measured exit lines relative to the rear vertex as `h_j(x)=a_j+x*q_j`. Subtract per-object means. The independent continuous least-squares best image distance is

```text
b_measured = -sum(dot(a_j-mean(a), q_j-mean(q)))
              / sum(dot(q_j-mean(q), q_j-mean(q)))
```

Re-trace onto a detector at that distance and measure magnification from the two outer detected centroids divided by the 0.1 mm object separation. This is not a tracer-reported magnification. Independently replay and recompute the grouped RMS for all 17 focus samples. The grid-selected image is 149.9791580 mm behind the rear vertex; its 0.0012340 mm difference from the continuous fit is within the 0.0025 mm half-step allowance.

### Measured Results

| Quantity       | Independent reference | Measured value                 | Relative error                            |
| -------------- | --------------------- | ------------------------------ | ----------------------------------------- |
| EFL            | 100.0834028 mm        | 100.0829640 mm, mean           | **0.000935396% maximum individual error** |
| BFL            | 99.91659716 mm        | 99.91611045 mm, mean           | **0.001039190% maximum individual error** |
| Image distance | 149.9791580 mm        | 149.9779240 mm, continuous fit | 0.000822784%                              |
| Magnification  | -0.5002084202         | -0.5002049457                  | 0.000694614%                              |

The thin-lens approximations for focal length, BFL, image distance, and magnification are separately required to differ from these thick paraxial references by less than 1%.

## Aperture and Metrics

**Spherical aberration:** keep the same lens, material, and 65-ray sampling pattern, but increase illuminated radius from 0.25 to 4.8 mm. The 10 mm physical aperture remains unchanged and positive edge thickness is retained. All 65 rays are detected at every scan sample. A 73-point focus scan runs from paraxial global focus minus 0.7 mm to plus 0.02 mm, step 0.01 mm. Every sample is independently replayed and its RMS recomputed from detected positions. No throughput reduction can manufacture the reported improvement at best focus.

| Pupil radius | RMS at paraxial BFL | Marginal BFL   | Best sampled BFL | Best sampled RMS    |
| ------------ | ------------------- | -------------- | ---------------- | ------------------- |
| 0.25 mm      | `1.406020442e-6` mm | 99.91555884 mm | 99.91659716 mm   | `1.406020442e-6` mm |
| 4.8 mm       | 0.01001361926 mm    | 99.53258080 mm | 99.63659716 mm   | 0.003824185694 mm   |

Require at least 100x larger RMS at paraxial focus, at least 10x larger best sampled RMS, and both marginal and best sampled BFL to shorten by more than 0.1 mm. Best-focus numbers are grid samples, not claimed continuous optima or universal pupil-weighted values.

**Independent metrics:** convert actual detector hit positions to local coordinates by subtracting detector position and successively applying inverse Z, Y, X rotations. Check `local_X=0`, and require `(u,v)=(local_Y,local_Z)` to agree with the recorded UV. Group by the entire tuple `(sourceId,objectPointId,wavelength)`. For each group and overall detector, use a two-pass mean and population variance:

```text
centroid = sum(UV)/N
rms = sqrt(sum(|UV-centroid|^2)/N)
focus_rms = sqrt(sum(N_group*rms_group^2)/N_detected)
throughput = N_selected_detector / N_total_launched
```

Do not mix overall object extent or inter-wavelength centroid separation into the grouped focus objective. Do not divide throughput by survivors or by all detectors' hits.

The 50-ray regression uses four distinct grouping tuples, an annular stop, a second detector, a miss ray, and a selected 2 x 1.4 mm detector at Y=0.2, Z=-0.3, rotation `[17,9,-13]` degrees. The selected detector is scanned in **absolute global X**, not along its tilted normal. Project and input arrays must remain unmodified.

| Global X samples (mm)      | 6    | 8    | 10   | 12   | 14   | 16   | 18   |
| -------------------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Selected hits              | 9    | 9    | 9    | 9    | 9    | 9    | 7    |
| Throughput, denominator 50 | 0.18 | 0.18 | 0.18 | 0.18 | 0.18 | 0.18 | 0.14 |

Maximum independently recomputed focus-RMS error: `1.665334537e-16` mm. Best sample: X=18 mm. This intentionally confirms the documented no-throughput-penalty behavior even when the best sample has fewer hits; it is not a recommendation to optimize systems without considering throughput.

Additional checks cover zero-input and nonzero-input/no-hit scans (`best=null`, RMS `null`, count/throughput 0, empty metric groups), exact RMS ties preferring more hits and then the earlier sample, and a one-step range selecting its start. A generated seven-point/two-wavelength population of 238 rays must give identical scans with automatic generation and explicitly supplied fixed inputs, with all three positions independently replayed. Metrics are also recomputed for every example and the optical focus scans.

## Prism

The finite prism has apex `A=60` degrees, size 30 mm, depth 35 mm, and Z rotation 64 degrees. A shared collimated 0.5 mm radius pupil at X=-80 contains 17 rays at each of six wavelengths. Independent face geometry gives incidence `i=56` degrees for the observed entry on `face-1`; exit must be `face-0`. The scalar reference is

```text
n(lambda) = 1.62 + 0.015/(lambda_nm/1000)^2
r1 = asin(sin(i)/n)
r2 = A-r1
e = asin(n*sin(r2))
deviation = i+e-A
measured_deviation = -atan2(outgoing_Y, outgoing_X)
```

| Wavelength (nm) | Independent index | Independent deviation (degrees) |
| --------------- | ----------------- | ------------------------------- |
| 430             | 1.701124932       | 56.68104126                     |
| 480             | 1.685104167       | 54.86980139                     |
| 530             | 1.673399786       | 53.60117297                     |
| 580             | 1.664589774       | 52.67293848                     |
| 630             | 1.657792895       | 51.97109020                     |
| 680             | 1.652439446       | 51.42647491                     |

All 102 rays transmit at both selected faces; maximum angular error is `5.551115123e-16` rad. Blue deviation must exceed red monotonically. Generated launch geometry must be identical at corresponding wavelengths. Repeating with `B=0` gives bit-identical entire trajectories across all six wavelengths for each pupil point, not merely similar refractive indices.

## Geometry and Persistence

- Stops: inner aperture 4 mm and outer diameter 10 mm; radii 0, 1.999, 2, 3, 5, 5.001, 6 mm distinguish clear opening, clipping boundaries, and rays outside the physical stop. A zero opening clips the axis. Outside the outer diameter is not incorrectly treated as opaque.
- Detectors: center/corner detections, just-outside width/height misses, parallel rays, and rays traveling away. A finite miss cannot create detector UV data or a hit.
- Absorption: slab and spherical-lens cylindrical rims, approached from both ambient and inside glass; axial rays outside the clear physical radius miss. Both finite prism end caps absorb. Coincident stop/detector and rim/detector cases confirm terminal-event priority.
- Repeated TIR: thickness 1 mm, diameter 200 mm, incidence 60 degrees at azimuth 37. A 12-interaction run terminates explicitly at the limit. A 200-interaction run produces 58 alternating front/back TIR bounces, retains glass medium, then absorbs on the rim.
- Repeated reflection: two mirrors 1 mm apart give 101 alternating hits and path length 100.5 mm. Check zero interactions, a 3.2 mm path limit, a free ray limited to 2 mm, and a detector beyond the path budget.
- Boundary launches: front-face inward and front/back outward launches must record the correct incident medium and a real zero-distance event. No launch position is displaced.
- Nearby surfaces: two separate 1 mm slabs with an ambient gap of `1e-9` mm, followed by a detector another `1e-9` mm beyond the rear face, must produce all five hits in order. Separately test a `1e-9` mm thick slab. These separations are above roundoff at the test coordinates and must not be skipped by a fixed epsilon.
- Nearly planar spheres: lens thickness `1e-6` mm, radii `+1e8,-1e8` mm, aperture 1 mm, launch height 0.2 mm. Both faces must be hit and the exit direction must agree with `[1,-2e-9,0]` within `1e-14`. Also normalize an input direction with components of magnitude `1e308` without creating nonfinite values.
- Validation: 63 invalid project fixtures cover versions 0/2/string/null/missing, units, dangling/deleted material references, duplicate IDs, unknown types, malformed vectors, coordinate limits, nonfinite material/geometry values, invalid Cauchy indices, negative/unresolved dimensions, impossible or intersecting lens radii/surfaces, overlapping/touching solids including conservative rotated-AABB rejection, degenerate prisms, impossible stops, detector sizes, source kinds/spreads/heights/counts/wavelengths, and the global population cap.
- Import boundary: validate JSON-decoded projects and require all examples to round-trip structurally and produce identical rays/spots/metrics. Reject malformed JSON, literal Infinity, numeric overflow `1e400`, and Infinity serialized to null. This tests the core JSON-plus-validation boundary; the actual production browser import/export workflow is additionally covered by `tests/browser.mjs`.
- API errors: invalid/nonfinite/duplicate-ID manual rays and trace options, invalid refraction vectors/indices, invalid focus ranges, missing detector IDs, and IDs pointing to non-detectors must throw.

Every returned ray is checked for finite origin, normalized launch direction, wavelength, points, hit positions/normals/incoming/outgoing directions, positive finite indices, path length, and detected UV if applicable. Hit segments follow the incoming direction, media are continuous, terminal hits have `outgoing=null`, and initial origin/direction describe launch rather than the last hit. Every ray has one of the six explicit terminations: `escaped`, `absorbed`, `detected`, `clipped`, `interaction-limited`, `path-limited`. Aggregated termination counts must agree with actual rays.

## Factory and Examples

`createProject()` returns independent nested state. All seven supported `createElement` defaults validate. Every example and a fresh default project validate, generate deterministic unique-ID populations, preserve cone/pupil bounds and independent seven-point emitter positions, trace without mutating the project, and survive JSON round trips with identical propagation and statistics. Unknown types, invalid factory indices and inherited property names are all rejected by passing regression groups.

Observed example populations and terminal outcomes, each traced twice for round-trip equivalence:

| Project              | Rays | Detected | Clipped | Absorbed | Escaped |
| -------------------- | ---- | -------- | ------- | -------- | ------- |
| `createProject()`    | 1701 | 795      | 906     | 0        | 0       |
| showcase             | 1701 | 795      | 906     | 0        | 0       |
| interface            | 41   | 41       | 0       | 0        | 0       |
| mirror               | 81   | 81       | 0       | 0        | 0       |
| tir                  | 61   | 0        | 0       | 61       | 0       |
| slab                 | 243  | 243      | 0       | 0        | 0       |
| paraxial             | 121  | 121      | 0       | 0        | 0       |
| spherical-aberration | 301  | 301      | 0       | 0        | 0       |
| prism                | 366  | 366      | 0       | 0        | 0       |
| extended-imaging     | 847  | 189      | 658     | 0        | 0       |
| clipping             | 401  | 60       | 282     | 1        | 58      |

No example ray is interaction-limited or path-limited under default settings. These observed counts are reported, not used as independent optical references. Limit behavior is tested explicitly in separate synthetic geometries.

## Production Browser Verification

The production build and all 17 headless browser workflow groups also pass. `npm run test:browser` constructs and edits real systems, drags a lens, exercises multiselection and keyboard history, adjusts its stop, inspects a ray, scans focus, compares dispersive wavelengths, exercises undo/redo and atomic JSON import/export, opens navigable 3D, checks mobile editing, and cancels running workers. Its real 10,000-ray multi-element workload records 50,000 surface hits. See [BENCHMARK.md](BENCHMARK.md) for measured time, hardware, browser and reproduction details.
