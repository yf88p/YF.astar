import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const out = path.resolve("verification");
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
page.setDefaultTimeout(10000);
const errors = [],
  checks = [],
  timings = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (name, value) => {
  assert(value, name);
  checks.push(name);
  console.log(`PASS ${name}`);
};
const state = () => page.evaluate(() => window.__forma.project());
const current = async () => {
  const p = await state();
  return p.designs.find((d) => d.id === p.activeDesignId);
};
async function number(label, value) {
  const f = page.getByRole("spinbutton", { name: label, exact: true });
  await f.fill(String(value));
  await f.press("Enter");
}
async function planPoint(x, y) {
  return page.locator('[data-testid="plan-canvas"]').evaluate(
    (svg, { x, y }) => {
      const p = svg.createSVGPoint();
      p.x = x;
      p.y = y;
      const q = p.matrixTransform(svg.getScreenCTM());
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
}
async function clickPlan(x, y) {
  const p = await planPoint(x, y);
  await page.mouse.click(p.x, p.y);
}
async function download(button, name) {
  const wait = page.waitForEvent("download");
  await button.click();
  const d = await wait;
  await d.saveAs(path.join(out, name));
  return fs.readFile(path.join(out, name));
}
try {
  await page.goto(process.env.FORMA_URL || "http://localhost:5185");
  await page.waitForSelector('[data-testid="scene-canvas"]');
  await page.waitForFunction(
    () => window.__forma?.scene()?.stats().frames > 15,
  );
  await page.screenshot({ path: path.join(out, "desktop.png") });
  const baseline = await state();
  check(
    "cafe opens with linked editable plan and real canvas",
    (await current()).furniture.length >= 20 &&
      (await page.locator('[data-testid="plan-canvas"]').isVisible()),
  );
  await page.getByTitle("Dismiss welcome").click();
  await clickPlan(5, 0);
  await number("Wall length", 11);
  let d = await current();
  check(
    "numeric wall edit changes shared endpoint",
    d.vertices.find((v) => v.id === "v-1").x === 11,
  );
  check(
    "hosted openings preserved",
    JSON.stringify(d.openings) === JSON.stringify(baseline.designs[0].openings),
  );
  check(
    "room area updated analytically to trapezoid 84 m2",
    await page
      .locator('[data-testid="plan-canvas"]')
      .textContent()
      .then((s) => s.includes("84.00 m²")),
  );
  const editedBudget = await page.getByTestId("budget-total").textContent();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  check(
    "structural undo restores baseline endpoint",
    (await current()).vertices.find((v) => v.id === "v-1").x === 10,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  check(
    "redo restores derived budget",
    (await page.getByTestId("budget-total").textContent()) === editedBudget,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Door", exact: true }).click();
  await clickPlan(1.2, 0);
  d = await current();
  const door = d.openings.find(
    (o) => !baseline.designs[0].openings.some((b) => b.id === o.id),
  );
  check("door tool adds hosted doorway", door?.type === "door");
  await number("Door angle", 90);
  await page.getByRole("button", { name: "Window", exact: true }).click();
  await clickPlan(8.4, 0);
  d = await current();
  check(
    "window tool adds elevated opening",
    d.openings.some((o) => o.type === "window" && o.wallId === "wall-0"),
  );
  await page.getByRole("button", { name: "Walkthrough", exact: true }).click();
  await page.waitForFunction(
    () => window.__forma.scene().stats().mode === "walk",
  );
  const hole = await page.evaluate(
    ({ door }) => {
      const s = window.__forma.scene();
      return {
        door: s.probe(
          [door.offset + 0.6, 1, -0.4],
          [door.offset + 0.6, 1, 0.4],
        ),
        window: s.probe([8.4, 1.5, -0.4], [8.4, 1.5, 0.4]),
        below: s.probe([8.4, 0.4, -0.4], [8.4, 0.4, 0.4]),
      };
    },
    { door },
  );
  check(
    "raycast through actual door mesh hole has no wall face",
    !hole.door.some((h) => h.wall),
  );
  check(
    "raycast through elevated window has no wall face",
    !hole.window.some((h) => h.wall),
  );
  check(
    "solid wall remains under window",
    hole.below.some((h) => h.wall),
  );
  // Use a saved-camera API to place a reproducible starting camera, then actual
  // keyboard frames and the real application collision path to cross the wall.
  await page.evaluate(
    ({ x }) =>
      window.__forma
        .scene()
        .setView({ position: [x, 1.65, -0.65], target: [x, 1.65, 1] }),
    { x: door.offset + 0.6 },
  );
  await page
    .locator('[data-testid="scene-canvas"]')
    .click({ position: { x: 250, y: 260 } });
  const locked = await page.evaluate(() => !!document.pointerLockElement);
  check("walkthrough acquires actual pointer lock", locked);
  await page.keyboard.down("KeyW");
  await page.waitForFunction(
    () => window.__forma.scene().stats().camera[2] > 0.35,
    {},
    { timeout: 12000 },
  );
  await page.keyboard.up("KeyW");
  check(
    "open doorway permits real first-person traversal",
    (await page.evaluate(() => window.__forma.scene().stats().camera))[2] >
      0.35,
  );
  await page.keyboard.press("Escape");
  await page.getByTitle("Leave walkthrough").click();
  await clickPlan(door.offset + 0.5, 0);
  await number("Door angle", 0);
  await page.getByRole("button", { name: "Walkthrough", exact: true }).click();
  await page.evaluate(
    ({ x }) =>
      window.__forma
        .scene()
        .setView({ position: [x, 1.65, -0.65], target: [x, 1.65, 1] }),
    { x: door.offset + 0.6 },
  );
  await page.keyboard.down("KeyW");
  const startFrames = await page.evaluate(
    () => window.__forma.scene().stats().frames,
  );
  await page.waitForFunction(
    (n) => window.__forma.scene().stats().frames > n + 30,
    startFrames,
    { timeout: 15000 },
  );
  await page.keyboard.up("KeyW");
  check(
    "closed doorway stops real walkthrough before wall",
    (await page.evaluate(() => window.__forma.scene().stats().camera))[2] <
      -0.19,
  );
  await page.evaluate(() =>
    window.__forma
      .scene()
      .setView({ position: [8.4, 1.65, -0.65], target: [8.4, 1.65, 1] }),
  );
  await page.keyboard.down("KeyW");
  const f0 = await page.evaluate(() => window.__forma.scene().stats().frames);
  await page.waitForFunction(
    (n) => window.__forma.scene().stats().frames > n + 25,
    f0,
    { timeout: 15000 },
  );
  await page.keyboard.up("KeyW");
  check(
    "window is not a walkable portal",
    (await page.evaluate(() => window.__forma.scene().stats().camera))[2] <
      -0.19,
  );
  await page.getByTitle("Leave walkthrough").click();
  d = await current();
  const table = d.furniture.find((f) => f.catalogId === "bistro");
  await clickPlan(table.x, table.y);
  await number("Position X", door.offset + 0.5);
  await number("Position Y", 0.65);
  check(
    "table in door region raises clearance warning",
    await page
      .locator(".warning-list")
      .textContent()
      .then((s) => s.includes("Arc bistro table obstructs")),
  );
  await number("Position Y", 2.8);
  check(
    "moving furniture clears its door warning",
    await page
      .locator(".warning-list")
      .textContent()
      .catch(() => "")
      .then((s) => !s.includes("Arc bistro table obstructs")),
  );
  await number("Position X", table.x);
  await number("Position Y", table.y);
  const beforeDrag = await current(),
    a = await planPoint(table.x, table.y),
    b = await planPoint(table.x + 0.4, table.y + 0.4);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  check(
    "pointer drag changes furniture coordinates",
    (await current()).furniture.find((f) => f.id === table.id).x !== table.x,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  check(
    "completed drag is one full undo transaction",
    JSON.stringify((await current()).furniture) ===
      JSON.stringify(beforeDrag.furniture),
  );
  // Real raycasting selection from a top-down camera isolates the intended table.
  await page.evaluate(
    ({ x, y }) =>
      window.__forma
        .scene()
        .setView({ position: [x, 6, y + 0.01], target: [x, 0, y] }),
    { x: table.x, y: table.y },
  );
  const canvas = await page.getByTestId("scene-canvas").boundingBox();
  await page.mouse.click(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  check(
    "3D raycast selects same furniture in inspector",
    (await page
      .getByRole("spinbutton", { name: "Position X", exact: true })
      .inputValue()) === String(table.x),
  );
  check(
    "linked plan marks the selected furniture",
    (await page
      .getByTestId(table.id)
      .locator("rect")
      .first()
      .getAttribute("stroke")) === "#de925c",
  );
  await page.keyboard.press("Escape");
  await page.getByTitle("Reset camera (F)").click();
  await page.getByLabel("floor: Natural oak", { exact: true }).click();
  await page.getByLabel("wall: Sage mineral", { exact: true }).click();
  await page.getByRole("slider", { name: "Daylight", exact: true }).fill("0.8");
  await page
    .getByRole("slider", { name: "Daylight", exact: true })
    .press("ArrowRight");
  await page.getByTitle("Save current camera view").click();
  check(
    "finishes, light settings and saved view persist",
    (await current()).floorMaterial === "oak" &&
      (await current()).walls.every((w) => w.material === "sage") &&
      (await current()).savedViews.length === 1,
  );
  const original = await current();
  await page.getByTitle("Duplicate into independent alternative").click();
  await page.getByLabel("floor: Terracotta", { exact: true }).click();
  check(
    "alternative does not mutate baseline",
    JSON.stringify(
      (await state()).designs.find((d) => d.id === original.id),
    ) === JSON.stringify(original),
  );
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  check(
    "comparison shows independently calculated budget deltas",
    (await page.locator(".comparison-grid article").count()) === 3 &&
      (await page
        .locator(".comparison-grid")
        .textContent()
        .then((t) => t.includes("vs baseline"))),
  );
  await page.getByLabel("Close dialog").click();
  await clickPlan(5, 0);
  const beforeDelete = await current();
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Delete");
  check(
    "wall deletion explicitly removes attached openings",
    (await current()).openings.length ===
      beforeDelete.openings.filter((o) => o.wallId !== "wall-0").length,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  check(
    "wall deletion undo restores every attachment",
    JSON.stringify((await current()).openings) ===
      JSON.stringify(beforeDelete.openings),
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const json = await download(
    page.getByRole("button", { name: /Editable project/ }),
    "project.forma.json",
  );
  const saved = await state();
  await page.reload();
  await page.waitForFunction(() => window.__forma?.scene());
  check(
    "autosaved project survives reload",
    JSON.stringify(await state()) === JSON.stringify(saved),
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":9}'),
  });
  check(
    "malformed import leaves current project intact",
    JSON.stringify(await state()) === JSON.stringify(saved),
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "restored.json",
    mimeType: "application/json",
    buffer: json,
  });
  check(
    "valid JSON reimport preserves complete project",
    JSON.stringify(await state()) === JSON.stringify(saved),
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const svg = await download(
    page.getByRole("button", { name: /Measured floor plan/ }),
    "plan.svg",
  );
  check(
    "SVG includes full precision measured wall data",
    svg.toString().includes('data-length-m="10"'),
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const csv = await download(
    page.getByRole("button", { name: /Schedule & budget/ }),
    "schedule.csv",
  );
  check(
    "CSV contains quantities and stated currency",
    csv.toString().includes("TOTAL USD") &&
      csv.toString().includes("Wall finish (both faces"),
  );
  await page.getByRole("button", { name: "Present", exact: true }).click();
  const png = await download(
    page.getByRole("button", { name: "Capture image", exact: true }),
    "scene.png",
  );
  check(
    "current-scene PNG export is a real image",
    png.length > 15000 && png.subarray(1, 4).toString() === "PNG",
  );
  await page.screenshot({ path: path.join(out, "presentation.png") });
  await page
    .getByRole("button", { name: "Back to studio", exact: true })
    .click();
  // Blank project construction entirely through ordinary tools.
  await page.getByTitle("Open examples or create blank project").click();
  await page
    .getByRole("button", { name: "Create a blank space", exact: true })
    .click();
  for (const [x, y] of [
    [0, 0],
    [6, 0],
    [6, 5],
    [0, 5],
    [0, 0],
  ])
    await clickPlan(x, y);
  await page.keyboard.press("Escape");
  check(
    "blank project wall drawing creates analytical 30 m2 room",
    await page
      .getByTestId("floor-area")
      .textContent()
      .then((s) => s.startsWith("30.00")),
  );
  await page
    .locator(".catalog-card")
    .filter({ hasText: "Arc bistro table" })
    .click();
  await clickPlan(3, 2.5);
  check(
    "catalog places physical furniture into a new design",
    (await current()).furniture.length === 1,
  );
  // Render every furnished example, not just the signature cafe.
  for (const name of ["Atelier No. 04", "Common Ground"]) {
    await page.getByTitle("Open examples or create blank project").click();
    await page.locator(".example-card").filter({ hasText: name }).click();
    await page.waitForFunction(
      () => window.__forma.scene().stats().frames > 10,
    );
    await page.getByTitle("Reset camera (F)").click();
    check(
      `${name} loads its own editable furnished scene`,
      (await current()).furniture.length >= 12,
    );
    await page.screenshot({
      path: path.join(
        out,
        `${name.startsWith("Atelier") ? "boutique" : "exhibition"}.png`,
      ),
    });
  }
  // Mobile layout, with real numeric editing exposed in a selection drawer.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, "mobile.png") });
  check(
    "mobile layout has no horizontal overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await clickPlan(4, 0);
  check(
    "mobile can open numeric wall inspector",
    await page
      .getByRole("spinbutton", { name: "Wall length", exact: true })
      .isVisible(),
  );
  await page.getByTitle("Close inspector selection").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    const p = window.__forma.project(),
      d = p.designs[0];
    d.name = "4 x 3 opening fixture";
    d.vertices = [
      { id: "fa", x: 0, y: 0 },
      { id: "fb", x: 4, y: 0 },
    ];
    d.walls = [
      {
        id: "fixture-wall",
        a: "fa",
        b: "fb",
        height: 3,
        thickness: 0.2,
        material: "plaster",
      },
    ];
    d.openings = [
      {
        id: "fixture-door",
        wallId: "fixture-wall",
        type: "door",
        offset: 0.2,
        width: 1,
        height: 2,
        sill: 0,
        angle: 90,
      },
      {
        id: "fixture-window",
        wallId: "fixture-wall",
        type: "window",
        offset: 2,
        width: 1,
        height: 1,
        sill: 1,
        angle: 0,
      },
    ];
    d.furniture = [];
    d.lights = [];
    d.roomNames = {};
    p.designs = [d];
    p.activeDesignId = d.id;
    p.name = "Isolated wall verification";
    window.__forma.load(p);
  });
  await page
    .getByRole("button", { name: "View schedule", exact: true })
    .click();
  check(
    "isolated 4x3 fixture reports exactly 18 m2 for two costed faces",
    await page
      .getByRole("spinbutton", { name: "Walls / 18.000 m²", exact: true })
      .isVisible(),
  );
  await page.getByLabel("Close dialog").click();
  await page.getByRole("button", { name: "Walkthrough", exact: true }).click();
  const fixtureHoles = await page.evaluate(() => ({
    door: window.__forma.scene().probe([0.8, 1, -0.4], [0.8, 1, 0.4]),
    window: window.__forma.scene().probe([2.5, 1.5, -0.4], [2.5, 1.5, 0.4]),
    sill: window.__forma.scene().probe([2.5, 0.5, -0.4], [2.5, 0.5, 0.4]),
  }));
  check(
    "the exact numerical fixture has both real mesh holes and a solid window sill",
    !fixtureHoles.door.some((h) => h.wall) &&
      !fixtureHoles.window.some((h) => h.wall) &&
      fixtureHoles.sill.some((h) => h.wall),
  );
  await page.evaluate(() =>
    window.__forma
      .scene()
      .setView({ position: [0.8, 1.65, -0.6], target: [0.8, 1.65, 1] }),
  );
  await page.keyboard.down("KeyW");
  await page.waitForFunction(
    () => window.__forma.scene().stats().camera[2] > 0.3,
    null,
    { timeout: 12000 },
  );
  await page.keyboard.up("KeyW");
  check(
    "exact 1x2 meter fixture doorway is traversed with actual keyboard movement",
    (await page.evaluate(() => window.__forma.scene().stats().camera))[2] > 0.3,
  );
  await page.getByTitle("Leave walkthrough").click();
  // Visible bounded workload. Samples are actual requestAnimationFrame intervals,
  // not a claimed refresh rate or invisible scene measurement.
  await page.evaluate(() => window.__forma.stress());
  await page.waitForFunction(
    () => window.__forma.project().name === "Performance study",
  );
  await page.getByTitle("Reset camera (F)").click();
  const frameStart = await page.evaluate(
    () => window.__forma.scene().stats().frames,
  );
  await page.waitForFunction(
    (n) => window.__forma.scene().stats().frames > n + 65,
    frameStart,
    { timeout: 60000 },
  );
  const perf = await page.evaluate(() => window.__forma.scene().stats());
  let ps = await state();
  check(
    "performance workload is 40 walls and 100 visible furnishings",
    ps.designs[0].walls.length === 40 &&
      ps.designs[0].furniture.length === 100 &&
      perf.triangles > 50000,
  );
  await page.screenshot({ path: path.join(out, "stress.png") });
  for (let i = 0; i < 10; i++) {
    const t = performance.now();
    await page.evaluate((i) => {
      const p = window.__forma.project();
      p.designs[0].furniture[0].rotation = i * 7;
      window.__forma.load(p);
    }, i);
    await page.waitForFunction(
      (i) =>
        window.__forma.project().designs[0].furniture[0].rotation === i * 7,
      i,
    );
    timings.push({
      browserRoundTripMs: performance.now() - t,
      rebuildMs: await page.evaluate(
        () => window.__forma.scene().stats().editMs,
      ),
    });
  }
  const memoryAfter = await page.evaluate(() => window.__forma.scene().stats());
  check(
    "repeated edits release obsolete geometries",
    memoryAfter.geometries <= perf.geometries + 3,
  );
  const times = perf.frameTimes.slice(-60).sort((a, b) => a - b);
  const report = {
    applicationURL: page.url(),
    date: new Date().toISOString(),
    browser: browser.version(),
    hardware: {
      cpu: os.cpus()[0].model,
      logicalCPUs: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / 1024 ** 3),
    },
    rendering:
      "Headless Chromium, ANGLE SwiftShader software WebGL; 1440x1000 viewport, DPR 1; shared host",
    scene: {
      walls: 40,
      furniture: 100,
      triangles: perf.triangles,
      drawCalls: perf.drawCalls,
      geometries: perf.geometries,
      textures: perf.textures,
    },
    frames: {
      samples: times.length,
      medianMs: times[Math.floor(times.length * 0.5)],
      p95Ms: times[Math.floor(times.length * 0.95)],
      minMs: times[0],
      maxMs: times.at(-1),
    },
    edits: timings,
    memoryAfter: {
      geometries: memoryAfter.geometries,
      textures: memoryAfter.textures,
    },
    checks,
    errors,
  };
  check("no unhandled browser exceptions", errors.length === 0);
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await fs.rm(path.join(out, "failure.png"), { force: true });
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page
    .screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  console.error("BROWSER VERIFICATION FAILED", e);
  console.error(
    "Scene:",
    await page.evaluate(() => window.__forma?.scene()?.stats() || null),
  );
  console.error(
    "Recent page state:",
    await page
      .locator("body")
      .innerText()
      .then((s) => s.slice(-1600)),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
