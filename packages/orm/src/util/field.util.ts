import {
  type ColumnFamily,
  COLUMN_TYPES,
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type NumericColumnType,
  type StampEvent,
  RelationAggregate,
  type RelationAggregateSpec,
} from '../type/index.js';
import { definedEntries, getKeys } from './object.util.js';

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
  return field.computed !== undefined && !field.stored;
}

/** Whether the entity puts anything on its table the database runs: an authored trigger, or a stamp. */
export function hasTriggers<E>(meta: EntityMeta<E>): boolean {
  return Boolean(meta.triggers?.length) || definedEntries(meta.fields).some(([, field]) => stampEvents(field));
}

/**
 * The events the database writes this field on, or `undefined` where it is not a stamp. A stamp is a
 * real column the engine fills on each event, which is how an expression too volatile for a generated
 * column - `now()` - is still kept by the database rather than by whoever happens to write the row.
 */
export function stampEvents(field: FieldOptions): readonly StampEvent[] | undefined {
  return Array.isArray(field.stored) ? field.stored : undefined;
}

/**
 * The relation aggregate a field computes, where it computes one rather than writing SQL: what it
 * reads, off which relation, narrowed and capped how. Every engine renders it from this - a correlated
 * subquery on SQL, a lookup on MongoDB - so both read the same declaration rather than parsing SQL.
 */
export function aggregateOf(field: FieldOptions | undefined): RelationAggregateSpec | undefined {
  const computed = field?.computed;
  return computed instanceof RelationAggregate ? computed.spec : undefined;
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

/**
 * The fields a read answers with where it names none. A relation aggregate is left out unless it asks
 * for `eager: true`: it reads the related rows, which is what a relation does, and a relation is loaded
 * only when a query asks for it. Naming one in `$select` reads it, whatever the default.
 */
export function getFieldKeys<E>(fields: {
  [K in FieldKey<E>]?: FieldOptions;
}): FieldKey<E>[] {
  return getKeys(fields).filter((field) => fields[field]!.eager ?? !aggregateOf(fields[field]));
}
