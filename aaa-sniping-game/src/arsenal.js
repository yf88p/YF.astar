import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

// Geometry is shared within each asset collection, never across disposal boundaries.
function parts(castShadow = true) {
  const geometries = new Set();
  const materials = new Set();
  const keep = (geometry) => (geometries.add(geometry), geometry);
  const cube = keep(new THREE.BoxGeometry(1, 1, 1));
  const ball = keep(new THREE.SphereGeometry(1, 16, 12));
  const tube = keep(new THREE.CylinderGeometry(1, 1, 1, 20));
  const taper = keep(new THREE.CylinderGeometry(0.78, 1, 1, 16));
  const direction = new THREE.Vector3();

  function material(color, roughness = 0.7, metalness = 0, extra = {}) {
    const result = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    materials.add(result);
    return result;
  }

  function mesh(parent, geometry, surface, position = [0, 0, 0]) {
    const result = new THREE.Mesh(geometry, surface);
    result.position.fromArray(position);
    result.castShadow = castShadow;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }

  function box(parent, size, position, surface, rotation) {
    const result = mesh(parent, cube, surface, position);
    result.scale.fromArray(size);
    if (rotation) result.rotation.set(...rotation);
    return result;
  }

  function sphere(parent, size, position, surface) {
    const result = mesh(parent, ball, surface, position);
    result.scale.fromArray(size);
    return result;
  }

  function rod(parent, from, to, radius, surface, tapered = false) {
    const result = mesh(parent, tapered ? taper : tube, surface);
    result.position.fromArray(from);
    direction.fromArray(to).sub(result.position);
    result.position.addScaledVector(direction, 0.5);
    result.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
    result.scale.set(radius, direction.length(), radius);
    return result;
  }

  function cylinder(parent, radius, length, position, surface, axis = 'z') {
    const result = mesh(parent, tube, surface, position);
    result.scale.set(radius, length, radius);
    if (axis === 'z') result.rotation.x = Math.PI / 2;
    if (axis === 'x') result.rotation.z = Math.PI / 2;
    return result;
  }

  // Side-profile extrusion gives the chassis real bevels rather than stacked boxes.
  function profile(parent, outline, width, position, surface, bevel = 0.003, cutouts = []) {
    const shape = new THREE.Shape();
    outline.forEach(([z, y], index) => index ? shape.lineTo(z, y) : shape.moveTo(z, y));
    shape.closePath();
    for (const outline of cutouts) {
      const hole = new THREE.Path();
      outline.forEach(([z, y], index) => index ? hole.lineTo(z, y) : hole.moveTo(z, y));
      hole.closePath();
      shape.holes.push(hole);
    }
    const geometry = keep(new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 1,
      steps: 1,
      curveSegments: 1,
    }));
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(width / 2, 0, 0);
    return mesh(parent, geometry, surface, position);
  }

  function ring(parent, radius, thickness, position, surface, axis = 'z') {
    const geometry = keep(new THREE.TorusGeometry(radius, thickness, 6, 28));
    const result = mesh(parent, geometry, surface, position);
    if (axis === 'x') result.rotation.y = Math.PI / 2;
    if (axis === 'y') result.rotation.x = Math.PI / 2;
    return result;
  }

  // Merge only siblings: animated joints and separate head hit zones stay intact.
  function batch(root, vertexSurface = null) {
    const groups = [];
    root.traverse((object) => { if (object.isGroup) groups.push(object); });
    for (const parent of groups) {
      const surfaces = new Map();
      for (const child of parent.children) {
        if (!child.isMesh) continue;
        const key = vertexSurface ? child.castShadow : child.material;
        if (!surfaces.has(key)) surfaces.set(key, []);
        surfaces.get(key).push(child);
      }
      for (const [key, children] of surfaces) {
        if (children.length < 2 && !vertexSurface) continue;
        const pieces = children.map((child) => {
          child.updateMatrix();
          const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
          geometry.deleteAttribute('uv');
          if (vertexSurface) {
            const colors = new THREE.Float32BufferAttribute(geometry.attributes.position.count * 3, 3);
            const { r, g, b } = child.material.color;
            for (let i = 0; i < colors.count; i++) colors.setXYZ(i, r, g, b);
            geometry.setAttribute('color', colors);
          }
          return geometry.applyMatrix4(child.matrix);
        });
        const geometry = keep(mergeGeometries(pieces));
        pieces.forEach((piece) => piece.dispose());
        children.forEach((child) => parent.remove(child));
        const result = mesh(parent, geometry, vertexSurface ?? key);
        if (vertexSurface) result.castShadow = key;
      }
    }
  }

  function dispose() {
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((surface) => surface.dispose());
  }

  return { box, sphere, rod, cylinder, profile, ring, mesh, material, keep, batch, dispose };
}

function joint(parent, position) {
  const result = new THREE.Group();
  result.position.fromArray(position);
  parent.add(result);
  return result;
}

