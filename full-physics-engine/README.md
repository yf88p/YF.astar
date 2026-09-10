# Newton Physics Lab

An interactive, browser-based lab for classical 2D mechanics. Explore six experiments, edit rigid bodies and fields, and inspect live energy and momentum measurements. Built with React, TypeScript, Canvas 2D, and the Rapier WebAssembly physics engine.

Newton implements a specific set of educational models, not every law of physics or a research-grade simulation of real materials.

## Quick Start

Use Node.js **20.19+ or 22.12+**, with **Node 22 LTS recommended**, and npm. Internet access is needed to download dependencies on the first run.

```sh
npm start
```

This command installs dependencies, then launches Vite at **http://localhost:5173**. If that port is occupied, Vite tries the next available port; use the URL printed in the terminal. The development server binds to `0.0.0.0`, so it may also be reachable on your local network.

Open the URL in a modern browser supporting **WebAssembly and Canvas 2D**. The engine starts **paused**: press **Play** or **Space** to begin. Click the canvas first if a focused form control is consuming keyboard input. No backend or account is required. Fonts and engine assets are served locally; the running app does not depend on external APIs or font services.

## Experiments

| Preset             | What it demonstrates                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gravity playground | Falling and bouncing circles, a ramp, stacked boxes, and a rope pendulum. Default gravity is `(0, -9.81)` m/s^2; air drag is `0.015` s^-1.                                                                    |
| Newton's cradle    | Five equal bobs with restitution `1`, zero friction and air drag, and maximum-length ropes. Small gaps separate impacts; this approximates a cradle, not deformable ball contacts or perfectly rigid strings. |
| Orbital mechanics  | Pairwise attraction with normalized `G = 0.35`, a **fixed 100 kg central star**, and small mutually interacting planets. Initial speeds account for force softening. Uniform gravity and air drag are off.    |
| Spring oscillator  | Two damped Hookean springs with different masses and stiffnesses under uniform gravity.                                                                                                                       |
| Buoyancy tank      | Floating, neutral, and sinking bodies, plus righting torque on tilted boxes. The reservoir has density **1 kg/m^3**, level `4.5` m, and drag rate `2` s^-1.                                                   |
| Charged particles  | Attraction and repulsion with normalized Coulomb constant `k = 3`. Add a perpendicular magnetic field in Advanced forces to bend trajectories.                                                                |

The preset `G` and `k` values are educational normalizations, **not universal physical constants**. The tank's density of `1` is illustrative, **not real water**. Material menu names also refer to illustrative parameter bundles, not calibrated real-world material properties.

## Using the Lab

- **Playback:** Play/Pause, Reset, and Advance one frame are below the canvas. Frame advance is available while paused and advances `1/60` s, or two physics steps. Speed choices are `0.25x`, `0.5x`, `1x`, `2x`, and `4x`.
- **Select and inspect:** Click or tap a body with Select, or choose one from the Inspector's accessible object list. Edit its name, radius or dimensions, rotation, density, restitution, friction, color, position, linear/angular velocity, charge, fixed state, and individual trail setting. Mass is derived from geometry and density. Numeric edits commit on Enter or blur; velocity controls are hidden for fixed bodies. The rotation editor uses degrees; serialized rotations use radians.
- **Manipulate:** While playing, dragging a dynamic body applies a damped spring force at the grabbed point, including torque. While paused, dragging repositions bodies directly, including fixed bodies, without advancing time. Fixed bodies cannot be dragged while playing.
- **Create and remove:** Choose Circle or Box, then click/tap to place it. Add object also offers a fixed Platform placed at `(0, 4)`. Duplicate copies the current body state with an offset, but not its joints. Deleting a body removes attached joints. Create an empty world retains a ground platform.
- **Navigate:** Use the Hand tool or middle-button drag to pan. Scroll to zoom around the cursor, use the zoom buttons, or Fit view. On touchscreens, use one-finger selection/dragging or the Hand tool and zoom buttons; pinch zoom is not implemented.
- **Environment:** Change gravity and air resistance, then expand Advanced forces for horizontal gravity/wind, mutual gravity, electric and magnetic fields, and fluid level/density. Reset world settings restores only the loaded scene's environment.
- **Display and measure:** Toggle the grid, motion trails, velocity vectors, and labels. A trail requires both the global Motion trails switch and the body's Trace this body setting. Energy/Momentum tabs show recent measurements; Export data downloads CSV. The chart displays a 20-second window; retained samples cover up to 25 seconds, capped at 500, rather than a full-run log.
- **Small screens:** Open Experiments and Settings from the mobile toolbar. After selecting a body, open Settings to access its Inspector. The Field guide contains model notes and shortcuts.

