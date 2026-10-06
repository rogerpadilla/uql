import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeSqliteQuerierPool } from '../sqlite/nodeSqliteQuerierPool.js';
import { main } from './cli.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/**
 * The config a project's `uql.config.ts` holds: a SQLite file, and the `settings` given, by default its
 * migrations directory and one entity, `CliNote`, registered at runtime since the file runs without a
 * decorator transform.
 */
function configSource(
  dir: string,
  settings = `migrationsPath: ${JSON.stringify(join(dir, 'migrations'))}, entities: [CliNote],`,
): string {
  return `
import { defineEntity } from ${JSON.stringify(join(SRC, 'entity/index.ts'))};
import { NodeSqliteQuerierPool } from ${JSON.stringify(join(SRC, 'sqlite/nodeSqliteQuerierPool.ts'))};

class CliNote {}
defineEntity(CliNote, { fields: { id: { type: Number, isId: true }, body: { type: String } } });

export default {
  pool: new NodeSqliteQuerierPool(${JSON.stringify(join(dir, 'app.db'))}),
  ${settings}
};
`;
}

describe('CLI', () => {
  const cwd = process.cwd();
  let dir: string;
  let runs = 0;

  /**
   * Writes a config file of its own per run, returning its path: an import is cached by its path, and the
   * CLI ends the pool the config made once the command is done.
   */
  const writeConfig = (source = configSource(dir), file = `uql.config.${++runs}.ts`) => {
    const config = join(dir, file);
    writeFileSync(config, source);
    return config;
  };

  /** Runs the CLI on this test's project. */
  const cli = (...args: string[]) => main(['--config', writeConfig(), ...args]);

  /** Runs `sql` on the project's database, outside the CLI. */
  const query = async <T>(sql: string): Promise<T[]> => {
    const pool = new NodeSqliteQuerierPool(join(dir, 'app.db'));
    try {
      return await pool.all<T>(sql);
    } finally {
      await pool.end();
    }
  };

  const tables = async () =>
    (
      await query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
    ).map((row) => row.name);

  const columns = async (table: string) =>
    (await query<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)).map((row) => row.name);

  const migrationFiles = () => readdirSync(join(dir, 'migrations'));

  /** A migration file creating `table` on up and dropping it on down. */
  const writeMigration = (name: string, table: string) => {
    mkdirSync(join(dir, 'migrations'), { recursive: true });
    writeFileSync(
      join(dir, 'migrations', `${name}.mjs`),
      `export default {
        up: (querier) => querier.run('CREATE TABLE ${table} (id INTEGER PRIMARY KEY)'),
        down: (querier) => querier.run('DROP TABLE ${table}'),
      };`,
    );
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uql-cli-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Spied, not run: a real exit would end the test worker.
    vi.spyOn(process, 'exit').mockImplementation(vi.fn<typeof process.exit>());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  describe('help and config', () => {
    it.each([[['--help']], [['-h']], [[]]])('should print help for %j', async (args) => {
      await main(args);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('should refuse an unknown command', async () => {
      await cli('unknown');
      expect(console.error).toHaveBeenCalledWith('Unknown command: unknown');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should read the config -c names', async () => {
      await main(['-c', writeConfig(), 'sync']);
      expect(await tables()).toEqual(['CliNote']);
    });

    it('should find uql.config.ts in the working directory, and default to ./migrations there', async () => {
      writeConfig(configSource(dir, 'entities: [CliNote],'), 'uql.config.ts');
      process.chdir(dir);
      await main(['generate', 'seed']);
      expect(migrationFiles()).toEqual([expect.stringMatching(/^\d{14}_seed\.ts$/)]);
    });

    it('should report a config with no pool, and exit', async () => {
      await main(['--config', writeConfig('export default {};'), 'up']);
      expect(console.error).toHaveBeenCalledWith('Error:', 'Config.pool is required and must be an object');
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('sync', () => {
    it('should create the tables the entities declare', async () => {
      await cli('sync');
      expect(await tables()).toEqual(['CliNote']);
      expect(console.log).toHaveBeenCalledWith('\nSchema sync completed.');
    });

    it('should print only the statements on stdout on a --dry-run, and run none', async () => {
      await cli('sync', '--dry-run');
      expect(vi.mocked(console.log).mock.calls).toEqual([[expect.stringMatching(/^CREATE TABLE `CliNote`/)]]);
      expect(await tables()).toEqual([]);
    });

    /** Stdout is SQL to append to a migration file, so what the migrator notes on the way goes to stderr. */
    it('should send what a --dry-run notes to stderr, leaving stdout empty where there is no SQL', async () => {
      await query('CREATE TABLE CliNote (id INTEGER PRIMARY KEY, body TEXT, legacy TEXT)');

      await cli('sync', '--dry-run');

      expect(console.log).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Skipped 1 column changes in table 'CliNote': legacy"),
      );
      expect(console.error).toHaveBeenCalledWith('Schema is already in sync.');
    });

    it('should drop a column the entities no longer declare only with --unsafe', async () => {
      await query('CREATE TABLE CliNote (id INTEGER PRIMARY KEY, body TEXT, legacy TEXT)');

      await cli('sync');
      expect(await columns('CliNote')).toEqual(['id', 'body', 'legacy']);

      await cli('sync', '--unsafe');
      expect(await columns('CliNote')).toEqual(['id', 'body']);
    });

    it('should drop and recreate every table with --force, warning first', async () => {
      await cli('sync');
      await query("INSERT INTO CliNote (id, body) VALUES (1, 'kept?')");

      await cli('sync', '--force');

      expect(console.log).toHaveBeenCalledWith('\n⚠️  WARNING: This will drop and recreate all tables!');
      expect(await query('SELECT * FROM CliNote')).toEqual([]);
    });
  });

  describe('migrations', () => {
    it('should write an empty migration named from its words, or migration, under generate and create', async () => {
      await cli('generate', 'add', 'user');
      await cli('create');
      expect(
        migrationFiles()
          .map((file) => file.replace(/^\d+_/, ''))
          .toSorted(),
      ).toEqual(['add_user.ts', 'migration.ts']);
    });

    it('should write the migration the entities need, named schema by default, under both spellings', async () => {
      await cli('generate:entities', 'init');
      await cli('generate-entities');
      const [file] = migrationFiles().filter((it) => it.endsWith('_init.ts'));

      expect(readFileSync(join(dir, 'migrations', file), 'utf-8')).toContain('CREATE TABLE `CliNote`');
      expect(migrationFiles().filter((it) => it.endsWith('_schema.ts'))).toHaveLength(1);
    });

    it('should list pending migrations, then run them up by step and report what ran', async () => {
      writeMigration('m1', 'first');
      writeMigration('m2', 'second');

      await cli('pending');
      expect(console.log).toHaveBeenCalledWith('  ○ m1');
      expect(console.log).toHaveBeenCalledWith('  ○ m2');

      await cli('up', '--step', '1');
      expect(await tables()).toEqual(['first', 'uql_migrations']);

      await cli('status');
      expect(console.log).toHaveBeenCalledWith('  ✓ m1');

      await cli('up', '--verbose');
      expect(await tables()).toEqual(['first', 'second', 'uql_migrations']);
      expect(console.log).toHaveBeenCalledWith('\nMigrations complete: 1 successful, 0 failed');

      await cli('up');
      expect(console.log).toHaveBeenCalledWith('No pending migrations.');
    });

    it('should report none pending, and none executed', async () => {
      await cli('pending');
      await cli('status');
      expect(console.log).toHaveBeenCalledWith('No pending migrations.');
      expect(console.log).toHaveBeenCalledWith('  (none)');
    });

    it('should run up to a named migration, and roll back the last one, to one, or all', async () => {
      writeMigration('m1', 'first');
      writeMigration('m2', 'second');
      writeMigration('m3', 'third');

      await cli('up', '--to', 'm2');
      expect(await tables()).toEqual(['first', 'second', 'uql_migrations']);

      await cli('up');
      await cli('down');
      expect(await tables()).toEqual(['first', 'second', 'uql_migrations']);
      expect(console.log).toHaveBeenCalledWith('\nRollback complete: 1 successful, 0 failed');

      await cli('down', '--to', 'm2');
      expect(await tables()).toEqual(['first', 'uql_migrations']);

      await cli('up');
      await cli('down', '--step', '2');
      expect(await tables()).toEqual(['first', 'uql_migrations']);

      await cli('down', '--all', '--verbose');
      expect(await tables()).toEqual(['uql_migrations']);

      await cli('down');
      expect(console.log).toHaveBeenCalledWith('No migrations to rollback.');
    });

    it('should exit on a migration that fails, either way', async () => {
      writeMigration('m1', 'first');
      await query('CREATE TABLE first (id INTEGER PRIMARY KEY)');

      await cli('up');
      expect(console.log).toHaveBeenCalledWith('\nMigrations complete: 0 successful, 1 failed');
      expect(process.exit).toHaveBeenCalledWith(1);

      await query('DROP TABLE first');
      await cli('up');
      await query('DROP TABLE first');
      vi.mocked(process.exit).mockClear();
      await cli('down');
      expect(console.log).toHaveBeenCalledWith('\nRollback complete: 0 successful, 1 failed');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should report a command that throws, and exit', async () => {
      await cli('up', '--to', 'missing');
      expect(console.error).toHaveBeenCalledWith('Error:', "Migration 'missing' not found");
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('types', () => {
    it('should write a declaration file for the configured entities', async () => {
      const output = join(dir, 'types', 'entities.d.ts');
      await cli('types', '--output', output);
      expect(readFileSync(output, 'utf-8')).toContain('export interface CliNote {');
    });

    it('should write ./uql-entities.d.ts given no --output', async () => {
      process.chdir(dir);
      await cli('types');
      expect(readFileSync(join(dir, 'uql-entities.d.ts'), 'utf-8')).toContain('export interface CliNote {');
    });
  });

  describe('generate:from-db', () => {
    it.each([['generate:from-db'], ['generate-from-db'], ['sync', '--pull']])(
      'should write the entities %j reads',
      async (...command) => {
        await query('CREATE TABLE shops (id INTEGER PRIMARY KEY)');
        await cli(...command, '-o', join(dir, 'entities'));
        expect(readdirSync(join(dir, 'entities'))).toEqual(['Shop.ts']);
      },
    );

    it('should write one entity file per table to ./src/entities given no --output', async () => {
      await query('CREATE TABLE shops (id INTEGER PRIMARY KEY)');
      process.chdir(dir);
      await cli('generate:from-db');
      expect(readFileSync(join(dir, 'src/entities/Shop.ts'), 'utf-8')).toContain("@Entity({ name: 'shops' })");
      expect(console.log).toHaveBeenCalledWith('Found 1 table(s): shops');
    });
  });

  describe('drift:check', () => {
    it('should report in sync the schema a sync made, under both spellings', async () => {
      await cli('sync');
      await cli('drift:check');
      await cli('drift-check');
      expect(vi.mocked(console.log).mock.calls.filter(([line]) => line === '✓ Schema is in sync.')).toHaveLength(2);
    });

    it('should report a table no entity declares as a warning, and not exit', async () => {
      await cli('sync');
      await query('CREATE TABLE stray (id INTEGER PRIMARY KEY)');

      await cli('drift:check');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Status: DRIFTED'));
      expect(console.log).toHaveBeenCalledWith('WARNINGS:');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Create entity or drop table'));
      expect(process.exit).not.toHaveBeenCalled();
    });

    /** Type drift shows only once the report renders each canonical type as this dialect's SQL. */
    it('should print the expected and actual type of a mismatched column, and exit', async () => {
      await query('CREATE TABLE CliNote (id INTEGER PRIMARY KEY, body INTEGER)');

      await cli('drift:check');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Expected: TEXT, Actual: INTEGER'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Data truncation risk'));
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    /** An informational drift names no fix, so the INFO group prints none. */
    it('should print an index the entities do not declare as info, with no suggestion', async () => {
      await cli('sync');
      await query('CREATE INDEX stray_body_idx ON CliNote (body)');

      await cli('drift:check');

      expect(console.log).toHaveBeenCalledWith('INFO:');
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('->'));
    });

    it('should exit given no entities', async () => {
      await main(['--config', writeConfig(configSource(dir, 'entities: [],')), 'drift:check']);
      expect(console.error).toHaveBeenCalledWith('No entities configured. Add entities to your uql config.');
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
