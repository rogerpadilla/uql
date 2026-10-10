import { expect } from 'vitest';
import { sqlToCanonical } from '../../schema/canonicalType.js';
import type { TypeCategory } from '../../schema/types.js';
import { assertDefined, type Spec } from '../../test/index.js';
import { dropTables } from '../../test/sqlPools.js';
import type { SchemaIntrospector, SqlQuerierPool, TableSchema } from '../../type/index.js';
import { sql } from '../../util/sql.js';
import { introspectorFor } from '../introspection/registry.js';
import { migrationBuilderFor } from '../migrationTarget.js';
import type { MigrationBuilder } from './types.js';

/** The tables this suite makes, each after the one it references. */
export const BUILDER_TABLES = {
  MAIN: 'test_builder_main',
  RENAMED: 'test_builder_renamed',
  PARENT: 'test_builder_parent',
  CHILD: 'test_builder_child',
  TYPES: 'test_builder_types',
} as const;

const DROP_ORDER = Object.values(BUILDER_TABLES).toReversed();

/**
 * Shared integration suite for {@link MigrationBuilder}: whether an engine accepts what a builder emits,
 * which its unit specs, asserting SQL text, cannot tell. The operations an engine may refuse are in
 * {@link AlterCapableMigrationBuilderIt} or the dialect's own runner.
 */
export abstract class AbstractMigrationBuilderIt implements Spec {
  protected readonly introspector: SchemaIntrospector;

  constructor(protected readonly pool: SqlQuerierPool) {
    this.introspector = introspectorFor(pool);
  }

  /** Every test starts from an empty database, whatever the one before it, or a killed run, left. */
  async beforeEach() {
    await dropTables(this.pool, ...DROP_ORDER);
  }

  async afterAll() {
    await dropTables(this.pool, ...DROP_ORDER);
    await this.pool.end();
  }

  /** What a `timestamp` column reads back as. SQLite has no date/time type, and stores one as `TEXT`. */
  protected expectedTimestampCategory(): TypeCategory {
    return 'timestamp';
  }

  /** Runs `fn` with a builder on its own connection, per this repo's per-test acquisition rule. */
  protected async withBuilder<T>(fn: (builder: MigrationBuilder) => Promise<T>): Promise<T> {
    const querier = await this.pool.getQuerier();
    try {
      return await fn(await migrationBuilderFor(querier));
    } finally {
      await querier.release();
    }
  }

  /** A table with an id and a `name` text column, the starting point most tests alter from. */
  protected async givenMainTable(builder: MigrationBuilder) {
    await builder.createTable(BUILDER_TABLES.MAIN, (t) => {
      t.id();
      t.text('name').nullable();
    });
  }

  /** An `integer` column for the two `alterColumn` forms to work on, or refuse. */
  protected async givenIntegerPayload(builder: MigrationBuilder) {
    await builder.createTable(BUILDER_TABLES.MAIN, (t) => {
      t.id();
      t.integer('payload').nullable();
    });
  }

  /**
   * A parent/child pair, unconstrained, for the foreign key operations to work on.
   *
   * `bigint()` and not `integer()` because a foreign key column has to match the one it references,
   * and `id()` is a big integer on every engine here.
   */
  protected async givenUnrelatedPair(builder: MigrationBuilder) {
    await builder.createTable(BUILDER_TABLES.PARENT, (t) => {
      t.id();
    });
    await builder.createTable(BUILDER_TABLES.CHILD, (t) => {
      t.id();
      t.bigint('parentId').nullable();
    });
  }

  protected async getTableSchema(tableName: string): Promise<TableSchema> {
    const schema = await this.introspector.getTableSchema(tableName);
    assertDefined(schema, `Table ${tableName} not found`);
    return schema;
  }

