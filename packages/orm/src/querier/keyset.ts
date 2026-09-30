import type {
  CursorPage,
  EntityMeta,
  FieldKey,
  Query,
  QueryKeyset,
  QuerySortDirection,
  QueryWhere,
} from '../type/index.js';
import { DATE_PRECISION } from '../util/date.js';
import { declaredIndexes } from '../util/ddlExpression.util.js';
import { isSelectList, isVectorSearch, normalizeScalarFieldSelection } from '../util/dialect.util.js';
import { aggregateOf, declaresNotNull, fieldFamily, isFieldKey } from '../util/field.util.js';
import { entityName, getKeys } from '../util/object.util.js';
import { keySet, parseSortDirection, sortOf, whereAnd, whereAnyOf, whereWith } from '../util/query.util.js';
import { fnv1a } from '../util/string.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { type CursorKey, mintCursor, readCursor } from './cursor.js';

/** A resolved sort key of a page: its direction, where its nulls sort, and whether it can hold nulls. */
type PageKey<E> = CursorKey<E> & {
  readonly desc: boolean;
  readonly nullsFirst: boolean;
  /** Whether the caller set where the nulls go, in which case the inverted order must set it too. */
  readonly placed: boolean;
};

/**
 * A resolved `findManyPage` query: the query to run, and the function that builds the page from its rows.
 * [The design](../../../../architecture/cursor-pagination.md).
 */
export type KeysetRead<E> = {
  readonly query: Query<E>;
  /**
   * Builds the page from the rows `query` returns: drops the extra row, restores the order of rows read
   * backward, mints a cursor from the first and last rows, and removes the keys the projection left out.
   */
  readonly page: (rows: readonly E[]) => CursorPage<E>;
};

/**
 * Turns a page query into the query to run: checks that `$sort` is total, inverts it for `$before`, turns
 * the cursor into a `$where` for the rows past it, and reads one row over the page size to tell whether
 * another page follows. `nullsSortLowest` says where the engine sorts nulls, for keys with no placement.
 */
export function keysetRead<E extends object>(
  meta: EntityMeta<E>,
  q: QueryKeyset<E>,
  nullsSortLowest: boolean,
): KeysetRead<E> {
  const { $after, $before, ...rest } = q;
  assertPageable(meta, q);
  const order = pageOrder(meta, q, nullsSortLowest);
  const keys = totalPrefix(meta, order);
  const fingerprint = fingerprintOf(meta, order);
  const backward = $before !== undefined;
  const cursor = $before ?? $after;
  const projected = projectedKeys(meta, q);
  const carried = keys.map(({ key }) => key).filter((key) => !projected.includes(key));
  const query: Query<E> = {
    ...rest,
    // Rewrite the projection as an explicit `$select` that adds the sort keys it left out, which the cursor needs.
    ...(carried.length > 0 && { $select: keySet([...projected, ...carried]), $exclude: undefined }),
    $sort: backward ? sortOf(order.map(inverted).map((key) => [key.key, spelling(key)])) : rest.$sort,
    $where:
      cursor === undefined
        ? rest.$where
        : whereAnd(
            rest.$where,
            keysetClauses(backward ? keys.map(inverted) : keys, readCursor(meta, fingerprint, keys, cursor)),
          ),
    $limit: q.$limit + 1,
  };
  const mint = (row: E) => mintCursor(meta, fingerprint, keys, row);
  const page = (rows: readonly E[]): CursorPage<E> => {
    const more = rows.length > q.$limit;
    const items = rows.slice(0, q.$limit);
    if (backward) {
      items.reverse();
    }
    // A page knows rows lie behind it only when it was itself read past a cursor.
    const flags = { hasNextPage: backward || more, hasPrevPage: backward ? more : cursor !== undefined };
    if (!items.length) {
      return { items, ...flags };
    }
    const cursors = { startCursor: mint(items[0]), endCursor: mint(items[items.length - 1]) };
    for (const item of items) {
      for (const key of carried) {
        Reflect.deleteProperty(item, key);
      }
    }
    return { items, ...flags, ...cursors };
  };
  return { query, page };
}

