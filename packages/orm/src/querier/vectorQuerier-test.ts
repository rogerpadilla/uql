import { expect } from 'vitest';
import { VectorItem } from '../test/index.js';
import type { WithProjection } from '../type/index.js';
import { AbstractSqlQuerierIt } from './abstractSqlQuerier-test.js';

/**
 * Shared vector-search expectations for every SQL backend that computes distances natively (pgvector,
 * CockroachDB, libSQL, Turso), run against a live engine: each names its distance function its own way,
 * and only a real query shows a wrong one.
 */
export abstract class VectorQuerierIt extends AbstractSqlQuerierIt {
  async shouldInsertAndRetrieveVector() {
    const id = await this.querier.insertOne(VectorItem, { name: 'alpha', vec: [1, 0, 0] });
    const found = await this.querier.findOneById(VectorItem, id);
    expect(found).toBeDefined();
    expect(found?.name).toBe('alpha');
    // The array that went in, not the engine's text for it: the field declares `number[]` and a read
    // that returned the literal made every consumer's arithmetic silently wrong while type-checking.
    expect(found?.vec).toEqual([1, 0, 0]);
  }

  /** Every digit a float32 holds comes back, so a vector read and written again is the same vector. */
  async shouldReadAVectorInEveryDigit() {
    const id = await this.querier.insertOne(VectorItem, { name: 'precise', vec: [0.1234567, 3.1415927, -0.5] });

    const found = await this.querier.findOneById(VectorItem, id);

    expect(found?.vec).toEqual([0.1234567, 3.1415927, -0.5]);
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
    })) as WithProjection<VectorItem, 'distance'>[];

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('close');
    expect(results[0].distance).toBeCloseTo(0, 5); // identical vector -> cosine distance 0
    expect(results[1].name).toBe('far');
    expect(results[1].distance).toBeCloseTo(1, 5); // orthogonal vectors -> cosine distance 1
  }

  async shouldFilterByDistance() {
    await this.querier.insertMany(VectorItem, [
      { name: 'same', vec: [1, 0, 0] }, // cosine distance 0
      { name: 'near', vec: [Math.SQRT1_2, Math.SQRT1_2, 0] }, // ~0.29
      { name: 'orthogonal', vec: [0, 1, 0] }, // 1
    ]);

    const results = await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $where: { vec: { $near: { $vector: [1, 0, 0], $lt: 0.5 } } },
      $sort: { vec: { $vector: [1, 0, 0] } },
    });

    expect(results.map((r) => r.name)).toEqual(['same', 'near']);
  }

  /** Two bounds spell the distance twice, so this is where a half-applied expression would show up. */
  async shouldFilterByDistanceRange() {
    await this.querier.insertMany(VectorItem, [
      { name: 'same', vec: [1, 0, 0] },
      { name: 'near', vec: [Math.SQRT1_2, Math.SQRT1_2, 0] },
      { name: 'orthogonal', vec: [0, 1, 0] },
    ]);

    const results = await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $where: { vec: { $near: { $vector: [1, 0, 0], $gt: 0.1, $lt: 0.9 } } },
    });

    expect(results.map((r) => r.name)).toEqual(['near']);
  }

  /**
   * Every other live predicate case runs on the default cosine, so this is the one that would catch an
   * l2 bound being compared against a cosine value. `[0,1,0]` to `[1,0,0]` is sqrt(2) apart in l2 and
   * 1.0 in cosine, so a bound of 1.2 keeps one row under l2 and both under cosine.
   */
  async shouldFilterByANonDefaultMetric() {
    await this.querier.insertMany(VectorItem, [
      { name: 'same', vec: [1, 0, 0] },
      { name: 'orthogonal', vec: [0, 1, 0] },
    ]);

    const results = await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $where: { vec: { $near: { $vector: [1, 0, 0], $distance: 'l2', $lt: 1.2 } } },
      $sort: { vec: { $vector: [1, 0, 0], $distance: 'l2' } },
    });

    expect(results.map((r) => r.name)).toEqual(['same']);
  }

  /** The RAG shape: threshold, rank and project the score, all against one engine. */
  async shouldFilterAndRankByDistance() {
    await this.querier.insertMany(VectorItem, [
      { name: 'keep-same', vec: [1, 0, 0] },
      { name: 'keep-near', vec: [Math.SQRT1_2, Math.SQRT1_2, 0] },
      { name: 'drop-far', vec: [0, 1, 0] },
      { name: 'skip', vec: [1, 0, 0] },
    ]);

    const results = (await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $where: { name: { $startsWith: 'keep' }, vec: { $near: { $vector: [1, 0, 0], $lt: 0.5 } } },
      $sort: { vec: { $vector: [1, 0, 0], $project: 'score' } },
      $limit: 10,
    })) as WithProjection<VectorItem, 'score'>[];

    expect(results.map((r) => r.name)).toEqual(['keep-same', 'keep-near']);
    expect(results[0].score).toBeCloseTo(0, 5);
    expect(results[1].score).toBeCloseTo(1 - Math.SQRT1_2, 5);
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

  /**
   * A write settles its rows with a `SELECT` before writing, so it can rank them the way a read
   * does. The point of executing it is that the settle query is the only thing making this work: a
   * write that stopped going through it would still type-check and would silently touch every row.
   */
  async shouldUpdateOnlyTheRowsClosestToAVector() {
    // Inserted farthest-first on purpose: were the closest rows also the first ones, a settle query
    // that dropped the `$sort` would pick the same ids and this would pass without proving anything.
    await this.querier.insertMany(VectorItem, [
      { name: 'far', vec: [0, 1, 0] },
      { name: 'b', vec: [0.9, 0.1, 0] },
      { name: 'a', vec: [1, 0, 0] },
    ]);

    const count = await this.querier.updateMany(
      VectorItem,
      { $sort: { vec: { $vector: [1, 0, 0] } }, $limit: 2 },
      { name: 'closest' },
    );

    expect(count).toBe(2);
    const results = await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [1, 0, 0] } },
    });
    expect(results.map((r) => r.name)).toEqual(['closest', 'closest', 'far']);
  }

  async shouldDeleteOnlyTheRowsClosestToAVector() {
    await this.querier.insertMany(VectorItem, [
      { name: 'far', vec: [0, 1, 0] },
      { name: 'b', vec: [0.9, 0.1, 0] },
      { name: 'a', vec: [1, 0, 0] },
    ]);

    const count = await this.querier.deleteMany(VectorItem, {
      $sort: { vec: { $vector: [1, 0, 0] } },
      $limit: 2,
    });

    expect(count).toBe(2);
    const results = await this.querier.findMany(VectorItem, { $select: { name: true } });
    expect(results.map((r) => r.name)).toEqual(['far']);
  }

  async shouldSortByL2Distance() {
    await this.querier.insertMany(VectorItem, [
      { name: 'near', vec: [1, 0, 0] },
      { name: 'far', vec: [0, 1, 0] },
    ]);

    const results = (await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [1, 0, 0], $distance: 'l2', $project: 'distance' } },
    })) as WithProjection<VectorItem, 'distance'>[];

    expect(results[0].name).toBe('near');
    expect(results[0].distance).toBeCloseTo(0, 5);
    expect(results[1].name).toBe('far');
    expect(results[1].distance).toBeCloseTo(Math.sqrt(2), 5); // L2 of [1,0,0] vs [0,1,0] = √2
  }
}
