import { INDEX_TYPES, type IndexType } from '../../schema/types.js';
import type { IndexFeature, SqlDialectName } from '../../type/index.js';
import { VECTOR_INDEX_TYPES } from '../../type/vector.js';

/** What an engine's `CREATE INDEX` can say; an index asking for anything else is refused rather than emitted. */
export type IndexCapabilities = {
  /** The types its `CREATE INDEX` takes. SQLite's has no `USING`, so every type builds its plain index there. */
  readonly types: ReadonlySet<IndexType>;
  /** The features it can express, each supported by one engine and a hard error at the server on another. */
  readonly features: ReadonlySet<IndexFeature>;
  /**
   * The types it spells as a keyword of their own (`FULLTEXT INDEX`, `VECTOR INDEX`) rather than as an access
   * method: one table drives both, so a keyword never also leaks out as a ` USING` the engine has no word for.
   */
  readonly keywords: ReadonlyMap<IndexType, string>;
  /** What to declare instead of a type it lacks, appended to the refusal. */
  readonly hints: ReadonlyMap<IndexType, string>;
  /** Whether `CREATE TABLE` takes a plain index among its definitions, built with the table. */
  readonly inline: boolean;
};

const NONE: ReadonlyMap<IndexType, string> = new Map();

/** A full-text index is its own keyword in the MySQL family: `USING fulltext` is a syntax error there. */
const MYSQL_LIKE_KEYWORDS: ReadonlyMap<IndexType, string> = new Map([['fulltext', 'FULLTEXT INDEX']]);

const DECLARE_VECTOR = "; declare type: 'vector' instead";

/** Each engine's {@link IndexCapabilities}, total over the SQL engines. */
export const INDEX_CAPABILITIES: Readonly<Record<SqlDialectName, IndexCapabilities>> = {
  /** Postgres 18's `pg_am`, with pgvector's two, and `fulltext`, which builds a `gin` one. */
  postgres: {
    types: new Set(['btree', 'hash', 'gin', 'gist', 'brin', 'hnsw', 'ivfflat', 'fulltext']),
    features: new Set(['expression', 'partial', 'nullsOrder', 'opsClass', 'include', 'jsonPath']),
    keywords: NONE,
    hints: NONE,
    inline: false,
  },
  /** v26.3 answers `hash` and `brin` "unimplemented", `ivfflat` "unrecognized"; no nulls order nor operator class. */
  cockroachdb: {
    types: new Set(['btree', 'gin', 'gist', 'hnsw', 'vector', 'fulltext']),
    features: new Set(['expression', 'partial', 'include', 'jsonPath']),
    keywords: new Map([['vector', 'VECTOR INDEX']]),
    hints: new Map([['ivfflat', DECLARE_VECTOR]]),
    inline: true,
  },
  /** No vector index: MySQL 26.7 has no distance function outside HeatWave, and `VECTOR INDEX` is MariaDB's. */
  mysql: {
    types: new Set(['btree', 'hash', 'fulltext']),
    features: new Set(['expression', 'prefixLength', 'jsonPath', 'jsonArray']),
    keywords: MYSQL_LIKE_KEYWORDS,
    hints: new Map(VECTOR_INDEX_TYPES.map((type) => [type, '. Vector search on MySQL needs HeatWave'])),
    inline: true,
  },
  /**
   * No functional index, even on 12.3, where a generated column is the documented workaround: so no JSON index
   * either. A vector index of its own, `CREATE VECTOR INDEX`, 11.7+.
   */
  mariadb: {
    types: new Set(['btree', 'hash', 'fulltext', 'vector']),
    features: new Set(['prefixLength']),
    keywords: new Map([...MYSQL_LIKE_KEYWORDS, ['vector', 'VECTOR INDEX']]),
    hints: new Map([
      ['hnsw', DECLARE_VECTOR],
      ['ivfflat', DECLARE_VECTOR],
    ]),
    inline: true,
  },
  /**
   * 2025 rejects an expression (Msg 16216), the subquery a JSON path compiles to (Msg 1046), and any type but
   * the rowstore B-tree, since the index built in its place fails on a `VECTOR` or `nvarchar(max)` (Msg 1978).
   */
  mssql: {
    types: new Set(['btree']),
    features: new Set(['partial']),
    keywords: NONE,
    hints: NONE,
    inline: false,
  },
  /** Every type builds a plain index, so an entity written for Postgres migrates; libSQL's vector is DiskANN. */
  sqlite: {
    types: new Set(INDEX_TYPES),
    features: new Set(['expression', 'partial', 'jsonPath']),
    keywords: NONE,
    hints: NONE,
    inline: false,
  },
};
