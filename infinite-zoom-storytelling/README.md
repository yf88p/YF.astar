# Folia

**A little closer, a whole new world.**

Folia is a local-first visual storytelling studio. Arrange editable objects in nested spatial scenes, choreograph a camera journey, add choices, and publish an independent interactive viewer. The editor and viewer use the same document and geometry engine. Nothing is a recorded slideshow or a separate full-screen scene route.

## Start

Requires Node.js **20.19+ or 22.12+** and npm. From this directory, run this one command:

```bash
npm install && npm run dev
```

Open the **Local** URL printed by Vite, normally `http://localhost:5173`. Vite chooses another port if that port is occupied. Startup also bundles the portable viewer runtime. No credentials, database server, API, external asset server, or hosted computation is used. After dependency installation, authoring, image decoding, storage, and publishing are entirely local.

```bash
npm run build
npm run preview -- --port 5199 --strictPort
```

The second command serves the production application at `http://localhost:5199`.

## The Included World

**The Secret Life of a Forest** contains 738 editable objects, nine scenes, twelve authored stops, original vector illustration, one embedded botanical image, and two explicit choice stops. The overview contains a coherent cut-paper landscape with a field station, trees, fungi, roots, and a pond.

The six nested descents are:

```text
Forest
  Mushroom
    Gill
      Spore
        Cell
          Nucleus
            Memory
```

The deepest scene has a composed scale of `4.58752e-7`, a **2,179,827:1** local-unit scale ratio relative to the overview. Canopy and root scenes offer alternate routes. All illustration pieces are ordinary selectable shapes or paths. Scene content becomes visible as its tiny physical location expands, not through a route change or image substitution.

The text makes a deliberate distinction between measured biology and poetic metaphor. In particular, fungal connections are not presented as evidence of conscious tree generosity, and forest "memory" is not presented as cognition.

## Start Another Story

1. Click the Folia logo or **My projects**.
2. Choose **Start from a blank canvas**. Each new project receives a unique ID.
3. Choose Text, an illustration tool, or Nested scene, then click the canvas. For freehand, drag instead.
4. Double-click a scene or use **Enter scene** before adding objects inside it.
5. Select an object and choose **Frame as story stop**, or use **Add story stop** to frame the current scene. On a canvas without a target, the stop saves the current camera frame.
6. Name your stops, write captions, set timings, and add branch hotspots.
7. Choose **Present** to view the same document without editor controls.

On narrow screens, the story panel and inspector are accessible using the two buttons in the canvas header. Both have explicit close buttons. Desktop is the recommended workspace for dense authoring; the viewer and essential authoring controls also work on mobile.

## Canvas Controls

| Action | Control |
| --- | --- |
| Select / hand | `V` / `H` |
| Move | Drag an unlocked selected object |
| Multiple selection | `Shift` + click; `Ctrl/Cmd+A` selects unlocked children of the current scene |
| Marquee selection | Drag on the empty workspace; selects fully enclosed children of the current scene |
| Resize | Drag a corner handle; scales uniformly around the opposite corner |
| Change width / height independently | Inspector Width and Height |
| Rotate | Drag the round handle; hold Shift for 15-degree steps |
| Nudge | Arrow keys; Shift for ten local units |
| Pan | Hand tool, `Space` + drag, or middle-button drag |
| Cursor-centered zoom | Mouse wheel / trackpad scrolling |
| Fit selected object / entire document | `F` / `0`; zoom controls and minimap |
| Enter scene | Double-click or inspector **Enter scene** |
| Back | `Escape`: finish text, clear selection, then move to the parent scene |
| Text / rectangle / freehand | `T` / `R` / `P` |
| Duplicate | `Ctrl/Cmd+D` |
| Group / ungroup | `Ctrl/Cmd+G` / `Ctrl/Cmd+Shift+G` |
| Undo / redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` |
| Precision | Five-unit local grid snapping; hold Alt to bypass |

The inspector also provides layer ordering, left/top alignment of multiple objects, locking, hiding, opacity, colors, stroke properties, and numeric transforms. Reparent with **Parent / preserve position**. Grouping and reparenting preserve world position, rotation, and scale, including descendants. Group membership does not bake coordinates into world space.

### Text Model

Text is actual HTML text inside SVG `foreignObject` elements, not paths or screenshots. The documented formatting model is intentionally limited:

- UTF-8 plain text, explicit newlines, wrapping, and runs with bold and italic marks.
- One font family, base weight, font size, color, and left/center/right alignment per text box.
- Double-click a text object or choose **Edit on canvas**. Select characters and use `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, or the inspector formatting buttons.
- An entire in-place editing session commits on blur as one undo transaction. Ordinary text selection does not drag the object or camera.
- The inspector's Text content field replaces content with a plain text run on blur.
- Project options can import `.txt` or `.md` up to 200 KB. Markdown is imported as editable literal text, not evaluated markup.
- No arbitrary HTML, embedded scripts, external links, tables, or custom font downloads are supported.

