import { clone, detectRooms, uid, type Design, type Project } from "./model";

export function emptyDesign(name = "Concept 01"): Design {
  return {
    id: uid("design"),
    name,
    vertices: [],
    walls: [],
    openings: [],
    furniture: [],
    lights: [],
    floorMaterial: "terrazzo",
    wallMaterial: "plaster",
    roomNames: {},
    lighting: { daylight: 1.1, interior: 1, exposure: 1.05 },
    rates: { floor: 7800, wall: 2400, door: 65000, window: 48000 },
    savedViews: [],
  };
}
function boundary(d: Design, points: number[][]) {
  d.vertices = points.map(([x, y], i) => ({ id: `v-${i}`, x, y }));
  d.walls = d.vertices.map((v, i) => ({
    id: `wall-${i}`,
    a: v.id,
    b: d.vertices[(i + 1) % points.length].id,
    thickness: 0.18,
    height: 3,
    material: d.wallMaterial,
  }));
}
function add(d: Design, catalogId: string, x: number, y: number, rotation = 0) {
  d.furniture.push({ id: uid(catalogId), catalogId, x, y, rotation });
}
export function createExample(
  kind: "cafe" | "boutique" | "exhibition" | "blank",
): Project {
  const d = emptyDesign(kind === "blank" ? "Concept 01" : "Original concept");
  const names = {
    cafe: "The Sunday Cafe",
    boutique: "Atelier No. 04",
    exhibition: "Common Ground",
    blank: "Untitled space",
  };
  if (kind === "cafe") {
    boundary(d, [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ]);
    d.openings = [
      {
        id: "entry-door",
        wallId: "wall-2",
        type: "door",
        offset: 0.65,
        width: 1.1,
        height: 2.3,
        sill: 0,
        angle: 85,
      },
      {
        id: "window-1",
        wallId: "wall-3",
        type: "window",
        offset: 1.2,
        width: 2.3,
        height: 1.55,
        sill: 0.85,
        angle: 0,
      },
      {
        id: "window-2",
        wallId: "wall-3",
        type: "window",
        offset: 4.35,
        width: 2.3,
        height: 1.55,
        sill: 0.85,
        angle: 0,
      },
      {
        id: "window-3",
        wallId: "wall-2",
        type: "window",
        offset: 3,
        width: 2.2,
        height: 1.7,
        sill: 0.65,
        angle: 0,
      },
    ];
    add(d, "counter", 4.7, 1.65);
    add(d, "shelf", 4.1, 0.3);
    add(d, "shelf", 6, 0.3);
    add(d, "plant", 0.65, 0.65);
    add(d, "plant", 0.6, 7.35);
    add(d, "plant", 9.3, 0.65);
    for (const [x, y] of [
      [2.65, 3.8],
      [5.35, 3.8],
      [2.65, 6.3],
      [5.35, 6.3],
    ]) {
      add(d, "bistro", x, y);
      add(d, "chair", x - 0.78, y, 90);
      add(d, "chair", x + 0.78, y, -90);
    }
    add(d, "banquette", 9.38, 3.7, 90);
    add(d, "bistro", 8.25, 3.1);
    add(d, "bistro", 8.25, 4.5);
    add(d, "stool", 8.05, 1.45);
    add(d, "stool", 8.8, 1.45);
    d.lights = [
      {
        id: "light-1",
        x: 3.7,
        y: 1.7,
        height: 2.55,
        intensity: 45,
        color: "#ffe1b0",
      },
      {
        id: "light-2",
        x: 5.6,
        y: 1.7,
        height: 2.55,
        intensity: 45,
        color: "#ffe1b0",
      },
      {
        id: "light-3",
        x: 5,
        y: 5.2,
        height: 2.75,
        intensity: 35,
        color: "#ffe8c9",
      },
    ];
  } else if (kind === "boutique") {
    d.floorMaterial = "oak";
    d.wallMaterial = "cream";
    d.rates.floor = 6500;
    d.rates.wall = 2200;
    boundary(d, [
      [0, 0],
      [9, 0],
      [9, 5],
      [6, 5],
      [6, 9],
      [0, 9],
    ]);
    d.openings = [
      {
        id: "entry-door",
        wallId: "wall-4",
        type: "door",
        offset: 1.05,
        width: 1.2,
        height: 2.4,
        sill: 0,
        angle: 90,
      },
      {
        id: "shop-window",
        wallId: "wall-5",
        type: "window",
        offset: 1,
        width: 3,
        height: 2,
        sill: 0.5,
        angle: 0,
      },
    ];
    for (const x of [1.2, 3, 4.8, 6.6]) add(d, "rack", x, 0.8);
    for (const y of [2.8, 5.2]) add(d, "rack", 0.8, y, 90);
    add(d, "island", 3.4, 3.1);
    add(d, "island", 3.4, 5.5);
    add(d, "counter", 7.4, 3.3, 90);
    add(d, "shelf", 8.65, 1.3, 90);
    add(d, "rug", 2.8, 7.5);
    add(d, "lounge", 1.7, 7.5, 25);
    add(d, "lounge", 4, 7.5, -25);
    add(d, "pedestal", 5.5, 1.9);
    add(d, "pedestal", 6.5, 1.9);
    add(d, "plant", 0.5, 1.6);
    add(d, "plant", 5.5, 8.5);
    add(d, "lamp", 3, 8.4);
    d.lighting = { daylight: 0.85, interior: 1.4, exposure: 1.1 };
    d.lights = [
      {
        id: uid("l"),
        x: 3.3,
        y: 3,
        height: 2.8,
        intensity: 50,
        color: "#fff0d7",
      },
      {
        id: uid("l"),
        x: 3.3,
        y: 5.5,
        height: 2.8,
        intensity: 50,
        color: "#fff0d7",
      },
    ];
  } else if (kind === "exhibition") {
    d.floorMaterial = "stone";
    d.wallMaterial = "sage";
    d.rates.floor = 9200;
    d.rates.wall = 2800;
    boundary(d, [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ]);
    d.walls[2].height = 0.3;
    add(d, "counter", 1.5, 4.2, 90);
    add(d, "partition", 3, 1.5);
    add(d, "shelf", 1.4, 0.35);
    add(d, "pedestal", 4.2, 0.9);
    add(d, "pedestal", 5.3, 0.9);
    add(d, "pedestal", 6.4, 0.9);
    add(d, "island", 5.4, 2.6);
    add(d, "rug", 5.4, 4.65);
    add(d, "lounge", 4.5, 4.7, 35);
    add(d, "lounge", 6.4, 4.7, -35);
    add(d, "bistro", 5.45, 4.8);
    add(d, "plant", 7.4, 0.6);
    add(d, "plant", 0.5, 1.25);
    add(d, "lamp", 7.3, 5.3);
    d.lighting = { daylight: 0.55, interior: 1.6, exposure: 1.15 };
    d.lights = [
      {
        id: uid("l"),
        x: 2,
        y: 3,
        height: 2.6,
        intensity: 65,
        color: "#fff1de",
      },
      {
        id: uid("l"),
        x: 5.5,
        y: 2.5,
        height: 2.6,
        intensity: 65,
        color: "#fff1de",
      },
    ];
  }
  const rooms = detectRooms(d);
  if (rooms[0])
    d.roomNames[rooms[0].id] =
      kind === "cafe"
        ? "The Sunday Cafe"
        : kind === "boutique"
          ? "The collection"
          : "Common Ground";
  const designs = [d];
  if (kind !== "blank") {
    const alternative = clone(d);
    alternative.id = uid("design");
    alternative.name = "A softer approach";
    alternative.floorMaterial = "oak";
    alternative.rates.floor = 6500;
    alternative.wallMaterial = "sage";
    alternative.rates.wall = 2800;
    alternative.walls.forEach((w) => (w.material = "sage"));
    alternative.furniture = alternative.furniture.filter(
      (f) => f.catalogId !== "stool",
    );
    designs.push(alternative);
  }
  return { version: 1, name: names[kind], activeDesignId: d.id, designs };
}
export function createStressDesign() {
  const d = emptyDesign("Performance study");
  const pts: number[][] = [];
  for (let i = 0; i < 10; i++) pts.push([i * 3, 0]);
  for (let i = 0; i < 10; i++) pts.push([30, i * 3]);
  for (let i = 0; i < 10; i++) pts.push([30 - i * 3, 30]);
  for (let i = 0; i < 10; i++) pts.push([0, 30 - i * 3]);
  boundary(d, pts);
  for (let x = 0; x < 10; x++)
    for (let y = 0; y < 10; y++)
      add(
        d,
        ["bistro", "chair", "lounge", "plant", "pedestal"][(x + y) % 5],
        1.5 + x * 3,
        1.5 + y * 3,
        (x % 4) * 30,
      );
  return d;
}
