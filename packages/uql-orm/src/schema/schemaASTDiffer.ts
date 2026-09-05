/**
 * SchemaAST Differ
 *
 * Compares two SchemaAST instances and produces a detailed diff.
 * Used for:
 * - Migration generation (entity vs database)
 * - Drift detection (expected vs actual)
 * - Schema synchronization
 */

import { areTypesEqual, isBreakingTypeChange } from './canonicalType.js';
import { describeIndexDifferences, type IndexFacet, indexNameStem } from './indexDifferences.js';
import type { SchemaAST } from './schemaAST.js';
import type { CanonicalType } from './types.js';
import type {
  ColumnDiff,
  ColumnNode,
  IndexDiff,
  IndexNode,
  PrimaryKeyDiff,
  RelationshipDiff,
  RelationshipNode,
  SchemaDiffResult,
  TableDiff,
  TableNode,
} from './types.js';
import { DEFAULT_FOREIGN_KEY_ACTION } from './types.js';

/**
 * Options for schema diffing.
 */
export interface DiffOptions {
  /** Compare indexes */
  compareIndexes?: boolean;
  /** What the target side can report about an index, normally an introspector's `indexFacets`. Anything left out is not compared. */
  indexFacets?: ReadonlySet<IndexFacet>;
  /** Compare foreign keys/relationships */
  compareRelationships?: boolean;
  /** Ignore case differences in names */
  ignoreCase?: boolean;
  /** Tables to exclude from comparison */
  excludeTables?: string[];
  /**
   * A type as the engine would actually store it, for the caller that has a dialect.
   *
   * Several canonical types share one storage type per engine - a `boolean` is `TINYINT(1)` on MySQL
   * and `INTEGER` on SQLite - so comparing them canonically reports an alteration on every sync for
   * those columns. Passing both sides through the engine first is what settles that, and it is the
   * only thing here a dialect is needed for, so it arrives as a function rather than as a dependency.
   */
  normalizeType?: (type: CanonicalType) => CanonicalType;
  /**
   * Whether two defaults are the same value, for the caller that has a dialect.
   *
   * A database reprints a default from its parse tree, so `'active'` comes back as
   * `'active'::character varying` on Postgres and a symbolic `now()` matches no spelling of
   * `CURRENT_TIMESTAMP`. Undoing that needs the dialect that wrote it, so it arrives as a function.
   */
  defaultsEqual?: (expected: unknown, actual: unknown) => boolean;
}

/**
 * Default diff options.
 */
const DEFAULT_OPTIONS: Required<DiffOptions> = {
  compareIndexes: true,
  indexFacets: new Set(),
  compareRelationships: true,
  normalizeType: (type) => type,
  defaultsEqual: (expected, actual) => normalizeDefault(expected) === normalizeDefault(actual),
  ignoreCase: false,
  excludeTables: [],
};

function nameNormalizer(opts: Required<DiffOptions>): (name: string) => string {
  return opts.ignoreCase ? (name) => name.toLowerCase() : (name) => name;
}

/**
 * The only three ways two keyed collections can differ, which is the shape of every comparison here:
 * tables, columns, indexes and relationships all key by name and then split the same way.
 */
function matchByKey<T>(source: Iterable<T>, target: Iterable<T>, key: (item: T) => string) {
  const sourceByKey = new Map([...source].map((item) => [key(item), item] as const));
  const targetByKey = new Map([...target].map((item) => [key(item), item] as const));

  return {
    created: [...sourceByKey].filter(([at]) => !targetByKey.has(at)).map(([, item]) => item),
    dropped: [...targetByKey].filter(([at]) => !sourceByKey.has(at)).map(([, item]) => item),
    matched: [...sourceByKey].flatMap(([at, item]) => {
      const counterpart = targetByKey.get(at);
      return counterpart ? [[item, counterpart] as const] : [];
    }),
  };
}

