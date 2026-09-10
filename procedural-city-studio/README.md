# Forma City Studio

A local-first, procedural 3D city editor. Sculpt a landscape, draw a street network, give neighborhoods character, and follow actual lane-based traffic through the result. Three editable examples and an empty landscape use the same city document and tools.

## Start

Requires **Node.js 22.12+**, npm, and a browser supporting **WebGL 2**. From this directory, one command installs dependencies and starts the complete application:

```sh
npm install && npm start
```

Open the local URL printed by Vite, normally `http://localhost:5173`. If that port is occupied, Vite prints the available alternative. After installation, `npm start` needs no network connection. There is no backend, account, credential, map API, remote computation, or runtime asset server.

Hardware-accelerated WebGL is strongly recommended. The available verification browser used SwiftShader software rendering, which was functionally correct but **not smooth** on the full city. See the measured performance section, not a fabricated 60 FPS claim.

## A First Bridge

1. Open **New city > Riverfront**, seed `42`.
2. Choose **Roads > Boulevard**. Keep width `18 m`, Ground level, clearance `5 m`, and maximum grade `12%`.
3. Click the central waterfront junctions at `(0, -90)` and `(0, 90)`. Alternatively, expand **Precise coordinates**, add those two points, then click **Build road**.
4. Press Enter to commit. The road connects both waterfronts, with a flat elevated deck over the water, graded land approaches, railings, and supports. Existing blocks are recomputed from their actual topology.
5. Switch to Select and click the bridge deck. Its inspector shows length, elevation, actual maximum grade, and directed lane count. Choose **Drive this road** to spawn a reachable route and follow its vehicle.
6. Use the lower-right Moon button or daylight slider for night lighting. Press Escape to return to the skyline.

If a lane entrance is occupied, route spawning reports that there is no safe space. Let traffic clear and retry; no overlapping car is forced into the lane.

## Controls

| Control | Action |
| --- | --- |
| Left drag, Select tool | Orbit the city |
| Right drag / wheel | Pan / zoom |
| Two fingers on touch devices | OrbitControls pan/zoom navigation |
| `V` | Select |
| `T` | Terrain brushes |
| `W` | Water/river tool |
| `R` | Road drawing |
| `B` | Parcel zoning |
| `I` | Building inspector |
| Click, while drawing | Add a polyline point |
| Enter / Backspace / Escape | Finish / remove last point / cancel |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Undo / redo a complete transaction |
| `Ctrl+S` | Download editable JSON |
| Space | Pause / resume traffic |
| Step button | Pause and advance exactly `1/60 s` |
| Speed button | Cycle `0.5x`, `1x`, `2x`, `4x` |
| Street mode: WASD / Shift | Walk / move faster |
| Street mode: drag | Look around |
| Follow mode | Follow the selected vehicle, or the first active vehicle |
| `P` | Clean presentation mode |
| Escape | Cancel, close a dialog, or return to the skyline |
| `?` | Quick start and controls |

On narrow screens, the top-right panel button opens/closes the inspector. Selecting an editing tool opens its settings. Close the inspector to expose more of the canvas; precise coordinate entry also works on mobile.

## Editing

**Terrain:** Raise, lower, smooth, and flatten operate on a bounded heightfield. The brush ring previews the affected area; the stroke commits on pointer release. A stroke collects at most 24 spatially separated samples and is one history transaction. Flatten uses the initial stroke elevation. Smooth blends a sample with its eight neighbors. Road alignment is revalidated; an excessive slope rejects the whole stroke without flattening other terrain.

**Water:** Draw a centerline, set width and water elevation, and press Enter. Its capsule-shaped region is used by both rendering and bridge classification. A new river replaces the existing river and carves its bed. It does not automatically restore the old riverbed. Infeasible approaches or protected buildings reject the operation. This is static water, not hydrology.

**Roads:** Local streets and boulevards are polylines stored as graph edges. Draw from an existing endpoint to extend a road, or use Extend in its inspector. The inspector also supports splitting at the midpoint, moving either shared endpoint numerically, dragging shared nodes, deleting the edge, and changing width/profile/clearance. Attached roads use the same node rather than copies of its coordinates.

**Neighborhoods:** Ground-level closed road faces produce parcels automatically. Density controls the seeded fraction of occupied non-park parcels and the procedural floor-count distribution. Generate neighborhoods refreshes them; it never invents a face from a disconnected road. Choose residential, commercial, mixed-use, or park zoning, then click a parcel. Parcel overlays help with small or empty lots.

