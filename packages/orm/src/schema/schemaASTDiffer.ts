import type { ColumnRenames, Rename } from '../type/migration.js';
import { isOwnedName, qualifyName } from '../util/sql.util.js';
import { areTypesEqual, isBreakingTypeChange } from './canonicalType.js';
import { type IndexChange, indexChanges } from './indexDifferences.js';
import { matchByKey, pairUnique } from './matchByKey.js';
import type { SchemaAST } from './schemaAST.js';
import { writtenDefault } from './sqlExpression.js';
import type { CanonicalType, ColumnFacet } from './types.js';
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
  TableChange,
  TableDiff,
  TableNode,
} from './types.js';
import { DEFAULT_FOREIGN_KEY_ACTION } from './types.js';

/**
 * Options for schema diffing.
 */
export interface DiffOptions {
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

const DEFAULT_OPTIONS: Required<DiffOptions> = {
  normalizeType: (type) => type,
  defaultsEqual: defaultsEqualAsWritten,
  excludeTables: [],
};

/** How a relationship diff names the pair it is about, whichever way it differs. */
function relationEnds(relation: RelationshipNode) {
  return { name: relation.name, fromTable: relation.from.table.name };
}

/** The differences between the expected schema (the entities) and the actual one (the database). */
export function diffSchemas(source: SchemaAST, target: SchemaAST, options: DiffOptions = {}): SchemaDiffResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { created, dropped, matched } = matchTables(source, target, opts);
  const altered = matched
    .map(([sourceTable, targetTable]) => diffTable(sourceTable, targetTable, opts))
    .filter((tableDiff) => tableDiff !== undefined);
  return {
    tables: [...created.map((to) => ({ to })), ...dropped.map((from) => ({ from }))],
    columns: altered.flatMap((tableDiff) => tableDiff.columns),
    indexes: matched.flatMap(([sourceTable, targetTable]) => diffTableIndexes(sourceTable, targetTable)),
    checks: altered.flatMap((tableDiff) => tableDiff.checks),
    triggers: altered.flatMap((tableDiff) => tableDiff.triggers),
    primaryKeys: altered.flatMap((tableDiff) => tableDiff.primaryKey ?? []),
    // Relationships span tables, so they are compared over the whole schema rather than per table.
    relationships: diffRelationshipNodes(source.relationships, target.relationships),
  };
}

/**
 * The differences between two tables but their indexes, which a migration pairs on its own; shared by
 * migrations and drift detection so they cannot disagree.
 */
export function diffTable(source: TableNode, target: TableNode, options: DiffOptions = {}): TableDiff | undefined {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const columns = diffTableColumns(source, target, opts);
  const checks = diffOwned(source.name, source.checks, target.checks);
  const triggers = diffOwned(source.name, source.triggers, target.triggers);
  const primaryKey = diffPrimaryKey(source, target);
  return columns.length || checks.length || triggers.length || primaryKey
    ? { columns, checks, triggers, primaryKey }
    : undefined;
}

/**
 * What one side declares and the other has not installed, by name, for an object named after a hash of its
 * SQL. Only uql's own are ever dropped: the rest are a second writer's.
 */
function diffOwned<T extends { readonly name: string }>(
  table: string,
  declared: readonly T[],
  installed: readonly T[],
): TableChange<T>[] {
  const owned = installed.filter((it) => isOwnedName(it.name));
  const { created, dropped } = matchByKey(declared, owned, (it) => it.name);
  return [...created.map((to) => ({ table, to })), ...dropped.map((from) => ({ table, from }))];
}

/** The two keys where they hold different columns, compared in order and never by the name the engine gave them. */
function diffPrimaryKey(source: TableNode, target: TableNode): PrimaryKeyDiff | undefined {
  const expected = source.primaryKey?.columns ?? [];
  const actual = target.primaryKey?.columns ?? [];
  if (expected.length === actual.length && expected.every((column, i) => column === actual[i])) {
    return undefined;
  }
  return { table: source.name, from: target.primaryKey, to: source.primaryKey };
}

function diffTableColumns(source: TableNode, target: TableNode, opts: Required<DiffOptions>): ColumnDiff[] {
  const { created, dropped, matched } = matchByKey(
    source.columns.values(),
    target.columns.values(),
    (column) => column.name,
  );

  return [
    ...created.map<ColumnDiff>((column) => ({
      table: source.name,
      column: column.name,
      to: column,
    })),
    ...dropped.map<ColumnDiff>((column) => ({
      table: target.name,
      column: column.name,
      from: column,
      isBreaking: true,
    })),
    ...matched
      .map(([sourceColumn, targetColumn]) => diffColumn(source.name, sourceColumn, targetColumn, opts))
      .filter((diff) => diff !== undefined),
  ];
}

/**
 * The columns renamed in the tables both sides name, by qualified table:
 * a new column identical to exactly one the entity no longer names, and to no other. The dropped side is
 * always the entity's own table, so a wrong guess renames, keeping the data, and never drops it.
 */
export function columnRenames(desired: SchemaAST, actual: SchemaAST, options: DiffOptions = {}): ColumnRenames {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return new Map(
    matchTables(desired, actual, opts).matched.flatMap(([expected, current]) => {
      const { created, dropped } = matchByKey(
        expected.columns.values(),
        current.columns.values(),
        (column) => column.name,
      );
      const { matched } = pairUnique(created, dropped, (to, from) => !diffColumn(expected.name, to, from, opts));
      const table = qualifyName(current.name, current.schema);
      return matched.length ? [[table, matched.map(([to, from]) => ({ from: from.name, to: to.name }))] as const] : [];
    }),
  );
}

