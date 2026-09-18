/**
 * The aggregate API: `$group` is typed against the entity, `$select` holds computed columns, and
 * `$having`/`$sort` take the grouped columns and computed aliases only. Type-checked by `bun run ts` only.
 */
import type { Querier } from '../index.js';

class User {
  id!: number;
  status!: string;
  age!: number;
  balance!: bigint;
}

declare const querier: Querier;

export async function aggregateTyping() {
  // Positive: group by a real column, compute aliases, reference them in $having / $sort.
  const rows = await querier.aggregate(User, {
    $group: { status: true },
    $select: { count: { $count: '*' }, avgAge: { $avg: { age: true } } },
    $having: { count: { $gt: 5 } },
    $sort: { avgAge: -1, status: 1 },
  });
  const status: string = rows[0].status;
  // `$count` answers 0 over an empty group; every other op answers NULL, so only this one is
  // non-nullable.
  const count: number = rows[0].count;
  const avgAge: number | null = rows[0].avgAge;
  void status;
  void count;
  void avgAge;
  // @ts-expect-error an average over no rows is NULL, so the result is not a bare number
  const avgAgeNotNullable: number = rows[0].avgAge;
  void avgAgeNotNullable;

  // Aggregate-only query (no grouping) is valid.
  await querier.aggregate(User, { $select: { total: { $count: '*' } } });

  // Negative: computed columns go in $select; $agg is not an option.
  // @ts-expect-error '$agg' does not exist in QueryAggregate
  await querier.aggregate(User, { $agg: { total: { $count: '*' } } });

  // Positive: each $having value is typed to that column's result type ($avg -> number,
  // $min over a string column -> string).
  await querier.aggregate(User, {
    $select: { avgAge: { $avg: { age: true } }, firstStatus: { $min: { status: true } } },
    $having: { avgAge: { $gt: 30 }, firstStatus: { $startsWith: 'a' } },
  });

  // Negative: a numeric comparison on a string-typed $min result is rejected.
  await querier.aggregate(User, {
    $select: { firstStatus: { $min: { status: true } } },
    // @ts-expect-error firstStatus is a string ($min of a string column), not a number
    $having: { firstStatus: { $gt: 5 } },
  });

  // Negative: a typo'd group-by column is rejected (typed like $select).
  await querier.aggregate(User, {
    // @ts-expect-error 'statuses' is not a field of User
    $group: { statuses: true },
  });

  // Negative: a computed aggregate wrongly placed in $group (it belongs in $select) is rejected even
  // when a valid group-by column is present alongside it.
  await querier.aggregate(User, {
    // @ts-expect-error 'count' is not a field of User; computed columns go in $select
    $group: { status: true, count: { $count: '*' } },
  });

  // Negative: a typo'd aggregated field reference is rejected.
  await querier.aggregate(User, {
    // @ts-expect-error 'agee' is not a field of User
    $select: { avgAge: { $avg: { agee: true } } },
  });

  // Negative: a $having alias that is neither a grouped column nor a computed alias is rejected.
  await querier.aggregate(User, {
    $group: { status: true },
    $select: { count: { $count: '*' } },
    // @ts-expect-error 'conut' is neither a grouped column nor a computed alias
    $having: { conut: { $gt: 5 } },
  });

  // Negative: a $sort alias that is neither a grouped column, computed alias, nor entity field.
  await querier.aggregate(User, {
    $group: { status: true },
    $select: { count: { $count: '*' } },
    // @ts-expect-error 'conut' is not sortable here
    $sort: { conut: -1 },
  });

  // Positive: the flat DISTINCT op accepts a field and resolves to number.
  const distinctRows = await querier.aggregate(User, {
    $group: { status: true },
    $select: { uniqueAges: { $countDistinct: { age: true } } },
  });
  const uniqueAges: number = distinctRows[0].uniqueAges;
  void uniqueAges;

  // Negative: only $count accepts '*'; every other aggregate requires a real field.
  await querier.aggregate(User, {
    // @ts-expect-error $sum requires a field, not '*'
    $select: { total: { $sum: '*' } },
  });

  // Negative: $count takes a field or '*', not a numeric literal.
  await querier.aggregate(User, {
    // @ts-expect-error $count takes '*', not 1
    $select: { total: { $count: 1 } },
  });

  // Negative: a DISTINCT op requires a field ('*' is not allowed).
  await querier.aggregate(User, {
    // @ts-expect-error $countDistinct requires a field, not '*'
    $select: { uniques: { $countDistinct: '*' } },
  });

  // Negative: $min/$max have no DISTINCT variant.
  await querier.aggregate(User, {
    // @ts-expect-error $minDistinct is not a valid aggregate op
    $select: { earliest: { $minDistinct: 'age' } },
  });

  // Negative: a typo'd DISTINCT field reference is rejected.
  await querier.aggregate(User, {
    // @ts-expect-error 'agee' is not a field of User
    $select: { uniques: { $countDistinct: { agee: true } } },
  });

  // Negative: exactly one operation per entry - a second op in the same entry is rejected.
  await querier.aggregate(User, {
    // @ts-expect-error 'total' has two aggregate ops; exactly one is allowed
    $select: { total: { $count: '*', $sum: { age: true } } },
  });

  // Negative: a field reference names exactly one field, as a key set to `true`.
  await querier.aggregate(User, {
    // @ts-expect-error a string names a key a rename cannot follow; only the key form exists
    $select: { total: { $sum: 'age' } },
  });
  await querier.aggregate(User, {
    // @ts-expect-error no field named
    $select: { total: { $sum: {} } },
  });
  await querier.aggregate(User, {
    // @ts-expect-error two fields named
    $select: { total: { $sum: { age: true, id: true } } },
  });
  await querier.aggregate(User, {
    // @ts-expect-error a field switched off names nothing
    $select: { total: { $sum: { age: false } } },
  });
}