/** A camera-attached, meter-scale bolt-action rifle. time and dt are seconds. */
export function createRifle(camera) {
  const p = parts();
  const group = new THREE.Group();
  group.name = 'M-24 Alpine Precision Rifle';
  camera.add(group);

  const tan = p.material(0x8b8465, 0.76, 0.22);
  const tanEdge = p.material(0xa49a79, 0.67, 0.25);
  const olive = p.material(0x545941, 0.87, 0.05);
  const black = p.material(0x151b1c, 0.36, 0.82);
  const steel = p.material(0x424c4e, 0.27, 0.88);
  const worn = p.material(0x78817c, 0.4, 0.76);
  const rubber = p.material(0x191e1c, 0.95, 0.02);
  const inset = p.material(0x090e10, 0.82, 0.15);
  const fabric = p.material(0x4e5647, 0.98);
  const seam = p.material(0x69715b, 0.96);
  const glove = p.material(0x343a31, 0.93);
  const glovePanel = p.material(0x545746, 0.88);
  const markings = p.material(0xb3b9a5, 0.68, 0.15);
  const glass = p.material(0x174b50, 0.15, 0.6, {
    emissive: 0x082729,
    emissiveIntensity: 0.22,
  });
  const lensGlint = p.material(0x54818a, 0.2, 0.7);

  const screw = (parent, x, y, z, radius = 0.004) => {
    p.cylinder(parent, radius, 0.002, [x, y, z], steel, 'x');
    p.box(parent, [0.0025, radius * 0.3, radius * 1.2], [x * 1.012, y, z], inset);
  };

  // Skeletonized adjustable stock, recoil pad, cheek riser and chassis spine.
  p.profile(group, [
    [0.23, 0.025], [0.05, 0.046], [-0.10, 0.026], [-0.14, -0.037],
    [-0.08, -0.065], [0.08, -0.072], [0.23, -0.13],
  ], 0.069, [0, 0, 0], tan, 0.003, [[
    [0.196, 0.005], [0.084, 0.018], [0.015, -0.033], [0.196, -0.088],
  ]]);
  p.rod(group, [0, -0.073, -0.03], [0, -0.106, 0.205], 0.012, tanEdge);
  p.box(group, [0.083, 0.158, 0.029], [0, -0.052, 0.236], rubber, [0.08, 0, 0]);
  for (let i = 0; i < 8; i++) {
    p.box(group, [0.085, 0.003, 0.007], [0, 0.008 - i * 0.017, 0.254], inset);
  }
  p.profile(group, [[0.195, 0.037], [0.17, 0.065], [0.021, 0.065], [-0.005, 0.033]],
    0.078, [0, 0, 0], olive, 0.005);
  for (const z of [0.035, 0.154]) {
    p.cylinder(group, 0.006, 0.035, [0, 0.026, z], steel, 'y');
    screw(group, 0.045, 0.019, z, 0.007);
  }
  p.ring(group, 0.013, 0.003, [0.045, -0.075, 0.183], black, 'x');

  p.profile(group, [
    [-0.091, 0.025], [-0.67, 0.023], [-0.728, -0.006], [-0.70, -0.058],
    [-0.32, -0.068], [-0.24, -0.091], [-0.13, -0.073],
  ], 0.079, [0, 0, 0], tan);
  p.profile(group, [
    [-0.076, -0.049], [-0.114, -0.065], [-0.074, -0.195], [-0.025, -0.182],
    [-0.037, -0.096],
  ], 0.049, [0, 0, 0], rubber, 0.005);
  for (let i = 0; i < 6; i++) {
    p.box(group, [0.052, 0.003, 0.023], [0, -0.105 - i * 0.013, -0.063 + i * 0.003], olive);
  }
  // Open trigger guard and a separate curved trigger.
  p.rod(group, [0, -0.066, -0.111], [0, -0.118, -0.136], 0.006, black);
  p.rod(group, [0, -0.118, -0.136], [0, -0.116, -0.217], 0.006, black);
  p.rod(group, [0, -0.116, -0.217], [0, -0.061, -0.231], 0.006, black);
  p.rod(group, [0, -0.061, -0.161], [0, -0.088, -0.166], 0.004, steel);
  p.rod(group, [0, -0.088, -0.166], [0, -0.099, -0.179], 0.004, steel);
  p.profile(group, [[-0.243, -0.063], [-0.346, -0.063], [-0.334, -0.162], [-0.25, -0.17]],
    0.051, [0, 0, 0], black);
  for (const z of [-0.27, -0.297, -0.321]) {
    p.box(group, [0.054, 0.065, 0.006], [0, -0.118, z], steel);
  }
  p.box(group, [0.059, 0.009, 0.091], [0, -0.165, -0.292], rubber);

  // Receiver, ejection recess, exposed bolt and bolt-handle pivot.
  p.cylinder(group, 0.032, 0.29, [0, 0.033, -0.235], black);
  p.box(group, [0.014, 0.032, 0.112], [0.029, 0.039, -0.234], inset);
  p.cylinder(group, 0.012, 0.108, [0.033, 0.036, -0.232], steel);
  p.box(group, [0.006, 0.005, 0.105], [0.045, 0.047, -0.233], worn);
  p.cylinder(group, 0.035, 0.017, [0, 0.033, -0.086], steel);
  const bolt = joint(group, [0, 0.033, -0.101]);
  p.rod(bolt, [0.023, 0, 0], [0.070, -0.031, 0.013], 0.007, steel);
  p.rod(bolt, [0.070, -0.031, 0.013], [0.087, -0.046, 0.015], 0.008, black);
  p.sphere(bolt, [0.018, 0.02, 0.022], [0.091, -0.05, 0.015], black);
  for (let i = 0; i < 4; i++) {
    p.ring(bolt, 0.017, 0.0012, [0.091, -0.05, 0.004 + i * 0.006], steel);
  }
  p.box(group, [0.014, 0.008, 0.023], [0.037, 0.059, -0.113], steel, [0, 0.2, -0.2]);
  p.sphere(group, [0.003, 0.003, 0.0015], [0.045, 0.055, -0.105], p.material(0xa65339));

  // Free-floating, longitudinally fluted barrel and its recessed brake ports.
  p.cylinder(group, 0.023, 0.082, [0, 0.029, -0.414], steel);
  p.cylinder(group, 0.017, 0.67, [0, 0.029, -0.766], black);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const x = Math.cos(angle) * 0.0165;
    const y = 0.029 + Math.sin(angle) * 0.0165;
    const flute = p.box(group, [0.005, 0.0015, 0.40], [x, y, -0.853], inset);
    flute.rotation.z = angle - Math.PI / 2;
  }
  for (const z of [-0.459, -1.068, -1.099]) {
    p.cylinder(group, 0.019, 0.009, [0, 0.029, z], steel);
  }
  p.profile(group, [[-1.10, 0.047], [-1.22, 0.047], [-1.227, 0.039], [-1.227, 0.006], [-1.10, 0.006]],
    0.048, [0, 0, 0], black, 0.003);
  for (let i = 0; i < 3; i++) {
    const z = -1.127 - i * 0.028;
    for (const side of [-1, 1]) {
      p.box(group, [0.002, 0.024, 0.013], [side * 0.0275, 0.027, z], inset, [0.18, 0, 0]);
      p.box(group, [0.002, 0.020, 0.002], [side * 0.028, 0.029, z - 0.007], steel);
    }
    p.box(group, [0.026, 0.002, 0.011], [0, 0.0505, z], inset);
  }
  p.cylinder(group, 0.014, 0.002, [0, 0.029, -1.232], inset);
  p.ring(group, 0.013, 0.002, [0, 0.029, -1.234], steel);
  const muzzle = joint(group, [0, 0.029, -1.25]);
  const muzzlePosition = new THREE.Vector3();

  // Picatinny rail teeth, machined M-LOK slots, fasteners and folded bipod.
  p.box(group, [0.041, 0.014, 0.41], [0, 0.066, -0.285], black);
  for (let i = 0; i < 25; i++) {
    p.box(group, [0.049, 0.007, 0.009], [0, 0.077, -0.085 - i * 0.016], steel);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z = -0.391 - i * 0.048;
      p.box(group, [0.002, 0.013, 0.030], [side * 0.043, -0.02, z], inset);
      p.box(group, [0.0025, 0.002, 0.027], [side * 0.044, -0.027, z], tanEdge);
    }
    for (const z of [-0.12, -0.36, -0.70]) screw(group, side * 0.044, -0.044, z);
    p.cylinder(group, 0.022, 0.018, [side * 0.045, -0.045, -0.652], black, 'x');
    p.rod(group, [side * 0.06, -0.047, -0.665], [side * 0.068, -0.071, -0.96], 0.010, black);
    p.rod(group, [side * 0.068, -0.071, -0.87], [side * 0.070, -0.075, -1.035], 0.006, steel);
    p.box(group, [0.025, 0.020, 0.04], [side * 0.070, -0.079, -1.034], rubber, [0.1, 0, side * 0.15]);
    for (let i = 0; i < 7; i++) {
      p.cylinder(group, 0.012, 0.0025, [side * 0.063, -0.055, -0.70 - i * 0.012], steel);
    }
  }

  // Oversized objective, recessed coated lenses, scope rings and three turrets.
  const scopeY = 0.155;
  p.cylinder(group, 0.022, 0.31, [0, scopeY, -0.299], black);
  p.cylinder(group, 0.034, 0.078, [0, scopeY, -0.105], black);
  p.cylinder(group, 0.030, 0.017, [0, scopeY, -0.057], rubber);
  p.cylinder(group, 0.0255, 0.003, [0, scopeY, -0.047], glass);
  p.ring(group, 0.027, 0.003, [0, scopeY, -0.042], black);
  p.ring(group, 0.021, 0.0007, [0, scopeY, -0.044], lensGlint);
  p.sphere(group, [0.004, 0.011, 0.0006], [-0.014, scopeY + 0.009, -0.044], lensGlint);
  p.rod(group, [0, scopeY, -0.437], [0, scopeY, -0.493], 0.038, black, true);
  p.cylinder(group, 0.043, 0.097, [0, scopeY, -0.536], black);
  p.cylinder(group, 0.037, 0.004, [0, scopeY, -0.581], glass);
  p.ring(group, 0.040, 0.004, [0, scopeY, -0.589], rubber);
  p.ring(group, 0.036, 0.001, [0, scopeY, -0.585], lensGlint);
  for (const z of [-0.184, -0.379]) {
    p.box(group, [0.05, 0.044, 0.025], [0, 0.1, z], black);
    p.ring(group, 0.025, 0.006, [0, scopeY, z], steel);
    for (const side of [-1, 1]) {
      p.box(group, [0.01, 0.013, 0.028], [side * 0.03, scopeY, z], black);
      screw(group, side * 0.036, scopeY, z, 0.004);
    }
  }
  p.box(group, [0.046, 0.045, 0.055], [0, scopeY, -0.285], black);
  p.cylinder(group, 0.025, 0.030, [0, scopeY + 0.032, -0.285], black, 'y');
  p.cylinder(group, 0.026, 0.006, [0, scopeY + 0.051, -0.285], steel, 'y');
  p.cylinder(group, 0.019, 0.029, [0.035, scopeY, -0.285], black, 'x');
  p.cylinder(group, 0.020, 0.006, [0.053, scopeY, -0.285], steel, 'x');
  p.cylinder(group, 0.017, 0.02, [-0.032, scopeY, -0.285], black, 'x');
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12;
    p.box(group, [0.002, 0.018, 0.003],
      [Math.cos(a) * 0.025, scopeY + 0.034, -0.285 + Math.sin(a) * 0.025], steel, [0, -a, 0]);
    const tick = i % 3 === 0 ? 0.007 : 0.003;
    p.box(group, [0.0014, tick, 0.001],
      [Math.cos(a) * 0.0263, scopeY + 0.041, -0.285 + Math.sin(a) * 0.0263], markings, [0, -a, 0]);
  }
  for (const z of [-0.085, -0.135, -0.49, -0.563]) {
    p.ring(group, z < -0.45 ? 0.043 : 0.034, 0.002, [0, scopeY, z], steel);
  }
  for (let i = 0; i < 20; i++) {
    const a = i * Math.PI / 10;
    p.rod(group, [Math.cos(a) * 0.034, scopeY + Math.sin(a) * 0.034, -0.13],
      [Math.cos(a) * 0.034, scopeY + Math.sin(a) * 0.034, -0.102], 0.0015, rubber);
  }
  p.box(group, [0.002, 0.011, 0.044], [0.035, 0.007, -0.312], black);
  for (let i = 0; i < 5; i++) {
    p.box(group, [0.0025, 0.0015, 0.004], [0.036, 0.010, -0.326 + i * 0.007], markings);
  }

  // Gloves use rounded palms, individual curled fingers and raised knuckle panels.
  const rightHand = joint(group, [0.024, -0.115, -0.04]);
  p.sphere(rightHand, [0.031, 0.052, 0.031], [0.01, -0.012, 0.004], glove);
  p.sphere(rightHand, [0.027, 0.035, 0.013], [0.025, -0.010, 0.021], glovePanel);
  for (let i = 0; i < 3; i++) {
    const y = -0.007 - i * 0.017;
    p.rod(rightHand, [0.028, y, -0.011], [0.006, y - 0.003, -0.035], 0.009, glove);
    p.sphere(rightHand, [0.012, 0.009, 0.011], [0.025, y, -0.015], glovePanel);
    p.rod(rightHand, [0.006, y - 0.003, -0.035], [-0.019, y - 0.003, -0.027], 0.008, glove);
  }
  p.rod(rightHand, [0.025, 0.026, -0.016], [0.013, 0.028, -0.066], 0.008, glove);
  p.rod(rightHand, [0.013, 0.028, -0.066], [0.006, 0.019, -0.094], 0.007, glove);
  p.rod(rightHand, [-0.012, 0.02, 0.011], [-0.025, 0.038, -0.023], 0.011, glove);
  p.rod(rightHand, [0.018, -0.047, 0.014], [0.063, -0.087, 0.058], 0.035, glove);
  p.rod(rightHand, [0.055, -0.08, 0.049], [0.15, -0.176, 0.223], 0.052, fabric, true);
  p.rod(rightHand, [0.052, -0.075, 0.05], [0.065, -0.089, 0.068], 0.042, seam);
  for (let i = 0; i < 3; i++) {
    p.sphere(rightHand, [0.044, 0.014, 0.03], [0.073 + i * 0.022, -0.107 - i * 0.021, 0.098 + i * 0.035], fabric);
  }
  const leftHand = joint(group, [-0.017, -0.068, -0.584]);
  p.sphere(leftHand, [0.043, 0.025, 0.055], [0, -0.015, 0], glove);
  for (let i = 0; i < 4; i++) {
    const z = -0.034 + i * 0.019;
    p.rod(leftHand, [0.022, -0.01, z], [0.046, 0.012, z], 0.009, glove);
    p.rod(leftHand, [0.046, 0.012, z], [0.043, 0.035, z - 0.002], 0.008, glove);
    p.sphere(leftHand, [0.011, 0.012, 0.009], [0.044, 0.010, z], glovePanel);
  }
  p.rod(leftHand, [-0.027, -0.003, 0.024], [-0.033, 0.028, 0.049], 0.012, glove);
  p.rod(leftHand, [-0.018, -0.023, 0.033], [-0.086, -0.087, 0.109], 0.037, glove);
  p.rod(leftHand, [-0.074, -0.079, 0.102], [-0.15, -0.189, 0.312], 0.054, fabric, true);
  p.rod(leftHand, [-0.073, -0.076, 0.092], [-0.087, -0.095, 0.124], 0.041, seam);
  p.box(leftHand, [0.032, 0.011, 0.038], [-0.082, -0.063, 0.115], black, [0.4, 0.1, -0.35]);
  p.box(leftHand, [0.023, 0.012, 0.029], [-0.082, -0.061, 0.115], inset, [0.4, 0.1, -0.35]);

  p.batch(group);
  group.traverse((object) => { if (object.isMesh) object.castShadow = false; });

  let reloadTime = 0;
  let reloadBlend = 0;
  let wasReloading = false;
  let movementBlend = 0;
  function update(time = 0, dt = 1 / 60, state = {}) {
    const aim = clamp01(state.aim ?? 0);
    const recoil = clamp01(state.recoil ?? 0);
    const step = Math.min(Math.max(dt, 0), 0.25);
    const reloading = Boolean(state.reloading);
    if (reloading && !wasReloading) reloadTime = 0;
    if (reloading) reloadTime += step;
    wasReloading = reloading;
    reloadBlend = THREE.MathUtils.damp(reloadBlend, reloading ? 1 : 0, 9, step);
    movementBlend = THREE.MathUtils.damp(movementBlend, state.moving ? 1 : 0, 7, step);
    const hip = 1 - aim;
    const framing = Math.min(1, camera.aspect / 1.5);
    const bob = Math.sin(time * 8.4) * movementBlend;
    group.visible = aim < 0.985;
    group.scale.setScalar((0.8 + framing * 0.2) * (0.86 + framing * 0.14));
    group.position.set(
      0.245 * hip * framing + Math.sin(time * 1.13) * 0.002 * hip + bob * 0.004,
      THREE.MathUtils.lerp(-0.267 - (1 - framing) * 0.035, -scopeY, aim) + Math.sin(time * 1.8) * 0.0022 * hip
        + Math.cos(time * 16.8) * 0.003 * movementBlend - reloadBlend * 0.065,
      THREE.MathUtils.lerp(-0.46, -0.29, aim) + recoil * 0.075 + reloadBlend * 0.045,
    );
    group.rotation.set(
      0.012 * hip + recoil * 0.075 + bob * 0.006 - reloadBlend * 0.10,
      0.13 * hip * framing + Math.sin(time * 1.3) * 0.002 * hip - reloadBlend * 0.17,
      -0.045 * hip + bob * 0.008 + reloadBlend * 0.43,
    );
    // Cycle the bolt while the firing hand leaves the grip and follows its knob.
    const cycle = clamp01(reloadTime / 1.75);
    const lift = Math.sin(clamp01(cycle / 0.23) * Math.PI / 2)
      * (1 - clamp01((cycle - 0.76) / 0.18)) * reloadBlend;
    const pull = Math.sin(clamp01((cycle - 0.19) / 0.58) * Math.PI) * reloadBlend;
    bolt.rotation.z = lift * 0.88;
    bolt.position.z = -0.101 + pull * 0.09;
    rightHand.position.set(0.024 + lift * 0.070, -0.115 + lift * 0.095, -0.04 + pull * 0.09);
    rightHand.rotation.set(lift * -0.3, lift * 0.25, lift * -0.5);
    group.updateWorldMatrix(true, true);
    muzzle.getWorldPosition(muzzlePosition);
  }

  update();
  return {
    group,
    update,
    muzzlePosition,
    dispose() {
      group.removeFromParent();
      p.dispose();
    },
  };
}

