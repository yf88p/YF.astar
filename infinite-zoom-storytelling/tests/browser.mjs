import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import JSZip from 'jszip';

// Run against npm run preview -- --port 5199 --strictPort.
// Only UI actions change the app. evaluate() reads DOM/storage, except for drawing
// the explicitly synthetic PNG fixture on a detached browser canvas.
const BASE_URL = process.env.BASE_URL || 'http://localhost:5199';
await mkdir('/tmp/opencode', { recursive: true });
const output = await mkdtemp('/tmp/opencode/folia-browser-');
const browser = await chromium.launch({ headless: true });
const expect = playwrightExpect.configure({ timeout: 7000 });

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

// Independent geometry oracle over files downloaded through the UI, not app code.
function world(doc, id) {
  if (id == null) return [1, 0, 0, 1, 0, 0];
  const n = doc.nodes.find(n => n.id === id);
  assert.ok(n, `Missing geometry node ${id}`);
  const angle = n.rotation * Math.PI / 180;
  const c = Math.cos(angle) * n.scale, s = Math.sin(angle) * n.scale;
  return multiply(world(doc, n.parentId), [c, s, -s, c, n.x, n.y]);
}

function bounds(doc, id) {
  const n = doc.nodes.find(n => n.id === id), m = world(doc, id);
  return { x: m[4] + m[0] * n.w / 2 + m[2] * n.h / 2,
    y: m[5] + m[1] * n.w / 2 + m[3] * n.h / 2,
    w: Math.abs(m[0]) * n.w + Math.abs(m[2]) * n.h,
    h: Math.abs(m[1]) * n.w + Math.abs(m[3]) * n.h };
}

