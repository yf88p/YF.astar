import {
  clone,
  keyOf,
  LIMITS,
  targetPosition,
  validateDocument,
  type Constraint,
  type Document,
  type Target,
} from './model';

export type SolveStatus =
  'underconstrained' | 'fully-constrained' | 'redundant' | 'conflicting' | 'nonconvergent' | 'singular';
export type DragTarget = { target: Target; x: number; y: number };
export type SolveResult = {
  ok: boolean;
  document: Document;
  status: SolveStatus;
  dof: number | null;
  rank: number | null;
  redundant: number;
  residual: number;
  angularResidual: number;
  iterations: number;
  elapsedMs: number;
  message: string;
  conflicts: string[];
  immovableTargets: string[];
};
type Row = {
  indices: number[];
  values: number[];
  f: number;
  angular: boolean;
  id: string;
  measured?: number;
};
type Layout = {
  x: Float64Array;
  points: Map<string, number>;
  radii: Map<string, number>;
  eliminated: number;
};
const POSITION_TOL = 1e-8;
const ANGLE_TOL = 1e-9;

function layout(d: Document, eliminateCoincidence = true): Layout {
  const values: number[] = [],
    points = new Map<string, number>(),
    radii = new Map<string, number>();
  const raw = new Map<string, { x: number; y: number }>(),
    parent = new Map<string, string>();
  const root = (key: string): string => {
    const p = parent.get(key);
    if (!p) return key;
    const r = root(p);
    parent.set(key, r);
    return r;
  };
  for (const c of d.constraints)
    if (eliminateCoincidence && (c.type === 'coincident' || (c.type === 'distance' && c.value === 0))) {
      const a = root(keyOf(c.a)),
        b = root(keyOf(c.b));
      if (a !== b) parent.set(a, b);
    }
  const point = (id: string, part: string, p: { x: number; y: number }) => {
    raw.set(`${id}/${part}`, p);
  };
  for (const e of d.entities) {
    if (e.type === 'point') point(e.id, 'point', e);
    if (e.type === 'line') {
      point(e.id, 'a', e.a);
      point(e.id, 'b', e.b);
    }
    if (e.type === 'circle') point(e.id, 'center', e.center);
  }
  // Coincidence is exact variable elimination, not a post-solve coordinate adjustment.
  // Its independent scalar equations are added back to the reported full-system rank.
  const groups = new Map<
    string,
    { index: number; count: number; firstX: number; firstY: number; identical: boolean }
  >();
  for (const [key, p] of raw) {
    const r = root(key);
    if (!groups.has(r)) {
      groups.set(r, { index: values.length, count: 0, firstX: p.x, firstY: p.y, identical: true });
      values.push(0, 0);
    }
    const g = groups.get(r)!;
    values[g.index] += p.x;
    values[g.index + 1] += p.y;
    g.count++;
    g.identical &&= p.x === g.firstX && p.y === g.firstY;
    points.set(key, g.index);
  }
  for (const g of groups.values()) {
    values[g.index] = g.identical ? g.firstX : values[g.index] / g.count;
    values[g.index + 1] = g.identical ? g.firstY : values[g.index + 1] / g.count;
  }
  const eliminated = 2 * (raw.size - groups.size);
  for (const e of d.entities)
    if (e.type === 'circle') {
      radii.set(e.id, values.length);
      values.push(e.radius);
    }
  return { x: new Float64Array(values), points, radii, eliminated };
}
function unpack(d: Document, l: Layout, x: Float64Array): Document {
  const out = clone(d);
  for (const [key, i] of l.points) {
    const slash = key.lastIndexOf('/');
    const p = targetPosition(out, {
      entity: key.slice(0, slash),
      point: key.slice(slash + 1) as Target['point'],
    });
    p.x = x[i];
    p.y = x[i + 1];
  }
  for (const e of out.entities) if (e.type === 'circle') e.radius = x[l.radii.get(e.id)!];
  return out;
}
function equations(d: Document, l: Layout, x: Float64Array): Row[] {
  const rows: Row[] = [];
  const at = (t: Target) => l.points.get(keyOf(t))!;
  const add = (c: Constraint, f: number, indices: number[], values: number[], angular = false) => {
    // Repeated references must combine derivatives rather than overwrite them.
    const unique = new Map<number, number>();
    indices.forEach((i, k) => unique.set(i, (unique.get(i) ?? 0) + values[k]));
    for (const [i, value] of unique) if (value === 0) unique.delete(i);
    rows.push({ id: c.id, f, angular, indices: [...unique.keys()], values: [...unique.values()] });
  };
  for (const c of d.constraints) {
    switch (c.type) {
      case 'fixed': {
        const i = at(c.target);
        add(c, x[i] - c.x, [i], [1]);
        add(c, x[i + 1] - c.y, [i + 1], [1]);
        break;
      }
      case 'radius': {
        const i = l.radii.get(c.circle)!;
        add(c, x[i] - c.value, [i], [1]);
        break;
      }
      case 'horizontal':
      case 'vertical': {
        const axis = c.type === 'horizontal' ? 1 : 0,
          a = l.points.get(`${c.line}/a`)! + axis,
          b = l.points.get(`${c.line}/b`)! + axis;
        add(c, x[b] - x[a], [a, b], [-1, 1]);
        break;
      }
      case 'coincident':
      case 'distance': {
        const a = at(c.a),
          b = at(c.b),
          dx = x[b] - x[a],
          dy = x[b + 1] - x[a + 1];
        if (c.type === 'coincident' || c.value === 0) {
          add(c, dx, [a, b], [-1, 1]);
          add(c, dy, [a + 1, b + 1], [-1, 1]);
        } else {
          const len = Math.hypot(dx, dy),
            ux = len > 1e-14 ? dx / len : 1,
            uy = len > 1e-14 ? dy / len : 0;
          add(c, len - c.value, [a, a + 1, b, b + 1], [-ux, -uy, ux, uy]);
        }
        break;
      }
      case 'parallel':
      case 'perpendicular': {
        const a = l.points.get(`${c.a}/a`)!,
          b = l.points.get(`${c.a}/b`)!,
          p = l.points.get(`${c.b}/a`)!,
          q = l.points.get(`${c.b}/b`)!;
        const ux = x[b] - x[a],
          uy = x[b + 1] - x[a + 1],
          vx = x[q] - x[p],
          vy = x[q + 1] - x[p + 1];
        const u = Math.hypot(ux, uy),
          v = Math.hypot(vx, vy),
          denom = u * v;
        if (u <= LIMITS.minDirection || v <= LIMITS.minDirection) {
          add(c, Infinity, [], [], true);
          break;
        }
        const cross = ux * vy - uy * vx,
          dot = ux * vx + uy * vy,
          theta = Math.atan2(cross, dot);
        const target =
          c.type === 'parallel'
            ? Math.abs(theta) <= Math.PI / 2
              ? 0
              : Math.sign(theta) * Math.PI
            : theta >= 0
              ? Math.PI / 2
              : -Math.PI / 2;
        // Wrapped angle equations avoid the zero sine/cosine gradient when adding
        // perpendicular to exactly parallel lines (and the converse).
        const f = theta - target,
          dux = uy / (u * u),
          duy = -ux / (u * u),
          dvx = -vy / (v * v),
          dvy = vx / (v * v);
        add(
          c,
          f,
          [a, a + 1, b, b + 1, p, p + 1, q, q + 1],
          [-dux, -duy, dux, duy, -dvx, -dvy, dvx, dvy],
          true,
        );
        rows[rows.length - 1].measured = (c.type === 'parallel' ? cross : dot) / denom;
      }
    }
  }
  return rows;
}
function residual(rows: Row[]) {
  let position = 0,
    angular = 0;
  for (const r of rows)
    if (r.angular) angular = Math.max(angular, Math.abs(r.measured ?? r.f));
    else position = Math.max(position, Math.abs(r.f));
  return { position, angular };
}
function valid(rows: Row[]) {
  const r = residual(rows);
  return r.position <= POSITION_TOL && r.angular <= ANGLE_TOL;
}
function energy(rows: Row[]) {
  return rows.reduce((s, r) => s + r.f * r.f, 0);
}
function finite(x: Float64Array, l: Layout) {
  return (
    x.every((v) => Number.isFinite(v) && Math.abs(v) <= LIMITS.coordinate) &&
    [...l.radii.values()].every((i) => x[i] > 0)
  );
}

