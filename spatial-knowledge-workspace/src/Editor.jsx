import { useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  Download,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Link2,
  MapPin,
  Merge,
  MoreHorizontal,
  Pin,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Snowflake,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  backlinks,
  change,
  editBlock,
  id,
  mergeBlocks,
  renameDocument,
  restoreBlock,
  safeUrl,
  splitBlock,
} from "./core.js";
import "./editor.css";

const BLOCK_STYLES = [
  ["paragraph", "Paragraph"],
  ["heading1", "Heading 1"],
  ["heading2", "Heading 2"],
  ["heading3", "Heading 3"],
  ["list", "Bullet list"],
  ["checklist", "Checklist"],
  ["quote", "Quote"],
  ["code", "Code"],
  ["link", "Link"],
  ["image", "Image caption"],
];
const MAX_BLOCK_TEXT = 1_000_000;
const normalizeTags = (value) =>
  [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim().slice(0, 100).trim())
        .filter(Boolean),
    ),
  ].slice(0, 100);
const readText = (element) => element.innerText.replace(/\r\n?/g, "\n");

function caretOffset(element) {
  const selection = window.getSelection();
  if (!element || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  )
    return null;
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

function focusAt(element, offset = 0) {
  element.focus({ preventScroll: true });
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remaining = offset;
  while (node && remaining > node.textContent.length) {
    remaining -= node.textContent.length;
    node = walker.nextNode();
  }
  if (node) range.setStart(node, Math.min(remaining, node.textContent.length));
  else {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function BlockText({
  block,
  readOnly,
  elements,
  onText,
  onFocus,
  onCaret,
  onSplit,
  onHistory,
  onNotice,
}) {
  const elementRef = useRef(null);
  const composing = useRef(false);
  const handlers = useRef(null);
  const Element = /^heading[123]$/.test(block.type)
    ? `h${block.type.slice(-1)}`
    : block.type === "quote"
      ? "blockquote"
      : block.type === "code"
        ? "pre"
        : "div";

  function input() {
    const element = elementRef.current;
    const text = readText(element);
    if (text.length > MAX_BLOCK_TEXT) {
      const offset = caretOffset(element) ?? MAX_BLOCK_TEXT;
      element.textContent = text.slice(0, MAX_BLOCK_TEXT);
      focusAt(element, Math.min(offset, MAX_BLOCK_TEXT));
      onNotice(
        "A block can contain up to 1,000,000 characters. Split it to keep writing.",
      );
    }
    onText(block.id, readText(element));
    onCaret(block.id, caretOffset(element));
  }

  function insertPlainText(value) {
    if (readOnly || !value) return;
    const element = elementRef.current;
    const selection = window.getSelection();
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (
      !range ||
      !element.contains(range.startContainer) ||
      !element.contains(range.endContainer)
    ) {
      range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }
    const available = Math.max(
      0,
      MAX_BLOCK_TEXT - readText(element).length + range.toString().length,
    );
    const plain = value.replace(/\r\n?/g, "\n");
    const text = plain.slice(0, available);
    if (text.length !== plain.length)
      onNotice("Pasted text was limited to 1,000,000 characters per block.");
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    element.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
    input();
  }

  useLayoutEffect(() => {
    const element = elementRef.current;
    // React never owns these text nodes. Equal canonical text must not move the caret.
    if (!composing.current && readText(element) !== block.text) {
      const offset =
        document.activeElement === element ? caretOffset(element) : null;
      element.textContent = block.text;
      if (offset !== null)
        focusAt(element, Math.min(offset, block.text.length));
    }
    handlers.current = { insertPlainText, onSplit, onHistory, readOnly };
  });

  useLayoutEffect(() => {
    const element = elementRef.current;
    elements.current.set(block.id, element);
    // Native beforeinput also covers mobile keyboards and browser history commands.
    const beforeInput = (event) => {
      const current = handlers.current;
      if (current.readOnly || event.isComposing) return;
      if (
        event.inputType === "historyUndo" ||
        event.inputType === "historyRedo"
      ) {
        event.preventDefault();
        current.onHistory(event.inputType === "historyRedo");
      } else if (event.inputType === "insertParagraph") {
        event.preventDefault();
        current.onSplit(block.id);
      } else if (event.inputType === "insertLineBreak") {
        event.preventDefault();
        current.insertPlainText("\n");
      }
    };
    element.addEventListener("beforeinput", beforeInput);
    return () => {
      elements.current.delete(block.id);
      element.removeEventListener("beforeinput", beforeInput);
    };
  }, [block.id, Element, elements]);

  return (
    <Element
      ref={elementRef}
      className={`block-text block-text-${block.type}${block.checked && block.type === "checklist" ? " block-text-checked" : ""}`}
      contentEditable={readOnly ? false : "plaintext-only"}
      suppressContentEditableWarning
      role="textbox"
      aria-label={`${block.type} block`}
      aria-multiline="true"
      aria-readonly={readOnly}
      data-block-id={block.id}
      data-placeholder={
        block.type === "image" ? "Write a caption..." : "Start writing..."
      }
      tabIndex={0}
      spellCheck={block.type !== "code"}
      onFocus={() => onFocus(block.id)}
      onInput={() => {
        if (!readOnly) input();
      }}
      onSelect={() => onCaret(block.id, caretOffset(elementRef.current))}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        if (!readOnly) input();
      }}
      onKeyDown={(event) => {
        if (readOnly || event.nativeEvent.isComposing || event.keyCode === 229)
          return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) insertPlainText("\n");
          else onSplit(block.id);
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        if (!readOnly)
          insertPlainText(event.clipboardData.getData("text/plain"));
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = readOnly ? "none" : "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!readOnly)
          insertPlainText(event.dataTransfer.getData("text/plain"));
      }}
    />
  );
}

