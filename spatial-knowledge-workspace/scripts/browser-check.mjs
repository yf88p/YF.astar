#!/usr/bin/env node
// npm run build && npm run verify:browser; MARGIN_URL=http://localhost:5183 npm run verify:browser
// Only fixture imports/storage seeding, DOM observation, and native browser input are used.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { browserFixture, performanceFixture, performancePhrase, passage, revision, markdownUpload, imageUpload } from '../tests/browser-fixtures.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.env.MARGIN_URL || 'http://127.0.0.1:5198';
const external = Boolean(process.env.MARGIN_URL);
const reportPath = path.join(root, 'docs/browser-results.json');
const screenshotDir = '/tmp/opencode';
const report = {
  startedAt: new Date().toISOString(), base, server: external ? 'externally managed' : 'vite preview (existing production build)',
  hardware: { platform: os.platform(), release: os.release(), arch: os.arch(), cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length, availableParallelism: os.availableParallelism(), totalMemoryBytes: os.totalmem(), freeMemoryBytesAtStart: os.freemem(), loadAverageAtStart: os.loadavg(), node: process.version, cpuThrottling: 'none (CDP rate 1)', networkThrottling: 'none' },
  scenarios: [], assertions: [], browserErrors: [], screenshots: [], performance: {},
};
let browser;
let server;
let serverLog = '';
let currentScenario;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const block = (page, id) => page.locator(`.editor-blocks .block-text[data-block-id="${id}"]`);
const card = (page, id) => page.locator(`[data-placement-id="${id}"]`);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const waitSaved = page => expect(page.locator('.save-indicator')).toHaveText('All changes saved', { timeout: 15000 });

