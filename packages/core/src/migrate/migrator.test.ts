import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import type { QuerierPool, SchemaIntrospector, SqlQuerier, TableSchema } from '../type/index.js';
import { Migrator } from './migrator.js';

@Entity()
class SyncUser {
  @Id() id?: number;
  @Field() name?: string;
}

@Entity()
class SyncProfile {
  @Id() id?: number;
  @Field() bio?: string;
  @Field({ reference: () => SyncUser }) userId?: number;
}

describe('Migrator autoSync Integration', () => {
  let migrator: Migrator;
  let pool: QuerierPool;

  beforeEach(() => {
    // Mock pool and querier for testing
    const querier = {
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue([]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      dialect: {
        escapeIdChar: '"',
        placeholder: vi.fn().mockReturnValue('?'),
      },
    } as unknown as SqlQuerier;
    pool = {
      getQuerier: vi.fn().mockResolvedValue(querier),
      dialect: 'postgres',
    } as unknown as QuerierPool;

    migrator = new Migrator(pool, {
      entities: [SyncUser, SyncProfile],
    });
  });

  it('should generate create statements for new tables', async () => {
    // Mock introspector to return nothing
    const introspector = {
      getTableSchema: vi.fn().mockResolvedValue(undefined),
      getTableNames: vi.fn().mockResolvedValue([]),
      tableExists: vi.fn().mockResolvedValue(false),
    } as unknown as SchemaIntrospector;
    migrator.schemaIntrospector = introspector;

    await migrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE "SyncUser"'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE "SyncProfile"'));
  });

  it('should generate alter statements for missing columns', async () => {
    // Mock introspector to return existing table with one column missing
    const introspector = {
      getTableSchema: vi.fn().mockImplementation((name: string) => {
        if (name === 'SyncUser') {
          return Promise.resolve({
            name: 'SyncUser',
            columns: [
              {
                name: 'id',
                type: 'INTEGER',
                nullable: false,
                isPrimaryKey: true,
                isAutoIncrement: true,
                isUnique: false,
              },
            ],
          } as TableSchema);
        }
        return Promise.resolve(undefined);
      }),
    } as unknown as SchemaIntrospector;
    migrator.schemaIntrospector = introspector;

    await migrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE "SyncUser" ADD COLUMN "name" TEXT'));
  });

  it('should detect and sync new properties added to existing entities', async () => {
    // This test simulates the real-world scenario where:
    // 1. A table already exists in the database with some columns
    // 2. The developer adds a new @Field() property to the entity class
    // 3. autoSync should detect this new field and add the column to the database

    // Simulate existing database state: SyncUser table exists with only 'id' and 'name' columns
    const introspector = {
      getTableSchema: vi.fn().mockImplementation((name: string) => {
        if (name === 'SyncUser') {
          return Promise.resolve({
            name: 'SyncUser',
            columns: [
              {
                name: 'id',
                type: 'BIGINT',
                nullable: false,
                isPrimaryKey: true,
                isAutoIncrement: true,
                isUnique: false,
              },
              {
                name: 'name',
                type: 'TEXT',
                nullable: true,
                isPrimaryKey: false,
                isAutoIncrement: false,
                isUnique: false,
              },
            ],
          } as TableSchema);
        }
        if (name === 'SyncProfile') {
          return Promise.resolve({
            name: 'SyncProfile',
            columns: [
              {
                name: 'id',
                type: 'BIGINT',
                nullable: false,
                isPrimaryKey: true,
                isAutoIncrement: true,
                isUnique: false,
              },
              {
                name: 'bio',
                type: 'TEXT',
                nullable: true,
                isPrimaryKey: false,
                isAutoIncrement: false,
                isUnique: false,
              },
            ],
          } as TableSchema);
        }
        return Promise.resolve(undefined);
      }),
    } as unknown as SchemaIntrospector;
    migrator.schemaIntrospector = introspector;

    // Now when autoSync runs, it should detect that:
    // - SyncProfile entity has a 'userId' field that doesn't exist in the database
    await migrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;

    // Verify that the introspector was called for both entities
    expect(introspector.getTableSchema).toHaveBeenCalledWith('SyncUser');
    expect(introspector.getTableSchema).toHaveBeenCalledWith('SyncProfile');

    // Verify that ALTER TABLE was called to add the missing 'userId' column to SyncProfile
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE "SyncProfile" ADD COLUMN "userId"'));

    // Verify that no changes were made to SyncUser (all columns already exist)
    const allCalls = (querier.run as ReturnType<typeof vi.fn>).mock.calls;
    const syncUserAlterCalls = allCalls.filter((call) => String(call[0]).includes('ALTER TABLE "SyncUser"'));
    expect(syncUserAlterCalls).toHaveLength(0);
  });

  it('should handle multiple new properties added to the same entity', async () => {
    // Create a new entity with multiple fields for this test
    @Entity()
    class MultiFieldUser {
      @Id() id?: number;
      @Field() username?: string;
      @Field() email?: string;
      @Field() age?: number;
      @Field() isActive?: boolean;
    }

    const multiFieldMigrator = new Migrator(pool, {
      entities: [MultiFieldUser],
    });

    // Simulate database state: table exists but only has 'id' and 'username'
    const introspector = {
      getTableSchema: vi.fn().mockImplementation((name: string) => {
        if (name === 'MultiFieldUser') {
          return Promise.resolve({
            name: 'MultiFieldUser',
            columns: [
              {
                name: 'id',
                type: 'BIGINT',
                nullable: false,
                isPrimaryKey: true,
                isAutoIncrement: true,
                isUnique: false,
              },
              {
                name: 'username',
                type: 'TEXT',
                nullable: true,
                isPrimaryKey: false,
                isAutoIncrement: false,
                isUnique: false,
              },
            ],
          } as TableSchema);
        }
        return Promise.resolve(undefined);
      }),
    } as unknown as SchemaIntrospector;
    multiFieldMigrator.schemaIntrospector = introspector;

    await multiFieldMigrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;

    // Should add all three missing columns: email, age, isActive
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN "email"'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN "age"'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN "isActive"'));
  });
});
