export type Vec = { x: number; y: number };
export type Entity =
  | ({ id: string; type: 'point'; construction: boolean } & Vec)
  | { id: string; type: 'line'; a: Vec; b: Vec; construction: boolean }
  | { id: string; type: 'circle'; center: Vec; radius: number; construction: boolean };
export type Target = { entity: string; point: 'point' | 'a' | 'b' | 'center' };
export type Constraint = { id: string } & (
  | { type: 'coincident'; a: Target; b: Target }
  | { type: 'horizontal' | 'vertical'; line: string }
  | { type: 'parallel' | 'perpendicular'; a: string; b: string }
  | { type: 'distance'; a: Target; b: Target; value: number }
  | { type: 'radius'; circle: string; value: number }
  | { type: 'fixed'; target: Target; x: number; y: number }
);
export type Document = { version: 1; units: 'mm'; entities: Entity[]; constraints: Constraint[] };
export const LIMITS = { entities: 250, constraints: 500, coordinate: 1e6, minDirection: 1e-10 };
export const emptyDocument = (): Document => ({ version: 1, units: 'mm', entities: [], constraints: [] });
export const uid = (prefix = 'e') => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
export const keyOf = (t: Target) => `${t.entity}/${t.point}`;
export const clone = <T>(v: T): T => structuredClone(v);
export function targets(e: Entity): Target[] {
  return (e.type === 'line' ? ['a', 'b'] : e.type === 'circle' ? ['center'] : ['point']).map((point) => ({
    entity: e.id,
    point: point as Target['point'],
  }));
}
export function targetPosition(doc: Document, t: Target): Vec {
  const e = doc.entities.find((e) => e.id === t.entity);
  if (!e) throw new Error(`Missing entity ${t.entity}.`);
  if (e.type === 'point' && t.point === 'point') return e;
  if (e.type === 'line' && (t.point === 'a' || t.point === 'b')) return e[t.point];
  if (e.type === 'circle' && t.point === 'center') return e.center;
  throw new Error(`Invalid target ${keyOf(t)} for ${e.type}.`);
}
export function references(c: Constraint): string[] {
  switch (c.type) {
    case 'coincident':
    case 'distance':
      return [c.a.entity, c.b.entity];
    case 'parallel':
    case 'perpendicular':
      return [c.a, c.b];
    case 'horizontal':
    case 'vertical':
      return [c.line];
    case 'radius':
      return [c.circle];
    case 'fixed':
      return [c.target.entity];
  }
}
export const relatedConstraintIds = (doc: Document, id: string) =>
  doc.constraints.filter((c) => references(c).includes(id)).map((c) => c.id);
export function removeEntities(doc: Document, ids: string[]): Document {
  return {
    ...doc,
    entities: doc.entities.filter((e) => !ids.includes(e.id)),
    constraints: doc.constraints.filter((c) => !references(c).some((id) => ids.includes(id))),
  };
}

export function validateDocument(input: unknown): Document {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (!input || typeof input !== 'object') fail('Expected a JSON sketch object.');
  const d = input as Document;
  if (d.version !== 1) fail(`Unsupported document version ${String(d.version)}. Expected version 1.`);
  if (d.units !== 'mm') fail('Only millimeter (mm) documents are supported.');
  if (!Array.isArray(d.entities) || !Array.isArray(d.constraints))
    fail('Document must contain entities and constraints arrays.');
  if (d.entities.length > LIMITS.entities || d.constraints.length > LIMITS.constraints)
    fail(
      `Sketch limit: ${LIMITS.entities} entities and ${LIMITS.constraints} constraints. Split this sketch into smaller documents.`,
    );
  const ids = new Set<string>();
  const id = (v: unknown) => {
    if (typeof v !== 'string' || !v.length || v.length > 100 || ids.has(v))
      fail('Every entity and constraint needs a unique, nonempty ID (at most 100 characters).');
    ids.add(v as string);
  };
  const number = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > LIMITS.coordinate)
      fail(`${name} must be finite and within +/-1,000,000 mm.`);
  };
  const vec = (v: Vec, name: string) => {
    if (!v || typeof v !== 'object') fail(`${name} needs x and y coordinates.`);
    number(v.x, `${name}.x`);
    number(v.y, `${name}.y`);
  };
  for (const e of d.entities) {
    if (!e || typeof e !== 'object') fail('Invalid entity object.');
    id(e.id);
    if (typeof e.construction !== 'boolean') fail(`Entity ${e.id} needs a construction flag.`);
    switch (e.type) {
      case 'point':
        vec(e, e.id);
        break;
      case 'line':
        vec(e.a, `${e.id}.a`);
        vec(e.b, `${e.id}.b`);
        break;
      case 'circle':
        vec(e.center, `${e.id}.center`);
        number(e.radius, 'Radius');
        if (e.radius <= 0) fail('Circle radius must be strictly positive.');
        break;
      default:
        fail('Unknown entity type. Use point, line, or circle.');
    }
  }
  const entity = (v: string, type: Entity['type']) => {
    const e = d.entities.find((e) => e.id === v);
    if (!e || e.type !== type) fail(`Constraint reference ${v} must identify a ${type}.`);
    return e!;
  };
  const target = (t: Target) => {
    if (!t || typeof t !== 'object') fail('Constraint is missing a point target.');
    targetPosition(d, t);
  };
  for (const c of d.constraints) {
    if (!c || typeof c !== 'object') fail('Invalid constraint object.');
    id(c.id);
    switch (c.type) {
      case 'coincident':
        target(c.a);
        target(c.b);
        break;
      case 'distance':
        target(c.a);
        target(c.b);
        number(c.value, 'Distance');
        if (c.value < 0) fail('Distance must be nonnegative. Zero is valid and means coincidence.');
        break;
      case 'horizontal':
      case 'vertical':
        entity(c.line, 'line');
        break;
      case 'parallel':
      case 'perpendicular':
        for (const ref of [c.a, c.b]) {
          const e = entity(ref, 'line') as Extract<Entity, { type: 'line' }>;
          if (Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) <= LIMITS.minDirection)
            fail(
              `Cannot add ${c.type}: line ${ref} has zero length. Move its endpoints apart or add a positive distance first.`,
            );
        }
        break;
      case 'radius':
        entity(c.circle, 'circle');
        number(c.value, 'Radius');
        if (c.value <= 0) fail('Driving radius must be strictly positive.');
        break;
      case 'fixed':
        target(c.target);
        number(c.x, 'Fixed x');
        number(c.y, 'Fixed y');
        break;
      default:
        fail('Unknown constraint type.');
    }
  }
  return clone(d);
}
