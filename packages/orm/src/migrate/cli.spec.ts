import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { SchemaAST } from '../schema/schemaAST.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { createMockQuerier, createMockQuerierPool } from '../test/index.js';
import type { Config } from '../type/index.js';
import * as cliConfig from './cli-config.js';
import * as cli from './cli.js';
import type { Migrator } from './migrator.js';

@Entity()
class TestEntity {
  @Id({ type: Number }) id?: number;
}

/** Present in the database but absent from the configured entities. */
@Entity()
class ExtraTableEntity {
  @Id({ type: Number }) id?: number;
}

/** Same table as {@link DriftedEntity}, with the column type the entities expect. */
@Entity({ name: 'DriftTable' })
class ExpectedEntity {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, columnType: 'varchar', length: 50 }) label?: string | null;
}

/** Same table as {@link ExpectedEntity}, as the database actually has it. */
@Entity({ name: 'DriftTable' })
class DriftedEntity {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number, columnType: 'int' }) label?: number | null;
}

const current = vi.hoisted((): { migrator?: Migrator } => ({}));

vi.mock('./migrator.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./migrator.js')>()),
  Migrator: vi.fn(function () {
    return current.migrator;
  }),
}));

vi.mock('./cli-config.js', () => ({ loadConfig: vi.fn() }));

const { Migrator: RealMigrator } = await vi.importActual<typeof import('./migrator.js')>('./migrator.js');