/** Infantry targets: spawn positions are feet at ground level; +Y is up. */
export function createTargets(scene, spawns) {
  const p = parts(false);
  const targetSurface = p.material(0xffffff, 0.91, 0.08, { vertexColors: true });
  const cloth = [0x566052, 0x6c7058, 0x4e5a50, 0x74715c, 0x5c665b]
    .map((color) => p.material(color, 0.96));
  const pants = [0x41493f, 0x555947, 0x59614f, 0x484e43, 0x62644f]
    .map((color) => p.material(color, 0.97));
  const armor = p.material(0x343e32, 0.93);
  const webbing = p.material(0x73765b, 0.94);
  const pocket = p.material(0x60674e, 0.94);
  const boot = p.material(0x2c302a, 0.94);
  const sole = p.material(0x171d19, 0.98);
  const skin = [0xa17e61, 0x8d6b50, 0xb29276, 0x755745, 0x9b8067]
    .map((color) => p.material(color, 0.91));
  const faceShadow = p.material(0x4a483b, 0.96);
  const metal = p.material(0x242c2b, 0.5, 0.62);
  const edge = p.material(0x505a53, 0.48, 0.58);
  const goggles = p.material(0x263a37, 0.22, 0.45);
  const patch = p.material(0xa49c76, 0.88);

  // A tailored torso with elliptical rings, narrower neck and a jacket hem.
  const jacketVertices = [];
  const jacketIndices = [];
  const jacketRings = [
    [-0.23, 0.20, 0.127], [-0.17, 0.223, 0.139],
    [0.10, 0.247, 0.143], [0.19, 0.202, 0.119], [0.24, 0.104, 0.091],
  ];
  for (const [y, rx, rz] of jacketRings) {
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      jacketVertices.push(Math.cos(angle) * rx, y, Math.sin(angle) * rz);
    }
  }
  for (let row = 0; row < jacketRings.length - 1; row++) {
    for (let i = 0; i < 16; i++) {
      const a = row * 16 + i;
      const b = row * 16 + (i + 1) % 16;
      jacketIndices.push(a, a + 16, b, b, a + 16, b + 16);
    }
  }
  for (let i = 1; i < 15; i++) {
    jacketIndices.push(0, i, i + 1, 64, 64 + i + 1, 64 + i);
  }
  const jacketGeometry = p.keep(new THREE.BufferGeometry());
  jacketGeometry.setAttribute('position', new THREE.Float32BufferAttribute(jacketVertices, 3));
  jacketGeometry.setIndex(jacketIndices);
  jacketGeometry.computeVertexNormals();
  const helmetGeometry = p.keep(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.59));

  const targets = spawns.map((spawn, id) => {
    const variant = id % 5;
    const group = new THREE.Group();
    group.name = spawn.name || `Alpine patrol ${id + 1}`;
    group.position.copy(spawn.position);
    scene.add(group);
    const rig = joint(group, [0, 0, 0]);
    const facing = Math.PI + [-0.18, 0.28, -0.38, 0.12, 0.44][variant];
    rig.rotation.y = facing;
    const uniform = cloth[variant];
    const trouser = pants[variant];

    // Only major body volumes cast shadows; straps, hardware and weapons do not.
    p.sphere(rig, [0.223, 0.14, 0.137], [0, 1.005, 0.014], trouser).castShadow = true;
    p.cylinder(rig, 0.218, 0.048, [0, 1.079, 0], armor, 'y').scale.z *= 0.64;
    p.box(rig, [0.057, 0.047, 0.018], [0, 1.076, -0.143], edge);
    for (const x of [-0.16, -0.088, 0.09, 0.165]) {
      p.box(rig, [0.024, 0.065, 0.012], [x, 1.077, -0.119], webbing);
    }
    p.box(rig, [0.075, 0.19, 0.083], [0.235, 0.957, 0.036], armor, [0.06, 0, -0.12]);
    p.box(rig, [0.04, 0.075, 0.039], [0.247, 1.073, 0.046], metal, [0.15, 0, -0.12]);
    const legs = [];
    const knees = [];
    for (const side of [-1, 1]) {
      const leg = joint(rig, [side * 0.112, 0.974, 0.017]);
      p.rod(leg, [0, -0.423, 0], [side * 0.012, -0.02, 0], 0.112, trouser, true).castShadow = true;
      p.sphere(leg, [0.107, 0.17, 0.107], [0, -0.13, 0], trouser).castShadow = true;
      p.box(leg, [0.045, 0.146, 0.112], [side * 0.093, -0.242, 0.006], uniform, [0, 0, side * 0.035]);
      p.box(leg, [0.049, 0.034, 0.119], [side * 0.096, -0.18, 0.007], pocket);
      p.box(leg, [0.082, 0.014, 0.012], [0, -0.295, -0.096], webbing, [0, 0, side * 0.06]);
      const knee = joint(leg, [0, -0.442, 0]);
      p.sphere(knee, [0.084, 0.086, 0.083], [0, 0, 0], trouser).castShadow = true;
      p.rod(knee, [0, -0.345, 0.012], [0, -0.038, 0], 0.084, trouser, true).castShadow = true;
      p.sphere(knee, [0.083, 0.128, 0.08], [0, -0.12, 0.01], trouser).castShadow = true;
      p.sphere(knee, [0.073, 0.087, 0.028], [0, -0.017, -0.079], armor);
      p.box(knee, [0.055, 0.008, 0.009], [0, -0.018, -0.106], webbing);
      p.cylinder(knee, 0.086, 0.018, [0, -0.037, 0], armor, 'y').scale.z *= 0.91;
      p.sphere(knee, [0.081, 0.105, 0.082], [0, -0.329, 0.01], boot).castShadow = true;
      p.sphere(knee, [0.088, 0.068, 0.156], [0, -0.447, -0.052], boot).castShadow = true;
      p.box(knee, [0.163, 0.035, 0.262], [0, -0.492, -0.047], sole).castShadow = true;
      p.sphere(knee, [0.084, 0.032, 0.075], [0, -0.461, -0.132], sole).castShadow = true;
      p.box(knee, [0.064, 0.074, 0.023], [0, -0.389, -0.074], pocket, [-0.17, 0, 0]);
      for (let lace = 0; lace < 4; lace++) {
        p.rod(knee, [-0.029, -0.365 - lace * 0.018, -0.09], [0.029, -0.374 - lace * 0.018, -0.091], 0.003, webbing);
      }
      legs.push(leg);
      knees.push(knee);
    }

    const torso = joint(rig, [0, 1.25, 0]);
    p.mesh(torso, jacketGeometry, uniform).castShadow = true;
    p.box(torso, [0.013, 0.37, 0.011], [0, -0.012, -0.145], webbing);
    p.sphere(torso, [0.181, 0.201, 0.035], [0, -0.011, -0.14], armor).castShadow = true;
    p.profile(torso, [[-0.019, 0.145], [-0.019, -0.148], [-0.066, -0.168], [-0.066, 0.114]],
      0.323, [0, 0, -0.10], armor, 0.008).castShadow = true;
    for (const side of [-1, 1]) {
      p.box(torso, [0.056, 0.166, 0.021], [side * 0.126, 0.091, -0.123], webbing, [-0.27, 0, side * -0.10]);
      p.rod(torso, [side * 0.125, 0.16, -0.106], [side * 0.136, 0.191, -0.044], 0.017, webbing);
      p.box(torso, [0.059, 0.027, 0.031], [side * 0.131, 0.088, -0.149], metal);
    }
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        p.box(torso, [0.038, 0.009, 0.008], [-0.128 + col * 0.051, 0.045 - row * 0.037, -0.173], webbing);
      }
    }
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.102;
      p.box(torso, [0.087, 0.133, 0.047], [x, -0.135, -0.183], pocket);
      p.box(torso, [0.09, 0.033, 0.053], [x, -0.078, -0.187], webbing);
      p.box(torso, [0.014, 0.047, 0.007], [x, -0.111, -0.213], armor);
      p.sphere(torso, [0.005, 0.005, 0.003], [x, -0.12, -0.218], metal);
    }
    p.box(torso, [0.076, 0.021, 0.009], [0.045, 0.118, -0.168], patch);
    p.box(torso, [0.055, 0.068, 0.034], [-0.15, 0.078, -0.166], metal);
    p.rod(torso, [-0.165, 0.11, -0.17], [-0.177, 0.29, -0.15], 0.003, metal);
    p.rod(torso, [-0.147, 0.113, -0.17], [-0.114, 0.205, -0.12], 0.005, armor);
    // Rounded assault pack and side utility kit, with visible retention straps.
    p.sphere(torso, [0.173, 0.215, 0.095], [0, -0.005, 0.184], armor).castShadow = true;
    p.box(torso, [0.244, 0.24, 0.063], [0, -0.035, 0.237], uniform);
    p.sphere(torso, [0.132, 0.059, 0.052], [0, 0.116, 0.237], pocket);
    for (const x of [-0.074, 0.074]) {
      p.box(torso, [0.024, 0.303, 0.014], [x, -0.018, 0.275], webbing);
      p.box(torso, [0.033, 0.032, 0.019], [x, -0.042, 0.286], metal);
    }
    p.sphere(torso, [0.059, 0.103, 0.055], [-0.223, -0.146, 0.106], pocket);

    const arms = [];
    const elbows = [];
    for (const side of [-1, 1]) {
      const arm = joint(torso, [side * 0.233, 0.13, 0]);
      const elbowOffset = side < 0 ? [-0.03, -0.22, -0.19] : [0.044, -0.251, -0.035];
      p.sphere(arm, [0.098, 0.122, 0.102], [side * 0.007, -0.036, 0], uniform);
      p.rod(arm, elbowOffset, [0, -0.015, 0], 0.088, uniform, true);
      p.box(arm, [0.024, 0.103, 0.075], [side * 0.085, -0.076, -0.015], pocket, [0, 0, side * 0.1]);
      p.box(arm, [0.025, 0.036, 0.058], [side * 0.09, -0.056, -0.016], armor);
      const elbow = joint(arm, elbowOffset);
      const wrist = side < 0 ? [0.24, 0, -0.25] : [-0.178, -0.002, -0.218];
      p.sphere(elbow, [0.075, 0.073, 0.072], [0, 0, 0], uniform);
      p.rod(elbow, wrist, [0, 0, 0], 0.071, uniform, true);
      p.sphere(elbow, [0.062, 0.055, 0.029], [side * 0.01, 0.009, 0.063], armor);
      p.sphere(elbow, [0.057, 0.038, 0.051], wrist, boot);
      p.sphere(elbow, [0.05, 0.025, 0.035], [wrist[0], wrist[1] - 0.003, wrist[2] - 0.032], pocket);
      for (let finger = 0; finger < 3; finger++) {
        p.sphere(elbow, [0.008, 0.025, 0.013],
          [wrist[0] - 0.023 + finger * 0.018, wrist[1] - 0.01, wrist[2] - 0.04], boot);
      }
      arms.push(arm);
      elbows.push(elbow);
    }

    // Compact infantry rifle, held with both hands at low ready.
    const weapon = joint(torso, [0.101, -0.104, -0.257]);
    weapon.rotation.set(-0.12, 0.40, -0.04);
    p.box(weapon, [0.055, 0.065, 0.25], [0, 0.065, -0.071], metal);
    p.profile(weapon, [[0.216, 0.118], [0.067, 0.095], [0.047, 0.044], [0.197, 0.001], [0.221, 0.002]],
      0.047, [0, 0, 0], armor);
    p.box(weapon, [0.052, 0.117, 0.018], [0, 0.063, 0.217], sole);
    p.box(weapon, [0.043, 0.102, 0.041], [0, -0.02, 0.003], sole, [-0.2, 0, 0]);
    p.box(weapon, [0.041, 0.13, 0.065], [0, -0.034, -0.13], armor, [-0.16, 0, 0]);
    p.box(weapon, [0.063, 0.057, 0.193], [0, 0.07, -0.274], armor);
    p.cylinder(weapon, 0.011, 0.225, [0, 0.079, -0.48], metal);
    p.cylinder(weapon, 0.016, 0.045, [0, 0.079, -0.602], metal);
    p.cylinder(weapon, 0.009, 0.001, [0, 0.079, -0.626], sole);
    p.box(weapon, [0.028, 0.014, 0.382], [0, 0.108, -0.17], edge);
    for (let i = 0; i < 7; i++) {
      p.box(weapon, [0.067, 0.008, 0.011], [0, 0.085, -0.199 - i * 0.024], metal);
    }
    p.box(weapon, [0.04, 0.034, 0.032], [0, 0.128, -0.057], metal);
    p.cylinder(weapon, 0.023, 0.068, [0, 0.155, -0.057], metal);
    p.cylinder(weapon, 0.017, 0.001, [0, 0.155, -0.092], goggles);
    p.rod(torso, [0.123, 0.157, -0.113], [0.08, -0.113, -0.234], 0.01, webbing);

    // Neck, balaclava, exposed facial planes and a helmet with separate hardware.
    const head = joint(torso, [0, 0.261, 0]);
    p.cylinder(head, 0.065, 0.086, [0, 0.005, 0], faceShadow, 'y').castShadow = true;
    p.sphere(head, [0.105, 0.139, 0.106], [0, 0.117, -0.004], faceShadow).castShadow = true;
    p.sphere(head, [0.084, 0.108, 0.032], [0, 0.116, -0.086], skin[variant]);
    p.sphere(head, [0.067, 0.045, 0.034], [0, 0.052, -0.078], skin[variant]);
    p.sphere(head, [0.012, 0.024, 0.018], [0, 0.111, -0.117], skin[variant]);
    p.box(head, [0.043, 0.004, 0.005], [0, 0.063, -0.112], faceShadow);
    for (const side of [-1, 1]) {
      p.sphere(head, [0.014, 0.029, 0.018], [side * 0.103, 0.103, -0.004], skin[variant]);
      p.box(head, [0.051, 0.033, 0.014], [side * 0.034, 0.153, -0.112], metal, [0, side * 0.13, 0]);
      p.box(head, [0.042, 0.023, 0.015], [side * 0.034, 0.153, -0.12], goggles, [0, side * 0.13, 0]);
      p.rod(head, [side * 0.104, 0.154, -0.03], [side * 0.067, 0.021, -0.062], 0.007, webbing);
    }
    p.box(head, [0.02, 0.01, 0.012], [0, 0.156, -0.118], metal);
    p.rod(head, [-0.066, 0.021, -0.062], [0.066, 0.021, -0.062], 0.007, webbing);
    const helmet = p.mesh(head, helmetGeometry, uniform, [0, 0.184, 0.004]);
    helmet.scale.set(0.132, 0.112, 0.137);
    helmet.castShadow = true;
    const helmetRim = p.ring(head, 0.128, 0.005, [0, 0.153, 0.004], armor, 'y');
    helmetRim.scale.y = 1.04;
    p.box(head, [0.043, 0.041, 0.023], [0, 0.224, -0.124], metal, [0.22, 0, 0]);
    p.box(head, [0.025, 0.018, 0.028], [0, 0.225, -0.141], edge, [0.22, 0, 0]);
    p.box(head, [0.031, 0.013, 0.055], [0, 0.297, -0.013], webbing, [-0.08, 0, 0]);
    for (const side of [-1, 1]) {
      p.box(head, [0.011, 0.018, 0.087], [side * 0.126, 0.188, 0.005], armor, [0, 0, side * 0.07]);
      p.sphere(head, [0.026, 0.047, 0.037], [side * 0.115, 0.112, 0.015], armor);
      p.box(head, [0.006, 0.026, 0.044], [side * 0.136, 0.221, 0.013], webbing);
    }
    p.rod(head, [0.123, 0.098, -0.001], [0.096, 0.068, -0.105], 0.004, metal);
    p.rod(head, [0.096, 0.068, -0.105], [0.046, 0.066, -0.129], 0.004, metal);
    p.sphere(head, [0.012, 0.007, 0.008], [0.042, 0.066, -0.129], sole);
    if (variant === 1 || variant === 4) {
      p.sphere(head, [0.075, 0.045, 0.034], [0, 0.046, -0.10], uniform);
    }
    if (variant === 2) {
      p.rod(torso, [0.13, 0.12, 0.25], [0.155, 0.47, 0.26], 0.003, metal);
    }

    p.batch(group, targetSurface);
    const hitMeshes = [];
    head.traverse((object) => {
      if (object.isMesh) object.userData.zone = 'head';
    });
    group.traverse((object) => {
      if (!object.isMesh) return;
      object.userData.targetId = id;
      object.userData.zone ??= 'body';
      hitMeshes.push(object);
    });
    return {
      id,
      name: group.name,
      group,
      alive: true,
      position: group.position,
      hitMeshes,
      headPosition: new THREE.Vector3(),
      aimPoint: new THREE.Vector3(),
      basePosition: spawn.position.clone(),
      patrol: Math.max(0, Number(spawn.patrol) || 0),
      rig,
      torso,
      head,
      legs,
      knees,
      arms,
      elbows,
      facing,
      phase: id * 1.73,
      fallTime: 0,
      fallDirection: id % 2 ? -1 : 1,
      deathPose: null,
      hitPoint: new THREE.Vector3(),
      meshes: [...hitMeshes],
    };
  });

  const byId = new Map(targets.map((target) => [target.id, target]));
  let elapsed = 0;

  function update(time = 0, dt = 1 / 60) {
    const step = Math.min(Math.max(dt, 0), 0.1);
    elapsed += step;
    for (const target of targets) {
      const { rig, torso, head, legs, knees, arms, elbows, phase } = target;
      if (target.alive) {
        const patrolPhase = elapsed * 0.32 + phase;
        const speed = Math.cos(patrolPhase) * target.patrol * 0.32;
        const walking = Math.min(Math.abs(speed) * 1.8, 1);
        const stride = elapsed * 3.8 + phase;
        target.group.position.x = target.basePosition.x
          + Math.sin(patrolPhase) * target.patrol;
        rig.position.y = Math.abs(Math.sin(stride)) * 0.012 * walking;
        rig.rotation.set(0, target.facing + Math.sin(patrolPhase) * 0.12 * walking, 0);
        torso.rotation.set(Math.sin(time * 1.5 + phase) * 0.006, Math.sin(time * 0.7 + phase) * 0.025,
          Math.sin(stride) * 0.013 * walking);
        head.rotation.set(0.015 + Math.sin(time * 0.9 + phase) * 0.017,
          Math.sin(time * 0.43 + phase) * 0.13, 0);
        for (let i = 0; i < 2; i++) {
          const swing = Math.sin(stride + i * Math.PI);
          legs[i].rotation.x = swing * 0.26 * walking;
          knees[i].rotation.x = Math.max(0, -swing) * 0.33 * walking;
          arms[i].rotation.x = swing * 0.025 * walking + Math.sin(time * 1.5 + phase) * 0.004;
          elbows[i].rotation.x = Math.sin(stride + i) * 0.012 * walking;
        }
      } else if (target.deathPose) {
        target.fallTime += step;
        const progress = clamp01(target.fallTime / 0.72);
        const fall = progress * progress;
        const impactTime = Math.max(0, target.fallTime - 0.72);
        const bounce = progress === 1 ? Math.sin(impactTime * 20) * Math.exp(-impactTime * 8) * 0.06 : 0;
        rig.rotation.x = fall * 1.52 - bounce;
        rig.rotation.z = target.fallDirection * fall * 0.19;
        rig.position.y = THREE.MathUtils.lerp(target.deathPose.height, 0.14, fall);
        torso.rotation.x = THREE.MathUtils.lerp(target.deathPose.torsoX, -0.045, progress);
        head.rotation.x = THREE.MathUtils.lerp(target.deathPose.headX, 0.15, progress);
        head.rotation.z = target.fallDirection * progress * 0.16;
        for (let i = 0; i < 2; i++) {
          legs[i].rotation.x = THREE.MathUtils.lerp(target.deathPose.legs[i], i ? -0.13 : 0.08, progress);
          knees[i].rotation.x = THREE.MathUtils.lerp(target.deathPose.knees[i], i ? 0.20 : 0.08, progress);
          arms[i].rotation.z = (i ? -1 : 1) * progress * 0.23;
          elbows[i].rotation.x = progress * -0.16;
        }
      }
      target.group.updateWorldMatrix(true, true);
      target.headPosition.set(0, 0.13, 0).applyMatrix4(head.matrixWorld);
      target.aimPoint.set(0, 0.01, -0.05).applyMatrix4(torso.matrixWorld);
    }
  }

  function hit(object, point) {
    let owner = object;
    while (owner && owner.userData.targetId === undefined) owner = owner.parent;
    const target = owner ? byId.get(owner.userData.targetId) : null;
    if (!target?.alive) return null;
    const headshot = owner.userData.zone === 'head';
    target.alive = false;
    target.fallTime = 0;
    if (point?.isVector3) target.hitPoint.copy(point);
    else target.hitPoint.copy(target.aimPoint);
    target.deathPose = {
      height: target.rig.position.y,
      torsoX: target.torso.rotation.x,
      headX: target.head.rotation.x,
      legs: target.legs.map((leg) => leg.rotation.x),
      knees: target.knees.map((knee) => knee.rotation.x),
    };
    // Corpses remain visible, but cannot intercept subsequent target raycasts.
    target.hitMeshes.length = 0;
    return { target, headshot };
  }

  function reset() {
    elapsed = 0;
    for (const target of targets) {
      target.alive = true;
      target.fallTime = 0;
      target.deathPose = null;
      target.group.position.copy(target.basePosition);
      target.rig.position.set(0, 0, 0);
      target.rig.rotation.set(0, target.facing, 0);
      target.torso.rotation.set(0, 0, 0);
      target.head.rotation.set(0, 0, 0);
      for (const limb of [...target.legs, ...target.knees, ...target.arms, ...target.elbows]) {
        limb.rotation.set(0, 0, 0);
      }
      target.hitMeshes.splice(0, target.hitMeshes.length, ...target.meshes);
    }
    update(0, 0);
  }

  update(0, 0);
  return {
    targets,
    update,
    hit,
    reset,
    dispose() {
      targets.forEach((target) => {
        target.group.removeFromParent();
        target.hitMeshes.length = 0;
      });
      byId.clear();
      p.dispose();
    },
  };
}
