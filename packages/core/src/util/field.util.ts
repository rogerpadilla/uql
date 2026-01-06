import type { FieldOptions, JsonColumnType, NumericColumnType } from '../type/index.js';

const NUMERIC_COLUMN_TYPES = {
  int: true,
  smallint: true,
  bigint: true,
  float: true,
  float4: true,
  float8: true,
  double: true,
  'double precision': true,
  decimal: true,
  numeric: true,
  real: true,
  serial: true,
  bigserial: true,
} as const satisfies Record<NumericColumnType, true>;

const JSON_COLUMN_TYPES = {
  json: true,
  jsonb: true,
} as const satisfies Record<JsonColumnType, true>;

/**
 * Checks if a field type is numeric (Number, BigInt, or explicit numeric logical types)
 */
export function isNumericType(type: any): boolean {
  if (type === Number || type === BigInt) return true;
  if (typeof type === 'string') {
    return type.toLowerCase() in NUMERIC_COLUMN_TYPES;
  }
  return false;
}

/**
 * Checks if a field type is JSON
 */
export function isJsonType(type: any): boolean {
  if (typeof type === 'string') {
    return type.toLowerCase() in JSON_COLUMN_TYPES;
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
