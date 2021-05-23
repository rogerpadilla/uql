const normalEscapeIdChar = '`';

export function normalizeSql(sql: string, escapeIdChar: string): string {
  return isNormalEscapeIdChar(escapeIdChar) ? sql : sql.replace(RegExp(escapeIdChar, 'g'), normalEscapeIdChar);
}

export function isNormalEscapeIdChar(escapeIdChar: string): boolean {
  return escapeIdChar === normalEscapeIdChar;
}
