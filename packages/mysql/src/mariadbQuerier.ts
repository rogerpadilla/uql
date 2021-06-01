import { QuerierPoolConnection } from '@uql/core/type';
import { BaseSqlQuerier } from '@uql/core/sql';
import { MySqlDialect } from './mysqlDialect';

export class MariadbQuerier extends BaseSqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(conn, new MySqlDialect());
  }
}
