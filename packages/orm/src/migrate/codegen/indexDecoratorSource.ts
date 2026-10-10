import type { IndexNode } from '../../schema/types.js';
import { type IndexColumnSchema, isVectorIndexType } from '../../type/index.js';
import { fulltextConfig } from '../../util/dialect.util.js';
import { memberSource, quoted, sqlTag } from './sourceLiteral.js';

/** What building an index's decorator source needs besides the index itself. */
interface IndexSourceContext {
  /** The callback's parameter name, such as `user` in `@Index((user) => [...])`. */
  readonly param: string;
  /** The property a column maps to. */
  readonly propertyName: (column: string) => string;
}

type EntrySource = (entry: IndexColumnSchema) => readonly string[];

/**
 * The options each field of an index entry writes into `@Index`, in emit order; `satisfies` forces every new
 * field to be listed. Defaults are skipped: Postgres reports each entry in full (`order: 'asc', nulls: 'last'`
 * on a plain column), and writing that out would bake its defaults into every entity.
 */
const ENTRY_MODIFIER_SOURCE = {
  order: (entry) => (entry.order === 'desc' ? [`order: 'desc'`] : []),
  opsClass: (entry) => (entry.opsClass ? [`opsClass: ${quoted(entry.opsClass)}`] : []),
  length: (entry) => (entry.length === undefined ? [] : [`length: ${entry.length}`]),
  weight: (entry) => ((entry.weight ?? 1) === 1 ? [] : [`weight: ${entry.weight}`]),
  // Never written: only Postgres reports it, and on every entry.
  nulls: null,
  // Written by `indexEntrySource` as the entry itself, ahead of its modifiers.
  column: null,
  expression: null,
  // Never written: introspection reads a JSON entry back as the expression the engine prints for it.
  jsonPath: null,
  jsonArray: null,
} as const satisfies Record<keyof IndexColumnSchema, EntrySource | null>;

type IndexOptionSource = (index: IndexNode, context: IndexSourceContext) => readonly string[];

/** Each {@link IndexNode} field's `@Index` options, in emit order; `satisfies` forces a new field to be listed. */
const INDEX_OPTION_SOURCE = {
  name: (index) => (index.name ? [`name: ${quoted(index.name)}`] : []),
  unique: (index) => (index.unique ? ['unique: true'] : []),
  type: (index) => (writesType(index) ? [`type: '${index.type}'`] : []),
  distance: (index) => (isVectorIndexType(index.type) && index.distance ? [`distance: '${index.distance}'`] : []),
  m: (index) => (index.m === undefined ? [] : [`m: ${index.m}`]),
  efConstruction: (index) => (index.efConstruction === undefined ? [] : [`efConstruction: ${index.efConstruction}`]),
  lists: (index) => (index.lists === undefined ? [] : [`lists: ${index.lists}`]),
  // The default config is skipped: an index without one is built with the default anyway.
  config: (index) => {
    const config = fulltextConfig(index);
    return index.type === 'fulltext' && config !== fulltextConfig({}) ? [`config: ${quoted(config)}`] : [];
  },
  where: (index) => (index.where ? [`where: ${sqlTag(index.where)}`] : []),
  include: (index, { param, propertyName }) => {
    const included = index.include?.map((column) => memberSource(param, propertyName(column))) ?? [];
    return included.length ? [`include: (${param}) => [${included.join(', ')}]`] : [];
  },
  // Written as the decorator's first argument, not as an option.
  entries: null,
  // Taken from the indexed field, never declared on the index.
  vectorType: null,
  dimensions: null,
  // A link back to the table node in the schema graph, not an option.
  table: null,
} as const satisfies Record<keyof IndexNode, IndexOptionSource | null>;

/**
 * Whether to write the index's type. `btree` is skipped: it is every engine's default and reported on every
 * index. So is a vector type whose distance introspection could not recover, since `@Index` requires a
 * `distance` beside a vector type and would not compile without one.
 */
function writesType(index: IndexNode): boolean {
  return (
    index.type !== undefined &&
    index.type !== 'btree' &&
    (!isVectorIndexType(index.type) || index.distance !== undefined)
  );
}

function entryModifiers(entry: IndexColumnSchema): string[] {
  return Object.values(ENTRY_MODIFIER_SOURCE).flatMap((source) => source?.(entry) ?? []);
}

/**
 * Whether `@Field({ index })` can carry the whole index. It says only "this column is indexed under
 * this name", and `unique` beside it that the index is unique, so anything else the index declares - an
 * expression, a predicate, an access method, stored columns, a stored order - has to be written out as
 * an `@Index` instead.
 */
export function isPlainFieldIndex(index: IndexNode): boolean {
  const entries = index.entries;
  const [entry] = entries;
  return (
    entries.length === 1 &&
    entry !== undefined &&
    !entry.expression &&
    index.where === undefined &&
    // Postgres names an access method on every index, so the default one still counts as plain.
    (index.type === undefined || index.type === 'btree') &&
    !index.include?.length &&
    entryModifiers(entry).length === 0
  );
}

/**
 * One `@Index((user) => [...])` as source, for an index no `@Field` can express, its columns read off the
 * refs `param` names. Emits `sql` for an expression entry, so callers import `sql` when
 * {@link indexNeedsRaw} holds.
 */
export function buildIndexDecoratorSource(
  index: IndexNode,
  propertyName: (column: string) => string,
  param: string,
): string {
  const context = { param, propertyName };
  const entries = index.entries.map((entry) => indexEntrySource(entry, context)).join(', ');
  const options = Object.values(INDEX_OPTION_SOURCE).flatMap((source) => source?.(index, context) ?? []);
  return `@Index((${param}) => [${entries}]${options.length > 0 ? `, { ${options.join(', ')} }` : ''})`;
}

/** Whether emitting this index needs `sql` imported alongside `Index`. */
export function indexNeedsRaw(index: IndexNode): boolean {
  return Boolean(index.where) || index.entries.some((entry) => entry.expression);
}

function indexEntrySource(entry: IndexColumnSchema, { param, propertyName }: IndexSourceContext): string {
  const column = entry.expression ? sqlTag(entry.column) : memberSource(param, propertyName(entry.column));
  const modifiers = entryModifiers(entry);
  return modifiers.length === 0 ? column : `{ column: ${column}, ${modifiers.join(', ')} }`;
}
