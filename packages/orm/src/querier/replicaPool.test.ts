import { CrdbQuerierPool } from '../cockroachdb/index.js';
import { MariadbQuerierPool } from '../mariadb/index.js';
import { MsSqlQuerierPool } from '../mssql/index.js';
import { MySql2QuerierPool } from '../mysql/index.js';
import { PgQuerierPool } from '../postgres/index.js';
import {
  cockroachConnection,
  createSpec,
  mariadbConnection,
  mssqlConnection,
  mysqlConnection,
  postgresConnection,
} from '../test/index.js';
import { ReplicaPoolIt } from './replicaPool-test.js';

createSpec(new ReplicaPoolIt(PgQuerierPool, postgresConnection, 'SELECT pg_backend_pid() AS id'));
createSpec(new ReplicaPoolIt(CrdbQuerierPool, cockroachConnection, 'SELECT session_id AS id FROM [SHOW session_id]'));
createSpec(new ReplicaPoolIt(MySql2QuerierPool, mysqlConnection, 'SELECT CONNECTION_ID() AS id'));
createSpec(new ReplicaPoolIt(MariadbQuerierPool, mariadbConnection, 'SELECT CONNECTION_ID() AS id'));
createSpec(new ReplicaPoolIt(MsSqlQuerierPool, mssqlConnection, 'SELECT @@SPID AS id'));
