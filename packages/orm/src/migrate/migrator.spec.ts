import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { Entity, Field, Id } from '../entity/index.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MongoDialect } from '../mongo/mongoDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import type { IndexFacet } from '../schema/indexDifferences.js';
import { createTableNode, SchemaAST } from '../schema/schemaAST.js';
import type { CanonicalType, ColumnNode } from '../schema/types.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { assertDefined, createMockQuerier, createMockQuerierPool } from '../test/index.js';
import type {
  ForeignKeySchema,
  Migration,
  MigrationStorage,
  MigratorDialect,
  Querier,
  QuerierPool,
  SchemaDiff,
  SchemaIntrospector,
} from '../type/index.js';
import { MongoSchemaGenerator } from './generator/mongoSchemaGenerator.js';
import { MongoSchemaIntrospector } from './introspection/mongoIntrospector.js';
import { MariadbSchemaIntrospector, MysqlSchemaIntrospector } from './introspection/mysqlIntrospector.js';
import { PostgresSchemaIntrospector } from './introspection/postgresIntrospector.js';
import { SqliteSchemaIntrospector } from './introspection/sqliteIntrospector.js';
import { defineMigration, Migrator } from './migrator.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

vi.mock('node:url', () => ({
  pathToFileURL: vi.fn().mockReturnValue({ href: '' }),
}));

/** The directory and file calls a migrator makes, typed by the one overload it uses. */
const fs = vi.hoisted(() => ({
  readdir: vi.fn(async (_path: string): Promise<string[]> => []),
  mkdir: vi.fn(async (_path: string, _options: object): Promise<void> => {}),
  writeFile: vi.fn(async (_path: string, _data: string, _encoding: string): Promise<void> => {}),
  rm: vi.fn(async (): Promise<void> => {}),
}));

vi.mock('node:fs/promises', () => fs);

/** What the last migration file written holds. */
function lastWrittenFile(): string {
  const call = fs.writeFile.mock.lastCall;
  assertDefined(call);
  return call[1];
}

const createSqlQuerier = (dialect: AbstractSqlDialect = new PostgresDialect()) =>
  createMockQuerier({
    all: vi.fn().mockResolvedValue([]),
    run: vi.fn().mockResolvedValue({}),
    dialect,
  });

