import type { QuerierPool, SqlQuerier } from 'nukak/type';
import { isSqlQuerier } from 'nukak/type';
import type { ColumnSchema, ForeignKeySchema, IndexSchema, SchemaIntrospector, TableSchema } from '../type.js';

/**
 * MySQL/MariaDB schema introspector.
 * Works with both MySQL and MariaDB as they share the same information_schema structure.
 */
export class MysqlSchemaIntrospector implements SchemaIntrospector {
  constructor(private readonly querierPool: QuerierPool) {}

  async getTableSchema(tableName: string): Promise<TableSchema | null> {
    const querier = await this.getQuerier();

    try {
      const exists = await this.tableExistsInternal(querier, tableName);
      if (!exists) {
        return null;
      }

      const [columns, indexes, foreignKeys, primaryKey] = await Promise.all([
        this.getColumns(querier, tableName),
        this.getIndexes(querier, tableName),
        this.getForeignKeys(querier, tableName),
        this.getPrimaryKey(querier, tableName),
      ]);

      return {
        name: tableName,
        columns,
        primaryKey,
        indexes,
        foreignKeys,
      };
    } finally {
      await querier.release();
    }
  }

  async getTableNames(): Promise<string[]> {
    const querier = await this.getQuerier();

    try {
      const sql = `
        SELECT TABLE_NAME as table_name
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `;

      const results = await querier.all<{ table_name: string }>(sql);
      return results.map((r) => r.table_name);
    } finally {
      await querier.release();
    }
  }

  async tableExists(tableName: string): Promise<boolean> {
    const querier = await this.getQuerier();

    try {
      return this.tableExistsInternal(querier, tableName);
    } finally {
      await querier.release();
    }
  }

  private async tableExistsInternal(querier: SqlQuerier, tableName: string): Promise<boolean> {
    const sql = `
      SELECT COUNT(*) as count
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `;

    const results = await querier.all<{ count: number }>(sql, [tableName]);
    return (results[0]?.count ?? 0) > 0;
  }

  private async getQuerier(): Promise<SqlQuerier> {
    const querier = await this.querierPool.getQuerier();

    if (!isSqlQuerier(querier)) {
      await querier.release();
      throw new Error('MysqlSchemaIntrospector requires a SQL-based querier');
    }

    return querier;
  }

  private async getColumns(querier: SqlQuerier, tableName: string): Promise<ColumnSchema[]> {
    const sql = `
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

    const results = await querier.all<{
      column_name: string;
      data_type: string;
      column_type: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      column_key: string;
      extra: string;
      column_comment: string | null;
    }>(sql, [tableName]);

    return results.map((row) => ({
      name: row.column_name,
      type: row.data_type.toUpperCase(),
      nullable: row.is_nullable === 'YES',
      defaultValue: this.parseDefaultValue(row.column_default),
      isPrimaryKey: row.column_key === 'PRI',
      isAutoIncrement: row.extra.toLowerCase().includes('auto_increment'),
      isUnique: row.column_key === 'UNI',
      length: row.character_maximum_length ?? undefined,
      precision: row.numeric_precision ?? undefined,
      scale: row.numeric_scale ?? undefined,
      comment: row.column_comment || undefined,
    }));
  }

  private async getIndexes(querier: SqlQuerier, tableName: string): Promise<IndexSchema[]> {
    const sql = `
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

    const results = await querier.all<{
      index_name: string;
      columns: string;
      is_unique: number;
    }>(sql, [tableName]);

    return results.map((row) => ({
      name: row.index_name,
      columns: row.columns.split(','),
      unique: Boolean(row.is_unique),
    }));
  }

  private async getForeignKeys(querier: SqlQuerier, tableName: string): Promise<ForeignKeySchema[]> {
    const sql = `
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

    const results = await querier.all<{
      constraint_name: string;
      columns: string;
      referenced_table: string;
      referenced_columns: string;
      delete_rule: string;
      update_rule: string;
    }>(sql, [tableName]);

    return results.map((row) => ({
      name: row.constraint_name,
      columns: row.columns.split(','),
      referencedTable: row.referenced_table,
      referencedColumns: row.referenced_columns.split(','),
      onDelete: this.normalizeReferentialAction(row.delete_rule),
      onUpdate: this.normalizeReferentialAction(row.update_rule),
    }));
  }

  private async getPrimaryKey(querier: SqlQuerier, tableName: string): Promise<string[] | undefined> {
    const sql = `
      SELECT COLUMN_NAME as column_name
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION
    `;

    const results = await querier.all<{ column_name: string }>(sql, [tableName]);

    if (results.length === 0) {
      return undefined;
    }

    return results.map((r) => r.column_name);
  }

  private parseDefaultValue(defaultValue: string | null): unknown {
    if (defaultValue === null) {
      return undefined;
    }

    // Check for common patterns
    if (defaultValue === 'NULL') {
      return null;
    }
    if (defaultValue === 'CURRENT_TIMESTAMP') {
      return defaultValue;
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

  private normalizeReferentialAction(action: string): 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' | undefined {
    switch (action.toUpperCase()) {
      case 'CASCADE':
        return 'CASCADE';
      case 'SET NULL':
        return 'SET NULL';
      case 'RESTRICT':
        return 'RESTRICT';
      case 'NO ACTION':
        return 'NO ACTION';
      default:
        return undefined;
    }
  }
}

/**
 * Alias for MysqlSchemaIntrospector.
 * MariaDB uses the same information_schema structure as MySQL.
 */
export const MariadbSchemaIntrospector = MysqlSchemaIntrospector;
