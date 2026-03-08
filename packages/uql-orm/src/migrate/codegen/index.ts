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
// Entity merger
export {
  createEntityMerger,
  EntityMerger,
  type EntityMergerOptions,
  type FieldToAdd,
  type FieldToDeprecate,
  type MergeResult,
} from './entityMerger.js';
// Migration code generator
export {
  createMigrationCodeGenerator,
  type GeneratedMigration,
  MigrationCodeGenerator,
  type MigrationCodeOptions,
} from './migrationCodeGenerator.js';
// Smart relation detector
export {
  createRelationDetector,
  type RelationDetectorOptions,
  SmartRelationDetector,
} from './smartRelationDetector.js';
