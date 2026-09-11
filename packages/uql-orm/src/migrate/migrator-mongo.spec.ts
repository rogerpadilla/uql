import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { MongoDialect } from '../mongo/mongoDialect.js';
import { createMockQuerierPool } from '../test/mockQuerierPool.js';
import type { MigratorDialect, Querier, QuerierPool } from '../type/index.js';
import { Migrator } from './migrator.js';

@Entity()
class SyncMongoUser {
  @Id({ type: String }) id?: string;
  @Field({ type: String, index: true }) name?: string;
}

describe('Migrator sync MongoDB Integration', () => {
  let migrator: Migrator;
  let pool: QuerierPool<Querier, MigratorDialect>;
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

    pool = createMockQuerierPool(new MongoDialect(), async () => querier as unknown as Querier);

    migrator = new Migrator(pool, {
      entities: [SyncMongoUser],
    });
  });

  it('creates one collection for a single entity, as `syncEntity` does elsewhere', async () => {
    await migrator.sync({ entity: SyncMongoUser, logging: true });

    expect(db.createCollection).toHaveBeenCalledWith('SyncMongoUser');
  });

  it('should generate createCollection and createIndex for MongoDB', async () => {
    await migrator.sync({ logging: true });

    expect(db.createCollection).toHaveBeenCalledWith('SyncMongoUser');
    expect(db.collection).toHaveBeenCalledWith('SyncMongoUser');
    expect(db.collection('SyncMongoUser').createIndex).toHaveBeenCalledWith(
      { name: 1 },
      expect.objectContaining({ name: 'SyncMongoUser__name_idx' }),
    );
  });
});