describe('Migrator Core Methods', () => {
  let migrator: Migrator;
  let storage: MigrationStorage;
  let getQuerier: Mock<() => Promise<Querier>>;
  let pool: QuerierPool<Querier, MigratorDialect>;
  let querier: ReturnType<typeof createSqlQuerier>;
  let mockExecuted: Mock<MigrationStorage['executed']>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const postgresDialect = new PostgresDialect();
    querier = createSqlQuerier();
    getQuerier = vi.fn(async (): Promise<Querier> => querier);
    pool = createMockQuerierPool(postgresDialect, getQuerier);

    mockExecuted = vi.fn().mockResolvedValue([]);
    storage = {
      executed: mockExecuted,
      logWithQuerier: vi.fn().mockResolvedValue(undefined),
      unlogWithQuerier: vi.fn().mockResolvedValue(undefined),
      ensureStorage: vi.fn().mockResolvedValue(undefined),
    };

    migrator = new Migrator(pool, { storage, schemaGenerator: new SqlSchemaGenerator(postgresDialect) });

    const mockMigrations: Migration[] = ['20250101000000_m1', '20250102000000_m2', '20250103000000_m3'].map((name) => ({
      name,
      up: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
    }));
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue(mockMigrations);
  });

  it('should list the migrations not yet executed', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1']);

    const pending = await migrator.pending();

    expect(pending).toHaveLength(2);
    expect(pending[0].name).toBe('20250102000000_m2');
    expect(pending[1].name).toBe('20250103000000_m3');
  });

  it('should run every pending migration on up', async () => {
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

  it('should run up to a named migration', async () => {
    mockExecuted.mockResolvedValue([]);

    const results = await migrator.up({ to: '20250102000000_m2' });

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('20250101000000_m1');
    expect(results[1].name).toBe('20250102000000_m2');
  });

  it('should roll back the last migration on down', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1', '20250102000000_m2']);

    const results = await migrator.down({ step: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('20250102000000_m2');

    const migrations = await migrator.getMigrations();
    expect(migrations[1].down).toHaveBeenCalled();
    expect(storage.unlogWithQuerier).toHaveBeenCalledTimes(1);
  });

  it('should roll back down to a named migration', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1', '20250102000000_m2', '20250103000000_m3']);

    // From current state to m1 (inclusive), so roll back m3 and m2
    const results = await migrator.down({ to: '20250102000000_m2' });

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('20250103000000_m3');
    expect(results[1].name).toBe('20250102000000_m2');
  });

  it('should write a migration file from the entities', async () => {
    @Entity()
    class DummyEntity {
      @Id({ type: Number }) id?: number;
    }

    migrator = new Migrator(pool, { entities: [DummyEntity] });
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue([]);

    const generator = new SqlSchemaGenerator(new PostgresDialect());
    vi.spyOn(generator, 'diffSchema').mockReturnValue({ tableName: 'DiffUser', type: 'alter' });
    vi.spyOn(generator, 'generateAlterTable').mockReturnValue(['ALTER TABLE "DiffUser" ADD COLUMN "age" INTEGER;']);
    vi.spyOn(generator, 'generateAlterTableDown').mockReturnValue(['ALTER TABLE "DiffUser" DROP COLUMN "age";']);
    migrator.schemaGenerator = generator;
    vi.spyOn(migrator.schemaIntrospector, 'introspect').mockResolvedValue(new SchemaAST());
    vi.spyOn(migrator.schemaIntrospector, 'tableExists').mockResolvedValue(true);

    const filePath = await migrator.generateFromEntities('add_age');

    expect(filePath).not.toBe('');
    expect(filePath).toContain('add_age.ts');
    expect(fs.mkdir).toHaveBeenCalled();
    expect(lastWrittenFile()).toContain(
      'await querier.run("ALTER TABLE \\"DiffUser\\" ADD COLUMN \\"age\\" INTEGER;");',
    );
  });

  it('should write valid JS for SQL with backticks (SQLite/LibSQL identifiers)', async () => {
    @Entity()
    class Article {
      @Id({ type: Number }) id?: number;
    }

    migrator = new Migrator(pool, { entities: [Article] });
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue([]);

    const createSql = 'CREATE TABLE `Article` (\n  `id` INTEGER PRIMARY KEY\n);';
    const indexSql = 'CREATE INDEX `Article_id_idx` ON `Article` (`id`);';
    const dropSql = 'DROP TABLE IF EXISTS `Article`;';
    const generator = new SqlSchemaGenerator(new SqliteDialect());
    vi.spyOn(generator, 'generateCreateSchema').mockReturnValue([createSql, indexSql]);
    vi.spyOn(generator, 'generateDropSchema').mockReturnValue([dropSql]);
    vi.spyOn(generator, 'generateDropTable').mockReturnValue(dropSql);
    migrator.schemaGenerator = generator;
    vi.spyOn(migrator, 'getDiffs').mockResolvedValue([{ type: 'create', tableName: 'Article' }]);

    await migrator.generateFromEntities('initial_schema');

    const written = lastWrittenFile();
    expect(written).toContain('await querier.run("CREATE TABLE `Article` (\\n  `id` INTEGER PRIMARY KEY\\n);");');
    expect(written).toContain('await querier.run("CREATE INDEX `Article_id_idx` ON `Article` (`id`);");');
    expect(written).toContain('await querier.run("DROP TABLE IF EXISTS `Article`;");');
  });

  it('should report pending and executed migrations', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1']);

    const status = await migrator.status();

    expect(status.pending).toEqual(['20250102000000_m2', '20250103000000_m3']);
    expect(status.executed).toEqual(['20250101000000_m1']);
  });

  it('should apply only what is additive unless told otherwise', async () => {
    const planned = vi.spyOn(migrator, 'planSync').mockResolvedValue([]);
    await migrator.sync();
    expect(planned).toHaveBeenCalledWith({});
  });

  it('should drop the schema in dependency order and create it on a forced sync', async () => {
    @Entity()
    class SyncEntity {
      @Id({ type: Number }) id?: number;
    }
    migrator = new Migrator(pool, { entities: [SyncEntity] });

    const generator = new SqlSchemaGenerator(new PostgresDialect());
    vi.spyOn(generator, 'generateDropSchema').mockReturnValue(['DROP TABLE "SyncEntity"']);
    vi.spyOn(generator, 'generateCreateSchema').mockReturnValue(['CREATE TABLE "SyncEntity"']);
    migrator.schemaGenerator = generator;

    await migrator.sync({ force: true, logging: true });

    expect(querier.run).toHaveBeenCalledWith('DROP TABLE "SyncEntity"');
    expect(querier.run).toHaveBeenCalledWith('CREATE TABLE "SyncEntity"');
    expect(querier.commitTransaction).toHaveBeenCalled();
    // Dependency order, not declaration order: dropping a referenced table first is rejected once the
    // foreign keys are really emitted, so the drop must span the graph like the create does.
    expect(generator.generateDropSchema).toHaveBeenCalledWith([SyncEntity], { ifExists: true, cascade: true });
  });

  describe('Dialect Auto-Inference', () => {
    it('should infer Postgres generator and introspector', async () => {
      const m = new Migrator(pool);
      expect(await m.getSchemaGenerator()).toBeInstanceOf(SqlSchemaGenerator);
      expect(m.schemaIntrospector).toBeInstanceOf(PostgresSchemaIntrospector);
    });

    it('should infer MySQL generator and introspector', async () => {
      const m = new Migrator({ ...pool, dialect: new MySqlDialect() });
      expect(await m.getSchemaGenerator()).toBeInstanceOf(SqlSchemaGenerator);
      expect(m.schemaIntrospector).toBeInstanceOf(MysqlSchemaIntrospector);
    });

    it('should infer MariaDB generator and introspector', async () => {
      const m = new Migrator({ ...pool, dialect: new MariaDialect() });
      expect(await m.getSchemaGenerator()).toBeInstanceOf(SqlSchemaGenerator);
      expect(m.schemaIntrospector).toBeInstanceOf(MariadbSchemaIntrospector);
    });

    it('should infer SQLite generator and introspector', async () => {
      const m = new Migrator({ ...pool, dialect: new SqliteDialect() });
      expect(await m.getSchemaGenerator()).toBeInstanceOf(SqlSchemaGenerator);
      expect(m.schemaIntrospector).toBeInstanceOf(SqliteSchemaIntrospector);
    });

    it('should load the MongoDB schema generator only once it is used', async () => {
      const m = new Migrator({ ...pool, dialect: new MongoDialect() });
      expect(m.schemaGenerator).toBeUndefined();
      expect(await m.getSchemaGenerator()).toBeInstanceOf(MongoSchemaGenerator);
      expect(m.schemaIntrospector).toBeInstanceOf(MongoSchemaIntrospector);
    });

    it('should allow overriding generator in options', async () => {
      const customGenerator = new SqlSchemaGenerator(new PostgresDialect());
      const m = new Migrator(pool, { schemaGenerator: customGenerator });
      expect(await m.getSchemaGenerator()).toBe(customGenerator);
    });
  });

  it('should write the content of a new migration file', async () => {
    const filePath = await migrator.generate('initial_schema');
    expect(filePath).toContain('initial_schema.ts');
    expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('export default {'), 'utf-8');
  });

  it('should stop up at the first failure', async () => {
    const migrations = await migrator.getMigrations();
    migrations[1].up = vi.fn().mockRejectedValue(new Error('Migration failed'));

    const results = await migrator.up();

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results).not.toContainEqual(expect.objectContaining({ name: '20250103000000_m3' }));
  });

  it('should stop down at the first failure', async () => {
    mockExecuted.mockResolvedValue(['20250101000000_m1', '20250102000000_m2']);
    const migrations = await migrator.getMigrations();
    migrations[1].down = vi.fn().mockRejectedValue(new Error('Rollback failed'));

    const results = await migrator.down();

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
  });

  describe('Schema Sync', () => {
    @Entity()
    class MigratorUser {
      @Id({ type: Number })
      id!: number;
    }

    it('should emit DROP and CREATE from the real generator on a forced sync', async () => {
      const migratorSync = new Migrator(pool, { entities: [MigratorUser] });
      await migratorSync.sync({ force: true });
      expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('DROP TABLE'));
      expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
    });

    it('should run on sync what it planned', async () => {
      const migratorSync = new Migrator(pool, { entities: [MigratorUser] });
      const planned = vi.spyOn(migratorSync, 'planSync').mockResolvedValue(['CREATE TABLE "planned" ()']);
      await migratorSync.sync();

      expect(planned).toHaveBeenCalled();
      expect(querier.run).toHaveBeenCalledWith('CREATE TABLE "planned" ()');
    });

    it('should run the statements of a diff on sync', async () => {
      const generator = new SqlSchemaGenerator(new PostgresDialect());
      const migratorSync = new Migrator(pool, {
        entities: [MigratorUser],
        schemaGenerator: generator,
      });
      vi.spyOn(migratorSync.schemaIntrospector, 'introspect').mockResolvedValue(new SchemaAST());

      await migratorSync.sync({ logging: true });
      expect(querier.run).toHaveBeenCalledWith(expect.stringMatching(/CREATE TABLE "MigratorUser"/i));
    });

    it('should default to all entities if none provided', async () => {
      const generator = new SqlSchemaGenerator(new PostgresDialect());
      const migratorDefault = new Migrator(pool, {
        schemaGenerator: generator,
      });
      vi.spyOn(migratorDefault.schemaIntrospector, 'introspect').mockResolvedValue(new SchemaAST());
      expect(migratorDefault.entities).toContain(MigratorUser);

      await migratorDefault.sync();
      expect(querier.run).toHaveBeenCalledWith(expect.stringMatching(/CREATE TABLE "MigratorUser"/i));
    });

    it('should respect explicit empty entities array', () => {
      const migratorEmpty = new Migrator(pool, { entities: [] });
      expect(migratorEmpty.entities).toEqual([]);
    });
  });

  describe('Internal file methods', () => {
    it('should list migration files sorted', async () => {
      fs.readdir.mockResolvedValueOnce(['b.ts', 'a.ts', 'c.txt', 'd.d.ts']);

      const files = await migrator.getMigrationFiles();
      expect(files).toEqual(['a.ts', 'b.ts']);
    });

    it('should list no migration files where the directory is missing', async () => {
      fs.readdir.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));

      const files = await migrator.getMigrationFiles();
      expect(files).toEqual([]);
    });

    it('should strip the extension from a migration name', () => {
      expect(migrator.getMigrationName('20250101_init.ts')).toBe('20250101_init');
    });

    it('should tell a migration from other objects', () => {
      expect(migrator.isMigration({ up: () => {}, down: () => {} })).toBe(true);
      expect(migrator.isMigration({ up: () => {} })).toBe(false);
      expect(migrator.isMigration({})).toBe(false);
      expect(migrator.isMigration(null)).toBe(false);
    });
  });

  describe('runs and plans', () => {
    it("should run as many migrations as up's step says", async () => {
      const results = await migrator.up({ step: 1 });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('20250101000000_m1');
    });

    it('should refuse a forced sync on a querier that is not SQL', async () => {
      const nonSqlQuerier = createMockQuerier();
      getQuerier.mockResolvedValueOnce(nonSqlQuerier);
      await expect(migrator.sync({ force: true, logging: true })).rejects.toThrow(
        'Migrator requires a SQL-based querier',
      );
      expect(nonSqlQuerier.release).toHaveBeenCalled();
    });

    it('should roll back and throw where a sync statement fails', async () => {
      querier.run.mockRejectedValueOnce(new Error('Exec error'));
      await expect(migrator.executeSyncStatements(['SQL'], { logging: true })).rejects.toThrow('Exec error');
      expect(querier.rollbackTransaction).toHaveBeenCalled();
    });

    it('should read a default or a module export, and nothing that is not a migration', async () => {
      const { pathToFileURL: toFileUrl } = await vi.importActual<typeof import('node:url')>('node:url');
      const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const dir = await realFs.mkdtemp(join(tmpdir(), 'uql-migrations-'));
      const load = (file: string) => {
        vi.mocked(pathToFileURL).mockReturnValueOnce(toFileUrl(join(dir, file)));
        return migrator.loadMigration(file);
      };

      try {
        await realFs.writeFile(join(dir, 'm1.mjs'), 'export default { up: () => {}, down: () => {} };');
        await realFs.writeFile(join(dir, 'm2.mjs'), 'export const up = () => {}; export const down = () => {};');
        await realFs.writeFile(join(dir, 'm3.mjs'), 'export const up = () => {};');

        expect(await load('m1.mjs')).toBeDefined();
        expect(await load('m2.mjs')).toBeDefined();
        expect(await load('m3.mjs')).toBeUndefined();
        expect(await load('missing.mjs')).toBeUndefined();
      } finally {
        await realFs.rm(dir, { recursive: true, force: true });
      }
    });

    it("should respect sync's safe and drop options", async () => {
      const diff: SchemaDiff = {
        type: 'alter',
        tableName: 'User',
        columnsToDrop: ['old_col'],
        indexesToDrop: ['old_idx'],
      };
      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([diff]);
      vi.spyOn(await migrator.getSchemaGenerator(), 'generateAlterTable').mockReturnValue([]);

      // Safe mode (default)
      await migrator.sync();
      expect(migrator.schemaGenerator?.generateAlterTable).toHaveBeenCalledWith(
        expect.not.objectContaining({ columnsToDrop: expect.anything() }),
      );

      // Unsafe mode with drop
      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([diff]);
      await migrator.sync({ safe: false, drop: true });
      expect(migrator.schemaGenerator?.generateAlterTable).toHaveBeenCalledWith(
        expect.objectContaining({ columnsToDrop: ['old_col'] }),
      );
    });

    /**
     * Adding a constraint is additive; dropping one, and altering one - which is a drop and an add -
     * are not. Letting the add through while safe mode held the drop back would emit `ADD CONSTRAINT`
     * for a constraint the table still has, which every engine rejects.
     */
    it('should neither drop nor alter a foreign key in safe mode', async () => {
      const companyFk: ForeignKeySchema = {
        name: 'User__companyId_fk',
        columns: ['companyId'],
        references: { table: 'Company', columns: ['id'] },
        onDelete: 'CASCADE',
      };
      const diff: SchemaDiff = {
        type: 'alter',
        tableName: 'User',
        foreignKeysToAdd: [companyFk],
        foreignKeysToDrop: ['User_legacy_fk'],
        foreignKeysToAlter: [{ from: { ...companyFk, onDelete: 'NO ACTION' }, to: companyFk }],
      };
      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([diff]);
      vi.spyOn(await migrator.getSchemaGenerator(), 'generateAlterTable').mockReturnValue([]);

      await migrator.sync();
      expect(migrator.schemaGenerator?.generateAlterTable).toHaveBeenCalledWith(
        expect.objectContaining({ foreignKeysToAdd: [companyFk] }),
      );
      expect(migrator.schemaGenerator?.generateAlterTable).toHaveBeenCalledWith(
        expect.not.objectContaining({ foreignKeysToDrop: expect.anything() }),
      );
      expect(migrator.schemaGenerator?.generateAlterTable).toHaveBeenCalledWith(
        expect.not.objectContaining({ foreignKeysToAlter: expect.anything() }),
      );

      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([diff]);
      await migrator.sync({ safe: false });
      expect(migrator.schemaGenerator?.generateAlterTable).toHaveBeenCalledWith(
        expect.objectContaining({ foreignKeysToDrop: ['User_legacy_fk'] }),
      );
    });

    /**
     * Rewriting a key drops a constraint and rebuilds an index over the whole table, and fails
     * outright where the new columns are null on rows that already exist - so safe mode, which
     * exists to keep a sync additive, has to hold it back like any other alteration.
     */
    it('should not change a primary key in safe mode', async () => {
      const diff: SchemaDiff = {
        type: 'alter',
        tableName: 'Member',
        primaryKey: { from: ['userId'], to: ['userId', 'groupId'], fromName: 'Member_pkey' },
      };
      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([diff]);
      vi.spyOn(await migrator.getSchemaGenerator(), 'generateAlterTable').mockReturnValue([]);

      await migrator.sync();
      expect(migrator.schemaGenerator?.generateAlterTable).toHaveBeenCalledWith(
        expect.not.objectContaining({ primaryKey: expect.anything() }),
      );

      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([diff]);
      await migrator.sync({ safe: false });
      expect(migrator.schemaGenerator?.generateAlterTable).toHaveBeenCalledWith(
        expect.objectContaining({ primaryKey: diff.primaryKey }),
      );
    });

    it('should log and return where sync has no statements', async () => {
      vi.spyOn(migrator, 'getDiffs').mockResolvedValueOnce([]);
      const spy = vi.spyOn(migrator.logger, 'logSchema');
      await migrator.sync({ logging: true });
      expect(spy).toHaveBeenCalledWith('Schema is already in sync.');
    });

    it('should drop every table before recreating it on a forced sync', async () => {
      const statements = await migrator.planSync({ force: true });

      expect(statements.some((sql) => sql.startsWith('DROP TABLE'))).toBe(true);
      expect(statements.some((sql) => sql.startsWith('CREATE TABLE'))).toBe(true);
    });

    it('should roll back a forced sync on error', async () => {
      vi.spyOn(querier, 'run').mockRejectedValueOnce(new Error('Sync error'));
      await expect(migrator.sync({ force: true, logging: true })).rejects.toThrow('Sync error');
      expect(querier.rollbackTransaction).toHaveBeenCalled();
    });

    /**
     * `beginTransaction` connects before it begins, so a refused connection lands in the catch with no
     * transaction open, where the rollback is a no-op rather than an error hiding the real cause.
     */
    it("should report why a forced sync's transaction never started, not that it is missing", async () => {
      querier.beginTransaction.mockRejectedValueOnce(new Error('password authentication failed'));

      await expect(migrator.sync({ force: true, logging: true })).rejects.toThrow('password authentication failed');
      expect(querier.release).toHaveBeenCalled();
    });

    /** A rollback that fails too is a consequence of the original error, and must not replace it. */
    it('should keep the original error of a forced sync when the rollback fails too', async () => {
      querier.run.mockRejectedValueOnce(new Error('Sync error'));
      querier.rollbackTransaction.mockRejectedValueOnce(new Error('connection is dead'));

      await expect(migrator.sync({ force: true, logging: true })).rejects.toThrow('Sync error');
      expect(querier.release).toHaveBeenCalled();
    });

    it('should load and sort migrations', async () => {
      const m = new Migrator(pool, { storage });
      vi.spyOn(m, 'getMigrationFiles').mockResolvedValue(['m2.ts', 'm1.ts']);
      const m1 = { name: 'm1', up: vi.fn(), down: vi.fn() };
      const m2 = { name: 'm2', up: vi.fn(), down: vi.fn() };
      vi.spyOn(m, 'loadMigration').mockResolvedValueOnce(m2).mockResolvedValueOnce(m1);

      const migrations = await m.getMigrations();
      expect(migrations).toHaveLength(2);
      expect(migrations[0].name).toBe('m1');
      expect(migrations[1].name).toBe('m2');
    });

    it('should write no migration where there are no statements', async () => {
      const m = new Migrator(pool, { storage });
      vi.spyOn(m, 'getDiffs').mockResolvedValueOnce([]);
      const spy = vi.spyOn(m.logger, 'logInfo');
      const result = await m.generateFromEntities('test');
      expect(result).toBe('');
      expect(spy).toHaveBeenCalledWith('No schema changes detected.');
    });

    it('should write the create and alter diffs of a migration', async () => {
      const generator = new SqlSchemaGenerator(new PostgresDialect());
      const m = new Migrator(pool, { storage, schemaGenerator: generator });
      const diffs: SchemaDiff[] = [
        { type: 'create', tableName: 'User' },
        { type: 'alter', tableName: 'Profile' },
      ];
      vi.spyOn(m, 'getDiffs').mockResolvedValueOnce(diffs);
      vi.spyOn(generator, 'generateCreateSchema').mockReturnValue(['CREATE']);
      vi.spyOn(generator, 'generateDropTable').mockReturnValue('DROP');
      vi.spyOn(generator, 'generateAlterTable').mockReturnValue(['ALTER UP']);
      vi.spyOn(generator, 'generateAlterTableDown').mockReturnValue(['ALTER DOWN']);

      const result = await m.generateFromEntities('test-full');
      expect(result).toContain('test_full');
    });

    it('should skip a table with no entity on generate and sync', async () => {
      const m = new Migrator(pool, { storage });
      vi.spyOn(m, 'getDiffs').mockResolvedValueOnce([{ type: 'create', tableName: 'Unknown' }]);

      const result = await m.generateFromEntities('test-skip');
      expect(result).toBe('');

      vi.spyOn(m, 'getDiffs').mockResolvedValueOnce([{ type: 'create', tableName: 'Unknown' }]);
      const spy = vi.spyOn(m.logger, 'logSchema');
      await m.sync({ logging: true });
      expect(spy).toHaveBeenCalledWith('Schema is already in sync.');
    });

    /** The transaction belongs to the method that acquired the querier, so it is asserted from there. */
    it('should run sync statements in one transaction, then release', async () => {
      await migrator.executeSyncStatements(['STMT1', 'STMT2'], { logging: true });

      expect(querier.beginTransaction).toHaveBeenCalledOnce();
      expect(querier.run).toHaveBeenCalledTimes(2);
      expect(querier.commitTransaction).toHaveBeenCalledOnce();
      expect(querier.release).toHaveBeenCalledOnce();
    });
  });
});

