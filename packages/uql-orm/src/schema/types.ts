/**
 * Schema AST Types
 *
 * A unified graph representation of database schema with relationships as first-class citizens.
 * Enables reliable diffing, smart relation detection, and dialect-agnostic schema operations.
 */

import type { IndexSchema } from '../type/migration.js';

/**
 * Type categories universal across SQL dialects.
 * These represent logical/semantic types, not specific SQL types.
 */
export type TypeCategory =
  | 'integer'
  | 'float'
  | 'decimal'
  | 'string'
  | 'boolean'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'json'
  | 'uuid'
  | 'blob'
  | 'vector'
  | 'halfvec'
  | 'sparsevec';

/**
 * Size variants for types that support different sizes.
 */
export type SizeVariant = 'tiny' | 'small' | 'medium' | 'big';

/**
 * Dialect-agnostic type representation.
 * Used for comparing types across different database engines.
 */
export interface CanonicalType {
  /** The semantic category of the type */
  readonly category: TypeCategory;
  /** Size variant for types with multiple sizes (tinyint, smallint, bigint, etc.) */
  readonly size?: SizeVariant;
  /** Character/string length (e.g., VARCHAR(255)) */
  readonly length?: number;
  /** Numeric precision for decimal types */
  readonly precision?: number;
  /** Numeric scale for decimal types */
  readonly scale?: number;
  /** Whether the numeric type is unsigned */
  readonly unsigned?: boolean;
  /** Pass-through for explicit/raw SQL types */
  readonly raw?: string;
  /** Whether this type has timezone info (for timestamp types) */
  readonly withTimezone?: boolean;
}

/**
 * Actions for foreign key ON DELETE and ON UPDATE clauses.
 */
export type ForeignKeyAction = 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';

/**
 * The values a column accepts, rendered as `CHECK (col IN (...))`.
 *
 * Strings and numbers only: those are what `IN (...)` can state, and each is escaped by the
 * dialect's own literal rules, so a number stays bare where a string is quoted.
 */
export type EnumValues = readonly (string | number)[];

/**
 * A `CHECK` constraint as the schema holds it, its expression already text. Declared here rather
 * than beside the entity types because a table node also comes from introspection, where there is
 * no entity to have authored one.
 *
 * Only ever compared by presence, never by content: a check is SQL text, and a database reprints
 * text from its parse tree, so `CHECK ("balance" >= 0)` reads back as `CHECK ((balance >= (0)::numeric))`.
 */
export interface CheckSchema {
  /** Absent when nothing named it, which the generator fills in with `derivedCheckName`. */
  readonly name?: string;
  readonly expression: string;
}

/**
 * Default action for foreign key ON DELETE and ON UPDATE clauses.
 */
export const DEFAULT_FOREIGN_KEY_ACTION: ForeignKeyAction = 'NO ACTION';

/**
 * Relationship cardinality types.
 */
export type RelationshipType = 'OneToOne' | 'OneToMany' | 'ManyToOne' | 'ManyToMany';

/**
 * Source of how a relationship was detected.
 */
export type RelationshipSource =
  | 'explicit_fk' // From actual FK constraint
  | 'entity_decorator' // From @Relation decorator
  | 'naming_pattern' // Inferred from column naming (user_id -> users)
  | 'junction_table' // Inferred from junction table structure
  | 'unique_fk'; // Inferred from unique FK (OneToOne)

/**
 * Index algorithm/type supported by various databases.
 */
export const INDEX_TYPES = [
  'btree',
  'hash',
  'gin',
  'gist',
  'brin',
  'fulltext',
  'hnsw',
  'ivfflat',
  'vector',
  'vectorSearch',
] as const;

export type IndexType = (typeof INDEX_TYPES)[number];

/**
 * Source of where an index was defined.
 */
export type IndexSource = 'entity' | 'database' | 'both';

/**
 * Sync status for indexes.
 */
export type IndexSyncStatus = 'in_sync' | 'entity_only' | 'db_only' | 'mismatch';

/**
 * Column node in the schema graph.
 * Represents a single column in a database table.
 */
export interface ColumnNode {
  /** Column name in the database */
  readonly name: string;
  /** Canonical (dialect-agnostic) type */
  readonly type: CanonicalType;
  /** Whether the column allows NULL values */
  readonly nullable: boolean;
  /** Default value expression or literal */
  readonly defaultValue?: unknown;
  /** Whether this column is part of the primary key */
  readonly isPrimaryKey: boolean;
  /** Whether this column auto-increments */
  readonly isAutoIncrement: boolean;
  /** Whether this column has a unique constraint */
  readonly isUnique: boolean;
  /** The values the column accepts. See {@link EnumValues}. */
  readonly enum?: EnumValues;
  /** Column comment/description */
  readonly comment?: string;

