import type { DialectOptions } from '../dialect/abstractDialect.js';
import { PgLikeSqlDialect } from '../dialect/pgLikeSqlDialect.js';

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
