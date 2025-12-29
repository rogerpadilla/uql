import type { NamingStrategy, SqlDialect, SqlQuerier, SqlQueryDialect, Type } from 'nukak/type';

// Re-export from core for convenience
export type { NamingStrategy, SqlDialect, SqlQuerier, SqlQueryDialect };
export { isSqlQuerier } from 'nukak/type';

/**
 * Defines a migration using a simple object literal
 */
export interface MigrationDefinition {
  readonly name?: string;
  readonly up: (querier: SqlQuerier) => Promise<void>;
  readonly down: (querier: SqlQuerier) => Promise<void>;
}

/**
 * Represents a single database migration
 */
export interface Migration extends MigrationDefinition {
  /**
   * Unique name/identifier for this migration (typically timestamp + description)
   */
  readonly name: string;
}

/**
 * Storage backend for tracking which migrations have been executed
 */
export interface MigrationStorage {
  /**
   * Get list of already executed migration names
   */
  executed(): Promise<string[]>;

  /**
   * Mark a migration as executed (called within migration transaction)
   */
  logWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void>;

  /**
   * Remove a migration from the executed list (called within migration transaction)
   */
  unlogWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void>;

  /**
   * Ensure the storage is initialized (e.g., create migrations table)
   */
  ensureStorage(): Promise<void>;
}

/**
 * Configuration options for the Migrator
 */
export interface MigratorOptions {
  /**
   * Directory containing migration files
   */
  readonly migrationsPath?: string;

  /**
   * Custom storage implementation. Defaults to DatabaseMigrationStorage.
   */
  readonly storage?: MigrationStorage;

  /**
   * Table name for storing migration state. Defaults to 'nukak_migrations'.
   */
  readonly tableName?: string;

  /**
   * Logger function for migration output
   */
  readonly logger?: (message: string) => void;

  /**
   * Entities to use for schema generation
   */
  readonly entities?: Type<unknown>[];

  /**
   * Naming strategy for database tables and columns
   */
  readonly namingStrategy?: NamingStrategy;
}

/**
 * Result of a migration run
 */
export interface MigrationResult {
  readonly name: string;
  readonly direction: 'up' | 'down';
  readonly duration: number;
  readonly success: boolean;
  readonly error?: Error;
}

/**
 * Represents a column in a database table schema
 */
export interface ColumnSchema {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly defaultValue?: unknown;
  readonly isPrimaryKey: boolean;
  readonly isAutoIncrement: boolean;
  readonly isUnique: boolean;
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly comment?: string;
}

/**
 * Represents a database table schema
 */
export interface TableSchema {
  readonly name: string;
  readonly columns: ColumnSchema[];
  readonly primaryKey?: string[];
  readonly indexes?: IndexSchema[];
  readonly foreignKeys?: ForeignKeySchema[];
}

/**
 * Represents an index in a database table
 */
export interface IndexSchema {
  readonly name: string;
  readonly columns: string[];
  readonly unique: boolean;
}

/**
 * Represents a foreign key constraint
 */
export interface ForeignKeySchema {
  readonly name: string;
  readonly columns: string[];
  readonly referencedTable: string;
  readonly referencedColumns: string[];
  readonly onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  readonly onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

/**
 * Represents a difference between current and desired schema
 */
export interface SchemaDiff {
  readonly tableName: string;
  readonly type: 'create' | 'alter' | 'drop';
  readonly columnsToAdd?: ColumnSchema[];
  readonly columnsToAlter?: { from: ColumnSchema; to: ColumnSchema }[];
  readonly columnsToDrop?: string[];
  readonly indexesToAdd?: IndexSchema[];
  readonly indexesToDrop?: string[];
  readonly foreignKeysToAdd?: ForeignKeySchema[];
  readonly foreignKeysToDrop?: string[];
}

/**
 * Interface for generating DDL statements from entity metadata
 */
export interface SchemaGenerator {
  /**
   * Generate CREATE TABLE statement for an entity
   */
  generateCreateTable<E>(entity: Type<E>, options?: { ifNotExists?: boolean }): string;

  /**
   * Generate DROP TABLE statement for an entity
   */
  generateDropTable<E>(entity: Type<E>): string;

  /**
   * Generate ALTER TABLE statements based on schema diff
   */
  generateAlterTable(diff: SchemaDiff): string[];

  /**
   * Generate CREATE INDEX statement
   */
  generateCreateIndex(tableName: string, index: IndexSchema): string;

  /**
   * Generate DROP INDEX statement
   */
  generateDropIndex(tableName: string, indexName: string): string;

  /**
   * Get the SQL type for a field based on its options
   */
  getSqlType(fieldOptions: import('nukak/type').FieldOptions, fieldType?: unknown): string;
}

/**
 * Interface for introspecting the current database schema
 */
export interface SchemaIntrospector {
  /**
   * Get the schema of a specific table
   */
  getTableSchema(tableName: string): Promise<TableSchema | null>;

  /**
   * Get all table names in the database
   */
  getTableNames(): Promise<string[]>;

  /**
   * Check if a table exists
   */
  tableExists(tableName: string): Promise<boolean>;
}
