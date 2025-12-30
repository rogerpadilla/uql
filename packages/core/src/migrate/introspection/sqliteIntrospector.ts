import type {
  ColumnSchema,
  ForeignKeySchema,
  IndexSchema,
  QuerierPool,
  SchemaIntrospector,
  SqlQuerier,
  TableSchema,
} from '../../type/index.js';
import { isSqlQuerier } from '../../type/index.js';

/**
 * SQLite schema introspector
 */
export class SqliteSchemaIntrospector implements SchemaIntrospector {
  constructor(private readonly pool: QuerierPool) {}

  async getTableSchema(tableName: string): Promise<TableSchema | undefined> {
    const querier = await this.getQuerier();

    try {
      const exists = await this.tableExistsInternal(querier, tableName);
      if (!exists) {
        return undefined;
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
      const sql = /*sql*/ `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `;

      const results = await querier.all<{ name: string }>(sql);
      return results.map((r: any) => r.name);
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
    const sql = /*sql*/ `
      SELECT COUNT(*) as count
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
    `;

    const results = await querier.all<{ count: number }>(sql, [tableName]);
    return (results[0]?.count ?? 0) > 0;
  }

  private async getQuerier(): Promise<SqlQuerier> {
    const querier = await this.pool.getQuerier();

    if (!isSqlQuerier(querier)) {
      await querier.release();
      throw new Error('SqliteSchemaIntrospector requires a SQL-based querier');
    }

    return querier;
  }

  private async getColumns(querier: SqlQuerier, tableName: string): Promise<ColumnSchema[]> {
    // SQLite uses PRAGMA for table info
    const sql = `PRAGMA table_info(${this.escapeId(tableName)})`;

    const results = await querier.all<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>(sql);

    // Get unique columns from indexes
    const uniqueColumns = await this.getUniqueColumns(querier, tableName);

    return results.map((row: any) => ({
      name: row.name,
      type: this.normalizeType(row.type),
      nullable: row.notnull === 0,
      defaultValue: this.parseDefaultValue(row.dflt_value),
      isPrimaryKey: row.pk > 0,
      isAutoIncrement: row.pk > 0 && row.type.toUpperCase() === 'INTEGER',
      isUnique: uniqueColumns.has(row.name),
      length: this.extractLength(row.type),
      precision: undefined,
      scale: undefined,
      comment: undefined, // SQLite doesn't support column comments
    }));
  }

  private async getUniqueColumns(querier: SqlQuerier, tableName: string): Promise<Set<string>> {
    const sql = `PRAGMA index_list(${this.escapeId(tableName)})`;

    const indexes = await querier.all<{
      seq: number;
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>(sql);

    const uniqueColumns = new Set<string>();

    for (const index of indexes) {
      if (index.unique && index.origin === 'u') {
        const indexInfo = await querier.all<{ name: string }>(`PRAGMA index_info(${this.escapeId(index.name)})`);
        // Only single-column unique constraints
        if (indexInfo.length === 1) {
          uniqueColumns.add(indexInfo[0].name);
        }
      }
    }

    return uniqueColumns;
  }

  private async getIndexes(querier: SqlQuerier, tableName: string): Promise<IndexSchema[]> {
    const sql = `PRAGMA index_list(${this.escapeId(tableName)})`;

    const indexes = await querier.all<{
      seq: number;
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>(sql);

    const result: IndexSchema[] = [];

    for (const index of indexes) {
      // Skip auto-generated indexes (primary key, unique constraints)
      if (index.origin !== 'c') {
        continue;
      }

      const columns = await querier.all<{ name: string }>(`PRAGMA index_info(${this.escapeId(index.name)})`);

      result.push({
        name: index.name,
        columns: columns.map((c: any) => c.name),
        unique: Boolean(index.unique),
      });
    }

    return result;
  }

  private async getForeignKeys(querier: SqlQuerier, tableName: string): Promise<ForeignKeySchema[]> {
    const sql = `PRAGMA foreign_key_list(${this.escapeId(tableName)})`;

    const results = await querier.all<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
      match: string;
    }>(sql);

    // Group by id to handle composite foreign keys
    const grouped = new Map<number, typeof results>();
    for (const row of results) {
      const existing = grouped.get(row.id) ?? [];
      existing.push(row);
      grouped.set(row.id, existing);
    }

    return Array.from(grouped.entries()).map(([id, rows]) => {
      const first = rows[0];
      return {
        name: `fk_${tableName}_${id}`,
        columns: rows.map((r: any) => r.from),
        referencedTable: first.table,
        referencedColumns: rows.map((r: any) => r.to),
        onDelete: this.normalizeReferentialAction(first.on_delete),
        onUpdate: this.normalizeReferentialAction(first.on_update),
      };
    });
  }

  private async getPrimaryKey(querier: SqlQuerier, tableName: string): Promise<string[] | undefined> {
    const sql = `PRAGMA table_info(${this.escapeId(tableName)})`;

    const results = await querier.all<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>(sql);

    const pkColumns = results.filter((r: any) => r.pk > 0).sort((a: any, b: any) => a.pk - b.pk);

    if (pkColumns.length === 0) {
      return undefined;
    }

    return pkColumns.map((r: any) => r.name);
  }

  private escapeId(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  private normalizeType(type: string): string {
    // Extract base type without length/precision
    const match = type.match(/^([A-Za-z]+)/);
    return match ? match[1].toUpperCase() : type.toUpperCase();
  }

  private extractLength(type: string): number | undefined {
    const match = type.match(/\((\d+)\)/);
    return match ? Number.parseInt(match[1], 10) : undefined;
  }

  private parseDefaultValue(defaultValue: string | null): unknown {
    if (defaultValue === null) {
      return undefined;
    }

    // Check for common patterns
    if (defaultValue === 'NULL') {
      return null;
    }
    if (defaultValue === 'CURRENT_TIMESTAMP' || defaultValue === 'CURRENT_DATE' || defaultValue === 'CURRENT_TIME') {
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
