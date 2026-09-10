import * as THREE from "three";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const ISLANDS = [
  [-7200, 1500, 1450, 2450, 520],
  [-10100, -1300, 1750, 1000, 390],
  [-6200, 5900, 850, 1400, 280],
  [-11800, 5600, 1350, 2300, 640],
  [-4700, 2300, 480, 650, 125],
];
let terrainGrid;

function hash(x, z) {
  let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function noise2D(x, z, period = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const x0 = period ? ((ix % period) + period) % period : ix;
  const z0 = period ? ((iz % period) + period) % period : iz;
  const x1 = period ? (x0 + 1) % period : ix + 1;
  const z1 = period ? (z0 + 1) % period : iz + 1;
  const a = hash(x0, z0);
  const b = hash(x1, z0);
  const c = hash(x0, z1);
  const d = hash(x1, z1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function createSurfaceTexture() {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const offset = (z * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const frequency = [8, 32, 96][channel];
        data[offset + channel] = Math.round(
          noise2D(
            (x / size) * frequency + channel * 17,
            (z / size) * frequency + channel * 31,
            frequency,
          ) * 255,
        );
      }
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = "Seamless multiscale surface noise";
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function fbm(x, z) {
  return (
    noise2D(x, z) * 0.55 +
    noise2D(x * 2.03 + 17, z * 2.03 - 31) * 0.27 +
    noise2D(x * 4.11 - 11, z * 4.11 + 9) * 0.13 +
    noise2D(x * 8.21 + 4, z * 8.21 + 23) * 0.05
  );
}

function hill(x, z, cx, cz, rx, rz) {
  return Math.exp(-(((x - cx) / rx) ** 2) - ((z - cz) / rz) ** 2);
}

export function coastline(z) {
  return (
    -2200 +
    Math.sin(z * 0.00052) * 500 +
    370 * Math.sin(z * 0.00113) -
    6400 * Math.exp(-(((z + 9600) / 4000) ** 2))
  );
}

// Seed surface for mesh generation and queries made before the first mesh exists.
function analyticHeight(x, z) {
  const airportDistance = Math.hypot(
    Math.max(0, Math.abs(x) - 390),
    Math.max(0, Math.abs(z) - 1250),
  );
  if (airportDistance <= 0) return 18;

  const coastDistance = x - coastline(z);
  const land = smooth(-330, 650, coastDistance);
  const broadNoise = fbm(x * 0.00047 + 20, z * 0.00047 + 10);
  const ridges = 1 - Math.abs(fbm(x * 0.00105 - 70, z * 0.00105 + 19) * 2 - 1);
  const massifs =
    3300 * hill(x, z, 6800, -5800, 4100, 5100) +
    2750 * hill(x, z, -2600, -11200, 4200, 3600) +
    1850 * hill(x, z, 11200, 6500, 4800, 6100) +
    1250 * hill(x, z, -6100, -7600, 2000, 3000);
  const mountainWeight = smooth(1900, 5000, Math.hypot(x * 1.08, z * 0.78));
  const valley =
    1 -
    0.45 * Math.exp(-(((x - 900 - Math.sin(z * 0.0004) * 800) / 1150) ** 2));
  const mountains =
    massifs *
    mountainWeight *
    valley *
    (0.39 + broadNoise * 0.48 + ridges * 0.36);
  const rolling = 24 + broadNoise * 86 + noise2D(x * 0.003, z * 0.003) * 9;
  let height = -42 * (1 - land) + land * (rolling + mountains);

  // A broken archipelago, rather than a second flat land mass.
  for (const [cx, cz, rx, rz, elevation] of ISLANDS) {
    if (Math.abs(x - cx) > rx * 2.8 || Math.abs(z - cz) > rz * 2.8) continue;
    const island = hill(x, z, cx, cz, rx, rz);
    height = Math.max(
      height,
      island * elevation * (0.58 + broadNoise * 0.8) - 62,
    );
  }

  // The outer mesh meets the ocean under the atmospheric horizon.
  const edge = smooth(15300, 17900, Math.max(Math.abs(x), Math.abs(z)));
  height = THREE.MathUtils.lerp(height, -90, edge);
  return THREE.MathUtils.lerp(18, height, smooth(0, 850, airportDistance));
}

function cellIndex(coordinates, value) {
  let low = 0;
  let high = coordinates.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (coordinates[middle] <= value) low = middle;
    else high = middle;
  }
  return low;
}

export function terrainHeight(x, z) {
  if (!terrainGrid) return analyticHeight(x, z);
  const { coordinates, positions, stride } = terrainGrid;
  const first = coordinates[0];
  const last = coordinates[stride - 1];
  if (x < first || x > last || z < first || z > last) return -90;
  const ix = cellIndex(coordinates, x);
  const iz = cellIndex(coordinates, z);
  const u = (x - coordinates[ix]) / (coordinates[ix + 1] - coordinates[ix]);
  const v = (z - coordinates[iz]) / (coordinates[iz + 1] - coordinates[iz]);
  const a = (iz * stride + ix) * 3 + 1;
  const b = a + 3;
  const c = a + stride * 3;
  const d = c + 3;
  // Interpolate the stored Float32 vertices using the mesh's [a,c,b] / [b,c,d] split.
  if (u + v <= 1) {
    return (
      positions[a] +
      u * (positions[b] - positions[a]) +
      v * (positions[c] - positions[a])
    );
  }
  return (
    positions[d] +
    (1 - u) * (positions[c] - positions[d]) +
    (1 - v) * (positions[b] - positions[d])
  );
}

export function createTerrain({
  mobile = false,
  detailTexture = createSurfaceTexture(),
} = {}) {
  const segments = mobile ? 208 : 288;
  const stride = segments + 1;
  const positions = new Float32Array(stride * stride * 3);
  const colors = new Float32Array(positions.length);
  const coordinates = new Float32Array(stride);
  const indices = new Uint32Array(segments * segments * 6);
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * 2 - 1;
    coordinates[i] = Math.sign(t) * Math.abs(t) ** 1.48 * 18000;
  }
  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const offset = (iz * stride + ix) * 3;
      const x = coordinates[ix];
      const z = coordinates[iz];
      positions[offset] = x;
      positions[offset + 1] = analyticHeight(x, z);
      positions[offset + 2] = z;
    }
  }

  const meadow = new THREE.Color("#738966");
  const forest = new THREE.Color("#385c49");
  const alpine = new THREE.Color("#82866c");
  const stone = new THREE.Color("#aaa28c");
  const cliff = new THREE.Color("#afa393");
  const snow = new THREE.Color("#e4e5dd");
  const beach = new THREE.Color("#c2b99a");
  const grass = new THREE.Color("#7c8958");
  const color = new THREE.Color();

  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const offset = (iz * stride + ix) * 3;
      const x = coordinates[ix];
      const z = coordinates[iz];
      const y = positions[offset + 1];
      const xl = Math.max(0, ix - 1);
      const xr = Math.min(segments, ix + 1);
      const zl = Math.max(0, iz - 1);
      const zr = Math.min(segments, iz + 1);
      const dx =
        (positions[(iz * stride + xr) * 3 + 1] -
          positions[(iz * stride + xl) * 3 + 1]) /
        (coordinates[xr] - coordinates[xl]);
      const dz =
        (positions[(zr * stride + ix) * 3 + 1] -
          positions[(zl * stride + ix) * 3 + 1]) /
        (coordinates[zr] - coordinates[zl]);
      const slope = Math.hypot(dx, dz);
      const woodland = smooth(
        0.34,
        0.67,
        noise2D(x * 0.0009 + 50, z * 0.0009 - 30),
      );
      color
        .copy(meadow)
        .lerp(
          forest,
          woodland *
            (0.3 + smooth(100, 750, y) * 0.55) *
            (1 - smooth(0.45, 0.95, slope)),
        );
      color.lerp(alpine, smooth(1050, 1780, y));
      color.lerp(stone, smooth(1500, 2350, y));
      color.lerp(cliff, smooth(0.48, 1.35, slope) * smooth(80, 300, y) * 0.77);
      color.lerp(
        snow,
        smooth(2480, 2950, y + noise2D(x * 0.008, z * 0.008) * 180) *
          (1 - smooth(0.9, 1.9, slope) * 0.8),
      );
      color.lerp(beach, 1 - smooth(-3, 23, y));
      if (Math.abs(x) < 420 && Math.abs(z) < 1300) {
        color
          .copy(grass)
          .multiplyScalar(0.96 + (Math.floor((z + 1500) / 75) % 2) * 0.07);
      }
      const grain =
        noise2D(x * 0.009, z * 0.009) * 0.12 +
        noise2D(x * 0.0009 + 80, z * 0.0009) * 0.16;
      color.multiplyScalar(0.86 + grain);
      color.toArray(colors, offset);
      if (ix < segments && iz < segments) {
        const a = iz * stride + ix;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        const index = (iz * segments + ix) * 6;
        indices.set([a, c, b, b, c, d], index);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
  });
  material.userData.detailTexture = detailTexture;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.surfaceDetail = { value: detailTexture };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `
      #include <common>
      varying vec3 vTerrainPosition;
      varying float vTerrainSlope;
    `,
      )
      .replace(
        "#include <begin_vertex>",
        `
      #include <begin_vertex>
      vTerrainPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vTerrainSlope = 1.0 - abs(normal.y);
    `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `
      #include <common>
      uniform sampler2D surfaceDetail;
      varying vec3 vTerrainPosition;
      varying float vTerrainSlope;
    `,
      )
      .replace(
        "#include <color_fragment>",
        `
      #include <color_fragment>
      vec3 terrainPoint = vTerrainPosition;
      float detailDistance = length(vViewPosition);
      float nearDetail = 1.0 - smoothstep(300.0, 2600.0, detailDistance);
      float landscapeDetail = 1.0 - smoothstep(6500.0, 19000.0, detailDistance);
      vec3 soil = texture2D(surfaceDetail, terrainPoint.xz * 0.0017).rgb;
      vec3 fineSoil = texture2D(surfaceDetail, terrainPoint.xz * 0.017 + vec2(0.31, 0.73)).rgb;
      float airport = 1.0 - smoothstep(0.0, 180.0,
        max(abs(terrainPoint.x) - 420.0, abs(terrainPoint.z) - 1300.0));
      float pasture = (1.0 - airport) * (1.0 - smoothstep(0.18, 0.48, vTerrainSlope))
        * smoothstep(22.0, 90.0, terrainPoint.y) * (1.0 - smoothstep(1250.0, 1850.0, terrainPoint.y));
      diffuseColor.rgb *= 1.0 + ((soil.r - 0.5) * 0.25 + (soil.g - 0.5) * 0.12) * landscapeDetail;
      diffuseColor.rgb *= 1.0 + ((fineSoil.r - 0.5) * 0.12 + (fineSoil.g - 0.5) * 0.045)
        * nearDetail * (1.0 - airport * 0.65);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.85, 0.76),
        smoothstep(0.38, 0.71, soil.r) * pasture * landscapeDetail * 0.6);
      float rockFace = smoothstep(0.18, 0.56, vTerrainSlope) * smoothstep(35.0, 190.0, terrainPoint.y);
      if (rockFace > 0.01) {
        vec3 rock = texture2D(surfaceDetail,
          vec2(dot(terrainPoint.xz, vec2(0.00091, 0.00067)), terrainPoint.y * 0.0018)).rgb;
        float strata = texture2D(surfaceDetail,
          vec2(terrainPoint.y * 0.0008 + rock.r * 0.035, 0.37)).g;
        diffuseColor.rgb *= 1.0 + ((rock.r - 0.5) * 0.44 + (strata - 0.5) * 0.24
          + (rock.g - 0.5) * 0.12) * rockFace * landscapeDetail;
      }
    `,
      );
  };
  material.customProgramCacheKey = () => "coastal-surface-detail-v1";
  const terrain = new THREE.Mesh(geometry, material);
  terrain.name = "Coastal alpine terrain - 36 km";
  terrain.receiveShadow = true;
  terrainGrid = { coordinates, positions, stride };
  return terrain;
}
