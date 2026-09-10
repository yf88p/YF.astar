import {
  curve,
  distanceToLineSegment,
  lineSegment,
  lineSegmentIntersectionPoints,
  pointDistance,
  pointDistanceSq,
  pointFrom,
  pointsEqual,
} from "@excalidraw/math";

import type {
  Curve,
  GlobalPoint,
  LineSegment,
  LocalPoint,
} from "@excalidraw/math";

import type { ExcalidrawTriangleElement } from "./types";

export const getTrianglePoints = (
  element: Pick<ExcalidrawTriangleElement, "width" | "height">,
): [LocalPoint, LocalPoint, LocalPoint] => [
  pointFrom(element.width / 2, 0),
  pointFrom(element.width, element.height),
  pointFrom(0, element.height),
];

/** Unrotated global anchors, ordered right edge, base, left edge, apex. */
export const getTriangleBindingPoints = (
  element: ExcalidrawTriangleElement,
): GlobalPoint[] => {
  const points = getTrianglePoints(element);
  return [
    ...points.map((p, i) => {
      const next = points[(i + 1) % points.length];
      return pointFrom<GlobalPoint>(
        element.x + (p[0] + next[0]) / 2,
        element.y + (p[1] + next[1]) / 2,
      );
    }),
    pointFrom(element.x + element.width / 2, element.y),
  ];
};

/** The query point is in unrotated global coordinates. */
export const isPointInTriangle = (
  element: ExcalidrawTriangleElement,
  point: GlobalPoint,
): boolean => {
  if (element.width <= 0 || element.height <= 0) {
    return false;
  }
  const y = (point[1] - element.y) / element.height;
  const x = (point[0] - element.x) / element.width;
  return y >= 0 && y <= 1 && Math.abs(x - 0.5) <= y / 2;
};

const getTriangleSides = (
  element: ExcalidrawTriangleElement,
  offset: number,
): LineSegment<GlobalPoint>[] => {
  let points = getTrianglePoints(element).map(([x, y]) =>
    pointFrom<GlobalPoint>(element.x + x, element.y + y),
  );

  if (offset < 0) {
    // Inward parallel edges form a similar triangle about the incenter.
    const radius =
      (element.width * element.height) /
      (element.width + 2 * Math.hypot(element.width / 2, element.height));
    if (!(radius > 0) || -offset > radius) {
      return [];
    }
    const center = pointFrom<GlobalPoint>(
      element.x + element.width / 2,
      element.y + element.height - radius,
    );
    const scale = 1 + offset / radius;
    points = points.map((p) =>
      pointFrom(
        center[0] + (p[0] - center[0]) * scale,
        center[1] + (p[1] - center[1]) * scale,
      ),
    );
  }

  return points
    .map((p, i) => {
      const next = points[(i + 1) % points.length];
      const length = pointDistance(p, next);
      const distance = offset > 0 && length > 0 ? offset / length : 0;
      const dx = (next[1] - p[1]) * distance;
      const dy = (p[0] - next[0]) * distance;
      return lineSegment(
        pointFrom<GlobalPoint>(p[0] + dx, p[1] + dy),
        pointFrom<GlobalPoint>(next[0] + dx, next[1] + dy),
      );
    })
    .filter(([a, b]) => offset <= 0 || pointDistanceSq(a, b) > 0);
};

