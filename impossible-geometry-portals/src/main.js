import { Vector3 } from "three";
import { World, cloneDocument } from "./core.js";
import { LEVELS, createStressLevel } from "./levels.js";
import { PortalRenderer } from "./render.js";
import { Editor } from "./editor.js";
import { SolutionReplay } from "./replay.js";
import { SpatialAudio } from "./audio.js";
import "./style.css";
import "./editor.css";

const icons = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  external: '<path d="M6 18 18 6M6 6h12v12"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.5"/>',
  portal: '<path d="M5 20V4h10v16H5ZM9 20V8h10v12H9Z"/>',
  gravity: '<path d="M6 3v12m-3-3 3 3 3-3M6 20h13V7m-3 3 3-3 3 3"/>',
  loop: '<path d="M17 3h4v4M21 3l-7 7M7 21H3v-4m0 4 7-7M7 3H3v4m14 14h4v-4M3 7a9 9 0 0 1 14-3M21 17a9 9 0 0 1-14 3"/>',
  settings: '<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',
  volume:
    '<path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 4-6 5H2v6h3l6 5V4ZM16 9l6 6m0-6-6 6"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  book: '<path d="M12 5c-4-3-9-2-9-2v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Zm0 0v16"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 17 6-7 5 5 3-3 4 5"/><circle cx="16" cy="7" r="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-11v1"/>',
  edit: '<path d="m4 16 12-12 4 4L8 20H4v-4ZM13 7l4 4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  jump: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.portal}</svg>`;
const logo =
  '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="m20 3 16 9v17l-16 9-16-9V12l16-9Z" stroke="currentColor" stroke-width="1.5"/><path d="m20 3 0 18 16 8M4 12l16 9v17M4 29l16-8 16-9" stroke="currentColor" stroke-width="1.5"/><path d="m12 16 8-4 8 4v9l-8 4-8-4v-9Z" fill="currentColor"/></svg>';
