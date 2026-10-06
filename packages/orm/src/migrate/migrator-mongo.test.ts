import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { Entity, Field, Id, Index, Trigger } from '../entity/index.js';
import { runMongoCommand, serializeMongoCommand } from '../mongo/mongoCommand.js';
import type { MongoQuerier } from '../mongo/mongoQuerier.js';
import { MongoSchemaGenerator } from '../mongo/mongoSchemaGenerator.js';
import { MongodbQuerierPool } from '../mongo/mongodbQuerierPool.js';
import { mongoUri, provisioningTimeout } from '../test/index.js';
import { loadTsDefaultExport } from '../test/loadTsDefaultExport.js';
import type { MigrationDefinition } from '../type/index.js';
import { raw } from '../util/index.js';
import { runDriftCheck } from './cli.js';
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

    expect(await migrator.up()).toMatchObject([{ name, success: true }]);
    expect(await active()).toBe(2);
    expect(await migrator.status()).toEqual({ pending: [], executed: [name] });

    expect(await migrator.down()).toMatchObject([{ name, success: true }]);
    expect(await active()).toBe(0);
    expect(await migrator.status()).toEqual({ pending: [name], executed: [] });
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

  it('should scaffold a migration typed on the MongoDB querier', async () => {
    const migrator = new Migrator(pool, { migrationsPath: await migrationsDir() });

    const source = await readFile(await migrator.generate('seed'), 'utf8');

    expect(source).toContain(`import type { MongoQuerier } from 'uql-orm/mongo';`);
    expect(source).toContain('async up(querier: MongoQuerier): Promise<void> {');
    expect(source).not.toContain('querier.run(');
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

  /** A collection has no columns to compare, so the check would call every entity drifted. */
  it('should refuse a drift check, pointing at the dry run that lists the index changes', async () => {
    @Entity()
    class DriftMongoNote {
      @Id({ type: String }) id?: string;
    }
    const migrator = new Migrator(pool, { entities: [DriftMongoNote] });

    await expect(runDriftCheck(migrator, { pool, entities: [DriftMongoNote] })).rejects.toThrow(
      'drift:check compares tables, and this database has none: `sync --dry-run` prints the index changes a sync would make',
    );
  });
});

/** A migrations directory of its own for this test, removed when the test finishes. */
async function migrationsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uql-mongo-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
