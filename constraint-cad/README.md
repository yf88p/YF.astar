# Datum

A local-first, browser-based 2D parametric CAD sketcher. Points, finite segments, circles, and their constraints live in one versioned document. This is an original geometric solver and interface, not an embedded CAD application.

## Start

Requires Node.js 22 or newer. From this directory, one command installs dependencies and starts the complete application:

```sh
npm install && npm start
```

Open **http://localhost:5186**. On subsequent runs, use `npm start`. No account, credentials, paid service, backend, remote solver, external font, or asset server is used. npm access is only needed to install dependencies. The installed application runs entirely locally.

React 19, TypeScript, Vite, native SVG, and Lucide icons make up the interface. The model, solver, examples, and transaction store have no React or rendering dependencies. The solver is implemented here, without a third-party numerical/CAD engine.

## First Sketch

1. Choose **New sketch** in the header, or open one of four independently selectable **Examples**.
2. Select **Line**, click the first endpoint, then the second. Circle uses center then radius; Point takes one click. Previews show the current length/radius.
3. Press **V** to select. Click a line body to select the line; click an endpoint, standalone point, or center marker to select a point target. **Shift-click** adds/removes selection. An empty-space drag draws a selection box.
4. Use the Constrain toolbar. Horizontal/Vertical need one line; Parallel/Perpendicular need two lines; Coincident/Distance accept two point targets. Selecting a single whole line is also a shortcut for its two endpoints. Radius needs one circle. Fixed captures a target's current coordinates; fixing a whole line captures both endpoints.
5. Add a distance/radius, then edit its exact value in the inspector. Clicking its canvas dimension label opens its selected-relation editor. Press Enter or leave the input to apply; Escape cancels uncommitted text.
6. Drag selected geometry. This creates only a temporary cursor preference, never a stored constraint. One completed drag is one undoable transaction. Press Escape during a drag to restore its starting geometry.
7. **Export sketch** downloads editable `.datum.json`. **Open** accepts a file or pasted JSON. A localStorage recovery copy is also maintained after document actions; export is the portable save mechanism.

### Controls

| Action                                               | Control                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| Select / line / circle / point                       | V / L / C / P                                                        |
| Horizontal / distance / radius                       | H / D / R                                                            |
| Vertical, coincident, parallel, perpendicular, fixed | Labeled toolbar buttons                                              |
| Multiselect                                          | Shift-click; Ctrl/Cmd+A selects all                                  |
| Box selection                                        | Drag empty space in Select mode; Shift adds                          |
| Move selection                                       | Drag a selected body or point marker                                 |
| Pan                                                  | Middle drag, Space+drag, or Pan tool                                 |
| Cursor-centered zoom                                 | Wheel; buttons zoom about viewport center                            |
| Fit sketch                                           | F or fit button                                                      |
| Construction geometry                                | X or Construct; applies to selected entities, otherwise new geometry |
| Toggle point/origin snapping                         | S or Snap                                                            |
| Delete                                               | Delete/Backspace, or inspector trash button                          |
| Undo / redo                                          | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z; Ctrl+Y also redoes                    |
| Export                                               | Ctrl/Cmd+S                                                           |
| Cancel tool, preview, drag                           | Escape                                                               |
| Help                                                 | ? or help button                                                     |

Deleting an endpoint selection deletes its **owning entity**, not a disembodied endpoint, and removes every referencing constraint atomically. Undo restores all IDs and references. Pan/zoom, selection, and tool changes are view operations, not document history.

The inspector is a slide-out on narrow screens. All tools remain available in the horizontally scrollable ribbon; touch users can use the Pan and zoom buttons. Pinch zoom is not implemented. Desktop resizing preserves the current zoom; use Fit to reframe.

### Visual Conventions

- Violet highlight plus a wider halo/ring identifies selection.
- Dashed outlines identify construction geometry, including construction point markers. Construction geometry participates in constraints exactly like normal geometry.
- Square markers identify immovable points, derived from the Jacobian nullspace where rank is reliable, or explicitly fixed targets. Open circular markers identify other targets. Fully defined entities use green strokes; free entities use violet strokes. Solver text and numeric DOF provide a non-color state description.
- `H`, `V`, `//`, `T`, `=`, and `F` glyphs identify horizontal, vertical, parallel, perpendicular, coincident, and fixed relations. Every glyph is selectable. All permanent constraints also appear in the inspector and are individually removable.
- A rejected conflict has an explanatory alert, relevant constraint IDs, warning marks, and dashed conflict outlines on affected **existing** geometry. The solver card continues to describe the unchanged, valid document, not the rejected candidate.

