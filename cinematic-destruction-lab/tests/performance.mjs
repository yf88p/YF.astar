import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { REVISION } from 'three';
import { createServer } from 'vite';

// Reproducible visible-canvas benchmark, not a throughput loop around gl.finish().
// PERF_ONLY=storefront permits a shorter before/after material comparison.
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.env.PERF_OUTPUT || '/tmp/opencode/fracture-performance');
const storefrontFrames = Number(process.env.PERF_FRAMES || 120);
assert.ok(Number.isInteger(storefrontFrames) && storefrontFrames >= 10 && storefrontFrames <= 600);
await mkdir(output, { recursive: true });
const reservation = createNetServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = await createServer({
  root, configFile: false, cacheDir: path.join(output, 'vite-cache'),
  server: { host: '127.0.0.1', port, strictPort: true },
  optimizeDeps: { include: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/controls/TransformControls.js', 'three/addons/environments/RoomEnvironment.js', '@dimforge/rapier3d-compat'] },
});
const testPage = `<!doctype html><html><head><title>Fracture viewport performance</title></head>
    <body style="margin:0;background:#171d1b;color:#d9decf;font:14px monospace">
    <main style="width:824px;margin:32px auto"><h1 style="font-size:16px">ACTUAL VIEWPORT / SOFTWARE RENDERING</h1>
    <p id="status">Initializing real geometry and Rapier physics...</p>
    <div id="stage" style="width:824px;height:600px;border:1px solid #394338"></div>
    <p>824 x 600 CSS pixels. No hidden canvas, merged stand-ins, or artificial debris.</p></main></body></html>`;
let browser;
const errors = [];
const report = {
  timestamp: new Date().toISOString(),
  host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, totalMemoryBytes: os.totalmem() },
  browserFlags: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  measurements: {},
};
const sourceFiles = ['src/viewport.js', 'src/core/model.js', 'src/core/geometry.js', 'src/core/simulation.js', 'src/core/replay.js'];
report.sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: report.browserFlags });
  report.browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
  await page.route('**/__performance.html', route => route.fulfill({ contentType: 'text/html', body: testPage }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/__performance.html`);
  report.environment = await page.evaluate(async threeRevision => {
    const { Viewport } = await import('/src/viewport.js');
    const { createProject, createObject, LIMITS } = await import('/src/core/model.js');
    const { Simulation, initPhysics } = await import('/src/core/simulation.js');
    const { Recorder } = await import('/src/core/replay.js');
    await initPhysics();
    Object.assign(window, { Viewport, createProject, createObject, LIMITS, Simulation, Recorder });
    window.viewport = new Viewport(document.getElementById('stage'));
    const gl = viewport.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      webgl: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      contextAttributes: gl.getContextAttributes(), threeRevision,
      devicePixelRatio, rendererPixelRatio: viewport.renderer.getPixelRatio(),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      shadowMapSize: viewport.keyLight.shadow.mapSize.toArray(), shadowType: viewport.renderer.shadowMap.type,
      layers: { ...viewport.layers },
    };
  }, REVISION);

  await page.evaluate(() => {
    window.project = createProject('storefront');
    window.sim = new Simulation(project);
    viewport.setProject(project, sim.fragments);
    viewport.setState(sim.snapshot());
    viewport.setSelection(['pane-1']);
    viewport.resetCamera();
  });
  report.measurements.storefront = await page.evaluate(async frames => {
    const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
    for (let i = 0; i < 20; i++) { await raf(); viewport.render(1 / 60); }
    const renderMs = [], rafMs = [], frameCPU = [];
    let previous = await raf();
    for (let i = 0; i < frames; i++) {
      const time = await raf(); rafMs.push(time - previous); previous = time;
      const start = performance.now(); viewport.render(1 / 60); frameCPU.push(performance.now() - start);
      renderMs.push(viewport.getMetrics().renderMs);
    }
    rafMs.shift(); rafMs.push((await raf()) - previous);
    document.getElementById('status').textContent = `Storefront / ${sim.fragments.length} real fragments / ${sim.components.length} fixed components`;
    const result = { frames, warmupFrames: 20, renderMs, rafMs, frameCPU, metrics: viewport.getMetrics(), stats: sim.snapshot().stats, camera: viewport.captureCamera(0) };
    sim.dispose();
    return result;
  }, storefrontFrames);
  await page.screenshot({ path: path.join(output, 'storefront.png') });
  console.log('Storefront measurement complete.');

  if (process.env.PERF_ONLY !== 'storefront') {
    report.fixture = await page.evaluate(() => {
      window.project = createProject('blank');
      project.name = '300 independent physical fragments / performance fixture';
      for (const material of Object.values(project.materials)) { material.threshold = 1; material.toughness = 0.001; }
      const types = ['glass', 'concrete', 'timber', 'steel', 'glass', 'concrete'];
      for (let i = 0; i < 6; i++) project.objects.push(createObject(types[i], {
        id: `fixture-${i}`, name: `${types[i]} fixture ${i + 1}`, size: [1.5, 2, 0.08], density: 50,
        position: [(i % 3 - 1) * 2, 2.5, (Math.floor(i / 3) - 0.5) * 3], seed: 1800 + i, fixed: false,
      }));
      window.sim = new Simulation(project);
      window.recorder = new Recorder(sim);
      const initialComponents = sim.components.length, releaseStart = performance.now();
      let acceptedImpulses = 0;
      // Public live impulse API, at actual collider COMs, before the first tick.
      // Low calibrated bond strengths make this a repeatable stress fixture;
      // no bond flags, body velocities, transforms, or material masses are patched.
      for (const fragment of sim.fragments) {
        const point = fragment.initialPosition;
        if (sim.applyImpulse(point, [point[0] * 0.08, 1, point[2] * 0.08], fragment.mass * 0.22)) acceptedImpulses++;
      }
      const releaseMs = performance.now() - releaseStart, state = sim.snapshot();
      recorder.capture(state);
      if (state.stats.components !== 300 || new Set(state.fragments.map(fragment => fragment.bodyId)).size !== 300 || state.stats.released !== 300 || sim.fragments.some(fragment => !(fragment.mass > 0))) throw new Error('The fixture did not release 300 independent mass-carrying fragments.');
      viewport.setProject(project, sim.fragments);
      viewport.setSelection([]); viewport.setEnabled(false); viewport.setState(state);
      viewport.resetCamera();
      viewport.controls.target.set(0, 1, 0);
      viewport.camera.position.set(8, 6, 10);
      viewport.camera.lookAt(viewport.controls.target);
      viewport.render();
      document.getElementById('status').textContent = '0.000 s / 300 released fragments / 300 independent bodies / 300 active / 0 sleeping';
      window.fixtureProjectJSON = JSON.stringify(project);
      return { objects: project.objects, materials: project.materials, settings: project.settings, dt: LIMITS.dt, initialComponents, acceptedImpulses, impulseRule: 'J = fragment.mass * 0.22 N s; direction normalized from [0.08*x, 1, 0.08*z]; contact point = initial COM', releaseMs, initialStats: state.stats, uniqueBodyIds: new Set(state.fragments.map(fragment => fragment.bodyId)).size };
    });
    await page.screenshot({ path: path.join(output, 'released-300.png') });
    report.measurements.live300 = await page.evaluate(async () => {
      const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
      for (let i = 0; i < 20; i++) { await raf(); viewport.render(1 / 60); }
      const renderMs = [], rafMs = [], frameCPU = [], physicsMs = [], captureMs = [], stateMs = [], counts = [];
      let previous = await raf();
      for (let frame = 0; frame < 120; frame++) {
        const time = await raf(); rafMs.push(time - previous); previous = time;
        const start = performance.now(); let state;
        for (let tick = 0; tick < 2; tick++) {
          let then = performance.now(); state = sim.step(); physicsMs.push(performance.now() - then);
          then = performance.now(); recorder.capture(state); captureMs.push(performance.now() - then);
        }
        const then = performance.now(); viewport.setState(state); stateMs.push(performance.now() - then);
        viewport.render(1 / 60);
        renderMs.push(viewport.getMetrics().renderMs); frameCPU.push(performance.now() - start);
        const visible = [...viewport.meshes.values()].filter(mesh => mesh.visible);
        const inFrustum = visible.filter(mesh => { const point = mesh.position.clone().project(viewport.camera); return Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1; }).length;
        const independent = new Set(state.fragments.map(fragment => fragment.bodyId)).size;
        if (visible.length !== 300 || inFrustum !== 300 || independent !== 300 || state.stats.components !== 300 || state.stats.released !== 300) throw new Error(`A frame stopped showing all 300 independent fragments: ${inFrustum} centers in frustum at ${state.time}s.`);
        for (const fragment of state.fragments) {
          const mesh = viewport.meshes.get(fragment.id);
          if (mesh.position.toArray().some((value, i) => value !== fragment.position[i]) || mesh.quaternion.toArray().some((value, i) => value !== fragment.rotation[i])) throw new Error('A rendered pose differs from its physical snapshot.');
        }
        counts.push({ time: state.time, visible: visible.length, inFrustum, independent, active: state.stats.active, sleeping: state.stats.sleeping, released: state.stats.released, components: state.stats.components });
        document.getElementById('status').textContent = `${state.time.toFixed(3)} s / ${visible.length} visible / ${independent} independent bodies / ${state.stats.active} active / ${state.stats.sleeping} sleeping`;
      }
      rafMs.shift(); rafMs.push((await raf()) - previous);
      if (JSON.stringify(project) !== fixtureProjectJSON) throw new Error('The renderer or camera mutated the project.');
      const json = JSON.stringify(recorder.serialize(project, viewport.cameras));
      return { frames: 120, warmupFrames: 20, ticks: sim.tick, physicalDuration: recorder.duration, recordedFrames: recorder.frames.length, recorderJSONBytes: new TextEncoder().encode(json).length, renderMs, rafMs, frameCPU, physicsMs, captureMs, stateMs, counts, finalStats: sim.snapshot().stats, metrics: viewport.getMetrics(), camera: viewport.captureCamera(2), poseAssertions: 'Every fragment position and quaternion checked against every displayed snapshot.' };
    });
    await page.screenshot({ path: path.join(output, 'live-300-final.png') });
    // Isolate render/replay from contact solving while showing the SAME recorded
    // 300-body scene. Scrubbing goes backward, exposing stale-visibility bugs too.
    report.measurements.replay300 = await page.evaluate(async () => {
      const renderMs = [], rafMs = [], frameCPU = [], sampleMs = [], stateMs = [];
      const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
      for (let i = 0; i < 12; i++) { await raf(); viewport.render(1 / 60); }
      let previous = await raf();
      for (let frame = 0; frame < 120; frame++) {
        const time = await raf(); rafMs.push(time - previous); previous = time;
        const start = performance.now(), physicalTime = (119 - frame) / 60;
        const state = recorder.sample(physicalTime); sampleMs.push(performance.now() - start);
        const then = performance.now(); viewport.setState(state); stateMs.push(performance.now() - then);
        viewport.render(1 / 60); renderMs.push(viewport.getMetrics().renderMs); frameCPU.push(performance.now() - start);
      }
      rafMs.shift(); rafMs.push((await raf()) - previous);
      sim.dispose();
      return { frames: 120, warmupFrames: 12, renderMs, rafMs, frameCPU, sampleMs, stateMs, metrics: viewport.getMetrics() };
    });
  }

  function summarize(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
    return { samples: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p50: percentile(0.5), p90: percentile(0.9), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) };
  }
  for (const measurement of Object.values(report.measurements)) {
    measurement.summary = {};
    for (const key of ['renderMs', 'rafMs', 'frameCPU', 'physicsMs', 'captureMs', 'stateMs', 'sampleMs']) if (measurement[key]) measurement.summary[key] = summarize(measurement[key]);
    measurement.meanRAFfps = 1000 / measurement.summary.rafMs.mean;
    if (measurement.counts) measurement.countRanges = Object.fromEntries(['visible', 'inFrustum', 'independent', 'active', 'sleeping', 'released', 'components'].map(key => [key, { min: Math.min(...measurement.counts.map(frame => frame[key])), max: Math.max(...measurement.counts.map(frame => frame[key])) }]));
  }
  assert.deepEqual(errors, [], 'Browser reported errors.');
  for (const file of sourceFiles) assert.equal(createHash('sha256').update(await readFile(path.join(root, file))).digest('hex'), report.sourceHashes[file], `${file} changed during measurement; rerun to produce a consistent report.`);
  await page.evaluate(() => viewport.dispose());
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, browserVersion: report.browserVersion, environment: report.environment, measurements: Object.fromEntries(Object.entries(report.measurements).map(([name, value]) => [name, { meanRAFfps: value.meanRAFfps, summary: value.summary, metrics: value.metrics, recorderJSONBytes: value.recorderJSONBytes, finalStats: value.finalStats, countRanges: value.countRanges }])) }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
