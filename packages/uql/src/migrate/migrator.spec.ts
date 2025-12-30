import { beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import { Entity, Id } from '../entity/index.js';
import type { Migration, MigrationStorage, QuerierPool, SqlQuerier } from '../type/index.js';
import { MongoSchemaGenerator } from './generator/mongoSchemaGenerator.js';
import { MysqlSchemaGenerator } from './generator/mysqlSchemaGenerator.js';
import { PostgresSchemaGenerator } from './generator/postgresSchemaGenerator.js';
import { SqliteSchemaGenerator } from './generator/sqliteSchemaGenerator.js';
import { MongoSchemaIntrospector } from './introspection/mongoIntrospector.js';
import { MysqlSchemaIntrospector } from './introspection/mysqlIntrospector.js';
import { PostgresSchemaIntrospector } from './introspection/postgresIntrospector.js';
import { SqliteSchemaIntrospector } from './introspection/sqliteIntrospector.js';
import { Migrator } from './migrator.js';

mock.module('node:fs/promises', () => ({
  readdir: jest.fn<any>().mockResolvedValue([]) as any,
  mkdir: jest.fn<any>().mockResolvedValue(undefined) as any,
  writeFile: jest.fn<any>().mockResolvedValue(undefined) as any,
}));

describe('Migrator Core Methods', () => {
  let migrator: Migrator;
  let storage: MigrationStorage;
  let pool: QuerierPool;
  let querier: SqlQuerier;
  let mockExecuted: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    querier = {
      beginTransaction: jest.fn<any>().mockResolvedValue(undefined),
      commitTransaction: jest.fn<any>().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn<any>().mockResolvedValue(undefined),
      release: jest.fn<any>().mockResolvedValue(undefined),
      all: jest.fn<any>().mockResolvedValue([]),
      run: jest.fn<any>().mockResolvedValue({}),
      dialect: {
        escapeIdChar: '"',
      },
    } as any;

    pool = {
      getQuerier: jest.fn<any>().mockResolvedValue(querier),
      dialect: 'postgres',
    } as any;

    mockExecuted = jest.fn<any>().mockResolvedValue([]);
    storage = {
      executed: mockExecuted,
      logWithQuerier: jest.fn<any>().mockResolvedValue(undefined),
      unlogWithQuerier: jest.fn<any>().mockResolvedValue(undefined),
      ensureStorage: jest.fn<any>().mockResolvedValue(undefined),
    } as any;

    migrator = new Migrator(pool, { storage });

    // Mock getMigrations to return some dummy migrations
    const mockMigrations: Migration[] = [
      {
        name: '20250101000000_m1',
        up: jest.fn<any>().mockResolvedValue(undefined),
        down: jest.fn<any>().mockResolvedValue(undefined),
      },
      {
        name: '20250102000000_m2',
        up: jest.fn<any>().mockResolvedValue(undefined),
        down: jest.fn<any>().mockResolvedValue(undefined),
      },
      {
        name: '20250103000000_m3',
        up: jest.fn<any>().mockResolvedValue(undefined),
        down: jest.fn<any>().mockResolvedValue(undefined),
      },
    ];
    jest.spyOn(migrator, 'getMigrations').mockResolvedValue(mockMigrations);
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
    jest.spyOn(migrator, 'getMigrations').mockResolvedValue([]);

    const generator = {
      resolveTableName: jest.fn<any>().mockReturnValue('DiffUser'),
      diffSchema: jest.fn<any>().mockReturnValue({
        tableName: 'DiffUser',
        type: 'alter',
        columnsToAdd: [{ name: 'age', type: 'INTEGER' }],
      }),
      generateAlterTable: jest.fn<any>().mockReturnValue(['ALTER TABLE "DiffUser" ADD COLUMN "age" INTEGER;']),
      generateAlterTableDown: jest.fn<any>().mockReturnValue(['ALTER TABLE "DiffUser" DROP COLUMN "age";']),
    };
    migrator.setSchemaGenerator(generator as any);

    const introspector = {
      getTableSchema: jest.fn<any>().mockResolvedValue({ name: 'DiffUser', columns: [] }),
      getTableNames: jest.fn<any>().mockResolvedValue([]),
      tableExists: jest.fn<any>().mockResolvedValue(true),
    };
    migrator.schemaIntrospector = introspector as any;

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
    const autoSyncSpy = jest.spyOn(migrator, 'autoSync').mockResolvedValue(undefined);
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
      resolveTableName: jest.fn<any>().mockReturnValue('SyncEntity'),
      generateDropTable: jest.fn<any>().mockReturnValue('DROP TABLE "SyncEntity"'),
      generateCreateTable: jest.fn<any>().mockReturnValue('CREATE TABLE "SyncEntity"'),
      generateAlterTable: jest.fn<any>(),
      generateAlterTableDown: jest.fn<any>(),
      diffSchema: jest.fn<any>(),
    };
    migrator.setSchemaGenerator(generator as any);

    await migrator.syncForce();

    expect(querier.run).toHaveBeenCalledWith('DROP TABLE "SyncEntity"');
    expect(querier.run).toHaveBeenCalledWith('CREATE TABLE "SyncEntity"');
    expect(querier.commitTransaction).toHaveBeenCalled();
  });

  describe('Dialect Auto-Inference', () => {
    it('should infer Postgres generator and introspector', () => {
      const m = new Migrator(pool);
      expect((m as any).schemaGenerator).toBeInstanceOf(PostgresSchemaGenerator);
      expect((m as any).schemaIntrospector).toBeInstanceOf(PostgresSchemaIntrospector);
    });

    it('should infer MySQL generator and introspector', () => {
      const mysqlPool = { ...pool, dialect: 'mysql' };
      const m = new Migrator(mysqlPool as any);
      expect((m as any).schemaGenerator).toBeInstanceOf(MysqlSchemaGenerator);
      expect((m as any).schemaIntrospector).toBeInstanceOf(MysqlSchemaIntrospector);
    });

    it('should infer SQLite generator and introspector', () => {
      const sqlitePool = { ...pool, dialect: 'sqlite' };
      const m = new Migrator(sqlitePool as any);
      expect((m as any).schemaGenerator).toBeInstanceOf(SqliteSchemaGenerator);
      expect((m as any).schemaIntrospector).toBeInstanceOf(SqliteSchemaIntrospector);
    });

    it('should infer MongoDB generator and introspector', () => {
      const mongoPool = { ...pool, dialect: 'mongodb' };
      const m = new Migrator(mongoPool as any);
      expect((m as any).schemaGenerator).toBeInstanceOf(MongoSchemaGenerator);
      expect((m as any).schemaIntrospector).toBeInstanceOf(MongoSchemaIntrospector);
    });

    it('should allow overriding dialect in options', () => {
      const m = new Migrator(pool, { dialect: 'mysql' });
      expect((m as any).schemaGenerator).toBeInstanceOf(MysqlSchemaGenerator);
    });

    it('should allow overriding generator in options', () => {
      const customGenerator = {} as any;
      const m = new Migrator(pool, { dialect: 'postgres', schemaGenerator: customGenerator });
      expect((m as any).schemaGenerator).toBe(customGenerator);
    });
  });
});
