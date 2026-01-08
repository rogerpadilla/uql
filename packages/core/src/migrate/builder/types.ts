/**
 * Migration Builder Types
 *
 * Type definitions for the fluent migration builder API.
 * Enables type-safe migrations without raw SQL.
 */

import type { CanonicalType, ForeignKeyAction, IndexType } from '../../schema/types.js';

// ============================================================================
// Column Options (User-facing API)
// ============================================================================

/**
 * Foreign key reference options.
 */
export interface ReferenceOptions {
  /** Referenced table */
  table: string;
  /** Referenced column (default: 'id') */
  column?: string;
  /** Action on delete */
  onDelete?: ForeignKeyAction;
  /** Action on update */
  onUpdate?: ForeignKeyAction;
}

/**
 * Base options for all column types.
 * Columns are NOT NULL by default (safer).
 */
export interface BaseColumnOptions {
  /** Whether the column is nullable (default: false) */
  nullable?: boolean;
  /** Whether this column has a unique constraint */
  unique?: boolean;
  /** Set as primary key */
  primaryKey?: boolean;
  /** Enable auto-increment (for integer types) */
  autoIncrement?: boolean;
  /** Default value or expression */
  defaultValue?: unknown;
  /** Add an index (true = auto-name, string = custom name) */
  index?: boolean | string;
  /** Column comment */
  comment?: string;
  /** Foreign key reference */
  references?: ReferenceOptions;
}

/**
 * Options for string/char columns.
 */
export interface StringColumnOptions extends BaseColumnOptions {
  /** Maximum length (default: 255 for string, 1 for char) */
  length?: number;
}

/**
 * Options for decimal columns.
 */
export interface DecimalColumnOptions extends BaseColumnOptions {
  /** Total digits */
  precision?: number;
  /** Digits after decimal point */
  scale?: number;
}

/**
 * Options for vector columns (AI embeddings).
 */
export interface VectorColumnOptions extends BaseColumnOptions {
  /** Number of dimensions */
  dimensions?: number;
}

// ============================================================================
// Column Definition Types
// ============================================================================

/**
 * Base options for a column definition.
 */
export interface ColumnDefinition {
  /** Column name */
  name: string;
  /** Canonical type */
  type: CanonicalType;
  /** Whether the column is nullable */
  nullable: boolean;
  /** Default value or expression */
  defaultValue?: unknown;
  /** Whether this is a primary key */
  primaryKey: boolean;
  /** Whether this column auto-increments */
  autoIncrement: boolean;
  /** Whether this column has a unique constraint */
  unique: boolean;
  /** Column comment */
  comment?: string;
}

/**
 * Foreign key definition for a column.
 */
export interface ForeignKeyDefinition {
  /** Constraint name */
  name?: string;
  /** Referenced table */
  table: string;
  /** Referenced column(s) */
  columns: string[];
  /** Action on delete */
  onDelete: ForeignKeyAction;
  /** Action on update */
  onUpdate: ForeignKeyAction;
}

/**
 * Full column definition including foreign key.
 */
export interface FullColumnDefinition extends ColumnDefinition {
  /** Foreign key reference (if any) */
  foreignKey?: ForeignKeyDefinition;
  /** Index name (if indexed) */
  index?: string | boolean;
}

// ============================================================================
// Index Definition Types
// ============================================================================

/**
 * Index definition.
 */
export interface IndexDefinition {
  /** Index name */
  name: string;
  /** Column names */
  columns: string[];
  /** Whether unique */
  unique: boolean;
  /** Index type (btree, hash, etc.) */
  type?: IndexType;
  /** Partial index WHERE clause */
  where?: string;
}

// ============================================================================
// Table Definition Types
// ============================================================================

/**
 * Complete table definition.
 */
export interface TableDefinition {
  /** Table name */
  name: string;
  /** Column definitions */
  columns: FullColumnDefinition[];
  /** Primary key columns (for composite keys) */
  primaryKey?: string[];
  /** Index definitions */
  indexes: IndexDefinition[];
  /** Foreign key definitions at table level */
  foreignKeys: TableForeignKeyDefinition[];
  /** Table comment */
  comment?: string;
}

/**
 * Table-level foreign key (for composite FKs).
 */
export interface TableForeignKeyDefinition {
  /** Constraint name */
  name?: string;
  /** Local columns */
  columns: string[];
  /** Referenced table */
  referencesTable: string;
  /** Referenced columns */
  referencesColumns: string[];
  /** Action on delete */
  onDelete: ForeignKeyAction;
  /** Action on update */
  onUpdate: ForeignKeyAction;
}

// ============================================================================
// Migration Operation Types
// ============================================================================

/**
 * Type of migration operation.
 */
export type MigrationOperationType =
  | 'createTable'
  | 'dropTable'
  | 'renameTable'
  | 'alterTable'
  | 'addColumn'
  | 'dropColumn'
  | 'alterColumn'
  | 'renameColumn'
  | 'createIndex'
  | 'dropIndex'
  | 'addForeignKey'
  | 'dropForeignKey'
  | 'raw';

