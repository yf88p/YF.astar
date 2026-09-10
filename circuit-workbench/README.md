# Fieldwork Circuit Lab

A local circuit workbench built with React, TypeScript, and Vite: an editable schematic, DC operating-point and transient analyses in local Web Workers, and a multichannel oscilloscope displaying the computed samples. Circuit computation does not require a server, account, API key, or external compute service. Icons and other application assets are bundled locally; there are no runtime CDN assets.

**Verified on 2026-09-06:** production build passed, numerical/model/editor tests **31/31 passed**, and the production bundle passed **13/13 headless browser scenarios**, with no browser console warnings/errors or page errors. Numerical diagnostics, browser coverage, limitations, and the measured benchmark are recorded below. Screenshots are visual references only; measurements and traces come from actual circuit solves, not screenshot-derived or preview data.

## Run Locally

Use a current Node.js installation with npm and a modern browser supporting ES modules, SVG, Web Workers, and `structuredClone`. The recorded checks used Node.js `v24.19.0` on Linux x64.

```sh
npm install && npm start
```

This is the complete local-app startup command; no separate backend needs starting. Open the Vite URL printed in the terminal, normally `http://localhost:5173`. The start script binds to `0.0.0.0`, so use a trusted network or restrict exposure yourself. Installing packages initially requires registry access; simulation itself runs locally.

| Command | Purpose | Recorded status |
| --- | --- | --- |
| `npm run build` | Type-check with `tsc -b`, then produce the Vite production bundle | Passed |
| `npm test` | Run `tests/*.test.ts` through `tsx` and Node's test runner | 31 passed, 0 failed |
| `npm run benchmark` | Run the connected RC-ladder numerical benchmark | Completed; results below |
| `npm run verify:browser` | Headless Playwright application verification via `tests/browser.ts` against Vite development server | Passed |
| `VERIFY_PRODUCTION=1 npm run verify:browser` | Run the same browser checks against the built `dist/` application after `npm run build` | 13/13 passed |

The browser script starts Vite on a free loopback port and stops its own server in cleanup. With `VERIFY_PRODUCTION=1`, it starts Vite preview instead, serving the production bundle. Set `BASE_URL` to test an already-running server instead; that server is left running. It uses `/usr/bin/chromium` when available, otherwise Playwright's installed Chromium (`npx playwright install chromium` if needed; `npx playwright install --with-deps chromium` also installs Linux browser dependencies). Chromium runs headlessly; no X server, display, or Xvfb is needed. Screenshots/downloads go to `/tmp/opencode`, created if absent; the scenario report is printed to stdout.

## Editor and Controls

Choose a component in the searchable palette, then click the canvas to place it on the 20-unit grid. Supported components are resistor, capacitor, inductor, diode, independent voltage source, independent current source, finite-resistance switch, and ground. Placement returns to Select. Select a component to edit its parameters in **Inspect**, then press **Apply component** to validate and commit all fields together; SI values such as `4.7k`, `2.2u`, and `1e-3` are accepted.

| Input | Action |
| --- | --- |
| `V` | Select tool; select objects, drag components/junctions |
| `1` / `2` / `3` / `4` / `G` | Place resistor / capacitor / inductor / voltage source / ground |
| `W` | Wire tool |
| `J` | Explicit junction tool |
| `P` | Voltage probe on a pin or junction |
| `I` | Current probe on a two-pin component |
| `L` | Label anchored to a pin or junction |
| `R` | Rotate the selected component 90 degrees |
| `Ctrl+D` | Copy the selected component, offset by 60 units in each direction |
| `Delete` / `Backspace` | Delete selection and dependent references |
| `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` | Undo / redo |
| `Ctrl+S` | Export editable project JSON |
| `/` / `?` | Focus component search / open field guide |
| `Escape` | Cancel the active operation |
| Mouse wheel | Zoom about the cursor |
| Middle-mouse drag or `H` hand tool | Pan the canvas; Shift+wheel pans horizontally |

Command substitutes for Ctrl on macOS. Editing shortcuts do not intercept form inputs. Canvas buttons also provide zoom and Fit circuit. A completed drag is one undo entry; copies have unique IDs and begin electrically disconnected, without inherited wires or probes. Deleting a component or junction removes wires, labels, and probes that reference it. Label names and probe names/colors are editable in Inspect; pin/net rows highlight the shared topology.

To wire, click the starting pin or junction, click intermediate bend locations, then finish on another pin or explicit junction. Select a wire, choose Endpoint A/B in Inspect, and press **Reconnect wire** to change topology while keeping the route. Drag its square bend handles to reroute it; double-click a wire to add a bend, or use **Clear route bends**.

**Connectivity is explicit, never inferred from geometry.** Using `J` at a crossing splits the crossing wires and references one common junction. A crossing without a junction dot is not connected; bridge gaps communicate that distinction. Merely drawing a junction over existing wires in JSON does not connect them: their endpoint references must use it. Coincident pins, wire bends, wire crossings, and matching label names do not merge nets. Moving or rotating an object retains its endpoint topology; reversing a diode electrically requires reconnecting its pins, not rotating its drawing.

All ground pins share net `0`. Labels only name the already-connected net; they are not global electrical connections. Multiple labels on one net are sorted and displayed together. A voltage probe measures its referenced net relative to ground. A current probe measures the named component branch, not an arbitrary wire current.

Choose **DC operating point** or **Transient**, then **Run**. **Analysis** contains duration, maximum timestep, nonlinear relative tolerance, and initialization, committed with **Apply settings**. **Readings** shows all node potentials and signed branch currents from the same completed solution (the final sample for transient). **Inspect shared netlist** displays/exports the topology used by both analyses and lets you highlight a net.

