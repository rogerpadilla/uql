import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { D1SqliteDialect } from '../d1/d1SqliteDialect.js';
import { Entity, Field, getMeta, Id, Index } from '../entity/index.js';
import { LibsqlDialect } from '../libsql/libsqlDialect.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { VectorItem } from '../test/index.js';
import { TursoDialect } from '../turso/tursoDialect.js';
import type { VectorDistance } from '../type/index.js';
import type { AbstractSqlDialect } from './abstractSqlDialect.js';
import { parseVectorLiteral, toSparsevecLiteral } from './vectorCast.js';

/** A per-field default metric, which a query without `$distance` inherits. */
@Entity({ name: 'L2Item' })
class L2Item {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', distance: 'l2' }) vec!: number[];
}

/**
 * Every dialect's vector search, side by side: which metrics it has and the expression it compiles
 * them to. Each engine supplies only that expression, since the query shapes around it - default
 * metric, combined sort, field default, projection, rejection - are identical everywhere.
 *
 * Every mapping here was verified against a live engine (pgvector 0.8, CockroachDB 26, MariaDB 12.3,
 * sqlite-vec 0.1.9, `@libsql/client` 0.17, `@tursodatabase/database` 0.7, MySQL 26.7), because a wrong
 * function name or a missing conversion only surfaces at runtime.
 */
type Engine = {
  name: string;
  dialect: AbstractSqlDialect;
  distance: (metric: VectorDistance, placeholder: string) => string;
  supported: VectorDistance[];
  unsupported: VectorDistance[];
};

const PG_OPS: Partial<Record<VectorDistance, string>> = { cosine: '<=>', l2: '<->', inner: '<#>', l1: '<+>' };
const SQLITE_VEC_FNS: Partial<Record<VectorDistance, string>> = {
  cosine: 'vec_distance_cosine',
  l2: 'vec_distance_L2',
  l1: 'vec_distance_L1',
};
const LIBSQL_FNS: Partial<Record<VectorDistance, string>> = {
  cosine: 'vector_distance_cos',
  l2: 'vector_distance_l2',
  inner: 'vector_distance_dot',
};

const engines: Engine[] = [
  {
    name: 'PostgresDialect',
    dialect: new PostgresDialect(),
    distance: (metric, ph) => `"vec" ${PG_OPS[metric]} ${ph}::vector`,
    supported: ['cosine', 'l2', 'inner', 'l1'],
    unsupported: [],
  },
  {
    name: 'CockroachDialect',
    dialect: new CockroachDialect(),
    distance: (metric, ph) => `"vec" ${PG_OPS[metric]} ${ph}::vector`,
    supported: ['cosine', 'l2', 'inner'],
    // Not implemented upstream: `<+>`/`vector_l1_ops` throw "operator class is not supported".
    unsupported: ['l1'],
  },
  {
    name: 'MariaDialect',
    dialect: new MariaDialect({}),
    // A `VECTOR` column takes a packed float32 blob, so the query vector needs the text conversion.
    distance: (metric, ph) =>
      `${metric === 'cosine' ? 'VEC_DISTANCE_COSINE' : 'VEC_DISTANCE_EUCLIDEAN'}(\`vec\`, VEC_FromText(${ph}))`,
    supported: ['cosine', 'l2'],
    unsupported: ['inner', 'l1'],
  },
  {
    name: 'SqliteDialect (sqlite-vec)',
    dialect: new SqliteDialect(),
    distance: (metric, ph) => `${SQLITE_VEC_FNS[metric]}(\`vec\`, ${ph})`,
    supported: ['cosine', 'l2', 'l1'],
    unsupported: ['inner'],
  },
  {
    name: 'LibsqlDialect',
    dialect: new LibsqlDialect(),
    distance: (metric, ph) => `${LIBSQL_FNS[metric]}(\`vec\`, ${ph})`,
    supported: ['cosine', 'l2'],
    unsupported: ['inner', 'l1'],
  },
  {
    name: 'TursoDialect',
    dialect: new TursoDialect(),
    distance: (metric, ph) => `${LIBSQL_FNS[metric]}(\`vec\`, ${ph})`,
    // The Rust engine adds a dot-product distance libSQL never had.
    supported: ['cosine', 'l2', 'inner'],
    unsupported: ['l1'],
  },
];

