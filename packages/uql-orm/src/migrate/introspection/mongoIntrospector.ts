import { SchemaAST } from '../../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../../schema/types.js';
import type { MongoQuerier, QuerierPool, SchemaIntrospector, TableSchema } from '../../type/index.js';

/** The parts of a Mongo index description this introspector reads. */
type MongoIndex = { readonly name?: string; readonly key: Record<string, unknown>; readonly unique?: boolean };

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
            for (const { column: colName } of idx.columns) {
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
    return this.pool.withQuerier(async (querier) => {
      const { db } = querier as MongoQuerier;
      const collections = await db.listCollections({ name: tableName }).toArray();
      if (collections.length === 0) {
        return undefined;
      }

      // MongoDB doesn't have a fixed schema, but we can look at the indexes. Annotated rather than
      // inferred: the driver's `indexes()` is overloaded and resolves to `any` on some versions, which
      // silently made every field below unchecked.
      const indexes: readonly MongoIndex[] = await db.collection(tableName).indexes();

      return {
        name: tableName,
        columns: [], // We don't have columns in Mongo
        indexes: indexes.map((idx) => ({
          name: idx.name ?? Object.keys(idx.key).join('_'),
          columns: Object.keys(idx.key).map((column) => ({ column })),
          unique: !!idx.unique,
        })),
      };
    });
  }

  async getTableNames(): Promise<string[]> {
    return this.pool.withQuerier(async (querier) => {
      const { db } = querier as MongoQuerier;
      const collections = await db.listCollections().toArray();
      return collections.map((c: { name: string }) => c.name);
    });
  }

  async tableExists(tableName: string): Promise<boolean> {
    const names = await this.getTableNames();
    return names.includes(tableName);
  }
}
