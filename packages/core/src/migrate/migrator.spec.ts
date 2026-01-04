import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { Entity, Id } from '../entity/index.js';
import { User } from '../test/entityMock.js';
import type {
  Migration,
  MigrationStorage,
  QuerierPool,
  SchemaGenerator,
  SchemaIntrospector,
  SqlQuerier,
} from '../type/index.js';
import { MongoSchemaGenerator } from './generator/mongoSchemaGenerator.js';
import { MysqlSchemaGenerator } from './generator/mysqlSchemaGenerator.js';
import { PostgresSchemaGenerator } from './generator/postgresSchemaGenerator.js';
import { SqliteSchemaGenerator } from './generator/sqliteSchemaGenerator.js';
import { MongoSchemaIntrospector } from './introspection/mongoIntrospector.js';
import { MysqlSchemaIntrospector } from './introspection/mysqlIntrospector.js';
import { PostgresSchemaIntrospector } from './introspection/postgresIntrospector.js';
import { SqliteSchemaIntrospector } from './introspection/sqliteIntrospector.js';
import { Migrator } from './migrator.js';

vi.mock('node:url', () => ({
  pathToFileURL: vi.fn().mockReturnValue({ href: '' }),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe('Migrator Core Methods', () => {
  let migrator: Migrator;
  let storage: MigrationStorage;
  let pool: QuerierPool;
  let querier: SqlQuerier;
  let mockExecuted: Mock<any>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    querier = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({}),
      dialect: {
        escapeIdChar: '"',
      },
    } as unknown as SqlQuerier;

    pool = {
      getQuerier: vi.fn().mockResolvedValue(querier),
      dialect: 'postgres',
    } as unknown as QuerierPool;

    mockExecuted = vi.fn().mockResolvedValue([]);
    storage = {
      executed: mockExecuted,
      logWithQuerier: vi.fn().mockResolvedValue(undefined),
      unlogWithQuerier: vi.fn().mockResolvedValue(undefined),
      ensureStorage: vi.fn().mockResolvedValue(undefined),
    } as unknown as MigrationStorage;

    migrator = new Migrator(pool, { storage });

    // Mock getMigrations to return some dummy migrations
    const mockMigrations: Migration[] = [
      {
        name: '20250101000000_m1',
        up: vi.fn().mockResolvedValue(undefined) as unknown as (querier: SqlQuerier) => Promise<void>,
        down: vi.fn().mockResolvedValue(undefined) as unknown as (querier: SqlQuerier) => Promise<void>,
      },
      {
        name: '20250102000000_m2',
        up: vi.fn().mockResolvedValue(undefined) as unknown as (querier: SqlQuerier) => Promise<void>,
        down: vi.fn().mockResolvedValue(undefined) as unknown as (querier: SqlQuerier) => Promise<void>,
      },
      {
        name: '20250103000000_m3',
        up: vi.fn().mockResolvedValue(undefined) as unknown as (querier: SqlQuerier) => Promise<void>,
        down: vi.fn().mockResolvedValue(undefined) as unknown as (querier: SqlQuerier) => Promise<void>,
      },
    ];
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue(mockMigrations);
  });

  it('pending should return non-executed migrations', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1']);

    const pending = await migrator.pending();

    expect(pending).toHaveLength(2);
    expect(pending[0].name).toBe('20250102000000_m2');
    expect(pending[1].name).toBe('20250103000000_m3');
  });

  it('up should run all pending migrations', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1']);

    const results = await migrator.up();

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('20250102000000_m2');
    expect(results[1].name).toBe('20250103000000_m3');

    const migrations = await migrator.getMigrations();
    expect(migrations[1].up).toHaveBeenCalled();
    expect(migrations[2].up).toHaveBeenCalled();
    expect(storage.logWithQuerier).toHaveBeenCalledTimes(2);
  });

  it('up to a specific migration', async () => {
    mockExecuted.mockResolvedValue([]);

    const results = await migrator.up({ to: '20250102000000_m2' });

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('20250101000000_m1');
    expect(results[1].name).toBe('20250102000000_m2');
  });

  it('down should rollback the last migration', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1', '20250102000000_m2']);

    const results = await migrator.down({ step: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('20250102000000_m2');

    const migrations = await migrator.getMigrations();
    expect(migrations[1].down).toHaveBeenCalled();
    expect(storage.unlogWithQuerier).toHaveBeenCalledTimes(1);
  });

  it('down to a specific migration', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1', '20250102000000_m2', '20250103000000_m3']);

    // From current state to m1 (inclusive), so roll back m3 and m2
    const results = await migrator.down({ to: '20250102000000_m2' });

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('20250103000000_m3');
    expect(results[1].name).toBe('20250102000000_m2');
  });

  it('generateFromEntities should create a migration file', async () => {
    @Entity()
    class DummyEntity {
      @Id() id?: number;
    }

    migrator = new Migrator(pool, { entities: [DummyEntity] });
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue([]);

    const generator = {
      resolveTableName: vi.fn().mockReturnValue('DiffUser'),
      diffSchema: vi.fn().mockReturnValue({
        tableName: 'DiffUser',
        type: 'alter',
        columnsToAdd: [{ name: 'age', type: 'INTEGER' }],
      }),
      generateAlterTable: vi.fn().mockReturnValue(['ALTER TABLE "DiffUser" ADD COLUMN "age" INTEGER;']),
      generateAlterTableDown: vi.fn().mockReturnValue(['ALTER TABLE "DiffUser" DROP COLUMN "age";']),
    };
    migrator.setSchemaGenerator(generator as unknown as SchemaGenerator);

    const introspector = {
      getTableSchema: vi.fn().mockResolvedValue({ name: 'DiffUser', columns: [] }),
      getTableNames: vi.fn().mockResolvedValue([]),
      tableExists: vi.fn().mockResolvedValue(true),
    };
    migrator.schemaIntrospector = introspector as unknown as SchemaIntrospector;

    const { mkdir, writeFile } = await import('node:fs/promises');

    const filePath = await migrator.generateFromEntities('add_age');

    expect(filePath).not.toBe('');
    expect(filePath).toContain('add_age.ts');
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('ALTER TABLE "DiffUser" ADD COLUMN "age" INTEGER;'),
      'utf-8',
    );
  });

  it('status should return pending and executed migrations', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1']);

    const status = await migrator.status();

    expect(status.pending).toEqual(['20250102000000_m2', '20250103000000_m3']);
    expect(status.executed).toEqual(['20250101000000_m1']);
  });

  it('sync should call autoSync by default', async () => {
    const autoSyncSpy = vi.spyOn(migrator, 'autoSync').mockResolvedValue(undefined);
    await migrator.sync();
    expect(autoSyncSpy).toHaveBeenCalledWith({ safe: true });
  });

  it('syncForce should drop and create tables', async () => {
    @Entity()
    class SyncEntity {
      @Id() id?: number;
    }
    migrator = new Migrator(pool, { entities: [SyncEntity] });

    const generator = {
      resolveTableName: vi.fn().mockReturnValue('SyncEntity'),
      generateDropTable: vi.fn().mockReturnValue('DROP TABLE "SyncEntity"'),
      generateCreateTable: vi.fn().mockReturnValue('CREATE TABLE "SyncEntity"'),
      generateAlterTable: vi.fn(),
      generateAlterTableDown: vi.fn(),
      diffSchema: vi.fn(),
    };
    migrator.setSchemaGenerator(generator as unknown as SchemaGenerator);

    await migrator.syncForce();

    expect(querier.run).toHaveBeenCalledWith('DROP TABLE "SyncEntity"');
    expect(querier.run).toHaveBeenCalledWith('CREATE TABLE "SyncEntity"');
    expect(querier.commitTransaction).toHaveBeenCalled();
  });

  describe('Dialect Auto-Inference', () => {
    it('should infer Postgres generator and introspector', () => {
      const m = new Migrator(pool);
      expect(m.schemaGenerator).toBeInstanceOf(PostgresSchemaGenerator);
      expect(m.schemaIntrospector).toBeInstanceOf(PostgresSchemaIntrospector);
    });

    it('should infer MySQL generator and introspector', () => {
      const mysqlPool = { ...pool, dialect: 'mysql' } as QuerierPool;
      const m = new Migrator(mysqlPool);
      expect(m.schemaGenerator).toBeInstanceOf(MysqlSchemaGenerator);
      expect(m.schemaIntrospector).toBeInstanceOf(MysqlSchemaIntrospector);
    });

    it('should infer SQLite generator and introspector', () => {
      const sqlitePool = { ...pool, dialect: 'sqlite' } as QuerierPool;
      const m = new Migrator(sqlitePool);
      expect(m.schemaGenerator).toBeInstanceOf(SqliteSchemaGenerator);
      expect(m.schemaIntrospector).toBeInstanceOf(SqliteSchemaIntrospector);
    });

    it('should infer MongoDB generator and introspector', () => {
      const mongoPool = { ...pool, dialect: 'mongodb' } as QuerierPool;
      const m = new Migrator(mongoPool);
      expect(m.schemaGenerator).toBeInstanceOf(MongoSchemaGenerator);
      expect(m.schemaIntrospector).toBeInstanceOf(MongoSchemaIntrospector);
    });

    it('should allow overriding dialect in options', () => {
      const m = new Migrator(pool, { dialect: 'mysql' });
      expect(m.schemaGenerator).toBeInstanceOf(MysqlSchemaGenerator);
    });

    it('should allow overriding generator in options', () => {
      const customGenerator = {} as unknown as SchemaGenerator;
      const m = new Migrator(pool, { dialect: 'postgres', schemaGenerator: customGenerator });
      expect(m.schemaGenerator).toBe(customGenerator);
    });
  });

  it('generate should create a new migration file content', async () => {
    const filePath = await migrator.generate('initial_schema');
    expect(filePath).toContain('initial_schema.ts');
    const { writeFile } = await import('node:fs/promises');
    expect(writeFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('export default {'), 'utf-8');
  });

  it('getDialect should return the dialect', () => {
    expect(migrator.getDialect()).toBe('postgres');
  });

  it('status should return pending and executed migrations', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1']);
    const status = await migrator.status();
    expect(status.pending).toEqual(['20250102000000_m2', '20250103000000_m3']);
    expect(status.executed).toEqual(['20250101000000_m1']);
  });

  it('up should stop on first failure', async () => {
    const migrations = await migrator.getMigrations();
    (migrations[1] as any).up = vi.fn().mockRejectedValue(new Error('Migration failed'));

    const results = await migrator.up();

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results).not.toContainEqual(expect.objectContaining({ name: '20250103000000_m3' }));
  });

  it('down should stop on first failure', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1', '20250102000000_m2']);
    const migrations = await migrator.getMigrations();
    (migrations[1] as any).down = vi.fn().mockRejectedValue(new Error('Rollback failed'));

    const results = await migrator.down();

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
  });

  describe('Schema Sync', () => {
    @Entity()
    class MigratorUser {
      @Id()
      id: number;
    }

    it('syncForce should drop and create tables', async () => {
      const migratorSync = new Migrator(pool, { entities: [MigratorUser] });
      await migratorSync.sync({ force: true });
      expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('DROP TABLE'));
      expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
    });

    it('sync should call autoSync', async () => {
      const migratorSync = new Migrator(pool, { entities: [MigratorUser] });
      const autoSyncSpy = vi.spyOn(migratorSync, 'autoSync').mockResolvedValue(undefined);
      await migratorSync.sync();
      expect(autoSyncSpy).toHaveBeenCalledWith({ safe: true });
    });

    it('autoSync should execute statements from diffs', async () => {
      const generator = new PostgresSchemaGenerator();
      const introspector = { getTableSchema: vi.fn().mockResolvedValue(undefined) };
      const migratorSync = new Migrator(pool, {
        entities: [MigratorUser],
        schemaGenerator: generator,
      });
      migratorSync.schemaIntrospector = introspector as unknown as SchemaIntrospector;

      await migratorSync.autoSync({ logging: true });
      expect(querier.run).toHaveBeenCalledWith(expect.stringMatching(/CREATE TABLE "MigratorUser"/i));
    });

    it('should default to all entities if none provided', async () => {
      const generator = new PostgresSchemaGenerator();
      const introspector = { getTableSchema: vi.fn().mockResolvedValue(undefined) };
      const migratorDefault = new Migrator(pool, {
        schemaGenerator: generator,
      });
      migratorDefault.schemaIntrospector = introspector as unknown as SchemaIntrospector;

      // MigratorUser is decorated with @Entity, so it should be included by default
      expect(migratorDefault.entities).toContain(MigratorUser);

      await migratorDefault.autoSync();
      expect(querier.run).toHaveBeenCalledWith(expect.stringMatching(/CREATE TABLE "MigratorUser"/i));
    });

    it('should respect explicit empty entities array', () => {
      const migratorEmpty = new Migrator(pool, { entities: [] });
      expect(migratorEmpty.entities).toEqual([]);
    });
  });

  describe('Internal file methods', () => {
    it('getMigrationFiles should return sorted list of files', async () => {
      const { readdir } = await import('node:fs/promises');
      (readdir as Mock).mockResolvedValue(['b.ts', 'a.ts', 'c.txt', 'd.d.ts']);

      const files = await migrator.getMigrationFiles();
      expect(files).toEqual(['a.ts', 'b.ts']);
    });

    it('getMigrationFiles should return empty array on ENOENT', async () => {
      const { readdir } = await import('node:fs/promises');
      (readdir as Mock).mockRejectedValue({ code: 'ENOENT' });

      const files = await migrator.getMigrationFiles();
      expect(files).toEqual([]);
    });

    it('getMigrationName should strip extension', () => {
      expect(migrator.getMigrationName('20250101_init.ts')).toBe('20250101_init');
    });

    it('isMigration should validate objects', () => {
      expect(migrator.isMigration({ up: () => {}, down: () => {} })).toBe(true);
      expect(migrator.isMigration({ up: () => {} })).toBe(false);
      expect(migrator.isMigration(null)).toBe(false);
    });
  });

  describe('Extended coverage', () => {
    it('up with specific step', async () => {
      const results = await migrator.up({ step: 1 });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('20250101000000_m1');
    });

    it('up with missing to migration should throw', async () => {
      await expect(migrator.up({ to: 'nonexistent' })).rejects.toThrow("Migration 'nonexistent' not found");
    });

    it('down with missing to migration should throw', async () => {
      await expect(migrator.down({ to: 'nonexistent' })).rejects.toThrow("Migration 'nonexistent' not found");
    });

    it('runMigration should throw if not SQL-based querier', async () => {
      const nonSqlQuerier = { release: vi.fn() } as any;
      (pool.getQuerier as Mock).mockResolvedValueOnce(nonSqlQuerier);
      await expect(migrator.runMigration({ name: 'm1' } as any, 'up')).rejects.toThrow(
        'Migrator requires a SQL-based querier',
      );
      expect(nonSqlQuerier.release).toHaveBeenCalled();
    });

    it('generateFromEntities should return empty if no diffs', async () => {
      const generator = {
        resolveTableName: vi.fn().mockReturnValue('Table'),
        diffSchema: vi.fn().mockReturnValue(undefined),
      };
      migrator.setSchemaGenerator(generator as unknown as SchemaGenerator);
      const introspector = { getTableSchema: vi.fn().mockResolvedValue({}) };
      migrator.schemaIntrospector = introspector as unknown as SchemaIntrospector;

      const filePath = await migrator.generateFromEntities('test');
      expect(filePath).toBe('');
    });

    it('getDiffs should throw if generator/introspector missing', async () => {
      migrator.schemaGenerator = undefined;
      await expect(migrator.getDiffs()).rejects.toThrow('Schema generator and introspector must be set');
    });

    it('syncForce should throw if not SQL-based querier', async () => {
      const nonSqlQuerier = { release: vi.fn() } as any;
      (pool.getQuerier as Mock).mockResolvedValueOnce(nonSqlQuerier);
      await expect(migrator.syncForce()).rejects.toThrow('Migrator requires a SQL-based querier');
      expect(nonSqlQuerier.release).toHaveBeenCalled();
    });

    it('executeSyncStatements should throw on error and rollback for SQL', async () => {
      (querier.run as Mock).mockRejectedValueOnce(new Error('Exec error'));
      await expect(migrator.executeSyncStatements(['SQL'], { logging: true })).rejects.toThrow('Exec error');
      expect(querier.rollbackTransaction).toHaveBeenCalled();
    });

    it('loadMigration should handle various formats and invalid migrations', async () => {
      const { pathToFileURL } = await import('node:url');
      const { writeFile, mkdir, rm } = await vi.importActual<any>('node:fs/promises');
      const { join } = await vi.importActual<any>('node:path');

      const testDir = join(process.cwd(), 'temp-test-migrations');
      await mkdir(testDir, { recursive: true });

      try {
        // Default export
        const m1Path = join(testDir, 'm1.mjs');
        await writeFile(m1Path, 'export default { up: () => {}, down: () => {} };');
        vi.mocked(pathToFileURL).mockReturnValueOnce({ href: m1Path } as any);
        const m1 = await migrator.loadMigration('m1.mjs');
        expect(m1).toBeDefined();

        // Module export
        const m2Path = join(testDir, 'm2.mjs');
        await writeFile(m2Path, 'export const up = () => {}; export const down = () => {};');
        vi.mocked(pathToFileURL).mockReturnValueOnce({ href: m2Path } as any);
        const m2 = await migrator.loadMigration('m2.mjs');
        expect(m2).toBeDefined();

        // Invalid migration
        const m3Path = join(testDir, 'm3.mjs');
        await writeFile(m3Path, 'export const up = () => {};');
        vi.mocked(pathToFileURL).mockReturnValueOnce({ href: m3Path } as any);
        const m3 = await migrator.loadMigration('m3.mjs');
        expect(m3).toBeUndefined();

        // Import error
        vi.mocked(pathToFileURL).mockReturnValueOnce({ href: 'nonexistent-file.mjs' } as any);
        const m4 = await migrator.loadMigration('m4.mjs');
        expect(m4).toBeUndefined();
      } finally {
        // Cleanup
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('autoSync should respect safe and drop options in filterDiff', async () => {
      const diff: any = {
        type: 'alter',
        tableName: 'User',
        columnsToDrop: ['old_col'],
        indexesToDrop: ['old_idx'],
      };
      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([diff]);
      vi.spyOn(migrator.schemaGenerator, 'generateAlterTable').mockReturnValue([]);

      // Safe mode (default)
      await migrator.autoSync();
      expect(migrator.schemaGenerator.generateAlterTable).toHaveBeenCalledWith(
        expect.not.objectContaining({ columnsToDrop: expect.anything() }),
      );

      // Unsafe mode with drop
      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([diff]);
      await migrator.autoSync({ safe: false, drop: true });
      expect(migrator.schemaGenerator.generateAlterTable).toHaveBeenCalledWith(
        expect.objectContaining({ columnsToDrop: ['old_col'] }),
      );
    });

    it('autoSync should log and return if no statements', async () => {
      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([]);
      const spy = vi.spyOn(migrator.logger, 'logSchema');
      await migrator.autoSync({ logging: true });
      expect(spy).toHaveBeenCalledWith('Schema is already in sync.');
    });

    it('sync should call syncForce if force is true', async () => {
      vi.spyOn(migrator, 'syncForce').mockResolvedValueOnce();
      await migrator.sync({ force: true });
      expect(migrator.syncForce).toHaveBeenCalled();
    });

    it('executeMongoSyncStatements should handle various MongoDB commands', async () => {
      const mockCollection = {
        createIndex: vi.fn(),
        drop: vi.fn(),
        dropIndex: vi.fn(),
      };
      const mockDb = {
        collection: vi.fn().mockReturnValue(mockCollection),
        createCollection: vi.fn(),
      };
      const mockQuerier = { db: mockDb } as any;

      const stmts = [
        JSON.stringify({ action: 'createCollection', name: 'User', indexes: [{ columns: ['id'], name: 'id_idx' }] }),
        JSON.stringify({ action: 'dropCollection', name: 'Old' }),
        JSON.stringify({ action: 'createIndex', collection: 'User', key: { name: 1 }, options: { unique: true } }),
        JSON.stringify({ action: 'dropIndex', collection: 'User', name: 'old_idx' }),
      ];

      await migrator.executeMongoSyncStatements(stmts, { logging: true }, mockQuerier);

      expect(mockDb.createCollection).toHaveBeenCalledWith('User');
      expect(mockCollection.createIndex).toHaveBeenCalled();
      expect(mockCollection.drop).toHaveBeenCalled();
      expect(mockCollection.dropIndex).toHaveBeenCalledWith('old_idx');
    });

    it('executeMongoSyncStatements should throw if collection name is missing', async () => {
      const mockQuerier = { db: {} } as any;
      const stmts = [JSON.stringify({ action: 'createIndex' })];
      await expect(migrator.executeMongoSyncStatements(stmts, {}, mockQuerier)).rejects.toThrow(
        'MongoDB command missing collection name',
      );
    });

    it('createIntrospector and createGenerator should return undefined for unknown dialect', () => {
      const m = new Migrator(pool, { dialect: 'unknown' as any });
      expect(m.schemaGenerator).toBeUndefined();
      expect(m.schemaIntrospector).toBeUndefined();
    });

    it('syncForce should rollback on error', async () => {
      vi.spyOn(querier, 'run').mockRejectedValueOnce(new Error('Sync error'));
      await expect(migrator.syncForce()).rejects.toThrow('Sync error');
      expect(querier.rollbackTransaction).toHaveBeenCalled();
    });

    it('syncForce should throw if schemaGenerator is missing', async () => {
      const m = new Migrator(pool, { dialect: 'unknown' as any });
      await expect(m.syncForce()).rejects.toThrow('Schema generator not set');
    });

    it('findEntityForTable should return undefined if not found', async () => {
      const m = new Migrator(pool, { entities: [] });
      expect(m.findEntityForTable('Unknown')).toBeUndefined();
    });

    it('getMigrations should load and sort migrations', async () => {
      const m = new Migrator(pool, { storage });
      vi.spyOn(m, 'getMigrationFiles').mockResolvedValue(['m2.ts', 'm1.ts']);
      const m1 = { name: 'm1', up: vi.fn(), down: vi.fn() } as any;
      const m2 = { name: 'm2', up: vi.fn(), down: vi.fn() } as any;
      vi.spyOn(m, 'loadMigration').mockResolvedValueOnce(m2).mockResolvedValueOnce(m1);

      const migrations = await m.getMigrations();
      expect(migrations).toHaveLength(2);
      expect(migrations[0].name).toBe('m1');
      expect(migrations[1].name).toBe('m2');
    });

    it('generateFromEntities should return empty if no statements', async () => {
      const m = new Migrator(pool, { storage });
      vi.spyOn(m, 'getDiffs').mockResolvedValueOnce([]);
      const spy = vi.spyOn(m.logger, 'logInfo');
      const result = await m.generateFromEntities('test');
      expect(result).toBe('');
      expect(spy).toHaveBeenCalledWith('No schema changes detected.');
    });

    it('generateFromEntities should handle create and alter diffs', async () => {
      const m = new Migrator(pool, { storage });
      const diffs: any[] = [
        { type: 'create', tableName: 'User' },
        { type: 'alter', tableName: 'Profile' },
      ];
      vi.spyOn(m, 'getDiffs').mockResolvedValueOnce(diffs);
      vi.spyOn(m, 'findEntityForTable').mockReturnValue(User);
      vi.spyOn(m.schemaGenerator, 'generateCreateTable').mockReturnValue('CREATE');
      vi.spyOn(m.schemaGenerator, 'generateDropTable').mockReturnValue('DROP');
      vi.spyOn(m.schemaGenerator, 'generateAlterTable').mockReturnValue(['ALTER UP']);
      vi.spyOn(m.schemaGenerator, 'generateAlterTableDown').mockReturnValue(['ALTER DOWN']);

      const result = await m.generateFromEntities('test-full');
      expect(result).toContain('test_full');
    });

    it('generateFromEntities and autoSync should skip table if entity not found', async () => {
      const m = new Migrator(pool, { storage });
      vi.spyOn(m, 'getDiffs').mockResolvedValueOnce([{ type: 'create', tableName: 'Unknown' }]);
      vi.spyOn(m, 'findEntityForTable').mockReturnValue(undefined);

      const result = await m.generateFromEntities('test-skip');
      expect(result).toBe('');

      vi.spyOn(m, 'getDiffs').mockResolvedValueOnce([{ type: 'create', tableName: 'Unknown' }]);
      const spy = vi.spyOn(m.logger, 'logSchema');
      await m.autoSync({ logging: true });
      expect(spy).toHaveBeenCalledWith('Schema is already in sync.');
    });

    it('executeMongoSyncStatements should handle createCollection without indexes and non-matching action', async () => {
      const mockCollection = { drop: vi.fn() };
      const mockDb = { collection: vi.fn().mockReturnValue(mockCollection), createCollection: vi.fn() };
      const mockQuerier = { db: mockDb } as any;

      const stmts = [
        JSON.stringify({ action: 'createCollection', name: 'User' }),
        JSON.stringify({ action: 'unknown', name: 'User' }),
      ];

      await migrator.executeMongoSyncStatements(stmts, {}, mockQuerier);
      expect(mockDb.createCollection).toHaveBeenCalledWith('User');
    });

    it('executeSqlSyncStatements should run statements in transaction', async () => {
      const mockQuerier = {
        beginTransaction: vi.fn(),
        all: vi.fn(),
        run: vi.fn(),
        commitTransaction: vi.fn(),
        dialect: { escapeIdChar: '"' },
      } as any;

      await migrator.executeSqlSyncStatements(['STMT1', 'STMT2'], { logging: true }, mockQuerier);

      expect(mockQuerier.beginTransaction).toHaveBeenCalled();
      expect(mockQuerier.run).toHaveBeenCalledTimes(2);
      expect(mockQuerier.commitTransaction).toHaveBeenCalled();
    });

    it('executeSqlSyncStatements should throw if not SQL querier', async () => {
      const mockQuerier = {} as any;
      await expect(migrator.executeSqlSyncStatements([], {}, mockQuerier)).rejects.toThrow(
        'Migrator requires a SQL-based querier',
      );
    });
  });
});
