const DEG = Math.PI / 180;
const WORLD_SIZE = 36000;
const MAP_WIDTH = 11000;
const finite = (value) => (Number.isFinite(value) ? value : 0);

export class Instruments {
  constructor({ attitudeCanvas, mapCanvas, terrainHeight }) {
    this.attitudeCanvas = attitudeCanvas;
    this.mapCanvas = mapCanvas;
    this.attitude = attitudeCanvas.getContext("2d");
    this.map = mapCanvas.getContext("2d");
    this.terrain = mapCanvas.ownerDocument.createElement("canvas");
    const size = 512;
    this.terrain.width = this.terrain.height = size;
    const context = this.terrain.getContext("2d");
    const image = context.createImageData(size, size);
    const heights = new Float32Array(size * size);
    const step = WORLD_SIZE / size;

    // Sample once. Shading and contour edges reuse the same height field.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        heights[y * size + x] = finite(
          terrainHeight(
            (x + 0.5) * step - WORLD_SIZE / 2,
            (y + 0.5) * step - WORLD_SIZE / 2,
          ),
        );
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const h = heights[i];
        const west = heights[y * size + Math.max(0, x - 1)];
        const north = heights[Math.max(0, y - 1) * size + x];
        let r, g, b;
        if (h <= 0) {
          const shallow = Math.max(0, 1 + h / 90);
          r = 27 + shallow * 5;
          g = 51 + shallow * 9;
          b = 54 + shallow * 8;
        } else {
          const elevation = Math.min(1, h / 3000);
          const light = Math.max(
            -15,
            Math.min(19, (west + north - 2 * h) * 0.12),
          );
          const contour =
            h > 180 &&
            (Math.floor(h / 200) !== Math.floor(west / 200) ||
              Math.floor(h / 200) !== Math.floor(north / 200));
          const edge = west <= 0 || north <= 0;
          const ink = contour ? -15 : edge ? 22 : 0;
          r = 61 + elevation * 46 + light + ink;
          g = 75 + elevation * 38 + light + ink;
          b = 53 + elevation * 34 + light + ink;
        }
        image.data.set([r, g, b, 255], i * 4);
      }
    }
    context.putImageData(image, 0, 0);
  }

  // The caller controls the refresh rate (approximately 10 Hz); no timers here.
  update(telemetry, position, time, trail = []) {
    const pitch = Math.max(-90, Math.min(90, finite(telemetry.pitch)));
    const roll = finite(telemetry.roll) * DEG;
    const heading = ((finite(telemetry.heading) % 360) + 360) % 360;
    const ctx = this.attitude;
    ctx.save();
    ctx.setTransform(
      this.attitudeCanvas.width / 240,
      0,
      0,
      this.attitudeCanvas.height / 240,
      0,
      0,
    );
    ctx.clearRect(0, 0, 240, 240);
    ctx.translate(120, 120);
    ctx.fillStyle = "#152529";
    ctx.beginPath();
    ctx.arc(0, 0, 116, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#a8b4a53d";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 99, 0, Math.PI * 2);
    ctx.clip();
    // Canvas angles are clockwise. Bank right moves the horizon left;
    // nose up moves it down along the banked instrument's vertical axis.
    ctx.rotate(-roll);
    ctx.translate(0, pitch * 2.8);
    const sky = ctx.createLinearGradient(0, -250, 0, 0);
    sky.addColorStop(0, "#375b6a");
    sky.addColorStop(1, "#729394");
    ctx.fillStyle = sky;
    ctx.fillRect(-500, -600, 1000, 600);
    const earth = ctx.createLinearGradient(0, 0, 0, 250);
    earth.addColorStop(0, "#756047");
    earth.addColorStop(1, "#3c3930");
    ctx.fillStyle = earth;
    ctx.fillRect(-500, 0, 1000, 600);
    ctx.strokeStyle = "#f1e7ca";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-500, 0);
    ctx.lineTo(500, 0);
    ctx.stroke();
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f1e7ca";
    ctx.lineWidth = 1.2;
    for (let angle = -80; angle <= 80; angle += 5) {
      if (angle === 0) continue;
      const y = -angle * 2.8;
      const major = angle % 10 === 0;
      const width = major ? 23 : 11;
      ctx.beginPath();
      ctx.moveTo(-width, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      if (major) {
        ctx.fillText(String(Math.abs(angle)), -width - 15, y);
        ctx.fillText(String(Math.abs(angle)), width + 15, y);
      }
    }
    ctx.restore();

    ctx.strokeStyle = "#e4dfc4";
    for (const angle of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      ctx.save();
      ctx.rotate(angle * DEG);
      const major = angle % 30 === 0;
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, -109);
      ctx.lineTo(0, major ? -98 : -103);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.rotate(-roll);
    ctx.fillStyle = "#f0e9d3";
    ctx.beginPath();
    ctx.moveTo(0, -96);
    ctx.lineTo(-5, -86);
    ctx.lineTo(5, -86);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Fixed foreground reference wings and a small white aircraft silhouette.
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#18282b";
    ctx.beginPath();
    ctx.moveTo(-66, 0);
    ctx.lineTo(-30, 0);
    ctx.lineTo(-23, 8);
    ctx.moveTo(66, 0);
    ctx.lineTo(30, 0);
    ctx.lineTo(23, 8);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#e9a16b";
    ctx.stroke();
    ctx.fillStyle = "#fff9e9";
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(3, -2);
    ctx.lineTo(16, 3);
    ctx.lineTo(16, 6);
    ctx.lineTo(3, 4);
    ctx.lineTo(2, 11);
    ctx.lineTo(-2, 11);
    ctx.lineTo(-3, 4);
    ctx.lineTo(-16, 6);
    ctx.lineTo(-16, 3);
    ctx.lineTo(-3, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const map = this.map;
    const px = finite(position.x);
    const pz = finite(position.z);
    // Equal X/Z scale keeps headings and distances correct on the rectangular map.
    const scale = 360 / MAP_WIDTH;
    const originX = 180 - px * scale;
    const originY = 130 - pz * scale;
    map.save();
    map.setTransform(
      this.mapCanvas.width / 360,
      0,
      0,
      this.mapCanvas.height / 260,
      0,
      0,
    );
    map.fillStyle = "#1b3336";
    map.fillRect(0, 0, 360, 260);
    map.imageSmoothingEnabled = true;
    map.drawImage(
      this.terrain,
      originX - (WORLD_SIZE / 2) * scale,
      originY - (WORLD_SIZE / 2) * scale,
      WORLD_SIZE * scale,
      WORLD_SIZE * scale,
    );
    map.strokeStyle = "#d9dfbb18";
    map.lineWidth = 1;
    map.beginPath();
    const grid = 2000 * scale;
    for (let x = ((originX % grid) + grid) % grid; x < 360; x += grid) {
      map.moveTo(x, 0);
      map.lineTo(x, 260);
    }
    for (let y = ((originY % grid) + grid) % grid; y < 260; y += grid) {
      map.moveTo(0, y);
      map.lineTo(360, y);
    }
    map.stroke();

    map.strokeStyle = "#f0f0db65";
    map.lineWidth = 1.5;
    map.beginPath();
    let connected = false;
    for (const point of trail) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
        connected = false;
        continue;
      }
      const x = originX + point.x * scale;
      const y = originY + point.z * scale;
      if (connected) map.lineTo(x, y);
      else map.moveTo(x, y);
      connected = true;
    }
    map.stroke();

    map.save();
    map.translate(originX, originY);
    map.fillStyle = "#182a2d";
    map.fillRect(-5, -850 * scale - 3, 10, 1700 * scale + 6);
    map.fillStyle = "#dcdabb";
    map.fillRect(-2, -850 * scale, 4, 1700 * scale);
    map.strokeStyle = "#dbddbb70";
    map.lineWidth = 1;
    map.beginPath();
    map.arc(0, 0, 12, 0, Math.PI * 2);
    map.stroke();
    map.font = "bold 12px monospace";
    map.textBaseline = "middle";
    map.fillStyle = "#172a2de0";
    map.fillRect(16, -10, 42, 20);
    map.fillStyle = "#ece9cd";
    map.fillText("EC01", 21, 1);
    map.restore();

    map.save();
    map.translate(180, 130);
    map.rotate(heading * DEG);
    map.fillStyle = "#eea16a";
    map.strokeStyle = "#192a2e";
    map.lineWidth = 2;
    map.lineJoin = "round";
    map.beginPath();
    map.moveTo(0, -12);
    map.lineTo(8, 9);
    map.lineTo(0, 5);
    map.lineTo(-8, 9);
    map.closePath();
    map.fill();
    map.stroke();
    map.restore();

    map.fillStyle = "#16282bcb";
    map.fillRect(316, 9, 34, 53);
    map.fillRect(10, 222, 90, 28);
    map.font = "11px monospace";
    map.fillStyle = "#e6e6cd";
    map.textAlign = "center";
    map.fillText("N", 333, 25);
    map.beginPath();
    map.moveTo(333, 32);
    map.lineTo(329, 45);
    map.lineTo(333, 42);
    map.lineTo(337, 45);
    map.closePath();
    map.fill();
    map.strokeStyle = "#e6e6cd";
    map.lineWidth = 1.5;
    map.beginPath();
    map.moveTo(20, 237);
    map.lineTo(20, 242);
    map.lineTo(20 + 1852 * scale, 242);
    map.lineTo(20 + 1852 * scale, 237);
    map.stroke();
    map.fillText("1 NM", 20 + 926 * scale, 233);
    map.restore();
  }
}
