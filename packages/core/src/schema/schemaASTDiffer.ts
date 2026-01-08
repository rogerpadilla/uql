/**
 * SchemaAST Differ
 *
 * Compares two SchemaAST instances and produces a detailed diff.
 * Used for:
 * - Migration generation (entity vs database)
 * - Drift detection (expected vs actual)
 * - Schema synchronization
 */

import { areTypesEqual, isBreakingTypeChange } from './canonicalType.js';
import type { SchemaAST } from './schemaAST.js';
import type {
  ColumnDiff,
  ColumnNode,
  IndexDiff,
  IndexNode,
  RelationshipDiff,
  RelationshipNode,
  SchemaDiffResult,
  TableDiff,
  TableNode,
} from './types.js';
import { DEFAULT_FOREIGN_KEY_ACTION } from './types.js';

/**
 * Options for schema diffing.
 */
export interface DiffOptions {
  /** Compare indexes */
  compareIndexes?: boolean;
  /** Compare foreign keys/relationships */
  compareRelationships?: boolean;
  /** Ignore case differences in names */
  ignoreCase?: boolean;
  /** Tables to exclude from comparison */
  excludeTables?: string[];
}

/**
 * Default diff options.
 */
const DEFAULT_OPTIONS: Required<DiffOptions> = {
  compareIndexes: true,
  compareRelationships: true,
  ignoreCase: false,
  excludeTables: [],
};

/**
 * Compares two SchemaAST instances and produces a detailed diff.
 */
export class SchemaASTDiffer {
  /**
   * Compare two schemas and return the differences.
   *
   * @param source - The "expected" or "desired" schema (e.g., from entities)
   * @param target - The "actual" or "current" schema (e.g., from database)
   * @param options - Diff options
   * @returns Detailed diff result
   */
  diff(source: SchemaAST, target: SchemaAST, options: DiffOptions = {}): SchemaDiffResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const normalizeName = opts.ignoreCase ? (n: string) => n.toLowerCase() : (n: string) => n;

    const tablesToCreate: TableNode[] = [];
    const tablesToDrop: TableNode[] = [];
    const tablesToAlter: TableDiff[] = [];
    const columnDiffs: ColumnDiff[] = [];
    const indexDiffs: IndexDiff[] = [];
    const relationshipDiffs: RelationshipDiff[] = [];

    // Build lookup maps
    const sourceTableMap = new Map<string, TableNode>();
    const targetTableMap = new Map<string, TableNode>();

    for (const table of source.tables.values()) {
      if (!opts.excludeTables.includes(table.name)) {
        sourceTableMap.set(normalizeName(table.name), table);
      }
    }

    for (const table of target.tables.values()) {
      if (!opts.excludeTables.includes(table.name)) {
        targetTableMap.set(normalizeName(table.name), table);
      }
    }

    // Find tables to create (in source but not target)
    for (const [name, sourceTable] of sourceTableMap) {
      if (!targetTableMap.has(name)) {
        tablesToCreate.push(sourceTable);
      }
    }

    // Find tables to drop (in target but not source)
    for (const [name, targetTable] of targetTableMap) {
      if (!sourceTableMap.has(name)) {
        tablesToDrop.push(targetTable);
      }
    }

    // Find tables that need alteration
    for (const [name, sourceTable] of sourceTableMap) {
      const targetTable = targetTableMap.get(name);
      if (!targetTable) continue;

      const tableDiff = this.diffTable(sourceTable, targetTable, opts);
      if (tableDiff) {
        tablesToAlter.push(tableDiff);

        // Collect column diffs
        if (tableDiff.columnDiffs) {
          columnDiffs.push(...tableDiff.columnDiffs);
        }

        // Collect index diffs
        if (tableDiff.indexDiffs) {
          indexDiffs.push(...tableDiff.indexDiffs);
        }

        // Collect relationship diffs
        if (tableDiff.relationshipDiffs) {
          relationshipDiffs.push(...tableDiff.relationshipDiffs);
        }
      }
    }

