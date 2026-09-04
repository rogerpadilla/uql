/**
 * Migration Builder
 *
 * Provides type-safe migration operations with two modes:
 * - OperationRecorder: Record operations only (for code generation)
 * - MigrationBuilder: Execute DDL operations (for integration tests/runtime)
 */

import type { ForeignKeyAction } from '../../schema/types.js';
import type { IndexColumnInput, IndexOptions } from '../../type/index.js';
import type { SqlDdlGenerator } from '../../type/migration.js';
import type { SqlQuerier } from '../../type/querier.js';
import { ddlText, normalizeIndexColumn } from '../../util/index.js';
import { derivedIndexName } from '../../util/sql.util.js';
import { createSchemaGenerator } from '../schemaGenerator.js';
import { splitSqlStatements } from './splitSqlStatements.js';
import { TableBuilder } from './tableBuilder.js';
import type {
  AnyMigrationOperation,
  CreateIndexOperation,
  FullColumnDefinition,
  IAlterTableBuilder,
  IColumnBuilder,
  IColumnFactory,
  IMigrationBuilder,
  ITableBuilder,
} from './types.js';

/**
 * Builder for altering a table.
 * Delegates to parent builder for operation recording.
 */
/**
 * One `createIndex` operation. Shared because the alter-table builder, the recorder and the
 * executing builder all record the same thing, and an entry left unnormalized reaches the generator
 * as a column literally named `[object Object]`.
 */
function createIndexOperation(
  tableName: string,
  columns: readonly IndexColumnInput[],
  options: IndexOptions = {},
): CreateIndexOperation {
  const { name, unique, ...index } = options;
  const entries = columns.map(normalizeIndexColumn);
  return {
    type: 'createIndex',
    tableName,
    index: {
      ...index,
      name:
        name ??
        derivedIndexName(
          tableName,
          entries.map((entry) => entry.column),
        ),
      where: ddlText(index.where, 'a partial-index predicate'),
      entries,
      unique: unique ?? false,
    },
  };
}

type ForeignKeyTarget = { table: string; columns: string[] };
type ForeignKeyOptions = { name?: string; onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction };

/**
 * The one shape of an `addForeignKey` operation, `NO ACTION` defaults included.
 *
 * Three callers build it and differ only in what they do with the result: the table builder records
 * it through its parent, the recorder records it directly, and the executing builder also runs it.
 * Spelled out three times, a changed default would have had to be found in all three.
 */
function addForeignKeyOperation(
  tableName: string,
  columns: string[],
  target: ForeignKeyTarget,
  options: ForeignKeyOptions = {},
): AnyMigrationOperation {
  return {
    type: 'addForeignKey',
    tableName,
    foreignKey: {
      name: options.name,
      columns,
      referencesTable: target.table,
      referencesColumns: target.columns,
      onDelete: options.onDelete ?? 'NO ACTION',
      onUpdate: options.onUpdate ?? 'NO ACTION',
    },
  };
}

/**
 * Declare one column through the same vocabulary `createTable` uses. A throwaway {@link TableBuilder}
 * is that vocabulary: `addColumn`/`alterColumn` used to take a bare {@link IColumnBuilder}, which
 * cannot express a type, so every column they recorded was hard-coded `VARCHAR`.
 */
function buildOneColumn(callback: (columns: IColumnFactory) => IColumnBuilder): FullColumnDefinition {
  return callback(new TableBuilder('')).build();
}

/**
 * Collects the operations one `alterTable` callback declares, in the order it declared them.
 *
 * Collected rather than dispatched to the parent as they are made: the chaining methods are
 * synchronous by contract, so a builder that executes could only fire and forget, which returned from
 * `alterTable` with the statements still in flight and turned a failure into an unhandled rejection.
 */
class AlterTableBuilder implements IAlterTableBuilder {
  readonly operations: AnyMigrationOperation[] = [];

  constructor(private readonly tableName: string) {}

