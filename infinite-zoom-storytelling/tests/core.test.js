import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core.js';

const {
  uid, multiply, inverse, applyMatrix, worldMatrix, worldBounds, reparent,
  groupNodes, ungroupNode, deleteNodes, zoomAt, frameNode, fitProject,
  timelineDuration, sampleCamera, interpolateCamera, clampCamera, validateProject,
} = core;
const viewport = { width: 1280, height: 800 };
const identity = [1, 0, 0, 1, 0, 0];

function node(id, values = {}) {
  return {
    id, parentId: null, type: 'rect', name: id, x: 0, y: 0, w: 100, h: 80,
    scale: 1, rotation: 0, opacity: 1, hidden: false, locked: false,
    ...values,
  };
}

function project(nodes = [], values = {}) {
  return { version: 1, id: 'project', name: 'Spatial story', nodes, assets: {}, stops: [], links: [], ...values };
}

function stop(id, targetId, values = {}) {
  return { id, title: id, caption: '', targetId, dwell: 2, transition: 1, easing: 'smooth', ...values };
}

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

function pointNear(actual, expected, tolerance = 1e-9) {
  near(actual.x, expected.x, tolerance);
  near(actual.y, expected.y, tolerance);
}

function screen(camera, point) {
  return { x: viewport.width / 2 + (point.x - camera.x) * camera.scale, y: viewport.height / 2 + (point.y - camera.y) * camera.scale };
}

function world(camera, point) {
  return { x: camera.x + (point.x - viewport.width / 2) / camera.scale, y: camera.y + (point.y - viewport.height / 2) / camera.scale };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}

test('exports exactly the independent engine API and generates unique prefixed IDs', () => {
  assert.deepEqual(Object.keys(core).sort(), [
    'uid', 'multiply', 'inverse', 'applyMatrix', 'worldMatrix', 'worldBounds', 'reparent',
    'groupNodes', 'ungroupNode', 'deleteNodes', 'zoomAt', 'frameNode', 'fitProject',
    'timelineDuration', 'sampleCamera', 'interpolateCamera', 'clampCamera', 'validateProject',
  ].sort());
  const ids = Array.from({ length: 1000 }, () => uid('scene'));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => id.startsWith('scene_')));
});

test('affine multiplication, inversion, and application compose nested transforms in order', () => {
  const doc = project([
    node('parent', { type: 'group', x: 100, y: 50, scale: 2, rotation: 90 }),
    node('child', { parentId: 'parent', x: 10, y: 20, w: 30, h: 10, scale: 3, rotation: -90 }),
    node('grandchild', { parentId: 'child', x: 2, y: 4, scale: 0.5, rotation: 30 }),
  ]);
  const parent = worldMatrix(doc, 'parent');
  const child = worldMatrix(doc, 'child');
  child.forEach((value, index) => near(value, [6, 0, 0, 6, 60, 70][index]));
  pointNear(applyMatrix(child, { x: 2, y: 4 }), { x: 72, y: 94 });
  const grandchild = worldMatrix(doc, 'grandchild');
  near(Math.hypot(grandchild[0], grandchild[1]), 3);
  near(Math.atan2(grandchild[1], grandchild[0]) * 180 / Math.PI, 30);
  pointNear(applyMatrix(grandchild, { x: 0, y: 0 }), { x: 72, y: 94 });
  multiply(inverse(parent), parent).forEach((value, index) => near(value, identity[index]));
  pointNear(applyMatrix(inverse(grandchild), applyMatrix(grandchild, { x: 13, y: -7 })), { x: 13, y: -7 });
  assert.deepEqual(worldBounds(doc, 'child'), { x: 60, y: 70, w: 180, h: 60 });
  assert.throws(() => inverse([0, 0, 0, 0, 0, 0]), /singular/);
  const tiny = [1e-12, 0, 0, 1e-12, 0, 0];
  multiply(tiny, inverse(tiny)).forEach((value, index) => near(value, identity[index]));
  assert.equal(worldMatrix(doc, 'missing'), null);
  assert.equal(worldMatrix(doc, null), null);
  assert.equal(worldBounds(doc, 'missing'), null);
});

test('rotated world bounds enclose all four transformed corners', () => {
  const doc = project([node('box', { x: -120, y: 54, scale: 0.25, rotation: 37, w: 800, h: 240 })]);
  const matrix = worldMatrix(doc, 'box');
  const bounds = worldBounds(doc, 'box');
  const corners = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 240 }, { x: 0, y: 240 }].map(point => applyMatrix(matrix, point));
  near(bounds.x, Math.min(...corners.map(point => point.x)));
  near(bounds.y, Math.min(...corners.map(point => point.y)));
  near(bounds.x + bounds.w, Math.max(...corners.map(point => point.x)));
  near(bounds.y + bounds.h, Math.max(...corners.map(point => point.y)));
});

