import type { AnyMigrationOperation } from '../migrate/builder/types.js';
import type { IndexFacet } from '../schema/indexDifferences.js';
import type { SchemaAST } from '../schema/schemaAST.js';
import type { DiffOptions } from '../schema/schemaASTDiffer.js';
import type { ColumnNode, ForeignKeyAction, IndexType, TableNode } from '../schema/types.js';
import type {
  EntityMeta,
  EntityWhereMeta,
  FieldOptions,
  IndexColumnSchema,
  IndexedVectorField,
  LoggingOptions,
  Querier,
  SqlQuerier,
  Type,
  VectorIndexOptions,
} from './index.js';

/**
 * Defines a migration using a simple object literal. `Q` is `MongoQuerier` for a MongoDB migration.
 */
export interface MigrationDefinition<Q extends Querier = SqlQuerier> {
  readonly name?: string;
  /**
   * `false` runs this migration outside a transaction, for a statement an engine refuses inside one -
   * `CREATE INDEX CONCURRENTLY` on Postgres, the index a busy table needs. The cost is the rollback: a
   * failure part-way leaves the statements before it applied and the migration unlogged. MongoDB
   * creates collections outside any transaction already, so it changes nothing there.
   */
  readonly transaction?: boolean;
  up(querier: Q): Promise<void>;
  down(querier: Q): Promise<void>;
}

/**
 * Represents a single database migration
 */
export interface Migration<Q extends Querier = SqlQuerier> extends MigrationDefinition<Q> {
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
   * Mark a migration as executed, on the querier that ran it (inside its transaction, where there is one)
   */
  logWithQuerier(querier: Querier, migrationName: string): Promise<void>;

  /**
   * Remove a migration from the executed list, on the querier that reverted it
   */
  unlogWithQuerier(querier: Querier, migrationName: string): Promise<void>;

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
   * Custom storage implementation. Defaults to DatabaseMigrationStorage, or MongoMigrationStorage on MongoDB.
   */
  readonly storage?: MigrationStorage;

