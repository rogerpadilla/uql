#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Drift, type DriftReport, SchemaASTBuilder } from '../schema/index.js';
import type { Dialect, MigratorOptions, NamingStrategy } from '../type/index.js';
import { loadConfig } from './cli-config.js';
import { createEntityCodeGenerator } from './codegen/entityCodeGenerator.js';
import { detectDrift } from './drift/driftDetector.js';
import { Migrator } from './migrator.js';
import { createSchemaGenerator } from './schemaGenerator.js';
import { createSchemaSync } from './sync/schemaSync.js';

export function getSchemaGenerator(dialect: Dialect, namingStrategy?: NamingStrategy) {
  return createSchemaGenerator(dialect, namingStrategy);
}

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

    if (!config.pool) {
      throw new TypeError('pool is required in configuration');
    }

    const dialect = config.dialect ?? config.pool.dialect ?? 'postgres';

    const options: MigratorOptions & { dialect: Dialect } = {
      migrationsPath: config.migrationsPath ?? './migrations',
      tableName: config.tableName,
      logger: console.log,
      entities: config.entities,
      dialect,
      namingStrategy: config.namingStrategy,
    };

    const migrator = new Migrator(config.pool, options);
    migrator.setSchemaGenerator(getSchemaGenerator(dialect, config.namingStrategy));

    switch (command) {
      case 'up':
        await runUp(migrator, filteredArgs.slice(1));
        break;
      case 'down':
        await runDown(migrator, filteredArgs.slice(1));
        break;
      case 'status':
        await runStatus(migrator);
        break;
      case 'generate':
      case 'create':
        await runGenerate(migrator, filteredArgs.slice(1));
        break;
      case 'generate:entities':
      case 'generate-entities':
        await runGenerateFromEntities(migrator, filteredArgs.slice(1));
        break;
      case 'generate:from-db':
      case 'generate-from-db':
        await runGenerateFromDb(migrator, filteredArgs.slice(1), config);
        break;
      case 'sync':
        await runSync(migrator, filteredArgs.slice(1), config);
        break;
      case 'pending':
        await runPending(migrator);
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

    // Close the connection pool
    const pool = config.pool;
    if (pool.end) {
      await pool.end();
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

export async function runUp(migrator: Migrator, args: string[]) {
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

export async function runDown(migrator: Migrator, args: string[]) {
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

export async function runStatus(migrator: Migrator) {
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

export async function runPending(migrator: Migrator) {
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

export async function runGenerate(migrator: Migrator, args: string[]) {
  const name = args.join('_') || 'migration';
  const filePath = await migrator.generate(name);
  console.log(`\nCreated migration: ${filePath}`);
}

export async function runGenerateFromEntities(migrator: Migrator, args: string[]) {
  const name = args.join('_') || 'schema';
  const filePath = await migrator.generateFromEntities(name);
  console.log(`\nCreated migration from entities: ${filePath}`);
}

export async function runSync(migrator: Migrator, args: string[], config: any) {
  const force = args.includes('--force');
  const push = args.includes('--push');
  const pull = args.includes('--pull');
  const dryRun = args.includes('--dry-run');

  // Parse direction
  let direction: 'bidirectional' | 'entity-to-db' | 'db-to-entity' = 'bidirectional';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--direction' && args[i + 1]) {
      direction = args[++i] as typeof direction;
    }
  }

  // Shorthand flags
  if (push) direction = 'entity-to-db';
  if (pull) direction = 'db-to-entity';

  if (force) {
    console.log('\n⚠️  WARNING: This will drop and recreate all tables!');
    console.log('   All data will be lost. This should only be used in development.\n');
    await migrator.sync({ force });
    console.log('\nSchema sync completed.');
    return;
  }

  // Use SchemaSync for direction-aware sync
  if (config.entities && migrator.schemaIntrospector) {
    const schemaSync = createSchemaSync({
      entities: config.entities,
      introspector: migrator.schemaIntrospector,
      direction,
      safe: !args.includes('--unsafe'),
      dryRun,
    });

    const result = await schemaSync.sync();

    console.log('\n' + result.summary);

    if (result.conflicts.length > 0) {
      console.log('\n⚠️  Conflicts require manual resolution.');
      process.exit(1);
    }
  } else {
    await migrator.sync({ force: false });
    console.log('\nSchema sync completed.');
  }
}

export async function runGenerateFromDb(migrator: Migrator, args: string[], config: any) {
  // Parse output directory
  let outputDir = './src/entities';
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
      outputDir = args[++i];
    }
  }

  if (!migrator.schemaIntrospector) {
    console.error('No introspector available. Check your pool configuration.');
    process.exit(1);
  } else {
    console.log('\nAnalyzing database schema...');

    const ast = await migrator.schemaIntrospector.introspect();
    const tableCount = ast.tables.size;

    console.log(`Found ${tableCount} table(s): ${Array.from(ast.tables.keys()).join(', ')}`);
    console.log('\nGenerating entities...');

    const generator = createEntityCodeGenerator(ast, {
      addSyncComments: true,
      includeRelations: true,
      includeIndexes: true,
    });

    const entities = generator.generateAll();

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write entity files
    for (const entity of entities) {
      const filePath = path.join(outputDir, entity.fileName);
      fs.writeFileSync(filePath, entity.code, 'utf-8');
      console.log(`  ✓ ${entity.className} -> ${filePath}`);
    }

    console.log(`\nGenerated ${entities.length} entities to ${outputDir}`);
  }
}

export async function runDriftCheck(migrator: Migrator, config: any) {
  if (!config.entities || config.entities.length === 0) {
    console.error('No entities configured. Add entities to your uql config.');
    process.exit(1);
  } else if (!migrator.schemaIntrospector) {
    console.error('No introspector available. Check your pool configuration.');
    process.exit(1);
  } else {
    console.log('\nChecking for schema drift...');

    // Build expected schema from entities
    const builder = new SchemaASTBuilder();
    const expectedAST = builder.fromEntities(config.entities);

    // Build actual schema from database
    const actualAST = await migrator.schemaIntrospector.introspect();

    // Detect drift
    const report = detectDrift(expectedAST, actualAST);

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
      if (showSuggestion && drift.suggestion) {
        console.log(`    → ${drift.suggestion}`);
      }
    }
    console.log('');
  }
}

export function printHelp() {
  console.log(`
@uql/core/migrate - Database migration tool for uql ORM

Usage: @uql/core/migrate <command> [options]

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

  sync                  Sync schema with direction support
    --force             Drop and recreate all tables (dangerous!)
    --direction <mode>  Sync direction: bidirectional, entity-to-db, db-to-entity
    --push              Shorthand for --direction entity-to-db
    --pull              Shorthand for --direction db-to-entity
    --dry-run           Preview changes without applying
    --unsafe            Allow destructive changes

  drift:check           Check for schema drift between entities and database

Configuration:
  Create a uql.config.ts or uql.config.js file in your project root.
  You can also specify a custom config path using --config or -c.

  export default {
    pool: new PgQuerierPool({ ... }),
    // dialect: 'postgres', // optional, inferred from pool
    migrationsPath: './migrations',
    tableName: 'uql_migrations',
    entities: [User, Post, ...],
  };

Examples:
  @uql/core/migrate up
  @uql/core/migrate up --step 1
  @uql/core/migrate down
  @uql/core/migrate down --step 3
  @uql/core/migrate status
  @uql/core/migrate generate add_users_table
  @uql/core/migrate generate:entities initial_schema
  @uql/core/migrate generate:from-db --output ./src/entities
  @uql/core/migrate sync --push
  @uql/core/migrate sync --pull
  @uql/core/migrate drift:check
`);
}
