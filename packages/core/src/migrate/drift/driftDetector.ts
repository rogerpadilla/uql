/**
 * Drift Detector
 *
 * Detects schema drift between expected schema (from entities) and
 * actual database schema.
 */

import { canonicalToSql } from '../../schema/canonicalType.js';
import type { SchemaAST } from '../../schema/schemaAST.js';
import { SchemaASTDiffer } from '../../schema/schemaASTDiffer.js';
import type { CanonicalType, Drift, DriftReport, DriftStatus } from '../../schema/types.js';
import type { Dialect } from '../../type/index.js';

/**
 * Options for drift detection.
 */
export interface DriftDetectorOptions {
  /** Include column type mismatches */
  checkTypes?: boolean;
  /** Include nullable mismatches */
  checkNullable?: boolean;
  /** Include index differences */
  checkIndexes?: boolean;
  /** Include foreign key differences */
  checkForeignKeys?: boolean;
  /** Include default value differences */
  checkDefaults?: boolean;
  /** SQL dialect for type formatting */
  dialect?: Dialect;
}

/**
 * Detects drift between expected and actual database schemas.
 */
export class DriftDetector {
  private readonly options: Required<DriftDetectorOptions>;
  private readonly dialect: Dialect;

  constructor(
    private readonly expectedAST: SchemaAST,
    private readonly actualAST: SchemaAST,
    options: DriftDetectorOptions = {},
  ) {
    this.options = {
      checkTypes: options.checkTypes ?? true,
      checkNullable: options.checkNullable ?? true,
      checkIndexes: options.checkIndexes ?? true,
      checkForeignKeys: options.checkForeignKeys ?? true,
      checkDefaults: options.checkDefaults ?? false, // Often differ between SQL and entity
      dialect: options.dialect ?? 'postgres',
    };
    this.dialect = this.options.dialect;
  }

  /**
   * Detect all schema drift.
   */
  detect(): DriftReport {
    const differ = new SchemaASTDiffer();
    const diff = differ.diff(this.expectedAST, this.actualAST);

    const drifts: Drift[] = [
      ...this.detectTableDrifts(diff),
      ...this.detectColumnDrifts(diff),
      ...this.detectIndexDrifts(diff),
      ...this.detectRelationshipDrifts(diff),
    ];

    return {
      status: this.calculateStatus(drifts),
      drifts,
      summary: this.createSummary(drifts),
      generatedAt: new Date(),
    };
  }

  /**
   * Detect table-level drifts (missing/unexpected tables).
   */
  private detectTableDrifts(diff: ReturnType<SchemaASTDiffer['diff']>): Drift[] {
    const drifts: Drift[] = [];

    for (const table of diff.tablesToCreate) {
      drifts.push({
        type: 'missing_table',
        severity: 'critical',
        table: table.name,
        details: `Entity "${table.name}" exists but table not in database`,
        suggestion: 'Run migrations to create table',
      });
    }

    for (const table of diff.tablesToDrop) {
      drifts.push({
        type: 'unexpected_table',
        severity: 'warning',
        table: table.name,
        details: `Table "${table.name}" exists in database but no matching entity`,
        suggestion: 'Create entity or drop table',
      });
    }

    return drifts;
  }

  /**
   * Detect column-level drifts.
   */
  private detectColumnDrifts(diff: ReturnType<SchemaASTDiffer['diff']>): Drift[] {
    const drifts: Drift[] = [];

    for (const colDiff of diff.columnDiffs) {
      if (colDiff.type === 'add') {
        drifts.push({
          type: 'missing_column',
          severity: 'critical',
          table: colDiff.table,
          column: colDiff.column,
          details: `Column "${colDiff.column}" expected but not found in database`,
          suggestion: 'Run migration to add column',
        });
      } else if (colDiff.type === 'drop') {
        drifts.push({
          type: 'unexpected_column',
          severity: 'warning',
          table: colDiff.table,
          column: colDiff.column,
          details: `Column "${colDiff.column}" exists in database but not in entity`,
          suggestion: 'Add to entity or create migration to drop',
        });
      } else if (colDiff.type === 'alter') {
        this.addAlterColumnDrifts(colDiff, drifts);
      }
    }

    return drifts;
  }