test('six hierarchy levels with a million-to-one scale ratio frame and pick within half a pixel', () => {
  const scales = [1, 0.1, 0.1, 0.1, 0.1, 0.01];
  const nodes = scales.map((scale, index) => node(`level${index}`, {
    parentId: index ? `level${index - 1}` : null, type: index === 5 ? 'rect' : 'scene',
    x: index ? 120000 + index * 1337 : 175000, y: index ? 90000 - index * 917 : -93000,
    w: 1e6, h: 600000, scale, rotation: index % 2 ? -17 : 23,
  }));
  const doc = validateProject(project(nodes));
  const target = nodes.at(-1);
  const matrix = worldMatrix(doc, target.id);
  near(Math.hypot(matrix[0], matrix[1]), 1e-6, 1e-20);
  const camera = frameNode(doc, target.id, viewport);
  const bounds = worldBounds(doc, target.id);
  pointNear(screen(camera, { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }), { x: 640, y: 400 }, 0.5);
  const extent = Math.max(bounds.w * camera.scale / (viewport.width - 140), bounds.h * camera.scale / (viewport.height - 140));
  near(extent, 1, 1e-12);
  for (const point of [{ x: 0, y: 0 }, { x: target.w, y: target.h }, { x: 371234, y: 218765 }]) {
    let expected = { ...point };
    for (const ancestor of [...nodes].reverse()) {
      const angle = ancestor.rotation * Math.PI / 180;
      expected = {
        x: ancestor.x + ancestor.scale * (Math.cos(angle) * expected.x - Math.sin(angle) * expected.y),
        y: ancestor.y + ancestor.scale * (Math.sin(angle) * expected.x + Math.cos(angle) * expected.y),
      };
    }
    const projected = screen(camera, applyMatrix(matrix, point));
    pointNear(projected, screen(camera, expected), 0.5);
    const picked = applyMatrix(inverse(matrix), world(camera, projected));
    near((picked.x - point.x) * 1e-6 * camera.scale, 0, 0.5);
    near((picked.y - point.y) * 1e-6 * camera.scale, 0, 0.5);
    pointNear(screen(camera, applyMatrix(matrix, picked)), projected, 0.5);
  }
});

test('seven performance-fixture scene levels and thin paths remain usable away from the origin', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => node(`level${index}`, {
    parentId: index ? `level${index - 1}` : null, type: 'scene',
    x: index ? 1104 : 0, y: index ? 708 : 0, w: 1200, h: 780,
    scale: index ? 0.04 : 1,
  }));
  nodes.push(node('path', { parentId: 'level6', type: 'path', w: 100, h: 1, path: 'M0 0L100 1' }));
  nodes.push(node('line', { parentId: 'level6', type: 'line', w: 100, h: 1 }));
  const doc = validateProject(project(nodes));
  const matrix = worldMatrix(doc, 'level6');
  near(Math.hypot(matrix[0], matrix[1]), 0.04 ** 6, 1e-23);
  const bounds = worldBounds(doc, 'level6');
  near(bounds.w, 1200 * 0.04 ** 6, 1e-20);
  const camera = frameNode(doc, 'level6', viewport);
  pointNear(screen(camera, { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }), { x: 640, y: 400 }, 0.5);
  near(bounds.h * camera.scale, viewport.height - 140, 1e-9);
});

test('reparenting preserves world position, rotation, scale, descendants, and layer order for 50 cycles', () => {
  const original = freeze(project([
    node('a', { type: 'group', x: 1300, y: -1400, scale: 123, rotation: 37 }),
    node('b', { type: 'group', x: -731, y: 890, scale: 0.0123, rotation: -71 }),
    node('child', { parentId: 'a', x: 23, y: 51, scale: 0.125, rotation: 19 }),
    node('nested', { parentId: 'child', x: 5, y: -4, scale: 0.7, rotation: 29 }),
  ]));
  const expected = new Map(['child', 'nested'].map(id => [id, worldMatrix(original, id)]));
  let doc = original;
  for (let iteration = 0; iteration < 50; iteration++) {
    doc = reparent(doc, 'child', 'b');
    doc = reparent(doc, 'child', null);
    doc = reparent(doc, 'child', 'a');
    for (const [id, matrix] of expected) {
      worldMatrix(doc, id).forEach((value, index) => near(value, matrix[index], 1e-7));
    }
  }
  assert.deepEqual(doc.nodes.map(node => node.id), original.nodes.map(node => node.id));
  assert.equal(original.nodes[2].parentId, 'a');
  assert.notEqual(doc, original);
  validateProject(doc);
});

test('grouping and ungrouping preserve all geometry and IDs through 50 cycles', () => {
  const original = freeze(project([
    node('scene', { type: 'scene', x: 23000, y: -17000, w: 1000, h: 800, scale: 0.0001, rotation: 61 }),
    node('a', { parentId: 'scene', x: 21, y: 51, scale: 0.73, rotation: 17 }),
    node('unselected', { parentId: 'scene', x: 250 }),
    node('b', { parentId: 'scene', x: 73, y: 210, scale: 2.8, rotation: -27 }),
    node('nested', { parentId: 'a', x: -4, y: 9, scale: 0.3, rotation: 44 }),
  ]));
  const camera = frameNode(original, 'a', viewport);
  const expected = new Map(original.nodes.map(node => [node.id, worldMatrix(original, node.id)]));
  const landmarks = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }];
  let doc = original;
  for (let iteration = 0; iteration < 50; iteration++) {
    const grouped = groupNodes(doc, ['b', 'a', 'nested', 'a']);
    const group = grouped.project.nodes.find(node => node.id === grouped.groupId);
    assert.equal(group.parentId, 'scene');
    assert.equal(grouped.project.nodes.find(node => node.id === 'nested').parentId, 'a');
    assert.deepEqual(grouped.project.nodes.filter(node => node.id !== grouped.groupId).map(node => node.id), original.nodes.map(node => node.id));
    for (const candidate of [grouped.project, ungroupNode(grouped.project, grouped.groupId)]) {
      for (const [id, matrix] of expected) {
        for (const point of landmarks) {
          pointNear(screen(camera, applyMatrix(worldMatrix(candidate, id), point)), screen(camera, applyMatrix(matrix, point)), 0.5);
        }
      }
    }
    doc = ungroupNode(grouped.project, grouped.groupId);
  }
  assert.deepEqual(doc.nodes.map(node => node.id), original.nodes.map(node => node.id));
  assert.equal(original.nodes[1].parentId, 'scene');
  validateProject(doc);
});

