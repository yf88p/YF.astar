import "./style.css";
import * as THREE from "three";
import { FlightPhysics, AIRCRAFT } from "./physics.js";
import {
  createWorld,
  createAircraft,
  createCockpit,
  terrainHeight,
} from "./world.js";
import { Instruments } from "./instruments.js";
import { FlightAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const rad = THREE.MathUtils.degToRad;
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const clockText = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const svg = (path) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const icons = {
  sound: svg(
    '<path d="m11 5-6 4H2v6h3l6 4z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  ),
  mute: svg('<path d="m11 5-6 4H2v6h3l6 4zM16 9l6 6m0-6-6 6"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  camera: svg(
    '<path d="M3 7h5l2-3h4l2 3h5v13H3z"/><circle cx="12" cy="13" r="3.5"/>',
  ),
  mouse: svg(
    '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v6"/>',
  ),
};
$("pause-btn").innerHTML = icons.pause;
$("camera-icon").innerHTML = icons.camera;
$("mouse-icon").innerHTML = icons.mouse;

const defaultSettings = {
  sensitivity: 0.65,
  volume: 0.45,
  quality: "auto",
  invert: false,
  sound: true,
  assist: true,
};
let settings = { ...defaultSettings };
try {
  const saved = JSON.parse(localStorage.getItem("aeronaut-settings") || "{}");
  for (const key of Object.keys(defaultSettings)) {
    if (typeof saved[key] === typeof defaultSettings[key])
      settings[key] = saved[key];
  }
  settings.sensitivity = clamp(settings.sensitivity, 0.25, 1);
  settings.volume = clamp(settings.volume, 0, 1);
  if (!["auto", "high", "low"].includes(settings.quality))
    settings.quality = "auto";
} catch {
  /* Storage may be unavailable in private browsing. */
}
function saveSettings() {
  try {
    localStorage.setItem("aeronaut-settings", JSON.stringify(settings));
  } catch {
    /* Flight does not require storage. */
  }
}

const WEATHER = {
  clear: {
    wind: new THREE.Vector3(-0.4, 0, 0.8),
    turbulence: 0,
    detail: "18°C · Light wind · 25 km visibility",
  },
  sunset: {
    wind: new THREE.Vector3(-0.2, 0, 0.5),
    turbulence: 0.03,
    detail: "21°C · Still air · The light is yours",
  },
  cloudy: {
    wind: new THREE.Vector3(4.2, 0, 2.8),
    turbulence: 0.28,
    detail: "16°C · WNW 10 kt · Scattered cloud",
  },
  storm: {
    wind: new THREE.Vector3(8, 0, -5),
    turbulence: 0.85,
    detail: "12°C · SW 18 kt · Gusty & challenging",
  },
};
const FLIGHTS = {
  coast: {
    name: "Coastal discovery",
    detail: "Already airborne. Just explore.",
    type: "FREE FLIGHT",
    instruction: "The coast is yours. Bank left to discover the islands.",
    position: [-800, 540, 1300],
    speed: 48,
    heading: -15,
  },
  runway: {
    name: "Runway departure",
    detail: "From the first roll to open sky.",
    type: "TAKEOFF PRACTICE",
    instruction: "Full throttle. At 60 knots, gently pull the nose up.",
    position: [0, 19.65, 720],
    speed: 0,
    heading: 0,
  },
  landing: {
    name: "The perfect landing",
    detail: "On final. Find your softest touch.",
    type: "LANDING PRACTICE",
    instruction: "Runway 36 is ahead. Keep a gentle descent.",
    position: [0, 160, 3300],
    speed: 37,
    heading: 0,
  },
  mountain: {
    name: "Above the peaks",
    detail: "A different kind of altitude.",
    type: "HIGH COUNTRY",
    instruction: "Explore the high country. Keep an eye on your airspeed.",
    position: [1800, 3100, -2400],
    speed: 55,
    heading: 35,
  },
};
const AIRCRAFT_DETAILS = {
  trainer: "High-wing · Forgiving & familiar",
  tourer: "Low-wing · Built to go further",
  sport: "Aerobatic · A little more freedom",
};
const LANDING = {
  trainer: { speed: 36.7, throttle: 0.506, range: "65–75" },
  tourer: { speed: 43.4, throttle: 0.47, range: "80–90" },
  sport: { speed: 43.8, throttle: 0.443, range: "80–90" },
};
const touchDevice = matchMedia("(pointer: coarse)").matches;
document.body.classList.toggle("touch-device", touchDevice);
const audio = new FlightAudio();
audio.setVolume(settings.volume);
audio.setMuted(!settings.sound);
let renderer, world, camera, aircraft, cockpit, instruments, physics;
let ready = false,
  mode = "menu",
  activeModal = null,
  modalReturn = "menu",
  lastFocus = null;
let scenario = "coast",
  aircraftType = "trainer",
  weatherType = "clear",
  cameraMode = 0;
let throttle = 0.65,
  flapIndex = 0,
  brakeLatch = false,
  mousePilot = false,
  hudHidden = false;
let elapsed = 0,
  distance = 0,
  maxAltitude = 0,
  accumulator = 0,
  simulationTime = 0;
let lastNow = performance.now(),
  hudTime = 0,
  lastTrailTime = 0,
  toastUntil = 0;
let hadAirborne = false,
  touchdown = null,
  resultShown = false,
  takeoffNotified = false;
let trail = [],
  previewTime = 0,
  orbitAngle = 0,
  orbitPitch = 0.2,
  zoom = 1;
const keys = new Set();
const pointer = {
  id: null,
  x: 0,
  y: 0,
  pitch: 0,
  roll: 0,
  looking: false,
  lastX: 0,
  lastY: 0,
};
const stick = { id: null, pitch: 0, roll: 0, yaw: 0 };
const controls = {
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttle: 0.65,
  flaps: 0,
  brakes: false,
};
const v1 = new THREE.Vector3(),
  v2 = new THREE.Vector3(),
  v3 = new THREE.Vector3();
const headingQuaternion = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
let cameraSnap = true;

function soundButton() {
  $("sound-btn").innerHTML = settings.sound ? icons.sound : icons.mute;
  $("sound-btn").setAttribute(
    "aria-label",
    settings.sound ? "Mute sound" : "Enable sound",
  );
  $("sound-btn").setAttribute("aria-pressed", String(settings.sound));
}
soundButton();
$("assist-btn").classList.toggle("active", settings.assist);
$("assist-btn").setAttribute("aria-pressed", String(settings.assist));
$("sensitivity").value = settings.sensitivity * 100;
$("volume").value = settings.volume * 100;
$("quality").value = settings.quality;
$("invert").checked = settings.invert;

function applyQuality() {
  if (!renderer) return;
  const ratio =
    settings.quality === "low"
      ? 1
      : Math.min(
          devicePixelRatio,
          settings.quality === "high" ? 2 : touchDevice ? 1.25 : 1.5,
        );
  renderer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = settings.quality !== "low";
  renderer.setSize(innerWidth, innerHeight);
}

function resize() {
  if (!camera) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyQuality();
  cameraSnap = true;
}
window.addEventListener("resize", resize);

function changeAircraft(type) {
  if (aircraft) {
    world.scene.remove(aircraft);
    const geometry = new Set(),
      materials = new Set();
    aircraft.traverse((node) => {
      if (node.geometry) geometry.add(node.geometry);
      for (const mat of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : [])
        materials.add(mat);
    });
    geometry.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  }
  aircraft = createAircraft(type);
  world.scene.add(aircraft);
  aircraftType = type;
}

function clearInput() {
  keys.clear();
  pointer.pitch = pointer.roll = 0;
  pointer.id = null;
  pointer.looking = false;
  stick.pitch = stick.roll = stick.yaw = 0;
  stick.id = null;
  $("joystick-thumb").style.transform = "";
}

function setHud(hidden) {
  hudHidden = hidden;
  document.body.classList.toggle("clean-view", hidden);
  $("restore-hud").hidden = !hidden;
}

function toast(message, seconds = 4) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastUntil = performance.now() + seconds * 1000;
}

function updateConfig() {
  $("throttle").value = Math.round(throttle * 100);
  $("throttle-value").textContent = `${Math.round(throttle * 100)}%`;
  $("flaps-value").textContent = `${flapIndex * 10}°`;
  $("flaps-btn").classList.toggle("active", flapIndex > 0);
  const braking = brakeLatch || keys.has("KeyB");
  $("brakes-value").textContent = braking ? "ON" : "OFF";
  $("brakes-btn").classList.toggle("active", braking);
  $("brakes-btn").setAttribute("aria-pressed", String(braking));
}

function startFlight() {
  if (!ready) return;
  scenario = $("flight-select").value;
  weatherType = $("weather-select").value;
  const selectedAircraft = $("aircraft-select").value;
  if (selectedAircraft !== aircraftType) changeAircraft(selectedAircraft);
  const flight = FLIGHTS[scenario];
  const approach = LANDING[aircraftType];
  const speed =
    scenario === "landing"
      ? approach.speed
      : flight.speed * (AIRCRAFT[aircraftType].trimSpeed / 48);
  throttle =
    scenario === "runway"
      ? 0
      : scenario === "landing"
        ? approach.throttle
        : scenario === "mountain"
          ? 0.85
          : 0.67;
  flapIndex = scenario === "landing" ? 2 : 0;
  physics.reset({
    aircraft: aircraftType,
    position: new THREE.Vector3(...flight.position),
    heading: rad(flight.heading),
    speed,
    throttle,
    flaps: flapIndex / 3,
    verticalSpeed: scenario === "landing" ? -speed * Math.sin(Math.PI / 60) : 0,
    onGround: scenario === "runway",
    terrainHeight: (x, z) => Math.max(0, terrainHeight(x, z)),
  });
  brakeLatch = false;
  elapsed = distance = accumulator = lastTrailTime = 0;
  maxAltitude = physics.position.y;
  trail = [];
  hadAirborne = scenario !== "runway";
  touchdown = null;
  resultShown = takeoffNotified = false;
  cameraMode = 0;
  orbitAngle = 0;
  orbitPitch = 0.2;
  zoom = 1;
  cameraSnap = true;
  cameraLabel();
  clearInput();
  hideModal();
  mode = "flying";
  document.body.classList.add("flying");
  $("menu").hidden = true;
  $("flight-ui").hidden = false;
  $("header-status").textContent =
    `${AIRCRAFT[aircraftType].label.toUpperCase()} / N-172AE`;
  $("flight-name").textContent = flight.name;
  $("flight-type").textContent = flight.type;
  $("flight-instruction").textContent =
    scenario === "landing"
      ? `Runway 36 is ahead. Aim for ${approach.range} knots and a gentle descent.`
      : flight.instruction;
  $("objective").hidden = !["runway", "landing"].includes(scenario);
  $("warning").hidden = true;
  world.setWeather(weatherType);
  setHud(false);
  updateConfig();
  updateHud();
  audio.init();
  toast(
    touchDevice
      ? "Drag the left stick to fly. The throttle is below."
      : "Small inputs, big horizons. Press ? for your flight guide.",
    7,
  );
  $("fly-btn").blur();
}

function home() {
  hideModal();
  mode = "menu";
  clearInput();
  setHud(false);
  $("menu").hidden = false;
  $("flight-ui").hidden = true;
  document.body.classList.remove("flying");
  $("header-status").textContent = "A WORLD ABOVE THE EVERYDAY";
  cockpit.visible = false;
  aircraft.visible = true;
  camera.up.set(0, 1, 0);
  cameraSnap = true;
  audio.update(physics.telemetry, 0, false);
  $("fly-btn").focus({ preventScroll: true });
}

function showModal(name) {
  if (activeModal === name || activeModal === "result") return;
  if (!activeModal) {
    modalReturn = mode;
    lastFocus = document.activeElement;
  }
  activeModal = name;
  if (mode === "flying") mode = "paused";
  clearInput();
  $("modal-backdrop").hidden = false;
  for (const id of ["guide", "pause", "result"])
    $(`${id}-modal`).hidden = id !== name;
  const target = $(`${name}-modal`).querySelector("button");
  target?.focus({ preventScroll: true });
}

function hideModal() {
  $("modal-backdrop").hidden = true;
  for (const id of ["guide", "pause", "result"]) $(`${id}-modal`).hidden = true;
  if (mode === "paused") mode = modalReturn;
  activeModal = null;
  lastNow = performance.now();
  accumulator = 0;
  lastFocus?.focus?.({ preventScroll: true });
}

function pause() {
  if (mode !== "flying") return;
  $("pause-time").textContent = clockText(elapsed);
  $("pause-distance").textContent = `${(distance / 1852).toFixed(1)} NM`;
  $("pause-altitude").textContent = `${nf.format(maxAltitude * 3.28084)} FT`;
  showModal("pause");
}

function finishFlight(success = false) {
  if (resultShown) return;
  resultShown = true;
  mode = "result";
  setHud(false);
  $("result-eyebrow").textContent = success
    ? "A FLIGHT WORTH REMEMBERING"
    : "EVERY FLIGHT TEACHES YOU SOMETHING";
  $("result-title").innerHTML = success
    ? "Welcome back<br><em>to solid ground.</em>"
    : "A little too<br><em>close to earth.</em>";
  $("result-message").textContent = success
    ? `A safe landing at Emerald Coast. Touchdown at ${Math.round((touchdown?.speed || 0) * 1.94384)} knots with a ${Math.abs(touchdown?.sink || 0).toFixed(1)} m/s descent. The next horizon is waiting.`
    : `${physics.crashReason || "Ground impact"}. ${physics.crashReason.includes("Hard") ? "Reduce your descent rate before touchdown and flare gently just above the runway." : physics.crashReason.includes("Wing") ? "Keep the wings level near the ground. Small, gentle inputs are your best friend." : "Keep enough altitude to recover, watch your airspeed, and line up with the runway for landing."}`;
  $("result-time").textContent = clockText(elapsed);
  $("result-distance").textContent = `${(distance / 1852).toFixed(1)} NM`;
  $("result-altitude").textContent = `${nf.format(maxAltitude * 3.28084)} FT`;
  showModal("result");
}

function cameraLabel() {
  $("camera-label").textContent = ["Chase", "Cockpit", "Orbit"][cameraMode];
}
function cycleCamera() {
  if (mode !== "flying") return;
  cameraMode = (cameraMode + 1) % 3;
  orbitAngle = cameraMode === 2 ? 0.65 : 0;
  orbitPitch = 0.2;
  cameraSnap = true;
  cameraLabel();
  toast(
    [
      "Chase view · Right-drag to look around",
      "Cockpit view · Right-drag to look around",
      "Orbit view · Drag to explore your aircraft",
    ][cameraMode],
    3,
  );
}

function updateHud() {
  if (!physics) return;
  const t = physics.telemetry;
  $("speed-value").textContent = Math.round(t.airspeed * 1.94384);
  $("speed-bar").style.left =
    `${clamp(((t.airspeed * 1.94384) / 170) * 100, 0, 100)}%`;
  $("altitude-value").textContent = nf.format(t.altitude * 3.28084);
  $("agl-value").textContent = nf.format(Math.max(0, t.agl - 1.65) * 3.28084);
  const vs = Math.round((t.verticalSpeed * 196.85) / 10) * 10;
  $("vs-value").textContent = `${vs >= 0 ? "+" : ""}${nf.format(vs)}`;
  $("g-value").textContent = t.gForce.toFixed(1);
  $("rpm-value").textContent = nf.format(t.engineRPM);
  $("heading-readout").textContent = String(
    Math.round(t.heading) % 360,
  ).padStart(3, "0");
  $("compass").querySelector(".compass-ticks").style.backgroundPositionX =
    `${-t.heading * 1.5}px`;
  $("airport-distance").textContent =
    `${(Math.hypot(physics.position.x, physics.position.z) / 1852).toFixed(1)} NM TO FIELD`;
  $("flight-time").textContent = `${clockText(elapsed)} FLIGHT TIME`;
  const lowTerrain =
    !physics.onGround &&
    t.agl < 85 &&
    t.verticalSpeed < -2.5 &&
    (Math.abs(physics.position.x) > 70 || Math.abs(physics.position.z) > 2200);
  const warning =
    t.stallWarning && !physics.onGround
      ? "STALL · LOWER THE NOSE"
      : lowTerrain
        ? "TERRAIN · PULL UP"
        : Math.abs(t.gForce) > 4.5
          ? "HIGH G LOAD · EASE THE CONTROLS"
          : "";
  $("warning").hidden = !warning;
  $("warning").textContent = warning;
  if (performance.now() > toastUntil) $("toast").hidden = true;
  updateConfig();
  instruments.update(t, physics.position, elapsed, trail);
  if (cameraMode === 1) cockpit.userData.update?.(t, $("attitude"));
  updateObjective();
}

function updateObjective() {
  const t = physics.telemetry;
  if (scenario === "runway" && !takeoffNotified) {
    const airborne = t.agl > 12;
    $("objective-label").textContent = airborne
      ? "POSITIVE CLIMB"
      : "CLEARED FOR TAKEOFF · RWY 36";
    $("objective-progress").style.width =
      `${clamp(((t.airspeed * 1.94384) / 65) * 100, 0, 100)}%`;
    $("objective-description").textContent = airborne
      ? "Beautiful. Keep climbing at 75–85 knots."
      : t.airspeed * 1.94384 > 55
        ? "Rotate. Gently pull the nose up."
        : "Throttle to 100%. Keep straight with the rudder.";
    if (t.agl > 70) {
      takeoffNotified = true;
      $("objective-label").textContent = "TAKEOFF COMPLETE";
      $("objective-description").textContent =
        "The hard part is over. The whole coast is yours.";
      toast("You’re flying. Welcome to a different point of view.", 7);
    }
  } else if (scenario === "landing") {
    $("objective-label").textContent = physics.onGround
      ? "WELCOME TO EMERALD COAST"
      : "FINAL APPROACH · RWY 36";
    $("objective-progress").style.width =
      `${clamp(((3300 - physics.position.z) / 2700) * 100, 0, 100)}%`;
    $("objective-description").textContent = physics.onGround
      ? "Throttle to idle. Hold B to slow down."
      : Math.abs(physics.position.x) > 60
        ? `Align with the centerline. Aim for ${LANDING[aircraftType].range} knots.`
        : t.agl < 12
          ? "Gently flare. Idle throttle and keep the wings level."
          : "Aim just beyond the near runway threshold. Flaps 20°.";
  }
}

function readControls(dt) {
  let pitch = (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
  let roll =
    (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) -
    (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
  let yaw = (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0) + stick.yaw;
  throttle = clamp(
    throttle +
      ((keys.has("KeyW") || keys.has("Equal") ? 1 : 0) -
        (keys.has("KeyS") || keys.has("Minus") ? 1 : 0)) *
        dt *
        0.28,
    0,
    1,
  );
  const inversion = settings.invert ? -1 : 1;
  pitch += (pointer.pitch + stick.pitch) * inversion;
  roll += pointer.roll + stick.roll;
  const gamepad = navigator.getGamepads?.()[0];
  if (gamepad?.connected) {
    const deadzone = (value = 0) =>
      Math.abs(value) > 0.1
        ? (Math.sign(value) * (Math.abs(value) - 0.1)) / 0.9
        : 0;
    roll += deadzone(gamepad.axes[0]);
    pitch += deadzone(gamepad.axes[1]) * inversion;
    throttle = clamp(throttle - deadzone(gamepad.axes[3]) * dt * 0.3, 0, 1);
    yaw += (gamepad.buttons[7]?.value || 0) - (gamepad.buttons[6]?.value || 0);
  }
  if (settings.assist && Math.abs(yaw) < 0.05 && !physics.onGround) {
    yaw = clamp(physics.telemetry.sideslip * 0.035 + roll * 0.09, -0.4, 0.4);
  }
  controls.pitch = clamp(pitch * settings.sensitivity, -1, 1);
  controls.roll = clamp(roll * settings.sensitivity, -1, 1);
  controls.yaw = clamp(yaw * settings.sensitivity, -1, 1);
  controls.throttle = throttle;
  controls.flaps = flapIndex / 3;
  controls.brakes = brakeLatch || keys.has("KeyB");
}

function updateFlight(dt) {
  readControls(dt);
  accumulator += dt;
  while (accumulator >= 1 / 120 && mode === "flying") {
    const groundBefore = physics.onGround;
    const sink = physics.velocity.y;
    const speed = physics.telemetry.airspeed;
    physics.update(1 / 120, controls, WEATHER[weatherType]);
    elapsed += 1 / 120;
    simulationTime += 1 / 120;
    distance += physics.telemetry.groundspeed / 120;
    maxAltitude = Math.max(maxAltitude, physics.position.y);
    if (physics.telemetry.agl > 8) hadAirborne = true;
    if (!groundBefore && physics.onGround && hadAirborne && !physics.crashed) {
      touchdown = { sink, speed };
      toast(
        `Touchdown. ${Math.abs(sink).toFixed(1)} m/s · Idle throttle and hold B to brake.`,
        6,
      );
    }
    if (
      terrainHeight(physics.position.x, physics.position.z) < -1 &&
      physics.position.y <= 1.8
    ) {
      physics.crashed = true;
      physics.crashReason = "Water landing";
      physics.velocity.set(0, 0, 0);
    }
    if (physics.crashed) finishFlight();
    else if (
      touchdown &&
      physics.onGround &&
      physics.telemetry.groundspeed < 3 &&
      Math.abs(physics.position.x) < 30 &&
      Math.abs(physics.position.z) < 850
    )
      finishFlight(true);
    accumulator -= 1 / 120;
  }
  if (elapsed - lastTrailTime > 1) {
    trail.push({ x: physics.position.x, z: physics.position.z });
    if (trail.length > 900) trail.shift();
    lastTrailTime = elapsed;
  }
}

function updateCamera(dt) {
  aircraft.position.copy(physics.position);
  aircraft.quaternion.copy(physics.quaternion);
  aircraft.visible = cameraMode !== 1;
  cockpit.visible = cameraMode === 1;
  const smoothing = cameraSnap ? 1 : 1 - Math.exp(-dt * 5);
  if (cameraMode === 1) {
    camera.fov = innerWidth < 600 ? 78 : 73;
    camera.position
      .copy(physics.position)
      .add(
        v1
          .copy(aircraft.userData.cockpitAnchor)
          .applyQuaternion(physics.quaternion),
      );
    camera.quaternion.copy(physics.quaternion);
    headingQuaternion.setFromEuler(
      new THREE.Euler(-orbitPitch + 0.2, -orbitAngle, 0, "YXZ"),
    );
    camera.quaternion.multiply(headingQuaternion);
    cockpit.visible =
      Math.abs(orbitAngle) < 0.55 && Math.abs(orbitPitch - 0.2) < 0.4;
  } else {
    camera.fov = innerWidth < 600 ? 67 : 58;
    headingQuaternion.setFromAxisAngle(up, -rad(physics.telemetry.heading));
    const radius = (cameraMode === 2 ? 23 : 25) * zoom;
    v1.set(
      Math.sin(orbitAngle) * radius,
      4.5 + Math.sin(orbitPitch) * radius * 0.55,
      Math.cos(orbitAngle) * radius,
    );
    v1.applyQuaternion(headingQuaternion).add(physics.position);
    v1.y = Math.max(v1.y, Math.max(0, terrainHeight(v1.x, v1.z)) + 2);
    camera.position.lerp(v1, smoothing);
    v2.set(0, 1, cameraMode === 2 ? 0 : -11)
      .applyQuaternion(headingQuaternion)
      .add(physics.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(v2);
  }
  camera.updateProjectionMatrix();
  cameraSnap = false;
}

function preview(dt) {
  if (!activeModal && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    previewTime += dt;
  const t = previewTime;
  aircraft.visible = true;
  cockpit.visible = false;
  aircraft.position.set(
    -850,
    510 + Math.sin(t * 0.22) * 2,
    1180 - Math.sin(t * 0.02) * 230,
  );
  aircraft.quaternion.setFromEuler(
    new THREE.Euler(0.025, -0.12, -0.07 + Math.sin(t * 0.15) * 0.025),
  );
  const mobile = innerWidth < 600;
  v1.set(mobile ? 17 : 20, mobile ? 7 : 7.5, mobile ? 28 : 28);
  v1.applyQuaternion(aircraft.quaternion).add(aircraft.position);
  camera.position.copy(v1);
  v2.copy(aircraft.position).add(
    v3.set(mobile ? -2.3 : -8, mobile ? 4.3 : 0.3, -4),
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(v2);
  camera.fov = mobile ? 68 : 49;
  camera.updateProjectionMatrix();
  aircraft.userData.animate(dt, 0.55);
}

function frame(now) {
  const dt = Math.min(Math.max(0, (now - lastNow) / 1000), 0.075);
  lastNow = now;
  if (mode === "menu") preview(dt);
  else {
    if (mode === "flying") updateFlight(dt);
    updateCamera(dt);
    if (mode === "flying")
      aircraft.userData.animate(dt, throttle, physics.telemetry.engineRPM);
  }
  world.update(mode === "menu" ? previewTime : simulationTime, weatherType);
  hudTime += dt;
  if (hudTime > 0.09) {
    if (mode !== "menu") updateHud();
    audio.update(
      physics.telemetry,
      throttle,
      mode === "flying",
      cameraMode === 1,
    );
    hudTime = 0;
  }
  renderer.render(world.scene, camera);
  requestAnimationFrame(frame);
}

async function init() {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: $("world"),
      antialias: !touchDevice,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    world = createWorld(renderer);
    camera = new THREE.PerspectiveCamera(
      58,
      innerWidth / innerHeight,
      0.08,
      65000,
    );
    world.scene.add(camera);
    cockpit = createCockpit();
    cockpit.visible = false;
    camera.add(cockpit);
    changeAircraft($("aircraft-select").value);
    physics = new FlightPhysics({
      terrainHeight: (x, z) => Math.max(0, terrainHeight(x, z)),
    });
    instruments = new Instruments({
      attitudeCanvas: $("attitude"),
      mapCanvas: $("map"),
      terrainHeight,
    });
    resize();
    preview(0);
    await renderer.compileAsync(world.scene, camera);
    renderer.render(world.scene, camera);
    ready = true;
    $("fly-btn").disabled = false;
    $("launch-label").textContent = "Take to the sky";
    $("launch-detail").textContent = "YOUR ADVENTURE STARTS HERE";
    lastNow = performance.now();
    requestAnimationFrame(frame);
    // Read-only diagnostics make flight behavior inspectable without coupling UI to tests.
    window.aeronaut = {
      get state() {
        return {
          ready,
          mode,
          scenario,
          aircraft: aircraftType,
          weather: weatherType,
          camera: cameraMode,
          elapsed,
          distance,
          throttle,
          flaps: flapIndex,
          telemetry: { ...physics.telemetry },
          position: physics.position.toArray(),
          controls: { ...controls },
          render: {
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
          },
        };
      },
    };
  } catch (error) {
    console.error("Aeronaut initialization failed", error);
    $("load-error").hidden = false;
    $("load-error-message").textContent =
      "This flight needs WebGL 2. Enable hardware acceleration in your browser, or try a recent version of Chrome, Edge, Firefox, or Safari.";
    $("launch-label").textContent = "Unable to prepare";
  }
}

$("aircraft-select").addEventListener("change", (event) => {
  $("aircraft-detail").textContent = AIRCRAFT_DETAILS[event.target.value];
  if (ready && mode === "menu") changeAircraft(event.target.value);
});
$("flight-select").addEventListener("change", (event) => {
  $("flight-detail").textContent = FLIGHTS[event.target.value].detail;
});
$("weather-select").addEventListener("change", (event) => {
  weatherType = event.target.value;
  $("weather-detail").textContent = WEATHER[weatherType].detail;
  world?.setWeather(weatherType);
});
$("fly-btn").addEventListener("click", startFlight);
$("help-btn").addEventListener("click", () => showModal("guide"));
$("intro-guide").addEventListener("click", () => showModal("guide"));
$("guide-done").addEventListener("click", hideModal);
document
  .querySelectorAll("[data-close]")
  .forEach((button) => button.addEventListener("click", hideModal));
$("pause-btn").addEventListener("click", pause);
$("resume-btn").addEventListener("click", hideModal);
for (const id of ["restart-btn", "retry-btn"])
  $(id).addEventListener("click", startFlight);
for (const id of ["home-btn", "result-home"])
  $(id).addEventListener("click", home);
$("brand-link").addEventListener("click", (event) => {
  event.preventDefault();
  if (mode === "flying") pause();
});
$("camera-btn").addEventListener("click", cycleCamera);
$("sound-btn").addEventListener("click", () => {
  settings.sound = !settings.sound;
  audio.setMuted(!settings.sound);
  if (settings.sound) audio.init();
  soundButton();
  saveSettings();
});
$("assist-btn").addEventListener("click", () => {
  settings.assist = !settings.assist;
  $("assist-btn").classList.toggle("active", settings.assist);
  $("assist-btn").setAttribute("aria-pressed", String(settings.assist));
  saveSettings();
  toast(
    settings.assist
      ? "Automatic rudder coordination on"
      : "Full manual rudder. Q / E to coordinate turns.",
  );
});
$("mouse-btn").addEventListener("click", () => {
  mousePilot = !mousePilot;
  pointer.pitch = pointer.roll = 0;
  $("mouse-btn").classList.toggle("active", mousePilot);
  $("mouse-btn").setAttribute("aria-pressed", String(mousePilot));
  document.body.classList.toggle("mouse-pilot", mousePilot);
  toast(
    mousePilot
      ? "Drag in the sky to fly. Pull down to climb. Release to center."
      : "Keyboard controls active",
  );
});
$("throttle").addEventListener("input", (event) => {
  throttle = Number(event.target.value) / 100;
  updateConfig();
});
$("flaps-btn").addEventListener("click", () => {
  flapIndex = (flapIndex + 1) % 4;
  updateConfig();
});
$("brakes-btn").addEventListener("click", () => {
  brakeLatch = !brakeLatch;
  updateConfig();
});
$("hide-hud-btn").addEventListener("click", () => setHud(true));
$("restore-hud").addEventListener("click", () => setHud(false));
for (const id of ["sensitivity", "volume", "quality", "invert"]) {
  $(id).addEventListener("input", (event) => {
    settings[id] =
      id === "invert"
        ? event.target.checked
        : id === "quality"
          ? event.target.value
          : Number(event.target.value) / 100;
    if (id === "quality") applyQuality();
    if (id === "volume") audio.setVolume(settings.volume);
    saveSettings();
  });
}
$("fullscreen-btn").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    $("fullscreen-btn").textContent =
      "Fullscreen is unavailable in this browser";
  }
});
document.addEventListener("fullscreenchange", () => {
  $("fullscreen-btn").textContent = document.fullscreenElement
    ? "Leave fullscreen ↙"
    : "Enter fullscreen ↗";
});
document.querySelectorAll("[data-guide]").forEach((button) => {
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-guide]")
      .forEach((tab) => tab.classList.toggle("active", tab === button));
    for (const name of ["controls", "flying", "settings"])
      $(`guide-${name}`).hidden = name !== button.dataset.guide;
  });
});
$("modal-backdrop").addEventListener("click", (event) => {
  if (event.target === $("modal-backdrop") && activeModal !== "result")
    hideModal();
});

