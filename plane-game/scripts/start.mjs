import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => child.kill(signal));
  });
}

if (
  !existsSync(new URL("../node_modules/vite/bin/vite.js", import.meta.url)) ||
  !existsSync(new URL("../node_modules/three/package.json", import.meta.url))
) {
  console.log("\nPreparing Aeronaut for its first flight...\n");
  const code = await run(npm, ["install", "--no-audit", "--no-fund"]);
  if (code) process.exit(code);
}
process.exit(
  await run(process.execPath, [
    fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
    "--host",
    "0.0.0.0",
    "--port",
    "5173",
    ...process.argv.slice(2),
  ]),
);
