import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getEntities, getMeta } from '../entity/index.js';
import type {
  Dialect,
  Migration,
  MigrationDefinition,
  MigrationResult,
  MigrationStorage,
  MigratorOptions,
  MongoQuerier,
  NamingStrategy,
  Querier,
  QuerierPool,
  SchemaDiff,
  SchemaGenerator,
  SchemaIntrospector,
  Type,
} from '../type/index.js';
import { isSqlQuerier } from '../type/index.js';
import {
  MariadbSchemaGenerator,
  MongoSchemaGenerator,
  MysqlSchemaGenerator,
  PostgresSchemaGenerator,
  SqliteSchemaGenerator,
} from './generator/index.js';
import {
  MariadbSchemaIntrospector,
  MongoSchemaIntrospector,
  MysqlSchemaIntrospector,
  PostgresSchemaIntrospector,
  SqliteSchemaIntrospector,
} from './introspection/index.js';
import { DatabaseMigrationStorage } from './storage/databaseStorage.js';

/**
 * Main class for managing database migrations
 */
export class Migrator {
  private readonly storage: MigrationStorage;
  private readonly migrationsPath: string;
  private readonly logger: (message: string) => void;
  private readonly entities: Type<unknown>[];
  private readonly dialect: Dialect;
  private schemaGenerator?: SchemaGenerator;
  public schemaIntrospector?: SchemaIntrospector;

  constructor(
    private readonly querierPool: QuerierPool,
    options: MigratorOptions = {},
  ) {
    this.dialect = options.dialect ?? querierPool.dialect ?? 'postgres';
    this.storage =
      options.storage ??
      new DatabaseMigrationStorage(querierPool, {
        tableName: options.tableName,
      });
    this.migrationsPath = options.migrationsPath ?? './migrations';
    this.logger = options.logger ?? (() => {});
    this.entities = options.entities ?? [];
    this.schemaIntrospector = this.createIntrospector();
    this.schemaGenerator = options.schemaGenerator ?? this.createGenerator(options.namingStrategy);
  }

  /**
   * Set the schema generator for DDL operations
   */
  setSchemaGenerator(generator: SchemaGenerator): void {
    this.schemaGenerator = generator;
  }

  private createIntrospector(): SchemaIntrospector | undefined {
    switch (this.dialect) {
      case 'postgres':
        return new PostgresSchemaIntrospector(this.querierPool);
      case 'mysql':
        return new MysqlSchemaIntrospector(this.querierPool);
      case 'mariadb':
        return new MariadbSchemaIntrospector(this.querierPool);
      case 'sqlite':
        return new SqliteSchemaIntrospector(this.querierPool);
      case 'mongodb':
        return new MongoSchemaIntrospector(this.querierPool);
      default:
        return undefined;
    }
  }

  private createGenerator(namingStrategy?: NamingStrategy): SchemaGenerator | undefined {
    switch (this.dialect) {
      case 'postgres':
        return new PostgresSchemaGenerator(namingStrategy);
      case 'mysql':
        return new MysqlSchemaGenerator(namingStrategy);
      case 'mariadb':
        return new MariadbSchemaGenerator(namingStrategy);
      case 'sqlite':
        return new SqliteSchemaGenerator(namingStrategy);
      case 'mongodb':
        return new MongoSchemaGenerator(namingStrategy);
      default:
        return undefined;
    }
  }

  /**
   * Get the SQL dialect
   */
  getDialect(): Dialect {
    return this.dialect;
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
    return migrations.sort((a: any, b: any) => a.name.localeCompare(b.name));
  }

  /**
   * Get list of pending migrations (not yet executed)
   */
  async pending(): Promise<Migration[]> {
    const [migrations, executed] = await Promise.all([this.getMigrations(), this.storage.executed()]);

    const executedSet = new Set(executed);
    return migrations.filter((m: any) => !executedSet.has(m.name));
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
    const pendingMigrations = await this.pending();
    const results: MigrationResult[] = [];

    let migrationsToRun = pendingMigrations;

    if (options.to) {
      const toIndex = migrationsToRun.findIndex((m: any) => m.name === options.to);
      if (toIndex === -1) {
        throw new Error(`Migration '${options.to}' not found`);
      }
      migrationsToRun = migrationsToRun.slice(0, toIndex + 1);
    }

    if (options.step !== undefined) {
      migrationsToRun = migrationsToRun.slice(0, options.step);
    }

    for (const migration of migrationsToRun) {
      const result = await this.runMigration(migration, 'up');
      results.push(result);

      if (!result.success) {
        break; // Stop on first failure
      }
    }

    return results;
  }

