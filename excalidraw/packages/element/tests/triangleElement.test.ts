import { BOUND_TEXT_PADDING, ROUNDNESS } from "@excalidraw/common";
import {
  pointFrom,
  polygonArea,
  polygonIncludesPoint,
  type GlobalPoint,
  type Radians,
} from "@excalidraw/math";
import { RoughGenerator } from "roughjs/bin/generator";

import { computeBucketFillPolygon, rendersOpaqueFill } from "../src/bucketFill";
import {
  canChangeRoundness,
  canHaveArrowheads,
  hasBackground,
  hasStrokeColor,
  hasStrokeStyle,
  hasStrokeWidth,
} from "../src/comparisons";
import {
  newElement,
  newTextElement,
  type ElementConstructorOpts,
} from "../src/newElement";
import {
  generateRoughOptions,
  getElementShape,
  ShapeCache,
} from "../src/shape";
import {
  computeBoundTextPosition,
  computeContainerDimensionForBoundText,
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  getContainerCenter,
  getContainerCoords,
  getTextElementAngle,
  isValidTextContainer,
} from "../src/textElement";
import { convertToExcalidrawElements } from "../src/transform";
import {
  canApplyRoundnessTypeToElement,
  getDefaultRoundnessTypeForElement,
  hasBoundTextElement,
  isArrowElement,
  isBindableElement,
  isEligibleFrameChildType,
  isExcalidrawElement,
  isFlowchartNodeElement,
  isLinearElement,
  isRectangularElement,
  isRectanguloidElement,
  isTextBindableContainer,
  isTextElement,
} from "../src/typeChecks";

import type {
  ExcalidrawTextElementWithContainer,
  ExcalidrawTriangleElement,
  NonDeleted,
} from "../src/types";

const triangle = (opts: Partial<ElementConstructorOpts> = {}) =>
  newElement({
    type: "triangle",
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    ...opts,
  }) as NonDeleted<ExcalidrawTriangleElement>;

const boundText: ExcalidrawTextElementWithContainer = {
  ...newTextElement({ x: 0, y: 0, text: "Label" }),
  containerId: "triangle",
  textAlign: "center",
  verticalAlign: "middle",
  width: 40,
  height: 20,
};

describe("triangle capabilities", () => {
  it("creates a native generic element without points or roundness", () => {
    const element = triangle();
    expect(element).toMatchObject({
      type: "triangle",
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      angle: 0,
      roundness: null,
      isDeleted: false,
    });
    expect(element).not.toHaveProperty("points");
    expect(isExcalidrawElement(element)).toBe(true);
    expect(isBindableElement(element)).toBe(true);
    expect(isTextBindableContainer(element)).toBe(true);
    expect(isValidTextContainer(element)).toBe(true);
    expect(isEligibleFrameChildType(element.type)).toBe(true);
    expect(isLinearElement(element)).toBe(false);
    expect(isRectanguloidElement(element)).toBe(false);
    expect(isRectangularElement(element)).toBe(false);
    expect(isFlowchartNodeElement(element)).toBe(false);
    expect(canHaveArrowheads(element.type)).toBe(false);
  });

  it("supports fill and stroke styling, but not rounded corners", () => {
    const element = triangle();
    expect(hasBackground(element.type)).toBe(true);
    expect(hasStrokeColor(element.type)).toBe(true);
    expect(hasStrokeWidth(element.type)).toBe(true);
    expect(hasStrokeStyle(element.type)).toBe(true);
    expect(canChangeRoundness(element.type)).toBe(false);
    expect(getDefaultRoundnessTypeForElement(element)).toBeNull();

    for (const type of Object.values(ROUNDNESS)) {
      expect(canApplyRoundnessTypeToElement(type, element)).toBe(false);
      expect(triangle({ roundness: { type } }).roundness).toBeNull();
    }
  });

  it("respects locked binding checks and recognizes bound text", () => {
    const element = triangle({
      locked: true,
      boundElements: [{ type: "text", id: boundText.id }],
    });
    expect(isBindableElement(element)).toBe(true);
    expect(isBindableElement(element, false)).toBe(false);
    expect(isTextBindableContainer(element)).toBe(true);
    expect(isTextBindableContainer(element, false)).toBe(false);
    expect(hasBoundTextElement(element)).toBe(true);
  });
});

