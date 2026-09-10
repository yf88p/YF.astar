import { afterAll, describe, expect, it } from 'vitest';
import {
  clone,
  emptyDocument,
  removeEntities,
  targetPosition,
  validateDocument,
  type Document,
  type Target,
} from '../src/core/model';
import { circleExample, conflictExample, fourbar, performanceSketch, rectangle } from '../src/core/examples';
import { measureResiduals, solve } from '../src/core/solver';
import { SketchStore } from '../src/core/store';

const t = (entity: string, point: Target['point']): Target => ({ entity, point });
const measured = { states: 0, maximumPositionMm: 0, maximumNormalizedAngular: 0 };
afterAll(() => console.log('Independent residual measurements:', JSON.stringify(measured)));
// Independent acceptance oracle: intentionally does not use the solver's residual routines.
export function checkResiduals(d: Document) {
  let position = 0,
    angular = 0;
  for (const e of d.entities) {
    const values =
      e.type === 'line'
        ? [e.a.x, e.a.y, e.b.x, e.b.y]
        : e.type === 'circle'
          ? [e.center.x, e.center.y, e.radius]
          : [e.x, e.y];
    expect(values.every(Number.isFinite)).toBe(true);
  }
  const line = (id: string) => {
    const e = d.entities.find((e) => e.id === id)!;
    if (e.type !== 'line') throw Error('Not line');
    return e;
  };
  for (const c of d.constraints) {
    let r = 0;
    if (c.type === 'coincident' || c.type === 'distance') {
      const a = targetPosition(d, c.a),
        b = targetPosition(d, c.b);
      r = Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - (c.type === 'distance' ? c.value : 0));
    }
    if (c.type === 'fixed') {
      const p = targetPosition(d, c.target);
      r = Math.hypot(p.x - c.x, p.y - c.y);
    }
    if (c.type === 'horizontal' || c.type === 'vertical') {
      const e = line(c.line);
      r = Math.abs(c.type === 'horizontal' ? e.a.y - e.b.y : e.a.x - e.b.x);
    }
    if (c.type === 'radius') {
      const e = d.entities.find((e) => e.id === c.circle)!;
      if (e.type === 'circle') r = Math.abs(e.radius - c.value);
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
    } else position = Math.max(position, r);
  }
  expect(position).toBeLessThanOrEqual(1e-5);
  expect(angular).toBeLessThanOrEqual(1e-6);
  measured.states++;
  measured.maximumPositionMm = Math.max(measured.maximumPositionMm, position);
  measured.maximumNormalizedAngular = Math.max(measured.maximumNormalizedAngular, angular);
  return { position, angular };
}

