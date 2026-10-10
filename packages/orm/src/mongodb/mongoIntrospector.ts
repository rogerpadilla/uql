import type { IndexFacet } from '../schema/indexDifferences.js';
import { createTableNode, SchemaAST } from '../schema/schemaAST.js';
import type { TableNode } from '../schema/types.js';
import type { QuerierPool, SchemaIntrospector, TableSchema } from '../type/index.js';
import { type MongoValidator, validatorCheck } from './mongoCommand.js';
import { type MongoQuerier, withMongoQuerierForMigrations } from './mongoQuerier.js';
import { textConfigOf } from './textLanguage.js';

/** The parts of a `listIndexes` entry this introspector reads: the server names every index. */
type MongoIndex = {
  readonly name: string;
  readonly key: Record<string, unknown>;
  readonly unique?: boolean;
  /** A text index's fields and their weights, alphabetically: its key is `_fts`/`_ftsx` instead. */
  readonly weights?: Record<string, number>;
  /** The language a text index stems in. */
  readonly default_language?: string;
  /** A partial index's filter document, which is its predicate. */
  readonly partialFilterExpression?: Record<string, unknown>;
};

/** The parts of an Atlas search index description this introspector reads. */
type MongoSearchIndexInfo = {
  readonly name: string;
  readonly type?: string;
  readonly latestDefinition: { readonly fields: readonly { readonly path: string }[] };
};

/** What a server without Atlas Search answers a search index command with. */
const SEARCH_NOT_ENABLED = 31082;

/**
 * MongoDB schema introspector.
 * MongoDB doesn't have a fixed schema, so this primarily focuses on collections and indexes.
 */
export class MongoSchemaIntrospector implements SchemaIntrospector {
  constructor(private readonly pool: QuerierPool) {}

  async introspect(tables?: readonly string[]): Promise<SchemaAST> {
    const tableNames = tables ?? (await this.getTableNames());
    const ast = new SchemaAST();

    for (const name of tableNames) {
      const schema = await this.getTableSchema(name);
      if (schema) {
        ast.addTable(buildTable(schema));
      }
    }

    return ast;
  }

  async getTableSchema(tableName: string): Promise<TableSchema | undefined> {
    return this.withDb(async (db) => {
      const [info] = await db.listCollections({ name: tableName, type: 'collection' }, { nameOnly: false }).toArray();
      if (!info) {
        return undefined;
      }
      // Annotated: the driver types a collection's options as `Document`, whose members are `any`.
      const validator: MongoValidator | undefined = info.options?.['validator'];

      // Annotated: the driver types a `listIndexes` entry as `any`, and its `indexes()` leaves `name` optional.
      const collection = db.collection(tableName);
      const indexes: readonly MongoIndex[] = await collection.listIndexes().toArray();
      const searchIndexes = await listSearchIndexes(collection);

      return {
        name: tableName,
        columns: [],
        ...(validator && { checks: [validatorCheck(tableName, validator)] }),
        indexes: [
          ...indexes.map(({ name, key, unique, weights, default_language, partialFilterExpression }) => ({
            name,
            unique: !!unique,
            ...(partialFilterExpression && { where: JSON.stringify(partialFilterExpression) }),
            ...(weights
              ? {
                  entries: Object.entries(weights).map(textIndexEntry),
                  type: 'fulltext' as const,
                  config: default_language && textConfigOf(default_language),
                }
              : { entries: Object.keys(key).map((column) => ({ column })) }),
          })),
          ...searchIndexes
            .filter((idx) => idx.type === 'vectorSearch')
            .map((idx) => ({
              name: idx.name,
              entries: idx.latestDefinition.fields.map(({ path }) => ({ column: path })),
              unique: false,
              type: 'vectorSearch' as const,
            })),
        ],
      };
    });
  }

  /** Collections only, the way a SQL engine lists its base tables: no view, nor the `system.views` behind one. */
  async getTableNames(): Promise<string[]> {
    return this.withDb(async (db) => {
      const filter = { type: 'collection', name: { $not: /^system\./ } };
      const collections = await db.listCollections(filter, { nameOnly: true }).toArray();
      return collections.map((collection) => collection.name);
    });
  }

  async tableExists(tableName: string): Promise<boolean> {
    return this.withDb((db) => hasCollection(db, tableName));
  }

  private withDb<T>(task: (db: MongoQuerier['db']) => Promise<T>): Promise<T> {
    return withMongoQuerierForMigrations(this.pool, 'MongoSchemaIntrospector', (querier) => task(querier.db));
  }
}

/** A text index field as an entity declares it: its weight stated only where it is not the default 1. */
function textIndexEntry([column, weight]: [string, number]): { column: string; weight?: number } {
  return weight === 1 ? { column } : { column, weight };
}

/** A collection's Atlas search indexes, none where the server has no Atlas Search. */
async function listSearchIndexes(
  collection: ReturnType<MongoQuerier['db']['collection']>,
): Promise<readonly MongoSearchIndexInfo[]> {
  try {
    return await collection.aggregate<MongoSearchIndexInfo>([{ $listSearchIndexes: {} }]).toArray();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === SEARCH_NOT_ENABLED) {
      return [];
    }
    throw error;
  }
}

async function hasCollection(db: MongoQuerier['db'], name: string): Promise<boolean> {
  const collections = await db.listCollections({ name, type: 'collection' }, { nameOnly: true }).toArray();
  return collections.length > 0;
}

/** `listIndexes` keeps a text index's fields in no declared order, so they are compared as a set. */
const INDEX_FACETS: ReadonlySet<IndexFacet> = new Set(['textIndex']);

/**
 * Mongo has no columns to read, so a table's are the fields its indexes name, one node per field. Its
 * validator is its one check.
 */
function buildTable({ name, indexes = [], checks = [] }: TableSchema): TableNode {
  const table = createTableNode(name, undefined, INDEX_FACETS);
  table.checks.push(...checks);

  for (const index of indexes) {
    for (const { column } of index.entries) {
      if (!table.columns.has(column)) {
        table.columns.set(column, {
          name: column,
          type: { category: 'string' },
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
          table,
        });
      }
    }
    table.indexes.push({ ...index, table });
  }

  return table;
}
