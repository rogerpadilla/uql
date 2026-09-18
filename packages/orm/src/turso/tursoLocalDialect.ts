import type { VectorDistance, VectorMetric } from '../type/index.js';
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
}
