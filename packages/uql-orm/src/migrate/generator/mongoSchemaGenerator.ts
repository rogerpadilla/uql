import { AbstractDialect } from '../../dialect/abstractDialect.js';
import { getMeta } from '../../entity/index.js';
import { mongoDialectFeatures } from '../../mongo/mongoDialect.js';
import type { ForeignKeyAction, IndexNode, TableNode } from '../../schema/types.js';
import type {
  CreateSchemaOptions,
  DialectName,
  FieldOptions,
  IndexSchema,
  InsertIdSource,
  NamingStrategy,
  SchemaDiff,
  SchemaGenerator,
  Type,
} from '../../type/index.js';
import { getKeys } from '../../util/index.js';
import { derivedIndexName } from '../../util/sql.util.js';
import type { TableDefinition } from '../builder/types.js';
import { indexNodeToSchema } from './indexNodeToSchema.js';
import { type MongoIndexKey, serializeMongoCommand } from './mongoCommand.js';

export class MongoSchemaGenerator extends AbstractDialect implements SchemaGenerator {
  readonly dialectName = 'mongodb' satisfies DialectName;

  protected override readonly featureDefaults = mongoDialectFeatures;

  override readonly insertIdSource: InsertIdSource = 'returning';

  constructor(
    namingStrategy?: NamingStrategy,
    protected readonly defaultForeignKeyAction?: ForeignKeyAction,
  ) {
    super({ namingStrategy });
  }

  /**
   * A document store has no cross-collection constraint, so unlike the SQL generator there is nothing to
   * defer and no order to respect: this is each collection and nothing more. `foreignKeys` is accepted
   * and ignored for the same reason.
   */
  generateCreateSchema(entities: readonly Type<unknown>[], options?: CreateSchemaOptions): string[] {
    return this.selected(entities, options?.only).flatMap((entity) => this.generateCreateTable(entity, options));
  }

  generateDropSchema(entities: readonly Type<unknown>[]): string[] {
    return this.selected(entities).map((entity) => this.generateDropTable(this.resolveTableName(getMeta(entity))));
  }

  private selected(entities: readonly Type<unknown>[], only?: readonly string[]): readonly Type<unknown>[] {
    if (!only) {
      return entities;
    }
    const wanted = new Set(only);
    return entities.filter((entity) => wanted.has(this.resolveTableName(getMeta(entity))));
  }

  generateCreateTable<E>(entity: Type<E>, _options?: { ifNotExists?: boolean }): string[] {
    const meta = getMeta(entity);
    const collectionName = this.resolveTableName(meta);
    const indexes: IndexSchema[] = [];

    for (const key of getKeys(meta.fields)) {
      const field = meta.fields[key];
      if (field?.index) {
        const columnName = this.resolveColumnName(key, field);
        const indexName =
          typeof field.index === 'string' ? field.index : derivedIndexName(collectionName, [columnName]);
        indexes.push({
          name: indexName,
          entries: [{ column: columnName }],
          unique: !!field.unique,
        });
      }
    }

    // One `createIndex` command each, mirroring the SQL generator's `[CREATE TABLE, ...CREATE INDEX]`,
    // so the key spec is built here and the migrator only executes it.
    return [
      serializeMongoCommand({ action: 'createCollection', name: collectionName }),
      ...indexes.map((index) => this.generateCreateIndex(collectionName, index)),
    ];
  }

  generateDropTable(tableName: string): string {
    return serializeMongoCommand({ action: 'dropCollection', name: tableName });
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

  /**
   * MongoDB's key spec is where its index options live: `-1` for a descending entry and `'text'` for a
   * full-text index, which is what `$text` needs since a text index declares its own fields.
   *
   * @remarks The SQL-only modifiers are refused rather than dropped, for the same reason the SQL
   * dialects refuse each other's - a silently weaker index is worse than a clear failure. `where`
   * included: MongoDB's partial indexes take a filter document, not a SQL predicate.
   */
  generateCreateIndex(tableName: string, index: IndexSchema): string {
    const key: MongoIndexKey = {};
    for (const entry of index.entries) {
      if (entry.expression || entry.length !== undefined || entry.nulls || entry.opsClass) {
        throw new TypeError(`mongodb does not support that index column option (index "${index.name}")`);
      }
      key[entry.column] = index.type === 'fulltext' ? 'text' : entry.order === 'desc' ? -1 : 1;
    }
    if (index.where) {
      throw new TypeError(`mongodb does not support partial indexes from a SQL predicate (index "${index.name}")`);
    }
    return serializeMongoCommand({
      action: 'createIndex',
      collection: tableName,
      name: index.name,
      key,
      options: { unique: index.unique, name: index.name },
    });
  }

  generateDropIndex(tableName: string, indexName: string): string {
    return serializeMongoCommand({
      action: 'dropIndex',
      collection: tableName,
      name: indexName,
    });
  }

  getSqlType(fieldOptions: FieldOptions, fieldType?: unknown): string {
    return '';
  }

  generateCreateTableFromNode(table: TableNode, _options?: { ifNotExists?: boolean }): string[] {
    return [
      serializeMongoCommand({ action: 'createCollection', name: table.name }),
      ...table.indexes.map((index) => this.generateCreateIndexFromNode(index)),
    ];
  }

  generateCreateIndexFromNode(index: IndexNode): string {
    return this.generateCreateIndex(index.table.name, indexNodeToSchema(index));
  }

  generateCreateTableFromDefinition(table: TableDefinition, _options?: { ifNotExists?: boolean }): string[] {
    return [
      serializeMongoCommand({ action: 'createCollection', name: table.name }),
      ...table.indexes.map((index) => this.generateCreateIndex(table.name, index)),
    ];
  }

  generateRenameTableSql(oldName: string, newName: string): string {
    return serializeMongoCommand({ action: 'renameCollection', from: oldName, to: newName });
  }

  diffSchema<E>(entity: Type<E>, currentTable: TableNode | undefined): SchemaDiff | undefined {
    const meta = getMeta(entity);
    const collectionName = this.resolveTableName(meta);

    if (!currentTable) {
      return { tableName: collectionName, type: 'create' };
    }

    const indexesToAdd: IndexSchema[] = [];
    const existingIndexes = new Set(currentTable.indexes?.map((i) => i.name) ?? []);

    for (const key of getKeys(meta.fields)) {
      const field = meta.fields[key];
      if (field?.index) {
        const columnName = this.resolveColumnName(key, field);
        const indexName =
          typeof field.index === 'string' ? field.index : derivedIndexName(collectionName, [columnName]);
        if (!existingIndexes.has(indexName)) {
          indexesToAdd.push({
            name: indexName,
            entries: [{ column: columnName }],
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
