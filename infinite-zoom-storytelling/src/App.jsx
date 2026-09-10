import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  Focus,
  FolderOpen,
  Frame,
  GitBranch,
  GripVertical,
  Group,
  Hand,
  HelpCircle,
  Image,
  Italic,
  Layers,
  Leaf,
  Link,
  Lock,
  Maximize,
  Minus,
  MoreHorizontal,
  MousePointer2,
  MoveHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Unlock,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Canvas, { sceneIndex, screenMatrix, visibleNodes } from "./Canvas.jsx";
import Viewer from "./Viewer.jsx";
import { createBlank, createExample } from "./example.js";
import {
  applyMatrix,
  clampCamera,
  deleteNodes,
  fitProject,
  frameNode,
  groupNodes,
  interpolateCamera,
  inverse,
  reparent,
  sampleCamera,
  timelineDuration,
  uid,
  ungroupNode,
  validateProject,
  worldBounds,
  worldMatrix,
  zoomAt,
} from "./core.js";
import {
  exportProject,
  importImage,
  importProject,
  listProjects,
  loadProject,
  publishProject,
  removeProject,
  saveProject,
} from "./storage.js";

const timeLabel = (t) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const stopTime = (p, i) =>
  p.stops.slice(0, i).reduce((s, n) => s + n.transition + n.dwell, 0) +
  (p.stops[i]?.transition || 0);
const pretty = (n) =>
  Math.abs(n) >= 1e6 || (Math.abs(n) < 0.001 && n !== 0)
    ? n.toExponential(3)
    : Number(n.toFixed(3));