  // === Graph Links ===
  /** Reference to the parent table */
  table: TableNode;
  /** Relationships where this column is referenced (FKs pointing TO this column) */
  referencedBy: RelationshipNode[];
  /** Relationship where this column is the foreign key (FK this column points FROM) */
  references?: RelationshipNode;
}

/**
 * Table node in the schema graph.
 * Represents a database table with all its columns, indexes, and relationships.
 */
export interface TableNode {
  /**
   * The table's own name, never qualified. Everything derived from a table reads this: an index or
   * constraint name is a single identifier, and `sales.Order_total_idx` is a syntax error.
   */
  readonly name: string;
  /**
   * The namespace the table lives in, absent where nothing named one and it resolves through the
   * connection's own default. Joined onto {@link name} by `qualifyName`, which is the key a
   * `SchemaAST` stores the table under and the operand a statement names it by.
   */
  readonly schema?: string;
  /** Map of column name to column node */
  readonly columns: Map<string, ColumnNode>;
  /** Primary key columns, in key order (supports composite keys) */
  readonly primaryKey: ColumnNode[];
  /**
   * What the constraint is called, where a name is known: read back from the database on an
   * introspected table, absent on one built from entities, where nothing has named it yet. A `DROP`
   * is the only thing that needs it - see {@link TableSchema.primaryKeyName}.
   */
  primaryKeyName?: string;
  /** Indexes on this table */
  readonly indexes: IndexNode[];
  /** `CHECK` constraints on this table. Optional: a node can be built without ever naming one. */
  readonly checks?: CheckSchema[];
  /** Optional table comment */
  readonly comment?: string;

  // === Graph Links ===
  /** Relationships pointing TO this table (other tables referencing this one) */
  incomingRelations: RelationshipNode[];
  /** Relationships pointing FROM this table (this table referencing others) */
  outgoingRelations: RelationshipNode[];
}

/**
 * Relationship node - a first-class citizen in the schema graph.
 * Represents a foreign key relationship between tables.
 */
export interface RelationshipNode {
  /** Constraint name (e.g., posts_author_id_fk) */
  readonly name: string;
  /** Type of relationship */
  readonly type: RelationshipType;

  /** Source side of the relationship (table with the FK column) */
  readonly from: {
    readonly table: TableNode;
    readonly columns: ColumnNode[];
  };

  /** Target side of the relationship (referenced table) */
  readonly to: {
    readonly table: TableNode;
    readonly columns: ColumnNode[];
  };

  /** Junction table for ManyToMany relationships */
  readonly through?: TableNode;

  /** Action on delete of referenced row */
  readonly onDelete?: ForeignKeyAction;
  /** Action on update of referenced row */
  readonly onUpdate?: ForeignKeyAction;

  // === Metadata for Smart Detection ===
  /** Confidence level (0-1) for inferred relationships */
  readonly confidence?: number;
  /** How this relationship was detected */
  readonly inferredFrom?: RelationshipSource;
}

/**
 * Index node in the schema graph.
 * Represents a database index on one or more columns.
 */
export type IndexNode = IndexSchema & {
  /** Reference to the table this index belongs to */
  readonly table: TableNode;

  // === Sync Metadata ===
  /** Where this index was defined */
  readonly source?: IndexSource;
  /** Current sync status */
  readonly syncStatus?: IndexSyncStatus;
};

/**
 * Root of the schema graph.
 * Contains all tables, relationships, and provides graph operations.
 */
export interface SchemaAST {
  /** Map of table name to table node */
  readonly tables: Map<string, TableNode>;
  /** All relationships in the schema */
  readonly relationships: RelationshipNode[];
  /** All indexes (also accessible via TableNode.indexes) */
  readonly indexes: IndexNode[];
}

/**
 * Difference between two column definitions.
 *
 * A union rather than one shape with two optional sides, so which node is present follows from the
 * kind of difference: an added column has only the `expected` one, a dropped column only the
 * `actual` one, and an altered column both. Stated as optionals, every reader had to assert its way
 * past a `undefined` the kind had already ruled out.
 */
export type ColumnDiff = ColumnDiffBase &
  (
    | { readonly type: 'add'; readonly expected: ColumnNode; readonly actual?: undefined }
    | { readonly type: 'drop'; readonly expected?: undefined; readonly actual: ColumnNode }
    | { readonly type: 'alter'; readonly expected: ColumnNode; readonly actual: ColumnNode }
  );

