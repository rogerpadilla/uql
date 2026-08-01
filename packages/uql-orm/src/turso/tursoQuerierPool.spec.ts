import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HranaClient } from '../sqlite/hranaQuerier.js';
import { TursoDialect, TursoQuerier, TursoQuerierPool } from './index.js';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('@tursodatabase/serverless/compat', () => ({ createClient }));

function buildClient() {
  return {
    execute: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn(),
  } satisfies HranaClient;
}

describe('TursoQuerierPool', () => {
  const config = { url: 'libsql://db.turso.io', authToken: 't' };
  let client: ReturnType<typeof buildClient>;

  beforeEach(() => {
    client = buildClient();
    createClient.mockReset();
    createClient.mockReturnValue(client);
  });

  it('defers building the client until a querier is acquired', async () => {
    const pool = new TursoQuerierPool(config);
    expect(createClient).not.toHaveBeenCalled();

    const querier = await pool.getQuerier();

    expect(createClient).toHaveBeenCalledWith(config);
    expect(querier).toBeInstanceOf(TursoQuerier);
    expect(querier.client).toBe(client);
  });

  it('reuses the same client across acquisitions', async () => {
    const pool = new TursoQuerierPool(config);
    const q1 = await pool.getQuerier();
    const q2 = await pool.getQuerier();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(q1.client).toBe(q2.client);
  });

  it('uses an injected client instead of building one', async () => {
    const injected = buildClient();
    const pool = new TursoQuerierPool(injected);

    const querier = await pool.getQuerier();

    expect(createClient).not.toHaveBeenCalled();
    expect(querier.client).toBe(injected);
  });

  it('uses the sqlite dialect, so schema and migrations are shared', async () => {
    const pool = new TursoQuerierPool(config);
    expect(pool.dialect).toBeInstanceOf(TursoDialect);
    expect(pool.dialect.dialectName).toBe('sqlite');
  });

  it('end closes a client it built, and reopens on next use', async () => {
    const pool = new TursoQuerierPool(config);
    await pool.getQuerier();

    await pool.end();

    expect(client.close).toHaveBeenCalled();

    await pool.getQuerier();
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it('end leaves an injected client open, since the caller owns it', async () => {
    const injected = buildClient();
    const pool = new TursoQuerierPool(injected);
    await pool.getQuerier();

    await pool.end();

    expect(injected.close).not.toHaveBeenCalled();
  });

  it('end before any acquisition is a no-op', async () => {
    const pool = new TursoQuerierPool(config);
    await pool.end();
    expect(client.close).not.toHaveBeenCalled();
  });
});