  addColumn(callback: (columns: IColumnFactory) => IColumnBuilder): this {
    this.operations.push({
      type: 'addColumn',
      tableName: this.tableName,
      column: buildOneColumn(callback),
    });
    return this;
  }

  dropColumn(name: string): this {
    this.operations.push({
      type: 'dropColumn',
      tableName: this.tableName,
      columnName: name,
    });
    return this;
  }

  renameColumn(oldName: string, newName: string): this {
    this.operations.push({
      type: 'renameColumn',
      tableName: this.tableName,
      oldName,
      newName,
    });
    return this;
  }

  alterColumn(callback: (columns: IColumnFactory) => IColumnBuilder): this {
    const column = buildOneColumn(callback);
    this.operations.push({
      type: 'alterColumn',
      tableName: this.tableName,
      columnName: column.name,
      changes: column,
    });
    return this;
  }

  addIndex(columns: readonly IndexColumnInput[], options?: IndexOptions): this {
    this.operations.push(createIndexOperation(this.tableName, columns, options));
    return this;
  }

  dropIndex(name: string): this {
    this.operations.push({
      type: 'dropIndex',
      tableName: this.tableName,
      indexName: name,
    });
    return this;
  }

  addForeignKey(columns: string[], target: ForeignKeyTarget, options?: ForeignKeyOptions): this {
    this.operations.push(addForeignKeyOperation(this.tableName, columns, target, options));
    return this;
  }

  dropForeignKey(name: string): this {
    this.operations.push({
      type: 'dropForeignKey',
      tableName: this.tableName,
      constraintName: name,
    });
    return this;
  }
}

function collectAlterOperations(
  tableName: string,
  callback: (table: IAlterTableBuilder) => void,
): readonly AnyMigrationOperation[] {
  const builder = new AlterTableBuilder(tableName);
  callback(builder);
  return builder.operations;
}

/**
 * Records migration operations without executing them.
 * Use for migration code generation and dry-run scenarios.
 */
export class OperationRecorder implements IMigrationBuilder {
  protected readonly operations: AnyMigrationOperation[] = [];

  /**
   * Where every operation this class builds lands, and the one thing {@link MigrationBuilder}
   * overrides: it records and then runs. Each operation is spelled once, here, rather than once per
   * class, which is what let the two drift into recording different shapes of the same change.
   */
  protected async record(operation: AnyMigrationOperation): Promise<void> {
    this.operations.push(operation);
  }

  async createTable(name: string, callback: (table: ITableBuilder) => void): Promise<void> {
    const builder = new TableBuilder(name);
    callback(builder);

    await this.record({
      type: 'createTable',
      table: builder.build(),
    });
  }

  async dropTable(name: string, options: { ifExists?: boolean; cascade?: boolean } = {}): Promise<void> {
    await this.record({
      type: 'dropTable',
      tableName: name,
      ifExists: options.ifExists,
      cascade: options.cascade,
    });
  }

  async renameTable(oldName: string, newName: string): Promise<void> {
    await this.record({
      type: 'renameTable',
      oldName,
      newName,
    });
  }

  async alterTable(name: string, callback: (table: IAlterTableBuilder) => void): Promise<void> {
    for (const operation of collectAlterOperations(name, callback)) {
      await this.record(operation);
    }
  }

  async addColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void> {
    await this.record({
      type: 'addColumn',
      tableName,
      column: buildOneColumn(callback),
    });
  }

  async dropColumn(tableName: string, columnName: string): Promise<void> {
    await this.record({
      type: 'dropColumn',
      tableName,
      columnName,
    });
  }

  async alterColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void> {
    const column = buildOneColumn(callback);
    await this.record({
      type: 'alterColumn',
      tableName,
      columnName: column.name,
      changes: column,
    });
  }

  async renameColumn(tableName: string, oldName: string, newName: string): Promise<void> {
    await this.record({
      type: 'renameColumn',
      tableName,
      oldName,
      newName,
    });
  }

  async createIndex(tableName: string, columns: readonly IndexColumnInput[], options?: IndexOptions): Promise<void> {
    await this.record(createIndexOperation(tableName, columns, options));
  }