### Snapping and Precision

Snapping selects the closest existing point target within **11 screen pixels**, or the origin within **10 pixels** when no point target wins. The preview explicitly says **Point snap + Coincident** or **Origin snap + Fixed**. These are ordinary, removable, undoable constraints. There is no hidden grid, horizontal, or vertical locking. Grid intersections are visual references, not persistent constraints. Disable Snap for unconstrained placement. Dragging never snaps or creates relations.

Coordinates, distances, and radii are in millimeters, with positive Y upward. Canvas and informational displays round to three decimals; editing inputs and JSON use the original JavaScript double values. An untouched input does not write its display rounding back to the document. Distances may be zero, which means coincidence. Radii must be strictly positive.

## Examples and Acceptance Checks

| Example               | Construction and check                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Driven rectangle      | Four separate 80 x 50 mm lines, four corner coincidences, two H/two V constraints, fixed lower-left origin, driving width/height. Rank 16, 0 DOF. Edit width 80 to 120: right corners move, height and origin remain. Drag cannot distort it. |
| Four-bar linkage      | Four coincident-endpoint-connected segments with four exact lengths and two distinct fixed ground joints. Nonsingular start has 1 DOF. Ground length is consistent redundancy. Small joint drags retain the same elbow branch.                |
| Connected circle      | Line endpoint coincident with center, driving radius, fixed opposite line endpoint. Drag the free joint, edit radius, export/open, and undo/redo; the center stays attached.                                                                  |
| Constraint laboratory | Fixed start, horizontal line, distance 80. Select the line and add a second 80: consistent redundancy. Add 100: established contradiction, rejected atomically with both dimension IDs.                                                       |

After a rejected edit, **the first Undo acknowledges/dismisses that rejected operation without undoing the previous accepted edit**. Rejections do not enter document history or discard redo history. A subsequent Undo performs the preceding accepted transaction. Manually dismissing the error also acknowledges it.

## Solver

`src/core/solver.ts` exposes `solve(document, options)` and `measureResiduals(document)`. `src/core/model.ts` exposes types, validation, target access, cloning, and reference-aware deletion. `src/core/store.ts` provides `SketchStore`, whose atomic operations are used by the UI and tests. `src/core/examples.ts` contains editable example factories and the performance fixture.

### Equations

Each free point contributes x/y variables and each circle contributes a radius variable. Coincidence and zero-distance relations are **exact shared-variable elimination**: connected target coordinates remain identical throughout solving. Their independent scalar equations are added back to the full-system Jacobian rank. Input positions are averaged only if coincident targets disagree; already identical values are preserved bit-for-bit.

All remaining equations are solved simultaneously with an analytic sparse Jacobian. A damped Gauss-Newton step is computed by diagonally preconditioned conjugate gradients on `J^T J + lambda I`, without allocating a dense normal matrix. Direction equations optimize the wrapped angle difference to the nearest parallel/perpendicular branch; this avoids the zero sine/cosine gradient when adding perpendicular to exactly parallel lines, or the converse. Their reported and acceptance residuals are still the normalized cross/dot products below. Backtracking accepts finite, improving steps only. Damping starts at `1e-7`, decreases after improving steps, and increases on rejected steps. There is no random restart or arbitrary mirrored-solution selection.

Dragging has two stages. At most four inexpensive preference iterations include cursor equations weighted `0.1` and a weak previous-geometry preference weighted `0.00001`. At most 40% of the time budget is spent on this stage. Exact permanent-constraint projection follows without the cursor equations. Thus cursor tracking may be approximate or remain stationary, but geometry is never committed with violated permanent constraints. This is a bounded local method, not a guarantee of a globally nearest solution. Small feasible steps retain continuity in the verified linkage; large drags through singularities can fail and leave the last valid preview intact. Targets proven immovable by a reliable local nullspace analysis do not move or create spurious no-op history entries.

### Residual Definitions

