import type { FullColumnDefinition, TableDefinition, TableForeignKeyDefinition } from '../migrate/builder/types.js';
import type { SchemaAST } from '../schema/schemaAST.js';
import type { ForeignKeyAction, IndexNode, TableNode } from '../schema/types.js';
import type { Dialect, EntityMeta, FieldOptions, LoggingOptions, NamingStrategy, SqlQuerier, Type } from './index.js';

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
   * The database dialect. Defaults to 'postgres'.
   */
  readonly dialect?: Dialect;

  /**
   * Directory containing migration files. Defaults to './migrations'.
   */
  readonly migrationsPath?: string;

  /**
   * Custom storage implementation. Defaults to DatabaseMigrationStorage.
   */
  readonly storage?: MigrationStorage;

  /**
   * Table name for storing migration state. Defaults to 'uql_migrations'.
   */
  readonly tableName?: string;

  /**
   * Logger function or options for migration output
   */
  readonly logger?: LoggingOptions;

  /**
   * Threshold in milliseconds to log slow queries during migrations
   */
  readonly slowQueryThreshold?: number;

  /**
   * Entities to use for schema generation
   */
  readonly entities?: Type<unknown>[];

  /**
   * Naming strategy for database tables and columns
   */
  readonly namingStrategy?: NamingStrategy;

  /**
   * Default action for foreign key ON DELETE and ON UPDATE clauses.
   */
  readonly defaultForeignKeyAction?: ForeignKeyAction;

  /**
   * Custom schema generator for DDL operations.
   * If not provided, it will be inferred from the dialect.
   */
  readonly schemaGenerator?: SchemaGenerator;
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
   * Generate rollback (down) statements for ALTER TABLE based on schema diff
   */
  generateAlterTableDown(diff: SchemaDiff): string[];

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
  getSqlType(fieldOptions: FieldOptions, fieldType?: unknown): string;

  /**
   * Compare an entity with a database table node and return the differences.
   */
  diffSchema<E>(entity: Type<E>, currentTable: TableNode | undefined): SchemaDiff | undefined;

  /**
   * Resolve table name using entity and naming strategy
   */
  resolveTableName<E>(entity: Type<E>, meta: EntityMeta<E>): string;

  /**
   * Resolve column name using field options and naming strategy
   */
  resolveColumnName(key: string, field: FieldOptions): string;

  // === SchemaAST / TableNode Support ===
  /** Generate CREATE TABLE statement from a TableNode */
  generateCreateTableFromNode(table: TableNode, options?: { ifNotExists?: boolean }): string;
  /** Generate CREATE INDEX statement from an IndexNode */
  generateCreateIndexFromNode(index: IndexNode, options?: { ifNotExists?: boolean }): string;
  /** Generate DROP TABLE statement from a TableNode */
  generateDropTableFromNode(table: TableNode, options?: { ifExists?: boolean }): string;

  // === Migration Builder Support ===
  /** Generate CREATE TABLE statement from a TableDefinition */
  generateCreateTableFromDefinition(table: TableDefinition, options?: { ifNotExists?: boolean }): string;
  /** Generate DROP TABLE statement */
  generateDropTableSql(tableName: string, options?: { ifExists?: boolean; cascade?: boolean }): string;
  /** Generate RENAME TABLE statement */
  generateRenameTableSql(oldName: string, newName: string): string;
  /** Generate ADD COLUMN statement */
  generateAddColumnSql(tableName: string, column: FullColumnDefinition): string;
  /** Generate ALTER COLUMN statement */
  generateAlterColumnSql(tableName: string, columnName: string, column: FullColumnDefinition): string;
  /** Generate DROP COLUMN statement */
  generateDropColumnSql(tableName: string, columnName: string): string;
  /** Generate RENAME COLUMN statement */
  generateRenameColumnSql(tableName: string, oldName: string, newName: string): string;
  /** Generate CREATE INDEX statement from IndexSchema */
  generateCreateIndexSql(tableName: string, index: IndexSchema): string;
  /** Generate DROP INDEX statement */
  generateDropIndexSql(tableName: string, indexName: string): string;
  /** Generate ADD FOREIGN KEY statement */
  generateAddForeignKeySql(tableName: string, foreignKey: TableForeignKeyDefinition): string;
  /** Generate DROP FOREIGN KEY statement */
  generateDropForeignKeySql(tableName: string, constraintName: string): string;
}

/**
 * Interface for introspecting the current database schema
 */
export interface SchemaIntrospector {
  /**
   * Introspect entire database schema and return SchemaAST.
   */
  introspect(): Promise<SchemaAST>;

  /**
   * Get all table names in the database
   */
  getTableNames(): Promise<string[]>;

  /**
   * Get the schema for a specific table
   */
  getTableSchema(tableName: string): Promise<TableSchema | undefined>;

  /**
   * Check if a table exists
   */
  tableExists(tableName: string): Promise<boolean>;
}
