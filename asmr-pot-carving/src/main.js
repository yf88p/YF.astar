import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "./style.css";
import { icon, toolArt } from "./icons.js";
import { PotteryStudio } from "./studio.js";
import { PotteryAudio } from "./audio.js";

const tools = [
  {
    id: "loop",
    name: "Loop tool",
    action: "Carve & groove",
    hint: "Slow passes. Satisfying ribbons.",
    key: "1",
  },
  {
    id: "rib",
    name: "Wooden rib",
    action: "Shape & refine",
    hint: "A broad touch for a softer silhouette.",
    key: "2",
  },
  {
    id: "needle",
    name: "Needle",
    action: "Etch & detail",
    hint: "Make your mark, one fine line at a time.",
    key: "3",
  },
  {
    id: "sponge",
    name: "Soft sponge",
    action: "Smooth & soften",
    hint: "Soften the edges. Let the clay settle.",
    key: "4",
  },
];
const app = document.querySelector("#app");
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="./" aria-label="Still pottery studio"><span class="brand-mark"><i></i><i></i><i></i></span><span>still<span class="brand-dot">.</span></span><span class="brand-caption">a pottery studio</span></a>
    <nav class="main-nav" aria-label="Main navigation"><button class="nav-link active" id="studio-tab">The studio <span class="nav-dot"></span></button><button class="nav-link" id="collection-tab">My collection <span id="collection-count">0</span></button></nav>
    <div class="header-actions"><button class="sound-toggle" id="sound-toggle" aria-pressed="false">${icon("mute")}<span>Sound off</span></button><button class="save-button" id="save-piece">${icon("save")}<span>Save piece</span></button></div>
  </header>
  <main class="workspace" id="studio-view">
    <aside class="tool-sidebar">
      <div class="intro"><div class="eyebrow"><span class="tiny-line"></span> LESS NOISE. MORE FEELING.</div><h1>A little clay.<br>A little <em>quiet.</em></h1><p>No right way. No rush.<br>Just you and the clay.</p></div>
      <section class="toolkit" aria-labelledby="toolkit-title"><div class="section-label"><h2 id="toolkit-title">YOUR TOOLKIT</h2><span>01 — 04</span></div><div class="tool-list">${tools.map((t, i) => `<button class="tool-card ${i === 0 ? "selected" : ""}" data-tool="${t.id}" aria-pressed="${i === 0}" title="${t.name} (${t.key})">${toolArt(t.id)}<span class="tool-copy"><strong>${t.name}</strong><span>${t.action}</span></span><kbd>${t.key}</kbd><span class="tool-selected-dot"></span></button>`).join("")}</div></section>
      <button class="help-link" id="open-guide">${icon("help")}<span>A moment to get acquainted</span>${icon("arrow")}</button>
    </aside>
    <section class="stage" aria-label="Interactive pottery wheel">
      <div class="stage-top"><div class="piece-heading"><span class="live-dot"></span><span>YOUR MOMENT OF STILL</span></div><span class="session-label">SESSION <span id="session-time">00:00</span></span></div>
      <div class="canvas-wrap" id="canvas-wrap"><canvas id="pottery-canvas" aria-label="3D clay pot. Click and drag on the clay to carve. Right-drag or use two fingers to orbit." tabindex="0"></canvas><div class="loading" id="loading"><span class="loading-ring"></span>Centering your clay…</div><div class="canvas-badge"><span class="live-dot"></span><span id="wheel-state">ON THE WHEEL</span></div><div class="view-controls"><button id="rotate-view" title="Rotate view" aria-label="Rotate camera view">${icon("eye")}</button><button id="reset-view" title="Reset camera" aria-label="Reset camera view">${icon("reset")}</button></div><div class="tool-cursor" id="tool-cursor"><span></span></div><div class="contact-label" id="contact-label">carving</div><div class="canvas-caption"><span class="caption-rule"></span><p>Something good takes <em>its own time.</em></p><span class="caption-rule"></span></div></div>
      <div class="interaction-hint" id="interaction-hint">${icon("hand")}<span>Touch the clay. Hold & drag to leave your mark.</span><kbd>↵</kbd></div>
      <div class="wheel-console"><button class="wheel-play" id="wheel-toggle" title="Pause wheel (Space)" aria-label="Pause wheel">${icon("pause")}</button><div class="wheel-control"><div class="wheel-label"><label for="wheel-speed">Wheel speed</label><output id="speed-value">45 <span>rpm</span></output></div><input type="range" id="wheel-speed" min="0" max="90" value="45" aria-label="Wheel speed" style="--value:50%" /></div><div class="console-divider"></div><button class="console-icon" id="undo" disabled title="Undo last stroke (Ctrl+Z)">${icon("undo")}<span>Undo</span></button><button class="console-icon" id="reset" title="Start a fresh piece">${icon("reset")}<span>Start over</span></button></div>
      <div class="stage-footnote"><span>DRAG TO CARVE</span><span class="footnote-dot">·</span><span>RIGHT-DRAG TO LOOK AROUND</span><span class="footnote-dot">·</span><span>SCROLL TO ZOOM</span></div>
    </section>
    <aside class="clay-sidebar">
      <section class="clay-panel"><div class="section-label"><h2>THE MATERIAL</h2>${icon("leaf")}</div><div class="material-preview"><div class="clay-ball"></div><span class="material-batch">Nº 001</span></div><div class="material-name"><h3 id="clay-name">Terracotta</h3><span class="material-tag">EARTHENWARE</span></div><p class="material-description" id="clay-description">Warm, honest, a little imperfect.<br> Just the way we like it.</p><div class="clay-swatches" aria-label="Clay color"><button class="clay-swatch active" style="--swatch:#b97f61" data-clay="terracotta" title="Terracotta" aria-label="Terracotta" aria-pressed="true"></button><button class="clay-swatch" style="--swatch:#c4b8a3" data-clay="porcelain" title="Ivory stoneware" aria-label="Ivory stoneware" aria-pressed="false"></button><button class="clay-swatch" style="--swatch:#797c71" data-clay="slate" title="Olive stoneware" aria-label="Olive stoneware" aria-pressed="false"></button><span>Made of earth.</span></div><div class="panel-divider"></div>
        <div class="slider-heading"><label for="wetness">${icon("water")}Moisture</label><output id="wetness-value">60<span>%</span></output></div><input type="range" id="wetness" min="10" max="100" value="60" style="--value:55.56%" /><div class="range-endpoints"><span>Dry & textured</span><span>Soft & silky</span></div>
        <div class="slider-heading pressure-heading"><label for="pressure">${icon("hand")}Tool pressure</label><output id="pressure-value">Gentle</output></div><input type="range" id="pressure" min="10" max="100" value="40" style="--value:33.33%" /><div class="range-endpoints"><span>A light touch</span><span>Dig a little deeper</span></div>
      </section>
      <section class="sound-card"><div class="sound-card-title">${icon("headphones")}<h2>Get a little closer.</h2><div class="sound-waves"><i></i><i></i><i></i><i></i></div></div><p>The soft scrape. The steady hum.<br> Best felt with headphones.</p><div class="sound-volume"><button id="sound-small" aria-label="Enable sound">${icon("mute")}</button><input type="range" id="volume" min="0" max="100" value="65" aria-label="Sound volume" style="--value:65%" /><span id="volume-value">65%</span></div></section>
      <div class="piece-stats"><div><span>CLAY REMOVED</span><strong id="removed-value">0.0 <small>g</small></strong></div><span class="stats-art">${icon("leaf")}</span><p>Every little mark is yours.</p></div>
    </aside>
  </main>
  <section class="collection-view" id="collection-view" hidden><div class="collection-intro"><div><div class="eyebrow">A FEW QUIET MOMENTS, KEPT.</div><h1>Your collection<span>.</span></h1><p>No two pieces, or moments, are quite the same.</p></div><button class="secondary-button" id="back-to-studio">Back to the wheel ${icon("arrow")}</button></div><div id="collection-grid" class="collection-grid"></div><p class="storage-note">Your pieces stay in this browser, on this device.</p></section>
  <footer class="footer"><span><span class="footer-dot"></span>A small space to slow down.</span><span>Handmade by you. <span class="footer-muted">No two alike.</span></span><button id="footer-guide">A few gentle pointers ${icon("arrow")}</button></footer>
  <div class="toast" id="toast" role="status"></div>
  <dialog id="guide-dialog" class="studio-dialog"><button class="dialog-close" aria-label="Close guide">${icon("close")}</button><div class="eyebrow">WELCOME TO YOUR STUDIO</div><h2>Let your hands wander.</h2><p class="dialog-intro">There’s nothing to get right here. Just a little space to make something that feels like you.</p><div class="guide-rows"><div>${icon("hand")}<span><strong>Meet the clay</strong>Hold and drag on the pot to carve. A rotating wheel turns a still touch into a continuous groove.</span></div><div>${icon("move")}<span><strong>Find another angle</strong>Right-drag to orbit, scroll to zoom. On touchscreens, use two fingers to look around.</span></div><div>${icon("water")}<span><strong>Follow the feeling</strong>More moisture makes softer cuts. More pressure goes deeper. A stylus adds its own pressure.</span></div><div>${icon("headphones")}<span><strong>Listen a little closer</strong>Switch sound on for live, spatial scraping and the quiet hum of the wheel.</span></div></div><div class="keyboard-hints"><span><kbd>1</kbd>–<kbd>4</kbd> Tools</span><span><kbd>Space</kbd> Wheel</span><span><kbd>Ctrl Z</kbd> Undo</span></div><button class="primary-button" id="begin-making">Make a little time ${icon("arrow")}</button></dialog>
  <dialog id="reset-dialog" class="studio-dialog small-dialog"><button class="dialog-close" aria-label="Cancel reset">${icon("close")}</button><div class="eyebrow">A FRESH BEGINNING</div><h2>Another possibility.</h2><p>This piece will return to its original shape. Save it first if you’d like to keep this moment.</p><div class="dialog-actions"><button class="secondary-button" id="cancel-reset">Keep making</button><button class="primary-button" id="confirm-reset">Start fresh ${icon("arrow")}</button></div></dialog>
  <dialog id="save-dialog" class="studio-dialog small-dialog"><button class="dialog-close" aria-label="Cancel save">${icon("close")}</button><div class="eyebrow">A MOMENT WORTH KEEPING</div><h2>Give it a name.</h2><form id="save-form"><label class="field-label" for="piece-name">PIECE NAME</label><input id="piece-name" class="text-input" maxlength="48" required placeholder="Sunday, slowly" autocomplete="off" /><p>Saved with every groove, in your personal collection.</p><button class="primary-button" type="submit">Keep this moment ${icon("save")}</button></form></dialog>
