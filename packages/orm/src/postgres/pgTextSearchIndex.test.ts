import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { postgresConnection, provisioningTimeout } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';
import { PostgresDialect } from './postgresDialect.js';

const TABLE = 'pg_text_search_index';

/** Enough rows that a scan is the cheaper plan, so the planner's choice means something. */
const ROWS = 2000;

@Index((doc) => [doc.body], { name: 'ix_body_fts', type: 'fulltext', config: 'english' })
@Entity({ name: TABLE })
class SearchableDoc {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
}

/**
 * A `fulltext` index is a `GIN` one over the document `$text` matches, which the planner serves a search
 * from when both parse with one config. As with a JSON path index, the plan asked for is the one for the
 * statement `find` builds.
 */
describe('PostgreSQL text search index', () => {
  const pool = new PgQuerierPool(postgresConnection());
  const dialect = new PostgresDialect({});

  const planFor = (text: { $value: string; $config?: string }) =>
    pool.withQuerier((querier) => {
      const ctx = dialect.createContext();
      dialect.find(ctx, SearchableDoc, {
        $select: { id: true },
        $where: { $text: { $fields: { body: true }, ...text } },
      });
      return querier.all(`EXPLAIN ${ctx.sql}`, ctx.values).then(JSON.stringify);
    });

  beforeAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
    await new Migrator(pool, { entities: [SearchableDoc] }).sync({ logging: false });
    await pool.withQuerier(async (querier) => {
      await querier.insertMany(
        SearchableDoc,
        Array.from({ length: ROWS }, (_, n) => ({ body: `row ${n} ${n % 500 === 0 ? 'zebrafish' : `filler${n}`}` })),
      );
      await querier.run(`ANALYZE "${TABLE}"`);
    });
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
    await pool.end();
  }, provisioningTimeout);

  it("should answer a search from the index under the index's own config", async () => {
    expect(await planFor({ $value: 'zebrafish' })).toContain('ix_body_fts');
    expect(await planFor({ $value: 'zebrafish', $config: 'english' })).toContain('ix_body_fts');
  });

  it('should scan for a search under another config, which the index was not built with', async () => {
    expect(await planFor({ $value: 'zebrafish', $config: 'simple' })).not.toContain('ix_body_fts');
  });

  it('should find the rows it indexed', async () => {
    const found = await pool.withQuerier((querier) =>
      querier.findMany(SearchableDoc, {
        $select: { id: true },
        $where: { $text: { $fields: { body: true }, $value: 'zebrafish', $config: 'english' } },
      }),
    );

    expect(found).toHaveLength(ROWS / 500);
  });
});
