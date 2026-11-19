import { ReplicaPoolIt } from '../querier/replicaPool-test.js';
import { createSpec, postgresConnection } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

function connection(name: string) {
  const { user, password, host, port, database } = postgresConnection(name);
  return { url: `postgres://${user}:${password}@${host}:${port}/${database}` };
}

createSpec(new ReplicaPoolIt(BunSqlQuerierPool, connection, 'SELECT pg_backend_pid() AS id'));
