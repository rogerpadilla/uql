import { escape } from 'sqlstring-sqlite';
import { getMeta } from 'nukak/entity';
import type {
  QueryWhereMap,
  QueryTextSearchOptions,
  Type,
  QueryComparisonOptions,
  QueryConflictPaths,
  QuerySearch,
} from 'nukak/type';
import { AbstractSqlDialect } from 'nukak/dialect';
import { clone, getKeys } from 'nukak/util';

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

  override escape(value: any): string {
    return escape(value);
  }
}
