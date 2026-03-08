/**
 * Column Builder
 *
 * Fluent API for defining columns in migrations.
 */

import type { CanonicalType, ForeignKeyAction } from '../../schema/types.js';
import type {
  BaseColumnOptions,
  ForeignKeyDefinition,
  FullColumnDefinition,
  IColumnBuilder,
  IForeignKeyBuilder,
} from './types.js';

/**
 * Builder for column definitions with a fluent API.
 * Columns are NOT NULL by default (safer).
 */
export class ColumnBuilder implements IColumnBuilder, IForeignKeyBuilder {
  private _name: string;
  private _type: CanonicalType;
  private _nullable: boolean;
  private _defaultValue?: unknown;
  private _primaryKey: boolean;
  private _autoIncrement: boolean;
  private _unique: boolean;
  private _comment?: string;
  private _index?: string | boolean;
  private _foreignKey?: ForeignKeyDefinition;

  constructor(name: string, type: CanonicalType, options: BaseColumnOptions = {}) {
    this._name = name;
    this._type = type;
    // Apply options with defaults (non-nullable by default)
    this._nullable = options.nullable ?? false;
    this._unique = options.unique ?? false;
    this._primaryKey = options.primaryKey ?? false;
    this._autoIncrement = options.autoIncrement ?? false;
    this._defaultValue = options.defaultValue;
    this._index = options.index;
    this._comment = options.comment;
    if (options.unsigned !== undefined) {
      this._type = { ...this._type, unsigned: options.unsigned };
    }

    // Handle inline references option
    if (options.references) {
      this._foreignKey = {
        table: options.references.table,
        columns: [options.references.column ?? 'id'],
        onDelete: options.references.onDelete ?? 'NO ACTION',
        onUpdate: options.references.onUpdate ?? 'NO ACTION',
      };
    }
  }

  /**
   * Make the column nullable or not nullable.
   */
  nullable(value = true): this {
    this._nullable = value;
    return this;
  }

  /**
   * Make the column NOT NULL.
   */
  notNullable(): this {
    this._nullable = false;
    return this;
  }

  /**
   * Set a default value for the column.
   */
  defaultValue(value: unknown): this {
    this._defaultValue = value;
    return this;
  }

  /**
   * Mark as primary key.
   */
  primaryKey(): this {
    this._primaryKey = true;
    this._nullable = false;
    return this;
  }

  /**
   * Enable auto-increment (for integer types).
   */
  autoIncrement(): this {
    this._autoIncrement = true;
    return this;
  }

  /**
   * Add a unique constraint.
   */
  unique(): this {
    this._unique = true;
    return this;
  }

  /**
   * Add a comment to the column.
   */
  comment(text: string): this {
    this._comment = text;
    return this;
  }

  /**
   * Add an index on this column.
   * @param name - Optional index name. If true, auto-generates name.
   */
  index(name?: string): this {
    this._index = name ?? true;
    return this;
  }
  /**
   * Set as unsigned (MySQL/MariaDB).
   */
  unsigned(): this {
    this._type = { ...this._type, unsigned: true };
    return this;
  }

  /**
   * Add a foreign key reference.
   * Returns a ForeignKeyBuilder for additional options.
   */
  references(table: string, column = 'id'): IForeignKeyBuilder {
    this._foreignKey = {
      table,
      columns: [column],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    };
    return this;
  }

  /**
   * Set ON DELETE action for foreign key.
   */
  onDelete(action: ForeignKeyAction): this {
    if (this._foreignKey) {
      this._foreignKey.onDelete = action;
    }
    return this;
  }

  /**
   * Set ON UPDATE action for foreign key.
   */
  onUpdate(action: ForeignKeyAction): this {
    if (this._foreignKey) {
      this._foreignKey.onUpdate = action;
    }
    return this;
  }

  /**
   * Build and return the column definition.
   */
  build(): FullColumnDefinition {
    return {
      name: this._name,
      type: this._type,
      nullable: this._nullable,
      defaultValue: this._defaultValue,
      primaryKey: this._primaryKey,
      autoIncrement: this._autoIncrement,
      unique: this._unique,
      comment: this._comment,
      index: this._index,
      foreignKey: this._foreignKey,
    };
  }
}
