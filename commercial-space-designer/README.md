# Forma

**Space to imagine.** A local-first, browser-based commercial interior designer built with React, TypeScript, SVG, and Three.js. The starting cafe is an editable spatial document, not a rendered backdrop.

## Start

Requires Node.js 20.19+ (verified with Node 24) and a recent WebGL2-capable browser.

```sh
npm install && npm start
```

Open **http://localhost:5185**. This one command starts the complete application. There is no backend, account, API key, vendor connection, or remote computation. After installation, `npm start` and all core editing work without internet access. The application loads no external textures, fonts, images, or asset servers.

For a LAN demo, open the server's IP address with the same port. Geometry IDs use `crypto.getRandomValues`, so object creation also works on plain HTTP origins where `crypto.randomUUID` is unavailable.

For a production bundle: `npm run build`. Serve it with `npm run preview`, also on port 5185; stop the development server first or pass `-- --port 5186`.

## Design Workflow

- The Sunday Cafe opens in linked 2D/3D view: 80 m2, a service counter, open back-bar shelving, six bistro tables, dining chairs, a banquette, stools, plants, and pendant lighting.
- **Workspace** or the project title opens the editable examples: the cafe, a 69 m2 L-shaped boutique, a 48 m2 exhibition booth, and a blank project. Each furnished example has two independent alternatives and its own arrangement and finishes.
- Pick a catalog item, then click in the plan. There are 16 distinct procedural catalog items across seating, tables, counters, displays, partitions, and decor.
- Select in either view. The same entity is selected in the other view and inspector. A mobile selection opens a dismissible inspector drawer.
- Select a wall to enter its exact length, thickness, height, endpoints, and finish. Length editing moves its end vertex along its current direction. Every wall sharing that vertex follows. Openings retain their explicit host-relative offsets.
- Use **Door** or **Window**, then click a host wall. Inspect width, height, offset, sill elevation, and door angle. Holes, reveals, frames, glazing, and door leaves are real geometry. No opening is painted onto a solid wall.
- **Finishes** changes actual scene materials and sets that finish's sample rate. Rates can then be independently overridden in **View schedule**. Individual walls can also receive a different visual finish; the wall cost rate is a single explicitly editable project-wide rate.
- **Lighting** controls daylight, interior output, exposure, and pendant placement. Select a pendant to edit its position, elevation, intensity, and color.
- The camera button saves the actual view in the current alternative. **Present** removes studio chrome; saved views and current-scene PNG capture remain available.
- The alternative **+** duplicates the entire current design. **Compare** shows measured plans, quantities, complete costs, and deltas against the first alternative. Alternative names are editable there.
- Autosave persists the current project to this browser's local storage. **Export > Editable project** is the portable backup. Starting a new example is undoable, but export first for a permanent archive.

## Controls

| Action                         | Control                                               |
| ------------------------------ | ----------------------------------------------------- |
| Select / multiselect           | Click / Shift-click                                   |
| Move selected objects or walls | Drag in plan                                          |
| Edit wall endpoint             | Drag a selected wall's circular handle                |
| Draw connected walls           | W, then click endpoints; close a loop for a floor     |
| Select tool                    | V                                                     |
| Plan pan                       | H, middle drag, or Alt-drag                           |
| Zoom plan                      | Scroll, centered at cursor; or +/-                    |
| Fit plan / reset orbit camera  | F / target icons                                      |
| Rotate furniture               | R, 15 degrees; exact angle in inspector               |
| Duplicate selection            | Ctrl/Cmd+D                                            |
| Delete                         | Delete or Backspace                                   |
| Undo / redo                    | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z; Ctrl+Y also works      |
| Export project                 | Ctrl/Cmd+S                                            |
| Cancel wall chain / selection  | Escape                                                |
| Orbit / pan in 3D              | Left drag / right drag                                |
| Enter walkthrough              | Walkthrough, then click 3D view for pointer lock      |
| Walk / faster walk             | WASD or arrow keys / Shift                            |
| Look                           | Mouse while pointer locked                            |
| Release mouse                  | Escape, explicitly handled as well as browser default |
| Leave walkthrough              | Orbit or X in the walkthrough instruction strip       |
| Recover camera after an edit   | Target icon in walkthrough instruction strip          |

Drawing snaps to existing endpoints, host-wall junctions, a 0.1 m grid, and nearby 45-degree angle increments. Snap targets and live lengths are shown. Arbitrary angles remain supported away from the angle snap. Numeric entry is not restricted to the grid. Pointer drags use 0.1 m increments; a completed drag commits once, not once per pointer event. Invalid intermediate states never replace the valid spatial model.

## Spatial Conventions

