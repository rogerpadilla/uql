import type { ColumnSchema, ColumnType, FieldOptions, NamingStrategy } from '../../type/index.js';
import { AbstractSchemaGenerator } from '../schemaGenerator.js';

/**
 * PostgreSQL-specific schema generator
 */
export class PostgresSchemaGenerator extends AbstractSchemaGenerator {
  protected readonly serialPrimaryKeyType = 'SERIAL PRIMARY KEY';

  constructor(namingStrategy?: NamingStrategy) {
    super(namingStrategy, '"');
  }

  public override mapColumnType(columnType: ColumnType, field: FieldOptions): string {
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

  public override getBooleanType(): string {
    return 'BOOLEAN';
  }

  public override generateAlterColumnStatements(
    tableName: string,
    column: ColumnSchema,
    newDefinition: string,
  ): string[] {
    const statements: string[] = [];
    const escapedTableName = this.escapeId(tableName);
    const escapedColumnName = this.escapeId(column.name);

    // PostgreSQL uses separate ALTER COLUMN clauses for different changes
    // 1. Change type
    statements.push(`ALTER TABLE ${escapedTableName} ALTER COLUMN ${escapedColumnName} TYPE ${column.type};`);

    // 2. Change nullability
    if (column.nullable) {
      statements.push(`ALTER TABLE ${escapedTableName} ALTER COLUMN ${escapedColumnName} DROP NOT NULL;`);
    } else {
      statements.push(`ALTER TABLE ${escapedTableName} ALTER COLUMN ${escapedColumnName} SET NOT NULL;`);
    }

    // 3. Change default value
    if (column.defaultValue !== undefined) {
      statements.push(
        `ALTER TABLE ${escapedTableName} ALTER COLUMN ${escapedColumnName} SET DEFAULT ${this.formatDefaultValue(column.defaultValue)};`,
      );
    } else {
      statements.push(`ALTER TABLE ${escapedTableName} ALTER COLUMN ${escapedColumnName} DROP DEFAULT;`);
    }

    return statements;
  }

  public override generateColumnComment(tableName: string, columnName: string, comment: string): string {
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
