import type { Db } from 'mongodb';
import type { AbstractSqlDialect } from '../dialect/index.js';
import type { SqlDialectName } from './dialect.js';
import type { HookEvent } from './entity.js';
import type { LoggingOptions } from './logger.js';
import type { NamingStrategy } from './namingStrategy.js';
import type { Query, QueryOne, QueryOptions, QuerySearch, QueryUpdateResult } from './query.js';
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

export type DialectName = SqlDialectName | 'mongodb';

export interface Querier extends UniversalQuerier {
  /**
   * Find one record. Supports both entity-as-argument and entity-as-field patterns.
   */
  findOne<E extends object>(entity: Type<E>, q: QueryOne<E>, opts?: QueryOptions): Promise<E | undefined>;
  findOne<E extends object>(q: QueryOne<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<E | undefined>;

  /**
   * Find many records. Supports both entity-as-argument and entity-as-field patterns.
   */
  findMany<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): Promise<E[]>;
  findMany<E extends object>(q: Query<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<E[]>;

  /**
   * Stream records as an async iterable. Supports both patterns.
   * Does not fill relations or fire lifecycle hooks.
   */
  findManyStream<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): AsyncIterable<E>;
  findManyStream<E extends object>(q: Query<E> & { $entity: Type<E> }, opts?: QueryOptions): AsyncIterable<E>;

  /**
   * Find many records and count. Supports both patterns.
   */
  findManyAndCount<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): Promise<[E[], number]>;
  findManyAndCount<E extends object>(q: Query<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<[E[], number]>;

  /**
   * Count records. Supports both patterns.
   */
  count<E extends object>(entity: Type<E>, q?: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
  count<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;

  /**
   * Delete many records (soft-deletes when the entity has a soft-delete field, else removes them).
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
  deleteMany<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;

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
  /**
   * Whether logged queries include bound values (`logQuery` and slow-query logging alike).
   * Defaults to `false` - logs carry SQL text only, never parameter values, since those may
   * contain PII or other sensitive data. Set to `true` to opt in to logging bound values too.
   */
  readonly logValues?: boolean;
  /** Threshold in milliseconds - queries exceeding this are logged as slow. */
  readonly slowQuery?: number;
  readonly namingStrategy?: NamingStrategy;
  readonly listeners?: readonly QuerierListener[];
};
