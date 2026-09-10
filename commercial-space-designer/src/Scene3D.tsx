import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CATALOG, MATERIALS } from "./catalog";
import {
  canOccupy,
  canWalk,
  detectRooms,
  furnitureSize,
  openingPose,
  pointInside,
  wallLayers,
  wallPoints,
  projectPoint,
  distance,
  type Design,
  type SavedView,
} from "./model";

export interface SceneAPI {
  reset: () => void;
  capture: () => string;
  getView: () => Pick<SavedView, "position" | "target">;
  setView: (v: Pick<SavedView, "position" | "target">) => void;
  recover: () => void;
  stats: () => Record<string, unknown>;
  probe: (
    from: [number, number, number],
    to: [number, number, number],
  ) => { wall: boolean; entityId: string | null; distance: number }[];
}
type Props = {
  design: Design;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  mode: "orbit" | "walk";
  onModeChange: (m: "orbit" | "walk") => void;
  apiRef: MutableRefObject<SceneAPI | null>;
  presentation?: boolean;
};

export default function Scene3D(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(props);
  current.current = props;
  const engine = useRef<{
    rebuild: () => void;
    select: () => void;
    mode: () => void;
  } | null>(null);
  useEffect(() => {
    const el = host.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e8e8df");
    scene.fog = new THREE.Fog("#e8e8df", 45, 100);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "Interactive 3D space");
    renderer.domElement.dataset.testid = "scene-canvas";
    const camera = new THREE.PerspectiveCamera(37, 1, 0.05, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minDistance = 2;
    controls.maxDistance = 70;
    controls.enablePan = true;
    const hemi = new THREE.HemisphereLight("#fff6e4", "#9a9b87", 2.1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff0d5", 3.5);
    sun.position.set(-3, 13, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -22,
      right: 22,
      top: 22,
      bottom: -22,
      near: 0.5,
      far: 60,
    });
    sun.shadow.normalBias = 0.025;
    sun.shadow.bias = -0.0001;
    sun.shadow.radius = 4;
    scene.add(sun);
    scene.add(sun.target);
    const materials = new Map<string, THREE.MeshStandardMaterial>(),
      geometries = new Map<string, THREE.BufferGeometry>(),
      templates = new Map<string, THREE.Group>(),
      textures: THREE.Texture[] = [];
    const mat = (color: string, roughness = 0.75, metalness = 0) => {
      const key = [color, roughness, metalness].join();
      if (!materials.has(key))
        materials.set(
          key,
          new THREE.MeshStandardMaterial({ color, roughness, metalness }),
        );
      return materials.get(key)!;
    };
    const geom = (key: string, create: () => THREE.BufferGeometry) => {
      if (!geometries.has(key)) geometries.set(key, create());
      return geometries.get(key)!;
    };
    const box = (
      g: THREE.Object3D,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      m: THREE.Material,
      round = 0,
    ) => {
      const geo = round
        ? geom(
            `round-${w}-${h}-${d}-${round}`,
            () => new RoundedBoxGeometry(w, h, d, 2, round),
          )
        : geom("box", () => new THREE.BoxGeometry(1, 1, 1));
      const mesh = new THREE.Mesh(geo, m);
      if (!round) mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const cyl = (
      g: THREE.Object3D,
      r1: number,
      r2: number,
      h: number,
      x: number,
      y: number,
      z: number,
      m: THREE.Material,
    ) => {
      const mesh = new THREE.Mesh(
        geom(
          `cyl-${r1}-${r2}-${h}`,
          () => new THREE.CylinderGeometry(r1, r2, h, 24),
        ),
        m,
      );
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const ball = (
      g: THREE.Object3D,
      r: number,
      x: number,
      y: number,
      z: number,
      m: THREE.Material,
    ) => {
      const mesh = new THREE.Mesh(
        geom("sphere", () => new THREE.SphereGeometry(1, 12, 8)),
        m,
      );
      mesh.scale.setScalar(r);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    function surface(id: string) {
      const key = `finish-${id}`;
      if (materials.has(key)) return materials.get(key)!;
      const spec = MATERIALS.find((m) => m.id === id) || MATERIALS[3];
      const m = new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: spec.roughness,
        metalness: spec.metalness,
      });
      if (spec.pattern !== "plain") {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = spec.color;
        ctx.fillRect(0, 0, 256, 256);
        let seed = 72;
        const rand = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };
        if (spec.pattern === "terrazzo") {
          for (let i = 0; i < 1200; i++) {
            ctx.fillStyle = ["#bab09b", "#eee9dc", "#c4baa6", "#9e9d86"][i % 4];
            const x = rand() * 256,
              y = rand() * 256,
              s = rand() * 2.4 + 0.3;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + s, y + 0.2);
            ctx.lineTo(x + s * 0.7, y + s);
            ctx.lineTo(x - 0.4, y + s * 0.6);
            ctx.fill();
          }
        }
        if (spec.pattern === "wood") {
          for (let i = 0; i < 8; i++) {
            ctx.fillStyle = `rgba(${i % 2 ? 60 : 255},${i % 2 ? 40 : 240},${i % 2 ? 20 : 210},.07)`;
            ctx.fillRect(i * 32, 0, 31, 256);
            ctx.fillStyle = "#9e7c58";
            ctx.fillRect(i * 32, 0, 1, 256);
            ctx.fillRect(i * 32, i % 2 ? 120 : 0, 32, 1);
          }
          for (let i = 0; i < 700; i++) {
            ctx.strokeStyle = `rgba(90,60,30,${rand() * 0.09})`;
            ctx.beginPath();
            const x = rand() * 256,
              y = rand() * 256;
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.3, y + rand() * 70);
            ctx.stroke();
          }
        }
        if (spec.pattern === "tile") {
          ctx.strokeStyle = "#b8b09e";
          ctx.lineWidth = 1.4;
          ctx.strokeRect(0, 0, 256, 256);
          for (let i = 0; i < 5000; i++) {
            ctx.fillStyle = `rgba(80,70,50,${rand() * 0.04})`;
            ctx.fillRect(rand() * 256, rand() * 256, 1, 1);
          }
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(
          spec.pattern === "wood" ? 0.5 : 1,
          spec.pattern === "wood" ? 0.5 : 1,
        );
        tex.anisotropy = 4;
        textures.push(tex);
        m.map = tex;
      }
      materials.set(key, m);
      return m;
    }
    const oak = mat("#b9956b"),
      dark = mat("#3e4239", 0.45, 0.45),
      fabric = mat("#9a9e7e", 0.97),
      stone = mat("#e2dcca"),
      brass = mat("#b39a62", 0.33, 0.65);
    function pot(
      g: THREE.Object3D,
      x: number,
      y: number,
      z: number,
      scale = 1,
    ) {
      const sub = new THREE.Group();
      sub.position.set(x, y, z);
      sub.scale.setScalar(scale);
      cyl(sub, 0.17, 0.125, 0.3, 0, 0.15, 0, mat("#b77f60"));
      cyl(sub, 0.15, 0.15, 0.018, 0, 0.305, 0, mat("#4a4737"));
      cyl(sub, 0.018, 0.025, 0.85, 0, 0.7, 0, mat("#777250"));
      for (let i = 0; i < 15; i++) {
        const a = i * 2.4,
          r = 0.16 + (i % 3) * 0.04,
          h = 0.5 + i * 0.045;
        const leaf = ball(
          sub,
          0.15,
          Math.cos(a) * r,
          h,
          Math.sin(a) * r,
          mat(i % 2 ? "#6e8058" : "#4f684c"),
        );
        leaf.scale.set(0.13, 0.045, 0.25);
        leaf.rotation.set(0.3, a, Math.sin(i) * 0.6);
      }
      g.add(sub);
    }
    function template(id: string) {
      if (templates.has(id)) return templates.get(id)!;
      const g = new THREE.Group(),
        c = CATALOG.find((c) => c.id === id)!,
        m = mat(c.color),
        { width: w, depth: d, height: h } = c;
      if (id === "bistro") {
        cyl(g, w / 2, w / 2, 0.055, 0, h - 0.027, 0, oak);
        cyl(g, 0.038, 0.048, h - 0.08, 0, (h - 0.08) / 2, 0, dark);
        cyl(g, 0.26, 0.28, 0.035, 0, 0.02, 0, dark);
        cyl(g, 0.08, 0.07, 0.1, 0.13, h + 0.05, 0.05, mat("#eae2cc"));
        cyl(g, 0.068, 0.068, 0.003, 0.13, h + 0.102, 0.05, mat("#4f3828"));
        cyl(g, 0.035, 0.045, 0.1, -0.13, h + 0.05, -0.06, stone);
        const stem = box(g, 0.006, 0.14, 0.006, -0.13, h + 0.17, -0.06, fabric);
        stem.rotation.z = 0.2;
        ball(g, 0.045, -0.11, h + 0.22, -0.06, fabric);
      } else if (["chair", "lounge"].includes(id)) {
        const lounge = id === "lounge",
          seatH = lounge ? 0.38 : 0.44;
        box(g, w * 0.9, 0.1, d * 0.83, 0, seatH, 0, m, 0.055);
        box(
          g,
          w * 0.9,
          h - seatH - 0.1,
          0.08,
          0,
          (h + seatH + 0.1) / 2,
          -d * 0.4,
          m,
          0.035,
        );
        for (const x of [-1, 1])
          for (const z of [-1, 1]) {
            const leg = box(
              g,
              0.035,
              seatH,
              0.035,
              x * w * 0.34,
              seatH / 2,
              z * d * 0.31,
              oak,
            );
            leg.rotation.z = -x * 0.055;
          }
        if (lounge)
          for (const x of [-1, 1])
            box(
              g,
              0.07,
              0.08,
              d * 0.88,
              x * w * 0.45,
              seatH + 0.16,
              0,
              oak,
              0.025,
            );
      } else if (id === "banquette") {
        box(g, w, 0.17, d, 0, 0.15, 0, dark);
        box(g, w, 0.19, d * 0.9, 0, 0.44, 0.02, m, 0.035);
        box(g, w, 0.58, 0.17, 0, 0.74, -d * 0.39, m, 0.04);
        for (let x = -w / 2 + 0.15; x < w / 2; x += 0.18)
          box(
            g,
            0.016,
            0.52,
            0.016,
            x,
            0.74,
            -d * 0.285,
            mat("#666f53"),
            0.007,
          );
        for (const x of [-1, 1])
          box(g, 0.12, 0.4, d, x * (w / 2 - 0.06), 0.5, 0, m, 0.03);
      } else if (id === "stool") {
        cyl(g, 0.21, 0.21, 0.075, 0, h - 0.04, 0, oak);
        for (const x of [-1, 1])
          for (const z of [-1, 1])
            box(
              g,
              0.024,
              h - 0.07,
              0.024,
              x * 0.13,
              (h - 0.07) / 2,
              z * 0.13,
              dark,
            );
        box(g, 0.29, 0.02, 0.02, 0, 0.25, 0.14, dark);
      } else if (id === "counter") {
        box(g, w - 0.1, h - 0.08, d - 0.08, 0, (h - 0.08) / 2, 0, m);
        box(g, w + 0.03, 0.075, d + 0.04, 0, h - 0.035, 0, stone, 0.018);
        box(g, w - 0.12, 0.1, d - 0.06, 0, 0.05, 0, dark);
        for (let x = -w / 2 + 0.06; x < w / 2; x += 0.085)
          box(g, 0.04, h - 0.19, 0.025, x, h / 2, d / 2 - 0.026, oak, 0.008);
        box(g, 0.56, 0.36, 0.34, -0.7, h + 0.18, -0.05, dark, 0.025);
        box(g, 0.5, 0.05, 0.43, -0.7, h + 0.04, 0.01, brass);
        for (const x of [-0.8, -0.6])
          cyl(g, 0.05, 0.035, 0.08, x, h + 0.1, 0.18, stone);
        box(g, 0.26, 0.022, 0.22, 0.75, h + 0.02, 0, mat("#626953"));
        pot(g, 1.2, h, 0, 0.3);
      } else if (id === "communal" || id === "bench") {
        box(g, w, 0.07, d, 0, h - 0.035, 0, oak, 0.025);
        for (const x of [-1, 1])
          box(g, 0.1, h - 0.07, d * 0.7, x * w * 0.34, (h - 0.07) / 2, 0, oak);
        if (id === "communal") pot(g, 0, h, 0, 0.35);
      } else if (id === "shelf") {
        for (const x of [-1, 1])
          box(g, 0.05, h, d, x * (w / 2 - 0.025), h / 2, 0, dark);
        for (let i = 0; i < 5; i++) {
          const y = 0.12 + i * 0.46;
          box(g, w, 0.045, d, 0, y, 0, oak);
          for (let j = 0; j < 4; j++) {
            const x = -w * 0.35 + j * w * 0.23;
            if ((i + j) % 3 === 0) {
              for (let k = 0; k < 3; k++)
                box(
                  g,
                  0.045,
                  0.23 + k * 0.015,
                  0.18,
                  x + k * 0.05,
                  y + 0.14,
                  0,
                  mat(["#898a71", "#c0ad91", "#e3d7bc"][k]),
                );
            } else if ((i + j) % 3 === 1)
              cyl(g, 0.08, 0.065, 0.16, x, y + 0.1, 0, stone);
            else if (i > 1) pot(g, x, y + 0.025, 0, 0.2);
          }
        }
      } else if (id === "rack") {
        box(g, w, 0.06, d, 0, 0.035, 0, oak, 0.025);
        for (const x of [-1, 1])
          box(g, 0.028, h, 0.028, x * w * 0.46, h / 2, 0, dark);
        box(g, w, 0.028, 0.028, 0, h - 0.03, 0, dark);
        for (let i = 0; i < 6; i++) {
          const x = -0.4 + i * 0.16;
          box(
            g,
            0.12,
            0.6,
            0.25,
            x,
            h - 0.42,
            0,
            mat(["#ded6c6", "#989d87", "#bd947a"][i % 3]),
            0.018,
          );
        }
      } else if (id === "partition") {
        for (let x = -w / 2; x <= w / 2; x += 0.115)
          box(g, 0.045, h, 0.09, x, h / 2, 0, oak);
        box(g, w + 0.1, 0.06, 0.36, 0, 0.03, 0, dark);
      } else if (id === "plant") pot(g, 0, 0, 0, 1.4);
      else if (id === "rug") box(g, w, h, d, 0, 0.01, 0, m, 0.005);
      else if (id === "lamp") {
        cyl(g, 0.2, 0.2, 0.035, 0, 0.02, 0, brass);
        cyl(g, 0.018, 0.018, 1.43, 0, 0.75, 0, brass);
        const glow = mat("#fff2d5");
        glow.emissive.set("#f0c687");
        glow.emissiveIntensity = 0.35;
        ball(g, 0.2, 0, 1.48, 0, glow);
      } else {
        box(g, w, h - 0.07, d, 0, (h + 0.07) / 2, 0, m, 0.015);
        box(g, w * 0.8, 0.07, d * 0.8, 0, 0.035, 0, dark);
        if (id === "pedestal") {
          cyl(g, 0.13, 0.1, 0.25, 0, h + 0.125, 0, mat("#9b7961"));
          ball(g, 0.12, 0, h + 0.28, 0, mat("#c5ac89"));
        }
      }
      // Merge immutable catalog parts by material once. Instances reuse these GPU
      // buffers; moving a chair never allocates another chair's worth of geometry.
      g.updateMatrixWorld(true);
      const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const geo = (
            o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
          ).applyMatrix4(o.matrixWorld);
          const m = o.material as THREE.Material;
          if (!batches.has(m)) batches.set(m, []);
          batches.get(m)!.push(geo);
        }
      });
      const merged = new THREE.Group();
      for (const [m, parts] of batches) {
        const geo = mergeGeometries(parts)!;
        geometries.set(`template-${id}-${m.uuid}`, geo);
        parts.forEach((p) => p.dispose());
        const mesh = new THREE.Mesh(geo, m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        merged.add(mesh);
      }
      templates.set(id, merged);
      return merged;
    }
    const ground = new THREE.Mesh(
      geom("ground", () => new THREE.PlaneGeometry(200, 200)),
      mat("#e0e2d7", 1),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.19;
    ground.receiveShadow = true;
    scene.add(ground);
    let content = new THREE.Group();
    scene.add(content);
    let outlines = new THREE.Group();
    scene.add(outlines);
    let editMs = 0,
      frameTimes: number[] = [],
      last = performance.now(),
      frames = 0,
      raf = 0,
      walkYaw = 0,
      walkPitch = 0;
    const keys = new Set<string>();
    const disposeGroup = (g: THREE.Group) =>
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (o instanceof THREE.InstancedMesh) o.dispose();
        if (m.geometry?.userData.temporary) m.geometry.dispose();
        if (m.userData.temporaryMaterial) {
          const ms = Array.isArray(m.material) ? m.material : [m.material];
          ms.forEach((m) => m?.dispose());
        }
      });
    const temporary = (geo: THREE.BufferGeometry) => {
      geo.userData.temporary = true;
      return geo;
    };
    function rebuild() {
      const start = performance.now(),
        d = current.current.design,
        isWalk = current.current.mode === "walk";
      scene.remove(content);
      disposeGroup(content);
      content = new THREE.Group();
      scene.add(content);
      renderer.toneMappingExposure = d.lighting.exposure;
      hemi.intensity = 0.9 + d.lighting.daylight * 1.1;
      sun.intensity = d.lighting.daylight * 3.1;
      for (const r of detectRooms(d)) {
        const shape = new THREE.Shape(
          r.points.map((p) => new THREE.Vector2(p.x, -p.y)),
        );
        const geo = temporary(
          new THREE.ExtrudeGeometry(shape, {
            depth: 0.13,
            bevelEnabled: false,
          }),
        );
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, -0.13, 0);
        const mesh = new THREE.Mesh(geo, surface(d.floorMaterial));
        mesh.receiveShadow = true;
        mesh.userData.entityId = r.id;
        content.add(mesh);
      }
      const wallMats = [...new Set(d.walls.map((w) => surface(w.material)))];
      for (const layer of wallLayers(d, !isWalk))
        for (const poly of layer.polygons) {
          const shape = new THREE.Shape(
            poly[0].map((p) => new THREE.Vector2(p[0], -p[1])),
          );
          for (const hole of poly.slice(1))
            shape.holes.push(
              new THREE.Path(hole.map((p) => new THREE.Vector2(p[0], -p[1]))),
            );
          const geo = temporary(
            new THREE.ExtrudeGeometry(shape, {
              depth: layer.top - layer.bottom,
              bevelEnabled: false,
            }),
          );
          geo.rotateX(-Math.PI / 2);
          geo.translate(0, layer.bottom, 0);
          geo.clearGroups();
          const a = geo.attributes.position;
          for (let i = 0; i < a.count; i += 3) {
            const p = {
              x: (a.getX(i) + a.getX(i + 1) + a.getX(i + 2)) / 3,
              y: (a.getZ(i) + a.getZ(i + 1) + a.getZ(i + 2)) / 3,
            };
            let best = 0,
              dist = Infinity;
            d.walls.forEach((w) => {
              const n = distance(p, projectPoint(p, ...wallPoints(d, w)));
              if (n < dist) {
                dist = n;
                best = wallMats.indexOf(surface(w.material));
              }
            });
            const last = geo.groups.at(-1);
            if (last && last.materialIndex === best) last.count += 3;
            else geo.addGroup(i, 3, best);
          }
          const mesh = new THREE.Mesh(geo, wallMats);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.wallUnion = true;
          content.add(mesh);
        }
      const front = Math.max(0, ...d.vertices.map((v) => v.y)),
        right = Math.max(0, ...d.vertices.map((v) => v.x));
      for (const o of d.openings) {
        const p = openingPose(d, o),
          w = d.walls.find((w) => w.id === o.wallId)!,
          cut =
            !isWalk &&
            (wallPoints(d, w).every((p) => Math.abs(p.y - front) < 0.01) ||
              wallPoints(d, w).every((p) => Math.abs(p.x - right) < 0.01));
        const g = new THREE.Group();
        g.position.set(p.x, 0, p.y);
        g.rotation.y = -p.rotation;
        g.userData.entityId = o.id;
        if (o.type === "door") {
          const leaf = new THREE.Group();
          leaf.rotation.y = (-o.angle * Math.PI) / 180;
          box(
            leaf,
            o.width,
            0.0 + o.height,
            0.045,
            o.width / 2,
            o.height / 2,
            0,
            oak,
          );
          box(leaf, 0.018, 0.22, 0.05, o.width - 0.1, 1, 0.043, brass);
          g.add(leaf);
          if (!cut) {
            for (const x of [0, o.width])
              box(g, 0.045, o.height, 0.065, x, o.height / 2, 0, oak);
            box(g, o.width + 0.08, 0.055, 0.065, o.width / 2, o.height, 0, oak);
          }
        } else if (!cut) {
          for (const x of [0, o.width / 2, o.width])
            box(
              g,
              0.04,
              o.height,
              0.08,
              x,
              o.sill + o.height / 2,
              0,
              mat("#e6e1d4"),
            );
          for (const y of [o.sill, o.sill + o.height])
            box(g, o.width + 0.06, 0.055, 0.12, o.width / 2, y, 0, stone);
          const glass = mat("#afc6c0", 0.15, 0.05);
          glass.transparent = true;
          glass.opacity = 0.26;
          glass.depthWrite = false;
          box(
            g,
            o.width,
            0.0 + o.height,
            0.014,
            o.width / 2,
            o.sill + o.height / 2,
            0,
            glass,
          );
        }
        g.traverse((obj) => (obj.userData.entityId = o.id));
        content.add(g);
      }
      for (const catalogId of new Set(d.furniture.map((f) => f.catalogId))) {
        const c = CATALOG.find((c) => c.id === catalogId)!,
          items = d.furniture.filter((f) => f.catalogId === catalogId),
          source = template(catalogId);
        for (const part of source.children) {
          const mesh = part as THREE.Mesh,
            instances = new THREE.InstancedMesh(
              mesh.geometry,
              mesh.material,
              items.length,
            ),
            transform = new THREE.Object3D();
          items.forEach((f, i) => {
            const s = furnitureSize(f);
            transform.position.set(f.x, 0.012, f.y);
            transform.rotation.set(0, (-f.rotation * Math.PI) / 180, 0);
            transform.scale.set(
              s.width / c.width,
              s.height / c.height,
              s.depth / c.depth,
            );
            transform.updateMatrix();
            instances.setMatrixAt(i, transform.matrix);
          });
          instances.userData.instanceIds = items.map((f) => f.id);
          instances.instanceMatrix.needsUpdate = true;
          instances.computeBoundingSphere();
          instances.castShadow = true;
          instances.receiveShadow = true;
          content.add(instances);
        }
      }
      for (const l of d.lights) {
        const g = new THREE.Group();
        g.position.set(l.x, l.height, l.y);
        const shade = cyl(
          g,
          0.09,
          0.24,
          0.16,
          0,
          0,
          0,
          mat("#bca478", 0.4, 0.4),
        );
        shade.userData.entityId = l.id;
        const glow = new THREE.MeshStandardMaterial({
          color: l.color,
          emissive: l.color,
          emissiveIntensity: d.lighting.interior,
        });
        cyl(
          g,
          0.205,
          0.205,
          0.015,
          0,
          -0.075,
          0,
          glow,
        ).userData.temporaryMaterial = true;
        const cord = Math.max(
          0.05,
          Math.max(3, ...d.walls.map((w) => w.height)) - l.height,
        );
        box(g, 0.009, cord, 0.009, 0, cord / 2, 0, dark);
        const light = new THREE.PointLight(
          l.color,
          l.intensity * d.lighting.interior,
          9,
          2,
        );
        light.position.y = -0.14;
        g.add(light);
        g.traverse((o) => (o.userData.entityId = l.id));
        content.add(g);
      }
      renderer.shadowMap.needsUpdate = true;
      select();
      editMs = performance.now() - start;
    }
    function select() {
      scene.remove(outlines);
      outlines.traverse((o) => {
        const l = o as THREE.LineSegments;
        l.geometry?.dispose();
        if (l.material) (l.material as THREE.Material).dispose();
      });
      outlines = new THREE.Group();
      scene.add(outlines);
      for (const id of current.current.selectedIds) {
        const object = content.children.find(
          (o) =>
            o.userData.entityId === id ||
            o.children.some((c) => c.userData.entityId === id),
        );
        if (object) {
          const box = new THREE.BoxHelper(object, "#ed955c");
          outlines.add(box);
        } else {
          const d = current.current.design,
            w = d.walls.find((w) => w.id === id),
            f = d.furniture.find((f) => f.id === id);
          if (f) {
            const s = furnitureSize(f),
              box = new THREE.Box3Helper(
                new THREE.Box3(
                  new THREE.Vector3(-s.width / 2, 0, -s.depth / 2),
                  new THREE.Vector3(s.width / 2, s.height, s.depth / 2),
                ),
                new THREE.Color("#ed955c"),
              );
            const g = new THREE.Group();
            g.position.set(f.x, 0.012, f.y);
            g.rotation.y = (-f.rotation * Math.PI) / 180;
            g.add(box);
            outlines.add(g);
          }
          if (w) {
            const [a, b] = wallPoints(d, w);
            const points = [
              new THREE.Vector3(a.x, 0.2, a.y),
              new THREE.Vector3(b.x, 0.2, b.y),
            ];
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(points),
              new THREE.LineBasicMaterial({
                color: "#e68b55",
                depthTest: false,
              }),
            );
            line.renderOrder = 999;
            outlines.add(line);
          }
        }
      }
      outlines.visible = !current.current.presentation;
    }
    function reset() {
      const d = current.current.design,
        vs = d.vertices.length
          ? d.vertices
          : [
              { x: 0, y: 0 },
              { x: 10, y: 8 },
            ];
      const minX = Math.min(...vs.map((v) => v.x)),
        maxX = Math.max(...vs.map((v) => v.x)),
        minY = Math.min(...vs.map((v) => v.y)),
        maxY = Math.max(...vs.map((v) => v.y)),
        cx = (minX + maxX) / 2,
        cy = (minY + maxY) / 2,
        s = Math.max(maxX - minX, maxY - minY, 6);
      controls.target.set(cx, 0.65, cy);
      camera.position.set(cx + s * 0.9, s * 1.04, cy + s * 1.16);
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
      for (let i = 0; i < 3; i++) {
        const points = vs
          .flatMap((v) => [
            new THREE.Vector3(v.x, 0, v.y),
            new THREE.Vector3(v.x, 3, v.y),
          ])
          .map((v) => v.project(camera));
        const scale = Math.max(
          1,
          ...points.map((p) =>
            Math.max(Math.abs(p.x) / 0.9, Math.abs(p.y) / 0.86),
          ),
        );
        if (scale <= 1) break;
        camera.position
          .sub(controls.target)
          .multiplyScalar(scale)
          .add(controls.target);
        camera.updateMatrixWorld();
      }
      controls.update();
    }
    function recover() {
      const d = current.current.design,
        rooms = detectRooms(d);
      const candidates = rooms.flatMap((r) => {
        const minX = Math.min(...r.points.map((p) => p.x)),
          maxX = Math.max(...r.points.map((p) => p.x)),
          minY = Math.min(...r.points.map((p) => p.y)),
          maxY = Math.max(...r.points.map((p) => p.y)),
          p = [];
        for (let y = maxY - 0.8; y > minY; y -= 0.4)
          for (let x = (minX + maxX) / 2; x < maxX; x += 0.4)
            if (pointInside({ x, y }, r.points)) p.push({ x, y });
        return p;
      });
      const p = candidates.find((p) => canOccupy(d, p)) || { x: -1, y: -1 };
      camera.position.set(p.x, 1.65, p.y);
      walkYaw = 0;
      walkPitch = 0;
      camera.rotation.order = "YXZ";
      camera.rotation.set(0, 0, 0);
    }
    function mode() {
      const walk = current.current.mode === "walk";
      controls.enabled = !walk;
      if (walk) recover();
      else {
        if (document.pointerLockElement === renderer.domElement)
          document.exitPointerLock();
        reset();
      }
      rebuild();
    }
    const api: SceneAPI = {
      reset,
      capture: () => {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL("image/png");
      },
      getView: () => ({
        position: camera.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
      }),
      setView: (v) => {
        camera.position.fromArray(v.position);
        controls.target.fromArray(v.target);
        camera.lookAt(controls.target);
        if (current.current.mode === "walk") {
          camera.rotation.order = "YXZ";
          walkYaw = camera.rotation.y;
          walkPitch = camera.rotation.x;
        } else controls.update();
      },
      recover,
      stats: () => ({
        frames,
        frameTimes: [...frameTimes],
        editMs,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        triangles: renderer.info.render.triangles,
        drawCalls: renderer.info.render.calls,
        camera: camera.position.toArray(),
        mode: current.current.mode,
        renderer: renderer
          .getContext()
          .getParameter(renderer.getContext().RENDERER),
      }),
      probe: (from, to) => {
        content.updateMatrixWorld(true);
        const a = new THREE.Vector3(...from),
          b = new THREE.Vector3(...to),
          ray = new THREE.Raycaster(
            a,
            b.clone().sub(a).normalize(),
            0,
            a.distanceTo(b),
          );
        return ray.intersectObjects(content.children, true).map((h) => ({
          wall: !!h.object.userData.wallUnion,
          entityId:
            h.instanceId !== undefined
              ? h.object.userData.instanceIds[h.instanceId]
              : h.object.userData.entityId || null,
          distance: h.distance,
        }));
      },
    };
    current.current.apiRef.current = api;
    let initialSize = true;
    const resize = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      if (initialSize) {
        reset();
        initialSize = false;
      }
    });
    resize.observe(el);
    const ray = new THREE.Raycaster();
    let down = { x: 0, y: 0 };
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const click = (e: MouseEvent) => {
      if (current.current.mode === "walk") {
        renderer.domElement.requestPointerLock()?.catch(() => {});
        return;
      }
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hits = ray.intersectObjects(content.children, true);
      for (const hit of hits) {
        let id =
          hit.instanceId !== undefined
            ? hit.object.userData.instanceIds[hit.instanceId]
            : hit.object.userData.entityId;
        if (hit.object.userData.wallUnion) {
          const p = { x: hit.point.x, y: hit.point.z },
            d = current.current.design;
          id = [...d.walls].sort(
            (a, b) =>
              distance(p, projectPoint(p, ...wallPoints(d, a))) -
              distance(p, projectPoint(p, ...wallPoints(d, b))),
          )[0]?.id;
        }
        if (id) {
          current.current.onSelect(id, e.shiftKey);
          return;
        }
      }
      current.current.onSelect("");
    };
    let ignoreFirstLockedMove = true;
    const lockChange = () => {
      ignoreFirstLockedMove = true;
    };
    const mouse = (e: MouseEvent) => {
      if (document.pointerLockElement === renderer.domElement) {
        if (ignoreFirstLockedMove) {
          ignoreFirstLockedMove = false;
          return;
        }
        walkYaw -= e.movementX * 0.002;
        walkPitch = Math.max(
          -1.3,
          Math.min(1.3, walkPitch - e.movementY * 0.002),
        );
      }
    };
    const keyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Escape" &&
        document.pointerLockElement === renderer.domElement
      )
        document.exitPointerLock();
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      keys.add(e.code);
      if (
        current.current.mode === "walk" &&
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Space",
        ].includes(e.code)
      )
        e.preventDefault();
    };
    const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const blur = () => keys.clear();
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("click", click);
    document.addEventListener("mousemove", mouse);
    document.addEventListener("pointerlockchange", lockChange);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now(),
        elapsed = now - last,
        dt = Math.min(elapsed / 1000, 0.05);
      last = now;
      if (frames > 10) {
        frameTimes.push(elapsed);
        if (frameTimes.length > 240) frameTimes.shift();
      }
      frames++;
      if (current.current.mode === "walk") {
        camera.rotation.order = "YXZ";
        camera.rotation.set(walkPitch, walkYaw, 0);
        let x =
            (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
            (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
          z =
            (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) -
            (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
        const len = Math.hypot(x, z) || 1,
          speed = (keys.has("ShiftLeft") ? 3 : 1.8) * dt;
        const dx =
            ((x / len) * Math.cos(walkYaw) + (z / len) * Math.sin(walkYaw)) *
            speed,
          dz =
            ((-x / len) * Math.sin(walkYaw) + (z / len) * Math.cos(walkYaw)) *
            speed;
        const d = current.current.design,
          p = { x: camera.position.x, y: camera.position.z };
        if (canWalk(d, p, { x: p.x + dx, y: p.y })) camera.position.x += dx;
        const q = { x: camera.position.x, y: camera.position.z };
        if (canWalk(d, q, { x: q.x, y: q.y + dz })) camera.position.z += dz;
        camera.position.y = 1.65;
      } else controls.update();
      renderer.render(scene, camera);
    };
    engine.current = { rebuild, select, mode };
    rebuild();
    reset();
    animate();
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      controls.dispose();
      document.removeEventListener("mousemove", mouse);
      document.removeEventListener("pointerlockchange", lockChange);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("click", click);
      disposeGroup(content);
      outlines.traverse((o) => {
        const l = o as THREE.LineSegments;
        l.geometry?.dispose();
        if (l.material) (l.material as THREE.Material).dispose();
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      renderer.dispose();
      el.removeChild(renderer.domElement);
      current.current.apiRef.current = null;
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    engine.current?.rebuild();
  }, [props.design]);
  useEffect(() => {
    engine.current?.select();
  }, [props.selectedIds, props.presentation]);
  useEffect(() => {
    engine.current?.mode();
  }, [props.mode]);
  return <div className="scene-host" ref={host} />;
}
