import { arrayToMap, cloneJSON } from "@excalidraw/common";
import {
  normalizeRadians,
  pointDistance,
  pointFrom,
  pointRotateRads,
  polygonIncludesPoint,
  type GlobalPoint,
  type Radians,
} from "@excalidraw/math";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  actionFlipHorizontal,
  actionFlipVertical,
} from "@excalidraw/excalidraw/actions";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  render,
  unmountComponent,
} from "@excalidraw/excalidraw/tests/test-utils";

import {
  getGlobalFixedPointForBindableElement,
  updateBoundElements,
} from "../src/binding";
import { getCommonBoundingBox } from "../src/bounds";
import { syncInvalidIndices } from "../src/fractionalIndex";
import { LinearElementEditor } from "../src/linearElementEditor";
import { newTextElement } from "../src/newElement";
import {
  resizeMultipleElements,
  resizeSingleElement,
  transformElements,
} from "../src/resizeElements";
import { Scene } from "../src/Scene";
import { getElementShape } from "../src/shape";
import { redrawTextBoundingBox } from "../src/textElement";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
  ExcalidrawTriangleElement,
  NonDeleted,
} from "../src/types";

const makeTriangle = (angle = 0) =>
  API.createElement({
    type: "triangle",
    x: 100,
    y: 80,
    width: 240,
    height: 180,
    angle,
  }) as NonDeleted<ExcalidrawTriangleElement>;

const snapshot = (scene: Scene) =>
  arrayToMap(cloneJSON(scene.getNonDeletedElements()));

const vertices = (element: ExcalidrawElement) => {
  const shape = getElementShape<GlobalPoint>(element, new Map());
  if (shape.type !== "polygon") {
    throw new Error("Expected a polygon");
  }
  return shape.data.slice(0, -1);
};

const expectPoint = (
  actual: readonly number[],
  expected: readonly number[],
) => {
  expect(actual[0]).toBeCloseTo(expected[0], 7);
  expect(actual[1]).toBeCloseTo(expected[1], 7);
};

const expectVertices = (
  element: ExcalidrawElement,
  expected: GlobalPoint[],
) => {
  const actual = vertices(element);
  expect(actual).toHaveLength(expected.length);
  for (const point of expected) {
    expect(actual.some((vertex) => pointDistance(vertex, point) < 1e-7)).toBe(
      true,
    );
  }
};

const scalePoint = (
  point: GlobalPoint,
  pivot: GlobalPoint,
  scaleX: number,
  scaleY: number,
  angle = 0,
) => {
  const local = pointRotateRads(point, pivot, -angle as Radians);
  return pointRotateRads(
    pointFrom<GlobalPoint>(
      pivot[0] + (local[0] - pivot[0]) * scaleX,
      pivot[1] + (local[1] - pivot[1]) * scaleY,
    ),
    pivot,
    angle as Radians,
  );
};

const expectLabelInside = (
  triangle: ExcalidrawTriangleElement,
  label: ExcalidrawTextElement,
) => {
  expect(label.angle).toBe(triangle.angle);
  const shape = getElementShape<GlobalPoint>(triangle, new Map());
  if (shape.type !== "polygon") {
    throw new Error("Expected a triangle polygon");
  }
  for (const corner of vertices(label)) {
    expect(polygonIncludesPoint(corner, shape.data)).toBe(true);
  }
};

const labeledTriangle = (angle: number) => {
  const triangle = makeTriangle(angle);
  const label = newTextElement({
    x: 0,
    y: 0,
    text: "Triangle label",
    fontSize: 20,
    containerId: triangle.id,
    textAlign: "center",
    verticalAlign: "middle",
  });
  const scene = new Scene(syncInvalidIndices([triangle, label]));
  scene.mutateElement(triangle, {
    boundElements: [{ id: label.id, type: "text" }],
  });
  redrawTextBoundingBox(label, triangle, scene);
  return { triangle, label, scene };
};

