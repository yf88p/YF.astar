import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const base = process.env.BASE_URL || "http://localhost:5173";
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page
    .locator("#loading.loaded")
    .waitFor({ state: "attached", timeout: 30000 });
  await page.screenshot({
    path: "/tmp/opencode/still-desktop.png",
    fullPage: true,
  });
  console.log(
    "Desktop loaded",
    await page.locator("#pottery-canvas").boundingBox(),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "desktop overflow",
  );
  const box = await page.locator("#pottery-canvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.waitForTimeout(3500);
  await page.mouse.move(box.x + box.width * 0.54, box.y + box.height * 0.58, {
    steps: 18,
  });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const removed = await page.locator("#removed-value").innerText();
  console.log("Clay removed after carving", removed);
  assert.ok(parseFloat(removed) > 0, "carving must remove clay");
  assert.equal(await page.locator("#undo").isDisabled(), false);
  await page.screenshot({
    path: "/tmp/opencode/still-carved.png",
    fullPage: true,
  });
  await page.locator("#undo").click();
  assert.equal(parseFloat(await page.locator("#removed-value").innerText()), 0);
  await page.locator('[data-tool="needle"]').click();
  assert.equal(
    await page
      .locator('button[data-tool="needle"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-clay="porcelain"]').click();
  assert.equal(await page.locator("#clay-name").innerText(), "Ivory");
  await page.locator("#wheel-toggle").click();
  assert.equal(
    await page.locator("#wheel-toggle").getAttribute("aria-label"),
    "Start wheel",
  );
  await page.locator("#pressure").focus();
  await page.keyboard.press("End");
  assert.equal(await page.locator("#pressure-value").innerText(), "Firm");
  await page.locator("#wetness").focus();
  await page.keyboard.press("End");
  assert.equal(await page.locator("#wetness-value").innerText(), "100%");
  await page.locator("#pottery-canvas").focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(1000);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.up("Enter");
  const savedRemoval = parseFloat(
    await page.locator("#removed-value").innerText(),
  );
  assert.ok(savedRemoval > 0, "keyboard carving must remove clay");
  await page.locator("#sound-toggle").click();
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator("#sound-toggle").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#sound-toggle").click();
  await page.locator("#save-piece").click();
  await page.locator("#piece-name").fill("Test quiet moment");
  await page.locator("#save-form button").click();
  assert.equal(await page.locator("#collection-count").innerText(), "1");
  await page.locator("#collection-tab").click();
  assert.equal(
    await page.locator(".saved-card h2").innerText(),
    "Test quiet moment",
  );
  await page.screenshot({
    path: "/tmp/opencode/still-collection.png",
    fullPage: true,
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#loading.loaded").waitFor({ state: "attached" });
  assert.equal(await page.locator("#collection-count").innerText(), "1");
  await page.locator("#collection-tab").click();
  await page.locator(".saved-actions button").first().click();
  assert.equal(await page.locator("#clay-name").innerText(), "Ivory");
  assert.equal(
    parseFloat(await page.locator("#removed-value").innerText()),
    savedRemoval,
    "restored carving volume",
  );
  await page.locator("#open-guide").click();
  assert.equal(
    await page.locator("#guide-dialog").evaluate((e) => e.open),
    true,
  );
  await page.keyboard.press("Escape");
  await page.locator("#reset").click();
  await page.locator("#confirm-reset").click();
  assert.equal(parseFloat(await page.locator("#removed-value").innerText()), 0);
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `/tmp/opencode/still-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
  }
  await page.locator('[data-tool="sponge"]').click();
  assert.equal(
    await page
      .locator('button[data-tool="sponge"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.locator("#loading.loaded").waitFor({ state: "attached" });
  const touchBox = await mobile.locator("#pottery-canvas").boundingBox();
  const x = touchBox.x + touchBox.width / 2,
    y = touchBox.y + touchBox.height * 0.48;
  const cdp = await mobileContext.newCDPSession(mobile);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await mobile.waitForTimeout(1500);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: y + 20, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.ok(
    parseFloat(await mobile.locator("#removed-value").innerText()) > 0,
    "touch carving must remove clay",
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 35, y, id: 1 },
      { x: x + 35, y, id: 2 },
    ],
  });
  const beforeOrbit = await mobile.locator("#removed-value").innerText();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 15, y: y + 8, id: 1 },
      { x: x + 55, y: y + 8, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.equal(
    await mobile.locator("#removed-value").innerText(),
    beforeOrbit,
    "two-finger orbit must not carve",
  );
  await mobileContext.close();
  assert.deepEqual(errors, [], "browser errors");
  console.log(
    "Passed: desktop rendering, real carving, undo, keyboard and touch carving, two-finger orbit, tool/material switching, sliders, wheel, audio, carved-piece persistence, dialogs, and 4 responsive widths.",
  );
} finally {
  await browser.close();
}
