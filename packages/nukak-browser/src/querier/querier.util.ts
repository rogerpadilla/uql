import { getKeys } from 'nukak/util';

export function stringifyQueryParameter(key: string, value?: any, useQuestionMark?: boolean): string {
  const valStr = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  return (useQuestionMark ? '?' : '') + `${key}=${valStr}`;
}

export function stringifyQuery(query: object): string {
  if (!query) {
    return '';
  }
  const keys = getKeys(query);
  if (keys.length === 0) {
    return '';
  }
  const qsArr = keys.filter((key) => query[key] !== undefined).map((key) => stringifyQueryParameter(key, query[key]));
  return qsArr.length ? '?' + qsArr.join('&') : '';
}
