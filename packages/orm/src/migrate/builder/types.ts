import type { ColumnNode, EnumValues, ForeignKeyAction } from '../../schema/types.js';
import type { IndexEntry, Except, FieldOptions, IndexColumnInput, IndexOptions } from '../../type/index.js';
import type { ForeignKeySchema } from '../../type/migration.js';

export type ColumnDefinition = Except<ColumnNode, 'table'>;

/**
 * The foreign key a single column declares: {@link ForeignKeySchema} without the local columns, which
 * are the column itself. Derived for the reason {@link ColumnDefinition} is - restated, the two spelled
 * their target differently and every hand-off between them had to translate.
 */
export type ForeignKeyDefinition = Except<ForeignKeySchema, 'columns'>;

/**
 * Full column definition including foreign key.
 */
export interface FullColumnDefinition extends ColumnDefinition {
  /** The values the column accepts, lifted onto the table as its check. */
  enum?: EnumValues;
  /** Foreign key reference (if any) */
  foreignKey?: ForeignKeyDefinition;
  /** Index name (if indexed) */
  index?: string | boolean;
}

/**
 * An index as the builder records it: its options as declared, its SQL kept as `raw` until a generator renders it for
 * the engine the migration runs on, and an unnamed one named then, from its predicate as written.
 */
