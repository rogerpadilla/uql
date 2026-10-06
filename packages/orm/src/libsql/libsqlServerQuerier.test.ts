import { FLOATED_DECIMAL } from '../querier/abstractSqlQuerier-test.js';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec, libsqlServerUrl } from '../test/index.js';
import { LibsqlQuerierPool } from './libsqlQuerierPool.js';

/** libSQL over HTTP, as a remote database is reached: each transaction on a stream of its own. */
export class LibsqlServerQuerierIt extends VectorQuerierIt {
  constructor() {
    super(new LibsqlQuerierPool({ url: libsqlServerUrl }));
  }
  protected override expectedExactDecimal() {
    return FLOATED_DECIMAL;
  }
}

createSpec(new LibsqlServerQuerierIt());