// Matrix-free, diagonally preconditioned conjugate gradients on J'J + lambda I.
// Each Jacobian row has at most eight nonzeros; no dense normal matrix is built.
function step(rows: Row[], n: number, lambda: number, deadline: number, preference = false): Float64Array {
  const b = new Float64Array(n),
    diag = new Float64Array(n).fill(lambda);
  for (const r of rows)
    for (let k = 0; k < r.indices.length; k++) {
      const i = r.indices[k],
        v = r.values[k];
      b[i] -= v * r.f;
      diag[i] += v * v;
    }
  const dx = new Float64Array(n),
    rem = b.slice(),
    z = rem.map((v, i) => v / Math.max(diag[i], 1e-30)),
    p = z.slice();
  let rz = rem.reduce((s, v, i) => s + v * z[i], 0);
  const initial = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  for (let iteration = 0; iteration < Math.min(n * 2 + 20, preference ? 100 : 600); iteration++) {
    if (iteration % 16 === 0 && performance.now() > deadline) break;
    const ap = p.map((v) => lambda * v);
    for (const r of rows) {
      let dot = 0;
      for (let k = 0; k < r.indices.length; k++) dot += r.values[k] * p[r.indices[k]];
      for (let k = 0; k < r.indices.length; k++) ap[r.indices[k]] += r.values[k] * dot;
    }
    const pap = p.reduce((s, v, i) => s + v * ap[i], 0);
    if (pap <= 1e-40 || !Number.isFinite(pap) || rz < 1e-40) break;
    const alpha = rz / pap;
    for (let i = 0; i < n; i++) {
      dx[i] += alpha * p[i];
      rem[i] -= alpha * ap[i];
    }
    if (Math.hypot(...rem) < Math.max(1e-13, initial * (preference ? 1e-5 : 1e-11))) break;
    let next = 0;
    for (let i = 0; i < n; i++) {
      z[i] = rem[i] / Math.max(diag[i], 1e-30);
      next += rem[i] * z[i];
    }
    const beta = next / rz;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = next;
  }
  return dx;
}