  /**
   * Rollback migrations
   */
  async down(options: { to?: string; step?: number } = {}): Promise<MigrationResult[]> {
    const [migrations, executed] = await Promise.all([this.getMigrations(), this.storage.executed()]);

    const executedSet = new Set(executed);
    const executedMigrations = migrations.filter((m: any) => executedSet.has(m.name)).reverse(); // Rollback in reverse order

    const results: MigrationResult[] = [];
    let migrationsToRun = executedMigrations;

    if (options.to) {
      const toIndex = migrationsToRun.findIndex((m: any) => m.name === options.to);
      if (toIndex === -1) {
        throw new Error(`Migration '${options.to}' not found`);
      }
      migrationsToRun = migrationsToRun.slice(0, toIndex + 1);
    }

    if (options.step !== undefined) {
      migrationsToRun = migrationsToRun.slice(0, options.step);
    }

    for (const migration of migrationsToRun) {
      const result = await this.runMigration(migration, 'down');
      results.push(result);

      if (!result.success) {
        break; // Stop on first failure
      }
    }

    return results;
  }

  /**
   * Run a single migration within a transaction
   */
  private async runMigration(migration: Migration, direction: 'up' | 'down'): Promise<MigrationResult> {
    const startTime = Date.now();
    const querier = await this.querierPool.getQuerier();

    if (!isSqlQuerier(querier)) {
      await querier.release();
      throw new Error('Migrator requires a SQL-based querier');
    }

    try {
      this.logger(`${direction === 'up' ? 'Running' : 'Reverting'} migration: ${migration.name}`);

      await querier.beginTransaction();

      if (direction === 'up') {
        await migration.up(querier);
        // Log within the same transaction
        await this.storage.logWithQuerier(querier, migration.name);
      } else {
        await migration.down(querier);
        // Unlog within the same transaction
        await this.storage.unlogWithQuerier(querier, migration.name);
      }

      await querier.commitTransaction();

      const duration = Date.now() - startTime;
      this.logger(`Migration ${migration.name} ${direction === 'up' ? 'applied' : 'reverted'} in ${duration}ms`);

      return {
        name: migration.name,
        direction,
        duration,
        success: true,
      };
    } catch (error) {
      await querier.rollbackTransaction();

      const duration = Date.now() - startTime;
      this.logger(`Migration ${migration.name} failed: ${(error as Error).message}`);

      return {
        name: migration.name,
        direction,
        duration,
        success: false,
        error: error as Error,
      };
    } finally {
      await querier.release();
    }
  }

  /**
   * Generate a new migration file
   */
  async generate(name: string): Promise<string> {
    const timestamp = this.getTimestamp();
    const fileName = `${timestamp}_${this.slugify(name)}.ts`;
    const filePath = join(this.migrationsPath, fileName);

    const content = this.generateMigrationContent(name);

    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(this.migrationsPath, { recursive: true });
    await writeFile(filePath, content, 'utf-8');

    this.logger(`Created migration: ${filePath}`);
    return filePath;
  }

  /**
   * Generate a migration based on entity schema differences
   */
  async generateFromEntities(name: string): Promise<string> {
    if (!this.schemaGenerator) {
      throw new Error('Schema generator not set. Call setSchemaGenerator() first.');
    }

    const diffs = await this.getDiffs();
    const upStatements: string[] = [];
    const downStatements: string[] = [];

    for (const diff of diffs) {
      if (diff.type === 'create') {
        const entity = this.findEntityForTable(diff.tableName);
        if (entity) {
          upStatements.push(this.schemaGenerator.generateCreateTable(entity));
          downStatements.push(this.schemaGenerator.generateDropTable(entity));
        }
      } else if (diff.type === 'alter') {
        const alterStatements = this.schemaGenerator.generateAlterTable(diff);
        upStatements.push(...alterStatements);

        const alterDownStatements = this.schemaGenerator.generateAlterTableDown(diff);
        downStatements.push(...alterDownStatements);
      }
    }

    if (upStatements.length === 0) {
      this.logger('No schema changes detected.');
      return '';
    }

    const timestamp = this.getTimestamp();
    const fileName = `${timestamp}_${this.slugify(name)}.ts`;
    const filePath = join(this.migrationsPath, fileName);

    const content = this.generateMigrationContentWithStatements(name, upStatements, downStatements.reverse());

    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(this.migrationsPath, { recursive: true });
    await writeFile(filePath, content, 'utf-8');

    this.logger(`Created migration from entities: ${filePath}`);
    return filePath;
  }

