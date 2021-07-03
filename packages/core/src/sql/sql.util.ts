import { QueryRaw, QueryRawFnOptions, Scalar } from '../type';
import { hasKeys, getKeys } from '../util';

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

export function getRawValue({
  prefix,
  escapedPrefix,
  dialect,
  usePrefixInAlias,
  value,
  alias,
}: QueryRawFnOptions & { usePrefixInAlias?: boolean } & QueryRaw): Scalar {
  const val = typeof value === 'function' ? value({ prefix, escapedPrefix, dialect }) : prefix + value;
  if (alias) {
    const fullAlias = usePrefixInAlias ? prefix + alias : alias;
    const escapedAlias = dialect.escapeId(fullAlias, true);
    return `${val} ${escapedAlias}`;
  }
  return val;
}

function obtainAttrsPaths<T>(row: T) {
  return getKeys(row).reduce((acc, col) => {
    if (col.includes('.')) {
      acc[col] = col.split('.');
    }
    return acc;
  }, {} as { [k: string]: string[] });
}
