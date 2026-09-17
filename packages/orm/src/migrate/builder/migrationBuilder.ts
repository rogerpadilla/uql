import type { ForeignKeyAction } from '../../schema/types.js';
import type { IndexColumnInput, IndexOptions } from '../../type/index.js';
import type { SchemaGenerator } from '../../type/migration.js';
import { indexNameParts, normalizeIndexColumn } from '../../util/index.js';
import { derivedIndexName } from '../../util/sql.util.js';
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
      name: name ?? derivedIndexName(tableName, indexNameParts(entries)),
      entries,
      unique: unique ?? false,
    },
  };
}

type ForeignKeyTarget = { table: string; columns: string[] };
type ForeignKeyOptions = { name?: string; onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction };

/** An `addForeignKey` operation, `NO ACTION` defaults included, for the three builders that record one. */
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
      references: { table: target.table, columns: target.columns },
      onDelete: options.onDelete ?? 'NO ACTION',
      onUpdate: options.onUpdate ?? 'NO ACTION',
    },
  };
}

/** One column declared through `createTable`'s vocabulary, a throwaway {@link TableBuilder}, so its type is stated. */
function buildOneColumn(callback: (columns: IColumnFactory) => IColumnBuilder): FullColumnDefinition {
  return callback(new TableBuilder('')).build();
}

/** The operations one `alterTable` callback declares, collected in order, since its methods are synchronous. */
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
 * Records each operation, then runs the statements `generator` writes for it through `run`. Build one
 * for a querier with `migrationBuilderFor`.
 */
export class MigrationBuilder extends OperationRecorder {
  constructor(
    private readonly generator: SchemaGenerator,
    private readonly run: (statement: string) => Promise<unknown>,
  ) {
    super();
  }

  protected override async record(operation: AnyMigrationOperation): Promise<void> {
    await super.record(operation);
    for (const statement of this.generator.generateOperation(operation)) {
      await this.run(statement);
    }
  }
}
