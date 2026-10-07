import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import type { ColumnSchema, PrimaryKeySchema } from '../../type/index.js';
import { derivedPrimaryKeyName, splitQualifiedName } from '../../util/sql.util.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { formatDefaultValue } from './defaultSql.js';

/** A column to change into `to`, from what it was where that is known: the builder alters a column it never read. */
export type ColumnAlteration = { readonly from?: ColumnSchema; readonly to: ColumnSchema };

/** What a comment documents: a column, by its name. */
export type Commented = { readonly name: string; readonly comment?: string };

/**
 * Table DDL that engines spell differently. Like {@link IndexDdl}, it belongs to the migrator, so no runtime
 * entry carries it. This class holds the portable form, which SQLite takes; other families override what differs.
 */
export class TableDdl {
  constructor(protected readonly dialect: AbstractSqlDialect) {}

  /** A `CREATE TABLE` up to its column list, a no-op where `ifNotExists` and the table is already there. */
  createTable(target: string, ifNotExists: boolean): string {
    return `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${target}`;
  }

  /** What follows a `CREATE TABLE`'s column list: the engine's options, and the table's comment where it keeps one there. */
  tableSuffix(_comment?: string): string {
    return '';
  }

  /**
   * The one place a column definition is spelled. A key column states `NOT NULL` rather than leave it to the
   * key: SQLite lets a key column hold NULL otherwise, and SQL Server adds no key over a nullable column. Never
   * `UNIQUE`: a unique column is a unique index, which the table creates beside it. Nor an enum's `CHECK`.
   */
  columnDefinition(column: ColumnSchema): string {
    const type = column.generatedAs ? this.storedGeneratedColumn(column.type, column.generatedAs) : column.type;
    const notNull = column.nullable ? '' : ' NOT NULL';
    return `${this.dialect.escapeId(column.name)} ${type}${notNull}${this.defaultClause(column)}${this.columnComment(column.comment)}`;
  }

  /** What a column definition ends with to keep `comment`, where the engine keeps one there. */
  protected columnComment(_comment?: string): string {
    return '';
  }

  /** The statements documenting `table` and its `columns` once they exist, where the engine documents that way. */
  commentStatements(_table: string, _comment: string | undefined, _columns: readonly Commented[]): string[] {
    return [];
  }

  /** The statements that add `column`, its definition followed by `constraints`, and document it. */
  addColumnStatements(table: string, column: ColumnSchema, constraints = ''): string[] {
    return [
      this.addColumn(table, this.columnDefinition(column) + constraints),
      ...this.commentStatements(table, undefined, [column]),
    ];
  }

  protected addColumn(table: string, definition: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(table)} ADD COLUMN ${definition};`;
  }

  dropColumn(table: string, column: string): string[] {
    return [`ALTER TABLE ${this.dialect.escapeId(table)} DROP COLUMN ${this.dialect.escapeId(column)};`];
  }

  /** The statements making `alterations` to one table. */
  alterColumns(table: string, alterations: readonly ColumnAlteration[]): string[] {
    return this.alterTable(
      table,
      alterations.flatMap(({ from, to }) => this.alterClauses(to, from)),
    );
  }

  /**
   * The `ALTER TABLE` clauses that change a column to `column` from `from`. None in the portable form: SQLite
   * changes a column only by rebuilding its table, which a diff states as `rebuild`.
   */
  protected alterClauses(column: ColumnSchema, _from?: ColumnSchema): string[] {
    throw rebuildRefusal(this.dialect, `Altering the column "${column.name}"`);
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

  /** An index lives in the schema of its table, whose name is qualified where it has one. */
  dropIndex(table: string, index: string): string {
    return `DROP INDEX IF EXISTS ${this.dialect.escapeQualifiedId(index, splitQualifiedName(table).schema)};`;
  }

  dropForeignKey(table: string, constraint: string): string {
    return `ALTER TABLE ${this.dialect.escapeId(table)} DROP CONSTRAINT ${this.dialect.escapeId(constraint)};`;
  }

  /** `CONSTRAINT <name> PRIMARY KEY (...)`, in a `CREATE TABLE` or after `ADD`, under the name a drop finds it by. */
  primaryKeyConstraint(table: string, key: PrimaryKeySchema): string {
    const name = this.dialect.escapeId(key.name ?? derivedPrimaryKeyName(table, key.columns));
    return `CONSTRAINT ${name} PRIMARY KEY (${key.columns.map((column) => this.dialect.escapeId(column)).join(', ')})`;
  }

  /** A key change as statements: dropping `from` before what it holds changes, and adding `to` last. */
  replacePrimaryKey(table: string, from?: PrimaryKeySchema, to?: PrimaryKeySchema): [string[], string[]] {
    return this.keyChange(
      table,
      from && this.dropPrimaryKey(table, from),
      to && `ADD ${this.primaryKeyConstraint(table, to)}`,
    );
  }

  /** The clauses of {@link replacePrimaryKey}, each its own statement. */
  protected keyChange(table: string, drop?: string, add?: string): [string[], string[]] {
    return [this.alterTable(table, drop ? [drop] : []), this.alterTable(table, add ? [add] : [])];
  }

  /** The clause dropping `key` by its real constraint name: the introspected one, or the one uql derived adding it. */
  protected dropPrimaryKey(table: string, key: PrimaryKeySchema): string {
    if (!key.name) {
      throw new UqlUsageError(
        `Cannot drop the primary key of "${table}": ${this.dialect.dialectName} names the constraint, and ` +
          'introspection did not report a name for it.',
      );
    }
    return `DROP CONSTRAINT ${this.dialect.escapeId(key.name)}`;
  }

  /** A stored generated column's type, with the clause computing it. */
  protected storedGeneratedColumn(type: string, expression: string): string {
    return `${type} GENERATED ALWAYS AS (${expression}) STORED`;
  }

  /**
   * ` DEFAULT <sql>`, or nothing where the column declares none. Empty rather than `DEFAULT NULL`, so
   * an absent default stays absent - `defaultValue: null` is the way to ask for one.
   */
  protected defaultClause(column: { readonly defaultValue?: unknown; readonly type: string }): string {
    return column.defaultValue === undefined
      ? ''
      : ` DEFAULT ${formatDefaultValue(column.defaultValue, this.dialect, column.type)}`;
  }
}

/** `DROP INDEX <index> ON <table>`, for engines that scope index names per table: MySQL and SQL Server. */
export function dropIndexOnTable(dialect: AbstractSqlDialect, table: string, index: string): string {
  return `DROP INDEX ${dialect.escapeId(index)} ON ${dialect.escapeId(table)};`;
}

/** What an engine that changes a table only by rebuilding it says to `what`, done in place. */
export function rebuildRefusal(dialect: AbstractSqlDialect, what: string): UqlUsageError {
  return new UqlUsageError(
    `${dialect.dialectName}: ${what} rebuilds the table, which a migration generated from the entities does ` +
      '(`uql-migrate generate:entities`) and a hand-written one cannot.',
  );
}
