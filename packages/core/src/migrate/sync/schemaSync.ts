/**
 * Schema Sync
 *
 * Orchestrates schema synchronization between entities and database
 * with configurable direction modes.
 */

import type { SchemaAST } from '../../schema/schemaAST.js';
import { SchemaASTBuilder } from '../../schema/schemaASTBuilder.js';
import { SchemaASTDiffer } from '../../schema/schemaASTDiffer.js';
import type { SchemaDiffResult, SyncDirection, SyncOptions } from '../../schema/types.js';
import type { SchemaIntrospector, Type } from '../../type/index.js';

/**
 * Result of a schema sync operation.
 */
export interface SchemaSyncResult {
  /** Direction of the sync */
  direction: SyncDirection;
  /** Whether the sync was successful */
  success: boolean;
  /** Changes applied to database */
  dbChanges: SchemaDiffResult | undefined;
  /** Changes applied to entities */
  entityChanges: SchemaDiffResult | undefined;
  /** Conflicts that need manual resolution */
  conflicts: SyncConflict[];
  /** Human-readable summary */
  summary: string;
  /** Structured summary of changes */
  details: {
    db: { created: number; dropped: number; altered: number };
    entity: { created: number; dropped: number; altered: number };
  };
}

/**
 * A conflict between entity and database schemas.
 */
export interface SyncConflict {
  /** Type of conflict */
  type: 'type_mismatch' | 'constraint_mismatch' | 'column_mismatch' | 'relation_mismatch';
  /** Table name */
  table: string;
  /** Column name (if applicable) */
  column?: string;
  /** What entity expects */
  entityValue: unknown;
  /** What database has */
  dbValue: unknown;
  /** Suggested resolution */
  suggestion: string;
}

/**
 * Options for schema sync operation.
 */
export interface SchemaSyncOptions extends SyncOptions {
  /** Entities to sync */
  entities: Type<unknown>[];
  /** Schema introspector for database */
  introspector: SchemaIntrospector;
  /** Output directory for generated entities (db-to-entity mode) */
  entityOutputDir?: string;
  /** Dry run - don't apply changes */
  dryRun?: boolean;
}

/**
 * Service for synchronizing schemas between entities and database.
 */
export class SchemaSync {
  constructor(private readonly options: SchemaSyncOptions) {}

  /**
   * Execute schema synchronization.
   */
  async sync(): Promise<SchemaSyncResult> {
    const direction = this.options.direction ?? 'bidirectional';

    switch (direction) {
      case 'entity-to-db':
        return this.syncEntityToDb();
      case 'db-to-entity':
        return this.syncDbToEntity();
      case 'bidirectional':
        return this.syncBidirectional();
    }
  }

  /**
   * Sync from entities to database (push).
   */
  private async syncEntityToDb(): Promise<SchemaSyncResult> {
    const entityAST = this.buildEntityAST();
    const dbAST = await this.buildDatabaseAST();

    const differ = new SchemaASTDiffer();
    const diff = differ.diff(entityAST, dbAST);

    // In safe mode, filter out destructive changes
    const safeDiff = this.options.safe ? this.filterDestructiveChanges(diff) : diff;

    return {
      direction: 'entity-to-db',
      success: true,
      dbChanges: safeDiff,
      entityChanges: undefined,
      conflicts: [],
      summary: this.formatSummary('entity-to-db', safeDiff),
      details: {
        db: this.getDiffCounts(safeDiff),
        entity: { created: 0, dropped: 0, altered: 0 },
      },
    };
  }

  /**
   * Sync from database to entities (pull).
   */
  private async syncDbToEntity(): Promise<SchemaSyncResult> {
    const entityAST = this.buildEntityAST();
    const dbAST = await this.buildDatabaseAST();

    const differ = new SchemaASTDiffer();
    // Diff in opposite direction: DB is source, entity is target
    const diff = differ.diff(dbAST, entityAST);

    // Apply safe mode if enabled
    const safeDiff = this.options.safe ? this.filterDestructiveChanges(diff) : diff;

    return {
      direction: 'db-to-entity',
      success: true,
      dbChanges: undefined,
      entityChanges: safeDiff,
      conflicts: [],
      summary: this.formatSummary('db-to-entity', safeDiff),
      details: {
        db: { created: 0, dropped: 0, altered: 0 },
        entity: this.getDiffCounts(safeDiff),
      },
    };
  }

