import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { LibsqlQuerierPool } from './libsqlQuerierPool.js';

/** A server nothing listens on: an HTTP client opens no connection until a statement is sent. */
const unreachable = 'http://127.0.0.1:1';

describe('LibsqlQuerierPool', () => {
  it('should read an integer past 2^53 exactly even when the config asks for numbers', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:', intMode: 'number' });
    const querier = await pool.getQuerier();

    expect(await querier.all('SELECT 9007199254740993 AS big')).toEqual([{ big: '9007199254740993' }]);
    await pool.end();
  });

  it('should share a client it was given with every querier, and leave it open on end', async () => {
    const client = createClient({ url: ':memory:' });
    const pool = new LibsqlQuerierPool(client);

    const querier = await pool.getQuerier();
    const migration = await pool.getMigrationQuerier();
    await pool.end();

    expect(querier.client).toBe(client);
    expect(migration.client).toBe(client);
    expect(client.closed).toBe(false);
    client.close();
  });

  it('should migrate through the shared client when the database is no embedded replica', async () => {
    const pool = new LibsqlQuerierPool({ url: unreachable, syncUrl: unreachable });

    const querier = await pool.getQuerier();
    const migration = await pool.getMigrationQuerier();

    expect(migration.client).toBe(querier.client);
    await pool.end();
  });

  it('should migrate an embedded replica on its sync url, closing that client with its querier', async () => {
    // The replica's own file is never opened: only the migration querier is taken.
    const pool = new LibsqlQuerierPool({ url: 'file:replica.db', syncUrl: unreachable });

    const migration = await pool.getMigrationQuerier();
    await expect(migration.all('SELECT 1')).rejects.toThrow('fetch failed');
    await migration.release();

    await expect(migration.client.execute({ sql: 'SELECT 1' })).rejects.toThrow('Client is closed');
  });

  it('should close the client on end', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:' });
    const querier = await pool.getQuerier();

    await pool.end();

    await expect(querier.all('SELECT 1')).rejects.toThrow('CLIENT_CLOSED');
  });

  it('should close nothing on end when no querier was acquired', async () => {
    const pool = new LibsqlQuerierPool({ url: ':memory:' });
    await expect(pool.end()).resolves.toBeUndefined();
  });
});
