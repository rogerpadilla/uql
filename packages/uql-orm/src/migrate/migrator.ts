import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getEntities, getMeta } from '../entity/index.js';
import { introspectSchema, SchemaAST } from '../schema/index.js';
import type { ForeignKeyAction } from '../schema/types.js';
import type {
  DialectName,
  LoggingOptions,
  Migration,
  MigrationDefinition,
  MigrationResult,
  MigrationStorage,
  MigratorOptions,
  MongoQuerier,
  Querier,
  QuerierPool,
  SchemaDiff,
  SchemaGenerator,
  SchemaIntrospector,
  Type,
} from '../type/index.js';
import { isKnownMigratorDialect, isSqlQuerier } from '../type/index.js';
import { LoggerWrapper } from '../util/index.js';
import { withQuerierForMigrations, withSqlQuerierForMigrations } from './acquireQuerierForMigrations.js';
import type { IMigrationBuilder } from './builder/types.js';
import {
  buildSqlQuerierMigrationModule,
  EMPTY_MANUAL_MIGRATION_DOWN_INNER,
  EMPTY_MANUAL_MIGRATION_UP_INNER,
  emitSqlRunCalls,
} from './codegen/migrationFile.js';
import { runMongoCommand } from './generator/mongoCommand.js';
import {
  CockroachSchemaIntrospector,
  MongoSchemaIntrospector,
  MysqlSchemaIntrospector,
  PostgresSchemaIntrospector,
  SqliteSchemaIntrospector,
} from './introspection/index.js';
import { createSchemaGenerator } from './schemaGenerator.js';
import { createSchemaGeneratorAsync } from './schemaGeneratorAsync.js';
import { DatabaseMigrationStorage } from './storage/databaseStorage.js';

/**
 * Main class for managing database migrations
 */
export class Migrator {
  public readonly storage: MigrationStorage;
  public readonly migrationsPath: string;

  private _logger: LoggerWrapper;
  public get logger(): LoggerWrapper {
    return this._logger;
  }
  public set logger(value: LoggingOptions) {
    this._logger = new LoggerWrapper(value);
  }
  private readonly _entities?: Type<unknown>[];

  public get entities(): Type<unknown>[] {
    return this._entities ?? getEntities();
  }
  public readonly dialectName: DialectName;
  public schemaGenerator?: SchemaGenerator;
  public schemaIntrospector?: SchemaIntrospector;
  private readonly _defaultForeignKeyAction?: ForeignKeyAction;
  private _mongoSchemaLoadPromise?: Promise<void>;

  constructor(
    private readonly pool: QuerierPool,
    options: MigratorOptions = {},
  ) {
    this.dialectName = pool.dialect.dialectName ?? 'postgres';
    this._defaultForeignKeyAction = options.defaultForeignKeyAction;
    this.storage =
      options.storage ??
      new DatabaseMigrationStorage(pool, {
        tableName: options.tableName,
      });
    this.migrationsPath = options.migrationsPath ?? './migrations';
    this._logger = new LoggerWrapper(options.logger!, { logValues: options.logValues, slowQuery: options.slowQuery });
    this._entities = options.entities;
    this.schemaIntrospector = this.createIntrospector();
    this.schemaGenerator =
      options.schemaGenerator ?? (this.dialectName === 'mongodb' ? undefined : this.createGenerator());
  }

  /** Loads MongoDB schema generator on first use; SQL generators are set in the constructor (or via {@link setSchemaGenerator}). */
  private async ensureSchemaGenerator(): Promise<void> {
    if (this.schemaGenerator || this.dialectName !== 'mongodb') {
      return;
    }
    if (!this._mongoSchemaLoadPromise) {
      this._mongoSchemaLoadPromise = createSchemaGeneratorAsync(this.pool.dialect, this._defaultForeignKeyAction).then(
        (gen) => {
          if (gen) {
            this.schemaGenerator = gen;
          }
        },
      );
    }
    await this._mongoSchemaLoadPromise;
  }

