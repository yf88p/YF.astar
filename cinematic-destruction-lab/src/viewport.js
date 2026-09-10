import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { partitionObject } from './core/geometry.js';
import { LIMITS } from './core/model.js';
import { seededRandom } from './core/math.js';

const MINT = 0xb7d4bc;
const AMBER = 0xe8c67b;
const ORANGE = 0xe49359;
const TOOLS = ['select', 'translate', 'rotate', 'scale', 'aim'];
const CAMERA_MODES = ['orbit', 'tracking', 'path'];
const DEFAULT_CAMERAS = [
  { id: 'camera-wide', time: 0, position: [9, 5.2, 10], target: [0, 1.8, 0], fov: 36 },
  { id: 'camera-close', time: 4, position: [3.8, 3.1, 7], target: [0, 1.65, 0], fov: 39 },
];
const v3 = array => new THREE.Vector3().fromArray(array);
const objectQuaternion = object => new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation, 'XYZ'));

function disposeTree(root, materials = true) {
  const geometries = new Set(), ownedMaterials = new Set();
  root.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    if (materials && child.material) {
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) ownedMaterials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of ownedMaterials) material.dispose();
  root.clear();
}

// UVs are in the original object's space, not each shard's space: grain and
// aggregate remain continuous across intact partitions and travel with debris.
function fragmentGeometry(fragment, object) {
  const positions = [], uvs = [], exterior = [], interior = [];
  const grainAxis = object.size.indexOf(Math.max(...object.size));
  for (let triangle = 0; triangle < fragment.indices.length / 3; triangle++) {
    (fragment.exterior[triangle] ? exterior : interior).push(triangle);
  }
  for (const triangle of [...exterior, ...interior]) {
    const points = [0, 1, 2].map(i => v3(fragment.vertices.slice(fragment.indices[triangle * 3 + i] * 3, fragment.indices[triangle * 3 + i] * 3 + 3)));
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    const n = normal.toArray().map(Math.abs);
    const axis = n.indexOf(Math.max(...n));
    let uvAxes = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
    if (object.material === 'timber' && uvAxes.includes(grainAxis)) uvAxes = [grainAxis, uvAxes.find(a => a !== grainAxis)];
    for (const point of points) {
      positions.push(...point.toArray());
      const rest = point.add(v3(fragment.center)).toArray();
      uvs.push(rest[uvAxes[0]], rest[uvAxes[1]]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const fractureFaces = new Float32Array(positions.length / 3);
  fractureFaces.fill(1, exterior.length * 3);
  geometry.setAttribute('fractureFace', new THREE.BufferAttribute(fractureFaces, 1));
  geometry.addGroup(0, exterior.length * 3, 0);
  geometry.addGroup(exterior.length * 3, interior.length * 3, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function surfaceTexture(kind) {
  const size = 256, data = new Uint8Array(size * size * 4);
  const random = seededRandom(kind === 'timber' ? 891 : kind === 'steel' ? 218 : 4261);
  const rows = Array.from({ length: size }, () => random());
  const clouds = Array.from({ length: 64 }, () => random());
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = random();
    let value;
    if (kind === 'timber') {
      const grain = Math.sin(y * 0.49 + Math.sin(x / size * Math.PI * 2) * 1.6 + Math.sin(y * 0.097) * 2);
      value = 193 + grain * 24 + rows[y] * 14 + noise * 10;
    } else if (kind === 'steel') {
      value = 212 + rows[y] * 21 + noise * 9;
    } else {
      const gx = Math.floor(x / 32), gy = Math.floor(y / 32);
      const u = THREE.MathUtils.smoothstep(x % 32 / 32, 0, 1), v = THREE.MathUtils.smoothstep(y % 32 / 32, 0, 1);
      const top = THREE.MathUtils.lerp(clouds[gy * 8 + gx], clouds[gy * 8 + (gx + 1) % 8], u);
      const bottom = THREE.MathUtils.lerp(clouds[(gy + 1) % 8 * 8 + gx], clouds[(gy + 1) % 8 * 8 + (gx + 1) % 8], u);
      value = 208 + noise * 25 + (THREE.MathUtils.lerp(top, bottom, v) - 0.5) * 22 - (noise < 0.035 ? 38 : 0);
    }
    const index = (y * size + x) * 4;
    data[index] = data[index + 1] = data[index + 2] = Math.round(value);
    data[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Physics is owned by the caller. This class never steps or mutates a simulation.
 * Time is always physical seconds; render() does not advance it or own a RAF.
 * setState(null) restores authoring poses. setEnabled(false) locks authoring,
 * not OrbitControls. renderAt() is history-independent, including camera motion.
 */
export class Viewport {
  constructor(container, { onSelect = () => {}, onTransform = () => {}, onAim = () => {} } = {}) {
    if (!container?.appendChild) throw new Error('Viewport needs a mounted container element.');
    this.container = container;
    this.callbacks = { onSelect, onTransform, onAim };
    this.disposed = false;
    this.enabled = true;
    this.tool = 'select';
    this.cameraMode = 'orbit';
    this.trackingTarget = 'projectile';
    this.layers = { grid: true, bonds: false, wireframe: false, trajectory: true, dimensions: true, presentation: false };
    this.selection = new Set();
    this.fragmentId = null;
    this.snapshot = null;
    this.time = 0;
    this.project = null;
    this.meshes = new Map();
    this.objects = new Map();
    this.projectiles = new Map();
    this.previews = new Map();
    this.previewImpactId = null;
    this._resources = new Set();
    this._cameraDirty = false;
    this._trackingOffset = new THREE.Vector3(7, 4.2, 9);
    this._trackingFov = 36;
    this._metrics = { renderMs: 0, calls: 0, triangles: 0, fragments: 0 };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none;';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Interactive destruction scene. Drag to orbit, scroll to zoom, click geometry to select.');
    container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#171d1b');
    this.scene.fog = new THREE.FogExp2('#171d1b', 0.025);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 500);
    this.camera.position.set(9, 6, 11);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.8, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 180;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.015;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.75;
    this.controls.update();

    this.fragmentRoot = new THREE.Group();
    this.projectileRoot = new THREE.Group();
    this.shellRoot = new THREE.Group();
    this.helperRoot = new THREE.Group();
    this.selectionRoot = new THREE.Group();
    this.trajectoryRoot = new THREE.Group();
    this.helperRoot.add(this.selectionRoot, this.trajectoryRoot);
    this.scene.add(this.fragmentRoot, this.projectileRoot, this.shellRoot, this.helperRoot);
    this._makeStudio();
    this._makeMaterials();

    this.pivot = new THREE.Group();
    this.pivot.name = 'Authoring pivot (no render geometry)';
    this.scene.add(this.pivot);
    this.transformControls = new TransformControls(this.camera, canvas);
    this.transformControls.setSize(0.8);
    this.transformHelper = this.transformControls.getHelper();
    this.helperRoot.add(this.transformHelper);
    this._onDragStart = () => this._beginTransform();
    this._onDragChange = () => this._previewTransform();
    this._onDragEnd = () => this._finishTransform();
    this.transformControls.addEventListener('mouseDown', this._onDragStart);
    this.transformControls.addEventListener('objectChange', this._onDragChange);
    this.transformControls.addEventListener('mouseUp', this._onDragEnd);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._pointerIds = new Set();
    this._onPointerDown = event => {
      this._pointerIds.add(event.pointerId);
      if (this._pointerIds.size > 1) { if (this._click) this._click.moved = true; return; }
      if (event.button !== 0) return;
      this._click = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false, gizmo: false };
    };
    this._onPointerMove = event => {
      if (this._click && Math.hypot(event.clientX - this._click.x, event.clientY - this._click.y) > 5) this._click.moved = true;
    };
    this._onPointerUp = event => {
      this._pointerIds.delete(event.pointerId);
      const click = this._click;
      if (!click || click.id !== event.pointerId) return;
      this._click = null;
      if (click.moved || click.gizmo || event.button !== 0 || this.layers.presentation) return;
      const hit = this._pick(event);
      if (this.tool === 'aim') {
        if (this._authoring() && hit) this.callbacks.onAim(hit.point.toArray());
      } else {
        this.callbacks.onSelect(hit?.object.userData.objectId ?? null, event.shiftKey, hit?.object.userData.fragmentId ?? null);
      }
    };
    this._onPointerCancel = event => {
      this._pointerIds.delete(event.pointerId);
      this._click = null;
      this._cancelTransform();
    };
    this._onKeyDown = event => {
      if (event.key === 'Escape' && this._drag) { event.preventDefault(); this._cancelTransform(); }
    };
    canvas.addEventListener('pointerdown', this._onPointerDown, true);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointercancel', this._onPointerCancel);
    canvas.addEventListener('keydown', this._onKeyDown);
    this._onOrbitEnd = () => {
      if (this.cameraMode === 'tracking') this._trackingOffset.copy(this.camera.position).sub(this.controls.target);
    };
    this.controls.addEventListener('end', this._onOrbitEnd);
    this.setCameras(DEFAULT_CAMERAS);
    this.resize();
    this._resizeObserver = new ResizeObserver(() => { if (!this._outputSize) this.resize(); });
    this._resizeObserver.observe(container);
    this._syncHelpers();
  }

  _own(resource) { this._resources.add(resource); return resource; }

  _makeStudio() {
    const environment = new RoomEnvironment();
    const softbox = new THREE.Mesh(new THREE.PlaneGeometry(3, 7), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    softbox.material.color.multiplyScalar(3);
    softbox.position.set(-6, 5, 8);
    softbox.lookAt(0, 2, 0);
    environment.add(softbox);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this._environment = pmrem.fromScene(environment, 0.055);
    this.scene.environment = this._environment.texture;
    this.scene.environmentIntensity = 0.55;
    environment.dispose();
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xcbd7e2, 0x31352b, 1.25));
    this.keyLight = new THREE.DirectionalLight(0xffe5c5, 3.7);
    this.keyLight.position.set(-3.5, 10, 7);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.keyLight.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 55 });
    this.keyLight.shadow.normalBias = 0.016;
    this.keyLight.shadow.bias = -0.00012;
    this.keyLight.shadow.radius = 3;
    this.keyLight.target.position.set(0, 1, 0);
    const fill = new THREE.DirectionalLight(0xc7deea, 1.6);
    fill.position.set(7, 5, -5);
    this.scene.add(this.keyLight, this.keyLight.target, fill);

    const aggregate = this._own(surfaceTexture('concrete'));
    aggregate.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    // The large matte ground needs diffuse illumination and contact shadows,
    // not per-pixel microfacet/environment/bump evaluation across the whole view.
    const floorMaterial = this._own(new THREE.MeshLambertMaterial({ color: 0x343c38, map: aggregate }));
    const floorGeometry = new THREE.PlaneGeometry(400, 400);
    const floorUV = floorGeometry.getAttribute('uv');
    for (let i = 0; i < floorUV.count; i++) floorUV.setXY(i, floorUV.getX(i) * 160, floorUV.getY(i) * 160);
    this.floor = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;

    // _fitStage cuts a matching hole out of the surrounding floor. Both surfaces
    // stay at the real y=0 contact plane, with no coplanar overdraw or depth bias.
    const stageMaterial = this._own(new THREE.MeshLambertMaterial({ color: 0x48524b, map: aggregate }));
    this.stage = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), stageMaterial);
    this.stage.rotation.x = -Math.PI / 2;
    this.stage.receiveShadow = true;
    this.scene.add(this.floor, this.stage);
    this.grid = new THREE.LineSegments(new THREE.BufferGeometry(), this._own(new THREE.LineBasicMaterial({ color: 0xd1d6c9, transparent: true, opacity: 0.13, depthWrite: false })));
    this.helperRoot.add(this.grid);
  }

  _makeMaterials() {
    this.hiddenMaterial = this._own(new THREE.MeshBasicMaterial({ visible: false }));
    this.materials = new Map();
    this.edgeMaterial = this._own(new THREE.LineBasicMaterial({ color: 0xb5d5d0, transparent: true, opacity: 0.24, depthWrite: false }));
    this.shellMaterial = this._own(new THREE.LineBasicMaterial({ color: 0xc6d8cf, transparent: true, opacity: 0.26, depthWrite: false }));
    this.wireMaterial = this._own(new THREE.LineBasicMaterial({ color: 0x9cb8ab, transparent: true, opacity: 0.19, depthWrite: false }));
    this.fragmentSelectionMaterial = this._own(new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
    this.projectileGeometry = this._own(new THREE.SphereGeometry(1, 20, 14));
    this.projectileMaterial = this._own(new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.28, metalness: 0.55, emissive: 0x4c1c08, emissiveIntensity: 0.22 }));
    this.previewMaterial = this._own(new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.34, metalness: 0.35 }));
    this.bondLines = new THREE.LineSegments(new THREE.BufferGeometry(), this._own(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false })));
    this.helperRoot.add(this.bondLines);
    this.dimensionRoot = new THREE.Group();
    this.helperRoot.add(this.dimensionRoot);
  }

  _objectMaterials(object) {
    const color = this.project.materials?.[object.material]?.color;
    const key = `${object.material}:${color}:${object.material === 'glass' ? Math.min(...object.size) : ''}`;
    if (this.materials.has(key)) return this.materials.get(key);
    let outer, inner;
    if (object.material === 'glass') {
      const tint = new THREE.Color(color || '#a5c4c9').lerp(new THREE.Color('#b8c8d5'), 0.72);
      // Reflective alpha glass avoids Three's full-scene transmission render,
      // mip/refraction sampling, and multisampled framebuffer artifacts. The
      // original shard surfaces still render and remain directly raycastable.
      outer = new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.12, transmission: 0, ior: 1.48, clearcoat: 0, envMapIntensity: 1.6, transparent: true, opacity: 0.3, depthWrite: false });
      outer.forceSinglePass = true;
      inner = new THREE.MeshStandardMaterial({ color: 0x79a7ad, roughness: 0.48, metalness: 0, envMapIntensity: 0.65, transparent: true, opacity: 0.4, depthWrite: false });
      inner.forceSinglePass = true;
    } else {
      const texture = this._own(surfaceTexture(object.material));
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const options = {
        concrete: { color: color || '#b8b3a9', roughness: 0.92, metalness: 0, bumpScale: 0.028 },
        timber: { color: color || '#bd8855', roughness: 0.66, metalness: 0, bumpScale: 0.018 },
        steel: { color: new THREE.Color(color || '#708796').multiplyScalar(0.67), roughness: 0.34, metalness: 0.82, bumpScale: 0.003 },
      }[object.material];
      outer = new THREE.MeshStandardMaterial({ ...options, map: texture, bumpMap: texture });
      inner = outer.clone();
      inner.color.lerp(new THREE.Color(object.material === 'timber' ? 0xe0b785 : 0x708c82), object.material === 'steel' ? 0.13 : 0.22);
      inner.roughness = object.material === 'steel' ? 0.55 : 0.98;
    }
    // One draw per fractured shard, not separate exterior/interior draws. A
    // per-triangle attribute retains the real fracture-face tint and roughness.
    // Mesh identity, geometry, visibility, and recorded transforms are unchanged.
    const surface = outer.clone();
    surface.onBeforeCompile = shader => {
      shader.uniforms.fractureTint = { value: new THREE.Vector3(inner.color.r / Math.max(1e-6, outer.color.r), inner.color.g / Math.max(1e-6, outer.color.g), inner.color.b / Math.max(1e-6, outer.color.b)) };
      shader.uniforms.fractureRoughness = { value: inner.roughness };
      shader.uniforms.fractureOpacity = { value: inner.opacity / outer.opacity };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float fractureFace;\nvarying float vFractureFace;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFractureFace = fractureFace;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFractureFace;\nuniform vec3 fractureTint;\nuniform float fractureRoughness;\nuniform float fractureOpacity;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), fractureTint, vFractureFace);\ndiffuseColor.a *= mix(1.0, fractureOpacity, vFractureFace);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, fractureRoughness, vFractureFace);');
    };
    surface.customProgramCacheKey = () => 'fracture-face-surface-v1';
    this._own(outer); this._own(inner); this._own(surface);
    const materials = { outer, inner, surface, intact: [outer, this.hiddenMaterial], fractured: surface };
    this.materials.set(key, materials);
    return materials;
  }

  /** fragments defaults to deterministic core geometry if no Simulation exists yet. */
  setProject(project, fragments) {
    if (this.disposed) return;
    this._cancelTransform();
    const firstProject = !this.project;
    this.project = project;
    if (!project.impacts.some(impact => impact.id === this.previewImpactId)) this.previewImpactId = null;
    this.snapshot = null;
    this.time = 0;
    this._cameraDirty = true;
    disposeTree(this.fragmentRoot, false);
    disposeTree(this.shellRoot, false);
    this.projectileRoot.clear();
    this.meshes.clear(); this.objects.clear(); this.projectiles.clear();
    // These resources depend on the authored material palette and dimensions.
    for (const materials of this.materials.values()) {
      for (const material of [materials.outer, materials.inner, materials.surface]) {
        if (material.map && this._resources.has(material.map)) { material.map.dispose(); this._resources.delete(material.map); }
        material.dispose(); this._resources.delete(material);
      }
    }
    this.materials.clear();
    const generated = [], bonds = [];
    for (const object of project.objects) {
      const partition = partitionObject(object, project.materials);
      const quaternion = objectQuaternion(object);
      bonds.push(...partition.bonds);
      if (!fragments) for (const fragment of partition.fragments) generated.push({ ...fragment, initialPosition: v3(fragment.center).applyQuaternion(quaternion).add(v3(object.position)).toArray(), initialRotation: quaternion.toArray() });
      const box = new THREE.BoxGeometry(...object.size);
      const shell = new THREE.LineSegments(new THREE.EdgesGeometry(box), this.shellMaterial);
      box.dispose();
      shell.position.fromArray(object.position);
      shell.quaternion.copy(quaternion);
      shell.visible = object.material === 'glass';
      this.shellRoot.add(shell);
      this.objects.set(object.id, { object, meshes: [], shell, fractured: false });
    }
    this.fragments = fragments ?? generated;
    for (const fragment of this.fragments) {
      const entry = this.objects.get(fragment.objectId);
      if (!entry) throw new Error(`Fragment ${fragment.id} references an unknown object.`);
      const materials = this._objectMaterials(entry.object);
      const geometry = fragmentGeometry(fragment, entry.object);
      const mesh = new THREE.Mesh(geometry, materials.intact);
      mesh.position.fromArray(fragment.initialPosition);
      mesh.quaternion.fromArray(fragment.initialRotation);
      mesh.castShadow = fragment.material !== 'glass';
      mesh.receiveShadow = fragment.material !== 'glass';
      mesh.userData = { objectId: fragment.objectId, fragmentId: fragment.id, fragment, materials };
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 22), this.edgeMaterial);
      edge.visible = false;
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), this.wireMaterial);
      wire.visible = false;
      mesh.add(edge, wire);
      mesh.userData.edge = edge; mesh.userData.wire = wire;
      this.meshes.set(fragment.id, mesh);
      entry.meshes.push(mesh);
      this.fragmentRoot.add(mesh);
    }
    for (const connection of project.connections ?? []) {
      const aa = this.objects.get(connection.a)?.meshes ?? [], bb = this.objects.get(connection.b)?.meshes ?? [];
      let pair, nearest = Infinity;
      for (const a of aa) for (const b of bb) {
        const distance = a.position.distanceToSquared(b.position);
        if (distance < nearest) { nearest = distance; pair = [a.userData.fragmentId, b.userData.fragmentId]; }
      }
      if (pair) bonds.push({ id: `connection:${connection.id}`, a: pair[0], b: pair[1] });
    }
    this.bonds = bonds;
    this.bondLines.geometry.dispose();
    this.bondLines.geometry = new THREE.BufferGeometry();
    this.bondLines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bonds.length * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.bondLines.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bonds.length * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.bondLines.frustumCulled = false;
    this._fitStage();
    this.scene.updateMatrixWorld(true);
    this._buildTrajectory();
    this.setSelection([...this.selection].filter(id => this.objects.has(id)), this.meshes.has(this.fragmentId) ? this.fragmentId : null);
    this.setState(null);
    if (firstProject) this.resetCamera();
    this.renderer.shadowMap.needsUpdate = true;
  }

  _fitStage() {
    const box = this._bounds();
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const width = Math.max(16, Math.ceil(size.x + 8)), depth = Math.max(12, Math.ceil(size.z + 8));
    const surround = new THREE.Shape();
    surround.moveTo(-200, -200); surround.lineTo(200, -200); surround.lineTo(200, 200); surround.lineTo(-200, 200); surround.closePath();
    const hole = new THREE.Path(), left = center.x - width / 2, right = center.x + width / 2;
    const bottom = -center.z - depth / 2, top = -center.z + depth / 2;
    hole.moveTo(left, bottom); hole.lineTo(left, top); hole.lineTo(right, top); hole.lineTo(right, bottom); hole.closePath();
    surround.holes.push(hole);
    this.floor.geometry.dispose();
    this.floor.geometry = new THREE.ShapeGeometry(surround);
    const floorUV = this.floor.geometry.getAttribute('uv'), floorPosition = this.floor.geometry.getAttribute('position');
    for (let i = 0; i < floorUV.count; i++) floorUV.setXY(i, floorPosition.getX(i) * 0.4, floorPosition.getY(i) * 0.4);
    this.stage.geometry.dispose();
    this.stage.geometry = new THREE.PlaneGeometry(width, depth);
    const uv = this.stage.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width / 2, uv.getY(i) * depth / 2);
    this.stage.position.set(center.x, 0, center.z);
    const points = [];
    for (let x = Math.ceil(center.x - width / 2); x <= center.x + width / 2; x++) points.push(x, 0.004, center.z - depth / 2, x, 0.004, center.z + depth / 2);
    for (let z = Math.ceil(center.z - depth / 2); z <= center.z + depth / 2; z++) points.push(center.x - width / 2, 0.004, z, center.x + width / 2, 0.004, z);
    this.grid.geometry.dispose();
    this.grid.geometry = new THREE.BufferGeometry();
    this.grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const extent = Math.max(width, depth, size.y * 2) * 0.7;
    this.keyLight.position.copy(center).add(new THREE.Vector3(-extent * 0.4, extent, extent * 0.7));
    this.keyLight.target.position.copy(center);
    Object.assign(this.keyLight.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: extent * 5 });
    this.keyLight.shadow.camera.updateProjectionMatrix();
  }

  setState(snapshot) {
    if (this.disposed || !this.project) return;
    if (this._drag) {
      if ((snapshot?.time ?? 0) === 0 && this._authoring()) return;
      this._cancelTransform();
    }
    const nextTime = snapshot?.time ?? 0;
    if (this.time !== nextTime) this._cameraDirty = true;
    this.snapshot = snapshot ?? null;
    this.time = nextTime;
    const states = snapshot ? new Map(snapshot.fragments.map(fragment => [fragment.id, fragment])) : null;
    const bondStates = new Map((snapshot?.bonds ?? []).map(bond => [bond.id, bond]));
    const fractured = new Set();
    for (const bond of this.bonds) if (bondStates.get(bond.id)?.broken && !bond.id.startsWith('connection:')) { fractured.add(bond.a); fractured.add(bond.b); }
    for (const [id, mesh] of this.meshes) {
      const state = states?.get(id), { fragment, materials } = mesh.userData;
      mesh.visible = !states || !!state;
      mesh.position.fromArray(state?.position ?? fragment.initialPosition);
      mesh.quaternion.fromArray(state?.rotation ?? fragment.initialRotation);
      mesh.scale.set(1, 1, 1);
      mesh.material = fractured.has(id) ? materials.fractured : materials.intact;
    }
    for (const entry of this.objects.values()) {
      const first = entry.meshes.find(mesh => mesh.visible);
      if (!first) { entry.shell.visible = false; continue; }
      const f = first.userData.fragment;
      const delta = first.quaternion.clone().multiply(new THREE.Quaternion().fromArray(f.initialRotation).invert());
      const origin = v3(entry.object.position).sub(v3(f.initialPosition)).applyQuaternion(delta).add(first.position);
      entry.fractured = entry.meshes.some(mesh => {
        const initial = mesh.userData.fragment;
        const expected = v3(initial.initialPosition).sub(v3(entry.object.position)).applyQuaternion(delta).add(origin);
        const rotation = delta.clone().multiply(new THREE.Quaternion().fromArray(initial.initialRotation));
        return !mesh.visible || mesh.position.distanceToSquared(expected) > 0.000004 || Math.abs(mesh.quaternion.dot(rotation)) < 0.99999;
      });
      entry.shell.position.copy(origin);
      entry.shell.quaternion.copy(delta).multiply(objectQuaternion(entry.object));
      entry.shell.scale.set(1, 1, 1);
      entry.shell.visible = entry.object.material === 'glass' && !entry.fractured;
      for (const mesh of entry.meshes) {
        mesh.userData.edge.visible = entry.object.material === 'glass' && entry.fractured;
        if (entry.fractured) mesh.material = mesh.userData.materials.fractured;
      }
    }
    for (const mesh of this.projectiles.values()) mesh.visible = false;
    for (const projectile of snapshot?.projectiles ?? []) {
      let mesh = this.projectiles.get(projectile.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.projectileGeometry, this.projectileMaterial);
        mesh.castShadow = mesh.receiveShadow = true;
        this.projectiles.set(projectile.id, mesh);
        this.projectileRoot.add(mesh);
      }
      mesh.visible = true;
      mesh.position.fromArray(projectile.position);
      mesh.quaternion.fromArray(projectile.rotation ?? [0, 0, 0, 1]);
      mesh.scale.setScalar(projectile.radius ?? this.project.impacts.find(impact => impact.id === projectile.id)?.radius ?? 0.16);
    }
    if (this.layers.bonds) this._updateBonds(bondStates);
    this._updateSelection();
    this._syncGizmo();
    this._syncHelpers();
    this.renderer.shadowMap.needsUpdate = true;
  }

  _updateBonds(states = new Map((this.snapshot?.bonds ?? []).map(bond => [bond.id, bond]))) {
    if (!this.bonds) return;
    const position = this.bondLines.geometry.getAttribute('position'), colors = this.bondLines.geometry.getAttribute('color');
    let index = 0;
    const color = new THREE.Color();
    for (const bond of this.bonds) {
      const state = states.get(bond.id), a = this.meshes.get(bond.a), b = this.meshes.get(bond.b);
      if (state?.broken || !a?.visible || !b?.visible) continue;
      color.set(state?.yielded ? AMBER : MINT).lerp(new THREE.Color(0xc17c50), state?.damage ?? 0);
      for (const mesh of [a, b]) {
        position.setXYZ(index, ...mesh.position.toArray());
        colors.setXYZ(index, color.r, color.g, color.b);
        index++;
      }
    }
    position.needsUpdate = colors.needsUpdate = true;
    this.bondLines.geometry.setDrawRange(0, index);
  }

  _buildTrajectory() {
    // Launch markers share the real projectile's owned geometry/materials.
    for (const preview of this.previews.values()) preview.launch?.removeFromParent();
    disposeTree(this.trajectoryRoot);
    this.previews.clear();
    const meshes = [...this.meshes.values()];
    for (const impact of this.project.impacts) {
      const group = new THREE.Group(), start = v3(impact.position), direction = v3(impact.direction).normalize();
      group.userData = { impactId: impact.id, type: impact.type, time: impact.time };
      const preview = { group, impact, launch: null };
      this.previews.set(impact.id, preview);
      this.trajectoryRoot.add(group);
      let contact = null;
      if (impact.type === 'projectile') {
        const velocity = direction.clone().multiplyScalar(impact.speed), gravity = this.project.settings.gravity;
        const step = Math.min(1 / 30, 0.16 / Math.max(1, impact.speed));
        const horizon = Math.min(3, 16 / Math.max(1, impact.speed));
        const points = [start.clone()], ray = new THREE.Raycaster();
        for (let t = step; t <= horizon + step / 2; t += step) {
          const next = start.clone().addScaledVector(velocity, t);
          next.y -= 0.5 * gravity * t * t;
          const previous = points.at(-1), segment = next.clone().sub(previous), distance = segment.length();
          if (distance > 1e-8) {
            ray.set(previous, segment.normalize());
            ray.far = distance + impact.radius;
            const hit = ray.intersectObjects(meshes, false)[0];
            if (hit) {
              const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
              if (normal.dot(segment) > 0) normal.negate();
              contact = { point: hit.point, normal };
              points.push(hit.point.clone().addScaledVector(normal, impact.radius));
              break;
            }
          }
          if (next.y <= impact.radius) {
            const alpha = THREE.MathUtils.clamp((previous.y - impact.radius) / (previous.y - next.y || 1), 0, 1);
            const point = previous.clone().lerp(next, alpha); point.y = impact.radius;
            points.push(point);
            contact = { point: new THREE.Vector3(point.x, 0.007, point.z), normal: new THREE.Vector3(0, 1, 0) };
            break;
          }
          points.push(next);
        }
        const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: ORANGE, dashSize: 0.13, gapSize: 0.1, transparent: true, opacity: 0.58, depthWrite: false }));
        path.computeLineDistances();
        preview.launch = new THREE.Mesh(this.projectileGeometry, this.previewMaterial);
        preview.launch.position.copy(start);
        preview.launch.scale.setScalar(impact.radius);
        group.add(path, preview.launch);
      } else {
        // A short force-direction arrow anchored at the scheduled application
        // point, not a ballistic path or an implied distant collision.
        contact = { point: start, normal: direction };
      }
      if (contact) {
        const impulse = impact.type === 'impulse';
        const vertices = [], radius = impulse ? 0.12 : Math.max(0.13, impact.radius * 1.25);
        for (let i = 0; i < 48; i++) {
          const a = i / 48 * Math.PI * 2, b = (i + 1) / 48 * Math.PI * 2;
          vertices.push(Math.cos(a) * radius, Math.sin(a) * radius, 0, Math.cos(b) * radius, Math.sin(b) * radius, 0);
        }
        for (let i = 0; i < 4; i++) {
          const angle = i * Math.PI / 2;
          vertices.push(Math.cos(angle) * radius * 1.35, Math.sin(angle) * radius * 1.35, 0, Math.cos(angle) * radius * 1.8, Math.sin(angle) * radius * 1.8, 0);
          if (impulse) vertices.push(0, 0, 0.8, Math.cos(angle) * 0.1, Math.sin(angle) * 0.1, 0.62);
        }
        if (impulse) vertices.push(0, 0, 0, 0, 0, 0.8);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        const reticle = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: impulse ? AMBER : ORANGE, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }));
        reticle.position.copy(contact.point).addScaledVector(contact.normal, impulse ? 0 : 0.008);
        reticle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), contact.normal);
        group.add(reticle);
      }
    }
  }

  /** null shows every scheduled impact; an id optionally isolates one preview. */
  setPreviewImpact(id = null) {
    if (id !== null && !this.previews.has(id)) throw new Error(`Unknown impact preview: ${id}`);
    this.previewImpactId = id;
    this._syncHelpers();
  }

  setSelection(ids, fragmentId = null) {
    if (this._drag) this._cancelTransform();
    this.selection = new Set([...(ids ?? [])].filter(id => this.objects.has(id)));
    this.fragmentId = this.meshes.has(fragmentId) && this.selection.has(this.meshes.get(fragmentId).userData.objectId) ? fragmentId : null;
    // Fragment outlines reuse shard geometry and the viewport's shared material.
    if (this.fragmentOutline) { this.fragmentOutline.removeFromParent(); this.fragmentOutline = null; }
    disposeTree(this.selectionRoot);
    this.selectionBoxes = new Map();
    for (const id of this.selection) {
      const helper = new THREE.Box3Helper(new THREE.Box3(), MINT);
      helper.material.transparent = true;
      helper.material.opacity = 0.57;
      helper.material.depthWrite = false;
      this.selectionRoot.add(helper);
      this.selectionBoxes.set(id, helper);
    }
    if (this.fragmentId) {
      const mesh = this.meshes.get(this.fragmentId);
      this.fragmentOutline = new THREE.LineSegments(mesh.userData.edge.geometry, this.fragmentSelectionMaterial);
      this.fragmentOutline.renderOrder = 10;
      this.selectionRoot.add(this.fragmentOutline);
    }
    this._buildDimension();
    this._updateSelection();
    this._syncGizmo();
  }

  _bounds(ids = null) {
    const box = new THREE.Box3();
    for (const mesh of this.meshes.values()) {
      if (!mesh.visible || (ids && !ids.has(mesh.userData.objectId))) continue;
      mesh.updateWorldMatrix(true, false);
      box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
    if (box.isEmpty() && !ids) box.set(new THREE.Vector3(-3.5, 0, -0.1), new THREE.Vector3(3.5, 4.2, 0.1));
    return box;
  }

  _updateSelection() {
    for (const [id, helper] of this.selectionBoxes ?? []) {
      helper.box.copy(this._bounds(new Set([id])));
      helper.visible = !helper.box.isEmpty() && (this._authoring() || !this.fragmentId);
      if (helper.visible) helper.box.expandByScalar(0.035);
    }
    if (this.fragmentOutline) {
      const mesh = this.meshes.get(this.fragmentId);
      this.fragmentOutline.visible = !this._authoring() && !!mesh?.visible;
      if (mesh) {
        this.fragmentOutline.position.copy(mesh.position);
        this.fragmentOutline.quaternion.copy(mesh.quaternion);
        this.fragmentOutline.scale.copy(mesh.scale);
      }
    }
    this.dimensionRoot.visible = this.layers.dimensions && this._authoring() && !this._drag;
  }

  _buildDimension() {
    for (const child of this.dimensionRoot.children) child.material?.map?.dispose();
    disposeTree(this.dimensionRoot);
    if (this.selection.size !== 1) return;
    const box = this._bounds(this.selection);
    if (box.isEmpty()) return;
    const y = Math.max(0.025, box.min.y), z = box.max.z + 0.32;
    const points = [box.min.x, y, z, box.max.x, y, z];
    for (const x of [box.min.x, box.max.x]) points.push(x, y, z - 0.075, x, y, z + 0.075);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.dimensionRoot.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: MINT, transparent: true, opacity: 0.5, depthWrite: false })));
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(23,29,27,0.9)'; ctx.fillRect(0, 0, 256, 64);
    ctx.font = '26px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c9d6c6'; ctx.fillText(`${(box.max.x - box.min.x).toFixed(2)} m`, 128, 33);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    label.scale.set(0.78, 0.195, 1);
    label.position.set((box.min.x + box.max.x) / 2, y + 0.04, z + 0.2);
    this.dimensionRoot.add(label);
  }

  _authoring() { return this.enabled && this.time === 0; }

  setTool(tool) {
    if (!TOOLS.includes(tool)) throw new Error(`Unknown viewport tool: ${tool}`);
    this._cancelTransform();
    this.tool = tool;
    this.renderer.domElement.style.cursor = tool === 'aim' ? 'crosshair' : 'grab';
    this._syncGizmo();
  }

  setSnap(enabled) {
    this.snap = !!enabled;
    this.transformControls.setTranslationSnap(enabled ? 0.1 : null);
    this.transformControls.setRotationSnap(enabled ? Math.PI / 12 : null);
    this.transformControls.setScaleSnap(enabled ? 0.1 : null);
  }

  setEnabled(enabled) {
    this._cancelTransform();
    this.enabled = !!enabled;
    this._syncGizmo();
    this._updateSelection();
  }

  setLayers(layers) {
    for (const key of Object.keys(this.layers)) if (key in layers) this.layers[key] = !!layers[key];
    if (this.layers.presentation) this._cancelTransform();
    this._syncHelpers();
    if (this.layers.bonds) this._updateBonds();
    this._syncGizmo();
    this._updateSelection();
  }

  _syncHelpers() {
    this.helperRoot.visible = !this.layers.presentation;
    this.grid.visible = this.layers.grid;
    this.bondLines.visible = this.layers.bonds;
    const states = new Map((this.snapshot?.impacts ?? []).map(impact => [impact.id, impact]));
    const spawned = new Set((this.snapshot?.projectiles ?? []).map(projectile => projectile.id));
    this.trajectoryRoot.visible = this.layers.trajectory;
    for (const [id, { group, impact }] of this.previews) {
      const fired = states.get(id)?.fired ?? (this.snapshot?.tick ?? 0) > Math.ceil(impact.time / LIMITS.dt - 1e-9);
      group.visible = !fired && !spawned.has(id) && (this.previewImpactId === null || this.previewImpactId === id);
    }
    for (const mesh of this.meshes.values()) mesh.userData.wire.visible = this.layers.wireframe && !this.layers.presentation;
  }

  _syncGizmo() {
    if (this._drag) return;
    const canTransform = this._authoring() && !this.layers.presentation && this.selection.size && ['translate', 'rotate', 'scale'].includes(this.tool);
    this.transformControls.enabled = !!canTransform;
    if (!canTransform) { this.transformControls.detach(); return; }
    this.pivot.position.set(0, 0, 0);
    for (const id of this.selection) this.pivot.position.add(v3(this.objects.get(id).object.position));
    this.pivot.position.divideScalar(this.selection.size);
    this.pivot.quaternion.identity();
    if (this.tool === 'scale' && this.selection.size === 1) this.pivot.quaternion.copy(objectQuaternion(this.objects.get([...this.selection][0]).object));
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    this.transformControls.setMode(this.tool);
    this.transformControls.setSpace(this.tool === 'scale' ? 'local' : 'world');
    this.transformControls.attach(this.pivot);
  }

  _beginTransform() {
    if (!this._authoring()) return;
    if (this._click) this._click.gizmo = true;
    this._drag = {
      position: this.pivot.position.clone(), quaternion: this.pivot.quaternion.clone(),
      objects: [...this.selection].map(id => {
        const object = this.objects.get(id).object;
        return { id, position: v3(object.position), quaternion: objectQuaternion(object), size: v3(object.size) };
      }),
    };
    this.controls.enabled = false;
  }

  _transformChanges() {
    if (!this._drag) return [];
    const { position: pivot, quaternion: orientation, objects } = this._drag;
    const inverse = orientation.clone().invert();
    const rotation = this.pivot.quaternion.clone().multiply(inverse);
    const scale = this.pivot.scale.clone().max(new THREE.Vector3(0.001, 0.001, 0.001));
    return objects.map(object => {
      const position = object.position.clone().sub(pivot).applyQuaternion(inverse).multiply(scale).applyQuaternion(orientation).applyQuaternion(rotation).add(this.pivot.position);
      const quaternion = rotation.clone().multiply(object.quaternion);
      // Local dimension scaling plus shared-pivot spacing is representable by
      // the core's position/rotation/size model; world-space shear is not.
      const size = object.size.clone().multiply(scale).clamp(new THREE.Vector3(0.005, 0.005, 0.005), new THREE.Vector3(30, 30, 30));
      const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
      return { id: object.id, position: position.toArray().map(value => THREE.MathUtils.clamp(value, -100, 100)), rotation: [euler.x, euler.y, euler.z], size: size.toArray() };
    });
  }

  _previewTransform() {
    if (!this._drag) return;
    for (const change of this._transformChanges()) {
      const entry = this.objects.get(change.id), quaternion = objectQuaternion(change);
      const scale = v3(change.size).divide(v3(entry.object.size));
      const originalInverse = objectQuaternion(entry.object).invert();
      for (const mesh of entry.meshes) {
        const fragment = mesh.userData.fragment;
        mesh.position.copy(v3(fragment.initialPosition).sub(v3(entry.object.position)).applyQuaternion(originalInverse).multiply(scale).applyQuaternion(quaternion).add(v3(change.position)));
        mesh.quaternion.copy(quaternion).multiply(originalInverse).multiply(new THREE.Quaternion().fromArray(fragment.initialRotation));
        mesh.scale.copy(scale);
      }
      entry.shell.position.fromArray(change.position);
      entry.shell.quaternion.copy(quaternion);
      entry.shell.scale.copy(scale);
    }
    this._updateSelection();
    if (this.layers.bonds) this._updateBonds();
    this.trajectoryRoot.visible = false;
    this.renderer.shadowMap.needsUpdate = true;
  }

  _finishTransform() {
    if (!this._drag) return;
    const changes = this._transformChanges();
    const moved = changes.some(change => {
      const original = this.objects.get(change.id).object;
      return ['position', 'rotation', 'size'].some(key => change[key].some((value, i) => Math.abs(value - original[key][i]) > 1e-7));
    });
    this._drag = null;
    this.controls.enabled = true;
    // Roll back the preview before notifying React. Only accepted authoring
    // changes fed back through setProject become the new source of truth.
    this.setState(this.snapshot);
    if (moved && this._authoring()) this.callbacks.onTransform(changes.map(change => change.id), changes);
  }

  _cancelTransform() {
    if (!this._drag) return;
    this._drag = null;
    this.transformControls.dragging = false;
    this.transformControls.axis = null;
    this.controls.enabled = true;
    this.setState(this.snapshot);
  }

  _pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.camera.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects([...this.meshes.values()].filter(mesh => mesh.visible), false)[0] ?? null;
  }

  setCameraMode(mode) {
    if (!CAMERA_MODES.includes(mode)) throw new Error(`Unknown camera mode: ${mode}`);
    if (mode === 'tracking' && this.cameraMode !== mode) {
      this._trackingOffset.copy(this.camera.position).sub(this.controls.target);
      this._trackingFov = this.camera.fov;
    }
    this._clearDamping();
    this.cameraMode = mode;
    this._cameraDirty = true;
  }

  captureCamera(time = this.time) {
    if (!Number.isFinite(time)) throw new Error('Camera time must be finite physical seconds.');
    return { id: THREE.MathUtils.generateUUID(), time: THREE.MathUtils.clamp(time, 0, 12), position: this.camera.position.toArray(), target: this.controls.target.toArray(), fov: this.camera.fov };
  }

  setCameras(cameras) {
    if (!Array.isArray(cameras) || cameras.length > 64) throw new Error('Use an array of at most 64 camera keyframes.');
    const byTime = new Map();
    // With no authored keys, the built-in establishing shot remains deterministic.
    for (const [index, camera] of (cameras.length ? cameras : DEFAULT_CAMERAS).entries()) {
      if (!Number.isFinite(camera.time) || camera.time < 0 || camera.time > 12 || ![camera.position, camera.target].every(vector => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite)) || (camera.fov !== undefined && (!Number.isFinite(camera.fov) || camera.fov < 1 || camera.fov >= 179))) throw new Error('Camera keyframes need finite position/target triples, a time in [0, 12], and a valid fov.');
      byTime.set(camera.time, { id: camera.id ?? `camera-${index}`, time: camera.time, position: [...camera.position], target: [...camera.target], fov: camera.fov ?? 36 });
    }
    this.cameras = [...byTime.values()].sort((a, b) => a.time - b.time);
    this._cameraCurve = this.cameras.length > 1 ? new THREE.CatmullRomCurve3(this.cameras.map(camera => v3(camera.position)), false, 'centripetal') : null;
    this._cameraDirty = true;
  }

  setTrackingTarget(target) { this.trackingTarget = target; this._cameraDirty = true; }

  _trackingCenter() {
    if (this.trackingTarget === 'projectile') {
      const projectile = this.snapshot?.projectiles[0];
      const launch = this.project?.impacts.find(impact => impact.type === 'projectile');
      if (projectile || launch) return v3((projectile ?? launch).position);
    }
    const fragment = this.meshes.get(this.trackingTarget);
    if (fragment?.visible) return fragment.position.clone();
    const object = this.objects.get(this.trackingTarget);
    if (object) {
      const center = new THREE.Vector3(); let mass = 0;
      for (const mesh of object.meshes) if (mesh.visible) { const weight = mesh.userData.fragment.mass; center.addScaledVector(mesh.position, weight); mass += weight; }
      if (mass) return center.divideScalar(mass);
    }
    return this._bounds().getCenter(new THREE.Vector3());
  }

  _applyCamera(time, mode) {
    if (mode === 'orbit') return;
    if (mode === 'tracking') {
      this.controls.target.copy(this._trackingCenter());
      this.camera.position.copy(this.controls.target).add(this._trackingOffset);
      this.camera.position.y = Math.max(0.12, this.camera.position.y);
      this.camera.fov = this._trackingFov;
      this.camera.updateProjectionMatrix();
    } else if (mode === 'path' && this.cameras.length) {
      const cameras = this.cameras;
      let index = 0;
      while (index < cameras.length - 2 && time > cameras[index + 1].time) index++;
      const a = cameras[index], b = cameras[Math.min(index + 1, cameras.length - 1)];
      const alpha = a === b ? 0 : THREE.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1);
      const eased = THREE.MathUtils.smoothstep(alpha, 0, 1);
      if (this._cameraCurve) this._cameraCurve.getPoint((index + eased) / (cameras.length - 1), this.camera.position);
      else this.camera.position.fromArray(a.position);
      this.controls.target.copy(v3(a.target).lerp(v3(b.target), eased));
      this.camera.fov = THREE.MathUtils.lerp(a.fov, b.fov, eased);
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
  }

  _clearDamping() {
    const position = this.camera.position.clone(), target = this.controls.target.clone(), quaternion = this.camera.quaternion.clone();
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.camera.position.copy(position); this.camera.quaternion.copy(quaternion); this.controls.target.copy(target);
    this.camera.updateMatrixWorld(true);
  }

  frameSelection() {
    if (this.fragmentId && !this._authoring()) {
      const mesh = this.meshes.get(this.fragmentId);
      if (mesh?.visible) {
        mesh.updateWorldMatrix(true, false);
        this._frame(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
        return;
      }
    }
    this._frame(this.selection.size ? this._bounds(this.selection) : this._bounds());
  }

  _frame(box, direction = this.camera.position.clone().sub(this.controls.target).normalize()) {
    if (box.isEmpty()) return;
    this.setCameraMode('orbit');
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const radius = Math.max(0.4, size.length() / 2);
    const limitingAngle = Math.atan(Math.tan(vertical) * Math.min(1, this.camera.aspect));
    const distance = radius / Math.sin(limitingAngle) * 1.12;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.lookAt(center);
    this._clearDamping();
    this._cameraDirty = false;
  }

  resetCamera() {
    this.camera.fov = 36;
    this.camera.updateProjectionMatrix();
    this._frame(this._bounds(), new THREE.Vector3(9, 4.2, 11).normalize());
  }

  /** Explicit dimensions lock ResizeObserver until the next no-argument resize(). */
  resize(width, height, pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2)) {
    if (this.disposed) return;
    if (width !== undefined && height !== undefined) {
      if (!(width > 0 && height > 0 && pixelRatio > 0) || ![width, height, pixelRatio].every(Number.isFinite)) throw new Error('Viewport dimensions and pixel ratio must be positive and finite.');
      this._outputSize = { width, height, pixelRatio };
    } else {
      this._outputSize = null;
      width = Math.max(1, this.container.clientWidth);
      height = Math.max(1, this.container.clientHeight);
    }
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(Math.round(width), Math.round(height), false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  renderAt(snapshot, time, { cameraMode = this.cameraMode } = {}) {
    if (this.disposed) throw new Error('Cannot render a disposed viewport.');
    if (!Number.isFinite(time) || time < 0 || time > 12) throw new Error('Render time must be physical seconds in [0, 12].');
    if (!CAMERA_MODES.includes(cameraMode)) throw new Error(`Unknown camera mode: ${cameraMode}`);
    this._cancelTransform();
    this.setState(snapshot);
    this.time = time;
    this._applyCamera(time, cameraMode);
    this._cameraDirty = false;
    this._draw();
  }

  render(dtSeconds = 0) {
    if (this.disposed) return;
    if (this._cameraDirty && this.cameraMode !== 'orbit') {
      this._clearDamping();
      this._applyCamera(this.time, this.cameraMode);
      this._cameraDirty = false;
    } else if (this.controls.enabled) {
      this.controls.update(Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0);
    }
    this._draw();
  }

  _draw() {
    const start = performance.now();
    this.renderer.render(this.scene, this.camera);
    this._metrics = { renderMs: performance.now() - start, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fragments: this.meshes.size, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures };
  }

  /** renderMs measures main-thread submission, not completed GPU/presentation time. */
  getMetrics() { return { ...this._metrics }; }

  dispose() {
    if (this.disposed) return;
    this._cancelTransform();
    this.disposed = true;
    this._resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this._onPointerDown, true);
    canvas.removeEventListener('pointermove', this._onPointerMove);
    canvas.removeEventListener('pointerup', this._onPointerUp);
    canvas.removeEventListener('pointercancel', this._onPointerCancel);
    canvas.removeEventListener('keydown', this._onKeyDown);
    this.controls.removeEventListener('end', this._onOrbitEnd);
    this.transformControls.removeEventListener('mouseDown', this._onDragStart);
    this.transformControls.removeEventListener('objectChange', this._onDragChange);
    this.transformControls.removeEventListener('mouseUp', this._onDragEnd);
    this.controls.dispose();
    this.transformControls.dispose();
    this.transformHelper.removeFromParent();
    if (this.fragmentOutline) this.fragmentOutline.removeFromParent();
    for (const child of this.dimensionRoot.children) child.material?.map?.dispose();
    disposeTree(this.scene);
    for (const resource of this._resources) resource.dispose();
    this._resources.clear();
    this._environment.dispose();
    this.keyLight.shadow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.meshes.clear(); this.objects.clear(); this.projectiles.clear();
    this.materials.clear(); this.selection.clear(); this.selectionBoxes?.clear();
    this.previews.clear();
    this.fragments = []; this.bonds = []; this.project = null; this.snapshot = null;
  }
}
