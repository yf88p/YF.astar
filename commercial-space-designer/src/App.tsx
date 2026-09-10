import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Armchair,
  Box,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Columns2,
  Copy,
  DoorOpen,
  Focus,
  Footprints,
  Grid2X2,
  Hand,
  Layers,
  Leaf,
  Lightbulb,
  Link2,
  Maximize2,
  MousePointer2,
  PencilRuler,
  Plus,
  Redo2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import Plan, { ItemGlyph, type Tool } from "./Plan";
import Scene3D, { type SceneAPI } from "./Scene3D";
import { CATALOG, MATERIALS } from "./catalog";
import { createExample, createStressDesign } from "./examples";
import {
  checked,
  clone,
  collisionWarnings,
  deleteEntities,
  detectRooms,
  duplicateEntities,
  exportCSV,
  exportProject,
  exportSVG,
  furnitureSize,
  historyCommit,
  historyRedo,
  historyUndo,
  importProject,
  quantities,
  uid,
  updateWallLength,
  validateProject,
  wallLength,
  wallPoints,
  type Design,
  type History,
  type Project,
} from "./model";

const currency = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
const exactMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
function NumberField({
  label,
  value,
  onChange,
  unit = "m",
  min,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(4))));
  useEffect(() => setDraft(String(Number(value.toFixed(4)))), [value]);
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          aria-label={label}
          value={draft}
          min={min}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (
              draft.trim() &&
              Number.isFinite(Number(draft)) &&
              Number(draft) !== value
            )
              onChange(Number(draft));
            setDraft(String(Number(value.toFixed(4))));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
function Range({
  label,
  value,
  onChange,
  onPreview,
  min = 0,
  max = 3,
  step = 0.05,
  unit = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onPreview?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const val = useRef(value);
  return (
    <label className="range-field">
      <span>
        {label}
        <b>
          {unit === "%"
            ? Math.round(value * 100) + "%"
            : Number(value.toFixed(2)) + unit}
        </b>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          val.current = Number(e.target.value);
          (onPreview || onChange)(val.current);
        }}
        onPointerUp={() => onChange(val.current)}
        onKeyUp={() => onChange(val.current)}
      />
    </label>
  );
}
function load() {
  try {
    const saved = localStorage.getItem("forma-project");
    if (saved) return importProject(saved);
  } catch {
    /* A bad saved project never replaces a valid starter. */
  }
  return createExample("cafe");
}

