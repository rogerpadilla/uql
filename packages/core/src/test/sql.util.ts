import { BaseSqlDialect } from '../driver/baseSqlDialect';
import { PostgresDialect } from '../driver/postgres/postgresDialect';
import { getMeta } from '../entity/decorator/definition';
import { Query, QueryFilter, QueryOptions } from '../type/query';

export function find<T>(dialect: BaseSqlDialect, type: { new (): T }, query: Query<T>, opts?: QueryOptions) {
  const sql = dialect.find(type, query, opts);
  return reEscape(dialect, sql);
}

export function insert<T>(dialect: BaseSqlDialect, type: { new (): T }, payload: T | T[]) {
  const sql = dialect.insert(type, payload);
  if (dialect instanceof PostgresDialect) {
    const reEscapedSql = reEscape(dialect, sql);
    const idName = getMeta(type).id.name;
    const returnId = ` RETURNING ${idName} insertId`;
    if (!reEscapedSql.endsWith(returnId)) {
      throw new Error();
    }
    return reEscapedSql.slice(0, sql.length - returnId.length);
  }
  return sql;
}

export function update<T>(dialect: BaseSqlDialect, type: { new (): T }, filter: QueryFilter<T>, payload: T) {
  const sql = dialect.update(type, filter, payload);
  return reEscape(dialect, sql);
}

export function remove<T>(dialect: BaseSqlDialect, type: { new (): T }, filter: QueryFilter<T>) {
  const sql = dialect.remove(type, filter);
  return reEscape(dialect, sql);
}

function reEscape(dialect: BaseSqlDialect, sql: string) {
  return dialect instanceof PostgresDialect ? sql.replace(RegExp(dialect.escapeIdChar, 'g'), '`') : sql;
}
