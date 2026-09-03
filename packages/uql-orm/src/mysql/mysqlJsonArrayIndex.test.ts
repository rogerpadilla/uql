import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { detectDrift } from '../migrate/drift/index.js';
import { MysqlSchemaIntrospector } from '../migrate/introspection/mysqlIntrospector.js';
import { Migrator } from '../migrate/migrator.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { provisioningTimeout } from '../test/index.js';
import type { Json } from '../type/index.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';
import { MySqlDialect } from './mysqlDialect.js';

const TABLE = 'mysql_json_array_index';

/** Enough rows that a scan is the more expensive plan, so the planner's choice means something. */
const ROWS = 1000;

/** The array is the whole column, which is what `$all` reads and what its `JSON_CONTAINS(col, ?)` names. */
@Index([{ column: 'tags', jsonArray: { type: String, length: 64 } }], { name: 'ix_json_tags' })
@Entity({ name: TABLE })
class JsonArrayIndexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'json' }) tags?: Json<string[]>;
}

/**
 * A multi-valued index only pays off if the planner matches it back to the query, which it does by
 * the expression's own text: the entity declares the array, the dialect compiles the cast, and only
 * the engine can say whether the two met. So the plan asked for below is the one for the statement
 * `find` builds, not for a hand-written lookalike of it.
 */
describe('MySQL JSON array index', () => {
  const pool = new MySql2QuerierPool({
    host: '0.0.0.0',
    port: 3316,
    user: 'test',
    password: 'test',
    database: 'test',
  });
  const dialect = new MySqlDialect();

  beforeAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS \`${TABLE}\``));
    await new Migrator(pool, { entities: [JsonArrayIndexed] }).autoSync({ logging: false });
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

  it('answers $all from the index', async () => {
    const ctx = dialect.createContext();
    dialect.find(ctx, JsonArrayIndexed, { $select: { id: true }, $where: { tags: { $all: ['t7'] } } });

    const plan = await pool.withQuerier((querier) => querier.all(`EXPLAIN ${ctx.sql}`, ctx.values));

    expect(JSON.stringify(plan)).toContain('ix_json_tags');
  });

  it('finds the rows it indexed', async () => {
    const found = await pool.withQuerier((querier) =>
      querier.findMany(JsonArrayIndexed, { $select: { id: true }, $where: { tags: { $all: ['t7'] } } }),
    );

    expect(found).toHaveLength(1);
  });

  /** The server states no column name for a multi-valued key part, which diffing has to survive. */
  it('reports no drift for the index it just created', async () => {
    const introspector = new MysqlSchemaIntrospector(pool);
    const actual = await introspector.introspect();
    const expected = buildSchemaAST([JsonArrayIndexed], { namingStrategy: dialect.namingStrategy });

    const report = detectDrift(expected, actual, { dialect, indexFacets: introspector.indexFacets });

    expect(report.drifts.filter((drift) => drift.table === TABLE)).toEqual([]);
  });
});
