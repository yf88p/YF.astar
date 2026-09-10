import * as THREE from "three";
import {
  coastline,
  createSurfaceTexture,
  createTerrain,
  noise2D,
  terrainHeight,
} from "./terrain.js";

export { terrainHeight } from "./terrain.js";

const SUN_DIRECTION = new THREE.Vector3(-0.57, 0.34, -0.75).normalize();
const UP = new THREE.Vector3(0, 1, 0);

function randomSource(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...extra });
}

function box(parent, geometry, mat, x, y, z, sx, sy, sz, rotation = 0) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.y = rotation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function instances(parent, geometry, mat, items, { shadow = false } = {}) {
  if (!items.length) {
    geometry.dispose();
    return null;
  }
  const mesh = new THREE.InstancedMesh(geometry, mat, items.length);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  items.forEach((item, i) => {
    transform.position.set(...item.p);
    transform.rotation.set(...(item.r || [0, 0, 0]));
    transform.scale.set(...(item.s || [1, 1, 1]));
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    if (item.c !== undefined) mesh.setColorAt(i, color.set(item.c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

function mergeGeometry(parts) {
  const positions = [];
  const normals = [];
  for (const part of parts) {
    const geometry = part.index ? part.toNonIndexed() : part;
    positions.push(...geometry.attributes.position.array);
    normals.push(...geometry.attributes.normal.array);
    if (geometry !== part) geometry.dispose();
    part.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function batchStaticBoxes(scene) {
  const batches = new Map();
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (
      !object.isMesh ||
      object.isInstancedMesh ||
      object.geometry.type !== "BoxGeometry"
    )
      return;
    const key = `${object.geometry.uuid}:${object.material.uuid}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(object);
  });
  for (const objects of batches.values()) {
    if (objects.length < 2) continue;
    const first = objects[0];
    const mesh = new THREE.InstancedMesh(
      first.geometry,
      first.material,
      objects.length,
    );
    objects.forEach((object, i) => {
      mesh.setMatrixAt(i, object.matrixWorld);
      object.removeFromParent();
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}

function ribbon(parent, points, width, mat, elevation = 0.18, fixedHeight) {
  const vertices = [];
  const indices = [];
  const samples = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector2(...points[i]);
    const b = new THREE.Vector2(...points[i + 1]);
    const count = Math.max(1, Math.ceil(a.distanceTo(b) / 22));
    for (let j = 0; j < count; j++) samples.push(a.clone().lerp(b, j / count));
  }
  samples.push(new THREE.Vector2(...points[points.length - 1]));
  samples.forEach((point, i) => {
    const before = samples[Math.max(0, i - 1)];
    const after = samples[Math.min(samples.length - 1, i + 1)];
    const direction = after.clone().sub(before).normalize();
    for (const side of [-1, 1]) {
      const x = point.x - direction.y * width * 0.5 * side;
      const z = point.y + direction.x * width * 0.5 * side;
      vertices.push(x, (fixedHeight ?? terrainHeight(x, z)) + elevation, z);
    }
    if (i < samples.length - 1) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeSky(scene) {
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      zenith: { value: new THREE.Color("#6195b5") },
      horizon: { value: new THREE.Color("#d7dfd5") },
      sunDirection: { value: SUN_DIRECTION },
      sunStrength: { value: 1 },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sunDirection;
      uniform float sunStrength;
      void main() {
        vec3 direction = normalize(vDirection);
        float height = max(direction.y, 0.0);
        vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 0.92, height), 0.55));
        float alignment = max(dot(direction, sunDirection), 0.0);
        color += vec3(0.36, 0.22, 0.09) * pow(alignment, 9.0) * sunStrength;
        color += vec3(0.8, 0.49, 0.18) * pow(alignment, 180.0) * sunStrength;
        color += vec3(4.0, 3.1, 1.9) * smoothstep(0.99972, 0.99986, alignment) * sunStrength;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skyMaterial);
  sky.name = "Infinite atmospheric sky";
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);
  return skyMaterial;
}

function makeOcean(scene, surfaceTexture) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      fogColor: { value: scene.fog.color.clone() },
      fogDensity: { value: scene.fog.density },
      sunDirection: { value: SUN_DIRECTION },
      sunStrength: { value: 1 },
      wind: { value: 1 },
      surfaceDetail: { value: surfaceTexture },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      uniform float time;
      uniform float wind;
      uniform vec3 fogColor;
      uniform float fogDensity;
      uniform vec3 sunDirection;
      uniform float sunStrength;
      uniform sampler2D surfaceDetail;
      void main() {
        vec2 p = vWorld.xz;
        float coast = -2200.0 + sin(p.y * 0.00052) * 500.0
          + 370.0 * sin(p.y * 0.00113)
          - 6400.0 * exp(-pow((p.y + 9600.0) / 4000.0, 2.0));
        float shallows = exp(-abs(p.x - coast + 80.0) * 0.0014);
        vec3 deep = vec3(0.045, 0.155, 0.205);
        vec3 color = mix(deep, vec3(0.115, 0.295, 0.29), shallows * 0.7);
        float distanceToCamera = distance(vWorld, cameraPosition);
        float t = time * 0.009;
        mat2 rotation = mat2(0.819, 0.574, -0.574, 0.819);
        vec2 drift = vec2(t * 0.67, -t * 0.41);
        vec2 warp = texture2D(surfaceDetail, p * 0.00073 + drift * 0.12).rg - 0.5;
        vec2 swell = texture2D(surfaceDetail, rotation * p * 0.0013 + warp * 0.23 + drift * 0.3).rg - 0.5;
        vec2 chop = texture2D(surfaceDetail, rotation * p * 0.0079 + warp * 0.41 - drift).gb - 0.5;
        float footprint = max(length(dFdx(p)), length(dFdy(p)));
        float rippleVisibility = (1.0 - smoothstep(1.2, 9.0, footprint))
          * (1.0 - smoothstep(550.0, 4200.0, distanceToCamera));
        vec2 wave = swell * 0.105 + chop * rippleVisibility * 0.12;
        wave *= 1.0 - smoothstep(9000.0, 25000.0, distanceToCamera);
        vec3 normal = normalize(vec3(wave.x * wind, 1.0, wave.y * wind));
        vec3 viewDirection = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(viewDirection, normal), 0.0), 4.0);
        color = mix(color, fogColor * 0.8, fresnel * 0.64);
        vec3 halfDirection = normalize(viewDirection + sunDirection);
        float glint = pow(max(dot(normal, halfDirection), 0.0), 110.0);
        color += vec3(0.7, 0.49, 0.27) * glint * sunStrength;
        color *= 1.0 + swell.x * 0.045;
        float fog = 1.0 - exp(-fogDensity * fogDensity * distanceToCamera * distanceToCamera);
        gl_FragColor = vec4(mix(color, fogColor, fog), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(600000, 600000), mat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = 0;
  ocean.name = "Open water";
  scene.add(ocean);
  return mat;
}

function makeClouds(scene, mobile) {
  const random = randomSource(90417);
  const texture = canvasTexture(512, 256, (ctx) => {
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < 44; i++) {
        const x = 95 + random() * 320;
        const y = 120 + (random() - 0.5) * 62 - layer * 18;
        const radius = 30 + random() * 54;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        const rgb = layer ? "255,251,238" : "158,175,179";
        gradient.addColorStop(0, `rgba(${rgb},0.27)`);
        gradient.addColorStop(0.45, `rgba(${rgb},0.20)`);
        gradient.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    }
  });
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      map: { value: texture },
      time: { value: 0 },
      tint: { value: new THREE.Color("#ffffff") },
      opacity: { value: 0.75 },
      fogColor: { value: scene.fog.color.clone() },
      fogDensity: { value: scene.fog.density },
    },
    vertexShader: `
      varying vec2 vUv;
      varying float vDistance;
      uniform float time;
      void main() {
        vUv = uv;
        vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        center.x += sin(time * 0.0004) * 1800.0;
        vec4 view = viewMatrix * center;
        view.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        vDistance = length(view.xyz);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vDistance;
      uniform sampler2D map;
      uniform vec3 tint;
      uniform float opacity;
      uniform vec3 fogColor;
      uniform float fogDensity;
      void main() {
        vec4 cloud = texture2D(map, vUv);
        float fog = 1.0 - exp(-fogDensity * fogDensity * vDistance * vDistance);
        vec3 color = mix(cloud.rgb * tint, fogColor, fog * 0.7);
        gl_FragColor = vec4(color, cloud.a * opacity * smoothstep(30.0, 200.0, vDistance));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const items = [];
  const count = mobile ? 42 : 68;
  for (let i = 0; i < count; i++) {
    const width = 1800 + random() * 3300;
    items.push({
      p: [
        (random() - 0.5) * 42000,
        2600 + random() * 2100,
        (random() - 0.5) * 42000,
      ],
      s: [width, width * (0.18 + random() * 0.09), 1],
    });
  }
  const clouds = instances(scene, new THREE.PlaneGeometry(1, 1), mat, items);
  clouds.name = "Layered maritime clouds";
  clouds.frustumCulled = false;
  return mat;
}

function makeAirport(scene) {
  const group = new THREE.Group();
  group.name = "Cape Alder Regional - runway 18 / 36";
  scene.add(group);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const asphalt = material("#555b58");
  const shoulder = material("#a4a38d");
  const concrete = material("#aaa99a");
  const cream = material("#dedbd0");
  const dark = material("#34464a", { metalness: 0.35 });
  const white = material("#eeeee1");
  const yellow = material("#dcb34d");
  const orange = material("#c56b3c");
  const glass = material("#487782", { roughness: 0.19, metalness: 0.55 });

  box(group, cube, shoulder, 0, 17.995, 0, 58, 0.05, 1740);
  const runwayMap = canvasTexture(512, 4096, (ctx, width, height) => {
    const random = randomSource(735);
    ctx.fillStyle = "#555c5b";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 34000; i++) {
      ctx.fillStyle =
        random() > 0.5 ? "rgba(255,255,240,0.022)" : "rgba(0,0,0,0.04)";
      ctx.fillRect(
        random() * width,
        random() * height,
        1 + random() * 3,
        1 + random() * 5,
      );
    }
    const sx = width / 50;
    const sz = height / 1700;
    ctx.fillStyle = "#e4e6db";
    ctx.fillRect(sx * 1.5, 0, sx * 0.38, height);
    ctx.fillRect(sx * 48.12, 0, sx * 0.38, height);
    for (let z = 150; z < 1550; z += 55)
      ctx.fillRect(width / 2 - sx * 0.3, z * sz, sx * 0.6, 28 * sz);
    for (const end of [false, true]) {
      ctx.save();
      if (end) {
        ctx.translate(width, height);
        ctx.rotate(Math.PI);
      }
      for (let i = 0; i < 10; i++) {
        const x = i < 5 ? 4 + i * 3.6 : 29 + (i - 5) * 3.6;
        ctx.fillRect(x * sx, 18 * sz, 2.2 * sx, 33 * sz);
      }
      ctx.save();
      ctx.translate(width / 2, 100 * sz);
      ctx.rotate(Math.PI);
      ctx.scale(1, 1.9);
      ctx.font = "bold 116px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(end ? "36" : "18", 0, 0);
      ctx.restore();
      for (const x of [9, 35]) ctx.fillRect(x * sx, 290 * sz, 6 * sx, 42 * sz);
      for (const z of [155, 450]) {
        for (const x of [10, 15, 33, 38])
          ctx.fillRect(x * sx, z * sz, 1.5 * sx, 22 * sz);
      }
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(20,25,25,${random() * 0.065})`;
        ctx.fillRect(
          (20 + random() * 10) * sx,
          (155 + random() * 250) * sz,
          0.1 * sx,
          (30 + random() * 95) * sz,
        );
      }
      ctx.fillStyle = "#e4e6db";
      ctx.restore();
    }
  });
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 1700),
    material("#ffffff", { map: runwayMap }),
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.y = 18.045;
  runway.receiveShadow = true;
  runway.name = "Runway pavement at 18 m";
  group.add(runway);

  ribbon(
    group,
    [
      [90, -790],
      [90, 790],
    ],
    15,
    asphalt,
    0.065,
    18,
  );
  ribbon(
    group,
    [
      [90, -790],
      [90, 790],
    ],
    0.24,
    yellow,
    0.085,
    18,
  );
  for (const z of [-740, -220, 440, 740]) {
    ribbon(
      group,
      [
        [26, z],
        [48, z],
        [75, z + 38],
        [90, z + 45],
      ],
      15,
      asphalt,
      0.065,
      18,
    );
    ribbon(
      group,
      [
        [26, z],
        [48, z],
        [75, z + 38],
        [90, z + 45],
      ],
      0.24,
      yellow,
      0.09,
      18,
    );
    for (const offset of [0, 0.9])
      box(group, cube, yellow, 46 + offset, 18.092, z, 0.22, 0.015, 14);
  }
  box(group, cube, concrete, 179, 18.005, 80, 178, 0.1, 650);
  for (let z = -180; z <= 330; z += 85) {
    ribbon(
      group,
      [
        [110, z],
        [159, z],
        [175, z + 16],
      ],
      0.25,
      yellow,
      0.075,
      18,
    );
    ribbon(
      group,
      [
        [146, z - 17],
        [175, z - 17],
        [175, z + 17],
      ],
      0.18,
      white,
      0.077,
      18,
    );
  }
  const roof = material("#677471", { metalness: 0.3, roughness: 0.55 });
  for (let i = 0; i < 4; i++) {
    const z = -175 + i * 145;
    box(group, cube, cream, 302, 25, z, 62, 14, 94);
    box(group, cube, dark, 270.85, 23.8, z, 0.12, 11.6, 76);
    for (let rib = 0; rib < 9; rib++)
      box(group, cube, roof, 270.73, 23.8, z - 36 + rib * 9, 0.12, 11.6, 0.18);
    for (const side of [-1, 1]) {
      const panel = box(
        group,
        cube,
        roof,
        302 + side * 16,
        33.5,
        z,
        33,
        0.45,
        99,
      );
      panel.rotation.z = -side * 0.1;
    }
    box(group, cube, orange, 270.6, 31.6, z, 0.18, 0.65, 79);
  }
  box(group, cube, cream, 223, 23.5, -460, 75, 11, 52);
  box(group, cube, roof, 223, 29.3, -460, 79, 1.1, 56);
  box(group, cube, glass, 184.9, 25.7, -460, 0.15, 4.8, 47);
  box(group, cube, concrete, 244, 30, -391, 12, 24, 12);
  box(group, cube, dark, 244, 42.3, -391, 19, 1.4, 19);
  box(group, cube, glass, 244, 45, -391, 17, 4.5, 17);
  box(group, cube, cream, 244, 47.7, -391, 21, 0.7, 21);
  box(group, cube, dark, 244, 52, -391, 0.22, 8, 0.22);

  const signMap = canvasTexture(1024, 128, (ctx, width, height) => {
    ctx.fillStyle = "#283d40";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#efe9d6";
    ctx.font = "500 54px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("C A P E   A L D E R", width / 2, height / 2);
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 4.5),
    material("#ffffff", { map: signMap }),
  );
  sign.position.set(184.7, 28, -460);
  sign.rotation.y = -Math.PI / 2;
  group.add(sign);

  const lamps = [];
  const posts = [];
  for (let z = -840; z <= 840; z += 60) {
    for (const x of [-27, 27]) {
      lamps.push({ p: [x, 18.42, z], s: [0.25, 0.18, 0.25] });
      posts.push({ p: [x, 18.2, z], s: [0.07, 0.4, 0.07] });
    }
  }
  const greenLamps = [];
  const redLamps = [];
  for (const end of [-1, 1]) {
    for (let x = -22; x <= 22; x += 4) {
      greenLamps.push({ p: [x, 18.3, end * 858], s: [0.3, 0.18, 0.3] });
    }
    for (let distance = 30; distance <= 360; distance += 30) {
      const z = end * (850 + distance);
      const y = terrainHeight(0, z) + 1.2;
      posts.push({ p: [0, y - 0.6, z], s: [0.1, 1.2, 0.1] });
      const count = distance === 180 ? 5 : 1;
      for (let i = -count; i <= count; i++)
        lamps.push({ p: [i * 2.1, y, z], s: [0.25, 0.2, 0.25] });
    }
    for (let i = 0; i < 4; i++) {
      (i < 2 ? lamps : redLamps).push({
        p: [-43 - i * 5, 18.8, end * 535],
        s: [0.7, 0.35, 0.5],
      });
    }
  }
  instances(group, cube.clone(), dark, posts);
  const lampGeometry = new THREE.SphereGeometry(1, 6, 4);
  instances(
    group,
    lampGeometry,
    material("#fff3c5", { emissive: "#ffd899", emissiveIntensity: 2.5 }),
    lamps,
  );
  instances(
    group,
    lampGeometry.clone(),
    material("#88edac", { emissive: "#42dd85", emissiveIntensity: 2 }),
    greenLamps,
  );
  instances(
    group,
    lampGeometry.clone(),
    material("#ff7750", { emissive: "#ff331b", emissiveIntensity: 2 }),
    redLamps,
  );
  for (let n = 1; n <= 5; n++) {
    const map = canvasTexture(64, 96, (ctx) => {
      ctx.fillStyle = "#242d2b";
      ctx.fillRect(0, 0, 64, 96);
      ctx.fillStyle = "#efeee3";
      ctx.textAlign = "center";
      ctx.font = "bold 73px Arial";
      ctx.fillText(String(n), 32, 76);
    });
    const mat = material("#ffffff", { map });
    const signs = [];
    for (const side of [-1, 1]) {
      signs.push({
        p: [side * 37, 19.25, -850 + n * 304.8],
        s: [1.15, 1.65, 1],
      });
      signs.push({
        p: [side * 37, 19.25, 850 - n * 304.8],
        s: [1.15, 1.65, 1],
        r: [0, Math.PI, 0],
      });
    }
    instances(group, new THREE.PlaneGeometry(1, 1), mat, signs);
  }

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.085, 8, 8),
    cream,
  );
  pole.position.set(-77, 22, 460);
  group.add(pole);
  const windsock = new THREE.Group();
  windsock.position.set(-77, 26, 460);
  group.add(windsock);
  for (let i = 0; i < 5; i++) {
    const sock = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.38 - i * 0.052,
        0.328 - i * 0.052,
        0.53,
        12,
        1,
        true,
      ),
      i % 2 ? white : orange,
    );
    sock.rotation.z = Math.PI / 2;
    sock.position.set(i * 0.52 + 0.25, -i * 0.035, 0);
    windsock.add(sock);
  }
  const boundary = [];
  for (let z = -1000; z <= 1050; z += 24) {
    boundary.push({ p: [363, 19, z], s: [0.08, 2, 0.08] });
  }
  instances(group, cube.clone(), dark, boundary);
  ribbon(
    group,
    [
      [363, -1000],
      [363, 1050],
    ],
    0.065,
    dark,
    2,
    18,
  );
  return windsock;
}

function makeTown(scene, mobile) {
  const group = new THREE.Group();
  group.name = "Alder town, coast road and fishing harbor";
  scene.add(group);
  const random = randomSource(50714);
  const road = material("#73756a");
  const stripe = material("#d3caae");
  ribbon(
    group,
    [
      [355, -460],
      [470, -430],
      [650, 100],
      [780, 650],
      [1100, 1150],
      [2100, 2200],
      [3000, 3400],
      [4100, 5400],
      [5000, 7500],
    ],
    13,
    road,
  );
  ribbon(
    group,
    [
      [-1500, 2200],
      [-1100, 1650],
      [-750, 1460],
      [0, 1480],
      [780, 1500],
      [2200, 1500],
      [3600, 1100],
      [4200, -500],
      [4000, -2500],
      [3150, -4500],
    ],
    12,
    road,
  );
  const roadXs = [700, 980, 1260, 1540, 1820];
  const roadZs = [670, 950, 1230, 1510, 1790, 2070, 2350, 2630];
  for (const x of roadXs)
    ribbon(
      group,
      [
        [x, 610],
        [x, 2700],
      ],
      9,
      road,
    );
  for (const z of roadZs)
    ribbon(
      group,
      [
        [650, z],
        [1890, z],
      ],
      9,
      road,
    );
  ribbon(
    group,
    [
      [-1500, 2200],
      [-1100, 1650],
      [-750, 1460],
      [0, 1480],
      [780, 1500],
    ],
    0.18,
    stripe,
    0.2,
  );

  const facade = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = "#f6f2e9";
    ctx.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 4; column++) {
        const x = 9 + column * 31;
        const y = 12 + row * 37;
        ctx.fillStyle = "#aaa99e";
        ctx.fillRect(x - 2, y - 2, 18, 24);
        ctx.fillStyle = "#53696c";
        ctx.fillRect(x, y, 14, 19);
        ctx.fillStyle = "#aebabb";
        ctx.fillRect(x + 1, y + 1, 5, 8);
        ctx.fillStyle = "#e6e1d3";
        ctx.fillRect(x - 3, y + 21, 20, 3);
      }
    }
  });
  const walls = [];
  const roofs = [];
  const colors = [
    "#d6cab4",
    "#e0d8c5",
    "#c5c7b8",
    "#e4d5bb",
    "#c3b49c",
    "#d9cfbc",
  ];
  const roofColors = ["#8f6550", "#9e765b", "#a18167", "#687572", "#b08969"];
  for (let x = 735; x < 1820; x += 45) {
    for (let z = 710; z < 2620; z += 47) {
      if (
        random() < 0.23 ||
        roadXs.some((rx) => Math.abs(rx - x) < 26) ||
        roadZs.some((rz) => Math.abs(rz - z) < 25)
      )
        continue;
      const px = x + (random() - 0.5) * 9;
      const pz = z + (random() - 0.5) * 9;
      const ground = terrainHeight(px, pz);
      if (Math.abs(terrainHeight(px + 16, pz) - ground) > 5) continue;
      const width = 12 + random() * 13;
      const depth = 15 + random() * 15;
      const height = 7 + random() * 12;
      const rotation = random() < 0.5 ? 0 : Math.PI / 2;
      walls.push({
        p: [px, ground + height * 0.5 - 1, pz],
        s: [width, height + 2, depth],
        r: [0, rotation, 0],
        c: colors[Math.floor(random() * colors.length)],
      });
      roofs.push({
        p: [px, ground + height, pz],
        s: [width * 0.54, 2.5 + random() * 3, depth * 0.55],
        r: [0, rotation, 0],
        c: roofColors[Math.floor(random() * roofColors.length)],
      });
    }
  }
  instances(
    group,
    new THREE.BoxGeometry(1, 1, 1),
    material("#ffffff", { map: facade }),
    walls,
  );
  const roofGeometry = new THREE.BufferGeometry();
  roofGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -1, 0, -1, 0, 1, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1, 0, 1, 1, -1, 0, -1,
        -1, 0, 1, 0, 1, -1, -1, 0, 1, 0, 1, 1, 0, 1, -1, 0, 1, -1, 0, 1, 1, 1,
        0, -1, 0, 1, 1, 1, 0, 1, 1, 0, -1,
      ],
      3,
    ),
  );
  roofGeometry.computeVertexNormals();
  instances(group, roofGeometry, material("#ffffff"), roofs);

  // Locate the waterfront on the actual analytic shoreline, not an assumed sea level.
  const harborZ = 2100;
  let harborX = coastline(harborZ) - 300;
  while (terrainHeight(harborX, harborZ) < 3) harborX += 8;
  const concrete = material("#a4a698");
  const timber = material("#8f8570");
  const steel = material("#465e63", { metalness: 0.3 });
  const cube = new THREE.BoxGeometry(1, 1, 1);
  box(group, cube, concrete, harborX - 23, 2, harborZ, 55, 4, 260);
  ribbon(
    group,
    [
      [harborX + 8, harborZ],
      [-1500, 2200],
    ],
    10,
    road,
    0.22,
  );
  const piles = [];
  for (let i = 0; i < 4; i++) {
    const z = harborZ - 95 + i * 65;
    box(group, cube, timber, harborX - 105, 2.5, z, 165, 0.65, 6);
    for (let x = harborX - 185; x < harborX - 20; x += 18) {
      for (const side of [-1, 1])
        piles.push({ p: [x, 0.5, z + side * 2.4], s: [0.45, 5, 0.45] });
    }
  }
  instances(group, cube.clone(), timber, piles);
  box(
    group,
    cube,
    concrete,
    harborX - 180,
    1.5,
    harborZ - 200,
    380,
    4,
    12,
    0.12,
  );
  const warehouse = material("#c9c5af");
  for (let i = 0; i < 5; i++) {
    const x = harborX + 70;
    const z = harborZ - 140 + i * 65;
    const y = terrainHeight(x, z);
    box(group, cube, warehouse, x, y + 5, z, 45, 10, 30);
    box(group, cube, steel, x, y + 10.5, z, 47, 1, 32);
  }
  const hulls = [];
  const cabins = [];
  const masts = [];
  for (let i = 0; i < (mobile ? 18 : 30); i++) {
    const dock = i % 4;
    const x = harborX - 40 - Math.floor(i / 4) * 19;
    const z = harborZ - 95 + dock * 65 + (i % 2 ? 11 : -11);
    const length = 7 + random() * 6;
    hulls.push({
      p: [x, 0.6, z],
      s: [1.7 + random() * 0.5, 1.2, length * 0.5],
      c: i % 4 ? "#deded1" : "#507280",
    });
    cabins.push({ p: [x, 1.8, z], s: [2, 1.7, length * 0.32] });
    if (i % 3 !== 0) masts.push({ p: [x, 6, z - 1], s: [0.07, 11, 0.07] });
  }
  const hullGeometry = new THREE.SphereGeometry(1, 8, 6);
  instances(group, hullGeometry, material("#ffffff"), hulls);
  instances(group, cube.clone(), material("#e7e4d7"), cabins);
  instances(group, cube.clone(), steel, masts);
  const lighthouseX = harborX - 180 - 185 * Math.cos(0.12);
  const lighthouseZ = harborZ - 200 + 185 * Math.sin(0.12);
  const lighthouse = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 3.8, 19, 12),
    warehouse,
  );
  lighthouse.position.set(lighthouseX, 11, lighthouseZ);
  group.add(lighthouse);
  box(group, cube, steel, lighthouseX, 21, lighthouseZ, 6.3, 1, 6.3);
  box(
    group,
    cube,
    material("#f9d99e", { emissive: "#ffc780", emissiveIntensity: 0.9 }),
    lighthouseX,
    22.4,
    lighthouseZ,
    4.1,
    2,
    4.1,
  );
}

function makeVegetation(scene, mobile) {
  const random = randomSource(13928);
  const pines = [];
  const broadleaves = [];
  const trunks = [];
  const count = mobile ? 6300 : 11500;
  let groveX = 0;
  let groveZ = 0;
  for (
    let attempt = 0;
    attempt < count * 5 && pines.length + broadleaves.length < count;
    attempt++
  ) {
    if (attempt % 12 === 0) {
      const nearby = attempt % 36 === 0;
      groveX = (random() - 0.5) * (nearby ? 7000 : 29000);
      groveZ = (random() - 0.5) * (nearby ? 8000 : 29000);
    }
    const x = groveX + (random() - 0.5) * 230;
    const z = groveZ + (random() - 0.5) * 230;
    if (Math.abs(x) < 500 && Math.abs(z) < 1370) continue;
    if (x > 570 && x < 1980 && z > 540 && z < 2800) continue;
    if (x < -1200 && x > -2300 && z > 1800 && z < 2400) continue;
    const y = terrainHeight(x, z);
    if (y < 24 || y > 1780) continue;
    const density = noise2D(x * 0.0009 + 50, z * 0.0009 - 30);
    if (density < 0.31 || random() > 0.4 + density * 0.6) continue;
    if (
      Math.abs(terrainHeight(x + 14, z) - y) +
        Math.abs(terrainHeight(x, z + 14) - y) >
      16
    )
      continue;
    const height = 9 + random() * 14;
    const pine = y > 500 || random() > 0.38;
    const width = height * (pine ? 0.21 : 0.33);
    const color = new THREE.Color(pine ? "#426454" : "#657e51").multiplyScalar(
      0.8 + random() * 0.4,
    );
    (pine ? pines : broadleaves).push({
      p: [x, y - 0.4, z],
      s: [width, height, width],
      r: [0, random() * Math.PI * 2, 0],
      c: color,
    });
    trunks.push({
      p: [x, y + height * 0.22, z],
      s: [0.15 + height * 0.008, height * 0.45, 0.15 + height * 0.008],
    });
  }
  const crown = mergeGeometry([
    new THREE.ConeGeometry(1, 0.53, 6, 1, true).translate(0, 0.47, 0),
    new THREE.ConeGeometry(0.82, 0.49, 6, 1, true).translate(0, 0.65, 0),
    new THREE.ConeGeometry(0.57, 0.43, 6, 1, true).translate(0, 0.81, 0),
  ]);
  const leafGeometry = mergeGeometry([
    new THREE.IcosahedronGeometry(1, 0)
      .scale(0.9, 0.29, 0.87)
      .translate(0, 0.68, 0),
    new THREE.IcosahedronGeometry(1, 0)
      .scale(0.65, 0.25, 0.66)
      .translate(0.35, 0.76, 0.15),
    new THREE.IcosahedronGeometry(1, 0)
      .scale(0.57, 0.24, 0.68)
      .translate(-0.32, 0.57, -0.13),
  ]);
  const foliage = material("#ffffff", { roughness: 1 });
  const trunkGeometry = new THREE.CylinderGeometry(0.65, 1, 1, 4, 1, true);
  // Regional batches allow normal frustum culling to skip whole forests behind the camera.
  for (const [geometry, mat, items] of [
    [crown, foliage, pines],
    [leafGeometry, foliage, broadleaves],
    [trunkGeometry, material("#6b6651"), trunks],
  ]) {
    const tiles = new Map();
    for (const item of items) {
      const key = `${Math.floor(item.p[0] / 4500)}:${Math.floor(item.p[2] / 4500)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(item);
    }
    for (const itemsInTile of tiles.values()) {
      const mesh = instances(scene, geometry, mat, itemsInTile);
      mesh.name = "Forest grove";
      mesh.receiveShadow = false;
    }
  }
}

export function createWorld(renderer) {
  const mobile =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(pointer: coarse)").matches ||
      window.innerWidth < 720);
  const scene = new THREE.Scene();
  scene.name = "Cape Alder";
  scene.background = new THREE.Color("#d7dfd5");
  scene.fog = new THREE.FogExp2("#d7dfd5", 0.000047);
  const surfaceTexture = createSurfaceTexture();
  scene.add(createTerrain({ mobile, detailTexture: surfaceTexture }));
  const sky = makeSky(scene);
  const ocean = makeOcean(scene, surfaceTexture);
  const clouds = makeClouds(scene, mobile);
  const hemisphere = new THREE.HemisphereLight("#d9e9f2", "#77775a", 1.9);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight("#ffe0b0", 2.8);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(11000);
  sun.target.position.set(0, 18, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, {
    left: -420,
    right: 420,
    top: 420,
    bottom: -420,
    near: 100,
    far: 15000,
  });
  sun.shadow.bias = -0.00008;
  sun.shadow.normalBias = 0.35;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const shadowCenter = new THREE.Vector3();
  // Keep a detailed local shadow map without paying for a 36 km shadow frustum.
  scene.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(shadowCenter);
    const texel = 840 / sun.shadow.mapSize.x;
    shadowCenter.x = Math.round(shadowCenter.x / texel) * texel;
    shadowCenter.z = Math.round(shadowCenter.z / texel) * texel;
    shadowCenter.y = Math.max(0, terrainHeight(shadowCenter.x, shadowCenter.z));
    sun.target.position.copy(shadowCenter);
    sun.position.copy(shadowCenter).addScaledVector(SUN_DIRECTION, 11000);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  };
  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  const windsock = makeAirport(scene);
  makeTown(scene, mobile);
  makeVegetation(scene, mobile);
  batchStaticBoxes(scene);

  const presets = {
    clear: {
      haze: 0.000047,
      sky: "#6195b5",
      fog: "#d7dfd5",
      sun: 2.8,
      cloud: 0.7,
      wind: 1,
    },
    hazy: {
      haze: 0.000086,
      sky: "#91aebc",
      fog: "#dddcc9",
      sun: 2.25,
      cloud: 0.6,
      wind: 0.7,
    },
    cloudy: {
      haze: 0.000061,
      sky: "#829eae",
      fog: "#cbd3d1",
      sun: 1.65,
      cloud: 0.95,
      wind: 1.3,
    },
    overcast: {
      haze: 0.00009,
      sky: "#87969c",
      fog: "#b6c0bf",
      sun: 0.7,
      cloud: 1,
      wind: 1.6,
    },
    rain: {
      haze: 0.00015,
      sky: "#697e8c",
      fog: "#94a7ac",
      sun: 0.48,
      cloud: 1,
      wind: 2.2,
    },
    storm: {
      haze: 0.00019,
      sky: "#485c6b",
      fog: "#7f959e",
      sun: 0.3,
      cloud: 1,
      wind: 2.8,
    },
    sunset: {
      haze: 0.000055,
      sky: "#778eaa",
      fog: "#e5c9a5",
      sun: 2.3,
      cloud: 0.76,
      wind: 0.8,
    },
  };
  let currentWeather = "clear";
  let disposed = false;
  function setWeather(name = "clear") {
    const key = name === "fog" || name === "foggy" ? "hazy" : name;
    const preset = presets[key] || presets.clear;
    currentWeather = key in presets ? key : "clear";
    scene.fog.color.set(preset.fog);
    scene.fog.density = preset.haze;
    scene.background.copy(scene.fog.color);
    sky.uniforms.zenith.value.set(preset.sky);
    sky.uniforms.horizon.value.copy(scene.fog.color);
    sky.uniforms.sunStrength.value = preset.sun / 2.8;
    sun.intensity = preset.sun;
    hemisphere.intensity = currentWeather === "storm" ? 1.15 : 1.9;
    clouds.uniforms.opacity.value = preset.cloud;
    clouds.uniforms.tint.value.set(
      currentWeather === "storm" ? "#939da6" : "#fffaf0",
    );
    ocean.uniforms.sunStrength.value = preset.sun / 2.8;
    ocean.uniforms.wind.value = preset.wind;
    for (const mat of [ocean, clouds]) {
      mat.uniforms.fogColor.value.copy(scene.fog.color);
      mat.uniforms.fogDensity.value = preset.haze;
    }
  }
  setWeather("clear");
  return {
    scene,
    terrainHeight,
    setWeather,
    update(time, weather) {
      if (disposed) return;
      if (weather !== undefined && weather !== currentWeather)
        setWeather(weather);
      const seconds = Number.isFinite(time) ? time : 0;
      ocean.uniforms.time.value = seconds;
      clouds.uniforms.time.value = seconds;
      windsock.rotation.y = -0.6 + Math.sin(seconds * 0.43) * 0.13;
      windsock.rotation.z = Math.sin(seconds * 1.6) * 0.035;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.isInstancedMesh) object.dispose();
        for (const mat of object.material
          ? Array.isArray(object.material)
            ? object.material
            : [object.material]
          : []) {
          materials.add(mat);
          for (const value of Object.values(mat))
            if (value?.isTexture) textures.add(value);
          for (const value of Object.values(mat.userData || {}))
            if (value?.isTexture) textures.add(value);
          for (const uniform of Object.values(mat.uniforms || {}))
            if (uniform.value?.isTexture) textures.add(uniform.value);
        }
      });
      textures.forEach((texture) => texture.dispose());
      materials.forEach((mat) => mat.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      sun.shadow.dispose();
      scene.onBeforeRender = () => {};
      scene.clear();
    },
  };
}

function fuselageGeometry(
  rings,
  segments = 36,
  angleStart = 0,
  angleEnd = Math.PI * 2,
) {
  const positions = [];
  const indices = [];
  for (const [z, rx, ry, y] of rings) {
    for (let i = 0; i <= segments; i++) {
      const angle = angleStart + ((angleEnd - angleStart) * i) / segments;
      positions.push(Math.sin(angle) * rx, Math.cos(angle) * ry + y, z);
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      const a = ring * (segments + 1) + i;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function airfoilGeometry(span, chord, z, y, dihedral, accent, tail = false) {
  const vertices = [];
  const colors = [];
  const indices = [];
  const rings = [0, 0.1, 0.42, 0.73, 0.84, 0.94, 0.985, 1];
  const steps = 24;
  const white = new THREE.Color("#eeeade");
  const stripe = new THREE.Color(accent);
  const wingtip = new THREE.Color("#344b50");
  for (const side of [-1, 1]) {
    const base = vertices.length / 3;
    rings.forEach((fraction) => {
      const taper = tail
        ? 1 - fraction * 0.5
        : 1 - fraction * 0.2 - Math.max(0, fraction - 0.94) * 7;
      const localChord = chord * taper;
      for (let j = 0; j <= steps; j++) {
        const angle = (Math.PI * 2 * j) / steps;
        const t = (1 - Math.cos(angle)) * 0.5;
        const thickness =
          5 *
          (tail ? 0.085 : 0.135) *
          localChord *
          (0.2969 * Math.sqrt(t) -
            0.126 * t -
            0.3516 * t * t +
            0.2843 * t ** 3 -
            0.1036 * t ** 4);
        const camber = Math.sin(t * Math.PI) * localChord * (tail ? 0 : 0.016);
        vertices.push(
          side * fraction * span * 0.5,
          y +
            Math.sign(Math.sin(angle)) * thickness +
            camber +
            fraction * dihedral,
          z + (t - 0.36) * localChord + fraction * (tail ? 0.35 : 0.25),
        );
        const color =
          fraction > 0.985
            ? wingtip
            : fraction >= 0.84 && fraction <= 0.94
              ? stripe
              : white;
        color.toArray(colors, colors.length);
      }
    });
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < steps; j++) {
        const a = base + i * (steps + 1) + j;
        const b = a + steps + 1;
        if (side > 0) indices.push(a, a + 1, b, a + 1, b + 1, b);
        else indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const tip = base + (rings.length - 1) * (steps + 1);
    for (let j = 1; j < steps - 1; j++) {
      if (side > 0) indices.push(tip, tip + j, tip + j + 1);
      else indices.push(tip, tip + j + 1, tip + j);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function rod(parent, start, end, radius, mat, segments = 8) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), segments),
    mat,
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  parent.add(mesh);
  return mesh;
}

export function createAircraft(type = "trainer") {
  if (!["trainer", "tourer", "sport"].includes(type)) type = "trainer";
  const trainer = type === "trainer";
  const sport = type === "sport";
  const group = new THREE.Group();
  group.name = `${type} aircraft`;
  const accent = sport ? "#bc5030" : "#d4783d";
  const cream = material("#eeeade", { roughness: 0.31, metalness: 0.19 });
  const orange = material(accent, { roughness: 0.32, metalness: 0.18 });
  const charcoal = material("#2d4147", { roughness: 0.32, metalness: 0.3 });
  const metal = material("#b8bfbb", { roughness: 0.27, metalness: 0.78 });
  const rubber = material("#242a2b", { roughness: 0.91 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: "#446b79",
    metalness: 0.3,
    roughness: 0.12,
    transparent: true,
    opacity: 0.79,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const rings = [
    [-3.62, 0.09, 0.11, -0.02],
    [-3.48, 0.33, 0.35, -0.02],
    [-3.15, 0.46, 0.46, -0.025],
    [-2.7, 0.5, 0.51, -0.025],
    [-2.0, 0.56, 0.59, 0],
    [-1.2, 0.61, 0.65, 0.015],
    [-0.4, 0.62, 0.67, 0.035],
    [0.45, 0.58, 0.6, 0.07],
    [1.25, 0.46, 0.45, 0.12],
    [2.15, 0.29, 0.3, 0.18],
    [2.95, 0.17, 0.2, 0.23],
    [3.55, 0.08, 0.12, 0.27],
    [3.82, 0.012, 0.035, 0.29],
  ];
  if (sport) {
    for (const ring of rings) {
      ring[1] *= 0.84;
      ring[2] *= 0.9;
    }
  }
  const fuselage = new THREE.Mesh(fuselageGeometry(rings), cream);
  group.add(fuselage);
  for (const side of [-1, 1]) {
    const stripeRings = rings
      .slice(2)
      .map(([z, rx, ry, y]) => [z, rx + 0.008, ry + 0.008, y]);
    const centerAngle = (side * Math.PI) / 2;
    group.add(
      new THREE.Mesh(
        fuselageGeometry(
          stripeRings,
          5,
          centerAngle - 0.11,
          centerAngle + 0.11,
        ),
        orange,
      ),
    );
    group.add(
      new THREE.Mesh(
        fuselageGeometry(
          stripeRings,
          3,
          centerAngle + (side > 0 ? 0.15 : -0.2),
          centerAngle + (side > 0 ? 0.2 : -0.15),
        ),
        charcoal,
      ),
    );
  }
  const span = sport ? 8.2 : trainer ? 10.9 : 11.6;
  const wingY = trainer ? 1.02 : -0.37;
  const wingZ = trainer ? -0.29 : -0.12;
  const wingMaterial = material("#ffffff", {
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.18,
    side: THREE.DoubleSide,
  });
  const wings = new THREE.Mesh(
    airfoilGeometry(
      span,
      sport ? 1.6 : 1.7,
      wingZ,
      wingY,
      trainer ? 0.11 : 0.34,
      accent,
    ),
    wingMaterial,
  );
  group.add(wings);
  group.add(
    new THREE.Mesh(
      airfoilGeometry(sport ? 3.25 : 3.8, 0.96, 2.91, 0.36, 0.08, accent, true),
      wingMaterial,
    ),
  );

  const finShape = new THREE.Shape();
  finShape.moveTo(1.96, 0.34);
  finShape.bezierCurveTo(2.4, 0.68, 2.53, 1.82, 2.92, 2.02);
  finShape.quadraticCurveTo(3.13, 2.12, 3.36, 2.04);
  finShape.lineTo(3.7, 0.48);
  finShape.quadraticCurveTo(3.71, 0.28, 3.52, 0.28);
  finShape.lineTo(1.96, 0.34);
  const finGeometry = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.085,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.035,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 12,
  });
  finGeometry.rotateY(-Math.PI / 2);
  finGeometry.translate(0.043, 0, 0);
  group.add(new THREE.Mesh(finGeometry, orange));
  rod(group, [0, 0.65, 3.6], [0, 1.88, 3.31], 0.018, charcoal);
  for (const side of [-1, 1]) {
    rod(
      group,
      [side * 0.08, 1.54, 3.05],
      [side * 0.08, 1.54, 3.4],
      0.047,
      cream,
    );
    if (trainer) {
      rod(
        group,
        [side * 0.54, -0.32, 0.5],
        [side * 3.72, 1.1, 0.05],
        0.038,
        cream,
      );
      rod(
        group,
        [side * 0.55, -0.3, 0.62],
        [side * 3.72, 1.1, 0.64],
        0.03,
        cream,
      );
    }
  }

  const canopyRings = trainer
    ? [
        [-1.65, 0.44, 0.12, 0.49],
        [-1.06, 0.55, 0.65, 0.48],
        [-0.78, 0.57, 0.7, 0.47],
        [0.43, 0.53, 0.66, 0.44],
        [0.94, 0.44, 0.3, 0.41],
        [1.14, 0.38, 0.02, 0.4],
      ]
    : [
        [-1.58, 0.32, 0.04, 0.55],
        [-1.2, 0.48, 0.4, 0.55],
        [-0.67, sport ? 0.45 : 0.56, 0.68, 0.52],
        [0.05, sport ? 0.43 : 0.54, 0.72, 0.49],
        [0.66, 0.39, 0.48, 0.44],
        [1.13, 0.23, 0.04, 0.42],
      ];
  const canopy = new THREE.Mesh(
    fuselageGeometry(canopyRings, 24, -Math.PI / 2, Math.PI / 2),
    glass,
  );
  canopy.renderOrder = 2;
  group.add(canopy);
  for (const side of [-1, 1]) {
    for (let i = 0; i < canopyRings.length - 1; i++) {
      const a = canopyRings[i];
      const b = canopyRings[i + 1];
      rod(
        group,
        [side * a[1], a[3], a[0]],
        [side * b[1], b[3], b[0]],
        0.025,
        cream,
      );
    }
    if (trainer) {
      rod(
        group,
        [side * 0.54, 0.46, -1.1],
        [side * 0.4, 1.05, -0.98],
        0.029,
        cream,
      );
      rod(
        group,
        [side * 0.54, 0.45, 0.37],
        [side * 0.39, 1.01, 0.37],
        0.032,
        cream,
      );
      rod(
        group,
        [side * 0.61, 0.12, -0.7],
        [side * 0.6, 0.12, -0.46],
        0.018,
        metal,
      );
    }
  }
  rod(group, [0, 0.61, -1.65], [0, 1.13, -1.03], 0.025, cream);
  const seatGeometry = new THREE.BoxGeometry(0.38, 0.49, 0.17);
  for (const x of sport ? [0] : [-0.27, 0.27]) {
    const seat = new THREE.Mesh(seatGeometry, charcoal);
    seat.position.set(x, 0.58, 0.23);
    seat.rotation.x = -0.12;
    group.add(seat);
  }
  const dashboard = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 8),
    charcoal,
  );
  dashboard.scale.set(0.51, 0.11, 0.23);
  dashboard.position.set(0, 0.59, -1.03);
  group.add(dashboard);

  for (const side of [-1, 1]) {
    rod(
      group,
      [side * 0.42, -0.37, 0.36],
      [side * 1.1, -1.29, 0.54],
      0.057,
      trainer ? metal : cream,
    );
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.215, 0.09, 8, 18),
      rubber,
    );
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(side * 1.12, -1.345, 0.54);
    group.add(wheel);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.125, 0.125, 0.19, 12),
      metal,
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(wheel.position);
    group.add(hub);
    if (!trainer) {
      const fairing = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 10),
        cream,
      );
      fairing.scale.set(0.17, 0.22, 0.52);
      fairing.position.set(side * 1.12, -1.25, 0.49);
      group.add(fairing);
    }
  }
  rod(group, [0, -0.42, -2.45], [0, -1.39, -2.58], 0.048, metal);
  const noseWheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.065, 8, 16),
    rubber,
  );
  noseWheel.rotation.y = Math.PI / 2;
  noseWheel.position.set(0, -1.415, -2.58);
  group.add(noseWheel);
  if (!trainer) {
    const fairing = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), cream);
    fairing.scale.set(0.145, 0.18, 0.38);
    fairing.position.set(0, -1.34, -2.6);
    group.add(fairing);
  }

  const propeller = new THREE.Group();
  propeller.position.set(0, -0.015, -3.58);
  group.add(propeller);
  const spinner = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), orange);
  spinner.scale.set(0.22, 0.22, 0.4);
  spinner.position.z = -0.22;
  propeller.add(spinner);
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.065, 0.13);
  bladeShape.bezierCurveTo(-0.11, 0.48, -0.035, 1.13, 0.075, 1.2);
  bladeShape.quadraticCurveTo(0.17, 1.22, 0.18, 1.12);
  bladeShape.bezierCurveTo(0.19, 0.78, 0.1, 0.38, 0.065, 0.13);
  bladeShape.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.025,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.012,
    bevelThickness: 0.009,
    curveSegments: 10,
    steps: 1,
  });
  const bladeCount = sport ? 3 : 2;
  for (let i = 0; i < bladeCount; i++) {
    const blade = new THREE.Mesh(bladeGeometry, charcoal);
    blade.rotation.z = (i * Math.PI * 2) / bladeCount;
    propeller.add(blade);
  }
  const blurMaterial = new THREE.MeshBasicMaterial({
    color: "#394349",
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const blur = new THREE.Mesh(
    new THREE.RingGeometry(0.24, 1.19, 48),
    blurMaterial,
  );
  blur.position.z = -0.025;
  propeller.add(blur);
  const intake = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), charcoal);
  intake.scale.set(0.27, 0.105, 0.045);
  intake.position.set(0, -0.25, -3.45);
  group.add(intake);
  rod(group, [0.28, -0.38, -2.6], [0.34, -0.7, -2.44], 0.055, charcoal);
  rod(group, [0, 0.69, 1.27], [0, 1.2, 1.54], 0.011, charcoal);
  const navGeometry = new THREE.SphereGeometry(0.055, 8, 6);
  for (const side of [-1, 1]) {
    const light = new THREE.Mesh(
      navGeometry,
      material(side < 0 ? "#ff4c32" : "#76e5a4", {
        emissive: side < 0 ? "#ff3218" : "#36db83",
        emissiveIntensity: 1.5,
      }),
    );
    light.position.set(
      side * span * 0.494,
      wingY + (trainer ? 0.11 : 0.34),
      wingZ + 0.22,
    );
    group.add(light);
  }
  group.traverse((object) => {
    if (object.isMesh && object !== blur && object !== canopy) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  group.userData.type = type;
  group.userData.propeller = propeller;
  group.userData.cockpitAnchor = new THREE.Vector3(0, 0.93, -0.59);
  group.userData.groundClearance = 1.65;
  group.userData.wingspan = span;
  group.userData.animate = (dt, throttle = 0, rpm = 700 + throttle * 2000) => {
    const power = THREE.MathUtils.clamp(throttle, 0, 1);
    propeller.rotation.z =
      (propeller.rotation.z + (Math.max(0, dt) * rpm * Math.PI) / 30) %
      (Math.PI * 2);
    blurMaterial.opacity = (0.045 + power * 0.13) * Math.min(1, rpm / 800);
  };
  return group;
}

export function createCockpit() {
  // Camera-local overlay: add this group to the camera, not to the aircraft mesh.
  const cockpit = new THREE.Group();
  cockpit.name = "Camera-local cockpit frame";
  const charcoal = material("#26383c", { roughness: 0.84 });
  const pillar = material("#d8d3c4", { roughness: 0.5 });
  const panelShape = new THREE.Shape();
  panelShape.moveTo(-0.76, -0.64);
  panelShape.lineTo(-0.76, -0.31);
  panelShape.quadraticCurveTo(0, -0.12, 0.76, -0.31);
  panelShape.lineTo(0.76, -0.64);
  panelShape.closePath();
  const panel = new THREE.Mesh(
    new THREE.ExtrudeGeometry(panelShape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelSize: 0.018,
      bevelThickness: 0.018,
      bevelSegments: 2,
      steps: 1,
    }),
    charcoal,
  );
  panel.position.z = -0.88;
  cockpit.add(panel);
  for (const side of [-1, 1]) {
    rod(
      cockpit,
      [side * 0.7, -0.36, -0.81],
      [side * 0.48, 0.57, -0.67],
      0.028,
      pillar,
    );
    rod(
      cockpit,
      [side * 0.48, 0.57, -0.67],
      [side * 0.1, 0.67, -0.57],
      0.021,
      pillar,
    );
  }
  const gaugeSize = 256;
  const gauges = [
    {
      label: "AIRSPEED",
      unit: "KNOTS",
      min: 0,
      max: 200,
      steps: 40,
      major: 4,
      start: Math.PI * 0.75,
      sweep: Math.PI * 1.5,
    },
    { label: "ATTITUDE" },
    {
      label: "ALTITUDE",
      unit: "FEET",
      min: 0,
      max: 10,
      steps: 50,
      major: 5,
      start: -Math.PI / 2,
      sweep: Math.PI * 2,
    },
    {
      label: "VERT SPEED",
      unit: "1000 FT / MIN",
      min: -2,
      max: 2,
      steps: 40,
      major: 10,
      start: Math.PI * 0.15,
      sweep: Math.PI * 1.7,
    },
    {
      label: "ENGINE",
      unit: "RPM x 100",
      min: 0,
      max: 30,
      steps: 30,
      major: 5,
      start: Math.PI * 0.75,
      sweep: Math.PI * 1.5,
    },
  ];
  const angleFor = (gauge, value) =>
    gauge.start +
    THREE.MathUtils.clamp((value - gauge.min) / (gauge.max - gauge.min), 0, 1) *
      gauge.sweep;
  const backing = document.createElement("canvas");
  backing.width = gaugeSize * gauges.length;
  backing.height = gaugeSize;
  const base = backing.getContext("2d");
  gauges.forEach((gauge, index) => {
    base.save();
    base.translate(index * gaugeSize + 128, 128);
    const gradient = base.createRadialGradient(-25, -45, 0, 0, 0, 128);
    gradient.addColorStop(0, "#273c40");
    gradient.addColorStop(1, "#111f23");
    base.fillStyle = gradient;
    base.fillRect(-128, -128, 256, 256);
    base.strokeStyle = "#71837d";
    base.lineWidth = 2;
    base.beginPath();
    base.arc(0, 0, 117, 0, Math.PI * 2);
    base.stroke();
    if (index !== 1) {
      base.textAlign = "center";
      base.textBaseline = "middle";
      for (let tick = 0; tick <= gauge.steps; tick++) {
        if (index === 2 && tick === gauge.steps) continue;
        const value =
          gauge.min + (tick / gauge.steps) * (gauge.max - gauge.min);
        const angle = angleFor(gauge, value);
        const major = tick % gauge.major === 0;
        const inner = major ? 89 : 98;
        base.strokeStyle = "#d6ddce";
        base.lineWidth = major ? 2.4 : 1.2;
        base.beginPath();
        base.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        base.lineTo(Math.cos(angle) * 106, Math.sin(angle) * 106);
        base.stroke();
        if (major) {
          base.font = "17px Arial, sans-serif";
          base.fillStyle = "#e4e7d9";
          base.fillText(
            String(Math.round(value)),
            Math.cos(angle) * 75,
            Math.sin(angle) * 75,
          );
        }
      }
      const bands =
        index === 0
          ? [
              [45, 140, "#91b799"],
              [140, 175, "#d1b774"],
              [175, 200, "#dd7653"],
            ]
          : index === 4
            ? [
                [18, 25, "#91b799"],
                [27, 30, "#dd7653"],
              ]
            : [];
      for (const [low, high, color] of bands) {
        base.strokeStyle = color;
        base.lineWidth = 4;
        base.beginPath();
        base.arc(0, 0, 111, angleFor(gauge, low), angleFor(gauge, high));
        base.stroke();
      }
      base.fillStyle = "#d8dfd3";
      base.font = "bold 17px Arial, sans-serif";
      base.fillText(gauge.label, 0, -35);
      base.fillStyle = "#aabbb5";
      base.font = "12px Arial, sans-serif";
      base.fillText(gauge.unit, 0, -16);
      base.fillStyle = "#101d20";
      base.fillRect(-49, 32, 98, 28);
    }
    base.restore();
  });
  // One upload for all five instruments; fixed dial artwork is drawn only once.
  const atlas = canvasTexture(backing.width, backing.height, (ctx) =>
    ctx.drawImage(backing, 0, 0),
  );
  atlas.name = "Live cockpit instrument atlas";
  atlas.generateMipmaps = false;
  atlas.minFilter = THREE.LinearFilter;
  atlas.anisotropy = 1;
  const context = atlas.image.getContext("2d");
  const dial = new THREE.MeshBasicMaterial({
    map: atlas,
    toneMapped: false,
    fog: false,
  });
  const rim = material("#8c9894", { metalness: 0.7, roughness: 0.35 });
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.18;
    const geometry = new THREE.CircleGeometry(0.062, 40);
    const uv = geometry.attributes.uv;
    for (let vertex = 0; vertex < uv.count; vertex++)
      uv.setX(vertex, (uv.getX(vertex) + i) / gauges.length);
    const face = new THREE.Mesh(geometry, dial);
    face.name = gauges[i].label;
    face.position.set(x, -0.282 - Math.abs(i - 2) * 0.0085, -0.773);
    cockpit.add(face);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.065, 0.004, 6, 32),
      rim,
    );
    ring.position.copy(face.position);
    cockpit.add(ring);
  }
  function needle(index, angle, length = 88, width = 2.5, color = "#f2e8c9") {
    context.save();
    context.translate(index * gaugeSize + 128, 128);
    context.rotate(angle);
    context.fillStyle = color;
    context.strokeStyle = "#142226";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(-16, -width);
    context.lineTo(length, 0);
    context.lineTo(-16, width);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = "#d58a60";
    context.beginPath();
    context.arc(0, 0, 5.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  cockpit.userData.update = (telemetry = {}, attitudeCanvas) => {
    const value = (key) =>
      Number.isFinite(telemetry?.[key]) ? telemetry[key] : 0;
    const speed = Math.max(0, value("airspeed") * 1.943844);
    const altitude = value("altitude") * 3.28084;
    const verticalSpeed = value("verticalSpeed") * 196.8504;
    const rpm = Math.max(0, value("engineRPM"));
    context.clearRect(0, 0, backing.width, backing.height);
    context.drawImage(backing, 0, 0);
    needle(0, angleFor(gauges[0], speed));
    needle(
      2,
      -Math.PI / 2 + (altitude / 10000) * Math.PI * 2,
      51,
      4.5,
      "#d99c71",
    );
    needle(2, -Math.PI / 2 + (altitude / 1000) * Math.PI * 2);
    needle(3, angleFor(gauges[3], verticalSpeed / 1000));
    needle(4, angleFor(gauges[4], rpm / 100));
    context.font = "23px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#f0e9d4";
    const climb = Math.round(verticalSpeed / 10) * 10;
    for (const [index, readout] of [
      [0, Math.round(speed)],
      [2, Math.round(altitude)],
      [3, `${climb > 0 ? "+" : ""}${climb}`],
      [4, Math.round(rpm)],
    ]) {
      context.fillText(String(readout), index * gaugeSize + 128, 174);
    }
    context.save();
    context.translate(gaugeSize + 128, 128);
    context.beginPath();
    context.arc(0, 0, 115, 0, Math.PI * 2);
    context.clip();
    if (attitudeCanvas?.width > 0 && attitudeCanvas.height > 0) {
      context.drawImage(attitudeCanvas, -128, -128, 256, 256);
    } else {
      context.save();
      context.rotate((-value("roll") * Math.PI) / 180);
      context.translate(
        0,
        THREE.MathUtils.clamp(value("pitch"), -90, 90) * 2.6,
      );
      context.fillStyle = "#668e9a";
      context.fillRect(-500, -600, 1000, 600);
      context.fillStyle = "#8a7150";
      context.fillRect(-500, 0, 1000, 600);
      context.strokeStyle = "#eee7d2";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-500, 0);
      context.lineTo(500, 0);
      context.stroke();
      for (let pitch = -30; pitch <= 30; pitch += 10) {
        if (!pitch) continue;
        context.beginPath();
        context.moveTo(-22, -pitch * 2.6);
        context.lineTo(22, -pitch * 2.6);
        context.stroke();
      }
      context.restore();
      context.strokeStyle = "#f3bc7c";
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(-65, 0);
      context.lineTo(-24, 0);
      context.lineTo(-17, 7);
      context.moveTo(65, 0);
      context.lineTo(24, 0);
      context.lineTo(17, 7);
      context.stroke();
      context.fillStyle = "#f6e7c7";
      context.beginPath();
      context.arc(0, 0, 4, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    context.fillStyle = "#dbe3d6";
    context.font = "12px Arial, sans-serif";
    context.fillText("ATTITUDE", gaugeSize + 128, 235);
    atlas.needsUpdate = true;
  };
  cockpit.userData.update();
  rod(cockpit, [0, -0.6, -0.65], [0, -0.43, -0.5], 0.02, charcoal);
  rod(cockpit, [-0.11, -0.43, -0.5], [0.11, -0.43, -0.5], 0.018, charcoal);
  return cockpit;
}
