import { EventEmitter, once } from "node:events";
import { request } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, type ClientOptions } from "ws";
import {
  createGameServer,
  type GameServer,
  type GameServerOptions,
} from "../server/index.js";
import { COUNTDOWN_TICKS } from "../server/rooms.js";
import {
  MAX_MESSAGE_BYTES,
  NEUTRAL,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol.js";
import { botControls, stepRace } from "../shared/simulation.js";
import { TRACKS } from "../shared/tracks.js";

const servers: GameServer[] = [];
const clients: TestClient[] = [];
const temporaryDirectories: string[] = [];
const settings = { track: "canyon" as const, laps: 1, capacity: 4, bots: 0 };

class TestClient {
  readonly socket: WebSocket;
  readonly history: ServerMessage[] = [];
  readonly invalid: string[] = [];
  private readonly inbox: ServerMessage[] = [];
  private readonly events = new EventEmitter();

  constructor(url: string, options: ClientOptions = {}) {
    this.socket = new WebSocket(url.replace(/^http/, "ws") + "/ws", options);
    this.socket.on("error", () => {});
    this.socket.on("message", (raw) => {
      const message = parseServerMessage(raw.toString());
      if (!message) this.invalid.push(raw.toString());
      else {
        this.inbox.push(message);
        this.history.push(message);
      }
      this.events.emit("message");
    });
    clients.push(this);
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  wait<T extends ServerMessage["type"]>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () =>
      true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolveWait, reject) => {
      const timer = setTimeout(() => {
        this.events.off("message", check);
        reject(
          new Error(
            `Timed out waiting for ${type}; received ${JSON.stringify(this.history.slice(-5))}`,
          ),
        );
      }, 3000);
      const check = () => {
        const index = this.inbox.findIndex(
          (message) =>
            message.type === type &&
            predicate(message as Extract<ServerMessage, { type: T }>),
        );
        if (index === -1) return;
        clearTimeout(timer);
        this.events.off("message", check);
        resolveWait(
          this.inbox.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>,
        );
      };
      this.events.on("message", check);
      check();
    });
  }

  async hello(name: string, token?: string) {
    if (this.socket.readyState === WebSocket.CONNECTING)
      await once(this.socket, "open");
    this.send({
      type: "hello",
      version: PROTOCOL_VERSION,
      name,
      ...(token === undefined ? {} : { token }),
    });
    return this.wait("welcome");
  }

  async disconnect(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, "close");
    this.socket.close();
    await closed;
  }
}

async function start(options: GameServerOptions = {}): Promise<GameServer> {
  const game = await createGameServer({
    port: 0,
    host: "127.0.0.1",
    seedRooms: false,
    dev: false,
    autoTick: false,
    ...options,
  });
  servers.push(game);
  return game;
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("Condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function driver(game: GameServer) {
  const client = new TestClient(game.url);
  const welcome = await client.hello("Driver");
  client.send({
    type: "create",
    name: "Input race",
    settings: { ...settings, bots: 1 },
  });
  const { room } = await client.wait("room");
  client.send({ type: "ready", ready: true });
  await client.wait("room", (message) =>
    message.room.players.some(
      (player) => player.id === welcome.id && player.ready,
    ),
  );
  client.send({ type: "start" });
  await client.wait("room", (message) => message.room.state === "countdown");
  game.rooms.advance(COUNTDOWN_TICKS);
  await client.wait("snapshot", (message) => message.state === "racing");
  return { client, welcome, room: game.rooms.rooms.get(room.code)! };
}

async function upgrade(
  url: string,
  origin?: string,
  path = "/ws",
): Promise<number> {
  return new Promise((resolveUpgrade, reject) => {
    const socket = new WebSocket(
      url.replace(/^http/, "ws") + path,
      origin ? { origin } : {},
    );
    socket.on("error", () => {});
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("Upgrade timed out"));
    }, 3000);
    socket.on("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      response.resume();
      socket.terminate();
      resolveUpgrade(response.statusCode!);
    });
    socket.on("open", () => {
      clearTimeout(timer);
      socket.close();
      resolveUpgrade(101);
    });
  });
}

