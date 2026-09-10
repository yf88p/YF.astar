# FractureLab

A local destruction laboratory: author rectangular solids, apply impacts, inspect
rigid-body fragments, then reframe and export the take. Built with React 19,
Three.js r174, Rapier 0.19 WASM and Vite 6. This bonded rigid-body approximation
is **not an engineering certification tool**.

## Start Locally

Use **Node.js 20.19+ on the 20.x line, or Node.js 22 or newer**, with npm. Verification used Node 24.19.0. From this directory:

```sh
npm ci && npm start
```

Open the local URL printed by Vite, normally `http://localhost:5173`.
Vite tries the next port if 5173 is occupied. The development script binds to
`0.0.0.0` (all interfaces), not just loopback; do not expose it to an untrusted network.
WebGL2 is required. Current desktop Chrome or Edge on **localhost or HTTPS** is
required for VP9 video export; an ordinary HTTP LAN address is not a secure context.

No credentials, paid services, remote computation, telemetry, or remote assets are
used. Physics, rendering, replay, imports and encoding run on your machine.
Installation needs registry access unless cached; test-browser setup may need a download.
After setup, runtime works without internet while the local server runs; this is not a PWA.
Production builds bundle runtime dependencies, including Rapier's inlined WASM and
the lazily loaded WebM muxer. No runtime CDN is required.

## First Take

1. Wait for **LOCAL ENGINE READY**. The default **Glasshouse** is an editable steel frame and three glass panels.
2. In **Impact**, change radius, mass, launch velocity, position, direction, or launch time. Numeric fields commit on **blur or Enter**, not each keystroke.
3. Use **Pick impact point**, then click an actual object surface. The direction includes an approximate gravity correction; the dashed ballistic preview is not a fracture prediction.
4. Choose **Launch simulation** or timeline **Play**. Pause, scrub backward, and orbit the frozen geometry. The default shot fully clears the 12 mm glass at tick 72, **0.600 s**, in the regression fixture.
5. In **Camera**, choose free orbit, tracking, or a keyframed path. Use **Export** for a PNG, recorded take, or timestamped VP9 WebM.

**Play** executes scheduled impacts as their physical times arrive. It replays stored
states when behind the live edge, then extends a non-imported live take. **Launch**
starts over if a take is recorded; it does not apply an extra instantaneous shot.
For a new take, use **Reset**, then **Play**, or **New take & launch**.
Reset discards the recording and live support/impulse changes; save a take first.

On narrow screens, use **Scene**, **Build & hierarchy**, and **Inspector** tabs.
The inspector's bottom Launch control is hidden on mobile; timeline **Play** starts
the scheduled simulation. Use timeline **Reset**, then **Play**, for another take.

## Controls

| Action | UI / Shortcut | Effect |
| --- | --- | --- |
| Create | Glass, Concrete, Timber, Steel palette | Adds an editable object; set exact values in Object. |
| Select | Click geometry or hierarchy; `V` | Geometry selection can identify an actual fragment. |
| Multiselect | Shift-click geometry or hierarchy | Toggles objects in the selection. |
| Translate / rotate / scale | Gizmos; `G` / `R` / `S` | Authoring transforms, including multi-object gizmo transforms. |
| Snap | Magnet button | 0.1 m translation, 15-degree rotation, 0.1 scale increments. |
| Frame | Frame selection; `F` | Reframes the selected geometry. |
| Orbit / zoom | Drag empty viewport / scroll | Changes the camera, including while paused. |
| Connect | Shift-select exactly two; Connect selection | Creates an explicit structural bond. |
| Fixed support | Object > Fixed support | Adds/removes an authored full six-DOF attachment. |
| Play / pause | Timeline transport; `Space` | Replay or fixed-step simulation. |
| New take / launch | Launch button; `Enter` | Resets an existing recording, then runs scheduled impacts. |
| One tick | Step button; `.` | Advances exactly 1/120 s, or steps through recorded states. |
| Scrub | Timeline; first/latest-state buttons | Restores stored physical and topology state. |
| Undo / redo | History buttons; `Ctrl+Z` / `Ctrl+Shift+Z` | Authoring history only, up to 40 transactions. |
| Duplicate | Hierarchy duplicate; `Ctrl+D` | Copies selected objects, not their connections. |
| Delete | Hierarchy trash; `Delete` | Removes selected objects and incident connections. |
| Inspect | Object / simulation settings | Fragment velocity, mass, sleep/release state, bonds and contacts. |
| Overlays | Grid, topology, bonds, trajectory | View helpers; no change to the simulation. |
| Presentation | Clean presentation; `Escape` to exit | Hides authoring helpers. |

Ctrl shortcuts also accept Command on macOS; fields suppress global shortcuts.
**Panel**, **box**, and **beam** label the same rectangular solid envelope, not mesh
drawing tools or different primitives. Dimensions are metres; rotations are shown
in degrees (stored as XYZ radians). **Fragments** is a count, not mass density.
Material parameters are shared by all objects of that material in the project.

