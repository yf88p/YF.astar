import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CarState, Player, TrackId } from "../shared/protocol";
import { nearestTrack, TRACKS, type Track } from "../shared/tracks";

const UP = new THREE.Vector3(0, 1, 0);
function material(color: THREE.ColorRepresentation, roughness = 0.8) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: roughness < 0.5 ? 0.45 : 0.05,
  });
}
function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  at: [number, number, number],
  mat: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function wedge(
  width: number,
  bottom: number,
  top: number,
  front: number,
  back: number,
  roofFront: number,
  roofBack: number,
  mat: THREE.Material,
) {
  const vertices = [
    -width / 2,
    bottom,
    back,
    width / 2,
    bottom,
    back,
    width / 2,
    bottom,
    front,
    -width / 2,
    bottom,
    front,
    -width * 0.44,
    top,
    roofBack,
    width * 0.44,
    top,
    roofBack,
    width * 0.44,
    top,
    roofFront,
    -width * 0.44,
    top,
    roofFront,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 5, 1, 0, 4, 5, 3, 6, 7, 3, 2, 6, 0,
    7, 4, 0, 3, 7, 1, 6, 2, 1, 5, 6,
  ]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
export function makeCar(color: string): THREE.Group {
  const car = new THREE.Group();
  car.userData.vehicle = true;
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.25,
    metalness: 0.55,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
  });
  const black = material("#101415", 0.5);
  const glass = new THREE.MeshPhysicalMaterial({
    color: "#132d32",
    roughness: 0.08,
    metalness: 0.7,
    clearcoat: 1,
  });
  const light = new THREE.MeshStandardMaterial({
    color: "#fffed4",
    emissive: "#fff4bd",
    emissiveIntensity: 2,
  });
  const rear = new THREE.MeshStandardMaterial({
    color: "#ff3c25",
    emissive: "#ff2208",
    emissiveIntensity: 2,
  });
  car.add(wedge(2.55, 0.35, 0.95, 2.5, -2.35, 2.12, -2.1, paint));
  box(car, [2.6, 0.15, 4.7], [0, 0.3, 0.04], black);
  car.add(wedge(2.02, 0.93, 1.55, 0.95, -1.55, 0.16, -0.94, glass));
  box(car, [1.72, 0.06, 1.2], [0, 1.565, -0.4], paint);
  for (const side of [-1, 1]) {
    box(car, [0.12, 0.06, 1.45], [side * 0.96, 0.99, 1.23], black);
    box(car, [0.76, 0.1, 0.05], [side * 0.72, 0.77, 2.34], light).rotation.z =
      side * -0.07;
    box(car, [0.92, 0.07, 0.04], [side * 0.66, 0.85, -2.27], rear);
    box(car, [0.22, 0.23, 0.5], [side * 1.18, 1.05, 0.24], paint);
    box(car, [0.14, 0.35, 0.14], [side * 0.91, 1.13, -1.95], black);
    for (const z of [-1.42, 1.48]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.48, 0.35, 18),
        black,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 1.22, 0.49, z);
      wheel.castShadow = true;
      car.add(wheel);
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.31, 0.31, 0.365, 8),
        material("#7d8986", 0.3),
      );
      rim.rotation.z = Math.PI / 2;
      rim.position.copy(wheel.position);
      car.add(rim);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.375, 8),
        black,
      );
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      car.add(hub);
    }
  }
  box(car, [2.65, 0.1, 0.48], [0, 1.33, -1.97], black);
  box(car, [1.35, 0.18, 0.12], [0, 0.46, 2.45], black);
  box(car, [0.2, 0.025, 1.38], [0, 1.003, 1.3], black);
  for (let i = 0; i < 5; i++)
    box(car, [1.25, 0.025, 0.08], [0, 0.99, -1.55 - i * 0.11], black);
  return car;
}

function ribbon(
  track: Track,
  left: number,
  right: number,
  y: number,
  mat: THREE.Material,
) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= track.points.length; i++) {
    const p = track.points[i % track.points.length];
    const a = track.points[(i + track.points.length - 1) % track.points.length];
    const b = track.points[(i + 1) % track.points.length];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    for (const edge of [left, right])
      positions.push(p.x + Math.cos(yaw) * edge, y, p.z - Math.sin(yaw) * edge);
    if (i < track.points.length) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function label(text: string, color = "#d0f65c", width = 12, height = 2) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#151b18";
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = color;
  ctx.font = "italic 900 60px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 256, 71);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
  );
}

