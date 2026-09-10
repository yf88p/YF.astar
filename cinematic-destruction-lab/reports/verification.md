# Verification Record

Evidence reviewed on **2026-09-06**. This report describes checked behavior and its
limits, not engineering validation of real materials. Sources are the actual
`src/App.jsx`, `src/viewport.js`, `src/video.js`, `src/core/` implementation,
[core specification](../src/core/PHYSICS.md), and test harnesses below.
Existing performance reports were not rewritten by this documentation pass.

## Reproduce

Start the complete application with `npm ci && npm start` using Node 20.19+ (20.x)
or Node 22. Vite defaults to port 5173, tries a higher port if that is occupied,
and the start script binds all interfaces. Use localhost for secure-context video.

```sh
npm test
npm run build
npm run verify
npm run test:production
npx playwright install chromium
node tests/browser.mjs
node tests/performance.mjs
```

Install the test browser only if missing; that download is a setup dependency,
not remote application computation. The two `.mjs` harnesses own free-port
localhost servers and clean up their browser/server. They do not require an
already-running editor. Use `BROWSER_OUTPUT` / `PERF_OUTPUT` to preserve separate
artifact directories. `npm run verify` runs core tests and build, not browser or
performance checks.

## Evidence Status

| Check | Result | Provenance |
| --- | --- | --- |
| Core regression suite | **30 passed; 0 failed, skipped or cancelled** after byte-accounting integration | Final `npm run verify` during this documentation pass, real Rapier 0.19.3 WASM; earlier baseline had 26 checks |
| Production build | Passed with Vite 6.4.3 | Final build splits the local physics (2.24 MB), graphics (522 kB), interface and app bundles; no chunk-size warning |
| Exact README threshold recipe | Real contact without damage at 0.25 and 1 m/s; fracture at 28 m/s | Additional local core execution during this pass, 200 ticks per case |
| Actual editor workflows | All 13 passed, no page/console errors | Final `npm run test:browser`, including byte-budget exhaustion and recovery |
| Final video artifact | 179 physical frames / 1.483333 s take; 737,970-byte VP9 WebM | `/tmp/opencode/fracture-final-workflows/`: modal playback/seek and downloaded-file decode verified; partial last-frame timing exercised |
| Browser rerun during this pass | All 12 workflows passed, no page/console errors; 164 physics frames, 1.358333 s decoded video, 679,444 bytes | `BROWSER_OUTPUT=/tmp/opencode/fracture-doc-verification node tests/browser.mjs` |
| Visible 300-body performance | Final 11.96 live RAF FPS, 55.05 MiB serialized take | [Final byte-budget rerun](performance.md#final-byte-budget-rerun), starting `2026-09-06T11:37:54.283Z`; earlier 8.04 FPS run retained |
| Production browser | Passed at 1440 x 900 and 390 x 844 | `npm run test:production`: built chunks load, real fracture occurs, no remote requests/page errors or mobile horizontal overflow |

The documentation-pass command ran on Linux with **Node v24.19.0**, not a fresh
Node 20/22 matrix. Node 20.19+/22 is the documented setup, not a claim that this
pass executed both versions. The installed dependencies and existing lockfile
were used; this pass did not reinstall them with `npm ci`.
Rapier emits an upstream initialization-deprecation warning. Earlier builds emitted
a chunk-size warning; final manual chunking separates physics, graphics and interface
code and removes that warning. The WebM muxer remains a separate local lazy chunk.

Recorder byte accounting landed during this pass. The compact take cap is
**128 MiB UTF-8**, including a reserved **1 MiB** for project/cameras/envelope and
array punctuation; complete frame payloads are conservatively capped at **127 MiB**.
Independent tests compare counters against `TextEncoder().encode(JSON.stringify(...))`,
including escaping, multibyte text, lone surrogates and number formatting. Small
custom budgets test exact-boundary acceptance, atomic append/replacement rejection,
replacement refunds and restored import counters. Metadata overflow is rejected
before cloning. A shared-text object take tests the global frame cap without
allocating a huge JSON string or 128 MiB of distinct payloads. No frames or
incompatible discrete events are silently dropped.
The app's file gate is separately 256 MiB; parsed takes must meet the stricter compact
payload/metadata cap before document replacement. Core raw-string imports reject
more than 128 MiB UTF-8, including whitespace, before parsing.

The recorder preserves its last valid frame but cannot roll back an already-stepped
Rapier world. The final UI catches the structured byte-limit error, pauses, restores
the last committed visual state and marks the take read-only. Live controls and
forward simulation are blocked until Reset. The thirteenth browser workflow lowers
the real UI resource limit to 0.125 MiB and verifies atomic freeze, playable/exportable
complete history, rejected stepping and successful reset/recovery. It exercises the
same boundary without deliberately consuming the entire default 127 MiB allowance.
The final source was rechecked with `npm run verify`, the production-browser smoke
test, and `BROWSER_OUTPUT=/tmp/opencode/fracture-final-workflows npm run test:browser`.
All 30 core test groups, all 13 workflows, the production build and production
browser passed. This last workflow run produced the 179-frame artifact in the table.

## Independent Core Checks

These are assertions in [`tests/core.test.js`](../tests/core.test.js), not judgments
from rendered positions alone. Unless noted, tolerances are **absolute**, applied
componentwise to vectors, not relative percentages. The isolated release test also
explicitly checks `abs(residual) <= absoluteTolerance + 1e-6 * abs(referenceComponent)`
for both momenta, alongside the stricter absolute fixture assertions. Generated mass
is explicitly checked against relative error 0.00001 for every material/count fixture.

| Mechanic | Independent check / tolerance |
| --- | --- |
| Full-volume geometry and mass | All four materials at counts 1, 7, 48, 600; independent signed-tetrahedron volume/COM integration, exact envelope bounds and connected graph. Total mass tolerance 1e-5 kg. |
| Coverage and seeds | Independent interior point-in-convex-polygon sampling across layered concrete gives exactly one containing prism. Repeated seeds give exactly equal geometry; different seeds change topology. |
| Rigid-field split | A spinning two-piece box is split without gravity/contact. Independently computed analytic box inertia and angular momentum about one common world origin verify `v + omega cross r`. Linear residual tolerance 2e-4 kg*m/s; angular 2e-3 kg*m^2/s. |
| Analytic restitution | Real sphere/wall manifold contact at 20 m/s and `e = 0.65`: outgoing speed `e*v` within 0.05 m/s and impulse `m*(1+e)*v` within 0.05 N*s. |
| Dynamic fracture ordering | Actual projectile contact precedes split events; angular velocity field is retained and total linear momentum agrees within 0.01 kg*m/s. |
| All-material free impacts | Identical 1.35 x 2.4 x 0.04 m, 24-fragment specimens, no attachment and zero gravity; actual contacts, independent volume-density mass within 1e-5 kg and projectile-plus-fragment linear momentum within 0.015 kg*m/s. |
| CCD hits and misses | Actual 0.005 m glass panels; speeds 10, 50, 100 m/s; radii 0.05 and 0.5 m. Hits require real contact events and damage. Shots outside panel edge plus radius have neither. |
| Supported brittle prediction | Fresh-world real convex sweeps preserve collider count/volume, poses and pre-solve velocities on release. Repeated prediction does not credit another pulse. Measured contact remains separate. |
| Default Glasshouse | Real swept event, measured contact, moving volumetric shards and full-sphere passage behind the 12 mm pane; no hidden collision bypass. Work ledger is bounded and round-trips. The core specification records clearance at tick 72 / 0.600 s. |
| Arbitrary aim / blockers | Two rotated surface witnesses agree with independently transformed target points within 4 mm; off-edge shots and nearer steel shielding do not damage hidden glass. |
| Subcritical contact | Both glass and concrete at 0.25 and 1 m/s register real contacts but no damage or repeated budget credit over 200 ticks. |
| Equivalent range | All four specimens share dimensions/count and shot properties; all receive actual contacts. Glass/concrete pass-through, timber breaks, steel yield without broken bonds and rebound are fixture-specific assertions. |
| Support locality | Removing one attachment does not instantly break bonds or remove a remote attachment. Explicit connections can retain the remaining support. Gravity failures happen on subsequent ticks. |
| Load-path example | Unstruck weak-jointed structure remains intact for 240 ticks; removing either pier attachment causes internal gravity failures and more than 2 m of actual lintel displacement. |
| Timber / steel laws | Separate along/across-grain bond capacities; repeated steel impulses accumulate intermediate yield/damage before failure. No bending geometry is asserted. |
| Settling / wake | Concrete contacts the floor and settles above it. A sleeping piece independently wakes and moves after a new impulse or a later measured projectile collision. |
| Render independence | Two independent render-cadence accumulators produce exact equality of entire 120-tick histories, including fracture events, in the same runtime. |
| Replay / validation | Exact backward tick samples, fractional position/quaternion interpolation, preceding discrete transitions, copy isolation, import round-trip and tamper rejection. Scene, tick and frame limits; idempotent disposal. |

The extra README recipe used fixed glass, seed 12345, size `[1.35,2.4,0.04]`,
position `[0,2,0]`, 24 fragments, zero gravity; an 8 kg, 0.16 m projectile starts
at `[0,2,0.3]`, direction `[0,0,-1]`, time 0. At 0.25 and 1 m/s each run recorded
one contact and zero damaged/broken bonds. At 28 m/s, the 200-tick run recorded
91 contacts and 28 broken bonds, with approximately 4.8953 J credited fracture
work. These counts are observations of this fixture, not required outcomes for
every seed, discretization, impact point, or material edit.

## Browser Workflows

The inspected completed run used **headless Chromium 153.0.8010.12**, SwiftShader
software rendering, desktop **1440 x 960** and mobile **390 x 844**. The harness
records page exceptions and console errors and asserts an empty error list.
Its final thirteen passing workflows cover:

1. Local startup, the eight-object storefront, and editable project export.
2. Actual palette authoring, exact numeric dimensions, count/seed, and fixed support.
3. Duplicate, undo, redo, hierarchy selection and deletion.
4. Invalid dimensions/count, malformed project JSON and atomic rejection.
5. Pointer-based aiming on actual glass geometry and normalized changed direction.
6. Canonical shot, real projectile crossing and bond release; first break at **0.575 s** (not the later full-sphere clearance time).
7. Reverse scrub, paused pointer orbit, camera keyframe, tracking and 0.25x presentation with all recorded physics frames unchanged.
8. Recorded-scene edit confirmation: cancel, apply/reset, undo and redo.
9. Take reload preserving frames and camera/speed/playhead metadata; malformed camera metadata rejected before replacement.
10. PNG signature; actual WebM decode, seek and playback in the export modal; downloaded WebM opened and decoded as a separate `file://` document with matching duration.
11. Reset and one fixed-step advance to tick 1, 1/120 s (displayed as 0.008 s).
12. Mobile inspector/library tabs, presentation entry/exit and no horizontal overflow.
13. A lowered real recording storage budget, atomic exhaustion, valid take export, read-only stepping and reset recovery. Numeric Escape cancellation is also checked; Enter cannot auto-activate a newly focused confirmation button.

The run's **145 physics frames** include tick zero through tick 144. Its video
duration is **1.200 s**, size **535,970 bytes**, exported at 1x. Physics frame count
is not video frame count: 30 fps yields 36 encoded presentation frames for this take.
The harness seeks/plays in the modal, then separately decodes the downloaded file;
it does not assert a second seek/play sequence on the `file://` page.
Artifacts: `desktop.png`, `frozen-orbit.png`, `exported-video.png`, `mobile.png`,
`cinematic.webm` and `results.json` in `/tmp/opencode/fracture-workflows/`.
These are local artifacts, not files shipped in the repository. The original 145-frame
artifact was superseded by the final 158-frame, 1.308333-second, 602,140-byte export;
the original numbers above are retained as earlier-run evidence, not the final file.

The separate documentation-pass rerun preserved its artifacts under
`/tmp/opencode/fracture-doc-verification/`. All twelve workflows passed there too:
164 recorded physics states, decoded video duration **1.358333 s**, **679,444 bytes**,
first break **0.575 s**, and no page/console errors. This duration is not a multiple
of 1/30 s, exercising the partial-final-frame duration path. The harness pauses
after a UI-observed time threshold, not at a predetermined physics tick, so take
length and encoded byte size can differ between runs without violating fixed-step
determinism. Those earlier twelve-workflow runs did not test byte exhaustion; the
final thirteenth workflow now does so using the smaller configurable limit.

## Export And Offline Scope

Source inspection confirms 720p/30 fps VP9 WebCodecs, explicit microsecond
presentation timestamps, entire recorded duration divided by speed, a 120-second
output cap, bounded queue/flush, cancellation cleanup, and no audio or
MediaRecorder wall-time fallback. The application patches the existing WebM
Segment/Info duration field to include the last frame without shifting cue offsets.
`webm-muxer` is resolved to 5.1.4 by the lockfile. Video availability requires a
secure context and a supported VP9 encoder; unsupported browsers receive an error
and can use PNG. No Firefox/Safari video-encoding compatibility claim is made.
Cancellation/restoration and a separate 0.400-second VP9 check are reported in
[the existing performance report](performance.md#app-and-api-verification), not
additional assertions of the twelve-workflow harness.

The app sources use local imports, procedural textures/instrumentation and a
locally generated Three RoomEnvironment, system fonts, and bundled Lucide icons.
Rapier's compatibility package embeds WASM. No remote assets, remote physics,
analytics, credentials or audio are used. The additional production browser check
blocks all requests outside its localhost origin and asserts that no such request
was attempted while loading and fracturing the scene. This does not emulate loss
of the local server; installation and test-browser download can require internet.
A local server is still required after setup.

## Performance And Caveats

The [published performance report](performance.md) is the timing authority. Its
last complete run measured **8.04 RAF FPS** for live physics plus recording,
**10.70 FPS** intact and **10.36 FPS** reverse replay on SwiftShader, not a native GPU.
All 300 actual fragment meshes were visible, all 300 centers were in the camera
frustum, all 300 bodies were independent and active, and none slept throughout
the 120 measured live frames. Normal depth occlusion remained enabled.
The visible canvas was **824 x 600**, with six solver iterations, **1/120 s** fixed
steps and **exactly two ticks per draw**. This is not the React catch-up-loop timing.
The 241-frame / 2-second take serialized to **57,719,183 bytes (55.05 MiB)**.
The fixture's artificially weak bonds are benchmark calibration, not real materials.

The original report timings preceded recording-byte accounting. A fresh final run
now includes that cost: 17.82 FPS intact, 11.96 FPS live, 14.26 FPS replay, with mean
per-tick physics/capture costs 14.47/11.07 ms. Both runs are preserved. No sustained >10 FPS live claim,
real-time 120 Hz claim, native-GPU result or memory ceiling equal to file bytes is
supported. JS object/copy overhead, WASM, meshes and encoding buffers add memory.

Predictive supported fracture is a one-tick frozen-collider sphere query, not a
coupled space-time fracture solution; it omits within-tick curvature and blocker
motion. The 0.35 initial-kinetic-energy ledger bounds credited damage work, not
total mechanical energy. No separation velocity is injected. Free-body splits
inherit the post-solve velocity field; remaining supports can absorb momentum on
non-predicted fixed contacts. Gravity uses a load tree without floor-reaction
feedback, elastic redistribution or buckling. Steel does not physically bend;
timber's transverse factor is 0.16. Launch speed bounds do not clamp output
velocities. Recorded takes are visual/inspection histories, not resumable Rapier
checkpoints; irreversible physics is not undoable. Exact history equality is
same-version/same-runtime evidence, not cross-platform bitwise determinism.
