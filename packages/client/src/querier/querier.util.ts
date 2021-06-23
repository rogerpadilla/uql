import { getKeys } from '@uql/core/util';

export function stringifyQueryParameter(key: string, value?: any, noPrefix?: boolean): string {
  const valStr = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  return (noPrefix ? '' : '?') + `${key}=${valStr}`;
}

export function stringifyQuery(query: object): string {
  if (!query) {
    return '';
  }
  const keys = getKeys(query);
  if (keys.length === 0) {
    return '';
  }
  const qsArr = keys.map((key) => stringifyQueryParameter(key, query[key], true));
  return qsArr.length ? '?' + qsArr.join('&') : '';
}