/**
 * Base migration operation.
 */
export interface MigrationOperation {
  type: MigrationOperationType;
}

/**
 * Create table operation.
 */
export interface CreateTableOperation extends MigrationOperation {
  type: 'createTable';
  table: TableDefinition;
  ifNotExists?: boolean;
}

/**
 * Drop table operation.
 */
export interface DropTableOperation extends MigrationOperation {
  type: 'dropTable';
  tableName: string;
  ifExists?: boolean;
  cascade?: boolean;
}

/**
 * Rename table operation.
 */
export interface RenameTableOperation extends MigrationOperation {
  type: 'renameTable';
  oldName: string;
  newName: string;
}

/**
 * Add column operation.
 */
export interface AddColumnOperation extends MigrationOperation {
  type: 'addColumn';
  tableName: string;
  column: FullColumnDefinition;
}

/**
 * Drop column operation.
 */
export interface DropColumnOperation extends MigrationOperation {
  type: 'dropColumn';
  tableName: string;
  columnName: string;
}

/**
 * Alter column operation.
 */
export interface AlterColumnOperation extends MigrationOperation {
  type: 'alterColumn';
  tableName: string;
  columnName: string;
  changes: FullColumnDefinition;
}

/**
 * Rename column operation.
 */
export interface RenameColumnOperation extends MigrationOperation {
  type: 'renameColumn';
  tableName: string;
  oldName: string;
  newName: string;
}

/**
 * Create index operation.
 */
export interface CreateIndexOperation extends MigrationOperation {
  type: 'createIndex';
  tableName: string;
  index: IndexDefinition;
  ifNotExists?: boolean;
}

/**
 * Drop index operation.
 */
export interface DropIndexOperation extends MigrationOperation {
  type: 'dropIndex';
  tableName: string;
  indexName: string;
  ifExists?: boolean;
}

/**
 * Add foreign key operation.
 */
export interface AddForeignKeyOperation extends MigrationOperation {
  type: 'addForeignKey';
  tableName: string;
  foreignKey: TableForeignKeyDefinition;
}

/**
 * Drop foreign key operation.
 */
export interface DropForeignKeyOperation extends MigrationOperation {
  type: 'dropForeignKey';
  tableName: string;
  constraintName: string;
}

/**
 * Raw SQL operation (escape hatch).
 */
export interface RawSqlOperation extends MigrationOperation {
  type: 'raw';
  sql: string;
}

/**
 * Union of all operation types.
 */
export type AnyMigrationOperation =
  | CreateTableOperation
  | DropTableOperation
  | RenameTableOperation
  | AddColumnOperation
  | DropColumnOperation
  | AlterColumnOperation
  | RenameColumnOperation
  | CreateIndexOperation
  | DropIndexOperation
  | AddForeignKeyOperation
  | DropForeignKeyOperation
  | RawSqlOperation;

// ============================================================================
// Builder Interfaces
// ============================================================================

/**
 * Interface for column builder (fluent API).
 */
export interface IColumnBuilder {
  /** Make column nullable */
  nullable(value?: boolean): this;
  /** Make column NOT NULL (convenience method) */
  notNullable(): this;
  /** Set default value */
  defaultValue(value: unknown): this;
  /** Set as primary key */
  primaryKey(): this;
  /** Enable auto-increment */
  autoIncrement(): this;
  /** Add unique constraint */
  unique(): this;
  /** Add comment */
  comment(text: string): this;
  /** Add index */
  index(name?: string): this;
  /** Add foreign key reference */
  references(table: string, column?: string): IForeignKeyBuilder;
  /** Get the built column definition */
  build(): FullColumnDefinition;
}

/**
 * Interface for foreign key builder.
 */
export interface IForeignKeyBuilder extends IColumnBuilder {
  /** Set ON DELETE action */
  onDelete(action: ForeignKeyAction): this;
  /** Set ON UPDATE action */
  onUpdate(action: ForeignKeyAction): this;
}

/**
 * Interface for table builder (fluent API).
 */
