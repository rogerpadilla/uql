/**
 * SchemaAST Builder
 *
 * Constructs a SchemaAST from:
 * - Entity metadata (decorator-based entities)
 * - Database introspection results (TableSchema[])
 */

import { getMeta } from '../entity/decorator/definition.js';
import type { EntityMeta, FieldOptions, RelationOptions, Type } from '../type/index.js';
import type { NamingStrategy } from '../type/namingStrategy.js';
import { fieldOptionsToCanonical } from './canonicalType.js';
import { SchemaAST } from './schemaAST.js';
import type { ColumnNode, ForeignKeyAction, IndexNode, RelationshipNode, TableNode } from './types.js';
import { DEFAULT_FOREIGN_KEY_ACTION } from './types.js';

/**
 * Options for building SchemaAST from entities.
 */
export interface BuildFromEntitiesOptions {
  /** Custom table name resolver */
  resolveTableName?: (entity: Type<unknown>, meta: EntityMeta<unknown>) => string;
  /** Custom column name resolver */
  resolveColumnName?: (key: string, field: FieldOptions) => string;
  /** Naming strategy to use */
  namingStrategy?: NamingStrategy;
  /** Default action for foreign key ON DELETE and ON UPDATE clauses */
  defaultForeignKeyAction?: ForeignKeyAction;
}

/**
 * Builds SchemaAST instances from various sources.
 */
export class SchemaASTBuilder {
  private ast: SchemaAST;

  constructor(
    private readonly namingStrategy?: NamingStrategy,
    private readonly defaultForeignKeyAction: ForeignKeyAction = DEFAULT_FOREIGN_KEY_ACTION,
  ) {
    this.ast = new SchemaAST();
  }

  /**
   * Reset the builder for a new schema.
   */
  reset(): this {
    this.ast = new SchemaAST();
    return this;
  }

  /**
   * Get the built AST.
   */
  getAST(): SchemaAST {
    return this.ast;
  }

  // ============================================================================
  // Build from Entities
  // ============================================================================

  /**
   * Build AST from entity classes (decorated with @Entity, @Field, etc.)
   */
  fromEntities(entities: Type<unknown>[], options: BuildFromEntitiesOptions = {}): SchemaAST {
    this.reset();

    const namingStrategy = options.namingStrategy ?? this.namingStrategy;
    const resolveTableName =
      options.resolveTableName ?? ((e, m) => namingStrategy?.tableName(m.name ?? e.name) ?? m.name ?? e.name);
    const resolveColumnName =
      options.resolveColumnName ?? ((k, f) => namingStrategy?.columnName(f.name ?? k) ?? f.name ?? k);

    // First pass: create all tables and columns
    for (const entity of entities) {
      const meta = getMeta(entity);
      this.addTableFromEntity(entity, meta, resolveTableName, resolveColumnName);
    }

    // Second pass: create relationships from relation decorators
    for (const entity of entities) {
      const meta = getMeta(entity);
      this.addRelationshipsFromEntity(entity, meta, resolveTableName, resolveColumnName, options);
    }

    // Third pass: create indexes from field options
    for (const entity of entities) {
      const meta = getMeta(entity);
      this.addIndexesFromEntity(entity, meta, resolveTableName, resolveColumnName);
    }

    return this.ast;
  }

  /**
   * Add a table from entity metadata.
   */
  private addTableFromEntity(
    entity: Type<unknown>,
    meta: EntityMeta<unknown>,
    resolveTableName: (entity: Type<unknown>, meta: EntityMeta<unknown>) => string,
    resolveColumnName: (key: string, field: FieldOptions) => string,
  ): void {
    const tableName = resolveTableName(entity, meta);

    const columns = new Map<string, ColumnNode>();
    const primaryKey: ColumnNode[] = [];

    // Create placeholder table (will be fully initialized below)
    const table: TableNode = {
      name: tableName,
      columns,
      primaryKey,
      indexes: [],
      schema: this.ast,
      incomingRelations: [],
      outgoingRelations: [],
    };

    // Add columns from fields
    const fields = meta.fields as Record<string, FieldOptions | undefined>;
    for (const key of Object.keys(fields)) {
      const field = fields[key];
      if (!field) continue;

      // Skip virtual fields
      if (field.virtual) continue;

      const columnName = resolveColumnName(key, field);
      const type = fieldOptionsToCanonical(field, field.type);

      const column: ColumnNode = {
        name: columnName,
        type,
        nullable: field.nullable ?? true,
        defaultValue: field.defaultValue,
        isPrimaryKey: key === meta.id,
        isAutoIncrement: field.autoIncrement ?? (key === meta.id && type.category === 'integer'),
        isUnique: field.unique ?? false,
        comment: field.comment,
        table,
        referencedBy: [],
        references: undefined,
      };

      columns.set(columnName, column);

      if (key === meta.id) {
        primaryKey.push(column);
      }
    }

    this.ast.addTable(table);
  }

