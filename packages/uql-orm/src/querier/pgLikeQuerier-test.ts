import { expect } from 'vitest';
import { Company, NarrowVectorItem } from '../test/index.js';
import { VectorQuerierIt } from './vectorQuerier-test.js';

/**
 * Shared expectations for Postgres-wire dialects with native JSONB support (Postgres, CockroachDB) -
 * both implement the JSONB operators identically, so these tests run unmodified on either. The
 * vector expectations they also share with libSQL and Turso live in {@link VectorQuerierIt}.
 */
export abstract class PgLikeQuerierIt extends VectorQuerierIt {
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
   * `halfvec` and `sparsevec` round-tripping through a real database, insert included. Both used to
   * bind as plain arrays there, and `sparsevec` additionally needs pgvector's sparse literal - two
   * failures no assertion on generated SQL could see. CockroachDB has neither type and lands both on
   * `vector`, which is exactly why the same test has to pass on both.
   */
  async shouldRoundTripNarrowVectorTypes() {
    const id = await this.querier.insertOne(NarrowVectorItem, {
      name: 'narrow',
      half: [1, 0, 0],
      sparse: [0, 0, 1],
    });

    const found = await this.querier.findOneById(NarrowVectorItem, id);

    expect(found!.name).toBe('narrow');
    expect(found!.half).toBe('[1,0,0]');
    expect(found!.sparse).toBe(this.expectedSparsevecValue);
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

  /** Postgres keeps the sparse form it was given; CockroachDB stores a dense `vector`. */
  protected get expectedSparsevecValue(): string {
    return '{3:1}/3';
  }
}
