import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { Entity, Id } from '../entity/index.js';
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

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe('Migrator Core Methods', () => {
  let migrator: Migrator;
  let storage: MigrationStorage;
  let pool: QuerierPool;
  let querier: SqlQuerier;
  let mockExecuted: Mock<any>;

  beforeEach(() => {
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
});
