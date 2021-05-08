import { BaseSqlDialect } from '../driver/baseSqlDialect';
import { PostgresDialect } from '../driver/postgres/postgresDialect';
import { getMeta } from '../entity/decorator/definition';
import { Query, QueryFilter, QueryOptions } from '../type/query';

export function find<E>(dialect: BaseSqlDialect, entity: { new (): E }, query: Query<E>, opts?: QueryOptions) {
  const sql = dialect.find(entity, query, opts);
  return reEscape(dialect, sql);
}

export function insert<E>(dialect: BaseSqlDialect, entity: { new (): E }, payload: E | E[]) {
  const sql = dialect.insert(entity, payload);
  if (dialect instanceof PostgresDialect) {
    const reEscapedSql = reEscape(dialect, sql);
    const idName = getMeta(entity).id.name;
    const returnId = ` RETURNING ${idName} insertId`;
    if (!reEscapedSql.endsWith(returnId)) {
      throw new Error();
    }
    return reEscapedSql.slice(0, sql.length - returnId.length);
  }
  return sql;
}

export function update<E>(dialect: BaseSqlDialect, entity: { new (): E }, filter: QueryFilter<E>, payload: E) {
  const sql = dialect.update(entity, filter, payload);
  return reEscape(dialect, sql);
}

export function remove<E>(dialect: BaseSqlDialect, entity: { new (): E }, filter: QueryFilter<E>) {
  const sql = dialect.remove(entity, filter);
  return reEscape(dialect, sql);
}

function reEscape(dialect: BaseSqlDialect, sql: string) {
  return dialect instanceof PostgresDialect ? sql.replace(RegExp(dialect.escapeIdChar, 'g'), '`') : sql;
}
