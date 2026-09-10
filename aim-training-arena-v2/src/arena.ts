import * as THREE from 'three';

export type TrainingMode = 'gridshot' | 'precision' | 'tracking';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface ArenaConfig {
  mode: TrainingMode;
  duration: number;
  difficulty: Difficulty;
  sensitivity: number;
  sound: boolean;
  crosshair: 'cross' | 'dot' | 'circle';
}

export interface ArenaStats {
  score: number;
  hits: number;
  shots: number;
  combo: number;
  bestCombo: number;
  accuracy: number;
  timeLeft: number;
  reactionTime: number;
}

export interface SessionResult extends ArenaStats {
  mode: TrainingMode;
  duration: number;
  difficulty: Difficulty;
}

export type ArenaState =
  'idle' | 'countdown' | 'running' | 'paused' | 'finished';

export interface ArenaCallbacks {
  onStats: (stats: ArenaStats) => void;
  onState: (state: ArenaState) => void;
  onCountdown: (count: number) => void;
  onFinish: (result: SessionResult) => void;
}

interface Target {
  group: THREE.Group;
  sphere: THREE.Mesh;
  ring: THREE.Mesh;
  pad: THREE.Group;
  slot: number;
  bornAt: number;
  scale: number;
}

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  life: number;
  lifetime: number;
  size: number;
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
  moved: boolean;
  shotOnDown: boolean;
  touch: boolean;
}

const LIME = 0xd5fa39;
const DEFAULT_CONFIG: ArenaConfig = {
  mode: 'gridshot',
  duration: 60,
  difficulty: 'normal',
  sensitivity: 1,
  sound: true,
  crosshair: 'cross',
};

/**
 * Owns only its canvas. Crosshair, countdown, controls, and result UI belong to
 * the host. Accuracy is a percentage, reactionTime is milliseconds, and
 * timeLeft is fractional seconds. stop() cancels without producing a result.
 */
