import {
  type ColumnFamily,
  COLUMN_TYPES,
  type EntityMeta,
  type FieldOptions,
  type NumericColumnType,
} from '../type/index.js';
import { getKeys } from './object.util.js';

// Constructors and type strings in one map: a logical type is either, and every caller asks the same
// question of both.
const FAMILY_OF = new Map<unknown, ColumnFamily>([
  [String, 'string'],
  [Number, 'numeric'],
  [BigInt, 'numeric'],
  [Boolean, 'boolean'],
  [Date, 'date'],
  ...getKeys(COLUMN_TYPES).flatMap((family) => COLUMN_TYPES[family].map((type) => [type, family] as const)),
]);

/** The family of a logical field type, or `undefined` where it names none. */
export function columnFamily(type: unknown): ColumnFamily | undefined {
  return FAMILY_OF.get(typeof type === 'string' ? type.toLowerCase() : type);
}

/** The numeric column types that hold whole numbers. */
const INTEGER_COLUMN_TYPES: ReadonlySet<string> = new Set<NumericColumnType>([
  'int',
  'integer',
  'tinyint',
  'smallint',
  'bigint',
]);

/**
 * Whether a field's column holds whole numbers: a declared integer type, or a `Number` or `BigInt`
 * with no scale, which every engine here stores as BIGINT.
 */
export function isIntegerColumn(field: Pick<FieldOptions, 'type' | 'columnType' | 'precision' | 'scale'>): boolean {
  const type = field.columnType ?? field.type;
  if (typeof type === 'string') {
    return INTEGER_COLUMN_TYPES.has(type.toLowerCase());
  }
  return type === BigInt || (type === Number && !field.precision && !field.scale);
}

/**
 * Whether the field's expression is spliced into each statement that reads it, rather than stored.
 * Every read site asks this - the DDL skip, the projection, the `$where` and `ORDER BY` operands -
 * because an inlined field has no column to name, while a stored one is read like any other.
 */
export function isInlinedExpression<F extends FieldOptions>(field: F): field is F & Required<Pick<F, 'computed'>> {
  return field.computed !== undefined && field.stored !== true;
}

/**
 * Whether the database supplies this field's value, so no insert or update may write it: a stored
 * computed column *is* a real column, read like one, but writing to it is an error on every engine.
 */
export function isDatabaseWritten(field: FieldOptions): boolean {
  return field.computed !== undefined;
}

/** Whether the field is the whole primary key, the only kind a serial stands for and a column may declare. */
export function isSoleIdField<E>(meta: EntityMeta<E>, field: FieldOptions): boolean {
  return field.isId === true && meta.ids.length === 1;
}

/**
 * Whether the database generates this column's value: a numeric key nothing else fills. `onInsert` fills
 * it from the application and `references` from the row it shares its key with; a `columnType` only
 * states its width. The one answer the create statement and the diff both read.
 */
export function isAutoIncrement(field: FieldOptions, isPrimaryKey: boolean): boolean {
  if (field.autoIncrement !== undefined) return field.autoIncrement;
  return isPrimaryKey && columnFamily(field.type) === 'numeric' && !field.onInsert && !field.references;
}
