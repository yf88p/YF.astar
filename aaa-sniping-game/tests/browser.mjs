import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__ridge, { timeout: 90000 });
  assert.equal(await page.title(), 'Silent Ridge | Operation Dead Air');
  await page.click('.ui-menu [data-action="brief"]');
  assert.equal(await page.$eval('[data-ui="dialog"]', el => el.hidden), false);
  await page.click('[data-ui="brief-continue"]');
  await page.waitForFunction(() => __ridge.state.mode === 'playing' && __ridge.state.time > 0.2);
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => __ridge.state.scoped);
  await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => __ridge.state.breath < 0.9);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __ridge.state.ammo === 4);
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => __ridge.state.mode === 'paused');
  const pausedTime = await page.evaluate(() => __ridge.state.time);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await page.evaluate(() => __ridge.state.time), pausedTime);
  assert.equal(await page.evaluate(() => __ridge.state.reloading), true);
  await page.click('[data-panel="paused"] [data-action="resume"]');
  await page.waitForFunction(() => __ridge.state.ammo === 5 && !__ridge.state.reloading, { timeout: 30000 });
  assert.equal(await page.evaluate(() => __ridge.state.reserve), 24);

  // Stationary patrols isolate hit detection and the final-round victory regression.
  await page.keyboard.press('KeyP');
  await page.click('[data-panel="paused"] [data-action="restart"]');
  await page.evaluate(() => {
    __ridge.state.reserve = 0;
    __ridge.patrols.targets.forEach(target => { target.patrol = 0; });
  });
  await page.waitForFunction(() => __ridge.state.time > 0.3);
  for (let id = 0; id < 5; id++) {
    await page.evaluate(id => {
      __ridge.aimAt(id, id === 0);
      document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
    }, id);
    await page.waitForFunction(count => __ridge.state.kills === count, { timeout: 30000 }, id + 1);
    const shotTime = await page.evaluate(() => __ridge.state.time);
    await page.waitForFunction(time => __ridge.state.time > time + 1.1 || __ridge.state.mode === 'complete', { timeout: 30000 }, shotTime);
  }
  await page.waitForFunction(() => __ridge.state.mode === 'complete', { timeout: 30000 });
  assert.equal(await page.evaluate(() => __ridge.state.ammo), 0);
  assert.equal(await page.evaluate(() => __ridge.state.headshots), 1);
  assert.match(await page.$eval('#ui-dialog-title', el => el.textContent), /SIGNAL SILENCED/);
  await page.click('[data-panel="complete"] [data-action="restart"]');
  assert.equal(await page.evaluate(() => __ridge.state.kills), 0);
  assert.equal(await page.evaluate(() => __ridge.state.ammo), 5);
  await page.evaluate(() => { __ridge.state.time = 300; });
  await page.waitForFunction(() => __ridge.state.mode === 'complete', { timeout: 30000 });
  assert.match(await page.$eval('#ui-dialog-title', el => el.textContent), /SIGNAL LOST/);
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: briefing, scope, breath, fire, reload, pause/resume, headshot, last-round victory, restart, deadline failure.');
} finally {
  await browser.close();
}