test('cross-parent grouping chooses the common ancestor without moving selected subtrees', () => {
  const doc = project([
    node('scene', { type: 'scene', rotation: 11 }),
    node('left', { type: 'group', parentId: 'scene', x: 130, rotation: 31, scale: 4 }),
    node('right', { type: 'group', parentId: 'scene', y: -50, rotation: -70, scale: 0.3 }),
    node('a', { parentId: 'left', x: 21, y: 93, rotation: 27 }),
    node('b', { parentId: 'right', x: -65, y: 112, rotation: 82 }),
  ]);
  const grouped = groupNodes(doc, ['a', 'b']);
  assert.equal(grouped.project.nodes.find(node => node.id === grouped.groupId).parentId, 'scene');
  for (const id of ['a', 'b']) {
    const expected = worldMatrix(doc, id);
    worldMatrix(grouped.project, id).forEach((value, index) => near(value, expected[index]));
  }
  assert.throws(() => groupNodes(doc, []), /at least one/);
  assert.throws(() => groupNodes(doc, ['absent']), /missing node/);
  assert.throws(() => ungroupNode(doc, 'a'), /not a group/);
});

test('reparenting rejects self cycles, descendant cycles, and missing nodes or parents', () => {
  const doc = freeze(project([node('a'), node('b', { parentId: 'a' }), node('c', { parentId: 'b' })]));
  assert.throws(() => reparent(doc, 'a', 'a'), /cycle/);
  assert.throws(() => reparent(doc, 'a', 'c'), /cycle/);
  assert.throws(() => reparent(doc, 'missing', null), /missing node/);
  assert.throws(() => reparent(doc, 'b', 'missing'), /Missing parent/);
  assert.equal(reparent(doc, 'b', 'a'), doc);
  assert.throws(() => worldMatrix(project([node('a', { parentId: 'b' }), node('b', { parentId: 'a' })]), 'a'), /cycle/);
});

test('cursor zoom remains anchored, including when camera scale hits either limit', () => {
  const point = { x: 219, y: 657 };
  for (const [camera, factor] of [
    [{ x: 100, y: -30, scale: 2 }, 5],
    [{ x: -2100, y: 350, scale: 0.01 }, 0.7],
    [{ x: 12, y: -13, scale: 1e9 }, 100],
    [{ x: 20, y: 10, scale: 2e-5 }, 0.001],
  ]) {
    const before = world(camera, point);
    const next = zoomAt(freeze(camera), point, factor, viewport);
    pointNear(screen(next, before), point, 0.001);
    assert.ok(next.scale >= 1e-5 && next.scale <= 1e10);
  }
  const camera = { x: 31, y: -14, scale: 2 };
  assert.deepEqual(zoomAt(camera, { x: 640, y: 400 }, 2, viewport), { ...camera, scale: 4 });
  assert.deepEqual(zoomAt(camera, point, 1, viewport), camera);
  assert.throws(() => zoomAt(camera, point, 0, viewport), /factor/);
  assert.throws(() => zoomAt(camera, point, Infinity, viewport), /factor/);
});