describe('interacting geometric constraints', () => {
  it('fully constrains rectangle, drives width 80 -> 120, and refuses distortion', () => {
    const s = new SketchStore(rectangle());
    expect(s.result.dof).toBe(0);
    expect(
      s.transact((d) => {
        const c = d.constraints.find((c) => c.id === 'width')!;
        if (c.type === 'distance') c.value = 120;
      }),
    ).toBe(true);
    checkResiduals(s.document);
    expect(targetPosition(s.document, t('edge-1', 'b')).x).toBeCloseTo(120, 6);
    expect(targetPosition(s.document, t('edge-3', 'a')).y).toBeCloseTo(50, 6);
    const defined = clone(s.document),
      historyLength = s.past.length;
    s.beginDrag();
    s.drag([{ target: t('edge-2', 'b'), x: 145, y: 70 }]);
    s.endDrag();
    expect(s.document).toEqual(defined);
    expect(s.past).toHaveLength(historyLength);
    checkResiduals(s.document);
    expect(targetPosition(s.document, t('edge-2', 'b')).x).toBeCloseTo(120, 6);
    expect(targetPosition(s.document, t('edge-1', 'a')).x).toBeCloseTo(0, 6);
  });
  it('fourbar has one local DOF, moves continuously, retains lengths and ground', () => {
    const s = new SketchStore(fourbar());
    expect(s.result.dof).toBe(1);
    let previous = clone(targetPosition(s.document, t('bar-1', 'b')));
    const startX = previous.x;
    s.beginDrag();
    for (let i = 1; i <= 20; i++) {
      expect(s.drag([{ target: t('bar-1', 'b'), x: 25 + i * 0.5, y: 45 - i * 0.3 }])).toBe(true);
      const current = targetPosition(s.document, t('bar-1', 'b'));
      expect(Math.hypot(current.x - previous.x, current.y - previous.y)).toBeLessThan(2);
      expect(current.y).toBeGreaterThan(25);
      checkResiduals(s.document);
      previous = clone(current);
    }
    s.endDrag();
    expect(previous.x - startX).toBeGreaterThan(5);
    expect(s.past.length).toBe(1);
  });
  it('circle center follows endpoint; radius edit, save/load and drag history survive', () => {
    const s = new SketchStore(circleExample()),
      before = clone(s.document);
    s.beginDrag();
    for (let i = 0; i < 5; i++) expect(s.drag([{ target: t('arm', 'b'), x: 70 + i, y: 50 }])).toBe(true);
    s.endDrag();
    expect(s.past.length).toBe(1);
    checkResiduals(s.document);
    expect(targetPosition(s.document, t('wheel', 'center')).x).toBeCloseTo(74, 2);
    const moved = clone(s.document);
    s.undo();
    expect(s.document).toEqual(before);
    s.redo();
    expect(s.document).toEqual(moved);
    const loaded = new SketchStore(validateDocument(JSON.parse(JSON.stringify(s.document))));
    expect(
      loaded.transact((d) => {
        const c = d.constraints.find((c) => c.type === 'radius')!;
        if (c.type === 'radius') c.value = 35.123456789;
      }),
    ).toBe(true);
    checkResiduals(loaded.document);
    expect(loaded.document.entities[1].type === 'circle' && loaded.document.entities[1].radius).toBeCloseTo(
      35.123456789,
      8,
    );
    expect(loaded.document.constraints).toHaveLength(3);
  });
  it('rejects contradiction atomically, acknowledges rejected undo, accepts redundancy', () => {
    const s = new SketchStore(conflictExample());
    expect(
      s.transact((d) => d.entities.push({ id: 'extra', type: 'point', x: 2, y: 3, construction: true })),
    ).toBe(true);
    const before = clone(s.document),
      history = s.past.length;
    expect(
      s.transact((d) =>
        d.constraints.push({
          id: 'bad-100',
          type: 'distance',
          a: t('test-line', 'a'),
          b: t('test-line', 'b'),
          value: 100,
        }),
      ),
    ).toBe(false);
    expect(s.document).toEqual(before);
    expect(s.past.length).toBe(history);
    expect(s.lastError?.status).toBe('conflicting');
    expect(s.lastError?.conflicts).toContain('length-80');
    s.undo();
    expect(s.document).toEqual(before);
    expect(s.past.length).toBe(history);
    expect(
      s.transact((d) =>
        d.constraints.push({
          id: 'duplicate-80',
          type: 'distance',
          a: t('test-line', 'b'),
          b: t('test-line', 'a'),
          value: 80,
        }),
      ),
    ).toBe(true);
    expect(s.result.status).toBe('redundant');
    expect(s.result.dof).toBe(2);
    checkResiduals(s.document);
    s.undo();
    expect(s.document).toEqual(before);
  });
  it('supports zero distance as two coordinate equations and fixed standalone points', () => {
    const d = emptyDocument();
    d.entities = [
      { id: 'p', type: 'point', x: 5, y: 8, construction: false },
      { id: 'q', type: 'point', x: 10, y: -4, construction: false },
    ];
    d.constraints = [
      { id: 'fix', type: 'fixed', target: t('p', 'point'), x: 5, y: 8 },
      { id: 'zero', type: 'distance', a: t('p', 'point'), b: t('q', 'point'), value: 0 },
    ];
    const r = solve(d);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    checkResiduals(r.document);
  });
  it('solves normalized parallel and perpendicular directions', () => {
    const d = emptyDocument();
    d.entities = [
      { id: 'a', type: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 }, construction: false },
      { id: 'b', type: 'line', a: { x: 0, y: 10 }, b: { x: 35, y: 15 }, construction: false },
      { id: 'c', type: 'line', a: { x: 50, y: 0 }, b: { x: 52, y: 30 }, construction: false },
    ];
    d.constraints = [
      { id: 'h', type: 'horizontal', line: 'a' },
      { id: 'par', type: 'parallel', a: 'a', b: 'b' },
      { id: 'perp', type: 'perpendicular', a: 'a', b: 'c' },
    ];
    const r = solve(d);
    expect(r.ok).toBe(true);
    checkResiduals(r.document);
    expect(r.dof).toBe(9);
  });
  it('marks immovable targets even when a different component is free', () => {
    const d = conflictExample();
    d.entities.push({ id: 'free', type: 'point', x: 12, y: 13, construction: false });
    const r = solve(d);
    expect(r.dof).toBe(2);
    expect(r.immovableTargets).toContain('test-line/a');
    expect(r.immovableTargets).toContain('test-line/b');
    expect(r.immovableTargets).not.toContain('free/point');
  });
  it('adds directions at the stationary sine/cosine configurations without false failure', () => {
    for (const type of ['parallel', 'perpendicular'] as const) {
      const d = emptyDocument();
      d.entities = [
        { id: 'a', type: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, construction: false },
        {
          id: 'b',
          type: 'line',
          a: { x: 20, y: 0 },
          b: type === 'parallel' ? { x: 20, y: 10 } : { x: 30, y: 0 },
          construction: false,
        },
      ];
      d.constraints = [
        { id: 'a0', type: 'fixed', target: t('a', 'a'), x: 0, y: 0 },
        { id: 'a1', type: 'fixed', target: t('a', 'b'), x: 10, y: 0 },
        { id: 'b0', type: 'fixed', target: t('b', 'a'), x: 20, y: 0 },
        { id: 'length', type: 'distance', a: t('b', 'a'), b: t('b', 'b'), value: 10 },
        { id: 'direction', type, a: 'a', b: 'b' },
      ];
      const r = solve(d);
      expect(r.ok, r.message).toBe(true);
      expect(r.dof).toBe(0);
      checkResiduals(r.document);
    }
  });
  it('moves a single connected 100-entity / 150-constraint workload', () => {
    const d = performanceSketch(),
      line = d.entities.find((e) => e.id === 'link-25')!;
    expect(d.entities).toHaveLength(100);
    expect(d.constraints).toHaveLength(150);
    if (line.type !== 'line') throw Error('Expected chain line');
    const r = solve(d, {
      drag: [{ target: t(line.id, 'a'), x: line.a.x + 1, y: line.a.y + 2 }],
      timeBudgetMs: 1000,
    });
    expect(r.ok, r.message).toBe(true);
    expect(r.dof).toBe(100);
    expect(r.rank).toBe(250);
    checkResiduals(r.document);
    const moved = targetPosition(r.document, t(line.id, 'a'));
    expect(Math.hypot(moved.x - line.a.x, moved.y - line.a.y)).toBeGreaterThan(1);
  });
});

