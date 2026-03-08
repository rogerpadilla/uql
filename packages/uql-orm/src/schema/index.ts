/**
 * Schema AST Module
 *
 * Provides a unified graph representation of database schema for:
 * - Schema diffing and migration generation
 * - Entity code generation from database
 * - Drift detection
 * - Smart relation inference
 */

import type { SchemaIntrospector } from '../type/migration.js';
import type { SchemaAST } from './schemaAST.js';

export type { DialectConfig } from '../dialect/index.js';
// Dialect configuration
export { DIALECT_CONFIG, getDialectConfig } from '../dialect/index.js';
// Canonical type utilities
export {
  areTypesEqual,
  canonicalToColumnType,
  canonicalToSql,
  canonicalToTypeScript,
  fieldOptionsToCanonical,
  isBreakingTypeChange,
  sqlToCanonical,
} from './canonicalType.js';

/**
 * Introspect the database and build a SchemaAST from it.
 *
 * @param introspector - The schema introspector to use
 * @returns The SchemaAST representing the database schema
 */
export async function introspectSchema(introspector: SchemaIntrospector): Promise<SchemaAST> {
  return introspector.introspect();
}
// SchemaAST class
export { SchemaAST } from './schemaAST.js';
export type { BuildFromEntitiesOptions } from './schemaASTBuilder.js';

// Builder
export { SchemaASTBuilder } from './schemaASTBuilder.js';
export type { DiffOptions } from './schemaASTDiffer.js';

// Differ
export { diffSchemas, SchemaASTDiffer } from './schemaASTDiffer.js';
// Types
export type {
  // Core node types
  CanonicalType,
  // Diff types
  ColumnDiff,
  ColumnNode,
  ConflictResolution,
  // Relation detection types
  DetectedRelation,
  // Drift detection types
  Drift,
  DriftReport,
  DriftSeverity,
  DriftStatus,
  DriftType,
  ForeignKeyAction,
  IndexDiff,
  IndexNode,
  IndexSource,
  IndexSyncStatus,
  IndexType,
  RelationshipDiff,
  RelationshipNode,
  RelationshipSource,
  RelationshipType,
  SchemaAST as ISchemaAST,
  SchemaDiffResult,
  SizeVariant,
  // Sync types
  SyncDirection,
  SyncOptions,
  TableDiff,
  TableNode,
  // Type categories and variants
  TypeCategory,
  // Validation types
  ValidationError,
  ValidationErrorType,
} from './types.js';
