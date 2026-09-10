import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Document, Vec } from '../../src/core/model';

async function documentOf(page: Page) {
  return page.evaluate(() => window.__datum.getDocument());
}
async function xy(page: Page, p: Vec) {
  return page.evaluate((p) => {
    const v = window.__datum.getView(),
      r = document.querySelector('[data-testid="sketch-canvas"]')!.getBoundingClientRect();
    return { x: r.x + v.x + p.x * v.scale, y: r.y + v.y - p.y * v.scale };
  }, p);
}
async function clickWorld(page: Page, p: Vec) {
  const q = await xy(page, p);
  await page.mouse.click(q.x, q.y);
}
async function dragWorld(page: Page, a: Vec, b: Vec, steps = 10) {
  const from = await xy(page, a),
    to = await xy(page, b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
async function example(page: Page, id: string) {
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.getByTestId(`example-${id}`).click();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}
async function dimension(page: Page, label: string, value: string) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await input.fill(value);
  await input.press('Enter');
}

// Independent geometry oracle executed in the browser, not solver success flags.
async function assertResiduals(page: Page) {
  const errors = await page.evaluate(() => {
    const d = window.__datum.getDocument();
    const pos = (t: { entity: string; point: string }) => {
      const e = d.entities.find((e) => e.id === t.entity)!;
      return e.type === 'line' ? e[t.point as 'a' | 'b'] : e.type === 'circle' ? e.center : e;
    };
    const line = (id: string) => {
      const e = d.entities.find((e) => e.id === id)!;
      if (e.type !== 'line') throw Error('Line expected');
      return e;
    };
    let position = 0,
      angular = 0;
    for (const c of d.constraints) {
      if (c.type === 'fixed') {
        const p = pos(c.target);
        position = Math.max(position, Math.hypot(p.x - c.x, p.y - c.y));
      }
      if (c.type === 'coincident' || c.type === 'distance') {
        const a = pos(c.a),
          b = pos(c.b);
        position = Math.max(
          position,
          Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - (c.type === 'distance' ? c.value : 0)),
        );
      }
      if (c.type === 'radius') {
        const e = d.entities.find((e) => e.id === c.circle)!;
        if (e.type === 'circle') position = Math.max(position, Math.abs(e.radius - c.value));
      }
      if (c.type === 'horizontal' || c.type === 'vertical') {
        const e = line(c.line);
        position = Math.max(position, Math.abs(c.type === 'horizontal' ? e.a.y - e.b.y : e.a.x - e.b.x));
      }
      if (c.type === 'parallel' || c.type === 'perpendicular') {
        const a = line(c.a),
          b = line(c.b),
          ux = a.b.x - a.a.x,
          uy = a.b.y - a.a.y,
          vx = b.b.x - b.a.x,
          vy = b.b.y - b.a.y;
        angular = Math.max(
          angular,
          Math.abs(c.type === 'parallel' ? ux * vy - uy * vx : ux * vx + uy * vy) /
            (Math.hypot(ux, uy) * Math.hypot(vx, vy)),
        );
      }
    }
    return { position, angular };
  });
  expect(errors.position).toBeLessThanOrEqual(1e-5);
  expect(errors.angular).toBeLessThanOrEqual(1e-6);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__datum);
});

