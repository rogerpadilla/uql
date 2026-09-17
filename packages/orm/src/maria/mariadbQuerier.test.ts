import { assertRelationPastConcatLimit } from '../querier/mysqlLikeQuerier-test.js';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec, mariadbConnection } from '../test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

export class MariadbQuerierIt extends VectorQuerierIt {
  constructor() {
    super(new MariadbQuerierPool({ ...mariadbConnection(), trace: true }));
  }

  shouldReadARelationPastTheConcatLimit() {
    return assertRelationPastConcatLimit(this.querier);
  }
}

createSpec(new MariadbQuerierIt());
