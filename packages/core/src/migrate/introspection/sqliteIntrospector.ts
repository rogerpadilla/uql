import type { ColumnSchema, ForeignKeySchema, IndexSchema, QuerierPool, SqlQuerier } from '../../type/index.js';
import { AbstractSqlSchemaIntrospector } from './abstractSqlSchemaIntrospector.js';

/**
 * SQLite schema introspector
 */
export class SqliteSchemaIntrospector extends AbstractSqlSchemaIntrospector {
  protected readonly pool: QuerierPool;

  constructor(pool: QuerierPool) {
    super('sqlite');
    this.pool = pool;
  }

  // ============================================================================
  // SQL Queries (dialect-specific)
  // ============================================================================

  protected getTableNamesQuery(): string {
    return /*sql*/ `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `;
  }

  protected tableExistsQuery(): string {
    return /*sql*/ `
      SELECT COUNT(*) as count
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
    `;
  }

  protected parseTableExistsResult(results: SqliteCountRow[]): boolean {
    return this.toNumber(results[0]?.count) > 0;
  }

  // SQLite uses PRAGMA which doesn't use parameterized queries in the same way
  protected getColumnsQuery(tableName: string): string {
    return `PRAGMA table_info(${this.escapeId(tableName)})`;
  }

  protected getIndexesQuery(tableName: string): string {
    return `PRAGMA index_list(${this.escapeId(tableName)})`;
  }

  protected getForeignKeysQuery(tableName: string): string {
    return `PRAGMA foreign_key_list(${this.escapeId(tableName)})`;
  }

  protected getPrimaryKeyQuery(tableName: string): string {
    return `PRAGMA table_info(${this.escapeId(tableName)})`;
  }

  protected override getColumnsParams(_tableName: string): unknown[] {
    return [];
  }

  protected override getIndexesParams(_tableName: string): unknown[] {
    return [];
  }

  protected override getForeignKeysParams(_tableName: string): unknown[] {
    return [];
  }

  protected override getPrimaryKeyParams(_tableName: string): unknown[] {
    return [];
  }

  // ============================================================================
  // Row Mapping (dialect-specific)
  // ============================================================================

  protected mapTableNameRow(row: { name: string }): string {
    return row.name;
  }

  protected async mapColumnsResult(
    querier: SqlQuerier,
    tableName: string,
    results: SqliteColumnRow[],
  ): Promise<ColumnSchema[]> {
    // Get unique columns from indexes
    const uniqueColumns = await this.getUniqueColumns(querier, tableName);

    return results.map(
      (row): ColumnSchema => ({
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
      }),
    );
  }

  protected async mapIndexesResult(
    querier: SqlQuerier,
    _tableName: string,
    results: SqliteIndexRow[],
  ): Promise<IndexSchema[]> {
    const indexSchemas: IndexSchema[] = [];

    for (const index of results) {
      const columns = await querier.all<{ name: string }>(`PRAGMA index_info(${this.escapeId(index.name)})`);

      // Include user-created indexes ('c') and multi-column unique constraints ('u')
      // Skip primary key indexes ('pk') and single-column unique constraints
      const isUserCreated = index.origin === 'c';
      const isCompositeUnique = index.origin === 'u' && columns.length > 1;

      if (isUserCreated || isCompositeUnique) {
        indexSchemas.push({
          name: index.name,
          columns: columns.map((c) => c.name),
          unique: Boolean(index.unique),
        });
      }
    }

    return indexSchemas;
  }

  protected async mapForeignKeysResult(
    _querier: SqlQuerier,
    tableName: string,
    results: SqliteForeignKeyRow[],
  ): Promise<ForeignKeySchema[]> {
    // Group by id to handle composite foreign keys
    const grouped = new Map<number, SqliteForeignKeyRow[]>();
    for (const row of results) {
      const id = row.id;
      const existing = grouped.get(id) ?? [];
      existing.push(row);
      grouped.set(id, existing);
    }

    return Array.from(grouped.entries()).map(([id, rows]) => {
      const first = rows[0];
      return {
        name: `fk_${tableName}_${id}`,
        columns: rows.map((r) => r.from),
        referencedTable: first.table,
        referencedColumns: rows.map((r) => r.to),
        onDelete: this.normalizeReferentialAction(first.on_delete),
        onUpdate: this.normalizeReferentialAction(first.on_update),
      };
    });
  }

  protected mapPrimaryKeyResult(results: SqliteColumnRow[]): string[] | undefined {
    const pkColumns = results.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk);

    if (pkColumns.length === 0) {
      return undefined;
    }

    return pkColumns.map((r) => r.name);
  }

  // ============================================================================
  // SQLite-specific helpers
  // ============================================================================

  private async getUniqueColumns(querier: SqlQuerier, tableName: string): Promise<Set<string>> {
    const results = await querier.all<SqliteIndexRow>(`PRAGMA index_list(${this.escapeId(tableName)})`);
    const uniqueColumns = new Set<string>();

    for (const index of results) {
      if (index.unique) {
        const indexInfo = await querier.all<{ name: string }>(`PRAGMA index_info(${this.escapeId(index.name)})`);
        // Only single-column unique constraints
        if (indexInfo.length === 1) {
          uniqueColumns.add(indexInfo[0].name);
        }
      }
    }

    return uniqueColumns;
  }

  protected normalizeType(type: string): string {
    // Extract base type without length/precision
    const match = type.match(/^([A-Za-z]+)/);
    return match ? match[1].toUpperCase() : type.toUpperCase();
  }

  protected extractLength(type: string): number | undefined {
    const match = type.match(/\((\d+)\)/);
    return match ? Number.parseInt(match[1], 10) : undefined;
  }

  protected parseDefaultValue(defaultValue: string | null): unknown {
    if (defaultValue === null) {
      return undefined;
    }

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
}

type SqliteCountRow = {
  count: number | bigint;
};

type SqliteColumnRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type SqliteIndexRow = {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

type SqliteForeignKeyRow = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
};
