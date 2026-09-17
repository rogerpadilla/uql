import { UPSERT_NEW_ROW_ALIAS } from '../dialect/aliases.js';
import type { JsonSlot } from '../dialect/jsonSql.js';
import { MysqlLikeSqlDialect } from '../dialect/mysqlLikeSqlDialect.js';
import type { QueryContext } from '../type/index.js';

export class MySqlDialect extends MysqlLikeSqlDialect {
  override readonly dialectName = 'mysql';

  /**
   * `VALUES(col)` inside `ON DUPLICATE KEY UPDATE` has been deprecated since MySQL 8.0.20 and is
   * "subject to removal in a future version"; aliasing the inserted row (8.0.19+) is its replacement.
   */
  protected override readonly upsertNewRowAlias = UPSERT_NEW_ROW_ALIAS;

  /**
   * 26.7 may plan the correlated `JSON_TABLE` as a semijoin materialized once for the whole table, which
   * answers every row with one row's elements. Verified in `mysqlJsonElemMatch.test.ts`.
   */
  protected override readonly jsonElemHint = '/*+ NO_SEMIJOIN() */';

  /**
   * `JSON_OVERLAPS`, which a multi-valued index serves: verified in `mysqlJsonArrayIndex.test.ts`. It reads
   * a scalar as an array of one, so the value must be an array.
   */
  protected override jsonAny(ctx: QueryContext, slot: JsonSlot, values: readonly unknown[]): string {
    const overlaps = `JSON_OVERLAPS(${this.jsonValue(slot)}, ${this.addValue(ctx, JSON.stringify(values))})`;
    return `(${this.jsonIsArray(slot)} AND ${overlaps})`;
  }

  /**
   * A `SET_VAR` hint, which MySQL reads only right after the statement's own `SELECT` keyword - before
   * `DISTINCT`, and never in a subquery - so it is anchored to the start rather than found.
   */
  protected override applySettings(sql: string, settings: readonly string[]): string {
    return sql.replace(/^SELECT /, `SELECT /*+ ${settings.map((setting) => `SET_VAR(${setting})`).join(' ')} */ `);
  }
}
