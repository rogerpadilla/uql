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
import { describeIndexDifferences, type IndexFacet } from './indexDifferences.js';
import type { SchemaAST } from './schemaAST.js';
import type {
  ColumnDiff,
  ColumnNode,
  IndexDiff,
  IndexNode,
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
}

/**
 * Default diff options.
 */
const DEFAULT_OPTIONS: Required<DiffOptions> = {
  compareIndexes: true,
  indexFacets: new Set(),
  compareRelationships: true,
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
  // Relationships span tables, so they are compared over the whole schema rather than per table.
  const relationshipDiffs = opts.compareRelationships ? diffRelationships(source, target, opts) : [];

  const hasDifferences =
    tablesToCreate.length > 0 ||
    tablesToDrop.length > 0 ||
    tablesToAlter.length > 0 ||
    relationshipDiffs.length > 0 ||
    indexDiffs.length > 0;
  const hasBreakingChanges = tablesToDrop.length > 0 || columnDiffs.some((d) => d.isBreaking);

  return {
    tablesToCreate,
    tablesToDrop,
    tablesToAlter,
    columnDiffs,
    indexDiffs,
    relationshipDiffs,
    hasDifferences,
    hasBreakingChanges,
  };
}

/**
 * Compare two tables and return the differences.
 */
function diffTable(source: TableNode, target: TableNode, opts: Required<DiffOptions>): TableDiff | undefined {
  const columnDiffs = diffTableColumns(source, target, opts);
  const indexDiffs = opts.compareIndexes ? diffTableIndexes(source, target, opts) : [];

  if (columnDiffs.length === 0 && indexDiffs.length === 0) {
    return undefined;
  }

  return { name: source.name, type: 'alter', columnDiffs, indexDiffs };
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
      .map(([sourceColumn, targetColumn]) => diffColumn(source.name, sourceColumn, targetColumn))
      .filter((diff) => diff !== undefined),
  ];
}

/**
 * Compare indexes between two tables.
 */
function diffTableIndexes(source: TableNode, target: TableNode, opts: Required<DiffOptions>): IndexDiff[] {
  const normalizeName = nameNormalizer(opts);
  const { created, dropped, matched } = matchByKey(source.indexes, target.indexes, (index) =>
    normalizeName(index.name),
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
function diffColumn(tableName: string, source: ColumnNode, target: ColumnNode): ColumnDiff | undefined {
  const differences: string[] = [];

  // Compare types
  if (!areTypesEqual(source.type, target.type)) {
    differences.push(`type: ${formatType(source.type)} → ${formatType(target.type)}`);
  }

  // Compare nullability
  if (source.nullable !== target.nullable) {
    differences.push(`nullable: ${target.nullable} → ${source.nullable}`);
  }

  // Compare unique constraint
  if (source.isUnique !== target.isUnique) {
    differences.push(`unique: ${target.isUnique} → ${source.isUnique}`);
  }

  // Compare auto-increment
  if (source.isAutoIncrement !== target.isAutoIncrement) {
    differences.push(`autoIncrement: ${target.isAutoIncrement} → ${source.isAutoIncrement}`);
  }

  // Compare default values (if both defined)
  if (normalizeDefault(source.defaultValue) !== normalizeDefault(target.defaultValue)) {
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
