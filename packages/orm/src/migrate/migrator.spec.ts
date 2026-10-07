import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id, ManyToOne, OneToMany } from '../entity/index.js';
import { MongoDialect } from '../mongo/mongoDialect.js';
import { MongoSchemaGenerator } from '../mongo/mongoSchemaGenerator.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { NodeSqliteQuerierPool } from '../sqlite/nodeSqliteQuerierPool.js';
import { createMockQuerier, createMockQuerierPool } from '../test/index.js';
import type { Migration, MigratorOptions, Querier, SqlQuerier } from '../type/index.js';
import { runDriftCheck } from './cli.js';
import { migrationBuilderFor } from './migrationTarget.js';
import { defineMigration, Migrator } from './migrator.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity()
class MigNote {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
}

@Entity()
class MigAuthor {
  @Id({ type: Number }) id?: number;
  @OneToMany({ entity: () => MigBook, mappedBy: (book) => book.author }) books?: MigBook[];
}

@Entity()
class MigBook {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => MigAuthor }) authorId?: number | null;
  @ManyToOne({ entity: () => MigAuthor, references: (book) => book.authorId }) author?: MigAuthor;
}

/** A migrator on an in-memory SQLite database, its migrations in a directory of their own. */
describe('Migrator', () => {
  let dir: string;
  let pool: NodeSqliteQuerierPool;
  const logger = vi.fn();

  const migratorOf = (options: MigratorOptions = {}) =>
    new Migrator(pool, { migrationsPath: dir, logger, entities: [MigNote], ...options });

  const tables = async () =>
    (
      await pool.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
    ).map((row) => row.name);

  const columns = async (table: string) =>
    (await pool.all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)).map((row) => row.name);

  /** A migration file whose `up` runs each of `up` and whose `down` runs `down`, with what else it `declares`. */
  const writeMigration = (name: string, up: readonly string[], down: readonly string[] = [], declares = '') =>
    writeFile(
      join(dir, `${name}.mjs`),
      `export default {
        ${declares}
        async up(querier) { for (const sql of ${JSON.stringify(up)}) await querier.run(sql); },
        async down(querier) { for (const sql of ${JSON.stringify(down)}) await querier.run(sql); },
      };`,
    );

  /** Three migrations, each creating a table of its own name and dropping it on the way down. */
  const writeThree = async () => {
    for (const name of ['m1', 'm2', 'm3']) {
      await writeMigration(name, [`CREATE TABLE ${name} (id INTEGER)`], [`DROP TABLE ${name}`]);
    }
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uql-migrator-'));
    pool = new NodeSqliteQuerierPool(':memory:');
    logger.mockClear();
  });

  afterEach(async () => {
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  });

  describe('running migrations', () => {
    it('should run every pending migration up, in name order, and record each', async () => {
      await writeThree();
      const migrator = migratorOf();

      expect(await migrator.pending()).toEqual(['m1', 'm2', 'm3']);
      expect((await migrator.up()).map((it) => it.name)).toEqual(['m1', 'm2', 'm3']);
      expect(await tables()).toEqual(['m1', 'm2', 'm3', 'uql_migrations']);
      expect(await migrator.status()).toEqual({ pending: [], executed: ['m1', 'm2', 'm3'] });
    });

    it('should run up to a named migration, or as many as its step says', async () => {
      await writeThree();
      const migrator = migratorOf();

      expect((await migrator.up({ step: 1 })).map((it) => it.name)).toEqual(['m1']);
      expect((await migrator.up({ to: 'm2' })).map((it) => it.name)).toEqual(['m2']);
      expect(await migrator.status()).toEqual({ pending: ['m3'], executed: ['m1', 'm2'] });
    });

    it('should roll back the last migration, or down to a named one, latest first', async () => {
      await writeThree();
      const migrator = migratorOf();
      await migrator.up();

      expect((await migrator.down({ step: 1 })).map((it) => it.name)).toEqual(['m3']);
      expect((await migrator.down({ to: 'm1' })).map((it) => it.name)).toEqual(['m2', 'm1']);
      expect(await tables()).toEqual(['uql_migrations']);
    });

    it('should throw where the migration up or down is to run to is not there', async () => {
      const migrator = migratorOf();
      await expect(migrator.up({ to: 'missing' })).rejects.toThrow("Migration 'missing' not found");
      await expect(migrator.down({ to: 'missing' })).rejects.toThrow("Migration 'missing' not found");
    });

    it('should stop up at the first failure, leaving it and what follows pending', async () => {
      await writeMigration('m1', ['CREATE TABLE m1 (id INTEGER)']);
      await writeMigration('m2', ['NOT SQL']);
      await writeMigration('m3', ['CREATE TABLE m3 (id INTEGER)']);
      const migrator = migratorOf();

      expect((await migrator.up()).map(({ name, success }) => ({ name, success }))).toEqual([
        { name: 'm1', success: true },
        { name: 'm2', success: false },
      ]);
      expect(await migrator.status()).toEqual({ pending: ['m2', 'm3'], executed: ['m1'] });
    });

    it('should stop down at the first failure', async () => {
      await writeMigration('m1', ['CREATE TABLE m1 (id INTEGER)'], ['DROP TABLE m1']);
      await writeMigration('m2', ['CREATE TABLE m2 (id INTEGER)'], ['NOT SQL']);
      const migrator = migratorOf();
      await migrator.up();

      expect((await migrator.down({ step: 2 })).map(({ name, success }) => ({ name, success }))).toEqual([
        { name: 'm2', success: false },
      ]);
      expect(await migrator.executed()).toEqual(['m1', 'm2']);
    });

    it('should roll a failing migration back whole, its record included', async () => {
      await writeMigration('m1', ['CREATE TABLE m1 (id INTEGER)', 'NOT SQL']);

      expect(await migratorOf().up()).toMatchObject([{ name: 'm1', success: false }]);
      expect(await tables()).toEqual(['uql_migrations']);
    });

    /**
     * `CREATE INDEX CONCURRENTLY` is the statement a busy table needs and a transaction refuses, so a
     * migration file says so for itself. What it gives up is the rollback: a failure part-way leaves the
     * statements before it applied and the migration unlogged.
     */
    it('should run a migration file that opts out of its transaction outside one', async () => {
      await writeMigration('m1', ['CREATE TABLE m1 (id INTEGER)', 'NOT SQL'], [], 'transaction: false,');
      const migrator = migratorOf();

      expect(await migrator.up()).toMatchObject([{ name: 'm1', success: false }]);
      expect(await tables()).toEqual(['m1', 'uql_migrations']);
      expect(await migrator.executed()).toEqual([]);
    });
  });

  describe('migration files', () => {
    it('should list the migrations by file name, sorted, leaving out declarations and other files, importing none', async () => {
      for (const file of ['b.ts', 'a.ts', 'c.txt', 'd.d.ts', 'e.mjs', 'f.js']) {
        await writeFile(join(dir, file), 'export default {');
      }
      expect(await migratorOf().pending()).toEqual(['a', 'b', 'e', 'f']);
    });

    it('should list none where the directory is missing', async () => {
      expect(await migratorOf({ migrationsPath: join(dir, 'missing') }).pending()).toEqual([]);
    });

    it('should rethrow an error reading the directory other than its absence', async () => {
      const file = join(dir, 'file');
      await writeFile(file, '');
      await expect(migratorOf({ migrationsPath: file }).pending()).rejects.toThrow('ENOTDIR');
    });

    it('should refuse two files of one name', async () => {
      await writeFile(join(dir, 'm1.mjs'), '');
      await writeFile(join(dir, 'm1.ts'), '');
      await expect(migratorOf().pending()).rejects.toThrow("Migrations m1.mjs and m1.ts share the name 'm1'");
    });

    it('should run a default export or a module export', async () => {
      await writeFile(join(dir, 'm1.mjs'), 'export default { up: async () => {}, down: async () => {} };');
      await writeFile(join(dir, 'm2.mjs'), 'export const up = async () => {}; export const down = async () => {};');

      expect(await migratorOf().up()).toMatchObject([
        { name: 'm1', success: true },
        { name: 'm2', success: true },
      ]);
    });

    it('should run nothing where a migration to run fails to load', async () => {
      await writeMigration('m1', ['CREATE TABLE m1 (id INTEGER)']);
      await writeFile(join(dir, 'm2.mjs'), 'export default {');
      await writeMigration('m3', ['CREATE TABLE m3 (id INTEGER)']);
      const migrator = migratorOf();

      await expect(migrator.up()).rejects.toThrow('Migration m2.mjs failed to load');
      expect(await migrator.executed()).toEqual([]);
      expect(await tables()).toEqual(['uql_migrations']);
    });

    it('should run nothing where a migration to run exports none', async () => {
      await writeMigration('m1', ['CREATE TABLE m1 (id INTEGER)']);
      await writeFile(join(dir, 'm2.mjs'), 'export const up = async () => {};');
      const migrator = migratorOf();

      await expect(migrator.up()).rejects.toThrow('Migration m2.mjs exports no migration');
      expect(await migrator.executed()).toEqual([]);
    });

    it('should not load a migration already run', async () => {
      const migrator = migratorOf();
      await migrator.runMigration({ name: 'm1', up: async () => {}, down: async () => {} }, 'up');
      await writeFile(join(dir, 'm1.mjs'), 'export default {');
      await writeMigration('m2', ['CREATE TABLE m2 (id INTEGER)']);

      expect(await migrator.up()).toMatchObject([{ name: 'm2', success: true }]);
    });

    it('should refuse to roll back a migration recorded as run whose file is gone', async () => {
      const migrator = migratorOf();
      await migrator.runMigration({ name: 'm1', up: async () => {}, down: async () => {} }, 'up');

      await expect(migrator.down()).rejects.toThrow(`Migration 'm1' is recorded as run but has no file in ${dir}`);
      expect(await migrator.executed()).toEqual(['m1']);
    });

    it('should return a migration definition as given', () => {
      const migration = { up: async () => {}, down: async () => {} };
      expect(defineMigration(migration)).toBe(migration);
    });
  });

  describe('generating a migration', () => {
    it('should scaffold an empty migration, named from a slug of its name', async () => {
      const filePath = await migratorOf().generate('Add Users!');

      expect(filePath).toMatch(/\d{14}_add_users\.ts$/);
      expect(await readFile(filePath, 'utf-8')).toContain('export default {');
    });

    /** Written as source, so SQLite's backticked identifiers have to survive being read back as TypeScript. */
    it('should write the migration the entities need, which runs up and back down', async () => {
      const migrator = migratorOf();

      const filePath = await migrator.generateFromEntities('initial_schema');

      expect(await readFile(filePath, 'utf-8')).toContain('await querier.run("CREATE TABLE `MigNote` (');
      await migrator.up();
      expect(await tables()).toEqual(['MigNote', 'uql_migrations']);
      await migrator.down();
      expect(await tables()).toEqual(['uql_migrations']);
    });

    it('should write no migration where the database already matches', async () => {
      const migrator = migratorOf();
      await migrator.sync();

      expect(await migrator.generateFromEntities('noop')).toBe('');
      expect(logger).toHaveBeenCalledWith('No schema changes detected.');
    });

    /** Listed referencing first, so a rollback dropping in reverse of that order would drop the referenced table first. */
    it('should drop the tables it created dependents first', async () => {
      const source = await readFile(
        await migratorOf({ entities: [MigBook, MigAuthor] }).generateFromEntities('create_books'),
        'utf-8',
      );

      const down = source.split('async down')[1];
      expect([...down.matchAll(/DROP TABLE IF EXISTS `(\w+)`/g)].map(([, table]) => table)).toEqual([
        'MigBook',
        'MigAuthor',
      ]);
    });

    /** The down is each diff reversed, the latest first, each in the one order its generator writes. */
    it('should roll back the latest diff first, each as its reverse', async () => {
      @Entity({ name: 'First' })
      class First {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) a?: string | null;
      }
      @Entity({ name: 'Second' })
      class Second {
        @Id({ type: Number }) id?: number;
      }
      await pool.run('CREATE TABLE `First` (`id` INTEGER PRIMARY KEY)');
      await pool.run('CREATE TABLE `Second` (`id` INTEGER PRIMARY KEY, `b` TEXT)');
      const migrator = migratorOf({ entities: [First, Second] });

      const source = await readFile(await migrator.generateFromEntities('reorder'), 'utf-8');

      const down = source.split('async down')[1];
      expect([...down.matchAll(/querier\.run\("(.+?)"\)/g)].map(([, sql]) => sql)).toEqual([
        'ALTER TABLE `Second` ADD COLUMN `b` TEXT;',
        'ALTER TABLE `First` DROP COLUMN `a`;',
      ]);
      await migrator.up();
      await migrator.down();
      expect([await columns('First'), await columns('Second')]).toEqual([['id'], ['id', 'b']]);
    });
  });

  describe('sync', () => {
    it('should create what the entities declare, then find nothing left to do', async () => {
      const migrator = migratorOf();

      await migrator.sync({ logging: true });

      expect(await tables()).toEqual(['MigNote']);
      expect(logger).toHaveBeenCalledWith('Schema synchronization completed');
      await migrator.sync({ logging: true });
      expect(logger).toHaveBeenCalledWith('Schema is already in sync.');
    });

    /** The tables a relation reaches are read too, so its foreign key compares against the table it points at. */
    it('should find nothing to do for one entity whose tables, and those its relations reach, are in place', async () => {
      const migrator = migratorOf({ entities: [MigAuthor, MigBook] });
      await migrator.sync();

      expect(await migrator.planSync({ entity: MigAuthor })).toEqual([]);
      expect(await migrator.planSync({ entity: MigBook })).toEqual([]);
    });

    it('should roll back every statement of a sync where one fails', async () => {
      await expect(
        migratorOf().executeSyncStatements(['CREATE TABLE created (id INTEGER)', 'NOT SQL'], { logging: true }),
      ).rejects.toThrow('syntax error');

      expect(await tables()).toEqual([]);
    });

    it('should take every entity registered, unless given its own list, an empty one included', () => {
      expect(new Migrator(pool).entities).toContain(MigNote);
      expect(new Migrator(pool, { entities: [] }).entities).toEqual([]);
    });
  });

  describe('dialect inference', () => {
    const poolOf = (dialect: PostgresDialect | MongoDialect) =>
      createMockQuerierPool(dialect, async () => createMockQuerier());

    /** Which introspector each engine gets is pinned in `introspection/registry.spec.ts`. */
    it('should build the schema generator of a SQL dialect', async () => {
      expect(await new Migrator(poolOf(new PostgresDialect())).getSchemaGenerator()).toBeInstanceOf(SqlSchemaGenerator);
    });

    it('should load the MongoDB schema generator only once it is used', async () => {
      const migrator = new Migrator(poolOf(new MongoDialect()));
      expect(migrator.schemaGenerator).toBeUndefined();
      expect(await migrator.getSchemaGenerator()).toBeInstanceOf(MongoSchemaGenerator);
    });

    it('should take the generator its options give', async () => {
      const generator = new SqlSchemaGenerator(new PostgresDialect());
      const migrator = new Migrator(poolOf(new PostgresDialect()), { schemaGenerator: generator });
      expect(await migrator.getSchemaGenerator()).toBe(generator);
    });

    /** A collection has no columns to compare, so the check would call every entity drifted. */
    it('should refuse a drift check on MongoDB, pointing at the dry run that lists the index changes', async () => {
      const pool = poolOf(new MongoDialect());

      await expect(runDriftCheck(new Migrator(pool), { pool, entities: [MigNote] })).rejects.toThrow(
        'drift:check compares tables, and this database has none: `sync --dry-run` prints the index changes a sync would make',
      );
    });
  });
});

