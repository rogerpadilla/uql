import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../../cockroachdb/cockroachDialect.js';
import { MariaDialect } from '../../maria/mariaDialect.js';
import { MySql2Dialect } from '../../mysql/mysql2Dialect.js';
import { MySqlDialect } from '../../mysql/mysqlDialect.js';
import { PgDialect } from '../../postgres/pgDialect.js';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import type { Except, IndexSchema } from '../../type/index.js';
import { CockroachIndexDdl, IndexDdl, indexDdlFor, MariaIndexDdl, MySqlIndexDdl, PgIndexDdl } from './index.js';

/**
 * The DDL a dialect gets is picked off its class, so a driver's own subclass (`PgDialect`,
 * `MySql2Dialect`) keeps the family's statement rather than falling back to the portable form -
 * which is what overriding on the dialect gave it before this moved to the migrator.
 */
/**
 * Which DDL a dialect resolves to. The statements themselves are asserted once, below - what is at
 * stake here is only that a driver's own subclass (`PgDialect`, `MySql2Dialect`) keeps its family's
 * class rather than falling back to the portable form, which is what overriding on the dialect gave
 * it before this moved to the migrator.
 */
describe('indexDdlFor', () => {
  it.each([
    ['a driver subclass of Postgres', new PgDialect(), PgIndexDdl],
    ['CockroachDB, over its Postgres base', new CockroachDialect(), CockroachIndexDdl],
    ['a driver subclass of MySQL', new MySql2Dialect(), MySqlIndexDdl],
    ['MariaDB, over its MySQL base', new MariaDialect(), MariaIndexDdl],
    ['anything else, which is SQLite', new SqliteDialect(), IndexDdl],
  ] as const)('gives %s its own', (_name, dialect, expected) => {
    expect(indexDdlFor(dialect)).toBeInstanceOf(expected);
  });
});

