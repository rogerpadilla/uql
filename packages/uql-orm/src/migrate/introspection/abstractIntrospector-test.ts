import { expect } from 'vitest';
import { sqlToCanonical } from '../../schema/canonicalType.js';
import type { ForeignKeyAction, TypeCategory } from '../../schema/types.js';
import { assertDefined, type Spec, type SpecRequirements } from '../../test/index.js';
import type {
  ColumnSchema,
  IndexSchema,
  QuerierPool,
  SchemaIntrospector,
  SqlQuerier,
  TableSchema,
} from '../../type/index.js';
import { expr } from '../builder/expressions.js';
import { migrationBuilderFor } from '../migrationTarget.js';

/** Test table names shared across every dialect's introspection suite. */
export const INTROSPECT_TABLES = {
  A: 'test_introspect_a',
  B: 'test_introspect_b',
  C: 'test_introspect_c',
  COMPOSITE_PK: 'test_introspect_composite_pk',
  SELF_REF: 'test_introspect_self_ref',
  MULTI_FK: 'test_introspect_multi_fk',
  COMPOSITE_UNIQUE: 'test_introspect_composite_unique',
  NO_FK: 'test_introspect_no_fk',
} as const;

/**
 * Shared integration suite for schema introspectors, covering table/column/PK/FK/index/default-value
 * introspection plus self-references and edge cases. Builds its fixture tables with
 * {@link MigrationBuilder} so the DDL stays dialect-agnostic; subclasses override the hooks below for
 * dialect-specific setup/teardown and add their own dialect-specific tests.
 */
export abstract class AbstractIntrospectorIt implements Spec {
  constructor(
    protected readonly pool: QuerierPool<SqlQuerier>,
    protected readonly introspector: SchemaIntrospector,
  ) {}

  /** Whether the engine keeps an `ON DELETE SET DEFAULT`, which InnoDB parses and refuses. */
  protected readonly setDefaultAction: boolean = true;

  requirements(): SpecRequirements<this> {
    return { shouldIntrospectSetDefaultForeignKey: this.setDefaultAction };
  }

  async beforeAll() {
    const querier = await this.pool.getQuerier();
    try {
      await this.dropTables(querier);
      await this.createTables(querier);
    } finally {
      await querier.release();
    }
  }

  async afterAll() {
    const querier = await this.pool.getQuerier();
    try {
      await this.dropTables(querier);
    } finally {
      await querier.release();
    }
    await this.pool.end();
  }