test('camera clamping supports extreme scales and sanitizes non-finite coordinates', () => {
  assert.deepEqual(clampCamera({ x: 1e15, y: -Infinity, scale: Infinity }), { x: 1e12, y: -1e12, scale: 1e10 });
  assert.deepEqual(clampCamera({ x: NaN, y: undefined, scale: -3 }), { x: 0, y: 0, scale: 1e-5 });
  assert.deepEqual(clampCamera({ x: 1, y: 2, scale: NaN }), { x: 1, y: 2, scale: 1 });
  assert.deepEqual(clampCamera(), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(clampCamera({ x: -1e12, y: 1e12, scale: 1e-5 }), { x: -1e12, y: 1e12, scale: 1e-5 });
});

test('framing uses CSS pixels, respects padding and ignores hidden subtrees in overview', () => {
  const doc = project([
    node('visible', { x: 100, y: 200, w: 400, h: 200 }),
    node('hidden', { type: 'group', hidden: true, x: 1e8 }),
    node('child', { parentId: 'hidden', x: 1e6 }),
  ]);
  assert.deepEqual(frameNode(doc, 'visible', viewport), { x: 300, y: 300, scale: 2.85 });
  assert.deepEqual(fitProject(doc, viewport), frameNode(doc, 'visible', viewport));
  assert.deepEqual(frameNode(doc, 'visible', viewport, 0), { x: 300, y: 300, scale: 3.2 });
  assert.deepEqual(fitProject(project(), viewport), { x: 0, y: 0, scale: 1 });
  assert.equal(frameNode(doc, 'deleted', viewport), null);
  assert.throws(() => fitProject(doc, { width: 0, height: 800 }), /Viewport/);
  assert.throws(() => frameNode(doc, 'visible', viewport, -1), /padding/);
  assert.ok(frameNode(doc, 'visible', { width: 90, height: 80 }).scale > 0);
});

test('safe origin geometry retains extreme composed scales and camera fit boundaries', () => {
  for (const [scale, size, cameraScale] of [[1e-6, 1e-6, 1e10], [1e6, 1e6, 1e-5]]) {
    const doc = validateProject(project([
      node('parent', { type: 'scene', scale, w: size, h: size }),
      node('child', { parentId: 'parent', scale, w: size, h: size }),
    ]));
    near(worldMatrix(doc, 'child')[0], scale ** 2, scale ** 2 * 1e-15);
    near(worldBounds(doc, 'child').w, size * scale ** 2, size * scale ** 2 * 1e-15);
    for (const camera of [frameNode(doc, 'child', viewport), fitProject(doc, viewport)]) {
      assert.equal(camera.scale, cameraScale);
      assert.ok(Object.values(camera).every(Number.isFinite));
      assert.ok(Math.abs(camera.x) <= 1e12 && Math.abs(camera.y) <= 1e12);
    }
  }
  for (const dimension of ['w', 'h']) {
    const doc = project([node('thin', { w: 1e6, h: 1e6, [dimension]: 1e-200 })]);
    assert.deepEqual(validateProject(doc), doc);
    assert.deepEqual(fitProject(doc, viewport), frameNode(doc, 'thin', viewport));
  }
});

test('timeline contains each transition then dwell, clamps time and reports phase-local seconds', () => {
  const doc = freeze(project([node('a', { x: -200 }), node('b', { x: 300 })], {
    stops: [stop('first', 'a', { transition: 2, dwell: 3 }), stop('second', 'b', { transition: 4, dwell: 5 })],
  }));
  assert.equal(timelineDuration(doc), 14);
  const checks = [
    [-100, 0, 'transition', 0], [0, 0, 'transition', 0], [1, 0, 'transition', 1],
    [2, 0, 'dwell', 0], [4, 0, 'dwell', 2], [5, 1, 'transition', 0],
    [7, 1, 'transition', 2], [9, 1, 'dwell', 0], [14, 1, 'dwell', 5], [100, 1, 'dwell', 5],
  ];
  for (const [time, stopIndex, phase, localTime] of checks) {
    const sampled = sampleCamera(doc, time, viewport);
    assert.deepEqual({ stopIndex: sampled.stopIndex, phase: sampled.phase, localTime: sampled.localTime }, { stopIndex, phase, localTime });
    assert.deepEqual(sampleCamera(doc, time, viewport), sampled);
  }
  assert.deepEqual(sampleCamera(doc, 0, viewport).camera, fitProject(doc, viewport));
  assert.deepEqual(sampleCamera(doc, 2, viewport).camera, frameNode(doc, 'a', viewport));
  assert.deepEqual(sampleCamera(doc, Infinity, viewport).camera, frameNode(doc, 'b', viewport));
  assert.deepEqual(sampleCamera(doc, NaN, viewport), sampleCamera(doc, 0, viewport));
  assert.deepEqual(sampleCamera(doc, -Infinity, viewport), sampleCamera(doc, 0, viewport));
});

test('camera interpolation is logarithmic, with deliberate zoom-out for distant targets', () => {
  const doc = project([], { stops: [
    stop('first', null, { frame: { x: 100, y: 100, scale: 1 }, transition: 0, dwell: 0 }),
    stop('second', null, { frame: { x: 100, y: 100, scale: 100 }, transition: 4, easing: 'linear' }),
  ] });
  near(sampleCamera(doc, 2, viewport).camera.scale, 10);
  near(sampleCamera(doc, 1, viewport).camera.scale, Math.sqrt(10));
  for (const easing of ['linear', 'smooth', 'gentle']) {
    const distant = project([], { stops: [
      stop('first', null, { frame: { x: -50000, y: 2000, scale: 2 }, transition: 0, dwell: 0 }),
      stop('second', null, { frame: { x: 50000, y: -2000, scale: 2 }, transition: 4, easing }),
    ] });
    const middle = sampleCamera(distant, 2, viewport).camera;
    assert.ok(middle.scale < 0.01);
    pointNear(middle, { x: 0, y: 0 }, 1e-8);
    assert.deepEqual(sampleCamera(distant, 0, viewport).camera, distant.stops[0].frame);
    assert.deepEqual(sampleCamera(distant, 4, viewport).camera, distant.stops[1].frame);
    const times = Array.from({ length: 41 }, (_, index) => index / 10);
    const samples = times.map(time => sampleCamera(distant, time, viewport));
    assert.deepEqual([...times].reverse().map(time => sampleCamera(distant, time, viewport)).reverse(), samples);
    assert.ok(samples.every(sample => Object.values(sample.camera).every(Number.isFinite)));
  }
});

test('empty and zero-duration timelines produce deterministic finite final cameras', () => {
  assert.equal(timelineDuration(project()), 0);
  assert.deepEqual(sampleCamera(project(), 10, viewport), {
    camera: { x: 0, y: 0, scale: 1 }, stopIndex: -1, phase: 'dwell', localTime: 0,
  });
  const doc = project([node('a'), node('b', { x: 700 })], { stops: [
    stop('first', 'a', { transition: 0, dwell: 0 }), stop('second', 'b', { transition: 0, dwell: 0 }),
  ] });
  assert.deepEqual(sampleCamera(doc, 0, viewport), { camera: frameNode(doc, 'b', viewport), stopIndex: 1, phase: 'dwell', localTime: 0 });
});

test('million-to-one nested flights keep the destination in view and return along the same spatial path', () => {
  const from = { x: 600, y: 390, scale: .6 };
  const to = { x: 880, y: 530, scale: 600000 };
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const forward = interpolateCamera(from, to, t, 'smooth', viewport);
    const point = screen(forward, to);
    assert.ok(point.x >= 0 && point.x <= viewport.width);
    assert.ok(point.y >= 0 && point.y <= viewport.height);
    const reverse = interpolateCamera(to, from, 1 - t, 'smooth', viewport);
    pointNear(forward, reverse, 1e-9);
    near(forward.scale / reverse.scale, 1, 1e-10);
  }
});

