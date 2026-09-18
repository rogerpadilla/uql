import { describeVectorTuning } from '../querier/vectorTuning-test.js';
import { cockroachConnection } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

describeVectorTuning('CockroachDB', () => new CrdbQuerierPool(cockroachConnection()));
