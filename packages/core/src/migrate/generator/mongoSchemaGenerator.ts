import { AbstractDialect } from '../../dialect/index.js';
import { getMeta } from '../../entity/index.js';
import type { ForeignKeyAction, IndexNode, TableNode } from '../../schema/types.js';
import type { IndexSchema, NamingStrategy, SchemaDiff, SchemaGenerator, Type } from '../../type/index.js';
import type { TableDefinition } from '../builder/types.js';

export class MongoSchemaGenerator extends AbstractDialect implements SchemaGenerator {
  constructor(namingStrategy?: NamingStrategy, defaultForeignKeyAction?: ForeignKeyAction) {
    super('mongodb', namingStrategy, defaultForeignKeyAction);
  }
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

  getSqlType(fieldOptions: any, fieldType?: unknown): string {
    return '';
  }

  getBooleanType(): string {
    return '';
  }

  generateColumnDefinitions(): string[] {
    return [];
  }

  generateColumnDefinition(): string {
    return '';
  }

  generateColumnDefinitionFromSchema(): string {
    return '';
  }

  generateTableConstraints(): string[] {
    return [];
  }

  generateAlterColumnStatements(): string[] {
    return [];
  }

  getTableOptions(): string {
    return '';
  }

  generateColumnComment(): string {
    return '';
  }

  formatDefaultValue(): string {
    return '';
  }

  generateCreateTableFromNode(table: TableNode): string {
    return JSON.stringify({ action: 'createCollection', name: table.name });
  }

  generateCreateIndexFromNode(index: IndexNode): string {
    const key: Record<string, number> = {};
    for (const col of index.columns) {
      key[col.name] = 1;
    }
    return JSON.stringify({
      action: 'createIndex',
      collection: index.table.name,
      name: index.name,
      key,
      options: { unique: index.unique, name: index.name },
    });
  }

  generateDropTableFromNode(table: TableNode): string {
    return JSON.stringify({ action: 'dropCollection', name: table.name });
  }

  generateCreateTableFromDefinition(table: TableDefinition): string {
    return JSON.stringify({ action: 'createCollection', name: table.name });
  }

  generateDropTableSql(tableName: string): string {
    return JSON.stringify({ action: 'dropCollection', name: tableName });
  }

  generateRenameTableSql(oldName: string, newName: string): string {
    return JSON.stringify({ action: 'renameCollection', from: oldName, to: newName });
  }

  generateAddColumnSql(): string {
    return '';
  }

  generateDropColumnSql(): string {
    return '';
  }

  generateRenameColumnSql(): string {
    return '';
  }

  generateAlterColumnSql(): string {
    return '';
  }

  generateCreateIndexSql(tableName: string, index: IndexSchema): string {
    return this.generateCreateIndex(tableName, index);
  }

  generateDropIndexSql(tableName: string, indexName: string): string {
    return this.generateDropIndex(tableName, indexName);
  }

  generateAddForeignKeySql(): string {
    return '';
  }

  generateDropForeignKeySql(): string {
    return '';
  }

  diffSchema<E>(entity: Type<E>, currentTable: TableNode | undefined): SchemaDiff | undefined {
    const meta = getMeta(entity);
    const collectionName = this.resolveTableName(entity, meta);

    if (!currentTable) {
      return { tableName: collectionName, type: 'create' };
    }

    const indexesToAdd: IndexSchema[] = [];
    const existingIndexes = new Set(currentTable.indexes?.map((i) => i.name) ?? []);

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
