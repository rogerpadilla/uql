import type { ColumnSchema } from '../../type/index.js';
import { sameDefault } from './defaultSql.js';
import { type Commented, TableDdl } from './tableDdl.js';

/** Table DDL for the Postgres family, which alters each part of a column in a separate clause. */
export class PgTableDdl extends TableDdl {
  /** A clause for each part that differs from `from`, the column as it was, or for every part without it. */
  protected override alterClauses(column: ColumnSchema, from?: ColumnSchema): string[] {
    const name = this.dialect.escapeId(column.name);
    const alter = `ALTER COLUMN ${name}`;
    return [
      // Casts explicitly: Postgres converts on its own only between compatible types, and text to integer is not.
      (!from || from.type !== column.type) && `${alter} TYPE ${column.type} USING ${name}::${column.type}`,
      (!from || from.nullable !== column.nullable) && `${alter} ${column.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`,
      (!from || !sameDefault(column.defaultValue, from.defaultValue, this.dialect)) &&
        (column.defaultValue === undefined ? `${alter} DROP DEFAULT` : `${alter} SET${this.defaultClause(column)}`),
    ].filter((clause) => clause !== false);
  }

  /** `COMMENT ON`, a statement of its own for the table and for each column. */
  override commentStatements(table: string, comment: string | undefined, columns: readonly Commented[]): string[] {
    const target = this.dialect.escapeId(table);
    return [
      ...(comment ? [`COMMENT ON TABLE ${target} IS ${this.dialect.escape(comment)};`] : []),
      ...columns.flatMap((column) =>
        column.comment
          ? [
              `COMMENT ON COLUMN ${target}.${this.dialect.escapeId(column.name)} IS ${this.dialect.escape(column.comment)};`,
            ]
          : [],
      ),
    ];
  }
}

/** CockroachDB refuses a rewriting retype beside any other clause, and changes a schema online anyway. */
export class CockroachTableDdl extends PgTableDdl {
  protected override alterTable(table: string, clauses: readonly string[]): string[] {
    return clauses.flatMap((clause) => super.alterTable(table, [clause]));
  }

  /** In one statement: a `schema_locked` table, its default, drops a key only beside the key replacing it. */
  protected override keyChange(table: string, drop?: string, add?: string): [string[], string[]] {
    return drop && add ? [[], super.alterTable(table, [drop, add])] : super.keyChange(table, drop, add);
  }
}
