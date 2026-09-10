import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createCity, getAlignment, heightAt, isWater, random, roadSpan } from './core/model';
import type { Alignment, Building, City, Point, Road } from './core/model';
import type { Vehicle } from './core/traffic';

type Point3 = Point & { y: number };
type PickKind = 'building' | 'road' | 'terrain' | 'vehicle';
type Overlay = 'parcels' | 'lanes' | 'signals' | 'queues';
type Callbacks = {
  pick: (kind: PickKind, id: string, point: Point) => void;
  ground: (point: Point, phase: 'down' | 'move' | 'up', event: PointerEvent) => void;
};
type Instances = { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; ids: string[]; kind?: PickKind; colors: THREE.Color[]; shadow: boolean };
type Surface = { positions: number[]; colors: number[]; ids: string[]; material: THREE.Material; kind?: PickKind; shadow: boolean };
type RoadData = { road: Road; alignment: Alignment; length: number; ux: number; uz: number; start: number; end: number };

const UP = new THREE.Vector3(0, 1, 0);
const MINT = 0x89f2ce;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const mixPoint = (a: Point3, b: Point3, t: number): Point3 => ({ x: THREE.MathUtils.lerp(a.x, b.x, t), y: THREE.MathUtils.lerp(a.y, b.y, t), z: THREE.MathUtils.lerp(a.z, b.z, t) });

function project(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const point = { x: a.x + dx * t, z: a.z + dz * t };
  return { point, t, distance: distance(p, point) };
}

function convexHull(points: Point3[]): Point3[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z).filter((p, i, all) => !i || distance(p, all[i - 1]) > 0.001);
  if (sorted.length < 3) return sorted;
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const lower: Point3[] = [], upper: Point3[] = [];
  for (const p of sorted) { while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of sorted.reverse()) { while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function geometry(positions: number[], colors?: number[], normals = true) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors?.length) result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (normals) result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}

