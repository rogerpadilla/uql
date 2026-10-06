import { Session } from '@tursodatabase/serverless';
import { describe, expect, it } from 'vitest';
import { TursoDialect, TursoQuerierPool, TursoSessionQuerier } from './index.js';

/**
 * On the real driver, which reaches no server until a statement is sent: Turso Cloud cannot run here, so
 * what a statement does on a session is held by `tursoSessionQuerier.spec.ts`.
 */
describe('TursoQuerierPool', () => {
  const config = { url: 'libsql://db.turso.io', authToken: 't' };

  /** A session is one server stream, so queriers never wait on each other and a transaction spans one. */
  it('should give every querier a session of its own', async () => {
    const pool = new TursoQuerierPool(config);

    const first = await pool.getQuerier();
    const second = await pool.getQuerier();

    expect(first).toBeInstanceOf(TursoSessionQuerier);
    expect(first.session).toBeInstanceOf(Session);
    expect(first.session).not.toBe(second.session);
  });

  /** The driver refuses a `Host` header as its session opens, which is how far the settings are seen to go. */
  it('should open the session with the request headers it was given', async () => {
    const pool = new TursoQuerierPool({ ...config, requestHeaders: { host: 'elsewhere.turso.io' } });

    await expect(pool.getQuerier()).rejects.toThrow("overwriting the 'Host' header is not supported");
  });

  /** A Turso Cloud database runs libSQL unless it was created as `tursodb`, so the dialect accepts what both do. */
  it('should use the dialect every Turso Cloud database accepts', () => {
    const pool = new TursoQuerierPool(config);
    expect(pool.dialect).toBeInstanceOf(TursoDialect);
    expect(pool.dialect.dialectName).toBe('sqlite');
  });

  /** Every querier closes its own session, so the pool has nothing left to close. */
  it('should end with nothing to close', async () => {
    await expect(new TursoQuerierPool(config).end()).resolves.toBeUndefined();
  });
});
