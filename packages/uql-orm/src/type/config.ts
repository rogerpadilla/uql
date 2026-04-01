import type { AbstractDialect } from '../dialect/abstractDialect.js';
import type { ForeignKeyAction } from '../schema/types.js';
import type { NamingStrategy } from './namingStrategy.js';
import type { Querier } from './querier.js';
import type { QuerierPool } from './querierPool.js';
import type { Type } from './utility.js';

/**
 * Configuration options for the UQL ORM and Migrator.
 */
export interface Config {
  /**
   * The connection pool used to interact with the database.
   * This is required for both the application and the migrations CLI.
   * Must expose {@link QuerierPool.dialect}; migrations and the CLI read `pool.dialect.dialectName`.
   */
  pool: QuerierPool<Querier, AbstractDialect>;

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
   * The naming strategy for mapping class/property names to database table/column names.
   * @default DefaultNamingStrategy (camelCase -> camelCase)
   */
  namingStrategy?: NamingStrategy;
  /**
   * Default action for foreign key ON DELETE and ON UPDATE clauses.
   * @default 'NO ACTION'
   */
  defaultForeignKeyAction?: ForeignKeyAction;
}
