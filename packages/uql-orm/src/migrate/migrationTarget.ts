import type { ForeignKeyAction } from '../schema/types.js';
import {
  isKnownMigratorDialect,
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
import { withMongoQuerierForMigrations, withSqlQuerierForMigrations } from './acquireQuerierForMigrations.js';
import { MigrationBuilder } from './builder/migrationBuilder.js';
import { type MigrationSource, migrationSource } from './codegen/migrationFile.js';
import { runMongoCommand } from './generator/mongoCommand.js';
import { createSchemaGenerator, SqlSchemaGenerator } from './schemaGenerator.js';
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

/** Everything a migrator does differently per engine family, chosen once from its dialect. */
export type MigrationTarget = {
  readonly source: MigrationSource;
  storage(pool: QuerierPool, tableName: string | undefined): MigrationStorage;
  /** The schema generator, `undefined` for a dialect with none. Async because MongoDB's loads its optional peer. */
  generator(dialect: MigratorDialect, defaultForeignKeyAction?: ForeignKeyAction): Promise<SchemaGenerator | undefined>;
  withSession<T>(pool: QuerierPool, task: (session: MigrationSession) => Promise<T>): Promise<T>;
};

const sqlSession = (querier: SqlQuerier): MigrationSession => ({
  querier,
  run: (statement) => querier.run(statement),
  transaction: (work) => querier.transaction(work),
});

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

const sqlTarget: MigrationTarget = {
  source: migrationSource.SqlQuerier,
  storage: (pool, tableName) => new DatabaseMigrationStorage(pool, { tableName }),
  generator: async (dialect, defaultForeignKeyAction) =>
    isKnownMigratorDialect(dialect.dialectName) ? createSchemaGenerator(dialect, defaultForeignKeyAction) : undefined,
  withSession: (pool, task) => withSqlQuerierForMigrations(pool, 'Migrator', (querier) => task(sqlSession(querier))),
};

const mongoTarget: MigrationTarget = {
  source: migrationSource.MongoQuerier,
  storage: (pool, tableName) => new MongoMigrationStorage(pool, { tableName }),
  generator: (dialect, defaultForeignKeyAction) =>
    mongoSchemaGenerator(dialect.namingStrategy, defaultForeignKeyAction),
  withSession: (pool, task) =>
    withMongoQuerierForMigrations(pool, 'Migrator', (querier) => task(mongoSession(querier))),
};

export function migrationTargetFor(dialect: MigratorDialect): MigrationTarget {
  return dialect.dialectName === 'mongodb' ? mongoTarget : sqlTarget;
}

/** A builder running each operation on `querier`, as SQL or as MongoDB driver commands. */
export async function migrationBuilderFor(querier: Querier): Promise<MigrationBuilder> {
  if (isSqlQuerier(querier)) {
    return new MigrationBuilder(new SqlSchemaGenerator(querier.dialect), sqlSession(querier).run);
  }
  if (isMongoQuerier(querier)) {
    return new MigrationBuilder(await mongoSchemaGenerator(), mongoSession(querier).run);
  }
  throw new TypeError('A migration builder needs a SQL or a MongoDB querier');
}
