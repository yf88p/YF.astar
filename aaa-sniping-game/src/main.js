import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { createWorld } from './world.js';
import { createTargets, createRifle } from './arsenal.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { zeroedVelocity, integrateBullet, scoreHit } from './ballistics.js';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import './style.css';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

const canvas = document.querySelector('#game-canvas');
let boot = document.querySelector('#boot');
const coarsePointer = matchMedia('(pointer: coarse)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const audio = createAudio();
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  boot?.remove();
  const error = document.createElement('div');
  error.className = 'graphics-error';
  error.innerHTML = '<h1>SILENT RIDGE</h1><p>A WebGL 2 capable browser is required to enter the ridge.</p><p>Please enable hardware acceleration and reload.</p>';
  document.body.append(error);
  throw new Error('WebGL 2 is unavailable.');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, coarsePointer ? 1.35 : 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x718898, 0.00165);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.08, 2200);
camera.rotation.order = 'YXZ';
scene.add(camera);

const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
const environmentMap = pmrem.fromScene(environment, 0.025);
scene.environment = environmentMap.texture;
scene.environmentIntensity = 0.19;
environment.dispose();
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0x8cbbdf, 0x273a48, 0.9));
const sun = new THREE.DirectionalLight(0xffc38c, 2.2);
sun.position.set(-90, 40, -90);
sun.target.position.set(0, 0, -25);
sun.castShadow = true;
sun.shadow.mapSize.set(coarsePointer ? 1024 : 2048, coarsePointer ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 85, bottom: -85, near: 0.5, far: 330 });
sun.shadow.normalBias = 0.06;
sun.shadow.bias = -0.00015;
sun.shadow.autoUpdate = false;
sun.shadow.needsUpdate = true;
scene.add(sun, sun.target);

const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {},
  vertexShader: `varying vec3 vPosition; void main(){ vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `
    varying vec3 vPosition;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
    void main(){
      vec3 d=normalize(vPosition); float h=max(d.y,0.);
      vec3 col=mix(vec3(.46,.29,.20),vec3(.10,.20,.29),smoothstep(-.08,.38,d.y));
      col=mix(col,vec3(.035,.095,.16),smoothstep(.18,.95,h));
      vec2 uv=d.xz/max(.08,d.y+.22);
      float n=noise(uv*vec2(1.4,9.))+noise(uv*vec2(3.,18.))*.4;
      float cloud=smoothstep(.75,1.15,n)*smoothstep(.04,.18,h)*(1.-smoothstep(.35,.65,h));
      col=mix(col,vec3(.42,.44,.44),cloud*.33);
      float glow=pow(max(0.,dot(d,normalize(vec3(-.6,.18,-1.)))),20.);
      col+=vec3(.35,.16,.045)*glow;
      gl_FragColor=vec4(col,1.);
    }`,
}));
sky.renderOrder = -100;
scene.add(sky);

const world = createWorld(scene);
const patrols = createTargets(scene, world.targetSpawns);
const rifle = createRifle(camera);
rifle.group.visible = false;
rifle.group.traverse((object) => { if (object.isMesh) { object.castShadow = false; object.receiveShadow = false; } });
// The fill's short range reaches the viewmodel, not the valley environment.
const weaponFill = new THREE.PointLight(0xc4d7df, 1.35, 3, 2);
weaponFill.position.set(-0.4, 0.35, 0.15);
camera.add(weaponFill);
const worldMeshes = [];
scene.getObjectByName('Kestrel alpine relay').traverse((object) => {
  if (object.isMesh && !object.material.transparent && !object.material.alphaTest) worldMeshes.push(object);
});
for (const geometry of new Set(worldMeshes.map((mesh) => mesh.geometry))) computeBoundsTree.call(geometry);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.65, 1.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finishPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, strength: { value: 0.16 } },
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float strength; varying vec2 vUv;
    void main(){vec3 c=texture2D(tDiffuse,vUv).rgb; vec2 q=vUv-.5;
    c=mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c, .87);
    c=pow(c,vec3(1.015,1.,.985));
    c*=1.-dot(q,q)*strength*1.7;
    float grain=fract(sin(dot(vUv+fract(time),vec2(12.9898,78.233)))*43758.5453);
    c+=(grain-.5)*.011; gl_FragColor=vec4(c,1.);}`,
});
composer.addPass(finishPass);

