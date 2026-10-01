import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import type { Alteration, ColumnSchema } from '../../type/index.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { formatDefaultValue } from './defaultSql.js';

/**
 * A column's type with the size it was read back with, unless its spelling already carries one:
 * introspection reports `VARCHAR` and `255` apart, where a type from an entity is already whole.
 */
export function sizedType(column: Pick<ColumnSchema, 'type' | 'length' | 'precision' | 'scale'>): string {
  if (column.type.includes('(')) {
    return column.type;
  }
  if (column.precision !== undefined) {
    const size = column.scale === undefined ? column.precision : `${column.precision}, ${column.scale}`;
    return `${column.type}(${size})`;
  }
  return column.length === undefined ? column.type : `${column.type}(${column.length})`;
}

/**
 * Table DDL that engines spell differently. Like {@link IndexDdl}, it belongs to the migrator, so no runtime
 * entry carries it. This class holds the portable form, which SQLite takes; other families override what differs.
 */
export class TableDdl {
  constructor(protected readonly dialect: AbstractSqlDialect) {}

  /** Options appended to `CREATE TABLE`, such as MySQL's engine; empty by default. */
  readonly tableOptions: string = '';

  /** A `CREATE TABLE` up to its column list, a no-op where `ifNotExists` and the table is already there. */
  createTable(target: string, ifNotExists: boolean): string {
    return `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${target}`;
  }

  addColumn(table: string, definition: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(table)} ADD COLUMN ${definition};`;
  }

  /** The statements that add `column`, whose definition `render` writes. */
  addColumnStatements(table: string, column: ColumnSchema, render: (column: ColumnSchema) => string): string[] {
    return [this.addColumn(table, render(column))];
  }

  dropColumn(table: string, column: string): string[] {
    return [`ALTER TABLE ${this.dialect.escapeId(table)} DROP COLUMN ${this.dialect.escapeId(column)};`];
  }

  /** The statements that change a column from `from`, what it was, to `column`, whose definition is `definition`. */
  alterColumn(table: string, column: ColumnSchema, definition: string, from?: ColumnSchema): string[] {
    return this.alterTable(table, this.alterClauses(column, definition, from));
  }

  /** The statements making `alterations` to one table, whose new definitions `render` writes. */
  alterColumns(
    table: string,
    alterations: readonly Alteration<ColumnSchema>[],
    render: (column: ColumnSchema) => string,
  ): string[] {
    return this.alterTable(
      table,
      alterations.flatMap(({ from, to }) => this.alterClauses(to, render(to), from)),
    );
  }

  /** The `ALTER TABLE` clauses that change a column, as {@link alterColumn} takes it. */
  protected alterClauses(_column: ColumnSchema, definition: string, _from?: ColumnSchema): string[] {
    return [`ALTER COLUMN ${definition}`];
  }

  /** One `ALTER TABLE` making every clause, and none for no clause. */
  protected alterTable(table: string, clauses: readonly string[]): string[] {
    return clauses.length ? [`ALTER TABLE ${this.dialect.escapeId(table)} ${clauses.join(', ')};`] : [];
  }

  renameColumn(table: string, oldName: string, newName: string): string {
    const [target, from, to] = [table, oldName, newName].map((name) => this.dialect.escapeId(name));
    return `ALTER TABLE ${target} RENAME COLUMN ${from} TO ${to};`;
  }

  renameTable(oldName: string, newName: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(oldName)} RENAME TO ${this.dialect.escapeId(newName)};`;
  }

  /** `schema` is the table's schema, which also holds its indexes. */
  dropIndex(table: string, index: string, schema?: string): string {
    return `DROP INDEX IF EXISTS ${this.dialect.escapeQualifiedId(index, schema)};`;
  }

  dropForeignKey(table: string, constraint: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(table)} DROP CONSTRAINT ${this.dialect.escapeId(constraint)};`;
  }

  /** Drops the primary key by its real constraint name: the introspected one, or the one uql derived when adding it. */
  dropPrimaryKey(table: string, constraint?: string): string {
    if (!constraint) {
      throw new UqlUsageError(
        `Cannot drop the primary key of "${table}": ${this.dialect.dialectName} names the constraint, and ` +
          'introspection did not report a name for it.',
      );
    }
    return `ALTER TABLE ${this.dialect.escapeId(table)} DROP CONSTRAINT ${this.dialect.escapeId(constraint)};`;
  }

  /** A stored generated column's type, with the clause computing it. */
  storedGeneratedColumn(type: string, expression: string): string {
    return `${type} GENERATED ALWAYS AS (${expression}) STORED`;
  }

  /**
   * ` DEFAULT <sql>`, or nothing where the column declares none. Empty rather than `DEFAULT NULL`, so
   * an absent default stays absent - `defaultValue: null` is the way to ask for one.
   */
  defaultClause(column: { readonly defaultValue?: unknown; readonly type: string }): string {
    return column.defaultValue === undefined
      ? ''
      : ` DEFAULT ${formatDefaultValue(column.defaultValue, this.dialect, column.type)}`;
  }
}

/** `DROP INDEX <index> ON <table>`, for engines that scope index names per table: MySQL and SQL Server. */
export function dropIndexOnTable(dialect: AbstractSqlDialect, table: string, index: string): string {
  return `DROP INDEX ${dialect.escapeId(index)} ON ${dialect.escapeId(table)};`;
}
