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
import { BaseSqlIntrospector } from './baseSqlIntrospector.js';

/**
 * Referential action type for foreign key constraints.
 */
export type ReferentialAction = 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';

/**
 * Abstract base class for SQL schema introspectors.
 *
 * Uses the template-method pattern to consolidate shared logic while allowing
 * dialect-specific implementations for SQL queries and type normalization.
 *
 * Subclasses must implement:
 * - `getTableNamesQuery()` - SQL to list all table names
 * - `tableExistsQuery()` - SQL to check if a table exists
 * - `getColumnsQuery()` - SQL to get column metadata
 * - `getIndexesQuery()` - SQL to get index metadata
 * - `getForeignKeysQuery()` - SQL to get foreign key metadata
 * - `getPrimaryKeyQuery()` - SQL to get primary key columns
 * - `mapColumnRow()` - Map a column query result row to ColumnSchema
 * - `mapIndexRow()` - Map an index query result row to IndexSchema
 * - `mapForeignKeyRow()` - Map a foreign key query result row to ForeignKeySchema
 * - `mapTableNameRow()` - Extract table name from a row
 * - `mapPrimaryKeyRow()` - Extract column name from a PK row
 */
export abstract class AbstractSqlSchemaIntrospector extends BaseSqlIntrospector implements SchemaIntrospector {
  protected abstract readonly pool: QuerierPool;

  // ============================================================================
  // Template Methods (shared control flow)
  // ============================================================================

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
      const results = await querier.all<Record<string, unknown>>(this.getTableNamesQuery());
      return results.map((row) => this.mapTableNameRow(row));
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

  protected async getQuerier(): Promise<SqlQuerier> {
    const querier = await this.pool.getQuerier();

    if (!isSqlQuerier(querier)) {
      await querier.release();
      throw new Error(`${this.constructor.name} requires a SQL-based querier`);
    }

    return querier;
  }

  protected async tableExistsInternal(querier: SqlQuerier, tableName: string): Promise<boolean> {
    const sql = this.tableExistsQuery();
    const params = this.tableExistsParams(tableName);
    const results = await querier.all<Record<string, unknown>>(sql, params);
    return this.parseTableExistsResult(results);
  }

  protected async getColumns(querier: SqlQuerier, tableName: string): Promise<ColumnSchema[]> {
    const sql = this.getColumnsQuery(tableName);
    const params = this.getColumnsParams(tableName);
    const results = await querier.all<Record<string, unknown>>(sql, params);
    return this.mapColumnsResult(querier, tableName, results);
  }

  protected async getIndexes(querier: SqlQuerier, tableName: string): Promise<IndexSchema[]> {
    const sql = this.getIndexesQuery(tableName);
    const params = this.getIndexesParams(tableName);
    const results = await querier.all<Record<string, unknown>>(sql, params);
    return this.mapIndexesResult(querier, tableName, results);
  }

  protected async getForeignKeys(querier: SqlQuerier, tableName: string): Promise<ForeignKeySchema[]> {
    const sql = this.getForeignKeysQuery(tableName);
    const params = this.getForeignKeysParams(tableName);
    const results = await querier.all<Record<string, unknown>>(sql, params);
    return this.mapForeignKeysResult(querier, tableName, results);
  }

  protected async getPrimaryKey(querier: SqlQuerier, tableName: string): Promise<string[] | undefined> {
    const sql = this.getPrimaryKeyQuery(tableName);
    const params = this.getPrimaryKeyParams(tableName);
    const results = await querier.all<Record<string, unknown>>(sql, params);
    return this.mapPrimaryKeyResult(results);
  }

  // ============================================================================
  // Parameter Methods (can be overridden by dialects)
  // ============================================================================

  protected tableExistsParams(tableName: string): any[] {
    return [tableName];
  }

  protected getColumnsParams(tableName: string): any[] {
    return [tableName];
  }

  protected getIndexesParams(tableName: string): any[] {
    return [tableName];
  }

  protected getForeignKeysParams(tableName: string): any[] {
    return [tableName];
  }

  protected getPrimaryKeyParams(tableName: string): any[] {
    return [tableName];
  }

  // ============================================================================
  // Shared Utilities
  // ============================================================================

  /**
   * Normalize referential action string to standard type.
   */
  protected normalizeReferentialAction(action: string): ReferentialAction | undefined {
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

  /**
   * Convert bigint/null values to number safely.
   */
  protected toNumber(value: number | bigint | null | undefined): number | undefined {
    if (value == null) {
      return undefined;
    }
    return Number(value);
  }

  // ============================================================================
  // Abstract Methods (dialect-specific)
  // ============================================================================

  /** SQL query to list all table names. */
  protected abstract getTableNamesQuery(): string;

  /** SQL query to check if a table exists. Parameter: tableName. */
  protected abstract tableExistsQuery(): string;

  /** Parse the result of tableExistsQuery to boolean. */
  protected abstract parseTableExistsResult(results: Record<string, unknown>[]): boolean;

  /** SQL query to get column metadata. Parameter: tableName (for PRAGMA-style). */
  protected abstract getColumnsQuery(tableName: string): string;

  /** SQL query to get index metadata. Parameter: tableName (for PRAGMA-style). */
  protected abstract getIndexesQuery(tableName: string): string;

  /** SQL query to get foreign key metadata. Parameter: tableName (for PRAGMA-style). */
  protected abstract getForeignKeysQuery(tableName: string): string;

  /** SQL query to get primary key columns. Parameter: tableName (for PRAGMA-style). */
  protected abstract getPrimaryKeyQuery(tableName: string): string;

  /** Extract table name from a row returned by getTableNamesQuery. */
  protected abstract mapTableNameRow(row: Record<string, unknown>): string;

  /** Map column query results to ColumnSchema array. Allows async for SQLite's unique column check. */
  protected abstract mapColumnsResult(
    querier: SqlQuerier,
    tableName: string,
    results: Record<string, unknown>[],
  ): Promise<ColumnSchema[]>;

  /** Map index query results to IndexSchema array. Allows async for SQLite's index_info calls. */
  protected abstract mapIndexesResult(
    querier: SqlQuerier,
    tableName: string,
    results: Record<string, unknown>[],
  ): Promise<IndexSchema[]>;

  /** Map foreign key query results to ForeignKeySchema array. */
  protected abstract mapForeignKeysResult(
    querier: SqlQuerier,
    tableName: string,
    results: Record<string, unknown>[],
  ): Promise<ForeignKeySchema[]>;

  /** Map primary key query results to column names array. */
  protected abstract mapPrimaryKeyResult(results: Record<string, unknown>[]): string[] | undefined;

  /** Parse default value string to appropriate type. */
  protected abstract parseDefaultValue(defaultValue: string | null): unknown;
}