describe('numerical uncertainty and transactional validation', () => {
  it('rejects zero-length direction constraints and remains editable', () => {
    const s = new SketchStore();
    s.transact((d) => {
      d.entities = [
        { id: 'a', type: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, construction: false },
        { id: 'b', type: 'line', a: { x: 0, y: 1 }, b: { x: 20, y: 1 }, construction: false },
      ];
    });
    const before = clone(s.document);
    expect(s.transact((d) => d.constraints.push({ id: 'p', type: 'parallel', a: 'a', b: 'b' }))).toBe(false);
    expect(s.lastError?.message).toMatch(/zero length/);
    expect(s.document).toEqual(before);
    expect(
      s.transact((d) => {
        const e = d.entities[0];
        if (e.type === 'line') e.b.x = 2;
      }),
    ).toBe(true);
  });
  it('reports singular collinear linkage instead of inventing a mobility count', () => {
    const d = emptyDocument();
    d.entities = [0, 1, 2].map((i) => ({ id: `p${i}`, type: 'point', x: i * 10, y: 0, construction: false }));
    d.constraints = [
      { id: 'left', type: 'fixed', target: t('p0', 'point'), x: 0, y: 0 },
      { id: 'right', type: 'fixed', target: t('p2', 'point'), x: 20, y: 0 },
      { id: 'a', type: 'distance', a: t('p0', 'point'), b: t('p1', 'point'), value: 10 },
      { id: 'b', type: 'distance', a: t('p1', 'point'), b: t('p2', 'point'), value: 10 },
    ];
    const r = solve(d);
    expect(r.ok).toBe(true);
    expect(r.status).toBe('singular');
    expect(r.dof).toBeNull();
    checkResiduals(r.document);
  });
  it('does not label an exhausted numerical solve as conflict', () => {
    const d = rectangle();
    const width = d.constraints.find((c) => c.id === 'width')!;
    if (width.type === 'distance') width.value = 120;
    const r = solve(d, { maxIterations: 0 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('nonconvergent');
    expect(r.document).toEqual(d);
  });
  it('rejects invalid imports without replacing the document', () => {
    const s = new SketchStore(circleExample()),
      before = clone(s.document);
    for (const invalid of [
      null,
      {},
      { ...before, version: 99 },
      { ...before, units: 'inch' },
      { ...before, entities: [] },
      { ...before, constraints: [{ id: 'bad', type: 'radius', circle: 'wheel', value: 0 }] },
    ]) {
      expect(s.replace(invalid)).toBe(false);
      expect(s.document).toEqual(before);
    }
    const bad = clone(before);
    bad.entities.push({ id: 'nan', type: 'point', x: NaN, y: 0, construction: false });
    expect(s.replace(bad)).toBe(false);
    expect(s.document).toEqual(before);
    const unsat = conflictExample();
    unsat.constraints.push({
      id: 'bad',
      type: 'distance',
      a: t('test-line', 'a'),
      b: t('test-line', 'b'),
      value: 100,
    });
    expect(s.replace(unsat)).toBe(false);
    expect(s.document).toEqual(before);
  });
  it('deletes heavily referenced entities and restores exact identities and constraints', () => {
    const s = new SketchStore(rectangle()),
      before = clone(s.document);
    s.transact((d) => Object.assign(d, removeEntities(d, ['edge-1'])));
    expect(s.document.entities).toHaveLength(3);
    expect(s.document.constraints).toHaveLength(6);
    validateDocument(s.document);
    checkResiduals(s.document);
    s.undo();
    expect(s.document).toEqual(before);
    s.redo();
    validateDocument(s.document);
  });
  it('near-degenerate 0.01 mm lines solve to independently checked precision', () => {
    const d = emptyDocument();
    d.entities = [
      { id: 'a', type: 'line', a: { x: 900, y: 900 }, b: { x: 900.01, y: 900.0002 }, construction: false },
      {
        id: 'b',
        type: 'line',
        a: { x: -900, y: -900 },
        b: { x: -899.989, y: -899.999 },
        construction: false,
      },
    ];
    d.constraints = [
      { id: 'par', type: 'parallel', a: 'a', b: 'b' },
      { id: 'len', type: 'distance', a: t('a', 'a'), b: t('a', 'b'), value: 0.01 },
    ];
    const r = solve(d, { timeBudgetMs: 500 });
    expect(r.ok).toBe(true);
    checkResiduals(r.document);
  });
  it('preserves full precision across repeated multiway coincidence save/load', () => {
    const d = emptyDocument();
    for (let i = 0; i < 7; i++) {
      d.entities.push({
        id: `p${i}`,
        type: 'point',
        x: 0.12345678901234567,
        y: 31.123456789012345,
        construction: false,
      });
      if (i)
        d.constraints.push({ id: `c${i}`, type: 'coincident', a: t('p0', 'point'), b: t(`p${i}`, 'point') });
    }
    const expected = JSON.stringify(d);
    let current = d;
    for (let i = 0; i < 10; i++) {
      const r = solve(JSON.parse(JSON.stringify(current)));
      expect(r.ok).toBe(true);
      current = r.document;
    }
    expect(JSON.stringify(current)).toBe(expected);
  });
  it('the public residual utility measures unmerged input rather than hiding bad coincidences', () => {
    const d = circleExample();
    const c = d.entities[1];
    if (c.type === 'circle') c.center.x += 2;
    expect(measureResiduals(d).position).toBe(2);
    const r = solve(d);
    expect(r.ok).toBe(true);
    checkResiduals(r.document);
  });
  it('rejects invalid dimension values and references and does not mutate future history', () => {
    const s = new SketchStore(circleExample());
    s.transact((d) => d.entities.push({ id: 'new', type: 'point', x: 2, y: 3, construction: false }));
    s.undo();
    const before = clone(s.document),
      future = clone(s.future);
    for (const value of [0, -1, NaN, Infinity]) {
      expect(
        s.transact((d) => {
          const c = d.constraints.find((c) => c.type === 'radius')!;
          if (c.type === 'radius') c.value = value;
        }),
      ).toBe(false);
      expect(s.document).toEqual(before);
      expect(s.future).toEqual(future);
    }
    expect(
      s.transact((d) =>
        d.constraints.push({ id: 'bad', type: 'coincident', a: t('arm', 'center'), b: t('wheel', 'center') }),
      ),
    ).toBe(false);
    expect(s.document).toEqual(before);
    s.redo();
    expect(s.document.entities.some((e) => e.id === 'new')).toBe(true);
  });
  it('cancelled drags restore the original state without adding history', () => {
    const s = new SketchStore(circleExample()),
      before = clone(s.document);
    s.beginDrag();
    s.drag([{ target: t('arm', 'b'), x: 80, y: 60 }]);
    s.cancelDrag();
    expect(s.document).toEqual(before);
    expect(s.past).toHaveLength(0);
  });
  it('deleting one circle atomically removes 86 references and undo restores them', () => {
    const d = emptyDocument();
    d.entities.push({ id: 'hub', type: 'circle', center: { x: 10, y: 20 }, radius: 15, construction: true });
    for (let i = 0; i < 60; i++) {
      d.entities.push({ id: `p-${i}`, type: 'point', x: 10, y: 20, construction: false });
      d.constraints.push({
        id: `join-${i}`,
        type: 'coincident',
        a: t('hub', 'center'),
        b: t(`p-${i}`, 'point'),
      });
    }
    for (let i = 0; i < 25; i++)
      d.constraints.push({ id: `radius-${i}`, type: 'radius', circle: 'hub', value: 15 });
    d.constraints.push({ id: 'fixed', type: 'fixed', target: t('hub', 'center'), x: 10, y: 20 });
    const s = new SketchStore(d),
      before = clone(s.document);
    expect(s.result.dof).toBe(0);
    expect(s.result.status).toBe('redundant');
    expect(s.transact((d) => Object.assign(d, removeEntities(d, ['hub'])))).toBe(true);
    expect(s.document.entities).toHaveLength(60);
    expect(s.document.constraints).toHaveLength(0);
    expect(s.result.dof).toBe(120);
    s.undo();
    expect(s.document).toEqual(before);
    checkResiduals(s.document);
  });
});

describe('deterministically generated known-feasible systems', () => {
  let seed = 91827;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  it('solves 30 perturbed rectangular systems at varied scales and origins', () => {
    for (let trial = 0; trial < 30; trial++) {
      const d = rectangle(),
        width = 0.01 + random() * 200,
        height = 0.01 + random() * 200,
        ox = random() * 1000 - 500,
        oy = random() * 1000 - 500;
      for (const e of d.entities)
        if (e.type === 'line')
          for (const p of [e.a, e.b]) {
            p.x = ox + (p.x / 80) * width + (random() - 0.5) * 0.2;
            p.y = oy + (p.y / 50) * height + (random() - 0.5) * 0.2;
          }
      for (const c of d.constraints) {
        if (c.type === 'fixed') {
          c.x = ox;
          c.y = oy;
        }
        if (c.type === 'distance') c.value = c.id === 'width' ? width : height;
      }
      const r = solve(d, { timeBudgetMs: 500 });
      expect(r.ok, r.message).toBe(true);
      checkResiduals(r.document);
      expect(r.dof).toBe(0);
    }
  });
  it('solves 20 connected flexible chains without demanding an arbitrary branch', () => {
    for (let trial = 0; trial < 20; trial++) {
      const d = emptyDocument(),
        points = Array.from({ length: 8 }, (_, i) => ({ x: i * 15, y: random() * 25 }));
      points.forEach((p, i) => {
        d.entities.push({
          id: `p${i}`,
          type: 'point',
          x: p.x + random() - 0.5,
          y: p.y + random() - 0.5,
          construction: false,
        });
        if (i)
          d.constraints.push({
            id: `d${i}`,
            type: 'distance',
            a: t(`p${i - 1}`, 'point'),
            b: t(`p${i}`, 'point'),
            value: Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y),
          });
      });
      d.constraints.push({ id: 'fix', type: 'fixed', target: t('p0', 'point'), ...points[0] });
      const r = solve(d);
      expect(r.ok, r.message).toBe(true);
      checkResiduals(r.document);
      expect(r.dof).toBe(7);
    }
  });
});
