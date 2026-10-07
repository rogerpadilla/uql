import { CrdbQuerierPool } from '../../cockroachdb/crdbQuerierPool.js';
import { cockroachConnection, createSpec } from '../../test/index.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class CockroachMigrationBuilderIt extends AlterCapableMigrationBuilderIt {}

createSpec(new CockroachMigrationBuilderIt(new CrdbQuerierPool(cockroachConnection('test_builder'))));
