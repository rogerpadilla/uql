import {
  ColumnRef,
  type EntityIndexColumnInput,
  type FieldType,
  type IndexColumnInput,
  type IndexEntry,
  type IndexEntryModifiers,
  type IndexValueType,
  JSON_PATH,
  JsonPathRef,
  QuerySql,
  REF_KEY,
} from '../type/index.js';
import { jsonPathKeys } from './field.util.js';
import { UqlUsageError } from './uqlError.js';

/**
 * Every key an index entry takes. Checked at run time because TypeScript never checks a callback's returned
 * literal for excess properties, so a misspelt option would otherwise build an index without it.
 */
const INDEX_ENTRY_KEYS = {
  column: true,
  json: true,
  path: true,
  type: true,
  expression: true,
  prefixLength: true,
  charLength: true,
  order: true,
  nulls: true,
  opsClass: true,
  weight: true,
} as const satisfies Record<keyof IndexEntry, true>;

/**
 * Reduces an index entry, authored or the migration builder's, to the one form metadata keeps: a column read
 * off the refs as its key, a JSON path as its column and dotted path, any other `sql` as its expression.
 */
export function normalizeIndexColumn(entry: IndexColumnInput | EntityIndexColumnInput): IndexEntry {
  if (typeof entry === 'string' || entry instanceof QuerySql || entry instanceof JsonPathRef) {
    return entryTarget(entry);
  }
  const unknown = Object.keys(entry).find((key) => !Object.hasOwn(INDEX_ENTRY_KEYS, key));
  if (unknown) {
    throw new UqlUsageError(`an index entry has no option '${unknown}'`);
  }
  if (entry.column === undefined && entry.json === undefined && entry.expression === undefined) {
    throw new UqlUsageError('an index entry names no column or expression');
  }
  if (entry.column === undefined) {
    return entry;
  }
  if (typeof entry.column === 'string') {
    refuseLength('charLength', entry.charLength, 'a stored column');
    return entry;
  }
  const { column, type, prefixLength, charLength, ...modifiers } = entry;
  const target = entryTarget(column);
  if (target.column !== undefined && type === undefined) {
    refuseLength('charLength', charLength, 'a stored column');
    return { ...modifiers, column: target.column, ...(prefixLength !== undefined && { prefixLength }) };
  }
  if (target.expression !== undefined) {
    refuseLength('prefixLength', prefixLength, 'an expression');
    refuseLength('charLength', charLength, 'an expression');
    return { ...modifiers, expression: target.expression };
  }
  refuseLength('prefixLength', prefixLength, 'a JSON path');
  return {
    ...modifiers,
    json: target.json ?? target.column,
    ...(target.path !== undefined && { path: target.path }),
    ...(type !== undefined && { type }),
    ...(charLength !== undefined && { charLength }),
  };
}

function entryTarget(target: string | QuerySql | JsonPathRef): IndexEntry {
  if (typeof target === 'string') {
    return { column: target };
  }
  if (target instanceof JsonPathRef) {
    return { json: target[REF_KEY], path: target[JSON_PATH] };
  }
  return target instanceof ColumnRef ? { column: target[REF_KEY] } : { expression: target };
}

/** Refuses a length an entry's target does not take, which only a column's ref and other `sql` leave to run time. */
function refuseLength(option: 'prefixLength' | 'charLength', length: number | undefined, target: string): void {
  if (length !== undefined) {
    throw new UqlUsageError(`an index entry over ${target} takes no ${option}`);
  }
}

/** An index entry as the schema holds it, its expression rendered to text by `render`. */
export function renderIndexColumn(entry: IndexEntry, render: (statement: QuerySql) => string): IndexEntry<string> {
  return entry.expression === undefined ? entry : { ...entry, expression: render(entry.expression) };
}

/** An entry over a column as stored. */
export type StoredEntry<Sql> = IndexEntry<Sql> & { readonly column: string };

/** Whether every entry is a column as stored. */
export function isStored<Sql>(entries: readonly IndexEntry<Sql>[]): entries is readonly StoredEntry<Sql>[] {
  return entries.every((entry) => entry.column !== undefined);
}

/** Each entry's column as stored, or `undefined` where any entry is not one. */
export function storedColumns(entries: readonly IndexEntry<unknown>[]): string[] | undefined {
  return isStored(entries) ? entries.map((entry) => entry.column) : undefined;
}

/** The column an entry keys whole, with no prefix; a JSON path or an expression keys none. */
export function wholeColumn(entry: IndexEntry<unknown>): string | undefined {
  return entry.prefixLength === undefined ? entry.column : undefined;
}

/** The column an entry reads, as stored or as the document a JSON path reads into; an expression reads none. */
export function entryColumn(entry: IndexEntry<unknown>): string | undefined {
  return entry.column ?? entry.json;
}

/** The columns `entries` read, a JSON path's included. */
export function entryColumns(entries: readonly IndexEntry<unknown>[]): string[] {
  return entries.flatMap((entry) => entryColumn(entry) ?? []);
}

/** What an entry keys: its column, then the keys of a JSON path inside it, if any; an expression keys none. */
export function entryKeys(entry: IndexEntry<unknown>): string[] | undefined {
  const column = entryColumn(entry);
  return column === undefined ? undefined : [column, ...(entry.path ? jsonPathKeys(entry.path) : [])];
}

/**
 * What an entry adds to a derived index name: its column and its path's keys (`kind_theme`), or `expr<at>` for
 * an expression, which has none. The one rule both naming an index and recognising a name read.
 */
export function indexEntryNamePart(entry: IndexEntry<unknown>, at: number): string {
  return entryKeys(entry)?.join('_') ?? `expr${at}`;
}

/** How an entry keys, without what it keys: its order, nulls, operator class and weight. */
export function entryModifiers<Sql>(entry: IndexEntry<Sql>): IndexEntryModifiers {
  const {
    column: _column,
    json: _json,
    path: _path,
    type: _type,
    expression: _expression,
    prefixLength: _prefixLength,
    charLength: _charLength,
    ...modifiers
  } = entry;
  return modifiers;
}

/** `entry` with the column it reads, as stored or as the document a JSON path reads into, renamed by `rename`. */
export function renamedEntry<Sql>(entry: IndexEntry<Sql>, rename: (column: string) => string): IndexEntry<Sql> {
  if (entry.column !== undefined) {
    return { ...entry, column: rename(entry.column) };
  }
  return entry.json === undefined ? entry : { ...entry, json: rename(entry.json) };
}

/** How an index reads a JSON column: the value at `path` as `type`, or with `elements`, each element of the array there. */
export type JsonIndexRead = {
  readonly column: string;
  readonly path: string;
  readonly type: FieldType;
  readonly elements: boolean;
  readonly charLength?: number;
};

/** The JSON read an entry indexes, `undefined` for a column or an expression; a path says nothing to be read as text. */
export function jsonIndexRead(entry: IndexEntry<unknown>): JsonIndexRead | undefined {
  if (entry.json === undefined) {
    return undefined;
  }
  const { json: column, path = '', type = String, charLength } = entry;
  const elements = isElementsType(type);
  return { column, path, type: elements ? type[0] : type, elements, charLength };
}

/** Whether an index reads each element of an array, `[type]`, rather than one value. */
export function isElementsType(type: IndexValueType | undefined): type is readonly [FieldType] {
  return Array.isArray(type);
}
