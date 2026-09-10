import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  Clay,
  SEGMENTS,
  ROWS,
  HEIGHT,
  BASE_Y,
  profile,
  TOOLS,
} from "./clay.js";

const TAU = Math.PI * 2;
const temp = new THREE.Object3D();
const vec = new THREE.Vector3();
const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

function clayTextures() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  let seed = 1742;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    const band = Math.sin(y * 0.61) * 0.8 + Math.sin(y * 0.19) * 0.7;
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const grain = random();
      const value =
        215 + (random() - 0.5) * 24 + band - (grain > 0.994 ? 55 : 0);
      image.data[index] = value;
      image.data[index + 1] = value - 2;
      image.data[index + 2] = value - 4;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  const bump = texture.clone();
  bump.colorSpace = THREE.NoColorSpace;
  bump.needsUpdate = true;
  return { texture, bump };
}

export class PotteryStudio {
  constructor(canvas, state, audio, callbacks) {
    this.canvas = canvas;
    this.state = state;
    this.audio = audio;
    this.callbacks = callbacks;
    this.clay = new Clay();
    this.history = [];
    this.visible = true;
    this.down = false;
    this.hovering = false;
    this.contact = false;
    this.stroke = null;
    this.pointer = new THREE.Vector2(9, 9);
    this.pointerPressure = 1;
    this.activePointers = new Set();
    this.lastHit = null;
    this.angularVelocity = 0;
    this.lastTime = 0;
    this.lastCutTime = 0;
    this.particleCursor = 0;
    this.particleBudget = 0;
    this.dustCursor = 0;
    this.keyboardY = 1.8;
    this.keyboardActive = false;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.setClearColor(0x252724, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
    this.camera.position.set(0, 4.85, 8.1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.51, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 5.2;
    this.controls.maxDistance = 11;
    this.controls.minPolarAngle = 0.42;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.update();
    this.controls.saveState();
    this.raycaster = new THREE.Raycaster();
    this.setupLight();
    this.setupWheel();
    this.setupPot();
    this.setupParticles();
    this.setupTools();
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.frame(time));
    callbacks.onReady();
  }

  setupLight() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.45;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xe9ecd9, 0x302b21, 0.72));
    const key = new THREE.DirectionalLight(0xffebd6, 2.6);
    key.position.set(-3.5, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -4;
    key.shadow.camera.right = key.shadow.camera.top = 4;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 16;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.018;
    key.shadow.radius = 5;
    key.shadow.blurSamples = 8;
    key.target.position.set(0, 1, 0);
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xcbd5c3, 0.55);
    fill.position.set(4, 2, 1);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xe8c8aa, 1.1);
    rim.position.set(2, 5, -3);
    this.scene.add(rim);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.08, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.16;
    shadow.receiveShadow = true;
    this.scene.add(shadow);
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, "#080c06cc");
    g.addColorStop(0.4, "#080c0677");
    g.addColorStop(1, "#080c0600");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(5.4, 5.4),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(c),
        transparent: true,
        depthWrite: false,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -0.145;
    this.scene.add(contact);
  }

  setupWheel() {
    this.wheel = new THREE.Group();
    this.scene.add(this.wheel);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.57, 1.5, 0.17, 128),
      new THREE.MeshStandardMaterial({
        color: 0x383c35,
        roughness: 0.72,
        metalness: 0.45,
      }),
    );
    base.position.y = -0.035;
    base.castShadow = base.receiveShadow = true;
    this.scene.add(base);
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x464b43,
      roughness: 0.58,
      metalness: 0.55,
    });
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.74, 1.74, 0.125, 160),
      wheelMat,
    );
    disc.position.y = 0.165;
    disc.castShadow = disc.receiveShadow = true;
    this.wheel.add(disc);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(1.71, 1.71, 0.022, 160),
      new THREE.MeshStandardMaterial({
        color: 0x555b51,
        roughness: 0.68,
        metalness: 0.45,
      }),
    );
    top.position.y = 0.237;
    top.receiveShadow = true;
    this.wheel.add(top);
    const rings = new THREE.MeshStandardMaterial({
      color: 0x50564c,
      roughness: 0.7,
      metalness: 0.45,
    });
    for (let r = 0.88; r < 1.7; r += 0.085) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.0022, 4, 160),
        rings,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.25;
      this.wheel.add(ring);
    }
    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(1.735, 0.012, 8, 160),
      new THREE.MeshStandardMaterial({
        color: 0x94968a,
        roughness: 0.35,
        metalness: 0.7,
      }),
    );
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.214;
    this.wheel.add(edge);
    this.potGroup = new THREE.Group();
    this.wheel.add(this.potGroup);
  }

  setupPot() {
    const stride = SEGMENTS + 1;
    const surfaceCount = (ROWS + 1) * stride;
    const positions = new Float32Array(surfaceCount * 2 * 3);
    const uvs = new Float32Array(surfaceCount * 2 * 2);
    const colors = new Float32Array(surfaceCount * 2 * 3).fill(1);
    const indices = [];
    for (let side = 0; side < 2; side++) {
      for (let j = 0; j <= ROWS; j++) {
        for (let i = 0; i <= SEGMENTS; i++) {
          const index = side * surfaceCount + j * stride + i;
          const angle = (i / SEGMENTS) * TAU;
          const radius =
            side === 0
              ? this.clay.radii[j * SEGMENTS + (i % SEGMENTS)]
              : profile(j / ROWS) - 0.25;
          positions[index * 3] = Math.cos(angle) * radius;
          positions[index * 3 + 1] =
            BASE_Y +
            (side === 0
              ? (j / ROWS) * HEIGHT
              : 0.13 + (j / ROWS) * (HEIGHT - 0.13));
          positions[index * 3 + 2] = Math.sin(angle) * radius;
          uvs[index * 2] = (i / SEGMENTS) * 2;
          uvs[index * 2 + 1] = j / ROWS;
          if (side) colors.fill(0.81, index * 3, index * 3 + 3);
          if (j < ROWS && i < SEGMENTS) {
            const a = index,
              b = index + 1,
              c = index + stride,
              d = c + 1;
            if (side === 0) indices.push(a, c, b, b, c, d);
            else indices.push(a, b, c, b, d, c);
          }
        }
      }
    }
    // Join outer and inner walls into a real, thick rim, not a capped solid.
    for (let i = 0; i < SEGMENTS; i++) {
      const a = ROWS * stride + i,
        b = a + 1,
        c = surfaceCount + a,
        d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setIndex(indices);
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    const { texture, bump } = clayTextures();
    this.material = new THREE.MeshPhysicalMaterial({
      color: "#b67e60",
      map: texture,
      bumpMap: bump,
      bumpScale: 0.012,
      roughness: 0.58,
      metalness: 0,
      clearcoat: 0.16,
      clearcoatRoughness: 0.48,
      vertexColors: true,
    });
    this.pot = new THREE.Mesh(this.geometry, this.material);
    this.pot.castShadow = true;
    this.pot.receiveShadow = true;
    this.potGroup.add(this.pot);
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.56, 0.78, 0.13, 96),
      this.material,
    );
    floor.position.y = BASE_Y + 0.065;
    floor.receiveShadow = floor.castShadow = true;
    this.potGroup.add(floor);
    const foot = new THREE.Mesh(
      new THREE.TorusGeometry(0.774, 0.026, 12, 160),
      this.material,
    );
    foot.rotation.x = Math.PI / 2;
    foot.position.y = BASE_Y + 0.001;
    foot.castShadow = true;
    this.potGroup.add(foot);
    this.updateMaterial();
  }

  syncGeometry() {
    const positions = this.geometry.attributes.position.array;
    const colors = this.geometry.attributes.color.array;
    const stride = SEGMENTS + 1;
    for (let j = 0; j <= ROWS; j++) {
      for (let i = 0; i <= SEGMENTS; i++) {
        const source = j * SEGMENTS + (i % SEGMENTS);
        const index = (j * stride + i) * 3;
        const r = this.clay.radii[source];
        const angle = (i / SEGMENTS) * TAU;
        positions[index] = Math.cos(angle) * r;
        positions[index + 2] = Math.sin(angle) * r;
        const cut = this.clay.original[source] - r;
        const shade = 1 - Math.min(0.15, cut * 0.8);
        colors[index] = shade;
        colors[index + 1] = shade;
        colors[index + 2] = shade;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeVertexNormals();
    const normals = this.geometry.attributes.normal.array;
    // The texture seam has duplicate vertices; weld their shading after each cut.
    for (let j = 0; j <= ROWS; j++) {
      const a = j * stride * 3,
        b = (j * stride + SEGMENTS) * 3;
      vec
        .set(
          normals[a] + normals[b],
          normals[a + 1] + normals[b + 1],
          normals[a + 2] + normals[b + 2],
        )
        .normalize();
      normals[a] = normals[b] = vec.x;
      normals[a + 1] = normals[b + 1] = vec.y;
      normals[a + 2] = normals[b + 2] = vec.z;
    }
    this.geometry.attributes.normal.needsUpdate = true;
    this.callbacks.onChange(this.clay.removed, this.history.length > 0);
  }

  setupParticles() {
    this.particles = Array.from({ length: 260 }, () => ({
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      rotation: new THREE.Euler(),
      spin: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      age: 0,
      settled: false,
    }));
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.chips = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color: "#9b6b51", roughness: 0.83 }),
      this.particles.length,
    );
    this.chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chips.castShadow = this.chips.receiveShadow = true;
    this.chips.frustumCulled = false;
    temp.scale.setScalar(0);
    temp.updateMatrix();
    for (let i = 0; i < this.particles.length; i++)
      this.chips.setMatrixAt(i, temp.matrix);
    this.scene.add(this.chips);
    const ribbonPositions = [],
      ribbonIndices = [];
    for (let i = 0; i <= 12; i++) {
      const angle = -1.2 + (i / 12) * 4.7;
      const r = 0.65 + (i / 12) * 0.4;
      const width = 0.17 * (0.45 + Math.sin((i / 12) * Math.PI));
      ribbonPositions.push(
        Math.cos(angle) * r,
        -width,
        Math.sin(angle) * r,
        Math.cos(angle) * r,
        width,
        Math.sin(angle) * r,
      );
      if (i < 12) {
        const a = i * 2;
        ribbonIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const ribbonGeometry = new THREE.BufferGeometry();
    ribbonGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(ribbonPositions, 3),
    );
    ribbonGeometry.setIndex(ribbonIndices);
    ribbonGeometry.computeVertexNormals();
    this.chips.material.side = THREE.DoubleSide;
    this.ribbons = new THREE.InstancedMesh(
      ribbonGeometry,
      this.chips.material,
      this.particles.length,
    );
    this.ribbons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ribbons.castShadow = this.ribbons.receiveShadow = true;
    this.ribbons.frustumCulled = false;
    for (let i = 0; i < this.particles.length; i++)
      this.ribbons.setMatrixAt(i, hiddenMatrix);
    this.scene.add(this.ribbons);
    this.dust = Array.from({ length: 220 }, () => ({
      life: 0,
      velocity: new THREE.Vector3(),
    }));
    const dustPositions = new Float32Array(this.dust.length * 3).fill(-100);
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(dustPositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    dustGeo.setAttribute(
      "particleAlpha",
      new THREE.BufferAttribute(new Float32Array(this.dust.length), 1).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const dustMaterial = new THREE.PointsMaterial({
      color: "#d1ab83",
      size: 0.021,
      transparent: true,
      opacity: 0.33,
      depthWrite: false,
      sizeAttenuation: true,
    });
    dustMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float particleAlpha;\nvarying float vParticleAlpha;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvParticleAlpha = particleAlpha;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vParticleAlpha;",
        )
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\ndiffuseColor.a *= vParticleAlpha * (1.0 - smoothstep(0.15, 0.5, length(gl_PointCoord - 0.5)));",
        );
    };
    this.dustMesh = new THREE.Points(dustGeo, dustMaterial);
    this.dustMesh.frustumCulled = false;
    this.scene.add(this.dustMesh);
  }

  emitParticles(point, volume, dt) {
    if (this.state.tool === "sponge" || volume <= 0) return;
    this.particleBudget += volume * 22000;
    const count = Math.min(7, Math.floor(this.particleBudget));
    this.particleBudget -= count;
    const wet = this.state.wetness;
    for (let k = 0; k < count; k++) {
      const p = this.particles[this.particleCursor++ % this.particles.length];
      p.active = true;
      p.age = 0;
      p.settled = false;
      p.ribbon = this.state.tool === "loop" && wet > 0.4;
      p.position.copy(point);
      const normal = new THREE.Vector3(point.x, 0, point.z).normalize();
      // Material inherits tangential wheel velocity, then yields to gravity and drag.
      p.velocity
        .set(
          point.z * this.angularVelocity * 0.55,
          0.05 + Math.random() * 0.25,
          -point.x * this.angularVelocity * 0.55,
        )
        .addScaledVector(normal, 0.18 + Math.random() * 0.36);
      p.velocity.x += (Math.random() - 0.5) * 0.17;
      p.rotation.set(
        Math.random() * TAU,
        Math.random() * TAU,
        Math.random() * TAU,
      );
      p.spin.set(Math.random() * 5, Math.random() * 5, Math.random() * 5);
      const size =
        0.007 +
        Math.random() * 0.011 +
        Math.min(0.012, (volume / Math.max(dt, 0.01)) * 2);
      p.scale.set(
        size * (1.4 + wet),
        size * (0.4 + wet * 0.3),
        size * (1.1 + wet * 1.8),
      );
      if (p.ribbon) p.scale.multiplyScalar(1.5);
      if (k === 0 && Math.random() < 0.4)
        this.audio.chip(0.17 + this.state.pressure * 0.3, this.pointer.x);
      if (Math.random() > wet * 0.9) {
        for (let n = 0; n < 3; n++) {
          const i = this.dustCursor++ % this.dust.length;
          this.dust[i].life = 0.9 + Math.random() * 0.9;
          this.dust[i].velocity
            .copy(p.velocity)
            .multiplyScalar(0.3)
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 0.2,
                0.04,
                (Math.random() - 0.5) * 0.2,
              ),
            );
          const positions = this.dustMesh.geometry.attributes.position.array;
          positions[i * 3] = point.x;
          positions[i * 3 + 1] = point.y;
          positions[i * 3 + 2] = point.z;
        }
      }
    }
  }

  updateParticles(dt) {
    let dirty = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      dirty = true;
      p.age += dt;
      if (p.settled) {
        const angle = this.angularVelocity * dt;
        const x = p.position.x,
          z = p.position.z;
        p.position.x = x * Math.cos(angle) + z * Math.sin(angle);
        p.position.z = z * Math.cos(angle) - x * Math.sin(angle);
        p.rotation.y += angle;
      } else {
        p.velocity.y -= dt * 36;
        p.velocity.multiplyScalar(Math.exp(-dt * 0.7));
        p.position.addScaledVector(p.velocity, dt);
        p.rotation.x += p.spin.x * dt;
        p.rotation.y += p.spin.y * dt;
        p.rotation.z += p.spin.z * dt;
        const r = Math.hypot(p.position.x, p.position.z);
        const floor = r < 1.7 ? 0.263 : -0.125;
        if (p.position.y < floor) {
          p.position.y = floor;
          if (
            r < 1.7 &&
            (Math.abs(p.velocity.y) < 0.45 || this.state.wetness > 0.4)
          ) {
            p.settled = true;
            p.rotation.x *= 0.2;
          } else {
            p.velocity.y *= -0.16;
            p.velocity.x *= 0.38;
            p.velocity.z *= 0.38;
          }
        }
      }
      temp.position.copy(p.position);
      temp.rotation.copy(p.rotation);
      temp.scale
        .copy(p.scale)
        .multiplyScalar(Math.min(1, Math.max(0, 18 - p.age)));
      if (p.age >= 18) {
        p.active = false;
        temp.scale.setScalar(0);
      }
      temp.updateMatrix();
      this.chips.setMatrixAt(i, p.ribbon ? hiddenMatrix : temp.matrix);
      this.ribbons.setMatrixAt(i, p.ribbon ? temp.matrix : hiddenMatrix);
    }
    if (dirty) {
      this.chips.instanceMatrix.needsUpdate = true;
      this.ribbons.instanceMatrix.needsUpdate = true;
    }
    const positions = this.dustMesh.geometry.attributes.position.array;
    const alphas = this.dustMesh.geometry.attributes.particleAlpha.array;
    let dustDirty = false;
    for (let i = 0; i < this.dust.length; i++) {
      const p = this.dust[i];
      if (p.life <= 0) continue;
      dustDirty = true;
      p.life = Math.max(0, p.life - dt);
      p.velocity.multiplyScalar(Math.exp(-dt * 1.5));
      p.velocity.y -= dt * 0.05;
      positions[i * 3] += p.velocity.x * dt;
      positions[i * 3 + 1] += p.velocity.y * dt;
      positions[i * 3 + 2] += p.velocity.z * dt;
      if (p.life === 0) positions[i * 3 + 1] = -100;
      alphas[i] = Math.min(1, p.life);
    }
    if (dustDirty) {
      this.dustMesh.geometry.attributes.position.needsUpdate = true;
      this.dustMesh.geometry.attributes.particleAlpha.needsUpdate = true;
    }
  }

  setupTools() {
    this.toolModels = {};
    const wood = new THREE.MeshStandardMaterial({
      color: "#98704c",
      roughness: 0.65,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: "#b8bfb4",
      roughness: 0.26,
      metalness: 0.83,
    });
    for (const name of Object.keys(TOOLS)) {
      const group = new THREE.Group();
      if (name === "loop" || name === "needle") {
        const handle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.052, 0.59, 16),
          wood,
        );
        handle.position.y = -0.5;
        group.add(handle);
        const ferrule = new THREE.Mesh(
          new THREE.CylinderGeometry(0.042, 0.042, 0.085, 16),
          metal,
        );
        ferrule.position.y = -0.205;
        group.add(ferrule);
        if (name === "loop") {
          const points = [];
          for (let i = 0; i <= 40; i++) {
            const a = (i / 40) * TAU;
            points.push(
              new THREE.Vector3(
                Math.sin(a) * 0.081,
                Math.cos(a) * 0.115 - 0.04,
                0,
              ),
            );
          }
          group.add(
            new THREE.Mesh(
              new THREE.TubeGeometry(
                new THREE.CatmullRomCurve3(points, true),
                48,
                0.009,
                6,
                true,
              ),
              metal,
            ),
          );
          const shank = new THREE.Mesh(
            new THREE.CylinderGeometry(0.011, 0.011, 0.07, 8),
            metal,
          );
          shank.position.y = -0.175;
          group.add(shank);
        } else {
          const tip = new THREE.Mesh(
            new THREE.ConeGeometry(0.009, 0.24, 8),
            metal,
          );
          tip.position.y = -0.055;
          group.add(tip);
        }
      } else if (name === "rib") {
        const rib = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), wood);
        rib.scale.set(0.2, 0.32, 0.029);
        rib.position.y = -0.2;
        group.add(rib);
      } else {
        const sponge = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.2, 3),
          new THREE.MeshStandardMaterial({
            color: "#b9a071",
            roughness: 1,
            bumpMap: this.material.bumpMap,
            bumpScale: 0.1,
          }),
        );
        sponge.scale.set(1, 0.85, 0.45);
        group.add(sponge);
      }
      group.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      group.visible = false;
      this.toolModels[name] = group;
      this.scene.add(group);
    }
  }

  bindInput() {
    const canvas = this.canvas;
    this.cursor = document.querySelector("#tool-cursor");
    this.contactLabel = document.querySelector("#contact-label");
    const position = (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      this.pointerPressure =
        e.pointerType === "pen" && e.pressure > 0 ? e.pressure * 1.8 : 1;
      this.cursor.style.left = `${e.clientX - r.left}px`;
      this.cursor.style.top = `${e.clientY - r.top}px`;
      this.contactLabel.style.left = `${e.clientX - r.left + 27}px`;
      this.contactLabel.style.top = `${e.clientY - r.top - 7}px`;
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.classList.add("pointer-focused");
      this.activePointers.add(e.pointerId);
      position(e);
      if (this.activePointers.size > 1) {
        this.finishStroke();
        this.hovering = false;
        return;
      }
      if (e.button !== 0) return;
      this.hovering = true;
      this.down = true;
      this.lastHit = null;
      canvas.setPointerCapture(e.pointerId);
      canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener("pointermove", (e) => {
      position(e);
      this.hovering = this.activePointers.size < 2;
    });
    const end = (e) => {
      this.activePointers.delete(e.pointerId);
      this.finishStroke();
      if (e.pointerType === "touch") {
        this.hovering = false;
        this.cursor.style.opacity = 0;
      }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("lostpointercapture", (e) => {
      if (this.activePointers.has(e.pointerId)) end(e);
    });
    canvas.addEventListener("pointerleave", () => {
      if (!this.down) {
        this.hovering = false;
        this.cursor.style.opacity = 0;
      }
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("keydown", (e) => {
      canvas.classList.remove("pointer-focused");
      if (e.key === "Enter" && !e.repeat) {
        e.preventDefault();
        this.keyboardActive = true;
        this.down = true;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        this.keyboardY = THREE.MathUtils.clamp(
          this.keyboardY + (e.key === "ArrowUp" ? 0.09 : -0.09),
          0.45,
          3.25,
        );
      }
    });
    canvas.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        this.keyboardActive = false;
        this.finishStroke();
      }
    });
    canvas.addEventListener("blur", () => {
      this.keyboardActive = false;
      this.finishStroke();
    });
    window.addEventListener("blur", () => {
      this.finishStroke();
      this.activePointers.clear();
    });
  }

  hitTest() {
    if (this.keyboardActive) {
      const angle = Math.atan2(this.camera.position.z, this.camera.position.x);
      const point = new THREE.Vector3(
        Math.cos(angle) * profile((this.keyboardY - BASE_Y) / HEIGHT),
        this.keyboardY,
        Math.sin(angle) * profile((this.keyboardY - BASE_Y) / HEIGHT),
      );
      const projected = point.clone().project(this.camera);
      this.raycaster.setFromCamera(projected, this.camera);
    } else this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.pot, false);
    const hit = hits[0];
    if (!hit || hit.faceIndex >= ROWS * SEGMENTS * 2) return null;
    const local = this.pot.worldToLocal(hit.point.clone());
    return {
      point: hit.point,
      theta: Math.atan2(local.z, local.x),
      y: local.y,
      local,
    };
  }

  finishStroke() {
    this.down = false;
    this.lastHit = null;
    if (this.stroke) {
      if (this.clay.removed > this.stroke.removed) {
        this.history.push(this.stroke);
        if (this.history.length > 24) this.history.shift();
      }
      this.stroke = null;
      this.callbacks.onChange(this.clay.removed, this.history.length > 0);
    }
    if (this.contact) {
      this.contact = false;
      this.callbacks.onContact(false);
    }
  }

  frame(time) {
    const dt = Math.min(0.1, (time - (this.lastTime || time - 16)) / 1000);
    this.lastTime = time;
    if (!this.visible) return;
    this.controls.update();
    // The motor has inertia. Contact torque slows the wheel, especially in dry clay.
    const target = this.state.playing ? (this.state.speed / 60) * TAU : 0;
    const resistance =
      (1 - this.state.wetness * 0.62) *
      this.state.pressure *
      TOOLS[this.state.tool].drag;
    const loadedTarget = target * (this.contact ? 1 - resistance * 0.2 : 1);
    this.angularVelocity +=
      (loadedTarget - this.angularVelocity) * (1 - Math.exp(-dt * 2.1));
    this.wheel.rotation.y =
      (this.wheel.rotation.y + this.angularVelocity * dt) % TAU;
    this.scene.updateMatrixWorld();
    const hit = this.hovering || this.keyboardActive ? this.hitTest() : null;
    this.cursor.style.opacity = hit && !this.keyboardActive ? "1" : "0";
    this.canvas.style.cursor = hit ? "none" : "crosshair";
    for (const [name, model] of Object.entries(this.toolModels))
      model.visible = !!hit && name === this.state.tool;
    let motion = Math.abs(this.angularVelocity) * 0.6;
    if (hit) {
      const model = this.toolModels[this.state.tool];
      model.position.copy(hit.point);
      model.lookAt(this.camera.position);
      model.rotateZ(
        -0.72 +
          (this.contact ? Math.sin(time * 0.037) * resistance * 0.045 : 0),
      );
      model.translateZ(this.down ? 0.01 : 0.055);
      if (this.down) {
        if (!this.stroke) this.stroke = this.clay.snapshot();
        let deltaAngle = 0,
          deltaY = 0;
        if (this.lastHit) {
          deltaAngle = Math.atan2(
            Math.sin(hit.theta - this.lastHit.theta),
            Math.cos(hit.theta - this.lastHit.theta),
          );
          deltaY = hit.y - this.lastHit.y;
          motion = Math.min(
            2,
            Math.hypot(
              deltaAngle * profile((hit.y - BASE_Y) / HEIGHT),
              deltaY,
            ) / Math.max(dt, 0.001),
          );
        }
        // Substeps sweep the actual tool path, keeping fast cuts connected across the seam.
        const distance = Math.hypot(deltaAngle * 1.2, deltaY);
        const steps = Math.min(
          24,
          Math.max(
            1,
            Math.ceil(distance / (TOOLS[this.state.tool].radius * 0.38)),
          ),
        );
        let removed = 0;
        for (let i = 1; i <= steps; i++) {
          removed += this.clay.carve(
            hit.theta - deltaAngle * (1 - i / steps),
            hit.y - deltaY * (1 - i / steps),
            {
              tool: this.state.tool,
              pressure: Math.min(1, this.state.pressure * this.pointerPressure),
              wetness: this.state.wetness,
              motion,
              dt: dt / steps,
            },
          );
        }
        this.lastHit = hit;
        if (removed > 0) {
          this.syncGeometry();
          this.emitParticles(hit.point, removed, dt);
        }
      } else this.lastHit = null;
    } else this.lastHit = null;
    const contact = !!hit && this.down;
    if (contact !== this.contact) {
      this.contact = contact;
      this.callbacks.onContact(contact);
    }
    this.audio.update({
      contact,
      tool: this.state.tool,
      pressure: Math.min(1, this.state.pressure * this.pointerPressure),
      speed: Math.min(
        1,
        contact ? motion * 0.6 : Math.abs(this.angularVelocity) / 2.3,
      ),
      wetness: this.state.wetness,
      x: this.pointer.x,
      wheel: Math.abs(this.angularVelocity) > 0.025,
      resistance,
    });
    this.updateParticles(dt);
    if (time - this.lastCutTime > 180 && (hit || this.clay.removed > 0)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastCutTime = time;
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const width = this.canvas.parentElement.clientWidth;
    const height = this.canvas.parentElement.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep the whole wheel in portrait canvases without shrinking the desktop piece.
    this.camera.fov = width / height < 0.8 ? 40 : 34;
    this.camera.updateProjectionMatrix();
  }

  updateMaterial() {
    this.material.roughness = 0.86 - this.state.wetness * 0.43;
    this.material.clearcoat = this.state.wetness * 0.28;
    this.material.clearcoatRoughness = 0.75 - this.state.wetness * 0.35;
    this.material.bumpScale = 0.018 - this.state.wetness * 0.01;
  }
  setColor(color) {
    this.material.color.set(color);
    this.chips.material.color.set(color).multiplyScalar(0.86);
    this.dustMesh.material.color.set(color);
  }
  clearParticles() {
    temp.scale.setScalar(0);
    temp.updateMatrix();
    this.particles.forEach((p, i) => {
      p.active = false;
      this.chips.setMatrixAt(i, temp.matrix);
      this.ribbons.setMatrixAt(i, temp.matrix);
    });
    this.chips.instanceMatrix.needsUpdate = true;
    this.ribbons.instanceMatrix.needsUpdate = true;
    this.dust.forEach((p) => {
      p.life = 0;
    });
    this.dustMesh.geometry.attributes.position.array.fill(-100);
    this.dustMesh.geometry.attributes.position.needsUpdate = true;
    this.renderer.shadowMap.needsUpdate = true;
    this.particleBudget = 0;
  }
  undo() {
    this.finishStroke();
    const previous = this.history.pop();
    if (!previous) return false;
    this.clay.restore(previous);
    this.syncGeometry();
    this.clearParticles();
    return true;
  }
  reset() {
    this.finishStroke();
    this.history = [];
    this.clay.reset();
    this.syncGeometry();
    this.clearParticles();
    this.resetView();
  }
  snapshot() {
    this.finishStroke();
    return this.clay.snapshot();
  }
  load(piece) {
    this.finishStroke();
    this.history = [];
    this.clay.restore({ radii: piece.radii, removed: piece.removed });
    this.syncGeometry();
    this.clearParticles();
    this.resetView();
  }
  capture() {
    const models = Object.values(this.toolModels);
    const visibility = models.map((m) => m.visible);
    models.forEach((m) => {
      m.visible = false;
    });
    this.renderer.render(this.scene, this.camera);
    const canvas = document.createElement("canvas");
    canvas.width = 540;
    canvas.height = 540;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2d3028";
    ctx.fillRect(0, 0, 540, 540);
    const aspect = this.canvas.width / this.canvas.height;
    const w = 540 * Math.min(1, aspect),
      h = 540 * Math.min(1, 1 / aspect);
    ctx.drawImage(this.canvas, (540 - w) / 2, (540 - h) / 2, w, h);
    models.forEach((m, i) => {
      m.visible = visibility[i];
    });
    return canvas.toDataURL("image/jpeg", 0.83);
  }
  resetView() {
    this.controls.reset();
  }
  rotateView() {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }
  setVisible(value) {
    this.visible = value;
    if (!value) {
      this.finishStroke();
      this.audio.update({ contact: false, wheel: false });
    }
  }
}
