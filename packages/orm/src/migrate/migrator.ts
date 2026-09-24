import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getEntities, getMeta } from '../entity/index.js';
import { SchemaAST } from '../schema/index.js';
import type { TableNode } from '../schema/types.js';
import type {
  Change,
  EntityMeta,
  InstalledTriggers,
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
import { hasTriggers } from '../util/field.util.js';
import { LoggerWrapper } from '../util/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import type { IMigrationBuilder } from './builder/types.js';
import { buildMigrationModule, type MigrationModuleOptions } from './codegen/migrationFile.js';
import { introspectorFor } from './introspection/registry.js';
import { type MigrationTarget, migrationBuilderFor, migrationTargetFor } from './migrationTarget.js';
import { dropped, nonEmpty, reverseDiff, sides } from './schemaChange.js';

/** An entity with triggers, beside the ones uql has installed on its table right now. */
type TriggerState = { readonly entity: Type<object>; readonly installed: InstalledTriggers };

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
        throw new UqlUsageError(`Migration '${options.to}' not found`);
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
    const plan = this.alterPlan(generator, altered, await this.installedTriggers(created));
    const up = [...this.createSchema(generator, created), ...plan.up];

    if (up.length === 0) {
      this.logger.logInfo('No schema changes detected.');
      return '';
    }

    // Diff by diff in reverse, each rolled back in the order its generator wrote it.
    const down = [
      ...plan.down(),
      // A table's drop takes its triggers along, but not the function the Postgres family keeps each body in.
      ...this.createdEntities(created).flatMap((entity) => generator.generateTriggersDown(entity)),
      ...created.toReversed().map((tableName) => generator.generateDropTable(tableName, { ifExists: true })),
    ];
    const { emit } = this.target.source;
    const filePath = await this.writeMigration(name, {
      docExtraLines: ['Generated from entity definitions'],
      upInner: emit(up),
      downInner: emit(down),
    });
    this.logger.logInfo(`Created migration from entities: ${filePath}`);
    return filePath;
  }

  /**
   * Each entity on a table this plan does not create - a new one carries its triggers in its `CREATE` -
   * beside the triggers uql has installed there, read once per schema. Kept only where either side has
   * any: one declaring none on a table holding none has nothing to reconcile.
   */
  private async installedTriggers(
    created: readonly string[],
    entities: readonly Type<object>[] = this.entities,
  ): Promise<TriggerState[]> {
    const { dialect } = this.pool;
    const fresh = new Set(created);
    // Tables this plan creates are left out: their `CREATE` carries their triggers, and asking the
    // catalogue about a table that is not there yet fails outright on some engines.
    const wanted = entities.filter((entity) => !fresh.has(this.tableOf(entity)));
    const state: TriggerState[] = [];
    for (const entity of wanted) {
      const meta = getMeta(entity);
      const installed = await this.schemaIntrospectorFor(dialect.resolveSchema(meta)).ownedTriggers(
        dialect.resolveTableAlias(meta),
      );
      // An installed trigger alone keeps it: an entity that stopped declaring one has it to drop.
      if (installed.size || hasTriggers(meta)) {
        state.push({ entity, installed });
      }
    }
    return state;
  }

  /**
   * The alters, with the triggers reconciled around them. Postgres refuses to retype or drop a column a
   * trigger names, so every trigger on a table whose columns change comes off before the alters and what
   * its entity declares goes back on after. `down` is lazy: SQLite cannot express every alter's inverse.
   */
  private alterPlan(generator: SchemaGenerator, altered: readonly SchemaDiff[], state: readonly TriggerState[]) {
    const changing = new Set(
      altered.filter((diff) => sides(diff.columns, 'from').length).map((diff) => diff.tableName),
    );
    const cleared = state.filter(({ entity }) => changing.has(this.tableOf(entity)));
    const after = state.map((it) => (cleared.includes(it) ? { entity: it.entity, installed: new Map() } : it));
    return {
      up: [
        ...cleared.flatMap(({ entity, installed }) => generator.generateTriggerDrops(entity, [...installed.keys()])),
        ...altered.flatMap((diff) => generator.generateAlterTable(diff)),
        ...this.reconcileTriggers(generator, after),
      ],
      down: () => [
        ...this.revertedTriggers(generator, after),
        ...altered.toReversed().flatMap((diff) => generator.generateAlterTable(reverseDiff(diff))),
        ...cleared.flatMap(({ installed }) => [...installed.values()].flat().map((sql) => `${sql};`)),
      ],
    };
  }

  /**
   * Each entity's triggers taken from what the catalogue holds to what it declares. Against the catalogue
   * rather than a diff, because a trigger hangs off a table whose columns may be unchanged: a body edited
   * on a settled table appears in no diff at all.
   */
  private reconcileTriggers(generator: SchemaGenerator, state: readonly TriggerState[]): string[] {
    return state.flatMap(({ entity, installed }) => generator.generateTriggers(entity, installed));
  }

  /**
   * The inverse: what the reconcile created dropped, and what it dropped restored as the engine reprints
   * it. Read off the catalogue rather than recorded by uql, and exactly right for restoring one.
   */
  private revertedTriggers(generator: SchemaGenerator, state: readonly TriggerState[]): string[] {
    return state.flatMap(({ entity, installed }) => generator.generateTriggersDown(entity, installed));
  }

  /** The entities whose tables are among `created`. */
  private createdEntities(created: readonly string[]): Type<object>[] {
    const fresh = new Set(created);
    return this.entities.filter((entity) => fresh.has(this.tableOf(entity)));
  }

  /** The table `entity` maps to, as a diff names it. */
  private tableOf(entity: Type<object>): string {
    return this.pool.dialect.resolveTableName(getMeta(entity));
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
    // The table is already there, so its triggers are reconciled rather than carried by a `CREATE`.
    const altered = this.alterFromEntity(generator, entity, ast.getTable(tableName), options);
    return this.alterPlan(generator, altered, await this.installedTriggers([], [entity])).up;
  }

  /** The diff for one entity against the table it already has, and none where the two agree. */
  private alterFromEntity(
    generator: SchemaGenerator,
    entity: Type<object>,
    table: TableNode | undefined,
    options: SyncOptions,
  ): SchemaDiff[] {
    // Spanning the set for the reason `planEntity` spells out: a foreign key needs the table it
    // points at, which a sync of one entity outside the configured list would not otherwise have.
    const diff = generator.diffSchema(entity, table, generator.buildAST?.(this.entitiesWith(entity)));
    return diff?.type === 'alter' ? [this.filterDiff(diff, options)] : [];
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
    const filtered = altered.map((diff) => this.filterDiff(diff, options));
    return [
      ...this.createSchema(generator, created),
      ...this.alterPlan(generator, filtered, await this.installedTriggers(created)).up,
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

  /**
   * Safe mode only adds: a change with a `from` drops or rebuilds what the table holds, so it is held,
   * and so is a key whole, which rebuilds an index over every row and fails where a column holds a null.
   * Without `drop`, a column's drop is held too.
   */
  protected filterDiff(diff: SchemaDiff, options: { safe?: boolean; drop?: boolean }): SchemaDiff {
    const safe = options.safe !== false;
    const skip = (what: string, names: readonly string[], fix: string) => {
      if (names.length) {
        this.logger.logSkippedMigration(
          `[AutoSync] Skipped ${names.length} ${what} in table '${diff.tableName}': ${names.join(', ')} (${fix}).`,
        );
      }
    };
    const safeFix = 'safe mode active. Use a migration or { safe: false } to apply';
    const additive = <T>(what: string, changes: readonly Change<T>[] | undefined, nameOf: (item: T) => string) => {
      if (!safe) {
        return changes;
      }
      skip(`${what} changes`, sides(changes, 'from').map(nameOf), safeFix);
      return nonEmpty((changes ?? []).filter((change) => change.from === undefined));
    };

    const columns = additive('column', diff.columns, (column) => column.name);
    if (safe && diff.primaryKey) {
      skip('primary key changes', [diff.tableName], safeFix);
    }
    if (!options.drop) {
      skip(
        'column drops',
        dropped(columns).map((column) => column.name),
        'drop: false. Use { drop: true } to apply',
      );
    }
    return {
      ...diff,
      primaryKey: safe ? undefined : diff.primaryKey,
      columns: options.drop ? columns : nonEmpty((columns ?? []).filter((change) => change.to !== undefined)),
      indexes: additive('index', diff.indexes, (index) => index.name),
      foreignKeys: additive(
        'foreign key',
        diff.foreignKeys,
        (foreignKey) => foreignKey.name ?? foreignKey.columns.join(', '),
      ),
    };
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
