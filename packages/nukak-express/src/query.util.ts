import type { Request } from 'express';
import type { Query, QueryStringified } from 'nukak/type';

export function parseQuery(req: Request) {
  req.query ??= {};
  const qmsSrc: QueryStringified = req.query;
  const qm = qmsSrc as unknown as Query<any>;
  if (qmsSrc.$select) {
    qm.$select = JSON.parse(qmsSrc.$select);
  }
  qm.$where = qmsSrc.$where ? JSON.parse(qmsSrc.$where) : {};
  if (qmsSrc.$sort) {
    qm.$sort = JSON.parse(qmsSrc.$sort);
  }
  if (qmsSrc.$skip) {
    qm.$skip = Number(qmsSrc.$skip);
  }
  if (qmsSrc.$limit) {
    qm.$limit = Number(qmsSrc.$limit);
  }
}
