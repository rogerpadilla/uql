import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { MongodbQuerierPool } from '../mongo/mongodbQuerierPool.js';
import { loadTsDefaultExport } from '../test/loadTsDefaultExport.js';
import { provisioningTimeout } from '../test/spec.util.js';
import type { MigrationDefinition, MongoQuerier } from '../type/index.js';
import { buildMigrationModule, emitMongoCommandCalls } from './codegen/migrationFile.js';
import { runMongoCommand, serializeMongoCommand } from './generator/mongoCommand.js';
import { MongoSchemaGenerator } from './generator/mongoSchemaGenerator.js';
import { defineBuilderMigration, defineMigration, Migrator } from './migrator.js';

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

  it('runs a builder migration: a collection created, renamed and indexed, then dropped', async () => {
    const migration = defineBuilderMigration<MongoQuerier>({
      async up(m) {
        await m.createTable('draft', (table) => table.index(['title'], 'draft_title_idx'));
        await m.renameTable('draft', 'article');
        await m.createIndex('article', ['slug'], { unique: true });
      },
      async down(m) {
        await m.dropTable('article');
      },
    });

    await pool.withQuerier(async (querier) => {
      await migration.up(querier);
      expect((await querier.db.collection('article').indexes()).map((it) => it.name)).toEqual([
        '_id_',
        'draft_title_idx',
        'article__slug_idx',
      ]);

      await migration.down(querier);
      expect(await querier.db.listCollections({ name: 'article' }).toArray()).toEqual([]);
    });
  });

  it('creates the partial index an entity declares, unique only among the documents its filter covers', async () => {
    const partialFilterExpression = { priority: { $gte: 2 }, $or: [{ status: 'open' }, { status: 'held' }] };
    @Index((ticket) => [ticket.assignee], {
      name: 'urgent_assignee_idx',
      unique: true,
      where: partialFilterExpression,
    })
    @Entity()
    class UrgentTicket {
      @Id({ type: String }) id?: string;
      @Field({ type: String }) assignee?: string;
      @Field({ type: String }) status?: string;
      @Field({ type: Number }) priority?: number;
    }

    await pool.withQuerier(async (querier) => {
      for (const statement of new MongoSchemaGenerator().generateCreateTable(UrgentTicket)) {
        await runMongoCommand(querier.db, statement);
      }
      const tickets = querier.db.collection('UrgentTicket');
      expect(await tickets.indexes()).toContainEqual(
        expect.objectContaining({ name: 'urgent_assignee_idx', unique: true, partialFilterExpression }),
      );

      await tickets.insertMany([
        { assignee: 'ada', priority: 1, status: 'open' },
        { assignee: 'ada', priority: 1, status: 'open' },
        { assignee: 'ada', priority: 3, status: 'open' },
      ]);
      await expect(tickets.insertOne({ assignee: 'ada', priority: 2, status: 'held' })).rejects.toThrow(
        /duplicate key/,
      );
    });
  });
});
