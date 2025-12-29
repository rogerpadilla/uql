import type { ColumnType, FieldOptions } from 'nukak/type';
import { AbstractSchemaGenerator } from '../schemaGenerator.js';
import type { ColumnSchema } from '../type.js';

/**
 * MySQL/MariaDB-specific schema generator
 */
export class MysqlSchemaGenerator extends AbstractSchemaGenerator {
  protected readonly serialPrimaryKeyType = 'INT AUTO_INCREMENT PRIMARY KEY';

  public override mapColumnType(columnType: ColumnType, field: FieldOptions): string {
    switch (columnType) {
      case 'int':
        return 'INT';
      case 'smallint':
        return 'SMALLINT';
      case 'bigint':
        return 'BIGINT';
      case 'float':
        return 'FLOAT';
      case 'double':
      case 'real':
        return 'DOUBLE';
      case 'decimal':
      case 'numeric':
        if (field.precision !== undefined) {
          if (field.scale !== undefined) {
            return `DECIMAL(${field.precision}, ${field.scale})`;
          }
          return `DECIMAL(${field.precision})`;
        }
        return 'DECIMAL(10, 2)';
      case 'boolean':
        return 'TINYINT(1)';
      case 'char':
        return `CHAR(${field.length ?? 1})`;
      case 'varchar':
        return `VARCHAR(${field.length ?? 255})`;
      case 'text':
        return 'TEXT';
      case 'uuid':
        return 'CHAR(36)';
      case 'date':
        return 'DATE';
      case 'time':
        return 'TIME';
      case 'timestamp':
      case 'timestamptz':
        return 'TIMESTAMP';
      case 'json':
      case 'jsonb':
        return 'JSON';
      case 'blob':
      case 'bytea':
        return 'BLOB';
      case 'vector':
        // MySQL doesn't have native vector support, use JSON
        return 'JSON';
      case 'serial':
        return 'INT AUTO_INCREMENT';
      case 'bigserial':
        return 'BIGINT AUTO_INCREMENT';
      default:
        return 'TEXT';
    }
  }

  public override getBooleanType(): string {
    return 'TINYINT(1)';
  }

  public override generateAlterColumnStatements(
    tableName: string,
    column: ColumnSchema,
    newDefinition: string,
  ): string[] {
    return [`ALTER TABLE ${this.escapeId(tableName)} MODIFY COLUMN ${newDefinition};`];
  }

  public override generateColumnComment(tableName: string, columnName: string, comment: string): string {
    const escapedComment = comment.replace(/'/g, "''");
    return ` COMMENT '${escapedComment}'`;
  }

  override getTableOptions<E>(): string {
    return ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
  }

  override generateDropIndex(tableName: string, indexName: string): string {
    // MySQL requires table name in DROP INDEX
    return `DROP INDEX ${this.escapeId(indexName)} ON ${this.escapeId(tableName)};`;
  }
}
