import { QuerierPoolConnection } from '../type';
import { SqlQuerier } from '../sqlQuerier';
import { PostgresDialect } from './postgresDialect';

export class PostgresQuerier extends SqlQuerier {
  constructor(protected readonly conn: QuerierPoolConnection) {
    super(new PostgresDialect(), conn);
  }
}