const state = {
  mode: 'menu', kills: 0, total: patrols.targets.length, ammo: 5, reserve: 25,
  scoped: false, zoom: 8, range: 100, breath: 1, reloading: false, score: 0,
  time: 0, timeLimit: 300, wind: 2.4, muted: false, locked: false, headshots: 0, shots: 0,
};
let yaw = 0;
let pitch = -0.145;
let recoil = 0;
let aimBlend = 0;
let steady = false;
let cooldown = 0;
let reloadRemaining = 0;
let completionRemaining = 0;
let elapsed = 0;
let hudElapsed = 0;
let lastFrame = performance.now();
let dragging = null;
let markersVisible = true;
let shadowElapsed = 0;
let pointerLockUnavailable = false;
const player = new THREE.Vector3(0, 21, 74);
const keys = new Set();
const raycaster = new THREE.Raycaster();
const direction = new THREE.Vector3();
const projected = new THREE.Vector3();
const bullets = [];
const impacts = [];

const ui = createUI({
  start: startMission,
  restart: startMission,
  resume: resumeMission,
  pause: pauseMission,
  aim: setAim,
  fire,
  reload,
  steady: (value) => { steady = value; },
  sound: (value) => { state.muted = value; audio.mute(value); },
  fullscreen: async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { ui.toast('Fullscreen is unavailable in this browser.', 'warning'); }
  },
});
const markers = patrols.targets.map((target, i) => {
  const el = document.createElement('div');
  el.className = 'target-marker';
  el.innerHTML = `<i></i><span>0${i + 1}</span><small></small>`;
  el.hidden = true;
  ui.root.append(el);
  return el;
});

function enterDragMode() {
  if (pointerLockUnavailable) return;
  pointerLockUnavailable = true;
  state.locked = true;
  ui.update({ locked: true });
  ui.toast('Drag to look. Right click to scope. Space to fire.');
}

function requestLock() {
  if (coarsePointer || pointerLockUnavailable) { state.locked = true; return; }
  if (!canvas.requestPointerLock) { enterDragMode(); return; }
  try {
    canvas.requestPointerLock()?.catch(enterDragMode);
  } catch { enterDragMode(); }
}
document.addEventListener('pointerlockerror', enterDragMode);

function startMission() {
  for (const bullet of bullets) { scene.remove(bullet.tracer); bullet.tracer.geometry.dispose(); }
  bullets.length = 0;
  patrols.reset();
  sun.shadow.needsUpdate = true;
  Object.assign(state, { mode: 'playing', kills: 0, ammo: 5, reserve: 25, scoped: false, breath: 1, reloading: false, score: 0, time: 0, headshots: 0, shots: 0 });
  player.set(0, 21, 74);
  yaw = 0;
  pitch = -0.145;
  steady = false;
  recoil = aimBlend = cooldown = reloadRemaining = completionRemaining = 0;
  keys.clear();
  ui.setMode('playing');
  ui.update(state);
  audio.init();
  requestLock();
  ui.toast(coarsePointer ? 'Five hostiles. Tap SCOPE, hold STEADY, then FIRE.' : 'Five signatures located. Scope in and hold Shift to steady.');
}

function resumeMission() {
  if (state.mode === 'complete' || state.mode === 'menu') return;
  state.mode = 'playing';
  ui.setMode('playing');
  audio.init();
  requestLock();
}

function pauseMission() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  state.scoped = false;
  steady = false;
  keys.clear();
  dragging = null;
  ui.setMode('paused');
  if (document.pointerLockElement) document.exitPointerLock();
}

function setAim(enabled) {
  if (state.mode !== 'playing' || state.reloading) return;
  state.scoped = enabled;
  audio.scope();
  ui.update({ scoped: enabled });
}

function reload() {
  if (state.mode !== 'playing' || state.reloading || state.ammo === 5) return;
  if (state.reserve === 0) { ui.toast('No reserve ammunition remaining.', 'warning'); return; }
  state.scoped = false;
  state.reloading = true;
  reloadRemaining = 2.15;
  steady = false;
  audio.reload();
  ui.update(state);
}