/** Refuses a page query with `$skip`, both cursors, `$distinct`, or a `$limit` that is not a positive integer. */
function assertPageable<E>(meta: EntityMeta<E>, q: QueryKeyset<E>): void {
  const refuse = (why: string) => new UqlUsageError(`a page of '${entityName(meta)}' ${why}`);
  // The type forbids `$skip`, but untyped input from `/http` can still carry one.
  if ('$skip' in q && q.$skip !== undefined) {
    throw refuse('takes no $skip: an offset reintroduces the drift a cursor removes');
  }
  if (q.$after !== undefined && q.$before !== undefined) {
    throw refuse('reads past one cursor, $after or $before, not both');
  }
  if (q.$distinct) {
    throw refuse('takes no $distinct: its rows are a grouping, which the cursor compares no column of');
  }
  if (!Number.isInteger(q.$limit) || q.$limit < 1) {
    throw refuse(`holds a positive whole number of rows, and $limit is ${q.$limit}`);
  }
}

/** Resolves each key of the page's `$sort`, refusing one without a stored value a cursor can compare. */
function pageOrder<E>(meta: EntityMeta<E>, q: QueryKeyset<E>, nullsSortLowest: boolean): PageKey<E>[] {
  const sort = q.$sort ?? {};
  return getKeys(sort).map((key) => {
    const refuse = (why: string) => new UqlUsageError(`cannot page '${entityName(meta)}' by '${key}': ${why}`);
    if (key === '$text') {
      throw refuse('a relevance is scored per row, not stored on it');
    }
    const field = meta.fields[key];
    if (!field || !isFieldKey(meta, key)) {
      throw refuse(
        meta.relations[key]
          ? "a relation's value is read through a join that its filter would not keep"
          : 'a cursor compares fields, and this is none',
      );
    }
    if (aggregateOf(field)) {
      throw refuse('an aggregate is computed per row, not stored on it');
    }
    const value: unknown = sort[key];
    if (isVectorSearch(value)) {
      throw refuse('a vector distance is approximate, so "past this one" is no stable page');
    }
    const family = fieldFamily(field);
    if (family === 'json' || family === 'vector' || family === 'blob') {
      throw refuse(`a ${family} column holds no one value a cursor can compare past`);
    }
    if (family === 'date' && (field.precision ?? DATE_PRECISION) > DATE_PRECISION) {
      throw refuse(`it keeps ${field.precision} fractional digits, and a cursor the milliseconds a Date holds`);
    }
    const { desc, nulls } = parseSortDirection(value);
    // With no placement, the engine decides: nulls come first ascending if it sorts them lowest, else descending.
    const nullsFirst = nulls ? nulls === 'first' : desc !== nullsSortLowest;
    return { key, desc, nullsFirst, placed: nulls !== undefined, nullable: !declaresNotNull(field) };
  });
}

/**
 * The shortest prefix of `order` that covers every column of the primary key, or of a unique field or index
 * whose columns are all non-null. A sort on which two rows can tie skips or repeats rows silently, so it is
 * refused. Rows never tie on that prefix, so the cursor needs none of the later keys.
 */
function totalPrefix<E>(meta: EntityMeta<E>, order: readonly PageKey<E>[]): PageKey<E>[] {
  const notNull = (key: string) => {
    const field = meta.fields[key];
    return field !== undefined && declaresNotNull(field);
  };
  const uniques: readonly (readonly string[])[] = [
    meta.ids,
    ...declaredIndexes(meta)
      .filter((index) => index.unique && !index.where)
      .map((index) => index.columns.map(({ column }) => column))
      .filter((columns): columns is string[] =>
        columns.every((column) => typeof column === 'string' && notNull(column)),
      ),
  ].filter((columns) => columns.length > 0);
  const seen = new Set<string>();
  for (let at = 0; at < order.length; at++) {
    seen.add(order[at].key);
    if (uniques.some((columns) => columns.every((column) => seen.has(column)))) {
      return order.slice(0, at + 1);
    }
  }
  throw new UqlUsageError(
    `a page of '${entityName(meta)}' sorts by ${order.map(({ key }) => key).join(', ') || 'nothing'}, which two rows ` +
      `can share: add ${meta.ids.length ? `'${meta.ids.join("', '")}' or ` : ''}a unique, non-null field to the end of $sort`,
  );
}

/** The key in the opposite direction, nulls included, which `$before` reads so its extra row comes first. */
function inverted<E>(key: PageKey<E>): PageKey<E> {
  return { ...key, desc: !key.desc, nullsFirst: !key.nullsFirst };
}

