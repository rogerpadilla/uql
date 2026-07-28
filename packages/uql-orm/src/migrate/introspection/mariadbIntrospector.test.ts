import { MariadbQuerierPool } from '../../maria/mariadbQuerierPool.js';
import { createSpec } from '../../test/index.js';
import { MySqlFamilyIntrospectorIt } from './mysqlFamilyIntrospector-test.js';
import { MariadbSchemaIntrospector } from './mysqlIntrospector.js';

class MariadbIntrospectorIt extends MySqlFamilyIntrospectorIt {
  constructor() {
    const pool = new MariadbQuerierPool({
      host: '0.0.0.0',
      port: 3326,
      user: 'test',
      password: 'test',
      database: 'test',
    });
    super(pool, new MariadbSchemaIntrospector(pool));
  }
}

createSpec(new MariadbIntrospectorIt());
