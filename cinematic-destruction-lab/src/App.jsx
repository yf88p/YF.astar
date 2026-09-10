import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Box,
  Camera,
  Check,
  ChevronDown,
  Circle,
  CircleHelp,
  Clapperboard,
  Copy,
  Crosshair,
  Download,
  Expand,
  Eye,
  Film,
  Focus,
  FolderOpen,
  Grid2X2,
  Hexagon,
  Image,
  Layers,
  Link2,
  LockKeyhole,
  Magnet,
  Maximize,
  MoreHorizontal,
  MousePointer2,
  Move3D,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Settings2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  StepForward,
  Target,
  Trash2,
  Undo2,
  UnlockKeyhole,
  Upload,
  Video,
  X,
  Zap,
} from "lucide-react";
import {
  createObject,
  createProject,
  LIMITS,
  MATERIALS,
  validateProject,
} from "./core/model.js";
import { initPhysics, Simulation } from "./core/simulation.js";
import { Recorder } from "./core/replay.js";
import { Viewport } from "./viewport.js";
import { exportVideo, exportStill } from "./video.js";

const clone = (value) => structuredClone(value);
const uid = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const fixed = (n, d = 2) => Number(n || 0).toFixed(d);
const bytes = (n) =>
  n > 1048576
    ? `${(n / 1048576).toFixed(1)} MiB`
    : `${(n / 1024).toFixed(0)} KiB`;
const names = {
  storefront: "Glasshouse",
  structure: "Load path",
  range: "Material range",
  blank: "Blank laboratory",
};
const INITIAL_CAMERAS = [
  {
    id: "camera-1",
    name: "Establishing",
    time: 0,
    position: [9, 5.2, 10],
    target: [0, 1.8, 0],
    fov: 36,
  },
  {
    id: "camera-2",
    name: "Into the impact",
    time: 3,
    position: [3.8, 3.1, 7],
    target: [0, 1.65, 0],
    fov: 39,
  },
];

function importedCameras(recorder) {
  const ids = new Set(),
    times = new Set();
  return recorder.cameras.map((c, i) => {
    const pose = {
      ...c,
      id: c.id ?? `camera-${i}`,
      name: c.name ?? `Camera ${i + 1}`,
      time:
        c.time ??
        (i / Math.max(1, recorder.cameras.length - 1)) *
          Math.min(4, recorder.duration),
      fov: c.fov ?? 36,
    };
    if (
      typeof pose.id !== "string" ||
      typeof pose.name !== "string" ||
      pose.name.length > 160 ||
      ids.has(pose.id) ||
      times.has(pose.time)
    )
      throw new Error(
        "Camera names and IDs must be strings; IDs and keyframe times must be unique.",
      );
    if (
      pose.fov >= 179 ||
      [...pose.position, ...pose.target].some((n) => Math.abs(n) > 1e12)
    )
      throw new Error(
        "Saved camera coordinates must be within the recording range and field of view below 179 degrees.",
      );
    if (pose.view) {
      for (const key of ["position", "target"])
        if (
          !Array.isArray(pose.view[key]) ||
          pose.view[key].length !== 3 ||
          pose.view[key].some((n) => !Number.isFinite(n) || Math.abs(n) > 1e12)
        )
          throw new Error(
            "Saved camera framing needs finite position and target triples within the recording range.",
          );
      if (
        !Number.isFinite(pose.view.fov) ||
        pose.view.fov < 1 ||
        pose.view.fov >= 179
      )
        throw new Error("Saved camera field of view must be 1-178 degrees.");
    }
    if (
      pose.playhead !== undefined &&
      (!Number.isFinite(pose.playhead) ||
        pose.playhead < recorder.frames[0].time ||
        pose.playhead > recorder.duration)
    )
      throw new Error("Saved playhead must be inside the recorded take.");
    ids.add(pose.id);
    times.add(pose.time);
    return pose;
  });
}

function IconButton({ icon: Icon, title, active, className = "", ...props }) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={title}
      aria-label={title}
      {...props}
    >
      <Icon size={16} strokeWidth={1.65} />
    </button>
  );
}

function NumberField({
  value,
  onChange,
  label,
  unit,
  step = "any",
  className = "",
}) {
  const [draft, setDraft] = useState(String(value ?? 0));
  const cancelled = useRef(false);
  useEffect(() => setDraft(String(value ?? 0)), [value]);
  function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft === String(value)) return;
    const n = draft.trim() === "" ? NaN : Number(draft);
    onChange(n);
    setDraft(String(value ?? 0));
  }
  return (
    <label className={`number-field ${className}`}>
      <span className="field-label">{label}</span>
      <span className="input-shell">
        <input
          aria-label={label}
          type="number"
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelled.current = true;
              setDraft(String(value));
              e.currentTarget.blur();
            }
          }}
        />
        <span className="unit">{unit}</span>
      </span>
    </label>
  );
}

