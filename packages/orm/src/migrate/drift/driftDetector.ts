import type { AbstractDialect } from '../../dialect/abstractDialect.js';
import { canonicalToSql } from '../../schema/canonicalType.js';
import type { SchemaAST } from '../../schema/schemaAST.js';
import { type DiffOptions, diffSchemas, referentialActions } from '../../schema/schemaASTDiffer.js';
import { SqlExpression, writtenDefault } from '../../schema/sqlExpression.js';
import type {
  ColumnDiff,
  IndexDiff,
  RelationshipDiff,
  RelationshipNode,
  SchemaDiffResult,
  TableChange,
} from '../../schema/types.js';
import type { PrimaryKeySchema } from '../../type/migration.js';

/**
 * How drift compares: as a migration does, given its generator's `diffOptions()`, with the tables to leave out
 * (the migrations log, which no entity names), and the dialect that renders a type, without which no type
 * drift is reported.
 */
export type DriftDetectorOptions = DiffOptions & { readonly dialect?: AbstractDialect };

export type DriftSeverity = 'critical' | 'warning' | 'info';

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

/** One way the database differs from the entities. */
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

export type DriftStatus = 'in_sync' | 'drifted' | 'critical';

export interface DriftReport {
  readonly status: DriftStatus;
  readonly drifts: Drift[];
  readonly generatedAt: Date;
  /** How many drifts of each severity. */
  readonly summary: Readonly<Record<DriftSeverity, number>>;
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
  const diff = diffSchemas(expectedAST, actualAST, options);
  const drifts: Drift[] = [
    ...diff.tables.map(tableDrift),
    ...diff.columns.flatMap((change) => columnDrifts(change, options.dialect)),
    ...diff.indexes.map(indexDrift),
    ...detectPrimaryKeyDrifts(diff),
    ...detectOwnedDrifts('Check', diff.checks),
    ...detectOwnedDrifts('Trigger', diff.triggers),
    ...diff.relationships.map(relationshipDrift),
  ];
  const count = (severity: DriftSeverity) => drifts.filter((drift) => drift.severity === severity).length;
  const summary = { critical: count('critical'), warning: count('warning'), info: count('info') };
  return {
    status: drifts.length === 0 ? 'in_sync' : summary.critical ? 'critical' : 'drifted',
    drifts,
    summary,
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

/**
 * A check or trigger the database lacks, critical since rows are written otherwise than the entity says, or
 * one uql installed that nothing declares.
 */
function detectOwnedDrifts(
  kind: 'Check' | 'Trigger',
  changes: readonly TableChange<{ readonly name: string }>[],
): Drift[] {
  return changes.map(({ table, from, to }): Drift => ({
    type: 'constraint_mismatch',
    table,
    suggestion: 'Generate a migration to match the entity',
    ...(to
      ? { severity: 'critical', details: `${kind} "${to.name}" expected but not found in database` }
      : { severity: 'warning', details: `${kind} "${from?.name}" exists in database but not in entity` }),
  }));
}

/** A key's columns as a drift names them, `none` where there is no key. */
function keyColumns(key: PrimaryKeySchema | undefined): string {
  return key?.columns.join(', ') || 'none';
}

function tableDrift(change: SchemaDiffResult['tables'][number]): Drift {
  return change.from === undefined
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
      };
}

/** A column the database lacks or no entity declares, or each part of one the differ found changed. */
function columnDrifts(change: ColumnDiff, dialect: AbstractDialect | undefined): Drift[] {
  const { table, column } = change;
  if (change.from === undefined) {
    return [
      {
        type: 'missing_column',
        severity: 'critical',
        table,
        column,
        details: `Column "${column}" expected but not found in database`,
        suggestion: 'Run migration to add column',
      },
    ];
  }
  if (change.to === undefined) {
    return [
      {
        type: 'unexpected_column',
        severity: 'warning',
        table,
        column,
        details: `Column "${column}" exists in database but not in entity`,
        suggestion: 'Add to entity or create migration to drop',
      },
    ];
  }
  const { from, to, isBreaking } = change;
  return change.changed.flatMap((facet): Drift[] => {
    if (facet === 'type') {
      // Type drift needs a dialect to render both types.
      if (!dialect) {
        return [];
      }
      const [expected, actual] = [canonicalToSql(to.type, dialect), canonicalToSql(from.type, dialect)];
      return [
        {
          type: 'type_mismatch',
          severity: isBreaking ? 'critical' : 'warning',
          table,
          column,
          expected,
          actual,
          details: `Type mismatch for "${column}": expected ${expected}, got ${actual}`,
          suggestion: isBreaking ? 'Data truncation risk! Create migration to fix.' : 'Create migration to align types',
        },
      ];
    }
    if (facet === 'nullable') {
      return [
        {
          type: 'constraint_mismatch',
          severity: 'warning',
          table,
          column,
          expected: to.nullable ? 'NULLABLE' : 'NOT NULL',
          actual: from.nullable ? 'NULLABLE' : 'NOT NULL',
          details: `Nullable mismatch for "${column}"`,
          suggestion: 'Align nullable setting in entity or database',
        },
      ];
    }
    return [
      {
        type: 'constraint_mismatch',
        severity: 'info',
        table,
        column,
        expected: shownDefault(to.defaultValue),
        actual: shownDefault(from.defaultValue),
        details: `Default mismatch for "${column}"`,
        suggestion: 'Align the default in the entity or the database',
      },
    ];
  });
}

function indexDrift(change: IndexDiff): Drift {
  const { table, name: index } = change;
  if (change.from === undefined) {
    return {
      type: 'missing_index',
      severity: 'warning',
      table,
      index,
      details: `Index "${index}" expected but not found in database`,
      suggestion: 'Create index via migration',
    };
  }
  if (change.to === undefined) {
    return {
      type: 'unexpected_index',
      severity: 'info',
      table,
      index,
      details: `Index "${index}" exists in database but not defined in entity`,
      suggestion: 'Declare it, or drop it via migration: generate:entities drops one uql named',
    };
  }
  // No `expected`/`actual`: the CLI prints those by interpolation, where an `IndexNode` renders as
  // `[object Object]`. What differs is already spelled out in `description`.
  return {
    type: 'index_mismatch',
    severity: 'warning',
    table,
    index,
    details: `Index "${index}" differs from the entity (${change.description})`,
    suggestion: 'Recreate it via migration, which generate:entities writes',
  };
}

function relationshipDrift(change: RelationshipDiff): Drift {
  const { fromTable: table, name: relationship } = change;
  if (change.from === undefined) {
    return {
      type: 'missing_relationship',
      severity: 'warning',
      table,
      relationship,
      details: `FK "${relationship}" expected but not found in database`,
      suggestion: 'Add FK constraint or remove relation from entity',
    };
  }
  if (change.to === undefined) {
    return {
      type: 'unexpected_relationship',
      severity: 'info',
      table,
      relationship,
      details: `FK "${relationship}" exists in database but not in entity`,
      suggestion: 'Add relation to entity or drop FK',
    };
  }
  return {
    type: 'relationship_mismatch',
    severity: 'warning',
    table,
    relationship,
    expected: formatActions(change.to),
    actual: formatActions(change.from),
    details: `FK "${relationship}" has other referential actions in the database than in the entity`,
    suggestion: 'Generate a migration, which drops and re-adds the constraint',
  };
}

/** A default as a report shows it: SQL as its SQL, a JSON document as JSON rather than `[object Object]`. */
function shownDefault(value: unknown): string {
  return value == null ? 'NULL' : SqlExpression.isExpression(value) ? String(value) : writtenDefault(value);
}

/** Both actions spelled out, so a side that left one unstated reads the same as one that stated the default. */
function formatActions(rel: RelationshipNode): string {
  const { onDelete, onUpdate } = referentialActions(rel);
  return `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
}
