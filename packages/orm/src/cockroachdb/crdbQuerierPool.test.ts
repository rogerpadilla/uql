import type { PgQuerier } from '../postgres/pgQuerier.js';
import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { cockroachConnection, createSpec } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

export class CockroachQuerierPoolIt extends AbstractSqlQuerierPoolIt<PgQuerier> {
  constructor() {
    super(new CrdbQuerierPool(cockroachConnection()));
  }
}

createSpec(new CockroachQuerierPoolIt());