describe.each(engines)('$name vector search', ({ dialect, distance, supported, unsupported }) => {
  const q = (id: string) => dialect.escapeId(id);
  const ph = (index: number) => dialect.placeholder(index);
  const find = <E>(entity: typeof VectorItem | typeof L2Item, query: object) => {
    const ctx = dialect.createContext();
    dialect.find(ctx, entity, query);
    return { sql: ctx.sql, values: ctx.values };
  };

  it.each(supported)('should sort by %s', (metric) => {
    const { sql, values } = find(VectorItem, {
      $select: { id: true },
      $sort: { vec: { $vector: [1, 2, 3], $distance: metric } },
      $limit: 10,
    });

    expect(sql).toBe(`SELECT ${q('id')} FROM ${q('VectorItem')} ORDER BY ${distance(metric, ph(1))} LIMIT 10`);
    expect(values).toEqual(['[1,2,3]']);
  });

  it('should default to cosine', () => {
    const { sql } = find(VectorItem, { $select: { id: true }, $sort: { vec: { $vector: [1, 2, 3] } }, $limit: 10 });

    expect(sql).toBe(`SELECT ${q('id')} FROM ${q('VectorItem')} ORDER BY ${distance('cosine', ph(1))} LIMIT 10`);
  });

  it("should take the field's own default metric", () => {
    const { sql } = find(L2Item, { $select: { id: true }, $sort: { vec: { $vector: [1, 2, 3] } }, $limit: 10 });

    expect(sql).toBe(`SELECT ${q('id')} FROM ${q('L2Item')} ORDER BY ${distance('l2', ph(1))} LIMIT 10`);
  });

  it('should compose with a filter and a regular sort', () => {
    const { sql, values } = find(VectorItem, {
      $select: { id: true },
      $where: { name: 'test' },
      $sort: { vec: { $vector: [1, 2, 3] }, name: -1 },
      $limit: 10,
    });

    expect(sql).toBe(
      `SELECT ${q('id')} FROM ${q('VectorItem')} WHERE ${q('name')} = ${ph(1)} ` +
        `ORDER BY ${distance('cosine', ph(2))}, ${q('name')} DESC LIMIT 10`,
    );
    expect(values).toEqual(['test', '[1,2,3]']);
  });

  it('should project the distance and order by its alias', () => {
    const { sql } = find(VectorItem, {
      $select: { id: true },
      $sort: { vec: { $vector: [1, 2, 3], $project: 'similarity' } },
      $limit: 10,
    });

    expect(sql).toBe(
      `SELECT ${q('id')}, ${distance('cosine', ph(1))} AS ${q('similarity')} ` +
        `FROM ${q('VectorItem')} ORDER BY ${q('similarity')} LIMIT 10`,
    );
  });

  it.each(supported)('should filter by %s distance', (metric) => {
    const { sql, values } = find(VectorItem, {
      $select: { id: true },
      $where: { vec: { $near: { $vector: [1, 2, 3], $distance: metric, $lt: 0.35 } } },
    });

    expect(sql).toBe(`SELECT ${q('id')} FROM ${q('VectorItem')} WHERE ${distance(metric, ph(1))} < ${ph(2)}`);
    expect(values).toEqual(['[1,2,3]', 0.35]);
  });

  // Two bounds means the distance is spelled twice: a WHERE has no output alias to point back at,
  // so there is nothing to reuse the way `$project` lets ORDER BY reuse its own.
  it('should repeat the expression for each bound', () => {
    const { sql, values } = find(VectorItem, {
      $select: { id: true },
      $where: { vec: { $near: { $vector: [1, 2, 3], $gt: 0.1, $lte: 0.5 } } },
    });

    expect(sql).toBe(
      `SELECT ${q('id')} FROM ${q('VectorItem')} ` +
        `WHERE (${distance('cosine', ph(1))} > ${ph(2)} AND ${distance('cosine', ph(3))} <= ${ph(4)})`,
    );
    expect(values).toEqual(['[1,2,3]', 0.1, '[1,2,3]', 0.5]);
  });

  it('should filter by a distance range', () => {
    const { sql, values } = find(VectorItem, {
      $select: { id: true },
      $where: { vec: { $near: { $vector: [1, 2, 3], $between: [0.1, 0.5] } } },
    });

    expect(sql).toBe(
      `SELECT ${q('id')} FROM ${q('VectorItem')} WHERE ${distance('cosine', ph(1))} BETWEEN ${ph(2)} AND ${ph(3)}`,
    );
    expect(values).toEqual(['[1,2,3]', 0.1, 0.5]);
  });

  // The RAG shape: threshold in `$where`, ranking in `$sort`, both on the same field. This is what
  // the docs used to do by over-fetching and filtering the rows in JavaScript.
  it('should filter and rank in one statement', () => {
    const { sql, values } = find(VectorItem, {
      $select: { id: true },
      $where: { name: 'docs', vec: { $near: { $vector: [1, 2, 3], $lt: 0.35 } } },
      $sort: { vec: { $vector: [1, 2, 3], $project: 'score' } },
      $limit: 30,
    });

    expect(sql).toBe(
      `SELECT ${q('id')}, ${distance('cosine', ph(1))} AS ${q('score')} FROM ${q('VectorItem')} ` +
        `WHERE ${q('name')} = ${ph(2)} AND ${distance('cosine', ph(3))} < ${ph(4)} ` +
        `ORDER BY ${q('score')} LIMIT 30`,
    );
    expect(values).toEqual(['[1,2,3]', 'docs', '[1,2,3]', 0.35]);
  });

  it("should take the field's own default metric for a predicate", () => {
    const { sql } = find(L2Item, { $select: { id: true }, $where: { vec: { $near: { $vector: [1, 2, 3], $lt: 1 } } } });

    expect(sql).toBe(`SELECT ${q('id')} FROM ${q('L2Item')} WHERE ${distance('l2', ph(1))} < ${ph(2)}`);
  });

  // A `$near` with only a vector is a WHERE that is always true, which is a silent no-op rather than
  // the filter the caller asked for. `/http` casts client JSON straight to `Query`, so it gets here.
  it('should reject a $near with no bound', () => {
    expect(() => find(VectorItem, { $where: { vec: { $near: { $vector: [1, 2, 3] } } } })).toThrow(
      "$near on 'vec' needs a bound",
    );
  });

  it('should reject a bound that is not an ordering comparison', () => {
    expect(() => find(VectorItem, { $where: { vec: { $near: { $vector: [1, 2, 3], $like: 'x' } } } } as never)).toThrow(
      'unsupported $near bound: $like',
    );
  });

  // `$where` operators mean the same thing at any depth, so a predicate nested under a logical
  // operator compiles like a top-level one - and the parenthesization is the surrounding clause's.
  it('should compile inside a logical operator', () => {
    const { sql, values } = find(VectorItem, {
      $select: { id: true },
      $where: { $or: [{ vec: { $near: { $vector: [1, 2, 3], $lt: 0.35 } } }, { name: 'x' }] },
    });

    expect(sql).toBe(
      `SELECT ${q('id')} FROM ${q('VectorItem')} ` +
        `WHERE ${distance('cosine', ph(1))} < ${ph(2)} OR ${q('name')} = ${ph(3)}`,
    );
    expect(values).toEqual(['[1,2,3]', 0.35, 'x']);
  });

  it('should compile under a negation', () => {
    const { sql } = find(VectorItem, {
      $select: { id: true },
      $where: { vec: { $not: { $near: { $vector: [1, 2, 3], $lt: 0.35 } } } },
    });

    expect(sql).toBe(`SELECT ${q('id')} FROM ${q('VectorItem')} WHERE NOT (${distance('cosine', ph(1))} < ${ph(2)})`);
  });

  it.each(unsupported)('should reject a %s predicate', (metric) => {
    expect(() =>
      find(VectorItem, { $where: { vec: { $near: { $vector: [1, 2, 3], $distance: metric, $lt: 1 } } } }),
    ).toThrow(`does not support vector distance metric: ${metric}`);
  });

  it.each(unsupported)('should reject %s', (metric) => {
    expect(() => find(VectorItem, { $sort: { vec: { $vector: [1, 2, 3], $distance: metric } } })).toThrow(
      `does not support vector distance metric: ${metric}`,
    );
  });

  // `toString` is not an own property of the distance map, but `Object.prototype.toString` is: a
  // bracket-access lookup would resolve it and emit that as the operator.
  it('should not resolve a metric through the prototype chain', () => {
    expect(() =>
      find(VectorItem, { $sort: { vec: { $vector: [1, 2, 3], $distance: 'toString' as VectorDistance } } }),
    ).toThrow('does not support vector distance metric: toString');
  });
});

