import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Obstacle } from "./physics";

export type EnvironmentId = "yard" | "meadow" | "circuit";
export const ENVIRONMENTS = {
  yard: {
    name: "The Yard",
    subtitle: "Abandoned industrial park",
    tag: "FREE EXPLORATION",
    difficulty: "All skill levels",
    area: "180 × 180 m",
    description:
      "Wide-open concrete, loading bays, and container gaps. Your everyday proving ground.",
  },
  meadow: {
    name: "Open Range",
    subtitle: "Alpine meadow",
    tag: "LEARN THE BASICS",
    difficulty: "Beginner friendly",
    area: "300 × 300 m",
    description:
      "Room to breathe. Practice hovering, coordinated turns, and your first Acro flights.",
  },
  circuit: {
    name: "The Circuit",
    subtitle: "Purpose-built race course",
    tag: "PRECISION PRACTICE",
    difficulty: "Intermediate",
    area: "180 × 180 m",
    description:
      "An eight-gate practice loop. Find your line and work on smooth, repeatable laps.",
  },
} as const;

export interface PracticeWorld {
  scene: THREE.Scene;
  drone: THREE.Group;
  propellers: THREE.Mesh[];
  obstacles: Obstacle[];
  gates: THREE.Vector3[];
  dispose: () => void;
}

