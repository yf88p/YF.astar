export const SEGMENTS = 256;
export const ROWS = 144;
export const HEIGHT = 3.05;
export const BASE_Y = 0.3;
export const TOOLS = {
  loop: { radius: 0.135, rate: 0.52, drag: 0.8 },
  rib: { radius: 0.3, rate: 0.18, drag: 1 },
  needle: { radius: 0.043, rate: 0.68, drag: 0.48 },
  sponge: { radius: 0.23, rate: 0.016, drag: 0.65 },
};

export function profile(t) {
  // A continuous thrown-vessel profile, with a foot, full belly, and soft neck.
  return (
    0.79 +
    0.39 * Math.sin(Math.PI * Math.pow(t, 0.74)) +
    0.23 * t -
    0.07 * Math.exp(-Math.pow((t - 0.83) / 0.14, 2))
  );
}

export class Clay {
  constructor() {
    this.original = new Float32Array((ROWS + 1) * SEGMENTS);
    this.radii = new Float32Array(this.original.length);
    this.removed = 0;
    for (let j = 0; j <= ROWS; j++) {
      for (let i = 0; i < SEGMENTS; i++) {
        const theta = (i / SEGMENTS) * Math.PI * 2;
        const t = j / ROWS;
        const throwing = Math.sin(t * 290 + Math.sin(theta) * 0.65) * 0.0013;
        this.original[j * SEGMENTS + i] = profile(t) + throwing;
      }
    }
    this.radii.set(this.original);
  }

  snapshot() {
    return { radii: this.radii.slice(), removed: this.removed };
  }
  restore(state) {
    this.radii.set(state.radii);
    this.removed = state.removed;
  }
  reset() {
    this.radii.set(this.original);
    this.removed = 0;
  }

  carve(theta, y, { tool, pressure, wetness, dt, motion = 1 }) {
    const spec = TOOLS[tool];
    if (!spec || y < BASE_Y + 0.08 || y > BASE_Y + HEIGHT - 0.025) return 0;
    const t = (y - BASE_Y) / HEIGHT;
    const centerRow = t * ROWS;
    const centerCol = ((((theta / (Math.PI * 2)) % 1) + 1) % 1) * SEGMENTS;
    const localRadius = profile(t);
    const size = spec.radius * (0.65 + pressure * 0.6);
    const rowSpan = Math.ceil((size / HEIGHT) * ROWS);
    const colSpan = Math.ceil((size / localRadius / (Math.PI * 2)) * SEGMENTS);
    const contactTime = Math.min(dt, 0.1);
    const rate =
      spec.rate *
      pressure *
      (0.45 + wetness * 0.8) *
      contactTime *
      Math.min(2, 0.32 + motion);
    let volume = 0;
    for (
      let j = Math.max(3, Math.floor(centerRow) - rowSpan);
      j <= Math.min(ROWS - 1, Math.ceil(centerRow) + rowSpan);
      j++
    ) {
      for (
        let k = Math.floor(centerCol) - colSpan;
        k <= Math.ceil(centerCol) + colSpan;
        k++
      ) {
        const dy = ((j - centerRow) / ROWS) * HEIGHT;
        const dx = ((k - centerCol) / SEGMENTS) * Math.PI * 2 * localRadius;
        const d2 = (dx * dx + dy * dy) / (size * size);
        if (d2 >= 1) continue;
        const i = ((k % SEGMENTS) + SEGMENTS) % SEGMENTS;
        const index = j * SEGMENTS + i;
        const radius = this.radii[index];
        const minimum = this.original[index] - 0.205;
        const resistance = Math.max(0.06, (radius - minimum) / 0.205);
        let cut =
          rate *
          Math.pow(1 - d2, tool === "needle" ? 1.1 : 1.7) *
          Math.sqrt(resistance);
        if (tool === "sponge") {
          const neighbors =
            (this.radii[index - SEGMENTS] +
              this.radii[index + SEGMENTS] +
              this.radii[j * SEGMENTS + ((i + 1) % SEGMENTS)] +
              this.radii[j * SEGMENTS + ((i + SEGMENTS - 1) % SEGMENTS)]) /
            4;
          // Wet smoothing shaves high spots; it never restores removed material.
          cut =
            Math.max(0, radius - neighbors) * Math.min(0.45, contactTime * 12) +
            cut * 0.06;
        }
        const next = Math.max(minimum, radius - cut);
        this.radii[index] = next;
        volume +=
          ((((radius * radius - next * next) * Math.PI) / SEGMENTS) * HEIGHT) /
          ROWS;
      }
    }
    this.removed += volume;
    return volume;
  }
}
