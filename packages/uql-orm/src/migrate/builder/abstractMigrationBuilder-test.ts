import { expect } from 'vitest';
import { sqlToCanonical } from '../../schema/canonicalType.js';
import type { Spec } from '../../test/index.js';
import type { QuerierPool, SchemaIntrospector, SqlQuerier, TableSchema } from '../../type/index.js';
import { MigrationBuilder } from './migrationBuilder.js';

/**
 * Tables this suite owns. Distinct from every other suite's, because vitest runs test files in
 * parallel against the one Docker database per engine.
 */
export const BUILDER_TABLES = {
  MAIN: 'test_builder_main',
  RENAMED: 'test_builder_renamed',
  PARENT: 'test_builder_parent',
  CHILD: 'test_builder_child',
  TYPES: 'test_builder_types',
} as const;

/**
 * Shared integration suite for {@link MigrationBuilder}, run against a real engine.
 *
 * Its unit specs assert the SQL string a builder emits, which cannot tell whether an engine accepts
 * it: `alterTable` returned before its statements had run for as long as it existed, and every one of
 * those specs passed. Only the operations every engine supports live here; the ones an engine may
 * refuse are in {@link AlterCapableMigrationBuilderIt} or the dialect's own runner.
 */
export abstract class AbstractMigrationBuilderIt implements Spec {
  private readonly claimed = new Set<string>();

  constructor(
    protected readonly pool: QuerierPool<SqlQuerier>,
    protected readonly introspector: SchemaIntrospector,
  ) {}

  // Teardown here rather than trailing each test: a failed expectation would otherwise leak its table
  // into the shared database, where the next run's introspection finds it.
  async afterEach() {
    await this.withBuilder(async (builder) => {
      for (const table of this.dropOrder()) {
        await builder.dropTable(table, { ifExists: true, cascade: true });
      }
    });
    this.claimed.clear();
  }

  async afterAll() {
    await this.pool.end();
  }

  /** Claimed tables, dependents first, so a foreign key cannot block the drop. */
  private dropOrder() {
    return [...this.claimed].reverse();
  }

  /** Runs `fn` with a builder on its own connection, per this repo's per-test acquisition rule. */
  protected async withBuilder<T>(fn: (builder: MigrationBuilder) => Promise<T>): Promise<T> {
    const querier = await this.pool.getQuerier();
    try {
      return await fn(new MigrationBuilder(querier));
    } finally {
      await querier.release();
    }
  }

  /** Registers `name` for teardown. Every table a test creates goes through here. */
  protected claim(name: string): string {
    this.claimed.add(name);
    return name;
  }

  /** A table with an id and a `name` text column, the starting point most tests alter from. */
  protected async givenMainTable(builder: MigrationBuilder) {
    await builder.createTable(this.claim(BUILDER_TABLES.MAIN), (t) => {
      t.id();
      t.text('name').nullable();
    });
  }

  /** An `integer` column for the two `alterColumn` forms to work on, or refuse. */
  protected async givenIntegerPayload(builder: MigrationBuilder) {
    await builder.createTable(this.claim(BUILDER_TABLES.MAIN), (t) => {
      t.id();
      t.integer('payload').nullable();
    });
  }

  /**
   * A parent/child pair, unconstrained, for the foreign key operations to work on.
   *
   * `bigint().unsigned()` and not `integer()` because MySQL refuses a foreign key whose column does
   * not match the one it references down to signedness, and `id()` is `BIGINT UNSIGNED` there. The
   * one declaration serves every engine: Postgres and SQLite have no unsigned integer and ignore it.
   */
  protected async givenUnrelatedPair(builder: MigrationBuilder) {
    await builder.createTable(this.claim(BUILDER_TABLES.PARENT), (t) => {
      t.id();
    });
    await builder.createTable(this.claim(BUILDER_TABLES.CHILD), (t) => {
      t.id();
      t.bigint('parentId').unsigned().nullable();
    });
  }

  protected async getTableSchema(tableName: string): Promise<TableSchema> {
    const schema = await this.introspector.getTableSchema(tableName);
    expect(schema, `Table ${tableName} not found`).toBeDefined();
    return schema as TableSchema;
  }

  protected async getColumnNames(tableName: string) {
    const schema = await this.getTableSchema(tableName);
    return schema.columns.map((column) => column.name).sort();
  }

  protected async getIndexNames(tableName: string) {
    const schema = await this.getTableSchema(tableName);
    return (schema.indexes ?? []).map((index) => index.name).sort();
  }

