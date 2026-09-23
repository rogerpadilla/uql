import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { detectDrift } from '../migrate/drift/index.js';
import { SqliteSchemaIntrospector } from '../migrate/introspection/sqliteIntrospector.js';
import { Migrator } from '../migrate/migrator.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { LibsqlQuerierPool } from './libsqlQuerierPool.js';

const TABLE = 'libsql_vector_index';

/** Enough rows spread around the circle that the index, not a coincidence, picks the nearest. */
const ROWS = 360;

@Index((indexed) => [indexed.vec], { type: 'hnsw', distance: 'cosine' })
@Entity({ name: TABLE })
class Indexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) degrees?: number | null;
  @Field({ type: 'vector', dimensions: 2 }) vec!: number[] | null;
}

const at = (degrees: number) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];

/** A libSQL database in a file of its own, and the removal of every file libSQL writes beside it. */
function fileDatabase(name: string) {
  const file = join(tmpdir(), `uql-libsql-${name}-${uuidv7()}.db`);
  const pool = new LibsqlQuerierPool({ url: `file:${file}` });
  const remove = async () => {
    await pool.end();
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${file}${suffix}`, { force: true });
    }
  };
  return { pool, remove };
}

/** What `drift:check` reports for `Indexed` against the database. */
async function driftOf(pool: LibsqlQuerierPool) {
  const introspector = new SqliteSchemaIntrospector(pool);
  const report = detectDrift(buildSchemaAST([Indexed]), await introspector.introspect(), {
    dialect: pool.dialect,
  });
  return report.drifts.map(({ type, column, index }) => ({ type, column, index }));
}

/** libSQL's DiskANN index as the migrator builds it, read back by introspection, and read by a ranked query. */
describe('libSQL vector index', () => {
  const { pool, remove } = fileDatabase('vector');
  const migrator = () => new Migrator(pool, { entities: [Indexed] });

  beforeAll(async () => {
    await migrator().sync({ logging: false });
    await pool.withQuerier((querier) =>
      querier.insertMany(
        Indexed,
        Array.from({ length: ROWS }, (_, degrees) => ({ degrees, vec: at(degrees) })),
      ),
    );
  });

  afterAll(remove);

  it('should plan nothing more once the index exists', async () => {
    expect(await migrator().planSync()).toEqual([]);
  });

  it('should report no drift, nor the tables libSQL keeps the index in', async () => {
    expect(await driftOf(pool)).toEqual([]);
  });

  it('should rank the nearest rows through the index', async () => {
    const found = await pool.withQuerier((querier) =>
      querier.findMany(Indexed, { $select: { degrees: true }, $sort: { vec: { $vector: at(90) } }, $limit: 3 }),
    );

    const degrees = found.map((row) => row.degrees);

    // 89 and 91 are as near as each other, so only the first place is fixed.
    expect(degrees[0]).toBe(90);
    expect(degrees.sort()).toEqual([89, 90, 91]);
  });

  it('should keep the filter beside the index', async () => {
    const found = await pool.withQuerier((querier) =>
      querier.findMany(Indexed, {
        $select: { degrees: true },
        $where: { degrees: { $ne: 90 } },
        $sort: { vec: { $vector: at(90) } },
        $limit: 2,
        $candidates: 10,
      }),
    );

    expect(found.map(({ degrees }) => degrees).sort()).toEqual([89, 91]);
  });
});

/** A table from before libSQL's index was built: the declared vector index is a plain one there, which drift names. */
describe('libSQL vector index declared over a plain one', () => {
  const { pool, remove } = fileDatabase('plain');

  afterAll(remove);

  it('should report the index as differing', async () => {
    await pool.withQuerier(async (querier) => {
      await querier.run(`CREATE TABLE \`${TABLE}\` (\`id\` INTEGER PRIMARY KEY, \`degrees\` INTEGER, \`vec\` TEXT)`);
      await querier.run(`CREATE INDEX \`${TABLE}__vec_idx\` ON \`${TABLE}\` (\`vec\`)`);
    });

    // The column first: libSQL builds a vector index only over a vector column, so a `TEXT` one is rebuilt
    // as `F32_BLOB` before the index can be.
    expect(await driftOf(pool)).toEqual([
      { type: 'type_mismatch', column: 'vec', index: undefined },
      { type: 'index_mismatch', column: undefined, index: `${TABLE}__vec_idx` },
    ]);
  });
});