const boundTriangle = (
  angle: number,
  elbowed: boolean,
  end: "start" | "end" = "end",
) => {
  const triangle = makeTriangle(angle);
  const anchor = getGlobalFixedPointForBindableElement(
    [0.2, 0.6],
    triangle,
    new Map(),
  );
  const arrow = API.createElement({
    type: "arrow",
    x: end === "start" ? anchor[0] : anchor[0] - 300,
    y: anchor[1],
    width: 300,
    height: 0,
    points: [pointFrom(0, 0), pointFrom(300, 0)],
    elbowed,
    [end === "start" ? "startBinding" : "endBinding"]: {
      elementId: triangle.id,
      fixedPoint: [0.2, 0.6],
      mode: "inside",
    },
  }) as NonDeleted<ExcalidrawArrowElement>;
  const scene = new Scene(syncInvalidIndices([arrow, triangle]));
  scene.mutateElement(triangle, {
    boundElements: [{ id: arrow.id, type: "arrow" }],
  });
  updateBoundElements(triangle, scene);
  return { triangle, arrow, scene };
};

const flips = [
  { flipByX: true, flipByY: false },
  { flipByX: false, flipByY: true },
  { flipByX: true, flipByY: true },
];

describe.each([0, 0.63])("triangle transforms at angle %s", (angle) => {
  it.each(flips)(
    "mirrors single-resize vertices for $flipByX / $flipByY",
    ({ flipByX, flipByY }) => {
      for (const shouldResizeFromCenter of [false, true]) {
        const triangle = makeTriangle(angle);
        const scene = new Scene(syncInvalidIndices([triangle]));
        const originals = snapshot(scene);
        const original = cloneJSON(triangle);
        const center = pointFrom<GlobalPoint>(220, 170);
        const pivot = shouldResizeFromCenter
          ? center
          : pointRotateRads(
              pointFrom<GlobalPoint>(100, 80),
              center,
              angle as Radians,
            );
        const scaleX = flipByX ? -1.5 : 1.5;
        const scaleY = flipByY ? -1.5 : 1.5;
        resizeSingleElement(
          240 * scaleX,
          180 * scaleY,
          triangle,
          original,
          originals,
          scene,
          "se",
          { shouldResizeFromCenter },
        );
        expect(triangle.width).toBe(360);
        expect(triangle.height).toBe(270);
        expectVertices(
          triangle,
          vertices(original).map((point) =>
            scalePoint(point, pivot, scaleX, scaleY, angle),
          ),
        );
      }
    },
  );

  it("derives every sign crossing and return from the original geometry", () => {
    const triangle = makeTriangle(angle);
    const scene = new Scene(syncInvalidIndices([triangle]));
    const originals = snapshot(scene);
    const original = cloneJSON(triangle);
    for (const [sx, sy] of [
      [-1, 1],
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, -1],
      [1, 1],
    ]) {
      resizeSingleElement(
        240 * sx,
        180 * sy,
        triangle,
        original,
        originals,
        scene,
        "se",
        { shouldResizeFromCenter: true },
      );
      expect(triangle.angle).toBe(
        normalizeRadians((angle + (sy < 0 ? Math.PI : 0)) as Radians),
      );
      expectVertices(
        triangle,
        vertices(original).map((point) =>
          scalePoint(point, pointFrom(220, 170), sx, sy, angle),
        ),
      );
    }
  });

  it.each(flips)(
    "keeps negatively resized labels inside for $flipByX / $flipByY",
    ({ flipByX, flipByY }) => {
      for (const shouldMaintainAspectRatio of [false, true]) {
        const { triangle, label, scene } = labeledTriangle(angle);
        const originals = snapshot(scene);
        const original = cloneJSON(triangle);
        resizeSingleElement(
          flipByX ? -360 : 360,
          flipByY ? -270 : 270,
          triangle,
          original,
          originals,
          scene,
          "se",
          { shouldMaintainAspectRatio, shouldResizeFromCenter: true },
        );
        expect(triangle.width).toBe(360);
        expect(triangle.angle).toBe(
          normalizeRadians((angle + (flipByY ? Math.PI : 0)) as Radians),
        );
        expectLabelInside(triangle, label);
        resizeSingleElement(
          240,
          180,
          triangle,
          original,
          originals,
          scene,
          "se",
          { shouldMaintainAspectRatio, shouldResizeFromCenter: true },
        );
        expect(triangle.angle).toBe(angle);
        expectLabelInside(triangle, label);
      }
    },
  );

  it("preserves negative signs while clamping a label's minimum dimensions", () => {
    const { triangle, label, scene } = labeledTriangle(angle);
    const originals = snapshot(scene);
    resizeSingleElement(
      -1,
      -1,
      triangle,
      cloneJSON(triangle),
      originals,
      scene,
      "se",
      { shouldResizeFromCenter: true },
    );
    expect(triangle.angle).toBe(normalizeRadians((angle + Math.PI) as Radians));
    expect(triangle.width).toBeGreaterThan(1);
    expectLabelInside(triangle, label);
  });

  it("positions labels after positive resize and rotation", () => {
    const { triangle, label, scene } = labeledTriangle(angle);
    const originals = snapshot(scene);
    resizeSingleElement(
      360,
      270,
      triangle,
      cloneJSON(triangle),
      originals,
      scene,
      "se",
    );
    expectLabelInside(triangle, label);
    const nextAngle = 1.21;
    const cx = triangle.x + triangle.width / 2;
    const cy = triangle.y + triangle.height / 2;
    transformElements(
      snapshot(scene),
      "rotation",
      [triangle],
      scene,
      false,
      false,
      false,
      cx + 100 * Math.sin(nextAngle),
      cy - 100 * Math.cos(nextAngle),
      cx,
      cy,
    );
    expect(triangle.angle).toBeCloseTo(nextAngle);
    expectLabelInside(triangle, label);
  });

  it.each(flips)(
    "mirrors multiple vertices and labels for $flipByX / $flipByY",
    ({ flipByX, flipByY }) => {
      const { triangle, label, scene } = labeledTriangle(angle);
      const other = API.createElement({
        type: "rectangle",
        x: 500,
        y: 300,
        width: 100,
        height: 80,
      });
      scene.insertElement(other);
      const originals = snapshot(scene);
      const original = cloneJSON(triangle);
      const { midX, midY, width, height } = getCommonBoundingBox([
        triangle,
        other,
      ]);
      resizeMultipleElements(
        [triangle, other],
        scene.getNonDeletedElementsMap(),
        "se",
        scene,
        originals,
        {
          flipByX,
          flipByY,
          shouldResizeFromCenter: true,
          shouldMaintainAspectRatio: true,
          nextWidth: width * 1.5,
          nextHeight: height * 1.5,
        },
      );
      expectVertices(
        triangle,
        vertices(original).map((point) =>
          scalePoint(
            point,
            pointFrom(midX, midY),
            flipByX ? -1.5 : 1.5,
            flipByY ? -1.5 : 1.5,
          ),
        ),
      );
      expectLabelInside(triangle, label);
    },
  );

  describe.each([false, true])("arrow bindings, elbowed=%s", (elbowed) => {
    it("retains the existing binding when the arrow snapshot is unavailable", () => {
      const { triangle, arrow, scene } = boundTriangle(angle, elbowed);
      const originals = snapshot(scene);
      originals.delete(arrow.id);
      resizeSingleElement(
        -240,
        180,
        triangle,
        cloneJSON(triangle),
        originals,
        scene,
        "se",
        { shouldResizeFromCenter: true },
      );
      expectPoint(arrow.endBinding!.fixedPoint, [0.2, 0.6]);
      expectPoint(
        LinearElementEditor.getPointAtIndexGlobalCoordinates(
          arrow,
          -1,
          scene.getNonDeletedElementsMap(),
        ),
        getGlobalFixedPointForBindableElement(
          [0.2, 0.6],
          triangle,
          scene.getNonDeletedElementsMap(),
        ),
      );
    });

    it.each(["rectangle", "diamond", "ellipse"] as const)(
      "reflects both bound endpoints when connected to a selected %s",
      (type) => {
        const { triangle, arrow, scene } = boundTriangle(angle, elbowed);
        const other = API.createElement({
          type,
          x: 550,
          y: 350,
          angle,
        });
        scene.insertElement(other);
        scene.mutateElement(other, {
          boundElements: [{ type: "arrow", id: arrow.id }],
        });
        scene.mutateElement(arrow, {
          startBinding: {
            elementId: other.id,
            fixedPoint: [0.3, 0.4],
            mode: "inside",
          },
        });
        updateBoundElements(other, scene);
        const originals = snapshot(scene);
        const selected = [arrow, triangle, other];
        const { midX, midY } = getCommonBoundingBox(selected);
        const originalEndpoints = [0, -1].map((index) =>
          LinearElementEditor.getPointAtIndexGlobalCoordinates(
            arrow,
            index,
            originals,
          ),
        );
        for (const { flipByX, flipByY } of [
          ...flips,
          { flipByX: false, flipByY: false },
        ]) {
          resizeMultipleElements(
            selected,
            scene.getNonDeletedElementsMap(),
            "se",
            scene,
            originals,
            {
              flipByX,
              flipByY,
              shouldResizeFromCenter: true,
              shouldMaintainAspectRatio: true,
            },
          );
          for (const [index, endpoint] of originalEndpoints.entries()) {
            expectPoint(
              LinearElementEditor.getPointAtIndexGlobalCoordinates(
                arrow,
                index === 0 ? 0 : -1,
                scene.getNonDeletedElementsMap(),
              ),
              scalePoint(
                endpoint,
                pointFrom(midX, midY),
                flipByX ? -1 : 1,
                flipByY ? -1 : 1,
              ),
            );
          }
          expectPoint(arrow.startBinding!.fixedPoint, [
            flipByX ? 0.7 : 0.3,
            flipByY ? 0.6 : 0.4,
          ]);
          expectPoint(arrow.endBinding!.fixedPoint, [
            flipByX !== flipByY ? 0.8 : 0.2,
            0.6,
          ]);
        }
      },
    );

    it.each(["start", "end"] as const)(
      "reflects the %s anchor and restores it on back crossing",
      (end) => {
        const { triangle, arrow, scene } = boundTriangle(angle, elbowed, end);
        const originals = snapshot(scene);
        const original = cloneJSON(triangle);
        const prop = end === "start" ? "startBinding" : "endBinding";
        const initialAnchor = getGlobalFixedPointForBindableElement(
          [0.2, 0.6],
          original,
          originals,
        );
        for (const [sx, sy] of [
          [-1, 1],
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
          [1, 1],
        ]) {
          resizeSingleElement(
            240 * sx,
            180 * sy,
            triangle,
            original,
            originals,
            scene,
            "se",
            { shouldResizeFromCenter: true },
          );
          expectPoint(arrow[prop]!.fixedPoint, [sx !== sy ? 0.8 : 0.2, 0.6]);
          const expected = scalePoint(
            initialAnchor,
            pointFrom(220, 170),
            sx,
            sy,
            angle,
          );
          expectPoint(
            getGlobalFixedPointForBindableElement(
              arrow[prop]!.fixedPoint,
              triangle,
              scene.getNonDeletedElementsMap(),
            ),
            expected,
          );
          expectPoint(
            LinearElementEditor.getPointAtIndexGlobalCoordinates(
              arrow,
              end === "start" ? 0 : -1,
              scene.getNonDeletedElementsMap(),
            ),
            expected,
          );
        }
      },
    );

    it.each(["unselected", "before", "after"])(
      "remaps %s arrows during multi flips without queued updates overwriting them",
      (selection) => {
        const { triangle, arrow, scene } = boundTriangle(angle, elbowed);
        const other = API.createElement({ type: "rectangle", x: 550, y: 350 });
        scene.insertElement(other);
        const selected =
          selection === "unselected"
            ? [triangle, other]
            : selection === "before"
            ? [arrow, triangle, other]
            : [triangle, other, arrow];
        const originals = snapshot(scene);
        const original = cloneJSON(triangle);
        const { midX, midY } = getCommonBoundingBox(selected);
        const initialAnchor = getGlobalFixedPointForBindableElement(
          [0.2, 0.6],
          original,
          originals,
        );
        for (const { flipByX, flipByY } of [
          ...flips,
          { flipByX: false, flipByY: false },
        ]) {
          resizeMultipleElements(
            selected,
            scene.getNonDeletedElementsMap(),
            "se",
            scene,
            originals,
            {
              flipByX,
              flipByY,
              shouldResizeFromCenter: true,
              shouldMaintainAspectRatio: true,
            },
          );
          expectPoint(arrow.endBinding!.fixedPoint, [
            flipByX !== flipByY ? 0.8 : 0.2,
            0.6,
          ]);
          const expected = scalePoint(
            initialAnchor,
            pointFrom(midX, midY),
            flipByX ? -1 : 1,
            flipByY ? -1 : 1,
          );
          expectPoint(
            LinearElementEditor.getPointAtIndexGlobalCoordinates(
              arrow,
              -1,
              scene.getNonDeletedElementsMap(),
            ),
            expected,
          );
          expectVertices(
            triangle,
            vertices(original).map((point) =>
              scalePoint(
                point,
                pointFrom(midX, midY),
                flipByX ? -1 : 1,
                flipByY ? -1 : 1,
              ),
            ),
          );
        }
      },
    );
  });
});