### Images And Paths

Import PNG, JPEG, or WebP through the Image tool. **Replace image** keeps the object ID, dimensions, and transform, so existing story targets remain attached. The original asset is kept separately from fit and crop metadata. Choose fill/crop, contain, or stretch, and adjust Crop X, Y, and zoom. Each original raster is used at its native resolution, with browser filtering for the display scale. There is no artificial upscaling or hidden remote image service.

Freehand captures local points and creates one editable SVG path on release. Paths, rectangles, ellipses, and lines have editable transforms, color, and stroke. Paths use their declared local bounding box; the UI does not include individual Bezier-handle editing.

## Author The Journey

The story path is both a list and a time-based timeline. Drag stops to reorder them or use the earlier/later inspector buttons. Stops can be created, renamed, duplicated, or deleted independently of their canvas content.

Each stop contains a stable ID, target ID or saved camera, title, caption, transition duration, dwell duration, easing, and an optional choice flag. The timeline is the sum of each stop's transition followed by its dwell. Seeking samples the document at an absolute presentation time. It does not replay a queue of animation side effects.

Camera scale is interpolated logarithmically. Nested flights interpolate their center in inverse-scale space to keep the destination in view. Widely separated branches first reveal their common spatial context. Manual navigation and authored playback use the same interpolation function. Selecting a stop and resuming its preview use the same target framing.

Object-targeted stops resolve live world bounds. Moving or reparenting an object changes its stop's framing automatically. Deleting a target leaves its original ID visibly **Missing target**. Use the repair dropdown, or select a replacement and **Repair target with selection**. Publishing is disabled until missing targets are repaired. Deleting a stop removes its incoming branch links but keeps its canvas content.

### Choices And Exploration

1. Select a shape or text object and choose **Make interactive**, or choose **Add branch hotspot** to create a labeled text hotspot.
2. Give it an accessible label and choose its destination stop in the inspector.
3. Enable **Pause for a choice** on the relevant stop. Add a second hotspot to offer another route.

Links are internal stop IDs only. There are no executable URL schemes. Branches may explicitly return to earlier scenes, but autoplay does not automatically traverse branch links and never loops the story. It stops at every choice, missing target, and the end. Choice controls are visible buttons in the viewer's caption panel as well as intentional canvas hotspots; neither requires hover.

In the viewer, use **Left/Right** for previous/next, **Space** for play/pause, and **Home** to restart. Use **Explore**, wheel zoom, or pan to leave the guided camera. Exploration pauses playback. Returning to the guided path reframes the current stop without silently starting autoplay. Breadcrumbs, minimap, and Escape provide predictable ways back. The **Reduced motion** control and operating-system preference retain every caption, scene, and choice with immediate navigation rather than removing parts of the narrative.

## Save, Import, And Publish

### Local Projects

Projects autosave to IndexedDB after 650 ms of committed inactivity. The header distinguishes loading, saving, saved, and error states. A successful request is not treated as a saved project until its transaction completes. Active drags are not autosaved as completed edits. History holds up to 80 full document transactions in memory; undo history is session-local, while the latest document survives reload.

The project browser lists locally saved documents and supports creation, reopening, and deletion of inactive projects. Browser data can be cleared or evicted, and available quota varies. **Export backups of important work.** Storage and quota failures are reported; they are not displayed as successful saves. Projects are local to the browser profile and origin, including the port.

### Editable Package

Choose **Project options → Export editable project**. A `.atlas` file is version-1 JSON containing the complete project and all embedded asset data URLs. It is deliberately not a compressed archive, avoiding archive expansion attacks. Import through Project options or the project library. Parsing and validation finish before the active project is replaced. Invalid imports leave the current project untouched.

Validation covers versions, global ID uniqueness, hierarchy cycles and depth, parents, dimensions, finite and usable transforms, asset references, supported types, internal branch destinations, text limits, and asset/input budgets. Missing stop targets are the one intentional unresolved-reference state. Raster uploads are signature-checked and decoded. SVG is accepted only inside a project package under a conservative element/attribute allowlist, with no scripts, events, foreign HTML, remote references, entities, or arbitrary styles.

### Portable Viewer

Choose **Publish → Download viewer ZIP**. The selected, currently edited project is included, without an application rebuild. The ZIP contains:

```text
index.html
viewer.js
project.json
README.txt
```

