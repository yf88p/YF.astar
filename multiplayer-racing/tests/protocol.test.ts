import { describe, expect, it } from "vitest";
import {
  clientMessageSchema,
  controlsSchema,
  inputSchema,
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  NEUTRAL,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  SNAPSHOT_RATE,
  TICK_RATE,
  type ClientMessage,
  type ServerMessage,
  type Snapshot,
} from "../shared/protocol";
import { createCar } from "../shared/simulation";
import { TRACKS } from "../shared/tracks";

const settings = { track: "canyon", laps: 3, capacity: 8, bots: 2 } as const;
const command = {
  seq: 0,
  clientTime: 123.5,
  controls: { ...NEUTRAL, throttle: 1 },
};
const clients: ClientMessage[] = [
  {
    type: "hello",
    version: PROTOCOL_VERSION,
    name: "Driver",
    token: "resume-token",
  },
  { type: "list" },
  { type: "create", name: "Night Drive", settings },
  { type: "join", code: "AB12", spectator: false },
  { type: "quickJoin" },
  { type: "leave" },
  { type: "ready", ready: true },
  { type: "settings", settings },
  { type: "name", name: "Driver" },
  { type: "start" },
  { type: "rematch" },
  { type: "kick", playerId: "driver" },
  { type: "input", commands: [command] },
  { type: "ping", nonce: 123 },
];
const room = {
  code: "AB12",
  name: "Night Drive",
  hostId: "driver",
  settings,
  state: "countdown",
  players: [
    {
      id: "driver",
      name: "Driver",
      color: "#ff6600",
      ready: true,
      connected: true,
      spectator: false,
      bot: false,
    },
  ],
  startTick: 180,
  tick: 0,
  region: "Local",
} as const;
const fullSnapshot: Snapshot = {
  type: "snapshot",
  tick: 0,
  serverTime: 1_800_000_000_000,
  code: "AB12",
  state: "countdown",
  startTick: 180,
  cars: Array.from({ length: MAX_PLAYERS }, (_, i) =>
    createCar(`driver-${i}`, TRACKS.canyon, i, 180),
  ),
  ack: { "driver-0": -1, "driver-1": 123 },
  results: [],
};
const servers: ServerMessage[] = [
  {
    type: "welcome",
    version: PROTOCOL_VERSION,
    id: "driver",
    token: "new-token",
    resumed: true,
    serverTime: 1_800_000_000_000,
    graceMs: 30_000,
  },
  {
    type: "rooms",
    rooms: [
      {
        code: room.code,
        name: room.name,
        track: "canyon",
        laps: 3,
        players: 4,
        capacity: 8,
        spectators: 2,
        state: "lobby",
        region: "Local",
        bots: 2,
      },
    ],
    serverTime: 1_800_000_000_000,
  },
  { type: "room", room: { ...room, players: [...room.players] } },
  fullSnapshot,
  { type: "left" },
  {
    type: "error",
    code: "INVALID_MESSAGE",
    message: "Invalid input",
    fatal: false,
  },
  { type: "pong", nonce: 123, serverTime: 1_800_000_000_000, tick: 3 },
];

describe("protocol compatibility", () => {
  it("pins protocol version, fixed simulation cadence, snapshot cadence, and payload/player limits", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(TICK_RATE).toBe(60);
    expect(SNAPSHOT_RATE).toBe(20);
    expect(TICK_RATE / SNAPSHOT_RATE).toBe(3);
    expect(MAX_PLAYERS).toBe(8);
    expect(MAX_MESSAGE_BYTES).toBe(4096);
  });

  it.each(clients)("round-trips the $type client message", (message) => {
    expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
  });

  it.each(servers)("round-trips the $type server message", (message) => {
    expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
  });

  it("permits version negotiation in hello but refuses an incompatible welcome", () => {
    expect(
      parseClientMessage(
        JSON.stringify({ type: "hello", version: 2, name: "Driver" }),
      ),
    ).toEqual({ type: "hello", version: 2, name: "Driver" });
    expect(
      parseServerMessage(JSON.stringify({ ...servers[0], version: 2 })),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ type: "hello", version: "1", name: "Driver" }),
      ),
    ).toBeNull();
  });

  it("accepts full eight-car snapshots beyond the client byte limit, including final results and ack -1", () => {
    const results = fullSnapshot.cars.map((car, i) => ({
      id: car.id,
      name: `Driver ${i} With A Long Name`,
      position: i + 1,
      timeTicks: i ? null : 1200,
      bestLapTicks: i ? null : 400,
      penaltyTicks: 0,
      dnf: i !== 0,
    }));
    const message: Snapshot = {
      ...fullSnapshot,
      state: "finished",
      tick: 1500,
      results,
    };
    const raw = JSON.stringify(message);
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(
      MAX_MESSAGE_BYTES,
    );
    expect(parseServerMessage(raw)).toEqual(message);
    expect(
      parseServerMessage(
        JSON.stringify({
          ...message,
          cars: [...message.cars, message.cars[0]],
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ ...message, results: [...results, results[0]] }),
      ),
    ).toBeNull();
  });
});