Each run uses a new worker with a **30-second compute budget**. Stop terminates it and retains no partial capture. Document changes cancel obsolete work and mark prior captures stale; stale readings are hidden and CSV is disabled. Results are accepted only for the current worker and document revision. **Reset** stops analysis and clears results; the next run initializes at `t=0` using the chosen explicit states or DC initialization. It does not load historical solver state or change the chosen initial conditions.

**New**, example loading, imports, and edits are undoable, with the latest **60 undo snapshots** kept in memory. The latest valid document, not solver history or the undo stack, is saved to `localStorage` under `fieldwork-project-v1`; invalid saved data falls back to the divider example. Export JSON for a separate durable copy or when browser storage is unavailable. On mobile, **Components**, **Workbench**, and **Inspector** navigation switches panels. **Field guide** offers the full technical guide as a Markdown download: this README, bundled from `README.md?raw` at build time.

### Oscilloscope

The scope plots transient samples with independently toggleable channels, a shared time axis, **voltage on the left and current on the right**, and separate auto-fit scales over enabled channels' full records. Display reduction preserves first/min/max/last original samples per horizontal bucket in time order, rather than smoothing or generating a waveform. Samples include `t=0` and every accepted timestep, including event-aligned samples; event spacing can be nonuniform.

- Zoom with the wheel or 2x buttons; Shift+wheel pans, and pan buttons move 20% of the visible window. Fit restores the full record. With the plot focused, arrows pan, `+`/`-` zoom, and `0`/Home fits.
- Select cursor A/B and click/drag, or enter its time in numeric seconds. Cursors snap to the nearest original sample without interpolation; ties select the later sample. Focused cursor arrows step one sample, Shift+arrows ten, and Home/End select the endpoints. Readouts show A/B values, `dt=B-A`, and `1/abs(dt)` (interval frequency, not a signal-frequency estimate).
- Min, max, mean, RMS, and peak-to-peak use all finite samples in the **full record**, including hidden channels. Mean and RMS are arithmetic, equally sample-weighted statistics, **not time-weighted**, even on nonuniform event grids. Zoom does not change them.
- CSV exports every original timestamp and all probe channels, including hidden ones, with quoted names and SI units. It is neither display-downsampled nor restricted to the visible time window. Stale, failed, cancelled, or absent captures cannot be exported as completed results.

No FFT, automatic AC sweep, trigger acquisition, or additional scope modes are implemented.

## Components and Units

All stored physical values use SI units: ohms, farads, henries, volts, amperes, seconds, and hertz. Sine phase and component rotation use **degrees**. Numeric input is parsed in full: trailing garbage, nonfinite numbers, overflow, and nonzero values underflowing to zero are rejected. Prefixes are case-sensitive (`m` is milli, `M` mega; `k` and `K` both kilo); `u` and both common micro characters are supported. Unit suffixes are optional, but when present they must match the inspector field: entering `2uF` for resistance is rejected, not interpreted as ohms. Accepted suffixes include `ohm`, `ohms`, the ohm symbol, `F`, `H`, `V`, `A`, `s`, `Hz`, and `deg`; dimensionless fields reject physical units. The independent `parseEngineering(text, unit?)` API can optionally omit dimensional checking by omitting its second argument. Display formatting uses approximately four significant digits and does not change solver precision.

**Pin convention:** pin `0` is the first terminal and pin `1` the second. With rotation zero they are left and right, 40 canvas units from the component center; positive rotation follows screen coordinates. Ground has only pin `0`.

| Component | Model and editable meaning |
| --- | --- |
| Resistor | `I = (V0 - V1) / R`; finite `R > 0` |
| Capacitor | `I = C d(V0 - V1)/dt`; finite `C > 0`; `initial` is signed voltage `V0 - V1` |
| Inductor | `V0 - V1 = L dI/dt`; finite `L > 0`; `initial` is signed current from `0` to `1` |
| Voltage source | Enforces `V0 - V1 = source(t)`; pin `0` is `+`, pin `1` is `-` |
| Current source | Enforces positive current from pin `0` to pin `1`; signed and zero values are valid |
| Diode | Anode `0`, cathode `1`; Shockley law with editable positive `diode.is` and `diode.n` |
| Switch | `Ron` when closed, `Roff` when open; both finite and positive, with `Ron < Roff` in a valid document |

Every reported branch current is positive **from pin `0` to pin `1`**, including voltage sources. A voltage source delivering power therefore commonly has a negative reported current. For the built-in 10 V divider, `I(R1) = +0.005 A` and `I(V1) = -0.005 A`.

The diode uses `I = Is * (exp(Vd / (n * VT)) - 1)` with fixed `VT = 0.025851999786 V` at 300 K. Its generic `value` field is not a fixed forward drop; the default `0.7` does not set a threshold. Evaluation avoids avoidable intermediate exponential overflow but does not clamp the physical law. Reverse breakdown, junction/diffusion capacitance, reverse recovery, and temperature variation are out of scope.

Switch defaults are `Ron = 0.1 ohm`, `Roff = 1e9 ohm`, initially open. A schedule is a strictly increasing array of distinct nonnegative times; each time toggles the initial `closed` state. A toggle at zero is applied to the transient initial state. An open switch still conducts through its specified `Roff`; it is not an ideal disconnection. The switched-RC example approximately holds its charge, not perfectly.

### Source Waveforms

