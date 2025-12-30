import type { ColumnSchema, ColumnType, FieldOptions } from '../../type/index.js';
import { AbstractSchemaGenerator } from '../schemaGenerator.js';

/**
 * SQLite-specific schema generator
 */
export class SqliteSchemaGenerator extends AbstractSchemaGenerator {
  protected readonly serialPrimaryKeyType = 'INTEGER PRIMARY KEY AUTOINCREMENT';

  public override mapColumnType(columnType: ColumnType, field: FieldOptions): string {
    // SQLite has dynamic typing, but we use type affinity
    switch (columnType) {
      case 'int':
      case 'smallint':
      case 'bigint':
      case 'serial':
      case 'bigserial':
        return 'INTEGER';
      case 'float':
      case 'double':
      case 'real':
      case 'decimal':
      case 'numeric':
        return 'REAL';
      case 'boolean':
        return 'INTEGER'; // SQLite uses 0/1 for booleans
      case 'char':
      case 'varchar':
      case 'text':
      case 'uuid':
        return 'TEXT';
      case 'date':
      case 'time':
      case 'timestamp':
      case 'timestamptz':
        return 'TEXT'; // SQLite stores dates as TEXT or INTEGER
      case 'json':
      case 'jsonb':
        return 'TEXT'; // SQLite stores JSON as TEXT
      case 'blob':
      case 'bytea':
        return 'BLOB';
      case 'vector':
        return 'TEXT'; // Store as JSON array
      default:
        return 'TEXT';
    }
  }

  public override getBooleanType(): string {
    return 'INTEGER';
  }

  public override generateAlterColumnStatements(
    tableName: string,
    column: ColumnSchema,
    newDefinition: string,
  ): string[] {
    // SQLite has very limited ALTER TABLE support
    // Column type changes require recreating the table
    throw new Error(
      `SQLite does not support altering column '${column.name}' in table '${tableName}'. ` +
        'You need to recreate the table to change column types.',
    );
  }

  public override generateColumnComment(tableName: string, columnName: string, comment: string): string {
    return '';
  }

  override generateDropIndex(tableName: string, indexName: string): string {
    return `DROP INDEX IF EXISTS ${this.escapeId(indexName)};`;
  }

  override formatDefaultValue(value: unknown): string {
    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }
    return super.formatDefaultValue(value);
  }
}
