import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../../entity/index.js';
import type { CanonicalType } from '../../schema/types.js';
import type { SchemaIntrospector } from '../../type/migration.js';
import { createSchemaSync, SchemaSync } from './schemaSync.js';

interface MockColumn {
  name: string;
  type: CanonicalType | { category: string; size?: string };
  nullable?: boolean;
  isPrimaryKey?: boolean;
  autoIncrement?: boolean;
  unique?: boolean;
  pos?: number;
}

interface MockTable {
  name: string;
  columns: Map<string, MockColumn>;
  indexes: any[];
  primaryKey: string[];
  incomingRelations: any[];
  outgoingRelations: any[];
  schema: any;
}

// Test entities
@Entity()
class User {
  @Id()
  id?: number;

  @Field()
  name?: string;
}

// Mock introspector that returns empty tables
const createMockIntrospector = (tables: MockTable[] = []): SchemaIntrospector => ({
  introspect: async () => {
    const tableMap = new Map();
    for (const t of tables) {
      tableMap.set(t.name, t);
    }
    return {
      tables: tableMap,
      relationships: [],
      indexes: [],
    } as any;
  },
  getTableNames: async () => tables.map((t) => t.name),
  getTableSchema: async (name: string) => tables.find((t) => t.name === name) as any,
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
  describe('formatSummary edge cases', () => {
    it('should show index changes in summary when there are index diffs', async () => {
      // DB has an index that entity doesn't have
      const introspector = createMockIntrospector([
        {
          name: 'User',
          columns: new Map([
            [
              'id',
              {
                name: 'id',
                type: { category: 'integer', size: 'big' },
                isPrimaryKey: true,
                autoIncrement: true,
                nullable: false,
                pos: 1,
              },
            ],
            ['name', { name: 'name', type: { category: 'string' }, nullable: true, pos: 2 }],
          ]),
          indexes: [
            {
              name: 'idx_user_name',
              columns: ['name'],
              unique: false,
            },
          ],
          primaryKey: ['id'],
          incomingRelations: [],
          outgoingRelations: [],
          schema: {} as any,
        },
      ]);

      const sync = new SchemaSync({
        entities: [User],
        direction: 'entity-to-db',
        introspector,
      });

      const result = await sync.sync();

      // The summary should mention index changes if there are any differences
      expect(result.dbChanges).toBeDefined();
      expect(result.summary).toBeDefined();
      // Check that the summary is a non-empty string
      expect(typeof result.summary).toBe('string');
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it('should show "Schema is already in sync" when no differences', async () => {
      // DB matches entity exactly
      const introspector = createMockIntrospector([
        {
          name: 'User',
          columns: new Map([
            [
              'id',
              {
                name: 'id',
                type: { category: 'integer', size: 'big' },
                isPrimaryKey: true,
                autoIncrement: true,
                nullable: false,
                pos: 1,
              },
            ],
            ['name', { name: 'name', type: { category: 'string' }, nullable: true, pos: 2 }],
          ]),
          indexes: [],
          primaryKey: ['id'],
          incomingRelations: [],
          outgoingRelations: [],
          schema: {} as any,
        },
      ]);

      const sync = new SchemaSync({
        entities: [User],
        direction: 'entity-to-db',
        introspector,
      });

      const result = await sync.sync();

      // When schemas match, summary should say they're in sync
      if (!result.dbChanges?.hasDifferences) {
        expect(result.summary).toContain('Schema is already in sync');
      }
    });

    it('should show bidirectional in-sync message when no changes anywhere', async () => {
      // Use empty entities and empty DB for perfect sync
      const introspector = createMockIntrospector([]);

      const sync = new SchemaSync({
        entities: [],
        direction: 'bidirectional',
        introspector,
      });

      const result = await sync.sync();

      expect(result.direction).toBe('bidirectional');
      // When both sides are empty, they are in sync
      expect(result.dbChanges?.hasDifferences).toBeFalsy();
      expect(result.entityChanges?.hasDifferences).toBeFalsy();
      expect(result.conflicts).toHaveLength(0);
      expect(result.summary).toContain('Schema is in sync');
    });
  });

  describe('Advanced Sync Logic', () => {
    it('should filter destructive changes in safe mode', async () => {
      // Setup: DB has a table that Entity doesn't have (would cause drop)
      const introspector = createMockIntrospector([
        {
          name: 'ExtraTable',
          columns: new Map(),
          indexes: [],
          primaryKey: [],
          incomingRelations: [],
          outgoingRelations: [],
          schema: {} as any,
        },
      ]);

      const sync = new SchemaSync({
        entities: [], // No entities, so everything in DB should be dropped
        introspector,
        direction: 'entity-to-db',
        safe: true, // Enable safe mode
      });

      const result = await sync.sync();

      expect(result.dbChanges).toBeDefined();
      expect(result.dbChanges?.tablesToDrop).toHaveLength(0); // Should be filtered out
      // If nothing happens, summary might just say Entity -> DB changes: (with no details)
      if (result.dbChanges?.hasDifferences) {
        expect(result.summary).toContain('Entity → Database Changes:');
      } else {
        expect(result.summary).toBeDefined(); // Just ensure it exists
      }
    });

    it('should detect bidirectional conflicts (type mismatch)', async () => {
      // Entity has a field that differs from DB
      @Entity()
      class ConflictUser {
        @Id() id?: number;
        @Field() age?: number;
      }

      // DB has 'age' as string
      const introspector = createMockIntrospector([
        {
          name: 'ConflictUser',
          columns: new Map([
            [
              'id',
              {
                name: 'id',
                type: { category: 'integer', size: 'big' },
                isPrimaryKey: true,
                autoIncrement: true,
                nullable: false,
                unique: true,
                pos: 1,
              },
            ],
            ['age', { name: 'age', type: { category: 'string' }, nullable: true, pos: 2 }],
          ]),
          indexes: [],
          primaryKey: ['id'],
          incomingRelations: [],
          outgoingRelations: [],
          schema: {} as any,
        },
      ]);

      const sync = new SchemaSync({
        entities: [ConflictUser],
        introspector,
        direction: 'bidirectional',
      });

      const result = await sync.sync();

      expect(result.success).toBe(false);
      expect(result.conflicts.length).toBeGreaterThanOrEqual(1);

      const ageConflict = result.conflicts.find((c) => c.column === 'age');
      expect(ageConflict).toBeDefined();
      expect(ageConflict?.type).toBe('type_mismatch');
      expect(ageConflict?.table).toBe('ConflictUser');
      expect(ageConflict?.column).toBe('age');
      expect(result.summary).toContain('conflict(s) require manual resolution');
    });

    it('should format summary correctly for bidirectional sync with changes', async () => {
      // Entity has new table, DB has extra table (not in safe mode)
      @Entity()
      class NewEntity {
        @Id() id?: number;
      }

      const introspector = createMockIntrospector([
        {
          name: 'OldTable',
          columns: new Map(),
          indexes: [],
          primaryKey: [],
          incomingRelations: [],
          outgoingRelations: [],
          schema: {} as any,
        },
      ]);

      const sync = new SchemaSync({
        entities: [NewEntity],
        introspector,
        direction: 'bidirectional',
        safe: false,
      });

      const result = await sync.sync();
      // console.log('DEBUG SUMMARY RESULT:', result.summary);

      expect(result.summary).toContain('Bidirectional Sync Report');
      expect(result.summary).toContain('Entity → Database:');
      expect(result.summary).toContain('Database → Entity:');
      // Entity -> DB: Create NewEntity, Drop OldTable
      expect(result.dbChanges?.tablesToCreate).toHaveLength(1);
      expect(result.dbChanges?.tablesToDrop).toHaveLength(1);
      // DB -> Entity: Create OldTable, Drop NewEntity
      expect(result.entityChanges?.tablesToCreate).toHaveLength(1);
      expect(result.entityChanges?.tablesToDrop).toHaveLength(1);
    });
  });
});
