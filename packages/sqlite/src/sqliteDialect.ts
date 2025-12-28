import { AbstractSqlDialect } from 'nukak/dialect';
import { getMeta } from 'nukak/entity';
import type {
  QueryComparisonOptions,
  QueryConflictPaths,
  QueryTextSearchOptions,
  QueryWhereMap,
  Type,
} from 'nukak/type';
import sqlstring from 'sqlstring-sqlite';

export class SqliteDialect extends AbstractSqlDialect {
  constructor() {
    super('`', 'BEGIN TRANSACTION');
  }

  override compare<E, K extends keyof QueryWhereMap<E>>(
    entity: Type<E>,
    key: K,
    val: QueryWhereMap<E>[K],
    opts?: QueryComparisonOptions,
  ): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields.map((field) => this.escapeId(meta.fields[field]?.name ?? field));
      return `${this.escapeId(meta.name)} MATCH {${fields.join(' ')}} : ${this.escape(search.$value)}`;
    }
    return super.compare(entity, key, val, opts);
  }

  override upsert<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): string {
    const insert = super.insert(entity, payload);
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(meta, conflictPaths, payload, (name) => `EXCLUDED.${name}`);
    const keysStr = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    return `${insert} ON CONFLICT (${keysStr}) ${onConflict}`;
  }

  override escape(value: unknown): string {
    return sqlstring.escape(value);
  }
}