const BIG_INT: CanonicalType = { category: 'integer', size: 'big' };
const TEXT: CanonicalType = { category: 'string' };

/** An introspector reporting the given tables, each a column name to its canonical type; `id` is the key. */
function introspectorOf(tables: Record<string, Record<string, CanonicalType>>): SchemaIntrospector {
  const ast = new SchemaAST();

  for (const [tableName, columns] of Object.entries(tables)) {
    const table = createTableNode(tableName);
    for (const [columnName, type] of Object.entries(columns)) {
      const isPrimaryKey = columnName === 'id';
      const column: ColumnNode = {
        name: columnName,
        type,
        nullable: !isPrimaryKey,
        isPrimaryKey,
        isAutoIncrement: isPrimaryKey,
        isUnique: false,
        table,
        referencedBy: [],
      };
      table.columns.set(columnName, column);
      if (isPrimaryKey) {
        table.primaryKey.push(column);
      }
    }
    ast.addTable(table);
  }

  return {
    indexFacets: new Set<IndexFacet>(),
    introspect: vi.fn().mockResolvedValue(ast),
    getTableNames: vi.fn().mockResolvedValue(Object.keys(tables)),
    getTableSchema: vi.fn().mockResolvedValue(undefined),
    tableExists: vi.fn().mockImplementation((name: string) => Promise.resolve(name in tables)),
  };
}

