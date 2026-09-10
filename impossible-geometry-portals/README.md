# PARALLAX

A first-person impossible-space puzzle laboratory and integrated level editor. The portal views are live, recursive renders of the same world that handles movement, cubes, picking, pressure plates, doors, and goals.

## Start

Requires Node.js **20.19+** and a modern WebGL2 browser.

```sh
npm ci && npm start
```

Open the local address Vite prints. It chooses another port if 5173 is occupied. This one command installs and starts the complete application. There is no backend, account, API key, paid service, or remote computation. After installation, `npm start` works without an internet connection. All essential visual and audio assets are generated locally.

For a production build: `npm run build`, then `npm run preview`.

## Play

Select any of the three chamber cards, then click **Enter chamber**. The field guide explains the rules without initially revealing the solutions.

| Control                  | Action                                              |
| ------------------------ | --------------------------------------------------- |
| WASD or arrow keys       | Grounded movement                                   |
| Mouse                    | Look                                                |
| Space                    | Jump                                                |
| E                        | Pick up / drop a cube, including through an opening |
| Left click while holding | Throw                                               |
| R                        | Deterministic restart                               |
| Esc or P                 | Pause and release the pointer                       |
| F                        | Fullscreen                                          |

**Pointer recovery:** use Back to the chamber to capture again. If pointer lock is unavailable, drag inside the scene to look. On touch devices, use the directional pad, drag the scene to look, and use the jump/pick/throw buttons. Pause freezes physics; **Inspect the frozen world** keeps orbit navigation available.

Sensitivity, volume, mute, recursion depth, reduced motion, and a measured performance overlay are available in Settings. The camera has no head bob. Settings and completed-chamber markers are stored only in your browser.

## The Chambers

| Chamber                    | Spatial idea                                                                                 | Actual completion condition                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **01 / The Delivery**      | Carry a cube from a teal atrium into an amber annex.                                         | Supported weight raises the full-width exit door; the player enters the goal behind it.              |
| **02 / Falling Sideways**  | An eight-meter drop through a floor opening becomes horizontal flight from an elevated wall. | Reach a raised island that is higher than the normal jump.                                           |
| **03 / The Long Way Home** | Three portal pairs close a three-room loop. The central sightline returns behind the player. | Leave a cube on the relay plate, follow the graph, and enter the side vault through its linked door. |

Each is independently selectable and editable. Traversal changes coordinates within the current world, not the selected level. The next-chamber button appears only after real goal occupancy.

### Reproducible Solutions

Open **Field guide**, expand **Need to see it in motion?**, and select **Watch this chamber's solution**. This resets the selected built-in chamber and drives its public gameplay inputs. Replays walk, look, pick up, carry, drop, and let gravity act. They never assign body positions, door states, or completion flags.

`src/replay.js` also exports `SolutionReplay` and `runSolution` for deterministic verification without rendering. The older `DEMOS` in `src/levels.js` are explicitly labeled swept-body diagnostic waypoints, not input recordings. The UI uses the actual input replays.

## Author

Click **Level editor** to edit the current authored document. You can also start from **Blank** or load any supplied chamber.

1. Add a room, then select it in the inspector. Room centers are geometric centers; a five-meter room centered at Y=2.5 has a floor at Y=0.
2. Place blocks, cubes, plates, doors, and goals. Set position, dimensions, and supported rotations; choose the snap increment. Select the player start to move the spawn.
3. Use **Portal pair** to choose two rooms and their north/south/east/west/floor/ceiling surfaces. Both apertures are placed in one validated transaction.
4. Select a plate and wire its door IDs. Set the goal's required door IDs. All plates wired to a door must be supported simultaneously.
5. Use the X/Z drag sliders for snapped placement. A completed drag is one undo step. A click on a visible scene entity selects it; drag the scene to orbit and scroll to zoom.
6. Enable overlays for collision bounds, portal frames/normals, portal links, and mechanism wiring.
7. Select **Playtest**. It uses an isolated runtime copy. **Return to edit** restores authored initial conditions, including cube positions and closed-door states.
8. Undo/redo, save locally, reload, or export/import editable JSON. **Image** exports the current live canvas, not a replacement for the level document.

