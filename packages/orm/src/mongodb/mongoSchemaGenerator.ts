import { getMeta } from '../entity/index.js';
import type { AnyMigrationOperation, IndexDefinition } from '../migrate/builder/types.js';
import { INDEX_CAPABILITIES } from '../migrate/ddl/indexCapabilities.js';
import { assertExpressible } from '../migrate/ddl/indexDdl.js';
import { renderIndexDefinition } from '../migrate/generator/definitionToNode.js';
import { indexNodeToSchema } from '../migrate/generator/indexNodeToSchema.js';
import { assertIndexPredicate, refusedIndexPredicate } from '../migrate/indexPredicate.js';
import { sides } from '../migrate/schemaChange.js';
import { indexChanges } from '../schema/indexDifferences.js';
import type { IndexType, TableNode } from '../schema/types.js';
import {
  type CreateSchemaOptions,
  type EntityMeta,
  type EntityWhereMeta,
  type IndexEntry,
  type IndexSchema,
  type NamingStrategy,
  QuerySql,
  type SchemaDiff,
  type SchemaGenerator,
  type AbstractType,
  type VectorDistance,
} from '../type/index.js';
import { indexDistance, unsupportedVectorMetric } from '../type/vector.js';
import { declaredIndexes, renderIndex } from '../util/ddlExpression.util.js';
import { findVectorIndex, fulltextConfig, fulltextWeights, indexedDistance } from '../util/dialect.util.js';
import { entryKeys, entryModifiers, renamedEntry } from '../util/indexEntry.util.js';
import { definedEntries, hasKeys } from '../util/object.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { type MongoIndexKey, type MongoValidator, serializeMongoCommand, validatorCheck } from './mongoCommand.js';
import { MongoDialect } from './mongoDialect.js';
import { documentEntry } from './mongoIntrospector.js';
import { textLanguage } from './textLanguage.js';

/** Atlas's name for each metric a vector search index scores by. */
const ATLAS_SIMILARITY: Partial<Record<VectorDistance, string>> = {
  cosine: 'cosine',
  l2: 'euclidean',
  inner: 'dotProduct',
};

export class MongoSchemaGenerator extends MongoDialect implements SchemaGenerator {
  /** Takes no default foreign key action, since a document store has no foreign keys. */
  constructor(namingStrategy?: NamingStrategy) {
    super({ namingStrategy });
  }

  /**
   * A document store has no cross-collection constraint, so unlike the SQL generator there is nothing to
   * defer and no order to respect: this is each collection and nothing more.
   */
  generateCreateSchema(entities: readonly AbstractType<object>[], options?: CreateSchemaOptions): string[] {
    const wanted = options?.only && new Set(options.only);
    return entities
      .map((entity) => getMeta(entity))
      .filter((meta) => !wanted || wanted.has(this.resolveTableName(meta)))
      .flatMap((meta) => {
        const name = this.resolveTableName(meta);
        return this.createCollection(name, this.indexesOf(meta, name), this.validatorOf(meta, name));
      });
  }

  generateDropSchema(entities: readonly AbstractType<object>[]): string[] {
    return entities.map((entity) =>
      serializeMongoCommand({ action: 'dropCollection', name: this.resolveTableName(getMeta(entity)) }),
    );
  }

  /** A collection, and one `createIndex` command for each of its indexes, as SQL's `[CREATE TABLE, ...CREATE INDEX]`. */
  private createCollection(name: string, indexes: readonly IndexSchema[], validator?: MongoValidator): string[] {
    return [
      serializeMongoCommand({ action: 'createCollection', name, validator }),
      ...indexes.map((index) => this.generateCreateIndex(name, index)),
    ];
  }

  /**
   * The indexes an entity declares, as the collection would hold them: members resolved to document paths, a
   * `where` to a filter document, and every other option spread through, so a new one cannot be lost.
   */
  private indexesOf<E extends object>(meta: EntityMeta<E>, collectionName: string): IndexSchema[] {
    return declaredIndexes(meta).map(({ entries: declared, where, ...options }) => {
      // As the collection reports each back, its document path read the way the introspector reads one; a key
      // spec takes no length.
      const entries = declared.map((entry) => {
        const renamed = renamedEntry(entry, (column) => this.columnOf(meta, column));
        return { ...entryModifiers(renamed), ...documentEntry(documentPath(renamed)) };
      });
      const [first] = declared;
      const vectorKey = options.type === 'vectorSearch' && typeof first?.column === 'string' ? first.column : undefined;
      const vector = vectorKey === undefined ? undefined : meta.fields[vectorKey];
      const index = renderIndex(
        collectionName,
        { ...options, entries },
        refuseSql,
        (label) => where && this.indexFilter(where, meta.entity, label),
      );
      return {
        ...index,
        name: vector ? this.vectorSearchIndexName(options.name, documentPath(entries[0])) : index.name,
        distance:
          vectorKey === undefined
            ? options.distance
            : indexedDistance(meta, vectorKey, findVectorIndex(meta, vectorKey)),
        dimensions: vector?.dimensions,
      };
    });
  }