it.each(["se", "nw"] as const)(
  "keeps successive signed %s pointer updates nonuniform after a triangle reflection",
  (handle) => {
    const triangle = makeTriangle();
    const rectangle = API.createElement({ type: "rectangle", x: 550, y: 350 });
    const selected = [triangle, rectangle];
    const scene = new Scene(syncInvalidIndices(selected));
    const originals = snapshot(scene);
    const { minX, minY, maxX, maxY, width, height, midX, midY } =
      getCommonBoundingBox(selected);
    const pivot =
      handle === "se"
        ? pointFrom<GlobalPoint>(minX, minY)
        : pointFrom<GlobalPoint>(maxX, maxY);
    const direction = handle === "se" ? 1 : -1;
    for (const [sx, sy] of [
      [2, -0.5],
      [1.25, -1.75],
      [-0.75, -1.5],
      [-1.5, 0.75],
      [1, 1],
    ]) {
      transformElements(
        originals,
        handle,
        selected,
        scene,
        false,
        false,
        false,
        pivot[0] + direction * width * sx,
        pivot[1] + direction * height * sy,
        midX,
        midY,
      );
      for (const element of selected) {
        const original = originals.get(element.id)!;
        expect(element.width).toBeCloseTo(original.width * Math.abs(sx));
        expect(element.height).toBeCloseTo(original.height * Math.abs(sy));
        expectVertices(
          element,
          vertices(original).map((point) => scalePoint(point, pivot, sx, sy)),
        );
      }
    }
  },
);

