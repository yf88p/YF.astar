# Margin

A local-first spatial workspace for connected reading, research, and writing. Documents are the source of truth; cards are places to see them. Live excerpts stay attached to editable, stable source blocks.

## Start

Requires Node.js 20.19+ (verified with Node 24.19) and a current Chromium, Firefox, or Safari browser. Chromium is the independently verified browser.

```sh
npm install && npm start
```

Open the local URL printed by Vite, normally `http://localhost:5173`. Vite chooses the next available port if that port is busy. Use the **same origin and port** each time to access the same browser storage. Installation downloads npm dependencies; normal application operation needs no internet, credentials, server database, AI service, telemetry, or account. Fonts and icons are bundled locally.

After installation, `npm start` is the single start command. Keep that terminal running while using the app. The server serves application files; your workspace content stays in your browser.

For a production build:

```sh
npm run build
npm run preview
```

The production preview uses a different origin/port from development, so its browser storage is separate. Transfer content using a complete workspace package rather than expecting browser storage to cross origins.

## A Useful Starting Point

**The Common Ground** is an original, explicitly fictional inquiry into third places and ordinary belonging. Its invented reading room, laundrette, public bench, and night market generate design questions, contradictions, practical prototypes, care obligations, and a provisional charter.

- 32 substantive documents, 192 editable blocks, roughly 205-231 words per document.
- Three intentionally composed boards: **The big picture**, **Field notes**, and **A place to begin**.
- 14 named frames, 18 live excerpts, two explicitly frozen snapshots, and 33 authored board relationships.
- 32 real stored internal links, with corresponding backlinks.
- No purported real interviews, empirical observations, scholarly quotations, or fabricated external citations. Document provenance repeats the fictional status.

For your own material, use the workspace chooser at the top of the sidebar and choose **New blank workspace**. It creates a new isolated project with an empty board. The sample remains available in the chooser.

## First Five Minutes

1. On **The big picture**, double-click **The case for staying**. Its full structured document opens.
2. Edit the first paragraph. Choose its gutter button, then **Pin excerpt**. Choose **Field notes** and **Pin live excerpt**.
3. Edit that paragraph again. Use **On boards** in the document context to reveal the new excerpt. The excerpt shows the current text, in its own fixed position.
4. Use the excerpt's **Open source** action. The exact canonical block is revealed with a **Referenced passage** highlight.
5. Rename the document and move the block up or down in the writing toolbar. References continue to use the same IDs.
6. Delete that selected block. The excerpt is explicitly a deleted-source card, not a quotation still pretending to be live. Open the source and **Restore passage**, or restore it from **Deleted blocks**.
7. Return to the map. Shift-select two cards, choose **Connect selected cards**, supply a type, label, and direction, and follow the resulting relationship.

**A little guidance**, at the bottom of the sidebar, contains the in-app controls and conventions.

## Canvas Controls

| Action | Control |
| --- | --- |
| Open a document or exact excerpt source | Double-click its card, or focus the card and press Enter; excerpts also have a source button |
| Select a card | Click the card or its header |
| Select several cards | Shift-click cards; drag a marquee on empty canvas in Select mode; Ctrl/Command+A outside the editor |
| Keyboard multiselection | Focus a card and press Shift+Space |
| Move cards | Drag a card's header, never its body text |
| Pan | Wheel/trackpad on empty canvas; hold Space and drag; middle-button drag; Hand tool |
| Cursor-centered zoom | Ctrl/Command+wheel; zoom controls also zoom around the viewport center |
| Select / Hand tool | V / H, outside editing and dialogs |
| Fit selection / whole board | F / 0; selection inspector and fit button |
| Resize | Drag the selected card's lower-right handle; focus the handle and use arrows, with Shift for larger steps |
| Move a named cluster | Drag its frame heading; wholly contained cards move with it in one transaction |
| Rename a frame | Double-click its heading or use its small edit button |
| Group | Select cards, then **New frame** or **Group in named frame** |
| Arrange | Select at least two cards, then **Arrange in a grid**; deterministic reading-order grid, undoable |
| Align | Select at least two cards, then **Align left edges** |
| Remove a placement | Selection inspector or Delete/Backspace outside the editor |
| Undo / redo | Ctrl/Command+Z / Ctrl/Command+Shift+Z in the active scope |
| Navigate back | Alt+Left; **Back to board** in the editor restores the previous navigation entry, which may itself be another document |
| Search and launcher | Ctrl/Command+K, then type; arrows move between results and Enter opens the exact passage |
| Quick document | N outside the editor, or **New document** |

