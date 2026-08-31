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
import { derivedForeignKeyName, derivedIndexName, qualifyName } from '../util/sql.util.js';
import { fieldOptionsToCanonical } from './canonicalType.js';
import { createTableNode, SchemaAST } from './schemaAST.js';
import {
  type CanonicalType,
  type ColumnNode,
  DEFAULT_FOREIGN_KEY_ACTION,
  type ForeignKeyAction,
  type RelationshipNode,
  type TableNode,
} from './types.js';

/**
 * Options for building SchemaAST from entities.
 */
export interface BuildSchemaASTOptions {
  /** Custom resolver for a table's own name, unqualified. */
  resolveTableName?: (meta: EntityMeta<unknown>) => string;
  /** Custom resolver for the schema a table lives in; `undefined` leaves it unqualified. */
  resolveSchema?: (meta: EntityMeta<unknown>) => string | undefined;
  /** Custom column name resolver */
  resolveColumnName?: (key: string, field: FieldOptions) => string;
  /** Naming strategy to use */
  namingStrategy?: NamingStrategy;
  /** Default action for foreign key ON DELETE and ON UPDATE clauses */
  defaultForeignKeyAction?: ForeignKeyAction;
}

/** Everything the passes below share, resolved once so no step has to fall back to a default twice. */
type BuildContext = {
  readonly ast: SchemaAST;
  readonly resolveTableName: (meta: EntityMeta<unknown>) => string;
  readonly resolveSchema: (meta: EntityMeta<unknown>) => string | undefined;
  readonly resolveColumnName: (key: string, field: FieldOptions) => string;
  readonly defaultForeignKeyAction: ForeignKeyAction;
};

/**
 * Build a SchemaAST from entity classes (decorated with `@Entity`, `@Field`, etc.).
 *
 * Three passes, because each needs the one before it to have finished for *every* entity: a relation
 * resolves against a table another entity declares, and an index against the columns of its own.
 */
