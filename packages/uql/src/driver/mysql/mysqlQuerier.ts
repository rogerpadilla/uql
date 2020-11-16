import { QuerierPoolConnection } from 'uql/type';
import { SqlQuerier } from 'uql/querier';
import { MySqlDialect } from './mysqlDialect';

export class MySqlQuerier extends SqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new MySqlDialect(), conn);
  }
}