Unzip, then run this command inside the extracted directory:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. Alternatively, host the four files on any static server. `file://` is not supported because the viewer loads `project.json` using same-origin `fetch`. The runtime, actual project, embedded images, typography fallbacks, branching, and exploration require no authoring application or external services.

Published content is not concatenated into executable JavaScript or HTML. Project text is rendered as text, the HTML title is escaped, and the viewer validates its bounded JSON input. The bundle has a restrictive content security policy. There are no analytics or remote requests.

## Document And Coordinates

`src/core.js` has no React, DOM, or storage dependency. It exports affine operations, hierarchy transactions, camera operations, deterministic timeline sampling, and document validation. `src/Canvas.jsx` indexes the document by identity and derives a visible display list. SVG shapes and text are positioned with **camera-relative screen matrices**, subtracting camera translation before scaling to avoid enormous translation products at deep zoom. Story thumbnails are cached independently of camera motion.

Node transforms compose in this order:

```text
world(node) = world(parent) × translate(x, y) × rotate(rotation) × scale(scale)
```

Rotation is in degrees. Scale is uniform and positive. Width/height and X/Y use the parent's local unit system. A camera is `{ x, y, scale }`: its world-space center and CSS pixels per world unit. No geometry changes when the camera moves. The flat node array determines sibling layer order; `parentId` defines the tree. Assets, stops, and branch links have their own stable IDs. Groups and scenes are ordinary document nodes.

Scenes optionally clip their descendants to their transformed rectangle. Semantic zoom ranges use **effective pixels per node-local unit**, `camera.scale × composedNodeScale`. Hidden ancestors and out-of-range scenes hide descendants. **Inspect all zoom levels** bypasses semantic rules only in authoring, not published output. The renderer culls outside the viewport and ancestor clip bounds, subpixel objects, and unreadably small text. Thumbnails intentionally override semantic ranges to show their target scene.

### Numeric Limits

| Property | Supported Limit |
| --- | --- |
| Nodes / stops / branch links | 20,000 / 2,000 / 3,000 |
| Hierarchy depth | 64 node levels, root counted as 1 |
| Local dimensions | Greater than 0, at most 1,000,000 |
| Local scale | `1e-6` to `1e6` |
| Composed scale | `1e-12` to `1e12` |
| Local and composed world position | Each axis within `±1e12` |
| Camera scale | `1e-5` to `1e10` CSS pixels per world unit |
| Opacity | 0 to 1 |
| Each transition / dwell | 0 to 86,400 seconds |
| Text per node | 200,000 characters; at most 10,000 runs |
| Package input | 50 MiB UTF-8 JSON |
| Total embedded asset data URLs | 40 MiB |
| Raster upload | 12 MiB; at most 16,000 pixels per side and 16 million pixels total |

Geometry is rejected if its shorter scaled local dimension is below `max(abs(worldX), abs(worldY)) × Number.EPSILON × 8`, or underflows to zero. This prevents structurally finite but unrepresentable placements. These bounds are not a promise that every combination of maximum extent and minimum scale can fill a screen. Keep detailed work in nested local coordinate systems near its parent origin, not at enormous independent world offsets.

The precision verification uses a 1280×800 CSS-pixel viewport, an unrotated camera, 70-pixel framing padding, positive dimensions/scales, and six composed nesting steps spanning at least one million to one. Actual deep DOM rectangles are also checked against an independent exported-document geometry oracle within **0.5 CSS pixels**. Details and measured results are in [VERIFICATION.md](VERIFICATION.md).

## Verify

```bash
npm test
npm run build
npx playwright install chromium
```

Keep the production server running in one terminal:

```bash
npm run preview -- --port 5199 --strictPort
```

Then run:

```bash
npm run test:browser
npm run test:interactions
npm run test:performance
```

All browser scripts launch **headless Chromium**, so no X server is required. Override the server with `BASE_URL=http://localhost:YOUR_PORT`. Tests use isolated browser contexts and ordinary UI operations, downloading real packages and serving real published viewers. Test-generated fixtures, screenshots, and raw reports are written under `/tmp/opencode`. Performance should be measured separately from other browser suites to avoid CPU contention.

## Scope And Provenance

This is a single-user, browser-local editor, not a collaborative service. No accounts, cross-device sync, external URL embeds, PDF importer, arbitrary HTML, audio/video, or custom font uploading are implied. Images use their native source resolution; there is no tile-pyramid pipeline. Text editing has the limited run model above. Undo history is deliberately bounded and does not persist across reloads.

The forest illustration, botanical stamp, sample prose, and performance fixture drawings are original and bundled. All sample asset data is generated locally from `src/example.js`; there are no stock-image URLs or web fonts. See [ASSETS.md](ASSETS.md) for licenses and third-party provenance. Application source is MIT licensed.
