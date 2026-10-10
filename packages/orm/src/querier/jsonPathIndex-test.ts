import { expect } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { driftOf } from '../test/drift.js';
import type { Spec } from '../test/index.js';
import { dropTables } from '../test/sqlPools.js';
import type { Json, QueryWhere, SqlQuerierPool, Type } from '../type/index.js';
import { sql } from '../util/sql.js';

const TABLE = 'json_path_index';

/** Enough rows that a scan is the costlier plan, so the planner's choice means something. */
const ROWS = 1000;

@Index((row) => [{ column: row.kind, jsonPath: { path: 'name', type: String, length: 32 } }], { name: 'ix_json_name' })
@Index((row) => [{ column: row.kind, jsonPath: { path: 'score', type: Number } }], { name: 'ix_json_score' })
@Entity({ name: TABLE })
class JsonPathIndexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'json' }) kind?: Json<{ name: string; score: number }> | null;
}

/** The engine's plan for the statement `find` builds, as text to look for an index in; `explain` is its prefix. */
export async function queryPlanOf<E>(
  pool: SqlQuerierPool,
  entity: Type<E>,
  $where: QueryWhere<E>,
  explain = 'EXPLAIN',
): Promise<string> {
  const find = sql(({ ctx }) => pool.dialect.find(ctx, entity, { $where }));
  return JSON.stringify(await pool.all`${sql.text(explain)} ${find}`);
}

/**
 * A JSON path index only pays off if the planner matches it back to the query, which it does by the expression's
 * own text: the entity declares the path, the dialect compiles both ends of it through one `jsonPathExpr`, and
 * only the engine can say whether the two met, a number only where the value it is compared with is cast alike.
 */
export class JsonPathIndexIt implements Spec {
  /** The engine's prefix for a plan, and for refreshing the statistics the planner reads. */
  readonly explain: string = 'EXPLAIN';
  readonly analyze: string = 'ANALYZE';

  constructor(readonly pool: SqlQuerierPool) {}

  async beforeAll() {
    await new Migrator(this.pool, { entities: [JsonPathIndexed] }).sync({ force: true });
    await this.pool.insertMany(
      JsonPathIndexed,
      Array.from({ length: ROWS }, (_, n) => ({ kind: { name: `n${n}`, score: n + 0.5 } })),
    );
    await this.pool.run(sql.text(`${this.analyze} ${this.pool.dialect.escapeId(TABLE)}`));
  }

  async afterAll() {
    await dropTables(this.pool, TABLE);
    await this.pool.end();
  }

  plan(where: QueryWhere<JsonPathIndexed>) {
    return queryPlanOf(this.pool, JsonPathIndexed, where, this.explain);
  }

  async shouldAnswerATextPathFromItsIndex() {
    expect(await this.plan({ 'kind.name': 'n7' })).toContain('ix_json_name');
    expect(await this.plan({ 'kind.name': { $in: ['n7', 'n8'] } })).toContain('ix_json_name');
  }

  async shouldAnswerANumericPathFromItsIndex() {
    expect(await this.plan({ 'kind.score': { $gte: ROWS - 5 } })).toContain('ix_json_score');
    expect(await this.plan({ 'kind.score': 7.5 })).toContain('ix_json_score');
    expect(await this.plan({ 'kind.score': { $between: [7, 8] } })).toContain('ix_json_score');
  }

  async shouldFindTheRowsItIndexed() {
    expect(await this.pool.count(JsonPathIndexed, { $where: { 'kind.name': 'n7' } })).toBe(1);
    expect(await this.pool.count(JsonPathIndexed, { $where: { 'kind.score': { $gte: ROWS - 5 } } })).toBe(5);
  }

  async shouldReportNoDriftForTheIndexesItCreated() {
    expect(await driftOf(this.pool, JsonPathIndexed, TABLE)).toEqual([]);
  }
}