/** How a relationship diff names the pair it is about, whichever way it differs. */
function relationEnds(relation: RelationshipNode) {
  return { name: relation.name, fromTable: relation.from.table.name, toTable: relation.to.table.name };
}

/**
 * Compare two schemas and return the differences.
 *
 * @param source - The "expected" or "desired" schema (e.g., from entities)
 * @param target - The "actual" or "current" schema (e.g., from database)
 * @param options - Diff options
 * @returns Detailed diff result
 */
export function diffSchemas(source: SchemaAST, target: SchemaAST, options: DiffOptions = {}): SchemaDiffResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const normalizeName = nameNormalizer(opts);

  const included = (tables: Iterable<TableNode>) =>
    [...tables].filter((table) => !opts.excludeTables.includes(table.name));
  const {
    created: tablesToCreate,
    dropped: tablesToDrop,
    matched,
  } = matchByKey(included(source.tables.values()), included(target.tables.values()), (table) =>
    normalizeName(table.name),
  );

  const tablesToAlter = matched
    .map(([sourceTable, targetTable]) => diffTable(sourceTable, targetTable, opts))
    .filter((tableDiff) => tableDiff !== undefined);
  const columnDiffs = tablesToAlter.flatMap((tableDiff) => tableDiff.columnDiffs ?? []);
  const indexDiffs = tablesToAlter.flatMap((tableDiff) => tableDiff.indexDiffs ?? []);
  const primaryKeyDiffs = tablesToAlter.flatMap((tableDiff) => tableDiff.primaryKeyDiff ?? []);
  // Relationships span tables, so they are compared over the whole schema rather than per table.
  const relationshipDiffs = opts.compareRelationships ? diffRelationships(source, target, opts) : [];

  const hasDifferences =
    tablesToCreate.length > 0 ||
    tablesToDrop.length > 0 ||
    tablesToAlter.length > 0 ||
    relationshipDiffs.length > 0 ||
    indexDiffs.length > 0 ||
    primaryKeyDiffs.length > 0;
  // Rewriting a key drops a constraint and rebuilds an index over the whole table, and fails outright
  // where its new columns are null on rows that already exist. Breaking by any measure.
  const hasBreakingChanges =
    tablesToDrop.length > 0 || primaryKeyDiffs.length > 0 || columnDiffs.some((d) => d.isBreaking);

  return {
    tablesToCreate,
    tablesToDrop,
    tablesToAlter,
    columnDiffs,
    indexDiffs,
    primaryKeyDiffs,
    relationshipDiffs,
    hasDifferences,
    hasBreakingChanges,
  };
}

/**
 * Compare two tables and return the differences.
 *
 * Exported because it is also how a migration is planned: the generator diffs one entity's table
 * against the one the database reported, then projects the result into a `SchemaDiff`. One
 * comparison serves both, so drift and migrations can no longer disagree about what has changed.
 */
export function diffTable(source: TableNode, target: TableNode, options: DiffOptions = {}): TableDiff | undefined {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const columnDiffs = diffTableColumns(source, target, opts);
  const indexDiffs = opts.compareIndexes ? diffTableIndexes(source, target, opts) : [];
  const primaryKeyDiff = diffPrimaryKey(source, target);

  if (columnDiffs.length === 0 && indexDiffs.length === 0 && !primaryKeyDiff) {
    return undefined;
  }

  return { name: source.name, type: 'alter', columnDiffs, indexDiffs, primaryKeyDiff };
}

/**
 * The two keys, where they hold different columns.
 *
 * Compared by columns and in order. Not by name: the engine named the constraint on every table that
 * already exists, so matching on one would report every table as drifted the moment the convention
 * that derives names changes.
 */
function diffPrimaryKey(source: TableNode, target: TableNode): PrimaryKeyDiff | undefined {
  const expected = source.primaryKey.map((column) => column.name);
  const actual = target.primaryKey.map((column) => column.name);
  if (expected.length === actual.length && expected.every((column, i) => column === actual[i])) {
    return undefined;
  }
  return { table: source.name, expected, actual, actualName: target.primaryKeyName };
}

