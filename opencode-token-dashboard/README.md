# OpenCode Insights

A local, read-only dashboard for understanding where your OpenCode tokens go. Built with React, TypeScript, Recharts, and a small Node.js server using built-in SQLite support.

## Run Locally

Requires **Node.js 24 or newer** and npm. No separate database service, API key, or SQLite package is required.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. Development mode runs the API and Vite on one port, with frontend hot reload and automatic server restart when backend files change.

For a production build:

```sh
npm run build
npm start
```

`npm start` serves the built frontend and the API together. Build before starting, including after changing frontend code. The server intentionally binds only to `127.0.0.1`; it is not a remotely hosted dashboard.

## Database

By default, the server reads:

```text
~/.local/share/opencode/opencode.db
```

To use another OpenCode database or port:

```sh
OPENCODE_DB=/absolute/path/to/opencode.db PORT=4000 npm run dev
OPENCODE_DB=/absolute/path/to/opencode.db npm start -- --port 4000
```

Quoted `~/...` paths in `OPENCODE_DB` are expanded. Environment variables must be supplied to the server process; `.env` files are not automatically loaded.

The connection uses SQLite read-only mode and a consistent read transaction, including committed WAL data while OpenCode is running. It never creates or migrates an OpenCode database. Missing files, unreadable files, and unsupported schemas produce actionable connection states, not sample data.

## Explore

- **Overview:** token and session totals, recorded USD costs, cache hit rate, token/cost trends, model share, and recent sessions.
- **Sessions:** search by title, project, directory, model, or session ID; sort by activity, tokens, cost, or responses; paginate and inspect individual sessions.
- **Models:** compare input, output, cache read/write, total tokens, costs, and usage share. Click a model to filter the dashboard.
- **Data source:** inspect the database path, connection status, and last check time.
- **Filters:** choose the last 7, 30, or 90 days, or all time, plus model and project filters. Selections are retained in the page URL.
- **Charts:** hover or use the chart's keyboard controls for values; toggle models in the legend; switch between token and cost trends.
- **Export CSV:** exports all sessions matching the date/model/project filters and session search, not just the current page. Includes exact counts and period boundaries. Spreadsheet-formula prefixes are escaped.
- **Refresh:** refresh manually or let the visible tab refresh every 30 seconds. A failed refresh keeps the last successful snapshot visible with an error notice.

## Counting Rules

Usage is read from assistant rows in OpenCode's `message` table, joined to `session` and `project` metadata. The currently supported schema stores model and token fields in `message.data` JSON. `part`, `session_message`, and denormalized session totals are deliberately not added to these records, which would double count usage. Databases that exclusively use a different message schema are not supported.

**Total tokens** = input + output + cache read + cache write. Reasoning is displayed separately in the session inspector and CSV, not added again. Token counts describe recorded processing, including repeated cached context, not unique text. Forked/copied assistant records are counted as stored; the database does not reliably identify whether each copy represents a new provider call.

**Cache hit rate** = cache read / (input + cache read + cache write). A zero denominator produces 0%.

**Recorded cost** is the sum of the USD costs stored by OpenCode. A zero cost does not imply free usage: subscriptions and unpriced models may record zero. This dashboard does not estimate prices or replace a provider invoice.

**Dates** use UTC throughout. A 30-day period includes today and the preceding 29 calendar days, with an exclusive end at tomorrow's UTC midnight. Comparisons use the preceding equal-length interval with identical filters. All time has no comparison and uses monthly buckets when the history exceeds 120 days; shorter ranges use daily buckets. Missing buckets are zero-filled.

**Sessions** include activity in the selected period, including creation, updates, user messages, and assistant messages. Sub-sessions are included. A model filter requires a matching assistant message. AI response counts include assistant rows only. Session inspector usage is scoped to the current filters; session creation and last-active timestamps are the original metadata.

## Privacy

The browser receives session titles, project/directory metadata, and aggregated usage. Prompts, system messages, tool results, conversation bodies, credentials, and account records are not exposed by the API. SQLite only projects the required fields from message JSON.

Fonts and assets are served locally. There is no telemetry, external analytics, or runtime external network dependency. The server rejects cross-origin requests and unexpected Host headers, disallows writes, and uses restrictive response headers. Production serves only files within `dist/` and safe frontend routes. Like any unauthenticated local service, other processes running as your user can access it; do not put it behind a public proxy.

## Scripts And Tests

| Script                 | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `npm run dev`          | Local server plus Vite hot reload                               |
| `npm run build`        | Strict TypeScript check and optimized production build          |
| `npm start`            | Serve the production build and read-only API                    |
| `npm run typecheck`    | TypeScript check without a build                                |
| `npm test`             | 28 database, aggregation, API, and security tests               |
| `npm run test:browser` | Production browser workflows and automated accessibility checks |

Browser tests require a production build and Playwright Chromium:

```sh
npx playwright install chromium
npm run build
npm run test:browser
```

Alternatively, set `BROWSER_EXECUTABLE` to a locally installed Chromium executable. Tests create their own temporary SQLite databases and servers; they never read or modify your real OpenCode database. Browser coverage includes filters, URL persistence, sorting/search, pagination, keyboard dialog focus, CSV safety, charts, navigation, error recovery, and layouts from 320px to 1440px. Axe checks WCAG 2 A/AA and 2.1 AA rules on the desktop and mobile overview.

## API And Structure

```text
GET /api/dashboard?range=30d&model=openai%2Fgpt-6-astra&project=PROJECT_ID
```

`range` accepts `7d`, `30d`, `90d`, and `all`. Omit `model` and `project` for unfiltered data. Filter options always describe the whole database, not just the selected period. Unknown filters and invalid parameters return HTTP 400. Missing databases return HTTP 200 with `source.status: "missing"`; source/schema failures return HTTP 503 with `source.status: "error"`. Both source states contain an empty, typed dashboard payload. Protocol errors use `{ "error": { "code", "message" } }`.

```text
server/dashboard.mjs  Read-only snapshots and aggregation
server/http.mjs       Local HTTP API, static serving, Vite integration
server/index.mjs      CLI and server startup
server/*.test.mjs     Database and HTTP tests
src/api-types.ts      Shared API response contract
src/App.tsx           Dashboard, filters, navigation, and exports
src/Charts.tsx        Usage trends and model-share charts
src/SessionTable.tsx  Searchable, sortable, responsive session list
src/components.tsx    Session inspector, connection details, methodology
tests/browser.mjs    End-to-end browser and accessibility verification
```
