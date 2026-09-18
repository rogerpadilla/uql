import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { provisioningTimeout } from '../test/index.js';
import { isMongoQuerier, isSqlQuerier, type MigratorDialect, type Querier, type QuerierPool } from '../type/index.js';

const TABLE = 'text_search_doc';

@Index((doc) => [doc.title, doc.bodyText], { type: 'fulltext', config: 'english' })
@Entity({ name: TABLE })
class TextDoc {
  @Id({ type: String, onInsert: uuidv7 }) id?: string;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) bodyText?: string | null;
}

/** The table or collection gone, so each run builds its index afresh on a database that outlives it. */
async function dropDocs(querier: Querier): Promise<void> {
  if (isMongoQuerier(querier)) {
    await querier.db.collection(TABLE).drop();
  }
  if (isSqlQuerier(querier)) {
    await querier.run(`DROP TABLE IF EXISTS ${querier.dialect.escapeId(TABLE)}`);
  }
}

/**
 * `$text` over the fulltext index an entity declares, which migrations create on each engine that has one:
 * MySQL's `FULLTEXT`, MongoDB's text index, a `GIN` one over the Postgres family's document. The same
 * entity and query everywhere, so an engine that spells either differently fails here, not in production.
 */
export function describeTextSearch(name: string, createPool: () => QuerierPool<Querier, MigratorDialect>): void {
  describe(`${name} text search`, () => {
    const pool = createPool();
    const migrator = () => new Migrator(pool, { entities: [TextDoc] });
    const search = async (value: string) => {
      const found = await pool.withQuerier((querier) =>
        querier.findMany(TextDoc, { $select: { title: true }, $where: { $text: { $value: value } } }),
      );
      return found.map((doc) => doc.title);
    };

    beforeAll(async () => {
      await pool.withQuerier(dropDocs);
      await migrator().sync({ logging: false });
      await pool.withQuerier(async (querier) => {
        await querier.insertMany(TextDoc, [
          { title: 'zebrafish', bodyText: 'swims in the river' },
          { title: 'lighthouse', bodyText: null },
          { title: 'teapot', bodyText: 'boils water' },
        ]);
      });
    }, provisioningTimeout);

    afterAll(() => pool.end());

    it('should plan nothing more once the index exists', async () => {
      expect(await migrator().planSync()).toEqual([]);
    });

    it('should find a row by a word of either column', async () => {
      expect(await search('river')).toEqual(['zebrafish']);
    });

    /** A `NULL` in one column leaves the others searchable. */
    it('should find a row whose other column is null', async () => {
      expect(await search('lighthouse')).toEqual(['lighthouse']);
    });
  });
}