Invalid imports, nonfinite values, unsupported versions, invalid references, overlapping apertures, and impossible portal placement leave the current project and history intact. Deleting a portal deletes its pair atomically; deleting a door repairs its plate and goal references. Room deletion cascades affected references. A room cannot be removed if there is no safe replacement player start.

Local saves use one browser slot, `parallax-observatory.editor.v1`. Export JSON for multiple projects or durable backups. The inspector's summary shows actual entity counts and link endpoints.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run verify:browser
```

The first two commands run the deterministic numerical/physics/document/replay tests and production compilation. The browser command runs those commands again, starts a temporary **production preview**, launches **headless Chromium**, and shuts down its preview afterward. It needs no X server. Installing Chromium is a one-time download; browsers with missing Linux dependencies may require `npx playwright install --with-deps chromium`.

Browser checks include real pointer capture and keyboard input, all three input-driven solutions, live depth-three self-visibility, independent source occlusion and destination clipping controls, sub-millimeter approach, cube straddling and interaction, complete editor authoring/persistence, mobile layouts, resource disposal, and a running 21-cube stress scene.

The generated machine-readable report is [`docs/verification.json`](docs/verification.json). Human-readable results, test boundaries, and measured timings are in [`docs/VERIFICATION.md`](docs/VERIFICATION.md). Screenshots and exported browser fixtures go to `/tmp/opencode/parallax-browser` by default; set `PARALLAX_ARTIFACTS` to change that location. `PARALLAX_URL` can target an already-running instance instead of starting preview.

## Technical Contract

See [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for the portal equations, finite-aperture crossing policy, collision approximation, eye rig, ray budget, fixed timestep, rendering limits, and JSON format.

Key supported limits:

- Rigid, equal-sized, stationary portal pairs on axis-aligned room boundaries, including walls, floors, ceilings, and rolled apertures. Arbitrary oblique rigid mappings are tested mathematically; sloped portal host surfaces are not authored in version 1.
- A conservative box-based rigid-body solver, not a full contact-manifold/torque engine. Cubes preserve identity, mass, orientation, and transported linear/angular velocity. The player collider stays upright.
- Physics: 120 Hz, at most 12 ticks per frame, maximum 28 m/s, swept segments at most 0.08 m. Excess wall-clock time is discarded rather than causing unbounded catch-up.
- Interaction: four meters of total portal-aware reach, at most six portal traversals.
- Rendering: three traversals by default, four in Settings, at most 20 portal views per frame. A stable inset-grid field deliberately terminates recursion.
- Portal targets are at most 1024 pixels on their longest side and shrink with depth. The pool is capped and disposed on edit/reload/resize. The measured three-pair workload uses about nine MiB of color/depth targets.
- There is no recursive light transport or full acoustic simulation. Room lighting, direct shadows, emissive frames, and bounded one-hop spatial sound are approximations, not claims of those systems.

## Source Map

| File                        | Responsibility                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/core.js`               | DOM-free document validation, portal math, fixed-step physics, crossing state, rays, holding, and puzzles |
| `src/levels.js`             | Three editable levels, blank and stress documents                                                         |
| `src/render.js`             | Procedural materials, architecture, clipped copies, transformed recursive cameras, target lifecycle       |
| `src/main.js`               | Game modes, input, progression, settings, UI, and editor isolation                                        |
| `src/editor.js`             | Transactional document history and authoring interface                                                    |
| `src/replay.js`             | Deterministic solutions through public gameplay inputs                                                    |
| `src/audio.js`              | Locally synthesized, spatially placed sound cues                                                          |
| `tests/`                    | Independent numerical oracles and focused regressions                                                     |
| `scripts/browser-check.mjs` | Production browser verification and performance measurement                                               |

For local inspection, `window.parallax` exposes the current `world`, `view`, `editor`, replay controls, `loadStress()`, and actual `measure()` results. The goal condition remains in `World`; this surface has no test-only success setter.

## Assets And License

Original application code and all generated assets are MIT licensed. Nothing is loaded from an external asset server. See [`LICENSE`](LICENSE) and [`docs/ASSETS.md`](docs/ASSETS.md) for provenance and dependency licenses.