/**
 * Compare columns between two tables.
 */
function diffTableColumns(source: TableNode, target: TableNode, opts: Required<DiffOptions>): ColumnDiff[] {
  const normalizeName = nameNormalizer(opts);
  const { created, dropped, matched } = matchByKey(source.columns.values(), target.columns.values(), (column) =>
    normalizeName(column.name),
  );

  return [
    ...created.map<ColumnDiff>((column) => ({
      table: source.name,
      column: column.name,
      type: 'add',
      expected: column,
      description: `Add column "${column.name}"`,
    })),
    ...dropped.map<ColumnDiff>((column) => ({
      table: target.name,
      column: column.name,
      type: 'drop',
      actual: column,
      isBreaking: true,
      description: `Drop column "${column.name}"`,
    })),
    ...matched
      .map(([sourceColumn, targetColumn]) => diffColumn(source.name, sourceColumn, targetColumn, opts))
      .filter((diff) => diff !== undefined),
  ];
}

/**
 * Compare indexes between two tables.
 */
function diffTableIndexes(source: TableNode, target: TableNode, opts: Required<DiffOptions>): IndexDiff[] {
  const normalizeName = nameNormalizer(opts);
  const { created, dropped, matched } = matchByKey(source.indexes, target.indexes, (index) =>
    normalizeName(indexNameStem(index.name)),
  );

  return [
    ...created.map<IndexDiff>((index) => ({ name: index.name, table: source.name, type: 'create', expected: index })),
    ...dropped.map<IndexDiff>((index) => ({ name: index.name, table: target.name, type: 'drop', actual: index })),
    ...matched
      .map(([sourceIndex, targetIndex]) => diffIndex(source.name, sourceIndex, targetIndex, opts.indexFacets))
      .filter((diff) => diff !== undefined),
  ];
}

/**
 * Compare two columns and return the difference.
 */
function diffColumn(
  tableName: string,
  source: ColumnNode,
  target: ColumnNode,
  opts: Required<DiffOptions>,
): ColumnDiff | undefined {
  const differences: string[] = [];

  // Two things a key column implies rather than states, and catalogues report inconsistently: its
  // type, which is the dialect's serial spelling rather than one the entity chose and does not round
  // trip (`BIGINT UNSIGNED AUTO_INCREMENT` reads back as `BIGINT(20) UNSIGNED`), and its nullability,
  // which is NOT NULL in every engine whatever is reported - SQLite's `PRAGMA table_info` says
  // `notnull: 0` for the `INTEGER PRIMARY KEY` that is the table's own rowid. Comparing either asked
  // to rewrite the column on every sync, and on SQLite, which cannot alter one at all, failed
  // outright. Everything else about a key column is still compared, which the blanket "never alter a
  // key column" rule these two replace used to hide.
  const generatedType = source.isAutoIncrement && target.isAutoIncrement;
  const impliedNotNull = source.isPrimaryKey && target.isPrimaryKey;

  if (!generatedType && !areTypesEqual(opts.normalizeType(source.type), opts.normalizeType(target.type))) {
    differences.push(`type: ${formatType(source.type)} → ${formatType(target.type)}`);
  }

  if (!impliedNotNull && source.nullable !== target.nullable) {
    differences.push(`nullable: ${target.nullable} → ${source.nullable}`);
  }

  // Compare unique constraint
  if (source.isUnique !== target.isUnique) {
    differences.push(`unique: ${target.isUnique} → ${source.isUnique}`);
  }

  // Auto-increment is deliberately not compared. No engine turns a column into an identity, or out of
  // one, without rewriting the table, and there is no DDL here that does it - so a difference could
  // only ever be reported, never settled, and the statements emitted for it (a bare `ALTER COLUMN
  // TYPE`) do not change it. The same rule `describeIndexDifferences` follows for what it cannot read.

  // Compare default values (if both defined)
  if (!opts.defaultsEqual(source.defaultValue, target.defaultValue)) {
    differences.push(`default: ${target.defaultValue ?? 'NULL'} → ${source.defaultValue ?? 'NULL'}`);
  }

  if (differences.length === 0) {
    return undefined;
  }

  return {
    table: tableName,
    column: source.name,
    type: 'alter',
    expected: source,
    actual: target,
    isBreaking: isBreakingTypeChange(target.type, source.type),
    description: differences.join(', '),
  };
}

