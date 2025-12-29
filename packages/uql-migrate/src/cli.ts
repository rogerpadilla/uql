#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Dialect, NamingStrategy, QuerierPool } from '@uql/core/type';
import { MongoSchemaGenerator } from './generator/mongoSchemaGenerator.js';
import { MysqlSchemaGenerator } from './generator/mysqlSchemaGenerator.js';
import { PostgresSchemaGenerator } from './generator/postgresSchemaGenerator.js';
import { SqliteSchemaGenerator } from './generator/sqliteSchemaGenerator.js';
import { Migrator } from './migrator.js';
import type { MigratorOptions } from './type.js';

interface CliConfig {
  querierPool?: QuerierPool;
  migrationsPath?: string;
  tableName?: string;
  dialect?: Dialect;
  entities?: unknown[];
  namingStrategy?: NamingStrategy;
}

async function loadConfig(): Promise<CliConfig> {
  const configPaths = ['uql.config.ts', 'uql.config.js', 'uql.config.mjs', '.uqlrc.ts', '.uqlrc.js'];

  for (const configPath of configPaths) {
    try {
      const fullPath = resolve(process.cwd(), configPath);
      const fileUrl = pathToFileURL(fullPath).href;
      const module = await import(fileUrl);
      return module.default ?? module;
    } catch {
      // Config file not found, try next one
    }
  }

  throw new Error(
    'Could not find uql configuration file. ' + 'Create a uql.config.ts or uql.config.js file in your project root.',
  );
}

function getSchemaGenerator(dialect: Dialect, namingStrategy?: NamingStrategy) {
  switch (dialect) {
    case 'postgres':
      return new PostgresSchemaGenerator(namingStrategy);
    case 'mysql':
    case 'mariadb':
      return new MysqlSchemaGenerator(namingStrategy);
    case 'sqlite':
      return new SqliteSchemaGenerator(namingStrategy);
    case 'mongodb':
      return new MongoSchemaGenerator(namingStrategy);
    default:
      throw new TypeError(`Unknown dialect: ${dialect}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  try {
    const config = await loadConfig();

    if (!config.querierPool) {
      throw new Error('querierPool is required in configuration');
    }

    const dialect = config.dialect ?? 'postgres';

    const options: MigratorOptions & { dialect: Dialect } = {
      migrationsPath: config.migrationsPath ?? './migrations',
      tableName: config.tableName,
      logger: console.log,
      entities: config.entities as MigratorOptions['entities'],
      dialect,
      namingStrategy: config.namingStrategy,
    };

    const migrator = new Migrator(config.querierPool, options);
    migrator.setSchemaGenerator(getSchemaGenerator(dialect, config.namingStrategy));

    switch (command) {
      case 'up':
        await runUp(migrator, args.slice(1));
        break;
      case 'down':
        await runDown(migrator, args.slice(1));
        break;
      case 'status':
        await runStatus(migrator);
        break;
      case 'generate':
      case 'create':
        await runGenerate(migrator, args.slice(1));
        break;
      case 'generate:entities':
      case 'generate-entities':
        await runGenerateFromEntities(migrator, args.slice(1));
        break;
      case 'sync':
        await runSync(migrator, args.slice(1));
        break;
      case 'pending':
        await runPending(migrator);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }

    // Close the connection pool
    const pool = config.querierPool as { end?: () => Promise<void> };
    if (pool.end) {
      await pool.end();
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

async function runUp(migrator: Migrator, args: string[]) {
  const options: { to?: string; step?: number } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' && args[i + 1]) {
      options.to = args[++i];
    } else if (args[i] === '--step' && args[i + 1]) {
      options.step = Number.parseInt(args[++i], 10);
    }
  }

  const results = await migrator.up(options);

  if (results.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\nMigrations complete: ${successful} successful, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

async function runDown(migrator: Migrator, args: string[]) {
  const options: { to?: string; step?: number } = { step: 1 }; // Default to 1 step

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' && args[i + 1]) {
      options.to = args[++i];
      delete options.step;
    } else if (args[i] === '--step' && args[i + 1]) {
      options.step = Number.parseInt(args[++i], 10);
    } else if (args[i] === '--all') {
      delete options.step;
    }
  }

  const results = await migrator.down(options);

  if (results.length === 0) {
    console.log('No migrations to rollback.');
    return;
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\nRollback complete: ${successful} successful, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

async function runStatus(migrator: Migrator) {
  const status = await migrator.status();

  console.log('\n=== Migration Status ===\n');

  console.log('Executed migrations:');
  if (status.executed.length === 0) {
    console.log('  (none)');
  } else {
    for (const name of status.executed) {
      console.log(`  ✓ ${name}`);
    }
  }

  console.log('\nPending migrations:');
  if (status.pending.length === 0) {
    console.log('  (none)');
  } else {
    for (const name of status.pending) {
      console.log(`  ○ ${name}`);
    }
  }

  console.log('');
}

async function runPending(migrator: Migrator) {
  const pending = await migrator.pending();

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  console.log('Pending migrations:');
  for (const migration of pending) {
    console.log(`  ○ ${migration.name}`);
  }
}

async function runGenerate(migrator: Migrator, args: string[]) {
  const name = args.join('_') || 'migration';
  const filePath = await migrator.generate(name);
  console.log(`\nCreated migration: ${filePath}`);
}

async function runGenerateFromEntities(migrator: Migrator, args: string[]) {
  const name = args.join('_') || 'schema';
  const filePath = await migrator.generateFromEntities(name);
  console.log(`\nCreated migration from entities: ${filePath}`);
}

async function runSync(migrator: Migrator, args: string[]) {
  const force = args.includes('--force');

  if (force) {
    console.log('\n⚠️  WARNING: This will drop and recreate all tables!');
    console.log('   All data will be lost. This should only be used in development.\n');
  }

  await migrator.sync({ force });
  console.log('\nSchema sync completed.');
}

function printHelp() {
  console.log(`
@uql/migrate - Database migration tool for uql ORM

Usage: @uql/migrate <command> [options]

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

  sync                  Sync schema directly (development only!)
    --force             Drop and recreate all tables

Configuration:
  Create a uql.config.ts or uql.config.js file in your project root:

  export default {
    querierPool: new PgQuerierPool({ ... }),
    migrationsPath: './migrations',
    tableName: 'uql_migrations',
    dialect: 'postgres', // 'postgres' | 'mysql' | 'mariadb' | 'sqlite'
    entities: [User, Post, ...],
  };

Examples:
  @uql/migrate up
  @uql/migrate up --step 1
  @uql/migrate down
  @uql/migrate down --step 3
  @uql/migrate status
  @uql/migrate generate add_users_table
  @uql/migrate generate:entities initial_schema
`);
}

main().catch(console.error);
