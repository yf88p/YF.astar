import { MATERIALS, createProject, validateProject } from './model.js';
import { seededRandom } from './math.js';

function clip(poly, nx, ny, limit) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * ny - limit, db = b[0] * nx + b[1] * ny - limit;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out.filter((a, i) => Math.hypot(a[0] - out[(i + 1) % out.length][0], a[1] - out[(i + 1) % out.length][1]) > 1e-10);
}

function polygonProperties(poly) {
  let twiceArea = 0, x = 0, y = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = a[0] * b[1] - b[0] * a[1];
    twiceArea += c; x += (a[0] + b[0]) * c; y += (a[1] + b[1]) * c;
  }
  return { area: twiceArea / 2, x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

function divisions(count, size) {
  const n = [1, 1, 1];
  for (let factor = 2; factor <= count; factor++) {
    while (count % factor === 0) {
      let axis = 0;
      for (let i = 1; i < 3; i++) if (size[i] / n[i] > size[axis] / n[axis]) axis = i;
      n[axis] *= factor; count /= factor;
    }
  }
  return n;
}

export function partitionObject(object, materials = MATERIALS) {
  const p = createProject('blank'); p.objects = [object]; p.materials = materials; validateProject(p);
  const { id, size: [w, h, d], density: count, seed, material } = object, m = materials[material];
  const regular = material === 'timber' || material === 'steel';
  let layers = 1, nx = 1, ny = 1;
  if (regular) [nx, ny, layers] = divisions(count, object.size);
  else if (material === 'concrete' && d > 0.2) {
    for (let l = 2; l <= Math.min(5, Math.floor(Math.sqrt(count))); l++) if (count % l === 0 && d / l > 0.08) layers = l;
  }
  const perLayer = count / layers, random = seededRandom(seed), cells = [], sites = [];
  if (regular) {
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const x0 = -w / 2 + w * x / nx, x1 = -w / 2 + w * (x + 1) / nx;
      const y0 = -h / 2 + h * y / ny, y1 = -h / 2 + h * (y + 1) / ny;
      cells.push({ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], neighbors: [y > 0 ? (y - 1) * nx + x : -1, x + 1 < nx ? y * nx + x + 1 : -1, y + 1 < ny ? (y + 1) * nx + x : -1, x > 0 ? y * nx + x - 1 : -1] });
    }
  } else {
    const rows = Math.max(1, Math.min(perLayer, Math.round(Math.sqrt(perLayer * h / w))));
    for (let row = 0; row < rows; row++) {
      const columns = Math.floor(perLayer / rows) + (row < perLayer % rows ? 1 : 0);
      for (let column = 0; column < columns; column++) sites.push([(column + 0.18 + 0.64 * random()) * w / columns - w / 2, (row + 0.18 + 0.64 * random()) * h / rows - h / 2]);
    }
    for (let i = 0; i < perLayer; i++) {
      let poly = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      const planes = [];
      for (let j = 0; j < perLayer; j++) if (i !== j) {
        const nx = sites[j][0] - sites[i][0], ny = sites[j][1] - sites[i][1];
        const limit = (sites[j][0] ** 2 + sites[j][1] ** 2 - sites[i][0] ** 2 - sites[i][1] ** 2) / 2;
        planes.push({ nx, ny, limit, j }); poly = clip(poly, nx, ny, limit);
      }
      const neighbors = poly.map((a, edge) => {
        const b = poly[(edge + 1) % poly.length];
        return planes.find(p => Math.abs(p.nx * a[0] + p.ny * a[1] - p.limit) < 1e-8 * Math.hypot(p.nx, p.ny) && Math.abs(p.nx * b[0] + p.ny * b[1] - p.limit) < 1e-8 * Math.hypot(p.nx, p.ny))?.j ?? -1;
      });
      cells.push({ poly, neighbors });
    }
  }
  const fragments = [], bonds = [], depth = d / layers;
  const grainAxis = object.size.indexOf(Math.max(...object.size));
  const addBond = (a, b, area, center, normal, sectionLength) => {
    const grainFactor = material === 'timber' && Math.abs(normal[grainAxis]) < 0.5 ? (m.grainStrength ?? 0.16) : 1;
    bonds.push({ id: `${id}:bond:${a}:${b}`, a: `${id}:${a}`, b: `${id}:${b}`, area, center, normal,
      threshold: m.threshold * grainFactor, toughness: m.toughness * grainFactor, material, grainFactor, sectionLength });
  };
  for (let layer = 0; layer < layers; layer++) for (let cell = 0; cell < perLayer; cell++) {
    const { poly, neighbors } = cells[cell], n = poly.length, props = polygonProperties(poly);
    const z = -d / 2 + (layer + 0.5) * depth, index = layer * perLayer + cell;
    const center = [props.x, props.y, z], vertices = [], indices = [], exterior = [];
    for (const zz of [-depth / 2, depth / 2]) for (const [x, y] of poly) vertices.push(x - props.x, y - props.y, zz);
    for (let i = 1; i < n - 1; i++) { indices.push(0, i + 1, i, n, n + i, n + i + 1); exterior.push(layer === 0, layer === layers - 1); }
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n, a = poly[i], b = poly[next];
      indices.push(i, next, n + next, i, n + next, n + i); exterior.push(neighbors[i] < 0, neighbors[i] < 0);
      if (neighbors[i] > cell) {
        const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
        addBond(index, layer * perLayer + neighbors[i], edgeLength * depth, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z], [(b[1] - a[1]) / edgeLength, (a[0] - b[0]) / edgeLength, 0], Math.max(edgeLength, depth));
      }
    }
    const volume = props.area * depth;
    fragments.push({ id: `${id}:${index}`, objectId: id, index, vertices, indices, center, volume, mass: volume * m.density, exterior, material });
    if (layer + 1 < layers) addBond(index, index + perLayer, props.area, [props.x, props.y, z + depth / 2], [0, 0, 1], Math.sqrt(props.area));
  }
  return { fragments, bonds };
}