function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function createWorld(
  environment: EnvironmentId,
  quality: "high" | "balanced" = "high",
): PracticeWorld {
  const random = seededRandom(184);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#c8d4d7");
  scene.fog = new THREE.FogExp2("#c5cfcb", 0.0018);
  const obstacles: Obstacle[] = [];
  const gates: THREE.Vector3[] = [];
  const propellers: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  const material = (
    color: string | number,
    roughness = 0.85,
    metalness = 0,
  ) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materials.push(m);
    return m;
  };
  const concreteTexture = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = "#c0beb0";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 20000; i++) {
      const shade = random() > 0.5 ? 40 : 245;
      ctx.fillStyle = `rgba(${shade},${shade},${shade},${random() * 0.1})`;
      ctx.fillRect(
        random() * 512,
        random() * 512,
        random() * 3 + 1,
        random() * 3 + 1,
      );
    }
    for (let i = 0; i < 85; i++) {
      const x = random() * 512,
        length = 80 + random() * 400;
      const gradient = ctx.createLinearGradient(x, 0, x, length);
      gradient.addColorStop(0, "rgba(55,60,42,.16)");
      gradient.addColorStop(1, "rgba(55,60,42,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, 0, random() * 4 + 1, length);
    }
    ctx.fillStyle = "rgba(70,77,48,.08)";
    ctx.fillRect(0, 470, 512, 42);
  });
  const concrete = new THREE.MeshStandardMaterial({
    map: concreteTexture,
    roughness: 1,
    color: "#b8b9a9",
  });
  const darkMetal = material("#3e4643", 0.65, 0.45);
  const orange = material("#e77b44", 0.72, 0.1);
  const white = material("#dad9cb");
  const roofMat = material("#6e7773", 0.68, 0.4);
  const glass = material("#647b7d", 0.25, 0.55);
  const collider = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => {
    obstacles.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    });
  };
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    solid = false,
    parent: THREE.Object3D = scene,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (solid) collider(x, y, z, w, h, d);
    return mesh;
  };

  const hemi = new THREE.HemisphereLight("#dce6ed", "#6f7057", 2.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff0d2", 3.6);
  sun.position.set(-65, 95, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(
    quality === "high" ? 4096 : 2048,
    quality === "high" ? 4096 : 2048,
  );
  Object.assign(sun.shadow.camera, {
    left: -110,
    right: 110,
    top: 100,
    bottom: -100,
    near: 1,
    far: 300,
  });
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.00015;
  sun.shadow.radius = 2;
  sun.target.position.set(0, 0, -15);
  scene.add(sun, sun.target);
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 3.5;
  uniforms.rayleigh.value = 1.4;
  uniforms.mieCoefficient.value = 0.003;
  uniforms.mieDirectionalG.value = 0.8;
  uniforms.sunPosition.value.copy(sun.position);
  scene.add(sky);

  const grassTexture = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = "#767c54";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 55000; i++) {
      const n = Math.floor(random() * 55);
      ctx.fillStyle = `rgba(${75 + n},${78 + n},${47 + n * 0.65},${random() * 0.5})`;
      ctx.fillRect(
        random() * 512,
        random() * 512,
        random() * 3 + 1,
        random() * 5 + 1,
      );
    }
  });
  grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(110, 110);
  const grass = new THREE.MeshStandardMaterial({
    map: grassTexture,
    roughness: 1,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.position.y = -0.035;
  scene.add(ground);

  const rockTexture = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = "#b7b8a5";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8000; i++) {
      const x = random() * 512,
        y = random() * 512,
        size = 1 + random() * 24;
      ctx.fillStyle =
        random() > 0.35
          ? `rgba(60,65,48,${random() * 0.05})`
          : `rgba(231,228,203,${random() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(x, y, size * 0.3, size, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  rockTexture.wrapS = rockTexture.wrapT = THREE.RepeatWrapping;
  rockTexture.repeat.set(8, 3);
  // High-resolution ridges and textured foliage keep the skyline natural without external assets.
  for (let ridge = 0; ridge < 3; ridge++) {
    const geo = new THREE.PlaneGeometry(2100, 500, 140, 45);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i);
      const cross = Math.sin(((z + 250) / 500) * Math.PI);
      const peak =
        125 +
        ridge * 45 +
        Math.sin(x * 0.006 + ridge * 1.8) * 65 +
        Math.sin(x * 0.015 + 2) * 25;
      const h = Math.max(0, cross * peak + (random() - 0.5) * 15 * cross);
      pos.setY(i, h);
      const color = new THREE.Color(
        ridge === 0 ? "#5c6a59" : ridge === 1 ? "#7f8c80" : "#9caaa2",
      );
      color.multiplyScalar(0.86 + random() * 0.25 + h / 900);
      colors.push(color.r, color.g, color.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mountain = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: rockTexture,
        roughness: 1,
      }),
    );
    mountain.position.set(ridge * 100 - 130, -8, -450 - ridge * 240);
    mountain.receiveShadow = true;
    scene.add(mountain);
  }

  const treeTexture = canvasTexture(512, 1024, (ctx) => {
    const needle = (x: number, y: number, size: number, shade: number) => {
      ctx.strokeStyle = `rgb(${Math.round(31 + shade * 29)},${Math.round(44 + shade * 36)},${Math.round(30 + shade * 21)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let n = 0; n < 15; n++) {
        const angle = random() * Math.PI * 2,
          length = size * (0.3 + random() * 0.7);
        ctx.moveTo(x, y);
        ctx.lineTo(
          x + Math.cos(angle) * length,
          y + Math.sin(angle) * length * 0.5 - 2,
        );
      }
      ctx.stroke();
    };
    ctx.fillStyle = "#554d39";
    ctx.beginPath();
    ctx.moveTo(250, 1000);
    ctx.lineTo(257, 34);
    ctx.lineTo(266, 1000);
    ctx.fill();
    for (let level = 0; level < 36; level++) {
      const y = 890 - level * 23.5;
      const width = (y / 900) ** 1.1 * 218 * (0.65 + random() * 0.45);
      for (const side of [-1, 1]) {
        const endX = 256 + width * side,
          endY = y + random() * 17 - 16;
        ctx.strokeStyle = "#414735";
        ctx.lineWidth = Math.max(1, width * 0.016);
        ctx.beginPath();
        ctx.moveTo(257, y - 16);
        ctx.quadraticCurveTo(256 + width * side * 0.55, y + 9, endX, endY);
        ctx.stroke();
        for (let j = 0; j < 18; j++) {
          const t = j / 18,
            x = 256 + width * side * t,
            by = y - 9 + Math.sin(t * Math.PI) * 10;
          const twig = (1 - t) * (13 + random() * 19) + 3;
          for (let k = 0; k < 3; k++) {
            const ty = by - (twig * k) / 3;
            needle(
              x + side * k * 1.5,
              ty,
              6 + (1 - t) * 8,
              random() * 0.65 + (side < 0 ? 0.3 : 0),
            );
          }
        }
      }
      for (let j = 0; j < 10; j++)
        needle(
          256 + (random() - 0.5) * width,
          y + random() * 16,
          8 + random() * 7,
          random() * 0.65,
        );
    }
  });
  const count = quality === "high" ? 950 : 480;
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.15, 0.3, 1, 5),
    material("#594f3b"),
    count,
  );
  const foliageGeo = new THREE.PlaneGeometry(1, 1);
  const foliageMat = new THREE.MeshStandardMaterial({
    map: treeTexture,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, count * 2);
  const transform = new THREE.Object3D();
  const treeColor = new THREE.Color();
  for (let i = 0; i < count; i++) {
    let x = (random() - 0.5) * 760;
    let z = random() * -410 + 140;
    if (Math.abs(x) < 100 && z > -110 && z < 100) {
      x = (x < 0 ? -1 : 1) * (105 + random() * 70);
    }
    const h = 8 + random() * 17,
      radius = h * (0.19 + random() * 0.065);
    if (Math.abs(x) < 230 && Math.abs(z) < 230)
      collider(x, h * 0.35, z, 0.65, h * 0.7, 0.65);
    transform.position.set(x, h * 0.32, z);
    transform.scale.set(1, h * 0.65, 1);
    transform.rotation.set(0, random() * 6, 0);
    transform.updateMatrix();
    trunk.setMatrixAt(i, transform.matrix);
    treeColor.setRGB(
      0.8 + random() * 0.3,
      0.85 + random() * 0.25,
      0.75 + random() * 0.25,
    );
    const rotation = random() * Math.PI;
    for (let j = 0; j < 2; j++) {
      transform.position.set(x, h * 0.5, z);
      transform.rotation.set(0, rotation + (j * Math.PI) / 2, 0);
      transform.scale.set(radius * 2, h, 1);
      transform.updateMatrix();
      foliage.setMatrixAt(i * 2 + j, transform.matrix);
      foliage.setColorAt(i * 2 + j, treeColor);
    }
  }
  trunk.castShadow = true;
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  scene.add(trunk, foliage);

  const apronTexture = canvasTexture(2048, 2048, (ctx) => {
    ctx.fillStyle = "#a5a69d";
    ctx.fillRect(0, 0, 2048, 2048);
    for (let i = 0; i < 150000; i++) {
      const v = random() > 0.5 ? 25 : 245;
      ctx.fillStyle = `rgba(${v},${v},${v},${random() * 0.075})`;
      const s = random() * 3 + 1;
      ctx.fillRect(random() * 2048, random() * 2048, s, s);
    }
    ctx.strokeStyle = "#83867c";
    ctx.lineWidth = 1;
    for (let i = 0; i < 2048; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 2048);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(2048, i);
      ctx.stroke();
    }
    for (let i = 0; i < 85; i++) {
      let x = random() * 2048,
        y = random() * 2048;
      ctx.strokeStyle = "rgba(67,70,61,0.2)";
      ctx.lineWidth = random() * 1.5 + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += random() * 30 - 15;
        y += random() * 25;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "#d8d4bc";
    ctx.lineWidth = 4;
    ctx.strokeRect(125, 130, 1790, 1790);
    ctx.strokeStyle = "rgba(232,229,208,0.8)";
    ctx.lineWidth = 5;
    ctx.setLineDash([30, 30]);
    ctx.beginPath();
    ctx.moveTo(1024, 80);
    ctx.lineTo(1024, 2048);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#c9b475";
    ctx.lineWidth = 4;
    for (let i = 0; i < 10; i++) {
      ctx.strokeRect(1440, 350 + i * 95, 365, 95);
    }
    ctx.fillStyle = "rgba(227,225,203,0.78)";
    ctx.font = "bold 60px Arial";
    ctx.save();
    ctx.translate(920, 600);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("KEEP CLEAR", 0, 0);
    ctx.restore();
    ctx.strokeStyle = "rgba(41,44,39,0.11)";
    ctx.lineWidth = 7;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.ellipse(600, 1450, 245 + i * 3, 135 + i * 2, -0.7, 0, 5);
      ctx.stroke();
    }
  });
  if (environment !== "meadow") {
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 170),
      new THREE.MeshStandardMaterial({ map: apronTexture, roughness: 0.96 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, 0.003, -10);
    apron.receiveShadow = true;
    scene.add(apron);
  }

  const sign = (
    text: string,
    sub: string,
    w: number,
    h: number,
    color = "#e4e2d5",
    bg = "#303a35",
  ) =>
    canvasTexture(1024, 256, (ctx) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1024, 256);
      ctx.fillStyle = color;
      ctx.font = "bold 103px Arial";
      ctx.textAlign = "center";
      ctx.fillText(text, 512, sub ? 143 : 162);
      if (sub) {
        ctx.font = "24px monospace";
        ctx.fillText(sub, 512, 202);
      }
      void w;
      void h;
    });
  const placard = (
    text: string,
    sub: string,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: sign(text, sub, w, h),
        roughness: 0.9,
      }),
    );
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  };

  if (environment === "yard") {
    // Hangar walls are separate colliders so the open loading bay is flyable.
    const hx = 27,
      hz = -40;
    box(37, 10, 0.45, hx, 5, hz - 13, concrete, true);
    box(0.5, 10, 26, hx - 18.5, 5, hz, concrete, true);
    box(0.5, 10, 26, hx + 18.5, 5, hz, concrete, true);
    box(37, 2.5, 0.5, hx, 8.75, hz + 13, concrete, true);
    for (const dx of [-16, -6, 5, 16])
      box(2, 7.5, 0.6, hx + dx, 3.75, hz + 13, concrete, true);
    box(8, 6.8, 0.35, hx - 11, 3.4, hz + 13.1, roofMat, true);
    box(9, 6.8, 0.35, hx + 10.5, 3.4, hz + 13.1, roofMat, true);
    for (let j = 0; j < 26; j++) {
      box(7.7, 0.05, 0.1, hx - 11, 0.15 + j * 0.25, hz + 13.32, darkMetal);
      box(8.6, 0.05, 0.1, hx + 10.5, 0.15 + j * 0.25, hz + 13.32, darkMetal);
    }
    box(37.8, 0.35, 28, hx, 10.1, hz, roofMat, true);
    for (let j = 0; j < 53; j++)
      box(0.07, 0.08, 28, hx - 18.5 + j * 0.7, 10.31, hz, darkMetal);
    for (let j = 0; j < 5; j++)
      box(4, 0.1, 6, hx - 13 + j * 6.5, 10.34, hz, glass);
    placard(
      "FIELDWORK",
      "FLIGHT TEST FACILITY  /  01",
      15,
      3.2,
      hx,
      11.7,
      hz + 13.32,
    );
    box(15.2, 3.4, 0.25, hx, 11.7, hz + 13.1, darkMetal, true);
    // A smaller weathered workshop gives the yard a human scale.
    box(20, 5.5, 14, -39, 2.75, -52, concrete, true);
    box(21, 0.4, 15, -39, 5.7, -52, roofMat, true);
    for (let i = 0; i < 5; i++) {
      box(2.2, 1.3, 0.1, -46 + i * 3.3, 3.3, -44.94, glass);
    }
    placard("SECTOR 01", "", 6, 1.5, -39, 1.2, -44.9);
    const container = (
      x: number,
      z: number,
      color: string,
      stacked = false,
    ) => {
      const m = material(color, 0.8, 0.35);
      const y = stacked ? 4.05 : 1.35;
      box(11.7, 2.7, 3, x, y, z, m, true);
      for (let j = 0; j < 34; j++) {
        box(0.06, 2.55, 0.09, x - 5.65 + j * 0.34, y, z + 1.52, m);
        box(0.06, 2.55, 0.09, x - 5.65 + j * 0.34, y, z - 1.52, m);
      }
      box(11.8, 0.09, 3.1, x, y + 1.37, z, m);
      for (const dx of [-5.8, 5.8]) box(0.15, 2.8, 3.1, x + dx, y, z, m);
      const mark = placard(
        "FW / 024",
        "",
        2.2,
        0.58,
        x + 3.5,
        y + 0.2,
        z + 1.575,
      );
      mark.material = new THREE.MeshStandardMaterial({
        map: sign("FW / 024", "", 2.2, 0.58, "#d7d4bf", color),
      });
    };
    container(-23, -12, "#58675a");
    container(-24, -17, "#8e5540");
    container(-24, -17, "#53645f", true);
    container(28, 7, "#92583f");
    container(41, 7, "#606e62");
    container(-45, 16, "#747d73");
    // Concrete barriers and bollards also participate in contact physics.
    for (let i = 0; i < 8; i++) {
      const x = -58 + i * 7;
      box(4.5, 0.95, 0.65, x, 0.475, 43, concrete, true);
      box(4.5, 0.12, 0.7, x, 0.72, 43, white);
    }
    for (const x of [14, 24, 35, 42])
      box(0.23, 1.2, 0.23, x, 0.6, -23.5, orange, true);
    for (const [x, z] of [
      [-60, -60],
      [55, -62],
      [58, 31],
      [-57, 31],
    ]) {
      box(0.22, 14, 0.22, x, 7, z, darkMetal, true);
      box(2.6, 0.15, 0.4, x + 1.1, 14, z, darkMetal);
      box(1, 0.08, 0.6, x + 2, 13.9, z, white);
    }
    // Utility silos.
    for (let i = 0; i < 3; i++) {
      const x = -7 + i * 6;
      const silo = new THREE.Mesh(
        new THREE.CylinderGeometry(2.1, 2.1, 12, 32),
        roofMat,
      );
      silo.position.set(x, 6, -68);
      silo.castShadow = true;
      silo.receiveShadow = true;
      scene.add(silo);
      collider(x, 6, -68, 4.2, 12, 4.2);
      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(2.15, 1.4, 32),
        roofMat,
      );
      cap.position.set(x, 12.7, -68);
      scene.add(cap);
      collider(x, 12.7, -68, 4.3, 1.4, 4.3);
      for (let j = 0; j < 6; j++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(2.12, 0.035, 4, 32),
          darkMetal,
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(x, 1 + j * 2, -68);
        scene.add(ring);
      }
    }
  }

  const gateLocations =
    environment === "circuit"
      ? [
          [0, 3, 7],
          [-18, 3, -12],
          [-34, 4, -35],
          [-15, 5, -57],
          [15, 4, -57],
          [36, 3, -35],
          [31, 4, -5],
          [15, 3, 20],
        ]
      : environment === "meadow"
        ? [
            [0, 3, -5],
            [-20, 3, -28],
            [22, 4, -42],
          ]
        : [
            [0, 3, 2],
            [-12, 3, -29],
            [12, 3, -12],
          ];
  gateLocations.forEach(([x, y, z], i) => {
    const w = 5,
      h = y + 2;
    box(0.16, h, 0.16, x - w / 2, h / 2, z, orange, true);
    box(0.16, h, 0.16, x + w / 2, h / 2, z, orange, true);
    box(w + 0.16, 0.22, 0.16, x, h, z, orange, true);
    for (const dx of [-w / 2, w / 2]) {
      box(0.65, 0.18, 1.1, x + dx, 0.09, z, darkMetal, true);
      for (let j = 0; j < 4; j++)
        box(0.18, 0.2, 0.18, x + dx, 0.8 + j * 1.1, z, white);
    }
    placard(`0${i + 1}`, "", 0.7, 0.42, x, h + 0.45, z + 0.1);
    gates.push(new THREE.Vector3(x, h / 2, z));
  });

  const padTexture = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = "#313d37";
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = "#e0ddc8";
    ctx.lineWidth = 8;
    ctx.strokeRect(24, 24, 464, 464);
    ctx.beginPath();
    ctx.arc(256, 256, 154, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#e0ddc8";
    ctx.font = "bold 164px Arial";
    ctx.textAlign = "center";
    ctx.fillText("H", 256, 313);
    ctx.fillStyle = "#eb824f";
    ctx.fillRect(212, 20, 88, 10);
    ctx.font = "22px monospace";
    ctx.fillText("TAKEOFF / 01", 256, 465);
  });
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    new THREE.MeshStandardMaterial({ map: padTexture, roughness: 1 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.012, 24);
  pad.receiveShadow = true;
  scene.add(pad);

  // Lightweight visual quad; the physics lives entirely outside the scene graph.
  const drone = new THREE.Group();
  scene.add(drone);
  const carbon = material("#222927", 0.5, 0.45);
  box(0.12, 0.055, 0.25, 0, 0, 0, carbon, false, drone);
  box(0.075, 0.06, 0.13, 0, 0.055, 0.01, material("#aeb9a0"), false, drone);
  for (const r of [-Math.PI / 4, Math.PI / 4]) {
    const arm = box(0.45, 0.018, 0.027, 0, 0, 0, carbon, false, drone);
    arm.rotation.y = r;
  }
  const propMat = new THREE.MeshStandardMaterial({
    color: "#c1ce9b",
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
  });
  for (const x of [-0.15, 0.15])
    for (const z of [-0.15, 0.15]) {
      const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.023, 0.023, 0.035, 12),
        darkMetal,
      );
      motor.position.set(x, 0.02, z);
      drone.add(motor);
      const prop = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.002, 0.017),
        propMat,
      );
      prop.position.set(x, 0.045, z);
      drone.add(prop);
      propellers.push(prop);
    }
  const cam = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), glass);
  cam.position.set(0, 0.018, -0.13);
  drone.add(cam);

  // Static geometry is batched by material; colliders retain their original SI bounds.
  scene.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of scene.children) {
    if (
      child instanceof THREE.Mesh &&
      !(child instanceof THREE.InstancedMesh) &&
      child.material instanceof THREE.MeshStandardMaterial
    ) {
      const group = batches.get(child.material) ?? [];
      group.push(child);
      batches.set(child.material, group);
    }
  }
  for (const [mat, meshes] of batches) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((mesh) =>
      mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
    );
    const merged = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = meshes.some((source) => source.castShadow);
    mesh.receiveShadow = meshes.some((source) => source.receiveShadow);
    for (const source of meshes) {
      scene.remove(source);
      source.geometry.dispose();
    }
    scene.add(mesh);
  }
  drone.traverse((object) => {
    object.castShadow = false;
  });

  return {
    scene,
    drone,
    propellers,
    obstacles,
    gates,
    dispose: () => {
      const geometries = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>(materials);
      const textures = new Set<THREE.Texture>([apronTexture]);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          geometries.add(obj.geometry);
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(
            (m) => mats.add(m),
          );
        }
      });
      mats.forEach((m) => {
        for (const value of Object.values(m))
          if (value instanceof THREE.Texture) textures.add(value);
        m.dispose();
      });
      textures.forEach((t) => t.dispose());
      geometries.forEach((g) => g.dispose());
      sun.shadow.dispose();
    },
  };
}