`;

const $ = (s) => document.querySelector(s);
const audio = new PotteryAudio();
const state = {
  tool: "loop",
  wetness: 0.6,
  pressure: 0.4,
  speed: 45,
  playing: true,
  sound: false,
  clay: "terracotta",
};
let studio;
let toastTimer;
let lastSavedName = "";
let savePending = false;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3200);
}

try {
  studio = new PotteryStudio($("#pottery-canvas"), state, audio, {
    onChange: (removed, canUndo) => {
      $("#removed-value").innerHTML =
        `${(removed * 920).toFixed(1)} <small>g</small>`;
      $("#undo").disabled = !canUndo;
    },
    onContact: (contact) => {
      $("#canvas-wrap").classList.toggle("is-carving", contact);
      if (contact) $("#interaction-hint").classList.add("experienced");
    },
    onReady: () => $("#loading").classList.add("loaded"),
  });
} catch (error) {
  console.error(error);
  $("#loading").innerHTML =
    "<strong>Your studio needs WebGL.</strong><span>Enable hardware acceleration in your browser, then refresh to begin.</span>";
  $("#loading").classList.add("webgl-error");
  $("#save-piece").disabled = true;
}

function selectTool(id) {
  state.tool = id;
  document.querySelectorAll(".tool-card[data-tool]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.tool === id);
    b.setAttribute("aria-pressed", String(b.dataset.tool === id));
  });
  const tool = tools.find((t) => t.id === id);
  $("#interaction-hint span").textContent = tool.hint;
  $("#contact-label").textContent = {
    loop: "carving",
    rib: "shaping",
    needle: "etching",
    sponge: "smoothing",
  }[id];
  $("#tool-cursor").dataset.tool = id;
}
document
  .querySelectorAll(".tool-card[data-tool]")
  .forEach((b) =>
    b.addEventListener("click", () => selectTool(b.dataset.tool)),
  );

function setWheel(playing) {
  state.playing = playing;
  $("#wheel-toggle").innerHTML = icon(playing ? "pause" : "play");
  $("#wheel-toggle").setAttribute(
    "aria-label",
    playing ? "Pause wheel" : "Start wheel",
  );
  $("#wheel-toggle").title = `${playing ? "Pause" : "Start"} wheel (Space)`;
  $("#wheel-state").textContent =
    playing && state.speed > 0 ? "ON THE WHEEL" : "A MOMENT OF PAUSE";
  $(".canvas-badge").classList.toggle("paused", !playing || !state.speed);
}
$("#wheel-toggle").addEventListener("click", () => setWheel(!state.playing));

document.querySelectorAll('input[type="range"]').forEach((input) => {
  input.addEventListener("input", () => {
    input.style.setProperty(
      "--value",
      `${((input.value - input.min) / (input.max - input.min)) * 100}%`,
    );
    const n = Number(input.value);
    if (input.id === "wheel-speed") {
      state.speed = n;
      $("#speed-value").innerHTML = `${n} <span>rpm</span>`;
      setWheel(state.playing);
    }
    if (input.id === "wetness") {
      state.wetness = n / 100;
      $("#wetness-value").innerHTML = `${n}<span>%</span>`;
      studio?.updateMaterial();
    }
    if (input.id === "pressure") {
      state.pressure = n / 100;
      $("#pressure-value").textContent =
        n < 45 ? "Gentle" : n < 75 ? "Steady" : "Firm";
    }
    if (input.id === "volume") {
      audio.setVolume(n / 100);
      $("#volume-value").textContent = `${n}%`;
    }
  });
});
audio.setVolume(0.65);

async function toggleSound() {
  const next = !state.sound;
  if (next) {
    const ready = await audio.enable();
    if (!ready) {
      toast("Audio isn’t available in this browser. The clay is still yours.");
      return;
    }
  } else audio.setEnabled(false);
  state.sound = next;
  $("#sound-toggle").innerHTML =
    `${icon(next ? "sound" : "mute")}<span>Sound ${next ? "on" : "off"}</span>`;
  $("#sound-toggle").setAttribute("aria-pressed", String(next));
  $("#sound-small").innerHTML = icon(next ? "sound" : "mute");
  $("#sound-small").setAttribute(
    "aria-label",
    next ? "Mute sound" : "Enable sound",
  );
  $(".sound-card").classList.toggle("sound-enabled", next);
}
$("#sound-toggle").addEventListener("click", toggleSound);
$("#sound-small").addEventListener("click", toggleSound);

const materials = {
  terracotta: {
    name: "Terracotta",
    tag: "EARTHENWARE",
    description:
      "Warm, honest, a little imperfect.<br> Just the way we like it.",
    color: "#b67e60",
  },
  porcelain: {
    name: "Ivory",
    tag: "STONEWARE",
    description:
      "A soft canvas for small details.<br> Let the light find your marks.",
    color: "#c9bdab",
  },
  slate: {
    name: "Olive",
    tag: "STONEWARE",
    description:
      "Earthy, grounded, quietly different.<br> A little closer to nature.",
    color: "#8c9280",
  },
};
function setClay(id) {
  state.clay = id;
  const mat = materials[id];
  $("#clay-name").textContent = mat.name;
  $(".material-tag").textContent = mat.tag;
  $("#clay-description").innerHTML = mat.description;
  $(".clay-ball").style.setProperty("--clay-color", mat.color);
  document.querySelectorAll("[data-clay]").forEach((b) => {
    b.classList.toggle("active", b.dataset.clay === id);
    b.setAttribute("aria-pressed", String(b.dataset.clay === id));
  });
  studio?.setColor(mat.color);
}
document
  .querySelectorAll("[data-clay]")
  .forEach((b) => b.addEventListener("click", () => setClay(b.dataset.clay)));
$("#undo").addEventListener("click", () => {
  if (studio?.undo()) toast("One step back. A new possibility.");
});
$("#reset").addEventListener("click", () => $("#reset-dialog").showModal());
$("#cancel-reset").addEventListener("click", () => $("#reset-dialog").close());
$("#confirm-reset").addEventListener("click", () => {
  studio?.reset();
  $("#reset-dialog").close();
  lastSavedName = "";
  toast("Fresh clay. A fresh beginning.");
});
$("#rotate-view").addEventListener("click", () => studio?.rotateView());
$("#reset-view").addEventListener("click", () => studio?.resetView());

for (const id of ["open-guide", "footer-guide"])
  $(`#${id}`).addEventListener("click", () => $("#guide-dialog").showModal());
