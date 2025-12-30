import SqlString from 'sqlstring';
import { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type { QueryConflictPaths, QueryContext, QueryOptions, Type } from '../type/index.js';

export class MariaDialect extends AbstractSqlDialect {
  override addValue(values: unknown[], value: unknown): string {
    if (value instanceof Date) {
      values.push(value);
      return '?';
    }
    return super.addValue(values, value);
  }

  override insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    super.insert(ctx, entity, payload, opts);
    ctx.append(' ' + this.returningId(entity));
  }

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): void {
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(ctx, meta, conflictPaths, payload, (name) => `VALUES(${name})`);
    const returning = this.returningId(entity);

    if (update) {
      super.insert(ctx, entity, payload);
      ctx.append(` ON DUPLICATE KEY UPDATE ${update} ${returning}`);
    } else {
      const insertCtx = this.createContext();
      super.insert(insertCtx, entity, payload);
      ctx.append(insertCtx.sql.replace(/^INSERT/, 'INSERT IGNORE'));
      ctx.append(' ' + returning);
      insertCtx.values.forEach((val) => {
        ctx.pushValue(val);
      });
    }
  }

  override escape(value: unknown): string {
    return SqlString.escape(value);
  }
}
