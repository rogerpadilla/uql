import type { NamingStrategy } from '../type/index.js';

/**
 * Default naming strategy that returns identifiers as-is.
 */
export class DefaultNamingStrategy implements NamingStrategy {
  tableName(className: string): string {
    return className;
  }

  columnName(propertyName: string): string {
    return propertyName;
  }

  joinTableName(source: string, target: string, _propertyName?: string): string {
    return `${source}_${target}`;
  }
}
