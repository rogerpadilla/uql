import { expect } from 'vitest';
import { getMeta } from '../entity/index.js';
import { Company, NarrowVectorItem } from '../test/index.js';
import type { Type } from '../type/index.js';
import { VectorQuerierIt } from './vectorQuerier-test.js';

/**
 * Shared expectations for Postgres-wire dialects with native JSONB support (Postgres, CockroachDB) -
 * both implement the JSONB operators identically, so these tests run unmodified on either. The
 * vector expectations they also share with libSQL and Turso live in {@link VectorQuerierIt}.
 */
export abstract class PgLikeQuerierIt extends VectorQuerierIt {
  protected override async expectEstimatedCount(entity: Type<object>, rows: number) {
    await this.querier.run(`ANALYZE ${this.querier.dialect.escapedTableName(getMeta(entity))}`);
    expect(await this.querier.estimatedCount(entity)).toBe(rows);
  }

  /**
   * A JSONB dot-path two levels deep (`kind.meta.count`). The single-level array/elemMatch/set/
   * push/unset paths are already covered generically for every dialect in {@link AbstractQuerierIt}.
   */
  async shouldFindByDeepJsonbDotPath() {
    await this.querier.insertOne(Company, {
      name: 'Test Company',
      kind: { meta: { count: 5 } },
    });

    const found = await this.querier.findMany(Company, {
      $where: { 'kind.meta.count': { $gt: 0 } },
    });
    expect(found).toHaveLength(1);
  }

  /**
   * `halfvec` and `sparsevec` through a real database, insert included, `sparsevec` in pgvector's sparse
   * literal. CockroachDB stores both as `vector`, which is why the same test runs there.
   */
  async shouldRoundTripNarrowVectorTypes() {
    const id = await this.querier.insertOne(NarrowVectorItem, {
      name: 'narrow',
      half: [1, 0, 0],
      sparse: [0, 0, 1],
    });

    const found = await this.querier.findOneById(NarrowVectorItem, id);

    expect(found?.name).toBe('narrow');
    // Both come back dense, whichever literal the engine stored them as: `sparsevec` is a storage
    // format, and the field type promises the same array on the way out as on the way in.
    expect(found?.half).toEqual([1, 0, 0]);
    expect(found?.sparse).toEqual([0, 0, 1]);
  }

  /** An inline date is the instant it names whatever the session's zone, as a CHECK or a trigger reads one. */
  async shouldReadAnInlineDateAsTheSameInstantInAnyZone() {
    const at = new Date('2024-01-15T12:30:45.123Z');
    await this.querier.beginTransaction();
    try {
      await this.querier.run(`SET LOCAL TimeZone = 'America/Bogota'`);
      const [row] = await this.querier.all<{ at: Date }>(
        `SELECT ${this.querier.dialect.escape(at)}::timestamptz AS "at"`,
      );
      expect(row?.at).toEqual(at);
    } finally {
      await this.querier.rollbackTransaction();
    }
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
