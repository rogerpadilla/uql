import type { Request } from 'express';
import type { Query, QueryStringified } from '../type/index.js';

/**
 * Parse query string parameters and store on request object.
 * Call this in middleware before handling requests.
 */
export function parseQuery(req: Request): void {
  req.query ??= {};
  const qmsSrc: QueryStringified = req.query;
  const qm = qmsSrc as unknown as Query<unknown>;

  if (typeof qmsSrc.$select === 'string') {
    qm.$select = JSON.parse(qmsSrc.$select);
  }

  if (typeof qmsSrc.$where === 'string') {
    qm.$where = JSON.parse(qmsSrc.$where);
  } else if (!qmsSrc.$where) {
    qm.$where = {};
  }

  if (typeof qmsSrc.$sort === 'string') {
    qm.$sort = JSON.parse(qmsSrc.$sort);
  }

  if (qmsSrc.$skip) {
    qm.$skip = Number(qmsSrc.$skip);
  }
  if (qmsSrc.$limit) {
    qm.$limit = Number(qmsSrc.$limit);
  }
}
