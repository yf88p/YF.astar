# Asset And Dependency Provenance

Forma contains no externally sourced city, vehicle, vegetation, terrain, image, map, or lighting assets. Geometry and illustrations are original procedural assets covered by the repository MIT license. Browser/system fonts are used, not redistributed. No external asset requests are made during editing or export.

## Runtime

| Package | Purpose | License / upstream |
| --- | --- | --- |
| Three.js | WebGL rendering, scene geometry, OrbitControls, GLTFExporter/GLTFLoader | MIT, copyright Three.js authors, https://github.com/mrdoob/three |
| Lucide | UI line icons | ISC, copyright Lucide contributors; derived Feather icons retain their MIT notice, https://github.com/lucide-icons/lucide |

## Build And Verification

| Package | Purpose | License |
| --- | --- | --- |
| Vite | Local development server and bundler | MIT |
| TypeScript | Static type checking | Apache-2.0 |
| tsx | Local TypeScript test runner | MIT |
| Playwright | Local browser workflow verification | Apache-2.0 |
| @types/node, @types/three | Type declarations | MIT |

The exact installed dependency graph and versions are recorded in `package-lock.json`. Full upstream notices are retained in the respective installed packages. Chromium is installed separately only for browser verification and is subject to its own included licenses. None of these dependencies embeds a complete city-building application.
