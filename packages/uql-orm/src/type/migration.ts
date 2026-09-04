import type { VectorCast } from '../dialect/vectorCast.js';
import type { FullColumnDefinition, TableDefinition, TableForeignKeyDefinition } from '../migrate/builder/types.js';
import type { IndexFacet } from '../schema/indexDifferences.js';
import type { SchemaAST } from '../schema/schemaAST.js';
import type { CanonicalType, ForeignKeyAction, IndexNode, IndexType, TableNode } from '../schema/types.js';
import type {
  EntityMeta,
  FieldOptions,
  IndexColumnSchema,
  LoggingOptions,
  SqlQuerier,
  Type,
  VectorIndexOptions,
} from './index.js';

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
   * Whether logged queries include bound values during migrations. Defaults to `false`.
   */
  readonly logValues?: boolean;

  /**
   * Threshold in milliseconds for slow-query detection and logging during migrations.
   */
  readonly slowQuery?: number;

  /**
   * Entities to use for schema generation
   */
  readonly entities?: Type<unknown>[];

  /**
   * Default action for foreign key ON DELETE and ON UPDATE clauses.
   */
  readonly defaultForeignKeyAction?: ForeignKeyAction;

  /**
   * Custom schema generator for DDL operations.
   * If not provided, it will be inferred from `pool.dialect`.
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
  /**
   * The engine's own type spelling, as introspection read it (`tinyint(1)`, `DATETIME`, `VARCHAR`).
   * Deliberately not a {@link CanonicalType}: the diff has to compare what the engine would *store*,
   * and several canonical types share one storage type per engine - an entity `boolean` is `TINYINT(1)`
   * on MySQL and `INTEGER` on SQLite. Comparing canonical categories instead reports an alteration on
   * every sync for those columns. Use `sqlToCanonical` to interpret it.
   */
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
export interface IndexSchema extends VectorIndexOptions {
  readonly name: string;
  /**
   * What the index is over, in order. Named `entries` and not `columns` because an entry need not be
   * a column at all: ``raw`lower(email)` `` is one, and so is a column carrying a prefix length or a
   * stored order. The authored form, `@Index([...])`, still spells this `columns`, since that is what
   * it reads like at the call site.
   */
  readonly entries: readonly IndexColumnSchema[];
  readonly unique: boolean;
  /** Index type (btree, hnsw, ivfflat, etc.) */
  readonly type?: IndexType;
  /** Partial index condition (WHERE clause) */
  readonly where?: string;
  /** Non-key columns stored in the index (Postgres-wire `INCLUDE`). */
  readonly include?: readonly string[];
  /**
   * The indexed column's vector type, which pgvector's operator-class names are built from
   * (`halfvec_cosine_ops`). Absent for a non-vector index, and for an index whose column types are
   * unknown, where `vector` is assumed.
   */
  readonly vectorType?: VectorCast;
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
  /** Qualified where the table has a schema, since it is also the key the table is found under. */
  readonly tableName: string;
  /**
   * The schema {@link tableName} is in, carried separately for the identifiers that live in it
   * rather than name it: a Postgres index is dropped as `schema.index`, never `schema.table`.
   */
  readonly schema?: string;
  readonly type: 'create' | 'alter' | 'drop';
  readonly columnsToAdd?: ColumnSchema[];
  readonly columnsToAlter?: { from: ColumnSchema; to: ColumnSchema }[];
  readonly columnsToDrop?: string[];
  readonly indexesToAdd?: IndexSchema[];
  readonly indexesToDrop?: string[];
  readonly foreignKeysToAdd?: ForeignKeySchema[];
  readonly foreignKeysToDrop?: string[];
}

export interface CreateSchemaOptions {
  readonly ifNotExists?: boolean;
  /**
   * Restrict which tables are created, for an incremental migration adding one table to a schema that
   * already exists. Constraints still resolve against the full entity graph.
   */
  readonly only?: readonly string[];
  /**
   * Emit the tables without their foreign keys. Only the integration fixtures want this, and only until
   * their data stops relying on dangling references; a migration always wants the constraints.
   */
  readonly foreignKeys?: boolean;
}

