import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientMessageSchema,
  NEUTRAL,
  parseServerMessage,
  RECONNECT_GRACE_MS,
  TICK_RATE,
  type ClientMessage,
  type InputCommand,
  type ServerMessage,
} from "../shared/protocol.js";
import * as simulation from "../shared/simulation.js";
import { readConfig } from "../server/config.js";
import {
  COUNTDOWN_TICKS,
  MAX_INPUT_QUEUE,
  RoomService,
  type Peer,
  type RoomServiceOptions,
  type Session,
} from "../server/rooms.js";
import { TokenBucket } from "../server/rate-limit.js";

const settings = { track: "canyon" as const, laps: 1, capacity: 4, bots: 1 };
function command(seq: number, reset = false): InputCommand {
  return { seq, clientTime: 0, controls: { ...NEUTRAL, throttle: 1, reset } };
}

function harness(options: RoomServiceOptions = {}) {
  let time = 1000;
  const service = new RoomService({
    seedRooms: false,
    ...options,
    now: () => time,
  });
  const messages = new Map<string, ServerMessage[]>();
  function peer(): Peer & { messages: ServerMessage[]; closed: boolean } {
    return {
      messages: [],
      closed: false,
      send(message) {
        const parsed = parseServerMessage(JSON.stringify(message));
        expect(parsed, JSON.stringify(message)).not.toBeNull();
        this.messages.push(parsed!);
      },
      close() {
        this.closed = true;
      },
    };
  }
  function connect(name = "Driver", token?: string) {
    const transport = peer();
    const session = service.connect(name, token, transport);
    if (session) messages.set(session.id, transport.messages);
    return { session: session!, peer: transport };
  }
  function send(session: Session, message: ClientMessage) {
    time += 300;
    service.handle(session, clientMessageSchema.parse(message));
  }
  function advance(ticks: number) {
    for (let tick = 0; tick < ticks; tick++) {
      time += 1000 / TICK_RATE;
      service.advance();
    }
  }
  function race() {
    const { session: host } = connect("Host");
    send(host, { type: "create", name: "Test race", settings });
    const room = service.rooms.get(host.roomCode!)!;
    send(host, { type: "ready", ready: true });
    send(host, { type: "start" });
    advance(COUNTDOWN_TICKS);
    return { host, room };
  }
  return {
    service,
    connect,
    send,
    advance,
    race,
    messages,
    peer,
    elapse: (ms: number) => {
      time += ms;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("configuration and rate budgets", () => {
  it("defaults to one public listener and derives a secure public WebSocket URL", () => {
    expect(readConfig({})).toMatchObject({
      host: "0.0.0.0",
      port: 3000,
      region: "Local",
      allowedOrigins: [],
    });
    expect(
      readConfig({
        PORT: "0",
        PUBLIC_URL: "https://race.example",
        REGION: "EU West",
        ALLOWED_ORIGINS: "https://app.example",
        WS_URL: "wss://socket.example/ws",
      }),
    ).toMatchObject({
      port: 0,
      region: "EU West",
      wsUrl: "wss://socket.example/ws",
      allowedOrigins: ["https://app.example", "https://race.example"],
    });
    expect(readConfig({ PUBLIC_URL: "https://race.example/path" }).wsUrl).toBe(
      "wss://race.example/ws",
    );
    for (const PORT of ["-1", "65536", "1.5", "NaN", ""])
      expect(() => readConfig({ PORT })).toThrow();
    for (const PUBLIC_URL of [
      "javascript:alert(1)",
      "https://user:secret@example.com",
      "https://example.com/#fragment",
    ])
      expect(() => readConfig({ PUBLIC_URL })).toThrow();
    expect(() => readConfig({ ALLOWED_ORIGINS: "*" })).toThrow();
    expect(() =>
      readConfig({ ALLOWED_ORIGINS: "https://example.com/path" }),
    ).toThrow();
    expect(() => readConfig({ REGION: "\ninvalid" })).not.toThrow();
    expect(() => readConfig({ REGION: "bad\nregion" })).toThrow();
  });

  it("bounds bursts and refills only with forward server time", () => {
    const budget = new TokenBucket(60, 24, 1000);
    expect(budget.take(1000, 24)).toBe(true);
    expect(budget.take(1000)).toBe(false);
    expect(budget.take(900)).toBe(false);
    expect(budget.take(1100, 6)).toBe(true);
    expect(budget.take(1100)).toBe(false);
    expect(budget.take(100_000, 25)).toBe(false);
  });
});

describe("authoritative room lifecycle", () => {
  it("seeds three real bot-only lobbies and assigns the first human host", () => {
    const h = harness({ seedRooms: true, region: "EU" });
    const list = h.service.roomList().rooms;
    expect(list.map((room) => room.name)).toEqual([
      "Canyon after hours",
      "Harbor night shift",
      "The Sunday drive",
    ]);
    for (const room of h.service.rooms.values()) {
      expect(room.view.hostId).toBe("");
      expect(room.view.players.length).toBeGreaterThanOrEqual(2);
      expect(room.view.players.length).toBeLessThanOrEqual(4);
      expect(
        room.view.players.every(
          (player) => player.bot && player.connected && player.ready,
        ),
      ).toBe(true);
    }
    const { session } = h.connect();
    h.send(session, { type: "join", code: list[0].code, spectator: false });
    expect(h.service.rooms.get(session.roomCode!)!.view.hostId).toBe(
      session.id,
    );
    h.send(session, { type: "leave" });
    expect(h.service.rooms.size).toBe(3);
  });

  it("shares discovery globally, enforces host/readiness, locks settings, and synchronizes countdown", () => {
    const h = harness();
    const host = h.connect("Host");
    const guest = h.connect("Guest");
    const watcher = h.connect("Watcher");
    h.send(host.session, {
      type: "create",
      name: "Night racers",
      settings: { ...settings, bots: 0 },
    });
    const room = h.service.rooms.get(host.session.roomCode!)!;
    expect(guest.peer.messages.at(-1)).toMatchObject({
      type: "rooms",
      rooms: [{ code: room.view.code, players: 1 }],
    });
    h.send(guest.session, {
      type: "join",
      code: room.view.code,
      spectator: false,
    });
    expect(
      guest.peer.messages
        .filter((message) => message.type === "snapshot")
        .at(-1),
    ).toMatchObject({ code: room.view.code });
    h.send(guest.session, { type: "start" });
    expect(guest.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "NOT_HOST",
    });
    h.send(host.session, { type: "start" });
    expect(host.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "NOT_READY",
    });
    h.send(host.session, { type: "ready", ready: true });
    h.send(guest.session, { type: "ready", ready: true });
    h.send(host.session, {
      type: "settings",
      settings: { ...settings, bots: 0, laps: 2 },
    });
    expect(room.view.players.every((player) => !player.ready)).toBe(true);
    h.send(host.session, { type: "ready", ready: true });
    h.send(guest.session, { type: "ready", ready: true });
    h.send(host.session, { type: "start" });
    expect(room.view.startTick).toBe(h.service.tick + COUNTDOWN_TICKS);
    expect(room.view.state).toBe("countdown");
    const grid = structuredClone(room.cars);
    h.advance(COUNTDOWN_TICKS - 1);
    expect(room.cars).toEqual(grid);
    h.send(host.session, { type: "settings", settings });
    expect(host.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "RACE_STARTED",
    });
    h.advance(1);
    expect(room.view.state).toBe("racing");
    expect(
      watcher.peer.messages.some(
        (message) => message.type === "snapshot" || message.type === "room",
      ),
    ).toBe(false);
    expect(watcher.peer.messages.at(-1)).toMatchObject({
      type: "rooms",
      rooms: [{ state: "racing" }],
    });
  });

  it("checks capacity, supports quick join, renaming, moderation, and host departure", () => {
    const h = harness();
    const a = h.connect("A");
    const b = h.connect("B");
    const c = h.connect("C");
    h.send(a.session, {
      type: "create",
      name: "Small",
      settings: { ...settings, capacity: 2 },
    });
    const room = h.service.rooms.get(a.session.roomCode!)!;
    h.send(b.session, { type: "join", code: room.view.code, spectator: false });
    expect(b.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "ROOM_FULL",
    });
    h.send(a.session, {
      type: "settings",
      settings: { ...settings, capacity: 2, bots: 0 },
    });
    h.send(b.session, { type: "quickJoin" });
    expect(b.session.roomCode).toBe(room.view.code);
    h.send(b.session, { type: "name", name: "  New Name  " });
    expect(
      room.view.players.find((player) => player.id === b.session.id)?.name,
    ).toBe("New Name");
    h.send(c.session, { type: "join", code: room.view.code, spectator: true });
    h.send(c.session, { type: "ready", ready: true });
    expect(c.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "INVALID_STATE",
    });
    h.send(a.session, { type: "kick", playerId: c.session.id });
    expect(c.session.roomCode).toBeNull();
    expect(
      c.peer.messages.some(
        (message) => message.type === "error" && message.code === "KICKED",
      ),
    ).toBe(true);
    h.send(a.session, { type: "leave" });
    expect(room.view.hostId).toBe(b.session.id);
    h.send(b.session, { type: "leave" });
    expect(h.service.rooms.size).toBe(0);
    h.send(c.session, { type: "quickJoin" });
    expect(h.service.rooms.size).toBe(1);
  });

  it("distinguishes a still-active credential from expiry without evicting its driver", () => {
    const h = harness();
    const original = h.connect("Original");
    const token = original.session.token;
    const waiting = h.connect("Retry", token);
    expect(waiting.peer.messages[0]).toMatchObject({
      type: "error",
      code: "RECONNECT_PENDING",
      fatal: true,
    });
    expect(original.session.peer).toBe(original.peer);
    expect(h.service.tokens.get(token)).toBe(original.session);
    h.service.disconnect(original.session);
    const resumed = h.connect("Retry", token);
    expect(resumed.session.id).toBe(original.session.id);
    expect(resumed.session.token).not.toBe(token);
  });

  it("clears stale client membership when a driver is kicked while disconnected", () => {
    const h = harness();
    const host = h.connect("Host");
    const guest = h.connect("Guest");
    h.send(host.session, {
      type: "create",
      name: "Offline membership",
      settings,
    });
    h.send(guest.session, {
      type: "join",
      code: host.session.roomCode!,
      spectator: false,
    });
    const token = guest.session.token;
    h.service.disconnect(guest.session);
    h.send(host.session, { type: "kick", playerId: guest.session.id });
    const resumed = h.connect("Guest", token);
    expect(resumed.session.id).toBe(guest.session.id);
    expect(resumed.session.roomCode).toBeNull();
    expect(resumed.peer.messages).toContainEqual({ type: "left" });
    expect(
      resumed.peer.messages.some((message) => message.type === "room"),
    ).toBe(false);
  });

  it("reserves disconnected seats, transfers host, rotates tokens, and expires all disconnected state", () => {
    const h = harness();
    const a = h.connect("A");
    const b = h.connect("B");
    h.send(a.session, {
      type: "create",
      name: "Reconnect",
      settings: { ...settings, bots: 0 },
    });
    const room = h.service.rooms.get(a.session.roomCode!)!;
    h.send(b.session, { type: "join", code: room.view.code, spectator: false });
    const token = a.session.token;
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(h.connect("Attacker", token).peer.closed).toBe(true);
    h.service.disconnect(a.session);
    expect(room.view.hostId).toBe(b.session.id);
    expect(
      room.view.players.find((player) => player.id === a.session.id)?.connected,
    ).toBe(false);
    h.elapse(RECONNECT_GRACE_MS - 1);
    const resumed = h.connect("Changed", token);
    expect(resumed.session.id).toBe(a.session.id);
    expect(resumed.session.name).toBe("A");
    expect(resumed.session.token).not.toBe(token);
    expect(resumed.peer.messages[0]).toMatchObject({
      type: "welcome",
      resumed: true,
    });
    expect(h.service.tokens.has(token)).toBe(false);
    expect(h.connect("Attacker", token).peer.closed).toBe(true);
    h.service.disconnect(resumed.session, a.peer);
    expect(resumed.session.peer).toBe(resumed.peer);
    h.service.disconnect(resumed.session);
    h.service.disconnect(b.session);
    h.elapse(RECONNECT_GRACE_MS);
    h.service.sweep();
    expect(h.service.rooms.size).toBe(0);
    expect(h.service.sessions.size).toBe(0);
    expect(h.service.tokens.size).toBe(0);
    expect(
      h.connect("A", resumed.session.token).peer.messages[0],
    ).toMatchObject({ type: "error", code: "RECONNECT_EXPIRED", fatal: true });
  });

  it("makes late arrivals spectators, disallows race kicks, and allows rematch only after authoritative timeout", () => {
    const h = harness({ raceTicksPerLap: 30 });
    const { host, room } = h.race();
    const late = h.connect("Late");
    h.send(late.session, {
      type: "join",
      code: room.view.code,
      spectator: false,
    });
    expect(
      room.view.players.find((player) => player.id === late.session.id)
        ?.spectator,
    ).toBe(true);
    h.send(late.session, { type: "input", commands: [command(0)] });
    expect(late.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "INVALID_STATE",
    });
    h.send(host, { type: "rematch" });
    expect(h.messages.get(host.id)!.at(-1)).toMatchObject({
      type: "error",
      code: "INVALID_STATE",
    });
    h.advance(30);
    expect(room.view.state).toBe("finished");
    expect(room.results).toHaveLength(2);
    expect(
      room.results.every((result) => result.dnf && result.timeTicks === null),
    ).toBe(true);
    h.send(host, { type: "rematch" });
    expect(room.view.state).toBe("lobby");
    expect(room.cars).toEqual([]);
    expect(room.results).toEqual([]);
    expect(
      room.view.players.find((player) => player.id === late.session.id),
    ).toMatchObject({ spectator: false, ready: false });
  });

  it("finishes when everyone finishes, or after the first-finisher deadline", () => {
    for (const all of [false, true]) {
      const h = harness({ firstFinishTimeoutTicks: 6 });
      const { room } = h.race();
      const original = simulation.stepRace;
      const spy = vi
        .spyOn(simulation, "stepRace")
        .mockImplementation((cars, inputs, track, tick, start, laps) =>
          original(cars, inputs, track, tick, start, laps).map((car, index) =>
            all || index === 0
              ? { ...car, finishTick: car.finishTick ?? tick }
              : car,
          ),
        );
      h.advance(1);
      expect(room.view.state).toBe(all ? "finished" : "racing");
      if (!all) {
        h.advance(5);
        expect(room.view.state).toBe("racing");
        h.advance(1);
      }
      expect(room.view.state).toBe("finished");
      expect(room.results.filter((result) => !result.dnf)).toHaveLength(
        all ? 2 : 1,
      );
      spy.mockRestore();
    }
  });

  it("keeps the race authoritative after host departure and does not restore driver authority on spectator rejoin", () => {
    const h = harness({ raceTicksPerLap: 30 });
    const host = h.connect("Host");
    const guest = h.connect("Guest");
    h.send(host.session, {
      type: "create",
      name: "No host authority",
      settings: { ...settings, bots: 0 },
    });
    const room = h.service.rooms.get(host.session.roomCode!)!;
    h.send(guest.session, {
      type: "join",
      code: room.view.code,
      spectator: false,
    });
    h.send(host.session, { type: "ready", ready: true });
    h.send(guest.session, { type: "ready", ready: true });
    h.send(host.session, { type: "start" });
    h.send(host.session, { type: "kick", playerId: guest.session.id });
    expect(host.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "RACE_STARTED",
    });
    h.send(host.session, { type: "leave" });
    expect(room.view.hostId).toBe(guest.session.id);
    h.send(host.session, {
      type: "join",
      code: room.view.code,
      spectator: false,
    });
    h.send(host.session, { type: "input", commands: [command(0)] });
    expect(host.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "INVALID_STATE",
    });
    const spy = vi.spyOn(simulation, "stepRace");
    h.advance(COUNTDOWN_TICKS);
    expect(spy.mock.calls.at(-1)![1][host.session.id]).toEqual(NEUTRAL);
    h.advance(30);
    expect(room.view.state).toBe("finished");
    expect(room.results).toHaveLength(2);
  });

  it("rejects impossible settings, occupied-seat removal, and cross-room actions", () => {
    const h = harness();
    const a = h.connect("A");
    const b = h.connect("B");
    h.send(a.session, {
      type: "create",
      name: "Invalid",
      settings: { ...settings, capacity: 2, bots: 2 },
    });
    expect(a.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "INVALID_STATE",
    });
    expect(h.service.rooms.size).toBe(0);
    h.send(a.session, { type: "create", name: "Valid", settings });
    h.send(b.session, {
      type: "join",
      code: a.session.roomCode!,
      spectator: false,
    });
    h.send(a.session, {
      type: "settings",
      settings: { ...settings, capacity: 2 },
    });
    expect(a.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "ROOM_FULL",
    });
    h.send(b.session, { type: "settings", settings });
    expect(b.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "NOT_HOST",
    });
    h.send(a.session, { type: "create", name: "Second", settings });
    expect(a.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "INVALID_STATE",
    });
    h.send(b.session, { type: "leave" });
    h.send(b.session, { type: "join", code: "MISSING", spectator: false });
    expect(b.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "ROOM_UNAVAILABLE",
    });
  });

  it("bounds rooms and spectators and preserves seeds after grace cleanup", () => {
    const h = harness({ maxRooms: 1 });
    const a = h.connect();
    const b = h.connect();
    h.send(a.session, { type: "create", name: "Only room", settings });
    h.send(b.session, { type: "create", name: "Too many", settings });
    expect(b.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "ROOM_UNAVAILABLE",
    });
    for (let index = 0; index < 22; index++)
      h.send(h.connect(`Viewer ${index}`).session, {
        type: "join",
        code: a.session.roomCode!,
        spectator: true,
      });
    h.send(b.session, {
      type: "join",
      code: a.session.roomCode!,
      spectator: true,
    });
    expect(b.peer.messages.at(-1)).toMatchObject({
      type: "error",
      code: "ROOM_FULL",
    });
    const seeded = harness({ seedRooms: true });
    const human = seeded.connect();
    seeded.send(human.session, { type: "quickJoin" });
    seeded.service.disconnect(human.session);
    seeded.elapse(RECONNECT_GRACE_MS);
    seeded.service.sweep();
    expect(seeded.service.rooms.size).toBe(3);
    expect(
      seeded.service
        .roomList()
        .rooms.every(
          (room) => room.players === room.bots && room.state === "lobby",
        ),
    ).toBe(true);
  });
});

