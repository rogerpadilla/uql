import type { AbstractSqlDialect } from '../dialect/index.js';
import type { SqlDialectName } from './dialect.js';
import type { FieldKey, HookEvent, RelationKey } from './entity.js';
import type { LoggingOptions } from './logger.js';
import type { NamingStrategy } from './namingStrategy.js';
import type {
  QueryFilter,
  QueryFindResult,
  QueryOptions,
  QueryPage,
  QuerySearch,
  QueryUpdateResult,
  ReturningResult,
  WriteOptions,
} from './query.js';
import type { SqlStatement } from './querySql.js';
import type { ProjectedQuery, ProjectedRead, ProjectedResult, UniversalQuerier } from './universalQuerier.js';
import type { BooleanLike, RawRow, Type } from './utility.js';
import type { QuerierSql } from './wire.js';

/**
 * Isolation levels for transactions.
 */
export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

/**
 * Options for starting a transaction.
 */
export type TransactionOptions = {
  /**
   * Applies to this transaction only. The MySQL family sets it ahead of `START TRANSACTION`, where a
   * failed start leaves it on the connection: set it per transaction that needs it.
   */
  readonly isolationLevel?: IsolationLevel;
};

export type DialectName = SqlDialectName | 'mongodb';

/**
 * A projected read that takes the entity first or as the query's `$entity`. The `$entity` form comes
 * **first** on purpose: when no signature matches, TypeScript reports the error of the *last* one, so a
 * typo'd query key is reported as itself rather than as a missing `$entity`.
 */
type DualRead<
  Q extends keyof ProjectedQuery<object, never, never, never, never, never, never>,
  R extends keyof ProjectedResult<'server', unknown>,
> = (<
  E extends object,
  const S extends FieldKey<E> = never,
  const V = true,
  const X extends FieldKey<E> = never,
  const P extends RelationKey<E> = never,
  const C extends RelationKey<E> = never,
>(
  q: ProjectedQuery<E, S, V, X, P, C, QuerierSql<'server'>>[Q] & { $entity: Type<E> },
  opts?: QueryOptions,
) => ProjectedResult<'server', QueryFindResult<E, S, V, X, P, C>>[R]) &
  ProjectedRead<Q, R, 'server', QueryOptions>;

/** The reads, counts and deletes below take the entity first or as the query's `$entity`, as {@link DualRead} does. */
export interface Querier extends UniversalQuerier {
  findOne: DualRead<'one', 'one'>;

  findMany: DualRead<'many', 'many'>;

  /** Stream records with the relations and counts `findMany` reads, `afterLoad` on each. The querier runs nothing else until the loop ends. */
  findManyStream: DualRead<'many', 'stream'>;

  /** Find many records and count every match. */
  findManyAndCount: DualRead<'many', 'counted'>;

  /** Read a page of records from a cursor. */
  findManyPage: DualRead<'page', 'page'>;

  /** Count records, the entity passed first or as the query's `$entity`. */
  count<E extends object>(q: QueryPage<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  count<E extends object>(entity: Type<E>, q?: QueryPage<E>, opts?: QueryOptions): Promise<number>;

  /** Whether anything matches, the entity passed first or as the query's `$entity`. */
  exists<E extends object>(q: QueryFilter<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<boolean>;
  exists<E extends object>(entity: Type<E>, q?: QueryFilter<E>, opts?: QueryOptions): Promise<boolean>;

  /** Delete many records, the entity passed first or as `$entity`; soft-deletes where the entity has a soft-delete field. */
  deleteMany<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  deleteMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, number, QueryFindResult<E, S, V>[]>>;

  /**
   * whether this querier is in a transaction or not.
   */
  readonly hasOpenTransaction: boolean;

  /**
   * Runs `callback` in a transaction. Inside one this flow already runs, it is a savepoint, whose failure
   * undoes its own writes alone; a transaction another flow holds on this connection is waited for.
   */
  transaction<T>(callback: () => Promise<T>, opts?: TransactionOptions): Promise<T>;

  /**
   * Runs `callback` once the outermost transaction this flow is in commits, never if it rolls back; at
   * once outside a transaction. For side effects a rollback cannot take back: a mail, a queued job.
   */
  onCommit(callback: () => unknown): Promise<void>;

  /**
   * starts a new transaction in this querier.
   */
  beginTransaction(opts?: TransactionOptions): Promise<void>;

  /**
   * commits the currently active transaction in this querier.
   */
  commitTransaction(): Promise<void>;

  /**
   * aborts the currently active transaction, or does nothing when there is none, so it is safe from a
   * `catch` / `finally` without checking {@link hasOpenTransaction} first. `commitTransaction` is strict
   * instead: a caller who believes their work was committed has to hear that it was not.
   */
  rollbackTransaction(): Promise<void>;

  /**
   * rolls back any unfinished transaction and releases the querier to the pool. A pooled querier is
   * finished afterwards: using it again throws rather than taking a second connection nothing owns.
   */
  release(): Promise<void>;

  /**
   * Releases the querier when an `await using` binding goes out of scope, so a unit of work cannot
   * leak a connection on an early return or a throw.
   * @example `await using querier = await pool.getQuerier();`
   */
  [Symbol.asyncDispose](): Promise<void>;
}

export interface SqlQuerier extends Querier {
  /**
   * The SQL dialect
   */
  readonly dialect: AbstractSqlDialect;

  /**
   * The rows a statement answers, written as a tag, `all<Row>`SELECT ... WHERE id = ${id}``, each interpolated
   * value bound, never spliced; or a `sql` built apart.
   */
  all<T extends object = RawRow>(...statement: SqlStatement): Promise<T[]>;

  /** Runs a statement (INSERT, UPDATE, DELETE, DDL), written as a tag or a `sql`, each interpolated value bound. */
  run(...statement: SqlStatement): Promise<QueryUpdateResult>;
}

/**
 * Type guard to check if a querier supports raw SQL execution
 */
export function isSqlQuerier(querier: Querier): querier is SqlQuerier {
  const q = querier as SqlQuerier;
  return (
    typeof q.all === 'function' &&
    typeof q.run === 'function' &&
    q.dialect !== undefined &&
    typeof q.dialect.escapeIdChar === 'string'
  );
}

/**
 * Context passed to global querier listeners.
 */
export type ListenerContext<E extends object = object> = {
  readonly entity: Type<E>;
  readonly querier: Querier;
  readonly payloads: readonly E[];
  readonly event: HookEvent;
};

/**
 * Global lifecycle listener for cross-cutting concerns (audit logging, timestamps, etc.).
 * Registered on QuerierPool options, fired before entity-level hooks.
 */
export type QuerierListener = {
  readonly [K in HookEvent]?: (ctx: ListenerContext) => Promise<void> | void;
};

export type ExtraOptions = {
  readonly logger?: LoggingOptions;
  /**
   * Whether logged queries include bound values (`logQuery` and slow-query logging alike).
   * Defaults to `false` - logs carry SQL text only, never parameter values, since those may
   * contain PII or other sensitive data. Set to `true` to opt in to logging bound values too.
   */
  readonly logValues?: boolean;
  /** Threshold in milliseconds - queries exceeding this are logged as slow. */
  readonly slowQuery?: number;
  readonly namingStrategy?: NamingStrategy;
  /**
   * Default schema (in MySQL terms, database) for entities naming none; unset leaves them
   * unqualified. `@Entity({ schema })` overrides it.
   */
  readonly schema?: string;
  readonly listeners?: readonly QuerierListener[];
};
