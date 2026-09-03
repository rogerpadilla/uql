import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { detectDrift } from '../migrate/drift/index.js';
import { PostgresSchemaIntrospector } from '../migrate/introspection/postgresIntrospector.js';
import { Migrator } from '../migrate/migrator.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { provisioningTimeout } from '../test/index.js';
import type { Json } from '../type/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';
import { PostgresDialect } from './postgresDialect.js';

const TABLE = 'pg_json_path_index';

/** Enough rows that a scan is the cheaper plan, so the planner's choice means something. */
const ROWS = 1000;

@Index([{ column: 'kind', jsonPath: { path: 'name', type: String } }], { name: 'ix_json_name' })
@Index([{ column: 'kind', jsonPath: { path: 'score', type: Number } }], { name: 'ix_json_score' })
@Entity({ name: TABLE })
class JsonPathIndexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'jsonb' }) kind?: Json<{ name: string; score: number }>;
}

/**
 * A JSON path index only pays off if the planner matches it back to the query, which it does by the
 * expression's own text: the entity declares the path, the dialect compiles both ends of it through
 * one `jsonPathExpr`, and only the engine can say whether the two met. So the plan asked for below
 * is the one for the statement `find` builds, never a hand-written lookalike of it.
 */
describe('PostgreSQL JSON path index', () => {
  const pool = new PgQuerierPool({ host: '0.0.0.0', port: 5442, user: 'test', password: 'test', database: 'test' });
  const dialect = new PostgresDialect({});

  const planFor = (where: object) =>
    pool.withQuerier((querier) => {
      const ctx = dialect.createContext();
      dialect.find(ctx, JsonPathIndexed, { $select: { id: true }, $where: where });
      return querier.all(`EXPLAIN ${ctx.sql}`, ctx.values).then(JSON.stringify);
    });

  beforeAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
    await new Migrator(pool, { entities: [JsonPathIndexed] }).autoSync({ logging: false });
    await pool.withQuerier(async (querier) => {
      await querier.insertMany(
        JsonPathIndexed,
        Array.from({ length: ROWS }, (_, n) => ({ kind: { name: `n${n}`, score: n } })),
      );
      await querier.run(`ANALYZE "${TABLE}"`);
    });
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
    await pool.end();
  }, provisioningTimeout);

  it('answers a text path from its index', async () => {
    expect(await planFor({ 'kind.name': 'n7' })).toContain('ix_json_name');
  });

  /** The numeric reading carries a cast on both ends; indexing it as text would leave this a scan. */
  it('answers a numeric path from its index', async () => {
    expect(await planFor({ 'kind.score': { $gte: ROWS - 5 } })).toContain('ix_json_score');
  });

  it('finds the rows it indexed', async () => {
    const found = await pool.withQuerier((querier) =>
      querier.findMany(JsonPathIndexed, { $select: { id: true }, $where: { 'kind.name': 'n7' } }),
    );

    expect(found).toHaveLength(1);
  });

  it('reports no drift for the indexes it just created', async () => {
    const introspector = new PostgresSchemaIntrospector(pool);
    const actual = await introspector.introspect();
    const expected = buildSchemaAST([JsonPathIndexed], { namingStrategy: dialect.namingStrategy });

    const report = detectDrift(expected, actual, { dialect, indexFacets: introspector.indexFacets });

    expect(report.drifts.filter((drift) => drift.table === TABLE)).toEqual([]);
  });
});
