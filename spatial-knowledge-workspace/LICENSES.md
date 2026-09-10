# Licenses And Provenance

## Original Project Material

Margin's application-specific code, original visual layout, CSS mark/linework, and the 32-document **The Common Ground** fictional workspace were created for this implementation. They do not embed another knowledge-workspace application. The sample's people, sites, observations, timings, design proposals, and quotations are fictional; no real-world source or participant is claimed.

The original application code and sample content are provided under the MIT license in [LICENSE](LICENSE). Imported user documents and assets remain the user's material; importing/exporting them does not change their license or ownership.

The performance corpus is a labeled synthetic expansion of the original seed, with distinct research identifiers and remapped real references. Browser-test raster images are generated from original simple geometric artwork in `tests/browser-fixtures.js`. No stock photography, external image service, or remotely loaded decorative asset is used.

## Bundled Assets

| Asset | Source | License |
| --- | --- | --- |
| DM Sans variable font, normal Latin/Latin Extended WOFF2 | `@fontsource-variable/dm-sans`, DM Sans Project Authors / Google Fonts | SIL Open Font License 1.1; full notice in `public/licenses/DM-Sans-OFL.txt`, also shipped in production output |
| Interface line icons | `lucide-react` / Lucide contributors | ISC; retained license in the installed package and `public/licenses/Lucide-ISC.txt` |
| Serif document type | Local Georgia or Times New Roman when available, generic serif fallback | System font, not redistributed |
| Monospace code type | Local platform fonts / generic monospace | System font, not redistributed |
| Margin radial wordmark ornament | Original CSS geometry | MIT |

All required font and icon bytes are served locally by Vite or the production build. There are no runtime font CDN requests. The DM Sans font files are unmodified; bundling them does not change their OFL license.

## Software Dependencies

Exact installed versions are recorded in `package-lock.json`. Their original notices are retained in `node_modules` after installation.

| Dependency | Use | License |
| --- | --- | --- |
| React / React DOM | Interface rendering | MIT; notice also bundled in `public/licenses/React-MIT.txt` |
| Vite | Local server and production bundling | MIT |
| `@vitejs/plugin-react` | React build integration | MIT |
| Lucide React | Icons | ISC |
| `@fontsource-variable/dm-sans` | Local font package | SIL OFL 1.1 (font), MIT packaging where applicable |
| Playwright / `@playwright/test` | Headless browser verification, not a runtime service | Apache-2.0 |
| esbuild | Build pipeline | MIT |
| Rollup | Build pipeline | MIT |

Chromium is installed by Playwright solely for verification; its third-party notices accompany the Playwright browser distribution. No browser binary is embedded in the application package. The app does not require downloading Playwright's browser to run normal user workflows.
