import { getMeta } from '../entity/index.js';
import type {
  EntityMeta,
  InsertIdSource,
  Query,
  QueryBuildFn,
  QueryConflictPaths,
  QueryContext,
  QueryOptions,
  QueryTextSearchOptions,
  RowLockFeatures,
  SqlDialectFeatures,
  SqlDialectName,
  SqlValues,
  Type,
  UpsertOptions,
} from '../type/index.js';
import { textSearchFields } from '../util/index.js';
import { escapeMysqlSqlLiteral, escapeSingleQuotes } from '../util/sqlLiteral.js';
import {
  ANSI_SQL_VALUES,
  AbstractSqlDialect,
  type CarriedFields,
  type DerivedRelation,
  type RelationRows,
} from './abstractSqlDialect.js';
import { AGGREGATE_VALUE_ALIAS } from './aliases.js';
import { BYTES_PREFIX } from './hydrateColumn.js';
import { jsonPath, type JsonSlot } from './jsonSql.js';
import { aggregatesRelations } from './queryJoins.js';

/**
 * The largest `BIGINT UNSIGNED`: the row count MySQL's manual gives for "all rows from the offset on",
 * and the largest `group_concat_max_len` either engine takes.
 */
const MAX_LIMIT = BigInt.asUintN(64, -1n);

/** Declared apart so MariaDB, which has no `FOR UPDATE OF`, can restate that one part of it. */
export const MYSQL_ROW_LOCKS: RowLockFeatures = { of: true, withWindow: true, placement: 'suffix' };

/** The features of MySQL, which MariaDB starts from. */
export const MYSQL_FEATURES: SqlDialectFeatures = {
  indexIfNotExists: false,
  schemas: true,
  dropTableCascade: false,
  rebuildsTables: false,
  commentSyntax: 'inline',
  vectorIndexRequiresNotNull: false,
  vectorSupportsLength: false,
  vectorBytes: false,
  supportsTimestamptz: false,
  stringSizing: 'varchar',
  supportsUnsigned: true,
  serverSideCursors: false,
  correlatedWrites: true,
  rowLocks: MYSQL_ROW_LOCKS,
  nullsSortLowest: true,
  nullsOrdering: 'expression',
  textScoreIndexes: true,
  orderedUpsertReturning: true,
  orderedJsonAggregates: true,
  narrowVectorTypes: false,
  vectorTuningNeedsTransaction: false,
  serialDeclaresPrimaryKey: false,
  triggers: {
    assignsRow: true,
    body: 'inline',
    fires: 'eachRowIf',
    layout: 'timingFirst',
    scope: 'schema',
    before: true,
    deferrable: false,
  },
};

/** The one `JSON_TABLE` column an exploded array reads each element through, as a JSON document. */
const ELEM_COLUMN = 'v';

/** `(3)` keeps milliseconds, where a bare `CURRENT_TIMESTAMP` has whole seconds; `UUID()` is a version 1. */
export const MYSQL_SQL_VALUES: SqlValues = {
  ...ANSI_SQL_VALUES,
  currentTimestamp: 'CURRENT_TIMESTAMP(3)',
  uuid: 'UUID()',
};

/** What MySQL and MariaDB share, their JSON functions above all: `JSON_LENGTH`, `JSON_CONTAINS`, `JSON_TABLE`, `JSON_SET`. */
export abstract class MysqlLikeSqlDialect extends AbstractSqlDialect {
  /** Every member of this family runs the same SQL, so a body written once serves them all. */
  override get dialectFamily(): SqlDialectName {
    return 'mysql';
  }

  override readonly features: SqlDialectFeatures = MYSQL_FEATURES;

  /**
   * `information_schema` keeps InnoDB's own row estimate, which is live enough to answer before
   * anything has been analyzed. `DATABASE()` where the entity names no schema, so the estimate comes
   * from the connection's own database rather than a same-named table in another one.
   */
  override estimatedCount<E>(ctx: QueryContext, entity: Type<E>): void {
    const meta = getMeta(entity);
    const schema = this.resolveSchema(meta);
    ctx.append(
      `SELECT TABLE_ROWS ${this.escapeId(AGGREGATE_VALUE_ALIAS, true)} FROM information_schema.TABLES WHERE TABLE_SCHEMA = `,
    );
    if (schema) {
      ctx.addValue(schema);
    } else {
      ctx.append('DATABASE()');
    }
    ctx.append(' AND TABLE_NAME = ');
    ctx.addValue(this.resolveTableAlias(meta));
  }

  protected override readonly unboundedLimit = String(MAX_LIMIT);

  /** A signed key, so a foreign key taking its type from it matches, as MySQL refuses an `UNSIGNED` mismatch. */
  override readonly autoIncrementSuffix = 'AUTO_INCREMENT';

  override readonly escapeIdChar = '`';

  override readonly beginTransactionCommand = 'START TRANSACTION';

  override readonly isolationLevelStrategy = 'set-before';

  override readonly booleanLiteral = 'integer';

  override readonly sqlValues: SqlValues = MYSQL_SQL_VALUES;