/** Unrotated global sides and cubic approximations of outward round joins. */
export const deconstructTriangleElement = (
  element: ExcalidrawTriangleElement,
  offset: number = 0,
): [LineSegment<GlobalPoint>[], Curve<GlobalPoint>[]] => {
  const sides = getTriangleSides(element, offset);
  const corners: Curve<GlobalPoint>[] = [];
  if (offset <= 0) {
    return [sides, corners];
  }

  const addArc = (center: GlobalPoint, start: number, sweep: number) => {
    const count = Math.ceil(sweep / (Math.PI / 2));
    for (let i = 0; i < count; i++) {
      const a = start + (sweep * i) / count;
      const b = start + (sweep * (i + 1)) / count;
      const k = (4 / 3) * Math.tan((b - a) / 4);
      const p = pointFrom<GlobalPoint>(
        center[0] + offset * Math.cos(a),
        center[1] + offset * Math.sin(a),
      );
      const q = pointFrom<GlobalPoint>(
        center[0] + offset * Math.cos(b),
        center[1] + offset * Math.sin(b),
      );
      corners.push(
        curve(
          p,
          pointFrom(
            p[0] - k * offset * Math.sin(a),
            p[1] + k * offset * Math.cos(a),
          ),
          pointFrom(
            q[0] + k * offset * Math.sin(b),
            q[1] - k * offset * Math.cos(b),
          ),
          q,
        ),
      );
    }
  };

  const baseSides = getTriangleSides(element, 0).filter(
    ([a, b]) => pointDistanceSq(a, b) > 0,
  );
  if (baseSides.length === 0) {
    addArc(pointFrom(element.x, element.y), 0, Math.PI * 2);
  } else {
    for (let i = 0; i < baseSides.length; i++) {
      const [a, b] = baseSides[i];
      const [c, d] = baseSides[(i + 1) % baseSides.length];
      const start = Math.atan2(a[0] - b[0], b[1] - a[1]);
      const end = Math.atan2(c[0] - d[0], d[1] - c[1]);
      addArc(b, start, (end - start + Math.PI * 2) % (Math.PI * 2));
    }
  }
  return [sides, corners];
};

/** Exact round-offset intersections; both input and output are unrotated. */
export const intersectTriangleWithLineSegment = (
  element: ExcalidrawTriangleElement,
  segment: LineSegment<GlobalPoint>,
  offset = 0,
  onlyFirst = false,
): GlobalPoint[] => {
  const sides = getTriangleSides(element, offset);
  const baseSides = offset > 0 ? getTriangleSides(element, 0) : sides;
  const tolerance = 1e-7 * Math.max(1, Math.abs(offset));
  const intersections: GlobalPoint[] = [];
  const add = (point: GlobalPoint) => {
    // Full vertex circles also cover the interior. Keep only the exposed arcs
    // of the Minkowski sum, where the nearest outline is exactly offset away.
    if (
      offset > 0 &&
      (isPointInTriangle(element, point) ||
        Math.abs(
          Math.min(
            ...baseSides.map((side) => distanceToLineSegment(point, side)),
          ) - offset,
        ) > tolerance)
    ) {
      return;
    }
    if (!intersections.some((p) => pointsEqual(p, point, tolerance))) {
      intersections.push(point);
    }
  };

  for (const side of sides) {
    const intersection = lineSegmentIntersectionPoints(
      side,
      segment,
      tolerance,
    );
    if (intersection) {
      add(intersection);
    } else {
      // Coincident edges and point-like segments have no unique line intersection.
      for (const p of side) {
        if (distanceToLineSegment(p, segment) <= tolerance) {
          add(p);
        }
      }
      for (const p of segment) {
        if (distanceToLineSegment(p, side) <= tolerance) {
          add(p);
        }
      }
    }
  }

  if (offset > 0) {
    const [a, b] = segment;
    add(a);
    add(b);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared > 0) {
      for (const [vertex] of baseSides) {
        const t =
          ((vertex[0] - a[0]) * dx + (vertex[1] - a[1]) * dy) / lengthSquared;
        const distanceSquared = pointDistanceSq(
          vertex,
          pointFrom(a[0] + t * dx, a[1] + t * dy),
        );
        const discriminant = offset * offset - distanceSquared;
        if (discriminant < -tolerance * Math.max(1, offset)) {
          continue;
        }
        const dt =
          Math.abs(discriminant) <= tolerance * Math.max(1, offset)
            ? 0
            : Math.sqrt(discriminant / lengthSquared);
        for (const parameter of [t - dt, t + dt]) {
          if (parameter >= 0 && parameter <= 1) {
            add(pointFrom(a[0] + parameter * dx, a[1] + parameter * dy));
          }
        }
      }
    }
  }

  intersections.sort(
    (a, b) => pointDistanceSq(a, segment[0]) - pointDistanceSq(b, segment[0]),
  );
  return onlyFirst ? intersections.slice(0, 1) : intersections;
};
