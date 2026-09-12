import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongodbQuerierPool } from '../mongo/mongodbQuerierPool.js';
import { loadTsDefaultExport } from '../test/loadTsDefaultExport.js';
import { provisioningTimeout } from '../test/spec.util.js';
import type { MigrationDefinition, MongoQuerier } from '../type/index.js';
import { buildMigrationModule, emitMongoCommandCalls } from './codegen/migrationFile.js';
import { serializeMongoCommand } from './generator/mongoCommand.js';
import { defineMigration, Migrator } from './migrator.js';

describe('Migrator on MongoDB (integration)', () => {
  let replSet: MongoMemoryReplSet;
  let pool: MongodbQuerierPool;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    pool = new MongodbQuerierPool(replSet.getUri());
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.end();
    await replSet.stop();
  }, provisioningTimeout);

  it('applies a data migration, records it, and reverts it', async () => {
    const migrator = new Migrator(pool);
    await pool.withQuerier((querier) =>
      querier.db.collection('person').insertMany([{ name: 'Ada' }, { name: 'Alan' }]),
    );
    const migration = {
      name: '20260912000000_activate_people',
      ...defineMigration<MongoQuerier>({
        async up(querier) {
          await querier.db.collection('person').updateMany({}, { $set: { active: true } });
        },
        async down(querier) {
          await querier.db.collection('person').updateMany({}, { $unset: { active: '' } });
        },
      }),
    };
    vi.spyOn(migrator, 'getMigrations').mockResolvedValue([migration]);
    const active = () =>
      pool.withQuerier((querier) => querier.db.collection('person').countDocuments({ active: true }));

    expect(await migrator.status()).toEqual({ pending: [migration.name], executed: [] });

    expect(await migrator.up()).toMatchObject([{ name: migration.name, success: true }]);
    expect(await active()).toBe(2);
    expect(await migrator.status()).toEqual({ pending: [], executed: [migration.name] });

    expect(await migrator.down()).toMatchObject([{ name: migration.name, success: true }]);
    expect(await active()).toBe(0);
    expect(await migrator.status()).toEqual({ pending: [migration.name], executed: [] });
  });

  it('runs a generated migration module: collection and index up, collection down', async () => {
    const index = 'ticket__subject_idx';
    const source = buildMigrationModule({
      migrationName: 'ticket',
      createdAt: new Date('2026-09-12T00:00:00.000Z'),
      querier: 'MongoQuerier',
      upInner: emitMongoCommandCalls([
        serializeMongoCommand({ action: 'createCollection', name: 'ticket' }),
        serializeMongoCommand({
          action: 'createIndex',
          collection: 'ticket',
          name: index,
          key: { subject: 1 },
          options: { unique: true, name: index },
        }),
      ]),
      downInner: emitMongoCommandCalls([serializeMongoCommand({ action: 'dropCollection', name: 'ticket' })]),
    });
    const migration = await loadTsDefaultExport<MigrationDefinition<MongoQuerier>>(source);

    await pool.withQuerier(async (querier) => {
      await migration.up(querier);
      expect((await querier.db.collection('ticket').indexes()).map((it) => it.name)).toEqual(['_id_', index]);

      await migration.down(querier);
      expect(await querier.db.listCollections({ name: 'ticket' }).toArray()).toEqual([]);
    });
  });
});