describe('dialects without vector search', () => {
  it('should reject a vector sort on MySQL, which has no distance function outside HeatWave', () => {
    const dialect = new MySqlDialect();
    const ctx = dialect.createContext();
    expect(() => dialect.find(ctx, VectorItem, { $sort: { vec: { $vector: [1, 2, 3] } } })).toThrow(
      'mysql does not support vector similarity search',
    );
  });

  it('should reject a vector sort on D1, pointing at Vectorize', () => {
    const dialect = new D1SqliteDialect();
    const ctx = dialect.createContext();
    expect(() => dialect.find(ctx, VectorItem, { $sort: { vec: { $vector: [1, 2, 3] } } })).toThrow(
      'Cloudflare D1 has no vector functions',
    );
  });

  it('should reject a $near predicate on the same dialects, through the same expression', () => {
    const mysql = new MySqlDialect();
    const d1 = new D1SqliteDialect();
    const near = { $where: { vec: { $near: { $vector: [1, 2, 3], $lt: 1 } } } };

    expect(() => mysql.find(mysql.createContext(), VectorItem, near)).toThrow(
      'mysql does not support vector similarity search',
    );
    expect(() => d1.find(d1.createContext(), VectorItem, near)).toThrow('Cloudflare D1 has no vector functions');
  });
});