const $ = (s) => document.querySelector(s);
const app = $("#app");
app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#" aria-label="Parallax home">${logo}<span>PARALLAX<small>A STUDY IN IMPOSSIBLE SPACE</small></span></a>
    <nav class="main-nav" aria-label="Main navigation"><button class="nav-item active" id="nav-play">Play<span class="nav-dot"></span></button><button class="nav-item" id="nav-editor">Level editor ${icon("external")}</button><button class="nav-item" id="nav-guide">Field guide</button></nav>
    <div class="header-actions"><span class="local-label"><i></i> ALL SYSTEMS LOCAL</span><button class="icon-button" id="audio-button" title="Mute audio" aria-label="Mute audio">${icon("volume")}</button><button class="icon-button" id="settings-button" title="Settings" aria-label="Settings">${icon("settings")}</button></div>
  </header>
  <main class="workspace">
    <section class="page-heading"><div><p class="eyebrow">THE OBSERVATORY / INTERACTIVE EXPERIMENTS</p><h1>A different kind of perspective<span>.</span></h1></div><div class="edition">THREE CHAMBERS.<br>NO ORDINARY DOORWAYS.</div></section>
    <div class="lab-layout">
      <section class="chamber-shell" aria-label="Game viewport">
        <div class="chamber-bar"><div class="chamber-title"><span class="number-tag" id="chamber-number">01</span><span id="chamber-name">The Delivery</span><span class="slash">/</span><span class="chamber-subtitle" id="chamber-concept">OBJECT TRANSFER</span></div><div class="scene-status"><i></i><span id="simulation-status">LIVE ENVIRONMENT</span></div></div>
        <div id="viewport">
          <div class="view-top"><span class="location-label"><i></i><span id="room-name">THE ATRIUM</span></span><span class="view-mode" id="view-mode">FIRST PERSON <span>01 / A</span></span></div>
          <div class="crosshair" id="crosshair"><span></span></div>
          <div class="intro" id="intro"><div class="intro-tag"><span></span> STEP INTO THE UNEXPECTED</div><h2>Not every doorway<br>plays by the rules.</h2><p>The other side is closer than you think.</p><button class="primary-button" id="enter-button">Enter chamber ${icon("external")}</button><span class="capture-note">CLICK TO CAPTURE MOUSE <span>·</span> ESC TO RELEASE</span></div>
          <div class="portal-caption" id="portal-caption"><span class="small-cross">+</span><span>ONE OPENING.<br><strong>ANOTHER POINT OF VIEW.</strong></span></div>
          <div class="interaction-prompt" id="interaction-prompt" hidden></div>
          <div class="viewport-toolbar"><button class="view-button" id="pause-button" title="Pause" aria-label="Pause">${icon("pause")}</button><button class="view-button" id="image-button" title="Export current view" aria-label="Export current view">${icon("image")}</button><button class="view-button" id="fullscreen-button" title="Fullscreen" aria-label="Fullscreen">${icon("expand")}</button></div>
          <div class="view-coordinates" id="view-coordinates">X +1.70 &nbsp; Y +0.86 &nbsp; Z +4.80</div>
          <div class="pause-overlay" id="pause-overlay" hidden><div class="pause-card"><p class="eyebrow" id="pause-eyebrow">TAKE YOUR TIME</p><h2 id="pause-heading">A moment of stillness.</h2><p id="pause-description">The world will be right where you left it.</p><button class="primary-button" id="resume-button">Back to the chamber ${icon("play")}</button><button class="text-button" id="inspect-button">Inspect the frozen world ${icon("external")}</button></div></div>
          <div class="replay-banner" id="replay-banner" hidden><span><i></i> SOLUTION REPLAY <strong id="replay-label"></strong></span><button id="stop-replay">Stop ${icon("close")}</button></div>
          <div class="editor-banner" id="editor-banner" hidden><span>${icon("edit")} AUTHORING VIEW <small>Drag to orbit · scroll to zoom</small></span><span id="editor-count"></span></div>
          <div class="touch-controls" id="touch-controls" hidden><div class="touch-pad"><button data-move="forward" aria-label="Move forward">${icon("jump")}</button><button data-move="left" aria-label="Move left">${icon("arrow")}</button><button data-move="back" aria-label="Move backward">${icon("jump")}</button><button data-move="right" aria-label="Move right">${icon("arrow")}</button></div><div class="touch-actions"><button id="touch-jump" aria-label="Jump">${icon("jump")}</button><button id="touch-pick" aria-label="Pick up or drop">${icon("cube")}</button><button id="touch-throw" aria-label="Throw">${icon("external")}</button></div></div>
          <div id="performance-overlay" hidden></div>
        </div>
        <div class="chamber-footer"><span class="physics-badge"><i></i> REAL SPACE. DIFFERENT CONNECTIONS.</span><div><span id="session-time">00:00</span><button id="restart-button">${icon("reset")} Restart <kbd>R</kbd></button></div></div>
      </section>
      <aside class="mission-panel" id="mission-panel">
        <div class="mission-eyebrow"><span>YOUR EXPERIMENT</span><span id="mission-index">01 / 03</span></div>
        <h2 id="mission-title">A little weight.<br>A new <em>way through.</em></h2>
        <p class="mission-description" id="mission-description">Two rooms. One unlikely connection. Get the cube to the other side and find your way out.</p>
        <div class="connection-diagram" id="connection-diagram" aria-label="Room connectivity diagram"></div>
        <div class="objective-header"><span>THE OBJECTIVE</span><span id="objective-progress">0 / 3</span></div>
        <ol class="objectives" id="objectives"></ol>
        <button class="hint-button" id="hint-button">${icon("info")} A nudge, not the answer ${icon("chevron")}</button><div class="hint-copy" id="hint-copy" hidden></div>
        <div class="controls-mini"><p class="eyebrow">MAKE YOURSELF AT HOME</p><div><span class="key-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Move</span><span class="key-group">${icon("external")}</span><span>Look</span></div><div><span class="key-group"><kbd>E</kbd></span><span>Pick up / drop</span><span class="key-group"><kbd>␣</kbd></span><span>Jump</span></div><button class="text-button" id="all-controls">All controls ${icon("external")}</button></div>
        <div class="mission-bottom"><span class="orbit-symbol">◎</span><span>Curiosity is your best compass.</span></div>
      </aside>
      <aside id="editor-panel" hidden></aside>
    </div>
    <section class="chamber-selection" aria-label="Select a puzzle"><div class="selection-label"><span>CHOOSE YOUR CHAMBER</span><span>EXPLORE IN YOUR OWN ORDER ${icon("arrow")}</span></div><div class="level-cards" id="level-cards"></div></section>
    <footer class="site-footer"><span>PARALLAX LABS <span class="footer-slash">/</span> QUESTION THE SPACE BETWEEN.</span><span>BUILT TO BE EXPLORED. <button id="footer-editor">AND REBUILT. ${icon("external")}</button></span></footer>
  </main>
  <dialog id="settings-dialog"><div class="dialog-heading"><div><p class="eyebrow">TUNE YOUR EXPERIENCE</p><h2>A comfortable perspective.</h2></div><button class="icon-button" data-close aria-label="Close settings">${icon("close")}</button></div><div class="settings-fields"><label>Mouse sensitivity <output id="sensitivity-value">1.0</output><input id="sensitivity" type="range" min="0.2" max="2.5" step="0.1" value="1"></label><label>Sound volume <output id="volume-value">35%</output><input id="volume" type="range" min="0" max="1" step="0.05" value=".35"></label><label class="select-setting">Portal recursion depth<select id="recursion"><option value="3">3 traversals · balanced</option><option value="4">4 traversals · detailed</option></select></label><label class="check-setting"><span>Reduced motion<small>No animated interface transitions. Camera has no head bob.</small></span><input type="checkbox" id="reduced-motion"></label><label class="check-setting"><span>Performance overlay<small>Actual timings, render passes, and target memory.</small></span><input type="checkbox" id="show-performance"></label></div><p class="dialog-note">Everything runs on your device. Settings are saved in this browser.</p><button class="primary-button" data-close>Back to the experiment ${icon("arrow")}</button></dialog>
  <dialog id="guide-dialog"><div class="dialog-heading"><div><p class="eyebrow">THE PARALLAX FIELD GUIDE</p><h2>Change your point of view.</h2></div><button class="icon-button" data-close aria-label="Close field guide">${icon("close")}</button></div><div class="guide-grid"><article><span class="guide-number">01</span><h3>Space is connected.</h3><p>These aren't pictures. Every portal is a live opening into another room. Look through another opening and you may see yourself looking back.</p></article><article><span class="guide-number">02</span><h3>Momentum comes with you.</h3><p>Your position, view, and velocity rotate together. Drop through a floor and fly out of a wall. Gravity always pulls down in the room you enter.</p></article><article><span class="guide-number">03</span><h3>Bring something along.</h3><p>A cube has one identity, even when it spans two rooms. Pick through a portal, carry it across, or throw it. Only supported weight powers a plate.</p></article></div><div class="guide-controls"><div><kbd>W A S D</kbd><span>Walk</span></div><div><kbd>MOUSE</kbd><span>Look around</span></div><div><kbd>SPACE</kbd><span>Jump</span></div><div><kbd>E</kbd><span>Pick up / drop</span></div><div><kbd>LEFT CLICK</kbd><span>Throw held cube</span></div><div><kbd>R</kbd><span>Restart chamber</span></div><div><kbd>ESC / P</kbd><span>Pause / release mouse</span></div><div><kbd>F</kbd><span>Fullscreen</span></div></div><p class="dialog-note">On touchscreens: use the movement pad, drag the right side to look, and use the object buttons. When mouse capture is unavailable, drag the scene to look.</p><details class="solution-details"><summary>Need to see it in motion? <span>SPOILERS AHEAD</span></summary><p>Watch a deterministic solution to the current built-in chamber. It uses the same walking, pickup, portal physics, and mechanisms as you do. Your current run will restart.</p><button class="secondary-button" id="watch-solution">${icon("play")} Watch this chamber's solution</button></details></dialog>
  <div class="toast-region" id="toast-region" aria-live="polite"></div>
