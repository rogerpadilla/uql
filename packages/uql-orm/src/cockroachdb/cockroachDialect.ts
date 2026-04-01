import { PostgresDialect } from '../postgres/postgresDialect.js';
import type { VectorDistance } from '../type/index.js';

/**
 * CockroachDB Dialect.
 * Completely leverages PostgresDialect directly since they share wire compatibility.
 * CockroachDB natively supports `(xmax = 0)` to allow Postgres-compatible ORMs
 * to perform `upsert` queries without custom overrides.
 */
export class CockroachDialect extends PostgresDialect {
  override readonly dialectName = 'cockroachdb';

  override readonly serialPrimaryKey = 'SERIAL PRIMARY KEY';

  override readonly vectorOpsClass: Readonly<Record<VectorDistance, string>> | undefined = undefined;

  override readonly vectorExtension: string | undefined = undefined;
}
