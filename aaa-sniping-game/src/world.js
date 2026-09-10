import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// World units are metres. Target positions describe the soles, not the aim point.
export function createWorld(scene) {
  const world = new THREE.Group();
  world.name = 'Kestrel alpine relay';
  scene.add(world);

  let seed = 48271;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const range = (a, b) => a + random() * (b - a);
  const smooth = (a, b, value) => THREE.MathUtils.smoothstep(value, a, b);
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
      THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v,
    );
  }
  function fbm(x, y) {
    return noise(x, y) * 0.53 + noise(x * 2.03, y * 2.03) * 0.27
      + noise(x * 4.09, y * 4.09) * 0.13 + noise(x * 8.21, y * 8.21) * 0.07;
  }

  function canvasTexture(width, height, paint, repeat = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 4;
    return texture;
  }

  const snowTexture = canvasTexture(512, 512, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const ripple = Math.sin(y * 0.13 + Math.sin(x * 0.021) * 3.5);
        const shade = 226 + fbm(x / 42, y / 42) * 23 + ripple * 2 + random() * 6;
        image.data[i] = shade - 3;
        image.data[i + 1] = shade;
        image.data[i + 2] = Math.min(255, shade + 4);
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = 'rgba(139,166,182,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 180; i++) {
      const x = range(0, w);
      const y = range(0, h);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 14, y - 3, x + 30, y + 7, x + range(35, 85), y + 3);
      ctx.stroke();
    }
  });
  const rockTexture = canvasTexture(512, 512, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const strata = Math.sin(y * 0.2 + noise(x / 48, y / 100) * 9);
        const value = 137 + fbm(x / 31, y / 17) * 94 + strata * 10 + random() * 16;
        image.data[i] = value - 9;
        image.data[i + 1] = value - 3;
        image.data[i + 2] = value;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    for (let i = 0; i < 95; i++) {
      const x = range(0, w);
      const y = range(0, h);
      ctx.strokeStyle = `rgba(32,42,47,${range(0.05, 0.2)})`;
      ctx.lineWidth = range(0.5, 2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + range(-18, 18), y + range(8, 36));
      ctx.lineTo(x + range(-28, 28), y + range(45, 110));
      ctx.stroke();
    }
  });
  const concreteTexture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#a4aaa8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) {
      ctx.fillStyle = random() > 0.45 ? `rgba(42,52,54,${range(0.02, 0.14)})` : 'rgba(235,234,220,0.18)';
      ctx.fillRect(range(0, w), range(0, h), range(0.5, 2.5), range(0.5, 3));
    }
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(42,49,46,0.25)');
    gradient.addColorStop(0.25, 'rgba(70,73,69,0)');
    gradient.addColorStop(0.82, 'rgba(70,73,69,0)');
    gradient.addColorStop(1, 'rgba(46,57,51,0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(41,51,51,0.35)';
    ctx.strokeRect(1, 1, w - 2, h - 2);
    for (const x of [12, w - 12]) {
      for (const y of [12, h - 12]) {
        ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.stroke();
      }
    }
  });
  const claddingTexture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b3c0c3'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const gradient = ctx.createLinearGradient(x, 0, x + 16, 0);
      gradient.addColorStop(0, '#697c82');
      gradient.addColorStop(0.12, '#c9d1cd');
      gradient.addColorStop(0.35, '#b5c0be');
      gradient.addColorStop(0.86, '#a0b0b1');
      gradient.addColorStop(1, '#71858b');
      ctx.fillStyle = gradient; ctx.fillRect(x, 0, 16, h);
      for (const y of [12, 127, 244]) {
        ctx.fillStyle = '#53656a'; ctx.fillRect(x + 4, y, 2, 2);
      }
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(49,62,60,${range(0.01, 0.08)})`;
      ctx.fillRect(range(0, w), range(0, h), range(1, 3), range(3, 65));
    }
  });
  const windowTexture = canvasTexture(128, 128, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#ffd18a');
    gradient.addColorStop(0.2, '#edb16d');
    gradient.addColorStop(1, '#8b5634');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,240,194,0.75)'; ctx.fillRect(9, 9, w - 18, 4);
    ctx.fillStyle = 'rgba(44,37,33,0.28)';
    ctx.fillRect(17, 75, 19, 53); ctx.fillRect(66, 95, 43, 33);
    for (let y = 22; y < h; y += 11) {
      ctx.fillStyle = 'rgba(57,42,32,0.15)'; ctx.fillRect(0, y, w, 2);
    }
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = 'rgba(255,235,204,0.055)';
      ctx.fillRect(range(0, w), range(0, h), 1, range(1, 5));
    }
  });
  const hazardTexture = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b99147'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#25343a';
    for (let x = -128; x < 256; x += 48) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 24, 0);
      ctx.lineTo(x + 152, h); ctx.lineTo(x + 128, h); ctx.fill();
    }
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = 'rgba(212,212,192,0.12)';
      ctx.fillRect(range(0, w), range(0, h), range(1, 4), 1);
    }
  });
  const fenceTexture = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(139,164,171,0.85)';
    for (let x = -h; x <= w + h; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - h, h); ctx.stroke();
    }
  });
  const glowTexture = canvasTexture(64, 64, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(255,235,177,1)');
    gradient.addColorStop(0.14, 'rgba(255,195,112,0.55)');
    gradient.addColorStop(0.45, 'rgba(255,156,72,0.10)');
    gradient.addColorStop(1, 'rgba(255,156,72,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  });
  const mistTexture = canvasTexture(128, 128, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(223,232,236,0.32)');
    gradient.addColorStop(0.4, 'rgba(216,225,232,0.20)');
    gradient.addColorStop(1, 'rgba(216,225,232,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  });

  const standard = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.88, ...extra });
  function alpineSurface(extra = {}) {
    const material = standard('#ffffff', {
      map: snowTexture, bumpMap: rockTexture, bumpScale: 0.065, vertexColors: true, roughness: 1, ...extra,
    });
    material.onBeforeCompile = shader => {
      shader.uniforms.alpineRockMap = { value: rockTexture };
      shader.fragmentShader = 'uniform sampler2D alpineRockMap;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 alpineSnow = texture2D(map, vMapUv);
          vec3 alpineStone = texture2D(alpineRockMap, vMapUv * 1.7).rgb;
          float alpineCover = smoothstep(0.3, 0.8, max(vColor.r, max(vColor.g, vColor.b)));
          diffuseColor *= vec4(mix(alpineStone, alpineSnow.rgb, alpineCover), alpineSnow.a);
        #endif
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', 'dHdxy_fwd() * mix(1.0, 0.08, alpineCover)'));
    };
    return material;
  }
  const mat = {
    snow: standard('#eff4f4', { map: snowTexture, bumpMap: snowTexture, bumpScale: 0.055 }),
    snowBank: standard('#dbe3e4', { map: snowTexture, bumpMap: snowTexture, bumpScale: 0.035 }),
    concrete: standard('#adb5b2', { map: concreteTexture, bumpMap: concreteTexture, bumpScale: 0.08 }),
    blue: standard('#3a525b', { map: claddingTexture, metalness: 0.28, roughness: 0.65 }),
    paleMetal: standard('#9caaa9', { map: claddingTexture, metalness: 0.4, roughness: 0.6 }),
    dark: standard('#25343c', { metalness: 0.55, roughness: 0.56 }),
    steel: standard('#637780', { metalness: 0.6, roughness: 0.48 }),
    rust: standard('#79533f', { map: concreteTexture, metalness: 0.35 }),
    orange: standard('#b96539', { map: claddingTexture, metalness: 0.3 }),
    glass: standard('#dfb679', { map: windowTexture, emissiveMap: windowTexture, emissive: '#ffad56', emissiveIntensity: 0.9, roughness: 0.34 }),
    coldGlass: standard('#314d5a', { metalness: 0.35, roughness: 0.25, emissive: '#37535d', emissiveIntensity: 0.18 }),
    lamp: standard('#ffe5a8', { emissive: '#ffba62', emissiveIntensity: 3.5 }),
    red: standard('#e35b35', { emissive: '#ff4020', emissiveIntensity: 2 }),
    hazard: standard('#ffffff', { map: hazardTexture }),
    bark: standard('#494640', { map: rockTexture }),
    rock: alpineSurface({ bumpScale: 0.045 }),
  };
  const windowVariants = [0.45, 0.62, 0.78].map(intensity => {
    const material = mat.glass.clone();
    material.emissiveIntensity = intensity;
    return material;
  });
  const contactTexture = canvasTexture(128, 128, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(18,32,42,0.38)');
    gradient.addColorStop(0.65, 'rgba(18,32,42,0.19)');
    gradient.addColorStop(1, 'rgba(18,32,42,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
  const contactMaterial = new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });

  // Static primitives are baked into one mesh per material, including tower trusses.
  const batches = new Map();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  const transform = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  function bake(geometry, material, position, scale = [1, 1, 1], rotation = [0, 0, 0]) {
    transform.position.set(...position);
    transform.rotation.set(...rotation);
    transform.scale.set(...scale);
    transform.updateMatrix();
    const copy = geometry.clone().applyMatrix4(transform.matrix);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(copy);
  }
  const box = (position, scale, material = mat.dark, rotation) => bake(boxGeometry, material, position, scale, rotation);
  function rod(from, to, radius = 0.06, material = mat.steel) {
    direction.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    transform.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    transform.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    transform.scale.set(radius, direction.length(), radius);
    transform.updateMatrix();
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(cylinderGeometry.clone().applyMatrix4(transform.matrix));
  }
  const ball = (position, scale, material) => bake(sphereGeometry, material, position, scale);
  const driftGeometry = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let i = 0; i < driftGeometry.attributes.position.count; i++) {
    const p = driftGeometry.attributes.position;
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
    const edge = 0.94 + noise(x * 2 + 17, z * 2) * 0.12;
    p.setXYZ(i, x * edge, Math.pow(y, 4) * (0.9 + noise(x * 3, z * 3) * 0.2), z * edge);
    driftGeometry.attributes.uv.setXY(i, x / 2, z / 2);
  }
  driftGeometry.computeVertexNormals();
  function drift(x, y, z, width, depth, height, yaw = 0) {
    if (Math.abs(y - valleyHeight(x, z)) > 0.1) {
      bake(driftGeometry, mat.snow, [x, y, z], [width, height, depth], [0, yaw, 0]);
      return;
    }
    const geometry = driftGeometry.clone();
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) * width, dz = p.getZ(i) * depth;
      const groundY = valleyHeight(x + dx * Math.cos(yaw) + dz * Math.sin(yaw), z - dx * Math.sin(yaw) + dz * Math.cos(yaw));
      p.setY(i, p.getY(i) + (groundY - y - 0.035) / height);
    }
    geometry.computeVertexNormals();
    bake(geometry, mat.snowBank, [x, y, z], [width, height, depth], [0, yaw, 0]);
    geometry.dispose();
  }
  function cable(points, radius = 0.035, material = mat.dark) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const geometry = new THREE.TubeGeometry(curve, 32, radius, 5, false);
    bake(geometry, material, [0, 0, 0]);
    geometry.dispose();
  }
  function label(text, position, width, height, options = {}) {
    const texture = canvasTexture(512, 128, (ctx, w, h) => {
      ctx.fillStyle = options.background || '#263b43'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = options.color || '#e7dbba'; ctx.lineWidth = 3;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = options.color || '#e7dbba';
      ctx.font = `600 ${options.fontSize || 57}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 3, w - 35);
      for (let i = 0; i < 650; i++) {
        ctx.fillStyle = 'rgba(25,37,39,0.12)';
        ctx.fillRect(range(0, w), range(0, h), range(1, 6), range(1, 3));
      }
    });
    const material = standard('#ffffff', { map: texture, roughness: 0.75 });
    bake(planeGeometry, material, position, [width, height, 1], [0, options.rotation || 0, 0]);
  }

  function valleyHeight(x, z) {
    const outside = smooth(39, 86, Math.abs(x));
    const back = smooth(82, 160, -z);
    const front = smooth(20, 66, z);
    return outside * (4 + fbm(x * 0.018, z * 0.018) * 21)
      + back * (3 + fbm(x * 0.025 + 80, z * 0.025) * 14)
      + front * (3 + fbm(x * 0.025, z * 0.032) * 10);
  }
  const valley = new THREE.PlaneGeometry(1100, 1000, 190, 175);
  valley.rotateX(-Math.PI / 2);
  valley.translate(0, 0, -290);
  const valleyPositions = valley.attributes.position;
  const valleyColors = [];
  const snowColor = new THREE.Color();
  for (let i = 0; i < valleyPositions.count; i++) {
    const x = valleyPositions.getX(i);
    const z = valleyPositions.getZ(i);
    valleyPositions.setY(i, valleyHeight(x, z));
    snowColor.set('#e1e9ea').multiplyScalar(0.89 + fbm(x * 0.07, z * 0.07) * 0.14);
    valleyColors.push(snowColor.r, snowColor.g, snowColor.b);
    valley.attributes.uv.setXY(i, x / 16, z / 16);
  }
  valley.setAttribute('color', new THREE.Float32BufferAttribute(valleyColors, 3));
  valley.computeVertexNormals();
  const ground = new THREE.Mesh(valley, standard('#ffffff', {
    map: snowTexture, bumpMap: snowTexture, bumpScale: 0.045, vertexColors: true,
  }));
  ground.name = 'Wind-carved snow basin';
  ground.receiveShadow = true;
  world.add(ground);

  function mountains(name, bounds, peaks, tint, segments, heightScale, setback) {
    const [minX, maxX, minZ, maxZ] = bounds;
    const geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, segments, Math.floor(segments * 0.46));
    geometry.rotateX(-Math.PI / 2);
    geometry.translate((minX + maxX) / 2, -2, (minZ + maxZ) / 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const wx = x + (fbm(x * 0.017, z * 0.017) - 0.5) * 39;
      const wz = z + (fbm(x * 0.019 + 71, z * 0.019) - 0.5) * 31;
      let height = 0;
      for (const [px, pz, elevation, rx, rz, angle = 0] of peaks) {
        const dx = ((wx - px) * Math.cos(angle) + (wz - pz) * Math.sin(angle)) / rx;
        const dz = (-(wx - px) * Math.sin(angle) + (wz - pz) * Math.cos(angle)) / rz;
        const azimuth = Math.atan2(dz, dx);
        const ridges = 1 + Math.sin(azimuth * 3 + px) * 0.075 + Math.sin(azimuth * 7 + pz) * 0.035;
        const spine = Math.max(0, Math.abs(dx) - 0.19);
        const distance = Math.sqrt(spine * spine + dz * dz) * ridges;
        const crest = 0.76 + Math.max(0, 1 - Math.abs(dx - 0.06) * 2.6) * 0.18
          + noise(wx * 0.012 + px, wz * 0.009) * 0.09;
        height = Math.max(height, elevation * Math.pow(Math.max(0, 1 - distance), 1.12) * crest);
      }
      const detail = (1 - Math.abs(noise(x * 0.055, z * 0.055) * 2 - 1));
      const edge = smooth(0, 32, Math.min(x - minX, maxX - x, z - minZ, maxZ - z));
      height = (height + detail * Math.min(6, height * 0.07)
        + (fbm(x * 0.07, z * 0.07) - 0.5) * Math.min(4, height * 0.045)) * edge;
      positions.setY(i, height * heightScale - 2);
      geometry.attributes.uv.setXY(i, x / 32, z / 32);
    }
    geometry.computeVertexNormals();
    const colors = [];
    const stone = new THREE.Color('#626d76').multiply(new THREE.Color(tint));
    const ice = new THREE.Color('#f1f1ed').multiply(new THREE.Color(tint));
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const y = positions.getY(i);
      const normalY = geometry.attributes.normal.getY(i);
      const wind = geometry.attributes.normal.getX(i) * 0.09;
      const deposit = smooth(0.72, 0.94, normalY + wind + (noise(x * 0.065, z * 0.065) - 0.5) * 0.22);
      color.copy(stone).lerp(ice, deposit);
      color.multiplyScalar(0.88 + noise(x * 0.12, y * 0.15 + z * 0.04) * 0.2);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, alpineSurface());
    mesh.name = name;
    mesh.position.z = -setback;
    mesh.receiveShadow = true;
    world.add(mesh);
  }
  mountains('Far glaciated skyline', [-1100, 1100, -1100, -430], [
    [-820, -800, 260, 360, 220, -0.22], [-470, -840, 410, 300, 220, 0.3],
    [-150, -780, 200, 330, 230, -0.2], [185, -850, 145, 360, 210, 0.16],
    [570, -820, 380, 360, 220, -0.3], [890, -790, 280, 310, 230, 0.2],
  ], '#bfcedc', 230, 0.47, 140);
  mountains('Serrated middle massif', [-760, 800, -740, -245], [
    [-560, -490, 210, 290, 160, -0.27], [-330, -510, 285, 230, 155, 0.35],
    [-35, -530, 95, 280, 145, -0.1], [210, -540, 80, 220, 140, 0.3],
    [490, -500, 300, 280, 175, -0.28],
  ], '#d4dfea', 240, 0.5, 160);
  mountains('Exposed granite cirque', [-560, 580, -450, -92], [
    [-455, -290, 145, 235, 135, -0.32], [-260, -285, 220, 175, 115, 0.38],
    [-65, -315, 70, 195, 120, -0.14], [135, -325, 48, 215, 120, 0.2],
    [385, -285, 230, 195, 150, -0.32], [525, -350, 150, 215, 105, 0.2],
  ], '#edf0ed', 270, 0.58, 150);

  function building(x, z, width, depth, height, surface) {
    bake(planeGeometry, contactMaterial, [x, 0.025, z], [width * 1.45, depth * 1.5, 1], [-Math.PI / 2, 0, 0]);
    box([x, 1.15, z], [width + 0.25, 2.3, depth + 0.25], mat.concrete);
    box([x, (height + 2.1) / 2, z], [width, height - 2.1, depth], surface);
    box([x, height - 0.04, z], [width + 0.55, 0.22, depth + 0.55], mat.dark);
    box([x, height + 0.15, z], [width + 0.75, 0.3, depth + 0.75], mat.snow);
    // Side and rear deposits leave the original front rooftop patrol strips level.
    for (const side of [-1, 1]) {
      drift(x + side * (width / 2 - 0.2), height + 0.3, z - depth * 0.18, 0.85, depth * 0.33, 0.32);
      drift(x + side * (width / 2 - 0.6), height + 0.3, z + depth / 2 - 0.1, 1.25, 0.65, 0.17);
      drift(x + side * width * 0.25, height + 0.3, z - depth / 2 + 0.15, width * 0.24, 1.1, 0.25);
    }
    for (const side of [-1, 1]) {
      for (let dz = -depth / 2 + 1; dz < depth / 2; dz += 3.5) {
        box([x + side * (width / 2 + 0.04), height / 2, z + dz], [0.12, height, 0.16], mat.steel);
      }
      rod([x + side * (width / 2 + 0.2), 0.3, z + depth / 2 - 0.3],
        [x + side * (width / 2 + 0.2), height - 0.25, z + depth / 2 - 0.3], 0.09, mat.steel);
    }
    for (let dx = -width / 2 + 0.4; dx <= width / 2; dx += 3.7) {
      box([x + dx, (height + 2.2) / 2, z + depth / 2 + 0.02], [0.1, height - 2.2, 0.14], mat.steel);
    }
  }
  function window(x, y, z, width = 1.5, height = 1.7, lit = true, rotation = 0) {
    const offset = (dx, dy, dz) => [x + dx * Math.cos(rotation) + dz * Math.sin(rotation), y + dy, z - dx * Math.sin(rotation) + dz * Math.cos(rotation)];
    box(offset(0, 0, 0), [width + 0.24, height + 0.24, 0.18], mat.dark, [0, rotation, 0]);
    box(offset(0, 0, 0.1), [width, height, 0.05], lit ? windowVariants[Math.floor(random() * windowVariants.length)] : mat.coldGlass, [0, rotation, 0]);
    for (const side of [-1, 1]) {
      box(offset(side * (width / 2 + 0.035), 0, 0.17), [0.12, height + 0.2, 0.26], mat.steel, [0, rotation, 0]);
      box(offset(0, side * (height / 2 + 0.035), 0.17), [width + 0.18, 0.12, 0.26], mat.steel, [0, rotation, 0]);
    }
    box(offset(0, 0, 0.15), [0.065, height, 0.06], mat.steel, [0, rotation, 0]);
    box(offset(0, -height / 2 - 0.08, 0.14), [width + 0.38, 0.14, 0.48], mat.snow, [0, rotation, 0]);
  }
  function rail(from, to, height = 1.05, spacing = 2.1) {
    const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
    const steps = Math.ceil(length / spacing);
    for (let i = 0; i <= steps; i++) {
      const x = THREE.MathUtils.lerp(from[0], to[0], i / steps);
      const z = THREE.MathUtils.lerp(from[2], to[2], i / steps);
      rod([x, from[1], z], [x, from[1] + height, z], 0.045);
    }
    for (const h of [height * 0.48, height]) {
      rod([from[0], from[1] + h, from[2]], [to[0], to[1] + h, to[2]], 0.045);
    }
  }
  const glowMaterial = new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7, fog: true });
  function lamp(x, y, z, size = 1.8) {
    box([x, y, z], [0.48, 0.24, 0.36], mat.dark);
    box([x, y - 0.045, z + 0.19], [0.35, 0.11, 0.035], mat.lamp);
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.set(x, y, z + 0.23); glow.scale.setScalar(size);
    world.add(glow);
  }

  // Main operations block: the front roof strip deliberately has no parapet.
  building(9, -40, 27, 19, 10.1, mat.blue);
  box([9, 5.1, -30.32], [27.4, 0.35, 0.46], mat.concrete);
  box([9, 9.52, -30.25], [27.2, 0.36, 0.3], mat.orange);
  for (const x of [-1.7, 2.2, 6.1, 10, 13.9, 17.8]) {
    window(x, 7.2, -30.4, 2.65, 2.02, x !== 2.2);
    if (x < 14) window(x, 3.35, -30.35, 2.3, 1.4, x === -1.7 || x === 10);
  }
  for (const z of [-35, -40, -45]) window(22.58, 7.2, z, 2.5, 2.02, true, Math.PI / 2);
  box([18.5, 1.8, -30.26], [2.15, 3.6, 0.28], mat.dark);
  box([18.5, 2.4, -30.08], [1.55, 1.18, 0.05], mat.coldGlass);
  box([19.2, 1.52, -29.98], [0.1, 0.46, 0.09], mat.steel);
  box([18.5, 4.06, -29.25], [4.7, 0.18, 3.2], mat.dark);
  box([18.5, 4.2, -29.25], [4.9, 0.17, 3.4], mat.snow);
  rod([16.7, 2.95, -30.2], [16.7, 4, -27.9]);
  rod([20.3, 2.95, -30.2], [20.3, 4, -27.9]);
  lamp(18.5, 3.7, -30.02);
  label('KESTREL / 07', [8.5, 9.48, -30.065], 8.3, 0.85, { fontSize: 56 });
  label('RESTRICTED', [18.5, 0.68, -30.085], 1.5, 0.37, { background: '#aa713f', color: '#192e34' });
  rail([-4.1, 10.4, -31.3], [-4.1, 10.4, -49.4]);
  rail([-4.1, 10.4, -49.4], [22.1, 10.4, -49.4]);
  rail([22.1, 10.4, -49.4], [22.1, 10.4, -31.3]);
  for (const [x, z] of [[2, -43.8], [9, -44.8]]) {
    box([x, 11.25, z], [4.1, 1.7, 3.5], mat.paleMetal);
    box([x, 12.13, z], [4.3, 0.12, 3.7], mat.snow);
    for (let i = 0; i < 8; i++) box([x - 1.5 + i * 0.43, 11.22, z + 1.77], [0.12, 1.05, 0.07], mat.dark);
    rod([x + 1.2, 10.5, z - 0.7], [x + 1.2, 12.75, z - 0.7], 0.25, mat.steel);
    box([x + 1.2, 12.79, z - 0.7], [0.8, 0.12, 0.8], mat.dark);
  }
  box([16.4, 11.25, -46.4], [4.8, 1.7, 4.2], mat.blue);
  box([16.4, 12.2, -46.4], [5, 0.22, 4.4], mat.snow);
  window(16.4, 11.3, -44.24, 2.4, 0.7, true);

  // Service wing and its exposed snow-covered rooftop patrol.
  building(-20, -36, 17, 14, 5.1, mat.paleMetal);
  box([-20, 4.3, -28.88], [17, 0.4, 0.16], mat.orange);
  for (const x of [-25, -19.8]) {
    box([x, 1.75, -28.87], [4.15, 3.5, 0.15], mat.dark);
    for (let i = 0; i < 10; i++) box([x, 0.2 + i * 0.34, -28.73], [4, 0.23, 0.07], mat.steel);
    window(x, 2.65, -28.65, 3.4, 0.6, false);
    lamp(x, 4.06, -28.58, 1.25);
  }
  window(-14.4, 2.9, -28.85, 2.4, 1.45, true);
  label('02 / ENGINEERING', [-20, 4.35, -28.76], 9.5, 0.65);
  rail([-28, 5.4, -29.6], [-28, 5.4, -42.4]);
  rail([-28, 5.4, -42.4], [-12, 5.4, -42.4]);
  box([-23.5, 6.2, -39.4], [3.5, 1.6, 3], mat.blue);
  box([-23.5, 7.08, -39.4], [3.7, 0.15, 3.2], mat.snow);
  for (const x of [-16.5, -15.3]) {
    rod([x, 5.4, -39.7], [x, 8.1, -39.7], 0.28, mat.dark);
    box([x, 8.18, -39.7], [0.95, 0.12, 0.9], mat.steel);
  }

  // Relay tower: open steel structure, a clear front deck, and a striped mast.
  const tx = 27;
  const tz = -54;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box([tx + sx * 3.3, 0.35, tz + sz * 3.3], [1.75, 0.7, 1.75], mat.concrete);
      rod([tx + sx * 3.3, 0.7, tz + sz * 3.3], [tx + sx * 1.6, 29, tz + sz * 1.6], 0.16, mat.steel);
    }
  }
  const towerWidth = y => 3.3 - (y - 0.7) / 28.3 * 1.7;
  for (let y = 1; y < 28; y += 4) {
    const low = towerWidth(y);
    const high = towerWidth(y + 4);
    for (const side of [-1, 1]) {
      rod([tx - low, y, tz + side * low], [tx + low, y, tz + side * low], 0.1);
      rod([tx + side * low, y, tz - low], [tx + side * low, y, tz + low], 0.1);
      rod([tx - low, y, tz + side * low], [tx + high, y + 4, tz + side * high], 0.065);
      rod([tx + low, y, tz + side * low], [tx - high, y + 4, tz + side * high], 0.065);
      rod([tx + side * low, y, tz - low], [tx + side * high, y + 4, tz + high], 0.065);
      rod([tx + side * low, y, tz + low], [tx + side * high, y + 4, tz - high], 0.065);
    }
  }
  box([tx, 16.14, tz], [7.4, 0.3, 6.4], mat.steel);
  box([tx, 16.32, tz], [7.5, 0.06, 6.5], mat.snow);
  rail([23.4, 16.35, -51], [23.4, 16.35, -57]);
  rail([23.4, 16.35, -57], [30.6, 16.35, -57]);
  rail([30.6, 16.35, -57], [30.6, 16.35, -51]);
  box([tx, 15.92, -50.78], [7.4, 0.28, 0.15], mat.hazard);
  for (const x of [tx - 0.48, tx + 0.48]) rod([x, 0, tz - 2.4], [x, 29.5, tz - 2.4], 0.065);
  for (let y = 0.4; y < 29.5; y += 0.42) rod([tx - 0.48, y, tz - 2.4], [tx + 0.48, y, tz - 2.4], 0.05);
  box([tx, 29.05, tz], [4.4, 0.25, 4.4], mat.steel);
  rail([tx - 2, 29.18, tz + 2], [tx + 2, 29.18, tz + 2], 0.8);
  rail([tx - 2, 29.18, tz - 2], [tx + 2, 29.18, tz - 2], 0.8);
  for (let y = 29.2; y < 38; y += 1.4) rod([tx, y, tz], [tx, y + 1.4, tz], y > 35 ? 0.12 : 0.2, Math.round(y / 1.4) % 2 ? mat.orange : mat.paleMetal);
  rod([tx - 2.8, 34, tz], [tx + 2.8, 34, tz], 0.08);
  for (const x of [tx - 2.65, tx + 2.65]) {
    rod([x, 32.5, tz], [x, 36.7, tz], 0.06);
    box([x, 34.3, tz], [0.3, 1.75, 0.3], mat.paleMetal);
  }
  rod([tx, 38.8, tz], [tx, 40.5, tz], 0.035);
  ball([tx, 38.8, tz], [0.2, 0.25, 0.2], mat.red);
  const beaconMaterial = new THREE.SpriteMaterial({ map: glowTexture, color: '#ff603b', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true });
  const beacon = new THREE.Sprite(beaconMaterial);
  beacon.position.set(tx, 38.8, tz); beacon.scale.setScalar(2.5); world.add(beacon);
  cable([[tx - 1.4, 28, tz - 1.4], [16, 14, -64], [9, 0.6, -70]], 0.035);
  cable([[tx + 1.4, 28, tz - 1.4], [36, 14, -68], [43, valleyHeight(43, -77), -77]], 0.035);

  function dish(x, y, z, radius, yaw, tilt, baseY) {
    const dishGroup = new THREE.Group();
    dishGroup.position.set(x, y, z);
    dishGroup.rotation.set(tilt, yaw, 0, 'YXZ');
    dishGroup.updateMatrix();
    const segments = 48;
    const rings = 12;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let j = 0; j <= rings; j++) {
      const r = radius * j / rings;
      for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2;
        positions.push(Math.cos(a) * r, Math.sin(a) * r, r * r / (radius * 3.3));
        normals.push(0, 0, 1);
        uvs.push(i / segments, j / rings);
        if (j < rings && i < segments) {
          const p = j * (segments + 1) + i;
          indices.push(p, p + 1, p + segments + 1, p + 1, p + segments + 2, p + segments + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    geometry.applyMatrix4(dishGroup.matrix);
    const dishMaterial = mat.dish || (mat.dish = standard('#d5dcd8', { metalness: 0.32, roughness: 0.57, side: THREE.DoubleSide, map: snowTexture }));
    bake(geometry, dishMaterial, [0, 0, 0]); geometry.dispose();
    const point = (a, b, c) => new THREE.Vector3(a, b, c).applyMatrix4(dishGroup.matrix).toArray();
    const rim = new THREE.TorusGeometry(radius, radius * 0.018, 6, 48);
    rim.translate(0, 0, radius / 3.3); rim.applyMatrix4(dishGroup.matrix);
    bake(rim, mat.paleMetal, [0, 0, 0]); rim.dispose();
    for (let i = 0; i < 12; i++) {
      const angle = i / 12 * Math.PI * 2;
      const rib = [];
      for (let j = 0; j <= 8; j++) {
        const r = radius * j / 8;
        rib.push(point(Math.cos(angle) * r, Math.sin(angle) * r, r * r / (radius * 3.3) - 0.045));
      }
      cable(rib, radius * 0.012, mat.steel);
    }
    for (let i = 0; i < 3; i++) {
      const angle = i / 3 * Math.PI * 2 + Math.PI / 2;
      rod(point(Math.cos(angle) * radius * 0.87, Math.sin(angle) * radius * 0.87, radius * 0.24), point(0, 0, radius * 0.9), radius * 0.025, mat.dark);
    }
    ball(point(0, 0, radius * 0.9), [radius * 0.1, radius * 0.1, radius * 0.16], mat.dark);
    rod([x, baseY, z], [x, y, z], radius * 0.15, mat.steel);
    box([x, baseY + 0.12, z], [radius * 0.95, 0.24, radius * 0.95], mat.dark);
  }
  dish(17, 16, -42.8, 3.3, -0.48, -0.38, 10.4);
  dish(29.3, 25.3, -53.8, 2, 0.88, -0.12, 23);
  rod([27, 23, -54], [29.3, 23, -53.8], 0.12);
  dish(-16.2, 8.4, -39.7, 1.8, -0.7, -0.3, 5.4);
  // A large rear uplink gives the station a recognizable, asymmetric silhouette.
  building(-1, -61, 13, 10, 4.3, mat.blue);
  dish(-1, 11.3, -61, 4.6, 0.28, -0.5, 4.6);
  label('UPLINK', [-1, 3.4, -55.93], 4, 0.65);

  // Utility bridge, conduits and external stairs are behind all ground patrols.
  box([-7.8, 3.1, -39.5], [7.6, 3.4, 4.3], mat.blue);
  box([-7.8, 4.93, -39.5], [7.9, 0.26, 4.6], mat.snow);
  for (const x of [-10, -7.6, -5.2]) window(x, 3.3, -37.3, 1.45, 1.5);
  for (let i = 0; i < 19; i++) {
    const y = 0.16 + i * 0.28;
    const z = -27.8 - i * 0.57;
    box([-30.7, y, z], [2.5, 0.14, 0.64], mat.steel);
    box([-30.7, y + 0.085, z], [2.45, 0.035, 0.52], mat.snow);
    if (i % 4 === 0) for (const x of [-31.86, -29.54]) rod([x, y, z], [x, y + 1, z], 0.055);
  }
  for (const x of [-31.86, -29.54]) {
    rod([x, 1.16, -27.8], [x, 6.2, -38.06], 0.065);
    rod([x, 0, -27.8], [x, 5.1, -38.06], 0.13, mat.dark);
  }
  for (const y of [0.9, 1.5]) {
    rod([-27, y, -43.3], [-8, y, -43.3], 0.16, mat.rust);
    rod([-8, y, -43.3], [-8, y, -59], 0.16, mat.rust);
  }

  function container(x, z, width, depth, color) {
    box([x, 1.42, z], [width, 2.84, depth], color);
    box([x, 2.93, z], [width + 0.16, 0.19, depth + 0.16], mat.snow);
    for (const side of [-1, 1]) {
      box([x + side * (width / 2 - 0.12), 1.45, z + depth / 2 + 0.03], [0.15, 2.8, 0.16], mat.steel);
      rod([x + side * width * 0.22, 0.26, z + depth / 2 + 0.12], [x + side * width * 0.22, 2.62, z + depth / 2 + 0.12], 0.04, mat.steel);
    }
    box([x, 1.42, z + depth / 2 + 0.05], [0.07, 2.8, 0.08], mat.dark);
    label('K-07', [x, 2.25, z + depth / 2 + 0.13], Math.min(2, width * 0.6), 0.4);
  }
  container(29.1, -26, 5.2, 10, mat.orange);
  container(-30.2, -52, 5.3, 11, mat.blue);
  container(15.6, -63, 7, 5, mat.paleMetal);
  for (const [x, z] of [[-9, -25], [-7.1, -24.5], [32, -37], [30.4, -38], [-25, -47]]) {
    box([x, 0.5, z], [1.5, 1, 1.2], mat.rust);
    box([x, 1.04, z], [1.58, 0.08, 1.28], mat.snow);
    for (const dx of [-0.5, 0.5]) box([x + dx, 0.52, z + 0.615], [0.07, 1, 0.025], mat.dark);
  }
  for (const [x, z] of [[-10, -29], [-8.8, -28.5], [24.5, -39.5]]) {
    bake(cylinderGeometry, mat.rust, [x, 0.58, z], [0.43, 1.16, 0.43]);
    bake(cylinderGeometry, mat.snow, [x, 1.18, z], [0.44, 0.08, 0.44]);
    for (const y of [0.25, 0.87]) bake(cylinderGeometry, mat.dark, [x, y, z], [0.45, 0.06, 0.45]);
  }
  // Diesel skid and its cable trays.
  box([30.1, 1.05, -43], [4.6, 2.1, 3.2], mat.blue);
  box([30.1, 2.18, -43], [4.8, 0.16, 3.4], mat.snow);
  for (let i = 0; i < 9; i++) box([28.3 + i * 0.42, 1.05, -41.36], [0.13, 1.35, 0.05], mat.dark);
  rod([31.6, 0.7, -44], [31.6, 4.4, -44], 0.16, mat.dark);
  cable([[30, 0.16, -43], [25, 0.16, -46], [24, 0.3, -52]], 0.075);

  // A ploughed entry apron, without a front fence across the shooting lanes.
  const trackTexture = canvasTexture(128, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (const x of [24, 91]) {
      ctx.fillStyle = 'rgba(92,113,126,0.12)'; ctx.fillRect(x - 12, 0, 25, h);
      for (let y = 0; y < h; y += 12) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(-0.2);
        ctx.fillStyle = 'rgba(69,89,99,0.23)'; ctx.fillRect(-9, 0, 18, 4); ctx.restore();
      }
    }
  });
  trackTexture.repeat.set(1, 7);
  const trackMaterial = new THREE.MeshStandardMaterial({ map: trackTexture, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
  const accessRoute = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1, 0, 26), new THREE.Vector3(-1, 0, 4),
    new THREE.Vector3(-12, 0, -16), new THREE.Vector3(-25, 0, -27.5),
  ]);
  const trackGeometry = new THREE.PlaneGeometry(5, 1, 1, 64);
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const p = accessRoute.getPointAt(t);
    const tangent = accessRoute.getTangentAt(t);
    for (let side = 0; side < 2; side++) {
      const offset = (side - 0.5) * 5;
      const x = p.x + tangent.z * offset;
      const z = p.z - tangent.x * offset;
      trackGeometry.attributes.position.setXYZ(i * 2 + side, x, valleyHeight(x, z) + 0.018, z);
    }
  }
  trackGeometry.computeVertexNormals();
  bake(trackGeometry, trackMaterial, [0, 0, 0]); trackGeometry.dispose();
  const wearTexture = canvasTexture(256, 256, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const radius = Math.hypot((x - w / 2) / (w * 0.47), (y - h / 2) / (h * 0.47));
      const grain = noise(x / 13, y / 17);
      const i = (y * w + x) * 4;
      image.data[i] = 114 + grain * 28; image.data[i + 1] = 129 + grain * 24; image.data[i + 2] = 134 + grain * 26;
      image.data[i + 3] = (1 - smooth(0.25, 1, radius + grain * 0.16)) * (30 + grain * 65);
    }
    ctx.putImageData(image, 0, 0);
  });
  const wearMaterial = standard('#ffffff', { map: wearTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [x, z, width, depth] of [[-21, -23, 19, 10], [18.5, -27.5, 4, 5], [29, -19, 6, 4], [-29, -15.8, 5, 3]]) {
    bake(planeGeometry, wearMaterial, [x, 0.022, z], [width, depth, 1], [-Math.PI / 2, 0, 0]);
  }
  const bootTexture = canvasTexture(64, 128, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(63,88,104,0.18)';
    ctx.beginPath(); ctx.ellipse(w / 2, 44, 20, 35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(17, 77, 30, 30);
    ctx.fillStyle = 'rgba(215,226,230,0.5)';
    for (let y = 23; y < 108; y += 12) ctx.fillRect(13, y, 38, 3);
  });
  const bootMaterial = standard('#a3b3bd', { map: bootTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const [start, end, y, z] of [[-25, -11, 0, -10], [17, 27, 0, -11], [3, 13, 10.4, -32], [-24, -16, 5.4, -30.8]]) {
    for (let x = start, i = 0; x < end; x += 0.63, i++) {
      bake(planeGeometry, bootMaterial, [x, y + 0.012, z + (i % 2 ? 0.22 : -0.22)], [0.24, 0.43, 1], [-Math.PI / 2, 0, -Math.PI / 2 + range(-0.12, 0.12)]);
    }
  }
  for (const [x, z, width, depth] of [[-33, -25, 2.2, 5], [33.8, -32, 1.8, 8], [-11.3, -34, 1.1, 4], [23.8, -44, 1.2, 7], [12, -66.5, 7, 1.3]]) {
    drift(x, 0.012, z, width, depth, 0.5);
  }
  for (const [x, z, width, depth, height, yaw] of [
    [-1, -30, 5.5, 1.6, 0.38, 0.04], [11, -30.2, 3.5, 1.2, 0.22, -0.1],
    [25.9, -26, 1.6, 4.6, 0.58, 0.06], [32, -28, 1.8, 5.7, 0.65, -0.08],
    [-31.8, -22, 1.3, 4, 0.42, 0.12], [-12, -22.8, 4, 1.2, 0.32, -0.4],
    [-9.2, -4, 1.5, 7, 0.32, -0.3], [5.3, 9, 1.6, 6.5, 0.4, -0.14],
    [24, -56, 1.8, 2.2, 0.4, 0], [31, -56, 1.4, 2.5, 0.35, 0.2],
  ]) drift(x, valleyHeight(x, z) + 0.01, z, width, depth, height, yaw);
  for (const x of [-32, 33.5]) {
    for (const z of [-8, -13]) {
      box([x, 0.65, z], [3.7, 1.3, 0.85], mat.concrete);
      box([x, 0.8, z + 0.44], [3.4, 0.44, 0.02], mat.hazard);
      box([x, 1.34, z], [3.8, 0.09, 0.94], mat.snow);
    }
  }
  building(-29, -19.5, 5.3, 5, 3.25, mat.blue);
  window(-29, 2.02, -16.93, 3.8, 1.4);
  window(-26.29, 2.02, -19.3, 2.9, 1.4, true, Math.PI / 2);
  label('CHECKPOINT', [-29, 3, -16.85], 4.5, 0.5);
  lamp(-29, 3.15, -16.72, 1.4);

  function fence(from, to) {
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const length = Math.hypot(dx, dz);
    const count = Math.ceil(length / 4.5);
    const texture = fenceTexture.clone(); texture.repeat.set(length / 2.4, 1.35);
    const material = standard('#9daeb2', { map: texture, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.4 });
    bake(planeGeometry, material, [(from[0] + to[0]) / 2, 1.3, (from[1] + to[1]) / 2], [length, 2.6, 1], [0, -Math.atan2(dz, dx), 0]);
    for (let i = 0; i <= count; i++) {
      const x = from[0] + dx * i / count;
      const z = from[1] + dz * i / count;
      rod([x, 0, z], [x, 2.9, z], 0.07);
      rod([x, 2.85, z], [x + 0.22, 3.25, z], 0.045);
      box([x, 0.15, z], [0.32, 0.3, 0.32], mat.concrete);
    }
    for (const y of [0.16, 2.6, 3.15]) rod([from[0], y, from[1]], [to[0], y, to[1]], 0.027);
  }
  fence([-35, -14], [-35, -70]);
  fence([-35, -70], [35, -70]);
  fence([35, -70], [35, -17]);
  for (const [x, z, h] of [[-34, -14, 7], [34, -16, 8], [-34, -57, 8], [33, -67, 8]]) {
    rod([x, 0, z], [x, h, z], 0.12, mat.dark);
    rod([x, h, z], [x - 1.4, h, z], 0.075);
    lamp(x - 1.4, h, z, 2.2);
  }
  cable([[-34, 6.7, -14], [-35, 5, -36], [-34, 7.7, -57]], 0.032);
  cable([[-34, 7.7, -57], [-4, 6.1, -67], [33, 7.7, -67]], 0.032);

  // One atlas: bare needle sprays on the left, patchy upper snow deposits on the right.
  const branchTexture = canvasTexture(1024, 512, (ctx, w, h) => {
    const size = w / 2;
    const twigs = [];
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#61594a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(24, h / 2); ctx.quadraticCurveTo(265, 244, 482, 262); ctx.stroke();
    for (let i = 0; i < 12; i++) for (const side of [-1, 1]) {
      const t = (i + 0.5) / 13;
      const x = 35 + t * 415, y = 251 + t * 10;
      const tx = x + range(36, 79) * (1 - t * 0.45);
      const ty = y + side * Math.sin(t * Math.PI) ** 0.65 * range(125, 185);
      twigs.push([x, y, tx, ty]);
      ctx.strokeStyle = '#405244'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      const angle = Math.atan2(ty - y, tx - x);
      for (let j = 0; j < 13; j++) {
        const q = j / 13;
        const px = THREE.MathUtils.lerp(x, tx, q), py = THREE.MathUtils.lerp(y, ty, q);
        ctx.fillStyle = ['#35483d', '#4a5d49', '#596b53'][j % 3];
        ctx.beginPath(); ctx.ellipse(px, py, 14 * (1 - q * 0.35), 6, angle, 0, Math.PI * 2); ctx.fill();
        for (let n = 0; n < 9; n++) {
          const a = angle + range(-1.2, 1.2), length = range(9, 24) * (1 - q * 0.4);
          ctx.strokeStyle = ['#34483e', '#64775b', '#4f644e'][n % 3]; ctx.lineWidth = range(1.2, 2.4);
          ctx.beginPath(); ctx.moveTo(px + range(-4, 4), py + range(-4, 4));
          ctx.lineTo(px + Math.cos(a) * length, py + Math.sin(a) * length); ctx.stroke();
        }
      }
    }
    ctx.drawImage(ctx.canvas, 0, 0, size, h, size, 0, size, h);
    ctx.save(); ctx.translate(size, 0);
    for (let i = 0; i < twigs.length; i++) {
      if (i % 4 === 0) continue;
      const [x, y, tx, ty] = twigs[i];
      const angle = Math.atan2(ty - y, tx - x);
      for (let j = 0; j < 4; j++) {
        if (random() < 0.2) continue;
        const t = 0.17 + j * 0.17;
        const px = THREE.MathUtils.lerp(x, tx, t), py = THREE.MathUtils.lerp(y, ty, t);
        const radius = range(15, 23);
        ctx.fillStyle = '#a6b8b9';
        ctx.beginPath(); ctx.ellipse(px, py, radius + 3, radius * 0.64, angle, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = j % 2 ? '#dce5e0' : '#edf0e6';
        ctx.beginPath(); ctx.ellipse(px - 2, py - 3, radius, radius * 0.5, angle, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  });
  branchTexture.wrapS = branchTexture.wrapT = THREE.ClampToEdgeWrapping;
  const foliageMaterial = standard('#ffffff', { map: branchTexture, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.96, vertexColors: true });
  for (const material of [foliageMaterial, mat.bark]) {
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
        #include <fog_fragment>
        #ifdef USE_FOG
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(150.0, 340.0, vFogDepth) * 0.24);
        #endif
      `);
    };
  }
  const treeGroups = [[], [], []];
  const groves = [[-76, -8, 26, 29], [-112, -67, 34, 35], [-66, -126, 29, 23], [-140, -177, 32, 26],
    [75, 16, 22, 28], [103, -51, 32, 30], [65, -132, 23, 27], [139, -175, 33, 24], [-12, -173, 28, 20]];
  const treePositions = [];
  for (let i = 0; i < 420; i++) {
    const grove = groves[i % groves.length];
    const angle = range(0, Math.PI * 2), radius = Math.sqrt(random());
    const x = i % 9 ? grove[0] + Math.cos(angle) * radius * grove[2] : range(-175, 175);
    const z = i % 9 ? grove[1] + Math.sin(angle) * radius * grove[3] : range(-210, 52);
    // Preserve the compound and both camera corridors, including full branch reach.
    if (z > -85 && Math.abs(x) < 46) continue;
    if (z > 14 && x > -34 && x < 56) continue;
    if (treePositions.some(p => Math.hypot(p[0] - x, p[1] - z) < 3.5)) continue;
    treePositions.push([x, z]);
    bake(planeGeometry, contactMaterial, [x, valleyHeight(x, z) + 0.035, z], [3, 3, 1], [-Math.PI / 2, 0, 0]);
    const variant = Math.floor(range(0, 3));
    const height = range(6, 14.8) * (radius > 0.8 ? 0.78 : 1);
    treeGroups[variant].push([x, valleyHeight(x, z) - 0.16, z, height, range(0, Math.PI * 2), range(0.83, 1.16)]);
  }
  for (let variant = 0; variant < 3; variant++) {
    const wood = [];
    const positions = [], uvs = [], colors = [], indices = [];
    const lean = [0.018, -0.034, 0.045][variant];
    const trunk = new THREE.CylinderGeometry(0.002, 0.013, 1, 7, 5);
    const trunkP = trunk.attributes.position;
    for (let i = 0; i < trunkP.count; i++) {
      const y = trunkP.getY(i) + 0.5;
      trunkP.setXYZ(i, trunkP.getX(i) + lean * y * y, y, trunkP.getZ(i) + Math.sin(y * 3) * lean * 0.3);
    }
    trunk.computeVertexNormals(); wood.push(trunk);
    const branch = new THREE.CylinderGeometry(0.001, 0.0045, 1, 5, 1, true);
    const branchColor = new THREE.Color();
    const layers = [10, 9, 11][variant];
    for (let layer = 0; layer < layers; layer++) {
      const level = 0.16 + layer / layers * 0.81;
      const count = variant === 1 ? 5 : 6;
      for (let b = 0; b < count; b++) {
        if (random() < (variant === 1 ? 0.19 : 0.1)) continue;
        const yaw = b / count * Math.PI * 2 + layer * 2.399 + range(-0.22, 0.22);
        const y = level + range(-0.026, 0.026);
        const length = Math.pow(1 - level, 0.8) * [0.3, 0.25, 0.28][variant] * range(0.7, 1.2);
        const droop = length * range(0.16, 0.37);
        const base = new THREE.Vector3(lean * y * y, y, Math.sin(y * 3) * lean * 0.3);
        const end = base.clone().add(new THREE.Vector3(Math.cos(yaw) * length, -droop, Math.sin(yaw) * length));
        direction.copy(end).sub(base);
        transform.position.copy(base).addScaledVector(direction, 0.5);
        transform.quaternion.setFromUnitVectors(up, direction.clone().normalize());
        transform.scale.setScalar(1 - level * 0.65); transform.scale.y = direction.length(); transform.updateMatrix();
        wood.push(branch.clone().applyMatrix4(transform.matrix));
        // Bent, crossed sprays occupy individual boughs, never a continuous canopy skirt.
        for (let card = 0; card < 2; card++) {
          const roll = card === 0 ? range(-0.2, 0.2) : range(0.95, 1.3);
          const snowed = card === 0 && random() > [0.18, 0.45, 0.28][variant];
          const offset = positions.length / 3;
          branchColor.set('#ffffff').multiplyScalar(range(0.8, 1));
          for (let row = 0; row <= 3; row++) {
            const t = row / 3;
            const along = length * (t * 1.12 - 0.035);
            for (let side = 0; side < 2; side++) {
              const across = (side - 0.5) * length * 0.95;
              const lateral = across * Math.cos(roll);
              positions.push(base.x + Math.cos(yaw) * along - Math.sin(yaw) * lateral,
                y - droop * t * t + across * Math.sin(roll) + (card === 0 ? 0.003 : -0.004),
                base.z + Math.sin(yaw) * along + Math.cos(yaw) * lateral);
              uvs.push((snowed ? 0.5 : 0) + 0.004 + t * 0.492, 0.015 + side * 0.97);
              colors.push(branchColor.r, branchColor.g, branchColor.b);
            }
            if (row < 3) {
              const a = offset + row * 2;
              indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
          }
        }
      }
    }
    branch.dispose();
    const foliage = new THREE.BufferGeometry();
    foliage.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    foliage.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    foliage.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    foliage.setIndex(indices); foliage.computeVertexNormals();
    const skeleton = mergeGeometries(wood, false);
    for (const part of wood) part.dispose();
    for (const [geometry, material] of [[skeleton, mat.bark], [foliage, foliageMaterial]]) {
      const trees = treeGroups[variant];
      const instances = new THREE.InstancedMesh(geometry, material, trees.length);
      instances.name = `${material === mat.bark ? 'Conifer wood' : 'Needle boughs'} / ${['full spruce', 'sparse fir', 'wind-shaped spruce'][variant]}`;
      for (let i = 0; i < trees.length; i++) {
        const [x, y, z, height, yaw, width] = trees[i];
        transform.position.set(x, y, z); transform.rotation.set(0, yaw, 0);
        transform.scale.set(height * width, height, height * width);
        transform.updateMatrix(); instances.setMatrixAt(i, transform.matrix);
      }
      instances.castShadow = true;
      instances.receiveShadow = material === mat.bark;
      instances.computeBoundingSphere(); world.add(instances);
    }
  }

  const stoneGeometry = new THREE.IcosahedronGeometry(1, 2);
  const stonePositions = stoneGeometry.attributes.position;
  const stoneColors = [];
  const rockSnow = new THREE.Color('#edf1ef');
  for (let i = 0; i < stonePositions.count; i++) {
    const x = stonePositions.getX(i);
    const y = stonePositions.getY(i);
    const z = stonePositions.getZ(i);
    const variation = 0.85 + noise(x * 6 + 40, z * 6 + y * 3) * 0.28;
    stonePositions.setXYZ(i, x * variation, y * variation, z * variation);
    snowColor.set('#5a646c').lerp(rockSnow, smooth(0.2, 0.55, y));
    stoneColors.push(snowColor.r, snowColor.g, snowColor.b);
  }
  stoneGeometry.setAttribute('color', new THREE.Float32BufferAttribute(stoneColors, 3));
  stoneGeometry.computeVertexNormals();
  const stones = [];
  for (let i = 0; i < 120; i++) {
    const x = range(-140, 145);
    const z = range(-150, 70);
    if (Math.abs(x) < 39 && z < 28 && z > -78) continue;
    if (x > -24 && x < 50 && z > 24) continue;
    stones.push([x, valleyHeight(x, z) - 0.3, z, range(1, 4.8), range(0.6, 2.7), range(1.1, 3.8), range(0, 6.28)]);
  }
  const stoneInstances = new THREE.InstancedMesh(stoneGeometry, mat.rock, stones.length);
  stoneInstances.name = 'Snow-crusted granite outcrops';
  for (let i = 0; i < stones.length; i++) {
    const [x, y, z, sx, sy, sz, rotation] = stones[i];
    transform.position.set(x, y, z); transform.rotation.set(0.08, rotation, 0.06); transform.scale.set(sx, sy, sz);
    transform.updateMatrix(); stoneInstances.setMatrixAt(i, transform.matrix);
  }
  stoneInstances.castShadow = true; stoneInstances.receiveShadow = true;
  stoneInstances.computeBoundingSphere(); world.add(stoneInstances);

  const graniteTexture = canvasTexture(512, 512, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const shade = 151 + fbm(x / 96, y / 75) * 45 + noise(x / 9, y / 7) * 15 + random() * 12;
      image.data[i] = shade - 3; image.data[i + 1] = shade; image.data[i + 2] = shade + 2; image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    for (let i = 0; i < 32; i++) {
      const x = range(0, w), y = range(0, h);
      ctx.strokeStyle = 'rgba(42,52,57,0.22)'; ctx.lineWidth = range(0.6, 1.5);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + range(18, 55), y + range(8, 40));
      ctx.lineTo(x + range(60, 110), y + range(35, 70)); ctx.stroke();
    }
  });
  const nearRockMaterial = standard('#98a09e', { map: graniteTexture, bumpMap: graniteTexture, bumpScale: 0.025, roughness: 0.97 });
  const nearRocks = [[-15, 10.1, 60, 7, 4.1, 5, 0.2], [-6, 9.9, 64, 5.3, 2.5, 4, 1.1],
    [7, 9.8, 64, 6, 2.7, 4.7, 0.6], [18, 10.6, 60, 7, 4, 5.3, 2.2], [29, 10.8, 63, 5.5, 3, 4.6, 0.8]];
  for (let variant = 0; variant < 3; variant++) {
    // A soft intersection of fracture planes rounds the edges, not the whole boulder.
    const planes = [[1, 0.32, 0.17, 0.86], [-1, -0.22, 0.23, 0.8], [0.22, -0.28, 1, 0.91],
      [-0.2, 0.26, -1, 0.8], [0.28, 1, -0.22, 0.58], [-0.25, 0.92, 0.4, 0.75], [0, -1, 0, 0.75],
      [0.68, 0.15, 0.72, 0.92], [-0.75, 0.38, -0.62, 0.86], [-0.62, -0.2, 0.73, 0.9], [0.58, -0.4, -0.76, 0.93]]
      .map(([nx, ny, nz, offset], i) => [nx, ny, nz, offset * (0.88 + hash(i, variant + 37) * 0.24)]);
    const fracture = (x, y, z) => {
      let sum = 0;
      for (const [nx, ny, nz, offset] of planes) sum += Math.max(0, (nx * x + ny * y + nz * z) / offset) ** 20;
      return sum ** (-1 / 20);
    };
    const rock = new THREE.SphereGeometry(1, 64, 36);
    const p = rock.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const radius = fracture(x, y, z);
      const relief = (noise(x * 3 + variant * 7, z * 3 + y * 2) - 0.5) * 0.065;
      p.setXYZ(i, x * radius, y * radius + relief, z * radius);
      // Side faces get vertical strata rather than stretched top-down snow UVs.
      rock.attributes.uv.setXY(i, Math.atan2(z, x) * 0.6, y * radius * 0.85);
    }
    rock.computeVertexNormals();
    const cap = new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const capP = cap.attributes.position;
    for (let i = 0; i < capP.count; i++) {
      const u = cap.attributes.uv.getX(i), v = cap.attributes.uv.getY(i);
      const phi = u * Math.PI * 2;
      const rim = 1.14 + Math.sin(phi * 3 + variant) * 0.1 + Math.cos(phi * 5 - variant) * 0.045;
      const theta = (1 - v) * rim;
      const x = -Math.cos(phi) * Math.sin(theta), y = Math.cos(theta), z = Math.sin(phi) * Math.sin(theta);
      const radius = fracture(x, y, z);
      const thickness = 0.012 + smooth(0, 0.12, v) * (0.035 + y * 0.07);
      capP.setXYZ(i, x * (radius + thickness * 0.35), y * radius + thickness
        + (noise(x * 3 + variant * 7, z * 3 + y * 2) - 0.5) * 0.065, z * (radius + thickness * 0.35));
      cap.attributes.uv.setXY(i, x * 0.8, z * 0.8);
    }
    cap.computeVertexNormals();
    for (let i = variant; i < nearRocks.length; i += 3) {
      const [x, y, z, sx, sy, sz, yaw] = nearRocks[i];
      bake(rock, nearRockMaterial, [x, y, z], [sx, sy, sz], [0, yaw, 0]);
      bake(cap, mat.snow, [x, y, z], [sx, sy, sz], [0, yaw, 0]);
      drift(x - sx * 0.18, valleyHeight(x, z) + 0.015, z, sx * 1.17, sz * 1.18, 0.55, yaw);
    }
    rock.dispose(); cap.dispose();
  }

  // Small roof icicles, bollards, antenna fins and snow stakes share existing batches.
  const icicle = new THREE.ConeGeometry(1, 1, 5);
  for (let i = 0; i < 76; i++) {
    const x = range(-4.5, 22.5);
    const length = range(0.13, 0.65);
    bake(icicle, mat.snow, [x, 10.1 - length / 2, -30.08], [range(0.025, 0.065), length, 0.045], [Math.PI, 0, 0]);
  }
  icicle.dispose();
  for (const x of [-24, -11, 15, 28]) {
    rod([x, 0, -15.5], [x, 0.85, -15.5], 0.12, mat.orange);
    bake(cylinderGeometry, mat.snow, [x, 0.91, -15.5], [0.14, 0.12, 0.14]);
  }
  for (const z of [4, 11, 18]) for (const x of [-6.5, 6.5]) {
    const y = valleyHeight(x, z);
    rod([x, y, z], [x, y + 1.25, z], 0.045, mat.orange);
    rod([x, y + 0.85, z], [x, y + 1.15, z], 0.055, mat.snow);
  }
  rod([-2, 10.4, -46], [-2, 16, -46], 0.055);
  for (let i = 0; i < 7; i++) rod([-2.9 + i * 0.09, 15 - i * 0.28, -46], [-1.1 - i * 0.09, 15 - i * 0.28, -46], 0.025);

  // Only practical local lights live here; the main owns all global illumination.
  for (const [position, intensity, distance] of [[[18.5, 3.4, -28.5], 14, 9], [[-29, 2.8, -15.8], 9, 7]]) {
    const light = new THREE.PointLight('#ffbf7e', intensity, distance, 2);
    light.position.fromArray(position); world.add(light);
  }

  for (const [material, geometries] of batches) {
    // A material can include indexed primitives and non-indexed custom geometry.
    const normalized = geometries.map(geometry => geometry.index ? geometry.toNonIndexed() : geometry);
    const geometry = mergeGeometries(normalized, false);
    if (!geometry) throw new Error('Unable to batch alpine station geometry');
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Batched station / ' + (Object.keys(mat).find(key => mat[key] === material) || 'signage');
    mesh.castShadow = !material.transparent && material !== mat.lamp && material.alphaTest === 0;
    mesh.receiveShadow = true;
    world.add(mesh);
    for (const item of normalized) item.dispose();
    for (const item of geometries) if (item.index) item.dispose();
  }
  boxGeometry.dispose(); sphereGeometry.dispose(); planeGeometry.dispose();
  driftGeometry.dispose(); cylinderGeometry.dispose();

  const steamMaterial = new THREE.SpriteMaterial({ map: mistTexture, transparent: true, depthWrite: false, opacity: 0.35, fog: true });
  const steam = [];
  const steamSources = [[3.2, 12.9, -44.5], [-16.5, 8.3, -39.7]];
  for (let i = 0; i < 18; i++) {
    const sprite = new THREE.Sprite(steamMaterial.clone());
    world.add(sprite); steam.push(sprite);
  }
  const spindriftCount = 420;
  const snowPositions = new Float32Array(spindriftCount * 3);
  const snowSeeds = new Float32Array(spindriftCount * 4);
  for (let i = 0; i < spindriftCount; i++) {
    snowSeeds[i * 4] = range(-90, 90);
    snowSeeds[i * 4 + 1] = range(0, 60);
    snowSeeds[i * 4 + 2] = range(-90, 65);
    snowSeeds[i * 4 + 3] = range(0.5, 1.5);
  }
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const flakes = new THREE.Points(snowGeometry, new THREE.PointsMaterial({
    color: '#e2edf5', size: 0.1, map: glowTexture, transparent: true, opacity: 0.42,
    depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true,
  }));
  flakes.name = 'Sparse windblown ice';
  flakes.frustumCulled = false; world.add(flakes);

  const targetSpawns = [
    { position: new THREE.Vector3(-18, 0, -10), patrol: 3.8, name: 'Checkpoint sentry' },
    { position: new THREE.Vector3(22, 0, -11), patrol: 3.1, name: 'Logistics patrol' },
    { position: new THREE.Vector3(8, 10.4, -32), patrol: 4.2, name: 'Operations lookout' },
    { position: new THREE.Vector3(-20, 5.4, -30.8), patrol: 3.2, name: 'Engineering watch' },
    { position: new THREE.Vector3(27, 16.35, -51.5), patrol: 1.55, name: 'Relay technician' },
  ];

  function update(time, dt) {
    const t = Number.isFinite(time) ? time : 0;
    beaconMaterial.opacity = 0.28 + Math.pow(Math.max(0, Math.sin(t * 2.7)), 8) * 0.72;
    mat.red.emissiveIntensity = 0.8 + beaconMaterial.opacity * 2;
    for (let i = 0; i < steam.length; i++) {
      const phase = ((t * 0.095 + i / steam.length) % 1 + 1) % 1;
      const sprite = steam[i];
      const source = steamSources[i % 2];
      sprite.position.set(source[0] + phase * 6.4 + Math.sin(phase * 5 + i) * 0.35, source[1] + phase * 7.5, source[2] - phase * 2.7);
      sprite.scale.set(1 + phase * 4.3, 1.5 + phase * 4.8, 1);
      sprite.material.opacity = Math.sin(phase * Math.PI) * 0.27;
      sprite.material.rotation = phase * 0.5 + i;
    }
    for (let i = 0; i < spindriftCount; i++) {
      const speed = snowSeeds[i * 4 + 3];
      snowPositions[i * 3] = ((snowSeeds[i * 4] + t * 1.7 * speed + 90) % 180 + 180) % 180 - 90;
      snowPositions[i * 3 + 1] = ((snowSeeds[i * 4 + 1] - t * 0.7 * speed) % 60 + 60) % 60;
      snowPositions[i * 3 + 2] = snowSeeds[i * 4 + 2] + Math.sin(t * 0.16 + i) * 0.5;
    }
    snowGeometry.attributes.position.needsUpdate = true;
  }
  update(0, 0);

  return { targetSpawns, update };
}