/**
 * Reading a vector back. pgvector returns the column as text, and the field type promises `number[]`,
 * so a read that skipped this handed every consumer a string that still satisfied the compiler. In
 * Variability it made `cosineSimilarity` score a stored embedding as 0 against itself, which reads as
 * "different person" rather than as an error, and silently released every user-confirmed speaker.
 *
 * Driven by the column's own cast, never by sniffing the text: the write side already knows whether a
 * column is dense or sparse, and so does this.
 */
describe('parseVectorLiteral', () => {
  it('reads a dense literal back as the array that was written', () => {
    expect(parseVectorLiteral('[1,0,2.5]', 'vector')).toEqual([1, 0, 2.5]);
    expect(parseVectorLiteral('[-1,2e-3]', 'halfvec')).toEqual([-1, 0.002]);
    expect(parseVectorLiteral('[]', 'vector')).toEqual([]);
  });

  it('expands a sparse literal to the dense array the field type promises', () => {
    // The exact inverse of toSparsevecLiteral, including the zeros it drops.
    expect(parseVectorLiteral(toSparsevecLiteral([1, 0, 2]), 'sparsevec')).toEqual([1, 0, 2]);
    expect(parseVectorLiteral('{}/3', 'sparsevec')).toEqual([0, 0, 0]);
  });

  it('round-trips whatever the write side produced, for every cast', () => {
    const dense = [0.5, 0, -2, 0, 1];
    expect(parseVectorLiteral(`[${dense.join(',')}]`, 'vector')).toEqual(dense);
    expect(parseVectorLiteral(toSparsevecLiteral(dense), 'sparsevec')).toEqual(dense);
  });

  it('keeps out of the way when the text is not that column’s literal', () => {
    // Returning undefined lets the caller keep the raw value instead of inventing one.
    expect(parseVectorLiteral('not a vector', 'vector')).toBeUndefined();
    expect(parseVectorLiteral('[1,two]', 'vector')).toBeUndefined();
    expect(parseVectorLiteral('[1,,2]', 'vector')).toBeUndefined(); // a hole is not a zero
    expect(parseVectorLiteral('{1:}/3', 'sparsevec')).toBeUndefined(); // nor is a missing value
    expect(parseVectorLiteral('[1,2]', 'sparsevec')).toBeUndefined();
    expect(parseVectorLiteral('{9:1}/3', 'sparsevec')).toBeUndefined(); // index past the dimension
  });
});

