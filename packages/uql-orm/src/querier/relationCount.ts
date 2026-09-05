import { COUNT_ALIAS } from '../dialect/aliases.js';
import { getMeta, soleIdOf } from '../entity/index.js';
import type {
  Querier,
  Query,
  QueryAggMap,
  QueryCount,
  QueryExclude,
  QueryGroupMap,
  QueryWhereMap,
  RelationMeta,
  Type,
} from '../type/index.js';
import { COUNT_RESULT_KEY } from '../type/index.js';
import {
  asSelectMap,
  getKeys,
  joinedColumns,
  joinedRowKey,
  type ParentJoin,
  parentJoins,
  parentRowKey,
  parentsIn,
  targetKeyColumns,
} from '../util/index.js';

/** What counting asks of a querier, rather than the whole interface: two reads, both batched. */
type CountingQuerier = Pick<Querier, 'aggregate' | 'findMany'>;

/**
 * A row of an entity reached through relation metadata rather than through the caller's type: its
 * columns are known only as the strings that metadata names them by. Casting to it is where the
 * counting path crosses from a checked type to a structural one; everything past that is checked.
 */
type CountedRow = Record<string, string | number>;

/**
 * A `$count` groups its tallies by the parent's id, so the id has to outlive the projection - the
 * same reason populating a relation keeps it. A whitelisting `$select` gains the key and an
 * `$exclude` loses it; the raw-array `$select` form has nothing to augment, so it is refused.
 */
export function withIdForCounts<E extends object>(entity: Type<E>, q: Query<E>): Query<E> {
  const meta = getMeta(entity);
  if (!q.$count) {
    return q;
  }
  const { ids } = meta;
  const named = ids.join(', ');
  if (q.$distinct) {
    // The keys would have to join the projection for the tallies to group by, and that is the set
    // `$distinct` collapses on: adding them silently stops the grouping collapsing anything at all.
    throw new TypeError(
      `$count cannot be combined with $distinct: the tallies group by each row's '${named}', which the grouping does not keep.`,
    );
  }
  if (Array.isArray(q.$select)) {
    // Nothing to add the keys to, and without them every tally would be looked up by `undefined` and
    // come back zero. Refused rather than answered wrong, the way an unorderable clause is.
    throw new TypeError(
      `$count needs the '${named}' of each row to group its tallies by, which a raw $select cannot carry. Use a $select map, or drop the $count.`,
    );
  }
  const next: Query<E> = { ...q };
  const select = asSelectMap(q.$select);
  const missing = select ? ids.filter((key) => !select[key]) : [];
  if (missing.length) {
    next.$select = { ...select, ...Object.fromEntries(missing.map((key) => [key, true])) };
  }
  const excluded = ids.filter((key) => q.$exclude?.[key]);
  if (excluded.length) {
    const kept: QueryExclude<E> = { ...q.$exclude };
    for (const key of excluded) {
      delete kept[key];
    }
    next.$exclude = kept;
  }
  return next;
}

/**
 * How many rows each counted relation holds, under `_count` on every parent. One grouped aggregate
 * per relation over every parent at once - the batching a populated to-many already gets - so the
 * cost stays flat in the number of rows the read returned rather than one statement per row.
 */
export async function fillRelationCounts<E>(
  querier: CountingQuerier,
  entity: Type<E>,
  payload: E[],
  count?: QueryCount<E>,
): Promise<void> {
  if (!payload.length || !count) {
    return;
  }
  const meta = getMeta(entity);
  // The tallies come back keyed by the columns *this relation* joins from, so its `joins` are kept
  // beside them: reading the parent through `meta.ids` instead matches only where the two coincide,
  // which is a to-many and nothing else.
  const counted = new Map<string, { joins: readonly ParentJoin[]; byParent: Record<string, number> }>();

  for (const relKey of getKeys(count)) {
    const value = count[relKey];
    const relOpts = meta.relations[relKey];
    if (!value || !relOpts) {
      continue;
    }
    const where = typeof value === 'object' ? (value.$where as QueryWhereMap<CountedRow> | undefined) : undefined;
    const joins = parentJoins(relOpts, meta.ids.length);
    counted.set(relKey, { joins, byParent: await countPerParent(querier, relOpts, joins, payload, where) });
  }

  for (const parent of payload) {
    const row: Record<string, number> = {};
    for (const [relKey, { joins, byParent }] of counted) {
      // A parent the grouped result has no row for matched nothing, which is a zero rather than a
      // gap: `_count` names what the caller asked to count, so every key it asked for is present.
      row[relKey] = byParent[parentRowKey(joins, parent)] ?? 0;
    }
    (parent as Record<string, unknown>)[COUNT_RESULT_KEY] = row;
  }
}

async function countPerParent(
  querier: CountingQuerier,
  relOpts: RelationMeta,
  joins: readonly ParentJoin[],
  parents: readonly unknown[],
  where: QueryWhereMap<CountedRow> | undefined,
): Promise<Record<string, number>> {
  const through = relOpts.through;
  if (through) {
    return countThroughPerParent(querier, relOpts, through() as Type<CountedRow>, joins, parents, where);
  }
  return groupedCount(querier, relOpts.entity() as Type<CountedRow>, joins, {
    ...where,
    ...parentsIn(joins, parents),
  } as QueryWhereMap<CountedRow>);
}

/**
 * A many-to-many counts its junction rows, one per pairing. A filter names the target's columns,
 * which the junction does not have, so the matching targets are resolved first and the junction
 * counted against them - the one shape here that costs a second statement, and only when filtered.
 */
async function countThroughPerParent(
  querier: CountingQuerier,
  relOpts: RelationMeta,
  throughEntity: Type<CountedRow>,
  joins: readonly ParentJoin[],
  parents: readonly unknown[],
  where: QueryWhereMap<CountedRow> | undefined,
): Promise<Record<string, number>> {
  const throughWhere = parentsIn(joins, parents) as QueryWhereMap<CountedRow>;

  if (where) {
    const target = relOpts.entity() as Type<CountedRow>;
    const targetId = soleIdOf(getMeta(target), 'a many-to-many target');
    const targets = await querier.findMany(target, { $select: { [targetId]: true }, $where: where });
    const [targetColumn] = targetKeyColumns(relOpts, joins.length);
    throughWhere[targetColumn] = targets.map((it) => it[targetId]);
  }

  return groupedCount(querier, throughEntity, joins, throughWhere);
}

/** `SELECT <keys>, COUNT(*) ... GROUP BY <keys>`, as a lookup from parent key to tally. */
async function groupedCount(
  querier: CountingQuerier,
  entity: Type<CountedRow>,
  joins: readonly ParentJoin[],
  where: QueryWhereMap<CountedRow>,
): Promise<Record<string, number>> {
  const $agg: QueryAggMap<CountedRow> = { [COUNT_ALIAS]: { $count: '*' } };
  const $group = joinedColumns(joins) as QueryGroupMap<CountedRow>;
  const rows = await querier.aggregate(entity, { $group, $agg, $where: where });
  const byParent: Record<string, number> = {};
  for (const row of rows) {
    // Keyed by every joined column, which is how a tally finds the one parent whose whole key it
    // matches - and how the rows an over-selecting `IN` brought back find no parent at all.
    byParent[joinedRowKey(joins, row)] = Number(row[COUNT_ALIAS]);
  }
  return byParent;
}
