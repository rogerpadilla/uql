import type { EntityMeta, FieldOptions, JsonColumnType, NumericColumnType } from '../type/index.js';

const NUMERIC_COLUMN_TYPES = {
  int: true,
  integer: true,
  tinyint: true,
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
  smallserial: true,
  bigserial: true,
} as const satisfies Record<NumericColumnType, true>;

const JSON_COLUMN_TYPES = {
  json: true,
  jsonb: true,
} as const satisfies Record<JsonColumnType, true>;

/**
 * Checks if a field type is numeric (Number, BigInt, or explicit numeric logical types)
 */
export function isNumericType(type: unknown): boolean {
  if (type === Number || type === BigInt) return true;
  if (typeof type === 'string') {
    return type.toLowerCase() in NUMERIC_COLUMN_TYPES;
  }
  return false;
}

/**
 * Checks if a field type is boolean (Boolean, or an explicit boolean logical type)
 */
export function isBooleanType(type: unknown): boolean {
  if (type === Boolean) return true;
  if (typeof type === 'string') {
    const lowered = type.toLowerCase();
    return lowered === 'bool' || lowered === 'boolean';
  }
  return false;
}

/**
 * Checks if a field type is JSON
 */
export function isJsonType(type: unknown): boolean {
  if (typeof type === 'string') {
    return type.toLowerCase() in JSON_COLUMN_TYPES;
  }
  return false;
}

/**
 * Whether the field is the entity's *whole* primary key - the only kind a serial can stand in for,
 * and the only one that may state `PRIMARY KEY` in its own column definition.
 *
 * One column of a composite is a value the caller supplies, and the table states the key over every
 * column at once. Asked in one place because the two schema paths - the AST that builds a
 * `CREATE TABLE` and the diff that builds an `ALTER` - have to answer it the same way, and each
 * answering for itself is what put a serial `PRIMARY KEY` on both columns of a composite.
 */
export function isSoleIdField<E>(meta: EntityMeta<E>, field: FieldOptions): boolean {
  return field.isId === true && meta.ids.length === 1;
}

/**
 * Checks if a field should be treated as auto-incrementing.
 */
export function isAutoIncrement(field: FieldOptions, isPrimaryKey: boolean): boolean {
  if (field.autoIncrement === false) return false;
  if (field.autoIncrement) return true;

  const colType = field.columnType?.toLowerCase();
  if (colType === 'serial' || colType === 'smallserial' || colType === 'bigserial') return true;

  const isNumeric = isNumericType(field.type);
  return isPrimaryKey && isNumeric && !field.onInsert && !field.columnType;
}
