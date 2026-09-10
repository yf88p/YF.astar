import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const output = '/tmp/opencode/fracture-production';
await mkdir(output, { recursive: true });
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = await preview({ root: fileURLToPath(new URL('..', import.meta.url)), preview: { host: '127.0.0.1', port, strictPort: true } });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], remote = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname !== '127.0.0.1') { remote.push(url.href); return route.abort(); }
  return route.continue();
});
try {
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByText('LOCAL ENGINE READY', { exact: true }).waitFor({ timeout: 45000 });
  await page.screenshot({ path: `${output}/desktop.png` });
  await page.getByRole('button', { name: /^Launch simulation/ }).click();
  await page.waitForFunction(() => Number(document.querySelector('.timecode>b').textContent) > 0.7);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.ok(Number((await page.locator('.scene-legend').innerText()).match(/(\d+) released/)[1]) > 0);
  await page.screenshot({ path: `${output}/fractured.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/mobile.png` });
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  console.log('Production browser PASS: split local bundles, real fracture, desktop/mobile, no remote requests or page errors.');
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
