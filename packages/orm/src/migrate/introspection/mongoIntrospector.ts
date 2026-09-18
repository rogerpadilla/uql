import type { IndexFacet } from '../../schema/indexDifferences.js';
import { createTableNode, SchemaAST } from '../../schema/schemaAST.js';
import type { TableNode } from '../../schema/types.js';
import {
  isMongoQuerier,
  type MongoQuerier,
  type QuerierPool,
  type SchemaIntrospector,
  type TableSchema,
} from '../../type/index.js';

/** The parts of a Mongo index description this introspector reads. */
type MongoIndex = {
  readonly name?: string;
  readonly key: Record<string, unknown>;
  readonly unique?: boolean;
  /** A text index's fields and their weights, alphabetically: its key is `_fts`/`_ftsx` instead. */
  readonly weights?: Record<string, number>;
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
  /** `listIndexes` reports keys, uniqueness and text weights; a `partialFilterExpression` is no SQL predicate. */
  readonly indexFacets: ReadonlySet<IndexFacet> = new Set(['textWeights']);

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
      if (!(await hasCollection(db, tableName))) {
        return undefined;
      }

      // Annotated rather than inferred: the driver's `indexes()` is overloaded and resolves to `any` on
      // some versions, which silently made every field below unchecked.
      const collection = db.collection(tableName);
      const indexes: readonly MongoIndex[] = await collection.indexes();
      const searchIndexes = await listSearchIndexes(collection);

      return {
        name: tableName,
        columns: [],
        indexes: [
          ...indexes.map(({ name, key, unique, weights }) => ({
            name: name ?? Object.keys(key).join('_'),
            unique: !!unique,
            ...(weights
              ? { entries: Object.entries(weights).map(textIndexEntry), type: 'fulltext' as const }
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
    return this.pool.withQuerier((querier) => {
      if (!isMongoQuerier(querier)) {
        throw new TypeError('MongoSchemaIntrospector requires a MongoDB querier');
      }
      return task(querier.db);
    });
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

/** Mongo has no columns to read, so a table's are the fields its indexes name, one node per field. */
function buildTable({ name, indexes = [] }: TableSchema): TableNode {
  const table = createTableNode(name);

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
          referencedBy: [],
        });
      }
    }
    table.indexes.push({ name: index.name, table, entries: index.entries, unique: index.unique, type: index.type });
  }

  return table;
}
