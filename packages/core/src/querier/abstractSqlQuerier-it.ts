import { QuerierPool } from '@uql/core/type';
import { createTables, dropTables } from '@uql/core/test';
import { AbstractQuerierIt } from './abstractQuerier-it';
import { AbstractSqlQuerier } from './abstractSqlQuerier';

export abstract class AbstractSqlQuerierIt extends AbstractQuerierIt<AbstractSqlQuerier> {
  readonly idType: string = 'SERIAL PRIMARY KEY';

  constructor(pool: QuerierPool<AbstractSqlQuerier>) {
    super(pool);
  }

  override createTables() {
    return createTables(this.querier, this.idType);
  }

  override dropTables() {
    return dropTables(this.querier);
  }
}