`;

const concepts = ["OBJECT TRANSFER", "GRAVITY & MOMENTUM", "RECURSIVE SPACE"];
const titles = [
  "A little weight.<br>A new <em>way through.</em>",
  "What falls down<br>can fly <em>sideways.</em>",
  "The long way<br>is a <em>different way.</em>",
];
const descriptions = [
  "Two rooms. One unlikely connection. Get the cube to the other side and find your way out.",
  "A balcony, a long drop, an unreachable island. Height is only the beginning of the journey.",
  "Three galleries, connected in a loop. Follow the openings. Leave a little weight behind.",
];
const objectiveText = [
  [
    "Find the companion cube",
    "Deliver it through the portal",
    "Power the exit & step through",
  ],
  [
    "Leave the high balcony",
    "Let the portal redirect your fall",
    "Reach the raised island",
  ],
  [
    "Bring the cube to the relay",
    "Power the gallery door",
    "Find your way into the vault",
  ],
];
const hints = [
  [
    "The cube is the small, pale object on the floor. Walk closer and look down.",
    "A held cube can travel through the opening before you do. Keep it in view.",
    "In the amber room, the square floor sensor needs weight that is resting, not held.",
  ],
  [
    "The teal opening is directly below, not on the wall.",
    "Stop your sideways motion when you are above the opening. You need height, not a running jump.",
    "After the crossing, release movement and let your speed carry you to the island.",
  ],
  [
    "The first north opening leads into the violet relay. Bring the cube.",
    "The plate in the relay is left of the central sightline. The door it controls is in another room.",
    "Continue north into the gold gallery, then look to your right.",
  ],
];
let levelIndex = 0,
  mode = "ready",
  world = new World(LEVELS[0]),
  authored = cloneDocument(LEVELS[0]),
  editor = null,
  replay = null,
  playtesting = false;
let yaw = world.input.yaw,
  pitch = world.input.pitch,
  sensitivity = 1,
  hintIndex = 0,
  hadCube = false,
  delivered = false,
  completionShown = false;
let frameTimes = [],
  renderTimes = [],
  lastFrame = performance.now(),
  lastUi = 0,
  pointerDown = null,
  dragLook = false,
  showPerformance = false;
const keys = new Set(),
  touch = { forward: 0, strafe: 0, jump: false };
const audio = new SpatialAudio();
let settings = {
  sensitivity: 1,
  volume: 0.35,
  recursion: 3,
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  showPerformance: false,
  muted: false,
};
try {
  settings = {
    ...settings,
    ...JSON.parse(localStorage.getItem("parallax.settings") || "{}"),
  };
} catch {
  /* Storage can be unavailable in private contexts. */
}
let completedLevels = [];
try {
  completedLevels = JSON.parse(
    localStorage.getItem("parallax.completed") || "[]",
  );
  if (!Array.isArray(completedLevels)) completedLevels = [];
} catch {}
let view;
try {
  view = new PortalRenderer($("#viewport"), world);
} catch (error) {
  $("#intro").innerHTML =
    "<h2>A graphics context is needed.</h2><p>Enable WebGL in your browser and reload to explore the observatory.</p>";
  console.error(error);
  throw error;
}

function notify(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $("#toast-region").append(toast);
  setTimeout(() => toast.remove(), 5000);
}
function storeSettings() {
  try {
    localStorage.setItem("parallax.settings", JSON.stringify(settings));
  } catch {}
}
function applySettings() {
  sensitivity = Math.max(0.2, Math.min(2.5, Number(settings.sensitivity) || 1));
  audio.setVolume(Math.max(0, Math.min(1, Number(settings.volume) || 0)));
  audio.setMuted(!!settings.muted);
  view.recursion = settings.recursion === 4 ? 4 : 3;
  view.reducedMotion = !!settings.reducedMotion;
  showPerformance = !!settings.showPerformance;
  document.body.classList.toggle("reduced-motion", !!settings.reducedMotion);
  $("#performance-overlay").hidden = !showPerformance;
  $("#sensitivity").value = sensitivity;
  $("#sensitivity-value").textContent = sensitivity.toFixed(1);
  $("#volume").value = audio.volume;
  $("#volume-value").textContent = `${Math.round(audio.volume * 100)}%`;
  $("#recursion").value = view.recursion;
  $("#reduced-motion").checked = !!settings.reducedMotion;
  $("#show-performance").checked = showPerformance;
  $("#audio-button").innerHTML = icon(settings.muted ? "muted" : "volume");
  $("#audio-button").setAttribute(
    "aria-label",
    settings.muted ? "Unmute audio" : "Mute audio",
  );
}
applySettings();

function cards() {
  $("#level-cards").innerHTML = LEVELS.map(
    (level, i) =>
      `<button class="level-card ${i === levelIndex ? "selected" : ""}" data-level="${i}" style="--level-accent:${level.accent}" aria-label="Select chamber ${i + 1}: ${level.name}" aria-pressed="${i === levelIndex}"><span class="level-number">0${i + 1}</span><span class="level-card-copy"><span class="level-concept">${concepts[i]}</span><strong>${level.name}</strong></span><span class="level-card-art">${icon(["portal", "gravity", "loop"][i])}</span><span class="level-end">${completedLevels.includes(level.id) ? icon("check") : i === levelIndex ? "<i></i>" : icon("external")}</span></button>`,
  ).join("");
  document
    .querySelectorAll("[data-level]")
    .forEach((b) => (b.onclick = () => selectLevel(Number(b.dataset.level))));
}
function diagram() {
  const rooms = world.doc.rooms;
  const w = 256,
    h = 98;
  const nodes = rooms.slice(0, 4);
  const spacing = (w - 68) / Math.max(1, nodes.length - 1);
  const svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${rooms.length} rooms, ${world.doc.portals.length / 2} linked portal pairs"><defs><pattern id="diagram-grid" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".6" fill="#536158"/></pattern></defs><rect width="256" height="98" fill="url(#diagram-grid)" opacity=".4"/>${nodes.length > 1 ? `<path d="M34 39 H${34 + spacing * (nodes.length - 1)}" stroke="#708c7e" stroke-dasharray="3 4" fill="none"/>` : ""}${nodes.map((r, i) => `<rect x="${10 + i * spacing}" y="15" width="48" height="48" rx="1" fill="#182820" stroke="${i === 0 ? "#8bdab8" : i === 1 ? "#d7b98a" : "#b49bdc"}"/><path d="M${58 + i * spacing} 30v18" stroke="${i === 0 ? "#8bdab8" : "#d7b98a"}" stroke-width="4"/><text x="${34 + i * spacing}" y="44" text-anchor="middle" fill="#c8d4c7" font-size="11" font-family="monospace">0${i + 1}</text><text x="${34 + i * spacing}" y="83" text-anchor="middle" fill="#8c9e8e" font-size="8" font-family="monospace">${["ORIGIN", "ELSEWHERE", "RETURN"][i] || "ROOM"}</text>`).join("")}${nodes.length === 3 ? '<path d="M34 14V6H222V14" fill="none" stroke="#a995c5" stroke-dasharray="3 3"/>' : ""}</svg>`;
  $("#connection-diagram").innerHTML = svg;
}
function updateLevelUi() {
  $("#chamber-number").textContent =
    levelIndex >= 0 ? `0${levelIndex + 1}` : "ED";
  $("#chamber-name").textContent = world.doc.name;
  $("#chamber-concept").textContent =
    concepts[levelIndex] || "CUSTOM EXPERIMENT";
  $("#mission-index").textContent =
    levelIndex >= 0 ? `0${levelIndex + 1} / 03` : "CUSTOM";
  $("#mission-title").innerHTML =
    titles[levelIndex] || "A space of<br>your <em>own making.</em>";
  $("#mission-description").textContent =
    descriptions[levelIndex] || world.doc.description;
  $("#objectives").innerHTML = (
    objectiveText[levelIndex] || [
      "Explore your connected rooms",
      "Activate the mechanisms",
      "Reach the goal zone",
    ]
  )
    .map(
      (t, i) =>
        `<li id="objective-${i}"><span class="objective-check">${icon("check")}</span><span>${t}</span></li>`,
    )
    .join("");
  hintIndex = 0;
  $("#hint-copy").hidden = true;
  $("#watch-solution").disabled = levelIndex < 0;
  cards();
  diagram();
  updateModeUi();
}
function replaceWorld(doc) {
  world = new World(doc);
  view.setWorld(world);
  yaw = world.input.yaw;
  pitch = world.input.pitch;
  hadCube = false;
  delivered = false;
  completionShown = false;
  frameTimes = [];
  renderTimes = [];
}
function selectLevel(index) {
  releaseMouse();
  replay = null;
  playtesting = false;
  levelIndex = index;
  authored = cloneDocument(LEVELS[index]);
  replaceWorld(authored);
  if (mode === "editor" && editor) {
    editor.setDocument(authored);
    view.setEditor(true, {
      selectedRoom: authored.spawn.room,
      overlays: editor.overlays,
    });
  } else {
    mode = "ready";
    view.setEditor(false);
  }
  updateLevelUi();
}
function releaseMouse() {
  keys.clear();
  touch.forward = touch.strafe = 0;
  world.setInput({ forward: 0, strafe: 0, jump: false });
  if (document.pointerLockElement) document.exitPointerLock();
}
async function enter() {
  if (mode === "editor") return;
  mode = "playing";
  replay = null;
  updateModeUi();
  await audio.unlock().catch(() => {});
  if (!matchMedia("(pointer: coarse)").matches) {
    try {
      await view.renderer.domElement.requestPointerLock();
    } catch {
      notify("Mouse capture is unavailable. Drag inside the chamber to look.");
    }
  }
  view.renderer.domElement.focus({ preventScroll: true });
}
function pause() {
  if (mode === "editor" || mode === "complete") return;
  mode = "paused";
  replay = null;
  releaseMouse();
  updateModeUi();
}
function restart() {
  replay = null;
  const wasEditor = mode === "editor";
  releaseMouse();
  replaceWorld(playtesting && editor ? editor.doc : authored);
  mode = wasEditor ? "editor" : "ready";
  view.setEditor(wasEditor);
  updateLevelUi();
  notify("Chamber reset. All initial conditions restored.");
}
function updateModeUi() {
  const editing = mode === "editor",
    playing = mode === "playing",
    inspecting = mode === "inspect";
  document.body.classList.toggle("is-editing", editing);
  document.body.classList.toggle("is-playing", playing || mode === "replay");
  $("#intro").hidden = mode !== "ready";
  $("#portal-caption").hidden = mode !== "ready";
  $("#crosshair").hidden = editing || inspecting;
  $("#pause-overlay").hidden = !["paused", "complete"].includes(mode);
  $("#mission-panel").hidden = editing;
  $("#editor-panel").hidden = !editing;
  $("#editor-banner").hidden = !editing && !inspecting;
  $("#replay-banner").hidden = mode !== "replay";
  $("#touch-controls").hidden =
    !playing || !matchMedia("(pointer: coarse)").matches;
  $("#nav-editor").classList.toggle("active", editing);
  $("#nav-play").classList.toggle("active", !editing);
  $("#simulation-status").textContent = editing
    ? "AUTHORING / PHYSICS FROZEN"
    : mode === "paused" || inspecting
      ? "SIMULATION PAUSED"
      : mode === "replay"
        ? "LIVE INPUT REPLAY"
        : "LIVE ENVIRONMENT";
  $("#view-mode").textContent = editing
    ? "ORBIT / AUTHORING"
    : inspecting
      ? "ORBIT / FROZEN"
      : "FIRST PERSON";
  $("#pause-button").innerHTML = icon(
    playing || mode === "replay" ? "pause" : "play",
  );
  $("#pause-button").setAttribute(
    "aria-label",
    playing || mode === "replay" ? "Pause" : "Resume",
  );
  $("#nav-play").innerHTML = playtesting
    ? `Return to edit ${icon("edit")}`
    : 'Play<span class="nav-dot"></span>';
  if (mode === "complete") {
    $("#pause-eyebrow").textContent = "EXPERIMENT COMPLETE";
    $("#pause-heading").textContent = "A new perspective, found.";
    $("#pause-description").textContent =
      "You connected the spaces. The way through was there all along.";
    $("#resume-button").innerHTML =
      levelIndex >= 0 && levelIndex < 2
        ? `Next chamber ${icon("arrow")}`
        : `Explore again ${icon("reset")}`;
    $("#inspect-button").textContent = "Inspect your solution";
  } else {
    $("#pause-eyebrow").textContent = "TAKE YOUR TIME";
    $("#pause-heading").textContent = "A moment of stillness.";
    $("#pause-description").textContent =
      "The world will be right where you left it.";
    $("#resume-button").innerHTML = `Back to the chamber ${icon("play")}`;
    $("#inspect-button").innerHTML =
      `Inspect the frozen world ${icon("external")}`;
  }
  $("#editor-count").textContent =
    `${world.doc.rooms.length} ROOMS / ${world.doc.portals.length} PORTALS`;
}
function openEditor() {
  releaseMouse();
  replay = null;
  if (playtesting) {
    authored = cloneDocument(editor.doc);
    playtesting = false;
  } else if (mode !== "editor") authored = cloneDocument(authored);
  mode = "editor";
  replaceWorld(authored);
  view.setEditor(true, { overlays: editor?.overlays ?? true });
  if (editor) editor.dispose();
  editor = new Editor({
    container: $("#editor-panel"),
    doc: authored,
    notify,
    onChange: (doc, meta) => {
      authored = cloneDocument(doc);
      levelIndex = LEVELS.findIndex((l) => l.id === doc.id);
      if (!meta.editorOnly) {
        const oldPos = view.orbitCamera.position.clone(),
          oldTarget = view.orbit.target.clone(),
          room = view.focusedRoom;
        replaceWorld(doc);
        if (room === meta.selectedRoom) {
          view.orbitCamera.position.copy(oldPos);
          view.orbit.target.copy(oldTarget);
        }
        updateLevelUi();
      }
      view.setEditor(true, meta);
      $("#editor-count").textContent =
        `${doc.rooms.length} ROOMS / ${doc.portals.length} PORTALS`;
    },
    onPlaytest: (doc) => {
      authored = cloneDocument(doc);
      playtesting = true;
      replaceWorld(doc);
      mode = "ready";
      view.setEditor(false);
      updateLevelUi();
      notify("Isolated playtest. Return to edit restores your authored scene.");
    },
    onExit: () => {
      authored = cloneDocument(editor.doc);
      playtesting = false;
      replaceWorld(authored);
      mode = "ready";
      view.setEditor(false);
      updateLevelUi();
    },
    onImage: () => view.image(),
  });
  updateLevelUi();
}
function openDialog(id) {
  if (mode === "playing" || mode === "replay") pause();
  $(id).showModal();
}
function startReplay() {
  if (levelIndex < 0) {
    notify("Solution replays are available for the three built-in chambers.");
    return;
  }
  releaseMouse();
  $("#guide-dialog").close();
  replaceWorld(LEVELS[levelIndex]);
  mode = "replay";
  view.setEditor(false);
  replay = new SolutionReplay(world, levelIndex);
  audio.unlock().catch(() => {});
  updateModeUi();
}
function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else
    $("#viewport")
      .requestFullscreen?.()
      .catch(() => notify("Fullscreen is unavailable in this browser."));
}

