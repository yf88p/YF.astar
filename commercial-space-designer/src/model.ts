import polygonClipping from "polygon-clipping";
import { CATALOG, MATERIALS } from "./catalog";

export type Vec2 = { x: number; y: number };
export type Vertex = Vec2 & { id: string };
export type Wall = {
  id: string;
  a: string;
  b: string;
  thickness: number;
  height: number;
  material: string;
};
export type Opening = {
  id: string;
  wallId: string;
  type: "door" | "window";
  offset: number;
  width: number;
  height: number;
  sill: number;
  angle: number;
};
export type Furniture = Vec2 & {
  id: string;
  catalogId: string;
  rotation: number;
  width?: number;
  depth?: number;
  height?: number;
  unitPrice?: number;
};
export type Light = Vec2 & {
  id: string;
  height: number;
  intensity: number;
  color: string;
};
export type SavedView = {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
};
export type Design = {
  id: string;
  name: string;
  vertices: Vertex[];
  walls: Wall[];
  openings: Opening[];
  furniture: Furniture[];
  lights: Light[];
  floorMaterial: string;
  wallMaterial: string;
  roomNames: Record<string, string>;
  lighting: { daylight: number; interior: number; exposure: number };
  rates: { floor: number; wall: number; door: number; window: number };
  savedViews: SavedView[];
};
export type Project = {
  version: 1;
  name: string;
  activeDesignId: string;
  designs: Design[];
};
export type Room = {
  id: string;
  vertexIds: string[];
  points: Vec2[];
  area: number;
  name: string;
};
export const uid = (prefix = "id") => {
  // getRandomValues is available on HTTP origins as well as secure contexts.
  const words = globalThis.crypto.getRandomValues(new Uint32Array(4));
  let id = `${prefix}-`;
  for (const word of words) id += word.toString(16).padStart(8, "0");
  return id;
};
export const clone = <T>(v: T): T => structuredClone(v);
export const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const wallPoints = (d: Design, w: Wall): [Vertex, Vertex] => [
  d.vertices.find((v) => v.id === w.a)!,
  d.vertices.find((v) => v.id === w.b)!,
];
export const wallLength = (d: Design, w: Wall) => distance(...wallPoints(d, w));
export const cross = (a: Vec2, b: Vec2, c: Vec2) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function projectPoint(p: Vec2, a: Vec2, b: Vec2) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = l2
    ? Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2,
        ),
      )
    : 0;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), t };
}
export const polygonArea = (p: Vec2[]) =>
  p.reduce((a, v, i) => {
    const n = p[(i + 1) % p.length];
    return a + v.x * n.y - n.x * v.y;
  }, 0) / 2;
