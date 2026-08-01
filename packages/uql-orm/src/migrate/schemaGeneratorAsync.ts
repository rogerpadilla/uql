import type { AbstractDialect } from '../dialect/abstractDialect.js';
import type { ForeignKeyAction } from '../schema/types.js';
import type { SchemaGenerator } from '../type/index.js';
import { createSchemaGenerator } from './schemaGenerator.js';

/**
 * Async factory for schema generators. Use this for MongoDB so the optional peer
 * `mongodb` is only loaded when this path runs. SQL dialects delegate to {@link createSchemaGenerator}.
 */
export async function createSchemaGeneratorAsync(
  dialect: AbstractDialect,
  defaultForeignKeyAction?: ForeignKeyAction,
): Promise<SchemaGenerator | undefined> {
  if (dialect.dialectName === 'mongodb') {
    const { MongoSchemaGenerator } = await import('./generator/mongoSchemaGenerator.js');
    return new MongoSchemaGenerator(dialect.namingStrategy, defaultForeignKeyAction);
  }
  return createSchemaGenerator(dialect, defaultForeignKeyAction);
}
