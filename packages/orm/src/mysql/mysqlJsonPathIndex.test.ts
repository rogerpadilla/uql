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

const TABLE = 'mysql_json_path_index';

/** Enough rows that a scan is the more expensive plan, so the planner's choice means something. */
const ROWS = 1000;

@Index((jsonPathIndexed) => [{ column: jsonPathIndexed.kind, jsonPath: { path: 'name', type: String, length: 32 } }], {
  name: 'ix_json_name',
})
@Index((jsonPathIndexed) => [{ column: jsonPathIndexed.kind, jsonPath: { path: 'score', type: Number } }], {
  name: 'ix_json_score',
})
@Entity({ name: TABLE })
class JsonPathIndexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'json' }) kind?: Json<{ name: string; score: number }> | null;
}

/**
 * The planner matches an index over a JSON path back to the query by the expression's text, and a
 * number only when the value it is compared with is cast alike, which mysql2 would otherwise inline
 * as an integer. So the plan asked for is the one for the statement `find` builds.
 */
describe('MySQL JSON path index', () => {
  const pool = new MySql2QuerierPool(mysqlConnection());
  const dialect = new MySqlDialect();

  const planFor = (where: object) =>
    pool.withQuerier((querier) => {
      const ctx = dialect.createContext();
      dialect.find(ctx, JsonPathIndexed, { $select: { id: true }, $where: where });
      return querier.all(`EXPLAIN ${ctx.sql}`, ctx.values).then(JSON.stringify);
    });

  beforeAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS \`${TABLE}\``));
    await new Migrator(pool, { entities: [JsonPathIndexed] }).sync({ logging: false });
    await pool.insertMany(
      JsonPathIndexed,
      Array.from({ length: ROWS }, (_, n) => ({ kind: { name: `n${n}`, score: n + 0.5 } })),
    );
    await pool.withQuerier((querier) => querier.run(`ANALYZE TABLE \`${TABLE}\``));
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS \`${TABLE}\``));
    await pool.end();
  }, provisioningTimeout);

  it('should answer a text path from its index', async () => {
    expect(await planFor({ 'kind.name': 'n7' })).toContain('ix_json_name');
    expect(await planFor({ 'kind.name': { $in: ['n7', 'n8'] } })).toContain('ix_json_name');
  });

  it('should answer a numeric path from its index', async () => {
    expect(await planFor({ 'kind.score': { $gte: ROWS - 5 } })).toContain('ix_json_score');
    expect(await planFor({ 'kind.score': 7.5 })).toContain('ix_json_score');
    expect(await planFor({ 'kind.score': { $between: [7, 8] } })).toContain('ix_json_score');
  });

  it('should find the rows it indexed', async () => {
    const byName = await pool.findMany(JsonPathIndexed, { $select: { id: true }, $where: { 'kind.name': 'n7' } });
    const byScore = await pool.findMany(JsonPathIndexed, {
      $select: { id: true },
      $where: { 'kind.score': { $gte: ROWS - 5 } },
    });

    expect(byName).toHaveLength(1);
    expect(byScore).toHaveLength(5);
  });

  it('should report no drift for the indexes it just created', async () => {
    const introspector = new MysqlSchemaIntrospector(pool);
    const actual = await introspector.introspect([TABLE]);
    const expected = buildSchemaAST([JsonPathIndexed], { namingStrategy: dialect.namingStrategy });

    const report = detectDrift(expected, actual, { dialect });

    expect(report.drifts.filter((drift) => drift.table === TABLE)).toEqual([]);
  });
});
