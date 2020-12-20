import { createSpec } from '../../test';
import { BaseSqlQuerierPoolIt } from '../baseSqlQuerierPoolIt';
import { MariadbQuerierPool } from './mariadbQuerierPool';

export class MariadbQuerierPoolSpec extends BaseSqlQuerierPoolIt {
  constructor() {
    super(
      new MariadbQuerierPool({
        host: '0.0.0.0',
        port: 3310,
        user: 'test',
        password: 'test',
        database: 'test',
      })
    );
  }
}

createSpec(new MariadbQuerierPoolSpec());