test('deletion removes descendants and their source links, but preserves unresolved stop IDs', () => {
  const original = freeze(project([
    node('keep', { x: 12000, y: 9000 }), node('remove', { type: 'group' }),
    node('child', { parentId: 'remove' }), node('grandchild', { parentId: 'child' }),
  ], {
    stops: [stop('first', 'keep'), stop('second', 'grandchild')],
    links: [
      { id: 'keepLink', sourceId: 'keep', targetStopId: 'second', label: 'Unresolved destination' },
      { id: 'removeLink', sourceId: 'child', targetStopId: 'first', label: 'Removed' },
    ],
  }));
  const doc = deleteNodes(original, ['remove', 'unknown']);
  assert.deepEqual(doc.nodes.map(node => node.id), ['keep']);
  assert.deepEqual(doc.links.map(link => link.id), ['keepLink']);
  assert.equal(doc.stops[1].targetId, 'grandchild');
  assert.equal(frameNode(doc, doc.stops[1].targetId, viewport), null);
  assert.equal(original.nodes.length, 4);
  assert.equal(original.links.length, 2);
  const validated = validateProject(doc);
  assert.equal(validated.stops[1].targetId, 'grandchild');
  for (const time of [3, 3.5, 4, 5, 6, 100]) {
    assert.deepEqual(sampleCamera(doc, time, viewport).camera, frameNode(doc, 'keep', viewport));
  }
  const unresolvedFirst = { ...doc, stops: [stop('unresolved', 'gone')] };
  assert.deepEqual(sampleCamera(unresolvedFirst, 0.5, viewport).camera, fitProject(doc, viewport));
  assert.deepEqual(sampleCamera(unresolvedFirst, 2, viewport).camera, fitProject(doc, viewport));
  const staleFrame = { x: 0, y: 0, scale: 1 };
  const unresolvedWithFrame = { ...doc, stops: [doc.stops[0], { ...doc.stops[1], frame: staleFrame }] };
  assert.deepEqual(sampleCamera(unresolvedWithFrame, 3.5, viewport).camera, frameNode(doc, 'keep', viewport));
  const firstWithFrame = { ...unresolvedFirst, stops: [{ ...unresolvedFirst.stops[0], frame: staleFrame }] };
  assert.deepEqual(sampleCamera(firstWithFrame, 0.5, viewport).camera, fitProject(doc, viewport));
});

test('ungrouping removes only the group and its source links while leaving its stop unresolved', () => {
  const doc = freeze(project([node('group', { type: 'group', scale: 3, rotation: 23 }), node('child', { parentId: 'group' })], {
    stops: [stop('first', 'group')],
    links: [{ id: 'link', sourceId: 'group', targetStopId: 'first', label: '' }],
  }));
  const result = ungroupNode(doc, 'group');
  assert.equal(result.nodes[0].id, 'child');
  assert.equal(result.nodes[0].parentId, null);
  assert.deepEqual(result.links, []);
  assert.equal(result.stops[0].targetId, 'group');
  assert.equal(frameNode(result, 'group', viewport), null);
  const expected = worldMatrix(doc, 'child');
  worldMatrix(result, 'child').forEach((value, index) => near(value, expected[index]));
  assert.equal(ungroupNode(result, 'missing'), result);
});

