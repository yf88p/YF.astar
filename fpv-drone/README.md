# Fieldwork FPV

A browser-based FPV practice space with procedural scenery, Angle/Acro modes, keyboard/touch/controller
input, and fixed-step six-degree-of-freedom dynamics. Practice without risking an aircraft.

**This is an uncalibrated training model, not a simulation of all physics laws, a calibrated digital
twin, or Betaflight firmware. It cannot certify real-world flying readiness.**

## Setup
Use current Node.js LTS, npm, and a WebGL-capable browser, preferably with hardware acceleration.
Run from the project directory:

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. Vite binds to `0.0.0.0`; the server may be reachable on your local network.

For a production build and local preview:

```sh
npm run build
npm run preview
```

The build checks TypeScript and writes `dist/` for static hosting. Preview normally uses
**http://localhost:4173**; check the terminal if a port is occupied. Keep the local server running.

## Tests
```sh
npm test
npx playwright install chromium
npm run test:e2e
```

The suite has **38 Vitest physics cases**: gravity/hover, motor lag/mixing, control signs,
Angle/Acro behavior, contacts/crashes, battery estimates, reset, convergence, and determinism.
Four Playwright tests cover keyboard flight, pause/resume/reset/logging, rapid rearming, accessible
settings and persistence, environment changes, mobile layout/throttle, simulated radio interlocks,
controller/focus loss, and graphics-context failure. Browser coverage is not exhaustive.
It starts/reuses the port 5173 dev server and uses software-rendered Chromium. These tests do not
constitute formal calibration or hardware-controller testing.

## First Flight
1. Choose **Open Range**, **Angle** mode, and zero or low wind. The default wind is 1.5 m/s.
2. Click **Arm & fly** or press `Space`. Arming starts with zero commanded throttle and selects FPV.
3. Press `H` for estimated level-hover thrust, then add a little throttle with `ArrowUp` to climb.
4. Use small pitch/roll/yaw inputs. Tilting redirects thrust, so turns usually need extra throttle.
5. Reduce throttle gradually to land. `Space` cuts motors, `P` pauses, and `R` returns to the pad.

Angle self-levels without position/altitude hold. Acro commands body rates; centered sticks request zero
rotation, not level attitude. A USB radio is recommended; keyboard/touch input is less precise.

## Controls
### Keyboard And Mouse
| Input | Action | Notes |
| --- | --- | --- |
| `W` / `S` | Pitch forward / backward | Nose down / up; not direct forward/backward velocity. |
| `A` / `D` | Roll left / right | Lean left / right. |
| `Q` / `E` | Yaw left / right | Turn the nose. |
| `ArrowUp` / `ArrowDown` | Increase / decrease throttle | Latching: release holds the current value; about 24 percentage points/s. |
| `H` | Set estimated hover thrust | About 29%; neither altitude hold nor automatic braking. |
| `Space` | Arm / disarm | After a crash, resets instead; press again to arm. |
| `P` | Pause / resume | Freezes physics and simulated flight time. |
| `Esc` | Pause a flying aircraft | Use `P` or Resume to continue; closes an open dialog instead. |
| `R` | Reset flight | Stops motion, disarms, restores battery, returns to launch pad and Orbit view. |
| `V` | Cycle camera | FPV, Chase, Orbit. |
| `?` (`Shift` + `/`) | Open pilot guide | Includes controls and model explanations. |
| Drag / scroll | Orbit / zoom | Orbit camera only; right-drag pans. |

Shortcuts leave inputs/selects and dialogs alone. On a focused button, `Space` activates that button.

### Touch
Responsive touch controls appear below the viewport at widths up to 800 px: pitch/roll pad, yaw buttons,
latching throttle slider, and **Hover thrust** (`H`). Releasing/canceling a gesture centers that axis,
not throttle. On-screen arm, pause, reset, camera, and settings controls remain available.

### USB Controllers
Connect a controller and press a button to expose it to the browser, then select its profile in
**Flight settings > Controller**. The first connected Gamepad API device is used; axes have a 6%
center deadzone followed by expo (excluding throttle).