  /**
   * Table, or MongoDB collection, name for storing migration state. Defaults to 'uql_migrations'.
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
  readonly entities?: Type<object>[];

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

/** A column as a statement renders one: a {@link ColumnNode} with the engine's type spelling and no graph links. */
export interface ColumnSchema extends Omit<ColumnNode, 'type' | 'table' | 'referencedBy' | 'references'> {
  /**
   * The engine's own type spelling, `TINYINT(1)`, compared as stored: canonical types would differ where
   * the engine stores them alike. `sqlToCanonical` reads it.
   */
  readonly type: string;
  /** Bounds introspection reports beside the type, where the engine states them separately. */
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
}

/**
 * Represents a database table schema
 */
export interface TableSchema {
  readonly name: string;
  readonly columns: ColumnSchema[];
  readonly primaryKey?: PrimaryKeySchema;
  readonly indexes?: IndexSchema[];
  readonly foreignKeys?: ForeignKeySchema[];
  /** The statements the engine keeps for the table, where it keeps them: SQLite's `sqlite_master`. */
  readonly definition?: readonly StoredDefinition[];
}

/** A statement exactly as the engine keeps it, which only it can say all of: a `CHECK`, an index over an expression. */
export type StoredDefinition = {
  readonly kind: 'table' | 'index' | 'trigger';
  readonly name: string;
  readonly sql: string;
};

/** One side of a rebuilt table: its `CREATE TABLE` and what goes back on it, and the columns holding stored values, under this side's names. */
export type RebuiltTable = {
  readonly statements: readonly string[];
  readonly columns: readonly string[];
};

/**
 * Represents an index in a database table
 */
export interface IndexSchema extends VectorIndexOptions, IndexedVectorField {
  /**
   * A `fulltext` index's text-search configuration, which `$text` parses with on the Postgres family
   * (`'english'`); `'simple'` where unstated. Other engines take their language from elsewhere.
   */
  readonly config?: string;
  readonly name: string;
  /**
   * What the index is over, in order. Named `entries` and not `columns` because an entry need not be
   * a column at all: ``raw`lower(email)` `` is one, and so is a column carrying a prefix length or a
   * stored order. The authored form, `@Index`, still spells this `columns`, since that is what
   * it reads like at the call site.
   */
  readonly entries: readonly IndexColumnSchema[];
  readonly unique: boolean;
  /** Index type (btree, hnsw, ivfflat, etc.) */
  readonly type?: IndexType;
  /** Partial index predicate as its engine writes it: SQL, or on MongoDB the JSON of its filter document. */
  readonly where?: string;
  /** Non-key columns stored in the index (Postgres-wire `INCLUDE`). */
  readonly include?: readonly string[];
}

/**
 * A foreign key constraint, wherever one is described: read back by introspection, planned into a
 * {@link SchemaDiff}, or declared through the migration builder. One shape for all three - they
 * differed only in spelling, and the translation between them was pure overhead.
 */
export interface ForeignKeySchema {
  /** Absent when nothing named it, which the generator fills in with `derivedForeignKeyName`. */
  readonly name?: string;
  readonly columns: string[];
  /**
   * The far end, as one thing. Same shape and same name as everywhere else a relationship's target is
   * described - `@Field({ references })`, `addForeignKey`'s `target`, a `RelationshipNode`'s `to` -
   * so nothing has to be destructured on the way between them.
   */
  readonly references: { readonly table: string; readonly columns: string[] };
  readonly onDelete?: ForeignKeyAction;
  readonly onUpdate?: ForeignKeyAction;
}

/**
 * One object's change: added (`to` alone), dropped (`from` alone), or altered (both), each whole so the
 * change is undone by swapping its ends. No engine alters an index, a key or a foreign key in place, so
 * an alter of one is its drop and its add, which safe mode holds back together.
 */
/** A column's change, and whether it can lose what the column holds: a drop, or a retype that narrows it. */
export type ColumnChange = Change<ColumnSchema> & { readonly isBreaking?: boolean };

/** A name changed, `from` the database's `to` the entity's. */
export type Rename = { readonly from: string; readonly to: string };

/** Renamed columns by qualified table name. */
export type ColumnRenames = ReadonlyMap<string, readonly Rename[]>;

export interface Change<T> {
  readonly from?: T;
  readonly to?: T;
}

/** A primary key, whichever side it is read from: the entities, the database, or a diff between them. */
export interface PrimaryKeySchema {
  /** Its columns **in order**, which is what a composite is: `(a, b)` is not `(b, a)`. */
  readonly columns: readonly string[];
  /**
   * What the engine calls its constraint, where it names one at all - Postgres's `Member_pkey`, MySQL's
   * literal `PRIMARY`, nothing on SQLite. Only a `DROP` needs it, and only the name the database
   * reported will do: a derived one would name a constraint that is not there.
   */
  readonly name?: string;
}

/** A table's differences from what its entity declares, or the table to create or drop. */
export interface SchemaDiff {
  /** Qualified where the table has a schema, since it is also the key the table is found under. */
  readonly tableName: string;
  /**
   * The schema {@link tableName} is in, carried separately for the identifiers that live in it
   * rather than name it: a Postgres index is dropped as `schema.index`, never `schema.table`.
   */
  readonly schema?: string;
  readonly type: 'create' | 'alter' | 'drop';
  readonly primaryKey?: Change<PrimaryKeySchema>;
  readonly columns?: readonly ColumnChange[];
  readonly indexes?: readonly Change<IndexSchema>[];
  readonly foreignKeys?: readonly Change<ForeignKeySchema>[];
  /** Columns renamed in place, `from` the database's name `to` the entity's, which the other changes already use. */
  readonly renamedColumns?: readonly Rename[];
  /**
   * The table copied into a new one, which is how an engine that {@link DialectFeatures.rebuildsTables}
   * applies the changes above. Its column renames are carried by the copy.
   */
  readonly rebuild?: { readonly from: RebuiltTable; readonly to: RebuiltTable };
}

/**
 * What every sync entry point takes: `safe` keeps it additive, `drop` lets it remove a column, and
 * `logging` reports each statement. A plan ignores `logging`, having nothing to run.
 */
export interface SyncOptions {
  readonly safe?: boolean;
  readonly drop?: boolean;
  readonly logging?: boolean;
  /** One entity instead of every registered one, for a schema that grows while the process runs. */
  readonly entity?: Type<object>;
  /** Drop every table and recreate it. Development only: it is the one option that loses data. */
  readonly force?: boolean;
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

/** The triggers uql installed on one table, by name, each with the statements that recreate it as it stands. */
export type InstalledTriggers = ReadonlyMap<string, readonly string[]>;

/**
 * Interface for generating DDL statements from entity metadata
 */
export interface SchemaGenerator {
  /** Whether a column's stored default is the one the entity declares, as the engine reprints it. Absent where columns are not compared. */
  readonly defaultsEqual?: (expected: unknown, actual: unknown) => boolean;

