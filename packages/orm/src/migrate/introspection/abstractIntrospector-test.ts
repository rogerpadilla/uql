import { expect } from 'vitest';
import { SqlExpression } from '../../schema/sqlExpression.js';
import type { ForeignKeyAction } from '../../schema/types.js';
import { assertDefined, type Spec, type SpecRequirements } from '../../test/index.js';
import { dropTables } from '../../test/sqlPools.js';
import type { SchemaIntrospector, SqlQuerier, SqlQuerierPool, TableSchema } from '../../type/index.js';
import { currentTimestamp, raw } from '../../util/raw.js';
import { migrationBuilderFor } from '../migrationTarget.js';
import { introspectorFor } from './registry.js';

/** Test table names shared across every dialect's introspection suite, each after the tables it references. */
export const INTROSPECT_TABLES = {
  A: 'test_introspect_a',
  B: 'test_introspect_b',
  C: 'test_introspect_c',
  COMPOSITE_PK: 'test_introspect_composite_pk',
  SELF_REF: 'test_introspect_self_ref',
  MULTI_FK: 'test_introspect_multi_fk',
  COMPOSITE_UNIQUE: 'test_introspect_composite_unique',
  NO_FK: 'test_introspect_no_fk',
  /** Made and dropped by one test each, and listed so a run killed in between cannot leave them blocking a drop. */
  COMPOSITE_FK: 'test_introspect_composite_fk',
  SET_DEFAULT: 'test_introspect_set_default',
} as const;

const DROP_ORDER = Object.values(INTROSPECT_TABLES).toReversed();

/**
 * Shared integration suite for schema introspectors, covering table/column/PK/FK/index/default-value
 * introspection plus self-references and edge cases. Builds its fixture tables with
 * {@link MigrationOperationBuilder} so the DDL stays dialect-agnostic; subclasses override the hooks below for
 * dialect-specific setup and add their own dialect-specific tests.
 */
export abstract class AbstractIntrospectorIt implements Spec {
  protected readonly introspector: SchemaIntrospector;

  constructor(protected readonly pool: SqlQuerierPool) {
    this.introspector = introspectorFor(pool);
  }

  /** Whether the engine keeps an `ON DELETE SET DEFAULT`, which InnoDB parses and refuses. */
  protected readonly setDefaultAction: boolean = true;

  /** Whether the engine has partial indexes, which MySQL and MariaDB do not. */
  protected readonly partialIndex: boolean = true;

  requirements(): SpecRequirements<this> {
    return {
      shouldIntrospectSetDefaultForeignKey: this.setDefaultAction,
      shouldReadAPartialIndexWithItsPredicate: this.partialIndex,
    };
  }

  async beforeAll() {
    await dropTables(this.pool, ...DROP_ORDER);
    await this.pool.withQuerier((querier) => this.createTables(querier));
  }

  async afterAll() {
    await dropTables(this.pool, ...DROP_ORDER);
    await this.pool.end();
  }

  private async createTables(querier: SqlQuerier): Promise<void> {
    const builder = await migrationBuilderFor(querier);

    await builder.createTable(INTROSPECT_TABLES.A, (t) => {
      t.id();
      t.text('name').nullable();
      t.string('status', { length: 50 }).defaultValue('active');
      t.boolean('is_enabled').defaultValue(true);
      t.integer('score').defaultValue(0);
      t.timestamp('created_at').defaultValue(currentTimestamp);
      t.decimal('amount', { precision: 10, scale: 2 }).nullable();
    });
    await this.addDialectSpecificColumnsA(querier);

    await builder.createTable(INTROSPECT_TABLES.B, (t) => {
      t.id();
      t.bigint('a_id').nullable().references(INTROSPECT_TABLES.A).onDelete('CASCADE').onUpdate('NO ACTION');
      t.string('col1', { length: 100 }).nullable();
      t.string('col2', { length: 100 }).nullable();
      t.string('unique_code', { length: 50 }).unique();
    });

    await builder.createTable(INTROSPECT_TABLES.C, (t) => {
      t.id();
      t.bigint('b_id').nullable().references(INTROSPECT_TABLES.B).onDelete('SET NULL').onUpdate('CASCADE');
      t.integer('priority').notNullable();
      t.integer('doubled').nullable().computed('priority * 2');
    });

    await builder.createTable(INTROSPECT_TABLES.COMPOSITE_PK, (t) => {
      t.integer('tenant_id').notNullable().primaryKey();
      t.integer('entity_id').notNullable().primaryKey();
      t.text('data').nullable();
    });

    await builder.createTable(INTROSPECT_TABLES.SELF_REF, (t) => {
      t.id();
      t.bigint('parent_id').nullable().references(INTROSPECT_TABLES.SELF_REF).onDelete(this.selfReferenceOnDelete());
      t.string('name', { length: 255 }).notNullable();
    });

    await builder.createTable(INTROSPECT_TABLES.MULTI_FK, (t) => {
      t.id();
      t.bigint('created_by').nullable().references(INTROSPECT_TABLES.A).onDelete(this.restrictOnDelete());
      t.bigint('updated_by').nullable().references(INTROSPECT_TABLES.A).onDelete(this.restrictOnDelete());
    });

    await builder.createTable(INTROSPECT_TABLES.COMPOSITE_UNIQUE, (t) => {
      t.id();
      t.string('code', { length: 100 }).notNullable();
      t.string('region', { length: 100 }).notNullable();
    });
    await builder.createIndex(INTROSPECT_TABLES.COMPOSITE_UNIQUE, ['code', 'region'], {
      name: 'code_region_uk',
      unique: true,
    });

    await builder.createTable(INTROSPECT_TABLES.NO_FK, (t) => {
      t.id();
      t.text('value').nullable();
    });

    await builder.createIndex(INTROSPECT_TABLES.B, ['col1', 'col2'], { name: 'test_b_cols_idx' });
    await builder.createIndex(INTROSPECT_TABLES.C, ['priority'], { name: 'test_c_priority_idx' });
  }

