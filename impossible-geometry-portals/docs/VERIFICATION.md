# Verification Results

Verified on 2026-09-06 against an automatically started production preview. The final complete run of `npm run verify:browser` exited successfully. The application source hashes were unchanged during that run.

## Final Status

| Check | Result |
| --- | --- |
| `npm test` | **73 passed, 0 failed** |
| `npm run build` | **Passed** |
| Production headless Chromium checks | **18 passed, 0 failed, 0 skipped** |
| Uncaught browser errors | **0** |
| Browser console errors | **0** |
| Nonlocal runtime network requests | **0** |

Vite emits an advisory size warning for the JavaScript chunk containing Three.js. The production JavaScript is approximately 656 kB uncompressed / 177 kB gzip; this is not a compilation failure. All dependencies are served locally.

The full evidence, command outputs, source hashes, screenshot hashes, raw timing samples, and state transitions are in [`verification.json`](verification.json). The browser command regenerates this report.

## Independent Numerical Checks

- Known wall/wall and wall/floor numeric mappings, plus oblique frames checked against an independent scalar matrix oracle.
- Position round trips within `1e-5 m`; normalized direction errors within `1e-6`; speed preservation within `1e-6 * speed + 1e-10 m/s`, including zero and near-zero fixtures.
- Linear velocity, angular velocity, and orientation mapping independently checked at crossings, separately from later gravity and impulses.
- Swept finite apertures, edge rejection, fast crossings, destination obstruction, reversal, exit chatter prevention, and portal closure recovery.
- Source/destination cube proxies, complementary clipping halfspaces, frame contacts, holds, releases, remote pickup, blocked/out-of-range rays, and exact recursion budgets.
- Oblique projection checked against signed world halfspaces and unchanged projected X/Y at desktop and two mobile aspects. The expected classification does not reproduce the production projection formula.
- Supported plates, AND-wired doors, safe door closure, goal occupancy, partial-run reset, and removal of plate weight.
- Equal simulated time at 30/60/144 Hz produces physical states within `1e-9` in the focused fixture. Input replays reproduce tick-by-tick across these rates and irregular update intervals. This is a deterministic fixture result, not an unrestricted solver-accuracy promise.
- Atomic document transactions, cascading reference deletion, undo/redo, whole-drag history, invalid imports, and isolated playtest copies.

## Actual Browser Checks

1. The initial desktop chamber renders nonempty WebGL pixels, correct camera aspect, and no horizontal overflow.
2. A real Enter click captures the pointer. Keyboard movement and mouse events change the player/view. Escape/P pause, exact physics freezing, orbit inspection, and recapture/resume work.
3. Each of the three built-in chambers completes through the actual field-guide solution UI. Tests accelerate only the public input replay clock and render milestone states. Pickup, straddle, crossing, plate/door activation, and goals are captured. No solution flags or body-position assignments produce completion.
4. The three-link sightline renders three traversals and the live avatar. Removing the avatar from a diagnostic render changes the deepest target's pixels, independently demonstrating that it is being rendered there.
5. A source-side solid block changes/occludes the portal's center pixel.
6. A conspicuous destination test mesh behind the clipping plane contributes no pixels. Moving the same mesh into the accepted halfspace is a positive visible control.
7. Approaches at 40, 15, 4, and **0.5 mm** retain a live portal view with a smaller near plane. Crossing changes the actual body/camera room exactly once. Runtime disable/enable restores and recuts visible solid surfaces.
8. A straddling cube has one physical identity and two complementary clipped visual representations. Reversal retains that identity.
9. Real E pickup/drop, release at the seam, backward movement while holding, throw-button interaction, and remote E pickup through a portal all operate through gameplay input handlers.
10. The integrated editor creates a two-room puzzle from blank using actual forms. The test places and transforms objects, pairs portals, wires a plate and required goal to a door, changes snapping, drags a numeric range, and uses undo/redo.
11. That newly authored puzzle is solved through `setInput`, `look`, `interact`, and fixed steps. The cube crosses to the second room, rests on its plate, powers the door, and the player reaches the goal.
12. The project is exported as JSON, replaced, imported through the file chooser, saved locally, replaced again, and reloaded. The current-view PNG download has a valid PNG signature and substantial image data. A malformed import leaves document and history unchanged.
13. The reloaded authored puzzle is solved again through the same gameplay systems. Both solutions register two crossings, an active plate, and actual goal completion. Returning to edit exactly restores the authored document and zero simulation time.
14. Changing destination material and adding/moving destination geometry through editor transactions changes the live portal pixels without moving the source camera.
15. Fresh 390x844 and 320x844 mobile contexts render the game and editor with no horizontal overflow. Touch controls are discoverable and actionable.
16. Six repeated level reloads retain the same GPU-resource counts and target allocation after rendering, rather than accumulating obsolete scenes.
17. The visible, running stress scene retains depth three for every measured frame, with three portal pairs and 21 physical cubes.
18. The run finishes without browser errors or nonlocal runtime requests.

