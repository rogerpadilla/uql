import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { createMockQuerier, sentStatements } from '../../test/index.js';
import { createMigrationsTable, DatabaseMigrationStorage } from './databaseStorage.js';

const dialect = new PostgresDialect();

const createSqlQuerier = () =>
  createMockQuerier({
    all: vi.fn().mockResolvedValue([]),
    run: vi.fn().mockResolvedValue({}),
    dialect,
  });

describe('DatabaseMigrationStorage', () => {
  let storage: DatabaseMigrationStorage;
  let querier: ReturnType<typeof createSqlQuerier>;

  beforeEach(() => {
    querier = createSqlQuerier();
    storage = new DatabaseMigrationStorage();
  });

  it('should create the table where it is missing, as the lock does before a run', async () => {
    await createMigrationsTable(querier, 'uql_migrations');

    expect(sentStatements(dialect, querier.run)).toEqual([
      { sql: expect.stringContaining('CREATE TABLE IF NOT EXISTS "uql_migrations"'), values: [] },
    ]);
  });

  it('should record on the table it is given, creating none', async () => {
    await storage.logWithQuerier(querier, 'm1');

    expect(sentStatements(dialect, querier.run)).toEqual([
      { sql: 'INSERT INTO "uql_migrations" ("name") VALUES ($1)', values: ['m1'] },
    ]);
  });

  it('should return executed migration names, leaving out the lock a run holds', async () => {
    querier.all.mockResolvedValueOnce([{ name: 'm1' }, { name: 'm2' }]);

    expect(await storage.executed(querier)).toEqual(['m1', 'm2']);
    expect(sentStatements(dialect, querier.all)).toEqual([
      { sql: 'SELECT "name" FROM "uql_migrations" WHERE "name" <> $1 ORDER BY "name" ASC', values: ['uql/lock'] },
    ]);
  });

  it('should record a migration in the table it is given', async () => {
    await new DatabaseMigrationStorage({ tableName: 'journal' }).logWithQuerier(querier, 'm3');

    expect(sentStatements(dialect, querier.run)).toEqual([
      { sql: 'INSERT INTO "journal" ("name") VALUES ($1)', values: ['m3'] },
    ]);
  });

  it('should delete the record of a migration', async () => {
    await storage.unlogWithQuerier(querier, 'm3');

    expect(sentStatements(dialect, querier.run)).toEqual([
      { sql: 'DELETE FROM "uql_migrations" WHERE "name" = $1', values: ['m3'] },
    ]);
  });
});
