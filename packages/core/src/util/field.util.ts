import type { ColumnType, FieldOptions } from '../type/index.js';

const NUMERIC_COLUMN_TYPES = new Set<ColumnType>([
  'int',
  'bigint',
  'smallint',
  'decimal',
  'numeric',
  'float',
  'real',
  'double',
]);

/**
 * Checks if a field type is numeric (Number, BigInt, or explicit numeric logical types)
 */
export function isNumericType(type: any): boolean {
  if (type === Number || type === BigInt) return true;
  if (typeof type === 'string') {
    return NUMERIC_COLUMN_TYPES.has(type.toLowerCase() as ColumnType);
  }
  return false;
}

/**
 * Checks if a field should be treated as auto-incrementing.
 * By default, only numeric primary keys without custom handlers or explicit column types are auto-incremented.
 */
export function isAutoIncrement(field: FieldOptions, isPrimaryKey: boolean): boolean {
  const isNumeric = isNumericType(field.type);
  return isPrimaryKey && isNumeric && field.autoIncrement !== false && !field.onInsert && !field.columnType;
}