test('validation round-trips the schema and deeply clones nested data without changing stable IDs', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><defs><linearGradient id="paint"><stop offset="0" stop-color="#ffd400"/><stop offset="1" stop-color="#ff8800"/></linearGradient></defs><rect width="100" height="80" fill="url(#paint)"/><text x="5" y="20">Original &amp; safe</text></svg>';
  const doc = freeze(project([
    node('scene', { type: 'scene', clip: true, fill: '#000', minZoom: 1e-5, maxZoom: 1e10 }),
    node('text', { type: 'text', parentId: 'scene', text: 'Hello world', fontSize: 24, fontFamily: 'Georgia',
      fontWeight: 'bold', align: 'center', color: '#fff', runs: [{ text: 'Hello ', bold: true, italic: false }, { text: 'world', italic: true }] }),
    node('image', { type: 'image', assetId: 'art', fit: 'cover', crop: { x: 0.5, y: 0.3, zoom: 1.2 } }),
    node('path', { type: 'path', path: 'M0 0 L1e2 0 Q100 80 0 80 Z', fill: 'none', stroke: '#fff', strokeWidth: 2 }),
    node('ellipse', { type: 'ellipse' }), node('line', { type: 'line', h: 0.001 }), node('group', { type: 'group' }),
  ], {
    assets: { art: { id: 'art', name: 'Original sample', mime: 'image/svg+xml', width: 100, height: 80, dataUrl: `data:image/svg+xml,${encodeURIComponent(svg)}` } },
    stops: [stop('first', 'scene', { choice: true }), stop('second', 'missingTarget', { frame: { x: 10, y: -20, scale: 1e-5 }, easing: 'gentle' })],
    links: [{ id: 'link', sourceId: 'text', targetStopId: 'second', label: 'Explore' }],
  }));
  const validated = validateProject(doc);
  assert.deepEqual(validated, doc);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(validated))), validated);
  assert.notEqual(validated, doc);
  assert.notEqual(validated.nodes, doc.nodes);
  assert.notEqual(validated.nodes[1].runs[0], doc.nodes[1].runs[0]);
  assert.notEqual(validated.nodes[2].crop, doc.nodes[2].crop);
  assert.notEqual(validated.assets.art, doc.assets.art);
  assert.notEqual(validated.stops[1].frame, doc.stops[1].frame);
  assert.notEqual(validated.links[0], doc.links[0]);
  validated.nodes[1].runs[0].text = 'Changed';
  assert.equal(doc.nodes[1].runs[0].text, 'Hello ');
});

