import { describe, expect, it, jest } from 'bun:test';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { DatabaseMigrationStorage } from './databaseStorage.js';

describe('DatabaseMigrationStorage', () => {
  let storage: DatabaseMigrationStorage;
  let pool: QuerierPool;
  let querier: SqlQuerier;
  let mockAll: ReturnType<typeof jest.fn>;
  let mockRun: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    mockAll = jest.fn<any>().mockResolvedValue([]);
    mockRun = jest.fn<any>().mockResolvedValue({});
    querier = {
      all: mockAll,
      run: mockRun,
      release: jest.fn<any>().mockResolvedValue(undefined),
      dialect: {
        escapeId: (id: string) => `"${id}"`,
        placeholder: (index: number) => `$${index}`,
        escapeIdChar: '"',
      },
    } as any;

    pool = {
      getQuerier: jest.fn<any>().mockResolvedValue(querier) as any,
    } as any;

    storage = new DatabaseMigrationStorage(pool);
  });

  it('ensureStorage should create table', async () => {
    await storage.ensureStorage();

    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS "uql_migrations"'));
    expect(querier.release).toHaveBeenCalled();
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