At medium zoom, document cards show authored summaries and a deterministic first-paragraph preview. Nearer than 105%, cards render their full document blocks in a scrollable reading surface. Body text can be selected normally. Native scrolling inside a readable card does not pan the canvas. At overview zoom, cards simplify to titles and frame headings remain prominent. The minimap shows the full spatial extent and permits recentering.

Position, size, and reading scroll belong to each placement. Duplicating a placement shares the document, not the geometry. A frame is spatial containment, not ownership: moving a card out of it does not change canonical data. Removing a frame does not remove contained cards. Alignment and arrange never run automatically when content changes.

## Writing Model

This is a structured block editor, not an HTML word processor. Each heading, paragraph, list item, checklist item, quote, code block, link, or image caption has a stable block ID and its own editing surface. Plain-text paste prevents clipboard HTML or scripts from becoming executable content.

- Choose a block with its gutter button. Shift-click another gutter button for a contiguous range.
- The **Block style** selector changes semantic formatting without replacing identity or text.
- **Add block** inserts after the active selection. Enter splits at the caret; Shift+Enter inserts a line break within any block, including code. Pasted code preserves its newlines.
- Lists are separate list-item blocks; checklists persist checked state. Headings support three levels. Quotes and code have distinct reading treatments.
- **Insert link** searches canonical documents and specific blocks. It inserts a new stored link after the current block without replacing the original prose. The destination gets a real backlink.
- Within **Insert link**, expand **Add a web link or a reusable local image** to attach an absolute HTTP/HTTPS/mailto link or insert a previously imported local image into this document. External images imported from Markdown are not fetched automatically; opening their safe URL is explicit.
- Rename through **Document title**. **Document summary** is authored, never generated. Tags are comma-separated, deduplicated, and updated immediately.
- Individual document Markdown export is available in the editor header and the main Export dialog.
- Inline Markdown syntax inside a paragraph remains literal. There is no inline bold/italic formatting engine, nested-list engine, table editor, footnote system, or PDF parser.

### Identity And Reference Rules

| Operation | Canonical behavior |
| --- | --- |
| Edit, rename, style change, reorder | Existing document/block IDs remain stable. All live placements resolve current content. |
| Pin a passage | Stores the selected block IDs in their selected order. It does not store character offsets or a copied live-text cache. Reordering the document does not retarget or reorder the saved passage selection. |
| Split | The prefix retains the original ID; the suffix receives a new ID. References to the original block continue to reference only its prefix. Pin the second block explicitly if desired. |
| Merge with next | The first ID remains. Text is concatenated exactly, without an invented separator. The second block becomes a tombstone; references to it show missing/deleted source rather than silently jumping to the first. |
| Restore a merged-away block | Restores that block's original ID and text. It does not remove the text already merged into the first block. Use document Undo for exact reversal of the merge. |
| Delete a block | Saves a full tombstone including original position. References preserve provenance and show missing/deleted state. |
| Restore a block | Restores the original ID at its saved position, clamped to the current block list. Live excerpts reconnect. |
| Partially missing multi-block excerpt | Explicit missing-source state, with surviving blocks where available. Missing IDs never resolve to neighbors. |
| Frozen copy | Explicit separate action. Stores a copied block snapshot, source reference, captured source title, and timestamp. Later source edits, rename, and deletion do not rewrite it. |
| Duplicate placement | New placement ID; same canonical document, excerpt reference, or asset. Independent geometry and view state. |
| Duplicate document | Library action. New document ID and new live/deleted block IDs; self-links are remapped, other outbound links retained. |
| Remove placement | Removes only selected board entities and relationships attached to those entities, in one board history transaction. Canonical documents/assets remain. |

