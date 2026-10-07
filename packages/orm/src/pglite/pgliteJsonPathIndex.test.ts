import { JsonPathIndexIt } from '../querier/jsonPathIndex-test.js';
import { createSpec } from '../test/index.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

createSpec(new JsonPathIndexIt(new PgliteQuerierPool('memory://')));