function IconButton({ icon: Icon, label, active, className = "", ...props }) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={17} strokeWidth={1.65} />
    </button>
  );
}
function Field({
  label,
  value,
  onCommit,
  type = "text",
  step = "any",
  ...props
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        key={`${value}`}
        defaultValue={value ?? ""}
        type={type}
        step={step}
        onBlur={(e) => {
          const v = type === "number" ? Number(e.target.value) : e.target.value;
          if (v !== value) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
        {...props}
      />
    </label>
  );
}
function TextField({ label, value, onCommit, rows = 4 }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        key={value}
        defaultValue={value || ""}
        rows={rows}
        onBlur={(e) => {
          if (e.target.value !== value) onCommit(e.target.value);
        }}
      />
    </label>
  );
}
function Logo() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <Leaf size={21} strokeWidth={1.5} />
      </span>
      <span>
        folia<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
const ScenePreview = React.memo(function ScenePreview({
  project,
  targetId,
  frame,
  width,
  height,
}) {
  const viewport = { width, height };
  const target = project.nodes.find((n) => n.id === targetId);
  const camera =
    frameNode(project, targetId, viewport, 3) ||
    frame ||
    fitProject(project, viewport);
  return (
    <Canvas
      project={project}
      camera={camera}
      viewport={viewport}
      miniature
      override={!!target?.parentId}
    />
  );
});

export default function App() {
  const [project, setProject] = useState(() =>
    validateProject(createExample()),
  );
  const [selection, setSelection] = useState([]),
    [activeStop, setActiveStop] = useState(0);
  const [sceneId, setSceneId] = useState("forest"),
    [tab, setTab] = useState("story");
  const [tool, setTool] = useState("select"),
    [override, setOverride] = useState(false),
    [snap, setSnap] = useState(true);
  const [camera, setCamera] = useState({ x: 600, y: 390, scale: 0.65 });
  const [viewport, setViewport] = useState({ width: 900, height: 640 });
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [presenting, setPresenting] = useState(false);
  const [saved, setSaved] = useState("Loading"),
    [ready, setReady] = useState(false),
    [toast, setToast] = useState("");
  const [modal, setModal] = useState(null),
    [projects, setProjects] = useState([]),
    [publishing, setPublishing] = useState(false);
  const [editingId, setEditingId] = useState(null),
    [marquee, setMarquee] = useState(null),
    [sidebar, setSidebar] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const stageRef = useRef(null),
    svgRef = useRef(null),
    fileRef = useRef(null),
    packageRef = useRef(null),
    textRef = useRef(null),
    editRef = useRef(null);
  const projectRef = useRef(project),
    cameraRef = useRef(camera),
    history = useRef({ past: [], future: [] }),
    space = useRef(false),
    drag = useRef(false),
    animation = useRef(null),
    replaceRef = useRef(null),
    saveChain = useRef(Promise.resolve());
  projectRef.current = project;
  cameraRef.current = camera;
  const node = project.nodes.find((n) => n.id === selection[0]);
  const stop = project.stops[activeStop];
  const index = sceneIndex(project);
  const scenes = project.nodes.filter((n) => n.type === "scene");
  const total = timelineDuration(project);
  const currentScene = index.byId.get(sceneId);
  const breadcrumbs = [];
  let ancestor = currentScene;
  while (ancestor) {
    if (ancestor.type === "scene") breadcrumbs.unshift(ancestor);
    ancestor = index.byId.get(ancestor.parentId);
  }

  function notify(message) {
    setToast(message);
  }
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const last = localStorage.getItem("folia-current");
        if (last) {
          const doc = await loadProject(last);
          if (doc && alive) {
            setProject(doc);
            setSceneId(doc.nodes.find((n) => n.type === "scene")?.id || null);
          }
        }
      } catch (e) {
        if (alive) notify(e.message);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || drag.current) return;
    setSaved("Saving");
    const id = setTimeout(() => {
      const captured = project;
      saveChain.current = saveChain.current
        .catch(() => {})
        .then(() => saveProject(captured))
        .then(() => {
          if (projectRef.current === captured) {
            localStorage.setItem("folia-current", captured.id);
            setSaved("Saved");
          }
        })
        .catch((e) => {
          setSaved("Save error");
          notify(e.message);
        });
    }, 650);
    return () => clearTimeout(id);
  }, [project, ready]);
  useEffect(() => {
    if (presenting) return;
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width && r.height)
        setViewport({ width: r.width, height: r.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [presenting]);
  useEffect(() => {
    if (ready) setCamera(fitProject(projectRef.current, viewport));
  }, [ready, viewport.width, viewport.height]);
  useEffect(() => {
    if (!playing) return;
    let id,
      last = performance.now(),
      cursor = time;
    const tick = (now) => {
      const previous = cursor;
      cursor = Math.min(total, cursor + (now - last) / 1000);
      last = now;
      const choice = project.stops.findIndex(
        (s, i) =>
          s.choice &&
          stopTime(project, i) >= previous - 0.001 &&
          stopTime(project, i) <= cursor,
      );
      if (choice >= 0) {
        cursor = stopTime(project, choice);
        setPlaying(false);
        notify(
          "A fork in the story. Present to follow a branch, or choose the next stop.",
        );
      }
      const sampled = sampleCamera(project, cursor, viewport);
      setCamera(sampled.camera);
      setTime(cursor);
      setActiveStop(Math.max(0, sampled.stopIndex));
      if (cursor >= total) setPlaying(false);
      else if (choice < 0) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, project, viewport]);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const wheel = (e) => {
      if (editingId || e.target.closest("[contenteditable]")) return;
      e.preventDefault();
      cancelAnimationFrame(animation.current);
      setPlaying(false);
      const rect = el.getBoundingClientRect();
      setCamera((c) =>
        zoomAt(
          c,
          { x: e.clientX - rect.left, y: e.clientY - rect.top },
          Math.exp(-e.deltaY * 0.0016),
          viewport,
        ),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [viewport, editingId, presenting]);

  function commit(next, base = projectRef.current) {
    try {
      const result = validateProject(
        typeof next === "function" ? next(base) : next,
      );
      if (JSON.stringify(result) === JSON.stringify(base)) return;
      history.current.past.push(base);
      if (history.current.past.length > 80) history.current.past.shift();
      history.current.future = [];
      projectRef.current = result;
      setProject(result);
      setHistoryVersion((v) => v + 1);
      return result;
    } catch (e) {
      setProject(base);
      notify(`Change not applied: ${e.message}`);
    }
  }
  function undo() {
    const h = history.current;
    if (!h.past.length) return;
    h.future.push(projectRef.current);
    setProject(h.past.pop());
    setSelection([]);
    setEditingId(null);
    setHistoryVersion((v) => v + 1);
  }
  function redo() {
    const h = history.current;
    if (!h.future.length) return;
    h.past.push(projectRef.current);
    setProject(h.future.pop());
    setSelection([]);
    setHistoryVersion((v) => v + 1);
  }
  function updateNode(patch, id = node?.id) {
    if (id)
      commit((p) => ({
        ...p,
        nodes: p.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      }));
  }
  function updateStop(patch) {
    if (stop)
      commit((p) => ({
        ...p,
        stops: p.stops.map((s) => (s.id === stop.id ? { ...s, ...patch } : s)),
      }));
  }
  function fly(target, immediate = false) {
    if (!target) {
      notify("This target is missing. Select an object and use Repair target.");
      return;
    }
    setPlaying(false);
    cancelAnimationFrame(animation.current);
    if (
      immediate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setCamera(target);
      return;
    }
    const start = performance.now(),
      from = cameraRef.current;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 950);
      setCamera(interpolateCamera(from, target, p, "smooth", viewport));
      if (p < 1) animation.current = requestAnimationFrame(tick);
    };
    animation.current = requestAnimationFrame(tick);
  }
  function enterScene(id) {
    setSceneId(id);
    setSelection([]);
    fly(frameNode(project, id, viewport, 48));
  }
  function goStop(i, immediate = false) {
    const s = project.stops[i];
    if (!s) return;
    setActiveStop(i);
    setSelection([]);
    setEditingId(null);
    setTime(stopTime(project, i));
    let n = index.byId.get(s.targetId);
    while (n && n.type !== "scene") n = index.byId.get(n.parentId);
    if (n) setSceneId(n.id);
    fly(
      s.targetId ? frameNode(project, s.targetId, viewport, 70) : s.frame,
      immediate,
    );
  }
  function seek(t) {
    cancelAnimationFrame(animation.current);
    setPlaying(false);
    setTime(t);
    const s = sampleCamera(project, t, viewport);
    setCamera(s.camera);
    setActiveStop(Math.max(0, s.stopIndex));
  }
  function back() {
    if (editingId) {
      editRef.current?.blur();
      return;
    }
    if (selection.length) {
      setSelection([]);
      return;
    }
    let p = index.byId.get(currentScene?.parentId);
    while (p && p.type !== "scene") p = index.byId.get(p.parentId);
    if (p) enterScene(p.id);
    else fly(fitProject(project, viewport));
  }
  function addNode(type, position, extra = {}, additions = {}) {
    const parent = currentScene || null;
    const wm = parent ? worldMatrix(project, parent.id) : [1, 0, 0, 1, 0, 0];
    const center =
      position || applyMatrix(inverse(wm), { x: camera.x, y: camera.y });
    const localZoom = camera.scale * Math.hypot(wm[0], wm[1]);
    const size = Math.min(1000, Math.max(1, 220 / localZoom));
    const n = {
      id: uid(type),
      parentId: parent?.id || null,
      type,
      name:
        type === "scene"
          ? "Untitled scene"
          : type === "text"
            ? "A new thought"
            : `New ${type}`,
      x: center.x - size / 2,
      y: center.y - size / 3,
      w: size,
      h: size * 0.66,
      scale: 1,
      rotation: 0,
      opacity: 1,
      fill:
        type === "scene" ? "#f3efe3" : type === "text" ? "#294c3d" : "#9aaf8e",
      ...extra,
    };
    if (type === "text")
      Object.assign(
        n,
        {
          text: "Every detail holds a story.",
          fontSize: Math.max(1, size / 9),
          fontFamily: "Georgia, serif",
          color: "#294c3d",
          h: size * 0.5,
        },
        extra,
      );
    if (type === "scene") n.clip = true;
    if (type === "line") {
      n.stroke = "#294c3d";
      n.strokeWidth = Math.max(1, size / 70);
      n.h = size * 0.4;
    }
    const result = commit((p) => ({
      ...p,
      ...additions,
      nodes: [...p.nodes, n],
      assets: { ...p.assets, ...additions.assets },
    }));
    if (result) {
      setSelection([n.id]);
      setTab("layers");
      setTool("select");
    }
    return result ? n : null;
  }
  function duplicate() {
    if (!selection.length) return;
    const chosen = new Set(selection),
      pending = [...selection];
    while (pending.length)
      for (const c of index.children.get(pending.pop()) || []) {
        chosen.add(c.id);
        pending.push(c.id);
      }
    const ids = new Map([...chosen].map((id) => [id, uid("copy")]));
    const clones = project.nodes
      .filter((n) => chosen.has(n.id))
      .map((n) => ({
        ...n,
        id: ids.get(n.id),
        name: `${n.name} copy`,
        parentId: ids.get(n.parentId) || n.parentId,
        x: n.x + (chosen.has(n.parentId) ? 0 : 15),
        y: n.y + (chosen.has(n.parentId) ? 0 : 15),
      }));
    commit((p) => ({
      ...p,
      nodes: [...p.nodes, ...clones],
      links: [
        ...p.links,
        ...p.links
          .filter((l) => ids.has(l.sourceId))
          .map((l) => ({
            ...l,
            id: uid("link"),
            sourceId: ids.get(l.sourceId),
          })),
      ],
    }));
    setSelection(selection.map((id) => ids.get(id)));
  }
  function group() {
    try {
      const r = groupNodes(project, selection);
      if (commit(r.project)) setSelection([r.groupId]);
    } catch (e) {
      notify(e.message);
    }
  }
  function remove() {
    if (!selection.length) return;
    commit((p) => deleteNodes(p, selection));
    setSelection([]);
  }
  function orderNode(direction) {
    if (!node) return;
    commit((p) => {
      const nodes = [...p.nodes],
        at = nodes.findIndex((n) => n.id === node.id),
        siblings = nodes
          .map((n, i) => ({ n, i }))
          .filter(({ n }) => n.parentId === node.parentId);
      const si = siblings.findIndex((s) => s.n.id === node.id),
        other = siblings[si + direction];
      if (!other) return p;
      [nodes[at], nodes[other.i]] = [nodes[other.i], nodes[at]];
      return { ...p, nodes };
    });
  }
  function align(axis) {
    if (selection.length < 2) return;
    const bounds = selection.map((id) => worldBounds(project, id)),
      anchor = bounds[0];
    commit((p) => ({
      ...p,
      nodes: p.nodes.map((n) => {
        if (!selection.includes(n.id)) return n;
        const b = bounds[selection.indexOf(n.id)];
        const worldDelta =
          axis === "x"
            ? { x: anchor.x - b.x, y: 0 }
            : { x: 0, y: anchor.y - b.y };
        const m = n.parentId
          ? inverse(worldMatrix(p, n.parentId))
          : [1, 0, 0, 1, 0, 0];
        return {
          ...n,
          x: n.x + m[0] * worldDelta.x + m[2] * worldDelta.y,
          y: n.y + m[1] * worldDelta.x + m[3] * worldDelta.y,
        };
      }),
    }));
  }
  function addStop() {
    const targetId = selection[0] || sceneId;
    const n = index.byId.get(targetId);
    const s = {
      id: uid("stop"),
      title: n?.name || "A new perspective",
      caption: "What would you like your audience to notice?",
      targetId: n?.id || null,
      ...(!n ? { frame: camera } : {}),
      dwell: 4,
      transition: 2.4,
      easing: "smooth",
      choice: false,
    };
    commit((p) => ({
      ...p,
      stops: [
        ...p.stops.slice(0, activeStop + 1),
        s,
        ...p.stops.slice(activeStop + 1),
      ],
    }));
    setActiveStop(Math.min(activeStop + 1, project.stops.length));
    setSelection([]);
    setTab("story");
    notify("Story stop added. Its target will follow your edits.");
  }
  function reorderStop(from, to) {
    if (to < 0 || to >= project.stops.length || to === from) return;
    commit((p) => {
      const stops = [...p.stops];
      stops.splice(to, 0, stops.splice(from, 1)[0]);
      return { ...p, stops };
    });
    setActiveStop(to);
  }
  function deleteStop() {
    if (!stop) return;
    commit((p) => ({
      ...p,
      stops: p.stops.filter((s) => s.id !== stop.id),
      links: p.links.filter((l) => l.targetStopId !== stop.id),
    }));
    setActiveStop(Math.max(0, activeStop - 1));
    notify("Stop and incoming branch links removed. Canvas content was kept.");
  }
  function addBranch() {
    if (!stop) return notify("Create a story stop first.");
    const sourceId = node?.id || uid("hotspot");
    const link = {
      id: uid("link"),
      sourceId,
      targetStopId: stop.id,
      label: `Explore ${stop.title}`,
    };
    if (node) commit((p) => ({ ...p, links: [...p.links, link] }));
    else
      addNode(
        "text",
        undefined,
        { id: sourceId, name: "Branch hotspot", text: link.label },
        { links: [...project.links, link] },
      );
    setSelection([sourceId]);
    notify("Hotspot added. Choose its destination in the inspector.");
  }

  function pointer(e, target, locked = false, handle, corner) {
    if (e.button !== 0 && e.button !== 1) return;
    if (editingId) return;
    e.preventDefault();
    e.stopPropagation();
    cancelAnimationFrame(animation.current);
    setPlaying(false);
    const rect = stageRef.current.getBoundingClientRect(),
      start = { x: e.clientX - rect.left, y: e.clientY - rect.top },
      startCamera = cameraRef.current,
      base = projectRef.current;
    const pan = tool === "hand" || space.current || e.button === 1;
    let ids = selection;
    if (!pan && target && !locked && tool === "select") {
      ids = e.shiftKey
        ? selection.includes(target.id)
          ? selection.filter((id) => id !== target.id)
          : [...selection, target.id]
        : selection.includes(target.id)
          ? selection
          : [target.id];
      setSelection(ids);
    }
    if (!pan && !target && tool === "select") {
      if (!e.shiftKey) setSelection([]);
      ids = [];
    }
    if (locked && !pan) {
      notify("This object is locked. Unlock it in Layers.");
      return;
    }
    const toLocal = (point) => {
      const w = {
        x: startCamera.x + (point.x - viewport.width / 2) / startCamera.scale,
        y: startCamera.y + (point.y - viewport.height / 2) / startCamera.scale,
      };
      return currentScene
        ? applyMatrix(inverse(worldMatrix(base, currentScene.id)), w)
        : w;
    };
    const points = [toLocal(start)];
    let changed = false,
      preview = base,
      moved = false;
    const rootIds = ids.filter((id) => {
      let n = index.byId.get(id);
      while (n?.parentId) {
        if (ids.includes(n.parentId)) return false;
        n = index.byId.get(n.parentId);
      }
      return true;
    });
    const move = (ev) => {
      const at = { x: ev.clientX - rect.left, y: ev.clientY - rect.top },
        dx = at.x - start.x,
        dy = at.y - start.y;
      if (Math.hypot(dx, dy) < 3 && !moved) return;
      moved = true;
      drag.current = true;
      if (pan) {
        setCamera(
          clampCamera({
            ...startCamera,
            x: startCamera.x - dx / startCamera.scale,
            y: startCamera.y - dy / startCamera.scale,
          }),
        );
        return;
      }
      if (tool === "draw") {
        points.push(toLocal(at));
        setMarquee({
          points: points.map((p) => {
            const m = currentScene
              ? worldMatrix(base, currentScene.id)
              : [1, 0, 0, 1, 0, 0];
            const w = applyMatrix(m, p);
            return [
              (w.x - startCamera.x) * startCamera.scale + viewport.width / 2,
              (w.y - startCamera.y) * startCamera.scale + viewport.height / 2,
            ];
          }),
        });
        return;
      }
      if (!target && tool === "select") {
        setMarquee({
          x: Math.min(at.x, start.x),
          y: Math.min(at.y, start.y),
          w: Math.abs(dx),
          h: Math.abs(dy),
        });
        return;
      }
      if (!target || tool !== "select") return;
      preview = {
        ...base,
        nodes: base.nodes.map((n) => {
          if (!rootIds.includes(n.id) && !(handle && n.id === target.id))
            return n;
          const parent = n.parentId
            ? worldMatrix(base, n.parentId)
            : [1, 0, 0, 1, 0, 0];
          const inv = inverse(parent),
            delta = {
              x: (inv[0] * dx + inv[2] * dy) / startCamera.scale,
              y: (inv[1] * dx + inv[3] * dy) / startCamera.scale,
            };
          if (handle === "rotate") {
            const m = screenMatrix(
              worldMatrix(base, n.id),
              startCamera,
              viewport,
            );
            const angle =
              Math.atan2(at.y - m[5], at.x - m[4]) -
              Math.atan2(start.y - m[5], start.x - m[4]);
            const rotation = n.rotation + (angle * 180) / Math.PI;
            return {
              ...n,
              rotation: ev.shiftKey ? Math.round(rotation / 15) * 15 : rotation,
            };
          }
          if (handle === "resize") {
            const anchors = [
                [n.w, n.h],
                [0, n.h],
                [0, 0],
                [n.w, 0],
              ],
              anchor = anchors[corner || 0];
            const wm = worldMatrix(base, n.id),
              am = applyMatrix(wm, { x: anchor[0], y: anchor[1] });
            const ax =
                (am.x - startCamera.x) * startCamera.scale + viewport.width / 2,
              ay =
                (am.y - startCamera.y) * startCamera.scale +
                viewport.height / 2;
            const factor = Math.max(
              0.01,
              Math.min(
                100,
                Math.hypot(at.x - ax, at.y - ay) /
                  Math.max(1, Math.hypot(start.x - ax, start.y - ay)),
              ),
            );
            const a = (n.rotation * Math.PI) / 180,
              sx =
                (Math.cos(a) * anchor[0] - Math.sin(a) * anchor[1]) * n.scale,
              sy =
                (Math.sin(a) * anchor[0] + Math.cos(a) * anchor[1]) * n.scale;
            return {
              ...n,
              scale: n.scale * factor,
              x: n.x + sx * (1 - factor),
              y: n.y + sy * (1 - factor),
            };
          }
          const grid = snap && !ev.altKey ? 5 : 0;
          return {
            ...n,
            x: grid ? Math.round((n.x + delta.x) / grid) * grid : n.x + delta.x,
            y: grid ? Math.round((n.y + delta.y) / grid) * grid : n.y + delta.y,
          };
        }),
      };
      changed = true;
      setProject(preview);
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setMarquee(null);
      drag.current = false;
      if (changed) commit(preview, base);
      else if (!pan && tool === "draw" && points.length > 1) {
        const xs = points.map((p) => p.x),
          ys = points.map((p) => p.y),
          x = Math.min(...xs),
          y = Math.min(...ys),
          w = Math.max(1, Math.max(...xs) - x),
          h = Math.max(1, Math.max(...ys) - y);
        addNode(
          "path",
          { x, y },
          {
            x,
            y,
            w,
            h,
            fill: "none",
            stroke: "#294c3d",
            strokeWidth: Math.max(
              0.1,
              2 /
                (startCamera.scale *
                  (currentScene
                    ? Math.hypot(
                        ...worldMatrix(base, currentScene.id).slice(0, 2),
                      )
                    : 1)),
            ),
            path: points
              .map((p, i) => `${i ? "L" : "M"}${p.x - x} ${p.y - y}`)
              .join(" "),
          },
        );
      } else if (!pan && tool !== "select" && tool !== "draw")
        addNode(tool, toLocal(start));
      else if (!pan && !target && moved) {
        const end = { x: ev.clientX - rect.left, y: ev.clientY - rect.top },
          left = Math.min(start.x, end.x),
          right = Math.max(start.x, end.x),
          top = Math.min(start.y, end.y),
          bottom = Math.max(start.y, end.y);
        setSelection(
          visibleNodes(base, startCamera, viewport, override)
            .filter(
              (i) =>
                i.n.parentId === sceneId &&
                !i.locked &&
                i.bounds.x >= left &&
                i.bounds.right <= right &&
                i.bounds.y >= top &&
                i.bounds.bottom <= bottom,
            )
            .map((i) => i.n.id),
        );
      }
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setProject(base);
      setMarquee(null);
      drag.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  function beginText(n) {
    if (n.locked) return;
    setSelection([n.id]);
    setEditingId(n.id);
    setTimeout(() => editRef.current?.focus(), 0);
  }
  function finishText() {
    if (!editingId || !editRef.current) return;
    const runs = [];
    function walk(el, bold = false, italic = false) {
      if (el.nodeType === 3) {
        if (el.textContent) runs.push({ text: el.textContent, bold, italic });
        return;
      }
      if (el.nodeName === "BR") {
        runs.push({ text: "\n", bold, italic });
        return;
      }
      const b =
          bold ||
          ["B", "STRONG"].includes(el.nodeName) ||
          Number(el.style?.fontWeight) >= 600,
        i =
          italic ||
          ["I", "EM"].includes(el.nodeName) ||
          el.style?.fontStyle === "italic";
      if (
        ["DIV", "P"].includes(el.nodeName) &&
        runs.length &&
        el !== editRef.current
      )
        runs.push({ text: "\n" });
      el.childNodes.forEach((c) => walk(c, b, i));
    }
    walk(editRef.current);
    const text = runs.map((r) => r.text).join("");
    updateNode({ text, runs }, editingId);
    setEditingId(null);
  }
  useEffect(() => {
    if (presenting) return;
    const down = (e) => {
      const input = e.target.closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      if (modal && e.key === "Escape") {
        setModal(null);
        return;
      }
      if (input) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space") {
        e.preventDefault();
        space.current = true;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey && node?.type === "group") {
          commit(ungroupNode(project, node.id));
          setSelection([]);
        } else group();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(
          project.nodes
            .filter((n) => n.parentId === sceneId && !n.locked && !n.hidden)
            .map((n) => n.id),
        );
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape") back();
      else if (e.key === "Enter" && node) {
        if (node.type === "text") beginText(node);
        else if (node.type === "scene") enterScene(node.id);
      } else if (e.key.toLowerCase() === "f")
        fly(
          selection.length
            ? frameNode(project, selection[0], viewport)
            : fitProject(project, viewport),
        );
      else if (e.key === "0") fly(fitProject(project, viewport));
      else if (e.key.toLowerCase() === "v") setTool("select");
      else if (e.key.toLowerCase() === "h") setTool("hand");
      else if (e.key.toLowerCase() === "t") setTool("text");
      else if (e.key.toLowerCase() === "r") setTool("rect");
      else if (e.key.toLowerCase() === "p") setTool("draw");
      else if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) &&
        selection.length
      ) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        commit((p) => ({
          ...p,
          nodes: p.nodes.map((n) =>
            selection.includes(n.id) && !n.locked
              ? {
                  ...n,
                  x:
                    n.x +
                    (e.key === "ArrowLeft"
                      ? -d
                      : e.key === "ArrowRight"
                        ? d
                        : 0),
                  y:
                    n.y +
                    (e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0),
                }
              : n,
          ),
        }));
      }
    };
    const up = (e) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });
  async function openBrowser() {
    try {
      await saveProject(project);
      setProjects(await listProjects());
      setModal("projects");
    } catch (e) {
      notify(e.message);
    }
  }
  async function switchProject(doc) {
    try {
      await saveProject(project);
      const valid = validateProject(doc);
      await saveProject(valid);
      localStorage.setItem("folia-current", valid.id);
      setProject(valid);
      setSelection([]);
      setActiveStop(0);
      setSceneId(valid.nodes.find((n) => n.type === "scene")?.id || null);
      setCamera(fitProject(valid, viewport));
      setTime(0);
      setPlaying(false);
      history.current = { past: [], future: [] };
      setModal(null);
    } catch (e) {
      notify(e.message);
    }
  }
  async function uploadImage(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const asset = await importImage(file);
      const replaceId = replaceRef.current;
      let result;
      if (replaceId)
        result = commit((p) => ({
          ...p,
          assets: { ...p.assets, [asset.id]: asset },
          nodes: p.nodes.map((n) =>
            n.id === replaceId
              ? { ...n, assetId: asset.id, crop: { x: 0, y: 0, zoom: 1 } }
              : n,
          ),
        }));
      else {
        result = addNode(
          "image",
          undefined,
          { assetId: asset.id, fit: "cover" },
          { assets: { [asset.id]: asset } },
        );
      }
      if (result) notify(`Imported ${file.name}. Original image preserved.`);
    } catch (error) {
      notify(error.message);
    } finally {
      replaceRef.current = null;
    }
  }
  async function uploadPackage(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const doc = await importProject(file);
      await switchProject(doc);
      notify("Editable project imported, including assets and story links.");
    } catch (error) {
      notify(error.message);
    }
  }
  async function uploadText(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (!/\.(txt|md)$/i.test(file.name) || file.size > 200000)
        throw new Error("Choose a UTF-8 .txt or .md file under 200 KB.");
      const content = await file.text();
      if (content.includes("\u0000"))
        throw new Error("This does not appear to be a text file.");
      addNode("text", undefined, { name: file.name, text: content });
      notify("Text imported as editable plain text.");
    } catch (error) {
      notify(error.message);
    }
  }
  async function publish() {
    setPublishing(true);
    try {
      await publishProject(project);
      notify(
        "Viewer ZIP downloaded. Unzip and serve with python3 -m http.server 8080.",
      );
    } catch (e) {
      notify(e.message);
    } finally {
      setPublishing(false);
    }
  }

  if (presenting)
    return <Viewer project={project} onExit={() => setPresenting(false)} />;

  const editing = index.byId.get(editingId),
    editMatrix = editing
      ? screenMatrix(index.matrices.get(editingId), camera, viewport)
      : null;
  const roots = project.nodes.filter((n) => n.parentId === (sceneId || null));
  const sceneLink = node && project.links.find((l) => l.sourceId === node.id);
  const miniViewport = { width: 172, height: 102 },
    miniCamera =
      frameNode(
        project,
        project.nodes.find((n) => n.type === "scene" && !n.parentId)?.id,
        miniViewport,
        5,
      ) || fitProject(project, miniViewport);

  return (
    <div className="app-shell" data-history-version={historyVersion}>
      <header className="app-header">
        <button
          className="logo-button"
          onClick={openBrowser}
          aria-label="Open project browser"
        >
          <Logo />
        </button>
        <div className="header-divider" />
        <div className="project-identity">
          <div className="project-title">
            <input
              aria-label="Project name"
              key={`${project.id}-${project.name}`}
              defaultValue={project.name}
              onBlur={(e) => {
                if (e.target.value !== project.name && e.target.value.trim())
                  commit((p) => ({ ...p, name: e.target.value }));
              }}
            />
            <ChevronDown size={13} />
          </div>
          <span
            className={`save-status ${saved === "Save error" ? "error" : ""}`}
          >
            {saved === "Saved" ? (
              <Check size={11} />
            ) : (
              <span className="status-dot" />
            )}
            {saved === "Saved"
              ? "All changes saved locally"
              : saved === "Saving"
                ? "Saving your story..."
                : saved}
          </span>
        </div>
        <div className="header-actions">
          <span className="local-badge">
            <ShieldCheck size={13} /> Your space. Your stories.
          </span>
          <button
            className="avatar"
            title="Local workspace"
            onClick={openBrowser}
          >
            JD
          </button>
          <button
            className="button subtle publish-button"
            onClick={() => setModal("publish")}
          >
            <Upload size={15} /> Publish
          </button>
          <button
            className="button primary"
            onClick={() => {
              setPlaying(false);
              setPresenting(true);
            }}
          >
            <Play size={14} fill="currentColor" /> Present
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className={`left-panel ${sidebar ? "mobile-open" : ""}`}>
          <div className="panel-intro">
            <span>YOUR STORY</span>
            <IconButton
              icon={X}
              label="Close story panel"
              className="mobile-menu"
              onClick={() => setSidebar(false)}
            />
            <IconButton
              icon={MoreHorizontal}
              label="Project options"
              onClick={() => setModal("project-menu")}
            />
          </div>
          <div className="panel-tabs">
            <button
              className={tab === "story" ? "selected" : ""}
              onClick={() => setTab("story")}
            >
              <GitBranch size={14} /> Story path{" "}
              <span>{project.stops.length}</span>
            </button>
            <button
              className={tab === "layers" ? "selected" : ""}
              onClick={() => setTab("layers")}
            >
              <Layers size={14} /> Layers
            </button>
          </div>
          {tab === "story" ? (
            <>
              <div className="path-description">
                A little closer, a whole new world.
              </div>
              <div className="stop-list">
                {project.stops.map((s, i) => {
                  const resolved = !s.targetId || index.byId.has(s.targetId);
                  return (
                    <button
                      key={s.id}
                      className={`stop-card ${i === activeStop ? "selected" : ""} ${!resolved ? "unresolved" : ""}`}
                      onClick={() => {
                        goStop(i);
                        setSidebar(false);
                      }}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/folia-stop", String(i))
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = e.dataTransfer.getData("text/folia-stop");
                        if (from !== "") reorderStop(Number(from), i);
                      }}
                      aria-label={`Stop ${i + 1}: ${s.title}`}
                    >
                      <span className="stop-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="stop-thumb">
                        <ScenePreview
                          project={project}
                          targetId={s.targetId}
                          frame={s.frame}
                          width={104}
                          height={70}
                        />
                      </span>
                      <span className="stop-card-copy">
                        <strong>{s.title}</strong>
                        <span>
                          {!resolved ? "Missing target" : `${s.dwell}s pause`}
                          {s.choice && <GitBranch size={11} />}
                        </span>
                      </span>
                      <GripVertical size={12} className="stop-grip" />
                    </button>
                  );
                })}
              </div>
              <button className="add-stop" onClick={addStop}>
                <Plus size={15} /> Add story stop<span>+</span>
              </button>
              <div className="story-note">
                <span className="tiny-spark">
                  <Sparkles size={15} />
                </span>
                <div>
                  <strong>Small details. Big discoveries.</strong>
                  <p>Double-click a scene to step inside.</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="layer-nav">
                <button
                  onClick={() => {
                    setSceneId(null);
                    setSelection([]);
                  }}
                >
                  Canvas
                </button>
                {currentScene && (
                  <>
                    <ChevronRight size={11} />
                    <span>{currentScene.name}</span>
                  </>
                )}
              </div>
              <div className="layer-list">
                {currentScene && (
                  <button
                    className="layer-parent"
                    onClick={() => {
                      const p = currentScene.parentId;
                      setSceneId(p);
                      setSelection([currentScene.id]);
                    }}
                  >
                    <ArrowLeft size={13} /> Back to parent
                  </button>
                )}
                {roots.map((n) => (
                  <div
                    key={n.id}
                    className={`layer-row ${selection.includes(n.id) ? "selected" : ""} ${n.hidden ? "hidden-layer" : ""}`}
                  >
                    <button
                      onClick={(e) =>
                        setSelection(
                          e.shiftKey
                            ? [...new Set([...selection, n.id])]
                            : [n.id],
                        )
                      }
                      onDoubleClick={() =>
                        n.type === "scene" || n.type === "group"
                          ? setSceneId(n.id)
                          : fly(frameNode(project, n.id, viewport))
                      }
                    >
                      {n.type === "scene" ? (
                        <Frame size={14} />
                      ) : n.type === "text" ? (
                        <Type size={14} />
                      ) : n.type === "image" ? (
                        <Image size={14} />
                      ) : n.type === "group" ? (
                        <Group size={14} />
                      ) : (
                        <Square size={13} />
                      )}
                      <span>{n.name}</span>
                    </button>
                    <IconButton
                      icon={n.hidden ? EyeOff : Eye}
                      label={`${n.hidden ? "Show" : "Hide"} ${n.name}`}
                      onClick={() => updateNode({ hidden: !n.hidden }, n.id)}
                    />
                    <IconButton
                      icon={n.locked ? Lock : Unlock}
                      label={`${n.locked ? "Unlock" : "Lock"} ${n.name}`}
                      onClick={() => updateNode({ locked: !n.locked }, n.id)}
                    />
                  </div>
                ))}
              </div>
              <button className="add-stop" onClick={() => addNode("scene")}>
                <Plus size={15} /> Add nested scene
              </button>
            </>
          )}
          <div className="left-panel-footer">
            <button onClick={openBrowser}>
              <FolderOpen size={15} /> My projects
            </button>
            <IconButton
              icon={HelpCircle}
              label="Help and keyboard shortcuts"
              onClick={() => setModal("help")}
            />
          </div>
        </aside>

        <main className="main-workspace">
          <div className="canvas-topbar">
            <div className="breadcrumbs">
              <IconButton
                icon={Layers}
                label="Toggle story panel"
                className="mobile-menu"
                onClick={() => setSidebar(!sidebar)}
              />
              <button
                onClick={() => {
                  setSceneId(
                    project.nodes.find((n) => n.type === "scene")?.id || null,
                  );
                  fly(fitProject(project, viewport));
                }}
              >
                <Frame size={13} /> Canvas
              </button>
              {breadcrumbs.map((n) => (
                <React.Fragment key={n.id}>
                  <ChevronRight size={12} />
                  <button onClick={() => enterScene(n.id)}>
                    {n.name === "forest" ? "The big picture" : n.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
            <div className="canvas-top-actions">
              <span className="mode-pill">
                <span /> Author mode
              </span>
              <IconButton
                icon={Settings2}
                label="Toggle inspector"
                className="mobile-inspector-toggle"
                active={inspectorOpen}
                onClick={() => {
                  setInspectorOpen(!inspectorOpen);
                  setSidebar(false);
                }}
              />
              <IconButton
                icon={SlidersHorizontal}
                label="Canvas settings"
                onClick={() => setModal("canvas-settings")}
              />
            </div>
          </div>
          <div
            className={`canvas-stage tool-${tool}`}
            ref={stageRef}
            data-testid="canvas-stage"
          >
            <div className="canvas-top-label">
              <span className="little-diamond" />
              {currentScene?.name === "forest"
                ? "THE BIG PICTURE"
                : (currentScene?.name || "YOUR CANVAS").toUpperCase()}
              <span>
                {breadcrumbs.length > 1
                  ? `DEPTH ${breadcrumbs.length - 1}`
                  : "EVERY STORY STARTS SOMEWHERE"}
              </span>
            </div>
            <Canvas
              project={project}
              camera={camera}
              viewport={viewport}
              selected={selection}
              override={override}
              editingId={editingId}
              svgRef={svgRef}
              onBackgroundDown={(e) => pointer(e)}
              onNodeDown={(e, n, locked) => pointer(e, n, locked)}
              onNodeDoubleClick={(n) =>
                n.type === "text"
                  ? beginText(n)
                  : n.type === "scene" || n.type === "group"
                    ? enterScene(n.id)
                    : fly(frameNode(project, n.id, viewport))
              }
              onHandleDown={(e, n, kind, corner) =>
                pointer(e, n, false, kind, corner)
              }
            />
            {marquee && (
              <svg className="gesture-overlay">
                {marquee.points ? (
                  <polyline
                    points={marquee.points.map((p) => p.join(",")).join(" ")}
                    fill="none"
                    stroke="#294c3d"
                    strokeWidth="2"
                  />
                ) : (
                  <rect
                    x={marquee.x}
                    y={marquee.y}
                    width={marquee.w}
                    height={marquee.h}
                    fill="#427b6814"
                    stroke="#427b68"
                  />
                )}
              </svg>
            )}
            {editing && (
              <div
                ref={editRef}
                contentEditable
                suppressContentEditableWarning
                className="text-editor"
                aria-label="Edit canvas text"
                style={{
                  width: editing.w,
                  minHeight: editing.h,
                  transform: `matrix(${editMatrix.join(",")})`,
                  fontSize: editing.fontSize,
                  fontFamily: editing.fontFamily,
                  fontWeight: editing.fontWeight,
                  color: editing.color || editing.fill,
                  textAlign: editing.align,
                }}
                onBlur={finishText}
                onPointerDown={(e) => e.stopPropagation()}
                onPaste={(e) => {
                  e.preventDefault();
                  document.execCommand(
                    "insertText",
                    false,
                    e.clipboardData.getData("text/plain"),
                  );
                }}
              >
                {editing.runs
                  ? editing.runs.map((r, i) => (
                      <span
                        key={i}
                        style={{
                          fontWeight: r.bold ? 700 : undefined,
                          fontStyle: r.italic ? "italic" : undefined,
                        }}
                      >
                        {r.text}
                      </span>
                    ))
                  : editing.text}
              </div>
            )}
            <div className="canvas-tools">
              {[
                [MousePointer2, "select", "Select (V)"],
                [Hand, "hand", "Pan (H or Space)"],
                [Type, "text", "Text (T)"],
                [Image, "image", "Import image"],
                [Square, "rect", "Rectangle (R)"],
                [Circle, "ellipse", "Ellipse"],
                [MoveHorizontal, "line", "Line"],
                [Pencil, "draw", "Freehand (P)"],
                [Frame, "scene", "Nested scene"],
              ].map(([Icon, value, label], i) => (
                <React.Fragment key={value}>
                  {i === 2 || i === 8 ? (
                    <span className="tool-separator" />
                  ) : null}
                  <IconButton
                    icon={Icon}
                    label={label}
                    active={tool === value}
                    onClick={() => {
                      if (value === "image") {
                        replaceRef.current = null;
                        fileRef.current.click();
                      } else {
                        setTool(value);
                        if (!["select", "hand"].includes(value))
                          notify(
                            `Click the canvas to add ${value === "draw" ? "a freehand path, then drag to draw" : `a ${value}`}.`,
                          );
                      }
                    }}
                  />
                </React.Fragment>
              ))}
            </div>
            <div className="canvas-bottom-hint">
              <MousePointer2 size={12} />
              <span>
                Scroll to zoom <i /> Space + drag to pan <i /> Double-click to
                explore
              </span>
            </div>
            <button
              className="minimap"
              title="Return to overview"
              aria-label="Minimap: return to overview"
              onClick={() => fly(fitProject(project, viewport))}
            >
              <ScenePreview
                project={project}
                targetId={
                  project.nodes.find((n) => n.type === "scene" && !n.parentId)
                    ?.id
                }
                width={miniViewport.width}
                height={miniViewport.height}
              />
              <svg viewBox="0 0 172 102" className="minimap-frame">
                <rect
                  x={
                    (camera.x -
                      viewport.width / camera.scale / 2 -
                      miniCamera.x) *
                      miniCamera.scale +
                    86
                  }
                  y={
                    (camera.y -
                      viewport.height / camera.scale / 2 -
                      miniCamera.y) *
                      miniCamera.scale +
                    51
                  }
                  width={Math.max(
                    3,
                    (viewport.width / camera.scale) * miniCamera.scale,
                  )}
                  height={Math.max(
                    3,
                    (viewport.height / camera.scale) * miniCamera.scale,
                  )}
                  fill="#427b6810"
                  stroke="#427b68"
                  strokeWidth="1"
                />
              </svg>
              <span>
                THE WHOLE WORLD <Maximize size={9} />
              </span>
            </button>
            <div className="zoom-controls">
              <IconButton
                icon={Minus}
                label="Zoom out"
                onClick={() =>
                  setCamera((c) =>
                    zoomAt(
                      c,
                      { x: viewport.width / 2, y: viewport.height / 2 },
                      1 / 1.3,
                      viewport,
                    ),
                  )
                }
              />
              <button
                onClick={() => fly(fitProject(project, viewport))}
                title="Fit story (0)"
              >
                {camera.scale < 100
                  ? `${Math.round(camera.scale * 100)}%`
                  : `${pretty(camera.scale)}x`}
                <ChevronDown size={10} />
              </button>
              <IconButton
                icon={Plus}
                label="Zoom in"
                onClick={() =>
                  setCamera((c) =>
                    zoomAt(
                      c,
                      { x: viewport.width / 2, y: viewport.height / 2 },
                      1.3,
                      viewport,
                    ),
                  )
                }
              />
              <span />
              <IconButton
                icon={Focus}
                label="Fit selection (F)"
                onClick={() =>
                  fly(
                    selection.length
                      ? frameNode(project, selection[0], viewport)
                      : fitProject(project, viewport),
                  )
                }
              />
            </div>
          </div>
          <section className="timeline-panel">
            <div className="timeline-heading">
              <div className="timeline-label">
                <GitBranch size={13} />
                <strong>The journey</strong>
                <span>
                  {project.stops.length} stops <i /> {timeLabel(total)}
                </span>
              </div>
              <div className="timeline-actions">
                <IconButton
                  icon={Undo2}
                  label="Undo (Ctrl+Z)"
                  disabled={!history.current.past.length}
                  onClick={undo}
                />
                <IconButton
                  icon={Redo2}
                  label="Redo (Ctrl+Shift+Z)"
                  disabled={!history.current.future.length}
                  onClick={redo}
                />
                <span className="divider" />
                <button
                  className="preview-button"
                  onClick={() => {
                    if (time >= total) seek(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? (
                    <Pause size={12} fill="currentColor" />
                  ) : (
                    <Play size={12} fill="currentColor" />
                  )}{" "}
                  {playing ? "Pause" : "Preview"}
                </button>
              </div>
            </div>
            <div className="timeline-track">
              <div className="timeline-start">
                <button
                  onClick={() => {
                    if (time >= total) seek(0);
                    setPlaying(!playing);
                  }}
                  aria-label={playing ? "Pause timeline" : "Play timeline"}
                >
                  {playing ? (
                    <Pause size={16} fill="currentColor" />
                  ) : (
                    <Play size={16} fill="currentColor" />
                  )}
                </button>
                <span>
                  {timeLabel(time)}
                  <small> / {timeLabel(total)}</small>
                </span>
              </div>
              <div className="timeline-sequence">
                <div className="timeline-stops">
                  {project.stops.map((s, i) => (
                    <button
                      key={s.id}
                      className={`timeline-stop ${i === activeStop ? "active" : ""}`}
                      onClick={() => goStop(i)}
                      title={s.title}
                    >
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <span>{s.title}</span>
                      {s.choice && <GitBranch size={10} />}
                    </button>
                  ))}
                </div>
                <input
                  aria-label="Story timeline"
                  type="range"
                  min="0"
                  max={total || 1}
                  step="0.01"
                  value={time}
                  onChange={(e) => seek(Number(e.target.value))}
                />
                <div className="timeline-ticks">
                  <span>0:00</span>
                  <span>{timeLabel(total / 4)}</span>
                  <span>{timeLabel(total / 2)}</span>
                  <span>{timeLabel(total * 0.75)}</span>
                  <span>{timeLabel(total)}</span>
                </div>
              </div>
            </div>
          </section>
        </main>

        <aside
          className={`inspector ${inspectorOpen ? "mobile-inspector-open" : ""}`}
        >
          <div className="inspector-heading">
            <span>{node ? "OBJECT" : "STORY STOP"}</span>
            <span className="inspector-type">
              {node
                ? node.type
                : `${String(activeStop + 1).padStart(2, "0")} / ${String(project.stops.length).padStart(2, "0")}`}
            </span>
            <IconButton
              icon={X}
              label="Close inspector"
              className="mobile-inspector-toggle"
              onClick={() => setInspectorOpen(false)}
            />
          </div>
          <div className="inspector-scroll">
            {node ? (
              <>
                <div className="object-title">
                  <span className="object-type-icon">
                    {node.type === "scene" ? (
                      <Frame size={20} />
                    ) : node.type === "text" ? (
                      <Type size={20} />
                    ) : (
                      <Square size={20} />
                    )}
                  </span>
                  <div>
                    <h2>
                      {selection.length > 1
                        ? `${selection.length} objects`
                        : node.name}
                    </h2>
                    <p>
                      {node.type === "scene"
                        ? "A world within your world"
                        : "Make it your own"}
                    </p>
                  </div>
                </div>
                <section className="inspector-section">
                  <Field
                    label="Name"
                    value={node.name}
                    onCommit={(v) => updateNode({ name: v })}
                  />
                  <div className="field-grid">
                    <Field
                      label="X"
                      type="number"
                      value={node.x}
                      onCommit={(v) => updateNode({ x: v })}
                    />
                    <Field
                      label="Y"
                      type="number"
                      value={node.y}
                      onCommit={(v) => updateNode({ y: v })}
                    />
                    <Field
                      label="Width"
                      type="number"
                      value={node.w}
                      onCommit={(v) => updateNode({ w: v })}
                    />
                    <Field
                      label="Height"
                      type="number"
                      value={node.h}
                      onCommit={(v) => updateNode({ h: v })}
                    />
                    <Field
                      label="Rotation"
                      type="number"
                      value={node.rotation}
                      onCommit={(v) => updateNode({ rotation: v })}
                    />
                    <Field
                      label="Scale"
                      type="number"
                      value={node.scale}
                      onCommit={(v) => updateNode({ scale: v })}
                    />
                  </div>
                  <div className="object-actions">
                    <IconButton
                      icon={Copy}
                      label="Duplicate object (Ctrl+D)"
                      onClick={duplicate}
                    />
                    <IconButton
                      icon={Group}
                      label="Group selection (Ctrl+G)"
                      onClick={group}
                    />
                    <IconButton
                      icon={Ungroup}
                      label="Ungroup"
                      disabled={node.type !== "group"}
                      onClick={() => {
                        commit(ungroupNode(project, node.id));
                        setSelection([]);
                      }}
                    />
                    <IconButton
                      icon={ArrowUp}
                      label="Bring forward"
                      onClick={() => orderNode(1)}
                    />
                    <IconButton
                      icon={ArrowDown}
                      label="Send backward"
                      onClick={() => orderNode(-1)}
                    />
                    <IconButton
                      icon={Trash2}
                      label="Delete object"
                      onClick={remove}
                    />
                  </div>
                  {selection.length > 1 && (
                    <div className="button-row">
                      <button
                        className="button small"
                        onClick={() => align("x")}
                      >
                        Align left
                      </button>
                      <button
                        className="button small"
                        onClick={() => align("y")}
                      >
                        Align top
                      </button>
                    </div>
                  )}
                  <label className="field">
                    <span>Parent / preserve position</span>
                    <select
                      value={node.parentId || ""}
                      onChange={(e) => {
                        try {
                          commit(
                            reparent(project, node.id, e.target.value || null),
                          );
                        } catch (error) {
                          notify(error.message);
                        }
                      }}
                    >
                      <option value="">Canvas root</option>
                      {project.nodes
                        .filter(
                          (n) =>
                            (n.type === "scene" || n.type === "group") &&
                            n.id !== node.id,
                        )
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </section>
                {node.type === "text" && (
                  <section className="inspector-section">
                    <h3>Typography</h3>
                    <TextField
                      label="Text content"
                      value={node.text}
                      onCommit={(v) =>
                        updateNode({ text: v, runs: [{ text: v }] })
                      }
                    />
                    <div className="field-grid">
                      <Field
                        label="Font size"
                        type="number"
                        value={node.fontSize || 16}
                        onCommit={(v) => updateNode({ fontSize: v })}
                      />
                      <label className="field">
                        <span>Typeface</span>
                        <select
                          value={node.fontFamily || "Arial, sans-serif"}
                          onChange={(e) =>
                            updateNode({ fontFamily: e.target.value })
                          }
                        >
                          <option value="Georgia, Times New Roman, serif">
                            Editorial serif
                          </option>
                          <option value="Georgia, serif">Georgia</option>
                          <option value="Arial, sans-serif">Clean sans</option>
                          <option value="monospace">Monospace</option>
                        </select>
                      </label>
                    </div>
                    <div className="button-row">
                      <IconButton
                        icon={Bold}
                        label="Bold text"
                        active={node.fontWeight >= 600}
                        onMouseDown={(e) => {
                          if (editingId) {
                            e.preventDefault();
                            document.execCommand("bold");
                          }
                        }}
                        onClick={() => {
                          if (!editingId)
                            updateNode({
                              fontWeight: node.fontWeight >= 600 ? 400 : 700,
                            });
                        }}
                      />
                      <IconButton
                        icon={Italic}
                        label="Italic text"
                        onMouseDown={(e) => {
                          if (editingId) {
                            e.preventDefault();
                            document.execCommand("italic");
                          }
                        }}
                        onClick={() => {
                          if (!editingId)
                            updateNode({
                              runs: (node.runs || [{ text: node.text }]).map(
                                (r) => ({ ...r, italic: !r.italic }),
                              ),
                            });
                        }}
                      />
                      <select
                        aria-label="Text alignment"
                        value={node.align || "left"}
                        onChange={(e) => updateNode({ align: e.target.value })}
                      >
                        <option value="left">Left aligned</option>
                        <option value="center">Centered</option>
                        <option value="right">Right aligned</option>
                      </select>
                    </div>
                    <button
                      className="button full"
                      onClick={() => beginText(node)}
                    >
                      <Pencil size={13} /> Edit on canvas
                    </button>
                  </section>
                )}
                {node.type === "image" && (
                  <section className="inspector-section">
                    <h3>Image</h3>
                    <div className="image-preview">
                      <img
                        src={project.assets[node.assetId]?.dataUrl}
                        alt="Selected asset"
                      />
                    </div>
                    <button
                      className="button full"
                      onClick={() => {
                        replaceRef.current = node.id;
                        fileRef.current.click();
                      }}
                    >
                      <Upload size={13} /> Replace image
                    </button>
                    <label className="field">
                      <span>Image fit</span>
                      <select
                        value={node.fit || "cover"}
                        onChange={(e) => updateNode({ fit: e.target.value })}
                      >
                        <option value="cover">Fill / crop</option>
                        <option value="contain">Fit entire image</option>
                        <option value="fill">Stretch</option>
                      </select>
                    </label>
                    <div className="field-grid">
                      {["x", "y", "zoom"].map((k) => (
                        <Field
                          key={k}
                          label={`Crop ${k}`}
                          type="number"
                          value={node.crop?.[k] ?? (k === "zoom" ? 1 : 0)}
                          onCommit={(v) =>
                            updateNode({
                              crop: {
                                x: 0,
                                y: 0,
                                zoom: 1,
                                ...node.crop,
                                [k]: v,
                              },
                            })
                          }
                        />
                      ))}
                    </div>
                  </section>
                )}
                <section className="inspector-section">
                  <h3>Appearance</h3>
                  <div className="field-grid">
                    <label className="field">
                      <span>
                        {node.type === "text" ? "Text color" : "Fill color"}
                      </span>
                      <div className="color-field">
                        <input
                          type="color"
                          aria-label="Fill color"
                          value={
                            (node.type === "text"
                              ? node.color
                              : node.fill
                            )?.startsWith("#")
                              ? node.type === "text"
                                ? node.color
                                : node.fill
                              : "#294c3d"
                          }
                          onChange={(e) =>
                            updateNode(
                              node.type === "text"
                                ? {
                                    color: e.target.value,
                                    fill: e.target.value,
                                  }
                                : { fill: e.target.value },
                            )
                          }
                        />
                        <span>
                          {node.type === "text" ? node.color : node.fill}
                        </span>
                      </div>
                    </label>
                    <Field
                      label="Opacity"
                      type="number"
                      value={node.opacity}
                      min="0"
                      max="1"
                      onCommit={(v) => updateNode({ opacity: v })}
                    />
                  </div>
                  {["path", "line", "rect", "ellipse"].includes(node.type) && (
                    <div className="field-grid">
                      <Field
                        label="Stroke"
                        value={node.stroke || "#294c3d"}
                        onCommit={(v) => updateNode({ stroke: v })}
                      />
                      <Field
                        label="Stroke width"
                        type="number"
                        value={node.strokeWidth || 1}
                        onCommit={(v) => updateNode({ strokeWidth: v })}
                      />
                    </div>
                  )}
                  <div className="checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={!!node.locked}
                        onChange={(e) =>
                          updateNode({ locked: e.target.checked })
                        }
                      />{" "}
                      Locked
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!node.hidden}
                        onChange={(e) =>
                          updateNode({ hidden: e.target.checked })
                        }
                      />{" "}
                      Hidden
                    </label>
                  </div>
                  {(node.type === "scene" || node.type === "group") && (
                    <>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={!!node.clip}
                          onChange={(e) =>
                            updateNode({ clip: e.target.checked })
                          }
                        />{" "}
                        Clip content to scene
                      </label>
                      <button
                        className="button full"
                        onClick={() => enterScene(node.id)}
                      >
                        <Frame size={13} /> Enter {node.type}
                      </button>
                    </>
                  )}
                </section>
                <section className="inspector-section">
                  <h3>
                    Semantic zoom <ZoomIn size={13} />
                  </h3>
                  <p className="helper">
                    Reveal content at its intended scale. Values are pixels per
                    local unit.
                  </p>
                  <div className="field-grid">
                    <Field
                      label="Visible from"
                      type="number"
                      value={node.minZoom ?? 0}
                      onCommit={(v) => updateNode({ minZoom: v })}
                    />
                    <Field
                      label="Visible until"
                      type="number"
                      value={node.maxZoom ?? 1e10}
                      onCommit={(v) => updateNode({ maxZoom: v })}
                    />
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                    />{" "}
                    Inspect all zoom levels
                  </label>
                </section>
                <section className="inspector-section">
                  <h3>
                    Branch hotspot <GitBranch size={13} />
                  </h3>
                  {sceneLink ? (
                    <>
                      <Field
                        label="Accessible label"
                        value={sceneLink.label}
                        onCommit={(v) =>
                          commit((p) => ({
                            ...p,
                            links: p.links.map((l) =>
                              l.id === sceneLink.id ? { ...l, label: v } : l,
                            ),
                          }))
                        }
                      />
                      <label className="field">
                        <span>Go to story stop</span>
                        <select
                          value={sceneLink.targetStopId}
                          onChange={(e) =>
                            commit((p) => ({
                              ...p,
                              links: p.links.map((l) =>
                                l.id === sceneLink.id
                                  ? { ...l, targetStopId: e.target.value }
                                  : l,
                              ),
                            }))
                          }
                        >
                          {project.stops.map((s, i) => (
                            <option key={s.id} value={s.id}>
                              {i + 1}. {s.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="text-button danger"
                        onClick={() =>
                          commit((p) => ({
                            ...p,
                            links: p.links.filter((l) => l.id !== sceneLink.id),
                          }))
                        }
                      >
                        Remove hotspot
                      </button>
                    </>
                  ) : (
                    <button className="button full" onClick={addBranch}>
                      <Link size={13} /> Make interactive
                    </button>
                  )}
                </section>
                <section className="inspector-section">
                  <button className="button full" onClick={addStop}>
                    <Plus size={13} /> Frame as story stop
                  </button>
                  {stop?.targetId && !index.byId.has(stop.targetId) && (
                    <button
                      className="button full repair"
                      onClick={() => updateStop({ targetId: node.id })}
                    >
                      Repair target with selection
                    </button>
                  )}
                </section>
              </>
            ) : stop ? (
              <>
                <div className="stop-inspector-title">
                  <span className="eyebrow">
                    {activeStop === 0
                      ? "THE OPENING SCENE"
                      : stop.choice
                        ? "A MOMENT OF CHOICE"
                        : "A CLOSER LOOK"}
                  </span>
                  <h2>{stop.title}</h2>
                  <p>
                    {activeStop === 0
                      ? "Set the scene. Invite curiosity."
                      : "One more detail. Another discovery."}
                  </p>
                </div>
                <section className="inspector-section">
                  <Field
                    label="Stop name"
                    value={stop.title}
                    onCommit={(v) => updateStop({ title: v })}
                  />
                  <TextField
                    label="Story caption"
                    value={stop.caption}
                    onCommit={(v) => updateStop({ caption: v })}
                    rows={5}
                  />
                  <div
                    className={`target-card ${stop.targetId && !index.byId.has(stop.targetId) ? "broken" : ""}`}
                  >
                    <Focus size={16} />
                    <div>
                      <span>CAMERA TARGET</span>
                      <strong>
                        {stop.targetId
                          ? index.byId.get(stop.targetId)?.name ||
                            "Missing target"
                          : "Saved camera frame"}
                      </strong>
                    </div>
                    {index.byId.has(stop.targetId) && <Check size={13} />}
                  </div>
                  {stop.targetId && !index.byId.has(stop.targetId) && (
                    <>
                      <p className="helper error">
                        The original object was deleted. Select an object on the
                        canvas, then repair this target.
                      </p>
                      <label className="field">
                        <span>Repair target</span>
                        <select
                          value=""
                          onChange={(e) =>
                            updateStop({ targetId: e.target.value })
                          }
                        >
                          <option value="" disabled>
                            Choose a replacement...
                          </option>
                          {project.nodes
                            .filter(
                              (n) => n.type === "scene" || n.type === "text",
                            )
                            .map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </>
                  )}
                </section>
                <section className="inspector-section">
                  <h3>
                    Camera & timing
                    <Settings2 size={13} />
                  </h3>
                  <div className="field-grid">
                    <Field
                      label="Transition (s)"
                      type="number"
                      value={stop.transition}
                      min="0"
                      onCommit={(v) => updateStop({ transition: v })}
                    />
                    <Field
                      label="Pause (s)"
                      type="number"
                      value={stop.dwell}
                      min="0"
                      onCommit={(v) => updateStop({ dwell: v })}
                    />
                  </div>
                  <label className="field">
                    <span>Movement</span>
                    <select
                      value={stop.easing}
                      onChange={(e) => updateStop({ easing: e.target.value })}
                    >
                      <option value="smooth">Smooth & natural</option>
                      <option value="gentle">Gentle ease</option>
                      <option value="linear">Constant zoom speed</option>
                    </select>
                  </label>
                  <div className="motion-curve">
                    <svg viewBox="0 0 190 43">
                      <path
                        d="M0 37H190M0 6H190"
                        stroke="#e5e8df"
                        strokeDasharray="3 4"
                      />
                      <path
                        d={
                          stop.easing === "linear"
                            ? "M5 37L185 6"
                            : "M5 37C70 37 115 6 185 6"
                        }
                        stroke="#71927b"
                        strokeWidth="2"
                        fill="none"
                      />
                      <circle cx="5" cy="37" r="3" fill="#71927b" />
                      <circle cx="185" cy="6" r="3" fill="#71927b" />
                    </svg>
                    <span>Ease in. Look closer. Settle in.</span>
                  </div>
                  <button
                    className="button full"
                    onClick={() => {
                      seek(
                        Math.max(
                          0,
                          stopTime(project, activeStop) - stop.transition,
                        ),
                      );
                      setPlaying(true);
                    }}
                  >
                    <Play size={12} /> Preview transition
                  </button>
                </section>
                <section className="inspector-section">
                  <h3>
                    Choose your own path
                    <GitBranch size={13} />
                  </h3>
                  <p className="helper">
                    Turn a moment into a fork in the story.
                  </p>
                  <label className="switch-row">
                    <span>Pause for a choice</span>
                    <input
                      role="switch"
                      type="checkbox"
                      checked={!!stop.choice}
                      onChange={(e) => updateStop({ choice: e.target.checked })}
                    />
                  </label>
                  <button className="button full" onClick={addBranch}>
                    <Plus size={13} /> Add branch hotspot
                  </button>
                </section>
                <section className="inspector-section">
                  <div className="button-row">
                    <IconButton
                      icon={ArrowUp}
                      label="Move stop earlier"
                      disabled={activeStop === 0}
                      onClick={() => reorderStop(activeStop, activeStop - 1)}
                    />
                    <IconButton
                      icon={ArrowDown}
                      label="Move stop later"
                      disabled={activeStop === project.stops.length - 1}
                      onClick={() => reorderStop(activeStop, activeStop + 1)}
                    />
                    <button
                      className="button small"
                      onClick={() => {
                        commit((p) => ({
                          ...p,
                          stops: [
                            ...p.stops.slice(0, activeStop + 1),
                            {
                              ...stop,
                              id: uid("stop"),
                              title: `${stop.title} copy`,
                            },
                            ...p.stops.slice(activeStop + 1),
                          ],
                        }));
                        setActiveStop(activeStop + 1);
                      }}
                    >
                      <Copy size={12} /> Duplicate
                    </button>
                    <IconButton
                      icon={Trash2}
                      label="Delete story stop"
                      onClick={deleteStop}
                    />
                  </div>
                </section>
              </>
            ) : (
              <div className="empty-inspector">
                <Leaf size={30} />
                <h2>A world of possibility.</h2>
                <p>
                  Add text, illustrations, and scenes. Then frame your first
                  story stop.
                </p>
                <button className="button primary" onClick={addStop}>
                  <Plus size={14} /> Create first stop
                </button>
              </div>
            )}
          </div>
          <div className="inspector-footer">
            <span className="status-dot" /> Everything is editable.
          </div>
        </aside>
      </div>
      <footer className="statusbar">
        <span>
          <span className="status-dot" /> LOCAL WORKSPACE
        </span>
        <span>
          {project.nodes.length} objects <i /> {scenes.length} scenes <i />{" "}
          {project.links.length / 2 >= 1
            ? `${new Set(project.links.map((l) => l.targetStopId)).size} connected destinations`
            : "Your next story starts here"}
        </span>
        <button onClick={() => setSnap(!snap)}>
          <Maximize size={10} /> Snap {snap ? "on" : "off"}
        </button>
        <button onClick={() => setModal("help")}>
          Made for the curious <Leaf size={11} />
        </button>
      </footer>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={uploadImage}
        data-testid="image-upload"
      />
      <input
        ref={packageRef}
        type="file"
        accept=".atlas,.json,application/json"
        hidden
        onChange={uploadPackage}
        data-testid="package-upload"
      />
      <input
        ref={textRef}
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        hidden
        onChange={uploadText}
        data-testid="text-upload"
      />
      {toast && (
        <div className="toast" role="status">
          <Leaf size={16} />
          <span>{toast}</span>
          <IconButton
            icon={X}
            label="Dismiss notification"
            onClick={() => setToast("")}
          />
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "projects" ? "project-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={modal}
          >
            <IconButton
              icon={X}
              label="Close dialog"
              className="modal-close"
              onClick={() => setModal(null)}
            />
            {modal === "publish" ? (
              <>
                <span className="modal-eyebrow">
                  <Leaf size={15} /> LET YOUR STORY WANDER
                </span>
                <h2>
                  A whole world.
                  <br />
                  Ready to share.
                </h2>
                <p>
                  Publish an interactive, self-contained viewer. Your scenes,
                  choices, and original assets travel together.
                </p>
                <div className="publish-summary">
                  <strong>{project.name}</strong>
                  <span>
                    {project.stops.length} story stops <i /> {scenes.length}{" "}
                    nested scenes <i /> Works offline
                  </span>
                </div>
                {project.stops.some(
                  (s) => s.targetId && !index.byId.has(s.targetId),
                ) && (
                  <p className="error">
                    Some story targets are unresolved. Repair them before
                    publishing for a complete journey.
                  </p>
                )}
                <button
                  className="button primary full"
                  disabled={
                    publishing ||
                    project.stops.some(
                      (s) => s.targetId && !index.byId.has(s.targetId),
                    )
                  }
                  onClick={publish}
                >
                  <Download size={15} />{" "}
                  {publishing ? "Packing your world..." : "Download viewer ZIP"}
                </button>
                <div className="publish-instructions">
                  <span>01 &nbsp; Unzip the download.</span>
                  <span>
                    02 &nbsp; In that folder, run{" "}
                    <code>python3 -m http.server 8080</code>
                  </span>
                  <span>
                    03 &nbsp; Open <code>http://localhost:8080</code>, or host
                    the folder anywhere.
                  </span>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    exportProject(project).catch((e) => notify(e.message))
                  }
                >
                  Need the editable project? Export .atlas instead{" "}
                  <ArrowRight size={12} />
                </button>
              </>
            ) : modal === "projects" ? (
              <>
                <span className="modal-eyebrow">YOUR LOCAL LIBRARY</span>
                <h2>Room for another world.</h2>
                <p>
                  Your stories stay in this browser. Export a project to back it
                  up or take it elsewhere.
                </p>
                <div className="new-project-actions">
                  <button onClick={() => switchProject(createBlank())}>
                    <Plus size={26} />
                    <strong>Start from a blank canvas</strong>
                    <span>Your idea. Your first mark.</span>
                  </button>
                  <button
                    onClick={() => {
                      const p = createExample();
                      p.id = uid("project");
                      switchProject(p);
                    }}
                  >
                    <Leaf size={26} />
                    <strong>Explore the forest example</strong>
                    <span>A complete world to make your own.</span>
                  </button>
                </div>
                <h3>Saved projects</h3>
                <div className="saved-projects">
                  {projects.map((p) => (
                    <div key={p.id}>
                      <span className="saved-project-icon">
                        <Frame size={19} />
                      </span>
                      <button
                        onClick={async () => {
                          try {
                            await switchProject(await loadProject(p.id));
                          } catch (e) {
                            notify(e.message);
                          }
                        }}
                      >
                        <strong>{p.name}</strong>
                        <span>
                          {p.nodeCount} objects ·{" "}
                          {new Date(p.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                      <IconButton
                        icon={Trash2}
                        label={`Delete project ${p.name}`}
                        disabled={p.id === project.id}
                        onClick={async () => {
                          try {
                            await removeProject(p.id);
                            setProjects(await listProjects());
                          } catch (e) {
                            notify(e.message);
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
                <button
                  className="button full"
                  onClick={() => packageRef.current.click()}
                >
                  <Upload size={14} /> Import editable project (.atlas)
                </button>
              </>
            ) : modal === "project-menu" ? (
              <>
                <span className="modal-eyebrow">PROJECT TOOLS</span>
                <h2>Keep creating.</h2>
                <div className="menu-options">
                  <button onClick={openBrowser}>
                    <FolderOpen size={18} />
                    <span>Open project library</span>
                    <ChevronRight size={15} />
                  </button>
                  <button
                    onClick={() => {
                      setModal(null);
                      exportProject(project).catch((e) => notify(e.message));
                    }}
                  >
                    <Download size={18} />
                    <span>Export editable project</span>
                    <ChevronRight size={15} />
                  </button>
                  <button onClick={() => packageRef.current.click()}>
                    <Upload size={18} />
                    <span>Import a project package</span>
                    <ChevronRight size={15} />
                  </button>
                  <button
                    onClick={() => {
                      textRef.current.click();
                      setModal(null);
                    }}
                  >
                    <Type size={18} />
                    <span>Import text (.txt or .md)</span>
                    <ChevronRight size={15} />
                  </button>
                  <button onClick={() => setModal("publish")}>
                    <Leaf size={18} />
                    <span>Publish a portable viewer</span>
                    <ChevronRight size={15} />
                  </button>
                </div>
              </>
            ) : modal === "canvas-settings" ? (
              <>
                <span className="modal-eyebrow">A LITTLE PRECISION</span>
                <h2>Your canvas, your way.</h2>
                <label className="switch-row">
                  <span>Snap to a 5-unit local grid</span>
                  <input
                    type="checkbox"
                    checked={snap}
                    onChange={(e) => setSnap(e.target.checked)}
                  />
                </label>
                <label className="switch-row">
                  <span>Inspect all semantic zoom levels</span>
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                  />
                </label>
                <p>
                  Hold Alt while dragging to bypass snapping. Visibility
                  overrides never affect your published story.
                </p>
                <div className="publish-summary">
                  <strong>A deep canvas. Predictable limits.</strong>
                  <span>
                    Camera 0.00001x to 10,000,000,000x.
                    <br />
                    Local scale 0.000001 to 1,000,000.
                    <br />
                    Up to 20,000 objects per project.
                  </span>
                </div>
              </>
            ) : (
              <>
                <span className="modal-eyebrow">A FIELD GUIDE TO FOLIA</span>
                <h2>Follow your curiosity.</h2>
                <p>
                  Everything lives on one canvas. Double-click a scene to enter;
                  use the breadcrumbs or Escape to find your way back.
                </p>
                <div className="shortcut-list">
                  {[
                    ["V / H", "Select / hand tool"],
                    ["T / R / P", "Text / rectangle / freehand"],
                    ["Scroll", "Zoom around your cursor"],
                    ["Space + drag", "Pan the canvas"],
                    ["Shift + click", "Select multiple objects"],
                    ["Double-click text", "Edit text in place"],
                    ["F / 0", "Fit selection / whole story"],
                    ["Ctrl + G / Shift + Ctrl + G", "Group / ungroup"],
                    ["Ctrl + D", "Duplicate selection"],
                    ["Ctrl + Z / Shift + Ctrl + Z", "Undo / redo"],
                    ["Arrow keys / Shift", "Nudge 1 / 10 local units"],
                    ["Escape", "Finish text / clear / parent scene"],
                  ].map(([key, desc]) => (
                    <div key={key}>
                      <span>{desc}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
                <p className="helper">
                  Viewer: Left / Right for stops, Space to play, Home to
                  restart. Reduced motion is supported. All artwork is original
                  and included locally.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
