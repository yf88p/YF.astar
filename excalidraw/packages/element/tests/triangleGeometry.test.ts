import { arrayToMap } from "@excalidraw/common";
import {
  lineSegment,
  pointFrom,
  pointRotateRads,
  vectorFromPoint,
} from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";
import type { AppState } from "@excalidraw/excalidraw/types";

import {
  bindPointToSnapToElementOutline,
  calculateFixedPointForNonElbowArrowBinding,
  getBindingGap,
  getBindingSideMidPoint,
  getGlobalFixedPointForBindableElement,
  snapToMid,
} from "../src/binding";
import {
  aabbForElement,
  elementCenterPoint,
  elementsOverlappingBBox,
  getElementBounds,
  getElementLineSegments,
} from "../src/bounds";
import {
  hitElementItself,
  intersectElementWithLineSegment,
  isBindableElementInsideOtherBindable,
  isPointInElement,
} from "../src/collision";
import { distanceToElement } from "../src/distance";
import { headingForPointFromElement, vectorToHeading } from "../src/heading";
import { newArrowElement, newElement } from "../src/newElement";
import {
  deconstructTriangleElement,
  getSnapOutlineMidPoint,
  getTriangleBindingPoints,
  getTrianglePoints,
} from "../src/utils";

import type {
  ElementsMap,
  ExcalidrawTriangleElement,
  NonDeleted,
} from "../src/types";

const triangle = (overrides: Partial<ExcalidrawTriangleElement> = {}) =>
  newElement({
    type: "triangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    roughness: 0,
    ...overrides,
  }) as NonDeleted<ExcalidrawTriangleElement>;

const globalPoint = (
  element: ExcalidrawTriangleElement,
  [x, y]: readonly [number, number],
) =>
  pointRotateRads(
    pointFrom<GlobalPoint>(element.x + x, element.y + y),
    pointFrom(element.x + element.width / 2, element.y + element.height / 2),
    element.angle,
  );

const expectPoint = (
  actual: readonly number[],
  expected: readonly number[],
) => {
  expect(actual[0]).toBeCloseTo(expected[0], 7);
  expect(actual[1]).toBeCloseTo(expected[1], 7);
};

