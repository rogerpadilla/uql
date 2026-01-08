/**
 * Migration Builder
 *
 * The main builder class for defining type-safe migrations.
 * Records operations and generates SQL via the SchemaGenerator.
 */

import type { ForeignKeyAction } from '../../schema/types.js';
import type { SchemaGenerator } from '../../type/migration.js';
import type { SqlQuerier } from '../../type/querier.js';
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
 * Options for the migration builder.
 */
export interface MigrationBuilderOptions {
  /** Whether to execute SQL immediately or just record operations */
  dryRun?: boolean;
}

/**
 * Builder for altering a table.
 * Delegates to MigrationBuilder methods.
 */
class AlterTableBuilder implements IAlterTableBuilder {
  constructor(
    private readonly tableName: string,
    private readonly migrationBuilder: IMigrationBuilder,
  ) {}

  addColumn(name: string, callback: (column: IColumnBuilder) => void): this {
    const builder = new ColumnBuilder(name, { category: 'string' });
    callback(builder);

    this.migrationBuilder.recordOperationSync({
      type: 'addColumn',
      tableName: this.tableName,
      column: builder.build(),
    });
    return this;
  }

  dropColumn(name: string): this {
    this.migrationBuilder.recordOperationSync({
      type: 'dropColumn',
      tableName: this.tableName,
      columnName: name,
    });
    return this;
  }

  renameColumn(oldName: string, newName: string): this {
    this.migrationBuilder.recordOperationSync({
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

    this.migrationBuilder.recordOperationSync({
      type: 'alterColumn',
      tableName: this.tableName,
      columnName: name,
      changes: builder.build(),
    });
    return this;
  }

  addIndex(columns: string[], options?: { name?: string; unique?: boolean }): this {
    const indexName = options?.name ?? `idx_${this.tableName}_${columns.join('_')}`;
    this.migrationBuilder.recordOperationSync({
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
    this.migrationBuilder.recordOperationSync({
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
    this.migrationBuilder.recordOperationSync({
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
    this.migrationBuilder.recordOperationSync({
      type: 'dropForeignKey',
      tableName: this.tableName,
      constraintName: name,
    });
    return this;
  }
}

/**
 * Main migration builder with fluent API.
 * Records operations and optionally executes them via a querier.
 */
export class MigrationBuilder implements IMigrationBuilder {
  private operations: AnyMigrationOperation[] = [];
  private querier?: SqlQuerier;
  private sqlGenerator?: SchemaGenerator;
  private dryRun: boolean;

  constructor(querier?: SqlQuerier, sqlGenerator?: SchemaGenerator, options: MigrationBuilderOptions = {}) {
    this.querier = querier;
    this.sqlGenerator = sqlGenerator;
    this.dryRun = options.dryRun ?? false;
  }

  // ============================================================================
  // Table Operations
  // ============================================================================

  async createTable(name: string, callback: (table: ITableBuilder) => void): Promise<void> {
    const builder = new TableBuilder(name);
    callback(builder);

    await this.recordOperation({
      type: 'createTable',
      table: builder.build(),
    });
  }

  async dropTable(name: string, options: { ifExists?: boolean; cascade?: boolean } = {}): Promise<void> {
    await this.recordOperation({
      type: 'dropTable',
      tableName: name,
      ifExists: options.ifExists,
      cascade: options.cascade,
    });
  }

  async renameTable(oldName: string, newName: string): Promise<void> {
    await this.recordOperation({
      type: 'renameTable',
      oldName,
      newName,
    });
  }

  async alterTable(name: string, callback: (table: IAlterTableBuilder) => void): Promise<void> {
    const builder = new AlterTableBuilder(name, this);
    callback(builder);
    // AlterTableBuilder calls migrationBuilder methods directly, so we don't need to do anything else here
  }

  // ============================================================================
  // Column Operations
  // ============================================================================

  async addColumn(tableName: string, columnName: string, callback: (column: IColumnBuilder) => void): Promise<void> {
    // Create a generic column builder, the callback will configure the type
    const builder = new ColumnBuilder(columnName, { category: 'string' });
    callback(builder);

    await this.recordOperation({
      type: 'addColumn',
      tableName,
      column: builder.build(),
    });
  }

  async dropColumn(tableName: string, columnName: string): Promise<void> {
    await this.recordOperation({
      type: 'dropColumn',
      tableName,
      columnName,
    });
  }

  async alterColumn(tableName: string, columnName: string, callback: (column: IColumnBuilder) => void): Promise<void> {
    const builder = new ColumnBuilder(columnName, { category: 'string' });
    callback(builder);

    await this.recordOperation({
      type: 'alterColumn',
      tableName,
      columnName,
      changes: builder.build(),
    });
  }

  async renameColumn(tableName: string, oldName: string, newName: string): Promise<void> {
    await this.recordOperation({
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

    await this.recordOperation({
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
    await this.recordOperation({
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
    await this.recordOperation({
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
    await this.recordOperation({
      type: 'dropForeignKey',
      tableName,
      constraintName,
    });
  }

  // ============================================================================
  // Raw SQL
  // ============================================================================

  async raw(sql: string): Promise<void> {
    const operation: RawSqlOperation = {
      type: 'raw',
      sql,
    };

    this.operations.push(operation);

    if (!this.dryRun && this.querier) {
      await this.querier.run(sql);
    }
  }

  // ============================================================================
  // Operation Access
  // ============================================================================

  getOperations(): AnyMigrationOperation[] {
    return [...this.operations];
  }

  /**
   * Internal method to record an operation and optionally execute it.
   * @internal
   */
  async recordOperation(operation: AnyMigrationOperation): Promise<void> {
    this.operations.push(operation);
    await this.execute(operation);
  }

  /**
   * Internal method to record an operation synchronously (for builders).
   * @internal
   */
  recordOperationSync(operation: AnyMigrationOperation): void {
    this.operations.push(operation);
    // We can't await execution here, but typically builders are used in dry-run or
    // the execution is handled separately. For now, we fire and forget the execute
    // or just don't execute if it's from a sync builder.
    // In our case, createDryRunBuilder sets dryRun: true, so execute does nothing.
    void this.execute(operation);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async execute(operation: AnyMigrationOperation): Promise<void> {
    if (this.dryRun || !this.querier || !this.sqlGenerator) {
      return;
    }

    const sql = this.operationToSql(operation);
    if (sql) {
      await this.querier.run(sql);
    }
  }

  private operationToSql(operation: AnyMigrationOperation): string | undefined {
    if (!this.sqlGenerator) return undefined;

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
 * Create a migration builder for dry-run (recording only).
 */
export function createDryRunBuilder(): MigrationBuilder {
  return new MigrationBuilder(undefined, undefined, { dryRun: true });
}
