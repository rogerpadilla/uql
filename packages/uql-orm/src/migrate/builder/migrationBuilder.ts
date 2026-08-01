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
import { normalizeIndexColumn } from '../../util/index.js';
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
  RawSqlOperation,
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
      name: name ?? `idx_${tableName}_${entries.map((entry) => entry.column).join('_')}`,
      columns: entries,
      unique: unique ?? false,
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

class AlterTableBuilder implements IAlterTableBuilder {
  constructor(
    private readonly tableName: string,
    private readonly parentBuilder: IMigrationBuilder,
  ) {}

  addColumn(callback: (columns: IColumnFactory) => IColumnBuilder): this {
    this.parentBuilder.recordOperationSync({
      type: 'addColumn',
      tableName: this.tableName,
      column: buildOneColumn(callback),
    });
    return this;
  }

  dropColumn(name: string): this {
    this.parentBuilder.recordOperationSync({
      type: 'dropColumn',
      tableName: this.tableName,
      columnName: name,
    });
    return this;
  }

  renameColumn(oldName: string, newName: string): this {
    this.parentBuilder.recordOperationSync({
      type: 'renameColumn',
      tableName: this.tableName,
      oldName,
      newName,
    });
    return this;
  }

  alterColumn(callback: (columns: IColumnFactory) => IColumnBuilder): this {
    const column = buildOneColumn(callback);
    this.parentBuilder.recordOperationSync({
      type: 'alterColumn',
      tableName: this.tableName,
      columnName: column.name,
      changes: column,
    });
    return this;
  }

  addIndex(columns: readonly IndexColumnInput[], options?: IndexOptions): this {
    this.parentBuilder.recordOperationSync(createIndexOperation(this.tableName, columns, options));
    return this;
  }

  dropIndex(name: string): this {
    this.parentBuilder.recordOperationSync({
      type: 'dropIndex',
      tableName: this.tableName,
      indexName: name,
    });
    return this;
  }

  addForeignKey(
    columns: string[],
    target: { table: string; columns: string[] },
    options?: { name?: string; onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction },
  ): this {
    this.parentBuilder.recordOperationSync({
      type: 'addForeignKey',
      tableName: this.tableName,
      foreignKey: {
        name: options?.name,
        columns,
        referencesTable: target.table,
        referencesColumns: target.columns,
        onDelete: options?.onDelete ?? 'NO ACTION',
        onUpdate: options?.onUpdate ?? 'NO ACTION',
      },
    });
    return this;
  }

  dropForeignKey(name: string): this {
    this.parentBuilder.recordOperationSync({
      type: 'dropForeignKey',
      tableName: this.tableName,
      constraintName: name,
    });
    return this;
  }
}

/**
 * Records migration operations without executing them.
 * Use for migration code generation and dry-run scenarios.
 */
export class OperationRecorder implements IMigrationBuilder {
  protected readonly operations: AnyMigrationOperation[] = [];

  // ============================================================================
  // Table Operations
  // ============================================================================

  async createTable(name: string, callback: (table: ITableBuilder) => void): Promise<void> {
    const builder = new TableBuilder(name);
    callback(builder);

    this.recordOperationSync({
      type: 'createTable',
      table: builder.build(),
    });
  }

  async dropTable(name: string, options: { ifExists?: boolean; cascade?: boolean } = {}): Promise<void> {
    this.recordOperationSync({
      type: 'dropTable',
      tableName: name,
      ifExists: options.ifExists,
      cascade: options.cascade,
    });
  }

  async renameTable(oldName: string, newName: string): Promise<void> {
    this.recordOperationSync({
      type: 'renameTable',
      oldName,
      newName,
    });
  }

  async alterTable(name: string, callback: (table: IAlterTableBuilder) => void): Promise<void> {
    const builder = new AlterTableBuilder(name, this);
    callback(builder);
  }

  // ============================================================================
  // Column Operations
  // ============================================================================

  async addColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void> {
    this.recordOperationSync({
      type: 'addColumn',
      tableName,
      column: buildOneColumn(callback),
    });
  }

  async dropColumn(tableName: string, columnName: string): Promise<void> {
    this.recordOperationSync({
      type: 'dropColumn',
      tableName,
      columnName,
    });
  }

  async alterColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void> {
    const column = buildOneColumn(callback);
    this.recordOperationSync({
      type: 'alterColumn',
      tableName,
      columnName: column.name,
      changes: column,
    });
  }