  /** Create all test tables using MigrationBuilder. */
  async createTables(querier: SqlQuerier): Promise<void> {
    const builder = await migrationBuilderFor(querier);

    // Table A: Base table with various column types
    await builder.createTable(INTROSPECT_TABLES.A, (t) => {
      t.id();
      t.text('name').nullable();
      t.string('status', { length: 50 }).defaultValue('active');
      t.boolean('is_enabled').defaultValue(true);
      t.integer('score').defaultValue(0);
      t.timestamp('created_at').defaultValue(expr.now());
      t.decimal('amount', { precision: 10, scale: 2 }).nullable();
    });

    // Hook for dialect-specific columns on table A (e.g., PostgreSQL arrays)
    await this.addDialectSpecificColumnsA(querier);

    // Table B: FK to A with CASCADE actions
    await builder.createTable(INTROSPECT_TABLES.B, (t) => {
      t.id();
      t.bigint('a_id').nullable().references(INTROSPECT_TABLES.A).onDelete('CASCADE').onUpdate('NO ACTION');
      t.string('col1', { length: 100 }).nullable();
      t.string('col2', { length: 100 }).nullable();
      t.string('unique_code', { length: 50 }).unique();
    });

    // Table C: FK to B with SET NULL / CASCADE
    await builder.createTable(INTROSPECT_TABLES.C, (t) => {
      t.id();
      t.bigint('b_id').nullable().references(INTROSPECT_TABLES.B).onDelete('SET NULL').onUpdate('CASCADE');
      t.integer('priority').notNullable();
    });

    // Composite primary key table
    await builder.createTable(INTROSPECT_TABLES.COMPOSITE_PK, (t) => {
      t.integer('tenant_id').notNullable().primaryKey();
      t.integer('entity_id').notNullable().primaryKey();
      t.text('data').nullable();
    });

    // Self-referencing table
    await builder.createTable(INTROSPECT_TABLES.SELF_REF, (t) => {
      t.id();
      t.bigint('parent_id').nullable().references(INTROSPECT_TABLES.SELF_REF).onDelete(this.selfReferenceOnDelete());
      t.string('name', { length: 255 }).notNullable();
    });

    // Multiple FKs to same table
    await builder.createTable(INTROSPECT_TABLES.MULTI_FK, (t) => {
      t.id();
      t.bigint('created_by').nullable().references(INTROSPECT_TABLES.A).onDelete(this.restrictOnDelete());
      t.bigint('updated_by').nullable().references(INTROSPECT_TABLES.A).onDelete(this.restrictOnDelete());
    });

    // Composite unique constraint
    await builder.createTable(INTROSPECT_TABLES.COMPOSITE_UNIQUE, (t) => {
      t.id();
      t.string('code', { length: 100 }).notNullable();
      t.string('region', { length: 100 }).notNullable();
    });
    await builder.createIndex(INTROSPECT_TABLES.COMPOSITE_UNIQUE, ['code', 'region'], {
      name: 'code_region_uk',
      unique: true,
    });

    // Table with no FKs (edge case)
    await builder.createTable(INTROSPECT_TABLES.NO_FK, (t) => {
      t.id();
      t.text('value').nullable();
    });

    // Indexes
    await builder.createIndex(INTROSPECT_TABLES.B, ['col1', 'col2'], { name: 'test_b_cols_idx' });
    await builder.createIndex(INTROSPECT_TABLES.C, ['priority'], { name: 'test_c_priority_idx' });
  }

  /**
   * Drop all test tables using MigrationBuilder.
   * Drops in reverse dependency order.
   */
  async dropTables(querier: SqlQuerier): Promise<void> {
    // Hook for dialect-specific pre-drop (e.g., MySQL disable FK checks)
    await this.beforeDropTables(querier);

    const builder = await migrationBuilderFor(querier);

    // Drop in reverse dependency order
    await builder.dropTable(INTROSPECT_TABLES.NO_FK, { ifExists: true, cascade: true });
    await builder.dropTable(INTROSPECT_TABLES.COMPOSITE_UNIQUE, { ifExists: true, cascade: true });
    await builder.dropTable(INTROSPECT_TABLES.MULTI_FK, { ifExists: true, cascade: true });
    await builder.dropTable(INTROSPECT_TABLES.SELF_REF, { ifExists: true, cascade: true });
    await builder.dropTable(INTROSPECT_TABLES.COMPOSITE_PK, { ifExists: true, cascade: true });
    await builder.dropTable(INTROSPECT_TABLES.C, { ifExists: true, cascade: true });
    await builder.dropTable(INTROSPECT_TABLES.B, { ifExists: true, cascade: true });
    await builder.dropTable(INTROSPECT_TABLES.A, { ifExists: true, cascade: true });

    // Hook for dialect-specific post-drop
    await this.afterDropTables(querier);
  }

  /**
   * What a `timestamp` column reads back as. SQLite has no date/time type at all - it stores one as
   * `TEXT` - so the canonical category it introspects to is genuinely different, not a bug.
   */
  protected expectedTimestampCategory(): TypeCategory {
    return 'timestamp';
  }

  /** The self-reference's `ON DELETE`, e.g. `NO ACTION` where a cascading one is refused. */
  protected selfReferenceOnDelete(): ForeignKeyAction {
    return 'SET NULL';
  }

  /** The `ON DELETE` of the two references to A, e.g. `NO ACTION` where there is no `RESTRICT`. */
  protected restrictOnDelete(): ForeignKeyAction {
    return 'RESTRICT';
  }

  /** Dialect-specific columns added to table A, e.g. Postgres's array columns. */
  protected async addDialectSpecificColumnsA(_querier: SqlQuerier): Promise<void> {}

