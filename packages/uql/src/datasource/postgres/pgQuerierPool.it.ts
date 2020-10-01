import { createSpec } from 'uql/test.util';
import { SqlQuerierPoolSpec } from '../sqlQuerierPoolSpec';
import PgQuerierPool from './pgQuerierPool';
import { escapeId as postgresEscapeId } from './postgresDialect';

export class PostgresQuerierPoolSpec extends SqlQuerierPoolSpec {
  constructor() {
    super(
      new PgQuerierPool({
        host: '0.0.0.0',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test',
      })
    );
  }

  getPrimaryKeyType() {
    return 'SERIAL PRIMARY KEY';
  }

  escapeId(val: string) {
    return postgresEscapeId(val);
  }
}

createSpec(new PostgresQuerierPoolSpec());
