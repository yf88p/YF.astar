import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  production: boolean;
  publicUrl?: string;
  wsUrl?: string;
  allowedOrigins: string[];
  region: string;
  distDir: string;
}

function url(
  value: string | undefined,
  protocols: string[],
  key: string,
): string | undefined {
  if (!value) return undefined;
  const parsed = new URL(value);
  if (
    !protocols.includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search
  ) {
    throw new Error(
      `${key} must be an absolute ${protocols.join("/")} URL without credentials, query, or fragment`,
    );
  }
  return parsed.href;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    (env.PORT !== undefined && !/^\d+$/.test(env.PORT))
  )
    throw new Error("PORT must be an integer between 0 and 65535");
  const publicUrl = url(env.PUBLIC_URL, ["http:", "https:"], "PUBLIC_URL");
  const explicitWsUrl = url(env.WS_URL, ["ws:", "wss:"], "WS_URL");
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .filter((value) => value.trim())
    .map((value) => {
      const parsed = new URL(
        url(value.trim(), ["http:", "https:"], "ALLOWED_ORIGINS")!,
      );
      if (parsed.pathname !== "/")
        throw new Error("ALLOWED_ORIGINS entries must be origins, not paths");
      return parsed.origin;
    });
  if (publicUrl) allowedOrigins.push(new URL(publicUrl).origin);
  const derived = publicUrl ? new URL("/ws", publicUrl) : undefined;
  if (derived)
    derived.protocol = derived.protocol === "https:" ? "wss:" : "ws:";
  const region = env.REGION?.trim() || "Local";
  if (
    region.length > 40 ||
    [...region].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new Error("REGION must be at most 40 printable characters");
  return {
    host: env.HOST || "0.0.0.0",
    port,
    production: env.NODE_ENV === "production",
    publicUrl,
    wsUrl: explicitWsUrl ?? derived?.href,
    allowedOrigins: [...new Set(allowedOrigins)],
    region,
    distDir: resolve(fileURLToPath(new URL("../dist", import.meta.url))),
  };
}
