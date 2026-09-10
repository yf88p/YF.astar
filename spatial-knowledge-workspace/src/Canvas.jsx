import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowUpRight,
  Check,
  FileText,
  Frame,
  GripVertical,
  Hand,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Quote,
  Scan,
  Snowflake,
  StickyNote,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { fitCamera, resolvePlacement, screenToWorld, zoomAt } from "./core.js";
import "./canvas.css";

const intersects = (a, b) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
const contains = (a, b) =>
  b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
const clampPosition = (value) =>
  Math.max(-10_000_000, Math.min(10_000_000, value));
const interactive =
  'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"]';
const editing =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .editor-overlay, [role="dialog"], dialog[open]';

function LocalImage({ asset, alt }) {
  const [image, setImage] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setImage(null);
    if (
      !asset ||
      !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        asset.mime,
      )
    )
      return;
    const prefix = `data:${asset.mime};base64,`;
    if (!asset.data?.startsWith(prefix)) return;
    let url;
    try {
      // Packages store raster bytes; the canvas only renders revocable local Blob URLs.
      const bytes = Uint8Array.from(
        atob(asset.data.slice(prefix.length)),
        (character) => character.charCodeAt(0),
      );
      url = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
      setImage({ data: asset.data, url });
    } catch {
      setFailed(true);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset?.data, asset?.mime]);
  return image && image.data === asset?.data && !failed ? (
    <img
      className="canvas-local-image"
      src={image.url}
      alt={alt || asset.name}
      draggable={false}
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="canvas-image-placeholder">
      <ImageIcon size={25} />
      <span>{asset ? "Local image unavailable" : "Missing local image"}</span>
      <small>{alt}</small>
    </div>
  );
}

function CardSurface({ placement, reading, onViewChange, children }) {
  const element = useRef(null);
  useLayoutEffect(() => {
    if (reading && element.current)
      element.current.scrollTop = placement.view?.scrollTop || 0;
  }, [placement.id, placement.view?.scrollTop, reading]);
  return (
    <div
      ref={element}
      className="card-scroll"
      onScroll={(event) => {
        if (
          reading &&
          onViewChange &&
          event.currentTarget.scrollTop !== (placement.view?.scrollTop || 0)
        ) {
          onViewChange(placement.id, {
            scrollTop: event.currentTarget.scrollTop,
          });
        }
      }}
    >
      {children}
    </div>
  );
}

