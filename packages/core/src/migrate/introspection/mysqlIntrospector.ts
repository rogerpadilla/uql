import type { ColumnSchema, ForeignKeySchema, IndexSchema, QuerierPool, SqlQuerier } from '../../type/index.js';
import { AbstractSqlSchemaIntrospector } from './abstractSqlSchemaIntrospector.js';

/**
 * MySQL/MariaDB schema introspector.
 * Works with both MySQL and MariaDB as they share the same information_schema structure.
 */
export class MysqlSchemaIntrospector extends AbstractSqlSchemaIntrospector {
  protected readonly pool: QuerierPool;

  constructor(pool: QuerierPool) {
    super('mysql');
    this.pool = pool;
  }

  // ============================================================================
  // SQL Queries (dialect-specific)
  // ============================================================================

  protected getTableNamesQuery(): string {
    return /*sql*/ `
      SELECT TABLE_NAME as table_name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `;
  }

  protected tableExistsQuery(): string {
    return /*sql*/ `
      SELECT COUNT(*) as count
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `;
  }

  protected parseTableExistsResult(results: Record<string, unknown>[]): boolean {
    const count = results[0]?.count;
    return (typeof count === 'number' || typeof count === 'bigint' ? Number(count) : 0) > 0;
  }

  protected getColumnsQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        COLUMN_NAME as column_name,
        DATA_TYPE as data_type,
        COLUMN_TYPE as column_type,
        IS_NULLABLE as is_nullable,
        COLUMN_DEFAULT as column_default,
        CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
        NUMERIC_PRECISION as numeric_precision,
        NUMERIC_SCALE as numeric_scale,
        COLUMN_KEY as column_key,
        EXTRA as extra,
        COLUMN_COMMENT as column_comment
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `;
  }

  protected getIndexesQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        INDEX_NAME as index_name,
        GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as columns,
        NOT NON_UNIQUE as is_unique
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME != 'PRIMARY'
      GROUP BY INDEX_NAME, NON_UNIQUE
      ORDER BY INDEX_NAME
    `;
  }

  protected getForeignKeysQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        kcu.CONSTRAINT_NAME as constraint_name,
        GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) as columns,
        kcu.REFERENCED_TABLE_NAME as referenced_table,
        GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) as referenced_columns,
        rc.DELETE_RULE as delete_rule,
        rc.UPDATE_RULE as update_rule
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
      WHERE kcu.TABLE_SCHEMA = DATABASE()
        AND kcu.TABLE_NAME = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      GROUP BY kcu.CONSTRAINT_NAME, kcu.REFERENCED_TABLE_NAME, rc.DELETE_RULE, rc.UPDATE_RULE
      ORDER BY kcu.CONSTRAINT_NAME
    `;
  }

  protected getPrimaryKeyQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT COLUMN_NAME as column_name
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION
    `;
  }

  // ============================================================================
  // Row Mapping (dialect-specific)
  // ============================================================================

  protected mapTableNameRow(row: Record<string, unknown>): string {
    return row.table_name as string;
  }

  protected async mapColumnsResult(
    _querier: SqlQuerier,
    _tableName: string,
    results: Record<string, unknown>[],
  ): Promise<ColumnSchema[]> {
    return results.map((row) => ({
      name: row.column_name as string,
      type: ((row.column_type as string) || '').toUpperCase(),
      nullable: row.is_nullable === 'YES',
      defaultValue: this.parseDefaultValue(row.column_default as string | null),
      isPrimaryKey: row.column_key === 'PRI',
      isAutoIncrement: ((row.extra as string) || '').toLowerCase().includes('auto_increment'),
      isUnique: row.column_key === 'UNI',
      length: this.toNumber(row.character_maximum_length as number | bigint | null),
      precision: this.toNumber(row.numeric_precision as number | bigint | null),
      scale: this.toNumber(row.numeric_scale as number | bigint | null),
      comment: (row.column_comment as string) || undefined,
    }));
  }

  protected async mapIndexesResult(
    _querier: SqlQuerier,
    _tableName: string,
    results: Record<string, unknown>[],
  ): Promise<IndexSchema[]> {
    return results.map((row) => ({
      name: row.index_name as string,
      columns: ((row.columns as string) || '').split(','),
      unique: Boolean(row.is_unique),
    }));
  }

  protected async mapForeignKeysResult(
    _querier: SqlQuerier,
    _tableName: string,
    results: Record<string, unknown>[],
  ): Promise<ForeignKeySchema[]> {
    return results.map((row) => ({
      name: row.constraint_name as string,
      columns: ((row.columns as string) || '').split(','),
      referencedTable: row.referenced_table as string,
      referencedColumns: ((row.referenced_columns as string) || '').split(','),
      onDelete: this.normalizeReferentialAction(row.delete_rule as string),
      onUpdate: this.normalizeReferentialAction(row.update_rule as string),
    }));
  }

  protected mapPrimaryKeyResult(results: Record<string, unknown>[]): string[] | undefined {
    if (results.length === 0) {
      return undefined;
    }
    return results.map((r) => r.column_name as string);
  }

  protected parseDefaultValue(defaultValue: string | null): unknown {
    if (defaultValue === null) {
      return undefined;
    }

    if (defaultValue === 'NULL') {
      return null;
    }
    // Normalize timestamp defaults (MariaDB uses current_timestamp(), MySQL uses CURRENT_TIMESTAMP)
    if (defaultValue.toLowerCase() === 'current_timestamp' || defaultValue.toLowerCase() === 'current_timestamp()') {
      return 'CURRENT_TIMESTAMP';
    }
    if (/^'.*'$/.test(defaultValue)) {
      return defaultValue.slice(1, -1);
    }
    if (/^-?\d+$/.test(defaultValue)) {
      return Number.parseInt(defaultValue, 10);
    }
    if (/^-?\d+\.\d+$/.test(defaultValue)) {
      return Number.parseFloat(defaultValue);
    }

    return defaultValue;
  }
}

/**
 * Alias for MysqlSchemaIntrospector.
 * MariaDB uses the same information_schema structure as MySQL.
 */
export const MariadbSchemaIntrospector = MysqlSchemaIntrospector;
