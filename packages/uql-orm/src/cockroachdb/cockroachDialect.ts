import { PostgresDialect } from '../postgres/index.js';
import type { NamingStrategy } from '../type/index.js';

/**
 * CockroachDB Dialect.
 * Completely leverages PostgresDialect directly since they share wire compatibility.
 * CockroachDB natively supports `(xmax = 0)` to allow Postgres-compatible ORMs
 * to perform `upsert` queries without custom overrides.
 */
export class CockroachDialect extends PostgresDialect {
  constructor(namingStrategy?: NamingStrategy) {
    super(namingStrategy, 'cockroachdb');
  }
}
