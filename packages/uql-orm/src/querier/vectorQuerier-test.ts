import { expect } from 'vitest';
import { VectorItem } from '../test/index.js';
import type { WithDistance } from '../type/index.js';
import { AbstractSqlQuerierIt } from './abstractSqlQuerier-test.js';

/**
 * Shared vector-search expectations for every SQL backend that computes distances natively:
 * pgvector, CockroachDB, libSQL and Turso. The dialects express the distance differently (an
 * operator, or one of several function names), but the metrics mean the same thing everywhere, so
 * the results below are dialect-independent.
 *
 * @remarks These have to run against a live engine, not just assert the generated SQL: the SQLite
 * family shipped `vec_distance_cosine` calls for engines whose function is named
 * `vector_distance_cos`, and nothing caught it because no test executed a vector query there.
 */
export abstract class VectorQuerierIt extends AbstractSqlQuerierIt {
  async shouldInsertAndRetrieveVector() {
    const id = await this.querier.insertOne(VectorItem, { name: 'alpha', vec: [1, 0, 0] });
    const found = await this.querier.findOneById(VectorItem, id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('alpha');
    // The array that went in, not the engine's text for it: the field declares `number[]` and a read
    // that returned the literal made every consumer's arithmetic silently wrong while type-checking.
    expect(found!.vec).toEqual([1, 0, 0]);
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
}