$("#enter-button").onclick = enter;
$("#resume-button").onclick = () => {
  if (mode === "complete") {
    if (levelIndex >= 0 && levelIndex < 2) selectLevel(levelIndex + 1);
    else restart();
  } else enter();
};
$("#pause-button").onclick = () =>
  mode === "playing" || mode === "replay"
    ? pause()
    : mode === "editor"
      ? editor.onPlaytest(editor.doc)
      : enter();
$("#restart-button").onclick = restart;
$("#settings-button").onclick = () => openDialog("#settings-dialog");
$("#nav-guide").onclick = () => openDialog("#guide-dialog");
$("#all-controls").onclick = () => openDialog("#guide-dialog");
$("#nav-editor").onclick = openEditor;
$("#footer-editor").onclick = openEditor;
$("#nav-play").onclick = () => {
  if (playtesting) openEditor();
  else if (mode === "editor") editor.onExit();
  else if (mode === "paused" || mode === "inspect") enter();
};
$(".brand").onclick = (e) => {
  e.preventDefault();
  selectLevel(0);
};
$("#image-button").onclick = () => view.image();
$("#fullscreen-button").onclick = fullscreen;
$("#watch-solution").onclick = startReplay;
$("#stop-replay").onclick = restart;
$("#inspect-button").onclick = () => {
  mode = "inspect";
  view.setEditor(true, { overlays: false, selectedRoom: world.player.room });
  updateModeUi();
  notify(
    "Physics is frozen. Drag to orbit. Use Resume to return to first person.",
  );
};
$("#audio-button").onclick = () => {
  settings.muted = !settings.muted;
  audio.unlock().catch(() => {});
  applySettings();
  storeSettings();
};
$("#hint-button").onclick = () => {
  const list = hints[levelIndex] || [world.doc.lesson];
  $("#hint-copy").textContent = list[hintIndex++ % list.length];
  $("#hint-copy").hidden = false;
};
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  }),
);
for (const [id, key] of [
  ["sensitivity", "sensitivity"],
  ["volume", "volume"],
  ["recursion", "recursion"],
  ["reduced-motion", "reducedMotion"],
  ["show-performance", "showPerformance"],
])
  $("#" + id).addEventListener("input", (e) => {
    settings[key] =
      e.target.type === "checkbox" ? e.target.checked : Number(e.target.value);
    applySettings();
    storeSettings();
  });

