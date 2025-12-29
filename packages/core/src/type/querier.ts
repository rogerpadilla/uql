import type { Db } from 'mongodb';
import type { IdValue } from './entity.js';
import type { NamingStrategy } from './namingStrategy.js';
import type {
  Query,
  QueryConflictPaths,
  QueryOne,
  QueryOptions,
  QuerySearch,
  QueryUpdateResult,
  SqlQueryDialect,
} from './query.js';
import type { Repository } from './repository.js';
import type { UniversalQuerier } from './universalQuerier.js';
import type { Type } from './utility.js';

/**
 * Isolation levels for transactions.
 */
export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeteable read' | 'serializable';

/**
 * Supported SQL dialect identifiers.
 */
export type SqlDialect = 'postgres' | 'mysql' | 'mariadb' | 'sqlite';

export type Dialect = SqlDialect | 'mongodb';

export interface Querier extends UniversalQuerier {
  findOneById<E>(entity: Type<E>, id: IdValue<E>, q?: QueryOne<E>): Promise<E>;

  findOne<E>(entity: Type<E>, q: QueryOne<E>): Promise<E>;

  findMany<E>(entity: Type<E>, q: Query<E>): Promise<E[]>;

  findManyAndCount<E>(entity: Type<E>, q: Query<E>): Promise<[E[], number]>;

  count<E>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;

  insertOne<E>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  insertMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E): Promise<number>;

  updateMany<E>(entity: Type<E>, q: QuerySearch<E>, payload: E): Promise<number>;

  upsertOne<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): Promise<QueryUpdateResult>;

  saveOne<E>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  saveMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions): Promise<number>;

  deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;

  getRepository<E>(entity: Type<E>): Repository<E>;

  /**
   * whether this querier is in a transaction or not.
   */
  readonly hasOpenTransaction: boolean;

  /**
   * run the given callback inside a transaction in this querier.
   */
  transaction<T>(callback: () => Promise<T>): Promise<T>;

  /**
   * starts a new transaction in this querier.
   */
  beginTransaction(): Promise<void>;

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
 * logger function to debug queries.
 */
export type Logger = (message: unknown, ...args: unknown[]) => unknown;

export type ExtraOptions = {
  readonly logger?: Logger;
  readonly namingStrategy?: NamingStrategy;
};
