import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Compass,
  Map as MapIcon,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import SpatialCanvas, { sceneIndex } from "./Canvas.jsx";
import {
  clampCamera,
  fitProject,
  frameNode,
  interpolateCamera,
  sampleCamera,
  timelineDuration,
  zoomAt,
} from "./core.js";

const Canvas = React.memo(SpatialCanvas);

export const VIEWER_CSS = `
.folia-viewer { --fv-ink:#254c3c; --fv-muted:#657467; --fv-paper:#f6f3e9; --fv-line:#d9dfd1; position:fixed; inset:0; z-index:1000; isolation:isolate; display:grid; grid-template-rows:auto minmax(0,1fr) auto; width:100%; height:100%; height:100dvh; overflow:hidden; background:var(--fv-paper); color:var(--fv-ink); font:14px/1.5 Arial,Helvetica,sans-serif; text-align:left; color-scheme:light; }
.folia-viewer *, .folia-viewer *::before, .folia-viewer *::after { box-sizing:border-box; }
.folia-viewer button, .folia-viewer input { font:inherit; accent-color:var(--fv-ink); }
.folia-viewer button { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:40px; padding:8px 13px; border:1px solid var(--fv-line); border-radius:8px; background:transparent; color:inherit; cursor:pointer; box-shadow:none; letter-spacing:normal; text-transform:none; line-height:1.3; }
.folia-viewer button:hover:not(:disabled) { background:#e7ebdf; border-color:#aab9a3; }
.folia-viewer button:disabled { opacity:.38; cursor:default; }
.folia-viewer button:focus-visible, .folia-viewer input:focus-visible, .folia-viewer [role=button]:focus-visible { outline:3px solid #b97943; outline-offset:4px; }
.folia-viewer svg { flex-shrink:0; }
.folia-viewer .fv-icon { width:40px; height:40px; padding:10px; flex-shrink:0; }
.folia-viewer .fv-header { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:18px 28px 14px; min-width:0; }
.folia-viewer .fv-identity { display:flex; align-items:center; gap:20px; min-width:0; }
.folia-viewer .fv-brand { gap:7px; border:0; padding:0; font:32px/1 Georgia,'Times New Roman',serif; letter-spacing:-1.5px; }
.folia-viewer .fv-brand:hover:not(:disabled) { background:transparent; }
.folia-viewer .fv-project { min-width:0; margin:0; padding-left:20px; border-left:1px solid #cdd5c5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; font-weight:500; }
.folia-viewer .fv-header-actions { display:flex; align-items:center; gap:16px; flex-shrink:0; }
.folia-viewer .fv-explore { border-radius:24px; padding:9px 17px; }
.folia-viewer .fv-explore[aria-pressed=true] { color:var(--fv-paper); background:var(--fv-ink); border-color:var(--fv-ink); }
.folia-viewer .fv-motion { display:flex; align-items:center; gap:7px; font-size:12px; cursor:pointer; white-space:nowrap; }
.folia-viewer .fv-motion input { width:15px; height:15px; margin:0; }
.folia-viewer .fv-stage { position:relative; min-width:0; min-height:0; margin:0 22px; overflow:hidden; border:1px solid var(--fv-line); border-radius:12px; background:#e9eddf; background-image:radial-gradient(#74896b25 .7px,transparent .7px); background-size:16px 16px; }
.folia-viewer .fv-stage > .spatial-canvas { display:block; position:absolute; inset:0; width:100%; height:100%; overflow:hidden; touch-action:none; user-select:none; cursor:grab; }
.folia-viewer .fv-stage[data-dragging=true] > .spatial-canvas { cursor:grabbing; }
.folia-viewer .canvas-text { width:100%; height:100%; white-space:pre-wrap; line-height:1.2; user-select:text; -webkit-user-select:text; cursor:text; }
.folia-viewer .fv-breadcrumbs { position:absolute; top:14px; left:16px; right:70px; display:flex; align-items:center; gap:3px; width:fit-content; max-width:calc(100% - 86px); padding:3px 6px; border:1px solid #d3dccb; border-radius:7px; background:#f6f3e9f5; box-shadow:0 2px 12px #254c3c05; overflow-x:auto; scrollbar-width:thin; }
.folia-viewer .fv-breadcrumbs button { min-height:28px; border:0; padding:4px 7px; max-width:170px; flex-shrink:0; font-size:11px; white-space:nowrap; }
.folia-viewer .fv-breadcrumbs button span { overflow:hidden; text-overflow:ellipsis; }
.folia-viewer .fv-breadcrumbs button[aria-current] { font-weight:700; }
.folia-viewer .fv-map-toggle { position:absolute; top:14px; right:14px; background:var(--fv-paper); }
.folia-viewer .fv-map { position:absolute; right:14px; top:63px; width:220px; padding:10px; background:var(--fv-paper); border:1px solid var(--fv-line); border-radius:9px; box-shadow:0 8px 30px #254c3c12; }
.folia-viewer .fv-map-heading { display:flex; justify-content:space-between; align-items:center; margin:0 0 6px; color:var(--fv-muted); font-size:9px; letter-spacing:1.5px; text-transform:uppercase; }
.folia-viewer .fv-map-heading button { min-height:24px; padding:3px; border:0; }
.folia-viewer .fv-map-surface { position:relative; display:block; width:100%; height:126px; padding:0; border:0; border-radius:4px; overflow:hidden; background:#e7ebdf; cursor:crosshair; }
.folia-viewer .fv-map-surface > svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.folia-viewer .fv-zoom { position:absolute; right:14px; bottom:14px; display:flex; gap:3px; padding:3px; border:1px solid var(--fv-line); border-radius:8px; background:var(--fv-paper); }
.folia-viewer .fv-zoom button { border:0; width:34px; min-height:34px; height:34px; padding:8px; }
.folia-viewer .fv-hint { position:absolute; left:18px; bottom:16px; margin:0; padding:5px 9px; max-width:calc(100% - 162px); border-radius:4px; background:#f6f3e9eb; color:#536b54; font-size:11px; pointer-events:none; }
.folia-viewer .fv-footer { width:min(1040px,100%); margin:0 auto; padding:16px 22px 20px; min-height:0; }
.folia-viewer .fv-card { overflow:hidden; border:1px solid #d2dac9; border-radius:12px; background:#fcfaf3; box-shadow:0 5px 24px #213d3008; }
.folia-viewer .fv-caption { display:grid; grid-template-columns:83px minmax(0,1fr) auto; align-items:start; gap:20px; padding:21px 24px 17px; max-height:32vh; max-height:32dvh; overflow-y:auto; scrollbar-width:thin; }
.folia-viewer .fv-chapter { display:flex; flex-direction:column; gap:5px; padding-top:2px; font-size:9px; letter-spacing:1.8px; text-transform:uppercase; }
.folia-viewer .fv-chapter-number { font:30px/1.1 Georgia,'Times New Roman',serif; letter-spacing:-1px; white-space:nowrap; }
.folia-viewer .fv-chapter-number small { font:12px Arial,sans-serif; letter-spacing:0; color:var(--fv-muted); }
.folia-viewer .fv-copy { min-width:0; }
.folia-viewer .fv-copy h1 { margin:0 0 7px; color:var(--fv-ink); font:27px/1.12 Georgia,'Times New Roman',serif; letter-spacing:-.6px; overflow-wrap:anywhere; }
.folia-viewer .fv-copy p { margin:0; max-width:700px; color:#5b6b5c; font-size:13px; line-height:1.65; white-space:pre-wrap; overflow-wrap:anywhere; }
.folia-viewer .fv-copy .fv-warning { margin-top:9px; color:#93482e; font-size:12px; }
.folia-viewer .fv-reveal { position:absolute; bottom:64px; left:50%; transform:translateX(-50%); width:max-content; max-width:calc(100% - 32px); min-height:36px; background:var(--fv-paper); font-size:11px; box-shadow:0 3px 15px #254c3c12; }
.folia-viewer .fv-copy .fv-choice-prompt { margin:12px 0 7px; color:var(--fv-ink); font-size:11px; font-weight:700; }
.folia-viewer .fv-choices { display:flex; flex-wrap:wrap; gap:7px; }
.folia-viewer .fv-choices button { justify-content:space-between; min-width:140px; max-width:100%; min-height:36px; padding:8px 11px; border-color:#bdcdb5; font-size:11px; text-align:left; overflow-wrap:anywhere; }
.folia-viewer .fv-choices button:first-child { background:#e7eddc; }
.folia-viewer .fv-choices button svg { margin-left:8px; }
.folia-viewer .fv-navigation { display:flex; align-items:center; gap:7px; padding-top:5px; }
.folia-viewer .fv-primary { background:var(--fv-ink); border-color:var(--fv-ink); color:var(--fv-paper); }
.folia-viewer .fv-primary:hover:not(:disabled) { background:#356047; border-color:#356047; }
.folia-viewer .fv-transport { display:flex; align-items:center; gap:12px; padding:9px 20px; border-top:1px solid #e4e7dc; }
.folia-viewer .fv-transport .fv-icon { width:32px; height:32px; min-height:32px; padding:7px; border:0; }
.folia-viewer .fv-play { white-space:nowrap; min-height:32px; padding:6px 10px; border:0; font-size:11px; }
.folia-viewer .fv-progress { flex:1; min-width:40px; height:24px; margin:0; cursor:pointer; background:transparent; }
.folia-viewer .fv-time { flex-shrink:0; font-size:10px; font-variant-numeric:tabular-nums; color:var(--fv-muted); }
.folia-viewer .fv-status { display:flex; justify-content:space-between; gap:12px; margin-top:9px; padding:0 3px; color:#677461; font-size:9px; letter-spacing:1.25px; text-transform:uppercase; }
.folia-viewer .fv-status > span:first-child { display:flex; align-items:center; gap:6px; }
.folia-viewer .fv-status-dot { width:5px; height:5px; border-radius:50%; background:#6c8760; }
.folia-viewer .fv-sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.folia-viewer.fv-loading { display:flex; align-items:center; justify-content:center; padding:28px; }
.folia-viewer .fv-load-card { width:min(480px,100%); padding:36px; border:1px solid var(--fv-line); border-radius:14px; background:#fcfaf3; }
.folia-viewer .fv-load-card h1 { margin:20px 0 12px; font:34px/1.1 Georgia,serif; }
.folia-viewer .fv-load-card p { color:#5b6b5c; overflow-wrap:anywhere; white-space:pre-wrap; }
@media (max-width:700px) {
  .folia-viewer .fv-header { gap:10px; padding:12px 16px; flex-wrap:wrap; }
  .folia-viewer .fv-identity { gap:12px; flex:1; }
  .folia-viewer .fv-brand { font-size:29px; }
  .folia-viewer .fv-project { padding-left:12px; font-size:11px; }
  .folia-viewer .fv-header-actions { gap:10px; }
  .folia-viewer .fv-motion { font-size:10px; }
  .folia-viewer .fv-explore { min-height:34px; padding:7px 11px; font-size:11px; }
  .folia-viewer .fv-stage { margin:0 10px; border-radius:8px; }
  .folia-viewer .fv-footer { padding:10px 10px 12px; }
  .folia-viewer .fv-caption { grid-template-columns:46px minmax(0,1fr); gap:12px; padding:16px; max-height:34dvh; }
  .folia-viewer .fv-chapter { font-size:8px; letter-spacing:1px; }
  .folia-viewer .fv-chapter-number { font-size:25px; }
  .folia-viewer .fv-copy h1 { font-size:23px; }
  .folia-viewer .fv-copy p { font-size:12px; line-height:1.55; }
  .folia-viewer .fv-navigation { grid-column:2; justify-content:flex-end; padding:0; }
  .folia-viewer .fv-navigation button { min-height:34px; height:34px; }
  .folia-viewer .fv-transport { gap:6px; padding:7px 10px; }
  .folia-viewer .fv-play span { display:none; }
  .folia-viewer .fv-status { font-size:8px; letter-spacing:.8px; }
  .folia-viewer .fv-keyboard-hint { display:none; }
  .folia-viewer .fv-hint { font-size:9px; left:10px; bottom:12px; }
  .folia-viewer .fv-breadcrumbs { left:10px; top:10px; }
  .folia-viewer .fv-map-toggle { top:10px; right:10px; }
}
@media (max-width:480px) {
  .folia-viewer .fv-identity { flex-basis:100%; }
  .folia-viewer .fv-header-actions { width:100%; justify-content:space-between; }
  .folia-viewer .fv-header-actions > .fv-icon { width:34px; height:34px; min-height:34px; }
  .folia-viewer .fv-choices button { width:100%; }
}
@media (max-height:540px) and (min-width:701px) {
  .folia-viewer .fv-header { padding:8px 22px; }
  .folia-viewer .fv-footer { padding-top:8px; padding-bottom:8px; }
  .folia-viewer .fv-caption { padding:12px 18px; max-height:28dvh; }
  .folia-viewer .fv-copy h1 { font-size:22px; }
  .folia-viewer .fv-status { display:none; }
}
`;

