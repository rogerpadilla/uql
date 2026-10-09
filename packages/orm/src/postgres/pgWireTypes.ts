import type { CustomTypesConfig } from 'pg';
import { decodeDate } from '../util/date.js';
import { decodeWideNumber } from '../util/wideNumber.js';

/**
 * The registry every pg-family driver exposes as `types`: `pg`'s own, and `@neondatabase/serverless`'s
 * reimplementation of it. Taken as a parameter rather than imported, because `uql-orm/neon` must not
 * pull `pg` into an edge bundle that has no such peer installed - the same reason
 * `abstractPgQuerierPool.ts` keeps its `pg` imports type-only.
 */
type PgTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary'): Decode;
};

type Decode = (text: string) => unknown;

/** Postgres' fixed OIDs: each type decoded here beside its array, and `TEXT[]`, whose parser splits any array literal. */
const OID = {
  INT8: 20,
  INT8_ARRAY: 1016,
  TIMESTAMP: 1114,
  TIMESTAMP_ARRAY: 1115,
  DATE: 1082,
  DATE_ARRAY: 1182,
  NUMERIC: 1700,
  NUMERIC_ARRAY: 1231,
  TEXT_ARRAY: 1009,
} as const;

/**
 * The types every Postgres-wire pool decodes itself: an `INT8` by `decodeWideNumber`, since `type: Number`
 * maps to BIGINT, and a zoneless `TIMESTAMP` or a `DATE` as UTC, where `pg` reads both in the process's
 * zone. `NUMERIC` is left to hydration, which knows the field.
 */
export const PG_DECODERS: ReadonlyMap<number, Decode> = new Map<number, Decode>([
  [OID.INT8, decodeWideNumber],
  [OID.TIMESTAMP, decodeDate],
  [OID.DATE, decodeDate],
]);

/**
 * Each array `pg` decodes apart from its element's rule, to its element's OID: the three above, and a
 * `NUMERIC[]`, which `pg` reads as floats where its scalar stays exact text.
 */
const ELEMENT_OIDS: ReadonlyMap<number, number> = new Map([
  [OID.INT8_ARRAY, OID.INT8],
  [OID.TIMESTAMP_ARRAY, OID.TIMESTAMP],
  [OID.DATE_ARRAY, OID.DATE],
  [OID.NUMERIC_ARRAY, OID.NUMERIC],
]);

/**
 * {@link PG_DECODERS} as `pg`'s text-format parsers, an array decoding each element as its scalar does.
 * At the wire, which every result crosses; per pool, never a global parser, and a caller's own `types` win.
 */
export function wireTypes(types: PgTypes): CustomTypesConfig {
  const splitArray = types.getTypeParser(OID.TEXT_ARRAY, 'text');
  const decoders = new Map(PG_DECODERS);
  for (const [arrayOid, oid] of ELEMENT_OIDS) {
    const decode = PG_DECODERS.get(oid) ?? types.getTypeParser(oid, 'text');
    decoders.set(arrayOid, (text) => decodeElements(splitArray(text), decode));
  }
  return {
    // Text only: in binary mode an INT8 arrives as an 8-byte Buffer, and `Number(buffer)` is `NaN`.
    getTypeParser: (oid, format) => (format === 'text' && decoders.get(oid)) || types.getTypeParser(oid, format),
  };
}

function decodeElements(value: unknown, decode: Decode): unknown {
  if (typeof value === 'string') {
    return decode(value);
  }
  return Array.isArray(value) ? value.map((element) => decodeElements(element, decode)) : value;
}
