import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, describe, expect, it } from 'vitest';
import { CrdbQuerierPool } from '../../cockroachdb/crdbQuerierPool.js';
import { Entity, Field, Id, Index } from '../../entity/index.js';
import { LibsqlQuerierPool } from '../../libsql/libsqlQuerierPool.js';
import { MariadbQuerierPool } from '../../maria/mariadbQuerierPool.js';
import { PgQuerierPool } from '../../postgres/pgQuerierPool.js';
import { driftOf } from '../../test/drift.js';
import { cockroachConnection, mariadbConnection, postgresConnection, provisioningTimeout } from '../../test/index.js';
import type { SyncOptions, Type, VectorDistance } from '../../type/index.js';
import { Migrator } from '../migrator.js';

const TABLE = 'drift_vector_index';

/** The table with its vector index built for `distance`, declared as the engine's own `type`. */
function vectorTable(type: 'hnsw' | 'vector', distance: VectorDistance): Type<object> {
  @Index((row) => [row.vec], { type, distance, name: 'ix_drift_vec' })
  @Entity({ name: TABLE })
  class VectorRow {
    @Id({ type: Number }) id?: number;
    @Field({ type: 'vector', dimensions: 3 }) vec?: number[] | null;
  }
  return VectorRow;
}

type MigratorPool = ConstructorParameters<typeof Migrator>[0];

const libsqlFile = join(tmpdir(), `uql-libsql-drift-vector-${uuidv7()}.db`);

const engines: [string, 'hnsw' | 'vector', () => MigratorPool][] = [
  ['PostgreSQL', 'hnsw', () => new PgQuerierPool(postgresConnection('test_pg'))],
  ['CockroachDB', 'vector', () => new CrdbQuerierPool(cockroachConnection())],
  ['MariaDB', 'vector', () => new MariadbQuerierPool(mariadbConnection())],
  ['libSQL', 'vector', () => new LibsqlQuerierPool({ url: `file:${libsqlFile}` })],
];

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${libsqlFile}${suffix}`, { force: true });
  }
});

/** Each engine keeps a vector index's distance its own way, and reads it back as the entity's `distance`. */
describe.each(engines)('vector index drift (%s)', (_engine, type, poolOf) => {
  const pool = poolOf();
  afterAll(() => pool.end());

  const cosine = vectorTable(type, 'cosine');
  const syncOf = (entity: Type<object>, options: SyncOptions) =>
    new Migrator(pool, { entities: [entity] }).sync({ logging: false, ...options });
  const planOf = (entity: Type<object>, options: SyncOptions) =>
    new Migrator(pool, { entities: [entity] }).planSync(options);

  it(
    'should report no drift, and plan nothing, for the index it built',
    async () => {
      await syncOf(cosine, { force: true });

      expect(await driftOf(pool, cosine, TABLE)).toEqual([]);
      expect(await planOf(cosine, { safe: false })).toEqual([]);
    },
    provisioningTimeout,
  );

  /** No engine alters an index, so one built for another distance is rebuilt, which safe mode holds back. */
  it(
    'should report an index built for another distance, and rebuild it only outside safe mode',
    async () => {
      await syncOf(vectorTable(type, 'l2'), { force: true });

      expect(await driftOf(pool, cosine, TABLE)).toEqual([{ type: 'index_mismatch', index: 'ix_drift_vec' }]);
      expect(await planOf(cosine, {})).toEqual([]);

      await syncOf(cosine, { safe: false });

      expect(await driftOf(pool, cosine, TABLE)).toEqual([]);
    },
    provisioningTimeout,
  );
});
