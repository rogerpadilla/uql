/**
 * Migration Builder
 *
 * Provides type-safe migration operations with two modes:
 * - OperationRecorder: Record operations only (for code generation)
 * - MigrationBuilder: Execute DDL operations (for integration tests/runtime)
 */

import type { ForeignKeyAction } from '../../schema/types.js';
import type { SchemaGenerator } from '../../type/migration.js';
import type { NamingStrategy } from '../../type/namingStrategy.js';
import type { SqlQuerier } from '../../type/querier.js';
import { createSchemaGenerator } from '../schemaGenerator.js';
import { ColumnBuilder } from './columnBuilder.js';
import { TableBuilder } from './tableBuilder.js';
import type {
  AnyMigrationOperation,
  IAlterTableBuilder,
  IColumnBuilder,
  IMigrationBuilder,
  ITableBuilder,
  RawSqlOperation,
} from './types.js';

/**
 * Builder for altering a table.
 * Delegates to parent builder for operation recording.
 */
class AlterTableBuilder implements IAlterTableBuilder {
  constructor(
    private readonly tableName: string,
    private readonly parentBuilder: IMigrationBuilder,
  ) {}

  addColumn(name: string, callback: (column: IColumnBuilder) => void): this {
    const builder = new ColumnBuilder(name, { category: 'string' });
    callback(builder);

    this.parentBuilder.recordOperationSync({
      type: 'addColumn',
      tableName: this.tableName,
      column: builder.build(),
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

  alterColumn(name: string, callback: (column: IColumnBuilder) => void): this {
    const builder = new ColumnBuilder(name, { category: 'string' });
    callback(builder);

    this.parentBuilder.recordOperationSync({
      type: 'alterColumn',
      tableName: this.tableName,
      columnName: name,
      changes: builder.build(),
    });
    return this;
  }

  addIndex(columns: string[], options?: { name?: string; unique?: boolean }): this {
    const indexName = options?.name ?? `idx_${this.tableName}_${columns.join('_')}`;
    this.parentBuilder.recordOperationSync({
      type: 'createIndex',
      tableName: this.tableName,
      index: {
        name: indexName,
        columns,
        unique: options?.unique ?? false,
      },
    });
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

  async addColumn(tableName: string, columnName: string, callback: (column: IColumnBuilder) => void): Promise<void> {
    const builder = new ColumnBuilder(columnName, { category: 'string' });
    callback(builder);

    this.recordOperationSync({
      type: 'addColumn',
      tableName,
      column: builder.build(),
    });
  }

  async dropColumn(tableName: string, columnName: string): Promise<void> {
    this.recordOperationSync({
      type: 'dropColumn',
      tableName,
      columnName,
    });
  }

  async alterColumn(tableName: string, columnName: string, callback: (column: IColumnBuilder) => void): Promise<void> {
    const builder = new ColumnBuilder(columnName, { category: 'string' });
    callback(builder);

    this.recordOperationSync({
      type: 'alterColumn',
      tableName,
      columnName,
      changes: builder.build(),
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

  async createIndex(
    tableName: string,
    columns: string[],
    options: { name?: string; unique?: boolean; where?: string } = {},
  ): Promise<void> {
    const indexName = options.name ?? `idx_${tableName}_${columns.join('_')}`;

    this.recordOperationSync({
      type: 'createIndex',
      tableName,
      index: {
        name: indexName,
        columns,
        unique: options.unique ?? false,
        where: options.where,
      },
    });
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
 * Options for the migration builder.
 */
export interface MigrationBuilderOptions {
  /** Custom naming strategy for generated SQL */
  namingStrategy?: NamingStrategy;
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
  private readonly sqlGenerator: SchemaGenerator;

  constructor(
    private readonly querier: SqlQuerier,
    options: MigrationBuilderOptions = {},
  ) {
    super();
    this.sqlGenerator = createSchemaGenerator(querier.dialect.dialect, options.namingStrategy);
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

  override async addColumn(
    tableName: string,
    columnName: string,
    callback: (column: IColumnBuilder) => void,
  ): Promise<void> {
    const builder = new ColumnBuilder(columnName, { category: 'string' });
    callback(builder);

    const operation: AnyMigrationOperation = {
      type: 'addColumn',
      tableName,
      column: builder.build(),
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

  override async alterColumn(
    tableName: string,
    columnName: string,
    callback: (column: IColumnBuilder) => void,
  ): Promise<void> {
    const builder = new ColumnBuilder(columnName, { category: 'string' });
    callback(builder);

    const operation: AnyMigrationOperation = {
      type: 'alterColumn',
      tableName,
      columnName,
      changes: builder.build(),
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
    columns: string[],
    options: { name?: string; unique?: boolean; where?: string } = {},
  ): Promise<void> {
    const indexName = options.name ?? `idx_${tableName}_${columns.join('_')}`;

    const operation: AnyMigrationOperation = {
      type: 'createIndex',
      tableName,
      index: {
        name: indexName,
        columns,
        unique: options.unique ?? false,
        where: options.where,
      },
    };
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

  private async execute(operation: AnyMigrationOperation): Promise<void> {
    const sql = this.operationToSql(operation);
    if (sql) {
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const statement of statements) {
        await this.querier.run(statement);
      }
    }
  }

  private operationToSql(operation: AnyMigrationOperation): string | undefined {
    switch (operation.type) {
      case 'createTable':
        return this.sqlGenerator.generateCreateTableFromDefinition(operation.table);
      case 'dropTable':
        return this.sqlGenerator.generateDropTableSql(operation.tableName, {
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
        return this.sqlGenerator.generateCreateIndexSql(operation.tableName, operation.index);
      case 'dropIndex':
        return this.sqlGenerator.generateDropIndexSql(operation.tableName, operation.indexName);
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

/**
 * Create an operation recorder for dry-run (recording only).
 * @deprecated Use `new OperationRecorder()` directly
 */
export function createDryRunBuilder(): OperationRecorder {
  return new OperationRecorder();
}
