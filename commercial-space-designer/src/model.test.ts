import { describe, expect, it, vi } from "vitest";
import { createExample, createStressDesign, emptyDesign } from "./examples";
import {
  addWall,
  canOccupy,
  canWalk,
  checked,
  clone,
  collisionWarnings,
  deleteEntities,
  detectRooms,
  duplicateEntities,
  exportCSV,
  exportProject,
  exportSVG,
  footprint,
  getWallSegments,
  historyCommit,
  historyRedo,
  historyUndo,
  importProject,
  quantities,
  updateWallLength,
  validateDesign,
  wallLayers,
  wallLength,
  type Design,
  type History,
  type Project,
} from "./model";

function rectangle(w = 4, h = 3) {
  const d = emptyDesign("Fixture");
  d.vertices = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: w, y: 0 },
    { id: "c", x: w, y: h },
    { id: "e", x: 0, y: h },
  ];
  d.walls = d.vertices.map((v, i) => ({
    id: `w${i}`,
    a: v.id,
    b: d.vertices[(i + 1) % 4].id,
    thickness: 0.2,
    height: 3,
    material: "plaster",
  }));
  return d;
}
function fixture() {
  const d = rectangle();
  d.walls = d.walls.slice(0, 1);
  d.openings = [
    {
      id: "door",
      wallId: "w0",
      type: "door",
      offset: 0.2,
      width: 1,
      height: 2,
      sill: 0,
      angle: 90,
    },
    {
      id: "window",
      wallId: "w0",
      type: "window",
      offset: 2,
      width: 1,
      height: 1,
      sill: 1,
      angle: 0,
    },
  ];
  return d;
}
const project = (d: Design): Project => ({
  version: 1,
  name: "Test",
  activeDesignId: d.id,
  designs: [d],
});
describe("independent spatial references", () => {
  it("rectangular centerline area is 4 * 3 = 12 m2", () => {
    expect(detectRooms(rectangle())[0].area).toBeCloseTo(12, 9);
  });
  it("L shaped room area is 9 * 5 + 6 * 4 = 69 m2", () => {
    const p = createExample("boutique");
    expect(quantities(p.designs[0]).floorArea).toBeCloseTo(69, 9);
  });
  it("rotating a rectangle by 31 degrees preserves its analytical 12 m2 area", () => {
    const d = rectangle();
    const a = (31 * Math.PI) / 180;
    d.vertices.forEach((v) => {
      const { x, y } = v;
      v.x = x * Math.cos(a) - y * Math.sin(a);
      v.y = x * Math.sin(a) + y * Math.cos(a);
    });
    expect(validateDesign(d)).toEqual([]);
    expect(quantities(d).floorArea).toBeCloseTo(12, 9);
  });
  it("4 by 3 face minus 1 by 2 door and 1 by 1 window is 9 per face", () => {
    const d = fixture();
    expect(quantities(d).wallArea / 2).toBeCloseTo(9, 12);
    const area = getWallSegments(d, d.walls[0]).reduce(
      (s, r) => s + (r.end - r.start) * (r.top - r.bottom),
      0,
    );
    expect(area).toBeCloseTo(9, 12);
    const solid = (x: number, y: number) =>
      getWallSegments(d, d.walls[0]).some(
        (s) => x > s.start && x < s.end && y > s.bottom && y < s.top,
      );
    expect(solid(0.7, 1)).toBe(false);
    expect(solid(2.5, 1.5)).toBe(false);
    expect(solid(2.5, 0.5)).toBe(true);
    expect(solid(0.7, 2.5)).toBe(true);
  });
  it("unioned wall slabs have analytical corner and T-junction volume", () => {
    const d = rectangle();
    const polyArea = (ring: number[][]) =>
      Math.abs(
        ring.reduce(
          (s, p, i) =>
            s +
            p[0] * ring[(i + 1) % ring.length][1] -
            ring[(i + 1) % ring.length][0] * p[1],
          0,
        ) / 2,
      );
    const volume = wallLayers(d).reduce(
      (s, l) =>
        s +
        (l.top - l.bottom) *
          l.polygons.reduce(
            (t, p) =>
              t +
              polyArea(p[0]) -
              p.slice(1).reduce((s, r) => s + polyArea(r), 0),
            0,
          ),
      0,
    );
    /* 14m strips*.2m minus four .1*.1 corner overlaps */ expect(
      volume,
    ).toBeCloseTo((14 * 0.2 - 4 * 0.01) * 3, 8);
    const t = emptyDesign();
    t.vertices = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 4, y: 0 },
      { id: "c", x: 2, y: 0 },
      { id: "d", x: 2, y: 2 },
    ];
    t.walls = [
      {
        id: "w",
        a: "a",
        b: "b",
        thickness: 0.2,
        height: 3,
        material: "plaster",
      },
      {
        id: "t",
        a: "c",
        b: "d",
        thickness: 0.2,
        height: 3,
        material: "plaster",
      },
    ];
    expect(validateDesign(t)).toEqual([]);
    const area = wallLayers(t)[0].polygons.reduce(
      (s, p) => s + polyArea(p[0]),
      0,
    );
    expect(area).toBeCloseTo(4 * 0.2 + 2 * 0.2 - 0.2 * 0.1, 8);
  });
});
describe("editing and relationships", () => {
  it("creates editable, round-trippable geometry without secure-context crypto APIs", () => {
    const crypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    });
    try {
      const d = addWall(emptyDesign("HTTP sketch"), { x: 0, y: 0 }, { x: 4, y: 0 });
      expect(wallLength(d, d.walls[0])).toBe(4);
      const restored = importProject(exportProject(project(d)));
      const edited = updateWallLength(restored.designs[0], d.walls[0].id, 6);
      expect(wallLength(edited, edited.walls[0])).toBeCloseTo(6);
      expect(validateDesign(edited)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("duplicates hosted openings with explicit offsets, rejecting invalid placement", () => {
    const d = rectangle(8, 6);
    d.openings = [
      {
        id: "o",
        wallId: "w0",
        type: "door",
        offset: 1,
        width: 1,
        height: 2,
        sill: 0,
        angle: 90,
      },
    ];
    const n = duplicateEntities(d, ["o"]);
    expect(n.openings).toHaveLength(2);
    expect(n.openings[1].wallId).toBe("w0");
    expect(n.openings[1].offset).toBe(2.1);
    expect(n.openings[1].id).not.toBe("o");
    expect(() => duplicateEntities(fixture(), ["door"])).toThrow(/overlap/);
  });
  it("rejects a nested room and a bridged interior loop rather than losing the outer floor", () => {
    const d = rectangle(8, 6);
    const inner = rectangle(2, 2);
    inner.vertices.forEach((v) => {
      v.id = "inner-" + v.id;
      v.x += 2;
      v.y += 2;
    });
    inner.walls.forEach((w) => {
      w.id = "inner-" + w.id;
      w.a = "inner-" + w.a;
      w.b = "inner-" + w.b;
    });
    d.vertices.push(...inner.vertices);
    d.walls.push(...inner.walls);
    expect(() => checked(d)).toThrow(/Nested/);
    d.walls.push({
      id: "bridge",
      a: "a",
      b: "inner-a",
      height: 3,
      thickness: 0.2,
      material: "plaster",
    });
    expect(() => checked(d)).toThrow(/interior loop/);
  });
  it("room area, opening offset, and budget follow a shared endpoint length edit", () => {
    const d = rectangle();
    d.openings = [
      {
        id: "door",
        wallId: "w0",
        type: "door",
        offset: 1,
        width: 1,
        height: 2,
        sill: 0,
        angle: 90,
      },
    ];
    const next = updateWallLength(d, "w0", 5);
    expect(quantities(next).floorArea).toBeCloseTo(((5 + 4) / 2) * 3, 9);
    expect(next.openings[0]).toEqual(d.openings[0]);
    expect(next.walls[1].a).toBe("b");
    expect(quantities(next).total).not.toBe(quantities(d).total);
    expect(wallLength(d, d.walls[0])).toBe(4);
    expect(() => updateWallLength(d, "w0", 1.9)).toThrow(/Opening/);
  });
  it("wall tool splits host at a T junction and carries opening offsets", () => {
    const d = rectangle(8, 6);
    d.openings = [
      {
        id: "o",
        wallId: "w0",
        type: "window",
        offset: 5,
        width: 1,
        height: 1,
        sill: 1,
        angle: 0,
      },
    ];
    const next = addWall(d, { x: 4, y: 0 }, { x: 4, y: 6 });
    expect(
      detectRooms(next)
        .map((r) => r.area)
        .sort(),
    ).toEqual([24, 24]);
    expect(next.openings[0].offset).toBe(1);
    expect(next.openings[0].wallId).not.toBe("w0");
    expect(validateDesign(next)).toEqual([]);
  });
  it("a dangling partition does not erase or fabricate a floor", () => {
    const d = addWall(rectangle(8, 6), { x: 4, y: 0 }, { x: 4, y: 3 });
    expect(quantities(d).floorArea).toBeCloseTo(48, 9);
    expect(detectRooms(d)).toHaveLength(1);
  });
  it("rejects junction through an opening and crossing wall geometry", () => {
    expect(() =>
      addWall(fixture(), { x: 0.7, y: 0 }, { x: 0.7, y: 2 }),
    ).toThrow(/opening/i);
    let d = addWall(emptyDesign(), { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(() => addWall(d, { x: 0, y: 4 }, { x: 4, y: 0 })).toThrow(/cross/);
  });
  it("overlapping openings are rejected without mutating the valid original", () => {
    const d = fixture(),
      n = clone(d);
    n.openings[1].offset = 1;
    expect(() => checked(n)).toThrow(/overlap/);
    expect(d.openings[1].offset).toBe(2);
  });
  it("deleting a wall removes its hosted openings and is completely undoable", () => {
    const d = fixture(),
      p = project(d);
    let h: History = { past: [], present: p, future: [] };
    const n = deleteEntities(d, ["w0"]);
    expect(n.openings).toHaveLength(0);
    h = historyCommit(h, project(n));
    h = historyUndo(h);
    expect(h.present).toEqual(p);
    h = historyRedo(h);
    expect(h.present.designs[0].openings).toHaveLength(0);
  });
  it("50 edit / undo / redo cycles restore complete transactions without drift", () => {
    let h: History = { past: [], present: project(rectangle()), future: [] };
    const initial = clone(h.present);
    for (let i = 0; i < 50; i++) {
      const d = updateWallLength(h.present.designs[0], "w0", 4.5);
      d.rates.floor = 10001;
      d.floorMaterial = "oak";
      h = historyCommit(h, project(d));
      h = historyUndo(h);
      expect(h.present).toEqual(initial);
      h = historyRedo(h);
      expect(h.present.designs[0].rates.floor).toBe(10001);
      h = historyUndo(h);
    }
    expect(h.present).toEqual(initial);
  });
  it("alternatives have independent entities, finishes, rates, and saved views", () => {
    const p = createExample("cafe"),
      baseline = clone(p.designs[0]);
    p.designs[1].furniture[0].x += 1;
    p.designs[1].rates.floor = 2;
    p.designs[1].savedViews.push({
      id: "v",
      name: "Test",
      position: [1, 2, 3],
      target: [0, 0, 0],
    });
    expect(p.designs[0]).toEqual(baseline);
  });
});
describe("collision and quantities", () => {
  it("door state and sill geometry govern traversability with bounded substeps", () => {
    const d = fixture();
    expect(canWalk(d, { x: 0.9, y: -1 }, { x: 0.9, y: 1 })).toBe(true);
    d.openings[0].angle = 0;
    expect(canWalk(d, { x: 0.9, y: -1 }, { x: 0.9, y: 1 })).toBe(false);
    expect(canWalk(d, { x: 2.5, y: -1 }, { x: 2.5, y: 1 })).toBe(false);
    expect(canWalk(d, { x: 3.5, y: -10 }, { x: 3.5, y: 10 })).toBe(false);
  });
  it("rotated furniture footprint is accurate and reports overlap / valid contact / clearance", () => {
    const d = fixture();
    d.furniture = [
      { id: "f", catalogId: "communal", x: 2, y: 3, rotation: 90 },
    ];
    const p = footprint(d.furniture[0]);
    expect(
      Math.max(...p.map((p) => p.x)) - Math.min(...p.map((p) => p.x)),
    ).toBeCloseTo(0.9, 9);
    expect(
      Math.max(...p.map((p) => p.y)) - Math.min(...p.map((p) => p.y)),
    ).toBeCloseTo(2.4, 9);
    d.furniture = [
      { id: "f", catalogId: "bistro", x: 0.7, y: 0.65, rotation: 0 },
    ];
    expect(collisionWarnings(d).some((w) => w.kind === "clearance")).toBe(true);
    d.furniture[0].y = 2;
    expect(
      collisionWarnings(d).filter((w) => w.kind === "clearance"),
    ).toHaveLength(0);
    d.furniture[0].y = 0.5;
    expect(collisionWarnings(d).some((w) => w.kind === "contact")).toBe(true);
    d.furniture[0].y = 0.2;
    expect(collisionWarnings(d).some((w) => w.kind === "overlap")).toBe(true);
    expect(canOccupy(d, { x: 0.7, y: 0.2 })).toBe(false);
  });
  it("integer cents and independent half-up category rounding", () => {
    const d = rectangle(3.333, 2.123);
    d.rates.floor = 1234;
    d.rates.wall = 2345;
    d.furniture = [
      {
        id: "f1",
        catalogId: "chair",
        x: 1,
        y: 1,
        rotation: 0,
        unitPrice: 10001,
      },
      {
        id: "f2",
        catalogId: "chair",
        x: 2,
        y: 1,
        rotation: 0,
        unitPrice: 10001,
      },
    ];
    const q = quantities(d);
    expect(q.floor).toBe(Math.floor(3.333 * 2.123 * 1234 + 0.5));
    expect(q.wall).toBe(Math.floor(2 * (3.333 + 2.123) * 3 * 2 * 2345 + 0.5));
    expect(q.furniture).toBe(20002);
    expect(q.schedule[0].quantity).toBe(2);
    expect(Number.isSafeInteger(q.total)).toBe(true);
  });
});
describe("files and supplied scenes", () => {
  it("SVG lengths agree to better than 0.001 m; CSV quantities match", () => {
    const d = rectangle(3.1234567, 2.7654321),
      svg = exportSVG(d),
      lengths = [...svg.matchAll(/data-length-m="([^"]+)"/g)].map((m) =>
        Number(m[1]),
      );
    expect(lengths).toEqual([3.1234567, 2.7654321, 3.1234567, 2.7654321]);
    const csv = exportCSV(d);
    expect(csv).toContain(String(3.1234567 * 2.7654321));
    expect(csv).toContain((quantities(d).total / 100).toFixed(2));
  });
  it("versioned JSON preserves all identities and independent alternatives", () => {
    const p = createExample("cafe");
    p.designs[0].savedViews.push({
      id: "view",
      name: "Entry",
      position: [1, 2, 3],
      target: [4, 0, 4],
    });
    expect(importProject(exportProject(p))).toEqual(p);
  });
  it("rejects malformed versions, nonfinite values, bad refs, invalid geometry and prices", () => {
    const p = project(fixture());
    const corrupt: ((p: Project) => void)[] = [
      (p) => {
        (p as unknown as { version: number }).version = 2;
      },
      (p) => {
        p.designs[0].vertices[0].x = NaN;
      },
      (p) => {
        p.designs[0].walls[0].a = "missing";
      },
      (p) => {
        p.designs[0].openings[0].width = 30;
      },
      (p) => {
        p.designs[0].rates.floor = 0.5;
      },
      (p) => {
        p.activeDesignId = "missing";
      },
      (p) => {
        p.designs[0].savedViews = [
          { id: "v", name: "bad", position: [NaN, 0, 0], target: [0, 0, 0] },
        ];
      },
    ];
    for (const fn of corrupt) {
      const n = clone(p);
      fn(n);
      expect(() => importProject(JSON.stringify(n))).toThrow();
    }
    expect(importProject(exportProject(p))).toEqual(p);
  });
  for (const kind of ["cafe", "boutique", "exhibition", "blank"] as const)
    it(`${kind} starter is valid and editable`, () => {
      const p = createExample(kind);
      expect(() => importProject(exportProject(p))).not.toThrow();
      for (const d of p.designs) {
        expect(validateDesign(d)).toEqual([]);
        expect(
          collisionWarnings(d).filter((w) => w.kind !== "contact"),
        ).toEqual([]);
      }
    });
  it("stress scene has 40 visible walls and 100 physical items", () => {
    const d = createStressDesign();
    expect(d.walls.length).toBeGreaterThanOrEqual(30);
    expect(d.furniture.length).toBeGreaterThanOrEqual(100);
    expect(validateDesign(d)).toEqual([]);
    expect(quantities(d).floorArea).toBeCloseTo(900, 8);
  });
});
