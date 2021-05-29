import { BaseSqlQuerier } from '@uql/core/sql';
import { QuerierPoolConnection } from '@uql/core/type';
import { SqliteDialect } from './sqliteDialect';

export class SqliteQuerier extends BaseSqlQuerier {
  constructor(readonly conn: QuerierPoolConnection) {
    super(conn, new SqliteDialect());
  }
}