| Shortcut                | Action                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `Space`                 | Play / pause                                                                         |
| `R`                     | Reset the loaded experiment                                                          |
| `V` / `H`               | Select and drag / pan                                                                |
| `C` / `B`               | Place a circle / box                                                                 |
| `F`                     | Fit view                                                                             |
| `G` / `T`               | Toggle grid / motion trails                                                          |
| `Delete` or `Backspace` | Delete selected body                                                                 |
| `?`                     | Open shortcut guide                                                                  |
| `Escape`                | End canvas interaction, return to Select, close menus/side panels; dismiss the guide |

Global shortcuts are suppressed while inputs, selects, textareas, or editable content have focus, while the guide is open, and with Ctrl/Meta/Alt modifiers. Space on a focused button retains that button's normal keyboard behavior.

## Reset and Storage

**Reset reloads the originally loaded scene's initial conditions**, not the latest edited or exported state. It restores bodies, joints, environment, and the configured camera, clears simulation time, trails, and measurement history, and pauses playback. Loading a preset, imported file, or Last exported scene establishes a new reset baseline. Exporting alone does not change that baseline.

**Export scene** downloads editable JSON containing current positions, rotations, velocities, body properties, joints, and environment. The camera in that file is the scene's configured camera, not your current pan/zoom. Export also attempts to store one **Last exported scene** in browser `localStorage` under `newton-saved-scene`. This is per browser/origin, is not continuous autosave or cloud storage, and can be unavailable or cleared. The JSON download still works if local storage fails. Reloading the app starts the default playground; use Last exported scene to reopen the stored snapshot.

**Import** accepts validated scene JSON up to **2,000,000 bytes**. It loads paused, resets time to zero, and creates a fresh Rapier world and solver/contact cache. JSON is an editable starting state, **not a bit-exact checkpoint**: accumulated time, contact warm-start data, sleeping state, active dragging, trails, and chart history are not restored.

## Physical Models

### Units and Rigid Bodies

World coordinates use metres with **+x right and +y up**, seconds, kilograms, radians, coulombs, and tesla. Density is kg/m^3 with **1 m out-of-plane thickness**, so volume is area times that thickness. `G` has units m^3/(kg s^2), electric `k` has units N m^2/C^2, spring stiffness is N/m, and spring damping is N s/m.

Circles and oriented boxes are uniform, undeformable rigid bodies. Rapier integrates translation and rotation subject to forces, impulses, and constraints, using fixed steps `h = 1/120` s:

```text
m = density * area * 1 m
I_circle = m * radius^2 / 2
I_box = m * (width^2 + height^2) / 12
m * dv/dt = sum(F)             I * domega/dt = sum(torque)
torque = offset_x * F_y - offset_y * F_x
F_uniform_gravity = m * g
```

Fixed bodies have no simulated motion or response to forces, but retain their analytical mass and charge as field sources. Gravity/electric interactions treat bodies as center-located sources, not integrated extended mass or charge distributions.

### Contacts and Joints

Rapier resolves circle/box collisions with contact impulses, rotational inertia, Coulomb friction, and restitution. The ideal normal restitution target is `v_normal_after = -e * v_normal_before`; tangential impulses obey the friction bound `abs(J_t) <= mu * J_n`. The app uses `e = max(e_a, e_b)` and Rapier's default average friction combination, `mu = (mu_a + mu_b) / 2`. Solver tolerances and simultaneous contacts make these numerical approximations, not exact collision identities.

