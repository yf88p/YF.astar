# Deadset

A first-person browser aim trainer built with React, Three.js, and Vite. No account, backend, or downloaded game assets required.

## Run

```sh
npm install
npm run dev
```

## Production

```sh
npm run build
npm run preview
```

Deploy the generated `dist/` directory to any static hosting service. WebGL and hardware acceleration are required for the arena. Serve over HTTPS or localhost for pointer-lock support; drag aiming is available if pointer lock is unavailable.

## Training

- **Gridshot:** Hit three replenishing targets to train speed and rhythm.
- **Microflick:** Make precise adjustments to hit smaller, closely spaced targets.
- **Tracking:** Hold fire and stay on a moving target for consistent scoring ticks.
- Choose 30-, 60-, or 90-second sessions, or play all three drills as a daily routine.
- Adjust sensitivity, target size, crosshair, sound, and session length in Settings.
- Completed sessions, statistics, and preferences are saved in this browser's local storage. Private browsing or clearing site data may remove progress.

## Controls

| Action  | Desktop                                     | Touch                           |
| ------- | ------------------------------------------- | ------------------------------- |
| Aim     | Move mouse; drag if pointer lock is blocked | Drag the range                  |
| Shoot   | Left click or Space                         | Fire button or tap range        |
| Track   | Hold left click or Space                    | Hold fire button                |
| Move    | WASD                                        | On-screen joystick              |
| Pause   | Escape or pause button                      | Pause button                    |
| Restart | R or Start fresh in pause menu              | Start fresh in pause menu       |
| Leave   | Exit button or Back to training             | Exit button or Back to training |

Leaving or restarting a session discards that unfinished attempt. Completed sessions are saved automatically. Personal bests on drill cards are compared within the selected session duration.