export type IndexDefinition = IndexOptions & {
  readonly entries: readonly IndexEntry[];
  readonly unique: boolean;
  /** Whether an unnamed index takes the `_uk` kind. Only `table.unique` sets it: earlier migrations installed `_uk` there, so `index` keeps `_idx`. */
  readonly uniqueName?: boolean;
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

/** One change the migration builder declares, which a generator turns into statements. */
export type AnyMigrationOperation =
  | { readonly type: 'createTable'; readonly table: TableDefinition }
  | { readonly type: 'dropTable'; readonly tableName: string; readonly ifExists?: boolean; readonly cascade?: boolean }
  | { readonly type: 'renameTable'; readonly oldName: string; readonly newName: string }
  | { readonly type: 'addColumn'; readonly tableName: string; readonly column: FullColumnDefinition }
  | { readonly type: 'dropColumn'; readonly tableName: string; readonly columnName: string }
  | { readonly type: 'alterColumn'; readonly tableName: string; readonly changes: FullColumnDefinition }
  | { readonly type: 'renameColumn'; readonly tableName: string; readonly oldName: string; readonly newName: string }
  | { readonly type: 'createIndex'; readonly tableName: string; readonly index: IndexDefinition }
  | { readonly type: 'dropIndex'; readonly tableName: string; readonly indexName: string }
  | { readonly type: 'addForeignKey'; readonly tableName: string; readonly foreignKey: ForeignKeySchema }
  | { readonly type: 'dropForeignKey'; readonly tableName: string; readonly constraintName: string }
  | { readonly type: 'raw'; readonly sql: string };

/** The table and columns a foreign key points at. */
export type ForeignKeyTarget = ForeignKeySchema['references'];

/** A foreign key's constraint name and actions, each the engine's default where unstated. */
export type ForeignKeyOptions = Pick<ForeignKeySchema, 'name' | 'onDelete' | 'onUpdate'>;

/** A table's column, in an entity column's vocabulary: `table.string('email').length(80).nullable()`. */
export interface TableColumnBuilder {
  /** Lets the column hold `null`: a column is `NOT NULL` otherwise, as an entity's is. */
  nullable(): this;
  /** The column's DDL default: a value, or SQL the database evaluates per row (`currentTimestamp`, `sql`). */
  default(value: FieldOptions['defaultValue']): this;
  /** Makes it the primary key. */
  id(): this;
  autoIncrement(): this;
  unique(): this;
  /** A string column's length. */
  length(length: number): this;
  /** A decimal's digits, or a timestamp's fractional-second digits. */
  precision(digits: number): this;
  scale(digits: number): this;
  enum(values: EnumValues): this;
  /** A column the database computes, `GENERATED ALWAYS AS (<sql>) STORED`, its SQL as text. */
  as(sql: string): this;
  comment(text: string): this;
  index(name?: string): this;
  unsigned(): this;
  references(table: string, column?: string): ForeignKeyBuilder;
  build(): FullColumnDefinition;
}

export interface ForeignKeyBuilder extends TableColumnBuilder {
  /** Set ON DELETE action */
  onDelete(action: ForeignKeyAction): this;
  /** Set ON UPDATE action */
  onUpdate(action: ForeignKeyAction): this;
}

/** Every column type a table declares, name first, handed to `addColumn`/`alterColumn` callbacks too. */
export interface TableColumnFactory {
  id(name?: string): TableColumnBuilder;
  integer(name: string): TableColumnBuilder;
  smallint(name: string): TableColumnBuilder;
  bigint(name: string): TableColumnBuilder;
  float(name: string): TableColumnBuilder;
  double(name: string): TableColumnBuilder;
  decimal(name: string, precision?: number, scale?: number): TableColumnBuilder;

  /** A `VARCHAR`, 255 long unless `length()` says otherwise. */
  string(name: string): TableColumnBuilder;
  char(name: string): TableColumnBuilder;
  text(name: string): TableColumnBuilder;

  boolean(name: string): TableColumnBuilder;

  date(name: string): TableColumnBuilder;
  time(name: string): TableColumnBuilder;
  timestamp(name: string): TableColumnBuilder;
  timestamptz(name: string): TableColumnBuilder;

  json(name: string): TableColumnBuilder;
  jsonb(name: string): TableColumnBuilder;

  uuid(name: string): TableColumnBuilder;
  blob(name: string): TableColumnBuilder;
  vector(name: string, dimensions?: number): TableColumnBuilder;
}

export interface TableBuilder extends TableColumnFactory {
  /** Add createdAt timestamp column */
  createdAt(): TableColumnBuilder;
  /** Add updatedAt timestamp column */
  updatedAt(): TableColumnBuilder;
  /** Add both createdAt and updatedAt columns */
  timestamps(): void;

  /** Add composite primary key */
  primaryKey(columns: string[]): this;
  /** Add a composite unique index; takes the same options as an `indexes` entry, or just its name. */
  unique(columns: readonly IndexColumnInput[], options?: string | IndexOptions): this;
  /** Add a composite index; takes the same options as an `indexes` entry, or just its name. */
  index(columns: readonly IndexColumnInput[], options?: string | IndexOptions): this;
  /** Add table-level foreign key */
  foreignKey(columns: string[]): TableForeignKeyBuilder;

  /** Add a comment to the table */
  comment(text: string): this;
  /** Get the built table definition */
  build(): TableDefinition;
}

/**
 * Interface for table-level foreign key builder.
 */
export interface TableForeignKeyBuilder {
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
export interface AlterTableBuilder {
  /** Add a column, declared exactly as in `createTable`: `addColumn((c) => c.timestamp('createdAt'))`. */
  addColumn(callback: (columns: TableColumnFactory) => TableColumnBuilder): this;
  /** Drop a column from the table */
  dropColumn(name: string): this;
  /** Rename a column */
  renameColumn(oldName: string, newName: string): this;
  /** Redeclare a column, named and typed as it should end up. */
  alterColumn(callback: (columns: TableColumnFactory) => TableColumnBuilder): this;
  /** Add an index to the table */
  addIndex(columns: readonly IndexColumnInput[], options?: IndexOptions): this;
  /** Drop an index from the table */
  dropIndex(name: string): this;
  /** Add a foreign key to the table */
  addForeignKey(columns: string[], target: ForeignKeyTarget, options?: ForeignKeyOptions): this;
  /** Drop a foreign key from the table */
  dropForeignKey(name: string): this;
}

/**
 * Interface for the main migration builder.
 */
export interface MigrationBuilder {
  /** Create a table as `callback` declares it; on MongoDB a collection, whose callback declares only indexes. */
  createTable(name: string, callback: (table: TableBuilder) => void): Promise<void>;
  /** Drop a table */
  dropTable(name: string, options?: { ifExists?: boolean; cascade?: boolean }): Promise<void>;
  /** Rename a table */
  renameTable(oldName: string, newName: string): Promise<void>;
  /** Alter an existing table */
  alterTable(name: string, callback: (table: AlterTableBuilder) => void): Promise<void>;
  /** Add a column, declared exactly as in `createTable`: `addColumn('t', (c) => c.timestamp('at'))`. */
  addColumn(tableName: string, callback: (columns: TableColumnFactory) => TableColumnBuilder): Promise<void>;
  /** Drop a column from a table */
  dropColumn(tableName: string, columnName: string): Promise<void>;
  /** Redeclare a column, named and typed as it should end up. */
  alterColumn(tableName: string, callback: (columns: TableColumnFactory) => TableColumnBuilder): Promise<void>;
  /** Rename a column */
  renameColumn(tableName: string, oldName: string, newName: string): Promise<void>;
  /** Create an index; takes the same options as an `indexes` entry, so a generated migration can restate them. */
  createIndex(tableName: string, columns: readonly IndexColumnInput[], options?: IndexOptions): Promise<void>;
  /** Drop an index */
  dropIndex(tableName: string, indexName: string): Promise<void>;
  /** Add a foreign key */
  addForeignKey(
    tableName: string,
    columns: string[],
    target: ForeignKeyTarget,
    options?: ForeignKeyOptions,
  ): Promise<void>;
  /** Drop a foreign key */
  dropForeignKey(tableName: string, constraintName: string): Promise<void>;
  /** Execute raw SQL, the escape hatch for anything the builder does not model. */
  raw(sql: string): Promise<void>;
}
