import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import type { ColumnSchema } from '../../type/index.js';
import { formatDefaultValue, sameDefault } from '../builder/expressions.js';
import { lacksValue } from '../schemaChange.js';

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
 * The `ALTER TABLE` statements an engine spells its own way: the migrator's, for the reason
 * {@link IndexDdl} is. The form here is the portable one; SQL Server's is {@link MsSqlTableDdl}.
 */
export class TableDdl {
  constructor(protected readonly dialect: AbstractSqlDialect) {}

  /** A `CREATE TABLE` up to its column list, a no-op where `ifNotExists` and the table is already there. */
  createTable(target: string, ifNotExists: boolean): string {
    return `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${target}`;
  }

  addColumn(table: string, definition: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(table)} ADD COLUMN ${definition};`;
  }

  /**
   * `column` added, spelled by `render`. MySQL fills a zero into the rows already there for a required
   * column with no default, so there it is added nullable and required after, failing on them as elsewhere.
   */
  addColumnStatements(table: string, column: ColumnSchema, render: (column: ColumnSchema) => string): string[] {
    if (this.dialect.alterColumnSyntax !== 'MODIFY COLUMN' || !lacksValue(column)) {
      return [this.addColumn(table, render(column))];
    }
    return [
      this.addColumn(table, render({ ...column, nullable: true })),
      ...this.alterColumn(table, column, render(column)),
    ];
  }

  dropColumn(table: string, column: string): string[] {
    return [`ALTER TABLE ${this.dialect.escapeId(table)} DROP COLUMN ${this.dialect.escapeId(column)};`];
  }

  /**
   * What changes `column` to what it now declares. `definition` is the whole column, which MySQL's
   * `MODIFY COLUMN` restates; Postgres takes each change as a clause of its own, so given what the
   * column was (`from`), only the clauses that changed.
   */
  alterColumn(table: string, column: ColumnSchema, definition: string, from?: ColumnSchema): string[] {
    const target = this.dialect.escapeId(table);
    if (this.dialect.alterColumnStrategy !== 'separate-clauses') {
      return [`ALTER TABLE ${target} ${this.dialect.alterColumnSyntax} ${definition};`];
    }
    const name = this.dialect.escapeId(column.name);
    const alter = `ALTER TABLE ${target} ALTER COLUMN ${name}`;
    return [
      // Cast, since the engine converts only between types it deems compatible: text to integer needs saying.
      (!from || from.type !== column.type) && `${alter} TYPE ${column.type} USING ${name}::${column.type};`,
      (!from || from.nullable !== column.nullable) && `${alter} ${column.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`,
      (!from || !sameDefault(column.defaultValue, from.defaultValue, this.dialect)) &&
        (column.defaultValue === undefined ? `${alter} DROP DEFAULT;` : `${alter} SET${this.defaultClause(column)};`),
    ].filter((statement) => statement !== false);
  }

  renameColumn(table: string, oldName: string, newName: string): string {
    const [target, from, to] = [table, oldName, newName].map((name) => this.dialect.escapeId(name));
    return `ALTER TABLE ${target} RENAME COLUMN ${from} TO ${to};`;
  }

  renameTable(oldName: string, newName: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(oldName)} RENAME TO ${this.dialect.escapeId(newName)};`;
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
