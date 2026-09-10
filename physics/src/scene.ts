import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MarbleWorld } from './physics';
import { ImpactAudio } from './audio';

export interface SceneOptions {
  onReady: () => void;
  onDrag: (dragging: boolean) => void;
  onEnergy: (energy: number) => void;
}

const PALETTE = ['#b87c45', '#567d63', '#e5c86a', '#779eb1', '#a6543d', '#bbbda7'];

function marbleTexture(color: string, index: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 256);
  // Periodic bands wrap seamlessly around the sphere and reveal its rotation.
  for (let band = 0; band < 9; band++) {
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 2) {
      const y = band * 44 - 55 + Math.sin(x / 512 * Math.PI * 4 + band * 0.65 + index) * 17
        + Math.sin(x / 512 * Math.PI * 2 + band) * 20;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = band % 3 === 0 ? 'rgba(255,249,221,0.58)' : 'rgba(249,245,219,0.19)';
    ctx.lineWidth = band % 3 === 0 ? 8 : 3;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(52,59,39,0.13)';
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(43,62,39,0.30)');
  gradient.addColorStop(0.32, 'rgba(43,62,39,0.18)');
  gradient.addColorStop(0.65, 'rgba(43,62,39,0.07)');
  gradient.addColorStop(1, 'rgba(43,62,39,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class OrbitalScene {
  readonly world = new MarbleWorld(18, 2.05);
  readonly audio = new ImpactAudio();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
  private readonly globe = new THREE.Group();
  private readonly marbles = new THREE.Group();
  private readonly center = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly hit = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 2.13);
  private readonly geometry = new THREE.SphereGeometry(1, 40, 28);
  private readonly materials: THREE.MeshPhysicalMaterial[];
  private readonly shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly resizeObserver: ResizeObserver;
  private readonly rim: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private frame = 0;
  private lastTime = 0;
  private lastReadout = 0;
  private elapsed = 0;
  private dragged = false;
  private activePointer: number | null = null;
  private swirlTime = 0;
  private swirlOrigin = new THREE.Vector3();
  private isDisposed = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private bounds = new THREE.Vector2(3, 1.5);

  constructor(private readonly host: HTMLElement, private readonly options: SceneOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.75;
    room.dispose();
    pmrem.dispose();

    const key = new THREE.DirectionalLight('#fff4da', 2.6);
    key.position.set(-4, 7, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -6;
    key.shadow.camera.right = key.shadow.camera.top = 6;
    key.shadow.normalBias = 0.025;
    key.shadow.bias = -0.0002;
    key.shadow.radius = 4;
    this.scene.add(key, new THREE.HemisphereLight('#fffef4', '#80917d', 0.85));
    const fill = new THREE.DirectionalLight('#d8e9ed', 1.3);
    fill.position.set(4, 3, -2);
    this.scene.add(fill);

    this.materials = PALETTE.map((color, index) => new THREE.MeshPhysicalMaterial({
      map: marbleTexture(color, index),
      roughness: index === 5 ? 0.27 : 0.17,
      metalness: index === 0 || index === 2 ? 0.28 : 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.10,
      envMapIntensity: 1.1,
    }));
    this.createMarbles();
    this.scene.add(this.marbles);

    const glassGeometry = new THREE.SphereGeometry(2.11, 96, 64);
    const glass = new THREE.Mesh(glassGeometry, new THREE.MeshPhysicalMaterial({
      color: '#f1f7ec',
      roughness: 0.035,
      metalness: 0,
      transmission: 1,
      thickness: 0.085,
      ior: 1.16,
      transparent: true,
      opacity: 0.30,
      envMapIntensity: 0.65,
      clearcoat: 1,
      clearcoatRoughness: 0.035,
      depthWrite: false,
      side: THREE.FrontSide,
    }));
    glass.renderOrder = 2;
    this.globe.add(glass);

    this.rim = new THREE.Mesh(glassGeometry, new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#789583') },
        uActive: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uActive;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float f = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
          float edge = pow(f, 5.0);
          vec3 col = mix(uColor, vec3(0.89, 0.97, 0.82), uActive * 0.3);
          gl_FragColor = vec4(col, edge * (0.30 + uActive * 0.07) + pow(f, 2.5) * 0.025);
        }
      `,
      transparent: true,
      depthWrite: false,
    }));
    this.rim.renderOrder = 3;
    this.globe.add(this.rim);
    this.addReflections();
    this.scene.add(this.globe);

    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 5.4), new THREE.MeshBasicMaterial({
      map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.58,
    }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -2.65;
    this.scene.add(this.shadow);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.035 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.66;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.world.onImpact = this.audio.impact;
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.resize();
    host.addEventListener('pointerdown', this.pointerDown);
    host.addEventListener('pointermove', this.pointerMove);
    host.addEventListener('pointerup', this.pointerUp);
    host.addEventListener('pointercancel', this.pointerUp);
    host.addEventListener('lostpointercapture', this.pointerUp);
    document.addEventListener('visibilitychange', this.visibilityChange);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.contextRestored);
    this.frame = requestAnimationFrame(this.animate);
    options.onReady();
  }

  private addReflections(): void {
    // Narrow curved softboxes sit on the surface, not inside the globe.
    const makeArc = (start: number, length: number, radius: number, width: number, opacity: number) => {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const theta = start + length * i / 64;
        points.push(new THREE.Vector3(Math.cos(theta) * radius, Math.sin(theta) * radius,
          Math.sqrt(2.118 ** 2 - radius ** 2)));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, width, 6, false),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity, depthWrite: false }));
      mesh.renderOrder = 4;
      this.globe.add(mesh);
    };
    makeArc(1.79, 0.85, 1.88, 0.018, 0.75);
    makeArc(1.88, 0.62, 1.80, 0.041, 0.32);
    makeArc(-0.93, 0.83, 2.035, 0.012, 0.64);
    makeArc(0.08, 0.55, 1.98, 0.012, 0.27);
  }

  private createMarbles(): void {
    this.marbles.clear();
    for (const body of this.world.bodies) {
      const mesh = new THREE.Mesh(this.geometry, this.materials[body.colorIndex]);
      mesh.scale.setScalar(body.radius);
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.rotation);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.marbles.add(mesh);
    }
  }

  private resize = (): void => {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    const mobile = width < 900;
    const distance = mobile ? Math.max(8.2, 5.05 / this.camera.aspect / (2 * Math.tan(35 * Math.PI / 360))) : 11.9;
    const viewHeight = 2 * distance * Math.tan(35 * Math.PI / 360);
    const viewWidth = viewHeight * this.camera.aspect;
    const x = mobile ? 0 : -viewWidth * 0.145;
    this.camera.position.set(x, distance * 0.18, distance);
    this.camera.lookAt(x, mobile ? -0.08 : 0, 0);
    this.camera.updateProjectionMatrix();
    this.bounds.set(Math.max(0.22, viewWidth / 2 - 2.22), Math.max(0.28, viewHeight / 2 - 2.6));
    this.target.x = THREE.MathUtils.clamp(this.target.x, -this.bounds.x + x, this.bounds.x + x);
    this.target.y = THREE.MathUtils.clamp(this.target.y, -0.65, this.bounds.y);
  };

  private updateRay(event: PointerEvent): void {
    const rect = this.host.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pointerDown = (event: PointerEvent): void => {
    if (this.activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.updateRay(event);
    this.sphere.center.copy(this.center);
    if (!this.raycaster.ray.intersectsSphere(this.sphere)) return;
    event.preventDefault();
    this.activePointer = event.pointerId;
    this.dragged = true;
    this.swirlTime = 0;
    this.raycaster.ray.intersectPlane(this.dragPlane, this.hit);
    this.offset.subVectors(this.hit, this.center);
    this.target.copy(this.center);
    this.host.setPointerCapture(event.pointerId);
    this.host.style.cursor = 'grabbing';
    this.options.onDrag(true);
    if (this.audio.enabled) void this.audio.setEnabled(true);
  };

  private pointerMove = (event: PointerEvent): void => {
    this.updateRay(event);
    if (this.activePointer === null) {
      this.sphere.center.copy(this.center);
      this.host.style.cursor = this.raycaster.ray.intersectsSphere(this.sphere) ? 'grab' : 'default';
      return;
    }
    if (event.pointerId !== this.activePointer) return;
    this.raycaster.ray.intersectPlane(this.dragPlane, this.hit);
    const cameraX = this.camera.position.x;
    this.target.set(
      THREE.MathUtils.clamp(this.hit.x - this.offset.x, -this.bounds.x + cameraX, this.bounds.x + cameraX),
      THREE.MathUtils.clamp(this.hit.y - this.offset.y, -0.65, this.bounds.y),
      0,
    );
  };

  private pointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    this.activePointer = null;
    if (this.host.hasPointerCapture(event.pointerId)) this.host.releasePointerCapture(event.pointerId);
    this.host.style.cursor = 'grab';
    this.options.onDrag(false);
  };

  private visibilityChange = (): void => {
    this.lastTime = 0;
    if (document.hidden) {
      cancelAnimationFrame(this.frame);
    } else if (!this.isDisposed) {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(this.animate);
    }
  };

  private contextLost = (event: Event): void => {
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.host.dataset.contextLost = 'true';
  };

  private contextRestored = (): void => {
    delete this.host.dataset.contextLost;
    this.lastTime = 0;
    this.frame = requestAnimationFrame(this.animate);
  };

  private animate = (time: number): void => {
    if (this.isDisposed) return;
    const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 1 / 20) : 1 / 60;
    this.lastTime = time;
    this.elapsed += dt;
    if (this.swirlTime > 0) {
      this.swirlTime = Math.max(0, this.swirlTime - dt);
      const t = 1 - this.swirlTime / 1.2;
      const amplitude = Math.sin(t * Math.PI) * 0.53;
      this.target.copy(this.swirlOrigin);
      this.target.x += Math.sin(t * Math.PI * 4) * amplitude;
      this.target.y += Math.cos(t * Math.PI * 4) * amplitude;
    }
    const smooth = 1 - Math.exp(-dt * (this.activePointer !== null ? 24 : 8));
    this.center.lerp(this.target, smooth);
    if (!this.dragged && !this.swirlTime && !this.reducedMotion) {
      this.center.y += Math.sin(this.elapsed * 0.9) * 0.018 * dt;
      this.center.x += Math.cos(this.elapsed * 0.65) * 0.018 * dt;
    }
    this.world.step(dt, this.center);
    this.globe.position.copy(this.center);
    for (let i = 0; i < this.world.bodies.length; i++) {
      this.marbles.children[i].position.copy(this.world.bodies[i].position);
      this.marbles.children[i].quaternion.copy(this.world.bodies[i].rotation);
    }
    this.rim.material.uniforms.uActive.value = THREE.MathUtils.lerp(
      this.rim.material.uniforms.uActive.value, this.activePointer !== null ? 1 : 0, smooth,
    );
    this.shadow.position.x = this.center.x;
    const elevation = this.center.y + 0.65;
    this.shadow.scale.setScalar(1 + elevation * 0.12);
    this.shadow.material.opacity = Math.max(0.2, 0.65 - elevation * 0.12);
    this.renderer.render(this.scene, this.camera);
    if (time - this.lastReadout > 150) {
      this.options.onEnergy(this.world.energy);
      this.lastReadout = time;
    }
    this.frame = requestAnimationFrame(this.animate);
  };

  swirl(): void {
    this.swirlOrigin.copy(this.center);
    this.swirlTime = 1.2;
    this.world.stir();
  }

  reset(count = this.world.bodies.length): void {
    this.swirlTime = 0;
    this.dragged = false;
    if (this.activePointer !== null && this.host.hasPointerCapture(this.activePointer)) {
      this.host.releasePointerCapture(this.activePointer);
    }
    this.activePointer = null;
    this.host.style.cursor = 'grab';
    this.options.onDrag(false);
    this.target.set(0, 0, 0);
    this.center.set(0, 0, 0);
    this.world.center.set(0, 0, 0);
    this.world.reset(count);
    this.createMarbles();
  }

  nudge(x: number, y: number): void {
    this.dragged = true;
    this.target.x = THREE.MathUtils.clamp(this.target.x + x, -this.bounds.x + this.camera.position.x, this.bounds.x + this.camera.position.x);
    this.target.y = THREE.MathUtils.clamp(this.target.y + y, -0.65, this.bounds.y);
  }

  dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.host.removeEventListener('pointerdown', this.pointerDown);
    this.host.removeEventListener('pointermove', this.pointerMove);
    this.host.removeEventListener('pointerup', this.pointerUp);
    this.host.removeEventListener('pointercancel', this.pointerUp);
    this.host.removeEventListener('lostpointercapture', this.pointerUp);
    document.removeEventListener('visibilitychange', this.visibilityChange);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.contextRestored);
    this.audio.dispose();
    this.environment.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