### Archive, Trash, And Backlinks

The library and document action menus distinguish canonical archive/trash from placement removal. Archived documents leave default search but remain labeled and readable/editable in their placements. Trashed documents leave search and show deleted-source cards; their focused editor is read-only until restored. Neither state permanently erases blocks or IDs.

Backlinks are computed only from live stored internal targets in active source documents. Archiving or trashing an outgoing source removes its backlink contribution. A link from an active document into a trashed document or deleted block remains a stored link with an honest warning at the target. Restoring content updates search, backlinks, and live cards on the next render, without a reload. There is deliberately no permanent purge action.

## History And Navigation

Each document and each board has a separate bounded, session-only history (60 entries per scope). Typing within a document is coalesced into bursts separated by 900 ms; structural operations are individual transactions. Ctrl/Command+Z inside the editor affects that document, never a distant board. Outside the editor it affects the active board.

A completed multi-card drag or resize is one history entry, as are alignment, arrange, grouping, and multi-card removal. Undoing removal restores attached relationships and the previous selection. Board operations never restore older document content. Camera movement and independent card scroll are persisted but do not pollute authoring history. A board undo does not rewind the current camera.

Creating/importing a document also creates a placement when a board is available. Undoing that board placement does not destroy the new canonical document or imported asset. Document history preserves any newer block IDs as recoverable tombstones so references created after an earlier text operation cannot become silently invalid on undo.

Navigation retains the prior board, camera, selection, focused document, exact target block, and document scroll. Alt+Left and the document back action traverse that history. Switching workspaces clears navigation and authoring history rather than exposing references from another project. Reduced motion is honored from the system setting and can be enabled in the in-app guide; no navigation function depends on animation.

## Search

Local, case-insensitive full-text search covers active document titles and live block bodies. It AND-matches distinct whitespace-separated terms, weights title matches above body-only matches, then uses stable title/ID tie-breaks. Tag and block-type filters are explicit. Results highlight matches, show a deterministic snippet around the first term, and open the exact result block.

Search has no asynchronous external index. A deferred query keeps input responsive, but results are always derived from the current workspace revision, so an older worker or network result cannot overwrite a newer edit. The UI renders at most 100 search passages at a time and shows the total match count. Refine the query to see a more specific set. An empty query opens commands and a filtered document picker.

## Local Persistence

Autosave begins 650 ms after the most recent workspace change. The header reports **Saving locally**, **All changes saved**, or an honest **Not saved - retry** state. The currently edited document is held in memory when saving fails; the error banner offers a recovery package export. Retry only reports success after an actual successful write. Pending changes are flushed when switching workspaces and on normal page exit where supported.

`WorkspaceStore` uses a namespaced localStorage index (`margin:index`), one versioned value per workspace (`margin:workspace:<id>`), and the selected ID (`margin:active`). A transaction validates all content, writes the workspace first, then updates the index. Index-write failure rolls the workspace value back; rollback failure is explicitly reported. The browser check injects storage quota failure and verifies retry and recovery.

This is recoverable synchronous browser persistence, not a multi-key crash-atomic database. Sudden process termination between workspace and index writes is not a power-loss guarantee. Use regular exports. If the stored index or package cannot be loaded, the app shows an explicit recovery error and does not auto-replace the corrupt stored data with the sample.

Browser storage is bounded, browser-profile-specific, and origin-specific. Typical localStorage quotas are around 5 MiB, sometimes less. The package format can represent more than a browser's available quota; a package that fits the format can still be rejected recoverably by local storage. Clearing site data, private browsing, or changing ports can make projects unavailable. No cross-tab synchronization or conflict resolution is implemented; use one editing tab per origin/workspace.

## Import And Export

### Editable Files

**Import files** accepts UTF-8 `.txt`, `.md`, and `.markdown`, plus local PNG, JPEG, GIF, and WebP. Each file is limited to 4 MiB. Multi-file imports are validated and persisted as a complete transaction before publishing any imported objects. Invalid UTF-8 or a malformed companion file rejects the batch rather than applying a partial import. Source filenames and import timestamps are retained in provenance.