describe("triangle shapes", () => {
  it("returns a closed polygon with the canonical vertices", () => {
    expect(getElementShape(triangle(), new Map())).toEqual({
      type: "polygon",
      data: [
        [110, 20],
        [210, 120],
        [10, 120],
        [110, 20],
      ],
    });
  });

  it("rotates the polygon around the true box center", () => {
    const shape = getElementShape(
      triangle({ angle: (Math.PI / 2) as Radians }),
      new Map(),
    );
    expect(shape.type).toBe("polygon");
    if (shape.type !== "polygon") {
      throw new Error("Expected a triangle polygon");
    }
    const expected = [
      [160, 70],
      [60, 170],
      [60, -30],
      [160, 70],
    ];
    expect(shape.data).toHaveLength(expected.length);
    shape.data.forEach(([x, y], index) => {
      expect(x).toBeCloseTo(expected[index][0]);
      expect(y).toBeCloseTo(expected[index][1]);
    });
  });

  it.each(["solid", "hachure", "cross-hatch", "zigzag"] as const)(
    "generates a single sharp rough polygon with %s fill",
    (fillStyle) => {
      const element = triangle({
        seed: 123,
        fillStyle,
        backgroundColor: "#a5d8ff",
        strokeStyle: "dashed",
      });
      const options = generateRoughOptions(element);
      expect(options).toMatchObject({
        fill: "#a5d8ff",
        fillStyle,
        strokeLineDash: [8, 8 + element.strokeWidth],
      });
      const shape = ShapeCache.generateElementShape(element, null);
      expect(shape).toEqual(
        new RoughGenerator().polygon(
          [
            [100, 0],
            [200, 100],
            [0, 100],
          ],
          options,
        ),
      );
      expect(ShapeCache.generateElementShape(element, null)).toBe(shape);
      // Even stale roundness data must not change triangle geometry.
      expect(
        ShapeCache.generateElementShape(
          { ...element, roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS } },
          null,
        ),
      ).toEqual(shape);
    },
  );

  it("participates in bucket fill with a triangular boundary", () => {
    const element = triangle({ roughness: 0 });
    const result = computeBucketFillPolygon({
      point: pointFrom<GlobalPoint>(110, 95),
      elements: [element],
      elementsMap: new Map([[element.id, element]]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected a triangle fill");
    }
    expect(result.ownerId).toBe(element.id);
    expect(result.scenePoints[0]).toEqual(result.scenePoints.at(-1));
    expect(polygonArea(result.scenePoints)).toBeCloseTo(10000, -1);
    expect(rendersOpaqueFill(element)).toBe(false);
    expect(
      rendersOpaqueFill(
        triangle({ fillStyle: "solid", backgroundColor: "#a5d8ff" }),
      ),
    ).toBe(true);
  });
});

describe("triangle bound text", () => {
  it("uses the padded lower inscribed rectangle without rounding up", () => {
    const element = triangle({ width: 201.5, height: 101.5 });
    expect(getContainerCoords(element)).toEqual({
      x: element.x + element.width / 4 + BOUND_TEXT_PADDING,
      y: element.y + element.height / 2 + BOUND_TEXT_PADDING,
    });
    expect(getBoundTextMaxWidth(element, boundText)).toBe(
      element.width / 2 - BOUND_TEXT_PADDING * 2,
    );
    expect(getBoundTextMaxHeight(element, boundText)).toBe(
      element.height / 2 - BOUND_TEXT_PADDING * 2,
    );
  });

  it.each([0, 20, 150.25])("inverts text dimension %s with padding", (size) => {
    const dimension = computeContainerDimensionForBoundText(size, "triangle");
    expect(dimension).toBe(2 * (Math.ceil(size) + BOUND_TEXT_PADDING * 2));
    const element = triangle({ width: dimension, height: dimension });
    expect(getBoundTextMaxWidth(element, boundText)).toBe(Math.ceil(size));
    expect(getBoundTextMaxHeight(element, boundText)).toBe(Math.ceil(size));
  });

  it.each([0, Math.PI / 2, Math.PI, Math.PI / 5])(
    "positions every text alignment around the box center at angle %s",
    (angle) => {
      const element = triangle({ angle: angle as Radians });
      const shape = getElementShape<GlobalPoint>(element, new Map());
      if (shape.type !== "polygon") {
        throw new Error("Expected a triangle polygon");
      }
      for (const textAlign of ["left", "center", "right"] as const) {
        for (const verticalAlign of ["top", "middle", "bottom"] as const) {
          const text = { ...boundText, textAlign, verticalAlign };
          const x = { left: 65, center: 90, right: 115 }[textAlign];
          const y = { top: 75, middle: 85, bottom: 95 }[verticalAlign];
          const dx = x + text.width / 2 - 110;
          const dy = y + text.height / 2 - 70;
          const position = computeBoundTextPosition(element, text, new Map());
          expect(position.x).toBeCloseTo(
            110 + dx * Math.cos(angle) - dy * Math.sin(angle) - text.width / 2,
          );
          expect(position.y).toBeCloseTo(
            70 + dx * Math.sin(angle) + dy * Math.cos(angle) - text.height / 2,
          );
          expect(getTextElementAngle(text, element)).toBe(angle);

          for (const tx of [-text.width / 2, text.width / 2]) {
            for (const ty of [-text.height / 2, text.height / 2]) {
              const corner = pointFrom<GlobalPoint>(
                position.x +
                  text.width / 2 +
                  tx * Math.cos(angle) -
                  ty * Math.sin(angle),
                position.y +
                  text.height / 2 +
                  tx * Math.sin(angle) +
                  ty * Math.cos(angle),
              );
              expect(polygonIncludesPoint(corner, shape.data)).toBe(true);
            }
          }
        }
      }

      const position = computeBoundTextPosition(element, boundText, new Map());
      const center = getContainerCenter(element, new Map());
      expect(center.x).toBeCloseTo(position.x + boundText.width / 2);
      expect(center.y).toBeCloseTo(position.y + boundText.height / 2);
    },
  );
});

describe("triangle skeleton transforms", () => {
  it("creates a native triangle and its rotated label", () => {
    const elements = convertToExcalidrawElements(
      [
        {
          id: "triangle",
          type: "triangle",
          x: 10,
          y: 20,
          width: 200,
          height: 100,
          angle: (Math.PI / 2) as Radians,
          roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
          label: { text: "Label" },
        },
      ],
      { regenerateIds: false },
    );
    expect(elements).toHaveLength(2);
    const [container, text] = elements;
    expect(container).toMatchObject({
      id: "triangle",
      type: "triangle",
      roundness: null,
    });
    expect(container).not.toHaveProperty("points");
    expect(isTextElement(text)).toBe(true);
    if (!isTextElement(text)) {
      throw new Error("Expected a bound label");
    }
    expect(text.containerId).toBe(container.id);
    expect(container.boundElements).toEqual([{ id: text.id, type: "text" }]);
    expect(text.angle).toBe(container.angle);
    const center = getContainerCenter(container, new Map());
    expect(text.x + text.width / 2).toBeCloseTo(center.x);
    expect(text.y + text.height / 2).toBeCloseTo(center.y);
  });

  it("auto-sizes a triangle to fit a label with no supplied dimensions", () => {
    const [container, text] = convertToExcalidrawElements([
      { type: "triangle", x: 10, y: 20, label: { text: "Triangle\nlabel" } },
    ]);
    if (!isTextElement(text) || !text.containerId) {
      throw new Error("Expected a bound label");
    }
    expect(container.width).toBeGreaterThan(0);
    expect(container.height).toBeGreaterThan(0);
    expect(getBoundTextMaxWidth(container, text)).toBeGreaterThanOrEqual(
      text.width,
    );
    expect(
      getBoundTextMaxHeight(container, {
        ...text,
        containerId: text.containerId,
      }),
    ).toBeGreaterThanOrEqual(text.height);
  });

  it("supports triangle arrow endpoints through the generic constructor", () => {
    const elements = convertToExcalidrawElements([
      {
        type: "arrow",
        x: 300,
        y: 100,
        start: { type: "triangle" },
        end: { type: "triangle" },
      },
    ]);
    const arrow = elements.find(isArrowElement)!;
    const triangles = elements.filter((element) => element.type === "triangle");
    expect(triangles).toHaveLength(2);
    expect(arrow.startBinding?.elementId).toBe(triangles[0].id);
    expect(arrow.endBinding?.elementId).toBe(triangles[1].id);
    for (const element of triangles) {
      expect(element.roundness).toBeNull();
      expect(element.boundElements).toContainEqual({
        type: "arrow",
        id: arrow.id,
      });
    }
  });
});
