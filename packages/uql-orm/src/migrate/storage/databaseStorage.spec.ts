import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { DatabaseMigrationStorage } from './databaseStorage.js';

describe('DatabaseMigrationStorage', () => {
  let storage: DatabaseMigrationStorage;
  let pool: QuerierPool;
  let querier: SqlQuerier;
  let mockAll: Mock<(sql: any, params?: any[]) => Promise<any[]>>;
  let mockRun: Mock<(sql: any, params?: any[]) => Promise<any>>;

  beforeEach(() => {
    mockAll = vi.fn().mockResolvedValue([]);
    mockRun = vi.fn().mockResolvedValue({});
    querier = {
      all: mockAll,
      run: mockRun,
      release: vi.fn().mockResolvedValue(undefined),
      dialect: {
        escapeId: (id: string) => `"${id}"`,
        placeholder: (index: number) => `$${index}`,
        escapeIdChar: '"',
      },
    } as unknown as SqlQuerier;

    pool = {
      getQuerier: vi.fn().mockResolvedValue(querier),
    } as unknown as QuerierPool;

    storage = new DatabaseMigrationStorage(pool);
  });

  it('ensureStorage should create table', async () => {
    await storage.ensureStorage();

    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS "uql_migrations"'));
    expect(querier.release).toHaveBeenCalled();
  });

  it('ensureStorage should return early if already initialized', async () => {
    await storage.ensureStorage();
    expect(pool.getQuerier).toHaveBeenCalledTimes(1);
    await storage.ensureStorage();
    expect(pool.getQuerier).toHaveBeenCalledTimes(1);
  });

  it('ensureStorage should throw if not SQL querier', async () => {
    (pool.getQuerier as Mock).mockResolvedValue({ release: vi.fn() });
    await expect(storage.ensureStorage()).rejects.toThrow('DatabaseMigrationStorage requires a SQL-based querier');
  });

  it('executed should return migration names', async () => {
    // 1. ensureStorage
    mockRun.mockResolvedValueOnce({} as any);
    // 2. executed query
    mockAll.mockResolvedValueOnce([{ name: 'm1' }, { name: 'm2' }]);

    const executed = await storage.executed();

    expect(executed).toEqual(['m1', 'm2']);
    expect(querier.all).toHaveBeenCalledWith(expect.stringContaining('SELECT "name" FROM "uql_migrations"'));
  });

  it('executed should throw if not SQL querier', async () => {
    // Force initialization first
    (pool.getQuerier as Mock).mockResolvedValueOnce(querier);
    await storage.ensureStorage();

    (pool.getQuerier as Mock).mockResolvedValue({ release: vi.fn() });
    await expect(storage.executed()).rejects.toThrow('DatabaseMigrationStorage requires a SQL-based querier');
  });

  it('logWithQuerier should insert record', async () => {
    await storage.logWithQuerier(querier, 'm3');

    expect(querier.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "uql_migrations" ("name") VALUES ($1)'),
      ['m3'],
    );
  });

  it('unlogWithQuerier should delete record', async () => {
    await storage.unlogWithQuerier(querier, 'm3');

    expect(querier.run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "uql_migrations" WHERE "name" = $1'),
      ['m3'],
    );
  });
});
