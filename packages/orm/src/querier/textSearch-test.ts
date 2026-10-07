import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { TEXT_SCORE_ALIAS } from '../dialect/aliases.js';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { provisioningTimeout } from '../test/index.js';
import type { MigratorDialect, Querier, QuerierPool, WithProjection } from '../type/index.js';

@Index((doc) => [{ column: doc.title, weight: 10 }, doc.bodyText], { type: 'fulltext', config: 'english' })
@Entity({ name: 'text_search_doc' })
class TextDoc {
  @Id({ type: String, onInsert: uuidv7 }) id?: string;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) bodyText?: string | null;
}

/**
 * `$text` over the fulltext index an entity declares, which migrations create on each engine that has one:
 * MySQL's `FULLTEXT`, MongoDB's text index, a `GIN` one over the Postgres family's document. The same
 * entity and query everywhere, so an engine that spells either differently fails here, not in production.
 */
export function describeTextSearch(name: string, createPool: () => QuerierPool<Querier, MigratorDialect>): void {
  describe(`${name} text search`, () => {
    const pool = createPool();
    const migrator = new Migrator(pool, { entities: [TextDoc] });
    const search = async (value: string) => {
      const found = await pool.findMany(TextDoc, {
        $select: { title: true },
        $where: { $text: { $value: value } },
        $sort: { $text: 'desc' },
      });
      return found.map((doc) => doc.title);
    };

    /** Each pair less relevant first, so only the ranking puts the other ahead. */
    beforeAll(async () => {
      await migrator.sync({ force: true });
      await pool.insertMany(TextDoc, [
        { title: 'zebrafish', bodyText: 'swims in the river' },
        { title: 'lighthouse', bodyText: null },
        { title: 'teapot', bodyText: 'boils water' },
        { title: 'heron', bodyText: 'watches an otter' },
        { title: 'otter', bodyText: 'an otter otter family' },
        { title: 'finch', bodyText: 'a kestrel kestrel kestrel nest' },
        { title: 'kestrel', bodyText: 'hovers' },
        { title: 'wren', bodyText: 'sings to a plover' },
        { title: 'plover', bodyText: 'plover chicks' },
      ]);
    }, provisioningTimeout);

    afterAll(async () => {
      await migrator.executeSyncStatements((await migrator.getSchemaGenerator()).generateDropSchema([TextDoc]), {});
      await pool.end();
    }, provisioningTimeout);

    it('should rank rows by relevance to the search', async () => {
      expect(await search('otter')).toEqual(['otter', 'heron']);
    });

    /** A title match outweighs three in the body. */
    it('should rank a match by the weight of the column it is in', async () => {
      expect(await search('kestrel')).toEqual(['kestrel', 'finch']);
    });

    /** The relevance each row was ranked by, under a name of the caller's, highest first. */
    it('should answer the relevance it ranks by', async () => {
      const found = (await pool.findMany(TextDoc, {
        $select: { title: true },
        $where: { $text: { $value: 'kestrel' } },
        $sort: { $text: { $project: 'score' } },
      })) as WithProjection<TextDoc, 'score'>[];
      expect(found.map((doc) => doc.title)).toEqual(['kestrel', 'finch']);
      expect(found[0].score).toBeGreaterThan(found[1].score);
    });

    /** Least relevant first, either way it is asked for, and no field of UQL's own left on a row. */
    it('should rank the other way when asked', async () => {
      const kestrel = { $select: { title: true }, $where: { $text: { $value: 'kestrel' } } } as const;
      const plain = await pool.findMany(TextDoc, { ...kestrel, $sort: { $text: 'asc' } });
      const projected = (await pool.findMany(TextDoc, {
        ...kestrel,
        $sort: { $text: { $project: 'score', $order: 'asc' } },
      })) as WithProjection<TextDoc, 'score'>[];
      expect(plain.map((doc) => doc.title)).toEqual(['finch', 'kestrel']);
      expect(plain[0]).not.toHaveProperty(TEXT_SCORE_ALIAS);
      expect(projected.map((doc) => doc.title)).toEqual(['finch', 'kestrel']);
      expect(projected[0].score).toBeLessThan(projected[1].score);
    });

    /** A paged write settles its rows through the read, so the one it touches is the most relevant. */
    it('should write only the most relevant rows a page names', async () => {
      onTestFinished(async () => {
        await pool.updateMany(TextDoc, { $where: { title: 'plover' } }, { bodyText: 'plover chicks' });
      });
      const changed = await pool.updateMany(
        TextDoc,
        { $where: { $text: { $value: 'plover' } }, $sort: { $text: 'desc' }, $limit: 1 },
        { bodyText: 'ringed' },
      );
      const found = await pool.findMany(TextDoc, {
        $select: { title: true, bodyText: true },
        $where: { title: { $in: ['wren', 'plover'] } },
        $sort: { title: 'asc' },
      });
      expect(changed).toBe(1);
      expect(found.map((doc) => [doc.title, doc.bodyText])).toEqual([
        ['plover', 'ringed'],
        ['wren', 'sings to a plover'],
      ]);
    });

    it('should plan nothing more once the index exists', async () => {
      expect(await migrator.planSync({ safe: false })).toEqual([]);
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
