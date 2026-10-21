import { ok } from 'node:assert';
import { Client, neonConfig } from '@neondatabase/serverless';
import { v7 as uuidv7 } from 'uuid';
import { expect, onTestFinished, vi } from 'vitest';
import ws from 'ws';
import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { TunedItem } from '../querier/vectorTuning-test.js';
import { createSpec, type SpecRequirements, Tax } from '../test/index.js';
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

    expect(await this.sessions(() => querier.all`SELECT 1 AS one`)).toEqual({ http: 1, opened: 0, ended: 0 });
  }

  async shouldSendASplitWriteAsOneHttpTransaction() {
    await using querier = await this.neonPool.getQuerier();
    const traffic = await this.sessions(() => querier.upsertMany(Tax, { id: true }, splitRows()));

    expect(traffic).toEqual({ http: 1, opened: 0, ended: 0 });
    expect(await querier.count(Tax)).toBe(2);
  }

  async shouldSendATunedVectorSearchAsOneHttpTransaction() {
    await using querier = await this.neonPool.getQuerier();
    await querier.insertMany(TunedItem, [{ vec: [1, 0, 0] }, { vec: [0, 1, 0] }]);

    const traffic = await this.sessions(() =>
      querier.findMany(TunedItem, { $sort: { vec: { $vector: [0, 1, 0] } }, $limit: 1, $candidates: 100 }),
    );

    expect(traffic).toEqual({ http: 1, opened: 0, ended: 0 });
  }

  async shouldRunATransactionOnOneSessionItKeepsUntilReleased() {
    await using querier = await this.neonPool.getQuerier();

    const during = await this.sessions(() =>
      querier.transaction(async () => {
        await querier.all`SELECT 1 AS one`;
        await querier.upsertMany(Tax, { id: true }, splitRows());
      }),
    );
    const after = await this.sessions(() => querier.all`SELECT 4 AS four`);

    expect(during).toEqual({ http: 0, opened: 1, ended: 0 });
    expect(after).toEqual({ http: 0, opened: 0, ended: 0 });
  }

  /** Nothing outlives the querier holding it, which is what lets one pool serve every request of an edge isolate. */
  async shouldOpenASessionPerTransactionAndEndItWithItsQuerier() {
    const work = () => this.neonPool.transaction((querier) => querier.all`SELECT 1 AS one`);

    expect(await this.sessions(async () => [await work(), await work()])).toEqual({ http: 0, opened: 2, ended: 2 });
  }

  /** A socket error while it closes would otherwise reach no listener, which ends the process. */
  async shouldHearASessionErrorAfterItsQuerierReleasedIt() {
    const end = vi.spyOn(Client.prototype, 'end');
    onTestFinished(() => end.mockRestore());

    await this.neonPool.transaction((querier) => querier.all`SELECT 1 AS one`);
    const [session] = end.mock.contexts;
    ok(session instanceof Client);

    expect(() => session.emit('error', new Error('socket hang up'))).not.toThrow();
  }

  async shouldSendAListOverHttpOutsideATransactionWhileHoldingASession() {
    await using querier = await this.neonPool.getQuerier();
    await querier.transaction(async () => {
      await querier.all`SELECT 1 AS one`;
    });

    const traffic = await this.sessions(() => querier.upsertMany(Tax, { id: true }, splitRows()));

    expect(traffic).toEqual({ http: 1, opened: 0, ended: 0 });
  }

  async shouldStreamOnASession() {
    await using querier = await this.neonPool.getQuerier();
    await querier.insertMany(Tax, [{ name: 'a' }, { name: 'b' }]);
    const names: unknown[] = [];

    const traffic = await this.sessions(async () => {
      for await (const tax of querier.findManyStream(Tax, { $select: { name: true }, $sort: { name: 1 } })) {
        names.push(tax.name);
      }
    });

    expect(names).toEqual(['a', 'b']);
    expect(traffic).toEqual({ http: 0, opened: 1, ended: 0 });
  }

  async shouldMigrateOnOneSessionItsReleaseCloses() {
    const pids: unknown[] = [];

    const traffic = await this.sessions(async () => {
      await using querier = await this.neonPool.getMigrationQuerier();
      pids.push(...(await querier.all`SELECT pg_backend_pid() AS pid`));
      pids.push(...(await querier.all`SELECT pg_backend_pid() AS pid`));
    });

    expect(traffic).toEqual({ http: 0, opened: 1, ended: 1 });
    expect(pids[1]).toEqual(pids[0]);
  }

  /** The HTTP requests sent, and the WebSocket sessions opened and ended, while `work` runs. */
  private async sessions(work: () => Promise<unknown>): Promise<{ http: number; opened: number; ended: number }> {
    const connect = vi.spyOn(Client.prototype, 'connect');
    const end = vi.spyOn(Client.prototype, 'end');
    const before = httpRequests;
    try {
      await work();
      return { http: httpRequests - before, opened: connect.mock.calls.length, ended: end.mock.calls.length };
    } finally {
      connect.mockRestore();
      end.mockRestore();
    }
  }
}

createSpec(new NeonQuerierIt(new NeonQuerierPool(connection())));
/** `end()` closes nothing: HTTP holds no connection, and each querier a session of its own, which its release ends. */
class NeonQuerierPoolIt extends SqlQuerierPoolIt {
  requirements(): SpecRequirements<this> {
    return { shouldRefuseAStatementAfterEnd: false };
  }
}

createSpec(new NeonQuerierPoolIt(() => new NeonQuerierPool(connection())));