interface ColumnDiffBase {
  readonly table: string;
  readonly column: string;
  /** Whether this change could cause data loss */
  readonly isBreaking?: boolean;
  readonly description?: string;
}

/**
 * Difference between two table definitions.
 */
export interface TableDiff {
  readonly name: string;
  readonly type: 'create' | 'drop' | 'alter';
  readonly columnDiffs?: ColumnDiff[];
  readonly indexDiffs?: IndexDiff[];
  /** Set only where the two keys hold different columns. See {@link PrimaryKeyDiff}. */
  readonly primaryKeyDiff?: PrimaryKeyDiff;
}

/**
 * Two primary keys that hold different columns.
 *
 * By columns and in order, never by name: `(a, b)` is a different key from `(b, a)`, while the same
 * key called `Member_pkey` on one side and `Member__userId_pk` on the other is one key, not two.
 */
export interface PrimaryKeyDiff {
  readonly table: string;
  readonly expected: string[];
  readonly actual: string[];
  /** What the *actual* side calls its constraint, which is the only name a `DROP` can use. */
  readonly actualName?: string;
}

/**
 * Difference between two index definitions.
 */
export interface IndexDiff {
  readonly name: string;
  readonly table: string;
  readonly type: 'create' | 'drop' | 'alter';
  readonly expected?: IndexNode;
  readonly actual?: IndexNode;
  readonly description?: string;
}

/**
 * Difference between two relationship definitions.
 */
export interface RelationshipDiff {
  readonly name: string;
  readonly fromTable: string;
  readonly toTable: string;
  readonly type: 'create' | 'drop' | 'alter';
  readonly expected?: RelationshipNode;
  readonly actual?: RelationshipNode;
}

/**
 * Complete diff between two schemas.
 */
export interface SchemaDiffResult {
  /** Tables that need to be created */
  readonly tablesToCreate: TableNode[];
  /** Tables that need to be dropped */
  readonly tablesToDrop: TableNode[];
  /** Tables that need alterations */
  readonly tablesToAlter: TableDiff[];

  /** All column-level diffs */
  readonly columnDiffs: ColumnDiff[];
  /** All index diffs */
  readonly indexDiffs: IndexDiff[];
  /** Every table whose primary key holds different columns than the entity declares. */
  readonly primaryKeyDiffs: PrimaryKeyDiff[];
  /** All relationship/FK diffs */
  readonly relationshipDiffs: RelationshipDiff[];

  /** Whether there are any differences */
  readonly hasDifferences: boolean;
  /** Whether any changes are breaking (could cause data loss) */
  readonly hasBreakingChanges: boolean;
}

/**
 * Type of schema validation error.
 */
export type ValidationErrorType =
  | 'missing_fk_target'
  | 'circular_dependency'
  | 'orphan_column'
  | 'duplicate_index'
  | 'invalid_type';

/**
 * Schema validation error.
 */
export interface ValidationError {
  readonly type: ValidationErrorType;
  readonly message: string;
  readonly table?: TableNode;
  readonly column?: ColumnNode;
  readonly relationship?: RelationshipNode;
  readonly tables?: TableNode[];
}

/**
 * Severity level for schema drift issues.
 */
export type DriftSeverity = 'critical' | 'warning' | 'info';

/**
 * Type of schema drift.
 */
export type DriftType =
  | 'missing_table'
  | 'unexpected_table'
  | 'missing_column'
  | 'unexpected_column'
  | 'type_mismatch'
  | 'constraint_mismatch'
  | 'missing_index'
  | 'unexpected_index'
  | 'index_mismatch'
  | 'missing_relationship'
  | 'unexpected_relationship';

/**
 * A single schema drift issue.
 */
export interface Drift {
  readonly type: DriftType;
  readonly severity: DriftSeverity;
  readonly table?: string;
  readonly column?: string;
  readonly index?: string;
  readonly relationship?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly details: string;
  readonly suggestion: string;
}

/**
 * Overall drift status.
 */
export type DriftStatus = 'in_sync' | 'drifted' | 'critical';

/**
 * Complete drift detection report.
 */
export interface DriftReport {
  readonly status: DriftStatus;
  readonly drifts: Drift[];
  readonly generatedAt: Date;
  /** Count by severity */
  readonly summary: {
    readonly critical: number;
    readonly warning: number;
    readonly info: number;
  };
}