Markdown parsing recognizes headings (levels 1-3), paragraphs, bullet/numbered items, checklists, quotes, fenced code, and standalone safe links/images. It does not execute raw HTML. Numbered list items become the editor's common list-item type. A local raster import creates one reusable asset, an editable image document, and an image card; more image placements reuse the same bytes.

### Export Formats

- **Document Markdown**: current live blocks with semantic syntax, links, checklists, and embedded local image data. Internal references are exported as `#<documentId>/<blockId>` links (document-only links omit the block segment). Markdown is a readable interchange export, not a stable-ID workspace roundtrip; reimport treats internal fragment links as inert text. Use the complete package to retain internal identities.
- **Board SVG**: self-contained vector board with positioned frames, real title/body previews, directed connections, and embedded local raster images. Numbered connectors correspond to a readable relationship key containing every authored type and label, so cards cannot obscure long descriptions. Full card text is also included in SVG title metadata. It is a readable map export, not an editable workspace package or a whole-document print layout.
- **Complete `.margin.json` package**: compact UTF-8 JSON, `version: 1`, containing documents, live/deleted blocks, tags, provenance, boards, placements/view state, frames, relationships, and base64 raster assets. No external storage is needed to reopen its content.

### Package Validation And Isolation

Open a package from the workspace chooser or Export dialog. It is fully validated before becoming a new isolated workspace. The imported workspace gets a fresh workspace ID and an `(imported)` name suffix; all canonical document/block IDs and spatial references inside it remain intact. The previous workspace is retained. No merging or title-based collision resolution is implemented.

Validation rejects unsupported versions, unknown schema fields, duplicate IDs, incorrect types, non-JSON values, unsafe URLs, unsafe asset MIME/data signatures, invalid timestamps, nonexistent canonical references, foreign block references, detached/cross-board relationship endpoints, and nonfinite or out-of-range geometry. Valid references to tombstoned blocks and trashed documents are intentionally allowed.

Main bounds:

| Resource | Maximum |
| --- | --- |
| Package file at UI import | 25 MiB bytes |
| Serialized package model | 25 MiB JSON characters |
| Documents / boards / assets | 10,000 / 1,000 / 1,000 |
| Live + deleted + frozen snapshot blocks | 100,000 total |
| Placements / frames / relationships | 50,000 / 10,000 / 100,000 total |
| Individual block or note text | 1,000,000 characters |
| Asset data URL | 12 MiB characters; PNG/JPEG/GIF/WebP only |
| Coordinates | -10,000,000 to 10,000,000 |
| Width / height | Positive, at most 10,000,000 |
| Placement reading scroll | 0 to 10,000,000 |
| Zoom | 0.05 to 8 |

Package validation never mutates the current valid document. The UI file limit and the browser quota are additional constraints, not promises that a maximum-size schema-valid package will fit every device.

## Independent Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run verify:browser
```

The browser command launches **headless Chromium** and a temporary production preview at `http://127.0.0.1:5198`, then stops the preview. It does not need an X server. Build first. To test an already-running server instead:

```sh
MARGIN_URL=http://localhost:5183 npm run verify:browser
```

There are **63 focused model checks** and **74 browser checks across 22 isolated scenarios**. The latest completed production run passed all model and browser checks, with no browser runtime, console, HTTP, or network errors. Model checks cover stable block resolution, live versus frozen semantics, split/merge/restore, shared placements, search refresh/status/isolation, honest persistence failures/rollback, schema/security bounds, scoped history, transforms, and independent reading positions.

Browser checks use native keyboard, mouse, file inputs, downloads, editor selection, and observable DOM content/navigation. They exercise the signature live-excerpt workflow, reference restoration, shared placements, relationships attached across drag/undo, search/filters, image reuse, safe and rejected external links, Markdown/image multi-upload, package export/import/reload, malformed-package rejection, independent workspaces, quota faults/retry, native card text selection/scroll, keyboard focus, mobile, and reduced motion. The external-link test routes its destination to a local Playwright fixture; it does not depend on a web service.

