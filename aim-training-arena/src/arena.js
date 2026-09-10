import * as THREE from "three";

const DEFAULTS = {
  preview: false,
  mode: "gridshot",
  duration: 60,
  sensitivity: 1,
  targetSize: 1,
  sound: true,
  reducedMotion: false,
};

const MODES = ["gridshot", "microflick", "tracking"];
const DURATIONS = [30, 60, 90];
const TICK_SECONDS = 0.1;
const clamp = THREE.MathUtils.clamp;

function normalizeOptions(previous, partial) {
  const next = { ...previous, ...partial };
  next.mode = MODES.includes(next.mode) ? next.mode : DEFAULTS.mode;
  next.duration = DURATIONS.includes(Number(next.duration))
    ? Number(next.duration)
    : 60;
  next.sensitivity = Number.isFinite(Number(next.sensitivity))
    ? clamp(Number(next.sensitivity), 0.05, 10)
    : 1;
  next.targetSize = Number.isFinite(Number(next.targetSize))
    ? clamp(Number(next.targetSize), 0.35, 2)
    : 1;
  next.preview = Boolean(next.preview);
  next.sound = Boolean(next.sound);
  return next;
}

/**
 * Owns the canvas, but not the crosshair or surrounding UI.
 * setMove(x, y): positive x strafes right; positive y moves forward.
 * stop() finishes the current session early. Mode/duration changes apply next start.
 * lastHitTime is an epoch timestamp; hitFlash/missFlash are session counters.
 */