Both source types support the same waveform definition. `value`, `offset`, `amplitude`, and initial storage states may be signed; frequency may be zero. Delay, rise, fall, and width are nonnegative; period is positive.

| Mode | Transient definition |
| --- | --- |
| `dc` | Uses `component.value`, ignoring waveform offset/amplitude |
| `sine` | Before delay: `offset`. From delay: `offset + amplitude * sin(2*pi*frequency*(t-delay) + phase*pi/180)` |
| `pulse` | Repeats from delay: low `offset`, linear rise to `offset + amplitude`, high plateau, linear fall, low until the next period |

Pulse `width` is the **high plateau only**, excluding rise and fall. Require `rise + width + fall <= period`. Zero rise/fall produce instantaneous edges; event values are right-continuous. For `offset=-1`, `amplitude=4`, `delay=0.005`, `rise=0.002`, `width=0.003`, `fall=0.001`, `period=0.01`, the first rise occupies 5-7 ms, high plateau 7-10 ms, fall 10-11 ms, and low plateau 11-15 ms. With zero rise/fall, the high plateau instead begins at 5 ms and ends at 8 ms. A delayed sine with nonzero starting phase can also jump at its delay.

Standalone DC analysis always uses source `value` and switch `closed`, not waveform values or toggle schedules.

## Numerical Policy

The independent implementation is in [`src/solver.ts`](src/solver.ts). It uses dense modified nodal analysis (MNA): unknown non-ground net voltages plus voltage-source and inductor branch currents. Capacitor current unknowns are additionally introduced during initialization. Linear systems use row/column equilibration and full-pivot Gaussian elimination, with a scaled pivot threshold of `1e-14`.

No `gmin`, added leakage, source resistance, or other unrequested circuit element is inserted. Specified switch `Roff` and diode reverse saturation current are parts of their models, not numerical regularization. Missing ground, floating voltages, conflicting ideal constraints, undefined branch currents, arithmetic overflow, and nonconvergence produce errors rather than fabricated or partially converged results.

### Initialization

- `solveDC(netlist)`: capacitors are open, inductors ideal shorts, sources use `value`, and switches use `closed`. Stored `initial` values are ignored. Nodes require a DC path to ground; current sources and open capacitors do not provide one.
- Transient `initialization: "explicit"`: constrain **all** capacitor voltages and inductor currents to their signed `initial` values simultaneously at `t=0`, using right-continuous transient sources and switches.
- Transient `initialization: "dc"`: first solve an operating point using **transient source values at zero**, including zero-time switch toggles; derive capacitor voltages and inductor currents from it, ignoring explicit `initial` fields. Then perform the same consistent initialization solve.

Initialization is a constrained circuit solve, not a tiny artificial first timestep. Differentiated KCL handles inductor/current-source cutsets; differentiated voltage-source constraints and `C*dV/dt` recover physical capacitor and voltage-source currents, including consistent parallel capacitor initial states. Auxiliary indeterminacy is allowed only where the initialization recovery resolves it, never to accept an undetermined physical voltage or inductor current.

Conflicting capacitor/source voltages or series-inductor/current-source initial currents are errors. Ideal voltage-loop compatibility uses a roundoff threshold `64 * Number.EPSILON * max(1, absolute compared voltages)`; cutset current compatibility uses `1e-12 A + 64 * Number.EPSILON * sum(abs(currents))`. These checks do not silently relax or overwrite user initial conditions using the Newton relative tolerance. Redundant ideal source/inductor loops are rejected because branch currents are not unique.

### Timestepping and Events

The timestep setting is a **maximum step**, not a requested plotting interval or an accuracy guarantee. Normal steps use trapezoidal companion models, with `h` the actual step length and `v = V0 - V1`:

```text
Capacitor: i_new = (2*C/h)*(v_new - v_old) - i_old
Inductor:  v_new = (2*L/h)*(i_new - i_old) - v_old
```

If and only if a step throws a `Newton nonconvergence` error, it retries the **same step** with backward Euler, from the same accepted storage state and a fresh zero Newton guess:

```text
Capacitor: i_new = (C/h)*(v_new - v_old)
Inductor:  v_new = (L/h)*(i_new - i_old)
```

There is no local-truncation-error controller, automatic timestep halving, or guaranteed error estimate. Singular/inconsistent matrix errors are not retried as if they were Newton failures. If the backward-Euler retry also fails, the solve fails.

The grid lands exactly on switch toggles, sine delays, pulse starts and ramp/plateau corners, and the final duration. It restarts maximum-step spacing at each event, avoiding accumulated floating-point time drift. Only roundoff-distance snapping is used (`16 * Number.EPSILON` times the relevant time magnitude). The complete event-aligned grid is counted before result allocation.

At an event, integrate to its **left** side, preserve capacitor voltage and inductor current, then consistently re-solve the algebraic circuit on its **right** side. Store one right-continuous sample at that time, not duplicate left/right samples. Currents and non-storage voltages may jump. An ideal source jump that would require an instantaneous capacitor-voltage or inductor-current change is an impulse/inconsistent constraint and is reported, not hidden by changing the stored state. Each result includes all net voltages and component currents, starting at `t=0`; `steps = samples.length - 1`.

### Convergence and Tolerances

| Policy | Value |
| --- | --- |
| Standalone DC Newton relative tolerance | `1e-8` |
| Transient Newton relative tolerance | `settings.tolerance`, finite and `0 < tolerance < 1` |
| Blank-document / example relative tolerance | `1e-7` / `1e-8` |
| Absolute voltage tolerance | `1e-9 V` |
| Absolute current tolerance | `1e-12 A` |
| Maximum Newton iterations | `160` per solve |
| Maximum line-search trials | `32`, halving the damping factor |