export class RacingWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(57, 1, 0.1, 1800);
  readonly cars = new Map<string, THREE.Group>();
  private gates: THREE.Group[] = [];
  private target = new THREE.Vector3();
  private positioned = false;
  private resizeObserver: ResizeObserver;
  private shadowLight: THREE.DirectionalLight;
  private track: Track;
  private skidPool: THREE.Mesh[] = [];
  private skidIndex = 0;
  constructor(
    private container: HTMLElement,
    trackId: TrackId,
    readonly hero = false,
  ) {
    this.track = TRACKS[trackId];
    const night = trackId === "harbor";
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, hero ? 1.5 : 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = night ? 1.1 : 1.15;
    this.renderer.domElement.setAttribute(
      "aria-label",
      hero
        ? "A lime sports car on a sunlit canyon circuit"
        : `Live 3D race on ${this.track.name}`,
    );
    container.append(this.renderer.domElement);
    const sky = document.createElement("canvas");
    sky.width = 2;
    sky.height = 256;
    const context = sky.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, night ? "#090e25" : "#62646e");
    gradient.addColorStop(0.55, night ? "#182b46" : "#c29689");
    gradient.addColorStop(1, night ? "#49657a" : "#f3c397");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 2, 256);
    const skyTexture = new THREE.CanvasTexture(sky);
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTexture;
    this.scene.fog = new THREE.Fog(
      night ? "#233748" : "#d1a083",
      hero ? 90 : 220,
      hero ? 520 : 1000,
    );
    this.scene.add(
      new THREE.HemisphereLight(
        night ? "#88b7ee" : "#dce4ee",
        night ? "#172735" : "#7e4830",
        night ? 2 : 2.5,
      ),
    );
    this.shadowLight = new THREE.DirectionalLight(
      night ? "#afcbff" : "#ffdfaf",
      night ? 2 : 4,
    );
    this.shadowLight.position.set(-80, 100, -70);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    Object.assign(this.shadowLight.shadow.camera, {
      left: -70,
      right: 70,
      top: 70,
      bottom: -70,
      near: 1,
      far: 350,
    });
    this.shadowLight.shadow.bias = -0.001;
    this.scene.add(this.shadowLight, this.shadowLight.target);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2800, 2800),
      material(night ? "#172b31" : "#a5795c"),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.07;
    ground.receiveShadow = true;
    this.scene.add(ground);
    if (hero) this.buildHero();
    else this.buildTrack();
    this.scenery(night, hero);
    this.batchScenery();
    if (!hero) {
      const skidMat = new THREE.MeshBasicMaterial({
        color: "#0d1011",
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      });
      const skidGeo = new THREE.PlaneGeometry(0.27, 1.8);
      this.skidPool = Array.from({ length: 120 }, () => {
        const mesh = new THREE.Mesh(skidGeo, skidMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.visible = false;
        this.scene.add(mesh);
        return mesh;
      });
    }
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }
  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  private batchScenery() {
    this.scene.updateMatrixWorld(true);
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material))
        return;
      for (
        let parent: THREE.Object3D | null = object;
        parent;
        parent = parent.parent
      ) {
        if (parent.userData.vehicle) return;
      }
      const group = groups.get(object.material) || [];
      group.push(object);
      groups.set(object.material, group);
    });
    // Static barriers and scenery share a draw call per material, not per road segment.
    for (const [material, meshes] of groups) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map((mesh) =>
        mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
      );
      const geometry = mergeGeometries(geometries);
      for (const source of geometries) source.dispose();
      if (!geometry) continue;
      const merged = new THREE.Mesh(geometry, material);
      merged.castShadow = true;
      merged.receiveShadow = true;
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      this.scene.add(merged);
    }
  }
  private buildHero() {
    const road = box(
      this.scene,
      [31, 0.1, 1100],
      [0, 0, -150],
      material("#383d3b"),
    );
    road.receiveShadow = true;
    const white = material("#ece3bb");
    for (const x of [-14, 14])
      box(this.scene, [0.2, 0.02, 1100], [x, 0.07, -150], white);
    for (let z = -600; z < 120; z += 12)
      box(this.scene, [0.14, 0.02, 5], [0, 0.07, z], white);
    for (let z = -400; z < 100; z += 8) {
      box(
        this.scene,
        [0.5, 0.65, 7.7],
        [16, 0.34, z],
        material(z % 16 === 0 ? "#d4b38b" : "#7e6550"),
      );
      box(
        this.scene,
        [0.5, 0.65, 7.7],
        [-16, 0.34, z],
        material(z % 16 === 0 ? "#d4b38b" : "#7e6550"),
      );
    }
    const main = makeCar("#d2ec65");
    main.position.set(3, 0.08, 1);
    main.rotation.y = -0.22;
    main.scale.setScalar(1.6);
    this.scene.add(main);
    this.cars.set("hero", main);
    const other = makeCar("#ece9df");
    other.position.set(-3.5, 0.08, -21);
    this.scene.add(other);
    const third = makeCar("#dc6746");
    third.position.set(5, 0.08, -43);
    this.scene.add(third);
    this.camera.position.set(10, 3.9, 11);
    this.camera.fov = 43;
    this.camera.lookAt(2, 0.9, -1);
    this.camera.updateProjectionMatrix();
    for (let i = 0; i < 4; i++) {
      const sign = label(
        i % 2 ? "PUSH THE LIMIT" : "A P E X",
        "#cbe95e",
        8,
        1.7,
      );
      sign.position.set(-17, 2.7, -i * 50 - 25);
      sign.rotation.y = Math.PI / 2;
      this.scene.add(sign);
    }
  }
  private buildTrack() {
    const track = this.track;
    const dark = material(
      track.id === "harbor" ? "#273b45" : "#3c403e",
      track.id === "harbor" ? 0.26 : 0.9,
    );
    dark.side = THREE.DoubleSide;
    this.scene.add(
      ribbon(track, -track.width / 2, track.width / 2, 0.02, dark),
    );
    const white = material("#e2e2d5");
    white.side = THREE.DoubleSide;
    for (const side of [-1, 1]) {
      const edge = side * (track.width / 2 - 0.4);
      this.scene.add(ribbon(track, edge - 0.12, edge + 0.12, 0.035, white));
    }
    const curb = [material("#c96346"), material("#e3dace")];
    const wall = [
      material(track.id === "harbor" ? "#4a6975" : "#c8b69a"),
      material("#414846"),
    ];
    const dashMat = material("#d9d6ac");
    for (let i = 0; i < track.points.length; i++) {
      const p = track.points[i];
      const next = track.points[(i + 1) % track.points.length];
      const yaw = Math.atan2(next.x - p.x, next.z - p.z);
      const len = Math.hypot(next.x - p.x, next.z - p.z);
      for (const side of [-1, 1]) {
        const offset = side * (track.width / 2 + 0.35);
        const x = (p.x + next.x) / 2 + Math.cos(yaw) * offset;
        const z = (p.z + next.z) / 2 - Math.sin(yaw) * offset;
        const kerb = box(
          this.scene,
          [0.9, 0.15, len + 0.12],
          [x, 0.07, z],
          curb[i % 2],
        );
        kerb.rotation.y = yaw;
        const barrier = box(
          this.scene,
          [0.4, 0.72, len + 0.1],
          [x + side * Math.cos(yaw) * 1, 0.36, z - side * Math.sin(yaw) * 1],
          wall[Math.floor(i / 3) % 2],
        );
        barrier.rotation.y = yaw;
      }
      if (i % 4 === 0) {
        const dash = box(
          this.scene,
          [0.14, 0.015, len * 1.5],
          [p.x, 0.045, p.z],
          dashMat,
        );
        dash.rotation.y = yaw;
      }
    }
    for (let i = 0; i < track.checkpoints.length; i++) {
      const gate = track.checkpoints[i];
      const group = new THREE.Group();
      group.position.set(gate.x, 0, gate.z);
      group.rotation.y = gate.yaw;
      const metal = material("#202d31", 0.4);
      const glow = new THREE.MeshStandardMaterial({
        color: "#bcee58",
        emissive: "#bcee58",
        emissiveIntensity: 0.6,
      });
      for (const side of [-1, 1]) {
        box(
          group,
          [0.4, 6.2, 0.4],
          [side * (track.width / 2 + 0.8), 3.1, 0],
          metal,
        );
        box(
          group,
          [0.18, 4.5, 0.2],
          [side * (track.width / 2 + 0.8), 3.1, 0.24],
          glow,
        );
      }
      box(group, [track.width + 2, 0.5, 0.5], [0, 6.2, 0], metal);
      box(group, [track.width, 0.12, 0.56], [0, 5.95, 0], glow);
      const sign = label(
        i === 0
          ? "A P E X  /  FINISH"
          : `CHECKPOINT  ${String(i).padStart(2, "0")}`,
        "#c8ef62",
        9,
        1.4,
      );
      sign.position.set(0, 6.95, 0);
      sign.rotation.y = Math.PI;
      group.add(sign);
      this.scene.add(group);
      this.gates.push(group);
      if (i === 0)
        for (let row = 0; row < 2; row++)
          for (let col = 0; col < 16; col++) {
            const square = box(
              group,
              [track.width / 16, 0.015, 1],
              [
                ((col + 0.5) * track.width) / 16 - track.width / 2,
                0.05,
                row - 0.5,
              ],
              material((row + col) % 2 ? "#202827" : "#f2ead2"),
            );
            square.castShadow = false;
          }
    }
  }
  private scenery(night: boolean, hero: boolean) {
    let seed = 7345;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const rockMaterials = ["#8b6657", "#a57157", "#bd8762", "#7e6861"].map(
      (c) => material(night ? "#283a49" : c),
    );
    for (let i = 0; i < (hero ? 65 : 130); i++) {
      const angle = random() * Math.PI * 2;
      const radius = hero ? 135 + random() * 350 : 205 + random() * 400;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = 15 + random() * (hero ? 50 : 75);
      const topRadius = 10 + random() * 22;
      const baseRadius = 27 + random() * 40;
      // Keep the entire rock, rather than only its center, outside the road and chase camera.
      if (hero && Math.abs(x) < baseRadius + 28) continue;
      if (
        !hero &&
        nearestTrack(this.track, x, z).distance <
          baseRadius + this.track.width / 2 + 14
      )
        continue;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(
          topRadius,
          baseRadius,
          height,
          5 + Math.floor(random() * 3),
          1,
        ),
        rockMaterials[i % rockMaterials.length],
      );
      mesh.position.set(x, height / 2 - 1, z);
      mesh.rotation.y = random() * 6;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      if (i % 3 === 0) {
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(8, 15, 3, 6),
          rockMaterials[(i + 1) % 4],
        );
        cap.position.set(x, height, z);
        this.scene.add(cap);
      }
    }
    if (night) {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(210, 300),
        new THREE.MeshStandardMaterial({
          color: "#173b4b",
          metalness: 0.65,
          roughness: 0.19,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(245, -0.025, 0);
      this.scene.add(water);
      for (let i = 0; i < 30; i++) {
        const x = (random() - 0.5) * 380;
        const z = (random() - 0.5) * 400;
        if (nearestTrack(this.track, x, z).distance < 24) continue;
        const mat = material(
          ["#39496f", "#964b55", "#397673", "#85714b"][i % 4],
        );
        box(this.scene, [12, 5, 6], [x, 2.5, z], mat);
        if (i % 2) box(this.scene, [12, 5, 6], [x, 7.5, z], mat);
        for (let j = 0; j < 8; j++)
          box(
            this.scene,
            [0.15, 4.8, 6.05],
            [x - 5.4 + j * 1.5, 2.5, z],
            material("#344955"),
          );
      }
      for (const x of [140, 185, 220]) {
        const crane = material("#ce924d");
        box(this.scene, [2, 42, 2], [x, 21, 75], crane);
        box(this.scene, [48, 2, 2], [x - 12, 42, 75], crane);
        box(
          this.scene,
          [0.15, 28, 0.15],
          [x - 33, 27, 75],
          material("#a2b5b8"),
        );
      }
      for (let i = 0; i < this.track.points.length; i += 12) {
        const p = this.track.points[i];
        const next = this.track.points[(i + 1) % this.track.points.length];
        const yaw = Math.atan2(next.x - p.x, next.z - p.z);
        const x = p.x + Math.cos(yaw) * 14;
        const z = p.z - Math.sin(yaw) * 14;
        box(this.scene, [0.2, 9, 0.2], [x, 4.5, z], material("#465762"));
        box(
          this.scene,
          [3, 0.12, 0.3],
          [x, 9, z],
          new THREE.MeshStandardMaterial({
            color: "#a6edff",
            emissive: "#68bfff",
            emissiveIntensity: 3,
          }),
        );
      }
    } else {
      const cactus = material("#465846");
      for (let i = 0; i < 95; i++) {
        const x = (random() - 0.5) * (hero ? 340 : 650);
        const z = (random() - 0.5) * (hero ? 480 : 650);
        if (
          hero ? Math.abs(x) < 21 : nearestTrack(this.track, x, z).distance < 17
        )
          continue;
        const h = 1.5 + random() * 3.5;
        box(this.scene, [0.5, h, 0.5], [x, h / 2, z], cactus);
        box(this.scene, [1.8, 0.35, 0.4], [x + 0.5, h * 0.55, z], cactus);
        box(this.scene, [0.4, h * 0.4, 0.4], [x + 1.2, h * 0.7, z], cactus);
      }
    }
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(night ? 14 : 30, 32, 16),
      new THREE.MeshBasicMaterial({
        color: night ? "#d6e7eb" : "#ffe1ad",
        fog: false,
      }),
    );
    sun.position.set(-250, night ? 190 : 115, -650);
    this.scene.add(sun);
  }
  update(
    cars: CarState[],
    players: Player[],
    controlledId: string,
    dt: number,
    cameraMode: "chase" | "hood" | "aerial",
    reducedMotion: boolean,
  ) {
    const ids = new Set(cars.map((car) => car.id));
    for (const [id, mesh] of this.cars)
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        this.cars.delete(id);
      }
    for (const car of cars) {
      let mesh = this.cars.get(car.id);
      if (!mesh) {
        mesh = makeCar(
          car.id === controlledId
            ? "#d2ef65"
            : players.find((p) => p.id === car.id)?.color || "#75c7dc",
        );
        this.cars.set(car.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(car.x, 0.07, car.z);
      mesh.rotation.y = car.yaw;
      mesh.rotation.z = reducedMotion
        ? 0
        : -car.steer * Math.min(Math.abs(car.speed) / 1000, 0.03);
      mesh.visible = !(car.id === controlledId && cameraMode === "hood");
      if (car.drift && Math.abs(car.speed) > 8 && !reducedMotion) {
        const skid = this.skidPool[this.skidIndex++ % this.skidPool.length];
        skid.visible = true;
        skid.position.set(car.x, 0.055, car.z);
        skid.rotation.set(-Math.PI / 2, 0, -car.yaw);
      }
    }
    const car = cars.find((car) => car.id === controlledId) || cars[0];
    if (car) {
      const forward = new THREE.Vector3(
        Math.sin(car.yaw),
        0,
        Math.cos(car.yaw),
      );
      const pos = new THREE.Vector3(car.x, 0, car.z);
      const cameraPos =
        cameraMode === "aerial"
          ? pos.clone().add(new THREE.Vector3(0, 65, -25))
          : cameraMode === "hood"
            ? pos
                .clone()
                .addScaledVector(forward, 0.65)
                .add(new THREE.Vector3(0, 1.7, 0))
            : pos
                .clone()
                .addScaledVector(
                  forward,
                  -10.8 - (reducedMotion ? 0 : Math.abs(car.speed) * 0.045),
                )
                .add(new THREE.Vector3(0, 5.5, 0));
      const target = pos
        .clone()
        .addScaledVector(forward, cameraMode === "hood" ? 22 : 8)
        .add(new THREE.Vector3(0, 1, 0));
      const smoothing =
        this.positioned && cameraMode !== "hood"
          ? 1 - Math.exp(-dt * (reducedMotion ? 14 : 8))
          : 1;
      this.camera.position.lerp(cameraPos, smoothing);
      this.target.lerp(target, smoothing);
      this.camera.up.copy(UP);
      this.camera.lookAt(this.target);
      this.camera.fov =
        cameraMode === "hood"
          ? 72
          : 57 + (reducedMotion ? 0 : Math.min(Math.abs(car.speed) * 0.18, 12));
      this.camera.updateProjectionMatrix();
      this.shadowLight.position.copy(pos).add(new THREE.Vector3(-70, 110, -65));
      this.shadowLight.target.position.copy(pos);
      this.positioned = true;
      this.gates.forEach((gate, i) =>
        gate.scale.setScalar(i === car.checkpoint ? 1.025 : 1),
      );
    }
    this.renderer.render(this.scene, this.camera);
  }
  renderHero(time: number, reducedMotion: boolean) {
    if (!reducedMotion) {
      this.camera.position.x = 10 + Math.sin(time * 0.00012) * 0.35;
      this.camera.lookAt(2, 0.9, -1);
    }
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.resizeObserver.disconnect();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const mat of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(mat);
          if ("map" in mat && mat.map instanceof THREE.Texture)
            textures.add(mat.map);
        }
      }
    });
    if (this.scene.background instanceof THREE.Texture)
      textures.add(this.scene.background);
    for (const item of [...geometries, ...materials, ...textures])
      item.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
