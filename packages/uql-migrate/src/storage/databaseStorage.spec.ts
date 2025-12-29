import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { QuerierPool, SqlQuerier } from 'nukak/type';
import { DatabaseMigrationStorage } from './databaseStorage.js';

describe('DatabaseMigrationStorage', () => {
  let storage: DatabaseMigrationStorage;
  let pool: QuerierPool;
  let querier: jest.Mocked<SqlQuerier>;

  beforeEach(() => {
    querier = {
      all: jest.fn<any>().mockResolvedValue([]),
      run: jest.fn<any>().mockResolvedValue({}),
      release: jest.fn<any>().mockResolvedValue(undefined),
      dialect: {
        escapeId: (id: string) => `"${id}"`,
        placeholder: (index: number) => `$${index}`,
        escapeIdChar: '"',
      },
    } as any;

    pool = {
      getQuerier: jest.fn<any>().mockResolvedValue(querier),
    } as any;

    storage = new DatabaseMigrationStorage(pool);
  });

  it('ensureStorage should create table', async () => {
    await storage.ensureStorage();

    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS "nukak_migrations"'));
    expect(querier.release).toHaveBeenCalled();
  });

  it('executed should return migration names', async () => {
    // 1. ensureStorage
    querier.run.mockResolvedValueOnce({} as any);
    // 2. executed query
    querier.all.mockResolvedValueOnce([{ name: 'm1' }, { name: 'm2' }]);

    const executed = await storage.executed();

    expect(executed).toEqual(['m1', 'm2']);
    expect(querier.all).toHaveBeenCalledWith(expect.stringContaining('SELECT "name" FROM "nukak_migrations"'));
  });

  it('logWithQuerier should insert record', async () => {
    await storage.logWithQuerier(querier, 'm3');

    expect(querier.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "nukak_migrations" ("name") VALUES ($1)'),
      ['m3'],
    );
  });

  it('unlogWithQuerier should delete record', async () => {
    await storage.unlogWithQuerier(querier, 'm3');

    expect(querier.run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "nukak_migrations" WHERE "name" = $1'),
      ['m3'],
    );
  });
});
