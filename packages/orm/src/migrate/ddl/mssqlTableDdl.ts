import type { ColumnSchema } from '../../type/index.js';
import { escapeSingleQuotes } from '../../util/sqlLiteral.js';
import { sizedType, TableDdl } from './tableDdl.js';

/** The constraints of each kind on column `c`, the `sys.columns` row {@link MsSqlTableDdl} reads. */
const CONSTRAINTS_ON = {
  default: /*sql*/ `SELECT d.name FROM sys.default_constraints d
    WHERE d.parent_object_id = c.object_id AND d.parent_column_id = c.column_id`,
  check: /*sql*/ `SELECT k.name FROM sys.check_constraints k
    WHERE k.parent_object_id = c.object_id AND k.parent_column_id = c.column_id`,
  unique: /*sql*/ `SELECT u.name FROM sys.key_constraints u
    JOIN sys.index_columns ic ON ic.object_id = u.parent_object_id AND ic.index_id = u.unique_index_id
    WHERE u.parent_object_id = c.object_id AND u.type = 'UQ' AND ic.column_id = c.column_id`,
};

/**
 * SQL Server keeps a column's `DEFAULT`, `CHECK` and `UNIQUE` as constraints under names it picks, and
 * refuses to drop or retype the column past one, so they go first - looked up by column, as no two
 * databases name them alike. Renames are `sp_rename`, T-SQL having no `RENAME` clause.
 */
export class MsSqlTableDdl extends TableDdl {
  /** T-SQL rejects the optional `COLUMN` keyword after `ADD`. */
  override addColumn(table: string, definition: string): string {
    return /*sql*/ `ALTER TABLE ${this.dialect.escapeId(table)} ADD ${definition};`;
  }

  /** Its constraints go with the column, as they do on every other engine. */
  override dropColumn(table: string, column: string): string[] {
    return [this.dropConstraints(table, column, Object.values(CONSTRAINTS_ON)), ...super.dropColumn(table, column)];
  }

  /**
   * `ALTER COLUMN` takes the type and nullability alone, so the default is dropped and added back as a
   * constraint of its own. A `CHECK` or `UNIQUE` stays, and the server refuses a retype it blocks.
   */
  override alterColumn(table: string, column: ColumnSchema): string[] {
    const target = this.dialect.escapeId(table);
    const name = this.dialect.escapeId(column.name);
    const statements = [
      this.dropConstraints(table, column.name, [CONSTRAINTS_ON.default]),
      /*sql*/ `ALTER TABLE ${target} ALTER COLUMN ${name} ${sizedType(column)} ${column.nullable ? 'NULL' : 'NOT NULL'};`,
    ];
    if (column.defaultValue !== undefined) {
      statements.push(/*sql*/ `ALTER TABLE ${target} ADD${this.defaultClause(column)} FOR ${name};`);
    }
    return statements;
  }

  override renameColumn(table: string, oldName: string, newName: string): string {
    const qualified = `${this.dialect.escapeId(table)}.${this.dialect.escapeId(oldName)}`;
    return /*sql*/ `EXEC sp_rename ${this.dialect.escape(qualified)}, ${this.dialect.escape(newName)}, 'COLUMN';`;
  }

  override renameTable(oldName: string, newName: string): string {
    return /*sql*/ `EXEC sp_rename ${this.dialect.escape(this.dialect.escapeId(oldName))}, ${this.dialect.escape(newName)};`;
  }

  override storedGeneratedColumn(_type: string, expression: string): string {
    return /*sql*/ `AS (${expression}) PERSISTED`;
  }

  /** One statement, so a split on `;` cannot part the lookup from the `EXEC` it feeds. */
  private dropConstraints(table: string, column: string, kinds: readonly string[]): string {
    const target = this.dialect.escapeId(table);
    return (
      `DECLARE @drop nvarchar(max) = (SELECT STRING_AGG(N'ALTER TABLE ${escapeSingleQuotes(target)} DROP CONSTRAINT ' ` +
      `+ QUOTENAME(pinned.name), N'; ') FROM sys.columns c CROSS APPLY (${kinds.join(' UNION ALL ')}) pinned ` +
      `WHERE c.object_id = OBJECT_ID(${this.dialect.escape(target)}) AND c.name = ${this.dialect.escape(column)}) ` +
      'EXEC (@drop);'
    );
  }
}
