# Asset Provenance

No downloaded textures, models, fonts, audio files, or external asset services are used at runtime.

| Asset                                                                  | Source                                                                         | License                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Rooms, panels, portal frames, cubes, avatar, sensors, and goal beacons | Original procedural geometry in `src/render.js`                                | MIT, repository `LICENSE`                                   |
| Surface grain, panel seams, portal termination and glow shaders        | Original shader code in `src/render.js`                                        | MIT                                                         |
| Wall signage, cube face details, and markings                          | Original Canvas/geometry generation in `src/render.js`                         | MIT                                                         |
| UI logo, icons, connectivity diagrams, and layout                      | Original inline SVG and CSS in `src/main.js` and `src/style.css`               | MIT                                                         |
| Sound cues                                                             | Original Web Audio synthesis in `src/audio.js`                                 | MIT                                                         |
| Built-in puzzle documents                                              | Original data in `src/levels.js`                                               | MIT                                                         |
| Typography                                                             | Installed system Arial/Helvetica, Georgia/Times, and Courier/generic fallbacks | No font files redistributed; OS/browser font licenses apply |

## Libraries

- **Three.js** and its RoundedBoxGeometry, OrbitControls, and BufferGeometryUtils addons: MIT. Installed license: `node_modules/three/LICENSE`.
- **Vite**: MIT, development/build tooling. Installed license: `node_modules/vite/LICENSE.md`.
- **Playwright**: Apache-2.0, verification tooling only. Installed notices: `node_modules/playwright-core/LICENSE` and `NOTICE`.

Exact resolved dependencies and transitive tooling versions are recorded in `package-lock.json`. Their licenses remain with their respective packages. No complete portal game or external game implementation is embedded.