describe("authoritative inputs", () => {
  it("queues at most 12, consumes exactly one per tick, ignores stale/duplicate commands, and bounds huge sequences", () => {
    const h = harness();
    const { host, room } = h.race();
    for (let batch = 0; batch < 3; batch++)
      h.service.handle(host, {
        type: "input",
        commands: Array.from({ length: 6 }, (_, index) =>
          command(batch * 6 + index),
        ),
      });
    expect(host.queue).toHaveLength(MAX_INPUT_QUEUE);
    expect(host.ack).toBe(-1);
    h.advance(1);
    expect(host.ack).toBe(0);
    expect(room.ack[host.id]).toBe(0);
    h.service.handle(host, {
      type: "input",
      commands: [command(0), command(4), command(Number.MAX_SAFE_INTEGER)],
    });
    expect(host.queue).toHaveLength(11);
    expect(host.receivedSeq).toBe(11);
    expect(h.messages.get(host.id)!.at(-1)).toMatchObject({
      type: "error",
      code: "INVALID_MESSAGE",
    });
    h.advance(11);
    expect(host.ack).toBe(11);
    h.service.handle(host, { type: "input", commands: [command(12)] });
    h.advance(1);
    expect(h.service.snapshot(room).ack[host.id]).toBe(12);
  });

  it("holds controls for no more than 250ms, never repeats reset, and neutralizes disconnects", () => {
    const h = harness();
    const { host } = h.race();
    const spy = vi.spyOn(simulation, "stepRace");
    h.service.handle(host, { type: "input", commands: [command(0, true)] });
    h.advance(1);
    expect(spy.mock.calls.at(-1)![1][host.id]).toMatchObject({
      throttle: 1,
      reset: true,
    });
    h.advance(1);
    expect(spy.mock.calls.at(-1)![1][host.id]).toMatchObject({
      throttle: 1,
      reset: false,
    });
    h.advance(14);
    expect(spy.mock.calls.at(-1)![1][host.id]).toEqual(NEUTRAL);
    h.service.handle(host, { type: "input", commands: [command(1)] });
    h.advance(1);
    h.elapse(251);
    h.advance(1);
    expect(spy.mock.calls.at(-1)![1][host.id]).toEqual(NEUTRAL);
    h.service.handle(host, { type: "input", commands: [command(2)] });
    h.service.disconnect(host);
    h.advance(1);
    expect(host.queue).toHaveLength(0);
    expect(spy.mock.calls.at(-1)![1][host.id]).toEqual(NEUTRAL);
  });

  it("acknowledges countdown commands without moving cars and sends 20 snapshots per 60 ticks", () => {
    const h = harness();
    const { session: host, peer } = h.connect();
    h.send(host, { type: "create", name: "Frozen grid", settings });
    const room = h.service.rooms.get(host.roomCode!)!;
    h.send(host, { type: "ready", ready: true });
    h.send(host, { type: "start" });
    const grid = structuredClone(room.cars);
    peer.messages.length = 0;
    for (let index = 0; index < 60; index++) {
      h.service.handle(host, { type: "input", commands: [command(index)] });
      h.advance(1);
    }
    expect(host.ack).toBe(59);
    expect(room.cars).toEqual(grid);
    expect(
      peer.messages.filter((message) => message.type === "snapshot"),
    ).toHaveLength(20);
  });

  it("supports sustained 60Hz input and bounds command and lobby floods", () => {
    const h = harness();
    const { host } = h.race();
    for (let index = 0; index < 300; index++) {
      h.service.handle(host, { type: "input", commands: [command(index)] });
      h.advance(1);
    }
    expect(host.ack).toBe(299);
    expect(
      h.messages.get(host.id)!.some((message) => message.type === "error"),
    ).toBe(false);
    for (let index = 0; index < 30; index++)
      h.service.handle(host, {
        type: "input",
        commands: [command(300 + index)],
      });
    expect(host.queue.length).toBeLessThanOrEqual(12);
    expect(h.messages.get(host.id)!.at(-1)).toMatchObject({
      type: "error",
      code: "RATE_LIMITED",
    });
    for (let index = 0; index < 30; index++)
      h.service.handle(host, { type: "list" });
    expect(h.messages.get(host.id)!.at(-1)).toMatchObject({
      type: "error",
      code: "RATE_LIMITED",
    });
  });
});
