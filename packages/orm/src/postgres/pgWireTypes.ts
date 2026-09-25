import type { CustomTypesConfig } from 'pg';
import { decodeDate } from '../util/date.js';
import { decodeWideNumber } from '../util/wideNumber.js';

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
 * Decodes `INT8` by `decodeWideNumber` and `FLOAT8` as the float64 it is, since `type: Number` maps to
 * BIGINT, and a zoneless `TIMESTAMP` or a `DATE` as UTC, where `pg` reads both in the process's zone. At
 * the wire, which every result crosses; `NUMERIC` is left to hydration, which knows the field. Per pool,
 * never a global parser, and a caller's own `types` win.
 */
export function wireTypes(types: PgTypes): CustomTypesConfig {
  // Text only: in binary mode an INT8 arrives as an 8-byte Buffer, and `Number(buffer)` is `NaN`.
  const decoders = new Map<number, (text: string) => unknown>([
    [types.builtins['INT8'], decodeWideNumber],
    [types.builtins['FLOAT8'], Number],
    [types.builtins['TIMESTAMP'], decodeDate],
    [types.builtins['DATE'], decodeDate],
  ]);
  return {
    getTypeParser: (oid, format) => (format === 'text' && decoders.get(oid)) || types.getTypeParser(oid, format),
  };
}