test('creates arbitrary geometry, constrains, drags, edits, undoes/redoes, exports/imports', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.getByRole('button', { name: 'New sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Line tool', exact: true }).click();
  await clickWorld(page, { x: 0, y: 0 });
  const preview = await xy(page, { x: 63, y: 37 });
  await page.mouse.move(preview.x, preview.y);
  await expect(page.locator('.preview')).toBeVisible();
  await clickWorld(page, { x: 63, y: 37 });
  let d = await documentOf(page);
  expect(d.entities).toHaveLength(1);
  expect(d.constraints.map((c) => c.type)).toContain('fixed');
  const lineId = d.entities[0].id;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Circle tool', exact: true }).click();
  await clickWorld(page, { x: 63, y: 37 });
  await clickWorld(page, { x: 81, y: 37 });
  d = await documentOf(page);
  expect(d.entities).toHaveLength(2);
  expect(d.constraints.map((c) => c.type)).toContain('coincident');
  await page.keyboard.press('Escape');
  await clickWorld(page, { x: 81, y: 37 });
  await page.getByRole('button', { name: 'Add Radius', exact: true }).click();
  await page.getByRole('textbox', { name: 'New dimension value' }).fill('18.123456789');
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click();
  d = await documentOf(page);
  const radius = d.constraints.find((c) => c.type === 'radius')!;
  expect(radius.type === 'radius' && radius.value).toBe(18.123456789);
  await page.getByRole('button', { name: 'Select tool' }).click();
  await dragWorld(page, { x: 63, y: 37 }, { x: 72, y: 47 }, 12);
  d = await documentOf(page);
  const circle = d.entities.find((e) => e.type === 'circle')!;
  expect(circle.type === 'circle' && circle.center.x).toBeCloseTo(72, 2);
  await assertResiduals(page);
  await dimension(page, `Dimension ${radius.id}`, '25.987654321');
  await assertResiduals(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  d = await documentOf(page);
  expect(d.entities.find((e) => e.type === 'circle')?.radius).toBeCloseTo(18.123456789, 8);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const saved = await documentOf(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sketch', exact: true }).click();
  const download = await downloadPromise,
    exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as Document;
  expect(exported).toEqual(saved);
  await page.getByRole('button', { name: 'New sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByLabel('Sketch JSON file').setInputFiles({
    name: 'custom.datum.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  expect(await documentOf(page)).toEqual(saved);
  await dimension(page, `Dimension ${radius.id}`, '30');
  await assertResiduals(page);
  const restored = await documentOf(page);
  expect(restored.entities.some((e) => e.id === lineId)).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('rectangle width edit is driving and fully constrained drag is immobile', async ({ page }) => {
  await example(page, 'rectangle');
  await expect(page.getByTestId('solver-status')).toContainText('Fully constrained');
  await dimension(page, 'Dimension width', '120');
  const d = await documentOf(page),
    e = d.entities[1];
  expect(e.type === 'line' && e.b.x).toBeCloseTo(120, 6);
  await page.getByRole('button', { name: 'Fit sketch', exact: true }).click();
  await dragWorld(page, { x: 120, y: 50 }, { x: 125, y: 62 });
  await assertResiduals(page);
  const after = await documentOf(page);
  expect(after.entities[1].type === 'line' && after.entities[1].b.y).toBeCloseTo(50, 6);
  expect(await page.evaluate(() => window.__datum.getResult().dof)).toBe(0);
  await page.getByRole('textbox', { name: 'Dimension width', exact: true }).fill('NaN');
  await page.getByRole('textbox', { name: 'Dimension width', exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('finite');
  expect(await documentOf(page)).toEqual(after);
});

test('fourbar joint dragging preserves branch, lengths and a single history transaction', async ({
  page,
}) => {
  await example(page, 'fourbar');
  expect(await page.evaluate(() => window.__datum.getResult().dof)).toBe(1);
  const history = await page.evaluate(() => window.__datum.store.past.length);
  await dragWorld(page, { x: 25, y: 45 }, { x: 35, y: 40 }, 24);
  await assertResiduals(page);
  const d = await documentOf(page),
    e = d.entities[0];
  expect(e.type === 'line' && e.b.y).toBeGreaterThan(30);
  expect(e.type === 'line' && e.b.x).toBeGreaterThan(30);
  expect(await page.evaluate(() => window.__datum.store.past.length)).toBe(history + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const original = await documentOf(page);
  expect(original.entities[0].type === 'line' && original.entities[0].b.x).toBe(25);
});

test('duplicate dimensions are redundant, incompatible edit is atomic, rejected undo is safe', async ({
  page,
}) => {
  await example(page, 'conflict');
  await clickWorld(page, { x: 15, y: 0 });
  await page.getByRole('button', { name: 'Add Distance', exact: true }).click();
  await page.getByRole('textbox', { name: 'New dimension value' }).fill('80');
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click();
  await expect(page.getByTestId('solver-status')).toContainText('redundant');
  const before = await documentOf(page);
  await page.getByRole('button', { name: 'Add Distance', exact: true }).click();
  await page.getByRole('textbox', { name: 'New dimension value' }).fill('100');
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Conflicting dimensions');
  expect(await documentOf(page)).toEqual(before);
  await page.getByRole('button', { name: 'Close dimension dialog' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await documentOf(page)).toEqual(before);
  await assertResiduals(page);
});

test('point creation, multiselect, constraints, construction, deletion and malformed import recover', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'New sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Point tool' }).click();
  await clickWorld(page, { x: 10, y: 20 });
  await clickWorld(page, { x: 45, y: 35 });
  await page.keyboard.press('Escape');
  await clickWorld(page, { x: 10, y: 20 });
  await page.keyboard.down('Shift');
  await clickWorld(page, { x: 45, y: 35 });
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Add Distance', exact: true }).click();
  await page.getByRole('textbox', { name: 'New dimension value' }).fill('40');
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle construction' }).click();
  expect((await documentOf(page)).entities.every((e) => e.construction)).toBe(true);
  await assertResiduals(page);
  const before = await documentOf(page);
  await page.keyboard.press('Delete');
  expect((await documentOf(page)).entities).toHaveLength(0);
  expect((await documentOf(page)).constraints).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await documentOf(page)).toEqual(before);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('textbox', { name: 'Document JSON' }).fill('{"version":99}');
  await page.getByRole('button', { name: 'Validate & open' }).click();
  await expect(page.getByRole('alert')).toContainText('Unsupported document version');
  expect(await documentOf(page)).toEqual(before);
});

test('visible snaps create removable relations; pan and cursor-centered zoom work', async ({ page }) => {
  await page.getByRole('button', { name: 'New sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Line tool' }).click();
  const origin = await xy(page, { x: 0, y: 0 });
  await page.mouse.move(origin.x, origin.y);
  await expect(page.locator('.cursor-cross')).toContainText('Origin snap + Fixed');
  await page.mouse.click(origin.x, origin.y);
  await clickWorld(page, { x: 40, y: 30 });
  await page.keyboard.press('Escape');
  const d = await documentOf(page),
    fixed = d.constraints.find((c) => c.type === 'fixed')!;
  expect(fixed).toBeTruthy();
  await page.getByRole('button', { name: `Remove constraint ${fixed.id}`, exact: true }).click();
  expect((await documentOf(page)).constraints).toHaveLength(0);
  const before = await page.evaluate(() => window.__datum.getView());
  await page.getByRole('button', { name: 'Pan tool' }).click();
  await dragWorld(page, { x: 10, y: 40 }, { x: 20, y: 45 });
  const after = await page.evaluate(() => window.__datum.getView());
  expect(after.x - before.x).toBeCloseTo(10 * before.scale, 0);
  const cursor = await xy(page, { x: 15, y: 25 });
  await page.evaluate(() =>
    document.querySelector('svg.sketch-canvas')!.addEventListener(
      'wheel',
      (e) => {
        (window as unknown as { wheelPoint: Vec }).wheelPoint = {
          x: (e as WheelEvent).clientX,
          y: (e as WheelEvent).clientY,
        };
      },
      { once: true },
    ),
  );
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -200);
  await expect
    .poll(async () => (await page.evaluate(() => window.__datum.getView())).scale)
    .toBeGreaterThan(after.scale);
  const invariant = await page.evaluate((before) => {
    const anchor = (window as unknown as { wheelPoint: Vec }).wheelPoint,
      r = document.querySelector('.sketch-canvas')!.getBoundingClientRect(),
      after = window.__datum.getView();
    const wx = (anchor.x - r.x - before.x) / before.scale,
      wy = (before.y - anchor.y + r.y) / before.scale;
    return { x: r.x + after.x + wx * after.scale - anchor.x, y: r.y + after.y - wy * after.scale - anchor.y };
  }, after);
  expect(Math.abs(invariant.x)).toBeLessThan(1e-8);
  expect(Math.abs(invariant.y)).toBeLessThan(1e-8);
});

test('mobile loads without page overflow and can create and inspect geometry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'New sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Line tool' }).click();
  await clickWorld(page, { x: 0, y: 0 });
  await clickWorld(page, { x: 35, y: 20 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
  await expect(page.getByTestId('solver-status')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await documentOf(page)).entities).toHaveLength(1);
});

test('all geometric relation tools operate on user-created lines and point targets', async ({ page }) => {
  await page.getByRole('button', { name: 'New sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Line tool' }).click();
  await clickWorld(page, { x: 0, y: 0 });
  await clickWorld(page, { x: 40, y: 20 });
  await clickWorld(page, { x: 10, y: 50 });
  await clickWorld(page, { x: 55, y: 70 });
  await page.keyboard.press('Escape');
  const ids = (await documentOf(page)).entities.map((e) => e.id);
  const midpoint = async (id: string) => {
    const e = (await documentOf(page)).entities.find((e) => e.id === id)!;
    if (e.type !== 'line') throw Error('Line expected');
    return { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
  };
  await clickWorld(page, await midpoint(ids[0]));
  await page.getByRole('button', { name: 'Add Horizontal', exact: true }).click();
  await clickWorld(page, await midpoint(ids[1]));
  await page.getByRole('button', { name: 'Add Vertical', exact: true }).click();
  await page.keyboard.down('Shift');
  await clickWorld(page, await midpoint(ids[0]));
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Add Perpendicular', exact: true }).click();
  await assertResiduals(page);
  const perpendicular = (await documentOf(page)).constraints.find((c) => c.type === 'perpendicular')!,
    vertical = (await documentOf(page)).constraints.find((c) => c.type === 'vertical')!;
  await page.getByRole('button', { name: `Remove constraint ${perpendicular.id}`, exact: true }).click();
  await page.getByRole('button', { name: `Remove constraint ${vertical.id}`, exact: true }).click();
  await page.getByRole('button', { name: 'Add Parallel', exact: true }).click();
  await assertResiduals(page);
  let d = await documentOf(page);
  expect(d.constraints.some((c) => c.type === 'parallel')).toBe(true);
  const first = d.entities[0],
    second = d.entities[1];
  if (first.type !== 'line' || second.type !== 'line') throw Error('Lines expected');
  await clickWorld(page, first.b);
  await page.keyboard.down('Shift');
  await clickWorld(page, second.a);
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Add Coincident', exact: true }).click();
  await assertResiduals(page);
  d = await documentOf(page);
  const line = d.entities[1];
  if (line.type !== 'line') throw Error('Line expected');
  await clickWorld(page, line.b);
  await page.getByRole('button', { name: 'Add Fixed', exact: true }).click();
  await assertResiduals(page);
  expect((await documentOf(page)).constraints.filter((c) => c.type === 'fixed')).toHaveLength(2);
});

test('an immediate document replacement cannot be reframed by a stale startup fit', async ({ page }) => {
  expect(await page.evaluate(() => window.__datum.load(window.__datum.performanceSketch()))).toBe(true);
  const visible = await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const canvas = document.querySelector('.sketch-canvas')!.getBoundingClientRect();
    return [...document.querySelectorAll('[data-entity]')].filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= canvas.left && r.right <= canvas.right && r.top >= canvas.top && r.bottom <= canvas.bottom
      );
    }).length;
  });
  expect(visible).toBe(100);
  await assertResiduals(page);
});
