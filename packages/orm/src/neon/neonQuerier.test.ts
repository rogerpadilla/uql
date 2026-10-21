import { neonConfig } from '@neondatabase/serverless';
import { v7 as uuidv7 } from 'uuid';
import { expect, vi } from 'vitest';
import ws from 'ws';
import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec, Tax } from '../test/index.js';
import type { SqlQuerier } from '../type/index.js';
import { NeonQuerierPool } from './neonQuerierPool.js';

// Real Neon fronts Postgres over a secure websocket; locally `neon-wsproxy` (docker-compose) stands in, a plain
// websocket proxy to the `postgres` container, which speaks no TLS (`forceDisablePgSSL` defaults to true).
neonConfig.webSocketConstructor = ws;
neonConfig.useSecureWebSocket = false;
neonConfig.wsProxy = (host, port) => `localhost:5443/v1?address=${host}:${port}`;
// Pipelining offers a SASL mechanism a plain Postgres rejects, so SCRAM auth through the proxy needs it off.
neonConfig.pipelineConnect = false;
neonConfig.pipelineTLS = false;

// Neon's HTTP endpoint, which `neon-http-proxy` (docker-compose) stands in for on `test_neon`, each request counted.
let httpRequests = 0;
neonConfig.fetchEndpoint = () => 'http://localhost:4444/sql';
neonConfig.fetchFunction = (input: string, init: RequestInit) => {
  httpRequests++;
  return fetch(input, init);
};

const connection = () => ({ host: 'postgres', port: 5432, user: 'test', password: 'test', database: 'test_neon' });

/**
 * The Postgres suite over HTTP first, and where each statement goes: HTTP requests, or a WebSocket session. Each
 * case takes a querier of its own, since the suite's querier may already hold a session its setup took.
 */
/** Rows of two shapes, which an upsert writes as two statements. */
function splitRows() {
  return [
    { id: uuidv7(), name: 'a' },
    { id: uuidv7(), name: 'b', percentage: 10 },
  ];
}

class NeonQuerierIt extends PostgresQuerierIt {
  constructor(private readonly neonPool: NeonQuerierPool) {
    super(neonPool);
  }

  async shouldSendAStatementAsOneHttpRequest() {
    await using querier = await this.neonPool.getQuerier();

    expect(await this.traffic(() => querier.all`SELECT 1 AS one`)).toEqual({ http: 1, sessions: 0 });
  }

  async shouldSendASplitWriteAsOneHttpTransaction() {
    await using querier = await this.neonPool.getQuerier();
    const traffic = await this.traffic(() => querier.upsertMany(Tax, { id: true }, splitRows()));

    expect(traffic).toEqual({ http: 1, sessions: 0 });
    expect(await querier.count(Tax)).toBe(2);
  }

  async shouldRunATransactionOnOneSessionItKeepsUntilReleased() {
    await using querier = await this.neonPool.getQuerier();

    const during = await this.traffic(() =>
      querier.transaction(async () => {
        await querier.all`SELECT 1 AS one`;
        await querier.upsertMany(Tax, { id: true }, splitRows());
      }),
    );
    const after = await this.traffic(() => querier.all`SELECT 4 AS four`);

    expect(during).toEqual({ http: 0, sessions: 1 });
    expect(after).toEqual({ http: 0, sessions: 0 });
  }

  async shouldSendAListOverHttpOutsideATransactionWhileHoldingASession() {
    await using querier = await this.neonPool.getQuerier();
    await querier.transaction(async () => {
      await querier.all`SELECT 1 AS one`;
    });

    const traffic = await this.traffic(() => querier.upsertMany(Tax, { id: true }, splitRows()));

    expect(traffic).toEqual({ http: 1, sessions: 0 });
  }

  async shouldStreamOnASession() {
    await using querier = await this.neonPool.getQuerier();
    await querier.insertMany(Tax, [{ name: 'a' }, { name: 'b' }]);
    const names: unknown[] = [];

    const traffic = await this.traffic(async () => {
      for await (const tax of querier.findManyStream(Tax, { $select: { name: true }, $sort: { name: 1 } })) {
        names.push(tax.name);
      }
    });

    expect(names).toEqual(['a', 'b']);
    expect(traffic).toEqual({ http: 0, sessions: 1 });
  }

  async shouldMigrateOnOneSession() {
    await using querier = await this.neonPool.getMigrationQuerier();
    const pids: unknown[] = [];

    const traffic = await this.traffic(async () => {
      pids.push(...(await querier.all`SELECT pg_backend_pid() AS pid`));
      pids.push(...(await querier.all`SELECT pg_backend_pid() AS pid`));
    });

    expect(traffic).toEqual({ http: 0, sessions: 1 });
    expect(pids[1]).toEqual(pids[0]);
  }

  /** The HTTP requests sent and the WebSocket sessions taken while `work` runs. */
  private async traffic(work: () => Promise<unknown>): Promise<{ http: number; sessions: number }> {
    const connect = vi.spyOn(this.neonPool.pool, 'connect');
    const before = httpRequests;
    try {
      await work();
      return { http: httpRequests - before, sessions: connect.mock.calls.length };
    } finally {
      connect.mockRestore();
    }
  }
}

createSpec(new NeonQuerierIt(new NeonQuerierPool(connection())));
/** The pool suite with its statement on a session, which an ended pool closed: an HTTP request holds nothing to close. */
class NeonQuerierPoolIt extends SqlQuerierPoolIt {
  protected override statementOn(querier: SqlQuerier): Promise<unknown> {
    return querier.transaction(() => querier.all`SELECT 1 AS one`);
  }
}

createSpec(new NeonQuerierPoolIt(() => new NeonQuerierPool(connection())));