describe("untrusted client validation", () => {
  it.each(clients)(
    "rejects extra top-level authority fields on $type",
    (message) => {
      for (const field of [
        "x",
        "speed",
        "lap",
        "finishTick",
        "results",
        "ack",
        "playerIdOverride",
        "__proto__",
      ]) {
        expect(
          parseClientMessage(
            JSON.stringify({
              ...message,
              [field]: field === "__proto__" ? { polluted: true } : 1,
            }),
          ),
        ).toBeNull();
      }
    },
  );

  it("rejects nested authority, arbitrary settings, and prototype-related keys", () => {
    const invalid: unknown[] = [
      { ...command, x: 10 },
      { ...command, dt: 10 },
      { ...command, tick: 123 },
      { ...command, controls: { ...command.controls, speed: 70 } },
      { ...command, controls: { ...command.controls, constructor: {} } },
      { ...command, controls: { ...command.controls, prototype: {} } },
    ];
    for (const value of invalid)
      expect(
        parseClientMessage(
          JSON.stringify({ type: "input", commands: [value] }),
        ),
      ).toBeNull();
    for (const type of ["create", "settings"]) {
      const base = type === "create" ? { type, name: "Room" } : { type };
      expect(
        parseClientMessage(
          JSON.stringify({ ...base, settings: { ...settings, startTick: 0 } }),
        ),
      ).toBeNull();
    }
    expect(
      parseClientMessage(
        '{"type":"input","commands":[{"seq":0,"clientTime":0,"controls":{"throttle":0,"steer":0,"brake":false,"drift":false,"reset":false,"__proto__":{"polluted":true}}}]}',
      ),
    ).toBeNull();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it.each(["throttle", "steer"] as const)(
    "strictly bounds finite numeric %s controls without coercion",
    (field) => {
      for (const value of [-1, 0, 0.25, 1])
        expect(
          controlsSchema.safeParse({ ...NEUTRAL, [field]: value }).success,
        ).toBe(true);
      for (const value of [
        -1.00001,
        1.00001,
        NaN,
        Infinity,
        -Infinity,
        "1",
        null,
        true,
        [],
        {},
      ]) {
        expect(
          controlsSchema.safeParse({ ...NEUTRAL, [field]: value }).success,
        ).toBe(false);
        expect(
          parseClientMessage(
            JSON.stringify({
              type: "input",
              commands: [
                { ...command, controls: { ...NEUTRAL, [field]: value } },
              ],
            }),
          ),
        ).toBeNull();
      }
    },
  );

  it.each(["brake", "drift", "reset"] as const)(
    "requires an explicit boolean %s",
    (field) => {
      for (const value of [0, 1, "false", null, undefined]) {
        expect(
          parseClientMessage(
            JSON.stringify({
              type: "input",
              commands: [
                { ...command, controls: { ...NEUTRAL, [field]: value } },
              ],
            }),
          ),
        ).toBeNull();
      }
    },
  );

  it("requires safe integer sequences and bounded finite timestamps, but allows fractional milliseconds", () => {
    for (const seq of [0, 1, Number.MAX_SAFE_INTEGER])
      expect(inputSchema.safeParse({ ...command, seq }).success).toBe(true);
    for (const seq of [
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      NaN,
      "1",
      null,
    ]) {
      expect(inputSchema.safeParse({ ...command, seq }).success).toBe(false);
    }
    for (const clientTime of [0, 0.125, Number.MAX_SAFE_INTEGER]) {
      expect(
        parseClientMessage(
          JSON.stringify({
            type: "input",
            commands: [{ ...command, clientTime }],
          }),
        ),
      ).not.toBeNull();
    }
    for (const clientTime of [
      -1,
      -0.01,
      Number.MAX_SAFE_INTEGER + 1,
      1e100,
      Infinity,
      -Infinity,
      NaN,
      "100",
      null,
    ]) {
      expect(inputSchema.safeParse({ ...command, clientTime }).success).toBe(
        false,
      );
      expect(
        parseClientMessage(
          JSON.stringify({
            type: "input",
            commands: [{ ...command, clientTime }],
          }),
        ),
      ).toBeNull();
    }
  });

  it("requires one to six complete commands and never accepts a partly valid batch", () => {
    for (const count of [1, 6]) {
      expect(
        parseClientMessage(
          JSON.stringify({
            type: "input",
            commands: Array.from({ length: count }, (_, seq) => ({
              ...command,
              seq,
            })),
          }),
        ),
      ).not.toBeNull();
    }
    for (const commands of [
      [],
      Array(7).fill(command),
      [command, { ...command, seq: -1 }],
      [null],
      {},
      command,
    ]) {
      expect(
        parseClientMessage(JSON.stringify({ type: "input", commands })),
      ).toBeNull();
    }
    for (const field of ["seq", "clientTime", "controls"]) {
      expect(
        parseClientMessage(
          JSON.stringify({
            type: "input",
            commands: [{ ...command, [field]: undefined }],
          }),
        ),
      ).toBeNull();
    }
  });

  it("bounds room settings, join codes, identity strings, readiness, and ping nonces", () => {
    for (const settingsPatch of [
      { track: "unknown" },
      { laps: 0 },
      { laps: 6 },
      { laps: 1.5 },
      { capacity: 1 },
      { capacity: 9 },
      { bots: -1 },
      { bots: 8 },
      { capacity: "8" },
    ])
      expect(
        clientMessageSchema.safeParse({
          type: "settings",
          settings: { ...settings, ...settingsPatch },
        }).success,
      ).toBe(false);
    const invalid = [
      { type: "join", code: "abc1", spectator: false },
      { type: "join", code: "ABC", spectator: false },
      { type: "join", code: "A".repeat(13), spectator: false },
      { type: "join", code: "AB/1", spectator: false },
      { type: "join", code: "AB12", spectator: 0 },
      { type: "ready", ready: "true" },
      { type: "hello", version: 1, name: "Driver", token: "a".repeat(129) },
      { type: "kick", playerId: "a".repeat(65) },
      { type: "ping", nonce: -1 },
      { type: "ping", nonce: 1.1 },
      { type: "ping", nonce: Number.MAX_SAFE_INTEGER + 1 },
    ];
    for (const message of invalid)
      expect(parseClientMessage(JSON.stringify(message))).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ type: "ping", nonce: Number.MAX_SAFE_INTEGER }),
      ),
    ).not.toBeNull();
  });

  it("trims valid international names and rejects injection, control characters, malformed Unicode, and overlength names", () => {
    for (const name of [
      "Driver 7",
      "O'Neil-Smith",
      "A.B_C",
      "\u00c9lodie",
      "\u65e5\u672c",
      "\u0413\u043e\u043d\u0449\u0438\u043a",
      "\ud801\udc00",
    ]) {
      expect(
        parseClientMessage(
          JSON.stringify({ type: "name", name: `  ${name}  ` }),
        ),
      ).toEqual({ type: "name", name });
    }
    for (const name of [
      "",
      "   ",
      "a".repeat(25),
      "<script>",
      "A\nB",
      "A\u0000B",
      "A\u202eB",
      "\ud800",
      "\udc00",
      "\ufffd",
      "\ud83d\ude97",
    ]) {
      expect(
        parseClientMessage(JSON.stringify({ type: "name", name })),
      ).toBeNull();
    }
    expect(
      parseClientMessage(
        JSON.stringify({ type: "name", name: "a".repeat(24) }),
      ),
    ).not.toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ type: "create", name: "a".repeat(40), settings }),
      ),
    ).not.toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ type: "create", name: "a".repeat(41), settings }),
      ),
    ).toBeNull();
    const decodedInvalidUtf8 = new TextDecoder().decode(
      Uint8Array.from([0xc3, 0x28]),
    );
    expect(
      parseClientMessage(
        JSON.stringify({ type: "name", name: decodedInvalidUtf8 }),
      ),
    ).toBeNull();
  });

  it("enforces exactly 4096 UTF-8 bytes rather than UTF-16 code units, including astral characters", () => {
    for (const character of ["a", "\u65e5", "\ud801\udc00"]) {
      const name = character.repeat(6);
      const message = { type: "name", name };
      const compact = JSON.stringify(message);
      const bytes = new TextEncoder().encode(compact).byteLength;
      const boundary = compact + " ".repeat(MAX_MESSAGE_BYTES - bytes);
      expect(new TextEncoder().encode(boundary).byteLength).toBe(
        MAX_MESSAGE_BYTES,
      );
      expect(parseClientMessage(boundary)).toEqual(message);
      expect(parseClientMessage(boundary + " ")).toBeNull();
      if (character !== "a")
        expect((boundary + " ").length).toBeLessThan(MAX_MESSAGE_BYTES);
    }
    expect(parseClientMessage(" ".repeat(MAX_MESSAGE_BYTES + 1))).toBeNull();
  });
});

