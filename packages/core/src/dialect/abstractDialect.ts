import type { EntityMeta, FieldOptions, NamingStrategy, Type } from '../type/index.js';

/**
 * Base abstract class for all database dialects (SQL and NoSQL).
 */
export abstract class AbstractDialect {
  constructor(readonly namingStrategy?: NamingStrategy) {}

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