const Canvas = forwardRef(function Canvas(
  {
    workspace,
    board,
    selection = [],
    onSelect,
    onBoardChange,
    onCamera,
    onOpen,
    onRelationship,
    tool = "select",
    setTool,
    onNew,
    onConnect,
  },
  ref,
) {
  const rootRef = useRef(null);
  const cameraRef = useRef(board.camera);
  const handlers = useRef(null);
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const spaceRef = useRef(false);
  const renameCancelled = useRef(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [draft, setDraft] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [gestureMode, setGestureMode] = useState(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [pending, setPending] = useState(null);
  const [rename, setRename] = useState(null);
  const arrowId = `canvas-arrow-${useId().replace(/:/g, "")}`;
  const camera = board.camera;
  const selected = new Set(selection);
  const patches = draft?.boardId === board.id ? draft.patches : null;
  const placements = patches
    ? board.placements.map((p) =>
        patches.has(p.id) ? { ...p, ...patches.get(p.id) } : p,
      )
    : board.placements;
  const frames = patches
    ? board.frames.map((f) =>
        patches.has(f.id) ? { ...f, ...patches.get(f.id) } : f,
      )
    : board.frames;
  const entities = [...frames, ...placements];
  const byId = new Map(entities.map((item) => [item.id, item]));
  const documents = new Map(
    workspace.documents.map((document) => [document.id, document]),
  );
  const assets = new Map(workspace.assets.map((asset) => [asset.id, asset]));
  const viewport = {
    x: -camera.x / camera.zoom,
    y: -camera.y / camera.zoom,
    w: size.width / camera.zoom,
    h: size.height / camera.zoom,
  };
  const margin = 100 / camera.zoom;
  const cullRect = {
    x: viewport.x - margin,
    y: viewport.y - margin,
    w: viewport.w + margin * 2,
    h: viewport.h + margin * 2,
  };
  // Cull geometry before resolving document bodies, including on large boards.
  const visible = placements.filter((p) => intersects(p, cullRect));
  const overview = camera.zoom < 0.48;
  const reading = camera.zoom >= 1.05;
  const pendingId =
    tool === "connect" && pending?.boardId === board.id && byId.has(pending.id)
      ? pending.id
      : null;

  function getSize() {
    const element = rootRef.current;
    return {
      width: element?.clientWidth || 1,
      height: element?.clientHeight || 1,
    };
  }

  function changeCamera(next) {
    const bounded = {
      ...next,
      x: clampPosition(next.x),
      y: clampPosition(next.y),
    };
    cameraRef.current = bounded;
    onCamera(bounded);
  }

  function fit(ids = selection) {
    const requested = new Set(ids);
    const items = requested.size
      ? entities.filter((item) => requested.has(item.id))
      : entities;
    const { width, height } = getSize();
    changeCamera(
      fitCamera(
        items.length ? items : entities,
        width,
        height,
        Math.min(80, width * 0.12, height * 0.15),
      ),
    );
  }

  function zoom(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const { width, height } = getSize();
    changeCamera(
      zoomAt(
        cameraRef.current,
        { x: width / 2, y: height / 2 },
        Math.min(8, Math.max(0.05, cameraRef.current.zoom * factor)),
      ),
    );
  }

  useImperativeHandle(ref, () => ({ fit, zoom, getSize }));

  function point(event) {
    const bounds = rootRef.current.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function selectId(id, additive, previous = selection) {
    onSelect(
      additive
        ? previous.includes(id)
          ? previous.filter((value) => value !== id)
          : [...previous, id]
        : [id],
    );
  }

  function activateCard(p, event) {
    if (tool === "hand" || spaceRef.current) return;
    if (tool === "connect") {
      if (!pendingId) {
        setPending({ boardId: board.id, id: p.id });
        onSelect([p.id]);
      } else if (pendingId !== p.id) {
        onConnect(pendingId, p.id);
        setPending(null);
        onSelect([]);
        setTool("select");
      }
    } else selectId(p.id, event.shiftKey || event.metaKey);
  }

  function commitPatches(changes) {
    if (!changes.size) return;
    onBoardChange({
      ...board,
      placements: board.placements.map((p) =>
        changes.has(p.id) ? { ...p, ...changes.get(p.id) } : p,
      ),
      frames: board.frames.map((f) =>
        changes.has(f.id) ? { ...f, ...changes.get(f.id) } : f,
      ),
    });
  }

  function capture(event, data) {
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = false;
    const captureElement = event.currentTarget;
    gesture.current = {
      ...data,
      boardId: board.id,
      pointerId: event.pointerId,
      captureElement,
      start: point(event),
      camera: { ...cameraRef.current },
      moved: false,
      patches: new Map(),
    };
    captureElement.setPointerCapture(event.pointerId);
    setGestureMode(data.mode);
  }

  function beginMove(event, item, resize = false) {
    if (
      event.button !== 0 ||
      gesture.current ||
      tool === "connect" ||
      tool === "hand" ||
      spaceRef.current
    )
      return;
    event.currentTarget.focus({ preventScroll: true });
    const additive = event.shiftKey || event.metaKey;
    const ids = new Set(
      resize
        ? [item.id]
        : selected.has(item.id)
          ? selection
          : additive
            ? [...selection, item.id]
            : [item.id],
    );
    if (!selected.has(item.id))
      onSelect(additive ? [...selection, item.id] : [item.id]);
    if (!resize) {
      // Frame membership is geometric at gesture start, not a persistent group mutation.
      for (const frame of frames)
        if (ids.has(frame.id)) {
          for (const p of placements) if (contains(frame, p)) ids.add(p.id);
        }
    }
    capture(event, {
      mode: resize ? "resize" : "move",
      originals: entities.filter((entity) => ids.has(entity.id)),
      clicked: item.id,
      additive,
      selection: [...selection],
    });
  }

  function beginBackground(event) {
    if (
      gesture.current ||
      event.button !== 0 ||
      event.target.closest(
        ".map-card, .map-frame-title, .canvas-relationship, .canvas-controls, .minimap, .canvas-empty, .canvas-resize",
      )
    )
      return;
    rootRef.current.focus({ preventScroll: true });
    capture(event, {
      mode: "marquee",
      selection: [...selection],
      additive: event.shiftKey || event.metaKey,
    });
  }

  function beginPan(event) {
    suppressClick.current = false;
    if (
      gesture.current ||
      ![0, 1].includes(event.button) ||
      event.target.closest(
        '.canvas-controls, .minimap, .canvas-empty, input, textarea, select, [contenteditable="true"]',
      )
    )
      return;
    if (event.button === 1 || spaceRef.current || tool === "hand") {
      rootRef.current.focus({ preventScroll: true });
      capture(event, { mode: "pan" });
    }
  }

  function movePointer(event) {
    const current = gesture.current;
    if (
      !current ||
      current.pointerId !== event.pointerId ||
      current.boardId !== board.id
    )
      return;
    const end = point(event);
    const dx = end.x - current.start.x;
    const dy = end.y - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 3) return;
    if (!current.moved && current.captureElement !== rootRef.current) {
      // Keep taps/double-clicks on the handle; capture real drags on the uncullable root.
      current.captureElement = rootRef.current;
      rootRef.current.setPointerCapture(event.pointerId);
    }
    current.moved = true;
    if (current.mode === "pan") {
      changeCamera({
        ...current.camera,
        x: current.camera.x + dx,
        y: current.camera.y + dy,
      });
    } else if (current.mode === "marquee") {
      const start = screenToWorld(current.start, current.camera);
      const finish = screenToWorld(end, current.camera);
      const rectangle = {
        x: Math.min(start.x, finish.x),
        y: Math.min(start.y, finish.y),
        w: Math.abs(finish.x - start.x),
        h: Math.abs(finish.y - start.y),
      };
      setMarquee(rectangle);
      const ids = placements
        .filter((p) => intersects(p, rectangle))
        .map((p) => p.id);
      onSelect(
        current.additive ? [...new Set([...current.selection, ...ids])] : ids,
      );
    } else {
      const changes = new Map(
        current.originals.map((item) => [
          item.id,
          current.mode === "resize"
            ? {
                w: Math.max(
                  180,
                  Math.min(10_000_000, item.w + dx / current.camera.zoom),
                ),
                h: Math.max(
                  130,
                  Math.min(10_000_000, item.h + dy / current.camera.zoom),
                ),
              }
            : {
                x: clampPosition(item.x + dx / current.camera.zoom),
                y: clampPosition(item.y + dy / current.camera.zoom),
              },
        ]),
      );
      current.patches = changes;
      setDraft({ boardId: board.id, patches: changes });
    }
  }

  function finishPointer(event, cancelled = false) {
    const current = gesture.current;
    if (!current || (event && current.pointerId !== event.pointerId)) return;
    if (event && !cancelled) movePointer(event);
    gesture.current = null;
    if (current.captureElement.hasPointerCapture(current.pointerId))
      current.captureElement.releasePointerCapture(current.pointerId);
    setDraft(null);
    setMarquee(null);
    setGestureMode(null);
    suppressClick.current = current.moved;
    if (current.boardId !== board.id) return;
    if (cancelled) {
      if (current.mode === "marquee") onSelect(current.selection);
      return;
    }
    if (current.moved && current.patches.size) {
      const changed = new Map(
        [...current.patches].filter(([id, patch]) => {
          const original = current.originals.find((item) => item.id === id);
          return Object.entries(patch).some(
            ([key, value]) => original[key] !== value,
          );
        }),
      );
      commitPatches(changed);
    } else if (!current.moved && current.mode === "marquee") {
      if (!current.additive) onSelect([]);
      setPending(null);
    } else if (!current.moved && current.mode === "move") {
      selectId(current.clicked, current.additive, current.selection);
    }
  }

  function resizeKey(event, item) {
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const patch = {
      w: Math.max(180, Math.min(10_000_000, item.w + direction[0] * step)),
      h: Math.max(130, Math.min(10_000_000, item.h + direction[1] * step)),
    };
    if (patch.w !== item.w || patch.h !== item.h)
      commitPatches(new Map([[item.id, patch]]));
  }

  function renameFrame(frame) {
    renameCancelled.current = false;
    setRename({ id: frame.id, value: frame.title });
  }

  function finishRename(frame, value) {
    setRename(null);
    const title = value.trim();
    if (!renameCancelled.current && title && title !== frame.title)
      onBoardChange({
        ...board,
        frames: board.frames.map((f) =>
          f.id === frame.id ? { ...f, title } : f,
        ),
      });
  }

  function wheel(event) {
    if (
      event.target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      )
    )
      return;
    const scroll = event.target.closest(".card-scroll");
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      scroll &&
      scroll.scrollHeight > scroll.clientHeight + 1 &&
      ["auto", "scroll"].includes(getComputedStyle(scroll).overflowY)
    )
      return;
    event.preventDefault();
    if (gesture.current) return;
    const multiplier =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? getSize().height : 1;
    const dx = event.deltaX * multiplier;
    const dy = event.deltaY * multiplier;
    const previous = cameraRef.current;
    if (event.ctrlKey || event.metaKey)
      changeCamera(
        zoomAt(
          previous,
          point(event),
          previous.zoom * Math.exp(Math.max(-1, Math.min(1, -dy * 0.008))),
        ),
      );
    else
      changeCamera({
        ...previous,
        x: previous.x - (event.shiftKey && !dx ? dy : dx),
        y: previous.y - (event.shiftKey && !dx ? 0 : dy),
      });
  }

  function keyDown(event) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.target.closest(editing) ||
      !rootRef.current?.getClientRects().length
    )
      return;
    if (
      [
        ...document.querySelectorAll(
          '.editor-overlay, [role="dialog"], dialog[open]',
        ),
      ].some(
        (element) =>
          element.getClientRects().length &&
          element.getAttribute("aria-hidden") !== "true",
      )
    )
      return;
    if (event.key === "Escape") {
      if (gesture.current) finishPointer(null, true);
      setPending(null);
      if (tool === "connect") setTool("select");
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Space") {
      if (
        event.target.closest('button, a, [role="button"]') &&
        !event.target.closest(
          ".canvas-card-move, .canvas-frame-move, .canvas-resize",
        )
      )
        return;
      event.preventDefault();
      spaceRef.current = true;
      setSpaceHeld(true);
      return;
    }
    if (gesture.current) return;
    const key = event.key.toLowerCase();
    if (!["v", "h", "+", "=", "-", "0", "f"].includes(key)) return;
    event.preventDefault();
    if (key === "v" || key === "h") setTool(key === "v" ? "select" : "hand");
    else if (key === "+" || key === "=") zoom(1.2);
    else if (key === "-") zoom(1 / 1.2);
    else fit(key === "0" ? [] : selection);
  }

  useLayoutEffect(() => {
    cameraRef.current = board.camera;
    handlers.current = {
      wheel,
      keyDown,
      cancel: () => finishPointer(null, true),
    };
  });

  useLayoutEffect(() => {
    const element = rootRef.current;
    const measure = () => {
      const next = getSize();
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    const onWheel = (event) => handlers.current.wheel(event);
    const onKeyDown = (event) => handlers.current.keyDown(event);
    const releaseSpace = (event) => {
      if (event && event.code !== "Space") return;
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    const blur = () => {
      releaseSpace();
      handlers.current.cancel();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", blur);
    return () => {
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", releaseSpace);
      window.removeEventListener("blur", blur);
      const current = gesture.current;
      gesture.current = null;
      if (current?.captureElement.hasPointerCapture(current.pointerId))
        current.captureElement.releasePointerCapture(current.pointerId);
    };
  }, []);

  useLayoutEffect(() => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.captureElement.hasPointerCapture(current.pointerId))
      current.captureElement.releasePointerCapture(current.pointerId);
    setDraft(null);
    setMarquee(null);
    setGestureMode(null);
    setRename(null);
    setPending(null);
    suppressClick.current = false;
  }, [board.id]);

  useEffect(() => {
    if (tool !== "connect") setPending(null);
  }, [tool]);

  let mapLeft = viewport.x,
    mapTop = viewport.y,
    mapRight = viewport.x + viewport.w,
    mapBottom = viewport.y + viewport.h;
  for (const item of entities) {
    mapLeft = Math.min(mapLeft, item.x);
    mapTop = Math.min(mapTop, item.y);
    mapRight = Math.max(mapRight, item.x + item.w);
    mapBottom = Math.max(mapBottom, item.y + item.h);
  }
  const mapScale = Math.min(
    134 / Math.max(1, mapRight - mapLeft),
    79 / Math.max(1, mapBottom - mapTop),
  );
  const mapX = (150 - (mapRight - mapLeft) * mapScale) / 2;
  const mapY = (95 - (mapBottom - mapTop) * mapScale) / 2;
  const mapRect = (item) => ({
    x: mapX + (item.x - mapLeft) * mapScale,
    y: mapY + (item.y - mapTop) * mapScale,
    width: item.w * mapScale,
    height: item.h * mapScale,
  });

  function toolbarButton(label, Icon, action, active) {
    return (
      <button
        type="button"
        className="canvas-tool"
        title={label}
        aria-label={label}
        aria-pressed={active}
        onClick={action}
      >
        <Icon size={18} strokeWidth={1.7} />
      </button>
    );
  }

  function resizeHandle(item, title) {
    return (
      selected.has(item.id) && (
        <button
          type="button"
          className="canvas-resize"
          aria-label={`Resize ${title}`}
          title="Resize (arrow keys; Shift for 10 px)"
          onPointerDown={(event) => beginMove(event, item, true)}
          onKeyDown={(event) => resizeKey(event, item)}
          onClick={(event) => event.stopPropagation()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 12 12 5M9 12l3-3" />
          </svg>
        </button>
      )
    );
  }

  return (
    <section
      ref={rootRef}
      className={`spatial-canvas${spaceHeld || tool === "hand" ? " canvas-hand" : ""}${tool === "connect" ? " canvas-connecting" : ""}${gestureMode ? ` canvas-gesture-${gestureMode}` : ""}`}
      data-testid="canvas"
      data-visible-count={visible.length}
      data-total-count={placements.length}
      aria-label={`${board.name} spatial canvas`}
      tabIndex={0}
      style={{
        backgroundSize: `${Math.max(16, 24 * camera.zoom)}px ${Math.max(16, 24 * camera.zoom)}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDownCapture={beginPan}
      onPointerDown={beginBackground}
      onPointerMove={movePointer}
      onPointerUp={(event) => finishPointer(event)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onLostPointerCapture={(event) => {
        if (gesture.current?.captureElement === event.target)
          finishPointer(event, true);
      }}
      onClickCapture={(event) => {
        if (suppressClick.current && event.detail > 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onScroll={(event) => {
        if (event.target !== event.currentTarget) return;
        const element = event.currentTarget;
        const x = element.scrollLeft,
          y = element.scrollTop;
        if (!x && !y) return;
        element.scrollLeft = 0;
        element.scrollTop = 0;
        // Keyboard focus may reveal a culled-margin card; never keep a second world offset.
        if (window.getSelection()?.isCollapsed !== false)
          changeCamera({
            ...cameraRef.current,
            x: cameraRef.current.x - x,
            y: cameraRef.current.y - y,
          });
      }}
    >
      <div
        className="canvas-world"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        }}
      >
        {frames
          .filter((frame) => intersects(frame, cullRect))
          .map((frame) => (
            <section
              key={frame.id}
              className={`map-frame${selected.has(frame.id) ? " canvas-selected" : ""}`}
              data-frame-id={frame.id}
              aria-label={`Frame: ${frame.title}`}
              style={{
                left: frame.x,
                top: frame.y,
                width: frame.w,
                height: frame.h,
                "--frame-color": frame.color,
              }}
            >
              <div
                className="map-frame-title"
                style={overview ? { top: -20 / camera.zoom } : undefined}
              >
                {rename?.id === frame.id ? (
                  <input
                    className="canvas-frame-input"
                    aria-label="Frame title"
                    autoFocus
                    maxLength={1000}
                    value={rename.value}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) =>
                      setRename({ id: frame.id, value: event.target.value })
                    }
                    onBlur={(event) => finishRename(frame, event.target.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        renameCancelled.current = true;
                        setRename(null);
                      }
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="canvas-frame-move"
                      aria-label={`Move ${frame.title}`}
                      title="Drag frame and contained cards; double-click to rename"
                      onPointerDown={(event) => beginMove(event, frame)}
                      onClick={(event) => {
                        if (event.detail === 0)
                          selectId(frame.id, event.shiftKey || event.metaKey);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        renameFrame(frame);
                      }}
                    >
                      <GripVertical size={13} />
                      <span
                        style={
                          overview
                            ? { fontSize: 10 / camera.zoom, letterSpacing: 0 }
                            : undefined
                        }
                      >
                        {(overview
                          ? frame.title.replace(/^\d+\s*\/\s*/, "")
                          : frame.title) || "Untitled frame"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="canvas-frame-edit"
                      aria-label={`Rename ${frame.title}`}
                      title="Rename frame"
                      onClick={() => renameFrame(frame)}
                    >
                      <Pencil size={12} />
                    </button>
                  </>
                )}
              </div>
              {resizeHandle(frame, frame.title || "Untitled frame")}
            </section>
          ))}

        <svg className="canvas-relationships" aria-label="Board relationships">
          <defs>
            <marker
              id={arrowId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path
                d="M1 1 9 5 1 9"
                fill="none"
                stroke="context-stroke"
                strokeWidth="1.3"
              />
            </marker>
          </defs>
          {board.relationships.map((relationship) => {
            const from = byId.get(relationship.from),
              to = byId.get(relationship.to);
            if (!from || !to) return null;
            const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
            const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
            const dx = b.x - a.x,
              dy = b.y - a.y;
            // Intersect each rectangle, then lead the curve outward along its edge normal.
            const endpoint = (item, center, vx, vy) => {
              if (!vx && !vy)
                return { x: center.x + item.w / 2, y: center.y, nx: 1, ny: 0 };
              const horizontal = Math.abs(vx) / item.w >= Math.abs(vy) / item.h;
              const distance = horizontal
                ? item.w / 2 / Math.abs(vx)
                : item.h / 2 / Math.abs(vy);
              return {
                x: center.x + vx * distance,
                y: center.y + vy * distance,
                nx: horizontal ? Math.sign(vx) : 0,
                ny: horizontal ? 0 : Math.sign(vy),
              };
            };
            const start = endpoint(from, a, dx, dy),
              end = endpoint(to, b, -dx, -dy);
            const bend = Math.min(
              180,
              Math.max(35, Math.hypot(end.x - start.x, end.y - start.y) * 0.35),
            );
            const c1 = {
              x: start.x + start.nx * bend,
              y: start.y + start.ny * bend,
            };
            const c2 = { x: end.x + end.nx * bend, y: end.y + end.ny * bend };
            const path = `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
            const labelX = (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8;
            const labelY = (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8;
            const labelWidth = Math.max(
              58,
              Math.min(230, relationship.type.length * 6.5 + 20),
            );
            return (
              <g
                key={relationship.id}
                className="canvas-relationship"
                data-relationship-id={relationship.id}
              >
                <path
                  className="canvas-relationship-line"
                  d={path}
                  markerEnd={
                    relationship.directed ? `url(#${arrowId})` : undefined
                  }
                />
                <path
                  className="canvas-relationship-hit"
                  d={path}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect relationship: ${relationship.type}${relationship.label ? `, ${relationship.label}` : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRelationship(relationship.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onRelationship(relationship.id);
                    }
                  }}
                >
                  <title>{relationship.label || relationship.type}</title>
                </path>
                {!overview && (
                  <g
                    className="canvas-relationship-label"
                    transform={`translate(${labelX}, ${labelY})`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRelationship(relationship.id);
                    }}
                  >
                    <rect
                      x={-labelWidth / 2}
                      y={-11}
                      width={labelWidth}
                      height={22}
                      rx={6}
                    />
                    <text textAnchor="middle" dominantBaseline="central">
                      {relationship.type.length > 32
                        ? `${relationship.type.slice(0, 31)}...`
                        : relationship.type}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {visible.map((p) => {
          const resolved = resolvePlacement(workspace, p);
          const document = documents.get(p.documentId);
          const isExcerpt = p.kind === "excerpt" || p.kind === "frozen";
          const deleted =
            resolved.state === "trashed" ||
            (resolved.missingIds.length > 0 &&
              resolved.missingIds.some((id) =>
                document?.deletedBlocks.some((block) => block.id === id),
              ));
          const title =
            p.kind === "note"
              ? p.text
                  ?.split("\n")
                  .find((line) => line.trim())
                  ?.slice(0, 100) || "Untitled note"
              : resolved.title || "Untitled document";
          const Icon =
            p.kind === "note"
              ? StickyNote
              : p.kind === "image"
                ? ImageIcon
                : p.kind === "frozen"
                  ? Snowflake
                  : isExcerpt
                    ? Quote
                    : FileText;
          const stateLabel =
            resolved.state === "frozen"
              ? "Frozen copy"
              : resolved.state === "trashed"
                ? "Deleted document"
                : resolved.state === "archived"
                  ? "Archived"
                  : deleted
                    ? "Deleted passage"
                    : resolved.state === "missing"
                      ? "Missing source"
                      : null;
          const StateIcon =
            resolved.state === "frozen"
              ? Snowflake
              : resolved.state === "archived"
                ? Archive
                : deleted
                  ? Trash2
                  : TriangleAlert;
          const paragraphs = resolved.blocks.filter(
            (block) => block.type === "paragraph",
          );
          const blocks =
            reading || isExcerpt || p.kind === "note" || p.kind === "image"
              ? resolved.blocks
              : paragraphs.length
                ? [paragraphs[0]]
                : resolved.blocks.slice(0, 1);
          const words = resolved.blocks.reduce(
            (count, block) => count + (block.text.match(/\S+/g)?.length || 0),
            0,
          );
          return (
            <article
              key={p.id}
              className={`map-card map-card-${p.kind}${selected.has(p.id) ? " canvas-selected" : ""}${pendingId === p.id ? " canvas-connect-pending" : ""}${overview ? " map-card-overview" : ""}${reading ? " map-card-readable" : ""}${stateLabel ? ` map-card-state-${resolved.state}` : ""}`}
              data-placement-id={p.id}
              data-document-id={p.documentId}
              data-state={
                deleted && resolved.state !== "archived"
                  ? "deleted"
                  : resolved.state
              }
              style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
              tabIndex={0}
              aria-label={`${p.kind}: ${title}${stateLabel ? `, ${stateLabel}` : ""}`}
              aria-roledescription="canvas card"
              onClick={(event) => {
                if (event.target.closest(interactive)) return;
                const textSelection = window.getSelection();
                if (
                  tool !== "connect" &&
                  textSelection &&
                  !textSelection.isCollapsed &&
                  event.currentTarget.contains(textSelection.anchorNode)
                )
                  return;
                activateCard(p, event);
              }}
              onDoubleClick={(event) => {
                if (
                  !event.target.closest(interactive) &&
                  tool !== "connect" &&
                  tool !== "hand" &&
                  !spaceRef.current
                ) {
                  event.stopPropagation();
                  onOpen(p);
                }
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (tool === "connect") activateCard(p, event);
                  else onOpen(p);
                }
                if (event.key === " " && (event.shiftKey || event.metaKey)) {
                  event.preventDefault();
                  event.stopPropagation();
                  selectId(p.id, true);
                }
              }}
            >
              <header className="canvas-card-header">
                <button
                  type="button"
                  className="canvas-card-move"
                  aria-label={`Move ${title}`}
                  title={`Move ${title}`}
                  onPointerDown={(event) => beginMove(event, p)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.detail === 0 || tool === "connect")
                      activateCard(p, event);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (tool === "select") onOpen(p);
                  }}
                >
                  <Icon size={13} strokeWidth={1.6} />
                  <span>
                    {p.kind === "frozen"
                      ? "Frozen excerpt"
                      : p.kind === "excerpt"
                        ? "Excerpt"
                        : p.kind}
                  </span>
                  <GripVertical className="canvas-card-grip" size={13} />
                </button>
                {p.kind === "excerpt" && resolved.state === "live" && (
                  <span
                    className="canvas-live"
                    title="Live excerpt: follows its exact source blocks"
                  >
                    <i />
                    Live
                  </span>
                )}
                {stateLabel && (
                  <span
                    className={`canvas-state${resolved.state === "frozen" ? " canvas-state-frozen" : ""}`}
                    title={stateLabel}
                  >
                    <StateIcon size={11} />
                    <span>{stateLabel}</span>
                  </span>
                )}
              </header>
              {overview ? (
                <div className="canvas-card-title-only">
                  <h2
                    style={{
                      fontSize: Math.min(100, Math.max(32, 10 / camera.zoom)),
                    }}
                  >
                    {title}
                  </h2>
                  {stateLabel && <span>{stateLabel}</span>}
                </div>
              ) : (
                <>
                  <CardSurface
                    placement={p}
                    reading={reading}
                    onViewChange={(placementId, view) =>
                      onBoardChange(
                        {
                          ...board,
                          placements: board.placements.map((item) =>
                            item.id === placementId ? { ...item, view } : item,
                          ),
                        },
                        false,
                      )
                    }
                  >
                    {p.kind !== "note" && p.kind !== "image" && (
                      <h2 className="canvas-card-title">{title}</h2>
                    )}
                    {p.kind === "document" &&
                      document?.summary &&
                      resolved.state !== "trashed" && (
                        <p className="canvas-card-summary">
                          {document.summary}
                        </p>
                      )}
                    {stateLabel && resolved.state !== "frozen" && (
                      <p className="canvas-source-notice">
                        {resolved.state === "trashed"
                          ? "The source is in Trash. Open it to restore this document."
                          : resolved.state === "archived"
                            ? `This source is archived.${resolved.missingIds.length ? " An exact source passage is deleted or missing." : " Its original content is preserved."}`
                            : deleted
                              ? "An exact source passage was deleted. Open the source to restore it."
                              : "The original source is unavailable. This card has not been replaced."}
                      </p>
                    )}
                    {p.kind === "frozen" && (
                      <p className="canvas-captured">
                        <Snowflake size={11} />
                        {p.capturedAt ? (
                          <time dateTime={p.capturedAt} title={p.capturedAt}>
                            Captured{" "}
                            {new Date(p.capturedAt).toLocaleString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "UTC",
                            })}{" "}
                            UTC
                          </time>
                        ) : (
                          "Capture time not recorded"
                        )}
                      </p>
                    )}
                    <div
                      className={`canvas-card-body${isExcerpt ? " canvas-quote-body" : ""}`}
                    >
                      {isExcerpt && (
                        <Quote
                          className="canvas-quote-mark"
                          size={20}
                          strokeWidth={1.4}
                          aria-hidden="true"
                        />
                      )}
                      {blocks.map((block) => {
                        const Element = /^heading[123]$/.test(block.type)
                          ? `h${Math.min(6, Number(block.type.slice(-1)) + 2)}`
                          : block.type === "quote"
                            ? "blockquote"
                            : block.type === "code"
                              ? "pre"
                              : "p";
                        return (
                          <div
                            className={`canvas-block canvas-block-${block.type}`}
                            key={block.id}
                            data-block-id={block.id}
                          >
                            {block.type === "image" ? (
                              <>
                                <LocalImage
                                  asset={assets.get(block.assetId)}
                                  alt={block.text}
                                />
                                {block.text && (
                                  <p className="canvas-image-caption">
                                    {block.text}
                                  </p>
                                )}
                              </>
                            ) : (
                              <Element>
                                {block.type === "checklist" && (
                                  <span
                                    className={`canvas-checkbox${block.checked ? " canvas-checkbox-checked" : ""}`}
                                    aria-label={
                                      block.checked ? "Checked" : "Unchecked"
                                    }
                                  >
                                    {block.checked && <Check size={11} />}
                                  </span>
                                )}
                                {block.type === "list" && (
                                  <span
                                    className="canvas-list-dot"
                                    aria-hidden="true"
                                  />
                                )}
                                {block.text}
                              </Element>
                            )}
                          </div>
                        );
                      })}
                      {!resolved.blocks.length && resolved.state === "live" && (
                        <p className="canvas-blank-document">
                          A blank page, full of possibility.
                          <br />
                          Open it to start writing.
                        </p>
                      )}
                    </div>
                  </CardSurface>
                  {isExcerpt && p.documentId && (
                    <button
                      type="button"
                      className="canvas-source-action"
                      title={`Open exact source: ${document?.title || p.documentId}`}
                      aria-label={`Open source: ${document?.title || p.documentId}`}
                      onClick={() => onOpen(p)}
                    >
                      <Link2 size={11} />
                      <span>{document?.title || "Open original source"}</span>
                      <ArrowUpRight size={12} />
                    </button>
                  )}
                  <footer className="canvas-card-footer">
                    <div className="canvas-card-tags">
                      {document?.tags.slice(0, 2).map((tag) => (
                        <span className="canvas-card-tag" title={tag} key={tag}>
                          {tag}
                        </span>
                      ))}
                      {!document && (
                        <span className="canvas-card-kind">
                          {p.kind === "note"
                            ? "A thought in progress"
                            : p.kind === "image"
                              ? "Local image"
                              : "Independent copy"}
                        </span>
                      )}
                    </div>
                    {p.kind !== "image" && (
                      <span className="canvas-wordcount">
                        {words.toLocaleString()} words
                      </span>
                    )}
                  </footer>
                </>
              )}
              {resizeHandle(p, title)}
            </article>
          );
        })}
        {marquee && (
          <div
            className="canvas-marquee"
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.w,
              height: marquee.h,
              borderWidth: 1 / camera.zoom,
            }}
          />
        )}
      </div>

      {!entities.length && (
        <div className="canvas-empty">
          <div className="canvas-empty-sketch" aria-hidden="true">
            <span />
            <span />
            <span />
            <FileText size={30} strokeWidth={1.2} />
          </div>
          <span className="canvas-empty-eyebrow">A little space to begin</span>
          <h2>
            Give your thinking
            <br />a little room.
          </h2>
          <p>
            Bring a document, leave a thought.
            <br />
            The connections can come later.
          </p>
          <button
            type="button"
            className="canvas-empty-primary"
            onClick={() => onNew("document")}
          >
            <Plus size={15} />
            New document
          </button>
          <button
            type="button"
            className="canvas-empty-secondary"
            onClick={() => onNew("place")}
          >
            Place an existing document
            <ArrowUpRight size={14} />
          </button>
        </div>
      )}

      {tool === "connect" && (
        <div className="canvas-connect-hint canvas-controls" role="status">
          <Link2 size={14} />
          <span>
            {pendingId
              ? "Choose another card to connect."
              : "Choose the first card to connect."}
          </span>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              setTool("select");
            }}
            title="Cancel connection (Esc)"
            aria-label="Cancel connection"
          >
            Esc
          </button>
        </div>
      )}

      <div
        className="canvas-controls canvas-toolbar"
        role="toolbar"
        aria-label="Canvas tools"
      >
        {toolbarButton(
          "Select (V)",
          MousePointer2,
          () => setTool("select"),
          tool === "select" && !spaceHeld,
        )}
        {toolbarButton(
          "Hand (H; hold Space to pan)",
          Hand,
          () => setTool("hand"),
          tool === "hand" || spaceHeld,
        )}
        <span className="canvas-tool-divider" />
        {toolbarButton("New document", FileText, () => onNew("document"))}
        {toolbarButton("New note", StickyNote, () => onNew("note"))}
        {toolbarButton("Add local image", ImageIcon, () => onNew("image"))}
        {toolbarButton(
          "Connect cards",
          Link2,
          () => setTool(tool === "connect" ? "select" : "connect"),
          tool === "connect",
        )}
        {toolbarButton("New frame", Frame, () => onNew("frame"))}
        <span className="canvas-tool-divider" />
        {toolbarButton("Arrange selection", LayoutGrid, () => onNew("arrange"))}
      </div>

      <div className="canvas-navigation">
        <svg
          className="minimap"
          viewBox="0 0 150 95"
          role="button"
          tabIndex={0}
          aria-label="Board minimap. Click to move; arrow keys to pan."
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x =
              mapLeft +
              (((event.clientX - bounds.left) * 150) / bounds.width - mapX) /
                mapScale;
            const y =
              mapTop +
              (((event.clientY - bounds.top) * 95) / bounds.height - mapY) /
                mapScale;
            const { width, height } = getSize();
            changeCamera({
              ...cameraRef.current,
              x: width / 2 - x * cameraRef.current.zoom,
              y: height / 2 - y * cameraRef.current.zoom,
            });
          }}
          onKeyDown={(event) => {
            const directions = {
              ArrowLeft: [80, 0],
              ArrowRight: [-80, 0],
              ArrowUp: [0, 80],
              ArrowDown: [0, -80],
            };
            if (directions[event.key]) {
              event.preventDefault();
              event.stopPropagation();
              const [x, y] = directions[event.key];
              changeCamera({
                ...cameraRef.current,
                x: cameraRef.current.x + x,
                y: cameraRef.current.y + y,
              });
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              fit([]);
            }
          }}
        >
          <title>Overview of all cards and frames</title>
          {frames.map((frame) => (
            <rect
              key={frame.id}
              className="minimap-frame"
              {...mapRect(frame)}
              rx={1}
            />
          ))}
          {placements.map((p) => (
            <rect
              key={p.id}
              className={`minimap-card${selected.has(p.id) ? " minimap-selected" : ""}${p.kind === "note" ? " minimap-note" : ""}`}
              {...mapRect(p)}
              rx={1}
            />
          ))}
          <rect className="minimap-viewport" {...mapRect(viewport)} rx={2} />
        </svg>
        <div
          className="canvas-controls canvas-zoom"
          role="group"
          aria-label="Canvas zoom"
        >
          {toolbarButton("Zoom out (-)", Minus, () => zoom(1 / 1.2))}
          <button
            type="button"
            className="canvas-zoom-percent"
            title="Reset to 100%"
            aria-label={`Zoom ${Math.round(camera.zoom * 100)}%. Reset to 100%`}
            onClick={() => zoom(1 / cameraRef.current.zoom)}
          >
            {Math.round(camera.zoom * 100)}
            <span>%</span>
          </button>
          {toolbarButton("Zoom in (+)", Plus, () => zoom(1.2))}
          <span className="canvas-tool-divider" />
          {toolbarButton("Fit board (0); fit selection (F)", Scan, () => fit())}
        </div>
      </div>
      <div className="canvas-controls canvas-hint">
        <span>
          Drag headers to move <span aria-hidden="true">{"\u00b7"}</span> Space
          to pan
        </span>
        {selection.length > 0 && (
          <span className="canvas-selection-count" role="status">
            {selection.length} selected
            <button
              type="button"
              aria-label="Fit selected cards"
              title="Fit selection (F)"
              onClick={() => fit()}
            >
              <Maximize size={11} />
            </button>
          </span>
        )}
      </div>
    </section>
  );
});

export default Canvas;
