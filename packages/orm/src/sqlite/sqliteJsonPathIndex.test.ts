import { JsonPathIndexIt } from '../querier/jsonPathIndex-test.js';
import { createSpec } from '../test/index.js';
import { NodeSqliteQuerierPool } from './nodeSqliteQuerierPool.js';

class SqliteJsonPathIndexIt extends JsonPathIndexIt {
  override readonly explain = 'EXPLAIN QUERY PLAN';
}

createSpec(new SqliteJsonPathIndexIt(new NodeSqliteQuerierPool(':memory:')));