**Buildings:** Click a building for floor count, valid footprint width/depth, palette, and roof form. Floor height is `3.2 m`. Apply creates a protected override and regenerates its surrounding props. The inspector reports the actual smallest parcel setback, footprint area, and estimated floor area.

**Protected-building policy:** Stable parcel IDs preserve untouched buildings, including their user edits. If a changed block would remove or invalidate an edited building's host parcel, the entire edit is rejected with its ID. Select that building and explicitly remove override protection if you want subsequent regeneration to replace it. Buildings are never silently orphaned or moved into a different parcel.

**Cancellation and history:** Model work runs in a disposable Web Worker. Cancel rebuild (or Escape) terminates that worker before any result commits. Only a complete, validated result replaces the current document. History keeps 40 full snapshots in the UI. Terrain strokes, topology, intersections, zoning, settings, building overrides, and saved views are included. GPU resources are disposed before rebuilding the rendered model. Generation is not an unbounded asynchronous district queue.

## Geometry Conventions

- Coordinates are metres, with `X/Z` horizontal and `Y` up. The default tile is `960 x 960 m`; its center is the origin. Terrain samples are row-major from `(-size/2, -size/2)`.
- Default terrain resolution is `33 x 33`; rendering samples the same interpolated heightfield more densely. Interpolation is bilinear and bounded at the tile edge.
- Same-level line crossings split both roads and share a node. Endpoint snapping is `8 m`. Collinear extensions are supported; duplicate and overlapping collinear roads are rejected.
- Supported roads are straight polyline segments, at least `2 m` long, with junction angles of at least `25 degrees`. Useful editing coverage is T, four-way, and nondegenerate wider junctions. Simple diagonal subdivisions are supported. Self-touching faces and nested faces with holes are rejected.
- Each road is assigned a discrete level. The UI exposes ground and `+12 m`; other imported core levels are multiples of 12 m. A crossing at another level stays disconnected and needs at least `5 m` vertical separation.
- Connecting ramps between levels are **not supported**. Do not expect proximity, a drawing over an overpass, or a visually adjacent elevated endpoint to create one.
- Maximum road grade is `12%`. A lower per-drawing limit can be requested. Bridges use flat decks at least the requested clearance above water, with `10%` continuous land approaches. Insufficient approach length is rejected. Split approaches retain their lifted endpoint heights.
- Intersection surfaces are convex paved junction fans meeting trimmed road strips. They are not stacked road rectangles. Traffic uses curved connectors between incident lanes, not a turn through an unrelated sidewalk.
- The road profile includes carriageway, sidewalks, curbs, markings, and streetlights. Both supported profiles simulate **one lane per direction**, at `0.19 x road width` from the centerline. Boulevards have a wider cross-section, not four simulated lanes.
- Parcel subdivision packs axis-aligned rectangular lots inside supported faces. Faces are not assumed to be rectangular. Exact containment and infrastructure-clearance tests exclude water, roads, tiny cells, and concave notches. Buildings keep a minimum `2 m` setback inside their parcel.
- Stable coordinate-derived block/parcel IDs and entity-local seeded RNG keep untouched districts stable. Road IDs are retained on the first piece when splitting. Explicit city reseeding changes procedural choices, but preserves protected building overrides.
- Trees, benches, paths, and streetlights are explicit persistent `props`, with stable IDs, host IDs, positions, size, and rotation. Rebuild derives their placements from the city. Props have no manual overrides. Decorative grass and roof foliage are procedural detail, not independently editable objects.

### Supported Limits

The pure model validates terrain sizes `60-4096 m`, resolution `3-129`, finite bounded heights, road widths `8-40 m`, clearance `5-30 m`, building floors `1-80`, and entity references. Roads narrower than 8 m cannot accommodate the supported two-way traffic and sidewalks and are rejected. The studio applies tighter interactive limits: **600 road segments, 1,200 nodes, 3,000 buildings, terrain resolution 65, 200 target vehicles, 32 drawing points, 8 MB JSON imports, and 40 undo snapshots**. These are acceptance bounds, not promises of constant-time generation at their maxima.

The UI creates 960 m tiles. Arbitrary terrain dimensions require a valid imported document. Extremely acute, overlapping, nested, or infeasibly graded configurations are rejected rather than silently repaired. No traffic engineering, hydrological, structural, cadastral, population, or financial realism is claimed.

## Traffic Model

