import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5174;
const url = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: "pipe" },
);
let serverOutput = "";
server.stdout.on("data", (data) => {
  serverOutput += data;
});
server.stderr.on("data", (data) => {
  serverOutput += data;
});
let browser;
const errors = [];
const state = (page) => page.evaluate(() => window.aeronaut.state);
const waitFlight = (page, seconds) =>
  page.waitForFunction(
    (target) =>
      window.aeronaut.state.elapsed >= target ||
      window.aeronaut.state.mode === "result",
    seconds,
    { timeout: 90000 },
  );

try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error(`Test server exited: ${serverOutput}`);
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      /* Wait for the local server. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
  });
  async function open(options = {}) {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 760 },
      ...options,
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "aeronaut-settings",
        JSON.stringify({ quality: "low", sound: false }),
      ),
    );
    await page.goto(url);
    await page.waitForFunction(() => window.aeronaut?.state.ready, null, {
      timeout: 60000,
    });
    return page;
  }

  const page = await open();
  assert.equal(await page.locator("#fly-btn").isEnabled(), true);
  await page.click("#help-btn");
  assert.equal(await page.locator("#guide-modal").isVisible(), true);
  await page.click('[data-guide="settings"]');
  await page.locator("#sensitivity").fill("80");
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("aeronaut-settings")).sensitivity,
    ),
    0.8,
  );
  await page.keyboard.press("Escape");
  await page.selectOption("#aircraft-select", "sport");
  assert.equal((await state(page)).aircraft, "sport");
  await page.selectOption("#aircraft-select", "trainer");
  await page.selectOption("#weather-select", "sunset");
  assert.equal((await state(page)).weather, "sunset");
  await page.selectOption("#weather-select", "clear");
  await page.click("#fly-btn");
  await waitFlight(page, 1);
  assert.equal((await state(page)).mode, "flying");
  assert.ok((await state(page)).telemetry.airspeed > 35);

  await page.keyboard.down("ArrowRight");
  await waitFlight(page, (await state(page)).elapsed + 1.3);
  await page.keyboard.up("ArrowRight");
  assert.ok((await state(page)).telemetry.roll > 5, "right input banks right");
  await page.keyboard.down("ArrowLeft");
  await waitFlight(page, (await state(page)).elapsed + 1.2);
  await page.keyboard.up("ArrowLeft");
  const beforeThrottle = (await state(page)).throttle;
  await page.keyboard.down("w");
  await waitFlight(page, (await state(page)).elapsed + 0.6);
  await page.keyboard.up("w");
  assert.ok((await state(page)).throttle > beforeThrottle);
  await page.keyboard.press("f");
  assert.equal((await state(page)).flaps, 1);
  await page.keyboard.press("c");
  assert.equal((await state(page)).camera, 1);
  await page.keyboard.press("c");
  assert.equal((await state(page)).camera, 2);
  await page.keyboard.press("c");
  await page.click("#mouse-btn");
  await page.mouse.move(500, 330);
  await page.mouse.down();
  await page.mouse.move(560, 365, { steps: 4 });
  await waitFlight(page, (await state(page)).elapsed + 0.3);
  assert.ok(
    (await state(page)).controls.roll > 0.2,
    "mouse controls reach physics",
  );
  await page.mouse.up();
  await page.click("#mouse-btn");
  await page.keyboard.press("h");
  assert.equal(await page.locator("#restore-hud").isVisible(), true);
  await page.keyboard.press("h");
  await page.keyboard.press("Escape");
  const paused = await state(page);
  await page.waitForTimeout(400);
  assert.equal(
    (await state(page)).elapsed,
    paused.elapsed,
    "pause freezes physics",
  );
  await page.click("#resume-btn");
  await waitFlight(page, paused.elapsed + 0.2);
  await page.keyboard.press("r");
  assert.equal(await page.locator("#pause-modal").isVisible(), true);
  await page.click("#restart-btn");
  assert.ok((await state(page)).elapsed < 1, "restart resets flight time");
  console.log(
    "PASS: planner, preferences, flight controls, cameras, pause, and restart",
  );

  await page.keyboard.press("Escape");
  await page.click("#home-btn");
  await page.selectOption("#flight-select", "runway");
  await page.click("#fly-btn");
  assert.equal((await state(page)).telemetry.onGround, true);
  await page.locator("#throttle").fill("100");
  await page.waitForFunction(
    () => window.aeronaut.state.telemetry.airspeed > 29,
    null,
    { timeout: 90000 },
  );
  await page.keyboard.down("ArrowDown");
  await page.waitForFunction(
    () =>
      window.aeronaut.state.telemetry.agl > 8 ||
      window.aeronaut.state.mode === "result",
    null,
    { timeout: 45000 },
  );
  await page.keyboard.up("ArrowDown");
  assert.equal(
    (await state(page)).mode,
    "flying",
    "runway departure avoids premature crashes",
  );
  assert.ok(
    (await state(page)).telemetry.agl > 8,
    "aircraft actually takes off",
  );
  console.log("PASS: playable full-power runway takeoff");

  await page.keyboard.press("Escape");
  await page.click("#home-btn");
  await page.selectOption("#flight-select", "landing");
  await page.click("#fly-btn");
  await page.keyboard.down("ArrowUp");
  await page.waitForFunction(
    () => window.aeronaut.state.mode === "result",
    null,
    { timeout: 90000 },
  );
  await page.keyboard.up("ArrowUp");
  assert.equal(await page.locator("#result-modal").isVisible(), true);
  await page.keyboard.press("?");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("#result-modal").isVisible(),
    true,
    "help shortcut cannot strand crash recovery",
  );
  await page.click("#retry-btn");
  assert.equal((await state(page)).mode, "flying");
  await page.keyboard.press("Escape");
  await page.click("#home-btn");
  await page.selectOption("#aircraft-select", "tourer");
  await page.selectOption("#flight-select", "mountain");
  await page.selectOption("#weather-select", "storm");
  await page.click("#fly-btn");
  await waitFlight(page, 0.5);
  const mountain = await state(page);
  assert.ok(mountain.telemetry.altitude > 3000);
  assert.ok(mountain.telemetry.windSpeed > 7);
  assert.equal(mountain.aircraft, "tourer");
  assert.equal(mountain.mode, "flying");
  await page.close();
  console.log(
    "PASS: crash recovery, alternate aircraft, high-altitude flight, and storm weather",
  );

  const mobile = await open({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "mobile has no horizontal overflow",
  );
  await mobile.click("#fly-btn");
  assert.equal(await mobile.locator("#joystick").isVisible(), true);
  const stick = await mobile.locator("#joystick").boundingBox();
  await mobile.mouse.move(
    stick.x + stick.width / 2,
    stick.y + stick.height / 2,
  );
  await mobile.mouse.down();
  await mobile.mouse.move(
    stick.x + stick.width * 0.75,
    stick.y + stick.height * 0.7,
  );
  await waitFlight(mobile, 0.3);
  assert.ok((await state(mobile)).controls.roll > 0.2);
  await mobile.mouse.up();
  await mobile.setViewportSize({ width: 932, height: 430 });
  assert.equal(
    await mobile.locator("#joystick").isVisible(),
    true,
    "wide landscape phone retains touch controls",
  );
  await mobile.setViewportSize({ width: 1024, height: 768 });
  assert.equal(
    await mobile.locator("#joystick").isVisible(),
    true,
    "tablet retains touch controls",
  );
  await mobile.close();
  console.log("PASS: responsive mobile and tablet controls");
  assert.deepEqual(errors, [], "no browser runtime or WebGL shader errors");
  console.log("All browser smoke tests passed.");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
