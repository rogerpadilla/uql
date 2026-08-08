/**
 * SchemaAST Builder
 *
 * Constructs a SchemaAST from:
 * - Entity metadata (decorator-based entities)
 * - Database introspection results (TableSchema[])
 */

import { getMeta } from '../entity/metadata/definition.js';
import type { EntityGetter } from '../type/entity.js';
import type { EntityIndexMeta, EntityMeta, FieldOptions, IndexColumnSchema, Type } from '../type/index.js';
import type { NamingStrategy } from '../type/namingStrategy.js';
import { fieldOptionsToCanonical } from './canonicalType.js';
import { SchemaAST } from './schemaAST.js';
import type { CanonicalType, ColumnNode, ForeignKeyAction, RelationshipNode, TableNode } from './types.js';
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

  /**
   * Build AST from entity classes (decorated with @Entity, @Field, etc.)
   */
  fromEntities(entities: readonly Type<unknown>[], options: BuildFromEntitiesOptions = {}): SchemaAST {
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
   * Resolve the canonical type for a field, inheriting from the referenced
   * entity's primary key when the field is a foreign-key reference
   * (`@Field({ references: () => SomeEntity })`) with no explicit type of its
   * own.
   *
   * Without this, a field like `creatorId?: UUID` (a bare TypeScript alias for
   * `string`, erased at runtime) falls back to the generic string inference in
   * {@link fieldOptionsToCanonical} and gets typed as TEXT/VARCHAR - producing a
   * foreign key column whose type doesn't match the UUID primary key it
   * references, which Postgres (and most databases) reject outright.
   *
   * `field.typeFromReference` (set by `defineField`, see entity/metadata/definition.ts)
   * is what distinguishes "no type was given" from "the decorator explicitly set
   * a type" - including explicit constructor overrides like `type: BigInt`, which
   * a value-based check (e.g. `typeof field.type === 'string'`) would miss since
   * reflection also produces constructor values like `String`/`Number`.
   * `columnType` remains the unambiguous, always-respected explicit override.
   */
  private resolveColumnCanonicalType(field: FieldOptions, seen: Set<EntityGetter> = new Set()): CanonicalType {
    const hasExplicitType = !!field.columnType || !field.typeFromReference;
    if (!hasExplicitType && field.references && !seen.has(field.references)) {
      seen.add(field.references);
      const referencedMeta = getMeta(field.references());
      const referencedIdField = referencedMeta.fields[referencedMeta.id as string];
      if (referencedIdField) {
        return this.resolveColumnCanonicalType(referencedIdField, seen);
      }
    }
    return fieldOptionsToCanonical(field, field.type);
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
    const fields = meta.fields;
    for (const key of Object.keys(fields)) {
      const field = fields[key];
      if (!field) continue;

      // Skip virtual fields
      if (field.virtual) continue;

      const columnName = resolveColumnName(key, field);
      const type = this.resolveColumnCanonicalType(field);

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

    const relations = meta.relations;
    for (const key of Object.keys(relations)) {
      const relation = relations[key];
      if (!relation) continue;

      const relatedEntity = relation.entity();
      const relatedMeta = getMeta(relatedEntity);
      const relatedTableName = resolveTableName(relatedEntity, relatedMeta);
      const relatedTable = this.ast.getTable(relatedTableName);
      if (!relatedTable) continue;

      // Only the owning side gets the FK. `mappedBy` marks the inverse side of a one-to-one, whose
      // `references` describe how to join back (its own primary key against the owner's FK column) -
      // reading those as a foreign key emitted a reversed constraint (`User(id) REFERENCES
      // user_profile(creatorId)`), which SQLite rejects outright as a foreign key mismatch.
      const ownsForeignKey = relation.cardinality === 'm1' || (relation.cardinality === '11' && !relation.mappedBy);
      if (ownsForeignKey) {
        const localPropName = relation.references[0].local;
        const foreignPropName = relation.references[0].foreign;

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
            // Falls back to the FK column's own `onDelete`, which is what makes a bare `@Field({
            // references, onDelete })` work with no relation declared at all.
            onDelete:
              relation.onDelete ??
              localField.onDelete ??
              options.defaultForeignKeyAction ??
              this.defaultForeignKeyAction,
            onUpdate: relation.onUpdate ?? options.defaultForeignKeyAction ?? this.defaultForeignKeyAction,
            confidence: 1.0,
            inferredFrom: 'entity_decorator',
          };

          this.ast.addRelationship(relNode);
        }
      }
    }
  }

  /**
   * Add indexes from field options (`@Field({ index })`) and from `@Index([...])`, which have nothing
   * in common beyond their target table.
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

    for (const key of Object.keys(meta.fields)) {
      const field = meta.fields[key];
      if (!field?.index) continue;
      const column = table.columns.get(resolveColumnName(key, field));
      if (!column) continue;
      this.ast.addIndex({
        name: typeof field.index === 'string' ? field.index : `idx_${tableName}_${column.name}`,
        table,
        columns: [column],
        unique: field.unique ?? false,
        source: 'entity',
        syncStatus: 'entity_only',
      });
    }

    for (const idxMeta of meta.indexes ?? []) {
      this.addCompositeIndex(table, meta, idxMeta, resolveColumnName);
    }
  }

  /**
   * One `@Index([...])`. Its entries keep the authored form (expression, prefix length, order) with
   * names resolved, so the generator renders exactly what was declared; `columns` is the resolvable
   * subset, which is what diffing and introspection compare.
   */
  private addCompositeIndex(
    table: TableNode,
    meta: EntityMeta<unknown>,
    idxMeta: EntityIndexMeta,
    resolveColumnName: (key: string, field: FieldOptions) => string,
  ): void {
    // An entry survives if it is an expression (nothing to resolve) or names a column that exists;
    // an index left with none is dropped, the same as one naming only unknown columns always was.
    const entries = idxMeta.columns
      .map((entry) => {
        if (entry.expression) return entry;
        const field = meta.fields[entry.column as keyof typeof meta.fields];
        const column = field && resolveColumnName(entry.column, field);
        return column && table.columns.has(column) ? { ...entry, column } : undefined;
      })
      .filter((entry): entry is IndexColumnSchema => entry !== undefined);
    if (!entries.length) return;

    const columns = entries
      .map((entry) => (entry.expression ? undefined : table.columns.get(entry.column)))
      .filter((column): column is ColumnNode => column !== undefined);
    const named = columns.length ? columns.map((column) => column.name) : entries.map((_, at) => `expr${at}`);

    this.ast.addIndex({
      name: idxMeta.name ?? `idx_${table.name}_${named.join('_')}`,
      table,
      columns,
      entries,
      include: idxMeta.include,
      unique: idxMeta.unique ?? false,
      type: idxMeta.type,
      where: idxMeta.where,
      distance: idxMeta.distance,
      m: idxMeta.m,
      efConstruction: idxMeta.efConstruction,
      lists: idxMeta.lists,
      source: 'entity',
      syncStatus: 'entity_only',
    });
  }
}
