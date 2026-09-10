/** Actual UI verification. Run: npx tsx tests/browser.ts
 * FORMA_URL uses an existing Vite server; otherwise a private random-port server
 * is started and stopped. No application functions perform document edits here.
 * FORMA_TEST optionally selects workflow names by regex; FORMA_REPORT overrides
 * the JSON artifact path. Filtered reports explicitly identify partial coverage.
 * Software rendering can make the complete suite take more than 20 minutes.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Browser, type Download, type Page } from '@playwright/test';
import type { Alignment, Building, City, Point } from '../src/core/model';
import type { Traffic } from '../src/core/traffic';
import type { CityScene } from '../src/scene';
import type { InstancedMesh, Mesh } from 'three';

type Forma = {
  city: City; traffic: Traffic; scene: CityScene; busy: boolean; paused: boolean;
  history: { undoStack: City[]; redoStack: City[] };
  timings: { generationTime: number; rebuildTime: number };
  project(x: number, z: number, y?: number): { x: number; y: number };
};
type FrameProbe = { intervals: number[]; start: number; stoppedAt: number; previous: number; done: boolean; stop: () => void };
declare global { interface Window { forma: Forma; formaFrameProbe?: FrameProbe; formaCommitFinished?: boolean } }

const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = '/tmp/opencode';
const reportPath = process.env.FORMA_REPORT || path.join(artifacts, 'forma-verification.json');
const results: { name: string; status: 'passed' | 'failed'; milliseconds: number; repro: string; measurements?: unknown; error?: string; screenshot?: string }[] = [];
const pageErrors: string[] = [], consoleErrors: string[] = [], blockedRequests: string[] = [];
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(), command: 'npx tsx tests/browser.ts',
  scope: process.env.FORMA_TEST ? { filter: process.env.FORMA_TEST, completeSuite: false } : { completeSuite: true },
  host: { platform: os.platform(), release: os.release(), architecture: os.arch(), cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, memoryBytes: os.totalmem() },
  results, pageErrors, consoleErrors, blockedRequests,
  methodology: 'All document edits are actual UI clicks, fills, drags, and file uploads. Model access is read-only except fixed 1/60 s traffic steps after a UI-created route. No app source edits or renderer quality reductions. Frame intervals are wall-clock rAF samples, not the smoothed UI FPS counter.',
};
let vite: ChildProcess | undefined, browser: Browser | undefined, page: Page | undefined;
let serverOutput = '';

async function startServer() {
  if (process.env.FORMA_URL) return process.env.FORMA_URL;
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const address = socket.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  // Other agents may edit source concurrently. HMR must not reset an in-flight UI workflow.
  const serverScript = `import { createServer } from 'vite'; const server = await createServer({ server: { host: '127.0.0.1', port: ${port}, strictPort: true, hmr: false } }); await server.listen();`;
  vite = spawn(process.execPath, ['--input-type=module', '-e', serverScript], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  vite.stdout?.on('data', chunk => { serverOutput = (serverOutput + String(chunk)).slice(-12_000); });
  vite.stderr?.on('data', chunk => { serverOutput = (serverOutput + String(chunk)).slice(-12_000); });
  let spawnError: Error | undefined;
  vite.on('error', error => { spawnError = error; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    if (spawnError) throw spawnError;
    if (vite.exitCode !== null) throw new Error(`Vite exited: ${serverOutput}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return url; } catch { /* Server is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not become ready: ${serverOutput}`);
}

async function stopServer() {
  if (!vite || vite.exitCode !== null || vite.signalCode !== null) return;
  const child = vite;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(timer);
}

async function workflow(name: string, repro: string, run: () => Promise<unknown>) {
  if (process.env.FORMA_TEST && !new RegExp(process.env.FORMA_TEST, 'i').test(name)) return;
  const start = performance.now();
  console.log(`RUN ${name}`);
  try {
    const measurements = await run();
    results.push({ name, status: 'passed', milliseconds: Math.round(performance.now() - start), repro, measurements });
    console.log(`PASS ${name} (${Math.round(performance.now() - start)} ms)`);
  } catch (error) {
    const screenshot = path.join(artifacts, `forma-failed-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    try { await page?.screenshot({ path: screenshot, timeout: 15_000 }); } catch { /* Preserve the original assertion if the renderer is unresponsive. */ }
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    results.push({ name, status: 'failed', milliseconds: Math.round(performance.now() - start), repro, error: message, screenshot });
    console.error(`FAIL ${name}\n${message}`);
    try { await page?.keyboard.press('Escape'); } catch { /* Later independent fixtures can still run. */ }
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}

const doc = (p: Page) => p.evaluate(() => structuredClone(window.forma.city));
const historySize = (p: Page) => p.evaluate(() => window.forma.history.undoStack.length);

async function ready(p: Page) {
  await p.waitForFunction(() => !!window.forma && !window.forma.busy, undefined, { timeout: 60_000 });
  await expect(p.locator('#canvas canvas')).toBeVisible();
  await p.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

async function commit(p: Page, action: () => Promise<unknown>) {
  const before = await historySize(p);
  await p.evaluate(() => {
    window.formaCommitFinished = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector('#busy')?.classList.contains('hidden')) { window.formaCommitFinished = true; observer.disconnect(); }
    });
    observer.observe(document.querySelector('#busy')!, { attributes: true, attributeFilter: ['class'] });
  });
  await action();
  await p.waitForFunction(() => window.formaCommitFinished && !window.forma.busy, undefined, { timeout: 40_000 });
  assert.equal(await historySize(p), before + 1, `Expected one committed UI transaction. Toast: ${await p.locator('#toast').textContent()}`);
}

async function pause(p: Page) {
  if (!(await p.evaluate(() => window.forma.paused))) await p.getByRole('button', { name: 'Pause traffic', exact: true }).click();
  assert.equal(await p.evaluate(() => window.forma.paused), true);
}

async function example(p: Page, name: 'empty' | 'riverfront') {
  await p.keyboard.press('Escape');
  await p.locator('[data-action="new"]').click();
  await commit(p, () => p.locator(`.modal [data-example="${name}"]`).click());
  await ready(p);
  if (await p.getByRole('button', { name: 'Dismiss tip' }).isVisible()) await p.getByRole('button', { name: 'Dismiss tip' }).click();
  await pause(p);
  assert.equal((await doc(p)).name, name === 'empty' ? 'Untitled City' : 'Riverfront');
}

async function canvasPoint(p: Page, x: number, z: number, y?: number) {
  const screen = await p.evaluate(({ x, z, y }) => window.forma.project(x, z, y), { x, z, y });
  const hit = await p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, screen);
  assert.equal(hit, 'CANVAS', `Projected (${x}, ${z}, ${y ?? 'terrain'}) is occluded by ${hit} at ${JSON.stringify(screen)}`);
  await p.mouse.click(screen.x, screen.y);
}

async function road(p: Page, points: [number, number][], options: { numeric?: boolean; level?: number } = {}) {
  await p.getByRole('button', { name: 'Roads tool', exact: true }).click();
  await p.locator('[data-profile="boulevard"]').click();
  await p.locator('#road-level').selectOption(String(options.level ?? 0));
  if (options.numeric) await p.locator('#precise-road summary').click();
  for (const [index, [x, z]] of points.entries()) {
    if (options.numeric) {
      await p.locator('#point-x').fill(String(x));
      await p.locator('#point-z').fill(String(z));
      await p.locator('[data-action="add-point"]').click();
    } else await canvasPoint(p, x, z);
    await expect(p.locator('#draft-count')).toHaveText(new RegExp(`^${index + 1} points`));
  }
  await commit(p, () => p.locator(options.numeric ? '#precise-road [data-action="finish-road"]' : '#draft-bar [data-action="finish-road"]').click());
  await expect(p.locator('#draft-bar')).toBeHidden();
}

