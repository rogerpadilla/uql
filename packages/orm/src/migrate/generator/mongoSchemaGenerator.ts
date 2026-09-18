import { getMeta } from '../../entity/index.js';
import { MongoDialect, textLanguage } from '../../mongo/mongoDialect.js';
import type { ForeignKeyAction, IndexType, TableNode } from '../../schema/types.js';
import {
  type CreateSchemaOptions,
  type EntityIndexMeta,
  type EntityMeta,
  type EntityWhereMeta,
  type IndexFeature,
  type IndexSchema,
  type NamingStrategy,
  QueryRaw,
  type SchemaDiff,
  type SchemaGenerator,
  type Type,
  type VectorDistance,
} from '../../type/index.js';
import { indexDistance, unsupportedVectorMetric } from '../../type/vector.js';
import { declaredIndexes, declaredIndexName, renderIndexColumn } from '../../util/ddlExpression.util.js';
import { fulltextConfig, fulltextWeights } from '../../util/dialect.util.js';
import type { AnyMigrationOperation, IndexDefinition } from '../builder/types.js';
import { assertIndexFeatures, assertIndexType } from '../ddl/indexDdl.js';
import { assertIndexPredicate, refusedIndexPredicate } from '../indexPredicate.js';
import { renderIndexDefinition } from './definitionToNode.js';
import { type MongoIndexKey, serializeMongoCommand } from './mongoCommand.js';

/** The index types a key spec can say, a plain key or `'text'`, and Atlas's vector search index. */
const MONGO_INDEX_TYPES: ReadonlySet<IndexType> = new Set(['btree', 'fulltext', 'vectorSearch']);

/** A key spec's one feature beyond its keys: a partial filter. */
const MONGO_INDEX_FEATURES: ReadonlySet<IndexFeature> = new Set(['partial']);

/** Atlas's name for each metric a vector search index scores by. */
const ATLAS_SIMILARITY: Partial<Record<VectorDistance, string>> = {
  cosine: 'cosine',
  l2: 'euclidean',
  inner: 'dotProduct',
};

export class MongoSchemaGenerator extends MongoDialect implements SchemaGenerator {
  constructor(
    namingStrategy?: NamingStrategy,
    protected readonly defaultForeignKeyAction?: ForeignKeyAction,
  ) {
    super({ namingStrategy });
  }

  /** A collection has no SQL to render a check, a computed column or an index expression into. */
  compileDdl(): string {
    throw new TypeError('mongodb has no SQL to render a check, a computed column or an index expression into');
  }

  /**
   * A document store has no cross-collection constraint, so unlike the SQL generator there is nothing to
   * defer and no order to respect: this is each collection and nothing more. `foreignKeys` is accepted
   * and ignored for the same reason.
   */
  generateCreateSchema(entities: readonly Type<object>[], options?: CreateSchemaOptions): string[] {
    return this.selected(entities, options?.only).flatMap((entity) => this.generateCreateTable(entity, options));
  }

  generateDropSchema(entities: readonly Type<object>[]): string[] {
    return this.selected(entities).map((entity) => this.generateDropTable(this.resolveTableName(getMeta(entity))));
  }

  private selected(entities: readonly Type<object>[], only?: readonly string[]): readonly Type<object>[] {
    if (!only) {
      return entities;
    }
    const wanted = new Set(only);
    return entities.filter((entity) => wanted.has(this.resolveTableName(getMeta(entity))));
  }

  /**
   * The indexes an entity declares, as the collection would hold them. One owner because two paths need
   * it: creating a collection, and working out which of its indexes are missing.
   */
  private indexesOf<E extends object>(meta: EntityMeta<E>, collectionName: string): IndexSchema[] {
    return declaredIndexes(meta).map((index) => this.indexSchema(meta, collectionName, index));
  }

  /** One declared index, its members resolved to document paths and its `where` to a filter document. */
  private indexSchema<E extends object>(
    meta: EntityMeta<E>,
    collectionName: string,
    index: EntityIndexMeta<E>,
  ): IndexSchema {
    const entries = index.columns
      .map((entry) => renderIndexColumn(entry, () => this.compileDdl()))
      .map((entry) => ({ ...entry, column: this.columnOf(meta, entry.column) }));
    const [first] = index.columns;
    const vector =
      index.type === 'vectorSearch' && typeof first?.column === 'string' ? meta.fields[first.column] : undefined;
    const name = vector
      ? this.vectorSearchIndexName(index.name, entries[0].column)
      : declaredIndexName(index.name, collectionName, entries);
    return {
      name,
      entries,
      unique: index.unique ?? false,
      type: index.type,
      include: index.include,
      where: index.where && this.compileIndexPredicate(index.where, meta.entity, name),
      distance: index.distance ?? vector?.distance,
      dimensions: vector?.dimensions,
    };
  }

  /**
   * The JSON of the document `partialFilterExpression` takes, refused where the predicate reaches past
   * what that holds or what a migration carries as JSON.
   */
  compileIndexPredicate(where: EntityWhereMeta<object>, entity: Type<object>, indexName: string): string {
    if (where instanceof QueryRaw) {
      throw new TypeError(`mongodb does not support partial indexes from a SQL predicate (index "${indexName}")`);
    }
    assertIndexPredicate(where, this.dialectName, indexName);
    const filter = this.renderFilter(entity, where);
    const refused = refusedFilterValue(filter);
    if (refused) {
      throw refusedIndexPredicate(this.dialectName, refused, indexName);
    }
    return JSON.stringify(filter);
  }