/**
 * `$project` names a new column, and the entity's own names are taken: both would come back under
 * the one name, so the distance would silently stand in for the real value.
 */
describe('vector $project', () => {
  const dialect = new PostgresDialect();
  const exec = (project: string) => {
    const ctx = dialect.createContext();
    dialect.find(ctx, VectorItem, { $sort: { vec: { $vector: [1, 2, 3], $project: project } } });
    return ctx.sql;
  };

  it('rejects a name the entity already uses', () => {
    expect(() => exec('name')).toThrow("$project 'name' collides with a field of 'VectorItem'");
    expect(() => exec('id')).toThrow("$project 'id' collides with a field of 'VectorItem'");
  });

  it('accepts a name of its own', () => {
    expect(exec('score')).toContain('AS "score"');
  });
});

/**
 * `$candidates` widens an ANN index's search for one query. The knob is the index's own, so which
 * statement it becomes depends on the index type declared on the field - and where there is no ANN
 * index, or no vector search to rank, there is nothing to widen and nothing is emitted.
 */
@Entity({ name: 'HnswItem' })
@Index(['vec'], { type: 'hnsw', distance: 'cosine' })
class HnswItem {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', dimensions: 3 }) vec!: number[];
}

@Entity({ name: 'IvfflatItem' })
@Index(['vec'], { type: 'ivfflat', distance: 'cosine' })
class IvfflatItem {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', dimensions: 3 }) vec!: number[];
}

