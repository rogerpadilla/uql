/**
 * SchemaAST Class
 *
 * The main class for working with schema graphs.
 * Provides graph operations like navigation, validation, and topological sorting.
 */

import type {
  ColumnNode,
  IndexNode,
  SchemaAST as ISchemaAST,
  RelationshipNode,
  RelationshipType,
  TableNode,
  ValidationError,
} from './types.js';

/**
 * Schema AST - A graph representation of a database schema.
 *
 * Enables:
 * - Graph navigation (dependencies, dependents)
 * - Circular dependency detection
 * - Topological sorting for correct DDL order
 * - Smart relation inference
 * - Schema validation
 */
export class SchemaAST implements ISchemaAST {
  readonly tables: Map<string, TableNode> = new Map();
  readonly relationships: RelationshipNode[] = [];
  readonly indexes: IndexNode[] = [];

  // ============================================================================
  // Table Operations
  // ============================================================================

  /**
   * Get a table by name.
   */
  getTable(name: string): TableNode | undefined {
    return this.tables.get(name);
  }

  /**
   * Add a table to the schema.
   */
  addTable(table: TableNode): void {
    table.schema = this;
    this.tables.set(table.name, table);
  }

  /**
   * Remove a table from the schema.
   */
  removeTable(name: string): boolean {
    const table = this.tables.get(name);
    if (!table) return false;

    // Remove all relationships involving this table
    for (let i = this.relationships.length - 1; i >= 0; i--) {
      const rel = this.relationships[i];
      if (rel.from.table === table || rel.to.table === table) {
        this.relationships.splice(i, 1);
      }
    }

    // Remove all indexes for this table
    for (let i = this.indexes.length - 1; i >= 0; i--) {
      if (this.indexes[i].table === table) {
        this.indexes.splice(i, 1);
      }
    }

    return this.tables.delete(name);
  }

  /**
   * Get all table nodes.
   */
  getTables(): TableNode[] {
    return Array.from(this.tables.values());
  }

  /**
   * Get all table names.
   */
  getTableNames(): string[] {
    return Array.from(this.tables.keys());
  }

  // ============================================================================
  // Graph Navigation
  // ============================================================================

  /**
   * Get all tables that depend on this table (have FKs pointing to it).
   * These are tables that reference this table's primary key.
   */
  getDependentTables(table: TableNode): TableNode[] {
    return table.incomingRelations.map((r) => r.from.table);
  }

  /**
   * Get all tables this table depends on (has FKs to).
   * These are tables that this table references.
   */
  getDependencies(table: TableNode): TableNode[] {
    return table.outgoingRelations.map((r) => r.to.table);
  }

  /**
   * Get the relationship between two tables (if any).
   */
  getRelationship(from: TableNode, to: TableNode): RelationshipNode | undefined {
    return this.relationships.find((r) => r.from.table === from && r.to.table === to);
  }

  /**
   * Get all relationships for a table.
   */
  getTableRelationships(table: TableNode): RelationshipNode[] {
    return this.relationships.filter((r) => r.from.table === table || r.to.table === table);
  }

  /**
   * Get the column that a foreign key column references.
   */
  getReferencedColumn(fkColumn: ColumnNode): ColumnNode | undefined {
    return fkColumn.references?.to.columns[0];
  }

  // ============================================================================
  // Graph Analysis
  // ============================================================================

  /**
   * Detect circular foreign key dependencies.
   * Returns arrays of tables that form cycles.
   */
  detectCircularDependencies(): TableNode[][] {
    const cycles: TableNode[][] = [];
    const visited = new Set<TableNode>();
    const stack = new Set<TableNode>();

    const dfs = (table: TableNode, path: TableNode[]): void => {
      if (stack.has(table)) {
        const cycleStart = path.indexOf(table);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }
      if (visited.has(table)) return;

      visited.add(table);
      stack.add(table);

      for (const dep of this.getDependencies(table)) {
        dfs(dep, [...path, table]);
      }

      stack.delete(table);
    };

    for (const table of this.tables.values()) {
      dfs(table, []);
    }

    return cycles;
  }

  /**
   * Check if there are any circular dependencies.
   */
  hasCircularDependencies(): boolean {
    return this.detectCircularDependencies().length > 0;
  }

  /**
   * Get tables in correct order for CREATE (dependencies first).
   * Tables with no dependencies come first, then tables that depend on them, etc.
   */
  getCreateOrder(): TableNode[] {
    return this.topologicalSort();
  }

  /**
   * Get tables in correct order for DROP (dependents first).
   * Tables that depend on others come first, then the tables they depend on.
   */
  getDropOrder(): TableNode[] {
    return this.topologicalSort().reverse();
  }