async function check(name, action) {
  const entry = { scenario: currentScenario.name, name };
  report.assertions.push(entry);
  try {
    await action();
    entry.status = 'passed';
    console.log(`PASS ${currentScenario.name}: ${name}`);
  } catch (error) {
    entry.status = 'failed'; entry.error = error.message.replace(/\u001b\[[0-9;]*m/g, '');
    throw error;
  }
}

async function screenshot(page, label) {
  const file = path.join(screenshotDir, `margin-check-${slug(label)}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  report.screenshots.push(file);
  return file;
}

async function scenario(name, run, options = {}) {
  const entry = { name, status: 'running', startedAt: new Date().toISOString() };
  currentScenario = entry;
  report.scenarios.push(entry);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ...options });
  const errors = [];
  context.on('page', target => {
    target.setDefaultTimeout(8000);
    target.setDefaultNavigationTimeout(20000);
    target.on('pageerror', error => errors.push({ kind: 'pageerror', message: error.message }));
    target.on('console', message => { if (message.type() === 'error') errors.push({ kind: 'console.error', message: message.text() }); });
    target.on('response', response => { if (response.status() >= 400) errors.push({ kind: 'http', message: `${response.status()} ${response.url()}` }); });
    target.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push({ kind: 'requestfailed', message: `${request.failure()?.errorText} ${request.url()}` }); });
    target.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  });
  const page = await context.newPage();
  try {
    await run(page, context);
    entry.status = 'passed';
  } catch (error) {
    entry.status = 'failed'; entry.error = error.stack.replace(/\u001b\[[0-9;]*m/g, '');
    console.error(`FAIL ${name}: ${error.message}`);
    try {
      entry.observedUI = await page.evaluate(() => ({
        workspace: document.querySelector('.workspace-switch strong')?.textContent,
        status: document.querySelector('.workspace-status')?.textContent,
        activeElement: document.activeElement?.outerHTML.slice(0, 1200),
        alert: document.querySelector('[role="alert"]')?.textContent || null,
        canvasTotal: document.querySelector('[data-testid="canvas"]')?.dataset.totalCount,
        renderedImages: document.querySelectorAll('.canvas-local-image').length,
      }));
      entry.screenshot = await screenshot(page, `failure-${name}`);
    } catch { /* A crashed page may not permit diagnostics. */ }
  } finally {
    try {
      await check('no browser runtime, console, HTTP or network errors', async () => assert.deepEqual(errors, []));
    } catch (error) {
      entry.status = 'failed'; entry.browserError = error.message;
    }
    report.browserErrors.push(...errors.map(error => ({ scenario: name, ...error })));
    entry.finishedAt = new Date().toISOString();
    await context.close();
  }
}

async function load(page, fixture = true) {
  await page.goto(base);
  await expect(page.getByTestId('canvas')).toBeVisible();
  if (fixture) {
    await page.getByLabel('Open workspace package', { exact: true }).setInputFiles({
      name: 'browser-fixture.margin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(typeof fixture === 'object' ? fixture : browserFixture())),
    });
    await expect(page.locator('.workspace-switch strong')).toHaveText('Browser research (imported)');
    await expect(card(page, 'source-card')).toBeVisible();
  }
  await waitSaved(page);
}

async function openSource(page) {
  await card(page, 'source-card').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('Threshold research');
}

async function back(page) {
  await button(page, 'Back to board').click();
  await expect(page.locator('.editor-overlay')).toHaveCount(0);
}

async function board(page, name) {
  await page.locator('.board-nav').getByRole('button', { name, exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('aria-label', `${name} spatial canvas`);
}

async function pin(page, id, frozen = false) {
  const row = block(page, id).locator('xpath=ancestor::div[contains(@class,"block-row")]');
  await row.locator('.block-select').click();
  await expect(row).toHaveClass(/block-selected/);
  await button(page, frozen ? 'Frozen copy' : 'Pin excerpt').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Pin onto').selectOption('board-target');
  await dialog.getByRole('button', { name: frozen ? 'Capture frozen copy' : 'Pin live excerpt', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function searchFor(page, query, { tag = '', type = '' } = {}) {
  await page.keyboard.press('Control+k');
  await page.getByLabel('Filter by tag').selectOption(tag);
  await page.getByLabel('Filter by block type').selectOption(type);
  await page.getByLabel('Search workspace', { exact: true }).fill(query);
}

async function dragHeader(page, locator, dx = 75, dy = 60, steps = 12) {
  const box = await locator.boundingBox();
  assert.ok(box, 'drag header has browser geometry');
  const x = box.x + Math.min(60, box.width / 2), y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
}

async function readingSurface(page, id) {
  return card(page, id).locator('.card-scroll').evaluate(element => {
    const viewport = element.getBoundingClientRect();
    return {
      scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      visibleBlocks: [...element.querySelectorAll('.canvas-block')].filter(block => {
        const bounds = block.getBoundingClientRect();
        return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
      }).map(block => ({ id: block.dataset.blockId, text: block.innerText })),
    };
  });
}

async function startMeter(page, { event, selector, expectedText, attribute, expectedValue, savedText, gesture = false }) {
  await page.evaluate(config => {
    const meter = window.__marginBrowserMeter = { start: null, end: null, frames: [], error: null };
    let previous;
    let raf;
    let timer;
    const finish = error => {
      cancelAnimationFrame(raf); clearTimeout(timer);
      document.removeEventListener(config.event, start, true);
      if (error) meter.error = error;
      else meter.end = performance.now();
    };
    const tick = time => {
      if (previous !== undefined) meter.frames.push(time - previous);
      previous = time;
      if (!config.gesture) {
        const element = document.querySelector(config.selector);
        let ready = element && (config.attribute ? element.getAttribute(config.attribute) === config.expectedValue : element.textContent.includes(config.expectedText));
        if (ready && config.savedText) {
          const raw = localStorage.getItem(`margin:workspace:${localStorage.getItem('margin:active')}`);
          ready = raw?.includes(config.savedText) && document.querySelector('.save-indicator')?.textContent === 'All changes saved';
        }
        if (ready) { finish(); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      meter.start = performance.now();
      document.removeEventListener(config.event, start, true);
      raf = requestAnimationFrame(tick);
      timer = setTimeout(() => finish('browser DOM condition exceeded 15000ms'), 15000);
    };
    meter.stop = () => finish();
    document.addEventListener(config.event, start, true);
  }, { event, selector, expectedText, attribute, expectedValue, savedText, gesture });
}

async function finishMeter(page, gesture = false) {
  if (gesture) await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { window.__marginBrowserMeter.stop(); resolve(); }))));
  await page.waitForFunction(() => window.__marginBrowserMeter.end !== null || window.__marginBrowserMeter.error, null, { timeout: 17000 });
  const result = await page.evaluate(() => {
    const { start, end, frames, error } = window.__marginBrowserMeter;
    return { ms: end - start, frames, error };
  });
  assert.equal(result.error, null);
  assert.ok(result.ms >= 0);
  return result;
}

function stats(samples) {
  assert.ok(samples.length, 'performance samples must not be empty');
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: samples.map(n => +n.toFixed(2)), n: samples.length, medianMs: +((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2).toFixed(2), p95Ms: +sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2), maxMs: +sorted.at(-1).toFixed(2) };
}

async function runChecks() {
  await scenario('Integrated seed smoke', async page => {
    await load(page, false);
    await check('shipped workspace, substantive cards and source editor render', async () => {
      await expect(page.locator('.workspace-switch strong')).toHaveText('The Common Ground');
      await expect(page.getByTestId('canvas')).toHaveAttribute('data-total-count', '11');
      const source = page.locator('.map-card-document[data-document-id="doc-brief"]');
      await expect(source).toContainText('The case for staying');
      await source.focus(); await page.keyboard.press('Enter');
      await expect(block(page, 'doc-brief-b2')).toContainText('neighborhood needs places');
    });
    await screenshot(page, 'integrated-seed-editor');
  });

  await scenario('Live excerpt signature', async page => {
    await load(page); await openSource(page);
    await check('native contenteditable fill edits the canonical passage', async () => {
      await block(page, 'source-passage').fill(revision);
      await expect(block(page, 'source-passage')).toHaveText(revision);
    });
    await check('gutter selection pins a live excerpt on the other board', async () => {
      await pin(page, 'source-passage'); await back(page); await board(page, 'Evidence wall');
      await expect(page.locator('.map-card-excerpt')).toContainText(revision);
      await expect(page.locator('.canvas-live')).toHaveText('Live');
    });
    await check('source action highlights the exact pinned block', async () => {
      await button(page, 'Open source: Threshold research').click();
      await expect(page.locator('.block-highlighted .block-text')).toHaveAttribute('data-block-id', 'source-passage');
      await expect(page.locator('.block-highlighted')).toContainText(revision);
    });
    await check('rename and reorder preserve the visible source reference', async () => {
      await page.getByLabel('Document title', { exact: true }).fill('Threshold research revised');
      await block(page, 'source-passage').locator('xpath=ancestor::div[contains(@class,"block-row")]').locator('.block-select').click();
      await button(page, 'Move block down').click();
      await expect(page.locator('.editor-blocks .block-text').nth(2)).toHaveAttribute('data-block-id', 'source-passage');
      await back(page);
      await expect(page.locator('.map-card-excerpt')).toContainText('Threshold research revised');
      await expect(page.locator('.map-card-excerpt')).toContainText(revision);
    });
    await check('editing after navigation updates the live rendered excerpt', async () => {
      await button(page, 'Open source: Threshold research revised').click();
      await block(page, 'source-passage').fill(`${revision} Confirmed after navigation.`);
      await back(page);
      await expect(page.locator('.map-card-excerpt')).toContainText('Confirmed after navigation.');
      await waitSaved(page);
      await page.reload(); await board(page, 'Evidence wall');
      await expect(page.locator('.map-card-excerpt')).toContainText('Confirmed after navigation.');
    });
    await screenshot(page, 'live-excerpt');
  });

  await scenario('Split merge tombstone restore', async page => {
    await load(page); await openSource(page);
    const text = 'Keep this first half. Restore the second half without retargeting.';
    let secondId;
    await check('Enter splits at a native keyboard caret and keeps the first ID', async () => {
      await block(page, 'source-passage').fill(text);
      await block(page, 'source-passage').press('Control+Home');
      for (let i = 0; i < 22; i++) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await expect(block(page, 'source-passage')).toHaveText(text.slice(0, 22));
      const second = page.locator('.editor-blocks .block-text').nth(2);
      await expect(second).toHaveText(text.slice(22));
      secondId = await second.getAttribute('data-block-id');
      assert.notEqual(secondId, 'source-passage');
    });
    await check('merged-away pinned block becomes visibly deleted, never retargeted', async () => {
      await pin(page, secondId);
      await block(page, 'source-passage').click();
      await button(page, 'Merge with next block').click();
      await expect(block(page, 'source-passage')).toHaveText(text);
      await expect(block(page, secondId)).toHaveCount(0);
      await back(page); await board(page, 'Evidence wall');
      await expect(page.locator('.map-card-excerpt')).toContainText('Deleted passage');
      await expect(page.locator('.map-card-excerpt')).toContainText('An exact source passage was deleted');
      await expect(page.locator('.map-card-excerpt .canvas-card-body')).not.toContainText(text.slice(22));
    });
    await check('opening a tombstone exposes the original passage and restore repairs it', async () => {
      await button(page, 'Open source: Threshold research').click();
      await expect(page.locator('.editor-source-banner')).toContainText('This exact passage was deleted');
      await expect(page.locator('.editor-source-banner')).toContainText(text.slice(22));
      await button(page, 'Restore passage').click();
      await expect(page.locator('.block-highlighted .block-text')).toHaveAttribute('data-block-id', secondId);
      await expect(block(page, secondId)).toHaveText(text.slice(22));
      await back(page);
      await expect(page.locator('.map-card-excerpt')).toHaveAttribute('data-state', 'live');
      await expect(page.locator('.map-card-excerpt')).toContainText(text.slice(22));
    });
  });

  await scenario('Canonical shared placements', async page => {
    await load(page); await openSource(page);
    await check('place the canonical document on a second board through its modal', async () => {
      await page.locator('.editor-header').getByRole('button', { name: 'Place on a board', exact: true }).click();
      await page.getByRole('dialog').locator('select[name="board"]').selectOption('board-target');
      await button(page, 'Place document').click();
      await block(page, 'source-passage').fill(revision);
      await back(page); await board(page, 'Evidence wall');
      await expect(page.locator('.map-card-document')).toContainText(revision);
      await board(page, 'Research desk');
      await expect(card(page, 'source-card')).toContainText(revision);
    });
    await check('remove a placement without deleting the shared document', async () => {
      await card(page, 'source-card').locator('.canvas-card-move').click();
      await button(page, 'Remove placement').click();
      await expect(card(page, 'source-card')).toHaveCount(0);
      await board(page, 'Evidence wall');
      await expect(page.locator('.map-card-document')).toContainText(revision);
      await page.getByRole('button', { name: /^All documents/ }).click();
      await expect(page.locator('.library-card').filter({ has: page.getByRole('heading', { name: 'Threshold research', exact: true }) })).toHaveCount(1);
      await expect(page.locator('.library-grid')).toContainText('Threshold research');
    });
  });

  await scenario('Independent card reading scroll', async page => {
    const fixture = browserFixture();
    fixture.boards[0].placements[1] = { ...fixture.boards[0].placements[1], id: 'reading-peer', documentId: 'source' };
    fixture.boards[0].placements.forEach(placement => { placement.x += 80; });
    await load(page, fixture);
    let first, peer;
    await check('native wheel at 120% scrolls one canonical placement without panning or changing its peer', async () => {
      await button(page, 'Zoom in (+)').click();
      await expect(page.getByRole('button', { name: 'Zoom 120%. Reset to 100%', exact: true })).toBeVisible();
      await expect(card(page, 'source-card')).toHaveClass(/map-card-readable/);
      const camera = await page.locator('.canvas-world').getAttribute('style');
      const initial = await readingSurface(page, 'source-card');
      assert.ok(initial.scrollHeight > initial.clientHeight + 160, 'substantive document overflows its reading surface');
      await card(page, 'source-card').locator('.card-scroll').hover();
      await page.mouse.wheel(0, 160);
      await expect.poll(async () => (await readingSurface(page, 'source-card')).scrollTop).toBeGreaterThan(150);
      await waitSaved(page);
      first = await readingSurface(page, 'source-card');
      peer = await readingSurface(page, 'reading-peer');
      assert.equal(peer.scrollTop, 0);
      assert.notDeepEqual(first.visibleBlocks, peer.visibleBlocks, 'placements display different portions of the same source');
      assert.ok(first.visibleBlocks.some(block => block.text.includes('doorway') || block.text.includes('Separate permission')), 'scrolled card visibly exposes later source content');
      await expect(page.locator('.canvas-world')).toHaveAttribute('style', camera);
      await expect(button(page, 'Undo board operation')).toBeDisabled();
    });
    await check('open/back preserves reading offset and the second placement scrolls independently', async () => {
      await openSource(page);
      await expect(block(page, 'source-passage')).toHaveText(passage);
      await back(page);
      assert.deepEqual(await readingSurface(page, 'source-card'), first);
      assert.deepEqual(await readingSurface(page, 'reading-peer'), peer);
      await card(page, 'reading-peer').locator('.card-scroll').hover();
      await page.mouse.wheel(0, 70);
      await expect.poll(async () => (await readingSurface(page, 'reading-peer')).scrollTop).toBeGreaterThan(60);
      await waitSaved(page);
      peer = await readingSurface(page, 'reading-peer');
      assert.deepEqual(await readingSurface(page, 'source-card'), first);
      assert.ok(Math.abs(first.scrollTop - peer.scrollTop) > 50);
      await expect(button(page, 'Undo board operation')).toBeDisabled();
    });
    await check('culling and reload restore both reading surfaces, not just saved object fields', async () => {
      const camera = await page.locator('.canvas-world').getAttribute('style');
      const canvas = page.getByTestId('canvas');
      const bounds = await canvas.boundingBox();
      await canvas.hover({ position: { x: bounds.width - 12, y: bounds.height / 2 } });
      await page.mouse.wheel(4000, 0);
      await expect(canvas).toHaveAttribute('data-visible-count', '0');
      await expect(card(page, 'source-card')).toHaveCount(0);
      await expect(card(page, 'reading-peer')).toHaveCount(0);
      await page.mouse.wheel(-4000, 0);
      await expect(page.locator('.canvas-world')).toHaveAttribute('style', camera);
      await expect(card(page, 'source-card')).toBeVisible();
      assert.deepEqual(await readingSurface(page, 'source-card'), first);
      assert.deepEqual(await readingSurface(page, 'reading-peer'), peer);
      await waitSaved(page); await page.reload();
      await expect(card(page, 'source-card')).toHaveClass(/map-card-readable/);
      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(await readingSurface(page, 'source-card'), first);
      assert.deepEqual(await readingSurface(page, 'reading-peer'), peer);
      report.cardReadingScroll = { zoom: 1.2, first, peer, verifiedAfter: ['open/back', 'offscreen culling/remount', 'reload'], sourceIdentity: 'Both placements show document source; view offsets are independent.' };
      await screenshot(page, 'independent-reading-scroll');
    });
  });

  await scenario('Frozen and trashed sources', async page => {
    await load(page); await openSource(page);
    await pin(page, 'source-passage'); await pin(page, 'source-passage', true);
    await check('frozen copy keeps its timestamp and wording after a source edit', async () => {
      await block(page, 'source-passage').fill(revision); await back(page); await board(page, 'Evidence wall');
      await expect(page.locator('.map-card-frozen')).toContainText(passage);
      await expect(page.locator('.map-card-frozen time')).toHaveAttribute('datetime', /^\d{4}-/);
      await expect(page.locator('.map-card-excerpt')).toContainText(revision);
    });
    await check('trash hides live source text, preserves frozen text and permits restore', async () => {
      // Pins intentionally overlap like new cards in the app; move the top card using its handle.
      await dragHeader(page, page.locator('.map-card-frozen .canvas-card-move'), 290, -150);
      await button(page, 'Close inspector').click();
      await page.locator('.map-card-excerpt').getByRole('button', { name: 'Open source: Threshold research', exact: true }).click();
      await page.getByLabel('More document actions').click();
      await button(page, 'Move to trash').click();
      await expect(block(page, 'source-passage')).toHaveAttribute('contenteditable', 'false');
      await back(page);
      await expect(page.locator('.map-card-excerpt')).toContainText('Deleted document');
      await expect(page.locator('.map-card-excerpt')).not.toContainText(revision);
      await expect(page.locator('.map-card-frozen')).toContainText(passage);
      await page.locator('.map-card-excerpt').getByRole('button', { name: 'Open source: Threshold research', exact: true }).click();
      await page.locator('.editor-banner').getByRole('button', { name: 'Restore', exact: true }).click();
      await back(page);
      await expect(page.locator('.map-card-excerpt')).toContainText(revision);
    });
  });

  await scenario('Relationships drag and undo', async page => {
    await load(page);
    await check('connections view creates a labeled directed relationship through a modal', async () => {
      await button(page, 'Connections').click(); await button(page, 'Add relationship').click();
      const modal = page.getByRole('dialog');
      await modal.locator('select[name="from"]').selectOption('source-card');
      await modal.locator('select[name="to"]').selectOption('cost-card');
      await modal.locator('select[name="type"]').selectOption('supports');
      await modal.getByLabel('Label', { exact: true }).fill('Paid care makes the invitation credible');
      await button(page, 'Create connection').click();
      await expect(page.locator('.relationship-row')).toContainText('Paid care makes the invitation credible');
      await button(page, 'Canvas').click(); await button(page, 'Close inspector').click();
      await expect(page.locator('.canvas-relationship-line')).toHaveAttribute('marker-end', /url/);
    });
    await check('dragging an endpoint header changes actual SVG geometry; Ctrl+Z restores it', async () => {
      const line = page.locator('.canvas-relationship-line');
      const before = await line.getAttribute('d');
      const position = await card(page, 'source-card').getAttribute('style');
      const beforeImage = await screenshot(page, 'relationship-before');
      await dragHeader(page, card(page, 'source-card').locator('.canvas-card-move'), 70, 90);
      await expect(line).not.toHaveAttribute('d', before);
      await expect(card(page, 'source-card')).not.toHaveAttribute('style', position);
      const after = await line.getAttribute('d');
      const afterImage = await screenshot(page, 'relationship-dragged');
      assert.notEqual(sha256(await readFile(beforeImage)), sha256(await readFile(afterImage)));
      await page.getByTestId('canvas').focus(); await page.keyboard.press('Control+z');
      await expect(line).toHaveAttribute('d', before);
      await expect(card(page, 'source-card')).toHaveAttribute('style', position);
      report.relationshipGeometry = { before, after, undo: await line.getAttribute('d'), beforeImage, afterImage, screenshotComparison: 'PNG SHA-256 differs; SVG d and card style restore exactly after undo' };
    });
  });

  await scenario('Search filters and refresh', async page => {
    await load(page);
    await check('phrase query plus tag/type filters finds the exact source block', async () => {
      await searchFor(page, 'copper lantern protocol', { tag: 'field notes', type: 'paragraph' });
      await expect(page.locator('.search-result')).toHaveCount(1);
      await expect(page.locator('.search-result')).toContainText('Threshold research');
      await expect(page.locator('.search-result p')).toContainText('Copper lantern protocol: keep a seat');
      await page.getByLabel('Search workspace', { exact: true }).press('Enter');
      await expect(page.locator('.block-highlighted .block-text')).toHaveAttribute('data-block-id', 'source-passage');
    });
    await check('search refreshes after editing a matching block', async () => {
      await block(page, 'source-passage').fill('Violet threshold evidence: keep the welcome optional and pay the host.');
      await searchFor(page, 'copper lantern protocol', { tag: 'field notes', type: 'paragraph' });
      await expect(page.locator('.search-result')).toHaveCount(0);
      await expect(page.locator('.search-empty')).toContainText('No threads found yet');
      await page.getByLabel('Search workspace', { exact: true }).fill('violet threshold evidence');
      await expect(page.locator('.search-result')).toHaveCount(1);
      await expect(page.locator('.search-result p')).toContainText('Violet threshold evidence');
      await page.getByLabel('Search workspace', { exact: true }).press('Enter');
    });
    await check('deleting the source removes its search result without a reload', async () => {
      await button(page, 'Delete selected blocks').click();
      await searchFor(page, 'violet threshold evidence');
      await expect(page.locator('.search-result')).toHaveCount(0);
      await expect(page.locator('.search-empty')).toBeVisible();
      await page.getByLabel('Search workspace', { exact: true }).fill('copper lantern protocol');
      await page.getByLabel('Filter by block type').selectOption('quote');
      await expect(page.locator('.search-result')).toHaveCount(1);
      await expect(page.locator('.search-result')).toContainText('Review before expanding');
      await page.getByLabel('Filter by tag').selectOption('costs');
      await expect(page.locator('.search-result')).toHaveCount(0);
    });
  });

  await scenario('Internal links and backlinks', async page => {
    await load(page); await openSource(page);
    await check('link picker creates an exact passage link and a visible backlink', async () => {
      await block(page, 'source-passage').click(); await button(page, 'Insert link').click();
      await page.getByLabel('Find link target').fill('The cost of welcome');
      await page.getByRole('dialog').getByText('Choose a specific block', { exact: true }).click();
      await page.locator('.link-block-result').filter({ hasText: 'A free seat is not free to maintain' }).click();
      const link = page.locator('.block-row').filter({ has: page.locator('.block-text').filter({ hasText: 'The cost of welcome:' }) }).locator('.block-link');
      await expect(link).toContainText('Open linked passage'); await link.click();
      await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('The cost of welcome');
      await expect(page.locator('.block-highlighted .block-text')).toHaveAttribute('data-block-id', 'cost-passage');
      const backlinks = page.locator('.editor-context-section').filter({ has: page.getByRole('heading', { name: /^Backlinks/ }) });
      await expect(backlinks).toContainText('Threshold research');
      await expect(backlinks).toContainText('The cost of welcome:');
    });
  });

  await scenario('Safe external link attachment', async (page, context) => {
    await load(page); await openSource(page);
    const url = 'https://example.org/margin-browser-source?study=threshold#evidence';
    const caption = 'The published boundary of this invitation';
    await check('attachment form inserts an actual safe anchor and native clicking opens its destination', async () => {
      await block(page, 'source-passage').click(); await button(page, 'Insert link').click();
      await page.locator('.link-attachments summary').click();
      const form = page.locator('.link-attachments form');
      await form.locator('select[name="kind"]').selectOption('link');
      await form.getByLabel('Display text or image caption').fill(caption);
      await form.getByLabel('Web address').fill(url);
      await form.getByRole('button', { name: 'Insert into document', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const row = page.locator('.editor-blocks .block-row').filter({ has: page.locator('.block-text').filter({ hasText: caption }) });
      await expect(row.locator('.block-text')).toHaveText(caption);
      const anchor = row.getByRole('link', { name: url, exact: true });
      await expect(anchor).toHaveAttribute('href', url);
      await expect(anchor).toHaveAttribute('target', '_blank');
      await expect(anchor).toHaveAttribute('rel', /noopener/);
      await expect(anchor).toHaveAttribute('rel', /noreferrer/);
      await context.route('https://example.org/margin-browser-source*', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><title>Browser external source fixture</title><h1>Browser external source fixture</h1>',
      }));
      const popupPromise = page.waitForEvent('popup');
      await anchor.click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL(url);
      await expect(popup.getByRole('heading', { name: 'Browser external source fixture' })).toBeVisible();
      assert.equal(await popup.evaluate(() => window.opener === null), true);
      await popup.close();
      report.externalLink = { url, navigation: 'Real anchor click to a new tab; external response is a local Playwright route fixture, not a live network measurement.' };
    });
    await check('safe link and display text survive save and reload in the source document', async () => {
      await back(page); await waitSaved(page); await page.reload(); await openSource(page);
      const row = page.locator('.editor-blocks .block-row').filter({ has: page.locator('.block-text').filter({ hasText: caption }) });
      await expect(row.locator('.block-text')).toHaveText(caption);
      await expect(row.getByRole('link', { name: url, exact: true })).toHaveAttribute('href', url);
    });
  });

  await scenario('Unsafe URL rejection', async page => {
    await load(page); await openSource(page);
    await check('javascript URL stays in the modal with an error and creates no executable content', async () => {
      const initialBlocks = await page.locator('.editor-blocks .block-row').count();
      const initialURL = page.url();
      await block(page, 'source-passage').click(); await button(page, 'Insert link').click();
      await page.locator('.link-attachments summary').click();
      const form = page.locator('.link-attachments form');
      const unsafeURL = 'javascript:window.__marginUnsafeExecuted=true';
      await form.getByLabel('Web address').fill(unsafeURL);
      await form.getByLabel('Display text or image caption').fill('Rejected executable URL');
      await form.getByRole('button', { name: 'Insert into document', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(form.getByRole('alert')).toContainText('Unsafe schemes are not accepted.');
      await expect(form.getByLabel('Web address')).toHaveValue(unsafeURL);
      await expect(page.locator('.editor-blocks .block-row')).toHaveCount(initialBlocks);
      await expect(page.locator('a[href^="javascript:" i]')).toHaveCount(0);
      await expect(page.locator('script').filter({ hasText: '__marginUnsafeExecuted' })).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.__marginUnsafeExecuted), undefined);
      assert.equal(page.url(), initialURL);
      await screenshot(page, 'unsafe-url-rejected');
    });
  });

  await scenario('Reusable image attachment', async page => {
    await load(page);
    await page.getByLabel('Import documents and images').setInputFiles(imageUpload);
    await expect(page.locator('.workspace-status')).toContainText('4 documents');
    await openSource(page);
    const caption = 'Reusable local image inside the threshold research';
    await check('an imported asset can be inserted into an existing document as a decoded image', async () => {
      await block(page, 'source-passage').click(); await button(page, 'Insert link').click();
      await page.locator('.link-attachments summary').click();
      const form = page.locator('.link-attachments form');
      await form.locator('select[name="kind"]').selectOption('image');
      await form.getByLabel('Display text or image caption').fill(caption);
      await form.locator('select[name="asset"]').selectOption({ label: imageUpload.name });
      await form.getByRole('button', { name: 'Insert into document', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('Threshold research');
      await expect(page.locator('.editor-blocks .block-text')).toHaveCount(6);
      await expect(page.locator('.editor-blocks .block-text').nth(2)).toHaveText(caption);
      const image = page.locator('.editor-blocks').getByRole('img', { name: caption, exact: true });
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth === 240 && img.naturalHeight === 144)).toBe(true);
      const imageBounds = await image.boundingBox();
      assert.ok(imageBounds.width >= 200 && imageBounds.height >= 120, 'reused image is visibly rendered at a meaningful size');
      await expect(image).toHaveAttribute('src', `data:image/png;base64,${imageUpload.buffer.toString('base64')}`);
      await expect(page.locator('.workspace-status')).toContainText('4 documents');
      await screenshot(page, 'reused-local-image-in-document');
    });
    await check('reused image and caption remain observable after reload', async () => {
      await back(page); await waitSaved(page); await page.reload(); await openSource(page);
      const image = page.locator('.editor-blocks').getByRole('img', { name: caption, exact: true });
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth === 240 && img.naturalHeight === 144)).toBe(true);
      await expect(page.locator('.block-text-image')).toHaveText(caption);
      await expect(page.locator('.workspace-status')).toContainText('4 documents');
    });
  });

  await scenario('Multiple file import transaction', async page => {
    await load(page);
    await check('one native multi-file selection imports both Markdown and image', async () => {
      await page.getByLabel('Import documents and images').setInputFiles([markdownUpload, imageUpload]);
      await expect(page.locator('.workspace-status')).toContainText('5 documents');
      await expect(page.getByTestId('canvas')).toHaveAttribute('data-total-count', '4');
      await expect(page.locator('.canvas-local-image')).toBeVisible();
    });
  });

  await scenario('Import export reload isolation', async page => {
    await load(page);
    await check('individual Markdown and raster uploads produce rendered editable content', async () => {
      await page.getByLabel('Import documents and images').setInputFiles(markdownUpload);
      await expect(page.locator('.workspace-status')).toContainText('4 documents');
      await page.getByLabel('Import documents and images').setInputFiles(imageUpload);
      await expect(page.locator('.workspace-status')).toContainText('5 documents');
      await page.getByRole('button', { name: /^All documents/ }).click();
      await page.locator('.library-card').filter({ has: page.getByRole('heading', { name: 'Arrival study', exact: true }) }).locator('.library-card-body').click();
      await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('Arrival study');
      await expect(page.locator('.block-text-quote')).toHaveText('The invitation is not an obligation.');
      await expect(page.locator('.block-text-code')).toHaveText('trial: reversible');
      await expect(page.getByRole('checkbox', { name: /Mark checklist block/ })).not.toBeChecked();
      await page.locator('.block-text-paragraph').fill('Imported Markdown remains editable and local.');
      await back(page); await board(page, 'Research desk');
      await page.getByTestId('canvas').focus(); await page.keyboard.press('Escape');
      await button(page, 'Fit board (0); fit selection (F)').click();
      await expect(page.locator('.canvas-local-image')).toBeVisible();
      assert.equal(await page.locator('.canvas-local-image').evaluate(img => img.complete && img.naturalWidth > 0), true);
    });
    let exported;
    let originalName;
    await check('JSON download is self-contained and opens as an isolated package', async () => {
      originalName = await page.locator('.workspace-switch strong').innerText();
      await button(page, 'Export').click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: /Complete workspace/ }).click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /\.margin\.json$/);
      exported = await readFile(await download.path());
      const data = JSON.parse(exported);
      assert.ok(data.assets[0].data.startsWith('data:image/png;base64,'));
      await button(page, 'Close dialog').click();
      await page.getByLabel('Open workspace package', { exact: true }).setInputFiles({ name: 'roundtrip.margin.json', mimeType: 'application/json', buffer: exported });
      await expect(page.locator('.workspace-switch strong')).toHaveText(`${originalName} (imported)`);
      await page.getByRole('button', { name: /^All documents/ }).click();
      const imported = page.locator('.library-card').filter({ has: page.getByRole('heading', { name: 'Arrival study', exact: true }) });
      await imported.locator('.library-card-body').click();
      await expect(page.locator('.block-text-paragraph')).toHaveText('Imported Markdown remains editable and local.');
      await page.locator('.block-text-paragraph').fill('Continuation belongs only to the imported workspace.');
      await back(page); await waitSaved(page); await page.reload();
      await page.getByRole('button', { name: /^All documents/ }).click();
      await imported.locator('.library-card-body').click();
      await expect(page.locator('.block-text-paragraph')).toHaveText('Continuation belongs only to the imported workspace.');
      await back(page); await page.locator('.workspace-switch').click();
      await page.locator('.workspace-menu').getByRole('button', { name: originalName, exact: true }).click();
      await page.getByRole('button', { name: /^All documents/ }).click();
      await imported.locator('.library-card-body').click();
      await expect(page.locator('.block-text-paragraph')).toHaveText('Imported Markdown remains editable and local.');
    });
    await check('malformed package cannot replace existing visible or persisted source', async () => {
      const invalid = JSON.parse(exported); invalid.boards[0].placements[0].documentId = 'nonexistent-document';
      await page.getByLabel('Open workspace package', { exact: true }).setInputFiles({ name: 'invalid.margin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
      await expect(page.getByRole('alert')).toContainText('Import was not applied');
      await expect(page.getByRole('alert')).toContainText('nonexistent document');
      await expect(page.locator('.workspace-switch strong')).toHaveText(originalName);
      await expect(page.locator('.block-text-paragraph')).toHaveText('Imported Markdown remains editable and local.');
      await back(page); await waitSaved(page); await page.reload();
      await expect(page.locator('.workspace-switch strong')).toHaveText(originalName);
      await page.getByRole('button', { name: /^All documents/ }).click();
      await expect(page.locator('.library-grid')).toContainText('Arrival study');
    });
  });

  await scenario('Document Markdown download', async page => {
    await load(page);
    const destinationDocumentId = await card(page, 'cost-card').getAttribute('data-document-id');
    await openSource(page);
    const title = 'Markdown export study';
    const heading = 'Edited export heading';
    const edited = 'Copper lantern export revision: keep the entry step-free.';
    const list = 'Budget for a paid host before expanding.';
    const task = 'Confirm the accessible arrival route';
    const code = 'protocol = "reversible";\n```literal fence```\nreview = "host funded";';
    await check('native edits create observable heading, list, checked task and code blocks', async () => {
      await page.getByLabel('Document title', { exact: true }).fill(title);
      await block(page, 'source-heading').fill(heading);
      await block(page, 'source-passage').fill(edited);
      await block(page, 'source-method').fill(list);
      await page.getByLabel('Block style', { exact: true }).selectOption('list');
      await button(page, 'Add block').click();
      await page.getByLabel('Block style', { exact: true }).selectOption('checklist');
      await page.locator('.block-active .block-text').fill(task);
      await page.locator('.block-active .block-checkbox').check();
      await button(page, 'Add block').click();
      await page.getByLabel('Block style', { exact: true }).selectOption('code');
      await page.locator('.block-active .block-text').fill(code);
      await expect(block(page, 'source-heading')).toHaveText(heading);
      await expect(block(page, 'source-passage')).toHaveText(edited);
      await expect(page.locator('.editor-blocks .block-text-list')).toHaveText(list);
      await expect(page.locator('.editor-blocks .block-text-checklist')).toHaveText(task);
      await expect(page.locator('.editor-blocks .block-checkbox')).toBeChecked();
      assert.equal(await page.locator('.editor-blocks .block-text-code').innerText(), code, 'rendered code preserves exact native line breaks');
      await expect(page.locator('.editor-blocks .block-text')).toHaveCount(7);
    });
    await check('individual Markdown download retains edited prose, semantic syntax and actual source IDs', async () => {
      await block(page, 'source-link').locator('xpath=ancestor::div[contains(@class,"block-row")]').locator('.block-link').click();
      await expect(page.getByLabel('Document title', { exact: true })).toHaveValue('The cost of welcome');
      const destination = page.locator('.block-highlighted .block-text');
      await expect(destination).toContainText('A free seat is not free to maintain.');
      const destinationBlockId = await destination.getAttribute('data-block-id');
      assert.equal(destinationDocumentId, 'cost');
      assert.equal(destinationBlockId, 'cost-passage');
      await button(page, 'Back to board').click();
      await expect(page.getByLabel('Document title', { exact: true })).toHaveValue(title);
      const downloadPromise = page.waitForEvent('download');
      await page.locator('.editor-header').getByRole('button', { name: 'Export Markdown', exact: true }).click();
      const download = await downloadPromise;
      assert.equal(await download.failure(), null);
      assert.equal(download.suggestedFilename(), `${title}.md`);
      const bytes = await readFile(await download.path());
      const markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      for (const expected of [
        `# ${title}\n`, `## ${heading}\n`, edited, `- ${list}\n`, `- [x] ${task}\n`,
        `\`\`\`\`\n${code}\n\`\`\`\``,
        '> A doorway can welcome someone without demanding a story in return.',
        `[Compare the cost of a staffed invitation.](#${destinationDocumentId}/${destinationBlockId})`,
      ]) assert.ok(markdown.includes(expected), `downloaded Markdown contains ${JSON.stringify(expected)}`);
      assert.ok(!markdown.includes(passage), 'export uses the edited paragraph, not stale fixture content');
      assert.ok(markdown.endsWith('\n'));
      const file = path.join(screenshotDir, 'margin-check-document-export.md');
      await download.saveAs(file);
      report.markdownExport = { filename: download.suggestedFilename(), utf8Bytes: bytes.length, sha256: sha256(bytes), destinationDocumentId, destinationBlockId, contents: markdown, file };
      await screenshot(page, 'markdown-export-source');
    });
  });

  await scenario('Board SVG download and render', async (page, context) => {
    await load(page);
    const title = 'Threshold & care';
    const literal = '<script>window.svgProbe=1</script> & idea';
    const frameTitle = 'Access & care <review>';
    const label = 'Paid care & access <not markup>';
    let xml, parsed, expectedGeometry;
    await check('board export source contains native edited text, a named frame, directed connection and imported image', async () => {
      await openSource(page);
      await page.getByLabel('Document title', { exact: true }).fill(title);
      await block(page, 'source-passage').fill(literal);
      await expect(block(page, 'source-passage')).toHaveText(literal);
      await expect(block(page, 'source-passage').locator('script')).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.svgProbe), undefined);
      await back(page);
      await expect(card(page, 'source-card')).toContainText(literal);
      await card(page, 'source-card').locator('.canvas-card-move').click();
      await card(page, 'cost-card').locator('.canvas-card-move').click({ modifiers: ['Shift'] });
      await button(page, 'Group in named frame').click();
      await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(frameTitle);
      await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.locator('.map-frame-title')).toContainText(frameTitle);
      await button(page, 'Close inspector').click();
      await button(page, 'Connections').click(); await button(page, 'Add relationship').click();
      const modal = page.getByRole('dialog');
      await modal.locator('select[name="from"]').selectOption('source-card');
      await modal.locator('select[name="to"]').selectOption('cost-card');
      await modal.locator('select[name="type"]').selectOption('supports');
      await modal.getByLabel('Label', { exact: true }).fill(label);
      await modal.locator('input[name="directed"]').check();
      await button(page, 'Create connection').click();
      await expect(page.locator('.relationship-row')).toContainText(label);
      await button(page, 'Canvas').click(); await button(page, 'Close inspector').click();
      await expect(page.locator('.canvas-relationship-line')).toHaveAttribute('marker-end', /url/);
      await page.getByLabel('Import documents and images').setInputFiles(imageUpload);
      await expect(page.locator('.workspace-status')).toContainText('4 documents');
      await expect(page.locator('.canvas-local-image')).toBeVisible();
      await dragHeader(page, page.locator('.map-card-image .canvas-card-move'), 0, 250);
      await button(page, 'Close inspector').click();
      expectedGeometry = await page.evaluate(() => Object.fromEntries([
        ['source', '[data-placement-id="source-card"]'], ['destination', '[data-placement-id="cost-card"]'], ['frame', '.map-frame'],
      ].map(([name, selector]) => {
        const { left, top, width, height } = document.querySelector(selector).style;
        return [name, { x: parseFloat(left), y: parseFloat(top), width: parseFloat(width), height: parseFloat(height) }];
      })));
    });
    await check('downloaded SVG parses as XML and retains visible titles, body, frame, label and embedded raster bytes', async () => {
      await button(page, 'Export').click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: /This board as SVG/ }).click();
      const download = await downloadPromise;
      assert.equal(await download.failure(), null);
      assert.equal(download.suggestedFilename(), 'Research desk.svg');
      const bytes = await readFile(await download.path());
      xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      parsed = await page.evaluate(({ xml, title, frameTitle }) => {
        const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
        const rect = element => element && Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(element.getAttribute(key))]));
        const texts = [...doc.querySelectorAll('text')].map(element => element.textContent);
        const cardGroup = name => [...doc.querySelectorAll('g')].find(group => group.firstElementChild?.localName === 'title' && group.firstElementChild.textContent.startsWith(`${name}\n`));
        const frameLabel = [...doc.querySelectorAll('text')].find(element => element.textContent === frameTitle);
        return {
          parserErrors: [...doc.querySelectorAll('parsererror')].map(element => element.textContent),
          root: doc.documentElement.localName, namespace: doc.documentElement.namespaceURI,
          width: Number(doc.documentElement.getAttribute('width')), height: Number(doc.documentElement.getAttribute('height')),
          viewBox: doc.documentElement.getAttribute('viewBox')?.split(/\s+/).map(Number), texts,
          metadata: [...doc.querySelectorAll('title')].map(element => element.textContent),
          source: rect(cardGroup(title)?.querySelector('rect')), destination: rect(cardGroup('The cost of welcome')?.querySelector('rect')),
          frame: frameLabel?.previousElementSibling?.localName === 'rect' ? rect(frameLabel.previousElementSibling) : null,
          images: [...doc.querySelectorAll('image')].map(element => ({ ...rect(element), href: element.getAttribute('href') })),
          directedPaths: [...doc.querySelectorAll('path[marker-end]')].map(element => ({ d: element.getAttribute('d'), marker: element.getAttribute('marker-end') })),
          markers: [...doc.querySelectorAll('marker')].map(element => ({ id: element.id, d: element.querySelector('path')?.getAttribute('d'), fill: element.querySelector('path')?.getAttribute('fill') })),
          executableElements: [...doc.querySelectorAll('*')].filter(element => ['script', 'foreignobject'].includes(element.localName.toLowerCase())).map(element => element.localName),
          unsafeAttributes: [...doc.querySelectorAll('*')].flatMap(element => [...element.attributes].filter(attribute => /^on/i.test(attribute.name) || /^(?:javascript|vbscript):/i.test(attribute.value)).map(attribute => attribute.name)),
        };
      }, { xml, title, frameTitle });
      assert.deepEqual(parsed.parserErrors, []);
      assert.equal(parsed.root, 'svg'); assert.equal(parsed.namespace, 'http://www.w3.org/2000/svg');
      for (const text of ['Research desk / Margin', title, 'The cost of welcome', frameTitle, `supports / ${label}`, literal, 'A free seat is not free to maintain.']) {
        assert.ok(parsed.texts.join(' ').includes(text), `visible SVG text retains ${JSON.stringify(text)}`);
      }
      assert.ok(parsed.metadata.some(text => text.startsWith(`${title}\n`) && text.includes(literal)));
      assert.deepEqual(parsed.source, expectedGeometry.source);
      assert.deepEqual(parsed.destination, expectedGeometry.destination);
      assert.deepEqual(parsed.frame, expectedGeometry.frame);
      assert.equal(parsed.images.length, 1);
      assert.equal(parsed.images[0].href, `data:image/png;base64,${imageUpload.buffer.toString('base64')}`);
      assert.ok(parsed.width > 0 && parsed.height > 0 && parsed.viewBox.every(Number.isFinite));
      const file = path.join(screenshotDir, 'margin-check-board-export.svg');
      await download.saveAs(file);
      report.svgExport = { filename: download.suggestedFilename(), utf8Bytes: bytes.length, sha256: sha256(bytes), file, parsed };
    });
    await check('SVG escapes script-like prose and connects directed markers at rectangle edges rather than hidden centers', async () => {
      assert.ok(xml.includes('&lt;script&gt;window.svgProbe=1&lt;/script&gt; &amp; idea'));
      assert.ok(xml.includes('Access &amp; care &lt;review&gt;'));
      assert.ok(xml.includes('Paid care &amp; access &lt;not markup&gt;'));
      assert.ok(!/<script(?:\s|>)/i.test(xml));
      assert.deepEqual(parsed.executableElements, []); assert.deepEqual(parsed.unsafeAttributes, []);
      assert.equal(parsed.directedPaths.length, 1);
      const connector = parsed.directedPaths[0];
      const markerId = connector.marker.match(/^url\(#([^)]+)\)$/)?.[1];
      const marker = parsed.markers.find(item => item.id === markerId);
      assert.ok(marker?.d && marker.fill && marker.fill !== 'none', 'directed path references an actual filled marker path');
      const points = connector.d.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number);
      assert.equal(points?.length, 4, 'exported connector has two line endpoints');
      for (const [point, rect] of [[[points[0], points[1]], parsed.source], [[points[2], points[3]], parsed.destination]]) {
        const [x, y] = point;
        assert.ok(x >= rect.x - 0.001 && x <= rect.x + rect.width + 0.001 && y >= rect.y - 0.001 && y <= rect.y + rect.height + 0.001);
        assert.ok(Math.min(Math.abs(x - rect.x), Math.abs(x - rect.x - rect.width), Math.abs(y - rect.y), Math.abs(y - rect.y - rect.height)) < 0.001, 'connector endpoint lies on its card rectangle edge');
      }
      assert.ok(points[0] < points[2], 'direction runs from the left source toward the right destination');
      assert.equal(await page.evaluate(() => window.svgProbe), undefined);
    });
    await check('downloaded SVG decodes as a local Blob image with real raster pixels and no script execution', async () => {
      const preview = await context.newPage();
      await preview.setContent('<!doctype html><title>Downloaded board SVG verification</title><style>body{margin:24px;background:#fff;font:16px sans-serif}h1{font-size:22px}img{display:block;max-width:95vw;max-height:82vh}p{font-size:13px}</style><h1>Downloaded Research desk SVG</h1><img alt="Downloaded board SVG"><p id="result"></p>');
      const rendering = await preview.evaluate(async ({ xml, parsed, label }) => {
        const image = document.querySelector('img');
        const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
        try {
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          const embedded = parsed.images[0];
          const scale = Math.min(embedded.width / 240, embedded.height / 144);
          const x = Math.round(embedded.x - parsed.viewBox[0] + (embedded.width - 240 * scale) / 2 + 20 * scale);
          const y = Math.round(embedded.y - parsed.viewBox[1] + (embedded.height - 144 * scale) / 2 + 20 * scale);
          const pixel = [...context.getImageData(x, y, 1, 1).data];
          // The XML has already passed executable-element/attribute checks. Measure its real text layout offscreen.
          const svg = document.importNode(new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement, true);
          svg.style.position = 'absolute'; svg.style.left = '-20000px';
          document.body.append(svg);
          const labelElement = [...svg.querySelectorAll('text')].find(element => element.textContent === `supports / ${label}`);
          const labelBounds = labelElement.getBBox();
          const labelOcclusion = [...svg.querySelectorAll('g > rect')].filter(rect => labelElement.compareDocumentPosition(rect) & Node.DOCUMENT_POSITION_FOLLOWING).flatMap(rect => {
            const bounds = rect.getBBox();
            const overlapWidth = Math.min(labelBounds.x + labelBounds.width, bounds.x + bounds.width) - Math.max(labelBounds.x, bounds.x);
            const overlapHeight = Math.min(labelBounds.y + labelBounds.height, bounds.y + bounds.height) - Math.max(labelBounds.y, bounds.y);
            return overlapWidth > 1 && overlapHeight > 1 ? [{
              card: rect.parentElement.querySelector('title')?.textContent.split('\n')[0],
              overlapWidth, overlapHeight, labelCoverage: overlapWidth * overlapHeight / (labelBounds.width * labelBounds.height),
            }] : [];
          });
          const labelLayout = { text: labelElement.textContent, x: labelBounds.x, y: labelBounds.y, width: labelBounds.width, height: labelBounds.height, occludedByLaterCards: labelOcclusion };
          svg.remove();
          document.querySelector('#result').textContent = `Decoded export: ${image.naturalWidth} x ${image.naturalHeight} px. Embedded raster sample: ${pixel.join(', ')}.`;
          return { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, embeddedPixel: pixel, labelLayout, scriptExecuted: window.svgProbe !== undefined, scriptElements: document.querySelectorAll('script').length };
        } finally { URL.revokeObjectURL(url); }
      }, { xml, parsed, label });
      await expect(preview.getByRole('img', { name: 'Downloaded board SVG', exact: true })).toBeVisible();
      assert.equal(rendering.complete, true);
      assert.equal(rendering.naturalWidth, parsed.width); assert.equal(rendering.naturalHeight, parsed.height);
      assert.deepEqual(rendering.embeddedPixel, [80, 103, 69, 255], 'embedded PNG dark-green border is actually rendered, not merely serialized');
      assert.equal(rendering.scriptExecuted, false); assert.equal(rendering.scriptElements, 0);
      assert.equal(await page.evaluate(() => window.svgProbe), undefined);
      report.svgExport.rendering = rendering;
      report.svgExport.screenshot = await screenshot(preview, 'board-svg-render');
      await preview.close();
    });
    await check('authored SVG relationship label stays visible rather than being painted under a card', async () => {
      assert.deepEqual(report.svgExport.rendering.labelLayout.occludedByLaterCards, [], 'SVG relationship label is covered by a later opaque card; see margin-check-board-svg-render.png');
    });
  });

  await scenario('Quota failure and retry', async page => {
    await load(page); await openSource(page);
    await check('Storage.setItem quota failure is visible and keeps unsaved work', async () => {
      await page.evaluate(() => {
        window.__marginOriginalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('margin:')) throw new DOMException('Synthetic browser quota exhausted', 'QuotaExceededError');
          return window.__marginOriginalSetItem.call(this, key, value);
        };
      });
      await block(page, 'source-passage').fill(revision);
      await expect(page.locator('.save-indicator')).toHaveText('Not saved - retry', { timeout: 12000 });
      await expect(page.getByRole('alert')).toContainText('Your current work is still here');
      await expect(block(page, 'source-passage')).toHaveText(revision);
    });
    await check('restoring the native prototype and Retry persists the same work', async () => {
      await page.evaluate(() => { Storage.prototype.setItem = window.__marginOriginalSetItem; delete window.__marginOriginalSetItem; });
      await page.locator('.save-indicator').click(); await waitSaved(page);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await back(page); await page.reload(); await openSource(page);
      await expect(block(page, 'source-passage')).toHaveText(revision);
    });
  });

  await scenario('Blank workspace isolation', async page => {
    await load(page);
    await check('new blank workspace has no imported documents or placements', async () => {
      await page.locator('.workspace-switch').click(); await button(page, 'New blank workspace').click();
      await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Isolated blank');
      await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.locator('.workspace-switch strong')).toHaveText('Isolated blank');
      await expect(page.getByTestId('canvas')).toHaveAttribute('data-total-count', '0');
      await expect(page.locator('.workspace-status')).toContainText('0 documents');
      await searchFor(page, 'copper lantern protocol');
      await expect(page.locator('.search-result')).toHaveCount(0);
      await page.keyboard.press('Escape'); await page.locator('.workspace-switch').click();
      await page.locator('.workspace-menu').getByRole('button', { name: 'Browser research (imported)', exact: true }).click();
      await expect(card(page, 'source-card')).toContainText(passage);
    });
  });

  await scenario('Native input and keyboard safety', async page => {
    await load(page);
    await check('dragging native card text selects text without moving a placement', async () => {
      const source = card(page, 'source-card');
      const initial = await source.getAttribute('style');
      const text = source.locator('.canvas-block-paragraph p').first();
      const box = await text.boundingBox();
      await page.mouse.move(box.x + 2, box.y + 8); await page.mouse.down();
      await page.mouse.move(box.x + Math.min(180, box.width - 5), box.y + 28, { steps: 12 }); await page.mouse.up();
      assert.ok((await page.evaluate(() => window.getSelection().toString())).length > 8, 'native browser text selection is nonempty');
      await expect(source).toHaveAttribute('style', initial);
    });
    await openSource(page);
    await check('Enter, Shift+Enter, Ctrl+Z and text deletion do not remove board cards', async () => {
      const initialCount = await page.getByTestId('canvas').getAttribute('data-total-count');
      await block(page, 'source-passage').fill('Keyboard safety baseline');
      await block(page, 'source-passage').press('Control+End'); await page.keyboard.press('Enter');
      await expect(page.locator('.editor-blocks .block-text')).toHaveCount(6);
      await page.keyboard.press('Control+z');
      await expect(page.locator('.editor-blocks .block-text')).toHaveCount(5);
      await expect(block(page, 'source-passage')).toHaveText('Keyboard safety baseline');
      await block(page, 'source-passage').press('Control+End'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Next line');
      await expect(block(page, 'source-passage')).toContainText('Next line');
      await expect(page.locator('.editor-blocks .block-text')).toHaveCount(5);
      await page.getByLabel('Document title', { exact: true }).fill('Title input safety');
      await page.getByLabel('Document title', { exact: true }).press('Backspace');
      await expect(page.getByTestId('canvas')).toHaveAttribute('data-total-count', initialCount);
      await page.keyboard.press('Control+k');
      await expect(page.getByLabel('Search workspace', { exact: true })).toBeVisible();
      await page.getByLabel('Search workspace', { exact: true }).fill('copper');
      await page.keyboard.press('Control+z'); await page.keyboard.press('Escape');
      await expect(page.getByTestId('canvas')).toHaveAttribute('data-total-count', initialCount);
    });
  });

  await scenario('CtrlK search focus', async page => {
    await load(page);
    await check('Ctrl+K focuses the search input so typing immediately searches', async () => {
      await page.keyboard.press('Control+k');
      await expect(page.getByLabel('Search workspace', { exact: true })).toBeFocused();
      await page.keyboard.type('copper lantern protocol purchase');
      await expect(page.getByLabel('Search workspace', { exact: true })).toHaveValue('copper lantern protocol purchase');
      await expect(page.locator('.search-result')).toHaveCount(1);
      await expect(page.locator('.search-result')).toContainText('Threshold research');
      await expect(page.locator('.search-result p')).toContainText('Copper lantern protocol: keep a seat');
      await page.keyboard.press('Enter');
      await expect(page.locator('.block-highlighted .block-text')).toHaveAttribute('data-block-id', 'source-passage');
    });
  });

  await scenario('Mobile reduced motion', async page => {
    await load(page, false);
    await check('mobile canvas and controls fit the viewport with reduced motion', async () => {
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      await expect(page.locator('.app')).toHaveClass(/reduce-motion/);
      await button(page, 'Fit board (0); fit selection (F)').click();
      const geometry = await page.evaluate(() => {
        const selectors = ['.main-shell', '.spatial-canvas', '.canvas-toolbar', '.canvas-zoom'];
        return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
          boxes: selectors.map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }),
          transition: getComputedStyle(document.querySelector('.sidebar')).transitionDuration };
      });
      report.mobile = geometry;
      assert.ok(geometry.documentWidth <= geometry.viewport.width + 1);
      for (const rect of geometry.boxes) {
        assert.ok(rect.x >= -1 && rect.right <= geometry.viewport.width + 1, `${rect.selector} fits horizontally: ${JSON.stringify(rect)}`);
        assert.ok(rect.y >= -1 && rect.bottom <= geometry.viewport.height + 1, `${rect.selector} fits vertically`);
      }
      assert.equal(geometry.transition, '0s');
      await screenshot(page, 'mobile-reduced-motion');
    });
    await check('mobile navigation and search can open an exact source', async () => {
      await button(page, 'Open navigation').click();
      await page.getByRole('button', { name: /^Search anything/ }).click();
      await page.getByLabel('Search workspace', { exact: true }).fill('spare chair');
      await expect(page.locator('.search-result').first()).toBeVisible();
      await page.locator('.search-result').first().click();
      await expect(page.locator('.block-highlighted')).toBeVisible();
      const rect = await page.locator('.editor-overlay').boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 391);
      await screenshot(page, 'mobile-editor');
    });
  }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });

  await scenario('500 document performance', async (page, context) => {
    const fixture = performanceFixture();
    report.performance = { workload: 'Synthetic: 500 expanded documents based on all 32 substantive Common Ground studies, distinct research indices and remapped internal links; no lorem ipsum. One board of 300 spatial placements, not a fit-all screenshot.', counts: fixture.counts,
      mode: report.detectedMode, viewport: { width: 1440, height: 1000 }, samplesPerOperation: 7, warmup: 'One unrecorded search; navigation, save and gesture series include their first invocation.',
      methodology: 'Browser performance.now starts at capture-phase native input/beforeinput/pointerdown. requestAnimationFrame observes the requested DOM output. Search includes deferred React results and next animation frame; navigation includes exact highlighted passage. Raw keystrokeToLiveDOM observes the mounted canvas excerpt behind the open editor overlay, without waiting for persistence; this is DOM propagation, not unobscured pixel presentation. A separate seven-keystroke save-inclusive series starts after the prior autosave settles and includes the 650ms debounce, validation, serialization and localStorage roundtrip. Gesture frame intervals are rAF gaps during 20 native mouse steps or a zoom click and two settling frames; not GPU/presentation latency or a Lighthouse score. p95 uses nearest rank; 7-sample p95 is the maximum. No pass/fail latency budget.',
    };
    await context.addInitScript(workspace => {
      if (!localStorage.getItem('margin:active')) {
        localStorage.setItem(`margin:workspace:${workspace.id}`, JSON.stringify(workspace));
        localStorage.setItem('margin:index', JSON.stringify([{ id: workspace.id, name: workspace.name, updatedAt: workspace.createdAt }]));
        localStorage.setItem('margin:active', workspace.id);
      }
    }, fixture.workspace);
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.goto(base); await waitSaved(page);
    await check('500 docs / 300 placements / live excerpts and links are loaded in the actual UI with culling', async () => {
      await expect(page.locator('.workspace-status')).toContainText('500 documents');
      await expect(page.getByTestId('canvas')).toHaveAttribute('data-total-count', '300');
      await expect(card(page, 'perf-placement-1')).toContainText(performancePhrase(0));
      const counts = await page.getByTestId('canvas').evaluate(el => ({ total: +el.dataset.totalCount, visibleAttribute: +el.dataset.visibleCount, cardDOM: el.querySelectorAll('[data-placement-id]').length, relationshipDOM: el.querySelectorAll('[data-relationship-id]').length, allCanvasDOM: el.querySelectorAll('*').length, allPageDOM: document.querySelectorAll('*').length, overviewCards: el.querySelectorAll('.map-card-overview').length }));
      assert.equal(counts.visibleAttribute, counts.cardDOM);
      assert.ok(counts.cardDOM > 0 && counts.cardDOM < 300, 'offscreen placements are culled');
      assert.equal(counts.overviewCards, 0, 'performance surface is normal reading-size cards, not collapsed fit-all');
      report.performance.dom = counts;
      report.performance.browser = await page.evaluate(() => ({ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory, devicePixelRatio, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }));
      await screenshot(page, 'performance-500docs-300placements');
    });
    await check('seven unique phrase searches produce exact browser result text', async () => {
      await searchFor(page, performancePhrase(499)); await expect(page.locator('.search-result')).toHaveCount(1);
      const times = [];
      for (const index of [17, 81, 149, 227, 301, 413, 487]) {
        const phrase = performancePhrase(index);
        await startMeter(page, { event: 'input', selector: '.search-result p', expectedText: phrase });
        await page.getByLabel('Search workspace', { exact: true }).fill(phrase);
        times.push((await finishMeter(page)).ms);
        await expect(page.locator('.search-result')).toHaveCount(1);
        await expect(page.locator('.search-result strong')).toContainText(`Research ${String(index).padStart(4, '0')}`);
      }
      report.performance.searchResultDOM = stats(times);
      await page.keyboard.press('Escape');
    });
    await check('seven document navigations show exact target passages', async () => {
      const times = [];
      for (const index of [29, 97, 163, 239, 317, 421, 493]) {
        await searchFor(page, performancePhrase(index)); await expect(page.locator('.search-result')).toHaveCount(1);
        await startMeter(page, { event: 'pointerdown', selector: '.block-highlighted .block-text', attribute: 'data-block-id', expectedValue: `perf-block-${index}-1` });
        await page.locator('.search-result').click(); times.push((await finishMeter(page)).ms);
        await expect(block(page, `perf-block-${index}-1`)).toContainText(performancePhrase(index));
        await back(page);
      }
      report.performance.documentNavigationDOM = stats(times);
    });
    await check('seven real keystrokes propagate to live excerpt DOM without waiting for autosave', async () => {
      await waitSaved(page);
      await card(page, 'perf-placement-0').focus(); await page.keyboard.press('Enter');
      const input = block(page, 'perf-block-0-1');
      await input.press('Control+End');
      const initial = await input.innerText();
      const times = [];
      for (let index = 0; index < 7; index++) {
        const text = `${initial}${'r'.repeat(index + 1)}`;
        await startMeter(page, { event: 'beforeinput', selector: '[data-placement-id="perf-placement-1"] .canvas-card-body', expectedText: text });
        await page.keyboard.type('r'); times.push((await finishMeter(page)).ms);
        await expect(input).toHaveText(text);
      }
      await back(page);
      await expect(card(page, 'perf-placement-1')).toContainText(`${initial}rrrrrrr`);
      report.performance.keystrokeToLiveDOM = stats(times);
      await waitSaved(page);
    });
    await check('seven independent editing keystrokes save and refresh a live excerpt at scale', async () => {
      await waitSaved(page);
      await card(page, 'perf-placement-0').focus(); await page.keyboard.press('Enter');
      const input = block(page, 'perf-block-0-1');
      await input.press('Control+End');
      const initial = await input.innerText();
      const times = [];
      for (let index = 0; index < 7; index++) {
        const text = `${initial}${'x'.repeat(index + 1)}`;
        await startMeter(page, { event: 'beforeinput', selector: '[data-placement-id="perf-placement-1"] .canvas-card-body', expectedText: text, savedText: text });
        await page.keyboard.type('x'); times.push((await finishMeter(page)).ms);
        await expect(input).toHaveText(text);
      }
      await back(page);
      await expect(card(page, 'perf-placement-1')).toContainText(`${initial}xxxxxxx`);
      report.performance.keystrokeToLiveAndSaved = stats(times);
    });
    await check('seven zooms and header drags render changed geometry with measured rAF intervals', async () => {
      const zoomTimes = [], zoomFrames = [], dragTimes = [], dragFrames = [];
      for (let index = 0; index < 7; index++) {
        const before = await page.locator('.canvas-world').getAttribute('style');
        await startMeter(page, { event: 'pointerdown', gesture: true });
        await button(page, index % 2 ? 'Zoom out (-)' : 'Zoom in (+)').click();
        const zoom = await finishMeter(page, true); zoomTimes.push(zoom.ms); zoomFrames.push(...zoom.frames);
        await expect(page.locator('.canvas-world')).not.toHaveAttribute('style', before);
      }
      await page.getByRole('button', { name: /^Zoom \d+%. Reset to 100%$/ }).click();
      for (let index = 0; index < 7; index++) {
        const before = await card(page, 'perf-placement-0').getAttribute('style');
        const line = page.locator('[data-relationship-id="perf-relationship-0"] .canvas-relationship-line');
        const beforeLine = await line.getAttribute('d');
        await startMeter(page, { event: 'pointerdown', gesture: true });
        await dragHeader(page, card(page, 'perf-placement-0').locator('.canvas-card-move'), index % 2 ? -65 : 65, index % 2 ? -45 : 45, 20);
        const drag = await finishMeter(page, true); dragTimes.push(drag.ms); dragFrames.push(...drag.frames);
        await expect(card(page, 'perf-placement-0')).not.toHaveAttribute('style', before);
        await expect(line).not.toHaveAttribute('d', beforeLine);
        if (await button(page, 'Close inspector').isVisible()) await button(page, 'Close inspector').click();
      }
      report.performance.zoomGestureDuration = stats(zoomTimes); report.performance.zoomFrameIntervals = stats(zoomFrames);
      report.performance.dragGestureDuration = stats(dragTimes); report.performance.dragFrameIntervals = stats(dragFrames);
      await screenshot(page, 'performance-after-gestures');
    });
  });
}

