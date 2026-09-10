# APEX Online Racing

A complete, self-hosted, browser-based 3D racing game. The paddock, public room browser, lobbies, synchronized grid, cars, practice opponents, checkpoints, laps, and results all connect to a real authoritative WebSocket server. No accounts, paid assets, hosted backend, or browser-to-browser authority are required.

## Local Play

Requirements: **Node.js 22.15+ (24 recommended)**, npm, and a modern desktop browser with WebGL/hardware acceleration enabled.

One command installs dependencies and starts both the client and game server:

```sh
npm ci && npm run dev
```

Open **http://localhost:3000**. Vite, HTTP discovery/configuration, and game WebSockets share the same listener. After the initial installation, use `npm run dev`.

If port 3000 is already occupied:

```sh
PORT=4173 npm run dev
```

1. Choose a driver name under Settings or your profile.
2. Select **Quick race**, join a live room, or **Create room**.
3. Pick Sunset Canyon or Neon Harbor, 1-5 laps, grid capacity, and practice bots.
4. Click **Ready up**. The host clicks **Start race** when everyone is ready.
5. Follow the circuit and pass the numbered checkpoint gates in order. Results appear automatically after the race.

### Multiple Players

Open another browser window, private window, browser profile, or device on the same network. Each client has its own server-issued identity. The second client can independently discover the room in **Live rooms**, or use **Join with code** or the lobby's copied invitation URL (`?room=CODE`). On your LAN, use the server computer's IP address rather than `localhost`.

Driver preferences are local; room discovery and racing are not. `localStorage` holds only preferences. `sessionStorage` holds the rotating reconnect credential. There is no BroadcastChannel, shared-tab simulation, or client-reported position/score API.

### Solo Evaluation

The three initial rooms are actual server-owned, publicly joinable lobbies with explicitly marked practice bots, not fabricated human activity. The first human to join becomes host. Alternatively, create a 1-lap room with 1-7 bots. Ready up and start. Bots drive the same physics, collide, pass real checkpoints, complete laps, and receive authoritative results. Tests verify eight-car bot grids finish both circuits in under two simulated minutes without resets.

## Controls

| Action             | Keyboard              | Standard Gamepad            |
| ------------------ | --------------------- | --------------------------- |
| Accelerate         | W / Up arrow          | RT                          |
| Brake into reverse | S / Down arrow        | LT                          |
| Steer              | A / D or Left / Right | Left stick                  |
| Brake              | Space                 | A                           |
| Drift              | Left Shift            | B                           |
| Reset to track     | R                     | X                           |
| Cycle camera       | C                     | Use the HUD camera button   |
| Settings           | Escape                | Use the HUD settings button |

Remap driving keys in Settings. C remains reserved for the camera; Escape closes settings. Analog triggers and steering are bounded and dead-zoned. Small screens also have basic touch driving buttons, though desktop keyboard/gamepad play is the intended experience.

Chase, hood, and aerial cameras are available. Sound is synthesized locally with Web Audio and starts after a user gesture. Master volume, reduced motion, and driver preferences persist locally. Reduced motion disables speed-based FOV, vehicle sway, impact flashes, and tire trails. Readiness and network warnings use words/icons as well as color.

## Circuits And Rules

| Circuit       | Length | Road | Gates | Driving Character                                                        |
| ------------- | ------ | ---- | ----- | ------------------------------------------------------------------------ |
| Sunset Canyon | 1.1 km | 20 m | 12    | Warm red-rock landscape, sweeping bends, dry high-grip asphalt           |
| Neon Harbor   | 0.9 km | 18 m | 14    | Night docks, cranes and containers, tighter bends, reduced wet-road grip |

Cars use fixed-step arcade dynamics with lateral traction, progressive steering, acceleration, drag, braking, reverse, drifting, swept boundary collisions, and vehicle contacts. Scenery stays outside the collision corridor. The shared road definition drives visuals, barriers, minimap, checkpoint validation, and bot lookahead.

- The grid is fixed. Countdown lasts exactly 180 server ticks, then all drivers begin on the same tick.
- Only the next ordered gate is eligible, crossed in the forward direction within its lateral bounds. Swept corridor and progression validation reject shortcuts, reverse-line exploits, and discontinuous movement.
- Reset returns behind the last accepted gate, never restarts the lap clock, and adds **3 seconds**. Reset cooldown is also 3 seconds.
- Lap times include that lap's penalties. Official finish order uses elapsed time plus cumulative penalties, with deterministic tie-breaking. A finisher's car stops on the circuit.
- Live gaps are validated distance gaps, not client-estimated official times. The HUD includes race time, last/best laps, and the completed-lap delta versus best.
- A race ends when all cars finish, 30 simulated seconds after the first finisher, or at the total budget of 180 simulated seconds per lap. Unfinished drivers receive DNF.
- Joining after countdown begins makes you a spectator. Rematch returns to the lobby and promotes connected spectators into available seats.
- Disconnected drivers get **30 wall-clock seconds** to reconnect. Their controls go neutral; the host role transfers immediately and is not automatically reclaimed. Expired identities and abandoned rooms are removed. Seed rooms return to lobby when the last human reservation expires/leaves.
- Explicit leave gives up the seat immediately. During a running race the departed car remains under neutral controls and its original identity remains in the results.

