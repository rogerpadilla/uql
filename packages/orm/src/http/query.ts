import type { QueryKeyset, QueryOptions, WireQuery } from '../type/index.js';
// the clause table itself, not the barrel: this module is in the browser bundle's graph
import { QUERY_CLAUSES, type QueryClause } from '../type/query.js';
// the brand alone, not the class: importing `QueryRaw` for an `instanceof` kept it, and `ColumnRef`
// with it, in the browser bundle, which is on a size budget
import { RAW_VALUE } from '../type/queryRaw.js';
// the specific util module, not the barrel, so the browser bundle does not pull in entity metadata
import { getKeys, isRecord, isWhereMap } from '../util/object.util.js';
// the error class alone, from its own leaf module: `queryError.ts` carries every driver's code map
import { UqlUsageError } from '../util/uqlError.js';

/** The flags a request carries beside its query: `hardDelete` on a delete, `count` on a `findMany`. */
const WIRE_FLAGS = ['hardDelete', 'count'] as const satisfies (keyof Pick<QueryOptions, 'hardDelete'> | 'count')[];

/** {@link WIRE_FLAGS} as the booleans {@link parseQueryParams} decodes them to, where a hook may also set them. */
export type WireFlags = { readonly [K in (typeof WIRE_FLAGS)[number]]?: boolean };

/** The cursors a page request carries; only `findManyPage` reads them. */
export type WireCursors = Pick<QueryKeyset<unknown>, '$after' | '$before'>;

/**
 * Keys that mean something locally but that this transport can never honor, so they are rejected
 * rather than dropped like the rest. Each request runs on its own auto-committing connection, so a
 * row lock taken here is released before the response is written: honoring `$lock` is impossible,
 * and ignoring it would hand the caller a read they believe is serialized and is not.
 */
const REJECTED_QUERY_KEYS = new Set<string>(['$lock'] satisfies (keyof WireQuery<unknown>)[]);

/**
 * The keys accepted from the wire, mapped to how each value is decoded: every query clause ({@link QUERY_CLAUSES})
 * plus the {@link WIRE_FLAGS}. Anything else (e.g. `filters`, `context`, `$entity`) is dropped, so a remote
 * client can't bypass a security filter or inject ambient context.
 */
const WIRE_VALUES: ReadonlyMap<string, QueryClause['value']> = new Map([
  ...getKeys(QUERY_CLAUSES).map((key) => [key, QUERY_CLAUSES[key].value] as const),
  ...WIRE_FLAGS.map((flag) => [flag, 'boolean'] as const),
]);

/**
 * Parse raw query-string entries (with JSON-stringified values), or a `QUERY` body, into a UQL query
 * object. Symmetric counterpart of {@link stringifyQuery}. Only the keys in {@link WIRE_VALUES} are honored.
 */
export function parseQueryParams<E = unknown>(params: unknown = {}): WireQuery<E> & WireFlags & WireCursors {
  if (!isRecord(params)) {
    throw new UqlUsageError('the query must be a JSON object');
  }
  const query: Record<string, unknown> = {};
  for (const key of getKeys(params)) {
    if (REJECTED_QUERY_KEYS.has(key)) {
      throw new UqlUsageError(`'${key}' is not supported over HTTP`);
    }
    const shape = WIRE_VALUES.get(key);
    if (shape && params[key] !== undefined) {
      query[key] = decodeWireValue(key, shape, params[key]);
    }
  }
  query['$where'] ??= {};
  if (!isWhereMap(query['$where'])) {
    throw new UqlUsageError("'$where' must be a JSON object");
  }
  return query;
}

/**
 * Decodes a value to the type its clause declares. A query string carries every value as text, so a boolean
 * must be decoded: `'false'` is a non-empty string, and taken as is, `$distinct=false` would turn it on.
 */
function decodeWireValue(key: string, shape: QueryClause['value'], value: unknown): unknown {
  switch (shape) {
    case 'object':
      return typeof value === 'string' ? parseJson(key, value) : value;
    case 'number':
      return Number(value);
    case 'boolean':
      return value === true || value === 'true';
    case 'string':
      // A cursor arrives as the exact text a page handed out, never as JSON, so any other value is not a cursor.
      if (typeof value !== 'string') {
        throw new UqlUsageError(`'${key}' must be a cursor a page handed out`);
      }
      return value;
  }
}

function parseJson(key: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new UqlUsageError(`invalid JSON in '${key}'`);
  }
}

/**
 * Serialize a UQL query object into a percent-encoded query string where object values
 * are JSON-stringified. Symmetric counterpart of {@link parseQueryParams}.
 */
export function stringifyQuery(query?: Record<string, unknown>): string {
  if (!query) {
    return '';
  }
  const params = new URLSearchParams();
  for (const key of getKeys(query)) {
    const value = query[key];
    if (value === undefined) {
      continue;
    }
    params.append(key, typeof value === 'object' && value !== null ? wireJson(value) : String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * What leaves the browser, as JSON, refusing what JSON keeps nothing of rather than letting the server
 * build a statement around the remains. A `raw` fragment renders SQL against a dialect the client does not
 * have and arrives as `{}`; binary arrives as an object keyed by index. A `Date` is not among them - it
 * serializes to ISO 8601, which is what a date column reads. This is what a cast, or a JavaScript caller,
 * hits where the client's types already refuse a fragment.
 */
export function wireJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, held: unknown) => {
    if (typeof held !== 'object' || held === null) {
      return held;
    }
    if (RAW_VALUE in held) {
      throw new UqlUsageError('raw SQL cannot travel over HTTP: what leaves the browser is JSON');
    }
    // A blob is a field value, so no type parameter reaches it: this is the only place it is caught.
    if (held instanceof ArrayBuffer || ArrayBuffer.isView(held)) {
      throw new UqlUsageError('binary cannot travel over HTTP: what leaves the browser is JSON');
    }
    return held;
  });
}
