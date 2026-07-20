import { expect } from 'vitest';
import { Company, VectorItem } from '../test/index.js';
import type { WithDistance } from '../type/index.js';
import { AbstractSqlQuerierIt } from './abstractSqlQuerier-test.js';

/**
 * Shared expectations for Postgres-wire dialects with native JSONB and vector support (Postgres,
 * CockroachDB) - both implement pgvector-compatible distance operators and JSONB operators
 * identically, so these tests run unmodified on either.
 */
export abstract class PgLikeQuerierIt extends AbstractSqlQuerierIt {
  // ── Vector search integration tests ────────────────────────────────────

  async shouldInsertAndRetrieveVector() {
    const id = await this.querier.insertOne(VectorItem, { name: 'alpha', vec: [1, 0, 0] });
    const found = await this.querier.findOneById(VectorItem, id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('alpha');
    expect(found!.vec).toBe('[1,0,0]');
  }

  async shouldSortByVectorSimilarity() {
    await this.querier.insertMany(VectorItem, [
      { name: 'north', vec: [0, 1, 0] },
      { name: 'east', vec: [1, 0, 0] },
      { name: 'northeast', vec: [Math.SQRT1_2, Math.SQRT1_2, 0] },
    ]);

    // Query vector is [0,1,0] (north) - cosine distance: north=0, northeast≈0.29, east=1
    const results = await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [0, 1, 0] } },
    });

    expect(results.map((r) => r.name)).toEqual(['north', 'northeast', 'east']);
  }

  async shouldProjectVectorDistance() {
    await this.querier.insertMany(VectorItem, [
      { name: 'close', vec: [1, 0, 0] },
      { name: 'far', vec: [0, 0, 1] },
    ]);

    const results = (await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [1, 0, 0], $project: 'distance' } },
    })) as WithDistance<VectorItem, 'distance'>[];

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('close');
    expect(results[0].distance).toBeCloseTo(0, 5); // identical vector → cosine distance 0
    expect(results[1].name).toBe('far');
    expect(results[1].distance).toBeCloseTo(1, 5); // orthogonal vectors → cosine distance 1
  }

  async shouldCombineFilterWithVectorSort() {
    await this.querier.insertMany(VectorItem, [
      { name: 'keep-close', vec: [1, 0, 0] },
      { name: 'keep-far', vec: [0, 0, 1] },
      { name: 'skip', vec: [1, 0, 0] }, // same vector but filtered out
    ]);

    const results = await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $where: { name: { $startsWith: 'keep' } },
      $sort: { vec: { $vector: [1, 0, 0] } },
    });

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('keep-close');
    expect(results[1].name).toBe('keep-far');
  }

  async shouldLimitVectorSortResults() {
    await this.querier.insertMany(VectorItem, [
      { name: 'a', vec: [1, 0, 0] },
      { name: 'b', vec: [0.9, 0.1, 0] },
      { name: 'c', vec: [0, 1, 0] },
    ]);

    const results = await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [1, 0, 0] } },
      $limit: 2,
    });

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('a');
    expect(results[1].name).toBe('b');
  }

  async shouldReturnEmptyForVectorSortOnEmptyTable() {
    const results = await this.querier.findMany(VectorItem, {
      $sort: { vec: { $vector: [1, 0, 0] } },
      $limit: 5,
    });
    expect(results).toHaveLength(0);
  }

  async shouldSortByL2Distance() {
    await this.querier.insertMany(VectorItem, [
      { name: 'near', vec: [1, 0, 0] },
      { name: 'far', vec: [0, 1, 0] },
    ]);

    const results = (await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [1, 0, 0], $distance: 'l2', $project: 'distance' } },
    })) as WithDistance<VectorItem, 'distance'>[];

    expect(results[0].name).toBe('near');
    expect(results[0].distance).toBeCloseTo(0, 5);
    expect(results[1].name).toBe('far');
    expect(results[1].distance).toBeCloseTo(Math.sqrt(2), 5); // L2 of [1,0,0] vs [0,1,0] = √2
  }

  // ── JSONB operators integration tests ───────────────────────────────────

  async shouldWorkWithJsonbOperators() {
    const id = await this.querier.insertOne(Company, {
      name: 'Test Company',
      kind: {
        tags: ['admin', 'user'],
        country: 'USA',
        meta: {
          created: true,
          count: 5,
        },
      },
    });

    // Test $all on nested JSONB path
    const foundAll = await this.querier.findMany(Company, {
      $where: { 'kind.tags': { $all: ['admin', 'user'] } },
    });
    expect(foundAll).toHaveLength(1);

    // Test $elemMatch on nested path
    const foundElemMatch = await this.querier.findMany(Company, {
      $where: { 'kind.tags': { $elemMatch: { $startsWith: 'ad' } } },
    });
    expect(foundElemMatch).toHaveLength(1);

    // Test $size
    const foundSize = await this.querier.findMany(Company, {
      $where: { 'kind.tags': { $size: 2 } },
    });
    expect(foundSize).toHaveLength(1);

    // Test $merge operator
    await this.querier.updateOneById(Company, id, {
      kind: { $merge: { description: 'merged' } },
    });

    const foundMerge = await this.querier.findOneById(Company, id);
    expect(foundMerge?.kind?.description).toBe('merged');
    expect(foundMerge?.kind?.tags).toEqual(['admin', 'user']);

    // Test $push operator
    await this.querier.updateOneById(Company, id, {
      kind: { $push: { tags: 'super-admin' } },
    });
    const foundPush = await this.querier.findOneById(Company, id);
    expect(foundPush?.kind?.tags).toEqual(['admin', 'user', 'super-admin']);

    // Test $unset operator
    await this.querier.updateOneById(Company, id, {
      kind: { $unset: ['country'] },
    });
    const foundUnset = await this.querier.findOneById(Company, id);
    expect(foundUnset?.kind?.country).toBeUndefined();

    // Test deep dot-notation path
    const foundDeep = await this.querier.findMany(Company, {
      $where: { 'kind.meta.count': { $gt: 0 } },
    });
    expect(foundDeep).toHaveLength(1);
  }
}
