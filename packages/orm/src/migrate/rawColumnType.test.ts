import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index, removeEntity } from '../entity/index.js';
import { PgQuerierPool } from '../postgres/pgQuerierPool.js';
import { postgresConnection, provisioningTimeout } from '../test/index.js';
import { raw } from '../util/index.js';
import { Migrator } from './migrator.js';

const TABLE = 'RawColumnTypeCaption';

/**
 * An engine's own type, which uql models no family for, carrying the search vector a full-text query
 * ranks by. Only Postgres is driven here: every dialect renders a column type through the one
 * `canonicalTypeToSql`, which returns a raw one verbatim before any engine mapping is consulted.
 */
@Index((caption) => [caption.searchVector], { name: 'rct_search_idx', type: 'gin' })
@Entity({ name: TABLE })
class Caption {
  @Id({ type: Number }) id?: number;

  @Field({ type: String }) text?: string | null;

  @Field({
    type: String,
    columnType: raw`tsvector`,
    computed: (caption) => raw`to_tsvector('simple', coalesce(${caption.text}, ''))`,
    stored: true,
    eager: false,
  })
  readonly searchVector?: string | null;
}

describe('a raw column type (PostgreSQL)', () => {
  const pool = new PgQuerierPool(postgresConnection());
  const migrator = new Migrator(pool, { entities: [Caption] });

  beforeAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
    await migrator.sync({ logging: false });
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
    await pool.end();
    removeEntity(Caption);
  }, provisioningTimeout);

  it('should create the column as the engine spells it', async () => {
    const [column] = await pool.all<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name = '${TABLE}' AND column_name = 'searchVector'`,
    );
    expect(column.data_type).toBe('tsvector');
  });

  it('should keep the generated expression the engine fills', async () => {
    await pool.insertOne(Caption, { text: 'la reunión del proyecto' });
    const [row] = await pool.all<{ hit: boolean }>(
      `SELECT "searchVector" @@ to_tsquery('simple', 'proyecto') AS hit FROM "${TABLE}"`,
    );
    expect(row.hit).toBe(true);
  });

  it('should index it, which is why the column needs the engine type and not a text one', async () => {
    const indexes = await pool.all<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = '${TABLE}'`,
    );
    expect(indexes.map((it) => it.indexname)).toContain('rct_search_idx');
  });

  // The entity renders `tsvector` and the catalogue reports `tsvector`, so neither side translates it.
  it('should report no drift against the schema it just created', async () => {
    expect(await migrator.planSync()).toEqual([]);
  });
});
