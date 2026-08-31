// Schema support against a real Postgres, because the failure it fixes was a runtime one: the SQL
// was well-formed and the server rejected it with 42P01, which no unit test on generated text sees.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEntity } from '../entity/index.js';
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
defineEntity(Ledger, { fields: { id: { isId: true, type: Number }, total: { type: Number } } });

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
    for (const schema of ['crm', 'sales']) {
      await querier.run(`CREATE SCHEMA ${schema}`);
    }
    await querier.run('CREATE TABLE crm."Customer" (id serial primary key, name text)');
    await querier.run('CREATE TABLE sales."Order" (id serial primary key, total int, "customerId" int)');
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
      await tenant.run(`CREATE SCHEMA ${other}`);
      await tenant.run(`CREATE TABLE ${other}."Ledger" (id serial primary key, total int)`);
      await tenant.run(`INSERT INTO ${other}."Ledger" (total) VALUES (${total})`);
    }

    await expect(tenant.findMany(Ledger, { $select: { total: true } })).resolves.toEqual([{ total: expected }]);

    await tenant.release();
    await scoped.end();
  });
});
