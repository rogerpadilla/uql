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

  protected parseTableExistsResult(results: Record<string, unknown>[]): boolean {
    const count = results[0]?.count;
    return (typeof count === 'number' || typeof count === 'bigint' ? Number(count) : 0) > 0;
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

  protected override getColumnsParams(_tableName: string): any[] {
    return [];
  }

  protected override getIndexesParams(_tableName: string): any[] {
    return [];
  }

  protected override getForeignKeysParams(_tableName: string): any[] {
    return [];
  }

  protected override getPrimaryKeyParams(_tableName: string): any[] {
    return [];
  }

  // ============================================================================
  // Row Mapping (dialect-specific)
  // ============================================================================

  protected mapTableNameRow(row: Record<string, unknown>): string {
    return row.name as string;
  }

  protected async mapColumnsResult(
    querier: SqlQuerier,
    tableName: string,
    results: Record<string, unknown>[],
  ): Promise<ColumnSchema[]> {
    // Get unique columns from indexes
    const uniqueColumns = await this.getUniqueColumns(querier, tableName);

    return results.map((row) => ({
      name: row.name as string,
      type: this.normalizeType(row.type as string),
      nullable: (row.notnull as number) === 0,
      defaultValue: this.parseDefaultValue(row.dflt_value as string | null),
      isPrimaryKey: (row.pk as number) > 0,
      isAutoIncrement: (row.pk as number) > 0 && (row.type as string).toUpperCase() === 'INTEGER',
      isUnique: uniqueColumns.has(row.name as string),
      length: this.extractLength(row.type as string),
      precision: undefined,
      scale: undefined,
      comment: undefined, // SQLite doesn't support column comments
    }));
  }

  protected async mapIndexesResult(
    querier: SqlQuerier,
    _tableName: string,
    results: Record<string, unknown>[],
  ): Promise<IndexSchema[]> {
    const indexSchemas: IndexSchema[] = [];

    for (const index of results) {
      const columns = await querier.all<{ name: string }>(`PRAGMA index_info(${this.escapeId(index.name as string)})`);

      // Include user-created indexes ('c') and multi-column unique constraints ('u')
      // Skip primary key indexes ('pk') and single-column unique constraints
      const isUserCreated = index.origin === 'c';
      const isCompositeUnique = index.origin === 'u' && columns.length > 1;

      if (isUserCreated || isCompositeUnique) {
        indexSchemas.push({
          name: index.name as string,
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
    results: Record<string, unknown>[],
  ): Promise<ForeignKeySchema[]> {
    // Group by id to handle composite foreign keys
    const grouped = new Map<number, Record<string, unknown>[]>();
    for (const row of results) {
      const id = row.id as number;
      const existing = grouped.get(id) ?? [];
      existing.push(row);
      grouped.set(id, existing);
    }

    return Array.from(grouped.entries()).map(([id, rows]) => {
      const first = rows[0];
      return {
        name: `fk_${tableName}_${id}`,
        columns: rows.map((r) => r.from as string),
        referencedTable: first.table as string,
        referencedColumns: rows.map((r) => r.to as string),
        onDelete: this.normalizeReferentialAction(first.on_delete as string),
        onUpdate: this.normalizeReferentialAction(first.on_update as string),
      };
    });
  }

  protected mapPrimaryKeyResult(results: Record<string, unknown>[]): string[] | undefined {
    const pkColumns = results.filter((r) => (r.pk as number) > 0).sort((a, b) => (a.pk as number) - (b.pk as number));

    if (pkColumns.length === 0) {
      return undefined;
    }

    return pkColumns.map((r) => r.name as string);
  }

  // ============================================================================
  // SQLite-specific helpers
  // ============================================================================

  private async getUniqueColumns(querier: SqlQuerier, tableName: string): Promise<Set<string>> {
    const indexes = await querier.all<{
      seq: number;
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>(`PRAGMA index_list(${this.escapeId(tableName)})`);

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