describe('CLI', () => {
  let pool: Config['pool'];
  let migrator: Migrator;

  /** A real migrator, whose every step that would touch a database answers what a test sets. */
  beforeEach(() => {
    vi.clearAllMocks();
    pool = createMockQuerierPool(new SqliteDialect(), async () => createMockQuerier());
    vi.spyOn(pool, 'end');
    migrator = new RealMigrator(pool, { entities: [TestEntity] });
    current.migrator = migrator;
    vi.spyOn(migrator, 'up').mockResolvedValue([]);
    vi.spyOn(migrator, 'down').mockResolvedValue([]);
    vi.spyOn(migrator, 'status').mockResolvedValue({ executed: [], pending: [] });
    vi.spyOn(migrator, 'pending').mockResolvedValue([]);
    vi.spyOn(migrator, 'generate').mockResolvedValue('file.ts');
    vi.spyOn(migrator, 'generateFromEntities').mockResolvedValue('file.ts');
    vi.spyOn(migrator, 'sync').mockResolvedValue(undefined);
    vi.spyOn(migrator, 'planSync').mockResolvedValue([]);
    vi.spyOn(migrator.schemaIntrospector, 'introspect').mockResolvedValue(new SchemaAST());
    vi.mocked(cliConfig.loadConfig).mockResolvedValue({ pool });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(vi.fn<typeof process.exit>());
  });

  it('should run up', async () => {
    await cli.main(['up']);
    expect(cliConfig.loadConfig).toHaveBeenCalledWith(undefined);
    expect(migrator.up).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalled();
  });

  it('should run up with a custom config', async () => {
    await cli.main(['--config', 'custom.config.ts', 'up']);
    expect(cliConfig.loadConfig).toHaveBeenCalledWith('custom.config.ts');
    expect(migrator.up).toHaveBeenCalled();
  });

  it('should run up with a custom config given by the short flag', async () => {
    await cli.main(['-c', 'custom.config.ts', 'up']);
    expect(cliConfig.loadConfig).toHaveBeenCalledWith('custom.config.ts');
    expect(migrator.up).toHaveBeenCalled();
  });

  it('should run down', async () => {
    await cli.main(['down']);
    expect(migrator.down).toHaveBeenCalledWith({ step: 1 });
  });

  it('should run status', async () => {
    await cli.main(['status']);
    expect(migrator.status).toHaveBeenCalled();
  });

  it('should run generate', async () => {
    await cli.main(['generate', 'test_migration']);
    expect(migrator.generate).toHaveBeenCalledWith('test_migration');
  });

  it('should run generate:entities', async () => {
    await cli.main(['generate:entities', 'initial']);
    expect(migrator.generateFromEntities).toHaveBeenCalledWith('initial');
  });

  it('should apply the entity schema on sync', async () => {
    await cli.main(['sync']);
    expect(migrator.sync).toHaveBeenCalledWith({ force: false, safe: true, drop: false, logging: true });
  });

  it('should write a declaration file for the registered entities on types', async () => {
    const output = join(tmpdir(), `uql-types-${Date.now()}`, 'entities.d.ts');
    await cli.main(['types', '--output', output]);

    expect(readFileSync(output, 'utf-8')).toContain('export interface TestEntity {');
    rmSync(dirname(output), { recursive: true, force: true });
  });

  it('should force a sync with --force', async () => {
    await cli.main(['sync', '--force']);
    expect(migrator.sync).toHaveBeenCalledWith({ force: true, safe: true, drop: false, logging: true });
  });

  it('should print help', async () => {
    await cli.main(['--help']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('should refuse an unknown command', async () => {
    await cli.main(['unknown']);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown command: unknown'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should report what up ran, or that nothing was pending, and exit on a failure', async () => {
    vi.mocked(migrator.up).mockResolvedValue([{ name: 'm1', direction: 'up', duration: 1, success: true }]);
    await cli.runUp(migrator, []);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Migrations complete: 1 successful, 0 failed'));

    vi.mocked(migrator.up).mockResolvedValue([]);
    await cli.runUp(migrator, []);
    expect(console.log).toHaveBeenCalledWith('No pending migrations.');

    vi.mocked(migrator.up).mockResolvedValue([{ name: 'm1', direction: 'up', duration: 1, success: false }]);
    await cli.runUp(migrator, ['--to', 'm1', '--step', '1']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should report what down rolled back, or that nothing was there, and exit on a failure', async () => {
    vi.mocked(migrator.down).mockResolvedValue([{ name: 'm1', direction: 'down', duration: 1, success: true }]);
    await cli.runDown(migrator, []);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Rollback complete: 1 successful, 0 failed'));

    vi.mocked(migrator.down).mockResolvedValue([]);
    await cli.runDown(migrator, []);
    expect(console.log).toHaveBeenCalledWith('No migrations to rollback.');

    vi.mocked(migrator.down).mockResolvedValue([{ name: 'm1', direction: 'down', duration: 1, success: false }]);
    await cli.runDown(migrator, ['--to', 'm1', '--step', '1', '--all']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should list executed and pending migrations', async () => {
    vi.mocked(migrator.status).mockResolvedValue({ executed: ['m1'], pending: ['m2'] });
    await cli.runStatus(migrator);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✓ m1'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('○ m2'));

    vi.mocked(migrator.status).mockResolvedValue({ executed: [], pending: [] });
    await cli.runStatus(migrator);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('(none)'));
  });

  it('should list pending migrations', async () => {
    vi.mocked(migrator.pending).mockResolvedValue([{ name: 'm1', up: async () => {}, down: async () => {} }]);
    await cli.runPending(migrator);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('○ m1'));

    vi.mocked(migrator.pending).mockResolvedValue([]);
    await cli.runPending(migrator);
    expect(console.log).toHaveBeenCalledWith('No pending migrations.');
  });

  it('should name a generated migration from its words', async () => {
    await cli.runGenerate(migrator, ['add', 'user']);
    expect(migrator.generate).toHaveBeenCalledWith('add_user');
  });

  it('should generate a migration from the entities', async () => {
    await cli.runGenerateFromEntities(migrator, ['init']);
    expect(migrator.generateFromEntities).toHaveBeenCalledWith('init');
  });

  it('should pass sync its flags', async () => {
    await cli.runSync(migrator, ['--force'], {});
    expect(migrator.sync).toHaveBeenCalledWith({ force: true, safe: true, drop: false, logging: true });
  });

  it('should throw where the config has no pool', async () => {
    // @ts-expect-error: a config file is plain JavaScript
    vi.mocked(cliConfig.loadConfig).mockResolvedValue({ pool: undefined });
    await cli.main(['up']);
    expect(console.error).toHaveBeenCalledWith('Error:', 'Config.pool is required and must be an object');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should report a failing migration and exit', async () => {
    vi.mocked(migrator.up).mockRejectedValueOnce(new Error('Migration failed'));
    await cli.main(['up']);
    expect(console.error).toHaveBeenCalledWith('Error:', 'Migration failed');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should run generate-entities, the hyphenated alias', async () => {
    await cli.main(['generate-entities', 'schema']);
    expect(migrator.generateFromEntities).toHaveBeenCalledWith('schema');
  });

  it('should run create, the alias for generate', async () => {
    await cli.main(['create', 'add_table']);
    expect(migrator.generate).toHaveBeenCalledWith('add_table');
  });

  it('should run pending', async () => {
    await cli.main(['pending']);
    expect(migrator.pending).toHaveBeenCalled();
  });

  it('should print help for -h', async () => {
    await cli.main(['-h']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('should print help given no command', async () => {
    await cli.main([]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('should allow destructive changes on sync --unsafe', async () => {
    await cli.runSync(migrator, ['--unsafe'], { entities: [TestEntity] });
    expect(migrator.sync).toHaveBeenCalledWith({ force: false, safe: false, drop: true, logging: true });
  });

  it('should sync from the database to the entities on --pull', async () => {
    await cli.runSync(migrator, ['--pull'], { entities: [TestEntity] });
    expect(console.log).toHaveBeenCalled();
  });

  it('should print the statements a --dry-run would run, and run nothing', async () => {
    vi.mocked(migrator.planSync).mockResolvedValue(['ALTER TABLE "users" ADD COLUMN "age" INTEGER;']);

    await cli.runSync(migrator, ['--dry-run'], { entities: [TestEntity] });

    expect(console.log).toHaveBeenCalledWith('\nALTER TABLE "users" ADD COLUMN "age" INTEGER;');
    expect(migrator.sync).not.toHaveBeenCalled();
  });

  it('should say so where a --dry-run has nothing to do', async () => {
    await cli.runSync(migrator, ['--dry-run'], { entities: [TestEntity] });

    expect(console.log).toHaveBeenCalledWith('\nSchema is already in sync.');
  });

  it('should exit a drift check with no entities', async () => {
    await cli.runDriftCheck(migrator, { entities: [] });
    expect(console.error).toHaveBeenCalledWith('No entities configured. Add entities to your uql config.');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should report in_sync where the schemas match', async () => {
    vi.mocked(migrator.schemaIntrospector.introspect).mockResolvedValue(buildSchemaAST([TestEntity]));

    await cli.runDriftCheck(migrator, { entities: [TestEntity] });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Schema is in sync'));
  });

  it("should run drift:check with the config's entities", async () => {
    vi.mocked(cliConfig.loadConfig).mockResolvedValue({
      pool,
      entities: [TestEntity],
    });

    await cli.main(['drift:check']);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Checking for schema drift'));
  });

  /** A drift report drives the exit code, so each severity has to reach the right branch. */
  it('should report a table the entities do not declare as a warning', async () => {
    vi.mocked(migrator.schemaIntrospector.introspect).mockResolvedValue(buildSchemaAST([TestEntity, ExtraTableEntity]));

    await cli.runDriftCheck(migrator, { entities: [TestEntity] });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Status: DRIFTED'));
    expect(console.log).toHaveBeenCalledWith('WARNINGS:');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Create entity or drop table'));
    expect(process.exit).not.toHaveBeenCalled();
  });

  /** Type drift is only visible once the report can render each canonical type as this dialect's SQL. */
  it('should print the expected and actual type of a mismatched column', async () => {
    vi.mocked(migrator.schemaIntrospector.introspect).mockResolvedValue(buildSchemaAST([DriftedEntity]));

    await cli.runDriftCheck(migrator, { pool, entities: [ExpectedEntity] });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Expected: TEXT, Actual: INTEGER'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Data truncation risk'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should pull entities from the database on generate:from-db and its hyphenated alias', async () => {
    const output = mkdtempSync(join(tmpdir(), 'uql-entities-'));
    try {
      await cli.main(['generate:from-db', '--output', output]);
      await cli.main(['generate-from-db', '--output', output]);
      expect(migrator.schemaIntrospector.introspect).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  it('should run drift-check, the hyphenated alias', async () => {
    await cli.main(['drift-check']);
    expect(console.error).toHaveBeenCalledWith('No entities configured. Add entities to your uql config.');
  });

  it('should ignore an unknown flag, and a --step with no value, on up', async () => {
    await cli.runUp(migrator, ['--verbose', '--step']);
    expect(migrator.up).toHaveBeenCalledWith({});
  });

  it('should ignore an unknown flag on down', async () => {
    await cli.runDown(migrator, ['--verbose']);
    expect(migrator.down).toHaveBeenCalledWith({ step: 1 });
  });

  it('should name a migration given no name', async () => {
    await cli.runGenerate(migrator, []);
    await cli.runGenerateFromEntities(migrator, []);
    expect(migrator.generate).toHaveBeenCalledWith('migration');
    expect(migrator.generateFromEntities).toHaveBeenCalledWith('schema');
  });

  it('should write ./uql-entities.d.ts given no --output', () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'uql-types-'));
    process.chdir(dir);
    try {
      cli.runTypes(migrator, []);
      expect(readFileSync(join(dir, 'uql-entities.d.ts'), 'utf-8')).toContain('export interface TestEntity {');
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** An informational drift names no fix, so the INFO group prints none. */
  it('should print an index the entities do not declare as info, with no suggestion', async () => {
    @Entity({ name: 'IndexedTable' })
    class Indexed {
      @Id({ type: Number }) id?: number;
      @Field({ type: String, index: true }) code?: string | null;
    }
    @Entity({ name: 'IndexedTable' })
    class Unindexed {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) code?: string | null;
    }
    vi.mocked(migrator.schemaIntrospector.introspect).mockResolvedValue(buildSchemaAST([Indexed]));

    await cli.runDriftCheck(migrator, { entities: [Unindexed] });

    expect(console.log).toHaveBeenCalledWith('INFO:');
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Add @Field({ index })'));
  });
});