  /** Dialect-specific pre-drop, e.g. MySQL's `SET FOREIGN_KEY_CHECKS = 0`. */
  protected async beforeDropTables(_querier: SqlQuerier): Promise<void> {}

  /** Dialect-specific post-drop cleanup, e.g. re-enabling MySQL's FK checks. */
  protected async afterDropTables(_querier: SqlQuerier): Promise<void> {}

  async shouldIntrospectTableNames() {
    const tableNames = await this.introspector.getTableNames();
    expect(tableNames).toContain(INTROSPECT_TABLES.A);
    expect(tableNames).toContain(INTROSPECT_TABLES.B);
    expect(tableNames).toContain(INTROSPECT_TABLES.C);
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

    const colNames = schema.columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('a_id');
    expect(colNames).toContain('col1');
    expect(colNames).toContain('col2');
    expect(colNames).toContain('unique_code');
  }

  async shouldIntrospectPrimaryKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(schema.primaryKey).toBeDefined();
    expect(schema.primaryKey).toContain('id');

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isPrimaryKey).toBe(true);
  }

  async shouldIntrospectForeignKeys() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);

    expect(schema.foreignKeys?.length).toBeGreaterThanOrEqual(1);

    const fk = this.getForeignKey(schema, 'a_id');
    expect(fk.references.table).toBe(INTROSPECT_TABLES.A);
    expect(fk.references.columns).toEqual(['id']);
    expect(fk.columns).toEqual(['a_id']);
  }

  async shouldIntrospectForeignKeyActions() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);

    const fk = this.getForeignKey(schema, 'a_id');
    expect(fk.onDelete).toBe('CASCADE');
    expect(fk.onUpdate).toBe('NO ACTION');
  }

  async shouldIntrospectSetNullForeignKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.C);

    const fk = this.getForeignKey(schema, 'b_id');
    expect(fk.references.table).toBe(INTROSPECT_TABLES.B);
    expect(fk.onDelete).toBe('SET NULL');
    expect(fk.onUpdate).toBe('CASCADE');
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

  async shouldIntrospectNullableColumns() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const nameCol = this.getColumn(schema, 'name');
    expect(nameCol.nullable).toBe(true);
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

  async shouldIntrospectIntegerDefaultValue() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const scoreCol = this.getColumn(schema, 'score');
    expect(scoreCol.defaultValue).toBe(0);
  }

  async shouldAddColumnWithTheDeclaredType() {
    const querier = await this.pool.getQuerier();
    try {
      const builder = await migrationBuilderFor(querier);
      await builder.addColumn(INTROSPECT_TABLES.A, (column) => column.timestamp('added_at', { nullable: true }));

      const schema = await this.getTableSchema(INTROSPECT_TABLES.A);
      const addedCol = this.getColumn(schema, 'added_at');
      expect(sqlToCanonical(addedCol.type).category).toBe(this.expectedTimestampCategory());
    } finally {
      const table = querier.dialect.escapeId(INTROSPECT_TABLES.A);
      await querier.run(`ALTER TABLE ${table} DROP COLUMN ${querier.dialect.escapeId('added_at')}`);
      await querier.release();
    }
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

    expect(schema.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['note', 'escaped', 'at', 'label', 'score', 'enabled']),
    );
  }

  async shouldReportNoPrimaryKeyOnATableWithoutOne() {
    const schema = await this.probe('introspect_keyless', (querier, table) =>
      querier.run(`CREATE TABLE ${table} (${querier.dialect.escapeId('x')} INTEGER)`),
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

  async shouldIntrospectAutoIncrement() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isAutoIncrement).toBe(true);
  }

  async shouldIntrospectCompositePrimaryKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_PK);

    expect(schema.primaryKey).toBeDefined();
    expect(schema.primaryKey).toHaveLength(2);
    expect(schema.primaryKey).toContain('tenant_id');
    expect(schema.primaryKey).toContain('entity_id');
  }

  async shouldMarkAllCompositePKColumnsAsPrimaryKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_PK);

    const tenantCol = this.getColumn(schema, 'tenant_id');
    const entityCol = this.getColumn(schema, 'entity_id');

    expect(tenantCol.isPrimaryKey).toBe(true);
    expect(entityCol.isPrimaryKey).toBe(true);
  }

  async shouldNotMarkNonPKColumnAsPrimaryKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_PK);

    const dataCol = this.getColumn(schema, 'data');
    expect(dataCol.isPrimaryKey).toBe(false);
  }

  async shouldNotMarkACompositeKeyAsAutoIncrement() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_PK);

    expect(this.getColumn(schema, 'tenant_id').isAutoIncrement).toBe(false);
    expect(this.getColumn(schema, 'entity_id').isAutoIncrement).toBe(false);
  }

  /** Declared out of table order, so only a key read in its own order pairs each column right. */
  async shouldPairTheColumnsOfACompositeForeignKey() {
    const schema = await this.probe('introspect_composite_fk', (querier, table) =>
      querier.run(
        `CREATE TABLE ${table} (pb INTEGER, pa INTEGER, FOREIGN KEY (pa, pb) REFERENCES ${querier.dialect.escapeId(INTROSPECT_TABLES.COMPOSITE_PK)} (tenant_id, entity_id) ON DELETE CASCADE)`,
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

    const fk = this.getForeignKey(schema, 'parent_id');
    expect(fk.references.table).toBe(INTROSPECT_TABLES.SELF_REF);
    expect(fk.references.columns).toEqual(['id']);
    expect(fk.onDelete).toBe(this.selfReferenceOnDelete());
  }

  async shouldAllowNullOnSelfReferencingFK() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.SELF_REF);

    const parentCol = this.getColumn(schema, 'parent_id');
    expect(parentCol.nullable).toBe(true);
  }

  async shouldIntrospectSetDefaultForeignKey() {
    const schema = await this.probe('introspect_set_default', (querier, table) =>
      querier.run(
        `CREATE TABLE ${table} (parent_id BIGINT DEFAULT 0 REFERENCES ${querier.dialect.escapeId(INTROSPECT_TABLES.NO_FK)} (id) ON DELETE SET DEFAULT)`,
      ),
    );

    expect(this.getForeignKey(schema, 'parent_id')).toMatchObject({ onDelete: 'SET DEFAULT', onUpdate: 'NO ACTION' });
  }

  async shouldIntrospectMultipleForeignKeysToSameTable() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.MULTI_FK);

    expect(schema.foreignKeys?.length).toBe(2);

    const createdByFK = this.getForeignKey(schema, 'created_by');
    expect(createdByFK.references.table).toBe(INTROSPECT_TABLES.A);

    const updatedByFK = this.getForeignKey(schema, 'updated_by');
    expect(updatedByFK.references.table).toBe(INTROSPECT_TABLES.A);
  }

  async shouldIntrospectRestrictReferentialAction() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.MULTI_FK);

    const fk = this.getForeignKey(schema, 'created_by');
    expect(fk.onDelete).toBe(this.restrictOnDelete());
  }

  async shouldIntrospectCompositeUniqueConstraint() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_UNIQUE);

    // Find composite unique constraint - stored as unique index
    const covers = (index: IndexSchema, column: string) => index.entries.some((entry) => entry.column === column);
    const uniqueIndex = schema.indexes?.find((i) => i.unique && covers(i, 'code') && covers(i, 'region'));
    assertDefined(uniqueIndex, 'Composite unique index on (code, region) not found');

    expect(uniqueIndex.entries).toHaveLength(2);
    expect(uniqueIndex.unique).toBe(true);
  }

  async shouldNotMarkTheColumnsOfACompositeUniqueAsUnique() {
    const schema = await this.probe('introspect_unique_pair', (querier, table) =>
      querier.run(`CREATE TABLE ${table} (v INTEGER, w INTEGER, UNIQUE (v, w))`),
    );

    expect(schema.columns.map(({ name, isUnique }) => ({ name, isUnique }))).toEqual([
      { name: 'v', isUnique: false },
      { name: 'w', isUnique: false },
    ]);
  }

  async shouldIntrospectTableWithNoForeignKeys() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.NO_FK);

    expect(schema.foreignKeys).toEqual([]);
    expect(schema.columns.map((c: ColumnSchema) => c.name)).toContain('value');
  }

  async shouldIntrospectTableWithNoIndexes() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.NO_FK);

    expect(schema.indexes).toEqual([]);
  }

  async shouldPreserveColumnOrder() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const columnNames = schema.columns.map((c: ColumnSchema) => c.name);
    const idIndex = columnNames.indexOf('id');
    const nameIndex = columnNames.indexOf('name');
    const statusIndex = columnNames.indexOf('status');

    expect(idIndex).toBeLessThan(nameIndex);
    expect(nameIndex).toBeLessThan(statusIndex);
  }

  async shouldIntrospectCorrectColumnCount() {
    const schemaA = await this.getTableSchema(INTROSPECT_TABLES.A);
    const schemaCompositePK = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_PK);

    // test_introspect_a has at least: id, name, status, is_enabled, score
    expect(schemaA.columns.length).toBeGreaterThanOrEqual(5);

    // test_introspect_composite_pk has exactly: tenant_id, entity_id, data
    expect(schemaCompositePK.columns.length).toBe(3);
  }

  async shouldIntrospectFullSchemaAST() {
    const ast = await this.introspector.introspect();

    expect(ast.getTables().length).toBeGreaterThanOrEqual(3);
    expect(ast.getTable(INTROSPECT_TABLES.A)).toBeDefined();
    expect(ast.getTable(INTROSPECT_TABLES.B)).toBeDefined();
    expect(ast.getTable(INTROSPECT_TABLES.C)).toBeDefined();
  }

  async shouldBuildRelationshipsInAST() {
    const ast = await this.introspector.introspect();

    expect(ast.relationships.length).toBeGreaterThanOrEqual(2);

    const relBtoA = ast.relationships.find(
      (r) => r.from.table.name === INTROSPECT_TABLES.B && r.to.table.name === INTROSPECT_TABLES.A,
    );
    expect(relBtoA).toBeDefined();
    expect(relBtoA?.onDelete).toBe('CASCADE');

    const relCtoB = ast.relationships.find(
      (r) => r.from.table.name === INTROSPECT_TABLES.C && r.to.table.name === INTROSPECT_TABLES.B,
    );
    expect(relCtoB).toBeDefined();
    expect(relCtoB?.onDelete).toBe('SET NULL');
  }

  async shouldBuildIndexesInAST() {
    const ast = await this.introspector.introspect();

    expect(ast.indexes.length).toBeGreaterThanOrEqual(2);

    const idxBCols = ast.indexes.find((i) => i.name === 'test_b_cols_idx');
    expect(idxBCols).toBeDefined();
    expect(idxBCols?.entries.map((entry) => entry.column)).toEqual(['col1', 'col2']);

    const idxCPriority = ast.indexes.find((i) => i.name === 'test_c_priority_idx');
    expect(idxCPriority).toBeDefined();
    expect(idxCPriority?.entries.map((entry) => entry.column)).toEqual(['priority']);
  }

  /** The schema of the table `create` makes, which is dropped again whether or not that worked. */
  protected async probe(
    table: string,
    create: (querier: SqlQuerier, escapedTable: string) => Promise<unknown>,
  ): Promise<TableSchema> {
    const querier = await this.pool.getQuerier();
    const escapedTable = querier.dialect.escapeId(table);
    try {
      await create(querier, escapedTable);
      return await this.getTableSchema(table);
    } finally {
      await querier.run(`DROP TABLE IF EXISTS ${escapedTable}`);
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

  protected getForeignKey(schema: TableSchema, columnName: string) {
    const fk = schema.foreignKeys?.find((f) => f.columns.includes(columnName));
    assertDefined(fk, `Foreign key on ${columnName} not found in ${schema.name}`);
    return fk;
  }

  protected getIndex(schema: TableSchema, indexName: string) {
    const index = schema.indexes?.find((i) => i.name === indexName);
    assertDefined(index, `Index ${indexName} not found in ${schema.name}`);
    return index;
  }
}