| Profile | Mapping |
| --- | --- |
| Standard gamepad | Left stick horizontal: yaw. Right stick horizontal: roll; up/down: forward/back pitch. |
| Standard gamepad throttle | `RT` increases, `LT` decreases; latching at about 35 percentage points/s. Releasing triggers does not cut thrust. |
| USB radio, AETR | Axis 0: roll; axis 1: pitch (up = forward); axis 2: throttle; axis 3: yaw. |
| USB radio throttle | Absolute axis: `-1` = full throttle, `+1` = low; `(1 - axis2) / 2`. |
| Arm / disarm | Keyboard `Space` or the on-screen button; no controller button binding. |

**Radio safety:** move throttle fully low after every arm and reconnect to unlock radio thrust input.
The check requires less than 5% throttle; a high stick must not bypass it. Configure AETR, endpoints,
and reversals in radio firmware; there is no in-app calibration/remapping wizard. Verify directions.
Keyboard remains available; avoid mixed inputs initially. Physical controllers have not been
hardware-tested, and browser/OS mappings and latency vary.

## Environments
| Site | Practice |
| --- | --- |
| **The Yard** (`yard`, nominal 180 x 180 m) | Industrial apron, containers, barriers, silos, and a hangar with an open loading bay; three gates. |
| **Open Range** (`meadow`, nominal 300 x 300 m) | Open alpine-style meadow for hovering, turns, and early Acro practice; three gates. |
| **The Circuit** (`circuit`, nominal 180 x 180 m) | Eight-gate practice loop for repeatable lines and precision. |

Sites are seeded/static, not measured locations; sizes are descriptive, not terrain bounds. Changing
environment or quality ends/resets flight and rebuilds the scene; mode, wind, and other settings carry over.

## Physics Model
Dynamics advance at fixed **240 Hz** (`1/240 s`) in SI units: m, s, kg, N, N*m, kg*m^2, radians, A, V;
charge uses mAh. World `+y` is up. Body axes: `+x` right, `+y` up, `-z` forward. Quaternion `q` maps
body to world; angular velocity is body-frame rad/s. Positive pitch/yaw/roll means nose down/right/right lean.

Away from contacts, with rotation matrix `R(q)`, principal inertia `I`, and drag coefficients `c1/c2/d1/d2`:

```text
v_air = v - wind
m * dv/dt = R(q) * (0, sum(F_i), 0) + (0, -m*g, 0) - c1*v_air - c2*|v_air|*v_air
I * d(omega)/dt = tau_motor - omega x (I*omega) - (d1 + d2*|omega|)*omega
dq/dt = 0.5 * q * quaternion(0, omega)
F_i = maxThrustPerMotor * u_i
u_i(next) = u_i + (target_i - u_i) * (1 - exp(-dt / motorTimeConstant))
```

Rotation uses midpoint integration and normalized quaternion increments; translation updates velocity
then position, with exact isolated drag decay. Gyroscopic coupling is rigid-body, not detailed rotor physics.

- **Rate control:** bounded PD, with filtered derivative on measured rate and no integral term. Angle adds a heading-relative tilt controller; Acro directly requests body rates.
- **Motor mixing:** X layout, front-left/front-right/rear-right/rear-left, alternating yaw reaction signs. Differential thrust creates pitch/roll torque through the arms and yaw through reaction torque.
- **Saturation:** differential commands are scaled to fit `[0, 1]`; collective may decrease at full throttle to retain steering. No hidden lift is added at zero throttle.
- **Response:** four independent first-order motor lags; outputs represent normalized thrust, not RPM or calibrated ESC commands. Disarming bypasses lag and immediately cuts thrust.
- **Contacts:** a 0.18 m-radius sphere against the flat `y=0` ground and axis-aligned obstacle boxes, with penetration correction, restitution, friction, and approximate angular damping. Movement subdivisions reduce tunneling.

| Default vehicle assumption | Value |
| --- | --- |
| Generic FW-5 freestyle quad | 650 g; nominal 5-inch class, 0.17 m center-to-motor arm |
| Principal inertia `(x, y, z)` | `(0.003, 0.005, 0.003)` kg*m^2 |
| Gravity / maximum static thrust | 9.81 m/s^2 / 4 x 5.5 N = 22 N; about 3.45:1 thrust-to-weight |
| Motor time constant | 35 ms |
| Battery estimate | 4S LiPo, 1500 mAh; fresh reset voltage 16.8 V |
| Level-hover estimate | `m*g / 22 = 0.290`, about 29% with settled motors |
| Crash threshold | Normal impact speed strictly greater than 6 m/s; disarms and requires reset |

