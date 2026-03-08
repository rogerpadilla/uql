import type { Database } from 'better-sqlite3';
import type { ExtraOptions } from '../type/index.js';
import { AbstractSqliteQuerier } from './abstractSqliteQuerier.js';
import { SqliteDialect } from './sqliteDialect.js';

export class SqliteQuerier extends AbstractSqliteQuerier {
  constructor(
    readonly db: Database,
    override readonly extra?: ExtraOptions,
  ) {
    super(new SqliteDialect(extra?.namingStrategy), extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    return this.db.prepare(query).all(values || []) as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const { changes, lastInsertRowid } = this.db.prepare(query).run(values || []);
    return this.buildUpdateResult(changes, lastInsertRowid);
  }

  override async internalRelease() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    // no-op
  }
}
