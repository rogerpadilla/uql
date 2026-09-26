import type { AbstractSqlDialect } from '../../dialect/index.js';
import { FOREIGN_KEY_ACTIONS, type ForeignKeyAction } from '../../schema/types.js';
import type {
  ColumnSchema,
  InstalledTriggers,
  ForeignKeySchema,
  IndexSchema,
  PrimaryKeySchema,
  QuerierPool,
  RawRow,
  SchemaIntrospector,
  SqlQuerier,
  StoredDefinition,
  TableSchema,
} from '../../type/index.js';
import { isSqlQuerier } from '../../type/index.js';
import { isOwnedName } from '../../util/sql.util.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { BaseSqlIntrospector } from './baseSqlIntrospector.js';

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

/** A foreign key as MySQL and SQL Server list one: a row, its column lists comma-joined. */
export type JoinedForeignKeyRow = {
  readonly constraint_name: string;
  readonly columns: string;
  readonly referenced_table: string;
  readonly referenced_columns: string;
  readonly delete_rule: string;
  readonly update_rule: string;
};

/** A SQL introspector: an engine states its catalogue queries (`get*Query`) and how their rows map (`map*Result`). */
export abstract class AbstractSqlSchemaIntrospector extends BaseSqlIntrospector implements SchemaIntrospector {
  constructor(
    protected readonly pool: QuerierPool,
    schema?: string,
  ) {
    super(pool.dialect as AbstractSqlDialect, schema);
  }

  /**
   * The schema every catalogue query filters on, as SQL: the one that was asked for, as the engine's
   * own literal, or its expression for the connection's default. A literal rather than a bind
   * parameter because these queries are assembled as text and several use it more than once.
   */
  protected get schemaExpr(): string {
    return this.schema === undefined ? this.defaultSchemaExpr : this.dialect.escape(this.schema);
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

      const [columns, indexes, foreignKeys, primaryKey, definition] = await Promise.all([
        this.getColumns(read, tableName),
        this.getIndexes(read, tableName),
        this.getForeignKeys(read, tableName),
        this.getPrimaryKey(read, tableName),
        this.getDefinition(read, tableName),
      ]);

      return {
        name: tableName,
        columns,
        primaryKey,
        indexes,
        foreignKeys,
        definition,
      };
    });
  }

  /** See {@link TableSchema.definition}: none, but where the engine keeps the statements themselves. */
  protected async getDefinition(_read: TableRowReader, _tableName: string): Promise<StoredDefinition[] | undefined> {
    return undefined;
  }

  async getTableNames(): Promise<string[]> {
    return this.withSqlQuerier(async (querier) => {
      const results = await querier.all<RawRow>(this.getTableNamesQuery());
      return results.map((row) => this.mapTableNameRow(row));
    });
  }

  /**
   * Every trigger uql installed in this schema, by table and then by name, with the statements recreating
   * it: the whole schema in one read, since a table whose entity stopped declaring one still has one to
   * drop. Ownership is matched here rather than with `LIKE`, whose `_` wildcard would take in a hand-written one.
   */
  async ownedTriggers(table: string): Promise<InstalledTriggers> {
    const rows = await this.withSqlQuerier((querier) => querier.all<RawRow>(this.triggersQuery(), [table]));
    return new Map(
      rows.flatMap((row) => {
        const name = String(row['name']);
        const statements = [row['requires'], row['definition']].filter(Boolean).map((sql) => String(sql));
        return isOwnedName(name) ? [[name, statements] as const] : [];
      }),
    );
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
        throw new UqlUsageError(`${this.constructor.name} requires a SQL-based querier`);
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

  protected async getPrimaryKey(read: TableRowReader, tableName: string): Promise<PrimaryKeySchema | undefined> {
    const results = await read<RawRow>(this.getPrimaryKeyQuery(tableName), this.getPrimaryKeyParams(tableName));
    const columns = this.mapPrimaryKeyResult(results);
    return columns && { columns, name: this.mapPrimaryKeyName(results) };
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

  /** The {@link ForeignKeyAction} a catalogue names, whatever its case, and `SET_NULL` as SQL Server spells it. */
  protected normalizeReferentialAction(action: string): ForeignKeyAction | undefined {
    const spelled = action.toUpperCase().replaceAll('_', ' ');
    return FOREIGN_KEY_ACTIONS.find((known) => known === spelled);
  }

  /** Foreign keys read one row each, as {@link JoinedForeignKeyRow} lists them. */
  protected joinedForeignKeys(rows: readonly JoinedForeignKeyRow[]): ForeignKeySchema[] {
    return rows.map((row) => ({
      name: row.constraint_name,
      columns: row.columns.split(','),
      references: { table: row.referenced_table, columns: row.referenced_columns.split(',') },
      onDelete: this.normalizeReferentialAction(row.delete_rule),
      onUpdate: this.normalizeReferentialAction(row.update_rule),
    }));
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
   * SQL listing every trigger in the schema as a `table`, a `name`, the engine's reprint of it as a
   * `definition`, and where the body lives apart, the `requires` recreated first: what is installed, not
   * what uql wrote, which is exactly what a rollback puts back.
   */
  /** The triggers on the table its one parameter names: each one's `name`, `definition`, and what it `requires`. */
  protected abstract triggersQuery(): string;

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
   * and only the reported name will do - see {@link PrimaryKeySchema.name}.
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
