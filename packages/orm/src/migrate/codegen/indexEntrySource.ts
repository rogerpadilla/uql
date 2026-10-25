import type { IndexNode } from '../../schema/types.js';
import { type IndexEntry, type IndexValueType, isVectorIndexType } from '../../type/index.js';
import { fulltextConfig } from '../../util/dialect.util.js';
import { jsonPathKeys } from '../../util/field.util.js';
import { isElementsType } from '../../util/indexEntry.util.js';
import { memberSource, quoted, sqlTag } from './sourceLiteral.js';

/** What building an `indexes` entry's source needs besides the index itself. */
interface IndexSourceContext {
  /** The callback's parameter name, such as `user` in `columns: (user) => [...]`. */
  readonly param: string;
  /** The property a column maps to. */
  readonly propertyName: (column: string) => string;
}

type EntrySource = (entry: IndexEntry<string>) => readonly string[];

/**
 * The options each field of an index entry writes, in emit order; `satisfies` forces every new
 * field to be listed. Defaults are skipped: Postgres reports each entry in full (`order: 'asc', nulls: 'last'`
 * on a plain column), and writing that out would bake its defaults into every entity.
 */
const ENTRY_MODIFIER_SOURCE = {
  type: (entry) => (entry.type === undefined ? [] : [`type: ${valueTypeSource(entry.type)}`]),
  order: (entry) => (entry.order === 'desc' ? [`order: 'desc'`] : []),
  opsClass: (entry) => (entry.opsClass ? [`opsClass: ${quoted(entry.opsClass)}`] : []),
  prefixLength: (entry) => (entry.prefixLength === undefined ? [] : [`prefixLength: ${entry.prefixLength}`]),
  charLength: (entry) => (entry.charLength === undefined ? [] : [`charLength: ${entry.charLength}`]),
  weight: (entry) => ((entry.weight ?? 1) === 1 ? [] : [`weight: ${entry.weight}`]),
  // Never written: only Postgres reports it, and on every entry.
  nulls: null,
  // Written by `entryTargetSource` as the entry itself, ahead of its modifiers.
  column: null,
  json: null,
  path: null,
  expression: null,
} as const satisfies Record<keyof IndexEntry<string>, EntrySource | null>;

/** A JSON path's value type as source: `Number`, `'decimal'`, or `[String]` for each element. */
function valueTypeSource(type: IndexValueType): string {
  if (isElementsType(type)) {
    return `[${valueTypeSource(type[0])}]`;
  }
  return typeof type === 'string' ? quoted(type) : type.name;
}

type IndexOptionSource = (index: IndexNode, context: IndexSourceContext) => readonly string[];

/** Each {@link IndexNode} field's index options, in emit order; `satisfies` forces a new field to be listed. */
const INDEX_OPTION_SOURCE = {
  // Written by `buildIndexEntrySource` ahead of the rest, as the bare string when it is alone.
  name: null,
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
    return included.length ? [`include: [${included.join(', ')}]`] : [];
  },
  // Written as the entry's `columns`, not as an option.
  entries: null,
  // Taken from the indexed field, never declared on the index.
  vectorType: null,
  dimensions: null,
  // A link back to the table node in the schema graph, not an option.
  table: null,
} as const satisfies Record<keyof IndexNode, IndexOptionSource | null>;

/**
 * Whether to write the index's type. `btree` is skipped: it is every engine's default and reported on every
 * index. So is a vector type whose distance introspection could not recover, since an index entry requires a
 * `distance` beside a vector type and would not compile without one.
 */
function writesType(index: IndexNode): boolean {
  return (
    index.type !== undefined &&
    index.type !== 'btree' &&
    (!isVectorIndexType(index.type) || index.distance !== undefined)
  );
}

function entryModifierSources(entry: IndexEntry<string>): string[] {
  return Object.values(ENTRY_MODIFIER_SOURCE).flatMap((source) => source?.(entry) ?? []);
}

/**
 * Whether `.index()` can carry the whole index. It says only "this column is indexed under
 * this name", and `unique` beside it that the index is unique, so anything else the index declares - an
 * expression, a predicate, an access method, stored columns, a stored order - has to be written out as
 * an `indexes` entry instead.
 */
export function isPlainFieldIndex(index: IndexNode): boolean {
  const entries = index.entries;
  const [entry] = entries;
  return (
    entries.length === 1 &&
    entry !== undefined &&
    entry.column !== undefined &&
    index.where === undefined &&
    // Postgres names an access method on every index, so the default one still counts as plain.
    (index.type === undefined || index.type === 'btree') &&
    !index.include?.length &&
    entryModifierSources(entry).length === 0
  );
}

/**
 * One `@Entity` `indexes` entry as source, `index([user.email], { unique: true })`, for an index no column's
 * `index()` can express, its columns read off the refs `param` names and a lone name written as the bare string.
 * Emits `sql` for an expression entry, so callers import `sql` when {@link indexNeedsRaw} holds.
 */
export function buildIndexEntrySource(
  index: IndexNode,
  propertyName: (column: string) => string,
  param: string,
): string {
  const context = { param, propertyName };
  const entries = index.entries.map((entry) => indexEntrySource(entry, context)).join(', ');
  const options = Object.values(INDEX_OPTION_SOURCE).flatMap((source) => source?.(index, context) ?? []);
  const name = index.name ? quoted(index.name) : undefined;
  if (name !== undefined && options.length === 0) {
    return `index([${entries}], ${name})`;
  }
  const written = name === undefined ? options : [`name: ${name}`, ...options];
  return written.length ? `index([${entries}], { ${written.join(', ')} })` : `index([${entries}])`;
}

/** Whether emitting this index needs `sql` imported. */
export function indexNeedsRaw(index: IndexNode): boolean {
  return Boolean(index.where) || index.entries.some((entry) => entry.expression !== undefined);
}

function indexEntrySource(entry: IndexEntry<string>, context: IndexSourceContext): string {
  const target = entryTargetSource(entry, context);
  const modifiers = entryModifierSources(entry);
  return modifiers.length === 0 ? target : `{ column: ${target}, ${modifiers.join(', ')} }`;
}

/** What an entry indexes as source: a member, a JSON path read along one, or `sql`. */
function entryTargetSource(entry: IndexEntry<string>, { param, propertyName }: IndexSourceContext): string {
  if (entry.expression !== undefined) {
    return sqlTag(entry.expression);
  }
  if (entry.column !== undefined) {
    return memberSource(param, propertyName(entry.column));
  }
  const keys = entry.path ? jsonPathKeys(entry.path) : [];
  return keys.reduce((source, key) => memberSource(source, key), memberSource(param, propertyName(entry.json)));
}
