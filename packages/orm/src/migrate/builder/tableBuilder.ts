/**
 * Table Builder
 *
 * Fluent API for defining tables in migrations.
 */

import type { CanonicalType, ForeignKeyAction } from '../../schema/types.js';
import type { ForeignKeySchema, IndexColumnInput, IndexOptions } from '../../type/index.js';
import { DATE_PRECISION } from '../../util/date.js';
import { declaredIndexName } from '../../util/ddlExpression.util.js';
import { currentTimestamp } from '../../util/sql.js';
import { columnForeignKey, columnIndex, indexDefinition } from '../generator/definitionToNode.js';
import { ColumnDefinitionBuilder } from './columnBuilder.js';
import type {
  BaseColumnOptions,
  DecimalColumnOptions,
  ColumnBuilder,
  TableBuilder,
  TableForeignKeyBuilder,
  IndexDefinition,
  StringColumnOptions,
  TableDefinition,
  VectorColumnOptions,
} from './types.js';

/** Normalizes `table.index` options, where a bare string is the index name. */
function namedOptions(options?: string | IndexOptions): IndexOptions {
  return typeof options === 'string' ? { name: options } : (options ?? {});
}

/**
 * Builder for table-level foreign keys.
 */
class TableForeignKeyDefinitionBuilder implements TableForeignKeyBuilder {
  private _referencedTable?: string;
  private _referencedColumns: string[] = [];
  private _onDelete?: ForeignKeyAction;
  private _onUpdate?: ForeignKeyAction;
  private _name?: string;

  constructor(private readonly _columns: string[]) {}

  references(table: string, columns: string[]): this {
    this._referencedTable = table;
    this._referencedColumns = columns;
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
  build(): ForeignKeySchema | undefined {
    if (!this._referencedTable) return undefined;

    return {
      name: this._name,
      columns: this._columns,
      references: { table: this._referencedTable, columns: this._referencedColumns },
      onDelete: this._onDelete,
      onUpdate: this._onUpdate,
    };
  }
}

/**
 * Builder for table definitions with a fluent API.
 */
export class TableDefinitionBuilder implements TableBuilder {
  private _name: string;
  private _columnBuilders: ColumnDefinitionBuilder[] = [];
  private _primaryKey?: string[];
  private _indexes: IndexDefinition[] = [];
  private _foreignKeyBuilders: TableForeignKeyDefinitionBuilder[] = [];
  private _comment?: string;

  constructor(name: string) {
    this._name = name;
  }

  /** Big, matching an entity's `@Id`: a key is spelled from this type, so it has to state the real one. */
  id(name = 'id', options: BaseColumnOptions = {}): ColumnBuilder {
    return this.add(name, { category: 'integer', size: 'big' }, { ...options, primaryKey: true, autoIncrement: true });
  }

  integer(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'integer' }, options);
  }

  smallint(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'integer', size: 'small' }, options);
  }

  bigint(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'integer', size: 'big' }, options);
  }

  float(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'float' }, options);
  }

  double(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'float', size: 'big' }, options);
  }

  decimal(name: string, options: DecimalColumnOptions = {}): ColumnBuilder {
    const { precision, scale, ...rest } = options;
    return this.add(name, { category: 'decimal', precision, scale }, rest);
  }

  string(name: string, options: StringColumnOptions = {}): ColumnBuilder {
    const { length = 255, ...rest } = options;
    return this.add(name, { category: 'string', length }, rest);
  }

  char(name: string, options: StringColumnOptions = {}): ColumnBuilder {
    const { length = 1, ...rest } = options;
    return this.add(name, { category: 'string', length }, rest);
  }

  text(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'string' }, options);
  }

  boolean(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'boolean' }, options);
  }

  date(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'date' }, options);
  }

  time(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'time' }, options);
  }

  timestamp(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'timestamp', precision: DATE_PRECISION }, options);
  }

  timestamptz(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'timestamp', withTimezone: true, precision: DATE_PRECISION }, options);
  }

  json(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'json' }, options);
  }

  /** One canonical json category; the dialect decides between `JSON` and `JSONB`. */
  jsonb(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'json' }, options);
  }

  uuid(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'uuid' }, options);
  }

  blob(name: string, options?: BaseColumnOptions): ColumnBuilder {
    return this.add(name, { category: 'blob' }, options);
  }

  vector(name: string, options: VectorColumnOptions = {}): ColumnBuilder {
    const { dimensions, ...rest } = options;
    return this.add(name, { category: 'vector', length: dimensions }, rest);
  }

  private add(name: string, type: CanonicalType, options: BaseColumnOptions = {}): ColumnBuilder {
    const column = new ColumnDefinitionBuilder(name, type, options);
    this._columnBuilders.push(column);
    return column;
  }

  createdAt(): ColumnBuilder {
    return this.timestampNow('createdAt');
  }

  updatedAt(): ColumnBuilder {
    return this.timestampNow('updatedAt');
  }

  private timestampNow(name: string): ColumnBuilder {
    return this.timestamptz(name, { defaultValue: currentTimestamp });
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
    this._indexes.push(indexDefinition(columns, { ...namedOptions(options), unique: true }, true));
    return this;
  }

  index(columns: readonly IndexColumnInput[], options?: string | IndexOptions): this {
    this._indexes.push(indexDefinition(columns, namedOptions(options)));
    return this;
  }

  foreignKey(columns: string[]): TableForeignKeyBuilder {
    const fk = new TableForeignKeyDefinitionBuilder(columns);
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

    // Collect column-level indexes, skipping one a table-level index already names.
    const taken = new Set(
      this._indexes
        .filter((idx) => idx.where === undefined)
        .map((idx) => declaredIndexName(idx.name, this._name, idx.entries, { unique: idx.uniqueName })),
    );
    for (const col of columns) {
      const index = columnIndex(this._name, col);
      if (index && !taken.has(index.name)) {
        this._indexes.push(index);
        taken.add(index.name);
      }
    }

    // Build foreign keys
    const foreignKeys = this._foreignKeyBuilders
      .map((fk) => fk.build())
      .filter((fk): fk is ForeignKeySchema => fk !== undefined);

    // Collect column-level foreign keys
    for (const col of columns) {
      const foreignKey = columnForeignKey(col);
      if (foreignKey) {
        foreignKeys.push(foreignKey);
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
