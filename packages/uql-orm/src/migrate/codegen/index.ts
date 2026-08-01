/**
 * Code Generation Module
 *
 * Generates TypeScript entity code from database schemas.
 */

// Entity code generator
export {
  createEntityCodeGenerator,
  EntityCodeGenerator,
  type EntityCodeGeneratorOptions,
  type GeneratedEntity,
} from './entityCodeGenerator.js';
export {
  buildSqlQuerierMigrationModule,
  EMPTY_MANUAL_MIGRATION_DOWN_INNER,
  EMPTY_MANUAL_MIGRATION_UP_INNER,
  emitSqlRunCall,
  emitSqlRunCalls,
  type SqlMigrationModuleOptions,
} from './migrationFile.js';
