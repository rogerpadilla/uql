import { Query, QueryStringified } from '../type';

export function buildQuery<T>(qmsSrc: QueryStringified) {
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

export function stringifyQueryParameter(key: keyof Query<any>, value: any, prefix?: boolean) {
  if (value === undefined) {
    return '';
  }
  const valStr = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  return (prefix ? '?' : '') + `${key}=${valStr}`;
}

export function stringifyQuery(qm: Query<any>): string {
  if (!qm) {
    return '';
  }
  const qsArr = Object.keys(qm).map((key) => stringifyQueryParameter(key as any, qm[key]));
  return qsArr.length ? '?' + qsArr.join('&') : '';
}