## Experiments

The project-name dropdown opens **Glasshouse**, **Load path**, **Material range**, or
**Blank laboratory**. All use the same editable model, not separate canned animations.

**Equivalent materials.** Material range has four 1.35 x 2.4 x 0.04 m specimens,
24 fragments each, the same seed, and one attachment each. Every projectile is
8 kg, radius 0.16 m, speed 28 m/s, launched at **0.40 s** with the same direction and
y/z position; only x and IDs differ. Mass and partition method depend on material.
The fixture demonstrates glass/concrete release, contact-driven timber breaks and
steel yield with rebound, not guaranteed outcomes for arbitrary settings.

**Gravity collapse.** Load path is a deliberately weak-jointed timber assembly:
its project-local segment-joint strength is **0.30 MPa**, not a bulk timber property
(the general timber default is 9 MPa). To isolate gravity, remove its scheduled
projectile in Impact > Scheduled events before recording. Play for about 2 physical
seconds and pause at the latest recorded state. Select **West pier** or **East pier**,
then Object > **Remove support in this take**, and **Play** again, not Launch.
This changes the live attachment, not the saved project, and does not work on an
imported take. Bonds initially stay intact, then overloaded internal lintel joints
fail and pieces fall. The unstruck two-support fixture is stable in the tested interval.

**Below/above threshold.** In Blank laboratory, create glass and set dimensions
`[1.35, 2.4, 0.04]`, position `[0, 2, 0]`, rotation `[0, 0, 0]`, 24 fragments,
seed `12345`, and Fixed support on. Set simulation gravity to `0`. Add a projectile
at `[0, 2, 0.3]`, direction `[0, 0, -1]`, launch time `0`, radius `0.16`, mass `8`.
Run separate takes at **0.25** and **1 m/s**: real contact occurs without damage.
Change to **28 m/s**, confirm the reset, and run again for local fracture.
Keep the geometry/seed and other parameters unchanged when comparing takes.

**Wake debris.** Let a free fragment settle, pause at the live edge, and click the
actual fragment in the viewport. Object > **Wake with 30 N*s impulse** applies an
immediate local impulse; Play shows its motion. Imported or rewound takes reject
physical edits. A future projectile scheduled before recording can also wake debris
through a real collision.

## Model And Limits

See [the core physics specification](src/core/PHYSICS.md) for equations and assumptions.
Glass/concrete use seeded convex Voronoi prisms, with possible aligned concrete depth
layers, not full 3D Voronoi cells. Timber/steel use rectangular segments. Seeds set
topology, **not impact points or prerecorded motion**. Each fragment has filled volume,
mass, a convex collider and selectable geometry. Connected fragments share a compound
body until disconnected; dynamic bodies/projectiles use CCD and real floor contacts.

A fixed object attaches its lowest initial fragment COM with a full six-DOF clamp,
not a hinge or distributed adhesive. Explicit connections choose nearest initial
fragment COMs, the lesser smallest cross-sectional area and lesser strength/toughness
(strength can be overridden). Touching alone creates no connection; one can bridge a gap.

Supported glass/concrete can release before contact via a one-tick actual sphere/
convex query and a damage-work budget capped at **0.35 of initial projectile kinetic
energy**. The predictor injects no velocity; normal Rapier contact transfers momentum.
Free bodies fracture after the contact solve and inherit the old rigid velocity field.
Remaining fixed attachments absorb reactions, notably on non-predicted timber/steel
contacts; projectile-plus-fragment momentum alone is then not conserved. Fracture
work is not deducted from motion: this is not a complete energy balance. Gravity
uses a capacity-weighted tree, not elastic load sharing. Steel accumulates yield but
**does not bend geometrically**; timber's transverse strength/toughness factor is `0.16`.
No continuum mechanics, buckling, reinforcement, arbitrary crack growth or blast-fluid
solver is present. User values are effective parameters, not certified measurements.

| Budget | Bound |
| --- | --- |
| Scene | 600 total fragments, 60 objects, 1,800 explicit connections, 64 impacts |
| Time | 120 Hz fixed step; at most 12 physical seconds / 1,440 ticks / 1,441 frames |
| Solver / gravity | 1-32 iterations; 0-30 m/s^2 |
| Launch | Radius 0.05-0.5 m; mass 0.01-1,000 kg; speed 0-100 m/s |
| Dimensions / centers | 0.005-30 m per axis; authored positions within +/-100 m |
| Import file | 256 MiB maximum before reading/parsing |
| Compact take | 128 MiB UTF-8 total: 127 MiB frame payload, 1 MiB metadata/envelope reserve |

Speed bounds apply to **launch inputs**, not output velocities. Capture/import count
whole frames, including bonds, projectiles and events, before storing/cloning them;
overflow preserves the last valid recorder frame rather than dropping states/events.
On a budget error, the UI freezes the last complete state and makes the take read-only.
Export that history and Reset before simulating again. Simulation settings exposes a
local **Take storage budget** control from 0.125 to 127 MiB, editable before recording;
it is a session resource limit, not a material parameter or saved project setting.
The byte budget may end a take before 12 s. JS objects, WASM, meshes, copies and export
buffers use more RAM than JSON bytes. Maximum size does not imply real-time playback.