    // Compare relationships (global view, not just per-table)
    if (opts.compareRelationships) {
      const relDiffs = this.diffRelationships(source, target, opts);
      relationshipDiffs.push(...relDiffs);
    }

    // Determine if there are any differences
    const hasDifferences =
      tablesToCreate.length > 0 ||
      tablesToDrop.length > 0 ||
      tablesToAlter.length > 0 ||
      relationshipDiffs.length > 0 ||
      indexDiffs.length > 0;

    // Determine if any changes are breaking
    const hasBreakingChanges = tablesToDrop.length > 0 || columnDiffs.some((d) => d.isBreaking);

    return {
      tablesToCreate,
      tablesToDrop,
      tablesToAlter,
      columnDiffs,
      indexDiffs,
      relationshipDiffs,
      hasDifferences,
      hasBreakingChanges,
    };
  }

  /**
   * Compare two tables and return the differences.
   */
  private diffTable(source: TableNode, target: TableNode, opts: Required<DiffOptions>): TableDiff | undefined {
    const normalizeName = opts.ignoreCase ? (n: string) => n.toLowerCase() : (n: string) => n;

    const columnDiffs = this.diffTableColumns(source, target, normalizeName);
    const indexDiffs = opts.compareIndexes ? this.diffTableIndexes(source, target, normalizeName) : [];

    // If no differences, return undefined
    if (columnDiffs.length === 0 && indexDiffs.length === 0) {
      return undefined;
    }

    return {
      name: source.name,
      type: 'alter',
      columnDiffs,
      indexDiffs,
    };
  }

  /**
   * Compare columns between two tables.
   */
  private diffTableColumns(source: TableNode, target: TableNode, normalizeName: (n: string) => string): ColumnDiff[] {
    const columnDiffs: ColumnDiff[] = [];

    // Build column maps
    const sourceColMap = new Map<string, ColumnNode>();
    const targetColMap = new Map<string, ColumnNode>();

    for (const col of source.columns.values()) {
      sourceColMap.set(normalizeName(col.name), col);
    }

    for (const col of target.columns.values()) {
      targetColMap.set(normalizeName(col.name), col);
    }

    // Columns to add (in source but not target)
    for (const [name, sourceCol] of sourceColMap) {
      if (!targetColMap.has(name)) {
        columnDiffs.push({
          table: source.name,
          column: sourceCol.name,
          type: 'add',
          expected: sourceCol,
          description: `Add column "${sourceCol.name}"`,
        });
      }
    }

    // Columns to drop (in target but not source)
    for (const [name, targetCol] of targetColMap) {
      if (!sourceColMap.has(name)) {
        columnDiffs.push({
          table: target.name,
          column: targetCol.name,
          type: 'drop',
          actual: targetCol,
          isBreaking: true,
          description: `Drop column "${targetCol.name}"`,
        });
      }
    }

    // Columns that might need alteration
    for (const [name, sourceCol] of sourceColMap) {
      const targetCol = targetColMap.get(name);
      if (!targetCol) continue;

      const colDiff = this.diffColumn(source.name, sourceCol, targetCol);
      if (colDiff) {
        columnDiffs.push(colDiff);
      }
    }

    return columnDiffs;
  }

  /**
   * Compare indexes between two tables.
   */
  private diffTableIndexes(source: TableNode, target: TableNode, normalizeName: (n: string) => string): IndexDiff[] {
    const indexDiffs: IndexDiff[] = [];
    const sourceIndexMap = new Map<string, IndexNode>();
    const targetIndexMap = new Map<string, IndexNode>();

    for (const idx of source.indexes) {
      sourceIndexMap.set(normalizeName(idx.name), idx);
    }

    for (const idx of target.indexes) {
      targetIndexMap.set(normalizeName(idx.name), idx);
    }

    // Indexes to create
    for (const [, sourceIdx] of sourceIndexMap) {
      const normalizedName = normalizeName(sourceIdx.name);
      if (!targetIndexMap.has(normalizedName)) {
        indexDiffs.push({
          name: sourceIdx.name,
          table: source.name,
          type: 'create',
          expected: sourceIdx,
        });
      }
    }

    // Indexes to drop
    for (const [, targetIdx] of targetIndexMap) {
      const normalizedName = normalizeName(targetIdx.name);
      if (!sourceIndexMap.has(normalizedName)) {
        indexDiffs.push({
          name: targetIdx.name,
          table: target.name,
          type: 'drop',
          actual: targetIdx,
        });
      }
    }

    // Indexes that might differ
    for (const [name, sourceIdx] of sourceIndexMap) {
      const targetIdx = targetIndexMap.get(name);
      if (!targetIdx) continue;

      const idxDiff = this.diffIndex(source.name, sourceIdx, targetIdx);
      if (idxDiff) {
        indexDiffs.push(idxDiff);
      }
    }

    return indexDiffs;
  }

  /**
   * Compare two columns and return the difference.
   */
  private diffColumn(tableName: string, source: ColumnNode, target: ColumnNode): ColumnDiff | undefined {
    const differences: string[] = [];

    // Compare types
    if (!areTypesEqual(source.type, target.type)) {
      differences.push(`type: ${this.formatType(source.type)} → ${this.formatType(target.type)}`);
    }

    // Compare nullability
    if (source.nullable !== target.nullable) {
      differences.push(`nullable: ${target.nullable} → ${source.nullable}`);
    }

    // Compare unique constraint
    if (source.isUnique !== target.isUnique) {
      differences.push(`unique: ${target.isUnique} → ${source.isUnique}`);
    }

    // Compare auto-increment
    if (source.isAutoIncrement !== target.isAutoIncrement) {
      differences.push(`autoIncrement: ${target.isAutoIncrement} → ${source.isAutoIncrement}`);
    }

    // Compare default values (if both defined)
    if (this.normalizeDefault(source.defaultValue) !== this.normalizeDefault(target.defaultValue)) {
      differences.push(`default: ${target.defaultValue ?? 'NULL'} → ${source.defaultValue ?? 'NULL'}`);
    }

    if (differences.length === 0) {
      return undefined;
    }

    return {
      table: tableName,
      column: source.name,
      type: 'alter',
      expected: source,
      actual: target,
      isBreaking: isBreakingTypeChange(target.type, source.type),
      description: differences.join(', '),
    };
  }

  /**
   * Compare two indexes and return the difference.
   */
  private diffIndex(tableName: string, source: IndexNode, target: IndexNode): IndexDiff | undefined {
    // Compare columns
    const sourceColNames = source.columns.map((c) => c.name).join(',');
    const targetColNames = target.columns.map((c) => c.name).join(',');

    if (sourceColNames !== targetColNames) {
      return {
        name: source.name,
        table: tableName,
        type: 'alter',
        expected: source,
        actual: target,
      };
    }

    // Compare uniqueness
    if (source.unique !== target.unique) {
      return {
        name: source.name,
        table: tableName,
        type: 'alter',
        expected: source,
        actual: target,
      };
    }

    // Compare index type
    if (source.type !== target.type) {
      return {
        name: source.name,
        table: tableName,
        type: 'alter',
        expected: source,
        actual: target,
      };
    }

    return undefined;
  }

  /**
   * Compare relationships at the schema level.
   */
  private diffRelationships(source: SchemaAST, target: SchemaAST, opts: Required<DiffOptions>): RelationshipDiff[] {
    const diffs: RelationshipDiff[] = [];
    const normalizeName = opts.ignoreCase ? (n: string) => n.toLowerCase() : (n: string) => n;

    // Build relationship maps by a normalized key
    const sourceRelMap = new Map<string, RelationshipNode>();
    const targetRelMap = new Map<string, RelationshipNode>();

    for (const rel of source.relationships) {
      const key = this.getRelationshipKey(rel, normalizeName);
      sourceRelMap.set(key, rel);
    }

    for (const rel of target.relationships) {
      const key = this.getRelationshipKey(rel, normalizeName);
      targetRelMap.set(key, rel);
    }

    // Relationships to create
    for (const [key, sourceRel] of sourceRelMap) {
      if (!targetRelMap.has(key)) {
        diffs.push({
          name: sourceRel.name,
          fromTable: sourceRel.from.table.name,
          toTable: sourceRel.to.table.name,
          type: 'create',
          expected: sourceRel,
        });
      }
    }

    // Relationships to drop
    for (const [key, targetRel] of targetRelMap) {
      if (!sourceRelMap.has(key)) {
        diffs.push({
          name: targetRel.name,
          fromTable: targetRel.from.table.name,
          toTable: targetRel.to.table.name,
          type: 'drop',
          actual: targetRel,
        });
      }
    }

    // Relationships that differ
    for (const [key, sourceRel] of sourceRelMap) {
      const targetRel = targetRelMap.get(key);
      if (!targetRel) continue;

      const relDiff = this.diffRelationship(sourceRel, targetRel);
      if (relDiff) {
        diffs.push(relDiff);
      }
    }

    return diffs;
  }

  /**
   * Compare two relationships.
   */
  private diffRelationship(source: RelationshipNode, target: RelationshipNode): RelationshipDiff | undefined {
    // Compare on delete/update actions (normalizing defaults)
    const sDelete = source.onDelete ?? DEFAULT_FOREIGN_KEY_ACTION;
    const tDelete = target.onDelete ?? DEFAULT_FOREIGN_KEY_ACTION;
    const sUpdate = source.onUpdate ?? DEFAULT_FOREIGN_KEY_ACTION;
    const tUpdate = target.onUpdate ?? DEFAULT_FOREIGN_KEY_ACTION;

    if (sDelete !== tDelete || sUpdate !== tUpdate) {
      return {
        name: source.name,
        fromTable: source.from.table.name,
        toTable: source.to.table.name,
        type: 'alter',
        expected: source,
        actual: target,
      };
    }

    return undefined;
  }

  /**
   * Generate a unique key for a relationship based on its structure.
   */
  private getRelationshipKey(rel: RelationshipNode, normalizeName: (n: string) => string): string {
    const fromCols = rel.from.columns
      .map((c) => c.name)
      .sort()
      .join(',');
    const toCols = rel.to.columns
      .map((c) => c.name)
      .sort()
      .join(',');
    return `${normalizeName(rel.from.table.name)}.${fromCols}->${normalizeName(rel.to.table.name)}.${toCols}`;
  }

  /**
   * Format a canonical type for display.
   */
  private formatType(type: ColumnNode['type']): string {
    let result = type.category;
    if (type.size) result += `(${type.size})`;
    if (type.length) result += `(${type.length})`;
    if (type.precision) {
      result += type.scale !== undefined ? `(${type.precision},${type.scale})` : `(${type.precision})`;
    }
    if (type.unsigned) result += ' unsigned';
    return result;
  }

  /**
   * Normalize default values for comparison.
   */
  private normalizeDefault(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') {
      // Normalize function calls
      const upper = value.toUpperCase();
      if (upper.includes('NOW()') || upper.includes('CURRENT_TIMESTAMP')) {
        return 'CURRENT_TIMESTAMP';
      }
    }
    return String(value);
  }
}

/**
 * Create a differ and run a comparison.
 * Convenience function for one-off comparisons.
 */
export function diffSchemas(source: SchemaAST, target: SchemaAST, options?: DiffOptions): SchemaDiffResult {
  const differ = new SchemaASTDiffer();
  return differ.diff(source, target, options);
}
