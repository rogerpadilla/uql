/**
 * Table Builder
 *
 * Fluent API for defining tables in migrations.
 */

import type { CanonicalType, ForeignKeyAction } from '../../schema/types.js';
import type { IndexColumnInput, IndexOptions, IndexSchema } from '../../type/index.js';
import { ddlText, normalizeIndexColumn } from '../../util/index.js';
import { derivedIndexName } from '../../util/sql.util.js';
import { ColumnBuilder } from './columnBuilder.js';
import { expr } from './expressions.js';
import type {
  BaseColumnOptions,
  DecimalColumnOptions,
  IColumnBuilder,
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
  private _indexes: IndexSchema[] = [];
  private _foreignKeyBuilders: TableForeignKeyBuilder[] = [];
  private _comment?: string;

  constructor(name: string) {
    this._name = name;
  }

  id(name = 'id', options: BaseColumnOptions = {}): IColumnBuilder {
    return this.add(name, { category: 'integer' }, { ...options, primaryKey: true, autoIncrement: true });
  }

  integer(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'integer' }, options);
  }

  smallint(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'integer', size: 'small' }, options);
  }

  bigint(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'integer', size: 'big' }, options);
  }

  float(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'float' }, options);
  }

  double(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'float', size: 'big' }, options);
  }

  decimal(name: string, options: DecimalColumnOptions = {}): IColumnBuilder {
    const { precision, scale, ...rest } = options;
    return this.add(name, { category: 'decimal', precision, scale }, rest);
  }

  string(name: string, options: StringColumnOptions = {}): IColumnBuilder {
    const { length = 255, ...rest } = options;
    return this.add(name, { category: 'string', length }, rest);
  }

  char(name: string, options: StringColumnOptions = {}): IColumnBuilder {
    const { length = 1, ...rest } = options;
    return this.add(name, { category: 'string', length }, rest);
  }

  text(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'string' }, options);
  }

  boolean(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'boolean' }, options);
  }

  date(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'date' }, options);
  }

  time(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'time' }, options);
  }

  timestamp(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'timestamp' }, options);
  }

  timestamptz(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'timestamp', withTimezone: true }, options);
  }

  json(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'json' }, options);
  }

  /** One canonical json category; the dialect decides between `JSON` and `JSONB`. */
  jsonb(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'json' }, options);
  }

  uuid(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'uuid' }, options);
  }

  blob(name: string, options?: BaseColumnOptions): IColumnBuilder {
    return this.add(name, { category: 'blob' }, options);
  }

  vector(name: string, options: VectorColumnOptions = {}): IColumnBuilder {
    const { dimensions, ...rest } = options;
    return this.add(name, { category: 'vector', length: dimensions }, rest);
  }

  private add(name: string, type: CanonicalType, options: BaseColumnOptions = {}): IColumnBuilder {
    const column = new ColumnBuilder(name, type, options);
    this._columnBuilders.push(column);
    return column;
  }

  createdAt(): IColumnBuilder {
    return this.timestampNow('createdAt');
  }

  updatedAt(): IColumnBuilder {
    return this.timestampNow('updatedAt');
  }

  private timestampNow(name: string): IColumnBuilder {
    return this.add(name, { category: 'timestamp' }, { defaultValue: expr.now() });
  }

  timestamps(): void {
    this.createdAt();
    this.updatedAt();
  }

  primaryKey(columns: string[]): this {
    this._primaryKey = columns;
    return this;
  }

  unique(columns: readonly IndexColumnInput[], options?: string | IndexOptions): this {
    return this.addIndex(columns, options, true);
  }

  index(columns: readonly IndexColumnInput[], options?: string | IndexOptions): this {
    return this.addIndex(columns, options, false);
  }

  /**
   * `@Index` and `table.index(...)` differ only in how the name is defaulted, so both normalize their
   * entries here: the generator renders expressions and per-column modifiers from the normalized
   * form, and anything left as a bare string would reach it as a column literally named `[object
   * Object]`.
   */
  private addIndex(
    columns: readonly IndexColumnInput[],
    options: string | IndexOptions | undefined,
    unique: boolean,
  ): this {
    const { name, ...rest } = typeof options === 'string' ? { name: options } : (options ?? {});
    const entries = columns.map(normalizeIndexColumn);
    this._indexes.push({
      ...rest,
      name:
        name ??
        derivedIndexName(
          this._name,
          entries.map((entry) => entry.column),
          unique,
        ),
      where: ddlText(rest.where, 'a partial-index predicate'),
      entries,
      unique,
    });
    return this;
  }

  foreignKey(columns: string[]): ITableForeignKeyBuilder {
    const fk = new TableForeignKeyBuilder(columns, this);
    this._foreignKeyBuilders.push(fk);
    return fk;
  }

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
        const indexName = typeof col.index === 'string' ? col.index : derivedIndexName(this._name, [col.name]);

        // Only add if not already in table-level indexes
        if (!this._indexes.some((idx) => idx.name === indexName)) {
          this._indexes.push({
            name: indexName,
            entries: [{ column: col.name }],
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
