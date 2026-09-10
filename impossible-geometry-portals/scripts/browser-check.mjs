import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const output =
  process.env.PARALLAX_ARTIFACTS || "/tmp/opencode/parallax-browser";
const reportPath = path.join(root, "docs/verification.json");
const report = {
  generatedAt: new Date().toISOString(),
  checks: [],
  screenshots: [],
  consoleErrors: [],
  pageErrors: [],
  externalRequests: [],
  notes: [
    "Solution checks click the actual field-guide replay UI, then accelerate only SolutionReplay.update. No solution flags, room assignments, or cube translations are used.",
    "Rendering and interaction fixtures use validated documents and public World.moveBody for setup. Renderer-only occlusion fixtures are explicitly identified.",
    "Frame timings are actual headless Chromium requestAnimationFrame intervals with software WebGL, not a hardware performance claim.",
    "Headless pointer capture can emit cursor-warp deltas which cancel synthetic mouse movement. The desktop look check records actual mouse-event-driven yaw changes, not a guaranteed final aim. Precision pickup/throw uses real touch UI plus keyboard events.",
  ],
};
let browser, context, page, preview;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(message);
const sourcePaths = [
  "src/main.js",
  "src/render.js",
  "src/core.js",
  "src/editor.js",
  "src/replay.js",
  "src/levels.js",
];
async function sourceHashes() {
  return Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (name) => [
        name,
        hash(await readFile(path.join(root, name))),
      ]),
    ),
  );
}
async function localOnly(route) {
  const request = new URL(route.request().url());
  if (
    ["http:", "https:"].includes(request.protocol) &&
    !["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)
  ) {
    report.externalRequests.push(route.request().url());
    await route.abort();
  } else await route.continue();
}

async function command(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
    process.stdout.write(data);
  });
  child.stderr.on("data", (data) => {
    output += data;
    process.stderr.write(data);
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  return { command: [command, ...args].join(" "), code, output };
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function check(name, run) {
  if (
    process.env.PARALLAX_CHECK &&
    !name.includes(process.env.PARALLAX_CHECK)
  ) {
    report.checks.push({ name, status: "not-run" });
    return;
  }
  const start = performance.now();
  try {
    const evidence = await run();
    report.checks.push({
      name,
      status: "passed",
      durationMs: performance.now() - start,
      evidence,
    });
    log(`PASS ${name}`);
  } catch (error) {
    const state =
      page && !page.isClosed()
        ? await page
            .evaluate(() =>
              window.parallax
                ? {
                    mode: parallax.mode,
                    input: parallax.world.input,
                    room: parallax.world.player.room,
                    position: parallax.world.player.position.toArray(),
                    held: parallax.world.held,
                    pointerLocked: !!document.pointerLockElement,
                  }
                : null,
            )
            .catch(() => null)
        : null;
    report.checks.push({
      name,
      status: "failed",
      durationMs: performance.now() - start,
      error: error.stack,
      state,
    });
    log(`FAIL ${name}: ${error.message}`);
    if (page && !page.isClosed())
      await screenshot(`failure-${report.checks.length}`).catch(() => {});
    if (page && !page.isClosed()) {
      await page
        .evaluate(() => {
          for (const dialog of document.querySelectorAll("dialog[open]"))
            dialog.close();
          parallax.pause();
        })
        .catch(() => {});
    }
  }
}

async function screenshot(name, canvas = false) {
  const file = path.join(output, `${name}.png`);
  // Full-page capture in this Chromium/Playwright combination resets coarse-pointer
  // emulation. Exact viewport captures preserve the mobile interaction environment.
  const data = canvas
    ? await page
        .locator("#viewport canvas")
        .screenshot({ path: file, timeout: 30000 })
    : await page.screenshot({ path: file, fullPage: false, timeout: 30000 });
  const result = { name, file, sha256: hash(data), bytes: data.length };
  report.screenshots.push(result);
  return result;
}

async function frames(count = 2) {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        function next() {
          if (--count <= 0) resolve();
          else requestAnimationFrame(next);
        }
        requestAnimationFrame(next);
      }),
    count,
  );
}

async function selectLevel(index) {
  await page.evaluate(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  });
  for (const close of await page.locator("dialog[open] [data-close]").all()) {
    if (await close.isVisible()) {
      await close.click();
      break;
    }
  }
  if (await page.evaluate(() => parallax.mode === "editor"))
    await page.locator("#nav-play").click();
  await page.locator(`[data-level="${index}"]`).click();
  await frames();
}

async function section(id) {
  const element = page.locator(`[data-section="${id}"]`);
  if (!((await element.getAttribute("open")) !== null))
    await element.locator("summary").click();
}

async function form(name, values) {
  for (const [key, value] of Object.entries(values)) {
    const input = page.locator(`[data-form="${name}"] [name="${key}"]`);
    if (await input.evaluate((el) => el.tagName === "SELECT"))
      await input.selectOption(String(value));
    else await input.fill(String(value));
  }
  await page.locator(`[data-form="${name}"] [type="submit"]`).click();
}

async function canvasPixels() {
  return page.evaluate(() => {
    const { view } = parallax;
    view.render();
    const gl = view.renderer.getContext(),
      canvas = view.renderer.domElement;
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    let value = 2166136261,
      nonblack = 0;
    for (let i = 0; i < data.length; i++)
      value = Math.imul(value ^ data[i], 16777619);
    for (let i = 0; i < data.length; i += 4)
      if (data[i] + data[i + 1] + data[i + 2] > 30) nonblack++;
    const at =
      (Math.floor(canvas.height / 2) * canvas.width +
        Math.floor(canvas.width / 2)) *
      4;
    return {
      width: canvas.width,
      height: canvas.height,
      hash: value >>> 0,
      center: Array.from(data.slice(at, at + 4)),
      nonblackFraction: nonblack / (canvas.width * canvas.height),
      glError: gl.getError(),
    };
  });
}

