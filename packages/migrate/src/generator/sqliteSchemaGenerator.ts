import type { ColumnType, FieldOptions } from 'nukak/type';
import { AbstractSchemaGenerator } from '../schemaGenerator.js';

/**
 * SQLite-specific schema generator
 */
export class SqliteSchemaGenerator extends AbstractSchemaGenerator {
  protected readonly serialPrimaryKeyType = 'INTEGER PRIMARY KEY AUTOINCREMENT';

  protected mapColumnType(columnType: ColumnType, field: FieldOptions): string {
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

  protected getBooleanType(): string {
    return 'INTEGER';
  }

  protected generateAlterColumnStatement(tableName: string, columnName: string, newDefinition: string): string {
    // SQLite has very limited ALTER TABLE support
    // Column type changes require recreating the table
    // This is a simplified version that may not work for all cases
    throw new Error(
      'SQLite does not support altering column definitions. ' +
        'You need to recreate the table to change column types.',
    );
  }

  override generateDropIndex(tableName: string, indexName: string): string {
    return `DROP INDEX IF EXISTS ${this.escapeId(indexName)};`;
  }

  protected override formatDefaultValue(value: unknown): string {
    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }
    return super.formatDefaultValue(value);
  }
}
