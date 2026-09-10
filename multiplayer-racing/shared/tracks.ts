import type { TrackId } from "./protocol";

export interface Track {
  id: TrackId;
  name: string;
  subtitle: string;
  description: string;
  difficulty: string;
  length: number;
  width: number;
  points: { x: number; z: number }[];
  checkpoints: { x: number; z: number; yaw: number }[];
}

function makeTrack(
  details: Omit<Track, "points" | "checkpoints">,
  anchors: [number, number][],
  gateCount: number,
): Track {
  // Closed Catmull-Rom, then equal-distance resampling: gates and bot lookahead
  // follow the actual road rather than the unevenly spaced design anchors.
  const curve: { x: number; z: number }[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[(i + anchors.length - 1) % anchors.length];
    const b = anchors[i];
    const c = anchors[(i + 1) % anchors.length];
    const d = anchors[(i + 2) % anchors.length];
    for (let j = 0; j < 40; j++) {
      const t = j / 40;
      const component = (k: number) =>
        0.5 *
        (2 * b[k] +
          (-a[k] + c[k]) * t +
          (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t +
          (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t * t * t);
      curve.push({ x: component(0), z: component(1) });
    }
  }
  const distances = [0];
  for (let i = 0; i < curve.length; i++) {
    const a = curve[i];
    const b = curve[(i + 1) % curve.length];
    distances.push(distances[i] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const count = gateCount * 24;
  const points: Track["points"] = [];
  let segment = 0;
  for (let i = 0; i < count; i++) {
    const distance = (i / count) * distances[curve.length];
    while (distances[segment + 1] < distance) segment++;
    const a = curve[segment];
    const b = curve[(segment + 1) % curve.length];
    const t =
      (distance - distances[segment]) /
      (distances[segment + 1] - distances[segment]);
    points.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  const polygonLength = points.reduce((sum, a, i) => {
    const b = points[(i + 1) % count];
    return sum + Math.hypot(b.x - a.x, b.z - a.z);
  }, 0);
  const scale = details.length / polygonLength;
  for (const point of points) {
    point.x *= scale;
    point.z *= scale;
  }
  const checkpoints = Array.from({ length: gateCount }, (_, i) => {
    const index = i * 24;
    const a = points[(index + count - 1) % count];
    const b = points[(index + 1) % count];
    return { ...points[index], yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  });
  return { ...details, points, checkpoints };
}

export const TRACKS: Record<TrackId, Track> = {
  canyon: makeTrack(
    {
      id: "canyon",
      name: "Sunset Canyon",
      subtitle: "Golden hour. Full throttle.",
      description:
        "Sweep through sunlit red-rock cliffs, a broad summit bend and a fast canyon dogleg. Dry asphalt rewards a clean racing line.",
      difficulty: "Intermediate",
      length: 1100,
      width: 20,
    },
    [
      [-105, -130],
      [-105, -55],
      [-120, 35],
      [-92, 113],
      [-22, 156],
      [60, 150],
      [120, 95],
      [115, 20],
      [75, -32],
      [110, -96],
      [75, -156],
      [-20, -167],
    ],
    12,
  ),
  harbor: makeTrack(
    {
      id: "harbor",
      name: "Neon Harbor",
      subtitle: "Wet asphalt. Electric nights.",
      description:
        "A dockside sprint beneath neon cranes: a long quay straight feeds tight warehouse bends and a slippery double switchback.",
      difficulty: "Technical",
      length: 900,
      width: 18,
    },
    [
      [-100, -55],
      [-100, 60],
      [-90, 125],
      [-30, 145],
      [35, 125],
      [35, 60],
      [85, 35],
      [110, -5],
      [90, -45],
      [30, -45],
      [-3, -76],
      [12, -105],
      [25, -126],
      [15, -147],
      [-17, -161],
      [-65, -160],
      [-100, -135],
    ],
    14,
  ),
};

export function nearestTrack(
  track: Track,
  x: number,
  z: number,
): {
  x: number;
  z: number;
  distance: number;
  progress: number;
  index: number;
  yaw: number;
} {
  let best = Infinity;
  let along = 0;
  let result = { x: 0, z: 0, distance: 0, progress: 0, index: 0, yaw: 0 };
  for (let i = 0; i < track.points.length; i++) {
    const a = track.points[i];
    const b = track.points[(i + 1) % track.points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (length * length)),
    );
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const squared = (x - px) ** 2 + (z - pz) ** 2;
    if (squared < best) {
      best = squared;
      result = {
        x: px,
        z: pz,
        distance: Math.sqrt(squared),
        progress: ((along + t * length) / track.length) % 1,
        index: i,
        yaw: Math.atan2(dx, dz),
      };
    }
    along += length;
  }
  return result;
}