## Save, Replay, Export

**Save project** downloads version-1 `.fracture.json`: editable objects, seeds,
materials, settings, connections, supports and impacts. Import through the project
dropdown's **Open project or take**; there is no automatic persistent save.
**Recorded take** downloads `.take.json`: `format: "fracture-take"`, `version: 1`,
project, cameras, `dt` and all physics frames. Geometry/material appearance regenerate
deterministically from the project. Imports validate before replacing the document.

Replay records every 120 Hz tick. Positions and velocities interpolate linearly;
rotations use shortest-arc quaternion slerp. Bonds, events, supports, sleep/release
flags, body IDs and impact firing use the preceding tick, never a future transition.
Imported takes are read-only simulation histories, **not solver checkpoints**.
Scrub/reframe, or Reset to simulate the original project anew; arbitrary states cannot
resume physics. Same-runtime determinism is tested, not cross-platform bitwise identity.

Camera-only edits do not invalidate physics. Takes save camera poses, names/IDs,
keyframe times, current framing, playhead, presentation speed, mode and tracking
target metadata. Imports normalize optional name/ID/time fields. Adding at an
existing camera time replaces that pose; editing a time to duplicate another is rejected.
Geometry/mechanics edits to a recording require explicit **Apply & reset take**
confirmation; the dialog offers **Save take** first. Undo/redo covers authoring,
not irreversible physics or discarded recordings.

Video exports the **entire currently recorded duration divided by presentation
speed**, not just the playhead or a selected range. UI speeds are 0.1, 0.25, 0.5, 1,
and 2x; output is VP9 WebM, **1280 x 720 at 30 fps**, up to 120 presentation seconds,
with **no audio**. Each WebCodecs `VideoFrame.timestamp` comes from presentation time,
not wall-clock recording. The final frame is clipped to the remaining duration;
an application-side EBML duration correction for lockfile-pinned `webm-muxer` 5.1.4
makes the container duration exact without moving cue offsets. The encoder queue is
bounded and flushed; cancellation restores the view. The modal previews the actual
output Blob and provides Download WebM. There is **no MediaRecorder fallback**;
unsupported browsers can export a PNG still instead.

## Verify And Develop

```sh
npm test                        # Focused checks using real Rapier WASM
npm run build                   # Production assets in dist/
npm run verify                  # Core tests, then build
npx playwright install chromium # Once, if the test browser is missing
node tests/browser.mjs           # Editor workflows and actual video decoding
node tests/performance.mjs       # Visible-canvas live/record/replay benchmark
npm run test:production          # Build and load production assets in Chromium
```

`npm run dev` equals `npm start`. Browser/performance harnesses own free-port localhost
servers and close them afterward. Artifacts go to `/tmp/opencode/fracture-workflows`
and `/tmp/opencode/fracture-performance`; override with `BROWSER_OUTPUT` / `PERF_OUTPUT`.
Test-browser setup is not needed to run the app. Serve production `dist/` over local
HTTP/HTTPS, not `file://`.

| Location | Responsibility |
| --- | --- |
| `src/App.jsx`, `src/styles.css` | Editor, transactions, transport, imports, responsive UI |
| `src/core/` | Project validation, partitioning, bonded physics, full-state replay |
| `src/viewport.js` | Real fragment meshes, picking, transforms, cameras and procedural studio |
| `src/video.js` | Timestamped WebCodecs export, WebM duration adapter, PNG capture |
| `tests/core.test.js`, `tests/browser.mjs`, `tests/performance.mjs` | Numerical, UI and performance evidence |

[Verification](reports/verification.md) records **30 core checks and 13 browser workflows**
and separates checked invariants from unsupported claims. The
[final performance run](reports/performance.md#final-byte-budget-rerun) measured **11.96 FPS**
for live physics plus recording of 300 independent, active, visible fragments in
Chromium/SwiftShader at an 824 x 600 canvas, six solver iterations, and two 120 Hz
ticks per draw. Its 241-frame JSON was **55.05 MiB**. This is not a native-GPU result,
a real-time 120 Hz guarantee, or a greater-than-10-FPS live guarantee. Earlier runs
measured as low as 8.04 live FPS on this shared software-rendered host. The final
measurement includes the recording-byte accounting work.

## License And Assets

Original code/documentation are [MIT licensed](LICENSE), copyright 2026 FractureLab
contributors. [Notices](THIRD_PARTY_NOTICES.md) cover Apache-2.0 Rapier, ISC Lucide and
other dependencies. Fonts are system/local; textures, grids, labels and instruments
are procedural. The environment derives from Three's MIT `RoomEnvironment` with local
lighting additions, not a remote HDRI. No remote models, recordings or sound are used.
