# Asset Provenance

No external asset host is used at runtime.

| Asset                                             | Origin                                                                                                        | License                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Furniture geometry                                | Authored for Forma in `src/Scene3D.tsx`, generated from dimensions using Three.js primitives and merged parts | MIT, this repository                                         |
| Plants, cups, books, merchandise, coffee machine  | Authored procedural geometry in `src/Scene3D.tsx`                                                             | MIT, this repository                                         |
| Catalog thumbnails and example illustrations      | Authored inline SVG in `src/Plan.tsx` and layout/CSS in `src/App.tsx` / `src/styles.css`                      | MIT, this repository                                         |
| Wood, tile, terrazzo textures                     | Seeded canvas generation in `src/Scene3D.tsx`; no image inputs                                                | MIT, this repository                                         |
| Cafe, boutique, exhibition arrangements           | Original metric layouts in `src/examples.ts`                                                                  | MIT, this repository                                         |
| Catalog descriptions, sample prices, finish rates | Original fictional sample data in `src/catalog.ts`; no vendor feed                                            | MIT, this repository                                         |
| Interface icons                                   | `lucide-react` npm package                                                                                    | ISC; icon designs additionally derive from Feather under MIT |
| Geometry/rendering                                | `three` and its included OrbitControls, RoundedBoxGeometry, BufferGeometryUtils                               | MIT                                                          |
| Polygon boolean operations                        | `polygon-clipping`                                                                                            | MIT                                                          |
| UI framework                                      | `react`, `react-dom`                                                                                          | MIT                                                          |
| Build/test tooling                                | Vite, TypeScript, Vitest, Prettier, Playwright                                                                | Respective package licenses distributed in `node_modules`    |
| Fonts                                             | Local system stack: Inter if installed, Segoe UI/Arial for UI, Georgia/Times for editorial headings           | Provided by the host OS; no font files redistributed         |

The application license covers the original procedural asset source and generated assets. Dependency notices remain in their distributed npm packages. Exported project designs contain no proprietary third-party asset files.
