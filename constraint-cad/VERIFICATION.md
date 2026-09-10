# Verification Record

Verified locally on **2026-09-06**. All browser interaction checks used **headless Chromium**, not the unavailable headful/X-server path. These results are measurements of this implementation, not promises for arbitrary hardware or every nonlinear sketch.

## Final Checks

| Command                                 | Result                                                            |
| --------------------------------------- | ----------------------------------------------------------------- |
| `npm run verify`                        | Passed                                                            |
| Standalone Vitest suite                 | 22 tests passed, including 50 seeded generated cases              |
| Independent geometric residual checks   | 85 valid document states measured                                 |
| TypeScript + Vite production build      | Passed; JS 276.81 kB (85.58 kB gzip), CSS 33.08 kB (8.05 kB gzip) |
| Playwright production-browser workflows | 9 passed; 11.4 seconds for the final run                          |
| `npm run benchmark`                     | Passed on the connected workload below                            |
| `npm audit --omit=dev`                  | 0 vulnerabilities                                                 |

The final standalone suite independently measured:

```text
states:                     85
maximum positional error:  9.206033269038016e-9 mm
maximum normalized angle:  1.133310142233654e-11
```

The positional oracle uses Euclidean coincidence/fixed-point error, absolute length/radius error, and absolute H/V coordinate difference. The angular oracle directly computes absolute normalized cross/dot products. Neither oracle uses the production solver's residual calculation or declares correctness from `ok` alone.

## Exercised Behavior

1. Fully constrained rectangle: rank 16, DOF 0, width 80 to 120, height unchanged at 50, origin unchanged, completed immovable drags leave exact geometry and history unchanged.
2. Four-bar: one local DOF with consistent ground-length redundancy. A sequence of 20 small solver drags and a 24-step browser drag preserve every bar length, both ground joints, and the nonsingular elbow branch. Completed drag occupies one history entry.
3. Connected circle: real pointer-created line and circle, visible origin/point snapping, attached center, driving radius with nine decimal places, free-joint drag, radius edit, undo/redo, actual JSON download and upload, and continued dimension editing after load.
4. Conflicts: accepted duplicate 80 mm dimensions are redundant, not contradictory. A 100 mm duplicate is rejected with relevant IDs and no geometry/constraint/history loss. First Undo acknowledges the rejected edit rather than undoing the last accepted edit.
5. Recovery: zero-distance constraints, rejected zero-length direction constraints, singular collinear systems, 0.01 mm directional geometry near +/-900 mm, malformed/unsupported/dangling/nonfinite imports, invalid radius/distance values, cancellation, and deletion/undo of a circle with **86 referencing constraints**.
6. Generated systems: 30 deterministic rectangles with changed dimensions/origins and perturbed coordinates; 20 deterministic connected flexible chains with known lengths and perturbed positions. Underdetermined checks use invariant lengths and ground positions, not an arbitrary coordinate answer.
7. Actual interface: all eight constraint tools applied to user-created geometry; point multiselection; construction flags; deletion with constraint cleanup; dimension labels/inspector editing; removable snapping relations; pan; zoom verified at actual wheel-event coordinates; mobile creation/inspection at 390 x 844.
8. Numerical direction edge cases: adding perpendicular to exactly parallel lines, and parallel to exactly perpendicular lines, with lengths and fixed points active. Equivalent wrapped-angle equations avoid stationary normalized sine/cosine gradients.
9. Startup/viewport race: immediate replacement by the 100-entity document stays correctly fitted over subsequent frames; an obsolete startup timer cannot reframe the new document.

The browser tests launch a production preview on **5188**, independent of the development server on **5186**. The exported file in the save/load workflow is the actual browser download, not a separate hand-written fixture. Browser screenshots were used only for layout inspection at 1440, 390, and 320 pixel widths, never as geometry or functional acceptance evidence.

## Connected Performance Workload

Factory: `performanceSketch()` in `src/core/examples.ts`. Runner: `scripts/benchmark.ts`.

