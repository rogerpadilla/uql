import type { ColumnSchema, ForeignKeySchema, IndexSchema } from '../../type/index.js';
import { AbstractSqlSchemaIntrospector, type TableRowReader } from './abstractSqlSchemaIntrospector.js';

/**
 * SQLite schema introspector
 */
export class SqliteSchemaIntrospector extends AbstractSqlSchemaIntrospector {
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
    const row = results[0];
    if (row?.count !== undefined) {
      return (this.toNumber(row.count) ?? 0) > 0;
    }
    return false;
  }

  // SQLite uses PRAGMA which doesn't use parameterized queries in the same way
  protected getColumnsQuery(tableName: string): string {
    return /*sql*/ `PRAGMA table_info(${this.escapeId(tableName)})`;
  }

  protected getIndexesQuery(tableName: string): string {
    return /*sql*/ `PRAGMA index_list(${this.escapeId(tableName)})`;
  }

  protected getForeignKeysQuery(tableName: string): string {
    return /*sql*/ `PRAGMA foreign_key_list(${this.escapeId(tableName)})`;
  }

  protected getPrimaryKeyQuery(tableName: string): string {
    return /*sql*/ `PRAGMA table_info(${this.escapeId(tableName)})`;
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
    read: TableRowReader,
    tableName: string,
    results: SqliteColumnRow[],
  ): Promise<ColumnSchema[]> {
    // Get unique columns from indexes
    const uniqueColumns = await this.getUniqueColumns(read, tableName);

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
    read: TableRowReader,
    _tableName: string,
    results: SqliteIndexRow[],
  ): Promise<IndexSchema[]> {
    const indexSchemas: IndexSchema[] = [];

    for (const index of results) {
      const columns = await this.getIndexColumns(read, index.name);

      // Include user-created indexes ('c') and multi-column unique constraints ('u')
      // Skip primary key indexes ('pk') and single-column unique constraints
      const isUserCreated = index.origin === 'c';
      const isCompositeUnique = index.origin === 'u' && columns.length > 1;

      // `PRAGMA index_info` names an expression entry `null` (its `cid` is -2), and the expression text
      // lives only in `sqlite_master.sql`. Reporting `{ column: null }` put a column literally named
      // `null` into the diff, so an index UQL cannot describe is left out entirely instead.
      const named = columns.filter((column): column is { name: string } => column.name !== null);

      if (named.length === columns.length && (isUserCreated || isCompositeUnique)) {
        indexSchemas.push({
          name: index.name,
          columns: named.map((column) => ({ column: column.name })),
          unique: Boolean(index.unique),
        });
      }
    }

    return indexSchemas;
  }

  protected async mapForeignKeysResult(
    _read: TableRowReader,
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

  protected override mapPrimaryKeyResult(results: SqliteColumnRow[]): string[] | undefined {
    const pkColumns = results.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk);

    if (pkColumns.length === 0) {
      return undefined;
    }

    return pkColumns.map((r) => r.name);
  }

  // ============================================================================
  // SQLite-specific helpers
  // ============================================================================

  private async getUniqueColumns(read: TableRowReader, tableName: string): Promise<Set<string>> {
    const indexes = await read<SqliteIndexRow>(this.getIndexesQuery(tableName));
    const uniqueColumns = new Set<string>();

    for (const index of indexes) {
      if (index.unique) {
        const columns = await this.getIndexColumns(read, index.name);
        // Only single-column unique constraints, and only over a real column (not an expression)
        const [column] = columns;
        if (columns.length === 1 && column.name !== null) {
          uniqueColumns.add(column.name);
        }
      }
    }

    return uniqueColumns;
  }

  private getIndexColumns(read: TableRowReader, indexName: string): Promise<{ name: string | null }[]> {
    return read<{ name: string | null }>(/*sql*/ `PRAGMA index_info(${this.escapeId(indexName)})`);
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
    if (typeof defaultValue !== 'string') {
      return defaultValue;
    }

    if (/^-?\d+\.\d+$/.test(defaultValue)) {
      return Number.parseFloat(defaultValue);
    }

    const upper = defaultValue.toUpperCase();
    if (upper === 'TRUE') return 1;
    if (upper === 'FALSE') return 0;

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
