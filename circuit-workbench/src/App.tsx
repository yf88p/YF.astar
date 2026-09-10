import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Cable,
  ChevronDown,
  CircuitBoard,
  CircleDot,
  FilePlus2,
  FlaskConical,
  Hand,
  Layers,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Search,
  Square,
  Tag,
  Trash2,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import Canvas, { type Tool } from "./Canvas";
import Inspector from "./Inspector";
import Scope, { probeValue } from "./Scope";
import { Symbol } from "./Symbol";
import { emptyDocument, validateDocument } from "./model";
import { defaultExample, examples } from "./examples";
import { buildNetlist } from "./netlist";
import { nextId, removeSelection } from "./editor";
import type {
  CircuitDocument,
  ComponentType,
  Netlist,
  Solution,
  TransientResult,
} from "./types";
import manual from "../README.md?raw";

const library: {
  type: ComponentType;
  name: string;
  detail: string;
  shortcut: string;
}[] = [
  { type: "resistor", name: "Resistor", detail: "Resistance", shortcut: "1" },
  {
    type: "capacitor",
    name: "Capacitor",
    detail: "Electric field",
    shortcut: "2",
  },
  {
    type: "inductor",
    name: "Inductor",
    detail: "Magnetic field",
    shortcut: "3",
  },
  { type: "diode", name: "Diode", detail: "Shockley junction", shortcut: "" },
  {
    type: "voltage",
    name: "Voltage source",
    detail: "DC / sine / pulse",
    shortcut: "4",
  },
  {
    type: "current",
    name: "Current source",
    detail: "DC / sine / pulse",
    shortcut: "",
  },
  { type: "switch", name: "Switch", detail: "Scheduled events", shortcut: "" },
  {
    type: "ground",
    name: "Ground",
    detail: "Reference potential",
    shortcut: "G",
  },
];
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function initialDoc() {
  try {
    const saved = localStorage.getItem("fieldwork-project-v1");
    if (saved) return validateDocument(JSON.parse(saved));
  } catch {
    /* Invalid saved data never enters the editable document. */
  }
  return defaultExample();
}
type Capture = {
  revision: number;
  mode: "dc" | "transient";
  netlist: Netlist;
  solution: Solution;
  samples: Solution[] | null;
  elapsed: number;
};

