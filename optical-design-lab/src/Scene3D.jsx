import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import {
  elementBounds,
  objectPoints,
  prismVertices,
  toWorld,
} from "./optics.js";

const MAX_VISUAL_RAYS = 300;
const MINT = "#9ce4ce";
const NORMAL = "#a8c9ec";
const finitePoint = (point) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

function spectralColor(wavelength) {
  const w = THREE.MathUtils.clamp(wavelength, 380, 780);
  let r = 0,
    g = 0,
    b = 0;
  if (w < 440) {
    r = (440 - w) / 60;
    b = 1;
  } else if (w < 490) {
    g = (w - 440) / 50;
    b = 1;
  } else if (w < 510) {
    g = 1;
    b = (510 - w) / 20;
  } else if (w < 580) {
    r = (w - 510) / 70;
    g = 1;
  } else if (w < 645) {
    r = 1;
    g = (645 - w) / 65;
  } else r = 1;
  return new THREE.Color().setRGB(
    0.23 + 0.72 * r,
    0.23 + 0.72 * g,
    0.23 + 0.72 * b,
    THREE.SRGBColorSpace,
  );
}

function clearGroup(group) {
  const geometries = new Set(),
    materials = new Set();
  group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) {
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(material);
    }
  });
  group.clear();
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

// Tessellation is only for display. All intersections and hit normals come from optics.js.
function surfaceSag(radius, radial) {
  if (!radius) return 0;
  const r = Math.abs(radius);
  return (
    Math.sign(radius) *
    radial *
    (radial / (r + Math.sqrt(Math.max(0, (r - radial) * (r + radial)))))
  );
}

