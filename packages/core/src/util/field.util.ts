import type { FieldOptions } from '../type/index.js';

/**
 * Checks if a field type is numeric (Number or BigInt)
 */
export function isNumericType(type: any): boolean {
  return type === Number || type === BigInt;
}

/**
 * Checks if a field should be treated as auto-incrementing.
 * By default, only numeric primary keys without custom handlers or explicit column types are auto-incremented.
 */
export function isAutoIncrement(field: FieldOptions, isPrimaryKey: boolean): boolean {
  const isNumeric = isNumericType(field.type);
  return isPrimaryKey && isNumeric && field.autoIncrement !== false && !field.onInsert && !field.columnType;
}