$("#begin-making").addEventListener("click", () => $("#guide-dialog").close());
document
  .querySelectorAll(".dialog-close")
  .forEach((b) =>
    b.addEventListener("click", () => b.closest("dialog").close()),
  );
document.querySelectorAll("dialog").forEach((d) => {
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
  });
});

document.addEventListener("keydown", (e) => {
  if (
    /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
    document.querySelector("dialog[open]") ||
    $("#studio-view").hidden
  )
    return;
  if (e.code === "Space" && !e.target.closest("button, a")) {
    e.preventDefault();
    setWheel(!state.playing);
  }
  if (["1", "2", "3", "4"].includes(e.key))
    selectTool(tools[Number(e.key) - 1].id);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    studio?.undo();
  }
});

const STORAGE_KEY = "still.pieces.v1";
function getCollection() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data)
      ? data.filter(
          (p) =>
            typeof p.name === "string" &&
            Array.isArray(p.radii) &&
            p.radii.length === 37120 &&
            p.radii.every((v) => Number.isFinite(v) && v > 0.3 && v < 2) &&
            materials[p.clay] &&
            Number.isFinite(p.removed),
        )
      : [];
  } catch {
    return [];
  }
}
function updateCount() {
  $("#collection-count").textContent = getCollection().length;
}
updateCount();

