import type { Query, QueryOptions } from '../type/index.js';
// specific util module (not the barrel) to keep reflect-metadata out of the browser bundle
import { getKeys } from '../util/object.util.js';

const JSON_QUERY_KEYS = [
  '$select',
  '$populate',
  '$exclude',
  '$where',
  '$sort',
] as const satisfies readonly (keyof Query<unknown>)[];

/**
 * Keys accepted from the wire - query structure ({@link Query}) plus the `hardDelete`/`count` scalar
 * flags. Anything else (e.g. `filters`, `context`, `$entity`) is dropped so a remote client can't
 * bypass a security filter or inject ambient context - those are server-only. The `satisfies` ties
 * every entry to a real query/option key, so a typo or a renamed option fails to compile.
 */
const ALLOWED_QUERY_KEYS = new Set<string>([...JSON_QUERY_KEYS, '$skip', '$limit', 'hardDelete', 'count'] satisfies (
  | keyof Query<unknown>
  | keyof Pick<QueryOptions, 'hardDelete'>
  | 'count'
)[]);

/**
 * Parse raw query-string entries (with JSON-stringified values) into a UQL query object.
 * Symmetric counterpart of {@link stringifyQuery}. Only {@link ALLOWED_QUERY_KEYS} are honored.
 */
export function parseQueryParams(params: Record<string, unknown> = {}): Query<unknown> {
  const query: Record<string, unknown> = {};
  for (const key of getKeys(params)) {
    if (ALLOWED_QUERY_KEYS.has(key)) {
      query[key] = params[key];
    }
  }

  for (const key of JSON_QUERY_KEYS) {
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

  if (query['$skip']) {
    query['$skip'] = Number(query['$skip']);
  }
  if (query['$limit']) {
    query['$limit'] = Number(query['$limit']);
  }

  return query as Query<unknown>;
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
    params.append(key, typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