## Architecture

| Boundary            | Files                                                      | Responsibility                                                                                   |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Presentation        | `client/App.tsx`, `Race.tsx`, `TrackArt.tsx`, `styles.css` | Paddock, public browser, lobby, accessible dialogs, settings, HUD, results                       |
| 3D/audio            | `client/world.ts`, `audio.ts`                              | Procedural Three.js vehicles/circuits/scenery, batched static meshes, cameras, synthesized audio |
| Client transport    | `client/connection.ts`                                     | Runtime-validated WebSocket traffic, connection health, discovery, reconnect credentials         |
| Client netcode      | `client/netcode.ts`                                        | Fixed-step prediction, acknowledgement reconciliation, buffered remote rendering                 |
| Protocol            | `shared/protocol.ts`                                       | One versioned protocol, strict runtime schemas, input/message bounds                             |
| Simulation/rules    | `shared/simulation.ts`, `tracks.ts`                        | Pure deterministic physics, swept validation, collisions, laps, penalties, bots, ranking         |
| Server transport    | `server/index.ts`, `rate-limit.ts`                         | HTTP/WS boundaries, origin checks, message limits, heartbeat, backpressure, shutdown             |
| Authoritative state | `server/rooms.ts`                                          | Global room registry, memberships, input queues, fixed ticks, lifecycle, bots, results           |
| Configuration       | `server/config.ts`                                         | Validated deployment configuration; room/session state is deliberately in memory                 |
| Verification        | `tests/`                                                   | Simulation, protocol, hostile input, lifecycle, socket integration, netcode, isolated browsers   |

### Replication

The server simulates at **60 Hz** and broadcasts **20 Hz full snapshots** only to room members. Snapshot ticks are global monotonic server ticks; each car has a last-consumed input acknowledgement. Full snapshots are intentional: at most eight cars and five laps make state small and bounded, while independent snapshots recover immediately from dropped/stale updates without fragile delta baselines. Typical eight-car snapshots are several KiB (roughly 80-130 KiB/s downstream per racing client); exact size varies with numeric representation and lap history. Lobby clients do not receive race snapshots.

Clients generate fixed-step, sequence-numbered controls at up to 60 Hz and batch at up to 30 Hz. No position, velocity, lap, or result is accepted from a client. The server consumes at most one queued command per driver per tick, bounds the queue to 12, ignores stale/duplicate sequences, rejects large sequence jumps, and neutralizes held input after 250 ms. Client timestamps never determine simulation time.

The controlled car is predicted with the shared `stepCar`, then reset to authoritative state and replayed through unacknowledged commands. Small visual errors blend over 120 ms; resets and discontinuities snap. Remote cars use a 100 ms interpolation buffer with wrapped heading interpolation and at most 100 ms extrapolation before freezing. Monotonic receive times and tick-derived clock estimation avoid trusting either browser wall clocks or client-reported timing. Catch-up is capped; overload slows simulated time rather than changing physics `dt`.

Reconnect credentials use 32 cryptographically random bytes, are rotated on successful resume, and expire with their reservations. Old or already-in-use credentials cannot replace another active connection. If the old socket has not timed out yet, the server returns `RECONNECT_PENDING`: the client retains its credential and retries, rather than losing its seat. An explicit "Use a new driver instead" action is available for intentionally duplicated tabs. The client detects offline transitions, bounds connection attempts, retries with backoff, and displays degraded/reconnecting status. A resumed identity that was removed from its room while offline receives an authoritative `left` message.

## Verification

Install the local browser once:

```sh
npx playwright install chromium
```

On minimal Linux CI images, use `npx playwright install --with-deps chromium` if browser system libraries are missing.

Run the entire required gate:

```sh
npm run check
```

This runs strict type checking, ESLint, all focused Vitest tests, the complete client/server production build, and Playwright against the production server on port 3100. No external hosted service or external asset request is involved. Browser tests use SwiftShader when no GPU/display is available. Screenshots and failure traces go to `test-results/`.

Individual commands:

```sh
npm test
npm test -- tests/simulation.test.ts
npm test -- tests/protocol.test.ts tests/netcode.test.ts
npm test -- tests/server.test.ts tests/integration.test.ts
npm run build && npm run test:browser
```

The socket integration suite starts ephemeral real HTTP/WebSocket servers and multiple independently connected clients. It verifies discovery, joins, readiness, synchronized countdown, spectators, reconnect rotation/expiry, host migration, cleanup, malicious traffic rejection, and full-lap finishes. Its full-finish test sends a human socket's bounded controls using the shared bot steering policy while real server bots race alongside it; it does not inject client positions or results. Manual fixed ticking accelerates tests without changing the production rules.

Playwright uses **two isolated browser contexts**. One creates a room through the UI; the other discovers it through the server-pushed public list, joins with a distinct identity, readies, and enters the identical start tick. Driving in one browser is verified from snapshots received by the other. It also checks reload recovery, offline/reconnect credential rotation, filtering, unavailable-room errors, and mobile overflow.

