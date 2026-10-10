import { expect } from 'vitest';
import { getMeta } from '../entity/index.js';
import { NarrowVectorItem } from '../test/index.js';
import type { Type } from '../type/index.js';
import { sql } from '../util/sql.js';
import { VectorQuerierIt } from './vectorQuerier-test.js';

/**
 * What the engines on the Postgres wire share, CockroachDB among them: `ANALYZE` statistics, pgvector's
 * narrower vector types, and a session zone. {@link PostgresQuerierIt} adds what Postgres alone has.
 */
export class PgLikeQuerierIt extends VectorQuerierIt {
  protected override async expectEstimatedCount(entity: Type<object>, rows: number) {
    await this.querier.run(sql.text(`ANALYZE ${this.querier.dialect.escapedTableName(getMeta(entity))}`));
    expect(await this.querier.estimatedCount(entity)).toBe(rows);
  }

  /**
   * `halfvec` and `sparsevec` through a real database, insert included, `sparsevec` in pgvector's sparse
   * literal. Both come back dense, whichever literal the engine stored them as (CockroachDB stores both as
   * `vector`): `sparsevec` is a storage format, and the field type promises the array that went in.
   */
  async shouldRoundTripNarrowVectorTypes() {
    const id = await this.querier.insertOne(NarrowVectorItem, {
      name: 'narrow',
      half: [1, 0, 0],
      sparse: [0, 0, 1],
    });

    const found = await this.querier.findOneById(NarrowVectorItem, id, {
      $select: { name: true, half: true, sparse: true },
    });

    expect(found).toEqual({ name: 'narrow', half: [1, 0, 0], sparse: [0, 0, 1] });
  }

  /** An array reads each element as its scalar does, on every driver: exact past 2^53, a NUMERIC as text, a zoneless one as UTC. */
  async shouldDecodeAnArrayAsItsElements() {
    const [row] = await this.querier.all`SELECT
      ARRAY[1::int8, 9007199254740993::int8, NULL] AS wide,
      ARRAY[12345678901234567890.5::numeric] AS exact,
      ARRAY['2026-09-10 12:30:00.123'::timestamp] AS stamps,
      ARRAY['2026-09-10'::date] AS days`;

    expect(row).toEqual({
      wide: [1, '9007199254740993', null],
      exact: ['12345678901234567890.5'],
      stamps: [new Date('2026-09-10T12:30:00.123Z')],
      days: [new Date('2026-09-10T00:00:00.000Z')],
    });
  }

  /** An inline date is the instant it names whatever the session's zone, as a CHECK or a trigger reads one. */
  async shouldReadAnInlineDateAsTheSameInstantInAnyZone() {
    const at = new Date('2024-01-15T12:30:45.123Z');
    const [row] = await this.querier.transaction(async () => {
      await this.querier.run`SET LOCAL TimeZone = 'America/Bogota'`;
      return this.querier.all<{ at: Date }>(sql.text(`SELECT ${this.querier.dialect.escape(at)}::timestamptz AS "at"`));
    });

    expect(row?.at).toEqual(at);
  }

  async shouldSortByNarrowVectorDistance() {
    await this.querier.insertMany(NarrowVectorItem, [
      { name: 'near', half: [1, 0, 0], sparse: [1, 0, 0] },
      { name: 'far', half: [0, 1, 0], sparse: [0, 1, 0] },
    ]);

    const byHalf = await this.querier.findMany(NarrowVectorItem, {
      $select: { name: true },
      $sort: { half: { $vector: [1, 0, 0] } },
    });
    const bySparse = await this.querier.findMany(NarrowVectorItem, {
      $select: { name: true },
      $sort: { sparse: { $vector: [1, 0, 0], $distance: 'l2' } },
    });

    expect(byHalf.map((r) => r.name)).toEqual(['near', 'far']);
    expect(bySparse.map((r) => r.name)).toEqual(['near', 'far']);
  }
}