  /**
   * The JSON of the document `partialFilterExpression` takes, refused where the predicate reaches past
   * what that holds or what a migration carries as JSON.
   */
  private indexFilter(where: EntityWhereMeta<object>, entity: AbstractType<object>, indexName: string): string {
    if (where instanceof QuerySql) {
      throw new UqlUsageError(
        `${this.engineName} does not support partial indexes from a SQL predicate (index "${indexName}")`,
      );
    }
    assertIndexPredicate(where, this, indexName);
    const filter = this.renderFilter(entity, where);
    const refused = refusedFilterValue(filter);
    if (refused) {
      throw refusedIndexPredicate(this.engineName, refused, indexName);
    }
    return JSON.stringify(filter);
  }

  /**
   * The validator enforcing an entity's checks and then its enums, none where it declares neither. An enum is
   * `$in` its values or `null`, so a missing or null value passes, as SQL's `CHECK` passes NULL.
   */
  private validatorOf<E extends object>(meta: EntityMeta<E>, collectionName: string): MongoValidator | undefined {
    const clauses = [
      ...(meta.checks ?? []).map(({ where }) => this.checkFilter(where, meta.entity, collectionName)),
      ...definedEntries(meta.fields).flatMap(([key, field]) =>
        field.enum ? [{ [this.columnOf(meta, key)]: { $in: [...field.enum, null] } }] : [],
      ),
    ].filter(hasKeys);
    return clauses.length > 1 ? { $and: clauses } : clauses[0];
  }

  /** A check's filter, refused where it is SQL or holds what a migration cannot carry as JSON. */
  private checkFilter(
    where: EntityWhereMeta<object>,
    entity: AbstractType<object>,
    collectionName: string,
  ): MongoValidator {
    if (where instanceof QuerySql) {
      throw new UqlUsageError(
        `${this.engineName} does not support checks from a SQL predicate (collection "${collectionName}")`,
      );
    }
    const filter = this.renderFilter(entity, where);
    const refused = refusedFilterValue(filter, true);
    if (refused) {
      throw new UqlUsageError(
        `${this.engineName} does not support ${refused} in a check (collection "${collectionName}")`,
      );
    }
    return filter;
  }

  /**
   * A collection's validator, which a diff holds as its one check, then its indexes: each dropped, then each
   * created, an alter as both. A changed validator is a `collMod` to the new one, a removed one to `{}`.
   */
  generateAlterTable(diff: SchemaDiff): string[] {
    const [validator] = sides(diff.checks, 'to');
    return [
      ...(diff.checks?.length
        ? [
            serializeMongoCommand({
              action: 'collMod',
              name: diff.tableName,
              validator: validator ? JSON.parse(validator.expression) : {},
            }),
          ]
        : []),
      ...sides(diff.indexes, 'from').map((index) => dropIndex(diff.tableName, index.name, index.type)),
      ...sides(diff.indexes, 'to').map((index) => this.generateCreateIndex(diff.tableName, index)),
    ];
  }