describe('index features', () => {
  const dialects = {
    postgres: new PostgresDialect(),
    cockroachdb: new CockroachDialect(),
    mysql: new MySqlDialect(),
    mariadb: new MariaDialect(),
    sqlite: new SqliteDialect(),
  } as const;

  const render = (dialect: keyof typeof dialects, index: Except<IndexSchema, 'name' | 'unique'>) =>
    indexDdlFor(dialects[dialect]).getCreateIndexStatement('t', { name: 'i', unique: false, ...index } as IndexSchema);

  // MySQL requires the extra parentheses; Postgres, CockroachDB and SQLite accept them, so one
  // rendering serves all four. MariaDB 12.3 has no functional indexes at all.
  it.each([
    ['postgres', 'CREATE INDEX IF NOT EXISTS "i" ON "t" ((lower("email")));'],
    ['cockroachdb', 'CREATE INDEX IF NOT EXISTS "i" ON "t" ((lower("email")));'],
    ['mysql', 'CREATE INDEX `i` ON `t` ((lower("email")));'],
    ['sqlite', 'CREATE INDEX IF NOT EXISTS `i` ON `t` ((lower("email")));'],
  ] as const)('should index an expression on %s', (dialect, expected) => {
    expect(render(dialect, { entries: [{ column: 'lower("email")', expression: true }] })).toBe(expected);
  });

  it('should reject an expression index on MariaDB, which has no functional indexes', () => {
    expect(() => render('mariadb', { entries: [{ column: 'lower(`email`)', expression: true }] })).toThrow(
      'mariadb does not support expression indexes (index "i")',
    );
  });

  // Without a prefix MySQL and MariaDB refuse to index a TEXT column at all.
  it.each([
    ['mysql', 'CREATE INDEX `i` ON `t` (`body`(64));'],
    ['mariadb', 'CREATE INDEX IF NOT EXISTS `i` ON `t` (`body`(64));'],
  ] as const)('should emit a prefix length on %s', (dialect, expected) => {
    expect(render(dialect, { entries: [{ column: 'body', length: 64 }] })).toBe(expected);
  });

  it.each(['postgres', 'sqlite'] as const)('should reject a prefix length on %s', (dialect) => {
    expect(() => render(dialect, { entries: [{ column: 'body', length: 64 }] })).toThrow(
      'does not support index prefix lengths',
    );
  });

  /** Stored order is universal, and it is what lets `ORDER BY ... DESC` pagination use the index. */
  it.each([
    ['postgres', 'CREATE INDEX IF NOT EXISTS "i" ON "t" ("email" DESC);'],
    ['cockroachdb', 'CREATE INDEX IF NOT EXISTS "i" ON "t" ("email" DESC);'],
    ['mysql', 'CREATE INDEX `i` ON `t` (`email` DESC);'],
    ['mariadb', 'CREATE INDEX IF NOT EXISTS `i` ON `t` (`email` DESC);'],
    ['sqlite', 'CREATE INDEX IF NOT EXISTS `i` ON `t` (`email` DESC);'],
  ] as const)('should emit a descending entry on %s', (dialect, expected) => {
    expect(render(dialect, { entries: [{ column: 'email', order: 'desc' }] })).toBe(expected);
  });

  it('should emit NULLS ordering and INCLUDE and an operator class on Postgres', () => {
    expect(render('postgres', { entries: [{ column: 'email', order: 'desc', nulls: 'first' }] })).toBe(
      'CREATE INDEX IF NOT EXISTS "i" ON "t" ("email" DESC NULLS FIRST);',
    );
    expect(render('postgres', { entries: [{ column: 'email' }], include: ['body'] })).toBe(
      'CREATE INDEX IF NOT EXISTS "i" ON "t" ("email") INCLUDE ("body");',
    );
    expect(render('postgres', { entries: [{ column: 'data', opsClass: 'jsonb_path_ops' }], type: 'gin' })).toBe(
      'CREATE INDEX IF NOT EXISTS "i" ON "t" USING gin ("data" jsonb_path_ops);',
    );
  });

  // CockroachDB answers "unimplemented" to both, though it does take INCLUDE.
  it.each(['nullsOrder', 'opsClass'] as const)('should reject %s on CockroachDB', (feature) => {
    const entries = [
      feature === 'nullsOrder'
        ? { column: 'email', nulls: 'first' as const }
        : { column: 'data', opsClass: 'jsonb_path_ops' },
    ];
    expect(() => render('cockroachdb', { entries })).toThrow('cockroachdb does not support');
  });

  it.each(['mysql', 'mariadb', 'sqlite'] as const)('should reject a covering index on %s', (dialect) => {
    expect(() => render(dialect, { entries: [{ column: 'email' }], include: ['body'] })).toThrow(
      'does not support covering indexes (INCLUDE)',
    );
  });

  /**
   * A JSON path index is the query's own expression, per dialect, which is the only form the
   * planner matches back to it - verified live in `postgresJsonPathIndex.test.ts`, on the plan for
   * the statement `find` builds rather than on a lookalike.
   */
  it.each([
    ['postgres', 'CREATE INDEX IF NOT EXISTS "i" ON "t" (((("kind"->\'theme\')->>\'color\')));'],
    ['cockroachdb', 'CREATE INDEX IF NOT EXISTS "i" ON "t" (((("kind"->\'theme\')->>\'color\')));'],
    ['sqlite', "CREATE INDEX IF NOT EXISTS `i` ON `t` ((json_extract(`kind`, '$.theme.color')));"],
  ] as const)('should index a JSON path on %s', (dialect, expected) => {
    expect(render(dialect, { entries: [{ column: 'kind', jsonPath: { path: 'theme.color', type: String } }] })).toBe(
      expected,
    );
  });

  /** A number is compared cast to a number, so the index over it carries the same cast. */
  it.each([
    ['postgres', 'CREATE INDEX IF NOT EXISTS "i" ON "t" (((("kind"->>\'rating\'))::numeric));'],
    ['sqlite', "CREATE INDEX IF NOT EXISTS `i` ON `t` ((CAST(json_extract(`kind`, '$.rating') AS REAL)));"],
  ] as const)('should index a numeric JSON path on %s', (dialect, expected) => {
    expect(render(dialect, { entries: [{ column: 'kind', jsonPath: { path: 'rating', type: Number } }] })).toBe(
      expected,
    );
  });

  // MySQL takes the DDL but never matches it back to the query (26.7), so it is refused instead.
  it.each(['mysql', 'mariadb'] as const)('should reject a JSON path index on %s', (dialect) => {
    expect(() =>
      render(dialect, { entries: [{ column: 'kind', jsonPath: { path: 'rating', type: Number } }] }),
    ).toThrow(`${dialect} does not support indexes over a path inside a JSON column (index "i")`);
  });

  /**
   * MySQL's multi-valued index, over the column itself where the array is the whole document -
   * which is what `$all` reads, and what its `JSON_CONTAINS(col, ?)` is matched against. Verified
   * live in `mysqlJsonArrayIndex.test.ts`, on the plan for the statement `find` builds.
   */
  it('should index a JSON array on MySQL', () => {
    expect(render('mysql', { entries: [{ column: 'tags', jsonArray: { type: String, length: 64 } }] })).toBe(
      'CREATE INDEX `i` ON `t` ((CAST(`tags` AS CHAR(64) ARRAY)));',
    );
    expect(render('mysql', { entries: [{ column: 'kind', jsonArray: { path: 'ids', type: Number } }] })).toBe(
      "CREATE INDEX `i` ON `t` ((CAST(`kind`->'$.ids' AS SIGNED ARRAY)));",
    );
  });

  it('should reject a JSON array element type MySQL cannot cast to', () => {
    expect(() => render('mysql', { entries: [{ column: 'tags', jsonArray: { type: String } }] })).toThrow(
      'a multi-valued index over string elements needs a length',
    );
    expect(() => render('mysql', { entries: [{ column: 'tags', jsonArray: { type: 'float' } }] })).toThrow(
      'mysql has no array cast for float elements',
    );
  });

  it.each(['postgres', 'cockroachdb', 'mariadb', 'sqlite'] as const)(
    'should reject a multi-valued index on %s',
    (dialect) => {
      expect(() => render(dialect, { entries: [{ column: 'tags', jsonArray: { type: String, length: 64 } }] })).toThrow(
        'does not support multi-valued indexes over a JSON array',
      );
    },
  );
});

