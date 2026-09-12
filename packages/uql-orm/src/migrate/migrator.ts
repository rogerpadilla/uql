import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getEntities, getMeta } from '../entity/index.js';
import { introspectSchema, SchemaAST } from '../schema/index.js';
import type { ForeignKeyAction, TableNode } from '../schema/types.js';
import type {
  DialectName,
  LoggingOptions,
  Migration,
  MigrationDefinition,
  MigrationResult,
  MigrationStorage,
  MigratorDialect,
  MigratorOptions,
  MongoQuerier,
  Querier,
  QuerierPool,
  SchemaDiff,
  SchemaGenerator,
  SchemaIntrospector,
  SqlQuerier,
  SyncOptions,
  Type,
} from '../type/index.js';
import { isKnownMigratorDialect, isMongoQuerier, isSqlQuerier } from '../type/index.js';
import { LoggerWrapper } from '../util/index.js';
import { withMongoQuerierForMigrations, withSqlQuerierForMigrations } from './acquireQuerierForMigrations.js';
import { MigrationBuilder } from './builder/migrationBuilder.js';
import type { IMigrationBuilder } from './builder/types.js';
import {
  buildMigrationModule,
  type MigrationModuleOptions,
  type MigrationQuerierType,
  migrationSource,
} from './codegen/migrationFile.js';
import { runMongoCommand } from './generator/mongoCommand.js';
import { introspectorFor } from './introspection/registry.js';
import { createSchemaGenerator } from './schemaGenerator.js';
import { DatabaseMigrationStorage } from './storage/databaseStorage.js';
import { MongoMigrationStorage } from './storage/mongoStorage.js';

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
  private readonly _entities?: Type<object>[];

  public get entities(): Type<object>[] {
    return this._entities ?? getEntities();
  }
  public readonly dialectName: DialectName;
  public schemaGenerator?: SchemaGenerator;
  public schemaIntrospector?: SchemaIntrospector;
  private readonly _defaultForeignKeyAction?: ForeignKeyAction;
  private _mongoSchemaLoadPromise?: Promise<void>;

  constructor(
    private readonly pool: QuerierPool<Querier, MigratorDialect>,
    options: MigratorOptions = {},
  ) {
    this.dialectName = pool.dialect.dialectName;
    this._defaultForeignKeyAction = options.defaultForeignKeyAction;
    this.storage =
      options.storage ??
      (this.dialectName === 'mongodb'
        ? new MongoMigrationStorage(pool, { tableName: options.tableName })
        : new DatabaseMigrationStorage(pool, { tableName: options.tableName }));
    this.migrationsPath = options.migrationsPath ?? './migrations';
    this._logger = new LoggerWrapper(options.logger!, { logValues: options.logValues, slowQuery: options.slowQuery });
    this._entities = options.entities;
    this.schemaIntrospector = this.createIntrospector();
    this.schemaGenerator =
      options.schemaGenerator ?? (this.dialectName === 'mongodb' ? undefined : this.createGenerator());
  }

  /**
   * Loads MongoDB's schema generator on first use, so the optional `mongodb` peer loads only then. SQL
   * generators are set in the constructor (or via {@link setSchemaGenerator}).
   */
  async ensureSchemaGenerator(): Promise<void> {
    if (this.schemaGenerator || this.dialectName !== 'mongodb') {
      return;
    }
    this._mongoSchemaLoadPromise ??= import('./generator/mongoSchemaGenerator.js').then(({ MongoSchemaGenerator }) => {
      this.schemaGenerator = new MongoSchemaGenerator(this.pool.dialect.namingStrategy, this._defaultForeignKeyAction);
    });
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
    return introspectorFor(this.dialectName, this.pool, schema);
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
  async getMigrations(): Promise<Migration<Querier>[]> {
    const files = await this.getMigrationFiles();
    const migrations: Migration<Querier>[] = [];

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
  async pending(): Promise<Migration<Querier>[]> {
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
    migrations: Migration<Querier>[],
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
   * Run a single migration, within a transaction where the dialect has one for it
   */
  public async runMigration(migration: Migration<Querier>, direction: 'up' | 'down'): Promise<MigrationResult> {
    const startTime = Date.now();

    return this.withMigrationQuerier(async (querier, inTransaction) => {
      try {
        this.logger.logMigration(`${direction === 'up' ? 'Running' : 'Reverting'} migration: ${migration.name}`);

        await inTransaction(async () => {
          if (direction === 'up') {
            await migration.up(querier);
            await this.storage.logWithQuerier(querier, migration.name);
          } else {
            await migration.down(querier);
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
   * A migration querier, and how to run work in one transaction on it. MongoDB gets none: it creates
   * collections and indexes outside any transaction. SQL asserts its querier before opening one, so a
   * wrong querier reports which one the dialect needs rather than a missing `transaction`.
   */
  private withMigrationQuerier<T>(
    task: (querier: Querier, inTransaction: (work: () => Promise<void>) => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return this.dialectName === 'mongodb'
      ? withMongoQuerierForMigrations(this.pool, 'Migrator', (querier) => task(querier, (work) => work()))
      : withSqlQuerierForMigrations(this.pool, 'Migrator', (querier) =>
          task(querier, (work) => querier.transaction(work)),
        );
  }

  /** What this dialect's migration files are written against. */
  private get migrationQuerier(): MigrationQuerierType {
    return this.dialectName === 'mongodb' ? 'MongoQuerier' : 'SqlQuerier';
  }

  /**
   * Generate a new migration file
   */
  async generate(name: string): Promise<string> {
    const { emptyUp, emptyDown } = migrationSource[this.migrationQuerier];
    const filePath = await this.writeMigration(name, { upInner: emptyUp, downInner: emptyDown });
    this.logger.logInfo(`Created migration: ${filePath}`);
    return filePath;
  }

  /** Writes a migration module on this dialect's querier to a new timestamped file, and returns its path. */
  private async writeMigration(
    name: string,
    body: Pick<MigrationModuleOptions, 'upInner' | 'downInner' | 'docExtraLines'>,
  ): Promise<string> {
    const filePath = join(this.migrationsPath, `${this.getTimestamp()}_${this.slugify(name)}.ts`);
    const content = buildMigrationModule({
      migrationName: name,
      createdAt: new Date(),
      querier: this.migrationQuerier,
      ...body,
    });
    await mkdir(this.migrationsPath, { recursive: true });
    await writeFile(filePath, content, 'utf-8');
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

    const { emit } = migrationSource[this.migrationQuerier];
    const filePath = await this.writeMigration(name, {
      docExtraLines: ['Generated from entity definitions'],
      upInner: emit(upStatements),
      downInner: emit([...downStatements].reverse()),
    });
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
    // Both sides built once: the database's above, the entities' here. Left to `diffSchema`, each
    // entity would rebuild the whole AST, which is quadratic in the number of entities. Absent on a
    // generator that compares no schema of its own - MongoDB, which reads only indexes.
    const desiredAst = this.schemaGenerator.buildAST?.(this.entities);
    const diffs: SchemaDiff[] = [];

    for (const entity of this.entities) {
      const meta = getMeta(entity);
      const tableName = this.schemaGenerator.resolveTableName(meta);
      const currentTable = ast.getTable(tableName);
      const diff = this.schemaGenerator.diffSchema(entity, currentTable, desiredAst);
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
      const introspector = this.introspectorFor(schema);
      if (!introspector) {
        continue;
      }
      for (const table of (await introspectSchema(introspector)).getTables()) {
        merged.addTable(table);
      }
    }
    return merged;
  }

  public async findEntityForTable(tableName: string): Promise<Type<object> | undefined> {
    await this.ensureSchemaGenerator();
    for (const entity of this.entities) {
      const meta = getMeta(entity);
      const name = this.generator.resolveTableName(meta);
      if (name === tableName) {
        return entity;
      }
    }
    return undefined;
  }

  /**
   * Applies the entity schema to the database: every registered entity, or the one `entity` names.
   *
   * The whole surface is this and {@link planSync}, which answers the same question without running
   * it - `force` and a single entity included, so `--dry-run` means the same thing whatever else was
   * asked for.
   */
  async sync(options: SyncOptions = {}): Promise<void> {
    const statements = await this.planSync(options);
    if (statements.length) {
      await this.executeSyncStatements(statements, options);
    } else if (options.logging) {
      this.logger.logSchema('Schema is already in sync.');
    }
  }

  /**
   * Every table dropped and recreated.
   *
   * Both directions span the whole entity set rather than looping an entity at a time. A per-entity
   * AST cannot resolve a cross-entity foreign key, so the old create loop silently produced a schema
   * with no referential integrity; and the old drop loop went in reverse *declaration* order, which
   * says nothing about the relation graph and is rejected as soon as the constraints are really there.
   */
  private forceStatements(): string[] {
    return [
      ...this.generator.generateDropSchema(this.entities, { ifExists: true, cascade: true }),
      ...this.generator.generateCreateSchema(this.entities),
    ];
  }

  /**
   * The DDL for one entity: {@link planSync} narrowed to the table it names. A new table costs one
   * existence check and is created with `IF NOT EXISTS`, so instances racing the same admin save
   * settle instead of colliding; an existing one still pays for introspection, as a diff needs columns.
   */
  private async planEntity(entity: Type<object>, options: SyncOptions): Promise<string[]> {
    const meta = getMeta(entity);
    // Before anything reads `this.generator`, whose own failure names neither the entity nor the
    // dialect that has no support.
    const introspector = this.introspectorFor(this.pool.dialect.resolveSchema(meta));
    if (!introspector) {
      throw new TypeError(`No introspector for '${meta.entity.name}' on '${this.dialectName}'`);
    }
    const tableName = this.generator.resolveTableName(meta);

    return (await introspector.tableExists(tableName))
      ? this.alterFromEntity(entity, (await introspectSchema(introspector)).getTable(tableName), options)
      : // Spanning the whole set, so a foreign key resolves against the tables it points at, and
        // always including this entity: pinned to an explicit `entities` list, a sync of one outside
        // it emitted nothing at all. `only` is what keeps the statements to this table.
        this.generator.generateCreateSchema(this.entitiesWith(entity), { only: [tableName], ifNotExists: true });
  }

  /** An alter diff as statements, narrowed to what the caller allows. */
  private alterFromDiff(diff: SchemaDiff, options: SyncOptions): string[] {
    return this.generator.generateAlterTable(this.filterDiff(diff, options));
  }

  /** The same for one entity against the table it already has, and nothing where the two agree. */
  private alterFromEntity(entity: Type<object>, table: TableNode | undefined, options: SyncOptions): string[] {
    // Spanning the set for the reason `planEntity` spells out: a foreign key needs the table it
    // points at, which a sync of one entity outside the configured list would not otherwise have.
    const diff = this.generator.diffSchema(entity, table, this.generator.buildAST?.(this.entitiesWith(entity)));
    return diff?.type === 'alter' ? this.alterFromDiff(diff, options) : [];
  }

  /** The configured entities, with `entity` among them however the migrator was built. */
  private entitiesWith(entity: Type<object>): Type<object>[] {
    const entities = this.entities;
    return entities.includes(entity) ? entities : [...entities, entity];
  }

  /** The introspector for a claimed schema, which is the connection's own where none is claimed. */
  private introspectorFor(schema: string | undefined): SchemaIntrospector | undefined {
    return schema === undefined ? this.schemaIntrospector : this.createIntrospector(schema);
  }

  /**
   * The DDL {@link sync} would run, without running it. Separate so `--dry-run` shows the real
   * statements rather than a summary of a second, differently-computed diff.
   */
  async planSync(options: SyncOptions = {}): Promise<string[]> {
    await this.ensureSchemaGenerator();
    if (options.force) {
      return this.forceStatements();
    }
    if (options.entity) {
      return this.planEntity(options.entity, options);
    }

    const creating: string[] = [];
    const altering: string[] = [];

    for (const { diff, entity } of await this.pendingDiffs()) {
      if (diff.type === 'create') {
        if (entity) creating.push(diff.tableName);
      } else if (diff.type === 'alter') {
        altering.push(...this.alterFromDiff(diff, options));
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
  private async pendingDiffs(): Promise<{ diff: SchemaDiff; entity: Type<object> | undefined }[]> {
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

      if (filteredDiff.primaryKey) {
        // Rewriting a key drops a constraint and rebuilds an index over the whole table, and fails
        // outright where the new columns are null on rows that already exist. Firmly not additive.
        this.logger.logSkippedMigration(
          `[AutoSync] Skipped changing the primary key of '${diff.tableName}' from (${filteredDiff.primaryKey.from.join(', ')}) to (${filteredDiff.primaryKey.to.join(', ')}) (safe mode active). Use a migration or { safe: false } to apply.`,
        );
        delete filteredDiff.primaryKey;
      }

      if (filteredDiff.foreignKeysToAlter?.length) {
        // Altering one is dropping it and adding it back, so letting the add through while the drop
        // is held would emit `ADD CONSTRAINT` for a constraint the table still has.
        this.logger.logSkippedMigration(
          `[AutoSync] Skipped altering ${filteredDiff.foreignKeysToAlter.length} foreign keys in table '${diff.tableName}': ${filteredDiff.foreignKeysToAlter.map((fk) => fk.to.name).join(', ')} (safe mode active). Use a migration or { safe: false } to apply.`,
        );
        delete filteredDiff.foreignKeysToAlter;
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
    await this.withMigrationQuerier((querier, inTransaction) =>
      inTransaction(() =>
        isMongoQuerier(querier)
          ? this.executeMongoSyncStatements(statements, options, querier)
          : this.executeSqlSyncStatements(statements, options, querier),
      ),
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
  public async loadMigration(fileName: string): Promise<Migration<Querier> | undefined> {
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
  public isMigration(obj: unknown): obj is MigrationDefinition<Querier> {
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
export function defineMigration<Q extends Querier = SqlQuerier>(
  migration: MigrationDefinition<Q>,
): MigrationDefinition<Q> {
  return migration;
}

/**
 * Migration definition that uses the type-safe builder API. The querier is the builder's own, so a
 * data backfill it runs lands in the same transaction as the schema change.
 */
export interface BuilderMigrationDefinition {
  readonly name?: string;
  up(builder: IMigrationBuilder, querier: SqlQuerier): Promise<void>;
  down(builder: IMigrationBuilder, querier: SqlQuerier): Promise<void>;
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
export function defineBuilderMigration(migration: BuilderMigrationDefinition): MigrationDefinition {
  return {
    ...migration,
    up: (querier) => migration.up(new MigrationBuilder(querier), querier),
    down: (querier) => migration.down(new MigrationBuilder(querier), querier),
  };
}