  /**
   * The column types the factory offers, minus `vector`, which needs an engine built for it.
   *
   * Named per type rather than asserted per type: what is under test is that the SQL each one
   * produces is a type the engine actually has, and a `CREATE TABLE` naming one that does not fails
   * outright. `jsonb`, `uuid` and `timestamptz` are the ones only Postgres has natively.
   */
  async shouldCreateATableWithEveryColumnType() {
    await this.withBuilder(async (builder) => {
      await builder.createTable(this.claim(BUILDER_TABLES.TYPES), (t) => {
        t.id();
        t.smallint('smallintCol').nullable();
        t.integer('integerCol').nullable();
        t.bigint('bigintCol').nullable();
        t.float('floatCol').nullable();
        t.double('doubleCol').nullable();
        t.decimal('decimalCol', { precision: 10, scale: 2 }).nullable();
        t.string('stringCol', { length: 50 }).nullable();
        t.char('charCol', { length: 2 }).nullable();
        t.text('textCol').nullable();
        t.boolean('booleanCol').nullable();
        t.date('dateCol').nullable();
        t.time('timeCol').nullable();
        t.timestamp('timestampCol').nullable();
        t.timestamptz('timestamptzCol').nullable();
        t.json('jsonCol').nullable();
        t.jsonb('jsonbCol').nullable();
        t.uuid('uuidCol').nullable();
        t.blob('blobCol').nullable();
      });
    });

    expect(await this.getColumnNames(BUILDER_TABLES.TYPES)).toEqual([
      'bigintCol',
      'blobCol',
      'booleanCol',
      'charCol',
      'dateCol',
      'decimalCol',
      'doubleCol',
      'floatCol',
      'id',
      'integerCol',
      'jsonCol',
      'jsonbCol',
      'smallintCol',
      'stringCol',
      'textCol',
      'timeCol',
      'timestampCol',
      'timestamptzCol',
      'uuidCol',
    ]);
  }

  /**
   * The regression test for `alterTable`: it recorded each nested change and fired it unawaited, so
   * it resolved with every statement still in flight and the table unchanged at this assertion.
   */
  async shouldApplyEveryNestedAlterTableChangeBeforeResolving() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);

      await builder.alterTable(BUILDER_TABLES.MAIN, (t) => {
        t.addColumn((c) => c.integer('score', { nullable: true }));
        t.dropColumn('name');
      });
    });

    expect(await this.getColumnNames(BUILDER_TABLES.MAIN)).toEqual(['id', 'score']);
  }

  /**
   * The other half of the same bug: an unawaited statement fails as an unhandled rejection, which
   * leaves `alterTable` resolving and the caller believing a migration it never ran.
   */
  async shouldRejectWhenANestedAlterTableChangeFails() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);

      await expect(
        builder.alterTable(BUILDER_TABLES.MAIN, (t) => {
          t.dropColumn('noSuchColumn');
        }),
      ).rejects.toThrow();
    });
  }

  /** Nested changes run in the order declared, which concurrent dispatch cannot guarantee. */
  async shouldApplyNestedAlterTableChangesInOrder() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);

      await builder.alterTable(BUILDER_TABLES.MAIN, (t) => {
        t.renameColumn('name', 'label');
        t.addColumn((c) => c.text('name', { nullable: true }));
      });
    });

    expect(await this.getColumnNames(BUILDER_TABLES.MAIN)).toEqual(['id', 'label', 'name']);
  }

  async shouldAddAColumn() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      await builder.addColumn(BUILDER_TABLES.MAIN, (c) => c.timestamp('createdAt', { nullable: true }));
    });

    expect(await this.getColumnNames(BUILDER_TABLES.MAIN)).toEqual(['createdAt', 'id', 'name']);
  }

  async shouldDropAColumn() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      await builder.dropColumn(BUILDER_TABLES.MAIN, 'name');
    });

    expect(await this.getColumnNames(BUILDER_TABLES.MAIN)).toEqual(['id']);
  }

  async shouldRenameAColumn() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      await builder.renameColumn(BUILDER_TABLES.MAIN, 'name', 'label');
    });

    expect(await this.getColumnNames(BUILDER_TABLES.MAIN)).toEqual(['id', 'label']);
  }

  async shouldRenameATable() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      this.claim(BUILDER_TABLES.RENAMED);
      await builder.renameTable(BUILDER_TABLES.MAIN, BUILDER_TABLES.RENAMED);
    });

    expect(await this.introspector.tableExists(BUILDER_TABLES.MAIN)).toBe(false);
    expect(await this.getColumnNames(BUILDER_TABLES.RENAMED)).toEqual(['id', 'name']);
  }

  async shouldCreateAnIndex() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      await builder.createIndex(BUILDER_TABLES.MAIN, ['name'], { name: 'builder_name_idx' });
    });

    expect(await this.getIndexNames(BUILDER_TABLES.MAIN)).toEqual(['builder_name_idx']);
  }

  async shouldDropAnIndex() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      await builder.createIndex(BUILDER_TABLES.MAIN, ['name'], { name: 'builder_dropped_idx' });
      await builder.dropIndex(BUILDER_TABLES.MAIN, 'builder_dropped_idx');
    });

    expect(await this.getIndexNames(BUILDER_TABLES.MAIN)).toEqual([]);
  }

  async shouldCreateAndDropAnIndexThroughAlterTable() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);

      await builder.alterTable(BUILDER_TABLES.MAIN, (t) => {
        t.addIndex(['name'], { name: 'builder_kept_idx' });
        t.addIndex(['id', 'name'], { name: 'builder_transient_idx' });
        t.dropIndex('builder_transient_idx');
      });
    });

    expect(await this.getIndexNames(BUILDER_TABLES.MAIN)).toEqual(['builder_kept_idx']);
  }

  async shouldCreateATableDeclaringItsOwnIndexes() {
    await this.withBuilder(async (builder) => {
      await builder.createTable(this.claim(BUILDER_TABLES.MAIN), (t) => {
        t.id();
        t.string('email', { length: 100 }).nullable();
        t.string('region', { length: 20 }).nullable();
        t.index(['region'], 'builder_region_idx');
        t.unique(['email'], 'builder_email_uk');
      });
    });

    const schema = await this.getTableSchema(BUILDER_TABLES.MAIN);
    const unique = schema.indexes?.find((index) => index.name === 'builder_email_uk');
    // Sorted: which indexes exist is the claim, and engines report them in their own order.
    expect((await this.getIndexNames(BUILDER_TABLES.MAIN)).toSorted()).toEqual(
      ['builder_region_idx', 'builder_email_uk'].toSorted(),
    );
    expect(unique?.unique).toBe(true);
  }

  async shouldRunRawSql() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      await builder.raw(`INSERT INTO ${BUILDER_TABLES.MAIN} (name) VALUES ('raw')`);

      const querier = await this.pool.getQuerier();
      try {
        const rows = await querier.all<{ name: string }>(`SELECT name FROM ${BUILDER_TABLES.MAIN}`);
        expect(rows.map((row) => row.name)).toEqual(['raw']);
      } finally {
        await querier.release();
      }
    });
  }

  async shouldDropATable() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      expect(await this.introspector.tableExists(BUILDER_TABLES.MAIN)).toBe(true);

      await builder.dropTable(BUILDER_TABLES.MAIN);
    });

    expect(await this.introspector.tableExists(BUILDER_TABLES.MAIN)).toBe(false);
  }
}

