import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Frame,
  Grid2X2,
  Image as ImageIcon,
  Layers,
  Link2,
  ListFilter,
  Menu,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  Pin,
  Plus,
  Quote,
  Redo2,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Tag,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import Canvas from "./Canvas.jsx";
import Editor from "./Editor.jsx";
import {
  History,
  WorkspaceStore,
  backlinks,
  blankWorkspace,
  change,
  exportMarkdown,
  exportPackage,
  fitCamera,
  id,
  parseMarkdown,
  resolvePlacement,
  safeUrl,
  search,
  setDocumentStatus,
  validateWorkspace,
} from "./core.js";
import { createSeed } from "./seed.js";

const stamp = () => new Date().toISOString();
const emptyBoard = (name) => ({
  id: id("board"),
  name,
  description: "A little room for your next idea.",
  placements: [],
  frames: [],
  relationships: [],
  camera: { x: 40, y: 40, zoom: 1 },
});
const editable = (target) =>
  target?.closest(
    'input, textarea, select, [contenteditable="true"], [role="dialog"], dialog',
  );
const describe = (value) =>
  typeof value === "string"
    ? value
    : value?.filename ||
      value?.label ||
      value?.type ||
      "Created in this workspace";

function initialWorkspace() {
  try {
    const store = new WorkspaceStore();
    const entries = store.list();
    const active = localStorage.getItem("margin:active");
    const key =
      entries.find((entry) => entry.id === active)?.id || entries[0]?.id;
    return { workspace: key ? store.load(key) : createSeed(), error: "" };
  } catch (error) {
    return {
      workspace: createSeed(),
      error: `Stored workspace could not be opened. Your stored data has not been replaced. ${error.message}`,
    };
  }
}

