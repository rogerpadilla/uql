import { type Config, createClient } from '@libsql/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibsqlQuerier } from './libsqlQuerier.js';
import { LibsqlQuerierPool, libsqlUseRemoteForMigrations } from './libsqlQuerierPool.js';

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({
    close: vi.fn(),
  })),
}));

describe('libsqlUseRemoteForMigrations', () => {
  it('is true for file: url with syncUrl', () => {
    expect(libsqlUseRemoteForMigrations({ url: 'file:./app.db', syncUrl: 'libsql://x' })).toBe(true);
  });

  it('is false without syncUrl, non-file url, or :memory:', () => {
    expect(libsqlUseRemoteForMigrations({ url: 'file:./a.db' })).toBe(false);
    expect(libsqlUseRemoteForMigrations({ url: 'libsql://only', syncUrl: 'libsql://x' })).toBe(false);
    expect(libsqlUseRemoteForMigrations({ url: ':memory:', syncUrl: 'libsql://x' })).toBe(false);
  });
});

describe('LibsqlQuerierPool', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockClear();
  });

  it('builds no client until a querier is acquired', async () => {
    const config = { url: ':memory:' };
    const pool = new LibsqlQuerierPool(config);
    expect(createClient).not.toHaveBeenCalled();

    const querier = await pool.getQuerier();

    expect(querier).toBeInstanceOf(LibsqlQuerier);
    expect(createClient).toHaveBeenCalledWith(config);
  });

  it('shares one client across queriers when not an embedded replica', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:' });
    const q1 = await pool.getQuerier();
    const q2 = await pool.getMigrationQuerier();
    expect(q1.client).toBe(q2.client);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('getMigrationQuerier uses remote config for file: + syncUrl', async () => {
    const config = { url: 'file:./local.db', syncUrl: 'libsql://remote.test', authToken: 't' };
    const pool = new LibsqlQuerierPool(config);

    const q = await pool.getMigrationQuerier();
    expect(q).toBeInstanceOf(LibsqlQuerier);
    expect(createClient).toHaveBeenCalledTimes(1);

    const remoteArg = vi.mocked(createClient).mock.calls[0][0] as Config;
    expect(remoteArg.url).toBe('libsql://remote.test');
    expect(remoteArg.authToken).toBe('t');
    expect('syncUrl' in remoteArg ? remoteArg.syncUrl : undefined).toBeUndefined();

    // A one-shot migration client is closed by the querier that owns it.
    await q.release();
    expect(q.client.close).toHaveBeenCalled();
  });

  it('closes the client on end', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:' });
    const querier = await pool.getQuerier();

    await pool.end();

    expect(querier.client.close).toHaveBeenCalled();
  });

  it('closes nothing on end when no querier was acquired', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:' });
    await expect(pool.end()).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });
});
