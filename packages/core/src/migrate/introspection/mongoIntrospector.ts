import type { MongoQuerier, QuerierPool, SchemaIntrospector, TableSchema } from '../../type/index.js';

export class MongoSchemaIntrospector implements SchemaIntrospector {
  constructor(private readonly querierPool: QuerierPool) {}

  async getTableSchema(tableName: string): Promise<TableSchema | undefined> {
    const querier = await this.querierPool.getQuerier();
    try {
      const { db } = querier as MongoQuerier;
      const collections = await db.listCollections({ name: tableName }).toArray();
      if (collections.length === 0) {
        return undefined;
      }

      // MongoDB doesn't have a fixed schema, but we can look at the indexes
      const indexes = await db.collection(tableName).indexes();

      return {
        name: tableName,
        columns: [], // We don't have columns in Mongo
        indexes: indexes.map((idx: any) => ({
          name: idx.name,
          columns: Object.keys(idx.key),
          unique: !!idx.unique,
        })),
      };
    } finally {
      await querier.release();
    }
  }

  async getTableNames(): Promise<string[]> {
    const querier = await this.querierPool.getQuerier();
    try {
      const { db } = querier as MongoQuerier;
      const collections = await db.listCollections().toArray();
      return collections.map((c: any) => c.name);
    } finally {
      await querier.release();
    }
  }

  async tableExists(tableName: string): Promise<boolean> {
    const names = await this.getTableNames();
    return names.includes(tableName);
  }
}
