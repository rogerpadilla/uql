import { expect } from 'vitest';
import type { Spec } from '../../test/index.js';
import type { ColumnSchema, QuerierPool, SchemaIntrospector, SqlQuerier, TableSchema } from '../../type/index.js';
import { t } from '../builder/expressions.js';
import { MigrationBuilder } from '../builder/migrationBuilder.js';

/**
 * Test table names for schema introspection tests.
 * These are used consistently across all dialect implementations.
 */
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
 * Abstract integration test base class for schema introspectors.
 * Provides comprehensive tests for all aspects of schema introspection:
 * - Table discovery
 * - Column types and attributes (types, length, precision, scale)
 * - Primary keys (single and composite)
 * - Foreign keys with referential actions (CASCADE, SET NULL, RESTRICT, NO ACTION)
 * - Indexes (single, composite, unique)
 * - Default values (strings, numbers, booleans, expressions)
 * - Nullability
 * - Self-referencing relationships
 * - Edge cases (no indexes, no FKs)
 *
 * Uses MigrationBuilder for dialect-agnostic DDL operations.
 * Subclasses can override hooks for dialect-specific customization.
 */
export abstract class AbstractIntrospectorIt implements Spec {
  constructor(
    protected readonly pool: QuerierPool<SqlQuerier>,
    protected readonly introspector: SchemaIntrospector,
  ) {}

  // ============================================================================
  // Lifecycle
  // ============================================================================

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

  // ============================================================================
  // DDL Operations (using MigrationBuilder)
  // ============================================================================

  /**
   * Create all test tables using MigrationBuilder.
   * Override `beforeCreateTables` and `afterCreateTables` for dialect-specific setup.
   */
  async createTables(querier: SqlQuerier): Promise<void> {
    const builder = new MigrationBuilder(querier);

    // Hook for dialect-specific pre-setup (e.g., SQLite PRAGMA)
    await this.beforeCreateTables(querier);

    // Table A: Base table with various column types
    await builder.createTable(INTROSPECT_TABLES.A, (tab) => {
      tab.id();
      tab.text('name').nullable();
      tab.string('status', { length: 50 }).defaultValue('active');
      tab.boolean('is_enabled').defaultValue(true);
      tab.integer('score').defaultValue(0);
      tab.timestamp('created_at').defaultValue(t.now());
      tab.decimal('amount', { precision: 10, scale: 2 }).nullable();
    });

    // Hook for dialect-specific columns on table A (e.g., PostgreSQL arrays)
    await this.addDialectSpecificColumnsA(querier);

    // Table B: FK to A with CASCADE actions
    await builder.createTable(INTROSPECT_TABLES.B, (tab) => {
      tab.id();
      tab
        .bigint('a_id')
        .unsigned()
        .nullable()
        .references(INTROSPECT_TABLES.A)
        .onDelete('CASCADE')
        .onUpdate('NO ACTION');
      tab.string('col1', { length: 100 }).nullable();
      tab.string('col2', { length: 100 }).nullable();
      tab.string('unique_code', { length: 50 }).unique();
    });

    // Table C: FK to B with SET NULL / CASCADE
    await builder.createTable(INTROSPECT_TABLES.C, (tab) => {
      tab.id();
      tab.bigint('b_id').unsigned().nullable().references(INTROSPECT_TABLES.B).onDelete('SET NULL').onUpdate('CASCADE');
      tab.integer('priority').notNullable();
    });

    // Composite primary key table
    await builder.createTable(INTROSPECT_TABLES.COMPOSITE_PK, (tab) => {
      tab.integer('tenant_id').notNullable().primaryKey();
      tab.integer('entity_id').notNullable().primaryKey();
      tab.text('data').nullable();
    });

    // Self-referencing table
    await builder.createTable(INTROSPECT_TABLES.SELF_REF, (tab) => {
      tab.id();
      tab.bigint('parent_id').unsigned().nullable().references(INTROSPECT_TABLES.SELF_REF).onDelete('SET NULL');
      tab.string('name', { length: 255 }).notNullable();
    });

    // Multiple FKs to same table
    await builder.createTable(INTROSPECT_TABLES.MULTI_FK, (tab) => {
      tab.id();
      tab.bigint('created_by').unsigned().nullable().references(INTROSPECT_TABLES.A).onDelete('RESTRICT');
      tab.bigint('updated_by').unsigned().nullable().references(INTROSPECT_TABLES.A).onDelete('RESTRICT');
    });

    // Composite unique constraint
    await builder.createTable(INTROSPECT_TABLES.COMPOSITE_UNIQUE, (tab) => {
      tab.id();
      tab.string('code', { length: 100 }).notNullable();
      tab.string('region', { length: 100 }).notNullable();
    });
    await builder.createIndex(INTROSPECT_TABLES.COMPOSITE_UNIQUE, ['code', 'region'], {
      name: 'uq_code_region',
      unique: true,
    });

    // Table with no FKs (edge case)
    await builder.createTable(INTROSPECT_TABLES.NO_FK, (tab) => {
      tab.id();
      tab.text('value').nullable();
    });

    // Indexes
    await builder.createIndex(INTROSPECT_TABLES.B, ['col1', 'col2'], { name: 'idx_test_b_cols' });
    await builder.createIndex(INTROSPECT_TABLES.C, ['priority'], { name: 'idx_test_c_priority' });

    // Hook for dialect-specific post-setup
    await this.afterCreateTables(querier);
  }

