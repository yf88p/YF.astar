# Viewport Rendering and Physics Performance

Measured on 2026-09-06. The original results below retain the run starting at
`2026-09-06T10:40:24.466Z`, not the fastest observed run. The
[final byte-budget rerun](#final-byte-budget-rerun), at the end of this report,
measures the final core after exact recording-size accounting was added.

## Outcome

- The horizontal rectangular streaks in the actual 1440 x 960 application view
  are absent after the changes, including after a desktop resize round trip.
- Glass uses reflective, alpha-blended `MeshPhysicalMaterial` with opacity 0.30,
  transmission 0, and no clearcoat pass. It does not sample a screen-space
  refraction buffer. Its actual shard surfaces and edges remain visible.
- Ground and stage are disjoint surfaces meeting at the physical `y=0` plane.
  The surrounding ground has a real geometry cutout matching the stage; there
  are no overlapping coplanar planes, polygon offsets, or added obstacles.
- Matte ground uses textured Lambert shading with real directional shadows.
  Steel, timber, concrete fragments, and reflective glass retain PBR materials
  and the locally generated environment. Shadow resolution is 1024 x 1024,
  down from 2048 x 2048. Antialiasing and full canvas resolution remain enabled.
- A fractured shard uses one material draw instead of separate exterior and
  interior draws. A per-triangle attribute supplies the fracture tint, opacity,
  and roughness. Each original mesh, triangle, pose, object ID, fragment ID,
  raycast target, and visibility state is retained. No merged stand-ins,
  particles, hidden fragments, or fake debris are used.
- Hidden bond overlays no longer rebuild their vertex/color buffers, and state
  updates no longer force a redundant full scene matrix update before rendering.

The old renderer had both screen-space transmission and overlapping floor
surfaces. Both were removed; the visual checks do not establish that PMREM
alone caused the original streaks. The generated RoomEnvironment remains.

## Reproduce

```bash
node tests/performance.mjs
```

The harness imports the actual `Viewport`, `Simulation`, and `Recorder`. It
starts its own Vite server on a kernel-selected free localhost port, with a
separate optimization cache, and closes its browser/server in `finally`. It
does not use, replace, or stop the application's server on port 5179.

Default artifacts are written outside the repository:

```text
/tmp/opencode/fracture-performance/results.json
/tmp/opencode/fracture-performance/storefront.png
/tmp/opencode/fracture-performance/released-300.png
/tmp/opencode/fracture-performance/live-300-final.png
```

`results.json` contains every timing sample, per-frame physical/visible counts,
camera poses, material settings, hardware details, and source SHA-256 hashes.
The harness rejects a run if the viewport or measured core source files change
during measurement. Set `PERF_OUTPUT` to preserve a separate run directory.

For a shorter intact-scene measurement:

```bash
PERF_ONLY=storefront PERF_FRAMES=60 PERF_OUTPUT=/tmp/opencode/fracture-short node tests/performance.mjs
```

## Environment

| Setting | Measured Value |
| --- | --- |
| Browser | Headless Chromium 153.0.8010.12 |
| Three.js | r174 |
| Renderer | ANGLE, Vulkan 1.3.0, SwiftShader Device (Subzero), `0x0000C0DE` |
| Vendor | Google Inc. (Google) |
| Graphics API | WebGL 2.0 / OpenGL ES 3.0 Chromium |
| Shader language | WebGL GLSL ES 3.00 |
| CPU | AMD Ryzen 7 5825U with Radeon Graphics |
| Logical CPUs / browser hardwareConcurrency | 16 / 16 |
| OS | Linux x64, kernel 7.0.0-31-generic |
| Reported memory | 12,949,561,344 bytes, approximately 12.06 GiB |
| Browser viewport | 1100 x 800 |
| Visible canvas / drawing buffer | 824 x 600 / 824 x 600 |
| Device / renderer pixel ratio | 1 / 1 |
| Context | Antialiasing, depth, preserveDrawingBuffer enabled |
| Shadows | PCFSoftShadowMap, 1024 x 1024, key light only |
| Tone mapping | ACESFilmic, exposure 1.08, sRGB output |
| Layers | Grid, trajectory, dimensions enabled; bonds, wireframe, presentation disabled |

Chromium flags: `--no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader`.
The Radeon name is part of the CPU model string, **not** the measured renderer.
No native GPU measurements were available. The canvas is an ordinary visible
DOM element on the browser page, not an offscreen or CSS-hidden benchmark.

## Physical Fixture

Six independent authored objects contain 50 fragments each. The material order
is glass, concrete, timber, steel, glass, concrete. Every object has dimensions
`[1.5, 2, 0.08]` metres and `fixed: false`. Centers are laid out at x = -2, 0, 2,
y = 2.5, and z = -1.5, 1.5; seeds are 1800 through 1805. The measurement camera
is at `[8, 6, 10]`, targeting `[0, 1, 0]`, with a 36-degree FOV.

The fixture deliberately uses project-local threshold 1 Pa and toughness
0.001 J/m2 for all materials, keeping normal densities and other parameters.
These are brittle benchmark settings, not realistic material calibrations.
Gravity is 9.81 m/s2, solver iterations are 6, and the timestep is 1/120 s.

The initial simulation has six compound bodies. The harness calls the public
`Simulation.applyImpulse` API once at each fragment's actual initial COM:

```js
sim.applyImpulse(
  fragment.initialPosition,
  [0.08 * x, 1, 0.08 * z],
  fragment.mass * 0.22,
);
```

The core normalizes the direction and applies this physical impulse. All 300
calls are accepted. Bonds fail through the core's normal damage/rebuild path.
The harness never writes `broken`, `damage`, velocities, body transforms, or
simulation masses. Release setup took 1,220.5 ms in this run and is reported
separately from frame timing.

The assertions distinguish released pieces in a compound body from independent
bodies. Throughout all 120 displayed live frames:

| Check | Minimum | Maximum |
| --- | ---: | ---: |
| Real fragment meshes with `visible === true` | 300 | 300 |
| Fragment centers inside camera clip space | 300 | 300 |
| Distinct recorded body IDs | 300 | 300 |
| Physical components | 300 | 300 |
| Released fragments | 300 | 300 |
| Active fragments | 300 | 300 |
| Sleeping fragments | 0 | 0 |

Every displayed fragment position and quaternion is checked against its
snapshot. Every fragment has positive mass. Total simulated mass is 4,392 kg.
Visibility here does not imply that every surface is unoccluded: normal depth
occlusion between real pieces remains enabled.

At 2.000 physical seconds the recording contains 241 frames, 658 broken bonds,
85 yielded steel bonds, and 60,599 reported contact pairs/events accumulated by
the core. Its validated, serialized JSON is **57,719,183 bytes (55.05 MiB)**.
This is measured UTF-8 JSON length, not an estimate from an empty recording.

## Timing Method

- The intact scene and live fixture each receive 20 untimed renderer warmup
  frames. Reverse replay receives 12. Shader warmup is not advertised as FPS.
- Each final phase measures 120 frames. Live simulation executes exactly two
  fixed ticks per displayed frame, captures every tick, and finishes at 240
  ticks / 2 physical seconds. It does not drop physics ticks to inflate FPS.
- Reverse replay samples that same recording from 119/60 s down to 0 s. It
  measures actual snapshot sampling, state application, shadows, and drawing,
  without contact solving or recording capture.
- `renderMs` surrounds `renderer.render`. This is main-thread submission time,
  which may include driver stalls, **not GPU completion time**.
- RAF intervals bracket the rendered work, including the final frame's next
  RAF. They reflect observed browser cadence, including software rasterization,
  compositor scheduling, validation checks, and the small live status label.
- Frame CPU measures simulation/capture or replay sampling, state application,
  and viewport rendering. Per-frame assertion/HUD work occurs outside that CPU
  bracket but remains included in RAF intervals.
- Percentiles use nearest rank. FPS is `1000 / mean(RAF interval)`, not the
  average of instantaneous reciprocal timings. There is no `gl.finish()` loop,
  hidden renderer, wall-time simulation catch-up, or synthetic rendering load.

## Results

The initial 167-fragment viewport measured 2.17 RAF fps in a 60-frame baseline,
with mean render submission of only 4.60 ms but mean RAF interval of 461.37 ms.
That mismatch is why the submission timer alone did not describe the problem.

| Last Complete Run | RAF FPS | Mean Render Submission | Mean Frame CPU | Final Main-Pass Draw Calls |
| --- | ---: | ---: | ---: | ---: |
| Intact storefront, 167 fragments | 10.70 | 4.96 ms | 5.05 ms | 179 |
| Live physics + recording, 300 independent fragments | 8.04 | 12.43 ms | 57.66 ms | 403 |
| Reverse replay, same 300 fragments | 10.36 | 12.54 ms | 17.35 ms | 305 |

Draw-call counts are Three's final main render-pass counters, not a sum of all
shadow-map submissions. The live final frame draws 4,778 actual triangles, with
406 allocated geometries and six textures. Before the fracture-face material
optimization, the comparable final frame required 703 main-pass draws for the
same 4,778 triangles. The final replay sample is the zero-time release pose;
its coherent glass object outlines explain the lower 305-call final count.

### RAF Frame Intervals

| Phase | Mean | P50 | P90 | P95 | P99 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Intact | 93.47 ms | 83.40 | 116.60 | 150.00 | 350.00 | 783.30 |
| Live 300 | 124.30 ms | 116.60 | 233.20 | 250.00 | 316.70 | 316.70 |
| Replay 300 | 96.52 ms | 100.10 | 149.90 | 200.00 | 233.30 | 233.30 |

### Main-Thread Render Submission

| Phase | Mean | P50 | P90 | P95 | P99 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Intact | 4.96 ms | 3.90 | 8.20 | 10.40 | 14.70 | 18.40 |
| Live 300 | 12.43 ms | 11.70 | 16.90 | 19.40 | 24.30 | 33.50 |
| Replay 300 | 12.54 ms | 11.50 | 18.10 | 20.90 | 30.20 | 30.80 |

### Frame CPU and Live Components

| Operation | Samples | Mean | P50 | P95 | P99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Intact complete frame CPU | 120 | 5.05 ms | 4.00 | 10.60 | 14.80 |
| Live complete frame CPU | 120 | 57.66 ms | 52.90 | 82.50 | 98.00 |
| Replay complete frame CPU | 120 | 17.35 ms | 16.10 | 30.00 | 34.70 |
| Physics step, including core snapshot | 240 | 17.57 ms | 15.40 | 32.50 | 55.40 |
| Recorder capture per fixed tick | 240 | 4.56 ms | 4.20 | 7.60 | 14.50 |
| Viewport state application, live | 120 | 0.91 ms | 0.70 | 2.30 | 4.30 |
| Recorder sample, replay | 120 | 3.42 ms | 3.30 | 6.30 | 7.40 |

## Limits and Variability

An earlier complete run of the same explicitly sized 300-body fixture, with
the same camera and all 300 centers in frame, measured 16.82 fps intact,
11.25 fps live, and 13.77 fps in replay. The only intervening viewport change
corrected the optional missing-impact-state preview boundary and documented the
CPU timer; neither changes these measured scene renders. The lower last run is
published above rather than choosing the best result. Scheduling and sustained
software-rendering behavior on this shared host are not controlled.

Thus the viewport substantially improves on the original roughly 2-fps intact
view, and the render/replay path exceeded 10 fps in both of these complete
runs. **A sustained greater-than-10-fps guarantee for 300-body live physics plus
recording is not established.** The final live run was 8.04 fps. The average
17.57 ms physics step alone exceeds the 8.33 ms budget required for 120-Hz
real-time simulation, before recording and rendering. Two simulated seconds
took about 14.92 seconds of measured live RAF intervals in that run.

This fixed-two-ticks-per-frame benchmark is not a measurement of the React UI's
wall-time catch-up loop. The 300-body scene is still active at two seconds; it
is not a sleeping-body throughput shortcut, and no sleeping-scene benchmark is
claimed. Alpha-sorted glass intentionally does not provide volumetric
refraction or order-independent transparency through arbitrarily overlapping
shards. No native-GPU performance claim is made.

The baseline was captured before concurrent core preset edits; storefront glass
subsequently changed from 35 mm to 12 mm while keeping the same 167 fragments.
Its observed before/after rate is indicative, not an isolated material-only GPU
experiment. Final source hashes and the complete final fixture parameters are
recorded in `results.json`.

## App and API Verification

The actual app at `http://localhost:5179` was checked at 1440 x 960, after a
desktop resize round trip, and at 390 x 844. The desktop canvas is 924 x 632,
larger than the benchmark. Its instantaneous footer read approximately 13-14
fps during the screenshot check; that is not a percentile measurement.

```text
/tmp/opencode/fracture-app-refined-desktop.png
/tmp/opencode/fracture-app-refined-resized.png
/tmp/opencode/fracture-app-refined-mobile.png
```

All scheduled projectiles now have independent bounded dashed ballistic
previews, launch markers, and contact reticles. Local impulses have an anchored
reticle and force-direction arrow, never an invented ballistic path. Each
preview disappears according to its own recorded fired/spawn state and returns
correctly on rewind. Presentation mode suppresses all these helpers.

The only new viewport method is:

```js
viewport.setPreviewImpact(id);   // Optionally isolate one scheduled impact.
viewport.setPreviewImpact(null); // Default: show every not-yet-fired impact.
```

The existing UI needs no change to see all impacts. No camera, selection,
transform, visibility, render-loop, or video-export API was removed or changed.
Core and React UI code were not edited by this rendering work.

Headless regression checks passed for actual gizmo pointer drags, mesh-surface
aiming, selection, multi-object transforms, exact shard/projectile poses,
backward seeking, path/tracking determinism, all-impact preview state and
isolation, presentation mode, and disposal. A 12-frame VP9 export decoded and
sought at exactly 0.400 seconds; PNG export, cancellation, and restoration also
passed. All 26 current core tests pass. Production build succeeds with its
existing large-bundle warning. Module syntax checks pass.

## Final Byte-Budget Rerun

Run at **2026-09-06T11:37:54.283Z**, after the recorder gained exact UTF-8 byte
accounting and a 127 MiB frame-data cap. Reproduce with:

```sh
PERF_OUTPUT=/tmp/opencode/fracture-final-performance npm run test:performance
```

The same browser, hardware, visible 824 x 600 canvas, shadow settings, six solver
iterations, fixtures, warmup counts and 120 measured frames per phase were used.
Source hashes were verified unchanged during the run. Full raw samples, hashes,
counts and screenshots are in the named output directory. Unlike the earlier
measurements, these timings include the final byte counter on every capture.

| Final Phase | Mean RAF FPS | RAF Mean / P50 / P95 / P99 | Mean Frame CPU | Mean Render Submission |
| --- | ---: | --- | ---: | ---: |
| Intact storefront | 17.82 | 56.11 / 66.60 / 116.60 / 116.70 ms | 3.94 ms | 3.85 ms |
| Live 300 bodies + recording | 11.96 | 83.61 / 66.70 / 166.70 / 250.00 ms | 61.80 ms | 9.87 ms |
| Reverse replay, same 300 bodies | 14.26 | 70.14 / 83.30 / 133.40 / 166.60 ms | 14.72 ms | 10.61 ms |

Live work averaged **14.47 ms per physics tick** and **11.07 ms per recorder
capture**. Their P95 values were 20.30 ms and 14.80 ms respectively. State
application averaged 0.79 ms per live frame; replay sampling averaged 3.08 ms.
Mean frame CPU increased relative to the earlier run despite improved observed
RAF cadence. That discrepancy demonstrates host/compositor variability; it is
not evidence that byte accounting made rendering faster.

All **300 visible mass-carrying fragments remained 300 independent active bodies,
with 0 sleeping**, throughout every live measured frame. All centers remained
in the camera frustum. The final state again had 658 broken bonds, 85 yielded
steel bonds, 60,599 contact events and 4,392 kg total fragment mass. The 241-frame
recording again validated and serialized to **57,719,183 bytes (55.05 MiB)**.
No fragments, contacts, events or recording ticks were dropped to obtain the result.

Main-pass final draw counts remained 179 intact / 403 live / 305 replay. The live
scene contained 4,778 triangles, 406 allocated geometries and six textures. Two
physical seconds required approximately **10.03 seconds of measured live RAF
intervals**. This is still not 120 Hz real-time simulation and still does not
establish a native-GPU or sustained minimum-FPS guarantee. The earlier 8.04 FPS
result is deliberately retained rather than hidden by the better final sample.

A later one-line camera fix makes the generic projectile tracker select the first
projectile rather than the last in a multi-shot scene. This benchmark uses its
explicit fixed camera, so that selection path is not part of the measured work.
The recorded core and byte-accounting source hashes remain the measurement's
reference; no new timing claim is inferred from subsequent UI-only changes.
