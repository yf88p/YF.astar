# Server Boundary

The wire format and physics exports are defined by `shared/protocol.ts` and `shared/CONTRACT.md`. The server imports those implementations directly. There is no client or host authority over movement, checkpoints, times, or results.

## Entry Point

`server/index.ts` exports the async factory:

```ts
const game = await createGameServer({
  host: "127.0.0.1",
  port: 0,
  seedRooms: false,
  dev: false,
  autoTick: false,
});

game.port; // Actual bound port, including when port: 0 was requested.
game.url; // Reachable local HTTP base URL.
game.server; // Node HTTP server.
game.ws; // ws WebSocketServer; game endpoint is /ws.
game.rooms; // Authoritative RoomService.
game.rooms.rooms; // Map of actual room records, for server-side inspection.
game.rooms.advance(180); // Advance 180 fixed 1/60-second ticks in manual mode.
await game.close(); // Idempotent, stops timers, closes clients, clears state.
```

Importing the module does not listen or install process handlers. Direct invocation starts the server and handles SIGINT/SIGTERM. The existing `npm run dev` command runs Vite in middleware mode on the same HTTP listener as the game; Vite HMR uses `/__vite_hmr`. `npm start` serves the built `dist` directory, without Vite. Build before starting production.

Factory options include config fields, `seedRooms`, `autoTick`, `maxCatchUpTicks` (default 5), `now` (injectable server clock), `maxRooms` (default 100), `raceTicksPerLap`, `firstFinishTimeoutTicks`, `helloTimeoutMs`, `heartbeatIntervalMs`, and `stallTimeoutMs`. These are trusted server options, never wire messages. `RoomService` can also be constructed directly from `server/rooms.ts`; `connect(name, token, peer)`, `handle(session, parsedMessage)`, `disconnect(session, peer?)`, `advance(ticks)`, `sweep()`, `snapshot(room)`, and `shutdown()` support deterministic tests. Its transport entry points expect already schema-validated messages; the HTTP/WebSocket boundary always uses the shared parser first.

## Configuration

| Variable          | Default   | Meaning                                                                      |
| ----------------- | --------- | ---------------------------------------------------------------------------- |
| `HOST`            | `0.0.0.0` | Listening interface                                                          |
| `PORT`            | `3000`    | Port, including `0` for an ephemeral port                                    |
| `PUBLIC_URL`      | unset     | Public HTTP(S) URL; allows that browser origin and derives `/ws` using WS(S) |
| `WS_URL`          | unset     | Explicit public WS(S) URL override                                           |
| `ALLOWED_ORIGINS` | unset     | Comma-separated exact HTTP(S) origins, no wildcards or paths                 |
| `REGION`          | `Local`   | Public room-region label, at most 40 printable characters                    |
| `NODE_ENV`        | unset     | `production` disables development middleware                                 |

`GET /api/config` returns `{ wsUrl: string | null, region, protocolVersion: 1 }`. A null `wsUrl` means the frontend should derive `ws://` or `wss://` from `location` and use `/ws`. No private configuration or reconnect credentials are exposed. `GET /health` and `/api/health` return `{ status: 'ok' }`; `/ready` and `/api/ready` return `{ ready }` with 200 or 503. Readiness describes the listening game service, not the presence of a production asset build.

Production browser sockets require `PUBLIC_URL` or `ALLOWED_ORIGINS`. The server does not trust the request Host header to authorize a production Origin. Native clients without an Origin are allowed because this is a public game, not cookie-authenticated private data. Opaque (`null`) and unconfigured browser origins are rejected. Development additionally allows the request's same origin. Deploy TLS at a reverse proxy and configure public HTTPS/WSS URLs. Forwarded-IP headers are not trusted: IP limits use the direct TCP peer, so a proxy deployment shares an IP budget unless IP accounting is deliberately extended at the trusted deployment boundary.

## Room And Race Rules

