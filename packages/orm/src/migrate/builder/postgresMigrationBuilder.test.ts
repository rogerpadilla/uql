import { PgQuerierPool } from '../../postgres/pgQuerierPool.js';
import { createSpec, postgresConnection } from '../../test/index.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class PostgresMigrationBuilderIt extends AlterCapableMigrationBuilderIt {}

createSpec(new PostgresMigrationBuilderIt(new PgQuerierPool(postgresConnection('test_builder'))));
