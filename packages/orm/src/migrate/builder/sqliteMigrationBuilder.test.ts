import { expect } from 'vitest';
import type { TypeCategory } from '../../schema/types.js';
import { Sqlite3QuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import { createSpec } from '../../test/index.js';
import { decodeDate } from '../../util/date.js';
import { currentDate } from '../../util/raw.js';
import { AbstractMigrationBuilderIt, BUILDER_TABLES } from './abstractMigrationBuilder-test.js';

/**
 * SQLite extends the base rather than {@link AlterCapableMigrationBuilderIt}: it can neither rewrite
 * a column in place nor add a constraint to a table that exists, so what it owes is a refusal, and
 * the tests below are the ones the alter-capable suite runs against a real change.
 */
class SqliteMigrationBuilderIt extends AbstractMigrationBuilderIt {
  protected override expectedTimestampCategory(): TypeCategory {
    return 'string';
  }

  /**
   * SQLite keeps a date as text, so the day it fills a default with has to be the text a bound `Date` at
   * its UTC midnight is written as, or the row matches no `Date` read back off it.
   */
  async shouldFillTheDayAsTheTextABoundDateIs() {
    const table = BUILDER_TABLES.MAIN;
    await this.withBuilder((builder) =>
      builder.createTable(table, (t) => {
        t.id();
        t.date('day', { defaultValue: currentDate });
      }),
    );
    await this.pool.run(`INSERT INTO ${table} DEFAULT VALUES`);
    const [row] = await this.pool.all<{ day: string }>(`SELECT day FROM ${table}`);

    expect(await this.pool.all(`SELECT id FROM ${table} WHERE day = ?`, [decodeDate(row.day)])).toEqual([{ id: 1 }]);
  }

  async shouldRefuseToAlterAColumn() {
    await this.withBuilder(async (builder) => {
      await this.givenIntegerPayload(builder);

      await expect(
        builder.alterColumn(BUILDER_TABLES.MAIN, (c) => c.text('payload', { nullable: true })),
      ).rejects.toThrow('rebuilds the table');
    });
  }

  async shouldRefuseToAlterAColumnThroughAlterTable() {
    await this.withBuilder(async (builder) => {
      await this.givenIntegerPayload(builder);

      await expect(
        builder.alterTable(BUILDER_TABLES.MAIN, (t) => {
          t.alterColumn((c) => c.text('payload', { nullable: true }));
        }),
      ).rejects.toThrow('rebuilds the table');
    });
  }

  async shouldRefuseToAddAForeignKeyToAnExistingTable() {
    await this.withBuilder(async (builder) => {
      await this.givenUnrelatedPair(builder);

      await expect(
        builder.addForeignKey(BUILDER_TABLES.CHILD, ['parentId'], {
          table: BUILDER_TABLES.PARENT,
          columns: ['id'],
        }),
      ).rejects.toThrow('rebuilds the table');
    });
  }
}

createSpec(new SqliteMigrationBuilderIt(new Sqlite3QuerierPool(':memory:')));