const flightKeys = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyB",
  "Equal",
  "Minus",
]);
document.addEventListener("keydown", (event) => {
  if (event.code === "Tab" && activeModal) {
    const focusables = [
      ...$(`${activeModal}-modal`).querySelectorAll("button,input,select,a"),
    ].filter((el) => el.getClientRects().length && !el.disabled);
    const first = focusables[0],
      last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  if (event.code === "Escape") {
    event.preventDefault();
    if (event.repeat) return;
    if (activeModal && activeModal !== "result") hideModal();
    else pause();
    return;
  }
  const formInput = ["INPUT", "SELECT", "TEXTAREA"].includes(
    event.target.tagName,
  );
  if (formInput && (mode !== "flying" || activeModal)) return;
  if (event.key === "?" && !event.repeat) {
    showModal("guide");
    return;
  }
  if (event.code === "KeyM" && !event.repeat && !formInput) {
    $("sound-btn").click();
    return;
  }
  if (mode !== "flying") return;
  if (flightKeys.has(event.code)) {
    event.preventDefault();
    keys.add(event.code);
  }
  if (event.repeat) return;
  if (event.code === "KeyC") cycleCamera();
  if (event.code === "KeyF") {
    event.preventDefault();
    $("flaps-btn").click();
  }
  if (event.code === "KeyH") setHud(!hudHidden);
  if (event.code === "KeyR") {
    pause();
    $("restart-btn").focus();
  }
});
document.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});
window.addEventListener("blur", () => {
  clearInput();
  if (mode === "flying") pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && mode === "flying") pause();
});
window.addEventListener("gamepadconnected", () => {
  if (mode === "flying") toast("Gamepad connected. Left stick to fly.");
});

