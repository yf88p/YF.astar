import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mapPoint, portalLocal, portalRotation, roomBounds } from "./core.js";

const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const vec = (a) => new THREE.Vector3().fromArray(a);
const quat = (a) => new THREE.Quaternion().fromArray(a);
const surfaceFrames = [
  { axis: 2, sign: 1, q: [0, 0, 0, 1], dims: [0, 1] },
  { axis: 2, sign: -1, q: [0, 1, 0, 0], dims: [0, 1] },
  { axis: 0, sign: 1, q: [0, Math.SQRT1_2, 0, Math.SQRT1_2], dims: [2, 1] },
  { axis: 0, sign: -1, q: [0, -Math.SQRT1_2, 0, Math.SQRT1_2], dims: [2, 1] },
  { axis: 1, sign: 1, q: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], dims: [0, 2] },
  { axis: 1, sign: -1, q: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], dims: [0, 2] },
];

export function portalPlane(portal, offset = 0) {
  const normal = Z.clone().applyQuaternion(quat(portal.quaternion));
  return new THREE.Plane().setFromNormalAndCoplanarPoint(
    normal,
    vec(portal.position).addScaledVector(normal, offset),
  );
}

// Lengyel's oblique near plane leaves the horizontal/vertical projection intact.
export function clipProjection(camera, plane) {
  camera.updateMatrixWorld(true);
  const local = plane.clone().applyMatrix4(camera.matrixWorldInverse);
  const c = new THREE.Vector4(
    local.normal.x,
    local.normal.y,
    local.normal.z,
    local.constant,
  );
  const e = camera.projectionMatrix.elements;
  const q = new THREE.Vector4(
    (Math.sign(c.x) + e[8]) / e[0],
    (Math.sign(c.y) + e[9]) / e[5],
    -1,
    (1 + e[10]) / e[14],
  );
  const denominator = c.dot(q);
  if (Math.abs(denominator) < 1e-7) return;
  c.multiplyScalar(2 / denominator);
  e[2] = c.x;
  e[6] = c.y;
  e[10] = c.z + 1;
  e[14] = c.w;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

function portalMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      image: { value: null },
      ready: { value: false },
      tint: { value: new THREE.Color(color) },
    },
    vertexShader: `#include <clipping_planes_pars_vertex>
      varying vec4 projected; varying vec2 vUv;
      void main() { vUv=uv; vec4 mvPosition=modelViewMatrix*vec4(position,1.); projected=projectionMatrix*mvPosition; gl_Position=projected;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform sampler2D image; uniform bool ready; uniform vec3 tint; varying vec4 projected; varying vec2 vUv;
      void main() {
        #include <clipping_planes_fragment>
        if(ready) gl_FragColor=texture2D(image,projected.xy/projected.w*.5+.5);
        else { vec2 p=abs(vUv-.5); float rings=pow(.5+.5*cos(max(p.x,p.y)*100.),16.); float horizon=exp(-length((vUv-.5)*vec2(1.,.7))*4.);
          gl_FragColor=vec4(tint*(.045+rings*.075+horizon*.14),1.); }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    clipping: true,
  });
}

function concreteMaterial(color, floor = false) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.88,
    metalness: 0.06,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying vec3 worldPoint;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nworldPoint=(modelMatrix*vec4(position,1.)).xyz;",
      );
    shader.fragmentShader =
      "varying vec3 worldPoint;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
      float grain=fract(sin(dot(floor(worldPoint*120.),vec3(12.9898,78.233,43.11)))*43758.5453);
      diffuseColor.rgb*=.96+grain*.07;
      ${floor ? "vec2 tile=abs(fract(worldPoint.xz/2.)-.5); float seam=smoothstep(.492,.499,max(tile.x,tile.y)); diffuseColor.rgb*=1.-seam*.48;" : "float seam=smoothstep(.495,.5,abs(fract(worldPoint.y/1.25)-.5)); diffuseColor.rgb*=1.-seam*.12;"}`,
      );
  };
  material.customProgramCacheKey = () => `concrete-${floor}`;
  return material;
}

function textTexture(lines, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = options.width || 1024;
  canvas.height = options.height || 512;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const line of lines) {
    ctx.font = `${line.weight || 500} ${line.size || 64}px ${line.mono ? "monospace" : "Arial, sans-serif"}`;
    ctx.fillStyle = line.color || "#d0e0d7";
    ctx.textAlign = line.align || "left";
    ctx.fillText(line.text, line.x ?? 24, line.y ?? 80);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function batchBody(group) {
  group.updateMatrixWorld(true);
  const batches = new Map(),
    oldGeometries = new Set(),
    oldMaterials = new Set();
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const m = mesh.material;
    const key = [
      m.color.getHex(),
      m.emissive?.getHex(),
      m.emissiveIntensity,
      m.roughness,
      m.metalness,
    ].join("/");
    if (!batches.has(key))
      batches.set(key, { material: m.clone(), geometries: [] });
    const geometry = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    batches.get(key).geometries.push(geometry);
    oldGeometries.add(mesh.geometry);
    oldMaterials.add(m);
  });
  group.clear();
  for (const { material, geometries } of batches.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.forEach((g) => g.dispose());
  }
  oldGeometries.forEach((g) => g.dispose());
  oldMaterials.forEach((m) => m.dispose());
  return group;
}