document.addEventListener("pointerlockchange", () => {
  if (
    !document.pointerLockElement &&
    mode === "playing" &&
    !matchMedia("(pointer: coarse)").matches
  ) {
    mode = "paused";
    keys.clear();
    updateModeUi();
  }
});
document.addEventListener("mousemove", (e) => {
  if (mode !== "playing" || (!document.pointerLockElement && !dragLook)) return;
  yaw -= e.movementX * 0.002 * sensitivity;
  pitch = Math.max(
    -1.55,
    Math.min(1.55, pitch - e.movementY * 0.002 * sensitivity),
  );
  world.look(yaw, pitch);
});
const canvas = view.renderer.domElement;
canvas.addEventListener("pointerdown", (e) => {
  pointerDown = { x: e.clientX, y: e.clientY };
  if (mode === "ready") {
    enter();
    return;
  }
  if (mode === "playing" && document.pointerLockElement) {
    if (world.held && e.button === 0) world.throwHeld();
    return;
  }
  if (mode === "playing") {
    dragLook = true;
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener("pointerup", (e) => {
  dragLook = false;
  if (
    mode === "editor" &&
    pointerDown &&
    Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) < 5
  ) {
    const id = view.pickEditor(e.clientX, e.clientY);
    if (id) editor.select(id);
  }
  pointerDown = null;
});
canvas.addEventListener("pointermove", (e) => {
  if (mode === "playing" && e.pointerType === "touch" && dragLook) {
    yaw -= e.movementX * 0.004 * sensitivity;
    pitch = Math.max(
      -1.55,
      Math.min(1.55, pitch - e.movementY * 0.004 * sensitivity),
    );
    world.look(yaw, pitch);
  }
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,select,textarea") || $("dialog[open]")) return;
  if (mode === "editor") return;
  if (
    [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ].includes(e.code)
  ) {
    if (mode === "playing") {
      e.preventDefault();
      keys.add(e.code);
    }
    return;
  }
  if (e.repeat) return;
  if (e.code === "KeyE" && mode === "playing") {
    e.preventDefault();
    if (!world.interact())
      notify(
        "Look at a cube within four meters. You can pick through a portal.",
      );
  }
  if (e.code === "KeyR") restart();
  if (e.code === "KeyP" || e.code === "Escape") {
    if (mode === "playing" || mode === "replay") pause();
    else if (mode === "paused") enter();
  }
  if (e.code === "KeyF") fullscreen();
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  if (mode === "playing") pause();
});
document.querySelectorAll("[data-move]").forEach((b) => {
  const update = (active) => {
    const m = b.dataset.move;
    if (m === "forward" || m === "back")
      touch.forward = active ? (m === "forward" ? 1 : -1) : 0;
    else touch.strafe = active ? (m === "left" ? -1 : 1) : 0;
  };
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    update(true);
  });
  b.addEventListener("pointerup", () => update(false));
  b.addEventListener("pointercancel", () => update(false));
});
$("#touch-jump").onclick = () => {
  world.setInput({ jump: true });
  touch.jump = true;
  setTimeout(() => {
    touch.jump = false;
    world.setInput({ jump: false });
  }, 100);
};
$("#touch-pick").onclick = () => world.interact();
$("#touch-throw").onclick = () => world.throwHeld();

