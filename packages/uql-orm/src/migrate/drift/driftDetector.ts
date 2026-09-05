/**
 * Drift Detector
 *
 * Detects schema drift between expected schema (from entities) and
 * actual database schema.
 */

import type { AbstractDialect } from '../../dialect/abstractDialect.js';
import { canonicalToSql } from '../../schema/canonicalType.js';
import type { IndexFacet } from '../../schema/indexDifferences.js';
import type { SchemaAST } from '../../schema/schemaAST.js';
import { diffSchemas } from '../../schema/schemaASTDiffer.js';
import type {
  CanonicalType,
  ColumnDiff,
  Drift,
  DriftReport,
  DriftStatus,
  SchemaDiffResult,
} from '../../schema/types.js';
import type { Except } from '../../type/utility.js';

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
  /** `indexFacets` of the introspector that produced the actual schema; anything else goes uncompared. */
  indexFacets?: ReadonlySet<IndexFacet>;
  /** Include foreign key differences */
  checkForeignKeys?: boolean;
  /**
   * Include default value differences. Off by default: an engine reports a default as it stored it
   * (`now()`, `CURRENT_TIMESTAMP`, `'active'::text`), which rarely matches the entity's literal.
   */
  checkDefaults?: boolean;
  /**
   * Tables to leave out of the comparison. The migrations bookkeeping table belongs here - it exists in
   * the database by design and has no entity, so reporting it as unexpected told every project to
   * "create entity or drop table" for its own migration log.
   */
  excludeTables?: string[];
  /** Dialect instance for type formatting */
  dialect?: AbstractDialect;
}

/** Every option resolved, except the dialect, which is genuinely absent when none was passed. */
type DriftDetectorSettings = Required<Except<DriftDetectorOptions, 'dialect'>> & Pick<DriftDetectorOptions, 'dialect'>;

function resolveOptions(options: DriftDetectorOptions): DriftDetectorSettings {
  return {
    checkTypes: options.checkTypes ?? true,
    checkNullable: options.checkNullable ?? true,
    checkIndexes: options.checkIndexes ?? true,
    indexFacets: options.indexFacets ?? new Set(),
    checkForeignKeys: options.checkForeignKeys ?? true,
    checkDefaults: options.checkDefaults ?? false,
    excludeTables: options.excludeTables ?? [],
    dialect: options.dialect,
  };
}

/**
 * Compare an expected schema (from entities) with an actual one (from the database) and report every
 * way they have drifted apart.
 */
export function detectDrift(
  expectedAST: SchemaAST,
  actualAST: SchemaAST,
  options: DriftDetectorOptions = {},
): DriftReport {
  const opts = resolveOptions(options);
  const diff = diffSchemas(expectedAST, actualAST, {
    compareIndexes: opts.checkIndexes,
    indexFacets: opts.indexFacets,
    compareRelationships: opts.checkForeignKeys,
    excludeTables: opts.excludeTables,
  });

  const drifts: Drift[] = [
    ...detectTableDrifts(diff),
    ...detectColumnDrifts(diff, opts),
    ...detectIndexDrifts(diff),
    ...detectPrimaryKeyDrifts(diff),
    ...detectRelationshipDrifts(diff),
  ];

  return {
    status: calculateStatus(drifts),
    drifts,
    summary: createSummary(drifts),
    generatedAt: new Date(),
  };
}

/**
 * A table whose key holds different columns than the entity declares.
 *
 * Critical, and reported as a `constraint_mismatch` like any other: rows the database will accept
 * are not the rows the ORM believes are unique, so it addresses by a key nothing enforces.
 */
function detectPrimaryKeyDrifts(diff: SchemaDiffResult): Drift[] {
  return diff.primaryKeyDiffs.map((pkDiff) => ({
    type: 'constraint_mismatch' as const,
    severity: 'critical' as const,
    table: pkDiff.table,
    details: `Primary key of "${pkDiff.table}" is (${pkDiff.actual.join(', ') || 'none'}) in the database but (${pkDiff.expected.join(', ') || 'none'}) in the entity`,
    suggestion: 'Generate a migration to change the primary key',
  }));
}