/**
 * The result row carries exactly the columns the statement emits, whether `$group` is written inline,
 * hoisted or annotated.
 */
export async function resultRowCarriesOnlyEmittedColumns() {
  const aggOnly = await querier.aggregate(User, { $select: { total: { $sum: { age: true } } } });
  const total: number | null = aggOnly[0].total;
  void total;
  // @ts-expect-error `status` was never grouped, so no such column comes back
  void aggOnly[0].status;

  const grouped = await querier.aggregate(User, { $group: { status: true }, $select: { n: { $count: '*' } } });
  const status: string = grouped[0].status;
  void status;
  // @ts-expect-error `age` was not grouped either
  void grouped[0].age;
}

export async function aggregateArgumentsAreChecked() {
  // @ts-expect-error a SUM over a text column cannot be the `number` the result type promises
  await querier.aggregate(User, { $select: { s: { $sum: { status: true } } } });
  // @ts-expect-error nor can an AVG over one
  await querier.aggregate(User, { $select: { a: { $avg: { status: true } } } });
  // $min/$max keep the column's own type, so any column will do.
  const rows = await querier.aggregate(User, { $select: { first: { $min: { status: true } } } });
  const first: string | null = rows[0].first;
  void first;
}

/**
 * Both would be emitted under the one name (`SELECT "age", COUNT(*) "age" ... GROUP BY "age"`),
 * leaving the driver to keep whichever column it read last.
 */
export async function anAliasMayNotShadowAGroupedColumn() {
  // @ts-expect-error 'age' is already a grouped column
  await querier.aggregate(User, { $group: { age: true }, $select: { age: { $count: '*' } } });
  // a different alias over the same column is fine
  await querier.aggregate(User, { $group: { age: true }, $select: { ageCount: { $count: '*' } } });
}

/**
 * A total reads back as the column it totals - `SUM` over a `bigint` column answers a `bigint`, which
 * is what the driver decodes - while an average is a `number` whatever it read, since the engine floats it.
 */
export async function aTotalKeepsItsColumnsType() {
  const rows = await querier.aggregate(User, {
    $select: {
      totalBalance: { $sum: { balance: true } },
      avgBalance: { $avg: { balance: true } },
      maxBalance: { $max: { balance: true } },
      totalAge: { $sum: { age: true } },
    },
    $having: { totalBalance: { $gt: 5n }, avgBalance: { $gt: 5 } },
  });
  const totalBalance: bigint | null = rows[0].totalBalance;
  const avgBalance: number | null = rows[0].avgBalance;
  const maxBalance: bigint | null = rows[0].maxBalance;
  const totalAge: number | null = rows[0].totalAge;
  void totalBalance;
  void avgBalance;
  void maxBalance;
  void totalAge;

  // @ts-expect-error a total over a `bigint` column is a `bigint`, not a `number`
  const balanceAsNumber: number | null = rows[0].totalBalance;
  void balanceAsNumber;

  await querier.aggregate(User, {
    $select: { totalBalance: { $sum: { balance: true } } },
    // @ts-expect-error a `bigint` total compares against a `bigint`, not a `number`
    $having: { totalBalance: { $gt: 5 } },
  });
}

