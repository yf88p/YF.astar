import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { ViteDevServer } from "vite";
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  TICK_RATE,
  parseClientMessage,
  type ServerMessage,
} from "../shared/protocol.js";
import { readConfig, type ServerConfig } from "./config.js";
import {
  RoomService,
  type Peer,
  type RoomServiceOptions,
  type Session,
} from "./rooms.js";
import { TokenBucket } from "./rate-limit.js";

export interface GameServerOptions
  extends Partial<ServerConfig>, RoomServiceOptions {
  dev?: boolean;
  autoTick?: boolean;
  maxCatchUpTicks?: number;
  heartbeatIntervalMs?: number;
  helloTimeoutMs?: number;
  stallTimeoutMs?: number;
}

export interface GameServer {
  server: Server;
  ws: WebSocketServer;
  rooms: RoomService;
  config: ServerConfig;
  port: number;
  url: string;
  close(): Promise<void>;
}

interface IpState {
  http: TokenBucket;
  upgrades: TokenBucket;
  messages: TokenBucket;
  inputs: TokenBucket;
  actions: TokenBucket;
  connections: number;
  seen: number;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".glb": "model/gltf-binary",
};
const MAX_BUFFERED_BYTES = 256 * 1024;

export async function createGameServer(
  options: GameServerOptions = {},
): Promise<GameServer> {
  const config: ServerConfig = { ...readConfig(), ...options };
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535)
    throw new Error("Invalid port");
  if (options.publicUrl && options.wsUrl === undefined) {
    const publicWs = new URL("/ws", options.publicUrl);
    publicWs.protocol = publicWs.protocol === "https:" ? "wss:" : "ws:";
    config.wsUrl = publicWs.href;
  }
  const dev =
    options.dev ?? (!config.production && process.env.NODE_ENV !== "test");
  if (config.production && dev)
    throw new Error("Development middleware cannot run in production");
  const now = options.now ?? Date.now;
  const rooms = new RoomService({ ...options, region: config.region, now });
  const ws = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    clientTracking: true,
  });
  const ips = new Map<string, IpState>();
  const tcpSockets = new Set<Socket>();
  let ready = false;
  let closing: Promise<void> | undefined;
  let vite: ViteDevServer | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const peers = new Map<
    WebSocket,
    {
      alive: boolean;
      lastMessage: number;
      blockedAt: number | null;
      dispose(): void;
    }
  >();

  function ipState(request: IncomingMessage): IpState | undefined {
    // Forwarded headers are intentionally not trusted. Terminate proxy trust at the deployment boundary.
    const key = request.socket.remoteAddress ?? "unknown";
    let state = ips.get(key);
    if (!state) {
      if (ips.size >= 4096) return undefined;
      state = {
        http: new TokenBucket(40, 80, now()),
        upgrades: new TokenBucket(1, 20, now()),
        messages: new TokenBucket(600, 1200, now()),
        inputs: new TokenBucket(960, 384, now()),
        actions: new TokenBucket(32, 64, now()),
        connections: 0,
        seen: now(),
      };
      ips.set(key, state);
    }
    state.seen = now();
    return state;
  }

  function validOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    // Native clients have no Origin. Browsers cannot opt out of sending it on a WebSocket handshake.
    if (origin === undefined) return true;
    if (origin === "null") return false;
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin
    )
      return false;
    if (
      config.allowedOrigins.includes(origin) ||
      (config.publicUrl && origin === new URL(config.publicUrl).origin)
    )
      return true;
    // Production requires a configured browser origin instead of trusting attacker-controlled Host.
    if (config.production) return false;
    return (
      origin === `http://${request.headers.host}` ||
      origin === `https://${request.headers.host}`
    );
  }

  function json(
    response: ServerResponse,
    status: number,
    value: unknown,
  ): void {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
  }

  async function staticFile(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let path: string;
    try {
      path = decodeURIComponent((request.url ?? "/").split("?")[0]);
    } catch {
      json(response, 400, { error: "Invalid path" });
      return;
    }
    if (
      !path.startsWith("/") ||
      path.includes("\\") ||
      [...path].some((char) => char.charCodeAt(0) < 32) ||
      path.split("/").some((part) => part.startsWith("."))
    ) {
      json(response, 400, { error: "Invalid path" });
      return;
    }
    let root: string;
    try {
      root = await realpath(config.distDir);
    } catch {
      json(response, 503, { error: "Build assets with npm run build first" });
      return;
    }
    let target = resolve(root, `.${path}`);
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = resolve(target, "index.html");
    } catch {
      if (extname(path) || !request.headers.accept?.includes("text/html")) {
        json(response, 404, { error: "Not found" });
        return;
      }
      target = resolve(root, "index.html");
    }
    try {
      target = await realpath(target);
      const inside = relative(root, target);
      if (inside.startsWith("..") || isAbsolute(inside)) {
        json(response, 403, { error: "Forbidden" });
        return;
      }
      const info = await stat(target);
      if (!info.isFile()) {
        json(response, 404, { error: "Not found" });
        return;
      }
      response.writeHead(200, {
        "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const stream = createReadStream(target);
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch {
      json(response, 404, { error: "Not found" });
    }
  }

  const server = createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    const ip = ipState(request);
    if (!ip || !ip.http.take(now())) {
      response.setHeader("Retry-After", "1");
      json(response, 429, { error: "Rate limited" });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      json(response, 405, { error: "Method not allowed" });
      return;
    }
    const path = (request.url ?? "/").split("?")[0];
    if (path === "/health" || path === "/api/health") {
      json(response, 200, { status: "ok" });
      return;
    }
    if (path === "/ready" || path === "/api/ready") {
      json(response, ready ? 200 : 503, { ready });
      return;
    }
    if (path === "/api/config") {
      json(response, 200, {
        wsUrl: config.wsUrl ?? null,
        region: config.region,
        protocolVersion: PROTOCOL_VERSION,
      });
      return;
    }
    if (path.startsWith("/api/")) {
      json(response, 404, { error: "Not found" });
      return;
    }
    if (path === "/ws") {
      json(response, 426, { error: "WebSocket upgrade required" });
      return;
    }
    if (!ready) {
      json(response, 503, { error: "Server unavailable" });
      return;
    }
    if (vite)
      vite.middlewares(request, response, () =>
        json(response, 404, { error: "Not found" }),
      );
    else
      void staticFile(request, response).catch(() => {
        if (!response.headersSent)
          json(response, 500, { error: "Internal error" });
        else response.destroy();
      });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;
  server.maxConnections = 1024;
  server.setTimeout(15_000, (socket) => socket.destroy());
  server.on("connection", (socket) => {
    tcpSockets.add(socket);
    socket.on("close", () => tcpSockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => socket.destroy());

  server.on("upgrade", (request, socket, head) => {
    const reject = (status: number, reason: string) => {
      socket.end(
        `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    };
    const ip = ipState(request);
    if (!ready) {
      reject(503, "Service Unavailable");
      return;
    }
    if (
      !ip ||
      !ip.upgrades.take(now()) ||
      ip.connections >= 32 ||
      ws.clients.size >= 512
    ) {
      reject(429, "Too Many Requests");
      return;
    }
    if (!validOrigin(request)) {
      reject(403, "Forbidden");
      return;
    }
    const path = (request.url ?? "/").split("?")[0];
    if (vite && path === "/__vite_hmr") return;
    if (path !== "/ws" || request.method !== "GET") {
      reject(404, "Not Found");
      return;
    }
    ws.handleUpgrade(request, socket, head, (client) => {
      ip.connections++;
      client.once("close", () => {
        ip.connections--;
        ip.seen = now();
      });
      ws.emit("connection", client, request, ip);
    });
  });

  ws.on(
    "connection",
    (socket: WebSocket, _request: IncomingMessage, ip: IpState) => {
      let session: Session | null = null;
      let violations = 0;
      let ending = false;
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      const messages = new TokenBucket(60, 120, now());
      const state = {
        alive: true,
        lastMessage: now(),
        blockedAt: null as number | null,
        dispose: () => {
          clearTimeout(helloTimer);
          clearTimeout(closeTimer);
        },
      };
      const peer: Peer = {
        send(message) {
          if (ending || socket.readyState !== WebSocket.OPEN) return;
          if (
            message.type === "error" &&
            ["INVALID_MESSAGE", "RATE_LIMITED"].includes(message.code)
          ) {
            violations++;
            if (violations >= 5) message = { ...message, fatal: true };
          }
          if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
            state.blockedAt ??= now();
            if (
              message.type !== "snapshot" ||
              socket.bufferedAmount > MAX_BUFFERED_BYTES * 4 ||
              now() - state.blockedAt >= 5000
            )
              peer.close(1013, "Slow consumer");
            return;
          }
          state.blockedAt = null;
          socket.send(JSON.stringify(message), (error) => {
            if (error) socket.terminate();
          });
          if (message.type === "error" && message.fatal)
            peer.close(
              message.code === "SERVER_SHUTDOWN" ? 1001 : 1008,
              message.code,
            );
        },
        close(code = 1008, reason = "Connection closed") {
          if (ending) return;
          ending = true;
          socket.close(code, reason);
          closeTimer = setTimeout(() => socket.terminate(), 1000);
          closeTimer.unref();
        },
      };
      function error(
        code: Extract<ServerMessage, { type: "error" }>["code"],
        message: string,
        fatal = false,
      ): void {
        peer.send({ type: "error", code, message, fatal });
        if (fatal) peer.close(1008, code);
      }
      const helloTimer = setTimeout(
        () =>
          error("INVALID_MESSAGE", "Send hello before other messages.", true),
        options.helloTimeoutMs ?? 5000,
      );
      helloTimer.unref();
      peers.set(socket, state);
      socket.on("pong", () => {
        if (!messages.take(now()) || !ip.messages.take(now()))
          peer.close(1008, "Control frame rate limited");
        else state.alive = true;
      });
      socket.on("ping", () => {
        if (!messages.take(now()) || !ip.messages.take(now()))
          peer.close(1008, "Control frame rate limited");
      });
      // ws closes protocol violations itself (including 1009 for maxPayload); retain that close frame.
      socket.on("error", () => {
        closeTimer ??= setTimeout(() => socket.terminate(), 1000);
        closeTimer.unref();
      });
      socket.on("close", () => {
        state.dispose();
        peers.delete(socket);
        if (session) rooms.disconnect(session, peer);
      });
      socket.on("message", (data: RawData, binary: boolean) => {
        if (ending) return;
        state.lastMessage = now();
        ip.seen = now();
        if (!messages.take(now()) || !ip.messages.take(now())) {
          error("RATE_LIMITED", "Message rate exceeded.");
          return;
        }
        const buffer = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : data;
        if (binary || buffer.byteLength > MAX_MESSAGE_BYTES) {
          error(
            "INVALID_MESSAGE",
            "Only bounded UTF-8 JSON text messages are accepted.",
            true,
          );
          return;
        }
        const message = parseClientMessage(buffer.toString("utf8"));
        if (!message) {
          error(
            "INVALID_MESSAGE",
            "Message does not match the shared protocol.",
          );
          return;
        }
        if (!session) {
          if (message.type !== "hello") {
            error("INVALID_MESSAGE", "The first message must be hello.", true);
            return;
          }
          if (message.version !== PROTOCOL_VERSION) {
            error(
              "VERSION_MISMATCH",
              "Reload the app to use the current protocol version.",
              true,
            );
            return;
          }
          clearTimeout(helloTimer);
          session = rooms.connect(message.name, message.token, peer);
          return;
        }
        if (message.type === "hello") {
          error("INVALID_MESSAGE", "Hello may only be sent once.");
          return;
        }
        if (
          message.type === "input" &&
          !ip.inputs.take(now(), message.commands.length)
        ) {
          error("RATE_LIMITED", "IP input rate exceeded.");
          return;
        }
        if (message.type !== "input" && !ip.actions.take(now())) {
          error("RATE_LIMITED", "IP request rate exceeded.");
          return;
        }
        rooms.handle(session, message);
      });
    },
  );

  async function close(): Promise<void> {
    if (closing) return closing;
    ready = false;
    closing = (async () => {
      clearInterval(tickTimer);
      clearInterval(heartbeat);
      rooms.shutdown();
      for (const client of ws.clients) client.close(1001, "Server shutdown");
      const force = setTimeout(() => {
        for (const client of ws.clients) client.terminate();
        for (const socket of tcpSockets) socket.destroy();
      }, 1000);
      force.unref();
      try {
        await Promise.all([
          new Promise<void>((resolveClose) => ws.close(() => resolveClose())),
          new Promise<void>((resolveClose) =>
            server.close(() => resolveClose()),
          ),
          vite?.close(),
        ]);
      } finally {
        clearTimeout(force);
        for (const state of peers.values()) state.dispose();
        peers.clear();
        ips.clear();
      }
    })();
    return closing;
  }

  try {
    if (dev) {
      const { createServer: createViteServer } = await import("vite");
      vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: { server, path: "/__vite_hmr" },
          allowedHosts: config.publicUrl
            ? [new URL(config.publicUrl).hostname]
            : undefined,
        },
        appType: "spa",
      });
    }
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(config.port, config.host, () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    ready = true;
    if (options.autoTick !== false) {
      const tickMs = 1000 / TICK_RATE;
      const maxCatchUp = options.maxCatchUpTicks ?? 5;
      if (!Number.isInteger(maxCatchUp) || maxCatchUp < 1 || maxCatchUp > 60)
        throw new Error("maxCatchUpTicks must be between 1 and 60");
      let previous = performance.now();
      let accumulated = 0;
      tickTimer = setInterval(() => {
        const time = performance.now();
        accumulated = Math.min(
          accumulated + time - previous,
          tickMs * maxCatchUp,
        );
        previous = time;
        const ticks = Math.floor((accumulated + 1e-7) / tickMs);
        accumulated -= ticks * tickMs;
        rooms.advance(ticks);
      }, tickMs / 2);
      tickTimer.unref();
    }
    heartbeat = setInterval(() => {
      rooms.sweep();
      for (const [socket, state] of peers) {
        if (
          !state.alive ||
          now() - state.lastMessage > (options.stallTimeoutMs ?? 90_000) ||
          (state.blockedAt !== null && now() - state.blockedAt > 5000)
        ) {
          socket.terminate();
          continue;
        }
        state.alive = false;
        if (socket.readyState === WebSocket.OPEN) socket.ping();
      }
      for (const [key, ip] of ips)
        if (ip.connections === 0 && now() - ip.seen >= 60_000) ips.delete(key);
    }, options.heartbeatIntervalMs ?? 15_000);
    heartbeat.unref();
  } catch (error) {
    await close();
    throw error;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    await close();
    throw new Error("No TCP address");
  }
  const host =
    config.host === "0.0.0.0" || config.host === "::"
      ? "127.0.0.1"
      : config.host;
  return {
    server,
    ws,
    rooms,
    config,
    port: address.port,
    url: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`,
    close,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void createGameServer()
    .then((game) => {
      console.log(`Apex server listening on ${game.config.host}:${game.port}`);
      const stop = () => {
        void game.close().then(() => {
          process.exitCode = 0;
        });
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
