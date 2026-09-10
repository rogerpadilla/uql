import type {
  BlobColumnType,
  BooleanColumnType,
  DateColumnType,
  FieldOptions,
  JsonColumnType,
  NumericColumnType,
  QueryRaw,
  StringColumnType,
  VectorColumnType,
} from '../type/index.js';
import { type ColumnFamily, columnFamily, isInlinedExpression } from './field.util.js';
import { getKeys } from './object.util.js';

/**
 * The column family each field option means anything on, or `'*'` where it applies to every column.
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
  computed: '*',
  stored: '*',
  updatable: '*',
  eager: '*',
  onInsert: '*',
  onUpdate: '*',
  softDelete: '*',
  columnType: '*',
  length: 'string',
  precision: 'numeric',
  scale: 'numeric',
  nullable: '*',
  unique: '*',
  defaultValue: '*',
  autoIncrement: 'numeric',
  index: '*',
  comment: '*',
} as const satisfies Record<keyof FieldOptions, ColumnFamily | '*'>;

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
] as const satisfies readonly (keyof FieldOptions)[];

type InlineRead = (typeof INLINE_READS)[number];

/**
 * What a column the *database* writes cannot use. A stored computed column is a real column - it has
 * DDL, an index, a comment, a name - so only the write half is dead on one: the engine fills it, and
 * `GENERATED ALWAYS AS` and `DEFAULT` are mutually exclusive on every engine that has both.
 */
const GENERATED_WRITES = [
  'updatable',
  'onInsert',
  'onUpdate',
  'softDelete',
  'defaultValue',
  'autoIncrement',
] as const satisfies readonly (keyof FieldOptions)[];

type GeneratedWrite = (typeof GENERATED_WRITES)[number];

/**
 * Whatever leaves `key` unread, named for the message, or `undefined` where the field reads it. Only
 * `nullable: true` contradicts a key: `nullable: false` says what the key already is, and rejecting
 * an accurate statement teaches an author to distrust the check.
 */
function deadOn(opts: FieldOptions, key: keyof FieldOptions): string | undefined {
  if (isInlinedExpression(opts) && !INLINE_READS.some((read) => read === key)) return 'an inlined computed field';
  if (opts.stored === true && GENERATED_WRITES.some((write) => write === key)) return 'a stored computed column';
  if (opts.isId === true && key === 'nullable' && opts.nullable === true) return 'a primary key';
  if (opts.updatable === false && key === 'onUpdate') return "a field declared 'updatable: false'";
  return undefined;
}

/**
 * The first option `opts` cannot use, phrased as the tail of `'Entity.field' ...`, or `undefined`
 * where every option applies. The runtime half of the decorators' check, so the imperative API and
 * plain JavaScript reach the same answer.
 */
export function fieldOptionConflict(opts: FieldOptions): string | undefined {
  const family = columnFamily(opts.columnType ?? opts.type);
  // Walked in table order, not in the order the field happened to be written, so a field with two
  // conflicts always reports the same one. An option no rule knows is a typo, which `RejectUnknown`
  // reports where it can still be spelled right.
  for (const key of getKeys(FIELD_OPTION_FAMILY)) {
    const applies: ColumnFamily | '*' = FIELD_OPTION_FAMILY[key];
    if (opts[key] === undefined) continue;
    if (family && applies !== '*' && applies !== family) {
      return `cannot use '${key}': it applies to a ${applies} column, not to a ${family} one`;
    }
    const dead = deadOn(opts, key);
    if (dead) {
      return `cannot use '${key}': it is ignored on ${dead}`;
    }
  }
  return undefined;
}

/** The family the options put the column in; every family where they name no type to put it in. */
type FamilyOf<O> = O extends { readonly columnType: infer C }
  ? FamilyOfType<C>
  : O extends { readonly type: infer T }
    ? FamilyOfType<T>
    : ColumnFamily;

/** Read off the column-type unions themselves, which is what `COLUMN_TYPES_BY_FAMILY` is checked against. */
type FamilyOfType<T> = T extends NumericColumnType | NumberConstructor | BigIntConstructor
  ? 'numeric'
  : T extends StringColumnType | StringConstructor
    ? 'string'
    : T extends VectorColumnType
      ? 'vector'
      : T extends JsonColumnType
        ? 'json'
        : T extends DateColumnType | DateConstructor
          ? 'date'
          : T extends BooleanColumnType | BooleanConstructor
            ? 'boolean'
            : T extends BlobColumnType
              ? 'blob'
              : ColumnFamily;

/** What the field's own values leave unread, matching {@link deadOn} line for line. */
type DeadOptions<O> =
  | (O extends { readonly stored: true }
      ? GeneratedWrite
      : O extends { readonly computed: QueryRaw }
        ? Exclude<keyof FieldOptions, InlineRead>
        : never)
  | (O extends { readonly isId: true; readonly nullable: true } ? 'nullable' : never)
  | (O extends { readonly updatable: false } ? 'onUpdate' : never);

type Given<O> = Extract<keyof O, keyof FieldOptions>;

type Offending<O> = {
  [K in Given<O>]: (typeof FIELD_OPTION_FAMILY)[K] extends FamilyOf<O> | '*'
    ? K extends DeadOptions<O>
      ? K
      : never
    : K;
}[Given<O>];

/**
 * Maps every option `O` states but cannot use to `never`, the way `RejectUnknown` maps a typo'd one,
 * so an option that would be silently ignored reads as the same compile error. Resolves to `unknown`
 * - an inert intersection member - when there are none.
 *
 * `@Id` adds `{ nullable?: false }` of its own rather than passing the `isId` it stamps on, which
 * would have to reach `O` as an intersection - and a non-naked `O` in its own constraint stops it
 * inferring from the options at all.
 */
export type RejectIncompatible<O> = [Offending<O>] extends [never] ? unknown : Record<Offending<O> & string, never>;
