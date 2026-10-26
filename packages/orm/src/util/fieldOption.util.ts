import {
  type BooleanColumnType,
  type ColumnFamily,
  type FieldOptions,
  type NumericColumnType,
  QuerySql,
  type StringColumnType,
  type TsTypeOf,
} from '../type/index.js';
import { columnFamily, fieldFamily, isInlinedExpression } from './field.util.js';
import { getKeys } from './object.util.js';
import { constantSql } from './sql.js';

/**
 * The column families each field option means anything on, or `'*'` where it applies to every column.
 * Exhaustive over {@link FieldOptions}, so a new option cannot be added without placing it - the
 * discipline `INDEX_FEATURE_LABELS` uses for index features.
 */
const FIELD_OPTION_FAMILY = {
  name: '*',
  isId: '*',
  type: '*',
  dimensions: 'vector',
  distance: 'vector',
  references: '*',
  onDelete: '*',
  enum: '*',
  schema: 'json',
  computed: '*',
  stored: '*',
  updatable: '*',
  eager: '*',
  onInsert: '*',
  onUpdate: '*',
  softDelete: '*',
  version: 'numeric',
  columnType: '*',
  length: 'string',
  // A decimal's digits, or a timestamp's fractional-second digits.
  precision: ['numeric', 'date'],
  scale: 'numeric',
  nullable: '*',
  unique: '*',
  defaultValue: '*',
  autoIncrement: 'numeric',
  index: '*',
  comment: '*',
} as const satisfies Record<keyof FieldOptions, ColumnFamily | '*' | readonly ColumnFamily[]>;

/**
 * The only options an inlined computed field reaches: it is skipped in DDL and dropped from every insert and
 * update, so the whole persistence half of the options above is dead on one. Stated as what survives
 * rather than on each option that dies, because it is one fact rather than nineteen - and because an
 * option added without a thought then lands on the safe side of it.
 */
const INLINE_READS = [
  'type',
  'computed',
  'stored',
  'enum',
  'eager',
  'distance',
  'nullable',
] as const satisfies readonly (keyof FieldOptions)[];

/** Every option that decides what a column holds, or whether it is written at all. */
export const VALUE_DECIDERS = [
  'updatable',
  'onInsert',
  'onUpdate',
  'softDelete',
  'defaultValue',
  'autoIncrement',
] as const satisfies readonly (keyof FieldOptions)[];

/**
 * What a column the *database* writes cannot use. A stored computed column is a real column - it has
 * DDL, an index, a comment, a name - so only the write half is dead on one: the engine fills it, and
 * `GENERATED ALWAYS AS` and `DEFAULT` are mutually exclusive on every engine that has both.
 */
const GENERATED_WRITES = [...VALUE_DECIDERS, 'version'] as const;

/**
 * What an optimistic lock cannot use: the querier writes the column on every update and matches the
 * value the payload carried, so anything else deciding it would be fighting that, and the three that
 * would make it another kind of column entirely. Its `DEFAULT 0` is implied.
 */
const VERSION_WRITES = [...VALUE_DECIDERS, 'computed', 'stored', 'isId'] as const;

/**
 * What bounds a type: stated separately where uql spells the type, and part of the text where the
 * engine's own is written out, which renders verbatim and leaves these unread.
 */
export const TYPE_BOUNDS = [
  'length',
  'precision',
  'scale',
  'dimensions',
] as const satisfies readonly (keyof FieldOptions)[];

/** Whatever leaves `key` unread, named for the message, or `undefined` where the field reads it. */
function deadOn(opts: FieldOptions, key: keyof FieldOptions): string | undefined {
  if (isInlinedExpression(opts) && !INLINE_READS.some((read) => read === key)) return 'an inlined computed field';
  if (opts.stored && GENERATED_WRITES.some((write) => write === key)) return 'a column the database writes';
  if (opts.isId === true && key === 'nullable') return 'a primary key';
  if (opts.updatable === false && key === 'onUpdate') return "a field declared 'updatable: false'";
  if (opts.columnType instanceof QuerySql && TYPE_BOUNDS.some((bound) => bound === key)) {
    return 'a column type written out as SQL, which carries its own bounds';
  }
  if (opts.version === true && (VERSION_WRITES.some((write) => write === key) || key === 'nullable')) {
    return 'a version field';
  }
  return undefined;
}

