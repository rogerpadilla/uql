import type { NamingStrategy } from './namingStrategy.js';
import type { Dialect } from './querier.js';
import type { QuerierPool } from './querierPool.js';
import type { Type } from './utility.js';

/**
 * Configuration options for the UQL ORM and Migrator.
 */
export interface Config {
  /**
   * The connection pool used to interact with the database.
   * This is required for both the application and the migrations CLI.
   */
  pool: QuerierPool;

  /**
   * List of entity classes to be managed by the ORM.
   * If not provided, UQL will attempt to infer them from the `@Entity` decorators if `emitDecoratorMetadata` is enabled.
   */
  entities?: Type<unknown>[];

  /**
   * The directory where migration files are stored.
   * @default './migrations'
   */
  migrationsPath?: string;

  /**
   * The name of the table used to track executed migrations in the database.
   * @default 'uql_migrations'
   */
  tableName?: string;

  /**
   * The SQL dialect to be used (e.g., 'postgres', 'mysql', 'sqlite').
   * If not provided, it is inferred from the `pool` instance.
   */
  dialect?: Dialect;

  /**
   * The naming strategy for mapping class/property names to database table/column names.
   * @default DefaultNamingStrategy (camelCase -> camelCase)
   */
  namingStrategy?: NamingStrategy;
}
