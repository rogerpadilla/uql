import { AbstractDialect } from '../../dialect/index.js';
import { getMeta } from '../../entity/index.js';
import type { IndexSchema, SchemaDiff, SchemaGenerator, TableSchema, Type } from '../../type/index.js';

export class MongoSchemaGenerator extends AbstractDialect implements SchemaGenerator {
  generateCreateTable<E>(entity: Type<E>): string {
    const meta = getMeta(entity);
    const collectionName = this.resolveTableName(entity, meta);
    const indexes: IndexSchema[] = [];

    for (const key in meta.fields) {
      const field = meta.fields[key];
      if (field.index) {
        const columnName = this.resolveColumnName(key, field);
        const indexName = typeof field.index === 'string' ? field.index : `idx_${collectionName}_${columnName}`;
        indexes.push({
          name: indexName,
          columns: [columnName],
          unique: !!field.unique,
        });
      }
    }

    return JSON.stringify({ action: 'createCollection', name: collectionName, indexes });
  }

  generateDropTable<E>(entity: Type<E>): string {
    const meta = getMeta(entity);
    const collectionName = this.resolveTableName(entity, meta);
    return JSON.stringify({ action: 'dropCollection', name: collectionName });
  }

  generateAlterTable(diff: SchemaDiff): string[] {
    const statements: string[] = [];
    if (diff.indexesToAdd?.length) {
      for (const index of diff.indexesToAdd) {
        statements.push(this.generateCreateIndex(diff.tableName, index));
      }
    }
    return statements;
  }

  generateAlterTableDown(diff: SchemaDiff): string[] {
    const statements: string[] = [];
    if (diff.indexesToAdd?.length) {
      for (const index of diff.indexesToAdd) {
        statements.push(this.generateDropIndex(diff.tableName, index.name));
      }
    }
    return statements;
  }

  generateCreateIndex(tableName: string, index: IndexSchema): string {
    const key: Record<string, number> = {};
    for (const col of index.columns) {
      key[col] = 1;
    }
    return JSON.stringify({
      action: 'createIndex',
      collection: tableName,
      name: index.name,
      key,
      options: { unique: index.unique, name: index.name },
    });
  }

  generateDropIndex(tableName: string, indexName: string): string {
    return JSON.stringify({
      action: 'dropIndex',
      collection: tableName,
      name: indexName,
    });
  }

  getSqlType(): string {
    return '';
  }

  diffSchema<E>(entity: Type<E>, currentSchema: TableSchema | undefined): SchemaDiff | undefined {
    const meta = getMeta(entity);
    const collectionName = this.resolveTableName(entity, meta);

    if (!currentSchema) {
      return { tableName: collectionName, type: 'create' };
    }

    const indexesToAdd: IndexSchema[] = [];
    const existingIndexes = new Set(currentSchema.indexes?.map((i: IndexSchema) => i.name) ?? []);

    for (const key in meta.fields) {
      const field = meta.fields[key];
      if (field.index) {
        const columnName = this.resolveColumnName(key, field);
        const indexName = typeof field.index === 'string' ? field.index : `idx_${collectionName}_${columnName}`;
        if (!existingIndexes.has(indexName)) {
          indexesToAdd.push({
            name: indexName,
            columns: [columnName],
            unique: !!field.unique,
          });
        }
      }
    }

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