- All model lengths are **full-precision meters**. Plan X is right and Y is down; Three.js maps plan `(x,y)` to `(x,height,z=y)`. Furniture rotation and door opening angles are degrees. Light output is a sample point-light intensity in candela.
- Displayed wall lengths are **centerline endpoint distances**. Room and floor-finish areas use **centerline polygons**, not the smaller finished-face clear area. This is an estimating/design convention, not an as-built survey.
- Rooms are derived using planar directed-edge face walks. Endpoint/T connections form a shared graph. T-junction creation splits the host wall, rebases opening offsets when required, and rejects a cut through an opening. Dangling partitions do not destroy a surrounding floor.
- Room IDs are deterministic boundary-vertex keys. Moving existing vertices preserves room IDs and names. Topology changes that change a room's boundary vertex set create a new room key and default label; old metadata is retained in the project. Renaming a newly detected room is available in its inspector.
- Actual wall geometry is a union of wall-thickness strips in horizontal height bands. Door and window rectangles remove the complete host thickness in the relevant bands. Polygon union eliminates overlapping coplanar wall faces and cracks at supported endpoints and T-junctions. End caps and reveals are real surfaces.
- Orbit uses a presentation cutaway: walls along the maximum-X and maximum-Y boundary are reduced to a 0.16 m plinth. Windows on those cut edges are omitted in orbit; doors remain visible. **Walkthrough restores full wall/opening geometry.** The spatial/cost document is not changed by cutaway.
- Floor, wall, terrazzo, tile, and wood textures are procedurally generated locally. Floor/wall UVs come from metric geometry: one tile/terrazzo repeat per meter, wood pattern per two meters. Furniture uses authored solid-color PBR materials and modeled details rather than imported texture assets.

## Collision Model

- Furniture uses rotated rectangular width/depth footprints and floor-based height intervals. Items at or below 0.06 m are treated as nonblocking floor decor, so a rug under a chair is valid. This is a deliberately conservative footprint model: a round table's square bounding footprint is used, and the space beneath tabletops is not walkable.
- Separating-axis checks distinguish overlap from valid contact. Furniture contact tolerance is 0.005 m; wall checks allow a 0.005 m proximity band, classifying shallow contact separately from overlap. Contact does not appear as an error.
- Door clearance is the **full inward 90-degree swing sector**, independent of the current angle. It is a design envelope, not a claim of accessibility/code clearance. Warnings select the involved entities and never move unrelated objects.
- Walking uses a 0.18 m body radius and 1.65 m eye height. Walls and blocking furniture cannot be crossed. Only floor-level doors at least 1.9 m high, with sufficient width and at least 55 degrees opening, are candidate portals; the actual rotated leaf is still checked. Windows are never portals.
- Motion is capped to 0.05 seconds of simulation per frame and checked in spatial substeps no longer than 0.05 m. Ordinary stalls slow motion instead of allowing tunneling. Axis-separated sliding is supported. Walkthrough is not a physics engine: there is no jumping, crouching, stair traversal, or dynamic furniture pushing.
- A valid edit can encompass an existing camera position. Use the clearly labeled recovery target to find a clear point in a detected room; this avoids silently moving the camera on each edit. In a plan without a safe room, recovery falls back outside the plan.

## Quantities And Money

**Currency: USD. Every catalog price and unit rate is an explicit local sample, not a live vendor quote.**

| Category     | Computation                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Floor finish | Sum of detected centerline room polygon areas x floor rate                                            |
| Wall finish  | `2 * sum(centerline wall length * wall height) - 2 * sum(opening width * opening height)` x wall rate |
| Doors        | Count x door rate                                                                                     |
| Windows      | Count x window rate                                                                                   |
| Furniture    | Sum of each item's integer-cent unit price; custom dimensions/prices create separate schedule rows    |

Both longitudinal centerline allowance faces of each unique wall are costed once, including exterior walls. Shared walls are entities, not duplicated per room. No wall end caps, reveals, or junction-thickness corrections are added to the estimate; geometric union is used for rendering, but the cost convention remains the two centerline allowance faces. This is stated in the UI, CSV, and here so totals are reproducible, not an assertion that the allowance equals every exposed mesh triangle's area.

Money is stored in integer **cents**. Geometry keeps full precision. Multiply the full category area by its integer-cent rate, then round that category once to the nearest cent, half-up (`Math.round` for these nonnegative amounts). Furniture and opening subtotals are integer arithmetic. Add rounded categories to form the total. The displayed/exported grand total includes cents; compact category summaries round to whole dollars for readability.

No labor, structural construction, MEP, tax, installation, or pendant-light fixture costs are invented. A catalog floor lamp is a priced furniture item; a placed pendant/point light is a lighting-design source and excluded from this small estimate.

The isolated 4 m x 3 m wall fixture with a 1 m x 2 m door and 1 m x 1 m window is **9 m2 per costed face**, 18 m2 for the two-face budget convention.

## Persistence And Files