async function solveAuthoredPuzzle() {
  return page.evaluate(() => {
    const w = parallax.world,
      cube = w.doc.cubes[0],
      plate = w.doc.plates[0],
      goal = w.doc.goals[0];
    const entry = w.doc.portals.find((p) => p.room === cube.room);
    const exit = w.portals.get(entry.linkedTo);
    w.look(0, 0);
    w.setInput({ forward: 0, strafe: 0, jump: false });
    const wait = (ticks) => {
      w.setInput({ forward: 0, strafe: 0 });
      for (let i = 0; i < ticks; i++) w.step();
    };
    const walk = (x, z, roomAfter) => {
      for (let tick = 0; tick < 2400; tick++) {
        if (w.completed) return;
        const dx = x - w.player.position.x,
          dz = z - w.player.position.z,
          d = Math.hypot(dx, dz);
        if (
          roomAfter
            ? w.player.room === roomAfter
            : d < 0.03 &&
              Math.hypot(w.player.velocity.x, w.player.velocity.z) < 0.12
        ) {
          w.setInput({ forward: 0, strafe: 0 });
          return;
        }
        const speed = Math.min(3, d * 4);
        w.setInput({
          forward: ((-dz / (d || 1)) * speed) / 5.8,
          strafe: ((dx / (d || 1)) * speed) / 5.8,
          jump: false,
        });
        w.step();
      }
      throw new Error(
        `Authored puzzle walk stalled: ${x},${z} from ${w.player.position.toArray()}`,
      );
    };
    walk(cube.position[0], cube.position[2] + 1.6);
    w.look(0, -0.6);
    if (w.interact() !== cube.id)
      throw new Error("Authored cube could not be picked up");
    w.look(0, 0);
    wait(50);
    walk(entry.position[0], entry.position[2] + 2.2);
    walk(entry.position[0], entry.position[2] - 0.6, exit.room);
    walk(plate.position[0], 3.8);
    walk(plate.position[0], plate.position[2] + 1.9);
    w.look(0, -0.5);
    wait(80);
    if (w.interact() !== cube.id)
      throw new Error("Authored carried cube was lost");
    wait(150);
    const powered = w.plates.get(plate.id).active;
    if (!powered)
      throw new Error(
        `Authored plate was not supported: ${w.cubes.get(cube.id).position.toArray()}`,
      );
    w.look(0, 0);
    walk(plate.position[0], 3.8);
    walk(goal.position[0], 3.8);
    walk(goal.position[0], goal.position[2]);
    wait(1);
    parallax.view.render();
    return {
      completed: w.completed,
      plateActive: powered,
      crossings: w.crossings,
      cubeRoom: w.cubes.get(cube.id).room,
      goalRoom: w.player.room,
      time: w.time,
      method:
        "setInput / look / interact / step only; no body or success assignments",
    };
  });
}

// This fixture is a validated authored document, not a mutation of runtime state.
function interactionDocument(remote = false) {
  return {
    version: 1,
    id: "browser-interaction-fixture",
    name: "Browser interaction fixture",
    description: "Public input fixture",
    lesson: "Inspect portal interactions",
    accent: "#65ebcb",
    rooms: [
      {
        id: "a",
        name: "A",
        center: [0, 2.5, 0],
        size: [10, 5, 10],
        color: "#183b43",
      },
      {
        id: "b",
        name: "B",
        center: [20, 2.5, 0],
        size: [10, 5, 10],
        color: "#493526",
      },
    ],
    blocks: [],
    plates: [],
    doors: [],
    goals: [],
    portals: [
      {
        id: "pa",
        room: "a",
        position: [0, 1.6, -5],
        quaternion: [0, 0, 0, 1],
        width: 2.4,
        height: 3.2,
        linkedTo: "pb",
        enabled: true,
        color: "#65ebcb",
      },
      {
        id: "pb",
        room: "b",
        position: [20, 1.6, 5],
        quaternion: [0, 1, 0, 0],
        width: 2.4,
        height: 3.2,
        linkedTo: "pa",
        enabled: true,
        color: "#ffbd72",
      },
    ],
    cubes: [
      {
        id: "box",
        room: remote ? "b" : "a",
        position: remote ? [20, 1.53, 3.8] : [0, 1.53, -4],
        size: 0.7,
        quaternion: [0, 0, 0, 1],
      },
    ],
    spawn: {
      room: "a",
      position: [0, 0.86, remote ? -3 : -2.5],
      yaw: 0,
      pitch: 0,
    },
    physics: { gravity: 0, fixedDt: 1 / 120, maxSubsteps: 12, maxSpeed: 28 },
  };
}

