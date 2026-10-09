import type { AbstractSqlDialect } from '../../dialect/index.js';
import type { IndexFacet } from '../../schema/indexDifferences.js';
import type { SchemaAST } from '../../schema/schemaAST.js';
import { SqlExpression } from '../../schema/sqlExpression.js';
import type { CheckSchema, TriggerSchema } from '../../schema/types.js';
import { FOREIGN_KEY_ACTIONS, type ForeignKeyAction } from '../../schema/types.js';
import type {
  ColumnRenames,
  ColumnSchema,
  Except,
  ForeignKeySchema,
  IndexSchema,
  PrimaryKeySchema,
  QuerierPool,
  QueryRaw,
  RawRow,
  SchemaIntrospector,
  SqlQuerier,
  StoredDefinition,
  TableSchema,
} from '../../type/index.js';
import { raw } from '../../util/raw.js';
import { isOwnedName } from '../../util/sql.util.js';
import { withSqlQuerierForMigrations } from '../acquireQuerierForMigrations.js';
import { knownDefault } from '../ddl/defaultSql.js';
import { renamedTable, tableSchemasToAST } from './tableSchemaAST.js';

/**
 * Reads the rows of one statement while introspecting a table, an identical statement sent once: SQLite's
 * `table_info` is both the column list and the key, and on D1 and Turso every PRAGMA is a round trip.
 */
export type TableRowReader = <T extends RawRow>(sql: QueryRaw) => Promise<T[]>;

/** A column as its engine's catalogue reads it; the key and the indexes say which it belongs to. */
export type ReadColumn = Except<ColumnSchema, 'isPrimaryKey' | 'isUnique'>;

/** A foreign key as MySQL and SQL Server list one: a row, its column lists comma-joined. */
export type JoinedForeignKeyRow = {
  readonly constraint_name: string;
  readonly columns: string;
  readonly referenced_table: string;
  readonly referenced_columns: string;
  readonly delete_rule: string;
  readonly update_rule: string;
};

/** A SQL introspector: an engine reads each part of a table from its catalogue (`get*`), on a {@link TableRowReader}. */
export abstract class AbstractSqlSchemaIntrospector implements SchemaIntrospector {
  /** Columns and uniqueness only; each introspector opts in to what its catalogue queries report. */
  protected readonly indexFacets: ReadonlySet<IndexFacet> = new Set();

  protected readonly dialect: AbstractSqlDialect;

  /**
   * `schema` is the one these queries read, `undefined` for the connection's own default. Every table
   * reported is stamped with it, so a diff compares like with like: entity and database both say
   * `undefined` for "wherever the connection points", and name a schema only when one was asked for.
   */
  constructor(
    protected readonly pool: QuerierPool,
    readonly schema?: string,
  ) {
    this.dialect = pool.dialect as AbstractSqlDialect;
  }

  /** The schema every catalogue query filters on: the one that was asked for, bound, or the connection's default. */
  protected get schemaExpr(): QueryRaw {
    return this.schema === undefined ? this.defaultSchemaExpr : raw`${this.schema}`;
  }

  /**
   * How this engine names the connection's current schema (Postgres) or database (MySQL). Empty on
   * an engine with no schemas, whose catalogue queries never reference one.
   */
  protected readonly defaultSchemaExpr: QueryRaw = raw``;

  /**
   * The database as a {@link SchemaAST}, or just the tables named. A name nothing matches is left out
   * rather than raised: the point of naming them is to read a database other things are still
   * changing, where scanning every table is both wasted work and a relation that can vanish mid-scan.
   */
  async introspect(tables?: readonly string[], renames?: ColumnRenames): Promise<SchemaAST> {
    const schemas: TableSchema[] = [];
    for (const tableName of tables ?? (await this.getTableNames())) {
      const schema = await this.getTableSchema(tableName);
      if (schema) {
        schemas.push(renames ? renamedTable(schema, renames, this.schema) : schema);
      }
    }
    return tableSchemasToAST(schemas, {
      dialectName: this.dialect.dialectName,
      schema: this.schema,
      indexFacets: this.indexFacets,
    });
  }

  async getTableSchema(tableName: string): Promise<TableSchema | undefined> {
    return this.withSqlQuerier(async (querier) => {
      const read = createTableRowReader(querier);
      const exists = await this.tableExistsInternal(read, tableName);
      if (!exists) {
        return undefined;
      }

      const [columns, indexes, foreignKeys, primaryKey, checks, triggers, definition] = await Promise.all([
        this.getColumns(read, tableName),
        this.getIndexes(read, tableName),
        this.getForeignKeys(read, tableName),
        this.getPrimaryKey(read, tableName),
        this.getChecks(read, tableName),
        this.getTriggers(read, tableName),
        this.getDefinition(read, tableName),
      ]);

      const unique = uniqueColumns(indexes);
      return {
        name: tableName,
        columns: columns.map((column) => ({
          ...column,
          isPrimaryKey: primaryKey?.columns.includes(column.name) ?? false,
          isUnique: unique.has(column.name),
        })),
        primaryKey,
        indexes,
        foreignKeys,
        checks,
        triggers,
        definition,
      };
    });
  }

  async getTableNames(): Promise<string[]> {
    return this.withSqlQuerier(async (querier) => {
      const rows = await querier.all<{ table_name: string }>(this.getTableNamesQuery());
      return rows.map((row) => row.table_name);
    });
  }

