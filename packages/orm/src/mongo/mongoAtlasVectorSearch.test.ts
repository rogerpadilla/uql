import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { mongoUri, provisioningTimeout } from '../test/index.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

const COLLECTION = 'atlas_vector_chunk';

@Index((chunk) => [chunk.embedding, chunk.tenant], { type: 'vectorSearch' })
@Entity({ name: COLLECTION })
class Chunk {
  @Id({ type: String }) id?: string;
  @Field({ type: String }) tenant?: string | null;
  @Field({ type: Number }) degrees?: number | null;
  @Field({ type: 'vector', dimensions: 2 }) embedding?: number[] | null;
}

const at = (degrees: number) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];

/**
 * The Atlas vector search index as migrations create it, and `$vectorSearch` reading it. Atlas indexes
 * the documents after answering, and reports a recreated index queryable before then, so the suite waits
 * until a search finds them all.
 */
describe('MongoDB Atlas vector search', () => {
  const pool = new MongodbQuerierPool(mongoUri('uql_atlas'));
  const migrator = () => new Migrator(pool, { entities: [Chunk] });

  beforeAll(async () => {
    await pool.withQuerier((querier) =>
      querier.db
        .collection(COLLECTION)
        .drop()
        .catch(() => undefined),
    );
    await migrator().sync({ logging: false });
    await pool.withQuerier(async (querier) => {
      await querier.insertMany(
        Chunk,
        Array.from({ length: 36 }, (_, n) => ({
          tenant: n % 2 ? 'odd' : 'even',
          degrees: n * 10,
          embedding: at(n * 10),
        })),
      );
      const collection = querier.db.collection(COLLECTION);
      const search = {
        $vectorSearch: {
          index: 'embedding_index',
          path: 'embedding',
          queryVector: at(0),
          numCandidates: 36,
          limit: 36,
        },
      };
      for (let tries = 0; ; tries++) {
        const indexed = await collection
          .aggregate([search])
          .toArray()
          .catch(() => []);
        if (indexed.length === 36) {
          break;
        }
        if (tries > 120) {
          throw new Error('the vector search index never indexed every document');
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    });
  }, provisioningTimeout * 2);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.db.collection(COLLECTION).drop());
    await pool.end();
  });

  it('should plan nothing more once the index exists', async () => {
    expect(await migrator().planSync()).toEqual([]);
  });

  it('should rank the nearest documents through the index', async () => {
    const found = await pool.withQuerier((querier) =>
      querier.findMany(Chunk, { $select: { degrees: true }, $sort: { embedding: { $vector: at(90) } }, $limit: 3 }),
    );
    const degrees = found.map((doc) => doc.degrees);

    // 80 and 100 are as near as each other, so only the first place is fixed.
    expect(degrees[0]).toBe(90);
    expect(degrees.sort()).toEqual([100, 80, 90]);
  });

  it('should pre-filter on a field the index declares', async () => {
    const found = await pool.withQuerier((querier) =>
      querier.findMany(Chunk, {
        $select: { degrees: true },
        $where: { tenant: 'even' },
        $sort: { embedding: { $vector: at(90) } },
        $limit: 2,
      }),
    );

    // 90 is odd, so its two even neighbours are nearest.
    expect(found.map((doc) => doc.degrees).sort()).toEqual([100, 80]);
  });
});
