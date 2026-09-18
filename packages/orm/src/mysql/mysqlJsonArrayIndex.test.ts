import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { detectDrift } from '../migrate/drift/index.js';
import { MysqlSchemaIntrospector } from '../migrate/introspection/mysqlIntrospector.js';
import { Migrator } from '../migrate/migrator.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { mysqlConnection, provisioningTimeout } from '../test/index.js';
import type { Json } from '../type/index.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';
import { MySqlDialect } from './mysqlDialect.js';

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
 * the engine can say whether the two met. So the plan asked for below is the one for the statement
 * `find` builds, not for a hand-written lookalike of it.
 */
describe('MySQL JSON array index', () => {
  const pool = new MySql2QuerierPool(mysqlConnection());
  const dialect = new MySqlDialect();

  beforeAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS \`${TABLE}\``));
    await new Migrator(pool, { entities: [JsonArrayIndexed] }).sync({ logging: false });
    await pool.withQuerier(async (querier) => {
      await querier.insertMany(
        JsonArrayIndexed,
        Array.from({ length: ROWS }, (_, n) => ({ tags: [`t${n}`, 'everyrow'] })),
      );
      await querier.run(`ANALYZE TABLE \`${TABLE}\``);
    });
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS \`${TABLE}\``));
    await pool.end();
  }, provisioningTimeout);

  const planFor = (tags: object) =>
    pool.withQuerier((querier) => {
      const ctx = dialect.createContext();
      dialect.find(ctx, JsonArrayIndexed, { $select: { id: true }, $where: { tags } });
      return querier.all(`EXPLAIN ${ctx.sql}`, ctx.values).then(JSON.stringify);
    });

  it('should answer $all from the index', async () => {
    expect(await planFor({ $all: ['t7'] })).toContain('ix_json_tags');
  });

  it('should answer an element equal to one value, or to one of several, from the index', async () => {
    expect(await planFor({ $elemMatch: { $eq: 't7' } })).toContain('ix_json_tags');
    expect(await planFor({ $elemMatch: { $in: ['t7', 't8'] } })).toContain('ix_json_tags');
  });

  it('should find the rows it indexed', async () => {
    const byAll = await pool.findMany(JsonArrayIndexed, { $select: { id: true }, $where: { tags: { $all: ['t7'] } } });
    const byElemIn = await pool.findMany(JsonArrayIndexed, {
      $select: { id: true },
      $where: { tags: { $elemMatch: { $in: ['t7', 't8'] } } },
    });

    expect(byAll).toHaveLength(1);
    expect(byElemIn).toHaveLength(2);
  });

  /** The server states no column name for a multi-valued key part, which diffing has to survive. */
  it('should report no drift for the index it just created', async () => {
    const introspector = new MysqlSchemaIntrospector(pool);
    const actual = await introspector.introspect();
    const expected = buildSchemaAST([JsonArrayIndexed], { namingStrategy: dialect.namingStrategy });

    const report = detectDrift(expected, actual, { dialect, indexFacets: introspector.indexFacets });

    expect(report.drifts.filter((drift) => drift.table === TABLE)).toEqual([]);
  });
});
