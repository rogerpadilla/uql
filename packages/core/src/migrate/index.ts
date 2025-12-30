// Core types

// Re-export core types for convenience
// Migration-specific types
export type {
  ColumnSchema,
  Dialect,
  ForeignKeySchema,
  IndexSchema,
  Migration,
  MigrationDefinition,
  MigrationResult,
  MigrationStorage,
  MigratorOptions,
  MongoQuerier,
  SchemaDiff,
  SchemaGenerator,
  SchemaIntrospector,
  SqlDialect,
  SqlQuerier,
  SqlQueryDialect,
  TableSchema,
} from '../type/index.js';
export { isSqlQuerier } from '../type/index.js';
export {
  MysqlSchemaGenerator,
  MysqlSchemaGenerator as MariadbSchemaGenerator,
} from './generator/mysqlSchemaGenerator.js';
export { PostgresSchemaGenerator } from './generator/postgresSchemaGenerator.js';
export { SqliteSchemaGenerator } from './generator/sqliteSchemaGenerator.js';
// Schema introspection
export { MariadbSchemaIntrospector, MysqlSchemaIntrospector } from './introspection/mysqlIntrospector.js';
export { PostgresSchemaIntrospector } from './introspection/postgresIntrospector.js';
export { SqliteSchemaIntrospector } from './introspection/sqliteIntrospector.js';
// Main migrator
export { defineMigration, Migrator } from './migrator.js';
// Schema generators
export { AbstractSchemaGenerator } from './schemaGenerator.js';
// Storage implementations
export { DatabaseMigrationStorage } from './storage/databaseStorage.js';
export { JsonMigrationStorage } from './storage/jsonStorage.js';