| Constraint                | Residual                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Coincident, zero distance | Both coordinate differences, `bx-ax` and `by-ay`, mm; eliminated exactly in solving |
| Horizontal                | `by-ay`, mm                                                                         |
| Vertical                  | `bx-ax`, mm                                                                         |
| Distance                  | `hypot(bx-ax, by-ay) - value`, mm                                                   |
| Radius                    | `radius - value`, mm                                                                |
| Fixed                     | Both `x-storedX` and `y-storedY`, mm                                                |
| Parallel                  | `cross(u,v) / (length(u)*length(v))`, dimensionless                                 |
| Perpendicular             | `dot(u,v) / (length(u)*length(v))`, dimensionless                                   |

**Commit stopping criteria:** maximum absolute positional/dimensional scalar residual at most **1e-8 mm**, and maximum absolute normalized angular residual at most **1e-9**. These are stricter than the requested acceptance thresholds of **1e-5 mm** and **1e-6**. Two-component fixed/coincidence Euclidean errors are bounded by `sqrt(2)*1e-8 mm`. The tests independently recompute Euclidean errors and normalized cross/dot errors from the resulting geometry; they do not trust a solver success flag or its residual helper.

A tiny step (`<1e-11` vector norm), exhausted iteration/time allowance, or failed line search terminates work, but is **not** a success unless the residual and finite-value checks pass. CG uses up to 600 iterations for projection, a relative normal-equation residual threshold `1e-11` (absolute floor `1e-13`), and at most 100 cheaper iterations for cursor preferences. Finite bounds and positive radii are checked on candidate steps and again before commit.

### Rank, Redundancy, and Failure

Rank comes from row-normalized, twice-reorthogonalized modified Gram-Schmidt on the analytic Jacobian, plus the rank of exactly eliminated coincidence equations. The relative independence threshold is `1e-8`. DOF is **original variable count minus actual rank**, never variable count minus constraint count. Redundancy is the number of scalar equations beyond rank; it is not necessarily a count of whole constraint objects.

Near-threshold row norms (`1e-10` to `1e-6`), a rank budget timeout, or an increase of rank under a deterministic `1e-4 mm` nearby probe produce **singular / rank uncertain** with DOF unavailable. This is a numerical diagnostic rather than a formal global mobility proof. Rank/nullspace is first-order and local. Degenerate positive-distance endpoints and direction constraints deserve particular care. Zero-distance constraints have two coordinate equations rather than the undefined gradient of a norm at zero.

An established **conflicting** result requires a structural certificate: incompatible dimensions on identical/coincident targets, incompatible fixed coordinates, a positive distance inside a coincidence class, dimensions/H/V incompatible with two known fixed points, or the same pair of nonzero lines required to be both parallel and perpendicular. The relevant subset includes the associated fixed/coincidence constraints where needed; it need not be minimal. Other difficult or inconsistent nonlinear systems can return **nonconvergent**, not a false assertion of contradiction. Both reject the operation atomically. No old constraints are silently deleted.

### Bounds and Limits

- At most **250 entities**, **500 constraint objects**, and **100 accepted history transactions** per sketch.
- Coordinates, fixed values, distances, and radii must be finite and within magnitude **1,000,000 mm**. Radii are positive; distances are nonnegative. These are validation bounds, not a precision guarantee at every scale.
- The tested numerical acceptance range is coordinates within **+/-1000 mm**, nondegenerate constrained line lengths at least **0.01 mm**. Direction constraints on lengths at or below **1e-10 mm** are rejected with an explanation. Intermediate zero-length directional steps are invalid.
- Default edit budget: **180 ms**; drag budget: **100 ms**; at most **70 projection iterations**, plus four preference iterations. Independent callers may request up to 160 iterations and at most 1500 ms. Iteration counts and inner loops remain bounded even if a timing check is delayed.
- Deadlines are cooperative checks between bounded blocks (every 16 CG iterations and eight rank rows), not hard real-time interrupts. A block may slightly overrun its budget. Solver runs on the browser's main thread; pointer samples are coalesced with requestAnimationFrame. No unbounded background retry runs.
- There are no arcs, tangent constraints, offsets, intersections-as-entities, trim, 3D, or CAD interchange formats beyond this JSON model. Circles are center/radius geometry, not approximating polygons. A circle body drag translates its center; resize it numerically.
- No global branch-search guarantee, exact symbolic inconsistency solver, or engineering certification is claimed. A difficult solve stays recoverable instead of accepting bad coordinates.

