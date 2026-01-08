import { DEFAULT_FOREIGN_KEY_ACTION, type ForeignKeyAction } from '../schema/types.js';
import type { Dialect, EntityMeta, FieldOptions, NamingStrategy, Type } from '../type/index.js';
import { type DialectConfig, getDialectConfig } from './dialectConfig.js';

/**
 * Base abstract class for all database dialects (SQL and NoSQL).
 */
export abstract class AbstractDialect {
  protected readonly config: DialectConfig;

  constructor(
    readonly dialect: Dialect,
    readonly namingStrategy?: NamingStrategy,
    readonly defaultForeignKeyAction: ForeignKeyAction = DEFAULT_FOREIGN_KEY_ACTION,
  ) {
    this.config = getDialectConfig(dialect);
  }

  /**
   * Resolve the table name for an entity, applying naming strategy if necessary.
   */
  resolveTableName<E>(entity: Type<E>, meta: EntityMeta<E>): string {
    if (meta.name !== entity.name || !this.namingStrategy) {
      return meta.name;
    }
    return this.namingStrategy.tableName(meta.name);
  }

  /**
   * Resolve the column/field name for a property, applying naming strategy if necessary.
   */
  resolveColumnName(key: string, field: FieldOptions): string {
    if (!field || field.name !== key || !this.namingStrategy) {
      return field?.name ?? key;
    }
    return this.namingStrategy.columnName(field.name);
  }
}
