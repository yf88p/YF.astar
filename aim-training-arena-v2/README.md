# Deadeye

A complete first-person browser aim trainer built with TypeScript, Three.js, and Vite. The arena, targets, weapon, effects, and audio are generated locally. No accounts, API keys, or external asset services are required.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the URL printed by Vite. To create and serve the production build:

```sh
npm run build
npm run preview
```

## Train

- **Gridshot:** hit replenishing targets to build speed and combos.
- **Precision:** line up smaller targets for accuracy practice.
- **Tracking:** hold fire and follow a moving target.
- Choose a 30, 60, or 120-second session, difficulty, mouse sensitivity, and crosshair.
- Use **WASD** to move, **mouse** to aim, and **left click** to fire. Hold **Shift** to move faster.
- **Escape** pauses and releases the cursor. **F** expands the arena, **M** toggles sound, and **?** opens help.
- On touch screens, drag to aim and tap to shoot. Hold the on-screen fire button for Tracking. Two-finger aiming and firing are supported.
- If pointer lock is unavailable, drag to aim and click to fire.

Completed sessions and preferences are stored in your browser. Statistics, personal records filtered by mode/duration/difficulty, daily activity, and CSV export use real completed sessions. The latest 100 sessions are retained. Ending an unfinished session does not save a result.

## Verify

```sh
npx playwright install chromium
npm test
```

Tests run in headless Chromium and start an isolated Vite server on port 5190. They cover rendering, persisted settings, responsive layouts, target hits, accuracy, all training modes, touch input, pause/resume, completed results, and statistics. Screenshots are written to `test-results/`.

To use an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path before running the tests.

WebGL and hardware acceleration are recommended. A clear recovery message is shown if WebGL cannot initialize.
