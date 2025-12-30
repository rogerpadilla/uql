import { beforeEach, describe, expect, it, jest } from 'bun:test';
import { Entity, Field, Id } from '../entity/index.js';
import type { QuerierPool, SqlQuerier, TableSchema } from '../type/index.js';
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
      run: jest.fn<any>().mockResolvedValue({}),
      all: jest.fn<any>().mockResolvedValue([]),
      beginTransaction: jest.fn<any>().mockResolvedValue(undefined),
      commitTransaction: jest.fn<any>().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn<any>().mockResolvedValue(undefined),
      release: jest.fn<any>().mockResolvedValue(undefined),
      dialect: {
        escapeIdChar: '"',
        placeholder: jest.fn<any>().mockReturnValue('?'),
      },
    };
    pool = {
      getQuerier: jest.fn<any>().mockResolvedValue(querier),
      dialect: 'postgres',
    } as unknown as QuerierPool;

    migrator = new Migrator(pool, {
      entities: [SyncUser, SyncProfile],
    });
  });

  it('should generate create statements for new tables', async () => {
    // Mock introspector to return nothing
    const introspector = {
      getTableSchema: jest.fn<any>().mockResolvedValue(undefined),
      getTableNames: jest.fn<any>().mockResolvedValue([]),
      tableExists: jest.fn<any>().mockResolvedValue(false),
    };
    migrator.schemaIntrospector = introspector as any;

    await migrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE "SyncUser"'));
    expect(querier.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE "SyncProfile"'));
  });

  it('should generate alter statements for missing columns', async () => {
    // Mock introspector to return existing table with one column missing
    const introspector = {
      getTableSchema: jest.fn<any>().mockImplementation((name: any) => {
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
    };
    migrator.schemaIntrospector = introspector as any;

    await migrator.autoSync({ logging: true });

    const querier = (await pool.getQuerier()) as SqlQuerier;
    expect(querier.run).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "SyncUser" ADD COLUMN "name" VARCHAR(255)'),
    );
  });
});
