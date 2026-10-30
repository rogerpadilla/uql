import { fieldOf, foreignKeysOf, getMeta, ownsSoleKey } from '../entity/metadata/definition.js';
import type {
  IndexEntry,
  EntityIndexMeta,
  EntityMeta,
  EntityWhereMeta,
  FieldOptions,
  AbstractType,
} from '../type/index.js';
import { declaredIndexes, enumCheck, ownedCheck, renderIndex } from '../util/ddlExpression.util.js';
import { fulltextWeights, textWeightSteps } from '../util/dialect.util.js';
import { isInlinedExpression } from '../util/field.util.js';
import { entryColumn, entryColumns, renamedEntry } from '../util/indexEntry.util.js';
import { definedEntries } from '../util/object.util.js';
import { derivedForeignKeyName, derivedIndexName } from '../util/sql.util.js';
import { declaredColumn } from './declaredColumn.js';
import { lookupColumns } from './indexColumns.js';
import { createTableNode, keyOfColumns, SchemaAST } from './schemaAST.js';
import { type ColumnNode, type ForeignKeyAction, type TableNode, type TriggerSchema } from './types.js';

/** What a build needs from its dialect, which `SqlSchemaGenerator.buildAST` supplies. */
export interface BuildSchemaASTOptions {
  /** A table's own name, unqualified. */
  resolveTableName: (meta: EntityMeta<object>) => string;
  /** The schema a table lives in; `undefined` leaves it unqualified. */
  resolveSchema: (meta: EntityMeta<object>) => string | undefined;
  resolveColumnName: (key: string, field: FieldOptions) => string;
  /** Default action for foreign key ON DELETE and ON UPDATE clauses */
  defaultForeignKeyAction: ForeignKeyAction;
  /** The text of SQL an entity declares: a check, a stored computed column, an index expression or predicate. */
  compileDdl: (sql: EntityWhereMeta<object>, entity: AbstractType<object>) => string;
  /** A partial index's predicate as the engine writes it. */
  compileIndexPredicate: (where: EntityWhereMeta<object>, entity: AbstractType<object>, indexName: string) => string;
  /** Whether a weighted fulltext index declares one of its own for each heavier column, as MySQL scores through one. */
  textScoreIndexes: boolean;
  /** Whether a column a vector index covers is `NOT NULL` whatever the entity declares, as MariaDB demands. */
  vectorIndexRequiresNotNull: boolean;
  /** The triggers an entity's table carries, as its dialect renders them. */
  renderTriggers: (meta: EntityMeta<object>) => TriggerSchema[];
}

/** What the passes below share. */
type BuildContext = Readonly<BuildSchemaASTOptions> & {
  readonly ast: SchemaAST;
  /** The table each entity of the build made, which a relation to one outside it has none of. */
  readonly tables: Map<EntityMeta<object>, TableNode>;
};

/**
 * Build a SchemaAST from entity classes (decorated with `@Entity`, `@Field`, etc.).
 *
 * Three passes, because each needs the one before it to have finished for *every* entity: a relation
 * resolves against a table another entity declares, and an index against the columns of its own.
 */
export function buildSchemaAST(entities: readonly AbstractType<object>[], options: BuildSchemaASTOptions): SchemaAST {
  const ctx: BuildContext = { ...options, ast: new SchemaAST(), tables: new Map() };

  for (const entity of entities) {
    const meta = getMeta(entity);
    ctx.tables.set(meta, addTableFromEntity(ctx, meta));
  }
  for (const pass of [addRelationshipsFromEntity, addIndexesFromEntity]) {
    for (const [meta, table] of ctx.tables) {
      pass(ctx, meta, table);
    }
  }

  return ctx.ast;
}

/** The members a vector index of `meta` covers by name. */
function vectorIndexedEntries(meta: EntityMeta<object>): Set<string> {
  return new Set(
    (meta.indexes ?? []).filter((index) => index.type === 'vector').flatMap((index) => entryColumns(index.entries)),
  );
}

/**
 * Add a table from entity metadata.
 */