Newton acceptance requires **both** the equation residual norm and the proposed correction norm to be at most one. Each residual is divided by `absolute_tolerance + relative_tolerance * equation_scale`, where scale is the sum of absolute stamped equation terms. Each correction is divided by its voltage/current absolute tolerance plus `relative_tolerance * max(abs(old_unknown), abs(proposed_unknown))`. An undamped final polish must also satisfy the residual test.

Forward diode Newton increments limit the global damping factor using `0.2*n + max(0, -present_diode_voltage)` volts. Backtracking accepts a sufficient reduction of the scaled merit function (`1e-4 * damping`) or an already acceptable residual. This is convergence assistance, not a replacement diode model.

**Choose an adequate timestep as well as valid bounds.** Tightening Newton tolerance does not resolve an undersampled waveform or remove integration error. Resolve the fastest time constants and source transitions, then halve the timestep and compare relevant voltages, currents, amplitudes, and phases. The tests below use `tau/200` for RC/RL, 800 steps/period for RLC, and three halved switch-case timesteps with an independent analytical reference. Their error tolerances apply to those workloads, not to every circuit.

### Resource Limits

| Layer | Enforced limit |
| --- | --- |
| Document collections | 200 components including ground; 1,000 wires; 1,000 junctions; 1,000 labels; 200 probes |
| Routing | 100 bends per wire; 10,000 total bends |
| Geometry | Coordinates in `[-100000, 100000]`; rotation in `[-360000, 360000]` degrees |
| Switch schedule | 1,000 sorted, distinct, nonnegative toggle times per component |
| Document settings | Positive duration and timestep; timestep <= duration; duration/timestep <= 100,000 |
| MNA size | 150 unknowns, **including capacitor current constraints during initialization** |
| Transient steps | At most 100,000 actual event-aligned steps |
| Result storage | At most 2,000,000 scalar values, including initial sample |
| Browser worker | 30 seconds per run; expiry terminates work without a partial capture |
| Browser JSON import | 5 MB (`5 * 1024 * 1024` bytes) |

For `N` nets including ground and `B` non-ground branches, each sample counts `N + B + 2` scalars (voltages, currents, time, iterations). The effective step limit is `min(100000, floor(2000000 / (N+B+2)) - 1)`. Extra event-aligned steps count against it. A document within the editing limits can still exceed the MNA or result-storage limit. These are resource bounds, not real-time performance promises. Extreme finite positive component values can still be ill-conditioned or overflow and are reported accordingly. The direct transient API additionally permits duration zero for an initialization-only sample; the document format requires a positive duration.

## JSON Documents

[`src/types.ts`](src/types.ts) defines the format; [`validateDocument`](src/model.ts) validates the entire input before returning an independent deep copy. Import commits only that validated copy, so a bad import leaves the previous document and revision intact. Layout, bend routing, labels, probes, settings, and optional JSON metadata survive validation/round trips. No label-based global nets or implicit geometric joins are added.

A minimal valid version-1 document, with no components yet, is:

```json
{
  "version": 1,
  "title": "Untitled circuit",
  "components": [],
  "wires": [],
  "junctions": [],
  "labels": [],
  "probes": [],
  "settings": {
    "duration": 0.01,
    "timestep": 0.00001,
    "tolerance": 1e-7,
    "initialization": "explicit"
  }
}
```

This is importable, not solvable until an electrically valid grounded circuit exists. All component records contain the full fields below, even fields inactive for their type; `createComponent` supplies defaults.

```ts
type Endpoint =
  | { kind: 'pin'; componentId: string; pin: 0 | 1 }
  | { kind: 'junction'; junctionId: string };

// Component type: resistor | capacitor | inductor | diode |
// voltage | current | switch | ground
type ComponentRecord = {
  id: string; type: string; x: number; y: number; rotation: number;
  value: number; initial: number;
  waveform: {
    type: 'dc' | 'sine' | 'pulse'; offset: number; amplitude: number;
    frequency: number; phase: number; delay: number;
    rise: number; fall: number; width: number; period: number;
  };
  diode: { is: number; n: number };
  switch: { ron: number; roff: number; closed: boolean; toggles: number[] };
};
// Wire:     { id, a: Endpoint, b: Endpoint, bends: { x, y }[] }
// Junction: { id, x, y }
// Label:    { id, name, anchor: Endpoint }
// V probe:  { id, name, color, kind: 'voltage', anchor: Endpoint }
// I probe:  { id, name, color, kind: 'current', componentId }
```

IDs must be globally unique across all collections, at most 80 characters, and contain only letters, digits, underscores, or hyphens; `__proto__`, `prototype`, and `constructor` are forbidden. All references must exist; ground pin `1` and current probes on ground are invalid. Titles allow up to 160 characters; label/probe names up to 80, nonempty and without control characters. Probe colors use six-digit hexadecimal strings, such as `#df704b`. Numeric JSON fields must be finite numbers, not engineering-format strings. Only version `1` is accepted; there is no automatic migration or missing-field repair.

Netlist construction in [`src/netlist.ts`](src/netlist.ts) uses deterministic union-find over referenced endpoints. Ground is `0`; other IDs are `n:` plus the encoded canonical endpoint representative. Display labels do not become net IDs. Branches are sorted by component ID and snapshot component parameters, so later document edits do not change an existing netlist.

### Solver Without the UI

Run this from the repository after installing dependencies; no React, DOM, worker, or external solver is needed:

