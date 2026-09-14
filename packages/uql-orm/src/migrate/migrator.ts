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
  public readonly dialectName: DialectName;
  /** The generator given, or this dialect's once {@link getSchemaGenerator} has loaded it. */
  public schemaGenerator?: SchemaGenerator;
  public schemaIntrospector?: SchemaIntrospector;
  private readonly defaultForeignKeyAction?: ForeignKeyAction;
  private readonly target: MigrationTarget;

  constructor(
    private readonly pool: QuerierPool<Querier, MigratorDialect>,
    options: MigratorOptions = {},
  ) {
    this.dialectName = pool.dialect.dialectName;
    this.target = migrationTargetFor(pool.dialect);
    this.defaultForeignKeyAction = options.defaultForeignKeyAction;
    this.storage = options.storage ?? this.target.storage(pool, options.tableName);
    this.migrationsPath = options.migrationsPath ?? './migrations';
    this._logger = new LoggerWrapper(options.logger!, { logValues: options.logValues, slowQuery: options.slowQuery });
    this._entities = options.entities;
    this.schemaIntrospector = this.createIntrospector();
    this.schemaGenerator = options.schemaGenerator;
  }

  /** The schema generator, loaded on first use: MongoDB's needs its optional peer. */
  async getSchemaGenerator(): Promise<SchemaGenerator> {
    this.schemaGenerator ??= await this.target.generator(this.pool.dialect, this.defaultForeignKeyAction);
    if (!this.schemaGenerator) {
      throw new TypeError(`No schema generator for dialect '${this.dialectName}'`);
    }
    return this.schemaGenerator;
  }

  /** `schema` reads one namespace instead of the connection's own; see {@link BaseSqlIntrospector.schema}. */
  protected createIntrospector(schema?: string): SchemaIntrospector | undefined {
    return introspectorFor(this.dialectName, this.pool, schema);
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

    return this.target.withSession(this.pool, async ({ querier, transaction }) => {
      try {
        this.logger.logMigration(`${direction === 'up' ? 'Running' : 'Reverting'} migration: ${migration.name}`);

        await transaction(async () => {
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
    if (!this.schemaIntrospector) {
      throw new TypeError(`No introspector for dialect '${this.dialectName}'`);
    }

    const ast = await this.introspectClaimedSchemas();
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
    const introspector = this.introspectorFor(this.pool.dialect.resolveSchema(meta));
    if (!introspector) {
      throw new TypeError(`No introspector for '${meta.entity.name}' on '${this.dialectName}'`);
    }
    const tableName = generator.resolveTableName(meta);

    return (await introspector.tableExists(tableName))
      ? this.alterFromEntity(generator, entity, (await introspectSchema(introspector)).getTable(tableName), options)
      : // Spanning the whole set, so a foreign key resolves against the tables it points at, and
        // always including this entity: pinned to an explicit `entities` list, a sync of one outside
        // it emitted nothing at all. `only` is what keeps the statements to this table.
        generator.generateCreateSchema(this.entitiesWith(entity), { only: [tableName], ifNotExists: true });
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
  private introspectorFor(schema: string | undefined): SchemaIntrospector | undefined {
    return schema === undefined ? this.schemaIntrospector : this.createIntrospector(schema);
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

  /**
   * New tables are emitted together, never one at a time: a single-entity AST has no other table for a
   * relation to resolve against, so every cross-entity foreign key was dropped and generated schemas
   * carried none. Spanning the graph is also what lets a cyclic relation (any `createdBy`
   * back-reference) be created at all.
   *
   * Empty in, empty out, so a diff with no new tables does not build an AST for the whole graph.
   */
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

  /** Runs the statements a generator wrote, in one transaction where the engine takes DDL in one. */
  public async executeSyncStatements(statements: string[], options: { logging?: boolean }): Promise<void> {
    await this.target.withSession(this.pool, ({ run, transaction }) =>
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
export function defineBuilderMigration<Q extends Querier = SqlQuerier>(
  migration: BuilderMigrationDefinition<Q>,
): MigrationDefinition<Q> {
  return {
    ...migration,
    up: async (querier) => migration.up(await migrationBuilderFor(querier), querier),
    down: async (querier) => migration.down(await migrationBuilderFor(querier), querier),
  };
}
