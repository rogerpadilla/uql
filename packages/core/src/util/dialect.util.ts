import { QuerySort, QuerySortMap } from '../type';

export function buildSortMap<E>(sort: QuerySort<E>): QuerySortMap<E> {
  if (Array.isArray(sort)) {
    return sort.reduce((acc, it) => {
      if (Array.isArray(it)) {
        acc[it[0]] = it[1];
      } else {
        acc[it.field] = it.sort;
      }
      return acc;
    }, {} as QuerySortMap<E>);
  }
  return sort as QuerySortMap<E>;
}