function saveFile(name, body, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\\/\u0000-\u001f]/g, "-");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeXml(text) {
  return String(text).replace(
    /[<>&"']/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

function boardSvg(workspace, board) {
  const items = [...board.placements, ...board.frames];
  const minX = Math.min(0, ...items.map((p) => p.x)) - 30;
  const minY = Math.min(0, ...items.map((p) => p.y)) - 60;
  const width = Math.max(800, ...items.map((p) => p.x + p.w)) - minX + 30;
  let height = Math.max(600, ...items.map((p) => p.y + p.h)) - minY + 30;
  const lines = (text, length = 46) => {
    const rows = [];
    let row = "";
    for (const word of text.split(/\s+/)) {
      if ((row + " " + word).length > length && row) {
        rows.push(row);
        row = "";
      }
      row += (row ? " " : "") + word;
    }
    if (row) rows.push(row);
    return rows;
  };
  const keyTop = minY + height;
  const relationshipKey = board.relationships.map(r => lines(`${r.type}${r.label ? ' / ' + r.label : ''}`, Math.max(30, Math.floor((width - 90) / 6))));
  if (relationshipKey.length) height += 65 + relationshipKey.reduce((sum, rows) => sum + rows.length * 16 + 10, 0);
  let connectionMarkers = '';
  let body = `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#f0f0e9"/><text x="${minX + 30}" y="${minY + 35}" font-family="Georgia,serif" font-size="23" fill="#35432d">${escapeXml(board.name)} / Margin</text>`;
  body += board.frames
    .map(
      (f) =>
        `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="9" fill="${escapeXml(f.color)}" opacity=".4"/><text x="${f.x + 14}" y="${f.y + 26}" font-size="11" fill="#66714f">${escapeXml(f.title)}</text>`,
    )
    .join("");
  for (const [index, r] of board.relationships.entries()) {
    const a = items.find((p) => p.id === r.from),
      b = items.find((p) => p.id === r.to);
    if (!a || !b) continue;
    const dx = b.x + b.w / 2 - a.x - a.w / 2;
    const dy = b.y + b.h / 2 - a.y - a.h / 2;
    const edge = (p, vx, vy) => {
      if (!vx && !vy) vx = 1;
      const t = Math.min(vx ? p.w / 2 / Math.abs(vx) : Infinity, vy ? p.h / 2 / Math.abs(vy) : Infinity);
      return { x: p.x + p.w / 2 + vx * t, y: p.y + p.h / 2 + vy * t };
    };
    const start = edge(a, dx, dy), end = edge(b, -dx, -dy);
    const label = `${r.type}${r.label ? ' / ' + r.label : ''}`;
    body += `<g><title>${escapeXml(label)}</title><path d="M${start.x},${start.y} L${end.x},${end.y}" fill="none" stroke="#8f9d75" ${r.directed ? 'marker-end="url(#arrow)"' : ""}/></g>`;
    connectionMarkers += `<g><title>${escapeXml(label)}</title><circle cx="${(start.x + end.x) / 2}" cy="${(start.y + end.y) / 2}" r="9" fill="#f8f9f1" stroke="#a3b18c"/><text x="${(start.x + end.x) / 2}" y="${(start.y + end.y) / 2 + 3}" text-anchor="middle" font-size="9" fill="#64734a">${index + 1}</text></g>`;
  }
  for (const p of board.placements) {
    const result = resolvePlacement(workspace, p);
    const title = p.kind === "note" ? "Working note" : result.title;
    const text = ["missing", "trashed"].includes(result.state)
      ? `${result.state.toUpperCase()} SOURCE - open the workspace to restore.`
      : result.blocks.map((b) => b.text).join(" ");
    const rows = lines(text, Math.floor((p.w - 32) / 6.6)).slice(
      0,
      Math.max(1, Math.floor((p.h - 100) / 17)),
    );
    const titleRows = lines(title, Math.floor((p.w - 32) / 10)).slice(0, 2);
    body += `<g><title>${escapeXml(title + "\n" + text)}</title><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="${p.kind === "note" ? "#faf3cd" : "#fffefa"}" stroke="#d6ddca"/><text x="${p.x + 16}" y="${p.y + 20}" font-size="9" fill="#829069">${escapeXml(p.kind.toUpperCase() + (result.state === "frozen" ? " / " + p.capturedAt : result.state === "live" && p.kind === "excerpt" ? " / LIVE SOURCE" : ""))}</text>`;
    body += titleRows
      .map(
        (line, i) =>
          `<text x="${p.x + 16}" y="${p.y + 43 + i * 23}" font-family="Georgia,serif" font-size="20" fill="#35432d">${escapeXml(line)}</text>`,
      )
      .join("");
    if (p.kind === "image") {
      const asset = workspace.assets.find((a) => a.id === p.assetId);
      if (asset)
        body += `<image x="${p.x + 12}" y="${p.y + 60}" width="${p.w - 24}" height="${p.h - 72}" href="${escapeXml(asset.data)}"/>`;
    } else
      body += rows
        .map(
          (line, i) =>
            `<text x="${p.x + 16}" y="${p.y + 55 + titleRows.length * 23 + i * 17}" font-size="11" fill="#6c735f">${escapeXml(line)}</text>`,
        )
        .join("");
    body += "</g>";
  }
  body += connectionMarkers;
  if (relationshipKey.length) {
    body += `<text x="${minX + 30}" y="${keyTop + 24}" font-family="Georgia,serif" font-size="19" fill="#4a5e38">Follow the thread / Relationship key</text>`;
    let rowY = keyTop + 49;
    for (const [index, rows] of relationshipKey.entries()) {
      body += `<text x="${minX + 30}" y="${rowY}" font-size="11" fill="#64734a">${index + 1}.</text><text x="${minX + 52}" y="${rowY}" font-size="11" fill="#64734a">${rows.map((line, i) => `<tspan x="${minX + 52}" dy="${i ? 16 : 0}">${i ? ' ' : ''}${escapeXml(line)}</tspan>`).join('')}</text>`;
      rowY += rows.length * 16 + 10;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" font-family="Arial,sans-serif"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="#8f9d75"/></marker></defs>${body}</svg>`;
}

function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  const priorFocus = useRef(document.activeElement);
  useEffect(() => {
    ref.current.showModal();
    ref.current
      .querySelector(
        '[autofocus], input:not([type="hidden"]), textarea, select',
      )
      ?.focus();
    return () => {
      priorFocus.current?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function Highlight({ text, query }) {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const pattern = new RegExp(
    `(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "ig",
  );
  return text
    .split(pattern)
    .map((part, index) =>
      words.some((w) => w.toLowerCase() === part.toLowerCase()) ? (
        <mark key={index}>{part}</mark>
      ) : (
        part
      ),
    );
}

function snippet(text, query) {
  const index = Math.max(
    0,
    text.toLowerCase().indexOf(query.trim().split(/\s+/)[0]?.toLowerCase()) -
      55,
  );
  return (
    (index ? "... " : "") +
    text.slice(index, index + 210) +
    (text.length > index + 210 ? " ..." : "")
  );
}

export default function App() {
  const [initial] = useState(initialWorkspace);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [boardId, setBoardId] = useState(workspace.boards[0]?.id);
  const [documentView, setDocumentView] = useState(null);
  const [view, setView] = useState("board");
  const [selection, setSelection] = useState([]);
  const [relationshipId, setRelationshipId] = useState(null);
  const [tool, setTool] = useState("select");
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [relationshipFilter, setRelationshipFilter] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("");
  const [saveState, setSaveState] = useState(
    initial.error ? "error" : "saving",
  );
  const [error, setError] = useState(initial.error);
  const [toast, setToast] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [workspaceList, setWorkspaceList] = useState([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const histories = useRef(new Map());
  const lastText = useRef({ key: "", time: 0 });
  const navigation = useRef([]);
  const canvas = useRef(null);
  const fileInput = useRef(null);
  const packageInput = useRef(null);
  const saveBlocked = useRef(Boolean(initial.error));
  const board =
    workspace.boards.find((b) => b.id === boardId) || workspace.boards[0];
  const currentDocument = workspace.documents.find(
    (d) => d.id === documentView?.id,
  );
  const deferredQuery = useDeferredValue(query);
  const results =
    modal?.kind === "search"
      ? search(workspace, deferredQuery, { tag: tagFilter, type: typeFilter })
      : [];
  const tags = [
    ...new Set(
      workspace.documents
        .filter((d) => d.status === "active")
        .flatMap((d) => d.tags),
    ),
  ].sort();
  const historyKey = documentView
    ? `document:${documentView.id}`
    : `board:${board?.id}`;
  const activeHistory = histories.current.get(historyKey);
  const chosen =
    board?.placements.filter((p) => selection.includes(p.id)) || [];
  const relationship = board?.relationships.find(
    (r) => r.id === relationshipId,
  );
  const titleOf = (p) =>
    p?.documentId
      ? workspace.documents.find((d) => d.id === p.documentId)?.title ||
        "Missing source"
      : p?.text?.split("\n")[0] || p?.title || "Untitled";

  useEffect(() => {
    if (saveBlocked.current) return;
    setSaveState("saving");
    const timer = setTimeout(() => {
      if (workspaceRef.current !== workspace) return;
      try {
        new WorkspaceStore().save(workspace);
        localStorage.setItem("margin:active", workspace.id);
        setSaveState("saved");
        setError("");
      } catch (failure) {
        setSaveState("error");
        setError(
          `Not saved: ${failure.message}. Your current work is still here. Export a package before leaving.`,
        );
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [workspace]);

  useEffect(() => {
    const beforeUnload = (event) => {
      if (saveBlocked.current) return;
      try {
        new WorkspaceStore().save(workspaceRef.current);
      } catch {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  function getHistory(key) {
    if (!histories.current.has(key))
      histories.current.set(key, new History(60));
    return histories.current.get(key);
  }

  function commit(next, options = {}) {
    const previous = workspaceRef.current;
    if (options.scope) {
      const key = `${options.scope}:${options.id}`;
      const source =
        options.scope === "document"
          ? previous.documents.find((d) => d.id === options.id)
          : previous.boards.find((b) => b.id === options.id);
      const currentTime = performance.now();
      if (
        source &&
        !(
          options.coalesce &&
          lastText.current.key === key &&
          currentTime - lastText.current.time < 900
        )
      ) {
        getHistory(key).push(
          options.scope === "board"
            ? { board: source, selection: [...selection] }
            : source,
        );
      }
      lastText.current = {
        key: options.coalesce ? key : "",
        time: currentTime,
      };
      setHistoryVersion((n) => n + 1);
    }
    workspaceRef.current = next;
    setWorkspace(next);
  }

  function updateBoard(nextBoard, history = true) {
    commit(
      {
        ...workspaceRef.current,
        boards: workspaceRef.current.boards.map((b) =>
          b.id === nextBoard.id ? nextBoard : b,
        ),
      },
      history ? { scope: "board", id: nextBoard.id } : {},
    );
  }

  function undo(redo = false) {
    const key = documentView
      ? `document:${documentView.id}`
      : `board:${board?.id}`;
    const history = histories.current.get(key);
    if (!history || !(redo ? history.canRedo : history.canUndo)) return;
    const w = workspaceRef.current;
    if (documentView) {
      const current = w.documents.find((d) => d.id === documentView.id);
      const restored = history[redo ? "redo" : "undo"](current);
      // New references created after a text operation remain recoverable through tombstones.
      const retainedIds = new Set(
        [...restored.blocks, ...restored.deletedBlocks].map((b) => b.id),
      );
      for (const [i, block] of current.blocks.entries())
        if (!retainedIds.has(block.id))
          restored.deletedBlocks.push({ ...block, originalIndex: i });
      for (const block of current.deletedBlocks)
        if (
          !retainedIds.has(block.id) &&
          !restored.deletedBlocks.some((b) => b.id === block.id)
        )
          restored.deletedBlocks.push(block);
      commit({
        ...w,
        documents: w.documents.map((d) => (d.id === current.id ? restored : d)),
      });
    } else {
      const current = w.boards.find((b) => b.id === board.id);
      const result = history[redo ? "redo" : "undo"]({
        board: current,
        selection,
      });
      updateBoard({ ...result.board, camera: current.camera }, false);
      setSelection(
        result.selection.filter((key) =>
          [...result.board.placements, ...result.board.frames].some(
            (p) => p.id === key,
          ),
        ),
      );
      setRelationshipId(null);
    }
    lastText.current = { key: "", time: 0 };
    setHistoryVersion((n) => n + 1);
  }

  function pushNavigation() {
    navigation.current.push({
      boardId: board?.id,
      camera: board?.camera,
      documentView,
      view,
      selection,
      scroll: document.querySelector(".editor-scroll")?.scrollTop || 0,
    });
    if (navigation.current.length > 80) navigation.current.shift();
  }

  function goBack() {
    const previous = navigation.current.pop();
    if (!previous) {
      setDocumentView(null);
      setView("board");
      return;
    }
    setBoardId(previous.boardId);
    setDocumentView(previous.documentView);
    setView(previous.view);
    setSelection(previous.selection);
    setRelationshipId(null);
    const b = workspaceRef.current.boards.find(
      (item) => item.id === previous.boardId,
    );
    if (b && previous.camera)
      updateBoard({ ...b, camera: previous.camera }, false);
    requestAnimationFrame(() => {
      const el = document.querySelector(".editor-scroll");
      if (el) el.scrollTop = previous.scroll;
    });
  }

  function openDocument(docId, blockId) {
    pushNavigation();
    setDocumentView({ id: docId, blockId: blockId || null, key: id("visit") });
    setModal(null);
    setSideOpen(false);
    setChooser(false);
  }

  function switchBoard(nextId, placementId) {
    pushNavigation();
    setBoardId(nextId);
    setView("board");
    setDocumentView(null);
    setRelationshipId(null);
    setSideOpen(false);
    setSelection(placementId ? [placementId] : []);
    if (placementId) {
      const b = workspaceRef.current.boards.find((item) => item.id === nextId);
      const p = b?.placements.find((item) => item.id === placementId);
      const size = canvas.current?.getSize() || {
        width: window.innerWidth - 230,
        height: window.innerHeight - 190,
      };
      if (p)
        updateBoard(
          { ...b, camera: fitCamera([p], size.width, size.height, 120) },
          false,
        );
    }
  }

  function openPlacement(p) {
    if (p.documentId) openDocument(p.documentId, p.blockIds?.[0]);
    else if (p.kind === "note")
      setModal({ kind: "note", placementId: p.id, text: p.text });
    else if (p.kind === "image")
      setModal({ kind: "asset", assetId: p.assetId });
  }

  function switchWorkspace(next, isNew = false) {
    try {
      if (!saveBlocked.current) new WorkspaceStore().save(workspaceRef.current);
      if (isNew) new WorkspaceStore().save(next);
      localStorage.setItem("margin:active", next.id);
      saveBlocked.current = false;
      histories.current.clear();
      navigation.current = [];
      commit(next);
      setBoardId(next.boards[0]?.id);
      setDocumentView(null);
      setView("board");
      setSelection([]);
      setRelationshipId(null);
      setModal(null);
      setChooser(false);
      setSideOpen(false);
      setError("");
      return true;
    } catch (failure) {
      setError(
        `Workspace was not switched: ${failure.message}. Current work is unchanged.`,
      );
      setSaveState("error");
      return false;
    }
  }

  function positionOn(b) {
    const size = canvas.current?.getSize() || { width: 900, height: 650 };
    let x = Math.round((size.width / 2 - b.camera.x) / b.camera.zoom - 160);
    let y = Math.round((size.height / 2 - b.camera.y) / b.camera.zoom - 130);
    for (
      let i = 0;
      i < 100 &&
      b.placements.some(
        (p) => Math.abs(p.x - x) < 80 && Math.abs(p.y - y) < 80,
      );
      i++
    ) {
      x += 38;
      y += 38;
    }
    return { x, y, w: 330, h: 280 };
  }

  function placeDocument(docId, targetBoardId) {
    const w = workspaceRef.current;
    const b = w.boards.find((item) => item.id === targetBoardId);
    if (!b) return;
    const p = {
      id: id("placement"),
      kind: "document",
      documentId: docId,
      ...positionOn(b),
    };
    updateBoard({ ...b, placements: [...b.placements, p] });
    setModal(null);
    setToast("Document placed. One source, another point of view.");
    if (!documentView && b.id === board?.id) setSelection([p.id]);
  }

  function createDocument(title) {
    const now = stamp();
    const doc = {
      id: id("document"),
      title: title.trim() || "Untitled document",
      summary: "",
      tags: [],
      blocks: [{ id: id("block"), type: "paragraph", text: "" }],
      deletedBlocks: [],
      status: "active",
      provenance: { type: "authored" },
      createdAt: now,
      updatedAt: now,
    };
    const w = workspaceRef.current;
    let b = board || emptyBoard("My first board");
    const p = {
      id: id("placement"),
      kind: "document",
      documentId: doc.id,
      ...positionOn(b),
    };
    const next = {
      ...w,
      documents: [...w.documents, doc],
      boards: board
        ? w.boards.map((item) =>
            item.id === b.id
              ? { ...b, placements: [...b.placements, p] }
              : item,
          )
        : [{ ...b, placements: [p] }],
    };
    commit(next, board ? { scope: "board", id: b.id } : {});
    setBoardId(b.id);
    setSelection([p.id]);
    openDocument(doc.id, doc.blocks[0].id);
  }

  function removePlacements() {
    if (!board || !selection.length) return;
    updateBoard({
      ...board,
      placements: board.placements.filter((p) => !selection.includes(p.id)),
      frames: board.frames.filter((f) => !selection.includes(f.id)),
      relationships: board.relationships.filter(
        (r) => !selection.includes(r.from) && !selection.includes(r.to),
      ),
    });
    setSelection([]);
    setRelationshipId(null);
    setToast("Removed from this board. Canonical documents are untouched.");
  }

  function arrange(alignment = false) {
    if (!board || chosen.length < 2) {
      setToast(
        "Select two or more cards with Shift-click, or drag a selection on empty canvas.",
      );
      return;
    }
    const sorted = [...chosen].sort((a, b) => a.y - b.y || a.x - b.x);
    const x = Math.min(...chosen.map((p) => p.x)),
      y = Math.min(...chosen.map((p) => p.y));
    const columns = Math.ceil(Math.sqrt(sorted.length));
    const cellW = Math.max(...chosen.map((p) => p.w)) + 65,
      cellH = Math.max(...chosen.map((p) => p.h)) + 65;
    const positions = new Map(
      sorted.map((p, i) => [
        p.id,
        alignment
          ? { x }
          : {
              x: x + (i % columns) * cellW,
              y: y + Math.floor(i / columns) * cellH,
            },
      ]),
    );
    updateBoard({
      ...board,
      placements: board.placements.map((p) =>
        positions.has(p.id) ? { ...p, ...positions.get(p.id) } : p,
      ),
    });
    setToast(
      alignment
        ? "Left edges aligned. Undo anytime."
        : "Arranged in a reading-order grid. No content or relationships changed.",
    );
  }

  function newAction(kind) {
    if (kind === "arrange") return arrange();
    if (kind === "image") {
      fileInput.current.accept = "image/png,image/jpeg,image/gif,image/webp";
      fileInput.current.click();
      return;
    }
    if (kind === "frame" && !chosen.length) {
      setToast("Select cards first, then give their frame a name.");
      return;
    }
    setModal({ kind: kind === "place" ? "place" : kind });
  }

  function updateStatus(docId, status) {
    commit(setDocumentStatus(workspaceRef.current, docId, status), {
      scope: "document",
      id: docId,
    });
    setToast(
      status === "active"
        ? "Document restored. Live references are available again."
        : status === "archived"
          ? "Archived. Removed from search; placements remain labeled."
          : "Moved to trash. Source references are retained for restore.",
    );
  }

  async function importFiles(files, asPackage) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    const startedWorkspaceId = workspaceRef.current.id;
    try {
      const parsed = [];
      for (const file of selectedFiles) {
        if (file.size > (asPackage ? 25 : 4) * 1024 * 1024)
          throw new Error(
            `File exceeds the ${asPackage ? 25 : 4} MiB import limit.`,
          );
        if (asPackage) {
          const next = validateWorkspace(JSON.parse(await file.text()));
          next.id = id("workspace");
          next.name = `${next.name.slice(0, 950)} (imported)`;
          validateWorkspace(next);
          if (workspaceRef.current.id !== startedWorkspaceId)
            throw new Error("Workspace changed during import. Please retry.");
          if (switchWorkspace(next, true))
            setToast(
              "Package opened as an isolated workspace. Your previous workspace is still available.",
            );
          return;
        }
        if (
          ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
            file.type,
          )
        ) {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Could not read image"));
            reader.readAsDataURL(file);
          });
          parsed.push({
            asset: { id: id("asset"), name: file.name, mime: file.type, data },
          });
        } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(
            await file.arrayBuffer(),
          );
          parsed.push({ doc: parseMarkdown(text, file.name) });
        } else
          throw new Error(
            "Supported imports: UTF-8 .md/.txt and PNG, JPEG, GIF or WebP images.",
          );
      }
      if (workspaceRef.current.id !== startedWorkspaceId)
        throw new Error("Workspace changed during import. Please retry.");
      const w = workspaceRef.current;
      const next = change(w, (draft) => {
        let b = draft.boards.find((item) => item.id === board?.id);
        if (!b) {
          b = emptyBoard("My first board");
          draft.boards.push(b);
        }
        for (const item of parsed) {
          if (item.asset) {
            draft.assets.push(item.asset);
            const doc = parseMarkdown("", item.asset.name);
            doc.provenance = {
              type: "image",
              filename: item.asset.name,
              importedAt: stamp(),
            };
            doc.blocks.push({
              id: id("block"),
              type: "image",
              text: item.asset.name,
              assetId: item.asset.id,
            });
            draft.documents.push(doc);
            b.placements.push({
              id: id("placement"),
              kind: "image",
              assetId: item.asset.id,
              text: item.asset.name,
              ...positionOn(b),
            });
          } else {
            draft.documents.push(item.doc);
            b.placements.push({
              id: id("placement"),
              kind: "document",
              documentId: item.doc.id,
              ...positionOn(b),
            });
          }
        }
      });
      validateWorkspace(next);
      // Validate and persist the complete transaction before publishing any imported objects.
      new WorkspaceStore().save(next);
      commit(next, board ? { scope: "board", id: board.id } : {});
      setBoardId(board?.id || next.boards[0].id);
      setModal(null);
      setToast(
        `Imported ${parsed.length} ${parsed.length === 1 ? "file" : "files"}. Originals are now local, editable workspace content.`,
      );
    } catch (failure) {
      setError(`Import was not applied: ${failure.message}`);
      setToast(
        "Import rejected. Your current workspace has not been replaced.",
      );
    }
  }

  function exportWorkspace() {
    try {
      saveFile(
        `${workspace.name}.margin.json`,
        exportPackage(workspaceRef.current),
      );
      setToast("Self-contained workspace package exported.");
    } catch (failure) {
      setError(`Export failed: ${failure.message}`);
    }
  }

  useEffect(() => {
    const key = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "k" && !event.shiftKey) {
        event.preventDefault();
        setQuery("");
        setModal({ kind: "search" });
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
        return;
      }
      if (editable(event.target) || modal || documentView) return;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo(event.shiftKey);
      }
      if (mod && event.key.toLowerCase() === "a" && view === "board") {
        event.preventDefault();
        setSelection(board?.placements.map((p) => p.id) || []);
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removePlacements();
      }
      if (event.key === "Escape") {
        setSelection([]);
        setRelationshipId(null);
        setTool("select");
      }
      if (event.key.toLowerCase() === "n" && !mod) {
        event.preventDefault();
        newAction("document");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  function handleDialogSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "").trim();
    if (modal.kind === "document") return createDocument(name);
    if (modal.kind === "new-workspace") {
      const next = blankWorkspace(name || "Untitled workspace");
      next.boards.push(emptyBoard("My first board"));
      switchWorkspace(next, true);
      return;
    }
    if (modal.kind === "board") {
      const b = emptyBoard(name || "Untitled board");
      commit({
        ...workspaceRef.current,
        boards: [...workspaceRef.current.boards, b],
      });
      switchBoard(b.id);
    }
    if (modal.kind === "rename-board")
      updateBoard({ ...board, name: name || board.name });
    if (modal.kind === "note") {
      const text = String(data.get("text") || "");
      const p = {
        id: id("placement"),
        kind: "note",
        text,
        ...positionOn(board),
        w: 280,
        h: 235,
      };
      updateBoard({
        ...board,
        placements: modal.placementId
          ? board.placements.map((p) =>
              p.id === modal.placementId ? { ...p, text } : p,
            )
          : [...board.placements, p],
      });
      if (!modal.placementId) setSelection([p.id]);
    }
    if (modal.kind === "frame") {
      const x = Math.min(...chosen.map((p) => p.x)) - 25,
        y = Math.min(...chosen.map((p) => p.y)) - 50;
      updateBoard({
        ...board,
        frames: [
          ...board.frames,
          {
            id: id("frame"),
            title: name || "New cluster",
            x,
            y,
            w: Math.max(...chosen.map((p) => p.x + p.w)) - x + 25,
            h: Math.max(...chosen.map((p) => p.y + p.h)) - y + 25,
            color: "#e2e7d9",
          },
        ],
      });
    }
    if (modal.kind === "pin") {
      const b = workspaceRef.current.boards.find(
        (item) => item.id === data.get("board"),
      );
      const doc = workspaceRef.current.documents.find(
        (d) => d.id === modal.documentId,
      );
      const blocks = modal.blockIds
        .map((key) => doc.blocks.find((b) => b.id === key))
        .filter(Boolean);
      if (!blocks.length) {
        setToast("Select a live source block before pinning.");
        return;
      }
      const p = {
        id: id("placement"),
        kind: modal.frozen ? "frozen" : "excerpt",
        documentId: doc.id,
        blockIds: blocks.map((b) => b.id),
        ...positionOn(b),
        w: 305,
        h: 235,
      };
      if (modal.frozen) {
        p.snapshot = structuredClone(blocks);
        p.capturedAt = stamp();
        p.text = doc.title;
      }
      updateBoard({ ...b, placements: [...b.placements, p] });
      setToast(
        `${modal.frozen ? "Timestamped frozen copy" : "Live excerpt"} pinned to ${b.name}.`,
      );
    }
    if (modal.kind === "place") {
      placeDocument(String(data.get("document")), String(data.get("board")));
      return;
    }
    if (modal.kind === "relationship") {
      const r = {
        id: id("relationship"),
        from: String(data.get("from")),
        to: String(data.get("to")),
        type: String(data.get("type")),
        label: String(data.get("label") || ""),
        directed: data.get("directed") === "on",
      };
      if (r.from === r.to) {
        setToast("Choose two different cards.");
        return;
      }
      updateBoard({ ...board, relationships: [...board.relationships, r] });
      setRelationshipId(r.id);
      setTool("select");
    }
    setModal(null);
  }

  function createInternalLink(targetDocId, targetBlockId) {
    const source = workspaceRef.current.documents.find(
      (d) => d.id === modal.documentId,
    );
    const target = workspaceRef.current.documents.find(
      (d) => d.id === targetDocId,
    );
    const next = change(workspaceRef.current, (draft) => {
      const doc = draft.documents.find((d) => d.id === source.id);
      const at = doc.blocks.findIndex((b) => b.id === modal.blockId);
      doc.blocks.splice(at < 0 ? doc.blocks.length : at + 1, 0, {
        id: id("block"),
        type: "link",
        text: targetBlockId
          ? `${target.title}: ${target.blocks.find((b) => b.id === targetBlockId)?.text.slice(0, 70) || "Source block"}`
          : target.title,
        target: {
          documentId: targetDocId,
          ...(targetBlockId ? { blockId: targetBlockId } : {}),
        },
      });
      doc.updatedAt = stamp();
    });
    commit(next, { scope: "document", id: source.id });
    setModal(null);
    setToast("Internal link added. Its backlink is now visible at the source.");
  }

  const activeDocuments = workspace.documents.filter(
    (d) => d.status === "active",
  );
  const excerptCount = workspace.boards.reduce(
    (sum, b) => sum + b.placements.filter((p) => p.kind === "excerpt").length,
    0,
  );
  const libraryDocuments = workspace.documents.filter(
    (d) =>
      (view === "trash" ? d.status !== "active" : d.status === "active") &&
      (!libraryFilter ||
        `${d.title} ${d.tags.join(" ")}`
          .toLowerCase()
          .includes(libraryFilter.toLowerCase())),
  );

  return (
    <div className={`app ${reducedMotion ? "reduce-motion" : ""}`}>
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        multiple
        aria-label="Import documents and images"
        accept=".md,.markdown,.txt,image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => {
          importFiles(event.target.files, false);
          event.target.value = "";
        }}
      />
      <input
        ref={packageInput}
        className="hidden"
        type="file"
        accept=".json"
        aria-label="Open workspace package"
        onChange={(event) => {
          importFiles(event.target.files, true);
          event.target.value = "";
        }}
      />
      {sideOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSideOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${sideOpen ? "sidebar-open" : ""}`}
        aria-label="Workspace navigation"
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setDocumentView(null);
            setView("board");
          }}
          aria-label="Margin home"
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            margin<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-switch-wrap">
          <button
            className="workspace-switch"
            aria-expanded={chooser}
            onClick={() => {
              try {
                setWorkspaceList(new WorkspaceStore().list());
              } catch (failure) {
                setError(failure.message);
              }
              setChooser(!chooser);
            }}
          >
            <span className="workspace-avatar">{workspace.name === 'The Common Ground' ? 'cg' : workspace.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toLowerCase()}</span>
            <span className="workspace-switch-text">
              <small>YOUR WORKSPACE</small>
              <strong>{workspace.name}</strong>
            </span>
            <ChevronDown size={13} />
          </button>
          {chooser && (
            <div className="workspace-menu">
              <div className="eyebrow">LOCAL WORKSPACES</div>
              {workspaceList.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    try {
                      const w = new WorkspaceStore().load(item.id);
                      if (w) switchWorkspace(w);
                    } catch (failure) {
                      setError(failure.message);
                    }
                  }}
                >
                  <FolderOpen size={15} />
                  <span>{item.name}</span>
                  {workspace.id === item.id && <Check size={14} />}
                </button>
              ))}
              <button
                onClick={() => {
                  setModal({ kind: "new-workspace" });
                  setChooser(false);
                }}
              >
                <Plus size={15} />
                New blank workspace
              </button>
              <button
                onClick={() => {
                  packageInput.current.click();
                  setChooser(false);
                }}
              >
                <Upload size={15} />
                Open workspace package
              </button>
            </div>
          )}
        </div>
        <nav className="main-nav">
          <button
            className="nav-item"
            onClick={() => {
              setQuery("");
              setModal({ kind: "search" });
            }}
          >
            <Search size={17} />
            <span>Search anything</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button
            className={`nav-item ${view === "library" && !documentView ? "nav-active" : ""}`}
            onClick={() => {
              pushNavigation();
              setView("library");
              setDocumentView(null);
              setSideOpen(false);
            }}
          >
            <FileText size={17} />
            <span>All documents</span>
            <span className="nav-count">{activeDocuments.length}</span>
          </button>
          <button
            className={`nav-item ${view === "excerpts" && !documentView ? "nav-active" : ""}`}
            onClick={() => {
              pushNavigation();
              setView("excerpts");
              setDocumentView(null);
              setSideOpen(false);
            }}
          >
            <Quote size={17} />
            <span>Live excerpts</span>
            <span className="nav-count">{excerptCount}</span>
          </button>
        </nav>
        <div className="sidebar-section">
          <span>YOUR BOARDS</span>
          <button
            className="icon-button"
            aria-label="New board"
            onClick={() => setModal({ kind: "board" })}
          >
            <Plus size={14} />
          </button>
        </div>
        <nav className="board-nav">
          {workspace.boards.map((item, index) => (
            <button
              className={`nav-item ${view === "board" && item.id === board?.id ? "nav-active" : ""}`}
              key={item.id}
              onClick={() => switchBoard(item.id)}
            >
              {index === 1 ? (
                <BookOpen size={17} />
              ) : index === 2 ? (
                <Layers size={17} />
              ) : (
                <Grid2X2 size={17} />
              )}
              <span>{item.name}</span>
              {item.id === board?.id && view === "board" && (
                <span className="active-dot" />
              )}
            </button>
          ))}
          <button
            className="nav-item add-board"
            onClick={() => setModal({ kind: "board" })}
          >
            <Plus size={16} />
            <span>Create a board</span>
          </button>
        </nav>
        <div className="sidebar-section tag-heading">
          <span>THREADS TO FOLLOW</span>
          <Tag size={12} />
        </div>
        <div className="sidebar-tags">
          {(workspace.id === "workspace-common-ground"
            ? ["belonging", "field notes", "principles", "prototypes"]
            : tags.slice(0, 5)
          ).map((tag, i) => (
            <button
              key={tag}
              onClick={() => {
                setTagFilter(tag);
                setQuery("");
                setModal({ kind: "search" });
              }}
            >
              <i
                style={{
                  background: ["#85906a", "#c4a984", "#b2a5b8", "#9faeaa"][
                    i % 4
                  ],
                }}
              />
              {tag}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-card-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>Your ideas. Your space.</strong>
              <p>Stored on this device. Just yours.</p>
            </div>
          </div>
          <button
            className="nav-item"
            onClick={() => {
              fileInput.current.accept =
                ".md,.markdown,.txt,image/png,image/jpeg,image/gif,image/webp";
              fileInput.current.click();
            }}
          >
            <Upload size={16} />
            <span>Import files</span>
            <ArrowUpRight size={13} />
          </button>
          <button
            className={`nav-item ${view === "trash" ? "nav-active" : ""}`}
            onClick={() => {
              setView("trash");
              setDocumentView(null);
              setSideOpen(false);
            }}
          >
            <Trash2 size={16} />
            <span>Archive & trash</span>
          </button>
          <div className="sidebar-foot">
            <button onClick={() => setModal({ kind: "help" })}>
              <CircleHelp size={16} />
              <span>A little guidance</span>
            </button>
            <span>v1.0</span>
          </div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSideOpen(true)}
            >
              <Menu size={19} />
            </button>
            <span className="breadcrumb-project">{workspace.name}</span>
            <ChevronRight size={13} />
            <span>
              {documentView
                ? "Document"
                : view === "board" || view === "connections"
                  ? board?.name || "Your boards"
                  : view === "library"
                    ? "All documents"
                    : view === "excerpts"
                      ? "Live excerpts"
                      : "Archive & trash"}
            </span>
          </div>
          <div className="topbar-actions">
            <button
              className={`save-indicator ${saveState}`}
              onClick={() => {
                if (saveState === "error") {
                  saveBlocked.current = false;
                  commit({ ...workspaceRef.current });
                }
              }}
              title={
                saveState === "error"
                  ? "Retry saving"
                  : "Autosaved only to this browser"
              }
            >
              <span />
              {saveState === "saved"
                ? "All changes saved"
                : saveState === "saving"
                  ? "Saving locally..."
                  : "Not saved - retry"}
            </button>
            <span className="topbar-divider" />
            <button
              className="button export-button"
              onClick={() => setModal({ kind: "export" })}
            >
              <ArrowDownToLine size={15} />
              Export
              <ChevronDown size={12} />
            </button>
            <span className="user-avatar" title="A private, local workspace">
              You
            </span>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={exportWorkspace}>Export recovery</button>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <div className="workspace-body">
          {(view === "board" || view === "connections") && (
            <>
              <section className="board-heading">
                <div>
                  <div className="eyebrow">A PLACE FOR CONNECTED THINKING</div>
                  <div className="board-title-row">
                    <h1>{board?.name || "A fresh perspective"}</h1>
                    <button
                      className="icon-button board-options"
                      aria-label="Board options"
                      onClick={() => setModal({ kind: "board-options" })}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </div>
                  <p>
                    {board?.description.split(". ")[0]}
                    {board?.description.includes(". ") ? "." : ""}
                  </p>
                </div>
                <div className="board-heading-actions">
                  <div className="view-switch">
                    <button
                      className={view === "board" ? "active" : ""}
                      onClick={() => setView("board")}
                    >
                      <Grid2X2 size={14} />
                      Canvas
                    </button>
                    <button
                      className={view === "connections" ? "active" : ""}
                      onClick={() => setView("connections")}
                    >
                      <Network size={15} />
                      Connections
                    </button>
                  </div>
                  <button
                    className="button button-primary new-document"
                    onClick={() => newAction("document")}
                  >
                    <Plus size={15} />
                    New document
                  </button>
                </div>
              </section>
              {view === "board" && board && (
                <div className="canvas-container">
                  <Canvas
                    ref={canvas}
                    key={board.id}
                    workspace={workspace}
                    board={board}
                    selection={selection}
                    onSelect={(ids) => {
                      setSelection(ids);
                      setRelationshipId(null);
                    }}
                    onBoardChange={updateBoard}
                    onCamera={(camera) =>
                      updateBoard(
                        {
                          ...workspaceRef.current.boards.find(
                            (b) => b.id === board.id,
                          ),
                          camera,
                        },
                        false,
                      )
                    }
                    onOpen={openPlacement}
                    onRelationship={(key) => {
                      setRelationshipId(key);
                      setSelection([]);
                    }}
                    tool={tool}
                    setTool={setTool}
                    onNew={newAction}
                    onConnect={(from, to) =>
                      setModal({ kind: "relationship", from, to })
                    }
                  />
                  <div className="canvas-topline">
                    <span className="board-context">
                      <span />
                      {workspace.id === "workspace-common-ground"
                        ? "AN ORIGINAL, FICTIONAL RESEARCH PROJECT"
                        : "YOUR LOCAL WORKSPACE"}
                    </span>
                    <div className="board-history">
                      <button
                        className="icon-button"
                        aria-label="Undo board operation"
                        disabled={
                          !histories.current.get(`board:${board.id}`)?.canUndo
                        }
                        onClick={() => undo()}
                      >
                        <Undo2 size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Redo board operation"
                        disabled={
                          !histories.current.get(`board:${board.id}`)?.canRedo
                        }
                        onClick={() => undo(true)}
                      >
                        <Redo2 size={15} />
                      </button>
                    </div>
                  </div>
                  {(selection.length > 0 || relationship) && (
                    <aside
                      className="inspector"
                      aria-label="Selection inspector"
                    >
                      <header>
                        <span className="eyebrow">
                          {relationship
                            ? "A CONNECTION"
                            : selection.length > 1
                              ? `${selection.length} SELECTED`
                              : "ON THIS BOARD"}
                        </span>
                        <button
                          className="icon-button"
                          aria-label="Close inspector"
                          onClick={() => {
                            setSelection([]);
                            setRelationshipId(null);
                          }}
                        >
                          <X size={15} />
                        </button>
                      </header>
                      {relationship ? (
                        <>
                          <h3>
                            {titleOf(
                              board.placements.find(
                                (p) => p.id === relationship.from,
                              ),
                            )}
                          </h3>
                          <div className="connection-direction">
                            {relationship.directed ? (
                              <ArrowDownToLine size={17} />
                            ) : (
                              <Link2 size={17} />
                            )}
                            <span>{relationship.type}</span>
                          </div>
                          <h3>
                            {titleOf(
                              board.placements.find(
                                (p) => p.id === relationship.to,
                              ),
                            )}
                          </h3>
                          <label>
                            Relationship type
                            <input
                              aria-label="Relationship type"
                              defaultValue={relationship.type}
                              key={`${relationship.id}-type`}
                              maxLength={100}
                              onBlur={(e) => {
                                if (e.target.value.trim())
                                  updateBoard({
                                    ...board,
                                    relationships: board.relationships.map(
                                      (r) =>
                                        r.id === relationship.id
                                          ? {
                                              ...r,
                                              type: e.target.value.trim(),
                                            }
                                          : r,
                                    ),
                                  });
                              }}
                            />
                          </label>
                          <label>
                            What connects them?
                            <textarea
                              aria-label="Relationship label"
                              key={`${relationship.id}-label`}
                              defaultValue={relationship.label}
                              maxLength={1000}
                              onBlur={(e) => {
                                if (e.target.value !== relationship.label)
                                  updateBoard({
                                    ...board,
                                    relationships: board.relationships.map(
                                      (r) =>
                                        r.id === relationship.id
                                          ? { ...r, label: e.target.value }
                                          : r,
                                    ),
                                  });
                              }}
                            />
                          </label>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={relationship.directed}
                              onChange={(e) =>
                                updateBoard({
                                  ...board,
                                  relationships: board.relationships.map((r) =>
                                    r.id === relationship.id
                                      ? { ...r, directed: e.target.checked }
                                      : r,
                                  ),
                                })
                              }
                            />
                            Directed connection
                          </label>
                          <button
                            className="button button-primary"
                            onClick={() => {
                              const p = board.placements.find(
                                (p) => p.id === relationship.to,
                              );
                              if (p) switchBoard(board.id, p.id);
                            }}
                          >
                            Follow connection
                            <ArrowRight size={14} />
                          </button>
                          <button
                            className="text-button danger"
                            onClick={() => {
                              updateBoard({
                                ...board,
                                relationships: board.relationships.filter(
                                  (r) => r.id !== relationship.id,
                                ),
                              });
                              setRelationshipId(null);
                            }}
                          >
                            Remove relationship
                          </button>
                        </>
                      ) : (
                        <>
                          <h3>
                            {chosen.length === 1
                              ? titleOf(chosen[0])
                              : `${selection.length} pieces of the picture`}
                          </h3>
                          {chosen.length === 1 && (
                            <>
                              <p className="inspector-caption">
                                {chosen[0].kind === "document"
                                  ? "A placement, not a copy. Changes to the source appear everywhere."
                                  : chosen[0].kind === "excerpt"
                                    ? "A live window into a stable source block."
                                    : chosen[0].kind === "frozen"
                                      ? `Frozen ${new Date(chosen[0].capturedAt).toLocaleString()}. Not a live excerpt.`
                                      : "Position and size belong to this board."}
                              </p>
                              <button
                                className="button button-primary"
                                onClick={() => openPlacement(chosen[0])}
                              >
                                {chosen[0].documentId
                                  ? "Open source"
                                  : "Open card"}
                                <ArrowUpRight size={14} />
                              </button>
                            </>
                          )}
                          <button
                            className="inspector-action"
                            onClick={() => canvas.current?.fit(selection)}
                          >
                            <Frame size={15} />
                            Fit selection<kbd>F</kbd>
                          </button>
                          <button
                            className="inspector-action"
                            onClick={() => {
                              const copies = chosen.map((p) => ({
                                ...structuredClone(p),
                                id: id("placement"),
                                x: p.x + 45,
                                y: p.y + 45,
                              }));
                              updateBoard({
                                ...board,
                                placements: [...board.placements, ...copies],
                              });
                              setSelection(copies.map((p) => p.id));
                            }}
                            disabled={!chosen.length}
                          >
                            <Copy size={15} />
                            Duplicate placement
                          </button>
                          {chosen.length === 1 && chosen[0].documentId && (
                            <button
                              className="inspector-action"
                              onClick={() =>
                                setModal({
                                  kind: "place",
                                  documentId: chosen[0].documentId,
                                })
                              }
                            >
                              <Layers size={15} />
                              Place on another board
                            </button>
                          )}
                          {chosen.length >= 2 && (
                            <>
                              <button
                                className="inspector-action"
                                onClick={() =>
                                  setModal({
                                    kind: "relationship",
                                    from: chosen[0].id,
                                    to: chosen[1].id,
                                  })
                                }
                              >
                                <Link2 size={15} />
                                Connect selected cards
                              </button>
                              <button
                                className="inspector-action"
                                onClick={() => arrange()}
                              >
                                <Grid2X2 size={15} />
                                Arrange in a grid
                              </button>
                              <button
                                className="inspector-action"
                                onClick={() => arrange(true)}
                              >
                                <PanelLeftClose size={15} />
                                Align left edges
                              </button>
                              <button
                                className="inspector-action"
                                onClick={() => newAction("frame")}
                              >
                                <Frame size={15} />
                                Group in named frame
                              </button>
                            </>
                          )}
                          {chosen.length === 1 &&
                            board.relationships.filter(
                              (r) =>
                                r.from === chosen[0].id ||
                                r.to === chosen[0].id,
                            ).length > 0 && (
                              <div className="inspector-connections">
                                <span className="eyebrow">
                                  FOLLOW THE THREAD
                                </span>
                                {board.relationships
                                  .filter(
                                    (r) =>
                                      r.from === chosen[0].id ||
                                      r.to === chosen[0].id,
                                  )
                                  .map((r) => (
                                    <button
                                      key={r.id}
                                      onClick={() => {
                                        setRelationshipId(r.id);
                                        setSelection([]);
                                      }}
                                    >
                                      <span>{r.type}</span>
                                      <ArrowRight size={13} />
                                      <strong>
                                        {titleOf(
                                          board.placements.find(
                                            (p) =>
                                              p.id ===
                                              (r.from === chosen[0].id
                                                ? r.to
                                                : r.from),
                                          ),
                                        )}
                                      </strong>
                                    </button>
                                  ))}
                              </div>
                            )}
                          <button
                            className="inspector-action danger remove-placement"
                            onClick={removePlacements}
                          >
                            <Trash2 size={15} />
                            Remove placement{selection.length > 1 ? "s" : ""}
                          </button>
                          <p className="inspector-footnote">
                            Documents remain in All documents.
                          </p>
                        </>
                      )}
                    </aside>
                  )}
                </div>
              )}
              {view === "connections" && board && (
                <section className="connections-view">
                  <div className="section-toolbar">
                    <p>
                      Authored relationships, with their reasons kept in view.
                    </p>
                    <select
                      aria-label="Filter relationships"
                      value={relationshipFilter}
                      onChange={(e) => setRelationshipFilter(e.target.value)}
                    >
                      <option value="">All relationship types</option>
                      {[...new Set(board.relationships.map((r) => r.type))]
                        .sort()
                        .map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                    </select>
                    <button
                      className="button"
                      disabled={board.placements.length < 2}
                      onClick={() =>
                        setModal({
                          kind: "relationship",
                          from: board.placements[0]?.id,
                          to: board.placements[1]?.id,
                        })
                      }
                    >
                      <Plus size={14} />
                      Add relationship
                    </button>
                  </div>
                  {board.relationships
                    .filter(
                      (r) =>
                        !relationshipFilter || r.type === relationshipFilter,
                    )
                    .map((r) => (
                      <article className="relationship-row" key={r.id}>
                        <button onClick={() => switchBoard(board.id, r.from)}>
                          <FileText size={17} />
                          {titleOf(
                            board.placements.find((p) => p.id === r.from),
                          )}
                        </button>
                        <div>
                          <span>
                            {r.type}
                            {r.directed ? (
                              <ArrowRight size={14} />
                            ) : (
                              <Link2 size={14} />
                            )}
                          </span>
                          <p>{r.label}</p>
                        </div>
                        <button onClick={() => switchBoard(board.id, r.to)}>
                          <FileText size={17} />
                          {titleOf(board.placements.find((p) => p.id === r.to))}
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Inspect ${r.label || r.type}`}
                          onClick={() => {
                            setView("board");
                            setRelationshipId(r.id);
                            setSelection([]);
                          }}
                        >
                          <Settings2 size={17} />
                        </button>
                      </article>
                    ))}
                  {!board.relationships.length && (
                    <div className="empty-library">
                      <Link2 size={30} />
                      <h2>One thought leads to another.</h2>
                      <p>
                        Place two cards, then connect them with a relationship
                        of your own.
                      </p>
                    </div>
                  )}
                </section>
              )}
              {!board && (
                <section className="empty-library">
                  <Layers size={34} />
                  <h2>A little space to begin.</h2>
                  <button
                    className="button button-primary"
                    onClick={() => setModal({ kind: "board" })}
                  >
                    <Plus size={15} />
                    Create your first board
                  </button>
                </section>
              )}
            </>
          )}

          {(view === "library" || view === "trash") && (
            <section className="library-view">
              <div className="library-heading">
                <div className="eyebrow">THE SOURCE OF IT ALL</div>
                <h1>
                  {view === "trash"
                    ? "Nothing lost. Just set aside."
                    : "Your library of ideas."}
                </h1>
                <p>
                  {view === "trash"
                    ? "Archived and trashed documents keep their identity. Restore them and their connections come back."
                    : "Every document has one home here, and as many places on the canvas as it needs."}
                </p>
              </div>
              <div className="section-toolbar">
                <div className="filter-input">
                  <Search size={16} />
                  <input
                    aria-label="Filter library"
                    placeholder="Find a document or tag..."
                    value={libraryFilter}
                    onChange={(e) => setLibraryFilter(e.target.value)}
                  />
                </div>
                <span className="muted">
                  {libraryDocuments.length} documents
                </span>
                <button
                  className="button button-primary"
                  onClick={() => newAction("document")}
                >
                  <Plus size={15} />
                  New document
                </button>
              </div>
              <div className="library-grid">
                {libraryDocuments.map((doc) => (
                  <article className="library-card" key={doc.id}>
                    <div className="library-card-top">
                      <FileText size={18} />
                      <span>
                        {doc.status === "active"
                          ? `${doc.blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0)} words`
                          : doc.status}
                      </span>
                      <details className="document-menu">
                        <summary aria-label={`Actions for ${doc.title}`}>
                          <MoreHorizontal size={18} />
                        </summary>
                        <div>
                          <button
                            onClick={() =>
                              setModal({ kind: "place", documentId: doc.id })
                            }
                          >
                            Place on a board
                          </button>
                          <button
                            onClick={() => {
                              const copy = structuredClone(doc);
                              copy.id = id("document");
                              copy.title += " (copy)";
                              const ids = new Map(
                                [...copy.blocks, ...copy.deletedBlocks].map(
                                  (b) => [b.id, id("block")],
                                ),
                              );
                              [...copy.blocks, ...copy.deletedBlocks].forEach(
                                (b) => {
                                  b.id = ids.get(b.id);
                                  if (b.target?.documentId === doc.id) {
                                    b.target.documentId = copy.id;
                                    if (b.target.blockId)
                                      b.target.blockId = ids.get(
                                        b.target.blockId,
                                      );
                                  }
                                },
                              );
                              commit({
                                ...workspaceRef.current,
                                documents: [
                                  ...workspaceRef.current.documents,
                                  copy,
                                ],
                              });
                              openDocument(copy.id);
                            }}
                          >
                            Duplicate document
                          </button>
                          <button
                            onClick={() =>
                              updateStatus(
                                doc.id,
                                doc.status === "active" ? "archived" : "active",
                              )
                            }
                          >
                            {doc.status === "active"
                              ? "Archive document"
                              : "Restore document"}
                          </button>
                          <button
                            className="danger"
                            onClick={() => updateStatus(doc.id, "trashed")}
                          >
                            Move document to trash
                          </button>
                        </div>
                      </details>
                    </div>
                    <button
                      className="library-card-body"
                      onClick={() => openDocument(doc.id)}
                    >
                      <h2>{doc.title || "Untitled document"}</h2>
                      <p>
                        {doc.summary ||
                          doc.blocks
                            .find((b) => b.type === "paragraph")
                            ?.text.slice(0, 160) ||
                          "A blank page, ready for a thought."}
                      </p>
                    </button>
                    <footer>
                      {doc.tags.slice(0, 3).map((tag) => (
                        <span className="tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                      {doc.status !== "active" && (
                        <button
                          className="text-button"
                          onClick={() => updateStatus(doc.id, "active")}
                        >
                          <RotateCcw size={13} />
                          Restore
                        </button>
                      )}
                    </footer>
                  </article>
                ))}
              </div>
              {!libraryDocuments.length && (
                <div className="empty-library">
                  <BookOpen size={34} />
                  <h2>
                    {view === "trash"
                      ? "Everything is in its place."
                      : "The first page is yours."}
                  </h2>
                  <p>
                    {view === "trash"
                      ? "No archived or trashed documents match this filter."
                      : "Create a document or import Markdown to start your collection."}
                  </p>
                </div>
              )}
              {view === "library" && workspace.assets.length > 0 && (
                <section className="asset-library">
                  <h2>Reusable images</h2>
                  <div>
                    {workspace.assets.map((asset) => (
                      <button
                        key={asset.id}
                        onClick={() =>
                          setModal({ kind: "asset", assetId: asset.id })
                        }
                      >
                        <img src={asset.data} alt={asset.name} />
                        <span>{asset.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </section>
          )}

          {view === "excerpts" && (
            <section className="library-view">
              <div className="library-heading">
                <div className="eyebrow">WORDS WORTH KEEPING CLOSE</div>
                <h1>Live from the source.</h1>
                <p>
                  Not copied quotations. These passages stay connected to the
                  documents they came from.
                </p>
              </div>
              <div className="excerpt-library">
                {workspace.boards.flatMap((b) =>
                  b.placements
                    .filter((p) => p.kind === "excerpt")
                    .map((p) => {
                      const resolved = resolvePlacement(workspace, p);
                      return (
                        <article key={p.id}>
                          <div>
                            <Quote size={20} />
                            <span
                              className={`tag ${resolved.state !== "live" ? "tag-warning" : ""}`}
                            >
                              {resolved.state === "live"
                                ? "Live excerpt"
                                : `${resolved.state} source`}
                            </span>
                          </div>
                          <blockquote>
                            {resolved.state === "trashed" ||
                            resolved.state === "missing"
                              ? "The referenced source has been deleted. Restore the original block to reconnect this passage."
                              : resolved.blocks
                                  .map((block) => block.text)
                                  .join("\n")}
                          </blockquote>
                          <button
                            onClick={() =>
                              openDocument(p.documentId, p.blockIds[0])
                            }
                          >
                            {resolved.title}
                            <ArrowUpRight size={14} />
                          </button>
                          <footer>
                            <button onClick={() => switchBoard(b.id, p.id)}>
                              <Grid2X2 size={12} />
                              {b.name}
                              <ArrowRight size={12} />
                            </button>
                          </footer>
                        </article>
                      );
                    }),
                )}
              </div>
              {!excerptCount && (
                <div className="empty-library">
                  <Pin size={32} />
                  <h2>Keep the important part.</h2>
                  <p>
                    Open a document, select a block, and pin it as a live
                    excerpt.
                  </p>
                </div>
              )}
            </section>
          )}

          {documentView && currentDocument && (
            <Editor
              key={documentView.key}
              workspace={workspace}
              documentId={documentView.id}
              highlightId={documentView.blockId}
              onChange={commit}
              onNavigate={openDocument}
              onClose={goBack}
              onPin={(docId, blockIds, frozen) =>
                setModal({ kind: "pin", documentId: docId, blockIds, frozen })
              }
              onPlace={(docId) =>
                setModal({ kind: "place", documentId: docId })
              }
              onLinkPicker={(docId, blockId) => {
                setQuery("");
                setModal({ kind: "link", documentId: docId, blockId });
              }}
              onExport={(docId) =>
                saveFile(
                  `${workspace.documents.find((d) => d.id === docId)?.title || "Document"}.md`,
                  exportMarkdown(workspace, docId),
                  "text/markdown;charset=utf-8",
                )
              }
              onStatus={updateStatus}
              onUndo={() => undo()}
              onRedo={() => undo(true)}
              canUndo={Boolean(activeHistory?.canUndo)}
              canRedo={Boolean(activeHistory?.canRedo)}
              onReveal={switchBoard}
            />
          )}
        </div>
        <footer className="workspace-status">
          <span>
            <span className="status-dot" />A little space for a bigger thought.
          </span>
          <span>
            {activeDocuments.length} documents
            <span className="status-separator">/</span>
            {workspace.boards.length} boards
            <span className="status-separator">/</span>
            {excerptCount} live excerpts
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {modal && (
        <Modal
          title={
            {
              search: "Find a thought. Follow a thread.",
              link: "Link to a source",
              document: "A new document",
              board: "Make a little room",
              "rename-board": "Rename this board",
              "new-workspace": "A fresh workspace",
              note: "A thought in the margins",
              frame: "Give this cluster a name",
              pin: modal.frozen
                ? "Capture a frozen copy"
                : "Pin a live excerpt",
              place: "One document. Another perspective.",
              relationship: "Connect two ideas",
              export: "Take your work with you",
              help: "Make yourself at home",
              "board-options": "Your board, your way",
              asset: "A local image",
            }[modal.kind] || "Margin"
          }
          onClose={() => setModal(null)}
          wide={["search", "link", "help"].includes(modal.kind)}
        >
          {modal.kind === "search" && (
            <>
              <div className="search-field">
                <Search size={21} />
                <input
                  autoFocus
                  aria-label="Search workspace"
                  placeholder="Search titles, phrases, and the words in between..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      document.querySelector(".search-result")?.focus();
                    }
                    if (e.key === "Enter" && results[0])
                      openDocument(results[0].documentId, results[0].blockId);
                  }}
                />
                <kbd>Esc</kbd>
              </div>
              <div className="search-filters">
                <ListFilter size={15} />
                <select
                  aria-label="Filter by tag"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                >
                  <option value="">All tags</option>
                  {tags.map((tag) => (
                    <option key={tag}>{tag}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by block type"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="">All block types</option>
                  {[
                    "paragraph",
                    "quote",
                    "heading1",
                    "heading2",
                    "list",
                    "checklist",
                    "code",
                    "link",
                    "image",
                  ].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                <span>
                  {query
                    ? `${results.length} passages`
                    : "Local full-text search"}
                </span>
              </div>
              <div className="search-results">
                {query ? (
                  <>
                    {results.slice(0, 100).map((result, i) => (
                      <button
                        className="search-result"
                        key={`${result.documentId}:${result.blockId}`}
                        onClick={() =>
                          openDocument(result.documentId, result.blockId)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            e.currentTarget.nextElementSibling?.focus();
                          }
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            if (i)
                              e.currentTarget.previousElementSibling?.focus();
                            else
                              document
                                .querySelector(
                                  '[aria-label="Search workspace"]',
                                )
                                ?.focus();
                          }
                        }}
                      >
                        <FileText size={18} />
                        <div>
                          <strong>
                            <Highlight
                              text={result.title}
                              query={deferredQuery}
                            />
                          </strong>
                          <p>
                            <Highlight
                              text={snippet(result.text, deferredQuery)}
                              query={deferredQuery}
                            />
                          </p>
                        </div>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                    {!results.length && (
                      <div className="search-empty">
                        <Search size={28} />
                        <h3>No threads found yet.</h3>
                        <p>
                          Try a different phrase or clear the tag and block
                          filters.
                        </p>
                      </div>
                    )}
                    {results.length > 100 && (
                      <p className="search-limit">
                        Showing the first 100 passages. Refine your search for
                        more specific results.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="eyebrow search-section-label">
                      QUICK ACTIONS
                    </div>
                    <button
                      className="command-action"
                      onClick={() => setModal({ kind: "document" })}
                    >
                      <Plus size={17} />
                      <span>Create a document</span>
                      <kbd>N</kbd>
                    </button>
                    <button
                      className="command-action"
                      onClick={() => setModal({ kind: "place" })}
                    >
                      <Layers size={17} />
                      <span>Place an existing document</span>
                    </button>
                    <button
                      className="command-action"
                      onClick={() => setModal({ kind: "board" })}
                    >
                      <Grid2X2 size={17} />
                      <span>Create a board</span>
                    </button>
                    <div className="eyebrow search-section-label">
                      {tagFilter
                        ? `DOCUMENTS TAGGED ${tagFilter.toUpperCase()}`
                        : "EXPLORE YOUR DOCUMENTS"}
                    </div>
                    {activeDocuments
                      .filter((d) => !tagFilter || d.tags.includes(tagFilter))
                      .slice(0, 12)
                      .map((doc) => (
                        <button
                          className="command-action"
                          key={doc.id}
                          onClick={() => openDocument(doc.id)}
                        >
                          <FileText size={16} />
                          <span>{doc.title}</span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                  </>
                )}
              </div>
              <div className="search-footer">
                <span>
                  <kbd>Enter</kbd> open the exact passage
                </span>
                <span>
                  <ShieldCheck size={12} />
                  Only this workspace. Always local.
                </span>
              </div>
            </>
          )}
          {modal.kind === "link" && (
            <>
              <p className="modal-description">
                Add a stored link after the selected block. Pick a document, or
                expand it to reference an exact passage.
              </p>
              <div className="search-field">
                <Search size={19} />
                <input
                  aria-label="Find link target"
                  placeholder="Search documents and passages..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="link-results">
                {activeDocuments
                  .filter(
                    (d) =>
                      !query ||
                      `${d.title} ${d.blocks.map((b) => b.text).join(" ")}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .slice(0, 60)
                  .map((doc) => (
                    <div key={doc.id}>
                      <button
                        className="command-action"
                        onClick={() => createInternalLink(doc.id)}
                      >
                        <FileText size={16} />
                        <span>{doc.title}</span>
                        <Link2 size={14} />
                      </button>
                      <details>
                        <summary>Choose a specific block</summary>
                        {doc.blocks.map((block, i) => (
                          <button
                            className="link-block-result"
                            key={block.id}
                            onClick={() => createInternalLink(doc.id, block.id)}
                          >
                            <span>{String(i + 1).padStart(2, "0")}</span>
                            <span>
                              {block.text.slice(0, 170) || "Empty block"}
                            </span>
                            <ArrowUpRight size={13} />
                          </button>
                        ))}
                      </details>
                    </div>
                  ))}
              </div>
              <details className="link-attachments">
                <summary>Add a web link or a reusable local image</summary>
                <form className="modal-form" onSubmit={event => {
                  event.preventDefault();
                  const values = new FormData(event.currentTarget);
                  const type = String(values.get('kind'));
                  const url = safeUrl(String(values.get('url') || ''));
                  const asset = workspace.assets.find(item => item.id === values.get('asset'));
                  if ((type === 'link' && !url) || (type === 'image' && !asset)) {
                    setModal({ ...modal, error: type === 'link' ? 'Use an absolute https://, http://, or mailto: URL. Unsafe schemes are not accepted.' : 'Import a local image first, then choose it here.' });
                    return;
                  }
                  const next = change(workspaceRef.current, draft => {
                    const doc = draft.documents.find(item => item.id === modal.documentId);
                    const at = doc.blocks.findIndex(block => block.id === modal.blockId);
                    doc.blocks.splice(at < 0 ? doc.blocks.length : at + 1, 0, {
                      id: id('block'), type, text: String(values.get('text') || (type === 'image' ? asset.name : url)),
                      ...(type === 'image' ? { assetId: asset.id } : { url }),
                    });
                    doc.updatedAt = stamp();
                  });
                  commit(next, { scope: 'document', id: modal.documentId });
                  setModal(null); setToast(type === 'image' ? 'Local image added to this document.' : 'Safe web link added. It opens only when you choose.');
                }}>
                  <label>Attachment type<select name="kind"><option value="link">Web link</option><option value="image">Local image</option></select></label>
                  <label>Display text or image caption<input name="text" maxLength={10000} placeholder="Give this reference a little context" /></label>
                  <label>Web address<input name="url" maxLength={8192} placeholder="https://example.org/source" /></label>
                  <label>Reusable local image<select name="asset"><option value="">Choose an imported image</option>{workspace.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
                  {modal.error && <p className="danger" role="alert">{modal.error}</p>}
                  <button className="button button-primary" type="submit">Insert into document<ArrowRight size={14} /></button>
                </form>
              </details>
            </>
          )}
          {![
            "search",
            "link",
            "export",
            "help",
            "board-options",
            "asset",
          ].includes(modal.kind) && (
            <form className="modal-form" onSubmit={handleDialogSubmit}>
              {[
                "document",
                "board",
                "rename-board",
                "new-workspace",
                "frame",
              ].includes(modal.kind) && (
                <>
                  <p>
                    {modal.kind === "document"
                      ? "Start with a title. The rest can unfold as you write."
                      : modal.kind === "new-workspace"
                        ? "A blank, isolated space. Your existing projects stay exactly where they are."
                        : modal.kind === "frame"
                          ? "A frame keeps these cards together without changing their content. Drag its heading to move the whole group."
                          : "Boards are different ways of looking at the same collection of ideas."}
                  </p>
                  <label>
                    {modal.kind === "document" ? "Document title" : "Name"}
                    <input
                      autoFocus
                      name="name"
                      required
                      maxLength={500}
                      placeholder={
                        modal.kind === "document"
                          ? "An idea worth exploring"
                          : "A name that feels right"
                      }
                      defaultValue={
                        modal.kind === "rename-board" ? board.name : ""
                      }
                    />
                  </label>
                </>
              )}
              {modal.kind === "note" && (
                <>
                  <p>
                    A simple board note, separate from your canonical documents.
                  </p>
                  <label>
                    Your thought
                    <textarea
                      autoFocus
                      name="text"
                      defaultValue={modal.text || ""}
                      placeholder="What is this making you think about?"
                      rows={7}
                      required
                      maxLength={100000}
                    />
                  </label>
                </>
              )}
              {modal.kind === "pin" && (
                <>
                  <div className="pin-preview">
                    <Quote size={24} />
                    <blockquote>
                      {modal.blockIds
                        .map(
                          (key) =>
                            currentDocument?.blocks.find((b) => b.id === key)
                              ?.text,
                        )
                        .join("\n")
                        .slice(0, 420)}
                    </blockquote>
                  </div>
                  <p>
                    {modal.frozen
                      ? "A clearly labeled, timestamped snapshot. Future source edits will NOT change this copy."
                      : "This card will refer to stable block IDs. Edit the original and this excerpt changes with it, without moving."}
                  </p>
                  <label>
                    Pin onto
                    <select
                      name="board"
                      defaultValue={
                        workspace.boards.find((b) => b.id !== board?.id)?.id ||
                        board?.id
                      }
                    >
                      {workspace.boards.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small className="muted">
                    Source: {currentDocument?.title} / {modal.blockIds.length}{" "}
                    {modal.blockIds.length === 1
                      ? "block"
                      : "contiguous blocks"}
                  </small>
                </>
              )}
              {modal.kind === "place" && (
                <>
                  <p>
                    Place the canonical document, not a copy. Each placement has
                    its own position and size.
                  </p>
                  <label>
                    Document
                    <select
                      name="document"
                      defaultValue={modal.documentId || activeDocuments[0]?.id}
                      required
                    >
                      {activeDocuments.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Board
                    <select name="board" defaultValue={board?.id} required>
                      {workspace.boards.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!activeDocuments.length && (
                    <p>Create or import a document first.</p>
                  )}
                </>
              )}
              {modal.kind === "relationship" && (
                <>
                  <p>
                    A connection should say something. Keep the reason close to
                    the relationship.
                  </p>
                  <label>
                    From
                    <select name="from" defaultValue={modal.from} required>
                      {board.placements.map((p) => (
                        <option key={p.id} value={p.id}>
                          {titleOf(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Relationship type
                    <select name="type">
                      <option value="supports">Supports</option>
                      <option value="contradicts">Contradicts</option>
                      <option value="related-to">Related to</option>
                      <option value="questions">Questions</option>
                      <option value="inspires">Inspires</option>
                      <option value="extends">Extends</option>
                    </select>
                  </label>
                  <label>
                    To
                    <select name="to" defaultValue={modal.to} required>
                      {board.placements.map((p) => (
                        <option key={p.id} value={p.id}>
                          {titleOf(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Label
                    <input
                      name="label"
                      placeholder="What makes this connection worth keeping?"
                      maxLength={1000}
                    />
                  </label>
                  <label className="check-label">
                    <input type="checkbox" name="directed" defaultChecked />
                    Directed, from the first card to the second
                  </label>
                </>
              )}
              <div className="modal-form-footer">
                <button
                  type="button"
                  className="button"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={
                    modal.kind === "place" &&
                    (!activeDocuments.length || !workspace.boards.length)
                  }
                >
                  {modal.kind === "pin"
                    ? modal.frozen
                      ? "Capture frozen copy"
                      : "Pin live excerpt"
                    : modal.kind === "place"
                      ? "Place document"
                      : modal.kind === "relationship"
                        ? "Create connection"
                        : modal.kind === "note"
                          ? "Keep this thought"
                          : modal.kind === "rename-board"
                            ? "Save name"
                            : "Create"}
                  <ArrowRight size={15} />
                </button>
              </div>
            </form>
          )}
          {modal.kind === "export" && (
            <div className="export-options">
              <p>Open formats, complete references, no account required.</p>
              <button onClick={exportWorkspace}>
                <span className="export-icon">
                  <FolderOpen size={24} />
                </span>
                <span>
                  <strong>Complete workspace</strong>
                  <small>
                    Versioned .margin.json with documents, boards, assets, and
                    live references.
                  </small>
                </span>
                <Download size={18} />
              </button>
              <button
                disabled={!board}
                onClick={() => {
                  saveFile(
                    `${board.name}.svg`,
                    boardSvg(workspace, board),
                    "image/svg+xml",
                  );
                  setToast(
                    "Readable board SVG exported. Text previews and full-text descriptions are included.",
                  );
                }}
              >
                <span className="export-icon">
                  <Grid2X2 size={24} />
                </span>
                <span>
                  <strong>This board as SVG</strong>
                  <small>
                    A readable, scalable map of {board?.name || "your board"}.
                  </small>
                </span>
                <Download size={18} />
              </button>
              <button
                disabled={!currentDocument}
                onClick={() =>
                  saveFile(
                    `${currentDocument.title}.md`,
                    exportMarkdown(workspace, currentDocument.id),
                    "text/markdown;charset=utf-8",
                  )
                }
              >
                <span className="export-icon">
                  <FileText size={24} />
                </span>
                <span>
                  <strong>Open document as Markdown</strong>
                  <small>
                    {currentDocument
                      ? currentDocument.title
                      : "Open a document to export its writing."}
                  </small>
                </span>
                <Download size={18} />
              </button>
              <div className="export-import">
                <Upload size={16} />
                <button
                  className="text-button"
                  onClick={() => packageInput.current.click()}
                >
                  Open a workspace package as a new workspace
                </button>
              </div>
            </div>
          )}
          {modal.kind === "board-options" && (
            <div className="board-options-menu">
              <button
                className="command-action"
                onClick={() => setModal({ kind: "rename-board" })}
              >
                <FileText size={16} />
                <span>Rename board</span>
              </button>
              <button
                className="command-action"
                onClick={() => {
                  setModal(null);
                  canvas.current?.fit([]);
                }}
              >
                <Frame size={16} />
                <span>Fit the whole board</span>
                <kbd>0</kbd>
              </button>
              <button
                className="command-action"
                onClick={() => setModal({ kind: "place" })}
              >
                <Layers size={16} />
                <span>Place an existing document</span>
              </button>
              <button
                className="command-action"
                onClick={() => {
                  setModal(null);
                  arrange();
                }}
              >
                <Grid2X2 size={16} />
                <span>Arrange selected cards</span>
              </button>
              <button
                className="command-action"
                onClick={() => setModal({ kind: "export" })}
              >
                <Download size={16} />
                <span>Export this board</span>
              </button>
            </div>
          )}
          {modal.kind === "asset" && (
            <div className="asset-dialog">
              {(() => {
                const asset = workspace.assets.find(
                  (a) => a.id === modal.assetId,
                );
                return (
                  asset && (
                    <>
                      <img src={asset.data} alt={asset.name} />
                      <h3>{asset.name}</h3>
                      <p>
                        Original local file / {asset.mime} / reusable across
                        boards
                      </p>
                      <button
                        className="button button-primary"
                        disabled={!board}
                        onClick={() => {
                          updateBoard({
                            ...board,
                            placements: [
                              ...board.placements,
                              {
                                id: id("placement"),
                                kind: "image",
                                assetId: asset.id,
                                text: asset.name,
                                ...positionOn(board),
                              },
                            ],
                          });
                          setModal(null);
                          setToast(
                            "Another placement of the same local asset.",
                          );
                        }}
                      >
                        <Plus size={15} />
                        Place on this board
                      </button>
                    </>
                  )
                );
              })()}
            </div>
          )}
          {modal.kind === "help" && (
            <div className="help-content">
              <div className="help-intro">
                <span className="brand-symbol">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <h3>
                  Follow your curiosity.
                  <br />
                  Keep the source close.
                </h3>
              </div>
              <p>
                Margin is a local-first space for reading, writing, and making
                connections. The Common Ground is an original fictional design
                inquiry, not real fieldwork. Everything here can be edited or
                replaced with your own work.
              </p>
              <div className="help-grid">
                <section>
                  <h4>Move through your thinking</h4>
                  <p>
                    Double-click a card or press Enter to open it. An excerpt's
                    source action opens and highlights its exact block. Alt +
                    Left returns to your previous document, board, and camera.
                  </p>
                  <p>
                    Drag card headers to move, not text. Scroll the canvas to
                    pan; Ctrl/Command + scroll zooms at the pointer. Hold Space
                    to pan. Shift-click or drag a marquee on blank canvas to
                    select multiple cards. Drag the resize corner, or focus it
                    and use arrow keys.
                  </p>
                </section>
                <section>
                  <h4>Keep one source of truth</h4>
                  <p>
                    Select a block with its gutter button, or Shift-click to
                    select a contiguous range. Pin a live excerpt onto any
                    board. Renaming, reordering, and editing preserve block IDs.
                    Split keeps the first ID; merge keeps the first and
                    tombstones the second. Deleted sources remain visibly
                    missing until restored.
                  </p>
                  <p>
                    Duplicate placement shares content. Duplicate document
                    creates independent block IDs. Removing a card never deletes
                    its document.
                  </p>
                </section>
                <section>
                  <h4>A structured writing surface</h4>
                  <p>
                    The block toolbar supports headings, paragraphs, quotes,
                    lists, checklists, code, internal/external links, and local
                    images. Enter splits a block; Shift + Enter inserts a line
                    break. Paste is plain text for safety. Markdown import
                    creates editable structure. Images imported through Import
                    files become reusable local assets and image documents.
                  </p>
                  <p>
                    Insert link searches canonical documents and exact blocks,
                    creating real backlinks. Inline Markdown is preserved as
                    text; it is not a full HTML word processor.
                  </p>
                </section>
                <section>
                  <h4>History & local safety</h4>
                  <p>
                    Ctrl/Command + Z undoes within the active document, or
                    within the active board outside the editor. Typing is
                    coalesced into short bursts. A drag is one board operation.
                    Board history never rewrites document content. History is
                    session-only.
                  </p>
                  <p>
                    Autosave uses this browser's local storage, which has a
                    limited quota. Keep regular package exports. No server,
                    account, or background image fetch is involved. Packages
                    open as isolated workspaces, never merged by title.
                  </p>
                </section>
              </div>
              <div className="help-shortcuts">
                <span>
                  <kbd>Ctrl K</kbd> Search & commands
                </span>
                <span>
                  <kbd>N</kbd> New document
                </span>
                <span>
                  <kbd>F</kbd> Fit selection
                </span>
                <span>
                  <kbd>0</kbd> Fit board
                </span>
                <span>
                  <kbd>V / H</kbd> Select / pan
                </span>
              </div>
              <label className="check-label motion-toggle">
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  onChange={(e) => setReducedMotion(e.target.checked)}
                />
                Reduce motion, keep every navigation function
              </label>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
