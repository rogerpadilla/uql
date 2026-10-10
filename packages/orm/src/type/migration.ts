import type { AnyMigrationOperation } from '../migrate/builder/types.js';
import type { SchemaAST } from '../schema/schemaAST.js';
import type { DiffOptions } from '../schema/schemaASTDiffer.js';
import type {
  CheckSchema,
  ColumnNode,
  ForeignKeyAction,
  IndexType,
  TableNode,
  TriggerSchema,
} from '../schema/types.js';
import type {
  Except,
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
 * Configuration options for the Migrator
 */
export interface MigratorOptions {
  /**
   * Directory containing migration files. Defaults to './migrations'.
   */
  readonly migrationsPath?: string;

  /**
   * Table, or MongoDB collection, name for storing migration state. Defaults to 'uql_migrations'. The lock a
   * run holds is named after it.
   */
  readonly tableName?: string;

  /**
   * Milliseconds `up` and `down` wait for the lock another run holds before failing. Defaults to 5 minutes.
   */
  readonly lockTimeout?: number;

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

/** A migration `up` or `down` ran: a failing one throws instead. */
export interface MigrationResult {
  readonly name: string;
  readonly direction: 'up' | 'down';
  /** Milliseconds it took. */
  readonly duration: number;
}

/** A column as a statement renders one: a {@link ColumnNode} with the engine's type spelling and no graph links. */
export interface ColumnSchema extends Except<ColumnNode, 'type' | 'table'> {
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
  readonly checks?: CheckSchema[];
  /** The triggers uql installed, each with the statements the engine would recreate it from. */
  readonly triggers?: TriggerSchema[];
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
   * a column at all: ``sql`lower(email)` `` is one, and so is a column carrying a prefix length or a
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
 * {@link SchemaDiff}, or declared through the migration builder: one shape for all three.
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

/** A column's change, and whether it can lose what the column holds: a drop, or a retype that narrows it. */
export type ColumnChange = Change<ColumnSchema> & { readonly isBreaking?: boolean };

/** A name changed, `from` the database's `to` the entity's. */
export type Rename = Alteration<string>;

/** Renamed columns by qualified table name. */
export type ColumnRenames = ReadonlyMap<string, readonly Rename[]>;

/**
 * One object's change: added (`to` alone), dropped (`from` alone), or altered (both). Each side is the whole
 * object, so swapping them undoes the change. No engine alters an index, a key or a foreign key in place, so
 * altering one is a drop plus an add, which safe mode holds back together.
 */
export interface Change<T> {
  readonly from?: T;
  readonly to?: T;
}

/** A {@link Change} with both sides: the object altered in place. */
export type Alteration<T> = { readonly from: T; readonly to: T };

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
  readonly type: 'create' | 'alter' | 'drop';
  readonly primaryKey?: Change<PrimaryKeySchema>;
  readonly columns?: readonly ColumnChange[];
  readonly indexes?: readonly Change<IndexSchema>[];
  readonly foreignKeys?: readonly Change<ForeignKeySchema>[];
  readonly checks?: readonly Change<CheckSchema>[];
  /**
   * The triggers installed or declared, a kept one as both sides under one name: Postgres refuses to alter
   * a column a trigger names, so a table whose columns change takes every trigger off and puts it back.
   */
  readonly triggers?: readonly Change<TriggerSchema>[];
  /** Columns renamed in place, `from` the database's name `to` the entity's, which the other changes already use. */
  readonly renamedColumns?: readonly Rename[];
  /**
   * The table copied into a new one, which is how an engine that {@link DialectFeatures.rebuildsTables}
   * applies the changes above. Its column renames are carried by the copy.
   */
  readonly rebuild?: Alteration<RebuiltTable>;
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
}

export interface DropSchemaOptions {
  readonly ifExists?: boolean;
  readonly cascade?: boolean;
  /** The tables the database holds, by qualified name: one it lacks left no trigger function to drop. */
  readonly present?: ReadonlySet<string>;
  /** The schema as it stands, whose foreign keys are dropped before any table, since a cycle of them has no drop order. */
  readonly existing?: SchemaAST;
}

/**
 * Interface for generating DDL statements from entity metadata
 */
export interface SchemaGenerator {
  /** The whole schema for `entities`, tables then the foreign keys between them, which need every entity at once. */
  generateCreateSchema(entities: readonly Type<object>[], options?: CreateSchemaOptions): string[];

  /**
   * Every `DROP TABLE` for `entities`, dependents first. The inverse of {@link generateCreateSchema},
   * and the reason it takes the whole set: dropping in any order that ignores the relation graph is
   * rejected once the foreign keys are really there.
   */
  generateDropSchema(entities: readonly Type<object>[], options?: DropSchemaOptions): string[];

  /** The statements taking a table through `diff`; its rollback is the diff reversed, see `reverseDiff`. */
  generateAlterTable(diff: SchemaDiff): string[];

  /**
   * The statements one migration builder operation runs as, one string each. An operation the engine
   * has no form for throws: MongoDB has no columns, constraints or SQL.
   */
  generateOperation(operation: AnyMigrationOperation): string[];

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

  /** The entities as one AST, built once per run for every {@link diffSchema}. Absent on MongoDB, which diffs only indexes and a validator. */
  buildAST?(entities: readonly Type<object>[]): SchemaAST;

  /** How this engine's diff compares types and defaults. Absent where {@link buildAST} is. */
  diffOptions?(): DiffOptions;
}

/**
 * Interface for introspecting the current database schema
 */
export interface SchemaIntrospector {
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