- **Rope:** constrains anchor separation to at most `length`. It can go slack and is not a rigid rod or bilateral distance joint.
- **Revolute:** keeps the two anchors coincident while allowing relative rotation.
- **Spring:** a damped Hookean joint with restoring force along its axis, `F = -K * (L - L0) - c * dL/dt`, solved by Rapier rather than an exact oscillator solution.

Anchors are in each body's local coordinates and rotate with it. Off-center forces can produce torque. Contacts between bodies directly connected by a joint are disabled. Joint creation/editing is supported through scene JSON, not a graphical joint editor.

### Pairwise Fields

Newtonian gravity and Coulomb forces share **Plummer softening `epsilon = 0.12 m`**. For displacement `d = position_b - position_a`:

```text
s = sqrt(dot(d, d) + epsilon^2)
F_on_a = (G * m_a * m_b - k * q_a * q_b) * d / s^3
F_on_b = -F_on_a                 (when both bodies are dynamic)
U_pair = (k * q_a * q_b - G * m_a * m_b) / s
```

Like charges repel and opposite charges attract. Softening applies even inside overlapping colliders, removing the singularity and changing short-range physics. Every unordered pair is evaluated: field stepping and pair-potential measurement cost **O(n^2)** when enabled. Fixed-fixed pairs produce no motion. Pair forces use symmetric half-kick / Rapier-step / half-kick integration, reducing orbital drift without guaranteeing exact energy conservation.

### Magnetic Field

A uniform perpendicular field points out of the screen for positive `B`. The Lorentz force is `F = q * B * (v_y, -v_x)`. Rather than explicitly adding that force, the engine performs **exact velocity rotations** through `angle = -q * B * h / (2m)` before and after the other updates. Each magnetic half-step preserves speed up to floating-point error and does no work. The split combination with position integration, other forces, and contacts is still numerical, not an exact full trajectory or a full electromagnetic field solver.

### Air Drag and Interaction

Air resistance is **linear**, not quadratic aerodynamic drag. `airDrag` is a damping rate in s^-1, not a dimensionless drag coefficient:

```text
a = min(airDrag, 0.5 / h)
F_air = a * m * (wind - v)
torque_air = -a * I * omega
F_pointer = (120 * m) * (target - grabbed_point) - (20 * m) * v_grabbed_point
```

Wind is a prescribed velocity, and pointer dragging is external forcing. Air drag damps both translation relative to wind and spin; forces are recomputed each step rather than accumulated indefinitely.

### Buoyancy and Fluid Drag

The fluid is a stationary, flat reservoir occupying **all space below `fluid.level`**, not a simulated liquid confined by tank walls. Bodies do not raise its level. Submerged circle area and centroid use circular-segment geometry; rotated boxes are clipped against the surface and use the clipped polygon's area and centroid.

For a partly submerged circle, let `z = level - center_y`, `R = radius`, and `c = sqrt(R^2 - z^2)`:

```text
A_sub = R^2 * (asin(z / R) + pi/2) + z * c
centroid_y = center_y - 2 * c^3 / (3 * A_sub)
```

For `z <= -R`, submerged area is zero; for `z >= R`, it is the full circle area. With `M = fluid.density * A_sub * 1 m`, centroid offset `r`, and local point velocity `v_point = v + omega * (-r_y, r_x)`:

```text
F_buoyancy = -M * g
D = min(fluid.drag * M, m * 0.25 / h)
F_fluid_drag = -D * v_point
torque_spin_drag = -min(fluid.drag * M / m, 0.25 / h) * I * omega
```

Buoyancy and fluid drag act at the submerged centroid and therefore also generate torque; spin drag is additional. Buoyancy uses uniform gravity only, not pairwise gravity. The surface remains horizontal even if gravity has an x component. Fluid drag is a linear rate in s^-1, with no flow field, waves, pressure evolution, or viscosity solver. Rendered surface ripples are decorative.

### Energy and Momentum

The monitor reports **body mechanical energy**:

```text
K = sum_dynamic(0.5 * m * dot(v, v) + 0.5 * I * omega^2)
U = sum_dynamic(-m * dot(g, position)) + sum_pairs(U_pair)
    + sum_springs(0.5 * K_spring * (L - L0)^2)
E = K + U
p = sum_dynamic(m * v)
```

Pair potentials include fixed sources; kinetic energy, uniform-gravity potential, and linear momentum count dynamic bodies only. Uniform-gravity potential uses the coordinate origin as reference; pair potentials tend to zero at infinite separation. Potential energy may be negative.

Fluid energy, buoyancy-reservoir potential, drag/friction/impact heat, magnetic field energy, and work supplied by the pointer, wind, supports, or live edits are **not tracked**. Fixed supports can exchange momentum with the simulated bodies; a stationary ideal support need not do work, but externally moving/editing it can. Uniform gravity and imposed fields are external influences. Consequently, **energy and momentum are not always conserved**, even before accounting for damping, collisions, solver error, and safety caps.

Not modeled: relativity, quantum mechanics, thermodynamics/heat transport, deformable solids, full fluid dynamics, radiation, electromagnetic induction, or chemical reactions.

## Numerical Limits

The authoritative implementation is [`src/physics.ts`](src/physics.ts), especially its constants and validation functions. All numeric scene values must be finite. These are **engine/import bounds**; individual UI fields can have narrower ranges.

| Parameter                                 | Accepted range / limit                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Scene size                                | 250 bodies; 500 joints                                                     |
| Body position, camera center, fluid level | Each coordinate in `[-10000, 10000]` m                                     |
| Body velocity, wind                       | Each component in `[-1000, 1000]` m/s                                      |
| Body rotation / angular velocity          | `[-1000000, 1000000]` rad / `[-200, 200]` rad/s                            |
| Circle radius                             | `[0.01, 50]` m                                                             |
| Box width and height                      | Each in `[0.02, 100]` m                                                    |
| Body density / fluid density              | `[0.01, 10000]` / `[0, 10000]` kg/m^3                                      |
| Restitution / friction                    | `[0, 1]` / `[0, 2]`                                                        |
| Body charge                               | `[-1000, 1000]` C                                                          |
| Uniform gravity                           | Each component in `[-1000, 1000]` m/s^2                                    |
| Air and fluid drag rates                  | `[0, 100]` s^-1                                                            |
| Mutual `G` / electric `k` / magnetic `B`  | `[0, 1000]` / `[0, 10000]` / `[-1000, 1000]`                               |
| Joint anchors / length                    | Each local component in `[-100, 100]` m / `[0, 200]` m                     |
| Spring stiffness / damping                | `[0, 100000]` N/m / `[0, 10000]` N s/m                                     |
| Configured camera scale                   | `[5, 500]`; rendered zoom is separately clamped to `[8, 250]` CSS pixels/m |

IDs and body labels are nonempty strings of at most 100 characters; scene names allow 120, descriptions 2,000, and colors 64. Body IDs and joint IDs must each be unique. Joint endpoints must reference distinct existing bodies. Unknown fields are discarded; unsafe prototype properties and non-plain objects are rejected.

- **Timing:** `h = 1/120` s, 12 solver iterations, CCD enabled on bodies, and at most 4 CCD substeps. A real-time accumulator advances only whole fixed steps. Each `step(dt)` accepts at most `0.25` s of catch-up; excess time is discarded. Playback speed scales elapsed input, not `h`. Hidden tabs do not advance the world or catch up their hidden duration.
- **Damping caps:** effective air damping is at most `60` s^-1; fluid translational damping is at most `30 * m` kg/s, and its additional spin damping rate at most `30` s^-1. These prevent excessively large explicit damping updates.
- **Force caps:** each pair-field kick uses a common scale to keep its acceleration contribution within `10000` m/s^2. A separate common scale limits custom air/fluid/pointer forces and torques to `10000` m/s^2 and `10000` rad/s^2. These are not global caps on Rapier contact/joint impulses, uniform gravity, or magnetic rotation.
- **State guards:** after each step, dynamic speed magnitude is limited to `1000` m/s and spin to `200` rad/s. Positions outside the `+/-10000` m world bounds are clamped and linear velocity cleared. Nonfinite body state is restored to its stored specification position with zero rotation and velocity. These emergency guards change physical behavior and can change energy/momentum; validation does not guarantee accuracy for every extreme configuration.