describe('vector query-time tuning', () => {
  const pg = new PostgresDialect();
  const rank = { $sort: { vec: { $vector: [1, 2, 3] } }, $limit: 10, $candidates: 200 };

  it('sets the candidate list for an HNSW index', () => {
    expect(pg.vectorTuningStatements(getMeta(HnswItem), rank)).toEqual(['SET LOCAL hnsw.ef_search = 200']);
  });

  it('sets the probe count for an IVFFlat index, which measures a different thing', () => {
    expect(pg.vectorTuningStatements(getMeta(IvfflatItem), rank)).toEqual(['SET LOCAL ivfflat.probes = 200']);
  });

  /**
   * Without iterative scan, HNSW hands back one candidate list and the predicate removes from it, so
   * a bounded search can return fewer rows than qualify. `strict_order` keeps the rows in distance
   * order, which `relaxed_order` would not - and the statement still orders by that distance.
   */
  it('adds iterative scan when the query also filters by distance', () => {
    const bounded = { ...rank, $where: { vec: { $near: { $vector: [1, 2, 3], $lt: 0.35 } } } };

    expect(pg.vectorTuningStatements(getMeta(HnswItem), bounded)).toEqual([
      'SET LOCAL hnsw.ef_search = 200',
      'SET LOCAL hnsw.iterative_scan = strict_order',
    ]);
  });

  it('finds a $near nested inside a logical operator', () => {
    const bounded = { ...rank, $where: { $or: [{ vec: { $near: { $vector: [1, 2, 3], $lt: 0.35 } } }] } };

    expect(pg.vectorTuningStatements(getMeta(HnswItem), bounded)).toHaveLength(2);
  });

  // Two ranked vector fields is ambiguous; the first wins. Pinned because the SQL side and MongoDB
  // used to disagree here - one took the first entry and the other the last.
  it('takes the first vector sort when more than one field is ranked', () => {
    @Entity({ name: 'TwoVectorItem' })
    @Index(['a'], { type: 'hnsw', distance: 'cosine' })
    class TwoVectorItem {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector', dimensions: 3 }) a!: number[];
      @Field({ type: 'vector', dimensions: 3 }) b!: number[];
    }

    const tuned = pg.vectorTuningStatements(getMeta(TwoVectorItem), {
      $sort: { a: { $vector: [1, 2, 3] }, b: { $vector: [4, 5, 6] } },
      $candidates: 200,
    });

    expect(tuned).toEqual(['SET LOCAL hnsw.ef_search = 200']);
  });

  it('emits nothing for a field with no ANN index', () => {
    expect(pg.vectorTuningStatements(getMeta(VectorItem), rank)).toEqual([]);
  });

  it('emits nothing without $candidates', () => {
    expect(pg.vectorTuningStatements(getMeta(HnswItem), { $sort: { vec: { $vector: [1, 2, 3] } } })).toEqual([]);
  });

  // The ANN index is what ranks: pgvector reaches for HNSW on an `ORDER BY distance LIMIT`, so a
  // query that never orders by distance would be setting a knob for a scan that does not use it.
  it('emits nothing when the query does not rank by distance', () => {
    expect(pg.vectorTuningStatements(getMeta(HnswItem), { $candidates: 200 })).toEqual([]);
  });

  /**
   * The number is spelled into the statement, not bound - neither engine takes a placeholder in a
   * `SET`. `/http` casts client JSON straight to `Query`, so anything can arrive here; `Number()`
   * alone would turn `'abc'` into a `NaN` the server rejects with a message about nothing.
   */
  it.each([['abc'], ['1; DROP TABLE users'], [-5], [1.7], [0], [null], [Number.NaN]])(
    'should refuse %p as a candidate count',
    (candidates) => {
      expect(() =>
        pg.vectorTuningStatements(getMeta(HnswItem), { ...rank, $candidates: candidates as number }),
      ).toThrow('$candidates must be a positive integer');
    },
  );

  it('needs a transaction on Postgres and nowhere else', () => {
    expect(pg.vectorTuningNeedsTransaction).toBe(true);
    expect(new SqliteDialect().vectorTuningNeedsTransaction).toBe(false);
    expect(new MariaDialect().vectorTuningNeedsTransaction).toBe(false);
  });

  // SQLite, libSQL and Turso compute every distance, so there is no candidate list to widen.
  it('emits nothing where the search is exact', () => {
    expect(new SqliteDialect().vectorTuningStatements(getMeta(HnswItem), rank)).toEqual([]);
    expect(new TursoDialect().vectorTuningStatements(getMeta(HnswItem), rank)).toEqual([]);
  });

  /** MariaDB scopes the variable to the one statement, so it prefixes the SQL instead of preceding it. */
  it('prefixes the statement on MariaDB rather than running a SET of its own', () => {
    @Entity({ name: 'MariaVecItem' })
    @Index(['vec'], { type: 'vector', distance: 'cosine' })
    class MariaVecItem {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector', dimensions: 3 }) vec!: number[];
    }
    const maria = new MariaDialect();
    const ctx = maria.createContext();

    maria.find(ctx, MariaVecItem, rank);

    expect(ctx.sql.startsWith('SET STATEMENT mhnsw_ef_search=200 FOR SELECT ')).toBe(true);
    expect(maria.vectorTuningStatements(getMeta(MariaVecItem), rank)).toEqual([]);
  });
});
