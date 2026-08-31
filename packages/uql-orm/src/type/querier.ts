import type { Db } from 'mongodb';
import type { AbstractSqlDialect } from '../dialect/index.js';
import type { SqlDialectName } from './dialect.js';
import type { FieldKey, HookEvent, RelationKey } from './entity.js';
import type { LoggingOptions } from './logger.js';
import type { NamingStrategy } from './namingStrategy.js';
import type {
  QueryFilter,
  QueryFindResult,
  QueryOneProjected,
  QueryOptions,
  QueryProjected,
  QuerySearch,
  QueryUpdateResult,
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
  /**
   * Applies to this transaction only.
   *
   * @remarks MySQL and MariaDB set it as a statement of its own ahead of `START TRANSACTION`, so a
   * `START TRANSACTION` that then fails leaves the level applied to whatever the pooled connection
   * runs next. Set it per transaction that needs it rather than relying on what a connection carries.
   */
  readonly isolationLevel?: IsolationLevel;
};

export type DialectName = SqlDialectName | 'mongodb';

/**
 * The read and delete methods below take the entity as an argument or as the query's `$entity` key.
 * In each pair the `$entity` overload comes **first** on purpose: when no overload matches,
 * TypeScript reports the error from the *last* one, so keeping the entity-argument form last is
 * what makes a typo'd query key report as itself rather than as a missing `$entity`.
 */
export interface Querier extends UniversalQuerier {
  /**
   * Find one record. Supports both entity-as-argument and entity-as-field patterns.
   */
  findOne<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(
    q: QueryOneProjected<E, S, V, X, P> & { $entity: Type<E> },
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P> | undefined>;
  findOne<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryOneProjected<E, S, V, X, P>,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P> | undefined>;

  /**
   * Find many records. Supports both entity-as-argument and entity-as-field patterns.
   */
  findMany<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(
    q: QueryProjected<E, S, V, X, P> & { $entity: Type<E> },
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P>[]>;
  findMany<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(entity: Type<E>, q: QueryProjected<E, S, V, X, P>, opts?: QueryOptions): Promise<QueryFindResult<E, S, V, X, P>[]>;

  /**
   * Stream records as an async iterable. Supports both patterns.
   * Does not fill relations or fire lifecycle hooks.
   */
  findManyStream<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(
    q: QueryProjected<E, S, V, X, P> & { $entity: Type<E> },
    opts?: QueryOptions,
  ): AsyncIterable<QueryFindResult<E, S, V, X, P>>;
  findManyStream<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P>,
    opts?: QueryOptions,
  ): AsyncIterable<QueryFindResult<E, S, V, X, P>>;

  /**
   * Find many records and count. Supports both patterns.
   */
  findManyAndCount<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(
    q: QueryProjected<E, S, V, X, P> & { $entity: Type<E> },
    opts?: QueryOptions,
  ): Promise<[QueryFindResult<E, S, V, X, P>[], number]>;
  findManyAndCount<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P>,
    opts?: QueryOptions,
  ): Promise<[QueryFindResult<E, S, V, X, P>[], number]>;

  /**
   * Count records. Supports both patterns.
   */
  count<E extends object>(q: QueryFilter<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  count<E extends object>(entity: Type<E>, q?: QueryFilter<E>, opts?: QueryOptions): Promise<number>;

  /**
   * Delete many records (soft-deletes when the entity has a soft-delete field, else removes them).
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  deleteMany<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;

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
  /**
   * Default schema (in MySQL terms, database) for entities naming none; unset leaves them
   * unqualified. `@Entity({ schema })` overrides it.
   */
  readonly schema?: string;
  readonly listeners?: readonly QuerierListener[];
};