function uiTick() {
  $("#room-name").textContent = (
    world.rooms.get(world.player.room)?.name || "OBSERVATORY"
  ).toUpperCase();
  $("#session-time").textContent =
    `${String(Math.floor(world.time / 60)).padStart(2, "0")}:${String(Math.floor(world.time % 60)).padStart(2, "0")}`;
  const p = world.player.position;
  $("#view-coordinates").textContent =
    `X ${p.x >= 0 ? "+" : ""}${p.x.toFixed(2)}   Y ${p.y >= 0 ? "+" : ""}${p.y.toFixed(2)}   Z ${p.z >= 0 ? "+" : ""}${p.z.toFixed(2)}`;
  let progress =
    levelIndex === 1
      ? [
          world.player.position.z < 1.7 || world.player.room !== "drop-shaft",
          world.crossings > 0,
          world.completed,
        ]
      : [hadCube, delivered, world.completed];
  if (levelIndex === 2)
    progress = [
      delivered,
      [...world.plates.values()].some((p) => p.active),
      world.completed,
    ];
  if (levelIndex < 0)
    progress = [
      world.crossings > 0,
      [...world.plates.values()].some((p) => p.active),
      world.completed,
    ];
  progress.forEach((active, i) =>
    $("#objective-" + i)?.classList.toggle("done", active),
  );
  $("#objective-progress").textContent =
    `${progress.filter(Boolean).length} / 3`;
  const prompt = $("#interaction-prompt");
  prompt.hidden = mode !== "playing";
  if (mode === "playing") {
    if (world.held) {
      prompt.innerHTML =
        "<kbd>E</kbd> Set down <span></span> <kbd>CLICK</kbd> Throw";
      $("#crosshair").classList.add("target");
    } else {
      const frame = world.cameraFrame(),
        hit = world.raycast(
          frame.position,
          new Vector3(0, 0, -1).applyQuaternion(frame.quaternion),
          4,
          6,
          frame.room,
        );
      prompt.hidden = hit?.type !== "cube";
      if (hit?.type === "cube")
        prompt.innerHTML = `<kbd>E</kbd> Pick up cube ${hit.path.length ? "<small>THROUGH PORTAL</small>" : ""}`;
      $("#crosshair").classList.toggle("target", hit?.type === "cube");
    }
  }
  if (replay) $("#replay-label").textContent = replay.label;
  if (showPerformance) {
    const avg =
      frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, frameTimes.length);
    $("#performance-overlay").textContent =
      `${(1000 / avg || 0).toFixed(0)} FPS / ${avg.toFixed(1)} ms\n${view.stats.views} views / depth ${view.stats.maxDepth}\n${view.stats.drawCalls} draws / ${(view.stats.triangles / 1000).toFixed(0)}k triangles\n${(view.stats.targetBytes / 1048576).toFixed(1)} MiB targets\n120 Hz physics / max 12 substeps`;
  }
}
function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  const elapsed = now - lastFrame;
  lastFrame = now;
  if (mode === "playing") {
    view.setEditor(false);
    world.setInput({
      forward:
        touch.forward +
        (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
        (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
      strafe:
        touch.strafe +
        (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
        (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
      jump: touch.jump || keys.has("Space"),
      yaw,
      pitch,
    });
    world.advance(dt);
  } else if (mode === "replay" && replay) {
    replay.update(dt);
    yaw = world.input.yaw;
    pitch = world.input.pitch;
    if (replay.error) {
      notify(replay.error, "error");
      mode = "paused";
      updateModeUi();
    }
  }
  for (const event of world.events.splice(0)) {
    audio.event(event, world);
    if (event.type === "pickup") hadCube = true;
    if (event.type === "crossing" && event.id !== "player") delivered = true;
    if (
      event.type === "crossing" &&
      event.id === "player" &&
      !view.reducedMotion
    ) {
      $("#viewport").classList.remove("crossing");
      void $("#viewport").offsetWidth;
      $("#viewport").classList.add("crossing");
    }
  }
  if (world.completed && !completionShown && mode !== "editor") {
    completionShown = true;
    mode = "complete";
    releaseMouse();
    if (!completedLevels.includes(world.doc.id)) {
      completedLevels.push(world.doc.id);
      try {
        localStorage.setItem(
          "parallax.completed",
          JSON.stringify(completedLevels),
        );
      } catch {}
    }
    updateModeUi();
    cards();
  }
  audio.update(world.cameraFrame());
  view.render();
  frameTimes.push(elapsed);
  renderTimes.push(view.stats.renderMs);
  if (frameTimes.length > 600) {
    frameTimes.shift();
    renderTimes.shift();
  }
  if (now - lastUi > 100) {
    uiTick();
    lastUi = now;
  }
  requestAnimationFrame(frame);
}
updateLevelUi();
requestAnimationFrame(frame);

// Public inspection surface. Replays use exactly the gameplay APIs, never success flags.
window.parallax = {
  get world() {
    return world;
  },
  get view() {
    return view;
  },
  get editor() {
    return editor;
  },
  get mode() {
    return mode;
  },
  get replay() {
    return replay;
  },
  selectLevel,
  startReplay,
  openEditor,
  restart,
  pause,
  enter,
  loadStress() {
    releaseMouse();
    replay = null;
    levelIndex = -1;
    authored = createStressLevel();
    replaceWorld(authored);
    mode = "ready";
    view.setEditor(false);
    updateLevelUi();
  },
  loadDocument(doc) {
    const validated = new World(doc);
    releaseMouse();
    levelIndex = -1;
    authored = cloneDocument(validated.doc);
    replaceWorld(authored);
    mode = "ready";
    view.setEditor(false);
    updateLevelUi();
  },
  measure() {
    const sorted = [...frameTimes].sort((a, b) => a - b);
    return {
      mode,
      level: world.doc.id,
      rooms: world.doc.rooms.length,
      portalPairs: world.doc.portals.length / 2,
      cubes: world.cubes.size,
      resolution: [
        view.renderer.domElement.width,
        view.renderer.domElement.height,
      ],
      cssResolution: [view.width, view.height],
      recursion: view.recursion,
      physics: world.doc.physics,
      samples: sorted.length,
      meanFrameMs: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length,
      p50FrameMs: sorted[Math.floor(sorted.length * 0.5)],
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
      meanRenderCpuMs:
        renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length,
      ...view.stats,
    };
  },
};
