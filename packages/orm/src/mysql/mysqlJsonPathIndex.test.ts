import { JsonPathIndexIt } from '../querier/jsonPathIndex-test.js';
import { createSpec, mysqlConnection } from '../test/index.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

class MySqlJsonPathIndexIt extends JsonPathIndexIt {
  override readonly analyze = 'ANALYZE TABLE';
}

createSpec(new MySqlJsonPathIndexIt(new MySql2QuerierPool(mysqlConnection())));