  protected async getColumn(tableName: string, columnName: string) {
    const column = (await this.getTableSchema(tableName)).columns.find((it) => it.name === columnName);
    assertDefined(column, `Column ${columnName} not found in ${tableName}`);
    return column;
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
   * Every column type the factory offers, bar `vector`: a `CREATE TABLE` naming a type the engine has not
   * got fails outright. `jsonb`, `uuid` and `timestamptz` are native to Postgres alone.
   */
  async shouldCreateATableWithEveryColumnType() {
    await this.withBuilder(async (builder) => {
      await builder.createTable(BUILDER_TABLES.TYPES, (t) => {
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

  async shouldPropagateANestedAlterTableFailure() {
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
    const { type } = await this.getColumn(BUILDER_TABLES.MAIN, 'createdAt');
    expect(sqlToCanonical(type).category).toBe(this.expectedTimestampCategory());
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
      await builder.createTable(BUILDER_TABLES.MAIN, (t) => {
        t.id();
        t.string('email', { length: 100 }).nullable();
        t.string('region', { length: 20 }).nullable();
        t.index(['region'], 'builder_region_idx');
        t.unique(['email'], 'builder_email_uk');
      });
    });

    const { indexes } = await this.getTableSchema(BUILDER_TABLES.MAIN);
    expect(await this.getIndexNames(BUILDER_TABLES.MAIN)).toEqual(['builder_email_uk', 'builder_region_idx']);
    expect(indexes?.filter((index) => index.unique).map((index) => index.name)).toEqual(['builder_email_uk']);
  }

  async shouldRunRawSql() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      await builder.raw(`INSERT INTO ${BUILDER_TABLES.MAIN} (name) VALUES ('raw')`);
    });

    expect(await this.pool.all(sql.text(`SELECT name FROM ${BUILDER_TABLES.MAIN}`))).toEqual([{ name: 'raw' }]);
  }

  async shouldDropATable() {
    await this.withBuilder(async (builder) => {
      await this.givenMainTable(builder);
      expect(await this.introspector.tableExists(BUILDER_TABLES.MAIN)).toBe(true);

      await builder.dropTable(BUILDER_TABLES.MAIN);
    });

    expect(await this.introspector.tableExists(BUILDER_TABLES.MAIN)).toBe(false);
  }

  /** Only the database can say the `CHECK` reached the column and is enforced, inline where the table is rebuilt to alter. */
  async shouldAddAColumnCarryingItsEnum() {
    await this.withBuilder(async (builder) => {
      await this.givenUnrelatedPair(builder);
      await builder.addColumn(BUILDER_TABLES.CHILD, (c) =>
        c.string('state', { length: 10 }).nullable().enum(['on', 'off']),
      );
    });

    // Unquoted: these names need no quoting on any engine here, and `raw` is the suite's own seam.
    await this.withBuilder(async (builder) => {
      await builder.raw(`INSERT INTO ${BUILDER_TABLES.CHILD} (state) VALUES ('on')`);
      await expect(builder.raw(`INSERT INTO ${BUILDER_TABLES.CHILD} (state) VALUES ('bogus')`)).rejects.toThrow();
    });
  }

  async shouldAddAColumnCarryingItsIndex() {
    await this.withBuilder(async (builder) => {
      await this.givenUnrelatedPair(builder);
      await builder.addColumn(BUILDER_TABLES.CHILD, (c) => c.string('slug', { length: 80 }).nullable().index());
    });

    expect(await this.getIndexNames(BUILDER_TABLES.CHILD)).toEqual(['test_builder_child__slug_idx']);
  }

  /** The engine fills it, so only the engine can say the clause is right and a write to it is refused. */
  async shouldCreateATableWithAComputedColumn() {
    await this.withBuilder(async (builder) => {
      await builder.createTable(BUILDER_TABLES.MAIN, (t) => {
        t.id();
        t.integer('qty').nullable();
        t.integer('price').nullable();
        t.integer('total').nullable().computed('qty * price');
      });
      await builder.raw(`INSERT INTO ${BUILDER_TABLES.MAIN} (qty, price) VALUES (3, 7)`);
    });

    const [row] = await this.pool.all<{ total: number }>(sql.text(`SELECT total FROM ${BUILDER_TABLES.MAIN}`));
    expect(Number(row.total)).toBe(21);
  }

  /** Declared at the table, in its `CREATE TABLE`: the one form every engine takes, SQLite included. */
  async shouldCreateATableWithAnInlineForeignKey() {
    await this.withBuilder(async (builder) => {
      await builder.createTable(BUILDER_TABLES.PARENT, (t) => {
        t.id();
      });
      await builder.createTable(BUILDER_TABLES.CHILD, (t) => {
        t.id();
        t.bigint('parentId').nullable();
        t.foreignKey(['parentId']).references(BUILDER_TABLES.PARENT, ['id']).onDelete('CASCADE');
      });
    });

    const { foreignKeys } = await this.getTableSchema(BUILDER_TABLES.CHILD);
    expect(foreignKeys).toMatchObject([
      { columns: ['parentId'], references: { table: BUILDER_TABLES.PARENT, columns: ['id'] }, onDelete: 'CASCADE' },
    ]);
  }
}

/**
 * The operations an engine only has if it can rewrite a table in place: everything here throws on
 * SQLite, whose runner asserts the refusal instead.
 */
export abstract class AlterCapableMigrationBuilderIt extends AbstractMigrationBuilderIt {
  async shouldAlterAColumnType() {
    await this.withBuilder(async (builder) => {
      await this.givenIntegerPayload(builder);
      await builder.alterColumn(BUILDER_TABLES.MAIN, (c) => c.text('payload', { nullable: true }));
    });

    const { type } = await this.getColumn(BUILDER_TABLES.MAIN, 'payload');
    expect(sqlToCanonical(type).category).toBe('string');
  }

