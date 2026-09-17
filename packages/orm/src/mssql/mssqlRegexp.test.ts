import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { mssqlConnection, provisioningTimeout } from '../test/index.js';
import { MsSqlQuerierPool } from './mssqlQuerierPool.js';

@Entity({ name: 'mssql_regexp' })
class RegexpRow {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 50 }) name?: string;
}

/**
 * `$regex` against a live server, which no unit test can cover: `REGEXP_LIKE` needs the database at
 * compatibility level 170, and below that the emitted SQL parses as a call to a function that does
 * not exist - so only a server can say whether it is real. The container's database is at 170.
 */
describe('mssql $regex', () => {
  const pool = new MsSqlQuerierPool(mssqlConnection('test_regexp'));

  beforeAll(async () => {
    await new Migrator(pool, { entities: [RegexpRow] }).sync({ drop: true });
    await pool.withQuerier((querier) =>
      querier.insertMany(RegexpRow, [{ name: 'Alice' }, { name: 'Bob' }, { name: 'anna' }]),
    );
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "mssql_regexp"`));
    await pool.end();
  }, provisioningTimeout);

  it('should match with REGEXP_LIKE', async () => {
    const found = await pool.withQuerier((querier) =>
      querier.findMany(RegexpRow, { $where: { name: { $regex: '^A' } }, $sort: { name: 1 } }),
    );

    expect(found.map(({ name }) => name)).toEqual(['Alice']);
  });

  /** `REGEXP_LIKE` matches case-sensitively by default, whatever the column's collation. */
  it('should not fold case', async () => {
    const found = await pool.withQuerier((querier) =>
      querier.findMany(RegexpRow, { $where: { name: { $regex: '^a' } }, $sort: { name: 1 } }),
    );

    expect(found.map(({ name }) => name)).toEqual(['anna']);
  });
});
