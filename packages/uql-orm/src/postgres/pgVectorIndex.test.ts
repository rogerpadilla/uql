import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { provisioningTimeout } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';

const TABLE = 'pg_vector_index';

@Index(['vec'], { type: 'hnsw', distance: 'cosine', m: 8, efConstruction: 32, name: 'ix_pg_vec' })
@Entity({ name: TABLE })
class PgVectorIndexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', dimensions: 3 }) vec?: number[];
}

/** The same table before the index is declared, so a sync has one to add. */
@Entity({ name: TABLE })
class PgVectorUnindexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', dimensions: 3 }) vec?: number[];
}

/**
 * pgvector's index DDL carries an operator class and its own `WITH` options - `USING hnsw (vec
 * vector_cosine_ops) WITH (m = 8, ef_construction = 32)` - none of which a unit test can validate: a
 * wrong operator class parses as an identifier and only the server rejects it. MariaDB's vector index
 * has had this cover since it shipped; Postgres, the dialect most people use it on, had none.
 */
describe('pgvector index', () => {
  const pool = new PgQuerierPool({
    host: '0.0.0.0',
    port: 5442,
    user: 'test',
    password: 'test',
    database: 'test_pg',
  });

  const indexesOf = () =>
    pool.withQuerier((querier) =>
      querier.all<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1 AND indexname <> $2`,
        [TABLE, `${TABLE}__id_pk`],
      ),
    );

  const drop = () => pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));

  beforeAll(drop, provisioningTimeout);

  afterAll(async () => {
    await drop();
    await pool.end();
  }, provisioningTimeout);

  it('creates the index with the table it belongs to', async () => {
    await new Migrator(pool, { entities: [PgVectorIndexed] }).sync({ logging: false });

    const [index, ...rest] = await indexesOf();
    expect(rest).toEqual([]);
    expect(index.indexname).toBe('ix_pg_vec');
    // The operator class is what makes the index answer a cosine search rather than an L2 one.
    expect(index.indexdef).toContain('USING hnsw');
    expect(index.indexdef).toContain('vector_cosine_ops');
    expect(index.indexdef).toContain("m='8'");
    expect(index.indexdef).toContain("ef_construction='32'");
  });

  it('adds the index to a table that already exists', async () => {
    await drop();
    await new Migrator(pool, { entities: [PgVectorUnindexed] }).sync({ logging: false });
    expect(await indexesOf()).toEqual([]);

    await new Migrator(pool, { entities: [PgVectorIndexed] }).sync({ logging: false });

    expect((await indexesOf()).map((it) => it.indexname)).toEqual(['ix_pg_vec']);
  });

  it('leaves the index alone on a second sync', async () => {
    const migrator = new Migrator(pool, { entities: [PgVectorIndexed] });
    await migrator.sync({ logging: false });

    expect(await migrator.planSync()).toEqual([]);
    expect((await indexesOf()).map((it) => it.indexname)).toEqual(['ix_pg_vec']);
  });
});
