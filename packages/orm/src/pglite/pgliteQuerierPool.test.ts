import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import type { PgliteQuerier } from './pgliteQuerier.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

export class PgliteQuerierPoolIt extends AbstractSqlQuerierPoolIt<PgliteQuerier> {
  constructor() {
    super(new PgliteQuerierPool('memory://'));
  }
}

createSpec(new PgliteQuerierPoolIt());
