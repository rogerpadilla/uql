import { EntityMeta, QueryFilter, QuerySort } from '../type';
import { hasKeys, getKeys } from '../util';

export function flatMap<E>(meta: EntityMeta<E>, map: QueryFilter<E> | QuerySort<E>, pre?: string): E {
  return getKeys(map).reduce((acc, key) => flatMapEntry(meta, acc, key, map[key], pre), {} as E);
}

function flatMapEntry<E>(meta: EntityMeta<E>, map: E, key: string, val: any, pre?: string): E {
  const isRel = meta.relations[key];
  const prefix = isRel || !pre ? key : `${pre}.${key}`;
  return isRel ? Object.keys(val).reduce((acc, prop) => flatMapEntry(meta, acc, prop, val[prop], prefix), map) : { ...map, [prefix]: val };
}

export function mapRows<T>(rows: T[]): T[] {
  if (!Array.isArray(rows) || !rows.length) {
    return rows;
  }

  const attrsPaths = obtainAttrsPaths(rows[0]);

  if (!hasKeys(attrsPaths)) {
    return rows;
  }

  return rows.map((row) => {
    const dto = {} as T;

    for (const col in row) {
      if (row[col] === null) {
        continue;
      }
      const attrPath = attrsPaths[col];
      if (attrPath) {
        const target = attrPath.slice(0, -1).reduce((acc, key) => {
          if (typeof acc[key] !== 'object') {
            acc[key] = {};
          }
          return acc[key];
        }, dto);
        target[attrPath[attrPath.length - 1]] = row[col];
      } else {
        dto[col] = row[col];
      }
    }

    return dto;
  });
}

function obtainAttrsPaths<T>(row: T) {
  return getKeys(row).reduce((acc, col) => {
    if (col.includes('.')) {
      acc[col] = col.split('.');
    }
    return acc;
  }, {} as { [k: string]: string[] });
}
