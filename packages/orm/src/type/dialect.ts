import type { EntityMeta, EntityPredicate, UpdatePayload } from './entity.js';
import type { Query, QueryConflictPaths, QueryPage, QueryRenderOptions, QuerySearch, RelationQuery } from './query.js';
import type { QueryAggMap, QueryAggregate, QueryAggregateOp, QueryGroupMap } from './queryAggregate.js';
import type { QueryRawRenderOptions } from './queryRaw.js';
import type { QueryWhere } from './queryWhere.js';
import type { Type } from './utility.js';
import type { QueryVectorQuery } from './vector.js';

/**
 * comparison options.
 */
export type QueryComparisonOptions = QueryRenderOptions & {
  /**
   * Whether this fragment is rendered as an operand of an enclosing `AND`/`OR`/`NOT`. An operand
   * parenthesizes itself when it emits more than one term, so no fragment ever depends on the
   * engine's operator precedence. Only the `WHERE` clause as a whole is not an operand.
   */
  operand?: boolean;
};

/**
 * query filter options.
 */
export type QueryWhereOptions = QueryComparisonOptions & {
  /**
   * clause to be used in the filter.
   */
  clause?: 'WHERE' | 'AND' | false;
};

/**
 * Emits a statement, or a fragment of one, into the context it is handed. What a caller passes when
 * it knows *what* to build but not *where*: the statement is assembled into whichever context the
 * receiver opens, so the two ends cannot disagree about which one it went into.
 */
export type QueryBuildFn = (ctx: QueryContext) => void;

export interface QueryContext {
  append(sql: string): this;
  addValue(value: unknown): this;
  pushValue(...values: unknown[]): this;
  /**
   * An alias for a table or row source the statement reads: `name`, or `name_2`, `name_3`... - the
   * first no other took, so a nested one never shadows what it correlates against, and never `parent`,
   * the one a correlated subquery compares against. Compared without case, as MySQL does on macOS.
   */
  claimAlias(name: string, parent?: string): string;
  /**
   * A context for a fragment of this same statement: it renders its own SQL in isolation while
   * sharing the bound values and the generated aliases, so both stay unique and correctly numbered
   * across the statement. See {@link AbstractSqlDialect.buildFragment}.
   */
  createFragment(): QueryContext;
  readonly sql: string;
  readonly values: unknown[];
  /** Whether a value is written as its literal rather than bound: DDL has no placeholder to bind into. */
  readonly inlineValues: boolean;
}

export type QueryContextOptions = {
  /** See {@link QueryContext.inlineValues}. */
  readonly inlineValues?: boolean;
};

/**
 * How a Postgres-wire driver binds a parameter, which is all its dialect's `driverCapabilities` option may
 * change: what the engine has is the dialect's own to state.
 */
export interface DriverCapabilities {
  /**
   * Whether JSON bind parameters are cast via text first (`($n::text)::jsonb`).
   * Bun SQL PostgreSQL uses this for reliable jsonb merge/push; `pg` does not.
   */
  readonly explicitJsonCast: boolean;
  /**
   * Whether the driver natively supports JS arrays for the underlying database type.
   * `PgQuerierPool` keeps this `true` for node-postgres; `BunSqlQuerierPool` sets `false` and binds
   * `toPgArray` string literals instead.
   */
  readonly nativeArrays: boolean;
}

/** How a dialect reports inserted ids: from the statement per row, or MySQL's first id, the rest inferred. */
export type InsertIdSource = 'returning' | 'firstId';

/**
 * Features of the database engine (SQL syntax layer).
 */
