import { COUNT_ALIAS } from '../dialect/aliases.js';
import { getMeta } from '../entity/index.js';
import type {
  Querier,
  Query,
  QueryAggMap,
  QueryCount,
  QueryExclude,
  QueryWhereMap,
  RelationMeta,
  Type,
} from '../type/index.js';
import { COUNT_RESULT_KEY } from '../type/index.js';
import { asSelectMap, getKeys, parentKeyColumn, targetKeyColumn } from '../util/index.js';

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
  if (!q.$count || !meta.id) {
    return q;
  }
  if (q.$distinct) {
    // The id would have to join the projection for the tallies to group by, and that is the set
    // `$distinct` collapses on: adding it silently stops the grouping collapsing anything at all.
    throw new TypeError(
      `$count cannot be combined with $distinct: the tallies group by each row's '${String(meta.id)}', which the grouping does not keep.`,
    );
  }
  if (Array.isArray(q.$select)) {
    // Nothing to add the id to, and without it every tally would be looked up by `undefined` and
    // come back zero. Refused rather than answered wrong, the way an unorderable clause is.
    throw new TypeError(
      `$count needs the '${String(meta.id)}' of each row to group its tallies by, which a raw $select cannot carry. Use a $select map, or drop the $count.`,
    );
  }
  const next: Query<E> = { ...q };
  const select = asSelectMap(q.$select);
  if (select && !select[meta.id]) {
    next.$select = { ...select, [meta.id]: true };
  }
  if (q.$exclude?.[meta.id]) {
    const kept: QueryExclude<E> = { ...q.$exclude };
    delete kept[meta.id];
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
  // The ids cross the same boundary the entity does: past here every column is named by metadata,
  // so they are read as {@link CountedRow}'s values rather than as this entity's own id type.
  const ids = payload.map((it) => it[meta.id]) as CountedRow[string][];
  const counted = new Map<string, Record<string, number>>();

  for (const relKey of getKeys(count)) {
    const value = count[relKey];
    const relOpts = meta.relations[relKey];
    if (!value || !relOpts) {
      continue;
    }
    const where = typeof value === 'object' ? (value.$where as QueryWhereMap<CountedRow> | undefined) : undefined;
    counted.set(relKey, await countPerParent(querier, relOpts, ids, where));
  }

  for (const parent of payload) {
    const id = String(parent[meta.id]);
    const row: Record<string, number> = {};
    for (const [relKey, byParent] of counted) {
      // A parent the grouped result has no row for matched nothing, which is a zero rather than a
      // gap: `_count` names what the caller asked to count, so every key it asked for is present.
      row[relKey] = byParent[id] ?? 0;
    }
    (parent as Record<string, unknown>)[COUNT_RESULT_KEY] = row;
  }
}

async function countPerParent(
  querier: CountingQuerier,
  relOpts: RelationMeta,
  ids: CountedRow[string][],
  where: QueryWhereMap<CountedRow> | undefined,
): Promise<Record<string, number>> {
  const through = relOpts.through;
  if (through) {
    return countThroughPerParent(querier, relOpts, through() as Type<CountedRow>, ids, where);
  }
  const foreign = parentKeyColumn(relOpts);
  return groupedCount(querier, relOpts.entity() as Type<CountedRow>, foreign, { ...where, [foreign]: ids });
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
  ids: CountedRow[string][],
  where: QueryWhereMap<CountedRow> | undefined,
): Promise<Record<string, number>> {
  const local = parentKeyColumn(relOpts);
  const throughWhere: QueryWhereMap<CountedRow> = { [local]: ids };

  if (where) {
    const target = relOpts.entity() as Type<CountedRow>;
    const targetId = getMeta(target).id;
    const targets = await querier.findMany(target, { $select: { [targetId]: true }, $where: where });
    throughWhere[targetKeyColumn(relOpts)] = targets.map((it) => it[targetId]);
  }

  return groupedCount(querier, throughEntity, local, throughWhere);
}

/** `SELECT <key>, COUNT(*) ... GROUP BY <key>`, as a lookup from parent key to tally. */
async function groupedCount(
  querier: CountingQuerier,
  entity: Type<CountedRow>,
  groupKey: string,
  where: QueryWhereMap<CountedRow>,
): Promise<Record<string, number>> {
  const $agg: QueryAggMap<CountedRow> = { [COUNT_ALIAS]: { $count: '*' } };
  const rows = await querier.aggregate(entity, { $group: { [groupKey]: true }, $agg, $where: where });
  const byParent: Record<string, number> = {};
  for (const row of rows) {
    byParent[String(row[groupKey])] = Number(row[COUNT_ALIAS]);
  }
  return byParent;
}