```sh
node --import tsx --input-type=module -e '
import { examples } from "./src/examples.ts";
import { validateDocument } from "./src/model.ts";
import { buildNetlist } from "./src/netlist.ts";
import { solveDC, solveTransient } from "./src/solver.ts";
import { endpointKey, junction } from "./src/types.ts";
const doc = validateDocument(examples.find(e => e.id === "divider").create());
const net = buildNetlist(doc);
const dc = solveDC(net);
const tr = solveTransient(net, doc.settings);
console.log(JSON.stringify({
  outputV: dc.voltages[net.endpointNets[endpointKey(junction("JOUT"))]],
  sourceCurrentA: dc.currents.V1,
  steps: tr.steps,
  samples: tr.samples.length,
  finalTimeS: tr.samples.at(-1).time
}, null, 2));
'
```

Verified output: `{"outputV":5,"sourceCurrentA":-0.005,"steps":500,"samples":501,"finalTimeS":0.005}`. The API is synchronous and returns `Solution` records with `time`, `voltages`, `currents`, and `iterations`. `solveTransient` additionally returns `steps` and `elapsedMs` and accepts a monotonic progress callback from 0 to 1. Browser cancellation is accomplished by terminating the worker, not by interrupting a synchronous solver call.

## Built-In Examples

Each call to an example factory produces an independent complete document; these values are the defaults, not the modified test workloads below.

| Example | Circuit | Duration / maximum step | Initialization |
| --- | --- | --- | --- |
| Voltage divider | 10 V, two 1 kohm resistors; 5 V output; four-way explicitly joined VOUT crossing and a nonconnected crossing at `(460,400)` | 5 ms / 10 us | DC |
| RC step response | 5 V, 1 kohm, 1 uF, initial capacitor voltage 0 V; tau = 1 ms | 5 ms / 5 us | Explicit |
| RLC resonance | 1 V sine, 100 ohm, 10 mH, 1 uF; `f0 = 1591.5494309189535 Hz` | 6 ms / 1 us | Explicit |
| Half-wave rectifier | 5 V amplitude, 50 Hz sine; diode, 1 kohm load, editable 10 uF filter | 100 ms / 50 us | Explicit |
| Switched RC | 5 V, 1 kohm, 1 uF; initially open switch toggles at 1, 3, and 4 ms | 6 ms / 5 us | Explicit |

## Numerical Verification

Measured on **2026-09-06**, environment captured at **09:06:50.297 UTC** using `node:os`: **AMD Ryzen 7 5825U with Radeon Graphics**, 16 logical CPUs / available parallelism 16, 12,949,561,344 bytes reported RAM, Linux `7.0.0-31-generic`, x64, Node.js `v24.19.0`. These are local wall-clock observations, not real-time, browser frame-rate, or cross-machine performance claims.

`npm test` passed **31/31**, with **0 failures, cancellations, skips, or todos**. The 17 tests in [`tests/numerics.test.ts`](tests/numerics.test.ts) and nine in [`tests/solver-regressions.test.ts`](tests/solver-regressions.test.ts) print workload parameters and numerical diagnostics. Five tests in [`tests/editor.test.ts`](tests/editor.test.ts) additionally check atomic four-way junction insertion, routing, dependent-reference cleanup, direct-solver switch validation, field-unit matching, and import color validation. `atol` below means absolute error tolerance. The following numbers are recorded outputs, not promises of future performance.

### DC, Model, and Validation Checks

| Workload | Independent check / result |
| --- | --- |
| Parser and factories | Full-string SI parsing, invalid/nonfinite/underflow inputs, case-aware formatting; independent defaults, rotated pins, one-pin ground |
| 5 example round trips | Every object and optional nested metadata retained; clone mutations do not affect originals |
| 60 malformed mutations + 5 invalid roots | Atomic rejection of invalid IDs, references, values, waveforms, switches, and settings; signed/zero sources and signed storage states accepted |
| Document boundaries | Exactly 200 components and 1,000 wires accepted; 201 components or 1,001 wires rejected |
| Divider topology | Output 5 V within `1e-8 V`; moving/rotating/rerouting preserves nets; explicitly joining output to ground changes it to 0 V |
| 24 generated series/parallel graphs | Seed `0x5eed1234`; 2-6 series groups, 1-4 parallel resistors/group, `R = 50 + U*4950 ohm`, source magnitude `0.5 + U*19.5 V`, negative every third case; reduced-circuit voltages within `1e-8 V`, branch/source currents and KCL within `1e-10 A` |
| 12 generated non-series-parallel meshes | Seed `0xc1ac017`; 3-9 non-ground nodes, chain edges plus cross-edges accepted when `U <= 0.45`, `R = 100 + U*9900 ohm`; prescribed voltages `(U-0.5)*12 V` recovered using independent signed current injections; voltage/current/KCL tolerances as above |
| DC source/storage semantics | Sources `[0,-5,3.25] V`; capacitors open, inductors short, waveform/initial fields ignored by standalone DC |
| Waveform values | Delayed 50 Hz sine, offset -2, amplitude 3, phase 30 degrees, delay 10 ms; finite/instant pulse edges and current-source parity checked |
| 8 invalid physical systems | Missing ground, floating island, equal/conflicting parallel ideal sources, shorted source, conflicting capacitor/source ICs, conflicting parallel capacitor ICs, conflicting series inductor ICs all throw |

Both random graph generators use the deterministic recurrence `seed = (1664525*seed + 1013904223) mod 2^32`, `U = seed/2^32`. The exact draw order is in the test source. Solver boundary tests are listed separately below.

