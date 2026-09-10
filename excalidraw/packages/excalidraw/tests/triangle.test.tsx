import {
  KEYS,
  MIME_TYPES,
  ROUNDNESS,
  STROKE_WIDTH,
  reseed,
} from "@excalidraw/common";
import {
  getContainerCenter,
  getNonDeletedElements,
  isTextElement,
  newElementWith,
} from "@excalidraw/element";
import { exportToCanvas, exportToSvg } from "@excalidraw/utils";

import type { ExcalidrawArrowElement } from "@excalidraw/element/types";

import { actionDuplicateSelection } from "../actions/actionDuplicateSelection";
import { createPasteEvent } from "../clipboard";
import { getToolShortcut } from "../components/Tools";
import { serializeAsJSON } from "../data/json";
import { reconcileElements } from "../data/reconcile";
import { restoreAppState, restoreElements } from "../data/restore";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import {
  act,
  fireEvent,
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
  togglePopover,
  unmountComponent,
  waitFor,
  within,
} from "./test-utils";

import type { RemoteExcalidrawElement } from "../data/reconcile";
import type { ImportedDataState } from "../data/types";

type CanvasEvent = { type: string; props: Record<string, unknown> };
type MockCanvasContext = CanvasRenderingContext2D & {
  __getEvents(): CanvasEvent[];
  __clearEvents(): void;
};

const { h } = window;
const mouse = new Pointer("mouse");
const touch = new Pointer("touch");

const drawTriangle = () =>
  UI.createElement("triangle", { x: 100, y: 100, width: 200, height: 100 });