class Owner {
  id!: number;
  name!: string;
  nickname?: string | null;
}

class Txn {
  id!: number;
  orderId!: string;
  kind!: string;
  owner?: Owner;
  entries?: Entry[];
}

class Entry {
  id!: number;
  account!: string;
  amount!: bigint;
  transactionId!: number;
  transaction?: Txn;
}

/**
 * A group key names a to-one relation's field by the path through it, under an alias: rows stay flat.
 * A path joins the rows it reads, so a row pointing nowhere is in no group of it, and the value is the
 * field's own: `null` only where the column holds one.
 */
export async function aGroupKeyReachesThroughToOneRelations() {
  const rows = await querier.aggregate(Entry, {
    $group: {
      account: true,
      orderId: { transaction: { orderId: true } },
      ownerName: { transaction: { owner: { name: true } } },
      nickname: { transaction: { owner: { nickname: true } } },
    },
    $select: { total: { $sum: { amount: true } } },
    $having: { total: { $gt: 0n } },
    $sort: { orderId: 1, total: -1 },
  });
  const account: string = rows[0].account;
  const orderId: string = rows[0].orderId;
  const ownerName: string = rows[0].ownerName;
  const nickname: string | null = rows[0].nickname;
  void account;
  void orderId;
  void ownerName;
  void nickname;
  // @ts-expect-error the column holds `null`, which the path reads as it is
  const nicknameNotNull: string = rows[0].nickname;
  void nicknameNotNull;

  // @ts-expect-error a to-many multiplies the rows it joins, and every total with them
  await querier.aggregate(Txn, { $group: { amount: { entries: { amount: true } } } });
  // @ts-expect-error 'orderID' is not a field of Txn
  await querier.aggregate(Entry, { $group: { orderId: { transaction: { orderID: true } } } });
  // @ts-expect-error a path names one field
  await querier.aggregate(Entry, { $group: { both: { transaction: { orderId: true, kind: true } } } });
  // @ts-expect-error a relation is a path, not a key switched on
  await querier.aggregate(Entry, { $group: { transaction: true } });
  // @ts-expect-error an alias may not be a field's name
  await querier.aggregate(Entry, { $group: { account: { transaction: { kind: true } } } });
  await querier.aggregate(Entry, {
    $group: { orderId: { transaction: { orderId: true } } },
    // @ts-expect-error 'orderId' is already a grouped column
    $select: { orderId: { $count: '*' } },
  });
  // @ts-expect-error a relation's field is grouped, never aggregated
  await querier.aggregate(Entry, { $select: { s: { $sum: { transaction: { id: true } } } } });
}

/** An aggregate takes a `$where` of its own over the entity's fields, and keeps its result type. */
export async function anAggregateFiltersItsOwnRows() {
  const rows = await querier.aggregate(Entry, {
    $group: { orderId: { transaction: { orderId: true } } },
    $select: {
      held: { $sum: { amount: true }, $where: { account: 'buyer_clearing' } },
      entries: { $count: '*', $where: { amount: { $gt: 0n }, $or: [{ account: 'a' }, { account: 'b' }] } },
    },
  });
  const held: bigint | null = rows[0].held;
  const entries: number = rows[0].entries;
  void held;
  void entries;

  await querier.aggregate(Entry, {
    // @ts-expect-error a filter reads the entity's own fields; a relation there is a subquery inside the aggregate
    $select: { n: { $count: '*', $where: { transaction: { kind: 'x' } } } },
  });
  await querier.aggregate(Entry, {
    // @ts-expect-error 'acount' is not a field of Entry
    $select: { n: { $count: '*', $where: { account: 'a', acount: 'b' } } },
  });
  await querier.aggregate(Entry, {
    // @ts-expect-error an amount compares against a bigint
    $select: { n: { $count: '*', $where: { amount: 'x' } } },
  });
}

/** A path names a field at its end, however optional the properties along it. */
export async function aPathEndsInAField() {
  // @ts-expect-error a relation names no field on its own
  await querier.aggregate(Entry, { $group: { none: { transaction: {} } } });
}
