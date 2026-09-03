import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { provisioningTimeout } from '../test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

const TABLE = 'maria_vector_index';

/** The column is declared nullable, which the generator has to override: MariaDB refuses otherwise. */
@Index(['vec'], { type: 'vector', distance: 'cosine', m: 8, name: 'ix_maria_vec' })
@Entity({ name: TABLE })
class MariaVectorIndexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', dimensions: 3 }) vec?: number[];
}

/** The same table before the index is declared on it, so `autoSync` has one to add. */
@Entity({ name: TABLE })
class MariaVectorUnindexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', dimensions: 3, nullable: false }) vec?: number[];
}

/**
 * MariaDB declares a vector index two ways - inside `CREATE TABLE`, and as `CREATE VECTOR INDEX`
 * (11.7+) - and taking the first for the only one is what used to keep `autoSync` from ever adding
 * one to a table that already existed. Only the server can say the statement is right, and nothing
 * here executed one before: the vector suite queries distances, which need no index at all.
 */
describe('MariaDB vector index', () => {
  const pool = new MariadbQuerierPool({
    host: '0.0.0.0',
    port: 3326,
    user: 'test',
    password: 'test',
    database: 'test',
    connectionLimit: 5,
  });

  const indexesOf = () =>
    pool.withQuerier((querier) =>
      querier.all<{ INDEX_NAME: string; INDEX_TYPE: string }>(
        `SELECT INDEX_NAME, INDEX_TYPE FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'`,
        [TABLE],
      ),
    );

  const drop = () => pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS \`${TABLE}\``));

  beforeAll(drop, provisioningTimeout);

  afterAll(async () => {
    await drop();
    await pool.end();
  }, provisioningTimeout);

  it('creates the index with the table it belongs to', async () => {
    await new Migrator(pool, { entities: [MariaVectorIndexed] }).autoSync({ logging: false });

    expect(await indexesOf()).toEqual([{ INDEX_NAME: 'ix_maria_vec', INDEX_TYPE: 'VECTOR' }]);
  });

  /**
   * The column has to be NOT NULL before the index can be added, which is why the unindexed entity
   * declares it so: the statement adds an index, never a column's nullability, and MariaDB answers
   * "All parts of a VECTOR index must be NOT NULL".
   */
  it('adds the index to a table that already exists', async () => {
    await drop();
    await new Migrator(pool, { entities: [MariaVectorUnindexed] }).autoSync({ logging: false });
    expect(await indexesOf()).toEqual([]);

    await new Migrator(pool, { entities: [MariaVectorIndexed] }).autoSync({ logging: false });

    expect(await indexesOf()).toEqual([{ INDEX_NAME: 'ix_maria_vec', INDEX_TYPE: 'VECTOR' }]);
  });

  /** `IF NOT EXISTS` is MariaDB's, and it is what keeps a second `autoSync` from failing on it. */
  it('leaves the index alone on a second sync', async () => {
    await new Migrator(pool, { entities: [MariaVectorIndexed] }).autoSync({ logging: false });

    expect(await indexesOf()).toEqual([{ INDEX_NAME: 'ix_maria_vec', INDEX_TYPE: 'VECTOR' }]);
  });
});