`src/core/traffic.ts` has no rendering dependency. It constructs actual directed lanes from each road's sampled alignment, trims approaches to incident junctions, and constructs sampled cubic connectors. A geometric crossing alone does not create a graph connection. U-turns are permitted only at dead ends.

Reachable destinations are selected deterministically and routed by breadth-first search on **directed lanes with legal connectors**, minimizing link count rather than distance. Vehicles keep their selected route, then plan another reachable route when they arrive. Spawns without a safe lane location or reachable continuation are excluded and counted in Explore. Explicit unreachable routes show an error.

Simulation uses a fixed **60 Hz** step. Top speed is `11 m/s`, acceleration `2 m/s²`, braking `4 m/s²`, and minimum center spacing `6 m` (`4 m` vehicle plus `2 m` gap). Cars stop at the lane's stop line before acquiring the junction. A node has one conservative movement reservation, retained through the turn and exit clearance. Occupied exits deny entry. This is deliberately lower-throughput than real multilane traffic.

At nodes with at least three incident roads, signals use a shared deterministic cycle: **NS green 12 s, all-red 2 s, EW green 12 s, all-red 2 s**. Degree-one/two nodes yield using the same reservation. Already-admitted cars may finish clearing during red; new cars may not enter. The live signal overlay shows each approach's actual phase; the queue overlay marks waiting vehicles.

`advance()` accumulates real time into fixed steps, clamps a single stalled render frame to `0.25 s`, and caps playback at `4x`. Long pauses or slow software rendering therefore slow wall-clock playback rather than causing an unbounded catch-up burst. The time display is **actual simulated time**, not a wall clock.

Structural edits, undo/redo, imports, explicit reseeding, or traffic-count changes remove old transient traffic and repeat the city-seeded initial conditions. No car or future route survives on obsolete geometry. Pure building, zoning, lighting, name, and camera edits do not need a route reset. A seeded reset is repeatable for the same city and requested count; transient vehicles are not saved in JSON.

The fixtures run the same city at 30, 60, and 144 render FPS, including 4x playback. At equal simulated time the tested same-runtime vehicle states were exactly equal. Assertions use `1e-9` for time accumulation and numerical geometry tolerances of `1e-6` to `1e-4 m` as appropriate. No cross-browser bitwise determinism is promised.

## Persistence And Export

The single `City` schema is defined in `src/core/model.ts`:

```text
version: 1
name, seed, nextId
terrain: size, resolution, heights[]
water[]: id, points[], width, level
nodes[]: id, x, z, y, level
roads[]: id, a, b, width, profile, level, clearance
parcels[]: id, blockId, polygon[], zone, buildingId?
buildings[]: id, parcelId, x, z, width, depth, floors, palette, roof, edited
props[]: id, kind, x, z, size, rotation, hostId, length?
settings: density (0..1), traffic (0..1, multiplied by 200 in studio), day (0..24)
views[]: name, position[3], target[3]
```

Committed edits autosave under `forma.city.v1` in browser localStorage. **Export JSON is the portable backup**; browser storage may be cleared or unavailable. Undo history is session-only. Imports are validated before replacement: unsupported versions, missing/duplicate IDs, invalid references, nonfinite coordinates, invalid topology, malformed terrain, bad placements, and unsupported geometry fail recoverably. No silent import repair or old-schema migration is performed.

**PNG:** captures the actual current camera and scene at drawing-buffer resolution. Editor overlays and UI are excluded. It is not a pre-rendered example image.

**GLB:** exports the actual scene in glTF 2.0 binary format, including the terrain, water, buildings, infrastructure, props, and current vehicles. Units are metres. It uses `EXT_mesh_gpu_instancing`, so the receiving application needs that extension for instanced geometry. Active instance attribute counts are trimmed consistently. Root extras include the seed, terrain dimensions, and model entity IDs; the full editable semantics live in JSON. Editor selections and overlays are not exported. Procedural animated water shaders/light behavior are not portable simulation data; GLB contains the generated geometry and exportable material state, not a running Forma city.

**Quantities:** road length is horizontal centerline length; area is terrain-tile area; parcel/building counts come directly from the model. Estimated floor area is `sum(width x depth x floors)`, not leasable area. Roof forms, foundations, and stepped tower massing can extend rendered vertical bounds beyond the floor-count height.

## Verification

```sh
npm run verify
```

Runs 47 independent geometry, props, traffic, transaction, import, and signal-buffer checks, then strict TypeScript checking and the production build. All passed during delivery. The independent fixtures calculate connectivity, winding/containment, clearances, displacement, queue gaps, and state equality; they do not merely assert generator success flags.

