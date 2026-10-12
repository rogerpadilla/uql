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

  /** The engine appends nothing for a JSON null at a bare array's `[#]`, and does under a key, so a null goes under one. */
  protected override jsonAppended(ctx: QueryContext, array: string, value: unknown): string {
    if (value !== null) {
      return super.jsonAppended(ctx, array, value);
    }
    return `JSON_SET(JSON_OBJECT('a', ${array}), '$.a[#]', ${this.jsonScalarParam(ctx, value)}) -> '$.a'`;
  }
}
