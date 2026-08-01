import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { D1SqliteDialect } from '../d1/d1SqliteDialect.js';
import { Entity, Field, Id } from '../entity/index.js';
import { LibsqlDialect } from '../libsql/libsqlDialect.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { VectorItem } from '../test/index.js';
import { TursoDialect } from '../turso/tursoDialect.js';
import type { VectorDistance } from '../type/index.js';
import type { AbstractSqlDialect } from './abstractSqlDialect.js';

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
 * sqlite-vec 0.1.9, `@libsql/client` 0.17, `@tursodatabase/database` 0.7, MySQL 9.7), because a wrong
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
    dialect.find(ctx, entity as never, query as never);
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
      'mysql does not support vector similarity sort',
    );
  });

  it('should reject a vector sort on D1, pointing at Vectorize', () => {
    const dialect = new D1SqliteDialect();
    const ctx = dialect.createContext();
    expect(() => dialect.find(ctx, VectorItem, { $sort: { vec: { $vector: [1, 2, 3] } } })).toThrow(
      'Cloudflare D1 has no vector functions',
    );
  });
});
