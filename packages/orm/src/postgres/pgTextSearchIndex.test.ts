import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { queryPlanOf } from '../querier/jsonPathIndex-test.js';
import { postgresConnection, provisioningTimeout } from '../test/index.js';
import { dropTables } from '../test/sqlPools.js';
import { sql } from '../util/sql.js';
import { PgQuerierPool } from './pgQuerierPool.js';

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
  const planFor = (text: { $value: string; $config?: string }) =>
    queryPlanOf(pool, SearchableDoc, { $text: { $fields: { body: true }, ...text } });

  beforeAll(async () => {
    await new Migrator(pool, { entities: [SearchableDoc] }).sync({ force: true });
    await pool.insertMany(
      SearchableDoc,
      Array.from({ length: ROWS }, (_, n) => ({ body: `row ${n} ${n % 500 === 0 ? 'zebrafish' : `filler${n}`}` })),
    );
    await pool.run(sql.text(`ANALYZE ${TABLE}`));
  }, provisioningTimeout);

  afterAll(async () => {
    await dropTables(pool, TABLE);
    await pool.end();
  }, provisioningTimeout);

  it("should answer a search from the index under the index's own config", async () => {
    expect(await planFor({ $value: 'zebrafish' })).toContain('ix_body_fts');
    expect(await planFor({ $value: 'zebrafish', $config: 'english' })).toContain('ix_body_fts');
  });

  it('should scan for a search under another config, which the index was not built with', async () => {
    expect(await planFor({ $value: 'zebrafish', $config: 'simple' })).not.toContain('ix_body_fts');
  });
});