function near(actual, expected, tolerance = 1e-8, label = 'value') {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`);
}

function preserved(before, after) {
  for (const n of before.nodes) {
    const next = after.nodes.find(item => item.id === n.id);
    assert.ok(next, `Grouping/reparenting removed ${n.id}`);
    assert.equal(next.w, n.w);
    assert.equal(next.h, n.h);
    world(before, n.id).forEach((v, i) => near(world(after, n.id)[i], v,
      Math.max(1e-9, Math.abs(v) * 1e-11), `${n.id} world matrix[${i}]`));
  }
}

async function attempt(number) {
  const directory = path.join(output, `attempt-${number}`);
  await mkdir(directory);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 },
    acceptDownloads: true, reducedMotion: 'reduce' });
  const errors = [], hmr = [], results = [], requests = [];
  let server, viewer, page = await context.newPage(), currentPage = page;
  let doc, initial, roomId, noteId, shapeId, groupId, customStopId, rasterUrl, backup;
  let fileNumber = 0;
  const paragraph = 'Browser field notes: fungi, roots, and sunlight share this forest.\nThis paragraph was edited through the inspector and saved on blur.';
  const note = 'A nested browser field note.\nWorld position survives grouping and reparenting.';

  function watch(p, label) {
    p.setDefaultTimeout(9000);
    p.on('pageerror', error => errors.push({ page: label, kind: 'pageerror', message: error.message }));
    p.on('console', message => {
      if (message.type() === 'error') errors.push({ page: label, kind: 'console', message: message.text() });
    });
    p.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (['update', 'full-reload'].includes(message.type)) hmr.push({ page: label, message });
      } catch { /* Non-Vite websocket traffic is irrelevant to HMR detection. */ }
    }));
  }
  watch(page, 'editor');

  async function screenshot(name, p = currentPage) {
    const filename = `/tmp/opencode/folia-browser-${path.basename(output)}-${number}-${name}.png`;
    await p.screenshot({ path: filename, fullPage: true });
    return filename;
  }

  async function check(name, run) {
    const started = Date.now();
    console.log(`CHECK ${results.length + 1}: ${name}`);
    try {
      await run();
      results.push({ name, status: 'passed', ms: Date.now() - started });
      console.log(`PASS: ${name}`);
    } catch (error) {
      const image = await screenshot(`failure-${results.length + 1}`).catch(() => null);
      const text = await currentPage.locator('body').innerText().catch(() => 'Page unavailable');
      await writeFile(path.join(directory, `failure-${results.length + 1}.txt`), `${error.stack}\n\n${text}`);
      results.push({ name, status: 'failed', ms: Date.now() - started, error: error.stack, screenshot: image });
      console.error(`FAIL: ${name}\n${error.message}\nScreenshot: ${image}`);
      // Close only UI overlays, allowing independent later checks to run after a failure.
      for (const p of [page, viewer].filter(Boolean)) {
        if (await p.getByRole('button', { name: 'Close dialog', exact: true }).isVisible()) {
          await p.getByRole('button', { name: 'Close dialog', exact: true }).click();
        }
      }
    }
  }

  const button = name => page.getByRole('button', { name, exact: true });
  const canvas = p => p.locator('.canvas-stage > svg.spatial-canvas, .fv-stage > svg.spatial-canvas');
  const canvasNode = (id, p = page) => canvas(p).locator(`[data-node-id="${id}"]`);

  async function closeDialog() {
    if (await button('Close dialog').isVisible()) await button('Close dialog').click();
  }

  async function download(trigger, extension) {
    const [file] = await Promise.all([page.waitForEvent('download', { timeout: 45000 }), trigger()]);
    assert.equal(await file.failure(), null);
    assert.ok(file.suggestedFilename().endsWith(extension), file.suggestedFilename());
    const filename = path.join(directory, `${++fileNumber}-${file.suggestedFilename()}`);
    await file.saveAs(filename);
    return filename;
  }

  async function exported(label) {
    await closeDialog();
    await button('Project options').click();
    const filename = await download(() => button('Export editable project').click(), '.atlas');
    await closeDialog();
    doc = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(doc.version, 1, `${label}: export format`);
    return { doc, filename };
  }

  async function importPackage(file) {
    await closeDialog();
    await button('Project options').click();
    const [choosing] = await Promise.all([page.waitForEvent('filechooser'), button('Import a project package').click()]);
    await choosing.setFiles(file);
  }

  async function saved() {
    await expect(page.locator('.save-status')).toHaveText('All changes saved locally');
  }

  async function stored() {
    await saved();
    return page.evaluate(async () => {
      const names = await indexedDB.databases();
      if (!names.some(item => item.name === 'atlas-projects')) throw new Error('No saved project database');
      return new Promise((resolve, reject) => {
        const open = indexedDB.open('atlas-projects');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction('projects', 'readonly');
          const request = transaction.objectStore('projects').getAll();
          request.onerror = () => reject(request.error);
          transaction.oncomplete = () => { db.close(); resolve(request.result); };
          transaction.onabort = () => { db.close(); reject(transaction.error); };
        };
      });
    });
  }

  async function field(label, value) {
    const input = page.getByRole(typeof value === 'number' ? 'spinbutton' : 'textbox', { name: label, exact: true });
    await input.fill(String(value));
    await input.press('Tab');
    await expect(input).toHaveValue(String(value));
  }

  async function selectNode(id) {
    const node = doc.nodes.find(n => n.id === id);
    assert.ok(node, `Node ${id} was not created`);
    await button('Layers').click();
    await page.locator('.layer-nav').getByRole('button', { name: 'Canvas', exact: true }).click();
    const ancestors = [];
    for (let n = node; n.parentId; n = doc.nodes.find(item => item.id === n.parentId)) {
      ancestors.unshift(doc.nodes.find(item => item.id === n.parentId));
    }
    for (const ancestor of ancestors) {
      await page.locator('.layer-list').getByRole('button', { name: ancestor.name, exact: true }).dblclick();
    }
    await page.locator('.layer-list').getByRole('button', { name: node.name, exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(node.name);
  }

  async function goStop(id) {
    const index = doc.stops.findIndex(s => s.id === id);
    assert.ok(index >= 0, `Missing story stop ${id}`);
    await page.getByRole('button', { name: /^Story path/ }).click();
    await button(`Stop ${index + 1}: ${doc.stops[index].title}`).click();
    await expect(page.getByLabel('Stop name', { exact: true })).toHaveValue(doc.stops[index].title);
  }

  async function camera(p = page, project = doc) {
    const observed = await canvas(p).evaluate(svg => {
      const el = svg.querySelector('[data-node-id]');
      if (!el) throw new Error('No rendered node from which to measure the camera');
      return { id: el.dataset.nodeId, m: el.getAttribute('transform').slice(7, -1).split(/[ ,]+/).map(Number),
        width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height };
    });
    const m = world(project, observed.id);
    const scale = Math.hypot(observed.m[0], observed.m[1]) / Math.hypot(m[0], m[1]);
    const result = { x: m[4] + (observed.width / 2 - observed.m[4]) / scale,
      y: m[5] + (observed.height / 2 - observed.m[5]) / scale, scale,
      width: observed.width, height: observed.height };
    assert.ok(Object.values(result).every(Number.isFinite), 'Camera contains non-finite values');
    return result;
  }

  async function framed(id, p = page, padding = 70, project = doc) {
    const b = bounds(project, id);
    await expect.poll(async () => {
      const c = await camera(p, project);
      const scale = Math.min((c.width - padding * 2) / b.w, (c.height - padding * 2) / b.h);
      return Math.max(Math.abs(c.x - b.x) * scale, Math.abs(c.y - b.y) * scale,
        Math.abs(c.scale / scale - 1) * 1000);
    }, { message: `Camera should frame ${id} at its current world position` }).toBeLessThan(0.06);
  }

  async function drag(p, x, y, dx, dy) {
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x + dx, y + dy, { steps: 10 });
    await p.mouse.up();
  }

  async function addObject(tool, name, fields) {
    await button(tool).click();
    const box = await canvas(page).boundingBox();
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await field('Name', name);
    for (const [label, value] of Object.entries(fields)) await field(label, value);
    await exported(`create ${name}`);
    const matches = doc.nodes.filter(n => n.name === name);
    assert.equal(matches.length, 1);
    return matches[0].id;
  }

  async function viewerStop(id) {
    const index = doc.stops.findIndex(s => s.id === id);
    assert.ok(index >= 0);
    await viewer.getByRole('button', { name: 'Restart story', exact: true }).click();
    for (let i = 0; i < index; i++) await viewer.keyboard.press('ArrowRight');
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(doc.stops[index].title);
    await framed(doc.stops[index].targetId, viewer, 70);
  }

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await check('Initial authored illustration, hierarchy, and exactly 12 stops', async () => {
      await saved();
      await expect(page.getByRole('button', { name: /^Stop \d+:/ })).toHaveCount(12);
      initial = (await exported('initial')).doc;
      assert.equal(initial.stops.length, 12);
      assert.equal(initial.nodes.filter(n => n.type === 'scene').length, 9);
      assert.ok(initial.nodes.length > 500, 'The illustration should contain editable pieces, not a flattened mock');
      for (const id of ['forest', 'cabin-roof', 'mushroom-hero-cap', 'spruce-tower-crown', 'field-image']) {
        await expect(canvasNode(id)).toBeVisible();
      }
      await expect(canvasNode('forest-description')).toContainText('Nothing here grows entirely alone.');
      assert.equal(initial.nodes.find(n => n.id === 'memory').parentId, 'nucleus');
      assert.ok(Math.hypot(...world(initial, 'memory').slice(0, 2)) < 1e-6);
      const image = await canvasNode('field-image').locator('image').getAttribute('href');
      assert.equal(image, initial.assets[initial.nodes.find(n => n.id === 'field-image').assetId].dataUrl);
      await screenshot('initial');
    });

    await check('Paragraph editing saves on blur and renders the exact replacement text', async () => {
      await selectNode('forest-description');
      await field('Text content', paragraph);
      await expect(canvasNode('forest-description').locator('.canvas-text')).toHaveText(paragraph);
      await exported('edited paragraph');
      const node = doc.nodes.find(n => n.id === 'forest-description');
      assert.equal(node.text, paragraph);
      assert.equal(node.runs.map(r => r.text).join(''), paragraph);
      assert.equal(node.parentId, 'forest');
      await saved();
    });

    await check('Replace image using the real file chooser and a canvas-generated PNG', async () => {
      rasterUrl = await page.evaluate(() => {
        const fixture = document.createElement('canvas');
        fixture.width = 96; fixture.height = 64;
        const g = fixture.getContext('2d');
        g.fillStyle = '#126b4d'; g.fillRect(0, 0, 96, 64);
        g.fillStyle = '#ed8844'; g.fillRect(48, 0, 48, 64);
        g.fillStyle = '#fff4df'; g.fillRect(8, 8, 16, 16);
        return fixture.toDataURL('image/png');
      });
      const fixturePath = path.join(directory, 'field-fixture.png');
      await writeFile(fixturePath, Buffer.from(rasterUrl.split(',')[1], 'base64'));
      const before = doc.nodes.find(n => n.id === 'field-image');
      await selectNode('field-image');
      const choosing = page.waitForEvent('filechooser');
      await button('Replace image').click();
      await (await choosing).setFiles(fixturePath);
      await expect(page.getByRole('status')).toContainText('Original image preserved.');
      await expect(canvasNode('field-image').locator('image')).toHaveAttribute('href', rasterUrl);
      const decoded = await page.getByRole('img', { name: 'Selected asset' }).evaluate(async img => {
        await img.decode();
        return [img.naturalWidth, img.naturalHeight];
      });
      assert.deepEqual(decoded, [96, 64]);
      await exported('replaced raster');
      const after = doc.nodes.find(n => n.id === 'field-image'), asset = doc.assets[after.assetId];
      assert.notEqual(after.assetId, before.assetId);
      for (const key of ['id', 'parentId', 'x', 'y', 'w', 'h', 'scale', 'rotation']) assert.equal(after[key], before[key]);
      assert.deepEqual([asset.mime, asset.width, asset.height, asset.dataUrl], ['image/png', 96, 64, rasterUrl]);
    });

    await check('Moving a nested scene moves descendants and targeted stop cameras follow', async () => {
      const before = doc, old = before.nodes.find(n => n.id === 'mushroom');
      const oldDeep = bounds(before, 'memory');
      await selectNode('mushroom');
      await field('X', old.x + 24);
      await field('Y', old.y - 12);
      await exported('moved mushroom');
      const nextDeep = bounds(doc, 'memory');
      near(nextDeep.x - oldDeep.x, 24);
      near(nextDeep.y - oldDeep.y, -12);
      assert.deepEqual(doc.nodes.find(n => n.id === 'memory'), before.nodes.find(n => n.id === 'memory'));
      for (const [stopId, target] of [['stop-mushroom', 'mushroom'], ['stop-memory', 'memory']]) {
        await goStop(stopId);
        await framed(target);
      }
      await expect(canvasNode('memory-body')).toContainText('Memory here is a metaphor.');
      assert.ok((await camera()).scale > 1e6, 'Deep target must actually zoom through the hierarchy');
    });

    await check('Add a rotated nested scene with editable text and a shape through canvas tools', async () => {
      await goStop('stop-mushroom');
      roomId = await addObject('Nested scene', 'Browser nested scene', {
        X: 75, Y: 440, Width: 300, Height: 180, Scale: 0.5, Rotation: 12,
      });
      assert.equal(doc.nodes.find(n => n.id === roomId).parentId, 'mushroom');
      await button('Enter scene').click();
      noteId = await addObject('Text (T)', 'Browser nested paragraph', {
        X: 20, Y: 20, Width: 245, Height: 70, 'Font size': 14, 'Text content': note,
      });
      shapeId = await addObject('Rectangle (R)', 'Browser nested marker', {
        X: 35, Y: 115, Width: 70, Height: 40, Scale: 0.8, Rotation: 15,
      });
      assert.equal(doc.nodes.find(n => n.id === noteId).parentId, roomId);
      assert.equal(doc.nodes.find(n => n.id === shapeId).parentId, roomId);
      await expect(canvasNode(noteId)).toHaveText(note);
      await expect(canvasNode(shapeId)).toBeVisible();
      assert.ok(Math.abs(world(doc, shapeId)[1]) > 0.001, 'Nested rotations must compose');
    });

    await check('Create, reorder, and edit story-stop timing and caption', async () => {
      assert.ok(roomId, 'Nested scene prerequisite');
      await goStop('stop-mushroom');
      await selectNode(roomId);
      await button('Frame as story stop').click();
      await field('Stop name', 'Browser authored stop');
      await field('Story caption', 'A new authored stop, attached to the nested field room.');
      await field('Transition (s)', 1.25);
      await field('Pause (s)', 2.75);
      await page.getByRole('combobox', { name: 'Movement', exact: true }).selectOption('linear');
      await exported('new timed stop');
      const created = doc.stops.find(s => s.title === 'Browser authored stop');
      customStopId = created.id;
      assert.equal(doc.stops.length, 13);
      assert.deepEqual([created.targetId, created.transition, created.dwell, created.easing], [roomId, 1.25, 2.75, 'linear']);
      const before = doc.stops.map(s => s.id), index = before.indexOf(customStopId);
      await button('Move stop later').click();
      await exported('reordered stop');
      const expected = [...before]; expected.splice(index + 1, 0, expected.splice(index, 1)[0]);
      assert.deepEqual(doc.stops.map(s => s.id), expected);
      await expect(page.getByRole('button', { name: /^Story path/ })).toContainText('13');
      near(Number(await page.getByRole('slider', { name: 'Story timeline' }).getAttribute('max')),
        doc.stops.reduce((t, s) => t + s.transition + s.dwell, 0));
      await goStop(customStopId);
      await framed(roomId);
    });

    await check('Add a branch hotspot and select an actual destination stop', async () => {
      const before = doc.links;
      await selectNode(noteId);
      await button('Make interactive').click();
      await field('Accessible label', 'Browser route to the roots');
      await page.getByRole('combobox', { name: 'Go to story stop', exact: true }).selectOption('stop-roots');
      await exported('branch destination');
      const link = doc.links.find(l => l.sourceId === noteId);
      assert.equal(doc.links.length, before.length + 1);
      assert.equal(link.label, 'Browser route to the roots');
      assert.equal(link.targetStopId, 'stop-roots');
      for (const original of before) assert.deepEqual(doc.links.find(l => l.id === original.id), original);
    });

    await check('Repeated timeline seeking is deterministic at five separated times', async () => {
      await exported('before timeline seeking');
      await goStop('stop-overview');
      const slider = page.getByRole('slider', { name: 'Story timeline' });
      const samples = new Map();
      for (const tick of [0, 2, 5, 8, 10, 8, 0, 10, 2, 5]) {
        await slider.focus();
        await slider.press('Home');
        for (let i = 0; i < tick; i++) await slider.press('PageUp');
        const t = Number(await slider.inputValue());
        const c = await camera();
        const visible = await canvas(page).locator('[data-node-id]').evaluateAll(nodes => nodes.map(n => n.dataset.nodeId));
        const selected = await page.locator('.stop-card.selected').getAttribute('aria-label');
        const total = doc.stops.reduce((v, s) => v + s.transition + s.dwell, 0);
        near(t, total * tick / 10, 0.06, 'Range keyboard seek');
        let start = 0, index = 0;
        while (index < doc.stops.length - 1 && t >= start + doc.stops[index].transition + doc.stops[index].dwell) {
          start += doc.stops[index].transition + doc.stops[index].dwell; index++;
        }
        assert.equal(selected, `Stop ${index + 1}: ${doc.stops[index].title}`);
        if (t >= start + doc.stops[index].transition) await framed(doc.stops[index].targetId, page, 70);
        const value = { t, c, visible, selected };
        if (samples.has(tick)) assert.deepEqual(value, samples.get(tick), `Seek ${tick * 10}% depends on navigation history`);
        else samples.set(tick, value);
      }
      assert.equal(new Set([...samples.values()].map(s => s.t)).size, 5);
      assert.ok(Math.max(...[...samples.values()].map(s => s.c.scale)) > 1000);
      await writeFile(path.join(directory, 'timeline-samples.json'), JSON.stringify([...samples], null, 2));
    });

    await check('Pointer pan, anchored wheel zoom, object drag, and one-step undo/redo', async () => {
      await goStop('stop-overview');
      const stage = await canvas(page).boundingBox();
      await button('Pan (H or Space)').click();
      const beforePan = await camera();
      await drag(page, stage.x + 100, stage.y + 100, 70, 35);
      const panned = await camera();
      near(panned.x, beforePan.x - 70 / beforePan.scale, 1e-7, 'Pan camera X');
      near(panned.y, beforePan.y - 35 / beforePan.scale, 1e-7, 'Pan camera Y');
      near(panned.scale, beforePan.scale);
      const point = { x: stage.width * 0.35, y: stage.height * 0.45 };
      await page.mouse.move(stage.x + point.x, stage.y + point.y);
      await page.mouse.wheel(0, -180);
      await expect.poll(async () => (await camera()).scale).toBeGreaterThan(panned.scale * 1.2);
      const zoomed = await camera();
      near(panned.x + (point.x - panned.width / 2) / panned.scale,
        zoomed.x + (point.x - zoomed.width / 2) / zoomed.scale, 0.1, 'Wheel anchor X');
      near(panned.y + (point.y - panned.height / 2) / panned.scale,
        zoomed.y + (point.y - zoomed.height / 2) / zoomed.scale, 0.1, 'Wheel anchor Y');
      await button('Select (V)').click();
      if (await button('Snap on').isVisible()) await button('Snap on').click();
      await goStop('stop-overview');
      await selectNode('field-image');
      const before = (await exported('before drag')).doc;
      const history = Number(await page.locator('.app-shell').getAttribute('data-history-version'));
      const c = await camera(), image = await canvasNode('field-image').boundingBox();
      await drag(page, image.x + image.width / 2, image.y + image.height / 2, 52, -27);
      const moved = (await exported('after drag')).doc;
      const old = before.nodes.find(n => n.id === 'field-image'), next = moved.nodes.find(n => n.id === 'field-image');
      near(next.x - old.x, 52 / c.scale, 1e-6, 'Object drag X');
      near(next.y - old.y, -27 / c.scale, 1e-6, 'Object drag Y');
      assert.equal(Number(await page.locator('.app-shell').getAttribute('data-history-version')), history + 1);
      await button('Undo (Ctrl+Z)').click();
      assert.deepEqual((await exported('undo single drag')).doc, before);
      await button('Redo (Ctrl+Shift+Z)').click();
      assert.deepEqual((await exported('redo single drag')).doc, moved);
    });

    await check('Group and reparent preserve every object world matrix in UI exports', async () => {
      const before = (await exported('before grouping')).doc;
      await selectNode(noteId);
      await page.locator('.layer-list').getByRole('button', { name: doc.nodes.find(n => n.id === shapeId).name, exact: true }).click({ modifiers: ['Shift'] });
      await expect(page.locator('.object-title h2')).toHaveText('2 objects');
      await button('Group selection (Ctrl+G)').click();
      await exported('after grouping');
      const group = doc.nodes.find(n => n.type === 'group' && !before.nodes.some(old => old.id === n.id));
      assert.ok(group, 'A real group should be inserted');
      groupId = group.id;
      assert.equal(group.parentId, roomId);
      for (const id of [noteId, shapeId]) assert.equal(doc.nodes.find(n => n.id === id).parentId, groupId);
      preserved(before, doc);
      const grouped = doc;
      await page.getByRole('combobox', { name: 'Parent / preserve position', exact: true }).selectOption('mushroom');
      await exported('after reparenting');
      assert.equal(doc.nodes.find(n => n.id === groupId).parentId, 'mushroom');
      assert.notEqual(doc.nodes.find(n => n.id === groupId).scale, group.scale);
      preserved(grouped, doc);
      await goStop(customStopId);
      await expect(canvasNode(noteId)).toHaveText(note);
      await screenshot('hierarchy');
    });

    await check('Delete a targeted object, expose unresolved stop, and repair it through the UI', async () => {
      await goStop('stop-canopy-detail');
      await selectNode('canopy-detail');
      await button('Delete object').click();
      await exported('deleted target');
      assert.ok(!doc.nodes.some(n => n.id === 'canopy-detail'));
      assert.equal(doc.stops.find(s => s.id === 'stop-canopy-detail').targetId, 'canopy-detail');
      const c = await camera();
      await goStop('stop-canopy-detail');
      await expect(page.locator('.stop-card.selected')).toContainText('Missing target');
      assert.deepEqual(await camera(), c, 'Missing target should not redirect the camera');
      await button('Publish').click();
      await expect(button('Download viewer ZIP')).toBeDisabled();
      await closeDialog();
      await page.getByRole('combobox', { name: 'Repair target', exact: true }).selectOption('canopy-body');
      await exported('repaired target');
      assert.equal(doc.stops.find(s => s.id === 'stop-canopy-detail').targetId, 'canopy-body');
      await goStop('stop-canopy-detail');
      await framed('canopy-body');
      await expect(page.locator('.stop-card.unresolved')).toHaveCount(0);
      assert.ok(doc.links.some(l => l.targetStopId === 'stop-canopy-detail'), 'Incoming branch destinations must survive repair');
    });

    await check('Editable export/import round trip and atomic rejection of invalid packages', async () => {
      backup = await exported('editable backup');
      const before = backup.doc, databaseBefore = await stored();
      const brokenParent = structuredClone(before);
      brokenParent.name = 'MUST NOT BE IMPORTED';
      brokenParent.nodes[1].parentId = 'missing-browser-parent';
      for (const [name, contents, message] of [
        ['unsupported.atlas', JSON.stringify({ ...before, version: 999, name: 'MUST NOT BE IMPORTED' }), 'Unsupported project version'],
        ['malformed.atlas', '{"version":1,"name":"MUST NOT BE IMPORTED","nodes":[', 'does not contain valid JSON'],
        ['bad-hierarchy.atlas', JSON.stringify(brokenParent), 'missing parent'],
      ]) {
        await importPackage({ name, mimeType: 'application/json', buffer: Buffer.from(contents) });
        await expect(page.getByRole('status')).toContainText(message);
        assert.deepEqual((await exported(`after rejecting ${name}`)).doc, before, `${name} partially changed the current document`);
        assert.deepEqual(await stored(), databaseBefore, `${name} partially changed persisted projects`);
      }
      await field('Project name', 'Temporary name to prove import replaces the document');
      await importPackage(backup.filename);
      await expect(page.getByRole('status')).toContainText('Editable project imported');
      assert.deepEqual((await exported('round-tripped editable project')).doc, before);
    });

    await check('Reload persists hierarchy/assets/text; blank project and its first stop work', async () => {
      backup = await exported('before reload');
      const before = backup.doc;
      await saved();
      await page.reload({ waitUntil: 'networkidle' });
      await saved();
      assert.deepEqual((await exported('after reload')).doc, before);
      const storedProject = (await stored()).find(p => p.id === before.id);
      assert.equal(storedProject.nodes.find(n => n.id === noteId).parentId, groupId);
      assert.equal(storedProject.nodes.find(n => n.id === groupId).parentId, 'mushroom');
      assert.equal(storedProject.nodes.find(n => n.id === 'forest-description').text, paragraph);
      assert.equal(storedProject.assets[storedProject.nodes.find(n => n.id === 'field-image').assetId].dataUrl, rasterUrl);
      await goStop('stop-overview');
      await expect(canvasNode('forest-description')).toHaveText(paragraph);
      await expect(canvasNode('field-image').locator('image')).toHaveAttribute('href', rasterUrl);
      await button('Open project browser').click();
      await page.getByRole('button', { name: /Start from a blank canvas/ }).click();
      await expect(page.getByRole('button', { name: /^Story path/ })).toHaveText('Story path 0');
      await expect(canvas(page)).toHaveAttribute('data-total-count', '0');
      await page.getByRole('button', { name: /^Present/ }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every story starts somewhere.');
      await expect(page.getByRole('button', { name: 'Next chapter', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Play story', exact: true })).toBeDisabled();
      await button('Explore').click();
      await expect(button('Explore')).toHaveAttribute('aria-pressed', 'true');
      await screenshot('blank-viewer');
      await button('Exit viewer').click();
      const blankRoom = await addObject('Nested scene', 'First blank scene', { X: -150, Y: -100, Width: 300, Height: 200 });
      assert.equal(doc.nodes.length, 1);
      assert.equal(doc.nodes[0].parentId, null);
      await button('Enter scene').click();
      const blankText = await addObject('Text (T)', 'First blank text', {
        X: 20, Y: 30, Width: 240, Height: 70, 'Font size': 20, 'Text content': 'A blank path can become a real story.',
      });
      assert.equal(doc.nodes.find(n => n.id === blankText).parentId, blankRoom);
      await button('Frame as story stop').click();
      await exported('functional blank story');
      assert.equal(doc.stops.length, 1);
      assert.equal(doc.stops[0].targetId, blankText);
      await page.getByRole('button', { name: /^Present/ }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('First blank text');
      await expect(canvasNode(blankText)).toHaveText('A blank path can become a real story.');
      await framed(blankText, page, 70);
      await button('Exit viewer').click();
      await importPackage(backup.filename);
      await expect(page.getByRole('status')).toContainText('Editable project imported');
      assert.deepEqual((await exported('restore authored story')).doc, before);
    });

    await check('Publish ZIP, self-host extracted viewer, keyboard navigation, reduced motion, both branch routes', async () => {
      currentPage = page;
      // If an earlier blank-flow assertion failed, restore through import, never storage injection.
      if (backup && doc.id !== backup.doc.id) {
        if (await button('Exit viewer').isVisible()) await button('Exit viewer').click();
        await importPackage(backup.filename);
        await expect(page.getByRole('status')).toContainText('Editable project imported');
      }
      await exported('published project');
      await button('Publish').click();
      await expect(button('Download viewer ZIP')).toBeEnabled();
      const zipPath = await download(() => button('Download viewer ZIP').click(), '.zip');
      await closeDialog();
      const zip = await JSZip.loadAsync(await readFile(zipPath));
      assert.deepEqual(Object.keys(zip.files).sort(), ['README.txt', 'index.html', 'project.json', 'viewer.js'].sort());
      const viewerDirectory = path.join(directory, 'published');
      await mkdir(viewerDirectory);
      for (const entry of Object.values(zip.files)) {
        assert.ok(!entry.dir && path.basename(entry.name) === entry.name, 'Unexpected ZIP entry');
        await writeFile(path.join(viewerDirectory, entry.name), await entry.async('nodebuffer'));
      }
      assert.deepEqual(JSON.parse(await readFile(path.join(viewerDirectory, 'project.json'), 'utf8')), doc);
      server = createServer(async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
        const name = pathname === '/' ? 'index.html' : pathname.slice(1);
        if (!['index.html', 'viewer.js', 'project.json', 'README.txt'].includes(name)) {
          response.writeHead(404); response.end('Not found'); return;
        }
        try {
          const content = await readFile(path.join(viewerDirectory, name));
          response.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : name.endsWith('.html') ? 'text/html' : 'text/plain', 'Cache-Control': 'no-store' });
          response.end(content);
        } catch { response.writeHead(500); response.end('Unable to read exported file'); }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      viewer = await context.newPage(); currentPage = viewer;
      watch(viewer, 'published viewer');
      viewer.on('request', request => { if (request.url().startsWith('http')) requests.push(request.url()); });
      await viewer.goto(origin, { waitUntil: 'networkidle' });
      await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(doc.stops[0].title);
      await expect(viewer.getByRole('checkbox', { name: 'Reduce motion' })).toBeChecked();
      await expect(viewer.getByRole('button', { name: 'Exit viewer' })).toHaveCount(0);
      await framed('forest', viewer, 70);
      await viewer.keyboard.press('ArrowRight');
      await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(doc.stops[1].title);
      await framed(doc.stops[1].targetId, viewer, 70);
      const landed = await camera(viewer);
      await viewer.waitForTimeout(160);
      assert.deepEqual(await camera(viewer), landed, 'Reduced motion must land without a residual flight');
      await viewer.keyboard.press('ArrowLeft');
      await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(doc.stops[0].title);
      await framed('forest', viewer, 70);
      await viewer.getByRole('checkbox', { name: 'Reduce motion' }).uncheck();
      await viewer.getByRole('button', { name: 'Next chapter', exact: true }).click();
      await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(doc.stops[1].title);
      const inFlight = await camera(viewer);
      assert.ok(Math.abs(inFlight.scale - landed.scale) > landed.scale * 0.01, 'Normal motion should animate, not jump');
      await framed(doc.stops[1].targetId, viewer, 70);
      await viewer.getByRole('checkbox', { name: 'Reduce motion' }).check();
      await viewerStop('stop-mushroom');
      // Reparenting the new hotspot's group into mushroom adds our third choice.
      await expect(viewer.locator('.fv-choices').getByRole('button')).toHaveCount(3);
      await expect(viewer.locator('.fv-choices').getByRole('button', { name: '01 / ENTER THE GILLS', exact: true })).toBeVisible();
      await expect(viewer.locator('.fv-choices').getByRole('button', { name: '02 / FOLLOW THE ROOTS', exact: true })).toBeVisible();
      await screenshot('published-choice', viewer);
      await viewer.getByRole('button', { name: 'Play story', exact: true }).click();
      await expect(viewer.getByRole('status')).toContainText('Autoplay waits here');
      await expect(viewer.getByRole('button', { name: 'Play story', exact: true })).toHaveAttribute('aria-pressed', 'false');
      // Exercise an actual canvas hotspot on the gill route, and the accessible
      // chapter choice button on the roots route. Neither invokes viewer functions.
      await canvasNode('mushroom-branch-1-label', viewer).click();
      await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('The Geometry of Release');
      await framed('gill', viewer, 70);
      await expect(canvasNode('gill-body', viewer)).toContainText('microscopic basidia form spores.');
      await viewerStop('stop-mushroom');
      await viewer.locator('.fv-choices').getByRole('button', { name: '02 / FOLLOW THE ROOTS', exact: true }).click();
      await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Choose What Comes Next');
      await framed('roots', viewer, 70);
      await expect(canvasNode('roots-body', viewer)).toContainText('benefits vary with partner and place.');
      assert.ok(requests.includes(`${origin}/project.json`), 'The ZIP viewer must fetch its own extracted project.json');
      assert.ok(requests.every(url => new URL(url).origin === origin), `Export depends on external hosts: ${requests.join(', ')}`);
    });

    await check('Published deep text, custom branch, free exploration, restart, and no console errors', async () => {
      assert.ok(viewer, 'Published viewer prerequisite'); currentPage = viewer;
      await viewerStop('stop-memory');
      await expect(canvasNode('memory-title', viewer)).toHaveText('The future\nhas a past.');
      await expect(canvasNode('memory-body', viewer)).toContainText('Memory here is a metaphor.');
      assert.ok((await camera(viewer)).scale > 1e6);
      await expect(viewer.getByRole('navigation', { name: 'Scene breadcrumbs' }).getByRole('button')).toHaveCount(8);
      await screenshot('published-deep', viewer);
      await viewerStop(customStopId);
      await expect(canvasNode(noteId, viewer)).toHaveText(note);
      await canvasNode(noteId, viewer).press('Enter');
      await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Choose What Comes Next');
      await framed('roots', viewer, 70);
      await viewer.getByRole('button', { name: 'Explore', exact: true }).click();
      await expect(viewer.getByRole('button', { name: 'Explore', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const svgBox = await canvas(viewer).boundingBox(), start = await camera(viewer);
      await drag(viewer, svgBox.x + 100, svgBox.y + 110, 65, 33);
      const panned = await camera(viewer);
      near(panned.x, start.x - 65 / start.scale, 1e-6, 'Viewer pointer pan X');
      near(panned.y, start.y - 33 / start.scale, 1e-6, 'Viewer pointer pan Y');
      const point = { x: svgBox.width * 0.63, y: svgBox.height * 0.48 };
      await viewer.mouse.move(svgBox.x + point.x, svgBox.y + point.y);
      await viewer.mouse.wheel(0, -160);
      await expect.poll(async () => (await camera(viewer)).scale).toBeGreaterThan(panned.scale * 1.2);
      const zoomed = await camera(viewer);
      near(panned.x + (point.x - panned.width / 2) / panned.scale,
        zoomed.x + (point.x - zoomed.width / 2) / zoomed.scale, 0.05, 'Viewer wheel anchor X');
      near(panned.y + (point.y - panned.height / 2) / panned.scale,
        zoomed.y + (point.y - zoomed.height / 2) / zoomed.scale, 0.05, 'Viewer wheel anchor Y');
      await expect(viewer.locator('.fv-status')).toContainText('Off the beaten path');
      await viewer.getByRole('button', { name: 'Restart story', exact: true }).click();
      await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(doc.stops[0].title);
      await expect(viewer.getByRole('button', { name: 'Explore', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await framed('forest', viewer, 70);
      await expect(canvasNode('forest-description', viewer)).toHaveText(paragraph);
      await expect(canvasNode('field-image', viewer).locator('image')).toHaveAttribute('href', rasterUrl);
      await screenshot('published-restarted', viewer);
      assert.deepEqual(errors, [], 'Browser console/page errors');
    });
  } catch (error) {
    results.push({ name: 'Flow infrastructure', status: 'failed', error: error.stack });
    console.error(error);
  } finally {
    await context.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
  const report = { baseURL: BASE_URL, directory, results, errors, hmr, requests };
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}

let report;
try {
  for (let number = 1; number <= 3; number++) {
    report = await attempt(number);
    if (!report.hmr.length) break;
    console.log(`HMR interrupted attempt ${number}; repeating the complete flow in a fresh browser context.`);
  }
} finally {
  await browser.close();
}
const passed = report.results.filter(result => result.status === 'passed').length;
const failed = report.results.filter(result => result.status === 'failed').length;
const complete = report.results.length === 15 && !report.hmr.length;
console.log(`\nRESULT: ${passed}/15 passed, ${failed} failed, ${report.errors.length} browser errors. Complete: ${complete}.`);
console.log(`Artifacts and JSON report: ${report.directory}`);
if (!complete || failed || report.errors.length) process.exitCode = 1;
