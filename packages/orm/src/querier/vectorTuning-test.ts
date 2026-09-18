import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { provisioningTimeout } from '../test/index.js';
import type { SqlQuerierPool } from '../type/index.js';

const TABLE = 'vector_tuning';

@Index((tunedItem) => [tunedItem.vec], { type: 'hnsw', distance: 'cosine', name: 'ix_vector_tuning_vec' })
@Entity({ name: TABLE })
class TunedItem {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
  @Field({ type: 'vector', dimensions: 3 }) vec?: number[] | null;
}

/**
 * `$candidates` compiles to a `SET LOCAL` of each engine's own setting (`hnsw.ef_search`, CockroachDB's
 * `vector_search_beam_size`), which only the server can say is spelled right - one that does not exist is
 * an error, and one merely ignored leaves the query at the default recall. Nothing else executes these.
 */
export function describeVectorTuning(name: string, createPool: () => SqlQuerierPool): void {
  describe(`${name} query-time vector tuning`, () => {
    const pool = createPool();

    const seed = async () => {
      await new Migrator(pool, { entities: [TunedItem] }).sync({ logging: false });
      await pool.insertMany(TunedItem, [
        { name: 'north', vec: [0, 1, 0] },
        { name: 'east', vec: [1, 0, 0] },
        { name: 'northeast', vec: [Math.SQRT1_2, Math.SQRT1_2, 0] },
      ]);
    };

    beforeAll(async () => {
      await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
      await seed();
    }, provisioningTimeout);

    afterAll(async () => {
      await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
      await pool.end();
    }, provisioningTimeout);

    it('should run a tuned vector search inside a transaction', async () => {
      const rows = await pool.transaction((querier) =>
        querier.findMany(TunedItem, {
          $select: { name: true },
          $sort: { vec: { $vector: [0, 1, 0] } },
          $limit: 3,
          $candidates: 100,
        }),
      );

      expect(rows.map((row) => row.name)).toEqual(['north', 'northeast', 'east']);
    });

    /** On Postgres the predicate adds `hnsw.iterative_scan`, so this is the statement pair, not just the one. */
    it('should run a tuned vector search that also filters by distance', async () => {
      const rows = await pool.transaction((querier) =>
        querier.findMany(TunedItem, {
          $select: { name: true },
          $where: { vec: { $near: { $vector: [0, 1, 0], $lt: 0.5 } } },
          $sort: { vec: { $vector: [0, 1, 0] } },
          $limit: 3,
          $candidates: 100,
        }),
      );

      expect(rows.map((row) => row.name)).toEqual(['north', 'northeast']);
    });

    /**
     * `SET LOCAL` outside a transaction is accepted by the server and applies to nothing, so the query
     * would run at the default recall while looking tuned. Refused rather than emitted.
     */
    it('should refuse to tune outside a transaction', async () => {
      await expect(
        pool.findMany(TunedItem, {
          $sort: { vec: { $vector: [0, 1, 0] } },
          $limit: 3,
          $candidates: 100,
        }),
      ).rejects.toThrow(`$candidates requires an open transaction on ${pool.dialect.dialectName}`);
    });

    /** No ANN index on the column means no knob to turn, so the query runs untuned rather than failing. */
    it('should ignore $candidates on a field with no vector index', async () => {
      const rows = await pool.findMany(TunedItem, {
        $select: { name: true },
        $sort: { name: 'asc' },
        $limit: 1,
        $candidates: 100,
      });

      expect(rows.map((row) => row.name)).toEqual(['east']);
    });
  });
}