For actual browser workflows, install the free local browser once:

```sh
npx playwright install chromium
npm run test:browser
```

The runner starts and stops its own Vite server on an available local port, blocks off-origin requests, exercises actual forms/canvas gestures/downloads, and saves a JSON report under `/tmp/opencode`. On other machines, that artifact directory is created by the runner. `FORMA_URL` can use an existing development server. `FORMA_REPORT` overrides the report file. The slow software renderer can make the entire browser suite take **over 20 minutes**; filtered workflows allow bounded runs:

```sh
FORMA_TEST='Empty canvas|T four-way|Terrain drag|No runtime' npm run test:browser
FORMA_TEST='Riverfront bridge|UI bridge|Building roof|Grade separation|Malformed' npm run test:browser
FORMA_TEST='JSON download|PNG|GLB|Fresh mobile|No runtime' npm run test:browser
FORMA_TEST='Live overlays|No runtime' npm run test:browser
FORMA_TEST='Visible workload|No runtime' npm run test:browser
```

The delivery exercised all 16 browser workflows across completed runs, including live signal colors, night lights, saved views, clean presentation, and cancellation. An uninterrupted full run hit an external 20-minute command limit, so that is **not** reported as a passing single run. An instance-color export mismatch found by the GLB round-trip was fixed; the focused GLB and runtime checks subsequently passed. Detailed results, methodology, and execution boundaries are in [`docs/verification.json`](docs/verification.json).

### Measured Performance

Measured on Linux, AMD Ryzen 7 5825U, 16 logical CPUs, Chromium 153.0.8010.12 headless, **ANGLE Vulkan SwiftShader**, at a 1440 x 1000 viewport and 1082 x 843 drawing buffer (DPR 1). The complete city remained visible; neither buildings nor vehicles were hidden for the measurement.

| Measurement | Observed result |
| --- | --- |
| Road segments / buildings / active vehicles | 120 / 413 / 110 |
| Persistent props | 918 |
| Draw calls / aerial triangles | 51 / 472,448 |
| GPU geometry allocations | 28 |
| Worker city generation | 1,162.2 ms |
| Mesh rebuild on main thread | 184.3 ms |
| CPU rendering submission, mean | 1.83 ms |
| Completed render plus pixel readback, mean | 1,922.53 ms |
| Observed orbit frame mean / p95 | 1,835.64 / 2,183.20 ms |
| Observed orbit rate | **0.54 FPS**, prior run 0.86 FPS |
| Final GLB | 7.17 MB, 47 mesh definitions, 50 mesh nodes |
| Loaded GLB scene bounds | 960 x 85.4200 x 960 m |

These numbers demonstrate a **software rendering bottleneck**, not satisfactory interactive performance or a hidden 60 FPS result. `gl.finish()` alone returned before the browser GPU process completed, so verification also uses a synchronous one-pixel readback barrier; CPU submission is not presented as frame rate. A hardware-accelerated desktop performance result was unavailable in this environment.

Geometry is batched/instanced by material, window glazing uses outward-facing planes, and distant window sills use their outward faces rather than six-sided boxes. Close views restore sill depth. These reduced aerial triangles from 1,029,502 to 472,448 without dropping buildings, windows, trees, or vehicles. Terrain/road validation remains independently testable and cancellable even when the GPU is slow. No assertion of unlimited city size is made.

## Source And Assets

- `src/main.ts`: UI, interaction transactions, autosave, worker coordination, overlays.
- `src/city.worker.ts`: cancellable model-generation boundary and studio limits.
- `src/core/model.ts`: city schema, terrain, topology, faces, parcels, overrides, props, history, validation.
- `src/core/traffic.ts`: lane graph, connectors, routing, signals, following, fixed-step simulation.
- `src/scene.ts`: procedural Three.js geometry, lighting, picking, camera modes, resource disposal, exports.
- `tests/*.test.ts`: independent deterministic fixtures.
- `tests/browser.ts`: browser gesture, persistence, export, and performance verification.

All city geometry, vegetation, vehicles, preview illustrations, water patterns, and the Forma mark are authored here or generated procedurally. There are **no downloaded 3D models, photographs, map tiles, HDRIs, external fonts, or runtime asset dependencies**. Typography uses installed system sans-serif fonts. Original source and generated assets are MIT licensed; see [LICENSE](LICENSE). Dependency provenance is documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
