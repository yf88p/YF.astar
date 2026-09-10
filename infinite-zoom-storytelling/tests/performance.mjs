import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Run against npm run preview -- --port 5199 --strictPort.
// App changes use only the file chooser, buttons, pointer, wheel, and range input.
// evaluate() only observes the app, records RAFs, or draws detached PNG fixtures.
const BASE_URL = process.env.BASE_URL || 'http://localhost:5199';
const VIEWPORT = { width: 1440, height: 1000 };
const SCREENSHOT = '/tmp/opencode/folia-performance.png';
const REPORT = '/tmp/opencode/folia-performance.json';
await mkdir('/tmp/opencode', { recursive: true });
const CANVAS = '.canvas-stage > svg.spatial-canvas';
const expect = playwrightExpect.configure({ timeout: 15000 });
const started = performance.now();
const cpus = os.cpus();
const report = {
  startedAt: new Date().toISOString(), baseURL: BASE_URL, status: 'running',
  hardware: { platform: os.platform(), release: os.release(), arch: os.arch(),
    cpuModels: [...new Set(cpus.map(cpu => cpu.model))], logicalCpus: cpus.length,
    availableParallelism: os.availableParallelism(), totalRAMBytes: os.totalmem(), freeRAMBytesAtStart: os.freemem() },
  configuration: { viewport: VIEWPORT, deviceScaleFactor: 1, headless: true,
    browser: 'Standard @playwright/test Chromium; no custom launch flags or throttling',
    reducedMotion: 'no-preference', domSampleIntervalMs: 200,
    readingSceneLocalUnits: { width: 1200, height: 780 }, attempts: 1 },
  readings: [], measurements: [], hmr: [], errors: [], navigations: [],
  limitations: [
    'One synthetic editor run, not a production service-level, mobile, GPU, or real-user performance guarantee.',
    'All seven stops are visited before timing, warming fonts, raster decoding, and rendering caches.',
    'RAF intervals measure main-thread callback cadence, not confirmed presented frames, input latency, or GPU completion.',
    'Dropped frames are estimates against a stated 60 Hz budget, not a browser compositor counter.',
    'DOM observation runs every 200 ms, adds measured observer work, and can miss shorter visibility extremes.',
    'Mounted counts come from actual main-canvas node elements, not thumbnails or just the app count attribute. Viewport counts additionally test CSS visibility and bounds intersection; they are not pixel-level occlusion counts.',
    'Reading stops additionally check every tile node is fully in the viewport, text fits, and its center is not occluded. Scene backgrounds and portal outlines are not tile workload.',
    'Nested portals use scene minZoom 0.35. Reading stops must expose all 180 tile objects; transitions can legitimately have sparse intervals between scales.',
    'The 1200x780 reading scene is in local project units. Actual editor SVG dimensions are reported separately at the required 1440x1000 browser viewport.',
    'JS heap excludes much native image/GPU memory; performance.memory can be coarse. CDP heap is also reported; no forced GC.',
    'Hardware is OS/browser-reported and can describe a container host rather than its effective CPU or memory quota.',
    'HMR is recorded without retrying or dropping samples. Any observed update makes this a mixed-build run.',
  ],
};
let browser, page, cdp, probe, fixture;
let phase = 'setup';

function statistics(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const over33 = values.filter(value => value > 33).length;
  const dropped = values.reduce((sum, value) => sum + Math.max(0, Math.round(value / (1000 / 60)) - 1), 0);
  return { intervals: values.length, medianMs: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1),
    over33ms: over33, over33msPercent: over33 / values.length * 100,
    estimatedDroppedFramesAt60Hz: dropped, estimatedDroppedPercentAt60Hz: dropped / (values.length + dropped) * 100 };
}

function range(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? { min: Math.min(...finite), max: Math.max(...finite) } : null;
}

