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

  get insertIdStrategy() {
    return this.config.insertIdStrategy;
  }

  get features() {
    return this.config.features;
  }

  /**
   * Resolve the table name for an entity, applying naming strategy if necessary.
   */
  resolveTableName<E>(entity: Type<E>, meta: EntityMeta<E>): string {
    const name = meta.name ?? entity.name;
    if (name !== entity.name || !this.namingStrategy) {
      return name;
    }
    return this.namingStrategy.tableName(name);
  }

  /**
   * Resolve the column/field name for a property, applying naming strategy if necessary.
   */
  resolveColumnName(key: string, field: FieldOptions | undefined): string {
    if (!field || field.name !== key || !this.namingStrategy) {
      return field?.name ?? key;
    }
    return this.namingStrategy.columnName(field.name);
  }
}