describe("malformed wire messages", () => {
  it.each([
    "",
    " ",
    "{",
    '{"type":',
    '{"type":"list",}',
    "null",
    "true",
    "42",
    '"list"',
    "[]",
    "{}",
    '{"type":"unknown"}',
    '{"type":"list"}\n{}',
    '\ufeff{"type":"list"}',
    '{"type":"name","name":"\\uZZZZ"}',
  ])("rejects malformed or unknown input %j without throwing", (raw) => {
    expect(parseClientMessage(raw)).toBeNull();
    expect(parseServerMessage(raw)).toBeNull();
  });

  it("rejects JSON numeric overflow and wrong message directions", () => {
    expect(
      parseClientMessage(
        '{"type":"input","commands":[{"seq":0,"clientTime":1e999,"controls":{"throttle":0,"steer":0,"brake":false,"drift":false,"reset":false}}]}',
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        '{"type":"pong","nonce":1,"serverTime":1e999,"tick":0}',
      ),
    ).toBeNull();
    for (const message of clients)
      expect(parseServerMessage(JSON.stringify(message))).toBeNull();
    for (const message of servers)
      expect(parseClientMessage(JSON.stringify(message))).toBeNull();
  });

  it("rejects malformed server physics, ticks, acks, results, and oversized server messages", () => {
    for (const patch of [
      { tick: -1 },
      { tick: 0.5 },
      { serverTime: null },
      { ack: { driver: 0.5 } },
      { state: "won" },
    ]) {
      expect(
        parseServerMessage(JSON.stringify({ ...fullSnapshot, ...patch })),
      ).toBeNull();
    }
    for (const patch of [
      { x: null },
      { yaw: "0" },
      { vx: Infinity },
      { finishTick: 0.5 },
      { lapTimes: ["123"] },
      { collision: {} },
    ]) {
      expect(
        parseServerMessage(
          JSON.stringify({
            ...fullSnapshot,
            cars: [{ ...fullSnapshot.cars[0], ...patch }],
          }),
        ),
      ).toBeNull();
    }
    expect(
      parseServerMessage(
        JSON.stringify({
          ...fullSnapshot,
          results: [{ id: "driver", position: 1 }],
        }),
      ),
    ).toBeNull();
    const compact = JSON.stringify({ type: "left" });
    expect(
      parseServerMessage(compact + " ".repeat(131_072 - compact.length)),
    ).toEqual({ type: "left" });
    expect(
      parseServerMessage(compact + " ".repeat(131_073 - compact.length)),
    ).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ ...servers[0], extra: true })),
    ).toBeNull();
  });
});
