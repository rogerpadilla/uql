import { createTables, dropTables } from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { AbstractQuerierIt } from './abstractQuerier-it.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';

export abstract class AbstractSqlQuerierIt extends AbstractQuerierIt<AbstractSqlQuerier> {
  constructor(
    pool: QuerierPool<AbstractSqlQuerier>,
    readonly idType: string,
  ) {
    super(pool);
  }

  override createTables() {
    return createTables(this.querier, this.idType);
  }

  override dropTables() {
    return dropTables(this.querier);
  }
}
