/**
 * Schema AST Types
 *
 * A unified graph representation of database schema with relationships as first-class citizens.
 * Enables reliable diffing, smart relation detection, and dialect-agnostic schema operations.
 */

// ============================================================================
// Canonical Type System
// ============================================================================

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
  | 'vector';

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

// ============================================================================
// Foreign Key Actions
// ============================================================================

/**
 * Actions for foreign key ON DELETE and ON UPDATE clauses.
 */
export type ForeignKeyAction = 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';

/**
 * Default action for foreign key ON DELETE and ON UPDATE clauses.
 */
export const DEFAULT_FOREIGN_KEY_ACTION: ForeignKeyAction = 'NO ACTION';

// ============================================================================
// Relationship Types
// ============================================================================

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

// ============================================================================
// Index Types
// ============================================================================

/**
 * Index algorithm/type supported by various databases.
 */
export type IndexType = 'btree' | 'hash' | 'gin' | 'gist' | 'brin' | 'fulltext';

/**
 * Source of where an index was defined.
 */
export type IndexSource = 'entity' | 'database' | 'both';

/**
 * Sync status for indexes.
 */
export type IndexSyncStatus = 'in_sync' | 'entity_only' | 'db_only' | 'mismatch';

// ============================================================================
// Schema AST Nodes
// ============================================================================

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
  /** Table name in the database */
  readonly name: string;
  /** Map of column name to column node */
  readonly columns: Map<string, ColumnNode>;
  /** Primary key columns (supports composite keys) */
  readonly primaryKey: ColumnNode[];
  /** Indexes on this table */
  readonly indexes: IndexNode[];
  /** Optional table comment */
  readonly comment?: string;

  // === Graph Links ===
  /** Reference to the parent schema */
  schema: SchemaAST;
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
  /** Constraint name (e.g., fk_posts_author_id) */
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
export interface IndexNode {
  /** Index name */
  readonly name: string;
  /** Reference to the table this index belongs to */
  readonly table: TableNode;
  /** Columns included in the index (order matters) */
  readonly columns: ColumnNode[];
  /** Whether this is a unique index */
  readonly unique: boolean;
  /** Index algorithm/type */
  readonly type?: IndexType;
  /** Partial index condition (WHERE clause) */
  readonly where?: string;

  // === Sync Metadata ===
  /** Where this index was defined */
  readonly source?: IndexSource;
  /** Current sync status */
  readonly syncStatus?: IndexSyncStatus;
}

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

// ============================================================================
// Schema Diff Types
// ============================================================================

/**
 * Difference between two column definitions.
 */
export interface ColumnDiff {
  readonly table: string;
  readonly column: string;
  readonly type: 'add' | 'drop' | 'alter';
  readonly expected?: ColumnNode;
  readonly actual?: ColumnNode;
  /** Whether this change could cause data loss */
  readonly isBreaking?: boolean;
  /** Human-readable description of the change */
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
  /** All relationship/FK diffs */
  readonly relationshipDiffs: RelationshipDiff[];

  /** Whether there are any differences */
  readonly hasDifferences: boolean;
  /** Whether any changes are breaking (could cause data loss) */
  readonly hasBreakingChanges: boolean;
}

// ============================================================================
// Validation Types
// ============================================================================

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

// ============================================================================
// Smart Relation Detection Types
// ============================================================================

/**
 * A detected/inferred relationship with confidence score.
 */
export interface DetectedRelation {
  readonly type: RelationshipType;
  readonly from: {
    readonly table: TableNode;
    readonly columns: ColumnNode[];
  };
  readonly to: {
    readonly table: TableNode;
    readonly columns: ColumnNode[];
  };
  readonly through?: TableNode;
  /** Confidence level (0-1) */
  readonly confidence: number;
  /** How this relation was detected */
  readonly source: RelationshipSource;
  /** Suggested constraint name */
  readonly suggestedName?: string;
}

// ============================================================================
// Drift Detection Types
// ============================================================================

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

// ============================================================================
// Sync Direction Types
// ============================================================================

/**
 * Direction for schema synchronization.
 */
export type SyncDirection =
  | 'bidirectional' // Sync both ways (default for development)
  | 'entity-to-db' // Entities are source of truth → push to DB
  | 'db-to-entity'; // Database is source of truth → pull to entities

/**
 * Strategy for resolving conflicts in bidirectional sync.
 */
export type ConflictResolution =
  | 'prompt' // Ask user interactively
  | 'entity-wins' // Entity definition takes precedence
  | 'db-wins' // Database definition takes precedence
  | 'skip'; // Skip conflicting changes

/**
 * Options for sync operations.
 */
export interface SyncOptions {
  /** Direction of synchronization */
  readonly direction?: SyncDirection;
  /** How to resolve conflicts (for bidirectional) */
  readonly conflictResolution?: ConflictResolution;
  /** Prevent destructive changes (DROP, type narrowing) */
  readonly safe?: boolean;
  /** Include indexes in sync */
  readonly includeIndexes?: boolean;
  /** Include foreign keys in sync */
  readonly includeForeignKeys?: boolean;
  /** Dry run - report changes without applying */
  readonly dryRun?: boolean;
}
