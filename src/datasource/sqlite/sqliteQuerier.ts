import { QuerierPoolConnection } from '../type';
import { SqlQuerier } from '../sqlQuerier';
import { SqliteDialect } from './sqliteDialect';

export class SqliteQuerier extends SqlQuerier {
  constructor(protected readonly conn: QuerierPoolConnection) {
    super(new SqliteDialect(), conn);
  }
}