/**
 * The first option `opts` cannot use, phrased as the tail of `'Entity.field' ...`, or `undefined`
 * where every option applies. The runtime half of the decorators' check, so plain JavaScript reaches
 * the same answer.
 */
export function fieldOptionConflict(opts: FieldOptions): string | undefined {
  // Caught here rather than where the type is resolved, which is a migration on most engines and a
  // query on SQL Server, and which knows no field to name.
  if (opts.columnType instanceof QuerySql && constantSql(opts.columnType) === undefined) {
    return "cannot use 'columnType': a `sql` one names a constant type, so it can bind no value and read no column";
  }
  const stray = enumStray(opts);
  if (stray) {
    return stray;
  }
  const family = fieldFamily(opts);
  // Walked in table order, not in the order the field happened to be written, so a field with two
  // conflicts always reports the same one. An option no rule knows is a typo, which `@Field`'s own check
  // reports where it can still be spelled right.
  for (const key of getKeys(FIELD_OPTION_FAMILY)) {
    const applies: readonly (ColumnFamily | '*')[] = [FIELD_OPTION_FAMILY[key]].flat();
    if (opts[key] === undefined) continue;
    if (family && !applies.includes('*') && !applies.includes(family)) {
      return `cannot use '${key}': it applies to a ${applies.join(' or ')} column, not to a ${family} one`;
    }
    const dead = deadOn(opts, key);
    if (dead) {
      return `cannot use '${key}': it is ignored on ${dead}`;
    }
  }
  return undefined;
}

/** What `typeof` answers on a value of `T`, where a column's values are checked: a date, a document or bytes are not. */
type ValueTypeOf<T> = T extends string
  ? 'string'
  : T extends number
    ? 'number'
    : T extends bigint
      ? 'bigint'
      : T extends boolean
        ? 'boolean'
        : never;

type ValueType = ValueTypeOf<string | number | bigint | boolean>;

/** Each `typeof` a column of `T` answers, keyed so a literal missing one `TsTypeOf` gives it, or adding one, fails to compile. */
type ValueTypesOf<T> = { readonly [K in ValueTypeOf<TsTypeOf<T>>]: true };

type ValueTypeSet = { readonly [K in ValueType]?: true };

/** The values each family holds. A family left out is not checked. */
const VALUE_TYPES_OF_FAMILY: { readonly [F in ColumnFamily]?: ValueTypeSet } = {
  string: { string: true } satisfies ValueTypesOf<StringColumnType | StringConstructor>,
  numeric: { number: true, bigint: true } satisfies ValueTypesOf<Exclude<NumericColumnType, 'decimal' | 'numeric'>>,
  boolean: { boolean: true } satisfies ValueTypesOf<BooleanColumnType | BooleanConstructor>,
};

/** Where a type's family does not decide its values: a constructor holds one kind, and `time` and an exact decimal read as text. */
const VALUE_TYPES_OF_TYPE = new Map<unknown, ValueTypeSet>([
  [Number, { number: true } satisfies ValueTypesOf<NumberConstructor>],
  [BigInt, { bigint: true } satisfies ValueTypesOf<BigIntConstructor>],
  ['time', { string: true } satisfies ValueTypesOf<'time'>],
  ['decimal', { string: true } satisfies ValueTypesOf<'decimal'>],
  ['numeric', { string: true } satisfies ValueTypesOf<'numeric'>],
]);

/** What `typeof` a value answers on a column of `type`, as `TsTypeOf` types it; nothing where none is checked. */
export function valueTypesOf(type: FieldOptions['type']): readonly ValueType[] | undefined {
  const family = columnFamily(type);
  const held = VALUE_TYPES_OF_TYPE.get(type) ?? (family && VALUE_TYPES_OF_FAMILY[family]);
  return held && getKeys(held);
}

/** An `enum` member its `type` cannot hold, which the row would still type as that member. */
function enumStray(opts: FieldOptions): string | undefined {
  const types = valueTypesOf(opts.type);
  const stray = types && opts.enum?.find((member) => !types.some((type) => type === typeof member));
  if (!types || stray === undefined) return undefined;
  const shown = typeof stray === 'string' ? `'${stray}'` : String(stray);
  return `cannot use 'enum': its member ${shown} is no ${types.join(' or ')}, which its type holds`;
}
