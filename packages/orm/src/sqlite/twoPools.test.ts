import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEntity, f } from '../entity/index.js';
import { getEntities } from '../entity/metadata/definition.js';
import { Migrator } from '../migrate/migrator.js';
import { NodeSqliteQuerierPool } from './nodeSqliteQuerierPool.js';

const Invoice = defineEntity({
  name: 'Invoice',
  fields: { id: f.number().id(), amount: f.number() },
});
const Ticket = defineEntity({
  name: 'Ticket',
  fields: { id: f.number().id(), title: f.string() },
});

describe('two pools with disjoint entities in one process', () => {
  const billing = new NodeSqliteQuerierPool(':memory:');
  const support = new NodeSqliteQuerierPool(':memory:');

  beforeAll(async () => {
    await new Migrator(billing, { entities: [Invoice] }).sync({ safe: false });
    await new Migrator(support, { entities: [Ticket] }).sync({ safe: false });
  });

  afterAll(async () => {
    await Promise.all([billing.end(), support.end()]);
  });

  it('should write and read each pool its own entities', async () => {
    await billing.insertOne(Invoice, { amount: 40 });
    await support.insertOne(Ticket, { title: 'printer on fire' });

    const invoices = await billing.findMany(Invoice, { $select: { amount: true } });
    const tickets = await support.findMany(Ticket, { $select: { title: true } });

    expect(invoices).toEqual([{ amount: 40 }]);
    expect(tickets).toEqual([{ title: 'printer on fire' }]);
  });

  it('should keep each database to the tables its own entities declare', async () => {
    const billingTables = await billing.all<{
      name: string;
    }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`;
    const supportTables = await support.all<{
      name: string;
    }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`;

    expect(billingTables.map((row) => row.name)).toEqual(['Invoice']);
    expect(supportTables.map((row) => row.name)).toEqual(['Ticket']);
  });

  it('should register both entities process-wide, so a migrator without a list discovers both', () => {
    expect(getEntities()).toEqual(expect.arrayContaining([Invoice, Ticket]));
  });
});
