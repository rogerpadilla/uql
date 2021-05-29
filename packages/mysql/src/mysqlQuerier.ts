import { BaseSqlQuerier } from '@uql/core/sql';
import { QuerierPoolConnection } from '@uql/core/type';
import { MySqlDialect } from './mysqlDialect';

export class MySqlQuerier extends BaseSqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(conn, new MySqlDialect());
  }
}
