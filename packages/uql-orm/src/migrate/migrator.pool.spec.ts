import { describe, expect, it } from 'vitest';
import { Sqlite3QuerierPool } from '../sqlite/sqliteQuerierPool.js';
import { Company, Profile, User } from '../test/entityMock.js';
import { defineBuilderMigration, Migrator } from './migrator.js';

describe('Migrator Shared Pool', () => {
  it('should work when sharing a pool with the application', async () => {
    // 1. Create a single pool
    const pool = new Sqlite3QuerierPool(':memory:');

    // 2. Create migrator with that pool
    const migrator = new Migrator(pool, {
      entities: [Company, User, Profile],
      // Use memory storage for migrations too
    });

    // 3. Initialize schema via migrator
    await migrator.sync();

    // 4. Use the pool for app logic
    const querier = await pool.getQuerier();
    try {
      await querier.insertOne(User, { name: 'App User', email: 'app@example.com' });
      const users = await querier.findMany(User, {});
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('App User');
    } finally {
      await querier.release();
    }

    // 5. Run migrator again (e.g. status check)
    const status = await migrator.status();
    expect(status.pending).toBeDefined();

    // 6. Ensure app still works
    const count = await pool.transaction(async (q) => {
      return await q.count(User, {});
    });
    expect(count).toBe(1);

    await pool.end();
  });

  it('should not deadlock when multiple operations happen on the same shared pool', async () => {
    // Sqlite pool with max 2 connections
    const pool = new Sqlite3QuerierPool(':memory:');
    const migrator = new Migrator(pool, { entities: [User] });

    await migrator.sync();

    // Start a long-running app operation (simulated)
    const appQuerier = await pool.getQuerier();

    // While app has one connection, migrator should still be able to get another one
    const status = await migrator.status();
    expect(status).toBeDefined();

    await appQuerier.release();
    await pool.end();
  });

  it('runs a builder migration with a builder, both ways', async () => {
    const pool = new Sqlite3QuerierPool(':memory:');
    const migrator = new Migrator(pool);
    const migration = {
      name: 'm1',
      ...defineBuilderMigration({
        async up(m) {
          await m.createTable('notes', (t) => {
            t.id();
            t.string('title');
          });
        },
        async down(m) {
          await m.dropTable('notes');
        },
      }),
    };
    const tables = () =>
      pool.withQuerier((querier) =>
        querier.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'"),
      );

    expect(await migrator.runMigration(migration, 'up')).toMatchObject({ success: true });
    expect(await tables()).toEqual([{ name: 'notes' }]);
    expect(await migrator.executed()).toEqual(['m1']);

    expect(await migrator.runMigration(migration, 'down')).toMatchObject({ success: true });
    expect(await tables()).toEqual([]);
    expect(await migrator.executed()).toEqual([]);

    await pool.end();
  });

  it('hands a builder migration the querier too, for a backfill that reads before it writes', async () => {
    const pool = new Sqlite3QuerierPool(':memory:');
    const migrator = new Migrator(pool);
    await pool.withQuerier(async (querier) => {
      await querier.run('CREATE TABLE "person" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)');
      await querier.run(`INSERT INTO "person" ("id", "name") VALUES (1, 'Ada Lovelace'), (2, 'Alan Turing')`);
    });
    const migration = {
      name: 'm1',
      ...defineBuilderMigration({
        async up(m, querier) {
          await m.addColumn('person', (c) => c.text('slug', { nullable: true }));
          const people = await querier.all<{ id: number; name: string }>('SELECT "id", "name" FROM "person"');
          for (const { id, name } of people) {
            await querier.run('UPDATE "person" SET "slug" = ? WHERE "id" = ?', [
              name.toLowerCase().replace(' ', '-'),
              id,
            ]);
          }
        },
        async down(m) {
          await m.dropColumn('person', 'slug');
        },
      }),
    };

    expect(await migrator.runMigration(migration, 'up')).toMatchObject({ success: true });

    const slugs = await pool.withQuerier((querier) =>
      querier.all<{ slug: string }>('SELECT "slug" FROM "person" ORDER BY "id"'),
    );
    expect(slugs).toEqual([{ slug: 'ada-lovelace' }, { slug: 'alan-turing' }]);

    await pool.end();
  });
});
