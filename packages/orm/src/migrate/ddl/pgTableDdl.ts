import type { ColumnSchema } from '../../type/index.js';
import { sameDefault } from './defaultSql.js';
import { TableDdl } from './tableDdl.js';

/** Table DDL for the Postgres family, which alters each part of a column in a separate clause. */
export class PgTableDdl extends TableDdl {
  /** A clause for each part that differs from `from`, the column as it was, or for every part without it. */
  override alterColumn(table: string, column: ColumnSchema, _definition: string, from?: ColumnSchema): string[] {
    const name = this.dialect.escapeId(column.name);
    const alter = `ALTER TABLE ${this.dialect.escapeId(table)} ALTER COLUMN ${name}`;
    return [
      // Casts explicitly: Postgres converts on its own only between compatible types, and text to integer is not.
      (!from || from.type !== column.type) && `${alter} TYPE ${column.type} USING ${name}::${column.type};`,
      (!from || from.nullable !== column.nullable) && `${alter} ${column.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`,
      (!from || !sameDefault(column.defaultValue, from.defaultValue, this.dialect)) &&
        (column.defaultValue === undefined ? `${alter} DROP DEFAULT;` : `${alter} SET${this.defaultClause(column)};`),
    ].filter((statement) => statement !== false);
  }
}
