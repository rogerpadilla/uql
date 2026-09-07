import type {
  BlobColumnType,
  BooleanColumnType,
  ColumnType,
  DateColumnType,
  EntityMeta,
  FieldOptions,
  JsonColumnType,
  NumericColumnType,
  StringColumnType,
  VectorColumnType,
} from '../type/index.js';
import { getKeys } from './object.util.js';

/**
 * The kind of column a field lands on, which is what decides whether an option means anything on it:
 * `length` is a string's, `precision` a number's, `dimensions` a vector's. Named in the words an
 * error reports it in, so there is no second table of labels to keep in step.
 */
export type ColumnFamily = 'string' | 'numeric' | 'boolean' | 'date' | 'json' | 'blob' | 'vector';

/**
 * The runtime half of the column-type unions in `type/entity.ts`, which TypeScript erases. Each list
 * is checked against its own union, so a type cannot be filed under the wrong family, and
 * {@link UnplacedColumnType} refuses to compile if a new one is filed under none. Nothing here
 * restates the unions: the compile-time side of the same question reads them directly.
 */
export const COLUMN_TYPES_BY_FAMILY = {
  numeric: [
    'int',
    'integer',
    'tinyint',
    'smallint',
    'bigint',
    'float',
    'float4',
    'float8',
    'double',
    'double precision',
    'decimal',
    'numeric',
    'real',
    'serial',
    'smallserial',
    'bigserial',
  ],
  string: ['char', 'varchar', 'text', 'uuid'],
  date: ['date', 'time', 'datetime', 'timestamp', 'timestamptz'],
  json: ['json', 'jsonb'],
  blob: ['blob', 'bytea'],
  boolean: ['bool', 'boolean'],
  vector: ['vector', 'halfvec', 'sparsevec'],
} as const satisfies {
  numeric: readonly NumericColumnType[];
  string: readonly StringColumnType[];
  date: readonly DateColumnType[];
  json: readonly JsonColumnType[];
  blob: readonly BlobColumnType[];
  boolean: readonly BooleanColumnType[];
  vector: readonly VectorColumnType[];
};

/** Resolves to `never`, and fails to compile as anything else: a column type in no list above. */
type UnplacedColumnType = Unplaced<Exclude<ColumnType, (typeof COLUMN_TYPES_BY_FAMILY)[ColumnFamily][number]>>;
type Unplaced<T extends never> = T;

// Constructors and type strings in one map: a logical type is either, and every caller asks the same
// question of both.
const FAMILY_OF = new Map<unknown, ColumnFamily>([
  [String, 'string'],
  [Number, 'numeric'],
  [BigInt, 'numeric'],
  [Boolean, 'boolean'],
  [Date, 'date'],
]);
for (const family of getKeys(COLUMN_TYPES_BY_FAMILY)) {
  for (const columnType of COLUMN_TYPES_BY_FAMILY[family]) {
    FAMILY_OF.set(columnType, family);
  }
}

/** The family of a logical field type, or `undefined` where it names none. */
export function columnFamily(type: unknown): ColumnFamily | undefined {
  return FAMILY_OF.get(typeof type === 'string' ? type.toLowerCase() : type);
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

  return isPrimaryKey && columnFamily(field.type) === 'numeric' && !field.onInsert && !field.columnType;
}
