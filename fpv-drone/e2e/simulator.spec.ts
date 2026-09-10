import { test, expect } from "@playwright/test";

test("desktop flight deck renders and core flight controls work", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Less fear. More flight." }),
  ).toBeVisible();
  await expect(page.locator(".scene-loading")).toHaveCount(0, {
    timeout: 45000,
  });
  await expect(page.locator(".scene-error")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
  await expect(page.locator(".arm-status")).toHaveText("DISARMED");
  await page.getByRole("button", { name: "Arm & fly" }).click();
  await expect(page.locator(".arm-status")).toHaveText("ARMED");
  await page.locator("h1").click();
  await page.keyboard.press("h");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1200);
  await page.keyboard.up("ArrowUp");
  await expect
    .poll(async () =>
      Number(
        (
          await page
            .locator(".telemetry-item")
            .nth(1)
            .locator("strong")
            .innerText()
        ).replace("m", ""),
      ),
    )
    .toBeGreaterThan(0.1);
  await page.keyboard.press("h");
  await expect(
    page.locator(".telemetry-item").nth(3).locator("strong"),
  ).not.toHaveText("00:00", { timeout: 30000 });
  await page.keyboard.press("p");
  await expect(
    page.getByRole("heading", { name: "Right where you left off." }),
  ).toBeVisible();
  const time = await page
    .locator(".telemetry-item")
    .nth(3)
    .locator("strong")
    .innerText();
  await page.waitForTimeout(1000);
  await expect(
    page.locator(".telemetry-item").nth(3).locator("strong"),
  ).toHaveText(time);
  await page
    .locator(".pause-card")
    .getByRole("button", { name: "Resume flight" })
    .click();
  await expect(page.locator(".arm-status")).toHaveText("ARMED");
  await page.getByRole("button", { name: "Reset flight", exact: true }).click();
  await expect(page.locator(".arm-status")).toHaveText("DISARMED");
  await expect(
    page.locator(".telemetry-item").nth(3).locator("strong"),
  ).toHaveText("00:00");
  await page.getByRole("button", { name: /Flight log/ }).click();
  await expect(page.locator(".log-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Arm & fly" }).click();
  await page.locator("h1").click();
  await page.keyboard.press("r");
  await page.keyboard.press("Space");
  await expect(page.locator(".arm-status")).toHaveText("ARMED");
  await expect(
    page.locator(".telemetry-item").nth(3).locator("strong"),
  ).not.toHaveText("00:00", { timeout: 30000 });
  await page.getByRole("button", { name: "Disarm motors" }).click();
  await page.getByRole("button", { name: /Flight log/ }).click();
  await expect(page.locator(".log-row")).toHaveCount(2);
  const records = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fieldwork-flights") || "[]"),
  );
  expect(records[0].duration).toBeGreaterThanOrEqual(1);
  expect(records[0].duration).toBeLessThan(5);
  expect(errors).toEqual([]);
});

test("radio interlock, controller loss, focus loss, and graphics failure are safe", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "fieldwork-settings",
      JSON.stringify({ quality: "balanced", controller: "radio", wind: 0 }),
    );
    const state = { connected: true, throttle: -1 };
    Object.defineProperty(window, "__radio", { value: state });
    Object.defineProperty(navigator, "getGamepads", {
      value: () =>
        state.connected
          ? [
              {
                id: "Simulated AETR radio",
                index: 0,
                connected: true,
                axes: [0, 0, state.throttle, 0],
                buttons: [],
                mapping: "",
                timestamp: 0,
              },
            ]
          : [],
    });
  });
  await page.goto("/");
  await expect(page.locator(".scene-loading")).toHaveCount(0, {
    timeout: 45000,
  });
  await page.getByRole("button", { name: "Arm & fly" }).click();
  await page.waitForTimeout(1000);
  await expect(page.locator(".throttle-osd > span")).toHaveText("0%");
  await page.evaluate(() => {
    (window as unknown as { __radio: { throttle: number } }).__radio.throttle =
      1;
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    (window as unknown as { __radio: { throttle: number } }).__radio.throttle =
      0.2;
  });
  await expect(page.locator(".throttle-osd > span")).toHaveText("40%");
  await page.evaluate(() => {
    (
      window as unknown as { __radio: { connected: boolean } }
    ).__radio.connected = false;
  });
  await expect(page.locator(".arm-status")).toHaveText("PAUSED");
  await page.evaluate(() => {
    Object.assign((window as unknown as { __radio: object }).__radio, {
      connected: true,
      throttle: -1,
    });
  });
  await page.waitForTimeout(500);
  await page
    .locator(".pause-card")
    .getByRole("button", { name: "Resume flight" })
    .click();
  await expect(page.locator(".throttle-osd > span")).toHaveText("0%");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".arm-status")).toHaveText("PAUSED");
  await page
    .locator(".pause-card")
    .getByRole("button", { name: "Resume flight" })
    .click();
  await page
    .locator(".scene-canvas canvas")
    .evaluate((canvas) =>
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
    );
  await expect(page.locator(".scene-error")).toContainText(
    "graphics context was interrupted",
  );
  await expect(page.locator(".sidebar .launch-button")).toBeDisabled();
  await page.locator("h1").click();
  await page.keyboard.press("p");
  await expect(page.locator(".arm-status")).toHaveCount(0);
});

test("settings remain keyboard accessible and environments can be changed", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".scene-loading")).toHaveCount(0, {
    timeout: 45000,
  });
  await page.getByRole("button", { name: "Flight settings" }).click();
  const rates = page.getByRole("slider", { name: /Maximum rotation rate/ });
  await rates.focus();
  await page.waitForTimeout(1000);
  await expect(rates).toBeFocused();
  await rates.press("ArrowRight");
  await expect(rates).toHaveValue("510");
  await page.getByRole("tab", { name: "Display & audio" }).click();
  await page.getByLabel("Graphics quality").selectOption("balanced");
  await page.getByRole("button", { name: "Back to flight" }).click();
  await page.getByRole("button", { name: /Change environment/ }).click();
  await page
    .getByRole("button", { name: /LEARN THE BASICS Open Range/ })
    .click();
  await expect(page.locator(".viewport-environment")).toHaveText("Open Range");
  await expect(page.locator(".scene-loading")).toHaveCount(0, {
    timeout: 45000,
  });
  await page.screenshot({
    path: testInfo.outputPath("open-range.png"),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Flight settings" }).click();
  await expect(
    page.getByRole("slider", { name: /Maximum rotation rate/ }),
  ).toHaveValue("510");
});

test("mobile layout has no horizontal overflow and touch controls are available", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".scene-loading")).toHaveCount(0, {
    timeout: 45000,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await expect(
    page.getByRole("group", {
      name: "Touch joystick, drag for pitch and roll",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Arm & fly" }).click();
  await expect(page.locator(".arm-status")).toHaveText("ARMED");
  const slider = page.getByRole("slider", { name: /^Throttle/ });
  await slider.fill("42");
  await expect
    .poll(async () =>
      Number(
        (
          await page
            .locator(".telemetry-item")
            .nth(1)
            .locator("strong")
            .innerText()
        ).replace("m", ""),
      ),
    )
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause flight", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Right where you left off." }),
  ).toBeVisible();
});