async function rawHttp(
  url: string,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolveResponse, reject) => {
    const req = request(url, { path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () =>
        resolveResponse({ status: response.statusCode!, body }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

afterEach(async () => {
  for (const client of clients) client.socket.terminate();
  await Promise.all(servers.splice(0).map((game) => game.close()));
  for (const client of clients.splice(0)) expect(client.invalid).toEqual([]);
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("real independent WebSocket clients", () => {
  it("creates, discovers, joins, readies, starts, spectates, reconnects, finishes, rematches, and cleans up", async () => {
    const game = await start({ raceTicksPerLap: 12 });
    const host = new TestClient(game.url);
    const guest = new TestClient(game.url);
    const observer = new TestClient(game.url);
    const [hostWelcome, guestWelcome] = await Promise.all([
      host.hello("Host"),
      guest.hello("Guest"),
      observer.hello("Observer"),
    ]);
    await Promise.all([
      host.wait("rooms"),
      guest.wait("rooms"),
      observer.wait("rooms"),
    ]);
    host.send({ type: "create", name: "Shared room", settings });
    const created = (await host.wait("room")).room;
    expect((await host.wait("snapshot")).code).toBe(created.code);
    expect(
      (await guest.wait("rooms", (message) => message.rooms.length === 1))
        .rooms[0],
    ).toMatchObject({ name: "Shared room", players: 1 });
    guest.send({ type: "join", code: created.code, spectator: false });
    await guest.wait("room", (message) => message.room.players.length === 2);
    host.send({ type: "start" });
    expect((await host.wait("error")).code).toBe("NOT_READY");
    host.send({ type: "ready", ready: true });
    guest.send({ type: "ready", ready: true });
    await host.wait("room", (message) =>
      message.room.players.every((player) => player.ready),
    );
    host.send({ type: "start" });
    const countdown = await host.wait(
      "room",
      (message) => message.room.state === "countdown",
    );
    expect(
      (
        await guest.wait(
          "room",
          (message) => message.room.state === "countdown",
        )
      ).room.startTick,
    ).toBe(countdown.room.startTick);
    expect(countdown.room.startTick).toBe(COUNTDOWN_TICKS);
    game.rooms.advance(COUNTDOWN_TICKS - 1);
    expect(game.rooms.rooms.get(created.code)!.view.state).toBe("countdown");
    game.rooms.advance(1);
    await host.wait("snapshot", (message) => message.state === "racing");
    expect(
      observer.history.some((message) => message.type === "snapshot"),
    ).toBe(false);
    observer.send({ type: "join", code: created.code, spectator: false });
    expect(
      (await observer.wait("room")).room.players.find(
        (player) => player.name === "Observer",
      )?.spectator,
    ).toBe(true);
    host.send({
      type: "input",
      commands: [
        {
          seq: 0,
          clientTime: 999_999_999,
          controls: { ...NEUTRAL, throttle: 1 },
        },
      ],
    });
    await until(
      () => game.rooms.sessions.get(hostWelcome.id)!.queue.length === 1,
    );
    game.rooms.advance(3);
    expect(
      (
        await host.wait(
          "snapshot",
          (message) => message.ack[hostWelcome.id] === 0,
        )
      ).tick,
    ).toBe(COUNTDOWN_TICKS + 3);
    await host.disconnect();
    await until(() => game.rooms.sessions.get(hostWelcome.id)?.peer === null);
    expect(game.rooms.rooms.get(created.code)!.view.hostId).toBe(
      guestWelcome.id,
    );
    const resumed = new TestClient(game.url);
    const resumedWelcome = await resumed.hello(
      "Ignored rename",
      hostWelcome.token,
    );
    expect(resumedWelcome).toMatchObject({ id: hostWelcome.id, resumed: true });
    expect(resumedWelcome.token).not.toBe(hostWelcome.token);
    expect((await resumed.wait("snapshot")).ack[hostWelcome.id]).toBe(0);
    resumed.send({
      type: "input",
      commands: [
        { seq: 0, clientTime: 0, controls: NEUTRAL },
        { seq: 1, clientTime: 0, controls: { ...NEUTRAL, throttle: 1 } },
      ],
    });
    await until(
      () => game.rooms.sessions.get(hostWelcome.id)!.queue.length === 1,
    );
    game.rooms.advance(3);
    const acknowledged = await resumed.wait(
      "snapshot",
      (message) => message.ack[hostWelcome.id] === 1,
    );
    expect(acknowledged.ack[guestWelcome.id]).toBe(-1);
    const replay = new TestClient(game.url);
    await once(replay.socket, "open");
    replay.send({
      type: "hello",
      version: 1,
      name: "Replay",
      token: hostWelcome.token,
    });
    expect((await replay.wait("error")).code).toBe("RECONNECT_EXPIRED");
    game.rooms.advance(10);
    const finished = await guest.wait(
      "snapshot",
      (message) => message.state === "finished",
    );
    expect(finished.results).toHaveLength(2);
    expect(finished.results.every((result) => result.dnf)).toBe(true);
    guest.send({ type: "rematch" });
    await guest.wait(
      "room",
      (message) =>
        message.room.state === "lobby" &&
        message.room.players.length === 3 &&
        message.room.startTick === 0,
    );
    resumed.send({ type: "leave" });
    guest.send({ type: "leave" });
    observer.send({ type: "leave" });
    await Promise.all([
      resumed.wait("left"),
      guest.wait("left"),
      observer.wait("left"),
    ]);
    expect(game.rooms.rooms.size).toBe(0);
  });

  it("runs the actual simulation to completed server results using socket controls, including real server bots", async () => {
    let time = 1000;
    const game = await start({ now: () => time });
    const { client, welcome, room } = await driver(game);
    const track = TRACKS[room.view.settings.track];
    let seq = 0;
    for (let batch = 0; batch < 1200 && room.view.state === "racing"; batch++) {
      let predicted = room.cars;
      const commands = [];
      for (let step = 1; step <= 6; step++) {
        const tick = game.rooms.tick + step;
        const inputs = Object.fromEntries(
          predicted.map((car) => [car.id, botControls(car, track, tick)]),
        );
        commands.push({
          seq: seq++,
          clientTime: time,
          controls: inputs[welcome.id],
        });
        predicted = stepRace(
          predicted,
          inputs,
          track,
          tick,
          room.view.startTick,
          room.view.settings.laps,
        );
      }
      client.send({ type: "input", commands });
      await until(
        () => game.rooms.sessions.get(welcome.id)!.queue.length === 6,
      );
      for (let step = 0; step < 6; step++) {
        time += 1000 / 60;
        game.rooms.advance();
      }
    }
    expect(room.view.state).toBe("finished");
    const finished = await client.wait(
      "snapshot",
      (message) => message.state === "finished",
    );
    expect(finished.results).toHaveLength(2);
    expect(
      finished.results.every(
        (result) => !result.dnf && result.timeTicks !== null,
      ),
    ).toBe(true);
    expect(finished.results.map((result) => result.position)).toEqual([1, 2]);
    expect(
      client.history.filter((message) => message.type === "error"),
    ).toEqual([]);
  }, 30_000);

  it("expires reconnect credentials at 30 seconds and deletes unoccupied non-seed rooms", async () => {
    let time = 1000;
    const game = await start({ now: () => time });
    const client = new TestClient(game.url);
    const welcome = await client.hello("Short stay");
    client.send({ type: "create", name: "Temporary", settings });
    await client.wait("room");
    await client.disconnect();
    await until(
      () => game.rooms.sessions.get(welcome.id)?.disconnectedAt !== null,
    );
    time += RECONNECT_GRACE_MS - 1;
    game.rooms.sweep();
    expect(game.rooms.rooms.size).toBe(1);
    time++;
    game.rooms.sweep();
    expect(game.rooms.rooms.size).toBe(0);
    expect(game.rooms.tokens.size).toBe(0);
    const expired = new TestClient(game.url);
    await once(expired.socket, "open");
    expired.send({
      type: "hello",
      version: 1,
      name: "Expired",
      token: welcome.token,
    });
    expect(await expired.wait("error")).toMatchObject({
      code: "RECONNECT_EXPIRED",
      fatal: true,
    });
  });
});

describe("wire security and availability", () => {
  it("requires hello/version and rejects malformed, binary, oversized, and authority-injection messages", async () => {
    const game = await start();
    const missing = new TestClient(game.url);
    await once(missing.socket, "open");
    missing.send({ type: "list" });
    expect(await missing.wait("error")).toMatchObject({
      code: "INVALID_MESSAGE",
      fatal: true,
    });
    const version = new TestClient(game.url);
    await once(version.socket, "open");
    version.send({ type: "hello", version: 999, name: "Old" });
    expect(await version.wait("error")).toMatchObject({
      code: "VERSION_MISMATCH",
      fatal: true,
    });
    const binary = new TestClient(game.url);
    await binary.hello("Binary");
    binary.socket.send(Buffer.from("{}"));
    expect(await binary.wait("error")).toMatchObject({
      code: "INVALID_MESSAGE",
      fatal: true,
    });
    const large = new TestClient(game.url);
    await large.hello("Large");
    const closed = once(large.socket, "close");
    large.socket.send("x".repeat(MAX_MESSAGE_BYTES + 1));
    expect((await closed)[0]).toBe(1009);
    const malformed = new TestClient(game.url);
    await malformed.hello("Malformed");
    for (const raw of [
      "{",
      JSON.stringify({ type: "results", results: [{ position: 1 }] }),
      JSON.stringify({
        type: "input",
        commands: [
          { seq: 0, clientTime: 0, controls: NEUTRAL, x: 100, z: 100 },
        ],
      }),
      JSON.stringify({
        type: "input",
        commands: [
          { seq: 0, clientTime: 0, controls: { ...NEUTRAL, throttle: 2 } },
        ],
      }),
      JSON.stringify({ type: "hello", version: 1, name: "<script>" }),
    ]) {
      malformed.socket.send(raw);
      expect((await malformed.wait("error")).code).toBe("INVALID_MESSAGE");
    }
    await until(() => malformed.socket.readyState === WebSocket.CLOSED);
    expect(game.rooms.rooms.size).toBe(0);
    expect(game.rooms.sessions.size).toBe(3);
  });

  it("ignores duplicate/stale input, rejects huge sequences and forged positions without corrupting state", async () => {
    const game = await start();
    const { client, welcome, room } = await driver(game);
    const command = (seq: number) => ({
      seq,
      clientTime: 0,
      controls: { ...NEUTRAL, throttle: 1 },
    });
    client.send({
      type: "input",
      commands: [command(0), command(0), command(1)],
    });
    await until(() => game.rooms.sessions.get(welcome.id)!.queue.length === 2);
    expect(room.ack[welcome.id]).toBe(-1);
    game.rooms.advance(2);
    expect(room.ack[welcome.id]).toBe(1);
    client.send({
      type: "input",
      commands: [command(0), command(Number.MAX_SAFE_INTEGER)],
    });
    expect((await client.wait("error")).code).toBe("INVALID_MESSAGE");
    const before = structuredClone(room.cars);
    client.socket.send(
      JSON.stringify({
        type: "input",
        commands: [command(2)],
        cars: [{ x: 999999, finishTick: 0 }],
      }),
    );
    expect((await client.wait("error")).code).toBe("INVALID_MESSAGE");
    expect(room.cars).toEqual(before);
    client.send({ type: "input", commands: [command(2)] });
    await until(() => game.rooms.sessions.get(welcome.id)!.queue.length === 1);
    game.rooms.advance(1);
    expect(
      (
        await client.wait(
          "snapshot",
          (message) => message.ack[welcome.id] === 2,
        )
      ).results,
    ).toEqual([]);
  });

  it("rate limits floods without interrupting an independent client", async () => {
    const game = await start({ now: () => 1000 });
    const abusive = new TestClient(game.url);
    const normal = new TestClient(game.url);
    await Promise.all([abusive.hello("Flood"), normal.hello("Normal")]);
    for (let index = 0; index < 160; index++) abusive.send({ type: "list" });
    expect(
      (
        await abusive.wait(
          "error",
          (message) => message.code === "RATE_LIMITED",
        )
      ).code,
    ).toBe("RATE_LIMITED");
    await until(() => abusive.socket.readyState === WebSocket.CLOSED);
    normal.send({ type: "ping", nonce: 42 });
    expect(await normal.wait("pong")).toMatchObject({ nonce: 42, tick: 0 });
    expect(normal.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("enforces production origins and upgrade paths and exposes only public configuration", async () => {
    const game = await start({
      production: true,
      publicUrl: "https://race.example",
      allowedOrigins: ["https://app.example"],
      region: "EU West",
    });
    expect(await upgrade(game.url, "https://evil.example")).toBe(403);
    expect(await upgrade(game.url, "null")).toBe(403);
    expect(await upgrade(game.url, game.url)).toBe(403);
    expect(await upgrade(game.url, "https://race.example")).toBe(101);
    expect(await upgrade(game.url, "https://app.example")).toBe(101);
    expect(await upgrade(game.url)).toBe(101);
    expect(await upgrade(game.url, undefined, "/wrong")).toBe(404);
    expect(await (await fetch(`${game.url}/api/config`)).json()).toEqual({
      wsUrl: "wss://race.example/ws",
      region: "EU West",
      protocolVersion: 1,
    });
    expect((await fetch(`${game.url}/health`)).status).toBe(200);
    expect(await (await fetch(`${game.url}/ready`)).json()).toEqual({
      ready: true,
    });
  });

  it("bounds per-IP HTTP traffic and upgrade attempts", async () => {
    const game = await start({ now: () => 1000 });
    let response: Response | undefined;
    for (let index = 0; index < 81; index++) {
      response = await fetch(`${game.url}/health`);
      await response.text();
    }
    expect(response!.status).toBe(429);
    for (let index = 0; index < 20; index++)
      expect(await upgrade(game.url, "https://evil.example")).toBe(403);
    expect(await upgrade(game.url)).toBe(429);
  });

  it("closes hello stalls, nonresponsive sockets, and application stalls", async () => {
    const game = await start({
      helloTimeoutMs: 40,
      heartbeatIntervalMs: 25,
      stallTimeoutMs: 80,
    });
    const noHello = new TestClient(game.url);
    await once(noHello.socket, "open");
    expect(await noHello.wait("error")).toMatchObject({
      code: "INVALID_MESSAGE",
      fatal: true,
    });
    const noPong = new TestClient(game.url, { autoPong: false });
    await noPong.hello("No pong");
    await until(() => noPong.socket.readyState === WebSocket.CLOSED);
    const stalled = new TestClient(game.url);
    await stalled.hello("Stalled");
    await until(() => stalled.socket.readyState === WebSocket.CLOSED);
  });

  it("drops snapshots to slow sockets and disconnects rather than buffering reliable state indefinitely", async () => {
    const game = await start();
    const { client, welcome } = await driver(game);
    const socket = [...game.ws.clients][0];
    Object.defineProperty(socket, "bufferedAmount", {
      configurable: true,
      get: () => 300_000,
    });
    game.rooms.advance(3);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    client.send({ type: "name", name: "Reliable update" });
    await until(() => client.socket.readyState === WebSocket.CLOSED);
    expect(game.rooms.sessions.get(welcome.id)?.peer).toBeNull();
  });

  it("advances at fixed 60Hz in real time and closes gracefully and idempotently", async () => {
    const game = await start({ autoTick: true });
    const client = new TestClient(game.url);
    await client.hello("Shutdown");
    const before = game.rooms.tick;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(game.rooms.tick - before).toBeGreaterThanOrEqual(4);
    expect(game.rooms.tick - before).toBeLessThan(20);
    await Promise.all([game.close(), game.close()]);
    expect(await client.wait("error")).toMatchObject({
      code: "SERVER_SHUTDOWN",
      fatal: true,
    });
    expect(game.server.listening).toBe(false);
    expect(game.rooms.sessions.size).toBe(0);
    expect(game.rooms.tokens.size).toBe(0);
  });

  it("bounds catch-up after an event-loop stall instead of simulating the entire backlog", async () => {
    const game = await start({ autoTick: true, maxCatchUpTicks: 2 });
    const before = game.rooms.tick;
    const deadline = performance.now() + 200;
    while (performance.now() < deadline) {
      /* Deliberately stall the real server timer. */
    }
    await new Promise((resolve) => setTimeout(resolve, 12));
    expect(game.rooms.tick - before).toBeGreaterThanOrEqual(2);
    expect(game.rooms.tick - before).toBeLessThanOrEqual(4);
  });

  it("hosts Vite middleware and game sockets on the same listener in development", async () => {
    const game = await start({ dev: true, production: false });
    const response = await fetch(game.url, {
      headers: { Accept: "text/html" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("/@vite/client");
    const viteClient = await fetch(`${game.url}/@vite/client`);
    expect(viteClient.status).toBe(200);
    const token = (await viteClient.text()).match(
      /const wsToken = ("[^"]+");/,
    )?.[1];
    expect(token).toBeDefined();
    const hmr = new WebSocket(
      `${game.url.replace(/^http/, "ws")}/__vite_hmr?token=${JSON.parse(token!)}`,
      "vite-hmr",
      { origin: game.url },
    );
    try {
      expect(JSON.parse((await once(hmr, "message"))[0].toString())).toEqual({
        type: "connected",
      });
    } finally {
      hmr.terminate();
    }
    const client = new TestClient(game.url, { origin: game.url });
    expect(await client.hello("Same origin")).toMatchObject({ version: 1 });
  });

  it("serves production assets and SPA routes but blocks traversal, hidden files, and escaping symlinks", async () => {
    const root = await mkdtemp("/tmp/opencode/apex-server-");
    temporaryDirectories.push(root);
    const dist = join(root, "dist");
    await mkdir(dist);
    await mkdir(join(dist, "assets"));
    await writeFile(
      join(dist, "index.html"),
      "<!doctype html><title>Race app</title>",
    );
    await writeFile(join(dist, "assets", "app.js"), "export const app = true;");
    await writeFile(join(root, "secret.txt"), "private");
    await writeFile(join(dist, ".env"), "secret");
    await symlink(join(root, "secret.txt"), join(dist, "escape.txt"));
    const game = await start({ production: true, distDir: dist });
    const home = await fetch(game.url);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Race app");
    expect(home.headers.get("x-content-type-options")).toBe("nosniff");
    const asset = await fetch(`${game.url}/assets/app.js`);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(await asset.text()).toContain("export");
    expect(
      (
        await fetch(`${game.url}/room/ABCD`, {
          headers: { Accept: "text/html" },
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${game.url}/missing.js`)).status).toBe(404);
    expect(
      (
        await fetch(`${game.url}/api/unknown`, {
          headers: { Accept: "text/html" },
        })
      ).status,
    ).toBe(404);
    expect((await fetch(`${game.url}/`, { method: "POST" })).status).toBe(405);
    for (const path of [
      "/..%2fsecret.txt",
      "/%2eenv",
      "/%00",
      "/%5c..%5csecret.txt",
      "/%ZZ",
    ]) {
      const response = await rawHttp(game.url, path);
      expect(response.status).toBe(400);
      expect(response.body).not.toContain("private");
    }
    expect((await fetch(`${game.url}/escape.txt`)).status).toBe(403);
    const head = await fetch(game.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});