export class Arena {
  public readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly callbacks: ArenaCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 16 / 10, 0.08, 75);
  private readonly weaponScene = new THREE.Scene();
  private readonly weaponCamera = new THREE.PerspectiveCamera(
    54,
    16 / 10,
    0.01,
    8,
  );
  private readonly weapon = new THREE.Group();
  private readonly targetRoot = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly cleanups: Array<() => void> = [];
  private readonly keys = new Set<string>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly screenCenter = new THREE.Vector2();
  private readonly intersections: THREE.Intersection[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly lookSway = new THREE.Vector2();

  private readonly unitBox = this.geometry(new THREE.BoxGeometry(1, 1, 1));
  private readonly sphereGeometry = this.geometry(
    new THREE.SphereGeometry(1, 32, 20),
  );
  private readonly ringGeometry = this.geometry(
    new THREE.TorusGeometry(1.004, 0.027, 8, 48),
  );
  private readonly padGeometry = this.geometry(
    new THREE.RingGeometry(0.52, 0.55, 48),
  );
  private readonly targetMaterial = this.material(
    new THREE.MeshStandardMaterial({
      color: LIME,
      emissive: LIME,
      emissiveIntensity: 0.32,
      metalness: 0.18,
      roughness: 0.27,
    }),
  );
  private readonly targetBandMaterial = this.material(
    new THREE.MeshStandardMaterial({
      color: 0x1a2426,
      metalness: 0.65,
      roughness: 0.36,
    }),
  );
  private readonly padMaterial = this.material(
    new THREE.MeshBasicMaterial({
      color: LIME,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );

  private targets: Target[] = [];
  private hitMeshes: THREE.Object3D[] = [];
  private slots: THREE.Vector3[] = [];
  private particles: Particle[] = [];
  private particleMesh!: THREE.InstancedMesh;
  private impactRings: Array<{
    mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    life: number;
  }> = [];
  private muzzleFlash!: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private muzzleLight!: THREE.PointLight;
  private resizeObserver: ResizeObserver | null = null;
  private audio: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private gesture: Gesture | null = null;
  private config: ArenaConfig = { ...DEFAULT_CONFIG };
  private stats: ArenaStats = this.emptyStats(DEFAULT_CONFIG.duration);
  private state: ArenaState = 'idle';
  private pausedFrom: 'countdown' | 'running' = 'running';
  private destroyed = false;
  private muted = false;
  private ownsPointerLock = false;
  private fireHeld = false;
  private frame = 0;
  private lastFrameTime = 0;
  private lastStatsTime = 0;
  private elapsed = 0;
  private animationTime = 0;
  private countdownRemaining = 3;
  private countdownValue = 3;
  private yaw = 0;
  private pitch = 0.075;
  private recoil = 0;
  private flashTime = 0;
  private lastShotAt = -Infinity;
  private reactionTotal = 0;
  private reactionSamples = 0;
  private trackingAcquired = false;
  private trackingSeekSince = 0;
  private particleCursor = 0;
  private impactCursor = 0;

  constructor(container: HTMLElement, callbacks: ArenaCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.canvas.style.outline = 'none';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute(
      'aria-label',
      'First-person aim training arena. WASD to move, mouse or touch drag to aim, click or tap to shoot. Escape pauses.',
    );
    container.appendChild(this.canvas);

    this.scene.background = new THREE.Color(0x111b29);
    this.scene.fog = new THREE.FogExp2(0x111b29, 0.022);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera, this.targetRoot);
    this.buildHangar();
    this.buildWeapon();
    this.buildEffects();
    this.resetPlayer();
    this.populateTargets();
    this.installInput();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.listen(window, 'resize', () => this.resize());
    this.resize();
    this.lastFrameTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
    this.emitStats();
    this.callbacks.onState('idle');
  }

  /** Session rules stay fixed once started; input/audio preferences can change live. */
  public configure(config: ArenaConfig): void {
    if (this.destroyed) return;
    const next = this.normalizeConfig(config);
    if (this.state === 'idle' || this.state === 'finished') {
      this.config = next;
      if (this.state === 'idle') this.stats = this.emptyStats(next.duration);
      this.animationTime = 0;
      this.populateTargets();
      if (this.state === 'idle') this.emitStats();
      this.render();
    } else {
      this.config.sensitivity = next.sensitivity;
      this.config.sound = next.sound;
      this.config.crosshair = next.crosshair;
    }
    this.updateAudioGain();
  }

  public start(config: ArenaConfig): void {
    if (this.destroyed) return;
    // Keep this in the trusted click stack, before any asynchronous work.
    this.requestPointerLock();
    this.config = this.normalizeConfig(config);
    this.unlockAudio();
    this.updateAudioGain();
    this.clearInput();
    this.elapsed = 0;
    this.animationTime = 0;
    this.countdownRemaining = 3;
    this.countdownValue = 3;
    this.lastShotAt = -Infinity;
    this.reactionTotal = 0;
    this.reactionSamples = 0;
    this.trackingAcquired = false;
    this.trackingSeekSince = 0;
    this.stats = this.emptyStats(this.config.duration);
    this.resetEffects();
    this.resetPlayer();
    this.populateTargets();
    this.lastFrameTime = performance.now();
    this.state = 'countdown';
    this.canvas.style.cursor = 'none';
    this.emitStats();
    this.callbacks.onState('countdown');
    if (this.destroyed || this.state !== 'countdown') return;
    this.callbacks.onCountdown(3);
    this.playSound('countdown');
    this.render();
  }

  public pause(): void {
    if (
      this.destroyed ||
      (this.state !== 'running' && this.state !== 'countdown')
    )
      return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.clearInput();
    this.flashTime = 0;
    this.muzzleFlash.visible = false;
    this.muzzleLight.intensity = 0;
    this.canvas.style.cursor = 'default';
    this.releasePointerLock();
    this.emitStats();
    this.callbacks.onState('paused');
  }

  public resume(): void {
    if (this.destroyed || this.state !== 'paused') return;
    this.requestPointerLock();
    this.unlockAudio();
    this.clearInput();
    this.lastFrameTime = performance.now();
    this.state = this.pausedFrom;
    this.canvas.style.cursor = 'none';
    this.callbacks.onState(this.state);
  }

  /** Cancel the session and restore a populated idle preview. Does not call onFinish. */
  public stop(): void {
    if (this.destroyed) return;
    this.state = 'idle';
    this.clearInput();
    this.releasePointerLock();
    this.canvas.style.cursor = 'default';
    this.elapsed = 0;
    this.animationTime = 0;
    this.stats = this.emptyStats(this.config.duration);
    this.resetEffects();
    this.resetPlayer();
    this.populateTargets();
    this.emitStats();
    this.callbacks.onState('idle');
    this.render();
  }

  public shoot(): void {
    if (this.destroyed || this.state !== 'running') return;
    const interval = this.config.mode === 'tracking' ? 0.08 : 0.065;
    if (this.elapsed - this.lastShotAt + 0.000001 < interval) return;
    this.lastShotAt = this.elapsed;
    this.stats.shots += 1;
    this.recoil = Math.min(
      1,
      this.recoil + (this.config.mode === 'tracking' ? 0.36 : 0.85),
    );
    this.flashTime = 0.07;
    this.muzzleFlash.visible = true;
    this.muzzleFlash.rotation.y = Math.random() * Math.PI;
    this.playSound('fire');

    // Input may arrive between animation frames. Refresh world matrices before raycasting.
    this.camera.updateMatrixWorld(true);
    this.targetRoot.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.screenCenter, this.camera);
    this.intersections.length = 0;
    this.raycaster.intersectObjects(this.hitMeshes, false, this.intersections);
    const intersection = this.intersections[0];
    const target =
      intersection &&
      this.targets.find((item) => item.sphere === intersection.object);

    if (target && intersection) {
      this.stats.hits += 1;
      this.stats.combo += 1;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, this.stats.combo);
      const reaction =
        (this.elapsed -
          (this.config.mode === 'tracking'
            ? this.trackingSeekSince
            : target.bornAt)) *
        1000;
      if (this.config.mode !== 'tracking' || !this.trackingAcquired) {
        this.reactionTotal += Math.max(0, reaction);
        this.reactionSamples += 1;
        this.stats.reactionTime = Math.round(
          this.reactionTotal / this.reactionSamples,
        );
      }
      const base =
        this.config.mode === 'tracking'
          ? 10
          : this.config.mode === 'precision'
            ? 150
            : 100;
      const speedBonus =
        this.config.mode === 'tracking'
          ? 0
          : Math.max(0, 35 * (1 - reaction / 1800));
      const difficultyBonus =
        this.config.difficulty === 'hard'
          ? 1.25
          : this.config.difficulty === 'easy'
            ? 0.8
            : 1;
      const comboBonus = 1 + Math.min(this.stats.combo - 1, 20) * 0.05;
      this.stats.score += Math.round(
        (base + speedBonus) * difficultyBonus * comboBonus,
      );
      this.spawnImpact(intersection.point, this.config.mode === 'tracking');
      this.playSound('hit');
      if (this.config.mode === 'tracking') {
        this.trackingAcquired = true;
      } else {
        this.replenishTarget(target);
      }
    } else {
      this.stats.combo = 0;
      if (this.trackingAcquired) this.trackingSeekSince = this.elapsed;
      this.trackingAcquired = false;
    }
    this.stats.accuracy = (this.stats.hits / this.stats.shots) * 100;
    this.emitStats();
  }

  public setMuted(muted: boolean): void {
    if (this.destroyed) return;
    this.muted = muted;
    this.updateAudioGain();
    if (!muted) this.unlockAudio();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.clearInput();
    this.releasePointerLock();
    if (this.audio && this.audio.state !== 'closed')
      void this.audio.close().catch(() => {});
    this.audio = null;
    this.masterGain = null;
    this.scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof THREE.Light && 'shadow' in object) {
        (object as THREE.DirectionalLight).shadow?.dispose();
      }
    });
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.scene.clear();
    this.weaponScene.clear();
    this.targets.length = 0;
    this.hitMeshes.length = 0;
    this.canvas.remove();
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  private box(
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = this.scene,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.unitBox, material);
    mesh.scale.set(width, height, depth);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  private buildHangar(): void {
    const shell = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x172334,
        roughness: 0.82,
        metalness: 0.3,
      }),
    );
    const panel = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x263448,
        roughness: 0.67,
        metalness: 0.45,
      }),
    );
    const beam = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x46556a,
        roughness: 0.49,
        metalness: 0.65,
      }),
    );
    const edge = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x0c1520,
        roughness: 0.7,
        metalness: 0.4,
      }),
    );
    const floor = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x283343,
        roughness: 0.79,
        metalness: 0.28,
      }),
    );
    const whiteLight = this.material(
      new THREE.MeshBasicMaterial({ color: 0xd8efff, toneMapped: false }),
    );
    const limeLight = this.material(
      new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false }),
    );
    const dimLime = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x849529,
        emissive: LIME,
        emissiveIntensity: 0.12,
        roughness: 0.8,
      }),
    );

    const ground = this.box(24, 0.3, 38, floor, 0, -0.17, -3);
    ground.receiveShadow = true;
    this.box(24, 9, 0.6, shell, 0, 4.5, -14);
    this.box(24, 9, 0.5, shell, 0, 4.5, 15.8);
    this.box(6.5, 6.4, 0.2, edge, 0, 3.2, 15.42);
    for (const side of [-1, 1]) {
      this.box(2.85, 5.8, 0.1, panel, side * 1.47, 2.95, 15.26);
      this.box(0.05, 3.8, 0.035, limeLight, side * 3.13, 3.15, 15.23);
    }
    this.box(0.5, 9, 38, shell, -11.5, 4.5, -3);
    this.box(0.5, 9, 38, shell, 11.5, 4.5, -3);
    this.box(24, 0.25, 38, edge, 0, 9, -3);

    const gridVertices: number[] = [];
    for (let x = -11; x <= 11; x += 1)
      gridVertices.push(x, 0.003, -14, x, 0.003, 14);
    for (let z = -14; z <= 14; z += 1)
      gridVertices.push(-11, 0.003, z, 11, 0.003, z);
    const gridGeometry = this.geometry(new THREE.BufferGeometry());
    gridGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(gridVertices, 3),
    );
    this.scene.add(
      new THREE.LineSegments(
        gridGeometry,
        this.material(
          new THREE.LineBasicMaterial({
            color: 0x6c8097,
            transparent: true,
            opacity: 0.12,
            depthWrite: false,
          }),
        ),
      ),
    );

    // Repeated structural bays provide depth without textures or postprocessing.
    for (const z of [-12.8, -7.2, -1.6, 4, 9.6]) {
      for (const side of [-1, 1]) {
        this.box(0.48, 8.7, 0.62, beam, side * 10.7, 4.35, z);
        this.box(0.7, 0.48, 1.05, edge, side * 10.7, 0.25, z);
        this.box(0.12, 3.8, 0.7, panel, side * 10.4, 3.3, z);
        const brace = this.box(2.5, 0.25, 0.58, beam, side * 9.65, 7.65, z);
        brace.rotation.z = (side * Math.PI) / 4;
        this.box(0.045, 1.15, 0.12, limeLight, side * 10.43, 1.75, z + 0.34);
        this.box(0.035, 0.045, 4.7, dimLime, side * 11.21, 0.52, z + 2.6);
        this.box(0.09, 3.4, 4.7, panel, side * 11.2, 3.9, z + 2.7);
      }
      this.box(21.8, 0.38, 0.6, beam, 0, 8.75, z);
      this.box(12.8, 0.035, 0.12, whiteLight, 0, 8.54, z + 0.12);
    }

    for (const x of [-5.8, 5.8]) {
      this.box(0.45, 0.13, 26, edge, x, 8.7, -1.5);
      for (const z of [-10, -3.5, 3, 9.5]) {
        this.box(0.16, 0.035, 4.5, whiteLight, x, 8.61, z);
      }
      this.box(0.09, 0.012, 22, dimLime, x * 1.42, 0.012, -2);
    }

    // A recessed backstop, layered frame, and asymmetric technical wall details.
    this.box(17.3, 6.65, 0.28, edge, 0, 3.72, -13.52);
    this.box(15.8, 5.95, 0.15, panel, 0, 3.65, -13.31);
    for (const x of [-8.35, 8.35]) {
      this.box(0.22, 6.7, 0.35, beam, x, 3.7, -13.16);
      this.box(0.055, 2.25, 0.04, limeLight, x, 4.45, -12.96);
    }
    this.box(16.85, 0.2, 0.38, beam, 0, 7.05, -13.15);
    this.box(5.6, 0.05, 0.045, limeLight, 0, 6.87, -12.94);
    this.box(16.85, 0.3, 0.55, beam, 0, 0.43, -13.1);
    for (let x = -6; x <= 6; x += 3) {
      this.box(0.025, 4.9, 0.025, edge, x, 3.05, -13.21);
      this.box(2.55, 0.035, 0.04, beam, x, 1.04, -13.2);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i += 1) {
        this.box(1.12, 0.085, 0.12, edge, side * 9.62, 2.65 + i * 0.22, -13.58);
      }
      for (let i = 0; i < 5; i += 1) {
        const stripe = this.box(
          0.15,
          0.65,
          0.025,
          dimLime,
          side * 9.16 + i * 0.23,
          0.65,
          -13.66,
        );
        stripe.rotation.z = -0.48;
      }
    }
    this.addSignage();

    const platformGeometry = this.geometry(
      new THREE.CylinderGeometry(6.35, 6.48, 0.14, 6),
    );
    const platform = new THREE.Mesh(
      platformGeometry,
      this.material(
        new THREE.MeshStandardMaterial({
          color: 0x1d2936,
          metalness: 0.55,
          roughness: 0.63,
        }),
      ),
    );
    platform.position.set(0, 0.06, -5.3);
    platform.rotation.y = Math.PI / 6;
    platform.scale.z = 0.76;
    platform.receiveShadow = true;
    this.scene.add(platform);
    const platformOutline = new THREE.Mesh(
      this.geometry(new THREE.RingGeometry(5.65, 5.68, 96)),
      this.padMaterial,
    );
    platformOutline.rotation.x = -Math.PI / 2;
    platformOutline.scale.y = 0.74;
    platformOutline.position.set(0, 0.136, -5.3);
    this.scene.add(platformOutline);

    const platformLines: number[] = [];
    for (let x = -4; x <= 4; x += 1)
      platformLines.push(x, 0.137, -8.1, x, 0.137, -2.5);
    for (let z = -8; z <= -3; z += 1)
      platformLines.push(-4.8, 0.137, z, 4.8, 0.137, z);
    const platformGrid = this.geometry(new THREE.BufferGeometry());
    platformGrid.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(platformLines, 3),
    );
    this.scene.add(
      new THREE.LineSegments(
        platformGrid,
        this.material(
          new THREE.LineBasicMaterial({
            color: 0xa5bf8d,
            transparent: true,
            opacity: 0.12,
            depthWrite: false,
          }),
        ),
      ),
    );

    // Broken range lines and flush metal tiles lead the eye toward the targets.
    for (const x of [-6.9, 6.9]) {
      for (let z = -10; z < 10; z += 2)
        this.box(0.085, 0.01, 0.8, dimLime, x, 0.013, z);
    }
    for (const x of [-4.6, 0, 4.6]) {
      this.box(2.2, 0.012, 0.075, beam, x, 0.015, 3.3);
      this.box(0.055, 0.012, 0.45, dimLime, x, 0.018, 3.3);
    }

    this.scene.add(new THREE.HemisphereLight(0xb9d4fa, 0x263047, 1.65));
    const key = new THREE.DirectionalLight(0xe8f3ff, 2.5);
    key.position.set(-5, 8, 3);
    key.target.position.set(0, 2, -5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 32;
    key.shadow.normalBias = 0.045;
    key.shadow.bias = -0.00015;
    this.scene.add(key, key.target);
    const rim = new THREE.PointLight(0xa7caff, 65, 24, 2);
    rim.position.set(6, 6, -9);
    this.scene.add(rim);
    const limeWash = new THREE.PointLight(LIME, 18, 13, 2);
    limeWash.position.set(0, 3.5, -11.5);
    this.scene.add(limeWash);

    // Hundreds of static architectural pieces become a handful of draw calls.
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    for (const object of this.scene.children) {
      if (
        !(object instanceof THREE.Mesh) ||
        object.geometry !== this.unitBox ||
        Array.isArray(object.material)
      )
        continue;
      const meshes = batches.get(object.material) ?? [];
      meshes.push(object);
      batches.set(object.material, meshes);
    }
    for (const [material, meshes] of batches) {
      if (meshes.length < 2) continue;
      const batch = new THREE.InstancedMesh(
        this.unitBox,
        material,
        meshes.length,
      );
      meshes.forEach((mesh, index) => {
        mesh.updateMatrix();
        batch.setMatrixAt(index, mesh.matrix);
        batch.receiveShadow ||= mesh.receiveShadow;
        this.scene.remove(mesh);
      });
      batch.computeBoundingSphere();
      this.scene.add(batch);
    }
  }

  private addSignage(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1536;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#d5fa39';
    context.fillRect(50, 51, 9, 185);
    context.font = '500 26px monospace';
    context.fillText('DEADEYE / TRAINING FACILITY', 94, 77);
    context.fillStyle = '#dce7f3';
    context.font = '800 139px sans-serif';
    context.fillText('SECTOR 01', 84, 218);
    context.fillStyle = '#879aae';
    context.font = '500 21px monospace';
    context.fillText('CONTROLLED ENVIRONMENT  /  LIVE TARGET SYSTEM', 94, 270);
    context.strokeStyle = '#66788b';
    context.lineWidth = 2;
    context.strokeRect(1185, 86, 252, 145);
    context.fillStyle = '#d5fa39';
    context.font = '700 33px monospace';
    context.fillText('RANGE', 1220, 141);
    context.fillStyle = '#c8d8e8';
    context.font = '500 23px monospace';
    context.fillText('AUTHORIZED', 1220, 188);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.textures.add(texture);
    const sign = new THREE.Mesh(
      this.geometry(new THREE.PlaneGeometry(12.6, 2.625)),
      this.material(
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    sign.position.set(0, 5.46, -13.19);
    this.scene.add(sign);
  }

  private buildWeapon(): void {
    const black = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x151b22,
        metalness: 0.7,
        roughness: 0.38,
      }),
    );
    const rubber = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x090e14,
        metalness: 0.1,
        roughness: 0.92,
      }),
    );
    const white = this.material(
      new THREE.MeshStandardMaterial({
        color: 0xe2e8e9,
        metalness: 0.48,
        roughness: 0.32,
      }),
    );
    const steel = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x68798c,
        metalness: 0.85,
        roughness: 0.28,
      }),
    );
    const accent = this.material(
      new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false }),
    );
    this.weaponCamera.add(this.weapon);
    this.weaponScene.add(this.weaponCamera);
    this.weaponScene.add(new THREE.HemisphereLight(0xe2eeff, 0x202c40, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2.7);
    light.position.set(-2, 4, 2);
    this.weaponScene.add(light);
    const sideLight = new THREE.DirectionalLight(0x94b6de, 1.1);
    sideLight.position.set(3, 0, -2);
    this.weaponScene.add(sideLight);

    this.box(0.19, 0.135, 0.46, black, 0, -0.005, -0.055, this.weapon);
    this.box(0.17, 0.105, 0.405, white, 0, 0.068, -0.065, this.weapon);
    this.box(0.14, 0.036, 0.45, black, 0, 0.132, -0.075, this.weapon);
    this.box(0.016, 0.084, 0.27, white, 0.102, -0.012, -0.027, this.weapon);
    this.box(0.019, 0.024, 0.19, accent, 0.112, 0.017, -0.042, this.weapon);
    this.box(0.01, 0.048, 0.095, black, 0.088, 0.075, 0.035, this.weapon);
    this.box(0.012, 0.025, 0.07, steel, 0.095, 0.076, 0.035, this.weapon);
    const grip = this.box(
      0.125,
      0.265,
      0.15,
      rubber,
      0,
      -0.18,
      0.091,
      this.weapon,
    );
    grip.rotation.x = -0.28;
    this.box(0.137, 0.035, 0.15, steel, 0, -0.303, 0.126, this.weapon);
    for (let i = 0; i < 5; i += 1) {
      this.box(
        0.131,
        0.015,
        0.13,
        black,
        0,
        -0.095 - i * 0.035,
        0.065 + i * 0.01,
        this.weapon,
      );
    }
    this.box(0.105, 0.023, 0.185, black, 0, -0.142, -0.049, this.weapon);
    this.box(0.105, 0.11, 0.026, black, 0, -0.097, -0.128, this.weapon);
    this.box(
      0.026,
      0.073,
      0.032,
      steel,
      0,
      -0.083,
      -0.025,
      this.weapon,
    ).rotation.x = -0.25;

    const barrel = new THREE.Mesh(
      this.geometry(new THREE.CylinderGeometry(0.038, 0.043, 0.135, 20)),
      steel,
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.063, -0.319);
    this.weapon.add(barrel);
    const muzzle = new THREE.Mesh(
      this.geometry(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 20)),
      rubber,
    );
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.063, -0.39);
    this.weapon.add(muzzle);
    for (let i = 0; i < 5; i += 1) {
      this.box(
        0.176,
        0.012,
        0.014,
        black,
        0,
        0.101,
        0.055 + i * 0.022,
        this.weapon,
      );
    }
    for (const x of [-0.047, 0.047]) {
      this.box(0.022, 0.051, 0.038, black, x, 0.164, 0.119, this.weapon);
      this.box(0.014, 0.014, 0.008, accent, x, 0.176, 0.141, this.weapon);
    }
    this.box(0.02, 0.04, 0.028, black, 0, 0.161, -0.237, this.weapon);
    this.box(0.01, 0.012, 0.008, accent, 0, 0.175, -0.22, this.weapon);
    // The cuff and glove ground the floating view model without obscuring the range.
    const glove = this.box(
      0.155,
      0.13,
      0.21,
      rubber,
      0.018,
      -0.17,
      0.182,
      this.weapon,
    );
    glove.rotation.x = -0.36;
    const cuff = this.box(
      0.183,
      0.155,
      0.255,
      white,
      0.043,
      -0.221,
      0.344,
      this.weapon,
    );
    cuff.rotation.x = -0.27;
    this.box(0.19, 0.03, 0.055, black, 0.039, -0.156, 0.272, this.weapon);

    this.muzzleFlash = new THREE.Mesh(
      this.geometry(new THREE.ConeGeometry(0.075, 0.23, 5)),
      this.material(
        new THREE.MeshBasicMaterial({
          color: 0xeaff9b,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    this.muzzleFlash.rotation.x = -Math.PI / 2;
    this.muzzleFlash.position.set(0, 0.063, -0.48);
    this.muzzleFlash.visible = false;
    this.weapon.add(this.muzzleFlash);
    this.muzzleLight = new THREE.PointLight(LIME, 0, 1.3, 2);
    this.muzzleLight.position.set(0, 0.09, -0.44);
    this.weapon.add(this.muzzleLight);
    this.updateWeapon(0, false);
  }

  private buildEffects(): void {
    this.particleMesh = new THREE.InstancedMesh(
      this.geometry(new THREE.TetrahedronGeometry(1)),
      this.material(
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      ),
      96,
    );
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    this.scene.add(this.particleMesh);
    for (let i = 0; i < 96; i += 1) {
      this.particles.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        color: new THREE.Color(LIME),
        life: 0,
        lifetime: 1,
        size: 0.04,
      });
    }
    const geometry = this.geometry(new THREE.RingGeometry(0.85, 1, 40));
    for (let i = 0; i < 8; i += 1) {
      const mesh = new THREE.Mesh(
        geometry,
        this.material(
          new THREE.MeshBasicMaterial({
            color: LIME,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          }),
        ),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.impactRings.push({ mesh, life: 0 });
    }
  }

  private populateTargets(): void {
    this.targetRoot.clear();
    this.targets = [];
    this.hitMeshes = [];
    this.slots = [];
    if (this.config.mode === 'gridshot') {
      for (let row = 0; row < 3; row += 1) {
        for (const x of [-3.6, 0, 3.6])
          this.slots.push(
            new THREE.Vector3(x, 1.8 + row * 1.55, -3.8 - row * 1.05),
          );
      }
    } else if (this.config.mode === 'precision') {
      this.slots = [
        new THREE.Vector3(-5.05, 4.65, -6.8),
        new THREE.Vector3(-4.2, 2, -4.6),
        new THREE.Vector3(-1.8, 2.45, -6.2),
        new THREE.Vector3(1.55, 5.05, -7.2),
        new THREE.Vector3(2.4, 2.05, -4.8),
        new THREE.Vector3(5.1, 3.3, -6.4),
        new THREE.Vector3(-1.9, 5.25, -7),
        new THREE.Vector3(0.1, 3.65, -5.5),
      ];
    } else {
      this.slots = [new THREE.Vector3(0, 3.25, -4)];
    }
    const initial =
      this.config.mode === 'gridshot'
        ? [0, 1, 2, 6, 7, 8]
        : this.config.mode === 'precision'
          ? [0, 2, 3, 5]
          : [0];
    for (const slot of initial) {
      const group = new THREE.Group();
      const sphere = new THREE.Mesh(this.sphereGeometry, this.targetMaterial);
      sphere.castShadow = true;
      group.add(sphere);
      const ring = new THREE.Mesh(this.ringGeometry, this.targetBandMaterial);
      ring.rotation.set(Math.PI / 2, 0.13, 0.16);
      group.add(ring);
      const meridian = new THREE.Mesh(
        this.ringGeometry,
        this.targetBandMaterial,
      );
      meridian.rotation.set(0, Math.PI / 2, -0.28);
      group.add(meridian);
      const pad = new THREE.Group();
      const padRing = new THREE.Mesh(this.padGeometry, this.padMaterial);
      padRing.rotation.x = -Math.PI / 2;
      pad.add(padRing);
      for (const x of [-0.68, 0.68])
        this.box(0.13, 0.006, 0.035, this.padMaterial, x, 0, 0, pad);
      this.targetRoot.add(group, pad);
      const target: Target = {
        group,
        sphere,
        ring,
        pad,
        slot,
        bornAt: 0,
        scale: 1,
      };
      this.targets.push(target);
      this.hitMeshes.push(sphere);
      this.placeTarget(target);
    }
    if (this.config.mode === 'tracking') this.moveTrackingTarget();
    this.targetRoot.updateMatrixWorld(true);
  }

  private targetRadius(): number {
    const size =
      this.config.mode === 'precision'
        ? 0.285
        : this.config.mode === 'tracking'
          ? 0.53
          : 0.5;
    return (
      size *
      (this.config.difficulty === 'easy'
        ? 1.25
        : this.config.difficulty === 'hard'
          ? 0.73
          : 1)
    );
  }

  private placeTarget(target: Target): void {
    target.group.position.copy(this.slots[target.slot]!);
    target.group.scale.setScalar(this.targetRadius() * target.scale);
    target.pad.position.set(
      target.group.position.x,
      0.148,
      target.group.position.z,
    );
  }

  private replenishTarget(target: Target): void {
    const occupied = new Set(this.targets.map((item) => item.slot));
    const available = this.slots
      .map((_, index) => index)
      .filter((index) => !occupied.has(index));
    if (available.length)
      target.slot = available[Math.floor(Math.random() * available.length)]!;
    target.bornAt = this.elapsed;
    target.scale = 0.3;
    this.placeTarget(target);
  }

  private moveTrackingTarget(): void {
    const target = this.targets[0];
    if (!target) return;
    const speed =
      this.config.difficulty === 'easy'
        ? 0.72
        : this.config.difficulty === 'hard'
          ? 1.3
          : 1;
    const t = this.animationTime * speed;
    target.group.position.set(
      Math.sin(t * 0.79) * 4.35 + Math.sin(t * 1.71) * 0.55,
      3.3 + Math.sin(t * 1.23) * 1.45,
      -5.5 + Math.cos(t * 0.67) * 1.4,
    );
    target.pad.position.set(
      target.group.position.x,
      0.148,
      target.group.position.z,
    );
  }

  private spawnImpact(position: THREE.Vector3, tracking: boolean): void {
    for (let i = 0; i < (tracking ? 4 : 13); i += 1) {
      const particle =
        this.particles[this.particleCursor++ % this.particles.length]!;
      particle.position.copy(position);
      particle.velocity.set(
        Math.random() - 0.5,
        Math.random() - 0.25,
        Math.random() - 0.5,
      );
      particle.velocity.normalize().multiplyScalar(1.8 + Math.random() * 2.8);
      particle.lifetime = particle.life = 0.22 + Math.random() * 0.25;
      particle.size = 0.035 + Math.random() * 0.045;
      particle.color.set(i % 4 === 0 ? 0xf2ffd0 : LIME);
    }
    const impact =
      this.impactRings[this.impactCursor++ % this.impactRings.length]!;
    impact.life = tracking ? 0.14 : 0.25;
    impact.mesh.position.copy(position);
    impact.mesh.quaternion.copy(this.camera.quaternion);
    impact.mesh.scale.setScalar(0.16);
    impact.mesh.material.opacity = 0.75;
    impact.mesh.visible = true;
  }

  private updateEffects(dt: number): void {
    let count = 0;
    for (const particle of this.particles) {
      particle.life = Math.max(0, particle.life - dt);
      if (particle.life === 0) continue;
      particle.velocity.y -= dt * 5.2;
      particle.position.addScaledVector(particle.velocity, dt);
      this.dummy.position.copy(particle.position);
      this.dummy.rotation.set(particle.life * 9, particle.life * 7, 0);
      this.dummy.scale.setScalar(
        particle.size * Math.min(1, (particle.life / particle.lifetime) * 2),
      );
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(count, this.dummy.matrix);
      this.particleMesh.setColorAt(count, particle.color);
      count += 1;
    }
    this.particleMesh.count = count;
    if (count) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor)
        this.particleMesh.instanceColor.needsUpdate = true;
    }
    for (const impact of this.impactRings) {
      if (impact.life <= 0) continue;
      impact.life = Math.max(0, impact.life - dt);
      impact.mesh.visible = impact.life > 0;
      impact.mesh.scale.addScalar(dt * 3.4);
      impact.mesh.material.opacity = Math.min(0.7, impact.life * 3);
      impact.mesh.quaternion.copy(this.camera.quaternion);
    }
  }

  private resetEffects(): void {
    for (const particle of this.particles) particle.life = 0;
    this.particleMesh.count = 0;
    for (const impact of this.impactRings) {
      impact.life = 0;
      impact.mesh.visible = false;
    }
    this.recoil = 0;
    this.flashTime = 0;
    this.muzzleFlash.visible = false;
    this.muzzleLight.intensity = 0;
  }

  private resetPlayer(): void {
    this.camera.position.set(0, 1.85, 6.8);
    this.yaw = 0;
    this.pitch = 0.075;
    this.lookSway.set(0, 0);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.updateWeapon(0, false);
  }

  private updatePlayer(dt: number): boolean {
    const forward =
      Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const sideways =
      Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const moving = forward !== 0 || sideways !== 0;
    if (moving) {
      const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const distance =
        (dt * (sprint ? 5.1 : 3.5)) / Math.hypot(forward, sideways);
      this.camera.position.x +=
        (sideways * Math.cos(this.yaw) - forward * Math.sin(this.yaw)) *
        distance;
      this.camera.position.z +=
        (-sideways * Math.sin(this.yaw) - forward * Math.cos(this.yaw)) *
        distance;
      this.camera.position.x = THREE.MathUtils.clamp(
        this.camera.position.x,
        -8.2,
        8.2,
      );
      this.camera.position.z = THREE.MathUtils.clamp(
        this.camera.position.z,
        1.1,
        10.1,
      );
    }
    this.camera.position.y =
      1.85 + (moving ? Math.sin(this.animationTime * 11) * 0.012 : 0);
    return moving;
  }

  private updateWeapon(dt: number, moving: boolean): void {
    this.recoil *= Math.exp(-dt * 18);
    this.lookSway.multiplyScalar(Math.exp(-dt * 12));
    const breath = Math.sin(this.animationTime * 1.7) * 0.002;
    const bob = moving ? Math.sin(this.animationTime * 11) * 0.008 : 0;
    // Anchor in screen space so portrait/fullscreen resizing cannot crop out the gun.
    const horizontal = Math.min(1, this.weaponCamera.aspect / 1.45);
    this.weapon.position.set(
      0.315 * horizontal + this.lookSway.x,
      -0.265 + breath + bob + this.lookSway.y,
      -0.64 + this.recoil * 0.075,
    );
    this.weapon.scale.setScalar(Math.max(0.72, horizontal));
    this.weapon.rotation.set(
      0.025 + this.recoil * 0.15,
      -0.07 - this.lookSway.x * 1.8,
      -0.045 - this.recoil * 0.045,
    );
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.muzzleFlash.visible = this.flashTime > 0;
    this.muzzleFlash.material.opacity =
      this.flashTime > 0 ? 0.45 + this.flashTime * 8 : 0;
    this.muzzleLight.intensity = this.flashTime > 0 ? 1.6 : 0;
  }

  private installInput(): void {
    this.listen(
      this.canvas,
      'pointerdown',
      (event) => this.onPointerDown(event as PointerEvent),
      { passive: false },
    );
    this.listen(
      document,
      'pointermove',
      (event) => this.onPointerMove(event as PointerEvent),
      { passive: false },
    );
    this.listen(document, 'pointerup', (event) =>
      this.onPointerUp(event as PointerEvent),
    );
    this.listen(document, 'pointercancel', (event) => {
      if ((event as PointerEvent).pointerId === this.gesture?.id)
        this.clearInput();
    });
    this.listen(this.canvas, 'lostpointercapture', (event) => {
      if ((event as PointerEvent).pointerId === this.gesture?.id)
        this.clearInput();
    });
    this.listen(this.canvas, 'contextmenu', (event) => {
      if (this.state === 'running' || this.state === 'countdown')
        event.preventDefault();
    });
    this.listen(document, 'pointerlockchange', () => {
      const owned = this.ownsPointerLock;
      this.ownsPointerLock = document.pointerLockElement === this.canvas;
      if (this.ownsPointerLock) {
        if (
          this.destroyed ||
          (this.state !== 'running' && this.state !== 'countdown')
        ) {
          this.releasePointerLock();
        } else {
          this.clearInput();
          this.canvas.focus({ preventScroll: true });
        }
      } else if (
        owned &&
        (this.state === 'running' || this.state === 'countdown')
      ) {
        this.pause();
      }
    });
    this.listen(window, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.code === 'Escape') {
        this.pause();
        return;
      }
      const element = key.target;
      if (
        element instanceof HTMLElement &&
        (element.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(element.tagName))
      )
        return;
      if (this.state !== 'running' && this.state !== 'countdown') return;
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(
          key.code,
        )
      ) {
        key.preventDefault();
        this.keys.add(key.code);
      }
    });
    this.listen(window, 'keyup', (event) =>
      this.keys.delete((event as KeyboardEvent).code),
    );
    this.listen(window, 'blur', () => {
      this.clearInput();
      this.pause();
    });
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.pause();
      this.lastFrameTime = performance.now();
    });
    this.listen(this.canvas, 'webglcontextlost', (event) => {
      event.preventDefault();
      this.pause();
    });
    this.listen(this.canvas, 'webglcontextrestored', () => {
      if (!this.destroyed) this.resize();
    });
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() =>
      target.removeEventListener(type, handler, options),
    );
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.state !== 'running' && this.state !== 'countdown') return;
    // A second touch may aim while the first holds the separate fire button.
    if (
      (!event.isPrimary && event.pointerType !== 'touch') ||
      event.button !== 0 ||
      this.gesture
    )
      return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.unlockAudio();
    const locked = document.pointerLockElement === this.canvas;
    const shotOnDown = locked || this.config.mode === 'tracking';
    this.gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      moved: false,
      shotOnDown,
      touch: event.pointerType === 'touch',
    };
    if (!locked) {
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        /* Pointer capture is optional. */
      }
    }
    this.fireHeld = this.config.mode === 'tracking';
    if (shotOnDown) this.shoot();
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.state !== 'running' && this.state !== 'countdown') return;
    const locked = document.pointerLockElement === this.canvas;
    let dx: number;
    let dy: number;
    let touch = false;
    if (locked) {
      dx = event.movementX;
      dy = event.movementY;
    } else {
      const gesture = this.gesture;
      if (!gesture || event.pointerId !== gesture.id) return;
      event.preventDefault();
      dx = event.clientX - gesture.x;
      dy = event.clientY - gesture.y;
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      gesture.moved ||=
        Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        ) > 7;
      touch = gesture.touch;
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const sensitivity = this.config.sensitivity * (touch ? 0.0032 : 0.002);
    this.yaw -= dx * sensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - dy * sensitivity,
      -1.42,
      1.42,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.lookSway.x = THREE.MathUtils.clamp(
      this.lookSway.x - dx * 0.00012,
      -0.025,
      0.025,
    );
    this.lookSway.y = THREE.MathUtils.clamp(
      this.lookSway.y + dy * 0.0001,
      -0.018,
      0.018,
    );
  }

  private onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    this.gesture = null;
    this.fireHeld = false;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    if (
      !gesture.shotOnDown &&
      !gesture.moved &&
      performance.now() - gesture.startedAt < 500
    )
      this.shoot();
    if (this.trackingAcquired) this.trackingSeekSince = this.elapsed;
    this.trackingAcquired = false;
  }

  private clearInput(): void {
    const gesture = this.gesture;
    this.gesture = null;
    this.keys.clear();
    this.fireHeld = false;
    if (this.trackingAcquired) this.trackingSeekSince = this.elapsed;
    this.trackingAcquired = false;
    if (gesture && this.canvas.hasPointerCapture(gesture.id)) {
      try {
        this.canvas.releasePointerCapture(gesture.id);
      } catch {
        /* The pointer may already have ended. */
      }
    }
  }

  private requestPointerLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    if (
      window.matchMedia?.('(pointer: coarse)').matches ||
      typeof this.canvas.requestPointerLock !== 'function'
    ) {
      this.canvas.focus({ preventScroll: true });
      return;
    }
    try {
      // Both promise-returning and older void-returning browser implementations exist.
      const request = this.canvas.requestPointerLock() as unknown as
        Promise<void> | undefined;
      if (request) {
        void request
          .then(() => {
            if (
              this.destroyed ||
              (this.state !== 'running' && this.state !== 'countdown')
            )
              this.releasePointerLock();
          })
          .catch(() => {});
      }
    } catch {
      // Sandboxed/unsupported pointer lock uses the same drag-and-tap path as touch.
    }
    this.canvas.focus({ preventScroll: true });
  }

  private releasePointerLock(): void {
    this.ownsPointerLock = false;
    if (document.pointerLockElement !== this.canvas) return;
    try {
      document.exitPointerLock();
    } catch {
      /* The document may be detaching. */
    }
  }

  private normalizeConfig(config: ArenaConfig): ArenaConfig {
    return {
      mode: ['gridshot', 'precision', 'tracking'].includes(config.mode)
        ? config.mode
        : 'gridshot',
      difficulty: ['easy', 'normal', 'hard'].includes(config.difficulty)
        ? config.difficulty
        : 'normal',
      duration: Number.isFinite(config.duration)
        ? THREE.MathUtils.clamp(config.duration, 1, 3600)
        : 60,
      sensitivity: Number.isFinite(config.sensitivity)
        ? THREE.MathUtils.clamp(config.sensitivity, 0.05, 10)
        : 1,
      sound: Boolean(config.sound),
      crosshair: ['cross', 'dot', 'circle'].includes(config.crosshair)
        ? config.crosshair
        : 'cross',
    };
  }

  private emptyStats(duration: number): ArenaStats {
    return {
      score: 0,
      hits: 0,
      shots: 0,
      combo: 0,
      bestCombo: 0,
      accuracy: 0,
      timeLeft: duration,
      reactionTime: 0,
    };
  }

  private emitStats(): void {
    if (this.destroyed) return;
    this.lastStatsTime = performance.now();
    this.callbacks.onStats({ ...this.stats });
  }

  private finish(): void {
    if (this.state !== 'running') return;
    this.stats.timeLeft = 0;
    const result: SessionResult = {
      ...this.stats,
      mode: this.config.mode,
      duration: this.config.duration,
      difficulty: this.config.difficulty,
    };
    // Change state before unlocking; pointerlockchange must not turn a finish into a pause.
    this.state = 'finished';
    this.clearInput();
    this.canvas.style.cursor = 'default';
    this.releasePointerLock();
    this.playSound('finish');
    this.emitStats();
    if (this.destroyed) return;
    this.callbacks.onState('finished');
    if (!this.destroyed) this.callbacks.onFinish(result);
  }

  private readonly tick = (now: number): void => {
    if (this.destroyed) return;
    this.frame = requestAnimationFrame(this.tick);
    const elapsedFrame = Math.max(0, (now - this.lastFrameTime) / 1000);
    const dt = Math.min(0.05, elapsedFrame);
    this.lastFrameTime = now;
    if (document.hidden) return;

    if (this.state === 'countdown') {
      this.countdownRemaining = Math.max(
        0,
        this.countdownRemaining - elapsedFrame,
      );
      const next = Math.ceil(this.countdownRemaining);
      while (
        this.countdownValue > next &&
        this.state === 'countdown' &&
        !this.destroyed
      ) {
        this.countdownValue -= 1;
        this.callbacks.onCountdown(this.countdownValue);
        this.playSound(this.countdownValue === 0 ? 'hit' : 'countdown');
      }
      if (
        !this.destroyed &&
        this.state === 'countdown' &&
        this.countdownRemaining === 0
      ) {
        this.clearInput();
        this.state = 'running';
        this.callbacks.onState('running');
      }
    } else if (this.state === 'running') {
      // Session time uses real elapsed time, not the capped physics step.
      this.elapsed = Math.min(
        this.config.duration,
        this.elapsed + elapsedFrame,
      );
      this.stats.timeLeft = Math.max(0, this.config.duration - this.elapsed);
      if (this.stats.timeLeft === 0) this.finish();
    }
    if (this.destroyed) return;

    let moving = false;
    if (this.state === 'running' || this.state === 'idle') {
      this.animationTime =
        this.state === 'running' ? this.elapsed : this.animationTime + dt;
      if (this.state === 'running') moving = this.updatePlayer(dt);
      if (this.config.mode === 'tracking') this.moveTrackingTarget();
      for (const target of this.targets) {
        target.scale += (1 - target.scale) * (1 - Math.exp(-dt * 28));
        target.group.scale.setScalar(this.targetRadius() * target.scale);
        target.ring.rotation.z =
          0.16 + Math.sin(this.animationTime * 0.65 + target.slot) * 0.13;
      }
      this.targetMaterial.emissiveIntensity =
        0.32 + Math.sin(this.animationTime * 2) * 0.035;
      if (
        this.state === 'running' &&
        this.fireHeld &&
        this.config.mode === 'tracking'
      )
        this.shoot();
    }
    if (this.destroyed) return;
    if (this.state !== 'paused') {
      this.updateEffects(dt);
      this.updateWeapon(dt, moving);
    }
    if (this.state === 'running' && now - this.lastStatsTime >= 100)
      this.emitStats();
    if (!this.destroyed) this.render();
  };

  private resize(): void {
    if (this.destroyed) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.round(rect.width || this.container.clientWidth || 850),
    );
    const height = Math.max(
      1,
      Math.round(rect.height || this.container.clientHeight || 480),
    );
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = Math.min(
      100,
      THREE.MathUtils.radToDeg(
        2 *
          Math.atan(
            Math.tan(THREE.MathUtils.degToRad(62) / 2) *
              Math.max(1, 1.15 / aspect),
          ),
      ),
    );
    this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = aspect;
    this.weaponCamera.updateProjectionMatrix();
    this.updateWeapon(0, false);
    this.render();
  }

  private render(): void {
    if (this.destroyed || this.renderer.getContext().isContextLost()) return;
    if (!this.container.offsetWidth || !this.container.offsetHeight) return;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    // A separate depth pass keeps the view model crisp and prevents wall clipping.
    this.renderer.clearDepth();
    this.renderer.render(this.weaponScene, this.weaponCamera);
  }

  private unlockAudio(): void {
    if (this.destroyed || this.muted || !this.config.sound) return;
    try {
      if (!this.audio) {
        const AudioContextClass =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioContextClass) return;
        this.audio = new AudioContextClass();
        this.masterGain = this.audio.createGain();
        this.masterGain.gain.value = 0.065;
        this.masterGain.connect(this.audio.destination);
      }
      if (this.audio.state === 'suspended')
        void this.audio.resume().catch(() => {});
    } catch {
      // Audio must never prevent a session in restricted browser environments.
    }
  }

  private updateAudioGain(): void {
    if (!this.audio || !this.masterGain || this.audio.state === 'closed')
      return;
    this.masterGain.gain.setTargetAtTime(
      this.muted || !this.config.sound ? 0 : 0.065,
      this.audio.currentTime,
      0.015,
    );
  }

  private playSound(kind: 'fire' | 'hit' | 'countdown' | 'finish'): void {
    const audio = this.audio;
    if (
      this.destroyed ||
      this.muted ||
      !this.config.sound ||
      !audio ||
      !this.masterGain ||
      audio.state !== 'running'
    )
      return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    const duration = kind === 'fire' ? 0.055 : kind === 'finish' ? 0.24 : 0.095;
    const frequency =
      kind === 'fire'
        ? 165
        : kind === 'hit'
          ? 880
          : kind === 'finish'
            ? 660
            : 420;
    oscillator.type = kind === 'fire' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === 'fire' ? 65 : frequency * 1.45,
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      kind === 'fire' ? 0.24 : 0.19,
      now + 0.006,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.015);
  }
}