  generateCreateTable<E extends object>(entity: Type<E>, _options?: { ifNotExists?: boolean }): string[] {
    const meta = getMeta(entity);
    const collectionName = this.resolveTableName(meta);
    // One `createIndex` command each, mirroring the SQL generator's `[CREATE TABLE, ...CREATE INDEX]`,
    // so the key spec is built here and the migrator only executes it.
    return [
      serializeMongoCommand({ action: 'createCollection', name: collectionName }),
      ...this.indexesOf(meta, collectionName).map((index) => this.generateCreateIndex(collectionName, index)),
    ];
  }

  generateDropTable(tableName: string): string {
    return serializeMongoCommand({ action: 'dropCollection', name: tableName });
  }

  generateAlterTable(diff: SchemaDiff): string[] {
    return (diff.indexesToAdd ?? []).map((index) => this.generateCreateIndex(diff.tableName, index));
  }

  generateAlterTableDown(diff: SchemaDiff): string[] {
    return (diff.indexesToAdd ?? []).map((index) =>
      index.type === 'vectorSearch'
        ? serializeMongoCommand({ action: 'dropSearchIndex', collection: diff.tableName, name: index.name })
        : this.generateDropIndex(diff.tableName, index.name),
    );
  }

  /** An index as MongoDB's key spec (`-1` descending, `'text'` full-text), refusing the SQL-only options. */
  generateCreateIndex(tableName: string, index: IndexSchema): string {
    assertIndexType(index, MONGO_INDEX_TYPES, this.dialectName);
    if (index.type === 'vectorSearch') {
      return this.generateCreateSearchIndex(tableName, index);
    }
    assertIndexFeatures(index, MONGO_INDEX_FEATURES, this.dialectName);
    const key: MongoIndexKey = {};
    for (const entry of index.entries) {
      key[entry.column] = index.type === 'fulltext' ? 'text' : entry.order === 'desc' ? -1 : 1;
    }
    const weights = fulltextWeights(index);
    return serializeMongoCommand({
      action: 'createIndex',
      collection: tableName,
      name: index.name,
      key,
      options: {
        unique: index.unique,
        name: index.name,
        partialFilterExpression: index.where && JSON.parse(index.where),
        weights: weights && Object.fromEntries(index.entries.map((entry, at) => [entry.column, weights[at]])),
        default_language: index.type === 'fulltext' ? textLanguage(fulltextConfig(index)) : undefined,
      },
    });
  }

  /** An Atlas vector search index: its vector field first, then each field a `$vectorSearch` pre-filters on. */
  private generateCreateSearchIndex(tableName: string, index: IndexSchema): string {
    assertIndexFeatures(index, new Set(), this.dialectName);
    const [vector, ...filters] = index.entries;
    if (!vector || index.dimensions === undefined) {
      throw new TypeError(`an Atlas vector search index states its field's dimensions (index "${index.name}")`);
    }
    const distance = indexDistance(index);
    const similarity = ATLAS_SIMILARITY[distance];
    if (!similarity) {
      throw unsupportedVectorMetric(this.dialectName, distance, index.name);
    }
    return serializeMongoCommand({
      action: 'createSearchIndex',
      collection: tableName,
      index: {
        name: index.name,
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'vector', path: vector.column, numDimensions: index.dimensions, similarity },
            ...filters.map((entry) => ({ type: 'filter' as const, path: entry.column })),
          ],
        },
      },
    });
  }

  generateDropIndex(tableName: string, indexName: string): string {
    return serializeMongoCommand({ action: 'dropIndex', collection: tableName, name: indexName });
  }

  /** A collection and its indexes, which is all a document store has: a column, a constraint or SQL throws. */
  generateOperation(operation: AnyMigrationOperation): string[] {
    const render = (index: IndexDefinition) => renderIndexDefinition(index, () => this.compileDdl());
    switch (operation.type) {
      case 'createTable': {
        const { name, columns, indexes } = operation.table;
        if (columns.length) {
          throw new TypeError(`mongodb does not support columns in a migration (collection "${name}")`);
        }
        return [
          serializeMongoCommand({ action: 'createCollection', name }),
          ...indexes.map((index) => this.generateCreateIndex(name, render(index))),
        ];
      }
      case 'dropTable':
        return [this.generateDropTable(operation.tableName)];
      case 'renameTable':
        return [serializeMongoCommand({ action: 'renameCollection', from: operation.oldName, to: operation.newName })];
      case 'createIndex':
        return [this.generateCreateIndex(operation.tableName, render(operation.index))];
      case 'dropIndex':
        return [this.generateDropIndex(operation.tableName, operation.indexName)];
      default:
        throw new TypeError(`mongodb does not support ${operation.type} in a migration`);
    }
  }

  diffSchema(entity: Type<object>, currentTable: TableNode | undefined): SchemaDiff | undefined {
    const meta = getMeta(entity);
    const collectionName = this.resolveTableName(meta);

    if (!currentTable) {
      return { tableName: collectionName, type: 'create' };
    }

    const existingIndexes = new Set(currentTable.indexes.map((i) => i.name));
    const indexesToAdd = this.indexesOf(meta, collectionName).filter((index) => !existingIndexes.has(index.name));

    if (indexesToAdd.length === 0) {
      return undefined;
    }

    return {
      tableName: collectionName,
      type: 'alter',
      indexesToAdd,
    };
  }
}

/** The first value `partialFilterExpression` refuses, `null`, or a migration cannot carry as JSON, such as a `Date`. */
function refusedFilterValue(value: unknown): string | undefined {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return value.map(refusedFilterValue).find(Boolean);
  }
  if (typeof value !== 'object') {
    return typeof value === 'bigint' ? 'a bigint' : undefined;
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).map(refusedFilterValue).find(Boolean);
  }
  const typeName = value.constructor.name;
  return `${/^[aeiou]/i.test(typeName) ? 'an' : 'a'} ${typeName}`;
}