- **100 entities:** 50 finite line segments and 50 circles attached to their joints.
- **150 permanent constraint objects:** 49 endpoint coincidences, 50 line-endpoint/center coincidences, 50 driving segment lengths, one fixed ground point.
- **One connected constraint graph**, independently traversed to confirm all 100 entities are reachable. No disconnected filler entities.
- **350 original variables**, 250 independent scalar equations, 100 local DOF. The 50 unconstrained radii are genuine circle variables; all circle centers participate in the connected mechanism.
- All **100 entities** and **100 SVG geometry primitives** are visible inside the canvas during measurement. The rest of the interface and dimension/constraint rendering remain enabled.
- Pointer workflow drags the interior joint at `link-25/a` through 60 scheduled moves, ending 15 screen pixels right and 10 pixels down. This final target is within the chain's feasible reach. The three-pixel drag threshold and RAF coalescing produce 52 actual solve samples in the recorded run.
- Every accepted or held sample is checked independently for lengths, coincidences, and the fixed ground position. The runner also checks that rejected samples preserve the previous document identity, that at least ten solves complete, and that meaningful movement propagates to at least ten entities. At completion, **all 100 entities moved by more than 1e-5 mm** while preserving their constraints.

### Environment

| Item                  | Actual environment                                                          |
| --------------------- | --------------------------------------------------------------------------- |
| Browser               | Chromium / HeadlessChrome **153.0.8010.12**                                 |
| Automation            | Playwright **1.63.0**, headless, device scale factor 1                      |
| Viewport              | **1440 x 1000** CSS pixels                                                  |
| CPU                   | **AMD Ryzen 7 5825U with Radeon Graphics**, 8 cores / 16 logical processors |
| Memory reported by OS | **12.06 GiB**                                                               |
| OS                    | **Linux 7.0.0-31-generic, x64**                                             |
| Node                  | **24.19.0**                                                                 |
| Isolation             | Shared host; no CPU throttling or isolated-core reservation                 |

### Recorded Feasible Drag Run

Timestamp: **2026-09-06T09:41:28.066Z**.

| Measurement                                                    | Result                       |
| -------------------------------------------------------------- | ---------------------------- |
| Document setup, validation, solve, and dispatch                | 20.10 ms                     |
| Actual drag solve samples                                      | 52                           |
| Rejected drag samples                                          | 0                            |
| Solver/store latency median                                    | **17.60 ms**                 |
| Solver/store latency p95                                       | **41.30 ms**                 |
| Solver/store latency maximum                                   | **96.10 ms**                 |
| Independently measured maximum positional/dimensional residual | **5.632377231279406e-9 mm**  |
| Final requested-point cursor error                             | **2.1746481300990844e-7 mm** |
| Maximum entity displacement                                    | 17.8122 mm                   |
| Final state                                                    | Underconstrained, 100 DOF    |
| Observed RAF interval median / p95                             | 16.70 / 50.00 ms             |
| Entire automated pointer workflow wall time                    | 6518.98 ms                   |

This workload has no parallel/perpendicular constraints; an angular workload residual would therefore be vacuous and is **not** presented as an angular performance result. Angular correctness is independently measured by the focused directional tests above.

Solver latency measures the synchronous `store.drag()` call, including validation, exact projection, and rank analysis, but not subsequent React rendering. RAF intervals are observed during the actual visible workflow; automation includes mouse-event round trips and deliberately awaits a frame between samples. **These are not an FPS benchmark or a claim of uninterrupted 60 FPS.** The measured p95 is above a 16.7 ms frame budget.

### Variability and Recovery

An earlier run on the same shared host with a larger, eventually unreachable drag target measured 54.6 ms median, 97.3 ms p95, and one held preview at the 100 ms cooperative deadline. The previous valid geometry stayed intact and subsequent samples continued. A lighter-load run of that larger path measured 19.9 ms median and 27.9 ms p95 with no held previews. Target reachability and host scheduling both affect behavior; the application does not relax residual tolerances to improve these numbers.

The initial performance implementation also exposed two issues that were fixed before final verification: cursor optimization could consume the projection budget, and a delayed initial Fit could overwrite a newly loaded document's viewport. The solver now reserves projection time and eliminates shared coincidence variables exactly; startup fits immediately, and a browser regression protects document replacement.

Reproduce rather than extrapolate:

```sh
npm run build
npm run benchmark
```

The runner starts its own preview on **5187**, prints machine-readable measurements, and closes its browser and server. It fails on disconnected/hidden workloads, insufficient successful movement, changed documents after rejection, or independently measured constraint violations. A bounded, correctly rejected sample is reported separately rather than being misrepresented as a corrupted sketch or discarded from the latency distribution.
