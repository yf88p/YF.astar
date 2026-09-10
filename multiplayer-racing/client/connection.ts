import {
  clientMessageSchema,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type RoomSummary,
  type RoomView,
  type Snapshot,
} from "../shared/protocol";

export interface ConnectionState {
  status: "connecting" | "online" | "reconnecting" | "offline" | "degraded";
  id: string;
  resumed: boolean;
  rooms: RoomSummary[];
  room: RoomView | null;
  snapshot: Snapshot | null;
  latency: number;
  error: { code: string; message: string } | null;
}
export class Connection {
  state: ConnectionState = {
    status: "connecting",
    id: "",
    resumed: false,
    rooms: [],
    room: null,
    snapshot: null,
    latency: 0,
    error: null,
  };
  private listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private attempt = 0;
  private lastMessage = performance.now();
  private lastSnapshot = performance.now();
  private started = false;
  private name = "Racer";
  private url = "";
  private stopRetry = false;
  onSnapshot: ((snapshot: Snapshot) => void) | null = null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private publish(update: Partial<ConnectionState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  async start(name: string) {
    if (this.started) return;
    this.started = true;
    this.name = name;
    window.addEventListener("offline", this.networkOffline);
    window.addEventListener("online", this.networkOnline);
    const fallback = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
    try {
      const config = await fetch("/api/config", {
        signal: AbortSignal.timeout(5000),
      }).then((r) => r.json());
      this.url = config.wsUrl || fallback;
    } catch {
      this.url = fallback;
    }
    if (!this.stopped) this.connect();
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      const now = performance.now();
      if (now - this.lastMessage > 8000) {
        this.socket.close();
        return;
      }
      if (
        this.state.room &&
        ["racing", "countdown"].includes(this.state.room.state) &&
        now - this.lastSnapshot > 1500
      )
        this.publish({ status: "degraded" });
      this.send({ type: "ping", nonce: Math.round(now) });
    }, 2000);
  }
  private networkOffline = () => {
    this.socket?.close();
  };
  private networkOnline = () => {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED)
      this.reconnect();
  };
  private connect() {
    if (this.stopped || this.stopRetry) return;
    this.publish({ status: this.attempt ? "reconnecting" : "connecting" });
    const socket = new WebSocket(this.url);
    const opening = setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) socket.close();
    }, 5000);
    this.socket = socket;
    socket.onopen = () => {
      clearTimeout(opening);
      this.lastMessage = performance.now();
      const token = sessionStorage.getItem("apex-reconnect") || undefined;
      this.send({
        type: "hello",
        version: PROTOCOL_VERSION,
        name: this.name,
        ...(token ? { token } : {}),
      });
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket || typeof event.data !== "string") return;
      const message = parseServerMessage(event.data);
      if (!message) {
        this.stopRetry = true;
        this.publish({
          error: {
            code: "VERSION_MISMATCH",
            message:
              "This client cannot read the server protocol. Reload to update.",
          },
        });
        socket.close();
        return;
      }
      this.lastMessage = performance.now();
      switch (message.type) {
        case "welcome":
          sessionStorage.setItem("apex-reconnect", message.token);
          this.attempt = 0;
          this.publish({
            id: message.id,
            resumed: message.resumed,
            status: "online",
            error:
              this.state.error?.code === "RECONNECT_EXPIRED"
                ? this.state.error
                : null,
            ...(!message.resumed ? { room: null, snapshot: null } : {}),
          });
          this.send({ type: "ping", nonce: Math.round(performance.now()) });
          break;
        case "rooms":
          this.publish({ rooms: message.rooms });
          break;
        case "room":
          this.publish({ room: message.room });
          break;
        case "left":
          this.publish({ room: null, snapshot: null });
          break;
        case "snapshot":
          if (
            message.code !== this.state.room?.code ||
            (this.state.snapshot?.code === message.code &&
              message.tick <= this.state.snapshot.tick)
          )
            return;
          this.lastSnapshot = performance.now();
          this.onSnapshot?.(message);
          this.publish({
            snapshot: message,
            status: this.state.latency > 250 ? "degraded" : "online",
            room: this.state.room
              ? {
                  ...this.state.room,
                  tick: message.tick,
                  startTick: message.startTick,
                  state: message.state,
                }
              : null,
          });
          break;
        case "pong": {
          const latency = Math.max(
            0,
            Math.round(performance.now() - message.nonce),
          );
          this.publish({
            latency,
            status: latency > 250 ? "degraded" : "online",
          });
          break;
        }
        case "error":
          this.publish({
            error: { code: message.code, message: message.message },
          });
          if (message.code === "KICKED")
            this.publish({ room: null, snapshot: null });
          if (message.code === "RECONNECT_EXPIRED") {
            sessionStorage.removeItem("apex-reconnect");
            this.publish({ room: null, snapshot: null });
          } else if (
            message.fatal &&
            message.code !== "SERVER_SHUTDOWN" &&
            message.code !== "RECONNECT_PENDING"
          )
            this.stopRetry = true;
          break;
      }
    };
    socket.onclose = () => {
      clearTimeout(opening);
      if (this.stopped || socket !== this.socket) return;
      this.attempt++;
      this.publish({ status: this.stopRetry ? "offline" : "reconnecting" });
      if (!this.stopRetry)
        this.retry = setTimeout(
          () => this.connect(),
          Math.min(500 * 2 ** Math.min(this.attempt - 1, 4), 5000),
        );
    };
    socket.onerror = () => socket.close();
  }
  send(message: ClientMessage): boolean {
    const checked = clientMessageSchema.safeParse(message);
    if (!checked.success) {
      this.publish({
        error: {
          code: "INVALID_MESSAGE",
          message: checked.error.issues[0]?.message || "Check your settings.",
        },
      });
      return false;
    }
    if (
      this.socket?.readyState !== WebSocket.OPEN ||
      this.socket.bufferedAmount > 32_768
    )
      return false;
    if (message.type === "name") this.name = message.name;
    this.socket.send(JSON.stringify(checked.data));
    return true;
  }
  clearError = () => this.publish({ error: null });
  newDriver = () => {
    sessionStorage.removeItem("apex-reconnect");
    this.publish({ room: null, snapshot: null, error: null });
    this.reconnect();
  };
  reconnect = () => {
    this.stopRetry = false;
    clearTimeout(this.retry);
    this.socket?.close();
    this.connect();
  };
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    window.removeEventListener("offline", this.networkOffline);
    window.removeEventListener("online", this.networkOnline);
    this.socket?.close();
  }
}
export const connection = new Connection();
