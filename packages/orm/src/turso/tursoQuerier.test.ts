import { FLOATED_DECIMAL } from '../querier/abstractSqlQuerier-test.js';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec, tursoServerUrl } from '../test/index.js';
import { TursoQuerierPool } from './tursoQuerierPool.js';

/** Turso Cloud as it runs by default, libSQL's server, reached through a session per querier. */
export class TursoQuerierIt extends VectorQuerierIt {
  constructor() {
    super(new TursoQuerierPool({ url: tursoServerUrl }));
  }
  protected override expectedExactDecimal() {
    return FLOATED_DECIMAL;
  }
}

createSpec(new TursoQuerierIt());
