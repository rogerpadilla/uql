import { INDEX_TYPES, type IndexType } from '../../schema/types.js';
import type { DialectName, IndexFeature } from '../../type/index.js';
import { VECTOR_INDEX_TYPES } from '../../type/vector.js';

/** What an engine's `CREATE INDEX` can say; an index asking for anything else is refused rather than emitted. */
export type IndexCapabilities = {
  /**
   * Each type its `CREATE INDEX` takes, with the features it can express on one, each a hard error at the server
   * where it is missing. An untyped index is its `btree`. SQLite's has no `USING`, so every type builds its plain one.
   */
  readonly types: ReadonlyMap<IndexType, ReadonlySet<IndexFeature>>;
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

/** Each of `types`, expressing the same `features`. */
function typesWith(
  types: readonly IndexType[],
  features: readonly IndexFeature[],
): Map<IndexType, ReadonlySet<IndexFeature>> {
  const expressed: ReadonlySet<IndexFeature> = new Set(features);
  return new Map(types.map((type) => [type, expressed]));
}

const DECLARE_VECTOR = "; declare type: 'vector' instead";

/** Each engine's {@link IndexCapabilities}, total over the engines. */
export const INDEX_CAPABILITIES: Readonly<Record<DialectName, IndexCapabilities>> = {
  /** Postgres 18's `pg_am`, with pgvector's two, and `fulltext`, which builds a `gin` one. */
  postgres: {
    types: typesWith(
      ['btree', 'hash', 'gin', 'gist', 'brin', 'hnsw', 'ivfflat', 'fulltext'],
      ['expression', 'partial', 'nullsOrder', 'opsClass', 'include', 'jsonPath'],
    ),
    keywords: NONE,
    hints: NONE,
    inline: false,
  },
  /** v26.3 answers `hash` and `brin` "unimplemented", `ivfflat` "unrecognized"; no nulls order nor operator class. */
  cockroachdb: {
    types: typesWith(
      ['btree', 'gin', 'gist', 'hnsw', 'vector', 'fulltext'],
      ['expression', 'partial', 'include', 'jsonPath'],
    ),
    keywords: new Map([['vector', 'VECTOR INDEX']]),
    hints: new Map([['ivfflat', DECLARE_VECTOR]]),
    inline: true,
  },
  /** No vector index: MySQL 26.7 has no distance function outside HeatWave, and `VECTOR INDEX` is MariaDB's. */
  mysql: {
    types: typesWith(['btree', 'hash', 'fulltext'], ['expression', 'prefixLength', 'jsonPath', 'jsonArray']),
    keywords: MYSQL_LIKE_KEYWORDS,
    hints: new Map(VECTOR_INDEX_TYPES.map((type) => [type, '. Vector search on MySQL needs HeatWave'])),
    inline: true,
  },
  /**
   * No functional index, even on 12.3, where a generated column is the documented workaround: so no JSON index
   * either. A vector index of its own, `CREATE VECTOR INDEX`, 11.7+.
   */
  mariadb: {
    types: typesWith(['btree', 'hash', 'fulltext', 'vector'], ['prefixLength']),
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
    types: typesWith(['btree'], ['partial']),
    keywords: NONE,
    hints: NONE,
    inline: false,
  },
  /** Every type builds a plain index, so an entity written for Postgres migrates; libSQL's vector is DiskANN. */
  sqlite: {
    types: typesWith(INDEX_TYPES, ['expression', 'partial', 'jsonPath']),
    keywords: NONE,
    hints: NONE,
    inline: false,
  },
  /**
   * A key spec says a plain key or `'text'`, and Atlas adds its vector search index, which pre-filters on fields
   * instead of a predicate. A path inside a document, or each element of an array there, is a key like any other:
   * a multikey index on an array.
   */
  mongodb: {
    types: new Map([
      ...typesWith(['btree', 'fulltext'], ['partial', 'jsonPath', 'jsonArray', 'fulltextPath']),
      ['vectorSearch', new Set()],
    ]),
    keywords: NONE,
    hints: NONE,
    inline: false,
  },
};
