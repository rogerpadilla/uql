import { MsSqlQuerierPool } from '../../mssql/mssqlQuerierPool.js';
import { createSpec, mssqlConnection } from '../../test/index.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class MsSqlMigrationBuilderIt extends AlterCapableMigrationBuilderIt {}

createSpec(new MsSqlMigrationBuilderIt(new MsSqlQuerierPool(mssqlConnection('test_builder'))));
