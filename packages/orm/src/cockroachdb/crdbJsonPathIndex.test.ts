import { JsonPathIndexIt } from '../querier/jsonPathIndex-test.js';
import { cockroachConnection, createSpec } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

createSpec(new JsonPathIndexIt(new CrdbQuerierPool(cockroachConnection())));