- Rooms and discovery are globally shared within this process. Membership and settings changes send `room` to members and `rooms` to all authenticated connections. Only members receive snapshots. Create/join sends a room view followed by a snapshot.
- Default seeds are real joinable lobbies: `Canyon after hours` (3 bots), `Harbor night shift` (4 bots), and `The Sunday drive` (2 bots). Bots are clearly marked; the first human is host. Seeds persist and return to lobby when the last human reservation leaves or expires.
- Lobby racers occupy capacity, including bots and disconnected reservations. Bots leave at least one human seat. At most 24 total members, including spectators, fit a room. Explicit spectator joins and all post-lobby joins spectate. Existing drivers retain their car on reconnect, but leaving and rejoining a running race does not restore driver authority.
- Only the current host can change lobby settings, start, rematch, or kick. Starting requires at least two racers and all racers connected and ready; bots are ready automatically. Settings changes reset human readiness. Hosts cannot kick drivers during countdown/racing or alter simulation/results.
- Host ownership transfers immediately on leave/disconnect to a connected human, preferring a racer. It is not reclaimed automatically on reconnect. Countdown lasts exactly 180 ticks, using a shared absolute `startTick`; cars remain frozen until that tick. Countdown inputs are consumed/acknowledged without running physics.
- Physics runs at fixed 60Hz; periodic full snapshots run every three ticks (20Hz). Event-loop catch-up is bounded and excess wall-clock backlog is discarded. Under overload simulation time slows rather than changing physics dt or allowing an unbounded catch-up loop.
- Results are final when all cars finish, 30 simulated seconds after the first finisher, or after a total budget of 180 simulated seconds per configured lap, whichever comes first. Remaining cars receive authoritative DNF results. A departed driver's car stays in the race with neutral controls and its starting identity remains in results. Connected hosts can rematch from finished/cancelled to lobby; available seats promote connected spectators, and human readiness resets.
- Reconnect tokens contain 32 cryptographically random bytes. Disconnect reserves identity and room membership for exactly 30 wall-clock seconds. A successful reconnect rotates the token while maintaining player ID, consumed ack, and race participation. Currently connected tokens return `RECONNECT_PENDING` without invalidating the token or replacing the active socket; clients retain the token and retry. Old or expired tokens return `RECONNECT_EXPIRED`. Expiry deletes both session and token; non-seed rooms are deleted when the last human reservation is gone. Explicit leave removes the reservation immediately. A resumed session with no remaining room receives `left`, clearing stale membership after an offline kick. State is in-memory and does not survive process restarts or span multiple server replicas.

## Input And Transport Limits

- Shared strict schemas reject extra authority fields, forged results/positions, nonfinite or out-of-range controls, invalid names, and unknown message types. A versioned hello is mandatory within 5 seconds. Text messages are at most 4096 UTF-8 bytes; binary frames are rejected and ws also bounds fragmented payloads. Compression is disabled.
- Each driver has at most 12 queued commands. Exactly one is consumed per fixed tick and only the last consumed sequence appears in `ack`. Duplicate/stale sequences are ignored; sequences more than 120 ahead of consumed ack are rejected. Overflow commands are discarded without advancing the ack or received-sequence high-water mark. A client should reconcile against ack on reconnect and reset its sequence when joining or starting a new race.
- Inputs have a 60-command/second sustained token budget with a 24-command jitter burst. Client timestamps never drive physics. Held controls become neutral after 15 ticks or 250 wall-clock milliseconds, whichever comes first. Reset is one-shot per consumed command, never repeated by input holding. Disconnect immediately clears pending/held controls.
- Each socket has a 60-message/second budget with burst 120; non-input room operations have 4/second with burst 12. Per direct-peer IP: HTTP 40/second with burst 80; upgrades 1/second with burst 20; socket messages 600/second with burst 1200; inputs 960/second with burst 384; non-input operations 32/second with burst 64. Control frames also consume message budgets. Five invalid/rate-limited requests close an offending game socket.
- Caps are 32 game sockets per IP, 512 game sockets globally, 1024 TCP sockets, 1024 live/reserved sessions, 100 rooms, and 4096 tracked IP buckets. Idle IP buckets expire after a minute. HTTP header/request/idle timeouts and bounded request reuse limit stalled HTTP connections.
- WebSocket ping runs every 15 seconds; missing pong closes at the next check. Application silence over 90 seconds also closes even if automatic pong continues. Clients should send protocol ping while idle in the lobby. Snapshots are dropped above 256 KiB buffered output; reliable messages close the slow socket instead of accumulating. A buffer over 1 MiB or remaining blocked over 5 seconds also closes it. Graceful shutdown allows one second before forcibly destroying lingering sockets.
- Production files are restricted by decoded path checks and realpath containment, including escaping symlinks. Hidden paths, traversal, malformed escapes, and backslashes are rejected. Unknown assets/API routes do not fall back to the SPA. Only HTML navigation requests fall back to `index.html`. Asset MIME types, cache policy, and basic response security headers are set explicitly.

## Verification

```sh
npx vitest run tests/server.test.ts tests/integration.test.ts
npx eslint server tests/server.test.ts tests/integration.test.ts
npm run typecheck
```

Unit tests exercise deterministic lifecycle and input behavior using the shared simulation exports. Integration tests use independently connected ws clients, actual HTTP requests, and a manually advanced room service; the full-finish test drives one human using the shared bot controller while another real server bot races. Additional coverage includes production static-path safety, origin policy, payload/protocol errors, flood isolation, token expiry, heartbeat/application stalls, backpressure, bounded catch-up, Vite on the shared listener, and graceful shutdown.
