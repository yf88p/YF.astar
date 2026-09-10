import { emptyDocument, type Document, type Vec, type Target } from './model';

const t = (entity: string, point: Target['point']): Target => ({ entity, point });
function polygon(points: Vec[], prefix: string): Document {
  const d = emptyDocument();
  points.forEach((p, i) =>
    d.entities.push({
      id: `${prefix}${i + 1}`,
      type: 'line',
      a: { ...p },
      b: { ...points[(i + 1) % points.length] },
      construction: false,
    }),
  );
  points.forEach((_, i) =>
    d.constraints.push({
      id: `joint-${i + 1}`,
      type: 'coincident',
      a: t(`${prefix}${i + 1}`, 'b'),
      b: t(`${prefix}${((i + 1) % points.length) + 1}`, 'a'),
    }),
  );
  return d;
}
export function rectangle(): Document {
  const d = polygon(
    [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 50 },
      { x: 0, y: 50 },
    ],
    'edge-',
  );
  for (let i = 1; i <= 4; i++)
    d.constraints.push({ id: `axis-${i}`, type: i % 2 ? 'horizontal' : 'vertical', line: `edge-${i}` });
  d.constraints.push(
    { id: 'origin-fixed', type: 'fixed', target: t('edge-1', 'a'), x: 0, y: 0 },
    { id: 'width', type: 'distance', a: t('edge-1', 'a'), b: t('edge-1', 'b'), value: 80 },
    { id: 'height', type: 'distance', a: t('edge-2', 'a'), b: t('edge-2', 'b'), value: 50 },
  );
  return d;
}
export function fourbar(): Document {
  const points = [
    { x: 0, y: 0 },
    { x: 25, y: 45 },
    { x: 85, y: 55 },
    { x: 110, y: 0 },
  ];
  const d = polygon(points, 'bar-');
  for (let i = 1; i <= 4; i++) {
    const a = points[i - 1],
      b = points[i % 4];
    d.constraints.push({
      id: `length-${i}`,
      type: 'distance',
      a: t(`bar-${i}`, 'a'),
      b: t(`bar-${i}`, 'b'),
      value: Math.hypot(b.x - a.x, b.y - a.y),
    });
  }
  d.constraints.push(
    { id: 'ground-left', type: 'fixed', target: t('bar-1', 'a'), x: 0, y: 0 },
    { id: 'ground-right', type: 'fixed', target: t('bar-3', 'b'), x: 110, y: 0 },
  );
  d.entities[3].construction = true;
  return d;
}
export function circleExample(): Document {
  return {
    version: 1,
    units: 'mm',
    entities: [
      { id: 'arm', type: 'line', a: { x: 0, y: 0 }, b: { x: 60, y: 35 }, construction: false },
      { id: 'wheel', type: 'circle', center: { x: 60, y: 35 }, radius: 22, construction: false },
    ],
    constraints: [
      { id: 'hub', type: 'coincident', a: t('arm', 'b'), b: t('wheel', 'center') },
      { id: 'wheel-radius', type: 'radius', circle: 'wheel', value: 22 },
      { id: 'arm-origin', type: 'fixed', target: t('arm', 'a'), x: 0, y: 0 },
    ],
  };
}
export function conflictExample(): Document {
  return {
    version: 1,
    units: 'mm',
    entities: [{ id: 'test-line', type: 'line', a: { x: 0, y: 0 }, b: { x: 80, y: 0 }, construction: false }],
    constraints: [
      { id: 'fixed-start', type: 'fixed', target: t('test-line', 'a'), x: 0, y: 0 },
      { id: 'horizontal', type: 'horizontal', line: 'test-line' },
      { id: 'length-80', type: 'distance', a: t('test-line', 'a'), b: t('test-line', 'b'), value: 80 },
    ],
  };
}
export const examples = [
  {
    id: 'rectangle',
    name: 'Driven rectangle',
    description: 'A fully defined profile. Change its width; everything stays connected.',
    create: rectangle,
  },
  {
    id: 'fourbar',
    name: 'Four-bar linkage',
    description: 'One degree of freedom. Drag an upper joint to articulate the mechanism.',
    create: fourbar,
  },
  {
    id: 'circle',
    name: 'Connected circle',
    description: 'A shared center, a driving radius. Explore coincident geometry.',
    create: circleExample,
  },
  {
    id: 'conflict',
    name: 'Constraint laboratory',
    description: 'An 80 mm fixed profile. Try adding another 80 or 100 mm distance.',
    create: conflictExample,
  },
];

// One articulated chain with an attached circle at every joint:
// 50 lines + 50 circles; 49 joints + 50 center coincidences + 50 lengths + 1 fixed.
export function performanceSketch(): Document {
  const d = emptyDocument();
  for (let i = 0; i < 50; i++) {
    const a = { x: i * 7, y: 22 * Math.sin(i * 0.14) },
      b = { x: (i + 1) * 7, y: 22 * Math.sin((i + 1) * 0.14) };
    d.entities.push({ id: `link-${i}`, type: 'line', a, b, construction: false });
    d.entities.push({ id: `hub-${i}`, type: 'circle', center: { ...b }, radius: 1.7, construction: false });
    if (i)
      d.constraints.push({
        id: `joint-${i}`,
        type: 'coincident',
        a: t(`link-${i - 1}`, 'b'),
        b: t(`link-${i}`, 'a'),
      });
    d.constraints.push({
      id: `center-${i}`,
      type: 'coincident',
      a: t(`link-${i}`, 'b'),
      b: t(`hub-${i}`, 'center'),
    });
    d.constraints.push({
      id: `length-${i}`,
      type: 'distance',
      a: t(`link-${i}`, 'a'),
      b: t(`link-${i}`, 'b'),
      value: Math.hypot(b.x - a.x, b.y - a.y),
    });
  }
  d.constraints.push({ id: 'ground', type: 'fixed', target: t('link-0', 'a'), x: 0, y: 0 });
  return d;
}
