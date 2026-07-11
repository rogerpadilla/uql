import type { DialectOptions } from '../dialect/abstractDialect.js';
import { PgLikeSqlDialect } from '../dialect/pgLikeSqlDialect.js';
import type { VectorDistance } from '../type/index.js';

/**
 * CockroachDB Dialect.
 * Shares AST/quoting/JSONB/full-text-search/vector-search/upsert logic with Postgres via
 * {@link PgLikeSqlDialect} (wire- and SQL-compatible for all of that, including pgvector's
 * `<=>`/`<->`/`<#>` operators, which CockroachDB implements natively). Unlike Postgres, CockroachDB
 * has no `xmax`/`ctid` system columns, so it uses `PgLikeSqlDialect.upsert`'s default as-is (no
 * `created` detection) rather than Postgres's `xmax`-based override; no `vectorExtension` either,
 * since the vector type is native (no `CREATE EXTENSION` needed); and vector indexes use
 * CockroachDB's own `CREATE VECTOR INDEX` syntax (no access-method keyword) rather than pgvector's
 * `CREATE INDEX ... USING ivfflat/hnsw`.
 */
export class CockroachDialect extends PgLikeSqlDialect {
  override readonly dialectName = 'cockroachdb';

  // CockroachDB only implements 3 of pgvector's 5 distance metrics. Verified live (both `<+>`/`<~>`
  // query operators and `vector_l1_ops`/`bit_hamming_ops` index opclasses throw "unimplemented:
  // operator class ... is not supported") and confirmed in CockroachDB's own docs, "Known
  // limitations": https://www.cockroachlabs.com/docs/stable/vector-indexes - tracked upstream at
  // https://github.com/cockroachdb/cockroach/issues/147839. Re-check that issue before adding
  // `l1`/`hamming` here; they're omitted on purpose, not an oversight.
  override readonly vectorOpsClass: ReadonlyMap<VectorDistance, string> | undefined = new Map([
    ['cosine', 'vector_cosine_ops'],
    ['l2', 'vector_l2_ops'],
    ['inner', 'vector_ip_ops'],
  ]);

  constructor(options: DialectOptions = {}) {
    super({
      ...options,
      driverCapabilities: {
        vectorIndexStyle: 'native',
        ...options.driverCapabilities,
      },
    });
  }
}
