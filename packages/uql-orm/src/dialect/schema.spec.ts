// Schema-qualified tables: which of the two `schema` scopes wins, and what every layer spells as a
// result - queries, generated DDL, and the AST a diff is looked up in.
//
// One distinction runs through all of it. A qualified name is two identifiers; a column prefix, an
// index name and a constraint name are each one. Conflating them is what made
// `@Entity({ name: 'sales.Order' })` emit `"sales.Order"."id"` against a table nothing declared, and
// later what made `CREATE INDEX "idx_crm"."Customer_name"` a syntax error.

import { describe, expect, it } from 'vitest';
import { defineEntity, Entity, Field, getMeta, Id, ManyToOne } from '../entity/index.js';
import { MongoSchemaGenerator } from '../migrate/generator/mongoSchemaGenerator.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import { MongodbNativeDialect } from '../mongo/mongodbNativeDialect.js';
import { PgDialect } from '../postgres/pgDialect.js';
import { SchemaAST } from '../schema/schemaAST.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { mockTableNode } from '../test/schemaMock.js';
import type { QueryContext, Type } from '../type/index.js';
import type { AbstractSqlDialect } from './abstractSqlDialect.js';

@Entity({ schema: 'crm' })
class Customer {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String, index: true })
  name?: string;
}

@Entity({ schema: 'sales' })
class Order {
  @Id({ type: Number })
  id?: number;

  @Field({ type: Number })
  total?: number;

  @ManyToOne({ entity: () => Customer })
  customer?: Customer;
}

/** No schema of its own, so it follows whatever the pool carries. */
@Entity()
class Plain {
  @Id({ type: Number })
  id?: number;

  @Field({ type: Number })
  total?: number;
}

const sqlOf = (dialect: AbstractSqlDialect, build: (ctx: QueryContext) => void) => {
  const ctx = dialect.createContext();
  build(ctx);
  return ctx.sql;
};