A separate full-duration browser test creates a solo Neon Harbor grid, watches a real practice bot earn its lap, verifies official timed/DNF standings, and uses the rematch UI. The full browser suite takes roughly two minutes, including the normal first-finisher timeout; it does not fast-forward or fabricate results.

### Network Simulation

`tests/netcode.test.ts` drives deterministic delivery schedules with latency, jitter, dropped updates, duplication, reordering, clock offset/drift, and multi-second stalls. It asserts acknowledgement replay, no stale rollback, bounded pending history, wrapped headings, interpolation delay, extrapolation caps, and reset/finish snapping. These are pure tests, so timing is repeatable rather than dependent on machine load.

For a manual interruption, start two browser clients, set one browser context offline in DevTools, and restore it within 30 seconds. The other client retains the same authoritative race. WebSocket throttling support varies between browser DevTools versions; use the deterministic tests for reproducible jitter/loss verification rather than assuming ordinary HTTP throttling affects already-open WebSockets.

## Production

Build and start one authoritative process:

```sh
npm ci
npm run build
PUBLIC_URL=https://race.example.com HOST=0.0.0.0 PORT=3000 REGION=EU-West npm start
```

`npm run build` produces `dist/` (versioned client assets, including fonts) and `build/server.js` (bundled server code). `npm start` executes the compiled server, not Vite or a TypeScript watcher. You may prune development dependencies after the build with `npm prune --omit=dev`.

For a local production check:

```sh
PUBLIC_URL=http://localhost:3000 npm start
```

| Variable          | Default                                                        | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `HOST`            | `0.0.0.0`                                                      | Listening interface                                            |
| `PORT`            | `3000`                                                         | Shared HTTP/WebSocket port                                     |
| `PUBLIC_URL`      | unset                                                          | Public HTTP(S) URL and authorized browser origin               |
| `WS_URL`          | derived from `PUBLIC_URL`, otherwise browser same-origin `/ws` | Explicit public WebSocket URL                                  |
| `ALLOWED_ORIGINS` | unset                                                          | Additional comma-separated exact HTTP(S) origins; no wildcards |
| `REGION`          | `Local`                                                        | Label shown in public room cards                               |
| `NODE_ENV`        | set to `production` by `npm start`                             | Enables production static serving and strict origin defaults   |

Production browser WebSockets are denied unless their origin is configured via `PUBLIC_URL` or `ALLOWED_ORIGINS`. Environment variables are read from the process; `.env` files are not implicitly loaded. Native public clients without an Origin are allowed, but receive exactly the same protocol and rate-limit validation.

Terminate TLS at a reverse proxy and forward `/ws` with HTTP/1.1 Upgrade support. For example, Caddy provides automatic TLS and WebSocket forwarding:

```caddyfile
race.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Expose only the proxy publicly. Configure its idle timeout above the 15-second WebSocket heartbeat. Forwarded IP headers are deliberately not trusted: the application rate-limits by direct TCP peer, so proxied users share that IP budget. Apply connection/request limits at your trusted edge and capacity-test before opening a large deployment; do not enable arbitrary forwarded-header trust.

Health and readiness:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/ready
curl http://localhost:3000/api/config
```

`/health` returns `{"status":"ok"}`. `/ready` returns 200 while the game service is accepting connections, and 503 during shutdown. SIGINT/SIGTERM stops admission, notifies clients, cancels races, clears credentials, and closes sockets with a bounded grace period.

The optional `Dockerfile` builds the same artifacts and runs as an unprivileged user:

```sh
docker build -t apex-racing .
docker run --rm -p 3000:3000 -e PUBLIC_URL=http://localhost:3000 apex-racing
```

### Security And Limits

Strict schemas reject extra authority fields, unknown messages, non-finite/out-of-bounds values, invalid strings, and incompatible versions. Text is rendered as text, never raw HTML. Limits cover UTF-8 message size (4 KiB), 6-command batches, 60 input commands/sec with jitter allowance, room operations, HTTP requests, handshakes, socket count, total rooms, sessions, spectators, output buffering, and tracked IP buckets. Idle state expires automatically. Static assets are protected against path traversal and escaping symlinks. See `server/README.md` for the exact budgets and lifecycle API.

### Deliberate Scope

- This is an arcade racer, not a licensed vehicle simulator. Geometry, circuit art, sounds, and liveries are procedural. Lucide icons are ISC licensed; bundled Barlow Condensed and DM Sans fonts use the SIL Open Font License.
- Rooms and race results are ephemeral. Server restarts cancel current races; there is no account database, global leaderboard, monetization, or chat moderation surface.
- Deploy **one authoritative instance** for one public room directory. Do not put multiple independent replicas behind a round-robin load balancer and expect shared discovery. Scaling beyond one process requires a shared discovery service and explicit room-to-server routing, which are intentionally outside this implementation.
- The fixed-tick server and public endpoint include bounded resource policies, but this is not a claim of internet-scale DDoS protection or production capacity certification. Load-test and put the deployment behind a properly configured edge before a large public launch.
