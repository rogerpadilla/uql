import { describe, expect, it } from 'vitest';
import { MariaDialect } from '../maria/index.js';
import { MySqlDialect } from '../mysql/index.js';
import { PostgresDialect } from '../postgres/index.js';
import { assertDefined } from '../test/index.js';
import { BunSqlQuerier } from './bunSqlQuerier.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

describe('BunSqlQuerierPool', () => {
  it('should initialize with correct dialect', () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    expect(pool.dialect).toBeInstanceOf(PostgresDialect);
    expect(pool.dialect).toMatchObject({ driverCapabilities: { explicitJsonCast: true, nativeArrays: false } });
  });

  it('should support config object with adapter', () => {
    const pool = new BunSqlQuerierPool({ adapter: 'postgres', hostname: 'localhost' });
    expect(pool.sql).toBeDefined();
  });

  it('should handle cockroachdb', () => {
    const pool = new BunSqlQuerierPool({ url: 'cockroachdb://localhost' });
    expect(pool.dialect.dialectName).toBe('cockroachdb');
    // bun:sql routes CockroachDB through its own Postgres wire-protocol implementation, so it
    // needs the identical wire-driver-capability fix as postgres (verified live: without it,
    // $set/$push on a JSONB column silently produce the wrong value or throw).
    expect(pool.dialect).toMatchObject({ driverCapabilities: { explicitJsonCast: true, nativeArrays: false } });
  });

  it('should drive MySQL and MariaDB on their own dialects', () => {
    expect(new BunSqlQuerierPool({ url: 'mysql://localhost' }).dialect).toBeInstanceOf(MySqlDialect);
    expect(new BunSqlQuerierPool({ url: 'mariadb://localhost' }).dialect).toBeInstanceOf(MariaDialect);
  });

  /** `Sqlite3QuerierPool` runs on `bun:sqlite` under Bun, so SQLite is refused here rather than half-served. */
  it('should refuse SQLite, pointing at its own pool', () => {
    expect(() => new BunSqlQuerierPool({ url: 'sqlite://:memory:' })).toThrow('uql-orm/sqlite pool');
  });

  /** Its `query` is driven against a live server in `bunPostgres.test.ts`, which only `bun test` runs. */
  it('should accept the event listeners a pg pool takes, having none to call', () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    const { on } = pool.pool;
    assertDefined(on);
    expect(() => on('error', () => {})).not.toThrow();
  });

  it('should return a BunSqlQuerier', async () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    expect(await pool.getQuerier()).toBeInstanceOf(BunSqlQuerier);
  });
});
