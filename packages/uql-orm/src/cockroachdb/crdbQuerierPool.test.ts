import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import { configurePgNumericTypeParsers } from '../test/pgTypeParsers.util.js';
import type { CrdbQuerier } from './crdbQuerier.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

configurePgNumericTypeParsers();

export class CockroachQuerierPoolIt extends AbstractSqlQuerierPoolIt<CrdbQuerier> {
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
