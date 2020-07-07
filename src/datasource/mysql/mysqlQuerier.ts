import { QuerierPoolConnection } from '../type';
import { SqlQuerier } from '../sqlQuerier';
import { MySqlDialect } from './mysqlDialect';

export class MySqlQuerier extends SqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new MySqlDialect(), conn);
  }
}
