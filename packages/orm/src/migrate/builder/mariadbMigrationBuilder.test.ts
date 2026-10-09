import { MariadbQuerierPool } from '../../mariadb/mariadbQuerierPool.js';
import { createSpec, mariadbConnection } from '../../test/index.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class MariadbMigrationBuilderIt extends AlterCapableMigrationBuilderIt {}

createSpec(new MariadbMigrationBuilderIt(new MariadbQuerierPool(mariadbConnection('test_builder'))));