$("world").addEventListener("contextmenu", (event) => event.preventDefault());
$("world").addEventListener("pointerdown", (event) => {
  if (mode !== "flying") return;
  pointer.looking = event.button === 2 || (cameraMode === 2 && !mousePilot);
  if (!pointer.looking && !mousePilot) return;
  pointer.id = event.pointerId;
  pointer.x = pointer.lastX = event.clientX;
  pointer.y = pointer.lastY = event.clientY;
  $("world").setPointerCapture(event.pointerId);
  event.preventDefault();
});
$("world").addEventListener("pointermove", (event) => {
  if (pointer.id !== event.pointerId || mode !== "flying") return;
  if (pointer.looking) {
    orbitAngle -= (event.clientX - pointer.lastX) * 0.007;
    orbitPitch = clamp(
      orbitPitch + (event.clientY - pointer.lastY) * 0.005,
      -0.65,
      1.3,
    );
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
  } else {
    pointer.roll = clamp((event.clientX - pointer.x) / 120, -1, 1);
    pointer.pitch = clamp((event.clientY - pointer.y) / 120, -1, 1);
  }
});
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  $("world").addEventListener(eventName, (event) => {
    if (event.pointerId !== pointer.id) return;
    pointer.id = null;
    pointer.pitch = pointer.roll = 0;
    if (pointer.looking && cameraMode !== 2) {
      orbitAngle = 0;
      orbitPitch = 0.2;
    }
    pointer.looking = false;
  });
}
$("world").addEventListener(
  "wheel",
  (event) => {
    if (mode === "flying") {
      zoom = clamp(zoom + event.deltaY * 0.001, 0.6, 2.8);
      event.preventDefault();
    }
  },
  { passive: false },
);
const joystick = $("joystick");
function moveStick(event) {
  if (event.pointerId !== stick.id) return;
  const rect = joystick.getBoundingClientRect();
  let x = (event.clientX - rect.left - rect.width / 2) / (rect.width * 0.37);
  let y = (event.clientY - rect.top - rect.height / 2) / (rect.height * 0.37);
  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  stick.roll = x;
  stick.pitch = y;
  $("joystick-thumb").style.transform =
    `translate(${x * rect.width * 0.32}px, ${y * rect.height * 0.32}px)`;
}
joystick.addEventListener("pointerdown", (event) => {
  stick.id = event.pointerId;
  joystick.setPointerCapture(event.pointerId);
  moveStick(event);
  event.preventDefault();
});
joystick.addEventListener("pointermove", moveStick);
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"])
  joystick.addEventListener(eventName, (event) => {
    if (event.pointerId === stick.id) {
      stick.id = null;
      stick.pitch = stick.roll = 0;
      $("joystick-thumb").style.transform = "";
    }
  });
for (const [id, value] of [
  ["yaw-left", -1],
  ["yaw-right", 1],
]) {
  $(id).addEventListener("pointerdown", (event) => {
    stick.yaw = value;
    $(id).setPointerCapture(event.pointerId);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    $(id).addEventListener(name, () => {
      stick.yaw = 0;
    });
}
$("world").addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  pause();
  $("load-error").hidden = false;
  $("load-error-message").textContent =
    "The graphics connection was interrupted. Reload to prepare a fresh flight.";
});
requestAnimationFrame(() => setTimeout(init, 20));