describe("triangle flip actions", () => {
  beforeEach(async () => {
    unmountComponent();
    await render(<Excalidraw />);
  });
  afterEach(() => unmountComponent());

  it.each([false, true])(
    "preserves live arrow bindings with the arrow selected=%s",
    (selected) => {
      const { triangle, arrow } = boundTriangle(0.63, false);
      API.setElements([arrow, triangle]);
      API.setAppState({
        selectedElementIds: {
          [triangle.id]: true,
          ...(selected ? { [arrow.id]: true } : {}),
        },
      });
      for (const action of [actionFlipHorizontal, actionFlipVertical]) {
        act(() => API.executeAction(action));
        const currentTriangle = window.h.elements.find(
          (element) => element.id === triangle.id,
        )! as ExcalidrawTriangleElement;
        const currentArrow = window.h.elements.find(
          (element) => element.id === arrow.id,
        )! as ExcalidrawArrowElement;
        expect(currentArrow.endBinding?.elementId).toBe(currentTriangle.id);
        expectPoint(
          LinearElementEditor.getPointAtIndexGlobalCoordinates(
            currentArrow,
            -1,
            window.h.app.scene.getNonDeletedElementsMap(),
          ),
          getGlobalFixedPointForBindableElement(
            currentArrow.endBinding!.fixedPoint,
            currentTriangle,
            window.h.app.scene.getNonDeletedElementsMap(),
          ),
        );
        act(() => API.executeAction(action));
      }
    },
  );

  it.each([0, 0.63])(
    "mirrors actual vertices and restores labels through actions at angle %s",
    (angle) => {
      const { triangle, label } = labeledTriangle(angle);
      API.setElements([triangle, label]);
      API.setAppState({ selectedElementIds: { [triangle.id]: true } });
      for (const action of [actionFlipHorizontal, actionFlipVertical]) {
        const current = window.h.elements.find(
          (element) => element.id === triangle.id,
        )!;
        const original = cloneJSON(current);
        const { midX, midY } = getCommonBoundingBox([current]);
        act(() => API.executeAction(action));
        const flipped = window.h.elements.find(
          (element) => element.id === triangle.id,
        )!;
        expectVertices(
          flipped,
          vertices(original).map((point) =>
            scalePoint(
              point,
              pointFrom(midX, midY),
              action === actionFlipHorizontal ? -1 : 1,
              action === actionFlipVertical ? -1 : 1,
            ),
          ),
        );
        expectLabelInside(
          flipped as ExcalidrawTriangleElement,
          window.h.elements.find(
            (element) => element.id === label.id,
          )! as ExcalidrawTextElement,
        );
        act(() => API.executeAction(action));
        expectVertices(
          window.h.elements.find((element) => element.id === triangle.id)!,
          vertices(original),
        );
      }
    },
  );
});
