import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

// Mock the dependencies
vi.mock('./sqliteQuerier.js', () => ({
  SqliteQuerier: vi.fn().mockImplementation(function (this: any, db: any, extra: any) {
    this.db = db;
    this.extra = extra;
  }),
}));

const mocks = vi.hoisted(() => ({
  bunDatabaseRun: vi.fn(),
  bunDatabaseClose: vi.fn(),
  betterDatabasePragma: vi.fn(),
  betterDatabaseClose: vi.fn(),
}));

vi.mock('bun:sqlite', () => {
  const Database = vi.fn().mockImplementation(function (this: any) {
    this.run = mocks.bunDatabaseRun;
    this.close = mocks.bunDatabaseClose;
  });
  return { Database };
});

vi.mock('better-sqlite3', () => {
  const Database = vi.fn().mockImplementation(function (this: any) {
    this.pragma = mocks.betterDatabasePragma;
    this.close = mocks.betterDatabaseClose;
  });
  return { default: Database };
});

describe('Sqlite3QuerierPool', () => {
  const originalBun = (globalThis as any).Bun;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as any).Bun = originalBun;
  });

  it('should use bun:sqlite when Bun is defined', async () => {
    (globalThis as any).Bun = {}; // Simulate Bun environment

    const pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();

    expect(querier).toBeDefined();
    expect(mocks.bunDatabaseRun).toHaveBeenCalledWith('PRAGMA journal_mode = WAL');
  });

  it('should use better-sqlite3 when Bun is undefined', async () => {
    (globalThis as any).Bun = undefined; // Simulate Node environment

    const pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();

    expect(querier).toBeDefined();
    expect(mocks.betterDatabasePragma).toHaveBeenCalledWith('journal_mode = WAL');
  });

  it('should reuse the same querier', async () => {
    (globalThis as any).Bun = undefined;
    const pool = new Sqlite3QuerierPool(':memory:');
    const querier1 = await pool.getQuerier();
    const querier2 = await pool.getQuerier();
    expect(querier1).toBe(querier2);
  });

  it('should close the database on end', async () => {
    (globalThis as any).Bun = undefined;
    const pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();
    await pool.end();
    expect(mocks.betterDatabaseClose).toHaveBeenCalled();
  });
});
