import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { chromium } from "@playwright/test";
import { createElement, createProject } from "../src/examples.js";

// Exercises the production bundle, not a UI mock or a separate tracer page.
const port = Number(process.env.LUMEN_TEST_PORT || 5399);
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (d) => {
  serverOutput += d;
});
server.stderr.on("data", (d) => {
  serverOutput += d;
});
const url = `http://127.0.0.1:${port}`;
let browser;
const report = { date: new Date().toISOString(), checks: [], benchmark: null };
const check = (name, extra = {}) => {
  console.log(
    `PASS ${name}`,
    Object.keys(extra).length ? JSON.stringify(extra) : "",
  );
  report.checks.push({ name, ...extra });
};
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null)
      throw new Error(`Preview exited: ${serverOutput}`);
    try {
      const response = await fetch(url);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Production preview did not start: ${serverOutput}`);
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  const pageErrors = [],
    externalRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (
      !request.url().startsWith(url) &&
      !request.url().startsWith("blob:") &&
      !request.url().startsWith("data:")
    )
      externalRequests.push(request.url());
  });
  const traced = () =>
    page
      .getByText("Trace complete", { exact: true })
      .waitFor({ timeout: 30000 });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const numeric = async (name, value) => {
    const field = page.getByRole("spinbutton", { name, exact: true });
    await field.fill(String(value));
    await field.press("Enter");
    await traced();
  };
  const download = async (name) => {
    const event = page.waitForEvent("download");
    await button(name).click();
    const stream = await (await event).createReadStream(),
      chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  };
  const exported = async () => JSON.parse(await download("Export project"));
  const imported = async (project) => {
    if (await page.locator(".toast").isVisible())
      await button("Dismiss notification").click();
    await page
      .getByTestId("import-file")
      .setInputFiles({
        name: "fixture.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          typeof project === "string" ? project : JSON.stringify(project),
        ),
      });
    // File.text() is asynchronous: wait for acceptance/rejection before observing
    // trace state, otherwise a prior project's "Trace complete" can race import.
    await page.locator(".toast").waitFor();
  };
  await page.goto(url);
  await traced();
  assert.equal(await page.getByTestId("ray-count").innerText(), "1,701 rays");
  assert.ok(
    (await page.locator(".image-note").innerText()).includes("Inverted image"),
  );
  assert.equal((await exported()).elements.length, 4);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  check("Production loads; actual extended-object image is inverted");

  await button("Clear bench").click();
  await traced();
  for (const type of ["source", "lens", "stop", "detector"]) {
    await page.getByTestId(`add-${type}`).click();
    await traced();
  }
  let project = await exported();
  assert.deepEqual(
    project.elements.map((e) => e.type),
    ["source", "lens", "stop", "detector"],
  );
  const lensId = project.elements.find((e) => e.type === "lens").id,
    stopId = project.elements.find((e) => e.type === "stop").id;
  await page
    .getByTestId(
      `select-${project.elements.find((e) => e.type === "source").id}`,
    )
    .click();
  await numeric("Samples / point / wavelength", 23);
  assert.equal(await page.getByTestId("ray-count").innerText(), "69 rays");
  await button("Undo").click();
  await traced();
  assert.equal(await page.getByTestId("ray-count").innerText(), "243 rays");
  await button("Redo").click();
  await traced();
  assert.equal(await page.getByTestId("ray-count").innerText(), "69 rays");
  await button("Undo").click();
  await traced();
  check("Source sampling history changes actual emitted population");
  await page.getByTestId(`select-${lensId}`).click();
  await numeric("Position X", 3.125);
  assert.equal(
    (await exported()).elements.find((e) => e.id === lensId).position[0],
    3.125,
  );
  const xInput = page.getByRole("spinbutton", {
    name: "Position X",
    exact: true,
  });
  await xInput.fill("7.125");
  await xInput.press("Escape");
  assert.equal(
    (await exported()).elements.find((e) => e.id === lensId).position[0],
    3.125,
  );
  await button("Undo").click();
  await traced();
  assert.equal(
    (await exported()).elements.find((e) => e.id === lensId).position[0],
    0,
  );
  await button("Redo").click();
  await traced();
  assert.equal(
    (await exported()).elements.find((e) => e.id === lensId).position[0],
    3.125,
  );
  check("Construct system and edit precise lens position; undo/redo");

  const beforeDrag = await exported();
  const lensShape = page
    .getByTestId(`element-${lensId}`)
    .locator("path")
    .nth(1);
  const box = await lensShape.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 25,
    box.y + box.height / 2 - 6,
    { steps: 8 },
  );
  await page.mouse.up();
  await traced();
  const afterDrag = await exported();
  assert.notDeepEqual(
    afterDrag.elements.find((e) => e.id === lensId).position,
    beforeDrag.elements.find((e) => e.id === lensId).position,
  );
  await button("Undo").click();
  await traced();
  assert.deepEqual(await exported(), beforeDrag);
  await button("Redo").click();
  await traced();
  assert.deepEqual(await exported(), afterDrag);
  await button("Undo").click();
  await traced();
  check("Completed lens drag is exactly one reversible history operation");

  const beforeMulti = await exported();
  await page.getByTestId(`select-${lensId}`).click();
  await page.getByTestId(`select-${stopId}`).click({ modifiers: ["Shift"] });
  assert.equal(await page.locator(".system-item.selected").count(), 2);
  await page.keyboard.press("ArrowUp");
  await traced();
  const nudged = await exported();
  for (const id of [lensId, stopId])
    assert.equal(
      nudged.elements.find((e) => e.id === id).position[1],
      beforeMulti.elements.find((e) => e.id === id).position[1] + 1,
    );
  await button("Undo").click();
  await traced();
  assert.deepEqual(await exported(), beforeMulti);
  await page.keyboard.press("Control+d");
  await traced();
  assert.equal((await exported()).elements.length, 6);
  await page.keyboard.press("Delete");
  await traced();
  assert.deepEqual(await exported(), beforeMulti);
  await button("Undo").click();
  await traced();
  assert.equal((await exported()).elements.length, 6);
  await button("Undo").click();
  await traced();
  assert.deepEqual(await exported(), beforeMulti);
  check(
    "Multiselection, keyboard nudge, duplication and deletion preserve exact undo history",
  );

  await page.getByTestId(`select-${stopId}`).click();
  const originalHits = await page.getByTestId("hit-count").innerText();
  await numeric("Opening diameter", 10);
  assert.notEqual(
    await page.getByTestId("hit-count").innerText(),
    originalHits,
  );
  assert.match(
    await page.locator(".termination-counts").innerText(),
    /clipped/,
  );
  await button("Undo").click();
  await traced();
  assert.equal(
    (await exported()).elements.find((e) => e.id === stopId).aperture,
    24,
  );
  check(
    "Aperture editing changes computed throughput and records blocked rays",
  );

  await button("Ray inspector").click();
  const raySelect = page.getByRole("combobox", {
    name: "Inspect ray",
    exact: true,
  });
  const detected = await raySelect
    .locator("option")
    .evaluateAll(
      (options) =>
        options.find((o) => o.textContent.includes("detected"))?.value,
    );
  assert.ok(detected);
  await raySelect.selectOption(detected);
  assert.ok((await page.locator(".hit-table tbody tr").count()) >= 3);
  assert.match(await page.locator(".hit-table").innerText(), /refract/);
  assert.match(await page.locator(".hit-table").innerText(), /Air \/ ambient/);
  check(
    "Ray inspector exposes surface hits, normals, directions, media and termination",
  );

  await button("Focus scan").click();
  await numeric("Start X", 60);
  await numeric("End X", 110);
  await numeric("Positions", 11);
  await button("Scan focus").click();
  await page.locator(".best-focus").waitFor({ timeout: 30000 });
  assert.match(await page.locator(".best-focus").innerText(), /hits.*%/);
  await page.locator(".scan-data summary").click();
  assert.equal(await page.locator(".scan-data tbody tr").count(), 11);
  await page.screenshot({ path: "test-results/focus.png", fullPage: true });
  await page.locator(".best-focus").click();
  await traced();
  check(
    "Finite focus scan computes 11 positions with objective, counts and throughput",
  );

  await page.locator(".example-trigger").click();
  await page.getByTestId("example-prism").click();
  await traced();
  await button("Spot diagram").click();
  assert.equal(await page.locator(".wave-chip").count(), 6);
  const prismGroups = await page
    .locator(".group-table tbody tr")
    .allTextContents();
  assert.equal(prismGroups.length, 6);
  assert.notEqual(prismGroups[0], prismGroups[5]);
  await button("Toggle 430 nm").click();
  assert.equal(
    await button("Toggle 430 nm").getAttribute("aria-pressed"),
    "false",
  );
  await button("Toggle 430 nm").click();
  await numeric("Cauchy B", 0);
  const zeroRows = await page
    .locator(".group-table tbody tr")
    .evaluateAll((rows) => rows.map((row) => row.children[3].textContent));
  assert.equal(new Set(zeroRows).size, 1);
  await button("Undo").click();
  await traced();
  assert.equal(
    (await exported()).materials.find((m) => m.id === "flint").B,
    0.015,
  );
  check(
    "Prism wavelength comparison; B=0 removes geometric color separation; material undo",
  );

  await button("3D scene").click();
  await page.locator(".view-container canvas").waitFor();
  assert.equal(await page.locator(".view-container canvas").count(), 1);
  const canvasBox = await page.locator(".view-container canvas").boundingBox();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.6,
    canvasBox.y + canvasBox.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.6 + 45,
    canvasBox.y + canvasBox.height * 0.5 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -100);
  await page.screenshot({ path: "test-results/3d.png", fullPage: true });
  check("Production WebGL 3D view loads and orbit/zoom controls respond");

  project = await exported();
  const csv = await download("Export CSV");
  assert.ok(
    csv.startsWith(
      '"record","ray_id","source_id","object_point_id","wavelength_nm"',
    ),
  );
  assert.match(csv, /"u_mm","v_mm"/);
  assert.match(csv, /"refract"/);
  assert.match(csv, /"detect"/);
  await button("Clear bench").click();
  await traced();
  await imported(project);
  await traced();
  assert.deepEqual(await exported(), project);
  assert.equal(
    await download("Export CSV"),
    csv,
    "Imported project must reproduce all exported ray-hit records exactly",
  );
  const validMetrics = await page.getByTestId("hit-count").innerText();
  for (const malformed of [
    "{not json",
    { ...project, version: 999 },
    {
      ...project,
      elements: project.elements.map((e) =>
        e.type === "prism" ? { ...e, materialId: "missing" } : e,
      ),
    },
  ]) {
    await imported(malformed);
    await page.getByRole("alert").waitFor();
    assert.deepEqual(await exported(), project);
    assert.equal(await page.getByTestId("hit-count").innerText(), validMetrics);
    await button("Dismiss notification").click();
  }
  check(
    "JSON and identity-bearing CSV export; editable equivalent import; malformed imports remain atomic",
  );

  await button("2D bench").click();
  await page.locator(".example-trigger").click();
  await page.getByTestId("example-showcase").click();
  await traced();
  await numeric("Clear aperture", 200);
  await page.getByRole("alert").waitFor();
  assert.equal(
    (await exported()).elements.find((e) => e.type === "lens").aperture,
    30,
  );
  await button("Dismiss notification").click();
  await numeric("Clear aperture", 28);
  assert.equal(
    (await exported()).elements.find((e) => e.type === "lens").aperture,
    28,
  );
  check(
    "Invalid geometry edit rejected; inspector remains editable and recoverable",
  );

  const benchmarkProject = createProject();
  benchmarkProject.elements = [
    {
      ...createElement("source", 80),
      kind: "collimated",
      beamRadius: 12,
      samples: 5000,
      wavelengths: [450, 650],
    },
    { ...createElement("stop", 80), aperture: 24 },
    createElement("lens", 80),
    {
      ...createElement("slab", 80),
      thickness: 5,
      aperture: 40,
      position: [22, 0, 0],
    },
    {
      ...createElement("detector", 80),
      position: [50, 0, 0],
      width: 60,
      height: 60,
    },
  ];
  const start = performance.now();
  await imported(benchmarkProject);
  await traced();
  assert.equal(await page.getByTestId("ray-count").innerText(), "10,000 rays");
  const traceMs = Number(
    (await page.getByTestId("trace-duration").innerText()).replace(" ms", ""),
  );
  const endToEndMs = performance.now() - start;
  assert.ok(
    endToEndMs >= traceMs,
    "End-to-end time must include the actual worker trace, not a stale prior completion",
  );
  const detectedCount = Number(
    (await page.getByTestId("hit-count").innerText())
      .split("/")[0]
      .replaceAll(",", "")
      .trim(),
  );
  assert.equal(detectedCount, 10000);
  const benchmarkCSV = await download("Export CSV");
  assert.equal(benchmarkCSV.split("\r\n").length - 1, 50000);
  report.benchmark = {
    rays: 10000,
    wavelengthsNm: [450, 650],
    samplesPerWavelength: 5000,
    source: "deterministic 12 mm radius 3D collimated disk",
    elements:
      "finite stop, two-spherical-surface crown lens, plane-parallel crown slab, detector",
    opticalHits: 50000,
    detected: detectedCount,
    terminations: await page.locator(".termination-counts").innerText(),
    workerTraceAndAggregationMs: traceMs,
    importThroughRenderedResultMs: Number(endToEndMs.toFixed(1)),
    browser: await browser.version(),
    headless: true,
    cpu: os.cpus()[0].model,
    logicalCPUs: os.cpus().length,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    renderer:
      "Chromium headless; SwiftShader enabled for WebGL; CPU tracing in module Worker",
    node: process.version,
  };
  console.log("BENCHMARK", JSON.stringify(report.benchmark, null, 2));
  check(
    "Real 10,000-ray production-worker multi-element benchmark; all 50,000 hits exported",
  );

  await button("Focus scan").click();
  await numeric("Positions", 101);
  const focusStarted = page.waitForEvent("worker");
  await button("Scan focus").click();
  await focusStarted;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await numeric("End X", 120);
  assert.equal(await page.locator(".best-focus").count(), 0);
  assert.equal(await page.getByTestId("ray-count").innerText(), "10,000 rays");
  check(
    "Editing a running focus interval cancels and invalidates its old objective",
  );
  await button("Spot diagram").click();

  const heavy = structuredClone(benchmarkProject);
  heavy.elements[0].samples = 100000;
  const heavyStarted = page.waitForEvent("worker");
  await imported(heavy);
  await heavyStarted;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await button("Cancel").waitFor();
  const cancelStart = performance.now();
  await button("Cancel").click();
  assert.ok(performance.now() - cancelStart < 2000);
  await page.getByText("Measurements invalid", { exact: true }).waitFor();
  await imported(benchmarkProject);
  await traced();
  assert.equal(await page.getByTestId("ray-count").innerText(), "10,000 rays");
  await imported(heavy);
  await button("Cancel").waitFor();
  await imported(createProject());
  await traced();
  assert.equal(await page.getByTestId("ray-count").innerText(), "1,701 rays");
  // Check a later animation frame as well as the first result to catch stale-job publication.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(await page.getByTestId("ray-count").innerText(), "1,701 rays");
  check(
    "Large trace cancellation stays responsive; new edit supersedes in-flight worker",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await button("Inspector").click();
  await page
    .getByRole("heading", { name: "A place for precision.", exact: true })
    .waitFor();
  await button("Library").click();
  await page.getByTestId("select-lens-0").click();
  await button("Inspector").click();
  await numeric("Position Z", 1.25);
  assert.equal(
    (await exported()).elements.find((e) => e.id === "lens-0").position[2],
    1.25,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await button("Workspace").click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  check(
    "390px and 320px mobile workflows; library, workspace, numeric inspector; no horizontal overflow",
  );
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  check("No uncaught browser errors and no remote application requests");
  await writeFile(
    "test-results/browser-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(`${report.checks.length} browser workflow groups passed.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page
          .screenshot({ path: "test-results/failure.png", fullPage: true })
          .catch(() => {});
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