async function main() {
  await mkdir(output, { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  report.sourceHashesBefore = await sourceHashes();
  report.nodeTests = await command("npm", ["test"]);
  report.build = await command("npm", ["run", "build"]);
  assert.equal(
    report.build.code,
    0,
    "Production build must succeed before browser checks",
  );
  let url = process.env.PARALLAX_URL;
  if (!url) {
    const port = await unusedPort();
    url = `http://127.0.0.1:${port}`;
    preview = spawn(
      "npm",
      ["run", "preview", "--", "--port", String(port), "--strictPort"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true },
    );
    report.previewLog = "";
    preview.stdout.on("data", (data) => {
      report.previewLog += data;
    });
    preview.stderr.on("data", (data) => {
      report.previewLog += data;
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {}
      assert.equal(
        preview.exitCode,
        null,
        "Preview exited before becoming available",
      );
      await sleep(100);
    }
  }
  report.url = url;
  report.server = process.env.PARALLAX_URL
    ? "externally supplied URL; production build also checked"
    : "automatically started production preview";
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  await context.route("**/*", localOnly);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => report.pageErrors.push(error.stack));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.parallax?.view?.stats.views > 0);
  report.environment = {
    browser: browser.version(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    ...(await page.evaluate(() => {
      const gl = parallax.view.renderer.getContext(),
        debug = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        glVersion: gl.getParameter(gl.VERSION),
        glVendor: debug
          ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
          : gl.getParameter(gl.VENDOR),
        glRenderer: debug
          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
      };
    })),
  };

  await check(
    "Initial desktop WebGL render, aspect, and nonempty pixels",
    async () => {
      const pixels = await canvasPixels();
      assert.equal(pixels.glError, 0);
      assert.ok(pixels.nonblackFraction > 0.5);
      const state = await page.evaluate(() => ({
        mode: parallax.mode,
        stats: { ...parallax.view.stats },
        aspect: parallax.view.camera.aspect,
        css: [parallax.view.width, parallax.view.height],
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(state.mode, "ready");
      assert.equal(state.overflow, false);
      assert.equal(state.aspect, state.css[0] / state.css[1]);
      return {
        ...state,
        pixels,
        screenshot: await screenshot("desktop-1440x1000"),
      };
    },
  );

  await check(
    "Real Enter click captures pointer; keyboard, look, Escape, frozen inspect, resume",
    async () => {
      await page.locator("#enter-button").click();
      await page.waitForFunction(
        () => !!document.pointerLockElement && parallax.mode === "playing",
      );
      const initial = await page.evaluate(() => ({
        position: parallax.world.player.position.toArray(),
        yaw: parallax.world.input.yaw,
      }));
      await page.keyboard.down("w");
      await frames(8);
      await page.keyboard.up("w");
      const lookBefore = await page.evaluate(() => {
        window.__lookSamples = [];
        window.__recordLook = (event) => {
          if (document.pointerLockElement)
            window.__lookSamples.push({
              movement: [event.movementX, event.movementY],
              yaw: parallax.world.input.yaw,
              pitch: parallax.world.input.pitch,
            });
        };
        document.addEventListener("mousemove", window.__recordLook);
        return parallax.world.input.yaw;
      });
      await page.mouse.move(650, 450);
      await page.mouse.move(710, 465);
      await frames(2);
      const moved = await page.evaluate(() => ({
        position: parallax.world.player.position.toArray(),
        yaw: parallax.world.input.yaw,
      }));
      const lookSamples = await page.evaluate(() => {
        document.removeEventListener("mousemove", window.__recordLook);
        return window.__lookSamples;
      });
      assert.ok(
        Math.hypot(...moved.position.map((n, i) => n - initial.position[i])) >
          0.1,
      );
      assert.ok(
        lookSamples.some(
          (sample) =>
            sample.movement[0] !== 0 &&
            Math.abs(sample.yaw - lookBefore) > 0.01,
        ),
        JSON.stringify(lookSamples),
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => parallax.mode === "paused" && !document.pointerLockElement,
      );
      const frozen = await page.evaluate(() =>
        JSON.stringify([
          parallax.world.time,
          parallax.world.player.position,
          [...parallax.world.cubes.values()].map((c) => [
            c.position,
            c.velocity,
          ]),
        ]),
      );
      await frames(6);
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify([
            parallax.world.time,
            parallax.world.player.position,
            [...parallax.world.cubes.values()].map((c) => [
              c.position,
              c.velocity,
            ]),
          ]),
        ),
        frozen,
      );
      await page.locator("#inspect-button").click();
      const beforeOrbit = await page.evaluate(() =>
        parallax.view.orbitCamera.position.toArray(),
      );
      const bounds = await page.locator("#viewport canvas").boundingBox();
      await page.mouse.move(
        bounds.x + bounds.width * 0.45,
        bounds.y + bounds.height * 0.5,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width * 0.65,
        bounds.y + bounds.height * 0.65,
        { steps: 5 },
      );
      await page.mouse.up();
      await frames(5);
      const afterOrbit = await page.evaluate(() =>
        parallax.view.orbitCamera.position.toArray(),
      );
      assert.notDeepEqual(beforeOrbit, afterOrbit);
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify([
            parallax.world.time,
            parallax.world.player.position,
            [...parallax.world.cubes.values()].map((c) => [
              c.position,
              c.velocity,
            ]),
          ]),
        ),
        frozen,
      );
      await screenshot("frozen-inspect");
      await page.locator("#pause-button").click();
      await page.waitForFunction(
        () => parallax.mode === "playing" && !!document.pointerLockElement,
      );
      await frames(3);
      await page.keyboard.press("p");
      await page.waitForFunction(() => parallax.mode === "paused");
      return {
        initial,
        moved,
        lookBefore,
        lookSamples,
        beforeOrbit,
        afterOrbit,
        frozenExactly: true,
        resumed: true,
        pauseKey: "p",
      };
    },
  );

  for (const index of [0, 1, 2])
    await check(
      `Chamber ${index + 1} actual Watch Solution input replay reaches goal`,
      async () => {
        await selectLevel(index);
        await page.locator("#nav-guide").click();
        if (
          (await page.locator(".solution-details").getAttribute("open")) ===
          null
        )
          await page.locator(".solution-details summary").click();
        await page.locator("#watch-solution").click();
        const stages = [];
        for (let round = 0; round < 30; round++) {
          const stage = await page.evaluate(() => {
            const replay = parallax.replay,
              world = parallax.world;
            if (
              !window.__replayEvidence ||
              window.__replayEvidence.world !== world
            )
              window.__replayEvidence = { world, seen: new Set() };
            const seen = window.__replayEvidence.seen;
            let milestone = "stage";
            const start = replay?.stepIndex;
            for (let tick = 0; tick < 1800 && replay && !replay.done; tick++) {
              replay.update(1 / 120);
              const kind = world.completed
                ? "goal"
                : [...world.doors.values()].some(
                      (door) => door.active && door.open >= 0.995,
                    )
                  ? "door-open"
                  : [...world.cubes.values()].some((cube) =>
                        world.getStraddle(cube),
                      )
                    ? "cube-straddle"
                    : world.crossings > 0
                      ? "portal-crossing"
                      : world.held
                        ? "pickup"
                        : null;
              if (kind && !seen.has(kind)) {
                seen.add(kind);
                milestone = kind;
                break;
              }
              if (replay.stepIndex !== start) break;
            }
            parallax.view.render();
            return {
              milestone,
              image:
                milestone !== "stage"
                  ? parallax.view.renderer.domElement.toDataURL("image/png")
                  : null,
              label: replay?.label,
              stepIndex: replay?.stepIndex,
              elapsed: replay?.elapsed,
              done: replay?.done,
              error: replay?.error,
              completed: world.completed,
              crossings: world.crossings,
              held: world.held && { ...world.held },
              player: {
                room: world.player.room,
                position: world.player.position.toArray(),
              },
              cubes: [...world.cubes.values()].map((cube) => ({
                id: cube.id,
                room: cube.room,
                position: cube.position.toArray(),
                straddle: world.getStraddle(cube)?.portal.id,
              })),
              plates: [...world.plates],
              doors: [...world.doors],
            };
          });
          stages.push(stage);
          if (stage.image) {
            const name = `solution-${index + 1}-${stage.milestone}`,
              file = path.join(output, `${name}.png`),
              data = Buffer.from(stage.image.split(",")[1], "base64");
            await writeFile(file, data);
            stage.screenshot = {
              name,
              file,
              sha256: hash(data),
              bytes: data.length,
              exactSimulationTick: true,
            };
            report.screenshots.push(stage.screenshot);
          }
          delete stage.image;
          if (stage.done || stage.completed) break;
        }
        const final = stages.at(-1);
        assert.equal(final.error, null);
        assert.equal(final.completed, true, JSON.stringify(final));
        await frames(2);
        assert.equal(await page.evaluate(() => parallax.mode), "complete");
        if (index !== 1) {
          assert.ok(stages.some((s) => s.held));
          assert.ok(stages.some((s) => s.doors.some(([, d]) => d.active)));
        }
        assert.ok(final.crossings >= (index === 2 ? 3 : 1));
        return {
          acceleration:
            "Only replay.update(1/120), with rendered stage boundaries and milestone screenshots",
          stages,
        };
      },
    );

  await check(
    "Depth-three recursion renders self avatar, verified by target pixel difference",
    async () => {
      await selectLevel(2);
      const result = await page.evaluate(() => {
        const view = parallax.view;
        const targetHash = (target) => {
          const data = new Uint8Array(target.width * target.height * 4);
          view.renderer.readRenderTargetPixels(
            target,
            0,
            0,
            target.width,
            target.height,
            data,
          );
          let h = 2166136261;
          for (const n of data) h = Math.imul(h ^ n, 16777619);
          return h >>> 0;
        };
        let avatarDraws = 0;
        const mesh = view.avatar.children[0],
          oldCallback = mesh.onBeforeRender;
        mesh.onBeforeRender = (...args) => {
          avatarDraws++;
          oldCallback.apply(mesh, args);
        };
        view.render();
        const visible = view.targets.map(targetHash),
          stats = { ...view.stats };
        const materials = [];
        view.avatar.traverse((o) => {
          if (o.isMesh) {
            materials.push([o.material, o.material.visible]);
            o.material.visible = false;
          }
        });
        view.render();
        const hidden = view.targets.map(targetHash);
        for (const [material, enabled] of materials) material.visible = enabled;
        mesh.onBeforeRender = oldCallback;
        view.render();
        return {
          stats,
          visibleTargetHashes: visible,
          hiddenAvatarTargetHashes: hidden,
          avatarDraws,
          targetDimensions: view.targets.map((t) => [t.width, t.height]),
        };
      });
      assert.equal(result.stats.maxDepth, 3);
      assert.ok(result.avatarDraws > 0);
      assert.notEqual(
        result.visibleTargetHashes[2],
        result.hiddenAvatarTargetHashes[2],
        "Depth-three target must change when self avatar is suppressed",
      );
      return {
        ...result,
        screenshot: await screenshot("depth-three-self-avatar", true),
      };
    },
  );

  await check("Source block depth occludes portal center pixel", async () => {
    await selectLevel(2);
    const before = await canvasPixels();
    await screenshot("occluder-before", true);
    const fixture = await page.evaluate(() => {
      const doc = structuredClone(parallax.world.doc);
      doc.blocks.push({
        id: "browser-source-occluder",
        room: "loop-origin",
        position: [0, 1.5, 0],
        size: [2, 3, 0.4],
      });
      parallax.loadDocument(doc);
      const view = parallax.view;
      let mesh;
      view.rooms.get("loop-origin").traverse((o) => {
        if (o.userData.entityId === "browser-source-occluder") mesh = o;
      });
      // Reuse the app's own basic material class, so the fixture also works in production bundles.
      mesh.material = view.portals
        .get("loop-a-north")
        .root.children[2].material.clone();
      mesh.material.color.set("#ff0000");
      mesh.material.toneMapped = false;
      return { block: doc.blocks.at(-1), material: mesh.material.type };
    });
    const after = await canvasPixels();
    assert.ok(
      after.center[0] > 240 && after.center[1] < 20 && after.center[2] < 20,
      JSON.stringify(after),
    );
    assert.notDeepEqual(before.center, after.center);
    return {
      fixture,
      before,
      after,
      screenshot: await screenshot("occluder-after", true),
    };
  });

  await check(
    "Destination geometry behind portal plane is pixel-clipped, positive control visible inside",
    async () => {
      await selectLevel(2);
      const baseline = await canvasPixels();
      await page.evaluate(() => {
        const view = parallax.view,
          surface = view.portals.get("loop-b-south").surface;
        const mesh = surface.clone();
        mesh.geometry = surface.geometry.clone();
        mesh.material = view.portals
          .get("loop-a-north")
          .root.children[2].material.clone();
        mesh.material.color.set("#ff00ff");
        mesh.material.toneMapped = false;
        mesh.material.side = 2;
        mesh.scale.set(20, 20, 1);
        mesh.position.set(22, 1.6, 8);
        mesh.quaternion.set(0, 0, 0, 1);
        view.rooms.get("loop-relay").add(mesh);
        window.__clipFixture = mesh;
      });
      const behind = await canvasPixels();
      assert.deepEqual(behind.center, baseline.center);
      assert.equal(
        behind.hash,
        baseline.hash,
        "Behind-plane renderer-only mesh must leave framebuffer unchanged",
      );
      await screenshot("destination-behind-plane-clipped", true);
      await page.evaluate(() => {
        window.__clipFixture.position.z = 4;
      });
      const inside = await canvasPixels();
      assert.ok(
        inside.center[0] > 200 &&
          inside.center[2] > 200 &&
          inside.center[1] < 80,
        JSON.stringify(inside),
      );
      await screenshot("destination-inside-plane-control", true);
      await page.evaluate(() => {
        const mesh = window.__clipFixture;
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
        delete window.__clipFixture;
      });
      return {
        baseline,
        behind,
        inside,
        fixture:
          "Large double-sided magenta plane in relay render group at z=8 (behind destination z=6); positive control z=4. No invalid world document loaded.",
      };
    },
  );

  await check(
    "Sub-millimeter approach retains live portal view; runtime disable restores solid rendering",
    async () => {
      const doc = interactionDocument();
      doc.cubes = [];
      await page.evaluate((doc) => parallax.loadDocument(doc), doc);
      const evidence = await page.evaluate(() => {
        const { world, view } = parallax,
          V = world.player.position.constructor;
        const approaches = [];
        for (const distance of [0.04, 0.015, 0.004, 0.0005]) {
          world.moveBody(
            world.player,
            new V(0, 0.86, -5 + distance).sub(world.player.position),
          );
          view.render();
          approaches.push({
            distance,
            near: view.camera.near,
            live: view.portals.get("pa").material.uniforms.ready.value,
            depth: view.stats.maxDepth,
            room: world.cameraFrame().room,
          });
        }
        world.moveBody(world.player, new V(0, 0, -0.02));
        view.render();
        const after = {
          room: world.player.room,
          cameraRoom: world.cameraFrame().room,
          crossings: world.crossings,
        };
        const disabled = world.setPortalEnabled("pa", false);
        view.render();
        const hidden =
          !view.portals.get("pa").surface.visible &&
          !view.portals.get("pb").surface.visible;
        const enabled = world.setPortalEnabled("pa", true);
        view.render();
        const visible =
          view.portals.get("pa").surface.visible &&
          view.portals.get("pb").surface.visible;
        return { approaches, after, disabled, hidden, enabled, visible };
      });
      for (const sample of evidence.approaches) {
        assert.equal(sample.live, true);
        assert.ok(sample.depth >= 1);
        assert.ok(sample.near < sample.distance);
        assert.equal(sample.room, "a");
      }
      assert.equal(evidence.after.room, "b");
      assert.equal(evidence.after.cameraRoom, "b");
      assert.equal(evidence.after.crossings, 1);
      assert.ok(
        evidence.disabled &&
          evidence.hidden &&
          evidence.enabled &&
          evidence.visible,
      );
      return evidence;
    },
  );

  await check(
    "One straddling cube has complementary clipped render meshes and reverses safely",
    async () => {
      await page.evaluate(
        (doc) => parallax.loadDocument(doc),
        interactionDocument(),
      );
      const result = await page.evaluate(() => {
        const { world, view } = parallax,
          body = world.cubes.get("box");
        world.moveBody(body, body.position.clone().set(0, 0, -0.85));
        view.render();
        const straddle = world.getStraddle(body),
          entry = view.bodies.get("box");
        const planes = (object) => {
          const result = [];
          object.traverse((o) => {
            if (o.isMesh)
              result.push(
                o.material.clippingPlanes.map((p) => ({
                  normal: p.normal.toArray(),
                  constant: p.constant,
                })),
              );
          });
          return result;
        };
        const sourcePlanes = planes(entry.mesh),
          remotePlanes = planes(entry.copy);
        view._prepare("a", 0);
        const source = { mesh: entry.mesh.visible, copy: entry.copy.visible };
        view._prepare("b", 1);
        const destination = {
          mesh: entry.mesh.visible,
          copy: entry.copy.visible,
        };
        view.render();
        window.__bodyIdentity = body;
        return {
          count: world.cubes.size,
          id: body.id,
          source,
          destination,
          sourcePlanes,
          remotePlanes,
          portal: straddle?.portal.id,
          position: body.position.toArray(),
        };
      });
      assert.equal(result.count, 1);
      assert.equal(result.portal, "pa");
      assert.deepEqual(result.source, { mesh: true, copy: false });
      assert.deepEqual(result.destination, { mesh: false, copy: true });
      assert.ok(result.sourcePlanes.every((planes) => planes.length === 1));
      assert.ok(result.remotePlanes.every((planes) => planes.length === 1));
      assert.deepEqual(result.sourcePlanes[0][0].normal, [0, 0, 1]);
      assert.deepEqual(result.remotePlanes[0][0].normal, [0, 0, -1]);
      await screenshot("cube-straddle", true);
      const reversal = await page.evaluate(() => {
        const { world, view } = parallax,
          body = world.cubes.get("box");
        world.moveBody(body, body.position.clone().set(0, 0, 0.7));
        view.render();
        return {
          sameIdentity: body === window.__bodyIdentity,
          straddle: world.getStraddle(body),
          crossings: world.crossings,
          room: body.room,
          copyVisible: view.bodies.get("box").copy.visible,
        };
      });
      assert.deepEqual(reversal, {
        sameIdentity: true,
        straddle: null,
        crossings: 0,
        room: "a",
        copyVisible: false,
      });
      return {
        ...result,
        reversal,
        setup:
          "World.moveBody to straddle then reverse; complementary halfspace sample oracle also in tests/render.test.js",
      };
    },
  );

  await check(
    "Real E pickup/drop and touch-button throw cross portal; remote E pickup uses portal path",
    async () => {
      const desktop = page;
      const touchContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      });
      await touchContext.route("**/*", localOnly);
      page = await touchContext.newPage();
      page.on("pageerror", (error) => report.pageErrors.push(error.stack));
      page.on("console", (message) => {
        if (message.type() === "error")
          report.consoleErrors.push(message.text());
      });
      try {
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForFunction(() => window.parallax);
        await page.evaluate(
          (doc) => parallax.loadDocument(doc),
          interactionDocument(),
        );
        await page.evaluate(() => {
          const world = parallax.world,
            cube = world.cubes.get("box");
          world.moveBody(cube, cube.position.clone().set(0, 0, -0.85));
        });
        await page.locator("#enter-button").tap();
        await page.waitForFunction(() => parallax.mode === "playing");
        await page.keyboard.press("e");
        await page.waitForFunction(() => parallax.world.held?.id === "box");
        await page.keyboard.press("e");
        const releasedAtSeam = await page.evaluate(() => ({
          held: parallax.world.held,
          portal: parallax.world.getStraddle(parallax.world.cubes.get("box"))
            ?.portal.id,
          cubes: parallax.world.cubes.size,
        }));
        assert.deepEqual(releasedAtSeam, {
          held: null,
          portal: "pa",
          cubes: 1,
        });
        await page.keyboard.press("e");
        await page.keyboard.down("s");
        await page.waitForFunction(
          () => parallax.world.cubes.get("box").position.z > -4.6,
        );
        await page.keyboard.up("s");
        const reversedByInput = await page.evaluate(() => ({
          held: parallax.world.held?.id,
          room: parallax.world.cubes.get("box").room,
          straddling: !!parallax.world.getStraddle(
            parallax.world.cubes.get("box"),
          ),
          crossings: parallax.world.crossings,
          cubes: parallax.world.cubes.size,
        }));
        assert.deepEqual(reversedByInput, {
          held: "box",
          room: "a",
          straddling: false,
          crossings: 0,
          cubes: 1,
        });
        await page.keyboard.press("e");
        await page.evaluate(
          (doc) => parallax.loadDocument(doc),
          interactionDocument(),
        );
        await page.locator("#enter-button").tap();
        await page.waitForFunction(() => parallax.mode === "playing");
        await page.keyboard.press("e");
        await page.waitForFunction(() => parallax.world.held?.id === "box");
        const held = await page.evaluate(() => ({ ...parallax.world.held }));
        await page.keyboard.press("e");
        assert.equal(await page.evaluate(() => parallax.world.held), null);
        await page.keyboard.press("e");
        await page.waitForFunction(() => parallax.world.held?.id === "box");
        await page.locator("#touch-throw").tap();
        await page.waitForFunction(
          () => parallax.world.cubes.get("box").room === "b",
        );
        const thrown = await page.evaluate(() => ({
          held: parallax.world.held,
          crossings: parallax.world.crossings,
          velocity: parallax.world.cubes.get("box").velocity.toArray(),
          spin: parallax.world.cubes.get("box").angularVelocity.toArray(),
        }));
        assert.equal(thrown.held, null);
        assert.equal(thrown.crossings, 1);
        assert.ok(thrown.spin.some((n) => n !== 0));
        await page.keyboard.press("Escape");
        await page.evaluate(
          (doc) => parallax.loadDocument(doc),
          interactionDocument(true),
        );
        await page.locator("#enter-button").tap();
        await page.waitForFunction(() => parallax.mode === "playing");
        await page.keyboard.press("e");
        const remote = await page.evaluate(() => ({ ...parallax.world.held }));
        assert.deepEqual(remote.path, ["pa"]);
        assert.equal(remote.id, "box");
        await page.keyboard.press("Escape");
        return {
          releasedAtSeam,
          reversedByInput,
          held,
          thrown,
          remote,
          actions: [
            "World.moveBody straddle fixture setup",
            "Enter real tap",
            "E pickup",
            "E release at seam",
            "E pickup",
            "S walk backward reverses held straddle",
            "E drop",
            "fresh local fixture",
            "Enter real tap",
            "E pickup",
            "E drop",
            "E pickup",
            "Throw button real tap",
            "remote fixture",
            "Enter real tap",
            "E through-portal pickup",
          ],
          limitation:
            "Precision fixture uses touch mode because headless Chromium intermittently emits a cursor-warp delta after desktop pointer capture. Desktop pointer capture, keyboard walking and mouse look are tested separately.",
        };
      } finally {
        await touchContext.close();
        page = desktop;
      }
    },
  );

  await check(
    "Full integrated editor UI authors blank two-room mechanism, history, files, isolated playtest",
    async () => {
      await selectLevel(0);
      await page.locator("#nav-editor").click();
      await section("files");
      await page.locator('[data-action="blank"]').click();
      assert.equal(
        await page.evaluate(() => parallax.editor.doc.rooms.length),
        1,
      );
      await section("build");
      await page.locator('[data-action="add-room"]').click();
      await form("inspector", {
        name: "Verification Relay",
        position0: 22,
        size0: 12,
      });
      await page.locator('[data-control="room"]').selectOption("blank-room");
      await section("portals");
      await form("portals", {
        roomA: "blank-room",
        roomB: "room-1",
        faceA: "north",
        faceB: "south",
        width: 2.4,
        height: 3.2,
      });
      assert.equal(
        await page.evaluate(() => parallax.editor.doc.portals.length),
        2,
      );
      await section("build");
      await page.locator('[data-action="add-cube"]').click();
      await form("inspector", {
        position0: 2.13,
        position1: 1,
        position2: 1,
        rotation1: 30,
        size0: 0.8,
      });
      const transformed = await page.evaluate(() =>
        structuredClone(parallax.editor.doc.cubes[0]),
      );
      assert.equal(transformed.position[0], 2.25);
      assert.equal(transformed.size, 0.8);
      assert.ok(
        Math.abs(transformed.quaternion[1] - Math.sin(Math.PI / 12)) < 1e-8,
      );
      await page.locator('[data-control="snap"]').fill("0.5");
      await page.locator('[data-control="snap"]').press("Tab");
      const slider = page.locator('[data-drag-axis="0"]');
      await slider.focus();
      await slider.press("ArrowRight");
      const moved = await page.evaluate(
        () => parallax.editor.doc.cubes[0].position[0],
      );
      assert.ok(moved !== 2.25 && moved % 0.5 === 0);
      await page.locator('[data-action="undo"]').click();
      assert.equal(
        await page.evaluate(() => parallax.editor.doc.cubes[0].position[0]),
        2.25,
      );
      await page.locator('[data-action="redo"]').click();
      assert.equal(
        await page.evaluate(() => parallax.editor.doc.cubes[0].position[0]),
        moved,
      );
      await page.locator('[data-control="room"]').selectOption("room-1");
      await section("build");
      await page.locator('[data-action="add-door"]').click();
      await page.locator('[data-action="add-plate"]').click();
      await page
        .locator('[data-form="inspector"] [name="links"][value="door-1"]')
        .check();
      await page.locator('[data-form="inspector"] [type="submit"]').click();
      await page.locator('[data-action="add-goal"]').click();
      await page
        .locator('[data-form="inspector"] [name="links"][value="door-1"]')
        .check();
      await page.locator('[data-form="inspector"] [type="submit"]').click();
      await page.locator('[data-action="add-block"]').click();
      await form("inspector", { position1: 1, rotation1: 15, size1: 1.5 });
      const doc = await page.evaluate(() =>
        structuredClone(parallax.editor.doc),
      );
      assert.deepEqual(doc.plates[0].doorIds, ["door-1"]);
      assert.deepEqual(doc.goals[0].requires, ["door-1"]);
      assert.equal(doc.rooms.length, 2);
      await screenshot("editor-authored-desktop");
      await page.locator('[data-action="playtest"]').click();
      await page.locator("#enter-button").click();
      const firstSolution = await solveAuthoredPuzzle();
      assert.equal(firstSolution.completed, true);
      assert.equal(firstSolution.plateActive, true);
      assert.ok(firstSolution.crossings >= 2);
      await frames();
      await page.locator("#nav-play").click();
      await page.waitForFunction(() => parallax.mode === "editor");
      assert.deepEqual(await page.evaluate(() => parallax.editor.doc), doc);
      await section("files");
      const downloadPromise = page.waitForEvent("download");
      await page.locator('[data-action="export"]').click();
      const download = await downloadPromise;
      const exported = JSON.parse(
        await readFile(await download.path(), "utf8"),
      );
      assert.deepEqual(exported, doc);
      await download.saveAs(path.join(output, "authored-export.json"));
      await page.locator('[data-action="blank"]').click();
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator('[data-action="import"]').click();
      await (
        await chooserPromise
      ).setFiles({
        name: "authored.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(exported)),
      });
      await page.waitForFunction(() => parallax.editor.doc.rooms.length === 2);
      assert.deepEqual(await page.evaluate(() => parallax.editor.doc), doc);
      await page.locator('[data-action="save"]').click();
      await page.locator('[data-action="blank"]').click();
      await section("files");
      await page.locator('[data-action="reload"]').click();
      assert.deepEqual(await page.evaluate(() => parallax.editor.doc), doc);
      const imagePromise = page.waitForEvent("download");
      await page.locator('[data-action="image"]').click();
      const image = await imagePromise;
      const imageBytes = await readFile(await image.path());
      assert.equal(imageBytes.subarray(1, 4).toString(), "PNG");
      assert.ok(imageBytes.length > 10000);
      const beforeBad = await page.evaluate(() =>
        JSON.stringify([
          parallax.editor.doc,
          parallax.editor.undoStack,
          parallax.editor.redoStack,
        ]),
      );
      const badChooser = page.waitForEvent("filechooser");
      await page.locator('[data-action="import"]').click();
      await (
        await badChooser
      ).setFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"version":'),
      });
      await page.locator(".ed-status-error").waitFor();
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify([
            parallax.editor.doc,
            parallax.editor.undoStack,
            parallax.editor.redoStack,
          ]),
        ),
        beforeBad,
      );
      await page.locator('[data-action="playtest"]').click();
      await page.locator("#enter-button").click();
      await page.waitForFunction(() => parallax.mode === "playing");
      const reloadedSolution = await solveAuthoredPuzzle();
      assert.equal(reloadedSolution.completed, true);
      assert.equal(reloadedSolution.plateActive, true);
      const playtest = await page.evaluate(() => ({
        time: parallax.world.time,
        position: parallax.world.player.position.toArray(),
        editorUnchanged:
          JSON.stringify(parallax.editor.doc) ===
          JSON.stringify(parallax.world._initial),
        separate: parallax.editor.doc !== parallax.world.doc,
      }));
      assert.ok(playtest.time > 0);
      assert.equal(playtest.separate, true);
      assert.equal(playtest.editorUnchanged, true);
      await frames();
      await page.locator("#nav-play").click();
      await page.waitForFunction(() => parallax.mode === "editor");
      assert.deepEqual(await page.evaluate(() => parallax.editor.doc), doc);
      assert.equal(await page.evaluate(() => parallax.world.time), 0);
      return {
        actions: [
          "New blank (confirmed)",
          "Add Room",
          "Room name/translation/size inspector",
          "Create portal pair form",
          "Add Cube",
          "Cube position/rotation/uniform scale inspector",
          "Snap control",
          "Arrow-key range move",
          "Undo",
          "Redo",
          "Add Door",
          "Add Plate",
          "Plate door checkbox wiring",
          "Add Goal",
          "Goal required-door checkbox",
          "Add Block and transform",
          "Solve authored puzzle through public gameplay inputs",
          "Export JSON download",
          "New blank",
          "Import via file chooser",
          "Save locally",
          "Blank then reload local save",
          "PNG image download",
          "Malformed file import rejection",
          "Playtest and solve again",
          "Return to edit",
        ],
        counts: Object.fromEntries(
          [
            "rooms",
            "blocks",
            "portals",
            "cubes",
            "plates",
            "doors",
            "goals",
          ].map((key) => [key, doc[key].length]),
        ),
        transformed,
        moved,
        firstSolution,
        reloadedSolution,
        imageBytes: imageBytes.length,
        playtest,
        restoredExactly: true,
      };
    },
  );

  await check(
    "Editor destination material and geometry changes appear live through portal",
    async () => {
      await selectLevel(2);
      await page.locator("#nav-editor").click();
      await page.evaluate(() => {
        parallax.view.setEditor(false);
      });
      const before = await canvasPixels(),
        beforeShot = await screenshot("live-relay-before", true);
      const transaction = await page.evaluate(() => {
        const result = parallax.editor.transaction((doc) => {
          doc.rooms.find((room) => room.id === "loop-relay").color = "#d52f80";
          doc.blocks.push({
            id: "live-relay-block",
            room: "loop-relay",
            position: [22, 1.5, 2],
            size: [1.5, 3, 0.5],
          });
        }, "Browser live destination fixture");
        parallax.view.setEditor(false);
        return result;
      });
      assert.equal(transaction.valid, true);
      const after = await canvasPixels(),
        afterShot = await screenshot("live-relay-after", true);
      assert.notEqual(before.hash, after.hash);
      assert.notEqual(beforeShot.sha256, afterShot.sha256);
      assert.notDeepEqual(before.center, after.center);
      const moved = await page.evaluate(() => {
        const result = parallax.editor.transaction((doc) => {
          doc.blocks.find((b) => b.id === "live-relay-block").position[0] = 24;
        });
        parallax.view.setEditor(false);
        return result;
      });
      assert.equal(moved.valid, true);
      const afterMove = await canvasPixels();
      assert.notEqual(afterMove.hash, after.hash);
      await screenshot("live-relay-moved", true);
      return {
        before,
        after,
        afterMove,
        screenshotHashes: [beforeShot.sha256, afterShot.sha256],
        setup:
          "Editor.transaction changes destination room color, adds block, then moves block. First-person render retained at unchanged spawn.",
      };
    },
  );

  for (const width of [390, 320])
    await check(
      `Mobile ${width}x844 initial and editor render with no horizontal overflow`,
      async () => {
        const mobile = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
          isMobile: true,
          hasTouch: true,
          reducedMotion: "reduce",
        });
        await mobile.route("**/*", localOnly);
        const desktop = page;
        page = await mobile.newPage();
        try {
          page.on("pageerror", (error) => report.pageErrors.push(error.stack));
          page.on("console", (message) => {
            if (message.type() === "error")
              report.consoleErrors.push(message.text());
          });
          await page.goto(url, { waitUntil: "networkidle" });
          await frames(2);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          const initial = await screenshot(`mobile-${width}x844`),
            pixels = await canvasPixels();
          assert.ok(pixels.nonblackFraction > 0.5);
          await page.locator("#enter-button").tap();
          await page.waitForFunction(() => parallax.mode === "playing");
          await page.locator("#touch-controls").waitFor({ state: "visible" });
          await page.locator("#pause-button").click();
          await page.locator("#nav-editor").click();
          await frames(2);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          const editor = await screenshot(`editor-mobile-${width}`);
          return { initial, editor, pixels, touchControls: true };
        } finally {
          await mobile.close();
          page = desktop;
        }
      },
    );

  await check(
    "Repeated level reload GPU memory and render targets remain bounded",
    async () => {
      await page.locator("#nav-play").click();
      const samples = await page.evaluate(() => {
        const samples = [];
        for (let i = 0; i < 6; i++) {
          parallax.selectLevel(2);
          parallax.view.render();
          samples.push({
            iteration: i,
            memory: { ...parallax.view.renderer.info.memory },
            targets: parallax.view.targets.length,
            targetBytes: parallax.view.stats.targetBytes,
            depth: parallax.view.stats.maxDepth,
          });
        }
        return samples;
      });
      for (const sample of samples.slice(1)) {
        assert.deepEqual(sample.memory, samples[0].memory);
        assert.equal(sample.targetBytes, samples[0].targetBytes);
        assert.equal(sample.targets, samples[0].targets);
      }
      assert.equal(samples.at(-1).depth, 3);
      return samples;
    },
  );

  await check(
    "Stress: running physics, three portal pairs, 21 cubes, depth three, actual 120 RAF intervals",
    async () => {
      await page.evaluate(() => parallax.loadStress());
      await page.locator("#enter-button").click();
      await page.waitForFunction(
        () => parallax.mode === "playing" && !!document.pointerLockElement,
      );
      await page.waitForTimeout(500);
      // Headless capture may warp the cursor on entry. Re-center through the
      // application's mouse-input handler, then require the actual live depth.
      await page.evaluate(() => {
        const sensitivity =
          JSON.parse(localStorage.getItem("parallax.settings") || "{}")
            .sensitivity || 1;
        document.dispatchEvent(
          new MouseEvent("mousemove", {
            movementX: parallax.world.input.yaw / (0.002 * sensitivity),
            movementY: parallax.world.input.pitch / (0.002 * sensitivity),
          }),
        );
      });
      await page.waitForFunction(() => parallax.view.stats.maxDepth === 3);
      await page.waitForTimeout(8000);
      const timing = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const intervals = [],
              renderCpu = [],
              depths = [],
              substeps = [],
              targetBytes = [];
            let previous,
              previousPhysics = parallax.world.time;
            const initialPhysics = previousPhysics,
              started = performance.now();
            function sample(now) {
              if (previous !== undefined) {
                intervals.push(now - previous);
                renderCpu.push(parallax.view.stats.renderMs);
                depths.push(parallax.view.stats.maxDepth);
                substeps.push(
                  Math.round(
                    (parallax.world.time - previousPhysics) /
                      parallax.world.doc.physics.fixedDt,
                  ),
                );
                targetBytes.push(parallax.view.stats.targetBytes);
              }
              previous = now;
              previousPhysics = parallax.world.time;
              if (intervals.length < 120) requestAnimationFrame(sample);
              else {
                const summary = (values) => {
                  const sorted = [...values].sort((a, b) => a - b);
                  return {
                    samples: values.length,
                    mean: values.reduce((a, b) => a + b, 0) / values.length,
                    p50: sorted[Math.floor(sorted.length * 0.5)],
                    p95: sorted[Math.floor(sorted.length * 0.95)],
                    min: sorted[0],
                    max: sorted.at(-1),
                  };
                };
                resolve({
                  warmupMs: 8000,
                  elapsedWallMs: performance.now() - started,
                  physicsElapsedSeconds: parallax.world.time - initialPhysics,
                  mode: parallax.mode,
                  visibility: document.visibilityState,
                  viewport: [innerWidth, innerHeight],
                  pixelRatio: devicePixelRatio,
                  rafMs: summary(intervals),
                  renderCpuMs: summary(renderCpu),
                  rawRafMs: intervals,
                  rawRenderCpuMs: renderCpu,
                  depths: [...new Set(depths)],
                  substeps: summary(substeps),
                  targetBytes: [...new Set(targetBytes)],
                  appMeasure: parallax.measure(),
                });
              }
            }
            requestAnimationFrame(sample);
          }),
      );
      report.performance = timing;
      assert.equal(timing.mode, "playing");
      assert.equal(timing.visibility, "visible");
      assert.ok(timing.physicsElapsedSeconds > 0);
      assert.equal(timing.rafMs.samples, 120);
      assert.deepEqual(timing.depths, [3]);
      assert.equal(timing.appMeasure.cubes, 21);
      assert.equal(timing.appMeasure.portalPairs, 3);
      assert.ok(timing.substeps.max <= 12);
      assert.equal(timing.targetBytes.length, 1);
      await screenshot("stress-depth-three", true);
      await page.keyboard.press("Escape");
      return timing;
    },
  );

  await check("No browser errors or nonlocal network requests", async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.consoleErrors, []);
    assert.deepEqual(report.externalRequests, []);
    return { pageErrors: 0, consoleErrors: 0, externalRequests: 0 };
  });
}

try {
  await main();
} catch (error) {
  report.fatalError = error.stack;
  log(error.stack);
} finally {
  await browser?.close().catch(() => {});
  if (preview) {
    try {
      process.kill(-preview.pid, "SIGTERM");
    } catch {}
  }
  report.sourceHashesAfter = await sourceHashes();
  report.sourceChangedDuringRun =
    JSON.stringify(report.sourceHashesBefore) !==
    JSON.stringify(report.sourceHashesAfter);
  report.summary = {
    passed: report.checks.filter((c) => c.status === "passed").length,
    failed: report.checks.filter((c) => c.status === "failed").length,
    notRun: report.checks.filter((c) => c.status === "not-run").length,
    nodeTestsPassed: report.nodeTests?.code === 0,
    buildPassed: report.build?.code === 0,
    fatal: Boolean(report.fatalError),
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  log(JSON.stringify(report.summary));
  log(`Report: ${reportPath}`);
  if (
    report.summary.failed ||
    report.summary.fatal ||
    !report.summary.nodeTestsPassed ||
    !report.summary.buildPassed
  )
    process.exitCode = 1;
}