  /** The precision and scale a `decimal(10, 2)` keeps. */
  protected expectedDecimalBounds(): readonly (number | undefined)[] {
    return [10, 2];
  }

  /** What a boolean column's `true` default reads back as. */
  protected expectedTrueDefault(): boolean | number {
    return true;
  }

  /** The self-reference's `ON DELETE`, e.g. `NO ACTION` where a cascading one is refused. */
  protected selfReferenceOnDelete(): ForeignKeyAction {
    return 'SET NULL';
  }

  /** The `ON DELETE` of the two references to A, e.g. `NO ACTION` where there is no `RESTRICT`. */
  protected restrictOnDelete(): ForeignKeyAction {
    return 'RESTRICT';
  }

  /** A column definition the engine recomputes per read, which SQL Server spells by leaving `PERSISTED` off. */
  protected virtualGeneratedColumn(): string {
    return 'doubled INTEGER GENERATED ALWAYS AS (qty * 2) VIRTUAL';
  }

  /** Dialect-specific columns added to table A, e.g. Postgres's array columns. */
  protected async addDialectSpecificColumnsA(_querier: SqlQuerier): Promise<void> {}

  async shouldIntrospectTableNames() {
    expect(await this.introspector.getTableNames()).toEqual([
      INTROSPECT_TABLES.A,
      INTROSPECT_TABLES.B,
      INTROSPECT_TABLES.C,
      INTROSPECT_TABLES.COMPOSITE_PK,
      INTROSPECT_TABLES.COMPOSITE_UNIQUE,
      INTROSPECT_TABLES.MULTI_FK,
      INTROSPECT_TABLES.NO_FK,
      INTROSPECT_TABLES.SELF_REF,
    ]);
  }

  async shouldReturnUndefinedForNonExistentTable() {
    const schema = await this.introspector.getTableSchema('non_existent_table_xyz');
    expect(schema).toBeUndefined();
  }

  async shouldCheckTableExists() {
    const existsA = await this.introspector.tableExists(INTROSPECT_TABLES.A);
    const existsNone = await this.introspector.tableExists('non_existent_table_xyz');

    expect(existsA).toBe(true);
    expect(existsNone).toBe(false);
  }

