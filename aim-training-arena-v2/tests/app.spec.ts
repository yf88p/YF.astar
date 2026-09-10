import { test, expect } from '@playwright/test';

test('desktop arena renders and settings persist', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.webgl-error')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath('desktop.png'),
    fullPage: true,
  });
  await expect(page.locator('h1')).toHaveText('Your aim. Elevated.');
  await page.locator('.mode-option[data-mode="precision"]').click();
  await expect(page.locator('#arena-mode-name')).toContainText('Precision');
  await page.locator('[data-duration="30"]').click();
  await page.locator('#difficulty').selectOption('hard');
  await page.locator('.crosshair-setting').click();
  await page.locator('[data-crosshair="dot"]').click();
  await expect(page.locator('#crosshair')).toHaveClass(/crosshair-dot/);
  await page.locator('.modal-done').click();
  await page.reload();
  await expect(page.locator('#arena-mode-name')).toContainText('Precision');
  await expect(page.locator('#difficulty')).toHaveValue('hard');
  await expect(page.locator('#hud-time')).toHaveText('00:30');
  await expect(page.locator('#crosshair')).toHaveClass(/crosshair-dot/);
  await page.locator('[data-view="statistics"]').first().click();
  await expect(page.locator('#statistics-view')).toContainText(
    'Every expert starts at zero.',
  );
  await page.locator('[data-view="leaderboard"]').first().click();
  await expect(page.locator('#leaderboard-view')).toContainText(
    'Your next personal best is waiting.',
  );
  await page.locator('#record-duration').selectOption('120');
  await page.locator('#record-difficulty').selectOption('easy');
  await expect(page.locator('#record-duration')).toHaveValue('120');
  await expect(page.locator('#record-difficulty')).toHaveValue('easy');
  await page.locator('[data-view="arena"]').first().click();
  await expect(page.locator('#hud-time')).toHaveText('00:30');
  await expect(page.locator('#difficulty')).toHaveValue('hard');
  await page.locator('.fullscreen-button').click();
  await expect(page.locator('.arena-panel')).toHaveClass(/expanded/);
  await page.keyboard.press('f');
  await expect(page.locator('.arena-panel')).not.toHaveClass(/expanded/);
  expect(errors).toEqual([]);
});

test('shooting, pausing, session results and saved statistics', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('[data-duration="30"]').click();
  await page.locator('#start-button').click();
  await expect(page.locator('#arena-stage')).toHaveAttribute(
    'data-state',
    'countdown',
  );
  await expect(page.locator('#arena-stage')).toHaveAttribute(
    'data-state',
    'running',
    { timeout: 10_000 },
  );
  await expect
    .poll(() => page.evaluate(() => document.pointerLockElement?.tagName))
    .toBe('CANVAS');
  // Aim down at the lower-center target using the normal pointer-move handler.
  await page
    .locator('canvas')
    .dispatchEvent('pointermove', {
      movementX: 0,
      movementY: 40,
      pointerType: 'mouse',
    });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#hud-accuracy')).toHaveText('100');
  await expect(page.locator('#combo-label')).toContainText('1 HITS');
  expect(
    Number(await page.locator('#hud-score').textContent()),
  ).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#hud-accuracy')).toHaveText('50');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-overlay')).toBeVisible();
  const pausedTime = await page.locator('#hud-time').textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator('#hud-time')).toHaveText(pausedTime!);
  await page.locator('[data-action="resume"]').click();
  await expect(page.locator('#arena-stage')).toHaveAttribute(
    'data-state',
    'running',
  );
  await page.clock.install();
  await page.clock.fastForward(31_000);
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal')).toContainText('FINAL SCORE');
  await page.locator('.result-back').click();
  await expect(page.locator('#arena-stage')).toHaveAttribute(
    'data-state',
    'idle',
  );
  await page.reload();
  await page.locator('[data-view="statistics"]').first().click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('.stat-card').nth(2)).toContainText('1');
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('deadeye-sessions-v1') || '[]'),
  );
  expect(data).toHaveLength(1);
  expect(data[0].shots).toBe(2);
  expect(data[0].hits).toBe(1);
  expect(data[0].score).toBeGreaterThan(0);
  expect(data[0].duration).toBe(30);
});

test('mobile layout and touch training', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.locator('.mobile-menu').tap();
  await expect(page.locator('.sidebar')).toBeInViewport();
  await page.locator('.mode-shortcut[data-mode="tracking"]').tap();
  await expect(page.locator('#arena-mode-name')).toContainText('Tracking');
  await page.locator('.mode-option[data-mode="gridshot"]').tap();
  await page.locator('#start-button').tap();
  await expect(page.locator('#arena-stage')).toHaveAttribute(
    'data-state',
    'running',
    { timeout: 10_000 },
  );
  await expect(page.locator('.touch-shoot')).toBeVisible();
  const fireBox = (await page.locator('.touch-shoot').boundingBox())!;
  const canvasBox = (await page.locator('canvas').boundingBox())!;
  const fireTouch = {
    x: fireBox.x + fireBox.width / 2,
    y: fireBox.y + fireBox.height / 2,
    id: 1,
  };
  const aimTouch = {
    x: canvasBox.x + canvasBox.width / 2,
    y: canvasBox.y + canvasBox.height / 2,
    id: 2,
  };
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [fireTouch],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [fireTouch, aimTouch],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [fireTouch, { ...aimTouch, y: aimTouch.y + 25 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [fireTouch],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.waitForTimeout(100);
  await page.locator('.touch-shoot').tap();
  await expect(page.locator('#combo-label')).toContainText('1 HITS');
  await expect(page.locator('#hud-accuracy')).toHaveText('50');
  await page.locator('.stage-pause').tap();
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.locator('[data-action="end"]').tap();
  await expect(page.locator('#arena-stage')).toHaveAttribute(
    'data-state',
    'idle',
  );
  // Screenshot capture can reset touch emulation in some Chromium versions.
  await page.screenshot({
    path: testInfo.outputPath('mobile.png'),
    fullPage: true,
  });
  await context.close();
});

test('precision targets can be hit and tracking fires continuously', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.mode-option[data-mode="precision"]').click();
  await page.locator('#start-button').click();
  await expect(page.locator('#arena-stage')).toHaveAttribute(
    'data-state',
    'running',
    { timeout: 10_000 },
  );
  await page
    .locator('canvas')
    .dispatchEvent('pointermove', {
      movementX: -178,
      movementY: -58,
      pointerType: 'mouse',
    });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#hud-accuracy')).toHaveText('100');
  expect(
    Number(await page.locator('#hud-score').textContent()),
  ).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-action="end"]').click();
  await page.locator('.mode-option[data-mode="tracking"]').click();
  await page.locator('#start-button').click();
  await expect(page.locator('#arena-stage')).toHaveAttribute(
    'data-state',
    'running',
    { timeout: 10_000 },
  );
  await page.mouse.down();
  await expect
    .poll(async () => {
      const label = await page.locator('#combo-label').textContent();
      return Number(label?.match(/(\d+) SHOTS/)?.[1] ?? 0);
    })
    .toBeGreaterThan(2);
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.locator('[data-action="end"]').click();
  await expect(page.locator('#arena-stage')).toHaveAttribute(
    'data-state',
    'idle',
  );
});
