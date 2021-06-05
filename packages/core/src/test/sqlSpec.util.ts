export function normalizeSql(sql: string, escapeIdChar: string, normalEscapeIdChar = '`'): string {
  if (escapeIdChar === normalEscapeIdChar) {
    return sql;
  }

  const normalizedSql = sql.replace(RegExp(normalEscapeIdChar, 'g'), escapeIdChar);

  if (normalizedSql.startsWith('INSERT INTO ')) {
    return normalizedSql + ' RETURNING id id';
  }

  return normalizedSql;
}
