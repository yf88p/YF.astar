# Aeronaut

A complete browser flight simulator built around the simple pleasure of flying. Explore the Emerald Coast, depart from its airport, practice a landing, or take a faster aircraft into the mountains.

## Start Flying

Requires **Node.js 20.19+** (or a newer supported LTS version) and a modern browser with **WebGL 2** and hardware acceleration enabled.

```bash
npm start
```

Open **http://localhost:5173** and select **Take to the sky**. This single command installs dependencies automatically on the first run and starts the server. The first installation needs internet access; the game itself has no remote asset, font, map, or API dependencies.

To play on a phone or tablet, connect it to the same network and open the network URL printed by the server. Landscape and portrait layouts are supported. If port 5173 is occupied, Vite prints the next available port. You can also choose a port with `npm start -- --port 8080`.

## The Experience

- **Three distinct aircraft:** the forgiving high-wing Trainer 172, the more powerful low-wing Tourer GT, and the lighter, responsive Sport S2. These are fictional aircraft with representative general-aviation specifications.
- **Four flights:** Coastal Discovery, Runway Departure, The Perfect Landing, and Above the Peaks.
- **A procedural 36 km coastal world:** mountains, islands, ocean, forests, a town, a harbor, and an airport with a 1,700 m runway, approach lights, taxiways, buildings, and an animated windsock.
- **Four weather presets:** clear and calm, golden hour, coastal breeze, and a challenging passing storm. Weather changes visibility, lighting, wind, turbulence, and the sea.
- **Three camera modes:** a horizon-stabilized chase camera, an interior cockpit with working gauges, and an orbit view.
- **Live instrumentation:** airspeed, altitude, height above terrain, artificial horizon, heading, vertical speed, load factor, RPM, throttle, flaps, and brakes. The moving map includes terrain, the airport, and your flight trail.
- **Engine and airflow audio:** synthesized locally using Web Audio, with a pulsing stall warning and cockpit filtering.
- **Complete flight lifecycle:** pause/resume, confirmed restart, takeoff guidance, crash recovery, landing results, and flight statistics.
- **Keyboard, mouse, touch, and standard gamepad inputs**, plus saved sensitivity, volume, graphics, pitch inversion, and rudder-assist preferences.

## Controls

| Action                             | Control                                          |
| ---------------------------------- | ------------------------------------------------ |
| Raise / lower nose                 | Down / Up arrow                                  |
| Bank left / right                  | Left / Right arrow, or A / D                     |
| Increase / decrease throttle       | Hold W / S, + / -, or use the throttle slider    |
| Rudder left / right                | Q / E                                            |
| Cycle flaps: 0, 10, 20, 30 degrees | F or the FLAPS button                            |
| Wheel brakes                       | Hold B; the BRAKES button toggles a brake latch  |
| Change camera                      | C                                                |
| Look around                        | Right-drag; release to recenter in chase/cockpit |
| Orbit the aircraft                 | Left-drag in Orbit view, with Mouse Pilot off    |
| Camera distance                    | Mouse wheel in chase/orbit                       |
| Pause / resume                     | Escape                                           |
| Restart confirmation               | R, then select Restart Flight                    |
| Flight guide and preferences       | ? or Flight Guide                                |
| Hide / show instruments            | H or Clean View                                  |
| Toggle sound                       | M or the speaker button                          |

**Mouse:** enable Mouse Pilot, then hold and drag anywhere in the sky. Drag right to bank right and pull down to climb. Release to center the controls. This does not require pointer lock.

**Touch:** drag the circular joystick for pitch and roll. Pull toward you to raise the nose. Use the rudder buttons and the throttle slider. The controls remain available on wider tablets and landscape phones.

**Gamepad:** a standard-mapped controller uses the left stick for pitch/roll, right stick up/down to increase/decrease throttle, and left/right triggers for rudder. Click Take to the Sky or press a controller button once so the browser can recognize the controller.

Automatic rudder coordination is on by default. It helps coordinate turns; it does **not** hold altitude, prevent stalls, or fly the plane for you. Turn it off for manual control. Pitch inversion affects mouse, touch, and gamepad inputs, not the labeled keyboard controls.

## Your First Flight

Choose **Trainer 172**, **Coastal Discovery**, and **Clear & Calm**. You begin airborne in a settled cruise. Use short, gentle arrow-key inputs; holding a control continuously will continue changing the aircraft's attitude.

