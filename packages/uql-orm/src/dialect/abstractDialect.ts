import type { DialectFeatures, DialectName, EntityMeta, FieldOptions, NamingStrategy, Type } from '../type/index.js';

/**
 * Options for initializing a dialect.
 */
export interface DialectOptions {
  readonly namingStrategy?: NamingStrategy;
  readonly driverCapabilities?: Partial<DialectFeatures>;
}

/**
 * Merge dialect capability defaults with optional overrides from {@link DialectOptions.driverCapabilities}.
 */
export function mergeDialectFeatures(defaults: DialectFeatures, patch?: Partial<DialectFeatures>): DialectFeatures {
  return patch ? { ...defaults, ...patch } : defaults;
}

/**
 * Base abstract class for all database dialects (SQL and NoSQL).
 */
export abstract class AbstractDialect {
  abstract readonly dialectName: DialectName;

  abstract readonly insertIdStrategy: 'first' | 'last';
  readonly namingStrategy: NamingStrategy | undefined;
  readonly features: DialectFeatures;

  constructor(
    featureDefaults: DialectFeatures,
    protected readonly options: DialectOptions = {},
  ) {
    this.namingStrategy = options.namingStrategy;
    this.features = mergeDialectFeatures(featureDefaults, options.driverCapabilities);
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
