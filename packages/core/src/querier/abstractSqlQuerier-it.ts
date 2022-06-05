import { createTables, dropTables } from '../test/index';
import { QuerierPool } from '../type/index';
import { AbstractQuerierIt } from './abstractQuerier-it';
import { AbstractSqlQuerier } from './abstractSqlQuerier';

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
