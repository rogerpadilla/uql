import { afterAll, describe, expect, it } from 'vitest';
import { Entity, f, Field } from '../entity/index.js';
import { SqliteQuerierPool } from '../sqlite/sqliteQuerierPool.js';
import { sql } from '../util/sql.js';
import { describeMigratorSync } from './migrator-sync-test.js';
import { Migrator } from './migrator.js';

describeMigratorSync('sqlite', {
  serialIdColumn: '`id` INTEGER PRIMARY KEY AUTOINCREMENT',
  textType: 'TEXT',
  doubleType: 'DOUBLE',
  keyColumnType: 'INTEGER',
  keepsComments: false,
});

/** A table made while a supplied key was `INTEGER`: `INT` asks a new table for no rowid alias, which is no drift. */
@Entity({ name: 'SuppliedIntegerKey' })
class SuppliedIntegerKey {
  @Field(f.number().id()) id!: number;
}

describe('an existing key on sqlite', () => {
  const pool = new SqliteQuerierPool(':memory:');
  afterAll(() => pool.end());

  it('should read a key the table declares INTEGER as no drift', async () => {
    await pool.transaction((querier) =>
      querier.run(sql.text('CREATE TABLE `SuppliedIntegerKey` (`id` INTEGER PRIMARY KEY)')),
    );
    const statements = await new Migrator(pool, { entities: [SuppliedIntegerKey] }).planSync({ safe: false });
    expect(statements).toEqual([]);
  });
});