async function main() {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(screenshotDir, { recursive: true });
  try {
    if (!external) {
      try { await access(path.join(root, 'dist/index.html')); }
      catch { throw new Error('Production build missing. Run npm run build before npm run verify:browser, or set MARGIN_URL to an existing dev server.'); }
      server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5198', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      server.stdout.on('data', chunk => { serverLog += chunk; });
      server.stderr.on('data', chunk => { serverLog += chunk; });
      server.on('error', error => { serverLog += error.message; });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (server.exitCode !== null) throw new Error(`Vite preview exited: ${serverLog}`);
        // Wait for our own server's ready line, never accidentally test an occupied port.
        if (serverLog.includes('http://127.0.0.1:5198')) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error(`Vite preview did not become ready: ${serverLog}`);
    }
    const response = await fetch(base);
    assert.equal(response.status, 200, 'target returns HTTP 200');
    const html = await response.text();
    report.detectedMode = html.includes('/@vite/client') ? 'Vite development' : 'production build';
    report.entryHTMLSha256 = sha256(html);
    report.gitHeadAtStart = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    report.sourceHashesAtStart = Object.fromEntries(await Promise.all(['src/App.jsx', 'src/Canvas.jsx', 'src/Editor.jsx', 'src/core.js', 'src/styles.css', 'src/canvas.css', 'src/editor.css'].map(async file => [file, sha256(await readFile(path.join(root, file)))])));
    const assets = [...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map(match => match[1]);
    report.servedAssetHashes = Object.fromEntries(await Promise.all(assets.map(async asset => [asset, sha256(Buffer.from(await (await fetch(new URL(asset, base))).arrayBuffer()))])));
    browser = await chromium.launch({ headless: true });
    report.chromiumVersion = browser.version();
    console.log(`Margin browser check: ${base} (${report.detectedMode}), headless Chromium ${browser.version()}`);
    await runChecks();
  } catch (error) {
    report.fatalError = error.stack; console.error(error.stack);
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise(resolve => { const timeout = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 3000); server.once('exit', () => { clearTimeout(timeout); resolve(); }); });
    }
    report.finishedAt = new Date().toISOString();
    report.hardware.loadAverageAtEnd = os.loadavg();
    report.hardware.freeMemoryBytesAtEnd = os.freemem();
    report.sourceChangedDuringRun = [];
    for (const [file, hash] of Object.entries(report.sourceHashesAtStart || {})) {
      if (sha256(await readFile(path.join(root, file))) !== hash) report.sourceChangedDuringRun.push(file);
    }
    report.summary = {
      scenarios: report.scenarios.length, passedScenarios: report.scenarios.filter(s => s.status === 'passed').length,
      failedScenarios: report.scenarios.filter(s => s.status === 'failed').length,
      assertions: report.assertions.length, passedAssertions: report.assertions.filter(a => a.status === 'passed').length,
      failedAssertions: report.assertions.filter(a => a.status === 'failed').length, browserErrors: report.browserErrors.length,
    };
    report.findings = report.scenarios.filter(s => s.status === 'failed').map(s => ({
      scenario: s.name, error: s.error || s.browserError,
      failedChecks: report.assertions.filter(a => a.scenario === s.name && a.status === 'failed').map(a => a.name),
      observedUI: s.observedUI, screenshot: s.screenshot,
    }));
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ summary: report.summary, timings: Object.fromEntries(Object.entries(report.performance).filter(([, value]) => value?.medianMs !== undefined).map(([key, { samples, ...value }]) => [key, value])), failures: report.assertions.filter(a => a.status === 'failed').map(a => ({ scenario: a.scenario, assertion: a.name, error: a.error })), report: reportPath }, null, 2));
    if (report.fatalError || report.summary.failedScenarios || report.sourceChangedDuringRun.length) process.exitCode = 1;
  }
}

await main();