/**
 * Failures no database here can be made to produce on cue - a connection refused as the transaction
 * begins, a rollback failing after the statement did, a pool handing out a querier that is not SQL - so a
 * mocked querier fails at that point, under the real `transaction`.
 */
describe('Migrator under a failing connection', () => {
  const noteMigration: Migration = {
    name: 'm1',
    up: async (querier: SqlQuerier) => {
      await querier.run('CREATE TABLE "MigNote" ("id" INTEGER)');
    },
    down: async () => {},
  };
  const migratorOn = (querier: Querier) =>
    new Migrator(
      createMockQuerierPool(new PostgresDialect(), async () => querier),
      { entities: [MigNote] },
    );
  const failing = () => {
    const querier = createMockQuerier({ all: vi.fn(async () => []), run: vi.fn(), dialect: new PostgresDialect() });
    return { querier, migrator: migratorOn(querier) };
  };

  it("should report why a migration's transaction never started, not that it is missing", async () => {
    const { querier, migrator } = failing();
    querier.beginTransaction.mockRejectedValueOnce(new Error('password authentication failed'));

    await expect(migrator.runMigration(noteMigration, 'up')).resolves.toMatchObject({
      success: false,
      error: new Error('password authentication failed'),
    });
    expect(querier.release).toHaveBeenCalled();
  });

  /** A rollback that fails too is a consequence of the original error, and must not replace it. */
  it('should keep the original error of a migration when the rollback fails too', async () => {
    const { querier, migrator } = failing();
    querier.run.mockRejectedValueOnce(new Error('Migration error'));
    querier.rollbackTransaction.mockRejectedValueOnce(new Error('connection is dead'));

    await expect(migrator.runMigration(noteMigration, 'up')).resolves.toMatchObject({
      success: false,
      error: new Error('Migration error'),
    });
    expect(querier.release).toHaveBeenCalled();
  });

  it('should refuse a querier that is not SQL, and release it', async () => {
    const querier = createMockQuerier();
    const migrator = migratorOn(querier);

    await expect(migrator.sync({ force: true })).rejects.toThrow('requires a SQL-based querier');
    await expect(migrator.runMigration(noteMigration, 'up')).rejects.toThrow('Migrator requires a SQL-based querier');
    expect(querier.release).toHaveBeenCalledTimes(2);
  });
});

describe('migrationBuilderFor', () => {
  it('should build migrations on no querier but a SQL or a MongoDB one', async () => {
    await expect(migrationBuilderFor(createMockQuerier())).rejects.toThrow(
      'A migration builder needs a SQL or a MongoDB querier',
    );
  });
});
