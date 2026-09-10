const IDENTITY = [1, 0, 0, 1, 0, 0];
const WORLD_LIMIT = 1e12;
const MAX_HIERARCHY_DEPTH = 64;
const MIN_CAMERA_SCALE = 1e-5;
const MAX_CAMERA_SCALE = 1e10;
const NODE_TYPES = new Set([
  "scene",
  "group",
  "text",
  "image",
  "rect",
  "ellipse",
  "line",
  "path",
]);
const EASINGS = new Set(["smooth", "linear", "gentle"]);
let idCounter = 0;

export function uid(prefix = "node") {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function inverse(m) {
  const determinant = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new Error("Cannot invert a singular or non-finite matrix");
  }
  return [
    m[3] / determinant,
    -m[1] / determinant,
    -m[2] / determinant,
    m[0] / determinant,
    (m[2] * m[5] - m[3] * m[4]) / determinant,
    (m[1] * m[4] - m[0] * m[5]) / determinant,
  ];
}

export function applyMatrix(m, point) {
  return {
    x: m[0] * point.x + m[2] * point.y + m[4],
    y: m[1] * point.x + m[3] * point.y + m[5],
  };
}

function localMatrix(node) {
  const angle = ((node.rotation ?? 0) * Math.PI) / 180;
  const scale = node.scale ?? 1;
  const c = Math.cos(angle) * scale;
  const s = Math.sin(angle) * scale;
  return [c, s, -s, c, node.x ?? 0, node.y ?? 0];
}

function hierarchy(project) {
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const matrices = new Map([[null, IDENTITY]]);
  const depths = new Map([[null, 0]]);
  function matrix(id) {
    if (id == null) return IDENTITY;
    if (!nodes.has(id)) return null;
    const path = [];
    const visiting = new Set();
    let current = id;
    while (!matrices.has(current)) {
      if (visiting.has(current))
        throw new Error(`Hierarchy cycle at node "${current}"`);
      const node = nodes.get(current);
      if (!node) throw new Error(`Missing parent "${current}"`);
      visiting.add(current);
      path.push(node);
      current = node.parentId ?? null;
    }
    let result = matrices.get(current);
    let depth = depths.get(current);
    for (let i = path.length - 1; i >= 0; i--) {
      if (++depth > MAX_HIERARCHY_DEPTH)
        throw new Error(
          `Node "${path[i].id}" exceeds maximum supported hierarchy depth of ${MAX_HIERARCHY_DEPTH} (root depth is 1)`,
        );
      result = multiply(result, localMatrix(path[i]));
      matrices.set(path[i].id, result);
      depths.set(path[i].id, depth);
    }
    return result;
  }
  return { nodes, matrix };
}

export function worldMatrix(project, id) {
  if (id == null) return null;
  const matrix = hierarchy(project).matrix(id);
  return matrix ? [...matrix] : null;
}

function boundsWithMatrix(node, matrix) {
  const center = applyMatrix(matrix, { x: node.w / 2, y: node.h / 2 });
  // Computing extents directly retains tiny widths at large world offsets.
  const w = Math.abs(matrix[0]) * node.w + Math.abs(matrix[2]) * node.h;
  const h = Math.abs(matrix[1]) * node.w + Math.abs(matrix[3]) * node.h;
  return { x: center.x - w / 2, y: center.y - h / 2, w, h };
}

export function worldBounds(project, id) {
  const tree = hierarchy(project);
  const node = tree.nodes.get(id);
  return node ? boundsWithMatrix(node, tree.matrix(id)) : null;
}

function relativeMatrix(world, parent) {
  // Subtract translations before inversion instead of cancelling two large products.
  const dx = world[4] - parent[4];
  const dy = world[5] - parent[5];
  const determinant = parent[0] * parent[3] - parent[1] * parent[2];
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new Error("Invalid parent transform");
  return [
    (parent[3] * world[0] - parent[2] * world[1]) / determinant,
    (parent[0] * world[1] - parent[1] * world[0]) / determinant,
    (parent[3] * world[2] - parent[2] * world[3]) / determinant,
    (parent[0] * world[3] - parent[1] * world[2]) / determinant,
    (parent[3] * dx - parent[2] * dy) / determinant,
    (parent[0] * dy - parent[1] * dx) / determinant,
  ];
}

