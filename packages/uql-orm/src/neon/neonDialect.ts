import { PostgresDialect } from '../postgres/postgresDialect.js';

/**
 * Postgres dialect marker for the `@neondatabase/serverless` driver.
 *
 * @remarks Extends {@link PostgresDialect} with identical defaults (`explicitJsonCast: false`,
 * `nativeArrays: true`, etc.). Kept as a distinct class for `NeonQuerierPool` typing and for
 * Neon-only capability tweaks later without affecting `pg` or Bun pools.
 */
export class NeonDialect extends PostgresDialect {}
