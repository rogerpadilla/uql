import { areTypesEqual, isBreakingTypeChange } from './canonicalType.js';
import { describeIndexDifferences, type IndexFacet, pairIndexes } from './indexDifferences.js';
import { matchByKey } from './matchByKey.js';
import type { SchemaAST } from './schemaAST.js';
import type { CanonicalType } from './types.js';
import type {
  ColumnDiff,
  ColumnNode,
  ForeignKeyAction,
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
  /** Compare foreign keys/relationships */
  compareRelationships?: boolean;
  /** Ignore case differences in names */
  ignoreCase?: boolean;
  /** Tables to exclude from comparison */
  excludeTables?: string[];
  /**
   * A type as the engine stores it, since several canonical types share one storage type (a boolean is
   * `TINYINT(1)` on MySQL): the one thing a dialect is needed for, passed as a function.
   */
  normalizeType?: (type: CanonicalType) => CanonicalType;
  /** Whether two defaults are one value, as the dialect that reprinted them can tell: `'a'::character varying` is `'a'`. */
  defaultsEqual?: (expected: unknown, actual: unknown) => boolean;
}

/**
 * Default diff options.
 */
const DEFAULT_OPTIONS: Required<DiffOptions> = {
  compareIndexes: true,
  compareRelationships: true,
  normalizeType: (type) => type,
  defaultsEqual: defaultsEqualAsWritten,
  ignoreCase: false,
  excludeTables: [],
};

function nameNormalizer(opts: Required<DiffOptions>): (name: string) => string {
  return opts.ignoreCase ? (name) => name.toLowerCase() : (name) => name;
}

/** How a relationship diff names the pair it is about, whichever way it differs. */
function relationEnds(relation: RelationshipNode) {
  return { name: relation.name, fromTable: relation.from.table.name, toTable: relation.to.table.name };
}

/** The differences between the expected schema (the entities) and the actual one (the database). */
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
  const columnDiffs = tablesToAlter.flatMap((tableDiff) => tableDiff.columnDiffs);
  const indexDiffs = tablesToAlter.flatMap((tableDiff) => tableDiff.indexDiffs);
  const primaryKeyDiffs = tablesToAlter.flatMap((tableDiff) => tableDiff.primaryKeyDiff ?? []);
  // Relationships span tables, so they are compared over the whole schema rather than per table.
  const relationshipDiffs = opts.compareRelationships
    ? diffRelationshipNodes(source.relationships, target.relationships, opts)
    : [];

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

/** The differences between two tables, shared by migrations and drift detection so they cannot disagree. */
export function diffTable(
  source: TableNode,
  target: TableNode,
  options: DiffOptions = {},
): (TableDiff & { readonly columnDiffs: ColumnDiff[]; readonly indexDiffs: IndexDiff[] }) | undefined {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const columnDiffs = diffTableColumns(source, target, opts);
  const indexDiffs = opts.compareIndexes ? diffTableIndexes(source, target, opts) : [];
  const primaryKeyDiff = diffPrimaryKey(source, target);

  if (columnDiffs.length === 0 && indexDiffs.length === 0 && !primaryKeyDiff) {
    return undefined;
  }

  return { name: source.name, type: 'alter', columnDiffs, indexDiffs, primaryKeyDiff };
}

