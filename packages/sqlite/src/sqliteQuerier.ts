import { BaseSqlQuerier } from '@uql/core/sql';
import { QueryOptions } from '@uql/core/type';
import { Sqlit3Connection } from './sqlite3Connection';
import { SqliteDialect } from './sqliteDialect';

export class SqliteQuerier extends BaseSqlQuerier {
  constructor(readonly conn: Sqlit3Connection) {
    super(new SqliteDialect(), conn);
  }

  async query<E>(query: string, opts?: QueryOptions): Promise<E> {
    const res = await this.conn.query(query, opts);
    return res as unknown as E;
  }
}
