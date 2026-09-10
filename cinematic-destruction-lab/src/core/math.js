export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const scale = (a, s) => a.map(v => v * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(...a);
export const normalize = a => scale(a, 1 / (length(a) || 1));
export const vec = a => ({ x: a[0], y: a[1], z: a[2] });
export const arr = v => [v.x, v.y, v.z];
export const quat = q => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
export const qarr = q => [q.x, q.y, q.z, q.w];
export const conjugate = q => [-q[0], -q[1], -q[2], q[3]];
export function multiply(a, b) {
  const [x, y, z, w] = a, [X, Y, Z, W] = b;
  return [w * X + x * W + y * Z - z * Y, w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W, w * W - x * X - y * Y - z * Z];
}
export function rotate(v, q) {
  const t = scale(cross(q.slice(0, 3), v), 2);
  return add(v, add(scale(t, q[3]), cross(q.slice(0, 3), t)));
}
// XYZ Euler convention, matching Three's default Euler order.
export function eulerQuaternion(e) {
  const [x, y, z] = e.map(v => v / 2);
  const a = Math.cos(x), b = Math.cos(y), c = Math.cos(z);
  const d = Math.sin(x), f = Math.sin(y), g = Math.sin(z);
  return [d * b * c + a * f * g, a * f * c - d * b * g,
    a * b * g + d * f * c, a * b * c - d * f * g];
}
export function slerp(a, b, t) {
  let d = dot(a, b);
  if (d < 0) { b = scale(b, -1); d = -d; }
  if (d > 0.9995) return normalize(a.map((v, i) => v + (b[i] - v) * t));
  const angle = Math.acos(Math.min(1, d));
  return add(scale(a, Math.sin((1 - t) * angle) / Math.sin(angle)), scale(b, Math.sin(t * angle) / Math.sin(angle)));
}
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clone = value => JSON.parse(JSON.stringify(value));