async function undoRedo(p: Page, before: City, after: City) {
  await p.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await doc(p), before, 'Undo must restore the exact complete document');
  await p.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await doc(p), after, 'Redo must restore the exact complete document');
}

// These checks intentionally do not call extractBlocks, validateCity, or quantities.
function independentGraph(city: City) {
  const nodes = new Map(city.nodes.map(node => [node.id, node]));
  assert.equal(nodes.size, city.nodes.length, 'Unique node IDs');
  assert.equal(new Set(city.roads.map(r => r.id)).size, city.roads.length, 'Unique road IDs');
  const adjacent = new Map(city.nodes.map(n => [n.id, [] as string[]]));
  let minAngle = 180;
  for (const r of city.roads) {
    assert(nodes.has(r.a) && nodes.has(r.b), `Road ${r.id} has both endpoints`);
    assert.notEqual(r.a, r.b);
    assert.equal(nodes.get(r.a)!.level, r.level);
    assert.equal(nodes.get(r.b)!.level, r.level);
    adjacent.get(r.a)!.push(r.b); adjacent.get(r.b)!.push(r.a);
  }
  for (const [id, links] of adjacent) {
    assert.equal(new Set(links).size, links.length, `No duplicate edges at ${id}`);
    const node = nodes.get(id)!;
    for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
      const a = nodes.get(links[i])!, b = nodes.get(links[j])!;
      const angle = Math.acos(Math.max(-1, Math.min(1, ((a.x - node.x) * (b.x - node.x) + (a.z - node.z) * (b.z - node.z)) / (Math.hypot(a.x - node.x, a.z - node.z) * Math.hypot(b.x - node.x, b.z - node.z))))) * 180 / Math.PI;
      minAngle = Math.min(minAngle, angle);
      assert(angle >= 25 - 1e-5, `Junction ${id} has unsupported ${angle} degree angle`);
    }
  }
  const seen = new Set<string>();
  let components = 0;
  for (const id of nodes.keys()) if (!seen.has(id)) {
    components++;
    const queue = [id]; seen.add(id);
    for (const next of queue) for (const neighbor of adjacent.get(next)!) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
  }
  return { components, cycleRank: city.roads.length - city.nodes.length + components, minAngle, degrees: Object.fromEntries([...adjacent].map(([id, links]) => [id, links.length])) };
}

function independentContainment(city: City, outer?: [number, number, number, number]) {
  const parcelIDs = new Set(city.parcels.map(p => p.id));
  assert.equal(parcelIDs.size, city.parcels.length);
  assert.equal(new Set(city.buildings.map(b => b.id)).size, city.buildings.length);
  let minSetback = Infinity;
  for (const parcel of city.parcels) {
    assert.equal(parcel.polygon.length, 4, `Rectangular lot ${parcel.id}`);
    for (let i = 0; i < 4; i++) {
      const a = parcel.polygon[i], b = parcel.polygon[(i + 1) % 4];
      assert(Math.abs(a.x - b.x) < 1e-5 || Math.abs(a.z - b.z) < 1e-5, 'Axis-aligned lot edges');
    }
    if (outer) for (const point of parcel.polygon) assert(point.x > outer[0] && point.x < outer[2] && point.z > outer[1] && point.z < outer[3], 'Parcel is inside the actual closed road loop');
  }
  for (const b of city.buildings) {
    const parcel = city.parcels.find(p => p.id === b.parcelId);
    assert(parcel, `Building ${b.id} references a real parcel`);
    assert.equal(parcel.buildingId, b.id);
    assert(b.width > 0 && b.depth > 0 && Number.isInteger(b.floors) && b.floors > 0);
    const xs = parcel.polygon.map(p => p.x), zs = parcel.polygon.map(p => p.z);
    const setback = Math.min(b.x - b.width / 2 - Math.min(...xs), Math.max(...xs) - b.x - b.width / 2, b.z - b.depth / 2 - Math.min(...zs), Math.max(...zs) - b.z - b.depth / 2);
    minSetback = Math.min(minSetback, setback);
    assert(setback >= 2 - 1e-5, `Building ${b.id} has ${setback} m setback`);
  }
  return { parcels: city.parcels.length, buildings: city.buildings.length, minSetback };
}

async function alignment(p: Page, id: string): Promise<Alignment> {
  return p.evaluate(async id => {
    const moduleURL = '/src/core/model.ts';
    const { getAlignment } = await import(moduleURL);
    return getAlignment(window.forma.city, window.forma.city.roads.find(r => r.id === id));
  }, id);
}

async function pickRoad(p: Page, id: string) {
  const a = await alignment(p, id);
  const first = a.points[0], last = a.points.at(-1)!;
  const middle = a.points.reduce((best, point) => Math.hypot(point.x - (first.x + last.x) / 2, point.z - (first.z + last.z) / 2) < Math.hypot(best.x - (first.x + last.x) / 2, best.z - (first.z + last.z) / 2) ? point : best);
  await p.getByRole('button', { name: 'Select tool', exact: true }).click();
  await canvasPoint(p, middle.x, middle.z, middle.y + 0.2);
  await expect(p.locator('#inspector h2')).toHaveText('Road inspector');
  await expect(p.locator('.entity-id')).toContainText(id);
}

async function download(p: Page, action: string): Promise<{ bytes: Buffer; download: Download }> {
  await p.locator('[data-action="export"]').click();
  const pending = p.waitForEvent('download', { timeout: 90_000 });
  await p.locator(`.modal [data-action="${action}"]`).click();
  const item = await pending;
  assert.equal(await item.failure(), null);
  const file = await item.path();
  assert(file);
  const bytes = await readFile(file);
  await p.getByRole('button', { name: 'Close dialog', exact: true }).click();
  return { bytes, download: item };
}

function summary(values: number[]) {
  assert(values.length > 0, 'Timing probe must contain real samples');
  const sorted = [...values].sort((a, b) => a - b), mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { count: values.length, meanMs: mean, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)], maxMs: sorted.at(-1) };
}

