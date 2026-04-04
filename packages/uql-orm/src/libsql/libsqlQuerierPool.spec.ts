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

  it('getQuerier', async () => {
    const config = { url: ':memory:' };
    const pool = new LibsqlQuerierPool(config);
    const querier = await pool.getQuerier();
    expect(querier).toBeInstanceOf(LibsqlQuerier);
    expect(createClient).toHaveBeenCalledWith(config);
  });

  it('getMigrationQuerier matches getQuerier when not embedded replica', async () => {
    const config = { url: ':memory:' };
    const pool = new LibsqlQuerierPool(config);
    const q1 = await pool.getQuerier();
    const q2 = await pool.getMigrationQuerier();
    expect(q1.client).toBe(pool.client);
    expect(q2.client).toBe(pool.client);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('getMigrationQuerier uses remote config for file: + syncUrl', async () => {
    const config = { url: 'file:./local.db', syncUrl: 'libsql://remote.test', authToken: 't' };
    const pool = new LibsqlQuerierPool(config);
    expect(createClient).toHaveBeenCalledTimes(1);

    const q = await pool.getMigrationQuerier();
    expect(q).toBeInstanceOf(LibsqlQuerier);
    expect(createClient).toHaveBeenCalledTimes(2);

    expect(createClient).toHaveBeenNthCalledWith(1, config);

    const remoteArg = vi.mocked(createClient).mock.calls[1][0] as Config;
    expect(remoteArg.url).toBe('libsql://remote.test');
    expect(remoteArg.authToken).toBe('t');
    expect('syncUrl' in remoteArg ? remoteArg.syncUrl : undefined).toBeUndefined();

    await q.release();
    expect(q.client.close).toHaveBeenCalled();
  });

  it('end', async () => {
    const config = { url: ':memory:' };
    const pool = new LibsqlQuerierPool(config);
    await pool.end();
    expect(pool.client.close).toHaveBeenCalled();
  });
});
