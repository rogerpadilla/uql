/**
 * Table Builder
 *
 * Fluent API for defining tables in migrations.
 */

import type { ForeignKeyAction } from '../../schema/types.js';
import { ColumnBuilder } from './columnBuilder.js';
import { t } from './expressions.js';
import type {
  BaseColumnOptions,
  DecimalColumnOptions,
  IColumnBuilder,
  IndexDefinition,
  ITableBuilder,
  ITableForeignKeyBuilder,
  StringColumnOptions,
  TableDefinition,
  TableForeignKeyDefinition,
  VectorColumnOptions,
} from './types.js';

/**
 * Builder for table-level foreign keys.
 */
class TableForeignKeyBuilder implements ITableForeignKeyBuilder {
  private _columns: string[];
  private _referencesTable?: string;
  private _referencesColumns: string[] = [];
  private _onDelete: ForeignKeyAction = 'NO ACTION';
  private _onUpdate: ForeignKeyAction = 'NO ACTION';
  private _name?: string;

  constructor(columns: string[], _parent: TableBuilder) {
    this._columns = columns;
  }

  references(table: string, columns: string[]): this {
    this._referencesTable = table;
    this._referencesColumns = columns;
    return this;
  }

  onDelete(action: ForeignKeyAction): this {
    this._onDelete = action;
    return this;
  }

  onUpdate(action: ForeignKeyAction): this {
    this._onUpdate = action;
    return this;
  }

  name(name: string): this {
    this._name = name;
    return this;
  }

  /**
   * Build the foreign key definition.
   */
  build(): TableForeignKeyDefinition | undefined {
    if (!this._referencesTable) return undefined;

    return {
      name: this._name,
      columns: this._columns,
      referencesTable: this._referencesTable,
      referencesColumns: this._referencesColumns,
      onDelete: this._onDelete,
      onUpdate: this._onUpdate,
    };
  }
}

/**
 * Builder for table definitions with a fluent API.
 */
export class TableBuilder implements ITableBuilder {
  private _name: string;
  private _columnBuilders: ColumnBuilder[] = [];
  private _primaryKey?: string[];
  private _indexes: IndexDefinition[] = [];
  private _foreignKeyBuilders: TableForeignKeyBuilder[] = [];
  private _comment?: string;

  constructor(name: string) {
    this._name = name;
  }

  // ============================================================================
  // Numeric Types
  // ============================================================================

  id(name = 'id', options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'integer' }, { ...options, primaryKey: true, autoIncrement: true });
    this._columnBuilders.push(col);
    return col;
  }

  integer(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'integer' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  smallint(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'integer', size: 'small' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  bigint(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'integer', size: 'big' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  float(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'float' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  double(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'float', size: 'big' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  decimal(name: string, options: DecimalColumnOptions = {}): IColumnBuilder {
    const { precision, scale, ...rest } = options;
    const col = new ColumnBuilder(name, { category: 'decimal', precision, scale }, rest);
    this._columnBuilders.push(col);
    return col;
  }

  // ============================================================================
  // String Types
  // ============================================================================

  string(name: string, options: StringColumnOptions = {}): IColumnBuilder {
    const { length = 255, ...rest } = options;
    const col = new ColumnBuilder(name, { category: 'string', length }, rest);
    this._columnBuilders.push(col);
    return col;
  }

  char(name: string, options: StringColumnOptions = {}): IColumnBuilder {
    const { length = 1, ...rest } = options;
    const col = new ColumnBuilder(name, { category: 'string', length }, rest);
    this._columnBuilders.push(col);
    return col;
  }

  text(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'string' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  // ============================================================================
  // Boolean
  // ============================================================================

  boolean(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'boolean' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  // ============================================================================
  // Date/Time Types
  // ============================================================================

  date(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'date' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  time(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'time' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  timestamp(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'timestamp' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  timestamptz(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'timestamp', withTimezone: true }, options);
    this._columnBuilders.push(col);
    return col;
  }

  // ============================================================================
  // JSON Types
  // ============================================================================

  json(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'json' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  jsonb(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    // JSONB is the same category, dialect handles the difference
    const col = new ColumnBuilder(name, { category: 'json' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  // ============================================================================
  // Other Types
  // ============================================================================

  uuid(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'uuid' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  blob(name: string, options: BaseColumnOptions = {}): IColumnBuilder {
    const col = new ColumnBuilder(name, { category: 'blob' }, options);
    this._columnBuilders.push(col);
    return col;
  }

  vector(name: string, options: VectorColumnOptions = {}): IColumnBuilder {
    const { dimensions, ...rest } = options;
    const col = new ColumnBuilder(name, { category: 'vector', length: dimensions }, rest);
    this._columnBuilders.push(col);
    return col;
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  createdAt(): IColumnBuilder {
    const col = new ColumnBuilder('createdAt', { category: 'timestamp' }, { defaultValue: t.now() });
    this._columnBuilders.push(col);
    return col;
  }

  updatedAt(): IColumnBuilder {
    const col = new ColumnBuilder('updatedAt', { category: 'timestamp' }, { defaultValue: t.now() });
    this._columnBuilders.push(col);
    return col;
  }

  timestamps(): void {
    this.createdAt();
    this.updatedAt();
  }

  // ============================================================================
  // Indexes & Constraints
  // ============================================================================

  primaryKey(columns: string[]): this {
    this._primaryKey = columns;
    return this;
  }

  unique(columns: string[], name?: string): this {
    const indexName = name ?? `uq_${this._name}_${columns.join('_')}`;
    this._indexes.push({
      name: indexName,
      columns,
      unique: true,
    });
    return this;
  }

  index(columns: string[], name?: string): this {
    const indexName = name ?? `idx_${this._name}_${columns.join('_')}`;
    this._indexes.push({
      name: indexName,
      columns,
      unique: false,
    });
    return this;
  }

  foreignKey(columns: string[]): ITableForeignKeyBuilder {
    const fk = new TableForeignKeyBuilder(columns, this);
    this._foreignKeyBuilders.push(fk);
    return fk;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  comment(text: string): this {
    this._comment = text;
    return this;
  }

  /**
   * Build the table definition.
   */
  build(): TableDefinition {
    // Build all columns from builders
    const columns = this._columnBuilders.map((cb) => cb.build());

    // Collect column-level indexes
    for (const col of columns) {
      if (col.index) {
        const indexName = typeof col.index === 'string' ? col.index : `idx_${this._name}_${col.name}`;

        // Only add if not already in table-level indexes
        if (!this._indexes.some((idx) => idx.name === indexName)) {
          this._indexes.push({
            name: indexName,
            columns: [col.name],
            unique: col.unique,
          });
        }
      }
    }

    // Build foreign keys
    const foreignKeys = this._foreignKeyBuilders
      .map((fk) => fk.build())
      .filter((fk): fk is TableForeignKeyDefinition => fk !== undefined);

    // Collect column-level foreign keys
    for (const col of columns) {
      if (col.foreignKey) {
        foreignKeys.push({
          name: col.foreignKey.name,
          columns: [col.name],
          referencesTable: col.foreignKey.table,
          referencesColumns: col.foreignKey.columns,
          onDelete: col.foreignKey.onDelete,
          onUpdate: col.foreignKey.onUpdate,
        });
      }
    }

    return {
      name: this._name,
      columns,
      primaryKey: this._primaryKey,
      indexes: this._indexes,
      foreignKeys,
      comment: this._comment,
    };
  }
}