function rank(
  rows: Row[],
  n: number,
  deadline: number,
): { rank: number; uncertain: boolean; complete: boolean; freedom?: Float64Array } {
  const basis: Float64Array[] = [];
  let uncertain = false;
  for (let ri = 0; ri < rows.length; ri++) {
    if (ri % 8 === 0 && performance.now() > deadline)
      return { rank: basis.length, uncertain: true, complete: false };
    const r = rows[ri];
    if (!r.indices.length) continue;
    const v = new Float64Array(n);
    r.indices.forEach((i, k) => {
      v[i] = r.values[k];
    });
    const norm = Math.hypot(...v);
    if (norm < 1e-15) continue;
    for (let i = 0; i < n; i++) v[i] /= norm;
    // Two-pass modified Gram-Schmidt limits loss of orthogonality in redundant systems.
    for (let pass = 0; pass < 2; pass++)
      for (const q of basis) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += v[i] * q[i];
        if (Math.abs(dot) > 1e-16) for (let i = 0; i < n; i++) v[i] -= dot * q[i];
      }
    const rest = Math.hypot(...v);
    if (rest > 1e-10 && rest < 1e-6) uncertain = true;
    if (rest > 1e-8) {
      for (let i = 0; i < n; i++) v[i] /= rest;
      basis.push(v);
    }
    if (basis.length === n) break;
  }
  const freedom = new Float64Array(n).fill(1);
  for (const q of basis) for (let i = 0; i < n; i++) freedom[i] -= q[i] * q[i];
  return { rank: basis.length, uncertain, complete: true, freedom };
}

