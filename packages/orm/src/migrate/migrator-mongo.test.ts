import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index, Trigger } from '../entity/index.js';
import { runMongoCommand, serializeMongoCommand } from '../mongodb/mongoCommand.js';
import type { MongoQuerier } from '../mongodb/mongoQuerier.js';
import { MongoSchemaGenerator } from '../mongodb/mongoSchemaGenerator.js';
import { MongodbQuerierPool } from '../mongodb/mongodbQuerierPool.js';
import { loadTsDefaultExport, migrationsDir, mongoUri, provisioningTimeout } from '../test/index.js';
import type { MigrationDefinition } from '../type/index.js';
import { raw } from '../util/index.js';
import { buildMigrationModule, emitMongoCommandCalls } from './codegen/migrationFile.js';
import { migrationBuilderFor } from './migrationTarget.js';
import { defineBuilderMigration, Migrator } from './migrator.js';

describe('Migrator on MongoDB (integration)', () => {
  const pool = new MongodbQuerierPool(mongoUri('uql_migrate'));

  beforeAll(() => pool.withQuerier((querier) => querier.db.dropDatabase()), provisioningTimeout);

  afterAll(() => pool.end());

  const noSql = 'mongodb has no SQL to render a check, a computed column or an index expression into';

  /** A collection's index names, in the order MongoDB lists them. */
  const indexNames = (collection: string) =>
    pool.withQuerier(async ({ db }) => (await db.collection(collection).indexes()).map((it) => it.name));

  it('should apply a data migration, record it, and revert it', async () => {
    const migrationsPath = await migrationsDir();
    const name = '20260912000000_activate_people';
    await writeFile(
      join(migrationsPath, `${name}.mjs`),
      `export default {
        up: (querier) => querier.db.collection('person').updateMany({}, { $set: { active: true } }),
        down: (querier) => querier.db.collection('person').updateMany({}, { $unset: { active: '' } }),
      };`,
    );
    const migrator = new Migrator(pool, { migrationsPath });
    await pool.withQuerier((querier) =>
      querier.db.collection('person').insertMany([{ name: 'Ada' }, { name: 'Alan' }]),
    );
    const active = () =>
      pool.withQuerier((querier) => querier.db.collection('person').countDocuments({ active: true }));

    expect(await migrator.status()).toEqual({ pending: [name], executed: [] });

    expect(await migrator.up()).toMatchObject([{ name, direction: 'up' }]);
    expect(await active()).toBe(2);
    expect(await migrator.status()).toEqual({ pending: [], executed: [name] });

    expect(await migrator.down()).toMatchObject([{ name, direction: 'down' }]);
    expect(await active()).toBe(0);
    expect(await migrator.status()).toEqual({ pending: [name], executed: [] });
  });

  /** MongoDB has no lock a session holds, so a run records one in the journal for as long as it runs. */
  it('should run each pending migration once when two instances run up at once', async () => {
    const migrationsPath = await migrationsDir();
    for (const [name, wait] of [
      ['m1', 300],
      ['m2', 0],
      ['m3', 0],
    ] as const) {
      await writeFile(
        join(migrationsPath, `${name}.mjs`),
        `export default {
          async up(querier) {
            await new Promise((resolve) => setTimeout(resolve, ${wait}));
            await querier.db.collection('counter').updateOne({ _id: 'runs' }, { $inc: { n: 1 } });
          },
          async down() {},
        };`,
      );
    }
    type Counter = { _id: string; n: number };
    await pool.withQuerier(({ db }) => db.collection<Counter>('counter').insertOne({ _id: 'runs', n: 0 }));
    const instance = () => new Migrator(pool, { migrationsPath, tableName: 'uql_migrations_counter' });

    const runs = await Promise.all([instance().up(), instance().up()]);

    expect(runs.flat().map((result) => result.name)).toEqual(['m1', 'm2', 'm3']);
    expect(await pool.withQuerier(({ db }) => db.collection<Counter>('counter').findOne({ _id: 'runs' }))).toEqual({
      _id: 'runs',
      n: 3,
    });
    expect(await instance().status()).toEqual({ pending: [], executed: ['m1', 'm2', 'm3'] });
  });

  it('should give up waiting for the lock once its timeout passes, saying how to release it', async () => {
    const migrationsPath = await migrationsDir();
    const journal = 'uql_migrations_held';
    await pool.withQuerier((querier) => querier.db.collection<{ _id: string }>(journal).insertOne({ _id: 'uql/lock' }));

    await expect(new Migrator(pool, { migrationsPath, tableName: journal, lockTimeout: 0 }).up()).rejects.toThrow(
      `Gave up after 0ms waiting for the migration lock on "${journal}", which another run holds. If none is running, one stopped before releasing it: delete the document 'uql/lock' from "${journal}".`,
    );
  });

  it('should run a generated migration module: collection and index up, collection down', async () => {
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

  it('should run a builder migration: a collection created, renamed and indexed, then dropped', async () => {
    const migration = defineBuilderMigration<MongoQuerier>({
      async up(m) {
        await m.createTable('draft', (table) => table.index(['title'], 'draft_title_idx'));
        await m.renameTable('draft', 'article');
        await m.createIndex('article', ['slug'], { unique: true });
        await m.createIndex('article', ['author'], { name: 'article_author_idx' });
        await m.dropIndex('article', 'article_author_idx');
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

  it('should refuse a column, or SQL in an index, which a collection has nowhere to hold', async () => {
    await pool.withQuerier(async (querier) => {
      const builder = await migrationBuilderFor(querier);
      await expect(builder.addColumn('article', (c) => c.string('nickname'))).rejects.toThrow(
        'mongodb does not support addColumn in a migration',
      );
      await expect(builder.createTable('profile', (table) => table.string('nickname'))).rejects.toThrow(
        'mongodb does not support columns in a migration (collection "profile")',
      );
      await expect(builder.createIndex('article', [raw`lower(title)`])).rejects.toThrow(noSql);
      await expect(builder.createIndex('article', ['title'], { where: raw`title IS NOT NULL` })).rejects.toThrow(noSql);
    });
  });

  it('should refuse to sync an entity indexing a SQL expression', async () => {
    @Index((row) => [raw`lower(${row.title})`])
    @Entity()
    class ExpressionMongoIndex {
      @Id({ type: String }) id?: string;
      @Field({ type: String }) title?: string | null;
    }
    const migrator = new Migrator(pool, { entities: [ExpressionMongoIndex] });

    await expect(migrator.planSync()).rejects.toThrow(noSql);
  });

  it('should plan nothing for the trigger an entity declares, which MongoDB has none to run', async () => {
    @Trigger({ on: 'afterInsert', run: (row) => raw`PERFORM ${row.id};` })
    @Entity()
    class TriggeredMongoNote {
      @Id({ type: String }) id?: string;
      @Field({ type: String }) body?: string | null;
    }
    await pool.withQuerier(({ db }) => db.createCollection('TriggeredMongoNote'));
    const migrator = new Migrator(pool, { entities: [TriggeredMongoNote] });

    expect(await migrator.planSync({ safe: false })).toEqual([]);
  });

  it('should create the partial index an entity declares, unique only among the documents its filter covers', async () => {
    const partialFilterExpression = { priority: { $gte: 2 }, $or: [{ status: 'open' }, { status: 'held' }] };
    @Index((ticket) => [ticket.assignee], {
      name: 'urgent_assignee_idx',
      unique: true,
      where: partialFilterExpression,
    })
    @Entity()
    class UrgentTicket {
      @Id({ type: String }) id?: string;
      @Field({ type: String }) assignee?: string | null;
      @Field({ type: String }) status?: string | null;
      @Field({ type: Number }) priority?: number | null;
    }

    await pool.withQuerier(async (querier) => {
      for (const statement of new MongoSchemaGenerator().generateCreateSchema([UrgentTicket])) {
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

  it('should sync one entity, or every one, to a collection with the indexes it declares', async () => {
    @Entity()
    class SyncMongoUser {
      @Id({ type: String }) id?: string;
      @Field({ type: String, index: true }) name?: string | null;
    }
    @Entity()
    class SyncMongoTag {
      @Id({ type: String }) id?: string;
      @Field({ type: String, index: true }) label?: string | null;
    }
    const migrator = new Migrator(pool, { entities: [SyncMongoUser, SyncMongoTag] });

    await migrator.sync({ entity: SyncMongoUser });
    expect(await indexNames('SyncMongoUser')).toEqual(['_id_', 'SyncMongoUser__name_idx']);
    expect(await pool.withQuerier((querier) => querier.db.listCollections({ name: 'SyncMongoTag' }).toArray())).toEqual(
      [],
    );

    await migrator.sync();
    expect(await indexNames('SyncMongoTag')).toEqual(['_id_', 'SyncMongoTag__label_idx']);
  });

  it('should drop the index an entity replaced, only outside safe mode, and keep one named by hand', async () => {
    @Index((row) => [row.kind, row.status])
    @Entity()
    class SyncMongoReindex {
      @Id({ type: String }) id?: string;
      @Field({ type: String }) kind?: string | null;
      @Field({ type: String }) status?: string | null;
    }
    await pool.withQuerier(async ({ db }) => {
      await db.collection('SyncMongoReindex').createIndex({ status: 1 }, { name: 'SyncMongoReindex__status_idx' });
      await db.collection('SyncMongoReindex').createIndex({ kind: 1 }, { name: 'hand_made_kind' });
    });
    const migrator = new Migrator(pool, { entities: [SyncMongoReindex] });

    await migrator.sync();
    expect((await indexNames('SyncMongoReindex')).toSorted()).toEqual([
      'SyncMongoReindex__kind_status_idx',
      'SyncMongoReindex__status_idx',
      '_id_',
      'hand_made_kind',
    ]);

    await migrator.sync({ safe: false });
    expect((await indexNames('SyncMongoReindex')).toSorted()).toEqual([
      'SyncMongoReindex__kind_status_idx',
      '_id_',
      'hand_made_kind',
    ]);
    expect(await migrator.getDiffs()).toEqual([]);
  });

  /** A check is a filter every document matches, so one lacking the field it compares fails, unlike SQL's NULL. */
  it('should enforce the checks and enums an entity declares, and see an enum change as drift', async () => {
    @Entity({ name: 'ValidatedMongoTask', checks: [{ where: { priority: { $gte: 0 } } }] })
    class ValidatedMongoTask {
      @Id({ type: String }) id?: string;
      @Field({ type: String, enum: ['open', 'closed'] as const }) status?: 'open' | 'closed' | null;
      @Field({ type: Number }) priority?: number | null;
    }
    @Entity({ name: 'ValidatedMongoTask', checks: [{ where: { priority: { $gte: 0 } } }] })
    class ReopenedMongoTask {
      @Id({ type: String }) id?: string;
      @Field({ type: String, enum: ['open', 'closed', 'held'] as const }) status?: 'open' | 'closed' | 'held' | null;
      @Field({ type: Number }) priority?: number | null;
    }
    const insert = (...tasks: { status?: string | null; priority?: number }[]) =>
      pool.withQuerier(({ db }) => db.collection('ValidatedMongoTask').insertMany(tasks));
    const validation = /Document failed validation/;

    await new Migrator(pool, { entities: [ValidatedMongoTask] }).sync();
    await insert({ status: 'open', priority: 1 }, { status: null, priority: 0 }, { priority: 2 });
    await expect(insert({ status: 'held', priority: 1 })).rejects.toThrow(validation);
    await expect(insert({ status: 'open', priority: -1 })).rejects.toThrow(validation);
    await expect(insert({ status: 'open' })).rejects.toThrow(validation);

    const reopened = new Migrator(pool, { entities: [ReopenedMongoTask] });
    expect((await reopened.getDiffs()).map((diff) => diff.checks?.length)).toEqual([1]);
    expect(await reopened.planSync()).toEqual([]);

    await reopened.sync({ safe: false });
    await insert({ status: 'held', priority: 1 });
    await expect(insert({ status: 'gone', priority: 1 })).rejects.toThrow(validation);
    expect(await reopened.getDiffs()).toEqual([]);
  });

  it('should generate a migration from the entities as MongoDB driver calls', async () => {
    @Entity()
    class DraftMongoUser {
      @Id({ type: String }) id?: string;
      @Field({ type: String, index: true }) name?: string | null;
    }
    const migrator = new Migrator(pool, { entities: [DraftMongoUser], migrationsPath: await migrationsDir() });

    const source = await readFile(await migrator.generateFromEntities('init'), 'utf8');

    expect(source).toContain('async up(querier: MongoQuerier): Promise<void> {');
    expect(source).toContain('    await querier.db.createCollection("DraftMongoUser");');
    expect(source).toContain(
      '    await querier.db.collection("DraftMongoUser").createIndex({"name":1}, {"unique":false,"name":"DraftMongoUser__name_idx"});',
    );
    expect(source).toContain('    await querier.db.collection("DraftMongoUser").drop();');
    expect(source).not.toContain('querier.run(');
  });
});
