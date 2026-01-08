// Re-export core types for convenience
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
export { type Config, isSqlQuerier } from '../type/index.js';

// Type-safe migration builder
export * from './builder/index.js';
export { loadConfig } from './cli-config.js';

// Entity code generation
export * from './codegen/index.js';

// Drift detection
export * from './drift/index.js';
// Schema introspection
export * from './introspection/index.js';
// Main migrator
export { type BuilderMigrationDefinition, defineBuilderMigration, defineMigration, Migrator } from './migrator.js';
// Schema generators
export { createSchemaGenerator, MongoSchemaGenerator, SqlSchemaGenerator } from './schemaGenerator.js';

// Storage implementations
export { DatabaseMigrationStorage } from './storage/databaseStorage.js';
export { JsonMigrationStorage } from './storage/jsonStorage.js';

// Schema sync
export * from './sync/index.js';
