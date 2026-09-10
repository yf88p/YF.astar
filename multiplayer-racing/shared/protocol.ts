import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 20;
export const MAX_PLAYERS = 8;
export const MAX_MESSAGE_BYTES = 4096;
export const RECONNECT_GRACE_MS = 30_000;
export const trackIdSchema = z.enum(["canyon", "harbor"]);
export type TrackId = z.infer<typeof trackIdSchema>;
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(
    /^[\p{L}\p{N} _.'-]+$/u,
    "Use letters, numbers, spaces, or simple punctuation",
  );
export const roomNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N} _.'-]+$/u);
export const controlsSchema = z
  .object({
    throttle: z.number().finite().min(-1).max(1),
    steer: z.number().finite().min(-1).max(1),
    brake: z.boolean(),
    drift: z.boolean(),
    reset: z.boolean(),
  })
  .strict();
export type Controls = z.infer<typeof controlsSchema>;
export const NEUTRAL: Controls = {
  throttle: 0,
  steer: 0,
  brake: false,
  drift: false,
  reset: false,
};
export const inputSchema = z
  .object({
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    clientTime: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
    controls: controlsSchema,
  })
  .strict();
export type InputCommand = z.infer<typeof inputSchema>;
const roomSettingsSchema = z
  .object({
    track: trackIdSchema,
    laps: z.number().int().min(1).max(5),
    capacity: z.number().int().min(2).max(MAX_PLAYERS),
    bots: z.number().int().min(0).max(7),
  })
  .strict();
export type RoomSettings = z.infer<typeof roomSettingsSchema>;
export const clientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("hello"),
      version: z.number().int(),
      name: nameSchema,
      token: z.string().max(128).optional(),
    })
    .strict(),
  z.object({ type: z.literal("list") }).strict(),
  z
    .object({
      type: z.literal("create"),
      name: roomNameSchema,
      settings: roomSettingsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("join"),
      code: z
        .string()
        .min(4)
        .max(12)
        .regex(/^[A-Z0-9]+$/),
      spectator: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("quickJoin") }).strict(),
  z.object({ type: z.literal("leave") }).strict(),
  z.object({ type: z.literal("ready"), ready: z.boolean() }).strict(),
  z
    .object({ type: z.literal("settings"), settings: roomSettingsSchema })
    .strict(),
  z.object({ type: z.literal("name"), name: nameSchema }).strict(),
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("rematch") }).strict(),
  z.object({ type: z.literal("kick"), playerId: z.string().max(64) }).strict(),
  z
    .object({
      type: z.literal("input"),
      commands: z.array(inputSchema).min(1).max(6),
    })
    .strict(),
  z
    .object({
      type: z.literal("ping"),
      nonce: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

const number = z.number().finite();
export const carSchema = z.object({
  id: z.string(),
  x: number,
  z: number,
  yaw: number,
  vx: number,
  vz: number,
  speed: number,
  steer: number,
  drift: z.boolean(),
  offTrack: z.boolean(),
  checkpoint: z.number().int(),
  lap: z.number().int(),
  lapStartTick: z.number().int(),
  bestLapTicks: z.number().int().nullable(),
  lastLapTicks: z.number().int().nullable(),
  lapTimes: z.array(z.number().int()),
  finishTick: z.number().int().nullable(),
  penaltyTicks: z.number().int(),
  progress: number,
  resets: z.number().int(),
  collision: number,
  lastResetTick: z.number().int(),
});
export type CarState = z.infer<typeof carSchema>;
export const playerSchema = z.object({
  id: z.string(),
  name: z.string().max(24),
  color: z.string().max(16),
  ready: z.boolean(),
  connected: z.boolean(),
  spectator: z.boolean(),
  bot: z.boolean(),
});
export type Player = z.infer<typeof playerSchema>;
export const raceStateSchema = z.enum([
  "lobby",
  "countdown",
  "racing",
  "finished",
  "cancelled",
]);
export type RaceState = z.infer<typeof raceStateSchema>;
export const roomSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  track: trackIdSchema,
  laps: z.number().int(),
  players: z.number().int(),
  capacity: z.number().int(),
  spectators: z.number().int(),
  state: raceStateSchema,
  region: z.string(),
  bots: z.number().int(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;
export const roomSchema = z.object({
  code: z.string(),
  name: z.string(),
  hostId: z.string(),
  settings: roomSettingsSchema,
  state: raceStateSchema,
  players: z.array(playerSchema).max(24),
  startTick: z.number().int(),
  tick: z.number().int(),
  region: z.string(),
});
export type RoomView = z.infer<typeof roomSchema>;
export const resultSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number().int(),
  timeTicks: z.number().int().nullable(),
  bestLapTicks: z.number().int().nullable(),
  penaltyTicks: z.number().int(),
  dnf: z.boolean(),
});
export type RaceResult = z.infer<typeof resultSchema>;
export const snapshotSchema = z.object({
  type: z.literal("snapshot"),
  tick: z.number().int().min(0),
  serverTime: number,
  code: z.string(),
  state: raceStateSchema,
  startTick: z.number().int(),
  cars: z.array(carSchema).max(MAX_PLAYERS),
  ack: z.record(z.number().int()),
  results: z.array(resultSchema).max(MAX_PLAYERS),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const serverMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("welcome"),
      version: z.literal(PROTOCOL_VERSION),
      id: z.string(),
      token: z.string(),
      resumed: z.boolean(),
      serverTime: number,
      graceMs: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal("rooms"),
      rooms: z.array(roomSummarySchema),
      serverTime: number,
    })
    .strict(),
  z.object({ type: z.literal("room"), room: roomSchema }).strict(),
  snapshotSchema,
  z.object({ type: z.literal("left") }).strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.enum([
        "INVALID_MESSAGE",
        "VERSION_MISMATCH",
        "RATE_LIMITED",
        "ROOM_UNAVAILABLE",
        "ROOM_FULL",
        "RACE_STARTED",
        "NOT_HOST",
        "NOT_READY",
        "INVALID_STATE",
        "KICKED",
        "RECONNECT_EXPIRED",
        "RECONNECT_PENDING",
        "SERVER_SHUTDOWN",
      ]),
      message: z.string().max(200),
      fatal: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("pong"),
      nonce: z.number().int(),
      serverTime: number,
      tick: z.number().int(),
    })
    .strict(),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export function parseClientMessage(raw: string): ClientMessage | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) return null;
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function parseServerMessage(raw: string): ServerMessage | null {
  if (raw.length > 131_072) return null;
  try {
    const result = serverMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
