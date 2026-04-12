import type { Request } from 'express';
import type { Query, QueryStringified } from '../type/index.js';

const JSON_QUERY_KEYS = ['$select', '$populate', '$exclude', '$where', '$sort'] as const;

/**
 * Parse query string parameters and store on request object.
 * Call this in middleware before handling requests.
 */
export function parseQuery(req: Request): void {
  req.query ??= {};
  const qmsSrc: QueryStringified = req.query;
  const qm = qmsSrc as unknown as Query<unknown>;

  for (const key of JSON_QUERY_KEYS) {
    const value = qmsSrc[key];
    if (typeof value === 'string') {
      qm[key] = JSON.parse(value);
    }
  }

  if (!qmsSrc.$where) {
    qm.$where = {};
  }

  if (qmsSrc.$skip) {
    qm.$skip = Number(qmsSrc.$skip);
  }
  if (qmsSrc.$limit) {
    qm.$limit = Number(qmsSrc.$limit);
  }
}
