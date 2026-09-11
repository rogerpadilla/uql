import type { VectorDistance, VectorOperatorMetric } from '../type/index.js';

/**
 * Each metric's pgvector distance operator and the operator-class suffix its index takes, in one list
 * so a dialect cannot have the operator but not the opclass. Its own module because the two ends live
 * apart: the operator on the dialect, the opclass in the migrator's index DDL.
 */
export const PG_VECTOR_METRICS: ReadonlyMap<VectorDistance, VectorOperatorMetric> = new Map([
  ['cosine', { op: '<=>', opsSuffix: 'cosine' }],
  ['l2', { op: '<->', opsSuffix: 'l2' }],
  ['inner', { op: '<#>', opsSuffix: 'ip' }],
  ['l1', { op: '<+>', opsSuffix: 'l1' }],
]);

/**
 * CockroachDB's three: `<+>` and `vector_l1_ops` answer "unimplemented: operator class ... is not
 * supported" (verified live on v26.2), tracked at https://github.com/cockroachdb/cockroach/issues/147839.
 * Re-check that issue before adding `l1`; it is omitted on purpose.
 */
export const COCKROACH_VECTOR_METRICS: ReadonlyMap<VectorDistance, VectorOperatorMetric> = new Map(
  [...PG_VECTOR_METRICS].filter(([metric]) => metric !== 'l1'),
);
