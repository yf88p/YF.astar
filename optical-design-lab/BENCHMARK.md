# Browser Verification and Trace Benchmark

## Reproduce

```sh
npm run build && npm run test:browser
```

Install headless Chromium first if necessary with `npx playwright install chromium`. The test runner starts a production preview, uses real browser controls and the bundled module worker, and stops its server/browser when complete. No headful launch or X server is used. It generates `test-results/browser-report.json` and desktop, mobile, focus and 3D screenshots.

## Measured Workload

Recorded **2026-09-06**, using the production bundle:

| Item                                   | Measured / configured value                                             |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Launch population                      | **10,000 actual 3D rays**                                               |
| Source                                 | Collimated deterministic circular disk, 12 mm radius, X=-110 mm         |
| Wavelengths                            | 450 and 650 nm, 5,000 samples per wavelength; identical launch geometry |
| Ambient                                | n=1                                                                     |
| Entrance stop                          | X=-10 mm, 24 mm opening diameter, 48 mm physical outer diameter         |
| Thick spherical lens                   | X=0, thickness 6 mm, R1=+50 mm, R2=-50 mm, clear diameter 30 mm         |
| Plane-parallel slab                    | X=22 mm, thickness 5 mm, diameter 40 mm                                 |
| Glass in both solids                   | Cauchy A=1.5046, B=0.0042 micrometer squared                            |
| Detector                               | X=50 mm, 60 x 60 mm, normal along X                                     |
| Recorded surface hits                  | **50,000**: four refractive hits plus detection per ray                 |
| Detected rays                          | **10,000 (100%)**                                                       |
| Other terminations                     | Escaped 0; clipped 0; absorbed 0; interaction-limited 0; path-limited 0 |
| Worker tracing plus moment aggregation | **665.5 ms**                                                            |
| Import action through rendered result  | **1,464.6 ms**                                                          |

The worker timer uses `performance.now()` around tracing and aggregation, not an invented frame-rate estimate. It excludes validation/source generation, worker startup, serialization and rendering. The separately measured UI time includes those costs, the 100 ms debounce, and import/download automation overhead. The exported CSV was parsed to assert that all **50,000 actual hit rows** exist, not merely that the UI claimed success. This is a single measured run in a shared environment, not a statistical performance guarantee. Repeated runs may differ.

## Browser and Hardware

| Item                  | Value                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Browser               | **Chromium 153.0.8010.12**, headless, Playwright 1.63.0                                    |
| CPU                   | **AMD Ryzen 7 5825U with Radeon Graphics**                                                 |
| Logical CPUs visible  | 16                                                                                         |
| OS                    | Linux 7.0.0-31-generic, x64                                                                |
| Node                  | v24.19.0                                                                                   |
| Desktop viewport      | 1440 x 1000, device scale factor 1                                                         |
| Mobile verification   | 390 x 844 and 320 x 740                                                                    |
| 3D rendering          | WebGL, ANGLE/SwiftShader explicitly enabled for headless checks                            |
| Numerical computation | CPU JavaScript in one native module Web Worker; no GPU optics solver or remote computation |

## Actual Browser Workflow

**17 groups passed**, with no uncaught page errors or remote application requests:

1. Load the production interface and confirm the detected extended-object image is inverted.
2. Change source sampling, then undo/redo and assert real emitted population changes.
3. Clear the bench and construct a source, thick lens, aperture and detector using the palette; set an exact unrounded lens position and undo/redo it.
4. Drag the lens through several pointer moves; one undo restores the exact pre-drag project and redo restores the exact completed pose.
5. Change the stop opening and assert that computed throughput and clipped outcomes change.
6. Select a computed detected ray and inspect its surface hits, normals, directions, air/glass media and refraction events.
7. Run an 11-position focus scan, inspect objective/hit-count/throughput data, and apply a sampled detector position.
8. Load the dispersive prism, compare six wavelengths, set B=0 and assert identical wavelength centroids, then undo the material change.
9. Open the production WebGL view and exercise orbit/zoom controls.
10. Export editable JSON and hit/spot CSV, clear/reimport the project and assert structural equality; malformed JSON, unsupported versions and dangling material references leave the project and measurements intact.
11. Reject impossible lens geometry, then make a valid edit with the same inspector.
12. Import and trace the 10,000-ray multi-element workload above; verify all detected rays and all exported hit rows.
13. Start a 101-position scan of the large workload, change its interval while its worker is running, and verify the obsolete scan is cancelled/invalidated while current ray results remain valid.
14. Start a 200,000-ray worker, observe animation frames while it exists, cancel it responsively, then verify that subsequent edits supersede in-flight traces and only the newer 1,701-ray result appears.
15. Exercise mobile Library/Workspace/Inspector, edit an actual off-axis Z position and verify no horizontal overflow at 390 px and 320 px.
16. Assert zero uncaught browser errors and zero external application requests.
17. Multiselect a lens and stop, nudge both using arrow keys, duplicate/delete both with keyboard shortcuts, and verify exact undo history. Escape in a numeric field cancels the draft rather than committing it. JSON round trips reproduce every exported ray-hit CSV record exactly.

These workflows complement, rather than replace, the independent numerical checks in [VERIFICATION.md](VERIFICATION.md). Screenshots illustrate the UI but are not used as an optical distribution reference. The numerical suite independently recomputes geometry, expected directions, detector coordinates and focus objectives from deterministic fixtures.