### RC and RL Exponentials

Four RC cases, seed `0xacc0123`, each run for `5*tau` with `dt=tau/200`, tolerance `1e-9`, explicit initialization, **1,000 steps / 1,001 samples**. Every sample is compared to `Vs + (Vinitial-Vs)*exp(-t/(R*C))`; allowed voltage error is `0.002*abs(Vs-Vinitial)`, with KCL `atol=1e-7 A`.

| R (ohm) | C (F) | Vs / initial (V) | tau (s) | Measured maximum error (V) |
| --- | --- | --- | --- | --- |
| 1000 | 0.000001 | 5 / 0 | 0.001 | 0.000003832087891897373 |
| 781.6112518776208 | 5.177638317458331e-7 | 5 / 0 | 0.00040469003670781444 | 0.000003832087893229641 |
| 1170.7760905846953 | 0.0000019728812024928626 | -3 / 2 | 0.0023098021414426264 | 0.000003832087890565106 |
| 1982.2636939119548 | 8.35177224036306e-7 | 0 / -1.5 | 0.00165554148918934 | 0.0000011496263675470075 |

The generated cases use `R = 300 + U*2700 ohm`, `C = (0.2 + U*2.8) uF`. A separate DC-initialized RC case stays at 5 V within `1e-7 V` despite an explicit `initial=-2 V`. The signed RL case uses 4 V, 400 ohm, 20 mH, initial current `-0.003 A`, `tau=0.00005 s`, duration `5*tau`, and `dt=tau/200`; every sample matches `0.01 - 0.013*exp(-t/tau) A` within `0.000026 A`, with KCL `atol=1e-7 A`.

### RLC Amplitude and Phase

The test changes the example resistance to **40 ohm**, retaining 10 mH, 1 uF, and a 1 V sine. Each frequency runs **26 periods**, **800 steps/period**, **20,801 samples**, tolerance `1e-9`: settle for 20 periods, then independently least-squares-fit capacitor voltage **and series current** over the final six (**4,801 samples**). References: `Hc(jw) = 1 / (1 - w^2*L*C + j*w*R*C)` and `I/Vs = 1 / (R + j*(w*L - 1/(w*C)))`. Both signals must meet **1% relative amplitude error and 1 degree absolute wrapped phase error**.

| f/f0; frequency (Hz) | Signal | Measured / reference amplitude (V or A) | Measured / reference phase (rad) |
| --- | --- | --- | --- |
| 0.5; 795.7747154594767 | V(C1) | 1.288316935046 / 1.288313252802 | -0.260604524723 / -0.260602391747 |
| 0.5 | I(R1) | 0.006441617788 / 0.006441566264 | 1.310191802072 / 1.310193935048 |
| 1; 1591.5494309189535 | V(C1) | 2.499987148117 / 2.5 | -1.570822028982 / -1.570796326795 |
| 1 | I(R1) | 0.024999999992 / 0.025 | -0.000025702186 / 0 |
| 2; 3183.098861837907 | V(C1) | 0.322074220515 / 0.322078313200 | -2.880992338030 / -2.880990261842 |
| 2 | I(R1) | 0.006441515433 / 0.006441566264 | -1.310195926088 / -1.310193935048 |

Across all six fits, maximum amplitude error was **0.001270711359%**, phase error **0.001472626836 degrees**. Maximum settled-sample deviation from the analytical sinusoid was **0.00006552793317282646 V** and **6.425546816610427e-7 A**. The table is rounded; test diagnostics print full precision and per-signal errors.

### Diodes and Rectification

Five DC load lines use an independent 100-iteration bisection reference (`atol=2e-5 V`) and independently calculated `VT = k*300/q = 0.025851999786435535 V`. Shockley/load-line acceptance is exactly **`abs(I-reference) <= 1e-10 A + 1e-6*max(abs(I),abs(reference))`**; KCL acceptance is **`abs(sum(signed incident currents)) <= 1e-10 A + 1e-6*sum(abs(incident currents))`**. These are verification thresholds, distinct from the solver's Newton tolerances. Normal orientation is anode at output, cathode at ground; reversed means the opposite.

| Source (V); R (ohm); Is (A); n; reversed | Output (V) | Diode current, pin 0 to 1 (A) |
| --- | --- | --- |
| 5; 1000; 1e-12; 1; no | 0.574191497955826 | 0.004425808502044163 |
| 2; 470; 2e-12; 1.4; no | 0.7600562936492921 | 0.002638178098618523 |
| -5; 2200; 1e-12; 1; no | -4.9999999978 | -1e-12 |
| 5; 1000; 1e-12; 1; yes | 4.999999999 | -1e-12 |
| -3; 1500; 5e-12; 1.2; yes | -0.6074411177577383 | 0.0015950392548281728 |

DC maxima were **1.6560754503847086e-12 A** Shockley residual, **1.6560867260873025e-12 A** load-line residual, **1.1275702593849246e-17 A** KCL residual, and **1.244182534776428e-11 V** bisection-reference error.

Half-wave tests use a 5 V amplitude, 50 Hz sine, default diode, 1 kohm load, **0.2 s / 50 us**, tolerance `1e-9`, **4,001 samples per case**. All four cases check **every sample** for Shockley and KCL residuals using the exact tolerances above; unfiltered cases also check the load line. An additional unfiltered case reverses electrical diode pins, not just drawing rotation. Its negative half-wave must mirror the forward trace shifted by half a period within `1e-7 V`, with the same current tolerance. In either unfiltered orientation, the blocked half-cycle output is within `1e-7 V` of zero when opposite-polarity input magnitude exceeds 0.1 V. Ripple is max minus min over the final period (`t >= 0.18 - 1e-12 s`).

