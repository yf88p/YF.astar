# Assets And Licenses

## Original Content

- **The Secret Life of a Forest**: original vector landscape, nested scientific illustrations, botanical field-journal stamp, and sample story prose, authored for this application. Source: `src/example.js`.
- The landscape consists of individual editable SVG paths, rectangles, ellipses, lines, and HTML text. The stamp is a self-contained SVG data URL in the project asset table.
- No stock photographs, third-party illustrations, remote icon URLs, external text API, or generated remote image service is used.
- The performance fixture's 280 raster swatches are generated locally by `tests/performance.mjs`, not downloaded images or screenshots of the whole canvas.
- These original sample illustrations, fixture drawings, and example prose are dedicated to the public domain under **CC0 1.0 Universal**. They may be edited, republished, or replaced without attribution. CC0 terms: <https://creativecommons.org/publicdomain/zero/1.0/legalcode>.

Imported user assets are not relicensed. Authors are responsible for having permission to publish their own images and text. The editor preserves original image data separately from crop and transform metadata.

## Typography

The application uses system fonts: Arial/Helvetica and Georgia/Times New Roman fallbacks. No font binaries are distributed or fetched. A viewer's exact fallback face depends on the fonts installed on its device.

## Dependencies

| Dependency | Purpose | License |
| --- | --- | --- |
| React / React DOM | Editor and portable viewer UI | MIT |
| Lucide React | Interface icons, not a complete canvas application | ISC |
| JSZip | Client-side portable ZIP creation | MIT option of MIT/GPL dual license |
| Vite | Local development and production bundling | MIT |
| esbuild | Self-contained portable viewer bundling | MIT |
| Playwright | Headless browser verification only | Apache-2.0 |

Exact installed versions are pinned by `package-lock.json`. Dependency license texts ship with their installed packages. Bundled runtime license notices are retained by the build tools. Links in this document are informational, not runtime dependencies.
