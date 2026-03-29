import type { Db } from 'mongodb';
import type { HookEvent, IdValue, UpdatePayload } from './entity.js';
import type { LoggingOptions } from './logger.js';
import type { NamingStrategy } from './namingStrategy.js';
import type {
  Query,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryOne,
  QueryOptions,
  QuerySearch,
  QueryUpdateResult,
  SqlDialect,
  SqlQueryDialect,
} from './query.js';

import type { UniversalQuerier } from './universalQuerier.js';
import type { Type } from './utility.js';

/**
 * Query with $entity for entity-as-field pattern.
 */
export type QueryWithEntity<E extends object> = Query<E> & { $entity: Type<E> };
export type QueryOneWithEntity<E extends object> = QueryOne<E> & { $entity: Type<E> };
export type QuerySearchWithEntity<E extends object> = QuerySearch<E> & { $entity: Type<E> };

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
export type { SqlDialect };

export type Dialect = SqlDialect | 'mongodb';

export interface Querier extends UniversalQuerier {
  findOneById<E extends object>(entity: Type<E>, id: IdValue<E>, q?: QueryOne<E>): Promise<E | undefined>;

  /**
   * Find one record. Supports both entity-as-argument and entity-as-field patterns.
   * @example
   * // Entity as argument (classic)
   * querier.findOne(User, { $where: { id: 1 } })
   * // Entity as field (RPC-friendly)
   * querier.findOne({ $entity: User, $where: { id: 1 } })
   */
  findOne<E extends object>(entity: Type<E>, q: QueryOne<E>): Promise<E | undefined>;
  findOne<E extends object>(q: QueryOneWithEntity<E>): Promise<E | undefined>;

  /**
   * Find many records. Supports both entity-as-argument and entity-as-field patterns.
   */
  findMany<E extends object>(entity: Type<E>, q: Query<E>): Promise<E[]>;
  findMany<E extends object>(q: QueryWithEntity<E>): Promise<E[]>;

  /**
   * Stream records as an async iterable. Supports both patterns.
   * Does not fill relations or fire lifecycle hooks.
   */
  findManyStream<E extends object>(entity: Type<E>, q: Query<E>): AsyncIterable<E>;
  findManyStream<E extends object>(q: QueryWithEntity<E>): AsyncIterable<E>;

  /**
   * Find many records and count. Supports both patterns.
   */
  findManyAndCount<E extends object>(entity: Type<E>, q: Query<E>): Promise<[E[], number]>;
  findManyAndCount<E extends object>(q: QueryWithEntity<E>): Promise<[E[], number]>;

  /**
   * Count records. Supports both patterns.
   */
  count<E extends object>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;
  count<E extends object>(q: QuerySearchWithEntity<E>): Promise<number>;

  insertOne<E extends object>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  insertMany<E extends object>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  updateOneById<E extends object>(entity: Type<E>, id: IdValue<E>, payload: UpdatePayload<E>): Promise<number>;

  updateMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, payload: UpdatePayload<E>): Promise<number>;

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
   * Delete many records. Supports both entity-as-argument and entity-as-field patterns.
   */
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
  deleteMany<E extends object>(q: QuerySearchWithEntity<E>, opts?: QueryOptions): Promise<number>;

  /**
   * Run an aggregate query (GROUP BY with aggregate functions).
   */
  aggregate<E extends object, const Q extends QueryAggregate<E>>(
    entity: Type<E>,
    q: Q,
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

/**
 * Extended querier interface for raw SQL execution.
 * Implemented by AbstractSqlQuerier and all SQL-based queriers.
 */
export interface SqlQuerier extends Querier {
  /**
   * The SQL dialect (provides escapeIdChar and other dialect-specific info)
   */
  readonly dialect: SqlQueryDialect;

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
    typeof q.dialect.escapeIdChar === 'string'
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
  /** Threshold in milliseconds — queries exceeding this are logged as slow. */
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
