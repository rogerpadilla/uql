import type { Db } from 'mongodb';
import type { AbstractSqlDialect } from '../dialect/index.js';
import type { HookEvent, IdValue, UpdatePayload } from './entity.js';
import type { LoggingOptions } from './logger.js';
import type { NamingStrategy } from './namingStrategy.js';
import type {
  Query,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryFindResult,
  QueryOne,
  QueryOptions,
  QuerySearch,
  QueryUpdateResult,
  SqlDialectName,
} from './query.js';
import type { UniversalQuerier } from './universalQuerier.js';
import type { Type } from './utility.js';

/**
 * Isolation levels for transactions.
 */
export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

/**
 * Options for starting a transaction.
 */
export type TransactionOptions = {
  readonly isolationLevel?: IsolationLevel;
};

// Re-export SqlDialect for backwards compatibility
export type { SqlDialectName };

export type DialectName = SqlDialectName | 'mongodb';

export interface Querier extends UniversalQuerier {
  findOneById<E extends object>(
    entity: Type<E>,
    id: IdValue<E>,
    q?: QueryOne<E>,
    opts?: QueryOptions,
  ): Promise<E | undefined>;

  /**
   * Find one record. Supports both entity-as-argument and entity-as-field patterns.
   */
  findOne<E extends object, const Q extends QueryOne<E>>(
    entity: Type<E>,
    q: Q,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, Q> | undefined>;
  findOne<E extends object, const Q extends QueryOne<E> & { $entity: Type<E> }>(
    q: Q,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, Q> | undefined>;

  /**
   * Find many records. Supports both entity-as-argument and entity-as-field patterns.
   */
  findMany<E extends object, const Q extends Query<E>>(
    entity: Type<E>,
    q: Q,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, Q>[]>;
  findMany<E extends object, const Q extends Query<E> & { $entity: Type<E> }>(
    q: Q,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, Q>[]>;

  /**
   * Stream records as an async iterable. Supports both patterns.
   * Does not fill relations or fire lifecycle hooks.
   */
  findManyStream<E extends object, const Q extends Query<E>>(
    entity: Type<E>,
    q: Q,
    opts?: QueryOptions,
  ): AsyncIterable<QueryFindResult<E, Q>>;
  findManyStream<E extends object, const Q extends Query<E> & { $entity: Type<E> }>(
    q: Q,
    opts?: QueryOptions,
  ): AsyncIterable<QueryFindResult<E, Q>>;

  /**
   * Find many records and count. Supports both patterns.
   */
  findManyAndCount<E extends object, const Q extends Query<E>>(
    entity: Type<E>,
    q: Q,
    opts?: QueryOptions,
  ): Promise<[QueryFindResult<E, Q>[], number]>;
  findManyAndCount<E extends object, const Q extends Query<E> & { $entity: Type<E> }>(
    q: Q,
    opts?: QueryOptions,
  ): Promise<[QueryFindResult<E, Q>[], number]>;

  /**
   * Count records. Supports both patterns.
   */
  count<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
  count<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;

  /**
   * Insert a single record and return its ID (provided, `onInsert`-generated, or
   * database-generated - see {@link Querier.insertMany} for the exact semantics).
   */
  insertOne<E extends object>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  /**
   * Insert multiple records in a single statement (auto-chunked when the batch exceeds the
   * dialect's bind-parameter limit) and return their IDs in payload order.
   *
   * Provided IDs and client-generated ones (`@Id({ onInsert })`) are always returned as-is.
   * Database-generated IDs are exact on `'returning'` dialects (Postgres, MariaDB, MongoDB);
   * on MySQL/SQLite they are inferred from the driver header, which is only reliable for
   * auto-increment keys in batches without explicit IDs - otherwise those entries are
   * `undefined` rather than potentially wrong values.
   */
  insertMany<E extends object>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  updateOneById<E extends object>(
    entity: Type<E>,
    id: IdValue<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): Promise<number>;

  updateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): Promise<number>;

  /**
   * Restore soft-deleted records (sets the soft-delete field back to `null`). Throws if the
   * entity has no soft-delete field.
   */
  restoreOneById<E extends object>(entity: Type<E>, id: IdValue<E>): Promise<number>;
  restoreMany<E extends object>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;

  upsertOne<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E,
  ): Promise<QueryUpdateResult>;

  upsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E[],
  ): Promise<QueryUpdateResult>;

  saveOne<E extends object>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  saveMany<E extends object>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  deleteOneById<E extends object>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions): Promise<number>;

  /**
   * Delete many records (soft-deletes when the entity has a soft-delete field, else removes them).
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
  deleteMany<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;

  /**
   * Run an aggregate query (GROUP BY with aggregate functions).
   */
  aggregate<E extends object, const Q extends QueryAggregate<E>>(
    entity: Type<E>,
    q: Q,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, Q['$group']>[]>;

  /**
   * whether this querier is in a transaction or not.
   */
  readonly hasOpenTransaction: boolean;

  /**
   * run the given callback inside a transaction in this querier.
   */
  transaction<T>(callback: () => Promise<T>, opts?: TransactionOptions): Promise<T>;

  /**
   * starts a new transaction in this querier.
   */
  beginTransaction(opts?: TransactionOptions): Promise<void>;

  /**
   * commits the currently active transaction in this querier.
   */
  commitTransaction(): Promise<void>;

  /**
   * aborts the currently active transaction in this querier.
   */
  rollbackTransaction(): Promise<void>;

  /**
   * release the querier to the pool.
   */
  release(): Promise<void>;
}

export interface SqlQuerier extends Querier {
  /**
   * The SQL dialect
   */
  readonly dialect: AbstractSqlDialect;

  /**
   * Execute a raw SQL query and return results
   */
  all<T>(query: string, values?: unknown[]): Promise<T[]>;

  /**
   * Execute a raw SQL command (INSERT, UPDATE, DELETE, DDL)
   */
  run(query: string, values?: unknown[]): Promise<QueryUpdateResult>;
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
    typeof q.dialect.quoteChar === 'string'
  );
}

/**
 * Extended querier interface for MongoDB execution.
 */
export interface MongoQuerier extends Querier {
  /**
   * The MongoDB database instance.
   */
  readonly db: Db;
}

/**
 * Configuration for slow query detection and logging.
 */
export type SlowQueryOptions = {
  /** Threshold in milliseconds - queries exceeding this are logged as slow. */
  readonly threshold: number;
  /** Whether to include query parameters in slow-query logs. Defaults to `true`. */
  readonly logParams?: boolean;
};

/**
 * Context passed to global querier listeners.
 */
export type ListenerContext<E extends object = object> = {
  readonly entity: Type<E>;
  readonly querier: Querier;
  readonly payloads: E[];
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
  readonly slowQuery?: SlowQueryOptions;
  readonly namingStrategy?: NamingStrategy;
  readonly listeners?: readonly QuerierListener[];
};
