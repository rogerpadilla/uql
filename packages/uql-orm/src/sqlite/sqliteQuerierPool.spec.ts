import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

// Mock the dependencies
vi.mock('./sqliteQuerier.js', () => ({
  SqliteQuerier: vi.fn().mockImplementation(function (this: any, db: any, extra: any) {
    this.db = db;
    this.extra = extra;
  }),
}));

/** A statement both drivers can answer with: no rows, so `bun:sqlite`'s adapter derives `reader: false`. */
const statement = { reader: false, columnNames: [], all: vi.fn(() => []), run: vi.fn(), iterate: vi.fn() };

const mocks = {
  bunDatabasePrepare: vi.fn(() => statement),
  bunDatabaseClose: vi.fn(),
  bunLoadExtension: vi.fn(),
  betterDatabasePrepare: vi.fn(() => statement),
  betterDatabaseClose: vi.fn(),
  betterLoadExtension: vi.fn(),
};

const bunDatabaseCtor = vi.fn().mockImplementation(function (this: any) {
  this.prepare = mocks.bunDatabasePrepare;
  this.close = mocks.bunDatabaseClose;
  this.loadExtension = mocks.bunLoadExtension;
});

const betterDatabaseCtor = vi.fn().mockImplementation(function (this: any) {
  this.prepare = mocks.betterDatabasePrepare;
  this.close = mocks.betterDatabaseClose;
  this.loadExtension = mocks.betterLoadExtension;
});

vi.mock('bun:sqlite', () => ({ Database: bunDatabaseCtor }));

vi.mock('better-sqlite3', () => ({ default: betterDatabaseCtor }));

describe('Sqlite3QuerierPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should use bun:sqlite when Bun is defined', async () => {
    vi.stubGlobal('Bun', {}); // Simulate Bun environment

    const pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();

    expect(querier).toBeDefined();
    expect(mocks.bunDatabasePrepare).toHaveBeenCalledWith('PRAGMA journal_mode = WAL');
    expect(mocks.bunDatabasePrepare).toHaveBeenCalledWith('PRAGMA foreign_keys = ON');
  });

  it('should use better-sqlite3 when Bun is undefined', async () => {
    vi.stubGlobal('Bun', undefined); // Simulate Node environment

    const pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();

    expect(querier).toBeDefined();
    expect(mocks.betterDatabasePrepare).toHaveBeenCalledWith('PRAGMA journal_mode = WAL');
    expect(mocks.betterDatabasePrepare).toHaveBeenCalledWith('PRAGMA foreign_keys = ON');
  });

  it('should share one database but hand out a distinct querier per acquisition', async () => {
    vi.stubGlobal('Bun', undefined);
    const pool = new Sqlite3QuerierPool(':memory:');
    const querier1 = await pool.getQuerier();
    const querier2 = await pool.getQuerier();
    // Distinct queriers keep transaction state per unit of work; the db handle stays shared.
    expect(querier1).not.toBe(querier2);
    expect(querier1.db).toBe(querier2.db);
  });

  it('should open one database when acquisitions race', async () => {
    vi.stubGlobal('Bun', undefined);
    const pool = new Sqlite3QuerierPool(':memory:');
    // The open is awaited, so callers arriving during the first one used to each start one of their own.
    // The extras are unreachable and never closed, and `:memory:` makes each of them a database of its own.
    const [querier1, querier2] = await Promise.all([pool.getQuerier(), pool.getQuerier()]);
    expect(betterDatabaseCtor).toHaveBeenCalledTimes(1);
    expect(querier1.db).toBe(querier2.db);
  });

  it('should load the requested extensions on better-sqlite3, without passing them to the driver', async () => {
    vi.stubGlobal('Bun', undefined);
    const pool = new Sqlite3QuerierPool(':memory:', { extensions: ['/vec0.dylib'], readonly: false });
    await pool.getQuerier();
    expect(mocks.betterLoadExtension).toHaveBeenCalledWith('/vec0.dylib');
    // `bun:sqlite` rejects option keys it does not know, so `extensions` must be stripped.
    expect(betterDatabaseCtor).toHaveBeenCalledWith(':memory:', { readonly: false });
  });

  it('should load the requested extensions on bun:sqlite, without passing them to the driver', async () => {
    vi.stubGlobal('Bun', {});
    const pool = new Sqlite3QuerierPool(':memory:', { extensions: ['/vec0.dylib'] });
    await pool.getQuerier();
    expect(mocks.bunLoadExtension).toHaveBeenCalledWith('/vec0.dylib');
    // `bun:sqlite` rejects an options object with no open flags, so nothing is left to pass.
    expect(bunDatabaseCtor).toHaveBeenCalledWith(':memory:', undefined);
  });

  it('should close the database on end', async () => {
    vi.stubGlobal('Bun', undefined);
    const pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();
    await pool.end();
    expect(mocks.betterDatabaseClose).toHaveBeenCalled();
  });
});
