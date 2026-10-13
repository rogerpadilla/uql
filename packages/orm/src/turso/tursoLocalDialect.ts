import { skippablePath } from '../dialect/jsonSql.js';
import type { QueryContext, VectorDistance, VectorMetric } from '../type/index.js';
import { TursoDialect } from './tursoDialect.js';

/**
 * SQLite Dialect specialization for the embedded Turso engine, the Rust engine alone: it adds a
 * dot-product distance to libSQL's cosine and L2, caps no function call, and has no vector index.
 */
export class TursoLocalDialect extends TursoDialect {
  override readonly vectorMetrics: ReadonlyMap<VectorDistance, VectorMetric> = new Map([
    ['cosine', { fn: 'vector_distance_cos' }],
    ['l2', { fn: 'vector_distance_l2' }],
    ['inner', { fn: 'vector_distance_dot' }],
  ]);

  override readonly maxFunctionArgs: number = Infinity;

  /** At a bare array's `[#]` the engine appends nothing for `true`, `false` or `null`, so those go under a key. */
  protected override jsonAppended(ctx: QueryContext, array: string, value: unknown, unless?: string): string {
    if (typeof value !== 'boolean' && value !== null) {
      return super.jsonAppended(ctx, array, value, unless);
    }
    const path = skippablePath(`'$.a[#]'`, unless);
    return `JSON_SET(JSON_OBJECT('a', JSON(${array})), ${path}, ${this.jsonScalarParam(ctx, value)}) -> '$.a'`;
  }
}
