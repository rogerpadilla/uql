/**
 * Column Builder
 *
 * Fluent API for defining columns in migrations.
 */

import type { EnumValues } from '../../schema/types.js';
import { type CanonicalType, DEFAULT_FOREIGN_KEY_ACTION, type ForeignKeyAction } from '../../schema/types.js';
import type { BaseColumnOptions, FullColumnDefinition, IColumnBuilder, IForeignKeyBuilder } from './types.js';

/**
 * Builder for column definitions with a fluent API. Each call replaces the definition it holds, and `build`
 * returns it. Columns are NOT NULL by default (safer).
 */
export class ColumnBuilder implements IColumnBuilder, IForeignKeyBuilder {
  private column: FullColumnDefinition;

  constructor(name: string, type: CanonicalType, options: BaseColumnOptions = {}) {
    const { references } = options;
    this.column = {
      name,
      type: options.unsigned === undefined ? type : { ...type, unsigned: options.unsigned },
      nullable: options.nullable ?? false,
      defaultValue: options.defaultValue,
      isPrimaryKey: options.primaryKey ?? false,
      isAutoIncrement: options.autoIncrement ?? false,
      isUnique: options.unique ?? false,
      enum: undefined,
      generatedAs: undefined,
      comment: options.comment,
      index: options.index,
      foreignKey: references && {
        references: { table: references.table, columns: [references.column ?? 'id'] },
        onDelete: references.onDelete ?? DEFAULT_FOREIGN_KEY_ACTION,
        onUpdate: references.onUpdate ?? DEFAULT_FOREIGN_KEY_ACTION,
      },
    };
  }

  private set(change: Partial<FullColumnDefinition>): this {
    this.column = { ...this.column, ...change };
    return this;
  }

  /**
   * Make the column nullable or not nullable.
   */
  nullable(value = true): this {
    return this.set({ nullable: value });
  }

  /**
   * Make the column NOT NULL.
   */
  notNullable(): this {
    return this.set({ nullable: false });
  }

  /**
   * Set a default value for the column.
   */
  defaultValue(value: unknown): this {
    return this.set({ defaultValue: value });
  }

  /**
   * Mark as primary key.
   */
  primaryKey(): this {
    return this.set({ isPrimaryKey: true, nullable: false });
  }

  /**
   * Enable auto-increment (for integer types).
   */
  autoIncrement(): this {
    return this.set({ isAutoIncrement: true });
  }

  /**
   * Add a unique constraint.
   */
  unique(): this {
    return this.set({ isUnique: true });
  }

  /**
   * Make the column one the database computes: `GENERATED ALWAYS AS (<sql>) STORED`.
   *
   * Takes the SQL as text, since a `CREATE TABLE` has nowhere to bind a value into - the same reason
   * a check expression and a partial-index predicate do.
   */
  computed(sql: string): this {
    return this.set({ generatedAs: sql });
  }

  /**
   * Constrain the column to these values, as a `CHECK (col IN (...))` - what `@Field({ enum })` emits.
   */
  enum(values: EnumValues): this {
    return this.set({ enum: values });
  }

  /**
   * Add a comment to the column.
   */
  comment(text: string): this {
    return this.set({ comment: text });
  }

  /**
   * Add an index on this column.
   * @param name - Optional index name. If true, auto-generates name.
   */
  index(name?: string): this {
    return this.set({ index: name ?? true });
  }

  /**
   * Set as unsigned (MySQL/MariaDB).
   */
  unsigned(): this {
    return this.set({ type: { ...this.column.type, unsigned: true } });
  }

  /**
   * Add a foreign key reference.
   * Returns a ForeignKeyBuilder for additional options.
   */
  references(table: string, column = 'id'): IForeignKeyBuilder {
    return this.set({
      foreignKey: {
        references: { table, columns: [column] },
        onDelete: DEFAULT_FOREIGN_KEY_ACTION,
        onUpdate: DEFAULT_FOREIGN_KEY_ACTION,
      },
    });
  }

  /**
   * Set ON DELETE action for foreign key.
   */
  onDelete(action: ForeignKeyAction): this {
    const { foreignKey } = this.column;
    return foreignKey ? this.set({ foreignKey: { ...foreignKey, onDelete: action } }) : this;
  }

  /**
   * Set ON UPDATE action for foreign key.
   */
  onUpdate(action: ForeignKeyAction): this {
    const { foreignKey } = this.column;
    return foreignKey ? this.set({ foreignKey: { ...foreignKey, onUpdate: action } }) : this;
  }

  /**
   * Build and return the column definition.
   */
  build(): FullColumnDefinition {
    return this.column;
  }
}
