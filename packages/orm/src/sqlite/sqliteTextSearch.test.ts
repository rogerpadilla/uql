import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import type { WithScore } from '../type/index.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

/** An FTS5 table, which SQLite's `$text` searches: UQL does not create one, so it is made here by hand. */
@Entity({ name: 'fts_doc' })
class FtsDoc {
  @Id({ type: Number, name: 'rowid' }) id?: number;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) bodyText?: string | null;
}

/** `$text` against a real FTS5 table: the query bound whole, column filter and all. */
describe('SQLite text search', () => {
  const pool = new Sqlite3QuerierPool(':memory:');
  const search = ($value: string) =>
    pool.withQuerier((querier) =>
      querier.findMany(FtsDoc, {
        $select: { title: true },
        $where: { $text: { $fields: { title: true, bodyText: true }, $value } },
        $sort: { $text: { $project: 'score' } },
      }),
    ) as Promise<WithScore<FtsDoc, 'score'>[]>;

  beforeAll(async () => {
    await pool.withQuerier(async (querier) => {
      await querier.run('CREATE VIRTUAL TABLE fts_doc USING fts5(title, bodyText)');
      await querier.run(
        "INSERT INTO fts_doc (title, bodyText) VALUES ('red chair', 'a lamp'), ('heron', 'watches an otter'), ('otter', 'an otter otter family')",
      );
    });
  });

  afterAll(() => pool.end());

  it('should rank the rows naming a word most often first', async () => {
    const found = await search('otter');
    expect(found.map((doc) => doc.title)).toEqual(['otter', 'heron']);
    expect(found[0].score).toBeGreaterThan(found[1].score);
  });

  it('should find every word, whichever column holds it', async () => {
    expect((await search('red lamp')).map((doc) => doc.title)).toEqual(['red chair']);
  });

  /** Quotes, parentheses and operators are text around words to match, never FTS5 syntax that could fail. */
  it('should read punctuation a person types as words', async () => {
    expect((await search('"otter (family)')).map((doc) => doc.title)).toEqual(['otter']);
  });
});
