import { randomBytes, randomUUID } from "node:crypto";
import {
  NEUTRAL,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  SNAPSHOT_RATE,
  TICK_RATE,
  type CarState,
  type ClientMessage,
  type Controls,
  type InputCommand,
  type Player,
  type RaceResult,
  type RoomSettings,
  type RoomSummary,
  type RoomView,
  type ServerMessage,
  type Snapshot,
} from "../shared/protocol.js";
import { TRACKS } from "../shared/tracks.js";
import {
  botControls,
  createCar,
  raceResults,
  stepRace,
} from "../shared/simulation.js";
import { TokenBucket } from "./rate-limit.js";

export const MAX_INPUT_QUEUE = 12;
export const MAX_SEQUENCE_AHEAD = 120;
export const INPUT_HOLD_MS = 250;
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const FIRST_FINISH_TIMEOUT_TICKS = 30 * TICK_RATE;
export const RACE_TICKS_PER_LAP = 180 * TICK_RATE;
const COLORS = [
  "#ff7849",
  "#69d2ff",
  "#c49bff",
  "#ffcf66",
  "#6ee7b7",
  "#f78fc4",
  "#dde6ee",
  "#84a5ff",
];
const BOT_NAMES = ["Aster", "Blitz", "Comet", "Dash", "Echo", "Flint", "Ghost"];
type ErrorCode = Extract<ServerMessage, { type: "error" }>["code"];

