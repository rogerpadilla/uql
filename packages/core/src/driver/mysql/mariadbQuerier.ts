import { QuerierPoolConnection } from '../../type';
import { BaseSqlQuerier } from '../baseSqlQuerier';
import { MySqlDialect } from './mysqlDialect';

export class MariadbQuerier extends BaseSqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new MySqlDialect(), conn);
  }

  processQueryResult<T>(res: any): T {
    return Array.isArray(res) ? res.slice(0, res.length) : res;
  }
}
