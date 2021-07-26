import { QuerierPool } from '@uql/core/type';
import { createTables, dropTables } from '@uql/core/test';
import { BaseQuerierIt } from './baseQuerier-it';
import { SqlQuerier } from './sqlQuerier';

export abstract class BaseSqlQuerierIt extends BaseQuerierIt<SqlQuerier> {
  readonly primaryKeyType: string = 'INTEGER PRIMARY KEY';

  constructor(pool: QuerierPool<SqlQuerier>) {
    super(pool);
  }

  override createTables() {
    return createTables(this.querier, this.primaryKeyType);
  }

  override dropTables() {
    return dropTables(this.querier);
  }
}