@Entity()
class SyncUser {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
}

@Entity()
class SyncProfile {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) bio?: string;
  @Field({ references: () => SyncUser }) userId?: number;
}

describe('Migrator sync against an introspected schema', () => {
  let migrator: Migrator;
  let pool: QuerierPool<Querier, MigratorDialect>;
  let querier: ReturnType<typeof createSqlQuerier>;

  beforeEach(() => {
    const sqliteDialect = new SqliteDialect();
    querier = createSqlQuerier(sqliteDialect);
    pool = createMockQuerierPool(sqliteDialect, async (): Promise<Querier> => querier);

    migrator = new Migrator(pool, {
      entities: [SyncUser, SyncProfile],
    });
  });

  it('should generate create statements for new tables', async () => {
    migrator.schemaIntrospector = introspectorOf({});

    await migrator.sync({ logging: true });

    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE `SyncUser`'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE `SyncProfile`'));
  });

  it('should generate alter statements for missing columns', async () => {
    migrator.schemaIntrospector = introspectorOf({ SyncUser: { id: BIG_INT } });

    await migrator.sync({ logging: true });

    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE `SyncUser` ADD COLUMN `name` TEXT'));
  });

  it('should add the column an entity gained, and leave a table that has them all alone', async () => {
    const introspector = introspectorOf({
      SyncUser: { id: BIG_INT, name: TEXT },
      SyncProfile: { id: BIG_INT, bio: TEXT },
    });
    migrator.schemaIntrospector = introspector;

    await migrator.sync({ logging: true });

    expect(introspector.introspect).toHaveBeenCalled();
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE `SyncProfile` ADD COLUMN `userId`'));
    const allCalls = querier.run.mock.calls;
    const syncUserAlterCalls = allCalls.filter((call) => String(call[0]).includes('ALTER TABLE `SyncUser`'));
    expect(syncUserAlterCalls).toHaveLength(0);
  });

  it('should handle multiple new properties added to the same entity', async () => {
    @Entity()
    class MultiFieldUser {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) username?: string;
      @Field({ type: String }) email?: string;
      @Field({ type: Number }) age?: number;
      @Field({ type: Boolean }) isActive?: boolean;
    }

    const multiFieldMigrator = new Migrator(pool, {
      entities: [MultiFieldUser],
    });

    multiFieldMigrator.schemaIntrospector = introspectorOf({
      MultiFieldUser: { id: BIG_INT, username: TEXT },
    });

    await multiFieldMigrator.sync({ logging: true });

    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN `email`'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN `age`'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN `isActive`'));
  });
});