function withMatrix(node, parentId, matrix) {
  return {
    ...node,
    parentId,
    x: matrix[4],
    y: matrix[5],
    scale: Math.hypot(matrix[0], matrix[1]),
    rotation: (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI,
  };
}

export function reparent(project, id, parentId) {
  parentId ??= null;
  const tree = hierarchy(project);
  const node = tree.nodes.get(id);
  if (!node) throw new Error(`Cannot reparent missing node "${id}"`);
  if (parentId !== null && !tree.nodes.has(parentId))
    throw new Error(`Missing parent "${parentId}"`);
  const visited = new Set([id]);
  for (
    let current = parentId;
    current !== null;
    current = tree.nodes.get(current)?.parentId ?? null
  ) {
    if (visited.has(current))
      throw new Error("Reparenting would create a hierarchy cycle");
    visited.add(current);
  }
  if ((node.parentId ?? null) === parentId) return project;
  const updated = withMatrix(
    node,
    parentId,
    relativeMatrix(tree.matrix(id), tree.matrix(parentId)),
  );
  return {
    ...project,
    nodes: project.nodes.map((item) => (item.id === id ? updated : item)),
  };
}

export function groupNodes(project, ids) {
  const tree = hierarchy(project);
  const selected = new Set(ids);
  if (!selected.size) throw new Error("Select at least one node to group");
  for (const id of selected) {
    if (!tree.nodes.has(id))
      throw new Error(`Cannot group missing node "${id}"`);
    tree.matrix(id);
  }
  const roots = project.nodes.filter((node) => {
    if (!selected.has(node.id)) return false;
    for (
      let parent = node.parentId;
      parent != null;
      parent = tree.nodes.get(parent).parentId
    ) {
      if (selected.has(parent)) return false;
    }
    return true;
  });
  const ancestors = (node) => {
    const result = [];
    for (
      let parent = node.parentId ?? null;
      parent !== null;
      parent = tree.nodes.get(parent).parentId ?? null
    )
      result.push(parent);
    result.push(null);
    return result;
  };
  let common = new Set(ancestors(roots[0]));
  for (const node of roots.slice(1)) {
    const parents = new Set(ancestors(node));
    common = new Set([...common].filter((id) => parents.has(id)));
  }
  const parentId = common.values().next().value;
  const parentMatrix = tree.matrix(parentId);
  const rootIds = new Set(roots.map((node) => node.id));
  const children = new Map();
  for (const node of project.nodes) {
    const parent = node.parentId ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  const pending = [...roots];
  while (pending.length) {
    const node = pending.pop();
    const bounds = boundsWithMatrix(
      node,
      relativeMatrix(tree.matrix(node.id), parentMatrix),
    );
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.w);
    bottom = Math.max(bottom, bounds.y + bounds.h);
    pending.push(...(children.get(node.id) ?? []));
  }
  const used = new Set([
    project.id,
    ...tree.nodes.keys(),
    ...Object.keys(project.assets ?? {}),
    ...(project.stops ?? []).map((stop) => stop.id),
    ...(project.links ?? []).map((link) => link.id),
  ]);
  let groupId;
  do {
    groupId = uid("group");
  } while (used.has(groupId));
  const group = {
    id: groupId,
    parentId,
    type: "group",
    name: "Group",
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
    scale: 1,
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
    clip: false,
  };
  const nodes = [];
  let inserted = false;
  for (const node of project.nodes) {
    if (!rootIds.has(node.id)) {
      nodes.push(node);
      continue;
    }
    if (!inserted) {
      nodes.push(group);
      inserted = true;
    }
    const matrix = relativeMatrix(tree.matrix(node.id), parentMatrix);
    matrix[4] -= left;
    matrix[5] -= top;
    nodes.push(withMatrix(node, groupId, matrix));
  }
  return { project: { ...project, nodes }, groupId };
}

export function ungroupNode(project, id) {
  const group = project.nodes.find((node) => node.id === id);
  if (!group) return project;
  if (group.type !== "group") throw new Error(`Node "${id}" is not a group`);
  const matrix = localMatrix(group);
  return {
    ...project,
    nodes: project.nodes
      .filter((node) => node.id !== id)
      .map((node) =>
        node.parentId === id
          ? withMatrix(
              node,
              group.parentId ?? null,
              multiply(matrix, localMatrix(node)),
            )
          : node,
      ),
    links: (project.links ?? []).filter((link) => link.sourceId !== id),
  };
}

export function deleteNodes(project, ids) {
  const removed = new Set(ids);
  const children = new Map();
  for (const node of project.nodes) {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node.id);
  }
  const pending = [...removed];
  while (pending.length) {
    for (const id of children.get(pending.pop()) ?? []) {
      if (!removed.has(id)) {
        removed.add(id);
        pending.push(id);
      }
    }
  }
  return {
    ...project,
    nodes: project.nodes.filter((node) => !removed.has(node.id)),
    links: (project.links ?? []).filter((link) => !removed.has(link.sourceId)),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clampCamera(camera) {
  const number = (value, fallback) =>
    typeof value === "number" && !Number.isNaN(value) ? value : fallback;
  return {
    x: clamp(number(camera?.x, 0), -WORLD_LIMIT, WORLD_LIMIT),
    y: clamp(number(camera?.y, 0), -WORLD_LIMIT, WORLD_LIMIT),
    scale: clamp(number(camera?.scale, 1), MIN_CAMERA_SCALE, MAX_CAMERA_SCALE),
  };
}

function checkViewport(viewport) {
  if (
    !viewport ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    throw new Error("Viewport width and height must be finite and positive");
}

export function zoomAt(camera, point, factor, viewport) {
  checkViewport(viewport);
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error("Zoom factor must be finite and positive");
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error("Zoom point must be finite");
  const start = clampCamera(camera);
  const scale = clamp(start.scale * factor, MIN_CAMERA_SCALE, MAX_CAMERA_SCALE);
  const difference = 1 / start.scale - 1 / scale;
  return clampCamera({
    x: start.x + (point.x - viewport.width / 2) * difference,
    y: start.y + (point.y - viewport.height / 2) * difference,
    scale,
  });
}

function frameBounds(bounds, viewport, padding) {
  checkViewport(viewport);
  if (!Number.isFinite(padding) || padding < 0)
    throw new Error("Frame padding must be finite and non-negative");
  return clampCamera({
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
    scale: Math.min(
      Math.max(1, viewport.width - 2 * padding) / bounds.w,
      Math.max(1, viewport.height - 2 * padding) / bounds.h,
    ),
  });
}

export function frameNode(project, id, viewport, padding = 70) {
  const bounds = worldBounds(project, id);
  return bounds ? frameBounds(bounds, viewport, padding) : null;
}

export function fitProject(project, viewport) {
  checkViewport(viewport);
  const tree = hierarchy(project);
  const hidden = new Map([[null, false]]);
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const node of project.nodes) {
    const matrix = tree.matrix(node.id);
    const path = [];
    let current = node.id;
    while (!hidden.has(current)) {
      const ancestor = tree.nodes.get(current);
      path.push(ancestor);
      current = ancestor.parentId ?? null;
    }
    let isHidden = hidden.get(current);
    for (let i = path.length - 1; i >= 0; i--) {
      isHidden ||= Boolean(path[i].hidden);
      hidden.set(path[i].id, isHidden);
    }
    if (hidden.get(node.id)) continue;
    const bounds = boundsWithMatrix(node, matrix);
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.w);
    bottom = Math.max(bottom, bounds.y + bounds.h);
  }
  return left === Infinity
    ? { x: 0, y: 0, scale: 1 }
    : frameBounds(
        { x: left, y: top, w: right - left, h: bottom - top },
        viewport,
        70,
      );
}

export function timelineDuration(project) {
  return project.stops.reduce(
    (total, stop) => total + (stop.transition ?? 0) + (stop.dwell ?? 0),
    0,
  );
}

export function interpolateCamera(from, to, progress, easing, viewport) {
  if (
    progress <= 0 ||
    (from.x === to.x && from.y === to.y && from.scale === to.scale)
  )
    return { ...from };
  if (progress >= 1) return { ...to };
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const visibleSpan = Math.min(viewport.width, viewport.height);
  if (distance * Math.min(from.scale, to.scale) > visibleSpan * 0.75) {
    const middle = {
      x: from.x + (to.x - from.x) / 2,
      y: from.y + (to.y - from.y) / 2,
      scale: clamp(
        (visibleSpan * 0.65) / distance,
        MIN_CAMERA_SCALE,
        Math.min(from.scale, to.scale),
      ),
    };
    // Reveal the shared spatial context before descending into a distant branch.
    return progress < 0.5
      ? interpolateCamera(from, middle, progress * 2, easing, viewport)
      : interpolateCamera(middle, to, (progress - 0.5) * 2, easing, viewport);
  }
  const t =
    easing === "linear"
      ? progress
      : easing === "gentle"
        ? (1 - Math.cos(Math.PI * progress)) / 2
        : progress * progress * (3 - 2 * progress);
  const start = Math.log(from.scale);
  const end = Math.log(to.scale);
  const logScale = start + (end - start) * t;
  // Interpolate centers in inverse scale space, keeping a nested destination in view.
  const position =
    Math.abs(end - start) < 1e-6
      ? t
      : Math.expm1(-(end - start) * t) / Math.expm1(-(end - start));
  return clampCamera({
    x: from.x + (to.x - from.x) * position,
    y: from.y + (to.y - from.y) * position,
    scale: Math.exp(logScale),
  });
}

export function sampleCamera(project, time, viewport) {
  const overview = fitProject(project, viewport);
  if (!project.stops.length)
    return { camera: overview, stopIndex: -1, phase: "dwell", localTime: 0 };
  const tree = hierarchy(project);
  const total = timelineDuration(project);
  let remaining = clamp(
    typeof time === "number" && !Number.isNaN(time) ? time : 0,
    0,
    total,
  );
  let previous = overview;
  for (let index = 0; index < project.stops.length; index++) {
    const stop = project.stops[index];
    const node = tree.nodes.get(stop.targetId);
    const unresolved = stop.targetId != null && !node;
    const target = unresolved
      ? previous
      : stop.frame
        ? clampCamera(stop.frame)
        : node
          ? frameBounds(
              boundsWithMatrix(node, tree.matrix(node.id)),
              viewport,
              70,
            )
          : previous;
    const transition = stop.transition ?? 0;
    const dwell = stop.dwell ?? 0;
    if (remaining < transition) {
      return {
        camera: interpolateCamera(
          previous,
          target,
          remaining / transition,
          stop.easing ?? "smooth",
          viewport,
        ),
        stopIndex: index,
        phase: "transition",
        localTime: remaining,
      };
    }
    if (remaining < transition + dwell || index === project.stops.length - 1) {
      return {
        camera: { ...target },
        stopIndex: index,
        phase: "dwell",
        localTime: clamp(remaining - transition, 0, dwell),
      };
    }
    remaining -= transition + dwell;
    previous = target;
  }
}

function record(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label, max, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw new Error(
      `${label} must be ${required ? "a non-empty" : "a"} string of at most ${max} characters`,
    );
  }
  return value;
}