export interface Peer {
  send(message: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

export interface Session {
  id: string;
  name: string;
  token: string;
  peer: Peer | null;
  disconnectedAt: number | null;
  roomCode: string | null;
  queue: InputCommand[];
  ack: number;
  receivedSeq: number;
  controls: Controls;
  controlTick: number;
  controlTime: number;
  inputs: TokenBucket;
  actions: TokenBucket;
}

export interface Room {
  view: RoomView;
  seeded: boolean;
  cars: CarState[];
  racePlayers: Player[];
  ack: Record<string, number>;
  results: RaceResult[];
  firstFinishTick: number | null;
}

export interface RoomServiceOptions {
  seedRooms?: boolean;
  region?: string;
  now?: () => number;
  maxRooms?: number;
  raceTicksPerLap?: number;
  firstFinishTimeoutTicks?: number;
}

export class RoomService {
  readonly rooms = new Map<string, Room>();
  readonly sessions = new Map<string, Session>();
  readonly tokens = new Map<string, Session>();
  tick = 0;
  private readonly now: () => number;
  private readonly region: string;
  private readonly maxRooms: number;
  private readonly raceTicksPerLap: number;
  private readonly firstFinishTimeoutTicks: number;

  constructor(options: RoomServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.region = options.region ?? "Local";
    this.maxRooms = options.maxRooms ?? 100;
    this.raceTicksPerLap = options.raceTicksPerLap ?? RACE_TICKS_PER_LAP;
    this.firstFinishTimeoutTicks =
      options.firstFinishTimeoutTicks ?? FIRST_FINISH_TIMEOUT_TICKS;
    if (options.seedRooms !== false) {
      this.makeRoom(
        "Canyon after hours",
        { track: "canyon", laps: 3, capacity: 8, bots: 3 },
        true,
      );
      this.makeRoom(
        "Harbor night shift",
        { track: "harbor", laps: 2, capacity: 8, bots: 4 },
        true,
      );
      this.makeRoom(
        "The Sunday drive",
        { track: "canyon", laps: 1, capacity: 8, bots: 2 },
        true,
      );
    }
  }

  connect(name: string, token: string | undefined, peer: Peer): Session | null {
    this.sweep();
    let session = token ? this.tokens.get(token) : undefined;
    if (session?.peer) {
      this.error(
        peer,
        "RECONNECT_PENDING",
        "Your previous connection is still active. Waiting for it to close; your credential is retained.",
        true,
      );
      return null;
    }
    if (
      token !== undefined &&
      (!session || session.peer || session.disconnectedAt === null)
    ) {
      this.error(
        peer,
        "RECONNECT_EXPIRED",
        "Reconnect token is expired or invalid. Join a room again to continue.",
        true,
      );
      return null;
    }
    const resumed = !!session;
    if (session) {
      this.tokens.delete(session.token);
      session.token = randomBytes(32).toString("base64url");
      session.peer = peer;
      session.disconnectedAt = null;
    } else {
      if (this.sessions.size >= 1024) {
        this.error(
          peer,
          "ROOM_UNAVAILABLE",
          "The server is at capacity. Try again shortly.",
          true,
        );
        return null;
      }
      session = {
        id: randomUUID(),
        name,
        token: randomBytes(32).toString("base64url"),
        peer,
        disconnectedAt: null,
        roomCode: null,
        queue: [],
        ack: -1,
        receivedSeq: -1,
        controls: { ...NEUTRAL },
        controlTick: -Infinity,
        controlTime: -Infinity,
        inputs: new TokenBucket(60, 24, this.now()),
        actions: new TokenBucket(4, 12, this.now()),
      };
      this.sessions.set(session.id, session);
    }
    this.tokens.set(session.token, session);
    peer.send({
      type: "welcome",
      version: PROTOCOL_VERSION,
      id: session.id,
      token: session.token,
      resumed,
      serverTime: this.now(),
      graceMs: RECONNECT_GRACE_MS,
    });
    peer.send(this.roomList());
    const room = this.getRoom(session);
    if (room) {
      const player = room.view.players.find(
        (player) => player.id === session.id,
      )!;
      player.connected = true;
      this.transferHost(room);
      this.publish(room);
      peer.send(this.snapshot(room));
    } else if (resumed) {
      peer.send({ type: "left" });
    }
    return session;
  }

  disconnect(session: Session, peer?: Peer): void {
    if (
      !this.sessions.has(session.id) ||
      !session.peer ||
      (peer && peer !== session.peer)
    )
      return;
    session.peer = null;
    session.disconnectedAt = this.now();
    this.clearInput(session, false);
    const room = this.getRoom(session);
    if (room) {
      const player = room.view.players.find(
        (player) => player.id === session.id,
      )!;
      player.connected = false;
      player.ready = false;
      this.transferHost(room);
      this.publish(room);
    }
  }

  handle(session: Session, message: ClientMessage): void {
    if (!session.peer || this.sessions.get(session.id) !== session) return;
    if (message.type === "input") {
      this.input(session, message.commands);
      return;
    }
    if (!session.actions.take(this.now())) {
      this.fail(session, "RATE_LIMITED", "Too many requests. Slow down.");
      return;
    }
    const room = this.getRoom(session);
    switch (message.type) {
      case "hello":
        this.fail(session, "INVALID_STATE", "Hello has already been received.");
        break;
      case "ping":
        session.peer.send({
          type: "pong",
          nonce: message.nonce,
          serverTime: this.now(),
          tick: this.tick,
        });
        break;
      case "list":
        session.peer.send(this.roomList());
        break;
      case "create": {
        if (room) {
          this.fail(session, "INVALID_STATE", "Leave your current room first.");
          break;
        }
        if (this.rooms.size >= this.maxRooms) {
          this.fail(session, "ROOM_UNAVAILABLE", "Room limit reached.");
          break;
        }
        if (message.settings.bots >= message.settings.capacity) {
          this.fail(
            session,
            "INVALID_STATE",
            "Leave at least one seat for a human.",
          );
          break;
        }
        this.join(
          session,
          this.makeRoom(message.name, message.settings, false),
          false,
        );
        break;
      }
      case "join": {
        if (room) {
          this.fail(session, "INVALID_STATE", "Leave your current room first.");
          break;
        }
        const target = this.rooms.get(message.code);
        if (!target) {
          this.fail(session, "ROOM_UNAVAILABLE", "Room not found.");
          break;
        }
        this.join(
          session,
          target,
          message.spectator || target.view.state !== "lobby",
        );
        break;
      }
      case "quickJoin": {
        if (room) {
          this.fail(session, "INVALID_STATE", "Leave your current room first.");
          break;
        }
        let target = [...this.rooms.values()].find(
          (candidate) =>
            candidate.view.state === "lobby" &&
            candidate.view.players.length < 24 &&
            this.racers(candidate).length < candidate.view.settings.capacity,
        );
        if (!target && this.rooms.size < this.maxRooms)
          target = this.makeRoom(
            "Open grid",
            { track: "canyon", laps: 2, capacity: 8, bots: 2 },
            false,
          );
        if (target) this.join(session, target, false);
        else
          this.fail(
            session,
            "ROOM_UNAVAILABLE",
            "No open rooms. Try again shortly.",
          );
        break;
      }
      case "leave":
        this.remove(session);
        session.peer.send({ type: "left" });
        break;
      case "name": {
        session.name = message.name;
        if (room) {
          room.view.players.find((player) => player.id === session.id)!.name =
            message.name;
          this.publish(room);
        }
        break;
      }
      case "ready": {
        if (!room || room.view.state !== "lobby") {
          this.fail(
            session,
            "INVALID_STATE",
            "Readiness can only change in the lobby.",
          );
          break;
        }
        const player = room.view.players.find(
          (player) => player.id === session.id,
        )!;
        if (player.spectator) {
          this.fail(session, "INVALID_STATE", "Spectators cannot ready.");
          break;
        }
        player.ready = message.ready;
        this.publish(room);
        break;
      }
      case "settings": {
        if (!this.isHost(session, room)) break;
        if (room!.view.state !== "lobby") {
          this.fail(
            session,
            "RACE_STARTED",
            "Settings are locked after start.",
          );
          break;
        }
        const humans = this.racers(room!).filter(
          (player) => !player.bot,
        ).length;
        if (
          message.settings.bots + humans > message.settings.capacity ||
          message.settings.bots >= message.settings.capacity ||
          room!.view.players.length -
            room!.view.settings.bots +
            message.settings.bots >
            24
        ) {
          this.fail(
            session,
            "ROOM_FULL",
            "Settings would remove an occupied seat.",
          );
          break;
        }
        room!.view.settings = { ...message.settings };
        this.syncBots(room!);
        for (const player of room!.view.players)
          if (!player.bot) player.ready = false;
        this.publish(room!);
        break;
      }
      case "start": {
        if (!this.isHost(session, room)) break;
        if (room!.view.state !== "lobby") {
          this.fail(session, "INVALID_STATE", "Race has already started.");
          break;
        }
        const racers = this.racers(room!);
        if (
          racers.length < 2 ||
          racers.some((player) => !player.ready || !player.connected)
        ) {
          this.fail(
            session,
            "NOT_READY",
            "At least two racers and every driver ready are required.",
          );
          break;
        }
        room!.view.state = "countdown";
        room!.view.startTick = this.tick + COUNTDOWN_TICKS;
        room!.racePlayers = racers.map((player) => ({ ...player }));
        room!.cars = racers.map((player, index) =>
          createCar(
            player.id,
            TRACKS[room!.view.settings.track],
            index,
            room!.view.startTick,
          ),
        );
        room!.results = [];
        room!.ack = {};
        room!.firstFinishTick = null;
        for (const player of racers) {
          const driver = this.sessions.get(player.id);
          if (driver) {
            this.clearInput(driver, true);
            room!.ack[player.id] = driver.ack;
          }
        }
        this.publish(room!);
        this.broadcastSnapshot(room!);
        break;
      }
      case "rematch": {
        if (!this.isHost(session, room)) break;
        if (
          room!.view.state !== "finished" &&
          room!.view.state !== "cancelled"
        ) {
          this.fail(session, "INVALID_STATE", "Wait until the race has ended.");
          break;
        }
        this.resetRoom(room!);
        let seats = room!.view.settings.capacity - this.racers(room!).length;
        for (const player of room!.view.players)
          if (player.spectator && player.connected && seats > 0) {
            player.spectator = false;
            seats--;
          }
        this.publish(room!);
        this.broadcastSnapshot(room!);
        break;
      }
      case "kick": {
        if (!this.isHost(session, room)) break;
        const target = room!.view.players.find(
          (player) => player.id === message.playerId,
        );
        if (!target || target.bot || target.id === session.id) {
          this.fail(session, "INVALID_STATE", "Choose another human player.");
          break;
        }
        if (
          !target.spectator &&
          room!.view.state !== "lobby" &&
          room!.view.state !== "finished"
        ) {
          this.fail(
            session,
            "RACE_STARTED",
            "Drivers cannot be kicked during a race.",
          );
          break;
        }
        const kicked = this.sessions.get(target.id)!;
        this.fail(kicked, "KICKED", "The host removed you from the room.");
        this.remove(kicked);
        kicked.peer?.send({ type: "left" });
        break;
      }
    }
  }

  /** Advances fixed 1/60-second steps; tests can advance without a wall-clock timer. */
  advance(ticks = 1): void {
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > 1_000_000)
      throw new Error("Invalid tick count");
    for (let index = 0; index < ticks; index++) {
      this.tick++;
      for (const room of this.rooms.values()) {
        room.view.tick = this.tick;
        if (
          room.view.state === "countdown" &&
          this.tick >= room.view.startTick
        ) {
          room.view.state = "racing";
          this.publish(room);
        }
        if (room.view.state === "racing" || room.view.state === "countdown") {
          const inputs: Record<string, Controls> = {};
          for (const player of room.racePlayers) {
            const car = room.cars.find((car) => car.id === player.id)!;
            if (player.bot) {
              inputs[player.id] = botControls(
                car,
                TRACKS[room.view.settings.track],
                this.tick,
              );
              continue;
            }
            const driver = this.sessions.get(player.id);
            const member = room.view.players.find(
              (member) => member.id === player.id,
            );
            if (
              !driver?.peer ||
              driver.roomCode !== room.view.code ||
              !member ||
              member.spectator
            ) {
              inputs[player.id] = { ...NEUTRAL };
              continue;
            }
            const command = driver.queue.shift();
            if (command) {
              driver.ack = command.seq;
              room.ack[driver.id] = command.seq;
              driver.controls = { ...command.controls, reset: false };
              driver.controlTick = this.tick;
              driver.controlTime = this.now();
              inputs[player.id] = command.controls;
            } else {
              inputs[player.id] =
                this.tick - driver.controlTick <
                  (TICK_RATE * INPUT_HOLD_MS) / 1000 &&
                this.now() - driver.controlTime < INPUT_HOLD_MS
                  ? driver.controls
                  : { ...NEUTRAL };
            }
          }
          // Consume and acknowledge during countdown too, but keep the grid physically frozen.
          if (room.view.state === "countdown") {
            if (this.tick % (TICK_RATE / SNAPSHOT_RATE) === 0)
              this.broadcastSnapshot(room);
            continue;
          }
          room.cars = stepRace(
            room.cars,
            inputs,
            TRACKS[room.view.settings.track],
            this.tick,
            room.view.startTick,
            room.view.settings.laps,
          );
          if (
            room.firstFinishTick === null &&
            room.cars.some((car) => car.finishTick !== null)
          )
            room.firstFinishTick = this.tick;
          if (
            room.cars.every((car) => car.finishTick !== null) ||
            (room.firstFinishTick !== null &&
              this.tick - room.firstFinishTick >=
                this.firstFinishTimeoutTicks) ||
            this.tick - room.view.startTick >=
              this.raceTicksPerLap * room.view.settings.laps
          ) {
            room.view.state = "finished";
            room.results = raceResults(
              room.cars,
              room.racePlayers,
              room.view.startTick,
            );
            for (const player of room.racePlayers) {
              const driver = this.sessions.get(player.id);
              if (driver?.roomCode === room.view.code)
                this.clearInput(driver, false);
            }
            this.publish(room);
            this.broadcastSnapshot(room);
          }
        }
        if (
          this.tick % (TICK_RATE / SNAPSHOT_RATE) === 0 &&
          room.view.players.some((player) => !player.bot && player.connected)
        )
          this.broadcastSnapshot(room);
      }
      if (this.tick % TICK_RATE === 0) this.sweep();
    }
  }

  sweep(): void {
    for (const session of this.sessions.values()) {
      if (
        session.disconnectedAt !== null &&
        this.now() - session.disconnectedAt >= RECONNECT_GRACE_MS
      ) {
        this.remove(session);
        this.tokens.delete(session.token);
        this.sessions.delete(session.id);
      }
    }
  }

  shutdown(): void {
    for (const session of this.sessions.values())
      if (session.peer)
        this.error(
          session.peer,
          "SERVER_SHUTDOWN",
          "Server is shutting down.",
          true,
          1001,
        );
    this.sessions.clear();
    this.tokens.clear();
    this.rooms.clear();
  }

  roomList(): Extract<ServerMessage, { type: "rooms" }> {
    const rooms: RoomSummary[] = [...this.rooms.values()].map(({ view }) => ({
      code: view.code,
      name: view.name,
      track: view.settings.track,
      laps: view.settings.laps,
      players: view.players.filter((player) => !player.spectator).length,
      capacity: view.settings.capacity,
      spectators: view.players.filter((player) => player.spectator).length,
      state: view.state,
      region: view.region,
      bots: view.players.filter((player) => player.bot).length,
    }));
    return { type: "rooms", rooms, serverTime: this.now() };
  }

  snapshot(room: Room): Snapshot {
    return {
      type: "snapshot",
      tick: this.tick,
      serverTime: this.now(),
      code: room.view.code,
      state: room.view.state,
      startTick: room.view.startTick,
      cars: room.cars,
      ack: { ...room.ack },
      results: room.results,
    };
  }

  private makeRoom(
    name: string,
    settings: RoomSettings,
    seeded: boolean,
  ): Room {
    let code: string;
    do {
      code = randomBytes(4).toString("hex").toUpperCase();
    } while (this.rooms.has(code));
    const room: Room = {
      view: {
        code,
        name,
        hostId: "",
        settings: { ...settings },
        state: "lobby",
        players: [],
        startTick: 0,
        tick: this.tick,
        region: this.region,
      },
      seeded,
      cars: [],
      racePlayers: [],
      ack: {},
      results: [],
      firstFinishTick: null,
    };
    this.syncBots(room);
    this.rooms.set(code, room);
    return room;
  }

  private syncBots(room: Room): void {
    const bots = room.view.players
      .filter((player) => player.bot)
      .slice(0, room.view.settings.bots);
    while (bots.length < room.view.settings.bots)
      bots.push({
        id: randomUUID(),
        name: BOT_NAMES[bots.length],
        color: COLORS[(bots.length + 1) % COLORS.length],
        bot: true,
        spectator: false,
        ready: true,
        connected: true,
      });
    room.view.players = [
      ...room.view.players.filter((player) => !player.bot),
      ...bots,
    ];
  }

  private racers(room: Room): Player[] {
    return room.view.players.filter((player) => !player.spectator);
  }
  private getRoom(session: Session): Room | undefined {
    return session.roomCode ? this.rooms.get(session.roomCode) : undefined;
  }

  private join(session: Session, room: Room, spectator: boolean): void {
    if (
      room.view.players.length >= 24 ||
      (!spectator && this.racers(room).length >= room.view.settings.capacity)
    ) {
      this.fail(session, "ROOM_FULL", "This room has no available seats.");
      return;
    }
    session.roomCode = room.view.code;
    this.clearInput(session, true);
    room.view.players.push({
      id: session.id,
      name: session.name,
      color: COLORS[room.view.players.length % COLORS.length],
      ready: false,
      connected: true,
      spectator,
      bot: false,
    });
    this.transferHost(room);
    this.publish(room);
    session.peer?.send(this.snapshot(room));
  }

  private remove(session: Session): void {
    const room = this.getRoom(session);
    session.roomCode = null;
    this.clearInput(session, true);
    if (!room) return;
    room.view.players = room.view.players.filter(
      (player) => player.id !== session.id,
    );
    this.transferHost(room);
    if (!room.view.players.some((player) => !player.bot)) {
      if (room.seeded) this.resetRoom(room);
      else this.rooms.delete(room.view.code);
    }
    this.publish(room);
  }

  private resetRoom(room: Room): void {
    room.view.state = "lobby";
    room.view.startTick = 0;
    room.cars = [];
    room.racePlayers = [];
    room.ack = {};
    room.results = [];
    room.firstFinishTick = null;
    for (const player of room.view.players) {
      player.ready = player.bot;
      const session = this.sessions.get(player.id);
      if (session) this.clearInput(session, true);
    }
  }

  private transferHost(room: Room): void {
    const eligible = room.view.players.filter(
      (player) => !player.bot && player.connected,
    );
    if (!eligible.some((player) => player.id === room.view.hostId))
      room.view.hostId =
        eligible.find((player) => !player.spectator)?.id ??
        eligible[0]?.id ??
        "";
  }

  private isHost(session: Session, room: Room | undefined): boolean {
    if (!room) {
      this.fail(session, "INVALID_STATE", "Join a room first.");
      return false;
    }
    if (room.view.hostId !== session.id) {
      this.fail(
        session,
        "NOT_HOST",
        "Only the host can change lobby settings.",
      );
      return false;
    }
    return true;
  }

  private input(session: Session, commands: InputCommand[]): void {
    if (!session.inputs.take(this.now(), commands.length)) {
      this.fail(
        session,
        "RATE_LIMITED",
        "Input rate exceeds 60 commands per second.",
      );
      return;
    }
    const room = this.getRoom(session);
    if (
      !room ||
      !["countdown", "racing"].includes(room.view.state) ||
      !room.racePlayers.some((player) => player.id === session.id) ||
      !room.view.players.some(
        (player) => player.id === session.id && !player.spectator,
      )
    ) {
      this.fail(
        session,
        "INVALID_STATE",
        "Only active drivers can send controls.",
      );
      return;
    }
    for (const command of commands) {
      if (command.seq <= session.receivedSeq) continue;
      if (command.seq > session.ack + MAX_SEQUENCE_AHEAD) {
        this.fail(
          session,
          "INVALID_MESSAGE",
          "Input sequence is too far ahead.",
        );
        continue;
      }
      if (session.queue.length >= MAX_INPUT_QUEUE) continue;
      session.receivedSeq = command.seq;
      session.queue.push(command);
    }
  }

  private clearInput(session: Session, resetSequence: boolean): void {
    session.queue = [];
    if (resetSequence) session.ack = -1;
    session.receivedSeq = session.ack;
    session.controls = { ...NEUTRAL };
    session.controlTick = -Infinity;
    session.controlTime = -Infinity;
  }

  private publish(room: Room): void {
    room.view.tick = this.tick;
    for (const player of room.view.players)
      this.sessions
        .get(player.id)
        ?.peer?.send({ type: "room", room: room.view });
    const list = this.roomList();
    for (const session of this.sessions.values()) session.peer?.send(list);
  }

  private broadcastSnapshot(room: Room): void {
    const snapshot = this.snapshot(room);
    for (const player of room.view.players)
      this.sessions.get(player.id)?.peer?.send(snapshot);
  }

  private fail(session: Session, code: ErrorCode, message: string): void {
    if (session.peer) this.error(session.peer, code, message);
  }
  private error(
    peer: Peer,
    code: ErrorCode,
    message: string,
    fatal = false,
    closeCode = 1008,
  ): void {
    peer.send({ type: "error", code, message, fatal });
    if (fatal) peer.close(closeCode, code);
  }
}
