import { createTables, dropTables } from '../test';
import { QuerierPool } from '../type';
import { AbstractQuerierIt } from './abstractQuerier-it.js';
import { AbstractSqlQuerier } from './abstractSqlQuerier.js';

export abstract class AbstractSqlQuerierIt extends AbstractQuerierIt<AbstractSqlQuerier> {
  constructor(pool: QuerierPool<AbstractSqlQuerier>, readonly idType: string) {
    super(pool);
  }

  override createTables() {
    return createTables(this.querier, this.idType);
  }

  override dropTables() {
    return dropTables(this.querier);
  }
}
