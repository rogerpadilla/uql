// Schema-qualified tables: what the SQL looks like, and which of the two `schema` scopes wins.
//
// The join cases are the point. A qualified name is two identifiers, a column prefix has to be one,
// and conflating them is what made `@Entity({ name: 'sales.Order' })` emit `"sales.Order"."id"`
// against a table nothing had declared under that name.

import { describe, expect, it } from 'vitest';
import { defineEntity, Entity, Field, getMeta, Id, ManyToOne } from '../entity/index.js';
import { MongoSchemaGenerator } from '../migrate/generator/mongoSchemaGenerator.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import { MongodbNativeDialect } from '../mongo/mongodbNativeDialect.js';
import { PgDialect } from '../postgres/pgDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { QueryContext } from '../type/index.js';
import type { AbstractSqlDialect } from './abstractSqlDialect.js';

@Entity({ schema: 'crm' })
class Customer {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
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

  it('rejects a dotted name, naming the option that replaces it', () => {
    class Dotted {
      id?: number;
    }
    expect(() => defineEntity(Dotted, { name: 'sales.Dotted', fields: { id: { isId: true, type: Number } } })).toThrow(
      /schema: 'sales'/,
    );
  });
});
