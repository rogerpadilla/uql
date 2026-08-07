import type { CustomTypesConfig } from 'pg';

/**
 * The shape every pg-family driver exposes as `types`: `pg`'s own, and `@neondatabase/serverless`'s
 * reimplementation of it. Taken as a parameter rather than imported, because `uql-orm/neon` must not
 * pull `pg` into an edge bundle that has no such peer installed - the same reason
 * `abstractPgQuerierPool.ts` keeps its `pg` imports type-only.
 */
type PgTypes = {
  readonly builtins: Readonly<Record<string, number>>;
  getTypeParser(oid: number, format?: 'text' | 'binary'): (value: string) => unknown;
};

/**
 * Decode `INT8` and `FLOAT8` as JS numbers, leaving every other type to the driver.
 *
 * uql owes this to the caller because uql picks the column: `type: Number` maps to BIGINT (see
 * `schema/canonicalType.ts`), so without it a field declared `number` read back as `'9'` - including
 * every auto-increment primary key, on every entity. `FLOAT8` is a float64, which is exactly what a
 * JS number is, so decoding it loses nothing at all.
 *
 * At the driver because everything crosses the wire decoder exactly once - entity reads, `RETURNING
 * id`, raw SQL, counts, aggregates - while the ORM's hydration only ever sees entity reads. Which
 * types belong here and which need the entity's declaration is settled in `hydratableFields`.
 *
 * `NUMERIC` is deliberately absent, and decoded in hydration instead: `type: BigInt` also maps to
 * BIGINT, so a blanket decode here is already as far as a driver can go without the declaration. That
 * split also covers mysql2, which returns DECIMAL as text and has no equivalent hook.
 *
 * Per pool, never global, which is the whole reason this takes `types` as an argument. TypeORM does
 * the same job by assigning `postgres.defaults.parseInt8`, a module-wide flag every pool in the
 * process then shares; MikroORM passes a per-pool `TypeOverrides`, as here. Two globals of exactly
 * that shape have already been deleted from this repo - `test/pgTypeParsers.util.ts` and the
 * `types.setTypeParser` calls in `neon/neonQuerier.test.ts` - and both made the suite pass on
 * behaviour the library never shipped. Do not reintroduce one.
 *
 * Exact to 2^53, which covers any auto-increment id. A caller who needs more passes their own
 * `types` in the pool options: it is spread after this one and therefore wins. For a decimal, the
 * lighter escape hatch is the declaration itself: `@Field({ type: String, columnType: 'decimal' })`
 * keeps the column DECIMAL while leaving the value as the exact text the driver returned.
 */
export function numericTypes(types: PgTypes): CustomTypesConfig {
  // Text only: in binary mode an INT8 arrives as an 8-byte Buffer, and `Number(buffer)` is `NaN`.
  const textNumeric: ReadonlySet<number> = new Set([types.builtins['INT8'], types.builtins['FLOAT8']]);
  return {
    getTypeParser: (oid, format) =>
      format === 'text' && textNumeric.has(oid) ? Number : types.getTypeParser(oid, format),
  };
}
