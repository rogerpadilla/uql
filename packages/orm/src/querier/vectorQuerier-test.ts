import { expect } from 'vitest';
import { VectorChunk, VectorDoc, VectorItem } from '../test/index.js';
import type { SpecRequirements } from '../test/index.js';
import type { WithProjection } from '../type/index.js';
import { AbstractSqlQuerierIt } from './abstractSqlQuerier-test.js';

/**
 * Shared vector-search expectations, run against a live engine: each names its distance function its own
 * way, and only a real query shows a wrong one. Skipped where the engine computes no distance (MySQL outside
 * HeatWave), the relation ranks of the shared suite included, and each metric where the engine lacks it.
 */
export abstract class VectorQuerierIt extends AbstractSqlQuerierIt {
  override requirements(): SpecRequirements<this> {
    const { vectorMetrics } = this.pool.dialect;
    const vectors = vectorMetrics.size > 0;
    const cases = Object.getOwnPropertyNames(VectorQuerierIt.prototype).filter((name) => name.startsWith('should'));
    return {
      ...super.requirements(),
      ...Object.fromEntries(cases.map((name) => [name, vectors])),
      shouldRankByTheNearestRowOfAToMany: vectors,
      shouldRankByTheNearestTargetOfAManyToMany: vectors,
      shouldRankByAToOneWithoutPopulatingIt: vectors,
      shouldSortByL1Distance: vectorMetrics.has('l1'),
      shouldSortByInnerProduct: vectorMetrics.has('inner'),
    };
  }

  /** The array that went in, not the engine's text for it: the field declares `number[]`. */
  async shouldInsertAndRetrieveVector() {
    const id = await this.querier.insertOne(VectorItem, { name: 'alpha', vec: [1, 0, 0] });
    const found = await this.querier.findOneById(VectorItem, id, { $select: { name: true, vec: true } });
    expect(found).toEqual({ name: 'alpha', vec: [1, 0, 0] });
  }

  /** Every digit a float32 holds comes back, so a vector read and written again is the same vector. */
  async shouldReadAVectorInEveryDigit() {
    const id = await this.querier.insertOne(VectorItem, { name: 'precise', vec: [0.1234567, 3.1415927, -0.5] });

    const found = await this.querier.findOneById(VectorItem, id);

    expect(found?.vec).toEqual([0.1234567, 3.1415927, -0.5]);
  }

