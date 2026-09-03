import { expect } from 'vitest';
import { Sqlite3QuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import { createSpec } from '../../test/index.js';
import { SqliteSchemaIntrospector } from '../introspection/sqliteIntrospector.js';
import { AbstractMigrationBuilderIt, BUILDER_TABLES } from './abstractMigrationBuilder-test.js';

/**
 * SQLite extends the base rather than {@link AlterCapableMigrationBuilderIt}: it can neither rewrite
 * a column in place nor add a constraint to a table that exists, so what it owes is a refusal, and
 * the tests below are the ones the alter-capable suite runs against a real change.
 */
class SqliteMigrationBuilderIt extends AbstractMigrationBuilderIt {
  constructor() {
    const pool = new Sqlite3QuerierPool(':memory:');
    super(pool, new SqliteSchemaIntrospector(pool));
  }

  async shouldRefuseToAlterAColumn() {
    await this.withBuilder(async (builder) => {
      await this.givenIntegerPayload(builder);

      await expect(
        builder.alterColumn(BUILDER_TABLES.MAIN, (c) => c.text('payload', { nullable: true })),
      ).rejects.toThrow('Cannot alter column');
    });
  }

  /** The nested form has to refuse too, which it could not while it fired its changes unawaited. */
  async shouldRefuseToAlterAColumnThroughAlterTable() {
    await this.withBuilder(async (builder) => {
      await this.givenIntegerPayload(builder);

      await expect(
        builder.alterTable(BUILDER_TABLES.MAIN, (t) => {
          t.alterColumn((c) => c.text('payload', { nullable: true }));
        }),
      ).rejects.toThrow('Cannot alter column');
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
      ).rejects.toThrow('does not support adding foreign keys to existing tables');
    });
  }

  /** A foreign key SQLite does take: inline, at `CREATE TABLE`, which is where it resolves one. */
  async shouldCreateATableWithAnInlineForeignKey() {
    await this.withBuilder(async (builder) => {
      await builder.createTable(this.claim(BUILDER_TABLES.PARENT), (t) => {
        t.id();
      });
      await builder.createTable(this.claim(BUILDER_TABLES.CHILD), (t) => {
        t.id();
        t.bigint('parentId').unsigned().nullable();
        t.foreignKey(['parentId']).references(BUILDER_TABLES.PARENT, ['id']).onDelete('CASCADE');
      });
    });

    const schema = await this.getTableSchema(BUILDER_TABLES.CHILD);
    const fk = schema.foreignKeys?.find((key) => key.columns.includes('parentId'));
    expect(fk?.referencedTable).toBe(BUILDER_TABLES.PARENT);
    expect(fk?.referencedColumns).toEqual(['id']);
  }
}

createSpec(new SqliteMigrationBuilderIt());
