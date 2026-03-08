import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import type { QuerierPool } from '../type/index.js';
import { Migrator } from './migrator.js';

@Entity()
class SyncMongoUser {
  @Id() id?: string;
  @Field({ index: true }) name?: string;
}

describe('Migrator autoSync MongoDB Integration', () => {
  let migrator: Migrator;
  let pool: QuerierPool;
  let db: any;

  beforeEach(() => {
    db = {
      listCollections: vi.fn<any>().mockReturnValue({
        toArray: vi.fn<any>().mockResolvedValue([]),
      }),
      createCollection: vi.fn<any>().mockResolvedValue({}),
      collection: vi.fn<any>().mockReturnValue({
        indexes: vi.fn<any>().mockResolvedValue([]),
        createIndex: vi.fn<any>().mockResolvedValue({}),
      }),
    };

    const querier = {
      db,
      release: vi.fn<any>().mockResolvedValue(undefined),
    };

    pool = {
      getQuerier: vi.fn<any>().mockResolvedValue(querier),
      dialect: 'mongodb',
    } as unknown as QuerierPool;

    migrator = new Migrator(pool, {
      entities: [SyncMongoUser],
    });
  });

  it('should generate createCollection and createIndex for MongoDB', async () => {
    await migrator.autoSync({ logging: true });

    expect(db.createCollection).toHaveBeenCalledWith('SyncMongoUser');
    expect(db.collection).toHaveBeenCalledWith('SyncMongoUser');
    expect(db.collection('SyncMongoUser').createIndex).toHaveBeenCalledWith(
      { name: 1 },
      expect.objectContaining({ name: 'idx_SyncMongoUser_name' }),
    );
  });
});
