import type { IndexNode } from '../../schema/types.js';
import type { IndexColumnSchema, VectorDistance } from '../../type/index.js';
import { rawTag } from './sourceLiteral.js';

/**
 * A vector index carries its metric in the operator class pgvector names after it
 * (`vector_cosine_ops`), which is the only place introspection can recover it from. `@Index` requires
 * a `distance` beside a vector `type`, so emitting the type without one would not compile.
 */
const DISTANCE_BY_OPS_SUFFIX = new Map<string, VectorDistance>([
  ['cosine', 'cosine'],
  ['l2', 'l2'],
  ['ip', 'inner'],
  ['l1', 'l1'],
]);

function vectorDistance(index: IndexNode): VectorDistance | undefined {
  if (index.distance) {
    return index.distance;
  }
  const opsClass = index.entries.map((entry) => entry.opsClass).find(Boolean);
  const suffix = opsClass?.match(/_(\w+)_ops$/)?.[1];
  return suffix === undefined ? undefined : DISTANCE_BY_OPS_SUFFIX.get(suffix);
}

/**
 * The per-entry modifiers worth writing into an entity, which is not everything introspection reports.
 * Postgres states an entry in full - a plain column comes back `order: 'asc', nulls: 'last'` - and
 * emitting that would bake one engine's defaults into source that is meant to run on any of them.
 * `nulls` never survives for the same reason: it is Postgres-only and always reported.
 */
function significantModifiers(entry: IndexColumnSchema): string[] {
  const parts: string[] = [];
  if (entry.order === 'desc') parts.push(`order: 'desc'`);
  if (entry.opsClass) parts.push(`opsClass: '${entry.opsClass}'`);
  if (entry.length !== undefined) parts.push(`length: ${entry.length}`);
  return parts;
}

/**
 * Whether `@Field({ index })` can carry the whole index. It says only "this column is indexed under
 * this name", so anything else the index declares - an expression, a predicate, uniqueness, an access
 * method, stored columns, a stored order - has to be written out as an `@Index` instead.
 */
export function isPlainFieldIndex(index: IndexNode): boolean {
  const entries = index.entries;
  const [entry] = entries;
  return (
    entries.length === 1 &&
    entry !== undefined &&
    !entry.expression &&
    !index.unique &&
    index.where === undefined &&
    // Postgres names an access method on every index, so the default one still counts as plain.
    (index.type === undefined || index.type === 'btree') &&
    !index.include?.length &&
    significantModifiers(entry).length === 0
  );
}

/**
 * One `@Index((user) => [...])` as source, for an index no `@Field` can express, its columns read off the
 * key map `param` names. Emits `raw(...)` for an expression entry, so callers import `raw` when
 * {@link indexNeedsRaw} holds.
 */
export function buildIndexDecoratorSource(
  index: IndexNode,
  propertyName: (column: string) => string,
  param: string,
): string {
  const entries = index.entries.map((entry) => indexEntrySource(entry, propertyName, param)).join(', ');

  const isVector = index.type === 'hnsw' || index.type === 'ivfflat';
  const distance = isVector ? vectorDistance(index) : undefined;
  const options: string[] = [];
  if (index.name) options.push(`name: '${index.name}'`);
  if (index.unique) options.push('unique: true');
  // `btree` is every engine's default and is reported on every index, so writing it out would put it
  // in every generated entity. A vector type whose metric could not be recovered is left off too,
  // rather than written out in a form that does not compile.
  const writesType = index.type !== undefined && index.type !== 'btree' && (distance !== undefined || !isVector);
  if (writesType) {
    options.push(`type: '${index.type}'`);
  }
  if (distance) options.push(`distance: '${distance}'`);
  if (index.where) options.push(`where: ${rawTag(index.where)}`);
  if (index.include?.length) {
    const included = index.include.map((column) => memberSource(param, propertyName(column)));
    options.push(`include: (${param}) => [${included.join(', ')}]`);
  }

  return `@Index((${param}) => [${entries}]${options.length > 0 ? `, { ${options.join(', ')} }` : ''})`;
}

/** Whether emitting this index needs `raw` imported alongside `Index`. */
export function indexNeedsRaw(index: IndexNode): boolean {
  return Boolean(index.where) || index.entries.some((entry) => entry.expression);
}

function indexEntrySource(entry: IndexColumnSchema, propertyName: (column: string) => string, param: string): string {
  if (entry.expression) {
    return rawTag(entry.column);
  }
  const column = memberSource(param, propertyName(entry.column));
  const modifiers = significantModifiers(entry);
  return modifiers.length === 0 ? column : `{ column: ${column}, ${modifiers.join(', ')} }`;
}

/** `user.email`, or `user['first-name']` for a property name that is no identifier. */
function memberSource(param: string, property: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(property) ? `${param}.${property}` : `${param}['${property}']`;
}
