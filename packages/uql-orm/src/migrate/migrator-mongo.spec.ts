import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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

/** A migrations directory of its own for this test, removed when the test finishes. */
async function migrationsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uql-mongo-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
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

  it('scaffolds a migration typed on the MongoDB querier', async () => {
    const migrator = new Migrator(pool, { migrationsPath: await migrationsDir() });

    const source = await readFile(await migrator.generate('seed'), 'utf8');

    expect(source).toContain(`import type { MongoQuerier } from 'uql-orm/migrate';`);
    expect(source).toContain('async up(querier: MongoQuerier): Promise<void> {');
    expect(source).not.toContain('querier.run(');
  });

  it('generates a migration from the entities as MongoDB driver calls', async () => {
    const migrator = new Migrator(pool, {
      entities: [SyncMongoUser],
      migrationsPath: await migrationsDir(),
    });

    const source = await readFile(await migrator.generateFromEntities('init'), 'utf8');

    expect(source).toContain('async up(querier: MongoQuerier): Promise<void> {');
    expect(source).toContain('    await querier.db.createCollection("SyncMongoUser");');
    expect(source).toContain(
      '    await querier.db.collection("SyncMongoUser").createIndex({"name":1}, {"unique":false,"name":"SyncMongoUser__name_idx"});',
    );
    expect(source).toContain('    await querier.db.collection("SyncMongoUser").drop();');
    expect(source).not.toContain('querier.run(');
  });
});
