import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, f, Field } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { mongoUri, provisioningTimeout } from '../test/index.js';
import type { Json } from '../type/index.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

const COLLECTION = 'json_path_index';

@Entity({
  name: COLLECTION,
  indexes: (profiled, index) => [
    index([{ column: profiled.profile.tags, type: [String] }], 'ix_profile_tags'),
    index([profiled.profile.theme], 'ix_profile_theme'),
  ],
})
class Profiled {
  @Field(f.string().id()) id?: string;
  @Field(f.json().nullable()) profile?: Json<{ theme: string; tags: string[] }> | null;
}

/** A path inside a document is a key like any other, which the same `$where` a SQL engine compiles reads. */
describe('MongoDB JSON path index', () => {
  const pool = new MongodbQuerierPool(mongoUri('uql_json_path_index'));
  const migrator = () => new Migrator(pool, { entities: [Profiled] });

  beforeAll(async () => {
    await pool.withQuerier((querier) => querier.db.dropDatabase());
    await migrator().sync({ logging: false });
    await pool.insertMany(
      Profiled,
      Array.from({ length: 100 }, (_, n) => ({ profile: { theme: `t${n}`, tags: [`a${n}`, `b${n}`] } })),
    );
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.db.dropDatabase());
    await pool.end();
  });

  it('should plan nothing more once the indexes exist', async () => {
    expect(await migrator().planSync({ safe: false })).toEqual([]);
  });

  it('should answer a path and an array element from their indexes', async () => {
    const plan = (filter: object) =>
      pool.withQuerier(async (querier) =>
        JSON.stringify((await querier.db.collection(COLLECTION).find(filter).explain())['queryPlanner']),
      );

    expect(await plan({ 'profile.theme': 't7' })).toContain('ix_profile_theme');
    expect(await plan({ 'profile.tags': 'a7' })).toContain('ix_profile_tags');
    expect(await pool.count(Profiled, { $where: { 'profile.theme': 't7' } })).toBe(1);
  });
});
