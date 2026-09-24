import { fieldOf, foreignKeysOf, getMeta } from '../entity/metadata/definition.js';
import type {
  EntityIndexColumn,
  EntityIndexMeta,
  EntityMeta,
  EntityWhereMeta,
  FieldOptions,
  Type,
} from '../type/index.js';
import type { NamingStrategy } from '../type/namingStrategy.js';
import { declaredIndexes, declaredIndexName, renderIndexColumn } from '../util/ddlExpression.util.js';
import { fulltextWeights, textWeightSteps } from '../util/dialect.util.js';
import { isAutoIncrement, isInlinedExpression, isSoleIdField } from '../util/field.util.js';
import { definedEntries } from '../util/object.util.js';
import { derivedForeignKeyName, derivedIndexName, qualifyName } from '../util/sql.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { resolveColumnCanonicalType } from './canonicalType.js';
import { createTableNode, keyOfColumns, SchemaAST } from './schemaAST.js';
import { type ColumnNode, DEFAULT_FOREIGN_KEY_ACTION, type ForeignKeyAction, type TableNode } from './types.js';

/**
 * Options for building SchemaAST from entities.
 */
export interface BuildSchemaASTOptions {
  /** Custom resolver for a table's own name, unqualified. */
  resolveTableName?: (meta: EntityMeta<object>) => string;
  /** Custom resolver for the schema a table lives in; `undefined` leaves it unqualified. */
  resolveSchema?: (meta: EntityMeta<object>) => string | undefined;
  /** Custom column name resolver */
  resolveColumnName?: (key: string, field: FieldOptions) => string;
  /** Naming strategy to use */
  namingStrategy?: NamingStrategy;
  /** Default action for foreign key ON DELETE and ON UPDATE clauses */
  defaultForeignKeyAction?: ForeignKeyAction;
  /**
   * The text of SQL an entity declares - a check, a stored computed column, an index expression or
   * predicate - which only a dialect can render. `buildEntityAST` supplies it from the generator.
   */
  compileDdl?: (sql: EntityWhereMeta<object>, entity: Type<object>) => string;
  /** A partial index's predicate as the engine writes it, `compileDdl` where none is given. `buildEntityAST` supplies it. */
  compileIndexPredicate?: (where: EntityWhereMeta<object>, entity: Type<object>, indexName: string) => string;
  /** Whether a weighted fulltext index declares one of its own for each heavier column, as MySQL scores through one. */
  textScoreIndexes?: boolean;
  /** Whether a column a vector index covers is `NOT NULL` whatever the entity declares, as MariaDB demands. */
  vectorIndexRequiresNotNull?: boolean;
}

/** Everything the passes below share, resolved once so no step has to fall back to a default twice. */
type BuildContext = {
  readonly ast: SchemaAST;
  readonly resolveTableName: (meta: EntityMeta<object>) => string;
  readonly resolveSchema: (meta: EntityMeta<object>) => string | undefined;
  readonly resolveColumnName: (key: string, field: FieldOptions) => string;
  readonly defaultForeignKeyAction: ForeignKeyAction;
  readonly compileDdl: (sql: EntityWhereMeta<object>, entity: Type<object>) => string;
  readonly compileIndexPredicate: (where: EntityWhereMeta<object>, entity: Type<object>, indexName: string) => string;
  readonly textScoreIndexes: boolean;
  readonly vectorIndexRequiresNotNull: boolean;
};

/**
 * Build a SchemaAST from entity classes (decorated with `@Entity`, `@Field`, etc.).
 *
 * Three passes, because each needs the one before it to have finished for *every* entity: a relation
 * resolves against a table another entity declares, and an index against the columns of its own.
 */
export function buildSchemaAST(entities: readonly Type<object>[], options: BuildSchemaASTOptions = {}): SchemaAST {
  const { namingStrategy } = options;
  const compileDdl = options.compileDdl ?? refuseDdl;
  const ctx: BuildContext = {
    ast: new SchemaAST(),
    resolveTableName:
      options.resolveTableName ??
      ((m) => namingStrategy?.tableName(m.name ?? m.entity.name) ?? m.name ?? m.entity.name),
    resolveSchema: options.resolveSchema ?? ((m) => m.schema),
    resolveColumnName: options.resolveColumnName ?? ((k, f) => namingStrategy?.columnName(f.name ?? k) ?? f.name ?? k),
    defaultForeignKeyAction: options.defaultForeignKeyAction ?? DEFAULT_FOREIGN_KEY_ACTION,
    compileDdl,
    compileIndexPredicate: options.compileIndexPredicate ?? compileDdl,
    textScoreIndexes: options.textScoreIndexes ?? false,
    vectorIndexRequiresNotNull: options.vectorIndexRequiresNotNull ?? false,
  };

  for (const pass of [addTableFromEntity, addRelationshipsFromEntity, addIndexesFromEntity]) {
    for (const entity of entities) {
      pass(ctx, getMeta(entity));
    }
  }

  return ctx.ast;
}

