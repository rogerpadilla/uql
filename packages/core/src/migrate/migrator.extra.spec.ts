import { readdir } from 'node:fs/promises';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { MigrationStorage, MongoQuerier, QuerierPool, SqlQuerier } from '../type/index.js';
import { defineMigration, Migrator } from './migrator.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

describe('Migrator (extra coverage)', () => {
  let pool: QuerierPool;
  let mockQuerier: SqlQuerier;
  let mockStorage: MigrationStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerier = {
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      run: vi.fn(),
      all: vi.fn(),
      dialect: {
        escapeId: (id: string) => `"${id}"`,
      },
    } as unknown as SqlQuerier;

    pool = {
      dialect: 'postgres',
      getQuerier: vi.fn().mockResolvedValue(mockQuerier),
    } as unknown as QuerierPool;

    mockStorage = {
      executed: vi.fn().mockResolvedValue([]),
      logWithQuerier: vi.fn(),
      unlogWithQuerier: vi.fn(),
      ensureStorage: vi.fn(),
    } as unknown as MigrationStorage;
  });

  it('defineMigration', () => {
    const migration = { up: () => {}, down: () => {} };
    expect(defineMigration(migration as any)).toBe(migration);
  });

  it('createIntrospector and createGenerator for mariadb', () => {
    const migrator = new Migrator(pool, { dialect: 'mariadb' });
    expect(migrator.getDialect()).toBe('mariadb');
    expect(migrator.schemaIntrospector).toBeDefined();
  });

  it('createIntrospector and createGenerator default case', () => {
    const migrator = new Migrator(pool, { dialect: 'invalid' as any });
    expect(migrator.schemaIntrospector).toBeUndefined();
  });

  it('up should throw if migration to is not found', async () => {
    const migrator = new Migrator(pool, { storage: mockStorage });
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue([]);
    await expect(migrator.up({ to: 'missing' })).rejects.toThrow("Migration 'missing' not found");
  });

  it('down should throw if migration to is not found', async () => {
    const migrator = new Migrator(pool, { storage: mockStorage });
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue([]);
    await expect(migrator.down({ to: 'missing' })).rejects.toThrow("Migration 'missing' not found");
  });

  it('runMigration should throw if not a SQL querier', async () => {
    const mongoQuerier = { release: vi.fn() } as unknown as MongoQuerier;
    (pool.getQuerier as Mock).mockResolvedValue(mongoQuerier);
    const migrator = new Migrator(pool, { storage: mockStorage });
    const migration = { name: 'm1', up: vi.fn(), down: vi.fn() };
    await expect((migrator as any).runMigration(migration, 'up')).rejects.toThrow(
      'Migrator requires a SQL-based querier',
    );
    expect(mongoQuerier.release).toHaveBeenCalled();
  });

  it('generateFromEntities should throw if no schema generator', async () => {
    const migrator = new Migrator(pool, { dialect: 'invalid' as any });
    await expect(migrator.generateFromEntities('test')).rejects.toThrow('Schema generator not set');
  });

  it('generateFromEntities should return empty if no changes', async () => {
    const migrator = new Migrator(pool);
    vi.spyOn(migrator, 'getDiffs').mockResolvedValue([]);
    const res = await migrator.generateFromEntities('test');
    expect(res).toBe('');
  });

  it('syncForce should throw if not a SQL querier', async () => {
    const mongoQuerier = { release: vi.fn() } as unknown as MongoQuerier;
    (pool.getQuerier as Mock).mockResolvedValue(mongoQuerier);
    const migrator = new Migrator(pool);
    await expect(migrator.syncForce()).rejects.toThrow('Migrator requires a SQL-based querier');
  });

  it('autoSync should throw if no generator/introspector', async () => {
    const migrator = new Migrator(pool, { dialect: 'invalid' as any });
    await expect(migrator.autoSync()).rejects.toThrow('Schema generator and introspector must be set');
  });

  it('autoSync should return if no statements and logging is enabled', async () => {
    const migrator = new Migrator(pool);
    const logger = vi.fn();
    (migrator as any).logger = logger;
    vi.spyOn(migrator, 'getDiffs').mockResolvedValue([]);
    await migrator.autoSync({ logging: true });
    expect(logger).toHaveBeenCalledWith('Schema is already in sync.');
  });

  it('executeMongoSyncStatements should throw if collection name is missing', async () => {
    const migrator = new Migrator(pool, { dialect: 'mongodb' });
    const mongoQuerier = { db: { collection: vi.fn() }, release: vi.fn() } as unknown as MongoQuerier;
    (pool.getQuerier as Mock).mockResolvedValue(mongoQuerier);
    await expect((migrator as any).executeSyncStatements(['{}'], {})).rejects.toThrow(
      'MongoDB command missing collection name',
    );
  });

  it('executeMongoSyncStatements should handle various actions', async () => {
    const migrator = new Migrator(pool, { dialect: 'mongodb' });
    const createCollection = vi.fn();
    const dropCollection = vi.fn();
    const createIndex = vi.fn();
    const dropIndex = vi.fn();
    const collection = { createIndex, drop: dropCollection, dropIndex };
    const db = { collection: () => collection, createCollection };
    const mongoQuerier = { db, release: vi.fn() } as unknown as MongoQuerier;
    (pool.getQuerier as Mock).mockResolvedValue(mongoQuerier);

    const stmts = [
      JSON.stringify({
        action: 'createCollection',
        name: 'users',
        indexes: [{ columns: ['id'], unique: true, name: 'idx1' }],
      }),
      JSON.stringify({ action: 'dropCollection', name: 'users' }),
      JSON.stringify({ action: 'createIndex', collection: 'users', key: { name: 1 }, options: { unique: true } }),
      JSON.stringify({ action: 'dropIndex', collection: 'users', name: 'idx2' }),
    ];

    await (migrator as any).executeSyncStatements(stmts, { logging: true });

    expect(createCollection).toHaveBeenCalled();
    expect(createIndex).toHaveBeenCalledTimes(2);
    expect(dropCollection).toHaveBeenCalled();
    expect(dropIndex).toHaveBeenCalledWith('idx2');
  });

  it('getMigrationFiles should throw error other than ENOENT', async () => {
    (readdir as Mock).mockRejectedValue(new Error('Other error'));
    const migrator = new Migrator(pool);
    await expect((migrator as any).getMigrationFiles()).rejects.toThrow('Other error');
  });

  it('loadMigration should return undefined on invalid migration', async () => {
    const migrator = new Migrator(pool, { storage: mockStorage });
    const logger = vi.fn();
    (migrator as any).logger = logger;
    vi.spyOn(migrator as any, 'getMigrationFiles').mockResolvedValue(['m1.ts']);
    const res = await (migrator as any).loadMigration('m1.ts');
    expect(res).toBeUndefined();
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Error loading migration m1.ts'));
  });

  it('isMigration utility', () => {
    const migrator = new Migrator(pool);
    expect((migrator as any).isMigration({})).toBe(false);
    expect((migrator as any).isMigration(null)).toBe(false);
    expect((migrator as any).isMigration({ up: () => {} })).toBe(false);
    expect((migrator as any).isMigration({ up: () => {}, down: () => {} })).toBe(true);
  });

  it('executeSqlSyncStatements should throw if not a SQL querier', async () => {
    const mongoQuerier = { release: vi.fn() } as unknown as MongoQuerier;
    const migrator = new Migrator(pool);
    await expect((migrator as any).executeSqlSyncStatements(['sql'], {}, mongoQuerier)).rejects.toThrow(
      'Migrator requires a SQL-based querier for this dialect',
    );
  });
});
