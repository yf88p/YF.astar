import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { SceneConfig } from "../src/types";

async function ready(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Play simulation", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".canvas-loading")).toHaveCount(0);
}

async function exportScene(page: Page): Promise<SceneConfig> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scene", exact: true }).click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function editNumber(page: Page, label: string, value: string) {
  const field = page.getByRole("spinbutton", { name: label, exact: true });
  await field.fill(value);
  await field.press("Enter");
}

test("starts paused, runs, single-steps, resets, and responds to shortcuts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Gravity playground",
  );
  await expect(page.locator(".elapsed-time strong")).toHaveText("00:00.00s");
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  await expect(page.locator(".elapsed-time strong")).not.toHaveText(
    "00:00.00s",
  );
  await page
    .getByRole("button", { name: "Pause simulation", exact: true })
    .click();
  const paused = await page.locator(".elapsed-time strong").innerText();
  await page.waitForTimeout(200);
  await expect(page.locator(".elapsed-time strong")).toHaveText(paused);
  await page.getByRole("button", { name: "Advance one frame" }).click();
  await expect(page.locator(".elapsed-time strong")).not.toHaveText(paused);
  await page.keyboard.press("r");
  await expect(page.locator(".elapsed-time strong")).toHaveText("00:00.00s");
  await page.locator("canvas").focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Pause simulation", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("g");
  await expect(
    page.getByRole("switch", { name: "Grid", exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press("g");
  await expect(
    page.getByRole("switch", { name: "Grid", exact: true }),
  ).toBeChecked();
  expect(errors).toEqual([]);
});

test("all six experiments load and simulate without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  for (const name of [
    "Gravity playground",
    "Newton's cradle",
    "Orbital mechanics",
    "Spring oscillator",
    "Buoyancy tank",
    "Charged particles",
  ]) {
    await page
      .locator(".experiment-list")
      .getByRole("button", { name: new RegExp(name) })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await page
      .getByRole("button", { name: "Play simulation", exact: true })
      .click();
    await page.waitForTimeout(450);
    await page
      .getByRole("button", { name: "Pause simulation", exact: true })
      .click();
    await expect(page.locator(".elapsed-time strong")).not.toHaveText(
      "00:00.00s",
    );
    await expect(page.locator(".canvas-error")).toHaveCount(0);
    await expect(page.locator(".monitor-readouts")).not.toContainText("NaN");
  }
  expect(errors).toEqual([]);
});

test("world settings, viewport switches, and advanced fields persist in exports", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "Moon", exact: true }).click();
  await expect(page.locator(".gravity-readout")).toContainText("1.62");
  await page.getByRole("button", { name: "Zero-g", exact: true }).click();
  await page
    .getByRole("switch", { name: "Air resistance", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "Velocity vectors", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Toggle velocity vectors" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Advanced forces", { exact: true }).click();
  await editNumber(page, "Mutual gravity (G)", "0.5");
  await editNumber(page, "Electric constant (k)", "3");
  await editNumber(page, "Magnetic field (B)", "-2");
  await page.getByRole("switch", { name: "Fluid reservoir" }).click();
  await editNumber(page, "Fluid density", "0.8");
  const scene = await exportScene(page);
  expect(scene.environment).toMatchObject({
    gravity: { x: 0, y: 0 },
    airDrag: 0,
    nbodyGravity: 0.5,
    electrostaticConstant: 3,
    magneticField: -2,
    fluid: { density: 0.8 },
  });
  await page.getByRole("button", { name: "Reset world settings" }).click();
  await expect(page.locator(".gravity-readout")).toContainText("9.81");
});

test("adds, edits, duplicates, deletes, and resets bodies", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "Add object", exact: true }).click();
  await page
    .locator(".add-menu")
    .getByRole("button", { name: /Circle/ })
    .click();
  await page.locator("canvas").click({ position: { x: 160, y: 170 } });
  await expect(page.locator(".workspace-status")).toContainText("13 bodies");
  await expect(
    page.getByRole("spinbutton", { name: "Radius", exact: true }),
  ).toBeVisible();
  await editNumber(page, "Radius", "0.75");
  await page
    .getByRole("combobox", { name: "Body material" })
    .selectOption("rubber");
  await expect(
    page.getByRole("spinbutton", { name: "Restitution", exact: true }),
  ).toHaveValue("0.85");
  await editNumber(page, "Velocity X", "3");
  await editNumber(page, "Electric charge", "-1");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator(".workspace-status")).toContainText("14 bodies");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".workspace-status")).toContainText("13 bodies");
  const scene = await exportScene(page);
  expect(
    scene.bodies.find((body) => body.label === "New circle"),
  ).toMatchObject({
    radius: 0.75,
    density: 1.1,
    restitution: 0.85,
    charge: -1,
    velocity: { x: 3, y: 0 },
  });
  await page.getByRole("button", { name: "Reset simulation (R)" }).click();
  await expect(page.locator(".workspace-status")).toContainText("12 bodies");
});

