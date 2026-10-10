import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import { CrdbQuerierPool } from '../../cockroachdb/crdbQuerierPool.js';
import { Entity, Field, Id, Index } from '../../entity/index.js';
import { LibsqlQuerierPool } from '../../libsql/libsqlQuerierPool.js';
import { MariadbQuerierPool } from '../../mariadb/mariadbQuerierPool.js';
import { PgQuerierPool } from '../../postgres/pgQuerierPool.js';
import { buildSchemaAST } from '../../schema/schemaASTBuilder.js';
import { driftOf } from '../../test/drift.js';
import { cockroachConnection, mariadbConnection, postgresConnection, provisioningTimeout } from '../../test/index.js';
import { dropTables } from '../../test/sqlPools.js';
import type { SqlQuerierPool, Type, VectorDistance, VectorIndexType } from '../../type/index.js';
import { sql } from '../../util/sql.js';
import { Migrator } from '../migrator.js';
import { detectDrift } from './driftDetector.js';

const TABLE = 'drift_vector_index';

const DATABASE = 'test_vector';

/** The table with its vector index built for `distance`, declared as the engine's own `type`, and tuned. */
function vectorTable(type: VectorIndexType, distance: VectorDistance) {
  @Index((row) => [row.vec], { type, distance, m: 8, efConstruction: 32, name: 'ix_drift_vec' })
  @Entity({ name: TABLE })
  class VectorRow {
    @Id({ type: Number }) id?: number;
    @Field({ type: 'vector', dimensions: 2 }) vec?: number[] | null;
  }
  return VectorRow;
}

/** The table before its index is declared: NOT NULL, as MariaDB indexes no other column and an index alters none. */
@Entity({ name: TABLE })
class Unindexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', dimensions: 2, nullable: false }) vec?: number[];
}

const at = (degrees: number) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];

/** libSQL in files: a transaction there opens a connection of its own, which `:memory:` makes another database. */
const libsqlDir = mkdtempSync(join(tmpdir(), 'uql-vector-index-'));
const libsqlPool = (name: string) => new LibsqlQuerierPool({ url: `file:${join(libsqlDir, name)}.db` });
afterAll(() => rmSync(libsqlDir, { recursive: true, force: true }));

const engines: [string, VectorIndexType, () => SqlQuerierPool][] = [
  ['PostgreSQL', 'hnsw', () => new PgQuerierPool(postgresConnection(DATABASE))],
  ['CockroachDB', 'vector', () => new CrdbQuerierPool(cockroachConnection(DATABASE))],
  ['MariaDB', 'vector', () => new MariadbQuerierPool(mariadbConnection(DATABASE))],
  ['libSQL', 'vector', () => libsqlPool('engine')],
];

/**
 * Each engine spells a vector index its own way, operator class and tuning included, which only the server can
 * say is right, and keeps its distance its own way, which it reads back as the entity's `distance`. The entity's
 * column is nullable, which MariaDB's generator makes NOT NULL for the index.
 */
describe.each(engines)('vector index (%s)', { timeout: provisioningTimeout }, (_engine, type, connect) => {
  const pool = connect();
  const cosine = vectorTable(type, 'cosine');
  const migrator = (entity: Type<object>) => new Migrator(pool, { entities: [entity] });

  afterAll(async () => {
    await dropTables(pool, TABLE);
    await pool.end();
  }, provisioningTimeout);

  it('should create the index with its table, and plan nothing more', async () => {
    await migrator(cosine).sync({ force: true });

    expect(await driftOf(pool, cosine, TABLE)).toEqual([]);
    expect(await migrator(cosine).planSync({ safe: false })).toEqual([]);
  });

  /** Outside safe mode, since the entity's column is nullable where the engine does not need it NOT NULL. */
  it('should add the index to a table that already exists', async () => {
    await migrator(Unindexed).sync({ force: true });
    await migrator(cosine).sync({ safe: false });

    expect(await driftOf(pool, cosine, TABLE)).toEqual([]);
  });

  /** No engine alters an index, so one built for another distance is rebuilt, which safe mode holds back. */
  it('should report an index built for another distance, and rebuild it only outside safe mode', async () => {
    await migrator(vectorTable(type, 'l2')).sync({ force: true });

    expect(await driftOf(pool, cosine, TABLE)).toEqual([{ type: 'index_mismatch', index: 'ix_drift_vec' }]);
    expect(await migrator(cosine).planSync()).toEqual([]);

    await migrator(cosine).sync({ safe: false });

    expect(await driftOf(pool, cosine, TABLE)).toEqual([]);
  });

  /** Searched at 90.4 degrees, so 91 is nearer than 89, which was inserted first. */
  it('should rank the nearest rows through the index, tuned, and keep a filter beside it', async () => {
    await migrator(cosine).sync({ force: true });
    await pool.insertMany(
      cosine,
      Array.from({ length: 360 }, (_, n) => ({ id: n + 1, vec: at(n + 1) })),
    );

    const found = await pool.transaction((querier) =>
      querier.findMany(cosine, {
        $select: { id: true },
        $where: { id: { $ne: 90 } },
        $sort: { vec: { $vector: at(90.4) } },
        $limit: 2,
        $candidates: 10,
      }),
    );

    expect(found).toEqual([{ id: 91 }, { id: 89 }]);
  });
});

/** libSQL keeps a DiskANN index in tables of its own. */
describe('libSQL vector index drift', () => {
  const cosine = vectorTable('vector', 'cosine');

  it('should report no drift over the whole database, nor the tables libSQL keeps the index in', async () => {
    const pool = libsqlPool('whole');
    onTestFinished(() => pool.end());
    const migrator = new Migrator(pool, { entities: [cosine] });
    await migrator.sync();

    const { drifts } = detectDrift(buildSchemaAST([cosine]), await migrator.schemaIntrospector.introspect(), {
      dialect: pool.dialect,
    });

    expect(drifts).toEqual([]);
  });

  /** The column first: libSQL indexes only a vector column, so a `TEXT` one is rebuilt before the index can be. */
  it('should report a vector index declared over a plain one', async () => {
    const pool = libsqlPool('plain');
    onTestFinished(() => pool.end());
    await pool.run(sql.text(`CREATE TABLE ${TABLE} (id INTEGER PRIMARY KEY, vec TEXT)`));
    await pool.run(sql.text(`CREATE INDEX ix_drift_vec ON ${TABLE} (vec)`));

    expect(await driftOf(pool, cosine, TABLE)).toEqual([
      { type: 'type_mismatch', column: 'vec', expected: 'F32_BLOB(2)', actual: 'TEXT' },
      { type: 'index_mismatch', index: 'ix_drift_vec' },
    ]);
  });
});