export interface ITableBuilder {
  // === Numeric Types ===
  /** Add an auto-incrementing primary key */
  id(name?: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add an integer column */
  integer(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a smallint column */
  smallint(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a bigint column */
  bigint(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a float column */
  float(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a double column */
  double(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a decimal column */
  decimal(name: string, options?: DecimalColumnOptions): IColumnBuilder;

  // === String Types ===
  /** Add a varchar column */
  string(name: string, options?: StringColumnOptions): IColumnBuilder;
  /** Add a char column */
  char(name: string, options?: StringColumnOptions): IColumnBuilder;
  /** Add a text column */
  text(name: string, options?: BaseColumnOptions): IColumnBuilder;

  // === Boolean ===
  /** Add a boolean column */
  boolean(name: string, options?: BaseColumnOptions): IColumnBuilder;

  // === Date/Time Types ===
  /** Add a date column */
  date(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a time column */
  time(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a timestamp column */
  timestamp(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a timestamptz column */
  timestamptz(name: string, options?: BaseColumnOptions): IColumnBuilder;

  // === JSON Types ===
  /** Add a JSON column */
  json(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a JSONB column (Postgres) */
  jsonb(name: string, options?: BaseColumnOptions): IColumnBuilder;

  // === Other Types ===
  /** Add a UUID column */
  uuid(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a blob/bytea column */
  blob(name: string, options?: BaseColumnOptions): IColumnBuilder;
  /** Add a vector column (for embeddings) */
  vector(name: string, options?: VectorColumnOptions): IColumnBuilder;

  // === Convenience Methods ===
  /** Add createdAt timestamp column */
  createdAt(): IColumnBuilder;
  /** Add updatedAt timestamp column */
  updatedAt(): IColumnBuilder;
  /** Add both createdAt and updatedAt columns */
  timestamps(): void;

  // === Indexes & Constraints ===
  /** Add composite primary key */
  primaryKey(columns: string[]): this;
  /** Add composite unique constraint */
  unique(columns: string[], name?: string): this;
  /** Add composite index */
  index(columns: string[], name?: string): this;
  /** Add table-level foreign key */
  foreignKey(columns: string[]): ITableForeignKeyBuilder;

  // === Utilities ===
  /** Add a comment to the table */
  comment(text: string): this;
  /** Get the built table definition */
  build(): TableDefinition;
}

/**
 * Interface for table-level foreign key builder.
 */
export interface ITableForeignKeyBuilder {
  /** Reference target table and columns */
  references(table: string, columns: string[]): this;
  /** Set ON DELETE action */
  onDelete(action: ForeignKeyAction): this;
  /** Set ON UPDATE action */
  onUpdate(action: ForeignKeyAction): this;
  /** Set constraint name */
  name(name: string): this;
}

/**
 * Interface for altering a table.
 */
export interface IAlterTableBuilder {
  /** Add a column to the table */
  addColumn(name: string, callback: (column: IColumnBuilder) => void): this;
  /** Drop a column from the table */
  dropColumn(name: string): this;
  /** Rename a column */
  renameColumn(oldName: string, newName: string): this;
  /** Alter a column definition */
  alterColumn(name: string, callback: (column: IColumnBuilder) => void): this;
  /** Add an index to the table */
  addIndex(columns: string[], options?: { name?: string; unique?: boolean }): this;
  /** Drop an index from the table */
  dropIndex(name: string): this;
  /** Add a foreign key to the table */
  addForeignKey(
    columns: string[],
    target: { table: string; columns: string[] },
    options?: { name?: string; onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction },
  ): this;
  /** Drop a foreign key from the table */
  dropForeignKey(name: string): this;
}

/**
 * Interface for the main migration builder.
 */
export interface IMigrationBuilder {
  // === Table Operations ===
  /** Create a new table */
  createTable(name: string, callback: (table: ITableBuilder) => void): Promise<void>;
  /** Drop a table */
  dropTable(name: string, options?: { ifExists?: boolean; cascade?: boolean }): Promise<void>;
  /** Rename a table */
  renameTable(oldName: string, newName: string): Promise<void>;
  /** Alter an existing table */
  alterTable(name: string, callback: (table: IAlterTableBuilder) => void): Promise<void>;

  // === Column Operations ===
  /** Add a column to an existing table */
  addColumn(tableName: string, columnName: string, callback: (column: IColumnBuilder) => void): Promise<void>;
  /** Drop a column from a table */
  dropColumn(tableName: string, columnName: string): Promise<void>;
  /** Alter a column */
  alterColumn(tableName: string, columnName: string, callback: (column: IColumnBuilder) => void): Promise<void>;
  /** Rename a column */
  renameColumn(tableName: string, oldName: string, newName: string): Promise<void>;

  // === Index Operations ===
  /** Create an index */
  createIndex(tableName: string, columns: string[], options?: { name?: string; unique?: boolean }): Promise<void>;
  /** Drop an index */
  dropIndex(tableName: string, indexName: string): Promise<void>;

  // === Foreign Key Operations ===
  /** Add a foreign key */
  addForeignKey(
    tableName: string,
    columns: string[],
    target: { table: string; columns: string[] },
    options?: { onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction },
  ): Promise<void>;
  /** Drop a foreign key */
  dropForeignKey(tableName: string, constraintName: string): Promise<void>;

  // === Raw SQL (escape hatch) ===
  /** Execute raw SQL */
  raw(sql: string): Promise<void>;

  // === Operation Access ===
  /** Get all recorded operations */
  getOperations(): AnyMigrationOperation[];
  /** Record an operation synchronously */
  recordOperationSync(operation: AnyMigrationOperation): void;
}
