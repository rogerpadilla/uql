import { createSpec } from 'uql/test.util';
import { SqlQuerierSpec } from '../sqlQuerierSpec';
import PgQuerierPool from './pgQuerierPool';
import { escapeId as postgresEscapeId } from './postgresDialect';

export class PostgresQuerierSpec extends SqlQuerierSpec {
  readonly primaryKeyType: string = 'SERIAL PRIMARY KEY';

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

  escapeId(val: string) {
    return postgresEscapeId(val);
  }
}

createSpec(new PostgresQuerierSpec());
