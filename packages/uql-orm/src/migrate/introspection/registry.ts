import type { KnownMigratorDialect, QuerierPool, SchemaIntrospector } from '../../type/index.js';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';
import { MsSqlSchemaIntrospector } from './mssqlIntrospector.js';
import { MariadbSchemaIntrospector, MysqlSchemaIntrospector } from './mysqlIntrospector.js';
import { CockroachSchemaIntrospector, PostgresSchemaIntrospector } from './postgresIntrospector.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

/** Builds the introspector for one engine. Only Postgres-wire and MySQL-family ones read a schema. */
type IntrospectorFactory = (pool: QuerierPool, schema?: string) => SchemaIntrospector;

/**
 * Which introspector each engine gets. A table rather than a `switch` so `Migrator` names no
 * constructor and adding an engine touches one line, not a control flow.
 *
 * Every entry is statically imported, so `uql-orm/migrate` still carries all of them; making the
 * table's values dynamic imports would shrink that entry, at the cost of an async
 * `createIntrospector` the constructor cannot await.
 */
const INTROSPECTORS: Readonly<Record<KnownMigratorDialect, IntrospectorFactory>> = {
  postgres: (pool, schema) => new PostgresSchemaIntrospector(pool, schema),
  cockroachdb: (pool, schema) => new CockroachSchemaIntrospector(pool, schema),
  mysql: (pool, schema) => new MysqlSchemaIntrospector(pool, schema),
  mariadb: (pool, schema) => new MariadbSchemaIntrospector(pool, schema),
  mssql: (pool, schema) => new MsSqlSchemaIntrospector(pool, schema),
  // Neither has schemas to read: SQLite attaches database files and MongoDB takes its database from
  // the connection, so both ignore the argument rather than filtering on it.
  sqlite: (pool) => new SqliteSchemaIntrospector(pool),
  mongodb: (pool) => new MongoSchemaIntrospector(pool),
};

/** The introspector for `dialectName`, or `undefined` where the migrator has none for it. */
export function introspectorFor(
  dialectName: string,
  pool: QuerierPool,
  schema?: string,
): SchemaIntrospector | undefined {
  return INTROSPECTORS[dialectName as KnownMigratorDialect]?.(pool, schema);
}
