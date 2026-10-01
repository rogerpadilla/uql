// A database schema as a graph, whichever side it came from: the entities or the database itself.

import type {
  Alteration,
  Change,
  ForeignKeySchema,
  IndexSchema,
  PrimaryKeySchema,
  StoredDefinition,
} from '../type/migration.js';
import type { IndexFacet } from './indexDifferences.js';

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

/** Actions for foreign key ON DELETE and ON UPDATE clauses. */
export const FOREIGN_KEY_ACTIONS = ['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'] as const;

export type ForeignKeyAction = (typeof FOREIGN_KEY_ACTIONS)[number];

/**
 * The values a column accepts, rendered as `CHECK (col IN (...))`.
 *
 * Strings and numbers only: those are what `IN (...)` can state, and each is escaped by the
 * dialect's own literal rules, so a number stays bare where a string is quoted.
 */
export type EnumValues = readonly (string | number)[];

/** A `CHECK` as the schema holds it, compared by presence only: the database reprints its expression. */
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
  /** The column's default: a literal value, or an `SqlExpression` for SQL. */
  readonly defaultValue?: unknown;
  /** Whether this column is part of the primary key */
  readonly isPrimaryKey: boolean;
  /** Whether this column auto-increments */
  readonly isAutoIncrement: boolean;
  /** Whether this column has a unique constraint */
  readonly isUnique: boolean;
  /** The values the column accepts. See {@link EnumValues}. */
  readonly enum?: EnumValues;
  /** The SQL an engine-generated column is computed from, as `GENERATED ALWAYS AS (...) STORED`. */
  readonly generatedAs?: string;
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
  /** The table's key, named where the database reported a name; none on a table without one. */
  primaryKey?: PrimaryKeySchema;
  /** Indexes on this table */
  readonly indexes: IndexNode[];
  /**
   * What the introspector that read this table reports about an index, and so all an index diff against
   * it may compare. None on a table built from entities.
   */
  readonly indexFacets: ReadonlySet<IndexFacet>;
  /** `CHECK` constraints on this table. */
  readonly checks: CheckSchema[];
  /** Optional table comment */
  readonly comment?: string;
  /** The statements the engine keeps for the table, where it keeps them; none on a table built from entities. */
  definition?: readonly StoredDefinition[];
  /** The foreign keys to tables this AST does not hold, which a rebuild keeps as they are. */
  readonly externalForeignKeys: ForeignKeySchema[];

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

  /** Action on delete of referenced row */
  readonly onDelete?: ForeignKeyAction;
  /** Action on update of referenced row */
  readonly onUpdate?: ForeignKeyAction;
}

/**
 * Index node in the schema graph.
 * Represents a database index on one or more columns.
 */
export type IndexNode = IndexSchema & {
  /** Reference to the table this index belongs to */
  readonly table: TableNode;
};

/**
 * One node's difference, shaped like a migration's `Change`: `to` is the entities' side and `from` the
 * database's. `to` alone means create, `from` alone means drop, and both mean alter. Being a union, testing
 * one end narrows which ends are present; `Altered` holds the extra fields an alter carries.
 */
export type NodeChange<T, Altered = unknown> =
  | { readonly from?: undefined; readonly to: T }
  | { readonly from: T; readonly to?: undefined }
  | (Alteration<T> & Altered);

/** A column to create, drop or alter; an alter lists in `changed` which parts of the column differ. */
export type ColumnDiff = NodeChange<ColumnNode, { readonly changed: readonly ColumnFacet[] }> & {
  readonly table: string;
  readonly column: string;
  /** Whether the change can lose data: a drop, or a type change that narrows the column. */
  readonly isBreaking?: boolean;
  readonly description?: string;
};

/** A part of a column the differ compares. */
export type ColumnFacet = 'type' | 'nullable' | 'default';

/** An index to create, drop or alter; an alter's `description` says what differs. */
export type IndexDiff = NodeChange<IndexNode> & {
  readonly table: string;
  readonly name: string;
  readonly description?: string;
};

/** A foreign key to create, drop or alter, matched by its tables and columns, never by name. */
export type RelationshipDiff = NodeChange<RelationshipNode> & { readonly name: string; readonly fromTable: string };

/**
 * Two primary keys with different columns. Keys are compared by their columns in order, never by name:
 * `(a, b)` differs from `(b, a)`, while `Member_pkey` and `Member__userId_pk` over the same columns are equal.
 * `from` keeps the name the database reported, the only name a `DROP` can use.
 */
export type PrimaryKeyDiff = Change<PrimaryKeySchema> & { readonly table: string };

/** The differences within a table that exists on both sides. */
export interface TableDiff {
  readonly columns: ColumnDiff[];
  readonly indexes: IndexDiff[];
  /** Set only when the two primary keys have different columns. */
  readonly primaryKey?: PrimaryKeyDiff;
}

/** How two schemas differ, as the changes a migration would make, grouped by kind. */
export interface SchemaDiffResult {
  /** Tables only one side has: `to` for a table the database lacks, `from` for one no entity declares. */
  readonly tables: NodeChange<TableNode>[];
  readonly columns: ColumnDiff[];
  readonly indexes: IndexDiff[];
  readonly primaryKeys: PrimaryKeyDiff[];
  readonly relationships: RelationshipDiff[];
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
  | 'unexpected_relationship'
  | 'relationship_mismatch';

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
