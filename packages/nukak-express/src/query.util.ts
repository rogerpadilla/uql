import { Query, QueryStringified } from 'nukak/type';

export function parseQuery<E>(qmsSrc?: QueryStringified): Query<E> {
  const qm: Query<E> = {};
  if (qmsSrc) {
    if (qmsSrc.$project) {
      qm.$project = JSON.parse(qmsSrc.$project);
    }
    if (qmsSrc.$filter) {
      qm.$filter = JSON.parse(qmsSrc.$filter);
    }
    if (qmsSrc.$group) {
      qm.$group = JSON.parse(qmsSrc.$group);
    }
    if (qmsSrc.$having) {
      qm.$having = JSON.parse(qmsSrc.$having);
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
  return qm;
}