export function buildSchemaAST(entities: readonly Type<unknown>[], options: BuildSchemaASTOptions = {}): SchemaAST {
  const { namingStrategy } = options;
  const ctx: BuildContext = {
    ast: new SchemaAST(),
    resolveTableName:
      options.resolveTableName ??
      ((m) => namingStrategy?.tableName(m.name ?? m.entity.name) ?? m.name ?? m.entity.name),
    resolveSchema: options.resolveSchema ?? ((m) => m.schema),
    resolveColumnName: options.resolveColumnName ?? ((k, f) => namingStrategy?.columnName(f.name ?? k) ?? f.name ?? k),
    defaultForeignKeyAction: options.defaultForeignKeyAction ?? DEFAULT_FOREIGN_KEY_ACTION,
  };

  for (const pass of [addTableFromEntity, addRelationshipsFromEntity, addIndexesFromEntity]) {
    for (const entity of entities) {
      pass(ctx, getMeta(entity));
    }
  }

  return ctx.ast;
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
function resolveColumnCanonicalType(field: FieldOptions, seen: Set<EntityGetter> = new Set()): CanonicalType {
  const hasExplicitType = !!field.columnType || !field.typeFromReference;
  if (!hasExplicitType && field.references && !seen.has(field.references)) {
    seen.add(field.references);
    const referencedMeta = getMeta(field.references());
    const referencedIdField = referencedMeta.fields[referencedMeta.id as string];
    if (referencedIdField) {
      return resolveColumnCanonicalType(referencedIdField, seen);
    }
  }
  return fieldOptionsToCanonical(field, field.type);
}

/**
 * Add a table from entity metadata.
 */
function addTableFromEntity(ctx: BuildContext, meta: EntityMeta<unknown>): void {
  const tableName = ctx.resolveTableName(meta);

  const table = createTableNode(tableName, ctx.resolveSchema(meta));
  const { columns, primaryKey } = table;

  // Add columns from fields
  const fields = meta.fields;
  for (const key of Object.keys(fields)) {
    const field = fields[key];
    if (!field) continue;

    // Skip virtual fields
    if (field.virtual) continue;

    const columnName = ctx.resolveColumnName(key, field);
    const type = resolveColumnCanonicalType(field);

    const isPrimaryKey = key === meta.id;
    const column: ColumnNode = {
      name: columnName,
      type,
      // A primary key is NOT NULL in every engine, whatever the entity's property says: `id?: number`
      // is optional because the database assigns it, not because the column accepts a null.
      nullable: isPrimaryKey ? false : (field.nullable ?? true),
      defaultValue: field.defaultValue,
      isPrimaryKey,
      isAutoIncrement: field.autoIncrement ?? (isPrimaryKey && type.category === 'integer'),
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

  ctx.ast.addTable(table);
}

/** The node an entity maps to, found under the key {@link SchemaAST} stores it by. */
function tableOf(ctx: BuildContext, meta: EntityMeta<unknown>): TableNode | undefined {
  return ctx.ast.getTable(qualifyName(ctx.resolveTableName(meta), ctx.resolveSchema(meta)));
}

/**
 * Add relationships from entity relation decorators.
 */
function addRelationshipsFromEntity(ctx: BuildContext, meta: EntityMeta<unknown>): void {
  const table = tableOf(ctx, meta);
  if (!table) return;

  const relations = meta.relations;
  for (const key of Object.keys(relations)) {
    const relation = relations[key];
    if (!relation) continue;

    const relatedMeta = getMeta(relation.entity());
    const relatedTable = tableOf(ctx, relatedMeta);
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

      const localColName = ctx.resolveColumnName(localPropName, localField);
      const foreignField = relatedMeta.fields[foreignPropName];
      if (!foreignField) continue;

      const foreignColName = ctx.resolveColumnName(foreignPropName, foreignField);

      const localColumn = table.columns.get(localColName);
      const foreignColumn = relatedTable.columns.get(foreignColName);

      if (localColumn && foreignColumn) {
        const relNode: RelationshipNode = {
          name: derivedForeignKeyName(table.name, [localColName]),
          type: relation.cardinality === 'm1' ? 'ManyToOne' : 'OneToOne',
          from: { table, columns: [localColumn] },
          to: { table: relatedTable, columns: [foreignColumn] },
          // Falls back to the FK column's own `onDelete`, which is what makes a bare `@Field({
          // references, onDelete })` work with no relation declared at all.
          onDelete: relation.onDelete ?? localField.onDelete ?? ctx.defaultForeignKeyAction,
          onUpdate: relation.onUpdate ?? ctx.defaultForeignKeyAction,
          confidence: 1.0,
          inferredFrom: 'entity_decorator',
        };

        ctx.ast.addRelationship(relNode);
      }
    }
  }
}

/**
 * Add indexes from field options (`@Field({ index })`) and from `@Index([...])`, which have nothing
 * in common beyond their target table.
 */
function addIndexesFromEntity(ctx: BuildContext, meta: EntityMeta<unknown>): void {
  const table = tableOf(ctx, meta);
  if (!table) return;

  for (const key of Object.keys(meta.fields)) {
    const field = meta.fields[key];
    if (!field?.index) continue;
    const column = table.columns.get(ctx.resolveColumnName(key, field));
    if (!column) continue;
    ctx.ast.addIndex({
      name: typeof field.index === 'string' ? field.index : derivedIndexName(table.name, [column.name]),
      table,
      entries: [{ column: column.name }],
      unique: field.unique ?? false,
      source: 'entity',
      syncStatus: 'entity_only',
    });
  }

  for (const idxMeta of meta.indexes ?? []) {
    addCompositeIndex(ctx, table, meta, idxMeta);
  }
}

/**
 * One `@Index([...])`. Its entries keep the authored form (expression, prefix length, order) with
 * names resolved, so the generator renders exactly what was declared; `columns` is the resolvable
 * subset, which is what diffing and introspection compare.
 */
/** An `include` column is named like any other, so a naming strategy has to reach it too. */
function resolveIncludeColumn(ctx: BuildContext, meta: EntityMeta<unknown>, column: string): string {
  const field = meta.fields[column as keyof typeof meta.fields];
  return field ? ctx.resolveColumnName(column, field) : column;
}

function addCompositeIndex(
  ctx: BuildContext,
  table: TableNode,
  meta: EntityMeta<unknown>,
  idxMeta: EntityIndexMeta,
): void {
  // An entry survives if it is an expression (nothing to resolve) or names a column that exists;
  // an index left with none is dropped, the same as one naming only unknown columns always was.
  const entries = idxMeta.columns
    .map((entry) => {
      if (entry.expression) return entry;
      const field = meta.fields[entry.column as keyof typeof meta.fields];
      const column = field && ctx.resolveColumnName(entry.column, field);
      return column && table.columns.has(column) ? { ...entry, column } : undefined;
    })
    .filter((entry): entry is IndexColumnSchema => entry !== undefined);
  if (!entries.length) return;

  // An index over expressions alone has no column names to build a default name from.
  const named = entries.map((entry, at) => (entry.expression ? `expr${at}` : entry.column));

  ctx.ast.addIndex({
    name: idxMeta.name ?? derivedIndexName(table.name, named),
    table,
    entries,
    include: idxMeta.include?.map((column) => resolveIncludeColumn(ctx, meta, column)),
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
