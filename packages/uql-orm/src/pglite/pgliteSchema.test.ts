// Schema support against a real Postgres, because the failure it fixes was a runtime one: the SQL
// was well-formed and the server rejected it with 42P01, which no unit test on generated text sees.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEntity } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import { PgliteDialect } from './pgliteDialect.js';
import type { PgliteQuerier } from './pgliteQuerier.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

class Customer {
  id?: number;
  name?: string;
}

class Order {
  id?: number;
  total?: number;
  customerId?: number;
  customer?: Customer;
}

/** No schema of its own: it follows whichever pool reads it. */
class Ledger {
  id?: number;
  total?: number;
  label?: string;
}

defineEntity(Customer, {
  schema: 'crm',
  fields: { id: { isId: true, type: Number }, name: { type: String } },
});
defineEntity(Order, {
  schema: 'sales',
  fields: {
    id: { isId: true, type: Number },
    total: { type: Number },
    customerId: { type: Number, references: () => Customer },
  },
  relations: {
    customer: { entity: () => Customer, cardinality: 'm1', references: [{ local: 'customerId', foreign: 'id' }] },
  },
});
defineEntity(Ledger, {
  fields: { id: { isId: true, type: Number }, total: { type: Number }, label: { type: String, index: true } },
});

/** The same `crm.Customer` table, plus a column, so the diff has something to find. */
class Drifted {
  id?: number;
  name?: string;
  age?: number;
}
defineEntity(Drifted, {
  schema: 'crm',
  name: 'Customer',
  fields: { id: { isId: true, type: Number }, name: { type: String }, age: { type: Number } },
});

const TENANTS = [
  ['tenant_a', 10],
  ['tenant_b', 20],
] as const;

describe('schema against postgres', () => {
  let pool: PgliteQuerierPool;
  let querier: PgliteQuerier;

  beforeAll(async () => {
    pool = new PgliteQuerierPool('memory://');
    querier = await pool.getQuerier();
    // The generated DDL, not a hand-written equivalent: the schema statements, the qualified
    // `CREATE TABLE`s and the derived index and constraint names are exactly what this feature
    // emits, and a name that escapes into two identifiers only fails against a real server.
    for (const sql of new SqlSchemaGenerator(pool.dialect).generateCreateSchema([Customer, Order])) {
      await querier.run(sql);
    }
    await querier.insertOne(Customer, { name: 'acme' });
    await querier.insertOne(Order, { total: 42, customerId: 1 });
  });

  afterAll(async () => {
    await querier.release();
    await pool.end();
  });

  it('joins two schemas in one statement', async () => {
    await expect(
      querier.findMany(Order, {
        $select: { id: true, total: true },
        $populate: { customer: { $select: { name: true } } },
      }),
    ).resolves.toEqual([{ id: 1, total: 42, customer: { id: 1, name: 'acme' } }]);
  });

  it('filters a parent by a relation living in another schema', async () => {
    await expect(
      querier.findMany(Order, { $select: { id: true }, $where: { customer: { name: 'acme' } } }),
    ).resolves.toEqual([{ id: 1 }]);
  });

  it('counts, updates and aggregates a qualified table', async () => {
    await expect(querier.count(Order, { $where: { total: { $gte: 1 } } })).resolves.toBe(1);
    await expect(querier.updateMany(Order, { $where: { id: 1 } }, { total: 43 })).resolves.toBe(1);
    await expect(querier.aggregate(Order, { $agg: { total: { $sum: 'total' } } })).resolves.toEqual([{ total: 43 }]);
  });

  // The point of the pool-level default: one entity class, no annotation, and each pool sees only
  // its own tenant. Each PGlite pool is its own in-memory database, so both schemas are created in
  // each one and only the pool's default decides which is read.
  it.each(TENANTS)('reads %s from the unannotated entity', async (schema, expected) => {
    const scoped = new PgliteQuerierPool('memory://', undefined, { schema });
    const tenant = await scoped.getQuerier();
    for (const [other, total] of TENANTS) {
      // Each tenant's DDL comes from a generator scoped to that schema, the same way its pool is.
      const scopedDialect = new PgliteDialect({ schema: other });
      for (const sql of new SqlSchemaGenerator(scopedDialect).generateCreateSchema([Ledger])) {
        await tenant.run(sql);
      }
      await tenant.run(`INSERT INTO ${other}."Ledger" (total) VALUES (${total})`);
    }

    await expect(tenant.findMany(Ledger, { $select: { total: true } })).resolves.toEqual([{ total: expected }]);

    await tenant.release();
    await scoped.end();
  });

  // Introspection only ever read `table_schema = 'public'`, so a qualified entity matched nothing and
  // diffed as `create` forever: `drift:check` called an existing table missing, and `autoSync` reran
  // `CREATE TABLE` instead of altering it. A column added to the entity is the case that exposes it.
  describe('drift against a qualified table', () => {
    let driftPool: PgliteQuerierPool;

    beforeAll(async () => {
      driftPool = new PgliteQuerierPool('memory://');
      const querier = await driftPool.getQuerier();
      for (const sql of new SqlSchemaGenerator(driftPool.dialect).generateCreateSchema([Customer])) {
        await querier.run(sql);
      }
      await querier.release();
    });

    afterAll(async () => {
      await driftPool.end();
    });

    it('reports no drift for a table it just created', async () => {
      await expect(new Migrator(driftPool, { entities: [Customer] }).getDiffs()).resolves.toEqual([]);
    });

    it('alters a qualified table rather than creating it again', async () => {
      const [diff] = await new Migrator(driftPool, { entities: [Drifted] }).getDiffs();
      expect(diff?.type).toBe('alter');
      expect(diff?.tableName).toBe('crm.Customer');
      expect(diff?.columnsToAdd?.map((column) => column.name)).toEqual(['age']);
    });

    it('emits the ALTER against the qualified table', async () => {
      const sql = await new Migrator(driftPool, { entities: [Drifted] }).planSync();
      expect(sql).toEqual(['ALTER TABLE "crm"."Customer" ADD COLUMN "age" BIGINT;']);
    });
  });
});
