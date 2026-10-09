import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { Entity, Field, Id } from '../entity/index.js';
import { MariaDialect } from '../mariadb/mariaDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { JsonRecord, NarrowVectorItem, VectorItem } from '../test/index.js';
import type { Type } from '../type/index.js';
import { columnFamily } from '../util/field.util.js';
import type { AbstractSqlDialect } from './abstractSqlDialect.js';
import { DECODERS } from './hydrateColumn.js';

/**
 * Which columns a dialect decodes on read, and as what: the classification itself, for the columns the
 * round-trip suites do not happen to cover.
 */

/** A string key, so nothing at all needs decoding: numeric ids do (see the `number` cases below). */
@Entity()
class PlainRow {
  @Id({ type: String }) id?: string;
  @Field({ type: String }) name?: string | null;
}

/** A decimal reads as its exact text, declared by its SQL type or as a `String` over one; `Number` opts in to rounding. */
@Entity()
class PriceRow {
  @Id({ type: String }) id?: string;
  @Field({ type: 'decimal', precision: 30, scale: 2 }) price?: string | null;
  @Field({ type: String, columnType: 'decimal', precision: 30, scale: 2 }) exact?: string | null;
  @Field({ type: Number, precision: 12, scale: 2 }) rounded?: number | null;
}

@Entity()
class FlagRow {
  @Id({ type: Number }) id?: number;
  @Field({ type: Boolean }) active?: boolean | null;
}

/**
 * The same three columns declared by their SQL logical type instead of the constructor, which
 * `FieldOptions` accepts for every one of them. Matching `=== Number`/`=== Boolean` left these
 * unclassified, so they read back as `'12.50'` and `1` from the very drivers this exists to correct.
 */
@Entity()
class LogicalRow {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'boolean' }) active?: boolean | null;
  @Field({ type: 'decimal', precision: 12, scale: 2 }) amount?: string | null;
  @Field({ type: BigInt }) huge?: bigint | null;
}

/** Each field `dialect` decodes and as what: for a row on the wire, or with `json`, one crossing JSON in its parent's. */
function decoded(dialect: AbstractSqlDialect, entity: Type<object>, json = false) {
  return dialect
    .selectTerms(dialect.createContext(), entity, undefined, { json })
    .flatMap(({ key, kind }) => (key && kind ? [[key, kind]] : []));
}

describe('decoded fields', () => {
  const postgres = new PostgresDialect();

  it('should list nothing for an entity with no encoded column, so reads skip the loop', () => {
    expect(decoded(postgres, PlainRow)).toEqual([]);
  });

  it('should parse a JSON column only where it arrives as text', () => {
    expect(decoded(new SqliteDialect(), JsonRecord)).toContainEqual(['entries', 'json']);
    expect(decoded(postgres, JsonRecord)).not.toContainEqual(['entries', 'json']);
  });

  it('should classify a dense vector by the cast the dialect writes', () => {
    expect(decoded(postgres, VectorItem)).toContainEqual(['vec', 'vector']);
  });

  it('should classify booleans, which only the entity can disambiguate from a small integer', () => {
    // SQLite stores 0/1 in an INTEGER and MySQL uses TINYINT(1); the column type cannot say.
    expect(decoded(new SqliteDialect(), FlagRow)).toContainEqual(['active', 'boolean']);
    expect(decoded(new MariaDialect(), FlagRow)).toContainEqual(['active', 'boolean']);
  });

  it('should classify every numeric field crossing JSON, since a decimal comes back as text from more than one driver', () => {
    // Including the id: `type: Number` is BIGINT, and this is the value every consumer indexes by.
    expect(decoded(postgres, VectorItem, true)).toContainEqual(['id', 'number']);
    expect(decoded(new SqliteDialect(), VectorItem)).toContainEqual(['id', 'number']);
  });

  it('should leave a Postgres wire row what its pools decode: a boolean, a date and an integer column', () => {
    expect(decoded(postgres, LogicalRow)).toEqual([
      ['amount', 'decimal'],
      ['huge', 'bigint'],
    ]);
    expect(decoded(postgres, LogicalRow, true)).toEqual([
      ['id', 'number'],
      ['active', 'boolean'],
      ['amount', 'decimal'],
      ['huge', 'bigint'],
    ]);
  });

  /** SQLite's numeric affinity hands a decimal back as a number, which reads as its text like any other. */
  it.each([
    ['Postgres', postgres],
    ['SQLite', new SqliteDialect()],
    ['MariaDB', new MariaDialect()],
  ])('should read a decimal as its exact text on %s, unless declared `Number`', (_engine, dialect) => {
    expect(decoded(dialect, PriceRow)).toEqual([
      ['price', 'decimal'],
      ['exact', 'decimal'],
      ['rounded', 'number'],
    ]);
  });

  it('should keep `bigint` apart from `number`, since both declare a BIGINT column', () => {
    // `type: BigInt` promises a bigint where the pg pools decode BIGINT to a number, so it has a kind of
    // its own, which `hydrateKind` answers before the numeric family `BigInt` belongs to.
    expect(decoded(postgres, LogicalRow)).toContainEqual(['huge', 'bigint']);
    expect(columnFamily(BigInt)).toBe('numeric');
  });

  it('should keep the narrow vector casts on Postgres, the only engine that has them', () => {
    expect(decoded(postgres, NarrowVectorItem)).toEqual([
      ['half', 'halfvec'],
      ['sparse', 'sparsevec'],
    ]);
  });

  it('should read narrow vectors back as dense everywhere else, because that is how they were written', () => {
    // The bug this prevents: decoding by the field's own declared cast would hunt for a `{1:1}/3`
    // literal on an engine that only ever stored `[0,0,1]`, and hand back the raw text instead.
    expect(decoded(new CockroachDialect(), NarrowVectorItem, true)).toEqual([
      ['id', 'number'],
      ['half', 'vector'],
      ['sparse', 'vector'],
    ]);
  });

  it('should read a vector bound as bytes back as its float32s', () => {
    for (const dialect of [new MariaDialect(), new SqliteDialect()]) {
      expect(decoded(dialect, NarrowVectorItem)).toEqual([
        ['id', 'number'],
        ['half', 'float32'],
        ['sparse', 'float32'],
      ]);
    }
  });
});

describe('DECODERS', () => {
  /** The text a decimal is declared as, whichever way the driver handed it back. */
  it.each([
    ['text', '12.50', '12.50'],
    ['bytes, as Bun hands a MySQL decimal', new TextEncoder().encode('12.50'), '12.50'],
    ['a float, as the SQLite family stores one', 12.5, '12.5'],
    ['an integer, as `bun:sqlite` hands a whole one', 12n, '12'],
  ])('should read a decimal arriving as %s as its text', (_shape, value, text) => {
    expect(DECODERS.decimal(value)).toBe(text);
  });
});