describe('Migrator refusals and empty plans', () => {
  let getQuerier: Mock<() => Promise<Querier>>;
  let pool: QuerierPool<Querier, MigratorDialect>;
  let mockStorage: MigrationStorage;
  let migrator: Migrator;

  beforeEach(() => {
    vi.clearAllMocks();
    const querier = createSqlQuerier();
    getQuerier = vi.fn(async (): Promise<Querier> => querier);
    pool = createMockQuerierPool(new PostgresDialect(), getQuerier);

    mockStorage = {
      executed: vi.fn().mockResolvedValue([]),
      logWithQuerier: vi.fn(),
      unlogWithQuerier: vi.fn(),
      ensureStorage: vi.fn(),
    };

    migrator = new Migrator(pool, { storage: mockStorage });
  });

  it('should return a migration definition as given', () => {
    const migration = { up: vi.fn(), down: vi.fn() };
    expect(defineMigration(migration)).toBe(migration);
  });

  it("should throw where up's target migration is not found", async () => {
    const migrator = new Migrator(pool, { storage: mockStorage });
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue([]);
    await expect(migrator.up({ to: 'missing' })).rejects.toThrow("Migration 'missing' not found");
  });

  it("should throw where down's target migration is not found", async () => {
    const migrator = new Migrator(pool, { storage: mockStorage });
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue([]);
    await expect(migrator.down({ to: 'missing' })).rejects.toThrow("Migration 'missing' not found");
  });

  it('should refuse to run a migration on a querier that is not SQL', async () => {
    const mongoQuerier = createMockQuerier();
    getQuerier.mockResolvedValue(mongoQuerier);
    const migrator = new Migrator(pool, { storage: mockStorage });
    const migration = { name: 'm1', up: vi.fn(), down: vi.fn() };
    await expect(migrator.runMigration(migration, 'up')).rejects.toThrow('Migrator requires a SQL-based querier');
    expect(mongoQuerier.release).toHaveBeenCalled();
  });

  it('should write no migration where nothing changed', async () => {
    const migrator = new Migrator(pool);
    vi.spyOn(migrator, 'getDiffs').mockResolvedValue([]);
    const res = await migrator.generateFromEntities('test');
    expect(res).toBe('');
  });

  it('should log and return where sync has no statements and logging is on', async () => {
    const logger = vi.fn();
    migrator.logger = logger;
    vi.spyOn(migrator, 'getDiffs').mockResolvedValue([]);
    await migrator.sync({ logging: true });
    expect(logger).toHaveBeenCalledWith('Schema is already in sync.');
  });

  it('should rethrow a directory error other than ENOENT', async () => {
    fs.readdir.mockRejectedValueOnce(new Error('Other error'));
    await expect(migrator.getMigrationFiles()).rejects.toThrow('Other error');
  });

  it('should leave out a file that is not a migration', async () => {
    fs.readdir.mockResolvedValueOnce(['1_notes.ts']);
    vi.spyOn(migrator, 'loadMigration').mockResolvedValue(undefined);
    expect(await migrator.getMigrations()).toEqual([]);
  });

  /** Only a create or an alter is something to apply; a table the entities do not name is left alone. */
  it('should pass over a table the entities drop, on plan and generate', async () => {
    vi.spyOn(migrator, 'getDiffs').mockResolvedValue([{ tableName: 'legacy', type: 'drop' }]);
    expect(await migrator.planSync()).toEqual([]);
    expect(await migrator.generateFromEntities('noop')).toBe('');
  });

  it('should read an invalid migration as none', async () => {
    const logger = vi.fn();
    migrator.logger = logger;
    vi.spyOn(migrator, 'getMigrationFiles').mockResolvedValue(['m1.ts']);
    const res = await migrator.loadMigration('m1.ts');
    expect(res).toBeUndefined();
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Error loading migration m1.ts'), expect.anything());
  });
});