  /**
   * Bidirectional sync with conflict detection.
   */
  private async syncBidirectional(): Promise<SchemaSyncResult> {
    const entityAST = this.buildEntityAST();
    const dbAST = await this.buildDatabaseAST();

    const differ = new SchemaASTDiffer();

    // Get both directions
    const entityToDb = differ.diff(entityAST, dbAST);
    const dbToEntity = differ.diff(dbAST, entityAST);

    // Detect conflicts (changes in both directions for same elements)
    const conflicts = this.detectConflicts(entityToDb, dbToEntity);

    // Filter out conflicting changes
    let safeEntityToDb = this.filterConflictingChanges(entityToDb, conflicts);
    let safeDbToEntity = this.filterConflictingChanges(dbToEntity, conflicts);

    // Apply safe mode if enabled
    if (this.options.safe) {
      safeEntityToDb = this.filterDestructiveChanges(safeEntityToDb);
      safeDbToEntity = this.filterDestructiveChanges(safeDbToEntity);
    }

    return {
      direction: 'bidirectional',
      success: conflicts.length === 0,
      dbChanges: safeEntityToDb,
      entityChanges: safeDbToEntity,
      conflicts,
      summary: this.formatBidirectionalSummary(safeEntityToDb, safeDbToEntity, conflicts),
      details: {
        db: this.getDiffCounts(safeEntityToDb),
        entity: this.getDiffCounts(safeDbToEntity),
      },
    };
  }

  /**
   * Build SchemaAST from entities.
   */
  private buildEntityAST(): SchemaAST {
    const builder = new SchemaASTBuilder();
    return builder.fromEntities(this.options.entities);
  }

  /**
   * Build SchemaAST from database.
   */
  private async buildDatabaseAST(): Promise<SchemaAST> {
    return this.options.introspector.introspect();
  }

  /**
   * Filter destructive changes for safe mode.
   */
  private filterDestructiveChanges(diff: SchemaDiffResult): SchemaDiffResult {
    return {
      ...diff,
      tablesToDrop: [], // Never drop tables in safe mode
      columnDiffs: diff.columnDiffs.filter((d) => d.type !== 'drop'), // Never drop columns
      indexDiffs: diff.indexDiffs.filter((d) => d.type !== 'drop'),
      relationshipDiffs: diff.relationshipDiffs.filter((d) => d.type !== 'drop'),
    };
  }

