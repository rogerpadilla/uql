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

export function stringifyQueryParameter<T, K extends keyof Query<T>>(
  key: K,
  value?: Query<T>[K],
  noPrefix?: boolean
): string {
  const valStr = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  return (noPrefix ? '' : '?') + `${key}=${valStr}`;
}

export function stringifyQuery<T>(qm?: Query<T>): string {
  if (!qm) {
    return '';
  }
  const qsArr = Object.keys(qm).map((key) => stringifyQueryParameter(key as keyof Query<T>, qm[key], true));
  return qsArr.length ? '?' + qsArr.join('&') : '';
}