$("#save-piece").addEventListener("click", () => {
  if (!studio) return;
  $("#piece-name").value =
    lastSavedName ||
    [
      "A quiet beginning",
      "Sunday, slowly",
      "A little closer",
      "Soft around the edges",
      "An unhurried afternoon",
    ][getCollection().length % 5];
  $("#save-dialog").showModal();
  $("#piece-name").select();
});
$("#save-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (savePending || !studio) return;
  const name = $("#piece-name").value.trim();
  if (!name) {
    $("#piece-name").setCustomValidity("Give your piece a name.");
    $("#piece-name").reportValidity();
    return;
  }
  savePending = true;
  try {
    const pieces = getCollection();
    if (pieces.length >= 12) {
      toast("Your shelf is full. Remove a piece to make a little room.");
      return;
    }
    const snapshot = studio.snapshot();
    const id =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pieces.unshift({
      id,
      name,
      date: new Date().toISOString(),
      clay: state.clay,
      wetness: state.wetness,
      removed: snapshot.removed,
      radii: Array.from(snapshot.radii, (v) => Math.round(v * 100000) / 100000),
      image: studio.capture(),
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pieces));
    lastSavedName = name;
    updateCount();
    $("#save-dialog").close();
    toast("A quiet moment, kept. Find it in My collection.");
  } catch {
    toast(
      "Your browser’s shelf is full or unavailable. Try removing an older piece.",
    );
  } finally {
    savePending = false;
  }
});
$("#piece-name").addEventListener("input", () =>
  $("#piece-name").setCustomValidity(""),
);

