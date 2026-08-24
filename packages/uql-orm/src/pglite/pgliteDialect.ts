import { PostgresDialect } from '../postgres/postgresDialect.js';

/**
 * Postgres dialect for PGlite, the WASM Postgres build.
 *
 * @remarks Keeps every {@link PostgresDialect} default, `dialectName` included: PGlite *is* Postgres,
 * so the introspector, schema generator and CLI must all resolve to the Postgres ones. Both driver
 * capabilities are inherited deliberately rather than by omission. `nativeArrays: true` holds because
 * PGlite registers an array serializer for every built-in array type at boot and resolves each
 * parameter's type from a server-side `Describe` before binding; `explicitJsonCast: false` holds
 * because `PgLikeSqlDialect` already emits `$n::jsonb`, which is what makes that `Describe` report
 * JSONB and select PGlite's `JSON.stringify` serializer. A bare `$n` would bind `[object Object]`.
 */
export class PgliteDialect extends PostgresDialect {}