export interface DropSchemaOptions {
  readonly ifExists?: boolean;
  readonly cascade?: boolean;
}

/**
 * Interface for generating DDL statements from entity metadata
 */
export interface SchemaGenerator {
  /**
   * The whole schema for `entities`: every table, then the foreign keys between them.
   *
   * There is deliberately no per-entity counterpart. One entity means an AST holding one table, so every
   * cross-entity foreign key has nothing to resolve against and is dropped: all three call sites that
   * used to work that way emitted schemas with no referential integrity.
   */
  generateCreateSchema(entities: readonly Type<unknown>[], options?: CreateSchemaOptions): string[];

  /**
   * Every `DROP TABLE` for `entities`, dependents first. The inverse of {@link generateCreateSchema},
   * and the reason it takes the whole set: dropping in any order that ignores the relation graph is
   * rejected once the foreign keys are really there.
   */
  generateDropSchema(entities: readonly Type<unknown>[], options?: DropSchemaOptions): string[];

  /** Generate DROP TABLE statement. */
  generateDropTable(tableName: string, options?: DropSchemaOptions): string;

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
   * The table's key: {@link resolveTableAlias} behind {@link resolveSchema}, which is how a
   * `SchemaAST` stores it and how a diff finds it again.
   */
  resolveTableName<E>(meta: EntityMeta<E>): string;

  /**
   * The table's own name, unqualified. What a derived index or constraint name is built from, since
   * those are single identifiers.
   */
  resolveTableAlias<E>(meta: EntityMeta<E>): string;

  /** The schema the table lives in, `undefined` where nothing named one. */
  resolveSchema<E>(meta: EntityMeta<E>): string | undefined;

  /**
   * Resolve column name using field options and naming strategy
   */
  resolveColumnName(key: string, field: FieldOptions): string;

  // === SchemaAST / TableNode Support ===
  /** DDL from a `TableNode`, one string per `querier.run`. */
  generateCreateTableFromNode(table: TableNode, options?: { ifNotExists?: boolean }): string[];
  /** Generate CREATE INDEX statement from an IndexNode */
  generateCreateIndexFromNode(index: IndexNode, options?: { ifNotExists?: boolean }): string;

  // === Migration Builder Support ===
  /** DDL from a `TableDefinition`, one string per `querier.run`. */
  generateCreateTableFromDefinition(table: TableDefinition, options?: { ifNotExists?: boolean }): string[];
  /** Generate RENAME TABLE statement */
  generateRenameTableSql(oldName: string, newName: string): string;
}

/**
 * The column and constraint DDL a migration builder emits, which only a SQL engine has. Split from
 * {@link SchemaGenerator} because MongoDB used to satisfy these six by returning `''`: a document store
 * has no `ADD COLUMN`, and an empty statement silently did nothing rather than saying so.
 */
export interface SqlDdlGenerator extends SchemaGenerator {
  /** Generate ADD COLUMN statement */
  generateAddColumnSql(tableName: string, column: FullColumnDefinition): string;
  /** Generate ALTER COLUMN statement */
  generateAlterColumnSql(tableName: string, columnName: string, column: FullColumnDefinition): string;
  /** Generate DROP COLUMN statement */
  generateDropColumnSql(tableName: string, columnName: string): string;
  /** Generate RENAME COLUMN statement */
  generateRenameColumnSql(tableName: string, oldName: string, newName: string): string;
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
   * What this introspector can read back about an index, and so all that diffing may compare.
   * Comparing a feature it cannot read reports the same drift forever: the entity side declares it,
   * the database side never reports it, and no migration can close the gap.
   */
  readonly indexFacets: ReadonlySet<IndexFacet>;

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
