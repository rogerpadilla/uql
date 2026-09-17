import type { DialectName, QuerierPool, SchemaIntrospector } from '../../type/index.js';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';
import { MsSqlSchemaIntrospector } from './mssqlIntrospector.js';
import { MariadbSchemaIntrospector, MysqlSchemaIntrospector } from './mysqlIntrospector.js';
import { CockroachSchemaIntrospector, PostgresSchemaIntrospector } from './postgresIntrospector.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

type IntrospectorFactory = (pool: QuerierPool, schema?: string) => SchemaIntrospector;

/**
 * Which introspector each engine gets; SQLite and MongoDB have no schemas, so they ignore the argument.
 * Statically imported, so `uql-orm/migrate` carries every one: dynamic imports would shrink that entry,
 * but `Migrator` builds its introspector in its constructor, which cannot await.
 */
const INTROSPECTORS: Readonly<Record<DialectName, IntrospectorFactory>> = {
  postgres: (pool, schema) => new PostgresSchemaIntrospector(pool, schema),
  cockroachdb: (pool, schema) => new CockroachSchemaIntrospector(pool, schema),
  mysql: (pool, schema) => new MysqlSchemaIntrospector(pool, schema),
  mariadb: (pool, schema) => new MariadbSchemaIntrospector(pool, schema),
  mssql: (pool, schema) => new MsSqlSchemaIntrospector(pool, schema),
  sqlite: (pool) => new SqliteSchemaIntrospector(pool),
  mongodb: (pool) => new MongoSchemaIntrospector(pool),
};

/** The introspector for the engine `pool` runs on, reading `schema` where the engine has schemas to read. */
export function introspectorFor(pool: QuerierPool, schema?: string): SchemaIntrospector {
  return INTROSPECTORS[pool.dialect.dialectName](pool, schema);
}