  async dropIndex(tableName: string, indexName: string): Promise<void> {
    await this.record({
      type: 'dropIndex',
      tableName,
      indexName,
    });
  }

  async addForeignKey(
    tableName: string,
    columns: string[],
    target: ForeignKeyTarget,
    options: ForeignKeyOptions = {},
  ): Promise<void> {
    await this.record(addForeignKeyOperation(tableName, columns, target, options));
  }

  async dropForeignKey(tableName: string, constraintName: string): Promise<void> {
    await this.record({
      type: 'dropForeignKey',
      tableName,
      constraintName,
    });
  }

  async raw(sql: string): Promise<void> {
    await this.record({
      type: 'raw',
      sql,
    });
  }

  getOperations(): AnyMigrationOperation[] {
    return [...this.operations];
  }
}

/**
 * Executes DDL operations via a SQL querier.
 * Use for integration tests and runtime schema management.
 *
 * @example
 * ```typescript
 * const builder = new MigrationBuilder(querier);
 *
 * await builder.createTable('users', (t) => {
 *   t.id();
 *   t.string('name');
 *   t.timestamps();
 * });
 * ```
 */
export class MigrationBuilder extends OperationRecorder {
  private readonly sqlGenerator: SqlDdlGenerator;

  constructor(private readonly querier: SqlQuerier) {
    super();
    const generator = createSchemaGenerator(querier.dialect);
    if (!generator) {
      throw new TypeError(`Could not find a schema generator for dialect: ${querier.dialect.dialectName}`);
    }
    this.sqlGenerator = generator;
  }

  /** The recorder's sink, plus the statements the operation turns into. */
  protected override async record(operation: AnyMigrationOperation): Promise<void> {
    await super.record(operation);
    await this.execute(operation);
  }

  private getCreateTableStatements(operation: Extract<AnyMigrationOperation, { type: 'createTable' }>): string[] {
    return this.sqlGenerator.generateCreateTableFromDefinition(operation.table);
  }

  private async execute(operation: AnyMigrationOperation): Promise<void> {
    if (operation.type === 'createTable') {
      for (const statement of this.getCreateTableStatements(operation)) {
        await this.querier.run(statement);
      }
      return;
    }

    const sql = this.operationToSql(operation);
    if (sql) {
      for (const statement of splitSqlStatements(sql)) {
        await this.querier.run(statement);
      }
    }
  }

  private operationToSql(operation: AnyMigrationOperation): string | undefined {
    switch (operation.type) {
      case 'createTable':
        // One line per statement in preview; execute() runs each separately (#87).
        return this.getCreateTableStatements(operation).join('\n');
      case 'dropTable':
        return this.sqlGenerator.generateDropTable(operation.tableName, {
          ifExists: operation.ifExists,
          cascade: operation.cascade,
        });
      case 'renameTable':
        return this.sqlGenerator.generateRenameTableSql(operation.oldName, operation.newName);
      case 'addColumn':
        return this.sqlGenerator.generateAddColumnSql(operation.tableName, operation.column);
      case 'dropColumn':
        return this.sqlGenerator.generateDropColumnSql(operation.tableName, operation.columnName);
      case 'renameColumn':
        return this.sqlGenerator.generateRenameColumnSql(operation.tableName, operation.oldName, operation.newName);
      case 'alterColumn':
        return this.sqlGenerator.generateAlterColumnSql(operation.tableName, operation.columnName, operation.changes);
      case 'createIndex':
        return this.sqlGenerator.generateCreateIndex(operation.tableName, operation.index);
      case 'dropIndex':
        return this.sqlGenerator.generateDropIndex(operation.tableName, operation.indexName);
      case 'addForeignKey':
        return this.sqlGenerator.generateAddForeignKeySql(operation.tableName, operation.foreignKey);
      case 'dropForeignKey':
        return this.sqlGenerator.generateDropForeignKeySql(operation.tableName, operation.constraintName);
      case 'raw':
        return operation.sql;
      default:
        return undefined;
    }
  }
}
