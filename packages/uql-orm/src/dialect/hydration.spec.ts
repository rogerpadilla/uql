import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { Entity, Field, Id } from '../entity/index.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { JsonRecord, NarrowVectorItem, VectorItem } from '../test/index.js';
import { isNumericType } from '../util/field.util.js';

/**
 * Which columns a dialect decodes on read, and as what.
 *
 * The integration suites prove the round-trip end to end, but only on the entities and engines they
 * happen to cover: the `sparsevec`-is-dense-off-Postgres rule reached exactly one of them. This
 * pins the classification itself, which is the part that has to stay right for a column the tests
 * have not thought of yet.
 */

/** A string key, so nothing at all needs decoding: numeric ids do (see the `number` cases below). */
@Entity()
class PlainRow {
  @Id({ type: String }) id?: string;
  @Field({ type: String }) name?: string;
  /**
   * The opt-out for a decimal wider than 2^53: `columnType` still makes the column DECIMAL, while the
   * declared `String` keeps it off the numeric path, so the driver's exact text survives untouched.
   * Drizzle and MikroORM both make *this* their default and require opting in to a number; uql goes
   * the other way, so the escape hatch has to exist and stay working.
   */
  @Field({ type: String, columnType: 'decimal', precision: 30, scale: 2 }) exact?: string;
}

@Entity()
class FlagRow {
  @Id({ type: Number }) id?: number;
  @Field({ type: Boolean }) active?: boolean;
}

/**
 * The same three columns declared by their SQL logical type instead of the constructor, which
 * `FieldOptions` accepts for every one of them. Matching `=== Number`/`=== Boolean` left these
 * unclassified, so they read back as `'12.50'` and `1` from the very drivers this exists to correct.
 */
@Entity()
class LogicalRow {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'boolean' }) active?: boolean;
  @Field({ type: 'decimal', precision: 12, scale: 2 }) amount?: number;
  @Field({ type: BigInt }) huge?: bigint;
}

describe('hydratableFields', () => {
  const postgres = new PostgresDialect();

  it('lists nothing for an entity with no encoded column, so reads skip the loop', () => {
    expect(postgres.hydratableFields(PlainRow)).toEqual([]);
  });

  it('classifies a JSON column', () => {
    expect(postgres.hydratableFields(JsonRecord)).toContainEqual(['entries', 'json']);
  });

  it('classifies a dense vector by the cast the dialect writes', () => {
    expect(postgres.hydratableFields(VectorItem)).toContainEqual(['vec', 'vector']);
  });

  it('classifies booleans, which only the entity can disambiguate from a small integer', () => {
    // SQLite stores 0/1 in an INTEGER and MySQL uses TINYINT(1); the column type cannot say.
    expect(new SqliteDialect().hydratableFields(FlagRow)).toContainEqual(['active', 'boolean']);
    expect(new MariaDialect().hydratableFields(FlagRow)).toContainEqual(['active', 'boolean']);
  });

  it('classifies every numeric field, since a decimal comes back as text from more than one driver', () => {
    // Including the id: `type: Number` is BIGINT, and this is the value every consumer indexes by.
    expect(postgres.hydratableFields(VectorItem)).toContainEqual(['id', 'number']);
  });

  it('classifies a column declared by its SQL type, not only by its constructor', () => {
    expect(postgres.hydratableFields(LogicalRow)).toEqual([
      ['id', 'number'],
      ['active', 'boolean'],
      ['amount', 'number'],
      ['huge', 'bigint'],
    ]);
  });

  it('keeps `bigint` apart from `number`, since both declare a BIGINT column', () => {
    // `type: BigInt` promises a bigint property, and the pg pools decode BIGINT to a JS number at the
    // wire, so sharing the numeric kind would hand a `number` to a field typed `bigint`.
    //
    // This is also what guards the one load-bearing order in `hydrateKind`: `isNumericType` answers
    // true for `BigInt`, so testing it before the `BigInt` case turns this back into `'number'`.
    expect(postgres.hydratableFields(LogicalRow)).toContainEqual(['huge', 'bigint']);
    expect(isNumericType(BigInt)).toBe(true);
  });

  it('keeps the narrow vector casts on Postgres, the only engine that has them', () => {
    expect(postgres.hydratableFields(NarrowVectorItem)).toEqual([
      ['id', 'number'],
      ['half', 'halfvec'],
      ['sparse', 'sparsevec'],
    ]);
  });

  it('reads narrow vectors back as dense everywhere else, because that is how they were written', () => {
    // The bug this prevents: decoding by the field's own declared cast would hunt for a `{1:1}/3`
    // literal on an engine that only ever stored `[0,0,1]`, and hand back the raw text instead.
    for (const dialect of [new CockroachDialect(), new MariaDialect(), new SqliteDialect()]) {
      expect(dialect.hydratableFields(NarrowVectorItem)).toEqual([
        ['id', 'number'],
        ['half', 'vector'],
        ['sparse', 'vector'],
      ]);
    }
  });

  it('computes the list once per entity, since it is a function of the column not the row', () => {
    // A 1000-row read would otherwise re-answer the same question 1000 times, and `isJsonType`
    // lowercases a string on every call. The two narrow-vector cases above cover the other half of
    // this: the cache is per dialect, so a shared one would make the second of them read the first's
    // answer for the same entity.
    expect(postgres.hydratableFields(VectorItem)).toBe(postgres.hydratableFields(VectorItem));
  });
});