/**
 * The statement itself, per dialect. It renders through `indexDdlFor` rather than through the
 * migrator that calls it: the generator adds nothing to a `CREATE INDEX`, so asserting it there
 * tested this module through a wrapper, and left the same SQL asserted twice in two files.
 */
describe('CREATE INDEX', () => {
  const pgDdl = indexDdlFor(new PostgresDialect());

  it('should generate CREATE INDEX statement', () => {
    const sql = pgDdl.getCreateIndexStatement('users', {
      name: 'users__email_idx',
      entries: [{ column: 'email' }],
      unique: true,
    });

    expect(sql).toBe('CREATE UNIQUE INDEX IF NOT EXISTS "users__email_idx" ON "users" ("email");');
  });

  it('should generate CREATE INDEX for HNSW vector index', () => {
    const sql = pgDdl.getCreateIndexStatement('articles', {
      name: 'articles_embedding_hnsw_idx',
      entries: [{ column: 'embedding' }],
      unique: false,
      type: 'hnsw',
      distance: 'cosine',
    });
    expect(sql).toBe(
      'CREATE INDEX IF NOT EXISTS "articles_embedding_hnsw_idx" ON "articles" USING hnsw ("embedding" vector_cosine_ops);',
    );
  });

  it('should generate CREATE INDEX for HNSW with tuning params', () => {
    const sql = pgDdl.getCreateIndexStatement('articles', {
      name: 'embedding_idx',
      entries: [{ column: 'embedding' }],
      unique: false,
      type: 'hnsw',
      distance: 'l2',
      m: 16,
      efConstruction: 64,
    });
    expect(sql).toBe(
      'CREATE INDEX IF NOT EXISTS "embedding_idx" ON "articles" USING hnsw ("embedding" vector_l2_ops) WITH (m = 16, ef_construction = 64);',
    );
  });

  it('should generate CREATE INDEX for IVFFlat', () => {
    const sql = pgDdl.getCreateIndexStatement('articles', {
      name: 'embedding_ivf_idx',
      entries: [{ column: 'embedding' }],
      unique: false,
      type: 'ivfflat',
      distance: 'inner',
      lists: 100,
    });
    expect(sql).toBe(
      'CREATE INDEX IF NOT EXISTS "embedding_ivf_idx" ON "articles" USING ivfflat ("embedding" vector_ip_ops) WITH (lists = 100);',
    );
  });

  it('should not emit operator classes or WITH params for non-Postgres dialects', () => {
    const ddl = indexDdlFor(new MySqlDialect());
    const sql = ddl.getCreateIndexStatement('articles', {
      name: 'title_idx',
      entries: [{ column: 'title' }],
      unique: false,
      type: 'btree',
      m: 16,
      efConstruction: 64,
    });
    // MySQL: no operator class, no WITH params - just USING
    expect(sql).toBe('CREATE INDEX `title_idx` ON `articles` USING btree (`title`);');
  });

  // `USING fulltext` is a syntax error on both, and it is the index `MATCH ... AGAINST` needs, so
  // `$text` on the MySQL family had no way to work. Verified on MySQL 26.7 and MariaDB 12.3.
  it.each([
    ['mysql', new MySqlDialect()],
    ['mariadb', new MariaDialect()],
  ] as const)('should emit CREATE FULLTEXT INDEX on %s', (_name, dialect) => {
    const sql = indexDdlFor(dialect).getCreateIndexStatement('articles', {
      name: 'text_idx',
      entries: [{ column: 'title' }, { column: 'body' }],
      unique: false,
      type: 'fulltext',
    });
    expect(sql).toBe(
      `CREATE FULLTEXT INDEX ${dialect.features.indexIfNotExists ? 'IF NOT EXISTS ' : ''}\`text_idx\` ON \`articles\` (\`title\`, \`body\`);`,
    );
  });

  // MySQL 26.7 has `VECTOR` columns but no vector index of any kind: `USING hnsw` is a syntax error
  // and the inline `VECTOR INDEX` form is MariaDB's, so both used to generate DDL it rejects.
  it.each(['hnsw', 'ivfflat', 'vector'] as const)('should reject a %s index on MySQL', (type) => {
    const ddl = indexDdlFor(new MySqlDialect());
    expect(() =>
      ddl.getCreateIndexStatement('articles', {
        name: 'embedding_idx',
        entries: [{ column: 'embedding' }],
        unique: false,
        type,
        distance: 'cosine',
      }),
    ).toThrow(`mysql has no ${type} index (index "embedding_idx"). Vector search on MySQL needs HeatWave`);
  });

  // SQLite's CREATE INDEX grammar has no `USING` clause at all, so emitting one made every typed
  // index - vector or plain btree - a syntax error on SQLite, libSQL, Turso and D1.
  it.each(['hnsw', 'btree'] as const)('should drop the USING clause on SQLite for a %s index', (type) => {
    const ddl = indexDdlFor(new SqliteDialect());
    const sql = ddl.getCreateIndexStatement('articles', {
      name: 'embedding_idx',
      entries: [{ column: 'embedding' }],
      unique: false,
      type,
      distance: 'cosine',
    });
    expect(sql).toBe('CREATE INDEX IF NOT EXISTS `embedding_idx` ON `articles` (`embedding`);');
  });

  // pgvector's operator classes are named `{type}_{metric}_ops`, so an index on a narrower vector
  // column needs its own: `vector_cosine_ops` on a halfvec column is rejected outright.
  it.each([
    ['vector', 'vector_cosine_ops'],
    ['halfvec', 'halfvec_cosine_ops'],
    ['sparsevec', 'sparsevec_cosine_ops'],
  ] as const)('should name the %s operator class', (vectorType, opsClass) => {
    const sql = pgDdl.getCreateIndexStatement('articles', {
      name: 'embedding_idx',
      entries: [{ column: 'embedding' }],
      unique: false,
      type: 'hnsw',
      distance: 'cosine',
      vectorType,
    });
    expect(sql).toBe(`CREATE INDEX IF NOT EXISTS "embedding_idx" ON "articles" USING hnsw ("embedding" ${opsClass});`);
  });

  it.each([
    ['sparsevec', 'cosine', 'sparsevec_cosine_ops'],
    ['vector', 'l1', 'vector_l1_ops'],
  ] as const)('should reject an ivfflat index on %s/%s', (vectorType, distance, opsClass) => {
    expect(() =>
      pgDdl.getCreateIndexStatement('articles', {
        name: 'embedding_idx',
        entries: [{ column: 'embedding' }],
        unique: false,
        type: 'ivfflat',
        distance,
        vectorType,
      }),
    ).toThrow(`ivfflat has no ${opsClass} operator class`);
  });

  /**
   * The index features that some engines have and others reject outright, each verified against a
   * live server: what a dialect cannot express is refused rather than emitted, since every one of
   * these is a hard error at the server rather than a slower plan.
   */

  /**
   * The index features that some engines have and others reject outright, each verified against a
   * live server: what a dialect cannot express is refused rather than emitted, since every one of
   * these is a hard error at the server rather than a slower plan.
   */

  it('should emit a partial index predicate on SQLite', () => {
    const ddl = indexDdlFor(new SqliteDialect());
    const sql = ddl.getCreateIndexStatement('users', {
      name: 'live_email_idx',
      entries: [{ column: 'email' }],
      unique: true,
      where: '`deletedAt` IS NULL',
    });
    expect(sql).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS `live_email_idx` ON `users` (`email`) WHERE `deletedAt` IS NULL;',
    );
  });

  // Silently widening a partial unique index changes which rows the database rejects, so the MySQL
  // family refuses the predicate rather than dropping it.
  it('should reject a partial index on MySQL', () => {
    const ddl = indexDdlFor(new MySqlDialect());
    expect(() =>
      ddl.getCreateIndexStatement('users', {
        name: 'live_email_idx',
        entries: [{ column: 'email' }],
        unique: true,
        where: '`deletedAt` IS NULL',
      }),
    ).toThrow('mysql does not support partial indexes (index "live_email_idx"');
  });

  it('should generate CREATE VECTOR INDEX for CockroachDB (native syntax, no USING/WITH)', () => {
    const ddl = indexDdlFor(new CockroachDialect());
    const sql = ddl.getCreateIndexStatement('articles', {
      name: 'articles_embedding_idx',
      entries: [{ column: 'embedding' }],
      unique: false,
      type: 'vector',
      distance: 'cosine',
      // CockroachDB has its own tuning knobs, not m/efConstruction/lists - must not appear.
      m: 16,
      efConstruction: 64,
    });
    expect(sql).toBe(
      'CREATE VECTOR INDEX IF NOT EXISTS "articles_embedding_idx" ON "articles" ("embedding" vector_cosine_ops);',
    );
  });

  it('should not add an operator class to a CockroachDB index with a non-vector type', () => {
    const ddl = indexDdlFor(new CockroachDialect());
    const sql = ddl.getCreateIndexStatement('articles', {
      name: 'articles_name_idx',
      entries: [{ column: 'name' }],
      unique: false,
      type: 'btree',
    });
    expect(sql).toBe('CREATE INDEX IF NOT EXISTS "articles_name_idx" ON "articles" USING btree ("name");');
  });

  it('should throw for a CockroachDB vector index with an unsupported distance metric, not silently drop the opclass', () => {
    const ddl = indexDdlFor(new CockroachDialect());
    expect(() =>
      ddl.getCreateIndexStatement('articles', {
        name: 'articles_embedding_idx',
        entries: [{ column: 'embedding' }],
        unique: false,
        type: 'vector',
        distance: 'l1',
      }),
    ).toThrow('cockroachdb does not support vector distance metric: l1');
  });

  it('should not resolve an operator class via the prototype chain for an unvalidated distance value', () => {
    const ddl = indexDdlFor(new CockroachDialect());
    expect(() =>
      ddl.getCreateIndexStatement('articles', {
        name: 'articles_embedding_idx',
        entries: [{ column: 'embedding' }],
        unique: false,
        type: 'vector',
        distance: 'toString' as any, // deliberately unvalidated input, mirroring dynamic/JSON query data
      }),
    ).toThrow('cockroachdb does not support vector distance metric: toString');
  });

  /**
   * `CREATE VECTOR INDEX ... ON t (col)` is MariaDB's own statement (11.7+), verified on 12.3, and it
   * is what lets `autoSync` add one to a table that already exists - the inline `CREATE TABLE` form
   * it also has cannot, and taking that form for the only one is what used to skip the index.
   */
});