const tracerMaterial = new THREE.LineBasicMaterial({ color: 0xffd7a0, transparent: true, opacity: 0.55, depthWrite: false });
function fire() {
  if (state.mode !== 'playing' || cooldown > 0 || state.reloading || completionRemaining > 0) return;
  audio.init();
  if (!state.ammo) { audio.empty(); ui.toast('Magazine empty. Press R to reload.', 'warning'); return; }
  state.ammo--;
  state.shots++;
  cooldown = 1.05;
  camera.getWorldDirection(direction);
  const start = camera.position.clone();
  const geometry = new THREE.BufferGeometry().setFromPoints([start, start]);
  const tracer = new THREE.Line(geometry, tracerMaterial);
  tracer.frustumCulled = false;
  scene.add(tracer);
  bullets.push({ position: start, previous: start.clone(), velocity: zeroedVelocity(direction), age: 0, tracer, steady: steady && state.breath > 0.05 });
  recoil = 1;
  audio.shot();
  ui.root.classList.remove('shot-flash');
  void ui.root.offsetWidth;
  ui.root.classList.add('shot-flash');
  ui.update(state);
}

const sparkGeometry = new THREE.IcosahedronGeometry(0.035, 0);
const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffce8b, transparent: true });
function impact(point, hitTarget) {
  const group = new THREE.Group();
  const material = sparkMaterial.clone();
  material.color.set(hitTarget ? 0xd8c5aa : 0xf0dcb4);
  for (let i = 0; i < 9; i++) {
    const spark = new THREE.Mesh(sparkGeometry, material);
    spark.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 3, (Math.random() - 0.5) * 3);
    group.add(spark);
  }
  group.position.copy(point);
  scene.add(group);
  impacts.push({ group, material, age: 0 });
}

function complete(success) {
  if (state.mode !== 'playing') return;
  state.mode = 'complete';
  state.scoped = false;
  completionRemaining = 0;
  steady = false;
  keys.clear();
  if (document.pointerLockElement) document.exitPointerLock();
  audio.complete();
  ui.showDebrief({ ...state, accuracy: state.shots ? state.kills / state.shots * 100 : 0, success });
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.age += dt;
    bullet.previous.copy(bullet.position);
    integrateBullet(bullet.position, bullet.velocity, dt, state.wind * 0.18);
    direction.copy(bullet.position).sub(bullet.previous);
    const length = direction.length();
    raycaster.set(bullet.previous, direction.normalize());
    raycaster.far = length;
    const targetHit = raycaster.intersectObjects(patrols.targets.flatMap((t) => t.hitMeshes), false)[0];
    const worldHit = raycaster.intersectObjects(worldMeshes, false)[0];
    const collision = targetHit && (!worldHit || targetHit.distance <= worldHit.distance) ? targetHit : worldHit;
    if (collision) {
      const result = patrols.hit(collision.object, collision.point);
      impact(collision.point, Boolean(result));
      if (result) {
        state.kills++;
        if (result.headshot) state.headshots++;
        const distance = camera.position.distanceTo(collision.point);
        const points = scoreHit(result.headshot, distance, bullet.steady);
        state.score += points;
        ui.hit(result.headshot);
        audio.hit(result.headshot);
        ui.toast(`${result.headshot ? 'Precision kill' : 'Target neutralized'} / ${Math.round(distance)} M / +${points}`, 'success');
        if (state.kills === state.total) completionRemaining = 1.8;
      }
    }
    if (collision || bullet.age > 2.5) {
      scene.remove(bullet.tracer);
      bullet.tracer.geometry.dispose();
      bullets.splice(i, 1);
    } else {
      const vertices = bullet.tracer.geometry.attributes.position;
      vertices.setXYZ(0, bullet.position.x, bullet.position.y, bullet.position.z);
      vertices.setXYZ(1, bullet.previous.x, bullet.previous.y, bullet.previous.z);
      vertices.needsUpdate = true;
    }
  }
  if (state.kills < state.total && !state.ammo && !state.reserve && !bullets.length && cooldown <= 0) complete(false);
}

function look(dx, dy) {
  const sensitivity = 0.00165 * (state.scoped ? 1 / state.zoom : 1);
  yaw = THREE.MathUtils.clamp(yaw - dx * sensitivity, -0.7, 0.7);
  pitch = THREE.MathUtils.clamp(pitch - dy * sensitivity, -0.52, 0.48);
}

