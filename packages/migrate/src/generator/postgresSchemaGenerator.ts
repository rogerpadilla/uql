import type { ColumnType, FieldOptions } from 'nukak/type';
import { AbstractSchemaGenerator } from '../schemaGenerator.js';

/**
 * PostgreSQL-specific schema generator
 */
export class PostgresSchemaGenerator extends AbstractSchemaGenerator {
  protected readonly serialPrimaryKeyType = 'SERIAL PRIMARY KEY';

  constructor() {
    super('"');
  }

  protected mapColumnType(columnType: ColumnType, field: FieldOptions): string {
    switch (columnType) {
      case 'int':
        return 'INTEGER';
      case 'smallint':
        return 'SMALLINT';
      case 'bigint':
        return 'BIGINT';
      case 'float':
      case 'double':
      case 'real':
        return 'DOUBLE PRECISION';
      case 'decimal':
      case 'numeric':
        if (field.precision !== undefined) {
          if (field.scale !== undefined) {
            return `NUMERIC(${field.precision}, ${field.scale})`;
          }
          return `NUMERIC(${field.precision})`;
        }
        return 'NUMERIC';
      case 'boolean':
        return 'BOOLEAN';
      case 'char':
        return `CHAR(${field.length ?? 1})`;
      case 'varchar':
        return `VARCHAR(${field.length ?? 255})`;
      case 'text':
        return 'TEXT';
      case 'uuid':
        return 'UUID';
      case 'date':
        return 'DATE';
      case 'time':
        return 'TIME';
      case 'timestamp':
        return 'TIMESTAMP';
      case 'timestamptz':
        return 'TIMESTAMPTZ';
      case 'json':
        return 'JSON';
      case 'jsonb':
        return 'JSONB';
      case 'blob':
      case 'bytea':
        return 'BYTEA';
      case 'vector':
        if (field.length) {
          return `VECTOR(${field.length})`;
        }
        return 'VECTOR';
      case 'serial':
        return 'SERIAL';
      case 'bigserial':
        return 'BIGSERIAL';
      default:
        return 'TEXT';
    }
  }

  protected getBooleanType(): string {
    return 'BOOLEAN';
  }

  protected generateAlterColumnStatement(tableName: string, columnName: string, newDefinition: string): string {
    // PostgreSQL uses ALTER COLUMN ... TYPE for type changes
    return `ALTER TABLE ${this.escapeId(tableName)} ALTER COLUMN ${newDefinition};`;
  }

  protected override generateColumnComment(comment: string): string {
    // PostgreSQL handles comments separately via COMMENT ON COLUMN
    return '';
  }

  /**
   * Generate COMMENT ON COLUMN statement for PostgreSQL
   */
  generateColumnCommentStatement(tableName: string, columnName: string, comment: string): string {
    const escapedComment = comment.replace(/'/g, "''");
    return `COMMENT ON COLUMN ${this.escapeId(tableName)}.${this.escapeId(columnName)} IS '${escapedComment}';`;
  }

  override generateDropIndex(tableName: string, indexName: string): string {
    // PostgreSQL doesn't require table name in DROP INDEX
    return `DROP INDEX IF EXISTS ${this.escapeId(indexName)};`;
  }
}
