export function mapRows<T>(rows: T[]): T[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return rows;
  }

  const attrsPaths = obtainAttrsPaths(rows[0]);

  if (Object.keys(attrsPaths).length === 0) {
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
        const target = attrPath.slice(0, -1).reduce((obj, key) => {
          if (typeof obj[key] !== 'object') {
            obj[key] = {};
          }
          return obj[key] as T;
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
  return Object.keys(row).reduce((acc, col) => {
    if (col.includes('.')) {
      acc[col] = col.split('.');
    }
    return acc;
  }, {} as { [prop: string]: string[] });
}