export interface DialectFeatures {
  readonly indexIfNotExists: boolean;
  /**
   * Whether the engine has namespaces a table can sit behind. `false` leaves every table
   * unqualified, whatever `schema` an entity or pool named: SQLite attaches database files and
   * MongoDB takes its database from the connection, so neither has one to name.
   */
  readonly schemas: boolean;
  readonly dropTableCascade: boolean;
  readonly foreignKeyAlter: boolean;
  /**
   * Whether a table's primary key can be changed on an existing table. False on SQLite, whose only
   * route is rebuilding the table - so a migration that would change one is refused by name rather
   * than emitting DDL the engine rejects.
   */
  readonly primaryKeyAlter: boolean;
  /**
   * Whether a stored generated column can be added to an existing table. SQLite takes one only in a
   * `CREATE TABLE`, so a sync that would add one is refused by name.
   */
  readonly generatedColumnAdd: boolean;
  /** Where a comment goes: in the declaration (MySQL family), a `COMMENT ON` of its own (Postgres family), or nowhere. */
  readonly commentSyntax: 'inline' | 'statement' | 'none';
  /**
   * Whether every column of a vector index has to be `NOT NULL`, which MariaDB 12.3 enforces ("All
   * parts of a VECTOR index must be NOT NULL") and CockroachDB 26.3 does not - so being indexed, not
   * the entity, decides the column's nullability there.
   */
  readonly vectorIndexRequiresNotNull: boolean;
  /** Whether the dialect requires/allows (n) length constraints on vector types. */
  readonly vectorSupportsLength: boolean;
  /**
   * Whether a vector binds as its packed little-endian float32 bytes, which a blob column holds and the
   * SQLite family and MariaDB read, rather than as `[1,2,3]` text they would reparse per row.
   */
  readonly vectorBytes: boolean;
  /** Whether the dialect natively supports the TIMESTAMPTZ alias/type. */
  readonly supportsTimestamptz: boolean;
  /**
   * How a string column is sized: always unbounded (`text`, SQLite), bounded where a length is given
   * (`bounded-text`, the Postgres family), or always bounded, 255 by default (`varchar`).
   */
  readonly stringSizing: 'text' | 'bounded-text' | 'varchar';
  /** Whether the engine has unsigned integers, so `@Field({ unsigned: true })` reaches the column. */
  readonly supportsUnsigned: boolean;
  /**
   * Whether the engine has `DECLARE`/`FETCH FORWARD`/`CLOSE` cursors, which a querier with no stream of
   * its own pages a read through (`querier/cursorStream.ts`) instead of reading it whole. The engine's
   * answer, not the driver's: node-`pg` streams on its own and keeps doing so.
   */
  readonly serverSideCursors: boolean;
  /**
   * Whether an `UPDATE` or `DELETE` can read a relation in its filter. False on MongoDB, whose filter
   * hosts no lookup, and on Turso's engine, which cannot resolve the written table inside a subquery:
   * such a write reads the ids of the rows it names first.
   */
  readonly correlatedWrites: boolean;
  /**
   * What the engine's row locks can do, or `false` where it has none: the SQLite family locks the
   * database and MongoDB has no row lock at all, so both refuse `$lock` rather than ignoring it. One
   * value rather than a flag each, since the details mean nothing without a lock.
   */
  readonly rowLocks: RowLockFeatures | false;
}

/** How a dialect spells a row lock, once {@link DialectFeatures.rowLocks} says it has one. */
export interface RowLockFeatures {
  /** Whether a lock can be narrowed to one table of a join, `FOR UPDATE OF`, which MariaDB lacks. */
  readonly of: boolean;
  /** Whether the lock may share a statement with a window function, which the Postgres family refuses. */
  readonly withWindow: boolean;
  /**
   * Where the lock is spelled: after the statement (`FOR UPDATE`), or as a hint on the table it reads
   * (`WITH (UPDLOCK)`, SQL Server). A dialect's `lockHint` states the hint itself.
   */
  readonly placement: 'suffix' | 'tableHint';
}

/** What a SQL engine can do beyond {@link DialectFeatures}, read where a statement is built. */
export interface SqlDialectFeatures extends DialectFeatures {
  /**
   * How a `$sort` states where nulls land: the `NULLS FIRST/LAST` clause, a leading `IS NULL` term
   * (MySQL, MariaDB), or a leading `CASE` (SQL Server, which has no orderable boolean).
   */
  readonly nullsOrdering: 'clause' | 'expression' | 'case';
  /**
   * Whether a fulltext index's heavier column needs a fulltext index of its own to be scored by, as
   * MySQL's `MATCH` does, which reads only an index over exactly its columns.
   */
  readonly textScoreIndexes: boolean;
  /** Whether a multi-row upsert's `RETURNING` lists its rows in payload order; where not, the ids are read back. */
  readonly orderedUpsertReturning: boolean;
  /** Whether a JSON aggregate takes an `ORDER BY` of its own; where not, a relation's rows keep their derived table's order. */
  readonly orderedJsonAggregates: boolean;
  /** Whether the engine has pgvector's `halfvec` and `sparsevec`; elsewhere both map onto `vector`. */
  readonly narrowVectorTypes: boolean;
  /** Whether an ANN index's tuning `SET` applies only inside a transaction, as `SET LOCAL` does. */
  readonly vectorTuningNeedsTransaction: boolean;
  /** Whether the serial column type states `PRIMARY KEY` itself, as SQLite's `AUTOINCREMENT` must. */
  readonly serialDeclaresPrimaryKey: boolean;
  /** How the engine spells a trigger. One value rather than a flag each, as {@link rowLocks} is. */
  readonly triggers: TriggerFeatures;
}

/**
 * What a trigger body calls the rows it reads. Row-based engines hand it a record on each side; SQL
 * Server hands it the two tables of the set it touched.
 */
export type TriggerRowName = 'NEW' | 'OLD' | 'inserted' | 'deleted';