  async shouldAlterAColumnThroughAlterTable() {
    await this.withBuilder(async (builder) => {
      await this.givenIntegerPayload(builder);
      await builder.alterTable(BUILDER_TABLES.MAIN, (t) => {
        t.alterColumn((c) => c.text('payload', { nullable: true }));
      });
    });

    const { type } = await this.getColumn(BUILDER_TABLES.MAIN, 'payload');
    expect(sqlToCanonical(type).category).toBe('string');
  }

  /** What a column declares for itself goes with it, as at `createTable`. */
  async shouldAddAColumnCarryingItsForeignKey() {
    await this.withBuilder(async (builder) => {
      await this.givenUnrelatedPair(builder);
      await builder.addColumn(BUILDER_TABLES.CHILD, (c) =>
        c.bigint('ownerId').nullable().references(BUILDER_TABLES.PARENT, 'id'),
      );
    });

    const { foreignKeys } = await this.getTableSchema(BUILDER_TABLES.CHILD);
    expect(foreignKeys).toMatchObject([
      { columns: ['ownerId'], references: { table: BUILDER_TABLES.PARENT, columns: ['id'] } },
    ]);
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

    const { foreignKeys } = await this.getTableSchema(BUILDER_TABLES.CHILD);
    expect(foreignKeys).toMatchObject([
      { columns: ['parentId'], references: { table: BUILDER_TABLES.PARENT, columns: ['id'] }, onDelete: 'CASCADE' },
    ]);
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

    const { foreignKeys } = await this.getTableSchema(BUILDER_TABLES.CHILD);
    expect(foreignKeys).toEqual([]);
  }

  async shouldAddAForeignKeyThroughAlterTable() {
    await this.withBuilder(async (builder) => {
      await this.givenUnrelatedPair(builder);

      await builder.alterTable(BUILDER_TABLES.CHILD, (t) => {
        t.addForeignKey(['parentId'], { table: BUILDER_TABLES.PARENT, columns: ['id'] }, { onDelete: 'CASCADE' });
      });
    });

    const { foreignKeys } = await this.getTableSchema(BUILDER_TABLES.CHILD);
    expect(foreignKeys).toMatchObject([
      { columns: ['parentId'], references: { table: BUILDER_TABLES.PARENT, columns: ['id'] }, onDelete: 'CASCADE' },
    ]);
  }

  /**
   * A default, an enum's `CHECK` and a `UNIQUE` go with the column declaring them. SQL Server keeps
   * each as a constraint under a name of its own, and refuses the drop while one stands.
   */
  async shouldDropAColumnCarryingItsConstraints() {
    await this.withBuilder(async (builder) => {
      await builder.createTable(BUILDER_TABLES.MAIN, (t) => {
        t.id();
        t.string('state', { length: 10 }).defaultValue('on').enum(['on', 'off']).unique();
      });
      await builder.dropColumn(BUILDER_TABLES.MAIN, 'state');
    });

    expect(await this.getColumnNames(BUILDER_TABLES.MAIN)).toEqual(['id']);
  }

  /** A retype under a default, which SQL Server refuses until the default is out of the way. */
  async shouldAlterAColumnTypeUnderItsDefault() {
    await this.withBuilder(async (builder) => {
      await builder.createTable(BUILDER_TABLES.MAIN, (t) => {
        t.id();
        t.integer('payload').defaultValue(1);
      });
      await builder.alterColumn(BUILDER_TABLES.MAIN, (c) => c.bigint('payload').defaultValue(2));
    });

    const { type, defaultValue } = await this.getColumn(BUILDER_TABLES.MAIN, 'payload');
    expect(sqlToCanonical(type)).toMatchObject({ category: 'integer', size: 'big' });
    expect(defaultValue).toBe(2);
  }
}
