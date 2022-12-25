import type { Request } from 'express';
import type { Query, QueryStringified } from 'nukak/type';

export function parseQuery(req: Request) {
  req.query ??= {};
  const qmsSrc: QueryStringified = req.query;
  const qm = qmsSrc as unknown as Query<any>;
  if (qmsSrc.$project) {
    qm.$project = JSON.parse(qmsSrc.$project);
  }
  qm.$filter = qmsSrc.$filter ? JSON.parse(qmsSrc.$filter) : {};
  if (qmsSrc.$group) {
    qm.$group = JSON.parse(qmsSrc.$group);
  }
  if (qmsSrc.$match) {
    qm.$match = JSON.parse(qmsSrc.$match);
  }
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