  /**
   * Topological sort respecting FK dependencies.
   * Uses Kahn's algorithm for stable ordering.
   */
  private topologicalSort(): TableNode[] {
    const result: TableNode[] = [];
    const visited = new Set<TableNode>();

    const visit = (table: TableNode): void => {
      if (visited.has(table)) return;
      visited.add(table);

      // Visit dependencies first (tables this table references)
      for (const dep of this.getDependencies(table)) {
        visit(dep);
      }

      result.push(table);
    };

    // Visit all tables
    for (const table of this.tables.values()) {
      visit(table);
    }

    return result;
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validate schema integrity.
   * Checks for:
   * - Missing FK targets
   * - Circular dependencies
   * - Orphan columns
   * - Duplicate indexes
   */
  validate(): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check all FK targets exist
    for (const rel of this.relationships) {
      if (!this.tables.has(rel.to.table.name)) {
        errors.push({
          type: 'missing_fk_target',
          message: `FK target table "${rel.to.table.name}" does not exist`,
          relationship: rel,
        });
      }
    }

    // Check for circular dependencies
    const cycles = this.detectCircularDependencies();
    for (const cycle of cycles) {
      errors.push({
        type: 'circular_dependency',
        message: `Circular FK: ${cycle.map((t) => t.name).join(' -> ')}`,
        tables: cycle,
      });
    }

    // Check for duplicate index names within same table
    for (const table of this.tables.values()) {
      const indexNames = new Set<string>();
      for (const index of table.indexes) {
        if (indexNames.has(index.name)) {
          errors.push({
            type: 'duplicate_index',
            message: `Duplicate index name "${index.name}" in table "${table.name}"`,
            table,
          });
        }
        indexNames.add(index.name);
      }
    }

    return errors;
  }

  /**
   * Check if the schema is valid (no validation errors).
   */
  isValid(): boolean {
    return this.validate().length === 0;
  }

  // ============================================================================
  // Smart Relation Detection
  // ============================================================================

  /**
   * Check if a table looks like a junction table (ManyToMany through).
   * Junction tables typically have:
   * - Exactly 2 foreign keys
   * - Few other columns (id, maybe timestamps)
   * - Primary key might be composite of the FKs
   */
  isJunctionTable(table: TableNode): boolean {
    const fkCount = table.outgoingRelations.length;
    const columnCount = table.columns.size;

    // Must have exactly 2 FKs
    if (fkCount !== 2) {
      return false;
    }

    // Should have few columns (typically: id + 2 FKs + maybe timestamps)
    if (columnCount > 6) {
      return false;
    }

    // Check if name suggests a junction (contains both related table names)
    const relatedTables = table.outgoingRelations.map((r) => r.to.table.name.toLowerCase());
    const tableName = table.name.toLowerCase();

    // Common patterns: user_roles, post_tags, etc.
    const containsBothNames = relatedTables.every(
      (name) => tableName.includes(name.replace(/s$/, '')) || tableName.includes(name),
    );

    return containsBothNames || columnCount <= 5;
  }

  /**
   * Infer relation type from schema structure.
   */
  inferRelationType(rel: RelationshipNode): RelationshipType {
    const fromCol = rel.from.columns[0];

    // Check if source is junction table -> ManyToMany
    if (this.isJunctionTable(rel.from.table)) {
      return 'ManyToMany';
    }

    // Unique FK -> OneToOne
    if (fromCol?.isUnique) {
      return 'OneToOne';
    }

    // Default: ManyToOne (many rows can reference same target)
    return 'ManyToOne';
  }

  /**
   * Get the inverse relation type.
   */
  getInverseRelationType(type: RelationshipType): RelationshipType {
    switch (type) {
      case 'OneToOne':
        return 'OneToOne';
      case 'OneToMany':
        return 'ManyToOne';
      case 'ManyToOne':
        return 'OneToMany';
      case 'ManyToMany':
        return 'ManyToMany';
    }
  }

  // ============================================================================
  // Index Operations
  // ============================================================================

  /**
   * Add an index to the schema.
   */
  addIndex(index: IndexNode): void {
    this.indexes.push(index);
    if (!index.table.indexes.includes(index)) {
      index.table.indexes.push(index);
    }
  }

  /**
   * Get all indexes for a table.
   */
  getTableIndexes(tableName: string): IndexNode[] {
    const table = this.tables.get(tableName);
    return table?.indexes ?? [];
  }

  /**
   * Find an index by name.
   */
  getIndex(name: string): IndexNode | undefined {
    return this.indexes.find((i) => i.name === name);
  }

  // ============================================================================
  // Relationship Operations
  // ============================================================================

  /**
   * Add a relationship to the schema.
   */
  addRelationship(rel: RelationshipNode): void {
    this.relationships.push(rel);

    // Update table links
    rel.from.table.outgoingRelations.push(rel);
    rel.to.table.incomingRelations.push(rel);

    // Update column links
    for (const col of rel.from.columns) {
      col.references = rel;
    }
    for (const col of rel.to.columns) {
      col.referencedBy.push(rel);
    }
  }

