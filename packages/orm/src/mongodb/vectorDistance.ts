import type { Document } from 'mongodb';
import type { VectorDistance } from '../type/index.js';

/**
 * A document's distance from `vector` as an aggregation expression, computed exactly as the SQL engines
 * compute theirs: Atlas ranks only through its own index, which no related document reaches. `null` where
 * the field holds no vector, or a cosine has a zero-length side, and `$min` skips a `null`.
 */
export function vectorDistanceExpr(column: string, vector: readonly number[], metric: VectorDistance): Document {
  const field = `$${column}`;
  const sum = (term: Document): Document => ({
    $sum: { $map: { input: { $zip: { inputs: [field, { $literal: vector }] } }, as: 'pair', in: term } },
  });
  const own = { $arrayElemAt: ['$$pair', 0] };
  const other = { $arrayElemAt: ['$$pair', 1] };
  const dot = sum({ $multiply: [own, other] });
  const distance: Record<VectorDistance, Document> = {
    cosine: {
      $let: {
        vars: { norms: { $multiply: [{ $sqrt: sum({ $multiply: [own, own] }) }, Math.hypot(...vector)] } },
        in: { $cond: [{ $eq: ['$$norms', 0] }, null, { $subtract: [1, { $divide: [dot, '$$norms'] }] }] },
      },
    },
    l2: { $sqrt: sum({ $pow: [{ $subtract: [own, other] }, 2] }) },
    inner: { $multiply: [-1, dot] },
    l1: sum({ $abs: { $subtract: [own, other] } }),
  };
  return { $cond: [{ $isArray: field }, distance[metric], null] };
}
