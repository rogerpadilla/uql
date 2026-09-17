import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import type { ColumnSchema } from '../../type/index.js';
import { formatDefaultValue } from '../builder/expressions.js';

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

  addColumn(table: string, definition: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(table)} ADD COLUMN ${definition};`;
  }

  dropColumn(table: string, column: string): string[] {
    return [`ALTER TABLE ${this.dialect.escapeId(table)} DROP COLUMN ${this.dialect.escapeId(column)};`];
  }

  /**
   * What changes `column` to what it now declares. `definition` is the whole column, which MySQL's
   * `MODIFY COLUMN` restates; Postgres takes each change as a clause of its own.
   */
  alterColumn(table: string, column: ColumnSchema, definition: string): string[] {
    if (this.dialect.alterColumnSyntax === 'none') {
      throw new TypeError(
        `${this.dialect}: Cannot alter column "${column.name}" - you must recreate the table. ` +
          `This database does not support ALTER COLUMN.`,
      );
    }
    const target = this.dialect.escapeId(table);
    if (this.dialect.alterColumnStrategy !== 'separate-clauses') {
      return [`ALTER TABLE ${target} ${this.dialect.alterColumnSyntax} ${definition};`];
    }
    const alter = `ALTER TABLE ${target} ALTER COLUMN ${this.dialect.escapeId(column.name)}`;
    return [
      `${alter} TYPE ${column.type};`,
      `${alter} ${column.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`,
      column.defaultValue === undefined ? `${alter} DROP DEFAULT;` : `${alter} SET${this.defaultClause(column)};`,
    ];
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