export default function Editor(props) {
  const doc = props.workspace.documents.find(
    (item) => item.id === props.documentId,
  );
  if (!doc)
    return (
      <section className="editor-overlay" aria-label="Document editor">
        <header className="editor-header">
          <button
            type="button"
            className="editor-button editor-back"
            onClick={props.onClose}
          >
            <ArrowLeft size={16} />
            Back to board
          </button>
        </header>
        <div className="editor-missing" role="status">
          <FileText size={30} />
          <h1>This document is missing</h1>
          <p>
            The exact source could not be found. No other document has been
            opened in its place.
          </p>
          <code>{props.documentId}</code>
        </div>
      </section>
    );
  return <DocumentEditor key={doc.id} {...props} doc={doc} />;
}

function DocumentEditor({
  workspace,
  doc,
  highlightId,
  onChange,
  onNavigate,
  onClose,
  onPin,
  onPlace,
  onLinkPicker,
  onExport,
  onStatus,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onReveal,
}) {
  const [activeId, setActiveId] = useState(
    highlightId
      ? (doc.blocks.find((block) => block.id === highlightId)?.id ?? null)
      : (doc.blocks[0]?.id ?? null),
  );
  const [selection, setSelection] = useState([]);
  const [revealedId, setRevealedId] = useState(highlightId ?? null);
  const [tagDraft, setTagDraft] = useState(doc.tags.join(", "));
  const [notice, setNotice] = useState("");
  const latest = useRef(workspace);
  const elements = useRef(new Map());
  const anchor = useRef(null);
  const savedCaret = useRef(new Map());
  const pendingFocus = useRef(null);
  const summaryRef = useRef(null);
  const sourceBanner = useRef(null);
  const scrollRef = useRef(null);
  const readOnly = doc.status === "trashed";
  const active = doc.blocks.find((block) => block.id === activeId);
  const selectedSet = new Set(selection);
  const selectedIndices = doc.blocks.flatMap((block, index) =>
    selectedSet.has(block.id) ? [index] : [],
  );
  const selected = selectedIndices.length
    ? doc.blocks
        .slice(selectedIndices[0], selectedIndices.at(-1) + 1)
        .map((block) => block.id)
    : [];
  const actionIds = selected.length ? selected : active ? [active.id] : [];
  const firstActionIndex = doc.blocks.findIndex(
    (block) => block.id === actionIds[0],
  );
  const lastActionIndex = doc.blocks.findIndex(
    (block) => block.id === actionIds.at(-1),
  );
  const activeIndex = doc.blocks.findIndex((block) => block.id === activeId);
  const deletedSource = doc.deletedBlocks.find(
    (block) => block.id === revealedId,
  );
  const missingSource =
    revealedId && !doc.blocks.some((block) => block.id === revealedId);
  const incoming = backlinks(workspace, doc.id);
  const outgoing = doc.blocks.filter(
    (block) => block.target || safeUrl(block.url),
  );
  const placements = workspace.boards.flatMap((board) =>
    board.placements
      .filter((placement) => placement.documentId === doc.id)
      .map((placement) => ({ board, placement })),
  );
  const wordCount = doc.blocks.reduce(
    (count, block) => count + (block.text.trim().match(/\S+/g)?.length ?? 0),
    0,
  );
  const tagsKey = JSON.stringify(doc.tags);

  useLayoutEffect(() => {
    latest.current = workspace;
  }, [workspace]);

  useLayoutEffect(() => {
    if (JSON.stringify(normalizeTags(tagDraft)) !== tagsKey)
      setTagDraft(doc.tags.join(", "));
  }, [tagsKey]); // Keep a comma being typed, but synchronize canonical undo/redo.

  useLayoutEffect(() => {
    const element = summaryRef.current;
    const resize = () => {
      element.style.height = "0px";
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [doc.summary]);

  useLayoutEffect(() => {
    setRevealedId(highlightId ?? null);
    setSelection([]);
  }, [doc.id, highlightId]);

  useLayoutEffect(() => {
    if (!revealedId) return;
    const element = elements.current.get(revealedId);
    if (element) {
      setActiveId(revealedId);
      focusAt(element, 0);
      element.scrollIntoView({ block: "center", behavior: "instant" });
    } else {
      setActiveId(null);
      sourceBanner.current?.focus({ preventScroll: true });
      scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [missingSource, revealedId]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const element = elements.current.get(pending.id);
    if (!element) return;
    pendingFocus.current = null;
    focusAt(element, pending.offset);
    element.scrollIntoView({ block: "nearest", behavior: "instant" });
  });

  function commit(next, coalesce = false) {
    latest.current = next;
    onChange(next, { scope: "document", id: doc.id, coalesce });
  }

  function metadata(patch) {
    if (readOnly) return;
    const current = latest.current.documents.find((item) => item.id === doc.id);
    if (
      Object.entries(patch).every(
        ([key, value]) =>
          JSON.stringify(current[key]) === JSON.stringify(value),
      )
    )
      return;
    commit(
      change(latest.current, (next) => {
        Object.assign(
          next.documents.find((item) => item.id === doc.id),
          patch,
          { updatedAt: new Date().toISOString() },
        );
      }),
      true,
    );
  }

  function focusBlock(blockId) {
    setActiveId(blockId);
    setSelection([]);
    anchor.current = blockId;
    setRevealedId((current) => (current === blockId ? current : null));
  }

  function selectBlock(blockId, extend) {
    const start = doc.blocks.findIndex((block) => block.id === anchor.current);
    const end = doc.blocks.findIndex((block) => block.id === blockId);
    if (extend && start >= 0)
      setSelection(
        doc.blocks
          .slice(Math.min(start, end), Math.max(start, end) + 1)
          .map((block) => block.id),
      );
    else {
      anchor.current = blockId;
      setSelection([blockId]);
    }
    setActiveId(blockId);
    setRevealedId(null);
  }

  function updateText(blockId, text) {
    if (readOnly) return;
    const block = latest.current.documents
      .find((item) => item.id === doc.id)
      .blocks.find((item) => item.id === blockId);
    if (block && block.text !== text)
      commit(editBlock(latest.current, doc.id, blockId, { text }), true);
  }

  function addBlock() {
    if (readOnly) return;
    const blockId = id("block");
    pendingFocus.current = { id: blockId, offset: 0 };
    setActiveId(blockId);
    setSelection([]);
    setRevealedId(null);
    commit(
      change(latest.current, (next) => {
        const document = next.documents.find((item) => item.id === doc.id);
        const index = document.blocks.findIndex(
          (block) => block.id === activeId,
        );
        document.blocks.splice(
          index < 0 ? document.blocks.length : index + 1,
          0,
          { id: blockId, type: "paragraph", text: "" },
        );
        document.updatedAt = new Date().toISOString();
      }),
    );
    setNotice("New paragraph added.");
  }

  function split(blockId = activeId) {
    if (readOnly) return;
    const current = latest.current.documents.find((item) => item.id === doc.id);
    const index = current.blocks.findIndex((block) => block.id === blockId);
    if (index < 0) return;
    const block = current.blocks[index];
    const offset = Math.min(
      block.text.length,
      caretOffset(elements.current.get(blockId)) ??
        savedCaret.current.get(blockId) ??
        Math.floor(block.text.length / 2),
    );
    const next = splitBlock(latest.current, doc.id, blockId, offset);
    const second = next.documents.find((item) => item.id === doc.id).blocks[
      index + 1
    ];
    pendingFocus.current = { id: second.id, offset: 0 };
    setActiveId(second.id);
    setSelection([]);
    setRevealedId(null);
    commit(next);
    setNotice(
      "Split at the caret. The first block keeps its original reference.",
    );
  }

  function merge() {
    if (readOnly || !active) return;
    const current = latest.current.documents.find((item) => item.id === doc.id);
    const index = current.blocks.findIndex((block) => block.id === activeId);
    const first = current.blocks[index];
    const second = current.blocks[index + 1];
    if (!first || !second) return;
    if (first.text.length + second.text.length > MAX_BLOCK_TEXT) {
      setNotice(
        "These blocks are too long to merge. Each block is limited to 1,000,000 characters.",
      );
      return;
    }
    pendingFocus.current = { id: first.id, offset: first.text.length };
    setSelection([]);
    commit(mergeBlocks(latest.current, doc.id, first.id, second.id));
    setNotice(
      "Merged without adding spaces. The first reference stays; the next block is in Deleted blocks.",
    );
  }

  function removeSelected() {
    if (readOnly || !actionIds.length) return;
    const removed = new Set(actionIds);
    const next = change(latest.current, (nextWorkspace) => {
      const document = nextWorkspace.documents.find(
        (item) => item.id === doc.id,
      );
      // Record original positions before removing the whole range in one history entry.
      document.blocks = document.blocks.filter((block, originalIndex) => {
        if (!removed.has(block.id)) return true;
        document.deletedBlocks.push({ ...block, originalIndex });
        return false;
      });
      document.updatedAt = new Date().toISOString();
    });
    const remaining = next.documents.find((item) => item.id === doc.id).blocks;
    const nextId =
      remaining[Math.min(firstActionIndex, remaining.length - 1)]?.id ?? null;
    pendingFocus.current = nextId ? { id: nextId, offset: 0 } : null;
    setActiveId(nextId);
    setSelection([]);
    setRevealedId(null);
    commit(next);
    setNotice(
      `${removed.size} ${removed.size === 1 ? "block moved" : "blocks moved"} to Deleted blocks. Original references remain restorable.`,
    );
  }

  function restore(blockId) {
    if (readOnly) return;
    pendingFocus.current = { id: blockId, offset: 0 };
    setActiveId(blockId);
    setSelection([]);
    setRevealedId(blockId);
    commit(restoreBlock(latest.current, doc.id, blockId));
    setNotice("Passage restored with its original block reference.");
  }

  function move(direction) {
    if (
      readOnly ||
      firstActionIndex < 0 ||
      firstActionIndex + direction < 0 ||
      lastActionIndex + direction >= doc.blocks.length
    )
      return;
    commit(
      change(latest.current, (next) => {
        const document = next.documents.find((item) => item.id === doc.id);
        const moving = document.blocks.splice(
          firstActionIndex,
          actionIds.length,
        );
        document.blocks.splice(firstActionIndex + direction, 0, ...moving);
        document.updatedAt = new Date().toISOString();
      }),
    );
    setNotice(
      `${actionIds.length === 1 ? "Block" : "Selected passage"} moved ${direction < 0 ? "up" : "down"}. References are unchanged.`,
    );
  }

  function history(redo) {
    if (!(redo ? canRedo : canUndo)) return;
    (redo ? onRedo : onUndo)();
    setNotice(redo ? "Document edit redone." : "Document edit undone.");
  }

  function copySelection(event, cut = false) {
    if (
      !selected.length ||
      event.target.closest(
        'input, textarea, [contenteditable="plaintext-only"]',
      )
    )
      return;
    event.preventDefault();
    const ids = new Set(selected);
    event.clipboardData.setData(
      "text/plain",
      doc.blocks
        .filter((block) => ids.has(block.id))
        .map((block) => block.text)
        .join("\n\n"),
    );
    if (cut && !readOnly) removeSelected();
    else
      setNotice(
        `${selected.length} ${selected.length === 1 ? "block copied" : "blocks copied"} as plain text.`,
      );
  }

  function linkedDestination(block) {
    const target = workspace.documents.find(
      (item) => item.id === block.target.documentId,
    );
    const missing =
      block.target.blockId &&
      !target?.blocks.some((item) => item.id === block.target.blockId);
    return {
      title: target?.title || "Untitled document",
      note: !target
        ? "Missing document"
        : missing
          ? "Exact passage deleted or missing"
          : target.status !== "active"
            ? `${target.status} document`
            : block.target.blockId
              ? "Linked passage"
              : "Linked document",
    };
  }

  return (
    <section
      className="editor-overlay"
      aria-label="Document editor"
      onCopy={(event) => copySelection(event)}
      onCut={(event) => copySelection(event, true)}
      onKeyDownCapture={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.nativeEvent.isComposing &&
          ["z", "y"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          event.stopPropagation();
          history(event.shiftKey || event.key.toLowerCase() === "y");
        }
      }}
      onKeyDown={(event) => {
        if (
          event.target.closest(".block-select") &&
          ["Delete", "Backspace"].includes(event.key)
        ) {
          event.preventDefault();
          event.stopPropagation();
          removeSelected();
        }
        if (event.key === "Escape" && selected.length) {
          event.preventDefault();
          event.stopPropagation();
          setSelection([]);
        }
      }}
    >
      <header className="editor-header">
        <button
          type="button"
          className="editor-button editor-back"
          onClick={onClose}
        >
          <ArrowLeft size={16} />
          Back to board
        </button>
        <div className="editor-breadcrumb" aria-label="Document breadcrumb">
          <span>Document</span>
          <span aria-hidden="true">/</span>
          <span title={doc.title}>{doc.title || "Untitled document"}</span>
        </div>
        <div className="editor-header-actions">
          <button
            type="button"
            className="editor-button editor-place"
            onClick={() => onPlace(doc.id)}
            disabled={readOnly}
            aria-label="Place on a board"
            title="Place this original document on a board"
          >
            <MapPin size={15} />
            <span>Place on a board</span>
          </button>
          <button
            type="button"
            className="editor-icon-button"
            onClick={() => onExport(doc.id)}
            title="Export Markdown"
            aria-label="Export Markdown"
          >
            <Download size={17} />
          </button>
          <details className="editor-more">
            <summary
              className="editor-icon-button"
              aria-label="More document actions"
              title="More document actions"
            >
              <MoreHorizontal size={20} />
            </summary>
            <div className="editor-menu">
              {doc.status !== "active" && (
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => onStatus(doc.id, "active")}
                >
                  <RotateCcw size={15} />
                  Restore document
                </button>
              )}
              {doc.status === "active" && (
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => onStatus(doc.id, "archived")}
                >
                  <Archive size={15} />
                  Archive document
                </button>
              )}
              {doc.status !== "trashed" && (
                <button
                  type="button"
                  className="editor-button editor-danger"
                  onClick={() => onStatus(doc.id, "trashed")}
                >
                  <Trash2 size={15} />
                  Move to trash
                </button>
              )}
              <button
                type="button"
                className="editor-button"
                onClick={() => onExport(doc.id)}
              >
                <Download size={15} />
                Export Markdown
              </button>
            </div>
          </details>
        </div>
      </header>

      <div className="editor-toolbar-wrap">
        <div
          className="editor-toolbar"
          role="group"
          aria-label="Document formatting"
        >
          <label className="editor-style-label">
            <span className="editor-sr-only">Block style</span>
            <select
              aria-label="Block style"
              value={active?.type ?? "paragraph"}
              disabled={readOnly || !active}
              onChange={(event) => {
                const type = event.target.value;
                const removeEmail =
                  type === "image" &&
                  active.url &&
                  !/^https?:/i.test(active.url);
                commit(
                  editBlock(latest.current, doc.id, active.id, {
                    type,
                    ...(removeEmail ? { url: undefined } : {}),
                  }),
                );
                setNotice(
                  removeEmail
                    ? "Block style changed. An email address cannot be an image source; the text is preserved."
                    : "Block style changed. Text and references are preserved.",
                );
              }}
            >
              {BLOCK_STYLES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <span className="editor-toolbar-divider" />
          <button
            type="button"
            className="editor-button"
            onClick={addBlock}
            disabled={readOnly}
          >
            <Plus size={15} />
            Add block
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => onLinkPicker(doc.id, active.id)}
            disabled={readOnly || !active}
          >
            <Link2 size={15} />
            Insert link
          </button>
          <span className="editor-toolbar-divider" />
          <button
            type="button"
            className="editor-button editor-pin"
            onClick={() => onPin(doc.id, actionIds, false)}
            disabled={readOnly || !actionIds.length}
            title="Pin a live excerpt that follows its source"
          >
            <Pin size={15} />
            Pin excerpt
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => onPin(doc.id, actionIds, true)}
            disabled={readOnly || !actionIds.length}
            title="Pin a frozen copy of the current wording"
          >
            <Snowflake size={15} />
            Frozen copy
          </button>
          <span className="editor-toolbar-divider" />
          <button
            type="button"
            className="editor-icon-button"
            onClick={() => move(-1)}
            disabled={readOnly || firstActionIndex <= 0}
            title="Move block up"
            aria-label="Move block up"
          >
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            className="editor-icon-button"
            onClick={() => move(1)}
            disabled={
              readOnly ||
              !actionIds.length ||
              lastActionIndex >= doc.blocks.length - 1
            }
            title="Move block down"
            aria-label="Move block down"
          >
            <ArrowDown size={16} />
          </button>
          <button
            type="button"
            className="editor-icon-button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => split()}
            disabled={readOnly || !active}
            title="Split at caret; the first block keeps its reference"
            aria-label="Split block at caret"
          >
            <Scissors size={16} />
          </button>
          <button
            type="button"
            className="editor-icon-button"
            onClick={merge}
            disabled={
              readOnly || !active || activeIndex >= doc.blocks.length - 1
            }
            title="Merge with next block; the next block remains restorable"
            aria-label="Merge with next block"
          >
            <Merge size={16} />
          </button>
          <button
            type="button"
            className="editor-icon-button editor-danger"
            onClick={removeSelected}
            disabled={readOnly || !actionIds.length}
            title="Delete selected blocks"
            aria-label="Delete selected blocks"
          >
            <Trash2 size={16} />
          </button>
          <span className="editor-toolbar-divider" />
          <button
            type="button"
            className="editor-icon-button"
            onClick={() => history(false)}
            disabled={!canUndo}
            title="Undo document edit (Ctrl/Cmd+Z)"
            aria-label="Undo document edit"
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="editor-icon-button"
            onClick={() => history(true)}
            disabled={!canRedo}
            title="Redo document edit (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo document edit"
          >
            <Redo2 size={16} />
          </button>
        </div>
        <div className="editor-toolbar-hint">
          <span>
            {selected.length
              ? `${selected.length} ${selected.length === 1 ? "block" : "blocks"} selected. Ctrl/Cmd+C to copy.`
              : "Select blocks in the margin. Shift-click to select a passage."}
          </span>
          <span className="editor-history-note">
            Enter to split / Shift+Enter for a new line
          </span>
        </div>
      </div>

      <div className="editor-scroll" ref={scrollRef}>
        <div className="editor-content">
          <article
            className="editor-paper"
            aria-label={doc.title || "Untitled document"}
          >
            {doc.status !== "active" && (
              <div className="editor-banner" role="status">
                {readOnly ? <Trash2 size={18} /> : <Archive size={18} />}
                <div>
                  <strong>
                    {readOnly
                      ? "This document is in the trash"
                      : "This document is archived"}
                  </strong>
                  <p>
                    {readOnly
                      ? "Its passages are read-only. Restore the document to continue editing."
                      : "The original document and its references are preserved."}
                  </p>
                </div>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => onStatus(doc.id, "active")}
                >
                  <RotateCcw size={14} />
                  Restore
                </button>
              </div>
            )}
            {missingSource && (
              <div
                className="editor-banner editor-source-banner"
                ref={sourceBanner}
                role="status"
                tabIndex={-1}
              >
                <Link2 size={18} />
                <div>
                  <strong>
                    {deletedSource
                      ? "This exact passage was deleted"
                      : "This exact passage is missing"}
                  </strong>
                  <p>
                    {deletedSource
                      ? "Restore the original block to repair references to this passage."
                      : "The document is available, but no replacement passage has been selected."}
                  </p>
                  <code>{revealedId}</code>
                  {deletedSource?.text && (
                    <p className="editor-deleted-preview">
                      {deletedSource.text}
                    </p>
                  )}
                </div>
                {deletedSource && (
                  <button
                    type="button"
                    className="editor-button"
                    disabled={readOnly}
                    onClick={() => restore(deletedSource.id)}
                  >
                    <RotateCcw size={14} />
                    Restore passage
                  </button>
                )}
              </div>
            )}

            <div className="editor-document-heading">
              <div className="editor-eyebrow">
                <FileText size={13} />
                <span>Working document</span>
                <span className="editor-document-state">{doc.status}</span>
              </div>
              <input
                className="editor-title"
                aria-label="Document title"
                value={doc.title}
                placeholder="Untitled document"
                maxLength={1000}
                readOnly={readOnly}
                onFocus={() => {
                  setSelection([]);
                  setRevealedId(null);
                }}
                onChange={(event) => {
                  if (!readOnly)
                    commit(
                      renameDocument(
                        latest.current,
                        doc.id,
                        event.target.value,
                      ),
                      true,
                    );
                }}
              />
              <textarea
                ref={summaryRef}
                className="editor-summary"
                aria-label="Document summary"
                value={doc.summary}
                placeholder="Add a short summary, in your own words..."
                rows={2}
                maxLength={10000}
                readOnly={readOnly}
                onFocus={() => {
                  setSelection([]);
                  setRevealedId(null);
                }}
                onChange={(event) => metadata({ summary: event.target.value })}
              />
              <label className="editor-tags-input">
                <Tag size={13} />
                <span className="editor-sr-only">Document tags</span>
                <input
                  aria-label="Document tags"
                  title="Comma-separated tags. Up to 100 tags, 100 characters each."
                  value={tagDraft}
                  placeholder="Add tags, separated by commas"
                  maxLength={10200}
                  readOnly={readOnly}
                  onFocus={() => {
                    setSelection([]);
                    setRevealedId(null);
                  }}
                  onChange={(event) => {
                    setTagDraft(event.target.value);
                    metadata({ tags: normalizeTags(event.target.value) });
                  }}
                  onBlur={() => {
                    const tags = normalizeTags(tagDraft);
                    setTagDraft(tags.join(", "));
                    metadata({ tags });
                  }}
                />
              </label>
            </div>

            <div className="editor-blocks" aria-label="Document blocks">
              {doc.blocks.map((block, index) => {
                const destination = block.target
                  ? linkedDestination(block)
                  : null;
                const url = safeUrl(block.url);
                const asset =
                  block.type === "image"
                    ? workspace.assets.find((item) => item.id === block.assetId)
                    : null;
                const localImage =
                  asset &&
                  /^data:image\/(png|jpeg|gif|webp);base64,/i.test(asset.data)
                    ? asset.data
                    : null;
                return (
                  <div
                    key={block.id}
                    className={`block-row block-${block.type}${activeId === block.id ? " block-active" : ""}${selected.includes(block.id) ? " block-selected" : ""}${revealedId === block.id ? " block-highlighted" : ""}`}
                  >
                    <button
                      type="button"
                      className="block-select"
                      aria-label={`Select block ${index + 1}`}
                      aria-pressed={selected.includes(block.id)}
                      title={`Select block ${index + 1}; Shift-click to select a range`}
                      onClick={(event) => selectBlock(block.id, event.shiftKey)}
                    >
                      {selected.includes(block.id) ? (
                        <Check size={14} />
                      ) : (
                        <GripVertical size={15} />
                      )}
                    </button>
                    {revealedId === block.id && (
                      <span className="block-reference-label">
                        Referenced passage
                      </span>
                    )}
                    <div className="block-body">
                      {block.type === "list" && (
                        <span className="block-bullet" aria-hidden="true" />
                      )}
                      {block.type === "checklist" && (
                        <input
                          type="checkbox"
                          className="block-checkbox"
                          checked={Boolean(block.checked)}
                          disabled={readOnly}
                          aria-label={`Mark checklist block ${index + 1} complete`}
                          onFocus={() => focusBlock(block.id)}
                          onChange={(event) =>
                            commit(
                              editBlock(latest.current, doc.id, block.id, {
                                checked: event.target.checked,
                              }),
                            )
                          }
                        />
                      )}
                      <div className="block-content">
                        {block.type === "image" && (
                          <div className="block-media">
                            {localImage ? (
                              <img
                                src={localImage}
                                alt={block.text || asset.name}
                                loading="lazy"
                              />
                            ) : url && /^https?:/i.test(url) ? (
                              <div className="block-external-image">
                                <ImageIcon size={24} />
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  External image <ArrowUpRight size={14} />
                                </a>
                                <span>
                                  Not loaded. Open only if you trust the source.
                                </span>
                              </div>
                            ) : (
                              <div className="block-external-image">
                                <ImageIcon size={24} />
                                <span>
                                  {block.assetId
                                    ? "Local image is missing"
                                    : "No local image attached"}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        <BlockText
                          block={block}
                          readOnly={readOnly}
                          elements={elements}
                          onText={updateText}
                          onFocus={focusBlock}
                          onCaret={(blockId, offset) => {
                            if (offset !== null)
                              savedCaret.current.set(blockId, offset);
                          }}
                          onSplit={split}
                          onHistory={history}
                          onNotice={setNotice}
                        />
                        {destination && (
                          <button
                            type="button"
                            className="block-link"
                            onClick={() =>
                              onNavigate(
                                block.target.documentId,
                                block.target.blockId,
                              )
                            }
                            title={`${destination.title}: ${destination.note}`}
                          >
                            <Link2 size={14} />
                            <span>Open linked passage</span>
                            <span className="block-link-destination">
                              {destination.title}
                            </span>
                            <ArrowUpRight size={14} />
                          </button>
                        )}
                        {destination &&
                          /missing|deleted|trashed/.test(destination.note) && (
                            <p className="block-link-warning">
                              {destination.note}
                            </p>
                          )}
                        {!destination && url && block.type !== "image" && (
                          <a
                            className="block-link"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ArrowUpRight size={14} />
                            <span>{url}</span>
                          </a>
                        )}
                        {block.type === "link" && !destination && !url && (
                          <p className="block-link-warning">
                            No destination yet. Use Insert link to add a linked
                            passage without replacing this text.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!doc.blocks.length && (
                <div className="editor-empty-document">
                  <p>A little space for your next thought.</p>
                  <button
                    type="button"
                    className="editor-button"
                    onClick={addBlock}
                    disabled={readOnly}
                  >
                    <Plus size={15} />
                    Write the first block
                  </button>
                </div>
              )}
            </div>

            {!readOnly && doc.blocks.length > 0 && (
              <button
                type="button"
                className="editor-add-at-end"
                onClick={addBlock}
              >
                <Plus size={15} />
                Add a block {active ? "after selection" : "at the end"}
              </button>
            )}
            {doc.deletedBlocks.length > 0 && (
              <details className="editor-deleted-blocks">
                <summary>
                  <RotateCcw size={14} />
                  Deleted blocks <span>{doc.deletedBlocks.length}</span>
                </summary>
                <p>
                  Deleted and merged-away passages retain their original
                  references. Restoring a merged block does not remove its text
                  from the merged passage.
                </p>
                {doc.deletedBlocks.map((block) => (
                  <div className="editor-deleted-block" key={block.id}>
                    <div>
                      <span className="editor-eyebrow">
                        {
                          BLOCK_STYLES.find(
                            ([type]) => type === block.type,
                          )?.[1]
                        }
                      </span>
                      <p>{block.text || "Empty block"}</p>
                      <code>{block.id}</code>
                    </div>
                    <button
                      type="button"
                      className="editor-button"
                      disabled={readOnly}
                      onClick={() => restore(block.id)}
                      aria-label={`Restore block ${block.id}`}
                    >
                      <RotateCcw size={14} />
                      Restore
                    </button>
                  </div>
                ))}
              </details>
            )}
            <footer className="editor-paper-footer">
              <span>{wordCount.toLocaleString()} words</span>
              <span>{doc.blocks.length} blocks</span>
              <span>One document, wherever it lives.</span>
            </footer>
          </article>

          <aside className="editor-context" aria-label="Document context">
            <section className="editor-context-section">
              <h2>In this workspace</h2>
              <p className="editor-context-intro">
                The original lives here. Its connections reach a little further.
              </p>
              <h3>
                <MapPin size={14} />
                On boards <span>{placements.length}</span>
              </h3>
              {placements.length ? (
                <ul className="editor-context-list">
                  {placements.map(({ board, placement }) => (
                    <li key={placement.id}>
                      <button
                        type="button"
                        onClick={() => onReveal(board.id, placement.id)}
                        title={`Reveal ${placement.kind} on ${board.name}`}
                      >
                        <span>{board.name}</span>
                        <small>
                          {placement.kind === "document"
                            ? "Whole document"
                            : placement.kind === "frozen"
                              ? "Frozen copy"
                              : "Live excerpt"}
                        </small>
                        <ChevronRight size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="editor-context-empty">
                  Not placed on a board yet.
                </p>
              )}
              <button
                type="button"
                className="editor-context-action"
                onClick={() => onPlace(doc.id)}
                disabled={readOnly}
              >
                <Plus size={13} />
                Place on a board
              </button>
            </section>

            <section className="editor-context-section">
              <h3>
                <Link2 size={14} />
                Backlinks <span>{incoming.length}</span>
              </h3>
              {incoming.length ? (
                <ul className="editor-context-list">
                  {incoming.map((link) => (
                    <li key={`${link.documentId}:${link.blockId}`}>
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate(link.documentId, link.blockId)
                        }
                      >
                        <span>{link.title || "Untitled document"}</span>
                        <small>{link.text || "Linked passage"}</small>
                        <ArrowUpRight size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="editor-context-empty">
                  No other passages link here yet.
                </p>
              )}
            </section>

            <section className="editor-context-section">
              <h3>
                <ArrowUpRight size={14} />
                Outgoing links <span>{outgoing.length}</span>
              </h3>
              {outgoing.length ? (
                <ul className="editor-context-list">
                  {outgoing.map((block) => (
                    <li key={block.id}>
                      {block.target ? (
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate(
                              block.target.documentId,
                              block.target.blockId,
                            )
                          }
                        >
                          <span>{linkedDestination(block).title}</span>
                          <small>
                            {block.text || linkedDestination(block).note}
                          </small>
                          <ArrowUpRight size={14} />
                        </button>
                      ) : (
                        <a
                          href={safeUrl(block.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span>
                            {block.type === "image"
                              ? "External image"
                              : block.text || "External link"}
                          </span>
                          <small>{safeUrl(block.url)}</small>
                          <ArrowUpRight size={14} />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="editor-context-empty">
                  A thought can stand on its own, or connect to another.
                </p>
              )}
            </section>

            <section className="editor-context-section editor-metadata">
              <h3>About this document</h3>
              {doc.tags.length > 0 && (
                <div className="editor-tag-list">
                  {doc.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}
              <dl>
                <dt>Words</dt>
                <dd>{wordCount.toLocaleString()}</dd>
                <dt>Created</dt>
                <dd>
                  <time dateTime={doc.createdAt}>
                    {new Date(doc.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </time>
                </dd>
                <dt>Updated</dt>
                <dd>
                  <time dateTime={doc.updatedAt}>
                    {new Date(doc.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </time>
                </dd>
              </dl>
              <h4>Provenance</h4>
              {doc.provenance && typeof doc.provenance === "object" ? (
                <dl className="editor-provenance">
                  {Object.entries(doc.provenance).map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {key
                          .replace(/([a-z])([A-Z])/g, "$1 $2")
                          .replace(/[_-]/g, " ")}
                      </dt>
                      <dd>
                        {value === null
                          ? "Not recorded"
                          : typeof value === "object"
                            ? JSON.stringify(value, null, 2)
                            : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="editor-provenance-text">
                  {doc.provenance || "No provenance recorded."}
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>
      <div
        className="editor-notice"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {notice || "Live excerpts stay connected to their original passages."}
      </div>
    </section>
  );
}