/**
 * Tables the database holds that a new one is identical to but for its name, each only where it is the one
 * match on both sides. Suggested, never applied: the database's side is a table no entity names, which may
 * be another application's rather than one this schema renamed.
 */
export function tableRenameCandidates(desired: SchemaAST, actual: SchemaAST, options: DiffOptions = {}): Rename[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { created, dropped } = matchTables(desired, actual, opts);
  // Columns and key alone: a check or trigger is named for its table, so a renamed one differs by them.
  const same = (to: TableNode, from: TableNode) =>
    to.schema === from.schema && !diffTableColumns(to, from, opts).length && !diffPrimaryKey(to, from);
  return pairUnique(created, dropped, same).matched.map(([to, from]) => ({ from: from.name, to: to.name }));
}

/** The two sides' tables paired by name, those `excludeTables` names left out of both. */
function matchTables(desired: SchemaAST, actual: SchemaAST, opts: Required<DiffOptions>) {
  const included = (tables: Iterable<TableNode>) =>
    [...tables].filter((table) => !opts.excludeTables.includes(table.name));
  return matchByKey(included(desired.tables.values()), included(actual.tables.values()), (table) => table.name);
}

/**
 * The index changes between two tables, paired the way a migration pairs them. Every unpaired database
 * index is reported as a drop, even one a migration would keep, and each change takes the entity's index
 * name when there is one.
 */
function diffTableIndexes(source: TableNode, target: TableNode): IndexDiff[] {
  const { changes, kept } = indexChanges(source.name, source.indexes, target.indexes, target.indexFacets);
  const drops = kept.map((from): IndexChange<IndexNode> => ({ from }));
  return [...changes, ...drops].map((change) => ({
    ...change,
    table: source.name,
    name: change.to === undefined ? change.from.name : change.to.name,
  }));
}

/** How `target`, the database's column, differs from `source`, the entity's, or `undefined` where they agree. */
function diffColumn(
  tableName: string,
  source: ColumnNode,
  target: ColumnNode,
  opts: Required<DiffOptions>,
): ColumnDiff | undefined {
  const changed: ColumnFacet[] = [];

  // A key column's type and nullability are implied, not stated, and catalogues report them
  // inconsistently (`BIGINT(20)`, SQLite's `notnull: 0` rowid), so neither is compared.
  const generatedType = source.isAutoIncrement && target.isAutoIncrement;
  const impliedNotNull = source.isPrimaryKey && target.isPrimaryKey;

  const expectedType = opts.normalizeType(source.type);
  const actualType = opts.normalizeType(target.type);
  // A generated key's signedness alone: the one part of its serial spelling that round trips, and an unsigned
  // key refuses every foreign key, which takes the canonical, signed type.
  const typeChanged = generatedType
    ? !!source.type.unsigned !== !!target.type.unsigned
    : !areTypesEqual(expectedType, actualType);
  if (typeChanged) {
    changed.push('type');
  }
  if (!impliedNotNull && source.nullable !== target.nullable) {
    changed.push('nullable');
  }

  // Not compared, since no statement this generator emits could settle a difference: `isAutoIncrement`,
  // `generatedAs`, and `comment`. Nor `isUnique`: a unique column is a unique index, compared with the indexes.

  if (!opts.defaultsEqual(source.defaultValue, target.defaultValue)) {
    changed.push('default');
  }
  if (!changed.length) {
    return undefined;
  }
  return {
    table: tableName,
    column: source.name,
    from: target,
    to: source,
    changed,
    // Only by the type this diff reports: a column altered for its default loses nothing.
    isBreaking: typeChanged && isBreakingTypeChange(actualType, expectedType),
  };
}

/** The differences between two lists of foreign keys, matched by their columns and never by the name the engine gave them. */
export function diffRelationshipNodes(
  source: readonly RelationshipNode[],
  target: readonly RelationshipNode[],
): RelationshipDiff[] {
  const { created, dropped, matched } = matchByKey(source, target, relationshipKey);

  return [
    ...created.map<RelationshipDiff>((relation) => ({ ...relationEnds(relation), to: relation })),
    ...dropped.map<RelationshipDiff>((relation) => ({ ...relationEnds(relation), from: relation })),
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
    return { ...relationEnds(source), from: target, to: source };
  }
  return undefined;
}

/** What a foreign key is: its two tables, and each of its columns with the one it points at, in any order. */
function relationshipKey(rel: RelationshipNode): string {
  const pairs = rel.from.columns.map((column, at) => `${column.name}>${rel.to.columns[at].name}`).sort();
  return `${rel.from.table.name}->${rel.to.table.name}:${pairs.join(',')}`;
}

/**
 * Compares two defaults exactly as written, for when no dialect renders them: SQL must match to the letter.
 * Migrations and drift use the generator's equality instead, which knows how its engine reprints SQL.
 */
export function defaultsEqualAsWritten(expected: unknown, actual: unknown): boolean {
  return writtenDefault(expected ?? '') === writtenDefault(actual ?? '');
}
