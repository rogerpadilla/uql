import { RootQuerySelector, Cursor } from 'mongodb';
import { QueryFilter, Query } from '../../type';

export function parseFilter<T>(filter: QueryFilter<T>): RootQuerySelector<T> {
  const filterQuery = Object.keys(filter).reduce((acc, key) => {
    const val = filter[key];
    if (key === '$and' || key === '$or') {
      acc[key] = Object.keys(val).map((prop) => {
        return { [prop]: val[prop] };
      });
    } else {
      acc[key] = val;
    }
    return acc;
  }, {});
  return filterQuery;
}

export function fillCursor<T>(cursor: Cursor, qm: Query<T>) {
  if (qm.project) {
    cursor = cursor.project(qm.project);
  }
  if (qm.sort) {
    cursor = cursor.sort(qm.sort);
  }
  if (qm.skip) {
    cursor = cursor.skip(qm.skip);
  }
  if (qm.limit) {
    cursor = cursor.limit(qm.limit);
  }
  return cursor;
}