function identifier(value, label) {
  text(value, label, 256, true);
  if (
    /[\u0000-\u0020\u007f]/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  ) {
    throw new Error(`${label} contains invalid ID characters or a reserved ID`);
  }
  return value;
}

function number(value, label, min, max, exclusive = false) {
  if (
    !Number.isFinite(value) ||
    (exclusive ? value <= min : value < min) ||
    value > max
  ) {
    throw new Error(
      `${label} must be finite and ${exclusive ? "greater than" : "at least"} ${min}, and at most ${max}`,
    );
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function array(value, label, max) {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${label} must be an array with at most ${max} entries`);
  return value;
}

function cameraValue(value, label) {
  record(value, label);
  return {
    x: number(value.x, `${label}.x`, -WORLD_LIMIT, WORLD_LIMIT),
    y: number(value.y, `${label}.y`, -WORLD_LIMIT, WORLD_LIMIT),
    scale: number(
      value.scale,
      `${label}.scale`,
      MIN_CAMERA_SCALE,
      MAX_CAMERA_SCALE,
    ),
  };
}

const SVG_ELEMENTS = new Set(
  (
    "svg g defs title desc path rect circle ellipse line polyline polygon " +
    "text tspan linearGradient radialGradient stop clipPath mask pattern use"
  ).split(" "),
);
const SVG_ATTRIBUTES = new Set(
  (
    "xmlns xmlns:xlink xml:space version id x y x1 y1 x2 y2 cx cy r rx ry " +
    "width height viewBox preserveAspectRatio d points transform fill fill-opacity fill-rule stroke " +
    "stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset " +
    "stroke-opacity opacity clip-path clip-rule mask gradientUnits gradientTransform spreadMethod " +
    "offset stop-color stop-opacity fx fy fr patternUnits patternContentUnits patternTransform " +
    "text-anchor dominant-baseline font-family font-size font-weight font-style letter-spacing " +
    "word-spacing dx dy rotate textLength lengthAdjust href xlink:href role aria-label aria-hidden"
  ).split(" "),
);

function xmlText(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(value))
    throw new Error("SVG contains an unsupported entity");
  return value.replace(/&([^;]+);/g, (_, entity) => {
    if (entity[0] !== "#")
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity];
    const code =
      entity[1] === "x"
        ? parseInt(entity.slice(2), 16)
        : Number(entity.slice(1));
    if (code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      throw new Error("SVG contains an invalid character entity");
    return String.fromCodePoint(code);
  });
}

function validateSvg(svg) {
  svg = svg.replace(/^\uFEFF/, "").trim();
  svg = svg.replace(
    /^<\?xml\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])UTF-8\2)?\s*\?>/i,
    "",
  );
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  if (/<[!?]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(svg)) {
    throw new Error(
      "SVG declarations, processing instructions, and control characters are forbidden",
    );
  }
  const stack = [];
  let position = 0;
  let root = false;
  const tags = /<[^>]*>/g;
  let match;
  while ((match = tags.exec(svg))) {
    const content = svg.slice(position, match.index);
    if (content.includes("<") || (!stack.length && content.trim()))
      throw new Error("SVG has malformed content");
    xmlText(content);
    const tag = /^<(\/?)([A-Za-z][A-Za-z0-9]*)([\s\S]*?)(\/?)>$/.exec(match[0]);
    if (!tag || !SVG_ELEMENTS.has(tag[2]))
      throw new Error("SVG contains an unsafe or unsupported element");
    const [, closing, name, attributes, selfClosing] = tag;
    if (closing) {
      if (selfClosing || attributes.trim() || stack.pop() !== name)
        throw new Error("SVG has mismatched closing tags");
    } else {
      if (!stack.length) {
        if (root || name !== "svg")
          throw new Error("SVG must have exactly one svg root");
        root = true;
      }
      const attribute =
        /\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
      const seen = new Set();
      let consumed = 0;
      let item;
      while ((item = attribute.exec(attributes))) {
        consumed = attribute.lastIndex;
        const key = item[1];
        const value = xmlText(item[2] ?? item[3]);
        if (/^on/i.test(key) || !SVG_ATTRIBUTES.has(key) || seen.has(key))
          throw new Error(
            `SVG contains unsafe or unsupported attribute "${key}"`,
          );
        seen.add(key);
        if (key === "xmlns" || key === "xmlns:xlink") {
          const expected =
            key === "xmlns"
              ? "http://www.w3.org/2000/svg"
              : "http://www.w3.org/1999/xlink";
          if (value !== expected)
            throw new Error("SVG contains an unsafe namespace");
          continue;
        }
        if (
          (key === "href" || key === "xlink:href") &&
          !/^#[A-Za-z_][\w.:-]*$/.test(value)
        ) {
          throw new Error("SVG external references are forbidden");
        }
        if (
          /[<>\\]|(?:javascript|vbscript|data|https?|ftp|file):|\/\/|@import|expression\s*\(/i.test(
            value,
          ) ||
          (/url\s*\(/i.test(value) &&
            !/^url\(\s*(["']?)#[A-Za-z_][\w.:-]*\1\s*\)$/i.test(value))
        ) {
          throw new Error("SVG contains an unsafe value or external reference");
        }
      }
      if (attributes.slice(consumed).trim())
        throw new Error("SVG has malformed attributes");
      if (!selfClosing) stack.push(name);
    }
    position = tags.lastIndex;
  }
  if (!root || stack.length || svg.slice(position).trim())
    throw new Error("SVG is malformed or incomplete");
}

function assetValue(value, id, budget) {
  record(value, `Asset "${id}"`);
  if (value.id !== undefined && value.id !== id)
    throw new Error(`Asset "${id}" has a mismatched ID`);
  const dataUrl = text(
    value.dataUrl,
    `Asset "${id}".dataUrl`,
    40 * 1024 * 1024,
    true,
  );
  budget.size += new TextEncoder().encode(dataUrl).byteLength;
  if (budget.size > 40 * 1024 * 1024)
    throw new Error("Total asset data URI size exceeds 40MB");
  const match =
    /^data:(image\/(?:png|jpeg|webp|svg\+xml))(?:;charset=(?:utf-8|us-ascii))?(;base64)?,([\s\S]+)$/i.exec(
      dataUrl,
    );
  if (!match)
    throw new Error(
      `Asset "${id}" must embed a PNG, JPEG, WebP, or SVG data URI`,
    );
  const mime = match[1].toLowerCase();
  if (value.mime !== undefined && value.mime !== mime)
    throw new Error(`Asset "${id}" MIME does not match its data URI`);
  const base64 = Boolean(match[2]);
  if (!base64 && mime !== "image/svg+xml")
    throw new Error(`Asset "${id}" must use base64 for raster images`);
  if (
    base64 &&
    (match[3].length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(match[3]))
  ) {
    throw new Error(`Asset "${id}" contains invalid base64`);
  }
  if (mime === "image/svg+xml") {
    let svg;
    try {
      svg = base64
        ? new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(atob(match[3]), (character) =>
              character.charCodeAt(0),
            ),
          )
        : decodeURIComponent(match[3]);
    } catch {
      throw new Error(`Asset "${id}" contains invalid SVG encoding`);
    }
    validateSvg(svg);
  }
  const result = { dataUrl };
  if (value.id !== undefined) result.id = id;
  if (value.mime !== undefined) result.mime = mime;
  if (value.name !== undefined)
    result.name = text(value.name, `Asset "${id}".name`, 1000);
  for (const key of ["width", "height"]) {
    if (value[key] !== undefined)
      result[key] = number(value[key], `Asset "${id}".${key}`, 0, 1e6, true);
  }
  return result;
}

/**
 * Supports at most 64 hierarchy levels, counting every node type and roots as
 * level 1, to bound renderer recursion. Each scaled local dimension must be
 * positive and >= max(abs(worldX), abs(worldY)) * Number.EPSILON * 8.
 */
export function validateProject(input) {
  record(input, "Project");
  if (input.version !== 1)
    throw new Error(`Unsupported project version: ${String(input.version)}`);
  const ids = new Set();
  const claim = (value, label) => {
    identifier(value, label);
    if (ids.has(value))
      throw new Error(`Duplicate global ID "${value}" (${label})`);
    ids.add(value);
    return value;
  };
  const project = {
    version: 1,
    id: claim(input.id, "Project.id"),
    name: text(input.name, "Project.name", 1000),
    nodes: [],
    assets: {},
    stops: [],
    links: [],
  };
  if (input.settings !== undefined) {
    record(input.settings, "Project.settings");
    project.settings = {};
    if (input.settings.reducedMotion !== undefined)
      project.settings.reducedMotion = boolean(
        input.settings.reducedMotion,
        "Project.settings.reducedMotion",
      );
  }
  record(input.assets, "Project.assets");
  const budget = { size: 0 };
  const assetEntries = Object.entries(input.assets);
  if (assetEntries.length > 20000)
    throw new Error("Project.assets must have at most 20000 entries");
  for (const [id, asset] of assetEntries) {
    claim(id, "Asset ID");
    project.assets[id] = assetValue(asset, id, budget);
  }
  for (const raw of array(input.nodes, "Project.nodes", 20000)) {
    record(raw, "Node");
    const id = claim(raw.id, "Node.id");
    const label = `Node "${id}"`;
    if (!NODE_TYPES.has(raw.type))
      throw new Error(`${label} has unknown node type "${raw.type}"`);
    const node = {
      id,
      parentId:
        raw.parentId == null
          ? null
          : identifier(raw.parentId, `${label}.parentId`),
      type: raw.type,
      name: text(
        raw.name === undefined ? raw.type : raw.name,
        `${label}.name`,
        1000,
      ),
      x: number(
        raw.x === undefined ? 0 : raw.x,
        `${label}.x`,
        -WORLD_LIMIT,
        WORLD_LIMIT,
      ),
      y: number(
        raw.y === undefined ? 0 : raw.y,
        `${label}.y`,
        -WORLD_LIMIT,
        WORLD_LIMIT,
      ),
      w: number(raw.w, `${label}.w`, 0, 1e6, true),
      h: number(raw.h, `${label}.h`, 0, 1e6, true),
      scale: number(
        raw.scale === undefined ? 1 : raw.scale,
        `${label}.scale`,
        1e-6,
        1e6,
      ),
      rotation: number(
        raw.rotation === undefined ? 0 : raw.rotation,
        `${label}.rotation`,
        -1e12,
        1e12,
      ),
      opacity: number(
        raw.opacity === undefined ? 1 : raw.opacity,
        `${label}.opacity`,
        0,
        1,
      ),
    };
    for (const key of ["hidden", "locked", "clip"]) {
      if (raw[key] !== undefined)
        node[key] = boolean(raw[key], `${label}.${key}`);
    }
    for (const key of ["fill", "stroke", "color"]) {
      if (raw[key] !== undefined) {
        node[key] = text(raw[key], `${label}.${key}`, 256);
        if (/[<>]|url\s*\(/i.test(node[key]))
          throw new Error(
            `${label}.${key} must be a color, not markup or a URL`,
          );
      }
    }
    for (const key of ["strokeWidth", "fontSize"]) {
      if (raw[key] !== undefined)
        node[key] = number(
          raw[key],
          `${label}.${key}`,
          0,
          1e6,
          key === "fontSize",
        );
    }
    for (const key of ["minZoom", "maxZoom"]) {
      if (raw[key] !== undefined)
        node[key] = number(raw[key], `${label}.${key}`, 0, MAX_CAMERA_SCALE);
    }
    if (
      node.minZoom !== undefined &&
      node.maxZoom !== undefined &&
      node.minZoom > node.maxZoom
    )
      throw new Error(`${label}.minZoom exceeds maxZoom`);
    if (raw.text !== undefined)
      node.text = text(raw.text, `${label}.text`, 200000);
    if (raw.fontFamily !== undefined)
      node.fontFamily = text(raw.fontFamily, `${label}.fontFamily`, 256);
    if (raw.fontWeight !== undefined) {
      if (typeof raw.fontWeight === "number")
        node.fontWeight = number(
          raw.fontWeight,
          `${label}.fontWeight`,
          1,
          1000,
        );
      else {
        if (
          !/^(?:normal|bold|[1-9]\d{0,2}|1000)$/.test(raw.fontWeight) ||
          typeof raw.fontWeight !== "string"
        )
          throw new Error(`${label}.fontWeight is invalid`);
        node.fontWeight = raw.fontWeight;
      }
    }
    if (raw.align !== undefined) {
      if (!["left", "center", "right", "justify"].includes(raw.align))
        throw new Error(`${label}.align is invalid`);
      node.align = raw.align;
    }
    if (raw.runs !== undefined) {
      let length = 0;
      node.runs = array(raw.runs, `${label}.runs`, 10000).map((run, index) => {
        record(run, `${label}.runs[${index}]`);
        const result = {
          text: text(run.text, `${label}.runs[${index}].text`, 200000),
        };
        length += result.text.length;
        if (length > 200000)
          throw new Error(`${label}.runs exceeds 200000 text characters`);
        for (const key of ["bold", "italic"]) {
          if (run[key] !== undefined)
            result[key] = boolean(run[key], `${label}.runs[${index}].${key}`);
        }
        return result;
      });
    }
    if (raw.assetId !== undefined) {
      node.assetId =
        raw.assetId === null
          ? null
          : identifier(raw.assetId, `${label}.assetId`);
      if (node.assetId !== null && !Object.hasOwn(project.assets, node.assetId))
        throw new Error(`${label} references missing asset "${node.assetId}"`);
    }
    if (raw.fit !== undefined) {
      if (!["cover", "contain", "fill"].includes(raw.fit))
        throw new Error(`${label}.fit is invalid`);
      node.fit = raw.fit;
    }
    if (raw.crop !== undefined) {
      record(raw.crop, `${label}.crop`);
      node.crop = {
        x: number(raw.crop.x, `${label}.crop.x`, -WORLD_LIMIT, WORLD_LIMIT),
        y: number(raw.crop.y, `${label}.crop.y`, -WORLD_LIMIT, WORLD_LIMIT),
        zoom: number(raw.crop.zoom, `${label}.crop.zoom`, 1e-6, 1e6),
      };
    }
    if (raw.path !== undefined) {
      node.path = text(raw.path, `${label}.path`, 500000);
      if (/[^MmZzLlHhVvCcSsQqTtAa\d\s.,+eE-]/.test(node.path))
        throw new Error(`${label}.path contains invalid SVG path characters`);
      const values =
        node.path.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
      if (
        values.some(
          (value) =>
            !Number.isFinite(Number(value)) ||
            Math.abs(Number(value)) > WORLD_LIMIT,
        )
      )
        throw new Error(`${label}.path has out-of-range coordinates`);
    }
    project.nodes.push(node);
  }
  const tree = hierarchy(project);
  for (const node of project.nodes) {
    if (node.parentId !== null && !tree.nodes.has(node.parentId))
      throw new Error(
        `Node "${node.id}" references missing parent "${node.parentId}"`,
      );
  }
  for (const node of project.nodes) {
    const matrix = tree.matrix(node.id);
    const scale = Math.hypot(matrix[0], matrix[1]);
    // Tiny relative slack only compensates for trig/multiplication roundoff at the limits.
    if (
      !Number.isFinite(scale) ||
      scale < 1e-12 * (1 - 1e-12) ||
      scale > 1e12 * (1 + 1e-12)
    ) {
      throw new Error(
        `Node "${node.id}" composed scale must be between 1e-12 and 1e12`,
      );
    }
    if (
      !matrix.every(Number.isFinite) ||
      Math.abs(matrix[4]) > WORLD_LIMIT ||
      Math.abs(matrix[5]) > WORLD_LIMIT
    ) {
      throw new Error(`Node "${node.id}" composed world position exceeds 1e12`);
    }
    // Rotated axis-aligned bounds can conceal an unrepresentably thin local edge.
    const smallestDimension = Math.min(scale * node.w, scale * node.h);
    const positionPrecision =
      Math.max(Math.abs(matrix[4]), Math.abs(matrix[5])) * Number.EPSILON * 8;
    if (smallestDimension === 0 || smallestDimension < positionPrecision) {
      throw new Error(
        `Node "${node.id}" is too small at this world position; move closer to origin or increase its dimensions`,
      );
    }
  }
  for (const raw of array(input.stops, "Project.stops", 2000)) {
    record(raw, "Stop");
    const id = claim(raw.id, "Stop.id");
    const label = `Stop "${id}"`;
    const easing = raw.easing === undefined ? "smooth" : raw.easing;
    if (!EASINGS.has(easing)) throw new Error(`${label} has unknown easing`);
    const stop = {
      id,
      title: text(
        raw.title === undefined ? "" : raw.title,
        `${label}.title`,
        1000,
      ),
      caption: text(
        raw.caption === undefined ? "" : raw.caption,
        `${label}.caption`,
        20000,
      ),
      targetId:
        raw.targetId == null
          ? null
          : identifier(raw.targetId, `${label}.targetId`),
      dwell: number(
        raw.dwell === undefined ? 0 : raw.dwell,
        `${label}.dwell`,
        0,
        86400,
      ),
      transition: number(
        raw.transition === undefined ? 0 : raw.transition,
        `${label}.transition`,
        0,
        86400,
      ),
      easing,
    };
    if (raw.frame !== undefined)
      stop.frame = cameraValue(raw.frame, `${label}.frame`);
    if (raw.choice !== undefined)
      stop.choice = boolean(raw.choice, `${label}.choice`);
    project.stops.push(stop);
  }
  const stopIds = new Set(project.stops.map((stop) => stop.id));
  for (const raw of array(input.links, "Project.links", 3000)) {
    record(raw, "Link");
    const id = claim(raw.id, "Link.id");
    const link = {
      id,
      sourceId: identifier(raw.sourceId, `Link "${id}".sourceId`),
      targetStopId: identifier(raw.targetStopId, `Link "${id}".targetStopId`),
      label: text(
        raw.label === undefined ? "" : raw.label,
        `Link "${id}".label`,
        1000,
      ),
    };
    if (!tree.nodes.has(link.sourceId))
      throw new Error(
        `Link "${id}" references missing source node "${link.sourceId}"`,
      );
    if (!stopIds.has(link.targetStopId))
      throw new Error(
        `Link "${id}" references missing stop "${link.targetStopId}"`,
      );
    project.links.push(link);
  }
  return project;
}
