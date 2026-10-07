import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec } from '../test/index.js';
import { NeonQuerierPool } from './neonQuerierPool.js';

// Real Neon fronts Postgres over a secure websocket; locally `neon-wsproxy` (docker-compose) stands in, a plain
// websocket proxy to the `postgres` container, which speaks no TLS (`forceDisablePgSSL` defaults to true).
neonConfig.webSocketConstructor = ws;
neonConfig.useSecureWebSocket = false;
neonConfig.wsProxy = (host, port) => `localhost:5443/v1?address=${host}:${port}`;
// Pipelining offers a SASL mechanism a plain Postgres rejects, so SCRAM auth through the proxy needs it off.
neonConfig.pipelineConnect = false;
neonConfig.pipelineTLS = false;

const connection = () => ({ host: 'postgres', port: 5432, user: 'test', password: 'test', database: 'test_neon' });

createSpec(new PostgresQuerierIt(new NeonQuerierPool(connection())));
createSpec(new SqlQuerierPoolIt(() => new NeonQuerierPool(connection())));