  /**
   * Drop all test tables using MigrationBuilder.
   * Drops in reverse dependency order.
   */
  async dropTables(querier: SqlQuerier): Promise<void> {
    // Hook for dialect-specific pre-drop (e.g., MySQL disable FK checks)
    await this.beforeDropTables(querier);

    const builder = new MigrationBuilder(querier);

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

  // ============================================================================
  // Dialect-Specific Hooks (override in subclasses)
  // ============================================================================

  /**
   * Called before creating tables. Use for dialect-specific setup.
   * E.g., SQLite: PRAGMA foreign_keys = ON
   */
  protected async beforeCreateTables(_querier: SqlQuerier): Promise<void> {}

  /**
   * Called after creating tables. Use for dialect-specific additions.
   */
  protected async afterCreateTables(_querier: SqlQuerier): Promise<void> {}

  /**
   * Add dialect-specific columns to table A.
   * E.g., PostgreSQL: array columns
   */
  protected async addDialectSpecificColumnsA(_querier: SqlQuerier): Promise<void> {}

  /**
   * Called before dropping tables. Use for dialect-specific setup.
   * E.g., MySQL: SET FOREIGN_KEY_CHECKS = 0
   */
  protected async beforeDropTables(_querier: SqlQuerier): Promise<void> {}

  /**
   * Called after dropping tables. Use for dialect-specific cleanup.
   * E.g., MySQL: SET FOREIGN_KEY_CHECKS = 1
   */
  protected async afterDropTables(_querier: SqlQuerier): Promise<void> {}

  // ============================================================================
  // Table Discovery Tests
  // ============================================================================

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

  // ============================================================================
  // Basic Table Schema Tests
  // ============================================================================

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

  // ============================================================================
  // Primary Key Tests
  // ============================================================================

  async shouldIntrospectPrimaryKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(schema.primaryKey).toBeDefined();
    expect(schema.primaryKey).toContain('id');

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isPrimaryKey).toBe(true);
  }

  // ============================================================================
  // Foreign Key Tests
  // ============================================================================

  async shouldIntrospectForeignKeys() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);

    expect(schema.foreignKeys.length).toBeGreaterThanOrEqual(1);

    const fk = this.getForeignKey(schema, 'a_id');
    expect(fk.referencedTable).toBe(INTROSPECT_TABLES.A);
    expect(fk.referencedColumns).toEqual(['id']);
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
    expect(fk.referencedTable).toBe(INTROSPECT_TABLES.B);
    expect(fk.onDelete).toBe('SET NULL');
    expect(fk.onUpdate).toBe('CASCADE');
  }

  // ============================================================================
  // Index Tests
  // ============================================================================

  async shouldIntrospectIndexes() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);

    const index = this.getIndex(schema, 'idx_test_b_cols');
    expect(index.columns).toEqual(['col1', 'col2']);
    expect(index.unique).toBe(false);
  }

  async shouldIntrospectSingleColumnIndex() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.C);

    const index = this.getIndex(schema, 'idx_test_c_priority');
    expect(index.columns).toEqual(['priority']);
  }

  // ============================================================================
  // Unique Constraint Tests
  // ============================================================================

  async shouldIntrospectUniqueColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);

    const uniqueCol = this.getColumn(schema, 'unique_code');
    expect(uniqueCol.isUnique).toBe(true);
  }

  // ============================================================================
  // Nullability Tests
  // ============================================================================

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

  // ============================================================================
  // Default Value Tests
  // ============================================================================

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

  // ============================================================================
  // Auto-increment Tests
  // ============================================================================

  async shouldIntrospectAutoIncrement() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isAutoIncrement).toBe(true);
  }

  // ============================================================================
  // Composite Primary Key Tests
  // ============================================================================

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

  // ============================================================================
  // Self-Referencing Foreign Key Tests
  // ============================================================================

  async shouldIntrospectSelfReferencingForeignKey() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.SELF_REF);

    const fk = this.getForeignKey(schema, 'parent_id');
    expect(fk.referencedTable).toBe(INTROSPECT_TABLES.SELF_REF);
    expect(fk.referencedColumns).toEqual(['id']);
    expect(fk.onDelete).toBe('SET NULL');
  }

  async shouldAllowNullOnSelfReferencingFK() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.SELF_REF);

    const parentCol = this.getColumn(schema, 'parent_id');
    expect(parentCol.nullable).toBe(true);
  }

  // ============================================================================
  // Multiple Foreign Keys to Same Table Tests
  // ============================================================================

  async shouldIntrospectMultipleForeignKeysToSameTable() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.MULTI_FK);

    expect(schema.foreignKeys.length).toBe(2);

    const createdByFK = this.getForeignKey(schema, 'created_by');
    expect(createdByFK.referencedTable).toBe(INTROSPECT_TABLES.A);

    const updatedByFK = this.getForeignKey(schema, 'updated_by');
    expect(updatedByFK.referencedTable).toBe(INTROSPECT_TABLES.A);
  }

  async shouldIntrospectRestrictReferentialAction() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.MULTI_FK);

    const fk = this.getForeignKey(schema, 'created_by');
    expect(fk.onDelete).toBe('RESTRICT');
  }

  // ============================================================================
  // Composite Unique Constraint Tests
  // ============================================================================

  async shouldIntrospectCompositeUniqueConstraint() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_UNIQUE);

    // Find composite unique constraint - stored as unique index
    const uniqueIndex = schema.indexes.find(
      (i) => i.unique && i.columns.includes('code') && i.columns.includes('region'),
    );
    this.assertDefined(uniqueIndex, 'Composite unique index on (code, region) not found');

    expect(uniqueIndex.columns).toHaveLength(2);
    expect(uniqueIndex.unique).toBe(true);
  }

  // ============================================================================
  // Edge Case Tests
  // ============================================================================

  async shouldIntrospectTableWithNoForeignKeys() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.NO_FK);

    expect(schema.foreignKeys).toEqual([]);
    expect(schema.columns.map((c: ColumnSchema) => c.name)).toContain('value');
  }

  async shouldIntrospectTableWithNoIndexes() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.NO_FK);

    // Primary key index might still exist, but no user-defined indexes
    const nonPkIndexes = schema.indexes.filter((i) => i.name !== 'PRIMARY');
    expect(nonPkIndexes.filter((i) => i.name.includes(INTROSPECT_TABLES.NO_FK))).toEqual([]);
  }

  // ============================================================================
  // Column Ordering Tests
  // ============================================================================

  async shouldPreserveColumnOrder() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const columnNames = schema.columns.map((c: ColumnSchema) => c.name);
    const idIndex = columnNames.indexOf('id');
    const nameIndex = columnNames.indexOf('name');
    const statusIndex = columnNames.indexOf('status');

    expect(idIndex).toBeLessThan(nameIndex);
    expect(nameIndex).toBeLessThan(statusIndex);
  }

  // ============================================================================
  // Column Count Tests
  // ============================================================================

  async shouldIntrospectCorrectColumnCount() {
    const schemaA = await this.getTableSchema(INTROSPECT_TABLES.A);
    const schemaCompositePK = await this.getTableSchema(INTROSPECT_TABLES.COMPOSITE_PK);

    // test_introspect_a has at least: id, name, status, is_enabled, score
    expect(schemaA.columns.length).toBeGreaterThanOrEqual(5);

    // test_introspect_composite_pk has exactly: tenant_id, entity_id, data
    expect(schemaCompositePK.columns.length).toBe(3);
  }

  // ============================================================================
  // SchemaAST Integration Tests
  // ============================================================================

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

    const idxBCols = ast.indexes.find((i) => i.name === 'idx_test_b_cols');
    expect(idxBCols).toBeDefined();
    expect(idxBCols?.columns.length).toBe(2);
    expect(idxBCols?.columns.map((c) => c.name)).toEqual(['col1', 'col2']);

    const idxCPriority = ast.indexes.find((i) => i.name === 'idx_test_c_priority');
    expect(idxCPriority).toBeDefined();
    expect(idxCPriority?.columns.length).toBe(1);
  }

  // ============================================================================
  // Helper methods
  // ============================================================================

  protected async getTableSchema(tableName: string): Promise<TableSchema> {
    const schema = await this.introspector.getTableSchema(tableName);
    this.assertDefined(schema, `Table ${tableName} not found`);
    return schema;
  }

  protected getColumn(schema: TableSchema, columnName: string) {
    const col = schema.columns.find((c) => c.name === columnName);
    this.assertDefined(col, `Column ${columnName} not found in ${schema.name}`);
    return col;
  }

  protected getForeignKey(schema: TableSchema, columnName: string) {
    const fk = schema.foreignKeys.find((f) => f.columns.includes(columnName));
    this.assertDefined(fk, `Foreign key on ${columnName} not found in ${schema.name}`);
    return fk;
  }

  protected getIndex(schema: TableSchema, indexName: string) {
    const index = schema.indexes.find((i) => i.name === indexName);
    this.assertDefined(index, `Index ${indexName} not found in ${schema.name}`);
    return index;
  }

  private assertDefined<T>(value: T | undefined, message: string): asserts value is T {
    expect(value, message).toBeDefined();
  }
}