describe("native triangle integration", () => {
  beforeEach(async () => {
    unmountComponent();
    mockBoundingClientRect({ width: 1280, height: 900 });
    reseed(7);
    await render(
      <Excalidraw
        autoFocus
        handleKeyboardGlobally
        initialData={{
          appState: {
            currentItemBackgroundColor: "#a5d8ff",
            currentItemFillStyle: "solid",
            currentItemRoughness: 0,
            currentItemRoundness: "round",
          },
        }}
      />,
    );
  });

  afterEach(async () => {
    await act(async () => {});
    unmountComponent();
    restoreOriginalGetBoundingClientRect();
  });

  it("exposes an accessible desktop tool without stealing existing shortcuts", () => {
    const button = screen.getByRole("button", {
      name: "Triangle",
    });
    expect(button).toHaveAttribute("data-testid", "toolbar-triangle");
    expect(button).toHaveAttribute("title", "Triangle");
    expect(button).not.toHaveAttribute("aria-keyshortcuts");
    expect(button.querySelector(".ToolIcon__keybinding")).toBeNull();
    expect(getToolShortcut("triangle")).toBe("");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(h.state.activeTool.type).toBe("triangle");
    expect(GlobalTestState.interactiveCanvas.style.cursor).toBe("crosshair");

    Keyboard.keyPress(KEYS.T);
    expect(h.state.activeTool.type).toBe("text");
    for (const [key, type] of [
      ["2", "rectangle"],
      ["3", "diamond"],
      ["4", "ellipse"],
      ["5", "arrow"],
      ["6", "line"],
      ["7", "freedraw"],
      ["8", "text"],
    ]) {
      Keyboard.keyPress(key);
      expect(h.state.activeTool.type).toBe(type);
    }
  });

  it("applies fill, stroke, roughness and opacity controls while keeping sharp corners", () => {
    UI.clickTool("triangle");
    expect(screen.queryByTitle("Round")).toBeNull();
    togglePopover("Stroke");
    UI.clickOnTestId("color-red");
    togglePopover("Background");
    UI.clickOnTestId("color-blue");
    fireEvent.click(screen.getByTitle("Cross-hatch"));
    fireEvent.click(screen.getByTitle("Bold"));
    fireEvent.click(screen.getByTitle("Dotted"));
    fireEvent.click(screen.getByTitle("Cartoonist"));
    fireEvent.change(screen.getByTestId("opacity"), {
      target: { value: "60" },
    });

    const triangle = drawTriangle();
    expect(triangle.get()).toMatchObject({
      type: "triangle",
      backgroundColor: "#a5d8ff",
      strokeColor: "#e03131",
      fillStyle: "cross-hatch",
      strokeWidth: STROKE_WIDTH.bold,
      strokeStyle: "dotted",
      roughness: 2,
      opacity: 60,
      roundness: null,
    });
    expect(screen.queryByTitle("Round")).toBeNull();
    fireEvent.click(
      within(screen.getByRole("group", { name: "Fill" })).getByTitle("Solid"),
    );
    expect(triangle.fillStyle).toBe("solid");
  });

  it.each([
    { dx: 120, dy: 90, locked: false },
    { dx: -120, dy: 90, locked: false },
    { dx: 120, dy: -90, locked: true },
    { dx: -120, dy: -90, locked: true },
  ])(
    "draws a native triangle for drag ($dx, $dy), locked=$locked",
    ({ dx, dy, locked }) => {
      UI.clickTool("triangle");
      if (locked) {
        UI.clickTool("lock");
      }
      mouse.downAt(400, 300);
      mouse.moveTo(400 + dx, 300 + dy);
      mouse.up();

      expect(h.elements).toHaveLength(1);
      expect(h.elements[0]).toMatchObject({
        type: "triangle",
        x: 400 + Math.min(0, dx),
        y: 300 + Math.min(0, dy),
        width: Math.abs(dx),
        height: Math.abs(dy),
        roundness: null,
        isDeleted: false,
      });
      expect(h.elements[0]).not.toHaveProperty("points");
      expect(h.state.newElement).toBeNull();
      expect(h.state.activeTool.type).toBe(locked ? "triangle" : "selection");
      expect(h.state.selectedElementIds).toEqual(
        locked ? {} : { [h.elements[0].id]: true },
      );
    },
  );

  it("does not retain a zero-size triangle or enter multipoint creation", () => {
    UI.clickTool("triangle");
    mouse.clickAt(400, 300);
    expect(h.elements).toHaveLength(0);
    expect(h.state.newElement).toBeNull();
    expect(h.state.multiElement).toBeNull();
    expect(API.getUndoStack()).toHaveLength(0);
  });

  it.each([
    { trigger: "Enter", angle: 0 },
    { trigger: "Enter", angle: Math.PI / 4 },
    { trigger: "double-click", angle: 0 },
    { trigger: "double-click", angle: Math.PI / 4 },
  ])(
    "centers a tall triangle's label using $trigger at angle $angle",
    async ({ trigger, angle }) => {
      const triangle = UI.createElement("triangle", {
        x: 100,
        y: 100,
        width: 200,
        height: 240,
        angle,
      });
      API.setAppState({ currentItemTextAlign: "left" });
      const center = getContainerCenter(
        triangle.get(),
        h.app.scene.getNonDeletedElementsMap(),
      );
      if (trigger === "Enter") {
        Keyboard.keyPress(KEYS.ENTER);
      } else {
        mouse.doubleClickAt(center.x, center.y);
      }

      const editor = await getTextEditor();
      updateTextEditor(editor, "Label");
      Keyboard.exitTextEditor(editor);

      const text = h.elements.find(isTextElement)!;
      expect(text).toMatchObject({
        containerId: triangle.id,
        text: "Label",
        textAlign: "center",
        verticalAlign: "middle",
      });
      expect(text.angle).toBeCloseTo(angle);
      expect(text.x + text.width / 2).toBeCloseTo(center.x);
      expect(text.y + text.height / 2).toBeCloseTo(center.y);
    },
  );

  it("activates from the mobile shape picker and remembers the triangle option", async () => {
    mockBoundingClientRect({ width: 390, height: 844 });
    act(() => {
      h.app.refreshEditorInterface();
      h.app.refresh();
    });
    await waitFor(() => expect(h.app.editorInterface.formFactor).toBe("phone"));
    const toolbar =
      GlobalTestState.renderResult.container.querySelector<HTMLDivElement>(
        ".mobile-toolbar",
      )!;
    const trigger = within(toolbar).getByRole("button", {
      name: "Rectangle",
    });
    togglePopover("Rectangle");
    const picker = h.app.ownerDocument.querySelector<HTMLDivElement>(
      ".tool-popover-content",
    )!;
    fireEvent.click(within(picker).getByRole("button", { name: "Triangle" }));

    expect(h.state.activeTool.type).toBe("triangle");
    expect(trigger).toHaveAccessibleName("Triangle");
    expect(trigger).toHaveAttribute("aria-pressed", "true");
    touch.downAt(50, 150);
    touch.moveTo(250, 250);
    touch.up();
    expect(h.elements).toHaveLength(1);
    expect(h.elements[0].type).toBe("triangle");
    expect(h.state.activeTool.type).toBe("selection");
    expect(trigger).toHaveAccessibleName("Triangle");

    fireEvent.click(trigger);
    expect(h.state.activeTool.type).toBe("triangle");
  });

  it("round-trips native JSON and independently restores the locked active tool", () => {
    const triangle = drawTriangle();
    const data = JSON.parse(
      serializeAsJSON(h.elements, h.state, {}, "local"),
    ) as ImportedDataState;
    expect(data.type).toBe("excalidraw");
    expect(data.elements).toHaveLength(1);
    expect(data.elements![0].type).toBe("triangle");
    const restored = restoreElements(data.elements, null);
    expect(restored).toEqual([
      expect.objectContaining({
        id: triangle.id,
        type: "triangle",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        backgroundColor: "#a5d8ff",
        fillStyle: "solid",
        roundness: null,
      }),
    ]);
    expect(restored[0]).not.toHaveProperty("points");

    // Exported files omit the active tool; browser state restoration retains it.
    expect(data.appState).not.toHaveProperty("activeTool");
    const appState = restoreAppState(
      {
        activeTool: {
          ...h.state.activeTool,
          type: "triangle",
          customType: null,
          locked: true,
        },
      },
      null,
    );
    expect(appState.activeTool).toMatchObject({
      type: "triangle",
      locked: true,
    });
    API.updateScene({ elements: restored, appState });
    expect(h.elements[0].type).toBe("triangle");
    expect(screen.getByRole("button", { name: "Triangle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("restores negative dimensions and removes stale triangle roundness", () => {
    const [triangle] = restoreElements(
      [
        {
          ...API.createElement({ type: "triangle" }),
          x: 100,
          y: 200,
          width: -80,
          height: -60,
          roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
          strokeSharpness: "round",
        },
      ],
      null,
    );
    expect(triangle).toMatchObject({
      type: "triangle",
      x: 20,
      y: 140,
      width: 80,
      height: 60,
      roundness: null,
    });
    expect(triangle).not.toHaveProperty("strokeSharpness");
  });

  it("copies the selected triangle and pastes a native, independently identified copy", async () => {
    const triangle = drawTriangle();
    const contents = new Map<string, string>();
    const clipboardData = {
      setData: (type: string, value: string) => contents.set(type, value),
      getData: (type: string) => contents.get(type) ?? "",
    };
    // The shared ClipboardEvent polyfill always creates a paste event.
    const copyEvent = new h.app.ownerWindow.Event("copy", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(copyEvent, "clipboardData", { value: clipboardData });
    fireEvent(h.app.ownerDocument, copyEvent);
    await waitFor(() =>
      expect(contents.has(MIME_TYPES.excalidrawClipboard)).toBe(true),
    );
    const json = clipboardData.getData(MIME_TYPES.excalidrawClipboard);
    expect(JSON.parse(json).elements).toEqual([
      expect.objectContaining({ type: "triangle", id: triangle.id }),
    ]);

    mouse.moveTo(600, 400);
    const ownerDocument = h.app.ownerDocument;
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(
      ownerDocument,
      "elementFromPoint",
    );
    Object.defineProperty(ownerDocument, "elementFromPoint", {
      configurable: true,
      value: () => GlobalTestState.interactiveCanvas,
    });
    try {
      await act(async () => {
        await h.app.pasteFromClipboard(
          createPasteEvent({ types: { [MIME_TYPES.text]: json } }),
        );
      });
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(
          ownerDocument,
          "elementFromPoint",
          originalElementFromPoint,
        );
      } else {
        Reflect.deleteProperty(ownerDocument, "elementFromPoint");
      }
    }
    expect(h.elements).toHaveLength(2);
    const pasted = API.getSelectedElement();
    expect(pasted.id).not.toBe(triangle.id);
    expect(pasted.seed).not.toBe(triangle.seed);
    expect(pasted).toMatchObject({
      type: "triangle",
      width: 200,
      height: 100,
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
      roundness: null,
    });
    expect(pasted).not.toHaveProperty("points");
  });

  it("restores and reconciles remote triangle updates and deletion", () => {
    drawTriangle();
    const local = h.app.getSceneElements();
    const remote = restoreElements(
      [newElementWith(local[0], { x: 450, backgroundColor: "#ffc9c9" })],
      local,
    ) as RemoteExcalidrawElement[];
    const reconciled = reconcileElements(local, remote, h.state);
    API.updateScene({ elements: reconciled });
    expect(h.elements).toHaveLength(1);
    expect(h.elements[0]).toMatchObject({
      id: local[0].id,
      type: "triangle",
      x: 450,
      backgroundColor: "#ffc9c9",
    });
    expect(
      reconcileElements(
        reconciled,
        local as RemoteExcalidrawElement[],
        h.state,
      )[0].x,
    ).toBe(450);

    const deletion = restoreElements(
      [newElementWith(reconciled[0], { isDeleted: true })],
      reconciled,
    ) as unknown as RemoteExcalidrawElement[];
    API.updateScene({
      elements: reconcileElements(reconciled, deletion, h.state),
    });
    expect(h.elements[0]).toMatchObject({ type: "triangle", isDeleted: true });
    expect(h.app.getSceneElements()).toHaveLength(0);
  });

  it("paints the editor canvas and exports a filled three-vertex canvas path", async () => {
    const context = GlobalTestState.canvas.getContext(
      "2d",
    ) as MockCanvasContext;
    context.__clearEvents();
    drawTriangle();
    expect(
      context.__getEvents().some((event) => event.type === "drawImage"),
    ).toBe(true);

    const canvas = await exportToCanvas({
      elements: getNonDeletedElements(h.elements),
      files: {},
      appState: { exportBackground: false },
      exportPadding: 0,
    });
    const events = (canvas.getContext("2d") as MockCanvasContext).__getEvents();
    const fill = events.find((event) => event.type === "fill");
    expect(fill).toBeDefined();
    expect(fill!.props.path).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "moveTo", props: { x: 100, y: 0 } }),
        expect.objectContaining({ type: "lineTo", props: { x: 200, y: 100 } }),
        expect.objectContaining({ type: "lineTo", props: { x: 0, y: 100 } }),
      ]),
    );
    expect(events.some((event) => event.type === "stroke")).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "fillStyle",
        props: { value: "#a5d8ff" },
      }),
    );
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
  });

  it.each(["solid", "hachure"] as const)(
    "exports visible SVG geometry with %s fill, stroke, opacity and rotation",
    async (fillStyle) => {
      const triangle = UI.createElement("triangle", {
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        angle: Math.PI / 2,
      });
      API.updateElement(triangle.get(), {
        fillStyle,
        strokeColor: "#e03131",
        strokeWidth: 2,
        strokeStyle: "dashed",
        opacity: 60,
      });
      const svg = await exportToSvg({
        elements: getNonDeletedElements(h.elements),
        files: {},
        appState: { exportBackground: false },
        exportPadding: 10,
      });
      const node = svg.querySelector(`[data-id="${triangle.id}"]`)!;
      expect(node).not.toBeNull();
      expect(node).toHaveAttribute(
        "transform",
        "translate(-40 60) rotate(90 100 50)",
      );
      expect(node).toHaveAttribute("stroke-opacity", "0.6");
      expect(node).toHaveAttribute("fill-opacity", "0.6");
      const outline = node.querySelector('path[stroke="#e03131"]')!;
      expect(outline).not.toBeNull();
      expect(outline.getAttribute("d")!.length).toBeGreaterThan(20);
      // Rough options add 0.5 to non-solid stroke widths.
      expect(outline).toHaveAttribute("stroke-width", "2.5");
      expect(outline).toHaveAttribute("stroke-dasharray", "8 10");
      const fill = node.querySelector(
        fillStyle === "solid"
          ? 'path[fill="#a5d8ff"]'
          : 'path[stroke="#a5d8ff"]',
      );
      expect(fill).not.toBeNull();
      expect(fill!.getAttribute("d")!.length).toBeGreaterThan(20);
      expect(svg).toHaveAttribute("viewBox", "0 0 120 220");
    },
  );

  it("does not hit empty bounding-box corners but selects the filled interior", () => {
    const triangle = drawTriangle();
    API.clearSelection();
    mouse.clickAt(110, 110);
    expect(API.getSelectedElements()).toHaveLength(0);
    mouse.clickAt(290, 110);
    expect(API.getSelectedElements()).toHaveLength(0);
    mouse.clickAt(200, 175);
    expect(API.getSelectedElement().id).toBe(triangle.id);
  });

  it("does not box-select a triangle when only its empty bounding-box corner overlaps", () => {
    const triangle = drawTriangle();
    API.clearSelection();
    API.setAppState({ boxSelectionMode: "overlap" });
    mouse.downAt(80, 80);
    mouse.move(-20, -20);
    mouse.moveTo(125, 125);
    mouse.up();
    expect(API.getSelectedElements()).toHaveLength(0);

    mouse.downAt(80, 80);
    mouse.move(-20, -20);
    mouse.moveTo(320, 220);
    mouse.up();
    expect(API.getSelectedElement().id).toBe(triangle.id);
  });

  it("moves the triangle and undoes/redoes both movement and creation", () => {
    const triangle = drawTriangle();
    mouse.downAt(200, 175);
    mouse.move(40, 30);
    mouse.up();
    expect(triangle.get()).toMatchObject({
      type: "triangle",
      x: 140,
      y: 130,
      width: 200,
      height: 100,
    });
    Keyboard.undo();
    expect(triangle.get()).toMatchObject({ x: 100, y: 100 });
    Keyboard.undo();
    expect(h.app.getSceneElements()).toHaveLength(0);
    Keyboard.redo();
    expect(triangle.get()).toMatchObject({
      type: "triangle",
      isDeleted: false,
      x: 100,
      y: 100,
    });
    Keyboard.redo();
    expect(triangle.get()).toMatchObject({ x: 140, y: 130 });
  });

  it("duplicates and deletes a native triangle with undo/redo preserving identity and styles", () => {
    const triangle = drawTriangle();
    API.executeAction(actionDuplicateSelection);
    const copy = API.getSelectedElement();
    expect(h.app.getSceneElements()).toHaveLength(2);
    expect(copy.id).not.toBe(triangle.id);
    expect(copy).toMatchObject({
      type: "triangle",
      width: 200,
      height: 100,
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
      roundness: null,
    });
    Keyboard.keyPress(KEYS.DELETE);
    expect(h.app.getSceneElements().map((element) => element.id)).toEqual([
      triangle.id,
    ]);
    Keyboard.undo();
    expect(h.app.getSceneElements().map((element) => element.id)).toContain(
      copy.id,
    );
    Keyboard.undo();
    expect(h.app.getSceneElements().map((element) => element.id)).toEqual([
      triangle.id,
    ]);
    Keyboard.redo();
    expect(
      h.app.getSceneElements().find((element) => element.id === copy.id),
    ).toMatchObject({
      type: "triangle",
      backgroundColor: "#a5d8ff",
      roundness: null,
    });
    Keyboard.redo();
    expect(h.app.getSceneElements().map((element) => element.id)).toEqual([
      triangle.id,
    ]);
  });

  it("binds an arrow to the triangle and follows its movement", async () => {
    const triangle = drawTriangle();
    UI.clickTool("arrow");
    mouse.downAt(450, 150);
    mouse.moveTo(255, 150);
    mouse.up();
    const arrow = h.elements.find(
      (element): element is ExcalidrawArrowElement => element.type === "arrow",
    )!;
    await waitFor(() => expect(arrow.endBinding?.elementId).toBe(triangle.id));
    expect(triangle.boundElements).toContainEqual({
      type: "arrow",
      id: arrow.id,
    });
    const endpointY = arrow.y + arrow.points.at(-1)![1];

    API.setSelectedElements([...getNonDeletedElements([triangle.get()])]);
    mouse.downAt(200, 175);
    mouse.move(0, 80);
    mouse.up();
    const movedArrow = h.elements.find(
      (element): element is ExcalidrawArrowElement => element.id === arrow.id,
    )!;
    expect(triangle.y).toBe(180);
    expect(movedArrow.endBinding?.elementId).toBe(triangle.id);
    expect(movedArrow.y + movedArrow.points.at(-1)![1]).toBeGreaterThan(
      endpointY + 40,
    );
    expect(movedArrow.points.flat().every(Number.isFinite)).toBe(true);
  });
});