function presentation(project, viewport) {
  const index = sceneIndex(project);
  const nearestScene = new Map();
  for (const node of project.nodes) {
    let ancestor = node;
    while (ancestor && ancestor.type !== "scene")
      ancestor = index.byId.get(ancestor.parentId);
    nearestScene.set(node.id, ancestor?.id ?? null);
  }
  let time = 0;
  let camera = fitProject(project, viewport);
  const overview = camera;
  const stops = project.stops.map((stop) => {
    const missing = stop.targetId != null && !index.byId.has(stop.targetId);
    camera = missing
      ? camera
      : stop.frame
        ? clampCamera(stop.frame)
        : stop.targetId != null
          ? frameNode(project, stop.targetId, viewport, 70)
          : camera;
    const start = time;
    const dwellAt = start + (stop.transition ?? 0);
    time = dwellAt + (stop.dwell ?? 0);
    return { ...stop, start, dwellAt, end: time, camera, missing };
  });
  const stopById = new Map(stops.map((stop, i) => [stop.id, i]));
  const choices = new Map();
  for (const link of project.links) {
    const scene = nearestScene.get(link.sourceId);
    if (!scene) continue;
    const target = stops[stopById.get(link.targetStopId)];
    const source = index.byId.get(link.sourceId);
    const label =
      link.label?.trim() ||
      target?.title?.trim() ||
      source?.text?.trim() ||
      source?.name?.trim();
    if (!label) continue;
    if (!choices.has(scene)) choices.set(scene, new Map());
    choices
      .get(scene)
      .set(JSON.stringify([label, link.targetStopId]), { ...link, label });
  }
  const scenes = project.nodes
    .filter((node) => node.type === "scene")
    .map((node) => {
      const m = index.matrices.get(node.id);
      const w = Math.abs(m[0]) * node.w + Math.abs(m[2]) * node.h;
      const h = Math.abs(m[1]) * node.w + Math.abs(m[3]) * node.h;
      const x = m[4] + (m[0] * node.w) / 2 + (m[2] * node.h) / 2;
      const y = m[5] + (m[1] * node.w) / 2 + (m[3] * node.h) / 2;
      const ancestors = [];
      for (let n = node; n; n = index.byId.get(n.parentId))
        ancestors.unshift(n);
      return { node, x, y, w, h, ancestors };
    });
  const miniViewport = { width: 198, height: 126 };
  const miniFit = fitProject(project, { width: 792, height: 504 });
  return {
    project,
    viewport,
    index,
    nearestScene,
    stops,
    stopById,
    choices,
    scenes,
    overview,
    total: timelineDuration(project),
    miniViewport,
    miniCamera: { ...miniFit, scale: miniFit.scale / 4 },
  };
}

