import { QuerierPoolConnection } from '@uql/core/type';
import { BaseSqlQuerier } from '@uql/core/sql';
import { PostgresDialect } from './postgresDialect';

export class PostgresQuerier extends BaseSqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(conn, new PostgresDialect());
  }
}
