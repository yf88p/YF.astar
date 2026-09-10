import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import {
  chromium,
  expect as playwrightExpect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import type {
  CircuitDocument,
  Endpoint,
  Netlist,
  Solution,
  TransientResult,
} from "../src/types";

// Observe native workers without replacing their computation, messages, or timing.
type WorkerResult = {
  type: "result";
  mode: "dc" | "transient";
  revision: number;
  netlist: Netlist;
  result: Solution | TransientResult;
  elapsed: number;
};
type WorkerRecord = {
  request?: { revision: number; mode: string };
  messages: (
    | WorkerResult
    | { type: "progress"; fraction: number }
    | { type: "error"; message: string }
  )[];
  terminated: boolean;
};
type Audit = { workers: WorkerRecord[]; budgets: number[] };
type AuditedWindow = typeof window & { __fieldworkVerification: Audit };
const output = "/tmp/opencode";
const root = fileURLToPath(new URL("..", import.meta.url));
const failures: string[] = [];
const browserErrors: string[] = [];
const outcomes: {
  name: string;
  status: string;
  ms: number;
  detail?: string;
}[] = [];
let browser: Browser | undefined;
let server: ChildProcess | undefined;
let baseURL = process.env.BASE_URL;
let divider: CircuitDocument | undefined;
let downloadSequence = 0;
const expect = playwrightExpect.configure({ timeout: 5000 });

async function startServer() {
  if (baseURL) return;
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  let log = "";
  server = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vite/bin/vite.js", import.meta.url),
      ),
      ...(process.env.VERIFY_PRODUCTION === "1" ? ["preview"] : []),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout?.on("data", (chunk) => {
    log = (log + chunk).slice(-12000);
  });
  server.stderr?.on("data", (chunk) => {
    log = (log + chunk).slice(-12000);
  });
  server.on("error", (error) => {
    log += String(error);
  });
  baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    assert(
      server.exitCode === null && server.signalCode === null,
      `Vite exited before readiness: ${log}`,
    );
    try {
      if ((await fetch(baseURL, { signal: AbortSignal.timeout(1000) })).ok)
        return;
    } catch {
      /* Poll only until the readiness deadline. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite was not ready within 15 seconds: ${log}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const kill = setTimeout(() => server?.kill("SIGKILL"), 4000);
    const bound = setTimeout(resolve, 5000);
    server!.once("exit", () => {
      clearTimeout(kill);
      clearTimeout(bound);
      resolve();
    });
    server!.kill("SIGTERM");
  });
}

async function newPage(mobile = false) {
  const context = await browser!.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    acceptDownloads: true,
    reducedMotion: "reduce",
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}),
  });
  await context.addInitScript(() => {
    const audit: Audit = { workers: [], budgets: [] };
    (window as AuditedWindow).__fieldworkVerification = audit;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      record: WorkerRecord;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.record = { messages: [], terminated: false };
        audit.workers.push(this.record);
        this.addEventListener("message", (event) =>
          this.record.messages.push(event.data),
        );
      }
      postMessage(message: any, transfer?: any) {
        this.record.request = {
          revision: message.revision,
          mode: message.mode,
        };
        super.postMessage(message, transfer);
      }
      terminate() {
        this.record.terminated = true;
        super.terminate();
      }
    };
    const nativeTimeout = window.setTimeout;
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: any[]
    ) => {
      if (delay === 30000) audit.budgets.push(delay);
      return nativeTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout;
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(15000);
  page.on("pageerror", (error) =>
    browserErrors.push(`pageerror: ${error.stack ?? error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      browserErrors.push(`console.${message.type()}: ${message.text()}`);
  });
  await page.goto(baseURL!);
  await expect(page.getByTestId("schematic")).toBeVisible();
  return page;
}

async function scenario(
  name: string,
  test: (page: Page) => Promise<string | void>,
  mobile = false,
) {
  const started = Date.now();
  let page: Page | undefined;
  try {
    page = await newPage(mobile);
    const detail = await test(page);
    outcomes.push({
      name,
      status: "PASS",
      ms: Date.now() - started,
      ...(detail ? { detail } : {}),
    });
    console.log(
      `PASS ${name} (${Date.now() - started} ms)${detail ? `: ${detail}` : ""}`,
    );
  } catch (error) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    failures.push(`${name}: ${detail}`);
    outcomes.push({ name, status: "FAIL", ms: Date.now() - started, detail });
    console.error(`FAIL ${name}: ${detail}`);
    if (page)
      await page
        .screenshot({
          path: `${output}/fieldwork-failure-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`,
          fullPage: true,
          timeout: 5000,
        })
        .catch((error) => console.error(`Failure screenshot: ${error}`));
  } finally {
    await page?.context().close();
  }
}

async function worldPoint(page: Page, x: number, y: number) {
  const result = await page.getByTestId("schematic").evaluate(
    (element, point) => {
      const svg = element as SVGSVGElement;
      const box = svg.getBoundingClientRect(),
        view = svg.viewBox.baseVal;
      return {
        x: box.left + ((point.x - view.x) / view.width) * box.width,
        y: box.top + ((point.y - view.y) / view.height) * box.height,
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      };
    },
    { x, y },
  );
  assert(
    result.x > result.left &&
      result.x < result.right &&
      result.y > result.top &&
      result.y < result.bottom,
    `World point ${x},${y} is outside the visible schematic: ${JSON.stringify(result)}`,
  );
  return result;
}

async function clickWorld(page: Page, x: number, y: number) {
  const point = await worldPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function selectComponent(page: Page, id: string) {
  await page.keyboard.press("Escape");
  await page.getByTestId(`pin-${id}-0`).click();
  await expect(page.locator(".part-summary h2")).toHaveText(id);
}

async function exportProject(page: Page): Promise<CircuitDocument> {
  const download = page.waitForEvent("download", { timeout: 5000 });
  await page.getByTitle("Export editable project (Ctrl+S)").click();
  const file = await download;
  assert.match(file.suggestedFilename(), /\.circuit\.json$/);
  const path = `${output}/fieldwork-project-${++downloadSequence}.circuit.json`;
  await file.saveAs(path);
  assert.equal(await file.failure(), null);
  return JSON.parse(await readFile(path, "utf8"));
}

async function importProject(page: Page, doc: CircuitDocument) {
  await page.getByTestId("project-import").setInputFiles({
    name: "verification.circuit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page.locator(".status-message")).toHaveText(
    "Project imported and validated. Ready to edit and solve.",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Project title")).toHaveValue(doc.title);
}

function baseDivider() {
  assert(
    divider,
    "Dependency failed: the divider must first be constructed through real palette/pin interactions.",
  );
  return structuredClone(divider);
}

async function latestResult(page: Page): Promise<WorkerResult> {
  const records = await page.evaluate(
    () => (window as AuditedWindow).__fieldworkVerification.workers,
  );
  const record = records.at(-1);
  const result = record?.messages.find((message) => message.type === "result");
  assert(
    result?.type === "result",
    "The latest native worker did not produce a successful result.",
  );
  assert.equal(result.revision, record!.request!.revision);
  return result;
}

async function run(page: Page, mode: "dc" | "transient") {
  await page.getByLabel("Analysis type", { exact: true }).selectOption(mode);
  const count = await page.evaluate(
    () => (window as AuditedWindow).__fieldworkVerification.workers.length,
  );
  await page.getByTitle("Run analysis", { exact: true }).click();
  await expect(page.locator(".status-message")).toContainText(
    /computed in|Analysis failed|compute budget|worker failed/,
    { timeout: 15000 },
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  assert.equal(
    await page.evaluate(
      () => (window as AuditedWindow).__fieldworkVerification.workers.length,
    ),
    count + 1,
  );
  const result = await latestResult(page);
  assert.equal(result.mode, mode);
  if (mode === "transient")
    await expect(page.getByTestId("scope-status")).toHaveText("Captured");
  return result;
}

function close(
  actual: number,
  expected: number,
  tolerance: number,
  message: string,
) {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} +/- ${tolerance}, received ${actual}`,
  );
}

function engineering(text: string) {
  const match =
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([pnumkMG]?)\s*([VA]|s)$/.exec(
      text.trim(),
    );
  assert(match, `Unexpected measurement: ${text}`);
  return (
    Number(match[1]) *
    { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, "": 1, k: 1e3, M: 1e6, G: 1e9 }[
      match[2]
    ]!
  );
}

async function assertDC(
  page: Page,
  expectedVoltage = 5,
  expectedR1 = 0.005,
  expectedR2 = expectedR1,
) {
  const result = await run(page, "dc");
  const solution = result.result as Solution;
  const node = result.netlist.endpointNets["R2:0"];
  const net = result.netlist.nets.find((net) => net.id === node)!;
  close(
    engineering(
      await page.getByTestId(`reading-${net.name}`).locator("code").innerText(),
    ),
    expectedVoltage,
    0.0006,
    "Displayed divider output",
  );
  for (const [id, current] of [
    ["R1", expectedR1],
    ["R2", expectedR2],
  ] as const) {
    const row = page.locator(".readings-table > div").filter({
      has: page.locator("span", { hasText: new RegExp(`^${id}$`) }),
    });
    close(
      engineering(await row.locator("code").innerText()),
      current,
      0.0000006,
      `Displayed ${id} current`,
    );
    close(solution.currents[id], current, 1e-10, `Native worker ${id} current`);
  }
  close(
    solution.voltages[node],
    expectedVoltage,
    1e-9,
    "Native worker divider output",
  );
  return result;
}

function key(endpoint: Endpoint) {
  return endpoint.kind === "pin"
    ? `${endpoint.componentId}:${endpoint.pin}`
    : `j:${endpoint.junctionId}`;
}

function validReferences(doc: CircuitDocument) {
  const ids = new Set(
    [
      ...doc.components,
      ...doc.wires,
      ...doc.junctions,
      ...doc.labels,
      ...doc.probes,
    ].map((item) => item.id),
  );
  assert.equal(
    ids.size,
    doc.components.length +
      doc.wires.length +
      doc.junctions.length +
      doc.labels.length +
      doc.probes.length,
    "Duplicate document IDs",
  );
  const endpoint = (anchor: Endpoint) => {
    if (anchor.kind === "junction")
      assert(
        doc.junctions.some((item) => item.id === anchor.junctionId),
        `Dangling junction ${key(anchor)}`,
      );
    else {
      const part = doc.components.find(
        (item) => item.id === anchor.componentId,
      );
      assert(
        part &&
          (anchor.pin === 0 || (anchor.pin === 1 && part.type !== "ground")),
        `Dangling pin ${key(anchor)}`,
      );
    }
  };
  doc.wires.forEach((wire) => {
    endpoint(wire.a);
    endpoint(wire.b);
  });
  doc.labels.forEach((label) => endpoint(label.anchor));
  doc.probes.forEach((probe) => {
    if (probe.kind === "voltage") endpoint(probe.anchor);
    else
      assert(
        doc.components.some(
          (part) => part.id === probe.componentId && part.type !== "ground",
        ),
      );
  });
}

async function exportCSV(
  page: Page,
  doc: CircuitDocument,
  capture: WorkerResult,
) {
  assert.equal(capture.mode, "transient");
  const pending = page.waitForEvent("download", { timeout: 5000 });
  await page.getByTestId("scope-export").click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), "fieldwork-waveforms.csv");
  const path = `${output}/fieldwork-waveforms-${++downloadSequence}.csv`;
  await download.saveAs(path);
  assert.equal(await download.failure(), null);
  const lines = (await readFile(path, "utf8")).trim().split(/\r?\n/);
  assert.equal(
    lines[0],
    [
      "time [s]",
      ...doc.probes.map(
        (probe) => `${probe.name} [${probe.kind === "voltage" ? "V" : "A"}]`,
      ),
    ]
      .map((value) => `"${value.replaceAll('"', '""')}"`)
      .join(","),
  );
  const rows = lines.slice(1).map((line) => line.split(",").map(Number));
  const samples = (capture.result as TransientResult).samples;
  assert.equal(
    rows.length,
    samples.length,
    "CSV must contain every original sample, not display-downsampled data",
  );
  for (const [index, row] of rows.entries()) {
    assert.equal(row.length, doc.probes.length + 1);
    const sample = samples[index];
    assert.equal(row[0], sample.time);
    for (const [channel, probe] of doc.probes.entries()) {
      const value =
        probe.kind === "voltage"
          ? sample.voltages[capture.netlist.endpointNets[key(probe.anchor)]]
          : sample.currents[probe.componentId];
      assert(
        Number.isFinite(row[channel + 1]),
        `Nonfinite CSV row ${index}, channel ${channel}`,
      );
      assert.equal(
        row[channel + 1],
        value,
        `CSV differs from original worker sample ${index}, channel ${channel}`,
      );
    }
  }
  return rows;
}

async function assertOriginalPaths(
  page: Page,
  doc: CircuitDocument,
  capture: WorkerResult,
) {
  const samples = (capture.result as TransientResult).samples;
  const plot = page.getByTestId("scope-plot");
  const start = Number(await plot.getAttribute("data-view-start")),
    end = Number(await plot.getAttribute("data-view-end"));
  const rectangle = await plot
    .locator("clipPath rect")
    .evaluate((element) =>
      Object.fromEntries(
        ["x", "y", "width", "height"].map((name) => [
          name,
          Number(element.getAttribute(name)),
        ]),
      ),
    );
  for (const probe of doc.probes) {
    const ticks = await page
      .getByTestId(`scope-axis-${probe.kind}`)
      .locator("g")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.querySelector("text")!.textContent!,
          y: Number(element.querySelector("line")!.getAttribute("y1")),
        })),
      );
    assert(ticks.length >= 2, `${probe.name}: calibrated axis ticks missing`);
    const low = ticks[0],
      high = ticks.at(-1)!;
    const lowValue = engineering(low.text),
      highValue = engineering(high.text);
    const expected = samples.map((sample) => {
      const value =
        probe.kind === "voltage"
          ? sample.voltages[capture.netlist.endpointNets[key(probe.anchor)]]
          : sample.currents[probe.componentId];
      return {
        x:
          rectangle.x +
          ((sample.time - start) / (end - start)) * rectangle.width,
        y:
          low.y +
          ((value - lowValue) / (highValue - lowValue)) * (high.y - low.y),
      };
    });
    const path = await page
      .getByTestId(`scope-trace-${probe.id}`)
      .getAttribute("d");
    assert(
      path && /^M/.test(path) && !/NaN|Infinity|[CQSTAHV]/.test(path),
      `${probe.name}: missing, nonfinite, or interpolated trace`,
    );
    const vertices = [
      ...path.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g),
    ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
    assert(vertices.length >= 2);
    for (const vertex of vertices)
      assert(
        expected.some(
          (point) =>
            Math.abs(point.x - vertex.x) <= 0.011 &&
            Math.abs(point.y - vertex.y) <= 0.011,
        ),
        `${probe.name}: rendered vertex ${JSON.stringify(vertex)} is not an original worker sample`,
      );
    close(
      vertices[0].x,
      expected[0].x,
      0.011,
      `${probe.name}: first original sample`,
    );
    close(
      vertices.at(-1)!.x,
      expected.at(-1)!.x,
      0.011,
      `${probe.name}: final original sample`,
    );
  }
}

async function visibleControl(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(
    box &&
      box.width > 0 &&
      box.height > 0 &&
      box.x >= -1 &&
      box.x + box.width <= page.viewportSize()!.width + 1,
    `Control extends beyond viewport: ${await locator.evaluate((element) => element.outerHTML)}`,
  );
}

try {
  await mkdir(output, { recursive: true });
  assert(
    (await stat(output)).isDirectory(),
    "Approved screenshot/download directory must exist.",
  );
  await startServer();
  let executablePath: string | undefined;
  try {
    await access("/usr/bin/chromium");
    executablePath = "/usr/bin/chromium";
  } catch {
    /* Use Playwright's installed Chromium. */
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    ...(executablePath ? { executablePath } : {}),
    timeout: 15000,
  });
  console.log(
    `Headless Chromium ${browser.version()} at ${baseURL}; ${server ? "owned Vite server" : "external BASE_URL"}`,
  );

  await scenario(
    "Construct divider from New, wire pins, add probes, solve and export",
    async (page) => {
      await page.getByTitle("New empty project").click();
      await expect(page.locator('[data-testid^="component-"]')).toHaveCount(0);
      for (const part of [
        { type: "voltage", id: "V1", x: 160, y: 240, rotate: true },
        { type: "resistor", id: "R1", x: 320, y: 140 },
        { type: "resistor", id: "R2", x: 480, y: 240, rotate: true },
        { type: "ground", id: "G1", x: 160, y: 360 },
      ]) {
        await page.getByTestId(`palette-${part.type}`).click();
        await clickWorld(page, part.x, part.y);
        await expect(page.getByTestId(`component-${part.id}`)).toBeVisible();
        if (part.rotate) await page.keyboard.press("r");
      }
      await selectComponent(page, "V1");
      await page.getByLabel("DC value", { exact: true }).fill("10");
      await page.getByRole("button", { name: "Apply component" }).click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("w");
      const wires = [
        { a: "V1-0", b: "R1-0", bends: [[160, 140]] },
        { a: "R1-1", b: "R2-0", bends: [[480, 140]] },
        { a: "R2-1", b: "G1-0", bends: [[480, 360]] },
        { a: "V1-1", b: "G1-0", bends: [] },
      ];
      for (const [index, wire] of wires.entries()) {
        await page.getByTestId(`pin-${wire.a}`).click();
        for (const [x, y] of wire.bends) await clickWorld(page, x, y);
        await page.getByTestId(`pin-${wire.b}`).click();
        const line = page
          .getByTestId(`wire-W${index + 1}`)
          .locator(".wire-line");
        await expect(line).toHaveCount(1);
        // Straight SVG lines have zero-width/height boxes but a visible stroke.
        const geometry = await line.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            length: (element as SVGPolylineElement).getTotalLength(),
            stroke: style.stroke,
            width: Number.parseFloat(style.strokeWidth),
            display: style.display,
            visibility: style.visibility,
            opacity: Number(style.opacity),
          };
        });
        assert(
          geometry.length > 0 &&
            geometry.stroke !== "none" &&
            geometry.width > 0 &&
            geometry.display !== "none" &&
            geometry.visibility === "visible" &&
            geometry.opacity > 0,
          `Wire is not rendered: ${JSON.stringify(geometry)}`,
        );
      }
      await page.keyboard.press("Escape");
      await assertDC(page);
      await page.keyboard.press("p");
      await page.getByTestId("pin-R2-0").click();
      await page.keyboard.press("i");
      await page.getByTestId("component-R1").locator(".component").click();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("scope-channel-P1")).toBeVisible();
      await expect(page.getByTestId("scope-channel-P2")).toBeVisible();
      const doc = await exportProject(page);
      assert.equal(
        doc.labels.length,
        0,
        "Construction must not rely on example net names",
      );
      assert.deepEqual(
        doc.components.map((part) => [part.id, part.x, part.y, part.rotation]),
        [
          ["V1", 160, 240, 90],
          ["R1", 320, 140, 0],
          ["R2", 480, 240, 90],
          ["G1", 160, 360, 0],
        ],
      );
      assert.deepEqual(
        doc.wires.map((wire) => [key(wire.a), key(wire.b)]),
        [
          ["V1:0", "R1:0"],
          ["R1:1", "R2:0"],
          ["R2:1", "G1:0"],
          ["V1:1", "G1:0"],
        ],
      );
      assert.deepEqual(
        doc.probes.map((probe) =>
          probe.kind === "voltage" ? key(probe.anchor) : probe.componentId,
        ),
        ["R2:0", "R1"],
      );
      validReferences(doc);
      divider = doc;
      await assertDC(page);
      const result = await run(page, "transient");
      await assertOriginalPaths(page, doc, result);
      const rows = await exportCSV(page, doc, result);
      assert.equal(rows.length, 1001);
      rows.forEach((row) => {
        close(row[1], 5, 1e-9, "Divider transient voltage");
        close(row[2], 0.005, 1e-12, "Divider transient current");
      });
      await page.screenshot({
        path: `${output}/fieldwork-desktop.png`,
        fullPage: true,
        timeout: 5000,
      });
      await page.setViewportSize({ width: 1366, height: 768 });
      await expect
        .poll(async () => {
          const scope = await page.locator(".scope-region").boundingBox();
          const footer = await page.locator(".statusbar").boundingBox();
          return !!scope && !!footer && scope.y + scope.height <= footer.y + 1;
        })
        .toBe(true);
      return `4 placed parts, 4 pin-reference wires; 5 V and 5 mA; ${rows.length} original samples and exact CSV values`;
    },
  );

  await scenario(
    "Edit 1k to 2k, stale capture, undo and redo numerical reruns",
    async (page) => {
      const doc = baseDivider();
      await importProject(page, doc);
      await run(page, "transient");
      await selectComponent(page, "R1");
      await page.getByLabel("Resistance", { exact: true }).fill("2k");
      await page.getByRole("button", { name: "Apply component" }).click();
      await expect(page.getByTestId("scope-status")).toHaveText(
        "Stale results",
      );
      await expect(page.getByTestId("scope-export")).toBeDisabled();
      await page.getByRole("tab", { name: "Readings", exact: true }).click();
      await expect(page.locator(".inspector-content")).toContainText(
        "NO CAPTURE",
      );
      await expect(page.locator(".readings-table")).toHaveCount(0);
      await assertDC(page, 10 / 3, 10 / 3000);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(
        (await exportProject(page)).components.find((part) => part.id === "R1")!
          .value,
        1000,
      );
      await assertDC(page);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.equal(
        (await exportProject(page)).components.find((part) => part.id === "R1")!
          .value,
        2000,
      );
      await assertDC(page, 10 / 3, 10 / 3000);
      return "3.333 V / 3.333 mA after edit and redo, 5 V / 5 mA after undo; stale readings hidden and CSV disabled";
    },
  );

  await scenario(
    "Completed drag is one undo, rotation preserves explicit endpoints",
    async (page) => {
      const original = baseDivider();
      await importProject(page, original);
      const component = original.components.find((part) => part.id === "R1")!;
      await selectComponent(page, "R1");
      const before = await exportProject(page);
      const start = await worldPoint(page, component.x, component.y),
        end = await worldPoint(page, component.x + 60, component.y + 60);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 12 });
      await page.mouse.up();
      const moved = await exportProject(page);
      assert.deepEqual(
        moved.components.find((part) => part.id === "R1"),
        { ...component, x: component.x + 60, y: component.y + 60 },
      );
      assert.deepEqual(moved.wires, before.wires);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(
        await exportProject(page),
        before,
        "One undo must restore the whole completed drag",
      );
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual(await exportProject(page), moved);
      await selectComponent(page, "R1");
      const oldPins = await page
        .getByTestId("pin-R1-0")
        .locator("circle")
        .first()
        .getAttribute("cx");
      await page.keyboard.press("r");
      const rotated = await exportProject(page);
      assert.equal(
        rotated.components.find((part) => part.id === "R1")!.rotation,
        90,
      );
      assert.deepEqual(rotated.wires, moved.wires);
      assert.deepEqual(rotated.probes, moved.probes);
      assert.notEqual(
        await page
          .getByTestId("pin-R1-0")
          .locator("circle")
          .first()
          .getAttribute("cx"),
        oldPins,
      );
      validReferences(rotated);
      await assertDC(page);
      return "12-move drag commits one history entry; rotation changes geometry without changing wires/probes or 5 V / 5 mA solution";
    },
  );

  await scenario(
    "Duplicate and delete clean dependent references",
    async (page) => {
      await importProject(page, baseDivider());
      const before = await exportProject(page);
      await selectComponent(page, "R1");
      await page.keyboard.press("Control+d");
      await expect(page.getByTestId("component-R3")).toBeVisible();
      let doc = await exportProject(page);
      assert.deepEqual(doc.wires, before.wires);
      assert.deepEqual(doc.probes, before.probes);
      assert.equal(
        doc.components.find((part) => part.id === "R3")!.x,
        before.components.find((part) => part.id === "R1")!.x + 60,
      );
      await page.keyboard.press("Delete");
      assert.deepEqual(
        await exportProject(page),
        before,
        "Deleting the unconnected copy must leave the original document unchanged",
      );
      await selectComponent(page, "R2");
      await page.keyboard.press("Delete");
      doc = await exportProject(page);
      validReferences(doc);
      assert(!doc.components.some((part) => part.id === "R2"));
      assert.equal(doc.wires.length, before.wires.length - 2);
      assert.equal(doc.probes.length, before.probes.length - 1);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await exportProject(page), before);
      await assertDC(page);
      return "Copy has unique R3 ID and no inherited wiring; deleting connected R2 removes both wires and its voltage probe; undo restores all";
    },
  );

  await scenario(
    "JSON export, New, upload import and equivalent solve",
    async (page) => {
      await importProject(page, baseDivider());
      const before = await exportProject(page);
      const expected = await assertDC(page);
      await page.getByTitle("New empty project").click();
      await expect(page.locator('[data-testid^="component-"]')).toHaveCount(0);
      await importProject(page, before);
      assert.deepEqual(await exportProject(page), before);
      const actual = await assertDC(page);
      assert.deepEqual(actual.netlist, expected.netlist);
      assert.deepEqual(actual.result, expected.result);
      return "Version-1 exported JSON reimports through the file input with identical document, netlist, voltages and currents";
    },
  );

  await scenario(
    "Inspector wire reconnection changes analytical DC",
    async (page) => {
      await importProject(page, baseDivider());
      await assertDC(page);
      await page.keyboard.press("Escape");
      const point = await worldPoint(page, 420, 140);
      await page.mouse.click(point.x, point.y);
      await expect(page.locator(".entity-title")).toHaveText("Wire W2");
      await expect(page.getByLabel("Endpoint A", { exact: true })).toHaveValue(
        "R1:1",
      );
      await expect(page.getByLabel("Endpoint B", { exact: true })).toHaveValue(
        "R2:0",
      );
      await page.getByLabel("Endpoint A", { exact: true }).selectOption("R1:0");
      await page.getByRole("button", { name: "Reconnect wire" }).click();
      const doc = await exportProject(page);
      assert.equal(key(doc.wires.find((wire) => wire.id === "W2")!.a), "R1:0");
      assert.equal(key(doc.wires.find((wire) => wire.id === "W2")!.b), "R2:0");
      validReferences(doc);
      await assertDC(page, 10, 0, 0.01);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await assertDC(page);
      return "Reconnect W2 A from R1:1 to R1:0 gives 10 V output, 0 A in R1 and 10 mA in R2; undo restores divider";
    },
  );

  await scenario(
    "Invalid import and component field preserve document",
    async (page) => {
      await importProject(page, baseDivider());
      await assertDC(page);
      const before = await exportProject(page);
      const revision = await page.locator(".revision-label").innerText();
      const invalid = structuredClone(before);
      invalid.wires[0].a = { kind: "pin", componentId: "MISSING", pin: 0 };
      await page.getByTestId("project-import").setInputFiles({
        name: "invalid.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(invalid)),
      });
      await expect(page.getByRole("alert")).toContainText(
        "Import rejected; current project unchanged.",
      );
      assert.deepEqual(await exportProject(page), before);
      await expect(page.locator(".revision-label")).toHaveText(revision);
      await page.getByRole("button", { name: "Dismiss error" }).click();
      await selectComponent(page, "R1");
      await page.getByLabel("Resistance", { exact: true }).fill("-1k");
      await page.getByRole("button", { name: "Apply component" }).click();
      await expect(page.getByRole("alert")).toContainText("must be positive");
      assert.deepEqual(await exportProject(page), before);
      await expect(page.locator(".revision-label")).toHaveText(revision);
      await page.getByRole("button", { name: "Dismiss error" }).click();
      await page.getByLabel("Resistance", { exact: true }).fill("2uF");
      await page.getByRole("button", { name: "Apply component" }).click();
      await expect(page.getByRole("alert")).toContainText(
        "Expected ohm, not F",
      );
      assert.deepEqual(await exportProject(page), before);
      await page.getByRole("button", { name: "Dismiss error" }).click();
      await assertDC(page);
      return "Dangling-pin JSON, negative resistance, and mismatched F/ohm units rejected with identical exported document and revision; rerun succeeds";
    },
  );

  await scenario(
    "Explicit junction tool changes crossing topology and netlist highlighting",
    async (page) => {
      await page
        .getByRole("button", { name: "Example circuits", exact: true })
        .click();
      await page.getByTestId("example-divider").click();
      const before = await exportProject(page);
      await assertDC(page);
      await page
        .getByRole("button", { name: "Inspect shared netlist" })
        .click();
      const compiled = JSON.parse(
        await page.getByTestId("netlist-code").innerText(),
      ) as Netlist;
      assert.notEqual(compiled.endpointNets["j:JVIN"], compiled.ground);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /VOUT.*pins/ })
        .click();
      await expect(page.locator(".wire.highlighted")).toHaveCount(4);
      await page.keyboard.press("j");
      await clickWorld(page, 460, 400);
      const joined = await exportProject(page);
      assert.equal(joined.wires.length, before.wires.length + 2);
      const added = joined.junctions.find(
        (j) => !before.junctions.some((old) => old.id === j.id),
      )!;
      assert(added && added.x === 460 && added.y === 400);
      assert.equal(
        joined.wires.filter(
          (w) => key(w.a) === `j:${added.id}` || key(w.b) === `j:${added.id}`,
        ).length,
        4,
      );
      await page.getByTitle("Run analysis", { exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(
        /source|constraint|voltage/i,
      );
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await exportProject(page), before);
      await assertDC(page);
      return "J splits both crossing routes into four endpoint references; joining VIN to GND diagnoses source conflict; one undo restores 5 V / 5 mA. Netlist VOUT highlighting traces only its four explicitly joined wires.";
    },
  );

  await scenario(
    "Reset reproduces explicit initial state and settings undo restores initialization mode",
    async (page) => {
      await page
        .getByRole("button", { name: "Example circuits", exact: true })
        .click();
      await page.getByTestId("example-rc").click();
      const initial = await run(page, "transient");
      const expected = (initial.result as TransientResult).samples;
      const node = initial.netlist.endpointNets["C1:0"];
      assert.equal(expected[0].voltages[node], 0);
      await page.getByRole("button", { name: "Reset simulation" }).click();
      await expect(page.getByTestId("scope-empty")).toBeVisible();
      const repeated = await run(page, "transient");
      assert.deepEqual((repeated.result as TransientResult).samples, expected);
      await page.getByRole("tab", { name: "Analysis", exact: true }).click();
      await page
        .getByLabel("Initialization", { exact: true })
        .selectOption("dc");
      await page.getByRole("button", { name: "Apply settings" }).click();
      const steady = (await run(page, "transient")).result as TransientResult;
      steady.samples.forEach((sample) =>
        close(
          sample.voltages[node],
          5,
          1e-9,
          "Operating-point initialization is steady at 5 V",
        ),
      );
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(
        (await exportProject(page)).settings.initialization,
        "explicit",
      );
      assert.deepEqual(
        ((await run(page, "transient")).result as TransientResult).samples,
        expected,
      );
      return "Reset rerun reproduces all 1,001 explicit-state samples exactly; operating-point initialization begins and remains at 5 V; one settings undo restores zero initial voltage.";
    },
  );

  await scenario(
    "Missing ground fails honestly and undo recovers without reload",
    async (page) => {
      await importProject(page, baseDivider());
      await run(page, "transient");
      const before = await exportProject(page);
      await selectComponent(page, "G1");
      await page.keyboard.press("Delete");
      const missingGround = await exportProject(page);
      await page
        .getByLabel("Analysis type", { exact: true })
        .selectOption("dc");
      await page.getByTitle("Run analysis", { exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(
        /Missing ground|ground component/i,
        { timeout: 15000 },
      );
      await expect(page.locator(".status-message")).toHaveText(
        "Analysis failed. The editable project is unchanged.",
      );
      await expect(page.getByTestId("scope-export")).toBeDisabled();
      await expect(page.locator('.scope-trace:not([d=""])')).toHaveCount(0);
      await expect(page.getByTestId("scope-empty")).toBeVisible();
      assert.deepEqual(await exportProject(page), missingGround);
      const audit = await page.evaluate(
        () => (window as AuditedWindow).__fieldworkVerification,
      );
      assert(
        audit.workers
          .at(-1)!
          .messages.some((message) => message.type === "error"),
      );
      assert(
        !audit.workers
          .at(-1)!
          .messages.some((message) => message.type === "result"),
      );
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await exportProject(page), before);
      await assertDC(page);
      return "Native worker returns missing-ground error, no fabricated capture/CSV; one undo and rerun recover on the same page";
    },
  );

  await scenario(
    "RC transient analytical curve, original paths, CSV and scope controls",
    async (page) => {
      await page
        .getByRole("button", { name: "Example circuits", exact: true })
        .click();
      await page.getByTestId("example-rc").click();
      const doc = await exportProject(page);
      const capture = await run(page, "transient");
      const rows = await exportCSV(page, doc, capture);
      assert.equal(rows.length, 1001);
      let maximumVoltageError = 0;
      for (const row of rows) {
        close(row[1], 5, 1e-9, "RC input voltage");
        const expected = 5 * (1 - Math.exp(-row[0] / 0.001));
        maximumVoltageError = Math.max(
          maximumVoltageError,
          Math.abs(row[2] - expected),
        );
        close(row[2], expected, 0.00002, `RC capacitor voltage at ${row[0]} s`);
        close(
          row[3],
          0.005 * Math.exp(-row[0] / 0.001),
          0.00000002,
          `RC capacitor current at ${row[0]} s`,
        );
      }
      close(rows[0][2], 0, 1e-12, "Explicit capacitor initial state");
      close(rows.at(-1)![0], 0.005, 1e-12, "RC final time");
      await assertOriginalPaths(page, doc, capture);
      await page.getByTestId("scope-channel-PVC").click();
      await expect(page.getByTestId("scope-channel-PVC")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(page.getByTestId("scope-trace-PVC")).toHaveCount(0);
      await expect(page.getByTestId("scope-stats-PVC")).toBeVisible();
      assert.deepEqual(
        await exportCSV(page, doc, capture),
        rows,
        "Hidden channels must remain in full-resolution CSV",
      );
      await page.getByTestId("scope-channel-PVC").click();
      await expect(page.getByTestId("scope-trace-PVC")).toHaveCount(1);
      await page.getByTestId("scope-time-A").fill("0.001");
      await page.getByTestId("scope-time-A").press("Enter");
      await page.getByTestId("scope-time-B").fill("0.002");
      await page.getByTestId("scope-time-B").press("Enter");
      const a = Number(await page.getByTestId("scope-time-A").inputValue()),
        b = Number(await page.getByTestId("scope-time-B").inputValue());
      assert(
        rows.some((row) => row[0] === a) && rows.some((row) => row[0] === b),
        "Cursors must snap to original samples",
      );
      close(
        engineering(await page.getByTestId("scope-delta-time").innerText()),
        0.001,
        1e-8,
        "Cursor interval",
      );
      const cursorVoltage = Number(
        (await page
          .getByTestId("scope-stats-PVC")
          .locator('[data-stat="cursor-a"]')
          .getAttribute("title"))!.split(" ")[0],
      );
      assert.equal(cursorVoltage, rows.find((row) => row[0] === a)![2]);
      const plot = page.getByTestId("scope-plot");
      const span = async () =>
        Number(await plot.getAttribute("data-view-end")) -
        Number(await plot.getAttribute("data-view-start"));
      const fullSpan = await span();
      await page.getByTestId("scope-zoom-in").click();
      close(await span(), fullSpan / 2, 1e-12, "Time zoom");
      const previousStart = Number(await plot.getAttribute("data-view-start"));
      await page.getByTestId("scope-pan-right").click();
      assert(
        Number(await plot.getAttribute("data-view-start")) > previousStart,
      );
      await page.getByTestId("scope-fit").click();
      close(await span(), fullSpan, 1e-12, "Fit full range");
      await page.getByTestId("scope-cursor-A").focus();
      await page.keyboard.press("ArrowRight");
      const next = Number(await page.getByTestId("scope-time-A").inputValue());
      assert.equal(next, rows[rows.findIndex((row) => row[0] === a) + 1][0]);
      const plotBox = await plot.boundingBox();
      assert(plotBox);
      await page.mouse.move(
        plotBox.x + plotBox.width * 0.55,
        plotBox.y + plotBox.height * 0.5,
      );
      await page.mouse.wheel(0, -120);
      await expect.poll(span).toBeLessThan(fullSpan);
      await page.getByTestId("scope-fit").click();
      await page.screenshot({
        path: `${output}/fieldwork-rc-transient.png`,
        fullPage: true,
        timeout: 5000,
      });
      return `${rows.length} samples; final VC=${rows.at(-1)![2]} V; maximum analytic voltage error=${maximumVoltageError} V; channel/cursor/zoom/pan/fit verified`;
    },
  );

  await scenario(
    "Cancel real heavy worker, edit while running, no mixed revision",
    async (page) => {
      const simple = baseDivider();
      const heavy = structuredClone(simple);
      heavy.title = "100000-step cancellation verification";
      heavy.settings = { ...heavy.settings, duration: 1, timestep: 0.00001 };
      await importProject(page, heavy);
      await page
        .getByLabel("Analysis type", { exact: true })
        .selectOption("transient");
      await page.getByTitle("Run analysis", { exact: true }).click();
      await expect(
        page.getByTitle("Stop analysis", { exact: true }),
      ).toBeVisible();
      await page.waitForFunction(
        () =>
          (window as AuditedWindow).__fieldworkVerification.workers
            .at(-1)
            ?.messages.some(
              (message) =>
                message.type === "progress" &&
                message.fraction > 0 &&
                message.fraction < 1,
            ),
        undefined,
        { timeout: 5000, polling: 10 },
      );
      await page.getByTitle("Stop analysis", { exact: true }).click();
      await expect(page.locator(".status-message")).toHaveText(
        "Analysis cancelled. No partial capture retained.",
      );
      await expect(page.getByTestId("scope-export")).toBeDisabled();
      await expect(page.locator('.scope-trace:not([d=""])')).toHaveCount(0);
      await expect(page.getByTestId("scope-empty")).toBeVisible();
      let audit = await page.evaluate(
        () => (window as AuditedWindow).__fieldworkVerification,
      );
      assert.equal(audit.workers.length, 1);
      assert(
        audit.workers[0].terminated,
        "Stop must terminate the actual native worker",
      );
      assert(
        !audit.workers[0].messages.some((message) => message.type === "result"),
        "Cancellation fixture completed before Stop; this does not prove cancellation",
      );
      assert.deepEqual(
        audit.budgets,
        [30000],
        "Run must configure its actual 30-second compute budget",
      );
      await page.getByTitle("Run analysis", { exact: true }).click();
      await expect(
        page.getByTitle("Stop analysis", { exact: true }),
      ).toBeVisible();
      await page.waitForFunction(
        () =>
          (window as AuditedWindow).__fieldworkVerification.workers
            .at(-1)
            ?.messages.some(
              (message) =>
                message.type === "progress" &&
                message.fraction > 0 &&
                message.fraction < 1,
            ),
        undefined,
        { timeout: 5000, polling: 10 },
      );
      await page.getByTitle("New empty project").click();
      await expect(
        page.getByTitle("Run analysis", { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("scope-export")).toBeDisabled();
      await importProject(page, simple);
      await assertDC(page);
      const capture = await run(page, "transient");
      assert.equal((capture.result as TransientResult).samples.length, 1001);
      const rows = await exportCSV(page, simple, capture);
      await page.waitForTimeout(300);
      audit = await page.evaluate(
        () => (window as AuditedWindow).__fieldworkVerification,
      );
      assert.equal(audit.workers.length, 4);
      assert(
        audit.workers[1].terminated,
        "Editing during Run must terminate the obsolete native worker",
      );
      assert(
        !audit.workers[1].messages.some((message) => message.type === "result"),
        "Revision-change fixture completed before edit; cancellation was not exercised",
      );
      assert(audit.workers[1].request!.revision < capture.revision);
      await expect(page.getByTestId("scope-status")).toHaveText("Captured");
      assert.deepEqual(await exportCSV(page, simple, capture), rows);
      return "Both 100,000-step workers terminated without result; DC and 1,001-sample transient rerun use current revision. Actual 30,000 ms timer observed; full expiry not awaited.";
    },
  );

  await scenario(
    "Mobile 390x844, panels, controls and no horizontal overflow",
    async (page) => {
      const overflow = async () =>
        page.evaluate(() => ({
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
      const assertNoOverflow = async () => {
        const widths = await overflow();
        assert(
          widths.document <= 390 &&
            widths.body <= 390 &&
            widths.viewport === 390,
          `Mobile page horizontal overflow: ${JSON.stringify(widths)}`,
        );
      };
      await assertNoOverflow();
      await visibleControl(
        page.getByLabel("Analysis type", { exact: true }),
        page,
      );
      await visibleControl(
        page.getByTitle("Run analysis", { exact: true }),
        page,
      );
      await page
        .locator(".mobile-navigation")
        .getByRole("button", { name: "Components", exact: true })
        .click();
      await expect(page.locator(".library")).toBeVisible();
      await visibleControl(page.getByTestId("palette-resistor"), page);
      await visibleControl(page.getByTestId("palette-ground"), page);
      await assertNoOverflow();
      await page
        .locator(".mobile-navigation")
        .getByRole("button", { name: "Inspector", exact: true })
        .click();
      await expect(page.locator(".inspector")).toBeVisible();
      await page.getByRole("tab", { name: "Analysis", exact: true }).click();
      await visibleControl(page.getByLabel("Duration", { exact: true }), page);
      await visibleControl(
        page.getByRole("button", { name: "Apply settings" }),
        page,
      );
      await assertNoOverflow();
      await page
        .locator(".mobile-navigation")
        .getByRole("button", { name: "Workbench", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Example circuits", exact: true })
        .click();
      await page.getByTestId("example-rc").click();
      const capture = await run(page, "transient");
      assert.equal((capture.result as TransientResult).samples.length, 1001);
      for (const id of [
        "scope-export",
        "scope-channel-PVC",
        "scope-zoom-in",
        "scope-fit",
        "scope-time-A",
        "scope-time-B",
      ])
        await visibleControl(page.getByTestId(id), page);
      await assertNoOverflow();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${output}/fieldwork-mobile.png`,
        fullPage: true,
        timeout: 5000,
      });
      return `390x844 touch viewport; library/inspector/workbench usable, live RC capture, controls within horizontal bounds; widths ${JSON.stringify(await overflow())}`;
    },
    true,
  );

  if (browserErrors.length) {
    failures.push(...browserErrors);
    console.error(`Browser console/page errors:\n${browserErrors.join("\n")}`);
  } else
    console.log(
      "PASS no browser console warnings/errors or pageerrors in any scenario",
    );
  console.log(
    JSON.stringify(
      {
        outcomes,
        browserErrors,
        passed: outcomes.filter((item) => item.status === "PASS").length,
        failed: outcomes.filter((item) => item.status === "FAIL").length,
        screenshots: [
          `${output}/fieldwork-desktop.png`,
          `${output}/fieldwork-mobile.png`,
          `${output}/fieldwork-rc-transient.png`,
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  await browser?.close();
  await stopServer();
}
if (failures.length) {
  console.error(
    `Browser verification failed with ${failures.length} issue(s).`,
  );
  process.exitCode = 1;
}
