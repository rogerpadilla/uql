import type { Database } from 'better-sqlite3';
import type { ExtraOptions } from '../type/index.js';
import { AbstractSqliteQuerier } from './abstractSqliteQuerier.js';
import type { SqliteDialect } from './sqliteDialect.js';

export class SqliteQuerier extends AbstractSqliteQuerier {
  constructor(
    readonly db: Database,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    return this.db.prepare(query).all(values || []) as T[];
  }

  override async *internalStream<T>(query: string, values?: unknown[]) {
    for (const row of this.db.prepare(query).iterate(values || [])) {
      yield row as T;
    }
  }

  override async internalRun(query: string, values?: unknown[]) {
    const { changes, lastInsertRowid } = this.db.prepare(query).run(values || []);
    return this.buildUpdateResult({ changes, id: lastInsertRowid });
  }

  override async internalRelease() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    // no-op
  }
}
