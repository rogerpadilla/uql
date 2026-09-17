import { createClient } from '@libsql/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type HranaClient, HranaQuerier } from '../sqlite/hranaQuerier.js';
import { LibsqlQuerierPool } from './libsqlQuerierPool.js';

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({
    close: vi.fn(),
  })),
}));

/** A client the caller built, as `@libsql/client/web` or `@libsql/client-wasm` does. */
function buildClient() {
  return {
    execute: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn(),
  } satisfies HranaClient;
}

describe('LibsqlQuerierPool', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockClear();
  });

  it('should build no client until a querier is acquired', async () => {
    const config = { url: ':memory:' };
    const pool = new LibsqlQuerierPool(config);
    expect(createClient).not.toHaveBeenCalled();

    const querier = await pool.getQuerier();

    expect(querier).toBeInstanceOf(HranaQuerier);
    expect(createClient).toHaveBeenCalledWith({ ...config, intMode: 'bigint' });
  });

  it('should read integers as bigints even when the config asks for numbers', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:', intMode: 'number' });

    await pool.getQuerier();

    expect(createClient).toHaveBeenCalledWith({ url: ':memory:', intMode: 'bigint' });
  });

  it('should open one client when acquisitions race', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:' });

    const [first, second] = await Promise.all([pool.getQuerier(), pool.getQuerier()]);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(first.client).toBe(second.client);
  });

  it('should share a client it was given with every querier, and leave it open on end', async () => {
    const client = buildClient();
    const pool = new LibsqlQuerierPool(client);

    const querier = await pool.getQuerier();
    const migration = await pool.getMigrationQuerier();
    await pool.end();

    expect(querier.client).toBe(client);
    expect(migration.client).toBe(client);
    expect(createClient).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
  });

  it('should migrate through the shared client when the database is no embedded replica', async () => {
    const pool = new LibsqlQuerierPool({ url: 'libsql://only.test', syncUrl: 'libsql://remote.test' });

    const querier = await pool.getQuerier();
    const migration = await pool.getMigrationQuerier();

    expect(migration.client).toBe(querier.client);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('should migrate an embedded replica on its sync url, closing that client with its querier', async () => {
    const pool = new LibsqlQuerierPool({ url: 'file:./local.db', syncUrl: 'libsql://remote.test', authToken: 't' });

    const migration = await pool.getMigrationQuerier();

    expect(migration).toBeInstanceOf(HranaQuerier);
    expect(createClient).toHaveBeenCalledWith({ url: 'libsql://remote.test', authToken: 't', intMode: 'bigint' });
    await migration.release();
    expect(migration.client.close).toHaveBeenCalled();
  });

  it('should close the client on end', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:' });
    const querier = await pool.getQuerier();

    await pool.end();

    expect(querier.client.close).toHaveBeenCalled();
  });

  it('should close nothing on end when no querier was acquired', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:' });
    await expect(pool.end()).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });
});
