import { MariadbQuerierPool } from '../../maria/mariadbQuerierPool.js';
import { createSpec, mariadbConnection } from '../../test/index.js';
import { MySqlFamilyIntrospectorIt } from './mysqlFamilyIntrospector-test.js';
import { MariadbSchemaIntrospector } from './mysqlIntrospector.js';

class MariadbIntrospectorIt extends MySqlFamilyIntrospectorIt {
  constructor() {
    const pool = new MariadbQuerierPool(mariadbConnection());
    super(pool, new MariadbSchemaIntrospector(pool));
  }
}

createSpec(new MariadbIntrospectorIt());
