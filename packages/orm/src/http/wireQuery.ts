import type { QueryKeyset, WireQuery } from '../type/index.js';
// the clause table itself, not the barrel: this module is in the browser bundle's graph
import { QUERY_CLAUSES, type QueryClause } from '../type/query.js';
// the specific util module, not the barrel, which reaches every dialect helper
import { getKeys, isRecord, isPlainObject } from '../util/object.util.js';
// the error class alone, from its own leaf module: `queryError.ts` carries every driver's code map
import { UqlUsageError } from '../util/uqlError.js';

/** The cursors a page request carries; only `findManyPage` reads them. */
export type WireCursors = Pick<QueryKeyset<unknown>, '$after' | '$before'>;

/**
 * The keys a query takes from the wire, with the type of each: every query clause ({@link QUERY_CLAUSES}) the wire
 * carries. Any other key is refused: dropping a clause answers a read other than the one asked for, and `filters` or
 * `context` would bypass a security filter or inject ambient context.
 */
const WIRE_VALUES: ReadonlyMap<string, QueryClause['value']> = new Map(
  getKeys(QUERY_CLAUSES)
    .filter((key) => carriedOverHttp(QUERY_CLAUSES[key]))
    .map((key) => [key, QUERY_CLAUSES[key].value] as const),
);

function carriedOverHttp(clause: QueryClause): boolean {
  return clause.wire !== false;
}

const TYPES: Readonly<Record<QueryClause['value'], string>> = {
  object: 'a JSON object',
  number: 'a number',
  boolean: 'a boolean',
  string: 'a cursor a page handed out',
};

function holds(shape: QueryClause['value'], value: unknown): boolean {
  return shape === 'object' ? typeof value === 'object' && value !== null : typeof value === shape;
}

/**
 * A call's query as the querier takes it, refused where a key is not one the wire carries ({@link WIRE_VALUES}) or
 * holds a value of another type: what a client sends is JSON, so a number arrives as one, never as text.
 */
export function parseWireQuery<E = unknown>(query: unknown = {}): WireQuery<E> & WireCursors {
  if (!isRecord(query)) {
    throw new UqlUsageError('the query must be a JSON object', { path: ['query'] });
  }
  for (const key of getKeys(query)) {
    const shape = WIRE_VALUES.get(key);
    if (!shape) {
      throw new UqlUsageError(`'${key}' is not a query key the wire takes`, { path: ['query', key] });
    }
    const value = query[key];
    if (value !== undefined && !holds(shape, value)) {
      throw new UqlUsageError(`'${key}' must be ${TYPES[shape]}`, { path: ['query', key] });
    }
  }
  const $where = query['$where'] ?? {};
  if (!isPlainObject($where)) {
    throw new UqlUsageError("'$where' must be a JSON object", { path: ['query', '$where'] });
  }
  const parsed: Record<string, unknown> = { ...query, $where };
  return parsed;
}
