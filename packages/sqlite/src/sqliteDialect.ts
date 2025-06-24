import { AbstractSqlDialect } from 'nukak/dialect';
import { getMeta } from 'nukak/entity';
import type {
  QueryComparisonOptions,
  QueryConflictPaths,
  QuerySearch,
  QueryTextSearchOptions,
  QueryWhereMap,
  Type,
} from 'nukak/type';
import { clone, getKeys } from 'nukak/util';
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
    payload = clone(payload);
    const insert = this.insert(entity, payload);
    const insertOrIgnore = insert.replace(/^INSERT\s/, 'INSERT OR IGNORE ');
    const search = getKeys(conflictPaths).reduce(
      (acc, key) => {
        acc.$where[key] = payload[key];
        return acc;
      },
      { $where: {} } as QuerySearch<E>,
    );
    for (const prop in conflictPaths) {
      delete payload[prop];
    }
    const update = this.update(entity, search, payload);
    return `${insertOrIgnore}; ${update}`;
  }

  override escape(value: unknown): string {
    return sqlstring.escape(value);
  }
}
