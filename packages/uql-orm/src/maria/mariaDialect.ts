import type { DialectOptions } from '../dialect/abstractDialect.js';
import { jsonPath } from '../dialect/jsonSql.js';
import { MysqlLikeSqlDialect } from '../dialect/mysqlLikeSqlDialect.js';
import { getMeta } from '../entity/index.js';
import type { QueryConflictPaths, QueryContext, QueryOptions, Type, VectorDistance } from '../type/index.js';

export class MariaDialect extends MysqlLikeSqlDialect {
  override readonly dialectName = 'mariadb';

  override readonly serialPrimaryKey = 'BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY';

  // MariaDB 10.5+ supports `INSERT ... RETURNING` (see `insert` below), so IDs are exact per row.
  override readonly insertIdSource = 'returning';

  constructor(options: DialectOptions = {}) {
    super({
      ...options,
      driverCapabilities: {
        vectorSupportsLength: true,
        ...options.driverCapabilities,
      },
    });
  }

  override insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    super.insert(ctx, entity, payload, opts);
    ctx.append(' ' + this.returningId(entity));
  }

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    const meta = getMeta(entity);
    const updateCtx = this.createContext();
    const update = this.getUpsertUpdateAssignments(
      updateCtx,
      meta,
      conflictPaths,
      payload,
      (name) => `VALUES(${name})`,
    );
    const returning = this.returningId(entity);

    if (update) {
      super.insert(ctx, entity, payload);
      ctx.append(` ON DUPLICATE KEY UPDATE ${update} ${returning}`);
      ctx.pushValue(...updateCtx.values);
    } else {
      const insertCtx = this.createContext();
      super.insert(insertCtx, entity, payload);
      ctx.append(insertCtx.sql.replace(/^INSERT/, 'INSERT IGNORE'));
      ctx.append(' ' + returning);
      ctx.pushValue(...insertCtx.values);
    }
  }

  /**
   * MariaDB supports neither MySQL's `->`/`->>` shorthand nor the base's chained form. `JSON_VALUE`
   * reads a scalar and `JSON_EXTRACT` the subtree that the array operators need.
   */
  protected override getJsonPathScalarExpr(escapedColumn: string, jsonPathStr: string): string {
    return `JSON_VALUE(${escapedColumn}, ${jsonPath(jsonPathStr)})`;
  }

  protected override getJsonPathJsonbExpr(escapedColumn: string, jsonPathStr: string): string {
    return `JSON_EXTRACT(${escapedColumn}, ${jsonPath(jsonPathStr)})`;
  }

  /** MariaDB has no `CAST(val AS JSON)`; `JSON_EXTRACT` at the root reads a value as JSON. */
  protected override jsonCast(operand: string): string {
    return `JSON_EXTRACT(${operand}, '$')`;
  }

  /**
   * MariaDB stores JSON as text, so JSON_ARRAYAGG would re-quote each element into a string
   * (`["\"a\""]`). JSON_COMPACT marks it back as JSON, keeping element types intact.
   */
  protected override jsonPullElem(alias: string): string {
    return `JSON_COMPACT(${alias}.v)`;
  }

  /** Text-backed JSON compares as text, so use JSON_EQUALS for key-order-independent equality. */
  protected override jsonPullKeep(alias: string, operand: string): string {
    return `NOT JSON_EQUALS(${alias}.v, ${operand})`;
  }

  /** MariaDB 11.7+ vector distance functions. */
  protected override readonly vectorDistanceFns: ReadonlyMap<VectorDistance, string> = new Map([
    ['cosine', 'VEC_DISTANCE_COSINE'],
    ['l2', 'VEC_DISTANCE_EUCLIDEAN'],
  ]);
}
