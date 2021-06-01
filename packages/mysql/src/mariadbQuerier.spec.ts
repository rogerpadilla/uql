import { createSpec } from '@uql/core/test';
import { BaseSqlQuerierSpec } from '@uql/core/sql/baseSqlQuerier-spec';
import { MariadbQuerier } from './mariadbQuerier';

class MariadbQuerierSpec extends BaseSqlQuerierSpec {
  constructor() {
    super(MariadbQuerier);
  }
}

createSpec(new MariadbQuerierSpec());