  /** An index as MongoDB's key spec (`-1` descending, `'text'` full-text), refusing the SQL-only options. */
  generateCreateIndex(tableName: string, index: IndexSchema): string {
    assertExpressible(index, INDEX_CAPABILITIES[this.dialectName], this.engineName);
    if (index.type === 'vectorSearch') {
      return this.generateCreateSearchIndex(tableName, index);
    }
    const key: MongoIndexKey = {};
    for (const entry of index.entries) {
      key[documentPath(entry)] = index.type === 'fulltext' ? 'text' : entry.order === 'desc' ? -1 : 1;
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
        weights: weights && Object.fromEntries(index.entries.map((entry, at) => [documentPath(entry), weights[at]])),
        default_language: index.type === 'fulltext' ? textLanguage(fulltextConfig(index)) : undefined,
      },
    });
  }

  /** An Atlas vector search index: its vector field first, then each field a `$vectorSearch` pre-filters on. */
  private generateCreateSearchIndex(tableName: string, index: IndexSchema): string {
    const [vector, ...filters] = index.entries;
    if (!vector || index.dimensions === undefined) {
      throw new UqlUsageError(`an Atlas vector search index states its field's dimensions (index "${index.name}")`);
    }
    const distance = indexDistance(index);
    const similarity = ATLAS_SIMILARITY[distance];
    if (!similarity) {
      throw unsupportedVectorMetric(this.engineName, distance, index.name);
    }
    return serializeMongoCommand({
      action: 'createSearchIndex',
      collection: tableName,
      index: {
        name: index.name,
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'vector', path: documentPath(vector), numDimensions: index.dimensions, similarity },
            ...filters.map((entry) => ({ type: 'filter' as const, path: documentPath(entry) })),
          ],
        },
      },
    });
  }

  /** A collection and its indexes, which is all a document store has: a column, a constraint or SQL throws. */
  generateOperation(operation: AnyMigrationOperation): string[] {
    const render = (table: string, index: IndexDefinition) => renderIndexDefinition(table, index, refuseSql);
    switch (operation.type) {
      case 'createTable': {
        const { name, columns, indexes } = operation.table;
        if (columns.length) {
          throw new UqlUsageError(`${this.engineName} does not support columns in a migration (collection "${name}")`);
        }
        return this.createCollection(
          name,
          indexes.map((index) => render(name, index)),
        );
      }
      case 'dropTable':
        return [serializeMongoCommand({ action: 'dropCollection', name: operation.tableName })];
      case 'renameTable':
        return [serializeMongoCommand({ action: 'renameCollection', from: operation.oldName, to: operation.newName })];
      case 'createIndex':
        return [this.generateCreateIndex(operation.tableName, render(operation.tableName, operation.index))];
      case 'dropIndex':
        return [dropIndex(operation.tableName, operation.indexName)];
      default:
        throw new UqlUsageError(`${this.engineName} does not support ${operation.type} in a migration`);
    }
  }

  diffSchema(entity: AbstractType<object>, currentTable: TableNode | undefined): SchemaDiff | undefined {
    const meta = getMeta(entity);
    const collectionName = this.resolveTableName(meta);

    if (!currentTable) {
      return { tableName: collectionName, type: 'create' };
    }

    const declared = this.validatorOf(meta, collectionName);
    const desired = declared && validatorCheck(collectionName, declared);
    const [current] = currentTable.checks;
    const checks = desired?.name === current?.name ? [] : [{ from: current, to: desired }];
    const { changes } = indexChanges(this.indexesOf(meta, collectionName), currentTable);
    const indexes = changes.map(({ from, to }) => ({ from: from && indexNodeToSchema(from), to }));
    return indexes.length || checks.length ? { tableName: collectionName, type: 'alter', checks, indexes } : undefined;
  }
}

/**
 * The document path an index entry keys: its field, then the path inside it, which is how a `$where` on
 * `'settings.theme'` reads it too. An expression entry is refused before any key is built.
 */
function documentPath(entry: IndexEntry<unknown>): string {
  return entryKeys(entry)?.join('.') ?? refuseSql();
}

/** A collection has no SQL to render a check, a computed column or an index expression into. */
function refuseSql(): never {
  throw new UqlUsageError('MongoDB has no SQL to render a check, a computed column or an index expression into');
}

/** The command dropping an index, a search index by its own. */
function dropIndex(collection: string, name: string, type?: IndexType): string {
  return serializeMongoCommand({ action: type === 'vectorSearch' ? 'dropSearchIndex' : 'dropIndex', collection, name });
}

/**
 * The first value a migration cannot carry as JSON, such as a `Date`, or `null` unless `holdsNull`, which a
 * validator does and `partialFilterExpression` does not.
 */
function refusedFilterValue(value: unknown, holdsNull = false): string | undefined {
  const refusedIn = (values: readonly unknown[]) => values.map((it) => refusedFilterValue(it, holdsNull)).find(Boolean);
  if (value === null) {
    return holdsNull ? undefined : 'null';
  }
  if (Array.isArray(value)) {
    return refusedIn(value);
  }
  if (typeof value !== 'object') {
    return typeof value === 'bigint' ? 'a bigint' : undefined;
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    return refusedIn(Object.values(value));
  }
  const typeName = value.constructor.name;
  return `${/^[aeiou]/i.test(typeName) ? 'an' : 'a'} ${typeName}`;
}
