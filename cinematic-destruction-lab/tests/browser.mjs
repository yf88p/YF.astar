import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const output = process.env.BROWSER_OUTPUT || '/tmp/opencode/fracture-workflows';
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const reservation = createNetServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true }, cacheDir: `${root}/node_modules/.vite-browser` });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
const errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
page.setDefaultTimeout(20000);
const check = message => { checks.push(message); console.log(`PASS ${message}`); };
const exported = async action => {
  const pending = page.waitForEvent('download'); await action();
  const download = await pending; const data = await readFile(await download.path());
  return { data, name: download.suggestedFilename(), download };
};
const project = async () => JSON.parse((await exported(() => page.getByRole('button', { name: 'Save project', exact: true }).click())).data);
async function setNumber(label, value) {
  const field = page.getByRole('spinbutton', { name: label, exact: true });
  await field.fill(String(value)); await field.press('Enter');
  await page.waitForTimeout(120);
}
async function seek(time) {
  await page.getByRole('slider', { name: 'Scrub recorded time' }).evaluate((el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, time);
  await page.waitForTimeout(180);
  const displayed = Number(await page.locator('.timecode>b').textContent());
  assert.ok(Math.abs(displayed - time) <= 0.005, `${displayed} should restore ${time}`);
}
async function take() {
  await page.getByRole('button', { name: 'Take export options', exact: true }).click();
  const file = await exported(() => page.getByRole('button', { name: 'Recorded take', exact: false }).click());
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  return { ...file, parsed: JSON.parse(file.data) };
}

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByText('LOCAL ENGINE READY', { exact: true }).waitFor({ timeout: 45000 });
  await page.screenshot({ path: `${output}/desktop.png` });
  const initial = await project();
  assert.equal(initial.objects.length, 8); assert.equal(initial.objects.find(o => o.id === 'pane-1').size[2], 0.012);
  check('desktop startup: complete local storefront and editable project export');

  await page.locator('.project-name').click();
  await page.getByRole('button', { name: /Blank laboratory/ }).click();
  await page.getByRole('button', { name: 'Create glass object' }).click();
  await setNumber('Dimensions W', 3.2); await setNumber('Dimensions H', 2.4); await setNumber('Dimensions D', 0.012);
  await setNumber('Fragments', 48); await setNumber('Fracture seed', 9751);
  await page.getByRole('button', { name: /Fixed support/ }).click();
  let authored = await project();
  assert.equal(authored.objects.length, 1); assert.deepEqual(authored.objects[0].size, [3.2, 2.4, 0.012]);
  assert.equal(authored.objects[0].fixed, true); assert.equal(authored.objects[0].seed, 9751);
  check('actual palette authoring, exact dimensions, fracture count/seed, and fixed support');

  await page.getByRole('button', { name: 'Duplicate selection (Ctrl+D)', exact: true }).click();
  assert.equal((await project()).objects.length, 2);
  await page.keyboard.press('Control+z'); assert.equal((await project()).objects.length, 1);
  await page.keyboard.press('Control+Shift+z'); assert.equal((await project()).objects.length, 2);
  await page.getByRole('button', { name: 'Glass 1 copy', exact: false }).click();
  await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
  assert.equal((await project()).objects.length, 1);
  check('duplicate, undo, redo, hierarchy selection, and deletion are authoring transactions');

  await page.getByRole('button', { name: /^Glass 1/ }).click();
  const beforeInvalid = await project();
  await page.getByRole('spinbutton', { name: 'Dimensions W', exact: true }).fill('9');
  await page.getByRole('spinbutton', { name: 'Dimensions W', exact: true }).press('Escape');
  assert.deepEqual(await project(), beforeInvalid);
  await setNumber('Dimensions W', -1);
  await page.getByRole('alert').waitFor(); assert.deepEqual(await project(), beforeInvalid);
  await setNumber('Fragments', 601);
  await page.getByRole('alert').waitFor(); assert.deepEqual(await project(), beforeInvalid);
  const input = page.getByLabel('Import project or take');
  await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"objects":[]}') });
  await page.getByRole('alert').waitFor(); assert.deepEqual(await project(), beforeInvalid);
  await input.setInputFiles({ name: 'malformed.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await page.getByRole('alert').waitFor(); assert.deepEqual(await project(), beforeInvalid);
  check('invalid dimensions, unsupported fragment count, and malformed imports preserve the valid document');

  await input.setInputFiles({ name: 'storefront.fracture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(initial)) });
  assert.deepEqual(await project(), initial);
  await page.getByRole('button', { name: 'Impact', exact: true }).click();
  await page.getByRole('button', { name: /Pick impact point/ }).click();
  const box = await page.locator('.stage-canvas canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.56, box.y + box.height * 0.49);
  await page.waitForTimeout(200);
  const aimed = await project();
  assert.notDeepEqual(aimed.impacts[0].direction, initial.impacts[0].direction);
  assert.ok(Math.abs(Math.hypot(...aimed.impacts[0].direction) - 1) < 1e-7);
  check('aim mode picks an actual glass surface and changes the projectile direction');

  // Return to the canonical signature shot before checking measured penetration.
  await input.setInputFiles({ name: 'storefront.fracture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(initial)) });
  await page.getByRole('button', { name: /^Launch simulation/ }).click();
  await page.waitForFunction(() => Number(document.querySelector('.timecode>b').textContent) >= 0.9, { timeout: 30000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const recorded = await take();
  assert.equal(recorded.parsed.format, 'fracture-take');
  assert.ok(recorded.parsed.frames.some(f => f.projectiles[0]?.position[2] + 0.16 < -0.006));
  assert.ok(recorded.parsed.frames.at(-1).stats.broken > 0);
  const firstBroken = recorded.parsed.frames.find(f => f.stats.broken > 0);
  check(`signature shot: real projectile crossing and bond release at ${firstBroken.time.toFixed(3)} s`);

  const endTime = recorded.parsed.frames.at(-1).time;
  const targetTime = Math.min(0.7, endTime);
  await seek(0); assert.match(await page.locator('.scene-legend').innerText(), /0 released/);
  await seek(targetTime); const legend = await page.locator('.scene-legend').innerText();
  await seek(0.3); await seek(targetTime); assert.equal(await page.locator('.scene-legend').innerText(), legend);
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.56);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.76, box.y + box.height * 0.64, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${output}/frozen-orbit.png` });
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await page.getByRole('button', { name: 'Add current camera keyframe', exact: true }).click();
  await page.getByRole('combobox', { name: 'Camera movement', exact: true }).selectOption('tracking');
  await page.getByRole('combobox', { name: 'Presentation speed', exact: true }).selectOption('0.25');
  const reframed = await take();
  assert.deepEqual(reframed.parsed.frames, recorded.parsed.frames);
  assert.equal(reframed.parsed.cameras.length, 3);
  assert.equal(reframed.parsed.cameras[0].presentationSpeed, 0.25);
  check('arbitrary reverse scrubbing, paused pointer orbit, camera keyframe, tracking, and slow motion leave all physics frames identical');

  await page.getByRole('button', { name: 'Glazing 2', exact: false }).click();
  await setNumber('Dimensions W', 2.25);
  await page.getByRole('dialog', { name: 'A new state. A new take.' }).waitFor();
  await page.getByRole('button', { name: 'Keep current take', exact: true }).click();
  assert.deepEqual((await take()).parsed.frames, recorded.parsed.frames);
  await setNumber('Dimensions W', 2.25);
  await page.getByRole('button', { name: /Apply & reset take/ }).click();
  assert.equal(Number(await page.locator('.timecode>b').textContent()), 0);
  assert.equal((await project()).objects.find(o => o.id === 'pane-1').size[0], 2.25);
  await page.keyboard.press('Control+z'); assert.equal((await project()).objects.find(o => o.id === 'pane-1').size[0], 2.17);
  await page.keyboard.press('Control+Shift+z'); assert.equal((await project()).objects.find(o => o.id === 'pane-1').size[0], 2.25);
  check('recorded-scene edits require explicit invalidation; cancel, apply, undo, and redo work');

  await input.setInputFiles({ name: 'reframed.take.json', mimeType: 'application/json', buffer: reframed.data });
  await page.waitForFunction(time => Math.abs(Number(document.querySelector('.timecode>b').textContent) - time) < 0.001, targetTime);
  await seek(0); await seek(targetTime);
  assert.deepEqual((await take()).parsed.frames, recorded.parsed.frames);
  const malformedTake = structuredClone(reframed.parsed); malformedTake.cameras[0].name = { invalid: true };
  await input.setInputFiles({ name: 'invalid-camera.take.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(malformedTake)) });
  await page.getByRole('alert').waitFor();
  assert.deepEqual((await take()).parsed.frames, recorded.parsed.frames);
  check('take reload restores authored camera/speed/playhead; malformed camera metadata is rejected before document replacement');

  await page.getByRole('button', { name: 'Take export options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Export presentation speed', exact: true }).selectOption('1');
  await page.getByRole('combobox', { name: 'Export camera', exact: true }).selectOption('path');
  const png = await exported(() => page.getByRole('button', { name: 'Still frame', exact: false }).click());
  assert.equal(png.data.subarray(1, 4).toString(), 'PNG');
  await page.getByRole('button', { name: 'Render cinematic video', exact: true }).click();
  const video = page.getByLabel('Exported take video');
  await video.waitFor({ timeout: 120000 });
  await video.evaluate(async el => { if (el.readyState < 2) await new Promise(resolve => el.addEventListener('loadeddata', resolve, { once: true })); });
  const duration = await video.evaluate(el => el.duration); assert.ok(Math.abs(duration - endTime) < 0.001);
  await video.evaluate(async el => { el.currentTime = el.duration * 0.5; await new Promise(resolve => el.addEventListener('seeked', resolve, { once: true })); await el.play(); });
  await page.waitForTimeout(150); await video.evaluate(el => el.pause());
  const webm = await exported(() => page.getByRole('button', { name: /Download WebM/ }).click());
  const videoPath = `${output}/cinematic.webm`; await webm.download.saveAs(videoPath);
  await page.screenshot({ path: `${output}/exported-video.png` });
  const videoPage = await browser.newPage(); await videoPage.goto(`file://${videoPath}`);
  await videoPage.locator('video').waitFor();
  await videoPage.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.ok(Math.abs(await videoPage.locator('video').evaluate(el => el.duration) - endTime) < 0.001);
  await videoPage.close();
  check(`PNG signature and downloaded VP9 WebM opened, decoded, sought, and played (${duration.toFixed(3)} s, ${webm.data.length} bytes)`);

  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Reset take to editable scene', exact: true }).click();
  await page.getByRole('button', { name: 'Advance one fixed physics tick (.)', exact: true }).click();
  assert.equal(Number(await page.locator('.timecode>b').textContent()), 0.008);
  check('reset and one fixed-step advance produce exactly tick 1 at 1/120 s');

  await page.getByRole('button', { name: 'Reset take to editable scene', exact: true }).click();
  await page.getByRole('button', { name: 'Simulation settings', exact: true }).click();
  await setNumber('Take storage budget', 0.125);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Recording storage limit reached' }).waitFor();
  const bounded = await take();
  assert.ok(bounded.parsed.frames.length > 1 && bounded.parsed.frames.length < 10);
  const boundedTime = Number(await page.locator('.timecode>b').textContent());
  assert.equal(boundedTime, Number(bounded.parsed.frames.at(-1).time.toFixed(3)));
  await page.getByRole('button', { name: 'Advance one fixed physics tick (.)', exact: true }).click();
  assert.equal(Number(await page.locator('.timecode>b').textContent()), boundedTime);
  assert.deepEqual((await take()).parsed.frames, bounded.parsed.frames);
  await page.getByRole('button', { name: 'Reset take to editable scene', exact: true }).click();
  await setNumber('Take storage budget', 127);
  check('lowered storage budget freezes at the last complete frame; export stays valid, stepping is blocked, and reset recovers');

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/mobile.png` });
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Impact', exact: true }).click();
  assert.ok(await page.getByRole('spinbutton', { name: 'Launch velocity', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Build & hierarchy', exact: true }).click();
  assert.ok(await page.getByRole('button', { name: 'Create concrete object', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Clean presentation (Escape to exit)', exact: true }).click();
  await page.getByRole('button', { name: /Back to laboratory/ }).click();
  check('mobile viewport, tabbed inspector/library, presentation entry/exit, and no horizontal overflow');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ browser: browser.version(), viewport: [1440, 960], checks, errors, takeFrames: recorded.parsed.frames.length, firstBreak: firstBroken.time, videoDuration: duration, videoBytes: webm.data.length }, null, 2));
  console.log(`\n${checks.length} actual browser workflows passed. Artifacts: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  console.error('Browser errors:', errors); throw error;
} finally { await browser.close(); await server.close(); }