Some of these assertions are grouped into the 18 automated checks; they are listed more granularly here to identify the actual evidence.

## Performance

This is an honest **software-renderer** measurement, not a hardware-accelerated FPS claim.

| Setting | Measured configuration |
| --- | --- |
| Browser | Headless Chromium **153.0.8010.12** |
| OS | Linux x64, kernel 7.0.0-31-generic |
| CPU reported by host | AMD Ryzen 7 5825U with Radeon Graphics, 16 logical CPUs |
| WebGL backend actually used | ANGLE / Vulkan / **SwiftShader Device (Subzero)** |
| Browser viewport | 1440 x 1000 CSS pixels |
| Actual game drawing buffer | **1051 x 552 pixels**, DPR 1 |
| Scene | Three rooms, three portal pairs, **21 movable cubes** |
| Recursion | Three traversals; four room renders including the root |
| Physics | 120 Hz, gravity 9.81 m/s², at most 12 ticks/frame, maximum speed 28 m/s |
| Sampling | Eight-second warmup, then **120 actual requestAnimationFrame intervals** |
| Visibility/state | `visible` / `playing` throughout measurement |

| Metric | Result |
| --- | ---: |
| Mean actual frame interval | **238.46 ms** |
| Median frame interval | **233.40 ms** |
| 95th percentile frame interval | **416.60 ms** |
| Reciprocal of mean frame interval | Approximately **4.19 FPS** |
| Mean render-submission CPU time | **12.34 ms** |
| 95th percentile render CPU time | **21.30 ms** |
| Render calls in final sampled frame | **344** |
| Triangles in final sampled frame | **182,306** |
| Portal color/depth target estimate | **9,366,160 bytes / 8.93 MiB** |
| Maximum observed physics ticks/frame | **12** |

The render CPU measurement is CPU-side submission time, not a GPU timer query. Actual frame intervals include scheduling and software rasterization. The full sampling window lasted 28.72 wall-clock seconds while physics advanced 11.75 seconds: the bounded overload policy intentionally discarded excess wall time. This software backend is **not smooth at the stress workload**. No measurement of a hardware-accelerated GPU, unlimited portal counts, or guaranteed frame rate is claimed.

The target pool stayed constant during sampling. Repeated reload checks stabilized at **174 geometries, 26 textures, and three portal targets** for the standard three-room level. These counts describe that fixture, not the larger stress cube inventory. The render-target cap and disposal policy are documented in [`CONVENTIONS.md`](CONVENTIONS.md).

## Reproduce

```sh
npm ci
npx playwright install chromium
npm run verify:browser
```

Allow several minutes on a software WebGL machine. The harness starts and stops a production preview, blocks nonlocal browser requests, and writes `docs/verification.json`. Use `PARALLAX_ARTIFACTS=/your/output/directory` to retain screenshots and exported JSON somewhere other than `/tmp/opencode/parallax-browser`.

For direct stress inspection in a running browser:

```js
parallax.loadStress();
// Click Enter chamber. Look straight north along the central openings.
parallax.measure();
```

The first attempted headful browser reported a missing X server, so verification used headless Chromium rather than retrying a missing display. Headless pointer capture can emit cursor-warp deltas. Desktop look verification records the actual mouse-driven changes; precise interaction fixtures use real touch UI plus keyboard events. Before stress measurement, the harness recenters through the application's mouse-input handler and requires a live depth-three view. It does not change geometry, physical state, or completion conditions to make the performance check pass.

Numerical fixtures, rendering fixtures, and public-input solutions are distinct tests. Passing a transform or screenshot hash alone is not presented as proof that the game or editor works. Audio events and Web Audio operation are exercised, but perceived spatial sound quality was not independently measured by a human listening test.
