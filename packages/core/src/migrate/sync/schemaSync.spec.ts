import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../../entity/index.js';
import { SchemaASTBuilder } from '../../schema/schemaASTBuilder.js';
import type { SchemaIntrospector, TableSchema } from '../../type/migration.js';
import { createSchemaSync, SchemaSync } from './schemaSync.js';

// Test entities
@Entity()
class User {
  @Id()
  id?: number;

  @Field()
  name?: string;
}

// Mock introspector that returns empty tables
const createMockIntrospector = (tables: TableSchema[] = []): SchemaIntrospector => ({
  introspect: async () => {
    const builder = new SchemaASTBuilder();
    // Since fromDatabase was removed, we would ideally build the AST manually or
    // use a helper. For tests, we'll build it from entities or manually.
    // However, the existing tests pass table schemas.
    // We can't easily convert TableSchema to TableNode without the builder helper.
    // For now, let's return a basic AST.
    return {
      tables: new Map(),
      relationships: [],
      indexes: [],
    } as any;
  },
  getTableNames: async () => tables.map((t) => t.name),
  tableExists: async (name: string) => tables.some((t) => t.name === name),
});

describe('SchemaSync', () => {
  describe('constructor', () => {
    it('should create instance with required options', () => {
      const sync = new SchemaSync({
        entities: [User],
        introspector: createMockIntrospector(),
      });

      expect(sync).toBeDefined();
    });

    it('should accept direction option', () => {
      const sync = new SchemaSync({
        entities: [User],
        direction: 'entity-to-db',
        introspector: createMockIntrospector(),
      });

      expect(sync).toBeDefined();
    });

    it('should accept safe mode option', () => {
      const sync = new SchemaSync({
        entities: [User],
        safe: true,
        introspector: createMockIntrospector(),
      });

      expect(sync).toBeDefined();
    });

    it('should accept dryRun option', () => {
      const sync = new SchemaSync({
        entities: [User],
        dryRun: true,
        introspector: createMockIntrospector(),
      });

      expect(sync).toBeDefined();
    });
  });

  describe('sync', () => {
    it('should return sync result for entity-to-db', async () => {
      const sync = new SchemaSync({
        entities: [User],
        direction: 'entity-to-db',
        introspector: createMockIntrospector(),
      });

      const result = await sync.sync();

      expect(result).toBeDefined();
      expect(result.direction).toBe('entity-to-db');
      expect(result.success).toBe(true);
    });

    it('should return sync result for db-to-entity', async () => {
      const sync = new SchemaSync({
        entities: [User],
        direction: 'db-to-entity',
        introspector: createMockIntrospector(),
      });

      const result = await sync.sync();

      expect(result).toBeDefined();
      expect(result.direction).toBe('db-to-entity');
    });

    it('should return sync result for bidirectional', async () => {
      const sync = new SchemaSync({
        entities: [User],
        direction: 'bidirectional',
        introspector: createMockIntrospector(),
      });

      const result = await sync.sync();

      expect(result).toBeDefined();
      expect(result.direction).toBe('bidirectional');
    });

    it('should include summary in result', async () => {
      const sync = new SchemaSync({
        entities: [User],
        introspector: createMockIntrospector(),
      });

      const result = await sync.sync();

      expect(result.summary).toBeDefined();
    });

    it('should use createSchemaSync convenience function', () => {
      const sync = createSchemaSync({
        direction: 'bidirectional',
        entities: [],
        introspector: createMockIntrospector([]),
      });
      expect(sync).toBeInstanceOf(SchemaSync);
    });
  });
});
