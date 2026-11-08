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

  /** Two runs starting on a fresh database both create it before the lock, and Postgres refuses the second's in its catalogue. */
  it('should ask once more after losing the race to create the table, finding it', async () => {
    querier.run.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "pg_type_typname_nsp_index"'),
    );

    await createMigrationsTable(querier, 'uql_migrations');

    expect(querier.run).toHaveBeenCalledTimes(2);
  });

  it('should fail as the second attempt to create the table fails', async () => {
    querier.run.mockRejectedValue(new Error('permission denied for schema public'));

    await expect(createMigrationsTable(querier, 'uql_migrations')).rejects.toThrow('permission denied');
    expect(querier.run).toHaveBeenCalledTimes(2);
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
