import { PgliteQuerierPool } from '../../pglite/pgliteQuerierPool.js';
import { createSpec } from '../../test/index.js';
import { AbstractIntrospectorIt } from './abstractIntrospector-test.js';

class PgliteIntrospectorIt extends AbstractIntrospectorIt {}

createSpec(new PgliteIntrospectorIt(new PgliteQuerierPool('memory://')));