function provenConflict(d: Document): { message: string; ids: string[] } | null {
  const parent = new Map<string, string>();
  const root = (s: string): string => {
    let p = s;
    while (parent.has(p)) p = parent.get(p)!;
    return p;
  };
  const join = (a: string, b: string) => {
    const x = root(a),
      y = root(b);
    if (x !== y) parent.set(x, y);
  };
  const joins: string[] = [];
  for (const c of d.constraints)
    if (c.type === 'coincident' || (c.type === 'distance' && c.value === 0)) {
      join(keyOf(c.a), keyOf(c.b));
      joins.push(c.id);
    }
  const fixed = new Map<string, { x: number; y: number; id: string }>();
  const dimensions = new Map<string, { value: number; id: string }>();
  for (const c of d.constraints) {
    if (c.type === 'fixed') {
      const key = root(keyOf(c.target)),
        old = fixed.get(key);
      if (old && Math.hypot(old.x - c.x, old.y - c.y) > 1e-7)
        return {
          message:
            'Coincident fixed points have incompatible stored coordinates. Remove a fixed or coincidence constraint.',
          ids: [old.id, c.id, ...joins],
        };
      fixed.set(key, c);
    }
    if (c.type === 'distance' || c.type === 'radius') {
      const key =
        c.type === 'radius'
          ? `radius:${c.circle}`
          : `distance:${[root(keyOf(c.a)), root(keyOf(c.b))].sort().join('|')}`;
      const old = dimensions.get(key);
      if (old && Math.abs(old.value - c.value) > 1e-7)
        return {
          message: `Conflicting dimensions: ${old.value} mm and ${c.value} mm drive the same geometry. Edit the existing dimension or remove it first.`,
          ids: [old.id, c.id, ...joins],
        };
      dimensions.set(key, c);
      if (c.type === 'distance' && root(keyOf(c.a)) === root(keyOf(c.b)) && c.value > 1e-7)
        return {
          message: 'A positive distance cannot separate points that are constrained coincident.',
          ids: [c.id, ...joins],
        };
    }
  }
  for (const c of d.constraints) {
    if (c.type === 'distance') {
      const a = fixed.get(root(keyOf(c.a))),
        b = fixed.get(root(keyOf(c.b)));
      if (a && b && Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - c.value) > 1e-7)
        return {
          message: `Distance ${c.value} mm disagrees with two fixed points. Unfix a point or edit the distance.`,
          ids: [a.id, b.id, c.id, ...joins],
        };
    }
    if (c.type === 'horizontal' || c.type === 'vertical') {
      const a = fixed.get(root(`${c.line}/a`)),
        b = fixed.get(root(`${c.line}/b`));
      if (a && b && Math.abs(c.type === 'horizontal' ? a.y - b.y : a.x - b.x) > 1e-7)
        return {
          message: `The fixed endpoints cannot satisfy ${c.type}. Unfix a point first.`,
          ids: [a.id, b.id, c.id, ...joins],
        };
    }
    if (c.type === 'parallel' || c.type === 'perpendicular') {
      const opposite = d.constraints.find(
        (o) =>
          (o.type === 'parallel' || o.type === 'perpendicular') &&
          o.type !== c.type &&
          [o.a, o.b].sort().join('|') === [c.a, c.b].sort().join('|'),
      );
      if (opposite)
        return {
          message: 'Two nonzero lines cannot be both parallel and perpendicular.',
          ids: [c.id, opposite.id],
        };
    }
  }
  return null;
}

export function measureResiduals(d: Document) {
  const l = layout(d, false);
  return residual(equations(d, l, l.x));
}

