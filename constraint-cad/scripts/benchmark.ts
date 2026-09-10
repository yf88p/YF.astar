import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import os from 'node:os';

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5187', '--strictPort'],
  { stdio: 'pipe' },
);
let serverError = '';
server.stderr.on('data', (d) => {
  serverError += String(d);
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ headless: true });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(`Preview server exited: ${serverError}`);
    try {
      ready = (await fetch('http://127.0.0.1:5187')).ok;
    } catch {
      /* Bounded server startup polling. */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Preview did not start within 8 seconds.');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // tsx/esbuild may annotate locally named functions when serializing evaluate callbacks.
  await page.addInitScript('globalThis.__name = (fn) => fn;');
  await page.goto('http://127.0.0.1:5187');
  await page.waitForFunction(() => !!window.__datum);
  const setup = await page.evaluate(async () => {
    const api = window.__datum,
      d = api.performanceSketch(),
      start = performance.now();
    const graph = new Map(d.entities.map((e) => [e.id, new Set<string>()]));
    for (const c of d.constraints)
      if (c.type === 'distance' || c.type === 'coincident') {
        graph.get(c.a.entity)!.add(c.b.entity);
        graph.get(c.b.entity)!.add(c.a.entity);
      }
    const reached = new Set<string>(),
      visit = [d.entities[0].id];
    while (visit.length) {
      const id = visit.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      visit.push(...graph.get(id)!);
    }
    if (reached.size !== 100) throw Error('Workload is not one connected graph.');
    if (!api.load(d)) throw new Error(api.store.lastError?.message);
    const loadMs = performance.now() - start;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    api.fit();
    return {
      entities: d.entities.length,
      constraints: d.constraints.length,
      connectedEntities: reached.size,
      loadMs,
      dof: api.store.result.dof,
    };
  });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  await page.evaluate(() => {
    const state = {
      times: [] as number[],
      failures: 0,
      rejectedDocumentsUnchanged: true,
      position: 0,
      lastCursorErrorMm: 0,
      movedEntities: 0,
      samples: 0,
      frameIntervals: [] as number[],
      recording: true,
      last: 0,
    };
    (window as unknown as { benchmarkState: typeof state }).benchmarkState = state;
    const store = window.__datum.store,
      original = store.drag.bind(store);
    store.drag = (...args) => {
      const previous = store.document;
      const start = performance.now(),
        ok = original(...args);
      state.times.push(performance.now() - start);
      state.samples++;
      if (!ok) {
        state.failures++;
        state.rejectedDocumentsUnchanged &&= previous === store.document;
      }
      const d = store.document;
      const point = (t: { entity: string; point: string }) => {
        const e = d.entities.find((e) => e.id === t.entity)!;
        return e.type === 'line' ? e[t.point as 'a' | 'b'] : e.type === 'circle' ? e.center : e;
      };
      state.lastCursorErrorMm = Math.max(
        0,
        ...args[0].map((goal) => {
          const p = point(goal.target);
          return Math.hypot(p.x - goal.x, p.y - goal.y);
        }),
      );
      for (const c of d.constraints) {
        if (c.type === 'distance' || c.type === 'coincident') {
          const a = point(c.a),
            b = point(c.b);
          state.position = Math.max(
            state.position,
            Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - (c.type === 'distance' ? c.value : 0)),
          );
        }
        if (c.type === 'fixed') {
          const p = point(c.target);
          state.position = Math.max(state.position, Math.hypot(p.x - c.x, p.y - c.y));
        }
      }
      return ok;
    };
    const frame = (time: number) => {
      if (!state.recording) return;
      if (state.last) state.frameIntervals.push(time - state.last);
      state.last = time;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const start = await page.evaluate(() => {
    const d = window.__datum.getDocument(),
      e = d.entities.find((e) => e.id === 'link-25')!,
      v = window.__datum.getView(),
      rect = document.querySelector('.sketch-canvas')!.getBoundingClientRect();
    if (e.type !== 'line') throw Error('Missing chain joint');
    return { x: rect.x + v.x + e.a.x * v.scale, y: rect.y + v.y - e.a.y * v.scale };
  });
  const before = await page.evaluate(() => window.__datum.getDocument());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const wallStart = performance.now();
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(start.x + i * 0.25, start.y + 10 * Math.sin(((i / 60) * Math.PI) / 2));
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  }
  await page.mouse.up();
  const wallMs = performance.now() - wallStart;
  const metrics = await page.evaluate((before) => {
    const s = (
      window as unknown as {
        benchmarkState: {
          times: number[];
          failures: number;
          rejectedDocumentsUnchanged: boolean;
          position: number;
          lastCursorErrorMm: number;
          samples: number;
          frameIntervals: number[];
          recording: boolean;
        };
      }
    ).benchmarkState;
    s.recording = false;
    const quantile = (a: number[], q: number) =>
      [...a].sort((a, b) => a - b)[Math.min(a.length - 1, Math.floor(a.length * q))] ?? 0;
    const d = window.__datum.getDocument(),
      rect = document.querySelector('.sketch-canvas')!.getBoundingClientRect();
    const visible = [...document.querySelectorAll('g[data-entity]')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= rect.left && r.right <= rect.right && r.top >= rect.top && r.bottom <= rect.bottom;
    }).length;
    const displacements = d.entities.map((e, i) => {
      const old = before.entities[i];
      if (e.type === 'line' && old.type === 'line')
        return Math.max(
          Math.hypot(e.a.x - old.a.x, e.a.y - old.a.y),
          Math.hypot(e.b.x - old.b.x, e.b.y - old.b.y),
        );
      if (e.type === 'circle' && old.type === 'circle')
        return Math.hypot(e.center.x - old.center.x, e.center.y - old.center.y);
      return 0;
    });
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      visibleEntities: visible,
      svgGeometryPrimitives: document.querySelectorAll('.geometry').length,
      samples: s.samples,
      rejectedDrags: s.failures,
      rejectedDocumentsUnchanged: s.rejectedDocumentsUnchanged,
      lastCursorErrorMm: s.lastCursorErrorMm,
      solverMedianMs: quantile(s.times, 0.5),
      solverP95Ms: quantile(s.times, 0.95),
      solverMaxMs: Math.max(...s.times),
      independentMaxPositionResidualMm: s.position,
      frameIntervalMedianMs: quantile(s.frameIntervals, 0.5),
      frameIntervalP95Ms: quantile(s.frameIntervals, 0.95),
      movedEntities: displacements.filter((v) => v > 1e-5).length,
      maxDisplacementMm: Math.max(...displacements),
      finalStatus: window.__datum.getResult().status,
      finalDof: window.__datum.getResult().dof,
    };
  }, before);
  const report = {
    date: new Date().toISOString(),
    cpu: os.cpus()[0].model,
    memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(2),
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    browser: await browser.version(),
    viewport: '1440 x 1000',
    headless: true,
    workload:
      '50 endpoint-connected fixed-length line segments, 50 attached circles; 49 endpoint coincidences + 50 center coincidences + 50 lengths + 1 fixed point. All 100 entities in one connected constraint graph.',
    ...setup,
    ...metrics,
    pointerWorkflowWallMs: wallMs,
  };
  console.log(JSON.stringify(report, null, 2));
  if (
    metrics.samples < 10 ||
    metrics.samples - metrics.rejectedDrags < 10 ||
    !metrics.rejectedDocumentsUnchanged ||
    metrics.independentMaxPositionResidualMm > 1e-5 ||
    metrics.visibleEntities !== 100 ||
    metrics.movedEntities < 10
  )
    throw new Error('Connected-workload correctness/visibility check failed.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
