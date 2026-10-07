import { PgliteQuerierPool } from '../../pglite/pgliteQuerierPool.js';
import { createSpec } from '../../test/index.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class PgliteMigrationBuilderIt extends AlterCapableMigrationBuilderIt {}

createSpec(new PgliteMigrationBuilderIt(new PgliteQuerierPool('memory://')));
