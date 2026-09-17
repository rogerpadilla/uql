import { snakeCase } from '../util/index.js';
import { DefaultNamingStrategy } from './defaultNamingStrategy.js';

/**
 * Naming strategy that converts identifiers to snake_case.
 */
export class SnakeCaseNamingStrategy extends DefaultNamingStrategy {
  override tableName(className: string): string {
    return snakeCase(className);
  }

  override columnName(propertyName: string): string {
    return snakeCase(propertyName);
  }
}
