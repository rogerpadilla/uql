import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { mysqlConnection, provisioningTimeout } from '../test/index.js';
import type { Json } from '../type/index.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

const TABLE = 'mysql_json_elem_match';

/** The row count, with the index below, at which 26.7 starts planning the subquery as a semijoin materialization. */
const ROWS = 1000;

@Index((elemMatched) => [{ column: elemMatched.tags, jsonArray: { type: String, length: 64 } }])
@Entity({ name: TABLE })
class ElemMatched {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'json' }) items?: Json<{ name: string }[]>;
  @Field({ type: 'json' }) tags?: Json<string[]>;
}

/**
 * `$elemMatch` reads each row's array through a correlated `JSON_TABLE`, which MySQL 26.7 may turn into a
 * semijoin it materializes once for the whole table, answering for every row what the first one says.
 * Only the planner decides when, so the table is the shape it was caught on.
 */
describe('MySQL JSON $elemMatch', () => {
  const pool = new MySql2QuerierPool(mysqlConnection());

  beforeAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS \`${TABLE}\``));
    await new Migrator(pool, { entities: [ElemMatched] }).sync({ logging: false });
    await pool.insertMany(
      ElemMatched,
      Array.from({ length: ROWS }, (_, n) => ({ items: [{ name: `n${n}` }], tags: [`t${n}`] })),
    );
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS \`${TABLE}\``));
    await pool.end();
  }, provisioningTimeout);

  it('should count only the rows with a matching element', async () => {
    const counted = await pool.count(ElemMatched, {
      $where: { items: { $elemMatch: { name: { $startsWith: 'n1' } } } },
    });

    expect(counted).toBe(111);
  });

  it('should count only the rows without one under a negation', async () => {
    const counted = await pool.count(ElemMatched, {
      $where: { items: { $not: { $elemMatch: { name: { $startsWith: 'n1' } } } } },
    });

    expect(counted).toBe(ROWS - 111);
  });
});
