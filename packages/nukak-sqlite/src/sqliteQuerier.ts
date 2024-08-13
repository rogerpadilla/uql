import type { Database } from 'better-sqlite3';
import type { ExtraOptions, QueryConflictPaths, QueryUpdateResult, Type } from 'nukak/type';
import { AbstractSqlQuerier } from 'nukak/querier';
import { clone } from 'nukak/util';
import { SqliteDialect } from './sqliteDialect.js';

export class SqliteQuerier extends AbstractSqlQuerier {
  constructor(
    readonly db: Database,
    readonly extra?: ExtraOptions,
  ) {
    super(new SqliteDialect());
  }

  override async all<T>(query: string) {
    this.extra?.logger?.(query);
    return this.db.prepare<T, T>(query).all();
  }

  override async run(query: string) {
    this.extra?.logger?.(query);
    const { changes, lastInsertRowid } = await this.db.prepare(query).run();
    const firstId = lastInsertRowid ? Number(lastInsertRowid) - (changes - 1) : undefined;
    return { changes, firstId } satisfies QueryUpdateResult;
  }

  override async upsertOne<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E) {
    payload = clone(payload);
    const upsert = this.dialect.upsert(entity, conflictPaths, payload);
    const [insertOrIgnore, update] = upsert.split(';');
    const resInsert = await this.run(insertOrIgnore);
    if (resInsert.changes) {
      return resInsert;
    }
    return this.run(update);
  }

  override async release() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    // no-op
  }
}
