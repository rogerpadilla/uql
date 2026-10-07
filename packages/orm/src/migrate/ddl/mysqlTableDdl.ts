import type { ColumnSchema } from '../../type/index.js';
import { lacksValue } from '../schemaChange.js';
import { dropIndexOnTable, TableDdl } from './tableDdl.js';

/** Table DDL for the MySQL family: `MODIFY COLUMN`, inline comments, and dedicated clauses to drop a key. */
export class MySqlTableDdl extends TableDdl {
  override tableSuffix(comment?: string): string {
    return ` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4${comment ? ` COMMENT=${this.dialect.escape(comment)}` : ''}`;
  }

  protected override columnComment(comment?: string): string {
    return comment ? ` COMMENT ${this.dialect.escape(comment)}` : '';
  }

  /**
   * MySQL fills existing rows with a zero when it adds a required column that has no default. So the column
   * is added nullable and then made required, which fails on those rows as it does on other engines.
   */
  override addColumnStatements(table: string, column: ColumnSchema, constraints = ''): string[] {
    if (!lacksValue(column)) {
      return super.addColumnStatements(table, column, constraints);
    }
    return [
      this.addColumn(table, this.columnDefinition({ ...column, nullable: true }) + constraints),
      ...this.alterColumns(table, [{ to: column }]),
    ];
  }

  protected override alterClauses(column: ColumnSchema): string[] {
    return [`MODIFY COLUMN ${this.columnDefinition(column)}`];
  }

  /** Ignores `schema`: MySQL reads it from the table name, which is already qualified. */
  override dropIndex(table: string, index: string): string {
    return dropIndexOnTable(this.dialect, table, index);
  }

  override dropForeignKey(table: string, constraint: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(table)} DROP FOREIGN KEY ${this.dialect.escapeId(constraint)};`;
  }

  /** MySQL always names the primary key `PRIMARY`, so it is dropped without a name. */
  protected override dropPrimaryKey(): string {
    return 'DROP PRIMARY KEY';
  }
}
