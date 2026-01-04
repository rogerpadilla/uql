import { describe, expect, it } from 'vitest';
import { Sqlite3QuerierPool } from '../sqlite/sqliteQuerierPool.js';
import { Company, Profile, User } from '../test/entityMock.js';
import { Migrator } from './migrator.js';

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
    await migrator.autoSync();

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

    await migrator.autoSync();

    // Start a long-running app operation (simulated)
    const appQuerier = await pool.getQuerier();

    // While app has one connection, migrator should still be able to get another one
    const status = await migrator.status();
    expect(status).toBeDefined();

    await appQuerier.release();
    await pool.end();
  });
});