test("paused drag repositions a body, and zoom and pan work", async ({
  page,
}) => {
  await ready(page);
  const canvas = page.locator("canvas");
  const rect = (await canvas.boundingBox())!;
  const scale = Math.min(rect.width / 20, rect.height / 12.5);
  const x = rect.x + rect.width / 2 - 1.7 * scale;
  const y = rect.y + rect.height / 2 - 1.5 * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y - 25, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("combobox", { name: "Select body" })).toHaveValue(
    "coral-ball",
  );
  const scene = await exportScene(page);
  expect(
    scene.bodies.find((b) => b.id === "coral-ball")!.position.x,
  ).toBeCloseTo(-1.7 + 60 / scale, 2);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".zoom-value")).toHaveText("120%");
  await page.getByRole("button", { name: "Fit view (F)" }).click();
  await expect(page.locator(".zoom-value")).toHaveText("100%");
  await page.getByRole("button", { name: "Pan the view (H)" }).click();
  await page.mouse.move(rect.x + 100, rect.y + 150);
  await page.mouse.down();
  await page.mouse.move(rect.x + 140, rect.y + 190, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(".canvas-error")).toHaveCount(0);
});

test("scene import round-trips, browser snapshot reloads, and invalid JSON is rejected", async ({
  page,
}) => {
  await ready(page);
  await page
    .locator(".experiment-list")
    .getByRole("button", { name: /Orbital mechanics/ })
    .click();
  const exported = await exportScene(page);
  const file = page.getByLabel("Import scene file");
  const customized = { ...exported, name: "My orbit experiment" };
  await file.setInputFiles({
    name: "orbit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(customized)),
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "My orbit experiment",
  );
  const roundtrip = await exportScene(page);
  expect(roundtrip).toEqual(customized);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Play simulation", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /Last exported scene/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "My orbit experiment",
  );
  await file.setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"bodies":42}'),
  });
  await expect(page.getByRole("status")).toContainText("Import failed");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "My orbit experiment",
  );
  await expect(page.locator(".canvas-error")).toHaveCount(0);
});

test("CSV contains measured values, and momentum monitor switches correctly", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  await page.waitForTimeout(400);
  await page
    .getByRole("button", { name: "Pause simulation", exact: true })
    .click();
  await page.getByRole("button", { name: "Momentum", exact: true }).click();
  await expect(page.locator(".monitor-readouts")).toContainText("X momentum");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export measurement data as CSV" })
    .click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const lines = Buffer.concat(chunks).toString().trim().split("\n");
  expect(lines[0]).toContain("time_s,kinetic_J,potential_J,total_J");
  expect(lines.length).toBeGreaterThan(2);
  expect(
    lines
      .slice(1)
      .every((line) =>
        line.split(",").every((value) => Number.isFinite(Number(value))),
      ),
  ).toBe(true);
});

test("mobile drawers, touch placement, and guide work without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expect(
    page.getByRole("complementary", { name: "Experiment library" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Experiments", exact: true }).click();
  await page
    .locator(".experiment-list")
    .getByRole("button", { name: /Buoyancy tank/ })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Buoyancy tank",
  );
  await expect(
    page.getByRole("complementary", { name: "Experiment library" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Add a circle (C)" }).click();
  const rect = (await page.locator("canvas").boundingBox())!;
  await page.touchscreen.tap(rect.x + 180, rect.y + 170);
  await expect(page.locator(".workspace-status")).toContainText("8 bodies");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Radius", exact: true }),
  ).toBeVisible();
  await editNumber(page, "Radius", "0.7");
  await page
    .getByRole("button", { name: "Close side panel" })
    .click({ position: { x: 12, y: 150 } });
  await page.getByRole("button", { name: "Field guide", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Physical models", exact: true })
    .click();
  await expect(
    page.getByText("A useful model, not the entire universe."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close guide" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("desktop interface and guide pass automated accessibility checks", async ({
  page,
}) => {
  await ready(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("button", { name: "Field guide", exact: true }).click();
  const guide = await new AxeBuilder({ page }).analyze();
  expect(guide.violations).toEqual([]);
});

test("expanded settings, body inspector, and mobile controls remain accessible", async ({
  page,
}) => {
  await ready(page);
  await page.getByText("Advanced forces", { exact: true }).click();
  await page.getByRole("switch", { name: "Fluid reservoir" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Select body" })
    .selectOption("coral-ball");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("compact desktop, tablet, and small phone layouts do not overflow", async ({
  page,
}) => {
  await ready(page);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("button", { name: "Play simulation", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const canvas = await page.locator("canvas").boundingBox();
    expect(canvas!.width).toBeGreaterThan(250);
    expect(canvas!.height).toBeGreaterThan(250);
    await expect(page.locator(".canvas-error")).toHaveCount(0);
  }
});
