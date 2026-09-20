import type { QueryOptions, WireQuery } from '../type/index.js';
// the clause lists themselves, not the barrel: this module is in the browser bundle's graph
import {
  QUERY_BOOLEAN_CLAUSES,
  QUERY_NUMBER_CLAUSES,
  QUERY_OBJECT_CLAUSES,
  QUERY_ROOT_NUMBER_CLAUSES,
  QUERY_ROOT_OBJECT_CLAUSES,
} from '../type/query.js';
// the brand alone, not the class: importing `QueryRaw` for an `instanceof` kept it, and `ColumnRef`
// with it, in the browser bundle, which is on a size budget
import { RAW_VALUE } from '../type/queryRaw.js';
// the specific util module, not the barrel, so the browser bundle does not pull in entity metadata
import { getKeys, isWhereMap } from '../util/object.util.js';
// the error class alone, from its own leaf module: `queryError.ts` carries every driver's code map
import { UqlUsageError } from '../util/uqlError.js';

/**
 * Keys accepted from the wire - query structure ({@link Query}) plus the `hardDelete`/`count` scalar
 * flags. Anything else (e.g. `filters`, `context`, `$entity`) is dropped so a remote client can't
 * bypass a security filter or inject ambient context - those are server-only. The `satisfies` ties
 * every entry to a real query/option key, so a typo or a renamed option fails to compile.
 */
const ALLOWED_QUERY_KEYS = new Set<string>([
  ...QUERY_OBJECT_CLAUSES,
  ...QUERY_ROOT_OBJECT_CLAUSES,
  ...QUERY_NUMBER_CLAUSES,
  ...QUERY_ROOT_NUMBER_CLAUSES,
  ...QUERY_BOOLEAN_CLAUSES,
  'hardDelete',
  'count',
] satisfies (keyof WireQuery<unknown> | keyof Pick<QueryOptions, 'hardDelete'> | 'count')[]);

/**
 * Keys that mean something locally but that this transport can never honor, so they are rejected
 * rather than dropped like the rest. Each request runs on its own auto-committing connection, so a
 * row lock taken here is released before the response is written: honoring `$lock` is impossible,
 * and ignoring it would hand the caller a read they believe is serialized and is not.
 */
const REJECTED_QUERY_KEYS = new Set<string>(['$lock'] satisfies (keyof WireQuery<unknown>)[]);

/**
 * Parse raw query-string entries (with JSON-stringified values) into a UQL query object.
 * Symmetric counterpart of {@link stringifyQuery}. Only {@link ALLOWED_QUERY_KEYS} are honored.
 */
export function parseQueryParams(params: Record<string, unknown> = {}): WireQuery<unknown> {
  const query: Record<string, unknown> = {};
  for (const key of getKeys(params)) {
    if (REJECTED_QUERY_KEYS.has(key)) {
      throw new UqlUsageError(`'${key}' is not supported over HTTP`);
    }
    if (ALLOWED_QUERY_KEYS.has(key)) {
      query[key] = params[key];
    }
  }

  for (const key of [...QUERY_OBJECT_CLAUSES, ...QUERY_ROOT_OBJECT_CLAUSES]) {
    const value = query[key];
    if (typeof value === 'string') {
      try {
        query[key] = JSON.parse(value);
      } catch {
        throw Object.assign(new SyntaxError(`invalid JSON in '${key}'`), { status: 400 });
      }
    }
  }

  query['$where'] ??= {};
  if (!isWhereMap(query['$where'])) {
    throw new UqlUsageError("'$where' must be a JSON object");
  }

  // A query string carries every value as text, so what decodes a clause is the shape its group
  // declares. `'false'` is the reason the boolean pass exists rather than the raw value being taken:
  // it is a non-empty string, so a `$distinct=false` would otherwise read as asking for one.
  for (const key of [...QUERY_NUMBER_CLAUSES, ...QUERY_ROOT_NUMBER_CLAUSES]) {
    if (query[key] !== undefined) {
      query[key] = Number(query[key]);
    }
  }
  for (const key of QUERY_BOOLEAN_CLAUSES) {
    if (query[key] !== undefined) {
      query[key] = query[key] === true || query[key] === 'true';
    }
  }

  return query as WireQuery<unknown>;
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
      throw new TypeError('raw SQL cannot travel over HTTP: what leaves the browser is JSON');
    }
    // A blob is a field value, so no type parameter reaches it: this is the only place it is caught.
    if (held instanceof ArrayBuffer || ArrayBuffer.isView(held)) {
      throw new TypeError('binary cannot travel over HTTP: what leaves the browser is JSON');
    }
    return held;
  });
}