test('validation accepts supported embedded raster MIME types and base64 SVG', () => {
  for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
    const doc = project([node('image', { type: 'image', assetId: 'asset' })], {
      assets: { asset: { mime, dataUrl: `data:${mime};base64,AAAA` } },
    });
    assert.deepEqual(validateProject(doc), doc);
  }
  const svg = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><!-- original sample --><g><path d="M0 0L5 5"/></g></svg>';
  const doc = project([], { assets: { art: { dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` } } });
  assert.deepEqual(validateProject(doc), doc);
});

test('validation preserves and clones reducedMotion settings and rejects non-booleans', () => {
  for (const reducedMotion of [false, true]) {
    const doc = freeze(project([], { settings: { reducedMotion } }));
    const validated = validateProject(doc);
    assert.deepEqual(validated, doc);
    assert.notEqual(validated.settings, doc.settings);
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(validated))), validated);
  }
  for (const reducedMotion of [null, 0, 'false']) {
    assert.throws(() => validateProject(project([], { settings: { reducedMotion } })), /Project.settings.reducedMotion must be a boolean/);
  }
});

test('validation rejects unsupported versions, malformed shapes, unsafe IDs, and missing references', () => {
  const cases = [
    [null, /Project must be an object/],
    [[], /Project must be an object/],
    [project([], { version: 2 }), /Unsupported project version/],
    [project([], { id: '' }), /Project.id/],
    [project([], { name: 'x'.repeat(1001) }), /Project.name/],
    [project([], { nodes: {} }), /Project.nodes/],
    [project([], { assets: [] }), /Project.assets/],
    [project([null]), /Node must be an object/],
    [project([node('bad id')]), /invalid ID/],
    [project([node('__proto__')]), /reserved ID/],
    [project([node('a', { type: 'video' })]), /unknown node type/],
    [project([node('a'), node('a')]), /Duplicate global ID/],
    [project([node('project')]), /Duplicate global ID/],
    [project([node('a')], { stops: [stop('a', 'a')] }), /Duplicate global ID/],
    [project([node('a', { parentId: 'missing' })]), /missing parent/],
    [project([node('a', { parentId: 'a' })]), /cycle/],
    [project([node('a', { parentId: 'b' }), node('b', { parentId: 'a' })]), /cycle/],
    [project([node('a', { assetId: 'missing' })]), /missing asset/],
    [project([], { stops: [stop('first', 'missing', { easing: 'bounce' })] }), /unknown easing/],
    [project([], { stops: [stop('first', 'missing', { dwell: -1 })] }), /dwell/],
    [project([], { stops: [stop('first', 'missing', { dwell: null })] }), /dwell/],
    [project([], { stops: [stop('first', 'missing', { easing: null })] }), /easing/],
    [project([], { stops: [stop('first', 'missing', { title: null })] }), /title/],
    [project([], { stops: [stop('first', null, { frame: { x: 0, y: 0, scale: 0 } })] }), /frame.scale/],
    [project([], { stops: [stop('first', null, { caption: 'x'.repeat(20001) })] }), /caption/],
    [project([], { stops: [stop('first', null)], links: [{ id: 'link', sourceId: 'gone', targetStopId: 'first' }] }), /missing source node/],
    [project([node('a')], { links: [{ id: 'link', sourceId: 'a', targetStopId: 'gone' }] }), /missing stop/],
  ];
  for (const [doc, error] of cases) assert.throws(() => validateProject(doc), error);
});

test('validation rejects non-finite and out-of-bounds transforms and malformed optional node fields', () => {
  const cases = [
    ['x', NaN], ['x', Infinity], ['x', 1e12 + 1], ['y', -1e12 - 1], ['x', '10'], ['x', null],
    ['w', 0], ['h', -1], ['w', 1e6 + 1], ['h', undefined],
    ['scale', 1e-7], ['scale', 1e6 + 1], ['rotation', Infinity], ['rotation', 1e12 + 1],
    ['scale', null], ['rotation', null], ['opacity', null], ['name', null],
    ['opacity', -0.01], ['opacity', 1.01], ['hidden', 'true'], ['locked', 1], ['clip', {}],
    ['fill', 'url(https://example.com/pattern.svg)'], ['strokeWidth', -1], ['fontSize', 0],
    ['minZoom', -1], ['maxZoom', Infinity], ['fontFamily', 'x'.repeat(257)],
    ['fontWeight', 'heavy'], ['align', 'diagonal'], ['fit', 'stretch'],
    ['text', 'x'.repeat(200001)], ['runs', [{ text: 'test', bold: 1 }]],
    ['runs', [{ text: 'x'.repeat(100001) }, { text: 'x'.repeat(100000) }]],
    ['crop', { x: 0, y: 0, zoom: 0 }], ['path', '<script/>'], ['path', 'M1e999 0'],
    ['path', 'M'.repeat(500001)],
  ];
  for (const [key, value] of cases) {
    assert.throws(() => validateProject(project([node('a', { [key]: value })])), new RegExp(key));
  }
  assert.throws(() => validateProject(project([node('a', { minZoom: 10, maxZoom: 2 })])), /minZoom/);
  assert.throws(() => validateProject(project([
    node('a', { scale: 1e6 }), node('b', { parentId: 'a', scale: 1e6 }), node('c', { parentId: 'b', scale: 1.01 }),
  ])), /composed scale/);
  assert.throws(() => validateProject(project([
    node('a', { scale: 1e-6 }), node('b', { parentId: 'a', scale: 1e-6 }), node('c', { parentId: 'b', scale: 0.99 }),
  ])), /composed scale/);
  assert.throws(() => validateProject(project([
    node('a', { scale: 1e6 }), node('b', { parentId: 'a', x: 1e12 }),
  ])), /composed world position/);
  validateProject(project([node('a', { scale: 1e6, rotation: 37 }), node('b', { parentId: 'a', scale: 1e6, rotation: 71 })]));
  validateProject(project([node('a', { scale: 1e-6, rotation: 37 }), node('b', { parentId: 'a', scale: 1e-6, rotation: 71 })]));
});

test('validation rejects finite but unusable world geometry, including rotated thin dimensions', () => {
  const error = /Node "tiny" is too small at this world position; move closer to origin/;
  for (const values of [
    { type: 'scene', x: 1e12, y: -1e12, scale: 1e-6 },
    { x: -1e12, w: 1e-6, h: 1e6, rotation: 45 },
    { y: 1e12, w: 1e6, h: 1e-6, rotation: 45 },
  ]) {
    const doc = project([node('tiny', values)]);
    assert.ok(worldMatrix(doc, 'tiny').every(Number.isFinite));
    const bounds = worldBounds(doc, 'tiny');
    assert.ok(Object.values(bounds).every(Number.isFinite));
    assert.ok(bounds.w > 0 && bounds.h > 0);
    assert.ok(Object.values(frameNode(doc, 'tiny', viewport)).every(Number.isFinite));
    assert.throws(() => validateProject(doc), error);
  }
  const nested = project([
    node('parent', { type: 'group', x: 1e12, y: -1e12, scale: 1e-3, rotation: 90 }),
    node('tiny', { parentId: 'parent', type: 'scene', w: 1, h: 1, scale: 1e-3 }),
  ]);
  assert.throws(() => validateProject(nested), error);
  assert.throws(() => validateProject({ ...nested, nodes: [...nested.nodes].reverse() }), error);
  for (const dimension of ['w', 'h']) {
    assert.throws(() => validateProject(project([
      node('tiny', { [dimension]: Number.MIN_VALUE, scale: 1e-6 }),
    ])), error);
  }
});

test('world position precision accepts equality and rejects either local dimension just below it', () => {
  for (const axis of ['x', 'y']) {
    for (const position of [-(2 ** 39), 2 ** 39]) {
      for (const dimension of ['w', 'h']) {
        const scale = 2 ** -10;
        const minimum = Math.abs(position) * Number.EPSILON * 8 / scale;
        const candidate = node('boundary', { [axis]: position, scale, [dimension]: minimum });
        const doc = project([candidate]);
        assert.deepEqual(validateProject(doc), doc);
        assert.throws(() => validateProject(project([
          { ...candidate, [dimension]: minimum * (1 - Number.EPSILON) },
        ])), /too small at this world position; move closer to origin/);
        const above = project([{ ...candidate, [dimension]: minimum * (1 + Number.EPSILON) }]);
        assert.deepEqual(validateProject(above), above);
      }
    }
  }
});

test('validation handles 20000 siblings and maximum hierarchy depth 64 and enforces document count limits', () => {
  const nodes = Array.from({ length: 20000 }, (_, index) => node(`n${index}`));
  const validated = validateProject(project(nodes));
  assert.equal(validated.nodes.length, 20000);
  assert.deepEqual(worldMatrix(validated, 'n19999'), identity);
  assert.equal(deleteNodes(validated, ['n0']).nodes.length, 19999);
  assert.deepEqual(fitProject(validated, viewport), frameNode(validated, 'n19999', viewport));
  const chain = nodes.map((item, index) => ({
    ...item, parentId: index ? `n${index - 1}` : null, type: ['scene', 'group', 'rect'][index % 3],
  }));
  for (const ordered of [chain.slice(0, 64), chain.slice(0, 64).reverse()]) {
    const doc = validateProject(project(ordered));
    assert.equal(doc.nodes.length, 64);
    assert.deepEqual(worldMatrix(doc, 'n63'), identity);
    assert.equal(deleteNodes(doc, ['n0']).nodes.length, 0);
    assert.deepEqual(fitProject(doc, viewport), frameNode(doc, 'n63', viewport));
  }
  for (const length of [65, 20000]) {
    for (const ordered of [chain.slice(0, length), chain.slice(0, length).reverse()]) {
      assert.throws(() => validateProject(project(ordered)), {
        name: 'Error',
        message: 'Node "n64" exceeds maximum supported hierarchy depth of 64 (root depth is 1)',
      });
    }
  }
  assert.throws(() => validateProject(project(Array(20001).fill(null))), /at most 20000/);
  assert.throws(() => validateProject(project([], { stops: Array(2001).fill(null) })), /at most 2000/);
  assert.throws(() => validateProject(project([], { links: Array(3001).fill(null) })), /at most 3000/);
});

test('SVG import rejects scripting, events, foreign content, entities, remote references and malformed XML', () => {
  const payloads = [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"/>',
    '<svg><rect oNcLiCk="alert(1)"/></svg>',
    '<svg><foreignObject><div>unsafe</div></foreignObject></svg>',
    '<svg><image href="https://example.com/a.png"/></svg>',
    '<svg><use href="https://example.com/a.svg#x"/></svg>',
    '<svg><use href="//example.com/a.svg#x"/></svg>',
    '<svg><use href="other.svg#x"/></svg>',
    '<svg><use href="javascript:alert(1)"/></svg>',
    '<svg><use href="&#x6a;avascript:alert(1)"/></svg>',
    '<svg><use href="data:image/svg+xml,bad"/></svg>',
    '<svg><rect fill="url(https://example.com/a.svg#x)"/></svg>',
    '<svg><rect fill="url(&#x2f;&#x2f;example.com/a.svg#x)"/></svg>',
    '<svg><rect style="fill:url(https://example.com/a.svg)"/></svg>',
    '<svg><style>@import url(https://example.com/a.css)</style></svg>',
    '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
    '<svg xml:base="https://example.com/"><use href="#x"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<?xml-stylesheet href="https://example.com/a.css"?><svg/>',
    '<svg xmlns="https://example.com/namespace"/>',
    '<svg><g></svg>', '<svg/><svg/>', '<svg width="1" width="2"/>', '<svg width=1/>',
    '<svg><text>&unknown;</text></svg>', '<svg><text>&#0;</text></svg>', '<svg',
  ];
  for (const svg of payloads) {
    for (const dataUrl of [`data:image/svg+xml,${encodeURIComponent(svg)}`, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`]) {
      assert.throws(() => validateProject(project([], { assets: { unsafe: { dataUrl } } })), /SVG/);
    }
  }
});

