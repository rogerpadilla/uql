import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { SchemaAST } from '../schema/schemaAST.js';
import type { CanonicalType, ColumnNode, TableNode } from '../schema/types.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { createMockQuerier } from '../test/mockQuerier.js';
import { createMockQuerierPool } from '../test/mockQuerierPool.js';
import type { QuerierPool, SchemaIntrospector, SqlQuerier } from '../type/index.js';
import { Migrator } from './migrator.js';

const BIG_INT: CanonicalType = { category: 'integer', size: 'big' };
const TEXT: CanonicalType = { category: 'string' };

/**
 * An introspector reporting the given tables, each a column name to its canonical type. A real
 * {@link SchemaAST} rather than an object literal: the four hand-rolled mocks this replaced each
 * declared column types as SQL strings behind `as any`, which the generator has never produced, and
 * that fiction was the only thing keeping a dead `typeof type === 'string'` branch alive in it.
 */
function introspectorOf(tables: Record<string, Record<string, CanonicalType>>): SchemaIntrospector {
  const ast = new SchemaAST();

  for (const [tableName, columns] of Object.entries(tables)) {
    const table: TableNode = {
      name: tableName,
      columns: new Map(),
      primaryKey: [],
      indexes: [],
      schema: ast,
      incomingRelations: [],
      outgoingRelations: [],
    };
    for (const [columnName, type] of Object.entries(columns)) {
      const isPrimaryKey = columnName === 'id';
      const column: ColumnNode = {
        name: columnName,
        type,
        nullable: !isPrimaryKey,
        isPrimaryKey,
        isAutoIncrement: isPrimaryKey,
        isUnique: false,
        table,
        referencedBy: [],
      };
      table.columns.set(columnName, column);
      if (isPrimaryKey) {
        table.primaryKey.push(column);
      }
    }
    ast.addTable(table);
  }

  return {
    introspect: vi.fn().mockResolvedValue(ast),
    getTableNames: vi.fn().mockResolvedValue(Object.keys(tables)),
    getTableSchema: vi.fn().mockResolvedValue(undefined),
    tableExists: vi.fn().mockImplementation((name: string) => Promise.resolve(name in tables)),
  };
}

@Entity()
class SyncUser {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
}

@Entity()
class SyncProfile {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) bio?: string;
  @Field({ references: () => SyncUser }) userId?: number;
}

describe('Migrator autoSync Integration', () => {
  let migrator: Migrator;
  let pool: QuerierPool;

  beforeEach(() => {
    // Mock pool and querier for testing
    const sqliteDialect = new SqliteDialect();
    const querier = createMockQuerier({
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue([]),
      dialect: sqliteDialect,
    }) as unknown as SqlQuerier;
    pool = createMockQuerierPool(sqliteDialect, vi.fn().mockResolvedValue(querier));

    migrator = new Migrator(pool, {
      entities: [SyncUser, SyncProfile],
    });
  });

  it('should generate create statements for new tables', async () => {
    // Mock introspector to return nothing (no tables)
    migrator.schemaIntrospector = introspectorOf({});

    await migrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE `SyncUser`'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE `SyncProfile`'));
  });

  it('should generate alter statements for missing columns', async () => {
    // Mock introspector to return existing table with one column missing
    migrator.schemaIntrospector = introspectorOf({ SyncUser: { id: BIG_INT } });

    await migrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE `SyncUser` ADD COLUMN `name` TEXT'));
  });

  it('should detect and sync new properties added to existing entities', async () => {
    // This test simulates the real-world scenario where:
    // 1. A table already exists in the database with some columns
    // 2. The developer adds a new @Field() property to the entity class
    // 3. autoSync should detect this new field and add the column to the database

    // Simulate existing database state: SyncUser table exists with only 'id' and 'name' columns
    const introspector = introspectorOf({
      SyncUser: { id: BIG_INT, name: TEXT },
      SyncProfile: { id: BIG_INT, bio: TEXT },
    });
    migrator.schemaIntrospector = introspector;

    // Now when autoSync runs, it should detect that:
    // - SyncProfile entity has a 'userId' field that doesn't exist in the database
    await migrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;

    // Verify that the introspector was called
    expect(introspector.introspect).toHaveBeenCalled();

    // Verify that ALTER TABLE was called to add the missing 'userId' column to SyncProfile
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE `SyncProfile` ADD COLUMN `userId`'));

    // Verify that no changes were made to SyncUser (all columns already exist)
    const allCalls = (querier.run as ReturnType<typeof vi.fn>).mock.calls;
    const syncUserAlterCalls = allCalls.filter((call) => String(call[0]).includes('ALTER TABLE `SyncUser`'));
    expect(syncUserAlterCalls).toHaveLength(0);
  });

  it('should handle multiple new properties added to the same entity', async () => {
    // Create a new entity with multiple fields for this test
    @Entity()
    class MultiFieldUser {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) username?: string;
      @Field({ type: String }) email?: string;
      @Field({ type: Number }) age?: number;
      @Field({ type: Boolean }) isActive?: boolean;
    }

    const multiFieldMigrator = new Migrator(pool, {
      entities: [MultiFieldUser],
    });

    // Simulate database state: table exists but only has 'id' and 'username'
    multiFieldMigrator.schemaIntrospector = introspectorOf({
      MultiFieldUser: { id: BIG_INT, username: TEXT },
    });

    await multiFieldMigrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;

    // Should add all three missing columns: email, age, isActive
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN `email`'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN `age`'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN `isActive`'));
  });
});