  async renameColumn(tableName: string, oldName: string, newName: string): Promise<void> {
    this.recordOperationSync({
      type: 'renameColumn',
      tableName,
      oldName,
      newName,
    });
  }

  // ============================================================================
  // Index Operations
  // ============================================================================

  async createIndex(tableName: string, columns: readonly IndexColumnInput[], options?: IndexOptions): Promise<void> {
    this.recordOperationSync(createIndexOperation(tableName, columns, options));
  }

  async dropIndex(tableName: string, indexName: string): Promise<void> {
    this.recordOperationSync({
      type: 'dropIndex',
      tableName,
      indexName,
    });
  }

  // ============================================================================
  // Foreign Key Operations
  // ============================================================================

  async addForeignKey(
    tableName: string,
    columns: string[],
    target: { table: string; columns: string[] },
    options: { name?: string; onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction } = {},
  ): Promise<void> {
    this.recordOperationSync({
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
    });
  }

  async dropForeignKey(tableName: string, constraintName: string): Promise<void> {
    this.recordOperationSync({
      type: 'dropForeignKey',
      tableName,
      constraintName,
    });
  }

  // ============================================================================
  // Raw SQL
  // ============================================================================

  async raw(sql: string): Promise<void> {
    this.recordOperationSync({
      type: 'raw',
      sql,
    });
  }

  // ============================================================================
  // Operation Access
  // ============================================================================

  getOperations(): AnyMigrationOperation[] {
    return [...this.operations];
  }

  recordOperationSync(operation: AnyMigrationOperation): void {
    this.operations.push(operation);
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

  override recordOperationSync(operation: AnyMigrationOperation): void {
    super.recordOperationSync(operation);
    // Fire and forget execution - for sync contexts (AlterTableBuilder)
    void this.execute(operation);
  }

  override async raw(sql: string): Promise<void> {
    const operation: RawSqlOperation = {
      type: 'raw',
      sql,
    };
    this.operations.push(operation);
    await this.querier.run(sql);
  }

  // ============================================================================
  // Override async methods to execute immediately
  // ============================================================================

  override async createTable(name: string, callback: (table: ITableBuilder) => void): Promise<void> {
    const builder = new TableBuilder(name);
    callback(builder);

    const operation: AnyMigrationOperation = {
      type: 'createTable',
      table: builder.build(),
    };
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async dropTable(name: string, options: { ifExists?: boolean; cascade?: boolean } = {}): Promise<void> {
    const operation: AnyMigrationOperation = {
      type: 'dropTable',
      tableName: name,
      ifExists: options.ifExists,
      cascade: options.cascade,
    };
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async renameTable(oldName: string, newName: string): Promise<void> {
    const operation: AnyMigrationOperation = {
      type: 'renameTable',
      oldName,
      newName,
    };
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async addColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void> {
    const operation: AnyMigrationOperation = {
      type: 'addColumn',
      tableName,
      column: buildOneColumn(callback),
    };
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async dropColumn(tableName: string, columnName: string): Promise<void> {
    const operation: AnyMigrationOperation = {
      type: 'dropColumn',
      tableName,
      columnName,
    };
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async alterColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void> {
    const column = buildOneColumn(callback);
    const operation: AnyMigrationOperation = {
      type: 'alterColumn',
      tableName,
      columnName: column.name,
      changes: column,
    };
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async renameColumn(tableName: string, oldName: string, newName: string): Promise<void> {
    const operation: AnyMigrationOperation = {
      type: 'renameColumn',
      tableName,
      oldName,
      newName,
    };
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async createIndex(
    tableName: string,
    columns: readonly IndexColumnInput[],
    options?: IndexOptions,
  ): Promise<void> {
    const operation = createIndexOperation(tableName, columns, options);
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async dropIndex(tableName: string, indexName: string): Promise<void> {
    const operation: AnyMigrationOperation = {
      type: 'dropIndex',
      tableName,
      indexName,
    };
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async addForeignKey(
    tableName: string,
    columns: string[],
    target: { table: string; columns: string[] },
    options: { name?: string; onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction } = {},
  ): Promise<void> {
    const operation: AnyMigrationOperation = {
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
    this.operations.push(operation);
    await this.execute(operation);
  }

  override async dropForeignKey(tableName: string, constraintName: string): Promise<void> {
    const operation: AnyMigrationOperation = {
      type: 'dropForeignKey',
      tableName,
      constraintName,
    };
    this.operations.push(operation);
    await this.execute(operation);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

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