function VectorFields({
  value,
  onChange,
  label,
  unit = "m",
  labels = ["X", "Y", "Z"],
}) {
  return (
    <div className="vector-fields">
      <div className="field-label vector-label">
        {label}
        <span>{unit}</span>
      </div>
      <div className="vector-row">
        {value.map((v, i) => (
          <NumberField
            key={i}
            label={`${label} ${labels[i]}`}
            unit={labels[i]}
            value={Math.round(v * 100000) / 100000}
            onChange={(n) => {
              const next = [...value];
              next[i] = n;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function MaterialCube({ material, size = 36 }) {
  const colors = {
    glass: ["#90bfb2", "#4c7b73", "#6b9a91"],
    concrete: ["#999c91", "#545b53", "#767e73"],
    timber: ["#c49762", "#715231", "#987447"],
    steel: ["#929d9a", "#414c48", "#68736e"],
  }[material];
  return (
    <svg
      className={`material-cube ${material}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
      <path d="M20 3 36 12 20 21 4 12Z" fill={colors[0]} />
      <path d="M4 12 20 21 20 38 4 29Z" fill={colors[1]} />
      <path d="M20 21 36 12 36 29 20 38Z" fill={colors[2]} />
      <path
        d="M4 12 20 21 36 12M20 21v17"
        fill="none"
        stroke="#d8e3d3"
        strokeOpacity=".26"
      />
      {material === "timber" && (
        <path
          d="m8 17 9 5m-9 0 9 5m7-5 9-5m-9 10 9-5m-9 10 9-5"
          stroke="#d5b286"
          opacity=".3"
        />
      )}
      {material === "glass" && (
        <path d="m24 24 8-10m-8 15 8-10" stroke="#d7eee2" strokeOpacity=".35" />
      )}
    </svg>
  );
}

export default function App() {
  const stageRef = useRef(null),
    fileRef = useRef(null),
    runtime = useRef({}),
    actions = useRef({}),
    history = useRef({ past: [], future: [] });
  const [project, setProject] = useState(() => createProject("storefront"));
  const [ready, setReady] = useState(false),
    [selection, setSelection] = useState(["pane-1"]),
    [fragmentId, setFragmentId] = useState(null);
  const [mode, setMode] = useState("simulate"),
    [inspector, setInspector] = useState("impact"),
    [tool, setToolState] = useState("select");
  const [running, setRunning] = useState(false),
    [snapshot, setSnapshot] = useState(null),
    [playhead, setPlayhead] = useState(0),
    [duration, setDuration] = useState(0),
    [speed, setSpeed] = useState(1);
  const [cameras, setCameras] = useState(INITIAL_CAMERAS),
    [cameraMode, setCameraMode] = useState("orbit"),
    [tracking, setTracking] = useState("projectile");
  const [layers, setLayers] = useState({
    grid: true,
    bonds: false,
    wireframe: false,
    trajectory: true,
    dimensions: true,
    presentation: false,
  });
  const [snap, setSnap] = useState(true),
    [menu, setMenu] = useState(null),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(null),
    [confirm, setConfirm] = useState(null);
  const [progress, setProgress] = useState(null),
    [video, setVideo] = useState(null),
    [fps, setFps] = useState(0),
    [mobilePanel, setMobilePanel] = useState("scene");
  const [impactId, setImpactId] = useState("impact-1");
  const [recordingBudget, setRecordingBudget] = useState(127);
  const abortRef = useRef(null);
  const selected = project.objects.find((o) => o.id === selection[0]);
  const impact =
    project.impacts.find((i) => i.id === impactId) || project.impacts[0];
  const stats = snapshot?.stats;
  const selectedFragment = snapshot?.fragments.find((f) => f.id === fragmentId);
  const fragmentGeometry = runtime.current.sim?.fragments.find(
    (f) => f.id === fragmentId,
  );
  const totalFragments = project.objects.reduce((sum, o) => sum + o.density, 0);
  const recording = duration > 0;

  function notify(message, error = false) {
    setToast({ message, error, id: Date.now() });
  }
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), toast.error ? 8500 : 4800);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  function syncUI(state = runtime.current.viewport?.snapshot) {
    const r = runtime.current;
    setRunning(!!r.running);
    setPlayhead(r.playhead || 0);
    setDuration(r.recorder?.duration || 0);
    if (state) setSnapshot(state);
  }

  function handleRuntimeError(error) {
    const r = runtime.current;
    r.running = false;
    if (
      r.recorder &&
      (error.code === "RECORDING_BYTE_LIMIT" ||
        error.message?.startsWith("Recording:") ||
        r.sim?.tick !== r.recorder.frames.at(-1).tick)
    ) {
      // The failed step may have advanced Rapier, but it was never committed to
      // history. Freeze the last valid recording; do not resume an incompatible tail.
      r.imported = true;
      r.playhead = r.recorder.duration;
      r.accumulator = 0;
      r.viewport.setState(r.recorder.sample(r.playhead));
      r.viewport.setEnabled(false);
      notify(
        `${error.code === "RECORDING_BYTE_LIMIT" ? "Recording storage limit reached." : error.message} Preserved ${r.recorder.frames.length} states through ${fixed(r.playhead, 3)} s. Export this take or reset to begin another.`,
        true,
      );
    } else notify(error.message, true);
    syncUI();
  }

  function applyProject(
    next,
    label = "Scene updated",
    kind = "edit",
    imported = null,
  ) {
    const r = runtime.current;
    let sim;
    try {
      const valid = validateProject(next);
      sim = new Simulation(valid);
      const recorder =
        imported || new Recorder(sim, { maxBytes: r.recordingMaxBytes });
      r.viewport.setProject(valid, sim.fragments);
      if (kind === "undo") {
        history.current.future.push(clone(r.project));
        history.current.past.pop();
      } else if (kind === "redo") {
        history.current.past.push(clone(r.project));
        history.current.future.pop();
      } else if (r.project) {
        history.current.past.push(clone(r.project));
        history.current.past = history.current.past.slice(-40);
        history.current.future = [];
      }
      r.sim?.dispose();
      r.sim = sim;
      r.project = valid;
      r.recorder = recorder;
      r.imported = !!imported;
      r.running = false;
      r.accumulator = 0;
      r.playhead = imported
        ? (imported.cameras[0]?.playhead ?? recorder.duration)
        : 0;
      const state = recorder.sample(r.playhead);
      r.viewport.setState(state);
      r.viewport.setEnabled(!imported);
      const nextSelection =
        r.selection?.filter((id) => valid.objects.some((o) => o.id === id)) ||
        [];
      r.selection = nextSelection;
      setSelection(nextSelection);
      setFragmentId(null);
      r.viewport.setSelection(nextSelection);
      setProject(valid);
      syncUI(state);
      setConfirm(null);
      setMenu(null);
      if (imported?.cameras?.length) {
        setCameras(imported.cameras);
        const meta = imported.cameras[0];
        if (meta.view) {
          r.viewport.setCameraMode("orbit");
          r.viewport.camera.position.fromArray(meta.view.position);
          r.viewport.controls.target.fromArray(meta.view.target);
          r.viewport.camera.fov = meta.view.fov;
          r.viewport.camera.updateProjectionMatrix();
          r.viewport.camera.lookAt(r.viewport.controls.target);
        }
        if ([0.1, 0.25, 0.5, 1, 2].includes(meta.presentationSpeed))
          setSpeed(meta.presentationSpeed);
        if (["orbit", "path", "tracking"].includes(meta.mode)) {
          setCameraMode(meta.mode);
          r.viewport.setCameraMode(meta.mode);
        }
        if (typeof meta.trackingTarget === "string")
          setTracking(meta.trackingTarget);
      }
      notify(label);
      return true;
    } catch (e) {
      if (sim && sim !== r.sim) sim.dispose();
      notify(e.message, true);
      return false;
    }
  }

  function requestProject(next, label, kind = "edit", imported = null) {
    if (runtime.current.exporting) return;
    try {
      const valid = validateProject(next);
      if (runtime.current.recorder?.duration > 0) {
        runtime.current.running = false;
        setRunning(false);
        setConfirm({ next: valid, label, kind, imported });
      } else applyProject(valid, label, kind, imported);
    } catch (e) {
      notify(e.message, true);
    }
  }

  function edit(mutator, label) {
    if (!runtime.current.project)
      return notify("Wait for the local physics engine to initialize.");
    const next = clone(runtime.current.project);
    mutator(next);
    requestProject(next, label);
  }
  function updateObject(key, value) {
    edit(
      (p) =>
        p.objects
          .filter((o) => selection.includes(o.id))
          .forEach((o) => {
            o[key] = value;
          }),
      `${key === "fixed" ? "Support state" : "Object"} updated. New authoring state.`,
    );
  }
  function updateImpact(key, value) {
    if (impact)
      edit((p) => {
        p.impacts.find((i) => i.id === impact.id)[key] = value;
      }, "Impact updated.");
  }
  function setTool(value) {
    setToolState(value);
    runtime.current.viewport?.setTool(value);
  }
  function selectObject(id, shift = false, fid = null) {
    const previous = runtime.current.selection || [];
    const ids = id
      ? shift
        ? previous.includes(id)
          ? previous.filter((i) => i !== id)
          : [...previous, id]
        : [id]
      : [];
    runtime.current.selection = ids;
    setSelection(ids);
    setFragmentId(fid);
    runtime.current.viewport?.setSelection(ids, recording ? fid : null);
    if (id) setInspector("object");
  }
  function addObject(material) {
    const object = createObject(material, {
      id: uid("object"),
      name: `${material[0].toUpperCase()}${material.slice(1)} ${project.objects.filter((o) => o.material === material).length + 1}`,
      seed: 1024 + project.objects.length * 317,
      position: [
        project.objects.length ? 4.8 : 0,
        material === "glass"
          ? 1.7
          : material === "concrete"
            ? 1.2
            : material === "steel"
              ? 2
              : 0.12,
        0,
      ],
    });
    const next = clone(project);
    next.objects.push(object);
    requestProject(
      next,
      `${object.name} created. Set exact dimensions in Object.`,
    );
    runtime.current.selection = [object.id];
    setSelection([object.id]);
    setInspector("object");
    setMode("build");
    setMobilePanel("inspector");
  }
  function duplicate() {
    if (!selection.length) return notify("Select an object to duplicate.");
    edit((p) => {
      const added = p.objects
        .filter((o) => selection.includes(o.id))
        .map((o) => ({
          ...clone(o),
          id: uid("object"),
          name: `${o.name} copy`,
          position: [o.position[0] + 0.5, o.position[1], o.position[2] + 0.6],
        }));
      p.objects.push(...added);
    }, "Selection duplicated.");
  }
  function removeObjects() {
    if (!selection.length) return;
    edit((p) => {
      p.objects = p.objects.filter((o) => !selection.includes(o.id));
      p.connections = p.connections.filter(
        (c) => !selection.includes(c.a) && !selection.includes(c.b),
      );
    }, "Selection deleted; incident connections removed.");
  }
  function undo(redo = false) {
    const stack = redo ? history.current.future : history.current.past;
    if (stack.length)
      requestProject(
        stack.at(-1),
        redo
          ? "Authoring transaction redone."
          : "Authoring transaction undone.",
        redo ? "redo" : "undo",
      );
  }
  function reset() {
    const r = runtime.current;
    try {
      const sim = new Simulation(r.project),
        recorder = new Recorder(sim, { maxBytes: r.recordingMaxBytes });
      r.sim.dispose();
      r.sim = sim;
      r.recorder = recorder;
      r.imported = false;
      r.playhead = 0;
      r.accumulator = 0;
      r.running = false;
      r.viewport.setProject(r.project, sim.fragments);
      r.viewport.setSelection(r.selection);
      r.viewport.setState(recorder.frames[0]);
      r.viewport.setEnabled(true);
      syncUI(recorder.frames[0]);
      notify("Take reset. The editable scene is unchanged.");
    } catch (e) {
      notify(e.message, true);
    }
  }
  function togglePlay() {
    const r = runtime.current;
    if (!r.sim || r.exporting) return;
    if (
      !r.running &&
      r.playhead >= r.recorder.duration &&
      (r.imported || r.sim.tick >= LIMITS.maxTicks)
    )
      r.playhead = 0;
    r.running = !r.running;
    r.accumulator = 0;
    r.viewport.setEnabled(false);
    syncUI();
  }
  function changeRecordingBudget(value) {
    const r = runtime.current;
    if (r.recorder?.duration > 0)
      return notify(
        "Reset the take before changing its recording budget.",
        true,
      );
    if (!Number.isFinite(value) || value < 0.125 || value > 127)
      return notify(
        "Recording budget must be between 0.125 and 127 MiB of complete frame data.",
        true,
      );
    try {
      const maxBytes = Math.floor(value * 1024 * 1024),
        recorder = new Recorder(r.sim, { maxBytes });
      r.recorder = recorder;
      r.recordingMaxBytes = maxBytes;
      setRecordingBudget(value);
      notify(
        "Local recording budget updated. This limit is not a material or physics parameter.",
      );
    } catch (e) {
      notify(e.message, true);
    }
  }
  function launch() {
    if (!impact)
      return notify("Add a projectile or impulse before launching.", true);
    if (recording) reset();
    const r = runtime.current;
    r.running = true;
    r.viewport.setEnabled(false);
    setRunning(true);
    setMode("simulate");
    notify(
      impact.type === "projectile"
        ? `Take rolling. Projectile scheduled at ${fixed(impact.time)} s.`
        : `Take rolling. Local impulse scheduled at ${fixed(impact.time)} s.`,
    );
  }
  function seek(time) {
    const r = runtime.current;
    if (!r.recorder || r.exporting) return;
    r.running = false;
    r.playhead = Math.max(0, Math.min(r.recorder.duration, time));
    r.accumulator = 0;
    const state = r.recorder.sample(r.playhead);
    r.viewport.setState(state);
    r.viewport.setEnabled(r.recorder.duration === 0);
    syncUI(state);
  }
  function step() {
    const r = runtime.current;
    if (!r.sim || r.exporting) return;
    r.running = false;
    if (r.playhead < r.recorder.duration - 1e-9)
      return seek(
        Math.min(
          r.recorder.duration,
          (Math.floor(r.playhead / LIMITS.dt + 1e-8) + 1) * LIMITS.dt,
        ),
      );
    if (r.imported)
      return notify(
        "This take is read-only. Reset to simulate the editable project.",
      );
    try {
      const state = r.sim.step();
      r.recorder.capture(state);
      r.playhead = state.time;
      r.viewport.setState(state);
      r.viewport.setEnabled(false);
      syncUI(state);
    } catch (e) {
      handleRuntimeError(e);
    }
  }
  function liveControl(fn) {
    const r = runtime.current;
    if (r.imported || Math.abs(r.playhead - r.recorder.duration) > 1e-7)
      return notify(
        "Return to the end of the live take to apply a physical event, or reset for a new take.",
        true,
      );
    try {
      const result = fn(r.sim);
      if (result === false)
        return notify(
          "No active support or nearby collider at this location. Choose a live attachment or a point on a fragment.",
          true,
        );
      const state = r.sim.snapshot();
      r.recorder.capture(state);
      r.viewport.setState(state);
      syncUI(state);
    } catch (e) {
      handleRuntimeError(e);
    }
  }

  useEffect(() => {
    let stopped = false,
      raf;
    const r = runtime.current;
    (async () => {
      try {
        await initPhysics();
        if (stopped) return;
        r.viewport = new Viewport(stageRef.current, {
          onSelect: (...args) => actions.current.selectObject(...args),
          onTransform: (ids, changes) =>
            actions.current.edit((p) => {
              for (const change of changes) {
                const o = p.objects.find((o) => o.id === change.id);
                Object.assign(o, change);
              }
            }, "Transform applied."),
          onAim: (point) => actions.current.aimAt(point),
        });
        r.project = validateProject(project);
        r.sim = new Simulation(r.project);
        r.recorder = new Recorder(r.sim);
        r.selection = selection;
        r.speed = 1;
        r.playhead = 0;
        r.accumulator = 0;
        r.running = false;
        r.cameraMode = "orbit";
        r.imported = false;
        r.viewport.setProject(r.project, r.sim.fragments);
        r.viewport.setSelection(selection);
        r.viewport.setSnap(true);
        r.viewport.setCameras(INITIAL_CAMERAS);
        r.viewport.setState(r.recorder.frames[0]);
        setSnapshot(r.recorder.frames[0]);
        setReady(true);
        let previous = performance.now(),
          lastUI = 0,
          lastFps = previous,
          frameCount = 0;
        const loop = (now) => {
          if (stopped) return;
          raf = requestAnimationFrame(loop);
          const wallDt = Math.min((now - previous) / 1000, 0.1);
          previous = now;
          if (r.exporting) return;
          try {
            if (r.running) {
              let state;
              if (r.playhead < r.recorder.duration - 1e-7) {
                r.playhead = Math.min(
                  r.recorder.duration,
                  r.playhead + wallDt * r.speed,
                );
                state = r.recorder.sample(r.playhead);
              } else if (!r.imported && r.sim.tick < LIMITS.maxTicks) {
                r.accumulator += wallDt * r.speed;
                let count = 0;
                while (
                  r.accumulator >= LIMITS.dt &&
                  count++ < 16 &&
                  r.sim.tick < LIMITS.maxTicks
                ) {
                  state = r.sim.step();
                  r.recorder.capture(state);
                  r.accumulator -= LIMITS.dt;
                }
                r.playhead = r.recorder.duration;
              } else r.running = false;
              if (state) r.viewport.setState(state);
            }
            r.viewport.render(wallDt);
            if (now - lastUI > 75) {
              actions.current.syncUI();
              lastUI = now;
            }
            frameCount++;
            if (now - lastFps > 1000) {
              setFps(Math.round((frameCount * 1000) / (now - lastFps)));
              lastFps = now;
              frameCount = 0;
            }
          } catch (e) {
            actions.current.handleRuntimeError(e);
          }
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        notify(
          `The local 3D engine could not start: ${e.message}. WebGL2 is required.`,
          true,
        );
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      r.sim?.dispose();
      r.viewport?.dispose();
    };
  }, []);

  function aimAt(point) {
    if (!impact) return notify("Create an impact first.", true);
    edit((p) => {
      const shot = p.impacts.find((i) => i.id === impact.id);
      if (shot.type === "impulse") shot.position = point;
      else {
        const delta = point.map((v, i) => v - shot.position[i]);
        const flight = Math.hypot(...delta) / Math.max(shot.speed, 0.001);
        delta[1] += 0.5 * p.settings.gravity * flight * flight;
        const length = Math.hypot(...delta);
        shot.direction = delta.map((v) => v / length);
      }
    }, "Aim set on the actual geometry. Ballistic preview is approximate.");
    setTool("select");
  }
  actions.current = {
    selectObject,
    edit,
    aimAt,
    syncUI,
    notify,
    togglePlay,
    step,
    reset,
    undo,
    duplicate,
    removeObjects,
    launch,
    handleRuntimeError,
  };
  useEffect(() => {
    runtime.current.viewport?.setSelection(
      selection,
      recording ? fragmentId : null,
    );
  }, [selection, fragmentId, recording, ready]);
  useEffect(() => {
    runtime.current.speed = speed;
  }, [speed]);
  useEffect(() => {
    runtime.current.viewport?.setCameras(cameras);
  }, [cameras, ready]);
  useEffect(() => {
    runtime.current.cameraMode = cameraMode;
    runtime.current.viewport?.setCameraMode(cameraMode);
  }, [cameraMode, ready]);
  useEffect(() => {
    runtime.current.trackingTarget = tracking;
    runtime.current.viewport?.setTrackingTarget(tracking);
  }, [tracking, ready]);
  useEffect(() => {
    runtime.current.viewport?.setLayers(layers);
  }, [layers, ready]);
  useEffect(() => {
    runtime.current.viewport?.setSnap(snap);
  }, [snap, ready]);
  useEffect(() => {
    if (!modal && !confirm) return;
    const previous = document.activeElement;
    document.querySelector('[role="dialog"] button')?.focus();
    return () => previous?.focus?.();
  }, [modal, confirm]);
  useEffect(() => {
    const keydown = (e) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        if (e.key === "Escape") {
          e.preventDefault();
          abortRef.current?.abort();
          setModal(null);
          setConfirm(null);
        }
        if (e.key === "Tab") {
          const focusable = [
            ...dialog.querySelectorAll(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled), video[controls], summary",
            ),
          ].filter((el) => el.getClientRects().length);
          const first = focusable[0],
            last = focusable.at(-1);
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              !dialog.contains(document.activeElement))
          ) {
            e.preventDefault();
            last?.focus();
          } else if (
            !e.shiftKey &&
            (document.activeElement === last ||
              !dialog.contains(document.activeElement))
          ) {
            e.preventDefault();
            first?.focus();
          }
        }
        return;
      }
      if (
        e.target.closest("input, textarea, select") ||
        runtime.current.exporting
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        actions.current.togglePlay();
      }
      if (e.key === "Enter" && !e.target.closest("button, a, summary")) {
        e.preventDefault();
        actions.current.launch();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        actions.current.undo(e.shiftKey);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        actions.current.duplicate();
      }
      if (e.key === "Delete" || e.key === "Backspace")
        actions.current.removeObjects();
      if (e.key === ".") actions.current.step();
      if (e.key.toLowerCase() === "f") {
        setCameraMode("orbit");
        runtime.current.viewport?.frameSelection();
      }
      if (e.key.toLowerCase() === "v") setTool("select");
      if (e.key.toLowerCase() === "g") setTool("translate");
      if (e.key.toLowerCase() === "r") setTool("rotate");
      if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey)
        setTool("scale");
      if (e.key === "Escape") {
        setLayers((l) => ({ ...l, presentation: false }));
        setModal(null);
        setMenu(null);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function saveProject() {
    if (!runtime.current.project)
      return notify("Wait for the local engine to initialize.");
    download(
      new Blob([JSON.stringify(runtime.current.project, null, 2)], {
        type: "application/json",
      }),
      `${project.name.replace(/[^\w-]/g, "-")}.fracture.json`,
    );
    notify(
      "Editable project exported, including materials, seeds, supports, and impacts.",
    );
    setMenu(null);
  }
  function saveTake() {
    try {
      const r = runtime.current,
        poses = (cameras.length ? cameras : INITIAL_CAMERAS).map((c) => ({
          ...c,
          presentationSpeed: speed,
          mode: cameraMode,
          trackingTarget: tracking,
          playhead: r.playhead,
          view: r.viewport.captureCamera(r.playhead),
        }));
      const data = r.recorder.serialize(r.project, poses),
        blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      download(blob, "fracture-take.take.json");
      notify(
        `Take exported: ${r.recorder.frames.length} fixed states, ${bytes(blob.size)}. Original project included separately.`,
      );
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function importFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 256 * 1024 * 1024)
      return notify(
        "Import exceeds 256 MiB. Use a shorter take or fewer fragments.",
        true,
      );
    try {
      const data = JSON.parse(await file.text());
      if (data.format === "fracture-take") {
        const rec = Recorder.fromJSON(data);
        rec.cameras = importedCameras(rec);
        setModal(null);
        requestProject(
          rec.project,
          "Recorded take opened. Scrub freely; reset to author or simulate a new take.",
          "import",
          rec,
        );
      } else {
        const valid = validateProject(data);
        setModal(null);
        requestProject(valid, "Editable project opened.", "import");
      }
    } catch (error) {
      notify(
        `Import rejected. ${error.message} Your previous document is unchanged.`,
        true,
      );
    }
  }
  async function still() {
    try {
      const r = runtime.current;
      r.running = false;
      r.exporting = true;
      setRunning(false);
      const blob = await exportStill(r.viewport);
      download(blob, `fracture-${fixed(r.playhead, 3)}s.png`);
      notify("Clean PNG still exported at the current viewport resolution.");
    } catch (e) {
      notify(e.message, true);
    } finally {
      runtime.current.exporting = false;
    }
  }
  async function renderVideo() {
    const r = runtime.current;
    r.running = false;
    r.exporting = true;
    setRunning(false);
    setProgress(0);
    abortRef.current = new AbortController();
    try {
      const blob = await exportVideo({
        viewport: r.viewport,
        recorder: r.recorder,
        speed,
        cameraMode,
        onProgress: (p) => setProgress(p),
        signal: abortRef.current.signal,
      });
      if (video?.url) URL.revokeObjectURL(video.url);
      setVideo({
        url: URL.createObjectURL(blob),
        blob,
        metadata: blob.metadata,
      });
      notify("Timestamped VP9 video rendered from the recorded take.");
    } catch (e) {
      if (e.name !== "AbortError") notify(e.message, true);
    } finally {
      r.exporting = false;
      setProgress(null);
    }
  }
  function addCamera() {
    if (cameras.length >= 64)
      return notify("Camera limit: 64 poses. Remove a keyframe first.", true);
    const pose = runtime.current.viewport.captureCamera(playhead);
    pose.id = uid("camera");
    pose.name = `Camera ${cameras.length + 1}`;
    setCameras((cs) =>
      [...cs.filter((c) => Math.abs(c.time - pose.time) > 1e-8), pose].sort(
        (a, b) => a.time - b.time,
      ),
    );
    notify(
      `Camera pose saved at ${fixed(playhead)} physical seconds, replacing a pose at the same time. Physics unchanged.`,
    );
  }
  function changeCamera(id, key, value) {
    if (
      key === "time" &&
      cameras.some((c) => c.id !== id && Math.abs(c.time - value) < 1e-8)
    )
      return notify(
        "A camera keyframe already exists at that time. Choose a distinct time.",
        true,
      );
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        (key === "time" && (value < 0 || value > 12)) ||
        (key === "fov" && (value < 10 || value > 100)))
    )
      return notify(
        "Camera time must be 0-12 s; lens field of view 10-100 degrees.",
        true,
      );
    if (
      Array.isArray(value) &&
      value.some((n) => !Number.isFinite(n) || Math.abs(n) > 500)
    )
      return notify(
        "Camera coordinates must be finite and within 500 m.",
        true,
      );
    setCameras((cs) =>
      cs
        .map((c) => (c.id === id ? { ...c, [key]: value } : c))
        .sort((a, b) => a.time - b.time),
    );
  }
  function addImpact() {
    const next = clone(project),
      shot = {
        id: uid("impact"),
        type: "projectile",
        position: [0, 1.8, 5],
        direction: [0, 0, -1],
        radius: 0.16,
        mass: 8,
        speed: 28,
        time: 0.4,
        magnitude: 200,
      };
    next.impacts.push(shot);
    setImpactId(shot.id);
    requestProject(next, "Scheduled impact added.");
  }
  function connectSelection() {
    if (selection.length !== 2)
      return notify(
        "Shift-select exactly two objects to create an explicit structural connection.",
        true,
      );
    edit(
      (p) =>
        p.connections.push({
          id: uid("joint"),
          a: selection[0],
          b: selection[1],
        }),
      "Explicit connection created between the nearest fragments.",
    );
  }

  const timelineEnd = Math.max(4, Math.ceil(duration));
  const view = runtime.current.viewport;
  const pixelsPerMeter = view
    ? view.container.clientHeight /
      (2 *
        view.camera.position.distanceTo(view.controls.target) *
        Math.tan((view.camera.fov * Math.PI) / 360))
    : 40;
  const rulerMeters =
    10 ** Math.floor(Math.log10(70 / Math.max(0.00001, pixelsPerMeter)));
  const eventTicks =
    runtime.current.recorder?.frames
      .filter((f) => f.events?.some((e) => e.type === "break"))
      .map((f) => f.time) || [];
  const firstBreak = eventTicks[0];
  const status = running
    ? playhead < duration - 0.01
      ? "PLAYING TAKE"
      : "RECORDING"
    : recording
      ? "TAKE PAUSED"
      : "READY TO SIMULATE";

  return (
    <div className={`application ${layers.presentation ? "presentation" : ""}`}>
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setModal("about");
          }}
          aria-label="About Fracture"
        >
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          <span>
            FRACTURE<span className="brand-dot">.</span>
          </span>
          <span className="lab-badge">LAB</span>
        </a>
        <div className="topbar-caption">CINEMATIC DESTRUCTION LABORATORY</div>
        <div className="topbar-actions">
          <span className="local-status">
            <span className="status-dot" /> All systems local
          </span>
          <span className="topbar-divider" />
          <IconButton
            icon={CircleHelp}
            title="Guide and shortcuts"
            onClick={() => setModal("about")}
          />
          <a
            className="version-link"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setModal("physics");
            }}
          >
            v1.0 <ArrowUpRight size={12} />
          </a>
        </div>
      </header>

      <nav className="projectbar" aria-label="Project and workspace">
        <div className="project-identity">
          <span className="project-icon">
            <Box size={17} />
          </span>
          <button
            className="project-name"
            onClick={() => setMenu(menu === "projects" ? null : "projects")}
          >
            {project.name}
            <ChevronDown size={13} />
          </button>
          <span className="saved-dot" title="Working locally" />
          <div className="history-tools">
            <IconButton
              icon={Undo2}
              title="Undo authoring (Ctrl+Z)"
              onClick={() => undo()}
              disabled={!history.current.past.length}
            />
            <IconButton
              icon={Redo2}
              title="Redo authoring (Ctrl+Shift+Z)"
              onClick={() => undo(true)}
              disabled={!history.current.future.length}
            />
          </div>
        </div>
        <div className="mode-tabs">
          {[
            ["build", Box, "Build"],
            ["simulate", Activity, "Simulate"],
            ["cinematic", Clapperboard, "Cinematic"],
          ].map(([value, Icon, title], i) => (
            <button
              key={value}
              className={mode === value ? "selected" : ""}
              onClick={() => {
                setMode(value);
                setInspector(
                  value === "build"
                    ? "object"
                    : value === "cinematic"
                      ? "camera"
                      : "impact",
                );
                if (value === "cinematic") {
                  setCameraMode("path");
                  if (recording) seek(0);
                }
              }}
            >
              <span className="tab-index">0{i + 1}</span>
              <Icon size={14} />
              <span>{title}</span>
            </button>
          ))}
        </div>
        <div className="project-actions">
          <button className="text-button save-button" onClick={saveProject}>
            <Save size={14} /> Save project
          </button>
          <button
            className="button button-light export-button"
            onClick={() => {
              setModal("export");
              setMenu(null);
            }}
          >
            <ArrowUpRight size={15} /> Export <ChevronDown size={12} />
          </button>
        </div>
        {menu === "projects" && (
          <div className="dropdown project-dropdown">
            <div className="dropdown-label">OPEN AN EXPERIMENT</div>
            {Object.entries(names).map(([key, name], i) => (
              <button
                key={key}
                onClick={() => {
                  requestProject(
                    createProject(key),
                    `${name} loaded. All members are editable.`,
                  );
                  setMenu(null);
                  runtime.current.viewport?.resetCamera();
                }}
              >
                <span className="example-number">0{i + 1}</span>
                <span>
                  {name}
                  <small>
                    {
                      [
                        "A glass facade, a single impact",
                        "Supported concrete and timber",
                        "Four material test fixtures",
                        "Start with an empty stage",
                      ][i]
                    }
                  </small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))}
            <div className="dropdown-separator" />
            <button onClick={() => fileRef.current.click()}>
              <FolderOpen size={16} /> Open project or take
              <Upload size={14} />
            </button>
          </div>
        )}
      </nav>

      <div className="mobile-switch">
        <button
          className={mobilePanel === "scene" ? "active" : ""}
          onClick={() => setMobilePanel("scene")}
        >
          Scene
        </button>
        <button
          className={mobilePanel === "library" ? "active" : ""}
          onClick={() => setMobilePanel("library")}
        >
          Build & hierarchy
        </button>
        <button
          className={mobilePanel === "inspector" ? "active" : ""}
          onClick={() => setMobilePanel("inspector")}
        >
          Inspector
        </button>
      </div>

      <main className={`workbench mobile-${mobilePanel}`}>
        <aside className="left-panel">
          <div className="panel-heading">
            <h2>SCENE LIBRARY</h2>
            <IconButton
              icon={Plus}
              title="Open example scenes"
              onClick={() => setMenu(menu === "projects" ? null : "projects")}
            />
          </div>
          <section className="palette-section">
            <div className="section-label">
              Start with a material<span>4 TYPES</span>
            </div>
            <div className="material-palette">
              {["glass", "concrete", "timber", "steel"].map((m) => (
                <button
                  key={m}
                  className="material-card"
                  onClick={() => addObject(m)}
                  disabled={!ready}
                  title={`Create ${m} object`}
                  aria-label={`Create ${m} object`}
                >
                  <MaterialCube material={m} size={41} />
                  <span>{m[0].toUpperCase() + m.slice(1)}</span>
                  <Plus size={11} />
                </button>
              ))}
            </div>
            <p className="quiet-note">
              <MousePointer2 size={11} /> Click to add. Make it your own.
            </p>
          </section>
          <div className="hierarchy-heading">
            <h2>
              HIERARCHY <span>{project.objects.length}</span>
            </h2>
            <div>
              <IconButton
                icon={Copy}
                title="Duplicate selection (Ctrl+D)"
                onClick={duplicate}
                disabled={!selection.length}
              />
              <IconButton
                icon={Trash2}
                title="Delete selection"
                onClick={removeObjects}
                disabled={!selection.length}
              />
            </div>
          </div>
          <div className="hierarchy">
            <div className="scene-root">
              <ChevronDown size={12} />
              <Layers size={14} />
              <span>Scene collection</span>
              <Eye size={12} />
            </div>
            {project.objects.map((o, i) => (
              <button
                key={o.id}
                className={`object-row ${selection.includes(o.id) ? "selected" : ""}`}
                onClick={(e) => {
                  selectObject(o.id, e.shiftKey);
                  setInspector("object");
                }}
              >
                <span className="tree-branch" />
                <span className={`object-symbol ${o.material}`}>
                  <Box size={13} />
                </span>
                <span className="object-name">{o.name}</span>
                {o.fixed ? (
                  <LockKeyhole size={11} className="row-support" />
                ) : (
                  <span className="object-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                )}
              </button>
            ))}
            {!project.objects.length && (
              <div className="empty-hierarchy">
                <Box size={26} />
                <p>
                  A blank canvas for
                  <br />a beautiful collapse.
                </p>
              </div>
            )}
            <div className="scene-root impacts-root">
              <ChevronDown size={12} />
              <Crosshair size={14} />
              <span>Scheduled impacts</span>
              <button aria-label="Add scheduled impact" onClick={addImpact}>
                <Plus size={13} />
              </button>
            </div>
            {project.impacts.map((s, i) => (
              <button
                key={s.id}
                className={`object-row shot-row ${impact?.id === s.id && inspector === "impact" ? "shot-selected" : ""}`}
                onClick={() => {
                  setImpactId(s.id);
                  setInspector("impact");
                }}
              >
                <span className="tree-branch" />
                <Circle size={12} />
                <span className="object-name">
                  {s.type === "projectile" ? "Projectile" : "Local impulse"}{" "}
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="object-index">{fixed(s.time, 1)}s</span>
              </button>
            ))}
          </div>
          <div className="left-panel-bottom">
            <button className="connection-button" onClick={connectSelection}>
              <Link2 size={14} /> Connect selection
              <span>{selection.length}/2</span>
            </button>
            <div className="fragment-budget">
              <div>
                <span>Fragment budget</span>
                <span>
                  <b>{totalFragments}</b> / {LIMITS.maxFragments}
                </span>
              </div>
              <div className="budget-bar">
                <span
                  style={{
                    width: `${(totalFragments / LIMITS.maxFragments) * 100}%`,
                  }}
                />
              </div>
              <small>Real geometry. Real rigid bodies.</small>
            </div>
            <button className="guide-card" onClick={() => setModal("about")}>
              <span className="guide-icon">
                <Sparkles size={17} />
              </span>
              <span>
                Make a little history.
                <small>Your first impact, in four steps.</small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          </div>
        </aside>

        <section className="stage-panel" aria-label="3D laboratory">
          <div ref={stageRef} className="stage-canvas" />
          {!ready && (
            <div className="loading-overlay">
              <span className="loading-ring" />
              <b>Preparing the laboratory</b>
              <span>Loading the local physics engine</span>
            </div>
          )}
          <div className="viewport-top">
            <div className="viewport-title">
              <span className="live-square" /> PERSPECTIVE{" "}
              <ChevronDown size={10} />
              <span className="viewport-divider" />
              <span>LIT</span>
            </div>
            <div className="viewport-top-actions">
              <IconButton
                icon={Grid2X2}
                title="Toggle metric grid"
                active={layers.grid}
                onClick={() => setLayers((l) => ({ ...l, grid: !l.grid }))}
              />
              <IconButton
                icon={Hexagon}
                title="Show fracture topology"
                active={layers.wireframe}
                onClick={() =>
                  setLayers((l) => ({ ...l, wireframe: !l.wireframe }))
                }
              />
              <IconButton
                icon={Link2}
                title="Show bonds and damage"
                active={layers.bonds}
                onClick={() => setLayers((l) => ({ ...l, bonds: !l.bonds }))}
              />
              <span className="vertical-divider" />
              <IconButton
                icon={Maximize}
                title="Clean presentation (Escape to exit)"
                onClick={() => setLayers((l) => ({ ...l, presentation: true }))}
              />
            </div>
          </div>
          <div className="scene-caption">
            <span className="eyebrow">
              EXPERIMENT /{" "}
              {project.name.includes("02")
                ? "002"
                : project.name.includes("03")
                  ? "003"
                  : "001"}
            </span>
            <h1>{project.name.split(" / ")[0]}</h1>
            <p>
              {project.objects.some((o) => o.material === "glass")
                ? "A study in controlled failure."
                : "Give gravity something to work with."}
            </p>
          </div>
          <div className="viewport-toolbar">
            {[
              ["select", MousePointer2, "Select (V)"],
              ["translate", Move3D, "Translate (G)"],
              ["rotate", RotateCw, "Rotate (R)"],
              ["scale", Expand, "Scale (S)"],
            ].map(([value, Icon, title]) => (
              <IconButton
                key={value}
                icon={Icon}
                title={title}
                active={tool === value}
                onClick={() => setTool(value)}
              />
            ))}
            <span className="toolbar-separator" />
            <IconButton
              icon={Magnet}
              title="Snap: 0.1 m / 15 degrees / 0.1 scale"
              active={snap}
              onClick={() => setSnap((v) => !v)}
            />
            <IconButton
              icon={Focus}
              title="Frame selection (F)"
              onClick={() => {
                setCameraMode("orbit");
                runtime.current.viewport?.frameSelection();
              }}
            />
          </div>
          <div className="scene-scale">
            <span
              className="scale-bracket"
              style={{ width: rulerMeters * pixelsPerMeter }}
            />
            <span title="Projected metric scale at the orbit target depth">
              {Number(rulerMeters.toPrecision(2))} m
            </span>
            <span className="scene-unit">METRIC WORLD</span>
          </div>
          <div className="scene-legend">
            <span>
              <i className="legend-intact" />{" "}
              {stats?.total ? stats.total - stats.released : totalFragments}{" "}
              bonded / fixed
            </span>
            <span>
              <i className="legend-released" /> {stats?.released || 0} released
            </span>
          </div>
          <div className="axis-widget" aria-label="World axes: Y up">
            <span className="axis-y">Y</span>
            <span className="axis-z">Z</span>
            <span className="axis-x">X</span>
            <i />
            <b />
          </div>
          {tool === "aim" && (
            <div className="aim-message">
              <Crosshair size={16} /> Click a point on the actual geometry to
              aim{" "}
              <button onClick={() => setTool("select")}>
                <X size={14} />
              </button>
            </div>
          )}
          {recording && (
            <div className="take-indicator">
              <span className={running ? "record-dot" : "pause-dot"} />
              {running ? "TAKE 01 / LIVE" : "TAKE 01 / FROZEN"}
              <span>{fixed(playhead, 3)} s</span>
            </div>
          )}
          <div className="orbit-tip">
            <MousePointer2 size={11} />
            <span>
              Drag to orbit<span className="tip-divider">/</span>Scroll to
              explore
            </span>
          </div>
          {layers.presentation && (
            <button
              className="exit-presentation button"
              onClick={() => setLayers((l) => ({ ...l, presentation: false }))}
            >
              <ArrowLeft size={14} /> Back to laboratory <kbd>ESC</kbd>
            </button>
          )}
        </section>

        <aside className="right-panel">
          <div className="inspector-tabs">
            {[
              ["impact", Crosshair, "Impact"],
              ["object", Box, "Object"],
              ["camera", Camera, "Camera"],
            ].map(([key, Icon, label]) => (
              <button
                key={key}
                className={inspector === key ? "active" : ""}
                onClick={() => setInspector(key)}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
            <IconButton
              icon={Settings2}
              title="Simulation settings"
              active={inspector === "settings"}
              onClick={() => setInspector("settings")}
            />
          </div>
          <div className="inspector-content">
            {inspector === "impact" && (
              <>
                <div className="inspector-heading">
                  <span className="impact-icon">
                    <Crosshair size={20} />
                  </span>
                  <div>
                    <h2>Make an impact.</h2>
                    <p>Small changes. Different outcomes.</p>
                  </div>
                </div>
                {!impact ? (
                  <div className="empty-inspector">
                    <Target size={28} />
                    <p>No scheduled impacts yet.</p>
                    <button className="button button-light" onClick={addImpact}>
                      <Plus size={14} /> Add projectile
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="segmented">
                      <button
                        className={impact.type === "projectile" ? "active" : ""}
                        onClick={() => updateImpact("type", "projectile")}
                      >
                        <Circle size={12} /> Projectile
                      </button>
                      <button
                        className={impact.type === "impulse" ? "active" : ""}
                        onClick={() => updateImpact("type", "impulse")}
                      >
                        <Zap size={12} /> Impulse
                      </button>
                    </div>
                    <div className="section-label control-section-label">
                      {impact.type === "projectile"
                        ? "PROJECTILE PROPERTIES"
                        : "LOCALIZED IMPULSE"}
                      <span>SI UNITS</span>
                    </div>
                    {impact.type === "projectile" ? (
                      <>
                        <div className="two-fields">
                          <NumberField
                            label="Radius"
                            unit="m"
                            value={impact.radius}
                            onChange={(v) => updateImpact("radius", v)}
                          />
                          <NumberField
                            label="Mass"
                            unit="kg"
                            value={impact.mass}
                            onChange={(v) => updateImpact("mass", v)}
                          />
                        </div>
                        <NumberField
                          label="Launch velocity"
                          unit="m/s"
                          value={impact.speed}
                          onChange={(v) => updateImpact("speed", v)}
                        />
                        <div className="energy-readout">
                          <span>
                            <Zap size={12} /> Kinetic energy
                          </span>
                          <strong>
                            {fixed(
                              (0.5 * impact.mass * impact.speed ** 2) / 1000,
                            )}{" "}
                            <small>kJ</small>
                          </strong>
                        </div>
                      </>
                    ) : (
                      <>
                        <NumberField
                          label="Impulse magnitude"
                          unit="N·s"
                          value={impact.magnitude}
                          onChange={(v) => updateImpact("magnitude", v)}
                        />
                        <p className="helper-text">
                          Acts at the specified point within 5 cm of an actual
                          collider. No radial explosion force.
                        </p>
                      </>
                    )}
                    <div className="section-rule" />
                    <VectorFields
                      label={
                        impact.type === "projectile"
                          ? "Launch position"
                          : "Application point"
                      }
                      value={impact.position}
                      onChange={(v) => updateImpact("position", v)}
                    />
                    <VectorFields
                      label="Direction"
                      unit="normalized"
                      value={impact.direction}
                      onChange={(v) => updateImpact("direction", v)}
                    />
                    <button
                      className={`button aim-button ${tool === "aim" ? "active" : ""}`}
                      onClick={() => {
                        setTool(tool === "aim" ? "select" : "aim");
                        setMobilePanel("scene");
                      }}
                      disabled={recording}
                    >
                      <Crosshair size={14} /> Pick impact point<kbd>3D</kbd>
                    </button>
                    <div className="two-fields schedule-fields">
                      <NumberField
                        label="Launch time"
                        unit="s"
                        value={impact.time}
                        onChange={(v) => updateImpact("time", v)}
                      />
                      <div className="trajectory-toggle">
                        <span className="field-label">Preview</span>
                        <button
                          className={layers.trajectory ? "on" : ""}
                          onClick={() =>
                            setLayers((l) => ({
                              ...l,
                              trajectory: !l.trajectory,
                            }))
                          }
                        >
                          <span className="toggle-switch" />
                          Trajectory
                        </button>
                      </div>
                    </div>
                    <p className="helper-text trajectory-note">
                      Dashed path is a pre-impact estimate, not a prediction of
                      fracture.
                    </p>
                    {recording && impact.type === "impulse" && (
                      <button
                        className="button full-width"
                        onClick={() =>
                          liveControl((s) =>
                            s.applyImpulse(
                              impact.position,
                              impact.direction,
                              impact.magnitude,
                            ),
                          )
                        }
                      >
                        <Zap size={13} /> Apply at live edge
                      </button>
                    )}
                    <details className="inspector-details">
                      <summary>
                        Scheduled events <span>{project.impacts.length}</span>
                        <ChevronDown size={12} />
                      </summary>
                      <button className="button full-width" onClick={addImpact}>
                        <Plus size={13} /> Add another impact
                      </button>
                      <button
                        className="button danger full-width"
                        onClick={() =>
                          edit((p) => {
                            p.impacts = p.impacts.filter(
                              (i) => i.id !== impact.id,
                            );
                          }, "Scheduled impact removed.")
                        }
                      >
                        <Trash2 size={13} /> Remove this impact
                      </button>
                    </details>
                  </>
                )}
              </>
            )}

            {inspector === "object" && (
              <>
                {selected ? (
                  <>
                    <div className="object-inspector-title">
                      <MaterialCube material={selected.material} size={39} />
                      <div>
                        <h2>
                          {selection.length > 1
                            ? `${selection.length} objects selected`
                            : selected.name}
                        </h2>
                        <p>
                          {selected.material.toUpperCase()} /{" "}
                          {selected.shape.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <label className="text-field">
                      <span className="field-label">Object name</span>
                      <input
                        aria-label="Object name"
                        key={selected.id + selected.name}
                        defaultValue={selected.name}
                        onBlur={(e) => {
                          if (e.target.value !== selected.name)
                            updateObject("name", e.target.value);
                        }}
                      />
                    </label>
                    <div className="two-fields">
                      <label className="select-field">
                        <span className="field-label">Material</span>
                        <select
                          aria-label="Object material"
                          value={selected.material}
                          onChange={(e) =>
                            updateObject("material", e.target.value)
                          }
                        >
                          {Object.keys(MATERIALS).map((m) => (
                            <option key={m} value={m}>
                              {m[0].toUpperCase() + m.slice(1)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="select-field">
                        <span className="field-label">Geometry</span>
                        <select
                          aria-label="Geometry type"
                          value={selected.shape}
                          onChange={(e) =>
                            updateObject("shape", e.target.value)
                          }
                        >
                          {["panel", "box", "beam"].map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <VectorFields
                      label="Dimensions"
                      labels={["W", "H", "D"]}
                      value={selected.size}
                      onChange={(v) => updateObject("size", v)}
                    />
                    <VectorFields
                      label="Position"
                      value={selected.position}
                      onChange={(v) => updateObject("position", v)}
                    />
                    <VectorFields
                      label="Rotation"
                      unit="degrees"
                      value={selected.rotation.map((v) => (v * 180) / Math.PI)}
                      onChange={(v) =>
                        updateObject(
                          "rotation",
                          v.map((n) => (n * Math.PI) / 180),
                        )
                      }
                    />
                    <div className="section-rule" />
                    <div className="two-fields">
                      <NumberField
                        label="Fragments"
                        unit="pcs"
                        step="1"
                        value={selected.density}
                        onChange={(v) => updateObject("density", v)}
                      />
                      <NumberField
                        label="Fracture seed"
                        unit="#"
                        step="1"
                        value={selected.seed}
                        onChange={(v) => updateObject("seed", v)}
                      />
                    </div>
                    <p className="helper-text">
                      Seeded topology, impact-driven release. The cells fill
                      your exact solid dimensions.
                    </p>
                    <button
                      className={`support-toggle ${selected.fixed ? "on" : ""}`}
                      onClick={() => updateObject("fixed", !selected.fixed)}
                    >
                      {selected.fixed ? (
                        <LockKeyhole size={15} />
                      ) : (
                        <UnlockKeyhole size={15} />
                      )}
                      <span>
                        Fixed support<small>Clamp the lowest fragment</small>
                      </span>
                      <span className="toggle-switch" />
                    </button>
                    {recording && selected.fixed && (
                      <button
                        className="button full-width danger"
                        onClick={() =>
                          liveControl((s) => s.removeSupport(selected.id))
                        }
                      >
                        <UnlockKeyhole size={13} /> Remove support in this take
                      </button>
                    )}
                    <details className="inspector-details">
                      <summary>
                        Material simulation parameters
                        <ChevronDown size={12} />
                      </summary>
                      <p className="helper-text">
                        Shared by all {selected.material} objects. Not certified
                        material properties.
                      </p>
                      {[
                        ["density", "Mass density", "kg/m³"],
                        ["threshold", "Bond strength", "Pa"],
                        ["toughness", "Fracture work", "J/m²"],
                        ["restitution", "Restitution", "0-1"],
                        ["friction", "Friction", "0-2"],
                        ...(selected.material === "timber"
                          ? [["grainStrength", "Grain factor", "0-1"]]
                          : []),
                        ...(selected.material === "steel"
                          ? [["yieldFraction", "Yield fraction", "0-1"]]
                          : []),
                      ].map(([key, label, unit]) => (
                        <NumberField
                          key={key}
                          label={label}
                          unit={unit}
                          value={project.materials[selected.material][key]}
                          onChange={(v) =>
                            edit((p) => {
                              p.materials[selected.material][key] = v;
                            }, "Material law updated.")
                          }
                        />
                      ))}
                      <p className="helper-text">
                        {project.materials[selected.material].description}
                      </p>
                    </details>
                    <details className="inspector-details">
                      <summary>
                        Structural connections{" "}
                        <span>
                          {
                            project.connections.filter(
                              (c) => c.a === selected.id || c.b === selected.id,
                            ).length
                          }
                        </span>
                        <ChevronDown size={12} />
                      </summary>
                      {project.connections
                        .filter(
                          (c) => c.a === selected.id || c.b === selected.id,
                        )
                        .map((c) => (
                          <div key={c.id}>
                            <div className="connection-row">
                              <Link2 size={12} />
                              <span>
                                {
                                  project.objects.find(
                                    (o) =>
                                      o.id ===
                                      (c.a === selected.id ? c.b : c.a),
                                  )?.name
                                }
                              </span>
                              <IconButton
                                icon={X}
                                title="Remove structural connection"
                                onClick={() =>
                                  edit((p) => {
                                    p.connections = p.connections.filter(
                                      (i) => i.id !== c.id,
                                    );
                                  }, "Connection removed.")
                                }
                              />
                            </div>
                            <NumberField
                              label={`Connection ${c.id} strength`}
                              unit="Pa"
                              value={
                                c.threshold ??
                                runtime.current.sim?.bonds.find(
                                  (b) => b.connectionId === c.id,
                                )?.threshold ??
                                1000000
                              }
                              onChange={(value) =>
                                edit((p) => {
                                  p.connections.find(
                                    (connection) => connection.id === c.id,
                                  ).threshold = value;
                                }, "Connection strength updated.")
                              }
                            />
                            <p className="helper-text">
                              {snapshot?.bonds.find(
                                (b) => b.id === `connection:${c.id}`,
                              )?.broken
                                ? "Broken"
                                : "Connected"}{" "}
                              / damage{" "}
                              {fixed(
                                (snapshot?.bonds.find(
                                  (b) => b.id === `connection:${c.id}`,
                                )?.damage || 0) * 100,
                                1,
                              )}
                              %
                            </p>
                          </div>
                        ))}
                      <button
                        className="button full-width"
                        onClick={connectSelection}
                      >
                        <Link2 size={13} /> Connect two selected objects
                      </button>
                    </details>
                    {selectedFragment && (
                      <div className="fragment-inspection">
                        <div className="section-label">
                          ACTUAL FRAGMENT <span>LIVE STATE</span>
                        </div>
                        <code>{selectedFragment.id}</code>
                        <dl>
                          <dt>Mass</dt>
                          <dd>{fixed(fragmentGeometry?.mass, 4)} kg</dd>
                          <dt>Velocity</dt>
                          <dd>
                            {selectedFragment.velocity
                              .map((n) => fixed(n, 2))
                              .join(", ")}{" "}
                            m/s
                          </dd>
                          <dt>Angular speed</dt>
                          <dd>
                            {fixed(
                              Math.hypot(...selectedFragment.angularVelocity),
                            )}{" "}
                            rad/s
                          </dd>
                          <dt>State</dt>
                          <dd>
                            {selectedFragment.sleeping
                              ? "Sleeping / fixed"
                              : "Active"}{" "}
                            {selectedFragment.released
                              ? "· released"
                              : "· supported"}
                          </dd>
                          <dt>Incident broken bonds</dt>
                          <dd>
                            {
                              runtime.current.sim.bonds.filter(
                                (b) =>
                                  (b.a === fragmentId || b.b === fragmentId) &&
                                  snapshot.bonds.find((s) => s.id === b.id)
                                    ?.broken,
                              ).length
                            }
                          </dd>
                        </dl>
                        <button
                          className="button full-width"
                          onClick={() =>
                            liveControl((s) =>
                              s.applyImpulse(
                                selectedFragment.position,
                                [0, 1, -0.3],
                                30,
                              ),
                            )
                          }
                        >
                          <Zap size={12} /> Wake with 30 N·s impulse
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-inspector">
                    <MousePointer2 size={28} />
                    <h3>Select something solid.</h3>
                    <p>
                      Click an object in the scene or hierarchy. Shift-click to
                      select several.
                    </p>
                  </div>
                )}
              </>
            )}

            {inspector === "camera" && (
              <>
                <div className="inspector-heading camera-heading">
                  <span className="camera-icon">
                    <Camera size={20} />
                  </span>
                  <div>
                    <h2>Another perspective.</h2>
                    <p>Same destruction. A different story.</p>
                  </div>
                </div>
                <label className="select-field">
                  <span className="field-label">Camera movement</span>
                  <select
                    aria-label="Camera movement"
                    value={cameraMode}
                    onChange={(e) => setCameraMode(e.target.value)}
                  >
                    <option value="orbit">Free orbit</option>
                    <option value="tracking">Cinematic tracking</option>
                    <option value="path">Keyframed camera path</option>
                  </select>
                </label>
                <label className="select-field">
                  <span className="field-label">Tracking target</span>
                  <select
                    aria-label="Tracking target"
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                  >
                    <option value="projectile">Primary projectile</option>
                    <option value="scene">Scene center</option>
                    {project.objects.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                    {fragmentId && (
                      <option value={fragmentId}>{fragmentId}</option>
                    )}
                  </select>
                </label>
                <div className="camera-tip">
                  <Film size={16} />
                  <p>
                    Freeze the take, find an angle, save a keyframe. Camera
                    edits never change your physics.
                  </p>
                </div>
                <button
                  className="button button-light full-width"
                  onClick={addCamera}
                >
                  <Plus size={14} /> Add current camera keyframe
                </button>
                <div className="section-label control-section-label">
                  CAMERA KEYFRAMES<span>{cameras.length} POSES</span>
                </div>
                <div className="camera-list">
                  {cameras.map((c, i) => (
                    <details className="camera-key" key={c.id}>
                      <summary>
                        <span className="camera-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>
                          {c.name || "Camera pose"}
                          <small>
                            {fixed(c.time)} s / {fixed(c.fov, 0)}°
                          </small>
                        </span>
                        <ChevronDown size={13} />
                      </summary>
                      <div className="two-fields">
                        <NumberField
                          label={`Camera ${i + 1} time`}
                          unit="s"
                          value={c.time}
                          onChange={(v) => changeCamera(c.id, "time", v)}
                        />
                        <NumberField
                          label={`Camera ${i + 1} FOV`}
                          unit="deg"
                          value={c.fov}
                          onChange={(v) => changeCamera(c.id, "fov", v)}
                        />
                      </div>
                      <VectorFields
                        label={`Camera ${i + 1} position`}
                        value={c.position}
                        onChange={(v) => changeCamera(c.id, "position", v)}
                      />
                      <VectorFields
                        label={`Camera ${i + 1} target`}
                        value={c.target}
                        onChange={(v) => changeCamera(c.id, "target", v)}
                      />
                      <button
                        className="button full-width"
                        onClick={() =>
                          setCameras((cs) => cs.filter((p) => p.id !== c.id))
                        }
                      >
                        <Trash2 size={12} /> Remove keyframe
                      </button>
                    </details>
                  ))}
                </div>
                <p className="helper-text">
                  Keyframes use physical seconds. Catmull-Rom position and
                  smooth target interpolation; presentation speed is set below.
                </p>
                <button
                  className="button full-width"
                  onClick={() => {
                    setCameraMode("path");
                    seek(0);
                    runtime.current.running = true;
                    setRunning(true);
                  }}
                  disabled={!recording}
                >
                  <Play size={13} /> Preview this take
                </button>
              </>
            )}

            {inspector === "settings" && (
              <>
                <div className="inspector-heading">
                  <span className="camera-icon">
                    <Settings2 size={20} />
                  </span>
                  <div>
                    <h2>The ground rules.</h2>
                    <p>Bounded work. Repeatable results.</p>
                  </div>
                </div>
                <NumberField
                  label="Gravity"
                  value={project.settings.gravity}
                  unit="m/s²"
                  onChange={(v) =>
                    edit((p) => {
                      p.settings.gravity = v;
                    }, "Gravity updated.")
                  }
                />
                <NumberField
                  label="Solver iterations"
                  value={project.settings.solverIterations}
                  step="1"
                  unit="1-32"
                  onChange={(v) =>
                    edit((p) => {
                      p.settings.solverIterations = v;
                    }, "Solver quality updated.")
                  }
                />
                <div className="settings-facts">
                  <div>
                    <span>Fixed physics step</span>
                    <b>1 / 120 s</b>
                  </div>
                  <div>
                    <span>CCD</span>
                    <b>All dynamic bodies</b>
                  </div>
                  <div>
                    <span>Fragment limit</span>
                    <b>600 per scene</b>
                  </div>
                  <div>
                    <span>Take duration</span>
                    <b>12 physical seconds</b>
                  </div>
                  <div>
                    <span>Render cadence</span>
                    <b>Independent</b>
                  </div>
                  <div>
                    <span>Separation energy</span>
                    <b>None injected</b>
                  </div>
                </div>
                <div className="camera-tip">
                  <ShieldCheck size={18} />
                  <p>
                    This is a bonded rigid-body approximation, not an
                    engineering-grade structural solver.
                  </p>
                </div>
                <button
                  className="button full-width"
                  onClick={() => setModal("physics")}
                >
                  Material laws & limitations <ArrowUpRight size={13} />
                </button>
                <div className="section-label control-section-label">
                  THIS STATE
                </div>
                <div className="settings-facts">
                  <div>
                    <span>Active fragments</span>
                    <b>{stats?.active || 0}</b>
                  </div>
                  <div>
                    <span>Sleeping / fixed</span>
                    <b>{stats?.sleeping || 0}</b>
                  </div>
                  <div>
                    <span>Broken bonds</span>
                    <b>{stats?.broken || 0}</b>
                  </div>
                  <div>
                    <span>Yielded joints</span>
                    <b>{stats?.yielded || 0}</b>
                  </div>
                  <div>
                    <span>Contact events</span>
                    <b>{stats?.contacts || 0}</b>
                  </div>
                  <div>
                    <span>Total fragment mass</span>
                    <b>{fixed(stats?.mass)} kg</b>
                  </div>
                  <div>
                    <span>Recorded states</span>
                    <b>{runtime.current.recorder?.frames.length || 1} / 1441</b>
                  </div>
                </div>
                <div className="section-label control-section-label">
                  RECORDING RESOURCES
                </div>
                <NumberField
                  label="Take storage budget"
                  value={recordingBudget}
                  unit="MiB"
                  onChange={changeRecordingBudget}
                />
                <p className="helper-text">
                  {bytes(runtime.current.recorder?.byteSize || 0)} of complete
                  frame data. A local 0.125-127 MiB cap; change before
                  recording. The take freezes at its last valid state if full.
                </p>
                <div className="settings-facts">
                  <div>
                    <span>Peak bond damage</span>
                    <b>
                      {fixed(
                        Math.max(
                          0,
                          ...(snapshot?.bonds || []).map((b) => b.damage),
                        ) * 100,
                        1,
                      )}
                      %
                    </b>
                  </div>
                  <div>
                    <span>Contact impulse sum</span>
                    <b>{fixed(stats?.contactImpulse)} N·s</b>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="inspector-bottom">
            <button
              className="launch-button"
              onClick={launch}
              disabled={!ready || !impact || progress !== null}
            >
              <Play size={15} fill="currentColor" />
              <span>
                {recording ? "New take & launch" : "Launch simulation"}
              </span>
              <kbd>↵</kbd>
            </button>
            <span>
              <ShieldCheck size={11} /> Fixed-step physics. No canned
              destruction.
            </span>
          </div>
        </aside>

        <section className="timeline-panel" aria-label="Recorded take timeline">
          <div className="timeline-top">
            <div className="timeline-title">
              <Film size={15} />
              <h2>TAKE 01</h2>
              <span className={`take-status ${running ? "is-running" : ""}`}>
                <i />
                {status}
              </span>
            </div>
            <div className="timeline-right">
              <button
                className="timeline-camera"
                onClick={() => {
                  setInspector("camera");
                  setMode("cinematic");
                }}
              >
                <Camera size={13} />
                {cameraMode === "orbit"
                  ? "Free camera"
                  : cameraMode === "path"
                    ? "Camera path"
                    : "Tracking shot"}
                <ChevronDown size={11} />
              </button>
              <span className="vertical-divider" />
              <IconButton
                icon={Image}
                title="Export current still image"
                onClick={still}
                disabled={!ready}
              />
              <IconButton
                icon={MoreHorizontal}
                title="Take export options"
                onClick={() => setModal("export")}
              />
            </div>
          </div>
          <div className="timeline-body">
            <div className="track-labels">
              <div>
                <Activity size={12} />
                Physics<span>120 Hz</span>
              </div>
              <div>
                <Camera size={12} />
                Camera
                <button aria-label="Add camera keyframe" onClick={addCamera}>
                  <Plus size={12} />
                </button>
              </div>
            </div>
            <div className="timeline-tracks">
              <div className="timeline-ruler">
                {Array.from({ length: timelineEnd + 1 }, (_, i) => (
                  <span key={i} style={{ left: `${(i / timelineEnd) * 100}%` }}>
                    {fixed(i, 1)}
                    <small>s</small>
                  </span>
                ))}
              </div>
              <div className="physics-track">
                <div
                  className="recorded-range"
                  style={{ width: `${(duration / timelineEnd) * 100}%` }}
                >
                  {duration > 0.8 && <span>RIGID-BODY STATE HISTORY</span>}
                </div>
                {project.impacts.map((i) => (
                  <span
                    className="impact-marker"
                    title={`Scheduled ${i.type} at ${i.time}s`}
                    key={i.id}
                    style={{ left: `${(i.time / timelineEnd) * 100}%` }}
                  >
                    <Zap size={10} />
                    <span>IMPACT</span>
                  </span>
                ))}
                {eventTicks
                  .filter((t, i) => i === 0 || t - eventTicks[i - 1] > 0.03)
                  .map((t) => (
                    <i
                      className="break-tick"
                      key={t}
                      style={{ left: `${(t / timelineEnd) * 100}%` }}
                    />
                  ))}
              </div>
              <div className="camera-track">
                <div
                  className="camera-track-line"
                  style={{
                    width: `${Math.min(100, (Math.max(...cameras.map((c) => c.time), 0) / timelineEnd) * 100)}%`,
                  }}
                />
                {cameras.map((c) => (
                  <button
                    key={c.id}
                    className="camera-diamond"
                    title={`${c.name}: ${fixed(c.time)} s`}
                    style={{
                      left: `${Math.min(100, (c.time / timelineEnd) * 100)}%`,
                    }}
                    onClick={() => {
                      seek(c.time);
                      setInspector("camera");
                    }}
                  />
                ))}
              </div>
              <div
                className="playhead-line"
                style={{ left: `${(playhead / timelineEnd) * 100}%` }}
              >
                <span />
              </div>
              <input
                className="timeline-scrubber"
                aria-label="Scrub recorded time"
                type="range"
                min="0"
                max={timelineEnd}
                step={LIMITS.dt}
                value={playhead}
                onChange={(e) => seek(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="transport-row">
            <div className="transport-buttons">
              <IconButton
                icon={RotateCcw}
                title="Reset take to editable scene"
                onClick={reset}
                disabled={!ready}
              />
              <span className="vertical-divider" />
              <IconButton
                icon={SkipBack}
                title="Go to first recorded state"
                onClick={() => seek(0)}
              />
              <button
                className="transport-play"
                title={
                  running
                    ? "Pause simulation (Space)"
                    : "Play or resume (Space)"
                }
                aria-label={running ? "Pause" : "Play"}
                onClick={togglePlay}
                disabled={!ready}
              >
                {running ? (
                  <Pause size={15} fill="currentColor" />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
              </button>
              <IconButton
                icon={StepForward}
                title="Advance one fixed physics tick (.)"
                onClick={step}
              />
              <IconButton
                icon={SkipForward}
                title="Go to latest recorded state"
                onClick={() => seek(duration)}
              />
            </div>
            <div className="timecode">
              <b>{fixed(playhead, 3)}</b>
              <span>/ {fixed(duration, 3)} s</span>
            </div>
            <div className="playback-speed">
              <span>PLAYBACK</span>
              <select
                aria-label="Presentation speed"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                {[0.1, 0.25, 0.5, 1, 2].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                    {s === 0.25 ? " slow motion" : s === 1 ? " real time" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="timeline-hint">
              {recording ? (
                <>
                  <span className="hint-dot" />
                  {firstBreak != null
                    ? `First bond release at ${fixed(firstBreak, 3)} s`
                    : "All bonds intact"}
                  <span className="hint-divider">/</span>
                  {fixed(duration / speed, 2)} s presentation
                </>
              ) : (
                <>Build. Break. Find the beautiful frame.</>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="statusbar">
        <div>
          <span className="status-dot" />
          <span>{ready ? "LOCAL ENGINE READY" : "INITIALIZING WASM"}</span>
          <span className="statusbar-separator" />
          <span>Rapier · WebGL2</span>
        </div>
        <div>
          <span>{fps} FPS</span>
          <span className="statusbar-separator" />
          <span>{totalFragments} fragments</span>
          <span className="statusbar-separator" />
          <span>Y-up · m · kg · s</span>
          <span className="statusbar-separator" />
          <button onClick={() => setModal("physics")}>
            A simulation, not a certification <ArrowUpRight size={10} />
          </button>
        </div>
      </footer>
      <input
        ref={fileRef}
        className="hidden-input"
        type="file"
        accept=".json,.fracture,.take"
        onChange={importFile}
        aria-label="Import project or take"
      />

      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={17} /> : <Check size={17} />}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <span className="modal-emblem">
              <RotateCcw size={24} />
            </span>
            <span className="eyebrow">AUTHORING TRANSACTION</span>
            <h2 id="confirm-title">A new state. A new take.</h2>
            <p>
              Changing geometry, materials, supports, or impacts invalidates the
              existing physics recording. Your camera keyframes will stay.
            </p>
            <div className="notice-box">
              {runtime.current.recorder?.frames.length} recorded states will be
              replaced. Export the take first if you want to keep it.
            </div>
            <div className="modal-actions">
              <button className="button" onClick={() => setConfirm(null)}>
                Keep current take
              </button>
              <button className="button" onClick={saveTake}>
                <Download size={13} /> Save take
              </button>
              <button
                className="button button-light"
                onClick={() =>
                  applyProject(
                    confirm.next,
                    confirm.label,
                    confirm.kind,
                    confirm.imported,
                  )
                }
              >
                Apply & reset take
                <ArrowRight size={13} />
              </button>
            </div>
          </section>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && progress === null)
              setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "export" ? "export-modal" : "guide-modal"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <IconButton
              icon={X}
              title="Close dialog"
              className="modal-close"
              onClick={() => {
                if (progress !== null) abortRef.current?.abort();
                setModal(null);
              }}
            />
            {modal === "export" ? (
              <>
                <span className="eyebrow">FROM THE LAB, TO THE SCREEN</span>
                <h2 id="modal-title">Give the moment a frame.</h2>
                <p>
                  Export the exact recorded take. No new random event. No live
                  screen capture.
                </p>
                <div className="export-preview">
                  {video ? (
                    <video
                      src={video.url}
                      controls
                      aria-label="Exported take video"
                    />
                  ) : (
                    <>
                      <Clapperboard size={38} />
                      <span>
                        {recording
                          ? `${fixed(duration / speed, 2)} seconds of controlled chaos`
                          : "Record a take to render your film"}
                      </span>
                      <small>1280 × 720 / 30 FPS / VP9 WEBM</small>
                    </>
                  )}
                </div>
                <div className="export-settings">
                  <label className="select-field">
                    <span className="field-label">Output camera</span>
                    <select
                      aria-label="Export camera"
                      disabled={progress !== null}
                      value={cameraMode}
                      onChange={(e) => setCameraMode(e.target.value)}
                    >
                      <option value="orbit">Current framing</option>
                      <option value="tracking">Tracking shot</option>
                      <option value="path">Keyframed path</option>
                    </select>
                  </label>
                  <label className="select-field">
                    <span className="field-label">Presentation speed</span>
                    <select
                      aria-label="Export presentation speed"
                      disabled={progress !== null}
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      {[0.1, 0.25, 0.5, 1, 2].map((s) => (
                        <option key={s} value={s}>
                          {s}× / {fixed(duration / s, 2)} s
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {progress !== null ? (
                  <div className="export-progress">
                    <div>
                      <span>Rendering deterministic frames</span>
                      <b>{Math.round(progress * 100)}%</b>
                    </div>
                    <div className="budget-bar">
                      <span style={{ width: `${progress * 100}%` }} />
                    </div>
                    <button
                      className="text-button"
                      onClick={() => abortRef.current?.abort()}
                    >
                      Cancel export
                    </button>
                  </div>
                ) : (
                  <button
                    className="button button-light full-width render-button"
                    disabled={!recording}
                    onClick={renderVideo}
                  >
                    <Video size={16} />
                    {video ? "Render again" : "Render cinematic video"}
                    <ArrowUpRight size={14} />
                  </button>
                )}
                {video && (
                  <button
                    className="button full-width"
                    onClick={() =>
                      download(video.blob, "fracture-cinematic.webm")
                    }
                  >
                    <Download size={14} />
                    Download WebM{" "}
                    <span>
                      {bytes(video.blob.size)} /{" "}
                      {fixed(video.metadata.duration, 2)} s
                    </span>
                  </button>
                )}
                <div className="export-secondary">
                  <button onClick={still} disabled={progress !== null}>
                    <Image size={20} />
                    <b>Still frame</b>
                    <span>Clean PNG image</span>
                  </button>
                  <button
                    onClick={saveTake}
                    disabled={!recording || progress !== null}
                  >
                    <Film size={20} />
                    <b>Recorded take</b>
                    <span>States + cameras · JSON</span>
                  </button>
                  <button onClick={saveProject} disabled={progress !== null}>
                    <Box size={20} />
                    <b>Editable project</b>
                    <span>Scene + mechanics · JSON</span>
                  </button>
                </div>
                <p className="helper-text">
                  Video requires current Chrome or Edge on localhost. Every
                  output frame has an explicit presentation timestamp; physical
                  time = presentation time × speed.
                </p>
              </>
            ) : modal === "physics" ? (
              <>
                <span className="eyebrow">HONEST BY DESIGN</span>
                <h2 id="modal-title">The physics of this place.</h2>
                <p>
                  Real colliding solids. A deliberately simplified fracture
                  model.
                </p>
                <div className="laws-grid">
                  {Object.entries(MATERIALS).map(([key, m]) => (
                    <div key={key}>
                      <MaterialCube material={key} />
                      <h3>{key[0].toUpperCase() + key.slice(1)}</h3>
                      <p>{m.description}</p>
                    </div>
                  ))}
                </div>
                <div className="guide-copy">
                  <h3>Topology is prepared. Damage is not.</h3>
                  <p>
                    Seeded Voronoi prisms partition glass and concrete;
                    directional cells partition timber and steel. Their union
                    fills the input solid without duplicated mass. Unbroken
                    bonds form compound rigid bodies. Contact impulse and local
                    work release bonds; no artificial explosion velocity is
                    added.
                  </p>
                  <h3>Supports and steel are approximations.</h3>
                  <p>
                    Gravity uses a capacity-weighted load-path estimate. Fixed
                    attachments absorb remaining support reactions. Supported
                    glass/concrete use a one-tick convex sweep to fund local
                    release before contact; Rapier then transfers momentum.
                    Steel joints accumulate a yield state then fail, but the
                    geometry does not bend. This is not FEM, continuous crack
                    growth, or a certified material prediction.
                  </p>
                  <h3>Fixed physics. Independent cinematography.</h3>
                  <p>
                    120 Hz physics; CCD on dynamic bodies; 600 fragments; 12
                    seconds per take; 1,441 stored states. Interpolation uses
                    linear positions and quaternion rotations, with
                    preceding-tick bond states. Camera edits and presentation
                    speed never change recorded physics.
                  </p>
                  <h3>Supported inputs</h3>
                  <p>
                    Object dimensions 0.005-30 m; projectile radius 0.05-0.5 m;
                    mass 0.01-1,000 kg; launch velocity 0-100 m/s; gravity 0-30
                    m/s². Extreme aspect ratios may be rejected by the convex
                    hull builder. Read <code>src/core/PHYSICS.md</code> for the
                    exact formulas, tests, and limitations.
                  </p>
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">WELCOME TO THE LABORATORY</span>
                <h2 id="modal-title">
                  Make something.
                  <br />
                  Then make a moment.
                </h2>
                <p>
                  A local workbench for cinematic, physically interacting
                  destruction.
                </p>
                <div className="guide-steps">
                  {[
                    [
                      "01",
                      Box,
                      "Build a possibility.",
                      "Choose a material, set its exact dimensions, and connect members. Shift-click for multiple selection.",
                    ],
                    [
                      "02",
                      Crosshair,
                      "Find the breaking point.",
                      "Place a projectile and pick a point on the actual scene. Change the velocity and compare a new take.",
                    ],
                    [
                      "03",
                      Pause,
                      "Stop time. Stay curious.",
                      "Pause with Space. Orbit real fragments. Scrub backward to recover the intact state, not a reversed simulation.",
                    ],
                    [
                      "04",
                      Camera,
                      "Tell it from another angle.",
                      "Save camera keyframes, choose a tracking target, and replay at 0.25×. Export a timestamped WebM.",
                    ],
                  ].map(([n, Icon, title, copy]) => (
                    <div key={n}>
                      <span>{n}</span>
                      <Icon size={21} />
                      <section>
                        <h3>{title}</h3>
                        <p>{copy}</p>
                      </section>
                    </div>
                  ))}
                </div>
                <div className="shortcut-row">
                  <span>
                    <kbd>SPACE</kbd> Play / pause
                  </span>
                  <span>
                    <kbd>G R S</kbd> Transform
                  </span>
                  <span>
                    <kbd>F</kbd> Frame
                  </span>
                  <span>
                    <kbd>.</kbd> Step
                  </span>
                  <span>
                    <kbd>CTRL Z</kbd> Undo
                  </span>
                </div>
                <div className="modal-actions">
                  <button
                    className="button"
                    onClick={() => fileRef.current.click()}
                  >
                    <FolderOpen size={14} /> Open a project
                  </button>
                  <button
                    className="button button-light"
                    onClick={() => setModal(null)}
                  >
                    Enter the laboratory
                    <ArrowRight size={14} />
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
