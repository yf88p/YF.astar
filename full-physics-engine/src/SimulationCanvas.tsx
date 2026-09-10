import { useEffect, useLayoutEffect, useRef } from "react";
import type { PhysicsEngine } from "./physics";
import type {
  BodySnapshot,
  BodySpec,
  DisplayOptions,
  Metrics,
  SceneConfig,
  Tool,
  Vec2,
} from "./types";

export interface SimulationCanvasProps {
  engine: PhysicsEngine | null;
  scene: SceneConfig;
  revision: number;
  running: boolean;
  speed: number;
  tool: Tool;
  display: DisplayOptions;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (shape: "circle" | "box", position: Vec2) => void;
  onFrame: (metrics: Metrics, bodies: BodySnapshot[], fps: number) => void;
  cameraCommand: { id: number; type: "fit" | "in" | "out" };
  onZoomChange: (percent: number) => void;
  onError: (message: string) => void;
}

type Interaction =
  | { type: "pan"; pointerId: number; last: Vec2 }
  | {
      type: "body";
      pointerId: number;
      engine: PhysicsEngine;
      id: string;
      offset: Vec2;
      running: boolean;
    };

const clampScale = (scale: number) => Math.max(8, Math.min(250, scale));

function anchorPoint(body: BodySpec, anchor: Vec2): Vec2 {
  const c = Math.cos(body.rotation ?? 0);
  const s = Math.sin(body.rotation ?? 0);
  return {
    x: body.position.x + c * anchor.x - s * anchor.y,
    y: body.position.y + s * anchor.x + c * anchor.y,
  };
}