  /**
   * Set the schema generator for DDL operations
   */
  setSchemaGenerator(generator: SchemaGenerator): void {
    this.schemaGenerator = generator;
  }

  /** `schema` reads one namespace instead of the connection's own; see {@link BaseSqlIntrospector.schema}. */
  protected createIntrospector(schema?: string): SchemaIntrospector | undefined {
    const d = this.dialectName;
    if (!isKnownMigratorDialect(d)) {
      return undefined;
    }
    switch (d) {
      case 'postgres':
        return new PostgresSchemaIntrospector(this.pool, schema);
      case 'cockroachdb':
        return new CockroachSchemaIntrospector(this.pool, schema);
      case 'mysql':
      case 'mariadb':
        return new MysqlSchemaIntrospector(this.pool, schema);
      case 'sqlite':
        return new SqliteSchemaIntrospector(this.pool);
      case 'mongodb':
        return new MongoSchemaIntrospector(this.pool);
      default:
        return undefined;
    }
  }

  protected createGenerator(): SchemaGenerator | undefined {
    if (!isKnownMigratorDialect(this.dialectName)) {
      return undefined;
    }
    return createSchemaGenerator(this.pool.dialect, this._defaultForeignKeyAction);
  }

  /**
   * Get all discovered migrations from the migrations directory
   */
  async getMigrations(): Promise<Migration[]> {
    const files = await this.getMigrationFiles();
    const migrations: Migration[] = [];

    for (const file of files) {
      const migration = await this.loadMigration(file);
      if (migration) {
        migrations.push(migration);
      }
    }

    // Sort by name (which typically includes timestamp)
    return migrations.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get list of pending migrations (not yet executed)
   */
  async pending(): Promise<Migration[]> {
    const [migrations, executed] = await Promise.all([this.getMigrations(), this.storage.executed()]);

    const executedSet = new Set(executed);
    return migrations.filter((m) => !executedSet.has(m.name));
  }

  /**
   * Get list of executed migrations
   */
  async executed(): Promise<string[]> {
    return this.storage.executed();
  }

  /**
   * Run all pending migrations
   */
  async up(options: { to?: string; step?: number } = {}): Promise<MigrationResult[]> {
    return this.runInOrder(await this.pending(), 'up', options);
  }

  /**
   * Rollback migrations
   */
  async down(options: { to?: string; step?: number } = {}): Promise<MigrationResult[]> {
    const [migrations, executed] = await Promise.all([this.getMigrations(), this.storage.executed()]);

    const executedSet = new Set(executed);
    const executedMigrations = migrations.filter((m) => executedSet.has(m.name)).reverse(); // Rollback in reverse order

    return this.runInOrder(executedMigrations, 'down', options);
  }

  /**
   * Narrow a run list by `to`/`step` and execute it, stopping at the first failure.
   *
   * Both directions do exactly this and differ only in the list they start from: `up` takes the
   * pending migrations, `down` the executed ones reversed. Keeping the selection in one place is what
   * makes `--to` and `--step` mean the same thing whichever way you are going.
   */
  private async runInOrder(
    migrations: Migration[],
    direction: 'up' | 'down',
    options: { to?: string; step?: number },
  ): Promise<MigrationResult[]> {
    let selected = migrations;

    if (options.to) {
      const toIndex = selected.findIndex((m) => m.name === options.to);
      if (toIndex === -1) {
        throw new TypeError(`Migration '${options.to}' not found`);
      }
      selected = selected.slice(0, toIndex + 1);
    }

    if (options.step !== undefined) {
      selected = selected.slice(0, options.step);
    }

    const results: MigrationResult[] = [];
    for (const migration of selected) {
      const result = await this.runMigration(migration, direction);
      results.push(result);
      if (!result.success) {
        break;
      }
    }
    return results;
  }

  /**
   * Run a single migration within a transaction
   */
  public async runMigration(migration: Migration, direction: 'up' | 'down'): Promise<MigrationResult> {
    const startTime = Date.now();

    return withSqlQuerierForMigrations(this.pool, 'Migrator', async (querier) => {
      try {
        this.logger.logMigration(`${direction === 'up' ? 'Running' : 'Reverting'} migration: ${migration.name}`);

        await querier.transaction(async () => {
          if (direction === 'up') {
            await migration.up(querier);
            // Log within the same transaction
            await this.storage.logWithQuerier(querier, migration.name);
          } else {
            await migration.down(querier);
            // Unlog within the same transaction
            await this.storage.unlogWithQuerier(querier, migration.name);
          }
        });

        const duration = Date.now() - startTime;
        this.logger.logMigration(
          `Migration ${migration.name} ${direction === 'up' ? 'applied' : 'reverted'} in ${duration}ms`,
        );

        return {
          name: migration.name,
          direction,
          duration,
          success: true,
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logger.logError(`Migration ${migration.name} failed: ${(error as Error).message}`, error);

        return {
          name: migration.name,
          direction,
          duration,
          success: false,
          error: error as Error,
        };
      }
    });
  }

  /**
   * Generate a new migration file
   */
  async generate(name: string): Promise<string> {
    const timestamp = this.getTimestamp();
    const fileName = `${timestamp}_${this.slugify(name)}.ts`;
    const filePath = join(this.migrationsPath, fileName);

    const content = buildSqlQuerierMigrationModule({
      migrationName: name,
      createdAt: new Date(),
      upInner: EMPTY_MANUAL_MIGRATION_UP_INNER,
      downInner: EMPTY_MANUAL_MIGRATION_DOWN_INNER,
    });

    await mkdir(this.migrationsPath, { recursive: true });
    await writeFile(filePath, content, 'utf-8');

    this.logger.logInfo(`Created migration: ${filePath}`);
    return filePath;
  }

  /**
   * Generate a migration based on entity schema differences
   */
  async generateFromEntities(name: string): Promise<string> {
    const creating: string[] = [];
    const altering: string[] = [];
    const downStatements: string[] = [];

    for (const { diff, entity } of await this.pendingDiffs()) {
      if (diff.type === 'create') {
        if (entity) {
          creating.push(diff.tableName);
          downStatements.push(this.generator.generateDropTable(diff.tableName, { ifExists: true }));
        }
      } else if (diff.type === 'alter') {
        altering.push(...this.generator.generateAlterTable(diff));
        downStatements.push(...this.generator.generateAlterTableDown(diff));
      }
    }

    const upStatements = [...this.createSchema(creating), ...altering];

    if (upStatements.length === 0) {
      this.logger.logInfo('No schema changes detected.');
      return '';
    }

    const timestamp = this.getTimestamp();
    const fileName = `${timestamp}_${this.slugify(name)}.ts`;
    const filePath = join(this.migrationsPath, fileName);

    const down = [...downStatements].reverse();
    const content = buildSqlQuerierMigrationModule({
      migrationName: name,
      createdAt: new Date(),
      docExtraLines: ['Generated from entity definitions'],
      upInner: emitSqlRunCalls(upStatements),
      downInner: emitSqlRunCalls(down),
    });

    await mkdir(this.migrationsPath, { recursive: true });
    await writeFile(filePath, content, 'utf-8');

    this.logger.logInfo(`Created migration from entities: ${filePath}`);
    return filePath;
  }

  /**
   * Get all schema differences between entities and database
   */
  async getDiffs(): Promise<SchemaDiff[]> {
    await this.ensureSchemaGenerator();
    if (!this.schemaGenerator || !this.schemaIntrospector) {
      throw new TypeError('Schema generator and introspector must be set');
    }

    const ast = await this.introspectClaimedSchemas();
    const diffs: SchemaDiff[] = [];

    for (const entity of this.entities) {
      const meta = getMeta(entity);
      const tableName = this.schemaGenerator.resolveTableName(meta);
      const currentTable = ast.getTable(tableName);
      const diff = this.schemaGenerator.diffSchema(entity, currentTable);
      if (diff) {
        diffs.push(diff);
      }
    }

    return diffs;
  }

  /**
   * One AST spanning every schema the entities claim, each table stamped with the schema it was read
   * from. Read per schema rather than all at once, so a table comes back keyed exactly as the entity
   * that wants it spells the key: `undefined` on both sides for the connection's default, a name on
   * both sides otherwise. Ordinarily that is one schema and one pass, as before, and that pass keeps
   * {@link schemaIntrospector} so a caller that replaced it still wins.
   */
  private async introspectClaimedSchemas(): Promise<SchemaAST> {
    const claimed = new Set(this.entities.map((entity) => this.pool.dialect.resolveSchema(getMeta(entity))));
    const merged = new SchemaAST();
    for (const schema of claimed) {
      const introspector = schema === undefined ? this.schemaIntrospector : this.createIntrospector(schema);
      if (!introspector) {
        continue;
      }
      for (const table of (await introspectSchema(introspector)).getTables()) {
        merged.addTable(table);
      }
    }
    return merged;
  }

  public async findEntityForTable(tableName: string): Promise<Type<unknown> | undefined> {
    await this.ensureSchemaGenerator();
    if (!this.schemaGenerator) {
      return undefined;
    }
    for (const entity of this.entities) {
      const meta = getMeta(entity);
      const name = this.schemaGenerator.resolveTableName(meta);
      if (name === tableName) {
        return entity;
      }
    }
    return undefined;
  }

  /**
   * Sync schema directly (for development only - not for production!)
   */
  async sync(options: { force?: boolean } = {}): Promise<void> {
    if (options.force) {
      return this.syncForce();
    }
    return this.autoSync({ safe: true });
  }

  /**
   * Drops and recreates all tables (Development only!)
   */
  public async syncForce(): Promise<void> {
    await this.ensureSchemaGenerator();

    // Both directions span the whole entity set rather than looping an entity at a time. A per-entity
    // AST cannot resolve a cross-entity foreign key, so the old create loop silently produced a schema
    // with no referential integrity; and the old drop loop went in reverse *declaration* order, which
    // says nothing about the relation graph and is rejected as soon as the constraints are really there.
    const statements = [
      ...this.generator.generateDropSchema(this.entities, { ifExists: true, cascade: true }),
      ...this.generator.generateCreateSchema(this.entities),
    ];

    await withSqlQuerierForMigrations(this.pool, 'Migrator', (querier) =>
      querier.transaction(async () => {
        for (const sql of statements) {
          this.logger.logSchema(`Executing: ${sql}`);
          await querier.run(sql);
        }
      }),
    );

    this.logger.logSchema('Schema sync (force) completed');
  }

  /**
   * Safely synchronizes the schema by only adding missing tables and columns.
   */
  async autoSync(options: { safe?: boolean; drop?: boolean; logging?: boolean } = {}): Promise<void> {
    const statements = await this.planSync(options);

    if (statements.length === 0) {
      if (options.logging) this.logger.logSchema('Schema is already in sync.');
      return;
    }

    await this.executeSyncStatements(statements, options);
  }

  /**
   * The DDL {@link autoSync} would run, without running it. Separate so `--dry-run` shows the real
   * statements rather than a summary of a second, differently-computed diff.
   */
  async planSync(options: { safe?: boolean; drop?: boolean } = {}): Promise<string[]> {
    const creating: string[] = [];
    const altering: string[] = [];

    for (const { diff, entity } of await this.pendingDiffs()) {
      if (diff.type === 'create') {
        if (entity) creating.push(diff.tableName);
      } else if (diff.type === 'alter') {
        altering.push(...this.generator.generateAlterTable(this.filterDiff(diff, options)));
      }
    }

    return [...this.createSchema(creating), ...altering];
  }

  /**
   * New tables are emitted together, never one at a time: a single-entity AST has no other table for a
   * relation to resolve against, so every cross-entity foreign key was dropped and generated schemas
   * carried none. Spanning the graph is also what lets a cyclic relation (any `createdBy`
   * back-reference) be created at all.
   *
   * Empty in, empty out, so a diff with no new tables does not build an AST for the whole graph.
   */
  private createSchema(tableNames: readonly string[]): string[] {
    return tableNames.length ? this.generator.generateCreateSchema(this.entities, { only: tableNames }) : [];
  }

  /**
   * Each pending diff with the entity it came from, since resolving that is async and every caller
   * needs it. What to emit stays with the caller: a sync narrows the forward direction to what the
   * caller allows and never asks for the rollback, which on SQLite cannot even be expressed (no
   * `ALTER COLUMN`), so computing it eagerly for everyone would throw there.
   */
  private async pendingDiffs(): Promise<{ diff: SchemaDiff; entity: Type<unknown> | undefined }[]> {
    const diffs = await this.getDiffs();
    return Promise.all(
      diffs.map(async (diff) => ({
        diff,
        entity: diff.type === 'create' ? await this.findEntityForTable(diff.tableName) : undefined,
      })),
    );
  }

  /**
   * The schema generator. A getter because MongoDB's loads lazily (see {@link ensureSchemaGenerator}),
   * so every caller had to repeat the same assertion after awaiting it.
   */
  private get generator(): SchemaGenerator {
    if (!this.schemaGenerator) {
      throw new TypeError('Schema generator not set. Call setSchemaGenerator() first.');
    }
    return this.schemaGenerator;
  }

  protected filterDiff(diff: SchemaDiff, options: { safe?: boolean; drop?: boolean }): SchemaDiff {
    const filteredDiff = { ...diff } as { -readonly [K in keyof SchemaDiff]: SchemaDiff[K] };
    if (options.safe !== false) {
      // In safe mode, we only allow additions (creating tables/columns)
      // We block drops and alterations to prevent accidental data loss

      if (filteredDiff.columnsToDrop?.length) {
        this.logger.logSkippedMigration(
          `[AutoSync] Skipped dropping ${filteredDiff.columnsToDrop.length} columns in table '${diff.tableName}': ${filteredDiff.columnsToDrop.join(', ')} (safe mode active)`,
        );
        delete filteredDiff.columnsToDrop;
      }

      if (filteredDiff.columnsToAlter?.length) {
        this.logger.logSkippedMigration(
          `[AutoSync] Skipped altering ${filteredDiff.columnsToAlter.length} columns in table '${diff.tableName}': ${filteredDiff.columnsToAlter.map((c) => c.to.name).join(', ')} (safe mode active). Use a migration or { safe: false } to apply.`,
        );
        delete filteredDiff.columnsToAlter;
      }

      delete filteredDiff.indexesToDrop;
      delete filteredDiff.foreignKeysToDrop;
    }

    if (!options.drop && filteredDiff.columnsToDrop?.length) {
      this.logger.logSkippedMigration(
        `[AutoSync] Skipped dropping ${filteredDiff.columnsToDrop.length} columns in table '${diff.tableName}' (drop: false). Use { drop: true } to apply.`,
      );
      delete filteredDiff.columnsToDrop;
    }

    return filteredDiff;
  }

  public async executeSyncStatements(statements: string[], options: { logging?: boolean }): Promise<void> {
    // Mongo creates collections and indexes outside any transaction, so only the SQL path opens one.
    await withQuerierForMigrations(this.pool, (querier) =>
      this.dialectName === 'mongodb'
        ? this.executeMongoSyncStatements(statements, options, querier as MongoQuerier)
        : querier.transaction(() => this.executeSqlSyncStatements(statements, options, querier)),
    );
    if (options.logging) this.logger.logSchema('Schema synchronization completed');
  }

  public async executeMongoSyncStatements(
    statements: string[],
    options: { logging?: boolean },
    querier: MongoQuerier,
  ): Promise<void> {
    for (const statement of statements) {
      if (options.logging) this.logger.logSchema(`Executing MongoDB: ${statement}`);
      await runMongoCommand(querier.db, statement);
    }
  }

  public async executeSqlSyncStatements(
    statements: string[],
    options: { logging?: boolean },
    querier: Querier,
  ): Promise<void> {
    if (!isSqlQuerier(querier)) {
      throw new TypeError('Migrator requires a SQL-based querier for this dialect');
    }
    for (const sql of statements) {
      if (options.logging) this.logger.logSchema(`Executing: ${sql}`);
      await querier.run(sql);
    }
  }

  /**
   * Get migration status
   */
  async status(): Promise<{ pending: string[]; executed: string[] }> {
    const [pending, executed] = await Promise.all([this.pending().then((m) => m.map((x) => x.name)), this.executed()]);

    return { pending, executed };
  }

  /**
   * Get migration files from the migrations directory
   */
  public async getMigrationFiles(): Promise<string[]> {
    try {
      const files = await readdir(this.migrationsPath);
      return files
        .filter((f) => /\.(ts|js|mjs)$/.test(f))
        .filter((f) => !f.endsWith('.d.ts'))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Load a migration from a file
   */
  public async loadMigration(fileName: string): Promise<Migration | undefined> {
    const filePath = join(this.migrationsPath, fileName);
    const fileUrl = pathToFileURL(filePath).href;

    try {
      const module = await import(fileUrl);
      const migration = module.default ?? module;

      if (this.isMigration(migration)) {
        return {
          name: this.getMigrationName(fileName),
          up: migration.up.bind(migration),
          down: migration.down.bind(migration),
        };
      }

      this.logger.logWarn(`Warning: ${fileName} is not a valid migration`);
      return undefined;
    } catch (error) {
      this.logger.logError(`Error loading migration ${fileName}: ${(error as Error).message}`, error);
      return undefined;
    }
  }

  /**
   * Check if an object is a valid migration
   */
  public isMigration(obj: unknown): obj is MigrationDefinition {
    return (
      typeof obj === 'object' &&
      obj !== undefined &&
      obj !== null &&
      typeof (obj as MigrationDefinition).up === 'function' &&
      typeof (obj as MigrationDefinition).down === 'function'
    );
  }

  /**
   * Extract migration name from filename
   */
  public getMigrationName(fileName: string): string {
    return basename(fileName, extname(fileName));
  }

  /**
   * Generate timestamp string for migration names
   */
  protected getTimestamp(): string {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
  }

  /**
   * Convert a string to a slug for filenames
   */
  protected slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
}

/**
 * Helper function to define a migration with proper typing
 */
export function defineMigration(migration: MigrationDefinition): MigrationDefinition {
  return migration;
}

/**
 * Migration definition that uses the type-safe builder API.
 */
export interface BuilderMigrationDefinition {
  readonly name?: string;
  readonly up: (builder: IMigrationBuilder) => Promise<void>;
  readonly down: (builder: IMigrationBuilder) => Promise<void>;
}

/**
 * Define a migration using the type-safe builder API.
 *
 * @example
 * ```ts
 * export default defineBuilderMigration({
 *   async up(m) {
 *     await m.createTable('users', (t) => {
 *       t.id();
 *       t.string('email', { length: 255 }).unique();
 *       t.timestamps();
 *     });
 *   },
 *   async down(m) {
 *     await m.dropTable('users');
 *   }
 * });
 * ```
 */
export function defineBuilderMigration(migration: BuilderMigrationDefinition): BuilderMigrationDefinition {
  return migration;
}
