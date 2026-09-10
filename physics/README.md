# Orbital

A tactile, browser-based physics playground. Move a transparent glass sphere and watch a collection of procedural marbles react to its motion.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

```sh
npm run build
npm run preview
npm test
```

## Play

Drag the glass sphere with a mouse, pen, or touch. Give it a swirl for a burst of motion. Open **Tune** to change gravity, restitution, or the number of marbles. The reset button restores the original scene and physics settings. Sound is off by default; the speaker button enables synthesized glass impacts.

Keyboard: Tab to the 3D playground, use arrow keys to move the sphere, and Space to swirl. All controls are keyboard accessible. Escape closes the settings panel while it has focus.

## Implementation

- React and TypeScript with Vite.
- Three.js with physical glass, procedural marble textures, a generated studio environment, directional shadows, and a soft contact shadow.
- A custom three-dimensional impulse solver: adaptive substeps, a translating spherical boundary, mass-weighted pair collisions, contact friction, rotational inertia, restitution, and gravity. Particle positions are in world space so shell motion does not artificially lock them in place.
- Web Audio synthesizes short, stereo-panned resonances. No audio assets or accounts are needed.
- Pointer capture keeps dragging responsive beyond the sphere. Render resolution is bounded and simulation pauses in background tabs. WebGL context loss is handled.

All visual assets are generated locally, and typography uses system fonts. No external font, image, HDR, model, or sound requests are needed.

### Files

`src/App.tsx` owns interface state and controls. `src/scene.ts` owns rendering and input. `src/physics.ts` is the independent physics world. `src/audio.ts` synthesizes impacts. `src/physics.test.ts` exercises numerical behavior without WebGL.