## Document Format

Every export is an editable version 1 object. IDs are stable and unique across entities and constraints. Line endpoints and circle centers are intrinsic targets, not separately duplicated standalone entities. Construction flags do not change equation semantics.

```json
{
  "version": 1,
  "units": "mm",
  "entities": [
    {
      "id": "segment-1",
      "type": "line",
      "a": { "x": 0, "y": 0 },
      "b": { "x": 80, "y": 0 },
      "construction": false
    }
  ],
  "constraints": [
    { "id": "horizontal-1", "type": "horizontal", "line": "segment-1" },
    {
      "id": "origin-1",
      "type": "fixed",
      "target": { "entity": "segment-1", "point": "a" },
      "x": 0,
      "y": 0
    },
    {
      "id": "length-1",
      "type": "distance",
      "a": { "entity": "segment-1", "point": "a" },
      "b": { "entity": "segment-1", "point": "b" },
      "value": 80
    }
  ]
}
```

Other entity forms are `{id,type:"point",x,y,construction}` and `{id,type:"circle",center:{x,y},radius,construction}`. Point targets use `point: "point" | "a" | "b" | "center"` according to entity type. Coincident uses two targets; parallel/perpendicular use `a` and `b` line IDs; radius uses a `circle` ID and `value`; vertical uses a `line` ID.

Import validates shape, type, finite values, units, version, IDs, compatible target parts, all references, dimensions, geometry limits, and directional lengths, then solves the candidate **before** replacing anything. An unsatisfied or nonconvergent candidate cannot replace the current document. UI import also enforces a 2 MB size limit. Unknown extra metadata is retained but is not interpreted by the solver. Solver scratch state, viewport, history, selection, and the local session title are not serialized.

## Verification

```sh
npx playwright install chromium
npm run verify
npm run benchmark
```

`verify` runs the focused numerical/transactional tests, typechecks and builds production assets, then launches **headless Chromium against the production preview** on port 5188. No X server is needed. `benchmark` starts its own production preview on 5187 and closes it afterward. The application can stay running on 5186. Linux systems without Chromium libraries can use `npx playwright install --with-deps chromium` if system package installation is available.

Individual commands:

```sh
npm test                 # standalone numerical and transaction tests
npm run build            # TypeScript + optimized production build
npm run test:browser     # requires an up-to-date dist/; headless real UI workflows
npm run benchmark        # requires dist/; real visible connected sketch + pointer drags
```

`tests/core.test.ts` includes the required examples, rank-derived DOF and consistent redundancy, zero distance, all constraint types, invalid references/values, singular and near-degenerate cases, cancellation, deletion with restored references, import atomicity, rejected-edit undo behavior, precise repeated round trips, a connected 100-entity solve, **30 seeded perturbed rectangles**, and **20 seeded flexible chains**. Checks assert invariants and independently measured residuals rather than one arbitrary solution branch.

`tests/browser/workflow.spec.ts` creates a new line/circle sketch through pointer input, checks live previews and explicit snapping, adds a radius, drags, edits, undoes/redoes, downloads JSON, opens that actual exported file, and continues editing. It separately exercises the rectangle, four-bar, duplicate/conflicting dimensions, point multiselection, construction, deletion, malformed import, removable snap relations, pan, actual-event cursor-centered zoom, and a 390 x 844 mobile viewport. Screenshots are not acceptance criteria; all assertions inspect live geometry, constraints, history, DOM, and independently computed residuals.

The browser also exposes a local inspection interface at `window.__datum`: `getDocument()`, `getResult()`, `getView()`, `load(document)`, `fit()`, `solve`, `performanceSketch()`, and the underlying `store`. Use `load()` to update the UI transactionally. Model/store modules can be imported directly from TypeScript scripts without launching a browser.

See [VERIFICATION.md](VERIFICATION.md) for measured browser/hardware performance and the final verification record.

## Licenses

Original application source is MIT licensed; see [LICENSE](LICENSE). React and Vite are MIT, TypeScript is Apache-2.0, and Lucide icons are ISC. Playwright is Apache-2.0; Vitest and Prettier are MIT. There are no downloaded images, stock CAD models, embedded application assets, custom webfonts, or runtime external assets. Example previews are generated from their actual editable document geometry.