/**
 * The operations an engine only has if it can rewrite a table in place: everything here throws on
 * SQLite, whose runner asserts the refusal instead.
 */
export abstract class AlterCapableMigrationBuilderIt extends AbstractMigrationBuilderIt {
  protected async getColumnCategory(tableName: string, columnName: string) {
    const schema = await this.getTableSchema(tableName);
    const column = schema.columns.find((candidate) => candidate.name === columnName);
    expect(column, `Column ${columnName} not found in ${tableName}`).toBeDefined();
    return sqlToCanonical((column as { type: string }).type).category;
  }

  async shouldAlterAColumnType() {
    await this.withBuilder(async (builder) => {
      await this.givenIntegerPayload(builder);
      await builder.alterColumn(BUILDER_TABLES.MAIN, (c) => c.text('payload', { nullable: true }));
    });

    expect(await this.getColumnCategory(BUILDER_TABLES.MAIN, 'payload')).toBe('string');
  }

  async shouldAlterAColumnThroughAlterTable() {
    await this.withBuilder(async (builder) => {
      await this.givenIntegerPayload(builder);
      await builder.alterTable(BUILDER_TABLES.MAIN, (t) => {
        t.alterColumn((c) => c.text('payload', { nullable: true }));
      });
    });

    expect(await this.getColumnCategory(BUILDER_TABLES.MAIN, 'payload')).toBe('string');
  }

  async shouldAddAForeignKey() {
    await this.withBuilder(async (builder) => {
      await this.givenUnrelatedPair(builder);

      await builder.addForeignKey(
        BUILDER_TABLES.CHILD,
        ['parentId'],
        { table: BUILDER_TABLES.PARENT, columns: ['id'] },
        { onDelete: 'CASCADE' },
      );
    });

    const schema = await this.getTableSchema(BUILDER_TABLES.CHILD);
    const fk = schema.foreignKeys?.find((key) => key.columns.includes('parentId'));
    expect(fk?.referencedTable).toBe(BUILDER_TABLES.PARENT);
    expect(fk?.referencedColumns).toEqual(['id']);
  }

  async shouldDropAForeignKey() {
    await this.withBuilder(async (builder) => {
      await this.givenUnrelatedPair(builder);

      await builder.addForeignKey(
        BUILDER_TABLES.CHILD,
        ['parentId'],
        { table: BUILDER_TABLES.PARENT, columns: ['id'] },
        { name: 'builder_child_parent_fk' },
      );
      await builder.dropForeignKey(BUILDER_TABLES.CHILD, 'builder_child_parent_fk');
    });

    const schema = await this.getTableSchema(BUILDER_TABLES.CHILD);
    expect(schema.foreignKeys ?? []).toEqual([]);
  }

  async shouldAddAForeignKeyThroughAlterTable() {
    await this.withBuilder(async (builder) => {
      await this.givenUnrelatedPair(builder);

      await builder.alterTable(BUILDER_TABLES.CHILD, (t) => {
        t.addForeignKey(['parentId'], { table: BUILDER_TABLES.PARENT, columns: ['id'] }, { onDelete: 'CASCADE' });
      });
    });

    const schema = await this.getTableSchema(BUILDER_TABLES.CHILD);
    const fk = schema.foreignKeys?.find((key) => key.columns.includes('parentId'));
    expect(fk?.referencedTable).toBe(BUILDER_TABLES.PARENT);
  }
}