  async shouldIntrospectTableSchema() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);

    expect(schema.name).toBe(INTROSPECT_TABLES.B);
    expect(schema.columns.map((column) => column.name)).toEqual(['id', 'a_id', 'col1', 'col2', 'unique_code']);
  }

  async shouldIntrospectPrimaryKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(schema.primaryKey?.columns).toEqual(['id']);
    expect(this.getColumn(schema, 'id')).toMatchObject({ isPrimaryKey: true, isAutoIncrement: true });
  }

  /** `toMatchObject` because a key's name is the engine's to choose. */
  async shouldIntrospectForeignKeys() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);

    expect(schema.foreignKeys).toMatchObject([
      {
        columns: ['a_id'],
        references: { table: INTROSPECT_TABLES.A, columns: ['id'] },
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ]);
  }

  async shouldIntrospectSetNullForeignKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.C);

    expect(schema.foreignKeys).toMatchObject([
      {
        columns: ['b_id'],
        references: { table: INTROSPECT_TABLES.B, columns: ['id'] },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
    ]);
  }

  async shouldIntrospectIndexes() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);

    const index = this.getIndex(schema, 'test_b_cols_idx');
    expect(index.entries.map((entry) => entry.column)).toEqual(['col1', 'col2']);
    expect(index.unique).toBe(false);
  }

  async shouldIntrospectSingleColumnIndex() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.C);

    const index = this.getIndex(schema, 'test_c_priority_idx');
    expect(index.entries.map((entry) => entry.column)).toEqual(['priority']);
  }

  async shouldIntrospectUniqueColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);

    const uniqueCol = this.getColumn(schema, 'unique_code');
    expect(uniqueCol.isUnique).toBe(true);
  }

  /** The predicate as the engine reprints it, `code > 0` as written. */
  protected expectedPartialPredicate(): string {
    return 'code > 0';
  }

  /** A partial unique index keeps its predicate, and makes no column unique. */
  async shouldReadAPartialIndexWithItsPredicate() {
    const schema = await this.probe('introspect_partial', async (querier, table) => {
      await querier.run(raw.text(`CREATE TABLE ${table} (code INTEGER)`));
      await querier.run(raw.text(`CREATE UNIQUE INDEX introspect_partial_uk ON ${table} (code) WHERE code > 0`));
    });

    expect(this.getIndex(schema, 'introspect_partial_uk').where).toBe(this.expectedPartialPredicate());
    expect(this.getColumn(schema, 'code').isUnique).toBe(false);
  }

  async shouldIntrospectNullableColumns() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const nameCol = this.getColumn(schema, 'name');
    expect(nameCol.nullable).toBe(true);
  }

  async shouldIntrospectAStoredGeneratedColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.C);

    // Every engine reprints the expression its own way, parenthesising and quoting as it pleases, so
    // what is portable is the operands and the operator between them.
    const { generatedAs } = this.getColumn(schema, 'doubled');
    assertDefined(generatedAs, `'doubled' came back without its expression`);
    expect(generatedAs.replace(/[\s"`[\]()]/g, '')).toBe('priority*2');
  }

  async shouldLeaveAPlainColumnUngenerated() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.C);

    expect(this.getColumn(schema, 'priority').generatedAs).toBe(undefined);
  }

  /**
   * A column the engine recomputes per read has no `stored` to declare it with, and reporting one as
   * stored would have a generated entity ask for a column the database does not hold. SQL Server and
   * SQLite make this the default form, so real databases are full of them.
   */
  async shouldLeaveAVirtualGeneratedColumnOut() {
    const schema = await this.probe('introspect_virtual', (querier, table) =>
      querier.run(raw.text(`CREATE TABLE ${table} (qty INTEGER, ${this.virtualGeneratedColumn()})`)),
    );

    expect(this.getColumn(schema, 'doubled').generatedAs).toBe(undefined);
  }

  async shouldIntrospectNotNullColumns() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.C);

    const priorityCol = this.getColumn(schema, 'priority');
    expect(priorityCol.nullable).toBe(false);
  }

  async shouldIntrospectStringDefaultValue() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const statusCol = this.getColumn(schema, 'status');
    expect(statusCol.defaultValue).toBe('active');
  }

  async shouldIntrospectVarcharLength() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(this.getColumn(schema, 'status').length).toBe(50);
  }

  async shouldIntrospectBooleanDefaultValue() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(this.getColumn(schema, 'is_enabled').defaultValue).toBe(this.expectedTrueDefault());
  }

  async shouldIntrospectTimestampDefault() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(this.getColumn(schema, 'created_at').defaultValue).toEqual(new SqlExpression('currentTimestamp'));
  }

  /** A precision is a decimal's or a timestamp's: every catalogue also counts an integer's digits or bits. */
  async shouldReadAPrecisionOnlyWhereTheTypeDeclaresOne() {
    const table = (await this.introspector.introspect([INTROSPECT_TABLES.A])).getTable(INTROSPECT_TABLES.A);
    const typeOf = (name: string) => table?.columns.get(name)?.type;

    expect([typeOf('amount')?.precision, typeOf('amount')?.scale]).toEqual(this.expectedDecimalBounds());
    expect([typeOf('score')?.precision, typeOf('score')?.scale]).toEqual([undefined, undefined]);
  }

  async shouldIntrospectIntegerDefaultValue() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const scoreCol = this.getColumn(schema, 'score');
    expect(scoreCol.defaultValue).toBe(0);
  }

  /**
   * Every literal default kind, run rather than string-compared: MySQL rejects `toISOString`'s `T` and
   * `Z`, wants `DEFAULT ('x')` on a `TEXT` column, and reads `'a\b'` as a backspace.
   */
  async shouldCreateATableWithEveryLiteralDefault() {
    const table = 'introspect_defaults';
    const schema = await this.probe(table, async (querier) => {
      const builder = await migrationBuilderFor(querier);
      await builder.createTable(table, (t) => {
        t.id();
        t.text('note').defaultValue('none');
        t.text('escaped').defaultValue('a\\b');
        t.timestamp('at').defaultValue(new Date('2024-01-15T10:30:00.000Z'));
        t.string('label', { length: 20 }).defaultValue("it's");
        t.integer('score').defaultValue(0);
        t.boolean('enabled').defaultValue(true);
      });
    });

    expect(schema.columns.map((column) => column.name)).toEqual([
      'id',
      'note',
      'escaped',
      'at',
      'label',
      'score',
      'enabled',
    ]);
  }

  async shouldReportNoPrimaryKeyOnATableWithoutOne() {
    const schema = await this.probe('introspect_keyless', (querier, table) =>
      querier.run(raw.text(`CREATE TABLE ${table} (${querier.dialect.escapeId('x')} INTEGER)`)),
    );

    expect(schema.primaryKey).toBeUndefined();
    expect(this.getColumn(schema, 'x').isPrimaryKey).toBe(false);
  }

  /** The key's own index makes a sole key column unique already, which the entity side never states. */
  async shouldNotMarkAKeyColumnAsUnique() {
    const table = 'introspect_string_key';
    const schema = await this.probe(table, async (querier) => {
      const builder = await migrationBuilderFor(querier);
      await builder.createTable(table, (t) => {
        t.string('code', { length: 36 }).primaryKey();
      });
    });

    expect(this.getColumn(schema, 'code')).toMatchObject({
      isPrimaryKey: true,
      isUnique: false,
      isAutoIncrement: false,
    });
  }

  async shouldIntrospectCompositePrimaryKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_PK);

    expect(schema.primaryKey?.columns).toEqual(['tenant_id', 'entity_id']);
  }

  async shouldMarkAllCompositePKColumnsAsPrimaryKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_PK);

    expect(
      schema.columns.map(({ name, isPrimaryKey, isAutoIncrement }) => ({ name, isPrimaryKey, isAutoIncrement })),
    ).toEqual([
      { name: 'tenant_id', isPrimaryKey: true, isAutoIncrement: false },
      { name: 'entity_id', isPrimaryKey: true, isAutoIncrement: false },
      { name: 'data', isPrimaryKey: false, isAutoIncrement: false },
    ]);
  }

  /** Declared out of table order, so only a key read in its own order pairs each column right. */
  async shouldPairTheColumnsOfACompositeForeignKey() {
    const schema = await this.probe(INTROSPECT_TABLES.COMPOSITE_FK, (querier, table) =>
      querier.run(
        raw.text(
          `CREATE TABLE ${table} (pb INTEGER, pa INTEGER, FOREIGN KEY (pa, pb) REFERENCES ${querier.dialect.escapeId(INTROSPECT_TABLES.COMPOSITE_PK)} (tenant_id, entity_id) ON DELETE CASCADE)`,
        ),
      ),
    );

    expect(schema.foreignKeys).toMatchObject([
      {
        columns: ['pa', 'pb'],
        references: { table: INTROSPECT_TABLES.COMPOSITE_PK, columns: ['tenant_id', 'entity_id'] },
        onDelete: 'CASCADE',
      },
    ]);
  }

  async shouldIntrospectSelfReferencingForeignKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.SELF_REF);

    expect(schema.foreignKeys).toMatchObject([
      {
        columns: ['parent_id'],
        references: { table: INTROSPECT_TABLES.SELF_REF, columns: ['id'] },
        onDelete: this.selfReferenceOnDelete(),
      },
    ]);
    expect(this.getColumn(schema, 'parent_id').nullable).toBe(true);
  }

  async shouldIntrospectSetDefaultForeignKey() {
    const schema = await this.probe(INTROSPECT_TABLES.SET_DEFAULT, (querier, table) =>
      querier.run(
        raw.text(
          `CREATE TABLE ${table} (parent_id BIGINT DEFAULT 0 REFERENCES ${querier.dialect.escapeId(INTROSPECT_TABLES.NO_FK)} (id) ON DELETE SET DEFAULT)`,
        ),
      ),
    );

    expect(schema.foreignKeys).toMatchObject([
      { columns: ['parent_id'], onDelete: 'SET DEFAULT', onUpdate: 'NO ACTION' },
    ]);
  }

  /** Sorted by column: SQLite lists the newest key first, where the rest sort them by name. */
  async shouldIntrospectMultipleForeignKeysToSameTable() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.MULTI_FK);
    const keys = schema.foreignKeys?.toSorted((a, b) => a.columns[0].localeCompare(b.columns[0]));

    expect(keys).toMatchObject([
      { columns: ['created_by'], references: { table: INTROSPECT_TABLES.A }, onDelete: this.restrictOnDelete() },
      { columns: ['updated_by'], references: { table: INTROSPECT_TABLES.A }, onDelete: this.restrictOnDelete() },
    ]);
  }

  async shouldIntrospectCompositeUniqueConstraint() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_UNIQUE);

    const index = this.getIndex(schema, 'code_region_uk');
    expect(index.unique).toBe(true);
    expect(index.entries.map((entry) => entry.column)).toEqual(['code', 'region']);
  }

  async shouldNotMarkTheColumnsOfACompositeUniqueAsUnique() {
    const schema = await this.probe('introspect_unique_pair', (querier, table) =>
      querier.run(raw.text(`CREATE TABLE ${table} (v INTEGER, w INTEGER, UNIQUE (v, w))`)),
    );

    expect(schema.columns.map(({ name, isUnique }) => ({ name, isUnique }))).toEqual([
      { name: 'v', isUnique: false },
      { name: 'w', isUnique: false },
    ]);
  }

  async shouldIntrospectTableWithNoForeignKeys() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.NO_FK);

    expect(schema.foreignKeys).toEqual([]);
    expect(schema.columns.map((column) => column.name)).toEqual(['id', 'value']);
  }

  async shouldIntrospectTableWithNoIndexes() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.NO_FK);

    expect(schema.indexes).toEqual([]);
  }

  async shouldIntrospectFullSchemaAST() {
    const ast = await this.introspector.introspect();
    const columnsOf = (table: string, index: string) =>
      ast
        .getTable(table)
        ?.indexes.find((it) => it.name === index)
        ?.entries.map((entry) => entry.column);

    expect(ast.getTables().map((table) => table.name)).toEqual(await this.introspector.getTableNames());
    expect(ast.relationships.map(({ from, to, onDelete }) => [from.table.name, to.table.name, onDelete])).toEqual([
      [INTROSPECT_TABLES.B, INTROSPECT_TABLES.A, 'CASCADE'],
      [INTROSPECT_TABLES.C, INTROSPECT_TABLES.B, 'SET NULL'],
      [INTROSPECT_TABLES.MULTI_FK, INTROSPECT_TABLES.A, this.restrictOnDelete()],
      [INTROSPECT_TABLES.MULTI_FK, INTROSPECT_TABLES.A, this.restrictOnDelete()],
      [INTROSPECT_TABLES.SELF_REF, INTROSPECT_TABLES.SELF_REF, this.selfReferenceOnDelete()],
    ]);
    expect(columnsOf(INTROSPECT_TABLES.B, 'test_b_cols_idx')).toEqual(['col1', 'col2']);
    expect(columnsOf(INTROSPECT_TABLES.C, 'test_c_priority_idx')).toEqual(['priority']);
  }

  /** The schema of the table `create` makes, dropped before in case a killed run left it, and after. */
  protected async probe(
    table: string,
    create: (querier: SqlQuerier, escapedTable: string) => Promise<unknown>,
  ): Promise<TableSchema> {
    const querier = await this.pool.getQuerier();
    const escapedTable = querier.dialect.escapeId(table);
    const drop = () => querier.run(raw.text(`DROP TABLE IF EXISTS ${escapedTable}`));
    try {
      await drop();
      await create(querier, escapedTable);
      return await this.getTableSchema(table);
    } finally {
      await drop();
      await querier.release();
    }
  }

  protected async getTableSchema(tableName: string): Promise<TableSchema> {
    const schema = await this.introspector.getTableSchema(tableName);
    assertDefined(schema, `Table ${tableName} not found`);
    return schema;
  }

  protected getColumn(schema: TableSchema, columnName: string) {
    const col = schema.columns.find((c) => c.name === columnName);
    assertDefined(col, `Column ${columnName} not found in ${schema.name}`);
    return col;
  }

  protected getIndex(schema: TableSchema, indexName: string) {
    const index = schema.indexes?.find((i) => i.name === indexName);
    assertDefined(index, `Index ${indexName} not found in ${schema.name}`);
    return index;
  }
}
