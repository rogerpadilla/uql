import type { Query } from '../type/index.js';
// specific util module (not the barrel) to keep reflect-metadata out of the browser bundle
import { getKeys } from '../util/object.util.js';

const JSON_QUERY_KEYS = ['$select', '$populate', '$exclude', '$where', '$sort'] as const;

/**
 * Parse raw query-string entries (with JSON-stringified values) into a UQL query object.
 * Symmetric counterpart of {@link stringifyQuery}.
 */
export function parseQueryParams(params: Record<string, unknown> = {}): Query<unknown> {
  const query: Record<string, unknown> = { ...params };

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