describe('schema', () => {
  const dialect = new PgDialect();

  /** The generated statements of one kind, so an assertion names the one it is about. */
  const ddlOf = (entities: Type<unknown>[], startsWith: string) =>
    new SqlSchemaGenerator(dialect).generateCreateSchema(entities).filter((sql) => sql.startsWith(startsWith));

  it('qualifies the table and aliases it, so columns stay single identifiers', () => {
    const sql = sqlOf(dialect, (ctx) => dialect.find(ctx, Order, { $select: { id: true, total: true } }));
    expect(sql).toBe('SELECT "id", "total" FROM "sales"."Order" "Order"');
  });

  it('joins across two schemas against the alias, not the qualified path', () => {
    const sql = sqlOf(dialect, (ctx) =>
      dialect.find(ctx, Order, { $select: { id: true }, $populate: { customer: { $select: { name: true } } } }),
    );
    expect(sql).toContain('FROM "sales"."Order" "Order"');
    expect(sql).toContain('LEFT JOIN "crm"."Customer" "customer" ON "customer"."id" = "Order"."customerId"');
    expect(sql).not.toContain('"sales.Order"');
  });

  it('leaves an unannotated entity unqualified, which is what every existing deployment relies on', () => {
    const sql = sqlOf(dialect, (ctx) => dialect.find(ctx, Plain, { $select: { id: true } }));
    expect(sql).toBe('SELECT "id" FROM "Plain"');
  });

  it("takes the pool's default when the entity names none", () => {
    const scoped = new PgDialect({ schema: 'tenant_a' });
    const sql = sqlOf(scoped, (ctx) => scoped.find(ctx, Plain, { $select: { id: true } }));
    expect(sql).toBe('SELECT "id" FROM "tenant_a"."Plain" "Plain"');
  });

  it('lets the entity override the pool, which is how a shared table sits beside tenant ones', () => {
    const scoped = new PgDialect({ schema: 'tenant_a' });
    const sql = sqlOf(scoped, (ctx) => scoped.find(ctx, Order, { $select: { id: true } }));
    expect(sql).toBe('SELECT "id" FROM "sales"."Order" "Order"');
  });

  it('never passes the schema through the naming strategy, only the table', () => {
    const scoped = new PgDialect({
      schema: 'myCrm',
      namingStrategy: { tableName: (n) => n.toLowerCase(), columnName: (n) => n, joinTableName: (a, b) => `${a}_${b}` },
    });
    const sql = sqlOf(scoped, (ctx) => scoped.find(ctx, Plain, { $select: { id: true } }));
    expect(sql).toBe('SELECT "id" FROM "myCrm"."plain" "plain"');
  });

  it('declares a schema with the statement the engine uses', () => {
    expect(dialect.createSchemaSql('sales')).toBe('CREATE SCHEMA IF NOT EXISTS "sales"');
  });

  // SQLite attaches database files and MongoDB takes its database from the connection, so on both
  // the table stays unqualified rather than growing a dot that names nothing.
  it('leaves the table unqualified on an engine that has no schemas', () => {
    const sqlite = new SqliteDialect({ schema: 'tenant_a' });
    const sql = sqlOf(sqlite, (ctx) => sqlite.find(ctx, Order, { $select: { id: true } }));
    expect(sql).toBe('SELECT `id` FROM `Order`');
  });

  it('is ignored by MongoDB, whose collections take no dot', () => {
    const mongo = new MongodbNativeDialect({ schema: 'tenant_a' });
    expect(mongo.resolveTableName(getMeta(Plain))).toBe('Plain');
  });

  // The generator extends `AbstractDialect` directly rather than `MongoDialect`, so before the
  // engine flag it kept qualifying collections after the query side had stopped.
  it('is ignored by the MongoDB schema generator too, not just its query dialect', () => {
    expect(new MongoSchemaGenerator().resolveTableName(getMeta(Customer))).toBe('Customer');
  });

  it('creates each schema once, before the tables that go in it', () => {
    const statements = new SqlSchemaGenerator(dialect).generateCreateSchema([Customer, Order, Plain]);
    expect(statements.filter((sql) => sql.startsWith('CREATE SCHEMA'))).toEqual([
      'CREATE SCHEMA IF NOT EXISTS "crm"',
      'CREATE SCHEMA IF NOT EXISTS "sales"',
    ]);
    expect(statements.findLastIndex((sql) => sql.startsWith('CREATE SCHEMA'))).toBeLessThan(
      statements.findIndex((sql) => sql.startsWith('CREATE TABLE')),
    );
  });

  it('creates no schema when no entity names one', () => {
    const statements = new SqlSchemaGenerator(dialect).generateCreateSchema([Plain]);
    expect(statements.some((sql) => sql.startsWith('CREATE SCHEMA'))).toBe(false);
  });

  // A name derived from a qualified table used to carry the dot into it, and `escapeId` split that
  // into two identifiers: `CREATE INDEX "idx_crm"."Customer_name"`, which Postgres rejects outright.
  // An index or constraint name is one identifier, and needs no schema - it lives in the table's.
  it('derives an index name from the table alone, against the qualified table', () => {
    const [sql] = ddlOf([Customer], 'CREATE INDEX');
    expect(sql).toBe('CREATE INDEX "idx_Customer_name" ON "crm"."Customer" ("name");');
  });

  it('derives a foreign key name from the table alone, across two schemas', () => {
    const [sql] = ddlOf([Customer, Order], 'ALTER TABLE');
    expect(sql).toContain('ALTER TABLE "sales"."Order" ADD CONSTRAINT "fk_Order_customerId" ');
    expect(sql).toContain('REFERENCES "crm"."Customer" ("id")');
  });

  it('declares only the schemas of the tables it was narrowed to', () => {
    const generator = new SqlSchemaGenerator(dialect);
    const statements = generator.generateCreateSchema([Customer, Order, Plain], { only: ['crm.Customer'] });
    expect(statements.filter((sql) => sql.startsWith('CREATE SCHEMA'))).toEqual(['CREATE SCHEMA IF NOT EXISTS "crm"']);
  });

  // An engine with no schemas resolves every entity unqualified, so its DDL never grows a dot that
  // names nothing - the `CREATE TABLE` half of the query-side case above.
  it('emits unqualified DDL on an engine that has no schemas', () => {
    const statements = new SqlSchemaGenerator(new SqliteDialect()).generateCreateSchema([Customer]);
    expect(statements.some((sql) => sql.includes('crm'))).toBe(false);
    expect(statements).toContain('CREATE INDEX `idx_Customer_name` ON `Customer` (`name`);');
  });

  // Two tables of one name in different schemas are two tables. Keying the AST by the bare name
  // collapsed them onto one node, which is the same conflation the query side had.
  it('keys same-named tables in different schemas apart', () => {
    const ast = new SchemaAST();
    ast.addTable(mockTableNode('Thing', [], 'crm'));
    ast.addTable(mockTableNode('Thing', [], 'sales'));
    expect(ast.getTables()).toHaveLength(2);
    expect(ast.getTable('crm.Thing')?.schema).toBe('crm');
    expect(ast.getTable('sales.Thing')?.schema).toBe('sales');
  });

  it('leaves an unqualified table keyed by its bare name', () => {
    const ast = new SchemaAST();
    ast.addTable(mockTableNode('Thing', []));
    expect(ast.getTable('Thing')?.schema).toBe(undefined);
  });

  // `clone` rebuilt each node from the map key, which is the qualified name, so a cloned table came
  // back named `crm.Thing` with no schema of its own.
  it('keeps a table addressable after the AST is cloned', () => {
    const ast = new SchemaAST();
    ast.addTable(mockTableNode('Thing', [{ name: 'id', isPrimaryKey: true }], 'crm'));
    const clone = ast.clone();
    expect(clone.getTable('crm.Thing')?.name).toBe('Thing');
    expect(clone.getTable('crm.Thing')?.schema).toBe('crm');
  });

  // The entity's indexes are looked up in an AST keyed by the qualified name. Keyed by the bare one,
  // a table in a schema reported no desired indexes at all, so every one of them looked unwanted.
  it('finds the indexes an entity declares for a table that lives in a schema', () => {
    const current = mockTableNode('Customer', [{ name: 'id', isPrimaryKey: true }, { name: 'name' }], 'crm');
    const diff = new SqlSchemaGenerator(dialect).diffSchema(Customer, current);
    expect(diff?.indexesToAdd?.map((index) => index.name)).toEqual(['idx_Customer_name']);
  });

  // A Postgres index lives in its table's schema and is dropped as `schema.index`. Bare, it resolved
  // through `search_path`, so it either found nothing or dropped a same-named index in `public`.
  it('drops an index inside the schema of the table it is on', () => {
    const sql = new SqlSchemaGenerator(dialect).generateDropIndex('crm.Customer', 'idx_Customer_name', 'crm');
    expect(sql).toBe('DROP INDEX IF EXISTS "crm"."idx_Customer_name";');
  });

  it('leaves an index unqualified when its table is', () => {
    const sql = new SqlSchemaGenerator(dialect).generateDropIndex('Plain', 'idx_Plain_total');
    expect(sql).toBe('DROP INDEX IF EXISTS "idx_Plain_total";');
  });

  it('rejects a dotted name, naming the option that replaces it', () => {
    class Dotted {
      id?: number;
    }
    expect(() => defineEntity(Dotted, { name: 'sales.Dotted', fields: { id: { isId: true, type: Number } } })).toThrow(
      /schema: 'sales'/,
    );
  });
});