  // No `RETURNING` support, so multi-row insert IDs are inferred from the header - see the
  // `innodb_autoinc_lock_mode` caveat on `buildUpdateResult` in `util/sql.util.ts`.
  override readonly insertIdSource: InsertIdSource = 'firstId';

  /** `INSERT ... ON DUPLICATE KEY UPDATE`, the assignments bound after the insert, where a `?` reads them. */
  override upsert<E>(
    ctx: QueryContext,
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E | E[],
    { update }: UpsertOptions<E> = {},
  ): void {
    const meta = getMeta(entity);
    const updateCtx = this.createContext();
    const assignments = this.getUpsertUpdateAssignments(updateCtx, meta, conflictPaths, payload, update);
    const insertCtx = this.createContext();
    this.appendInsertValues(insertCtx, entity, payload);
    const idReturning = this.insertedIdReturning(meta);
    ctx.append(`${this.onDuplicateKey(insertCtx.sql, assignments)}${idReturning && ` ${idReturning}`}`);
    ctx.pushValue(...insertCtx.values, ...updateCtx.values);
  }

  protected override appendTriggerUpsert<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    _conflictPaths: QueryConflictPaths<E>,
    entries: readonly [string, unknown][],
    assignments: string,
  ): void {
    const insert = this.buildFragment(ctx, (fragmentCtx) => this.appendTriggerInsert(fragmentCtx, meta, entries));
    ctx.append(`${this.onDuplicateKey(insert, assignments)};`);
  }

  /**
   * `insert` on a duplicate key: `ON DUPLICATE KEY UPDATE` with the new row named, or `INSERT IGNORE` where there
   * is nothing to assign. MySQL matches on any unique key, not just the conflict paths, which it cannot name.
   */
  private onDuplicateKey(insert: string, assignments: string): string {
    if (!assignments) {
      return insert.replace(/^INSERT/, 'INSERT IGNORE');
    }
    const alias = this.upsertNewRowAlias && ` AS ${this.escapeId(this.upsertNewRowAlias, true)}`;
    return `${insert}${alias ?? ''} ON DUPLICATE KEY UPDATE ${assignments}`;
  }

  /** The new row through the alias it is given, or `VALUE(col)` where the dialect has no such syntax. */
  protected override upsertIncoming(column: string): string {
    return this.upsertNewRowAlias ? `${this.escapeId(this.upsertNewRowAlias, true)}.${column}` : `VALUE(${column})`;
  }

  /**
   * The alias the inserted row is given after the values list, and read back by the assignments.
   * Undefined where the dialect has no such syntax - MariaDB, which reads that row through
   * `VALUE(col)` instead: it renamed `VALUES()` in 10.3.3, the old name clashing with the standard
   * table value constructors, where MySQL deprecated the function outright in favour of the alias.
   */
  protected readonly upsertNewRowAlias: string | undefined = undefined;

  override readonly maxBindValues: number = 65535;

  /**
   * An ordered `GROUP_CONCAT` of each row's object, which reads as a JSON array: MySQL's `JSON_ARRAYAGG`
   * takes no `ORDER BY`, and as a window over the rows it rebuilds the array for every one of them.
   */
  protected override appendRelationArray(ctx: QueryContext, rows: RelationRows): void {
    const { from, pairs, order } = this.derivedRelation(ctx, rows);
    const objects = `${this.jsonObject(pairs)}${order ? ` ORDER BY ${order}` : ''} SEPARATOR ','`;
    ctx.append(`(SELECT COALESCE(CONCAT('[', GROUP_CONCAT(${objects}), ']'), '[]') FROM ${from})`);
  }

  /** A read's statement, with the settings it needs applied to it alone. */
  override find<E>(ctx: QueryContext, entity: Type<E>, q: Query<E> = {}, opts?: QueryOptions, totalAlias?: string) {
    this.settled(ctx, entity, q, (statement) => super.find(statement, entity, q, opts, totalAlias));
  }

  /** A `$distinct` read's count, which reads the relations the read does. */
  override countDistinct<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, opts?: QueryOptions) {
    this.settled(ctx, entity, q, (statement) => super.countDistinct(statement, entity, q, opts));
  }

  private settled<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, build: QueryBuildFn): void {
    const settings = this.statementSettings(entity, q);
    if (!settings.length) {
      build(ctx);
      return;
    }
    const statement = ctx.createFragment();
    build(statement);
    ctx.append(this.applySettings(statement.sql, settings));
  }

  /**
   * `name=value` for each variable a read's statement sets for itself alone. `GROUP_CONCAT`, and
   * MariaDB's `JSON_ARRAYAGG` built on it, cut a relation's array at `group_concat_max_len`.
   */
  protected statementSettings<E>(entity: Type<E>, q: Query<E>): string[] {
    return aggregatesRelations(getMeta(entity), q) ? [`group_concat_max_len=${MAX_LIMIT}`] : [];
  }

  /** `sql` with `settings` scoped to it, in this engine's spelling. */
  protected abstract applySettings(sql: string, settings: readonly string[]): string;

  /** `JSON_OBJECT` of each key and its value. */
  protected jsonObject(pairs: DerivedRelation['pairs']): string {
    return `JSON_OBJECT(${this.jsonObjectArgs(pairs)})`;
  }

  /**
   * A number and bytes cross JSON as text, where JSON would round the one and spell the other as base64,
   * and a vector as the engine reads one back: its packed bytes on MariaDB.
   */
  protected override readonly carriedFields = {
    numeric: (expr) => `CAST(${expr} AS CHAR)`,
    blob: (expr) => this.bytesAsText(expr),
    vector: (expr, field) => this.selectFieldExpr(expr, field),
  } satisfies CarriedFields;

  /** Bytes as the hex text `decodeColumn` reads back, whole. */
  protected bytesAsText(expr: string): string {
    return `CONCAT(${this.escape(BYTES_PREFIX)}, HEX(${expr}))`;
  }

  override escape(value: unknown): string {
    return escapeMysqlSqlLiteral(value);
  }

  /** A date as UTC text, which a `DATETIME` stores as is, where a driver would convert it to its own zone. */
  protected override readonly dateZone = '';

  /**
   * `MATCH(cols) AGAINST(?)`, which needs a `FULLTEXT` index over exactly those columns: without one
   * the server answers "Can't find FULLTEXT index matching the column list". Declare it with
   * `@Index((post) => [...], { type: 'fulltext' })`.
   */
  protected override appendTextSearch<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    search: QueryTextSearchOptions<E>,
    prefix: string | undefined,
  ): void {
    this.appendTextScore(ctx, meta, search, textSearchFields(meta, search), prefix);
  }

  /**
   * `MATCH ... AGAINST` is the relevance itself, a match being any row it scores above zero. Over `keys`
   * alone, it needs a `FULLTEXT` index of exactly those: a weighted index declares one per heavier column.
   */
  protected override appendTextScore<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    search: QueryTextSearchOptions<E>,
    keys: readonly string[],
    prefix: string | undefined,
  ): void {
    ctx.append(`MATCH(${this.textSearchTarget(this.textColumns(meta, keys, prefix))}) AGAINST(`);
    ctx.addValue(search.$value);
    ctx.append(')');
  }

  /** `DOUBLE`, never a bare `DECIMAL`, which is `DECIMAL(10,0)` and rounds `1.4` to `1`. */
  protected override numericCast(expr: string): string {
    return `CAST(${expr} AS DOUBLE)`;
  }

  override neExpr(field: string, ph: string): string {
    // MySQL/MariaDB null-safe inequality: true when values differ or one side is NULL.
    return `NOT (${field} <=> ${ph})`;
  }

  /**
   * `JSON_MERGE_PRESERVE` concatenates arrays and creates absent keys, so every pushed key is
   * handled in one call that references `expr` once - unlike `JSON_ARRAY_APPEND`, which needs a
   * second reference for the array source and returns NULL on MariaDB for an absent key.
   */
  protected override jsonPush(ctx: QueryContext, expr: string, push: Record<string, unknown>): string {
    const entries = Object.entries(push).map(
      ([key, value]) => `'${escapeSingleQuotes(key)}', JSON_ARRAY(${this.jsonScalarParam(ctx, value)})`,
    );
    return `JSON_MERGE_PRESERVE(${expr}, JSON_OBJECT(${entries.join(', ')}))`;
  }

  /**
   * `->` for the value and `->>` for its text, each taking the whole path (`'$.a.b'`): a bare key, as
   * Postgres chains them, is "Invalid JSON path expression" here.
   */
  protected override jsonPathReading(escapedColumn: string, path: string, mode: 'json' | 'text'): string {
    return mode === 'json' ? `${escapedColumn}->${jsonPath(path)}` : `(${escapedColumn}->>${jsonPath(path)})`;
  }

  /** `JSON_CONTAINS` of the array as the path reads it, which is what a multi-valued index is matched by. */
  protected override jsonContains(ctx: QueryContext, slot: JsonSlot, values: readonly unknown[]): string {
    return `JSON_CONTAINS(${this.jsonValue(slot)}, ${this.addValue(ctx, JSON.stringify(values))})`;
  }

  /** Only an array's, where `JSON_LENGTH` counts a scalar as 1 and an object by its keys. */
  protected override jsonLength(slot: JsonSlot): string {
    return `CASE WHEN ${this.jsonIsArray(slot)} THEN JSON_LENGTH(${this.jsonValue(slot)}) END`;
  }

  protected override jsonIsArray(slot: JsonSlot): string {
    return `JSON_TYPE(${this.jsonValue(slot)}) = 'ARRAY'`;
  }

  /**
   * Each element of the array at the path as one `JSON` column, which any path then reads the way it reads
   * a column's document.
   */
  protected override jsonElemFrom(slot: JsonSlot, alias: string): string {
    return `JSON_TABLE(${slot.base}, ${jsonPath(slot.path, '[*]')} COLUMNS (${ELEM_COLUMN} JSON PATH '$')) AS ${alias}`;
  }

  protected override jsonElemDoc(alias: string): string {
    return `${alias}.${ELEM_COLUMN}`;
  }
}