/** The two keys where they hold different columns, compared in order and never by the name the engine gave them. */
function diffPrimaryKey(source: TableNode, target: TableNode): PrimaryKeyDiff | undefined {
  const expected = source.primaryKey?.columns ?? [];
  const actual = target.primaryKey?.columns ?? [];
  if (expected.length === actual.length && expected.every((column, i) => column === actual[i])) {
    return undefined;
  }
  return { table: source.name, expected: source.primaryKey, actual: target.primaryKey };
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

/** Compare indexes between two tables, paired by {@link pairIndexes}, in what the target's reader reports. */
function diffTableIndexes(source: TableNode, target: TableNode, opts: Required<DiffOptions>): IndexDiff[] {
  const { created, dropped, matched } = pairIndexes(source.indexes, target.indexes, nameNormalizer(opts));

  return [
    ...created.map<IndexDiff>((index) => ({ name: index.name, table: source.name, type: 'create', expected: index })),
    ...dropped.map<IndexDiff>((index) => ({ name: index.name, table: target.name, type: 'drop', actual: index })),
    ...matched
      .map(([sourceIndex, targetIndex]) => diffIndex(source.name, sourceIndex, targetIndex, target.indexFacets))
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

  // A key column's type and nullability are implied, not stated, and catalogues report them
  // inconsistently (`BIGINT(20)`, SQLite's `notnull: 0` rowid), so neither is compared.
  const generatedType = source.isAutoIncrement && target.isAutoIncrement;
  const impliedNotNull = source.isPrimaryKey && target.isPrimaryKey;

  const expectedType = opts.normalizeType(source.type);
  const actualType = opts.normalizeType(target.type);
  const typeChanged = !generatedType && !areTypesEqual(expectedType, actualType);
  if (typeChanged) {
    differences.push(`type: ${formatType(source.type)} -> ${formatType(target.type)}`);
  }

  // Signedness is the one thing compared on a generated key, because it is the one part of the serial
  // spelling that does round trip - and a key left unsigned refuses every foreign key pointing at it,
  // since the referencing column takes its type from the canonical one, which is signed. Without this
  // a database created before the serial became signed could never gain a foreign key.
  const signednessChanged = generatedType && !!source.type.unsigned !== !!target.type.unsigned;
  if (signednessChanged) {
    differences.push(`type: ${formatType(source.type)} -> ${formatType(target.type)}`);
  }

  if (!impliedNotNull && source.nullable !== target.nullable) {
    differences.push(`nullable: ${target.nullable} -> ${source.nullable}`);
  }

  // Not compared, since no statement this generator emits could settle a difference: `isAutoIncrement`,
  // `enum` (a check the database reprints), `generatedAs`, and `comment`. Nor `isUnique`: a unique
  // column is a unique index, compared with the indexes.

  // Compare default values (if both defined)
  if (!opts.defaultsEqual(source.defaultValue, target.defaultValue)) {
    differences.push(`default: ${target.defaultValue ?? 'NULL'} -> ${source.defaultValue ?? 'NULL'}`);
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
    // Only the type this diff actually reports: a column altered for its default carries no data loss,
    // and a generated key's type - never compared above - reads as unsigned against an entity that
    // cannot say so.
    isBreaking: (typeChanged || signednessChanged) && isBreakingTypeChange(actualType, expectedType),
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

/** The differences between two lists of foreign keys, matched by their columns and never by the name the engine gave them. */
export function diffRelationshipNodes(
  source: readonly RelationshipNode[],
  target: readonly RelationshipNode[],
  opts: DiffOptions = {},
): RelationshipDiff[] {
  const normalizeName = nameNormalizer({ ...DEFAULT_OPTIONS, ...opts });
  const { created, dropped, matched } = matchByKey(source, target, (relation) =>
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

/** A relationship's `ON DELETE` and `ON UPDATE`, an unstated one read as the action the database applies. */
export function referentialActions(rel: RelationshipNode): {
  readonly onDelete: ForeignKeyAction;
  readonly onUpdate: ForeignKeyAction;
} {
  return {
    onDelete: rel.onDelete ?? DEFAULT_FOREIGN_KEY_ACTION,
    onUpdate: rel.onUpdate ?? DEFAULT_FOREIGN_KEY_ACTION,
  };
}

/** Two relationships over the same columns differ only in what they do when the row they point at goes. */
function diffRelationship(source: RelationshipNode, target: RelationshipNode): RelationshipDiff | undefined {
  const [expected, actual] = [referentialActions(source), referentialActions(target)];
  if (expected.onDelete !== actual.onDelete || expected.onUpdate !== actual.onUpdate) {
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

/** Two defaults compared as written, where no dialect reprints them: `now()` and `CURRENT_TIMESTAMP` are one. */
export function defaultsEqualAsWritten(expected: unknown, actual: unknown): boolean {
  return normalizeDefault(expected) === normalizeDefault(actual);
}

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
