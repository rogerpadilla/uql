import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getEntities, getMeta } from '../entity/index.js';
import { SchemaAST } from '../schema/index.js';
import type { TableNode } from '../schema/types.js';
import type {
  EntityMeta,
  LoggingOptions,
  Migration,
  MigrationDefinition,
  MigrationResult,
  MigrationStorage,
  MigratorDialect,
  MigratorOptions,
  Querier,
  QuerierPool,
  SchemaDiff,
  SchemaGenerator,
  SchemaIntrospector,
  SqlQuerier,
  SyncOptions,
  Type,
} from '../type/index.js';
import { LoggerWrapper } from '../util/index.js';
import type { IMigrationBuilder } from './builder/types.js';
import { buildMigrationModule, type MigrationModuleOptions } from './codegen/migrationFile.js';
import { introspectorFor } from './introspection/registry.js';
import { type MigrationTarget, migrationBuilderFor, migrationTargetFor } from './migrationTarget.js';

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
  /** The generator given, or this dialect's once {@link getSchemaGenerator} has loaded it. */
  public schemaGenerator?: SchemaGenerator;
  public schemaIntrospector: SchemaIntrospector;
  private readonly target: MigrationTarget;

  constructor(
    private readonly pool: QuerierPool<Querier, MigratorDialect>,
    options: MigratorOptions = {},
  ) {
    this.target = migrationTargetFor(pool, options.defaultForeignKeyAction);
    this.storage = options.storage ?? this.target.storage(options.tableName);
    this.migrationsPath = options.migrationsPath ?? './migrations';
    this._logger = new LoggerWrapper(options.logger!, { logValues: options.logValues, slowQuery: options.slowQuery });
    this._entities = options.entities;
    this.schemaIntrospector = introspectorFor(pool);
    this.schemaGenerator = options.schemaGenerator;
  }

  /** The schema generator, loaded on first use: MongoDB's needs its optional peer. */
  async getSchemaGenerator(): Promise<SchemaGenerator> {
    this.schemaGenerator ??= await this.target.generator();
    return this.schemaGenerator;
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

  /** Runs the list narrowed by `to`/`step`, stopping at the first failure: `up` over the pending, `down` over the executed reversed. */
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
   * Run a single migration, in a transaction where the dialect has one for it and the migration has not
   * declared `transaction: false` - the opt-out a statement an engine refuses inside one needs.
   */
  public async runMigration(migration: Migration<Querier>, direction: 'up' | 'down'): Promise<MigrationResult> {
    const startTime = Date.now();

    return this.target.withSession(async ({ querier, transaction }) => {
      try {
        this.logger.logMigration(`${direction === 'up' ? 'Running' : 'Reverting'} migration: ${migration.name}`);

        const work = async () => {
          if (direction === 'up') {
            await migration.up(querier);
            await this.storage.logWithQuerier(querier, migration.name);
          } else {
            await migration.down(querier);
            await this.storage.unlogWithQuerier(querier, migration.name);
          }
        };
        await (migration.transaction === false ? work() : transaction(work));

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
    const { emptyUp, emptyDown } = this.target.source;
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
      querier: this.target.source.querier,
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
    const generator = await this.getSchemaGenerator();
    const { created, altered } = await this.pendingChanges();
    const up = [
      ...this.createSchema(generator, created),
      ...altered.flatMap((diff) => generator.generateAlterTable(diff)),
    ];

    if (up.length === 0) {
      this.logger.logInfo('No schema changes detected.');
      return '';
    }

    const down = [
      ...created.map((tableName) => generator.generateDropTable(tableName, { ifExists: true })),
      ...altered.flatMap((diff) => generator.generateAlterTableDown(diff)),
    ];
    const { emit } = this.target.source;
    const filePath = await this.writeMigration(name, {
      docExtraLines: ['Generated from entity definitions'],
      upInner: emit(up),
      downInner: emit(down.reverse()),
    });
    this.logger.logInfo(`Created migration from entities: ${filePath}`);
    return filePath;
  }

  /**
   * Get all schema differences between entities and database
   */
  async getDiffs(): Promise<SchemaDiff[]> {
    const generator = await this.getSchemaGenerator();
    const ast = await this.introspectEntities(this.entities);
    // Both sides built once: the database's above, the entities' here. Left to `diffSchema`, each
    // entity would rebuild the whole AST, which is quadratic in the number of entities. Absent on a
    // generator that compares no schema of its own - MongoDB, which reads only indexes.
    const desiredAst = generator.buildAST?.(this.entities);
    return this.entities.flatMap((entity) => {
      const table = ast.getTable(generator.resolveTableName(getMeta(entity)));
      const diff = generator.diffSchema(entity, table, desiredAst);
      return diff ? [diff] : [];
    });
  }

  /**
   * The tables `entities` name, read a schema at a time so each is keyed as its entity spells it. Those
   * alone: nothing else is diffed, and another table can be dropped mid-scan by whatever else is running.
   */
  private async introspectEntities(entities: readonly Type<object>[]): Promise<SchemaAST> {
    const { dialect } = this.pool;
    const bySchema = Map.groupBy(new Set(entities), (entity) => dialect.resolveSchema(getMeta(entity)));
    const merged = new SchemaAST();
    for (const [schema, members] of bySchema) {
      const tables = members.map((entity) => dialect.resolveTableAlias(getMeta(entity)));
      for (const table of (await this.schemaIntrospectorFor(schema).introspect(tables)).getTables()) {
        merged.addTable(table);
      }
    }
    return merged;
  }

  /** Applies the entity schema: every entity, or the one `entity` names. {@link planSync} answers the same without running it. */
  async sync(options: SyncOptions = {}): Promise<void> {
    const statements = await this.planSync(options);
    if (statements.length) {
      await this.executeSyncStatements(statements, options);
    } else if (options.logging) {
      this.logger.logSchema('Schema is already in sync.');
    }
  }

  /** Every table dropped and recreated, the whole entity set at once, so foreign keys resolve and drop in graph order. */
  private forceStatements(generator: SchemaGenerator): string[] {
    return [
      ...generator.generateDropSchema(this.entities, { ifExists: true, cascade: true }),
      ...generator.generateCreateSchema(this.entities),
    ];
  }

  /**
   * The DDL for one entity: {@link planSync} narrowed to the table it names. A new table costs one
   * existence check and is created with `IF NOT EXISTS`, so instances racing the same admin save
   * settle instead of colliding; an existing one still pays for introspection, as a diff needs columns.
   */
  private async planEntity(generator: SchemaGenerator, entity: Type<object>, options: SyncOptions): Promise<string[]> {
    const meta = getMeta(entity);
    const { dialect } = this.pool;
    const introspector = this.schemaIntrospectorFor(dialect.resolveSchema(meta));
    const tableName = generator.resolveTableName(meta);

    if (!(await introspector.tableExists(dialect.resolveTableAlias(meta)))) {
      // Spanning the whole set, so a foreign key resolves against the tables it points at, and always
      // including this entity: `only` is what keeps the statements to this table.
      return generator.generateCreateSchema(this.entitiesWith(entity), { only: [tableName], ifNotExists: true });
    }
    // With the tables it references, which its foreign keys resolve against.
    const ast = await this.introspectEntities([entity, ...referencedEntities(meta)]);
    return this.alterFromEntity(generator, entity, ast.getTable(tableName), options);
  }

  /** The same for one entity against the table it already has, and nothing where the two agree. */
  private alterFromEntity(
    generator: SchemaGenerator,
    entity: Type<object>,
    table: TableNode | undefined,
    options: SyncOptions,
  ): string[] {
    // Spanning the set for the reason `planEntity` spells out: a foreign key needs the table it
    // points at, which a sync of one entity outside the configured list would not otherwise have.
    const diff = generator.diffSchema(entity, table, generator.buildAST?.(this.entitiesWith(entity)));
    return diff?.type === 'alter' ? generator.generateAlterTable(this.filterDiff(diff, options)) : [];
  }

  /** The configured entities, with `entity` among them however the migrator was built. */
  private entitiesWith(entity: Type<object>): Type<object>[] {
    const entities = this.entities;
    return entities.includes(entity) ? entities : [...entities, entity];
  }

  /** The introspector for a claimed schema, which is the connection's own where none is claimed. */
  private schemaIntrospectorFor(schema: string | undefined): SchemaIntrospector {
    return schema === undefined ? this.schemaIntrospector : introspectorFor(this.pool, schema);
  }

  /**
   * The DDL {@link sync} would run, without running it. Separate so `--dry-run` shows the real
   * statements rather than a summary of a second, differently-computed diff.
   */
  async planSync(options: SyncOptions = {}): Promise<string[]> {
    const generator = await this.getSchemaGenerator();
    if (options.force) {
      return this.forceStatements(generator);
    }
    if (options.entity) {
      return this.planEntity(generator, options.entity, options);
    }
    const { created, altered } = await this.pendingChanges();
    return [
      ...this.createSchema(generator, created),
      ...altered.flatMap((diff) => generator.generateAlterTable(this.filterDiff(diff, options))),
    ];
  }

  /** The new tables, created together so a foreign key between them, cyclic included, resolves. Empty in, empty out. */
  private createSchema(generator: SchemaGenerator, tableNames: readonly string[]): string[] {
    return tableNames.length ? generator.generateCreateSchema(this.entities, { only: tableNames }) : [];
  }

  /**
   * The pending diffs a sync or a generated migration acts on: the tables to create and the tables to
   * alter. What to emit for each stays with the caller: a sync narrows an alter to what it allows and
   * never asks for the rollback, which on SQLite cannot even be expressed (no `ALTER COLUMN`).
   */
  private async pendingChanges(): Promise<{ created: string[]; altered: SchemaDiff[] }> {
    const diffs = await this.getDiffs();
    return {
      created: diffs.filter((diff) => diff.type === 'create').map((diff) => diff.tableName),
      altered: diffs.filter((diff) => diff.type === 'alter'),
    };
  }

  protected filterDiff(diff: SchemaDiff, options: { safe?: boolean; drop?: boolean }): SchemaDiff {
    const filteredDiff: { -readonly [K in keyof SchemaDiff]: SchemaDiff[K] } = { ...diff };
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

  /** Runs the statements a generator wrote, in one transaction where the engine takes DDL in one. */
  public async executeSyncStatements(statements: string[], options: { logging?: boolean }): Promise<void> {
    await this.target.withSession(({ run, transaction }) =>
      transaction(async () => {
        for (const statement of statements) {
          if (options.logging) this.logger.logSchema(`Executing: ${statement}`);
          await run(statement);
        }
      }),
    );
    if (options.logging) this.logger.logSchema('Schema synchronization completed');
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
 * data backfill it runs lands in the same transaction as the schema change. On MongoDB, `Q` is
 * `MongoQuerier` and the builder takes collections and their indexes.
 */
export interface BuilderMigrationDefinition<Q extends Querier = SqlQuerier> {
  readonly name?: string;
  up(builder: IMigrationBuilder, querier: Q): Promise<void>;
  down(builder: IMigrationBuilder, querier: Q): Promise<void>;
}

/**
 * Defines a migration with the builder:
 * `defineBuilderMigration({ up: (m) => m.createTable('users', (t) => t.id()), down: (m) => m.dropTable('users') })`.
 */
export function defineBuilderMigration<Q extends Querier = SqlQuerier>(
  migration: BuilderMigrationDefinition<Q>,
): MigrationDefinition<Q> {
  return {
    ...migration,
    up: async (querier) => migration.up(await migrationBuilderFor(querier), querier),
    down: async (querier) => migration.down(await migrationBuilderFor(querier), querier),
  };
}

/** The entities `meta` points at, through a relation or a foreign key field. */
function referencedEntities(meta: EntityMeta<object>): Type<object>[] {
  const fields = Object.values(meta.fields).flatMap((field) => field?.references?.() ?? []);
  const relations = Object.values(meta.relations).flatMap((relation) => relation?.entity?.() ?? []);
  return [...fields, ...relations];
}
