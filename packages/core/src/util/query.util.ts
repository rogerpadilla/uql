import { Query, QueryStringified } from '../type';

export function buildQuery<T>(qmsSrc: QueryStringified): Query<T> {
  const qm: Query<T> = {};
  if (qmsSrc) {
    if (qmsSrc.skip) {
      qm.skip = Number(qmsSrc.skip);
    }
    if (qmsSrc.limit) {
      qm.limit = Number(qmsSrc.limit);
    }
    if (qmsSrc.project) {
      qm.project = JSON.parse(qmsSrc.project);
    }
    if (qmsSrc.filter) {
      qm.filter = JSON.parse(qmsSrc.filter);
    }
    if (qmsSrc.populate) {
      qm.populate = JSON.parse(qmsSrc.populate);
    }
    if (qmsSrc.sort) {
      qm.sort = JSON.parse(qmsSrc.sort);
    }
  }
  return qm;
}

export function stringifyQueryParameter<T, K extends keyof Query<T>>(
  key: K,
  value: Query<T>[K],
  noPrefix?: boolean
): string {
  if (value === undefined) {
    return '';
  }
  const valStr = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  return (noPrefix ? '' : '?') + `${key}=${valStr}`;
}

export function stringifyQuery<T>(qm: Query<T>): string {
  if (!qm) {
    return '';
  }
  const qsArr = Object.keys(qm).reduce((acc, key) => {
    if (qm[key] !== undefined) {
      acc.push(stringifyQueryParameter(key as keyof Query<T>, qm[key], true));
    }
    return acc;
  }, [] as string[]);
  return qsArr.length ? '?' + qsArr.join('&') : '';
}
