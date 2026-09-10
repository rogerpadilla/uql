import type { PgQuerier } from '../postgres/pgQuerier.js';
import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

export class CockroachQuerierPoolIt extends AbstractSqlQuerierPoolIt<PgQuerier> {
  constructor() {
    super(
      new CrdbQuerierPool({
        host: '0.0.0.0',
        port: 26257,
        user: 'root',
        database: 'defaultdb',
      }),
    );
  }
}

createSpec(new CockroachQuerierPoolIt());