/** How a dialect spells a trigger, once {@link SqlDialectFeatures.triggers} names its shape. */
export interface TriggerFeatures {
  /**
   * Where the body lives: a function of its own that the trigger names (the Postgres family), or inside
   * the `CREATE TRIGGER` itself (everywhere else).
   */
  readonly body: 'function' | 'inline';
  /**
   * How it states which rows it fires for: `UPDATE OF` beside a `WHEN` (`'clause'`), or, where there is
   * no usable `WHEN` - the MySQL family, CockroachDB, SQL Server - the same condition wrapping the body,
   * as `IF c THEN ... END IF;` (`'thenEndIf'`) or T-SQL's `IF c BEGIN ... END` (`'beginEnd'`).
   */
  readonly guards: 'clause' | 'thenEndIf' | 'beginEnd';
  /**
   * Whether it fires once per row, with a row on each side, or once per statement over the set it
   * touched. SQL Server is the only one here that is set-based, reading `inserted` and `deleted`.
   */
  readonly rows: 'row' | 'set';
  /**
   * Where a trigger's name is unique, and so what a `DROP` has to name: per table on the Postgres
   * family, which spells `DROP TRIGGER x ON t`, and per schema everywhere else, which spells
   * `DROP TRIGGER x`. Two tables may carry the same trigger name only under `'table'`.
   */
  readonly scope: 'table' | 'schema';
  /**
   * Where the table sits in the statement: after the timing, `BEFORE UPDATE ON t`, or ahead of it and
   * behind an `AS`, `ON t AFTER UPDATE AS` - which is T-SQL's shape and nobody else's.
   */
  readonly layout: 'timingFirst' | 'tableFirst';
  /**
   * What every body opens with, or `''`. T-SQL wants `SET NOCOUNT ON`: a trigger running its own DML
   * otherwise sends a rowcount of its own back, and the client reads that as what the original statement
   * affected. Nothing else here needs a preamble.
   */
  readonly preamble: string;
  /**
   * Whether a body may assign to the row it was handed, `NEW."col" := ...`. SQLite forbids writing `NEW`
   * at all, and SQL Server is handed a set rather than a row, so on both a trigger that fills a column
   * has to restate the row as an `UPDATE` after the write instead.
   */
  readonly assignsRow: boolean;
  /**
   * Whether it can fire before the write, which is what a stamp needs. SQL Server has only `AFTER` and
   * `INSTEAD OF`, and `INSTEAD OF` would make the trigger responsible for performing the write itself,
   * so a `before*` event is refused there rather than silently made to mean something else.
   */
  readonly before: boolean;
}

/** Where DDL's SQL sits: the row a trigger's predicate reads, as its prefix, and a set-based body's rows. */
export type DdlRenderOptions = Pick<QueryComparisonOptions, 'escapedPrefix' | 'operand'> &
  Pick<QueryRawRenderOptions, 'rows'>;

/**
 * A write a trigger's body runs, as `insertInto`, `updateTable` and `deleteFrom` state it. Held untyped
 * here, past those helpers' typing, since the dialect renders it by the entity's metadata alone.
 */
export type TriggerWrite = { readonly entity: Type<object> } & (
  | { readonly kind: 'insert'; readonly row: Readonly<Record<string, unknown>> }
  | {
      readonly kind: 'update';
      readonly set: Readonly<Record<string, unknown>>;
      readonly where: EntityPredicate<object>;
    }
  | { readonly kind: 'delete'; readonly where: EntityPredicate<object> }
);

/**
 * What a SQL statement is rendered through, as a `raw` callback and a query context see it:
 * `AbstractSqlDialect` is the one implementation.
 */
export interface SqlQueryDialect {
  /**
   * The SQL dialect name.
   */
  readonly dialectName: SqlDialectName;
  /**
   * The engine whose SQL this one also accepts, which is itself unless it is a fork: CockroachDB runs
   * Postgres's PL/pgSQL and MariaDB runs MySQL's. What lets a body, or any other hand-written SQL, be
   * declared once for a family rather than copied per member.
   */
  readonly dialectFamily: SqlDialectName;

  /**
   * the escape character for identifiers.
   */
  readonly escapeIdChar: '"' | '`';

  /** What the engine can do. */
  readonly features: SqlDialectFeatures;

