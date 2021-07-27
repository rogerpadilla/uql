import { ISqlite, open } from 'sqlite';
import { Database as Sqlite3Driver } from 'sqlite3';
import { Logger, QuerierPool } from '@uql/core/type';
import { SqlQuerier } from '@uql/core/querier';
import { SqliteDialect } from '@uql/core/dialect';
import { SqliteConnection } from './sqliteConnection';

export class Sqlite3QuerierPool implements QuerierPool<SqlQuerier> {
  private querier: SqlQuerier;

  constructor(readonly config: Omit<ISqlite.Config, 'driver'>, readonly logger?: Logger) {}

  async getQuerier() {
    if (!this.querier) {
      const db = await open({ ...this.config, driver: Sqlite3Driver });
      this.querier = new SqlQuerier(new SqliteDialect(), new SqliteConnection(db, this.logger));
    }
    return this.querier;
  }

  async end() {
    await this.querier.conn.end();
    delete this.querier;
  }
}
