# Verification Report

Verified on **September 6, 2026**, against the production build served at `http://localhost:5199`. All browser work used headless Chromium; the environment's headful browser tool reported a missing X server, so no repeated headful launch attempts were made.

## Results

| Command | Result |
| --- | --- |
| `npm test` | 29 independent checks passed |
| `npm run build` | Passed; no build errors or chunk-size warnings |
| `npm run test:browser` | 15/15 end-to-end checks passed |
| `npm run test:interactions` | 12/12 focused browser checks passed |
| `npm run test:performance` | Completed all seven reading-scene assertions and both measured interaction periods |

The final production browser runs reported **zero page errors, console errors, unexpected dialogs, or HMR updates**. Test contexts were isolated from the normal user's project storage. The published viewer was extracted from an actual UI-generated ZIP and opened on a separate static-server origin.

## Independent Checks

`tests/core.test.js` imports only the render-independent engine and Node's test/assert modules. It checks:

- Affine composition and inversion, rotated bounds, and deeply nested framing/picking.
- Six-level million-to-one precision and seven-level performance-fixture geometry.
- Position/rotation/scale preservation through 50 repeated reparent cycles and 50 group/ungroup cycles, including descendants and cross-parent groups.
- Cursor-anchored zoom, including camera-limit clamping.
- Deterministic time sampling, transition/dwell boundaries, zero-duration stops, extreme/empty time inputs, and logarithmic interpolation.
- Keeping a million-to-one nested destination inside the viewport throughout a flight and following the same spatial path in reverse.
- Missing target preservation after deletion and ungrouping, rather than silently substituting another target.
- Full project round trips and cloning, supported settings and embedded image types.
- Invalid versions, IDs, hierarchy cycles, references, easing, dimensions, nonfinite/unusable geometry, markup, unsafe SVG, and oversized input rejection.
- Acceptance of 20,000 siblings and a 64-node hierarchy; rejection of deeper chains, including reverse-ordered input.

### Precision Assumptions

Engine fixtures use a **1280×800 CSS-pixel viewport**, 70-pixel framing padding, an axis-aligned camera, positive local dimensions/scales, and double-precision transform composition. Six nested scale changes span at least `1,000,000:1`. Screen-space frame and pick error must remain below **0.5 CSS pixels** at the target's intended reading scale. Tests do not assert precision for arbitrary combinations of the largest possible coordinate and the smallest possible feature.

The browser suite independently composes ancestor matrices from a **downloaded editable package**, not by importing the application's geometry functions. It compares actual `getBoundingClientRect()` output for the deepest scene, its rectangle, a paragraph group, its SVG `foreignObject`, and its HTML text box.

Final actual-DOM measurement:

| Property | Observation |
| --- | --- |
| Browser viewport | 1600×1100 CSS pixels |
| Canvas viewport | 1060×807 CSS pixels |
| Nested scene | `forest / mushroom / gill / spore / cell / nucleus / memory` |
| Camera center | `(868.912948736, 545.8695171481601)` |
| Camera scale | `2,005,440.848275894` CSS pixels per world unit |
| Intended scene box | 920×607.2000001 CSS pixels |
| Largest observed component error | Approximately **0.0000732 CSS pixels** |
| Required tolerance | **0.5 CSS pixels** |

## Real Browser Workflows

`tests/browser.mjs` performs these actions through buttons, fields, file choosers, pointers, and keyboard input. JavaScript evaluation reads DOM/storage for assertions; it does not mutate application state or set success flags.

1. Verify the actual illustrated overview, twelve authored stops, and nested document.
2. Edit a paragraph and confirm exact rendered and exported content.
3. Replace the botanical image using a genuine PNG upload, verifying decoded dimensions, original asset data, stable object ID, and unchanged transform.
4. Move a nested scene and verify descendant motion and updated target cameras, including the deepest scene.
5. Create a nested scene, editable text, and a shape, with rotation and local placement.
6. Create and reorder a stop; edit timing and caption.
7. Add a branch hotspot and choose a real destination.
8. Seek repeatedly to five separated timestamps and compare deterministic camera states.
9. Pan, cursor-zoom, drag an object, and undo/redo the completed drag in one step.
10. Group and reparent, then compare every original object's world matrix between UI-exported packages.
11. Delete a stop target, assert the visible unresolved state, and repair it through the UI.
12. Export/import the complete project, including assets; reject invalid packages without altering the document.
13. Reload and verify hierarchy/assets/text, create a blank project and its first stop, then reopen existing work.
14. Publish the modified project, extract its ZIP, serve the viewer separately, and use normal/reduced-motion keyboard navigation and both mushroom branch routes.
15. Read deep-scene text, follow a newly authored hotspot, freely pan/zoom, restart, and confirm the modified paragraph and image are still present.

`tests/interactions.mjs` adds twelve focused checks:

- In-place rich text, literal script-like text safety, selection without camera movement, and single-session undo/redo.
- Pointer corner resizing and opposite-corner preservation.
- Pointer rotation and undo/redo.
- One-transaction freehand creation.
- One-transaction new image plus asset import, undo, and redo.
- Image fit/crop metadata changes without changing source data.
- Locked-object drag rejection.
- Hiding an object and undoing it.
- Semantic-zoom visibility and the authoring override.
- Two distinct new blank projects in the project library.
- A functional inspector edit at **390×844**, with no horizontal body overflow.
- Actual deep DOM geometry versus the independent oracle described above.

