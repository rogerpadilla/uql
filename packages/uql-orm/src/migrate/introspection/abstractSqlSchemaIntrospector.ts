import type { AbstractSqlDialect } from '../../dialect/index.js';
import type {
  ColumnSchema,
  ForeignKeySchema,
  IndexSchema,
  QuerierPool,
  RawRow,
  SchemaIntrospector,
  SqlQuerier,
  TableSchema,
} from '../../type/index.js';
import { isSqlQuerier } from '../../type/index.js';
import { escapeAnsiSqlLiteral } from '../../util/sqlLiteral.js';
import { BaseSqlIntrospector } from './baseSqlIntrospector.js';

/**
 * Referential action type for foreign key constraints.
 */
export type ReferentialAction = 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';

/**
 * Reads the rows of one statement while introspecting a table.
 *
 * Identical statements share a single round trip, which is what the mappers get instead of a querier:
 * describing one table needs four facts, and on SQLite three of them come out of the same two PRAGMAs
 * (`table_info` is both the column list and the primary key; the column mapper walks `index_list` and
 * `index_info` for single-column uniqueness while the index mapper is walking them too). That was four
 * redundant statements out of ten per table - on D1 and Turso, where every PRAGMA is an HTTP round trip,
 * it is four avoidable ones.
 */