- `Project.version = 1`; a project contains its name, active design ID, and 1-12 independent `Design` documents.
- Each design contains vertices, walls referencing vertex IDs, openings referencing host wall IDs and offsets, catalog furniture with transforms/dimension/price overrides, lights, room names, finishes, lighting, rates, and saved camera vectors. See the exported TypeScript types in `src/model.ts`.
- JSON export preserves all these fields and IDs. Import validates the complete project **before** changing history or autosave. Unsupported versions, malformed collections, nonfinite/out-of-range values, bad references, duplicate IDs, invalid materials/prices, impossible opening positions, and crossing/overlapping walls are rejected without replacing current work. Import size limit is 10 MB.
- SVG is vector geometry with full-precision coordinates, `data-length-m` attributes, room areas to 0.001 m2, door swings, window extents, furniture footprints, and dimension text to 0.001 m. Native page size is **1:10**; its title explicitly states the scale and centerline convention.
- CSV combines the furniture schedule, finish quantities, opening counts, editable sample rates, subtotals, total, USD currency, and cost/rounding conventions. Dimensions and numeric quantities derive from the same document as the UI.
- PNG comes directly from the current WebGL framebuffer. It is the actual design/camera/material/light state, without studio chrome, not a stock image or an HTML screenshot substitute.
- History stores complete immutable project transactions, capped at 80 undo steps. Geometry, openings, furniture, materials, rates, lights, saved views, new projects, imports, and alternative duplication are restored together. Deleting a wall with openings requires confirmation and removes those attachments in that same undoable transaction. History itself is session-local, not included in exported projects.

## Supported Boundaries

- Single level; straight walls; room loops with no crossing edges; arbitrary plan angles; endpoint joins and T-junctions. No curves, stories, structural engineering, or building-code certification.
- Coordinates must be finite and between -50 and 50 m. Wall-vertex extents must fit a 50 x 50 m plan. Maximum 200 walls, 400 vertices, 500 furniture items, and 40 lights per alternative.
- Walls: minimum 0.1 m length, thickness 0.06-0.80 m, height 0.30-6 m. Openings: minimum 0.3 m width/height, 0.05 m margin at host ends and between openings, elevation within the host, door angle 0-110 degrees.
- Furniture: width/depth 0.1-10 m, height 0.005-6 m. Numeric dimensions scale the procedural catalog design. Nonuniform scaling is a design affordance, not a manufacturer-configurable product promise.
- Crossing walls must be explicitly connected as endpoint/T segments, not unjoined X intersections. Nested disconnected room loops/courtyards are rejected; connect partitions to the outer boundary instead. Opening overlap is rejected even when two openings have different sill heights.
- Disconnected wall/room components are allowed. Deleting a boundary can legitimately leave no closed floor. The exhibition has a deliberately low front boundary/plinth; its area still follows the same closed centerline convention.
- Individual wall finish selection changes the scene; the wall-finish estimating rate is uniform within an alternative. Furniture finishes are the curated catalog materials. There is no imported custom mesh/texture system.
- Walkthrough is keyboard/mouse oriented. Mobile supports plan drawing, orbit, catalogs, numeric property editing, materials, budgets, and exports; a physical keyboard is needed for first-person movement.
- Real-time PBR, shadows, and tone mapping are used, not offline-renderer photorealism. Software WebGL can be slow, especially at a large viewport; see the measured results rather than assuming 60 FPS.

## Verification

```sh
npm test
npm run build
```

With the app running, install the headless verification browser once if needed and exercise the actual application:

```sh
npx playwright install chromium
npm run verify:browser
```

Set `FORMA_URL` to verify a production preview on another port, for example `FORMA_URL=http://localhost:5186 npm run verify:browser`. The script uses **headless Chromium**, not a headful DevTools launch, and requires no X server. It produces screenshots, exported SVG/CSV/JSON/PNG, and `verification/report.json`.

The 26 deterministic tests include independent rectangular, L-shaped, rotated-rectangle, joined-corner, and T-junction references; the 9 m2 opening fixture; door/window traversal; geometry rejection; room-boundary edits; furniture rotation/contact/clearance; alternative isolation; malformed imports; export precision; and 50 edit/undo/redo cycles. Analytical assertions are tighter than the requested 0.001 m / 0.001 m2 tolerance.

The headless workflow checks actual numeric wall editing and live budget/area changes, actual 3D mesh-hole raycasts, pointer lock, keyboard traversal through open doors and blocking by closed doors/windows, clearance resolution, linked 3D selection, drag transaction undo, finishes/lights/views, alternatives and deltas, attached-opening deletion/undo, autosave/reload/reimport, all export types, blank-project construction, all examples, mobile numeric editing, and a visible 40-wall/100-furniture scene. Repeated edit resource counts are compared. See [VERIFICATION.md](VERIFICATION.md) for recorded measurements and limitations.

## Structure And Provenance

- `src/model.ts`: rendering-independent types, validation, topology, geometry intervals/unions, collision, quantities, transactions, import/export.
- `src/examples.ts`, `src/catalog.ts`: local, editable arrangements and explicit sample data.
- `src/Plan.tsx`: direct-manipulation SVG editor; `src/Scene3D.tsx`: real geometry, procedural assets, instancing, picking, camera, walkthrough, image capture.
- `src/App.tsx`: one project/history owner, linked selection, inspectors, comparison, schedule, persistence, onboarding.
- `src/model.test.ts`, `scripts/browser.mjs`: deterministic fixtures and end-to-end verification.

Furniture geometry, thumbnail drawings, surface textures, layouts, brand, and UI were authored procedurally for this application. No downloaded images, architectural models, stock renders, or third-party designer applications are embedded. See [ASSETS.md](ASSETS.md) and [LICENSE](LICENSE).
