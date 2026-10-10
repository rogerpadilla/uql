import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { queryPlanOf } from '../querier/jsonPathIndex-test.js';
import { driftOf } from '../test/drift.js';
import { mysqlConnection, provisioningTimeout } from '../test/index.js';
import { dropTables } from '../test/sqlPools.js';
import type { Json, QueryWhere } from '../type/index.js';
import { sql } from '../util/sql.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

const TABLE = 'mysql_json_array_index';

/** Enough rows that a scan is the more expensive plan, so the planner's choice means something. */
const ROWS = 1000;

/** The array is the whole column, which `$all`'s `JSON_CONTAINS` and `$elemMatch`'s `MEMBER OF` name. */
@Index((jsonArrayIndexed) => [{ column: jsonArrayIndexed.tags, jsonArray: { type: String, length: 64 } }], {
  name: 'ix_json_tags',
})
@Entity({ name: TABLE })
class JsonArrayIndexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'json' }) tags?: Json<string[]> | null;
}

/**
 * A multi-valued index only pays off if the planner matches it back to the query, which it does by
 * the expression's own text: the entity declares the array, the dialect compiles the cast, and only
 * the engine can say whether the two met.
 */
describe('MySQL JSON array index', () => {
  const pool = new MySql2QuerierPool(mysqlConnection());
  const plan = (where: QueryWhere<JsonArrayIndexed>) => queryPlanOf(pool, JsonArrayIndexed, where);

  beforeAll(async () => {
    await new Migrator(pool, { entities: [JsonArrayIndexed] }).sync({ force: true });
    await pool.insertMany(
      JsonArrayIndexed,
      Array.from({ length: ROWS }, (_, n) => ({ tags: [`t${n}`, 'everyrow'] })),
    );
    await pool.run(sql.text(`ANALYZE TABLE ${TABLE}`));
  }, provisioningTimeout);

  afterAll(async () => {
    await dropTables(pool, TABLE);
    await pool.end();
  }, provisioningTimeout);

  it('should answer $all from the index', async () => {
    expect(await plan({ tags: { $all: ['t7'] } })).toContain('ix_json_tags');
  });

  it('should answer an element equal to one value, or to one of several, from the index', async () => {
    expect(await plan({ tags: { $elemMatch: { $eq: 't7' } } })).toContain('ix_json_tags');
    expect(await plan({ tags: { $elemMatch: { $in: ['t7', 't8'] } } })).toContain('ix_json_tags');
  });

  it('should find the rows it indexed', async () => {
    expect(await pool.count(JsonArrayIndexed, { $where: { tags: { $all: ['t7'] } } })).toBe(1);
    expect(await pool.count(JsonArrayIndexed, { $where: { tags: { $elemMatch: { $in: ['t7', 't8'] } } } })).toBe(2);
  });

  /** The server states no column name for a multi-valued key part, which diffing has to survive. */
  it('should report no drift for the index it just created', async () => {
    expect(await driftOf(pool, JsonArrayIndexed, TABLE)).toEqual([]);
  });
});