describe("triangle geometry", () => {
  it("shares exact local vertices and stable unrotated binding anchors", () => {
    expect(getTrianglePoints({ width: 3, height: 7 })).toEqual([
      [1.5, 0],
      [3, 7],
      [0, 7],
    ]);
    const element = triangle({ x: 12, y: 20, angle: 1 as Radians });
    expect(getTriangleBindingPoints(element)).toEqual([
      [87, 70],
      [62, 120],
      [37, 70],
      [62, 20],
    ]);
    const [sides, corners] = deconstructTriangleElement(element);
    expect(sides).toEqual([
      [
        [62, 20],
        [112, 120],
      ],
      [
        [112, 120],
        [12, 120],
      ],
      [
        [12, 120],
        [62, 20],
      ],
    ]);
    expect(corners).toEqual([]);
    expect(deconstructTriangleElement(element, 5)[1].length).toBeGreaterThan(0);
  });

  it("keeps the box pivot independent of tight rotated bounds", () => {
    const element = triangle({ angle: (Math.PI / 4) as Radians });
    const map = arrayToMap([element]);
    const bounds = getElementBounds(element, map);
    expectPoint(bounds.slice(0, 2), [
      50 - 50 * Math.SQRT2,
      50 - 25 * Math.SQRT2,
    ]);
    expectPoint(bounds.slice(2), [50 + 25 * Math.SQRT2, 50 + 50 * Math.SQRT2]);
    expect(elementCenterPoint(element, map)).toEqual([50, 50]);
    expect(elementCenterPoint(element, map, 2, -3)).toEqual([52, 47]);
    expect(getElementBounds(element, map, true)).toEqual([0, 0, 100, 100]);
    expectPoint(aabbForElement(element, map).slice(0, 2), [
      50 - 50 * Math.SQRT2,
      50 - 50 * Math.SQRT2,
    ]);
    expectPoint(aabbForElement(element, map).slice(2), [
      50 + 50 * Math.SQRT2,
      50 + 50 * Math.SQRT2,
    ]);
  });

  describe.each([0, Math.PI / 4, Math.PI / 2, 2.3])("rotation %s", (angle) => {
    const makeElement = (overrides: Partial<ExcalidrawTriangleElement> = {}) =>
      triangle({ x: 123, y: -47, angle: angle as Radians, ...overrides });

    it("hits all three sides and vertices but not empty box corners", () => {
      const element = makeElement({ backgroundColor: "#ffffff" });
      const map = arrayToMap([element]);
      for (const point of [
        [50, 0],
        [100, 100],
        [0, 100],
        [75, 50],
        [50, 100],
        [25, 50],
      ] as const) {
        const global = globalPoint(element, point);
        expect(distanceToElement(element, map, global)).toBeCloseTo(0, 8);
        expect(
          hitElementItself({
            point: global,
            element,
            elementsMap: map,
            threshold: 0.1,
          }),
        ).toBe(true);
      }
      for (const point of [
        [0, 0],
        [100, 0],
        [5, 50],
        [95, 50],
      ] as const) {
        const global = globalPoint(element, point);
        expect(isPointInElement(global, element, map)).toBe(false);
        expect(
          hitElementItself({
            point: global,
            element,
            elementsMap: map,
            threshold: 0.1,
          }),
        ).toBe(false);
      }
      expect(
        isPointInElement(globalPoint(element, [50, 60]), element, map),
      ).toBe(true);
      expect(
        distanceToElement(element, map, globalPoint(element, [50, -10])),
      ).toBeCloseTo(10, 8);
    });

    it("keeps transparent interiors outline-only unless text is bound", () => {
      for (const bound of [false, true]) {
        const element = makeElement({
          backgroundColor: "transparent",
          boundElements: bound ? [{ id: "label", type: "text" }] : null,
        });
        const map = arrayToMap([element]);
        const point = globalPoint(element, [50, 60]);
        expect(distanceToElement(element, map, point)).toBeGreaterThan(2);
        expect(
          hitElementItself({ point, element, elementsMap: map, threshold: 2 }),
        ).toBe(bound);
      }
    });

    it("returns exactly the three rotated outline segments", () => {
      const element = makeElement();
      const segments = getElementLineSegments(element, arrayToMap([element]));
      const points = getTrianglePoints(element).map((point) =>
        globalPoint(element, point),
      );
      expect(segments).toHaveLength(3);
      segments.forEach(([a, b], index) => {
        expectPoint(a, points[index]);
        expectPoint(b, points[(index + 1) % 3]);
      });
    });

    it("intersects the apex once and honors constant-distance round gaps", () => {
      const element = makeElement();
      const map = arrayToMap([element]);
      const line = lineSegment(
        globalPoint(element, [50, -30]),
        globalPoint(element, [50, 130]),
      );
      for (const offset of [0, 5, 10]) {
        const intersections = intersectElementWithLineSegment(
          element,
          map,
          line,
          offset,
        );
        expect(intersections).toHaveLength(2);
        expectPoint(intersections[0], globalPoint(element, [50, -offset]));
        expectPoint(intersections[1], globalPoint(element, [50, 100 + offset]));
        for (const point of intersections) {
          expect(distanceToElement(element, map, point)).toBeCloseTo(offset, 7);
        }
        expect(
          intersectElementWithLineSegment(element, map, line, offset, true),
        ).toHaveLength(1);
      }
    });

    it("handles round-tip chords and tangent intersections", () => {
      const element = makeElement();
      const map = arrayToMap([element]);
      const chord = intersectElementWithLineSegment(
        element,
        map,
        lineSegment(
          globalPoint(element, [20, -5]),
          globalPoint(element, [80, -5]),
        ),
        10,
      );
      expect(chord).toHaveLength(2);
      expectPoint(chord[0], globalPoint(element, [50 - Math.sqrt(75), -5]));
      expectPoint(chord[1], globalPoint(element, [50 + Math.sqrt(75), -5]));
      const tangent = intersectElementWithLineSegment(
        element,
        map,
        lineSegment(
          globalPoint(element, [20, -10]),
          globalPoint(element, [80, -10]),
        ),
        10,
      );
      expect(tangent).toHaveLength(1);
      expectPoint(tangent[0], globalPoint(element, [50, -10]));
      const endpoint = intersectElementWithLineSegment(
        element,
        map,
        lineSegment(
          globalPoint(element, [50, -10]),
          globalPoint(element, [50, -30]),
        ),
        10,
      );
      expect(endpoint).toHaveLength(1);
      expectPoint(endpoint[0], globalPoint(element, [50, -10]));
    });

    it("snaps to real edge midpoints and the apex with outward gaps", () => {
      const element = makeElement();
      const map = arrayToMap([element]);
      const arrow = newArrowElement({ type: "arrow", x: 200, y: 0 });
      const gap = getBindingGap(element, arrow);
      const anchors = [
        [75, 50],
        [50, 100],
        [25, 50],
        [50, 0],
      ] as const;
      const normals = [
        [2 / Math.sqrt(5), -1 / Math.sqrt(5)],
        [0, 1],
        [-2 / Math.sqrt(5), -1 / Math.sqrt(5)],
        [0, -1],
      ];
      anchors.forEach(([x, y], index) => {
        const [nx, ny] = normals[index];
        const point = globalPoint(element, [x + nx * gap, y + ny * gap]);
        const snapped = snapToMid(element, map, point, 0.05, arrow);
        expect(snapped).toBeDefined();
        expectPoint(snapped!, point);
        expect(distanceToElement(element, map, snapped!)).toBeCloseTo(gap, 7);
        expectPoint(
          getSnapOutlineMidPoint(
            globalPoint(element, [x + nx, y + ny]),
            element,
            map,
            { value: 1 } as AppState["zoom"],
          )!,
          globalPoint(element, [x, y]),
        );
        const heading = headingForPointFromElement(
          element,
          aabbForElement(element, map),
          globalPoint(element, [x, y]),
        );
        const normal = pointRotateRads(
          pointFrom<GlobalPoint>(nx, ny),
          pointFrom(0, 0),
          element.angle,
        );
        expect(heading).toEqual(vectorToHeading(vectorFromPoint(normal)));
      });
    });

    it("round-trips fixed points around the box pivot", () => {
      const element = makeElement();
      const point = globalPoint(element, [35, 70]);
      const arrow = newArrowElement({
        type: "arrow",
        x: point[0],
        y: point[1],
      });
      const map = arrayToMap([element, arrow]);
      const { fixedPoint } = calculateFixedPointForNonElbowArrowBinding(
        arrow,
        element,
        "start",
        map,
        point,
      );
      expectPoint(fixedPoint, [0.35, 0.7]);
      expectPoint(
        getGlobalFixedPointForBindableElement(fixedPoint, element, map),
        point,
      );
      const midpoint = getBindingSideMidPoint(
        { elementId: element.id, fixedPoint: [0.75, 0.5], mode: "orbit" },
        map,
      );
      expectPoint(
        midpoint!,
        globalPoint(element, [
          75 + 0.02 / Math.sqrt(5),
          50 - 0.01 / Math.sqrt(5),
        ]),
      );
    });

    it.each([false, true])(
      "keeps %s elbowed bindings outside rotated faces and the apex",
      (elbowed) => {
        const element = makeElement();
        const map: ElementsMap = arrayToMap([element]);
        for (const anchor of getTriangleBindingPoints(element)) {
          const start = pointRotateRads(
            anchor,
            elementCenterPoint(element, map),
            element.angle,
          );
          const heading = headingForPointFromElement(
            element,
            aabbForElement(element, map),
            start,
          );
          const dx = heading[0] * 200;
          const dy = heading[1] * 200;
          const arrow = newArrowElement({
            type: "arrow",
            x: start[0],
            y: start[1],
            elbowed,
            width: Math.abs(dx),
            height: Math.abs(dy),
            points: [pointFrom(0, 0), pointFrom(dx, dy)],
          });
          map.set(arrow.id, arrow);
          const point = bindPointToSnapToElementOutline(
            arrow,
            element,
            "start",
            map,
          );
          expect(isPointInElement(point, element, map)).toBe(false);
          expect(distanceToElement(element, map, point)).toBeCloseTo(
            getBindingGap(element, arrow),
            6,
          );
        }
      },
    );
  });

  it.each([
    [1, 200],
    [200, 1],
    [10, 100],
    [300, 20],
  ])(
    "maintains constant gaps in every direction for %s x %s triangles",
    (width, height) => {
      const element = triangle({
        x: 1000,
        y: -500,
        width,
        height,
        angle: 0.37 as Radians,
      });
      const map = arrayToMap([element]);
      const center = elementCenterPoint(element, map);
      for (const offset of [5, 30]) {
        for (let i = 0; i < 24; i++) {
          const angle = (Math.PI * 2 * i) / 24;
          const extent = Math.max(width, height) * 3 + offset * 3;
          const intersections = intersectElementWithLineSegment(
            element,
            map,
            lineSegment(
              center,
              pointFrom(
                center[0] + Math.cos(angle) * extent,
                center[1] + Math.sin(angle) * extent,
              ),
            ),
            offset,
          );
          expect(intersections).toHaveLength(1);
          expect(distanceToElement(element, map, intersections[0])).toBeCloseTo(
            offset,
            6,
          );
        }
      }
    },
  );

  it("supports coincident edges and inward offsets without phantom intersections", () => {
    const element = triangle();
    const map = arrayToMap([element]);
    expect(
      intersectElementWithLineSegment(
        element,
        map,
        lineSegment(pointFrom(20, 100), pointFrom(80, 100)),
      ),
    ).toEqual([
      [20, 100],
      [80, 100],
    ]);
    const line = lineSegment<GlobalPoint>(
      pointFrom(50, -20),
      pointFrom(50, 120),
    );
    const inset = intersectElementWithLineSegment(element, map, line, -5);
    expect(inset).toHaveLength(2);
    inset.forEach((point) => {
      expect(distanceToElement(element, map, point)).toBeCloseTo(5, 7);
      expect(isPointInElement(point, element, map)).toBe(true);
    });
    expect(intersectElementWithLineSegment(element, map, line, -100)).toEqual(
      [],
    );
  });

  it.each([
    [0, 0],
    [0, 100],
    [100, 0],
  ])("handles degenerate dimensions %s x %s", (width, height) => {
    const element = triangle({ width, height });
    const map = arrayToMap([element]);
    const center = elementCenterPoint(element, map);
    expect(isPointInElement(center, element, map)).toBe(false);
    expect(distanceToElement(element, map, center)).toBe(0);
    const intersections = intersectElementWithLineSegment(
      element,
      map,
      lineSegment(
        pointFrom(center[0] - 200, center[1]),
        pointFrom(center[0] + 200, center[1]),
      ),
      5,
    );
    expect(intersections).toHaveLength(2);
    intersections.forEach((point) =>
      expect(distanceToElement(element, map, point)).toBeCloseTo(5, 7),
    );
  });

  it("uses triangle vertices instead of empty box midpoints for overlap and containment", () => {
    const element = triangle();
    const map = arrayToMap([element]);
    expect(
      elementsOverlappingBBox({
        elements: [element],
        elementsMap: map,
        bounds: [0, 48, 2, 52],
        type: "overlap",
      }),
    ).toEqual([]);
    expect(
      elementsOverlappingBBox({
        elements: [element],
        elementsMap: map,
        bounds: [24, 49, 26, 51],
        type: "overlap",
      }),
    ).toEqual([element]);
    const inner = triangle({ x: 20, y: 20, width: 60, height: 60 });
    map.set(inner.id, inner);
    expect(isBindableElementInsideOtherBindable(inner, element, map)).toBe(
      true,
    );
  });

  it.each([false, true])(
    "binds %s elbowed arrows at the correct gap on a sloped face",
    (elbowed) => {
      const element = triangle();
      const arrow = newArrowElement({
        type: "arrow",
        x: 75,
        y: 50,
        elbowed,
        points: [pointFrom(0, 0), pointFrom(125, 0)],
      });
      const map = arrayToMap([element, arrow]);
      const point = bindPointToSnapToElementOutline(
        arrow,
        element,
        "start",
        map,
      );
      expect(point[0]).toBeGreaterThan(75);
      expect(distanceToElement(element, map, point)).toBeCloseTo(
        getBindingGap(element, arrow),
        7,
      );
    },
  );
});
