import { Query, QueryStringified } from 'uql/type';

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

export function stringifyQueryParameter(key: string, value?: any, noPrefix?: boolean): string {
  const valStr = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  return (noPrefix ? '' : '?') + `${key}=${valStr}`;
}

export function stringifyQuery(query: object): string {
  if (!query) {
    return '';
  }
  const qsArr = Object.keys(query).map((key) => stringifyQueryParameter(key, query[key], true));
  return qsArr.length ? '?' + qsArr.join('&') : '';
}