export default function App() {
  const [history, setHistory] = useState<History>(() => ({
      past: [],
      present: load(),
      future: [],
    })),
    [preview, setPreview] = useState<Design | null>(null);
  const project = history.present,
    design =
      preview || project.designs.find((d) => d.id === project.activeDesignId)!;
  const [selected, setSelected] = useState<string[]>([]),
    [tool, setTool] = useState<Tool>("select"),
    [placeId, setPlaceId] = useState("bistro"),
    [library, setLibrary] = useState<"objects" | "finishes" | "lighting">(
      "objects",
    ),
    [category, setCategory] = useState("All"),
    [search, setSearch] = useState(""),
    [view, setView] = useState<"plan" | "split" | "3d">("split"),
    [walk, setWalk] = useState<"orbit" | "walk">("orbit"),
    [presentation, setPresentation] = useState(false),
    [modal, setModal] = useState<
      "projects" | "compare" | "schedule" | "help" | null
    >(null),
    [exportMenu, setExportMenu] = useState(false),
    [fitKey, setFitKey] = useState(0),
    [notice, setNotice] = useState(""),
    [hint, setHint] = useState(() => !localStorage.getItem("forma-onboarded")),
    [mobileLibrary, setMobileLibrary] = useState(false),
    [saved, setSaved] = useState(true);
  const scene = useRef<SceneAPI | null>(null),
    importInput = useRef<HTMLInputElement>(null),
    stateRef = useRef({ history, design, selected, walk });
  stateRef.current = { history, design, selected, walk };
  const q = quantities(design),
    warnings = collisionWarnings(design),
    conflicts = warnings.filter((w) => w.kind !== "contact"),
    rooms = detectRooms(design);
  const selectedWall = design.walls.find((w) => w.id === selected[0]),
    selectedFurniture = design.furniture.find((f) => f.id === selected[0]),
    selectedOpening = design.openings.find((o) => o.id === selected[0]),
    selectedLight = design.lights.find((l) => l.id === selected[0]),
    selectedRoom = rooms.find((r) => r.id === selected[0]);
  function notify(s: string) {
    setNotice(s);
  }
  function commitProject(p: Project) {
    try {
      validateProject(p);
      setHistory((h) => historyCommit(h, p));
      setPreview(null);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function change(d: Design, commit = true) {
    try {
      checked(d);
      if (commit) {
        const p = clone(stateRef.current.history.present);
        p.designs[p.designs.findIndex((x) => x.id === d.id)] = d;
        commitProject(p);
      } else setPreview(d);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function edit(fn: (d: Design) => void, commit = true) {
    const d = clone(stateRef.current.design);
    fn(d);
    change(d, commit);
  }
  function select(id: string, add = false) {
    setSelected((s) =>
      id
        ? add
          ? s.includes(id)
            ? s.filter((x) => x !== id)
            : [...s, id]
          : [id]
        : [],
    );
  }
  function undo() {
    setPreview(null);
    setHistory(historyUndo);
    setSelected([]);
  }
  function redo() {
    setPreview(null);
    setHistory(historyRedo);
    setSelected([]);
  }
  function remove() {
    const { design, selected } = stateRef.current;
    const attached = design.openings.filter((o) =>
      design.walls.some((w) => selected.includes(w.id) && w.id === o.wallId),
    );
    if (
      attached.length &&
      !window.confirm(
        `Delete ${selected.length} selected object(s) and ${attached.length} attached door/window(s)? Undo restores every relationship.`,
      )
    )
      return;
    change(deleteEntities(design, selected));
    setSelected([]);
  }
  function duplicate() {
    try {
      const { design, selected } = stateRef.current;
      const next = duplicateEntities(design, selected),
        old = new Set(
          [
            ...design.furniture,
            ...design.walls,
            ...design.lights,
            ...design.openings,
          ].map((f) => f.id),
        );
      change(next);
      setSelected(
        [
          ...next.furniture,
          ...next.walls,
          ...next.lights,
          ...next.openings.filter((o) =>
            design.walls.some((w) => w.id === o.wallId),
          ),
        ]
          .filter((f) => !old.has(f.id))
          .map((f) => f.id),
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function alternative() {
    if (project.designs.length >= 12) {
      notify("Maximum 12 alternatives per project.");
      return;
    }
    const p = clone(project),
      d = clone(design);
    d.id = uid("design");
    d.name = `${design.name} / ${project.designs.length + 1}`;
    p.designs.push(d);
    p.activeDesignId = d.id;
    commitProject(p);
    setSelected([]);
    notify("Independent alternative created. Your original is unchanged.");
  }
  function switchDesign(id: string) {
    setPreview(null);
    setSelected([]);
    setHistory((h) => ({
      ...h,
      present: { ...h.present, activeDesignId: id },
    }));
    setWalk("orbit");
  }
  function download(name: string, body: string, type: string) {
    const url = URL.createObjectURL(new Blob([body], { type })),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMenu(false);
    notify(`${name} exported`);
  }
  function capture() {
    if (!scene.current) {
      notify("Open the 3D view to capture your space.");
      return;
    }
    const a = document.createElement("a");
    a.download = `${project.name}-view.png`;
    a.href = scene.current.capture();
    a.click();
    setExportMenu(false);
    notify("Current 3D scene captured as PNG.");
  }
  function newProject(kind: "cafe" | "boutique" | "exhibition" | "blank") {
    commitProject(createExample(kind));
    setSelected([]);
    setModal(null);
    setWalk("orbit");
    setView("split");
    setTool(kind === "blank" ? "wall" : "select");
    setFitKey((k) => k + 1);
  }
  function finish(which: "floor" | "wall", id: string) {
    const m = MATERIALS.find((m) => m.id === id)!;
    edit((d) => {
      if (which === "floor") {
        d.floorMaterial = id;
        d.rates.floor = m.price;
      } else {
        d.wallMaterial = id;
        d.walls.forEach((w) => (w.material = id));
        d.rates.wall = m.price;
      }
    });
  }
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      try {
        localStorage.setItem("forma-project", exportProject(project));
        setSaved(true);
      } catch {
        notify(
          "Local storage is full. Export your project JSON to keep a copy.",
        );
      }
    }, 350);
    return () => clearTimeout(t);
  }, [project]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      const cmd = e.ctrlKey || e.metaKey;
      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (cmd && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (cmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const p = stateRef.current.history.present;
        download(`${p.name}.forma.json`, exportProject(p), "application/json");
        return;
      }
      if (cmd && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
        return;
      }
      if (e.key === "Escape") {
        setTool("select");
        setSelected([]);
        setPresentation(false);
        setExportMenu(false);
        setModal(null);
        return;
      }
      if (stateRef.current.walk === "walk") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      }
      if (e.key.toLowerCase() === "v") setTool("select");
      if (e.key.toLowerCase() === "w") setTool("wall");
      if (e.key.toLowerCase() === "h") setTool("pan");
      if (e.key.toLowerCase() === "f") {
        setFitKey((k) => k + 1);
        scene.current?.reset();
      }
      if (e.key.toLowerCase() === "r")
        edit((d) =>
          d.furniture
            .filter((f) => stateRef.current.selected.includes(f.id))
            .forEach((f) => (f.rotation = (f.rotation + 15) % 360)),
        );
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Read-only diagnostics plus fixture loading allow reproducible local browser checks.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__forma = {
      project: () => clone(stateRef.current.history.present),
      scene: () => scene.current,
      load: (p: unknown) => commitProject(validateProject(p)),
      stress: () => {
        const d = createStressDesign();
        commitProject({
          version: 1,
          name: "Performance study",
          activeDesignId: d.id,
          designs: [d],
        });
        setView("3d");
        setTimeout(() => scene.current?.reset(), 100);
      },
    };
  }, []);
  const tools: { id: Tool; icon: ReactNode; label: string; key?: string }[] = [
    {
      id: "select",
      icon: <MousePointer2 size={18} />,
      label: "Select",
      key: "V",
    },
    {
      id: "wall",
      icon: <PencilRuler size={18} />,
      label: "Draw wall",
      key: "W",
    },
    { id: "door", icon: <DoorOpen size={18} />, label: "Door" },
    { id: "window", icon: <Columns2 size={18} />, label: "Window" },
    { id: "light", icon: <Lightbulb size={18} />, label: "Light" },
    { id: "pan", icon: <Hand size={18} />, label: "Pan", key: "H" },
  ];
  const sceneSettings = (
    <>
      <div className="section-label">
        ATMOSPHERE <Sun size={14} />
      </div>
      <Range
        label="Daylight"
        value={design.lighting.daylight}
        unit="%"
        onPreview={(v) => edit((d) => (d.lighting.daylight = v), false)}
        onChange={(v) => edit((d) => (d.lighting.daylight = v))}
      />
      <Range
        label="Interior lights"
        value={design.lighting.interior}
        unit="%"
        onPreview={(v) => edit((d) => (d.lighting.interior = v), false)}
        onChange={(v) => edit((d) => (d.lighting.interior = v))}
      />
      <Range
        label="Exposure"
        min={0.1}
        value={design.lighting.exposure}
        onPreview={(v) => edit((d) => (d.lighting.exposure = v), false)}
        onChange={(v) => edit((d) => (d.lighting.exposure = v))}
      />
      <p className="microcopy">
        Warm, physically based materials. ACES tone mapping and real-time
        shadows.
      </p>
    </>
  );
  const finishPicker = (which: "floor" | "wall", compact = false) => (
    <div className={`finish-picker ${compact ? "compact" : ""}`}>
      <div className="field-heading">
        <span>{which === "floor" ? "Floor finish" : "Wall finish"}</span>
        <small>
          {
            MATERIALS.find(
              (m) =>
                m.id ===
                (which === "floor"
                  ? design.floorMaterial
                  : design.wallMaterial),
            )?.name
          }
        </small>
      </div>
      <div className="swatches">
        {MATERIALS.slice(0, compact ? 6 : 8).map((m) => (
          <button
            key={m.id}
            aria-label={`${which}: ${m.name}`}
            title={`${m.name} / ${exactMoney(m.price)} per m²`}
            className={`swatch ${m.pattern} ${(which === "floor" ? design.floorMaterial : design.wallMaterial) === m.id ? "chosen" : ""}`}
            style={{ backgroundColor: m.color }}
            onClick={() => finish(which, m.id)}
          >
            {(which === "floor"
              ? design.floorMaterial
              : design.wallMaterial) === m.id && <Check size={13} />}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div
      className={`app ${presentation ? "is-presenting" : ""} ${mobileLibrary ? "library-open" : ""} ${selected.length ? "has-selection" : ""}`}
    >
      <input
        ref={importInput}
        type="file"
        accept=".json"
        hidden
        aria-label="Import project JSON"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            try {
              const p = importProject(await f.text());
              commitProject(p);
              setSelected([]);
              setWalk("orbit");
              setFitKey((k) => k + 1);
              notify("Project validated and restored.");
            } catch (err) {
              notify(`Import rejected: ${(err as Error).message}`);
            }
            e.target.value = "";
          }
        }}
      />
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="Forma home"
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
          </span>
          forma<span className="brand-dot">.</span>
        </a>
        <div className="project-breadcrumb">
          <button onClick={() => setModal("projects")}>Workspace</button>
          <ChevronRight size={13} />
          <button className="project-name" onClick={() => setModal("projects")}>
            {project.name}
            <ChevronDown size={13} />
          </button>
          <span className="saved-state">
            <span />
            {saved ? "Saved locally" : "Saving"}
          </span>
        </div>
        <div className="top-actions">
          <button
            className="icon-button help-top"
            title="Guide & shortcuts"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={18} />
          </button>
          <button
            className="export-button"
            onClick={() => setExportMenu(!exportMenu)}
          >
            <ArrowDownToLine size={15} />
            <span>Export</span>
            <ChevronDown size={13} />
          </button>
          <button
            className="primary present-button"
            onClick={() => {
              setPresentation(true);
              setView("3d");
              setWalk("orbit");
            }}
          >
            <Maximize2 size={15} />
            <span>Present</span>
          </button>
          <div className="avatar">JD</div>
        </div>
        {exportMenu && (
          <div className="export-menu">
            <span className="section-label">TAKE YOUR DESIGN WITH YOU</span>
            <button
              onClick={() =>
                download(
                  `${project.name}.svg`,
                  exportSVG(design),
                  "image/svg+xml",
                )
              }
            >
              <PencilRuler size={16} />
              <span>
                Measured floor plan
                <small>SVG / full-precision dimensions</small>
              </span>
            </button>
            <button
              onClick={() =>
                download(
                  `${project.name}-schedule.csv`,
                  exportCSV(design),
                  "text/csv",
                )
              }
            >
              <Grid2X2 size={16} />
              <span>
                Schedule & budget<small>CSV / quantities and USD costs</small>
              </span>
            </button>
            <button onClick={capture}>
              <Camera size={16} />
              <span>
                Current-scene image<small>PNG / actual 3D viewport</small>
              </span>
            </button>
            <button
              onClick={() =>
                download(
                  `${project.name}.forma.json`,
                  exportProject(project),
                  "application/json",
                )
              }
            >
              <Layers size={16} />
              <span>
                Editable project<small>JSON / all alternatives and views</small>
              </span>
            </button>
            <button
              onClick={() => {
                importInput.current?.click();
                setExportMenu(false);
              }}
            >
              <Upload size={16} />
              <span>Import project</span>
            </button>
          </div>
        )}
      </header>
      <div className="projectbar">
        <div className="project-context">
          <span className="project-type">
            <Leaf size={14} /> COMMERCIAL SPACES
          </span>
          <button
            title="Open examples or create blank project"
            onClick={() => setModal("projects")}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="alternatives">
          <Layers size={15} />
          {project.designs.map((d, i) => (
            <button
              key={d.id}
              className={d.id === design.id ? "active" : ""}
              onClick={() => switchDesign(d.id)}
            >
              <span className="alt-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              {d.name}
            </button>
          ))}
          <button
            className="add-alt"
            title="Duplicate into independent alternative"
            onClick={alternative}
          >
            <Plus size={15} />
          </button>
        </div>
        <button className="compare-button" onClick={() => setModal("compare")}>
          <Columns2 size={15} /> Compare
        </button>
      </div>
      <main className="studio">
        <aside className="library">
          <div className="library-tabs">
            <button
              className={library === "objects" ? "active" : ""}
              onClick={() => setLibrary("objects")}
              title="Furniture catalog"
            >
              <Armchair size={19} />
              <span>Objects</span>
            </button>
            <button
              className={library === "finishes" ? "active" : ""}
              onClick={() => setLibrary("finishes")}
            >
              <Layers size={18} />
              <span>Finishes</span>
            </button>
            <button
              className={library === "lighting" ? "active" : ""}
              onClick={() => setLibrary("lighting")}
            >
              <Sun size={18} />
              <span>Lighting</span>
            </button>
          </div>
          <div className="library-content">
            {library === "objects" ? (
              <>
                <div className="library-title">
                  <div>
                    <span className="eyebrow">THE CONSIDERED COLLECTION</span>
                    <h2>Make it your space.</h2>
                  </div>
                  <span className="count-badge">{CATALOG.length}</span>
                </div>
                <label className="search">
                  <Search size={15} />
                  <input
                    aria-label="Search furniture"
                    placeholder="Find something beautiful..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <span>/</span>
                </label>
                <div className="categories">
                  {[
                    "All",
                    "Seating",
                    "Tables",
                    "Counters",
                    "Displays",
                    "Partitions",
                    "Decor",
                  ].map((c) => (
                    <button
                      className={category === c ? "active" : ""}
                      key={c}
                      onClick={() => setCategory(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="catalog-grid">
                  {CATALOG.filter(
                    (c) =>
                      (category === "All" || category === c.category) &&
                      c.name.toLowerCase().includes(search.toLowerCase()),
                  ).map((c) => (
                    <button
                      className={`catalog-card ${tool === "furniture" && placeId === c.id ? "placing" : ""}`}
                      key={c.id}
                      title={`${c.description}. ${c.width} × ${c.depth} × ${c.height} m. Click then place in plan.`}
                      onClick={() => {
                        setPlaceId(c.id);
                        setTool("furniture");
                        if (view === "3d") setView("split");
                        setMobileLibrary(false);
                      }}
                    >
                      <div className="catalog-image">
                        <ItemGlyph id={c.id} color={c.color} />
                        <span className="add-object">
                          <Plus size={13} />
                        </span>
                      </div>
                      <span className="catalog-name">{c.name}</span>
                      <span className="catalog-meta">
                        {c.category}
                        <b>{currency(c.price)}</b>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="catalog-note">
                  <MousePointer2 size={12} /> Pick an object, then click in your
                  plan.
                </p>
              </>
            ) : library === "finishes" ? (
              <>
                <span className="eyebrow">A MATERIAL POINT OF VIEW</span>
                <h2>Set the feeling.</h2>
                <p className="muted">
                  Thoughtful surfaces, from the ground up.
                </p>
                {finishPicker("floor")}
                {finishPicker("wall")}
                <div className="material-tiles">
                  {MATERIALS.map((m) => (
                    <button key={m.id} onClick={() => finish("floor", m.id)}>
                      <span
                        className={`material-preview ${m.pattern}`}
                        style={{ backgroundColor: m.color }}
                      />
                      <b>{m.name}</b>
                      <small>{currency(m.price)} / m²</small>
                    </button>
                  ))}
                </div>
                <p className="microcopy">
                  Choosing a finish also applies its sample unit rate. Customize
                  rates in the budget.
                </p>
              </>
            ) : (
              <>
                <span className="eyebrow">LIGHT SHAPES EVERYTHING</span>
                <h2>Find your atmosphere.</h2>
                {sceneSettings}
                <button
                  className="outline-button full"
                  onClick={() => {
                    setTool("light");
                    if (view === "3d") setView("split");
                  }}
                >
                  <Plus size={15} /> Place pendant light
                </button>
                <div className="lighting-note">
                  <Sun size={38} strokeWidth={1} />
                  <h3>Good light. Great spaces.</h3>
                  <p>
                    Balance natural daylight with a warm interior glow. Select a
                    pendant to set its height, color, and output.
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="library-footer">
            <span className="local-dot" />
            <span>Curated essentials. Endless possibilities.</span>
            <ArrowUpRight size={13} />
          </div>
        </aside>
        <section className="workarea">
          <div className="workspace-toolbar">
            <div className="tools">
              <button
                className="mobile-library-button"
                onClick={() => setMobileLibrary(!mobileLibrary)}
                title="Object library"
              >
                <Armchair size={18} />
              </button>
              {tools.map((t) => (
                <button
                  key={t.id}
                  title={`${t.label}${t.key ? ` (${t.key})` : ""}`}
                  aria-label={t.label}
                  className={tool === t.id ? "active" : ""}
                  onClick={() => {
                    setTool(t.id);
                    if (view === "3d" && t.id !== "select") setView("split");
                  }}
                >
                  {t.icon}
                  {t.id === "wall" && <span>Draw wall</span>}
                </button>
              ))}
              <span className="toolbar-divider" />
              <button
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                disabled={!history.past.length}
                onClick={undo}
              >
                <Undo2 size={17} />
              </button>
              <button
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
                disabled={!history.future.length}
                onClick={redo}
              >
                <Redo2 size={17} />
              </button>
            </div>
            <div className="view-toggle">
              {[
                { id: "plan", icon: <Square size={14} />, label: "2D" },
                { id: "split", icon: <Columns2 size={14} />, label: "Split" },
                { id: "3d", icon: <Box size={14} />, label: "3D" },
              ].map((v) => (
                <button
                  key={v.id}
                  className={view === v.id ? "active" : ""}
                  onClick={() => setView(v.id as typeof view)}
                >
                  {v.icon}
                  <span>{v.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={`viewports view-${view}`}>
            {view !== "3d" && (
              <div className="plan-panel">
                <div className="viewport-label">
                  <span>
                    <i>01</i> Floor plan
                  </span>
                  <span className="viewport-detail">
                    METERS <ChevronDown size={10} />
                  </span>
                </div>
                <Plan
                  design={design}
                  selectedIds={selected}
                  onSelect={select}
                  onChange={change}
                  onError={notify}
                  tool={tool}
                  setTool={setTool}
                  placeId={placeId}
                  warnings={warnings}
                  fitKey={fitKey}
                />
                {tool !== "select" && tool !== "pan" && (
                  <div className="tool-instruction">
                    {tool === "wall"
                      ? "Click endpoints to draw. Escape to finish."
                      : tool === "furniture"
                        ? `Click to place ${CATALOG.find((c) => c.id === placeId)?.name}`
                        : tool === "light"
                          ? "Click to place a warm pendant light."
                          : `Click a wall to add a ${tool}.`}
                    <button onClick={() => setTool("select")}>
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {view === "split" && (
              <div
                className="link-indicator"
                title="One document. Both views update together."
              >
                <Link2 size={13} />
              </div>
            )}
            {view !== "plan" && (
              <div className="scene-panel">
                <div className="viewport-label">
                  <span>
                    <i>02</i>{" "}
                    {walk === "walk" ? "Human perspective" : "Spatial view"}
                  </span>
                  <span className="live-tag">
                    <span /> LIVE
                  </span>
                </div>
                <Scene3D
                  design={design}
                  selectedIds={selected}
                  onSelect={select}
                  mode={walk}
                  onModeChange={setWalk}
                  apiRef={scene}
                  presentation={presentation}
                />
                <div className="scene-top-actions">
                  <button
                    title="Reset camera (F)"
                    onClick={() => scene.current?.reset()}
                  >
                    <Focus size={17} />
                  </button>
                  <button
                    title="Save current camera view"
                    onClick={() => {
                      const v = scene.current?.getView();
                      if (v)
                        edit((d) =>
                          d.savedViews.push({
                            ...v,
                            id: uid("view"),
                            name: `View ${d.savedViews.length + 1}`,
                          }),
                        );
                      notify("Camera view saved to this alternative.");
                    }}
                  >
                    <Camera size={17} />
                  </button>
                </div>
                <div className="scene-bottom">
                  <div className="scene-mode">
                    <button
                      className={walk === "orbit" ? "active" : ""}
                      onClick={() => setWalk("orbit")}
                    >
                      <Box size={14} /> Orbit
                    </button>
                    <button
                      className={walk === "walk" ? "active" : ""}
                      onClick={() => {
                        setWalk("walk");
                        setHint(false);
                      }}
                    >
                      <Footprints size={14} /> Walkthrough
                    </button>
                  </div>
                  <span className="scene-caption">
                    {walk === "orbit"
                      ? "Drag to orbit · Scroll to explore"
                      : "1.65 m eye height"}
                  </span>
                </div>
                {walk === "walk" && (
                  <div className="walk-guide">
                    <Footprints size={16} />
                    <span>
                      <b>Step inside.</b> Click view for mouse look. WASD to
                      move. Esc releases mouse.
                    </span>
                    <button
                      onClick={() => scene.current?.recover()}
                      title="Recover to safe position"
                    >
                      <Focus size={15} />
                    </button>
                    <button
                      onClick={() => setWalk("orbit")}
                      title="Leave walkthrough"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                {presentation && (
                  <div className="presentation-title">
                    <span>FORMA / SPACES WITH INTENTION</span>
                    <h1>{project.name}</h1>
                    <p>
                      {design.name} · {q.floorArea.toFixed(2)} m²
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          {hint && tool === "select" && !presentation && (
            <div className="onboarding">
              <div className="onboard-icon">
                <Sparkles size={21} />
              </div>
              <div>
                <b>A little imagination. A space of your own.</b>
                <p>
                  Start with this café, or bring a new idea to life. Every view
                  stays in sync.
                </p>
              </div>
              <button className="onboard-link" onClick={() => setModal("help")}>
                Take a look <ArrowRight size={14} />
              </button>
              <button
                className="dismiss"
                title="Dismiss welcome"
                onClick={() => {
                  setHint(false);
                  localStorage.setItem("forma-onboarded", "1");
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="budget-bar">
            <button
              className="budget-summary"
              onClick={() => setModal("schedule")}
            >
              <span className="budget-icon">
                <Grid2X2 size={18} />
              </span>
              <span>
                <small>ESTIMATED PROJECT BUDGET</small>
                <b data-testid="budget-total">
                  {exactMoney(q.total)}
                  <em>USD</em>
                </b>
              </span>
            </button>
            <div className="budget-category">
              <span>Furniture</span>
              <b>{currency(q.furniture)}</b>
              <i style={{ background: "#7c8b6b" }} />
            </div>
            <div className="budget-category">
              <span>Finishes</span>
              <b>{currency(q.floor + q.wall)}</b>
              <i style={{ background: "#bea98b" }} />
            </div>
            <div className="budget-category">
              <span>Openings</span>
              <b>{currency(q.openings)}</b>
              <i style={{ background: "#c9cdc0" }} />
            </div>
            <button
              className="schedule-link"
              onClick={() => setModal("schedule")}
            >
              View schedule <ArrowUpRight size={15} />
            </button>
          </div>
        </section>
        <aside className="inspector">
          <div className="inspector-header">
            <span>{selected.length ? "Selection" : "Space settings"}</span>
            <button
              title="Close inspector selection"
              onClick={() => setSelected([])}
            >
              {selected.length ? (
                <X size={16} />
              ) : (
                <SlidersHorizontal size={16} />
              )}
            </button>
          </div>
          <div className="inspector-content">
            {selected.length > 1 ? (
              <>
                <span className="eyebrow">LINKED SELECTION</span>
                <h2>{selected.length} objects selected</h2>
                <p className="muted">
                  Drag in the plan to move together. Shift-click to add or
                  remove an object.
                </p>
              </>
            ) : selectedWall ? (
              <>
                <span className="eyebrow">STRUCTURE / WALL</span>
                <h2>Shape the space.</h2>
                <p className="object-id">{selectedWall.id}</p>
                <NumberField
                  label="Wall length"
                  value={wallLength(design, selectedWall)}
                  onChange={(v) => {
                    try {
                      change(updateWallLength(design, selectedWall.id, v));
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                />
                <div className="field-pair">
                  <NumberField
                    label="Thickness"
                    value={selectedWall.thickness}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.walls.find(
                            (w) => w.id === selectedWall.id,
                          )!.thickness = v),
                      )
                    }
                  />
                  <NumberField
                    label="Wall height"
                    value={selectedWall.height}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.walls.find(
                            (w) => w.id === selectedWall.id,
                          )!.height = v),
                      )
                    }
                  />
                </div>
                {wallPoints(design, selectedWall).map((v, i) => (
                  <div className="field-pair" key={v.id}>
                    <NumberField
                      label={`${i ? "End" : "Start"} X`}
                      value={v.x}
                      onChange={(n) =>
                        edit(
                          (d) => (d.vertices.find((p) => p.id === v.id)!.x = n),
                        )
                      }
                    />
                    <NumberField
                      label={`${i ? "End" : "Start"} Y`}
                      value={v.y}
                      onChange={(n) =>
                        edit(
                          (d) => (d.vertices.find((p) => p.id === v.id)!.y = n),
                        )
                      }
                    />
                  </div>
                ))}
                <label className="select-field">
                  Wall material
                  <select
                    value={selectedWall.material}
                    onChange={(e) =>
                      edit(
                        (d) =>
                          (d.walls.find(
                            (w) => w.id === selectedWall.id,
                          )!.material = e.target.value),
                      )
                    }
                  >
                    {MATERIALS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="info-box">
                  <Link2 size={15} />
                  <span>
                    Shared endpoints move connected walls. Hosted openings keep
                    their offset. Invalid edits are rejected.
                  </span>
                </div>
                <div className="opening-buttons">
                  <button onClick={() => setTool("door")}>
                    <DoorOpen size={15} /> Add door
                  </button>
                  <button onClick={() => setTool("window")}>
                    <Columns2 size={15} /> Add window
                  </button>
                </div>
              </>
            ) : selectedFurniture ? (
              <>
                <span className="eyebrow">
                  {CATALOG.find(
                    (c) => c.id === selectedFurniture.catalogId,
                  )!.category.toUpperCase()}{" "}
                  / OBJECT
                </span>
                <div className="inspector-object-preview">
                  <ItemGlyph
                    id={selectedFurniture.catalogId}
                    color={
                      CATALOG.find((c) => c.id === selectedFurniture.catalogId)!
                        .color
                    }
                  />
                </div>
                <h2>
                  {
                    CATALOG.find((c) => c.id === selectedFurniture.catalogId)!
                      .name
                  }
                </h2>
                <p className="muted">
                  {
                    CATALOG.find((c) => c.id === selectedFurniture.catalogId)!
                      .description
                  }
                </p>
                <div className="section-label">POSITION & DIMENSIONS</div>
                <div className="field-pair">
                  <NumberField
                    label="Position X"
                    value={selectedFurniture.x}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.furniture.find(
                            (f) => f.id === selectedFurniture.id,
                          )!.x = v),
                      )
                    }
                  />
                  <NumberField
                    label="Position Y"
                    value={selectedFurniture.y}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.furniture.find(
                            (f) => f.id === selectedFurniture.id,
                          )!.y = v),
                      )
                    }
                  />
                </div>
                <NumberField
                  label="Rotation"
                  unit="°"
                  value={selectedFurniture.rotation}
                  step={15}
                  onChange={(v) =>
                    edit(
                      (d) =>
                        (d.furniture.find(
                          (f) => f.id === selectedFurniture.id,
                        )!.rotation = v),
                    )
                  }
                />
                <div className="field-pair">
                  <NumberField
                    label="Width"
                    value={furnitureSize(selectedFurniture).width}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.furniture.find(
                            (f) => f.id === selectedFurniture.id,
                          )!.width = v),
                      )
                    }
                  />
                  <NumberField
                    label="Depth"
                    value={furnitureSize(selectedFurniture).depth}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.furniture.find(
                            (f) => f.id === selectedFurniture.id,
                          )!.depth = v),
                      )
                    }
                  />
                </div>
                <NumberField
                  label="Object height"
                  value={furnitureSize(selectedFurniture).height}
                  onChange={(v) =>
                    edit(
                      (d) =>
                        (d.furniture.find(
                          (f) => f.id === selectedFurniture.id,
                        )!.height = v),
                    )
                  }
                />
                <NumberField
                  label="Unit price"
                  unit="USD"
                  value={
                    (selectedFurniture.unitPrice ??
                      CATALOG.find((c) => c.id === selectedFurniture.catalogId)!
                        .price) / 100
                  }
                  onChange={(v) =>
                    edit(
                      (d) =>
                        (d.furniture.find(
                          (f) => f.id === selectedFurniture.id,
                        )!.unitPrice = Math.round(v * 100)),
                    )
                  }
                />
              </>
            ) : selectedOpening ? (
              <>
                <span className="eyebrow">
                  HOSTED / {selectedOpening.type.toUpperCase()}
                </span>
                <h2>
                  {selectedOpening.type === "door"
                    ? "An open invitation."
                    : "Let the outside in."}
                </h2>
                <p className="object-id">Host: {selectedOpening.wallId}</p>
                <NumberField
                  label="Offset from wall start"
                  value={selectedOpening.offset}
                  onChange={(v) =>
                    edit(
                      (d) =>
                        (d.openings.find(
                          (o) => o.id === selectedOpening.id,
                        )!.offset = v),
                    )
                  }
                />
                <div className="field-pair">
                  <NumberField
                    label="Opening width"
                    value={selectedOpening.width}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.openings.find(
                            (o) => o.id === selectedOpening.id,
                          )!.width = v),
                      )
                    }
                  />
                  <NumberField
                    label="Opening height"
                    value={selectedOpening.height}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.openings.find(
                            (o) => o.id === selectedOpening.id,
                          )!.height = v),
                      )
                    }
                  />
                </div>
                {selectedOpening.type === "window" ? (
                  <NumberField
                    label="Sill elevation"
                    value={selectedOpening.sill}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.openings.find(
                            (o) => o.id === selectedOpening.id,
                          )!.sill = v),
                      )
                    }
                  />
                ) : (
                  <>
                    <NumberField
                      label="Door angle"
                      unit="°"
                      step={5}
                      value={selectedOpening.angle}
                      onChange={(v) =>
                        edit(
                          (d) =>
                            (d.openings.find(
                              (o) => o.id === selectedOpening.id,
                            )!.angle = v),
                        )
                      }
                    />
                    <Range
                      label="Open door"
                      value={selectedOpening.angle}
                      min={0}
                      max={110}
                      step={1}
                      unit="°"
                      onPreview={(v) =>
                        edit(
                          (d) =>
                            (d.openings.find(
                              (o) => o.id === selectedOpening.id,
                            )!.angle = v),
                          false,
                        )
                      }
                      onChange={(v) =>
                        edit(
                          (d) =>
                            (d.openings.find(
                              (o) => o.id === selectedOpening.id,
                            )!.angle = v),
                        )
                      }
                    />
                    <button
                      className="outline-button full"
                      onClick={() =>
                        edit(
                          (d) =>
                            (d.openings.find(
                              (o) => o.id === selectedOpening.id,
                            )!.angle = selectedOpening.angle ? 0 : 90),
                        )
                      }
                    >
                      <DoorOpen size={15} />
                      {selectedOpening.angle ? "Close door" : "Open door"}
                    </button>
                  </>
                )}
                <div className="info-box">
                  <Link2 size={15} />
                  <span>
                    Actual opening through the wall, with full reveals.{" "}
                    {selectedOpening.type === "window"
                      ? "Windows never become walkable portals."
                      : "Walkthrough respects the leaf position and your 0.36 m body width."}
                  </span>
                </div>
              </>
            ) : selectedLight ? (
              <>
                <span className="eyebrow">LIGHT / PENDANT</span>
                <h2>A warmer welcome.</h2>
                <div className="field-pair">
                  <NumberField
                    label="Light X"
                    value={selectedLight.x}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.lights.find((l) => l.id === selectedLight.id)!.x =
                            v),
                      )
                    }
                  />
                  <NumberField
                    label="Light Y"
                    value={selectedLight.y}
                    onChange={(v) =>
                      edit(
                        (d) =>
                          (d.lights.find((l) => l.id === selectedLight.id)!.y =
                            v),
                      )
                    }
                  />
                </div>
                <NumberField
                  label="Pendant height"
                  value={selectedLight.height}
                  onChange={(v) =>
                    edit(
                      (d) =>
                        (d.lights.find(
                          (l) => l.id === selectedLight.id,
                        )!.height = v),
                    )
                  }
                />
                <NumberField
                  label="Intensity"
                  unit="cd"
                  value={selectedLight.intensity}
                  onChange={(v) =>
                    edit(
                      (d) =>
                        (d.lights.find(
                          (l) => l.id === selectedLight.id,
                        )!.intensity = v),
                    )
                  }
                />
                <label className="color-field">
                  Light color
                  <input
                    type="color"
                    value={selectedLight.color}
                    onChange={(e) =>
                      edit(
                        (d) =>
                          (d.lights.find(
                            (l) => l.id === selectedLight.id,
                          )!.color = e.target.value),
                      )
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <div className="space-heading">
                  <span className="eyebrow">A SPACE WITH INTENTION</span>
                  <h2>{selectedRoom?.name || project.name}</h2>
                  <p>
                    Single level <span>·</span> Commercial interior
                  </p>
                </div>
                <div className="space-stats">
                  <div>
                    <b data-testid="floor-area">
                      {(selectedRoom?.area ?? q.floorArea).toFixed(2)}
                      <small>m²</small>
                    </b>
                    <span>Floor area</span>
                  </div>
                  <div>
                    <b>{design.furniture.length}</b>
                    <span>Objects</span>
                  </div>
                </div>
                {selectedRoom && (
                  <label className="text-field">
                    Room name
                    <input
                      aria-label="Room name"
                      value={selectedRoom.name}
                      onChange={(e) =>
                        edit(
                          (d) =>
                            (d.roomNames[selectedRoom.id] = e.target.value),
                        )
                      }
                    />
                  </label>
                )}
                <div className="section-label">
                  THE MATERIAL PALETTE <Layers size={14} />
                </div>
                {finishPicker("floor", true)}
                {finishPicker("wall", true)}
                <button
                  className="text-link"
                  onClick={() => setLibrary("finishes")}
                >
                  Explore all finishes <ArrowRight size={13} />
                </button>
                <div className="section-divider" />
                {sceneSettings}
              </>
            )}
            {selected.length > 0 && !selectedRoom && (
              <div className="selection-actions">
                <button
                  onClick={duplicate}
                  title="Duplicate selection (Ctrl+D)"
                >
                  <Copy size={15} /> Duplicate
                </button>
                <button onClick={remove} title="Delete selection">
                  <Trash2 size={15} />
                </button>
                <button title="Clear selection" onClick={() => setSelected([])}>
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="section-divider" />
            <div className="section-label">
              DESIGN CHECK{" "}
              <span
                className={conflicts.length ? "warning-count" : "check-count"}
              >
                {conflicts.length || <Check size={11} />}
              </span>
            </div>
            {conflicts.length ? (
              <div className="warning-list">
                {conflicts.slice(0, 8).map((w, i) => (
                  <button key={i} onClick={() => setSelected(w.ids)}>
                    <span className="warning-dot" />
                    <span>
                      {w.message}
                      <small>
                        {w.kind === "clearance"
                          ? "Door clearance"
                          : "Footprint overlap"}{" "}
                        · Click to inspect
                      </small>
                    </span>
                    <ChevronRight size={12} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="check-good">
                <Check size={14} /> A little room to breathe.
                <small>No footprint overlaps or blocked door swings.</small>
              </p>
            )}
            <p className="microcopy">
              Footprint + height checks, not building-code analysis.
            </p>
            {design.savedViews.length > 0 && (
              <>
                <div className="section-divider" />
                <div className="section-label">
                  SAVED VIEWS <Camera size={14} />
                </div>
                {design.savedViews.map((v) => (
                  <div className="saved-view" key={v.id}>
                    <button
                      onClick={() => {
                        setView("3d");
                        setWalk("orbit");
                        setTimeout(() => scene.current?.setView(v), 50);
                      }}
                    >
                      <Camera size={14} />
                      {v.name}
                    </button>
                    <button
                      aria-label={`Delete ${v.name}`}
                      onClick={() =>
                        edit(
                          (d) =>
                            (d.savedViews = d.savedViews.filter(
                              (x) => x.id !== v.id,
                            )),
                        )
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
          <button className="inspector-footer" onClick={() => setModal("help")}>
            <CircleHelp size={15} />
            <span>A few helpful things</span>
            <ArrowUpRight size={14} />
          </button>
        </aside>
      </main>
      <footer className="statusbar">
        <span>
          <span className="local-dot" /> All yours. Stored on this device.
        </span>
        <span className="status-center">
          {tool === "select"
            ? "Click to select · Shift for multiple · Drag to move"
            : `${tool.toUpperCase()} TOOL · 100 mm grid / endpoint / 45° snapping`}
          <span className="status-separator" /> Centerline dimensions
        </span>
        <button onClick={() => setModal("help")}>
          Keyboard shortcuts <span>?</span>
        </button>
      </footer>
      {presentation && (
        <div className="presentation-controls">
          <button
            onClick={() => {
              setPresentation(false);
              setView("split");
            }}
          >
            <ArrowLeft size={15} /> Back to studio
          </button>
          <select
            aria-label="Presentation saved view"
            onChange={(e) => {
              const v = design.savedViews.find((v) => v.id === e.target.value);
              if (v) scene.current?.setView(v);
            }}
          >
            <option value="">Choose saved view</option>
            {design.savedViews.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button onClick={capture}>
            <Camera size={16} /> Capture image
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")}>
            <X size={15} />
          </button>
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
            className={`modal modal-${modal}`}
            role="dialog"
            aria-modal="true"
            aria-label={modal}
          >
            <button
              className="modal-close"
              onClick={() => setModal(null)}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
            {modal === "projects" ? (
              <>
                <span className="eyebrow">FORMA / YOUR NEXT CHAPTER</span>
                <h1>Great spaces start here.</h1>
                <p className="modal-intro">
                  A place to gather, discover, or make an impression. Choose a
                  starting point and make it yours.
                </p>
                <div className="example-grid">
                  {[
                    {
                      id: "cafe",
                      name: "The Sunday Cafe",
                      tag: "HOSPITALITY",
                      area: "80 m²",
                      items: ["bistro", "chair", "plant"],
                    },
                    {
                      id: "boutique",
                      name: "Atelier No. 04",
                      tag: "RETAIL",
                      area: "69 m²",
                      items: ["rack", "island", "lamp"],
                    },
                    {
                      id: "exhibition",
                      name: "Common Ground",
                      tag: "EXHIBITION",
                      area: "48 m²",
                      items: ["pedestal", "partition", "lounge"],
                    },
                  ].map((e, i) => (
                    <button
                      className={`example-card example-${e.id}`}
                      key={e.id}
                      onClick={() => newProject(e.id as "cafe")}
                    >
                      <div className="example-art">
                        <div className="mini-wall" />
                        {e.items.map((id, j) => (
                          <div className={`example-item item-${j}`} key={id}>
                            <ItemGlyph
                              id={id}
                              color={
                                i === 1
                                  ? "#bbb49e"
                                  : i === 2
                                    ? "#a9b190"
                                    : "#b89973"
                              }
                            />
                          </div>
                        ))}
                        <span>{e.area}</span>
                      </div>
                      <small>{e.tag}</small>
                      <h3>
                        {e.name}
                        <ArrowUpRight size={18} />
                      </h3>
                      <p>
                        {i === 0
                          ? "Slow mornings. Considered details."
                          : i === 1
                            ? "A thoughtful home for a collection."
                            : "A small footprint. A lasting impression."}
                      </p>
                    </button>
                  ))}
                </div>
                <div className="blank-project">
                  <div>
                    <h3>Something entirely your own?</h3>
                    <p>Begin with a blank plan. All the same possibilities.</p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => newProject("blank")}
                  >
                    <Plus size={16} /> Create a blank space
                  </button>
                  <button
                    className="outline-button"
                    onClick={() => importInput.current?.click()}
                  >
                    <Upload size={16} /> Import project
                  </button>
                </div>
                <p className="microcopy">
                  Your current project stays in undo history. Export JSON for a
                  permanent copy before starting a new one.
                </p>
              </>
            ) : modal === "compare" ? (
              <>
                <span className="eyebrow">EXPLORE THE POSSIBILITIES</span>
                <h1>One space. Different stories.</h1>
                <p className="modal-intro">
                  Independent designs, measured by the same rules. Sample prices
                  in USD.
                </p>
                <div className="comparison-grid">
                  {project.designs.map((d, i) => {
                    const n = quantities(d),
                      base = quantities(project.designs[0]),
                      delta = n.total - base.total;
                    return (
                      <article
                        key={d.id}
                        className={d.id === design.id ? "current" : ""}
                      >
                        <span className="eyebrow">
                          ALTERNATIVE {String(i + 1).padStart(2, "0")}
                        </span>
                        <input
                          aria-label={`Alternative ${i + 1} name`}
                          value={d.name}
                          onChange={(e) => {
                            const p = clone(project);
                            p.designs[i].name = e.target.value;
                            commitProject(p);
                          }}
                        />
                        <div
                          className="compare-plan"
                          dangerouslySetInnerHTML={{ __html: exportSVG(d) }}
                        />
                        <div className="compare-total">
                          {exactMoney(n.total)}
                          <span className={delta < 0 ? "saving" : ""}>
                            {i === 0
                              ? "Baseline"
                              : `${delta >= 0 ? "+" : ""}${exactMoney(delta)} vs baseline`}
                          </span>
                        </div>
                        <dl>
                          <div>
                            <dt>Floor area</dt>
                            <dd>{n.floorArea.toFixed(3)} m²</dd>
                          </div>
                          <div>
                            <dt>Furniture / {n.furnitureCount} pieces</dt>
                            <dd>{currency(n.furniture)}</dd>
                          </div>
                          <div>
                            <dt>Floor + wall finishes</dt>
                            <dd>{currency(n.floor + n.wall)}</dd>
                          </div>
                          <div>
                            <dt>Doors + windows</dt>
                            <dd>{currency(n.openings)}</dd>
                          </div>
                        </dl>
                        <button
                          className={
                            d.id === design.id
                              ? "primary full"
                              : "outline-button full"
                          }
                          onClick={() => {
                            switchDesign(d.id);
                            setModal(null);
                          }}
                        >
                          {d.id === design.id
                            ? "Continue designing"
                            : "Explore this alternative"}
                          <ArrowRight size={15} />
                        </button>
                      </article>
                    );
                  })}
                </div>
                <button className="outline-button" onClick={alternative}>
                  <Copy size={16} /> Duplicate current design
                </button>
              </>
            ) : modal === "schedule" ? (
              <>
                <span className="eyebrow">THE DETAILS ADD UP</span>
                <h1>A considered investment.</h1>
                <div className="schedule-heading">
                  <p>{design.name} · Sample prices · USD</p>
                  <button
                    className="outline-button"
                    onClick={() =>
                      download(
                        `${project.name}-schedule.csv`,
                        exportCSV(design),
                        "text/csv",
                      )
                    }
                  >
                    <ArrowDownToLine size={15} /> Export CSV
                  </button>
                </div>
                <div className="schedule-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qty</th>
                        <th>W × D × H / meters</th>
                        <th>Unit price</th>
                        <th>Extended</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.schedule.map((r) => (
                        <tr key={r.key}>
                          <td>{r.name}</td>
                          <td>{r.quantity}</td>
                          <td>
                            {r.width} × {r.depth} × {r.height}
                          </td>
                          <td>{exactMoney(r.unitPrice)}</td>
                          <td>{exactMoney(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rates-grid">
                  <NumberField
                    label={`Floor / ${q.floorArea.toFixed(3)} m²`}
                    value={design.rates.floor / 100}
                    unit="$/m²"
                    onChange={(v) =>
                      edit((d) => (d.rates.floor = Math.round(v * 100)))
                    }
                  />
                  <NumberField
                    label={`Walls / ${q.wallArea.toFixed(3)} m²`}
                    value={design.rates.wall / 100}
                    unit="$/m²"
                    onChange={(v) =>
                      edit((d) => (d.rates.wall = Math.round(v * 100)))
                    }
                  />
                  <NumberField
                    label={`Doors / ${q.doors}`}
                    value={design.rates.door / 100}
                    unit="$/ea"
                    onChange={(v) =>
                      edit((d) => (d.rates.door = Math.round(v * 100)))
                    }
                  />
                  <NumberField
                    label={`Windows / ${q.windows}`}
                    value={design.rates.window / 100}
                    unit="$/ea"
                    onChange={(v) =>
                      edit((d) => (d.rates.window = Math.round(v * 100)))
                    }
                  />
                </div>
                <div className="schedule-total">
                  <span>
                    Total estimated budget
                    <small>
                      Furniture {exactMoney(q.furniture)} + floor{" "}
                      {exactMoney(q.floor)} + walls {exactMoney(q.wall)} +
                      openings {exactMoney(q.openings)}
                    </small>
                  </span>
                  <strong>
                    {exactMoney(q.total)} <small>USD</small>
                  </strong>
                </div>
                <div className="cost-conventions">
                  <b>A clear basis for comparison.</b>
                  <p>
                    Floor area uses room boundary centerlines. Both longitudinal
                    wall faces are costed once per wall; door and window areas
                    are deducted from both faces. No end caps or junction
                    correction. Prices are integer cents; each finish category
                    rounds once to the nearest cent, half-up. No labor,
                    electrical, light fixtures, tax, or construction estimates
                    are included.
                  </p>
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">
                  A LITTLE GUIDANCE, A LOT OF POSSIBILITY
                </span>
                <h1>Make room for your ideas.</h1>
                <div className="guide-grid">
                  <article>
                    <span>01</span>
                    <PencilRuler size={27} />
                    <h3>Shape your space</h3>
                    <p>
                      Use Draw wall and click connected endpoints. Close a loop
                      to create a floor automatically. Select a wall for exact
                      dimensions, or drag an endpoint. Green room surfaces
                      always follow the shared geometry.
                    </p>
                  </article>
                  <article>
                    <span>02</span>
                    <Armchair size={27} />
                    <h3>Make it feel right</h3>
                    <p>
                      Pick a furnishing and click in the plan. Drag to move, R
                      to rotate. Add hosted doors and windows on a wall. Amber
                      warnings explain overlaps and blocked door swings.
                    </p>
                  </article>
                  <article>
                    <span>03</span>
                    <Footprints size={27} />
                    <h3>See yourself here</h3>
                    <p>
                      Enter Walkthrough, click the scene, then use WASD and
                      mouse look. Esc releases the mouse; the X or Orbit button
                      exits. The target icon recovers to a safe position after
                      edits.
                    </p>
                  </article>
                </div>
                <div className="shortcut-grid">
                  {[
                    ["V", "Select"],
                    ["W", "Draw wall"],
                    ["H / Alt-drag", "Pan plan"],
                    ["F", "Fit / reset camera"],
                    ["R", "Rotate 15°"],
                    ["Shift-click", "Multiselect"],
                    ["Ctrl D", "Duplicate"],
                    ["Delete", "Delete selection"],
                    ["Ctrl Z / Shift Z", "Undo / redo"],
                    ["Ctrl S", "Export project"],
                    ["Scroll", "Cursor-centered zoom"],
                    ["Esc", "Cancel / release mouse"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <kbd>{key}</kbd>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="info-box">
                  <Leaf size={18} />
                  <span>
                    Everything runs locally. Your project autosaves on this
                    device. Export a versioned JSON for a portable, editable
                    backup, or compare independent alternatives before
                    committing to a direction.
                  </span>
                </div>
                <p className="microcopy">
                  Dimensions and floor areas use wall centerlines, not finished
                  faces. Straight, single-level walls only. Footprint warnings
                  are design guidance, not physical simulation or code
                  certification. Cutaway removes front/right wall height in
                  orbit; walkthrough always uses full geometry.
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    setModal(null);
                    setHint(false);
                    localStorage.setItem("forma-onboarded", "1");
                  }}
                >
                  Let's make a space <ArrowRight size={16} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