| Filter C | Minimum (V) | Maximum (V) | Peak-to-peak ripple (V) |
| --- | --- | --- | --- |
| None | -9.999999999999999e-10 | 4.425808502044174 | 4.425808503044174 |
| 10 uF | 0.9529952897458237 | 4.42505910444355 | 3.472063814697726 |
| 47 uF | 3.06640742744471 | 4.417977102926191 | 1.3515696754814805 |

The reversed case has the same polarity-normalized extrema/ripple as the unfiltered row. Across all cases, maximum Shockley residual was **3.1237873399092564e-11 A**, unfiltered load-line residual **1.6561344309828918e-12 A**, and KCL residual **1.317522480004385e-15 A**. Reversed-trace mirror errors were **5.051514762044462e-14 V** and **5.0523821237824507e-17 A**.

All peaks must be between 4 and 5 V and minima above `-1e-5 V`; 10 uF ripple must be below 90% of unfiltered ripple, and 47 uF below 60% of the 10 uF result. This verifies rectification and smoothing under the implemented diode model, not breakdown or diode capacitance.

### Switching and Timestep Refinement

The switched-RC test uses 5 V, 1 kohm, 1 uF, `Ron=0.1 ohm`, `Roff=1e9 ohm`, duration 6 ms, tolerance `1e-9`, and **off-grid toggles at `[0.001037, 0.003083, 0.004119] s`**. Each timestep runs twice; sample arrays must match exactly, input data remain unchanged, times increase strictly, progress is monotonic from 0 to 1, and every event is present. Reference voltage is the piecewise exponential using `tau=(1000+Rswitch)*1e-6 s`, including finite off-state conduction.

| Maximum dt (s) | Actual steps / samples | Maximum voltage error (V) |
| --- | --- | --- |
| 0.00008 | 76 / 77 | 0.0009807240778041404 |
| 0.00004 | 152 / 153 | 0.000245246166839852 |
| 0.00002 | 302 / 303 | 0.00006130357160571975 |

Each halving must reduce maximum error below 80% of the previous value; fine-grid error must be below `0.06 V`. KCL is checked at every sample within `2e-7 A`; event-adjacent capacitor change must respect `5/((1000+Ron)*1e-6)*elapsed_time + 1e-7 V`. These checks test event handling and adequate-dt convergence, not merely finite output.

### Solver Regressions

The nine additional tests in `tests/solver-regressions.test.ts` use independent references and deterministic rejection checks. Default transient settings are 1 ms / 70 us, tolerance `1e-9`, explicit initialization; all-sample KCL uses `1e-10 A + 1e-6*sum(abs(incident currents))`.

| Test | Verified result |
| --- | --- |
| Pulse boundaries | Both source kinds, four zero/finite rise/fall combinations: 8 cases, 80 exact initial/repeated-corner/final boundaries, source/load `atol=1e-12`; strictly increasing sample times |
| Delayed sine | Both source kinds with 90-degree phase at zero, off-grid 123 us, and duration; explicit/DC initialization, every sample against an independent cosine reference; standalone DC still uses `value` |
| Off-grid RC source jumps | Voltage/current drive, edges at 123 and 456 us; no anticipatory charge, right-limit currents, repeatable samples; 16 samples/case, maximum exponential error `0.00045450772953636864 V` versus `0.001 V` allowance |
| Switch boundaries | Toggles at zero, 123 us, and duration use right-limit resistance; every current matches the resistive reference within `1e-12 A`; DC and input state unchanged |
| Parallel capacitors | 1/2 uF at consistent 2 V IC share currents 1:2 within `1e-10 A`; maximum 3 uF-equivalent exponential error `0.0000320745904920372 V` versus `5e-5 V` allowance; contradictory IC rejected |
| Series inductors | 10/20 mH at -10 mA IC follow the 5 V linear current ramp within `1e-10 A` and divide voltage 1:2 within `1e-9 V`; contradictory IC rejected by KCL |
| Ideal source/storage constraints | Voltage-source/capacitor and current-source/inductor duals recover sine and right-limit ramp derivatives; reject inconsistent `t=0` states and pulse impulses at `t=0.000123 s` |
| Nonconvergence | 100 V ideal forward diode drive throws in DC and after accepted transient steps; repeated errors match, progress never reaches completion, no successful partial result or input mutation |
| Resource boundaries | Exactly 100,000 steps, 2,000,000 stored scalars, 150 DC/transient unknowns, and 150 initialization unknowns accepted; six over-limit cases each reject identically twice before progress/sample allocation |

The six resource rejections cover one extra nominal step, an off-grid event splitting an otherwise full grid, excessive pulse cycles, one extra stored sample, 151 ordinary MNA unknowns, and 151 initialization unknowns including capacitor-current constraints. The exact storage-boundary case has 20 scalars/sample and 100,000 samples; the exact step-boundary case has 100,001 samples.

## Measured Benchmark

[`tests/benchmark.ts`](tests/benchmark.ts), run with `npm run benchmark` on the environment/date above, constructs a **connected 30-stage RC ladder**. Stage index `i=1..30`; a 5 V source drives node 0, each stage has a series resistor and grounded shunt resistor, and even stages have grounded capacitors initially at 0 V:

```text
Rseries(i) = 100 + (37*i mod 400) ohm
Rshunt(i)  = 1000 + (113*i mod 4000) ohm
C(even i) = (1 + i mod 5) uF
```