### Published Independence

The final published-viewer run requested only these resources, all from its own temporary static origin:

```text
/
/viewer.js
/project.json
```

Original image data was embedded in `project.json`. The separately opened viewer had no author-mode exit button and used the exported modified story, not the starter example. Both canvas hotspots and visible caption choices were exercised. Autoplay at a choice remained paused until explicit navigation.

## Performance

Measured the **production editor**, not an empty or flattened scene. The benchmark imports a real editable package through the file chooser, visits all seven reading stops, checks persistence by reload/export, and verifies the document is unchanged after camera interactions.

### Hardware And Browser

| Property | Value |
| --- | --- |
| OS | Linux x64, reported release `7.0.0-31-generic` |
| CPU | AMD Ryzen 7 5825U with Radeon Graphics |
| Logical processors | 16, reported by OS and browser |
| Host memory | 12,949,561,344 bytes, approximately 12.1 GiB |
| Browser | Headless Chromium `153.0.8010.12` |
| Browser viewport / DPR | 1440×1000 CSS pixels / 1 |
| Actual editor canvas | 944×719 CSS pixels |
| Reduced motion | Off for measurements |
| Development runtime | Absent; `viteClientPresent: false` |

User agent:

```text
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36
```

### Authored Workload

**Chromatic Field Atlas** has **1,293 persistent nodes** across seven nested scenes: 440 text nodes, 280 image nodes, 426 rectangles, and 140 ellipses, plus the seven scene nodes. Each reading scene contains 60 paragraphs, 40 unique embedded PNGs, and 80 shapes in non-overlapping tile bounds. Each PNG is 160×100 pixels and is original generated fixture artwork, not a whole-scene screenshot. Total paragraph content is 25,786 characters; the package is 10,678,723 bytes.

Every reading stop asserts that all **180 intended tile objects** are in view, text fits, and each object's center is unoccluded. No nodes have the `hidden` flag. Each nested portal has a local scale of `.04`, giving a 25-fold camera-scale change per level and approximately `244,140,625:1` across the six edges. Semantic reveal thresholds are retained as normal scene presentation rules.

| View | Rendered / Persistent Total | Text | Images |
| --- | --- | --- | --- |
| Seven intended reading stops | 185–195 / 1,293 | 62–63 | 40 |
| Timed pan/zoom at deepest scene | 195 / 1,293 | 62 | 40 |
| Timed playback, including between-scale intervals | 3–189 / 1,293 | 1–63 | 0–40 |

Counts are read from actual main-canvas node elements, excluding thumbnails. The script also checks viewport intersection. Sparse intervals between scene reveal scales are included in the measurements; they are not omitted to improve the result.

### Frame Cadence

Final run, with all reading scenes warmed and no concurrent verification workload:

| Interaction | Wall Time | RAF Intervals | Median | p95 | Maximum | Intervals Over 33 ms |
| --- | --- | --- | --- | --- | --- | --- |
| Pointer pan and wheel zoom | 3.064 s | 182 | 16.7 ms | 16.7 ms | 16.8 ms | 0 |
| Authored timeline playback | 4.083 s | 243 | 16.7 ms | 16.7 ms | 16.8 ms | 0 |

Pan/zoom camera scale ranged from approximately `1.529e8` to `1.756e8`. Playback crossed two 25-fold scale transitions. The entire setup, integrity checks, reading-scene visits, and measurements completed in approximately **29.77 seconds**. There were zero browser errors or HMR updates.

CDP `JSHeapUsedSize` samples ranged from **31.6 to 85.5 MB**. The browser's coarse `performance.memory.usedJSHeapSize` reading was **254 MB**. No forced garbage collection was used. Native image decoding, compositor surfaces, and GPU memory are not included in the JavaScript heap metric.

### Interpretation

These are observed main-thread `requestAnimationFrame` intervals for one warmed synthetic run, not guaranteed compositor FPS, input latency, GPU completion, or real-user performance. The observer samples DOM workload every 200 ms and adds its own work. OS/browser hardware values can describe a container host rather than effective resource quotas. Mobile performance, cold image decoding, storage exhaustion, and every supported maximum-size combination are not covered by this timing run.

The earlier development baseline had a 33.3 ms pan/zoom p95 and 49.9 ms playback p95. Caching scene previews independently of the camera and using production React substantially improved the final measured cadence. This is a comparison of two different build conditions, not a controlled attribution to one optimization.

## Reproduce And Inspect

```bash
npm test
npm run build
npx playwright install chromium
npm run preview -- --port 5199 --strictPort
```

With that server running, run these in another terminal; measure performance by itself:

```bash
npm run test:browser
npm run test:interactions
npm run test:performance
```

`BASE_URL` can point the browser scripts at another local port. Artifacts are created under `/tmp/opencode`. Final session artifacts:

- End-to-end report and downloaded packages: `/tmp/opencode/folia-browser-uVgU5y/attempt-1/`
- Detailed gesture reports, screenshots, and geometry measurements: `/tmp/opencode/folia-interactions/run-jjMi9V/`
- Raw performance samples: `/tmp/opencode/folia-performance.json`
- Visible benchmark screenshot: `/tmp/opencode/folia-performance.png`

The scripts deliberately fail on assertion failures, runtime errors, incomplete flows, and mixed-build HMR observations rather than treating a nonempty canvas or build-success flag as sufficient verification.