async function exported() {
  await page.getByRole('button', { name: 'Project options', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export editable project', exact: true }).click();
  const file = await downloading;
  assert.equal(await file.failure(), null);
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  const close = page.getByRole('button', { name: 'Close dialog', exact: true });
  if (await close.isVisible()) await close.click();
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function heap() {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const wanted = ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents', 'LayoutCount',
    'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'];
  return { cdp: Object.fromEntries(metrics.filter(metric => wanted.includes(metric.name)).map(metric => [metric.name, metric.value])),
    performanceMemory: await page.evaluate(() => performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    } : null) };
}

async function goStop(index) {
  const stop = fixture.stops[index];
  // The timeline's actual custom title selects the authored target, not a runtime camera hook.
  await page.getByTitle(stop.title, { exact: true }).click();
  await expect(page.getByLabel('Stop name', { exact: true })).toHaveValue(stop.title);
  const worldScale = 0.04 ** index;
  await expect.poll(async () => {
    const snapshot = await probe.evaluate(p => p.snapshot());
    const expectedScale = Math.min((snapshot.svg.width - 140) / 1200, (snapshot.svg.height - 140) / 780) / worldScale;
    return Math.abs(snapshot.camera.scale / expectedScale - 1);
  }, { message: `Wait for actual camera to land on ${stop.title}` }).toBeLessThan(0.0001);
  await page.waitForTimeout(120);
}

async function measure(name, requestedMs, action) {
  phase = name;
  const before = await heap();
  const wallStart = performance.now();
  const hmrStart = report.hmr.length;
  await probe.evaluate(p => p.start());
  let inputs, failure;
  try { inputs = await action(); } catch (error) { failure = error; }
  const raw = await probe.evaluate(p => p.stop());
  const wallTimeMs = performance.now() - wallStart;
  const after = await heap();
  const counts = {};
  for (const kind of ['mounted', 'inViewport']) {
    counts[kind] = Object.fromEntries(['total', 'text', 'image', 'shape', 'scene'].map(key => [key, range(raw.samples.map(sample => sample[kind][key]))]));
  }
  const result = { name, requestedMs, wallTimeMs, observedMs: raw.durationMs, inputs,
    raf: statistics(raw.frames.map(frame => frame.intervalMs)),
    segments: Object.fromEntries([...new Set(raw.frames.map(frame => frame.segment))].map(segment => [segment,
      statistics(raw.frames.filter(frame => frame.segment === segment).map(frame => frame.intervalMs))])),
    counts, persistentTotalRange: range(raw.samples.map(sample => sample.projectTotal)),
    appVisibleAttributeRange: range(raw.samples.map(sample => sample.appVisible)),
    cameraScaleRange: range(raw.samples.map(sample => sample.camera.scale)),
    cameraXRange: range(raw.samples.map(sample => sample.camera.x)),
    cameraYRange: range(raw.samples.map(sample => sample.camera.y)),
    timelineSecondsRange: range(raw.samples.map(sample => sample.timelineSeconds)),
    observerCostMs: { total: raw.samples.reduce((sum, sample) => sum + sample.observerMs, 0),
      max: Math.max(...raw.samples.map(sample => sample.observerMs)) },
    heapBefore: before, heapAfter: after, hmrDuringMeasurement: report.hmr.slice(hmrStart),
    raw, ...(failure ? { error: failure.stack } : {}) };
  report.measurements.push(result);
  console.log(JSON.stringify({ measurement: name, wallTimeMs, raf: result.raf, counts, cameraScaleRange: result.cameraScaleRange }));
  if (failure) throw failure;
  assert.ok(raw.frames.length > 1, `${name}: no RAF intervals recorded`);
  assert.ok(raw.samples.every(sample => sample.projectTotal === fixture.nodes.length), `${name}: project node total changed`);
  assert.ok(raw.samples.every(sample => sample.appVisible === sample.mounted.total), `${name}: app count differs from actual DOM`);
  return result;
}

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1,
    reducedMotion: 'no-preference', acceptDownloads: true });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', error => report.errors.push({ phase, kind: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push({ phase, kind: 'console', message: message.text() });
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) report.navigations.push({ phase, atMs: performance.now() - started, url: frame.url() });
  });
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try {
      const message = JSON.parse(String(payload));
      if (['update', 'full-reload', 'error'].includes(message.type)) {
        report.hmr.push({ phase, atMs: performance.now() - started, message });
      }
    } catch { /* Ignore non-JSON websocket messages. */ }
  }));
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expect(page.locator('.save-status')).toHaveText('All changes saved locally');
  report.browser = { version: browser.version(), ...await page.evaluate(() => ({
    userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: navigator.deviceMemory ?? null, devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight }, visibilityState: document.visibilityState,
    prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    viteClientPresent: [...document.scripts].some(script => script.src.includes('/@vite/client')),
  })) };
  assert.equal(report.browser.prefersReducedMotion, false);
  cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  const themes = [
    { name: 'Ochre', subject: 'sunlit mineral pigments', hue: 38 },
    { name: 'Moss', subject: 'the green of shaded gardens', hue: 112 },
    { name: 'Tide', subject: 'blue water and salt-worn stone', hue: 190 },
    { name: 'Clay', subject: 'earth after the afternoon rain', hue: 17 },
    { name: 'Dusk', subject: 'violet shadows before night', hue: 270 },
    { name: 'Frost', subject: 'pale light across winter glass', hue: 215 },
    { name: 'Ember', subject: 'warmth held in charcoal', hue: 355 },
  ];
  const assets = await page.evaluate(themes => {
    const result = {};
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 100;
    const g = canvas.getContext('2d');
    for (const [level, theme] of themes.entries()) {
      for (let tile = 0; tile < 40; tile++) {
        const hue = (theme.hue + tile * 3) % 360;
        const gradient = g.createLinearGradient(0, tile % 20, 160, 100);
        gradient.addColorStop(0, `hsl(${hue} 54% 72%)`);
        gradient.addColorStop(1, `hsl(${hue + 28} 38% 27%)`);
        g.fillStyle = gradient; g.fillRect(0, 0, 160, 100);
        for (let grain = 0; grain < 90; grain++) {
          g.fillStyle = grain % 2 ? '#ffffff35' : '#14201f45';
          g.fillRect((grain * 43 + tile * 17) % 160, (grain * 29 + level * 13) % 100, 2 + grain % 5, 1 + grain % 3);
        }
        g.strokeStyle = '#fff5dc'; g.lineWidth = 2;
        for (let line = 0; line < 5; line++) {
          g.beginPath(); g.moveTo(0, 14 + line * 17);
          g.bezierCurveTo(35, line * 13 + tile % 15, 95, 90 - line * 9, 160, line * 21);
          g.stroke();
        }
        g.fillStyle = '#fff4dd'; g.beginPath();
        g.arc(24 + tile * 7 % 110, 23 + tile * 11 % 53, 6 + tile % 8, 0, Math.PI * 2); g.fill();
        const id = `perf-png-${level}-${tile}`;
        result[id] = { id, name: `${theme.name} texture ${tile + 1}.png`, mime: 'image/png',
          width: 160, height: 100, dataUrl: canvas.toDataURL('image/png') };
      }
    }
    return result;
  }, themes);
  fixture = { version: 1, id: 'perf-swatch-atlas-v1', name: 'Chromatic Field Atlas / performance fixture',
    nodes: [], assets, stops: [], links: [] };
  const observations = [
    'Warm edges meet a cooler center.', 'Fine grain catches the side light.',
    'A pale band breaks the dark field.', 'Small marks gather near the edge.',
    'Soft shadows reveal the texture.', 'A bright seam crosses the surface.',
    'The darker corner feels denser.', 'Light pools beside a muted stripe.',
    'Quiet tones surround a sharp mark.', 'A thin wash leaves the grain clear.',
  ];
  const materials = ['Paper', 'Linen', 'Stone', 'Glass', 'Bark', 'Sand'];
  const add = (type, id, parentId, x, y, w, h, properties = {}) => fixture.nodes.push({
    id, type, parentId, name: id, x, y, w, h, scale: 1, rotation: 0,
    opacity: 1, hidden: false, locked: false, ...properties,
  });
  for (const [level, theme] of themes.entries()) {
    const scene = `perf-scene-${level}`;
    add('scene', scene, level ? `perf-scene-${level - 1}` : null,
      level ? 1104 : 0, level ? 708 : 0, 1200, 780,
      { name: `${theme.name} field`, scale: level ? 0.04 : 1, minZoom: 0.35, clip: true, fill: '#faf7ef' });
    add('text', `${scene}-heading`, scene, 32, 20, 1080, 36,
      { text: `${String(level + 1).padStart(2, '0')} / ${theme.name}: ${theme.subject}`, fontSize: 24,
        fontFamily: 'Georgia, serif', color: '#233c38' });
    for (let tile = 0; tile < 60; tile++) {
      // Eight columns, with the last two rows reserving the right edge for the portal/native minimap.
      const row = tile < 48 ? Math.floor(tile / 8) : 6 + Math.floor((tile - 48) / 6);
      const col = tile < 48 ? tile % 8 : (tile - 48) % 6;
      const x = 32 + col * 142, y = 72 + row * 82, id = `${scene}-tile-${tile}`;
      const hue = (theme.hue + tile * 3) % 360;
      add('rect', `${id}-swatch`, scene, x + 46, y + 7, 82, 10, { fill: `hsl(${hue} 45% ${38 + tile % 25}%)` });
      if (tile < 40) add('image', `${id}-image`, scene, x, y, 38, 24, { assetId: `perf-png-${level}-${tile}`, fit: 'contain' });
      else add('ellipse', `${id}-form`, scene, x, y, 38, 24, { fill: `hsl(${hue + 20} 36% 58%)` });
      const label = `${theme.name} ${String(tile + 1).padStart(2, '0')}. `;
      const body = `${observations[(tile + level) % observations.length]} ${materials[tile % materials.length]} holds light.`;
      add('text', `${id}-caption`, scene, x, y + 28, 132, 51,
        { text: label + body, runs: [{ text: label, bold: true }, { text: body }],
          fontSize: 10.5, fontFamily: 'Arial, sans-serif', color: '#233c38' });
    }
    add('text', `${scene}-footer`, scene, 32, 749, 840, 16,
      { text: `CHROMATIC FIELD ATLAS / ${theme.name.toUpperCase()} / 60 studies of pigment, grain, and light`,
        fontSize: 10, fontFamily: 'Arial, sans-serif', color: '#52645e' });
    if (level < themes.length - 1) {
      add('rect', `${scene}-portal-outline`, scene, 1099, 703, 58, 41,
        { fill: 'none', stroke: '#536c61', strokeWidth: 1 });
      add('text', `${scene}-portal-label`, scene, 906, 708, 180, 38,
        { text: `Look closer: ${themes[level + 1].name}\nA field inside this field.`, fontSize: 12,
          fontFamily: 'Arial, sans-serif', color: '#233c38' });
    }
    fixture.stops.push({ id: `perf-stop-${level}`, targetId: scene,
      title: `Atlas ${level + 1}: ${theme.name} studies`, caption: `Sixty observations of ${theme.subject}.`,
      transition: 0.8, dwell: 1.8, easing: 'smooth', choice: false });
    const tiles = fixture.nodes.filter(node => node.parentId === scene && node.id.includes('-tile-'));
    assert.deepEqual(['text', 'image', 'rect', 'ellipse'].map(type => tiles.filter(node => node.type === type).length), [60, 40, 60, 20]);
    for (const [index, a] of tiles.entries()) {
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= 1200 && a.y + a.h <= 780);
      for (const b of tiles.slice(index + 1)) {
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
          `Authored tile objects overlap: ${a.id}, ${b.id}`);
      }
    }
  }
  const packageBuffer = Buffer.from(JSON.stringify(fixture));
  assert.ok(fixture.nodes.length >= 1200);
  report.fixture = { name: fixture.name, id: fixture.id, totalNodes: fixture.nodes.length,
    types: Object.fromEntries(['scene', 'text', 'image', 'rect', 'ellipse'].map(type => [type, fixture.nodes.filter(node => node.type === type).length])),
    scenes: 7, nestedEdges: 6, nodesPerReadingWorkload: 180, paragraphsPerScene: 60,
    rasterImagesPerScene: 40, shapesPerScene: 80, embeddedUniquePNGs: Object.keys(assets).length,
    rasterDimensions: { width: 160, height: 100 }, paragraphCharacters: fixture.nodes.filter(node => node.id.endsWith('-caption')).reduce((sum, node) => sum + node.text.length, 0),
    localPortalScale: 0.04, perLevelCameraScaleRatio: 25, sceneMinZoom: 0.35,
    transitionSeconds: 0.8, dwellSeconds: 1.8, stops: fixture.stops, choices: 0,
    packageBytes: packageBuffer.length, packageSha256: createHash('sha256').update(packageBuffer).digest('hex'),
    noOverlappingTileBounds: true, noHiddenNodes: fixture.nodes.every(node => !node.hidden && node.opacity === 1) };

  phase = 'UI import and persistence';
  await page.getByRole('button', { name: 'Project options', exact: true }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a project package', exact: true }).click();
  await (await choosing).setFiles({ name: 'chromatic-field-atlas.atlas', mimeType: 'application/json', buffer: packageBuffer });
  await expect(page.getByRole('status')).toContainText('Editable project imported');
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(fixture.name);
  await expect(page.locator('.save-status')).toHaveText('All changes saved locally');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(fixture.name);
  await expect(page.locator('.save-status')).toHaveText('All changes saved locally');
  assert.deepEqual(await exported(), fixture, 'UI export after reload must preserve the complete imported document');
  report.fixture.persistedAndUIExportVerified = true;
  await page.evaluate(() => document.fonts.ready);

  probe = await page.evaluateHandle(selector => {
    let raf, running = false, beginning, last, lastSample, segment;
    let frames = [], samples = [];
    function snapshot(detailed = false) {
      const begin = performance.now(), svg = document.querySelector(selector);
      if (!svg) throw new Error('Main editor canvas disappeared, possibly during HMR');
      const box = svg.getBoundingClientRect();
      const empty = () => ({ total: 0, text: 0, image: 0, shape: 0, scene: 0 });
      const mounted = empty(), inViewport = empty(), details = [];
      for (const el of svg.querySelectorAll('[data-node-id]')) {
        const id = el.dataset.nodeId, text = el.querySelector('.canvas-text'), image = el.querySelector('image');
        const type = text ? 'text' : image ? 'image' : /^perf-scene-\d+$/.test(id) ? 'scene' : 'shape';
        mounted.total++; mounted[type]++;
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        const painted = style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0;
        const intersects = painted && rect.width > 0 && rect.height > 0 && rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom;
        if (intersects) { inViewport.total++; inViewport[type]++; }
        if (detailed) {
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          details.push({ id, type, intersects, fullyInViewport: intersects && rect.left >= box.left - 0.1 && rect.right <= box.right + 0.1 && rect.top >= box.top - 0.1 && rect.bottom <= box.bottom + 0.1,
            centerUnoccluded: hit?.closest('[data-node-id]')?.dataset.nodeId === id,
            text: text?.textContent, textOverflow: text ? text.scrollHeight > el.querySelector('foreignObject').height.baseVal.value + 1 : false,
            embeddedPNG: image ? image.getAttribute('href')?.startsWith('data:image/png;base64,') : undefined });
        }
      }
      const root = svg.querySelector('[data-node-id="perf-scene-0"]');
      if (!root) throw new Error('Fixture root missing from actual canvas DOM');
      // SVGMatrix rounds huge translations; serialized DOM transforms retain deep-zoom precision.
      const matrix = root.getAttribute('transform')?.match(/^matrix\((.+)\)$/)?.[1].trim().split(/[ ,]+/).map(Number);
      if (matrix?.length !== 6 || !matrix.every(Number.isFinite)) throw new Error('Cannot read the actual canvas transform');
      const [a, b, , , e, f] = matrix;
      const scale = Math.hypot(a, b), width = svg.viewBox.baseVal.width, height = svg.viewBox.baseVal.height;
      return { atMs: running ? performance.now() - beginning : null, mounted, inViewport,
        appVisible: Number(svg.getAttribute('data-visible-count')), projectTotal: Number(svg.getAttribute('data-total-count')),
        svg: { width, height, cssWidth: box.width, cssHeight: box.height },
        camera: { scale, x: (width / 2 - e) / scale, y: (height / 2 - f) / scale },
        timelineSeconds: Number(document.querySelector('input[aria-label="Story timeline"]').value),
        selectedStop: document.querySelector('.stop-card.selected')?.getAttribute('aria-label'),
        visibilityState: document.visibilityState,
        usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null,
        observerMs: performance.now() - begin, ...(detailed ? { details } : {}) };
    }
    function tick(now) {
      if (!running) return;
      if (last !== null) frames.push({ atMs: now - beginning, intervalMs: now - last, segment });
      last = now;
      if (now - lastSample >= 200) { samples.push(snapshot()); lastSample = now; }
      raf = requestAnimationFrame(tick);
    }
    return { snapshot,
      start() {
        frames = []; samples = []; segment = 'main'; last = null;
        beginning = performance.now(); lastSample = beginning; running = true;
        samples.push(snapshot()); raf = requestAnimationFrame(tick);
      },
      segment(value) { segment = value; },
      stop() {
        cancelAnimationFrame(raf); samples.push(snapshot()); running = false;
        return { frames, samples, durationMs: performance.now() - beginning };
      },
    };
  }, CANVAS);

  phase = 'seven reading stops';
  for (let level = 0; level < 7; level++) {
    await goStop(level);
    const snapshot = await probe.evaluate(p => p.snapshot(true));
    const intended = fixture.nodes.filter(node => node.parentId === `perf-scene-${level}` && node.id.includes('-tile-'));
    const observed = snapshot.details.filter(node => intended.some(expected => expected.id === node.id));
    const reading = { level, title: fixture.stops[level].title, ...snapshot,
      intendedWorkload: { total: observed.length, text: observed.filter(node => node.type === 'text').length,
        image: observed.filter(node => node.type === 'image').length, shape: observed.filter(node => node.type === 'shape').length,
        fullyInViewport: observed.filter(node => node.fullyInViewport).length,
        centerUnoccluded: observed.filter(node => node.centerUnoccluded).length } };
    report.readings.push(reading);
    assert.equal(snapshot.projectTotal, fixture.nodes.length);
    assert.equal(snapshot.mounted.total, snapshot.appVisible);
    assert.deepEqual(reading.intendedWorkload, { total: 180, text: 60, image: 40, shape: 80, fullyInViewport: 180, centerUnoccluded: 180 },
      `${reading.title}: must show the entire intended workload without covering objects`);
    for (const node of observed) {
      if (node.type === 'text') {
        assert.equal(node.text, intended.find(expected => expected.id === node.id).text);
        assert.equal(node.textOverflow, false, `${node.id}: paragraph overflows its tile`);
      }
      if (node.type === 'image') assert.equal(node.embeddedPNG, true);
    }
    console.log(`READING ${level + 1}: ${snapshot.mounted.total}/${snapshot.projectTotal} DOM nodes, ${snapshot.mounted.text} text, ${snapshot.mounted.image} PNGs; all 180 tile nodes in view and center-unoccluded.`);
  }
  await page.screenshot({ path: SCREENSHOT });
  report.screenshot = SCREENSHOT;
  report.editorViewport = report.readings.at(-1).svg;

  await page.getByRole('button', { name: 'Pan (H or Space)', exact: true }).click();
  const box = await page.locator(CANVAS).boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  const gestures = await measure('pointer pan and wheel zoom', 3000, async () => {
    const inputs = { pointerMoves: 0, wheelEvents: 0, panRequestedMs: 1500, wheelRequestedMs: 1500 };
    await probe.evaluate(p => p.segment('pointer pan'));
    let start = performance.now();
    await page.mouse.down();
    try {
      while (performance.now() - start < 1500) {
        const tick = performance.now(), t = (tick - start) / 1500;
        await page.mouse.move(center.x + Math.sin(t * Math.PI * 4) * 18, center.y + Math.sin(t * Math.PI * 2) * 12);
        inputs.pointerMoves++;
        await delay(Math.max(0, 1000 / 60 - (performance.now() - tick)));
      }
    } finally { await page.mouse.up(); }
    await probe.evaluate(p => p.segment('wheel zoom'));
    start = performance.now();
    let previous = 0;
    while (performance.now() - start < 1500) {
      const tick = performance.now(), t = (tick - start) / 1500;
      const target = Math.sin(t * Math.PI * 4) * 45;
      await page.mouse.wheel(0, target - previous); previous = target;
      inputs.wheelEvents++;
      await delay(Math.max(0, 1000 / 60 - (performance.now() - tick)));
    }
    return inputs;
  });
  assert.ok(gestures.cameraScaleRange.max / gestures.cameraScaleRange.min > 1.05, 'Real wheel events must change the camera scale');
  assert.ok(gestures.cameraXRange.max > gestures.cameraXRange.min, 'Real pointer pan must move the camera');

  phase = 'timeline positioning';
  await goStop(0);
  const slider = page.getByRole('slider', { name: 'Story timeline', exact: true });
  // A real range-track click starts just before the first nested flight, fitting two complete flights in ~4 s.
  const track = await slider.boundingBox(), duration = Number(await slider.getAttribute('max'));
  await page.mouse.click(track.x + 8 + (track.width - 16) * (2.3 / duration), track.y + track.height / 2);
  const playbackStartSeconds = Number(await slider.inputValue());
  assert.ok(playbackStartSeconds >= 2.1 && playbackStartSeconds < 2.6, `Unexpected UI seek: ${playbackStartSeconds}`);
  const playback = await measure('timeline playback', 4000, async () => {
    const start = performance.now();
    await page.getByRole('button', { name: 'Play timeline', exact: true }).click();
    await page.waitForTimeout(Math.max(0, 4000 - (performance.now() - start)));
    await page.getByRole('button', { name: 'Pause timeline', exact: true }).click();
    return { playbackStartSeconds, playbackEndSeconds: Number(await slider.inputValue()),
      playButtonClicks: 1, pauseButtonClicks: 1 };
  });
  assert.ok(playback.inputs.playbackEndSeconds - playbackStartSeconds >= 3.5, 'Timeline did not actually advance');
  assert.ok(playback.cameraScaleRange.max / playback.cameraScaleRange.min > 100, 'Playback did not traverse large nested scale changes');

  phase = 'final persistence verification';
  assert.deepEqual(await exported(), fixture, 'Pan, wheel, and playback must not replace or mutate persistent nodes');
  report.fixture.unchangedAfterMeasurements = true;
  report.heapAtEnd = await heap();
  report.status = report.errors.length ? 'completed-with-browser-errors' : report.hmr.length ? 'completed-with-hmr' : 'completed';
} catch (error) {
  report.status = 'failed';
  report.failure = { phase, message: error.message, stack: error.stack };
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  if (page && !report.screenshot) {
    try { await page.screenshot({ path: SCREENSHOT, timeout: 10000 }); report.screenshot = SCREENSHOT; }
    catch (error) { report.screenshotError = error.message; }
  }
  if (browser) await browser.close().catch(error => { report.browserCloseError = error.message; });
  report.wallTimeMs = performance.now() - started;
  report.completedAt = new Date().toISOString();
  report.mixedBuild = report.hmr.length > 0;
  report.readingRanges = Object.fromEntries(['total', 'text', 'image', 'shape', 'scene'].map(key => [key, range(report.readings.map(reading => reading.mounted[key]))]));
  report.observedHeapRanges = {
    performanceMemoryUsedJSHeapSize: range(report.measurements.flatMap(measurement => measurement.raw.samples.map(sample => sample.usedJSHeapSize))),
    cdpJSHeapUsedSize: range(report.measurements.flatMap(measurement => [measurement.heapBefore.cdp.JSHeapUsedSize, measurement.heapAfter.cdp.JSHeapUsedSize])),
  };
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, hardware: report.hardware, browser: report.browser,
    viewport: VIEWPORT, editorViewport: report.editorViewport, fixture: report.fixture,
    readingRanges: report.readingRanges, heap: report.observedHeapRanges, hmrEvents: report.hmr.length,
    browserErrors: report.errors.length, wallTimeMs: report.wallTimeMs, screenshot: report.screenshot, report: REPORT }, null, 2));
  if (report.hmr.length || report.errors.length) process.exitCode = 1;
}
