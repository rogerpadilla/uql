// A trigger on a table in a schema of its own: its catalogue read, its function and its drop all have to
// name that schema, or a second sync never sees what the first installed and tries to create it again.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, getMeta, Id, removeEntity, Trigger } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { assertDefined } from '../test/index.js';
import { raw } from '../util/raw.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

@Trigger({ on: 'beforeInsert', name: 'slug', run: (newRow) => raw`${newRow.slug} := lower(${newRow.title});` })
@Entity({ name: 'SchemaPost', schema: 'sales' })
class SchemaPost {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) slug?: string | null;
}

describe('a trigger on a table in its own schema', () => {
  let pool: PgliteQuerierPool;
  const migrator = () => new Migrator(pool, { entities: [SchemaPost] });
  const functions = (schema: string) =>
    pool.all(
      `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${schema}' AND p.proname LIKE '\\_uql\\_%'`,
    );

  beforeAll(async () => {
    pool = new PgliteQuerierPool('memory://');
    await pool.run('CREATE SCHEMA sales');
    await migrator().sync({ logging: false });
  });

  afterAll(async () => {
    await pool.end();
    removeEntity(SchemaPost);
  });

  it('should leave nothing for a second sync to run', async () => {
    expect(await migrator().planSync()).toEqual([]);
  });

  it('should keep its function in the schema of its table', async () => {
    expect(await functions('sales')).toHaveLength(1);
    expect(await functions('public')).toHaveLength(0);
  });

  it('should drop it, function and all, once the entity stops declaring it', async () => {
    const meta = getMeta(SchemaPost);
    const declared = meta.triggers;
    assertDefined(declared);
    meta.triggers = [];
    await migrator().sync({ logging: false });
    expect(await functions('sales')).toHaveLength(0);
    meta.triggers = declared;
  });
});