/**
 * Detect table-level drifts (missing/unexpected tables).
 */
function detectTableDrifts(diff: SchemaDiffResult): Drift[] {
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
function detectColumnDrifts(diff: SchemaDiffResult, opts: DriftDetectorSettings): Drift[] {
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
      addAlterColumnDrifts(colDiff, drifts, opts);
    }
  }

  return drifts;
}

/**
 * Add drifts for column alterations (type/nullable mismatches).
 */
function addAlterColumnDrifts(colDiff: ColumnDiff, drifts: Drift[], opts: DriftDetectorSettings): void {
  // Every check below compares the two sides, so there is nothing to report without both.
  if (!colDiff.expected || !colDiff.actual) {
    return;
  }

  // An auto-increment key is created through the dialect's `serialPrimaryKey`, whose spelling the
  // entity never states - `BIGINT UNSIGNED AUTO_INCREMENT` on the MySQL family, where the column then
  // reads back as `BIGINT UNSIGNED` against an entity that can only say `BIGINT`. Comparing the two
  // reported every table uql created itself as drifting on its own id.
  const dialectOwnsType = colDiff.expected.isPrimaryKey && colDiff.expected.isAutoIncrement;

  if (opts.checkTypes && !dialectOwnsType) {
    const expectedType = formatType(colDiff.expected.type, opts.dialect);
    const actualType = formatType(colDiff.actual.type, opts.dialect);
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

  if (opts.checkNullable && colDiff.expected.nullable !== colDiff.actual.nullable) {
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

  if (opts.checkDefaults) {
    const expected = String(colDiff.expected.defaultValue ?? 'NULL');
    const actual = String(colDiff.actual.defaultValue ?? 'NULL');
    if (expected !== actual) {
      drifts.push({
        type: 'constraint_mismatch',
        severity: 'info',
        table: colDiff.table,
        column: colDiff.column,
        expected,
        actual,
        details: `Default mismatch for "${colDiff.column}"`,
        suggestion: 'Align the default in the entity or the database',
      });
    }
  }
}

/**
 * Detect index drifts.
 */
function detectIndexDrifts(diff: SchemaDiffResult): Drift[] {
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
    } else if (idxDiff.type === 'alter') {
      // No `expected`/`actual` here: the CLI prints those by interpolation, where an `IndexNode`
      // renders as `[object Object]`. What differs is already spelled out in `description`.
      drifts.push({
        type: 'index_mismatch',
        severity: 'warning',
        table: idxDiff.table,
        index: idxDiff.name,
        details: `Index "${idxDiff.name}" differs from the entity (${idxDiff.description})`,
        suggestion: 'Drop and recreate the index via migration',
      });
    }
  }

  return drifts;
}

/**
 * Detect relationship/FK drifts.
 */
function detectRelationshipDrifts(diff: SchemaDiffResult): Drift[] {
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
function calculateStatus(drifts: Drift[]): DriftStatus {
  if (drifts.length === 0) return 'in_sync';

  const hasCritical = drifts.some((d) => d.severity === 'critical');
  if (hasCritical) return 'critical';

  return 'drifted';
}

/**
 * Create a summary of drifts by severity.
 */
function createSummary(drifts: Drift[]): { critical: number; warning: number; info: number } {
  return {
    critical: drifts.filter((d) => d.severity === 'critical').length,
    warning: drifts.filter((d) => d.severity === 'warning').length,
    info: drifts.filter((d) => d.severity === 'info').length,
  };
}

/**
 * Format type for display.
 */
function formatType(type: CanonicalType | undefined, dialect: AbstractDialect | undefined): string {
  if (!type || !dialect) return 'unknown';
  return canonicalToSql(type, dialect);
}