  /**
   * Add relationships from entity relation decorators.
   */
  private addRelationshipsFromEntity(
    entity: Type<unknown>,
    meta: EntityMeta<unknown>,
    resolveTableName: (entity: Type<unknown>, meta: EntityMeta<unknown>) => string,
    resolveColumnName: (key: string, field: FieldOptions) => string,
    options: BuildFromEntitiesOptions,
  ): void {
    const tableName = resolveTableName(entity, meta);
    const table = this.ast.getTable(tableName);
    if (!table) return;

    const relations = meta.relations as Record<string, RelationOptions | undefined>;
    for (const key of Object.keys(relations)) {
      const relation = relations[key];
      if (!relation?.entity) continue;

      const relatedEntity = relation.entity();
      const relatedMeta = getMeta(relatedEntity);
      const relatedTableName = resolveTableName(relatedEntity, relatedMeta);
      const relatedTable = this.ast.getTable(relatedTableName);
      if (!relatedTable) continue;

      // Only create FK for owning side (m1 and owner side of 11)
      if (relation.cardinality === 'm1' || (relation.cardinality === '11' && relation.references)) {
        const references = relation.references ?? [{ local: `${key}Id`, foreign: relatedMeta.id as string }];
        const localPropName = references[0].local;
        const foreignPropName = references[0].foreign;

        const localField = meta.fields[localPropName];
        if (!localField) continue;

        const localColName = resolveColumnName(localPropName, localField);
        const foreignField = relatedMeta.fields[foreignPropName];
        if (!foreignField) continue;

        const foreignColName = resolveColumnName(foreignPropName, foreignField);

        const localColumn = table.columns.get(localColName);
        const foreignColumn = relatedTable.columns.get(foreignColName);

        if (localColumn && foreignColumn) {
          const relNode: RelationshipNode = {
            name: `fk_${tableName}_${localColName}`,
            type: relation.cardinality === 'm1' ? 'ManyToOne' : 'OneToOne',
            from: { table, columns: [localColumn] },
            to: { table: relatedTable, columns: [foreignColumn] },
            onDelete: options.defaultForeignKeyAction ?? this.defaultForeignKeyAction,
            onUpdate: options.defaultForeignKeyAction ?? this.defaultForeignKeyAction,
            confidence: 1.0,
            inferredFrom: 'entity_decorator',
          };

          this.ast.addRelationship(relNode);
        }
      }
    }
  }

  /**
   * Add indexes from field options.
   */
  private addIndexesFromEntity(
    entity: Type<unknown>,
    meta: EntityMeta<unknown>,
    resolveTableName: (entity: Type<unknown>, meta: EntityMeta<unknown>) => string,
    resolveColumnName: (key: string, field: FieldOptions) => string,
  ): void {
    const tableName = resolveTableName(entity, meta);
    const table = this.ast.getTable(tableName);
    if (!table) return;

    // 1. Single column indexes from @Field({ index: true })
    const indexFields = meta.fields as Record<string, FieldOptions | undefined>;
    for (const key of Object.keys(indexFields)) {
      const field = indexFields[key];
      if (!field?.index) continue;

      const columnName = resolveColumnName(key, field);
      const column = table.columns.get(columnName);
      if (!column) continue;

      const indexName = typeof field.index === 'string' ? field.index : `idx_${tableName}_${columnName}`;

      const indexNode: IndexNode = {
        name: indexName,
        table,
        columns: [column],
        unique: field.unique ?? false,
        source: 'entity',
        syncStatus: 'entity_only',
      };

      this.ast.addIndex(indexNode);
    }

    // 2. Composite indexes from @Index([...])
    if (meta.indexes) {
      for (const idxMeta of meta.indexes) {
        const columns: ColumnNode[] = [];
        for (const propName of idxMeta.columns) {
          const field = meta.fields[propName as keyof typeof meta.fields];
          if (!field) continue;
          const colName = resolveColumnName(propName, field);
          const column = table.columns.get(colName);
          if (column) {
            columns.push(column);
          }
        }

        if (columns.length > 0) {
          const indexName = idxMeta.name ?? `idx_${tableName}_${columns.map((c) => c.name).join('_')}`;
          const indexNode: IndexNode = {
            name: indexName,
            table,
            columns,
            unique: idxMeta.unique ?? false,
            type: idxMeta.type,
            where: idxMeta.where,
            source: 'entity',
            syncStatus: 'entity_only',
          };
          this.ast.addIndex(indexNode);
        }
      }
    }
  }
}
