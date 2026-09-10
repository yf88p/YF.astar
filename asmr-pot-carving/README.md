# Still

A quiet, interactive 3D pottery studio. Built with Three.js, vanilla JavaScript, and the Web Audio API. No account, external API, or downloaded sound assets required.

## Start

```sh
npm install && npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Node.js 20.19+ or 22.12+ is required. After the initial install, `npm start` starts the complete app.

## At The Wheel

- Hold and drag on the clay to cut. Hold in one place while the wheel turns for continuous rings.
- Choose the loop, wooden rib, needle, or sponge. Shortcuts: `1`–`4`.
- Right-drag to orbit; scroll to zoom. On mobile, use two fingers to orbit and pinch.
- Adjust moisture, pressure, and wheel speed. Stylus pressure is supported.
- `Space` starts or stops the wheel; `Ctrl/Cmd+Z` undoes a stroke.
- Keyboard carving: focus the canvas, hold `Enter` to carve, and use the up/down arrows to move the tool.
- Enable sound explicitly. Headphones bring out the stereo-positioned scraping, wet friction, granular chips, and motor hum.
- Save named pieces to the local collection; reopen them for more carving or download their photographs.

## Simulation

The clay is a 37,120-sample cylindrical radial field rendered as a thick, open vessel. Cuts modify mesh vertices and normals, not a screen-space effect. Swept tool contacts remove volume based on contact time, pressure, moisture, motion, tool shape, and remaining wall thickness. The sponge removes raised edges without restoring lost clay. Material removal is tracked by integrating the cylindrical volume change.

The wheel accelerates and coasts with inertia and slows under tool resistance. Ejected clay inherits wheel velocity; chips fall, bounce, stick, and rotate with the wheel. Dry cutting creates more fine dust. Sound is synthesized from the same live contact parameters, with a conservative master limiter.

This is a responsive tactile approximation, not a finite-element clay or fluid solver: the radial representation cannot create undercuts or through-holes, and a minimum wall thickness prevents accidental collapse. The displayed removed mass is an illustrative studio-scale estimate.

Pieces are stored only in this browser's local storage, with a maximum of 12 pieces. Clearing site data removes the collection. There is no backend or cloud synchronization.

## Verification

```sh
npm test
npm run build
```

The application requires WebGL2 and a modern browser. Fonts and all runtime assets are bundled locally. Sound starts only after an explicit user gesture; the application remains usable without audio.