export function createArena(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("createArena requires a canvas element.");
  }

  let settings = normalizeOptions(DEFAULTS, options);
  const doc = canvas.ownerDocument;
  const win = doc.defaultView || window;
  const clock = () => win.performance.now();
  const originalTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#081610");
  scene.fog = new THREE.FogExp2("#0a1c15", 0.024);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 85);
  camera.rotation.order = "YXZ";
  const raycaster = new THREE.Raycaster();
  const center = new THREE.Vector2(0, 0);
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const vector = new THREE.Vector3();
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const listeners = [];
  const targets = [];
  const effects = [];
  const keys = new Set();
  const fireSources = new Set();
  const movement = new THREE.Vector2();
  let disposed = false;
  let raf = 0;
  let lastStep = clock();
  let lastFrame = lastStep;
  let lastUpdate = -Infinity;
  let dirty = true;
  let yaw = 0;
  let pitch = 0;
  let pointerLocked = doc.pointerLockElement === canvas;
  let lockPending = false;
  let drag = null;
  let sessionMode = settings.mode;
  let sessionDuration = settings.duration;
  let countdownLeft = 3;
  let pausedPhase = "running";
  let trackingRemainder = 0;
  let trackingAcquired = false;
  let acquisitionStarted = 0;
  let reactionTotal = 0;
  let reactionSamples = 0;
  let nextHistorySecond = 1;
  let history = [];
  let audio = null;
  let audioGain = null;
  let stats = freshStats();

  function freshStats() {
    return {
      score: 0,
      hits: 0,
      shots: 0,
      accuracy: 0,
      timeLeft: settings.duration,
      elapsed: 0,
      combo: 0,
      bestCombo: 0,
      reactionTime: 0,
      phase: "ready",
      countdown: 0,
      lastHit: null,
      lastHitTime: 0,
      hitFlash: 0,
      missFlash: 0,
    };
  }

  function notify(name, value) {
    if (disposed || settings.preview || typeof settings[name] !== "function")
      return;
    try {
      settings[name](value);
    } catch (error) {
      // A UI callback must not stop the render loop or corrupt session timing.
      console.error(`Arena ${name} callback failed:`, error);
    }
  }

  function emitUpdate(now) {
    if (!dirty || now - lastUpdate < 100 || settings.preview || disposed)
      return;
    dirty = false;
    lastUpdate = now;
    notify("onUpdate", { ...stats });
  }

  function geometry(value) {
    geometries.add(value);
    return value;
  }

  function material(value) {
    materials.add(value);
    return value;
  }

  const boxGeometry = geometry(new THREE.BoxGeometry(1, 1, 1));
  const floorMaterial = material(
    new THREE.MeshStandardMaterial({
      color: "#142820",
      roughness: 0.77,
      metalness: 0.22,
    }),
  );
  const wallMaterial = material(
    new THREE.MeshStandardMaterial({
      color: "#152d23",
      roughness: 0.86,
      metalness: 0.12,
    }),
  );
  const panelMaterial = material(
    new THREE.MeshStandardMaterial({
      color: "#0d2119",
      roughness: 0.72,
      metalness: 0.28,
    }),
  );
  const trimMaterial = material(
    new THREE.MeshStandardMaterial({
      color: "#294539",
      roughness: 0.42,
      metalness: 0.65,
    }),
  );
  const railMaterial = material(
    new THREE.MeshBasicMaterial({ color: "#8dd8a5" }),
  );
  const dimRailMaterial = material(
    new THREE.MeshBasicMaterial({ color: "#315c46" }),
  );

  function box(x, y, z, width, height, depth, surface, shadow = false) {
    const mesh = new THREE.Mesh(boxGeometry, surface);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    mesh.receiveShadow = shadow;
    scene.add(mesh);
    return mesh;
  }

  // Restrained emissive geometry keeps the range crisp without a costly bloom pass.
  box(0, -0.17, -10, 24, 0.3, 44, floorMaterial, true);
  box(-12, 4.5, -10, 0.3, 9, 44, wallMaterial, true);
  box(12, 4.5, -10, 0.3, 9, 44, wallMaterial, true);
  box(0, 4.5, -28, 24, 9, 0.3, wallMaterial, true);
  box(0, 9, -10, 24, 0.2, 44, panelMaterial);
  box(0, 3.9, -27.75, 21.8, 6.8, 0.18, panelMaterial);

  const gridVertices = [];
  for (let x = -12; x <= 12; x += 1.5) {
    gridVertices.push(x, 0.004, 11, x, 0.004, -28);
  }
  for (let z = -28; z <= 11; z += 1.5) {
    gridVertices.push(-12, 0.004, z, 12, 0.004, z);
  }
  const gridGeometry = geometry(new THREE.BufferGeometry());
  gridGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(gridVertices, 3),
  );
  const grid = new THREE.LineSegments(
    gridGeometry,
    material(
      new THREE.LineBasicMaterial({
        color: "#4e6b59",
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    ),
  );
  scene.add(grid);

  for (const side of [-1, 1]) {
    box(side * 9.4, 0.025, -9, 0.042, 0.022, 38, railMaterial);
    box(side * 9.65, 0.02, -9, 0.016, 0.02, 38, dimRailMaterial);
    box(side * 11.8, 0.48, -10, 0.07, 0.045, 35, railMaterial);
    box(side * 11.8, 6.8, -10, 0.06, 0.035, 35, dimRailMaterial);
    for (let z = 7; z > -28; z -= 5) {
      box(side * 11.74, 3.7, z, 0.15, 6.25, 0.12, trimMaterial);
      box(side * 11.65, 3.45, z - 2.35, 0.07, 4.8, 4.35, panelMaterial);
      box(side * 11.59, 5.96, z - 2.35, 0.025, 0.025, 3.8, dimRailMaterial);
      box(side * 9.1, 0.018, z, 0.3, 0.025, 0.055, railMaterial);
    }
  }

  for (let x = -9; x <= 9; x += 4.5) {
    box(x, 3.9, -27.58, 0.026, 6.25, 0.025, dimRailMaterial);
    box(x, 0.035, -25, 0.038, 0.025, 4, dimRailMaterial);
    for (let y = 1.7; y < 7; y += 1.4) {
      box(x, y, -27.54, 0.2, 0.015, 0.02, trimMaterial);
      box(x, y, -27.54, 0.015, 0.2, 0.02, trimMaterial);
    }
  }
  for (const y of [0.75, 7.05]) {
    box(0, y, -27.5, 20.8, 0.025, 0.025, dimRailMaterial);
    for (const x of [-10.4, 10.4]) {
      box(x, y, -27.46, 0.7, 0.04, 0.025, railMaterial);
      box(
        x,
        y + (y < 1 ? 0.23 : -0.23),
        -27.46,
        0.035,
        0.48,
        0.025,
        railMaterial,
      );
    }
  }
  for (let z = 3; z > -28; z -= 7) {
    box(0, 8.7, z, 23.8, 0.28, 0.2, trimMaterial);
    box(-7.6, 8.53, z, 3.3, 0.028, 0.13, railMaterial);
    box(7.6, 8.53, z, 3.3, 0.028, 0.13, railMaterial);
  }
  box(0, 0.022, 3, 16, 0.024, 0.04, dimRailMaterial);
  box(0, 0.023, -5.5, 16, 0.022, 0.025, dimRailMaterial);

  scene.add(new THREE.HemisphereLight("#d2eacb", "#132c23", 1.8));
  const keyLight = new THREE.DirectionalLight("#e4ffcf", 3.1);
  keyLight.position.set(-5, 11, 3);
  keyLight.target.position.set(0, 1, -12);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  Object.assign(keyLight.shadow.camera, {
    left: -15,
    right: 15,
    top: 18,
    bottom: -18,
    near: 0.5,
    far: 55,
  });
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.04;
  keyLight.shadow.radius = 3;
  scene.add(keyLight, keyLight.target);
  const fillLight = new THREE.PointLight("#75dda2", 55, 30, 2);
  fillLight.position.set(7, 5, -13);
  scene.add(fillLight);
  const backLight = new THREE.PointLight("#b0d982", 45, 26, 2);
  backLight.position.set(-7, 6, -23);
  scene.add(backLight);

  const glowData = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const radius = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5);
      const index = (y * 64 + x) * 4;
      glowData[index] = 190;
      glowData[index + 1] = 255;
      glowData[index + 2] = 155;
      glowData[index + 3] = Math.round(
        Math.pow(Math.max(0, 1 - radius), 2.8) * 180,
      );
    }
  }
  const glowTexture = new THREE.DataTexture(glowData, 64, 64);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  glowTexture.magFilter = THREE.LinearFilter;
  glowTexture.minFilter = THREE.LinearFilter;
  glowTexture.needsUpdate = true;
  textures.add(glowTexture);
  const sphereGeometry = geometry(new THREE.SphereGeometry(0.5, 40, 28));
  const outerRingGeometry = geometry(
    new THREE.TorusGeometry(0.39, 0.015, 8, 64),
  );
  const innerRingGeometry = geometry(
    new THREE.TorusGeometry(0.245, 0.012, 8, 56),
  );
  const haloGeometry = geometry(new THREE.TorusGeometry(0.542, 0.006, 6, 64));
  const dotGeometry = geometry(new THREE.CircleGeometry(0.055, 24));
  const shadowGeometry = geometry(new THREE.CircleGeometry(0.7, 32));
  const popGeometry = geometry(new THREE.RingGeometry(0.47, 0.5, 48));
  const ringMaterial = material(
    new THREE.MeshStandardMaterial({
      color: "#1b4328",
      roughness: 0.57,
      metalness: 0.3,
    }),
  );
  const haloMaterial = material(
    new THREE.MeshBasicMaterial({
      color: "#b7ef8b",
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
  );
  const glowMaterial = material(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: "#c7ffb2",
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const shadowMaterial = material(
    new THREE.MeshBasicMaterial({
      color: "#07120c",
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    }),
  );

  for (let index = 0; index < 4; index++) {
    const group = new THREE.Group();
    const surface = material(
      new THREE.MeshStandardMaterial({
        color: "#c8f78a",
        emissive: "#8bd45b",
        emissiveIntensity: 0.26,
        roughness: 0.29,
        metalness: 0.15,
      }),
    );
    const sphere = new THREE.Mesh(sphereGeometry, surface);
    sphere.castShadow = true;
    const outerRing = new THREE.Mesh(outerRingGeometry, ringMaterial);
    outerRing.position.z = Math.sqrt(0.25 - 0.39 ** 2);
    const innerRing = new THREE.Mesh(innerRingGeometry, ringMaterial);
    innerRing.position.z = Math.sqrt(0.25 - 0.245 ** 2);
    const dot = new THREE.Mesh(dotGeometry, ringMaterial);
    dot.position.z = 0.501;
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.setScalar(2.75);
    group.add(sphere, outerRing, innerRing, dot, halo, glow);
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    scene.add(group, shadow);
    const target = {
      group,
      sphere,
      surface,
      shadow,
      index,
      cell: -1,
      spawnedAt: 0,
      born: lastStep - 1000,
      flashUntil: 0,
      base: new THREE.Vector3(),
      active: false,
    };
    sphere.userData.target = target;
    targets.push(target);
  }

  function targetScale() {
    return (
      settings.targetSize *
      (settings.preview ? 1.45 : sessionMode === "microflick" ? 0.54 : 1)
    );
  }

  function positionPreview() {
    // Screen-space anchors keep the hero's left half clear, including narrow layouts.
    const anchors = [
      [0.2, 0.34, 17],
      [0.69, 0.13, 20],
      [0.4, -0.28, 16],
      [0.79, 0.49, 23],
    ];
    camera.updateMatrixWorld();
    targets.forEach((target, index) => {
      const [x, y, distance] = anchors[index];
      vector.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      target.base.copy(camera.position).addScaledVector(vector, distance);
      target.base.x = Math.min(target.base.x, 10.3);
      target.base.y = clamp(target.base.y, 0.85, 7.7);
      target.group.position.copy(target.base);
    });
  }

  function configureCamera() {
    yaw = 0;
    pitch = 0;
    if (settings.preview) {
      camera.position.set(-3, 2.1, 6);
      camera.lookAt(2, 2.9, -15);
    } else {
      camera.position.set(0, 1.7, 6);
      camera.rotation.set(0, 0, 0, "YXZ");
    }
    camera.updateMatrixWorld();
  }

  function spawn(target, now = clock()) {
    target.spawnedAt = stats.elapsed;
    target.born = now;
    target.flashUntil = 0;
    if (sessionMode === "gridshot") {
      const occupied = new Set(
        targets
          .filter((other) => other !== target && other.active)
          .map((other) => other.cell),
      );
      const available = [];
      for (let cell = 0; cell < 15; cell++) {
        if (!occupied.has(cell) && cell !== target.cell) available.push(cell);
      }
      target.cell = available[Math.floor(Math.random() * available.length)];
      target.group.position.set(
        ((target.cell % 5) - 2) * 2.45,
        1.2 + Math.floor(target.cell / 5) * 2.1,
        -10,
      );
    } else if (sessionMode === "microflick") {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.6 + Math.random() * 1.45;
      target.group.position.set(
        Math.cos(angle) * radius,
        1.7 + Math.sin(angle) * radius * 0.55,
        -10,
      );
    } else {
      target.group.position.set(0, 2.6, -10);
    }
    target.base.copy(target.group.position);
    target.group.scale.setScalar(targetScale());
  }

  function resetTargets(now = clock()) {
    const count = settings.preview ? 4 : sessionMode === "gridshot" ? 3 : 1;
    for (const target of targets) {
      target.cell = -1;
      target.active = target.index < count;
      target.group.visible = target.active;
      target.shadow.visible = target.active;
    }
    for (const target of targets) {
      if (target.active) spawn(target, now - 1000);
    }
    if (settings.preview) positionPreview();
    updateTargets(now);
  }

  function updateTargets(now) {
    for (const target of targets) {
      if (!target.active) continue;
      if (settings.preview) {
        const drift = settings.reducedMotion
          ? 0
          : Math.sin(now * 0.00065 + target.index * 2) * 0.09;
        target.group.position.copy(target.base);
        target.group.position.y += drift;
      } else if (sessionMode === "tracking") {
        const time = stats.elapsed;
        target.group.position.set(
          Math.sin(time * 0.79) * 3.65 + Math.sin(time * 1.71) * 0.6,
          2.6 + Math.sin(time * 1.13) * 1.1,
          -10 + Math.sin(time * 0.43) * 1.3,
        );
      }
      const age = clamp((now - target.born) / 170, 0, 1);
      const pop = 1 - (1 - age) ** 3;
      const flash = now < target.flashUntil;
      target.group.scale.setScalar(
        targetScale() * (0.35 + pop * 0.65) * (flash ? 1.045 : 1),
      );
      target.surface.emissiveIntensity = flash ? 0.8 : 0.26;
      target.group.lookAt(camera.position);
      target.shadow.position.set(
        target.group.position.x,
        0.012,
        target.group.position.z,
      );
      const shadowSize = targetScale() * (1 + target.group.position.y * 0.12);
      target.shadow.scale.set(shadowSize, shadowSize * 0.7, 1);
    }
  }

  function clearEffects() {
    for (const effect of effects) {
      scene.remove(effect.object);
      effect.object.material.dispose();
      if (effect.ownGeometry) effect.object.geometry.dispose();
    }
    effects.length = 0;
  }

  function feedback(hit, target, point, now) {
    const lineGeometry = new THREE.BufferGeometry();
    camera.getWorldDirection(direction);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    const startPoint = camera.position
      .clone()
      .addScaledVector(direction, 0.65)
      .addScaledVector(right, 0.13)
      .addScaledVector(up, -0.1);
    lineGeometry.setFromPoints([startPoint, point]);
    const line = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: hit ? "#d3ffae" : "#9aaf9c",
        transparent: true,
        opacity: hit ? 0.5 : 0.18,
        depthWrite: false,
      }),
    );
    scene.add(line);
    effects.push({
      object: line,
      born: now,
      lifetime: 85,
      opacity: hit ? 0.5 : 0.18,
      ownGeometry: true,
    });
    if (hit) {
      const pop = new THREE.Mesh(
        popGeometry,
        new THREE.MeshBasicMaterial({
          color: "#c9ff9c",
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      pop.position.copy(target.group.position);
      pop.quaternion.copy(target.group.quaternion);
      pop.scale.setScalar(targetScale());
      scene.add(pop);
      effects.push({
        object: pop,
        born: now,
        lifetime: 220,
        opacity: 0.7,
        scale: targetScale(),
        ownGeometry: false,
      });
    }
  }

  function updateEffects(now) {
    for (let index = effects.length - 1; index >= 0; index--) {
      const effect = effects[index];
      const progress = (now - effect.born) / effect.lifetime;
      if (progress >= 1) {
        scene.remove(effect.object);
        effect.object.material.dispose();
        if (effect.ownGeometry) effect.object.geometry.dispose();
        effects.splice(index, 1);
      } else {
        effect.object.material.opacity = effect.opacity * (1 - progress) ** 2;
        if (effect.scale)
          effect.object.scale.setScalar(effect.scale * (1 + progress * 1.4));
      }
    }
  }

  function unlockAudio() {
    if (!settings.sound || settings.preview || disposed) return;
    try {
      const AudioContext = win.AudioContext || win.webkitAudioContext;
      if (!AudioContext) return;
      if (!audio) {
        audio = new AudioContext();
        audioGain = audio.createGain();
        audioGain.gain.value = 0.13;
        audioGain.connect(audio.destination);
      }
      if (audio.state === "suspended") audio.resume().catch(() => {});
    } catch {
      // Audio is optional on browsers with restrictive autoplay policies.
    }
  }

  function sound(hit) {
    if (
      !settings.sound ||
      settings.preview ||
      !audio ||
      audio.state !== "running"
    )
      return;
    try {
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      const now = audio.currentTime;
      oscillator.type = hit ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(
        hit ? 980 + Math.min(stats.combo, 20) * 16 : 145,
        now,
      );
      oscillator.frequency.exponentialRampToValueAtTime(
        hit ? 510 : 85,
        now + 0.065,
      );
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(hit ? 0.7 : 0.3, now + 0.004);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      oscillator.connect(envelope);
      envelope.connect(audioGain);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(now);
      oscillator.stop(now + 0.1);
    } catch {
      // A closed/suspended audio device should never interrupt a session.
    }
  }

  function recordHistory(time) {
    const point = { time, accuracy: stats.accuracy, score: stats.score };
    if (
      history.length &&
      Math.abs(history[history.length - 1].time - time) < 0.000001
    ) {
      history[history.length - 1] = point;
    } else {
      history.push(point);
    }
  }

  function takeShot(now) {
    if (stats.phase !== "running" || settings.preview || disposed) return false;
    updateTargets(now);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    raycaster.setFromCamera(center, camera);
    const intersections = raycaster.intersectObjects(
      targets.filter((target) => target.active).map((target) => target.sphere),
      false,
    );
    const intersection = intersections[0];
    const hit = Boolean(intersection);
    const target = intersection?.object.userData.target;
    stats.shots++;
    stats.lastHit = hit;
    stats.lastHitTime = Date.now();
    if (hit) {
      stats.hits++;
      stats.combo++;
      stats.bestCombo = Math.max(stats.bestCombo, stats.combo);
      const multiplier =
        1 + Math.min(4, Math.floor((stats.combo - 1) / 10)) * 0.25;
      stats.score += Math.round(
        (sessionMode === "tracking" ? 10 : 100) * multiplier,
      );
      stats.hitFlash++;
      if (sessionMode !== "tracking" || !trackingAcquired) {
        reactionTotal +=
          Math.max(
            0,
            stats.elapsed -
              (sessionMode === "tracking"
                ? acquisitionStarted
                : target.spawnedAt),
          ) * 1000;
        reactionSamples++;
        stats.reactionTime = Math.round(reactionTotal / reactionSamples);
      }
      trackingAcquired = true;
      target.flashUntil = now + 75;
    } else {
      stats.combo = 0;
      stats.missFlash++;
      if (trackingAcquired) acquisitionStarted = stats.elapsed;
      trackingAcquired = false;
    }
    stats.accuracy = (stats.hits / stats.shots) * 100;
    const point = intersection
      ? intersection.point
      : raycaster.ray.at(26, new THREE.Vector3());
    feedback(hit, target, point, now);
    sound(hit);
    if (hit && sessionMode !== "tracking") spawn(target, now);
    dirty = true;
    return hit;
  }

  function clearInput() {
    keys.clear();
    fireSources.clear();
    movement.set(0, 0);
    trackingRemainder = 0;
    if (drag && canvas.hasPointerCapture?.(drag.id)) {
      try {
        canvas.releasePointerCapture(drag.id);
      } catch {
        /* Already released. */
      }
    }
    drag = null;
  }

  function releaseLock() {
    if (doc.pointerLockElement !== canvas) return;
    try {
      const exit = doc.exitPointerLock?.();
      exit?.catch?.(() => {});
    } catch {
      /* Pointer lock may have been revoked by the browser. */
    }
  }

  function finish() {
    if (
      stats.phase === "finished" ||
      stats.phase === "ready" ||
      disposed ||
      settings.preview
    )
      return;
    // Set the terminal phase before releasing lock; the ensuing event is not a pause.
    stats.phase = "finished";
    stats.countdown = 0;
    stats.timeLeft = Math.max(0, sessionDuration - stats.elapsed);
    clearInput();
    recordHistory(stats.elapsed);
    dirty = true;
    const result = {
      ...stats,
      mode: sessionMode,
      duration: sessionDuration,
      date: new Date().toISOString(),
      id:
        win.crypto?.randomUUID?.() ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`,
      history: history.map((point) => ({ ...point })),
    };
    releaseLock();
    notify("onFinish", result);
  }

  function moveCamera(delta) {
    let x = movement.x + Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
    let y = movement.y + Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    const distance = Math.min(delta, 0.1) * 3.6;
    camera.position.x = clamp(
      camera.position.x + (x * Math.cos(yaw) - y * Math.sin(yaw)) * distance,
      -5.8,
      5.8,
    );
    camera.position.z = clamp(
      camera.position.z + (-x * Math.sin(yaw) - y * Math.cos(yaw)) * distance,
      1,
      9,
    );
    camera.position.y = 1.7;
    const horizontal =
      Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
    const vertical =
      Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp"));
    if (horizontal || vertical)
      look(horizontal * delta * 520, vertical * delta * 520);
    camera.updateMatrixWorld();
  }

  function advance(now) {
    // RAF timestamps can precede an input event processed in the same frame.
    now = Math.max(now, lastStep);
    let delta = Math.max(0, (now - lastStep) / 1000);
    lastStep = now;
    if (settings.preview || disposed) return;
    if (stats.phase === "countdown") {
      countdownLeft -= delta;
      if (countdownLeft > 0) {
        const countdown = Math.ceil(countdownLeft);
        if (stats.countdown !== countdown) {
          stats.countdown = countdown;
          dirty = true;
        }
        return;
      }
      delta = Math.max(0, -countdownLeft);
      stats.phase = "running";
      stats.countdown = 0;
      dirty = true;
    }
    if (stats.phase !== "running") return;
    const runningDelta = Math.min(delta, sessionDuration - stats.elapsed);
    const end = Math.min(sessionDuration, stats.elapsed + runningDelta);
    moveCamera(runningDelta);

    // Sample held tracking at fixed 100 ms boundaries, independent of display FPS.
    if (sessionMode === "tracking" && fireSources.size) {
      let remaining = runningDelta;
      while (trackingRemainder + remaining >= TICK_SECONDS - 0.0000001) {
        const step = Math.max(0, TICK_SECONDS - trackingRemainder);
        stats.elapsed = Math.min(end, stats.elapsed + step);
        remaining = Math.max(0, remaining - step);
        trackingRemainder = 0;
        while (nextHistorySecond < stats.elapsed)
          recordHistory(nextHistorySecond++);
        takeShot(now);
        while (nextHistorySecond <= stats.elapsed)
          recordHistory(nextHistorySecond++);
      }
      trackingRemainder += remaining;
    } else {
      trackingRemainder = 0;
    }
    stats.elapsed = end;
    stats.timeLeft = Math.max(0, sessionDuration - end);
    while (nextHistorySecond <= end) recordHistory(nextHistorySecond++);
    dirty = true;
    if (end >= sessionDuration) finish();
  }

  function requestLock() {
    if (disposed || settings.preview) return Promise.resolve(false);
    unlockAudio();
    canvas.focus({ preventScroll: true });
    // Touch controls need normal pointer targeting, even on lock-capable tablets.
    if (win.matchMedia?.("(pointer: coarse)").matches)
      return Promise.resolve(false);
    if (doc.pointerLockElement === canvas) return Promise.resolve(true);
    if (lockPending || typeof canvas.requestPointerLock !== "function")
      return Promise.resolve(false);
    lockPending = true;
    try {
      const request = canvas.requestPointerLock();
      if (request?.then) {
        return request
          .then(() => {
            lockPending = false;
            if (
              disposed ||
              settings.preview ||
              stats.phase === "paused" ||
              stats.phase === "finished"
            )
              releaseLock();
            return !disposed && doc.pointerLockElement === canvas;
          })
          .catch(() => {
            lockPending = false;
            return false;
          });
      }
      // Older browsers signal completion solely through pointerlockchange/error.
      return Promise.resolve(doc.pointerLockElement === canvas);
    } catch {
      lockPending = false;
      return Promise.resolve(false);
    }
  }

  function start() {
    if (disposed || settings.preview) return;
    clearInput();
    clearEffects();
    sessionMode = settings.mode;
    sessionDuration = settings.duration;
    stats = freshStats();
    stats.phase = "countdown";
    stats.countdown = 3;
    countdownLeft = 3;
    pausedPhase = "running";
    reactionTotal = 0;
    reactionSamples = 0;
    trackingAcquired = false;
    acquisitionStarted = 0;
    nextHistorySecond = 1;
    history = [{ time: 0, accuracy: 0, score: 0 }];
    const now = clock();
    lastStep = now;
    configureCamera();
    resetTargets(now);
    dirty = true;
    requestLock();
    emitUpdate(now);
  }

  function pause() {
    if (
      disposed ||
      settings.preview ||
      !["countdown", "running"].includes(stats.phase)
    )
      return;
    const now = clock();
    advance(now);
    if (!["countdown", "running"].includes(stats.phase)) return;
    pausedPhase = stats.phase;
    stats.phase = "paused";
    clearInput();
    dirty = true;
    releaseLock();
    notify("onPause");
    emitUpdate(now);
  }

  function resume() {
    if (disposed || settings.preview || stats.phase !== "paused") return;
    clearInput();
    lastStep = clock();
    stats.phase = pausedPhase;
    dirty = true;
    requestLock();
    emitUpdate(lastStep);
  }

  function stop() {
    if (disposed || settings.preview) return;
    const now = clock();
    advance(now);
    finish();
    emitUpdate(now);
  }

  function look(dx, dy) {
    if (
      disposed ||
      settings.preview ||
      !["running", "countdown"].includes(stats.phase)
    )
      return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    yaw -= dx * 0.002 * settings.sensitivity;
    yaw = THREE.MathUtils.euclideanModulo(yaw + Math.PI, Math.PI * 2) - Math.PI;
    pitch = clamp(
      pitch - dy * 0.002 * settings.sensitivity,
      -Math.PI * 0.445,
      Math.PI * 0.445,
    );
    camera.rotation.set(pitch, yaw, 0, "YXZ");
    camera.updateMatrixWorld();
  }

  function shoot() {
    if (disposed || settings.preview) return false;
    unlockAudio();
    const now = clock();
    advance(now);
    const hit = takeShot(now);
    emitUpdate(now);
    return hit;
  }

  function setMove(x, y) {
    if (
      disposed ||
      settings.preview ||
      !["running", "countdown"].includes(stats.phase)
    )
      return;
    movement.set(
      Number.isFinite(x) ? clamp(x, -1, 1) : 0,
      Number.isFinite(y) ? clamp(y, -1, 1) : 0,
    );
  }

  function resize() {
    if (disposed) return;
    const parent = canvas.parentElement;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.round(
        rect.width ||
          parent?.clientWidth ||
          canvas.clientWidth ||
          win.innerWidth,
      ),
    );
    const height = Math.max(
      1,
      Math.round(
        rect.height ||
          parent?.clientHeight ||
          canvas.clientHeight ||
          win.innerHeight,
      ),
    );
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (settings.preview) positionPreview();
  }

  function setOptions(partial = {}) {
    if (disposed) return;
    const wasPreview = settings.preview;
    settings = normalizeOptions(settings, partial);
    if (audioGain && audio)
      audioGain.gain.setTargetAtTime(
        settings.sound && !settings.preview ? 0.13 : 0,
        audio.currentTime,
        0.015,
      );
    if (wasPreview !== settings.preview) {
      clearInput();
      clearEffects();
      stats = freshStats();
      sessionMode = settings.mode;
      sessionDuration = settings.duration;
      history = [];
      lastStep = clock();
      releaseLock();
      configureCamera();
      resetTargets();
    } else if (stats.phase === "ready") {
      sessionMode = settings.mode;
      sessionDuration = settings.duration;
      stats.timeLeft = settings.duration;
      resetTargets();
    }
    dirty = true;
  }

  function listen(target, name, handler, eventOptions) {
    target.addEventListener(name, handler, eventOptions);
    listeners.push(() =>
      target.removeEventListener(name, handler, eventOptions),
    );
  }

  function onLockChange() {
    const locked = doc.pointerLockElement === canvas;
    const wasLocked = pointerLocked;
    pointerLocked = locked;
    lockPending = false;
    if (
      locked &&
      (disposed ||
        settings.preview ||
        ["paused", "finished"].includes(stats.phase))
    ) {
      releaseLock();
      return;
    }
    if (wasLocked !== locked) notify("onLockChange", locked);
    if (!locked && wasLocked) pause();
  }

  function editableTarget(target) {
    return (
      target?.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target?.tagName || "")
    );
  }

  listen(doc, "pointerlockchange", onLockChange);
  listen(doc, "pointerlockerror", () => {
    lockPending = false;
  });
  listen(doc, "mousemove", (event) => {
    if (doc.pointerLockElement === canvas)
      look(event.movementX, event.movementY);
  });
  listen(canvas, "pointerdown", (event) => {
    if (
      settings.preview ||
      disposed ||
      event.button !== 0 ||
      !["running", "countdown"].includes(stats.phase)
    )
      return;
    if (drag && drag.id !== event.pointerId) return;
    event.preventDefault();
    unlockAudio();
    if (event.pointerType !== "touch") requestLock();
    if (doc.pointerLockElement !== canvas) {
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        distance: 0,
        born: clock(),
        touch: event.pointerType === "touch",
      };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* Capture is optional. */
      }
    }
    if (event.pointerType !== "touch" && stats.phase === "running") {
      shoot();
      if (sessionMode === "tracking") fireSources.add("pointer");
    }
  });
  listen(
    doc,
    "pointermove",
    (event) => {
      if (
        !drag ||
        event.pointerId !== drag.id ||
        doc.pointerLockElement === canvas
      )
        return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.distance += Math.hypot(dx, dy);
      drag.x = event.clientX;
      drag.y = event.clientY;
      look(dx, dy);
      if (event.cancelable) event.preventDefault();
    },
    { passive: false },
  );
  function endPointer(event) {
    if (drag && drag.id !== event.pointerId) return;
    advance(clock());
    fireSources.delete("pointer");
    if (
      drag &&
      event.type === "pointerup" &&
      drag.touch &&
      drag.distance < 9 &&
      clock() - drag.born < 350
    )
      shoot();
    if (drag && canvas.hasPointerCapture?.(drag.id)) {
      try {
        canvas.releasePointerCapture(drag.id);
      } catch {
        /* Already released. */
      }
    }
    drag = null;
  }
  listen(doc, "pointerup", endPointer);
  listen(doc, "pointercancel", endPointer);
  listen(canvas, "lostpointercapture", () => {
    drag = null;
    fireSources.delete("pointer");
  });
  listen(doc, "keydown", (event) => {
    if (
      settings.preview ||
      disposed ||
      !["running", "countdown"].includes(stats.phase) ||
      editableTarget(event.target)
    )
      return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(event.code)
    ) {
      event.preventDefault();
      keys.add(event.code);
    } else if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) {
        shoot();
        if (sessionMode === "tracking" && stats.phase === "running")
          fireSources.add("space");
      }
    } else if (event.code === "Escape") {
      pause();
    }
  });
  listen(doc, "keyup", (event) => {
    keys.delete(event.code);
    if (event.code === "Space") {
      advance(clock());
      fireSources.delete("space");
    }
  });
  listen(win, "blur", () => {
    pause();
    clearInput();
  });
  listen(doc, "visibilitychange", () => {
    if (doc.hidden) pause();
  });
  listen(win, "resize", resize);
  const resizeObserver = win.ResizeObserver
    ? new win.ResizeObserver(resize)
    : null;
  resizeObserver?.observe(canvas.parentElement || canvas);

  function frame(now) {
    if (disposed) return;
    raf = win.requestAnimationFrame(frame);
    advance(now);
    if (disposed) return;
    updateTargets(now);
    updateEffects(now);
    emitUpdate(now);
    if (disposed) return;
    // A reduced-motion hero is static; render occasionally for resize/DPR changes.
    if (
      !settings.preview ||
      !settings.reducedMotion ||
      now - lastFrame >= 250
    ) {
      renderer.render(scene, camera);
      lastFrame = now;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    win.cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
    for (const remove of listeners) remove();
    clearInput();
    releaseLock();
    clearEffects();
    if (audio) {
      audioGain?.disconnect();
      audio.close().catch(() => {});
    }
    keyLight.shadow.dispose();
    for (const resource of geometries) resource.dispose();
    for (const resource of materials) resource.dispose();
    for (const resource of textures) resource.dispose();
    renderer.dispose();
    scene.clear();
    canvas.style.touchAction = originalTouchAction;
  }

  configureCamera();
  resize();
  resetTargets();
  renderer.render(scene, camera);
  emitUpdate(clock());
  raf = win.requestAnimationFrame(frame);

  return {
    start,
    pause,
    resume,
    stop,
    dispose,
    resize,
    setOptions,
    requestLock,
    look,
    shoot,
    setMove,
  };
}
