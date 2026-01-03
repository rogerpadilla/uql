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
});
