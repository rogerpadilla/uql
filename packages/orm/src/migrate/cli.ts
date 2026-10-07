#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config, MigrationResult } from '../type/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import { assertCliConfig } from './assertCliConfig.js';
import { loadConfig } from './cli-config.js';
import { EntityCodeGenerator } from './codegen/entityCodeGenerator.js';
import { entityTypesSource } from './codegen/entityTypes.js';
import { detectDrift } from './drift/driftDetector.js';
import type { Drift, DriftReport } from './drift/index.js';
import { Migrator } from './migrator.js';
import { DEFAULT_MIGRATIONS_TABLE } from './storage/databaseStorage.js';

export async function main(args = process.argv.slice(2)) {
  let customPath: string | undefined;
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--config' || args[i] === '-c') && args[i + 1]) {
      customPath = args[++i];
    } else {
      filteredArgs.push(args[i]);
    }
  }

  const command = filteredArgs[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  try {
    const config = await loadConfig(customPath);
    assertCliConfig(config);

    const migrator = new Migrator(config.pool, {
      migrationsPath: config.migrationsPath,
      tableName: config.tableName,
      // A dry run's stdout is the SQL alone, so what the migrator notes on the way goes to stderr.
      logger: filteredArgs.includes('--dry-run') ? console.error : console.log,
      entities: config.entities,
      defaultForeignKeyAction: config.defaultForeignKeyAction,
    });
    const rest = filteredArgs.slice(1);

    switch (command) {
      case 'up':
        reportRun(
          await migrator.up({ to: readFlag(rest, '--to'), step: readStep(rest) }),
          'Migrations',
          'No pending migrations.',
        );
        break;
      case 'down': {
        const to = readFlag(rest, '--to');
        const step = to || rest.includes('--all') ? readStep(rest) : (readStep(rest) ?? 1);
        reportRun(await migrator.down({ to, step }), 'Rollback', 'No migrations to rollback.');
        break;
      }
      case 'status': {
        const { executed, pending } = await migrator.status();
        print(
          '\n=== Migration Status ===\n',
          'Executed migrations:',
          ...listed(executed, '✓'),
          '\nPending migrations:',
          ...listed(pending, '○'),
          '',
        );
        break;
      }
      case 'pending': {
        const pending = await migrator.pending();
        print(...(pending.length ? ['Pending migrations:', ...listed(pending, '○')] : ['No pending migrations.']));
        break;
      }
      // The migrator logs the file it created.
      case 'generate':
      case 'create':
        await migrator.generate(rest.join('_') || 'migration');
        break;
      case 'generate:entities':
      case 'generate-entities':
        await migrator.generateFromEntities(rest.join('_') || 'schema');
        break;
      case 'generate:from-db':
      case 'generate-from-db':
        await runGenerateFromDb(migrator, rest);
        break;
      case 'sync':
        await runSync(migrator, rest);
        break;
      case 'types':
        runTypes(migrator, rest);
        break;
      case 'drift:check':
      case 'drift-check':
        await runDriftCheck(migrator, config);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }

    await config.pool.end();
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

/** The value after the first of `names` the arguments hold. */
function readFlag(args: readonly string[], ...names: string[]): string | undefined {
  const at = args.findIndex((arg) => names.includes(arg));
  return at === -1 ? undefined : args[at + 1];
}

function readStep(args: readonly string[]): number | undefined {
  const step = readFlag(args, '--step');
  return step === undefined ? undefined : Number.parseInt(step, 10);
}

/** How a run of migrations went, failing the process on any failure. */
function reportRun(results: readonly MigrationResult[], title: string, none: string) {
  if (!results.length) {
    console.log(none);
    return;
  }
  const failed = results.filter((result) => !result.success).length;
  console.log(`\n${title} complete: ${results.length - failed} successful, ${failed} failed`);
  if (failed) {
    process.exit(1);
  }
}

/** Migration names, one a line, or `(none)`. */
function listed(names: readonly string[], icon: string): string[] {
  return names.length ? names.map((name) => `  ${icon} ${name}`) : ['  (none)'];
}

/** Each line its own `console.log`. */
function print(...lines: string[]) {
  for (const line of lines) {
    console.log(line);
  }
}

/**
 * Writes a `.d.ts` for the registered entities. The point is a schema defined at runtime: the same
 * registration that made the tables is what the compiler then checks queries against.
 */
function runTypes(migrator: Migrator, args: string[]) {
  const output = readFlag(args, '--output', '-o') ?? './uql-entities.d.ts';
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, entityTypesSource(migrator.entities), 'utf-8');
  console.log(`Wrote ${migrator.entities.length} entities to ${output}`);
}

async function runSync(migrator: Migrator, args: string[]) {
  // Pulling the database into entity files is what `generate:from-db` does; one implementation.
  if (args.includes('--pull')) {
    return runGenerateFromDb(migrator, args);
  }

  const force = args.includes('--force');
  const safe = !args.includes('--unsafe');
  const options = { force, safe, drop: !safe };

  // Ahead of the warning and the run: `--dry-run` means the same whatever else was asked for, `--force` included.
  // Its stdout is only SQL, so it can be appended to a migration file another tool applies.
  if (args.includes('--dry-run')) {
    const statements = await migrator.planSync(options);
    if (statements.length) {
      console.log(statements.join('\n'));
    } else {
      console.error('Schema is already in sync.');
    }
    return;
  }

  if (force) {
    console.log('\n⚠️  WARNING: This will drop and recreate all tables!');
    console.log('   All data will be lost. This should only be used in development.\n');
  }

  await migrator.sync({ ...options, logging: true });
  console.log('\nSchema sync completed.');
}

async function runGenerateFromDb(migrator: Migrator, args: string[]) {
  const outputDir = readFlag(args, '--output', '-o') ?? './src/entities';

  console.log('\nAnalyzing database schema...');

  const ast = await migrator.schemaIntrospector.introspect();
  const tableCount = ast.tables.size;

  console.log(`Found ${tableCount} table(s): ${Array.from(ast.tables.keys()).join(', ')}`);
  console.log('\nGenerating entities...');

  const entities = new EntityCodeGenerator(ast).generateAll();

  fs.mkdirSync(outputDir, { recursive: true });
  for (const entity of entities) {
    const filePath = path.join(outputDir, entity.fileName);
    fs.writeFileSync(filePath, entity.code, 'utf-8');
    console.log(`  ✓ ${entity.className} -> ${filePath}`);
  }

  console.log(`\nGenerated ${entities.length} entities to ${outputDir}`);
}

export async function runDriftCheck(migrator: Migrator, config: Partial<Config>) {
  if (!config.entities || config.entities.length === 0) {
    console.error('No entities configured. Add entities to your uql config.');
    process.exit(1);
  } else {
    console.log('\nChecking for schema drift...');

    const generator = await migrator.getSchemaGenerator();
    // MongoDB's generator builds no AST: a collection has only its indexes to compare, which a dry run lists.
    if (!generator.buildAST) {
      throw new UqlUsageError(
        'drift:check compares tables, and this database has none: `sync --dry-run` prints the index changes a sync would make',
      );
    }
    const expectedAST = generator.buildAST(config.entities);

    // Build actual schema from database
    const actualAST = await migrator.schemaIntrospector.introspect();

    // The dialect renders canonical types as SQL: without it no type drift is reported, silently
    // passing a mismatched column as in sync.
    const report = detectDrift(expectedAST, actualAST, {
      ...generator.diffOptions?.(),
      dialect: config.pool?.dialect,
      excludeTables: [config.tableName ?? DEFAULT_MIGRATIONS_TABLE],
    });

    printDriftReport(report);
  }
}

function printDriftReport(report: DriftReport) {
  console.log('\n=== Schema Drift Report ===\n');

  if (report.status === 'in_sync') {
    console.log('✓ Schema is in sync.');
  } else {
    const statusIcon = report.status === 'critical' ? '✗' : '⚠️';
    console.log(
      `${statusIcon} Status: ${report.status.toUpperCase()} (${report.summary.critical} critical, ${report.summary.warning} warning, ${report.summary.info} info)\n`,
    );

    // Group by severity
    const critical = report.drifts.filter((d) => d.severity === 'critical');
    const warning = report.drifts.filter((d) => d.severity === 'warning');
    const info = report.drifts.filter((d) => d.severity === 'info');

    printDriftGroup('CRITICAL:', critical, '✗', true);
    printDriftGroup('WARNINGS:', warning, '⚠', true);
    printDriftGroup('INFO:', info, 'ℹ', false);

    if (report.status === 'critical') {
      process.exit(1);
    }
  }
}

function printDriftGroup(title: string, drifts: Drift[], icon: string, showSuggestion: boolean) {
  if (drifts.length > 0) {
    console.log(title);
    for (const drift of drifts) {
      console.log(`  ${icon} ${drift.table}${drift.column ? '.' + drift.column : ''} - ${drift.type}`);
      console.log(`    ${drift.details}`);
      if (drift.expected && drift.actual) {
        console.log(`    Expected: ${drift.expected}, Actual: ${drift.actual}`);
      }
      if (showSuggestion) {
        console.log(`    -> ${drift.suggestion}`);
      }
    }
    console.log('');
  }
}

function printHelp() {
  console.log(`
uql-orm/migrate - Database migration tool for uql ORM

Usage: uql-orm/migrate <command> [options]

Commands:
  up                    Run all pending migrations
    --to <name>         Run migrations up to and including <name>
    --step <n>          Run only <n> migrations

  down                  Rollback the last migration
    --to <name>         Rollback to (and including) migration <name>
    --step <n>          Rollback <n> migrations (default: 1)
    --all               Rollback all migrations

  status                Show migration status

  pending               Show pending migrations

  generate <name>       Create a new empty migration file
  create <name>         Alias for generate

  generate:entities     Generate migration from entity definitions
    <name>              Optional name for the migration

  generate:from-db      Generate TypeScript entities from database
    --output, -o <dir>  Output directory (default: ./src/entities)

  sync                  Apply the entity schema to the database
    --dry-run           Print the statements instead of running them
    --unsafe            Allow destructive changes (drops, column alterations)
    --pull              Go the other way: generate entities from the database
    --force             Drop and recreate all tables (dangerous!)

  types                 Write a .d.ts for the registered entities
    --output, -o <file> Output path (default: ./uql-entities.d.ts)

  drift:check           Check for schema drift between entities and database

Configuration:
  Create a uql.config.ts or uql.config.js file in your project root.
  You can also specify a custom config path using --config or -c.
  The CLI requires pool.dialect (dialect id = pool.dialect.dialectName).
  See the repo README section "Driver -> pool -> dialect class".

  export default {
    pool: new PgQuerierPool({ ... }),
    migrationsPath: './migrations',
    tableName: 'uql_migrations',
    entities: [User, Post, ...],
  };

Examples:
  uql-orm/migrate up
  uql-orm/migrate up --step 1
  uql-orm/migrate down
  uql-orm/migrate down --step 3
  uql-orm/migrate status
  uql-orm/migrate generate add_users_table
  uql-orm/migrate generate:entities initial_schema
  uql-orm/migrate generate:from-db --output ./src/entities
  uql-orm/migrate sync --dry-run
  uql-orm/migrate sync --pull
  uql-orm/migrate drift:check
`);
}