The script writes an actual report to [`docs/browser-results.json`](docs/browser-results.json) and screenshots to `/tmp/opencode/margin-check-*.png`. Reports include actual production asset hashes, raw timings, environment details, all scenario outcomes, and measured DOM counts. The workload generator is [`tests/browser-fixtures.js`](tests/browser-fixtures.js), explicitly synthetic and separate from user-facing seed content.

### Measured Performance

Latest verified production workload: **500 substantive documents, 3,000 blocks, 300 placements, 100 live excerpts, 500 internal links, and 150 board relationships**. Package size: **1,301,939 UTF-8 bytes**. The normal-scale board rendered **12 of 300 cards**; offscreen card bodies are culled rather than replaced by screenshots. The full model and all relationship geometry remain loaded.

Environment: headless **Chromium 153**, Linux x64, **AMD Ryzen 7 5825U**, 16 logical CPUs, approximately 12.1 GiB reported host memory, 1440x1000 viewport, device pixel ratio 1, no CPU or network throttling. This is a shared machine, not a controlled mobile benchmark.

| Browser measurement | Median | p95 |
| --- | ---: | ---: |
| Keystroke to live excerpt DOM | 28.5 ms | 35.2 ms |
| Search input to matching result DOM | 105.9 ms | 168.6 ms |
| Document navigation to exact passage DOM | 58.0 ms | 121.7 ms |
| Keystroke to live excerpt and saved state | 695.6 ms | 752.9 ms |
| Zoom requestAnimationFrame intervals | 16.6 ms | 16.7 ms |
| Drag requestAnimationFrame intervals | 16.7 ms | 16.7 ms |

Seven samples per operation; p95 is nearest-rank and therefore the maximum of each seven-sample series. Frame intervals pool samples across seven gestures. The save-inclusive metric intentionally includes the 650 ms debounce, serialization, validation, and actual localStorage persistence. The raw live-update metric observes the real mounted excerpt behind the editor overlay and is not a physical-display/presentation latency claim. Search/navigation metrics include the next observed DOM animation frame. Timings vary with shared-machine load; the values above are from the final full production run, not the fastest run. There is no fabricated Lighthouse or GPU latency score.

## Implementation Map

| File | Responsibility |
| --- | --- |
| `src/core.js` | UI-independent canonical operations, resolution, search, Markdown, schema validation, persistence, scoped history, camera transforms |
| `src/seed.js` | Original coherent fictional project with stable seed IDs |
| `src/App.jsx` | Workspace shell, scoped transaction routing, navigation, chooser, search, browser, imports/exports, inspectors and dialogs |
| `src/Editor.jsx` | Structured writing, caret/selection, block toolbar, source highlighting, backlinks and provenance |
| `src/Canvas.jsx` | Culling, semantic zoom, native input separation, geometry, relationships, minimap, frames and per-placement reading state |
| `tests/*.test.js` | Independent model checks |
| `scripts/browser-check.mjs` | Production-browser interaction, safety, recovery, and performance verification |

## Current Limits

- Single local user, one active editing tab; no real-time multiplayer, account, background sync, or external semantic search.
- Browser localStorage, not unlimited file-backed storage or power-failure-atomic IndexedDB. Save errors are visible; export backups are important.
- No automatic permanent deletion, package merge, document-level print layout, PDF import, OCR, hosted AI, or implied AI summaries.
- Structured block text rather than arbitrary rich HTML. Links are standalone reference blocks; there is no cross-block native selection editing, though contiguous block selection/pinning/copy is supported.
- Navigation and undo history are session-only. Board cameras and independent placement scroll survive reload; the focused editor/navigation stack does not.
- SVG exports use deterministic previews and full-text metadata, not an exact interactive DOM rendering. Frozen cards retain their captured wording by design.
- Imported raster signatures are checked, but full decoding is left to the browser. Never open an unknown external URL merely because it has a permitted scheme.
- Large-package validation is synchronous and bounded. The measured 500-document/300-placement workload is verified; the schema maxima are safety bounds, not responsiveness guarantees.

See [LICENSES.md](LICENSES.md) for content, font, icon, and dependency provenance.
