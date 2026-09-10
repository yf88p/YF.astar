import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Run against npm run preview -- --port 5199 --strictPort.
// App mutations use ordinary UI only. evaluate() observes DOM, except for the
// detached PNG fixture. Geometry oracles use downloaded .atlas files, not app code.
const BASE_URL = process.env.BASE_URL || 'http://localhost:5199';
const ARTIFACTS = '/tmp/opencode/folia-interactions';
const CANVAS = '.canvas-stage > svg.spatial-canvas';
const expect = playwrightExpect.configure({ timeout: 9000 });
await mkdir(ARTIFACTS, { recursive: true });
const directory = await mkdtemp(path.join(ARTIFACTS, 'run-'));
const report = { baseURL: BASE_URL, directory, startedAt: new Date().toISOString(),
  results: [], errors: [], dialogs: [], hmr: [] };
const browser = await chromium.launch({ headless: true });
report.browser = browser.version();

function near(actual, expected, tolerance = 1e-8, label = 'value') {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`);
}

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function node(doc, id) {
  const found = doc.nodes.find(item => item.id === id);
  assert.ok(found, `Missing exported node ${id}`);
  return found;
}

function world(doc, id) {
  if (id == null) return [1, 0, 0, 1, 0, 0];
  const n = node(doc, id), angle = n.rotation * Math.PI / 180;
  const c = Math.cos(angle) * n.scale, s = Math.sin(angle) * n.scale;
  return multiply(world(doc, n.parentId), [c, s, -s, c, n.x, n.y]);
}

function point(matrix, x, y) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

function corners(doc, id) {
  const n = node(doc, id), matrix = world(doc, id);
  return [[0, 0], [n.w, 0], [n.w, n.h], [0, n.h]].map(([x, y]) => point(matrix, x, y));
}

function boxOf(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function onlyNodeChanged(before, after, id, patch) {
  assert.deepEqual(after, { ...before,
    nodes: before.nodes.map(n => n.id === id ? { ...n, ...patch } : n) });
}

async function check(name, repro, run, mobile = false) {
  const number = report.results.length + 1;
  const folder = path.join(directory, `${String(number).padStart(2, '0')}-${name}`);
  await mkdir(folder);
  const result = { name, repro, folder, status: 'running' }, started = Date.now();
  report.results.push(result);
  console.log(`CHECK ${number}: ${name}`);
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1100 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', error => report.errors.push({ check: name, kind: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push({ check: name, kind: 'console', message: message.text() });
  });
  page.on('dialog', async dialog => {
    report.dialogs.push({ check: name, type: dialog.type(), message: dialog.message() });
    await dialog.dismiss();
  });
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    let message;
    try { message = JSON.parse(String(payload)); } catch { return; }
    if (['update', 'full-reload', 'error'].includes(message.type)) report.hmr.push({ check: name, message });
  }));
  const button = name => page.getByRole('button', { name, exact: true });
  const canvas = page.locator(CANVAS);
  const canvasNode = id => canvas.locator(`[data-node-id="${id}"]`);
  const history = async () => {
    const value = await page.locator('.app-shell').getAttribute('data-history-version');
    assert.match(value, /^\d+$/, 'History version must be observable');
    return Number(value);
  };
  const saved = () => expect(page.locator('.save-status')).toHaveText('All changes saved locally');
  let fileNumber = 0;

  async function exported(label) {
    const openedPanel = !await button('Project options').isVisible();
    if (openedPanel) await button('Toggle story panel').click();
    await button('Project options').click();
    const downloading = page.waitForEvent('download', { timeout: 30000 });
    await button('Export editable project').click();
    const file = await downloading;
    assert.equal(await file.failure(), null);
    assert.ok(file.suggestedFilename().endsWith('.atlas'), file.suggestedFilename());
    const filename = path.join(folder, `${String(++fileNumber).padStart(2, '0')}-${label}.atlas`);
    await file.saveAs(filename);
    if (await button('Close dialog').isVisible()) await button('Close dialog').click();
    if (openedPanel) {
      // The mobile story panel covers its own toggle; opening the inspector
      // dismisses it, and the inspector has a visible close button.
      await button('Toggle inspector').click();
      await button('Close inspector').click();
    }
    const doc = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(doc.version, 1);
    return doc;
  }

  async function field(label, value) {
    const input = page.getByRole(typeof value === 'number' ? 'spinbutton' : 'textbox', { name: label, exact: true });
    await input.fill(String(value));
    await input.press('Tab');
    await expect(input).toHaveValue(String(value));
  }

  async function goStop(doc, id) {
    const index = doc.stops.findIndex(stop => stop.id === id);
    assert.ok(index >= 0, `Missing stop ${id}`);
    await page.getByRole('button', { name: /^Story path/ }).click();
    await button(`Stop ${index + 1}: ${doc.stops[index].title}`).click();
    await expect(page.getByLabel('Stop name', { exact: true })).toHaveValue(doc.stops[index].title);
    await expect(canvasNode(doc.stops[index].targetId)).toBeVisible();
  }

  async function drag(from, to, during) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    try {
      await page.mouse.move(to.x, to.y, { steps: 16 });
      if (during) await during();
    } finally { await page.mouse.up(); }
  }

  async function center(locator) {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async function oneTransaction(before, after, version, verifyDOM = async () => {}) {
    assert.equal(await history(), version + 1, 'Gesture/blur must commit exactly one document transaction');
    await button('Undo (Ctrl+Z)').click();
    assert.equal(await history(), version + 2, 'One Undo action');
    assert.deepEqual(await exported('undo'), before, 'One Undo must restore the entire prior document');
    await verifyDOM(false);
    await button('Redo (Ctrl+Shift+Z)').click();
    assert.equal(await history(), version + 3, 'One Redo action');
    assert.deepEqual(await exported('redo'), after, 'One Redo must restore the entire changed document');
    await verifyDOM(true);
  }

  async function rectangle() {
    const before = await exported('before-rectangle');
    await button('Rectangle (R)').click();
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.46);
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('New rect');
    const created = await exported('created-rectangle');
    const added = created.nodes.filter(n => !before.nodes.some(old => old.id === n.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].type, 'rect');
    await field('Rotation', 17);
    return { doc: await exported('rectangle-baseline'), id: added[0].id };
  }

  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await saved();
    await expect(canvas).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await run({ page, button, canvas, canvasNode, history, saved, exported, field, goStop,
      drag, center, oneTransaction, rectangle, folder, result });
    assert.deepEqual(report.errors.filter(error => error.check === name), [], 'No pageerror/console errors');
    assert.deepEqual(report.dialogs.filter(dialog => dialog.check === name), [], 'No unexpected dialogs or script execution');
    assert.deepEqual(report.hmr.filter(event => event.check === name), [], 'HMR changed the build during this check; rerun on a stable server');
    result.status = 'passed';
    console.log(`PASS: ${name}`);
  } catch (error) {
    result.status = 'failed';
    result.error = error.stack;
    result.screenshot = path.join(folder, 'failure.png');
    try { await page.screenshot({ path: result.screenshot, fullPage: true }); }
    catch (captureError) { result.screenshotError = captureError.message; }
    const body = await page.locator('body').innerText().catch(error => `Body unavailable: ${error.message}`);
    await writeFile(path.join(folder, 'failure.txt'), `${error.stack}\n\nREPRO: ${repro}\n\n${body}\n`);
    console.error(`FAIL: ${name}\n${error.message}\nREPRO: ${repro}\nArtifacts: ${folder}`);
  } finally {
    result.ms = Date.now() - started;
    await context.tracing.stop({ path: path.join(folder, 'trace.zip') });
    await context.close();
    await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  }
}

try {
  await check('canvas-rich-text',
    'Double-click the visible forest-description on the main canvas. Ctrl+A inside the editor, type the literal script text, select substrings with arrow keys, Ctrl+B/Ctrl+I, drag-select text, then blur. Undo once and redo once.',
    async ({ page, button, canvas, canvasNode, exported, history, drag, oneTransaction, folder, result }) => {
      const before = await exported('original'), original = node(before, 'forest-description');
      const target = canvasNode(original.id);
      await expect(target).toBeVisible();
      const version = await history();
      await target.locator('.canvas-text').dblclick();
      const editor = page.getByLabel('Edit canvas text', { exact: true });
      await expect(editor).toHaveAttribute('contenteditable', 'true');
      await expect(editor).toBeFocused();
      const text = 'Forest notes: <script>alert(1)</script> stays text. Bold roots, italic leaves.';
      await editor.press('Control+A');
      assert.equal(await page.evaluate(() => getSelection().toString()), original.text,
        'Ctrl+A must select editor text, not canvas objects or the page');
      await editor.pressSequentially(text);
      await expect(editor).toHaveText(text);
      await expect(editor.locator('script')).toHaveCount(0);
      for (const [substring, shortcut] of [['Bold roots', 'Control+B'], ['italic leaves', 'Control+I']]) {
        await editor.press('Control+Home');
        for (let i = 0; i < text.indexOf(substring); i++) await editor.press('ArrowRight');
        for (let i = 0; i < substring.length; i++) await editor.press('Shift+ArrowRight');
        assert.equal(await page.evaluate(() => getSelection().toString()), substring, 'Native keyboard substring selection');
        await editor.press(shortcut);
      }
      assert.equal(await history(), version, 'Typing and rich formatting must not commit before blur');
      const transformBefore = await canvasNode('forest').getAttribute('transform');
      // Read a native DOM Range only to locate first-line glyphs; selection itself is a real drag.
      const glyphs = await editor.evaluate(el => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), text = walker.nextNode();
        if (!text || text.length < 10) throw new Error('Missing first text run');
        return [1, 10].map(index => {
          const range = document.createRange();
          range.setStart(text, index); range.setEnd(text, index + 1);
          const box = range.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });
      });
      await drag(glyphs[0], glyphs[1]);
      const selection = await editor.evaluate(el => {
        const selected = getSelection();
        return { text: selected.toString(), inside: el.contains(selected.anchorNode) && el.contains(selected.focusNode) };
      });
      assert.ok(selection.inside && selection.text.length >= 4, 'Pointer drag must actually select text inside contentEditable');
      assert.equal(await canvasNode('forest').getAttribute('transform'), transformBefore, 'Text selection must not pan the camera');
      assert.equal(await history(), version, 'Text selection must not make a document transaction');
      await page.screenshot({ path: path.join(folder, 'editing.png') });
      await button('Select (V)').click();
      await expect(editor).toHaveCount(0);
      await expect(target.locator('.canvas-text')).toHaveText(text);
      await expect(canvas.locator('script')).toHaveCount(0);
      const after = await exported('committed'), edited = node(after, original.id);
      assert.equal(edited.text, text);
      assert.equal(edited.runs.map(run => run.text).join(''), text);
      const characters = edited.runs.flatMap(run => [...run.text].map(character => ({ character, bold: !!run.bold, italic: !!run.italic })));
      characters.forEach((character, i) => {
        assert.equal(character.bold, i >= text.indexOf('Bold roots') && i < text.indexOf('Bold roots') + 'Bold roots'.length, `Bold at character ${i}`);
        assert.equal(character.italic, i >= text.indexOf('italic leaves') && i < text.indexOf('italic leaves') + 'italic leaves'.length, `Italic at character ${i}`);
      });
      onlyNodeChanged(before, after, original.id, { text, runs: edited.runs });
      result.selection = selection;
      result.runs = edited.runs;
      await oneTransaction(before, after, version, async redone => {
        await expect(target.locator('.canvas-text')).toHaveText(redone ? text : original.text);
        if (redone) {
          const formatted = await target.locator('.canvas-text span').evaluateAll(spans => ({
            bold: spans.filter(span => Number(getComputedStyle(span).fontWeight) >= 600).map(span => span.textContent).join(''),
            italic: spans.filter(span => getComputedStyle(span).fontStyle === 'italic').map(span => span.textContent).join(''),
          }));
          assert.deepEqual(formatted, { bold: 'Bold roots', italic: 'italic leaves' }, 'Redo must render the exact rich-text substrings');
        }
      });
    });

  await check('pointer-resize',
    'Create a rectangle, set Rotation to 17, drag its top-left square resize handle away from the bottom-right corner by a factor of 1.3. The opposite corner must stay fixed. Undo and redo once.',
    async ({ canvas, canvasNode, rectangle, history, center, drag, exported, oneTransaction, result }) => {
      const { doc: before, id } = await rectangle(), old = node(before, id), version = await history();
      const handles = canvas.locator('.selection-outline rect');
      await expect(handles).toHaveCount(4);
      const from = await center(handles.nth(0)), anchor = await center(handles.nth(2));
      const factor = 1.3, to = { x: anchor.x + (from.x - anchor.x) * factor, y: anchor.y + (from.y - anchor.y) * factor };
      const transformBefore = await canvasNode(id).getAttribute('transform');
      await drag(from, to, async () => assert.equal(await history(), version, 'Resize preview must not commit per pointermove'));
      const after = await exported('resized'), resized = node(after, id);
      near(resized.scale, old.scale * factor, 1e-5, 'Pointer resize scale');
      assert.equal(resized.rotation, old.rotation);
      const worldBefore = point(world(before, id), old.w, old.h), worldAfter = point(world(after, id), old.w, old.h);
      near(worldAfter.x, worldBefore.x, 1e-7, 'Opposite world anchor X');
      near(worldAfter.y, worldBefore.y, 1e-7, 'Opposite world anchor Y');
      const actualAnchor = await center(handles.nth(2));
      near(actualAnchor.x, anchor.x, 0.5, 'Opposite DOM anchor X');
      near(actualAnchor.y, anchor.y, 0.5, 'Opposite DOM anchor Y');
      onlyNodeChanged(before, after, id, { scale: resized.scale, x: resized.x, y: resized.y });
      const transformAfter = await canvasNode(id).getAttribute('transform');
      assert.notEqual(transformAfter, transformBefore);
      result.gesture = { from, to, factor, anchor, actualAnchor };
      await oneTransaction(before, after, version, async redone => {
        await expect(canvasNode(id)).toHaveAttribute('transform', redone ? transformAfter : transformBefore);
      });
    });

  await check('pointer-rotation',
    'Create a rectangle with Rotation 17. Drag the circular rotation handle through 32 degrees about its top-left origin. Verify the origin stays fixed, then undo/redo once.',
    async ({ canvas, canvasNode, rectangle, history, center, drag, exported, oneTransaction, result }) => {
      const { doc: before, id } = await rectangle(), old = node(before, id), version = await history();
      const origin = await center(canvas.locator('.selection-outline rect').nth(0));
      const from = await center(canvas.locator('.selection-outline circle'));
      const angle = 32 * Math.PI / 180, dx = from.x - origin.x, dy = from.y - origin.y;
      const to = { x: origin.x + Math.cos(angle) * dx - Math.sin(angle) * dy,
        y: origin.y + Math.sin(angle) * dx + Math.cos(angle) * dy };
      const transformBefore = await canvasNode(id).getAttribute('transform');
      await drag(from, to, async () => assert.equal(await history(), version, 'Rotation preview must not commit per pointermove'));
      const after = await exported('rotated'), rotated = node(after, id);
      near(rotated.rotation, old.rotation + 32, 0.001, 'Pointer rotation degrees');
      assert.equal(rotated.scale, old.scale);
      const actualOrigin = await center(canvas.locator('.selection-outline rect').nth(0));
      near(actualOrigin.x, origin.x, 0.5, 'Rotation DOM origin X');
      near(actualOrigin.y, origin.y, 0.5, 'Rotation DOM origin Y');
      const priorWorld = point(world(before, id), 0, 0), nextWorld = point(world(after, id), 0, 0);
      assert.deepEqual(nextWorld, priorWorld, 'Rotation world anchor must stay fixed');
      onlyNodeChanged(before, after, id, { rotation: rotated.rotation });
      const transformAfter = await canvasNode(id).getAttribute('transform');
      assert.notEqual(transformAfter, transformBefore);
      result.gesture = { from, to, origin, actualOrigin, rotation: rotated.rotation };
      await oneTransaction(before, after, version, async redone => {
        await expect(canvasNode(id)).toHaveAttribute('transform', redone ? transformAfter : transformBefore);
      });
    });

  await check('freehand-path',
    'Choose Freehand (P), draw a curved stroke with the pointer, and release. Exactly one finite multi-segment path should be added. Undo removes it; redo restores it.',
    async ({ page, button, canvas, canvasNode, exported, history, oneTransaction, result }) => {
      const before = await exported('before'), version = await history(), box = await canvas.boundingBox();
      await button('Freehand (P)').click();
      const from = { x: box.x + box.width * 0.43, y: box.y + box.height * 0.44 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      try {
        for (let i = 1; i <= 24; i++) await page.mouse.move(from.x + i * 5, from.y + Math.sin(i / 24 * Math.PI * 2) * 35);
        assert.equal(await history(), version, 'Drawing preview must not create transactions');
      } finally { await page.mouse.up(); }
      const after = await exported('stroke'), added = after.nodes.filter(n => !before.nodes.some(old => old.id === n.id));
      assert.equal(added.length, 1);
      const stroke = added[0];
      assert.equal(stroke.type, 'path');
      assert.deepEqual(after, { ...before, nodes: [...before.nodes, stroke] });
      const d = await canvasNode(stroke.id).locator('path').getAttribute('d');
      assert.equal(d, stroke.path);
      assert.match(d, /^M/);
      assert.ok((d.match(/L/g) || []).length >= 12, 'Freehand d must contain multiple L segments');
      const numbers = d.replace(/[ML]/g, ' ').trim().split(/[ ,]+/).map(Number);
      assert.ok(numbers.length >= 26 && numbers.length % 2 === 0 && numbers.every(Number.isFinite), `Non-finite/invalid path: ${d}`);
      result.path = { id: stroke.id, d, lineSegments: (d.match(/L/g) || []).length };
      await oneTransaction(before, after, version, async redone => {
        if (redone) await expect(canvasNode(stroke.id).locator('path')).toHaveAttribute('d', d);
        else await expect(canvasNode(stroke.id)).toHaveCount(0);
      });
    });

  await check('new-image-import',
    'Click toolbar Import image (not Replace image), choose a new PNG. One Undo must remove both the new image node and its new asset; Redo must restore both.',
    async ({ page, button, canvasNode, exported, history, oneTransaction, folder, result }) => {
      const before = await exported('before'), version = await history();
      const dataUrl = await page.evaluate(() => {
        const fixture = document.createElement('canvas');
        fixture.width = 96; fixture.height = 64;
        const g = fixture.getContext('2d');
        g.fillStyle = '#275e46'; g.fillRect(0, 0, 96, 64);
        g.fillStyle = '#e5a65c'; g.fillRect(48, 0, 48, 64);
        g.fillStyle = '#fbf2db'; g.fillRect(8, 8, 19, 19);
        return fixture.toDataURL('image/png');
      });
      const filename = path.join(folder, 'new-image.png');
      await writeFile(filename, Buffer.from(dataUrl.split(',')[1], 'base64'));
      const choosing = page.waitForEvent('filechooser');
      await button('Import image').click();
      await (await choosing).setFiles(filename);
      await expect(page.getByRole('status')).toContainText('Original image preserved.');
      const after = await exported('imported'), added = after.nodes.filter(n => !before.nodes.some(old => old.id === n.id));
      const assets = Object.keys(after.assets).filter(id => !Object.hasOwn(before.assets, id));
      assert.equal(added.length, 1);
      assert.equal(assets.length, 1);
      const image = added[0], asset = after.assets[assets[0]];
      assert.equal(image.type, 'image');
      assert.equal(image.assetId, asset.id);
      assert.deepEqual([asset.mime, asset.width, asset.height, asset.dataUrl], ['image/png', 96, 64, dataUrl]);
      assert.deepEqual(after, { ...before, nodes: [...before.nodes, image], assets: { ...before.assets, [asset.id]: asset } });
      await expect(canvasNode(image.id).locator('image')).toHaveAttribute('href', dataUrl);
      result.imported = { nodeId: image.id, assetId: asset.id };
      await oneTransaction(before, after, version, async redone => {
        if (redone) await expect(canvasNode(image.id).locator('image')).toHaveAttribute('href', dataUrl);
        else await expect(canvasNode(image.id)).toHaveCount(0);
      });
    });

  await check('image-crop-fit',
    'Select the existing field-image. Change Image fit from Fit entire image to Fill / crop, set Crop x -23, Crop y 11, Crop zoom 1.75; then choose Stretch. Exported metadata and SVG attributes must change without changing asset bytes.',
    async ({ page, canvasNode, exported, field, history, result }) => {
      const before = await exported('before'), original = node(before, 'field-image');
      await canvasNode(original.id).click();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue(original.name);
      const version = await history(), image = canvasNode(original.id).locator('image');
      const fit = page.getByRole('combobox', { name: 'Image fit', exact: true });
      assert.equal(original.fit, 'contain', 'Existing image starts in contain mode');
      await expect(image).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
      await fit.selectOption('cover');
      for (const [label, value] of [['Crop x', -23], ['Crop y', 11], ['Crop zoom', 1.75]]) await field(label, value);
      const after = await exported('cropped');
      onlyNodeChanged(before, after, original.id, { fit: 'cover', crop: { x: -23, y: 11, zoom: 1.75 } });
      assert.deepEqual(after.assets, before.assets, 'Crop must preserve every original asset including dataUrl');
      const attrs = { x: '-23', y: '11', width: String(original.w * 1.75), height: String(original.h * 1.75),
        preserveAspectRatio: 'xMidYMid slice', href: before.assets[original.assetId].dataUrl };
      for (const [key, value] of Object.entries(attrs)) await expect(image).toHaveAttribute(key, value);
      assert.equal(await history(), version + 4, 'Fit and each numeric field commit once');
      await fit.selectOption('fill');
      await expect(image).toHaveAttribute('preserveAspectRatio', 'none');
      const stretched = await exported('stretched');
      onlyNodeChanged(after, stretched, original.id, { fit: 'fill' });
      assert.equal(stretched.assets[original.assetId].dataUrl, before.assets[original.assetId].dataUrl);
      result.crop = node(stretched, original.id).crop;
    });

  await check('lock-prevents-pointer-move',
    'Create and select a rectangle, check Locked in the inspector, then drag its visible interior. Neither the node nor camera should move and the drag must add no history entry. Undo restores unlocked state.',
    async ({ page, canvasNode, rectangle, history, center, drag, exported, oneTransaction }) => {
      const { doc: before, id } = await rectangle(), version = await history();
      await page.getByRole('checkbox', { name: 'Locked', exact: true }).check();
      const locked = await exported('locked');
      onlyNodeChanged(before, locked, id, { locked: true });
      const transform = await canvasNode(id).getAttribute('transform');
      const cameraTransform = await canvasNode('forest').getAttribute('transform');
      const start = await center(canvasNode(id));
      await drag(start, { x: start.x + 75, y: start.y + 38 });
      await expect(page.getByRole('status')).toContainText('This object is locked.');
      assert.equal(await history(), version + 1, 'Locked drag must not commit');
      await expect(canvasNode(id)).toHaveAttribute('transform', transform);
      await expect(canvasNode('forest')).toHaveAttribute('transform', cameraTransform);
      assert.deepEqual(await exported('after-blocked-drag'), locked);
      await oneTransaction(before, locked, version);
    });

  await check('hide-and-undo',
    'Create and select a rectangle, check Hidden in the inspector. It must disappear from the main canvas DOM. Undo shows it again; Redo hides it.',
    async ({ page, canvasNode, rectangle, history, exported, oneTransaction }) => {
      const { doc: before, id } = await rectangle(), version = await history();
      await expect(canvasNode(id)).toBeVisible();
      await page.getByRole('checkbox', { name: 'Hidden', exact: true }).check();
      await expect(canvasNode(id)).toHaveCount(0);
      const after = await exported('hidden');
      onlyNodeChanged(before, after, id, { hidden: true });
      await oneTransaction(before, after, version, async redone => {
        if (redone) await expect(canvasNode(id)).toHaveCount(0);
        else await expect(canvasNode(id)).toBeVisible();
      });
    });

  await check('semantic-visibility-override',
    'Select a new rectangle. Raise Visible from above its current pixels-per-local-unit scale. It must disappear; checking Inspect all zoom levels reveals it without changing the document or camera.',
    async ({ page, canvasNode, rectangle, history, field, exported, result }) => {
      const { doc: before, id } = await rectangle(), version = await history();
      const transform = await canvasNode(id).getAttribute('transform');
      const matrix = transform.match(/^matrix\((.+)\)$/)[1].trim().split(/[ ,]+/).map(Number);
      const effectiveScale = Math.hypot(matrix[0], matrix[1]);
      const minZoom = Math.ceil(effectiveScale * 3 + 1);
      const cameraTransform = await canvasNode('forest').getAttribute('transform');
      await field('Visible from', minZoom);
      await expect(canvasNode(id)).toHaveCount(0);
      const hidden = await exported('range-hidden');
      onlyNodeChanged(before, hidden, id, { minZoom });
      const override = page.getByRole('checkbox', { name: 'Inspect all zoom levels', exact: true });
      await override.check();
      await expect(canvasNode(id)).toBeVisible();
      await expect(canvasNode(id)).toHaveAttribute('transform', transform);
      await expect(canvasNode('forest')).toHaveAttribute('transform', cameraTransform);
      assert.deepEqual(await exported('inspect-all'), hidden, 'Inspect all is a view preference, not a document edit');
      assert.equal(await history(), version + 1, 'Visibility range commits once; inspection toggle must not commit');
      await override.uncheck();
      await expect(canvasNode(id)).toHaveCount(0);
      result.range = { effectiveScale, minZoom };
    });

  await check('two-unique-blank-projects',
    'Open the project library, create a blank and name it Interaction blank one. Create a second blank and name it Interaction blank two. Both library entries must independently reopen with their distinct exported IDs.',
    async ({ page, button, canvas, saved, exported, field, result }) => {
      const initial = await exported('forest');
      const blanks = [];
      for (const suffix of ['one', 'two']) {
        await button('Open project browser').click();
        await page.getByRole('button', { name: /Start from a blank canvas/ }).click();
        await expect(canvas).toHaveAttribute('data-total-count', '0');
        await saved();
        const blank = await exported(`blank-${suffix}`);
        assert.deepEqual([blank.nodes, blank.stops, blank.links, blank.assets], [[], [], [], {}]);
        assert.ok(blank.id && blank.id !== initial.id && !blanks.some(doc => doc.id === blank.id), 'Each blank needs a new unique project ID');
        await field('Project name', `Interaction blank ${suffix}`);
        await saved();
        const renamed = await exported(`named-${suffix}`);
        assert.equal(renamed.id, blank.id);
        blanks.push(renamed);
      }
      await button('Open project browser').click();
      await expect(page.locator('.saved-projects > div')).toHaveCount(3);
      for (const blank of blanks) await expect(page.locator('.saved-projects').getByRole('button', { name: new RegExp(`^${blank.name} 0 objects`) })).toBeVisible();
      await button('Close dialog').click();
      for (const blank of blanks) {
        await button('Open project browser').click();
        await page.locator('.saved-projects').getByRole('button', { name: new RegExp(`^${blank.name} 0 objects`) }).click();
        await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(blank.name);
        assert.deepEqual(await exported(`reopened-${blank.id}`), blank, 'Library must reopen the chosen separate document');
      }
      result.projects = blanks.map(doc => ({ id: doc.id, name: doc.name }));
    });

  await check('mobile-inspector',
    'At a 390x844 mobile viewport, create a rectangle, open Toggle inspector, edit Width to 420 and blur. Close/reopen the inspector, export to verify persistence, and check body/document horizontal overflow.',
    async ({ page, button, canvas, canvasNode, exported, field, history, saved, folder, result }) => {
      const initial = await exported('mobile-initial');
      await expect(page.locator('.inspector')).toBeHidden();
      await button('Rectangle (R)').click();
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
      await button('Toggle inspector').click();
      await expect(page.locator('.inspector')).toBeVisible();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('New rect');
      const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
      await expect(width).toBeVisible();
      const oldWidth = Number(await width.inputValue()), version = await history();
      assert.notEqual(oldWidth, 420);
      await field('Width', 420);
      assert.equal(await history(), version + 1, 'Mobile numeric editor commits on blur exactly once');
      await saved();
      await button('Close inspector').click();
      await expect(page.locator('.inspector')).toBeHidden();
      const after = await exported('mobile-width');
      const added = after.nodes.filter(n => !initial.nodes.some(old => old.id === n.id));
      assert.equal(added.length, 1);
      assert.equal(added[0].w, 420);
      await expect(canvasNode(added[0].id).locator(':scope > rect')).toHaveAttribute('width', '420');
      await button('Toggle inspector').click();
      await expect(width).toHaveValue('420');
      result.layout = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight },
        bodyWidth: document.body.scrollWidth, documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth }));
      result.screenshot = path.join(folder, 'mobile-390x844.png');
      await page.screenshot({ path: result.screenshot, fullPage: true });
      assert.deepEqual(result.layout.viewport, { width: 390, height: 844 });
      assert.ok(result.layout.bodyWidth <= 390 && result.layout.documentWidth <= 390,
        `Horizontal body/document overflow: ${JSON.stringify(result.layout)}`);
    }, true);

  await check('deep-dom-geometry',
    'Click the authored stop targeting memory. Compare the actual main-canvas scene and nested paragraph getBoundingClientRect values against a 70px-padded frame calculated independently from downloaded ancestor matrices; tolerance is 0.5 CSS pixel.',
    async ({ page, canvas, canvasNode, exported, goStop, folder, result }) => {
      const doc = await exported('geometry-oracle');
      const scene = node(doc, 'memory'), paragraph = node(doc, 'memory-body');
      assert.equal(paragraph.parentId, scene.id);
      let depth = 0;
      for (let current = scene; current.parentId; current = node(doc, current.parentId)) depth++;
      assert.ok(depth >= 6, `Need an actually deep scene; got depth ${depth}`);
      await goStop(doc, 'stop-memory');
      await expect(canvasNode(paragraph.id).locator('.canvas-text')).toHaveText(paragraph.text);
      const viewport = await canvas.evaluate(svg => ({ box: svg.getBoundingClientRect().toJSON(),
        width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height }));
      near(viewport.box.width, viewport.width, 0.01, 'Canvas CSS/viewBox width');
      near(viewport.box.height, viewport.height, 0.01, 'Canvas CSS/viewBox height');
      const bounds = boxOf(corners(doc, scene.id));
      const camera = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
        scale: Math.min((viewport.width - 140) / bounds.width, (viewport.height - 140) / bounds.height) };
      assert.ok(camera.scale > 1e6, 'Must exercise deep zoom, not a thumbnail/overview');
      const expected = id => boxOf(corners(doc, id).map(p => ({
        x: viewport.box.x + viewport.width / 2 + (p.x - camera.x) * camera.scale,
        y: viewport.box.y + viewport.height / 2 + (p.y - camera.y) * camera.scale,
      })));
      const readings = [];
      for (const [label, locator, id] of [
        ['scene group', canvasNode(scene.id), scene.id],
        ['scene rectangle', canvasNode(scene.id).locator(':scope > rect'), scene.id],
        ['nested paragraph group', canvasNode(paragraph.id), paragraph.id],
        ['nested paragraph foreignObject', canvasNode(paragraph.id).locator('foreignObject'), paragraph.id],
        ['nested paragraph HTML', canvasNode(paragraph.id).locator('.canvas-text'), paragraph.id],
      ]) {
        const actual = await locator.evaluate(el => el.getBoundingClientRect().toJSON());
        readings.push({ label, expected: expected(id), actual,
          errors: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, actual[key] - expected(id)[key]])) });
      }
      result.geometry = { depth, camera, viewport, readings };
      await writeFile(path.join(folder, 'geometry.json'), JSON.stringify(result.geometry, null, 2));
      await page.screenshot({ path: path.join(folder, 'deep-scene.png') });
      for (const reading of readings) for (const key of ['x', 'y', 'width', 'height']) {
        near(reading.actual[key], reading.expected[key], 0.5, `${reading.label} DOM ${key} in CSS pixels`);
      }
      assert.deepEqual(await exported('after-framing'), doc, 'Deep framing must not mutate the project');
    });
} catch (error) {
  report.infrastructureError = error.stack;
  console.error(error.stack);
} finally {
  await browser.close();
  report.completedAt = new Date().toISOString();
  report.passed = report.results.filter(result => result.status === 'passed').length;
  report.failed = report.results.filter(result => result.status === 'failed').length;
  report.complete = report.results.length === 12 && !report.infrastructureError;
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nRESULT: ${report.passed}/12 passed, ${report.failed} failed, ${report.errors.length} browser errors, ${report.dialogs.length} unexpected dialogs, ${report.hmr.length} HMR events. Complete: ${report.complete}.`);
  console.log(`Artifacts and report: ${directory}`);
  if (!report.complete || report.failed || report.errors.length || report.dialogs.length || report.hmr.length) process.exitCode = 1;
}