function sampled(model, time, reduced) {
  const sample = sampleCamera(model.project, time, model.viewport);
  return {
    ...sample,
    time,
    camera:
      reduced && sample.stopIndex >= 0
        ? model.stops[sample.stopIndex].camera
        : sample.camera,
  };
}

function clock(time) {
  const seconds = Math.floor(time);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function Viewer({ project, onExit }) {
  const svgRef = useRef(null);
  const frameRef = useRef(null);
  const runtime = useRef({
    playing: false,
    explore: false,
    reduced: false,
    flight: null,
    drag: null,
    lastTick: null,
    choiceGuard: null,
  });
  const canvasHandlers = useRef({
    onBackgroundDown: (event) => runtime.current.pointerDown(event),
    onBranch: (id) => runtime.current.branch(id),
  });
  const modelRef = useRef(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 600 });
  if (
    !modelRef.current ||
    modelRef.current.project !== project ||
    modelRef.current.viewport !== viewport
  ) {
    modelRef.current = presentation(project, viewport);
  }
  const model = modelRef.current;
  const [view, setView] = useState(() => ({
    ...sampled(model, model.stops[0]?.dwellAt ?? 0, false),
    stopIndex: model.stops.length ? 0 : -1,
    phase: "dwell",
    camera: model.stops[0]?.camera ?? model.overview,
  }));
  const [playing, setPlaying] = useState(false);
  const [explore, setExplore] = useState(false);
  const [reduced, setReduced] = useState(() =>
    Boolean(
      project.settings?.reducedMotion ||
        globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    ),
  );
  const [showMap, setShowMap] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const r = runtime.current;
  Object.assign(r, { model, reduced, onExit });
  r.view ??= view;

  function updateView(next) {
    r.view = next;
    setView(next);
  }
  function playback(value) {
    r.playing = value;
    r.lastTick = null;
    setPlaying(value);
    if (value) requestFrame();
  }
  function mode(value) {
    r.explore = value;
    setExplore(value);
  }
  function requestFrame() {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame((now) => {
      frameRef.current = null;
      runtime.current.tick(now);
      if (runtime.current.playing || runtime.current.flight)
        runtime.current.requestFrame();
    });
  }
  function land(index, camera = r.model.stops[index].camera) {
    const stop = r.model.stops[index];
    updateView({
      camera,
      time: stop.dwellAt,
      stopIndex: index,
      phase: "dwell",
      localTime: 0,
    });
    r.choiceGuard = stop.choice ? stop.id : null;
  }
  function fly(camera, index = null) {
    playback(false);
    r.flight = null;
    if (r.reduced) {
      if (index !== null) land(index, camera);
      else updateView({ ...r.view, camera });
      return;
    }
    r.flight = { from: { ...r.view.camera }, to: camera, index, started: null };
    if (index !== null)
      updateView({ ...r.view, stopIndex: index, phase: "transition" });
    requestFrame();
  }
  function goStop(index) {
    if (index < 0 || index >= r.model.stops.length) return;
    const stop = r.model.stops[index];
    setNotice("");
    r.choiceGuard = null;
    mode(false);
    if (stop.missing) {
      playback(false);
      r.flight = null;
      land(index, r.view.camera);
    } else fly(stop.camera, index);
  }
  function branch(id) {
    const index = r.model.stopById.get(id);
    if (index === undefined) {
      playback(false);
      setNotice(
        "This path points to a chapter that is no longer available. Choose another path.",
      );
    } else goStop(index);
  }
  function enterExplore() {
    playback(false);
    r.flight = null;
    mode(true);
  }
  function goScene(id) {
    const camera =
      id == null
        ? r.model.overview
        : frameNode(r.model.project, id, r.model.viewport, 70);
    if (!camera) {
      setNotice("This scene is no longer available.");
      return;
    }
    enterExplore();
    setNotice("");
    fly(camera);
  }
  function toggleExplore() {
    if (!r.explore) enterExplore();
    else if (r.view.stopIndex >= 0) goStop(r.view.stopIndex);
    else {
      mode(false);
      fly(r.model.overview);
    }
  }
  function togglePlay() {
    if (r.playing) {
      playback(false);
      return;
    }
    const stop = r.model.stops[r.view.stopIndex];
    if (!stop || r.flight) return;
    if (
      stop.choice &&
      (r.view.phase === "dwell" || r.choiceGuard === stop.id)
    ) {
      setNotice("Choose a path or use Next to continue. Autoplay waits here.");
      return;
    }
    if (stop.missing) {
      setNotice("This chapter has a missing target. Use Next to continue.");
      return;
    }
    if (r.view.time >= r.model.total) return;
    if (r.explore) {
      goStop(r.view.stopIndex);
      setNotice("Back on the guided path. Press Play to continue.");
      return;
    }
    setNotice("");
    playback(true);
  }
  function seek(time) {
    playback(false);
    r.flight = null;
    mode(false);
    setNotice("");
    const next = sampled(
      r.model,
      Math.max(0, Math.min(r.model.total, time)),
      r.reduced,
    );
    updateView(next);
    const stop = r.model.stops[next.stopIndex];
    r.choiceGuard = stop?.choice && next.phase === "dwell" ? stop.id : null;
  }
  function tick(now) {
    if (r.flight) {
      const flight = r.flight;
      flight.started ??= now;
      const progress = r.reduced
        ? 1
        : Math.min(1, (now - flight.started) / 900);
      const camera = interpolateCamera(
        flight.from,
        flight.to,
        progress,
        "smooth",
        r.model.viewport,
      );
      if (progress === 1) {
        r.flight = null;
        if (flight.index !== null) land(flight.index, flight.to);
        else updateView({ ...r.view, camera: flight.to });
      } else updateView({ ...r.view, camera });
      return;
    }
    if (!r.playing) return;
    const elapsed =
      r.lastTick === null ? 0 : Math.max(0, now - r.lastTick) / 1000;
    r.lastTick = now;
    const time = Math.min(r.model.total, r.view.time + elapsed);
    // Test interval crossings, not sampled chapter identity: even zero-dwell choices must stop playback.
    const barrier = r.model.stops.findIndex(
      (stop, index) =>
        index >= r.view.stopIndex &&
        (stop.choice || stop.missing) &&
        stop.dwellAt >= r.view.time &&
        stop.dwellAt <= time,
    );
    if (barrier >= 0) {
      land(barrier);
      playback(false);
      return;
    }
    const stop = r.model.stops[r.view.stopIndex];
    // Dwells have a constant camera; avoid rebuilding the core hierarchy and SVG every frame.
    const next =
      r.view.phase === "dwell" && stop && time < stop.end
        ? { ...r.view, time, localTime: time - stop.dwellAt }
        : sampled(r.model, time, r.reduced);
    updateView(next);
    if (time >= r.model.total) playback(false);
  }
  function zoom(
    factor,
    point = { x: r.model.viewport.width / 2, y: r.model.viewport.height / 2 },
  ) {
    enterExplore();
    updateView({
      ...r.view,
      camera: zoomAt(r.view.camera, point, factor, r.model.viewport),
    });
  }
  function pointerDown(event) {
    if (
      event.button !== 0 ||
      event.isPrimary === false ||
      event.target.closest(
        '.canvas-text, [role="button"], a, input, textarea, [contenteditable="true"]',
      )
    )
      return;
    r.lastPointerNode = event.target
      .closest("[data-node-id]")
      ?.getAttribute("data-node-id");
    r.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera: r.view.camera,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    const drag = r.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved) {
      drag.camera = r.view.camera;
      drag.moved = true;
      enterExplore();
      setDragging(true);
    }
    event.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    updateView({
      ...r.view,
      camera: clampCamera({
        ...drag.camera,
        x:
          drag.camera.x -
          (dx * r.model.viewport.width) / rect.width / drag.camera.scale,
        y:
          drag.camera.y -
          (dy * r.model.viewport.height) / rect.height / drag.camera.scale,
      }),
    });
  }
  function pointerUp(event) {
    if (r.drag?.id !== event.pointerId) return;
    if (svgRef.current?.hasPointerCapture(event.pointerId))
      svgRef.current.releasePointerCapture(event.pointerId);
    r.drag = null;
    setDragging(false);
  }

  let currentScene = null;
  for (const scene of model.scenes) {
    if (
      Math.abs(view.camera.x - scene.x) > scene.w / 2 ||
      Math.abs(view.camera.y - scene.y) > scene.h / 2
    )
      continue;
    const visible = scene.ancestors.every((node) => {
      const m = model.index.matrices.get(node.id);
      const scale = Math.hypot(m[0], m[1]) * view.camera.scale;
      return (
        !node.hidden &&
        node.opacity !== 0 &&
        scale >= (node.minZoom ?? 0) &&
        scale <= (node.maxZoom ?? Infinity)
      );
    });
    if (
      visible &&
      (!currentScene ||
        scene.ancestors.length > currentScene.ancestors.length ||
        (scene.ancestors.length === currentScene.ancestors.length &&
          scene.w * scene.h < currentScene.w * currentScene.h))
    )
      currentScene = scene;
  }
  const breadcrumbs =
    currentScene?.ancestors.filter((node) => node.type === "scene") ?? [];
  function keyDown(event) {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.key !== "Escape" &&
        event.target.closest?.(
          'input, textarea, select, [contenteditable="true"]',
        ))
    )
      return;
    if (
      event.key === " " &&
      event.target.closest?.('button, [role="button"], a')
    )
      return;
    if (event.key === "ArrowRight") goStop(r.view.stopIndex + 1);
    else if (event.key === "ArrowLeft") goStop(r.view.stopIndex - 1);
    else if (event.key === " ") togglePlay();
    else if (event.key === "Home") {
      if (r.model.stops.length) goStop(0);
      else goScene(null);
    } else if (event.key === "Escape") {
      if (r.explore)
        goScene(
          breadcrumbs.length > 1
            ? breadcrumbs[breadcrumbs.length - 2].id
            : null,
        );
      else if (r.onExit) r.onExit();
      else enterExplore();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }
  Object.assign(r, {
    tick,
    requestFrame,
    keyDown,
    zoom,
    playback,
    pointerDown,
    branch,
  });

  useEffect(() => {
    const svg = svgRef.current;
    const measure = () => {
      const { width, height } = svg.getBoundingClientRect();
      if (width > 0 && height > 0)
        setViewport((old) =>
          old.width === width && old.height === height
            ? old
            : { width, height },
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    const wheel = (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const { viewport: vp } = runtime.current.model;
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? vp.height : 1);
      runtime.current.zoom(
        Math.exp(-Math.max(-600, Math.min(600, delta)) * 0.0015),
        {
          x: ((event.clientX - rect.left) * vp.width) / rect.width,
          y: ((event.clientY - rect.top) * vp.height) / rect.height,
        },
      );
    };
    const keyboard = (event) => runtime.current.keyDown(event);
    const visibility = () => {
      if (document.hidden) runtime.current.playback(false);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keyboard, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      svg.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("visibilitychange", visibility);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      runtime.current.flight = null;
      runtime.current.playing = false;
      runtime.current.drag = null;
    };
  }, []);

  useEffect(() => {
    const latest = runtime.current;
    const changedProject = latest.previousProject !== project;
    latest.previousProject = project;
    const flight = latest.flight;
    if (changedProject) {
      latest.flight = null;
      latest.lastPointerNode = null;
      latest.drag = null;
      setDragging(false);
      playback(false);
      mode(false);
      setNotice("");
      if (model.stops.length) land(0);
      else updateView(sampled(model, 0, reduced));
    } else if (flight?.index != null) {
      latest.flight = { ...flight, to: model.stops[flight.index].camera };
      requestFrame();
    } else if (!latest.explore) {
      if (latest.view.phase === "dwell" && model.stops[latest.view.stopIndex]) {
        const target = model.stops[latest.view.stopIndex];
        updateView({
          ...latest.view,
          camera: target.missing ? latest.view.camera : target.camera,
        });
      } else updateView(sampled(model, latest.view.time, reduced));
    }
  }, [model]);

  const stop = model.stops[view.stopIndex];
  const choiceLinks = stop?.choice
    ? [
        ...(model.choices
          .get(model.nearestScene.get(stop.targetId))
          ?.values() ?? []),
      ]
    : [];
  const atChoice = Boolean(stop?.choice && view.phase === "dwell");
  const ended = Boolean(
    stop &&
      view.time >= model.total &&
      view.stopIndex === model.stops.length - 1,
  );
  let revealScale = 0,
    revealMax = Infinity;
  for (
    let node = model.index.byId.get(stop?.targetId);
    node;
    node = model.index.byId.get(node.parentId)
  ) {
    const m = model.index.matrices.get(node.id),
      scale = Math.hypot(m[0], m[1]);
    revealScale = Math.max(revealScale, (node.minZoom ?? 0) / scale);
    revealMax = Math.min(
      revealMax,
      node.hidden || node.opacity === 0
        ? 0
        : (node.maxZoom ?? Infinity) / scale,
    );
  }
  const canReveal =
    !explore &&
    view.phase === "dwell" &&
    revealScale > view.camera.scale &&
    revealScale * 1.001 <= revealMax;
  const mini = model.miniCamera,
    miniVP = model.miniViewport;
  const miniRect = {
    x:
      (view.camera.x - viewport.width / view.camera.scale / 2 - mini.x) *
        mini.scale +
      miniVP.width / 2,
    y:
      (view.camera.y - viewport.height / view.camera.scale / 2 - mini.y) *
        mini.scale +
      miniVP.height / 2,
    width: (viewport.width / view.camera.scale) * mini.scale,
    height: (viewport.height / view.camera.scale) * mini.scale,
  };

  return (
    <section
      className="folia-viewer"
      aria-label={`${project.name || "Untitled story"} viewer`}
    >
      <style>{VIEWER_CSS}</style>
      <header className="fv-header">
        <div className="fv-identity">
          <button
            className="fv-brand"
            aria-label="Folia: restart story"
            onClick={() => (model.stops.length ? goStop(0) : goScene(null))}
          >
            <svg
              width="25"
              height="31"
              viewBox="0 0 25 31"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 29V11M12 20C3 20 1 13 2 7c8 0 12 5 10 13ZM12 13C12 5 17 2 23 2c1 8-4 13-11 11Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="m5 11 7 9M12 13l7-7"
                stroke="currentColor"
                strokeWidth="1.1"
              />
            </svg>
            folia<span className="fv-sr"> spatial stories</span>
          </button>
          <p className="fv-project" title={project.name}>
            {project.name || "Untitled story"}
          </p>
        </div>
        <div className="fv-header-actions">
          <button
            className="fv-explore"
            aria-pressed={explore}
            onClick={toggleExplore}
          >
            <Compass size={15} />
            Explore{explore && <Check size={13} />}
          </button>
          <label className="fv-motion">
            <input
              type="checkbox"
              checked={reduced}
              onChange={(event) => {
                r.reduced = event.target.checked;
                setReduced(event.target.checked);
                if (r.playing || r.flight) requestFrame();
              }}
            />
            Reduce motion
          </label>
          {onExit && (
            <button
              className="fv-icon"
              aria-label="Exit viewer"
              title="Exit viewer (Esc)"
              onClick={onExit}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </header>
      <main
        className="fv-stage"
        data-dragging={dragging}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onLostPointerCapture={pointerUp}
        onDoubleClick={(event) => {
          if (event.target.closest('.canvas-text, button, [role="button"]'))
            return;
          // Pointer capture can retarget double-clicks to the root SVG.
          const id =
            event.target
              .closest("[data-node-id]")
              ?.getAttribute("data-node-id") ?? r.lastPointerNode;
          const scene = model.nearestScene.get(id);
          if (scene) goScene(scene);
        }}
      >
        <Canvas
          project={project}
          camera={view.camera}
          viewport={viewport}
          viewer
          svgRef={svgRef}
          {...canvasHandlers.current}
        />
        <nav className="fv-breadcrumbs" aria-label="Scene breadcrumbs">
          <button
            onClick={() => goScene(null)}
            aria-label="Frame story overview"
            aria-current={!breadcrumbs.length ? "location" : undefined}
          >
            <Maximize size={12} />
            <span>Overview</span>
          </button>
          {breadcrumbs.map((node, i) => (
            <React.Fragment key={node.id}>
              <ChevronRight size={11} />
              <button
                onClick={() => goScene(node.id)}
                aria-current={
                  i === breadcrumbs.length - 1 ? "location" : undefined
                }
              >
                <span>{node.name || "Untitled scene"}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
        <button
          className="fv-icon fv-map-toggle"
          onClick={() => setShowMap(!showMap)}
          aria-label="Toggle overview map"
          aria-expanded={showMap}
          title="Overview map"
        >
          <MapIcon size={17} />
        </button>
        {showMap && (
          <aside className="fv-map" aria-label="Overview map">
            <div className="fv-map-heading">
              <span>The whole story</span>
              <button
                onClick={() => goScene(null)}
                aria-label="Fit entire story"
              >
                <Maximize size={12} />
              </button>
            </div>
            <button
              className="fv-map-surface"
              aria-label="Recenter using overview map"
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const x =
                  event.detail === 0
                    ? miniVP.width / 2
                    : ((event.clientX - bounds.left) / bounds.width) *
                      miniVP.width;
                const y =
                  event.detail === 0
                    ? miniVP.height / 2
                    : ((event.clientY - bounds.top) / bounds.height) *
                      miniVP.height;
                enterExplore();
                updateView({
                  ...r.view,
                  camera: clampCamera({
                    ...r.view.camera,
                    x: mini.x + (x - miniVP.width / 2) / mini.scale,
                    y: mini.y + (y - miniVP.height / 2) / mini.scale,
                  }),
                });
              }}
            >
              <Canvas
                project={project}
                camera={mini}
                viewport={miniVP}
                miniature
              />
              <svg
                viewBox={`0 0 ${miniVP.width} ${miniVP.height}`}
                aria-hidden="true"
              >
                <rect
                  {...miniRect}
                  fill="#254c3c12"
                  stroke="#254c3c"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </button>
          </aside>
        )}
        {canReveal && (
          <button
            className="fv-reveal"
            onClick={() => zoom((revealScale * 1.001) / r.view.camera.scale)}
          >
            <ZoomIn size={13} />
            Zoom in to reveal this scene
          </button>
        )}
        <p className="fv-hint">
          {explore
            ? "Drag to wander. Scroll to look closer."
            : "A story in layers. Scroll to explore."}
        </p>
        <div className="fv-zoom" aria-label="Camera controls">
          <button onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">
            <ZoomOut size={16} />
          </button>
          <button onClick={() => goScene(null)} aria-label="Return to overview">
            <Maximize size={14} />
          </button>
          <button onClick={() => zoom(1.5)} aria-label="Zoom in">
            <ZoomIn size={16} />
          </button>
        </div>
      </main>
      <footer className="fv-footer">
        <div className="fv-card">
          <div className="fv-caption">
            <div className="fv-chapter">
              <span>Chapter</span>
              <span className="fv-chapter-number">
                {String(Math.max(0, view.stopIndex + 1)).padStart(2, "0")}{" "}
                <small>/ {String(model.stops.length).padStart(2, "0")}</small>
              </span>
            </div>
            <div className="fv-copy">
              <h1>
                {stop?.title ||
                  (stop
                    ? `Chapter ${view.stopIndex + 1}`
                    : "Every story starts somewhere.")}
              </h1>
              <p>
                {stop?.caption ||
                  (!stop
                    ? "There are no guided chapters yet. Take your time, pan around, and discover the canvas at your own pace."
                    : "")}
              </p>
              {stop?.missing && (
                <p className="fv-warning" role="status">
                  Missing target: "{stop.targetId}". This chapter's object was
                  removed. Your view has not been redirected; use Next or choose
                  another chapter.
                </p>
              )}
              {stop?.choice && (
                <>
                  <p className="fv-choice-prompt">
                    {choiceLinks.length
                      ? "Choose a path. The story will wait for you."
                      : "No branch paths are available here. Use Next to continue."}
                  </p>
                  <div className="fv-choices">
                    {choiceLinks.map((link) => (
                      <button
                        key={JSON.stringify([link.label, link.targetStopId])}
                        onClick={() => branch(link.targetStopId)}
                        disabled={!model.stopById.has(link.targetStopId)}
                      >
                        <span>
                          {link.label}
                          {!model.stopById.has(link.targetStopId)
                            ? " (unavailable)"
                            : ""}
                        </span>
                        <ArrowRight size={13} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              {notice && (
                <p className="fv-warning" role="status">
                  {notice}
                </p>
              )}
            </div>
            <div className="fv-navigation">
              <button
                className="fv-icon"
                aria-label="Previous chapter"
                title="Previous chapter (Left arrow)"
                disabled={view.stopIndex <= 0}
                onClick={() => goStop(r.view.stopIndex - 1)}
              >
                <ArrowLeft size={17} />
              </button>
              <button
                className="fv-icon fv-primary"
                aria-label="Next chapter"
                title="Next chapter (Right arrow)"
                disabled={
                  view.stopIndex < 0 || view.stopIndex >= model.stops.length - 1
                }
                onClick={() => goStop(r.view.stopIndex + 1)}
              >
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
          <div className="fv-transport">
            <button
              className="fv-icon"
              aria-label="Restart story"
              title="Restart story (Home)"
              onClick={() => (model.stops.length ? goStop(0) : goScene(null))}
            >
              <RotateCcw size={14} />
            </button>
            <button
              className="fv-play"
              aria-label={playing ? "Pause story" : "Play story"}
              aria-pressed={playing}
              disabled={!stop || ended}
              onClick={togglePlay}
              title={
                atChoice
                  ? "Choose a path or use Next to continue"
                  : "Play or pause (Space)"
              }
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
              <span>{playing ? "Pause" : "Play"}</span>
            </button>
            <input
              className="fv-progress"
              type="range"
              min="0"
              max={model.total || 1}
              step="any"
              value={view.time}
              disabled={!model.total}
              aria-label="Story progress"
              aria-valuetext={`${view.time.toFixed(2)} of ${model.total.toFixed(2)} seconds${stop ? `, ${stop.title || `chapter ${view.stopIndex + 1}`}` : ""}`}
              onInput={(event) => seek(Number(event.currentTarget.value))}
            />
            <span className="fv-time">
              {clock(view.time)} / {clock(model.total)}
            </span>
          </div>
        </div>
        <div className="fv-status">
          <span>
            <i className="fv-status-dot" />
            {explore
              ? "Off the beaten path"
              : atChoice
                ? "Your path, your choice"
                : ended
                  ? "A new way of seeing"
                  : "A guided journey"}
          </span>
          <span className="fv-keyboard-hint">
            Arrow keys to travel / Space to pause
          </span>
          <span>Made with folia</span>
        </div>
        <div className="fv-sr" aria-live="polite" aria-atomic="true">
          {stop
            ? `Chapter ${view.stopIndex + 1} of ${model.stops.length}: ${stop.title}${atChoice ? ". Choose a path or use Next to continue." : ""}`
            : "No guided chapters."}
        </div>
      </footer>
    </section>
  );
}
