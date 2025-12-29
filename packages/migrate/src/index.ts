// Core types

// Re-export core types for convenience
export type { SqlDialect, SqlQuerier, SqlQueryDialect } from 'nukak/type';
export { isSqlQuerier } from 'nukak/type';
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

// Migration-specific types
export type {
  ColumnSchema,
  ForeignKeySchema,
  IndexSchema,
  Migration,
  MigrationDefinition,
  MigrationResult,
  MigrationStorage,
  MigratorOptions,
  SchemaDiff,
  SchemaGenerator,
  SchemaIntrospector,
  TableSchema,
} from './type.js';
