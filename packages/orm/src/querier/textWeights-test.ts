import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { provisioningTimeout } from '../test/index.js';
import { dropTables } from '../test/sqlPools.js';
import type { SqlQuerierPool } from '../type/index.js';

const TABLE = 'text_weight_doc';

@Index((doc) => [doc.title, doc.bodyText], { type: 'fulltext' })
@Entity({ name: TABLE })
class PlainDoc {
  @Id({ type: String, onInsert: uuidv7 }) id?: string;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) bodyText?: string | null;
}

/** The same table, its title now weighed: what an entity becomes once a weight is added to it. */
@Index((doc) => [{ column: doc.title, weight: 10 }, doc.bodyText], { type: 'fulltext' })
@Entity({ name: TABLE })
class WeightedDoc {
  @Id({ type: String, onInsert: uuidv7 }) id?: string;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) bodyText?: string | null;
}

/**
 * A weight added to a table that already has rows and a fulltext index, which is how an app gains one.
 * The MySQL family scores a heavier column through a fulltext index of its own, and InnoDB fills one added
 * beside another only once the table is optimized: MariaDB scores it 0, and MySQL can fail the rank outright.
 */
export function describeLoadedTextWeights(name: string, createPool: () => SqlQuerierPool): void {
  describe(`${name} text weights on a loaded table`, () => {
    const pool = createPool();
    const migrator = (entity: typeof PlainDoc | typeof WeightedDoc) => new Migrator(pool, { entities: [entity] });

    beforeAll(async () => {
      await migrator(PlainDoc).sync({ force: true });
      await pool.insertMany(PlainDoc, [
        { title: 'finch', bodyText: 'a kestrel kestrel kestrel nest' },
        { title: 'kestrel', bodyText: 'hovers' },
      ]);
      await migrator(WeightedDoc).sync();
    }, provisioningTimeout);

    afterAll(async () => {
      await dropTables(pool, TABLE);
      await pool.end();
    }, provisioningTimeout);

    it('should rank by a weight added once the table had rows', async () => {
      const found = await pool.findMany(WeightedDoc, {
        $select: { title: true },
        $where: { $text: { $value: 'kestrel' } },
        $sort: { $text: 'desc' },
      });
      expect(found.map((doc) => doc.title)).toEqual(['kestrel', 'finch']);
    });

    it('should plan nothing more once the weight is in place', async () => {
      expect(await migrator(WeightedDoc).planSync({ safe: false })).toEqual([]);
    });
  });
}
