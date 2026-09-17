/**
 * Migration Builder Types
 *
 * Type definitions for the fluent migration builder API.
 * Enables type-safe migrations without raw SQL.
 */

import type { ColumnNode, EnumValues, ForeignKeyAction } from '../../schema/types.js';
import type {
  EntityIndexColumn,
  Except,
  IndexColumnInput,
  IndexOptions,
  IndexSchema,
  QueryRaw,
} from '../../type/index.js';
import type { ForeignKeySchema } from '../../type/migration.js';

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
  /** Whether the numeric type is unsigned (MySQL/MariaDB) */
  unsigned?: boolean;
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

/** A column as the builder describes one: a {@link ColumnNode} without its graph links. */
export type ColumnDefinition = Omit<ColumnNode, 'table' | 'referencedBy' | 'references'>;

/**
 * The foreign key a single column declares: {@link ForeignKeySchema} without the local columns, which
 * are the column itself. Derived for the reason {@link ColumnDefinition} is - restated, the two spelled
 * their target differently and every hand-off between them had to translate.
 */
export type ForeignKeyDefinition = Omit<ForeignKeySchema, 'columns'>;

/**
 * Full column definition including foreign key.
 */
export interface FullColumnDefinition extends ColumnDefinition {
  /** Foreign key reference (if any) */
  foreignKey?: ForeignKeyDefinition;
  /** Index name (if indexed) */
  index?: string | boolean;
}

/**
 * An index as the builder records it, with the entries and options `@Index` takes: its SQL kept as `raw`
 * until a generator renders it for the engine the migration runs on.
 */
export type IndexDefinition = Except<IndexSchema, 'entries' | 'where'> & {
  readonly entries: readonly EntityIndexColumn[];
  readonly where?: QueryRaw;
};

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
  foreignKeys: ForeignKeySchema[];
  /** Table comment */
  comment?: string;
}

/**
 * Create table operation.
 */
export interface CreateTableOperation {
  type: 'createTable';
  table: TableDefinition;
  ifNotExists?: boolean;
}

/**
 * Drop table operation.
 */
export interface DropTableOperation {
  type: 'dropTable';
  tableName: string;
  ifExists?: boolean;
  cascade?: boolean;
}

/**
 * Rename table operation.
 */
export interface RenameTableOperation {
  type: 'renameTable';
  oldName: string;
  newName: string;
}

/**
 * Add column operation.
 */
export interface AddColumnOperation {
  type: 'addColumn';
  tableName: string;
  column: FullColumnDefinition;
}

/**
 * Drop column operation.
 */
export interface DropColumnOperation {
  type: 'dropColumn';
  tableName: string;
  columnName: string;
}

/**
 * Alter column operation.
 */
export interface AlterColumnOperation {
  type: 'alterColumn';
  tableName: string;
  columnName: string;
  changes: FullColumnDefinition;
}

/**
 * Rename column operation.
 */
export interface RenameColumnOperation {
  type: 'renameColumn';
  tableName: string;
  oldName: string;
  newName: string;
}

/**
 * Create index operation.
 */
export interface CreateIndexOperation {
  type: 'createIndex';
  tableName: string;
  index: IndexDefinition;
  ifNotExists?: boolean;
}

/**
 * Drop index operation.
 */
export interface DropIndexOperation {
  type: 'dropIndex';
  tableName: string;
  indexName: string;
  ifExists?: boolean;
}

/**
 * Add foreign key operation.
 */
export interface AddForeignKeyOperation {
  type: 'addForeignKey';
  tableName: string;
  foreignKey: ForeignKeySchema;
}

/**
 * Drop foreign key operation.
 */
export interface DropForeignKeyOperation {
  type: 'dropForeignKey';
  tableName: string;
  constraintName: string;
}

/**
 * Raw SQL operation (escape hatch).
 */
export interface RawSqlOperation {
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
  /** Constrain the column to these values, as a `CHECK (col IN (...))`. */
  enum(values: EnumValues): this;
  /** Make the column one the database computes, as `GENERATED ALWAYS AS (<sql>) STORED`. */
  computed(sql: string): this;
  /** Add comment */
  comment(text: string): this;
  /** Add index */
  index(name?: string): this;
  /** Set as unsigned (MySQL/MariaDB) */
  unsigned(): this;
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

/** Every column type the builder can declare, name first, handed to `addColumn`/`alterColumn` callbacks too. */
export interface IColumnFactory {
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
}

/**
 * Interface for table builder (fluent API).
 */
export interface ITableBuilder extends IColumnFactory {
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
  /** Add a composite unique index; takes the same options as `@Index`, or just its name. */
  unique(columns: readonly IndexColumnInput[], options?: string | IndexOptions): this;
  /** Add a composite index; takes the same options as `@Index`, or just its name. */
  index(columns: readonly IndexColumnInput[], options?: string | IndexOptions): this;
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
  /** Add a column, declared exactly as in `createTable`: `addColumn((c) => c.timestamp('createdAt'))`. */
  addColumn(callback: (columns: IColumnFactory) => IColumnBuilder): this;
  /** Drop a column from the table */
  dropColumn(name: string): this;
  /** Rename a column */
  renameColumn(oldName: string, newName: string): this;
  /** Redeclare a column, named and typed as it should end up. */
  alterColumn(callback: (columns: IColumnFactory) => IColumnBuilder): this;
  /** Add an index to the table */
  addIndex(columns: readonly IndexColumnInput[], options?: IndexOptions): this;
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
  /** Create a table as `callback` declares it; on MongoDB a collection, whose callback declares only indexes. */
  createTable(name: string, callback: (table: ITableBuilder) => void): Promise<void>;
  /** Drop a table */
  dropTable(name: string, options?: { ifExists?: boolean; cascade?: boolean }): Promise<void>;
  /** Rename a table */
  renameTable(oldName: string, newName: string): Promise<void>;
  /** Alter an existing table */
  alterTable(name: string, callback: (table: IAlterTableBuilder) => void): Promise<void>;
  /** Add a column, declared exactly as in `createTable`: `addColumn('t', (c) => c.timestamp('at'))`. */
  addColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void>;
  /** Drop a column from a table */
  dropColumn(tableName: string, columnName: string): Promise<void>;
  /** Redeclare a column, named and typed as it should end up. */
  alterColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void>;
  /** Rename a column */
  renameColumn(tableName: string, oldName: string, newName: string): Promise<void>;
  /** Create an index; takes the same options as `@Index`, so a generated migration can restate them. */
  createIndex(tableName: string, columns: readonly IndexColumnInput[], options?: IndexOptions): Promise<void>;
  /** Drop an index */
  dropIndex(tableName: string, indexName: string): Promise<void>;
  /** Add a foreign key */
  addForeignKey(
    tableName: string,
    columns: string[],
    target: { table: string; columns: string[] },
    options?: { onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction },
  ): Promise<void>;
  /** Drop a foreign key */
  dropForeignKey(tableName: string, constraintName: string): Promise<void>;
  /** Execute raw SQL, the escape hatch for anything the builder does not model. */
  raw(sql: string): Promise<void>;
}