/** The `compileDdl` of a build given no dialect, which has nothing to render an entity's SQL with. */
function refuseDdl(): string {
  throw new UqlUsageError(
    'building the schema of an entity that declares SQL (a check, a stored computed column, an index expression or predicate) needs a dialect to render it: pass `compileDdl`, as `buildEntityAST` does',
  );
}

/** The entries a vector index of `meta` covers: the members it names, and any expression. */
function vectorIndexedEntries(meta: EntityMeta<object>): Set<EntityIndexColumn['column']> {
  return new Set(
    (meta.indexes ?? [])
      .filter((index) => index.type === 'vector')
      .flatMap((index) => index.columns.map((entry) => entry.column)),
  );
}

/**
 * Add a table from entity metadata.
 */
function addTableFromEntity(ctx: BuildContext, meta: EntityMeta<object>): void {
  const tableName = ctx.resolveTableName(meta);

  const table = createTableNode(tableName, ctx.resolveSchema(meta));
  const { columns } = table;
  table.checks.push(
    ...(meta.checks ?? []).map(({ name, where }) => ({ name, expression: ctx.compileDdl(where, meta.entity) })),
  );

  const notNull = ctx.vectorIndexRequiresNotNull ? vectorIndexedEntries(meta) : new Set<string>();

  // Add columns from fields
  for (const [key, field] of definedEntries(meta.fields)) {
    // An inlined expression has no column; a stored one is a column like any other.
    if (isInlinedExpression(field)) continue;

    const columnName = ctx.resolveColumnName(key, field);
    const type = resolveColumnCanonicalType(field);

    const isPrimaryKey = field.isId === true;
    const isSoleKey = isSoleIdField(meta, field);
    const column: ColumnNode = {
      name: columnName,
      type,
      // A primary key is NOT NULL in every engine, whatever the entity's property says: `id?: number`
      // is optional because the database assigns it, not because the column accepts a null.
      nullable: isPrimaryKey || notNull.has(key) ? false : (field.nullable ?? true),
      defaultValue: field.defaultValue,
      isPrimaryKey,
      isAutoIncrement: isAutoIncrement(field, isSoleKey),
      isUnique: field.unique ?? false,
      // A stamp is filled by a trigger, so it is a column like any other; only `stored: true` generates.
      generatedAs: field.stored === true && field.computed ? ctx.compileDdl(field.computed, meta.entity) : undefined,
      comment: field.comment,
      enum: field.enum,
      table,
      referencedBy: [],
      references: undefined,
    };

    columns.set(columnName, column);
  }
  table.primaryKey = keyOfColumns(columns.values());

  ctx.ast.addTable(table);
}

/** The node an entity maps to, found under the key {@link SchemaAST} stores it by. */
function tableOf(ctx: BuildContext, meta: EntityMeta<object>): TableNode | undefined {
  return ctx.ast.getTable(qualifyName(ctx.resolveTableName(meta), ctx.resolveSchema(meta)));
}

/**
 * Add a relationship for each foreign key the entity holds, whether a relation declares it or a bare
 * `@Field({ references })` does.
 */
function addRelationshipsFromEntity(ctx: BuildContext, meta: EntityMeta<object>): void {
  const table = tableOf(ctx, meta);
  if (!table) return;

  for (const foreignKey of foreignKeysOf(meta)) {
    const relatedMeta = getMeta(foreignKey.entity());
    const relatedTable = tableOf(ctx, relatedMeta);
    if (!relatedTable) continue;

    // Every pair, not just the first: a composite key is one constraint over all its columns, and
    // the engine requires the referenced columns to match a unique constraint as a whole.
    const localColumns: ColumnNode[] = [];
    const foreignColumns: ColumnNode[] = [];

    for (const { local: localProp, foreign: foreignProp } of foreignKey.references) {
      const localColumn = table.columns.get(ctx.resolveColumnName(localProp, fieldOf(meta, localProp)));
      const foreignColumn = relatedTable.columns.get(
        ctx.resolveColumnName(foreignProp, fieldOf(relatedMeta, foreignProp)),
      );
      if (!localColumn || !foreignColumn) break;
      localColumns.push(localColumn);
      foreignColumns.push(foreignColumn);
    }

    // A pair that cannot be resolved drops the whole constraint: half of one enforces a rule
    // nobody declared, over a subset of the key.
    if (localColumns.length !== foreignKey.references.length) continue;

    ctx.ast.addRelationship({
      name: derivedForeignKeyName(
        table.name,
        localColumns.map((column) => column.name),
      ),
      type: foreignKey.cardinality === 'm1' ? 'ManyToOne' : 'OneToOne',
      from: { table, columns: localColumns },
      to: { table: relatedTable, columns: foreignColumns },
      // Falls back to the FK column's own `onDelete`, which is what makes a bare `@Field({
      // references, onDelete })` work with no relation declared at all.
      onDelete:
        foreignKey.onDelete ?? meta.fields[foreignKey.references[0].local]?.onDelete ?? ctx.defaultForeignKeyAction,
      onUpdate: foreignKey.onUpdate ?? ctx.defaultForeignKeyAction,
    });
  }
}

