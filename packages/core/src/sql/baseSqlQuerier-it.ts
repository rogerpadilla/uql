import { BaseQuerierIt } from '../querier/baseQuerier-it';
import { QuerierPool } from '../type';
import { createTables, dropTables } from '../test';
import { BaseSqlQuerier } from './baseSqlQuerier';

export abstract class BaseSqlQuerierIt extends BaseQuerierIt<BaseSqlQuerier> {
  readonly primaryKeyType: string = 'INTEGER PRIMARY KEY';

  constructor(pool: QuerierPool<BaseSqlQuerier>) {
    super(pool);
  }

  override createTables() {
    return createTables(this.querier, this.primaryKeyType);
  }

  override dropTables() {
    return dropTables(this.querier);
  }
}