function addTableFromEntity(ctx: BuildContext, meta: EntityMeta<object>): TableNode {
  const tableName = ctx.resolveTableName(meta);

  const table = createTableNode(tableName, ctx.resolveSchema(meta));
  const { columns } = table;
  table.checks.push(
    ...(meta.checks ?? []).map(({ name, where }) => ownedCheck(tableName, name, ctx.compileDdl(where, meta.entity))),
  );

  const notNull = ctx.vectorIndexRequiresNotNull ? vectorIndexedEntries(meta) : new Set<string>();

  // Add columns from fields
  for (const [key, field] of definedEntries(meta.fields)) {
    // An inlined expression has no column; a stored one is a column like any other.
    if (isInlinedExpression(field)) continue;

    const columnName = ctx.resolveColumnName(key, field);
    const column: ColumnNode = {
      ...declaredColumn(field, {
        name: columnName,
        soleKey: ownsSoleKey(meta, key),
        compile: (sql) => ctx.compileDdl(sql, meta.entity),
      }),
      ...(notNull.has(key) && { nullable: false }),
      table,
    };

    columns.set(columnName, column);
    table.checks.push(
      ...enumCheck(tableName, { name: columnName, enum: field.enum }, (sql) => ctx.compileDdl(sql, meta.entity)),
    );
  }
  table.primaryKey = keyOfColumns(columns.values());
  table.triggers.push(...ctx.renderTriggers(meta));

  ctx.ast.addTable(table);
  return table;
}

/**
 * Add a relationship for each foreign key the entity holds, whether a relation declares it or a bare
 * `f.references()` does.
 */
function addRelationshipsFromEntity(ctx: BuildContext, meta: EntityMeta<object>, table: TableNode): void {
  for (const foreignKey of foreignKeysOf(meta)) {
    const relatedMeta = getMeta(foreignKey.entity());
    const relatedTable = ctx.tables.get(relatedMeta);
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
      // Falls back to the FK column's own `onDelete`, which is what makes a bare
      // `f.references(() => X).onDelete(...)` work with no relation declared at all.
      onDelete:
        foreignKey.onDelete ?? meta.fields[foreignKey.references[0].local]?.onDelete ?? ctx.defaultForeignKeyAction,
      onUpdate: foreignKey.onUpdate ?? ctx.defaultForeignKeyAction,
    });
  }
}

/**
 * Add indexes from field options (`.index()`), from `indexes`, and for every foreign
 * key none of those already serves.
 */
function addIndexesFromEntity(ctx: BuildContext, meta: EntityMeta<object>, table: TableNode): void {
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

/** Whether the key or an index the engine can look rows up by already leads with `columns`. */
function isIndexedBy(table: TableNode, columns: readonly string[]): boolean {
  const leads = (indexed: readonly string[]) => columns.every((column, at) => indexed[at] === column);
  return leads(table.primaryKey?.columns ?? []) || table.indexes.some((index) => leads(lookupColumns(index)));
}

/** The column the member `key` of `meta` maps to, or `undefined` where the entity has no such member. */
function fieldColumn(ctx: BuildContext, meta: EntityMeta<object>, key: string): string | undefined {
  const field = meta.fields[key];
  return field && ctx.resolveColumnName(key, field);
}

/**
 * One index the entity declares. Its entries keep the authored form (expression, prefix length, order) with
 * names resolved, so the generator renders exactly what was declared. Every option not resolved here is
 * spread through, so an option added to indexes later cannot be lost.
 */
function addCompositeIndex(
  ctx: BuildContext,
  table: TableNode,
  meta: EntityMeta<object>,
  { entries, include, where, ...options }: EntityIndexMeta,
): void {
  // An entry survives if it is an expression (nothing to resolve) or names a column that exists;
  // an index left with none is dropped, as one naming only unknown columns is.
  const resolved = entries.flatMap((entry): IndexEntry[] => {
    const key = entryColumn(entry);
    if (key === undefined) return [entry];
    const column = fieldColumn(ctx, meta, key);
    return column && table.columns.has(column) ? [renamedEntry(entry, () => column)] : [];
  });
  if (!resolved.length) return;

  const index = renderIndex(
    table.name,
    // An `include` column is named like any other, so a custom naming has to reach it too.
    { ...options, entries: resolved, include: include?.map((column) => fieldColumn(ctx, meta, column) ?? column) },
    (sql) => ctx.compileDdl(sql, meta.entity),
    (label) => where && ctx.compileIndexPredicate(where, meta.entity, label),
  );
  ctx.ast.addIndex({ ...index, table });
  if (ctx.textScoreIndexes) {
    addTextScoreIndexes(ctx, table, options.type, resolved);
  }
}

/** A fulltext index of its own for each column heavier than the index's lightest, which its score reads. */
function addTextScoreIndexes(
  ctx: BuildContext,
  table: TableNode,
  type: EntityIndexMeta['type'],
  entries: readonly IndexEntry[],
): void {
  const weights = fulltextWeights({ type, entries });
  if (!weights) return;
  const { extra } = textWeightSteps(weights);
  entries.forEach((entry, at) => {
    const { column } = entry;
    if (extra[at] && column !== undefined) {
      ctx.ast.addIndex({
        name: derivedIndexName(table.name, [column, 'score']),
        table,
        entries: [{ column }],
        unique: false,
        type: 'fulltext',
      });
    }
  });
}
