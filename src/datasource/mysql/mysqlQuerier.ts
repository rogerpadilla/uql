import { QuerierPoolConnection } from '../type';
import { SqlQuerier } from '../sqlQuerier';
import { MySqlDialect } from './mysqlDialect';

export class MySqlQuerier extends SqlQuerier {
  constructor(protected readonly conn: QuerierPoolConnection) {
    super(new MySqlDialect(), conn);
  }

  parseQueryResult<T>(res: [T]) {
    return res[0];
  }
}