test('asset validation rejects unsupported MIME, remote URLs, invalid encoding, mismatched IDs and oversized data', () => {
  const cases = [
    [{ dataUrl: 'https://example.com/image.png' }, /must embed/],
    [{ dataUrl: 'data:image/gif;base64,AAAA' }, /must embed/],
    [{ dataUrl: 'data:text/html;base64,AAAA' }, /must embed/],
    [{ dataUrl: 'data:image/png,raw' }, /base64/],
    [{ dataUrl: 'data:image/png;base64,%%%=' }, /base64/],
    [{ dataUrl: 'data:image/png;base64,AAAA', mime: 'image/jpeg' }, /MIME/],
    [{ dataUrl: 'data:image/png;base64,AAAA', id: 'other' }, /mismatched ID/],
    [{ dataUrl: 'data:image/svg+xml,%FF' }, /SVG encoding/],
    [{ dataUrl: 'data:image/svg+xml;base64,/w==' }, /SVG encoding/],
    [{ dataUrl: 'data:image/png;base64,AAAA', width: 0 }, /width/],
  ];
  for (const [asset, error] of cases) assert.throws(() => validateProject(project([], { assets: { asset } })), error);
  const large = `data:image/png;base64,${'A'.repeat(21 * 1024 * 1024)}`;
  assert.throws(() => validateProject(project([], { assets: { a: { dataUrl: large }, b: { dataUrl: large } } })), /Total asset data URI size exceeds 40MB/);
  assert.throws(() => validateProject(project([], { assets: { project: { dataUrl: 'data:image/png;base64,AAAA' } } })), /Duplicate global ID/);
});
