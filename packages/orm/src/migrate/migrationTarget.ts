import type { ForeignKeyAction } from '../schema/types.js';
import {
  isMongoQuerier,
  isSqlQuerier,
  type MigrationStorage,
  type MigratorDialect,
  type MongoQuerier,
  type NamingStrategy,
  type Querier,
  type QuerierPool,
  type SchemaGenerator,
  type SqlQuerier,
} from '../type/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import { withMongoQuerierForMigrations, withSqlQuerierForMigrations } from './acquireQuerierForMigrations.js';
import { MigrationBuilder } from './builder/migrationBuilder.js';
import { type MigrationSource, migrationSource } from './codegen/migrationFile.js';
import { runMongoCommand } from './generator/mongoCommand.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';
import { DatabaseMigrationStorage } from './storage/databaseStorage.js';
import { MongoMigrationStorage } from './storage/mongoStorage.js';

/** A migration querier as its engine family drives it. */
export type MigrationSession = {
  readonly querier: Querier;
  /** Runs one statement its generator wrote. */
  run(statement: string): Promise<unknown>;
  /** `work` in one transaction where the engine takes DDL in one; MongoDB creates collections outside any. */
  transaction(work: () => Promise<void>): Promise<void>;
};

/** Everything a migrator does differently per engine family, chosen once from its pool. */
export type MigrationTarget = {
  readonly source: MigrationSource;
  storage(tableName: string | undefined): MigrationStorage;
  /** The dialect's schema generator. Async because MongoDB's loads its optional peer. */
  generator(): Promise<SchemaGenerator>;
  withSession<T>(task: (session: MigrationSession) => Promise<T>): Promise<T>;
};

const sqlSession = (querier: SqlQuerier): MigrationSession => ({
  querier,
  run: (statement) => querier.run(statement),
  transaction: (work) =>
    querier.dialect.features.rebuildsTables ? withForeignKeysOff(querier, work) : querier.transaction(work),
});

/**
 * SQLite's own procedure for a schema change: foreign keys off before the transaction, where the switch
 * takes effect, and every reference checked before it commits. Otherwise dropping a table to rebuild it
 * deletes the rows pointing at it. A connection whose transaction runs elsewhere keeps them on, which the
 * rebuild's guard refuses.
 */
async function withForeignKeysOff(querier: SqlQuerier, work: () => Promise<void>): Promise<void> {
  const [{ foreign_keys: enforced }] = await querier.all<{ foreign_keys: number }>('PRAGMA foreign_keys');
  if (!enforced) {
    return querier.transaction(work);
  }
  await querier.run('PRAGMA foreign_keys = OFF');
  try {
    await querier.transaction(async () => {
      await work();
      const violations = await querier.all<{ table: string; parent: string }>('PRAGMA foreign_key_check');
      if (violations.length) {
        const [{ table, parent }] = violations;
        throw new UqlUsageError(
          `The migration leaves ${violations.length} row(s) referencing a missing one, the first in "${table}" pointing at "${parent}".`,
        );
      }
    });
  } finally {
    await querier.run('PRAGMA foreign_keys = ON');
  }
}

const mongoSession = (querier: MongoQuerier): MigrationSession => ({
  querier,
  run: (statement) => runMongoCommand(querier.db, statement),
  transaction: (work) => work(),
});

/** Imported on use, so the optional `mongodb` peer loads only on MongoDB. */
async function mongoSchemaGenerator(
  namingStrategy?: NamingStrategy,
  defaultForeignKeyAction?: ForeignKeyAction,
): Promise<SchemaGenerator> {
  const { MongoSchemaGenerator } = await import('./generator/mongoSchemaGenerator.js');
  return new MongoSchemaGenerator(namingStrategy, defaultForeignKeyAction);
}

export function migrationTargetFor(
  pool: QuerierPool<Querier, MigratorDialect>,
  defaultForeignKeyAction?: ForeignKeyAction,
): MigrationTarget {
  const { dialect } = pool;
  if (dialect.dialectName === 'mongodb') {
    return {
      source: migrationSource.MongoQuerier,
      storage: (tableName) => new MongoMigrationStorage(pool, { tableName }),
      generator: () => mongoSchemaGenerator(dialect.namingStrategy, defaultForeignKeyAction),
      withSession: (task) => withMongoQuerierForMigrations(pool, 'Migrator', (querier) => task(mongoSession(querier))),
    };
  }
  return {
    source: migrationSource.SqlQuerier,
    storage: (tableName) => new DatabaseMigrationStorage(pool, { tableName }),
    generator: async () => new SqlSchemaGenerator(dialect, defaultForeignKeyAction),
    withSession: (task) => withSqlQuerierForMigrations(pool, 'Migrator', (querier) => task(sqlSession(querier))),
  };
}

/** A builder running each operation on `querier`, as SQL or as MongoDB driver commands. */
export async function migrationBuilderFor(querier: Querier): Promise<MigrationBuilder> {
  if (isSqlQuerier(querier)) {
    return new MigrationBuilder(new SqlSchemaGenerator(querier.dialect), sqlSession(querier).run);
  }
  if (isMongoQuerier(querier)) {
    return new MigrationBuilder(await mongoSchemaGenerator(), mongoSession(querier).run);
  }
  throw new UqlUsageError('A migration builder needs a SQL or a MongoDB querier');
}