function disposeGroup(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
  group.clear();
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Metre-based, entirely procedural city miniature. Editor geometry lives outside root. */
export class CityScene {
  city: City = createCity('empty');
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root = new THREE.Group();

  private scene = new THREE.Scene();
  private editor = new THREE.Group();
  private selection = new THREE.Group();
  private previewGroup = new THREE.Group();
  private brushGroup = new THREE.Group();
  private routeGroup = new THREE.Group();
  private overlays: Record<Overlay, THREE.Group> = { parcels: new THREE.Group(), lanes: new THREE.Group(), signals: new THREE.Group(), queues: new THREE.Group() };
  private trafficGroup = new THREE.Group();
  private hemisphere = new THREE.HemisphereLight(0xfff6df, 0x687b60, 2);
  private sun = new THREE.DirectionalLight(0xffedd1, 3);
  private lamps: THREE.PointLight[] = [];
  private lampPositions: THREE.Vector3[] = [];
  private windows: THREE.MeshStandardMaterial[] = [];
  private facadeSills?: THREE.BoxGeometry;
  private lampMaterial?: THREE.MeshStandardMaterial;
  private glowMaterial?: THREE.MeshBasicMaterial;
  private carHeadlights?: THREE.MeshStandardMaterial;
  private waterTime = { value: 0 };
  private night = 0;
  private terrainMesh?: THREE.Mesh;
  private pickables: THREE.Object3D[] = [];
  private instances = new Map<string, Instances>();
  private surfaces = new Map<string, Surface>();
  private roads = new Map<string, RoadData>();
  private buildingBounds = new Map<string, THREE.Box3>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(UP, 0);
  private scratch = new THREE.Object3D();
  private carMatrix = new THREE.Matrix4();
  private localMatrix = new THREE.Matrix4();
  private color = new THREE.Color();
  private carParts: { mesh: THREE.InstancedMesh; transforms: THREE.Matrix4[]; colored: boolean }[] = [];
  private queueMesh?: THREE.InstancedMesh;
  private signalMesh?: THREE.InstancedMesh;
  private carCapacity = 0;
  private vehicles: Vehicle[] = [];
  private vehicleIndex = new Map<string, Vehicle>();
  private selected?: { kind: string; id: string };
  private tool = 'select';
  private mode: 'orbit' | 'street' | 'follow' = 'orbit';
  private followId: string | null = null;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private streetVelocity = new THREE.Vector3();
  private pointerDown?: { id: number; x: number; y: number; lastX: number; lastY: number; moved: boolean; edit: boolean };
  private lastGround?: Point;
  private lastPointerEvent?: PointerEvent;
  private cameraTween?: { start: number; position: THREE.Vector3; target: THREE.Vector3; endPosition: THREE.Vector3; endTarget: THREE.Vector3; duration: number };
  private resizeObserver: ResizeObserver;
  private abort = new AbortController();
  private frame = 0;
  private previousTime = 0;
  private fps = 60;
  private disposed = false;
  private exportBusy = false;

  constructor(private container: HTMLElement, private callbacks: Callbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Interactive 3D city. Drag to orbit, right-drag to pan, scroll to zoom.');
    container.appendChild(canvas);
    this.camera = new THREE.PerspectiveCamera(35.3, 1, 0.4, 9000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 4500;
    this.controls.maxPolarAngle = Math.PI * 0.475;
    this.controls.screenSpacePanning = true;
    this.controls.zoomSpeed = 0.85;
    this.controls.rotateSpeed = 0.6;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.addEventListener('start', () => { this.cameraTween = undefined; });
    this.root.name = 'Forma City';
    this.trafficGroup.name = 'Traffic';
    this.editor.name = 'Editor (not exported)';
    this.scene.add(this.root, this.editor, this.hemisphere, this.sun, this.sun.target);
    this.editor.add(this.selection, this.previewGroup, this.brushGroup, this.routeGroup, ...Object.values(this.overlays));
    for (const [name, group] of Object.entries(this.overlays)) { group.name = name; group.visible = false; }
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.4;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.radius = 3;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 2600;
    this.scene.background = new THREE.Color(0xe6e7db);
    this.scene.fog = new THREE.Fog(0xe6e7db, 2400, 5800);
    const signal = this.abort.signal;
    canvas.addEventListener('pointerdown', this.onPointerDown, { signal });
    canvas.addEventListener('pointermove', this.onPointerMove, { signal });
    canvas.addEventListener('pointerup', this.onPointerUp, { signal });
    canvas.addEventListener('pointercancel', this.onPointerCancel, { signal });
    canvas.addEventListener('lostpointercapture', this.onPointerCancel, { signal });
    canvas.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    window.addEventListener('keydown', this.onKeyDown, { signal });
    window.addEventListener('keyup', event => this.keys.delete(event.code), { signal });
    window.addEventListener('blur', () => { this.keys.clear(); if (this.lastPointerEvent) this.onPointerCancel(this.lastPointerEvent); }, { signal });
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();
    this.rebuild(this.city);
    this.home();
    this.frame = requestAnimationFrame(this.animate);
  }

  private resize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private instance(g: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, angle = 0, id = '', kind?: PickKind, color?: THREE.Color, shadow = true) {
    const key = `${g.uuid}:${material.uuid}:${kind ?? ''}:${shadow}`;
    let batch = this.instances.get(key);
    if (!batch) { batch = { geometry: g, material, matrices: [], ids: [], colors: [], kind, shadow }; this.instances.set(key, batch); }
    this.scratch.position.set(x, y, z); this.scratch.rotation.set(0, angle, 0); this.scratch.scale.set(sx, sy, sz); this.scratch.updateMatrix();
    batch.matrices.push(this.scratch.matrix.clone()); batch.ids.push(id);
    if (color) batch.colors.push(color.clone());
  }

  private triangle(material: THREE.Material, a: Point3, b: Point3, c: Point3, id = '', kind?: PickKind, color?: THREE.Color) {
    const key = `${material.uuid}:${kind ?? ''}`;
    let batch = this.surfaces.get(key);
    if (!batch) { batch = { material, positions: [], ids: [], colors: [], kind, shadow: kind === 'road' }; this.surfaces.set(key, batch); }
    // All horizontal surface callers use the same upward winding in the X/Z plane.
    for (const p of [a, b, c]) { batch.positions.push(p.x, p.y, p.z); if (color) batch.colors.push(color.r, color.g, color.b); }
    batch.ids.push(id);
  }

  private quad(material: THREE.Material, a: Point3, b: Point3, c: Point3, d: Point3, id = '', kind?: PickKind, color?: THREE.Color) {
    this.triangle(material, a, d, b, id, kind, color); this.triangle(material, b, d, c, id, kind, color);
  }

  private polygon(material: THREE.Material, points: Point3[], id = '', kind?: PickKind) {
    if (points.length < 3) return;
    const indices = THREE.ShapeUtils.triangulateShape(points.map(p => new THREE.Vector2(p.x, p.z)), []);
    for (const [a, b, c] of indices) this.triangle(material, points[a], points[c], points[b], id, kind);
  }

  private flush() {
    for (const batch of this.instances.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      batch.colors.forEach((color, i) => mesh.setColorAt(i, color));
      mesh.name = batch.material.name || 'City details';
      mesh.castShadow = batch.shadow; mesh.receiveShadow = true;
      mesh.userData = { kind: batch.kind, ids: batch.ids };
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      if (batch.kind) this.pickables.push(mesh);
    }
    for (const batch of this.surfaces.values()) {
      const mesh = new THREE.Mesh(geometry(batch.positions, batch.colors), batch.material);
      mesh.name = batch.material.name || 'City surfaces';
      mesh.receiveShadow = true; mesh.castShadow = batch.shadow;
      mesh.userData = { kind: batch.kind, faceIds: batch.ids };
      this.root.add(mesh);
      if (batch.kind) this.pickables.push(mesh);
    }
    this.instances.clear(); this.surfaces.clear();
  }

  rebuild(city: City): void {
    if (this.disposed) return;
    const vehicles = this.vehicles;
    this.pickables = []; this.roads.clear(); this.buildingBounds.clear();
    this.instances.clear(); this.surfaces.clear();
    disposeGroup(this.root);
    for (const group of Object.values(this.overlays)) disposeGroup(group);
    for (const group of [this.selection, this.previewGroup, this.brushGroup, this.routeGroup]) disposeGroup(group);
    this.selected = undefined; this.windows = []; this.lampPositions = [];
    this.lamps.forEach(light => { this.scene.remove(light); light.dispose(); }); this.lamps = [];
    this.carParts = []; this.carCapacity = 0; this.queueMesh = undefined; this.signalMesh = undefined;
    this.city = city;
    const material = (name: string, color: THREE.ColorRepresentation, roughness = 0.86) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness }); m.name = name; return m;
    };
    const box = new THREE.BoxGeometry(1, 1, 1);
    const windowPane = new THREE.PlaneGeometry(1, 1);
    const sill = new THREE.BoxGeometry(1, 1, 1);
    sill.setDrawRange(24, 6); this.facadeSills = sill;
    const canopy = new THREE.IcosahedronGeometry(1, 1);
    const angularCanopy = new THREE.IcosahedronGeometry(1, 0);
    const cone = new THREE.ConeGeometry(1, 1, 7);
    const trunk = new THREE.CylinderGeometry(0.7, 1, 1, 6);
    const sphere = new THREE.SphereGeometry(1, 8, 5);
    const chalk = material('Chalk limestone / cornices', 0xe6dfca);
    const sidewalk = material('Warm limestone sidewalks', 0xd0cbb7);
    const curb = material('Pale stone curbs', 0xeee8d4);
    const asphalt = material('Warm graphite asphalt', 0x59635d);
    asphalt.shadowSide = THREE.DoubleSide; sidewalk.shadowSide = THREE.DoubleSide;
    const roadPaint = material('Ivory road markings', 0xe7e5cf);
    const ochre = material('Boulevard ochre markings', 0xc7af6f);
    const wood = material('Oiled timber', 0x92745b);
    const metal = material('Street furniture / bronze', 0x515d53, 0.62);
    const leaves = material('Sage and olive foliage', 0xffffff);
    const bark = material('Tree trunks', 0x6b6550);
    const lawn = material('Pocket park meadow', 0x9fac83);
    const roof = material('Zinc / planted roofs', 0x7b8575);
    const tile = material('Terracotta folded roofs', 0xad806a);
    const glass = material('Sage architectural glass', 0x819f94, 0.32);
    glass.metalness = 0.18;
    const unlitWindow = material('Recessed blue-green glazing', 0x506b62, 0.36);
    const litWindow = material('Occupied warm windows', 0x89907a, 0.4);
    litWindow.emissive.set(0xffb55f); this.windows.push(litWindow);
    this.lampMaterial = material('Porcelain lamp globes', 0xf7e7b9, 0.35);
    this.lampMaterial.emissive.set(0xffd192);
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffd09a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.glowMaterial.name = 'Streetlamp light pools';
    const pool = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    const facades = [0xdedbcb, 0xd6aa91, 0xc6b396, 0xb58471, 0xe7e1d1, 0xadb59d, 0xc4bcaa, 0xd8bfaa].map((c, i) => material(`Mineral facade ${i + 1}`, c));

    this.buildTerrain(material);
    this.buildWater(material);
    this.buildRoads(box, asphalt, sidewalk, curb, roadPaint, ochre, metal, chalk);

    const foliage = [0x72855c, 0x829467, 0x96a475, 0x5e7c5e, 0xa0ad7d, 0x779377].map(c => new THREE.Color(c));
    const parcelLines: number[] = [], parcelColors: number[] = [];
    for (const parcel of city.parcels) {
      const p = parcel.polygon;
      const park = parcel.zone === 'park' || !parcel.buildingId;
      const color = new THREE.Color({ residential: 0xe9c79a, mixed: 0xe4b5a8, commercial: 0x9bbad9, park: 0xa4e8ac }[parcel.zone]);
      for (let i = 0; i < p.length; i++) for (const q of [p[i], p[(i + 1) % p.length]]) {
        parcelLines.push(q.x, heightAt(city, q.x, q.z) + 0.45, q.z); parcelColors.push(color.r, color.g, color.b);
      }
      this.polygon(park ? lawn : sidewalk, p.map(q => ({ ...q, y: heightAt(city, q.x, q.z) + 0.065 })));
    }
    const parcelGeometry = geometry(parcelLines, parcelColors, false);
    this.overlays.parcels.add(new THREE.LineSegments(parcelGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false })));

    const grass = material('Meadow grass tufts', 0xa6af83);
    // Core owns every asset placement. Only tree form and small under-canopy tufts
    // are renderer details; their independent stream cannot move another prop.
    for (const prop of city.props) {
      const { x, z, size, rotation, id } = prop, c = Math.cos(rotation), s = Math.sin(rotation);
      const road = prop.kind === 'streetlight' ? this.roads.get(prop.hostId)! : undefined;
      const roadPoint = road ? this.atRoad(road, project(prop, road.alignment.points[0], road.alignment.points.at(-1)!).t * road.length) : undefined;
      const y = roadPoint?.y ?? heightAt(city, x, z);
      const add = (g: THREE.BufferGeometry, m: THREE.Material, dx: number, dy: number, dz: number, sx: number, sy: number, sz: number, angle = 0, color?: THREE.Color, shadow = true) => this.instance(g, m, x + dx * c + dz * s, y + dy, z - dx * s + dz * c, sx, sy, sz, rotation + angle, id, undefined, color, shadow);
      if (prop.kind === 'path') {
        if (prop.hostId === 'terrain') add(box, wood, 0, 0.2, 0, prop.length!, 0.3, size);
        else {
          const points: Point3[] = [], count = Math.ceil(prop.length! / 4);
          for (let i = 0; i <= count; i++) { const d = (i / count - 0.5) * prop.length!, px = x + c * d, pz = z - s * d; points.push({ x: px, z: pz, y: heightAt(city, px, pz) + 0.11 }); }
          this.ribbon(sidewalk, points, -size / 2, size / 2, id);
        }
      } else if (prop.kind === 'bench') {
        add(box, wood, 0, 0.65, 0, size, 0.2, size * 0.25);
        add(box, wood, 0, 1.07, size * 0.112, size, 0.7, size * 0.047);
        for (const dx of [-size * 0.353, size * 0.353]) add(box, metal, dx, 0.3, 0, 0.18, 0.6, size * 0.191);
      } else if (prop.kind === 'streetlight') {
        add(trunk, metal, 0, size / 2, 0, 0.12, size, 0.12);
        add(box, metal, 0.6, size, 0, 1.4, 0.13, 0.13);
        add(sphere, this.lampMaterial!, 1.1, size - 0.1, 0, 0.36, 0.21, 0.36, 0, undefined, false);
        this.lampPositions.push(new THREE.Vector3(x, y + size - 0.4, z));
        for (const scale of [2.3, 4.4, 6.6]) this.instance(pool, this.glowMaterial!, roadPoint!.x, y + 0.18 + scale * 0.001, roadPoint!.z, scale, 1, scale, 0, id, undefined, undefined, false);
      } else {
        const rng = random(`${city.seed}:${id}:appearance`), style = rng(), tint = foliage[Math.floor(rng() * foliage.length)];
        add(trunk, bark, 0, size * 0.29, 0, size * 0.075, size * 0.58, size * 0.075);
        if (style < 0.2) {
          add(cone, leaves, 0, size * 0.74, 0, size * 0.35, size * 0.95, size * 0.35, rng() * 6, tint);
          add(cone, leaves, 0, size * 0.51, 0, size * 0.42, size * 0.65, size * 0.42, rng() * 6, tint);
        } else if (style < 0.46) add(canopy, leaves, 0, size * 0.72, 0, size * 0.29, size * 0.57, size * 0.3, rng() * 6, tint);
        else {
          add(angularCanopy, leaves, 0, size * 0.65, 0, size * 0.5, size * 0.43, size * 0.43, rng() * 6, tint);
          add(canopy, leaves, size * 0.2, size * 0.78, -size * 0.13, size * 0.31, size * 0.35, size * 0.31, rng() * 6, tint);
        }
        if (prop.hostId === 'terrain') for (let j = 0; j < 3; j++) {
          const dx = (rng() - 0.5) * size * 0.55, dz = (rng() - 0.5) * size * 0.55;
          const dy = heightAt(city, x + dx * c + dz * s, z - dx * s + dz * c) - y;
          add(cone, grass, dx, dy + 0.4, dz, 0.3, 0.85, 0.3, rng() * 6, undefined, false);
          if (rng() < 0.38) add(canopy, leaves, dx, dy + 0.7, dz, size * 0.12, 0.85, size * 0.12, rng() * 6, tint);
        }
      }
    }

    const gable = geometry([
      -0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, -0.5,
      -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5,
      -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, -0.5,
      -0.5, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5,
      0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, 0.5,
      0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
    ]);
    for (const building of city.buildings) this.buildBuilding(building, { box, windowPane, sill, gable, canopy, facades, chalk, roof, tile, glass, unlitWindow, litWindow, metal, wood, leaves });
    this.flush();
    // Dispose primitives/materials that happened not to receive any instances.
    const usedGeometry = new Set<THREE.BufferGeometry>(), usedMaterial = new Set<THREE.Material>();
    this.root.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) usedGeometry.add(m.geometry); if (m.material) for (const a of Array.isArray(m.material) ? m.material : [m.material]) usedMaterial.add(a); });
    for (const g of [box, windowPane, sill, canopy, angularCanopy, cone, trunk, sphere, pool, gable]) if (!usedGeometry.has(g)) g.dispose();
    if (!usedGeometry.has(sill)) this.facadeSills = undefined;
    for (const m of [chalk, sidewalk, curb, asphalt, roadPaint, ochre, wood, metal, leaves, bark, lawn, roof, tile, glass, unlitWindow, litWindow, grass, ...facades]) if (!usedMaterial.has(m)) m.dispose();
    this.root.add(this.trafficGroup);
    this.setTraffic(vehicles);
    for (let i = 0; i < Math.min(6, this.lampPositions.length); i++) {
      const light = new THREE.PointLight(0xffd29a, 0, 38, 2);
      light.position.copy(this.lampPositions[Math.floor(i * this.lampPositions.length / 6)]);
      this.scene.add(light); this.lamps.push(light);
    }
    const half = city.terrain.size * 0.66;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.setTime(city.settings.day);
    this.renderer.shadowMap.needsUpdate = true;
    this.root.updateMatrixWorld(true);
  }

  private buildTerrain(material: (name: string, color: THREE.ColorRepresentation, roughness?: number) => THREE.MeshStandardMaterial) {
    const { size, resolution } = this.city.terrain;
    const n = Math.max(97, Math.min(193, (resolution - 1) * 4 + 1));
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const green = new THREE.Color(0x9eaf89), olive = new THREE.Color(0x889a76), sand = new THREE.Color(0xc8bea0);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const x = (ix / (n - 1) - 0.5) * size, z = (iz / (n - 1) - 0.5) * size, y = heightAt(this.city, x, z);
      positions.push(x, y, z);
      const noise = (Math.sin(x * 0.027 + Math.sin(z * 0.035) * 2) + Math.sin(z * 0.061 + x * 0.016) * 0.45 + Math.sin(x * 1.6 + z * 2.1) * 0.18) / 3 + 0.5;
      this.color.copy(green).lerp(olive, clamp(noise, 0, 1) * 0.72);
      let bank = Infinity;
      for (const w of this.city.water) for (let i = 1; i < w.points.length; i++) bank = Math.min(bank, Math.abs(project({ x, z }, w.points[i - 1], w.points[i]).distance - w.width / 2));
      if (bank < 8) this.color.lerp(sand, (1 - bank / 8) * 0.82);
      colors.push(this.color.r, this.color.g, this.color.b);
      if (ix < n - 1 && iz < n - 1) { const a = iz * n + ix; indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
    }
    const top = geometry(positions, colors, false); top.setIndex(indices); top.computeVertexNormals();
    const mat = material('Subtly variegated meadow terrain', 0xffffff); mat.vertexColors = true;
    this.terrainMesh = new THREE.Mesh(top, mat);
    this.terrainMesh.name = 'Terrain'; this.terrainMesh.receiveShadow = true; this.terrainMesh.userData = { kind: 'terrain', id: 'terrain' };
    this.root.add(this.terrainMesh); this.pickables.push(this.terrainMesh);
    const bottom = Math.min(-12, Math.min(...this.city.terrain.heights) - 9);
    const walls: number[] = [];
    const half = size / 2;
    const boundary = [{ x: -half, z: -half }, { x: half, z: -half }, { x: half, z: half }, { x: -half, z: half }];
    for (let e = 0; e < 4; e++) for (let i = 0; i < n - 1; i++) {
      const a = boundary[e], b = boundary[(e + 1) % 4];
      const x1 = THREE.MathUtils.lerp(a.x, b.x, i / (n - 1)), z1 = THREE.MathUtils.lerp(a.z, b.z, i / (n - 1));
      const x2 = THREE.MathUtils.lerp(a.x, b.x, (i + 1) / (n - 1)), z2 = THREE.MathUtils.lerp(a.z, b.z, (i + 1) / (n - 1));
      const y1 = heightAt(this.city, x1, z1), y2 = heightAt(this.city, x2, z2);
      walls.push(x1, y1, z1, x2, y2, z2, x1, bottom, z1, x2, y2, z2, x2, bottom, z2, x1, bottom, z1);
    }
    const side = new THREE.Mesh(geometry(walls), material('Earth tile / cut edge', 0x929e7d));
    side.name = 'Terrain tile sides'; side.castShadow = true; side.receiveShadow = true; this.root.add(side);
    const underside = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2), material('Terrain underside', 0x7c886d));
    underside.position.y = bottom; this.root.add(underside);
  }

  private ribbon(material: THREE.Material, points: Point3[], left: number, right: number, id = '', kind?: PickKind, lift = 0) {
    const sections = points.map((p, i) => {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], length = distance(a, b) || 1;
      const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
      return [ { x: p.x + nx * left, y: p.y + lift, z: p.z + nz * left }, { x: p.x + nx * right, y: p.y + lift, z: p.z + nz * right } ];
    });
    for (let i = 1; i < sections.length; i++) this.quad(material, sections[i - 1][0], sections[i][0], sections[i][1], sections[i - 1][1], id, kind);
  }

  private buildWater(material: (name: string, color: THREE.ColorRepresentation, roughness?: number) => THREE.MeshStandardMaterial) {
    if (!this.city.water.length) return;
    const water = material('River / muted turquoise', 0x78ada4, 0.3);
    water.metalness = 0.16;
    water.onBeforeCompile = shader => {
      shader.uniforms.uRiverTime = this.waterTime;
      shader.vertexShader = 'varying vec3 vRiverPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiverPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = 'varying vec3 vRiverPosition;\nuniform float uRiverTime;\n' + shader.fragmentShader
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nfloat ripple = sin(vRiverPosition.x * 0.46 + vRiverPosition.z * 1.15 - uRiverTime * 0.7);\nnormal = normalize(normal + vec3(ripple * 0.045, sin(vRiverPosition.x * 0.17 + uRiverTime * 0.35) * 0.025, 0.0));')
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat current = sin(vRiverPosition.z * 0.39 + sin(vRiverPosition.x * 0.035 - uRiverTime * 0.09) * 2.0);\ndiffuseColor.rgb *= 0.97 + current * 0.045;');
    };
    water.customProgramCacheKey = () => 'forma-river-v1';
    const bank = material('Sandstone river embankments', 0xc8baa0);
    const glint = new THREE.MeshStandardMaterial({ color: 0xc5ddd0, roughness: 0.4, transparent: true, opacity: 0.28, depthWrite: false }); glint.name = 'Fine river currents';
    const limit = this.city.terrain.size / 2;
    const clip = (polygon: Point3[]) => {
      for (const axis of ['x', 'z'] as const) for (const sign of [-1, 1]) {
        const output: Point3[] = [];
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i], b = polygon[(i + 1) % polygon.length];
          const da = limit - a[axis] * sign, db = limit - b[axis] * sign;
          if (da >= 0) output.push(a);
          if ((da >= 0) !== (db >= 0)) output.push(mixPoint(a, b, da / (da - db)));
        }
        polygon = output;
      }
      return polygon;
    };
    for (const w of this.city.water) {
      const points: Point3[] = [];
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1], b = w.points[i], count = Math.ceil(distance(a, b) / 7);
        for (let j = i === 1 ? 0 : 1; j <= count; j++) points.push({ x: THREE.MathUtils.lerp(a.x, b.x, j / count), z: THREE.MathUtils.lerp(a.z, b.z, j / count), y: w.level });
      }
      const sections = points.map((p, i) => {
        const prev = points[Math.max(i - 1, 0)], next = points[Math.min(i + 1, points.length - 1)];
        const length = distance(prev, next) || 1, nx = -(next.z - prev.z) / length, nz = (next.x - prev.x) / length;
        return [-w.width / 2 - 4.2, -w.width / 2, w.width / 2, w.width / 2 + 4.2].map((offset, j) => {
          const x = clamp(p.x + nx * offset, -limit, limit), z = clamp(p.z + nz * offset, -limit, limit);
          return { x, z, y: j === 1 || j === 2 ? w.level + 0.025 : Math.max(w.level + 0.1, heightAt(this.city, x, z) + 0.12) };
        });
      });
      for (let i = 1; i < sections.length; i++) {
        const a = sections[i - 1], b = sections[i];
        for (const side of [0, 2]) {
          const x = (a[side].x + b[side].x + a[side + 1].x + b[side + 1].x) / 4;
          const z = (a[side].z + b[side].z + a[side + 1].z + b[side + 1].z) / 4;
          if (!isWater(this.city, x, z)) this.quad(bank, a[side], b[side], b[side + 1], a[side + 1]);
        }
      }
      // Rectangles plus round joins match the capsule union used by isWater.
      // Shared world-space shading makes their coincident interiors seamless.
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1], b = w.points[i], length = distance(a, b);
        const nx = -(b.z - a.z) / length * w.width / 2, nz = (b.x - a.x) / length * w.width / 2;
        this.polygon(water, clip([
          { x: a.x - nx, y: w.level + 0.025, z: a.z - nz }, { x: b.x - nx, y: w.level + 0.025, z: b.z - nz },
          { x: b.x + nx, y: w.level + 0.025, z: b.z + nz }, { x: a.x + nx, y: w.level + 0.025, z: a.z + nz },
        ]), w.id, 'terrain');
      }
      for (const p of w.points) {
        const outline: Point3[] = [];
        for (let j = 0; j < 64; j++) {
          const angle = j / 64 * Math.PI * 2;
          outline.push({ x: p.x + Math.cos(angle) * w.width / 2, y: w.level + 0.025, z: p.z + Math.sin(angle) * w.width / 2 });
          const midAngle = (j + 0.5) / 64 * Math.PI * 2, midRadius = w.width / 2 + 2;
          if (isWater(this.city, p.x + Math.cos(midAngle) * midRadius, p.z + Math.sin(midAngle) * midRadius)) continue;
          const bankPoints = [j, j + 1].flatMap(k => [w.width / 2, w.width / 2 + 4.2].map((r, edge) => {
            const t = k / 64 * Math.PI * 2, x = p.x + Math.cos(t) * r, z = p.z + Math.sin(t) * r;
            return { x, z, y: edge ? Math.max(w.level + 0.1, heightAt(this.city, x, z) + 0.12) : w.level + 0.025 };
          }));
          this.polygon(bank, clip([bankPoints[0], bankPoints[1], bankPoints[3], bankPoints[2]]));
        }
        this.polygon(water, clip(outline), w.id, 'terrain');
      }
      const rng = random(`${this.city.seed}:${w.id}:ripples`);
      for (let i = 0; i < Math.min(300, points.length * 2); i++) {
        const k = Math.floor(rng() * (points.length - 1)), p = mixPoint(points[k], points[k + 1], rng());
        const a = points[k], b = points[k + 1], length = distance(a, b) || 1, ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
        const offset = (rng() - 0.5) * w.width * 0.87, x = p.x - uz * offset, z = p.z + ux * offset, span = 1 + rng() * 7;
        if (Math.abs(x) + span > limit || Math.abs(z) + span > limit) continue;
        this.ribbon(glint, [{ x: x - ux * span / 2, y: w.level + 0.07, z: z - uz * span / 2 }, { x: x + ux * span / 2, y: w.level + 0.07, z: z + uz * span / 2 }], -0.045, 0.045);
      }
    }
  }

  private atRoad(data: RoadData, distanceAlong: number): Point3 {
    const points = data.alignment.points, target = clamp(distanceAlong, 0, data.length);
    for (let i = 1; i < points.length; i++) {
      const end = distance(points[0], points[i]);
      if (end >= target - 0.00001) { const start = distance(points[0], points[i - 1]); return mixPoint(points[i - 1], points[i], clamp((target - start) / (end - start || 1), 0, 1)); }
    }
    return { ...points[points.length - 1] };
  }

  private buildRoads(box: THREE.BufferGeometry, asphalt: THREE.Material, sidewalk: THREE.Material, curb: THREE.Material, paint: THREE.Material, ochre: THREE.Material, metal: THREE.Material, stone: THREE.Material) {
    const adjacent = new Map<string, Road[]>();
    for (const road of this.city.roads) for (const id of [road.a, road.b]) { if (!adjacent.has(id)) adjacent.set(id, []); adjacent.get(id)!.push(road); }
    const nodes = new Map(this.city.nodes.map(n => [n.id, n]));
    const junctions = new Map<string, { points: Point3[]; roads: Road[] }>();
    const lanePositions: number[] = [], laneColors: number[] = [];
    for (const road of this.city.roads) {
      const a = nodes.get(road.a)!, b = nodes.get(road.b)!, length = distance(a, b);
      const ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
      const data: RoadData = { road, alignment: getAlignment(this.city, road), length, ux, uz, ...roadSpan(this.city, road) };
      this.roads.set(road.id, data);
      const points = [this.atRoad(data, data.start), ...data.alignment.points.filter(p => { const d = distance(a, p); return d > data.start + 0.001 && d < data.end - 0.001; }), this.atRoad(data, data.end)];
      const half = road.width / 2, walk = Math.min(1.7, road.width * 0.14), asphaltHalf = half - walk;
      this.ribbon(asphalt, points, -asphaltHalf, asphaltHalf, road.id, 'road', 0.14);
      for (const sign of [-1, 1]) {
        const lo = sign < 0 ? -half : asphaltHalf, hi = sign < 0 ? -asphaltHalf : half;
        this.ribbon(sidewalk, points, lo, hi, road.id, 'road', 0.28);
        this.ribbon(curb, points, sign < 0 ? -asphaltHalf - 0.18 : asphaltHalf - 0.04, sign < 0 ? -asphaltHalf + 0.04 : asphaltHalf + 0.18, '', undefined, 0.3);
        for (let i = 1; i < points.length; i++) {
          const p = points[i - 1], q = points[i];
          const a = { x: p.x - uz * asphaltHalf * sign, y: p.y + 0.3, z: p.z + ux * asphaltHalf * sign };
          const b = { x: q.x - uz * asphaltHalf * sign, y: q.y + 0.3, z: q.z + ux * asphaltHalf * sign };
          const lowA = { ...a, y: p.y + 0.14 }, lowB = { ...b, y: q.y + 0.14 };
          if (sign < 0) this.quad(curb, a, b, lowB, lowA); else this.quad(curb, b, a, lowA, lowB);
        }
      }
      for (const [id, p] of [[road.a, points[0]], [road.b, points[points.length - 1]]] as const) {
        if (!junctions.has(id)) junctions.set(id, { points: [], roads: adjacent.get(id)! });
        for (const side of [-1, 1]) junctions.get(id)!.points.push({ x: p.x - uz * asphaltHalf * side, y: p.y + 0.14, z: p.z + ux * asphaltHalf * side });
      }
      for (let d = data.start + 3; d + 2.8 < data.end - 2; d += 10) {
        const pa = this.atRoad(data, d), pb = this.atRoad(data, d + 2.8);
        if (road.profile === 'boulevard') { this.ribbon(ochre, [pa, pb], -0.34, -0.13, '', undefined, 0.165); this.ribbon(ochre, [pa, pb], 0.13, 0.34, '', undefined, 0.165); }
        else this.ribbon(paint, [pa, pb], -0.12, 0.12, '', undefined, 0.165);
      }
      for (const end of [data.start + 1.5, data.end - 3]) if (length > 24) {
        for (let cross = -asphaltHalf + 0.5; cross < asphaltHalf - 0.4; cross += 1.1) this.ribbon(paint, [this.atRoad(data, end), this.atRoad(data, end + 1.7)], cross, Math.min(cross + 0.52, asphaltHalf - 0.1), '', undefined, 0.17);
      }
      // Grade-following solid fascia closes the deck all the way down to land.
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1], q = points[i];
        const elevated = (p.y + q.y) / 2 - heightAt(this.city, (p.x + q.x) / 2, (p.z + q.z) / 2) > 0.65;
        if (!elevated) continue;
        for (const side of [-1, 1]) {
          const ap = { x: p.x - uz * half * side, y: p.y + 0.24, z: p.z + ux * half * side }, bp = { x: q.x - uz * half * side, y: q.y + 0.24, z: q.z + ux * half * side };
          const ab = { ...ap, y: road.level === 0 && !isWater(this.city, ap.x, ap.z) ? Math.min(p.y - 1.2, heightAt(this.city, ap.x, ap.z)) : p.y - 1.25 };
          const bb = { ...bp, y: road.level === 0 && !isWater(this.city, bp.x, bp.z) ? Math.min(q.y - 1.2, heightAt(this.city, bp.x, bp.z)) : q.y - 1.25 };
          if (side < 0) this.quad(stone, bp, ap, ab, bb); else this.quad(stone, ap, bp, bb, ab);
        }
        this.ribbon(stone, [p, q], half, -half, '', undefined, -1.25);
      }
      if (data.alignment.bridge || road.level > 0) {
        for (let d = data.start + 3; d < data.end - 2; d += 4.5) {
          const p = this.atRoad(data, d);
          if (p.y - heightAt(this.city, p.x, p.z) < 1) continue;
          for (const side of [-1, 1]) {
            const x = p.x - uz * (half - 0.32) * side, z = p.z + ux * (half - 0.32) * side;
            this.instance(box, metal, x, p.y + 0.92, z, 0.15, 1.35, 0.15);
            const q = this.atRoad(data, Math.min(d + 4.5, data.end));
            this.beam(box, metal, { x, y: p.y + 1.57, z }, { x: q.x - uz * (half - 0.32) * side, y: q.y + 1.57, z: q.z + ux * (half - 0.32) * side }, 0.16, 0.16);
          }
        }
        for (let d = data.start + 14; d < data.end - 10; d += 28) {
          const p = this.atRoad(data, d), base = heightAt(this.city, p.x, p.z);
          if (p.y - base < 2) continue;
          for (const side of [-1, 1]) this.instance(box, stone, p.x - uz * half * 0.56 * side, (p.y - 1 + base) / 2, p.z + ux * half * 0.56 * side, 1.8, p.y - 1 - base, 2.1, Math.atan2(ux, uz));
          this.instance(box, stone, p.x, p.y - 1.1, p.z, road.width - 1, 0.8, 2.3, Math.atan2(ux, uz));
        }
      }
      for (const sign of [-1, 1]) {
        const color = new THREE.Color(sign === 1 ? 0x98e2cf : 0x86b8da);
        const line = data.alignment.points.map(p => ({ x: p.x - uz * road.width * 0.19 * sign, y: p.y + 0.42, z: p.z + ux * road.width * 0.19 * sign }));
        for (let i = 1; i < line.length; i++) for (const p of [line[i - 1], line[i]]) { lanePositions.push(p.x, p.y, p.z); laneColors.push(color.r, color.g, color.b); }
        for (let d = data.start + 12; d < data.end - 5; d += 28) {
          const p = this.atRoad(data, d), x = p.x - uz * road.width * 0.19 * sign, z = p.z + ux * road.width * 0.19 * sign;
          for (const side of [-1, 1]) for (const q of [{ x: x + ux * sign * 1.6, z: z + uz * sign * 1.6 }, { x: x - ux * sign * 1.6 - uz * side * 1.1, z: z - uz * sign * 1.6 + ux * side * 1.1 }]) { lanePositions.push(q.x, p.y + 0.43, q.z); laneColors.push(color.r, color.g, color.b); }
        }
      }
    }
    // A single convex asphalt fan per junction meets the trimmed strips exactly.
    // No sidewalk crosses a connector, and no coplanar road rectangles overlap.
    for (const [id, junction] of junctions) {
      if (junction.roads.length < 2) continue;
      const hull = convexHull(junction.points), node = nodes.get(id)!;
      const center = { x: node.x, y: node.y + 0.14, z: node.z };
      for (let i = 0; i < hull.length; i++) this.triangle(asphalt, center, hull[(i + 1) % hull.length], hull[i], junction.roads[0].id, 'road');
    }
    this.overlays.lanes.add(new THREE.LineSegments(geometry(lanePositions, laneColors, false), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })));
    for (const batch of this.surfaces.values()) if (batch.material === stone) batch.shadow = true;
  }

  private beam(box: THREE.BufferGeometry, material: THREE.Material, a: Point3, b: Point3, width: number, height: number) {
    const key = `${box.uuid}:${material.uuid}::true`;
    let batch = this.instances.get(key);
    if (!batch) { batch = { geometry: box, material, matrices: [], ids: [], colors: [], shadow: true }; this.instances.set(key, batch); }
    this.scratch.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.scratch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize());
    this.scratch.scale.set(width, height, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)); this.scratch.updateMatrix();
    batch.matrices.push(this.scratch.matrix.clone()); batch.ids.push('');
  }

  private buildBuilding(b: Building, assets: { box: THREE.BufferGeometry; windowPane: THREE.BufferGeometry; sill: THREE.BufferGeometry; gable: THREE.BufferGeometry; canopy: THREE.BufferGeometry; facades: THREE.Material[]; chalk: THREE.Material; roof: THREE.Material; tile: THREE.Material; glass: THREE.Material; unlitWindow: THREE.Material; litWindow: THREE.Material; metal: THREE.Material; wood: THREE.Material; leaves: THREE.Material }) {
    const { box, windowPane, sill, gable, canopy, facades, chalk, roof, tile, glass, unlitWindow, litWindow, metal, wood, leaves } = assets;
    const rng = random(`${this.city.seed}:${b.id}:architecture`), w = b.width, d = b.depth, h = b.floors * 3.2;
    const grid = this.city.terrain.size / (this.city.terrain.resolution - 1), half = this.city.terrain.size / 2;
    const xs = [b.x - w / 2, b.x + w / 2], zs = [b.z - d / 2, b.z + d / 2];
    for (let i = Math.ceil((xs[0] + half) / grid); i * grid - half < xs[1]; i++) xs.push(i * grid - half);
    for (let i = Math.ceil((zs[0] + half) / grid); i * grid - half < zs[1]; i++) zs.push(i * grid - half);
    // Bilinear terrain extrema lie on this footprint/grid partition's vertices.
    const ground = xs.flatMap(x => zs.map(z => heightAt(this.city, x, z)));
    const low = Math.min(...ground), base = Math.max(...ground) + 0.12;
    const facade = facades[b.palette % facades.length], tower = b.floors >= 10, glazed = tower && rng() > 0.4;
    const add = (mat: THREE.Material, x: number, y: number, z: number, width: number, height: number, depth: number, angle = 0) => this.instance(box, mat, b.x + x, base + y, b.z + z, width, height, depth, angle, b.id, 'building');
    add(chalk, 0, (low - base) / 2 + 0.1, 0, w + 0.18, base - low + 0.22, d + 0.18);
    const podium = tower ? Math.min(6.4, h * 0.2) : 0;
    const upperStart = tower ? h * 0.75 : h;
    const mainW = tower ? w * 0.91 : w, mainD = tower ? d * 0.91 : d;
    const upperW = tower ? w * 0.78 : w, upperD = tower ? d * 0.78 : d;
    if (tower) {
      add(facade, 0, podium / 2, 0, w, podium, d);
      add(glazed ? glass : facade, 0, (podium + upperStart) / 2, 0, mainW, upperStart - podium, mainD);
      add(glazed ? glass : facade, 0, (upperStart + h) / 2, 0, upperW, h - upperStart, upperD);
      add(chalk, 0, podium + 0.16, 0, w + 0.4, 0.32, d + 0.4);
      add(chalk, 0, upperStart, 0, mainW + 0.4, 0.38, mainD + 0.4);
    } else add(facade, 0, h / 2, 0, w, h, d);
    const rows = Math.min(8, b.floors), columnsX = Math.max(1, Math.min(5, Math.floor(w / 3.8))), columnsZ = Math.max(1, Math.min(5, Math.floor(d / 3.8)));
    for (let row = 0; row < rows; row++) {
      const y = rows === 1 ? Math.min(1.8, h / 2) : 1.9 + row * (h - 3.5) / (rows - 1);
      const rw = y < podium ? w : y > upperStart ? upperW : mainW, rd = y < podium ? d : y > upperStart ? upperD : mainD;
      const wh = glazed ? Math.min(2.1, h / rows * 0.55) : 1.38;
      for (const side of [-1, 1]) {
        for (let col = 0; col < columnsX; col++) {
          const x = (col + 1) * rw / (columnsX + 1) - rw / 2, ww = Math.min(glazed ? 2.8 : 1.65, rw / (columnsX + 1) * 0.57);
          // Flush glazing retains its outer face and all facade rows at 2 rather
          // than 12 triangles per window. Sills/cornices still supply real depth.
          this.instance(windowPane, rng() < 0.33 ? litWindow : unlitWindow, b.x + x, base + y, b.z + side * (rd / 2 + 0.0925), ww, wh, 1, side < 0 ? Math.PI : 0, b.id, 'building', undefined, false);
          if (!glazed) this.instance(sill, chalk, b.x + x, base + y - wh / 2 - 0.1, b.z + side * (rd / 2 + 0.14), ww + 0.28, 0.16, 0.33, side < 0 ? Math.PI : 0, b.id, 'building');
        }
        for (let col = 0; col < columnsZ; col++) {
          const z = (col + 1) * rd / (columnsZ + 1) - rd / 2, ww = Math.min(glazed ? 2.8 : 1.65, rd / (columnsZ + 1) * 0.57);
          this.instance(windowPane, rng() < 0.3 ? litWindow : unlitWindow, b.x + side * (rw / 2 + 0.0925), base + y, b.z + z, ww, wh, 1, side * Math.PI / 2, b.id, 'building', undefined, false);
        }
      }
      if (tower || (b.palette % 3 === 0 && row % 2 === 1)) add(chalk, 0, y + wh / 2 + 0.23, 0, rw + 0.16, 0.16, rd + 0.16);
    }
    if (glazed) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      add(chalk, sx * (mainW / 2 - 0.15), (podium + upperStart) / 2, sz * (mainD / 2 - 0.15), 0.36, upperStart - podium, 0.36);
      add(chalk, sx * (upperW / 2 - 0.15), (upperStart + h) / 2, sz * (upperD / 2 - 0.15), 0.3, h - upperStart, 0.3);
    }
    const roofW = tower ? upperW : w, roofD = tower ? upperD : d;
    let roofHeight = 0.8;
    if (b.roof === 'gable') {
      roofHeight = Math.min(4.3, w * 0.22);
      add(chalk, 0, h, 0, roofW + 0.5, 0.25, roofD + 0.5);
      this.instance(gable, b.palette % 3 === 0 ? roof : tile, b.x, base + h + 0.05, b.z, roofW + 0.7, roofHeight, roofD + 0.7, 0, b.id, 'building');
      add(chalk, roofW * 0.27, h + roofHeight * 0.57, -roofD * 0.2, 1.15, roofHeight * 0.9, 1.2);
      add(metal, roofW * 0.27, h + roofHeight * 1.03, -roofD * 0.2, 1.42, 0.18, 1.42);
    } else {
      add(roof, 0, h + 0.08, 0, roofW, 0.2, roofD);
      for (const side of [-1, 1]) {
        add(chalk, side * (roofW / 2 - 0.16), h + 0.4, 0, 0.32, 0.72, roofD);
        add(chalk, 0, h + 0.4, side * (roofD / 2 - 0.16), roofW, 0.72, 0.32);
      }
      add(chalk, roofW * 0.15, h + 0.72, -roofD * 0.16, Math.max(1.2, roofW * 0.22), 1.24, Math.max(1.2, roofD * 0.2));
      add(metal, roofW * 0.15, h + 1.36, -roofD * 0.16, Math.max(1, roofW * 0.2), 0.14, Math.max(1, roofD * 0.18));
      roofHeight = 1.5;
      if (b.roof === 'terrace') {
        add(wood, -roofW * 0.21, h + 0.22, roofD * 0.15, roofW * 0.34, 0.2, roofD * 0.42);
        for (let i = 0; i < 3; i++) {
          const x = -roofW * 0.33 + i * roofW * 0.23;
          add(chalk, x, h + 0.43, roofD * 0.36, roofW * 0.17, 0.64, 1.35);
          this.instance(canopy, leaves, b.x + x, base + h + 1.1, b.z + roofD * 0.36, roofW * 0.095, 0.8, 0.9, rng() * 6, '', undefined, new THREE.Color(0x88996c));
        }
        roofHeight = 2;
      }
    }
    add(chalk, 0, 0.32, d / 2 + 0.35, Math.min(3.3, w * 0.55), 0.35, 0.72);
    add(unlitWindow, 0, 1.25, d / 2 + 0.06, Math.min(1.8, w * 0.34), 2.3, 0.16);
    if (b.floors < 10 && rng() > 0.28) {
      const awning = b.palette % 2 ? wood : roof;
      add(awning, 0, 2.7, d / 2 + 0.75, Math.min(w * 0.68, 6.4), 0.23, 1.7);
      add(awning, 0, 2.48, d / 2 + 1.54, Math.min(w * 0.68, 6.4), 0.35, 0.15);
      if (b.floors > 2 && rng() > 0.5) {
        const balconyY = Math.min(h - 2, 6.3);
        add(chalk, 0, balconyY, d / 2 + 0.5, w * 0.56, 0.25, 1.1);
        add(metal, 0, balconyY + 0.77, d / 2 + 1, w * 0.56, 0.13, 0.12);
        for (let i = -2; i <= 2; i++) add(metal, i * w * 0.125, balconyY + 0.4, d / 2 + 1, 0.08, 0.8, 0.08);
      }
    }
    this.buildingBounds.set(b.id, new THREE.Box3(new THREE.Vector3(b.x - w / 2 - 0.4, low, b.z - d / 2 - 0.4), new THREE.Vector3(b.x + w / 2 + 0.4, base + h + roofHeight + 0.3, b.z + d / 2 + 1.6)));
  }

  setTraffic(vehicles: Vehicle[]): void {
    if (this.disposed) return;
    this.vehicles = vehicles; this.vehicleIndex.clear();
    for (const vehicle of vehicles) this.vehicleIndex.set(vehicle.id, vehicle);
    if (vehicles.length > this.carCapacity || !this.carParts.length) this.makeCars(Math.max(128, 2 ** Math.ceil(Math.log2(Math.max(1, vehicles.length)))));
    const ids = vehicles.map(v => v.id);
    for (const part of this.carParts) { part.mesh.count = vehicles.length * part.transforms.length; part.mesh.userData.ids = part.transforms.length === 1 ? ids : []; }
    let queueCount = 0;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      this.scratch.position.set(v.position.x, v.position.y + 0.17, v.position.z); this.scratch.rotation.set(0, v.heading, 0); this.scratch.scale.set(1, 1, 1); this.scratch.updateMatrix();
      this.carMatrix.copy(this.scratch.matrix);
      this.color.setHex(v.color);
      for (const part of this.carParts) for (let j = 0; j < part.transforms.length; j++) {
        this.localMatrix.multiplyMatrices(this.carMatrix, part.transforms[j]);
        const index = i * part.transforms.length + j;
        part.mesh.setMatrixAt(index, this.localMatrix);
        if (part.colored) part.mesh.setColorAt(index, this.color);
      }
      if (v.waiting && this.queueMesh) {
        this.scratch.position.set(v.position.x, v.position.y + 0.23, v.position.z); this.scratch.rotation.set(-Math.PI / 2, 0, -v.heading); this.scratch.scale.set(1.75, 2.9, 1); this.scratch.updateMatrix();
        this.queueMesh.setMatrixAt(queueCount++, this.scratch.matrix);
      }
    }
    for (const part of this.carParts) {
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
      // Rendering skips culling, but picking must recompute moving bounds lazily.
      if (part.mesh.userData.kind) part.mesh.boundingSphere = null;
    }
    if (this.queueMesh) { this.queueMesh.count = queueCount; this.queueMesh.instanceMatrix.needsUpdate = true; }
    if (this.selected?.kind === 'vehicle') {
      const vehicle = this.vehicleIndex.get(this.selected.id);
      if (vehicle) { this.selection.position.set(vehicle.position.x, vehicle.position.y, vehicle.position.z); this.selection.rotation.y = vehicle.heading; }
      else this.select('', '');
    }
  }

  private makeCars(capacity: number) {
    const previous = new Set(this.carParts.map(p => p.mesh));
    this.pickables = this.pickables.filter(o => !previous.has(o as THREE.InstancedMesh));
    disposeGroup(this.trafficGroup); disposeGroup(this.overlays.queues); this.carParts = []; this.carCapacity = capacity;
    const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.12 }); paint.name = 'Vehicle enamel';
    const glazing = new THREE.MeshStandardMaterial({ color: 0x324c4c, roughness: 0.25, metalness: 0.2 }); glazing.name = 'Vehicle windscreens';
    const rubber = new THREE.MeshStandardMaterial({ color: 0x3c423c, roughness: 0.9 }); rubber.name = 'Vehicle tyres';
    this.carHeadlights = new THREE.MeshStandardMaterial({ color: 0xffedc4, emissive: 0xffdba3, emissiveIntensity: this.night * 3 }); this.carHeadlights.name = 'Vehicle headlights';
    const tail = new THREE.MeshStandardMaterial({ color: 0xb95846, emissive: 0xfa4930, emissiveIntensity: 0.6 }); tail.name = 'Vehicle tail lights';
    const shape = new THREE.Shape();
    shape.moveTo(-0.84, 0.4); shape.lineTo(0.84, 0.4); shape.lineTo(0.98, 0.64); shape.lineTo(0.89, 1.03); shape.lineTo(-0.89, 1.03); shape.lineTo(-0.98, 0.64); shape.closePath();
    const body = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.1, bevelThickness: 0.12 }).translate(0, 0, -2);
    const cabinShape = new THREE.Shape(); cabinShape.moveTo(-1.3, 1.03); cabinShape.lineTo(-0.82, 1.73); cabinShape.lineTo(0.58, 1.73); cabinShape.lineTo(1.28, 1.03); cabinShape.closePath();
    const cabin = new THREE.ExtrudeGeometry(cabinShape, { depth: 1.54, bevelEnabled: false, steps: 1 }).translate(0, 0, -0.77).rotateY(-Math.PI / 2);
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const wheel = new THREE.CylinderGeometry(0.39, 0.39, 0.2, 8).rotateZ(Math.PI / 2);
    const matrix = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    const part = (g: THREE.BufferGeometry, m: THREE.Material, transforms: THREE.Matrix4[], colored = false, pick = false) => {
      const mesh = new THREE.InstancedMesh(g, m, capacity * transforms.length); mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
      mesh.name = m.name; mesh.castShadow = false; mesh.receiveShadow = true;
      if (pick) { mesh.userData.kind = 'vehicle'; this.pickables.push(mesh); }
      if (colored) { mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * transforms.length * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      this.trafficGroup.add(mesh); this.carParts.push({ mesh, transforms, colored });
    };
    part(body, paint, [matrix(0, 0, 0)], true, true);
    part(cabin, glazing, [matrix(0, 0, 0)], false, true);
    part(unitBox, paint, [matrix(0, 1.76, -0.1, 1.55, 0.08, 1.4)], true);
    part(wheel, rubber, [-1, 1].flatMap(x => [-1, 1].map(z => matrix(x, 0.42, z * 1.35))));
    part(unitBox, this.carHeadlights, [-1, 1].map(x => matrix(x * 0.62, 0.78, 2.115, 0.42, 0.24, 0.07)));
    part(unitBox, tail, [-1, 1].map(x => matrix(x * 0.64, 0.79, -2.115, 0.33, 0.19, 0.07)));
    this.queueMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.84, 1, 24), new THREE.MeshBasicMaterial({ color: 0xf3bd7d, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }), capacity);
    this.queueMesh.count = 0; this.queueMesh.frustumCulled = false; this.queueMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.overlays.queues.add(this.queueMesh);
  }

  setTime(hour: number): void {
    if (!Number.isFinite(hour) || this.disposed) return;
    const h = ((hour % 24) + 24) % 24, sunHeight = Math.sin((h - 6) / 12 * Math.PI);
    const daylight = THREE.MathUtils.smoothstep(sunHeight, -0.13, 0.28);
    this.night = 1 - daylight;
    const warm = 1 - THREE.MathUtils.smoothstep(sunHeight, 0.1, 0.75);
    this.sun.color.set(0xfff0d8).lerp(new THREE.Color(0xffbd86), warm * daylight).lerp(new THREE.Color(0x9dbbd7), this.night);
    this.sun.intensity = 2.6 * daylight + 0.48 * this.night;
    const extent = this.city.terrain.size / 960;
    const groundY = (Math.min(...this.city.terrain.heights) + Math.max(...this.city.terrain.heights)) / 2;
    this.sun.target.position.set(0, groundY, 0);
    this.sun.position.set(Math.cos((h - 6) / 12 * Math.PI) * 720 * extent, groundY + Math.max(0.26, Math.abs(sunHeight)) * 850 * extent, 390 * extent);
    this.sun.shadow.camera.far = Math.max(2600, this.city.terrain.size * 3);
    this.sun.shadow.camera.updateProjectionMatrix();
    this.hemisphere.intensity = 1.65 * daylight + 1.05 * this.night;
    this.hemisphere.color.set(0xfff8e6).lerp(new THREE.Color(0xadc3cd), this.night);
    this.hemisphere.groundColor.set(0x718266).lerp(new THREE.Color(0x354e45), this.night);
    const background = new THREE.Color(0xe6e7db).lerp(new THREE.Color(0x1d3038), this.night);
    (this.scene.background as THREE.Color).copy(background);
    (this.scene.fog as THREE.Fog).color.copy(background);
    this.renderer.toneMappingExposure = 1.08 + this.night * 0.15;
    for (const m of this.windows) m.emissiveIntensity = this.night * 1.85;
    if (this.lampMaterial) this.lampMaterial.emissiveIntensity = this.night * 4;
    if (this.glowMaterial) this.glowMaterial.opacity = this.night * 0.075;
    if (this.carHeadlights) this.carHeadlights.emissiveIntensity = this.night * 3;
    for (const light of this.lamps) light.intensity = this.night * 95;
    this.renderer.shadowMap.needsUpdate = true;
  }

  setTool(tool: string): void {
    this.tool = tool;
    this.controls.mouseButtons.LEFT = tool === 'select' || tool === 'orbit' ? THREE.MOUSE.ROTATE : undefined;
    this.controls.touches.ONE = tool === 'select' || tool === 'orbit' ? THREE.TOUCH.ROTATE : undefined;
    this.renderer.domElement.style.cursor = tool === 'select' || tool === 'orbit' ? 'grab' : 'crosshair';
    if (tool === 'select' || tool === 'orbit') this.setBrush(null, 0);
  }

  setOverlay(name: Overlay, enabled: boolean): void { this.overlays[name].visible = enabled; }

  /** Replace the live signal snapshot (typically every 250ms). Positions are world
   * metres at the lane stop point, including its desired Y lift. No local phase
   * clock: the caller supplies traffic.signal() results. [] clears, rebuild resets.
   * Visibility remains controlled by setOverlay('signals', enabled).
   */
  setSignals(states: { x: number; y: number; z: number; state: 'red' | 'green' }[]): void {
    if (this.disposed) return;
    if (states.some(s => ![s.x, s.y, s.z].every(Number.isFinite) || !['red', 'green'].includes(s.state))) throw new Error('Signal positions must be finite and phases red or green.');
    if (!states.length && !this.signalMesh) return;
    if (!this.signalMesh || states.length > this.signalMesh.instanceMatrix.count) {
      disposeGroup(this.overlays.signals);
      const capacity = Math.max(64, 2 ** Math.ceil(Math.log2(states.length)));
      const mesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1.65, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), capacity);
      mesh.name = 'Live traffic signal phases'; mesh.frustumCulled = false; mesh.renderOrder = 22;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.overlays.signals.add(mesh); this.signalMesh = mesh;
    }
    const mesh = this.signalMesh;
    mesh.count = states.length;
    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      this.localMatrix.makeTranslation(state.x, state.y, state.z); mesh.setMatrixAt(i, this.localMatrix);
      mesh.setColorAt(i, this.color.setHex(state.state === 'red' ? 0xf16f61 : 0x75e9ac));
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true;
  }

  /** Hide all editor geometry together, preserving individual overlay/selection state. */
  setPresentation(enabled: boolean): void { this.editor.visible = !enabled; }

  select(kind: string, id: string): void {
    disposeGroup(this.selection); this.selection.position.set(0, 0, 0); this.selection.rotation.set(0, 0, 0); this.selected = undefined;
    if (!id) return;
    let bounds: THREE.Box3 | undefined;
    if (kind === 'building') bounds = this.buildingBounds.get(id)?.clone().expandByScalar(0.35);
    if (kind === 'vehicle') {
      const v = this.vehicleIndex.get(id); if (!v) return;
      bounds = new THREE.Box3(new THREE.Vector3(-1.3, 0.12, -2.4), new THREE.Vector3(1.3, 2.1, 2.4));
      this.selection.position.set(v.position.x, v.position.y, v.position.z); this.selection.rotation.y = v.heading;
    }
    if (bounds) {
      const helper = new THREE.Box3Helper(bounds, MINT);
      const material = helper.material as THREE.LineBasicMaterial; material.depthTest = false; material.transparent = true; material.opacity = 0.96;
      helper.renderOrder = 20; this.selection.add(helper); this.selected = { kind, id };
    } else if (kind === 'road' && this.roads.has(id)) {
      const data = this.roads.get(id)!;
      this.addEditorRibbon(this.selection, data.alignment.points.map(p => ({ ...p, y: p.y + 0.36 })), data.road.width * 0.78, MINT, 0.3);
      this.selected = { kind, id };
    }
  }

  private addEditorRibbon(group: THREE.Group, points: Point3[], width: number, color: number, opacity: number) {
    if (points.length < 2) return;
    const positions: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = distance(a, b); if (length < 0.001) continue;
      const nx = -(b.z - a.z) / length * width / 2, nz = (b.x - a.x) / length * width / 2;
      const q = [{ x: a.x - nx, y: a.y, z: a.z - nz }, { x: b.x - nx, y: b.y, z: b.z - nz }, { x: b.x + nx, y: b.y, z: b.z + nz }, { x: a.x + nx, y: a.y, z: a.z + nz }];
      for (const j of [0, 3, 1, 1, 3, 2]) positions.push(q[j].x, q[j].y, q[j].z);
    }
    const mesh = new THREE.Mesh(geometry(positions), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    mesh.renderOrder = 10; group.add(mesh);
  }

  preview(points: Point[], width: number, valid = true): void {
    disposeGroup(this.previewGroup);
    if (!points.length) return;
    const color = valid ? 0x76e4d5 : 0xf29480;
    const elevated = points.map(p => ({ ...p, y: this.surfaceHeight(p.x, p.z, false) + 0.6 }));
    const dense: Point3[] = [];
    for (let i = 1; i < elevated.length; i++) {
      const a = elevated[i - 1], b = elevated[i], count = Math.max(1, Math.ceil(distance(a, b) / 4));
      for (let j = i === 1 ? 0 : 1; j <= count; j++) { const p = mixPoint(a, b, j / count); p.y = this.surfaceHeight(p.x, p.z, false) + 0.6; dense.push(p); }
    }
    this.addEditorRibbon(this.previewGroup, dense, Math.max(0.1, width), color, 0.17);
    if (dense.length > 1) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(dense.map(p => new THREE.Vector3(p.x, p.y + 0.1, p.z))), new THREE.LineDashedMaterial({ color, dashSize: 3.3, gapSize: 2.2, depthTest: false }));
      line.computeLineDistances(); line.renderOrder = 20; this.previewGroup.add(line);
    }
    const sphere = new THREE.SphereGeometry(1, 12, 8), mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    for (const p of elevated) { const dot = new THREE.Mesh(sphere, mat); dot.position.set(p.x, p.y + 0.35, p.z); dot.scale.setScalar(clamp(width * 0.13, 0.8, 2)); dot.renderOrder = 21; this.previewGroup.add(dot); }
  }

  setBrush(point: Point | null, radius: number): void {
    disposeGroup(this.brushGroup);
    if (!point || radius <= 0) return;
    const positions: number[] = [], steps = 96, thickness = Math.max(0.32, radius * 0.018);
    for (let i = 0; i < steps; i++) {
      const corners = [i, i + 1].flatMap(j => [radius - thickness, radius].map(r => {
        const angle = j / steps * Math.PI * 2, x = point.x + Math.cos(angle) * r, z = point.z + Math.sin(angle) * r;
        return { x, y: this.surfaceHeight(x, z, false) + 0.43, z };
      }));
      for (const j of [0, 2, 1, 1, 2, 3]) positions.push(corners[j].x, corners[j].y, corners[j].z);
    }
    const ring = new THREE.Mesh(geometry(positions), new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })); ring.renderOrder = 11; this.brushGroup.add(ring);
  }

  setRoute(points: Point3[]): void {
    disposeGroup(this.routeGroup);
    if (points.length < 2) return;
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 0.001) continue;
      curve.add(new THREE.LineCurve3(new THREE.Vector3(a.x, a.y + 0.45, a.z), new THREE.Vector3(b.x, b.y + 0.45, b.z)));
    }
    if (!curve.curves.length) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0x93f2cf, transparent: true, opacity: 0.9, depthWrite: false });
    this.routeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(1200, Math.max(12, points.length * 2)), 0.5, 5, false), mat));
    const sphere = new THREE.SphereGeometry(1.7, 12, 8);
    for (const p of [points[0], points[points.length - 1]]) { const dot = new THREE.Mesh(sphere, mat); dot.position.set(p.x, p.y + 0.7, p.z); this.routeGroup.add(dot); }
  }

  private surfaceHeight(x: number, z: number, includeRoad = true): number {
    let y = heightAt(this.city, x, z);
    for (const w of this.city.water) if (w.points.slice(1).some((b, i) => project({ x, z }, w.points[i], b).distance <= w.width / 2)) y = Math.max(y, w.level);
    if (includeRoad) for (const data of this.roads.values()) {
      const hit = project({ x, z }, data.alignment.points[0], data.alignment.points[data.alignment.points.length - 1]);
      if (hit.distance <= data.road.width / 2) {
        const roadY = this.atRoad(data, hit.t * data.length).y + 0.3;
        if (roadY < this.camera.position.y + 1 || roadY - y < 6) y = Math.max(y, roadY);
      }
    }
    return y;
  }

  setMode(mode: 'orbit' | 'street' | 'follow'): void {
    if (mode === this.mode) return;
    this.cameraTween = undefined;
    this.mode = mode; this.keys.clear(); this.streetVelocity.set(0, 0, 0);
    this.controls.enabled = mode === 'orbit';
    if (mode === 'street') {
      let p: Point = { x: this.controls.target.x, z: this.controls.target.z };
      let nearest = Infinity;
      for (const data of this.roads.values()) {
        const hit = project(p, data.alignment.points[0], data.alignment.points[data.alignment.points.length - 1]);
        if (hit.distance < nearest) { nearest = hit.distance; this.scratch.position.set(hit.point.x, this.atRoad(data, hit.t * data.length).y + 0.3, hit.point.z); }
      }
      if (Number.isFinite(nearest)) p = { x: this.scratch.position.x, z: this.scratch.position.z };
      const limit = this.city.terrain.size / 2 - 2; p.x = clamp(p.x, -limit, limit); p.z = clamp(p.z, -limit, limit);
      const direction = this.camera.getWorldDirection(new THREE.Vector3());
      this.yaw = Math.atan2(direction.x, direction.z); this.pitch = -0.04;
      const position = new THREE.Vector3(p.x, this.surfaceHeight(p.x, p.z) + 2.8, p.z);
      const target = position.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 20, -0.8, Math.cos(this.yaw) * 20));
      this.tweenTo(position, target, 750);
    } else if (mode === 'follow') {
      if (!this.followId || !this.vehicleIndex.has(this.followId)) this.followId = this.vehicles[0]?.id ?? null;
    } else {
      const target = this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(40));
      this.jumpTo(this.camera.position.clone(), target);
    }
  }

  follow(id: string | null): void { this.followId = id; if (id && this.mode !== 'follow') this.setMode('follow'); }

  home(): void {
    this.mode = 'orbit'; this.controls.enabled = true; this.cameraTween = undefined; this.keys.clear();
    this.controls.maxPolarAngle = Math.PI * 0.475;
    const minY = Math.min(...this.city.terrain.heights), maxY = Math.max(...this.city.terrain.heights);
    const target = new THREE.Vector3(0, (minY + maxY) / 2 + 12, 0), direction = new THREE.Vector3(780, this.camera.aspect < 0.8 ? 1600 : 740, 1000).normalize();
    const right = new THREE.Vector3().crossVectors(UP, direction).normalize(), up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), half = this.city.terrain.size / 2;
    const corners: THREE.Vector3[] = [];
    for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [minY - 12, maxY + 80]) corners.push(new THREE.Vector3(x, y, z));
    for (const bounds of this.buildingBounds.values()) if (bounds.max.y > maxY + 80) for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, bounds.max.y, z));
    const horizontal = new THREE.Vector3(direction.x, 0, direction.z).normalize();
    let length = 0;
    // Recenter the projected tile, not its origin: perspective otherwise leaves
    // excessive empty sky and crowds the nearest corner against the bottom edge.
    for (let iteration = 0; iteration < 4; iteration++) {
      length = 0;
      for (const corner of corners) {
        const p = corner.clone().sub(target), depth = p.dot(direction);
        length = Math.max(length, Math.abs(p.dot(right)) / (tan * this.camera.aspect) + depth, Math.abs(p.dot(up)) / tan + depth);
      }
      length *= 1.055;
      if (iteration === 3) break;
      const xs: number[] = [], ys: number[] = [];
      for (const corner of corners) {
        const p = corner.clone().sub(target), depth = length - p.dot(direction);
        xs.push(p.dot(right) / (depth * tan * this.camera.aspect)); ys.push(p.dot(up) / (depth * tan));
      }
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      target.addScaledVector(right, cx * length * tan * this.camera.aspect);
      target.addScaledVector(horizontal, -cy * length * tan / direction.y);
    }
    this.controls.maxDistance = Math.max(4500, length * 2);
    this.camera.far = Math.max(9000, length * 3); this.camera.updateProjectionMatrix();
    this.jumpTo(target.clone().addScaledVector(direction, length), target);
  }

  focus(kind: string, id: string): void {
    let target: THREE.Vector3 | undefined, span = 50;
    if (kind === 'building') { const b = this.buildingBounds.get(id); if (b) { target = b.getCenter(new THREE.Vector3()); span = b.getSize(new THREE.Vector3()).length() * 1.65; } }
    else if (kind === 'road') { const data = this.roads.get(id); if (data) { const p = this.atRoad(data, data.length / 2); target = new THREE.Vector3(p.x, p.y, p.z); span = Math.max(75, data.length * 1.6); } }
    else if (kind === 'vehicle') { const v = this.vehicleIndex.get(id); if (v) { target = new THREE.Vector3(v.position.x, v.position.y, v.position.z); span = 34; } }
    else if (kind === 'terrain') { this.home(); return; }
    if (!target) return;
    this.mode = 'orbit'; this.controls.enabled = false;
    const offset = this.camera.position.clone().sub(this.controls.target).normalize(); offset.y = Math.max(offset.y, 1.2); offset.normalize();
    this.tweenTo(target.clone().addScaledVector(offset, Math.max(35, span)), target, 650);
    this.select(kind, id);
  }

  private tweenTo(position: THREE.Vector3, target: THREE.Vector3, duration: number) {
    this.cameraTween = { start: performance.now(), position: this.camera.position.clone(), target: this.controls.target.clone(), endPosition: position, endTarget: target, duration };
  }

  private jumpTo(position: THREE.Vector3, target: THREE.Vector3) {
    // Flush OrbitControls' residual damping before applying an exact saved view.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false; this.controls.update();
    const offset = position.clone().sub(target), radius = offset.length();
    this.controls.minDistance = Math.min(12, radius);
    this.controls.maxDistance = Math.max(this.controls.maxDistance, radius * 1.01);
    this.controls.maxPolarAngle = Math.max(this.controls.maxPolarAngle, Math.acos(clamp(offset.y / (radius || 1), -1, 1)) + 0.000001);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = Math.max(2400, radius * 1.5); fog.far = Math.max(5800, radius * 3);
    this.camera.position.copy(position); this.controls.target.copy(target); this.camera.lookAt(target); this.controls.update();
    this.controls.enableDamping = damping; this.camera.updateMatrixWorld(true);
  }

  saveView(): { position: number[]; target: number[] } { return { position: this.camera.position.toArray(), target: this.controls.target.toArray() }; }

  loadView(view: { position: number[]; target: number[] }): void {
    if (view.position.length !== 3 || view.target.length !== 3 || ![...view.position, ...view.target].every(Number.isFinite)) return;
    const position = new THREE.Vector3().fromArray(view.position), target = new THREE.Vector3().fromArray(view.target);
    if (position.distanceToSquared(target) < 0.0001) return;
    this.cameraTween = undefined; this.mode = 'orbit'; this.controls.enabled = false; this.keys.clear();
    this.camera.far = Math.max(9000, position.distanceTo(target) + this.city.terrain.size * 2); this.camera.updateProjectionMatrix();
    this.tweenTo(position, target, 650);
  }

  screenshot(): void {
    if (this.disposed) return;
    const visible = this.editor.visible;
    try {
      this.editor.visible = false;
      this.renderer.render(this.scene, this.camera);
      this.renderer.domElement.toBlob(blob => { if (blob) download(blob, `${this.fileName()}.png`); }, 'image/png');
    } finally {
      this.editor.visible = visible;
      this.renderer.render(this.scene, this.camera);
    }
  }

  async exportGLB(): Promise<{ bytes: number; meshes: number }> {
    if (this.disposed) throw new Error('The scene has been disposed.');
    if (this.exportBusy) throw new Error('A city export is already in progress.');
    this.exportBusy = true;
    let snapshot: THREE.Group | undefined;
    try {
      this.root.updateMatrixWorld(true);
      snapshot = this.root.clone(true);
      snapshot.traverse(object => {
        object.userData = {};
        if (object instanceof THREE.InstancedMesh) {
          if (object.count === 0) object.visible = false;
          // GLTF instance accessors must describe active instances, not spare capacity.
          if (object.instanceColor && object.instanceColor.count !== object.count) {
            object.instanceColor = new THREE.InstancedBufferAttribute(object.instanceColor.array.slice(0, object.count * object.instanceColor.itemSize), object.instanceColor.itemSize, object.instanceColor.normalized);
          }
        }
      });
      snapshot.userData = {
        forma: { version: this.city.version, seed: this.city.seed, units: 'metres', terrainSize: this.city.terrain.size,
          buildings: this.city.buildings.map(b => b.id), roads: this.city.roads.map(r => r.id), props: this.city.props.map(p => p.id) },
      };
      const result = await new GLTFExporter().parseAsync(snapshot, { binary: true, onlyVisible: true, trs: false });
      if (!(result instanceof ArrayBuffer)) throw new Error('The GLB exporter returned an unexpected format.');
      const jsonLength = new DataView(result).getUint32(12, true);
      const document = JSON.parse(new TextDecoder().decode(new Uint8Array(result, 20, jsonLength)));
      download(new Blob([result], { type: 'model/gltf-binary' }), `${this.fileName()}.glb`);
      return { bytes: result.byteLength, meshes: document.meshes?.length ?? 0 };
    } finally {
      // Clones own instance attributes, but share static geometry and materials.
      snapshot?.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
      this.exportBusy = false;
    }
  }

  private fileName() { return `forma-${this.city.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'city'}`; }

  stats(): { calls: number; triangles: number; geometries: number; fps: number } {
    const { render, memory } = this.renderer.info;
    return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, fps: Math.round(this.fps) };
  }

  private groundAt(event: PointerEvent): Point | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.camera.updateMatrixWorld(); this.raycaster.setFromCamera(this.pointer, this.camera);
    const flat = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    const hit = this.terrainMesh ? this.raycaster.intersectObject(this.terrainMesh, false)[0] : undefined;
    const point = hit?.point ?? flat;
    if (!point) return undefined;
    const half = this.city.terrain.size / 2;
    if (Math.abs(point.x) > half || Math.abs(point.z) > half) return undefined;
    return { x: point.x, z: point.z };
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.pointerDown) return;
    this.lastPointerEvent = event;
    this.renderer.domElement.focus({ preventScroll: true });
    const edit = this.tool !== 'select' && this.tool !== 'orbit';
    this.pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, edit };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    const point = this.groundAt(event); this.lastGround = point;
    if (edit && point) this.callbacks.ground(point, 'down', event);
  };

  private onPointerMove = (event: PointerEvent) => {
    const down = this.pointerDown;
    if (down && down.id !== event.pointerId) return;
    this.lastPointerEvent = event;
    if (down) {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) down.moved = true;
      if (this.mode === 'street' && !down.edit && !this.cameraTween) {
        this.yaw -= (event.clientX - down.lastX) * 0.003; this.pitch = clamp(this.pitch - (event.clientY - down.lastY) * 0.003, -0.95, 0.85);
      }
      down.lastX = event.clientX; down.lastY = event.clientY;
    }
    if (this.tool !== 'select' && this.tool !== 'orbit' && !(event.buttons & 2)) {
      const point = this.groundAt(event);
      if (point) { this.lastGround = point; this.callbacks.ground(point, 'move', event); }
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    const down = this.pointerDown; if (!down || down.id !== event.pointerId) return;
    this.pointerDown = undefined;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    const point = this.groundAt(event) ?? this.lastGround;
    if (down.edit) { if (point) this.callbacks.ground(point, 'up', event); return; }
    if (down.moved || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    this.root.updateMatrixWorld(true);
    const intersections = this.raycaster.intersectObjects(this.pickables, false);
    for (const hit of intersections) {
      const data = hit.object.userData, kind = data.kind as PickKind | undefined;
      const id = hit.instanceId !== undefined ? data.ids?.[hit.instanceId] : hit.faceIndex != null && data.faceIds ? data.faceIds[hit.faceIndex] : data.id;
      if (kind && id) { this.callbacks.pick(kind, id, { x: hit.point.x, z: hit.point.z }); return; }
    }
    if (point) this.callbacks.pick('terrain', 'terrain', point);
  };

  private onPointerCancel = (event: PointerEvent) => {
    const down = this.pointerDown;
    if (!down || down.id !== event.pointerId) return;
    this.pointerDown = undefined;
    if (down.edit && this.lastGround) this.callbacks.ground(this.lastGround, 'up', event);
  };

  private inputFocused() {
    const element = document.activeElement;
    return element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(element.tagName));
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.inputFocused() || event.ctrlKey || event.metaKey || event.altKey || this.mode !== 'street') return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) { this.keys.add(event.code); event.preventDefault(); }
  };

  private animate = (time: number) => {
    if (this.disposed) return;
    const elapsed = this.previousTime ? (time - this.previousTime) / 1000 : 1 / 60;
    const dt = clamp(elapsed, 0, 0.1);
    this.previousTime = time;
    if (elapsed > 0) this.fps = THREE.MathUtils.lerp(this.fps, 1 / elapsed, 1 - Math.exp(-elapsed * 2));
    this.waterTime.value = time / 1000;
    if (this.cameraTween) {
      const tween = this.cameraTween, fraction = clamp((time - tween.start) / tween.duration, 0, 1), t = fraction * fraction * (3 - 2 * fraction);
      this.camera.position.lerpVectors(tween.position, tween.endPosition, t); this.controls.target.lerpVectors(tween.target, tween.endTarget, t); this.camera.lookAt(this.controls.target);
      if (fraction === 1) { this.cameraTween = undefined; this.jumpTo(tween.endPosition, tween.endTarget); this.controls.enabled = this.mode === 'orbit'; }
    } else if (this.mode === 'street') {
      const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 33 : 14;
      const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
      const strafe = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
      const velocity = new THREE.Vector3(Math.sin(this.yaw) * forward - Math.cos(this.yaw) * strafe, 0, Math.cos(this.yaw) * forward + Math.sin(this.yaw) * strafe);
      if (velocity.lengthSq() > 0) velocity.normalize().multiplyScalar(speed);
      if (this.inputFocused()) { velocity.set(0, 0, 0); this.keys.clear(); }
      this.streetVelocity.lerp(velocity, 1 - Math.exp(-dt * 10));
      this.camera.position.addScaledVector(this.streetVelocity, dt);
      const half = this.city.terrain.size / 2 - 1;
      this.camera.position.x = clamp(this.camera.position.x, -half, half); this.camera.position.z = clamp(this.camera.position.z, -half, half);
      const y = this.surfaceHeight(this.camera.position.x, this.camera.position.z) + 2.8;
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, y, 1 - Math.exp(-dt * 16));
      this.controls.target.copy(this.camera.position).add(new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(20));
      this.camera.lookAt(this.controls.target);
    } else if (this.mode === 'follow') {
      const v = this.followId ? this.vehicleIndex.get(this.followId) : undefined;
      if (v) {
        const target = new THREE.Vector3(v.position.x, v.position.y + 1.5, v.position.z);
        const position = target.clone().add(new THREE.Vector3(-Math.sin(v.heading) * 19, 11, -Math.cos(v.heading) * 19));
        position.y = Math.max(position.y, this.surfaceHeight(position.x, position.z, false) + 4);
        const t = 1 - Math.exp(-dt * 3.5);
        this.camera.position.lerp(position, t); this.controls.target.lerp(target, t); this.camera.lookAt(this.controls.target);
      }
    } else this.controls.update();
    // At aerial distances retain every sill's outward face, but skip its five
    // subpixel sides. Close orbit/street/follow views restore full depth without
    // reallocating instances or hiding any buildings, windows or vehicles.
    if (this.facadeSills) {
      const count = this.camera.position.distanceToSquared(this.controls.target) < 360 ** 2 ? 36 : 6;
      if (this.facadeSills.drawRange.count !== count) {
        this.facadeSills.setDrawRange(count === 6 ? 24 : 0, count);
        this.renderer.shadowMap.needsUpdate = true;
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame); this.abort.abort(); this.resizeObserver.disconnect(); this.controls.dispose();
    disposeGroup(this.root); disposeGroup(this.editor);
    this.lamps.forEach(light => light.dispose()); this.sun.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove();
    this.pickables = []; this.carParts = []; this.vehicles = []; this.vehicleIndex.clear(); this.roads.clear(); this.buildingBounds.clear(); this.scene.clear();
  }
}
