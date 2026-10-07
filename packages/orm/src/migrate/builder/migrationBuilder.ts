import type { IndexColumnInput, IndexOptions } from '../../type/index.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { indexDefinition } from '../generator/definitionToNode.js';
import { TableBuilder } from './tableBuilder.js';
import type {
  AnyMigrationOperation,
  ForeignKeyOptions,
  ForeignKeyTarget,
  FullColumnDefinition,
  IAlterTableBuilder,
  IColumnBuilder,
  IColumnFactory,
  IMigrationBuilder,
  ITableBuilder,
} from './types.js';

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

  /** Alters only the column: throws if it declares an index or a foreign key, rather than dropping them. */
  alterColumn(callback: (columns: IColumnFactory) => IColumnBuilder): this {
    const column = buildOneColumn(callback);
    if (column.index || column.foreignKey) {
      throw new UqlUsageError(
        `alterColumn changes '${column.name}' alone: add its index with createIndex, its foreign key with addForeignKey`,
      );
    }
    this.operations.push({ type: 'alterColumn', tableName: this.tableName, changes: column });
    return this;
  }

  addIndex(columns: readonly IndexColumnInput[], options?: IndexOptions): this {
    this.operations.push({
      type: 'createIndex',
      tableName: this.tableName,
      index: indexDefinition(this.tableName, columns, options),
    });
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

  addForeignKey(columns: string[], target: ForeignKeyTarget, options: ForeignKeyOptions = {}): this {
    this.operations.push({
      type: 'addForeignKey',
      tableName: this.tableName,
      foreignKey: { ...options, columns, references: target },
    });
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

/**
 * The type-safe migration builder: each change is declared once, as an operation handed to `apply`.
 * `migrationBuilderFor` builds one running the statements its querier's generator writes for each.
 */
export class MigrationBuilder implements IMigrationBuilder {
  constructor(private readonly apply: (operation: AnyMigrationOperation) => Promise<void>) {}

  createTable(name: string, callback: (table: ITableBuilder) => void): Promise<void> {
    const builder = new TableBuilder(name);
    callback(builder);
    return this.apply({ type: 'createTable', table: builder.build() });
  }

  dropTable(name: string, options: { ifExists?: boolean; cascade?: boolean } = {}): Promise<void> {
    return this.apply({ type: 'dropTable', tableName: name, ifExists: options.ifExists, cascade: options.cascade });
  }

  renameTable(oldName: string, newName: string): Promise<void> {
    return this.apply({ type: 'renameTable', oldName, newName });
  }

  async alterTable(name: string, callback: (table: IAlterTableBuilder) => void): Promise<void> {
    const table = new AlterTableBuilder(name);
    callback(table);
    for (const operation of table.operations) {
      await this.apply(operation);
    }
  }

  // Each single change delegates to `alterTable`, so each operation is implemented only once.
  addColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void> {
    return this.alterTable(tableName, (table) => table.addColumn(callback));
  }

  dropColumn(tableName: string, columnName: string): Promise<void> {
    return this.alterTable(tableName, (table) => table.dropColumn(columnName));
  }

  alterColumn(tableName: string, callback: (columns: IColumnFactory) => IColumnBuilder): Promise<void> {
    return this.alterTable(tableName, (table) => table.alterColumn(callback));
  }

  renameColumn(tableName: string, oldName: string, newName: string): Promise<void> {
    return this.alterTable(tableName, (table) => table.renameColumn(oldName, newName));
  }

  createIndex(tableName: string, columns: readonly IndexColumnInput[], options?: IndexOptions): Promise<void> {
    return this.alterTable(tableName, (table) => table.addIndex(columns, options));
  }

  dropIndex(tableName: string, indexName: string): Promise<void> {
    return this.alterTable(tableName, (table) => table.dropIndex(indexName));
  }

  addForeignKey(
    tableName: string,
    columns: string[],
    target: ForeignKeyTarget,
    options?: ForeignKeyOptions,
  ): Promise<void> {
    return this.alterTable(tableName, (table) => table.addForeignKey(columns, target, options));
  }

  dropForeignKey(tableName: string, constraintName: string): Promise<void> {
    return this.alterTable(tableName, (table) => table.dropForeignKey(constraintName));
  }

  raw(sql: string): Promise<void> {
    return this.apply({ type: 'raw', sql });
  }
}
