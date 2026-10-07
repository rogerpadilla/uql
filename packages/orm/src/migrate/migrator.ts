import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getEntities, getMeta } from '../entity/index.js';
import { SchemaAST } from '../schema/index.js';
import { columnRenames, tableRenameCandidates } from '../schema/schemaASTDiffer.js';
import type { TableNode } from '../schema/types.js';
import type {
  Change,
  ColumnRenames,
  EntityMeta,
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
import { definedEntries, isRecord, LoggerWrapper } from '../util/index.js';
import { isOwnedName, qualifyName } from '../util/sql.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { withSqlQuerierForMigrations } from './acquireQuerierForMigrations.js';
import type { IMigrationBuilder } from './builder/types.js';
import { buildMigrationModule, type MigrationModuleOptions } from './codegen/migrationFile.js';
import { introspectorFor } from './introspection/registry.js';
import { type MigrationTarget, migrationBuilderFor, migrationTargetFor } from './migrationTarget.js';
import { dropped, lacksValue, newlyRequired, nonEmpty, reverseDiff, sides, withoutRebuild } from './schemaChange.js';
import { constraintNameOf } from './schemaGenerator.js';

/**
 * Main class for managing database migrations
 */
export class Migrator {
  public readonly storage: MigrationStorage;
  public readonly migrationsPath: string;

  public readonly logger: LoggerWrapper;
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
    this.logger = new LoggerWrapper(options.logger!, { logValues: options.logValues, slowQuery: options.slowQuery });
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
    const { created, altered } = await this.pendingChanges({ renames: true });
    await this.assertFillable(altered);
    await this.noteChanges(generator, created, altered);
    const up = [
      ...this.createSchema(generator, created),
      ...altered.flatMap((diff) => generator.generateAlterTable(diff)),
    ];

    if (up.length === 0) {
      this.logger.logInfo('No schema changes detected.');
      return '';
    }

    // Diff by diff in reverse, each rolled back in the order its generator wrote it.
    const down = [
      ...altered.toReversed().flatMap((diff) => generator.generateAlterTable(reverseDiff(diff))),
      ...generator.generateDropSchema(this.createdEntities(created), { ifExists: true }),
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
   * What a generated migration does that its reader must not miss: each column it drops or retypes, which
   * can lose data, and each table it creates empty while the database holds one no entity names with the
   * same columns, which may be the table renamed. That one is never renamed here: it may be another's.
   */
  private async noteChanges(
    generator: SchemaGenerator,
    created: readonly string[],
    altered: readonly SchemaDiff[],
  ): Promise<void> {
    for (const { tableName, columns = [] } of altered) {
      for (const { from, to } of columns.filter((change) => change.isBreaking)) {
        this.logger.logWarn(
          to
            ? `Retypes "${tableName}"."${to.name}" from ${from?.type} to ${to.type}: a value that does not fit is lost or refused.`
            : `Drops "${tableName}"."${from?.name}", losing what it holds.`,
        );
      }
    }
    for (const { from, to } of await this.renamedTables(generator, created)) {
      this.logger.logWarn(
        `Creates "${to}" empty, while "${from}", which no entity names, holds the same columns. If it was ` +
          `renamed, replace its creation in this migration with \`renameTable('${from}', '${to}')\`.`,
      );
    }
  }

  /**
   * Refuses, before anything runs, each column the changes require with no default while rows would hold
   * none: every engine fails on one but MySQL, which fills in a zero. Counted, since an empty table is fine.
   */
  private async assertFillable(altered: readonly SchemaDiff[]): Promise<void> {
    // A renamed column is identical but for its name, so the one counted is never renamed too.
    const counts = altered.flatMap(({ tableName, columns }) =>
      newlyRequired(columns)
        .filter(({ to }) => lacksValue(to))
        .map(({ from, to }) => ({ tableName, column: to.name, nullable: from })),
    );
    if (!counts.length) {
      return;
    }
    const unfilled = await withSqlQuerierForMigrations(this.pool, 'Migrator', async (querier) => {
      const escapeId = (name: string) => querier.dialect.escapeId(name);
      const found: string[] = [];
      for (const { tableName, column, nullable } of counts) {
        const empty = nullable ? ` WHERE ${escapeId(column)} IS NULL` : '';
        const [{ rows }] = await querier.all<{ rows: number | bigint | string }>(
          `SELECT COUNT(*) AS ${escapeId('rows')} FROM ${escapeId(tableName)}${empty}`,
        );
        const count = Number(rows);
        if (count) {
          found.push(
            `"${tableName}"."${column}" is required with no default, and ${count} ${count === 1 ? 'row holds' : 'rows hold'} none`,
          );
        }
      }
      return found;
    });
    if (unfilled.length) {
      throw new UqlUsageError(
        `${unfilled.join('; ')}. Declare a default, or add the column nullable, fill it, then require it.`,
      );
    }
  }

  /** The tables the database holds that no entity names, each paired with a new one it is identical to. */
  private async renamedTables(generator: SchemaGenerator, created: readonly string[]) {
    const createdEntities = this.createdEntities(created);
    const diffOptions = generator.diffOptions?.();
    if (!createdEntities.length || !generator.buildAST || !diffOptions) {
      return [];
    }
    const owned = new Set(this.entities.map((entity) => this.tableOf(entity)));
    const unowned = (await this.schemaIntrospector.getTableNames()).filter((table) => !owned.has(table));
    const current = await this.schemaIntrospector.introspect(unowned);
    return tableRenameCandidates(generator.buildAST(createdEntities), current, diffOptions);
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
   * The differences between the entities and the database. With `renames`, a column identical to one the
   * entity no longer names is renamed in place rather than dropped and added, as a generated migration wants.
   */
  async getDiffs(options: { renames?: boolean } = {}): Promise<SchemaDiff[]> {
    const generator = await this.getSchemaGenerator();
    // Both sides built once: the database's here, the entities' below. Left to `diffSchema`, each
    // entity would rebuild the whole AST, which is quadratic in the number of entities. Absent on a
    // generator that compares no schema of its own - MongoDB, which reads only indexes.
    const desiredAst = generator.buildAST?.(this.entities);
    let ast = await this.introspectEntities(this.entities);
    const diffOptions = generator.diffOptions?.();
    const renames: ColumnRenames =
      options.renames && desiredAst && diffOptions ? columnRenames(desiredAst, ast, diffOptions) : new Map();
    if (renames.size) {
      // Read again under the names the entities give them, so the rest compares as the columns they become.
      ast = await this.introspectEntities(this.entities, renames);
    }
    if (desiredAst) {
      this.noteForeignChecks(desiredAst, ast);
    }
    return this.entities.flatMap((entity) => {
      const tableName = generator.resolveTableName(getMeta(entity));
      const diff = generator.diffSchema(entity, ast.getTable(tableName), desiredAst, renames.get(tableName));
      return diff ? [diff] : [];
    });
  }

  /**
   * Each check uql did not install on a table whose entity declares checks: never changed or dropped, so
   * one an owned check replaces, such as an enum's from before checks were named, goes on enforcing itself.
   */
  private noteForeignChecks(desired: SchemaAST, actual: SchemaAST): void {
    for (const table of desired.getTables()) {
      const foreign = (actual.getTable(qualifyName(table.name, table.schema))?.checks ?? []).filter(
        (check) => !isOwnedName(check.name),
      );
      if (table.checks.length && foreign.length) {
        this.logger.logWarn(
          `"${table.name}" holds checks uql did not install, which it leaves as they are: ` +
            `${foreign.map((check) => check.name).join(', ')}. Drop each one a declared check replaces.`,
        );
      }
    }
  }

  /**
   * The tables `entities` name, read a schema at a time so each is keyed as its entity spells it. Those
   * alone: nothing else is diffed, and another table can be dropped mid-scan by whatever else is running.
   */
  private async introspectEntities(entities: readonly Type<object>[], renames?: ColumnRenames): Promise<SchemaAST> {
    const { dialect } = this.pool;
    const bySchema = Map.groupBy(new Set(entities), (entity) => dialect.resolveSchema(getMeta(entity)));
    const merged = new SchemaAST();
    for (const [schema, members] of bySchema) {
      const tables = members.map((entity) => dialect.resolveTableAlias(getMeta(entity)));
      for (const table of (await this.schemaIntrospectorFor(schema).introspect(tables, renames)).getTables()) {
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
  private async forceStatements(generator: SchemaGenerator): Promise<string[]> {
    const existing = await this.introspectEntities(this.entities);
    return [
      ...generator.generateDropSchema(this.entities, { ifExists: true, cascade: true, existing }),
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
    const altered = this.alterFromEntity(generator, entity, ast.getTable(tableName), options);
    await this.assertFillable(altered);
    return altered.flatMap((diff) => generator.generateAlterTable(diff));
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
    await this.assertFillable(filtered);
    return [
      ...this.createSchema(generator, created),
      ...filtered.flatMap((diff) => generator.generateAlterTable(diff)),
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
  private async pendingChanges(
    options: { renames?: boolean } = {},
  ): Promise<{ created: string[]; altered: SchemaDiff[] }> {
    const diffs = await this.getDiffs(options);
    return {
      created: diffs.filter((diff) => diff.type === 'create').map((diff) => diff.tableName),
      altered: diffs.filter((diff) => diff.type === 'alter'),
    };
  }

  /**
   * Safe mode only adds: a change with a `from` drops or rebuilds what the table holds, so it is held,
   * and so is a key whole, which rebuilds an index over every row and fails where a column holds a null.
   * Without `drop`, a column's drop is held too. A rebuilt table applies its diff whole, so holding any
   * part of it holds the rebuild, and only what an `ALTER` adds goes ahead: a plain column, an index.
   */
  protected filterDiff(diff: SchemaDiff, options: { safe?: boolean; drop?: boolean }): SchemaDiff {
    const safe = options.safe !== false;
    let held = false;
    const skip = (what: string, names: readonly string[], fix: string) => {
      if (names.length) {
        held = true;
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
    const filtered: SchemaDiff = {
      ...diff,
      primaryKey: safe ? undefined : diff.primaryKey,
      columns: options.drop ? columns : nonEmpty((columns ?? []).filter((change) => change.to !== undefined)),
      indexes: additive('index', diff.indexes, (index) => index.name),
      foreignKeys: additive('foreign key', diff.foreignKeys, (foreignKey) =>
        constraintNameOf(diff.tableName, foreignKey),
      ),
      checks: additive('check', diff.checks, (check) => check.name),
    };
    if (!diff.rebuild || !held) {
      return filtered;
    }
    skip('rebuild', [diff.tableName], 'it applies the whole diff, and part of it is held');
    return withoutRebuild(filtered);
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
          transaction: migration.transaction,
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
    return isRecord(obj) && typeof obj['up'] === 'function' && typeof obj['down'] === 'function';
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
  const fields = definedEntries(meta.fields).flatMap(([, field]) => field.references?.() ?? []);
  return [...fields, ...definedEntries(meta.relations).map(([, relation]) => relation.entity())];
}
