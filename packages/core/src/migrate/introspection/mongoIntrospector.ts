import { SchemaAST } from '../../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../../schema/types.js';
import type { MongoQuerier, QuerierPool, SchemaIntrospector, TableSchema } from '../../type/index.js';

/**
 * MongoDB schema introspector.
 * MongoDB doesn't have a fixed schema, so this primarily focuses on collections and indexes.
 */
export class MongoSchemaIntrospector implements SchemaIntrospector {
  constructor(private readonly pool: QuerierPool) {}

  async introspect(): Promise<SchemaAST> {
    const tableNames = await this.getTableNames();
    const ast = new SchemaAST();

    for (const name of tableNames) {
      const schema = await this.getTableSchema(name);
      if (schema) {
        const columns = new Map<string, ColumnNode>();
        const table: TableNode = {
          name,
          columns,
          primaryKey: [],
          indexes: [],
          schema: ast,
          incomingRelations: [],
          outgoingRelations: [],
        };

        if (schema.indexes) {
          for (const idx of schema.indexes) {
            const indexColumns: ColumnNode[] = [];
            for (const colName of idx.columns) {
              let column = columns.get(colName);
              if (!column) {
                column = {
                  name: colName,
                  type: { category: 'string' }, // MongoDB fields are flexible, but indexes usually target strings/numbers
                  nullable: true,
                  isPrimaryKey: false,
                  isAutoIncrement: false,
                  isUnique: false,
                  table,
                  referencedBy: [],
                };
                columns.set(colName, column);
              }
              indexColumns.push(column);
            }
            table.indexes.push({
              name: idx.name,
              table,
              columns: indexColumns,
              unique: idx.unique,
            });
          }
        }

        ast.addTable(table);
      }
    }

    return ast;
  }

  async getTableSchema(tableName: string): Promise<TableSchema | undefined> {
    const querier = await this.pool.getQuerier();
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
    const querier = await this.pool.getQuerier();
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