  /** The whole schema for `entities`, tables then the foreign keys between them, which need every entity at once. */
  generateCreateSchema(entities: readonly Type<object>[], options?: CreateSchemaOptions): string[];

  /**
   * Every `DROP TABLE` for `entities`, dependents first. The inverse of {@link generateCreateSchema},
   * and the reason it takes the whole set: dropping in any order that ignores the relation graph is
   * rejected once the foreign keys are really there.
   */
  generateDropSchema(entities: readonly Type<object>[], options?: DropSchemaOptions): string[];

  /** Generate DROP TABLE statement. */
  generateDropTable(tableName: string, options?: DropSchemaOptions): string;

  /**
   * What takes the triggers on `entity`'s table from `installed` - each by name, with the statements that
   * recreate it - to what it declares: nothing where the two agree, which is always on MongoDB.
   */
  generateTriggers(entity: Type<object>, installed?: InstalledTriggers): string[];

  /** The inverse of {@link generateTriggers} from the same `installed`: its triggers dropped, and the ones it dropped restored. */
  generateTriggersDown(entity: Type<object>, installed?: InstalledTriggers): string[];

  /** A `DROP` for each trigger uql owns among `names` on `entity`'s table, whatever the entity declares. */
  generateTriggerDrops(entity: Type<object>, names: readonly string[]): string[];

  /** The statements taking a table through `diff`; its rollback is the diff reversed, see `reverseDiff`. */
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
   * The statements one migration builder operation runs as, one string each. An operation the engine
   * has no form for throws: MongoDB has no columns, constraints or SQL.
   */
  generateOperation(operation: AnyMigrationOperation): string[];

  /**
   * The text of SQL an entity declares - a check, a stored computed column, an index expression or
   * predicate - rendered for this engine, which is what building an entity's schema needs from it.
   */
  compileDdl(sql: EntityWhereMeta<object>, entity: Type<object>): string;

  /**
   * A partial index's `$where` as this engine writes it into {@link IndexSchema.where}, refused where its
   * index takes less of a predicate than a query does: SQL Server's filter has no `OR`.
   */
  compileIndexPredicate(where: EntityWhereMeta<object>, entity: Type<object>, indexName: string): string;

  /**
   * An entity's differences from its table. `desiredAst`, from {@link buildAST}, has to span every entity
   * a foreign key here points at, or those keys read as matching.
   * `renamedColumns` are columns `currentTable` already holds under their new names.
   */
  diffSchema(
    entity: Type<object>,
    currentTable: TableNode | undefined,
    desiredAst?: SchemaAST,
    renamedColumns?: readonly Rename[],
  ): SchemaDiff | undefined;

  /** The entities as one AST, built once per run for every {@link diffSchema}. Absent on MongoDB, which diffs only indexes. */
  buildAST?(entities: readonly Type<object>[]): SchemaAST;

  /** How this engine's diff compares types and defaults. Absent where {@link buildAST} is. */
  diffOptions?(): DiffOptions;

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
}

/**
 * Interface for introspecting the current database schema
 */
export interface SchemaIntrospector {
  /**
   * Every trigger uql installed on `table`, by name, each with the statements that recreate it as it
   * stands. The names say which to drop once an entity no longer declares them; the statements are what
   * a rollback puts back, read off the engine rather than recorded anywhere by uql. One table's alone,
   * so reading it never meets a trigger another writer is dropping from some other table.
   */
  ownedTriggers(table: string): Promise<InstalledTriggers>;

  /**
   * What this introspector can read back about an index, and so all that diffing may compare.
   * Comparing a feature it cannot read reports the same drift forever: the entity side declares it,
   * the database side never reports it, and no migration can close the gap.
   */
  readonly indexFacets: ReadonlySet<IndexFacet>;

  /**
   * The whole database, or just the tables named. Names nothing matches are left out. `renames` reads
   * each column under the name it is being renamed to, so a diff compares it as the column it becomes.
   */
  introspect(tables?: readonly string[], renames?: ColumnRenames): Promise<SchemaAST>;

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
