import { Query, QueryStringified } from '@uql/core/type';

export function parseQuery<T>(qmsSrc?: QueryStringified): Query<T> {
  const qm: Query<T> = {};
  if (qmsSrc) {
    if (qmsSrc.project) {
      qm.project = JSON.parse(qmsSrc.project);
    }
    if (qmsSrc.populate) {
      qm.populate = JSON.parse(qmsSrc.populate);
    }
    if (qmsSrc.filter) {
      qm.filter = JSON.parse(qmsSrc.filter);
    }
    if (qmsSrc.group) {
      qm.group = JSON.parse(qmsSrc.group);
    }
    if (qmsSrc.sort) {
      qm.sort = JSON.parse(qmsSrc.sort);
    }
    if (qmsSrc.skip) {
      qm.skip = Number(qmsSrc.skip);
    }
    if (qmsSrc.limit) {
      qm.limit = Number(qmsSrc.limit);
    }
  }
  return qm;
}
