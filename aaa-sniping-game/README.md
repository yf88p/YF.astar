# Silent Ridge

A playable Three.js sniper vertical slice set at an isolated alpine relay station. Take an overwatch position, locate five patrols, and silence the relay before its five-minute uplink window closes.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. It uses the next available port if 5173 is occupied. The game needs WebGL 2 and works best with hardware acceleration enabled.

```sh
npm run build
npm run preview
```

All models, environment textures, sound effects, and sky rendering are procedural. Fonts are bundled locally. There are no runtime requests to external asset services.

## Controls

| Action | Desktop |
| --- | --- |
| Look | Mouse, or arrow keys |
| Fire | Left mouse button or Space |
| Toggle scope | Right mouse button or Q |
| Adjust magnification | Mouse wheel, 4x to 12x |
| Steady aim | Hold Shift |
| Reload | R |
| Adjust perch position | A / D |
| Toggle target tags | E |
| Pause | Escape, P, or the pause button |

On touch devices, drag the scene to look and use the Scope, Steady, Reload, and Fire buttons. Steady is a hold action. Browsers without pointer lock fall back to drag-to-look and click-to-fire.

## Included

- Snowy mountain ranges, branch-based conifers, weathered buildings, antenna structures, satellite dishes, drifting snow, and practical lighting.
- Detailed camera-attached bolt-action rifle, animated reload, recoil, and articulated patrols with head/body hit zones.
- Projectile travel, gravity, 100 m zero, wind drift, and synchronized collision substeps with BVH-accelerated environment raycasts.
- Breath stamina, five-round magazines, finite reserve ammunition, shot scoring, a mission deadline, pause/resume, success/failure debriefs, and replay.
- Procedural wind, rifle report, mechanical sounds, distant echoes, and hit confirmation using Web Audio.
- Responsive menus, mobile controls, fullscreen and sound controls, locally bundled typography, bloom, tone mapping, and subtle film grain.

## Verification

```sh
npm test
```

Seven unit tests cover projectile integration, zeroing, scoring, patrol bounds, headshots, reset behavior, and frozen reload poses.

With the development server running and Chromium installed:

```sh
GAME_URL=http://127.0.0.1:5173 CHROME_PATH=/usr/bin/chromium npm run test:browser
```

The browser regression checks briefing, scope, breath, fire, reload, pause/resume, headshots, final-round victory, restart, and deadline failure. It uses development-only diagnostics to establish deterministic target fixtures; those hooks are excluded from production builds.

## Scope

This is a polished, single-mission browser prototype, not a full commercial AAA game. Assets and fall animations are procedural rather than scanned, motion-captured, or physically simulated ragdolls. Patrols are scripted rather than combat AI. Rendering quality and frame rate depend on the device; headless browser tests use software rendering and are not representative GPU performance benchmarks.

Vite reports an advisory for the Three.js core chunk exceeding 500 kB uncompressed. It is split from the game, collision, and effects chunks and is approximately 150 kB gzipped.
