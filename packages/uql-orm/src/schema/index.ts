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
export { createOrder, dropOrder, findCycles, type DependenciesOf } from './dependencyGraph.js';
export { SchemaAST } from './schemaAST.js';
export type { BuildSchemaASTOptions } from './schemaASTBuilder.js';

// Builder
export { buildSchemaAST } from './schemaASTBuilder.js';
export type { DiffOptions } from './schemaASTDiffer.js';

// Differ
export { diffSchemas } from './schemaASTDiffer.js';
// Types
export type {
  // Core node types
  CanonicalType,
  // Diff types
  ColumnDiff,
  ColumnNode,
  // Relation detection types
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
  TableDiff,
  TableNode,
  // Type categories and variants
  TypeCategory,
  // Validation types
  ValidationError,
  ValidationErrorType,
} from './types.js';