To turn, bank gently and add a little back pressure to maintain altitude. Use the opposite roll input to level the wings. If a stall warning appears, lower the nose, add power, and give the wing time to recover.

### Takeoff

1. Choose Runway Departure and advance throttle to 100%.
2. Use the rudder to remain on the centerline.
3. In the trainer, at approximately 60 knots, gently raise the nose.
4. Climb at approximately 75-85 knots. Reduce power after reaching a comfortable altitude.

### Landing

The Perfect Landing starts on a stabilized approximately 3-degree approach to runway 36, with flaps at 20 degrees and aircraft-specific power and airspeed. Use approximately **65-75 knots in the trainer**, or **80-90 knots in the tourer and sport**.

1. Keep the runway centerline aligned and make small corrections for wind.
2. Use pitch and power together to maintain your approach speed and descent.
3. Just above the runway, gently raise the nose to reduce the descent rate and bring the throttle to idle.
4. Keep the wings level during touchdown, then hold B to brake.
5. Stop safely on the runway to see your landing results.

You can also land after any free flight. Trees and buildings are visual scenery; terrain, runway, and water impacts determine aircraft contact and crashes.

## Flight Model

The simulation uses SI units internally and runs at a fixed **120 Hz**, independent of the rendering frame rate. Display instruments use conventional aviation units. The aircraft is a rigid body with position, velocity, quaternion attitude, body-axis angular velocity, mass, and principal inertias.

- Gravity and force-based acceleration, without artificial altitude or speed holding.
- ISA air density changes with altitude; wind-relative velocity is distinct from ground velocity.
- Lift from dynamic pressure, wing area, angle of attack, and flap configuration: `L = 0.5 * rho * V^2 * S * CL`.
- Parasitic and induced drag, flap drag, and a soft post-stall lift/drag curve.
- Finite-power propeller thrust with an actuator-disk static-thrust limit and engine spool response.
- Aerodynamic moments, pressure-dependent control authority, body-rate damping, sideslip stability, and rigid-body gyroscopic coupling.
- Banked turns through redirected lift, rather than directly changing heading.
- Flap deployment time, ground effect, rudder propwash, wheel support, rolling resistance, lateral tire friction, and braking.
- Terrain collision heights interpolated from the **same triangles actually rendered**, avoiding invisible mountain collisions.
- Impact checks for sink rate, lateral speed, bank/pitch attitude, rough terrain, and water.

This is a **recreational simulator, not a certified flight-training device**. The model uses representative aerodynamic coefficients, not manufacturer flight-test data or computational fluid dynamics. It does not simulate fuel consumption, changing mass/center of gravity, individual wheel suspension, structural failure, detailed engine systems, compressibility, icing, Earth curvature, or live weather. The procedural world is fictional, including its displayed location label.

## Development

Built with **Three.js**, **Vite**, vanilla JavaScript, Canvas 2D instrumentation, and Web Audio. Fonts are bundled locally through Fontsource. Models, terrain, surface textures, sky, ocean, and scenery are generated in code.

```bash
npm test              # Physics and exact terrain-collision regression tests
npm run build        # Production build in dist/
npm run preview      # Serve the production build
```

For reproducible headless Chromium integration tests:

```bash
npx playwright install chromium
npm run test:browser
```

The browser suite starts its own server on port 5174 and checks flight setup, saved preferences, keyboard/mouse inputs, camera changes, pause/restart, an actual runway takeoff, crash recovery, alternate aircraft, storm conditions, and phone/tablet controls. It also rejects browser runtime and shader errors. On minimal Linux systems, Playwright may require its documented browser system dependencies.

### Project Layout

| File                 | Responsibility                                             |
| -------------------- | ---------------------------------------------------------- |
| `src/main.js`        | Game lifecycle, inputs, cameras, flight guidance, and UI   |
| `src/physics.js`     | Aircraft configurations and flight dynamics                |
| `src/terrain.js`     | Terrain mesh, exact collision sampling, and surface detail |
| `src/world.js`       | Scenery, atmosphere, aircraft models, and cockpit gauges   |
| `src/instruments.js` | Artificial horizon and navigation map                      |
| `src/audio.js`       | Synthesized engine, airflow, and warnings                  |
| `src/style.css`      | Responsive flight planner and flight deck                  |
| `scripts/start.mjs`  | Single-command installation and launcher                   |

If frame rate is low, choose **Flight Guide > Your Preferences > Graphics Quality > Performance**. Fullscreen is available in the same panel where supported. Switching tabs or losing browser focus pauses an active flight automatically.
