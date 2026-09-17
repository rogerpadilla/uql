import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec } from '../test/index.js';
import { NeonQuerierPool } from './neonQuerierPool.js';

// Real Neon always fronts Postgres over a secure websocket; locally there's no hosted project to
// hit, so `neon-wsproxy` (docker-compose) stands in as a plain websocket->TCP proxy in front of
// the same Postgres container the `postgres`/`cockroachdb` suites use. `forceDisablePgSSL`
// defaults to `true` already, which is correct here (the local Postgres doesn't speak TLS).
neonConfig.webSocketConstructor = ws;
neonConfig.useSecureWebSocket = false;
neonConfig.wsProxy = (host, port) => `localhost:5443/v1?address=${host}:${port}`;
// Required for SCRAM auth to succeed against a plain (non-Neon) Postgres through a local proxy -
// without it the client offers a SASL mechanism the server rejects.
neonConfig.pipelineConnect = false;
neonConfig.pipelineTLS = false;

/** The same Postgres the `postgres` suite runs, just tunneled through wsproxy, so it expects the same. */
export class NeonQuerierIt extends PostgresQuerierIt {
  constructor() {
    super(
      new NeonQuerierPool({
        host: 'postgres',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test_neon',
      }),
    );
  }
}

createSpec(new NeonQuerierIt());