/**
 * Compare two indexes and return the difference.
 */
function diffIndex(
  tableName: string,
  source: IndexNode,
  target: IndexNode,
  facets: ReadonlySet<IndexFacet>,
): IndexDiff | undefined {
  const differences = describeIndexDifferences(source, target, facets);

  if (differences.length === 0) {
    return undefined;
  }

  return {
    name: source.name,
    table: tableName,
    type: 'alter',
    expected: source,
    actual: target,
    description: differences.join(', '),
  };
}

/**
 * Compare relationships at the schema level.
 */
function diffRelationships(source: SchemaAST, target: SchemaAST, opts: Required<DiffOptions>): RelationshipDiff[] {
  const normalizeName = nameNormalizer(opts);
  const { created, dropped, matched } = matchByKey(source.relationships, target.relationships, (relation) =>
    getRelationshipKey(relation, normalizeName),
  );

  return [
    ...created.map<RelationshipDiff>((relation) => ({
      ...relationEnds(relation),
      type: 'create',
      expected: relation,
    })),
    ...dropped.map<RelationshipDiff>((relation) => ({ ...relationEnds(relation), type: 'drop', actual: relation })),
    ...matched
      .map(([sourceRelation, targetRelation]) => diffRelationship(sourceRelation, targetRelation))
      .filter((diff) => diff !== undefined),
  ];
}

/**
 * Compare two relationships.
 */
function diffRelationship(source: RelationshipNode, target: RelationshipNode): RelationshipDiff | undefined {
  // Compare on delete/update actions (normalizing defaults)
  const sDelete = source.onDelete ?? DEFAULT_FOREIGN_KEY_ACTION;
  const tDelete = target.onDelete ?? DEFAULT_FOREIGN_KEY_ACTION;
  const sUpdate = source.onUpdate ?? DEFAULT_FOREIGN_KEY_ACTION;
  const tUpdate = target.onUpdate ?? DEFAULT_FOREIGN_KEY_ACTION;

  if (sDelete !== tDelete || sUpdate !== tUpdate) {
    return { ...relationEnds(source), type: 'alter', expected: source, actual: target };
  }

  return undefined;
}

/**
 * Generate a unique key for a relationship based on its structure.
 */
function getRelationshipKey(rel: RelationshipNode, normalizeName: (n: string) => string): string {
  const fromCols = rel.from.columns
    .map((c) => c.name)
    .sort()
    .join(',');
  const toCols = rel.to.columns
    .map((c) => c.name)
    .sort()
    .join(',');
  return `${normalizeName(rel.from.table.name)}.${fromCols}->${normalizeName(rel.to.table.name)}.${toCols}`;
}

/**
 * Format a canonical type for display.
 */
function formatType(type: ColumnNode['type']): string {
  let result = type.category;
  if (type.size) result += `(${type.size})`;
  if (type.length) result += `(${type.length})`;
  if (type.precision) {
    result += type.scale !== undefined ? `(${type.precision},${type.scale})` : `(${type.precision})`;
  }
  if (type.unsigned) result += ' unsigned';
  return result;
}

/**
 * Normalize default values for comparison.
 */
function normalizeDefault(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    // Normalize function calls
    const upper = value.toUpperCase();
    if (upper.includes('NOW()') || upper.includes('CURRENT_TIMESTAMP')) {
      return 'CURRENT_TIMESTAMP';
    }
  }
  return String(value);
}
