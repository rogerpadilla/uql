/**
 * Smart Relation Detector
 *
 * Uses heuristics and schema analysis to detect relationships between tables:
 * - Explicit foreign keys (highest confidence)
 * - Junction tables for ManyToMany
 * - Unique FK columns for OneToOne
 */

import type { SchemaAST } from '../../schema/schemaAST.js';
import type { DetectedRelation } from '../../schema/types.js';
import { singularize } from '../../util/string.util.js';

/**
 * Configuration for relation detection.
 */
export interface RelationDetectorOptions {
  /** Minimum confidence threshold (0-1) to include in results */
  minConfidence?: number;
  /** Custom singularize function */
  singularize?: (name: string) => string;
}

/**
 * Detects relationships in a SchemaAST using multiple heuristics.
 */
export class SmartRelationDetector {
  private readonly options: Required<RelationDetectorOptions>;

  constructor(
    private readonly ast: SchemaAST,
    options: RelationDetectorOptions = {},
  ) {
    this.options = {
      minConfidence: options.minConfidence ?? 0.5,
      singularize: options.singularize ?? this.defaultSingularize.bind(this),
    };
  }

  /**
   * Detect all relationships in the schema.
   */
  detectAll(): DetectedRelation[] {
    const relations: DetectedRelation[] = [];

    // 1. Add explicit FK relationships (confidence: 1.0)
    for (const rel of this.ast.relationships) {
      relations.push({
        type: rel.type,
        from: {
          table: rel.from.table,
          columns: rel.from.columns,
        },
        to: {
          table: rel.to.table,
          columns: rel.to.columns,
        },
        through: rel.through,
        confidence: 1.0,
        source: 'explicit_fk',
      });
    }

    // 2. Detect junction tables (ManyToMany)
    const junctionRelations = this.detectJunctionTables();
    relations.push(...junctionRelations);

    // 3. Detect unique FK -> OneToOne upgrades
    const oneToOneUpgrades = this.detectOneToOneRelations(relations);
    relations.push(...oneToOneUpgrades);

    // Filter by confidence
    return relations.filter((r) => r.confidence >= this.options.minConfidence);
  }

  /**
   * Detect junction tables that represent ManyToMany relationships.
   */
  private detectJunctionTables(): DetectedRelation[] {
    const relations: DetectedRelation[] = [];

    for (const table of this.ast.tables.values()) {
      if (!this.ast.isJunctionTable(table)) continue;

      const outgoingRels = table.outgoingRelations;
      if (outgoingRels.length !== 2) continue;

      const [rel1, rel2] = outgoingRels;

      // Create ManyToMany relation
      relations.push({
        type: 'ManyToMany',
        from: {
          table: rel1.to.table,
          columns: rel1.to.columns,
        },
        to: {
          table: rel2.to.table,
          columns: rel2.to.columns,
        },
        through: table,
        confidence: 0.95,
        source: 'junction_table',
      });

      // Also create inverse relation
      relations.push({
        type: 'ManyToMany',
        from: {
          table: rel2.to.table,
          columns: rel2.to.columns,
        },
        to: {
          table: rel1.to.table,
          columns: rel1.to.columns,
        },
        through: table,
        confidence: 0.95,
        source: 'junction_table',
      });
    }

    return relations;
  }

  /**
   * Detect relations where unique FK should upgrade to OneToOne.
   */
  private detectOneToOneRelations(existingRelations: DetectedRelation[]): DetectedRelation[] {
    const upgrades: DetectedRelation[] = [];

    for (const rel of existingRelations) {
      if (rel.source !== 'explicit_fk') continue;

      const fromCol = rel.from.columns[0];
      if (fromCol?.isUnique && rel.type === 'ManyToOne') {
        // Upgrade to OneToOne
        upgrades.push({
          type: 'OneToOne',
          from: rel.from,
          to: rel.to,
          through: rel.through,
          confidence: 0.9,
          source: 'unique_fk',
        });
      }
    }

    return upgrades;
  }

  /**
   * Default singularize function (delegates to shared utility).
   */
  private defaultSingularize(name: string): string {
    return singularize(name);
  }
}

/**
 * Create a SmartRelationDetector for the given AST.
 */
export function createRelationDetector(ast: SchemaAST, options?: RelationDetectorOptions): SmartRelationDetector {
  return new SmartRelationDetector(ast, options);
}