  /**
   * Add drifts for column alterations (type/nullable mismatches).
   */
  private addAlterColumnDrifts(
    colDiff: {
      table: string;
      column: string;
      expected?: { type?: unknown; nullable?: boolean };
      actual?: { type?: unknown; nullable?: boolean };
      isBreaking?: boolean;
    },
    drifts: Drift[],
  ): void {
    if (this.options.checkTypes && colDiff.expected && colDiff.actual) {
      const expectedType = this.formatType(colDiff.expected.type as CanonicalType | undefined);
      const actualType = this.formatType(colDiff.actual.type as CanonicalType | undefined);
      if (expectedType !== actualType) {
        drifts.push({
          type: 'type_mismatch',
          severity: colDiff.isBreaking ? 'critical' : 'warning',
          table: colDiff.table,
          column: colDiff.column,
          expected: expectedType,
          actual: actualType,
          details: `Type mismatch for "${colDiff.column}": expected ${expectedType}, got ${actualType}`,
          suggestion: colDiff.isBreaking
            ? 'Data truncation risk! Create migration to fix.'
            : 'Create migration to align types',
        });
      }
    }

    if (this.options.checkNullable && colDiff.expected && colDiff.actual) {
      if (colDiff.expected.nullable !== colDiff.actual.nullable) {
        drifts.push({
          type: 'constraint_mismatch',
          severity: 'warning',
          table: colDiff.table,
          column: colDiff.column,
          expected: colDiff.expected.nullable ? 'NULLABLE' : 'NOT NULL',
          actual: colDiff.actual.nullable ? 'NULLABLE' : 'NOT NULL',
          details: `Nullable mismatch for "${colDiff.column}"`,
          suggestion: 'Align nullable setting in entity or database',
        });
      }
    }
  }

  /**
   * Detect index drifts.
   */
  private detectIndexDrifts(diff: ReturnType<SchemaASTDiffer['diff']>): Drift[] {
    if (!this.options.checkIndexes) return [];

    const drifts: Drift[] = [];

    for (const idxDiff of diff.indexDiffs) {
      if (idxDiff.type === 'create') {
        drifts.push({
          type: 'missing_index',
          severity: 'warning',
          table: idxDiff.table,
          index: idxDiff.name,
          details: `Index "${idxDiff.name}" expected but not found in database`,
          suggestion: 'Create index via migration',
        });
      } else if (idxDiff.type === 'drop') {
        drifts.push({
          type: 'unexpected_index',
          severity: 'info',
          table: idxDiff.table,
          index: idxDiff.name,
          details: `Index "${idxDiff.name}" exists in database but not defined in entity`,
          suggestion: 'Add @Field({ index }) or create migration to drop',
        });
      }
    }

    return drifts;
  }

  /**
   * Detect relationship/FK drifts.
   */
  private detectRelationshipDrifts(diff: ReturnType<SchemaASTDiffer['diff']>): Drift[] {
    if (!this.options.checkForeignKeys) return [];

    const drifts: Drift[] = [];

    for (const relDiff of diff.relationshipDiffs) {
      if (relDiff.type === 'create') {
        drifts.push({
          type: 'missing_relationship',
          severity: 'warning',
          table: relDiff.fromTable,
          relationship: relDiff.name,
          details: `FK "${relDiff.name}" expected but not found in database`,
          suggestion: 'Add FK constraint or remove relation from entity',
        });
      } else if (relDiff.type === 'drop') {
        drifts.push({
          type: 'unexpected_relationship',
          severity: 'info',
          table: relDiff.fromTable,
          relationship: relDiff.name,
          details: `FK "${relDiff.name}" exists in database but not in entity`,
          suggestion: 'Add relation to entity or drop FK',
        });
      }
    }

    return drifts;
  }

  /**
   * Calculate overall status based on drifts.
   */
  private calculateStatus(drifts: Drift[]): DriftStatus {
    if (drifts.length === 0) return 'in_sync';

    const hasCritical = drifts.some((d) => d.severity === 'critical');
    if (hasCritical) return 'critical';

    return 'drifted';
  }

  /**
   * Create a summary of drifts by severity.
   */
  private createSummary(drifts: Drift[]): { critical: number; warning: number; info: number } {
    return {
      critical: drifts.filter((d) => d.severity === 'critical').length,
      warning: drifts.filter((d) => d.severity === 'warning').length,
      info: drifts.filter((d) => d.severity === 'info').length,
    };
  }

  /**
   * Format type for display.
   */
  private formatType(type?: CanonicalType): string {
    if (!type) return 'unknown';
    return canonicalToSql(type, this.dialect);
  }
}

/**
 * Create a DriftDetector for comparing expected vs actual schemas.
 */
export function createDriftDetector(
  expectedAST: SchemaAST,
  actualAST: SchemaAST,
  options?: DriftDetectorOptions,
): DriftDetector {
  return new DriftDetector(expectedAST, actualAST, options);
}

/**
 * Quick check for schema drift.
 */
export function detectDrift(expectedAST: SchemaAST, actualAST: SchemaAST, options?: DriftDetectorOptions): DriftReport {
  const detector = new DriftDetector(expectedAST, actualAST, options);
  return detector.detect();
}