function opticalSurface(vertex, radius, aperture, side) {
  const segments = 96,
    rings = radius ? 28 : 1,
    a = aperture / 2;
  const positions = [vertex, 0, 0],
    normals = [side, 0, 0],
    indices = [];
  const angle = radius ? Math.asin(Math.min(1, a / Math.abs(radius))) : 0;
  for (let ring = 1; ring <= rings; ring++) {
    const r = radius ? Math.abs(radius) * Math.sin((angle * ring) / rings) : a;
    const x = vertex + surfaceSag(radius, r);
    for (let j = 0; j < segments; j++) {
      const theta = (j / segments) * Math.PI * 2,
        y = r * Math.cos(theta),
        z = r * Math.sin(theta);
      positions.push(x, y, z);
      normals.push(
        side * (radius ? Math.sqrt(Math.max(0, 1 - (r / radius) ** 2)) : 1),
        radius ? (-side * y) / radius : 0,
        radius ? (-side * z) / radius : 0,
      );
    }
  }
  const triangle = (a, b, c) =>
    indices.push(a, side > 0 ? b : c, side > 0 ? c : b);
  for (let j = 0; j < segments; j++)
    triangle(0, 1 + j, 1 + ((j + 1) % segments));
  for (let ring = 1; ring < rings; ring++) {
    for (let j = 0; j < segments; j++) {
      const a = 1 + (ring - 1) * segments + j,
        b = 1 + (ring - 1) * segments + ((j + 1) % segments);
      const c = 1 + ring * segments + j,
        d = 1 + ring * segments + ((j + 1) % segments);
      triangle(a, c, d);
      triangle(a, d, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function outline(
  group,
  points,
  color = MINT,
  opacity = 0.45,
  segments = false,
) {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map((p) => new THREE.Vector3(...p)),
  );
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
  const line = segments
    ? new THREE.LineSegments(geometry, material)
    : new THREE.Line(geometry, material);
  line.userData.outline = true;
  line.userData.baseColor = material.color.clone();
  line.userData.baseOpacity = opacity;
  group.add(line);
  return line;
}

function circle(group, x, radius, color, opacity) {
  return outline(
    group,
    Array.from({ length: 97 }, (_, i) => {
      const angle = (i / 96) * Math.PI * 2;
      return [x, radius * Math.cos(angle), radius * Math.sin(angle)];
    }),
    color,
    opacity,
  );
}

function makeElement(element, scale, dotTexture) {
  const group = new THREE.Group();
  group.name = element.name;
  group.userData.elementId = element.id;
  group.position.fromArray(element.position);
  // Three's ZYX Euler produces the API's active Rx, then Ry, then Rz rotation.
  group.rotation.set(
    ...element.rotation.map((degrees) => (degrees * Math.PI) / 180),
    "ZYX",
  );
  const glass = (opacity = 0.18, color = "#8cddc7") =>
    new THREE.MeshPhysicalMaterial({
      color,
      transparent: true,
      opacity,
      roughness: 0.2,
      metalness: 0.08,
      clearcoat: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
      forceSinglePass: true,
    });
  const mesh = (geometry, material) => {
    const object = new THREE.Mesh(geometry, material);
    group.add(object);
    return object;
  };

  if (element.type === "lens" || element.type === "slab") {
    const a = element.aperture / 2,
      t = element.thickness / 2;
    const r1 = element.type === "lens" ? element.radius1 : 0,
      r2 = element.type === "lens" ? element.radius2 : 0;
    const front = -t + surfaceSag(r1, a),
      back = t + surfaceSag(r2, a);
    const material = glass();
    mesh(opticalSurface(-t, r1, element.aperture, -1), material);
    mesh(opticalSurface(t, r2, element.aperture, 1), material);
    const rim = new THREE.CylinderGeometry(a, a, back - front, 96, 1, true);
    rim.rotateZ(-Math.PI / 2);
    rim.translate((front + back) / 2, 0, 0);
    mesh(rim, glass(0.28, "#75b9ad"));
    circle(group, front, a, MINT, 0.65);
    circle(group, back, a, MINT, 0.65);
    for (const [vertex, radius] of [
      [-t, r1],
      [t, r2],
    ]) {
      for (const axis of [1, 2]) {
        outline(
          group,
          Array.from({ length: 65 }, (_, i) => {
            const radial = a * (i / 32 - 1),
              point = [vertex + surfaceSag(radius, Math.abs(radial)), 0, 0];
            point[axis] = radial;
            return point;
          }),
          MINT,
          0.16,
        );
      }
    }
  } else if (element.type === "prism") {
    const vertices = prismVertices(element),
      shape = new THREE.Shape();
    shape.moveTo(...vertices[0]);
    vertices.slice(1).forEach((p) => shape.lineTo(...p));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: element.depth,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.translate(0, 0, -element.depth / 2);
    mesh(geometry, [glass(0.3, "#517f79"), glass(0.19)]);
    for (const z of [-element.depth / 2, element.depth / 2])
      outline(
        group,
        [...vertices, vertices[0]].map(([x, y]) => [x, y, z]),
        MINT,
        0.7,
      );
    outline(
      group,
      vertices.flatMap(([x, y]) => [
        [x, y, -element.depth / 2],
        [x, y, element.depth / 2],
      ]),
      MINT,
      0.6,
      true,
    );
  } else if (element.type === "mirror") {
    mesh(
      opticalSurface(0, element.radius, element.aperture, -1),
      new THREE.MeshStandardMaterial({
        color: "#afc6ce",
        metalness: 0.65,
        roughness: 0.23,
        side: THREE.DoubleSide,
      }),
    );
    circle(
      group,
      surfaceSag(element.radius, element.aperture / 2),
      element.aperture / 2,
      "#d4e6ec",
      0.85,
    );
    if (element.radius) {
      for (const axis of [1, 2])
        outline(
          group,
          Array.from({ length: 65 }, (_, i) => {
            const r = (element.aperture / 2) * (i / 32 - 1),
              point = [surfaceSag(element.radius, Math.abs(r)), 0, 0];
            point[axis] = r;
            return point;
          }),
          "#d4e6ec",
          0.22,
        );
    }
  } else if (element.type === "stop") {
    const ring = new THREE.RingGeometry(
      element.aperture / 2,
      element.diameter / 2,
      96,
    );
    ring.rotateY(Math.PI / 2);
    mesh(
      ring,
      new THREE.MeshStandardMaterial({
        color: "#34494e",
        metalness: 0.42,
        roughness: 0.56,
        side: THREE.DoubleSide,
      }),
    );
    circle(group, 0, element.diameter / 2, "#91a5a8", 0.7);
    if (element.aperture > 0)
      circle(group, 0, element.aperture / 2, "#b8ccc4", 0.8);
  } else if (element.type === "detector") {
    const w = element.width / 2,
      h = element.height / 2;
    const corners = [
      [0, -w, -h],
      [0, w, -h],
      [0, w, h],
      [0, -w, h],
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(
      corners.map((p) => new THREE.Vector3(...p)),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: "#84c4bd",
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    outline(group, [...corners, corners[0]], "#a1d6cb", 0.62);
    const grid = [];
    for (const fraction of [-0.5, 0, 0.5]) {
      grid.push(
        [0, w * fraction, -h],
        [0, w * fraction, h],
        [0, -w, h * fraction],
        [0, w, h * fraction],
      );
    }
    outline(group, grid, "#a1d6cb", 0.13, true);
    const brackets = corners.flatMap(([x, y, z]) => [
      [x, y, z * 0.78],
      [x, y, z],
      [x, y, z],
      [x, y * 0.78, z],
    ]);
    outline(group, brackets, "#c2f0df", 0.95, true);
  } else if (element.type === "source") {
    const points = objectPoints(element),
      radius = Math.max(scale * 0.0025, 0.00001);
    const geometry = new THREE.SphereGeometry(radius, 16, 12),
      material = new THREE.MeshBasicMaterial({
        color: "#f3dca0",
        toneMapped: false,
      });
    points.forEach((point) =>
      mesh(geometry, material).position.fromArray(point),
    );
    const halo = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(
        points.map((p) => new THREE.Vector3(...p)),
      ),
      new THREE.PointsMaterial({
        color: "#e9ce89",
        size: 20,
        sizeAttenuation: false,
        map: dotTexture,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.raycast = () => {};
    group.add(halo);
    if (element.kind === "extended")
      outline(
        group,
        [...points.slice(0, 5), points[5], points[4], points[6]],
        "#ecd49b",
        0.8,
      );
    if (element.kind === "collimated" && element.beamRadius > 0)
      circle(group, 0, element.beamRadius, "#c9b77f", 0.48);
    const length = Math.max(radius * 7, Math.min(scale * 0.035, 12));
    outline(
      group,
      [
        [radius * 2, 0, 0],
        [length, 0, 0],
        [length * 0.72, radius * 1.8, 0],
        [length, 0, 0],
        [length * 0.72, -radius * 1.8, 0],
      ],
      "#d5bd83",
      0.55,
    );
  }
  return group;
}

export default function Scene3D({
  project,
  result,
  selectedRayId,
  selectedIds,
  onSelect,
  onRaySelect,
  wavelengths,
  showRays = true,
  fitKey,
}) {
  const hostRef = useRef(null),
    axesRef = useRef(null),
    runtimeRef = useRef(null);
  const handlersRef = useRef({ onSelect, onRaySelect });
  const [unavailable, setUnavailable] = useState(false);
  const [traceInfo, setTraceInfo] = useState({
    shown: 0,
    total: 0,
    selected: null,
  });

  useEffect(() => {
    handlersRef.current = { onSelect, onRaySelect };
  }, [onSelect, onRaySelect]);

  useEffect(() => {
    const host = hostRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      "Interactive 3D optical project. Drag to orbit, right drag to pan, scroll to zoom. Arrow keys pan, Shift and arrow keys orbit, plus and minus zoom, F fits the scene. Click an optic to select; Shift-click adds to selection.",
    );
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101b21");
    scene.add(new THREE.HemisphereLight("#d6f7eb", "#273a46", 2));
    const keyLight = new THREE.DirectionalLight("#e2fff3", 3.2);
    keyLight.position.set(-1, 3, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight("#9ec8dc", 1.9);
    fillLight.position.set(2, 1, -3);
    scene.add(fillLight);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
    camera.position.set(100, 90, 260);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.rotateSpeed = 0.65;
    controls.panSpeed = 0.8;
    controls.zoomSpeed = 0.85;
    controls.listenToKeyEvents(canvas);
    const elements = new THREE.Group(),
      rays = new THREE.Group(),
      spots = new THREE.Group(),
      selected = new THREE.Group(),
      guides = new THREE.Group();
    scene.add(guides, elements, rays, spots, selected);

    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4,
          r = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
        pixels[i + 3] = Math.round(
          255 * THREE.MathUtils.clamp((1 - r) * 5, 0, 1),
        );
      }
    const dotTexture = new THREE.DataTexture(pixels, 32, 32);
    dotTexture.magFilter = THREE.LinearFilter;
    dotTexture.minFilter = THREE.LinearFilter;
    dotTexture.needsUpdate = true;
    const runtime = {
      renderer,
      scene,
      camera,
      controls,
      elements,
      rays,
      spots,
      selected,
      guides,
      dotTexture,
      bounds: new THREE.Box3(),
      elementBounds: new THREE.Box3(),
      selectedBounds: new THREE.Box3(),
      scale: 100,
      fitted: false,
      width: 1,
      height: 1,
      sampleCount: 0,
      eligibleCount: 0,
      rayOpacity: 0.3,
      selectedMaterial: null,
    };
    runtimeRef.current = runtime;
    const axisNodes = [...axesRef.current.querySelectorAll("[data-axis]")];
    const inverse = new THREE.Quaternion(),
      axis = new THREE.Vector3();
    let frame = 0,
      disposed = false,
      contextLost = false;
    const draw = () => {
      frame = 0;
      if (disposed || contextLost) return;
      const moving = controls.update();
      renderer.render(scene, camera);
      inverse.copy(camera.quaternion).invert();
      axisNodes.forEach((node, index) => {
        axis
          .set(index === 0 ? 1 : 0, index === 1 ? 1 : 0, index === 2 ? 1 : 0)
          .applyQuaternion(inverse);
        const x = 40 + axis.x * 26,
          y = 42 - axis.y * 26;
        node.querySelector("line").setAttribute("x2", x);
        node.querySelector("line").setAttribute("y2", y);
        node.querySelector("circle").setAttribute("cx", x);
        node.querySelector("circle").setAttribute("cy", y);
        node.querySelector("text").setAttribute("x", x);
        node.querySelector("text").setAttribute("y", y + 3);
        node.style.opacity = axis.z < -0.2 ? "0.5" : "1";
      });
      if (moving) invalidate();
    };
    const invalidate = () => {
      if (!frame && !disposed && !contextLost)
        frame = requestAnimationFrame(draw);
    };
    runtime.invalidate = invalidate;
    controls.addEventListener("change", invalidate);
    runtime.fit = () => {
      const bounds = runtime.bounds.clone().union(runtime.selectedBounds);
      if (bounds.isEmpty()) return;
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, runtime.scale * 0.1, 0.00001);
      // Reset residual damping only on explicit fit, never on prop updates.
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
      controls.reset();
      controls.target.copy(center);
      const direction = new THREE.Vector3(0.65, 0.42, 1).normalize();
      camera.position.copy(center).add(direction);
      camera.lookAt(center);
      const inverse = camera.quaternion.clone().invert();
      const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
        tanX = tanY * camera.aspect;
      let distance = radius * 0.25;
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            const corner = new THREE.Vector3(x, y, z)
              .sub(center)
              .applyQuaternion(inverse);
            distance = Math.max(
              distance,
              corner.z + Math.abs(corner.x) / tanX,
              corner.z + Math.abs(corner.y) / tanY,
            );
          }
      distance *= 1.18;
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.near = Math.max(radius / 10000, 0.0000001);
      camera.far = Math.max(distance * 100, radius * 500);
      controls.minDistance = radius * 0.015;
      controls.maxDistance = Math.max(distance * 20, radius * 30);
      camera.updateProjectionMatrix();
      controls.update();
      controls.saveState();
      runtime.fitted = true;
      invalidate();
    };
    const resize = () => {
      const width = Math.max(1, host.clientWidth),
        height = Math.max(1, host.clientHeight);
      runtime.width = width;
      runtime.height = height;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      runtime.selectedMaterial?.resolution.set(width, height);
      if (
        !runtime.fitted &&
        runtime.elements.children.length &&
        host.clientWidth &&
        host.clientHeight
      )
        runtime.fit();
      invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const raycaster = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    let down = null;
    const pointerDown = (event) => {
      canvas.focus({ preventScroll: true });
      if (event.button !== 0 || !event.isPrimary) {
        down = null;
        return;
      }
      down = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      canvas.style.cursor = "grabbing";
    };
    const pointerMove = (event) => {
      if (
        down &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5
      )
        down.moved = true;
    };
    const pointerCancel = () => {
      down = null;
      canvas.style.cursor = "grab";
    };
    const pointerUp = (event) => {
      const start = down;
      pointerCancel();
      if (
        !start ||
        start.moved ||
        event.pointerId !== start.id ||
        event.button !== 0
      )
        return;
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const threshold =
        ((camera.position.distanceTo(controls.target) *
          2 *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
          runtime.height) *
        4;
      raycaster.params.Line.threshold = threshold;
      raycaster.params.Points.threshold = threshold;
      const spot =
        handlersRef.current.onRaySelect &&
        raycaster.intersectObject(spots, true)[0];
      if (spot) {
        handlersRef.current.onRaySelect(
          spot.object.userData.rayIds[spot.index],
        );
        return;
      }
      const hit = raycaster.intersectObject(elements, true)[0];
      if (hit) {
        let object = hit.object;
        while (object && object.userData.elementId === undefined)
          object = object.parent;
        if (object)
          handlersRef.current.onSelect?.(object.userData.elementId, {
            shiftKey: event.shiftKey,
          });
        return;
      }
      if (handlersRef.current.onRaySelect && rays.visible) {
        const hit = raycaster
          .intersectObject(rays, true)
          .find((hit) => hit.object.visible);
        if (hit) handlersRef.current.onRaySelect(hit.object.userData.rayId);
      }
    };
    const keyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        runtime.fit();
      }
      if (["+", "=", "-", "_"].includes(event.key)) {
        event.preventDefault();
        const offset = camera.position.clone().sub(controls.target);
        const distance = THREE.MathUtils.clamp(
          offset.length() * (["+", "="].includes(event.key) ? 0.82 : 1.22),
          controls.minDistance,
          controls.maxDistance,
        );
        camera.position.copy(controls.target).add(offset.setLength(distance));
        controls.update();
        invalidate();
      }
    };
    const loseContext = (event) => {
      event.preventDefault();
      contextLost = true;
      setUnavailable(true);
    };
    const restoreContext = () => {
      contextLost = false;
      setUnavailable(false);
      resize();
    };
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerCancel);
    canvas.addEventListener("keydown", keyDown);
    canvas.addEventListener("webglcontextlost", loseContext);
    canvas.addEventListener("webglcontextrestored", restoreContext);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("keydown", keyDown);
      canvas.removeEventListener("webglcontextlost", loseContext);
      canvas.removeEventListener("webglcontextrestored", restoreContext);
      clearGroup(scene);
      dotTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    clearGroup(runtime.elements);
    clearGroup(runtime.guides);
    const bounds = new THREE.Box3();
    for (const element of project?.elements ?? []) {
      const box = elementBounds(element);
      bounds.expandByPoint(new THREE.Vector3(...box.min));
      bounds.expandByPoint(new THREE.Vector3(...box.max));
    }
    if (bounds.isEmpty())
      bounds.set(
        new THREE.Vector3(-50, -25, -25),
        new THREE.Vector3(50, 25, 25),
      );
    runtime.elementBounds.copy(bounds);
    runtime.bounds.copy(bounds);
    const size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    runtime.scale = Math.max(size.x, size.y, size.z, 0.001);
    for (const element of project?.elements ?? [])
      runtime.elements.add(
        makeElement(element, runtime.scale, runtime.dotTexture),
      );
    const step = 10 ** Math.floor(Math.log10(runtime.scale / 12));
    const gridSize = Math.ceil((runtime.scale * 2) / step) * step;
    const grid = new THREE.GridHelper(
      gridSize,
      Math.round(gridSize / step),
      "#33474c",
      "#27393f",
    );
    grid.position.set(
      Math.round(center.x / step) * step,
      bounds.min.y - runtime.scale * 0.06,
      Math.round(center.z / step) * step,
    );
    grid.material.transparent = true;
    grid.material.opacity = 0.43;
    grid.material.depthWrite = false;
    runtime.guides.add(grid);
    const axis = outline(
      runtime.guides,
      [
        [bounds.min.x - runtime.scale * 0.12, 0, 0],
        [bounds.max.x + runtime.scale * 0.12, 0, 0],
      ],
      "#72948c",
      0.23,
    );
    const oldMaterial = axis.material;
    axis.material = new THREE.LineDashedMaterial({
      color: "#72948c",
      transparent: true,
      opacity: 0.28,
      dashSize: runtime.scale * 0.012,
      gapSize: runtime.scale * 0.008,
      depthWrite: false,
    });
    oldMaterial.dispose();
    axis.computeLineDistances();
    runtime.elements.updateMatrixWorld(true);
    runtime.invalidate();
  }, [project]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    clearGroup(runtime.rays);
    clearGroup(runtime.spots);
    runtime.rays.visible = showRays;
    runtime.bounds.copy(runtime.elementBounds);
    const active = wavelengths == null ? null : new Set(wavelengths);
    const groups = new Map();
    for (const ray of result?.rays ?? []) {
      if (active && !active.has(ray.wavelength)) continue;
      if (!groups.has(ray.wavelength)) groups.set(ray.wavelength, []);
      groups.get(ray.wavelength).push(ray);
    }
    const bands = [...groups.values()],
      counts = bands.map(() => 0);
    runtime.eligibleCount = bands.reduce((sum, band) => sum + band.length, 0);
    // Reserve one slot for an unsampled selected ray; balance the rest across wavelengths.
    const limit = Math.min(MAX_VISUAL_RAYS - 1, runtime.eligibleCount);
    for (let n = 0; n < limit;)
      for (let i = 0; i < bands.length && n < limit; i++) {
        if (counts[i] < bands[i].length) {
          counts[i]++;
          n++;
        }
      }
    runtime.rayOpacity = limit > 150 ? 0.24 : limit > 50 ? 0.34 : 0.53;
    runtime.sampleCount = 0;
    bands.forEach((band, i) => {
      const material = new THREE.LineBasicMaterial({
        color: spectralColor(band[0].wavelength),
        transparent: true,
        opacity: runtime.rayOpacity,
        depthWrite: false,
        toneMapped: false,
      });
      if (!counts[i]) {
        material.dispose();
        return;
      }
      for (let j = 0; j < counts[i]; j++) {
        const ray = band[Math.floor(((j + 0.5) * band.length) / counts[i])];
        const points = (ray.points ?? [])
          .filter(finitePoint)
          .map((p) => new THREE.Vector3(...p));
        if (points.length < 2) continue;
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          material,
        );
        line.userData.rayId = ray.id;
        runtime.rays.add(line);
        runtime.sampleCount++;
        if (showRays)
          points.forEach((point) => runtime.bounds.expandByPoint(point));
      }
      if (!runtime.rays.children.some((line) => line.material === material))
        material.dispose();
    });

    const detectors = new Map(
      (project?.elements ?? [])
        .filter((e) => e.type === "detector")
        .map((e) => [e.id, e]),
    );
    const positions = [],
      colors = [],
      rayIds = [];
    for (const spot of result?.spots ?? []) {
      const detector = detectors.get(spot.detectorId);
      if (
        !detector ||
        (active && !active.has(spot.wavelength)) ||
        !Number.isFinite(spot.u) ||
        !Number.isFinite(spot.v)
      )
        continue;
      positions.push(...toWorld([0, spot.u, spot.v], detector));
      spectralColor(spot.wavelength).toArray(colors, colors.length);
      rayIds.push(spot.rayId);
    }
    if (positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colors, 3),
      );
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          size: 3.5,
          sizeAttenuation: false,
          vertexColors: true,
          map: runtime.dotTexture,
          transparent: true,
          opacity: 0.85,
          alphaTest: 0.05,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      points.userData.rayIds = rayIds;
      points.renderOrder = 3;
      runtime.spots.add(points);
    }
    if (
      !runtime.fitted &&
      project?.elements?.length &&
      hostRef.current.clientWidth &&
      hostRef.current.clientHeight
    )
      runtime.fit();
    runtime.invalidate();
  }, [project, result, wavelengths, showRays]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const ids = new Set(selectedIds ?? []);
    runtime.elements.children.forEach((group) => {
      const selected = ids.has(group.userData.elementId);
      group.traverse((object) => {
        if (object.userData.outline) {
          object.material.color.copy(
            selected ? new THREE.Color("#dcffed") : object.userData.baseColor,
          );
          object.material.opacity = selected
            ? Math.min(1, object.userData.baseOpacity * 1.6 + 0.15)
            : object.userData.baseOpacity;
        }
        for (const material of object.material
          ? Array.isArray(object.material)
            ? object.material
            : [object.material]
          : []) {
          if (material.emissive) {
            material.emissive.set(selected ? "#75c7a6" : "#000000");
            material.emissiveIntensity = selected ? 0.18 : 0;
          }
        }
      });
    });
    runtime.invalidate();
  }, [project, selectedIds]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    clearGroup(runtime.selected);
    runtime.selectedMaterial = null;
    runtime.selectedBounds.makeEmpty();
    const ray =
      showRays && selectedRayId != null
        ? result?.rays?.find(
            (ray) =>
              ray.id === selectedRayId &&
              (wavelengths == null || wavelengths.includes(ray.wavelength)),
          )
        : null;
    let sampled = false;
    runtime.rays.children.forEach((line) => {
      const isSelected = Boolean(ray && line.userData.rayId === ray.id);
      if (isSelected) sampled = true;
      line.visible = !isSelected;
      line.material.opacity = ray
        ? runtime.rayOpacity * 0.5
        : runtime.rayOpacity;
    });
    if (ray) {
      const color = spectralColor(ray.wavelength).lerp(
        new THREE.Color("#f0fff7"),
        0.4,
      );
      const rayPoints = (ray.points ?? []).filter(finitePoint);
      rayPoints.forEach((point) =>
        runtime.selectedBounds.expandByPoint(new THREE.Vector3(...point)),
      );
      const positions = rayPoints.flat();
      if (positions.length >= 6) {
        const geometry = new LineGeometry();
        geometry.setPositions(positions);
        const material = new LineMaterial({
          color,
          linewidth: 2.4,
          transparent: true,
          opacity: 0.98,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
        material.resolution.set(runtime.width, runtime.height);
        runtime.selectedMaterial = material;
        const line = new Line2(geometry, material);
        line.computeLineDistances();
        line.renderOrder = 8;
        runtime.selected.add(line);
      }
      const hits = (ray.hits ?? []).filter((hit) => finitePoint(hit.position)),
        arrows = [];
      const length = runtime.scale * 0.034,
        head = length * 0.2;
      for (const hit of hits) {
        if (!finitePoint(hit.normal)) continue;
        const direction = new THREE.Vector3(...hit.normal);
        if (!direction.lengthSq()) continue;
        direction.normalize();
        const origin = new THREE.Vector3(...hit.position),
          tip = origin.clone().addScaledVector(direction, length);
        runtime.selectedBounds.expandByPoint(origin);
        runtime.selectedBounds.expandByPoint(tip);
        const side = new THREE.Vector3()
          .crossVectors(
            direction,
            Math.abs(direction.y) < 0.9
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(0, 0, 1),
          )
          .normalize();
        const up = new THREE.Vector3()
          .crossVectors(direction, side)
          .normalize();
        arrows.push(origin.toArray(), tip.toArray());
        for (const vector of [side, up])
          for (const sign of [-1, 1])
            arrows.push(
              tip.toArray(),
              tip
                .clone()
                .addScaledVector(direction, -head)
                .addScaledVector(vector, sign * head * 0.45)
                .toArray(),
            );
      }
      if (arrows.length) {
        const normals = outline(runtime.selected, arrows, NORMAL, 0.86, true);
        normals.material.depthTest = false;
        normals.renderOrder = 9;
      }
      if (hits.length) {
        const geometry = new THREE.BufferGeometry().setFromPoints(
          hits.map((hit) => new THREE.Vector3(...hit.position)),
        );
        const points = new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            color: "#f2fff5",
            size: 6,
            sizeAttenuation: false,
            map: runtime.dotTexture,
            transparent: true,
            opacity: 1,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        points.renderOrder = 10;
        runtime.selected.add(points);
      }
    }
    setTraceInfo({
      shown: showRays ? runtime.sampleCount + (ray && !sampled ? 1 : 0) : 0,
      total: runtime.eligibleCount,
      selected: ray
        ? { wavelength: ray.wavelength, hits: ray.hits?.length ?? 0 }
        : null,
    });
    runtime.invalidate();
  }, [project, result, selectedRayId, wavelengths, showRays]);

  useEffect(() => {
    if (fitKey !== undefined) runtimeRef.current?.fit();
  }, [fitKey]);

  return (
    <div className="optical-scene3d" aria-label="3D optical workspace">
      <style>{`
        .optical-scene3d { position: relative; isolation: isolate; width: 100%; height: 100%; min-height: 260px; overflow: hidden; background: #101b21; color: #b7c9c9; font-family: inherit; }
        .optical-scene3d__canvas { position: absolute; inset: 0; }
        .optical-scene3d__canvas canvas { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; outline: none; }
        .optical-scene3d__canvas canvas:focus-visible { outline: 2px solid #9ce4ce; outline-offset: -3px; }
        .optical-scene3d__heading { position: absolute; top: 18px; left: 20px; pointer-events: none; display: grid; gap: 6px; font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
        .optical-scene3d__title { display: flex; align-items: center; gap: 8px; color: #d5e5df; letter-spacing: .15em; }
        .optical-scene3d__dot { width: 5px; height: 5px; border-radius: 50%; background: #9ce4ce; box-shadow: 0 0 10px #9ce4ce40; }
        .optical-scene3d__count { color: #91a7ac; letter-spacing: .02em; }
        .optical-scene3d__selected { color: #b9d3e9; padding-top: 4px; }
        .optical-scene3d__fit { position: absolute; right: 16px; top: 16px; display: flex; align-items: center; gap: 7px; min-height: 34px; padding: 7px 10px; border: 1px solid #354b51; border-radius: 5px; background: #17262ce8; color: #c1d5d0; font-family: inherit; font-size: 11px; line-height: 1.2; cursor: pointer; transition: background .15s, border-color .15s; }
        .optical-scene3d__fit:hover { background: #233a3d; border-color: #759f92; }
        .optical-scene3d__fit:focus-visible { outline: 2px solid #9ce4ce; outline-offset: 3px; }
        .optical-scene3d__help { position: absolute; left: 20px; bottom: 18px; display: flex; flex-wrap: wrap; gap: 5px 14px; max-width: calc(100% - 120px); pointer-events: none; color: #92a6ac; font-size: 10px; line-height: 1.7; }
        .optical-scene3d__help b { font-weight: 500; color: #c0d0cc; }
        .optical-scene3d__axes { position: absolute; right: 10px; bottom: 10px; width: 80px; height: 86px; pointer-events: none; }
        .optical-scene3d__notice { position: absolute; inset: 0; z-index: 2; display: grid; place-content: center; gap: 10px; padding: 32px; text-align: center; background: #101b21; }
        .optical-scene3d__notice strong { color: #dfebe5; font-size: 15px; font-weight: 500; }
        .optical-scene3d__notice p { max-width: 340px; margin: 0; color: #a7babe; font-size: 12px; line-height: 1.8; }
        @media (max-width: 520px) { .optical-scene3d__heading { left: 12px; top: 14px; font-size: 9px; } .optical-scene3d__fit { right: 10px; top: 10px; min-height: 38px; } .optical-scene3d__help { left: 12px; bottom: 12px; gap: 0 10px; max-width: calc(100% - 100px); } .optical-scene3d__desktop-help { display: none; } }
      `}</style>
      <div className="optical-scene3d__canvas" ref={hostRef} />
      <div className="optical-scene3d__heading">
        <div className="optical-scene3d__title">
          <span className="optical-scene3d__dot" />
          PERSPECTIVE{" "}
          <span style={{ color: "#78918e", letterSpacing: 0 }}> / mm</span>
        </div>
        <div className="optical-scene3d__count">
          {showRays
            ? `${traceInfo.shown.toLocaleString()} / ${traceInfo.total.toLocaleString()} ray paths`
            : "Ray paths hidden"}
        </div>
        {traceInfo.selected && (
          <div className="optical-scene3d__selected">
            {traceInfo.selected.wavelength} nm &middot;{" "}
            {traceInfo.selected.hits} hits &middot; normals shown
          </div>
        )}
      </div>
      {!unavailable && (
        <button
          type="button"
          className="optical-scene3d__fit"
          onClick={() => runtimeRef.current?.fit()}
          title="Fit the optical scene (F)"
          aria-label="Fit 3D scene"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          </svg>
          Fit view
        </button>
      )}
      <div className="optical-scene3d__help">
        <span>
          <b>Drag</b> orbit
        </span>
        <span>
          <b>Right drag</b> pan
        </span>
        <span>
          <b>Scroll / pinch</b> zoom
        </span>
        <span className="optical-scene3d__desktop-help">
          <b>Shift-click</b> multi-select
        </span>
      </div>
      <svg
        ref={axesRef}
        className="optical-scene3d__axes"
        viewBox="0 0 80 86"
        aria-label="World coordinate axes"
        role="img"
      >
        <circle cx="40" cy="42" r="3" fill="#7b9495" />
        {[
          ["X", "#d7a08f"],
          ["Y", "#a1cda6"],
          ["Z", "#94b8d6"],
        ].map(([label, color]) => (
          <g key={label} data-axis={label}>
            <line
              x1="40"
              y1="42"
              x2="40"
              y2="42"
              stroke={color}
              strokeWidth="1.25"
            />
            <circle
              cx="40"
              cy="42"
              r="8"
              fill="#17272d"
              stroke={color}
              strokeWidth="0.8"
            />
            <text
              x="40"
              y="45"
              fill={color}
              textAnchor="middle"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
            >
              {label}
            </text>
          </g>
        ))}
        <text
          x="40"
          y="82"
          textAnchor="middle"
          fill="#7c979c"
          fontSize="8"
          letterSpacing="1.5"
          fontFamily="ui-monospace, monospace"
        >
          WORLD
        </text>
      </svg>
      {unavailable && (
        <div className="optical-scene3d__notice" role="status">
          <strong>3D view unavailable</strong>
          <p>
            This view needs WebGL 2. Enable browser hardware acceleration or use
            a WebGL-capable browser. Your optical project and traced results are
            unchanged.
          </p>
        </div>
      )}
    </div>
  );
}
