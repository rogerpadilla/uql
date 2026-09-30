/**
 * Drift Detector
 *
 * Detects schema drift between expected schema (from entities) and
 * actual database schema.
 */

import type { AbstractDialect } from '../../dialect/abstractDialect.js';
import { canonicalToSql, engineType } from '../../schema/canonicalType.js';
import type { SchemaAST } from '../../schema/schemaAST.js';
import { defaultsEqualAsWritten, diffSchemas, referentialActions } from '../../schema/schemaASTDiffer.js';
import type {
  CanonicalType,
  ColumnDiff,
  ColumnFacet,
  Drift,
  DriftReport,
  DriftStatus,
  RelationshipNode,
  SchemaDiffResult,
} from '../../schema/types.js';
import type { PrimaryKeySchema } from '../../type/migration.js';
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
  /** Include foreign key differences */
  checkForeignKeys?: boolean;
  /**
   * Include default value differences. Off unless {@link defaultsEqual} is given: without it defaults
   * compare as written, and an engine reports one as it stored it (`now()`, `'active'::text`).
   */
  checkDefaults?: boolean;
  /** How the engine's generator compares a default, so drift reports the ones a migration would change. */
  defaultsEqual?: (expected: unknown, actual: unknown) => boolean;
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
    checkForeignKeys: options.checkForeignKeys ?? true,
    checkDefaults: options.checkDefaults ?? options.defaultsEqual !== undefined,
    defaultsEqual: options.defaultsEqual ?? defaultsEqualAsWritten,
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
  const { dialect } = opts;
  const diff = diffSchemas(expectedAST, actualAST, {
    compareIndexes: opts.checkIndexes,
    compareRelationships: opts.checkForeignKeys,
    excludeTables: opts.excludeTables,
    defaultsEqual: opts.defaultsEqual,
    // Types are normalized through the dialect's engine; without a dialect, no type drift is reported.
    ...(dialect && { normalizeType: engineType(dialect) }),
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
  return diff.primaryKeys.map((pkDiff) => ({
    type: 'constraint_mismatch' as const,
    severity: 'critical' as const,
    table: pkDiff.table,
    details: `Primary key of "${pkDiff.table}" is (${keyColumns(pkDiff.from)}) in the database but (${keyColumns(pkDiff.to)}) in the entity`,
    suggestion: 'Generate a migration to change the primary key',
  }));
}

/** A key's columns as a drift names them, `none` where there is no key. */
function keyColumns(key: PrimaryKeySchema | undefined): string {
  return key?.columns.join(', ') || 'none';
}

/**
 * Detect table-level drifts (missing/unexpected tables).
 */
function detectTableDrifts(diff: SchemaDiffResult): Drift[] {
  return diff.tables.map((change): Drift =>
    change.from === undefined
      ? {
          type: 'missing_table',
          severity: 'critical',
          table: change.to.name,
          details: `Entity "${change.to.name}" exists but table not in database`,
          suggestion: 'Run migrations to create table',
        }
      : {
          type: 'unexpected_table',
          severity: 'warning',
          table: change.from.name,
          details: `Table "${change.from.name}" exists in database but no matching entity`,
          suggestion: 'Create entity or drop table',
        },
  );
}

/**
 * Detect column-level drifts.
 */
function detectColumnDrifts(diff: SchemaDiffResult, opts: DriftDetectorSettings): Drift[] {
  const drifts: Drift[] = [];

  for (const colDiff of diff.columns) {
    if (colDiff.from === undefined) {
      drifts.push({
        type: 'missing_column',
        severity: 'critical',
        table: colDiff.table,
        column: colDiff.column,
        details: `Column "${colDiff.column}" expected but not found in database`,
        suggestion: 'Run migration to add column',
      });
    } else if (colDiff.to === undefined) {
      drifts.push({
        type: 'unexpected_column',
        severity: 'warning',
        table: colDiff.table,
        column: colDiff.column,
        details: `Column "${colDiff.column}" exists in database but not in entity`,
        suggestion: 'Add to entity or create migration to drop',
      });
    } else {
      addAlterColumnDrifts(colDiff, drifts, opts);
    }
  }

  return drifts;
}

/** The drifts for each part of a column the differ found changed: type, nullability and default. */
function addAlterColumnDrifts(
  colDiff: Extract<ColumnDiff, { readonly changed: readonly ColumnFacet[] }>,
  drifts: Drift[],
  opts: DriftDetectorSettings,
): void {
  const { changed } = colDiff;
  // Type drift needs a dialect to render both types.
  if (opts.checkTypes && opts.dialect && changed.includes('type')) {
    const expectedType = formatType(colDiff.to.type, opts.dialect);
    const actualType = formatType(colDiff.from.type, opts.dialect);
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

  if (opts.checkNullable && changed.includes('nullable')) {
    drifts.push({
      type: 'constraint_mismatch',
      severity: 'warning',
      table: colDiff.table,
      column: colDiff.column,
      expected: colDiff.to.nullable ? 'NULLABLE' : 'NOT NULL',
      actual: colDiff.from.nullable ? 'NULLABLE' : 'NOT NULL',
      details: `Nullable mismatch for "${colDiff.column}"`,
      suggestion: 'Align nullable setting in entity or database',
    });
  }

  if (opts.checkDefaults && changed.includes('default')) {
    drifts.push({
      type: 'constraint_mismatch',
      severity: 'info',
      table: colDiff.table,
      column: colDiff.column,
      expected: String(colDiff.to.defaultValue ?? 'NULL'),
      actual: String(colDiff.from.defaultValue ?? 'NULL'),
      details: `Default mismatch for "${colDiff.column}"`,
      suggestion: 'Align the default in the entity or the database',
    });
  }
}

/**
 * Detect index drifts.
 */
function detectIndexDrifts(diff: SchemaDiffResult): Drift[] {
  const drifts: Drift[] = [];

  for (const idxDiff of diff.indexes) {
    if (idxDiff.from === undefined) {
      drifts.push({
        type: 'missing_index',
        severity: 'warning',
        table: idxDiff.table,
        index: idxDiff.name,
        details: `Index "${idxDiff.name}" expected but not found in database`,
        suggestion: 'Create index via migration',
      });
    } else if (idxDiff.to === undefined) {
      drifts.push({
        type: 'unexpected_index',
        severity: 'info',
        table: idxDiff.table,
        index: idxDiff.name,
        details: `Index "${idxDiff.name}" exists in database but not defined in entity`,
        suggestion: 'Declare it, or drop it via migration: generate:entities drops one uql named',
      });
    } else {
      // No `expected`/`actual` here: the CLI prints those by interpolation, where an `IndexNode`
      // renders as `[object Object]`. What differs is already spelled out in `description`.
      drifts.push({
        type: 'index_mismatch',
        severity: 'warning',
        table: idxDiff.table,
        index: idxDiff.name,
        details: `Index "${idxDiff.name}" differs from the entity (${idxDiff.description})`,
        suggestion: 'Recreate it via migration, which generate:entities writes',
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

  for (const relDiff of diff.relationships) {
    if (relDiff.from === undefined) {
      drifts.push({
        type: 'missing_relationship',
        severity: 'warning',
        table: relDiff.fromTable,
        relationship: relDiff.name,
        details: `FK "${relDiff.name}" expected but not found in database`,
        suggestion: 'Add FK constraint or remove relation from entity',
      });
    } else if (relDiff.to === undefined) {
      drifts.push({
        type: 'unexpected_relationship',
        severity: 'info',
        table: relDiff.fromTable,
        relationship: relDiff.name,
        details: `FK "${relDiff.name}" exists in database but not in entity`,
        suggestion: 'Add relation to entity or drop FK',
      });
    } else {
      drifts.push({
        type: 'relationship_mismatch',
        severity: 'warning',
        table: relDiff.fromTable,
        relationship: relDiff.name,
        expected: formatActions(relDiff.to),
        actual: formatActions(relDiff.from),
        details: `FK "${relDiff.name}" has other referential actions in the database than in the entity`,
        suggestion: 'Generate a migration, which drops and re-adds the constraint',
      });
    }
  }

  return drifts;
}

/** Both actions spelled out, so a side that left one unstated reads the same as one that stated the default. */
function formatActions(rel: RelationshipNode): string {
  const { onDelete, onUpdate } = referentialActions(rel);
  return `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
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
function formatType(type: CanonicalType, dialect: AbstractDialect | undefined): string {
  if (!dialect) return 'unknown';
  return canonicalToSql(type, dialect);
}