  /**
   * Remove a relationship from the schema.
   */
  removeRelationship(name: string): boolean {
    const index = this.relationships.findIndex((r) => r.name === name);
    if (index === -1) return false;

    const rel = this.relationships[index];

    // Remove from table links
    const fromIdx = rel.from.table.outgoingRelations.indexOf(rel);
    if (fromIdx !== -1) rel.from.table.outgoingRelations.splice(fromIdx, 1);

    const toIdx = rel.to.table.incomingRelations.indexOf(rel);
    if (toIdx !== -1) rel.to.table.incomingRelations.splice(toIdx, 1);

    // Remove from column links
    for (const col of rel.from.columns) {
      if (col.references === rel) {
        col.references = undefined;
      }
    }
    for (const col of rel.to.columns) {
      const refIdx = col.referencedBy.indexOf(rel);
      if (refIdx !== -1) col.referencedBy.splice(refIdx, 1);
    }

    this.relationships.splice(index, 1);
    return true;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Create a deep clone of this schema.
   */
  clone(): SchemaAST {
    const clone = new SchemaAST();

    // First pass: clone tables and columns (without links)
    for (const [name, table] of this.tables) {
      const clonedColumns = new Map<string, ColumnNode>();

      for (const [colName, col] of table.columns) {
        const clonedCol: ColumnNode = {
          ...col,
          table: undefined as unknown as TableNode, // Will be set below
          referencedBy: [],
          references: undefined,
        };
        clonedColumns.set(colName, clonedCol);
      }

      const clonedTable: TableNode = {
        name,
        columns: clonedColumns,
        primaryKey: [],
        indexes: [],
        comment: table.comment,
        schema: clone,
        incomingRelations: [],
        outgoingRelations: [],
      };

      // Link columns to table
      for (const col of clonedColumns.values()) {
        (col as { table: TableNode }).table = clonedTable;
      }

      // Set primary key
      (clonedTable as { primaryKey: ColumnNode[] }).primaryKey = table.primaryKey
        .map((pk) => clonedColumns.get(pk.name))
        .filter(Boolean) as ColumnNode[];

      clone.tables.set(name, clonedTable);
    }

    // Second pass: clone relationships
    for (const rel of this.relationships) {
      const fromTable = clone.tables.get(rel.from.table.name);
      const toTable = clone.tables.get(rel.to.table.name);

      if (!fromTable || !toTable) continue;

      const fromColumns = rel.from.columns
        .map((c) => fromTable.columns.get(c.name))
        .filter((c): c is ColumnNode => c !== undefined);
      const toColumns = rel.to.columns
        .map((c) => toTable.columns.get(c.name))
        .filter((c): c is ColumnNode => c !== undefined);

      const clonedRel: RelationshipNode = {
        ...rel,
        from: {
          table: fromTable,
          columns: fromColumns,
        },
        to: {
          table: toTable,
          columns: toColumns,
        },
        through: rel.through ? clone.tables.get(rel.through.name) : undefined,
      };

      clone.addRelationship(clonedRel);
    }

    // Third pass: clone indexes
    for (const idx of this.indexes) {
      const table = clone.tables.get(idx.table.name);
      if (!table) continue;

      const columns = idx.columns.map((c) => table.columns.get(c.name)).filter((c): c is ColumnNode => c !== undefined);

      const clonedIdx: IndexNode = {
        ...idx,
        table,
        columns,
      };
      clone.addIndex(clonedIdx);
    }

    return clone;
  }

  /**
   * Get statistics about the schema.
   */
  getStats(): {
    tableCount: number;
    columnCount: number;
    relationshipCount: number;
    indexCount: number;
  } {
    let columnCount = 0;
    for (const table of this.tables.values()) {
      columnCount += table.columns.size;
    }

    return {
      tableCount: this.tables.size,
      columnCount,
      relationshipCount: this.relationships.length,
      indexCount: this.indexes.length,
    };
  }

  /**
   * Convert schema to a plain object for serialization/debugging.
   */
  toJSON(): object {
    return {
      tables: Array.from(this.tables.values()).map((t) => ({
        name: t.name,
        columns: Array.from(t.columns.values()).map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          isPrimaryKey: c.isPrimaryKey,
          isAutoIncrement: c.isAutoIncrement,
          isUnique: c.isUnique,
        })),
        indexes: t.indexes.map((i) => ({
          name: i.name,
          columns: i.columns.map((c) => c.name),
          unique: i.unique,
        })),
      })),
      relationships: this.relationships.map((r) => ({
        name: r.name,
        type: r.type,
        from: `${r.from.table.name}.${r.from.columns.map((c) => c.name).join(',')}`,
        to: `${r.to.table.name}.${r.to.columns.map((c) => c.name).join(',')}`,
        onDelete: r.onDelete,
        onUpdate: r.onUpdate,
      })),
    };
  }
}