function showStudio() {
  $("#studio-view").hidden = false;
  $("#collection-view").hidden = true;
  $("#studio-tab").classList.add("active");
  $("#collection-tab").classList.remove("active");
  studio?.setVisible(true);
  studio?.resize();
  $("#save-piece").disabled = !studio;
}
$("#studio-tab").addEventListener("click", showStudio);
$("#back-to-studio").addEventListener("click", showStudio);
$("#collection-tab").addEventListener("click", () => {
  $("#studio-view").hidden = true;
  $("#collection-view").hidden = false;
  $("#studio-tab").classList.remove("active");
  $("#collection-tab").classList.add("active");
  studio?.setVisible(false);
  $("#save-piece").disabled = true;
  renderCollection();
});
function renderCollection() {
  const pieces = getCollection();
  const grid = $("#collection-grid");
  grid.replaceChildren();
  if (!pieces.length) {
    grid.innerHTML = `<div class="empty-collection"><div class="empty-pot">${icon("leaf")}</div><h2>A little room for possibility.</h2><p>Your collection begins with a moment at the wheel.<br>Save a piece when it feels like yours.</p><button class="primary-button" id="empty-start">Meet your clay ${icon("arrow")}</button></div>`;
    $("#empty-start").addEventListener("click", showStudio);
    return;
  }
  pieces.forEach((piece) => {
    const card = document.createElement("article");
    card.className = "saved-card";
    const image = document.createElement("img");
    image.src =
      typeof piece.image === "string" && piece.image.startsWith("data:image/")
        ? piece.image
        : "";
    image.alt = piece.name;
    card.append(image);
    const details = document.createElement("div");
    details.className = "saved-details";
    const name = document.createElement("h2");
    name.textContent = piece.name;
    details.append(name);
    const meta = document.createElement("p");
    meta.textContent = `${materials[piece.clay].name} · ${new Date(piece.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    details.append(meta);
    const actions = document.createElement("div");
    actions.className = "saved-actions";
    const load = document.createElement("button");
    load.innerHTML = `Back to the wheel ${icon("arrow")}`;
    load.addEventListener("click", () => {
      studio?.load(piece);
      setClay(piece.clay);
      state.wetness = Math.min(1, Math.max(0.1, Number(piece.wetness) || 0.6));
      $("#wetness").value = state.wetness * 100;
      $("#wetness").dispatchEvent(new Event("input"));
      lastSavedName = piece.name;
      showStudio();
      toast("Right where you left it.");
    });
    actions.append(load);
    const download = document.createElement("button");
    download.innerHTML = icon("download");
    download.title = "Download photograph";
    download.setAttribute("aria-label", `Download ${piece.name}`);
    download.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = image.src;
      a.download = `${piece.name.replace(/[^a-z0-9 -]/gi, "") || "still-piece"}.jpg`;
      a.click();
    });
    actions.append(download);
    const remove = document.createElement("button");
    remove.innerHTML = icon("trash");
    remove.title = "Remove from collection";
    remove.setAttribute("aria-label", `Remove ${piece.name}`);
    let confirmed = false;
    remove.addEventListener("click", () => {
      if (!confirmed) {
        confirmed = true;
        remove.innerHTML = icon("check");
        remove.title = "Click again to confirm removal";
        toast("Tap the checkmark to remove this piece.");
        setTimeout(() => {
          if (remove.isConnected) {
            confirmed = false;
            remove.innerHTML = icon("trash");
          }
        }, 4000);
        return;
      }
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(getCollection().filter((p) => p.id !== piece.id)),
        );
        updateCount();
        renderCollection();
      } catch {
        toast("This browser couldn’t update your collection.");
      }
    });
    actions.append(remove);
    details.append(actions);
    card.append(details);
    grid.append(card);
  });
}

const started = Date.now();
setInterval(() => {
  const s = Math.floor((Date.now() - started) / 1000);
  $("#session-time").textContent =
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}, 1000);
document.addEventListener("visibilitychange", () => {
  studio?.setVisible(!document.hidden && !$("#studio-view").hidden);
});
window.addEventListener("pagehide", () => audio.dispose(), { once: true });