/**
 * Add indexes from field options (`@Field({ index })`), from `@Index`, and for every foreign
 * key none of those already serves.
 */
function addIndexesFromEntity(ctx: BuildContext, meta: EntityMeta<object>): void {
  const table = tableOf(ctx, meta);
  if (!table) return;

  for (const idxMeta of declaredIndexes(meta)) {
    addCompositeIndex(ctx, table, meta, idxMeta);
  }

  addForeignKeyIndexes(ctx, meta, table);
}

/**
 * An index over each foreign key the table owns, unless one already leads with its columns or a field
 * of it says `index: false`. A relation looks its rows up by these columns, and MySQL alone indexes
 * them on its own. Last, so it sees every index the entity declared.
 */
function addForeignKeyIndexes(ctx: BuildContext, meta: EntityMeta<object>, table: TableNode): void {
  const optedOut = new Set(
    definedEntries(meta.fields).flatMap(([key, field]) =>
      field.index === false ? [ctx.resolveColumnName(key, field)] : [],
    ),
  );
  for (const { from } of table.outgoingRelations) {
    const columns = from.columns.map((column) => column.name);
    if (columns.some((column) => optedOut.has(column)) || isIndexedBy(table, columns)) continue;
    ctx.ast.addIndex({
      name: derivedIndexName(table.name, columns),
      table,
      entries: columns.map((column) => ({ column })),
      unique: false,
    });
  }
}

/** Whether the key or an index already leads with `columns`, which is all a lookup needs. */
function isIndexedBy(table: TableNode, columns: readonly string[]): boolean {
  const leads = (indexed: readonly (string | undefined)[]) => columns.every((column, at) => indexed[at] === column);
  return (
    leads(table.primaryKey?.columns ?? []) ||
    table.indexes.some((index) =>
      leads(
        index.entries.map((entry) =>
          entry.expression || entry.jsonPath || entry.jsonArray ? undefined : entry.column,
        ),
      ),
    )
  );
}

/** An `include` column is named like any other, so a naming strategy has to reach it too. */
function resolveIncludeColumn(ctx: BuildContext, meta: EntityMeta<object>, column: string): string {
  const field = meta.fields[column as keyof typeof meta.fields];
  return field ? ctx.resolveColumnName(column, field) : column;
}

/**
 * One index the entity declares. Its entries keep the authored form (expression, prefix length, order) with
 * names resolved, so the generator renders exactly what was declared; `columns` is the resolvable
 * subset, which is what diffing and introspection compare.
 */
function addCompositeIndex(
  ctx: BuildContext,
  table: TableNode,
  meta: EntityMeta<object>,
  idxMeta: EntityIndexMeta,
): void {
  // An entry survives if it is an expression (nothing to resolve) or names a column that exists;
  // an index left with none is dropped, the same as one naming only unknown columns always was.
  const resolved = idxMeta.columns.flatMap((entry) => {
    if (typeof entry.column !== 'string') return [entry];
    const field = meta.fields[entry.column as keyof typeof meta.fields];
    const column = field && ctx.resolveColumnName(entry.column, field);
    return column && table.columns.has(column) ? [{ ...entry, column }] : [];
  });
  if (!resolved.length) return;

  const name = declaredIndexName(idxMeta.name, table.name, resolved);
  ctx.ast.addIndex({
    name,
    table,
    entries: resolved.map((entry) => renderIndexColumn(entry, (sql) => ctx.compileDdl(sql, meta.entity))),
    include: idxMeta.include?.map((column) => resolveIncludeColumn(ctx, meta, column)),
    unique: idxMeta.unique ?? false,
    type: idxMeta.type,
    where: idxMeta.where && ctx.compileIndexPredicate(idxMeta.where, meta.entity, name),
    distance: idxMeta.distance,
    m: idxMeta.m,
    efConstruction: idxMeta.efConstruction,
    lists: idxMeta.lists,
    config: idxMeta.config,
  });
  if (ctx.textScoreIndexes) {
    addTextScoreIndexes(ctx, table, idxMeta.type, resolved);
  }
}

/** A fulltext index of its own for each column heavier than the index's lightest, which its score reads. */
function addTextScoreIndexes(
  ctx: BuildContext,
  table: TableNode,
  type: EntityIndexMeta['type'],
  entries: readonly EntityIndexColumn[],
): void {
  const weights = fulltextWeights({ type, entries });
  if (!weights) return;
  const { extra } = textWeightSteps(weights);
  entries.forEach((entry, at) => {
    if (extra[at] && typeof entry.column === 'string') {
      ctx.ast.addIndex({
        name: derivedIndexName(table.name, [entry.column, 'score']),
        table,
        entries: [{ column: entry.column }],
        unique: false,
        type: 'fulltext',
      });
    }
  });
}