  async tableExists(tableName: string): Promise<boolean> {
    return this.withSqlQuerier((querier) => this.tableExistsInternal(createTableRowReader(querier), tableName));
  }

  /** On the querier migrations run on, which is not the app's on a libSQL embedded replica. */
  protected withSqlQuerier<T>(task: (querier: SqlQuerier) => Promise<T>): Promise<T> {
    return withSqlQuerierForMigrations(this.pool, this.constructor.name, task);
  }

  /** Whether the base table exists: its query answers a row for it, none for a view or nothing. */
  protected async tableExistsInternal(read: TableRowReader, tableName: string): Promise<boolean> {
    return (await read(this.tableExistsQuery(tableName))).length > 0;
  }

  /** SQL listing the base tables' names, as `table_name`. */
  protected abstract getTableNamesQuery(): QueryRaw;

  /** SQL answering a row where the base table named exists. */
  protected abstract tableExistsQuery(tableName: string): QueryRaw;

  /** The table's columns, in their order. */
  protected abstract getColumns(read: TableRowReader, tableName: string): Promise<ReadColumn[]>;

  /** The table's indexes, but its key's own. */
  protected abstract getIndexes(read: TableRowReader, tableName: string): Promise<IndexSchema[]>;

  protected abstract getForeignKeys(read: TableRowReader, tableName: string): Promise<ForeignKeySchema[]>;

  /** The table's key, its columns in key order, or `undefined` for a table without one. */
  protected abstract getPrimaryKey(read: TableRowReader, tableName: string): Promise<PrimaryKeySchema | undefined>;

  /** Every check on the table, each `expression` as the engine reprints it, which is what a rollback restores. */
  protected abstract getChecks(read: TableRowReader, tableName: string): Promise<CheckSchema[]>;

  /**
   * The triggers uql installed on the table, each with the statements recreating it as the engine keeps it.
   * Ownership is matched here rather than with `LIKE`, whose `_` wildcard would take in a hand-written one.
   */
  protected async getTriggers(read: TableRowReader, tableName: string): Promise<TriggerSchema[]> {
    const rows = await read<{ name: string; definition: string | null; requires?: string | null }>(
      this.triggersQuery(tableName),
    );
    return rows.flatMap(({ name, requires, definition }) =>
      isOwnedName(name) ? [{ name, statements: [requires, definition].filter((sql) => typeof sql === 'string') }] : [],
    );
  }

  /**
   * SQL listing the triggers on the table named: each one's `name`, its `definition`
   * as the engine reprints it, and what it `requires` to be recreated first. It reads what is installed, not
   * what uql wrote, which is exactly what a rollback restores.
   */
  protected abstract triggersQuery(tableName: string): QueryRaw;

  /** See {@link TableSchema.definition}: none, but where the engine keeps the statements themselves. */
  protected async getDefinition(_read: TableRowReader, _tableName: string): Promise<StoredDefinition[] | undefined> {
    return undefined;
  }

  /**
   * The key `sql` lists a row of for each column, in key order: its `column_name`, and the `constraint_name`
   * where the engine names the key's constraint. Only a `DROP` needs that name, and only the reported one will do.
   */
  protected async readPrimaryKey(read: TableRowReader, sql: QueryRaw): Promise<PrimaryKeySchema | undefined> {
    const rows = await read<{ column_name: string; constraint_name?: string | null }>(sql);
    return rows.length
      ? { columns: rows.map((row) => row.column_name), name: rows[0].constraint_name ?? undefined }
      : undefined;
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

  /** A catalogue's number, which a driver may answer as a `bigint`, or `undefined` for none. */
  protected toNumber(value: unknown): number | undefined {
    if (value == null || value === '') {
      return undefined;
    }
    return Number(value);
  }

  /** Parses a default as the catalogue reports it: to its literal value, or through {@link sqlDefault} if SQL. */
  protected abstract parseDefaultValue(defaultValue: string | null): unknown;

  /**
   * A SQL default, wrapped in parentheses, or the value uql exports that it spells (`currentTimestamp`), so it
   * compares equal on every engine and `generate:from-db` writes it by name.
   */
  protected sqlDefault(sql: string): SqlExpression {
    return knownDefault(SqlExpression.parenthesized(sql), this.dialect);
  }
}

/** The columns a unique index makes unique alone: over that one plain column, unfiltered. The key's is not among them. */
function uniqueColumns(indexes: readonly IndexSchema[]): Set<string> {
  return new Set(
    indexes.flatMap(({ unique, where, entries }) =>
      unique && !where && entries.length === 1 && !entries[0].expression ? [entries[0].column] : [],
    ),
  );
}

/** A {@link TableRowReader} over one querier: the same statement is only ever sent once. */
function createTableRowReader(querier: SqlQuerier): TableRowReader {
  const sent = new Map<string, Promise<RawRow[]>>();

  return <T extends RawRow>(sql: QueryRaw): Promise<T[]> => {
    const key = JSON.stringify(querier.dialect.compile(sql));
    let rows = sent.get(key);
    if (!rows) {
      rows = querier.all<RawRow>(sql);
      sent.set(key, rows);
    }
    return rows as Promise<T[]>;
  };
}