`DEFAULT_CONFIG` contains assumptions, not measurements. App defaults: 480 deg/s pitch/roll, 65% of
that for yaw, 0.35 expo; Angle tilt is capped at 0.85 rad (about 49 degrees). Physics altitude is center
height; the UI subtracts 0.18 m for flat-ground clearance, not clearance above roofs/decorative terrain.

## Realism Limits
- No propwash, ground effect, blade-element aerodynamics, rotor wake interaction, or calibrated RPM/thrust curves. Motor lag is a simplified response model.
- No voltage-sag-dependent thrust response. Battery current, charge, and displayed load sag are illustrative estimates; depletion causes neither thrust reduction nor a low-voltage cutoff.
- No RF/video-link simulation, turbulent gusts, thermals, structural damage, broken propellers, or deformable obstacles. A crash flag is not a damage model.
- Collision geometry is not the visual mesh: no individual arm/prop contacts, foliage collision, or complete collision coverage for scenery outside the practice site. Even round silos use boxes; mountains are decorative.
- Ground physics remains flat everywhere. Visual weather, lighting, and location are illustrative; the constant **18 C** display is not linked to air density, thrust, or thermal physics. Wind is a uniform configurable horizontal vector, not local flow around buildings.
- Scenery shadows are baked once at scene build rather than recalculated every frame. The aircraft visual has no dynamically updated shadow; shadows do not affect flight physics.
- No formal calibration against flight logs, thrust stands, a particular frame, or Betaflight behavior. Passing analytical/regression tests does not establish real-aircraft fidelity.

## Safety And Performance
Focus/tab loss or active-controller loss/replacement automatically pauses flight. Dialogs also pause;
closing one does not resume. Pause freezes physics/time but does not disarm. Check inputs before resuming.
Reset clears motion, throttle, crash state, counters, and battery usage, returning disarmed to the pad.
Disarm alone cuts motors but preserves momentum/gravity. WebGL context loss disarms and requires reload.

The render loop caps elapsed time at **0.05 s/frame**. Below about **20 FPS**, simulation time slows
to keep fixed physics steps stable instead of catching up indefinitely. The physics API itself subdivides
larger timesteps without dropping elapsed time; only the browser loop caps it. Flight time is simulated armed time.
**Balanced** reduces foliage, shadow resolution, and pixel density. Software rendering, including
headless Chromium, can be slow; enable GPU acceleration for interactive practice.

Real flight needs instruction, a safe site, low wind, a spotter where required, and compliance with local
rules. Verify actual aircraft setup separately; simulator success is not a real-world safety check.

## Data And Architecture
React/TypeScript/Vite/Three.js were chosen for a browser-only app without a backend. Scene assets,
illustrations, and audio are procedural/source-defined, with no binary scene downloads. These scope
and configuration assumptions were selected without clarification questions, not derived from hardware.

Google Fonts optionally requests DM Sans/IBM Plex Mono; local font fallbacks work without internet.
After dependency installation the app otherwise works offline while served locally, not as a cached PWA.
Settings and the latest **50 flights** use browser `localStorage`, with no account/server sync. Flights
of at least one simulated second save on disarm/reset/crash. Logs support JSON export and confirmed
clearing; clearing browser data removes them. Unavailable storage means session-only history. Audio starts off.

- `src/App.tsx`: flight lifecycle, settings, HUD, dialogs, responsive touch controls, and local flight log.
- `src/components/Simulator.tsx`: input polling, controller safety, fixed-step loop, cameras, audio, telemetry, and WebGL lifecycle.
- `src/sim/physics.ts`: rigid-body state, controller/mixer, motor dynamics, contacts, and illustrative battery telemetry.
- `src/sim/world.ts`: seeded environment geometry/textures, collider boxes, gates, lighting, aircraft visual, and resource disposal.
- `src/styles.css` and `src/main.tsx`: responsive presentation and React entry point.
- `src/sim/physics.test.ts`, `e2e/simulator.spec.ts`, `playwright.config.ts`: unit and browser regression coverage.