export default function SimulationCanvas(props: SimulationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      latest.current.onError(
        "This browser could not create a 2D canvas for the simulation.",
      );
      return;
    }

    let width = 1;
    let height = 1;
    let dpr = 1;
    let baseScale = 48;
    const camera = {
      center: { ...latest.current.scene.camera.center },
      scale: 48,
    };
    let engine = latest.current.engine;
    let revision = NaN;
    let commandId = latest.current.cameraCommand.id;
    let previousRunning = latest.current.running;
    let previousTool = latest.current.tool;
    let snapshots: BodySnapshot[] = [];
    let bodies: readonly BodySpec[] = latest.current.scene.bodies;
    const byId = new Map<string, BodySpec>();
    const trails = new Map<string, Vec2[]>();
    let trailClock = 0;
    let visualTime = 0;
    let interaction: Interaction | null = null;
    let pointer: Vec2 | null = null;
    let failed = false;
    let lastZoom = -1;
    let lastTime = 0;
    let lastReport = -Infinity;
    let fpsTime = 0;
    let fpsFrames = 0;
    let fps = 0;
    let frameId = 0;

    const screenX = (x: number) =>
      width / 2 + (x - camera.center.x) * camera.scale;
    const screenY = (y: number) =>
      height / 2 - (y - camera.center.y) * camera.scale;
    const toWorld = (p: Vec2): Vec2 => ({
      x: camera.center.x + (p.x - width / 2) / camera.scale,
      y: camera.center.y - (p.y - height / 2) / camera.scale,
    });
    const eventPoint = (event: MouseEvent): Vec2 => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    function notifyZoom() {
      const percent = Math.round((camera.scale / baseScale) * 100);
      if (percent !== lastZoom) {
        lastZoom = percent;
        latest.current.onZoomChange(percent);
      }
    }

    function hitTest(p: Vec2): BodySpec | undefined {
      // Dynamic bodies paint last, so even a large fixed collider cannot steal a hit.
      for (const fixed of [false, true]) {
        for (let i = bodies.length - 1; i >= 0; i--) {
          const body = bodies[i];
          if (!!body.fixed !== fixed) continue;
          const dx = p.x - body.position.x;
          const dy = p.y - body.position.y;
          const tolerance = 3 / camera.scale;
          if (body.shape === "circle") {
            if (dx * dx + dy * dy <= (body.radius! + tolerance) ** 2)
              return body;
          } else {
            const c = Math.cos(body.rotation ?? 0);
            const s = Math.sin(body.rotation ?? 0);
            if (
              Math.abs(c * dx + s * dy) <= body.width! / 2 + tolerance &&
              Math.abs(-s * dx + c * dy) <= body.height! / 2 + tolerance
            )
              return body;
          }
        }
      }
    }

    function updateCursor() {
      const { tool, running } = latest.current;
      const hit =
        pointer && tool === "select" ? hitTest(toWorld(pointer)) : undefined;
      canvas.style.cursor = interaction
        ? "grabbing"
        : tool === "hand"
          ? "grab"
          : tool !== "select"
            ? "crosshair"
            : hit
              ? hit.fixed && running
                ? "pointer"
                : "grab"
              : "default";
    }

    function endInteraction() {
      const previous = interaction;
      interaction = null;
      if (previous?.type === "body" && previous.running) {
        // The parent can dispose or replace an engine before effect cleanup runs.
        try {
          previous.engine.endDrag();
        } catch {
          /* A disposed engine has no live drag. */
        }
      }
      if (previous) {
        try {
          if (canvas.hasPointerCapture(previous.pointerId))
            canvas.releasePointerCapture(previous.pointerId);
        } catch {
          /* The browser may already have cancelled this pointer. */
        }
      }
      updateCursor();
    }

    function reportError(error: unknown) {
      if (failed) return;
      failed = true;
      endInteraction();
      latest.current.onError(
        error instanceof Error
          ? error.message
          : "The simulation could not continue. Reset the scene to try again.",
      );
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      const nextBase = clampScale(
        (Math.min(width / 20, height / 12.5) *
          latest.current.scene.camera.scale) /
          48,
      );
      camera.scale = clampScale((camera.scale * nextBase) / baseScale);
      baseScale = nextBase;
      notifyZoom();
    }

    function fitCamera() {
      const { scene } = latest.current;
      const halfWidth = (10 * 48) / scene.camera.scale;
      const halfHeight = (6.25 * 48) / scene.camera.scale;
      let left = scene.camera.center.x - halfWidth;
      let right = scene.camera.center.x + halfWidth;
      let bottom = scene.camera.center.y - halfHeight;
      let top = scene.camera.center.y + halfHeight;
      for (const body of bodies) {
        const c = Math.abs(Math.cos(body.rotation ?? 0));
        const s = Math.abs(Math.sin(body.rotation ?? 0));
        const rx =
          body.shape === "circle"
            ? body.radius!
            : (body.width! * c + body.height! * s) / 2;
        const ry =
          body.shape === "circle"
            ? body.radius!
            : (body.width! * s + body.height! * c) / 2;
        // Infinite-looking floors are context, not the subject of a fit operation.
        if (body.fixed && (rx > halfWidth || ry > halfHeight)) continue;
        left = Math.min(left, body.position.x - rx - 0.7);
        right = Math.max(right, body.position.x + rx + 0.7);
        bottom = Math.min(bottom, body.position.y - ry - 0.7);
        top = Math.max(top, body.position.y + ry + 0.7);
      }
      camera.center = { x: (left + right) / 2, y: (bottom + top) / 2 };
      camera.scale = clampScale(
        Math.min(width / (right - left), height / (top - bottom)),
      );
      notifyZoom();
    }

    function synchronize() {
      const current = latest.current;
      if (revision !== current.revision || engine !== current.engine) {
        endInteraction();
        revision = current.revision;
        engine = current.engine;
        snapshots = [];
        bodies = current.scene.bodies;
        trails.clear();
        trailClock = 0;
        visualTime = 0;
        lastTime = 0;
        lastReport = -Infinity;
        fpsTime = fpsFrames = fps = 0;
        failed = false;
        baseScale = clampScale(
          (Math.min(width / 20, height / 12.5) * current.scene.camera.scale) /
            48,
        );
        camera.center = { ...current.scene.camera.center };
        camera.scale = baseScale;
        notifyZoom();
      }
      if (
        previousRunning !== current.running ||
        previousTool !== current.tool
      ) {
        endInteraction();
        lastTime = 0;
        previousRunning = current.running;
        previousTool = current.tool;
        updateCursor();
      }
    }

    function zoomAt(point: Vec2, factor: number) {
      const world = toWorld(point);
      camera.scale = clampScale(camera.scale * factor);
      camera.center.x = world.x - (point.x - width / 2) / camera.scale;
      camera.center.y = world.y + (point.y - height / 2) / camera.scale;
      notifyZoom();
    }

    function onPointerDown(event: PointerEvent) {
      if (
        interaction ||
        !event.isPrimary ||
        (event.button !== 0 && event.button !== 1)
      )
        return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      try {
        synchronize();
        pointer = eventPoint(event);
        const current = latest.current;
        const world = toWorld(pointer);
        if (current.tool === "hand" || event.button === 1) {
          interaction = {
            type: "pan",
            pointerId: event.pointerId,
            last: pointer,
          };
        } else if (current.tool === "circle" || current.tool === "box") {
          if (!failed) current.onAdd(current.tool, world);
        } else {
          if (engine && !failed) bodies = snapshots = engine.snapshots();
          const hit = hitTest(world);
          current.onSelect(hit?.id ?? null);
          if (hit && engine && !failed && (!hit.fixed || !current.running)) {
            interaction = {
              type: "body",
              pointerId: event.pointerId,
              engine,
              id: hit.id,
              running: current.running,
              offset: {
                x: world.x - hit.position.x,
                y: world.y - hit.position.y,
              },
            };
            if (current.running) engine.beginDrag(hit.id, world);
          }
        }
        if (interaction) {
          try {
            canvas.setPointerCapture(event.pointerId);
          } catch {
            endInteraction();
          }
        }
        updateCursor();
      } catch (error) {
        reportError(error);
      }
    }

    function onPointerMove(event: PointerEvent) {
      if (!event.isPrimary) return;
      try {
        synchronize();
        pointer = eventPoint(event);
        if (interaction?.pointerId === event.pointerId) {
          if (interaction.type === "pan") {
            camera.center.x -= (pointer.x - interaction.last.x) / camera.scale;
            camera.center.y += (pointer.y - interaction.last.y) / camera.scale;
            interaction.last = pointer;
          } else {
            const world = toWorld(pointer);
            if (interaction.running) interaction.engine.moveDrag(world);
            else {
              interaction.engine.updateBody(interaction.id, {
                position: {
                  x: world.x - interaction.offset.x,
                  y: world.y - interaction.offset.y,
                },
              });
              trails.delete(interaction.id);
            }
          }
        }
        updateCursor();
      } catch (error) {
        reportError(error);
      }
    }

    function onPointerEnd(event: PointerEvent) {
      if (interaction?.pointerId === event.pointerId) endInteraction();
    }

    function onPointerLeave() {
      pointer = null;
      if (!interaction) updateCursor();
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      try {
        synchronize();
        const unit =
          event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
        zoomAt(
          eventPoint(event),
          Math.exp(
            -Math.max(-1000, Math.min(1000, event.deltaY * unit)) * 0.0015,
          ),
        );
        updateCursor();
      } catch (error) {
        reportError(error);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") endInteraction();
    }

    function onVisibilityChange() {
      lastTime = 0;
      fpsTime = fpsFrames = 0;
      if (document.hidden) endInteraction();
    }

    function drawGrid(context: CanvasRenderingContext2D) {
      const left = Math.ceil(camera.center.x - width / (2 * camera.scale));
      const right = Math.floor(camera.center.x + width / (2 * camera.scale));
      const bottom = Math.ceil(camera.center.y - height / (2 * camera.scale));
      const top = Math.floor(camera.center.y + height / (2 * camera.scale));
      context.fillStyle = "#34393b";
      for (let x = left; x <= right; x++) {
        for (let y = bottom; y <= top; y++)
          context.fillRect(screenX(x) - 0.6, screenY(y) - 0.6, 1.2, 1.2);
      }
      context.fillStyle = "#4a5154";
      for (let x = Math.ceil(left / 5) * 5; x <= right; x += 5) {
        for (let y = Math.ceil(bottom / 5) * 5; y <= top; y += 5)
          context.fillRect(screenX(x) - 1, screenY(y) - 1, 2, 2);
      }
      const zeroX = screenX(0);
      const zeroY = screenY(0);
      context.strokeStyle = "rgba(135, 149, 153, 0.18)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, zeroY);
      context.lineTo(width, zeroY);
      context.moveTo(zeroX, 0);
      context.lineTo(zeroX, height);
      context.stroke();
      context.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
      context.fillStyle = "#697174";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      const labelY = Math.max(18, Math.min(height - 12, zeroY - 9));
      for (let x = Math.ceil(left / 5) * 5; x <= right; x += 5) {
        if (screenX(x) > 20 && screenX(x) < width - 20)
          context.fillText(`${x} m`, screenX(x), labelY);
      }
      context.textAlign = "left";
      context.textBaseline = "middle";
      const labelX = Math.max(12, Math.min(width - 42, zeroX + 9));
      for (let y = Math.ceil(bottom / 5) * 5; y <= top; y += 5) {
        if (y !== 0 && screenY(y) > 16 && screenY(y) < height - 16)
          context.fillText(`${y} m`, labelX, screenY(y));
      }
    }

    function drawGuides(context: CanvasRenderingContext2D) {
      const { scene } = latest.current;
      context.lineWidth = 1;
      context.strokeStyle = "rgba(158, 166, 161, 0.2)";
      context.setLineDash([3, 7]);
      if (scene.id === "orbits") {
        const star = byId.get("star");
        if (star?.fixed) {
          for (const radius of [2, 3.5, 5]) {
            context.beginPath();
            context.arc(
              screenX(star.position.x),
              screenY(star.position.y),
              radius * camera.scale,
              0,
              Math.PI * 2,
            );
            context.stroke();
          }
        }
      } else if (scene.id === "cradle") {
        const pivots = bodies.filter(
          (body) => body.fixed && body.id.startsWith("pivot-"),
        );
        if (pivots.length) {
          const y = screenY(pivots[0].position.y) - 10;
          context.beginPath();
          context.moveTo(
            Math.min(...pivots.map((body) => screenX(body.position.x))) - 20,
            y,
          );
          context.lineTo(
            Math.max(...pivots.map((body) => screenX(body.position.x))) + 20,
            y,
          );
          context.stroke();
        }
      }
      context.setLineDash([]);
    }

    function drawFluid(context: CanvasRenderingContext2D) {
      const fluid =
        engine && !failed
          ? engine.environment.fluid
          : latest.current.scene.environment.fluid;
      if (!fluid) return;
      const level = screenY(fluid.level);
      if (level > height + 4) return;
      const top = Math.max(-4, level);
      const fill = context.createLinearGradient(
        0,
        top,
        0,
        Math.max(top + 1, height),
      );
      fill.addColorStop(0, "rgba(100, 171, 216, 0.13)");
      fill.addColorStop(1, "rgba(66, 122, 167, 0.045)");
      context.fillStyle = fill;
      context.beginPath();
      // This two-pixel surface ripple is decoration; buoyancy uses a flat level.
      for (let x = 0; x <= width + 12; x += 12) {
        const worldX = camera.center.x + (x - width / 2) / camera.scale;
        const y =
          top +
          Math.sin(worldX * 2.2 + visualTime * 1.3) * 1.6 +
          Math.sin(worldX * 4 - visualTime) * 0.5;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = "rgba(139, 196, 227, 0.32)";
      context.lineWidth = 1;
      if (level >= -4) context.stroke();
      context.lineTo(width + 12, height);
      context.lineTo(0, height);
      context.closePath();
      context.fill();
    }

    function drawTrails(context: CanvasRenderingContext2D) {
      context.lineWidth = 1.5;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const [id, points] of trails) {
        const body = byId.get(id);
        if (!body || points.length < 2) continue;
        context.strokeStyle = "#aebabe";
        context.strokeStyle = body.color;
        for (let section = 0; section < 8; section++) {
          const start = Math.floor(((points.length - 1) * section) / 8);
          const end = Math.floor(((points.length - 1) * (section + 1)) / 8);
          if (end <= start) continue;
          context.globalAlpha = 0.035 + 0.36 * ((section + 1) / 8) ** 1.5;
          context.beginPath();
          context.moveTo(screenX(points[start].x), screenY(points[start].y));
          for (let i = start + 1; i <= end; i++)
            context.lineTo(screenX(points[i].x), screenY(points[i].y));
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    }

    function drawJoints(context: CanvasRenderingContext2D) {
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const joint of latest.current.scene.joints) {
        const bodyA = byId.get(joint.bodyA);
        const bodyB = byId.get(joint.bodyB);
        if (!bodyA || !bodyB) continue;
        const a = anchorPoint(bodyA, joint.anchorA);
        const b = anchorPoint(bodyB, joint.anchorB);
        const ax = screenX(a.x);
        const ay = screenY(a.y);
        const bx = screenX(b.x);
        const by = screenY(b.y);
        const length = Math.hypot(bx - ax, by - ay);
        context.strokeStyle =
          joint.type === "spring"
            ? "rgba(196, 192, 209, 0.72)"
            : "rgba(185, 196, 199, 0.65)";
        context.lineWidth = joint.type === "spring" ? 1.65 : 1.25;
        context.beginPath();
        context.moveTo(ax, ay);
        if (joint.type === "spring" && length > 8) {
          const nx = -(by - ay) / length;
          const ny = (bx - ax) / length;
          const amplitude = Math.min(6, camera.scale * 0.13, length * 0.08);
          const lead = Math.min(0.12, 10 / length);
          context.lineTo(ax + (bx - ax) * lead, ay + (by - ay) * lead);
          for (let i = 1; i < 20; i++) {
            const t = lead + ((1 - 2 * lead) * i) / 20;
            const offset = (i % 2 ? 1 : -1) * amplitude;
            context.lineTo(
              ax + (bx - ax) * t + nx * offset,
              ay + (by - ay) * t + ny * offset,
            );
          }
          context.lineTo(
            ax + (bx - ax) * (1 - lead),
            ay + (by - ay) * (1 - lead),
          );
        }
        context.lineTo(bx, by);
        context.stroke();
        context.fillStyle = "#1b1e20";
        context.strokeStyle = "#8d999d";
        for (const p of [
          { x: ax, y: ay },
          { x: bx, y: by },
        ]) {
          context.beginPath();
          context.arc(
            p.x,
            p.y,
            joint.type === "revolute" ? 3.2 : 2,
            0,
            Math.PI * 2,
          );
          context.fill();
          context.stroke();
        }
      }
    }

    function drawBody(context: CanvasRenderingContext2D, body: BodySpec) {
      const x = screenX(body.position.x);
      const y = screenY(body.position.y);
      const halfWidth =
        (body.shape === "circle" ? body.radius! : body.width! / 2) *
        camera.scale;
      const halfHeight =
        (body.shape === "circle" ? body.radius! : body.height! / 2) *
        camera.scale;
      const extent = Math.hypot(halfWidth, halfHeight) + 25;
      if (
        x + extent < 0 ||
        x - extent > width ||
        y + extent < 0 ||
        y - extent > height
      )
        return;
      const fixedGeometry =
        body.fixed &&
        !(latest.current.scene.id === "orbits" && body.id === "star");
      context.save();
      context.translate(x, y);
      context.rotate(-(body.rotation ?? 0));
      context.beginPath();
      if (body.shape === "circle") context.arc(0, 0, halfWidth, 0, Math.PI * 2);
      else context.rect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);

      context.fillStyle = fixedGeometry ? "#343b3f" : "#b0bec5";
      if (!fixedGeometry) context.fillStyle = body.color;
      context.shadowColor = "rgba(0, 0, 0, 0.22)";
      context.shadowBlur = fixedGeometry ? 0 : 9;
      context.shadowOffsetY = fixedGeometry ? 0 : 3;
      context.fill();
      context.shadowBlur = context.shadowOffsetY = 0;
      context.save();
      context.clip();
      const shade = context.createLinearGradient(
        -halfWidth * 0.7,
        -halfHeight,
        halfWidth * 0.8,
        halfHeight,
      );
      shade.addColorStop(
        0,
        fixedGeometry
          ? "rgba(191, 205, 215, 0.025)"
          : "rgba(255, 255, 255, 0.19)",
      );
      shade.addColorStop(0.4, "rgba(255, 255, 255, 0)");
      shade.addColorStop(
        1,
        fixedGeometry ? "rgba(0, 0, 0, 0.13)" : "rgba(25, 34, 38, 0.17)",
      );
      context.fillStyle = shade;
      context.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
      if (fixedGeometry && body.shape === "box") {
        context.strokeStyle = "rgba(155, 174, 184, 0.11)";
        context.lineWidth = 1;
        context.beginPath();
        // Only hatch the part of very large geometry that can reach the viewport.
        const reach = Math.min(
          halfWidth,
          Math.hypot(width, height) + Math.hypot(x - width / 2, y - height / 2),
        );
        for (let i = -reach - 2 * halfHeight; i <= reach; i += 10) {
          context.moveTo(i, halfHeight);
          context.lineTo(i + 2 * halfHeight, -halfHeight);
        }
        context.stroke();
      }
      context.restore();
      context.beginPath();
      if (body.shape === "circle") context.arc(0, 0, halfWidth, 0, Math.PI * 2);
      else context.rect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
      context.strokeStyle = fixedGeometry
        ? "rgba(163, 181, 190, 0.25)"
        : "rgba(246, 251, 253, 0.48)";
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      context.strokeStyle = fixedGeometry
        ? "rgba(177, 193, 200, 0.36)"
        : "rgba(255, 255, 255, 0.28)";
      if (body.shape === "box") {
        context.moveTo(-halfWidth + 1, -halfHeight + 1.5);
        context.lineTo(halfWidth - 1, -halfHeight + 1.5);
      } else if (halfWidth > 5) {
        context.arc(
          0,
          0,
          Math.max(0.1, halfWidth - 2),
          Math.PI * 1.14,
          Math.PI * 1.7,
        );
      }
      context.stroke();
      if (body.shape === "circle") {
        context.strokeStyle = fixedGeometry
          ? "rgba(188, 205, 212, 0.5)"
          : "rgba(39, 51, 55, 0.35)";
        context.lineWidth = 1.4;
        context.beginPath();
        if (fixedGeometry)
          context.arc(
            0,
            0,
            Math.max(0.8, Math.min(2, halfWidth * 0.3)),
            0,
            Math.PI * 2,
          );
        else {
          context.moveTo(halfWidth * 0.66, 0);
          context.lineTo(halfWidth * 0.86, 0);
        }
        context.stroke();
        if (body.charge) {
          context.rotate(body.rotation ?? 0);
          context.fillStyle = "rgba(29, 39, 43, 0.75)";
          context.font = `500 ${Math.max(9, Math.min(24, halfWidth * 1.05))}px ui-monospace, monospace`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(body.charge > 0 ? "+" : "-", 0, 0.5);
        }
      }
      context.restore();
    }

    function drawAnnotation(context: CanvasRenderingContext2D, body: BodySpec) {
      const { display, selectedId } = latest.current;
      const selected = body.id === selectedId;
      const x = screenX(body.position.x);
      const y = screenY(body.position.y);
      const hw =
        (body.shape === "circle" ? body.radius! : body.width! / 2) *
        camera.scale;
      const hh =
        (body.shape === "circle" ? body.radius! : body.height! / 2) *
        camera.scale;
      const c = Math.abs(Math.cos(body.rotation ?? 0));
      const s = Math.abs(Math.sin(body.rotation ?? 0));
      const rx = body.shape === "circle" ? hw : hw * c + hh * s;
      const ry = body.shape === "circle" ? hh : hw * s + hh * c;
      if (selected) {
        context.save();
        context.translate(x, y);
        context.rotate(-(body.rotation ?? 0));
        context.strokeStyle = "#c5ed98";
        context.lineWidth = 1.4;
        context.beginPath();
        if (body.shape === "circle") context.arc(0, 0, hw + 4, 0, Math.PI * 2);
        else context.rect(-hw - 4, -hh - 4, hw * 2 + 8, hh * 2 + 8);
        context.stroke();
        context.globalAlpha = 0.7;
        context.beginPath();
        const bracket = Math.min(7, Math.min(hw, hh) * 0.5 + 2);
        for (const dx of [-1, 1]) {
          for (const dy of [-1, 1]) {
            context.moveTo(dx * (hw + 9 - bracket), dy * (hh + 9));
            context.lineTo(dx * (hw + 9), dy * (hh + 9));
            context.lineTo(dx * (hw + 9), dy * (hh + 9 - bracket));
          }
        }
        context.stroke();
        context.restore();
      }
      if (display.labels && (!body.fixed || selected)) {
        context.font = "11px system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "bottom";
        const label =
          body.label.length > 32 ? `${body.label.slice(0, 29)}...` : body.label;
        context.lineWidth = 4;
        context.strokeStyle = "#1b1e20";
        context.strokeText(label, x, y - ry - (selected ? 15 : 10));
        context.fillStyle = selected ? "#c5ed98" : "#a9b3b7";
        context.fillText(label, x, y - ry - (selected ? 15 : 10));
      }
      if (display.vectors && !body.fixed && body.velocity) {
        const speed = Math.hypot(body.velocity.x, body.velocity.y);
        if (speed < 0.05) return;
        const vx = body.velocity.x * camera.scale * 0.22;
        const vy = -body.velocity.y * camera.scale * 0.22;
        const angle = Math.atan2(vy, vx);
        const head = Math.min(7, Math.hypot(vx, vy) * 0.4);
        context.save();
        context.strokeStyle = "#aebabe";
        context.strokeStyle = body.color;
        context.globalAlpha = selected ? 0.9 : 0.65;
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + vx, y + vy);
        context.moveTo(
          x + vx - Math.cos(angle - 0.45) * head,
          y + vy - Math.sin(angle - 0.45) * head,
        );
        context.lineTo(x + vx, y + vy);
        context.lineTo(
          x + vx - Math.cos(angle + 0.45) * head,
          y + vy - Math.sin(angle + 0.45) * head,
        );
        context.stroke();
        if (selected) {
          context.globalAlpha = 1;
          context.font =
            "10px ui-monospace, SFMono-Regular, Consolas, monospace";
          context.textAlign = vx < 0 ? "right" : "left";
          context.textBaseline = "middle";
          const labelX =
            x + (vx < 0 ? Math.min(vx, -rx) - 9 : Math.max(vx, rx) + 9);
          const label = `${speed.toFixed(2)} m/s`;
          context.strokeStyle = "#1b1e20";
          context.lineWidth = 4;
          context.strokeText(label, labelX, y + vy);
          context.fillStyle = "#c5ed98";
          context.fillText(label, labelX, y + vy);
        }
        context.restore();
      }
    }

    function draw(context: CanvasRenderingContext2D) {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.globalAlpha = 1;
      context.lineCap = "butt";
      context.lineJoin = "miter";
      context.fillStyle = "#1b1e20";
      context.fillRect(0, 0, width, height);
      if (latest.current.display.grid) drawGrid(context);
      drawGuides(context);
      drawFluid(context);
      if (latest.current.display.trails) drawTrails(context);
      for (const body of bodies) if (body.fixed) drawBody(context, body);
      drawJoints(context);
      for (const body of bodies) if (!body.fixed) drawBody(context, body);
      for (const body of bodies)
        if (body.id !== latest.current.selectedId)
          drawAnnotation(context, body);
      const selected =
        latest.current.selectedId && byId.get(latest.current.selectedId);
      if (selected) drawAnnotation(context, selected);
    }

    function frame(now: number) {
      frameId = requestAnimationFrame(frame);
      try {
        synchronize();
        if (dpr !== Math.max(1, Math.min(2, window.devicePixelRatio || 1)))
          resize();
        const delta = lastTime ? Math.max(0, (now - lastTime) / 1000) : 0;
        lastTime = now;
        const current = latest.current;
        if (document.hidden) return;
        if (delta > 0 && delta < 0.5) {
          fpsTime += delta;
          fpsFrames++;
          if (fpsTime >= 0.5) {
            const sample = fpsFrames / fpsTime;
            fps = fps ? fps * 0.65 + sample * 0.35 : sample;
            fpsTime = fpsFrames = 0;
          }
        }
        if (engine && !failed) {
          if (current.running && delta > 0) {
            engine.step(delta * current.speed);
            const elapsed = Math.min(delta * current.speed, 0.25);
            trailClock += elapsed;
            visualTime += elapsed;
          }
          bodies = snapshots = engine.snapshots();
        } else if (!engine) bodies = current.scene.bodies;
        byId.clear();
        for (const body of bodies) byId.set(body.id, body);
        if (interaction?.type === "body" && !byId.has(interaction.id))
          endInteraction();
        for (const id of trails.keys())
          if (!byId.get(id)?.trail) trails.delete(id);
        if (!current.display.trails) {
          trails.clear();
          trailClock = 0;
        } else if (trailClock >= 1 / 30) {
          trailClock %= 1 / 30;
          for (const body of bodies) {
            if (!body.trail || body.fixed) continue;
            let points = trails.get(body.id);
            if (!points) {
              points = [];
              trails.set(body.id, points);
            }
            const last = points[points.length - 1];
            if (
              !last ||
              Math.hypot(last.x - body.position.x, last.y - body.position.y) >
                0.008
            ) {
              points.push({ ...body.position });
              if (points.length > 240) points.shift();
            }
          }
        }
        if (commandId !== current.cameraCommand.id) {
          commandId = current.cameraCommand.id;
          endInteraction();
          if (current.cameraCommand.type === "fit") fitCamera();
          else
            zoomAt(
              { x: width / 2, y: height / 2 },
              current.cameraCommand.type === "in" ? 1.2 : 0.8,
            );
        }
        draw(ctx!);
        if (engine && !failed && now - lastReport >= 100) {
          lastReport = now;
          current.onFrame(
            engine.metrics(),
            snapshots,
            Math.round(fps || (fpsTime ? fpsFrames / fpsTime : 0)),
          );
        }
      } catch (error) {
        reportError(error);
      }
    }

    resize();
    const observer = new ResizeObserver(() => {
      try {
        resize();
      } catch (error) {
        reportError(error);
      }
    });
    observer.observe(canvas);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);
    canvas.addEventListener("lostpointercapture", onPointerEnd);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", endInteraction);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    frameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      endInteraction();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      canvas.removeEventListener("lostpointercapture", onPointerEnd);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", endInteraction);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      trails.clear();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="simulation-canvas"
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        touchAction: "none",
      }}
      aria-label="Interactive 2D physics simulation. Select and drag objects, use the hand tool to pan, or scroll to zoom."
      tabIndex={0}
    />
  );
}