export function pointInside(p: Vec2, poly: Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

// Split the graph virtually at T junctions, then walk each directed half-edge.
export function detectRooms(d: Design): Room[] {
  const neighbors = new Map<string, string[]>();
  const connect = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.get(a)!.includes(b)) neighbors.get(a)!.push(b);
  };
  for (const w of d.walls) {
    const [a, b] = wallPoints(d, w);
    if (!a || !b) continue;
    const vs = d.vertices
      .filter((v) => distance(v, projectPoint(v, a, b)) < 1e-6)
      .sort((u, v) => distance(a, u) - distance(a, v));
    for (let i = 0; i < vs.length - 1; i++) {
      connect(vs[i].id, vs[i + 1].id);
      connect(vs[i + 1].id, vs[i].id);
    }
  }
  const vertices = new Map(d.vertices.map((v) => [v.id, v]));
  for (const [id, ns] of neighbors) {
    const v = vertices.get(id)!;
    ns.sort(
      (a, b) =>
        Math.atan2(vertices.get(a)!.y - v.y, vertices.get(a)!.x - v.x) -
        Math.atan2(vertices.get(b)!.y - v.y, vertices.get(b)!.x - v.x),
    );
  }
  const visited = new Set<string>(),
    rooms: Room[] = [];
  for (const [a, ns] of neighbors)
    for (const b of ns) {
      if (visited.has(`${a}|${b}`)) continue;
      let u = a,
        v = b;
      const ids: string[] = [];
      let closed = false;
      for (let k = 0; k < d.walls.length * 8 + 8; k++) {
        const key = `${u}|${v}`;
        if (visited.has(key)) break;
        visited.add(key);
        ids.push(u);
        const next = neighbors.get(v)!;
        const n = next[(next.indexOf(u) - 1 + next.length) % next.length];
        u = v;
        v = n;
        if (u === a && v === b) {
          closed = true;
          break;
        }
      }
      // A dangling wall is walked out and back; it is not a room boundary.
      let simplified = true;
      while (simplified && ids.length > 2) {
        simplified = false;
        for (let i = 0; i < ids.length; i++)
          if (
            ids[(i - 1 + ids.length) % ids.length] === ids[(i + 1) % ids.length]
          ) {
            if (i === ids.length - 1) {
              ids.splice(i, 1);
              ids.splice(0, 1);
            } else ids.splice(i, 2);
            simplified = true;
            break;
          }
      }
      const points = ids.map((id) => vertices.get(id)!);
      const area = polygonArea(points);
      if (closed && area > 1e-5 && new Set(ids).size === ids.length) {
        const id = [...ids].sort().join(":");
        rooms.push({
          id,
          vertexIds: ids,
          points,
          area,
          name: d.roomNames[id] || `Space ${rooms.length + 1}`,
        });
      }
    }
  return rooms;
}
export function furnitureSize(f: Furniture) {
  const c = CATALOG.find((c) => c.id === f.catalogId)!;
  return {
    width: f.width ?? c.width,
    depth: f.depth ?? c.depth,
    height: f.height ?? c.height,
  };
}
export function footprint(f: Furniture, pad = 0): Vec2[] {
  const { width, depth } = furnitureSize(f),
    a = (f.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [
    [-width / 2 - pad, -depth / 2 - pad],
    [width / 2 + pad, -depth / 2 - pad],
    [width / 2 + pad, depth / 2 + pad],
    [-width / 2 - pad, depth / 2 + pad],
  ].map(([x, y]) => ({ x: f.x + x * c - y * s, y: f.y + x * s + y * c }));
}
export function wallFootprint(d: Design, w: Wall, pad = 0): Vec2[] {
  const [a, b] = wallPoints(d, w),
    l = distance(a, b),
    dx = ((b.y - a.y) / l) * (w.thickness / 2 + pad),
    dy = (-(b.x - a.x) / l) * (w.thickness / 2 + pad);
  return [
    { x: a.x + dx, y: a.y + dy },
    { x: b.x + dx, y: b.y + dy },
    { x: b.x - dx, y: b.y - dy },
    { x: a.x - dx, y: a.y - dy },
  ];
}
export function overlapDepth(a: Vec2[], b: Vec2[]) {
  let depth = Infinity;
  for (const p of [a, b])
    for (let i = 0; i < p.length; i++) {
      const v = p[i],
        n = p[(i + 1) % p.length],
        l = distance(v, n),
        ax = -(n.y - v.y) / l,
        ay = (n.x - v.x) / l;
      const aa = a.map((p) => p.x * ax + p.y * ay),
        bb = b.map((p) => p.x * ax + p.y * ay),
        o =
          Math.min(Math.max(...aa), Math.max(...bb)) -
          Math.max(Math.min(...aa), Math.min(...bb));
      if (o < 0) return o;
      depth = Math.min(depth, o);
    }
  return depth;
}
export function openingPose(d: Design, o: Opening) {
  const w = d.walls.find((w) => w.id === o.wallId)!,
    [a, b] = wallPoints(d, w),
    l = distance(a, b),
    ux = (b.x - a.x) / l,
    uy = (b.y - a.y) / l;
  return {
    x: a.x + ux * o.offset,
    y: a.y + uy * o.offset,
    ux,
    uy,
    rotation: Math.atan2(uy, ux),
  };
}
export function doorRegion(d: Design, o: Opening): Vec2[] {
  const p = openingPose(d, o);
  return [
    p,
    ...Array.from({ length: 17 }, (_, i) => {
      const a = p.rotation + ((Math.PI / 2) * i) / 16;
      return { x: p.x + Math.cos(a) * o.width, y: p.y + Math.sin(a) * o.width };
    }),
  ];
}
export type Warning = {
  ids: string[];
  kind: "overlap" | "clearance" | "contact";
  message: string;
};
export function collisionWarnings(d: Design): Warning[] {
  const out: Warning[] = [];
  const fs = d.furniture.filter((f) => furnitureSize(f).height > 0.06);
  const name = (f: Furniture) =>
    CATALOG.find((c) => c.id === f.catalogId)!.name;
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i],
      poly = footprint(f);
    for (const w of d.walls) {
      const n = overlapDepth(poly, wallFootprint(d, w, 0.005));
      if (n >= 0)
        out.push({
          ids: [f.id, w.id],
          kind: n < 0.015 ? "contact" : "overlap",
          message: `${name(f)} ${n < 0.015 ? "touches" : "intersects"} a wall`,
        });
    }
    for (let j = i + 1; j < fs.length; j++) {
      const g = fs[j],
        n = overlapDepth(poly, footprint(g));
      if (n >= -0.005)
        out.push({
          ids: [f.id, g.id],
          kind: n <= 0.005 ? "contact" : "overlap",
          message: `${name(f)} ${n <= 0.005 ? "touches" : "overlaps"} ${name(g)}`,
        });
    }
    for (const o of d.openings.filter((o) => o.type === "door"))
      if (overlapDepth(poly, doorRegion(d, o)) > 0)
        out.push({
          ids: [f.id, o.id],
          kind: "clearance",
          message: `${name(f)} obstructs door swing / clearance`,
        });
  }
  return out;
}
function properIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  return (
    cross(a, b, c) * cross(a, b, d) < -1e-10 &&
    cross(c, d, a) * cross(c, d, b) < -1e-10
  );
}
export function validateDesign(d: Design): string[] {
  const errors: string[] = [];
  const finite = (...v: number[]) => v.every(Number.isFinite);
  const all = [
    ...d.vertices,
    ...d.walls,
    ...d.openings,
    ...d.furniture,
    ...d.lights,
    ...d.savedViews,
  ];
  if (new Set(all.map((x) => x.id)).size !== all.length)
    errors.push("Entity IDs must be unique within a design.");
  if (
    d.vertices.length > 400 ||
    d.walls.length > 200 ||
    d.furniture.length > 500 ||
    d.lights.length > 40
  )
    errors.push("Limit: 200 walls, 400 vertices, 500 furnishings, 40 lights.");
  for (const v of d.vertices)
    if (!finite(v.x, v.y) || Math.abs(v.x) > 50 || Math.abs(v.y) > 50)
      errors.push("Coordinates must be finite and within -50 to 50 meters.");
  for (let i = 0; i < d.vertices.length; i++)
    for (let j = i + 1; j < d.vertices.length; j++)
      if (distance(d.vertices[i], d.vertices[j]) < 1e-7)
        errors.push("Coincident endpoints must share a single vertex ID.");
  if (
    d.vertices.length &&
    (Math.max(...d.vertices.map((v) => v.x)) -
      Math.min(...d.vertices.map((v) => v.x)) >
      50 ||
      Math.max(...d.vertices.map((v) => v.y)) -
        Math.min(...d.vertices.map((v) => v.y)) >
        50)
  )
    errors.push("Plan extents cannot exceed 50 by 50 meters.");
  for (const w of d.walls) {
    const [a, b] = wallPoints(d, w);
    if (!a || !b) {
      errors.push("Wall has a missing endpoint reference.");
      continue;
    }
    if (distance(a, b) < 0.1) errors.push("Wall must be at least 0.10 m long.");
    if (
      !finite(w.thickness, w.height) ||
      w.thickness < 0.06 ||
      w.thickness > 0.8 ||
      w.height < 0.3 ||
      w.height > 6
    )
      errors.push(
        "Walls require thickness 0.06-0.80 m and height 0.30-6.00 m.",
      );
    if (!MATERIALS.some((m) => m.id === w.material))
      errors.push("Unknown wall material.");
  }
  if (errors.length) return errors;
  for (let i = 0; i < d.walls.length; i++)
    for (let j = i + 1; j < d.walls.length; j++) {
      const [a, b] = wallPoints(d, d.walls[i]),
        [c, e] = wallPoints(d, d.walls[j]);
      if (properIntersection(a, b, c, e))
        errors.push(
          "Walls cross without a junction. End a wall at the intersection to create a T-junction.",
        );
      if (Math.abs(cross(a, b, c)) < 1e-7 && Math.abs(cross(a, b, e)) < 1e-7) {
        const l = distance(a, b),
          u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l },
          t = [
            (c.x - a.x) * u.x + (c.y - a.y) * u.y,
            (e.x - a.x) * u.x + (e.y - a.y) * u.y,
          ].sort((a, b) => a - b);
        if (Math.min(l, t[1]) - Math.max(0, t[0]) > 1e-6)
          errors.push(
            "Collinear walls overlap. Use a shared endpoint instead.",
          );
      }
    }
  const rooms = detectRooms(d);
  const parents = new Map<string, string>(),
    edges = new Set<string>();
  const root = (id: string): string => {
    const p = parents.get(id);
    if (!p) {
      parents.set(id, id);
      return id;
    }
    return p === id ? id : root(p);
  };
  for (const w of d.walls) {
    const [a, b] = wallPoints(d, w);
    const vs = d.vertices
      .filter((v) => distance(v, projectPoint(v, a, b)) < 1e-6)
      .sort((u, v) => distance(a, u) - distance(a, v));
    for (let i = 0; i < vs.length - 1; i++) {
      const u = vs[i].id,
        v = vs[i + 1].id;
      edges.add([u, v].sort().join("|"));
      parents.set(root(u), root(v));
    }
  }
  const components = new Set([...parents.keys()].map(root)).size;
  if (edges.size - parents.size + components > rooms.length)
    errors.push(
      "A room boundary is degenerate or contains an unsupported interior loop. Remove the inner loop or connect partitions to form simple rooms.",
    );
  for (let i = 0; i < rooms.length; i++)
    for (let j = 0; j < rooms.length; j++)
      if (
        i !== j &&
        rooms[i].points.some(
          (p) =>
            pointInside(p, rooms[j].points) &&
            rooms[j].points.every(
              (a, k) =>
                distance(
                  p,
                  projectPoint(
                    p,
                    a,
                    rooms[j].points[(k + 1) % rooms[j].points.length],
                  ),
                ) > 1e-6,
            ),
        )
      )
        errors.push(
          "Nested disconnected room loops are unsupported. Connect partitions to the outer boundary rather than drawing a room inside a room.",
        );
  for (const o of d.openings) {
    const w = d.walls.find((w) => w.id === o.wallId);
    if (!w) {
      errors.push("Opening has no host wall.");
      continue;
    }
    if (
      !["door", "window"].includes(o.type) ||
      !finite(o.offset, o.width, o.height, o.sill, o.angle) ||
      o.width < 0.3 ||
      o.height < 0.3 ||
      o.offset < 0.05 ||
      o.offset + o.width > wallLength(d, w) - 0.05 + 1e-8 ||
      o.sill < 0 ||
      o.sill + o.height > w.height ||
      o.angle < 0 ||
      o.angle > 110 ||
      (o.type === "door" && o.sill !== 0)
    )
      errors.push(
        "Opening does not fit its host. Keep 0.05 m at each end, valid elevation, and a 0-110 degree door angle. Move or resize the opening first.",
      );
    for (const other of d.openings)
      if (
        other.id !== o.id &&
        other.wallId === o.wallId &&
        Math.min(o.offset + o.width, other.offset + other.width) -
          Math.max(o.offset, other.offset) >
          -0.05
      )
        errors.push(
          "Openings overlap or have less than 0.05 m between them. Relocate an opening first.",
        );
  }
  for (const f of d.furniture) {
    if (!CATALOG.some((c) => c.id === f.catalogId)) {
      errors.push("Unknown catalog item.");
      continue;
    }
    const s = furnitureSize(f);
    if (
      !finite(f.x, f.y, f.rotation, s.width, s.depth, s.height) ||
      Math.abs(f.x) > 50 ||
      Math.abs(f.y) > 50 ||
      s.width < 0.1 ||
      s.depth < 0.1 ||
      s.height < 0.005 ||
      s.width > 10 ||
      s.depth > 10 ||
      s.height > 6
    )
      errors.push(
        "Furniture dimensions/coordinates are outside supported ranges.",
      );
    if (
      f.unitPrice !== undefined &&
      (!Number.isSafeInteger(f.unitPrice) ||
        f.unitPrice < 0 ||
        f.unitPrice > 100000000)
    )
      errors.push(
        "Item prices must be nonnegative integer cents below $1 million.",
      );
  }
  for (const l of d.lights)
    if (
      !finite(l.x, l.y, l.height, l.intensity) ||
      Math.abs(l.x) > 50 ||
      Math.abs(l.y) > 50 ||
      l.height < 0.3 ||
      l.height > 6 ||
      l.intensity < 0 ||
      l.intensity > 200 ||
      !/^#[0-9a-f]{6}$/i.test(l.color)
    )
      errors.push(
        "Light requires valid coordinates, height, intensity 0-200 and a hex color.",
      );
  if (
    !MATERIALS.some((m) => m.id === d.floorMaterial) ||
    !MATERIALS.some((m) => m.id === d.wallMaterial)
  )
    errors.push("Unknown finish material.");
  for (const v of Object.values(d.rates))
    if (!Number.isSafeInteger(v) || v < 0 || v > 100000000)
      errors.push("Rates must be nonnegative integer cents below $1 million.");
  if (
    !finite(d.lighting.daylight, d.lighting.interior, d.lighting.exposure) ||
    d.lighting.daylight < 0 ||
    d.lighting.daylight > 3 ||
    d.lighting.interior < 0 ||
    d.lighting.interior > 3 ||
    d.lighting.exposure < 0.1 ||
    d.lighting.exposure > 3
  )
    errors.push("Lighting values are outside their supported range.");
  for (const v of d.savedViews)
    if (
      v.position.length !== 3 ||
      v.target.length !== 3 ||
      !finite(...v.position, ...v.target) ||
      [...v.position, ...v.target].some((n) => Math.abs(n) > 200)
    )
      errors.push("Saved camera is invalid.");
  return [...new Set(errors)];
}
export function checked(d: Design) {
  const e = validateDesign(d);
  if (e.length) throw Error(e[0]);
  return d;
}
export function updateWallLength(design: Design, id: string, length: number) {
  const d = clone(design),
    w = d.walls.find((w) => w.id === id)!;
  const [a, b] = wallPoints(d, w),
    old = distance(a, b);
  b.x = a.x + ((b.x - a.x) / old) * length;
  b.y = a.y + ((b.y - a.y) / old) * length;
  return checked(d);
}
export function addWall(design: Design, start: Vec2, end: Vec2) {
  const d = clone(design);
  function endpoint(p: Vec2) {
    const existing = d.vertices.find((v) => distance(v, p) < 0.015);
    if (existing) return existing;
    const v = { ...p, id: uid("v") };
    d.vertices.push(v);
    for (const w of [...d.walls]) {
      const [a, b] = wallPoints(d, w),
        proj = projectPoint(p, a, b);
      if (distance(p, proj) < 0.015 && proj.t > 0 && proj.t < 1) {
        v.x = proj.x;
        v.y = proj.y;
        const cut = distance(a, v);
        if (
          d.openings.some(
            (o) =>
              o.wallId === w.id &&
              o.offset < cut + 0.05 &&
              o.offset + o.width > cut - 0.05,
          )
        )
          throw Error(
            "Junction would cut an opening. Move the door/window before connecting here.",
          );
        const next = { ...w, id: uid("wall"), a: v.id };
        w.b = v.id;
        d.walls.push(next);
        for (const o of d.openings)
          if (o.wallId === w.id && o.offset > cut) {
            o.wallId = next.id;
            o.offset -= cut;
          }
      }
    }
    return v;
  }
  const a = endpoint(start),
    b = endpoint(end);
  d.walls.push({
    id: uid("wall"),
    a: a.id,
    b: b.id,
    thickness: 0.18,
    height: 3,
    material: d.wallMaterial,
  });
  return checked(d);
}
export function deleteEntities(design: Design, ids: string[]) {
  const d = clone(design);
  d.walls = d.walls.filter((w) => !ids.includes(w.id));
  d.openings = d.openings.filter(
    (o) => !ids.includes(o.id) && d.walls.some((w) => w.id === o.wallId),
  );
  d.furniture = d.furniture.filter((f) => !ids.includes(f.id));
  d.lights = d.lights.filter((l) => !ids.includes(l.id));
  d.vertices = d.vertices.filter((v) =>
    d.walls.some((w) => w.a === v.id || w.b === v.id),
  );
  return d;
}
export function duplicateEntities(design: Design, ids: string[]) {
  const d = clone(design);
  for (const f of design.furniture.filter((f) => ids.includes(f.id)))
    d.furniture.push({ ...f, id: uid("f"), x: f.x + 0.5, y: f.y + 0.5 });
  for (const l of design.lights.filter((l) => ids.includes(l.id)))
    d.lights.push({ ...l, id: uid("light"), x: l.x + 0.5, y: l.y + 0.5 });
  for (const o of design.openings.filter(
    (o) => ids.includes(o.id) && !ids.includes(o.wallId),
  ))
    d.openings.push({
      ...o,
      id: uid("opening"),
      offset: o.offset + o.width + 0.1,
    });
  const map = new Map<string, string>();
  for (const w of design.walls.filter((w) => ids.includes(w.id))) {
    for (const v of wallPoints(design, w))
      if (!map.has(v.id)) {
        const id = uid("v");
        map.set(v.id, id);
        d.vertices.push({ ...v, id, x: v.x + 0.5, y: v.y + 0.5 });
      }
    const id = uid("wall");
    d.walls.push({ ...w, id, a: map.get(w.a)!, b: map.get(w.b)! });
    for (const o of design.openings.filter((o) => o.wallId === w.id))
      d.openings.push({ ...o, id: uid("opening"), wallId: id });
  }
  return checked(d);
}
export function getWallSegments(d: Design, w: Wall) {
  const l = wallLength(d, w),
    ops = d.openings
      .filter((o) => o.wallId === w.id)
      .sort((a, b) => a.offset - b.offset),
    out: { start: number; end: number; bottom: number; top: number }[] = [];
  let x = 0;
  for (const o of ops) {
    if (o.offset > x)
      out.push({ start: x, end: o.offset, bottom: 0, top: w.height });
    if (o.sill > 0)
      out.push({
        start: o.offset,
        end: o.offset + o.width,
        bottom: 0,
        top: o.sill,
      });
    if (o.sill + o.height < w.height)
      out.push({
        start: o.offset,
        end: o.offset + o.width,
        bottom: o.sill + o.height,
        top: w.height,
      });
    x = o.offset + o.width;
  }
  if (x < l) out.push({ start: x, end: l, bottom: 0, top: w.height });
  return out;
}
// Union horizontal wall strips into non-overlapping solids. Openings carve the
// complete thickness; unioning each height band also resolves corners and T joins.
export function wallLayers(d: Design, cutaway = false) {
  const front = Math.max(0, ...d.vertices.map((v) => v.y)),
    right = Math.max(0, ...d.vertices.map((v) => v.x));
  const slabs = d.walls
    .flatMap((w) =>
      getWallSegments(d, w).map((s) => ({
        ...s,
        w,
        top:
          cutaway &&
          (wallPoints(d, w).every((p) => Math.abs(p.y - front) < 0.01) ||
            wallPoints(d, w).every((p) => Math.abs(p.x - right) < 0.01))
            ? Math.min(s.top, 0.16)
            : s.top,
      })),
    )
    .filter((s) => s.top > s.bottom);
  const levels = [...new Set(slabs.flatMap((s) => [s.bottom, s.top]))].sort(
    (a, b) => a - b,
  );
  const out: {
    bottom: number;
    top: number;
    polygons: polygonClipping.MultiPolygon;
  }[] = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const bottom = levels[i],
      top = levels[i + 1],
      mid = (bottom + top) / 2;
    const rings = slabs
      .filter((s) => s.bottom < mid && s.top > mid)
      .map((s) => {
        const [a, b] = wallPoints(d, s.w),
          len = distance(a, b),
          ux = (b.x - a.x) / len,
          uy = (b.y - a.y) / len,
          t = s.w.thickness / 2;
        const p = (n: number, k: number): [number, number] => [
          a.x + ux * n - uy * k,
          a.y + uy * n + ux * k,
        ];
        return [
          [
            p(s.start, -t),
            p(s.end, -t),
            p(s.end, t),
            p(s.start, t),
            p(s.start, -t),
          ],
        ] as polygonClipping.Polygon;
      });
    if (rings.length)
      out.push({
        bottom,
        top,
        polygons: polygonClipping.union(rings[0], ...rings.slice(1)),
      });
  }
  return out;
}
function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2) {
  return distance(p, projectPoint(p, a, b));
}
export function canOccupy(d: Design, p: Vec2, radius = 0.18) {
  for (const w of d.walls) {
    const [a, b] = wallPoints(d, w),
      l = distance(a, b),
      q = projectPoint(p, a, b),
      t = q.t * l;
    if (distance(p, q) >= w.thickness / 2 + radius) continue;
    const portal = d.openings.find(
      (o) =>
        o.wallId === w.id &&
        o.type === "door" &&
        o.sill === 0 &&
        o.height > 1.9 &&
        o.angle >= 55 &&
        t > o.offset + radius &&
        t < o.offset + o.width - radius,
    );
    if (!portal) return false;
  }
  for (const o of d.openings.filter((o) => o.type === "door")) {
    const a = openingPose(d, o),
      angle = a.rotation + (o.angle * Math.PI) / 180,
      b = {
        x: a.x + Math.cos(angle) * o.width,
        y: a.y + Math.sin(angle) * o.width,
      };
    if (pointSegmentDistance(p, a, b) < radius + 0.022) return false;
  }
  for (const f of d.furniture) {
    const s = furnitureSize(f);
    if (s.height < 0.06) continue;
    const a = (-f.rotation * Math.PI) / 180,
      dx = p.x - f.x,
      dy = p.y - f.y,
      x = dx * Math.cos(a) - dy * Math.sin(a),
      y = dx * Math.sin(a) + dy * Math.cos(a);
    if (
      Math.hypot(
        Math.max(0, Math.abs(x) - s.width / 2),
        Math.max(0, Math.abs(y) - s.depth / 2),
      ) < radius
    )
      return false;
  }
  return true;
}
export function canWalk(d: Design, from: Vec2, to: Vec2, radius = 0.18) {
  const n = Math.max(1, Math.ceil(distance(from, to) / 0.05));
  for (let i = 1; i <= n; i++)
    if (
      !canOccupy(
        d,
        {
          x: from.x + ((to.x - from.x) * i) / n,
          y: from.y + ((to.y - from.y) * i) / n,
        },
        radius,
      )
    )
      return false;
  return true;
}
export function quantities(d: Design) {
  const rooms = detectRooms(d),
    floorArea = rooms.reduce((s, r) => s + r.area, 0),
    wallArea =
      d.walls.reduce((s, w) => s + wallLength(d, w) * w.height * 2, 0) -
      d.openings.reduce((s, o) => s + o.width * o.height * 2, 0);
  const schedule: {
    key: string;
    catalogId: string;
    name: string;
    quantity: number;
    width: number;
    depth: number;
    height: number;
    unitPrice: number;
    total: number;
  }[] = [];
  for (const f of d.furniture) {
    const c = CATALOG.find((c) => c.id === f.catalogId)!,
      size = furnitureSize(f),
      unitPrice = f.unitPrice ?? c.price,
      key = JSON.stringify([c.id, size, unitPrice]);
    const row = schedule.find((r) => r.key === key);
    if (row) {
      row.quantity++;
      row.total += unitPrice;
    } else
      schedule.push({
        key,
        catalogId: c.id,
        name: c.name,
        quantity: 1,
        ...size,
        unitPrice,
        total: unitPrice,
      });
  }
  const doors = d.openings.filter((o) => o.type === "door").length,
    windows = d.openings.length - doors,
    furniture = schedule.reduce((s, r) => s + r.total, 0),
    floor = Math.round(floorArea * d.rates.floor),
    wall = Math.round(wallArea * d.rates.wall),
    openings = doors * d.rates.door + windows * d.rates.window;
  return {
    floorArea,
    wallArea,
    doors,
    windows,
    furnitureCount: d.furniture.length,
    furniture,
    floor,
    wall,
    openings,
    total: furniture + floor + wall + openings,
    schedule,
  };
}
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
export function exportSVG(d: Design) {
  const vs = d.vertices.length
      ? d.vertices
      : [
          { x: 0, y: 0 },
          { x: 10, y: 8 },
        ],
    minX = Math.min(...vs.map((v) => v.x)) - 1,
    minY = Math.min(...vs.map((v) => v.y)) - 1,
    width = Math.max(...vs.map((v) => v.x)) - minX + 1,
    height = Math.max(...vs.map((v) => v.y)) - minY + 1;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width * 100}mm" height="${height * 100}mm"><title>${esc(d.name)} - centerline dimensions in meters, 1:10 at native size</title><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#faf9f5"/>` +
    detectRooms(d)
      .map(
        (r) =>
          `<polygon points="${r.points.map((p) => `${p.x},${p.y}`).join(" ")}" fill="#eeece2"/><text x="${r.points.reduce((s, p) => s + p.x, 0) / r.points.length}" y="${r.points.reduce((s, p) => s + p.y, 0) / r.points.length}" font-size=".18" text-anchor="middle">${esc(r.name)} ${r.area.toFixed(3)} m²</text>`,
      )
      .join("") +
    d.walls
      .map((w) => {
        const [a, b] = wallPoints(d, w);
        return `<line data-id="${w.id}" data-length-m="${wallLength(d, w)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#4c5548" stroke-width="${w.thickness}"/><text x="${(a.x + b.x) / 2 + 0.15}" y="${(a.y + b.y) / 2 - 0.2}" font-size=".17">${wallLength(d, w).toFixed(3)} m</text>`;
      })
      .join("") +
    d.openings
      .map((o) => {
        const p = openingPose(d, o),
          rotation = (p.rotation * 180) / Math.PI;
        return `<g data-id="${o.id}" transform="translate(${p.x} ${p.y}) rotate(${rotation})"><rect x="0" y="-.12" width="${o.width}" height=".24" fill="#faf9f5" stroke="#779394" stroke-width=".025"/>${o.type === "door" ? `<path d="M0 0 L0 ${o.width} M${o.width} 0 A${o.width} ${o.width} 0 0 1 0 ${o.width}" fill="none" stroke="#799079" stroke-width=".025"/>` : `<line x1="0" y1="0" x2="${o.width}" y2="0" stroke="#779394" stroke-width=".04"/>`}</g>`;
      })
      .join("") +
    d.furniture
      .map(
        (f) =>
          `<polygon data-id="${f.id}" points="${footprint(f)
            .map((p) => `${p.x},${p.y}`)
            .join(
              " ",
            )}" fill="${CATALOG.find((c) => c.id === f.catalogId)!.color}" stroke="#66695b" stroke-width=".02"/>`,
      )
      .join("") +
    "</svg>"
  );
}
export function exportCSV(d: Design) {
  const q = quantities(d),
    cell = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  const rows: unknown[][] = [
    ["FORMA / " + d.name, "Currency USD; sample prices, not vendor quotes"],
    [
      "Item",
      "Quantity",
      "Width m",
      "Depth m",
      "Height m",
      "Unit USD",
      "Extended USD",
    ],
    ...q.schedule.map((r) => [
      r.name,
      r.quantity,
      r.width,
      r.depth,
      r.height,
      (r.unitPrice / 100).toFixed(2),
      (r.total / 100).toFixed(2),
    ]),
    [],
    ["Finish / opening", "Quantity", "Unit", "Rate USD", "Extended USD"],
    [
      "Floor finish (centerline)",
      q.floorArea,
      "m2",
      d.rates.floor / 100,
      q.floor / 100,
    ],
    [
      "Wall finish (both faces, net openings)",
      q.wallArea,
      "m2",
      d.rates.wall / 100,
      q.wall / 100,
    ],
    [
      "Doors",
      q.doors,
      "each",
      d.rates.door / 100,
      (q.doors * d.rates.door) / 100,
    ],
    [
      "Windows",
      q.windows,
      "each",
      d.rates.window / 100,
      (q.windows * d.rates.window) / 100,
    ],
    [],
    ["Furniture subtotal", q.furniture / 100],
    ["TOTAL USD", (q.total / 100).toFixed(2)],
    [
      "Policy",
      "Areas at full precision; round each category to nearest cent, half-up. Both centerline wall faces; no end caps / junction correction. Lights, labor, services and tax excluded.",
    ],
  ];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
export function validateProject(value: unknown): Project {
  const p = value as Project;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.name !== "string" ||
    !Array.isArray(p.designs) ||
    p.designs.length < 1 ||
    p.designs.length > 12
  )
    throw Error(
      "Invalid project or unsupported version. Expected Forma version 1 with 1-12 alternatives.",
    );
  const assert = (ok: unknown, msg: string) => {
    if (!ok) throw Error(msg);
  };
  assert(
    new Set(p.designs.map((d) => d.id)).size === p.designs.length,
    "Alternative IDs must be unique.",
  );
  assert(
    p.designs.some((d) => d.id === p.activeDesignId),
    "Active alternative is missing.",
  );
  for (const d of p.designs) {
    assert(
      typeof d.id === "string" &&
        typeof d.name === "string" &&
        d.name.length > 0,
      "Alternative name/ID missing.",
    );
    for (const k of [
      "vertices",
      "walls",
      "openings",
      "furniture",
      "lights",
      "savedViews",
    ] as const)
      assert(Array.isArray(d[k]), `Missing ${k} collection.`);
    assert(
      d.roomNames &&
        typeof d.roomNames === "object" &&
        !Array.isArray(d.roomNames) &&
        Object.values(d.roomNames).every((v) => typeof v === "string"),
      "Invalid room labels.",
    );
    assert(
      d.rates &&
        ["floor", "wall", "door", "window"].every(
          (k) => typeof d.rates[k as keyof Design["rates"]] === "number",
        ),
      "Missing cost rates.",
    );
    assert(d.lighting, "Missing lighting.");
    for (const e of [
      ...d.vertices,
      ...d.walls,
      ...d.openings,
      ...d.furniture,
      ...d.lights,
      ...d.savedViews,
    ])
      assert(
        e && typeof e.id === "string" && /^[A-Za-z0-9:_-]+$/.test(e.id),
        "Invalid entity ID. Use letters, numbers, colon, underscore or hyphen.",
      );
    for (const v of d.savedViews)
      assert(
        typeof v.name === "string" &&
          Array.isArray(v.position) &&
          Array.isArray(v.target),
        "Invalid saved camera.",
      );
    checked(d);
  }
  return clone(p);
}
export const exportProject = (p: Project) => JSON.stringify(p, null, 2);
export function importProject(text: string) {
  if (text.length > 10000000) throw Error("Project exceeds 10 MB limit.");
  try {
    return validateProject(JSON.parse(text));
  } catch (e) {
    throw Error(e instanceof Error ? e.message : "Malformed project.");
  }
}
export type History = { past: Project[]; present: Project; future: Project[] };
export function historyCommit(h: History, p: Project): History {
  return {
    past: [...h.past.slice(-79), h.present],
    present: clone(p),
    future: [],
  };
}
export function historyUndo(h: History): History {
  return h.past.length
    ? {
        past: h.past.slice(0, -1),
        present: h.past.at(-1)!,
        future: [h.present, ...h.future],
      }
    : h;
}
export function historyRedo(h: History): History {
  return h.future.length
    ? {
        past: [...h.past, h.present],
        present: h.future[0],
        future: h.future.slice(1),
      }
    : h;
}
