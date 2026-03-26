import { MysqlLikeSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type {
  NamingStrategy,
  QueryConflictPaths,
  QueryContext,
  QueryOptions,
  Type,
  VectorDistance,
} from '../type/index.js';

export class MariaDialect extends MysqlLikeSqlDialect {
  constructor(namingStrategy?: NamingStrategy) {
    super('mariadb', namingStrategy);
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

  protected override getJsonPathScalarExpr(escapedColumn: string, jsonPath: string): string {
    const escapedPath = jsonPath
      .split('.')
      .map((segment) => this.escapeJsonKey(segment))
      .join('.');
    // MariaDB does not support MySQL's -> / ->> JSON shorthand operators.
    // JSON_VALUE keeps dot-notation access native and portable across MariaDB versions.
    return `JSON_VALUE(${escapedColumn}, '$.${escapedPath}')`;
  }

  /** MariaDB 11.7+ vector distance functions. */
  protected override readonly vectorDistanceFns: Partial<Record<VectorDistance, string>> = {
    cosine: 'VEC_DISTANCE_COSINE',
    l2: 'VEC_DISTANCE_EUCLIDEAN',
  };
}