/** The key's direction as a `$sort` value, with a nulls placement only when the caller gave one. */
function spelling<E>({ desc, nullsFirst, placed }: PageKey<E>): QuerySortDirection {
  if (!placed) {
    return desc ? 'desc' : 'asc';
  }
  return `${desc ? 'desc' : 'asc'}Nulls${nullsFirst ? 'First' : 'Last'}`;
}

/**
 * One level of the keyset condition: a row is past the cursor when it is at or past `bound` (no bound
 * matches every row) and matches one of `alternatives`.
 */
type KeysetLevel<E> = { readonly bound?: QueryWhere<E>; readonly alternatives: QueryWhere<E>[] };

/**
 * The clauses matching the rows past `values` in the order of `keys`, as the bounded chain
 * `a <= x AND (a < x OR ...)`. Like `a = x` in the plain `a < x OR (a = x AND ...)`, each bound keeps rows tied
 * on a key for the next key to decide, but it lets Postgres seek an index where the plain form scans from the
 * top. Never empty, since the last key of a total prefix is never null.
 */
function keysetClauses<E>(keys: readonly PageKey<E>[], values: readonly unknown[]): QueryWhere<E>[] {
  const { bound, alternatives } = keys.reduceRight<KeysetLevel<E>>(
    (inner, key, at) => ({
      // The last key needs no bound: no two rows tie on it, so the strict comparison alone decides.
      bound: at === keys.length - 1 ? undefined : atOrPastOf(key, values[at]),
      alternatives: [...pastOf(key, values[at]), ...nested(inner)],
    }),
    { alternatives: [] },
  );
  return bound ? [bound, anyOf(alternatives)] : [anyOf(alternatives)];
}

/** An inner level as one alternative of its outer level, or as its own alternatives when it has no bound. */
function nested<E>({ bound, alternatives }: KeysetLevel<E>): QueryWhere<E>[] {
  return bound ? [whereAnd(undefined, [bound, anyOf(alternatives)])] : alternatives;
}

/** The rows strictly past `value` on `key`, as alternatives, including null rows only when nulls sort last. */
function pastOf<E>({ key, desc, nullsFirst, nullable }: PageKey<E>, value: unknown): QueryWhere<E>[] {
  if (value === null) {
    return nullsFirst ? [whereWith(key, { $ne: null })] : [];
  }
  return [whereWith(key, { [desc ? '$lt' : '$gt']: value }), ...nullsAhead({ key, nullsFirst, nullable })];
}

/** The rows at or past `value` on `key`, or `undefined` when that is every row. */
function atOrPastOf<E>({ key, desc, nullsFirst, nullable }: PageKey<E>, value: unknown): QueryWhere<E> | undefined {
  if (value === null) {
    return nullsFirst ? undefined : whereWith(key, null);
  }
  return anyOf([whereWith(key, { [desc ? '$lte' : '$gte']: value }), ...nullsAhead({ key, nullsFirst, nullable })]);
}

/** An `IS NULL` alternative when the key is nullable and its nulls sort after every value, else none. */
function nullsAhead<E>({
  key,
  nullsFirst,
  nullable,
}: Pick<PageKey<E>, 'key' | 'nullsFirst' | 'nullable'>): QueryWhere<E>[] {
  return nullable && !nullsFirst ? [whereWith(key, null)] : [];
}

function anyOf<E>(alternatives: QueryWhere<E>[]): QueryWhere<E> {
  return alternatives.length === 1 ? alternatives[0] : whereAnyOf(alternatives);
}

/**
 * The fields the query's projection reads, resolved by `normalizeScalarFieldSelection` the same way on every
 * backend. A raw `$select` is refused: it names no fields, and the cursor is read off the fields.
 */
function projectedKeys<E>(meta: EntityMeta<E>, q: QueryKeyset<E>): FieldKey<E>[] {
  if (isSelectList(q.$select)) {
    throw new UqlUsageError(`a page of '${entityName(meta)}' selects fields, which its cursor is read off`);
  }
  return normalizeScalarFieldSelection(meta, q.$select, q.$exclude);
}

/** Hashes the entity and each sort key's direction and placement, so a cursor only works with the sort it came from. */
function fingerprintOf<E>(meta: EntityMeta<E>, order: readonly PageKey<E>[]): string {
  return fnv1a(`${entityName(meta)}|${order.map((key) => `${key.key}:${spelling(key)}`).join(',')}`).toString(36);
}