export function solve(
  input: Document,
  options: { drag?: DragTarget[]; maxIterations?: number; timeBudgetMs?: number } = {},
): SolveResult {
  const start = performance.now(),
    budget = Math.max(1, Math.min(options.timeBudgetMs ?? 180, 1500)),
    deadline = start + budget;
  const result: SolveResult = {
    ok: false,
    document: input,
    status: 'nonconvergent',
    dof: null,
    rank: null,
    redundant: 0,
    residual: 0,
    angularResidual: 0,
    iterations: 0,
    elapsedMs: 0,
    message: '',
    conflicts: [],
    immovableTargets: [],
  };
  const finish = () => {
    result.elapsedMs = performance.now() - start;
    return result;
  };
  let d: Document;
  try {
    d = validateDocument(input);
  } catch (e) {
    result.message = (e as Error).message;
    return finish();
  }
  const conflict = provenConflict(d);
  if (conflict) {
    result.status = 'conflicting';
    result.message = conflict.message;
    result.conflicts = conflict.ids;
    return finish();
  }
  const l = layout(d),
    n = l.x.length;
  let x = l.x.slice(),
    rows = equations(d, l, x);
  const drags: { i: number; value: number }[] = [];
  try {
    for (const p of options.drag ?? []) {
      targetPosition(d, p.target);
      if (![p.x, p.y].every((v) => Number.isFinite(v) && Math.abs(v) <= LIMITS.coordinate))
        throw new Error('Drag coordinates must be finite and within the supported range.');
      const i = l.points.get(keyOf(p.target))!;
      drags.push({ i, value: p.x }, { i: i + 1, value: p.y });
    }
  } catch (e) {
    result.message = (e as Error).message;
    return finish();
  }
  const maxIterations = Math.max(0, Math.min(options.maxIterations ?? 70, 160));
  let lambda = 1e-7;
  // First optimize cursor preferences with a small penalty. A separate exact projection
  // follows; temporary preferences never become document constraints.
  const phases = drags.length ? [true, false] : [false];
  for (const dragging of phases) {
    // Reserve most of the budget for exact projection and rank. Cursor optimization
    // may be approximate; permanent geometric constraints may not be.
    const phaseDeadline = dragging ? start + budget * 0.4 : deadline;
    const objective = (xx: Float64Array, base: Row[]) => {
      if (!dragging) return base;
      return [
        ...base,
        ...drags.map((p) => ({
          id: 'temporary',
          indices: [p.i],
          values: [0.1],
          f: (xx[p.i] - p.value) * 0.1,
          angular: false,
        })),
        ...Array.from(xx, (v, i) => ({
          id: 'continuity',
          indices: [i],
          values: [0.00001],
          f: (v - l.x[i]) * 0.00001,
          angular: false,
        })),
      ];
    };
    for (let it = 0; it < (dragging ? Math.min(4, maxIterations) : maxIterations); it++) {
      if (performance.now() > phaseDeadline) break;
      if (!dragging && valid(rows)) break;
      const all = objective(x, rows),
        before = energy(all),
        delta = step(all, n, lambda, phaseDeadline, dragging);
      result.iterations++;
      if (Math.hypot(...delta) < 1e-11) break;
      let accepted = false;
      for (let ls = 0; ls < 12; ls++) {
        const scale = 2 ** -ls,
          trial = x.map((v, i) => v + scale * delta[i]);
        if (!finite(trial, l)) continue;
        const next = equations(d, l, trial),
          after = energy(objective(trial, next));
        if (after < before) {
          x = trial;
          rows = next;
          accepted = true;
          lambda = Math.max(1e-13, lambda * 0.2);
          break;
        }
      }
      if (!accepted) {
        lambda *= 100;
        if (lambda > 1e6) break;
      }
    }
    lambda = 1e-10;
  }
  const r = residual(rows);
  result.residual = r.position;
  result.angularResidual = r.angular;
  if (!valid(rows) || !finite(x, l)) {
    result.message = `No valid solution found within ${result.iterations} iterations / ${budget} ms. This is not proof of a conflict. Try a smaller move, a different initial shape, or remove one of the listed constraints. The previous document is unchanged.`;
    result.conflicts = [
      ...new Set(rows.filter((r) => Math.abs(r.f) > (r.angular ? ANGLE_TOL : POSITION_TOL)).map((r) => r.id)),
    ];
    return finish();
  }
  const solved = unpack(d, l, x);
  try {
    validateDocument(solved);
  } catch (e) {
    result.message = (e as Error).message;
    return finish();
  }
  result.ok = true;
  result.document = solved;
  const local = rank(rows, n, deadline);
  let singular = local.uncertain;
  if (
    local.complete &&
    local.rank < n &&
    local.rank + l.eliminated < rows.length &&
    performance.now() < deadline
  ) {
    const perturbed = x.map((v, i) => v + 1e-4 * Math.sin(i * 2.399 + 0.8));
    const generic = rank(equations(d, l, perturbed), n, deadline);
    singular ||= !generic.complete || generic.rank > local.rank;
  }
  if (!local.complete || singular) {
    result.status = 'singular';
    result.message =
      'Constraints satisfied. Local rank is singular, ill-conditioned, or its time budget was reached; reliable degrees of freedom are unavailable.';
  } else {
    result.rank = local.rank + l.eliminated;
    result.dof = n - local.rank;
    result.redundant = rows.length - result.rank;
    result.immovableTargets = [...l.points]
      .filter(([, i]) => Math.abs(local.freedom![i]) + Math.abs(local.freedom![i + 1]) < 1e-8)
      .map(([key]) => key);
    result.status =
      result.redundant > 0 ? 'redundant' : result.dof === 0 ? 'fully-constrained' : 'underconstrained';
    result.message = `${result.dof} local degree${result.dof === 1 ? '' : 's'} of freedom${result.redundant ? `; ${result.redundant} redundant scalar equation${result.redundant === 1 ? '' : 's'}, consistent` : ''}. All constraints satisfied.`;
  }
  return finish();
}