  /** By cosine distance from north: north 0, northeast about 0.29, east 1. */
  async shouldSortByVectorSimilarity() {
    await this.querier.insertMany(VectorItem, [
      { name: 'north', vec: [0, 1, 0] },
      { name: 'east', vec: [1, 0, 0] },
      { name: 'northeast', vec: [Math.SQRT1_2, Math.SQRT1_2, 0] },
    ]);

    const results = await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [0, 1, 0] } },
    });

    expect(results.map((r) => r.name)).toEqual(['north', 'northeast', 'east']);
  }

  /** An identical vector is a cosine distance of 0 away, an orthogonal one 1. */
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
    expect(results[0].distance).toBeCloseTo(0, 5);
    expect(results[1].name).toBe('far');
    expect(results[1].distance).toBeCloseTo(1, 5);
  }

  /** Cosine distances of 0, about 0.29 and 1, under a bound of 0.5. */
  async shouldFilterByDistance() {
    await this.querier.insertMany(VectorItem, [
      { name: 'same', vec: [1, 0, 0] },
      { name: 'near', vec: [Math.SQRT1_2, Math.SQRT1_2, 0] },
      { name: 'orthogonal', vec: [0, 1, 0] },
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

  /** A to-many's vectors cross the parent's statement as the engine reads one back, every digit kept. */
  async shouldReadTheVectorsOfAPopulatedToMany() {
    const vectorDocId = await this.querier.insertOne(VectorDoc, { name: 'doc' });
    await this.querier.insertMany(VectorChunk, [
      { name: 'east', vec: [1, 0, 0], vectorDocId },
      { name: 'precise', vec: [0.1234567, 3.1415927, -0.5], vectorDocId },
    ]);

    const doc = await this.querier.findOneById(VectorDoc, vectorDocId, {
      $select: { name: true },
      $populate: { chunks: { $select: { name: true, vec: true }, $sort: { name: 1 } } },
    });

    expect(doc).toMatchObject({
      chunks: [
        { name: 'east', vec: [1, 0, 0] },
        { name: 'precise', vec: [0.1234567, 3.1415927, -0.5] },
      ],
    });
  }

  /** A joined table with a vector of the same name, which only the alias tells apart. */
  async shouldRankBesideAJoinedVector() {
    const vectorDocId = await this.querier.insertOne(VectorDoc, { name: 'doc', vec: [0, 1, 0] });
    await this.querier.insertMany(VectorChunk, [
      { name: 'north', vec: [0, 1, 0], vectorDocId },
      { name: 'east', vec: [1, 0, 0], vectorDocId },
      { name: 'northeast', vec: [Math.SQRT1_2, Math.SQRT1_2, 0], vectorDocId },
    ]);

    const results = await this.querier.findMany(VectorChunk, {
      $select: { name: true },
      $populate: { doc: { $select: { name: true } } },
      $where: { vec: { $near: { $vector: [1, 0, 0], $lt: 0.5 } } },
      $sort: { vec: { $vector: [1, 0, 0] } },
    });

    expect(results.map((r) => r.name)).toEqual(['east', 'northeast']);
  }

  /** `skip` is as close as `keep-close`, and filtered out. */
  async shouldCombineFilterWithVectorSort() {
    await this.querier.insertMany(VectorItem, [
      { name: 'keep-close', vec: [1, 0, 0] },
      { name: 'keep-far', vec: [0, 0, 1] },
      { name: 'skip', vec: [1, 0, 0] },
    ]);

    const results = await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $where: { name: { $startsWith: 'keep' } },
      $sort: { vec: { $vector: [1, 0, 0] } },
    });

    expect(results.map((r) => r.name)).toEqual(['keep-close', 'keep-far']);
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

    expect(results.map((r) => r.name)).toEqual(['a', 'b']);
  }

  async shouldReturnEmptyForVectorSortOnEmptyTable() {
    const results = await this.querier.findMany(VectorItem, {
      $sort: { vec: { $vector: [1, 0, 0] } },
      $limit: 5,
    });
    expect(results).toEqual([]);
  }

  /**
   * A write settles its rows with a `SELECT` ranking them as a read does, or it would touch every row.
   * Inserted farthest-first, so a settle query that dropped the `$sort` would not pick the same ids.
   */
  async shouldUpdateOnlyTheRowsClosestToAVector() {
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

  /** `[1,0,0]` and `[0,1,0]` are √2 apart in L2. */
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
    expect(results[1].distance).toBeCloseTo(Math.sqrt(2), 5);
  }

  /** `[1,0,0]` and `[0,1,0]` are 2 apart in L1, the sum of the coordinates' differences. */
  async shouldSortByL1Distance() {
    await this.querier.insertMany(VectorItem, [
      { name: 'near', vec: [1, 0, 0] },
      { name: 'far', vec: [0, 1, 0] },
    ]);

    const results = (await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [1, 0, 0], $distance: 'l1', $project: 'distance' } },
    })) as WithProjection<VectorItem, 'distance'>[];

    expect(results.map((r) => r.name)).toEqual(['near', 'far']);
    expect(results[1].distance).toBeCloseTo(2, 5);
  }

  /** Ranked as a distance, the negated product, so the vector most aligned with the query comes first. */
  async shouldSortByInnerProduct() {
    await this.querier.insertMany(VectorItem, [
      { name: 'opposite', vec: [-1, 0, 0] },
      { name: 'aligned', vec: [2, 0, 0] },
      { name: 'orthogonal', vec: [0, 1, 0] },
    ]);

    const results = (await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [1, 0, 0], $distance: 'inner', $project: 'distance' } },
    })) as WithProjection<VectorItem, 'distance'>[];

    expect(results.map((r) => r.name)).toEqual(['aligned', 'orthogonal', 'opposite']);
    expect(results[0].distance).toBeCloseTo(-2, 5);
  }
}