## Extending Scenes

Start with an exported scene or a copy of a preset. [`src/types.ts`](src/types.ts) defines `SceneConfig`, `BodySpec`, `JointSpec`, and `Environment`; runtime validation in `src/physics.ts` is the final authority.

1. Keep the top-level `id`, `name`, `description`, `bodies`, `joints`, `environment`, and `camera` fields. Supply a complete environment, including `fluid: null` when disabled.
2. Add bodies with unique IDs and either `shape: "circle"` plus `radius`, or `shape: "box"` plus full `width` and `height`. Mass is calculated, not an input field. Omitted motion/charge fields default to zero; `fixed` and `trail` default to false.
3. Add constraints to `joints` using local anchors. For example, with existing bodies named `support` and `bob`, this entry creates a spring:

```json
{
  "id": "spring-1",
  "type": "spring",
  "bodyA": "support",
  "bodyB": "bob",
  "anchorA": { "x": 0, "y": 0 },
  "anchorB": { "x": 0, "y": 0 },
  "length": 2,
  "stiffness": 20,
  "damping": 0.1
}
```

`length` is the spring rest length or rope maximum length; it remains required but is unused for revolute joints. Omitted stiffness/damping default to `30`/`0`. JSON also exposes settings without dedicated controls, such as vertical wind and fluid drag. Import the edited file to validate and run it. To add a built-in preset, define a `SceneConfig` in `src/presets.ts`; update App's preset-specific presentation alongside it.

## Development

After the initial dependency installation:

| Command           | Purpose                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `npm run dev`     | Start Vite without reinstalling dependencies                               |
| `npm test`        | Run Vitest physics, validation, lifecycle, serialization, and preset tests |
| `npm run build`   | Type-check TypeScript and build the static app into `dist/`                |
| `npm run preview` | Serve the production build locally                                         |

Browser end-to-end tests cover playback, all presets, body and world edits, dragging, zoom/pan, JSON/CSV exports, imports, mobile touch controls, and accessibility. Install Chromium and run:

```sh
npx playwright install chromium
npm run test:e2e
```

The browser-test setup provides optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` support for an existing compatible Chromium executable instead of a Playwright-managed browser. Browser binaries are separate from npm dependencies. Tests start their own Vite server on port 5180.

Rapier's compatibility package embeds its WebAssembly binary in a separate, lazy-loaded JavaScript chunk. The interface renders while that chunk initializes. Its upstream initialization wrapper currently logs a deprecation warning through the documented `init()` API; this does not prevent simulation or tests.

### File Map

| File                                              | Responsibility                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`                                    | React entry point and stylesheet loading                                                                                        |
| `src/App.tsx`                                     | Workspace UI, inspector, playback, scene loading/storage, imports/exports, charts, guide, and shortcuts                         |
| `src/SimulationCanvas.tsx`                        | Canvas rendering, camera, hit testing, pointer/touch interaction, trails, and animation loop                                    |
| `src/physics.ts`                                  | Validation, Rapier lifecycle, rigid bodies/joints, force integration, buoyancy, safety limits, metrics, and scene serialization |
| `src/types.ts`                                    | Shared scene, body, joint, environment, snapshot, and display types                                                             |
| `src/presets.ts`                                  | Six experiments and default environment                                                                                         |
| `src/physics.test.ts`                             | Numerical and behavioral engine regression tests                                                                                |
| `e2e/lab.spec.ts`, `playwright.config.ts`         | Browser workflow, responsive interaction, and accessibility checks                                                              |
| `src/styles.css`                                  | Workspace styling, responsive panels, and reduced-motion rules                                                                  |
| `index.html`, `public/`                           | HTML shell and static assets                                                                                                    |
| `package.json`, `vite.config.ts`, `tsconfig.json` | Commands, dependencies, development server, and TypeScript configuration                                                        |