Exact workload: **77 components** (60 resistors, 15 capacitors, 1 voltage source, 1 ground), **152 wires, 32 nets including ground, 76 branches**, 32 ordinary MNA unknowns / 47 during initialization. Transient settings: **5 ms duration, 5 us maximum step, `1e-8` tolerance, explicit initialization**, yielding **1,000 actual steps, 1,001 samples**, and 110,110 stored scalars. Warmup is **1 DC + 1 transient**; measured work is **20 DC runs + 1 transient run**. Validation and netlist construction are each timed once before warmup.

| Measurement | Recorded milliseconds |
| --- | --- |
| Document validation | 2.234 |
| Netlist construction | 1.328 |
| 20 DC runs, total | 15.217 |
| DC median / min / max | 0.686 / 0.564 / 1.574 |
| Transient wall time | 299.459 |
| Solver-reported transient time | 299.452 |
| Transient wall time / actual step | 0.299 |

Timing output is rounded by the benchmark to three decimal places. Final ladder-node DC voltage was **0.0005870759847386636 V**. All stored transient voltages and currents were finite; the first sample was at zero and final sample at **0.005 s**. The benchmark checks connectivity, finite values, positive DC output below 5 V, and endpoints; it is not an independent analytical accuracy test of the ladder. Timings exclude UI rendering and worker messaging and do not establish real-time behavior, worst-case latency, or performance of nonlinear circuits. Re-run on the target hardware for current observations.

## Browser Verification

[`tests/browser.ts`](tests/browser.ts) passed **13/13 scenarios against the production bundle**, with **no console warnings/errors or page errors**. The earlier 11-scenario suite also passed repeatedly against the development server. It observes native worker requests, messages, termination, and the actual timeout registration without mocking computation, results, or timing. Desktop verification uses 1440x1000; the mobile case uses a 390x844 touch viewport.

| Scenario | Observed result |
| --- | --- |
| Construct from New | Place source, two resistors, and ground; route four pin-reference wires; add voltage/current probes without example labels. Actual DC and transient: **5 V / 5 mA**; 1,001 original samples, rendered paths and exact CSV verified |
| Edit, undo, redo | R1 from 1 kohm to 2 kohm gives **3.333 V / 3.333 mA**; undo restores 5 V / 5 mA, redo restores edited result. Stale readings hidden, CSV disabled until rerun |
| Drag and rotation | A 12-move drag commits one undo entry; redo restores it. Rotation moves pins visually but preserves wire/probe references and the 5 V / 5 mA solution |
| Copy and deletion | Unique, disconnected R3 copy inherits no wires/probes. Deleting connected R2 removes its dependent wires/voltage probe; undo restores valid references and solve |
| JSON round trip | Export, New, and real file-input import recover identical document, netlist, voltages, and currents |
| Wire reconnection | Change W2 endpoint A from R1:1 to R1:0: **10 V output, 0 A in R1, 10 mA in R2**; undo restores divider |
| Atomic invalid input | Dangling-pin JSON, negative resistance, and F/ohm unit mismatch rejected with unchanged exported document and revision; corrected workflow reruns successfully |
| Junctions and net highlighting | Inspect the exact shared netlist and highlight only VOUT wires. The J tool splits both crossing routes into four references; joining VIN to ground diagnoses an ideal-source conflict. One undo restores the original 5 V / 5 mA divider |
| Reset and initialization history | Reset rerun reproduces all 1,001 explicit-state RC samples exactly. Switching to operating-point initialization starts and remains at 5 V; one settings undo restores the zero-voltage initial state and original trace |
| Missing ground recovery | Native worker reports missing ground, no fabricated trace/CSV; undo and rerun recover on the same page without reload |
| RC waveform and scope | **0.005 s / 5 us**, 1,001 samples; final capacitor voltage **4.966310616 V**, maximum analytical voltage error **3.832087891897373e-6 V** (3.832 uV). Actual sample vertices, exact full CSV including hidden channels, cursor snapping/stepping, zoom, pan, wheel, and Fit verified |
| Stop and revision cancellation | Two ongoing **100,000-step** workers terminate without results: one through Stop, one through New while running. Subsequent DC and 1,001-sample transient use the current revision, without mixed captures |
| Mobile | Components/Inspector/Workbench panels and live RC capture usable at **390x844**; viewport, document, and body widths all **390 px**, controls within horizontal bounds |

CSV checks compare every parsed number exactly with the original worker sample, including timestamps and every probe, not just displayed precision or downsampled points. RC checks cover all voltage/current samples against exponentials (`20 uV` voltage and `20 nA` current allowances). The cancellation test observes the real **30,000 ms timer**, but **does not wait for its expiry**; automatic timeout expiry is therefore not an exercised browser scenario. These checks establish the listed interactions, not exhaustive cross-browser/device coverage. Screenshots at `/tmp/opencode/fieldwork-desktop.png`, `fieldwork-rc-transient.png`, and `fieldwork-mobile.png` are visual references, not numerical evidence.

## Model Limitations

The supported numerical scope is lumped R/C/L circuits, the stated memoryless diode, independent DC/sine/pulse sources, and scheduled finite switches. There are no parasitic models, transistor models, controlled sources, distributed transmission lines, arbitrary SPICE import, or external solver fallback. Ideal-source impulses and unrepresentable or nonunique physical states fail explicitly; there are no hidden corrections. Build, numerical tests, CLI example, benchmark, and the browser scenarios above passed; those results do not guarantee accuracy at arbitrary timesteps or real-time performance on every circuit.