export type TableRowReader = <T extends RawRow>(sql: string, params?: unknown[]) => Promise<T[]>;

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
  constructor(
    protected readonly pool: QuerierPool,
    schema?: string,
  ) {
    super(pool.dialect as AbstractSqlDialect, schema);
  }

  /**
   * The schema every catalogue query filters on, as SQL: the one that was asked for, or the engine's
   * expression for the connection's default. A literal rather than a bind parameter because these
   * queries are assembled as text and several use it more than once.
   */
  protected get schemaExpr(): string {
    return this.schema === undefined ? this.defaultSchemaExpr : escapeAnsiSqlLiteral(this.schema);
  }

  /**
   * How this engine names the connection's current schema (Postgres) or database (MySQL). Empty on
   * an engine with no schemas, whose catalogue queries never reference one.
   */
  protected readonly defaultSchemaExpr: string = '';

  async getTableSchema(tableName: string): Promise<TableSchema | undefined> {
    return this.withSqlQuerier(async (querier) => {
      const read = createTableRowReader(querier);
      const exists = await this.tableExistsInternal(read, tableName);
      if (!exists) {
        return undefined;
      }

      const [columns, indexes, foreignKeys, primaryKey] = await Promise.all([
        this.getColumns(read, tableName),
        this.getIndexes(read, tableName),
        this.getForeignKeys(read, tableName),
        this.getPrimaryKey(read, tableName),
      ]);

      return {
        name: tableName,
        columns,
        primaryKey: primaryKey.columns,
        primaryKeyName: primaryKey.name,
        indexes,
        foreignKeys,
      };
    });
  }

  async getTableNames(): Promise<string[]> {
    return this.withSqlQuerier(async (querier) => {
      const results = await querier.all<RawRow>(this.getTableNamesQuery());
      return results.map((row) => this.mapTableNameRow(row));
    });
  }

  async tableExists(tableName: string): Promise<boolean> {
    return this.withSqlQuerier((querier) => this.tableExistsInternal(createTableRowReader(querier), tableName));
  }

  /**
   * Introspection reads, so `withQuerier` rather than `transaction`: the pool owns the release either
   * way, and wrapping catalogue queries in a transaction would hold one open for nothing.
   */
  protected withSqlQuerier<T>(task: (querier: SqlQuerier) => Promise<T>): Promise<T> {
    return this.pool.withQuerier((querier) => {
      if (!isSqlQuerier(querier)) {
        throw new TypeError(`${this.constructor.name} requires a SQL-based querier`);
      }
      return task(querier);
    });
  }

  protected async tableExistsInternal(read: TableRowReader, tableName: string): Promise<boolean> {
    const results = await read<RawRow>(this.tableExistsQuery(), this.tableExistsParams(tableName));
    return this.parseTableExistsResult(results);
  }

  protected async getColumns(read: TableRowReader, tableName: string): Promise<ColumnSchema[]> {
    const results = await read<RawRow>(this.getColumnsQuery(tableName), this.getColumnsParams(tableName));
    return this.mapColumnsResult(read, tableName, results);
  }

  protected async getIndexes(read: TableRowReader, tableName: string): Promise<IndexSchema[]> {
    const results = await read<RawRow>(this.getIndexesQuery(tableName), this.getIndexesParams(tableName));
    return this.mapIndexesResult(read, tableName, results);
  }

  protected async getForeignKeys(read: TableRowReader, tableName: string): Promise<ForeignKeySchema[]> {
    const results = await read<RawRow>(this.getForeignKeysQuery(tableName), this.getForeignKeysParams(tableName));
    return this.mapForeignKeysResult(read, tableName, results);
  }

  protected async getPrimaryKey(
    read: TableRowReader,
    tableName: string,
  ): Promise<{ columns?: string[]; name?: string }> {
    const results = await read<RawRow>(this.getPrimaryKeyQuery(tableName), this.getPrimaryKeyParams(tableName));
    return { columns: this.mapPrimaryKeyResult(results), name: this.mapPrimaryKeyName(results) };
  }

  protected tableExistsParams(tableName: string): unknown[] {
    return [tableName];
  }

  protected getColumnsParams(tableName: string): unknown[] {
    return [tableName];
  }

  protected getIndexesParams(tableName: string): unknown[] {
    return [tableName];
  }

  protected getForeignKeysParams(tableName: string): unknown[] {
    return [tableName];
  }

  protected getPrimaryKeyParams(tableName: string): unknown[] {
    return [tableName];
  }

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
  protected toNumber(value: unknown): number | undefined {
    if (value == null || value === '') {
      return undefined;
    }
    return Number(value);
  }

  /** SQL query to list all table names. */
  protected abstract getTableNamesQuery(): string;

  /** SQL query to check if a table exists. Parameter: tableName. */
  protected abstract tableExistsQuery(): string;

  /** Parse the result of tableExistsQuery to boolean. */
  protected abstract parseTableExistsResult(results: RawRow[]): boolean;

  /** SQL query to get column metadata. Parameter: tableName (for PRAGMA-style). */
  protected abstract getColumnsQuery(tableName: string): string;

  /** SQL query to get index metadata. Parameter: tableName (for PRAGMA-style). */
  protected abstract getIndexesQuery(tableName: string): string;

  /** SQL query to get foreign key metadata. Parameter: tableName (for PRAGMA-style). */
  protected abstract getForeignKeysQuery(tableName: string): string;

  /** SQL query to get primary key columns. Parameter: tableName (for PRAGMA-style). */
  protected abstract getPrimaryKeyQuery(tableName: string): string;

  /**
   * Extract table name from a row returned by getTableNamesQuery.
   *
   * Defaults to `information_schema`'s own column, which is what every engine with an
   * `information_schema` returns and what Postgres and MySQL both restated identically. SQLite reads
   * `sqlite_master` instead and overrides.
   */
  protected mapTableNameRow(row: RawRow): string {
    return row['table_name'] as string;
  }

  /** Map column query results to ColumnSchema array. Allows async for SQLite's unique column check. */
  protected abstract mapColumnsResult(
    read: TableRowReader,
    tableName: string,
    results: RawRow[],
  ): Promise<ColumnSchema[]>;

  /** Map index query results to IndexSchema array. Allows async for SQLite's index_info calls. */
  protected abstract mapIndexesResult(
    read: TableRowReader,
    tableName: string,
    results: RawRow[],
  ): Promise<IndexSchema[]>;

  /** Map foreign key query results to ForeignKeySchema array. */
  protected abstract mapForeignKeysResult(
    read: TableRowReader,
    tableName: string,
    results: RawRow[],
  ): Promise<ForeignKeySchema[]>;

  /**
   * Map primary key query results to column names, in key order. `information_schema` gives every SQL
   * engine here a `column_name` per row; SQLite reads its key off `PRAGMA table_info` instead and
   * overrides this.
   */
  protected mapPrimaryKeyResult(results: RawRow[]): string[] | undefined {
    const columns = results.map((row) => String(row['column_name']));
    return columns.length ? columns : undefined;
  }

  /**
   * What the engine calls the key's constraint, where the query reported one. Only a `DROP` needs it,
   * and only the reported name will do - see {@link TableSchema.primaryKeyName}.
   */
  protected mapPrimaryKeyName(results: RawRow[]): string | undefined {
    const name = results[0]?.['constraint_name'];
    return name === undefined || name === null ? undefined : String(name);
  }

  /** Parse default value string to appropriate type. */
  protected abstract parseDefaultValue(defaultValue: string | null): unknown;
}

/** A {@link TableRowReader} over one querier: the same statement is only ever sent once. */
function createTableRowReader(querier: SqlQuerier): TableRowReader {
  const sent = new Map<string, Promise<RawRow[]>>();

  return <T extends RawRow>(sql: string, params?: unknown[]): Promise<T[]> => {
    const key = params?.length ? `${sql}\u0000${JSON.stringify(params)}` : sql;
    let rows = sent.get(key);
    if (!rows) {
      // PRAGMA statements take no parameters at all, so they are sent as a bare statement.
      rows = params?.length ? querier.all<RawRow>(sql, params) : querier.all<RawRow>(sql);
      sent.set(key, rows);
    }
    return rows as Promise<T[]>;
  };
}