export default function App() {
  const [doc, setDoc] = useState<CircuitDocument>(initialDoc);
  const docRef = useRef(doc);
  const [revision, setRevision] = useState(0),
    revisionRef = useRef(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"dc" | "transient">("dc");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [running, setRunning] = useState(false),
    [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState(
      "Your bench is ready. Build something interesting.",
    );
  const [tab, setTab] = useState<"inspect" | "analysis" | "readings">(
    "inspect",
  );
  const [modal, setModal] = useState<"netlist" | "help" | "examples" | null>(
    null,
  );
  const [fitKey, setFitKey] = useState(0),
    [historyCount, setHistoryCount] = useState({ undo: 0, redo: 0 });
  const [mobilePanel, setMobilePanel] = useState<
    "canvas" | "library" | "inspector"
  >("canvas");
  const history = useRef<{
    past: CircuitDocument[];
    future: CircuitDocument[];
  }>({ past: [], future: [] });
  const worker = useRef<Worker | null>(null),
    timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  let netlist: Netlist | null = null;
  try {
    netlist = buildNetlist(doc);
  } catch {
    /* The netlist panel displays any topology error. */
  }
  const stale = !!capture && capture.revision !== revision;
  const solution =
    capture && !stale && !running && !error ? capture.solution : null;

  function stop(message = "Analysis cancelled. No partial capture retained.") {
    worker.current?.terminate();
    worker.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    setRunning(false);
    setProgress(0);
    if (message) setNotice(message);
  }
  function install(next: CircuitDocument) {
    stop("");
    docRef.current = next;
    setDoc(next);
    revisionRef.current++;
    setRevision(revisionRef.current);
    setHighlighted(null);
    setError(null);
    try {
      localStorage.setItem("fieldwork-project-v1", JSON.stringify(next));
      setNotice(
        "Project saved in this browser. Previous results require a rerun.",
      );
    } catch {
      setNotice(
        "Browser storage unavailable. Export JSON to keep your project.",
      );
    }
  }
  function commit(next: CircuitDocument): boolean {
    try {
      const valid = validateDocument(next);
      if (JSON.stringify(valid) === JSON.stringify(docRef.current)) return true;
      history.current.past.push(docRef.current);
      if (history.current.past.length > 60) history.current.past.shift();
      history.current.future = [];
      install(valid);
      setHistoryCount({ undo: history.current.past.length, redo: 0 });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  function undo(redo = false) {
    const from = redo ? history.current.future : history.current.past,
      to = redo ? history.current.past : history.current.future;
    const next = from.pop();
    if (!next) return;
    to.push(docRef.current);
    install(next);
    setSelected(null);
    setHistoryCount({
      undo: history.current.past.length,
      redo: history.current.future.length,
    });
    setNotice(
      redo
        ? "Change redone. Rerun to refresh measurements."
        : "Change undone. Rerun to refresh measurements.",
    );
  }
  function select(id: string | null) {
    setSelected(id);
    if (id) setTab("inspect");
  }
  function remove() {
    if (selected && commit(removeSelection(docRef.current, selected)))
      setSelected(null);
  }
  function rotate() {
    const next = structuredClone(docRef.current),
      c = next.components.find((c) => c.id === selected);
    if (c) {
      c.rotation = (c.rotation + 90) % 360;
      commit(next);
    }
  }
  function duplicate() {
    const next = structuredClone(docRef.current),
      c = next.components.find((c) => c.id === selected);
    if (c) {
      const copy = structuredClone(c);
      copy.id = nextId(next, c.id.replace(/\d+$/, "") || "C");
      copy.x += 60;
      copy.y += 60;
      next.components.push(copy);
      if (commit(next)) select(copy.id);
    } else if (selected)
      setNotice(
        "Select a component to duplicate it. Copies begin electrically unconnected.",
      );
  }
  function run(which = mode) {
    stop("");
    setError(null);
    setCapture(null);
    setProgress(0);
    setRunning(true);
    setNotice(
      `Solving ${which === "dc" ? "DC operating point" : "transient response"} locally...`,
    );
    const currentRevision = revisionRef.current;
    const instance = new Worker(
      new URL("./analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = instance;
    timeout.current = setTimeout(() => {
      if (worker.current === instance) {
        stop("Analysis stopped at the 30-second compute budget.");
        setError(
          "Compute budget exceeded (30 seconds). Reduce duration, increase maximum timestep, or simplify the circuit. No partial trace is presented as complete.",
        );
      }
    }, 30000);
    instance.onmessage = ({ data }) => {
      if (worker.current !== instance || data.revision !== revisionRef.current)
        return;
      if (data.type === "progress") {
        setProgress(data.fraction);
        return;
      }
      stop("");
      if (data.type === "error") {
        setError(data.message);
        setCapture(null);
        setNotice("Analysis failed. The editable project is unchanged.");
        return;
      }
      const samples =
        data.mode === "transient"
          ? (data.result as TransientResult).samples
          : null;
      setCapture({
        revision: currentRevision,
        mode: data.mode,
        netlist: data.netlist,
        solution: samples ? samples[samples.length - 1] : data.result,
        samples,
        elapsed: data.elapsed,
      });
      setProgress(1);
      setNotice(
        `${data.mode === "dc" ? "DC operating point" : `Transient: ${samples!.length.toLocaleString()} samples`} computed in ${data.elapsed.toFixed(1)} ms. All readings use the same solution.`,
      );
      if (data.mode === "dc") setTab("readings");
    };
    instance.onerror = (event) => {
      if (worker.current !== instance) return;
      stop("Analysis worker failed.");
      setError(event.message || "Unable to start the local analysis worker.");
      setCapture(null);
    };
    instance.postMessage({
      doc: docRef.current,
      mode: which,
      revision: currentRevision,
    });
  }
  function reset() {
    stop("Reset. The next run starts from the chosen initial state at t = 0.");
    setCapture(null);
    setError(null);
  }
  function load(next: CircuitDocument) {
    if (commit(next)) {
      setSelected(null);
      setTool("select");
      setFitKey((k) => k + 1);
      setModal(null);
      setMobilePanel("canvas");
    }
  }
  async function importFile(file: File) {
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Project exceeds the 5 MB import limit.");
      const valid = validateDocument(JSON.parse(await file.text()));
      load(valid);
      setNotice("Project imported and validated. Ready to edit and solve.");
    } catch (e) {
      setError(
        `Import rejected; current project unchanged. ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  function exportJSON() {
    download(
      JSON.stringify(docRef.current, null, 2),
      `${docRef.current.title.replace(/[^a-z0-9_-]/gi, "-")}.circuit.json`,
      "application/json",
    );
    setNotice("Editable version-1 project exported.");
  }
  function exportCSV() {
    if (!capture?.samples || stale) return;
    const q = (s: string) => `"${s.replaceAll('"', '""')}"`;
    const channels = doc.probes;
    const lines = [
      q("time [s]") +
        channels
          .map(
            (p) => "," + q(`${p.name} [${p.kind === "voltage" ? "V" : "A"}]`),
          )
          .join(""),
    ];
    for (const s of capture.samples)
      lines.push(
        [
          s.time,
          ...channels.map((p) => probeValue(p, capture.netlist, s)),
        ].join(","),
      );
    download(lines.join("\n") + "\n", "fieldwork-waveforms.csv", "text/csv");
    setNotice(
      `Exported all ${capture.samples.length} original samples with channel units.`,
    );
  }
  useEffect(
    () => () => {
      worker.current?.terminate();
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (e.key === "Escape") {
        setTool("select");
        setModal(null);
        select(null);
        return;
      }
      if (modal) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        undo(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        exportJSON();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === "/") {
          e.preventDefault();
          document
            .querySelector<HTMLInputElement>('[aria-label="Search components"]')
            ?.focus();
        }
        if (e.key === "?") setModal("help");
        const keys: Record<string, Tool> = {
          v: "select",
          w: "wire",
          j: "junction",
          p: "voltageProbe",
          i: "currentProbe",
          l: "label",
          h: "pan",
          "1": "place:resistor",
          "2": "place:capacitor",
          "3": "place:inductor",
          "4": "place:voltage",
          g: "place:ground",
        };
        if (keys[e.key.toLowerCase()]) {
          e.preventDefault();
          setTool(keys[e.key.toLowerCase()]);
        }
        if (e.key.toLowerCase() === "r") rotate();
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          remove();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const tools: {
    id: Tool;
    label: string;
    key: string;
    icon: React.ReactNode;
  }[] = [
    { id: "select", label: "Select", key: "V", icon: <MousePointer2 /> },
    { id: "pan", label: "Pan", key: "H", icon: <Hand /> },
    { id: "wire", label: "Wire", key: "W", icon: <Cable /> },
    { id: "junction", label: "Junction", key: "J", icon: <CircleDot /> },
    {
      id: "voltageProbe",
      label: "Voltage probe",
      key: "P",
      icon: <Activity />,
    },
    { id: "currentProbe", label: "Current probe", key: "I", icon: <Zap /> },
    { id: "label", label: "Net label", key: "L", icon: <Tag /> },
  ];
  return (
    <div className={`app mobile-${mobilePanel}`}>
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setModal("examples");
          }}
        >
          <span className="brand-mark">
            <CircuitBoard size={25} />
          </span>
          <strong>
            FIELDWORK<span>CIRCUIT LAB</span>
          </strong>
        </a>
        <div className="header-divider" />
        <span className="header-description">
          A little curiosity. A working circuit.
        </span>
        <div className="header-actions">
          <span className="local-badge">
            <span className="status-dot" />
            All computation stays here
          </span>
          <button className="button subtle" onClick={() => setModal("help")}>
            <BookOpen size={15} />
            <span>Field guide</span>
          </button>
          <button
            className="button"
            onClick={exportJSON}
            title="Export editable project (Ctrl+S)"
          >
            <ArrowDownToLine size={15} />
            <span>Export project</span>
          </button>
        </div>
      </header>
      <div className="project-bar">
        <div className="project-name">
          <span className="project-icon">
            <Layers size={17} />
          </span>
          <input
            aria-label="Project title"
            key={doc.title}
            defaultValue={doc.title}
            onBlur={(e) => {
              if (e.target.value !== doc.title)
                commit({ ...doc, title: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <span className="version-tag">LOCAL PROJECT</span>
        </div>
        <div className="project-actions">
          <button
            className="text-button"
            onClick={() => load(emptyDocument())}
            title="New empty project"
          >
            <FilePlus2 size={15} />
            <span>New</span>
          </button>
          <button
            className="text-button"
            onClick={() => fileInput.current?.click()}
          >
            <ArrowUpFromLine size={15} />
            <span>Import</span>
          </button>
          <input
            ref={fileInput}
            data-testid="project-import"
            type="file"
            accept=".json,.circuit.json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.currentTarget.value = "";
            }}
          />
          <span className="vertical-rule" />
          <button
            className="example-button"
            onClick={() => setModal("examples")}
          >
            <FlaskConical size={15} />
            Example circuits
            <ChevronDown size={13} />
          </button>
        </div>
      </div>
      <nav className="mobile-navigation">
        <button
          onClick={() => setMobilePanel("library")}
          className={mobilePanel === "library" ? "active" : ""}
        >
          Components
        </button>
        <button
          onClick={() => setMobilePanel("canvas")}
          className={mobilePanel === "canvas" ? "active" : ""}
        >
          Workbench
        </button>
        <button
          onClick={() => setMobilePanel("inspector")}
          className={mobilePanel === "inspector" ? "active" : ""}
        >
          Inspector
        </button>
      </nav>
      <main className="workbench">
        <aside className="library">
          <div className="library-heading">
            <h2>Components</h2>
            <span>{library.length.toString().padStart(2, "0")}</span>
          </div>
          <label className="search-field">
            <Search size={14} />
            <input
              aria-label="Search components"
              placeholder="Find a component..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div className="section-caption">THE ESSENTIALS</div>
          <div className="component-list">
            {library
              .filter((c) =>
                `${c.name} ${c.detail}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((c) => (
                <button
                  key={c.type}
                  className={`library-part ${tool === `place:${c.type}` ? "active" : ""}`}
                  data-testid={`palette-${c.type}`}
                  onClick={() => {
                    setTool(`place:${c.type}`);
                    setMobilePanel("canvas");
                  }}
                >
                  <span className="library-symbol">
                    <svg viewBox="-48 -32 96 64">
                      <Symbol type={c.type} />
                    </svg>
                  </span>
                  <span className="library-part-name">
                    {c.name}
                    <small>{c.detail}</small>
                  </span>
                  {c.shortcut && <kbd>{c.shortcut}</kbd>}
                </button>
              ))}
          </div>
          <div className="library-probes">
            <div className="section-caption">MEASURE & CONNECT</div>
            <button
              onClick={() => {
                setTool("voltageProbe");
                setMobilePanel("canvas");
              }}
            >
              <Activity size={16} />
              <span>Voltage probe</span>
              <kbd>P</kbd>
            </button>
            <button
              onClick={() => {
                setTool("currentProbe");
                setMobilePanel("canvas");
              }}
            >
              <Zap size={16} />
              <span>Current probe</span>
              <kbd>I</kbd>
            </button>
            <button
              onClick={() => {
                setTool("junction");
                setMobilePanel("canvas");
              }}
            >
              <CircleDot size={16} />
              <span>Junction</span>
              <kbd>J</kbd>
            </button>
          </div>
          <div className="library-bottom">
            <div className="connection-guide">
              <div>
                <svg width="43" height="21">
                  <path
                    d="M0 11H43 M21 0V21"
                    stroke="currentColor"
                    fill="none"
                  />
                  <circle cx="21" cy="11" r="4" fill="#718c7c" />
                </svg>
                <span>Dot = connected</span>
              </div>
              <div>
                <svg width="43" height="21">
                  <path
                    d="M21 0V21 M0 11H15 Q21 1 27 11H43"
                    stroke="currentColor"
                    fill="none"
                  />
                  <path d="M21 5V11" stroke="#f0f2ec" strokeWidth="5" />
                </svg>
                <span>Bridge = crossing</span>
              </div>
            </div>
            <p>
              Pick a part. Place it. Connect it.
              <br />
              The possibilities are yours.
            </p>
            <button onClick={() => setModal("help")}>
              Keyboard shortcuts <span>?</span>
            </button>
          </div>
        </aside>
        <section className="center-workspace">
          <div className="editor-toolbar">
            <div className="tools">
              {tools.map((t) => (
                <button
                  key={t.id}
                  className={tool === t.id ? "active" : ""}
                  title={`${t.label} (${t.key})`}
                  aria-label={`${t.label} (${t.key})`}
                  onClick={() => setTool(t.id)}
                >
                  {t.icon}
                </button>
              ))}
              <span className="vertical-rule" />
              <button
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                disabled={!historyCount.undo}
                onClick={() => undo()}
              >
                <Undo2 />
              </button>
              <button
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
                disabled={!historyCount.redo}
                onClick={() => undo(true)}
              >
                <Redo2 />
              </button>
              <button
                className="optional-tool"
                title="Rotate selected (R)"
                disabled={!doc.components.some((c) => c.id === selected)}
                onClick={rotate}
              >
                <RotateCw />
              </button>
              <button
                className="optional-tool"
                title="Delete selected"
                disabled={!selected}
                onClick={remove}
              >
                <Trash2 />
              </button>
            </div>
            <div className="analysis-controls">
              <select
                aria-label="Analysis type"
                value={mode}
                onChange={(e) => setMode(e.target.value as "dc" | "transient")}
              >
                <option value="dc">DC operating point</option>
                <option value="transient">Transient</option>
              </select>
              <button
                className={`run-button ${running ? "running" : ""}`}
                onClick={() => (running ? stop() : run())}
                title={running ? "Stop analysis" : "Run analysis"}
              >
                {running ? (
                  <Square size={13} fill="currentColor" />
                ) : (
                  <Play size={13} fill="currentColor" />
                )}
                <span>{running ? "Stop" : "Run"}</span>
              </button>
              <button
                className="reset-button"
                title="Reset to chosen initial state"
                aria-label="Reset simulation"
                onClick={reset}
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
          <div className="schematic-region">
            {error && (
              <div role="alert" className="error-banner">
                <span>
                  <strong>Needs attention</strong>
                  {error}
                </span>
                <button
                  aria-label="Dismiss error"
                  onClick={() => setError(null)}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {running && (
              <div className="simulation-progress">
                <span>Solving locally</span>
                <progress value={progress} max="1" />
                <strong>{Math.round(progress * 100)}%</strong>
              </div>
            )}
            <Canvas
              doc={doc}
              selected={selected}
              onSelect={select}
              onChange={commit}
              tool={tool}
              onTool={setTool}
              netlist={netlist}
              highlighted={highlighted}
              onHighlight={setHighlighted}
              solution={solution}
              fitKey={fitKey}
            />
          </div>
          <div className="scope-region">
            <Scope
              doc={doc}
              netlist={capture?.netlist ?? netlist}
              samples={capture?.samples ?? null}
              stale={stale || !!error || running}
              onExport={exportCSV}
            />
          </div>
        </section>
        <Inspector
          doc={doc}
          selected={selected}
          revision={revision}
          onChange={commit}
          onError={setError}
          onDelete={remove}
          onRotate={rotate}
          onDuplicate={duplicate}
          tab={tab}
          setTab={setTab}
          solution={solution}
          netlist={netlist}
          onHighlight={setHighlighted}
          onNetlist={() => setModal("netlist")}
        />
      </main>
      <footer className="statusbar">
        <span
          className={`status-dot ${error ? "error" : stale ? "stale" : ""}`}
        />
        <span className="status-message" role="status">
          {notice}
        </span>
        <span className="document-stats">
          {doc.components.length} parts <span>/</span> {doc.wires.length} wires{" "}
          <span>/</span> {netlist?.nets.length ?? 0} nets
        </span>
        <span className="revision-label">
          REV {String(revision).padStart(3, "0")}
        </span>
        <span className="grid-label">GRID 20</span>
      </footer>
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
            aria-label={
              modal === "examples"
                ? "Example circuits"
                : modal === "netlist"
                  ? "Shared netlist"
                  : "Field guide"
            }
          >
            <header>
              <span className="eyebrow">
                FIELDWORK /{" "}
                {modal === "examples"
                  ? "START EXPLORING"
                  : modal === "netlist"
                    ? "UNDER THE HOOD"
                    : "REFERENCE"}
              </span>
              <button
                aria-label="Close dialog"
                onClick={() => setModal(null)}
                autoFocus
              >
                <X size={20} />
              </button>
            </header>
            {modal === "examples" && (
              <>
                <h1>Ideas that make a connection.</h1>
                <p className="modal-intro">
                  Real circuits. Real equations. A starting point for your next
                  experiment.
                </p>
                <div className="example-grid">
                  {examples.map((e, i) => (
                    <button
                      key={e.id}
                      className="example-card"
                      data-testid={`example-${e.id}`}
                      onClick={() => load(e.create())}
                    >
                      <span className="example-number">0{i + 1}</span>
                      <span className="example-mini">
                        <svg viewBox="-48 -32 96 64">
                          <Symbol
                            type={
                              (
                                [
                                  "resistor",
                                  "capacitor",
                                  "inductor",
                                  "diode",
                                  "switch",
                                ] as const
                              )[i]
                            }
                          />
                        </svg>
                      </span>
                      <h2>{e.title}</h2>
                      <p>{e.description}</p>
                      <span className="example-open">
                        Open circuit <Plus size={15} />
                      </span>
                    </button>
                  ))}
                  <button
                    className="example-card blank-example"
                    onClick={() => load(emptyDocument())}
                  >
                    <FilePlus2 size={30} />
                    <h2>A blank canvas</h2>
                    <p>
                      Start from first principles. Build and wire a circuit of
                      your own.
                    </p>
                    <span className="example-open">
                      New project <Plus size={15} />
                    </span>
                  </button>
                </div>
                <p className="field-note">
                  Loading a circuit is undoable. Export JSON to keep a separate
                  copy of your current project.
                </p>
              </>
            )}
            {modal === "netlist" && (
              <>
                <h1>One circuit. One netlist.</h1>
                <p className="modal-intro">
                  The exact topology consumed by both DC and transient analyses.
                  Click a net to trace it on the schematic. Names label nets;
                  only endpoint references connect them.
                </p>
                {netlist ? (
                  <>
                    <div className="net-chips">
                      {netlist.nets.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            setHighlighted(n.id);
                            setModal(null);
                          }}
                        >
                          <span className={n.id === "0" ? "ground-dot" : ""} />
                          {n.name}
                          <small>{n.endpoints.length} pins / junctions</small>
                        </button>
                      ))}
                    </div>
                    <pre className="netlist-code" data-testid="netlist-code">
                      {JSON.stringify(netlist, null, 2)}
                    </pre>
                    <button
                      className="button"
                      onClick={() =>
                        download(
                          JSON.stringify(netlist, null, 2),
                          "fieldwork-netlist.json",
                          "application/json",
                        )
                      }
                    >
                      <ArrowDownToLine size={15} />
                      Export solver netlist
                    </button>
                  </>
                ) : (
                  <p className="danger">
                    The document could not be compiled. Check endpoint
                    references.
                  </p>
                )}
              </>
            )}
            {modal === "help" && (
              <>
                <h1>Your field guide.</h1>
                <p className="modal-intro">
                  An independent electronics workbench. No accounts, no
                  server-side solving, no pretend waveforms.
                </p>
                <div className="help-grid">
                  <section>
                    <h2>Build & connect</h2>
                    <p>
                      Click a library part, then the grid. Select and drag to
                      move. Attached wires follow the same pins, including after
                      rotation.
                    </p>
                    <p>
                      <kbd>W</kbd> starts wiring: click a pin, click bends,
                      finish on another pin or explicit junction. <kbd>J</kbd>{" "}
                      creates a junction and joins every segment under its dot.
                      Crossings without dots are not connected.
                    </p>
                    <p>
                      Select a wire to reconnect endpoints in Inspect.
                      Double-click its route to add a bend; drag square handles
                      to edit. Delete removes dependent references.
                    </p>
                  </section>
                  <section>
                    <h2>Measure & solve</h2>
                    <p>
                      <kbd>P</kbd> adds voltage probes to pins/junctions.{" "}
                      <kbd>I</kbd> adds a component-current probe. Choose an
                      analysis and Run. Analysis settings and explicit initial
                      states live in the inspector.
                    </p>
                    <p>
                      DC uses constant source values. Transient uses the
                      selected waveform. Both use the same MNA netlist and
                      report signed currents from pin 0 to pin 1. A voltage
                      source is positive at pin 0; a diode's pin 0 is its anode.
                    </p>
                    <p>
                      Every edit marks previous captures stale. Stop discards
                      partial work; Reset restores t = 0 on the next run. Worker
                      computation is bounded to 30 seconds.
                    </p>
                  </section>
                </div>
                <div className="shortcut-grid">
                  {[
                    ["V", "Select"],
                    ["H / middle drag", "Pan"],
                    ["Wheel", "Cursor-centered zoom"],
                    ["R", "Rotate selected"],
                    ["Ctrl+D", "Duplicate part"],
                    ["Delete", "Delete selection"],
                    ["Ctrl+Z", "Undo"],
                    ["Ctrl+Shift+Z", "Redo"],
                    ["L", "Label a net"],
                    ["Esc", "Cancel tool"],
                    ["1 / 2 / 3 / 4", "R / C / L / V source"],
                    ["G", "Place ground"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <kbd>{key}</kbd>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="model-note">
                  <strong>Know the model</strong>
                  <p>
                    Positive finite R, C, L. Shockley diodes at 300 K, without
                    breakdown or parasitic capacitance. Finite switch
                    resistances. Trapezoidal integration with backward-Euler
                    retry on nonlinear failure; no hidden conductance or source
                    resistance. Newton success requires residual and update
                    convergence. The timestep, not Newton tolerance, controls
                    integration accuracy.
                  </p>
                  <p>
                    100,000 steps, 150 MNA unknowns, and 2,000,000 stored
                    scalars maximum. Singular or inconsistent circuits are
                    errors, not silently repaired. See the technical guide for
                    formulas, residual tolerances, independently measured
                    accuracy, and reproducible checks.
                  </p>
                </div>
                <button
                  className="button"
                  onClick={() =>
                    download(manual, "FIELDWORK-README.md", "text/markdown")
                  }
                >
                  <BookOpen size={15} />
                  Download complete technical guide
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
