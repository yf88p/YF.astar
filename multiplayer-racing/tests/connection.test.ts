import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "../client/connection";
import type { ServerMessage, RoomView } from "../shared/protocol";

class Socket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) {
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = Socket.OPEN;
    this.onopen?.();
  }
  close() {
    if (this.readyState === Socket.CLOSED) return;
    this.readyState = Socket.CLOSED;
    this.onclose?.();
  }
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const clients: Connection[] = [];
const storage = new Map<string, string>();
const room: RoomView = {
  code: "ABCD",
  name: "Room",
  hostId: "driver",
  settings: { track: "canyon", laps: 1, capacity: 4, bots: 1 },
  state: "lobby",
  players: [],
  startTick: 0,
  tick: 10,
  region: "Local",
};
const welcome: ServerMessage = {
  type: "welcome",
  version: 1,
  id: "driver",
  token: "rotated-credential",
  resumed: true,
  serverTime: 1000,
  graceMs: 30000,
};

beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  storage.clear();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", { protocol: "http:", host: "race.test" });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: async () => ({ wsUrl: null }) }),
  );
});
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start() {
  const client = new Connection();
  clients.push(client);
  await client.start("Racer");
  const socket = Socket.instances.at(-1)!;
  socket.open();
  return { client, socket };
}

describe("client reconnect boundary", () => {
  it("retains a temporarily in-use credential and retries without creating a new identity", async () => {
    storage.set("apex-reconnect", "original-credential");
    const { client, socket } = await start();
    socket.receive({
      type: "error",
      code: "RECONNECT_PENDING",
      message: "Previous socket still active",
      fatal: true,
    });
    socket.close();
    expect(storage.get("apex-reconnect")).toBe("original-credential");
    expect(client.state.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(500);
    const retry = Socket.instances.at(-1)!;
    retry.open();
    expect(JSON.parse(retry.sent[0])).toMatchObject({
      type: "hello",
      token: "original-credential",
    });
    retry.receive(welcome);
    expect(client.state.id).toBe("driver");
    expect(client.state.error).toBeNull();
    expect(storage.get("apex-reconnect")).toBe("rotated-credential");
  });

  it("clears a removed room on authoritative left after a resumed welcome", async () => {
    const { client, socket } = await start();
    socket.receive({ type: "room", room });
    socket.receive(welcome);
    expect(client.state.room?.code).toBe("ABCD");
    socket.receive({ type: "left" });
    expect(client.state.room).toBeNull();
    expect(client.state.snapshot).toBeNull();
  });

  it("drops genuinely expired credentials and begins a fresh validated hello", async () => {
    storage.set("apex-reconnect", "expired");
    const { client, socket } = await start();
    socket.receive({ type: "room", room });
    socket.receive({
      type: "error",
      code: "RECONNECT_EXPIRED",
      message: "Expired",
      fatal: true,
    });
    socket.close();
    expect(storage.has("apex-reconnect")).toBe(false);
    expect(client.state.room).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    const retry = Socket.instances.at(-1)!;
    retry.open();
    expect(JSON.parse(retry.sent[0])).not.toHaveProperty("token");
  });

  it("stops retrying an incompatible or malformed server protocol", async () => {
    const { client, socket } = await start();
    socket.onmessage?.({ data: "not valid JSON" });
    expect(client.state.error?.code).toBe("VERSION_MISMATCH");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(Socket.instances).toHaveLength(1);
    expect(client.state.status).toBe("offline");
  });
});
