import type { ColumnSchema } from '../../type/index.js';
import { lacksValue } from '../schemaChange.js';
import { dropIndexOnTable, TableDdl } from './tableDdl.js';

/** Table DDL for the MySQL family: `MODIFY COLUMN`, and dedicated clauses to drop a primary key or foreign key. */
export class MySqlTableDdl extends TableDdl {
  override readonly tableOptions = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

  /**
   * MySQL fills existing rows with a zero when it adds a required column that has no default. So the column
   * is added nullable and then made required, which fails on those rows as it does on other engines.
   */
  override addColumnStatements(
    table: string,
    column: ColumnSchema,
    render: (column: ColumnSchema) => string,
  ): string[] {
    if (!lacksValue(column)) {
      return super.addColumnStatements(table, column, render);
    }
    return [
      this.addColumn(table, render({ ...column, nullable: true })),
      ...this.alterColumn(table, column, render(column)),
    ];
  }

  override alterColumn(table: string, _column: ColumnSchema, definition: string): string[] {
    return [`ALTER TABLE ${this.dialect.escapeId(table)} MODIFY COLUMN ${definition};`];
  }

  /** Ignores `schema`: MySQL reads it from the table name, which is already qualified. */
  override dropIndex(table: string, index: string): string {
    return dropIndexOnTable(this.dialect, table, index);
  }

  override dropForeignKey(table: string, constraint: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(table)} DROP FOREIGN KEY ${this.dialect.escapeId(constraint)};`;
  }

  /** MySQL always names the primary key `PRIMARY`, so it is dropped without a name. */
  override dropPrimaryKey(table: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(table)} DROP PRIMARY KEY;`;
  }
}
