import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool } from '../../test/index.js';
import type { Querier, QuerierPool } from '../../type/index.js';
import { DatabaseMigrationStorage } from './databaseStorage.js';

const createSqlQuerier = () =>
  createMockQuerier({
    all: vi.fn().mockResolvedValue([]),
    run: vi.fn().mockResolvedValue({}),
    dialect: new PostgresDialect(),
  });

describe('DatabaseMigrationStorage', () => {
  let storage: DatabaseMigrationStorage;
  let pool: QuerierPool;
  let querier: ReturnType<typeof createSqlQuerier>;
  let getQuerier: Mock<() => Promise<Querier>>;

  beforeEach(() => {
    querier = createSqlQuerier();
    getQuerier = vi.fn(async (): Promise<Querier> => querier);
    pool = createMockQuerierPool(new PostgresDialect(), getQuerier);

    storage = new DatabaseMigrationStorage(pool);
  });

  it('should create the storage table', async () => {
    await storage.ensureStorage();

    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS "uql_migrations"'));
    expect(querier.release).toHaveBeenCalled();
  });

  it('should create the storage table once', async () => {
    await storage.ensureStorage();
    expect(pool.getQuerier).toHaveBeenCalledTimes(1);
    await storage.ensureStorage();
    expect(pool.getQuerier).toHaveBeenCalledTimes(1);
  });

  it('should refuse to create storage on a querier that is not SQL', async () => {
    getQuerier.mockResolvedValue(createMockQuerier());
    await expect(storage.ensureStorage()).rejects.toThrow('DatabaseMigrationStorage requires a SQL-based querier');
  });

  it('should return executed migration names', async () => {
    querier.all.mockResolvedValueOnce([{ name: 'm1' }, { name: 'm2' }]);

    const executed = await storage.executed();

    expect(executed).toEqual(['m1', 'm2']);
    expect(querier.all).toHaveBeenCalledWith(expect.stringContaining('SELECT "name" FROM "uql_migrations"'));
  });

  it('should refuse to read executed migrations on a querier that is not SQL', async () => {
    await storage.ensureStorage();

    getQuerier.mockResolvedValue(createMockQuerier());
    await expect(storage.executed()).rejects.toThrow('DatabaseMigrationStorage requires a SQL-based querier');
  });

  it('should insert a record of a migration', async () => {
    await storage.logWithQuerier(querier, 'm3');

    expect(querier.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "uql_migrations" ("name") VALUES ($1)'),
      ['m3'],
    );
  });

  it('should delete the record of a migration', async () => {
    await storage.unlogWithQuerier(querier, 'm3');

    expect(querier.run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "uql_migrations" WHERE "name" = $1'),
      ['m3'],
    );
  });
});