try {
  await mkdir(artifacts, { recursive: true });
  const url = await startServer();
  report.url = url;
  const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--enable-unsafe-swiftshader'];
  browser = await chromium.launch({ headless: true, args: launchArgs });
  report.browser = { version: browser.version(), executable: chromium.executablePath(), headless: true, launchArgs };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  // tsx's keepNames helper can appear in serialized evaluate callbacks.
  await context.addInitScript('globalThis.__name = (target) => target;');
  const origin = new URL(url).origin;
  await context.route('**/*', route => {
    const requestURL = route.request().url();
    if (requestURL.startsWith(origin + '/') || /^(data|blob):/.test(requestURL)) return route.continue();
    blockedRequests.push(requestURL); return route.abort();
  });
  page = await context.newPage();
  const p = page;
  p.setDefaultTimeout(30_000);
  p.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  p.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await ready(p);

  await workflow('Desktop initial render', 'Open a fresh desktop context at 1440 x 1000; inspect the actual canvas and default Riverfront workload.', async () => {
    await expect(p.locator('#scene-title')).toHaveText('Riverfront.');
    const counts = await p.evaluate(() => ({ roads: window.forma.city.roads.length, buildings: window.forma.city.buildings.length, vehicles: window.forma.traffic.vehicles.length, canvas: { width: window.forma.scene.renderer.domElement.width, height: window.forma.scene.renderer.domElement.height }, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert(counts.roads >= 100); assert(counts.buildings >= 300); assert.equal(counts.vehicles, 110); assert.equal(counts.overflow, false);
    await p.screenshot({ path: path.join(artifacts, 'forma-verified-desktop.png') });
    return counts;
  });

  await workflow('Empty canvas rectangle and exact history', 'New city > Blank landscape. Roads > Boulevard. Click projected (-150,-150), (150,-150), (150,150), (-150,150), (-150,-150), then Finish. Undo and redo.', async () => {
    await example(p, 'empty');
    const empty = await doc(p);
    for (const key of ['roads', 'nodes', 'buildings', 'parcels', 'water'] as const) assert.equal(empty[key].length, 0, `Empty ${key}`);
    await road(p, [[-150, -150], [150, -150], [150, 150], [-150, 150], [-150, -150]]);
    const city = await doc(p), graph = independentGraph(city);
    assert.equal(city.roads.length, 4); assert.equal(city.nodes.length, 4); assert.equal(graph.components, 1); assert.equal(graph.cycleRank, 1);
    assert.deepEqual(Object.values(graph.degrees), [2, 2, 2, 2]);
    assert.deepEqual(city.nodes.map(n => [n.x, n.z]).sort(), [[-150, -150], [150, -150], [150, 150], [-150, 150]].sort());
    assert.equal(new Set(city.parcels.map(lot => lot.blockId)).size, 1, 'Exactly one generated block');
    assert(city.buildings.length > 10);
    const lots = independentContainment(city, [-150, -150, 150, 150]);
    await undoRedo(p, empty, city);
    return { graph, ...lots };
  });

  await workflow('T four-way and supported diagonal topology', 'Blank landscape; draw horizontal (-200,0) to (200,0), join (0,-160) to (0,0) for a T, then (0,0) to (0,160) for four-way. Extend (200,0) diagonally to (290,90).', async () => {
    await example(p, 'empty');
    await road(p, [[-200, 0], [200, 0]]);
    await road(p, [[0, -160], [0, 0]]);
    let city = await doc(p), graph = independentGraph(city);
    let center = city.nodes.filter(n => Math.hypot(n.x, n.z) < 0.1);
    assert.equal(center.length, 1); assert.equal(graph.degrees[center[0].id], 3); assert.equal(city.roads.length, 3);
    await road(p, [[0, 0], [0, 160]]);
    city = await doc(p); graph = independentGraph(city); center = city.nodes.filter(n => Math.hypot(n.x, n.z) < 0.1);
    assert.equal(center.length, 1); assert.equal(graph.degrees[center[0].id], 4); assert.equal(city.roads.length, 4);
    await road(p, [[200, 0], [290, 90]]);
    city = await doc(p); graph = independentGraph(city);
    assert.equal(city.roads.length, 5); assert.equal(graph.components, 1); assert.equal(graph.cycleRank, 0); assert.equal(city.parcels.length, 0); assert.equal(city.buildings.length, 0);
    assert(city.roads.some(r => { const a = city.nodes.find(n => n.id === r.a)!, b = city.nodes.find(n => n.id === r.b)!; return Math.abs(a.x - b.x) > 20 && Math.abs(a.z - b.z) > 20; }), 'A real diagonal segment committed');
    const lanes = await p.evaluate(() => structuredClone(window.forma.traffic.graph));
    assert.equal(lanes.lanes.length, city.roads.length * 2);
    for (const connector of lanes.connectors) {
      const a = lanes.lanes.find(l => l.id === connector.from)!, b = lanes.lanes.find(l => l.id === connector.to)!;
      assert.equal(a.to, b.from); assert.equal(connector.nodeId, a.to);
      assert.deepEqual(connector.points[0], a.points.at(-1)); assert.deepEqual(connector.points.at(-1), b.points[0]);
    }
    return { graph, lanes: lanes.lanes.length, connectors: lanes.connectors.length };
  });

  await workflow('Terrain drag is one transaction', 'Blank landscape > Terrain > Raise. Drag from projected (-110,30) to (110,30), with multiple pointer moves. Undo and redo the entire stroke.', async () => {
    await example(p, 'empty');
    await p.getByRole('button', { name: 'Terrain tool', exact: true }).click();
    await p.locator('#brush-strength').fill('1');
    await p.locator('#brush-strength').press('Tab');
    const before = await doc(p), count = await historySize(p);
    const points = await p.evaluate(() => [-110, -75, -40, 0, 40, 75, 110].map(x => window.forma.project(x, 30)));
    await p.mouse.move(points[0].x, points[0].y); await p.mouse.down();
    for (const point of points.slice(1)) await p.mouse.move(point.x, point.y, { steps: 3 });
    assert.equal(await historySize(p), count, 'No partial history commits while dragging');
    await commit(p, () => p.mouse.up());
    const after = await doc(p), changed = after.terrain.heights.filter((height, i) => height !== before.terrain.heights[i]).length;
    assert(changed > 10, `Stroke must affect multiple heightfield samples, got ${changed}`);
    assert(Math.max(...after.terrain.heights) > Math.max(...before.terrain.heights));
    await undoRedo(p, before, after);
    return { changedHeightSamples: changed, undoTransactions: (await historySize(p)) - count };
  });

  let bridgeId = '';
  await workflow('Riverfront bridge geometry and canvas inspector', 'New city > Riverfront. Roads > Boulevard. Use Precise coordinates (0,-90), (0,90), Finish. Select the elevated deck at its projected center.', async () => {
    const start = performance.now();
    await example(p, 'riverfront');
    const generation = { wallMs: performance.now() - start, ...await p.evaluate(() => window.forma.timings) };
    const before = await doc(p);
    await road(p, [[0, -90], [0, 90]], { numeric: true });
    const after = await doc(p), added = after.roads.filter(r => !before.roads.some(old => old.id === r.id));
    assert.equal(added.length, 1, 'One new bank-to-bank segment');
    bridgeId = added[0].id;
    assert.equal(added[0].profile, 'boulevard'); assert.equal(added[0].width, 18);
    const a = await alignment(p, bridgeId);
    assert.equal(a.bridge, true); assert(a.points.length > 20);
    const grades = a.points.slice(1).map((point, i) => Math.abs(point.y - a.points[i].y) / Math.hypot(point.x - a.points[i].x, point.z - a.points[i].z));
    assert(grades.every(grade => Number.isFinite(grade) && grade <= 0.12 + 1e-6));
    assert(Math.abs(Math.max(...grades) - 0.1) < 1e-5, 'Independent 10% approach slope');
    assert(Math.abs(Math.max(...grades) - a.maxGrade) < 1e-8);
    const deck = a.points.filter(point => Math.abs(point.z) <= 40 + 1e-6);
    assert(deck.length > 10);
    for (const point of deck) assert(point.y - after.water[0].level >= 5 - 1e-6, 'At least 5 m above real water');
    assert(Math.max(...deck.map(p => p.y)) - Math.min(...deck.map(p => p.y)) < 1e-5, 'Flat water-spanning deck');
    assert(Math.max(...deck.map(p => p.y)) > a.points[0].y + 2, 'Actually elevated, not a bridge label on a flat road');
    await pickRoad(p, bridgeId);
    await expect(p.locator('#inspector')).toContainText('Across the water.');
    await expect(p.locator('#inspector')).toContainText('Maximum actual grade');
    const gradeReadout = await p.locator('.metric-table > div').filter({ hasText: 'Maximum actual grade' }).locator('strong').textContent();
    assert.equal(Number(gradeReadout?.replace('%', '')), Math.round(Math.max(...grades) * 10_000) / 100);
    return { generation, bridgeId, points: a.points.length, maxGrade: Math.max(...grades), deckHeight: deck[0].y, clearance: deck[0].y - after.water[0].level, inspectorGrade: gradeReadout };
  });

  await workflow('UI bridge route bank-to-bank continuity and Follow', 'Select the newly drawn center bridge > Drive this road. Observe Follow mode. Pause via UI, then sample every fixed 1/60 s traffic step until the same vehicle reaches the opposite bank.', async () => {
    assert(bridgeId, 'Bridge fixture must have been created through the UI');
    await pickRoad(p, bridgeId);
    const ids = await p.evaluate(() => window.forma.traffic.vehicles.map(v => v.id));
    await p.locator('[data-action="spawn-road-route"]').click();
    await expect(p.locator('#scene-message')).toContainText('Following vehicle-');
    await expect(p.locator('[data-mode="follow"]')).toHaveClass(/active/);
    await expect(p.locator('#inspector')).toContainText('Following vehicle-');
    await pause(p);
    const route = await p.evaluate(({ ids, bridgeId }) => {
      const f = window.forma, vehicle = f.traffic.vehicles.find(v => !ids.includes(v.id));
      if (!vehicle) throw new Error('Drive this road did not create a vehicle');
      const initial = structuredClone(vehicle), positions = [{ ...vehicle.position }], initialRoute = [...vehicle.route];
      const lane = f.traffic.graph.lanes.find(l => l.id === vehicle.laneId)!;
      const from = f.city.nodes.find(n => n.id === lane.from)!, to = f.city.nodes.find(n => n.id === lane.to)!;
      let maxStep = 0, reached = false, steps = 0, routeChanged = false;
      for (; steps < 60 * 120; steps++) {
        const previous = { ...vehicle.position };
        f.traffic.step();
        maxStep = Math.max(maxStep, Math.hypot(vehicle.position.x - previous.x, vehicle.position.y - previous.y, vehicle.position.z - previous.z));
        if (vehicle.route.join('|') !== initialRoute.join('|')) routeChanged = true;
        if (steps % 30 === 0) positions.push({ ...vehicle.position });
        const direction = Math.sign(to.z - from.z);
        if ((vehicle.position.z - to.z) * direction >= -14) { reached = true; positions.push({ ...vehicle.position }); break; }
      }
      return { id: vehicle.id, roadId: lane.roadId, bridgeId, initial, final: structuredClone(vehicle), from, to, maxStep, reached, steps, routeChanged, positions };
    }, { ids, bridgeId });
    assert.equal(route.roadId, bridgeId); assert.equal(route.reached, true, 'Same UI-created route reaches the opposite bank within 120 simulated seconds');
    assert(route.from.z * route.to.z < 0);
    assert(route.initial.position.z * route.final.position.z < 0);
    assert(route.maxStep <= 11 / 60 + 1e-5, `No teleport: largest fixed-step movement ${route.maxStep} m`);
    assert.equal(route.routeChanged, false, 'Route must not reroute or reset while crossing');
    assert(route.positions.some(p => Math.abs(p.z) < 40 && p.y >= 4 - 1e-5), 'Vehicle actually uses the elevated deck');
    await p.locator('[data-action="follow-selected"]').click();
    await expect(p.locator('[data-mode="follow"]')).toHaveClass(/active/);
    await p.keyboard.press('Escape');
    return route;
  });

  await workflow('Building roof pick edit and stable ID after distant road', 'Select a visible Riverfront building by its projected roof. Change Floors, facade palette, and roof; Apply. Undo/redo. Add a road beyond the opposite district and verify the protected building and parcel are byte-for-byte unchanged.', async () => {
    await example(p, 'riverfront');
    await p.getByRole('button', { name: 'Buildings tool', exact: true }).click();
    const candidates = await p.evaluate(() => {
      const f = window.forma;
      return f.city.buildings.filter(b => b.z > 90 && b.x > 0 && b.roof === 'flat').sort((a, b) => b.floors - a.floors).slice(0, 15).map(b => ({ b, screen: f.project(b.x, b.z, 1 + b.floors * 3.2 + 0.4) }));
    });
    let selected: Building | undefined;
    for (const { b, screen } of candidates) {
      if (!(await p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', screen))) continue;
      await p.mouse.click(screen.x, screen.y);
      if ((await p.locator('.entity-id').allTextContents())[0]?.trim() === b.id) { selected = b; break; }
    }
    assert(selected, 'An actual roof click must pick the chosen building ID');
    await expect(p.locator('#inspector h2')).toHaveText('Building inspector');
    const before = await doc(p), floors = selected.floors + 2, palette = (selected.palette + 3) % 8;
    await p.locator('#building-floors').fill(String(floors));
    await p.getByRole('button', { name: `Facade palette ${palette + 1}`, exact: true }).click();
    await p.locator('#building-roof').selectOption('terrace');
    await commit(p, () => p.locator('[data-action="apply-building"]').click());
    const edited = await doc(p), building = edited.buildings.find(b => b.id === selected!.id)!;
    assert.equal(building.floors, floors); assert.equal(building.palette, palette); assert.equal(building.roof, 'terrace'); assert.equal(building.edited, true);
    independentContainment(edited);
    await undoRedo(p, before, edited);
    await road(p, [[-360, -360], [-420, -420]], { numeric: true });
    const after = await doc(p);
    assert.deepEqual(after.buildings.find(b => b.id === building.id), building, 'Distant road preserves the complete edited building and its stable ID');
    assert.deepEqual(after.parcels.find(lot => lot.id === building.parcelId), edited.parcels.find(lot => lot.id === building.parcelId));
    await undoRedo(p, edited, after);
    return { id: building.id, parcelId: building.parcelId, floors, heightMeters: floors * 3.2, palette, roof: building.roof, roadCount: after.roads.length };
  });

  await workflow('Grade separation and connecting road deletion reset', 'Blank landscape. Draw (-200,0) to (200,0) at Ground, then (0,-200) to (0,200) at Elevated +12 m. Draw a ground connector (200,0) to (300,100), select it and Drive this road, then delete it through the road inspector.', async () => {
    await example(p, 'empty');
    await road(p, [[-200, 0], [200, 0]]);
    await road(p, [[0, -200], [0, 200]], { level: 1 });
    let city = await doc(p);
    assert.equal(city.roads.length, 2); assert.equal(city.nodes.length, 4);
    const graph = independentGraph(city); assert.equal(graph.components, 2); assert.equal(graph.cycleRank, 0);
    assert.equal(city.nodes.filter(n => Math.hypot(n.x, n.z) < 1).length, 0, 'No crossing node is fabricated');
    const crossing = await p.evaluate(() => {
      const f = window.forma, low = f.city.roads.find(r => r.level === 0)!, high = f.city.roads.find(r => r.level === 1)!;
      return { route: f.traffic.routeBetween(low.a, high.a), connectors: f.traffic.graph.connectors.map(c => ({ from: f.traffic.graph.lanes.find(l => l.id === c.from)!.roadId, to: f.traffic.graph.lanes.find(l => l.id === c.to)!.roadId })) };
    });
    assert.deepEqual(crossing.route, []); assert(crossing.connectors.every(c => c.from === c.to), 'No cross-level traffic connectors');
    const alignments = await Promise.all(city.roads.map(r => alignment(p, r.id)));
    assert(Math.abs(alignments[0].points[0].y - alignments[1].points[0].y) >= 5);
    const oldIDs = city.roads.map(r => r.id);
    await road(p, [[200, 0], [300, 100]], { numeric: true });
    city = await doc(p); const added = city.roads.find(r => !oldIDs.includes(r.id))!;
    // A 110-car tiny fixture can correctly reject spawning. Clear it through the UI.
    await p.locator('[data-workspace="explore"]').click();
    await p.locator('#traffic-count').fill('0');
    await commit(p, () => p.locator('[data-action="apply-traffic"]').click());
    await pickRoad(p, added.id);
    await p.locator('[data-action="spawn-road-route"]').click();
    await expect(p.locator('[data-mode="follow"]')).toHaveClass(/active/);
    await pause(p);
    await p.keyboard.press('Escape');
    await pickRoad(p, added.id);
    const oldTraffic = await p.evaluate(() => ({ count: window.forma.traffic.vehicles.length, time: window.forma.traffic.time }));
    await commit(p, () => p.locator('[data-action="delete-road"]').click());
    const reset = await p.evaluate(id => ({ count: window.forma.traffic.vehicles.length, removed: window.forma.traffic.removed, time: window.forma.traffic.time, staleLanes: window.forma.traffic.graph.lanes.filter(l => l.roadId === id).length, staleRoutes: window.forma.traffic.vehicles.filter(v => v.route.some(link => link.startsWith(`${id}:`))).length, roads: window.forma.city.roads.length }), added.id);
    assert.equal(reset.roads, 2); assert.equal(reset.removed, oldTraffic.count); assert.equal(reset.time, 0); assert.equal(reset.staleLanes, 0); assert.equal(reset.staleRoutes, 0);
    await expect(p.locator('[data-mode="orbit"]')).toHaveClass(/active/);
    await expect(p.locator('#toast')).toContainText('Traffic reset');
    return { graph, separatedCrossing: crossing, deletedRoad: added.id, oldTraffic, reset };
  });

  await workflow('Malformed JSON imports are atomic', 'Examples > Open editable city JSON. Upload invalid syntax, wrong version, missing road endpoint, duplicate ID, invalid heightfield, and invalid building reference using file-input buffers. Each rejection must preserve document, storage, and history.', async () => {
    await example(p, 'riverfront');
    const original = await doc(p), originalHistory = await historySize(p), storage = await p.evaluate(() => localStorage.getItem('forma.city.v1'));
    const badEndpoint = structuredClone(original); badEndpoint.roads[0].a = 'missing-node';
    const duplicate = structuredClone(original); duplicate.nodes[1].id = duplicate.nodes[0].id;
    const heights = structuredClone(original); heights.terrain.heights.pop();
    const reference = structuredClone(original); reference.buildings[0].parcelId = 'missing-parcel';
    const cases = [
      ['syntax', '{"version":'], ['version', JSON.stringify({ ...original, version: 999 })],
      ['endpoint', JSON.stringify(badEndpoint)], ['duplicate-id', JSON.stringify(duplicate)],
      ['heightfield', JSON.stringify(heights)], ['building-reference', JSON.stringify(reference)],
    ];
    const rejections: { name: string; message: string | null }[] = [];
    await p.locator('[data-panel="library"]').click();
    for (const [name, json] of cases) {
      const chooser = p.waitForEvent('filechooser');
      await p.locator('[data-action="import"]').click();
      await (await chooser).setFiles({ name: `invalid-${name}.json`, mimeType: 'application/json', buffer: Buffer.from(json) });
      await p.waitForFunction(() => !window.forma.busy && (document.querySelector('#import-file') as HTMLInputElement).value === '' && document.querySelector('#toast.error'), undefined, { timeout: 40_000 });
      assert.deepEqual(await doc(p), original, `Rejected ${name} must preserve the exact city`);
      assert.equal(await historySize(p), originalHistory, `Rejected ${name} must not add history`);
      assert.equal(await p.evaluate(() => localStorage.getItem('forma.city.v1')), storage);
      rejections.push({ name, message: await p.locator('#toast').textContent() });
    }
    return rejections;
  });

  await workflow('JSON download import reload and continued editing', 'Export > Editable city document. New blank landscape, import the downloaded buffer via Examples, reload the page, compare localStorage recovery, then rename through Properties and undo/redo.', async () => {
    await example(p, 'riverfront');
    const before = await doc(p), exported = await download(p, 'json');
    assert(exported.download.suggestedFilename().endsWith('.json'));
    assert.deepEqual(JSON.parse(exported.bytes.toString('utf8')), before, 'Downloaded JSON is the complete current model');
    await example(p, 'empty');
    await p.locator('[data-panel="library"]').click();
    await commit(p, () => p.locator('#import-file').setInputFiles({ name: exported.download.suggestedFilename(), mimeType: 'application/json', buffer: exported.bytes }));
    assert.deepEqual(await doc(p), before, 'Downloaded JSON round-trips through real file input');
    assert.deepEqual(JSON.parse((await p.evaluate(() => localStorage.getItem('forma.city.v1')))! ), before);
    await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p); await pause(p);
    assert.deepEqual(await doc(p), before, 'Reload uses the exact localStorage document');
    assert.equal(await historySize(p), 0, 'Session history restarts on reload');
    await p.locator('[data-panel="properties"]').click();
    await p.locator('#city-name').fill('Verified Riverfront');
    await commit(p, () => p.locator('[data-action="rename"]').click());
    const after = await doc(p); assert.equal(after.name, 'Verified Riverfront');
    await undoRedo(p, before, after);
    return { bytes: exported.bytes.length, fileName: exported.download.suggestedFilename(), recoveredRoads: before.roads.length, recoveredBuildings: before.buildings.length, continuedEdit: after.name };
  });

  await workflow('PNG download signature and dimensions', 'Export > Current-scene image. Inspect the downloaded PNG header, IHDR size, and decoded pixel variation in the browser.', async () => {
    const { bytes, download: item } = await download(p, 'screenshot');
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.subarray(12, 16).toString(), 'IHDR');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    const actual = await p.locator('#canvas canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }));
    assert.deepEqual({ width, height }, actual);
    const pixels = await p.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data, colors = new Set<string>();
      for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return { uniqueColors: colors.size, width: image.naturalWidth, height: image.naturalHeight };
    }, bytes.toString('base64'));
    assert(pixels.uniqueColors > 100, 'PNG contains rendered geometry rather than a blank canvas');
    return { fileName: item.suggestedFilename(), bytes: bytes.length, ...pixels };
  });

  await workflow('GLB binary mesh counts actual loader and metre bounds', 'Export > 3D city geometry. Parse GLB chunks and EXT_mesh_gpu_instancing accessors, then load those exact bytes with GLTFLoader in the browser. Compare meshes and Box3 dimensions to the live export root and document entities.', async () => {
    await pause(p);
    const source = await p.evaluate(async () => {
      const threeURL = '/node_modules/three/build/three.module.js'; const THREE = await import(threeURL);
      const f = window.forma, meshes: { name: string; count: number; instanced: boolean; kind: string | null; entityIDs: string[]; vertices: number; triangles: number }[] = [];
      f.scene.root.updateMatrixWorld(true);
      f.scene.root.traverseVisible(object => {
        const mesh = object as InstancedMesh;
        if (!mesh.isMesh || mesh.isInstancedMesh && mesh.count === 0) return;
        meshes.push({ name: mesh.name, count: mesh.isInstancedMesh ? mesh.count : 1, instanced: !!mesh.isInstancedMesh, kind: mesh.userData.kind ?? null, entityIDs: [...new Set<string>((mesh.userData.ids ?? mesh.userData.faceIds ?? [mesh.userData.id]).filter(Boolean))], vertices: mesh.geometry.attributes.position.count, triangles: (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 });
      });
      const box = new THREE.Box3().setFromObject(f.scene.root), terrain = f.scene.root.getObjectByName('Terrain');
      return { meshes, bounds: box.getSize(new THREE.Vector3()).toArray(), terrainBounds: new THREE.Box3().setFromObject(terrain).getSize(new THREE.Vector3()).toArray(), buildingIDs: f.city.buildings.map(b => b.id), roadIDs: f.city.roads.map(r => r.id), vehicleIDs: f.traffic.vehicles.map(v => v.id), terrainSize: f.city.terrain.size };
    });
    const { bytes, download: item } = await download(p, 'glb');
    assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
    const chunks: { type: number; bytes: number }[] = []; let json: any;
    for (let offset = 12; offset < bytes.length;) {
      const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
      assert.equal(length % 4, 0); assert(offset + 8 + length <= bytes.length);
      chunks.push({ type, bytes: length });
      if (type === 0x4e4f534a) json = JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8').trim());
      offset += 8 + length;
    }
    assert(json); assert(chunks.some(c => c.type === 0x004e4942)); assert.equal(json.asset.version, '2.0');
    const meshNodes = json.nodes.filter((node: any) => node.mesh !== undefined);
    const accessorMismatches: { name: string; attributes: Record<string, number> }[] = [];
    const instances: { name: string; count: number }[] = meshNodes.filter((node: any) => node.extensions?.EXT_mesh_gpu_instancing).map((node: any) => {
      const attributes = node.extensions.EXT_mesh_gpu_instancing.attributes;
      const counts = Object.values(attributes).map(index => json.accessors[index as number].count);
      if (!counts.every(count => count === counts[0])) accessorMismatches.push({ name: node.name, attributes: Object.fromEntries(Object.entries(attributes).map(([name, index]) => [name, json.accessors[index as number].count])) });
      return { name: node.name, count: counts[0] as number };
    });
    assert(instances.length > 0, 'Export retains real GPU instances');
    const modelExtras = json.nodes.find((node: any) => node.extras?.forma)?.extras.forma;
    assert(modelExtras, 'GLB includes explicit model provenance');
    assert.equal(modelExtras.units, 'metres');
    assert.deepEqual([...modelExtras.buildings].sort(), [...source.buildingIDs].sort());
    assert.deepEqual([...modelExtras.roads].sort(), [...source.roadIDs].sort());
    assert.equal(meshNodes.length, source.meshes.length, 'One exported mesh node per nonempty visible source mesh');
    assert.equal(instances.reduce((sum, item) => sum + item.count, 0), source.meshes.filter(m => m.instanced).reduce((sum, mesh) => sum + mesh.count, 0));
    for (const kind of ['building', 'road', 'vehicle'] as const) {
      const ids = new Set(source.meshes.filter(m => m.kind === kind).flatMap(m => m.entityIDs));
      const expected = kind === 'building' ? source.buildingIDs : kind === 'road' ? source.roadIDs : source.vehicleIDs;
      assert.deepEqual([...ids].sort(), [...expected].sort(), `Live exported meshes cover every model ${kind} ID`);
    }
    const loaded = await p.evaluate(async base64 => {
      const loaderURL = '/node_modules/three/examples/jsm/loaders/GLTFLoader.js', threeURL = '/node_modules/three/build/three.module.js';
      const [{ GLTFLoader }, THREE] = await Promise.all([import(loaderURL), import(threeURL)]);
      const buffer = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const result = await new GLTFLoader().parseAsync(buffer.buffer, '');
      result.scene.updateMatrixWorld(true);
      const meshes: { name: string; count: number; instanced: boolean; vertices: number; triangles: number }[] = [];
      result.scene.traverse((object: Mesh) => {
        if (!object.isMesh) return;
        const mesh = object as InstancedMesh;
        if (mesh.isInstancedMesh) mesh.computeBoundingBox();
        meshes.push({ name: mesh.name, count: mesh.isInstancedMesh ? mesh.count : 1, instanced: !!mesh.isInstancedMesh, vertices: mesh.geometry.attributes.position.count, triangles: (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 });
      });
      const terrain = result.scene.getObjectByName('Terrain');
      const measurements = { meshes, bounds: new THREE.Box3().setFromObject(result.scene).getSize(new THREE.Vector3()).toArray(), terrainBounds: terrain ? new THREE.Box3().setFromObject(terrain).getSize(new THREE.Vector3()).toArray() : null };
      result.scene.traverse((object: Mesh) => { if (object.isMesh) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); if ((object as InstancedMesh).isInstancedMesh) (object as InstancedMesh).dispose(); } });
      return measurements;
    }, bytes.toString('base64'));
    report.glbMeasurement = { bytes: bytes.length, meshDefinitions: json.meshes.length, meshNodes: meshNodes.length, sourceMeshNodes: source.meshes.length, loadedMeshNodes: loaded.meshes.length, accessorMismatches, instances, loadedBounds: loaded.bounds, sourceBounds: source.bounds, terrainBounds: loaded.terrainBounds };
    assert.equal(loaded.meshes.length, source.meshes.length);
    const fingerprint = (meshes: { count: number; instanced: boolean; vertices: number; triangles: number }[]) => meshes.map(m => `${m.instanced}:${m.count}:${m.vertices}:${m.triangles}`).sort();
    assert.deepEqual(fingerprint(loaded.meshes), fingerprint(source.meshes), 'Loaded GLB reproduces actual mesh and instance definitions');
    assert(loaded.terrainBounds); assert.equal(source.terrainSize, 960);
    for (const axis of [0, 2]) assert(Math.abs(loaded.terrainBounds[axis] - 960) < 0.01, `Terrain axis ${axis} is actually 960 m`);
    for (let axis = 0; axis < 3; axis++) assert(Math.abs(loaded.bounds[axis] - source.bounds[axis]) < 0.02, `Loaded Box3 axis ${axis} matches live root`);
    const toast = await p.locator('#toast').textContent();
    const reportedDefinitions = toast?.match(/([\d,]+) instanced mesh definitions/);
    assert(reportedDefinitions, `GLB UI must report actual mesh definitions: ${toast}`);
    assert.equal(Number(reportedDefinitions[1].replaceAll(',', '')), json.meshes.length);
    assert.deepEqual(accessorMismatches, [], 'All EXT_mesh_gpu_instancing attributes, including color, must describe the same active instance count');
    return { fileName: item.suggestedFilename(), bytes: bytes.length, chunks, meshDefinitions: json.meshes.length, meshNodes: meshNodes.length, instancedDefinitions: instances.length, totalInstances: instances.reduce((sum, i) => sum + i.count, 0), instances, bounds: loaded.bounds, terrainBounds: loaded.terrainBounds, buildings: source.buildingIDs.length, roads: source.roadIDs.length, vehicles: source.vehicleIDs.length, sourceMeshes: source.meshes.map(({ entityIDs, ...mesh }) => ({ ...mesh, distinctEntityIDs: entityIDs.length })), metadataPolicy: 'Root extras contain units, seed, terrain size and model entity IDs. IDs are independently cross-referenced on the live export root, then binary accessor counts and actual loaded geometry are compared.' };
  });

  await workflow('Live overlays presentation saved views night and cancellation', 'Build a sparse four-way network through UI. Inspect live signal instance colors across phases, clean presentation, saved camera restoration, actual emissive lighting, and the Cancel rebuild button before worker commit.', async () => {
    await example(p, 'empty');
    await road(p, [[-180, 0], [180, 0]], { numeric: true });
    await road(p, [[0, -180], [0, 180]], { numeric: true });
    await p.getByRole('button', { name: 'Layers', exact: true }).click();
    await p.getByRole('checkbox', { name: 'Traffic signals', exact: true }).check();
    await p.locator('[data-action="reset-traffic"]').click();
    await p.waitForTimeout(500);
    const signals = () => p.evaluate(() => {
      const mesh = window.forma.scene.root.parent!.getObjectByName('Live traffic signal phases') as InstancedMesh;
      return { count: mesh.count, colors: Array.from(mesh.instanceColor!.array).slice(0, mesh.count * 3) };
    });
    const ns = await signals(); assert.equal(ns.count, 4);
    await p.evaluate(() => { for (let i = 0; i < 14 * 60; i++) window.forma.traffic.step(); });
    await p.waitForTimeout(500);
    const ew = await signals(); assert.equal(ew.count, 4); assert.notDeepEqual(ew.colors, ns.colors, 'Live approach colors change with the actual fixed-step signal phase');
    const redCount = (colors: number[]) => colors.filter((_, i) => i % 3 === 0 && colors[i] > colors[i + 1]).length;
    assert.equal(redCount(ns.colors), 2); assert.equal(redCount(ew.colors), 2);
    await p.getByRole('button', { name: 'Presentation mode', exact: true }).click();
    assert.equal(await p.evaluate(() => window.forma.scene.root.parent!.getObjectByName('Editor (not exported)')!.visible), false);
    await p.locator('.exit-presentation').click();
    assert.equal(await p.evaluate(() => window.forma.scene.root.parent!.getObjectByName('Editor (not exported)')!.visible), true);
    await p.getByRole('button', { name: 'Saved views', exact: true }).click();
    await p.locator('#view-name').fill('Verified skyline');
    const view = await p.evaluate(() => window.forma.scene.saveView());
    await commit(p, () => p.locator('[data-action="save-view"]').click());
    assert.deepEqual((await doc(p)).views.at(-1), { name: 'Verified skyline', ...view });
    await p.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await p.waitForTimeout(1000);
    assert.notDeepEqual(await p.evaluate(() => window.forma.scene.camera.position.toArray()), view.position);
    await p.locator('[data-view="0"]').click(); await p.waitForTimeout(1000);
    const restored = await p.evaluate(() => window.forma.scene.saveView());
    for (let i = 0; i < 3; i++) { assert(Math.abs(restored.position[i] - view.position[i]) < 1e-5); assert(Math.abs(restored.target[i] - view.target[i]) < 1e-5); }
    await p.getByRole('button', { name: 'Toggle night', exact: true }).click();
    assert.equal((await doc(p)).settings.day, 22);
    const nightEmission = await p.evaluate(() => {
      const mesh = window.forma.scene.root.getObjectByName('Porcelain lamp globes') as Mesh;
      return (mesh.material as { emissiveIntensity?: number }).emissiveIntensity;
    });
    assert(nightEmission && nightEmission > 1);
    await p.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal((await doc(p)).settings.day, 14);
    await p.getByRole('button', { name: 'Select tool', exact: true }).click();
    const before = await doc(p), beforeHistory = await historySize(p);
    // Invoke the actual Cancel button as soon as the busy UI appears. This avoids
    // a timing race between Web Worker completion and headless software rendering.
    await p.evaluate(() => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('#busy')!.classList.contains('hidden')) {
          (document.querySelector('[data-action="cancel-build"]') as HTMLButtonElement).click(); observer.disconnect();
        }
      });
      observer.observe(document.querySelector('#busy')!, { attributes: true, attributeFilter: ['class'] });
    });
    await p.locator('[data-action="regenerate"]').click();
    await expect(p.locator('#toast')).toContainText('Rebuild cancelled');
    await ready(p);
    assert.deepEqual(await doc(p), before); assert.equal(await historySize(p), beforeHistory);
    return { signalApproaches: ns.count, redBefore: redCount(ns.colors), redAfter: redCount(ew.colors), cleanPresentation: true, savedView: 'Verified skyline', nightEmission, cancelledDocumentUnchanged: true };
  });

  await workflow('Visible workload orbit and honest render measurements', 'Load Riverfront through New city, leave default 110 traffic active, frame the city, and orbit by actual mouse drag while collecting up to 60 rAF intervals (25 s cap). Measure render submission separately from render + gl.finish, without reducing render quality.', async () => {
    await example(p, 'riverfront');
    await p.getByRole('button', { name: 'Play traffic', exact: true }).click();
    await p.getByRole('button', { name: 'Frame city', exact: true }).click();
    const environment = await p.evaluate(() => {
      const f = window.forma, renderer = f.scene.renderer, gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      const canvas = renderer.domElement;
      return { roads: f.city.roads.length, buildings: f.city.buildings.length, vehicles: f.traffic.vehicles.length, requestedVehicles: Math.round(f.city.settings.traffic * 200), paused: f.paused, browser: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null, devicePixelRatio, rendererPixelRatio: renderer.getPixelRatio(), gpu: { vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION) }, drawingBuffer: { width: canvas.width, height: canvas.height }, viewport: { width: innerWidth, height: innerHeight }, stats: f.scene.stats(), timings: f.timings, cameraBefore: f.scene.camera.position.toArray(), simulationBefore: f.traffic.time };
    });
    assert(environment.roads >= 100); assert(environment.buildings >= 300); assert(environment.vehicles >= 100); assert.equal(environment.vehicles, 110); assert.equal(environment.paused, false);
    await p.evaluate(() => {
      const probe: FrameProbe = { intervals: [], start: performance.now(), stoppedAt: 0, previous: 0, done: false, stop: () => {} };
      let raf = 0;
      const stop = () => { probe.done = true; probe.stoppedAt = performance.now(); cancelAnimationFrame(raf); clearTimeout(timer); };
      const frame = (now: number) => {
        if (probe.done) return;
        if (probe.previous) probe.intervals.push(now - probe.previous);
        probe.previous = now;
        if (probe.intervals.length >= 60 || performance.now() - probe.start >= 25_000) stop(); else raf = requestAnimationFrame(frame);
      };
      const timer = setTimeout(stop, 25_000); probe.stop = stop; window.formaFrameProbe = probe; raf = requestAnimationFrame(frame);
    });
    const canvas = await p.locator('#canvas canvas').boundingBox(); assert(canvas);
    const cx = canvas.x + canvas.width * 0.52, cy = canvas.y + canvas.height * 0.5;
    await p.mouse.move(cx, cy); await p.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await p.mouse.move(cx + i * 5, cy + Math.sin(i / 12 * Math.PI) * 20);
      await p.waitForTimeout(70);
      if (await p.evaluate(() => window.formaFrameProbe?.done)) break;
    }
    await p.mouse.up();
    await p.waitForFunction(() => window.formaFrameProbe?.done, undefined, { timeout: 35_000, polling: 250 });
    const frames = await p.evaluate(() => ({ intervals: window.formaFrameProbe!.intervals, elapsedMs: window.formaFrameProbe!.stoppedAt - window.formaFrameProbe!.start, cameraAfter: window.forma.scene.camera.position.toArray(), simulationAfter: window.forma.traffic.time, stats: window.forma.scene.stats(), activeVehicles: window.forma.traffic.vehicles.length }));
    assert(frames.intervals.length >= 2); assert.notDeepEqual(frames.cameraAfter, environment.cameraBefore, 'Actual orbit changed the camera'); assert(frames.simulationAfter > environment.simulationBefore); assert(frames.activeVehicles >= 100);
    const render = await p.evaluate(() => {
      const f = window.forma, renderer = f.scene.renderer, gl = renderer.getContext(), scene = f.scene.root.parent!;
      const submissionMs: number[] = [], finishOnlyMs: number[] = [], synchronizedMs: number[] = [], drainMs: number[] = [], pixel = new Uint8Array(4);
      for (let i = 0; i < 3; i++) {
        const drain = performance.now(); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); drainMs.push(performance.now() - drain);
        const start = performance.now(); renderer.render(scene, f.scene.camera); const submitted = performance.now(); gl.finish(); const finished = performance.now();
        // Chromium may return from gl.finish before its GPU process completes.
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        submissionMs.push(submitted - start); finishOnlyMs.push(finished - start); synchronizedMs.push(performance.now() - start);
      }
      return { submissionMs, finishOnlyMs, synchronizedMs, drainMs, stats: f.scene.stats(), contextLost: gl.isContextLost(), readbackPixel: [...pixel] };
    });
    assert.equal(render.contextLost, false); assert(render.stats.calls > 0); assert(render.stats.triangles > 10_000);
    const frameSummary = { ...summary(frames.intervals), framesPerSecond: 1000 / summary(frames.intervals).meanMs };
    return { environment, frames: { ...frames, summary: frameSummary, targetSamples: 60, capped: frames.intervals.length < 60, capMs: 25_000 }, render: { ...render, submission: summary(render.submissionMs), finishOnly: summary(render.finishOnlyMs), synchronized: summary(render.synchronizedMs), note: 'Submission is CPU/driver time only. finishOnly includes gl.finish but some Chromium implementations return before GPU completion. Synchronized adds a one-pixel readPixels barrier to require completed rendering; it includes readback overhead and is not pure GPU timer-query time. Only visible rAF intervals are reported as FPS.' }, assessment: `${frameSummary.framesPerSecond.toFixed(2)} measured FPS; ${/swiftshader|llvmpipe|software/i.test(environment.gpu.renderer) ? 'software renderer' : 'renderer identification above'}. ${frameSummary.framesPerSecond < 55 ? '60 FPS was NOT demonstrated.' : 'Near-60 FPS in this specific measured workload only.'}` };
  });

  await workflow('Fresh mobile render inspector and real road edit', 'Open an independent empty-storage mobile context at 390 x 844. Capture initial Riverfront, toggle inspector, Examples > empty landscape, draw a road with precise UI fields, and verify committed endpoints.', async () => {
    await p.close();
    const mobileContext = await browser!.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, acceptDownloads: true });
    await mobileContext.addInitScript('globalThis.__name = (target) => target;');
    await mobileContext.route('**/*', route => {
      const requestURL = route.request().url();
      if (requestURL.startsWith(origin + '/') || /^(data|blob):/.test(requestURL)) return route.continue();
      blockedRequests.push(requestURL); return route.abort();
    });
    const mobile = await mobileContext.newPage(); mobile.setDefaultTimeout(30_000); page = mobile;
    mobile.on('pageerror', error => pageErrors.push(`mobile: ${error.stack ?? error.message}`));
    try {
      await mobile.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }); await ready(mobile);
      const initial = await mobile.evaluate(() => ({ title: document.querySelector('#scene-title')?.textContent, viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth > innerWidth, roads: window.forma.city.roads.length, buildings: window.forma.city.buildings.length, vehicles: window.forma.traffic.vehicles.length, recoveredStorage: localStorage.getItem('forma.city.v1') }));
      assert.equal(initial.title, 'Riverfront.'); assert.deepEqual(initial.viewport, { width: 390, height: 844 }); assert.equal(initial.overflow, false); assert.equal(initial.recoveredStorage, null); assert(initial.roads >= 100); assert(initial.buildings >= 300); assert.equal(initial.vehicles, 110);
      await expect(mobile.locator('#inspector')).toBeHidden();
      await mobile.screenshot({ path: path.join(artifacts, 'forma-verified-mobile.png') });
      await mobile.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
      await expect(mobile.locator('#inspector')).toBeVisible();
      await mobile.locator('[data-panel="library"]').click();
      await commit(mobile, () => mobile.locator('[data-example="empty"]').click());
      await pause(mobile);
      await road(mobile, [[-100, 0], [100, 0]], { numeric: true });
      const city = await doc(mobile); assert.equal(city.roads.length, 1); assert.equal(city.nodes.length, 2); assert.equal(city.buildings.length, 0);
      assert.deepEqual(city.nodes.map(n => [n.x, n.z]).sort(), [[-100, 0], [100, 0]].sort());
      await mobile.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
      await expect(mobile.locator('#inspector')).toBeHidden();
      await expect(mobile.locator('#canvas canvas')).toBeVisible();
      return { initial, mobileEdit: { roads: city.roads.length, nodes: city.nodes.length } };
    } catch (error) {
      await mobile.screenshot({ path: path.join(artifacts, 'forma-failed-mobile.png'), timeout: 15_000 }).catch(() => {});
      throw error;
    } finally { await mobileContext.close(); page = undefined; }
  });

  await workflow('No runtime errors or remote services', 'Check uncaught browser exceptions, browser console errors, and any attempted off-origin network requests across the workflows.', async () => {
    assert(browser!.isConnected(), 'Browser remained connected through verification');
    assert.deepEqual(pageErrors, [], 'No uncaught runtime exceptions');
    assert.deepEqual(consoleErrors, [], 'No browser console errors');
    assert.deepEqual(blockedRequests, [], 'No remote service requests');
    return { pageErrors: pageErrors.length, consoleErrors: consoleErrors.length, remoteRequests: blockedRequests.length };
  });
} catch (error) {
  report.fatalError = error instanceof Error ? error.stack : String(error);
  console.error(report.fatalError);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally { await stopServer(); }
  report.finishedAt = new Date().toISOString();
  report.passed = results.filter(result => result.status === 'passed').length;
  report.failed = results.filter(result => result.status === 'failed').length;
  if (report.fatalError || Number(report.failed) > 0) process.exitCode = 1;
  if (report.fatalError) report.serverOutput = serverOutput;
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Verification: ${report.passed} passed, ${report.failed} failed. Report: ${reportPath}`);
}