  /**
   * Get all schema differences between entities and database
   */
  async getDiffs(): Promise<SchemaDiff[]> {
    if (!this.schemaGenerator || !this.schemaIntrospector) {
      throw new Error('Schema generator and introspector must be set');
    }

    const entities = this.entities.length > 0 ? this.entities : getEntities();
    const diffs: SchemaDiff[] = [];

    for (const entity of entities) {
      const meta = getMeta(entity);
      const tableName = this.schemaGenerator.resolveTableName(entity, meta);
      const currentSchema = await this.schemaIntrospector.getTableSchema(tableName);
      const diff = this.schemaGenerator.diffSchema(entity, currentSchema);
      if (diff) {
        diffs.push(diff);
      }
    }

    return diffs;
  }

  private findEntityForTable(tableName: string): Type<unknown> | undefined {
    const entities = this.entities.length > 0 ? this.entities : getEntities();
    for (const entity of entities) {
      const meta = getMeta(entity);
      const name = this.schemaGenerator.resolveTableName(entity, meta);
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
    if (!this.schemaGenerator) {
      throw new Error('Schema generator not set. Call setSchemaGenerator() first.');
    }

    const entities = this.entities.length > 0 ? this.entities : getEntities();
    const querier = await this.querierPool.getQuerier();

    if (!isSqlQuerier(querier)) {
      await querier.release();
      throw new Error('Migrator requires a SQL-based querier');
    }

    try {
      await querier.beginTransaction();

      // Drop all tables first (in reverse order for foreign keys)
      for (const entity of [...entities].reverse()) {
        const dropSql = this.schemaGenerator.generateDropTable(entity);
        this.logger(`Executing: ${dropSql}`);
        await querier.run(dropSql);
      }

      // Create all tables
      for (const entity of entities) {
        const createSql = this.schemaGenerator.generateCreateTable(entity);
        this.logger(`Executing: ${createSql}`);
        await querier.run(createSql);
      }

      await querier.commitTransaction();
      this.logger('Schema sync (force) completed');
    } catch (error) {
      await querier.rollbackTransaction();
      throw error;
    } finally {
      await querier.release();
    }
  }

  /**
   * Safely synchronizes the schema by only adding missing tables and columns.
   */
  async autoSync(options: { safe?: boolean; drop?: boolean; logging?: boolean } = {}): Promise<void> {
    if (!this.schemaGenerator || !this.schemaIntrospector) {
      throw new Error('Schema generator and introspector must be set');
    }

    const diffs = await this.getDiffs();
    const statements: string[] = [];

    for (const diff of diffs) {
      if (diff.type === 'create') {
        const entity = this.findEntityForTable(diff.tableName);
        if (entity) {
          statements.push(this.schemaGenerator.generateCreateTable(entity));
        }
      } else if (diff.type === 'alter') {
        const filteredDiff = this.filterDiff(diff, options);
        const alterStatements = this.schemaGenerator.generateAlterTable(filteredDiff);
        statements.push(...alterStatements);
      }
    }

    if (statements.length === 0) {
      if (options.logging) this.logger('Schema is already in sync.');
      return;
    }

    await this.executeSyncStatements(statements, options);
  }

  private filterDiff(diff: SchemaDiff, options: { safe?: boolean; drop?: boolean }): SchemaDiff {
    const filteredDiff = { ...diff } as { -readonly [K in keyof SchemaDiff]: SchemaDiff[K] };
    if (options.safe !== false) {
      // In safe mode, we only allow additions
      delete filteredDiff.columnsToDrop;
      delete filteredDiff.indexesToDrop;
      delete filteredDiff.foreignKeysToDrop;
    }
    if (!options.drop) {
      delete filteredDiff.columnsToDrop;
    }
    return filteredDiff;
  }

  private async executeSyncStatements(statements: string[], options: { logging?: boolean }): Promise<void> {
    const querier = await this.querierPool.getQuerier();
    try {
      if (this.dialect === 'mongodb') {
        await this.executeMongoSyncStatements(statements, options, querier as MongoQuerier);
      } else {
        await this.executeSqlSyncStatements(statements, options, querier);
      }
      if (options.logging) this.logger('Schema synchronization completed');
    } catch (error) {
      if (this.dialect !== 'mongodb' && isSqlQuerier(querier)) {
        await querier.rollbackTransaction();
      }
      throw error;
    } finally {
      await querier.release();
    }
  }

  private async executeMongoSyncStatements(
    statements: string[],
    options: { logging?: boolean },
    querier: MongoQuerier,
  ): Promise<void> {
    const db = querier.db;
    for (const stmt of statements) {
      const cmd = JSON.parse(stmt) as {
        action: string;
        name?: string;
        collection?: string;
        indexes?: { name: string; columns: string[]; unique?: boolean }[];
        key?: Record<string, number>;
        options?: any;
      };
      if (options.logging) this.logger(`Executing MongoDB: ${stmt}`);

      const collectionName = cmd.name || cmd.collection;
      if (!collectionName) {
        throw new Error(`MongoDB command missing collection name: ${stmt}`);
      }
      const collection = db.collection(collectionName);

      if (cmd.action === 'createCollection') {
        await db.createCollection(cmd.name);
        if (cmd.indexes?.length) {
          for (const idx of cmd.indexes) {
            const key = Object.fromEntries(idx.columns.map((c: string) => [c, 1]));
            await collection.createIndex(key, { unique: idx.unique, name: idx.name });
          }
        }
      } else if (cmd.action === 'dropCollection') {
        await collection.drop();
      } else if (cmd.action === 'createIndex') {
        await collection.createIndex(cmd.key, cmd.options);
      } else if (cmd.action === 'dropIndex') {
        await collection.dropIndex(cmd.name);
      }
    }
  }

  private async executeSqlSyncStatements(
    statements: string[],
    options: { logging?: boolean },
    querier: Querier,
  ): Promise<void> {
    if (!isSqlQuerier(querier)) {
      throw new Error('Migrator requires a SQL-based querier for this dialect');
    }
    await querier.beginTransaction();
    for (const sql of statements) {
      if (options.logging) this.logger(`Executing: ${sql}`);
      await querier.run(sql);
    }
    await querier.commitTransaction();
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
  private async getMigrationFiles(): Promise<string[]> {
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
  private async loadMigration(fileName: string): Promise<Migration | undefined> {
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

      this.logger(`Warning: ${fileName} is not a valid migration`);
      return undefined;
    } catch (error) {
      this.logger(`Error loading migration ${fileName}: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * Check if an object is a valid migration
   */
  private isMigration(obj: unknown): obj is MigrationDefinition {
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
  private getMigrationName(fileName: string): string {
    return basename(fileName, extname(fileName));
  }

  /**
   * Generate timestamp string for migration names
   */
  private getTimestamp(): string {
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
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Generate migration file content
   */
  private generateMigrationContent(name: string): string {
    return /*ts*/ `import type { SqlQuerier } from '@uql/migrate';

/**
 * Migration: ${name}
 * Created: ${new Date().toISOString()}
 */
export default {
  async up(querier: SqlQuerier): Promise<void> {
    // Add your migration logic here
    // Example:
    // await querier.run(\`
    //   CREATE TABLE "users" (
    //     "id" SERIAL PRIMARY KEY,
    //     "name" VARCHAR(255) NOT NULL,
    //     "email" VARCHAR(255) UNIQUE NOT NULL,
    //     "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    //   )
    // \`);
  },

  async down(querier: SqlQuerier): Promise<void> {
    // Add your rollback logic here
    // Example:
    // await querier.run(\`DROP TABLE IF EXISTS "users"\`);
  },
};
`;
  }

  /**
   * Generate migration file content with SQL statements
   */
  private generateMigrationContentWithStatements(
    name: string,
    upStatements: string[],
    downStatements: string[],
  ): string {
    const upSql = upStatements.map((s) => /*ts*/ `    await querier.run(\`${s}\`);`).join('\n');
    const downSql = downStatements.map((s) => /*ts*/ `    await querier.run(\`${s}\`);`).join('\n');

    return /*ts*/ `import type { SqlQuerier } from '@uql/migrate';

/**
 * Migration: ${name}
 * Created: ${new Date().toISOString()}
 * Generated from entity definitions
 */
export default {
  async up(querier: SqlQuerier): Promise<void> {
${upSql}
  },

  async down(querier: SqlQuerier): Promise<void> {
${downSql}
  },
};
`;
  }
}

/**
 * Helper function to define a migration with proper typing
 */
export function defineMigration(migration: MigrationDefinition): MigrationDefinition {
  return migration;
}
