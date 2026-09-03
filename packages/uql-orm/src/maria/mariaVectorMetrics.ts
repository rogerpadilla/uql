import type { VectorDistance } from '../type/index.js';

/**
 * MariaDB's own name for each metric it supports (`euclidean`, not `l2`), which its index clause and
 * its distance function are both spelled from - one list, so a metric can never be searchable and
 * unindexable or the reverse. Its own module because the two ends now live apart: the distance
 * function on the dialect, the `DISTANCE=` clause in the migrator's index DDL.
 */
export const MARIA_VECTOR_METRICS = new Map<VectorDistance, string>([
  ['cosine', 'cosine'],
  ['l2', 'euclidean'],
]);