  /** A read; with `totalAlias`, every row also carries the unpaged match count under that alias. */
  find<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, opts?: QueryRenderOptions, totalAlias?: string): void;

  /** A count of the records matching the filter, or of those a page of it takes. */
  count<E>(ctx: QueryContext, entity: Type<E>, q: QueryPage<E>, opts?: QueryRenderOptions): void;

  /** An insert of one record or many. */
  insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryRenderOptions): void;

  /** An update of the records the query matches. */
  update<E>(
    ctx: QueryContext,
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryRenderOptions,
  ): void;

  /** An upsert of one record or many by their conflict paths. */
  upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void;

  /** A write in a trigger's body; `rows` is where a set-based engine's body reads its rows from. */
  triggerWrite(ctx: QueryContext, write: TriggerWrite, rows?: string): void;

  /** A delete of the records the query matches, a soft delete where the entity has one. */
  delete<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts?: QueryRenderOptions): void;

  /**
   * escape an identifier.
   * @param val the value to be escaped
   * @param forbidQualified don't escape dots
   * @param addDot use a dot as suffix
   */
  escapeId(val: string | undefined, forbidQualified?: boolean, addDot?: boolean): string;

  /**
   * escape a value.
   * @param val the value to escape
   */
  escape(val: unknown): string;

  /**
   * The SQL `value` takes in `ctx`: a raw expression rendered in place, the literal where `ctx` inlines
   * values, and otherwise a placeholder for the value bound.
   */
  addValue(ctx: QueryContext, value: unknown): string;

  /**
   * normalizes a value according to the dialect.
   * @param value the value to normalize
   */
  normalizeValue(value: unknown): unknown;

  /**
   * create a new query context.
   */
  createContext(options?: QueryContextOptions): QueryContext;

  /**
   * The column a field of `meta` is stored in, named the way this dialect names columns.
   */
  columnOf<E>(meta: EntityMeta<E>, key: string): string;

  /**
   * Build an aggregate query.
   */
  aggregate<E, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryRenderOptions,
  ): void;

  /**
   * Get the placeholder for a parameter at the given index (1-based).
   * Default: '?' for MySQL/MariaDB/SQLite, '$n' for PostgreSQL.
   */
  placeholder(index: number): string;

  /**
   * A relation aggregate as a correlated subquery, correlated to the row under `prefix`: what a field
   * declaring `computed: (user) => user.resources.count()` renders as, wherever a clause names it.
   */
  appendRelationAggregate<E>(
    ctx: QueryContext,
    entity: Type<E>,
    aggregate: RelationAggregateSpec,
    prefix: string,
  ): void;
}

/**
 * The aggregates a relation reads, spelled as the query language spells them, so a `computed` field, an
 * aggregate query and MongoDB's own `$group` all name one the same way. `$count` and `$sum` are the two
 * a row change turns into a delta.
 */
export type RelationAggregateOp = QueryAggregateOp;

/**
 * One aggregate as every renderer reads it: its op, the field it reads - none counts the rows - and the
 * rows it reads, where not all of them. A statement's `$select` entry and a relation aggregate are each
 * this, beside what names the rows they aggregate over.
 */
export type AggregateCall<E = object> = {
  readonly op: QueryAggregateOp;
  readonly field?: string;
  readonly where?: QueryWhere<E>;
};

/** What a relation aggregate reads: how many rows, or one of the target's columns, or its distance to `search`. */
export type RelationAggregateProjection =
  | { readonly op: '$count'; readonly field?: never; readonly search?: never }
  | {
      readonly op: Exclude<RelationAggregateOp, '$count'>;
      readonly field: string;
      readonly search?: QueryVectorQuery;
    };

/**
 * A relation aggregate as a `computed` field holds it: an {@link AggregateCall} over the rows of the
 * relation it names, capped where it declared a page.
 */
export type RelationAggregateSpec = RelationAggregateProjection &
  Pick<AggregateCall, 'where'> & {
    readonly relation: string;
    readonly page?: RelationAggregatePage;
  };

/** The page of a relation's rows an aggregate reads, and the order picking them. */
export type RelationAggregatePage = Pick<RelationQuery, '$sort' | '$limit' | '$skip'>;

/**
 * Supported SQL dialect identifiers.
 */
export type SqlDialectName = 'postgres' | 'cockroachdb' | 'mysql' | 'mariadb' | 'sqlite' | 'mssql';

/**
 * An index capability some engines lack, named in the words an error reports it in. Introspectors use
 * the same vocabulary for what they can read back, a separate set: MySQL emits an expression index it
 * cannot describe again. The engines behind each are in the index guide.
 */
export const INDEX_FEATURE_LABELS = {
  expression: 'expression indexes',
  partial: 'partial indexes',
  prefixLength: 'index prefix lengths',
  nullsOrder: 'NULLS FIRST/LAST in an index',
  opsClass: 'index operator classes',
  include: 'covering indexes (INCLUDE)',
  jsonPath: 'indexes over a path inside a JSON column',
  jsonArray: 'multi-valued indexes over a JSON array',
} as const;

/** Derived from the labels, so a feature cannot be added without the words an error reports it in. */
export type IndexFeature = keyof typeof INDEX_FEATURE_LABELS;
