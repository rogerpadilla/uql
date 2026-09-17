import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TursoDialect, TursoQuerierPool, TursoSessionQuerier } from './index.js';

const { Session } = vi.hoisted(() => ({ Session: vi.fn(function () {}) }));

vi.mock('@tursodatabase/serverless', () => ({ Session }));

describe('TursoQuerierPool', () => {
  const config = {
    url: 'libsql://db.turso.io',
    authToken: 't',
    requestHeaders: { 'x-gateway': 'edge' },
    defaultQueryTimeout: 5000,
  };

  beforeEach(() => {
    Session.mockClear();
  });

  it('should open no session until a querier is acquired, then open it with every setting', async () => {
    const pool = new TursoQuerierPool(config);
    expect(Session).not.toHaveBeenCalled();

    const querier = await pool.getQuerier();

    expect(Session).toHaveBeenCalledWith(config);
    expect(querier).toBeInstanceOf(TursoSessionQuerier);
  });

  /** A session is one server stream, so queriers never wait on each other and a transaction spans one. */
  it('should give every querier a session of its own', async () => {
    const pool = new TursoQuerierPool(config);

    const first = await pool.getQuerier();
    const second = await pool.getQuerier();

    expect(Session).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });

  /** A Turso Cloud database runs libSQL unless it was created as `tursodb`, so the dialect accepts what both do. */
  it('should use the dialect every Turso Cloud database accepts', () => {
    const pool = new TursoQuerierPool(config);
    expect(pool.dialect).toBeInstanceOf(TursoDialect);
    expect(pool.dialect.dialectName).toBe('sqlite');
  });
});