document.addEventListener('pointerlockchange', () => {
  state.locked = document.pointerLockElement === canvas;
  if (!state.locked && state.mode === 'playing' && !pointerLockUnavailable) pauseMission();
  ui.update({ locked: state.locked });
});
document.addEventListener('mousemove', (event) => {
  if (state.mode === 'playing' && document.pointerLockElement === canvas) look(event.movementX, event.movementY);
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  if (state.mode !== 'playing') return;
  if (event.button === 2) { event.preventDefault(); setAim(!state.scoped); return; }
  if (event.pointerType === 'touch' || pointerLockUnavailable) {
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (document.pointerLockElement === canvas && event.button === 0) fire();
  else requestLock();
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging || dragging.id !== event.pointerId || state.mode !== 'playing') return;
  look((event.clientX - dragging.x) * 1.6, (event.clientY - dragging.y) * 1.6);
  dragging.x = event.clientX;
  dragging.y = event.clientY;
});
canvas.addEventListener('pointerup', (event) => {
  if (dragging?.id !== event.pointerId) return;
  if (pointerLockUnavailable && event.pointerType !== 'touch' && Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) < 4) fire();
  dragging = null;
});
canvas.addEventListener('pointercancel', () => { dragging = null; });
canvas.addEventListener('wheel', (event) => {
  if (state.mode !== 'playing' || !state.scoped) return;
  event.preventDefault();
  state.zoom = THREE.MathUtils.clamp(state.zoom + (event.deltaY < 0 ? 2 : -2), 4, 12);
  ui.update({ zoom: state.zoom });
}, { passive: false });
document.addEventListener('keydown', (event) => {
  if (event.target.closest('button') && ['Space', 'Enter'].includes(event.code)) return;
  if (state.mode !== 'playing') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'Escape' || event.code === 'KeyP') pauseMission();
  if (event.code === 'KeyR') reload();
  if (event.code === 'KeyQ') setAim(!state.scoped);
  if (event.code === 'Space') fire();
  if (event.code === 'KeyE') markersVisible = !markersVisible;
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') steady = true;
});
document.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') steady = false;
});
window.addEventListener('blur', pauseMission);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pauseMission(); audio.suspend(); }
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  pauseMission();
  ui.toast('Graphics context lost. Reload the page to restore the scene.', 'error');
});

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;
  if (document.hidden) return;
  const playing = state.mode === 'playing';
  const menu = state.mode === 'menu';
  const simulationDt = playing || menu ? dt : 0;
  elapsed += simulationDt;
  if (playing || menu) {
    world.update(elapsed, dt);
    // Substep patrol poses and bullet sweeps together, including on slower devices.
    let remaining = dt;
    while (remaining > 0.000001 && (state.mode === 'playing' || menu)) {
      const step = Math.min(remaining, 1 / 120);
      patrols.update(elapsed - remaining + step, step);
      if (state.mode === 'playing') updateBullets(step);
      remaining -= step;
    }
    shadowElapsed += dt;
    if (shadowElapsed > (coarsePointer ? 0.5 : 0.25)) { sun.shadow.needsUpdate = true; shadowElapsed = 0; }
  }
  if (menu) {
    const drift = reducedMotion ? 0 : Math.sin(elapsed * 0.075) * 1.5;
    camera.position.set(26 + drift, 27, 82);
    camera.lookAt(innerWidth < 600 ? 1 : -13, 11, -28);
    camera.fov = 48;
  } else {
    if (playing) {
      state.time += dt;
      cooldown = Math.max(0, cooldown - dt);
      if (state.reloading) {
        reloadRemaining -= dt;
        if (reloadRemaining <= 0) {
          const rounds = Math.min(5 - state.ammo, state.reserve);
          state.ammo += rounds;
          state.reserve -= rounds;
          state.reloading = false;
        }
      }
      state.breath = THREE.MathUtils.clamp(state.breath + (steady && state.scoped ? -0.19 : 0.11) * dt, 0, 1);
      if (state.breath === 0) steady = false;
      const move = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      player.x = THREE.MathUtils.clamp(player.x + move * dt * 1.8, -3, 3);
      if (keys.has('ArrowLeft')) look(-dt * 420, 0);
      if (keys.has('ArrowRight')) look(dt * 420, 0);
      if (keys.has('ArrowUp')) look(0, -dt * 420);
      if (keys.has('ArrowDown')) look(0, dt * 420);
      if (completionRemaining > 0) {
        completionRemaining -= dt;
        if (completionRemaining <= 0) complete(true);
      }
      if (state.time >= state.timeLimit && state.kills < state.total) complete(false);
    }
    recoil = THREE.MathUtils.damp(recoil, 0, 9, dt);
    aimBlend = THREE.MathUtils.damp(aimBlend, state.scoped ? 1 : 0, 16, dt);
    const stability = steady && state.breath > 0.03 ? 0.08 : 1;
    const sway = (state.scoped ? 0.0009 : 0.00055) * stability;
    camera.position.copy(player);
    camera.rotation.set(pitch + Math.sin(elapsed * 1.7) * sway + recoil * 0.009,
      yaw + Math.sin(elapsed * 1.1) * sway, reducedMotion ? 0 : Math.sin(elapsed * 0.9) * sway * 0.3);
    camera.fov = THREE.MathUtils.lerp(48, 48 / state.zoom, aimBlend);
  }
  camera.updateProjectionMatrix();
  rifle.update(elapsed, simulationDt, { aim: aimBlend, recoil, moving: keys.has('KeyA') || keys.has('KeyD'), reloading: state.reloading });
  rifle.group.visible = !menu && aimBlend < 0.9;
  scene.updateMatrixWorld();
  for (let i = impacts.length - 1; i >= 0; i--) {
    const effect = impacts[i];
    effect.age += simulationDt;
    effect.material.opacity = Math.max(0, 1 - effect.age * 2);
    effect.group.children.forEach((spark) => {
      spark.position.addScaledVector(spark.userData.velocity, simulationDt);
      spark.userData.velocity.y -= 8 * simulationDt;
    });
    if (effect.age > 0.5) { scene.remove(effect.group); effect.material.dispose(); impacts.splice(i, 1); }
  }
  hudElapsed += dt;
  if (hudElapsed > 0.08) {
    hudElapsed = 0;
    if (playing) {
      camera.getWorldDirection(direction);
      let nearestAngle = Infinity;
      let range = null;
      patrols.targets.forEach((target) => {
        if (!target.alive) return;
        projected.copy(target.aimPoint).sub(camera.position);
        const angle = direction.angleTo(projected);
        if (angle < nearestAngle) { nearestAngle = angle; range = projected.length(); }
      });
      state.range = nearestAngle < 0.16 ? range : null;
    }
    ui.update(state);
  }
  patrols.targets.forEach((target, i) => {
    const marker = markers[i];
    marker.hidden = !playing || state.scoped || !target.alive || !markersVisible;
    if (marker.hidden) return;
    projected.copy(target.position).add(new THREE.Vector3(0, 3.2, 0)).project(camera);
    marker.hidden = projected.z > 1 || Math.abs(projected.x) > 0.95 || Math.abs(projected.y) > 0.75;
    marker.style.transform = `translate(${(projected.x * 0.5 + 0.5) * innerWidth}px,${(-projected.y * 0.5 + 0.5) * innerHeight}px)`;
    marker.querySelector('small').textContent = `${Math.round(camera.position.distanceTo(target.position))} M`;
  });
  finishPass.uniforms.time.value = reducedMotion ? 0 : elapsed;
  composer.render();
  if (boot) { boot.remove(); boot = null; }
}
requestAnimationFrame(animate);

// Development-only diagnostics for browser smoke tests; omitted from production.
if (import.meta.env.DEV) {
  window.__ridge = {
    state, camera, scene, renderer, patrols,
    aimAt(id, head = false) {
      const target = patrols.targets[id];
      if (!target) return;
      direction.copy(head ? target.headPosition : target.aimPoint).sub(player).normalize();
      yaw = Math.atan2(-direction.x, -direction.z);
      pitch = Math.asin(direction.y);
      camera.position.copy(player);
      camera.rotation.set(pitch, yaw, 0);
      camera.updateMatrixWorld();
    },
  };
}