export class PortalRenderer {
  constructor(container, world) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = true;
    this.renderer.info.autoReset = false;
    container.prepend(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Live first-person portal chamber. Click Enter Chamber to play.",
    );
    this.renderer.domElement.tabIndex = 0;
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.025, 180);
    this.orbitCamera = new THREE.PerspectiveCamera(53, 1, 0.05, 500);
    this.orbit = new OrbitControls(this.orbitCamera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.enabled = false;
    this.orbit.minDistance = 2;
    this.orbit.maxDistance = 100;
    this.targets = [];
    this.recursion = 3;
    this.maxViews = 20;
    this.targetLimit = 1024;
    this.stats = {
      views: 0,
      maxDepth: 0,
      targetBytes: 0,
      drawCalls: 0,
      triangles: 0,
      renderMs: 0,
    };
    this.editorMode = false;
    this.overlays = true;
    this.reducedMotion = false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.setWorld(world);
    this.resize();
  }

  _mesh(geometry, material, parent, position, quaternion) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.fromArray(position);
    if (quaternion) mesh.quaternion.fromArray(quaternion);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  _box(parent, size, position, material, rounded = false) {
    return this._mesh(
      rounded
        ? new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.09)
        : new THREE.BoxGeometry(...size),
      material,
      parent,
      position,
    );
  }

  _decal(parent, width, height, position, quaternion, lines, options) {
    const texture = textTexture(lines, options);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const apertures = this.world.doc.portals.filter(
      (p) =>
        p.room === parent.userData.room &&
        this.world._pair(p) &&
        Math.abs(portalLocal(vec(position), p).z) < 0.04,
    );
    if (apertures.length) {
      // Wall typography is a surface treatment, so apertures cut its pixels too.
      material.onBeforeCompile = (shader) => {
        let declarations = "varying vec3 decalWorld;\n",
          discard = "";
        apertures.forEach((p, i) => {
          shader.uniforms[`apertureInverse${i}`] = {
            value: new THREE.Matrix4()
              .compose(
                vec(p.position),
                quat(p.quaternion),
                new THREE.Vector3(1, 1, 1),
              )
              .invert(),
          };
          shader.uniforms[`apertureSize${i}`] = {
            value: new THREE.Vector2(p.width / 2, p.height / 2),
          };
          declarations += `uniform mat4 apertureInverse${i}; uniform vec2 apertureSize${i};\n`;
          discard += `{vec3 aperturePoint=(apertureInverse${i}*vec4(decalWorld,1.)).xyz;if(all(lessThan(abs(aperturePoint.xy),apertureSize${i})))discard;}\n`;
        });
        shader.vertexShader =
          "varying vec3 decalWorld;\n" +
          shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\ndecalWorld=(modelMatrix*vec4(position,1.)).xyz;",
          );
        shader.fragmentShader =
          declarations +
          shader.fragmentShader.replace(
            "#include <map_fragment>",
            "#include <map_fragment>\n" + discard,
          );
      };
      material.customProgramCacheKey = () =>
        `aperture-decal-${apertures.length}`;
    }
    const mesh = this._mesh(
      new THREE.PlaneGeometry(width, height),
      material,
      parent,
      position,
      quaternion,
    );
    return mesh;
  }

  _walls(room, group) {
    const { min, max } = roomBounds(room);
    for (const frame of surfaceFrames) {
      const position = vec(room.center).setComponent(
        frame.axis,
        (frame.sign > 0 ? min : max).getComponent(frame.axis),
      );
      const q = quat(frame.q),
        width = room.size[frame.dims[0]],
        height = room.size[frame.dims[1]];
      const shape = new THREE.Shape();
      shape.moveTo(-width / 2, -height / 2);
      shape.lineTo(width / 2, -height / 2);
      shape.lineTo(width / 2, height / 2);
      shape.lineTo(-width / 2, height / 2);
      shape.closePath();
      for (const p of this.world.doc.portals.filter(
        (p) => p.room === room.id && this.world._pair(p),
      )) {
        const n = Z.clone().applyQuaternion(quat(p.quaternion));
        if (n.distanceTo(Z.clone().applyQuaternion(q)) > 1e-4) continue;
        const hole = new THREE.Path();
        const points = [
          [-1, -1],
          [-1, 1],
          [1, 1],
          [1, -1],
        ].map(([x, y]) =>
          new THREE.Vector3((x * p.width) / 2, (y * p.height) / 2, 0)
            .applyQuaternion(quat(p.quaternion))
            .add(vec(p.position))
            .sub(position)
            .applyQuaternion(q.clone().invert()),
        );
        points.forEach((p, i) =>
          i ? hole.lineTo(p.x, p.y) : hole.moveTo(p.x, p.y),
        );
        hole.closePath();
        shape.holes.push(hole);
      }
      let color;
      if (frame.axis === 1) color = frame.sign === 1 ? "#53615c" : "#202e2d";
      else
        color =
          frame.axis === 2
            ? new THREE.Color(room.color).lerp(new THREE.Color("#5b6964"), 0.4)
            : new THREE.Color(room.color).lerp(
                new THREE.Color("#818b80"),
                0.42,
              );
      const wall = this._mesh(
        new THREE.ShapeGeometry(shape),
        concreteMaterial(color, frame.axis === 1 && frame.sign === 1),
        group,
        position.toArray(),
        frame.q,
      );
      wall.userData.room = room.id;
      wall.userData.wall = true;
      if (frame.axis === 1 && frame.sign === -1) wall.userData.ceiling = true;
    }
    // Flush architectural strips are visual surface details, not hidden obstacles.
    const lightMat = new THREE.MeshBasicMaterial({ color: "#cbe8dc" });
    const dark = new THREE.MeshStandardMaterial({
      color: "#172727",
      roughness: 0.65,
      metalness: 0.55,
    });
    for (const x of [min.x + 0.7, max.x - 0.7]) {
      this._box(
        group,
        [0.09, 0.008, room.size[2] * 0.78],
        [x, max.y - 0.015, room.center[2]],
        lightMat,
      );
      this._box(
        group,
        [0.24, 0.02, room.size[2] * 0.8],
        [x, max.y - 0.005, room.center[2]],
        dark,
      );
    }
    for (const x of [min.x + 0.006, max.x - 0.006]) {
      this._box(
        group,
        [0.012, 0.06, room.size[2]],
        [x, min.y + 0.2, room.center[2]],
        dark,
      );
      this._box(
        group,
        [0.014, 0.022, room.size[2]],
        [x, min.y + 3.8, room.center[2]],
        new THREE.MeshBasicMaterial({ color: room.color }).clone(),
      );
    }
    const index = this.world.doc.rooms.indexOf(room) + 1;
    const isFirst = index === 1;
    this._decal(
      group,
      4.5,
      2.25,
      [room.center[0] + (isFirst ? 2.25 : -2.3), min.y + 2.15, min.z + 0.018],
      [0, 0, 0, 1],
      [
        {
          text: String(index).padStart(2, "0"),
          size: 235,
          weight: 600,
          y: 258,
          color: "#b3c7bb",
        },
        {
          text: room.name.toUpperCase(),
          size: 40,
          mono: true,
          y: 344,
          color: "#9db5ab",
        },
        {
          text: "PARALLAX  /  SPATIAL RESEARCH DIVISION",
          size: 18,
          mono: true,
          y: 405,
          color: "#9aafa4",
        },
        {
          text: "________________________________________",
          size: 24,
          y: 440,
          color: "#829d92",
        },
      ],
    );
    this._decal(
      group,
      3.5,
      1.75,
      [min.x + 0.019, min.y + 2.4, room.center[2] - 1],
      [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      [
        { text: "SPACE IS A", size: 76, weight: 600, y: 135, color: "#c5d4c6" },
        { text: "MATTER OF", size: 76, weight: 600, y: 230, color: "#c5d4c6" },
        {
          text: "PERSPECTIVE.",
          size: 76,
          weight: 600,
          y: 325,
          color: "#c5d4c6",
        },
        {
          text: "OBSERVE.  CONNECT.  RECONSIDER.",
          size: 25,
          mono: true,
          y: 425,
          color: "#8ba89a",
        },
      ],
    );
    const ambient = new THREE.HemisphereLight("#dceee6", "#31382a", 1.65);
    group.add(ambient);
    const warm = /annex|landing|vault/.test(room.id);
    const spot = new THREE.SpotLight(
      warm ? "#ffd5a0" : "#e5fff2",
      125,
      35,
      0.96,
      0.65,
      1.4,
    );
    spot.position.set(room.center[0] + 1, max.y - 0.25, room.center[2] + 2);
    spot.target.position.set(room.center[0] - 1, min.y, room.center[2] - 2);
    spot.castShadow = true;
    spot.shadow.mapSize.set(768, 768);
    spot.shadow.bias = -0.0008;
    spot.shadow.normalBias = 0.045;
    spot.shadow.camera.far = 40;
    spot.shadow.autoUpdate = false;
    spot.shadow.needsUpdate = true;
    group.add(spot, spot.target);
    this.lights.push(spot);
    const fill = new THREE.PointLight(
      new THREE.Color(room.color).lerp(new THREE.Color("#b1d5cd"), 0.5),
      35,
      18,
      1.5,
    );
    fill.position.set(room.center[0] - 3, min.y + 2.7, room.center[2] - 4);
    group.add(fill);
  }

  _portal(p) {
    const online = !!this.world._pair(p);
    const root = new THREE.Group();
    root.position.fromArray(p.position);
    root.quaternion.fromArray(p.quaternion);
    root.userData.entityId = p.id;
    this.rooms.get(p.room).add(root);
    const frameMat = new THREE.MeshStandardMaterial({
      color: "#182e2d",
      roughness: 0.45,
      metalness: 0.8,
    });
    const lightMat = new THREE.MeshBasicMaterial({
      color: online ? p.color : "#40554a",
    });
    for (const s of [-1, 1]) {
      this._box(
        root,
        [0.19, p.height + 0.38, 0.16],
        [s * (p.width / 2 + 0.095), 0, 0.015],
        frameMat,
        true,
      );
      this._box(
        root,
        [p.width + 0.38, 0.19, 0.16],
        [0, s * (p.height / 2 + 0.095), 0.015],
        frameMat,
        true,
      );
      this._box(
        root,
        [0.029, p.height + 0.09, 0.015],
        [s * (p.width / 2 + 0.035), 0, 0.102],
        lightMat,
      );
      this._box(
        root,
        [p.width + 0.09, 0.029, 0.015],
        [0, s * (p.height / 2 + 0.035), 0.102],
        lightMat,
      );
      for (const y of [-p.height / 2 + 0.2, p.height / 2 - 0.2])
        this._box(
          root,
          [0.06, 0.14, 0.025],
          [s * (p.width / 2 + 0.115), y, 0.11],
          new THREE.MeshBasicMaterial({ color: "#ccddd0" }),
        );
    }
    const material = portalMaterial(p.color);
    const surface = this._mesh(
      new THREE.PlaneGeometry(p.width, p.height),
      material,
      root,
      [0, 0, 0],
    );
    surface.receiveShadow = false;
    surface.userData.entityId = p.id;
    surface.visible = online;
    this._decal(
      root,
      2.5,
      0.32,
      [0, p.height / 2 + 0.43, 0.02],
      [0, 0, 0, 1],
      [
        {
          text: `${p.color === "#65ebcb" ? "A" : "B"}  /  TRANSIT LINK`,
          size: 57,
          mono: true,
          y: 104,
          color: p.color,
        },
        {
          text: online ? "CONNECTED     <>" : "LINK DISABLED",
          size: 33,
          mono: true,
          y: 184,
          color: "#a8bcb0",
        },
      ],
      { height: 256 },
    );
    const glow = this._mesh(
      new THREE.PlaneGeometry(p.width + 0.85, p.height + 0.85),
      new THREE.ShaderMaterial({
        uniforms: {
          tint: { value: new THREE.Color(p.color) },
          shape: { value: new THREE.Vector2(p.width, p.height) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader:
          "varying vec2 v; void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader:
          "uniform vec3 tint;uniform vec2 shape;varying vec2 v;void main(){vec2 d=abs((v-.5)*(shape+.85))-shape*.5;float a=exp(-length(max(d,0.))*15.)*.17;if(max(d.x,d.y)<0.)a=0.;gl_FragColor=vec4(tint,a);}",
      }),
      root,
      [0, 0, 0.11],
    );
    glow.receiveShadow = false;
    glow.visible = online;
    const light = new THREE.PointLight(p.color, online ? 11 : 0, 5, 1.4);
    light.position.z = 0.65;
    root.add(light);
    const normal = Z.clone().applyQuaternion(quat(p.quaternion));
    if (Math.abs(normal.y) < 0.001) {
      const floor = roomBounds(this.world.rooms.get(p.room)).min.y;
      const marking = vec(p.position).addScaledVector(normal, 0.8);
      marking.y = floor + 0.02;
      const rotation = new THREE.Quaternion()
        .setFromAxisAngle(UP, Math.atan2(normal.x, normal.z))
        .multiply(new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2));
      this._decal(
        this.rooms.get(p.room),
        p.width + 0.25,
        0.45,
        marking.toArray(),
        rotation.toArray(),
        [
          {
            text: "- - - - - - - - - - - - - - - - - -",
            size: 64,
            mono: true,
            y: 105,
            color: p.color,
          },
          {
            text: "MIND THE GAP  /  TRANSIT ZONE",
            size: 43,
            mono: true,
            y: 210,
            color: p.color,
          },
        ],
        { height: 256 },
      );
    }
    this.portals.set(p.id, { root, surface, material, portal: p });
  }

  _cube(body) {
    const group = new THREE.Group();
    group.userData.entityId = body.id;
    const h = body.size / 2;
    const chassis = new THREE.MeshStandardMaterial({
      color: "#263c38",
      metalness: 0.6,
      roughness: 0.4,
    });
    const panel = new THREE.MeshStandardMaterial({
      color: "#d0d9c8",
      metalness: 0.23,
      roughness: 0.43,
    });
    this._box(
      group,
      [body.size, body.size, body.size],
      [0, 0, 0],
      chassis,
      true,
    ).castShadow = true;
    for (const frame of surfaceFrames) {
      const face = new THREE.Group();
      face.quaternion.fromArray(frame.q);
      face.position.copy(
        Z.clone()
          .applyQuaternion(face.quaternion)
          .multiplyScalar(h + 0.001),
      );
      group.add(face);
      this._box(
        face,
        [body.size * 0.77, body.size * 0.77, 0.016],
        [0, 0, 0],
        panel,
        true,
      ).castShadow = true;
      const ring = this._mesh(
        new THREE.TorusGeometry(body.size * 0.15, 0.014, 5, 24),
        new THREE.MeshStandardMaterial({
          color: "#73ddba",
          emissive: "#41b590",
          emissiveIntensity: 0.45,
          metalness: 0.3,
          roughness: 0.4,
        }),
        face,
        [0, 0, 0.017],
      );
      ring.castShadow = true;
      this._box(face, [0.054, 0.054, 0.012], [0, 0, 0.017], chassis);
      for (const s of [-1, 1])
        this._box(
          face,
          [body.size * 0.55, 0.012, 0.005],
          [0, s * body.size * 0.28, 0.014],
          chassis,
        );
    }
    return batchBody(group);
  }

  _avatar() {
    const group = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({
      color: "#c5d1be",
      roughness: 0.6,
      metalness: 0.12,
    });
    const joint = new THREE.MeshStandardMaterial({
      color: "#283c36",
      roughness: 0.55,
      metalness: 0.3,
    });
    const visor = new THREE.MeshStandardMaterial({
      color: "#224643",
      emissive: "#48a690",
      emissiveIntensity: 0.2,
      metalness: 0.8,
      roughness: 0.15,
    });
    this._box(group, [0.42, 0.58, 0.27], [0, 0.05, 0], suit, true);
    this._box(group, [0.3, 0.31, 0.29], [0, 0.52, 0], suit, true);
    this._box(group, [0.27, 0.13, 0.035], [0, 0.53, -0.155], visor, true);
    this._box(group, [0.23, 0.29, 0.16], [0, 0.1, 0.2], joint, true);
    for (const s of [-1, 1]) {
      this._box(group, [0.14, 0.53, 0.16], [s * 0.31, -0.04, 0], suit, true);
      this._box(group, [0.17, 0.48, 0.19], [s * 0.115, -0.5, 0], joint, true);
      this._box(
        group,
        [0.19, 0.13, 0.3],
        [s * 0.115, -0.775, -0.04],
        suit,
        true,
      );
    }
    return batchBody(group);
  }

  setWorld(world) {
    if (this.scene) this._disposeScene();
    this.world = world;
    this.portalState = world.doc.portals.map((p) => Number(p.enabled)).join("");
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#111f20");
    this.rooms = new Map();
    this.portals = new Map();
    this.bodies = new Map();
    this.doors = new Map();
    this.plates = new Map();
    this.goals = new Map();
    this.lights = [];
    for (const room of world.doc.rooms) {
      const group = new THREE.Group();
      group.userData.room = room.id;
      this.rooms.set(room.id, group);
      this.scene.add(group);
      this._walls(room, group);
    }
    const stone = concreteMaterial("#839083");
    for (const block of world.doc.blocks) {
      const mesh = this._box(
        this.rooms.get(block.room),
        block.size,
        block.position,
        stone,
      );
      if (block.rotation) mesh.quaternion.fromArray(block.rotation);
      mesh.castShadow = true;
      mesh.userData.entityId = block.id;
    }
    for (const p of world.doc.portals) this._portal(p);
    for (const body of world.cubes.values()) {
      const mesh = this._cube(body),
        copy = this._cube(body);
      this.scene.add(mesh, copy);
      this.bodies.set(body.id, { body, mesh, copy });
    }
    this.avatar = this._avatar();
    this.avatarCopy = this._avatar();
    this.scene.add(this.avatar, this.avatarCopy);
    for (const plate of world.doc.plates) {
      const group = new THREE.Group();
      group.position.fromArray(plate.position);
      group.userData.entityId = plate.id;
      this.rooms.get(plate.room).add(group);
      this._box(
        group,
        plate.size,
        [0, 0, 0],
        new THREE.MeshStandardMaterial({
          color: "#233f36",
          roughness: 0.5,
          metalness: 0.6,
        }),
        true,
      );
      const ring = this._mesh(
        new THREE.BoxGeometry(
          plate.size[0] - 0.12,
          0.014,
          plate.size[2] - 0.12,
        ),
        new THREE.MeshStandardMaterial({
          color: "#54725e",
          emissive: "#75e7b3",
          emissiveIntensity: 0.15,
          roughness: 0.5,
        }),
        group,
        [0, plate.size[1] / 2 + 0.008, 0],
      );
      this._decal(
        group,
        1,
        0.5,
        [0, plate.size[1] / 2 + 0.02, 0],
        [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
        [
          {
            text: "PLACE MASS",
            size: 115,
            mono: true,
            y: 215,
            color: "#c0d7b5",
          },
          {
            text: "SENSOR / 01",
            size: 55,
            mono: true,
            y: 337,
            color: "#c0d7b5",
          },
        ],
      );
      this.plates.set(plate.id, { group, ring });
    }
    for (const door of world.doc.doors) {
      const group = new THREE.Group();
      group.position.fromArray(door.position);
      group.userData.entityId = door.id;
      this.rooms.get(door.room).add(group);
      const mat = new THREE.MeshStandardMaterial({
        color: "#697568",
        roughness: 0.55,
        metalness: 0.5,
      });
      this._box(group, door.size, [0, 0, 0], mat).castShadow = true;
      const alongX = door.size[0] > door.size[2];
      for (let y = -door.size[1] / 2 + 0.15; y < door.size[1] / 2; y += 0.35)
        this._box(
          group,
          alongX ? [door.size[0], 0.012, 0.014] : [0.014, 0.012, door.size[2]],
          alongX
            ? [0, y, door.size[2] / 2 + 0.012]
            : [-door.size[0] / 2 - 0.012, y, 0],
          new THREE.MeshBasicMaterial({ color: "#273e34" }),
        );
      const indicator = this._box(
        group,
        alongX ? [0.9, 0.035, 0.01] : [0.01, 0.035, 0.9],
        alongX
          ? [0, 0, door.size[2] / 2 + 0.03]
          : [-door.size[0] / 2 - 0.03, 0, 0],
        new THREE.MeshBasicMaterial({ color: "#ffbf78" }),
      );
      this._decal(
        group,
        2,
        1,
        alongX
          ? [0, 0.8, door.size[2] / 2 + 0.022]
          : [-door.size[0] / 2 - 0.022, 0.8, 0],
        alongX ? [0, 0, 0, 1] : [0, -Math.SQRT1_2, 0, Math.SQRT1_2],
        [
          {
            text: "EXIT / LOCKED",
            size: 80,
            mono: true,
            y: 200,
            color: "#e2dac1",
          },
          {
            text: "AWAITING WEIGHT SIGNAL",
            size: 32,
            mono: true,
            y: 310,
            color: "#c3c7aa",
          },
        ],
      );
      this.doors.set(door.id, { group, indicator, door });
    }
    for (const goal of world.doc.goals) {
      const group = new THREE.Group();
      group.position.fromArray(goal.position);
      this.rooms.get(goal.room).add(group);
      group.userData.entityId = goal.id;
      const ring = this._mesh(
        new THREE.RingGeometry(0.45, 0.53, 40),
        new THREE.MeshBasicMaterial({
          color: "#b8f7c5",
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
        }),
        group,
        [0, -goal.size[1] / 2 + 0.025, 0],
        [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      );
      const beacon = this._mesh(
        new THREE.CylinderGeometry(0.48, 0.48, goal.size[1], 32, 1, true),
        new THREE.MeshBasicMaterial({
          color: "#a4efb7",
          transparent: true,
          opacity: 0.075,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        group,
      );
      this.goals.set(goal.id, { group, ring, beacon });
    }
    this.overlayGroup = new THREE.Group();
    this.scene.add(this.overlayGroup);
    this._buildOverlays();
    this.focusRoom(world.doc.spawn.room);
    this.releaseTargets();
  }

  _buildOverlays() {
    const doc = this.world.doc;
    for (const collection of [
      "rooms",
      "blocks",
      "cubes",
      "doors",
      "plates",
      "goals",
    ])
      for (const e of doc[collection]) {
        const size = collection === "cubes" ? [e.size, e.size, e.size] : e.size;
        const box = new THREE.Box3().setFromCenterAndSize(
          vec(e.center || e.position),
          vec(size),
        );
        const helper = new THREE.Box3Helper(
          box,
          collection === "goals"
            ? "#a8efbd"
            : collection === "rooms"
              ? "#536e63"
              : "#a6cbbc",
        );
        helper.userData.entityId = e.id;
        helper.userData.room = e.room || e.id;
        this.overlayGroup.add(helper);
      }
    for (const p of doc.portals) {
      const end = this.world.portals.get(p.linkedTo);
      const arrow = new THREE.ArrowHelper(
        Z.clone().applyQuaternion(quat(p.quaternion)),
        vec(p.position),
        1,
        p.color,
        0.25,
        0.12,
      );
      this.overlayGroup.add(arrow);
      if (p.id < end.id) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            vec(p.position),
            vec(end.position),
          ]),
          new THREE.LineDashedMaterial({
            color: p.color,
            dashSize: 0.4,
            gapSize: 0.2,
            transparent: true,
            opacity: 0.6,
            depthTest: false,
          }),
        );
        line.computeLineDistances();
        this.overlayGroup.add(line);
      }
    }
    for (const p of doc.plates)
      for (const id of p.doorIds) {
        const d = doc.doors.find((d) => d.id === id);
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            vec(p.position),
            vec(d.position),
          ]),
          new THREE.LineDashedMaterial({
            color: "#ffcf8c",
            dashSize: 0.25,
            gapSize: 0.16,
            depthTest: false,
          }),
        );
        line.computeLineDistances();
        this.overlayGroup.add(line);
      }
    const spawn = new THREE.ArrowHelper(
      new THREE.Vector3(-Math.sin(doc.spawn.yaw), 0, -Math.cos(doc.spawn.yaw)),
      vec(doc.spawn.position),
      1.3,
      "#e5f2db",
      0.3,
      0.2,
    );
    this.overlayGroup.add(spawn);
  }

  setEditor(enabled, metadata = {}) {
    this.editorMode = enabled;
    this.orbit.enabled = enabled;
    this.overlays = metadata.overlays ?? this.overlays;
    if (
      enabled &&
      metadata.selectedRoom &&
      metadata.selectedRoom !== this.focusedRoom
    )
      this.focusRoom(metadata.selectedRoom);
    if (metadata.selectedId) this.selectedId = metadata.selectedId;
  }

  focusRoom(id) {
    const room = this.world.rooms.get(id) || this.world.doc.rooms[0];
    this.focusedRoom = room.id;
    this.orbit.target.fromArray(room.center).add(new THREE.Vector3(0, -1, 0));
    this.orbitCamera.position
      .copy(this.orbit.target)
      .add(
        new THREE.Vector3(
          room.size[0] * 0.85,
          room.size[1] + 6,
          room.size[2] * 0.85,
        ),
      );
    this.orbit.update();
  }

  pickEditor(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        (-(clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.orbitCamera,
    );
    const hits = ray.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      let o = hit.object;
      while (o && !o.userData.entityId) o = o.parent;
      if (o && o.visible) return o.userData.entityId;
    }
    return null;
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth),
      h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.orbitCamera.aspect = w / h;
    this.orbitCamera.updateProjectionMatrix();
    this.releaseTargets();
  }

  releaseTargets() {
    for (const t of this.targets) t.dispose();
    this.targets = [];
  }

  _target(index, depth) {
    const ratio =
      Math.min(1, this.targetLimit / Math.max(this.width, this.height)) *
      Math.pow(0.82, depth - 1);
    const w = Math.max(64, Math.round(this.width * ratio)),
      h = Math.max(64, Math.round(this.height * ratio));
    let target = this.targets[index];
    if (!target) {
      target = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
      });
      target.texture.colorSpace = THREE.LinearSRGBColorSpace;
      target.texture.generateMipmaps = false;
      this.targets[index] = target;
    } else if (target.width !== w || target.height !== h) target.setSize(w, h);
    return target;
  }

  _bodyView(mesh, copy, body, room, depth) {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    if (body.id === "player") {
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
        body.quaternion,
      );
      mesh.quaternion.setFromAxisAngle(
        UP,
        Math.atan2(-direction.x, -direction.z),
      );
    }
    const straddle = this.world.getStraddle(body);
    const setClip = (object, plane) =>
      object.traverse((o) => {
        if (o.isMesh) o.material.clippingPlanes = plane ? [plane] : [];
      });
    setClip(mesh, straddle ? portalPlane(straddle.portal) : null);
    mesh.visible =
      body.room === room &&
      (body.id !== "player" || depth > 0 || this.editorMode);
    copy.visible = !!straddle && straddle.destination.room === room;
    if (copy.visible) {
      copy.position.copy(
        mapPoint(body.position, straddle.portal, straddle.destination),
      );
      copy.quaternion
        .copy(portalRotation(straddle.portal, straddle.destination))
        .multiply(mesh.quaternion);
      setClip(copy, portalPlane(straddle.destination));
    }
  }

  _prepare(room, depth) {
    for (const [id, group] of this.rooms) {
      group.visible = this.editorMode || id === room;
      group.traverse((o) => {
        if (o.userData.ceiling) o.visible = !this.editorMode;
      });
    }
    for (const { body, mesh, copy } of this.bodies.values())
      this._bodyView(
        mesh,
        copy,
        body,
        this.editorMode ? body.room : room,
        depth,
      );
    this._bodyView(
      this.avatar,
      this.avatarCopy,
      this.world.player,
      this.editorMode ? this.world.player.room : room,
      depth,
    );
    this.overlayGroup.visible = this.editorMode && this.overlays;
    for (const helper of this.overlayGroup.children)
      if (helper.isBox3Helper)
        helper.material.color.set(
          helper.userData.entityId === this.selectedId
            ? "#ffffff"
            : helper.userData.room === this.focusedRoom
              ? "#83cbb0"
              : "#536e63",
        );
  }

  _visible(p, camera, room) {
    if (
      p.room !== room ||
      !this.world._pair(p) ||
      portalLocal(camera.position, p).z <= 1e-7
    )
      return false;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    return frustum.intersectsSphere(
      new THREE.Sphere(vec(p.position), Math.hypot(p.width, p.height) * 0.5),
    );
  }

  _view(camera, room, depth, target, clip = null) {
    const views = [];
    camera.updateMatrixWorld(true);
    if (depth < this.recursion)
      for (const p of this.world.doc.portals) {
        if (
          !this._visible(p, camera, room) ||
          this.usedTargets >= this.maxViews
        )
          continue;
        const destination = this.world.portals.get(p.linkedTo),
          child = new THREE.PerspectiveCamera();
        child.near = this.camera.near;
        child.far = this.camera.far;
        child.aspect = this.camera.aspect;
        child.fov = this.camera.fov;
        child.position.copy(mapPoint(camera.position, p, destination));
        child.quaternion
          .copy(portalRotation(p, destination))
          .multiply(camera.quaternion);
        child.projectionMatrix.copy(
          this.editorMode
            ? this.orbitCamera.projectionMatrix
            : this.camera.projectionMatrix,
        );
        child.projectionMatrixInverse.copy(child.projectionMatrix).invert();
        const plane = portalPlane(destination, -0.001);
        clipProjection(child, plane);
        const childTarget = this._target(this.usedTargets++, depth + 1);
        this._view(child, destination.room, depth + 1, childTarget, plane);
        views.push({ id: p.id, target: childTarget });
      }
    this._prepare(room, depth);
    for (const { material } of this.portals.values()) {
      material.uniforms.ready.value = false;
      material.uniforms.image.value = null;
    }
    for (const v of views) {
      const m = this.portals.get(v.id).material;
      m.uniforms.ready.value = true;
      m.uniforms.image.value = v.target.texture;
    }
    this.renderer.clippingPlanes = clip ? [clip] : [];
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    this.stats.views++;
    this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);
  }

  render() {
    if (
      this.portalState !==
      this.world.doc.portals.map((p) => Number(p.enabled)).join("")
    )
      this.setWorld(this.world);
    const start = performance.now();
    this.renderer.info.reset();
    this.stats.views = 0;
    this.stats.maxDepth = 0;
    this.usedTargets = 0;
    for (const light of this.lights) light.shadow.needsUpdate = true;
    for (const { group, indicator, door } of this.doors.values()) {
      const state = this.world.doors.get(door.id);
      group.position.y = door.position[1] + state.open * (door.size[1] + 0.2);
      indicator.material.color.set(state.active ? "#a8f4c7" : "#ffbf78");
    }
    for (const [id, { ring }] of this.plates) {
      const active = this.world.plates.get(id).active;
      ring.material.emissiveIntensity = active ? 1.4 : 0.15;
      ring.material.color.set(active ? "#a1e2ab" : "#54725e");
    }
    if (this.editorMode) {
      this.orbit.update();
      this._view(this.orbitCamera, this.focusedRoom, 0, null);
    } else {
      const frame = this.world.cameraFrame();
      this.camera.position.copy(frame.position);
      this.camera.quaternion.copy(frame.quaternion);
      let near = 0.025;
      for (const p of this.world.doc.portals) {
        if (p.room !== frame.room || !this.world._pair(p)) continue;
        const local = portalLocal(frame.position, p);
        if (
          local.z > 0 &&
          Math.abs(local.x) < p.width / 2 + 0.1 &&
          Math.abs(local.y) < p.height / 2 + 0.1
        )
          near = Math.min(near, local.z * 0.2);
      }
      this.camera.near = Math.max(1e-6, near);
      this.camera.updateProjectionMatrix();
      this._view(this.camera, frame.room, 0, null);
    }
    this.renderer.clippingPlanes = [];
    this.renderer.setRenderTarget(null);
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.targetBytes = this.targets.reduce(
      (n, t) => n + t.width * t.height * 8,
      0,
    );
    this.stats.renderMs = performance.now() - start;
    return this.stats;
  }

  image() {
    this.render();
    const a = document.createElement("a");
    a.download = `parallax-${this.world.doc.id}.png`;
    a.href = this.renderer.domElement.toDataURL("image/png");
    a.click();
  }

  _disposeScene() {
    const geometries = new Set(),
      materials = new Set(),
      textures = new Set();
    this.scene.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m);
          for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
        }
      if (o.isLight && o.shadow?.map) o.shadow.map.dispose();
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    this.releaseTargets();
    this._disposeScene();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