  /**
   * Detect conflicts between bidirectional changes.
   */
  private detectConflicts(entityToDb: SchemaDiffResult, dbToEntity: SchemaDiffResult): SyncConflict[] {
    const conflicts: SyncConflict[] = [];

    // Find column alterations that exist in both directions (type conflicts)
    const entityColAlters = new Map(
      entityToDb.columnDiffs.filter((d) => d.type === 'alter').map((d) => [`${d.table}.${d.column}`, d]),
    );

    for (const dbColDiff of dbToEntity.columnDiffs.filter((d) => d.type === 'alter')) {
      const key = `${dbColDiff.table}.${dbColDiff.column}`;
      const entityColDiff = entityColAlters.get(key);

      if (entityColDiff) {
        // Both sides want to alter the same column - conflict
        conflicts.push({
          type: 'type_mismatch',
          table: dbColDiff.table,
          column: dbColDiff.column,
          entityValue: entityColDiff.expected?.type,
          dbValue: dbColDiff.expected?.type,
          suggestion: `Column has different types. Entity: ${this.formatType(entityColDiff.expected?.type)}, DB: ${this.formatType(dbColDiff.expected?.type)}`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Filter out conflicting changes.
   */
  private filterConflictingChanges(diff: SchemaDiffResult, conflicts: SyncConflict[]): SchemaDiffResult {
    const conflictKeys = new Set(conflicts.map((c) => `${c.table}.${c.column ?? ''}`));

    return {
      ...diff,
      columnDiffs: diff.columnDiffs.filter((d) => !conflictKeys.has(`${d.table}.${d.column}`)),
      tablesToAlter: diff.tablesToAlter.filter((t) => !conflictKeys.has(`${t.name}.`)),
    };
  }

  /**
   * Get counts of changes from a diff.
   */
  private getDiffCounts(diff: SchemaDiffResult): { created: number; dropped: number; altered: number } {
    return {
      created: diff.tablesToCreate.length + diff.columnDiffs.filter((d) => d.type === 'add').length,
      dropped: diff.tablesToDrop.length + diff.columnDiffs.filter((d) => d.type === 'drop').length,
      altered: diff.columnDiffs.filter((d) => d.type === 'alter').length,
    };
  }

  /**
   * Format summary for single-direction sync.
   */
  private formatSummary(direction: SyncDirection, diff: SchemaDiffResult): string {
    const lines: string[] = [];

    if (direction === 'entity-to-db') {
      lines.push('Entity → Database Changes:');
    } else {
      lines.push('Database → Entity Changes:');
    }

    if (diff.tablesToCreate.length > 0) {
      lines.push(`  + ${diff.tablesToCreate.length} table(s) to create`);
    }
    if (diff.tablesToDrop.length > 0) {
      lines.push(`  - ${diff.tablesToDrop.length} table(s) to drop`);
    }
    if (diff.columnDiffs.length > 0) {
      const adds = diff.columnDiffs.filter((d) => d.type === 'add').length;
      const drops = diff.columnDiffs.filter((d) => d.type === 'drop').length;
      const alters = diff.columnDiffs.filter((d) => d.type === 'alter').length;
      if (adds) lines.push(`  + ${adds} column(s) to add`);
      if (drops) lines.push(`  - ${drops} column(s) to drop`);
      if (alters) lines.push(`  ~ ${alters} column(s) to alter`);
    }
    if (diff.indexDiffs.length > 0) {
      lines.push(`  ${diff.indexDiffs.length} index change(s)`);
    }

    if (!diff.hasDifferences) {
      lines.push('  Schema is already in sync.');
    }

    return lines.join('\n');
  }

  /**
   * Format summary for bidirectional sync.
   */
  private formatBidirectionalSummary(
    entityToDb: SchemaDiffResult,
    dbToEntity: SchemaDiffResult,
    conflicts: SyncConflict[],
  ): string {
    const lines: string[] = [];

    lines.push('Bidirectional Sync Report');
    lines.push('========================\n');

    if (conflicts.length > 0) {
      lines.push(`⚠️  ${conflicts.length} conflict(s) require manual resolution:\n`);
      for (const conflict of conflicts) {
        lines.push(`  • ${conflict.table}.${conflict.column ?? ''}: ${conflict.suggestion}`);
      }
      lines.push('');
    }

    if (entityToDb.hasDifferences) {
      lines.push('Entity → Database:');
      lines.push(this.formatSummary('entity-to-db', entityToDb).split('\n').slice(1).join('\n'));
      lines.push('');
    }

    if (dbToEntity.hasDifferences) {
      lines.push('Database → Entity:');
      lines.push(this.formatSummary('db-to-entity', dbToEntity).split('\n').slice(1).join('\n'));
    }

    if (!entityToDb.hasDifferences && !dbToEntity.hasDifferences && conflicts.length === 0) {
      lines.push('✓ Schema is in sync.');
    }

    return lines.join('\n');
  }

  /**
   * Format type for display.
   */
  private formatType(type?: { category?: string; length?: number }): string {
    if (!type || !type.category) return 'unknown';
    return type.length ? `${type.category}(${type.length})` : type.category;
  }
}

/**
 * Create a SchemaSync instance.
 */
export function createSchemaSync(options: SchemaSyncOptions): SchemaSync {
  return new SchemaSync(options);
}
