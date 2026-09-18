import { describe, expect, it } from 'vitest';
import { Migrator } from '../migrate/migrator.js';
import { VectorItem } from '../test/index.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

/**
 * A vector column created as `TEXT`, as before vectors were bound as float32 blobs. SQLite keeps either
 * kind of value in it, so the table stays: new rows land as blobs beside the text ones, and both read back.
 */
describe('a SQLite vector column created as TEXT', () => {
  const withLegacyTable = async (run: (pool: Sqlite3QuerierPool) => Promise<void>) => {
    const pool = new Sqlite3QuerierPool(':memory:');
    await pool.withQuerier(async (querier) => {
      await querier.run('CREATE TABLE `VectorItem` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` TEXT, `vec` TEXT)');
      await querier.run("INSERT INTO `VectorItem` (`name`, `vec`) VALUES ('old', '[1,0,2]')");
    });
    try {
      await run(pool);
    } finally {
      await pool.end();
    }
  };

  it('should plan no change to it', async () => {
    await withLegacyTable(async (pool) => {
      expect(await new Migrator(pool, { entities: [VectorItem] }).planSync()).toEqual([]);
    });
  });

  it('should read its text rows and the blob rows written beside them', async () => {
    await withLegacyTable((pool) =>
      pool.withQuerier(async (querier) => {
        await querier.insertOne(VectorItem, { name: 'new', vec: [0.5, -2, 3] });

        const found = await querier.findMany(VectorItem, { $select: { name: true, vec: true }, $sort: { id: 1 } });

        expect(found.map(({ name, vec }) => ({ name, vec }))).toEqual([
          { name: 'old', vec: [1, 0, 2] },
          { name: 'new', vec: [0.5, -2, 3] },
        ]);
      }),
    );
  });
});
