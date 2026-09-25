import { type ColumnFamily, type FamilyOf, type FieldOptions, QueryRaw, type StampEvent } from '../type/index.js';
import { columnFamily, isInlinedExpression } from './field.util.js';
import { getKeys } from './object.util.js';
import { constantSql } from './raw.js';

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
] as const satisfies readonly (keyof FieldOptions)[];

type InlineRead = (typeof INLINE_READS)[number];

/** Every option that decides what a column holds, or whether it is written at all. */
const VALUE_DECIDERS = [
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

type GeneratedWrite = (typeof GENERATED_WRITES)[number];

/**
 * What an optimistic lock cannot use: the querier writes the column on every update and matches the
 * value the payload carried, so anything else deciding it would be fighting that, and the three that
 * would make it another kind of column entirely. Its `nullable: false` and `DEFAULT 0` are implied.
 */
const VERSION_WRITES = [...VALUE_DECIDERS, 'computed', 'stored', 'isId'] as const;

type VersionWrite = (typeof VERSION_WRITES)[number];

/**
 * What bounds a type: stated separately where uql spells the type, and part of the text where the
 * engine's own is written out, which renders verbatim and leaves these unread.
 */
const TYPE_BOUNDS = ['length', 'precision', 'scale', 'dimensions'] as const satisfies readonly (keyof FieldOptions)[];

type TypeBound = (typeof TYPE_BOUNDS)[number];

/**
 * Whether `key` is the `nullable: true` a NOT NULL column contradicts. `nullable: false` says what
 * such a column already is, and rejecting an accurate statement teaches an author to distrust the check.
 */
function contradictsNotNull(opts: FieldOptions, key: keyof FieldOptions): boolean {
  return key === 'nullable' && opts.nullable === true;
}

/** Whatever leaves `key` unread, named for the message, or `undefined` where the field reads it. */
function deadOn(opts: FieldOptions, key: keyof FieldOptions): string | undefined {
  if (isInlinedExpression(opts) && !INLINE_READS.some((read) => read === key)) return 'an inlined computed field';
  if (opts.stored && GENERATED_WRITES.some((write) => write === key)) return 'a column the database writes';
  if (opts.isId === true && contradictsNotNull(opts, key)) return 'a primary key';
  if (opts.updatable === false && key === 'onUpdate') return "a field declared 'updatable: false'";
  if (opts.columnType instanceof QueryRaw && TYPE_BOUNDS.some((bound) => bound === key)) {
    return 'a column type written out as SQL, which carries its own bounds';
  }
  if (opts.version === true && (VERSION_WRITES.some((write) => write === key) || contradictsNotNull(opts, key))) {
    return 'a version field';
  }
  return undefined;
}

/**
 * The first option `opts` cannot use, phrased as the tail of `'Entity.field' ...`, or `undefined`
 * where every option applies. The runtime half of the decorators' check, so the imperative API and
 * plain JavaScript reach the same answer.
 */
export function fieldOptionConflict(opts: FieldOptions): string | undefined {
  // Caught here rather than where the type is resolved, which is a migration on most engines and a
  // query on SQL Server, and which knows no field to name.
  if (opts.columnType instanceof QueryRaw && constantSql(opts.columnType) === undefined) {
    return "cannot use 'columnType': a `raw` one names a constant type, so it can bind no value and read no column";
  }
  const family = columnFamily(opts.columnType ?? opts.type);
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

/** The family the options put the column in; every family where they name no type to put it in. */
type OptionsFamily<O> = O extends { readonly columnType: infer C }
  ? FamilyOf<C>
  : O extends { readonly type: infer T }
    ? FamilyOf<T>
    : ColumnFamily;

/** What the field's own values leave unread, matching {@link deadOn} line for line. */
type DeadOptions<O> =
  | (O extends { readonly stored: true | readonly StampEvent[] }
      ? GeneratedWrite
      : O extends { readonly computed: QueryRaw }
        ? Exclude<keyof FieldOptions, InlineRead>
        : never)
  | (O extends { readonly isId: true; readonly nullable: true } ? 'nullable' : never)
  | (O extends { readonly updatable: false } ? 'onUpdate' : never)
  | (O extends { readonly columnType: QueryRaw } ? TypeBound : never)
  | (O extends { readonly version: true } ? VersionWrite : never)
  | (O extends { readonly version: true; readonly nullable: true } ? 'nullable' : never);

type Given<O> = Extract<keyof O, keyof FieldOptions>;

/** The families option `K` applies to, `'*'` for every one. */
type OptionFamilies<K extends keyof FieldOptions> = (typeof FIELD_OPTION_FAMILY)[K] extends readonly (infer F)[]
  ? F
  : (typeof FIELD_OPTION_FAMILY)[K];

type Offending<O> = {
  [K in Given<O>]: [Extract<OptionFamilies<K>, OptionsFamily<O> | '*'>] extends [never]
    ? K
    : K extends DeadOptions<O>
      ? K
      : never;
}[Given<O>];

/**
 * Every option `O` states but cannot use, mapped to `never`, so one that would be ignored does not compile.
 * `@Id` states `{ nullable?: false }` itself, since `O` has to stay naked to be inferred.
 */
export type RejectIncompatible<O> = [Offending<O>] extends [never] ? unknown : Record<Offending<O> & string, never>;
